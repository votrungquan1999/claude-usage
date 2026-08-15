"use client";

import type { ReactNode } from "react";

import { Tabs, TabsList } from "@/components/ui/tabs";

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

export interface SplitTabsListProps {
	/** The `<TabsTrigger>` list, composed on the server (`cost-splits.tsx`). */
	children: ReactNode;
}

/**
 * The `Machine | Project | Model | Repo` strip (D5). Stays a strip of tabs — never a `Select`,
 * which would give the same control two identities across viewports — and scrolls sideways rather
 * than wrapping if it ever outgrows the width. 44px tall on mobile only (D4); the override repeats
 * `TabsList`'s own `group-data-horizontal/tabs:h-8` modifier chain rather than a plain `h-11`,
 * because a plain class cannot beat a gated variant through `twMerge`.
 */
export function SplitTabsList({ children }: SplitTabsListProps): React.JSX.Element {
	return (
		<TabsList
			className={cn("overflow-x-auto max-w-full", "group-data-horizontal/tabs:h-11", "sm:group-data-horizontal/tabs:h-8")}
		>
			{children}
		</TabsList>
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
