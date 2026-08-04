import { expect, test } from "vitest";

import { buildReport } from "../src/report.mjs";

function record({ id, model, output }) {
	return {
		type: "assistant",
		requestId: `req_${id}`,
		timestamp: "2026-08-01T10:00:00.000Z",
		message: {
			id: `msg_${id}`,
			model,
			usage: {
				input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
				output_tokens: output,
			},
		},
	};
}

test("splits session spend by model so a cheap model's share is visible", () => {
	const report = buildReport(
		[
			record({ id: 1, model: "claude-opus-5", output: 1_000 }), // $0.025
			record({ id: 2, model: "claude-opus-5", output: 1_000 }), // $0.025
			record({ id: 3, model: "claude-sonnet-5", output: 1_000 }), // $0.010
		],
		0,
	);

	expect(report.turnCount).toBe(3);
	expect(report.sessionTotal.toFixed(3)).toBe("0.060");
	expect(report.byModel).toStrictEqual([
		{ model: "claude-opus-5", turns: 2, cost: 0.05 },
		{ model: "claude-sonnet-5", turns: 1, cost: 0.01 },
	]);
});
