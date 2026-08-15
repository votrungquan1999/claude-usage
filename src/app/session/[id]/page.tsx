import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase } from "@/server/database";
import { DASHBOARD_TIMEZONE, getSessionBreakdown, getSessionTurns } from "@/server/usage-queries";

import {
	buildTurnTimeline,
	formatInstantInTimezone,
	formatLowerBoundCost,
	machineDisplayName,
	turnTimelineDivergenceNote,
} from "../../dashboard-format";
import { SessionDetailLayout, SessionModelCostTable } from "./session-detail.ui";
import { TurnTimelineChart } from "./turn-timeline.ui";

interface SessionPageProps {
	params: Promise<{ id: string }>;
}

/**
 * Single-session drill-down (Step 21): metadata plus a per-model cost breakdown, sorted by
 * cost descending. 404s when no event carries this session id.
 */
export default async function SessionPage({ params }: SessionPageProps): Promise<React.JSX.Element> {
	const { id } = await params;
	const db = await getDatabase();
	const summary = await getSessionBreakdown(db, id);

	if (!summary) notFound();

	const turns = await getSessionTurns(db, id);
	const timeline = buildTurnTimeline(turns);
	const timelineDivergenceNote = turnTimelineDivergenceNote(timeline, summary.totalCostUsd);

	return (
		<SessionDetailLayout>
			<h1 className="text-lg font-medium text-foreground">Session {summary.sessionId}</h1>

			<Card>
				<CardHeader>
					<CardTitle>Overview</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 text-sm text-foreground">
					<div>Project: {summary.projectSlug}</div>
					<div>Machine: {machineDisplayName(undefined, summary.machineId)}</div>
					<div>Account: {summary.accountUuid ?? "unattributed"}</div>
					<div>
						Started: {formatInstantInTimezone(summary.startedAt, DASHBOARD_TIMEZONE)} — Ended:{" "}
						{formatInstantInTimezone(summary.endedAt, DASHBOARD_TIMEZONE)} ({DASHBOARD_TIMEZONE})
					</div>
					<div>
						Total cost: {formatLowerBoundCost(summary.totalCostUsd, summary.unpricedEventCount)}
						{summary.unpricedEventCount > 0 && (
							<Badge variant="outline" className="ml-2">
								unpriced
							</Badge>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Cost by model</CardTitle>
				</CardHeader>
				<CardContent>
					<SessionModelCostTable rows={summary.byModel} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Carry vs. new work across this session</CardTitle>
				</CardHeader>
				<CardContent>
					<TurnTimelineChart
						main={timeline.main}
						subagent={timeline.subagent}
						turnCount={turns.length}
						unpricedEventCount={summary.unpricedEventCount}
					/>
					{timelineDivergenceNote && <p className="mt-2 text-xs text-muted-foreground">{timelineDivergenceNote}</p>}
				</CardContent>
			</Card>
		</SessionDetailLayout>
	);
}
