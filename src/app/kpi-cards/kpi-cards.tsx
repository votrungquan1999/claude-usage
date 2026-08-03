import {
	dayKeyInTimezone,
	formatLowerBoundCost,
	monthProgressInTimezone,
	projectMonthEndCost,
	startOfMonthInTimezone,
	summarizeMonthToDate,
} from "../dashboard-format";
import { loadDailyEfficiency } from "../dashboard-loaders";
import { KpiHeroValue, KpiLabel, KpiNote, KpiRow, KpiTile, KpiValue } from "./kpi-cards.ui";

export interface KpiCardsProps {
	/** The instant the request is being served, epoch milliseconds — passed in rather than read
	 * here so every card in one render agrees on what "today" means. */
	nowMs: number;
	timeZone: string;
}

/**
 * Spend today, month to date, and what the month is on course to cost (D13/D22).
 *
 * These are FIXED periods and are deliberately not scoped by the range picker — "spend today"
 * would be meaningless at "last 90 days", and a projection would be nonsense. They sit above the
 * filter row so the layout carries that, rather than a caption having to explain it.
 *
 * One query covers all three: the whole month to date, reduced by pure functions.
 */
export async function KpiCards({ nowMs, timeZone }: KpiCardsProps): Promise<React.JSX.Element> {
	const now = new Date(nowMs);
	const monthStart = startOfMonthInTimezone(now, timeZone);
	const rows = await loadDailyEfficiency(monthStart.getTime(), nowMs);

	const summary = summarizeMonthToDate(rows, dayKeyInTimezone(now, timeZone));
	const progress = monthProgressInTimezone(now, timeZone);
	const projected = projectMonthEndCost(summary.monthCostUsd, progress.completeElapsedDays, progress.daysInMonth);
	const completeDayNoun = progress.completeElapsedDays === 1 ? "day" : "days";

	return (
		<KpiRow>
			<KpiTile>
				<KpiLabel>Spend today</KpiLabel>
				<KpiValue>{formatLowerBoundCost(summary.todayCostUsd, summary.todayUnpricedEventCount)}</KpiValue>
				<KpiNote>Partial — today is still running</KpiNote>
			</KpiTile>

			<KpiTile>
				<KpiLabel>Month to date</KpiLabel>
				<KpiHeroValue>{formatLowerBoundCost(summary.monthCostUsd, summary.monthUnpricedEventCount)}</KpiHeroValue>
				<KpiNote>{`Since ${dayKeyInTimezone(monthStart, timeZone)}, today included`}</KpiNote>
			</KpiTile>

			<KpiTile>
				<KpiLabel>Projected month end</KpiLabel>
				{/* D42 — on the 1st no day has ended, so there is no rate to extend. Saying so beats
				    printing a number derived from a division by zero. */}
				<KpiValue>
					{projected === null
						? "Not enough data yet"
						: formatLowerBoundCost(projected, summary.monthUnpricedEventCount)}
				</KpiValue>
				<KpiNote>
					{projected === null
						? "No day has fully ended this month yet"
						: `Projected from ${progress.completeElapsedDays} complete ${completeDayNoun} of ${progress.daysInMonth}`}
				</KpiNote>
			</KpiTile>
		</KpiRow>
	);
}
