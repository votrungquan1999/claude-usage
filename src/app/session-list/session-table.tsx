import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DASHBOARD_TIMEZONE, type SessionListRow } from "@/server/usage-queries";

import { cn } from "@/lib/utils";

import { formatInstantInTimezone, formatLowerBoundCost, machineDisplayName } from "../dashboard-format";
import { loadMachineSyncStatus } from "../dashboard-loaders";
import { sessionHref } from "../href";
import { SessionCostCell, SessionCostNote, SessionLink } from "./session-list.ui";

/** The pinned Session column's shared treatment (D2/D25): stuck to the scroll region's left edge,
 * painted opaquely so scrolled-under content can't show through (`bg-card`, matching the `Card`
 * every one of this table's callers renders inside — not `bg-background`, a different token in the
 * dark theme), and capped in width since a model-generated session title has no length bound of
 * its own (risk R27) — an uncapped pinned column would consume the whole 390px viewport and leave
 * nothing to scroll into. */
const PINNED_SESSION_COLUMN_CLASSES = cn("bg-card", "sticky left-0 z-10 max-w-40 truncate");

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
 *
 * Self-fetches nicknames (server-components-rules.md §4 — fetch in the component that uses the
 * data) rather than receiving them, so neither of this table's two composers needs a prop just to
 * pass the same lookup through. A failed read falls back to every row's short id rather than
 * throwing (D19) — this table's own spend figures must not blank because a name lookup failed.
 */
export async function SessionTable({ rows, costLabel }: SessionTableProps): Promise<React.JSX.Element> {
	let nicknameByMachineId: Record<string, string | undefined> = {};
	try {
		const syncRows = await loadMachineSyncStatus();
		nicknameByMachineId = Object.fromEntries(syncRows.map((row) => [row.machineId, row.name ?? undefined]));
	} catch {
		// D19 — every row below falls back to its machine's short id instead.
	}

	return (
		<Table aria-label="Session list">
			<TableHeader>
				<TableRow>
					<TableHead className={PINNED_SESSION_COLUMN_CLASSES}>Session</TableHead>
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
						<TableCell className={PINNED_SESSION_COLUMN_CLASSES}>
							{/* The link carries the NAME, because that is what tells two rows apart — project
							    and machine repeat across dozens of them. Sessions synced before titles were
							    captured fall back to a short id, which is at least unique, until a backfill
							    re-run names them. */}
							<SessionLink href={sessionHref(row.sessionId)}>{row.sessionTitle ?? row.sessionId.slice(0, 8)}</SessionLink>
						</TableCell>
						<TableCell>{row.projectSlug}</TableCell>
						<TableCell>{machineDisplayName(nicknameByMachineId[row.machineId], row.machineId)}</TableCell>
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
