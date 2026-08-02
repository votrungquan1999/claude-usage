import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatLowerBoundCost, type DimensionTotal } from "./dashboard-format";

export interface DimensionTotalsTableProps {
	totals: DimensionTotal[];
	dimensionLabel: string;
}

/**
 * Exact per-dimension totals for a cost-per-day split view (Step 19). The chart is capped to
 * 5 series plus "Other"; this table is not, and it's where D17's lower-bound wording is read.
 */
export function DimensionTotalsTable({ totals, dimensionLabel }: DimensionTotalsTableProps): React.JSX.Element {
	if (totals.length === 0) {
		return <p className="py-6 text-center text-sm text-muted-foreground">No data in this range</p>;
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{dimensionLabel}</TableHead>
					<TableHead className="text-right">Cost</TableHead>
					<TableHead className="text-right">Events</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{totals.map((total) => (
					<TableRow key={total.dimensionValue}>
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
