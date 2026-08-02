import type { DailyCostByDimensionRow, DailyEfficiencyRow } from "@/server/usage-queries";

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
		const dayRow = byDay.get(row.day) ?? { day: row.day, unpricedEventCount: 0 };
		dayRow[seriesKey] = (Number(dayRow[seriesKey]) || 0) + row.costUsd;
		dayRow.unpricedEventCount += row.unpricedEventCount;
		byDay.set(row.day, dayRow);
	}

	return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
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
