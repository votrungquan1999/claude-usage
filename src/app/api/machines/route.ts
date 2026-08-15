import { type NextRequest, NextResponse } from "next/server";

import { verifySecret } from "@/app/api/lib/verify-secret";
import { getDatabase } from "@/server/database";
import { machineSyncStatus } from "@/server/usage-queries";
import { setMachineName } from "@/server/usage-store";

// No precedent value exists anywhere in the repo (Step 9 investigation). Chosen well
// below the 64-char machine-id hash width that the mobile fix exists to get off the screen
// (D15) — long enough for "Alice's MacBook (work)", short enough that a nickname cannot recreate
// the same DOM-width overflow the hash caused at 390px.
const MAX_MACHINE_NAME_LENGTH = 40;

/**
 * Code points that render as nothing at all: soft hyphen, zero-width space, the two invisible
 * bidi marks, word joiner, and the byte-order mark. They are not whitespace to `\s`, so trimming
 * and collapsing leaves them in place — which lets two names look identical on screen while
 * storing as different strings.
 *
 * ZWNJ (U+200C) and ZWJ (U+200D) are deliberately absent: both carry real orthographic meaning in
 * Persian and Indic scripts and are what join emoji sequences, so removing them would corrupt a
 * name the operator typed on purpose.
 */
const INVISIBLE_CODE_POINTS = new Set([0x00ad, 0x200b, 0x200e, 0x200f, 0x2060, 0xfeff]);

/**
 * Drops invisible formatting characters, then trims and collapses internal whitespace runs, so
 * `" Studio "` and `"Studio"` are the same stored name (DECISIONS.md D15) — otherwise "duplicate"
 * and "sorted" quietly stop meaning what they look like.
 *
 * Invisibles are stripped rather than rejected, matching how this function already treats stray
 * whitespace: the operator meant the visible text. A name made only of them normalises to empty,
 * which D14 then reads as clearing the nickname.
 *
 * @param raw - the operator-typed name, before any validation
 * @returns the normalised name, still unvalidated
 */
function normalizeMachineName(raw: string): string {
	const visible = [...raw].filter((char) => !INVISIBLE_CODE_POINTS.has(char.codePointAt(0) ?? 0)).join("");
	return visible.trim().replace(/\s+/g, " ");
}

/**
 * True when `value` contains a C0/C1 control character (incl. NUL, DEL) or a Unicode
 * bidi-override/isolate formatting character (DECISIONS.md D15) — the latter can make a name
 * RENDER as something other than what it stores, e.g. spoofing a machine's identity in the sync
 * tile or chart legend. Written as numeric code-point comparisons rather than a regex literal so
 * no exotic character has to appear in this file's source at all.
 * @param value - the already-trimmed, whitespace-collapsed candidate name
 * @returns whether the name contains a disallowed character
 */
function hasDisallowedNameChar(value: string): boolean {
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		const isC0OrDel = code <= 0x1f || code === 0x7f;
		const isC1 = code >= 0x80 && code <= 0x9f;
		// LRE/RLE/PDF/LRO/RLO, then the newer LRI/RLI/FSI/PDI isolates.
		const isBidiOverrideOrIsolate = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
		if (isC0OrDel || isC1 || isBidiOverrideOrIsolate) return true;
	}
	return false;
}

/**
 * The `host` (hostname, optionally `:port`) component of an Origin header value, or `null` when
 * the header is absent or not a well-formed absolute URL.
 *
 * Deliberately not the scheme: production sits behind a proxy that terminates TLS, and `nextUrl`'s
 * own protocol reflects how THIS server sees the connection, which a proxy hop does not always
 * preserve as "https" even though the browser's real Origin genuinely is. Comparing full origins
 * would 403 every legitimate same-site request there; the host is what actually identifies the
 * site being impersonated by a cross-origin request, and a proxy forwards it unchanged.
 *
 * @param origin - the raw `Origin` request header value
 */
function originHost(origin: string | null): string | null {
	if (!origin) return null;
	try {
		return new URL(origin).host;
	} catch {
		return null;
	}
}

/**
 * Renames (or clears) a machine's display nickname. `/api` is excluded from `src/proxy.ts:38`'s
 * matcher, so this handler is the ONLY thing authorising the write — see DECISIONS.md D6/D9/D18.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	if (!verifySecret(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// `sameSite: "lax"` on the session cookie was never CHOSEN as a CSRF control (DECISIONS.md
	// D9) — this is the explicit protection. A same-origin browser POST always carries Origin
	// (Fetch spec), so an absent header is treated the same as a mismatched one.
	if (originHost(request.headers.get("origin")) !== request.nextUrl.host) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	let body: { machineId?: unknown; name?: unknown };
	try {
		body = (await request.json()) as { machineId?: unknown; name?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	const { machineId, name } = body;

	if (typeof machineId !== "string" || !machineId) {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	if (typeof name !== "string") {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	const normalized = normalizeMachineName(name);
	if (normalized !== "" && (normalized.length > MAX_MACHINE_NAME_LENGTH || hasDisallowedNameChar(normalized))) {
		return NextResponse.json({ error: "Invalid name" }, { status: 400 });
	}

	// The roster is the UNION `machineSyncStatus()` already computes — usage_events' distinct
	// machineIds OR machine_sync_state's own ids (DECISIONS.md D18) — never a bare
	// machine_sync_state existence check, which would permanently lock out a machine that has
	// spend but no state row (recordMachineSync is deliberately skipped for backfills/empty
	// batches). A typo still can't conjure a phantom machine: absence from BOTH sources is 404.
	const db = await getDatabase();
	const roster = await machineSyncStatus(db);
	const isKnownMachine = roster.some((row) => row.machineId === machineId);
	if (!isKnownMachine) {
		return NextResponse.json({ error: "Unknown machine" }, { status: 404 });
	}

	// An empty or whitespace-only name CLEARS the nickname rather than being a 400 (D14) — the
	// operator needs an undo once a machine has been named.
	await setMachineName(db, machineId, normalized === "" ? null : normalized);

	return NextResponse.json({ name: normalized === "" ? null : normalized }, { status: 200 });
}
