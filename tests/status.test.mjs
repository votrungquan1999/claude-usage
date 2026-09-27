import { expect, test } from "vitest";

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

	expect(state.warnings).toStrictEqual(["cache miss"]);
});

test("warns when context is close enough to full that compaction is coming", () => {
	const state = buildStatusState(
		{
			model: { id: "claude-opus-5" },
			context_window: { total_input_tokens: 850_000, context_window_size: 1_000_000 },
		},
		[record({ id: 1, cacheRead: 800_000, cacheCreation: 2_000 })],
	);

	expect(state.warnings).toStrictEqual(["compaction near"]);
});

test("warns when this machine has not reached the server in the last 12 hours", () => {
	const now = new Date("2026-08-01T22:00:00.000Z");
	const lastContactAt = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString(); // 13h ago
	const state = buildStatusState(PAYLOAD, [record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 })], 0, {
		lastContactAt,
		now,
	});

	expect(state.warnings).toStrictEqual(["sync broken"]);
});

test("does not warn when the last contact was within the last 12 hours", () => {
	const now = new Date("2026-08-01T22:00:00.000Z");
	const lastContactAt = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
	const state = buildStatusState(PAYLOAD, [record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 })], 0, {
		lastContactAt,
		now,
	});

	expect(state.warnings).toStrictEqual([]);
});

test("a watermark meaningfully in the future warns instead of silently disabling the alarm forever (card #161 Fix B / R14)", () => {
	// A clock jump, VM snapshot restore, or hand-edited file can leave the watermark ahead of real
	// time. Without a sanity bound, `now - contact` is negative and always looks "fresh" — this is
	// the exact failure the catalog named as reproducing the original incident.
	const now = new Date("2026-08-01T22:00:00.000Z");
	const lastContactAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1h in the future
	const state = buildStatusState(PAYLOAD, [record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 })], 0, {
		lastContactAt,
		now,
	});

	expect(state.warnings).toStrictEqual(["sync broken"]);
});

test("a few seconds of ordinary clock skew in the future does not trigger the alarm (card #161 Fix B)", () => {
	// The fix must not flip a real, healthy machine to "broken" over sub-second/second-scale
	// timing noise between when the watermark was written and when the status line reads "now".
	const now = new Date("2026-08-01T22:00:00.000Z");
	const lastContactAt = new Date(now.getTime() + 5_000).toISOString(); // 5s in the future
	const state = buildStatusState(PAYLOAD, [record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 })], 0, {
		lastContactAt,
		now,
	});

	expect(state.warnings).toStrictEqual([]);
});

test("an unparseable lastContactAt is treated as no data, not as stale, and never throws", () => {
	const now = new Date("2026-08-01T22:00:00.000Z");
	const state = buildStatusState(PAYLOAD, [record({ id: 1, cacheRead: 400_000, cacheCreation: 2_000 })], 0, {
		lastContactAt: "not-a-real-timestamp",
		now,
	});

	expect(state.warnings).toStrictEqual([]);
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

	expect(state.contextTokens).toBe(438_411);
	expect(state.contextWindow).toBe(1_000_000);
	expect(state.turnCost.toFixed(4)).toBe("0.2250"); // 400K read at 0.5/MTok + 1K out at $25
	expect(state.carryCost.toFixed(4)).toBe("0.2192"); // 438411 x $5 x 0.1
	expect(state.priced).toBe(true);
});

test("carry cost on the status line uses the model's own cache-read rate: Opus 5.5 re-reads at 0.05x", () => {
	const payload = {
		model: { id: "claude-opus-5-5[1m]" },
		context_window: { total_input_tokens: 438_411, context_window_size: 1_000_000 },
	};
	const records = [
		{
			type: "assistant",
			requestId: "req_a",
			timestamp: "2026-09-27T10:00:00.000Z",
			message: {
				id: "msg_1",
				model: "claude-opus-5-5[1m]",
				usage: { input_tokens: 0, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 0, output_tokens: 1_000 },
			},
		},
	];

	const state = buildStatusState(payload, records);

	expect(state.carryCost.toFixed(4)).toBe("0.0877"); // 438411 x $4 x 0.05
	expect(state.priced).toBe(true);
});

