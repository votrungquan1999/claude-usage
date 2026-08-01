import assert from "node:assert/strict";
import { test } from "node:test";

import { turnCost } from "../src/parser/pricing.mjs";

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

	// $15 input + $1.50 read (0.1x) + $18.75 5m (1.25x) + $30 1h (2.0x) + $75 output
	assert.equal(turnCost(turn), 140.25);
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

	assert.equal(turnCost(turn), 90); // $15 input + $75 output
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
