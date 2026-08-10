import type { Db } from "mongodb";

import { normalizeModel } from "@/parser/models.mjs";
import { cacheSavings, isPricedModel, turnCarrySplit } from "@/parser/pricing.mjs";

import {
	MACHINE_SYNC_STATE_COLLECTION,
	USAGE_EVENTS_COLLECTION,
	type MachineSyncStateDocument,
	type UsageEventDocument,
} from "./usage-store";

/** Fixed per D16 — a "day" is always Asia/Ho_Chi_Minh, never UTC or the viewer's browser zone. */
export const DASHBOARD_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Bounded window every dashboard query must carry so the existing time indexes are used. */
export interface DateRange {
	from: Date;
	to: Date;
}

/** Which stored field to split a cost-per-day view by. `Repo` is the odd one out: its stored
 * value is an opaque hash, not a label, so it never reaches a row's `dimensionValue` — see
 * `groupingFieldFor`. */
export enum CostSplitDimension {
	Machine = "machineId",
	Project = "projectSlug",
	Model = "model",
	Repo = "repoKey",
}

/**
 * One day's cost for one dimension value (a machine, a project, or a model).
 */
export interface DailyCostByDimensionRow {
	/** `YYYY-MM-DD` in `DASHBOARD_TIMEZONE` (D16). */
	day: string;
	dimensionValue: string;
	/** Sum of `costUsd` over `priced: true` events only — see `unpricedEventCount` (D17). */
	costUsd: number;
	/** Count of `priced: false` events folded into this day/dimension bucket. */
	unpricedEventCount: number;
	/** Total event count, priced and unpriced — the volume metric D8/D17 keep separate from cost. */
	eventCount: number;
}

/**
 * One day's subagent share and cache read-vs-write efficiency (Step 20). Ratios are NOT
 * computed here — dividing in Mongo risks NaN on a zero-denominator day, which is easier to
 * guard in the caller than in an aggregation expression. This returns raw sums only.
 */
export interface DailyEfficiencyRow {
	/** `YYYY-MM-DD` in `DASHBOARD_TIMEZONE` (D16). */
	day: string;
	/** Sum of `costUsd` over `priced: true` events only. */
	totalCostUsd: number;
	/** Sum of `costUsd` over `priced: true && isSubagent` events only. */
	subagentCostUsd: number;
	/** All events, priced and unpriced — the volume denominator for a count-based share. */
	totalEventCount: number;
	subagentEventCount: number;
	/** Count of `priced: false` events on this day (D17) — the KPI tiles' only signal that a
	 * month's total is a lower bound. Every other per-day row type in this file already carries
	 * one; this query predates the first consumer that needed it. */
	unpricedEventCount: number;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
}

/**
 * Subagent share of cost/volume, and cache read-vs-write token totals, per day (Step 20).
 * Every event contributes its token counts regardless of `priced` — tokens are real whether or
 * not the model's price was known at map time (D8).
 *
 * @param db - the connected database
 * @param range - required bound so the query hits `by_time`
 */
export async function dailyEfficiency(db: Db, range: DateRange): Promise<DailyEfficiencyRow[]> {
	return rollUpEfficiencyByDay(await dailyEfficiencyByModel(db, range));
}

/**
 * Sums per-model rows back to one row per day. Exported so the shared loader can roll up rows it
 * has ALREADY fetched, rather than issuing the same aggregation a second time.
 *
 * The dollar-savings fields are dropped: this shape
 * predates them and its two consumers (the subagent-share chart, the KPI tiles) do not read them.
 *
 * @param rows - per-day, per-model rows
 */
export function rollUpEfficiencyByDay(rows: DailyEfficiencyByModelRow[]): DailyEfficiencyRow[] {
	const byDay = new Map<string, DailyEfficiencyRow>();

	for (const row of rows) {
		const existing = byDay.get(row.day);
		if (existing) {
			existing.totalCostUsd += row.totalCostUsd;
			existing.subagentCostUsd += row.subagentCostUsd;
			existing.totalEventCount += row.totalEventCount;
			existing.subagentEventCount += row.subagentEventCount;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.inputTokens += row.inputTokens;
			existing.cacheReadTokens += row.cacheReadTokens;
			existing.cacheWrite5mTokens += row.cacheWrite5mTokens;
			existing.cacheWrite1hTokens += row.cacheWrite1hTokens;
		} else {
			byDay.set(row.day, {
				day: row.day,
				totalCostUsd: row.totalCostUsd,
				subagentCostUsd: row.subagentCostUsd,
				totalEventCount: row.totalEventCount,
				subagentEventCount: row.subagentEventCount,
				unpricedEventCount: row.unpricedEventCount,
				inputTokens: row.inputTokens,
				cacheReadTokens: row.cacheReadTokens,
				cacheWrite5mTokens: row.cacheWrite5mTokens,
				cacheWrite1hTokens: row.cacheWrite1hTokens,
			});
		}
	}

	return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** One day's efficiency for ONE model, with what caching saved on it in dollars (D12). */
export interface DailyEfficiencyByModelRow extends DailyEfficiencyRow {
	/** Normalized — raw variants of the same model are merged, as `costPerDay` already does. */
	model: string;
	/** Saving from cache reads alone, before what populating the cache cost. */
	grossSavedUsd: number;
	/** What the cache writes cost ABOVE the base input price — the part attributable to caching. */
	writePremiumUsd: number;
	/** `grossSavedUsd - writePremiumUsd`. Can be NEGATIVE (D35): a large one-hour write that is
	 * barely read back costs more than it saves. Never clamp it. */
	netSavedUsd: number;
	/** False when this model has no known price. Its dollar figures are then all zero, which is
	 * otherwise indistinguishable from a genuinely idle cache. */
	savingsKnown: boolean;
}

/**
 * Per-day, per-model efficiency, with cache savings priced (D12/D6a).
 *
 * @param db - the connected database
 * @param range - required bound so the query hits `by_time`
 */
export async function dailyEfficiencyByModel(db: Db, range: DateRange): Promise<DailyEfficiencyByModelRow[]> {
	const rows = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<RawEfficiencyByModelRow>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to } } },
			{
				$group: {
					_id: {
						day: { $dateToString: { date: "$timestamp", format: "%Y-%m-%d", timezone: DASHBOARD_TIMEZONE } },
						model: "$model",
						// D6a — prices are effective-dated as UTC instants while a dashboard day is
						// UTC+7, so a local day can straddle a price change. Splitting the key by UTC
						// day is what lets each side be priced at the rate it was actually billed at;
						// the sub-rows are summed back together straight after.
						utcDay: { $dateToString: { date: "$timestamp", format: "%Y-%m-%d" } },
					},
					totalCostUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					subagentCostUsd: { $sum: { $cond: [{ $and: ["$isSubagent", "$priced"] }, "$costUsd", 0] } },
					totalEventCount: { $sum: 1 },
					subagentEventCount: { $sum: { $cond: ["$isSubagent", 1, 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					inputTokens: { $sum: "$inputTokens" },
					cacheReadTokens: { $sum: "$cacheReadTokens" },
					cacheWrite5mTokens: { $sum: "$cacheWrite5mTokens" },
					cacheWrite1hTokens: { $sum: "$cacheWrite1hTokens" },
				},
			},
			{ $sort: { "_id.day": 1, "_id.model": 1 } },
		])
		.toArray();

	// Priced BEFORE the merge, each sub-row at its own UTC day's rate. Summing across UTC days
	// first and pricing the total afterwards is exactly the bug D6a exists to fix.
	const priced = rows.map((row) => {
		const savings = cacheSavings(row._id.model, row._id.utcDay, {
			cacheReadTokens: row.cacheReadTokens,
			cacheWrite5mTokens: row.cacheWrite5mTokens,
			cacheWrite1hTokens: row.cacheWrite1hTokens,
		});

		return {
			day: row._id.day,
			// Normalized here so a `[1m]` or dated variant of one model reads as one series, the
			// same merge `costPerDay` already does.
			model: normalizeModel(row._id.model),
			totalCostUsd: row.totalCostUsd,
			subagentCostUsd: row.subagentCostUsd,
			totalEventCount: row.totalEventCount,
			subagentEventCount: row.subagentEventCount,
			unpricedEventCount: row.unpricedEventCount,
			inputTokens: row.inputTokens,
			cacheReadTokens: row.cacheReadTokens,
			cacheWrite5mTokens: row.cacheWrite5mTokens,
			cacheWrite1hTokens: row.cacheWrite1hTokens,
			grossSavedUsd: savings.grossUsd,
			writePremiumUsd: savings.writePremiumUsd,
			netSavedUsd: savings.netUsd,
			savingsKnown: isPricedModel(row._id.model),
		};
	});

	return mergeEfficiencyByDayAndModel(priced);
}

/** Shape of one row Mongo's `$group` returns for `dailyEfficiencyByModel`. */
interface RawEfficiencyByModelRow {
	_id: { day: string; model: string; utcDay: string };
	totalCostUsd: number;
	subagentCostUsd: number;
	totalEventCount: number;
	subagentEventCount: number;
	unpricedEventCount: number;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
}

/**
 * Sums the UTC-day sub-rows of one local day back together, per normalized model — the dollar
 * fields included, since each sub-row was already priced at its own rate.
 *
 * @param rows - already-priced sub-rows, one per (local day, raw model, UTC day)
 */
function mergeEfficiencyByDayAndModel(rows: DailyEfficiencyByModelRow[]): DailyEfficiencyByModelRow[] {
	const merged = new Map<string, DailyEfficiencyByModelRow>();

	for (const row of rows) {
		const key = `${row.day} ${row.model}`;
		const existing = merged.get(key);

		if (existing) {
			existing.totalCostUsd += row.totalCostUsd;
			existing.subagentCostUsd += row.subagentCostUsd;
			existing.totalEventCount += row.totalEventCount;
			existing.subagentEventCount += row.subagentEventCount;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.inputTokens += row.inputTokens;
			existing.cacheReadTokens += row.cacheReadTokens;
			existing.cacheWrite5mTokens += row.cacheWrite5mTokens;
			existing.cacheWrite1hTokens += row.cacheWrite1hTokens;
			existing.grossSavedUsd += row.grossSavedUsd;
			existing.writePremiumUsd += row.writePremiumUsd;
			existing.netSavedUsd += row.netSavedUsd;
			existing.savingsKnown = existing.savingsKnown && row.savingsKnown;
		} else {
			merged.set(key, { ...row });
		}
	}

	return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model));
}

/** How `listSessions` orders its results. Every order carries the same session-id tie-break, so
 * paging stays stable whichever one is chosen (D38). */
export enum SessionSortOrder {
	/** Most expensive in the window first — the order that agrees with the chart above the list. */
	Cost = "cost",
	/** Most recently active first. */
	Recent = "recent",
	/** Busiest first, by event count. */
	Events = "events",
}

/** One session as it appears in the browsable list. */
export interface SessionListRow {
	sessionId: string;
	projectSlug: string;
	machineId: string;
	startedAt: Date;
	endedAt: Date;
	/** Cost WITHIN the selected window — what the list sorts by, so it agrees with the chart above
	 * it (D32). */
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
	/** Claude Code's own name for the session. Undefined when it never recorded one — sessions
	 * synced before titles were captured stay unnamed until a backfill re-run. */
	sessionTitle?: string;
	/** Normalized model names, so this is not the one surface in the app showing dated model ids. */
	models: string[];
	/** The session's cost across all time. Differs from `costUsd` only when the session straddles
	 * the window's edge, which happens routinely — showing it removes the surprise on click-through. */
	totalCostUsd: number;
	totalUnpricedEventCount: number;
}

/** One page of the session list, plus what the pager needs to know. */
export interface SessionListPage {
	rows: SessionListRow[];
	/** Sessions in the whole window, not just this page. */
	totalCount: number;
}

/**
 * One page of sessions that ran in the window, most expensive first (D9/D34).
 *
 * @param db - the connected database
 * @param range - required bound so the query hits `by_time`
 * @param pageIndex - zero-based page number
 * @param pageSize - rows per page
 */
export async function listSessions(
	db: Db,
	range: DateRange,
	pageIndex: number,
	pageSize: number,
	sort: SessionSortOrder,
): Promise<SessionListPage> {
	const [facet] = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<SessionListFacet>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to } } },
			{
				$group: {
					_id: "$sessionId",
					projectSlug: { $first: "$projectSlug" },
					machineId: { $first: "$machineId" },
					startedAt: { $min: "$timestamp" },
					endedAt: { $max: "$timestamp" },
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
					models: { $addToSet: "$model" },
					// Newest NON-NULL title. `$max` ignores null and missing, and BSON compares these
					// objects field-by-field — so `t` decides and the winner is the latest event that
					// actually carried a title. Reading the newest event's title outright would blank
					// a named session whenever its last tail sync missed the `ai-title` record.
					latestTitle: {
						$max: { $cond: [{ $ifNull: ["$sessionTitle", false] }, { t: "$timestamp", v: "$sessionTitle" }, null] },
					},
				},
			},
			{
				$facet: {
					page: [{ $sort: sortStageFor(sort) }, { $skip: pageIndex * pageSize }, { $limit: pageSize }],
					total: [{ $count: "count" }],
				},
			},
		])
		.toArray();

	const rows = facet?.page ?? [];
	// Only the sessions on THIS page, so the second lookup stays bounded no matter how wide the
	// window is. It reads `by_session`, which the range-bounded query above cannot use.
	const lifetime = await sessionLifetimeTotals(
		db,
		rows.map((row) => row._id),
	);

	return {
		rows: rows.map((row) => ({
			sessionId: row._id,
			projectSlug: row.projectSlug ?? UNATTRIBUTED_DIMENSION_VALUE,
			machineId: row.machineId ?? UNATTRIBUTED_DIMENSION_VALUE,
			startedAt: row.startedAt,
			endedAt: row.endedAt,
			costUsd: row.costUsd,
			unpricedEventCount: row.unpricedEventCount,
			eventCount: row.eventCount,
			sessionTitle: row.latestTitle?.v,
			// $addToSet returns the RAW stored strings; normalizing keeps this from being the one
			// surface in the app that shows dated model ids.
			models: [...new Set(row.models.map(normalizeModel))].sort(),
			totalCostUsd: lifetime.get(row._id)?.costUsd ?? row.costUsd,
			totalUnpricedEventCount: lifetime.get(row._id)?.unpricedEventCount ?? row.unpricedEventCount,
		})),
		totalCount: facet?.total[0]?.count ?? 0,
	};
}

/** One dimension value's drill-down: what it cost in the window, and the sessions that worked on
 * it. Header and list come from ONE aggregation, so the figure above the table is the sum of the
 * table by construction rather than by two queries happening to agree. */
export interface SplitValueBreakdown {
	/** The label as the dashboard row showed it, echoed back. */
	dimensionValue: string;
	/** Cost attributed to THIS value inside the window — not the whole cost of the sessions
	 * listed, which since per-turn attribution can span several repositories. */
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
	/** Sessions in the whole window, not just this page. */
	sessionCount: number;
	/** One page of them, ordered by `sort`. */
	sessions: SessionListRow[];
}

/**
 * One dimension value's drill-down page: the totals behind a cost-split row, plus a page of the
 * sessions that worked on it.
 *
 * @param db - the connected database
 * @param dimension - which split the value was read from
 * @param value - the row's visible label
 * @param range - required bound so the query hits `by_time`
 * @param pageIndex - zero-based page number
 * @param pageSize - rows per page
 * @param sort - which ordering to page through
 */
export async function splitValueBreakdown(
	db: Db,
	dimension: CostSplitDimension,
	value: string,
	range: DateRange,
	pageIndex: number,
	pageSize: number,
	sort: SessionSortOrder,
): Promise<SplitValueBreakdown> {
	const match = await splitValueMatch(db, dimension, value, range);

	const [facet] = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<SplitValueFacet>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to }, ...match } },
			{
				$group: {
					_id: "$sessionId",
					projectSlug: { $first: "$projectSlug" },
					machineId: { $first: "$machineId" },
					startedAt: { $min: "$timestamp" },
					endedAt: { $max: "$timestamp" },
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
					models: { $addToSet: "$model" },
					// Newest non-null title, exactly as `listSessions` reads it — see there for why the
					// newest EVENT's title is the wrong thing to read.
					latestTitle: {
						$max: { $cond: [{ $ifNull: ["$sessionTitle", false] }, { t: "$timestamp", v: "$sessionTitle" }, null] },
					},
				},
			},
			{
				// The header and the page come out of the same grouped set, so the figure above the
				// table is the sum of the table by construction — not two queries hoping to agree.
				$facet: {
					page: [{ $sort: sortStageFor(sort) }, { $skip: pageIndex * pageSize }, { $limit: pageSize }],
					totals: [
						{
							$group: {
								_id: null,
								costUsd: { $sum: "$costUsd" },
								unpricedEventCount: { $sum: "$unpricedEventCount" },
								eventCount: { $sum: "$eventCount" },
								sessionCount: { $sum: 1 },
							},
						},
					],
				},
			},
		])
		.toArray();

	const rows = facet?.page ?? [];
	const totals = facet?.totals[0];
	const lifetime = await sessionLifetimeTotals(
		db,
		rows.map((row) => row._id),
	);

	return {
		dimensionValue: value,
		costUsd: totals?.costUsd ?? 0,
		unpricedEventCount: totals?.unpricedEventCount ?? 0,
		eventCount: totals?.eventCount ?? 0,
		sessionCount: totals?.sessionCount ?? 0,
		sessions: rows.map((row) => ({
			sessionId: row._id,
			projectSlug: row.projectSlug ?? UNATTRIBUTED_DIMENSION_VALUE,
			machineId: row.machineId ?? UNATTRIBUTED_DIMENSION_VALUE,
			startedAt: row.startedAt,
			endedAt: row.endedAt,
			costUsd: row.costUsd,
			unpricedEventCount: row.unpricedEventCount,
			eventCount: row.eventCount,
			sessionTitle: row.latestTitle?.v,
			models: [...new Set(row.models.map(normalizeModel))].sort(),
			totalCostUsd: lifetime.get(row._id)?.costUsd ?? row.costUsd,
			totalUnpricedEventCount: lifetime.get(row._id)?.unpricedEventCount ?? row.unpricedEventCount,
		})),
	};
}

/** The drill-down `$facet`'s combined result shape. */
interface SplitValueFacet {
	page: RawSessionListRow[];
	totals: { costUsd: number; unpricedEventCount: number; eventCount: number; sessionCount: number }[];
}

/**
 * Turns a row's visible LABEL back into the events behind it. The label is not the query: every
 * split merges before it labels, so this has to reproduce the same merge or the page will disagree
 * with the row that was clicked.
 *
 * A value the dashboard never rendered resolves to a filter nothing matches, which surfaces as an
 * empty range rather than as an error — the same treatment an out-of-range window gets.
 *
 * @param db - the connected database
 * @param dimension - which split the value was read from
 * @param value - the row's visible label
 * @param range - the window the label was read in; labels are window-scoped, so this is required
 */
async function splitValueMatch(
	db: Db,
	dimension: CostSplitDimension,
	value: string,
	range: DateRange,
): Promise<Record<string, unknown>> {
	if (dimension === CostSplitDimension.Machine) return { machineId: value };

	// Model rows are labelled with the NORMALIZED name, so several raw stored strings can sit
	// behind one row — the same merge `mergeByNormalizedDimension` does after the `$group`.
	if (dimension === CostSplitDimension.Model) {
		const stored = await db
			.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
			.distinct("model", { timestamp: { $gte: range.from, $lte: range.to } });
		return { model: { $in: stored.filter((model) => normalizeModel(model) === value) } };
	}

	const repoKey = await repoKeyForLabel(db, value, range);

	if (dimension === CostSplitDimension.Repo) {
		// On this tab every repo-less row collapses into one named bucket, so drilling into it means
		// everything with no repository — not one project that happens to lack the field.
		if (value === UNATTRIBUTED_DIMENSION_VALUE) return { repoKey: { $exists: false } };
		return repoKey === undefined ? MATCHES_NOTHING : { repoKey };
	}

	// A project label can cover BOTH a repository and repo-less events carrying the same slug:
	// since per-turn attribution, a turn that resolved the repo and one that fell back to the
	// project directory land on the same name, and `rankDimensionTotals` sums them into one row.
	const repoLess = { projectSlug: value, repoKey: { $exists: false } };
	return repoKey === undefined ? repoLess : { $or: [{ repoKey }, repoLess] };
}

/** A filter for a label the dashboard never rendered. `$in: []` matches no document, which reads
 * downstream as an empty window rather than as a failure. */
const MATCHES_NOTHING = { _id: { $in: [] } };

/**
 * The repository a label names in this window, or undefined when no repository carries that label.
 * Runs the same labelling rule the split itself uses, so the two can never drift apart.
 *
 * @param db - the connected database
 * @param value - the row's visible label
 * @param range - the window the label was read in
 */
async function repoKeyForLabel(db: Db, value: string, range: DateRange): Promise<string | undefined> {
	const pairs = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<{ _id: { projectSlug: string | null; repoKey: string }; eventCount: number }>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to }, repoKey: { $exists: true } } },
			// The count is what `repoLabelsAcrossRange` ranks on, so it has to be REAL here: feeding
			// zeroes would tie every slug and silently fall through to the shortest one, giving this
			// side a different answer from the rows the dashboard rendered.
			{ $group: { _id: { projectSlug: "$projectSlug", repoKey: "$repoKey" }, eventCount: { $sum: 1 } } },
		])
		.toArray();

	const labels = repoLabelsAcrossRange(
		pairs.map((pair) => ({
			// The day is irrelevant to labelling and never compared against a real one.
			day: COLOR_DOMAIN_SENTINEL_DAY,
			dimensionValue: pair._id.projectSlug ?? UNATTRIBUTED_DIMENSION_VALUE,
			costUsd: 0,
			unpricedEventCount: 0,
			eventCount: pair.eventCount,
			repoKey: pair._id.repoKey,
		})),
	);

	for (const [repoKey, label] of labels) {
		if (label === value) return repoKey;
	}
	return undefined;
}

/**
 * The `$sort` document for an order. Built from a closed switch rather than by interpolating a
 * field name, and every arm carries `_id: 1`: D38 — without a tie-break, `$skip` over tied rows
 * puts a session on two pages or on none.
 *
 * @param sort - the requested order
 */
function sortStageFor(sort: SessionSortOrder): Record<string, 1 | -1> {
	if (sort === SessionSortOrder.Recent) return { endedAt: -1, _id: 1 };
	if (sort === SessionSortOrder.Events) return { eventCount: -1, _id: 1 };
	return { costUsd: -1, _id: 1 };
}

/** Shape of one grouped session before the lifetime lookup is folded in. */
interface RawSessionListRow {
	_id: string;
	projectSlug?: string;
	machineId?: string;
	startedAt: Date;
	endedAt: Date;
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
	models: string[];
	/** The `$max` composite — `t` only exists to order the comparison; `v` is the title itself.
	 * Null when no event in the session ever carried one. */
	latestTitle?: { t: Date; v: string } | null;
}

/** The `$facet` stage's combined result shape. */
interface SessionListFacet {
	page: RawSessionListRow[];
	total: { count: number }[];
}

/** A session's cost across all time, regardless of the selected window. */
interface SessionLifetimeTotal {
	costUsd: number;
	unpricedEventCount: number;
}

/**
 * All-time totals for a handful of sessions (D32) — what a row shows alongside its in-window
 * slice, so clicking through to a session that started before the window does not surprise.
 * Deliberately unbounded in time and bounded by session id instead: it reads `by_session`, and
 * the caller only ever passes one page's worth.
 *
 * @param db - the connected database
 * @param sessionIds - the sessions on the current page
 */
async function sessionLifetimeTotals(db: Db, sessionIds: string[]): Promise<Map<string, SessionLifetimeTotal>> {
	if (sessionIds.length === 0) return new Map();

	const rows = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<{ _id: string; costUsd: number; unpricedEventCount: number }>([
			{ $match: { sessionId: { $in: sessionIds } } },
			{
				$group: {
					_id: "$sessionId",
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
				},
			},
		])
		.toArray();

	return new Map(rows.map((row) => [row._id, { costUsd: row.costUsd, unpricedEventCount: row.unpricedEventCount }]));
}

/** One model's contribution to a session's total, sorted by cost descending. */
export interface SessionModelBreakdownRow {
	model: string;
	costUsd: number;
	unpricedEventCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
	subagentCostUsd: number;
	/** Count of unpriced events among the SUBAGENT events only — the lower-bound annotation for
	 * `subagentCostUsd` must describe subagent unpriced spend, not the whole model row's. */
	subagentUnpricedEventCount: number;
	eventCount: number;
}

/**
 * A single session's drill-down (Step 21): metadata plus a per-model cost breakdown.
 * Client-facing — never exposes `UsageEventDocument`'s internal identity fields
 * (`requestId`/`messageId`) per this repo's database-patterns rule.
 */
export interface SessionSummary {
	sessionId: string;
	projectSlug: string;
	machineId: string;
	/** `null` when every event in the session predates the account ledger (D7). */
	accountUuid: string | null;
	orgUuid: string | null;
	startedAt: Date;
	endedAt: Date;
	/** Sum of `costUsd` over `priced: true` events only — see `unpricedEventCount` (D17). */
	totalCostUsd: number;
	unpricedEventCount: number;
	byModel: SessionModelBreakdownRow[];
}

/**
 * A single session's full breakdown, by model (Step 21). `sessionId` is unindexed nowhere else
 * in this file's queries — `ensureUsageIndexes`'s `by_session` compound index is what keeps
 * this off a full collection scan.
 *
 * @param db - the connected database
 * @param sessionId - the session to look up
 * @returns `null` when no event carries this `sessionId`
 */
export async function getSessionBreakdown(db: Db, sessionId: string): Promise<SessionSummary | null> {
	const [facet] = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<SessionFacetResult>([
			{ $match: { sessionId } },
			{ $sort: { timestamp: 1 } },
			{
				$facet: {
					byModel: [
						{
							$group: {
								_id: "$model",
								costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
								unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
								inputTokens: { $sum: "$inputTokens" },
								outputTokens: { $sum: "$outputTokens" },
								cacheReadTokens: { $sum: "$cacheReadTokens" },
								cacheWrite5mTokens: { $sum: "$cacheWrite5mTokens" },
								cacheWrite1hTokens: { $sum: "$cacheWrite1hTokens" },
								subagentCostUsd: { $sum: { $cond: [{ $and: ["$isSubagent", "$priced"] }, "$costUsd", 0] } },
								subagentUnpricedEventCount: { $sum: { $cond: [{ $and: ["$isSubagent", { $not: "$priced" }] }, 1, 0] } },
								eventCount: { $sum: 1 },
							},
						},
					],
					meta: [
						{
							$group: {
								_id: null,
								projectSlug: { $first: "$projectSlug" },
								machineId: { $first: "$machineId" },
								// $first, not "mixed" detection: a session switching accounts mid-session
								// is a real but rare case (accountFor is resolved per-turn from the ledger).
								// Deliberate default — see DECISIONS.md.
								accountUuid: { $first: "$accountUuid" },
								orgUuid: { $first: "$orgUuid" },
								startedAt: { $min: "$timestamp" },
								endedAt: { $max: "$timestamp" },
								totalCostUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
								unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
							},
						},
					],
				},
			},
		])
		.toArray();

	const meta = facet?.meta[0];
	if (!meta) return null;

	const byModel = mergeSessionModelRowsByNormalizedModel(facet.byModel).sort((a, b) => b.costUsd - a.costUsd);

	return {
		sessionId,
		projectSlug: meta.projectSlug,
		machineId: meta.machineId,
		accountUuid: meta.accountUuid ?? null,
		orgUuid: meta.orgUuid ?? null,
		startedAt: meta.startedAt,
		endedAt: meta.endedAt,
		totalCostUsd: meta.totalCostUsd,
		unpricedEventCount: meta.unpricedEventCount,
		byModel,
	};
}

/** Shape of one row in the `byModel` facet before the raw-model merge. */
interface RawSessionModelRow {
	_id: string;
	costUsd: number;
	unpricedEventCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
	subagentCostUsd: number;
	subagentUnpricedEventCount: number;
	eventCount: number;
}

/** Shape of one row in the `meta` facet. */
interface RawSessionMetaRow {
	projectSlug: string;
	machineId: string;
	accountUuid?: string;
	orgUuid?: string;
	startedAt: Date;
	endedAt: Date;
	totalCostUsd: number;
	unpricedEventCount: number;
}

/** The `$facet` stage's combined result shape. */
interface SessionFacetResult {
	byModel: RawSessionModelRow[];
	meta: RawSessionMetaRow[];
}

/**
 * Merges `byModel` rows that share a model once their raw model string is normalized —
 * mirrors `mergeByNormalizedDimension`, scoped to a single session's rows.
 *
 * @param rows - rows keyed by raw model string
 */
function mergeSessionModelRowsByNormalizedModel(rows: RawSessionModelRow[]): SessionModelBreakdownRow[] {
	const merged = new Map<string, SessionModelBreakdownRow>();

	for (const row of rows) {
		const model = normalizeModel(row._id);
		const existing = merged.get(model);

		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.inputTokens += row.inputTokens;
			existing.outputTokens += row.outputTokens;
			existing.cacheReadTokens += row.cacheReadTokens;
			existing.cacheWrite5mTokens += row.cacheWrite5mTokens;
			existing.cacheWrite1hTokens += row.cacheWrite1hTokens;
			existing.subagentCostUsd += row.subagentCostUsd;
			existing.subagentUnpricedEventCount += row.subagentUnpricedEventCount;
			existing.eventCount += row.eventCount;
		} else {
			merged.set(model, {
				model,
				costUsd: row.costUsd,
				unpricedEventCount: row.unpricedEventCount,
				inputTokens: row.inputTokens,
				outputTokens: row.outputTokens,
				cacheReadTokens: row.cacheReadTokens,
				cacheWrite5mTokens: row.cacheWrite5mTokens,
				cacheWrite1hTokens: row.cacheWrite1hTokens,
				subagentCostUsd: row.subagentCostUsd,
				subagentUnpricedEventCount: row.subagentUnpricedEventCount,
				eventCount: row.eventCount,
			});
		}
	}

	return [...merged.values()];
}

/** One turn (event) in a session's timeline, in the order it happened (card #161 Step 5/6). */
export interface SessionTurnRow {
	timestamp: Date;
	isSubagent: boolean;
	/** Whether this turn's `costUsd`/split can be trusted — an unpriced turn's dollars are all
	 * zero (see below), so a caller bucketing turns needs this to mark a mixed bucket as a lower
	 * bound instead of a complete figure (card #161 F2 adversarial Fix C / R38). */
	priced: boolean;
	costUsd: number;
	/** Re-paying existing context — `carry + new === costUsd` exactly (D11's residual). */
	carryUsd: number;
	/** Buying new work — the residual `costUsd - carryUsd`, clamped at zero. */
	newUsd: number;
}

/** Fields `getSessionTurns`' own mapper reads — the ONLY thing a per-turn read path should pull
 * across the wire (card #161 F2 adversarial Fix B / R46). A large session still fetches every
 * matching document (the ≤20-bar cap is on the CHART, never on which turns count toward the
 * totals) — this narrows each one, it never narrows the row count. */
const SESSION_TURN_PROJECTION = {
	_id: 0,
	model: 1,
	timestamp: 1,
	cacheReadTokens: 1,
	cacheWrite5mTokens: 1,
	cacheWrite1hTokens: 1,
	costUsd: 1,
	priced: 1,
	isSubagent: 1,
} as const;

/**
 * A session's turns, one row per event, oldest first (card #161 Step 5) — the per-turn read path
 * `getSessionBreakdown` does not provide (it only returns pre-aggregated per-model totals).
 *
 * @param db - the connected database
 * @param sessionId - the session to look up
 */
export async function getSessionTurns(db: Db, sessionId: string): Promise<SessionTurnRow[]> {
	// Ascending timestamp is what `by_session` ({sessionId:1, timestamp:1}) already sorts by, so
	// this is served pre-sorted rather than by a separate in-memory sort.
	const events = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.find({ sessionId }, { projection: SESSION_TURN_PROJECTION })
		.sort({ timestamp: 1 })
		.toArray();

	return events.map((event) => {
		// Same $cond: ["$priced", ...] convention as every other dollar figure in this file: an
		// unpriced event's cache tokens still exist, but its untrusted costUsd must not leak a
		// nonzero split. Priced EACH turn at its OWN stored timestamp — never a session-wide rate.
		const split = event.priced
			? turnCarrySplit(
					event.model,
					event.timestamp.toISOString(),
					{
						cacheReadTokens: event.cacheReadTokens,
						cacheWrite5mTokens: event.cacheWrite5mTokens,
						cacheWrite1hTokens: event.cacheWrite1hTokens,
					},
					event.costUsd,
				)
			: { carryUsd: 0, newUsd: 0 };

		return {
			timestamp: event.timestamp,
			isSubagent: event.isSubagent,
			priced: event.priced,
			costUsd: event.priced ? event.costUsd : 0,
			carryUsd: split.carryUsd,
			newUsd: split.newUsd,
		};
	});
}

/**
 * Cost per day, split by machine, project, or model (Step 19). A day with unpriced events in
 * range still returns `costUsd` — the caller renders it as a lower bound using
 * `unpricedEventCount` (D17); this function never estimates or hides an unpriced total.
 *
 * @param db - the connected database
 * @param dimension - which stored field to split by
 * @param range - required bound so the query hits `by_time`/`by_machine_time`/`by_project_time`
 */
export async function costPerDay(
	db: Db,
	dimension: CostSplitDimension,
	range: DateRange,
): Promise<DailyCostByDimensionRow[]> {
	const rows = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<RawDimensionRow>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to } } },
			{
				$group: {
					_id: dimensionGroupId(dimension, {
						$dateToString: { date: "$timestamp", format: "%Y-%m-%d", timezone: DASHBOARD_TIMEZONE },
					}),
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
				},
			},
			{ $sort: { "_id.day": 1 } },
		])
		.toArray();

	const dimensionRows: DimensionRowWithRepoKey[] = rows.map(toDimensionRow);

	// Model strings are stored raw (binding decision) — several raw values normalize to the
	// same model (a `[1m]` suffix, a dated release), so their day/dimension buckets must be
	// re-merged after Mongo's grouping, which only sees the raw string.
	if (dimension === CostSplitDimension.Model) return mergeByNormalizedDimension(dimensionRows).map(dropRepoKey);
	// D20: worktrees group by the git remote resolved and hashed at sync time, not by name — a
	// name-prefix rule was explicitly rejected (a confirmed real false positive: an unrelated
	// repo can share a prefix with a genuine worktree pair). repoKey is opaque, so the merged
	// row is labeled with the SHORTEST projectSlug in the group (the main checkout).
	if (dimension === CostSplitDimension.Project) return mergeProjectRowsByRepoKey(dimensionRows).map(dropRepoKey);
	// D14/D31: the same repoKey grouping as Project, but every repo-less row folds into ONE named
	// bucket — on this tab "no repository" is a single real answer.
	if (dimension === CostSplitDimension.Repo) return mergeRepoRows(dimensionRows).map(dropRepoKey);
	return dimensionRows.map(dropRepoKey);
}

/**
 * Which stored field a dimension's `$group` reads its label from. Every dimension reads its own
 * field except `Repo`, which reads the project slug: `repoKey` is an unsalted SHA-256 over a
 * normalised git remote, so it is dictionary-confirmable — an identifier, not an opaque token —
 * and interpolating it here would put it straight into a visible row label (D31).
 *
 * @param dimension - the split being grouped
 */
function groupingFieldFor(dimension: CostSplitDimension): string {
	return dimension === CostSplitDimension.Repo ? CostSplitDimension.Project : dimension;
}

/**
 * The oldest recorded event's timestamp, or `null` when nothing has been recorded yet. This is
 * what gives "all time" a real lower bound (D36) — every query must carry a time bound, so the
 * widest window still resolves to `[this, now]` rather than running unbounded. Served from the
 * `by_time` index as a one-document sorted read, never a scan.
 *
 * @param db - the connected database
 */
export async function earliestEventTimestamp(db: Db): Promise<Date | null> {
	const oldest = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({}, { projection: { timestamp: 1 }, sort: { timestamp: 1 } });

	return oldest?.timestamp ?? null;
}

/** One machine's sync history for the dashboard tile. `lastContactAt`/`lastAcceptedAt` are `null`,
 * not absent, when the machine has never had a `machine_sync_state` row (card #161 D13). */
export interface MachineSyncStatusRow {
	machineId: string;
	lastContactAt: Date | null;
	lastAcceptedAt: Date | null;
}

/**
 * Every machine that has EITHER sent usage data OR successfully contacted the server, each
 * paired with its own `machine_sync_state` row when one exists. NOT scoped by the range picker
 * (D22 precedent: `earliestEventTimestamp`) — a staleness signal that dims with the window would
 * misread as "no sync in the selected range".
 *
 * The roster is the UNION of `usage_events`' distinct `machineId`s and `machine_sync_state`'s own
 * machine ids (card #161 Batch A fix pass, Fix 3) — not a left join FROM `usage_events` alone.
 * That matters for two disjoint shapes: a machine that synced before this feature shipped, or has
 * never once reached the server successfully, has events but no `machine_sync_state` row (D13);
 * a machine whose every event in a batch was rejected has contacted the server (a
 * `machine_sync_state` row exists) but has posted nothing that ever passed validation into
 * `usage_events`. Either one, alone, must still show up rather than being silently absent.
 *
 * Accepted cost: someone holding the shared secret can mint a permanent `machine_sync_state` row
 * under a made-up machineId with an empty batch — this query will list it. Not re-litigated here;
 * see D13.
 *
 * @param db - the connected database
 */
export async function machineSyncStatus(db: Db): Promise<MachineSyncStatusRow[]> {
	const [machineIdsFromEvents, syncStates] = await Promise.all([
		db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION).distinct("machineId"),
		db.collection<MachineSyncStateDocument>(MACHINE_SYNC_STATE_COLLECTION).find({}).toArray(),
	]);
	const syncStateByMachine = new Map(syncStates.map((state) => [state._id, state]));
	const allMachineIds = new Set([...machineIdsFromEvents, ...syncStates.map((state) => state._id)]);

	return [...allMachineIds]
		.map((machineId) => {
			const state = syncStateByMachine.get(machineId);
			return {
				machineId,
				lastContactAt: state?.lastContactAt ?? null,
				lastAcceptedAt: state?.lastAcceptedAt ?? null,
			};
		})
		.sort((a, b) => a.machineId.localeCompare(b.machineId));
}

/** `mergeByNormalizedDimension`/`mergeProjectRowsByRepoKey` key their dedup `Map` on `row.day`,
 * so reusing them for this day-less aggregation needs every row to carry the SAME constant day —
 * folding every row into one merge bucket per dimensionValue/repoKey, exactly like a real day
 * would. Never compared against a real `YYYY-MM-DD` day string. */
const COLOR_DOMAIN_SENTINEL_DAY = "__color-domain__";

/**
 * A dimension's value domain, ordered range-independently (D21): cost descending over
 * `lookbackRange`, alphabetical tie-break. Feeds `assignSeriesColorSlots` in `dashboard-format.ts`
 * so a value's chart colour depends on this fixed-lookback ranking, never on the currently
 * selected window's rank — the fix for colours repainting when the window changes. Runs the same
 * post-`$group` merges as `costPerDay` (normalized model, repoKey-grouped project) so the ordering
 * key matches the POST-merge `dimensionValue` the chart actually renders.
 *
 * @param db - the connected database
 * @param dimension - which stored field to rank
 * @param lookbackRange - a wide, fixed bound (365 days) so the ordering is stable across window changes
 */
export async function dimensionValueDomain(db: Db, dimension: CostSplitDimension, lookbackRange: DateRange): Promise<string[]> {
	const rows = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<RawDimensionRow>([
			{ $match: { timestamp: { $gte: lookbackRange.from, $lte: lookbackRange.to } } },
			{
				$group: {
					_id: dimensionGroupId(dimension, COLOR_DOMAIN_SENTINEL_DAY),
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
				},
			},
		])
		.toArray();

	const dimensionRows: DimensionRowWithRepoKey[] = rows.map(toDimensionRow);

	let merged: DimensionRowWithRepoKey[];
	if (dimension === CostSplitDimension.Model) merged = mergeByNormalizedDimension(dimensionRows);
	else if (dimension === CostSplitDimension.Project) merged = mergeProjectRowsByRepoKey(dimensionRows);
	else if (dimension === CostSplitDimension.Repo) merged = mergeRepoRows(dimensionRows);
	else merged = dimensionRows;

	return merged
		.sort((a, b) => b.costUsd - a.costUsd || a.dimensionValue.localeCompare(b.dimensionValue))
		.map((row) => row.dimensionValue);
}

/** Label for a row whose grouping field was missing/null at ingest — a rogue or older client can
 * post an event without it (D7 gives the account dimension the same "unattributed" treatment). */
const UNATTRIBUTED_DIMENSION_VALUE = "(unattributed)";

/** Shape of one row Mongo's `$group` returns before the raw-model merge. `dimensionValue` can be
 * `null` when the grouped field was missing on the stored document, and `repoKey` likewise when the
 * event resolved no repository. */
interface RawDimensionRow {
	_id: { day: string; dimensionValue: string | null; repoKey?: string | null };
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
}

/**
 * The `$group` key for a daily split. The two repository-merging dimensions group by repoKey TOO,
 * so a folder that carries several repositories' keys — or some events with one and some with none
 * — arrives as one row per repository instead of one row per folder. Carrying the key as `$first`
 * instead kept exactly one per folder and silently dropped the others, which both under-counted the
 * repository's row and let the label the drill-down derives disagree with the one rendered.
 *
 * Machine and Model do not group by it: their rows are keyed by their own field, and adding a
 * repository would split one machine's day into several rows the chart then draws twice.
 *
 * @param dimension - the split being grouped
 * @param day - the `$dateToString` expression, or the sentinel the colour domain groups on
 */
function dimensionGroupId(dimension: CostSplitDimension, day: unknown): Record<string, unknown> {
	const mergesByRepo = dimension === CostSplitDimension.Project || dimension === CostSplitDimension.Repo;
	return { day, dimensionValue: `$${groupingFieldFor(dimension)}`, ...(mergesByRepo && { repoKey: "$repoKey" }) };
}

/**
 * One aggregated row in the shape the merge helpers expect.
 *
 * @param row - a row as Mongo grouped it
 */
function toDimensionRow(row: RawDimensionRow): DimensionRowWithRepoKey {
	return {
		day: row._id.day,
		// A rogue/older client can post an event missing the grouping field entirely (route.ts
		// copies every per-event field unvalidated) — `null`/`undefined` must never reach the page
		// as a blank label and a duplicate `null` React key; it renders as explicitly unattributed,
		// the same treatment the account dimension already gives a missing accountUuid (D7).
		dimensionValue: row._id.dimensionValue ?? UNATTRIBUTED_DIMENSION_VALUE,
		costUsd: row.costUsd,
		unpricedEventCount: row.unpricedEventCount,
		eventCount: row.eventCount,
		// Absent, never null, so `!row.repoKey` reads the same for both shapes downstream.
		repoKey: row._id.repoKey ?? undefined,
	};
}

/** `DailyCostByDimensionRow` plus the grouping key used only inside this file, never returned. */
interface DimensionRowWithRepoKey extends DailyCostByDimensionRow {
	repoKey?: string;
}

/**
 * Merges rows that share a day once their `dimensionValue` (a raw model string) is normalized —
 * `costPerDay`'s only caller for the `Model` dimension.
 *
 * @param rows - rows keyed by (day, raw dimensionValue)
 */
function mergeByNormalizedDimension(rows: DimensionRowWithRepoKey[]): DimensionRowWithRepoKey[] {
	const merged = new Map<string, DimensionRowWithRepoKey>();

	for (const row of rows) {
		const dimensionValue = normalizeModel(row.dimensionValue);
		const key = `${row.day} ${dimensionValue}`;
		const existing = merged.get(key);

		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.eventCount += row.eventCount;
		} else {
			merged.set(key, { ...row, dimensionValue });
		}
	}

	return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Folds project rows that share a repository (D20: same normalized git remote, hashed at sync
 * time) into one row per day, labeled with the SHORTEST projectSlug in the group — the main
 * checkout, not a ticket-branch worktree. A project with no repoKey (its recorded cwd wasn't a
 * git repo, or no longer exists) stands alone, keyed by its own slug — never merged by name.
 *
 * @param rows - rows keyed by (day, raw projectSlug), each carrying its repoKey when resolved
 */
function mergeProjectRowsByRepoKey(rows: DimensionRowWithRepoKey[]): DimensionRowWithRepoKey[] {
	const labels = repoLabelsAcrossRange(rows);
	const merged = new Map<string, DimensionRowWithRepoKey>();

	for (const row of rows) {
		// A repo-less project is keyed by its own slug so it never merges with another repo-less
		// project just because both happen to lack a repoKey.
		const groupKey = row.repoKey ? `${row.day} repo:${row.repoKey}` : `${row.day} slug:${row.dimensionValue}`;
		const existing = merged.get(groupKey);

		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.eventCount += row.eventCount;
		} else {
			merged.set(groupKey, { ...row, dimensionValue: labelFor(row, labels) });
		}
	}

	return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Each repository's label across the WHOLE range: the projectSlug that carried the most of its
 * events anywhere in the window, ties broken by shortest slug and then alphabetically so the choice
 * never depends on the order Mongo returned.
 *
 * Most-events rather than shortest-slug, because a folder that merely CONTAINS repositories has a
 * short name and picks up real spend whenever a turn is attributed to a repository from outside it
 * — enough for `git-repos/personal` to outrank both `personal/claude-usage` and
 * `personal/quant-trading` and take BOTH their names at once. The shortest-slug tie-break keeps
 * D20's original case intact: a main checkout and its worktree that each ran once still resolve to
 * the main checkout.
 *
 * Resolved before any per-day grouping, and that ordering is the point. Choosing within each DAY
 * names a repository after whichever checkout happened to run that day, so one repository splits
 * into two ranked rows the moment a worktree works a branch alone — each holding part of the cost,
 * and each drilling down to part of the sessions.
 *
 * @param rows - every row in the window, each carrying its repoKey when one was resolved
 */
function repoLabelsAcrossRange(rows: DimensionRowWithRepoKey[]): Map<string, string> {
	// Accumulated across days first: a slug's claim is its whole-window volume, not its best day.
	const eventsByRepoAndSlug = new Map<string, Map<string, number>>();

	for (const row of rows) {
		if (!row.repoKey) continue;
		const bySlug = eventsByRepoAndSlug.get(row.repoKey) ?? new Map<string, number>();
		bySlug.set(row.dimensionValue, (bySlug.get(row.dimensionValue) ?? 0) + row.eventCount);
		eventsByRepoAndSlug.set(row.repoKey, bySlug);
	}

	const labels = new Map<string, string>();
	for (const [repoKey, bySlug] of eventsByRepoAndSlug) {
		const ranked = [...bySlug].sort(
			([slugA, eventsA], [slugB, eventsB]) =>
				eventsB - eventsA || slugA.length - slugB.length || (slugA < slugB ? -1 : slugA > slugB ? 1 : 0),
		);
		labels.set(repoKey, ranked[0][0]);
	}

	return labels;
}

/**
 * A row's display label: its repository's window-wide name, or its own slug when it has no
 * repository.
 *
 * @param row - the row being labelled
 * @param labels - repository labels from `repoLabelsAcrossRange`
 */
function labelFor(row: DimensionRowWithRepoKey, labels: Map<string, string>): string {
	if (!row.repoKey) return row.dimensionValue;
	return labels.get(row.repoKey) ?? row.dimensionValue;
}

/**
 * Folds rows into one row per repository per day, labeled with the SHORTEST projectSlug in the
 * group (D20's convention, since repoKey is opaque). Differs from `mergeProjectRowsByRepoKey` in
 * one deliberate way: every row with NO repoKey collapses into a single explicitly-named bucket
 * rather than standing alone. On the Project tab those are separate projects that happen to share
 * a missing field; on this tab "no repository" is the answer itself, and today that is over half
 * of all spend — splitting it across project names would hide how much is unattributed.
 *
 * @param rows - rows keyed by (day, projectSlug), each carrying its repoKey when resolved
 */
function mergeRepoRows(rows: DimensionRowWithRepoKey[]): DimensionRowWithRepoKey[] {
	const labels = repoLabelsAcrossRange(rows);
	const merged = new Map<string, DimensionRowWithRepoKey>();

	for (const row of rows) {
		const groupKey = row.repoKey ? `${row.day} repo:${row.repoKey}` : `${row.day} repo:none`;
		const existing = merged.get(groupKey);

		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.eventCount += row.eventCount;
		} else {
			// Only a real repository takes a label from its slugs; the unattributed bucket keeps its
			// own name however many projects land in it.
			merged.set(groupKey, {
				...row,
				dimensionValue: row.repoKey ? labelFor(row, labels) : UNATTRIBUTED_DIMENSION_VALUE,
			});
		}
	}

	return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Strips the internal grouping key before a row leaves this file — never exposed to callers. */
function dropRepoKey(row: DimensionRowWithRepoKey): DailyCostByDimensionRow {
	const { repoKey, ...rest } = row;
	return rest;
}
