import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { formatInstantInTimezone, formatLowerBoundCost } from "../dashboard-format";
import { loadSessionPage } from "../dashboard-loaders";
import { sessionHref } from "../href";
import {
	SessionCostCell,
	SessionCostNote,
	SessionLink,
	SessionListLayout,
	SessionPager,
} from "./session-list.ui";

/** D34 — 25 a page. Enough to scan, few enough that the sort (which cannot use an index, since
 * cost is computed by the group) stays cheap. */
const SESSIONS_PER_PAGE = 25;

export interface SessionListProps {
	/** Selected window, epoch milliseconds. */
	fromMs: number;
	toMs: number;
	/** Zero-based page, from the URL. */
	pageIndex: number;
}

/**
 * The sessions that ran in the selected window, most expensive first, one page at a time — the
 * way into a session's detail page, which until now could only be reached by pasting its id.
 *
 * Each row reports what the session cost INSIDE the window, which is also what it sorts by, so
 * the list agrees with the chart above it. A session that started before the window or ran past
 * it also shows its whole-session total, so clicking through is not a surprise (D32).
 */
export async function SessionList({ fromMs, toMs, pageIndex }: SessionListProps): Promise<React.JSX.Element> {
	const page = await loadSessionPage(fromMs, toMs, pageIndex, SESSIONS_PER_PAGE);

	if (page.rows.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No sessions in this range</p>;
	}

	const pageCount = Math.max(1, Math.ceil(page.totalCount / SESSIONS_PER_PAGE));

	return (
		<SessionListLayout>
			<Table>
				<TableHeader>
					<TableRow>
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
								<SessionLink href={sessionHref(row.sessionId)}>{row.projectSlug}</SessionLink>
							</TableCell>
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
