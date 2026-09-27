import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { dedupeAssistantTurns } from "./dedupe.mjs";
import { turnCost } from "./pricing.mjs";
import { readAllRecords, readTailRecords } from "./read.mjs";

const TAIL_BYTES = 262_144;

/**
 * What subagents spent since a cutoff.
 *
 * Subagent transcripts sit one level deeper than the session's own, and a single session's
 * can run to 85MB — so files untouched since the cutoff are skipped on mtime alone, and the
 * rest are tail-read, falling back to a full read only when the tail starts after the cutoff.
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
		const stat = statSync(path);
		if (stat.mtimeMs < sinceMs) continue;

		// The tail holds everything after the cutoff only if it reaches back past it; a
		// whole-session ask on a long agent would otherwise drop its early turns.
		let records = readTailRecords(path, TAIL_BYTES);
		if (stat.size > TAIL_BYTES && !(earliestTimestamp(records) <= since)) records = readAllRecords(path);

		for (const turn of dedupeAssistantTurns(records)) {
			if (turn.timestamp > since) total += turnCost(turn);
		}
	}

	return total;
}

/** The oldest timestamp among records, or undefined when none carries one. */
function earliestTimestamp(records) {
	let earliest;
	for (const record of records) {
		if (typeof record.timestamp !== "string") continue;
		if (earliest === undefined || record.timestamp < earliest) earliest = record.timestamp;
	}
	return earliest;
}
