import { cache } from "react";

import { getDatabase } from "@/server/database";
import {
	type CostSplitDimension,
	type DailyCostByDimensionRow,
	type DailyEfficiencyByModelRow,
	type DailyEfficiencyRow,
	costPerDay,
	dailyEfficiencyByModel,
	type SessionListPage,
	dimensionValueDomain,
	earliestEventTimestamp,
	machineSyncStatus,
	type MachineSyncStatusRow,
	type SessionSortOrder,
	type SplitValueBreakdown,
	listSessions,
	rollUpEfficiencyByDay,
	splitValueBreakdown,
} from "@/server/usage-queries";

/**
 * Shared per-request loaders for data more than one card needs.
 *
 * Every loader takes PRIMITIVES and is wrapped in `cache()` exactly once, here, at module scope.
 * Both halves of that are load-bearing (D26, measured): `cache()` memoises on argument IDENTITY,
 * so three siblings passing freshly-built `{from, to}` objects — or `Date`s — run the query three
 * times, silently, with nothing failing. Wrapping inside a component or a factory would create a
 * fresh cache per render and defeat it the same way.
 *
 * `cache()` also caches THROWN errors, so one failed query is re-thrown to every consumer — which
 * is why each card carries its own error boundary rather than relying on a route-level `error.tsx`.
 */

/**
 * The corpus's earliest recorded event, in epoch milliseconds, or `null` when nothing is recorded.
 * Read once per request and reused by the range parser and the picker's bounds (D36).
 */
export const loadEarliestEventMs = cache(async (): Promise<number | null> => {
	const db = await getDatabase();
	const earliest = await earliestEventTimestamp(db);
	return earliest === null ? null : earliest.getTime();
});

/**
 * Every machine's raw sync status. Zero-arg, like `loadEarliestEventMs` — NOT scoped by the range
 * picker (D22 precedent), so it is read once per request and shared by whatever renders it.
 */
export const loadMachineSyncStatus = cache(async (): Promise<MachineSyncStatusRow[]> => {
	const db = await getDatabase();
	return machineSyncStatus(db);
});

/**
 * Cost per day for one split dimension over a window.
 *
 * @param dimension - which stored field to split by
 * @param fromMs - window start, epoch milliseconds
 * @param toMs - window end, epoch milliseconds
 */
export const loadCostPerDay = cache(
	async (dimension: CostSplitDimension, fromMs: number, toMs: number): Promise<DailyCostByDimensionRow[]> => {
		const db = await getDatabase();
		return costPerDay(db, dimension, { from: new Date(fromMs), to: new Date(toMs) });
	},
);

/**
 * A dimension's range-independent value ordering, used to keep chart colours stable (D21).
 *
 * @param dimension - which stored field to rank
 * @param fromMs - lookback start, epoch milliseconds
 * @param toMs - lookback end, epoch milliseconds
 */
export const loadDimensionDomain = cache(
	async (dimension: CostSplitDimension, fromMs: number, toMs: number): Promise<string[]> => {
		const db = await getDatabase();
		return dimensionValueDomain(db, dimension, { from: new Date(fromMs), to: new Date(toMs) });
	},
);

/**
 * Per-day, per-model efficiency with cache savings priced — read by the savings chart and the
 * model-mix chart, which is exactly the shared-loader case.
 *
 * @param fromMs - window start, epoch milliseconds
 * @param toMs - window end, epoch milliseconds
 */
export const loadDailyEfficiencyByModel = cache(
	async (fromMs: number, toMs: number): Promise<DailyEfficiencyByModelRow[]> => {
		const db = await getDatabase();
		return dailyEfficiencyByModel(db, { from: new Date(fromMs), to: new Date(toMs) });
	},
);

/**
 * Per-day subagent share and cache token totals — read by two separate cards, which is exactly
 * the case this shared cache exists for.
 *
 * @param fromMs - window start, epoch milliseconds
 * @param toMs - window end, epoch milliseconds
 */
export const loadDailyEfficiency = cache(async (fromMs: number, toMs: number): Promise<DailyEfficiencyRow[]> => {
	// Rolled up from the per-model loader rather than queried separately: the two are the same
	// aggregation over the same window, and four cards read one or the other on every render.
	return rollUpEfficiencyByDay(await loadDailyEfficiencyByModel(fromMs, toMs));
});

/**
 * One page of the session list for a window.
 *
 * @param fromMs - window start, epoch milliseconds
 * @param toMs - window end, epoch milliseconds
 * @param pageIndex - zero-based page number
 * @param pageSize - rows per page
 * @param sort - which ordering to page through
 */
/**
 * One dimension value's drill-down: its window totals plus a page of the sessions behind them.
 *
 * @param dimension - which split the value was read from
 * @param value - the row's visible label
 * @param fromMs - window start, epoch milliseconds
 * @param toMs - window end, epoch milliseconds
 * @param pageIndex - zero-based page number
 * @param pageSize - rows per page
 * @param sort - which ordering to page through
 */
export const loadSplitValueBreakdown = cache(
	async (
		dimension: CostSplitDimension,
		value: string,
		fromMs: number,
		toMs: number,
		pageIndex: number,
		pageSize: number,
		sort: SessionSortOrder,
	): Promise<SplitValueBreakdown> => {
		const db = await getDatabase();
		return splitValueBreakdown(db, dimension, value, { from: new Date(fromMs), to: new Date(toMs) }, pageIndex, pageSize, sort);
	},
);

export const loadSessionPage = cache(
	async (
		fromMs: number,
		toMs: number,
		pageIndex: number,
		pageSize: number,
		sort: SessionSortOrder,
	): Promise<SessionListPage> => {
		const db = await getDatabase();
		return listSessions(db, { from: new Date(fromMs), to: new Date(toMs) }, pageIndex, pageSize, sort);
	},
);
