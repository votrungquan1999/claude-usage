import { expect, test } from "vitest";

import {
	assignSeriesColorSlots,
	cacheReadRatio,
	dayKeyInTimezone,
	fillMissingDays,
	formatInstantInTimezone,
	formatLowerBoundCost,
	pivotForChart,
	rankDimensionTotals,
	startOfDayInTimezone,
	subagentCostShare,
	summarizeUnpricedDays,
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

	expect(rows).toEqual([{ day: "2026-08-01", "work-mac": 1, Other: 4, unpricedEventCount: 0, eventCount: 2 }]);
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

test("assignSeriesColorSlots assigns each shown value the palette slot at its position in the domain order (D21)", () => {
	const colors = assignSeriesColorSlots(["work-mac", "home-mac"], ["home-mac", "work-mac"]);

	expect(colors).toEqual({ "home-mac": "var(--chart-1)", "work-mac": "var(--chart-2)" });
});

test("assignSeriesColorSlots gives a value the same colour across two different windows, so widening the window never repaints it (D21)", () => {
	const domainOrder = ["home-mac", "work-mac", "rare-mac"];

	// Narrower window: only home-mac and work-mac show. Wider window: rare-mac now shows too, and
	// the in-window rank order differs (work-mac now outranks home-mac).
	const narrowWindow = assignSeriesColorSlots(["home-mac", "work-mac"], domainOrder);
	const widerWindow = assignSeriesColorSlots(["work-mac", "home-mac", "rare-mac"], domainOrder);

	expect(widerWindow["home-mac"]).toBe(narrowWindow["home-mac"]);
	expect(widerWindow["work-mac"]).toBe(narrowWindow["work-mac"]);
});

test("assignSeriesColorSlots gives a shown value ranked beyond the palette size the lowest unclaimed slot, so two shown series never collide (D21)", () => {
	// "overflow" ranks 6th in the 365-day domain (index 5) — beyond the 5-slot palette — but is
	// nonetheless shown in THIS window (e.g. it spiked recently). "a" claims slot 0 first.
	const domainOrder = ["a", "b", "c", "d", "e", "overflow"];

	const colors = assignSeriesColorSlots(["a", "overflow"], domainOrder);

	expect(colors.a).toBe("var(--chart-1)");
	expect(colors.overflow).toBe("var(--chart-2)");
});

test("fillMissingDays inserts an absent day between two present days without altering them (D11/D24)", () => {
	const rows = [
		{ day: "2026-06-01", value: 1 },
		{ day: "2026-06-03", value: 3 },
	];

	const filled = fillMissingDays(rows, "2026-06-01", "2026-06-03", (day) => ({ day, value: 0 }));

	expect(filled).toEqual([
		{ day: "2026-06-01", value: 1 },
		{ day: "2026-06-02", value: 0 },
		{ day: "2026-06-03", value: 3 },
	]);
});

test("dayKeyInTimezone reads an instant's day in the dashboard's zone, not UTC (R38/D16)", () => {
	// 17:30 UTC on 2026-06-30 is already 00:30 on 2026-07-01 in Asia/Ho_Chi_Minh (UTC+7). Gap fill
	// bounds must come from the same calendar the chart buckets by, or the first/last bar is wrong.
	expect(dayKeyInTimezone(new Date("2026-06-30T17:30:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-07-01");
});

test("pivotForChart carries a day's event count so a gap-filled day stays distinguishable from a recorded one (D24)", () => {
	const rows = pivotForChart(
		[
			{ day: "2026-08-01", dimensionValue: "work-mac", costUsd: 1, unpricedEventCount: 0, eventCount: 4 },
			{ day: "2026-08-01", dimensionValue: "rare-mac", costUsd: 4, unpricedEventCount: 0, eventCount: 3 },
		],
		["work-mac"],
	);

	expect(rows[0].eventCount).toBe(7);
});

test("fillMissingDays never overwrites a real day, so a lower-bound warning survives the fill (D24)", () => {
	const rows = [{ day: "2026-06-02", unpricedEventCount: 7, costUsd: 12.5 }];

	const filled = fillMissingDays(rows, "2026-06-01", "2026-06-03", (day) => ({
		day,
		unpricedEventCount: 0,
		costUsd: 0,
	}));

	expect(filled).toEqual([
		{ day: "2026-06-01", unpricedEventCount: 0, costUsd: 0 },
		{ day: "2026-06-02", unpricedEventCount: 7, costUsd: 12.5 },
		{ day: "2026-06-03", unpricedEventCount: 0, costUsd: 0 },
	]);
});

test("summarizeUnpricedDays reports nothing when no day has an unpriced event", () => {
	const summary = summarizeUnpricedDays([
		{ day: "2026-08-01", unpricedEventCount: 0, eventCount: 1, "work-mac": 1 },
		{ day: "2026-08-02", unpricedEventCount: 0, eventCount: 1, "work-mac": 2 },
	]);

	expect(summary).toEqual({ days: [], dayCount: 0, eventCount: 0 });
});

test("summarizeUnpricedDays lists the affected days and sums events across them (D5)", () => {
	const summary = summarizeUnpricedDays([
		{ day: "2026-08-01", unpricedEventCount: 3, eventCount: 3, "work-mac": 1 },
		{ day: "2026-08-02", unpricedEventCount: 0, eventCount: 5, "work-mac": 2 },
		{ day: "2026-08-03", unpricedEventCount: 2, eventCount: 2, "work-mac": 1 },
	]);

	expect(summary).toEqual({ days: ["2026-08-01", "2026-08-03"], dayCount: 2, eventCount: 5 });
});

test("summarizeUnpricedDays includes a fully-unpriced day (zero priced cost, zero-height bar) — it must not be invisible twice over", () => {
	const summary = summarizeUnpricedDays([{ day: "2026-07-01", unpricedEventCount: 4, eventCount: 4 }]);

	expect(summary.days).toEqual(["2026-07-01"]);
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
