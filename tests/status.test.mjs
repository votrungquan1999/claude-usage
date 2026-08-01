import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStatusState } from "../src/status.mjs";

/** An assistant record in the shape Claude Code writes. */
function record({ id, cacheRead = 0, cacheCreation = 0, output = 0 }) {
	return {
		type: "assistant",
		requestId: `req_${id}`,
		timestamp: "2026-08-01T10:00:00.000Z",
		message: {
			id: `msg_${id}`,
			model: "claude-opus-5",
			usage: {
				input_tokens: 0,
				cache_read_input_tokens: cacheRead,
				cache_creation_input_tokens: cacheCreation,
				output_tokens: output,
			},
		},
	};
}

const PAYLOAD = {
	model: { id: "claude-opus-5" },
	context_window: { total_input_tokens: 500_000, context_window_size: 1_000_000 },
};

test("warns when a turn rewrites more cache than it reads", () => {
	// Writing costs 1.25-2x base and reading 0.1x, so an invalidated prefix is ~20x worse.
	const state = buildStatusState(PAYLOAD, [
		record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 }),
		record({ id: 2, cacheRead: 5_000, cacheCreation: 100_000 }),
	]);

	assert.deepEqual(state.warnings, ["cache miss"]);
});

test("warns when context is close enough to full that compaction is coming", () => {
	const state = buildStatusState(
		{
			model: { id: "claude-opus-5" },
			context_window: { total_input_tokens: 850_000, context_window_size: 1_000_000 },
		},
		[record({ id: 1, cacheRead: 800_000, cacheCreation: 2_000 })],
	);

	assert.deepEqual(state.warnings, ["compaction near"]);
});

test("takes context from the statusLine payload and turn cost from the transcript", () => {
	// Claude Code reports context size and window itself; only the 5m/1h cache split,
	// which it omits, has to come from the transcript.
	const payload = {
		model: { id: "claude-opus-5" },
		context_window: { total_input_tokens: 438_411, context_window_size: 1_000_000 },
	};
	const records = [
		{
			type: "assistant",
			requestId: "req_a",
			timestamp: "2026-08-01T10:00:00.000Z",
			message: {
				id: "msg_1",
				model: "claude-opus-5",
				usage: {
					input_tokens: 0,
					cache_read_input_tokens: 400_000,
					cache_creation_input_tokens: 0,
					output_tokens: 1_000,
				},
			},
		},
	];

	const state = buildStatusState(payload, records);

	assert.equal(state.contextTokens, 438_411);
	assert.equal(state.contextWindow, 1_000_000);
	assert.equal(state.turnCost.toFixed(4), "0.2250"); // 400K read at 0.5/MTok + 1K out at $25
	assert.equal(state.carryCost.toFixed(4), "0.2192"); // 438411 x $5 x 0.1
	assert.equal(state.priced, true);
});
