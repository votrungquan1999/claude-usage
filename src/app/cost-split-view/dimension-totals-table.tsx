import type { DimensionTotal } from "../dashboard-format";

import type { SeriesColorMap, SplitTab } from "./cost-split-view.type";
import { DimensionTotalsTableDisplay } from "./dimension-totals-table.ui";

export interface DimensionTotalsTableProps {
	totals: DimensionTotal[];
	dimensionLabel: string;
	colors: SeriesColorMap;
	/** The URL's name for this split — carried, not derived from the query dimension, so the two
	 * vocabularies stay mapped at one visible place. */
	tab: SplitTab;
}

/**
 * Exact per-dimension totals for a cost-per-day split view (Step 19/22). The chart is capped to
 * 5 series plus "Other"; this table is not, and it's where D17's lower-bound wording is read.
 */
export function DimensionTotalsTable({
	totals,
	dimensionLabel,
	colors,
	tab,
}: DimensionTotalsTableProps): React.JSX.Element {
	return <DimensionTotalsTableDisplay totals={totals} dimensionLabel={dimensionLabel} colors={colors} tab={tab} />;
}
