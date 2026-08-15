import type {
	DailyCostByDimensionRow,
	DailyEfficiencyByModelRow,
	DailyEfficiencyRow,
	DateRange,
	MachineSyncStatusRow,
} from "@/server/usage-queries";
// Value import, not type-only (unlike the block above): the sentinel string itself, not just its
// shape — usage-queries.ts is the query-layer's own source of truth for it (R17). Safe to pull
// into this shared, non-"use client" module: usage-queries.ts has no runtime dependency on the
// mongodb driver (it only ever takes a `Db` as a parameter type), so nothing server-only rides
// along with this constant into a client bundle.
import { UNATTRIBUTED_DIMENSION_VALUE } from "@/server/usage-queries";

import { DEFAULT_SPLIT_TAB, SplitTab } from "./cost-split-view/cost-split-view.type";
import { DEFAULT_SESSION_SORT, SessionSort } from "./session-list/session-list.type";
import {
	FIRST_PAGE,
	RANGE_FROM_PARAM,
	RANGE_PRESET_PARAM,
	RANGE_TO_PARAM,
	SESSION_PAGE_PARAM,
	SESSION_SORT_PARAM,
	SPLIT_TAB_PARAM,
} from "./href";
import {
	DEFAULT_RANGE_PRESET,
	PRESET_DAY_SPANS,
	RangePreset,
	SELECTABLE_RANGE_PRESETS,
} from "./range-picker/range-picker.type";

/** A dimension value's total across a whole range — feeds the ranked summary table. */
export interface DimensionTotal {
	dimensionValue: string;
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
}

/** One chart row: a day plus one numeric field per series key present that day. */
export interface ChartDayRow {
	day: string;
	/** Sum of `unpricedEventCount` across every dimension value folded into this day (D17) — the
	 * chart layer's only signal that a bar (possibly zero-height) is a lower bound, not a
	 * measured zero. */
	unpricedEventCount: number;
	/** Events actually recorded on this day (D24). Once absent days are gap-filled, row count no
	 * longer distinguishes "no work in range" from "a range of empty days" — this does. */
	eventCount: number;
	[seriesKey: string]: string | number;
}

/**
 * D17 — a total over a range containing unpriced events renders as a lower bound
 * (`$412.00+ (18 events unpriced)`), never a silent sum. Applies to every cost figure the
 * dashboard shows, not only the headline total.
 *
 * @param costUsd - sum of `priced: true` events only
 * @param unpricedEventCount - count of `priced: false` events folded into the same bucket
 */
export function formatLowerBoundCost(costUsd: number, unpricedEventCount: number): string {
	const amount = `$${costUsd.toFixed(2)}`;
	if (unpricedEventCount === 0) return amount;
	const noun = unpricedEventCount === 1 ? "event" : "events";
	return `${amount}+ (${unpricedEventCount} ${noun} unpriced)`;
}

/**
 * Sums `costPerDay` rows across the whole range into one total per dimension value, sorted by
 * cost descending — the ranking a summary table and the chart's top-N cutoff both need.
 *
 * @param rows - per-day/dimension rows from `costPerDay`
 */
export function rankDimensionTotals(rows: DailyCostByDimensionRow[]): DimensionTotal[] {
	const totals = new Map<string, DimensionTotal>();

	for (const row of rows) {
		const existing = totals.get(row.dimensionValue);
		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.eventCount += row.eventCount;
		} else {
			totals.set(row.dimensionValue, {
				dimensionValue: row.dimensionValue,
				costUsd: row.costUsd,
				unpricedEventCount: row.unpricedEventCount,
				eventCount: row.eventCount,
			});
		}
	}

	// D38 — the tie-break is not cosmetic: the Model tab and the model-mix chart rank the same
	// data through this function and must agree, and a tied row under pagination can otherwise
	// appear on two pages or on none.
	return [...totals.values()].sort((a, b) => b.costUsd - a.costUsd || a.dimensionValue.localeCompare(b.dimensionValue));
}

/**
 * Pivots per-day/dimension rows into one row per day, keyed by dimension value. Values outside
 * `topValues` fold into `"Other"` — the chart palette (`--chart-1`..`--chart-5`) has 5 usable
 * series; a 9th category must never become a 9th generated hue.
 *
 * @param rows - per-day/dimension rows from `costPerDay`
 * @param topValues - the dimension values that get their own series
 */
export function pivotForChart(rows: DailyCostByDimensionRow[], topValues: string[]): ChartDayRow[] {
	const topSet = new Set(topValues);
	const byDay = new Map<string, ChartDayRow>();

	for (const row of rows) {
		const seriesKey = topSet.has(row.dimensionValue) ? row.dimensionValue : "Other";
		const dayRow = byDay.get(row.day) ?? { day: row.day, unpricedEventCount: 0, eventCount: 0 };
		dayRow[seriesKey] = (Number(dayRow[seriesKey]) || 0) + row.costUsd;
		dayRow.unpricedEventCount += row.unpricedEventCount;
		dayRow.eventCount += row.eventCount;
		byDay.set(row.day, dayRow);
	}

	return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The chart palette's 5 usable slots — a 6th visible series always folds into "Other" instead of
 * generating a 6th hue (D21). */
const SERIES_COLOR_SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/**
 * Assigns each shown dimension value a stable colour slot (D21) keyed by the value's position in
 * a RANGE-INDEPENDENT domain ordering, not its rank in the current window — so a value's colour
 * never changes when the selected window changes. A shown value whose domain position falls
 * outside the palette (rank >= 5, or the value is absent from the domain entirely) takes the
 * lowest slot not already claimed by another shown value, in `shownValues` order, so two visible
 * series can never collide.
 *
 * @param shownValues - dimension values with their own series in the current window (already capped to palette size)
 * @param domainOrder - the dimension's values ordered range-independently (cost desc, 365-day lookback, alphabetical tie-break)
 */
export function assignSeriesColorSlots(shownValues: string[], domainOrder: string[]): Record<string, string> {
	const domainIndex = new Map(domainOrder.map((value, index) => [value, index]));
	const claimedSlots = new Set<number>();
	const preAssigned = shownValues.map((value) => {
		const index = domainIndex.get(value);
		const slot = index !== undefined && index < SERIES_COLOR_SLOTS.length ? index : undefined;
		if (slot !== undefined) claimedSlots.add(slot);
		return { value, slot };
	});

	const colors: Record<string, string> = {};
	for (const { value, slot } of preAssigned) {
		let resolvedSlot = slot;
		if (resolvedSlot === undefined) {
			resolvedSlot = 0;
			while (claimedSlots.has(resolvedSlot)) resolvedSlot++;
			claimedSlots.add(resolvedSlot);
		}
		colors[value] = SERIES_COLOR_SLOTS[resolvedSlot];
	}
	return colors;
}

/**
 * Rewrites each row's `day` to the label of the bucket it falls in, so the roll-ups that already
 * group by `day` — `pivotForChart`, `modelMixByDay`, `rollUpDailySavings`, `rollUpEfficiencyByDay`
 * — bucket for free, summing the underlying quantities and recomputing any ratio from those sums.
 *
 * That reuse is the whole point (D7): model mix is a share of spend, and a bucketing step that
 * combined the daily PERCENTAGES would be wrong in a way that looks entirely plausible on screen.
 *
 * @param rows - rows carrying a calendar `day`
 * @param buckets - the window's buckets, from `planDayBuckets`
 */
export function relabelRowsToBuckets<T extends { day: string }>(rows: T[], buckets: DayBuckets): T[] {
	// The fallback is unreachable in practice — rows come from a query bounded by the same window
	// the buckets were planned over — and exists only to keep an `undefined` label out of the data.
	return rows.map((row) => ({ ...row, day: buckets.labelOf.get(row.day) ?? row.day }));
}

/**
 * Fills every bucket with no rows of its own with `makeEmpty`'s result (D11/D24) — never
 * overwrites a bucket already present in `rows`. Generic over the row shape so the same function
 * fills `ChartDayRow[]`, `DailyEfficiencyRow[]`, `DailySavingsRow[]` and `ModelMixDayRow[]`.
 *
 * @param rows - existing rows, each carrying its bucket label in `day`
 * @param buckets - the window's buckets, from `planDayBuckets`
 * @param makeEmpty - builds the placeholder row for one empty bucket
 */
export function fillMissingBuckets<T extends { day: string }>(
	rows: T[],
	buckets: DayBuckets,
	makeEmpty: (day: string) => T,
): T[] {
	// Keyed by label so a real row always wins — building empties first and writing reals over them
	// would erase a bucket's own unpricedEventCount, silently deleting a D17 lower-bound warning.
	const present = new Map(rows.map((row) => [row.day, row]));

	return buckets.labels.map((label) => present.get(label) ?? makeEmpty(label));
}

/** The most bars any per-day chart may render (D7). Past this many days the axis stops being
 * readable, so consecutive days fold into one bucket instead. */
export const MAX_CHART_BARS = 20;

/** A window's days grouped into at most `MAX_CHART_BARS` buckets. */
export interface DayBuckets {
	/** Each bucket's label, oldest first — a bare `YYYY-MM-DD` when it covers one day, so a window
	 * of 20 days or fewer keeps exactly today's behaviour. */
	labels: string[];
	/** Which bucket each calendar day in the window belongs to. */
	labelOf: Map<string, string>;
}

/**
 * Groups a window's calendar days into at most `MAX_CHART_BARS` buckets (D7). One rule for every
 * window: 30 days becomes 15 two-day buckets, 90 becomes 18 five-day ones, and anything at or
 * under 20 days stays one bucket per day.
 *
 * Any remainder lands on the OLDEST bucket, never the newest — the eye reads the right edge as
 * "now", so a short final bar looks like spending collapsed when it only means the bucket is
 * young.
 *
 * @param firstDay - window start, `YYYY-MM-DD`, inclusive
 * @param lastDay - window end, `YYYY-MM-DD`, inclusive
 */
export function planDayBuckets(firstDay: string, lastDay: string): DayBuckets {
	const days: string[] = [];
	for (let day = firstDay; day <= lastDay; day = nextDay(day)) days.push(day);

	const span = Math.max(1, Math.ceil(days.length / MAX_CHART_BARS));
	const labels: string[] = [];
	const labelOf = new Map<string, string>();

	// The first bucket absorbs the remainder; every one after it is full width.
	let size = days.length % span || span;
	for (let index = 0; index < days.length; index += size, size = span) {
		const members = days.slice(index, index + size);
		const label = bucketLabel(members[0], members[members.length - 1]);
		labels.push(label);
		for (const day of members) labelOf.set(day, label);
	}

	return { labels, labelOf };
}

/**
 * A bucket's label. A single-day bucket keeps the bare date it has always had, so a window of 20
 * days or fewer produces byte-identical rows to before bucketing existed; a multi-day one names
 * both ends, because a bar labelled only with its first day silently claims to be that one day.
 *
 * @param firstDay - the bucket's oldest day, `YYYY-MM-DD`
 * @param lastDay - the bucket's newest day, `YYYY-MM-DD`
 */
function bucketLabel(firstDay: string, lastDay: string): string {
	return firstDay === lastDay ? firstDay : `${firstDay}…${lastDay}`;
}

/**
 * A bucket label rendered as an X-axis tick: its first day alone, in a two-digit-year form
 * (`26-07-06`) rather than the full `YYYY-MM-DD` (card #170 D10/D34) — shorter at every viewport,
 * with no JS breakpoint. The full span stays in the tooltip, which has room for it — a
 * `2026-07-06…2026-07-10` tick is wider than the axis can carry, and 20 of them collide into the
 * mess bucketing exists to remove.
 *
 * Never drops the year outright (R28): once the corpus outlives a year, an "all time" window's
 * 20-bucket cap can put two `01-05` ticks from different years side by side, and a bare `MM-DD`
 * tick cannot tell them apart. Keeping two digits of year is what a bare month/day format loses.
 *
 * @param label - a bucket label from `planDayBuckets`
 */
export function bucketAxisTick(label: string): string {
	return label.slice(2, 10);
}

/**
 * The calendar day after `day`. Walks through `Date.UTC` rather than the dashboard timezone
 * because these strings are wall-clock labels, not instants — enumerating them in UTC keeps the
 * walk immune to the DST bug `startOfDayInTimezone` carries for zones that observe it.
 *
 * @param day - `YYYY-MM-DD`
 */
function nextDay(day: string): string {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** Range-level summary of which days/events in a chart's data are unpriced (D5) — the single
 * source both the above-chart sentence and (a future) chart annotation must read from, so they
 * can never disagree. */
export interface UnpricedDaysSummary {
	days: string[];
	dayCount: number;
	eventCount: number;
}

/**
 * Summarizes which days in a chart's rows carry unpriced events, and how many events total (D5)
 * — replaces the deleted per-day `*` axis marker with one range-level fact.
 *
 * @param rows - a cost-split view's pivoted chart rows
 */
export function summarizeUnpricedDays(rows: ChartDayRow[]): UnpricedDaysSummary {
	const days = rows.filter((row) => row.unpricedEventCount > 0).map((row) => row.day);
	const eventCount = rows.reduce((sum, row) => sum + row.unpricedEventCount, 0);
	return { days, dayCount: days.length, eventCount };
}

/**
 * Subagent share of a day's priced cost, as a fraction 0-1. `null` when the share is unknown —
 * either zero priced cost overall (division by zero), or subagent events happened but every one
 * of them was unpriced (`subagentCostUsd` reads as 0 without meaning "no subagent work").
 *
 * @param row - one day from `dailyEfficiency`
 */
export function subagentCostShare(row: DailyEfficiencyRow): number | null {
	if (row.totalCostUsd === 0) return null;
	if (row.subagentCostUsd === 0 && row.subagentEventCount > 0) return null;
	return row.subagentCostUsd / row.totalCostUsd;
}

/** One instant's wall-clock date/time parts as read in `timeZone`, plus that same wall-clock
 * reading reinterpreted as if it were UTC — the standard trick both timezone helpers below need
 * to compute an offset without a date library. */
function timezonePartsAsUtcMs(
	date: Date,
	timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number; asIfUtcMs: number } {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const raw = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const year = Number(raw.year);
	const month = Number(raw.month);
	const day = Number(raw.day);
	// `hour12: false` renders local midnight as "24", not "00".
	const hour = raw.hour === "24" ? 0 : Number(raw.hour);
	const minute = Number(raw.minute);
	const second = Number(raw.second);
	return { year, month, day, hour, minute, second, asIfUtcMs: Date.UTC(year, month - 1, day, hour, minute, second) };
}

/**
 * The UTC instant corresponding to local midnight, in `timeZone`, of the day containing `date`
 * (R38/D16) — used to align a default range's earliest bound so the leftmost chart bar is a
 * full day, never a rolling-window fragment.
 *
 * @param date - any instant within the target local day
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function startOfDayInTimezone(date: Date, timeZone: string): Date {
	const parts = timezonePartsAsUtcMs(date, timeZone);
	const offsetMs = parts.asIfUtcMs - date.getTime();
	const localMidnightAsIfUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
	return new Date(localMidnightAsIfUtcMs - offsetMs);
}

/**
 * The UTC instant of the LAST millisecond of the local day containing `date`, in `timeZone` — the
 * inclusive upper bound a custom range needs. A range ending on a past day must stop at the end of
 * that day; using "now" instead would silently include everything up to today.
 *
 * @param date - any instant within the target local day
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function endOfDayInTimezone(date: Date, timeZone: string): Date {
	// Reached by landing mid-way into the next local day and taking ITS midnight, rather than by
	// adding 24h: a local day is 23 or 25 hours long in a zone that observes DST, and fixed
	// arithmetic would then overshoot or undershoot the boundary by an hour.
	const dayStart = startOfDayInTimezone(date, timeZone);
	const nextDayStart = startOfDayInTimezone(new Date(dayStart.getTime() + 36 * 60 * 60 * 1000), timeZone);
	return new Date(nextDayStart.getTime() - 1);
}

/**
 * Renders an instant as `YYYY-MM-DD HH:mm:ss` in `timeZone` (R38/D16) — every chart buckets
 * days in `DASHBOARD_TIMEZONE`, so any timestamp shown to the operator must use the same
 * calendar or the same event appears to belong to two different days across views.
 *
 * @param date - the instant to render
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function formatInstantInTimezone(date: Date, timeZone: string): string {
	const parts = timezonePartsAsUtcMs(date, timeZone);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * The calendar day an instant falls on, as `YYYY-MM-DD`, read in `timeZone` — the same calendar
 * every chart buckets by. Gap-fill bounds must come from here rather than from the instant's UTC
 * date, or the first and last bar of a range land on the wrong day at UTC+7.
 *
 * @param date - the instant to read
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function dayKeyInTimezone(date: Date, timeZone: string): string {
	return formatInstantInTimezone(date, timeZone).slice(0, 10);
}

/**
 * A session's turns grouped into at most `MAX_CHART_BARS` buckets, keyed by ORDINAL position in the
 * turn sequence rather than a calendar day (card #161 Step 7) — mirrors `DayBuckets`/`planDayBuckets`'s
 * span/remainder algorithm, but turns have no gaps to fill: every bucket a plan produces already
 * holds at least one real turn, so there is no `fillMissingBuckets` counterpart.
 *
 * Deliberately NOT reusing `relabelRowsToBuckets`/`fillMissingBuckets`: both hardcode a field
 * literally named `day` in their bodies (verified by reading them), and forcing a turn-range label
 * into a field called `day` would violate this repo's own type-separation convention (a `day` field
 * that does not hold a calendar day). Widening their generic constraint was the other option, but
 * that touches shared code with 4+ other consumers across the dashboard for a mechanism this feature
 * is the only caller of — a small parallel function (`bucketTurnDollars`, below) is the smaller,
 * safer surface.
 */
export interface TurnBuckets {
	/** Each bucket's label, oldest first — "Turn 1" for a single-turn bucket, "Turns 1–25" otherwise
	 * (1-based, human-facing). */
	labels: string[];
	/** Which bucket (by label) the turn at this 0-based ordinal position falls into. */
	labelOf: Map<number, string>;
}

/**
 * Plans a session's turn-ordinal buckets, capped at `MAX_CHART_BARS` (card #161 Step 7). Any
 * remainder lands on the OLDEST bucket (turn ordinal 0), for the same reason `planDayBuckets` does:
 * the eye reads the right edge as "now", so a short final bar looks like the session's pace
 * collapsed when it only means the bucket is young.
 *
 * @param turnCount - how many turns the session has
 */
export function planTurnBuckets(turnCount: number): TurnBuckets {
	const span = Math.max(1, Math.ceil(turnCount / MAX_CHART_BARS));
	const labels: string[] = [];
	const labelOf = new Map<number, string>();

	// The first bucket absorbs the remainder; every one after it is full width — same shape as
	// planDayBuckets, just walking turn ordinals instead of calendar days.
	let size = turnCount % span || span;
	for (let index = 0; index < turnCount; index += size, size = span) {
		const end = Math.min(index + size, turnCount);
		const label = turnBucketLabel(index + 1, end);
		labels.push(label);
		for (let turnIndex = index; turnIndex < end; turnIndex++) labelOf.set(turnIndex, label);
	}

	return { labels, labelOf };
}

/**
 * A turn bucket's label. A single-turn bucket keeps a bare "Turn N"; a multi-turn one names both
 * ends (1-based, inclusive) — mirrors `bucketLabel`'s day-range naming.
 *
 * @param firstTurn - the bucket's oldest turn, 1-based
 * @param lastTurn - the bucket's newest turn, 1-based
 */
function turnBucketLabel(firstTurn: number, lastTurn: number): string {
	return firstTurn === lastTurn ? `Turn ${firstTurn}` : `Turns ${firstTurn}–${lastTurn}`;
}

/**
 * A turn bucket's tooltip label, carrying the same D17 "(N events unpriced)" lower-bound suffix
 * `formatLowerBoundCost` already appends to every other cost figure on this page (card #161 F2
 * adversarial Fix C / R38) — a bucket with unpriced turns must not read as a complete figure just
 * because the chart itself has no other place to say so.
 *
 * @param turnBucket - the bucket's own label (e.g. "Turn 5", "Turns 1–3")
 * @param unpricedEventCount - unpriced turns folded into this bucket (main + subagent combined)
 */
export function turnBucketTooltipLabel(turnBucket: string, unpricedEventCount: number): string {
	if (unpricedEventCount === 0) return turnBucket;
	const noun = unpricedEventCount === 1 ? "event" : "events";
	return `${turnBucket} (${unpricedEventCount} ${noun} unpriced)`;
}

/** One turn bucket's summed dollars (card #161 Step 7). */
export interface TurnBucketRow {
	turnBucket: string;
	carryUsd: number;
	newUsd: number;
	/** How many of this bucket's turns are unpriced (card #161 F2 adversarial Fix C / R38) — the
	 * same D17 lower-bound signal `ChartDayRow.unpricedEventCount` already carries for every other
	 * chart on this dashboard, so a bucket mixing priced and unpriced turns cannot silently read as
	 * a complete figure. */
	unpricedEventCount: number;
}

/**
 * Sums `carryUsd`/`newUsd` into each turn's bucket (card #161 Step 7) — bucket the underlying
 * dollars and recompute any share from those sums, never average per-turn ratios (the same rule
 * `relabelRowsToBuckets` states for calendar days, at `:158-159`).
 *
 * Rows carry their own `turnIndex` (position in the FULL turn sequence, not the filtered array's
 * own index) so two different subsets of the same session's turns — e.g. main vs. subagent — can be
 * bucketed against the SAME `TurnBuckets` plan and land in matching buckets by shared position.
 *
 * @param rows - a subset of a session's turns, each carrying its original ordinal position
 * @param buckets - the session's turn-bucket plan, from `planTurnBuckets`
 */
export function bucketTurnDollars(
	rows: { turnIndex: number; carryUsd: number; newUsd: number; priced: boolean }[],
	buckets: TurnBuckets,
): TurnBucketRow[] {
	const byLabel = new Map<string, TurnBucketRow>();

	for (const row of rows) {
		const label = buckets.labelOf.get(row.turnIndex);
		if (label === undefined) continue;
		const existing = byLabel.get(label) ?? { turnBucket: label, carryUsd: 0, newUsd: 0, unpricedEventCount: 0 };
		existing.carryUsd += row.carryUsd;
		existing.newUsd += row.newUsd;
		if (!row.priced) existing.unpricedEventCount += 1;
		byLabel.set(label, existing);
	}

	return buckets.labels.map((label) => byLabel.get(label) ?? { turnBucket: label, carryUsd: 0, newUsd: 0, unpricedEventCount: 0 });
}

/** A session's turn timeline, ready for the chart (card #161 Step 8): the shared bucket labels, and
 * two independently-bucketed series sharing them by position — main-session turns and subagent
 * turns are separate series on the same turn-order axis (D6), never interleaved or excluded. */
export interface TurnTimeline {
	labels: string[];
	main: TurnBucketRow[];
	subagent: TurnBucketRow[];
}

/**
 * Splits a session's turns into main and subagent series, bucketed against ONE shared plan so a
 * bucket's position means the same slice of the session in both series (card #161 Step 8).
 *
 * @param turns - a session's turns, oldest first (from `getSessionTurns`)
 */
export function buildTurnTimeline(
	turns: { isSubagent: boolean; carryUsd: number; newUsd: number; priced: boolean }[],
): TurnTimeline {
	const buckets = planTurnBuckets(turns.length);
	const indexed = turns.map((turn, turnIndex) => ({ turnIndex, ...turn }));

	return {
		labels: buckets.labels,
		main: bucketTurnDollars(
			indexed.filter((turn) => !turn.isSubagent),
			buckets,
		),
		subagent: bucketTurnDollars(
			indexed.filter((turn) => turn.isSubagent),
			buckets,
		),
	};
}

/**
 * Sum of every bar's dollars across both series (card #161 F2 adversarial Fix A / R51) — always
 * `>=` the session's own stored `totalCostUsd` (from `getSessionBreakdown`), and strictly greater
 * exactly when D11's clamp fired for at least one turn: a price-table correction pushed that turn's
 * re-priced carry above the cost frozen at its own write time, so `carryUsd + newUsd` for that turn
 * is `carryUsd` itself, not `costUsd`. Never substituted for `totalCostUsd`, which stays the actual
 * billed figure — this exists only so a caller can detect the two disagreeing.
 *
 * @param timeline - a session's bucketed turn timeline, from `buildTurnTimeline`
 */
export function turnTimelineTotalUsd(timeline: TurnTimeline): number {
	return [...timeline.main, ...timeline.subagent].reduce((sum, row) => sum + row.carryUsd + row.newUsd, 0);
}

/**
 * Explains a timeline whose total reads higher than the session's own stored total (card #161 F2
 * adversarial Fix A / R51) — `null` when the two agree, which is every session D11's clamp never
 * touched. Two contradicting dollar figures on one page is worse than one figure with a caveat, so
 * this names the gap instead of letting the chart and the "Total cost" line silently disagree.
 *
 * @param timeline - a session's bucketed turn timeline
 * @param totalCostUsd - the session's own stored total, from `getSessionBreakdown`
 */
export function turnTimelineDivergenceNote(timeline: TurnTimeline, totalCostUsd: number): string | null {
	const chartTotalUsd = turnTimelineTotalUsd(timeline);
	if (chartTotalUsd === totalCostUsd) return null;
	return (
		`This chart totals ${formatLowerBoundCost(chartTotalUsd, 0)}, more than the ` +
		`${formatLowerBoundCost(totalCostUsd, 0)} total above — a price change since these turns ran ` +
		`raised some turns' re-priced carry above what they were actually billed.`
	);
}

/**
 * The turn timeline's empty-state copy (card #161 F2 adversarial Fix D / R37) — this page has no
 * range concept (`getSessionTurns`/`getSessionBreakdown` are scoped to one session, never a date
 * window), so the "No data in this range" wording six other, genuinely range-scoped charts share is
 * false here. Also tells apart the two ways every bar can be zero: every turn is unpriced (a data
 * gap) versus every turn genuinely cost nothing (a real, measured zero) — a session with zero turns
 * never reaches this page (`getSessionBreakdown` 404s first), so `turnCount` is always `>= 1`.
 *
 * @param turnCount - how many turns the session has
 * @param unpricedEventCount - how many of those turns are unpriced
 */
export function turnTimelineEmptyStateCopy(turnCount: number, unpricedEventCount: number): string {
	if (unpricedEventCount >= turnCount) return "Every turn in this session is unpriced — nothing to chart yet.";
	return "Every turn in this session cost $0.00.";
}

/**
 * Whether the main-session series needs an explanatory note (card #161 F2 adversarial Fix F / R45)
 * — every main bucket at zero while the subagent series carries real dollars means the whole
 * session ran in a subagent (the parent machine died before syncing, or never ran main turns at
 * all), not that the chart is broken. Never fires for the R37 all-zero case (Fix D handles that one
 * with a suppressed chart, not a note on a chart that never renders).
 *
 * @param main - the main-session series
 * @param subagent - the subagent series, bucketed against the same plan
 */
export function isMainSeriesEmptyWithSubagentActivity(main: TurnBucketRow[], subagent: TurnBucketRow[]): boolean {
	const mainHasDollars = main.some((row) => row.carryUsd !== 0 || row.newUsd !== 0);
	if (mainHasDollars) return false;
	return subagent.some((row) => row.carryUsd !== 0 || row.newUsd !== 0);
}

/** Matches the status line's own threshold (Step 2), so both signals agree on what "stale" means. */
const MACHINE_SYNC_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// Matches src/status.mjs's own CLOCK_SKEW_TOLERANCE_MS so both signals agree at the boundary —
// ordinary skew (server clock adjustment, timer coarseness) is seconds, not minutes; a real clock
// jump or bad stored value is off by hours or more (card #161 Fix B / R14, dashboard half).
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * One machine's sync status, ready to render.
 *
 * `stale` reads as "no activity in 12h", not "sync is broken" (card #161 D10) — contact is only
 * produced by USING the machine, so an idle laptop is indistinguishable from a broken one here.
 */
export interface MachineSyncStatusView {
	machineId: string;
	/** Operator-assigned display name, or `null` when never set (Step 10) — carried through
	 * unchanged so `machine-sync.tsx` can resolve it with `machineDisplayName` the same way every
	 * other surface does. */
	name: string | null;
	/** "never", or an absolute timestamp already formatted in `timeZone` (card #161 Batch A fix
	 * pass, Fix 4 — the null-to-"never" decision used to live in `machine-sync.tsx`, a display
	 * component this repo's vitest config cannot reach (no DOM environment), so no test could
	 * ever exercise it. Moved here, where unit tests already run. */
	lastContact: string;
	/** card #161 Batch A fix pass, Fix 1 — the second timestamp D4 records but the dashboard was
	 * silently dropping before it reached the UI. Same "never"/formatted-timestamp shape as
	 * `lastContact`. */
	lastAccepted: string;
	/** Always `false` when `lastContactAt` is `null` (card #161 D13) — a machine that has never
	 * once reached the server has nothing to lose, so it is never painted as stale. */
	stale: boolean;
}

/**
 * @param rows - raw query rows (`server/usage-queries.ts`)
 * @param nowMs - injected rather than read internally, so this stays a pure function
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function evaluateMachineSyncStatus(
	rows: MachineSyncStatusRow[],
	nowMs: number,
	timeZone: string,
): MachineSyncStatusView[] {
	return rows.map((row) => {
		const elapsedMs = row.lastContactAt === null ? null : nowMs - row.lastContactAt.getTime();
		return {
			machineId: row.machineId,
			name: row.name,
			lastContact: row.lastContactAt === null ? "never" : formatInstantInTimezone(row.lastContactAt, timeZone),
			lastAccepted: row.lastAcceptedAt === null ? "never" : formatInstantInTimezone(row.lastAcceptedAt, timeZone),
			// A future lastContactAt (server clock moved, or a bad value already stored) is not
			// evidence of health — a negative elapsedMs would otherwise always read as "fresh" and
			// silently disable the flag forever (card #161 R14/R5, dashboard half). Fail loud, but
			// allow a small tolerance so ordinary clock skew doesn't trip a false flag.
			stale:
				elapsedMs !== null &&
				(elapsedMs < -CLOCK_SKEW_TOLERANCE_MS || elapsedMs >= MACHINE_SYNC_STALE_THRESHOLD_MS),
		};
	});
}

/** A dimension's colour ordering is computed over at least this much history (D21), so the
 * ordering barely moves as the operator switches windows. */
const COLOR_DOMAIN_LOOKBACK_DAYS = 365;

/** The window a dimension's colour ordering is ranked over. */
export interface ColorDomainWindow {
	fromMs: number;
	toMs: number;
}

/**
 * The window a dimension's colour ordering is computed over (D21/D41). Deliberately NOT the
 * selected window:
 *
 * - It always ends at `now`, never at the selected window's end. A window ending in the past would
 *   rank over a domain missing everything recorded since — so a value that has grown recently
 *   would be absent from one window's domain and top of another's, shifting every slot below it.
 *   That repaint is the exact defect D21 exists to remove.
 * - It always starts at least a year back, and further when the selected window reaches further
 *   (D41) — a window extending past the lookback would leave its oldest values unranked, which
 *   falls back to rank-based colouring and reintroduces the same repaint.
 *
 * @param windowFromMs - the SELECTED window's start, epoch milliseconds
 * @param nowMs - the instant the request is being served, epoch milliseconds
 */
export function colorDomainWindow(windowFromMs: number, nowMs: number): ColorDomainWindow {
	const lookbackStartMs = nowMs - COLOR_DOMAIN_LOOKBACK_DAYS * DAY_MS;
	return { fromMs: Math.min(windowFromMs, lookbackStartMs), toMs: nowMs };
}

/** Everything the dashboard's URL says about what is on screen (D7) — the whole view state, read
 * once on the server and passed down, never re-derived by a client component. */
export interface DashboardView {
	preset: RangePreset;
	range: DateRange;
	tab: SplitTab;
	/** How the session list is ordered. Closed allowlist, like the tab: an unrecognised value must
	 * never reach the aggregation that turns it into a `$sort`. */
	sessionSort: SessionSort;
	/** Zero-based session-list page. Anything unusable in the URL reads as the first page — a
	 * page number is a position, and there is only one sensible position to fall back to. */
	pageIndex: number;
	/** D37 — true when a supplied RANGE parameter was unusable and the window fell back to the
	 * default, so the page can say so. A rejected `tab` does not set this: it changes which split is
	 * shown, not which period, and silently defaulting it is the D30 allowlist working as intended. */
	fellBack: boolean;
}

/**
 * Next's resolved search params as a `URLSearchParams`. A repeated key arrives as an array and is
 * dropped rather than joined — a joined value would be a string nothing in the allowlist matches,
 * which is the same outcome by a less obvious route.
 *
 * @param resolved - the awaited `searchParams`
 */
export function readSearchParams(resolved: Record<string, string | string[] | undefined>): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(resolved)) {
		if (typeof value === "string") params.set(key, value);
	}
	return params;
}

/**
 * Reads the dashboard's view state out of the URL (D7). Takes `now` and the corpus's earliest
 * event as parameters rather than reaching for `new Date()` or a query, so every rule below is
 * testable. Unrecognised values fall back to the default rather than reaching a query (D30/D37),
 * and every window is clamped to `[earliest recorded event, now]` (D36) — an unclamped `from`
 * would have gap fill (D11) synthesize thousands of day rows from a URL parameter.
 *
 * @param params - the request's search parameters
 * @param now - the instant the request is being served
 * @param earliestEvent - timestamp of the oldest recorded event, or `null` on an empty corpus
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function parseDashboardRange(
	params: URLSearchParams,
	now: Date,
	earliestEvent: Date | null,
	timeZone: string,
): DashboardView {
	const tab = parseSplitTab(params.get(SPLIT_TAB_PARAM));
	const pageIndex = parsePageIndex(params.get(SESSION_PAGE_PARAM));
	const sessionSort = parseSessionSort(params.get(SESSION_SORT_PARAM));
	const earliestDayStart = earliestEvent === null ? null : startOfDayInTimezone(earliestEvent, timeZone);

	// An explicit pair wins over any preset also in the URL (D37) — a stale preset left over from
	// an earlier link must not override the dates the operator actually picked.
	const custom = parseCustomRange(params.get(RANGE_FROM_PARAM), params.get(RANGE_TO_PARAM), timeZone);
	if (custom.range !== null) {
		return {
			preset: RangePreset.Custom,
			range: clampWindow(custom.range, earliestDayStart, now),
			tab,
			sessionSort,
			pageIndex,
			fellBack: false,
		};
	}

	const rawPreset = params.get(RANGE_PRESET_PARAM);
	const requested = parseRangePreset(rawPreset);
	// Present-but-unrecognised, not merely absent — an absent preset is the default, which is
	// nothing to announce; a supplied one the app can't honour changes the period on screen (D37).
	const unusablePreset = rawPreset !== null && requested === null;
	// Reaching this line with a supplied pair means it was unusable — the usable case returned above.
	// "All time" has no lower bound of its own; on an empty corpus there is nothing to anchor it to.
	const allTimeWithoutData = requested === RangePreset.AllTime && earliestEvent === null;
	const fellBack = unusablePreset || allTimeWithoutData || custom.supplied;
	const preset = fellBack ? DEFAULT_RANGE_PRESET : (requested ?? DEFAULT_RANGE_PRESET);

	const spanStart =
		preset === RangePreset.AllTime && earliestDayStart !== null
			? earliestDayStart
			: startOfDayInTimezone(new Date(now.getTime() - (PRESET_DAY_SPANS[preset] - 1) * DAY_MS), timeZone);

	return {
		preset,
		range: clampWindow({ from: spanStart, to: now }, earliestDayStart, now),
		tab,
		sessionSort,
		pageIndex,
		fellBack,
	};
}

/**
 * A `?sort=` value, falling back to the default order. Closed allowlist for the same reason the
 * tab is: the value chooses which field an aggregation sorts by.
 *
 * @param raw - the raw parameter value, or `null` when the key is absent
 */
function parseSessionSort(raw: string | null): SessionSort {
	const sorts: string[] = Object.values(SessionSort);
	return raw !== null && sorts.includes(raw) ? (raw as SessionSort) : DEFAULT_SESSION_SORT;
}

/**
 * A `?page=` value as a zero-based index. Anything not a whole page number at or above the first
 * one reads as the first page.
 *
 * @param raw - the raw parameter value, or `null` when the key is absent
 */
function parsePageIndex(raw: string | null): number {
	if (raw === null) return 0;
	const page = Number(raw);
	if (!Number.isInteger(page) || page < FIRST_PAGE) return 0;
	return page - FIRST_PAGE;
}

/**
 * Holds a window inside `[earliest recorded event, now]` (D36). Both ends matter: an unclamped
 * start would have gap fill (D11) synthesize a row per day back to whatever a URL asked for, and
 * an unclamped end would do the same forward — `?to=2099-01-01` is ~26,000 synthetic days.
 *
 * @param window - the requested window
 * @param earliestDayStart - local midnight of the first recorded event's day, or `null` if none
 * @param now - the instant the request is being served
 */
function clampWindow(window: DateRange, earliestDayStart: Date | null, now: Date): DateRange {
	const from = earliestDayStart !== null && window.from < earliestDayStart ? earliestDayStart : window.from;
	const to = window.to > now ? now : window.to;
	return { from, to };
}

/**
 * The `from`/`to` pair, as an inclusive window of whole local days.
 */
interface CustomRangeParse {
	/** True when either bound appeared in the URL. An ABSENT pair is the ordinary preset path; a
	 * SUPPLIED but unusable one is a lie about the period on screen and must be announced (D37). */
	supplied: boolean;
	/** The window, or `null` when the pair was absent, half-written, unparseable, or inverted. */
	range: DateRange | null;
}

/**
 * Reads an explicit `from`/`to` pair. Both bounds are required: the picker only ever writes them
 * together, so a lone one is a truncated or hand-edited link, and guessing the other end would
 * silently invent a period the operator never asked for.
 *
 * @param rawFrom - the `from` parameter, or `null` when absent
 * @param rawTo - the `to` parameter, or `null` when absent
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
function parseCustomRange(rawFrom: string | null, rawTo: string | null, timeZone: string): CustomRangeParse {
	const supplied = rawFrom !== null || rawTo !== null;
	if (rawFrom === null || rawTo === null) return { supplied, range: null };

	const fromDay = parseLocalDay(rawFrom, timeZone);
	const toDay = parseLocalDay(rawTo, timeZone);
	if (fromDay === null || toDay === null || fromDay > toDay) return { supplied, range: null };

	return { supplied, range: { from: fromDay, to: endOfDayInTimezone(toDay, timeZone) } };
}

/**
 * Local midnight of a `YYYY-MM-DD` day, or `null` when the string is not a real calendar day.
 *
 * @param raw - the parameter value
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
function parseLocalDay(raw: string, timeZone: string): Date | null {
	// Noon UTC to land inside the intended day before reading it in `timeZone`. Exact for every
	// offset strictly between -12 and +12, which covers `DASHBOARD_TIMEZONE` (UTC+7) with 5 hours
	// to spare; only the handful of zones at +12:45 and beyond would need a different anchor.
	const midday = new Date(`${raw}T12:00:00.000Z`);
	if (Number.isNaN(midday.getTime())) return null;
	// Round-tripping the parsed day back to a string is the whole validation: it rejects a shape
	// that is not exactly `YYYY-MM-DD` AND a well-formed day that does not exist (2026-02-31,
	// which `Date` silently rolls forward to March). A separate format check adds nothing — proven
	// by removing one and finding no test could tell the difference.
	if (midday.toISOString().slice(0, 10) !== raw) return null;

	return startOfDayInTimezone(midday, timeZone);
}

/** One calendar day. Preset spans step back in whole days from `now`; `DASHBOARD_TIMEZONE` has no
 * DST, so fixed-length arithmetic lands on the intended local day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A `?preset=` value, or `null` when it names no preset this app offers (D30 closed allowlist).
 *
 * @param raw - the raw parameter value, or `null` when the key is absent
 */
function parseRangePreset(raw: string | null): RangePreset | null {
	const presets: string[] = SELECTABLE_RANGE_PRESETS;
	return raw !== null && presets.includes(raw) ? (raw as RangePreset) : null;
}

/**
 * A `?tab=` value, falling back to the default split. D30 — the tab selects the field `costPerDay`
 * interpolates into its `$group`, so this allowlist is a security boundary, not input tidying.
 *
 * @param raw - the raw parameter value, or `null` when the key is absent
 */
function parseSplitTab(raw: string | null): SplitTab {
	const tabs: string[] = Object.values(SplitTab);
	return raw !== null && tabs.includes(raw) ? (raw as SplitTab) : DEFAULT_SPLIT_TAB;
}

/**
 * The UTC instant of local midnight on the 1st of the month containing `date`, in `timeZone` —
 * where "month to date" starts.
 *
 * @param date - any instant within the target local month
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function startOfMonthInTimezone(date: Date, timeZone: string): Date {
	const parts = timezonePartsAsUtcMs(date, timeZone);
	const offsetMs = parts.asIfUtcMs - date.getTime();
	const monthStartAsIfUtcMs = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0);
	return new Date(monthStartAsIfUtcMs - offsetMs);
}

/** How far through its month an instant is, in whole days. */
export interface MonthProgress {
	/** Days that have fully ended. Today is NOT one of them, so a rate built on this does not
	 * collapse every morning when only a few hours of it have happened (D13). Zero on the 1st. */
	completeElapsedDays: number;
	daysInMonth: number;
}

/**
 * How far through its month an instant is, read in `timeZone`.
 *
 * @param date - the instant to place within its month
 * @param timeZone - IANA timezone name (this repo always passes `DASHBOARD_TIMEZONE`)
 */
export function monthProgressInTimezone(date: Date, timeZone: string): MonthProgress {
	const parts = timezonePartsAsUtcMs(date, timeZone);
	return {
		completeElapsedDays: parts.day - 1,
		// Day 0 of the NEXT month is the last day of this one — the standard way to get a month's
		// length without a table of lengths and a leap-year rule.
		daysInMonth: new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate(),
	};
}

/**
 * What this month is on course to cost (D13): the month-to-date daily rate, extended over the
 * whole month. `null` before any day has fully ended — on the 1st the rate has no denominator,
 * and inventing one would put a fabricated number where a projection belongs (D42).
 *
 * @param monthCostUsd - spend so far this month, today's partial day included
 * @param completeElapsedDays - days that have fully ended
 * @param daysInMonth - days in this calendar month
 */
export function projectMonthEndCost(
	monthCostUsd: number,
	completeElapsedDays: number,
	daysInMonth: number,
): number | null {
	if (completeElapsedDays === 0) return null;
	return (monthCostUsd / completeElapsedDays) * daysInMonth;
}

/** The three figures the KPI tiles show, plus the unpriced counts each of them is a lower bound
 * against. Today's and the month's counts are tracked separately on purpose: a day with unpriced
 * events does not make every OTHER day's total uncertain. */
export interface MonthToDateSummary {
	todayCostUsd: number;
	todayUnpricedEventCount: number;
	monthCostUsd: number;
	monthUnpricedEventCount: number;
}

/**
 * Reduces a month's per-day rows to what the KPI tiles show. A day with no recorded work simply
 * has no row — including today, early enough in the morning — and reads as zero spend rather than
 * as missing data.
 *
 * @param rows - every day from the start of the month to now
 * @param todayKey - today's `YYYY-MM-DD` in the same calendar the rows are bucketed by
 */
export function summarizeMonthToDate(rows: DailyEfficiencyRow[], todayKey: string): MonthToDateSummary {
	const today = rows.find((row) => row.day === todayKey);

	return {
		todayCostUsd: today?.totalCostUsd ?? 0,
		todayUnpricedEventCount: today?.unpricedEventCount ?? 0,
		// Today included: its partial spend is money already spent, not a forecast.
		monthCostUsd: rows.reduce((sum, row) => sum + row.totalCostUsd, 0),
		monthUnpricedEventCount: rows.reduce((sum, row) => sum + row.unpricedEventCount, 0),
	};
}

/** How many dimension values get their own series before the rest fold into "Other" — the chart
 * palette has exactly this many usable slots. Shared so the Model tab and the model-mix chart cap
 * at the same point and cannot disagree about which names exist (D39). */
export const TOP_SERIES_COUNT = 5;

/** The bucket every model outside the top N folds into. Spelled once so the mix chart and the
 * Model tab cannot drift apart on it. */
export const OTHER_SERIES_KEY = "Other";

/** One day's model mix: each shown model's share of that day's priced spend. */
export interface ModelMixDayRow {
	day: string;
	/** Events recorded — what distinguishes a gap-filled day from a real zero (D24). */
	totalEventCount: number;
	/** Share 0-1 per model, or `null` on a day with no priced spend at all: a share of nothing is
	 * undefined, and a flat zero would read as "these models were not used" (D39). */
	[modelKey: string]: number | string | null;
}

/**
 * A model-mix row for a day with no recorded work (D24) — carries no model keys at all, so every
 * series breaks across it rather than dropping to zero.
 *
 * @param day - `YYYY-MM-DD`
 */
export function emptyModelMixRow(day: string): ModelMixDayRow {
	return { day, totalEventCount: 0 };
}

/**
 * Each day's model mix as a share of that day's PRICED spend (D27/D39) — the genuinely new
 * information next to the Model tab, which already shows absolute dollars: a deliberate shift to
 * a cheaper model shows up even in a week when the total moved too.
 *
 * Models outside `topModels` fold into "Other", exactly as the Model tab caps them, so the two
 * surfaces never disagree about which names exist or what colour they are.
 *
 * @param rows - per-day, per-model rows over the window
 * @param topModels - the models with their own series, already capped and ranked
 */
export function modelMixByDay(rows: DailyEfficiencyByModelRow[], topModels: string[]): ModelMixDayRow[] {
	const topSet = new Set(topModels);
	// Every series the chart will draw, resolved over the WHOLE window so each day can carry all of
	// them. The areas are stacked, so a day missing a key is a hole showing the page background —
	// not a thin band. "Other" only joins if some model actually falls outside the top set.
	const seriesKeys = rows.some((row) => !topSet.has(row.model)) ? [...topModels, OTHER_SERIES_KEY] : [...topModels];
	const byDay = new Map<string, { totalCostUsd: number; totalEventCount: number; costByKey: Map<string, number> }>();

	for (const row of rows) {
		const day = byDay.get(row.day) ?? { totalCostUsd: 0, totalEventCount: 0, costByKey: new Map() };
		const key = topSet.has(row.model) ? row.model : OTHER_SERIES_KEY;
		day.totalCostUsd += row.totalCostUsd;
		day.totalEventCount += row.totalEventCount;
		day.costByKey.set(key, (day.costByKey.get(key) ?? 0) + row.totalCostUsd);
		byDay.set(row.day, day);
	}

	return [...byDay.entries()]
		.map(([day, totals]) => {
			const mixRow: ModelMixDayRow = { day, totalEventCount: totals.totalEventCount };
			for (const key of seriesKeys) {
				// A day can have events but no PRICED spend, so the denominator is checked per day
				// rather than assumed from the row's existence. Only THAT makes a share undefined —
				// a model that simply went unused is a measured 0% of a day that did have spend.
				mixRow[key] = totals.totalCostUsd === 0 ? null : (totals.costByKey.get(key) ?? 0) / totals.totalCostUsd;
			}
			return mixRow;
		})
		.sort((a, b) => a.day.localeCompare(b.day));
}

/** One day's cache savings in dollars (D12). */
export interface DailySavingsRow {
	day: string;
	/** Saving from reads alone, before what populating the cache cost — the tooltip figure. */
	grossSavedUsd: number;
	/** What caching actually saved. NEGATIVE on a day whose writes were barely read back (D35). */
	netSavedUsd: number;
	/** False when any model on this day has no known price, so its zero is unmeasured rather than
	 * measured (D17's convention, applied to savings). */
	savingsKnown: boolean;
	/** Events recorded — what distinguishes a gap-filled day from a real zero (D24). */
	totalEventCount: number;
}

/**
 * Sums per-model rows into one savings figure per day. Receives dollars that were already priced
 * server-side; this module compiles into the CLIENT bundle, so it must never do pricing itself —
 * importing the price table here would ship it to the browser.
 *
 * @param rows - per-day, per-model rows carrying already-priced savings
 */
export function rollUpDailySavings(rows: DailyEfficiencyByModelRow[]): DailySavingsRow[] {
	const byDay = new Map<string, DailySavingsRow>();

	for (const row of rows) {
		const existing = byDay.get(row.day) ?? emptySavingsRow(row.day);
		existing.grossSavedUsd += row.grossSavedUsd;
		existing.netSavedUsd += row.netSavedUsd;
		existing.totalEventCount += row.totalEventCount;
		// One unpriced model makes the whole day's figure a floor, not a measurement.
		existing.savingsKnown = existing.savingsKnown && row.savingsKnown;
		byDay.set(row.day, existing);
	}

	return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * A zero-valued savings row for a day with no recorded work (D24) — the placeholder
 * `fillMissingBuckets` inserts so an absent day keeps its place on the axis.
 *
 * @param day - `YYYY-MM-DD`
 */
export function emptySavingsRow(day: string): DailySavingsRow {
	return { day, grossSavedUsd: 0, netSavedUsd: 0, savingsKnown: true, totalEventCount: 0 };
}

/**
 * States what caching did over a range, in words (D35). Negative money reads as a COST, not as a
 * negative saving — and it never renders as `$-1.98`, which puts the sign in the wrong place.
 *
 * @param netSavedUsd - net saving across the range; may be negative
 */
export function formatSavingsStatement(netSavedUsd: number): string {
	if (netSavedUsd < 0) return `Caching cost $${Math.abs(netSavedUsd).toFixed(2)} more than it saved`;
	return `Caching saved $${netSavedUsd.toFixed(2)}`;
}

/**
 * A zero-valued efficiency row for a day with no recorded work (D24) — the placeholder
 * `fillMissingBuckets` inserts so an absent day occupies its own position on the axis. Zeroing
 * `totalCostUsd` is what makes `subagentCostShare` return `null` for the day, which is what makes
 * the line's `connectNulls={false}` draw a real break across a gap.
 *
 * @param day - `YYYY-MM-DD`
 */
export function emptyEfficiencyRow(day: string): DailyEfficiencyRow {
	return {
		day,
		totalCostUsd: 0,
		subagentCostUsd: 0,
		totalEventCount: 0,
		subagentEventCount: 0,
		unpricedEventCount: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
	};
}

/**
 * A short, readable stand-in for a machine id: its first 8 characters, in a monospaced face
 * (D7 — matches the repo's one existing precedent, `session-table.tsx:43`'s
 * `.slice(0, 8)`). A no-op on anything already 8 characters or shorter, so a short id (like the
 * README setup probe's `"probe"`) is never lengthened or otherwise mangled (D18/R18).
 *
 * @param machineId - the machine's full stored id
 */
export function shortenMachineId(machineId: string): string {
	return machineId.slice(0, 8);
}

/**
 * What to show for a machine: its nickname, else a short id (D1/D7). The fallback the
 * whole mobile layout is built and tested against before the nickname feature ships (D6) — always
 * `undefined` until Step 9/10 land.
 *
 * An empty or whitespace-only nickname reads as ABSENT, not as a literal empty label (D14) — the
 * same rule the rename route already applies when STORING a name (clearing removes it rather than
 * saving ""), applied here too so a caller can never end up displaying nothing at all.
 *
 * The `(unattributed)` sentinel (R17) is never a real machine id — it stands in for a row whose
 * `machineId` was missing at ingest. Checked first and returned verbatim: shortening it would mangle
 * it into "(unattri", and a nickname parameter here would only ever be a bug (a real machine's
 * nickname is looked up by its OWN id, never by this literal string), so both are skipped
 * entirely rather than merely falling through the empty-nickname branch above. Keying the check on
 * `machineId`, not on `nickname`, is what keeps a real machine deliberately NAMED "(unattributed)"
 * showing its nickname normally (R5) — only the sentinel id itself takes this branch.
 *
 * @param nickname - the operator-assigned name, if one has been set
 * @param machineId - the machine's full stored id, or the `(unattributed)` sentinel
 */
export function machineDisplayName(nickname: string | undefined, machineId: string): string {
	if (machineId === UNATTRIBUTED_DIMENSION_VALUE) return UNATTRIBUTED_DIMENSION_VALUE;
	if (nickname === undefined || nickname.trim() === "") return shortenMachineId(machineId);
	return nickname;
}
