import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { dayKeyInTimezone, emptyEfficiencyRow, fillMissingDays } from "../dashboard-format";
import { loadDailyEfficiency } from "../dashboard-loaders";
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
	const rows = await loadDailyEfficiency(fromMs, toMs);
	const firstDay = dayKeyInTimezone(new Date(fromMs), DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(new Date(toMs), DASHBOARD_TIMEZONE);

	return <SubagentShareChart rows={fillMissingDays(rows, firstDay, lastDay, emptyEfficiencyRow)} />;
}
