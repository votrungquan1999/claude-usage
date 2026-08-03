import type { DailyCostByDimensionRow } from "@/server/usage-queries";

import { assignSeriesColorSlots, pivotForChart, rankDimensionTotals } from "../dashboard-format";
import { CostChart } from "./cost-chart";
import type { SeriesColorMap } from "./cost-split-view.type";
import { DimensionTotalsTable } from "./dimension-totals-table";

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
}

/**
 * One cost-per-day split view: a stacked bar chart capped to the top 5 dimension values plus
 * "Other", and the exact per-dimension totals table below it. Every visible series (chart bar or
 * table row) resolves to a colour from the same `assignSeriesColorSlots` call, so a name and its
 * bar always agree (D21).
 */
export function CostSplitView({ rows, dimensionLabel, domainOrder }: CostSplitViewProps): React.JSX.Element {
	const totals = rankDimensionTotals(rows);
	const topValues = totals.slice(0, TOP_SERIES_COUNT).map((total) => total.dimensionValue);
	const chartData = pivotForChart(rows, topValues);
	const seriesColors = assignSeriesColorSlots(topValues, domainOrder);

	const tableColors: SeriesColorMap = Object.fromEntries(
		totals.map((total) => [total.dimensionValue, seriesColors[total.dimensionValue] ?? OTHER_COLOR]),
	);

	return (
		<div className="grid gap-4 pt-4">
			<CostChart data={chartData} seriesKeys={topValues} colors={seriesColors} />
			<DimensionTotalsTable totals={totals} dimensionLabel={dimensionLabel} colors={tableColors} />
		</div>
	);
}
