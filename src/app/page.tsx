import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDatabase } from "@/server/database";
import {
	CostSplitDimension,
	DASHBOARD_TIMEZONE,
	costPerDay,
	dailyEfficiency,
	dimensionValueDomain,
	type DateRange,
} from "@/server/usage-queries";

import { CostSplitView } from "./cost-split-view/cost-split-view";
import { dayKeyInTimezone, emptyEfficiencyRow, fillMissingDays, startOfDayInTimezone } from "./dashboard-format";
import { CacheEfficiencyChart } from "./efficiency/cache-efficiency-chart";
import { SubagentShareChart } from "./efficiency/subagent-share-chart";
import { SessionLookupForm } from "./session-lookup-form";
import { SignOutButton } from "./sign-out-button";

const RANGE_DAYS = 30;
/** D21/D41 — the colour domain looks back further than any window this run's UI can select yet,
 * so a value's slot never depends on the currently selected window. */
const COLOR_DOMAIN_LOOKBACK_DAYS = 365;

/**
 * The dashboard's default window — every query here carries a bounded `{from, to}` range so
 * the existing time indexes are used; an unbounded query is never issued. `from` is aligned to
 * a local-midnight day boundary (R38/D16) so the leftmost chart bar is always a full day, never
 * a rolling-window fragment (`to` stays "now" — today's own partial bar is expected).
 */
function defaultRange(): DateRange {
	const to = new Date();
	const rollingFrom = new Date(to.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000);
	const from = startOfDayInTimezone(rollingFrom, DASHBOARD_TIMEZONE);
	return { from, to };
}

/**
 * The colour-domain lookback (D21) — a fixed, wide window independent of the operator's selected
 * range, so a value's chart colour never changes when the selected window changes.
 */
function colorDomainLookback(): DateRange {
	const to = new Date();
	const from = new Date(to.getTime() - COLOR_DOMAIN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
	return { from, to };
}

/**
 * Dashboard root (Steps 19-20). Gated by `src/proxy.ts`. Fetches cost-per-day split by
 * machine/project/model, subagent cost share, and cache read-vs-write efficiency, all over the
 * same bounded default range, plus each split dimension's colour domain over a wider, fixed
 * lookback (D21).
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
	const range = defaultRange();
	const lookback = colorDomainLookback();
	const db = await getDatabase();

	const [byMachine, byProject, byModel, efficiency, machineDomain, projectDomain, modelDomain] = await Promise.all([
		costPerDay(db, CostSplitDimension.Machine, range),
		costPerDay(db, CostSplitDimension.Project, range),
		costPerDay(db, CostSplitDimension.Model, range),
		dailyEfficiency(db, range),
		dimensionValueDomain(db, CostSplitDimension.Machine, lookback),
		dimensionValueDomain(db, CostSplitDimension.Project, lookback),
		dimensionValueDomain(db, CostSplitDimension.Model, lookback),
	]);

	// The window's own first/last day, read in the dashboard's calendar (D11/D24) — gap fill spans
	// what was requested, so a day with no work holds its place on the axis instead of vanishing.
	const firstDay = dayKeyInTimezone(range.from, DASHBOARD_TIMEZONE);
	const lastDay = dayKeyInTimezone(range.to, DASHBOARD_TIMEZONE);
	const filledEfficiency = fillMissingDays(efficiency, firstDay, lastDay, emptyEfficiencyRow);

	return (
		<main className="grid gap-6 p-8">
			<div className="grid grid-cols-[1fr_auto] items-center gap-4">
				<h1 className="text-lg font-medium text-foreground">Claude Usage</h1>
				<SignOutButton />
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Cost per day — last {RANGE_DAYS} days</CardTitle>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="machine">
						<TabsList>
							<TabsTrigger value="machine">Machine</TabsTrigger>
							<TabsTrigger value="project">Project</TabsTrigger>
							<TabsTrigger value="model">Model</TabsTrigger>
						</TabsList>
						<TabsContent value="machine">
							<CostSplitView
								rows={byMachine}
								dimensionLabel="Machine"
								domainOrder={machineDomain}
								firstDay={firstDay}
								lastDay={lastDay}
							/>
						</TabsContent>
						<TabsContent value="project">
							<CostSplitView
								rows={byProject}
								dimensionLabel="Project"
								domainOrder={projectDomain}
								firstDay={firstDay}
								lastDay={lastDay}
							/>
						</TabsContent>
						<TabsContent value="model">
							<CostSplitView
								rows={byModel}
								dimensionLabel="Model"
								domainOrder={modelDomain}
								firstDay={firstDay}
								lastDay={lastDay}
							/>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Subagent share of cost</CardTitle>
				</CardHeader>
				<CardContent>
					<SubagentShareChart rows={filledEfficiency} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Cache reads vs writes</CardTitle>
				</CardHeader>
				<CardContent>
					<CacheEfficiencyChart rows={filledEfficiency} />
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
		</main>
	);
}
