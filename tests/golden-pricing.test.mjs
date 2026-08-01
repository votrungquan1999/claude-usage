import assert from "node:assert/strict";
import { test } from "node:test";

import { turnCost } from "../src/parser/pricing.mjs";

/**
 * Real per-model day totals from `npx ccusage daily --json`, captured 2026-08-01.
 *
 * These three models showed an implied cache-creation multiplier of exactly 1.25 on every
 * observed day, so their cache writes were all 5m and the cost reproduces exactly. Opus is
 * checked separately — ccusage reports cache creation as one aggregate, so its 5m/1h split
 * is unrecoverable and only a bound is assertable.
 */
const GOLDEN = [
	{
		day: "2026-07-02",
		model: "claude-sonnet-5",
		input: 362_479,
		cacheRead: 16_970_179,
		cacheWrite5m: 1_347_320,
		output: 134_465,
		cost: 8.8319438,
	},
	{
		day: "2026-06-17",
		model: "claude-haiku-4-5-20251001",
		input: 95,
		cacheRead: 1_652_953,
		cacheWrite5m: 117_319,
		output: 7_264,
		cost: 0.34835905,
	},
	{
		day: "2026-07-12",
		model: "claude-fable-5",
		input: 242,
		cacheRead: 11_624_655,
		cacheWrite5m: 1_119_473,
		output: 186_718,
		cost: 34.9563875,
	},
];

function turnFrom({ model, day, input, cacheRead, cacheWrite5m, cacheWrite1h = 0, output }) {
	return {
		requestId: "req",
		messageId: "msg",
		model,
		timestamp: `${day}T12:00:00.000Z`,
		usage: {
			input_tokens: input,
			cache_read_input_tokens: cacheRead,
			cache_creation_input_tokens: cacheWrite5m + cacheWrite1h,
			cache_creation: {
				ephemeral_5m_input_tokens: cacheWrite5m,
				ephemeral_1h_input_tokens: cacheWrite1h,
			},
			output_tokens: output,
		},
	};
}

for (const golden of GOLDEN) {
	test(`reproduces ccusage cost for ${golden.model} on ${golden.day}`, () => {
		assert.equal(turnCost(turnFrom(golden)).toFixed(6), golden.cost.toFixed(6));
	});
}

test("prices Opus 5 within the bound ccusage implies", () => {
	// Real day totals for claude-opus-5 on 2026-07-30, cost $254.7519155.
	const day = {
		day: "2026-07-30",
		model: "claude-opus-5",
		input: 5_087,
		cacheRead: 259_728_906,
		output: 897_317,
	};
	const creation = 10_800_431;

	const allFiveMinute = turnCost(turnFrom({ ...day, cacheWrite5m: creation }));
	const allOneHour = turnCost(turnFrom({ ...day, cacheWrite5m: 0, cacheWrite1h: creation }));

	// The true 5m/1h split is unknown, but the real cost must sit between the two extremes.
	assert.ok(allFiveMinute < 254.7519155, `all-5m floor was ${allFiveMinute}`);
	assert.ok(allOneHour > 254.7519155, `all-1h ceiling was ${allOneHour}`);
});
