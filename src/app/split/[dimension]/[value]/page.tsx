import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type CostSplitDimension, DASHBOARD_TIMEZONE, SessionSortOrder } from "@/server/usage-queries";

import { CardErrorBoundary } from "../../../card-error-boundary.ui";
import { formatLowerBoundCost, parseDashboardRange, readSearchParams } from "../../../dashboard-format";
import { loadEarliestEventMs, loadSplitValueBreakdown } from "../../../dashboard-loaders";
import { CardErrorNotice, CardPlaceholder } from "../../../dashboard-shell.ui";
import { dashboardHref } from "../../../href";
import { SessionSort } from "../../../session-list/session-list.type";
import { SessionPager } from "../../../session-list/session-list.ui";
import { SessionTable } from "../../../session-list/session-table";
import { decodeSplitValue, parseSplitDimension } from "../../split-params";
import { BackToDashboard, SplitValueHeading, SplitValueLayout, SplitValueSummary } from "./split-value.ui";

/** Matches the dashboard's own list, so paging feels the same on both. */
const SESSIONS_PER_PAGE = 25;

/** Maps the URL's ordering vocabulary onto the query's — the same one visible place
 * `session-list.tsx` keeps that mapping, and for the same reason. */
function sortOrderFor(sort: SessionSort): SessionSortOrder {
	if (sort === SessionSort.Recent) return SessionSortOrder.Recent;
	if (sort === SessionSort.Events) return SessionSortOrder.Events;
	return SessionSortOrder.Cost;
}

interface SplitValuePageProps {
	params: Promise<{ dimension: string; value: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * One cost-split row's drill-down: what a machine, project, model or repository cost in the
 * selected window, and the sessions that worked on it.
 *
 * The window comes from the URL exactly as the dashboard's does, because the figure here has to
 * agree with the row that was clicked — and that row is a window figure.
 */
export default async function SplitValuePage({ params, searchParams }: SplitValuePageProps): Promise<React.JSX.Element> {
	const { dimension, value } = await params;
	const route = parseSplitDimension(dimension);
	const label = decodeSplitValue(value);
	if (route === undefined || label === undefined) notFound();

	const query = readSearchParams(await searchParams);
	const earliestMs = await loadEarliestEventMs();
	const view = parseDashboardRange(query, new Date(), earliestMs === null ? null : new Date(earliestMs), DASHBOARD_TIMEZONE);

	return (
		<SplitValueLayout>
			<BackToDashboard href={dashboardHref(query, { tab: route.tab })}>Back to dashboard</BackToDashboard>
			<SplitValueHeading label={route.label} value={label} />

			<CardErrorBoundary fallback={<CardErrorNotice>This drill-down could not be loaded</CardErrorNotice>}>
				<Suspense fallback={<CardPlaceholder />}>
					<SplitValueSessions
						dimension={route.dimension}
						value={label}
						fromMs={view.range.from.getTime()}
						toMs={view.range.to.getTime()}
						pageIndex={view.pageIndex}
						sort={view.sessionSort}
					/>
				</Suspense>
			</CardErrorBoundary>
		</SplitValueLayout>
	);
}

interface SplitValueSessionsProps {
	dimension: CostSplitDimension;
	value: string;
	fromMs: number;
	toMs: number;
	pageIndex: number;
	sort: SessionSort;
}

/**
 * The totals and the sessions behind them. One query feeds both, so the figure above the table is
 * the sum of the table rather than a second query that happens to agree.
 */
async function SplitValueSessions({
	dimension,
	value,
	fromMs,
	toMs,
	pageIndex,
	sort,
}: SplitValueSessionsProps): Promise<React.JSX.Element> {
	const breakdown = await loadSplitValueBreakdown(
		dimension,
		value,
		fromMs,
		toMs,
		pageIndex,
		SESSIONS_PER_PAGE,
		sortOrderFor(sort),
	);

	if (breakdown.sessionCount === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	const pageCount = Math.max(1, Math.ceil(breakdown.sessionCount / SESSIONS_PER_PAGE));
	const sessionNoun = breakdown.sessionCount === 1 ? "session" : "sessions";

	return (
		<>
			<SplitValueSummary>
				<span>{formatLowerBoundCost(breakdown.costUsd, breakdown.unpricedEventCount)}</span>
				{breakdown.unpricedEventCount > 0 && (
					<Badge variant="outline" className="ml-2">
						unpriced
					</Badge>
				)}
				<span>{`${breakdown.eventCount} events`}</span>
				<span>{`${breakdown.sessionCount} ${sessionNoun}`}</span>
			</SplitValueSummary>

			<Card>
				<CardHeader>
					<CardTitle>Sessions</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-4">
					{/* Not "cost in range": since per-turn attribution a session can span several
					    repositories, so this column is the slice attributed HERE — which is what makes
					    the rows add up to the figure above them. */}
					<SessionTable rows={breakdown.sessions} costLabel="Cost here" />
					<SessionPager currentPage={pageIndex + 1} pageCount={pageCount} />
				</CardContent>
			</Card>
		</>
	);
}
