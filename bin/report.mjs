#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { findTranscript } from "../src/locate.mjs";
import { contextWindow } from "../src/parser/models.mjs";
import { readAllRecords } from "../src/parser/read.mjs";
import { subagentCostSince } from "../src/parser/subagents.mjs";
import { buildReport } from "../src/report.mjs";

const projectsRoot = join(homedir(), ".claude", "projects");
const transcript = findTranscript({
	projectsRoot,
	sessionId: process.env.CLAUDE_CODE_SESSION_ID,
	cwd: resolve(process.cwd()),
});

if (!transcript) {
	console.error(`No transcript found under ${projectsRoot}`);
	process.exit(1);
}

const records = readAllRecords(transcript);
const report = buildReport(records, subagentCostSince(transcript, "1970-01-01T00:00:00.000Z"));
const model = report.byModel[0]?.model ?? "unknown";
const window = contextWindow(model);

console.log(`Session   ${transcript.split("/").pop().replace(".jsonl", "")}`);
console.log("");
console.log(
	`Context   ${thousands(report.contextTokens)}${window ? ` / ${thousands(window)} (${((report.contextTokens / window) * 100).toFixed(1)}%)` : ""}`,
);
console.log(`Carry     $${report.carryCost.toFixed(2)} per turn before you type anything`);
console.log("");
console.log(`Turns     ${report.turnCount}`);
console.log(`Session   $${report.sessionTotal.toFixed(2)}`);
if (report.subagentCost > 0) {
	const share = (report.subagentCost / (report.sessionTotal + report.subagentCost)) * 100;
	console.log(`Subagents $${report.subagentCost.toFixed(2)} (${share.toFixed(0)}% of all spend)`);
}
console.log("");
console.log("By model");
for (const entry of report.byModel) {
	console.log(`  ${entry.model.padEnd(22)} ${String(entry.turns).padStart(4)} turns   $${entry.cost.toFixed(2)}`);
}

function thousands(count) {
	return count.toLocaleString("en-US");
}
