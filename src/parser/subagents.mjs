import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { dedupeAssistantTurns } from "./dedupe.mjs";
import { turnCost } from "./pricing.mjs";
import { readTailRecords } from "./read.mjs";

/**
 * What subagents spent since a cutoff.
 *
 * Subagent transcripts sit one level deeper than the session's own, and a single session's
 * can run to 85MB — so files untouched since the cutoff are skipped on mtime alone, and the
 * rest are only tail-read.
 *
 * @param {string} transcriptPath - the parent session's transcript
 * @param {string} since - ISO timestamp; work at or before this is ignored
 * @returns {number} USD
 */
export function subagentCostSince(transcriptPath, since) {
	const dir = join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");

	let entries;
	try {
		// Workflow-launched agents sit two levels deeper (subagents/workflows/wf_x/agent-y.jsonl),
		// so this must walk the whole tree, not just the immediate children.
		entries = readdirSync(dir, { recursive: true });
	} catch {
		return 0; // no subagents ran in this session
	}

	const sinceMs = Date.parse(since);
	let total = 0;

	for (const entry of entries) {
		// Nested entries come back as relative paths (e.g. "workflows/wf_x/agent-y.jsonl"), so the
		// agent-prefix check must look at the basename, not the whole relative path.
		if (!basename(entry).startsWith("agent-") || !entry.endsWith(".jsonl")) continue;

		const path = join(dir, entry);
		if (statSync(path).mtimeMs < sinceMs) continue;

		for (const turn of dedupeAssistantTurns(readTailRecords(path))) {
			if (turn.timestamp > since) total += turnCost(turn);
		}
	}

	return total;
}
