"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
	useChartTooltipTrigger,
} from "@/components/ui/chart";

import { bucketAxisTick, type ChartDayRow } from "../dashboard-format";

import type { SeriesColorMap } from "./cost-split-view.type";

export interface CostChartProps {
	data: ChartDayRow[];
	/** Dimension values with their own series, in rank order — the caller caps this to 5. */
	seriesKeys: string[];
	/** Each series key's stable colour (D21), assigned by `assignSeriesColorSlots` from a
	 * range-independent domain ordering — never derived from `seriesKeys`' own rank order. */
	colors: SeriesColorMap;
	/** LABEL only (D12/D17) — a raw series-key -> display-text map for the legend/tooltip text
	 * alone. `colors` above and each `<Bar>`'s synthetic `s{n}` dataKey stay keyed to the raw
	 * value regardless, so this can never merge two series or move a bar's colour. Absent for
	 * every dimension but Machine, which is the only one with a label that can diverge from its
	 * key. A plain `Record`, not a formatter function: this component is `"use client"`, and a
	 * function passed from its server-component caller can't cross that boundary — only
	 * serializable data can. */
	labels?: Record<string, string>;
}

/**
 * Stacked bar chart of cost per day, one segment per dimension value (Steps 19/22). A
 * `dimensionValue` (e.g. a project slug containing "/") can't be used directly as a CSS
 * custom-property name, so each series gets a synthetic `s{n}` id for the dataKey/color var —
 * the raw value is only ever shown as the legend/tooltip label, never in the identifier. Whether
 * the range includes unpriced events (D17) is stated once, above this chart, by
 * `cost-split-view.tsx`/`cost-split-view.ui.tsx` (D5) — this component carries no per-day marker.
 */
export function CostChart({ data, seriesKeys, colors, labels }: CostChartProps): React.JSX.Element {
	// Hooks run before any early return, so the trigger is resolved even on the "No data" path.
	const trigger = useChartTooltipTrigger();

	// Not `data.length === 0`: once absent days are gap-filled (D24) a dead range is 30 zero rows,
	// not an empty list, so row count stops distinguishing "no work" from "a run of empty days".
	if (data.every((row) => row.eventCount === 0)) {
		return (
			<div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">No data in this range</div>
		);
	}

	const hasOther = data.some((row) => "Other" in row);
	const ids = seriesKeys.map((_, index) => `s${index}`);

	const config: ChartConfig = {};
	seriesKeys.forEach((key, index) => {
		config[ids[index]] = { label: labels?.[key] ?? key, color: colors[key] };
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

	return (
		<ChartContainer config={config} className="aspect-auto h-64 w-full">
			<BarChart data={chartData}>
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
				<ChartTooltip trigger={trigger} content={<ChartTooltipContent />} />
				<ChartLegend content={<ChartLegendContent />} />
				{barIds.map((id) => (
					<Bar key={id} dataKey={id} stackId="cost" fill={`var(--color-${id})`} />
				))}
			</BarChart>
		</ChartContainer>
	);
}
