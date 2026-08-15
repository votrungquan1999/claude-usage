import { expect, test } from "vitest";

import { UNATTRIBUTED_DIMENSION_VALUE } from "@/server/usage-queries";

import {
	assignSeriesColorSlots,
	bucketAxisTick,
	colorDomainWindow,
	dayKeyInTimezone,
	endOfDayInTimezone,
	evaluateMachineSyncStatus,
	machineDisplayName,
	shortenMachineId,
	bucketTurnDollars,
	buildTurnTimeline,
	fillMissingBuckets,
	formatInstantInTimezone,
	formatLowerBoundCost,
	formatSavingsStatement,
	modelMixByDay,
	monthProgressInTimezone,
	planTurnBuckets,
	projectMonthEndCost,
	type TurnBuckets,
	type TurnBucketRow,
	rollUpDailySavings,
	parseDashboardRange,
	pivotForChart,
	planDayBuckets,
	relabelRowsToBuckets,
	rankDimensionTotals,
	startOfDayInTimezone,
	startOfMonthInTimezone,
	summarizeMonthToDate,
	subagentCostShare,
	summarizeUnpricedDays,
	isMainSeriesEmptyWithSubagentActivity,
	turnBucketTooltipLabel,
	turnTimelineDivergenceNote,
	turnTimelineEmptyStateCopy,
	turnTimelineTotalUsd,
} from "./dashboard-format";

test("flags a machine stale when its last contact was more than 12h ago", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-stale", lastContactAt: new Date(now - 13 * 60 * 60 * 1000), lastAcceptedAt: null, name: null }],
		now,
		"UTC",
	);

	expect(rows).toStrictEqual([
		{
			machineId: "machine-stale",
			name: null,
			lastContact: "2026-08-01 09:00:00",
			lastAccepted: "never",
			stale: true,
		},
	]);
});

test("carries lastAcceptedAt through to the view, not just lastContactAt (card #161 Batch A fix pass, Fix 1 — D4's second timestamp was silently dropped before it reached the UI)", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const lastAcceptedAt = new Date(now - 2 * 60 * 60 * 1000);
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-worked", lastContactAt: new Date(now - 60 * 1000), lastAcceptedAt, name: null }],
		now,
		"UTC",
	);

	expect(rows[0].lastAccepted).toBe("2026-08-01 20:00:00");
});

test("flags a machine whose last contact is meaningfully in the future as stale, instead of silently reading as fresh forever (card #161 adversarial fix pass F1, dashboard half — R14/R5)", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-future", lastContactAt: new Date(now + 60 * 60 * 1000), lastAcceptedAt: null, name: null }],
		now,
		"UTC",
	);

	expect(rows[0].stale).toBe(true);
});

test("a few seconds of ordinary clock skew in the future does not flag the machine as stale (card #161 adversarial fix pass F1, dashboard half — matches src/status.mjs's CLOCK_SKEW_TOLERANCE_MS so the two signals agree at the boundary)", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-skew", lastContactAt: new Date(now + 5 * 1000), lastAcceptedAt: null, name: null }],
		now,
		"UTC",
	);

	expect(rows[0].stale).toBe(false);
});

test("does not flag a machine whose last contact was within 12h", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-fresh", lastContactAt: new Date(now - 1 * 60 * 60 * 1000), lastAcceptedAt: null, name: null }],
		now,
		"UTC",
	);

	expect(rows[0].stale).toBe(false);
});

test("evaluateMachineSyncStatus renders a null lastContactAt/lastAcceptedAt as the literal string \"never\" (card #161 Batch A fix pass, Fix 4 — D13's null-to-\"never\" decision now lives here, not in the untestable display component, so a unit test can actually assert it)", () => {
	const now = new Date("2026-08-01T22:00:00.000Z").getTime();
	const rows = evaluateMachineSyncStatus(
		[{ machineId: "machine-unrecorded", lastContactAt: null, lastAcceptedAt: null, name: null }],
		now,
		"UTC",
	);

	expect(rows).toStrictEqual([
		{ machineId: "machine-unrecorded", name: null, lastContact: "never", lastAccepted: "never", stale: false },
	]);
});

test("shortenMachineId reads as the first 8 characters of a 64-char hex machine id (card #170 D7)", () => {
	const machineId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";

	expect(shortenMachineId(machineId)).toBe("0ddfda8e");
});

test("shortenMachineId leaves a short id exactly as it was, never padding or otherwise lengthening it (card #170 D18/R18 — the README setup probe posts machineId \"probe\")", () => {
	expect(shortenMachineId("probe")).toBe("probe");
});

test("machineDisplayName shows the nickname when one is set, not the machine id (card #170 D1)", () => {
	const machineId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";

	expect(machineDisplayName("Studio", machineId)).toBe("Studio");
});

test("machineDisplayName falls back to the shortened machine id when no nickname is set (card #170 D6 — the fallback the mobile layout ships against before naming exists)", () => {
	const machineId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";

	expect(machineDisplayName(undefined, machineId)).toBe("0ddfda8e");
});

test("machineDisplayName treats an empty or whitespace-only nickname as ABSENT, not as a literal empty label (D14 — clearing a name falls back to the short id, same as never having one)", () => {
	const machineId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";

	expect(machineDisplayName("", machineId)).toBe("0ddfda8e");
	expect(machineDisplayName("   ", machineId)).toBe("0ddfda8e");
});

test("machineDisplayName never shortens the (unattributed) sentinel, and shows no nickname for it — it is not a machine (R17, adversarial revalidation fix)", () => {
	expect(machineDisplayName(undefined, UNATTRIBUTED_DIMENSION_VALUE)).toBe(UNATTRIBUTED_DIMENSION_VALUE);
	// Even a stray nickname keyed under the sentinel's own text (should never happen — real
	// machine ids are hex, never this literal string) must not surface as this row's name.
	expect(machineDisplayName("Some Nickname", UNATTRIBUTED_DIMENSION_VALUE)).toBe(UNATTRIBUTED_DIMENSION_VALUE);
});

test("machineDisplayName still shows a REAL machine's nickname even when that nickname is literally \"(unattributed)\" — the sentinel guard keys on the machine id, not the nickname text, so a deliberately-named machine stays distinct from the missing-machineId bucket (R5)", () => {
	const machineId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";

	expect(machineDisplayName(UNATTRIBUTED_DIMENSION_VALUE, machineId)).toBe(UNATTRIBUTED_DIMENSION_VALUE);
});

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
		unpricedEventCount: 0,
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

test("fillMissingBuckets inserts an absent day between two present days without altering them (D11/D24)", () => {
	const rows = [
		{ day: "2026-06-01", value: 1 },
		{ day: "2026-06-03", value: 3 },
	];

	const filled = fillMissingBuckets(rows, planDayBuckets("2026-06-01", "2026-06-03"), (day) => ({ day, value: 0 }));

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

test("fillMissingBuckets never overwrites a real day, so a lower-bound warning survives the fill (D24)", () => {
	const rows = [{ day: "2026-06-02", unpricedEventCount: 7, costUsd: 12.5 }];

	const filled = fillMissingBuckets(rows, planDayBuckets("2026-06-01", "2026-06-03"), (day) => ({
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

/** UTC+7, so a local day starts at 17:00Z the previous calendar day. */
const TZ = "Asia/Ho_Chi_Minh";
/** 2026-08-03 17:00 local — mid-afternoon, well clear of either midnight boundary. */
const NOW = new Date("2026-08-03T10:00:00.000Z");
/** The real corpus's first day, far enough back that the D36 clamp is a no-op for short presets. */
const EARLIEST = new Date("2026-05-30T02:00:00.000Z");

test("an empty URL selects the default 30-day window, ending now and starting at a local midnight", () => {
	const view = parseDashboardRange(new URLSearchParams(), NOW, EARLIEST, TZ);

	// 30 calendar days COUNTING today, so the chart draws 30 bars under a "last 30 days" label:
	// 2026-07-05 is 29 days before 2026-08-03, and its local midnight is 17:00Z the day before.
	expect(view.range.from.toISOString()).toBe("2026-07-04T17:00:00.000Z");
	expect(view.range.to).toEqual(NOW);
});

test("a preset in the URL selects that window, counting today as its last day", () => {
	const view = parseDashboardRange(new URLSearchParams("preset=7d"), NOW, EARLIEST, TZ);

	// 2026-07-28 through 2026-08-03 inclusive is 7 days; its local midnight is 17:00Z the day before.
	expect(view.range.from.toISOString()).toBe("2026-07-27T17:00:00.000Z");
	expect(view.preset).toBe("7d");
});

test("the all-time preset starts at the earliest recorded event, so the query still carries a bound (D36)", () => {
	const view = parseDashboardRange(new URLSearchParams("preset=all"), NOW, EARLIEST, TZ);

	// Local midnight of the earliest event's own local day (2026-05-30), not the raw event instant —
	// a partial first bar would misreport that day's spend.
	expect(view.range.from.toISOString()).toBe("2026-05-29T17:00:00.000Z");
	expect(view.fellBack).toBe(false);
});

test("all-time on an empty corpus falls back to the default window and says so (D36/D37)", () => {
	const view = parseDashboardRange(new URLSearchParams("preset=all"), NOW, null, TZ);

	expect(view.preset).toBe("30d");
	expect(view.range.from.toISOString()).toBe("2026-07-04T17:00:00.000Z");
	expect(view.fellBack).toBe(true);
});

test("a preset this app does not offer falls back to the default window and says so (D37)", () => {
	const view = parseDashboardRange(new URLSearchParams("preset=5y"), NOW, EARLIEST, TZ);

	expect(view.preset).toBe("30d");
	expect(view.range.from.toISOString()).toBe("2026-07-04T17:00:00.000Z");
	// A silently corrected parameter is a lie about which period is on screen.
	expect(view.fellBack).toBe(true);
});

test("a window is clamped so it never reaches back before the first recorded event (D36)", () => {
	// 90 days before 2026-08-03 is early May, but nothing was recorded before 2026-05-30 — without
	// the clamp, gap fill would synthesize ~25 rows for days the corpus never covered.
	const view = parseDashboardRange(new URLSearchParams("preset=90d"), NOW, EARLIEST, TZ);

	expect(view.range.from.toISOString()).toBe("2026-05-29T17:00:00.000Z");
	// The clamp narrows the window; it is not a fallback, so the page has nothing to announce.
	expect(view.preset).toBe("90d");
	expect(view.fellBack).toBe(false);
});

test("the active split tab is read from the URL, so a view is shareable (D8)", () => {
	expect(parseDashboardRange(new URLSearchParams("tab=model"), NOW, EARLIEST, TZ).tab).toBe("model");
});

test("a tab naming a field the app never splits by is rejected, not passed through to a query (D30)", () => {
	// `costPerDay` interpolates the tab's dimension straight into `$group` as a field name, so an
	// open `?tab=` would let a URL split spend by an internal identity field. Closed allowlist.
	expect(parseDashboardRange(new URLSearchParams("tab=requestId"), NOW, EARLIEST, TZ).tab).toBe("machine");
	expect(parseDashboardRange(new URLSearchParams("tab=accountUuid"), NOW, EARLIEST, TZ).tab).toBe("machine");
});

test("endOfDayInTimezone bounds a day at its last millisecond, so a range ending in the past stops there", () => {
	// A custom range ending 2026-07-15 must include all of that local day and nothing after it.
	// Local midnight on the 16th is 17:00Z on the 15th, so the inclusive bound is 1ms earlier.
	expect(endOfDayInTimezone(new Date("2026-07-15T05:00:00.000Z"), TZ).toISOString()).toBe("2026-07-15T16:59:59.999Z");
});

test("an explicit from/to pair selects exactly those local days, end included", () => {
	const view = parseDashboardRange(new URLSearchParams("from=2026-07-01&to=2026-07-15"), NOW, EARLIEST, TZ);

	expect(view.range.from.toISOString()).toBe("2026-06-30T17:00:00.000Z");
	expect(view.range.to.toISOString()).toBe("2026-07-15T16:59:59.999Z");
	expect(view.preset).toBe("custom");
	expect(view.fellBack).toBe(false);
});

test("a from/to pair that runs backwards falls back to the default window and says so (D37)", () => {
	const view = parseDashboardRange(new URLSearchParams("from=2026-07-15&to=2026-07-01"), NOW, EARLIEST, TZ);

	expect(view.preset).toBe("30d");
	expect(view.range.from.toISOString()).toBe("2026-07-04T17:00:00.000Z");
	expect(view.fellBack).toBe(true);
});

test("a half-written or unparseable date pair falls back and says so, rather than guessing the other end (D37)", () => {
	const halfPair = parseDashboardRange(new URLSearchParams("from=2026-07-01"), NOW, EARLIEST, TZ);
	expect(halfPair.preset).toBe("30d");
	expect(halfPair.fellBack).toBe(true);

	const notADate = parseDashboardRange(new URLSearchParams("from=july&to=2026-07-15"), NOW, EARLIEST, TZ);
	expect(notADate.preset).toBe("30d");
	expect(notADate.fellBack).toBe(true);

	// Well-formed but not a real day. `new Date` rolls this to 2026-03-03 rather than rejecting it.
	const noSuchDay = parseDashboardRange(new URLSearchParams("from=2026-02-31&to=2026-07-15"), NOW, EARLIEST, TZ);
	expect(noSuchDay.preset).toBe("30d");
	expect(noSuchDay.fellBack).toBe(true);
});

test("a custom range is held inside the recorded corpus at both ends (D36)", () => {
	// Without the clamp this asks gap fill to synthesize a row per day from 1970 to 2099.
	const view = parseDashboardRange(new URLSearchParams("from=1970-01-01&to=2099-12-31"), NOW, EARLIEST, TZ);

	expect(view.range.from.toISOString()).toBe("2026-05-29T17:00:00.000Z");
	expect(view.range.to).toEqual(NOW);
});

test("preset=custom is rejected as input — it names no window of its own", () => {
	const view = parseDashboardRange(new URLSearchParams("preset=custom"), NOW, EARLIEST, TZ);

	expect(view.preset).toBe("30d");
	expect(view.fellBack).toBe(true);
});

test("the colour domain always reaches back at least a year, so a short window does not re-rank the palette (D21)", () => {
	const nowMs = NOW.getTime();
	const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;

	const domain = colorDomainWindow(sevenDaysAgoMs, nowMs);

	expect(domain.fromMs).toBe(nowMs - 365 * 24 * 60 * 60 * 1000);
	expect(domain.toMs).toBe(nowMs);
});

test("the colour domain stretches to cover a window longer than the lookback, so its oldest values stay ranked (D41)", () => {
	const nowMs = NOW.getTime();
	const twoYearsAgoMs = nowMs - 730 * 24 * 60 * 60 * 1000;

	const domain = colorDomainWindow(twoYearsAgoMs, nowMs);

	expect(domain.fromMs).toBe(twoYearsAgoMs);
});

test("startOfMonthInTimezone anchors month-to-date at local midnight on the 1st", () => {
	// Local midnight on 2026-08-01 in UTC+7 is 17:00Z the previous day — using UTC midnight instead
	// would silently drop the first seven hours of the month from every KPI.
	expect(startOfMonthInTimezone(NOW, TZ).toISOString()).toBe("2026-07-31T17:00:00.000Z");
});

test("monthProgressInTimezone counts only days that have fully ended, so today never dilutes the rate (D13)", () => {
	// 2026-08-03: the 1st and 2nd have ended; today has not. August has 31 days.
	expect(monthProgressInTimezone(NOW, TZ)).toEqual({ completeElapsedDays: 2, daysInMonth: 31 });
});

test("projectMonthEndCost extends the daily rate over the whole month (D13)", () => {
	// $100 across 2 complete days is $50/day; August has 31.
	expect(projectMonthEndCost(100, 2, 31)).toBe(1550);
});

test("projectMonthEndCost is null on the 1st of the month, never a division by zero (D42)", () => {
	// A guaranteed monthly event: on the 1st no day has ended, so there is no rate to extend.
	expect(projectMonthEndCost(42, 0, 31)).toBeNull();
});

test("summarizeMonthToDate separates today's figures from the month's, so one unpriced day does not taint both", () => {
	const summary = summarizeMonthToDate(
		[
			efficiencyRow({ day: "2026-08-01", totalCostUsd: 10, unpricedEventCount: 0 }),
			efficiencyRow({ day: "2026-08-02", totalCostUsd: 20, unpricedEventCount: 0 }),
			efficiencyRow({ day: "2026-08-03", totalCostUsd: 5, unpricedEventCount: 3 }),
		],
		"2026-08-03",
	);

	expect(summary).toEqual({
		todayCostUsd: 5,
		todayUnpricedEventCount: 3,
		monthCostUsd: 35,
		monthUnpricedEventCount: 3,
	});
});

test("summarizeMonthToDate reads an absent today as zero spend, not as missing data", () => {
	// Early enough in the morning, today has no row at all — the query only returns days with events.
	const summary = summarizeMonthToDate([efficiencyRow({ day: "2026-08-01", totalCostUsd: 10 })], "2026-08-03");

	expect(summary.todayCostUsd).toBe(0);
	expect(summary.monthCostUsd).toBe(10);
});

test("the repo split is a recognised tab, and still nothing outside the allowlist is (D30)", () => {
	expect(parseDashboardRange(new URLSearchParams("tab=repo"), NOW, EARLIEST, TZ).tab).toBe("repo");
	expect(parseDashboardRange(new URLSearchParams("tab=repoKey"), NOW, EARLIEST, TZ).tab).toBe("machine");
});

function savingsModelRow(overrides: Partial<Parameters<typeof rollUpDailySavings>[0][number]> = {}) {
	return {
		...efficiencyRow(),
		model: "claude-opus-5",
		grossSavedUsd: 0,
		writePremiumUsd: 0,
		netSavedUsd: 0,
		savingsKnown: true,
		...overrides,
	};
}

test("rollUpDailySavings sums every model's savings into one figure per day", () => {
	const rows = rollUpDailySavings([
		savingsModelRow({ day: "2026-08-01", model: "claude-opus-5", grossSavedUsd: 4.5, netSavedUsd: 3, totalEventCount: 2 }),
		savingsModelRow({ day: "2026-08-01", model: "claude-haiku-4-5", grossSavedUsd: 0.9, netSavedUsd: 0.5, totalEventCount: 1 }),
	]);

	expect(rows).toEqual([
		{ day: "2026-08-01", grossSavedUsd: 5.4, netSavedUsd: 3.5, savingsKnown: true, totalEventCount: 3 },
	]);
});

test("rollUpDailySavings marks a whole day as unmeasured when any model on it has no known price", () => {
	const rows = rollUpDailySavings([
		savingsModelRow({ day: "2026-08-01", model: "claude-opus-5", netSavedUsd: 3, savingsKnown: true }),
		savingsModelRow({ day: "2026-08-01", model: "claude-unreleased", netSavedUsd: 0, savingsKnown: false }),
	]);

	// $0 from an unpriced model is indistinguishable from an idle cache — the day's figure is a
	// floor, and the chart has to be able to say so.
	expect(rows[0].savingsKnown).toBe(false);
});

test("formatSavingsStatement reads a negative net as a cost, never as a negative saving (D35)", () => {
	expect(formatSavingsStatement(28.5)).toBe("Caching saved $28.50");
	// Not "saved $-1.98", which also puts the sign in the wrong place.
	expect(formatSavingsStatement(-1.98)).toBe("Caching cost $1.98 more than it saved");
});

test("rankDimensionTotals breaks a cost tie by name, so two surfaces ranking the same data agree (D38)", () => {
	// Without a tie-break the order depends on insertion order, which differs between the Model tab
	// and the model-mix chart — and with pagination a tied row can appear twice or not at all.
	const totals = rankDimensionTotals([
		{ day: "2026-08-01", dimensionValue: "zeta", costUsd: 5, unpricedEventCount: 0, eventCount: 1 },
		{ day: "2026-08-01", dimensionValue: "alpha", costUsd: 5, unpricedEventCount: 0, eventCount: 1 },
	]);

	expect(totals.map((total) => total.dimensionValue)).toEqual(["alpha", "zeta"]);
});

test("modelMixByDay reports each model's share of that day's spend, summing to the whole day", () => {
	const rows = modelMixByDay(
		[
			savingsModelRow({ day: "2026-08-01", model: "claude-opus-5", totalCostUsd: 75, totalEventCount: 3 }),
			savingsModelRow({ day: "2026-08-01", model: "claude-haiku-4-5", totalCostUsd: 25, totalEventCount: 1 }),
		],
		["claude-opus-5", "claude-haiku-4-5"],
	);

	expect(rows).toEqual([
		{ day: "2026-08-01", totalEventCount: 4, "claude-opus-5": 0.75, "claude-haiku-4-5": 0.25 },
	]);
});

test("modelMixByDay folds a model outside the top set into Other, matching the Model tab's cap", () => {
	const rows = modelMixByDay(
		[
			savingsModelRow({ day: "2026-08-01", model: "claude-opus-5", totalCostUsd: 60, totalEventCount: 2 }),
			savingsModelRow({ day: "2026-08-01", model: "claude-fable-5", totalCostUsd: 40, totalEventCount: 1 }),
		],
		["claude-opus-5"],
	);

	expect(rows[0]["claude-opus-5"]).toBe(0.6);
	expect(rows[0].Other).toBe(0.4);
	expect(rows[0]["claude-fable-5"]).toBeUndefined();
});

test("a day with events but no priced spend has no defined mix, so it breaks rather than reading as zero (D39)", () => {
	// Every event that day was unpriced: the models WERE used, so a flat zero would be a lie.
	const rows = modelMixByDay(
		[savingsModelRow({ day: "2026-08-01", model: "claude-opus-5", totalCostUsd: 0, totalEventCount: 4, unpricedEventCount: 4 })],
		["claude-opus-5"],
	);

	expect(rows[0]["claude-opus-5"]).toBeNull();
	expect(rows[0].totalEventCount).toBe(4);
});

test("a model unused on a day that DID have spend is 0% of it, not a break in the stack", () => {
	// The areas are stacked, so a break is a HOLE: the band the missing series would have filled
	// shows the page background instead. Only a day with no priced spend at all is undefined.
	const rows = modelMixByDay(
		[
			savingsModelRow({ day: "2026-08-01", model: "claude-opus-4-8", totalCostUsd: 100, totalEventCount: 4 }),
			savingsModelRow({ day: "2026-08-02", model: "claude-opus-5", totalCostUsd: 80, totalEventCount: 3 }),
			savingsModelRow({ day: "2026-08-02", model: "claude-opus-4-8", totalCostUsd: 20, totalEventCount: 1 }),
		],
		["claude-opus-4-8", "claude-opus-5"],
	);

	expect(rows[0]["claude-opus-5"]).toBe(0);
	expect(rows[1]["claude-opus-5"]).toBe(0.8);
});

test("a session-list page is read from the URL, and anything that is not a page number reads as the first", () => {
	expect(parseDashboardRange(new URLSearchParams("page=3"), NOW, EARLIEST, TZ).pageIndex).toBe(2);
	expect(parseDashboardRange(new URLSearchParams(), NOW, EARLIEST, TZ).pageIndex).toBe(0);
	// A negative, a zero, a fraction and a word are all positions that do not exist.
	for (const bad of ["0", "-4", "1.5", "last"]) {
		expect(parseDashboardRange(new URLSearchParams(`page=${bad}`), NOW, EARLIEST, TZ).pageIndex).toBe(0);
	}
});

test("the session sort is read from the URL, and an unoffered ordering falls back to cost", () => {
	expect(parseDashboardRange(new URLSearchParams("sort=recent"), NOW, EARLIEST, TZ).sessionSort).toBe("recent");
	// The value chooses which field an aggregation sorts by, so it is an allowlist, not a hint.
	expect(parseDashboardRange(new URLSearchParams("sort=costUsd"), NOW, EARLIEST, TZ).sessionSort).toBe("cost");
	expect(parseDashboardRange(new URLSearchParams(), NOW, EARLIEST, TZ).sessionSort).toBe("cost");
});

test("planDayBuckets folds a 30-day window into 15 two-day buckets (D7)", () => {
	const buckets = planDayBuckets("2026-07-06", "2026-08-04");

	expect(buckets.labels).toHaveLength(15);
	expect(buckets.labels[0]).toBe("2026-07-06…2026-07-07");
	expect(buckets.labels[14]).toBe("2026-08-03…2026-08-04");
	expect(buckets.labelOf.get("2026-07-09")).toBe("2026-07-08…2026-07-09");
});

test("planDayBuckets puts a window's leftover days on the OLDEST bucket, so the newest bar is never short (D7)", () => {
	// 21 days at a 2-day span leaves one over. On the right edge that short bar would read as
	// spending collapsing; on the left it reads as the window starting mid-bucket, which it did.
	const buckets = planDayBuckets("2026-07-15", "2026-08-04");

	expect(buckets.labels).toHaveLength(11);
	expect(buckets.labels[0]).toBe("2026-07-15");
	expect(buckets.labels[10]).toBe("2026-08-03…2026-08-04");
});

test("planDayBuckets leaves a window of 20 days or fewer at one bare-dated bucket per day", () => {
	// The bare date matters as much as the count: every existing per-day assertion, tooltip and
	// axis tick keeps reading exactly what it did before bucketing existed.
	const buckets = planDayBuckets("2026-08-01", "2026-08-20");

	expect(buckets.labels).toHaveLength(20);
	expect(buckets.labels[0]).toBe("2026-08-01");
	expect(buckets.labels[19]).toBe("2026-08-20");
});

test("bucketAxisTick shortens a bucket's label to a two-digit-year tick, still naming which year a bar belongs to (card #170 D34/R28)", () => {
	// A bare MM-DD tick would read "01-05" the same way in two different years once the corpus
	// outlives a year — R28's exact failure. A two-digit year keeps the tick shorter than today's
	// full YYYY-MM-DD while staying year-unambiguous.
	expect(bucketAxisTick("2026-07-06")).toBe("26-07-06");
});

test("bucketAxisTick reads a multi-day bucket's tick from its FIRST day only, same as before shortening existed", () => {
	expect(bucketAxisTick("2026-07-06…2026-07-10")).toBe("26-07-06");
});

test("planTurnBuckets leaves a session of 20 turns or fewer at one bucket per turn (card #161 Step 7)", () => {
	const buckets = planTurnBuckets(20);

	expect(buckets.labels).toHaveLength(20);
	expect(buckets.labels[0]).toBe("Turn 1");
	expect(buckets.labels[19]).toBe("Turn 20");
});

test("planTurnBuckets caps a long session at 20 buckets, putting the leftover turn on the OLDEST bucket (card #161 Step 7)", () => {
	// 21 turns at a 2-turn span leaves one over — same shape as planDayBuckets's 21-day case.
	const buckets = planTurnBuckets(21);

	expect(buckets.labels).toHaveLength(11);
	expect(buckets.labels[0]).toBe("Turn 1");
	expect(buckets.labels[10]).toBe("Turns 20–21");
});

test("bucketTurnDollars sums the underlying dollars per bucket, never averages per-turn shares (card #161 Step 7, D7)", () => {
	const buckets: TurnBuckets = {
		labels: ["Turns 1–2", "Turn 3"],
		labelOf: new Map([
			[0, "Turns 1–2"],
			[1, "Turns 1–2"],
			[2, "Turn 3"],
		]),
	};
	const rows = [
		{ turnIndex: 0, carryUsd: 1, newUsd: 2, priced: true },
		{ turnIndex: 1, carryUsd: 3, newUsd: 4, priced: true },
		{ turnIndex: 2, carryUsd: 5, newUsd: 6, priced: true },
	];

	const result = bucketTurnDollars(rows, buckets);

	expect(result).toStrictEqual([
		{ turnBucket: "Turns 1–2", carryUsd: 4, newUsd: 6, unpricedEventCount: 0 },
		{ turnBucket: "Turn 3", carryUsd: 5, newUsd: 6, unpricedEventCount: 0 },
	]);
});

test("bucketTurnDollars counts a bucket's unpriced turns, so a bucket mixing priced and unpriced turns keeps a lower-bound marking instead of reading as complete (card #161 F2 adversarial Fix C / R38)", () => {
	const buckets: TurnBuckets = {
		labels: ["Turn 1"],
		labelOf: new Map([
			[0, "Turn 1"],
			[1, "Turn 1"],
			[2, "Turn 1"],
		]),
	};
	const rows = [
		{ turnIndex: 0, carryUsd: 1, newUsd: 1, priced: true },
		{ turnIndex: 1, carryUsd: 0, newUsd: 0, priced: false },
		{ turnIndex: 2, carryUsd: 0, newUsd: 0, priced: false },
	];

	const result = bucketTurnDollars(rows, buckets);

	expect(result).toStrictEqual([{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 1, unpricedEventCount: 2 }]);
});

test("turnBucketTooltipLabel appends the D17 lower-bound suffix when the bucket has unpriced turns (card #161 F2 adversarial Fix C / R38)", () => {
	expect(turnBucketTooltipLabel("Turn 5", 0)).toBe("Turn 5");
	expect(turnBucketTooltipLabel("Turn 5", 1)).toBe("Turn 5 (1 event unpriced)");
	expect(turnBucketTooltipLabel("Turns 1–3", 2)).toBe("Turns 1–3 (2 events unpriced)");
});

test("bucketTurnDollars fills a bucket with no rows with zero, so a subset (e.g. subagent turns) shares the full plan's bucket count with the main series (card #161 Step 7/8)", () => {
	const buckets: TurnBuckets = {
		labels: ["Turns 1–2", "Turn 3"],
		labelOf: new Map([
			[0, "Turns 1–2"],
			[1, "Turns 1–2"],
			[2, "Turn 3"],
		]),
	};
	// Only turn 0 is in this subset — mirrors a session whose subagent turns are a small fraction
	// of the whole sequence.
	const rows = [{ turnIndex: 0, carryUsd: 1, newUsd: 2, priced: true }];

	const result = bucketTurnDollars(rows, buckets);

	expect(result).toStrictEqual([
		{ turnBucket: "Turns 1–2", carryUsd: 1, newUsd: 2, unpricedEventCount: 0 },
		{ turnBucket: "Turn 3", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
	]);
});

test("buildTurnTimeline separates subagent turns into their own series, aligned to the main series' bucket layout (card #161 Step 8, D6)", () => {
	const turns = [
		{ isSubagent: false, carryUsd: 1, newUsd: 1, priced: true },
		{ isSubagent: true, carryUsd: 5, newUsd: 5, priced: true },
		{ isSubagent: false, carryUsd: 2, newUsd: 2, priced: true },
	];

	const timeline = buildTurnTimeline(turns);

	expect(timeline.labels).toEqual(["Turn 1", "Turn 2", "Turn 3"]);
	expect(timeline.main).toStrictEqual([
		{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 1, unpricedEventCount: 0 },
		{ turnBucket: "Turn 2", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
		{ turnBucket: "Turn 3", carryUsd: 2, newUsd: 2, unpricedEventCount: 0 },
	]);
	expect(timeline.subagent).toStrictEqual([
		{ turnBucket: "Turn 1", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
		{ turnBucket: "Turn 2", carryUsd: 5, newUsd: 5, unpricedEventCount: 0 },
		{ turnBucket: "Turn 3", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
	]);
});

test("a session with zero subagent turns still gets a full-length all-zero subagent series, never omitted or folded into main (card #161 Step 8)", () => {
	const turns = [
		{ isSubagent: false, carryUsd: 1, newUsd: 1, priced: true },
		{ isSubagent: false, carryUsd: 2, newUsd: 2, priced: true },
	];

	const timeline = buildTurnTimeline(turns);

	expect(timeline.subagent).toStrictEqual([
		{ turnBucket: "Turn 1", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
		{ turnBucket: "Turn 2", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 },
	]);
	// The main series is unaffected by there being no subagent turns.
	expect(timeline.main).toStrictEqual([
		{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 1, unpricedEventCount: 0 },
		{ turnBucket: "Turn 2", carryUsd: 2, newUsd: 2, unpricedEventCount: 0 },
	]);
});

test("turnTimelineTotalUsd sums every bar's dollars across both series (card #161 F2 adversarial Fix A / R51)", () => {
	const timeline = {
		labels: ["Turn 1"],
		main: [{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 2, unpricedEventCount: 0 }],
		subagent: [{ turnBucket: "Turn 1", carryUsd: 0.5, newUsd: 0.5, unpricedEventCount: 0 }],
	};

	expect(turnTimelineTotalUsd(timeline)).toBe(4);
});

test("turnTimelineDivergenceNote is null when the chart's total agrees with the session's stored total (card #161 F2 adversarial Fix A / R51)", () => {
	const timeline = {
		labels: ["Turn 1"],
		main: [{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 4, unpricedEventCount: 0 }],
		subagent: [{ turnBucket: "Turn 1", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 }],
	};

	expect(turnTimelineDivergenceNote(timeline, 5)).toBeNull();
});

test("turnTimelineDivergenceNote names the gap when D11's clamp made the chart's total read higher than the session's stored total (card #161 F2 adversarial Fix A / R51)", () => {
	// Mirrors a real repriced-turn scenario: a turn's re-priced carry (1.50) now exceeds its cost
	// frozen at write time (1.00), so newUsd clamps to 0 and the bar sums to 1.50, not 1.00.
	const timeline = {
		labels: ["Turn 1"],
		main: [{ turnBucket: "Turn 1", carryUsd: 1.5, newUsd: 0, unpricedEventCount: 0 }],
		subagent: [{ turnBucket: "Turn 1", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 }],
	};

	const note = turnTimelineDivergenceNote(timeline, 1);

	expect(note).not.toBeNull();
	expect(note).toContain("$1.50"); // the chart's own total
	expect(note).toContain("$1.00"); // the session's stored "Total cost" figure
});

test("turnTimelineEmptyStateCopy distinguishes an all-unpriced session from one that genuinely cost nothing, and never claims a range this page doesn't have (card #161 F2 adversarial Fix D / R37)", () => {
	expect(turnTimelineEmptyStateCopy(5, 5)).toBe("Every turn in this session is unpriced — nothing to chart yet.");
	expect(turnTimelineEmptyStateCopy(5, 0)).toBe("Every turn in this session cost $0.00.");
});

test("isMainSeriesEmptyWithSubagentActivity is true only when the main series is entirely zero AND the subagent series carries real dollars (card #161 F2 adversarial Fix F / R45)", () => {
	const allZero: TurnBucketRow[] = [{ turnBucket: "Turn 1", carryUsd: 0, newUsd: 0, unpricedEventCount: 0 }];
	const hasDollars: TurnBucketRow[] = [{ turnBucket: "Turn 1", carryUsd: 1, newUsd: 1, unpricedEventCount: 0 }];

	// An all-subagent session: main is empty, subagent is not.
	expect(isMainSeriesEmptyWithSubagentActivity(allZero, hasDollars)).toBe(true);
	// The ordinary case: main has real dollars too.
	expect(isMainSeriesEmptyWithSubagentActivity(hasDollars, hasDollars)).toBe(false);
	// Nothing in the whole session is priced yet — Fix D's empty state owns this case, not Fix F's note.
	expect(isMainSeriesEmptyWithSubagentActivity(allZero, allZero)).toBe(false);
});

test("fillMissingBuckets gives a bucket with no recorded work its own placeholder, so it holds its place on the axis (D24)", () => {
	const buckets = planDayBuckets("2026-07-06", "2026-08-04");
	const rows = [{ day: "2026-08-03…2026-08-04", value: 9 }];

	const filled = fillMissingBuckets(rows, buckets, (day) => ({ day, value: 0 }));

	expect(filled).toHaveLength(15);
	expect(filled[0]).toStrictEqual({ day: "2026-07-06…2026-07-07", value: 0 });
	expect(filled[14]).toStrictEqual({ day: "2026-08-03…2026-08-04", value: 9 });
});

test("a bucket's model mix is the share of its SUMMED cost, never the average of its days' percentages (D7)", () => {
	// Day one spends 90% of $10 on opus; day two spends 10% of $100. Averaging the two percentages
	// gives a plausible-looking 50% — the bucket actually put $19 of $110 into opus.
	const rows = relabelRowsToBuckets(
		[
			savingsModelRow({ day: "2026-07-06", model: "claude-opus-5", totalCostUsd: 9 }),
			savingsModelRow({ day: "2026-07-06", model: "claude-haiku-4-5", totalCostUsd: 1 }),
			savingsModelRow({ day: "2026-07-07", model: "claude-opus-5", totalCostUsd: 10 }),
			savingsModelRow({ day: "2026-07-07", model: "claude-haiku-4-5", totalCostUsd: 90 }),
		],
		planDayBuckets("2026-07-06", "2026-08-04"),
	);

	const mix = modelMixByDay(rows, ["claude-opus-5", "claude-haiku-4-5"]);

	expect(mix).toHaveLength(1);
	expect(mix[0].day).toBe("2026-07-06…2026-07-07");
	expect(mix[0]["claude-opus-5"]).toBeCloseTo(0.1727, 4);
});
