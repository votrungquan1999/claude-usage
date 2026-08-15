import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SessionModelBreakdownRow } from "@/server/usage-queries";

import { cn } from "@/lib/utils";

import { formatLowerBoundCost } from "../../dashboard-format";

/**
 * The session drill-down's frame — the same bare-`grid` overflow defect as `dashboard-shell.ui.tsx`
 * and `split-value.ui.tsx` (Step 2), extracted here because `page.tsx` is a server
 * component and ADR 0001 forbids styling/layout code living there directly.
 */
export function SessionDetailLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return <main className={cn("gap-6 p-8", "grid grid-cols-[minmax(0,1fr)]")}>{children}</main>;
}

/** The pinned Model column's treatment (D2/D25) — stuck to the scroll region's left edge, painted
 * opaquely so scrolled-under content can't show through. No width cap: unlike the session list's
 * model-GENERATED title (risk R27), a model name is drawn from a small, known, bounded set. */
const PINNED_MODEL_CLASSES = cn("bg-card", "sticky left-0 z-10");

export interface SessionModelCostTableProps {
	rows: SessionModelBreakdownRow[];
}

/**
 * The session drill-down's per-model cost breakdown (Step 21). Extracted from `page.tsx` (a server
 * component) so this table can carry the pinned-column styling ADR 0001 forbids living there
 * directly — the same reason `SessionDetailLayout` above was extracted in Step 2.
 */
export function SessionModelCostTable({ rows }: SessionModelCostTableProps): React.JSX.Element {
	return (
		<Table aria-label="Cost by model">
			<TableHeader>
				<TableRow>
					<TableHead className={PINNED_MODEL_CLASSES}>Model</TableHead>
					<TableHead className="text-right">Cost</TableHead>
					<TableHead className="text-right">Subagent cost</TableHead>
					<TableHead className="text-right">Events</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.model}>
						<TableCell className={PINNED_MODEL_CLASSES}>{row.model}</TableCell>
						<TableCell className="text-right">{formatLowerBoundCost(row.costUsd, row.unpricedEventCount)}</TableCell>
						<TableCell className="text-right">
							{formatLowerBoundCost(row.subagentCostUsd, row.subagentUnpricedEventCount)}
						</TableCell>
						<TableCell className="text-right">{row.eventCount}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
