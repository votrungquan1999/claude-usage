"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	useChartTooltipTrigger,
} from "@/components/ui/chart";

import { bucketAxisTick, type DailySavingsRow } from "../dashboard-format";

export interface CacheSavingsChartProps {
	rows: DailySavingsRow[];
}

/**
 * What caching saved per day, in dollars (D12). Net is what is plotted — gross ignores what
 * populating the cache cost, and the difference is the whole point. A day can go BELOW the zero
 * line (D35): a large one-hour write that is barely read back costs more than it saves, and three
 * days in the real corpus do exactly that. Gross rides along in the tooltip.
 */
export function CacheSavingsChart({ rows }: CacheSavingsChartProps): React.JSX.Element {
	// Hooks run before any early return, so the trigger is resolved even on the "No data" path.
	const trigger = useChartTooltipTrigger();

	// `totalEventCount`, not `rows.length`, which stops meaning "no work" once absent days are
	// gap-filled (D24).
	if (rows.every((row) => row.totalEventCount === 0)) {
		return <div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">No data in this range</div>;
	}

	const data = rows.map((row) => ({ day: row.day, net: row.netSavedUsd, gross: row.grossSavedUsd }));
	const config: ChartConfig = { net: { label: "Net saved", color: "var(--chart-3)" } };

	return (
		<ChartContainer config={config} className="aspect-auto h-64 w-full">
			<BarChart data={data}>
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
				<YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => signedUsd(value)} />
				{/* Without this a negative day just looks like a short bar. */}
				<ReferenceLine y={0} stroke="var(--border)" />
				<ChartTooltip
					trigger={trigger}
					content={
						<ChartTooltipContent
							formatter={(value, _name, _item, _index, row) => {
								const day = row as { gross?: number };
								return `${signedUsd(Number(value))} net · ${signedUsd(day.gross ?? 0)} gross`;
							}}
						/>
					}
				/>
				<Bar dataKey="net" fill="var(--color-net)" />
			</BarChart>
		</ChartContainer>
	);
}

/**
 * A dollar figure with the sign in front of the currency, not after it — `$-1.98` reads as a
 * malformed price rather than as money going the other way.
 *
 * @param value - USD, possibly negative
 */
function signedUsd(value: number): string {
	return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`;
}
