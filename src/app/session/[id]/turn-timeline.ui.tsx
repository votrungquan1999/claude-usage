"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
	useChartTooltipTrigger,
} from "@/components/ui/chart";

import {
	isMainSeriesEmptyWithSubagentActivity,
	turnBucketTooltipLabel,
	turnTimelineEmptyStateCopy,
	type TurnBucketRow,
} from "../../dashboard-format";

export interface TurnTimelineChartProps {
	/** Main-session turns, bucketed. */
	main: TurnBucketRow[];
	/** Subagent turns, bucketed against the SAME plan as `main` — a separate series on the same
	 * turn-order axis (card #161 D6), never interleaved into `main` and never excluded. Same length
	 * and bucket order as `main` by construction (`buildTurnTimeline`). */
	subagent: TurnBucketRow[];
	/** How many turns the session has — always `>= 1` (a session with none 404s before this page
	 * renders). Only used for the empty-state copy (card #161 F2 adversarial Fix D / R37). */
	turnCount: number;
	/** How many of the session's turns are unpriced, from `getSessionBreakdown` — same count the
	 * page's own "Total cost" line already shows. Only used for the empty-state copy. */
	unpricedEventCount: number;
}

/**
 * A session's cost across its life, split into carry (re-paid context) and new work, per turn
 * bucket (card #161 Step 8). A session with no subagent activity still renders the subagent bars —
 * they are simply zero-height, which is what "empty series" looks like on a bar chart, rather than
 * disappearing or folding into the main series.
 */
export function TurnTimelineChart({ main, subagent, turnCount, unpricedEventCount }: TurnTimelineChartProps): React.JSX.Element {
	// Hooks run before any early return, so the trigger is resolved even on the empty-state path.
	const trigger = useChartTooltipTrigger();

	const hasAnyDollars = [...main, ...subagent].some((row) => row.carryUsd !== 0 || row.newUsd !== 0);
	if (hasAnyDollars === false) {
		return (
			<div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">
				{turnTimelineEmptyStateCopy(turnCount, unpricedEventCount)}
			</div>
		);
	}

	// Every main bucket empty while subagent carries real dollars: the whole session ran in a
	// subagent (card #161 F2 adversarial Fix F / R45) — worth saying, or the flat main series reads
	// as broken rather than intentional.
	const mainIsAllSubagent = isMainSeriesEmptyWithSubagentActivity(main, subagent);

	const data = main.map((row, index) => ({
		turnBucket: row.turnBucket,
		carryUsd: row.carryUsd,
		newUsd: row.newUsd,
		subagentCarryUsd: subagent[index]?.carryUsd ?? 0,
		subagentNewUsd: subagent[index]?.newUsd ?? 0,
		// Main + subagent combined — a bucket can mix priced and unpriced turns in either series
		// (card #161 F2 adversarial Fix C / R38).
		unpricedEventCount: row.unpricedEventCount + (subagent[index]?.unpricedEventCount ?? 0),
	}));

	const config: ChartConfig = {
		carryUsd: { label: "Carry", color: "var(--chart-1)" },
		newUsd: { label: "New work", color: "var(--chart-2)" },
		subagentCarryUsd: { label: "Subagent carry", color: "var(--chart-3)" },
		subagentNewUsd: { label: "Subagent new work", color: "var(--chart-4)" },
	};

	return (
		<div className="grid gap-2">
			<ChartContainer config={config} className="aspect-auto h-64 w-full">
				<BarChart data={data}>
					<CartesianGrid vertical={false} />
					<XAxis
						dataKey="turnBucket"
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						interval="preserveStartEnd"
						minTickGap={8}
					/>
					<YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => `$${value.toFixed(2)}`} />
					<ChartTooltip
						trigger={trigger}
						content={
							<ChartTooltipContent
								labelFormatter={(label, tooltipPayload) => {
									const row = tooltipPayload[0]?.payload as { unpricedEventCount?: number } | undefined;
									return turnBucketTooltipLabel(String(label), row?.unpricedEventCount ?? 0);
								}}
							/>
						}
					/>
					<ChartLegend content={<ChartLegendContent />} />
					{/* A genuinely small "new" segment must still read as nonzero rather than a sub-pixel
					sliver the Y-axis then rounds to $0.00 (card #161 F2 adversarial Fix E / R40). */}
					<Bar dataKey="carryUsd" stackId="main" fill="var(--color-carryUsd)" minPointSize={2} />
					<Bar dataKey="newUsd" stackId="main" fill="var(--color-newUsd)" minPointSize={2} />
					<Bar dataKey="subagentCarryUsd" stackId="subagent" fill="var(--color-subagentCarryUsd)" minPointSize={2} />
					<Bar dataKey="subagentNewUsd" stackId="subagent" fill="var(--color-subagentNewUsd)" minPointSize={2} />
				</BarChart>
			</ChartContainer>
			{mainIsAllSubagent && (
				<p className="text-xs text-muted-foreground">
					Every turn in this session ran in a subagent — the main series above is intentionally empty.
				</p>
			)}
		</div>
	);
}
