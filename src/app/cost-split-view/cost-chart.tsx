"use client";

import { Bar, BarChart, CartesianGrid, XAxis, type XAxisTickContentProps } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";

import type { ChartDayRow } from "../dashboard-format";

/** The chart palette's 5 usable slots (Step 19's "neutral" base colour, fixed — not hand-edited). */
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export interface CostChartProps {
	data: ChartDayRow[];
	/** Dimension values with their own series, in rank order — the caller caps this to 5. */
	seriesKeys: string[];
}

/** One tick label per day; days carrying unpriced spend (D17) get a trailing `*` and a distinct
 * color so a lower-bound bar reads as one even when its visible height is zero. */
function DayTick(unpricedDays: Set<string>) {
	return function renderDayTick(props: XAxisTickContentProps): React.JSX.Element {
		const { x, y, payload } = props;
		const isUnpriced = unpricedDays.has(String(payload.value));
		return (
			<text
				x={x}
				y={Number(y) + 12}
				textAnchor="middle"
				className={isUnpriced ? "fill-destructive text-xs font-medium" : "fill-muted-foreground text-xs"}
			>
				{payload.value}
				{isUnpriced ? " *" : ""}
			</text>
		);
	};
}

/**
 * Stacked bar chart of cost per day, one segment per dimension value (Steps 19/22). A
 * `dimensionValue` (e.g. a project slug containing "/") can't be used directly as a CSS
 * custom-property name, so each series gets a synthetic `s{n}` id for the dataKey/color var —
 * the raw value is only ever shown as the legend/tooltip label, never in the identifier. Days
 * carrying unpriced spend (D17) get a marked x-axis tick and, if any exist, a caption — a
 * zero-height bar must never look identical to a day with no work at all.
 */
export function CostChart({ data, seriesKeys }: CostChartProps): React.JSX.Element {
	const hasOther = data.some((row) => "Other" in row);
	const ids = seriesKeys.map((_, index) => `s${index}`);

	const config: ChartConfig = {};
	seriesKeys.forEach((key, index) => {
		config[ids[index]] = { label: key, color: SERIES_COLORS[index % SERIES_COLORS.length] };
	});
	if (hasOther) config.other = { label: "Other", color: "var(--muted-foreground)" };

	const chartData = data.map((row) => {
		const mapped: Record<string, string | number> = { day: row.day };
		seriesKeys.forEach((key, index) => {
			mapped[ids[index]] = Number(row[key]) || 0;
		});
		if (hasOther) mapped.other = Number(row.Other) || 0;
		return mapped;
	});

	const barIds = hasOther ? [...ids, "other"] : ids;
	const unpricedDays = new Set(data.filter((row) => row.unpricedEventCount > 0).map((row) => row.day));

	if (data.length === 0) {
		return (
			<div className="flex h-64 w-full items-center justify-center text-sm text-muted-foreground">
				No data in this range
			</div>
		);
	}

	return (
		<div className="grid gap-1">
			<ChartContainer config={config} className="aspect-auto h-64 w-full">
				<BarChart data={chartData}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} tick={DayTick(unpricedDays)} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{barIds.map((id) => (
						<Bar key={id} dataKey={id} stackId="cost" fill={`var(--color-${id})`} />
					))}
				</BarChart>
			</ChartContainer>
			{unpricedDays.size > 0 && (
				<p className="text-xs text-muted-foreground">* day includes unpriced events — bar height is a lower bound</p>
			)}
		</div>
	);
}
