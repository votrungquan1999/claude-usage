import { expect, test } from "vitest";

import {
	cacheReadRatio,
	formatInstantInTimezone,
	formatLowerBoundCost,
	pivotForChart,
	rankDimensionTotals,
	startOfDayInTimezone,
	subagentCostShare,
} from "./dashboard-format";

test("a fully-priced total renders as a plain dollar amount", () => {
	expect(formatLowerBoundCost(12.5, 0)).toBe("$12.50");
});

test("a total with unpriced events renders as a lower bound (D17)", () => {
	expect(formatLowerBoundCost(412, 18)).toBe("$412.00+ (18 events unpriced)");
});

test("rankDimensionTotals sums a dimension value's cost across days and sorts descending", () => {
	const totals = rankDimensionTotals([
		{ day: "2026-08-01", dimensionValue: "work-mac", costUsd: 1, unpricedEventCount: 0, eventCount: 1 },
		{ day: "2026-08-02", dimensionValue: "work-mac", costUsd: 2, unpricedEventCount: 0, eventCount: 1 },
		{ day: "2026-08-01", dimensionValue: "home-mac", costUsd: 5, unpricedEventCount: 0, eventCount: 1 },
	]);

	expect(totals.map((t) => t.dimensionValue)).toEqual(["home-mac", "work-mac"]);
	expect(totals[1].costUsd).toBe(3);
});

test("pivotForChart folds a dimension value outside topValues into Other", () => {
	const rows = pivotForChart(
		[
			{ day: "2026-08-01", dimensionValue: "work-mac", costUsd: 1, unpricedEventCount: 0, eventCount: 1 },
			{ day: "2026-08-01", dimensionValue: "rare-mac", costUsd: 4, unpricedEventCount: 0, eventCount: 1 },
		],
		["work-mac"],
	);

	expect(rows).toEqual([{ day: "2026-08-01", "work-mac": 1, Other: 4, unpricedEventCount: 0 }]);
});

test("pivotForChart carries a day's unpriced event count so an all-unpriced day is distinguishable from a real zero (R41/D17)", () => {
	const rows = pivotForChart(
		[{ day: "2026-07-01", dimensionValue: "mac", costUsd: 0, unpricedEventCount: 1, eventCount: 1 }],
		["mac"],
	);

	expect(rows[0].unpricedEventCount).toBe(1);
});

function efficiencyRow(overrides: Partial<Parameters<typeof subagentCostShare>[0]> = {}) {
	return {
		day: "2026-08-01",
		totalCostUsd: 0,
		subagentCostUsd: 0,
		totalEventCount: 0,
		subagentEventCount: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
		...overrides,
	};
}

test("subagentCostShare divides subagent cost by total cost", () => {
	expect(subagentCostShare(efficiencyRow({ totalCostUsd: 10, subagentCostUsd: 2.5 }))).toBe(0.25);
});

test("subagentCostShare is null on a day with zero priced cost, never a division by zero", () => {
	expect(subagentCostShare(efficiencyRow({ totalCostUsd: 0, subagentCostUsd: 0 }))).toBeNull();
});

test("subagentCostShare is null (not 0) when a day's only subagent spend is unpriced (R41/D17)", () => {
	const row = efficiencyRow({ totalCostUsd: 10, subagentCostUsd: 0, subagentEventCount: 1 });
	expect(subagentCostShare(row)).toBeNull();
});

test("cacheReadRatio divides reads by total cache activity", () => {
	expect(cacheReadRatio(efficiencyRow({ cacheReadTokens: 300, cacheWrite5mTokens: 100 }))).toBe(0.75);
});

test("cacheReadRatio is null on a day with zero cache activity, never a division by zero", () => {
	expect(cacheReadRatio(efficiencyRow())).toBeNull();
});

test("startOfDayInTimezone rewinds a UTC instant to local midnight in the given timezone (D16/R38)", () => {
	// 2026-06-15T12:00:00Z is 2026-06-15T19:00:00+07:00 local (Asia/Ho_Chi_Minh) — local midnight
	// for that same calendar day is 2026-06-15T00:00:00+07:00, i.e. 2026-06-14T17:00:00Z.
	const result = startOfDayInTimezone(new Date("2026-06-15T12:00:00.000Z"), "Asia/Ho_Chi_Minh");
	expect(result.toISOString()).toBe("2026-06-14T17:00:00.000Z");
});

test("formatInstantInTimezone renders the same calendar day the charts bucket into, not UTC (R38 — one calendar everywhere)", () => {
	// The exact instant from the R38 catalog entry: 17:00:01Z is local midnight+1s (2026-06-02),
	// one calendar day later than its own UTC date (2026-06-01).
	const formatted = formatInstantInTimezone(new Date("2026-06-01T17:00:01.000Z"), "Asia/Ho_Chi_Minh");
	expect(formatted).toBe("2026-06-02 00:00:01");
});
