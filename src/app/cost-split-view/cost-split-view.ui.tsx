"use client";

import type { ReactNode } from "react";

import { Tabs } from "@/components/ui/tabs";

import { cn } from "@/lib/utils";

import { useSplitTabNavigation } from "./cost-split-view.state";
import type { SplitTab } from "./cost-split-view.type";

export interface SplitTabsProps {
	/** The split the URL asked for — the STARTING tab, not a controlled value. */
	initialTab: SplitTab;
	/** The tab list and the three panels, composed on the server. */
	children: ReactNode;
}

/**
 * Owns which split is shown. Uncontrolled on purpose: every split is already rendered, so
 * clicking one must switch instantly rather than waiting for the URL round-trip that records it.
 */
export function SplitTabs({ initialTab, children }: SplitTabsProps): React.JSX.Element {
	const { selectTab } = useSplitTabNavigation();

	return (
		<Tabs defaultValue={initialTab} onValueChange={(next: unknown) => selectTab(String(next) as SplitTab)}>
			{children}
		</Tabs>
	);
}

export interface UnpricedRangeNoticeProps {
	children: React.ReactNode;
}

/**
 * Displays the range-level unpriced-events statement above a cost split's chart (D5). Purely a
 * styling wrapper — the sentence itself is composed server-side in `cost-split-view.tsx` from
 * `summarizeUnpricedDays`, the single source both this notice and the totals table's
 * lower-bound wording read from.
 */
export function UnpricedRangeNotice({ children }: UnpricedRangeNoticeProps): React.JSX.Element {
	return <p className="text-xs text-muted-foreground">{children}</p>;
}

/**
 * Stacks one split's optional lower-bound statement, its chart, and its totals table.
 */
export function CostSplitLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className={cn("gap-4 pt-4", "grid")}>{children}</div>;
}
