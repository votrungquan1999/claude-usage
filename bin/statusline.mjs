#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { formatStatusLine } from "../src/format.mjs";
import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";
import { readTailRecords } from "../src/parser/read.mjs";
import { subagentCostSince } from "../src/parser/subagents.mjs";
import { buildStatusState } from "../src/status.mjs";

// A broken readout must never break the prompt: on any failure print nothing and exit 0.
try {
	const payload = JSON.parse(readFileSync(0, "utf8"));
	const transcript = payload.transcript_path;
	const records = transcript ? readTailRecords(transcript) : [];

	// Subagents that ran during this turn started after the previous turn ended.
	const previousTurn = dedupeAssistantTurns(records).at(-2);
	const subagentCost =
		transcript && previousTurn ? subagentCostSince(transcript, previousTurn.timestamp) : 0;

	process.stdout.write(formatStatusLine(buildStatusState(payload, records, subagentCost)));
} catch {
	process.exit(0);
}
