import type { DailyCostByDimensionRow } from "@/server/usage-queries";

import {
	assignSeriesColorSlots,
	fillMissingDays,
	pivotForChart,
	rankDimensionTotals,
	summarizeUnpricedDays,
} from "../dashboard-format";
import { CostChart } from "./cost-chart";
import type { SeriesColorMap } from "./cost-split-view.type";
import { UnpricedRangeNotice } from "./cost-split-view.ui";
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

const TOP_SERIES_COUNT = 5;

/** Fallback colour for a totals-table row that isn't one of the chart's top-N series — it's part
 * of the chart's "Other" bucket, so its swatch must read as the same bucket, not its own hue. */
const OTHER_COLOR = "var(--chart-other)";

export interface CostSplitViewProps {
	rows: DailyCostByDimensionRow[];
	dimensionLabel: string;
	/** The dimension's value domain, ordered range-independently (D21) — feeds
	 * `assignSeriesColorSlots` so a value's colour never changes when the window changes. */
	domainOrder: string[];
	/** First day of the SELECTED window, `YYYY-MM-DD` in `DASHBOARD_TIMEZONE` (D11) — gap fill
	 * spans what was asked for, not what happens to have data, so the axis never lies at its edges. */
	firstDay: string;
	/** Last day of the selected window, `YYYY-MM-DD` in `DASHBOARD_TIMEZONE`. */
	lastDay: string;
}

/**
 * One cost-per-day split view: a stacked bar chart capped to the top 5 dimension values plus
 * "Other", and the exact per-dimension totals table below it. Every visible series (chart bar or
 * table row) resolves to a colour from the same `assignSeriesColorSlots` call, so a name and its
 * bar always agree (D21).
 */
export function CostSplitView({
	rows,
	dimensionLabel,
	domainOrder,
	firstDay,
	lastDay,
}: CostSplitViewProps): React.JSX.Element {
	const totals = rankDimensionTotals(rows);
	const topValues = totals.slice(0, TOP_SERIES_COUNT).map((total) => total.dimensionValue);
	// Filled AFTER the pivot and the top-N cap: a synthetic row inserted earlier would carry no
	// dimensionValue, and any placeholder one would rank as a phantom series — landing inside the
	// top 5 on a narrow window and folding into "Other" on a wide one (D11/D24).
	const chartData = fillMissingDays(pivotForChart(rows, topValues), firstDay, lastDay, (day) => ({
		day,
		unpricedEventCount: 0,
		eventCount: 0,
	}));
	const seriesColors = assignSeriesColorSlots(topValues, domainOrder);

	const tableColors: SeriesColorMap = Object.fromEntries(
		totals.map((total) => [total.dimensionValue, seriesColors[total.dimensionValue] ?? OTHER_COLOR]),
	);

	const unpriced = summarizeUnpricedDays(chartData);
	const unpricedMessage = unpricedRangeMessage(unpriced.dayCount, unpriced.eventCount);

	return (
		<div className="grid gap-4 pt-4">
			{unpricedMessage !== null && <UnpricedRangeNotice>{unpricedMessage}</UnpricedRangeNotice>}
			<CostChart data={chartData} seriesKeys={topValues} colors={seriesColors} />
			<DimensionTotalsTable totals={totals} dimensionLabel={dimensionLabel} colors={tableColors} />
		</div>
	);
}
