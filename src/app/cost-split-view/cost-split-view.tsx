import { type CostSplitDimension, DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import {
	assignSeriesColorSlots,
	dayKeyInTimezone,
	fillMissingBuckets,
	TOP_SERIES_COUNT,
	pivotForChart,
	planDayBuckets,
	rankDimensionTotals,
	relabelRowsToBuckets,
	summarizeUnpricedDays,
} from "../dashboard-format";
import { loadCostPerDay, loadDimensionDomain } from "../dashboard-loaders";
import { CostChart } from "./cost-chart";
import type { SeriesColorMap, SplitTab } from "./cost-split-view.type";
import { CostSplitLayout, UnpricedRangeNotice } from "./cost-split-view.ui";
import { DimensionTotalsTable } from "./dimension-totals-table";

/**
 * Composes the D5 range-level statement's exact wording from `summarizeUnpricedDays`'s counts —
 * the single source `UnpricedRangeNotice` and the totals table's per-row lower-bound wording
 * both trace back to, so they can never disagree. `null` when no day in range is affected.
 */
function unpricedRangeMessage(dayCount: number, eventCount: number): string | null {
	if (dayCount === 0) return null;
	const dayNoun = dayCount === 1 ? "day" : "days";
	const eventNoun = eventCount === 1 ? "event" : "events";
	return `${dayCount} ${dayNoun} in this range include ${eventCount} unpriced ${eventNoun} — totals are a lower bound`;
}

/** Fallback colour for a totals-table row that isn't one of the chart's top-N series — it's part
 * of the chart's "Other" bucket, so its swatch must read as the same bucket, not its own hue. */
const OTHER_COLOR = "var(--chart-other)";

export interface CostSplitViewProps {
	dimension: CostSplitDimension;
	dimensionLabel: string;
	/** The URL's name for this split, for the per-row drill-down links. */
	tab: SplitTab;
	/** Selected window, epoch milliseconds. Primitives, not a `DateRange`: the shared loaders
	 * memoise on argument identity, and an object rebuilt per card silently re-runs the query. */
	fromMs: number;
	toMs: number;
	/** The colour-domain lookback (D21/D41), epoch milliseconds — wider than any selectable
	 * window, so a value's colour never depends on which window is on screen. */
	domainFromMs: number;
	domainToMs: number;
}

/**
 * One cost-per-day split view: a stacked bar chart capped to the top 5 dimension values plus
 * "Other", and the exact per-dimension totals table below it. Fetches its own rows rather than
 * receiving them, so each split streams in independently. Every visible series (chart bar or
 * table row) resolves to a colour from the same `assignSeriesColorSlots` call, so a name and its
 * bar always agree (D21).
 */
export async function CostSplitView({
	dimension,
	dimensionLabel,
	tab,
	fromMs,
	toMs,
	domainFromMs,
	domainToMs,
}: CostSplitViewProps): Promise<React.JSX.Element> {
	const [rows, domainOrder] = await Promise.all([
		loadCostPerDay(dimension, fromMs, toMs),
		loadDimensionDomain(dimension, domainFromMs, domainToMs),
	]);

	// The window's own first/last day, read in the dashboard's calendar (D11/D24) — gap fill spans
	// what was requested, so a day with no work holds its place on the axis instead of vanishing.
	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);

	// Ranked over the RAW rows: the top-N cap is a property of the window, not of how it is drawn,
	// so bucketing must not be able to change which five names get their own series.
	const totals = rankDimensionTotals(rows);
	const topValues = totals.slice(0, TOP_SERIES_COUNT).map((total) => total.dimensionValue);
	// Relabelled BEFORE the pivot so a multi-day bar is the sum of its days (D7), and filled AFTER
	// the pivot and the top-N cap: a synthetic row inserted earlier would carry no dimensionValue,
	// and any placeholder one would rank as a phantom series — landing inside the top 5 on a narrow
	// window and folding into "Other" on a wide one (D11/D24).
	const buckets = planDayBuckets(firstDay, lastDay);
	const chartData = fillMissingBuckets(
		pivotForChart(relabelRowsToBuckets(rows, buckets), topValues),
		buckets,
		(day) => ({ day, unpricedEventCount: 0, eventCount: 0 }),
	);
	const seriesColors = assignSeriesColorSlots(topValues, domainOrder);

	const tableColors: SeriesColorMap = Object.fromEntries(
		totals.map((total) => [total.dimensionValue, seriesColors[total.dimensionValue] ?? OTHER_COLOR]),
	);

	const unpriced = summarizeUnpricedDays(chartData);
	const unpricedMessage = unpricedRangeMessage(unpriced.dayCount, unpriced.eventCount);

	return (
		<CostSplitLayout>
			{unpricedMessage !== null && <UnpricedRangeNotice>{unpricedMessage}</UnpricedRangeNotice>}
			<CostChart data={chartData} seriesKeys={topValues} colors={seriesColors} />
			<DimensionTotalsTable totals={totals} dimensionLabel={dimensionLabel} colors={tableColors} tab={tab} />
		</CostSplitLayout>
	);
}
