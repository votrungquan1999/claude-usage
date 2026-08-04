import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

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

	expect(cost.toFixed(4)).toBe("0.0250");
});

test("counts agents launched inside a workflow, nested two levels under subagents/", () => {
	const dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
	const transcript = join(dir, "session.jsonl");
	writeFileSync(transcript, "");

	// Real layout: subagents/workflows/wf_<id>/agent-<id>.jsonl, with a journal.jsonl sibling
	// that must stay excluded (orchestration bookkeeping). Deliberately hostile fixture: journal.jsonl
	// carries the same assistant-turn payload as agent-nested.jsonl, so if the agent- prefix filter
	// were dropped, the double-counted total would give this test away.
	const workflowDir = join(dir, "session", "subagents", "workflows", "wf_abc");
	mkdirSync(workflowDir, { recursive: true });
	writeFileSync(
		join(workflowDir, "agent-nested.jsonl"),
		`${JSON.stringify(agentTurn({ id: 3, timestamp: "2026-08-01T11:00:00.000Z", output: 1_000 }))}\n`,
	);
	writeFileSync(
		join(workflowDir, "journal.jsonl"),
		`${JSON.stringify(agentTurn({ id: 4, timestamp: "2026-08-01T11:00:00.000Z", output: 1_000 }))}\n`,
	);

	// 1000 output tokens at $25/MTok — 2000 (0.0500) if journal.jsonl were wrongly included.
	const cost = subagentCostSince(transcript, "2026-08-01T10:00:00.000Z");

	expect(cost.toFixed(4)).toBe("0.0250");
});
