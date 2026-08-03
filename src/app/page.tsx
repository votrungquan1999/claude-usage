import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { CardErrorBoundary } from "./card-error-boundary.ui";
import { CostSplits } from "./cost-split-view/cost-splits";
import { parseDashboardRange } from "./dashboard-format";
import { loadEarliestEventMs } from "./dashboard-loaders";
import {
	CardErrorNotice,
	CardPlaceholder,
	DashboardShell,
	DashboardTitle,
	RangeFallbackNotice,
} from "./dashboard-shell.ui";
import { CacheEfficiencyView } from "./efficiency/cache-efficiency-view";
import { SubagentShareView } from "./efficiency/subagent-share-view";
import { RANGE_PRESET_LABELS, RangePresetOptions } from "./range-picker/range-picker";
import { DEFAULT_RANGE_PRESET } from "./range-picker/range-picker.type";
import { SessionLookupForm } from "./session-lookup-form";
import { SignOutButton } from "./sign-out-button";

/** D21/D41 — colours are assigned from a value's rank over a window WIDER than any the operator
 * can select, so a value's colour never depends on the window on screen. */
const COLOR_DOMAIN_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

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
	const view = parseDashboardRange(
		params,
		new Date(),
		earliestMs === null ? null : new Date(earliestMs),
		DASHBOARD_TIMEZONE,
	);

	const fromMs = view.range.from.getTime();
	const toMs = view.range.to.getTime();
	// D41 — the lookback must reach at least as far back as the window itself; a window extending
	// past it would leave its oldest values unranked and silently repaint the rest.
	const domainFromMs = Math.min(fromMs, toMs - COLOR_DOMAIN_LOOKBACK_MS);

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
				rangeValue={view.preset}
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
					domainFromMs={domainFromMs}
					domainToMs={toMs}
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
						<CardTitle>Cache reads vs writes</CardTitle>
					</CardHeader>
					<CardContent>
						<CardErrorBoundary fallback={<CardErrorNotice>This card could not be loaded</CardErrorNotice>}>
							<Suspense fallback={<CardPlaceholder />}>
								<CacheEfficiencyView fromMs={fromMs} toMs={toMs} />
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
