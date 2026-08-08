import { expect, test } from "vitest";

import { cacheSavings, isPricedModel, turnCarrySplit, turnCost } from "../src/parser/pricing.mjs";

test("reports whether a model has a known price, so $0 is never mistaken for cheap", () => {
	expect(isPricedModel("claude-opus-5[1m]")).toBe(true);
	expect(isPricedModel("claude-something-unreleased")).toBe(false);
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
	expect(turnCost(turn)).toBe(46.75);
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

	expect(turnCost(turn)).toBe(30); // $5 input + $25 output
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

	expect(turnCost(sonnetTurn("2026-08-31T23:00:00.000Z")), "intro $2/$10").toBe(12);
	expect(turnCost(sonnetTurn("2026-09-01T00:00:00.000Z")), "list $3/$15").toBe(18);
});

test("cache savings separate what reads saved from what the writes cost extra", () => {
	// 1 MTok read + 1 MTok of each write tier, at claude-opus-5's $5/MTok input price.
	const savings = cacheSavings("claude-opus-5", "2026-08-01T10:00:00.000Z", {
		cacheReadTokens: 1_000_000,
		cacheWrite5mTokens: 1_000_000,
		cacheWrite1hTokens: 1_000_000,
	});

	// A read bills at 0.1x, so it saves the other 0.9x: $4.50.
	expect(savings.grossUsd).toBe(4.5);
	// Writes bill at 1.25x and 2.0x; only the surcharge above 1x is what caching cost: $1.25 + $5.
	expect(savings.writePremiumUsd).toBe(6.25);
	expect(savings.netUsd).toBe(-1.75);
});

test("a large one-hour write that is barely read back costs more than it saves (D35)", () => {
	// The shape of 2026-06-11 in the real corpus: 417K tokens written to the 1-hour cache, almost
	// none of it read. Net must stay negative — clamping it to zero would report a real cost as free.
	const savings = cacheSavings("claude-opus-4-7", "2026-06-11T10:00:00.000Z", {
		cacheReadTokens: 23_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 417_000,
	});

	expect(savings.netUsd, `expected a negative net, got ${savings.netUsd}`).toBeLessThan(0);
	expect(savings.grossUsd, "reads still saved something; it just did not cover the write").toBeGreaterThan(0);
});

test("an unknown model reports zero saved, which isPricedModel is what distinguishes from measured zero", () => {
	const savings = cacheSavings("claude-something-unreleased", "2026-08-01T10:00:00.000Z", {
		cacheReadTokens: 1_000_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
	});

	expect(savings).toStrictEqual({ grossUsd: 0, writePremiumUsd: 0, netUsd: 0 });
	expect(isPricedModel("claude-something-unreleased")).toBe(false);
});

test("cache savings follow the price in effect at the time, not today's price", () => {
	// claude-sonnet-5 moves from $2/MTok to $3/MTok on 2026-09-01. The same tokens must price
	// differently either side of that instant, or a local day spanning it is mispriced by 50%.
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	expect(cacheSavings("claude-sonnet-5", "2026-08-31T18:00:00.000Z", tokens).grossUsd).toBe(1.8);
	expect(cacheSavings("claude-sonnet-5", "2026-09-01T10:00:00.000Z", tokens).grossUsd).toBe(2.7);
});

test("splits a turn's cost into carry (cache reads/writes at D3's multipliers) and new (the residual), summing back to the exact cost with no epsilon (card #161 D3/D11)", () => {
	// Same shape as the "prices each cache tier at its own multiplier" turnCost test: 1 MTok in
	// every cache tier, claude-opus-5 at $5/MTok input, $46.75 total turn cost.
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 };
	const costUsd = 46.75;

	const split = turnCarrySplit("claude-opus-5", "2026-08-01T10:00:00.000Z", tokens, costUsd);

	// $0.50 read (0.1x) + $6.25 5m (1.25x) + $10 1h (2.0x) = $16.75 carry; $30 new is the residual.
	expect(split).toStrictEqual({ carryUsd: 16.75, newUsd: 30 });
	expect(split.carryUsd + split.newUsd).toBe(costUsd);
});

test("new is clamped at zero, never negative, when carry alone would exceed the turn's frozen cost (card #161 D11 — a price-table correction can push carry above cost)", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 };
	// $16.75 of carry (same tokens as above), but costUsd frozen at only $1 — carry alone exceeds it.
	const split = turnCarrySplit("claude-opus-5", "2026-08-01T10:00:00.000Z", tokens, 1);

	expect(split.newUsd).toBe(0);
});

test("carry is priced at the turn's own timestamp, not today's rate (card #161 — claude-sonnet-5 reprices 2026-09-01, never sum-then-price)", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// $2/MTok intro rate: 1_000_000 * 0.1 * 2 / 1e6 = $0.20 carry.
	expect(turnCarrySplit("claude-sonnet-5", "2026-08-31T23:00:00.000Z", tokens, 1).carryUsd).toBe(0.2);
	// $3/MTok list rate: 1_000_000 * 0.1 * 3 / 1e6 = $0.30 carry.
	expect(turnCarrySplit("claude-sonnet-5", "2026-09-01T00:00:00.000Z", tokens, 1).carryUsd).toBe(0.3);
});

test("an unknown model contributes zero to both carry and new, even if a stale costUsd was passed in (card #161 — matches turnCost/cacheSavings' own unpriced guard)", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// costUsd deliberately non-zero and non-guarded by the caller, to prove the function itself
	// never lets an unpriced model's untrusted cost leak into "new work".
	const split = turnCarrySplit("claude-something-unreleased", "2026-08-01T10:00:00.000Z", tokens, 9.99);

	expect(split).toStrictEqual({ carryUsd: 0, newUsd: 0 });
});
