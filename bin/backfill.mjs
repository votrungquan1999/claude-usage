#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { attributeTurns } from "../src/parser/attribution.mjs";
import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";
import { mapTurnToEvent, resolveSessionTitle } from "../src/parser/events.mjs";
import { resolveProjectSlug } from "../src/parser/project.mjs";
import { streamRecords } from "../src/parser/read.mjs";
import { resolveRepoKey } from "../src/parser/repo.mjs";
import { loadDotEnvIfNeeded, postEvents, readLedger } from "./sync.mjs";

/**
 * Bring every session already on the machine into the store, one re-runnable command.
 *
 * Walks `~/.claude/projects` (or `projectsRoot`, for tests), dedupes and maps each transcript
 * exactly like the live uploader does, and POSTs through the same `postEvents` (`bin/sync.mjs`)
 * — no second serialisation path. There is no persisted done/checkpoint state: re-running the
 * whole thing is the intended recovery path, relying on the store's `$max` upsert for safety.
 *
 * @param {object} options
 * @param {string} options.projectsRoot - absolute path to the projects directory to walk
 * @param {object} [options.env] - defaults to process.env; pass a plain object in tests
 * @param {string} [options.home] - defaults to homedir(); pass a fake $HOME in tests
 * @returns {Promise<{filesProcessed: number, eventsSent: number, eventsRejected: number, requestsSent: number, failures: {path: string, reason: string}[], directoriesSkipped: number, missingConfig: string[]}>}
 *   `missingConfig` lists the env var names not set (non-empty only when nothing was attempted at all).
 *   `eventsRejected` totals the sync route's own per-event rejections (D21) across the whole
 *   run — surfaced rather than folded silently into `eventsSent`, since a rejected event needs
 *   its transcript looked at, not just a lower count.
 */
export async function runBackfill({ projectsRoot, env = process.env, home = homedir() }) {
	const summary = {
		filesProcessed: 0,
		eventsSent: 0,
		eventsRejected: 0,
		requestsSent: 0,
		failures: [],
		directoriesSkipped: 0,
		missingConfig: [],
	};

	// Same lookup as the live hooks (bin/sync.mjs) -- without this, a plain `node
	// bin/backfill.mjs` run straight from a clone never finds a checkout-local .env.
	loadDotEnvIfNeeded(home, env);

	const apiUrl = env.CLAUDE_USAGE_API_URL;
	const secret = env.CLAUDE_USAGE_SECRET;
	const missingConfig = [];
	if (!apiUrl) missingConfig.push("CLAUDE_USAGE_API_URL");
	if (!secret) missingConfig.push("CLAUDE_USAGE_SECRET");
	// Loud, not a silent no-op: an empty-looking summary read in isolation is indistinguishable
	// from "ran and found nothing to send" — the caller needs to know NOTHING was attempted.
	if (missingConfig.length > 0) return { ...summary, missingConfig };

	const machineId = readMachineId(home);
	if (!machineId) return summary;

	// Read once, not per file/session: a live sync writes to this ledger as hooks run, so a
	// transcript backfilled after hooks have already recorded its session's account should carry
	// that attribution too, not ship unattributed by construction the way an unconditional `{}`
	// did before.
	const ledgerPath = join(home, ".claude", "claude-usage-state", "accounts.json");
	const accountLedger = readLedger(ledgerPath);

	for (const projectDir of listProjectDirs(projectsRoot)) {
		const projectSlug = resolveProjectSlug(projectDir);
		if (!projectSlug) {
			summary.directoriesSkipped++;
			continue;
		}

		// Same per-directory resolution as projectSlug (D20) — optional: undefined when the
		// resolved cwd isn't a git repo, or no longer exists. Only a FALLBACK now: each turn is
		// attributed on its own evidence, and this is what a turn offering none lands on.
		const repoKey = resolveRepoKey(projectDir);
		const fallback = { projectSlug, ...(repoKey !== undefined && { repoKey }) };

		for (const transcriptPath of listTranscripts(projectDir)) {
			summary.filesProcessed++;

			try {
				// Read once and keep the raw records: the session title lives in its own `ai-title`
				// record, which dedupeAssistantTurns filters out with every non-assistant record.
				const records = streamRecords(transcriptPath);
				const turns = dedupeAssistantTurns(records);
				const sessionTitle = resolveSessionTitle(records);
				// One transcript is one chronological stream, which is the unit repo attribution
				// carries forward through.
				const attributions = attributeTurns(turns, fallback);
				const events = turns
					.map((turn, index) =>
						mapTurnToEvent(turn, { ...attributions[index], machineId, accountLedger, sessionTitle }),
					)
					.filter((event) => event !== null);
				if (events.length === 0) continue;

				for (const batch of chunk(events, BATCH_SIZE)) {
					// isBackfill: true (card #161 D17 Fix A) — a manual backfill is not evidence the
					// machine's LIVE sync path is healthy; the server uses this marker to skip
					// stamping machine_sync_state, the same way `home` being omitted already skips
					// the local watermark (D6, above).
					const result = await postEvents({ apiUrl, secret, machineId, events: batch, isBackfill: true });
					summary.requestsSent++;
					summary.eventsSent += result.sent;
					summary.eventsRejected += result.rejected;
					// A non-ok response reports sent: 0 without throwing (postEvents' own contract) —
					// a real send of zero events never happens here since an empty batch is skipped above.
					if (result.sent === 0) summary.failures.push({ path: transcriptPath, reason: "upload failed" });
				}
			} catch (err) {
				// A THROW is a different failure mode than a non-2xx response: a dropped connection,
				// the shared 5s AbortSignal.timeout, or the transcript vanishing between being listed
				// and being read (ENOENT). Without this catch, the throw rejects runBackfill's whole
				// promise — aborting every file not yet attempted, not just this one.
				summary.failures.push({ path: transcriptPath, reason: err.message ?? String(err) });
			}
		}
	}

	return summary;
}

// Vercel's request body cap is a hard, non-configurable 4.5 MB; a realistic event is ~555 B,
// so 2,000/request (~1.1 MB) leaves generous headroom for field-size variance.
const BATCH_SIZE = 2000;

function* chunk(array, size) {
	for (let i = 0; i < array.length; i += size) yield array.slice(i, i + size);
}

function listProjectDirs(projectsRoot) {
	let entries;
	try {
		entries = readdirSync(projectsRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((entry) => entry.isDirectory()).map((entry) => join(projectsRoot, entry.name));
}

/**
 * Every transcript under a project directory: top-level `.jsonl` files (main session
 * transcripts) plus every `agent-*.jsonl` nested at any depth underneath (subagents, and
 * subagents launched inside a workflow, which sit two levels deeper still). A genuinely
 * recursive walk — not a fixed-depth glob — is required: workflow-launched subagents live at
 * `<session>/subagents/workflows/wf_<id>/agent-*.jsonl`, one level past ordinary subagents.
 */
function listTranscripts(projectDir) {
	let entries;
	try {
		entries = readdirSync(projectDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const transcripts = [];
	for (const entry of entries) {
		const path = join(projectDir, entry.name);
		if (entry.isFile() && entry.name.endsWith(".jsonl")) transcripts.push(path);
		else if (entry.isDirectory()) walkSubagents(path, transcripts);
	}
	return transcripts;
}

/** Recurse into a session directory collecting `agent-*.jsonl` at any depth — never `journal.jsonl`. */
function walkSubagents(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkSubagents(path, out);
		else if (entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".jsonl")) out.push(path);
	}
}

/** Same defensive shape as `bin/sync.mjs`'s own `readMachineId` — a missing/corrupt file is "no machine id". */
function readMachineId(home) {
	try {
		return JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).machineID ?? null;
	} catch {
		return null;
	}
}

// CLI entry — run directly to bring every session already on the machine into the store.
if (import.meta.url === `file://${process.argv[1]}`) {
	const projectsRoot = join(homedir(), ".claude", "projects");
	runBackfill({ projectsRoot })
		.then((summary) => {
			// Loud, not a quiet "0 files, 0 events" that reads as a clean successful no-op --
			// that was the exact bug (a checkout-local run with no .env exited 0 having done
			// nothing at all, indistinguishable from "ran and found nothing to send").
			if (summary.missingConfig.length > 0) {
				console.error(
					`backfill not configured — missing ${summary.missingConfig.join(", ")}. ` +
						"Set them in .env (repo root, or ~/.claude/claude-usage/.env if installed) and re-run.",
				);
				process.exit(1);
			}
			console.log(
				`backfill done: ${summary.filesProcessed} files, ${summary.eventsSent} events, ` +
					`${summary.eventsRejected} rejected, ${summary.requestsSent} requests, ` +
					`${summary.failures.length} failures, ${summary.directoriesSkipped} directories skipped (no cwd found)`,
			);
			for (const failure of summary.failures) console.error(`  failed: ${failure.path} — ${failure.reason}`);
			process.exit(summary.failures.length > 0 ? 1 : 0);
		})
		.catch((err) => {
			// Last-resort net: every throw inside the walk is now caught and recorded per-file
			// (see the try/catch above), so this should be unreachable in practice. It stays as a
			// backstop so a future change to the loop can't silently regress back to a raw stack
			// trace with no summary at all — the whole point of this step.
			console.error(`backfill crashed before it could finish: ${err.message ?? err}`);
			process.exit(1);
		});
}
