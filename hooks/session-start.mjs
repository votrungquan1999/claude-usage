#!/usr/bin/env node
/**
 * SessionStart hook. Runs inline (unlike UserPromptSubmit's detach) so a session opens
 * already caught up on its own unsent tail. Must never exit non-zero (Step 14).
 *
 * Fires on every `source` (startup, resume, clear, compact, fork) — any of them can leave
 * unsent tail turns behind, so no special-casing by source is needed. Syncs only the
 * current session's bounded tail, never whole history — that's `bin/backfill.mjs`'s job.
 */
import { readFileSync } from "node:fs";

import { syncTail } from "../bin/sync.mjs";

async function main() {
	let input = {};
	try {
		input = JSON.parse(readFileSync(0, "utf8"));
	} catch {
		input = {};
	}

	if (input.transcript_path) {
		// full: true -- SessionStart fires far less often than UserPromptSubmit (session
		// boundaries, not every prompt), so it is the sweep point: stream the whole transcript
		// plus every subagent transcript under it, catching anything a long turn pushed behind
		// the tail window or that a hook never sees at all (R19/R22).
		await syncTail({ transcriptPath: input.transcript_path, full: true });
	}

	process.exit(0);
}

main().catch(() => process.exit(0));
