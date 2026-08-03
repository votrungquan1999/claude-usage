import assert from "node:assert/strict";
import { test } from "node:test";

import { cacheSavings, isPricedModel, turnCost } from "../src/parser/pricing.mjs";

test("reports whether a model has a known price, so $0 is never mistaken for cheap", () => {
	assert.equal(isPricedModel("claude-opus-5[1m]"), true);
	assert.equal(isPricedModel("claude-something-unreleased"), false);
});

test("prices each cache tier at its own multiplier", () => {
	// One MTok in every bucket, so a wrong multiplier on any one of them shifts the total.
	const turn = {
		requestId: "req",
		messageId: "msg",
		model: "claude-opus-5",
		timestamp: "2026-08-01T10:00:00.000Z",
		usage: {
			input_tokens: 1_000_000,
			cache_read_input_tokens: 1_000_000,
			cache_creation_input_tokens: 2_000_000,
			cache_creation: {
				ephemeral_5m_input_tokens: 1_000_000,
				ephemeral_1h_input_tokens: 1_000_000,
			},
			output_tokens: 1_000_000,
		},
	};

	// $5 input + $0.50 read (0.1x) + $6.25 5m (1.25x) + $10 1h (2.0x) + $25 output
	assert.equal(turnCost(turn), 46.75);
});

test("prices a model string carrying a [1m] suffix", () => {
	// The live session reports `claude-opus-5[1m]`; an unstripped lookup silently costs $0.
	const turn = {
		requestId: "req",
		messageId: "msg",
		model: "claude-opus-5[1m]",
		timestamp: "2026-08-01T10:00:00.000Z",
		usage: {
			input_tokens: 1_000_000,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
			output_tokens: 1_000_000,
		},
	};

	assert.equal(turnCost(turn), 30); // $5 input + $25 output
});

test("uses the price effective at the message's timestamp", () => {
	// Sonnet 5 intro pricing ends 2026-08-31; pricing history must not be repriced by the clock.
	const sonnetTurn = (timestamp) => ({
		requestId: "req",
		messageId: "msg",
		model: "claude-sonnet-5",
		timestamp,
		usage: {
			input_tokens: 1_000_000,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
			output_tokens: 1_000_000,
		},
	});

	assert.equal(turnCost(sonnetTurn("2026-08-31T23:00:00.000Z")), 12, "intro $2/$10");
	assert.equal(turnCost(sonnetTurn("2026-09-01T00:00:00.000Z")), 18, "list $3/$15");
});

test("cache savings separate what reads saved from what the writes cost extra", () => {
	// 1 MTok read + 1 MTok of each write tier, at claude-opus-5's $5/MTok input price.
	const savings = cacheSavings("claude-opus-5", "2026-08-01T10:00:00.000Z", {
		cacheReadTokens: 1_000_000,
		cacheWrite5mTokens: 1_000_000,
		cacheWrite1hTokens: 1_000_000,
	});

	// A read bills at 0.1x, so it saves the other 0.9x: $4.50.
	assert.equal(savings.grossUsd, 4.5);
	// Writes bill at 1.25x and 2.0x; only the surcharge above 1x is what caching cost: $1.25 + $5.
	assert.equal(savings.writePremiumUsd, 6.25);
	assert.equal(savings.netUsd, -1.75);
});

test("a large one-hour write that is barely read back costs more than it saves (D35)", () => {
	// The shape of 2026-06-11 in the real corpus: 417K tokens written to the 1-hour cache, almost
	// none of it read. Net must stay negative — clamping it to zero would report a real cost as free.
	const savings = cacheSavings("claude-opus-4-7", "2026-06-11T10:00:00.000Z", {
		cacheReadTokens: 23_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 417_000,
	});

	assert.ok(savings.netUsd < 0, `expected a negative net, got ${savings.netUsd}`);
	assert.ok(savings.grossUsd > 0, "reads still saved something; it just did not cover the write");
});

test("an unknown model reports zero saved, which isPricedModel is what distinguishes from measured zero", () => {
	const savings = cacheSavings("claude-something-unreleased", "2026-08-01T10:00:00.000Z", {
		cacheReadTokens: 1_000_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
	});

	assert.deepEqual(savings, { grossUsd: 0, writePremiumUsd: 0, netUsd: 0 });
	assert.equal(isPricedModel("claude-something-unreleased"), false);
});

test("cache savings follow the price in effect at the time, not today's price", () => {
	// claude-sonnet-5 moves from $2/MTok to $3/MTok on 2026-09-01. The same tokens must price
	// differently either side of that instant, or a local day spanning it is mispriced by 50%.
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	assert.equal(cacheSavings("claude-sonnet-5", "2026-08-31T18:00:00.000Z", tokens).grossUsd, 1.8);
	assert.equal(cacheSavings("claude-sonnet-5", "2026-09-01T10:00:00.000Z", tokens).grossUsd, 2.7);
});
