import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import {
	dayKeyInTimezone,
	emptySavingsRow,
	fillMissingBuckets,
	formatSavingsStatement,
	planDayBuckets,
	relabelRowsToBuckets,
	rollUpDailySavings,
} from "../dashboard-format";
import { loadDailyEfficiencyByModel } from "../dashboard-loaders";
import { CacheSavingsChart } from "./cache-savings-chart";
import { CacheSavingsLayout, CacheSavingsStatement } from "./cache-savings-view.ui";

export interface CacheSavingsViewProps {
	/** Selected window, epoch milliseconds — primitives so the shared loader actually memoises. */
	fromMs: number;
	toMs: number;
}

/**
 * What caching saved over the selected window, in dollars (D12) — replacing the reads-vs-writes
 * token chart, whose two independent axes made their crossover look like an event when it was an
 * artifact of the scaling.
 */
export async function CacheSavingsView({ fromMs, toMs }: CacheSavingsViewProps): Promise<React.JSX.Element> {
	const rows = await loadDailyEfficiencyByModel(fromMs, toMs);
	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);

	// Relabelled before the roll-up so a bucket is the sum of its days, including the "one unpriced
	// model makes the whole figure a floor" rule `rollUpDailySavings` already applies (D7).
	const buckets = planDayBuckets(firstDay, lastDay);
	const daily = fillMissingBuckets(rollUpDailySavings(relabelRowsToBuckets(rows, buckets)), buckets, emptySavingsRow);
	const netTotal = daily.reduce((sum, row) => sum + row.netSavedUsd, 0);
	// A model with no known price contributes $0, which is indistinguishable from an idle cache —
	// so the range total is a floor, and says so rather than reading as measured.
	const anyUnmeasured = daily.some((row) => !row.savingsKnown);

	return (
		<CacheSavingsLayout>
			<CacheSavingsStatement>
				{anyUnmeasured
					? `${formatSavingsStatement(netTotal)} — at least, some models in this range have no known price`
					: formatSavingsStatement(netTotal)}
			</CacheSavingsStatement>
			<CacheSavingsChart rows={daily} />
		</CacheSavingsLayout>
	);
}
