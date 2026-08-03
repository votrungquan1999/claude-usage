"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";

import type { SeriesColorMap } from "../cost-split-view/cost-split-view.type";
import { OTHER_SERIES_KEY, type ModelMixDayRow } from "../dashboard-format";

export interface ModelMixChartProps {
	rows: ModelMixDayRow[];
	/** The models with their own series, in the same rank order the Model tab uses. */
	seriesKeys: string[];
	/** Each model's stable colour (D21) — the SAME map the Model tab resolves, so a model is one
	 * colour across both surfaces. */
	colors: SeriesColorMap;
}

/**
 * How spend is distributed across models over time, as a share of each day's priced spend (D27).
 * Deliberately not a second dollar chart — the Model tab already shows absolute cost. Plotting
 * share is what makes a shift toward a cheaper model visible even in a week when the total moved.
 *
 * A day with no priced spend is a BREAK, not a flat zero (D39): the models may well have been
 * used, and a zero would claim they were not.
 */
export function ModelMixChart({ rows, seriesKeys, colors }: ModelMixChartProps): React.JSX.Element {
	if (rows.every((row) => row.totalEventCount === 0)) {
		return <div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">No data in this range</div>;
	}

	const hasOther = rows.some((row) => OTHER_SERIES_KEY in row);
	// A model name is CSS-safe today, but the cost chart already learned that a dimension value
	// cannot be trusted as a custom-property name — same synthetic ids here for the same reason.
	const ids = seriesKeys.map((_, index) => `m${index}`);

	const config: ChartConfig = {};
	seriesKeys.forEach((key, index) => {
		config[ids[index]] = { label: key, color: colors[key] };
	});
	if (hasOther) config.other = { label: OTHER_SERIES_KEY, color: "var(--chart-other)" };

	const data = rows.map((row) => {
		const mapped: Record<string, string | number | null> = { day: row.day };
		seriesKeys.forEach((key, index) => {
			mapped[ids[index]] = asShare(row[key]);
		});
		if (hasOther) mapped.other = asShare(row[OTHER_SERIES_KEY]);
		return mapped;
	});

	const areaIds = hasOther ? [...ids, "other"] : ids;

	return (
		<ChartContainer config={config} className="aspect-auto h-64 w-full">
			<AreaChart data={data}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis
					tickLine={false}
					axisLine={false}
					width={48}
					domain={[0, 1]}
					tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
				/>
				<ChartTooltip
					content={<ChartTooltipContent formatter={(value) => `${Math.round(Number(value) * 100)}%`} />}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				{areaIds.map((id) => (
					<Area
						key={id}
						dataKey={id}
						stackId="mix"
						type="monotone"
						stroke={`var(--color-${id})`}
						fill={`var(--color-${id})`}
						fillOpacity={0.7}
						connectNulls={false}
					/>
				))}
			</AreaChart>
		</ChartContainer>
	);
}

/**
 * One cell's share, or `null` where the day has none — an absent key (a gap-filled day) and an
 * explicit `null` (a day with no priced spend) must both break the series, not stack as zero.
 *
 * @param value - the raw cell from a mix row
 */
function asShare(value: string | number | null | undefined): number | null {
	return typeof value === "number" ? value : null;
}
