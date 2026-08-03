import type { DailyCostByDimensionRow, DailyEfficiencyRow, DateRange } from "@/server/usage-queries";

import { DEFAULT_SPLIT_TAB, SplitTab } from "./cost-split-view/cost-split-view.type";
import { RANGE_FROM_PARAM, RANGE_PRESET_PARAM, RANGE_TO_PARAM, SPLIT_TAB_PARAM } from "./href";
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

	return [...totals.values()].sort((a, b) => b.costUsd - a.costUsd);
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
 * Fills every absent calendar day between `firstDay` and `lastDay` inclusive with `makeEmpty`'s
 * result (D11/D24) — never overwrites a day already present in `rows`. Generic over the row
 * shape so the same function fills both `ChartDayRow[]` and `DailyEfficiencyRow[]`.
 *
 * @param rows - existing rows, each carrying its own `day`
 * @param firstDay - `YYYY-MM-DD`, inclusive
 * @param lastDay - `YYYY-MM-DD`, inclusive
 * @param makeEmpty - builds the placeholder row for one absent day
 */
export function fillMissingDays<T extends { day: string }>(
	rows: T[],
	firstDay: string,
	lastDay: string,
	makeEmpty: (day: string) => T,
): T[] {
	// Keyed by day so a real row always wins — building empties first and writing reals over them
	// would erase a day's own unpricedEventCount, silently deleting a D17 lower-bound warning.
	const present = new Map(rows.map((row) => [row.day, row]));

	const filled: T[] = [];
	for (let day = firstDay; day <= lastDay; day = nextDay(day)) {
		filled.push(present.get(day) ?? makeEmpty(day));
	}
	return filled;
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
 * Fraction of cache tokens that were reads rather than writes, as a fraction 0-1. `null` on a
 * day with zero cache activity (no reads and no writes).
 *
 * @param row - one day from `dailyEfficiency`
 */
export function cacheReadRatio(row: DailyEfficiencyRow): number | null {
	const totalCacheTokens = row.cacheReadTokens + row.cacheWrite5mTokens + row.cacheWrite1hTokens;
	if (totalCacheTokens === 0) return null;
	return row.cacheReadTokens / totalCacheTokens;
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

/** Everything the dashboard's URL says about what is on screen (D7) — the whole view state, read
 * once on the server and passed down, never re-derived by a client component. */
export interface DashboardView {
	preset: RangePreset;
	range: DateRange;
	tab: SplitTab;
	/** D37 — true when a supplied RANGE parameter was unusable and the window fell back to the
	 * default, so the page can say so. A rejected `tab` does not set this: it changes which split is
	 * shown, not which period, and silently defaulting it is the D30 allowlist working as intended. */
	fellBack: boolean;
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
	const earliestDayStart = earliestEvent === null ? null : startOfDayInTimezone(earliestEvent, timeZone);

	// An explicit pair wins over any preset also in the URL (D37) — a stale preset left over from
	// an earlier link must not override the dates the operator actually picked.
	const custom = parseCustomRange(params.get(RANGE_FROM_PARAM), params.get(RANGE_TO_PARAM), timeZone);
	if (custom.range !== null) {
		return {
			preset: RangePreset.Custom,
			range: clampWindow(custom.range, earliestDayStart, now),
			tab,
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

	return { preset, range: clampWindow({ from: spanStart, to: now }, earliestDayStart, now), tab, fellBack };
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
 * A zero-valued efficiency row for a day with no recorded work (D24) — the placeholder
 * `fillMissingDays` inserts so an absent day occupies its own position on the axis. Zeroing
 * `totalCostUsd` is what makes `subagentCostShare` and `cacheReadRatio` return `null` for the day,
 * which is what finally makes the lines' `connectNulls={false}` draw a real break across a gap.
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
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
	};
}
