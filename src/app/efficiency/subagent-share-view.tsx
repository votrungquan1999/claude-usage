import { DASHBOARD_TIMEZONE, rollUpEfficiencyByDay } from "@/server/usage-queries";

import {
	dayKeyInTimezone,
	emptyEfficiencyRow,
	fillMissingBuckets,
	planDayBuckets,
	relabelRowsToBuckets,
} from "../dashboard-format";
import { loadDailyEfficiencyByModel } from "../dashboard-loaders";
import { SubagentShareChart } from "./subagent-share-chart";

export interface SubagentShareViewProps {
	/** Selected window, epoch milliseconds — primitives so the shared loader actually memoises. */
	fromMs: number;
	toMs: number;
}

/**
 * Subagent share of cost per day over the selected window. Fetches through the shared loader it
 * has in common with the cache card, so the two read one query rather than two.
 */
export async function SubagentShareView({ fromMs, toMs }: SubagentShareViewProps): Promise<React.JSX.Element> {
	// The per-model rows, not the pre-rolled-up daily ones: rolling up AFTER relabelling is what
	// makes a bucket's share the ratio of its summed costs rather than a mean of daily ratios (D7).
	// Same cached query either way — `loadDailyEfficiency` is itself a roll-up of this one.
	const rows = await loadDailyEfficiencyByModel(fromMs, toMs);
	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);

	const buckets = planDayBuckets(firstDay, lastDay);
	const bucketed = rollUpEfficiencyByDay(relabelRowsToBuckets(rows, buckets));

	return <SubagentShareChart rows={fillMissingBuckets(bucketed, buckets, emptyEfficiencyRow)} />;
}
