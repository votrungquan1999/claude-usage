"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatLowerBoundCost, type DimensionTotal } from "../dashboard-format";

import type { SeriesColorMap } from "./cost-split-view.type";

export interface DimensionTotalsTableDisplayProps {
	totals: DimensionTotal[];
	dimensionLabel: string;
	/** Every row's colour swatch (D10/D21) — a row folded into the chart's "Other" bucket resolves
	 * to `var(--chart-other)` here, same as the bar it's part of. */
	colors: SeriesColorMap;
}

/**
 * Renders the per-dimension totals table (Step 19/22), including the colour swatch column so a
 * name can be tied to its chart bar without reading the legend (D10). A swatch's colour is set
 * inline — it's assigned at runtime per dimension value, and Tailwind can't generate a utility
 * class for a colour it doesn't know ahead of time.
 */
export function DimensionTotalsTableDisplay({
	totals,
	dimensionLabel,
	colors,
}: DimensionTotalsTableDisplayProps): React.JSX.Element {
	if (totals.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-6">
						<span className="sr-only">Colour</span>
					</TableHead>
					<TableHead>{dimensionLabel}</TableHead>
					<TableHead className="text-right">Cost</TableHead>
					<TableHead className="text-right">Events</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{totals.map((total) => (
					<TableRow key={total.dimensionValue}>
						<TableCell>
							<span
								aria-hidden="true"
								className="inline-block size-3 rounded-full"
								style={{ backgroundColor: colors[total.dimensionValue] }}
							/>
						</TableCell>
						<TableCell>{total.dimensionValue}</TableCell>
						<TableCell className="text-right">
							{formatLowerBoundCost(total.costUsd, total.unpricedEventCount)}
							{total.unpricedEventCount > 0 && (
								<Badge variant="outline" className="ml-2">
									unpriced
								</Badge>
							)}
						</TableCell>
						<TableCell className="text-right">{total.eventCount}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
