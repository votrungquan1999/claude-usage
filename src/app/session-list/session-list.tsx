import { SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DASHBOARD_TIMEZONE, SessionSortOrder } from "@/server/usage-queries";

import { formatInstantInTimezone, formatLowerBoundCost } from "../dashboard-format";
import { loadSessionPage } from "../dashboard-loaders";
import { sessionHref } from "../href";
import { SessionSort } from "./session-list.type";
import {
	SessionCostCell,
	SessionCostNote,
	SessionLink,
	SessionListLayout,
	SessionListToolbar,
	SessionPager,
	SessionSortField,
} from "./session-list.ui";

/** D34 — 25 a page. Enough to scan, few enough that the sort (which cannot use an index, since
 * cost is computed by the group) stays cheap. */
const SESSIONS_PER_PAGE = 25;

/** What each ordering is called on screen. Server-owned copy, passed to the control so its closed
 * trigger names the current ordering with the same words as the open list. */
const SESSION_SORT_LABELS: Record<string, string> = {
	[SessionSort.Cost]: "Most expensive",
	[SessionSort.Recent]: "Most recent",
	[SessionSort.Events]: "Busiest",
};

/**
 * Maps the URL's ordering vocabulary onto the query's. The one visible place a `?sort=` value
 * becomes a `$sort` — the same separation `SplitTab` keeps from `CostSplitDimension`.
 *
 * @param sort - the ordering parsed from the URL
 */
function sortOrderFor(sort: SessionSort): SessionSortOrder {
	if (sort === SessionSort.Recent) return SessionSortOrder.Recent;
	if (sort === SessionSort.Events) return SessionSortOrder.Events;
	return SessionSortOrder.Cost;
}

export interface SessionListProps {
	/** Selected window, epoch milliseconds. */
	fromMs: number;
	toMs: number;
	/** Zero-based page, from the URL. */
	pageIndex: number;
	/** How the list is ordered, from the URL. */
	sort: SessionSort;
}

/**
 * The sessions that ran in the selected window, one page at a time — the way into a session's
 * detail page, which until now could only be reached by pasting its id.
 *
 * Each row reports what the session cost INSIDE the window. That is also the default ordering, so
 * the list opens agreeing with the chart above it; the operator can re-order by recency or volume,
 * and the choice rides in the URL like everything else. A session that started before the window or ran past
 * it also shows its whole-session total, so clicking through is not a surprise (D32).
 */
export async function SessionList({
	fromMs,
	toMs,
	pageIndex,
	sort,
}: SessionListProps): Promise<React.JSX.Element> {
	const page = await loadSessionPage(fromMs, toMs, pageIndex, SESSIONS_PER_PAGE, sortOrderFor(sort));

	if (page.rows.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No sessions in this range</p>;
	}

	const pageCount = Math.max(1, Math.ceil(page.totalCount / SESSIONS_PER_PAGE));

	return (
		<SessionListLayout>
			<SessionListToolbar>
				<SessionSortField value={sort} items={SESSION_SORT_LABELS}>
					{Object.entries(SESSION_SORT_LABELS).map(([value, label]) => (
						<SelectItem key={value} value={value}>
							{label}
						</SelectItem>
					))}
				</SessionSortField>
			</SessionListToolbar>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Session</TableHead>
						<TableHead>Project</TableHead>
						<TableHead>Machine</TableHead>
						<TableHead>Models</TableHead>
						<TableHead>Started</TableHead>
						<TableHead>Events</TableHead>
						<TableHead>Cost in range</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{page.rows.map((row) => (
						<TableRow key={row.sessionId}>
							<TableCell>
								{/* The link carries the NAME, because that is what tells two rows apart —
								    project and machine repeat across dozens of them. Sessions synced before
								    titles were captured fall back to a short id, which is at least unique,
								    until a backfill re-run names them. */}
								<SessionLink href={sessionHref(row.sessionId)}>
									{row.sessionTitle ?? row.sessionId.slice(0, 8)}
								</SessionLink>
							</TableCell>
							<TableCell>{row.projectSlug}</TableCell>
							<TableCell>{row.machineId}</TableCell>
							<TableCell>{row.models.join(", ")}</TableCell>
							<TableCell>{formatInstantInTimezone(row.startedAt, DASHBOARD_TIMEZONE)}</TableCell>
							<TableCell>{row.eventCount}</TableCell>
							<TableCell>
								<SessionCostCell>
									<span>{formatLowerBoundCost(row.costUsd, row.unpricedEventCount)}</span>
									{/* Shown only when the session reaches outside the window — otherwise it
									    would repeat the figure beside it on every single row. */}
									{row.totalCostUsd !== row.costUsd && (
										<SessionCostNote>
											{`whole session ${formatLowerBoundCost(row.totalCostUsd, row.totalUnpricedEventCount)}`}
										</SessionCostNote>
									)}
								</SessionCostCell>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			<SessionPager currentPage={pageIndex + 1} pageCount={pageCount} />
		</SessionListLayout>
	);
}
