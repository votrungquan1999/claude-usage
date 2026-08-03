"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";

import type { ChartDayRow } from "../dashboard-format";

import type { SeriesColorMap } from "./cost-split-view.type";

export interface CostChartProps {
	data: ChartDayRow[];
	/** Dimension values with their own series, in rank order — the caller caps this to 5. */
	seriesKeys: string[];
	/** Each series key's stable colour (D21), assigned by `assignSeriesColorSlots` from a
	 * range-independent domain ordering — never derived from `seriesKeys`' own rank order. */
	colors: SeriesColorMap;
}

/**
 * Stacked bar chart of cost per day, one segment per dimension value (Steps 19/22). A
 * `dimensionValue` (e.g. a project slug containing "/") can't be used directly as a CSS
 * custom-property name, so each series gets a synthetic `s{n}` id for the dataKey/color var —
 * the raw value is only ever shown as the legend/tooltip label, never in the identifier. Whether
 * the range includes unpriced events (D17) is stated once, above this chart, by
 * `cost-split-view.tsx`/`cost-split-view.ui.tsx` (D5) — this component carries no per-day marker.
 */
export function CostChart({ data, seriesKeys, colors }: CostChartProps): React.JSX.Element {
	const hasOther = data.some((row) => "Other" in row);
	const ids = seriesKeys.map((_, index) => `s${index}`);

	const config: ChartConfig = {};
	seriesKeys.forEach((key, index) => {
		config[ids[index]] = { label: key, color: colors[key] };
	});
	if (hasOther) config.other = { label: "Other", color: "var(--chart-other)" };

	const chartData = data.map((row) => {
		const mapped: Record<string, string | number> = { day: row.day };
		seriesKeys.forEach((key, index) => {
			mapped[ids[index]] = Number(row[key]) || 0;
		});
		if (hasOther) mapped.other = Number(row.Other) || 0;
		return mapped;
	});

	const barIds = hasOther ? [...ids, "other"] : ids;

	if (data.length === 0) {
		return (
			<div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">No data in this range</div>
		);
	}

	return (
		<ChartContainer config={config} className="aspect-auto h-64 w-full">
			<BarChart data={chartData}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<ChartLegend content={<ChartLegendContent />} />
				{barIds.map((id) => (
					<Bar key={id} dataKey={id} stackId="cost" fill={`var(--color-${id})`} />
				))}
			</BarChart>
		</ChartContainer>
	);
}
