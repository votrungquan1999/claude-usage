import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DASHBOARD_TIMEZONE, type SessionListRow } from "@/server/usage-queries";

import { formatInstantInTimezone, formatLowerBoundCost } from "../dashboard-format";
import { sessionHref } from "../href";
import { SessionCostCell, SessionCostNote, SessionLink } from "./session-list.ui";

export interface SessionTableProps {
	rows: SessionListRow[];
	/** What the cost column measures. The dashboard list means "in this window"; a drill-down means
	 * "attributed to this value" — a narrower figure, and saying so is the only thing that keeps the
	 * rows summing to the total above them. */
	costLabel: string;
}

/**
 * The session table both the dashboard list and a drill-down page render. Shared rather than
 * copied: the lower-bound wording, the whole-session qualifier and the link shape are behaviour,
 * and two copies of them would drift apart silently.
 */
export function SessionTable({ rows, costLabel }: SessionTableProps): React.JSX.Element {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Session</TableHead>
					<TableHead>Project</TableHead>
					<TableHead>Machine</TableHead>
					<TableHead>Models</TableHead>
					<TableHead>Started</TableHead>
					<TableHead>Events</TableHead>
					<TableHead>{costLabel}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.sessionId}>
						<TableCell>
							{/* The link carries the NAME, because that is what tells two rows apart — project
							    and machine repeat across dozens of them. Sessions synced before titles were
							    captured fall back to a short id, which is at least unique, until a backfill
							    re-run names them. */}
							<SessionLink href={sessionHref(row.sessionId)}>{row.sessionTitle ?? row.sessionId.slice(0, 8)}</SessionLink>
						</TableCell>
						<TableCell>{row.projectSlug}</TableCell>
						<TableCell>{row.machineId}</TableCell>
						<TableCell>{row.models.join(", ")}</TableCell>
						<TableCell>{formatInstantInTimezone(row.startedAt, DASHBOARD_TIMEZONE)}</TableCell>
						<TableCell>{row.eventCount}</TableCell>
						<TableCell>
							<SessionCostCell>
								<span>{formatLowerBoundCost(row.costUsd, row.unpricedEventCount)}</span>
								{/* Shown only when the session reaches outside what this column measures —
								    otherwise it would repeat the figure beside it on every single row. */}
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
	);
}
