import type { Db } from "mongodb";

import { normalizeModel } from "@/parser/models.mjs";

import { USAGE_EVENTS_COLLECTION, type UsageEventDocument } from "./usage-store";

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
	const rows = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.aggregate<RawEfficiencyRow>([
			{ $match: { timestamp: { $gte: range.from, $lte: range.to } } },
			{
				$group: {
					_id: { day: { $dateToString: { date: "$timestamp", format: "%Y-%m-%d", timezone: DASHBOARD_TIMEZONE } } },
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
			{ $sort: { "_id.day": 1 } },
		])
		.toArray();

	return rows.map((row) => ({
		day: row._id.day,
		totalCostUsd: row.totalCostUsd,
		subagentCostUsd: row.subagentCostUsd,
		totalEventCount: row.totalEventCount,
		subagentEventCount: row.subagentEventCount,
		unpricedEventCount: row.unpricedEventCount,
		inputTokens: row.inputTokens,
		cacheReadTokens: row.cacheReadTokens,
		cacheWrite5mTokens: row.cacheWrite5mTokens,
		cacheWrite1hTokens: row.cacheWrite1hTokens,
	}));
}

/** Shape of one row Mongo's `$group` returns for `dailyEfficiency`. */
interface RawEfficiencyRow {
	_id: { day: string };
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
					_id: {
						day: { $dateToString: { date: "$timestamp", format: "%Y-%m-%d", timezone: DASHBOARD_TIMEZONE } },
						dimensionValue: `$${groupingFieldFor(dimension)}`,
					},
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
					// Consumed by the Project and Repo rollups below — harmless (and cheap) to
					// compute for Machine/Model too rather than branching the pipeline.
					repoKey: { $first: "$repoKey" },
				},
			},
			{ $sort: { "_id.day": 1 } },
		])
		.toArray();

	const dimensionRows: DimensionRowWithRepoKey[] = rows.map((row) => ({
		day: row._id.day,
		// A rogue/older client can post an event missing this field entirely (route.ts copies
		// every per-event field unvalidated) — `null`/`undefined` must never reach the page as a
		// blank label and a duplicate `null` React key; it renders as explicitly unattributed,
		// the same treatment the account dimension already gives a missing accountUuid (D7).
		dimensionValue: row._id.dimensionValue ?? UNATTRIBUTED_DIMENSION_VALUE,
		costUsd: row.costUsd,
		unpricedEventCount: row.unpricedEventCount,
		eventCount: row.eventCount,
		repoKey: row.repoKey,
	}));

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
					_id: { day: COLOR_DOMAIN_SENTINEL_DAY, dimensionValue: `$${groupingFieldFor(dimension)}` },
					costUsd: { $sum: { $cond: ["$priced", "$costUsd", 0] } },
					unpricedEventCount: { $sum: { $cond: ["$priced", 0, 1] } },
					eventCount: { $sum: 1 },
					repoKey: { $first: "$repoKey" },
				},
			},
		])
		.toArray();

	const dimensionRows: DimensionRowWithRepoKey[] = rows.map((row) => ({
		day: row._id.day,
		dimensionValue: row._id.dimensionValue ?? UNATTRIBUTED_DIMENSION_VALUE,
		costUsd: row.costUsd,
		unpricedEventCount: row.unpricedEventCount,
		eventCount: row.eventCount,
		repoKey: row.repoKey,
	}));

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
 * `null` when the grouped field was missing on the stored document. */
interface RawDimensionRow {
	_id: { day: string; dimensionValue: string | null };
	costUsd: number;
	unpricedEventCount: number;
	eventCount: number;
	repoKey?: string;
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
			if (row.dimensionValue.length < existing.dimensionValue.length) existing.dimensionValue = row.dimensionValue;
		} else {
			merged.set(groupKey, { ...row });
		}
	}

	return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day));
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
	const merged = new Map<string, DimensionRowWithRepoKey>();

	for (const row of rows) {
		const groupKey = row.repoKey ? `${row.day} repo:${row.repoKey}` : `${row.day} repo:none`;
		const existing = merged.get(groupKey);

		if (existing) {
			existing.costUsd += row.costUsd;
			existing.unpricedEventCount += row.unpricedEventCount;
			existing.eventCount += row.eventCount;
			// Only a real repository picks a label from its slugs; the unattributed bucket keeps its
			// own name however many projects land in it.
			if (row.repoKey && row.dimensionValue.length < existing.dimensionValue.length) {
				existing.dimensionValue = row.dimensionValue;
			}
		} else {
			merged.set(groupKey, {
				...row,
				dimensionValue: row.repoKey ? row.dimensionValue : UNATTRIBUTED_DIMENSION_VALUE,
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
