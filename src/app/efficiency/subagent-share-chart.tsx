"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	useChartTooltipTrigger,
} from "@/components/ui/chart";
import type { DailyEfficiencyRow } from "@/server/usage-queries";

import { bucketAxisTick, subagentCostShare } from "../dashboard-format";

export interface SubagentShareChartProps {
	rows: DailyEfficiencyRow[];
}

/**
 * Subagent share of daily cost, as a line (Step 20). A single series names itself in the card
 * title, so no legend box — a day with zero priced cost renders as a gap, never a false 0%.
 */
export function SubagentShareChart({ rows }: SubagentShareChartProps): React.JSX.Element {
	// Hooks run before any early return, so the trigger is resolved even on the "No data" path.
	const trigger = useChartTooltipTrigger();

	// `totalEventCount`, not `eventCount` — and not `rows.length`, which stops meaning "no work"
	// once absent days are gap-filled (D24).
	if (rows.every((row) => row.totalEventCount === 0)) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	const data = rows.map((row) => {
		const share = subagentCostShare(row);
		return { day: row.day, sharePct: share === null ? null : Math.round(share * 1000) / 10 };
	});
	const config: ChartConfig = { sharePct: { label: "Subagent share", color: "var(--chart-1)" } };

	return (
		<ChartContainer config={config} className="aspect-auto h-56 w-full">
			<LineChart data={data}>
				<CartesianGrid vertical={false} />
				<XAxis
					dataKey="day"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					tickFormatter={bucketAxisTick}
					interval="preserveStartEnd"
					minTickGap={8}
				/>
				<YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(value: number) => `${value}%`} />
				<ChartTooltip trigger={trigger} content={<ChartTooltipContent />} />
				<Line dataKey="sharePct" type="monotone" stroke="var(--color-sharePct)" strokeWidth={2} dot={false} connectNulls={false} />
			</LineChart>
		</ChartContainer>
	);
}
