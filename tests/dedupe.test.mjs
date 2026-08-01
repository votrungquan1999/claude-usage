import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";

/** Minimal assistant record in the shape Claude Code writes to its JSONL. */
function assistantRecord({ requestId, messageId, outputTokens }) {
	return {
		type: "assistant",
		requestId,
		timestamp: "2026-08-01T10:00:00.000Z",
		message: {
			id: messageId,
			model: "claude-opus-5",
			usage: {
				input_tokens: 2,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 435784,
				output_tokens: outputTokens,
			},
		},
	};
}

test("collapses streaming copies of one message to the MAX output_tokens", () => {
	// Claude Code rewrites the same message as it streams; early copies hold partial counts.
	const records = [
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 7 }),
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 289 }),
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 1505 }),
	];

	const turns = dedupeAssistantTurns(records);

	assert.equal(turns.length, 1, "three copies of one message must collapse to one turn");
	assert.equal(turns[0].usage.output_tokens, 1505);
});
