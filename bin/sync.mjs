#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { recordAccount } from "../src/parser/account-ledger.mjs";
import { attributeTurns, resolveProjectAttribution } from "../src/parser/attribution.mjs";
import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";
import { mapTurnToEvent, resolveSessionTitle } from "../src/parser/events.mjs";
import { readTailRecords, streamRecords } from "../src/parser/read.mjs";

/**
 * Tail-sync one transcript's unsent usage to the hosted store.
 *
 * Two callers: `hooks/user-prompt-submit.mjs` spawns this file detached (Step 12) so an
 * upload never adds latency to a prompt; `hooks/session-start.mjs` imports `syncTail` and
 * awaits it inline (Step 13), so a session starts already caught up.
 *
 * Aggregates-only, with ONE deliberate exception: raw records are held just long enough to pull
 * the session title out of them, and nothing but that string survives. Otherwise this file must
 * never hold a raw transcript record in scope past the point `dedupeAssistantTurns` /
 * `mapTurnToEvent` have narrowed it — only `MappedUsageEvent` objects are ever serialised into a
 * request body, and `lastPrompt` (raw prompt text, in the same records) is never among them.
 *
 * Never throws: every failure mode (no network, non-2xx, missing config, missing/unreadable
 * files) degrades to a no-op. There is no persisted watermark, so the next firing re-derives
 * from the same tail window and Mongo's unique-index upsert makes re-sending free.
 *
 * @param {object} options
 * @param {string} options.transcriptPath
 * @param {object} [options.env] - defaults to process.env; pass a plain object in tests
 * @param {string} [options.home] - defaults to homedir(); pass a fake $HOME in tests
 * @param {boolean} [options.full] - false (default): read only the fixed tail window, the cheap
 *   per-prompt path. true: stream the WHOLE transcript plus every subagent transcript under it.
 *   A fixed tail is blind to anything one long agentic turn pushes more than the window behind
 *   it (R19) and never sees subagent work at all (R22/R31) — there is no persisted watermark by
 *   design, so a sweep is the only way to catch up. `hooks/session-start.mjs` passes `true`: it
 *   fires far less often than `UserPromptSubmit` (session boundaries, not every prompt) and a
 *   full stream read is bounded-memory and fast even on the largest real transcript observed
 *   (~261 MiB in ~1s — see DECISIONS.md). `hooks/user-prompt-submit.mjs` stays on the cheap tail
 *   window, since it fires on every prompt and its detached child re-running a full sweep that
 *   often would trade one cheap read for constant background re-upload of already-synced work.
 * @returns {Promise<{sent: number}>} how many events were actually posted (0 on any no-op/failure)
 */
export async function syncTail({ transcriptPath, env = process.env, home = homedir(), full = false }) {
	try {
		loadDotEnvIfNeeded(home, env);

		const apiUrl = env.CLAUDE_USAGE_API_URL;
		const secret = env.CLAUDE_USAGE_SECRET;
		if (!apiUrl || !secret) return { sent: 0 };

		if (!transcriptPath || !existsSync(transcriptPath)) return { sent: 0 };

		// Single-flight: a rapid-fire second prompt spawns a second detached sync before the
		// first's upload finished. Without this, N overlapping processes each re-read the tail
		// and re-POST the same turns — wasted CPU/network for no correctness benefit (Mongo's
		// unique-index upsert already dedupes). Acquired before any of that work happens.
		const lockPath = join(home, ".claude", "claude-usage-state", "locks", `${basename(transcriptPath)}.lock`);
		if (!acquireLock(lockPath)) return { sent: 0 };
		try {
			return await syncOnce({ transcriptPath, home, apiUrl, secret, full });
		} finally {
			releaseLock(lockPath);
		}
	} catch {
		return { sent: 0 };
	}
}

/** Read strategy for one transcript file, per the `full` flag documented on `syncTail`. */
function readTranscriptRecords(path, full) {
	return full ? streamRecords(path) : readTailRecords(path);
}

async function syncOnce({ transcriptPath, home, apiUrl, secret, full }) {
	try {
		// Read once and keep the raw records: the session title lives in its own `ai-title` record,
		// which dedupeAssistantTurns filters out along with everything that is not an assistant turn.
		const mainRecords = readTranscriptRecords(transcriptPath, full);
		const mainTurns = dedupeAssistantTurns(mainRecords);
		// May be undefined on a tail read that did not reach back far enough to include it — the
		// mapper then omits the field, leaving any title an earlier sync recorded in place.
		const sessionTitle = resolveSessionTitle(mainRecords);

		// Subagent transcripts sit under the session directory and are never passed to a hook
		// directly (Claude Code only ever hands hooks the main transcript's path) — without this,
		// subagent spend reaches the store only via a manual `bin/backfill.mjs` run (R22/R31).
		// Kept as one group per transcript rather than flattened: repo attribution carries forward
		// through a chronological stream, and a subagent's turns are their own stream, not a
		// continuation of the main one.
		const subagentGroups = listSubagentTranscripts(transcriptPath).map((path) =>
			dedupeAssistantTurns(readTranscriptRecords(path, full)),
		);
		const subagentTurns = subagentGroups.flat();

		const turns = [...mainTurns, ...subagentTurns];
		if (turns.length === 0) return { sent: 0 };

		const sessionId = mainTurns[0]?.sessionId ?? subagentTurns[0].sessionId;

		// Only a FALLBACK: each turn is attributed on its own evidence, and this is what a turn
		// offering none lands on. Null when no transcript here records a cwd to resolve from.
		const fallback = resolveProjectAttribution(dirname(transcriptPath));
		if (!fallback) return { sent: 0 };

		const machineId = readMachineId(home);
		if (!machineId) return { sent: 0 };

		const ledgerPath = join(home, ".claude", "claude-usage-state", "accounts.json");
		const accountLedger = updateLedgerWithLiveAccount(ledgerPath, readLedger(ledgerPath), home, sessionId);

		const toEvents = (group) => {
			const attributions = attributeTurns(group, fallback);
			return group
				.map((turn, index) => mapTurnToEvent(turn, { ...attributions[index], machineId, accountLedger, sessionTitle }))
				.filter((event) => event !== null);
		};
		const events = [toEvents(mainTurns), ...subagentGroups.map(toEvents)].flat();
		if (events.length === 0) return { sent: 0 };

		// Batched: a full sweep of a large session can produce far more events than the tail
		// path ever did, and Vercel's request body cap is a hard, non-configurable 4.5 MB
		// (same constant `bin/backfill.mjs` uses for the same reason).
		let sent = 0;
		for (const batch of chunk(events, BATCH_SIZE)) {
			sent += (await postEvents({ apiUrl, secret, machineId, events: batch, home })).sent;
		}
		return { sent };
	} catch {
		return { sent: 0 };
	}
}

const BATCH_SIZE = 2000;

function* chunk(array, size) {
	for (let i = 0; i < array.length; i += size) yield array.slice(i, i + size);
}

/** Every `agent-*.jsonl` transcript under a session's `subagents/` tree, at any depth
 * (ordinary subagents, and subagents launched inside a workflow one level deeper still) —
 * never `journal.jsonl`. Mirrors `bin/backfill.mjs`'s own `walkSubagents` (kept as a small,
 * deliberate duplicate rather than an import — that file belongs to a different batch/agent). */
function listSubagentTranscripts(mainTranscriptPath) {
	const subagentsDir = join(mainTranscriptPath.replace(/\.jsonl$/, ""), "subagents");
	const out = [];
	walkSubagentDir(subagentsDir, out);
	return out;
}

function walkSubagentDir(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkSubagentDir(path, out);
		else if (entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".jsonl")) out.push(path);
	}
}

const SECRET_HEADER = "x-claude-usage-secret";
// Mirrors the server's own literal (src/app/api/sync/route.ts) — bin/ and src/app/ don't share
// an import boundary, same reason SECRET_HEADER is duplicated rather than imported. Set only by
// bin/backfill.mjs (card #161 D17 Fix A): a manual backfill run is not evidence the machine's
// LIVE sync path is healthy, and the server uses this header to skip stamping its own
// machine_sync_state record for exactly that reason. A plain marker, no content — never joins
// the event-field allowlists.
const BACKFILL_HEADER = "x-claude-usage-backfill";
const FETCH_TIMEOUT_MS = 5000;
const SYNC_PATH = "/api/sync";

/**
 * `CLAUDE_USAGE_API_URL` is documented (.env.example) and named as a BASE url, not the full
 * endpoint (R31: posting straight to the base silently hit the dashboard page instead of the
 * sync route, which returned 200 and dropped ~54,000 events). Strips one trailing slash, then
 * appends the sync path unless it's already there, so a base with or without a trailing slash,
 * or one a caller already pointed straight at the sync route, all resolve to the same URL.
 */
export function resolveSyncUrl(apiUrl) {
	const base = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
	return base.endsWith(SYNC_PATH) ? base : `${base}${SYNC_PATH}`;
}

/**
 * POST one batch of already-mapped events. The sole place a request body is assembled — both
 * `syncTail` and `bin/backfill.mjs` call this rather than each serialising their own.
 *
 * @param {object} options
 * @param {string} options.apiUrl
 * @param {string} options.secret
 * @param {string} options.machineId
 * @param {import("../src/parser/events.mjs").MappedUsageEvent[]} options.events
 * @param {string} [options.home] - when given, a successful response stamps the local sync
 *   watermark under this home (card #161 D6). `syncTail` passes it; `bin/backfill.mjs` deliberately
 *   omits it, since a backfill run is not evidence the machine's LIVE sync path is healthy.
 * @param {boolean} [options.isBackfill] - card #161 D17 Fix A. `bin/backfill.mjs` passes `true`;
 *   `syncTail` never passes it (default false), so a live sync's request carries no such header —
 *   the absence is what tells the server "this is a live sync, stamp normally."
 * @returns {Promise<{sent: number, rejected: number}>} `sent`/`rejected` are 0 on any non-2xx
 *   response, or on a 200 whose body isn't the sync route's own `{accepted, rejected}` shape
 *   (R31: a 200 from the wrong endpoint must never read as a successful send).
 */
export async function postEvents({ apiUrl, secret, machineId, events, home, isBackfill = false }) {
	const response = await fetch(resolveSyncUrl(apiUrl), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			[SECRET_HEADER]: secret,
			...(isBackfill && { [BACKFILL_HEADER]: "1" }),
		},
		body: JSON.stringify({ machineId, events }),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});

	// fetch does not throw on 401/5xx — an explicit ok check is required or a failed
	// upload is silently treated as a success.
	if (!response.ok) return { sent: 0, rejected: 0 };

	// A 200 alone is not proof the sync route ran (R31: a wrong path can 200 from an unrelated
	// page) — only a body shaped like the route's own `{ accepted, rejected }` counts. `sent`
	// comes from what the SERVER says it accepted, never from `events.length` (the client's own
	// optimism) — that optimism is exactly what silently swallowed ~54,000 events.
	let body;
	try {
		body = await response.json();
	} catch {
		return { sent: 0, rejected: 0 };
	}
	if (typeof body?.accepted !== "number") return { sent: 0, rejected: 0 };

	// The only honest success point: a 2xx with a real, server-confirmed body. Every earlier
	// `return` above (non-ok, non-JSON, no numeric `accepted`) skips this, so a failed send never
	// stamps the watermark.
	if (home) stampSyncWatermark(home);

	// rejected exists because the route skips individually-malformed events rather than failing
	// the whole batch (D21) -- surfaced here, not swallowed, so a caller can report it.
	return { sent: body.accepted, rejected: typeof body.rejected === "number" ? body.rejected : 0 };
}

/**
 * Records when this machine last reached the server, read by `bin/statusline.mjs` (Step 2) and,
 * once synced, by the dashboard (Step 3/4). Reuses the ledger's own atomic writer.
 *
 * Own try/catch (card #161 Batch A fix pass, Fix 5) — same defensive shape as every other local
 * file access in this file (`readLedger`, `readMachineId`, `readLiveAccount`). Without it, a
 * read-only/full `$HOME` throws from inside `postEvents`'s terminal success branch, which unwinds
 * into `syncOnce`'s outer catch — discarding the count for batches already delivered AND
 * skipping every batch still queued in the loop. A watermark write failing must never affect the
 * upload it is only recording, not gating.
 */
function stampSyncWatermark(home) {
	const path = join(home, ".claude", "claude-usage-state", "sync-watermark.json");
	try {
		writeLedger(path, { lastContactAt: new Date().toISOString() });
	} catch {
		// Best-effort bookkeeping — a failed stamp just means the next successful sync overwrites it.
	}
}

/**
 * Path to the .env this process would load, or null when neither location has one.
 * The installed location (~/.claude/claude-usage/.env, the symlink scripts/install.mjs
 * creates) takes precedence — a machine may legitimately have both, and the installed one
 * is the one actually wired to the running hooks. Falls back to the checkout's own root
 * (this file lives in bin/, so its own location pins down where that root is) so a plain
 * `node bin/sync.mjs` / `node bin/backfill.mjs` run straight from a clone still finds it.
 */
export function resolveDotEnvPath(home) {
	const installedPath = join(home, ".claude", "claude-usage", ".env");
	if (existsSync(installedPath)) return installedPath;

	const repoRootEnvPath = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env");
	if (existsSync(repoRootEnvPath)) return repoRootEnvPath;

	return null;
}

/** Only loads from disk for the real process.env — a test-injected `env` object is already complete. */
export function loadDotEnvIfNeeded(home, env) {
	if (env !== process.env) return;
	const path = resolveDotEnvPath(home);
	if (!path) return;
	try {
		process.loadEnvFile(path);
	} catch {
		// malformed .env — proceed with whatever's already in process.env
	}
}

function readMachineId(home) {
	try {
		return JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).machineID ?? null;
	} catch {
		return null;
	}
}

/** `~/.claude.json`'s `oauthAccount`, or null when absent/malformed — never guessed (D7). */
function readLiveAccount(home) {
	try {
		const oauth = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).oauthAccount;
		if (!oauth?.accountUuid || !oauth?.organizationUuid) return null;
		return { accountUuid: oauth.accountUuid, orgUuid: oauth.organizationUuid };
	} catch {
		return null;
	}
}

/**
 * Same defensive shape as install.mjs's readSettings: a missing/corrupt ledger is "no ledger
 * yet". Exported so `bin/backfill.mjs` reuses this exact read rather than a second copy.
 */
export function readLedger(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

/** Atomic temp-file + rename: any concurrent reader sees the fully-old or fully-new file, never a torn one. */
function writeLedger(path, ledger) {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp-${process.pid}`;
	writeFileSync(tmpPath, JSON.stringify(ledger, null, 2));
	renameSync(tmpPath, path);
}

/**
 * Note the currently active account for this session, if it changed, and persist it.
 * Returns the ledger to actually map with — updated when a write happened, otherwise
 * the one that was already on disk.
 */
function updateLedgerWithLiveAccount(ledgerPath, ledger, home, sessionId) {
	const liveAccount = readLiveAccount(home);
	if (!liveAccount) return ledger;

	const updated = recordAccount(ledger, sessionId, liveAccount, new Date().toISOString());
	if (updated !== ledger) writeLedger(ledgerPath, updated);
	return updated;
}

// Longer than the fetch timeout plus generous slack — a lock older than this can only be a
// crash leftover (the process holding it would have released it well before now otherwise).
const LOCK_STALE_MS = 30_000;

/** Exclusive create (`wx`) is atomic — two processes racing here can't both succeed. */
function acquireLock(lockPath) {
	mkdirSync(dirname(lockPath), { recursive: true });
	try {
		writeFileSync(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch (err) {
		if (err.code !== "EEXIST") return false;
		return reclaimIfStale(lockPath);
	}
}

// The reclaim mutex's own critical section below is a handful of synchronous fs calls with no
// I/O wait — it should never be held for more than a fraction of a millisecond. A mutex found
// older than this can only be a leftover from a process that crashed mid-critical-section,
// which is far rarer than a crash mid-sync (the network I/O the 30s LOCK_STALE_MS accounts
// for) — reclaiming it the same way keeps this from ever permanently wedging future reclaims.
const RECLAIM_MUTEX_STALE_MS = 5_000;

/**
 * A stat-then-write reclaim is two steps with nothing atomic between them: every process that
 * statSync's the stale lock before ANY of them writes returns true, so N processes can all
 * believe they hold it (proven with real spawned processes — up to 8/8 in one trial).
 *
 * The fix serialises the whole "is it stale? evict it, install my own" sequence behind a tiny
 * nested mutex — its own exclusive-create (`wx`) file, guaranteed atomic the same way the cold
 * path already is. Whoever wins the mutex performs the entire reclaim undisturbed (no other
 * process can be inside this section at the same time), so the operation is atomic from every
 * other racer's point of view; a racer that doesn't win the mutex simply backs off for this
 * cycle rather than touching `lockPath` at all. (An earlier version of this fix tried to make
 * the reclaim itself atomic via `renameSync` alone — proven insufficient: `rename()` only
 * serialises *who gets to move the file*, not *what they end up moving*, so a late racer could
 * evict an already-fresh lock installed by an earlier winner rather than the dead one it meant
 * to clean up, producing two simultaneous holders.)
 */
function reclaimIfStale(lockPath) {
	const mutexPath = `${lockPath}.reclaim-mutex`;
	if (!acquireReclaimMutex(mutexPath)) return false;
	try {
		const age = Date.now() - statSync(lockPath).mtimeMs;
		if (age <= LOCK_STALE_MS) return false;
		rmSync(lockPath, { force: true });
		writeFileSync(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		return false;
	} finally {
		try {
			rmSync(mutexPath, { force: true });
		} catch {
			// nothing to clean up
		}
	}
}

function acquireReclaimMutex(mutexPath) {
	try {
		writeFileSync(mutexPath, String(process.pid), { flag: "wx" });
		return true;
	} catch (err) {
		if (err.code !== "EEXIST") return false;
		try {
			const age = Date.now() - statSync(mutexPath).mtimeMs;
			if (age <= RECLAIM_MUTEX_STALE_MS) return false;
			rmSync(mutexPath, { force: true });
			writeFileSync(mutexPath, String(process.pid), { flag: "wx" });
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Only removes the lock if it still holds this process's own pid. Without this check, a lock
 * this process acquired but held past the 30s staleness window (a slow upload, not a crash)
 * could have already been reclaimed by another process by the time this one finishes — an
 * unconditional remove would then delete the RECLAIMER's live lock, not this process's own.
 */
function releaseLock(lockPath) {
	try {
		if (readFileSync(lockPath, "utf8") !== String(process.pid)) return;
		rmSync(lockPath, { force: true });
	} catch {
		// nothing to clean up, or another process already reclaimed it as stale
	}
}

// CLI entry — invoked as a detached child by hooks/user-prompt-submit.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
	syncTail({ transcriptPath: process.argv[2] }).then(() => process.exit(0));
}
