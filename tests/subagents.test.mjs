import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { subagentCostSince } from "../src/parser/subagents.mjs";

function agentTurn({ id, timestamp, output }) {
	return {
		type: "assistant",
		requestId: `req_${id}`,
		timestamp,
		message: {
			id: `msg_${id}`,
			model: "claude-opus-5",
			usage: {
				input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
				output_tokens: output,
			},
		},
	};
}

test("counts only subagent work done since the previous turn", () => {
	const dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
	const transcript = join(dir, "session.jsonl");
	writeFileSync(transcript, "");

	const subagents = join(dir, "session", "subagents");
	mkdirSync(subagents, { recursive: true });
	writeFileSync(
		join(subagents, "agent-abc.jsonl"),
		`${[
			agentTurn({ id: 1, timestamp: "2026-08-01T09:00:00.000Z", output: 4_000 }),
			agentTurn({ id: 2, timestamp: "2026-08-01T11:00:00.000Z", output: 1_000 }),
		]
			.map((r) => JSON.stringify(r))
			.join("\n")}\n`,
	);

	// Only the 11:00 turn falls after the cutoff: 1000 output tokens at $25/MTok.
	const cost = subagentCostSince(transcript, "2026-08-01T10:00:00.000Z");

	assert.equal(cost.toFixed(4), "0.0250");
});
