import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDatabase } from "@/server/database";
import {
	CostSplitDimension,
	DASHBOARD_TIMEZONE,
	costPerDay,
	dailyEfficiency,
	type DailyCostByDimensionRow,
	type DateRange,
} from "@/server/usage-queries";

import { CostChart } from "./cost-chart";
import { pivotForChart, rankDimensionTotals, startOfDayInTimezone } from "./dashboard-format";
import { DimensionTotalsTable } from "./dimension-totals-table";
import { CacheEfficiencyChart, SubagentShareChart } from "./efficiency-charts";
import { SessionLookupForm } from "./session-lookup-form";
import { SignOutButton } from "./sign-out-button";

const RANGE_DAYS = 30;
const TOP_SERIES_COUNT = 5;

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
 * One cost-per-day split view: a stacked bar chart capped to the top 5 dimension values plus
 * "Other", and the exact per-dimension totals table below it.
 */
function CostSplitView({
	rows,
	dimensionLabel,
}: {
	rows: DailyCostByDimensionRow[];
	dimensionLabel: string;
}): React.JSX.Element {
	const totals = rankDimensionTotals(rows);
	const topValues = totals.slice(0, TOP_SERIES_COUNT).map((total) => total.dimensionValue);
	const chartData = pivotForChart(rows, topValues);

	return (
		<div className="grid gap-4 pt-4">
			<CostChart data={chartData} seriesKeys={topValues} />
			<DimensionTotalsTable totals={totals} dimensionLabel={dimensionLabel} />
		</div>
	);
}

/**
 * Dashboard root (Steps 19-20). Gated by `src/proxy.ts`. Fetches cost-per-day split by
 * machine/project/model, subagent cost share, and cache read-vs-write efficiency, all over the
 * same bounded default range.
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
	const range = defaultRange();
	const db = await getDatabase();

	const [byMachine, byProject, byModel, efficiency] = await Promise.all([
		costPerDay(db, CostSplitDimension.Machine, range),
		costPerDay(db, CostSplitDimension.Project, range),
		costPerDay(db, CostSplitDimension.Model, range),
		dailyEfficiency(db, range),
	]);

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
							<CostSplitView rows={byMachine} dimensionLabel="Machine" />
						</TabsContent>
						<TabsContent value="project">
							<CostSplitView rows={byProject} dimensionLabel="Project" />
						</TabsContent>
						<TabsContent value="model">
							<CostSplitView rows={byModel} dimensionLabel="Model" />
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Subagent share of cost</CardTitle>
				</CardHeader>
				<CardContent>
					<SubagentShareChart rows={efficiency} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Cache reads vs writes</CardTitle>
				</CardHeader>
				<CardContent>
					<CacheEfficiencyChart rows={efficiency} />
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
