"use client";

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, XAxis, YAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import type { DailyEfficiencyRow } from "@/server/usage-queries";

import { cacheReadRatio, subagentCostShare } from "./dashboard-format";

export interface SubagentShareChartProps {
	rows: DailyEfficiencyRow[];
}

/**
 * Subagent share of daily cost, as a line (Step 20). A single series names itself in the card
 * title, so no legend box — a day with zero priced cost renders as a gap, never a false 0%.
 */
export function SubagentShareChart({ rows }: SubagentShareChartProps): React.JSX.Element {
	if (rows.length === 0) {
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
				<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(value: number) => `${value}%`} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Line dataKey="sharePct" type="monotone" stroke="var(--color-sharePct)" strokeWidth={2} dot={false} connectNulls={false} />
			</LineChart>
		</ChartContainer>
	);
}

export interface CacheEfficiencyChartProps {
	rows: DailyEfficiencyRow[];
}

/**
 * Cache read-vs-write token volume per day, stacked, plus the read ratio as a line on a second
 * axis (Step 20). Tokens count regardless of `priced` (D8) — every event contributes, unpriced
 * or not. The ratio line uses `cacheReadRatio`, which reads as a gap (not `0%`) on a day with
 * zero cache activity — previously computed but never rendered anywhere in this repo.
 */
export function CacheEfficiencyChart({ rows }: CacheEfficiencyChartProps): React.JSX.Element {
	if (rows.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	const data = rows.map((row) => {
		const ratio = cacheReadRatio(row);
		return {
			day: row.day,
			reads: row.cacheReadTokens,
			writes: row.cacheWrite5mTokens + row.cacheWrite1hTokens,
			readRatioPct: ratio === null ? null : Math.round(ratio * 1000) / 10,
		};
	});
	const config: ChartConfig = {
		reads: { label: "Cache reads", color: "var(--chart-1)" },
		writes: { label: "Cache writes", color: "var(--chart-3)" },
		readRatioPct: { label: "Read ratio", color: "var(--chart-5)" },
	};

	return (
		<ChartContainer config={config} className="aspect-auto h-56 w-full">
			<ComposedChart data={data}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis yAxisId="tokens" tickLine={false} axisLine={false} width={48} />
				<YAxis
					yAxisId="ratio"
					orientation="right"
					tickLine={false}
					axisLine={false}
					width={40}
					tickFormatter={(value: number) => `${value}%`}
				/>
				<ChartTooltip content={<ChartTooltipContent />} />
				<ChartLegend content={<ChartLegendContent />} />
				<Bar yAxisId="tokens" dataKey="reads" stackId="cache" fill="var(--color-reads)" />
				<Bar yAxisId="tokens" dataKey="writes" stackId="cache" fill="var(--color-writes)" />
				<Line
					yAxisId="ratio"
					dataKey="readRatioPct"
					type="monotone"
					stroke="var(--color-readRatioPct)"
					strokeWidth={2}
					dot={false}
					connectNulls={false}
				/>
			</ComposedChart>
		</ChartContainer>
	);
}
