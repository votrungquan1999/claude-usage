import assert from "node:assert/strict";
import { test } from "node:test";

import { carryCost, contextSize, sessionTotal } from "../src/parser/session.mjs";

/** A deduped turn, as `dedupeAssistantTurns` returns it. */
function turn({ inputTokens = 0, cacheCreation = 0, cacheRead = 0, outputTokens = 0 }) {
	return {
		requestId: "req",
		messageId: "msg",
		model: "claude-opus-5",
		timestamp: "2026-08-01T10:00:00.000Z",
		usage: {
			input_tokens: inputTokens,
			cache_creation_input_tokens: cacheCreation,
			cache_read_input_tokens: cacheRead,
			output_tokens: outputTokens,
		},
	};
}

test("context size is the last turn's input fields, not a sum across turns", () => {
	// Summing across turns yields cumulative usage — ~15x larger and not a context size.
	const turns = [
		turn({ cacheRead: 100 }),
		turn({ cacheRead: 200 }),
		turn({ inputTokens: 2, cacheCreation: 50, cacheRead: 400 }),
	];

	assert.equal(contextSize(turns), 452);
});

test("session total sums the cost of every deduped turn", () => {
	const turns = [
		turn({ outputTokens: 1_000_000 }), // $75
		turn({ inputTokens: 1_000_000 }), // $15
		turn({ cacheRead: 1_000_000 }), // $1.50 at 0.1x
	];

	assert.equal(sessionTotal(turns).toFixed(2), "91.50");
});

test("carry cost is what the next turn re-reads before you type anything", () => {
	// 1M tokens of context, re-read as a cache hit at 0.1x the $15 input price.
	const turns = [turn({ cacheRead: 1_000_000 })];

	assert.equal(carryCost(turns).toFixed(2), "1.50");
});
