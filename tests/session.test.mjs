import { expect, test } from "vitest";

import { carryCost, contextSize, sessionTotal } from "../src/parser/session.mjs";

/** A deduped turn, as `dedupeAssistantTurns` returns it. */
function turn({
	inputTokens = 0,
	cacheCreation = 0,
	cacheRead = 0,
	outputTokens = 0,
	model = "claude-opus-5",
	timestamp = "2026-08-01T10:00:00.000Z",
}) {
	return {
		requestId: "req",
		messageId: "msg",
		model,
		timestamp,
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

	expect(contextSize(turns)).toBe(452);
});

test("session total sums the cost of every deduped turn", () => {
	const turns = [
		turn({ outputTokens: 1_000_000 }), // $25
		turn({ inputTokens: 1_000_000 }), // $5
		turn({ cacheRead: 1_000_000 }), // $0.50 at 0.1x
	];

	expect(sessionTotal(turns).toFixed(2)).toBe("30.50");
});

test("carry cost is what the next turn re-reads before you type anything", () => {
	// 1M tokens of context, re-read as a cache hit at 0.1x the $5 input price.
	const turns = [turn({ cacheRead: 1_000_000 })];

	expect(carryCost(turns).toFixed(2)).toBe("0.50");
});

test("context size and carry cost still reflect the last real turn after a trailing API-error placeholder", () => {
	// Claude Code appends an all-zero-usage "<synthetic>" turn on an API error; it must not be
	// read as "the last turn" or the status line zeroes out right when it matters most.
	// Real transcripts have been observed with trailing runs of these up to 2 long, so a
	// one-step-back implementation would pass a single trailing synthetic but fail here.
	const turns = [
		turn({ cacheRead: 1_000_000 }),
		turn({ model: "<synthetic>", timestamp: "2026-08-01T10:00:01.000Z" }),
		turn({ model: "<synthetic>", timestamp: "2026-08-01T10:00:02.000Z" }),
	];

	expect(contextSize(turns)).toBe(1_000_000);
	expect(carryCost(turns).toFixed(2)).toBe("0.50");
});
