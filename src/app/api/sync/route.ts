import { type NextRequest, NextResponse } from "next/server";

import { verifySecret } from "@/app/api/lib/verify-secret";
import { getDatabase } from "@/server/database";
import { ensureUsageIndexes, saveUsageEvents, type UsageEventDocument } from "@/server/usage-store";

const REQUIRED_STRING_FIELDS = ["requestId", "messageId", "sessionId", "projectSlug", "model"] as const;
const OPTIONAL_STRING_FIELDS = ["repoKey", "accountUuid", "orgUuid"] as const;
const REQUIRED_NUMBER_FIELDS = [
	"inputTokens",
	"cacheReadTokens",
	"cacheWrite5mTokens",
	"cacheWrite1hTokens",
	"outputTokens",
	"costUsd",
] as const;
const REQUIRED_BOOLEAN_FIELDS = ["priced", "isSubagent"] as const;

/**
 * True only when a raw wire event is a plain object and every allowlisted field on it is the
 * right primitive type — the allowlist alone (key names) still lets a value of any shape or
 * size reach Mongo, which is how an operator-valued requestId/messageId corrupts an unrelated
 * document and how a mistyped model/costUsd/outputTokens poisons every $sum/$max
 * (ADVERSARIAL_REVALIDATION.md R7 parts 2 and 3). Never reads a field it hasn't type-checked.
 * @param raw - one entry from the wire body's `events` array, of unknown shape
 * @returns whether every checked field has the expected primitive type
 */
function isValidUsageEvent(raw: unknown): raw is Record<string, unknown> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const event = raw as Record<string, unknown>;

	for (const field of REQUIRED_STRING_FIELDS) {
		if (typeof event[field] !== "string") return false;
	}
	for (const field of OPTIONAL_STRING_FIELDS) {
		if (event[field] !== undefined && typeof event[field] !== "string") return false;
	}
	for (const field of REQUIRED_NUMBER_FIELDS) {
		if (typeof event[field] !== "number" || !Number.isFinite(event[field])) return false;
	}
	for (const field of REQUIRED_BOOLEAN_FIELDS) {
		if (typeof event[field] !== "boolean") return false;
	}

	if (typeof event.timestamp !== "string" || Number.isNaN(new Date(event.timestamp).getTime())) return false;

	return true;
}

/**
 * Accepts a batch of usage events and upserts them, returning how many were accepted and how
 * many were rejected for failing per-event type validation. Wire body is
 * `{ machineId, events[] }` — machineId is batch-level and stamped onto every event; each event
 * carries its own optional account, since a catch-up sync can span an account switch mid-batch.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	if (!verifySecret(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { machineId?: unknown; events?: unknown };
	try {
		body = (await request.json()) as { machineId?: unknown; events?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	const { machineId, events } = body;

	if (typeof machineId !== "string" || !machineId) {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	if (!Array.isArray(events)) {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	// The allowlist above only checks KEY names, never value TYPES. requestId/messageId flow
	// straight into saveUsageEvents' updateOne FILTER, so an event carrying a Mongo query
	// operator as a "value" (e.g. requestId: {"$gt": ""}) matches and silently rewrites an
	// arbitrary pre-existing document instead of failing to find one; a mistyped model/
	// costUsd/outputTokens is stored verbatim and poisons every $sum/$max
	// (ADVERSARIAL_REVALIDATION.md R7 parts 2 and 3). A bad event is skipped, not the whole
	// batch — see DECISIONS.md.
	const validEvents = (events as unknown[]).filter(isValidUsageEvent);
	const rejected = events.length - validEvents.length;

	// Explicit allowlist, mirroring the mapper's own (src/parser/events.mjs) — the wire payload
	// must never be spread verbatim onto the stored document. A spread would (a) leak any extra
	// client-supplied field straight into Mongo, defeating the aggregates-only guarantee at the
	// one choke point that's supposed to enforce it, and (b) let a client-supplied `_id` reach
	// `saveUsageEvents`' `$set`, which Mongo rejects as an immutable-field update.
	const documents = validEvents.map((event) => {
		const source = event as unknown as UsageEventDocument;
		const document: UsageEventDocument = {
			requestId: source.requestId,
			messageId: source.messageId,
			sessionId: source.sessionId,
			projectSlug: source.projectSlug,
			machineId,
			model: source.model,
			timestamp: new Date(event.timestamp as string),
			inputTokens: source.inputTokens,
			cacheReadTokens: source.cacheReadTokens,
			cacheWrite5mTokens: source.cacheWrite5mTokens,
			cacheWrite1hTokens: source.cacheWrite1hTokens,
			outputTokens: source.outputTokens,
			costUsd: source.costUsd,
			priced: source.priced,
			isSubagent: source.isSubagent,
		};
		// Present only when the mapper actually resolved a repository (D20) or attributed an
		// account (D7) — never guessed.
		if (source.repoKey !== undefined) document.repoKey = source.repoKey;
		if (source.accountUuid !== undefined) document.accountUuid = source.accountUuid;
		if (source.orgUuid !== undefined) document.orgUuid = source.orgUuid;
		return document;
	});

	const db = await getDatabase();
	await ensureUsageIndexes(db);
	const accepted = await saveUsageEvents(db, documents);

	return NextResponse.json({ accepted, rejected }, { status: 200 });
}
