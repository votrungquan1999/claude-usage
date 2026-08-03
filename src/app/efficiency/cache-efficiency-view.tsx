import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { dayKeyInTimezone, emptyEfficiencyRow, fillMissingDays } from "../dashboard-format";
import { loadDailyEfficiency } from "../dashboard-loaders";
import { CacheEfficiencyChart } from "./cache-efficiency-chart";

export interface CacheEfficiencyViewProps {
	/** Selected window, epoch milliseconds — primitives so the shared loader actually memoises. */
	fromMs: number;
	toMs: number;
}

/**
 * Cache read-vs-write volume per day over the selected window. Shares its query with the subagent
 * card through the same cached loader, called with the same primitive arguments.
 */
export async function CacheEfficiencyView({ fromMs, toMs }: CacheEfficiencyViewProps): Promise<React.JSX.Element> {
	const rows = await loadDailyEfficiency(fromMs, toMs);
	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);

	return <CacheEfficiencyChart rows={fillMissingDays(rows, firstDay, lastDay, emptyEfficiencyRow)} />;
}
