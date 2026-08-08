#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { formatStatusLine } from "../src/format.mjs";
import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";
import { readTailRecords } from "../src/parser/read.mjs";
import { subagentCostSince } from "../src/parser/subagents.mjs";
import { buildStatusState } from "../src/status.mjs";

/**
 * This machine's own sync watermark (Step 1), or `{}` on any failure. Its OWN try/catch, distinct
 * from the outer one below: that one blanks the WHOLE status line on any throw, but a missing or
 * corrupt watermark file must only suppress the staleness warning, not the rest of the line.
 */
function readSyncWatermark(home) {
	try {
		return JSON.parse(readFileSync(join(home, ".claude", "claude-usage-state", "sync-watermark.json"), "utf8"));
	} catch {
		return {};
	}
}

// A broken readout must never break the prompt: on any failure print nothing and exit 0.
try {
	const payload = JSON.parse(readFileSync(0, "utf8"));
	const transcript = payload.transcript_path;
	const records = transcript ? readTailRecords(transcript) : [];

	// Subagents that ran during this turn started after the previous turn ended.
	const previousTurn = dedupeAssistantTurns(records).at(-2);
	const subagentCost =
		transcript && previousTurn ? subagentCostSince(transcript, previousTurn.timestamp) : 0;

	const watermark = readSyncWatermark(homedir());
	const sync = { lastContactAt: watermark.lastContactAt, now: new Date() };

	process.stdout.write(formatStatusLine(buildStatusState(payload, records, subagentCost, sync)));
} catch {
	process.exit(0);
}
