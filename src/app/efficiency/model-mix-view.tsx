import { CostSplitDimension, DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import {
	TOP_SERIES_COUNT,
	assignSeriesColorSlots,
	dayKeyInTimezone,
	emptyModelMixRow,
	fillMissingBuckets,
	modelMixByDay,
	planDayBuckets,
	rankDimensionTotals,
	relabelRowsToBuckets,
} from "../dashboard-format";
import { loadDailyEfficiencyByModel, loadDimensionDomain } from "../dashboard-loaders";
import { ModelMixChart } from "./model-mix-chart";

export interface ModelMixViewProps {
	/** Selected window, epoch milliseconds. */
	fromMs: number;
	toMs: number;
	/** The colour-domain lookback, so a model's colour here matches the Model tab's (D21/D40). */
	domainFromMs: number;
	domainToMs: number;
}

/**
 * How the model mix shifts over the selected window (D27). Reads the same per-model rows the
 * savings card does, through the same cached loader, rather than issuing a second query.
 */
export async function ModelMixView({
	fromMs,
	toMs,
	domainFromMs,
	domainToMs,
}: ModelMixViewProps): Promise<React.JSX.Element> {
	const [rows, domainOrder] = await Promise.all([
		loadDailyEfficiencyByModel(fromMs, toMs),
		loadDimensionDomain(CostSplitDimension.Model, domainFromMs, domainToMs),
	]);

	// Ranked through the SAME function the Model tab uses, over the same window and the same
	// per-model totals — so the two surfaces cap at the same five names, in the same order, and
	// break ties the same way (D39/D38).
	const totals = rankDimensionTotals(
		rows.map((row) => ({
			day: row.day,
			dimensionValue: row.model,
			costUsd: row.totalCostUsd,
			unpricedEventCount: row.unpricedEventCount,
			eventCount: row.totalEventCount,
		})),
	);
	const topModels = totals.slice(0, TOP_SERIES_COUNT).map((total) => total.dimensionValue);

	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);
	// Relabelled BEFORE `modelMixByDay`, never after: a bucket's mix is the share of its SUMMED
	// spend, and combining the daily percentages instead would be wrong in a way that looks
	// entirely plausible on screen (D7).
	const buckets = planDayBuckets(firstDay, lastDay);
	const mix = fillMissingBuckets(modelMixByDay(relabelRowsToBuckets(rows, buckets), topModels), buckets, emptyModelMixRow);

	return <ModelMixChart rows={mix} seriesKeys={topModels} colors={assignSeriesColorSlots(topModels, domainOrder)} />;
}
