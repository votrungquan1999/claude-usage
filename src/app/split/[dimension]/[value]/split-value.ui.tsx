import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Stacks a drill-down's back link, heading, summary and session table.
 */
export function SplitValueLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return <main className={cn("gap-6 p-8", "grid")}>{children}</main>;
}

/**
 * The way back to the dashboard, carrying the window and the tab the operator arrived from — the
 * browser's back button does this too, but a link also works on a URL that was shared rather than
 * navigated to.
 */
export function BackToDashboard({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
	return (
		<a href={href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
			{`← ${children}`}
		</a>
	);
}

/**
 * Names what was clicked, in both vocabularies: which split it came from and what it is called.
 */
export function SplitValueHeading({ label, value }: { label: string; value: string }): React.JSX.Element {
	return (
		<div className="grid gap-1">
			<span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
			<h1 className="text-lg font-medium text-foreground">{value}</h1>
		</div>
	);
}

/**
 * The figures behind the row that was clicked. Rendered as a row of separated facts rather than
 * KPI tiles: these are one value's window totals, not headline figures, and tiles would compete
 * with the dashboard's.
 */
export function SplitValueSummary({ children }: { children: ReactNode }): React.JSX.Element {
	return (
		<div className={cn("items-center gap-x-3 gap-y-1 text-sm text-foreground", "flex flex-wrap")}>{children}</div>
	);
}
