"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { cn } from "@/lib/utils";

import { formatLowerBoundCost, machineDisplayName, type DimensionTotal } from "../dashboard-format";

import { useSplitValueLinks } from "./cost-split-view.state";
import { SplitTab, type SeriesColorMap } from "./cost-split-view.type";

/** The swatch column's own fixed width (`w-6` = 1.5rem) — the name column's sticky `left` offset
 * matches it exactly, so the two sit flush together as one pinned unit rather than leaving a gap
 * or an overlap (D25: pinning the swatch alone would leave the row's actual name scrolling away).
 * `px-1.5` (not the base `p-2`) so the padding plus the `size-3` swatch content sums to exactly
 * `w-6`'s 24px — under the table's default (auto) layout, a `width` hint only holds when the
 * content actually fits inside it; the base 8px padding alone pushed the rendered column a few px
 * wider than `w-6`, which is what put it out of sync with the name column's `left-6`. */
const PINNED_SWATCH_CLASSES = cn("bg-card", "sticky left-0 z-10 w-6 px-1.5");

/** See `PINNED_SWATCH_CLASSES` — `left-6` is `w-6`'s own width, so the name sits immediately after
 * the swatch regardless of scroll position. Capped in width, same treatment and reason as the
 * session table's own pinned column (D25/D33): a project slug or a 40-char nickname has no length
 * bound of its own, and an uncapped pinned column would consume the whole 390px viewport and leave
 * nothing to scroll into. */
const PINNED_NAME_CLASSES = cn("bg-card", "sticky left-6 z-10 max-w-40 truncate");

export interface DimensionTotalsTableDisplayProps {
	totals: DimensionTotal[];
	dimensionLabel: string;
	/** Every row's colour swatch (D10/D21) — a row folded into the chart's "Other" bucket resolves
	 * to `var(--chart-other)` here, same as the bar it's part of. */
	colors: SeriesColorMap;
	/** Which split these rows came from, so each name can link to its own drill-down. */
	tab: SplitTab;
	/** LABEL only (D12/D17), Machine tab only — a raw dimensionValue -> display-text map built by
	 * the server caller from real nicknames. Falls back to `machineDisplayName(undefined, ...)`
	 * (never the raw 64-char id) on a missing entry, not to the raw value itself — unlike
	 * `CostChart`'s own fallback, a missing machine entry here must still never show the hash. */
	labels?: Record<string, string>;
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
	tab,
	labels,
}: DimensionTotalsTableDisplayProps): React.JSX.Element {
	const { hrefForValue } = useSplitValueLinks(tab);

	if (totals.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	return (
		<Table aria-label={`${dimensionLabel} totals`}>
			<TableHeader>
				<TableRow>
					<TableHead className={PINNED_SWATCH_CLASSES}>
						<span className="sr-only">Colour</span>
					</TableHead>
					<TableHead className={PINNED_NAME_CLASSES}>{dimensionLabel}</TableHead>
					<TableHead className="text-right">Cost</TableHead>
					<TableHead className="text-right">Events</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{totals.map((total) => (
					<TableRow key={total.dimensionValue}>
						<TableCell className={PINNED_SWATCH_CLASSES}>
							<span
								aria-hidden="true"
								className="inline-block size-3 rounded-full"
								style={{ backgroundColor: colors[total.dimensionValue] }}
							/>
						</TableCell>
						<TableCell className={PINNED_NAME_CLASSES}>
							<a
								href={hrefForValue(total.dimensionValue)}
								className="font-medium text-foreground underline-offset-4 hover:underline"
							>
								{/* LABEL only — colour (above) and href stay keyed to the raw dimensionValue, never
								    this substituted text (D12/D17). */}
								{tab === SplitTab.Machine
									? (labels?.[total.dimensionValue] ?? machineDisplayName(undefined, total.dimensionValue))
									: total.dimensionValue}
							</a>
						</TableCell>
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
