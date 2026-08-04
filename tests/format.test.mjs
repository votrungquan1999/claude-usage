import { expect, test } from "vitest";

import { formatStatusLine } from "../src/format.mjs";

test("renders context, last turn and carry as one line", () => {
	const line = formatStatusLine({
		contextTokens: 438_411,
		contextWindow: 1_000_000,
		turnCost: 0.2818,
		subagentCost: 0,
		carryCost: 0.2192,
		priced: true,
		warnings: [],
	});

	expect(line).toBe("◐ 43.8% (438K/1M) · turn $0.28 · carry $0.22/turn");
});

test("breaks subagent spend out of the turn cost rather than folding it in", () => {
	const line = formatStatusLine({
		contextTokens: 438_411,
		contextWindow: 1_000_000,
		turnCost: 0.2818,
		subagentCost: 0.11,
		carryCost: 0.2192,
		priced: true,
		warnings: [],
	});

	expect(line).toBe("◐ 43.8% (438K/1M) · turn $0.28 (+$0.11 sub) · carry $0.22/turn");
});

test("appends warnings without displacing the figures", () => {
	const line = formatStatusLine({
		contextTokens: 438_411,
		contextWindow: 1_000_000,
		turnCost: 0.2818,
		subagentCost: 0,
		carryCost: 0.2192,
		priced: true,
		warnings: ["cache miss"],
	});

	expect(line).toBe("◐ 43.8% (438K/1M) · turn $0.28 · carry $0.22/turn · ⚠ cache miss");
});

test("shows ? rather than $0.00 when a model has no known price", () => {
	const line = formatStatusLine({
		contextTokens: 438_411,
		contextWindow: 1_000_000,
		turnCost: 0,
		subagentCost: 0,
		carryCost: 0,
		priced: false,
		warnings: ["unknown model"],
	});

	expect(line).toBe("◐ 43.8% (438K/1M) · turn $? · carry $?/turn · ⚠ unknown model");
});
