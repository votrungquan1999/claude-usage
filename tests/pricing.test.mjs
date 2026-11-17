import { expect, test } from "vitest";

import { cacheReadPrice, cacheSavings, isPricedModel, periodAt, turnCarrySplit, turnCost } from "../src/parser/pricing.mjs";

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

/** One MTok in every bucket, so a wrong rate on any one of them shifts the total. */
function mtokTurn(model, timestamp = "2026-09-27T10:00:00.000Z") {
	return {
		requestId: "req",
		messageId: "msg",
		model,
		timestamp,
		usage: {
			input_tokens: 1_000_000,
			cache_read_input_tokens: 1_000_000,
			cache_creation_input_tokens: 2_000_000,
			cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
			output_tokens: 1_000_000,
		},
	};
}

test("prices Opus 5.5 at $4/$20 with cache reads at 0.05x, not the usual 0.1x", () => {
	// $4 input + $0.20 read (0.05x) + $5 5m (1.25x) + $8 1h (2.0x) + $20 output
	expect(turnCost(mtokTurn("claude-opus-5-5[1m]"))).toBeCloseTo(37.2, 10);
});

test("prices Fable 5.1 at $10/$50 with cache reads at 0.025x", () => {
	// $10 input + $0.25 read (0.025x) + $12.50 5m (1.25x) + $20 1h (2.0x) + $50 output
	expect(turnCost(mtokTurn("claude-fable-5-1"))).toBeCloseTo(92.75, 10);
});

test("prices Sonnet 5.5 at $2/$10 with cache reads at 0.05x", () => {
	// $2 input + $0.10 read (0.05x) + $2.50 5m (1.25x) + $4 1h (2.0x) + $10 output
	expect(turnCost(mtokTurn("claude-sonnet-5-5"))).toBeCloseTo(18.6, 10);
});

test("prices Fable 5.2 at $8/$40 with cache reads at 0.025x", () => {
	// $8 input + $0.20 read (0.025x) + $10 5m (1.25x) + $16 1h (2.0x) + $40 output
	expect(turnCost(mtokTurn("claude-fable-5-2"))).toBeCloseTo(74.2, 10);
});

/** A Haiku 5.5 turn whose prompt (input + cache read + both cache writes) totals `prompt` tokens. */
function haikuTurn(prompt) {
	const share = prompt / 10;
	return {
		requestId: "req",
		messageId: "msg",
		model: "claude-haiku-5-5",
		timestamp: "2026-11-17T10:00:00.000Z",
		usage: {
			input_tokens: share,
			cache_read_input_tokens: share * 5,
			cache_creation_input_tokens: share * 4,
			cache_creation: { ephemeral_5m_input_tokens: share * 2, ephemeral_1h_input_tokens: share * 2 },
			output_tokens: 1_000_000,
		},
	};
}

test("prices a Haiku 5.5 prompt of up to 100K tokens at $0.10/$0.50", () => {
	// 10K input @ $0.10 + 50K read @ $0.01 + 20K 5m @ $0.125 + 20K 1h @ $0.20 + 1M output @ $0.50
	expect(turnCost(haikuTurn(100_000))).toBeCloseTo(0.508, 10);
});

test("prices a whole Haiku 5.5 request at $0.50/$2.50 once its prompt passes 100K tokens, cache hits included", () => {
	// 11K input @ $0.50 + 55K read @ $0.05 + 22K 5m @ $0.625 + 22K 1h @ $1 + 1M output @ $2.50
	expect(turnCost(haikuTurn(110_000))).toBeCloseTo(2.544, 10);
});

test("splits a long-prompt Haiku 5.5 turn at the long-prompt input price", () => {
	const tokens = { cacheReadTokens: 60_000, cacheWrite5mTokens: 22_000, cacheWrite1hTokens: 22_000 };

	// (60K read @ 0.1x + 22K 5m @ 1.25x + 22K 1h @ 2.0x) at $0.50 input
	const split = turnCarrySplit("claude-haiku-5-5", "2026-11-17T10:00:00.000Z", tokens, 1);
	expect(split.carryUsd).toBeCloseTo(0.03875, 10);
	expect(split.newUsd).toBeCloseTo(0.96125, 10);
});

test("re-reads a Haiku 5.5 context past 100K tokens at the long-prompt cache price", () => {
	expect(cacheReadPrice("claude-haiku-5-5", "2026-11-17T10:00:00.000Z", 80_000)).toBeCloseTo(0.01, 10);
	expect(cacheReadPrice("claude-haiku-5-5", "2026-11-17T10:00:00.000Z", 150_000)).toBeCloseTo(0.05, 10);
});

test("prices every model on the published price list, each at its own rate", () => {
	// [model, $ for one MTok in every bucket]: input + read + 1.25x + 2.0x + output
	const expected = [
		["claude-mythos-5-2", 74.2],
		["claude-mythos-5-1", 92.75],
		["claude-mythos-5", 93.5],
		["claude-opus-4-6", 46.75],
		["claude-opus-4-5-20251101", 46.75],
		["claude-opus-4-1-20250805", 140.25],
		["claude-opus-4-20250514", 140.25],
		["claude-sonnet-4-5-20250929", 28.05],
		["claude-sonnet-4-20250514", 28.05],
	];

	for (const [model, cost] of expected) {
		expect([model, turnCost(mtokTurn(model))]).toEqual([model, expect.closeTo(cost, 10)]);
	}
});

test("a price change applies from its date on, so past usage keeps the price it was billed at", () => {
	// No model in the table has a dated change today; this pins the rule every lookup relies on.
	const periods = [
		{ from: "", input: 1 },
		{ from: "2026-09-01", input: 2 },
	];

	expect(periodAt(periods, "2026-08-31T23:59:59.999Z")?.input).toBe(1);
	expect(periodAt(periods, "2026-09-01T00:00:00.000Z")?.input).toBe(2);
	expect(periodAt(periods, "2027-01-01T00:00:00.000Z")?.input).toBe(2);
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

test("keeps Sonnet 5 at $2/$10 after 2026-09-01, since its announced rise to $3/$15 was cancelled", () => {
	// Launch pricing was billed as introductory through 2026-08-31, then made the standard price.
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

	expect(turnCost(sonnetTurn("2026-08-31T23:00:00.000Z")), "before").toBe(12);
	expect(turnCost(sonnetTurn("2026-09-01T00:00:00.000Z")), "after").toBe(12);
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

test("cache savings keep Sonnet 5 at $2/MTok after 2026-09-01, since its scheduled rise was cancelled", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	expect(cacheSavings("claude-sonnet-5", "2026-08-31T18:00:00.000Z", tokens).grossUsd).toBe(1.8);
	expect(cacheSavings("claude-sonnet-5", "2026-09-01T10:00:00.000Z", tokens).grossUsd).toBe(1.8);
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

test("carry keeps Sonnet 5 at $2/MTok after 2026-09-01, since its scheduled rise was cancelled", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// $2/MTok either side: 1_000_000 * 0.1 * 2 / 1e6 = $0.20 carry.
	expect(turnCarrySplit("claude-sonnet-5", "2026-08-31T23:00:00.000Z", tokens, 1).carryUsd).toBe(0.2);
	expect(turnCarrySplit("claude-sonnet-5", "2026-09-01T00:00:00.000Z", tokens, 1).carryUsd).toBe(0.2);
});

test("an unknown model contributes zero to both carry and new, even if a stale costUsd was passed in (card #161 — matches turnCost/cacheSavings' own unpriced guard)", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// costUsd deliberately non-zero and non-guarded by the caller, to prove the function itself
	// never lets an unpriced model's untrusted cost leak into "new work".
	const split = turnCarrySplit("claude-something-unreleased", "2026-08-01T10:00:00.000Z", tokens, 9.99);

	expect(split).toStrictEqual({ carryUsd: 0, newUsd: 0 });
});

test("carry prices Opus 5.5 cache reads at its own 0.05x, not the usual 0.1x", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// 1_000_000 * 0.05 * $4 / 1e6 = $0.20
	expect(turnCarrySplit("claude-opus-5-5", "2026-09-27T10:00:00.000Z", tokens, 1).carryUsd).toBeCloseTo(0.2, 10);
});

test("cache savings credit Opus 5.5 reads with the 95% its 0.05x rate saves", () => {
	const tokens = { cacheReadTokens: 1_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

	// 1_000_000 * $4 * (1 - 0.05) / 1e6 = $3.80
	expect(cacheSavings("claude-opus-5-5", "2026-09-27T10:00:00.000Z", tokens).grossUsd).toBeCloseTo(3.8, 10);
});
