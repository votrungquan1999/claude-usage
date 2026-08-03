import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { CardErrorBoundary } from "./card-error-boundary.ui";
import { CostSplits } from "./cost-split-view/cost-splits";
import { colorDomainWindow, dayKeyInTimezone, parseDashboardRange } from "./dashboard-format";
import { loadEarliestEventMs } from "./dashboard-loaders";
import {
	CardErrorNotice,
	CardPlaceholder,
	DashboardShell,
	DashboardTitle,
	RangeFallbackNotice,
} from "./dashboard-shell.ui";
import { CacheSavingsView } from "./efficiency/cache-savings-view";
import { SubagentShareView } from "./efficiency/subagent-share-view";
import { KpiCards } from "./kpi-cards/kpi-cards";
import { RANGE_PRESET_LABELS, RangePresetOptions } from "./range-picker/range-picker";
import { DEFAULT_RANGE_PRESET, type DashboardWindowView } from "./range-picker/range-picker.type";
import { SessionLookupForm } from "./session-lookup-form";
import { SignOutButton } from "./sign-out-button";

interface DashboardPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Dashboard root, gated by `src/proxy.ts`. Reads the whole view state out of the URL (D7) and
 * composes the cards; it issues no card query itself — each card fetches what it alone needs, or
 * reads a shared loader, so one slow query never holds up the rest of the page.
 *
 * @param searchParams - the request's query string, the sole source of which window is on screen
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps): Promise<React.JSX.Element> {
	const params = readSearchParams(await searchParams);
	const earliestMs = await loadEarliestEventMs();
	const now = new Date();
	const view = parseDashboardRange(params, now, earliestMs === null ? null : new Date(earliestMs), DASHBOARD_TIMEZONE);

	const fromMs = view.range.from.getTime();
	const toMs = view.range.to.getTime();
	// Ends at NOW, not at the selected window's end — see `colorDomainWindow` for why tying it to
	// the window repaints the palette (D21/D41).
	const colorDomain = colorDomainWindow(fromMs, now.getTime());

	// The picker describes the window in the same calendar the charts bucket by, so the dates it
	// shows and the bars below it always name the same days.
	const fromDay = dayKeyInTimezone(view.range.from, DASHBOARD_TIMEZONE);
	const toDay = dayKeyInTimezone(view.range.to, DASHBOARD_TIMEZONE);
	const windowView: DashboardWindowView = {
		preset: view.preset,
		fromDay,
		toDay,
		// D36 — the calendar offers only days the corpus could cover. Bounded by TODAY, not by the
		// window's own end: bounding by the end would leave a past custom range unable to reach
		// forward again. An empty corpus collapses the span to today, offering nothing rather
		// than everything.
		earliestDay: dayKeyInTimezone(earliestMs === null ? now : new Date(earliestMs), DASHBOARD_TIMEZONE),
		latestDay: dayKeyInTimezone(now, DASHBOARD_TIMEZONE),
		timeZone: DASHBOARD_TIMEZONE,
		label: `${fromDay} \u2192 ${toDay}`,
	};
	return (
		// `useSearchParams` runs inside the shell; the boundary is Next's requirement for it.
		<Suspense>
			<DashboardShell
				header={
					<>
						<DashboardTitle>Claude Usage</DashboardTitle>
						<SignOutButton />
					</>
				}
				kpis={
					<CardErrorBoundary fallback={<CardErrorNotice>Headline figures could not be loaded</CardErrorNotice>}>
						<Suspense fallback={<CardPlaceholder />}>
							<KpiCards nowMs={now.getTime()} timeZone={DASHBOARD_TIMEZONE} />
						</Suspense>
					</CardErrorBoundary>
				}
				view={windowView}
				rangeLabels={RANGE_PRESET_LABELS}
				rangeOptions={<RangePresetOptions />}
				notice={
					view.fellBack ? (
						<RangeFallbackNotice>
							{`That link asked for a window this dashboard cannot show — showing ${RANGE_PRESET_LABELS[DEFAULT_RANGE_PRESET].toLowerCase()} instead.`}
						</RangeFallbackNotice>
					) : null
				}
			>
				<CostSplits
					initialTab={view.tab}
					fromMs={fromMs}
					toMs={toMs}
					domainFromMs={colorDomain.fromMs}
					domainToMs={colorDomain.toMs}
				/>

				<Card>
					<CardHeader>
						<CardTitle>Subagent share of cost</CardTitle>
					</CardHeader>
					<CardContent>
						<CardErrorBoundary fallback={<CardErrorNotice>This card could not be loaded</CardErrorNotice>}>
							<Suspense fallback={<CardPlaceholder />}>
								<SubagentShareView fromMs={fromMs} toMs={toMs} />
							</Suspense>
						</CardErrorBoundary>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>What caching saved</CardTitle>
					</CardHeader>
					<CardContent>
						<CardErrorBoundary fallback={<CardErrorNotice>This card could not be loaded</CardErrorNotice>}>
							<Suspense fallback={<CardPlaceholder />}>
								<CacheSavingsView fromMs={fromMs} toMs={toMs} />
							</Suspense>
						</CardErrorBoundary>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Open a session</CardTitle>
					</CardHeader>
					<CardContent>
						<SessionLookupForm />
					</CardContent>
				</Card>
			</DashboardShell>
		</Suspense>
	);
}

/**
 * Next's resolved search params as a `URLSearchParams`. A repeated key arrives as an array and is
 * dropped rather than joined — a joined value would be a string nothing in the allowlist matches,
 * which is the same outcome by a less obvious route.
 *
 * @param resolved - the awaited `searchParams`
 */
function readSearchParams(resolved: Record<string, string | string[] | undefined>): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(resolved)) {
		if (typeof value === "string") params.set(key, value);
	}
	return params;
}
