"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The three headline figures, side by side. They sit above the filter row and are NOT scoped by
 * it (D22) — each names its own fixed period, so the layout itself says the filter does not
 * reach them.
 */
export function KpiRow({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className={cn("gap-6", "grid grid-cols-1 md:grid-cols-3")}>{children}</div>;
}

/**
 * One headline figure: its period, the number, and what qualifies it.
 */
export function KpiTile({ children }: { children: ReactNode }): React.JSX.Element {
	return (
		<div className={cn("gap-1 rounded-lg border border-border bg-card p-5 text-card-foreground", "grid")}>
			{children}
		</div>
	);
}

/**
 * Which period a figure covers.
 */
export function KpiLabel({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A supporting figure. Deliberately not `tabular-nums`: these are read one at a time, not compared
 * down a column, and proportional figures set better at display sizes.
 */
export function KpiValue({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-2xl font-medium text-foreground">{children}</p>;
}

/**
 * The one figure the page is built around. Exactly one of these renders, so the eye has a single
 * entry point rather than three competing ones.
 */
export function KpiHeroValue({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-5xl font-semibold text-foreground">{children}</p>;
}

/**
 * What qualifies a figure — the reason it is partial, projected, or a lower bound.
 */
export function KpiNote({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-xs text-muted-foreground">{children}</p>;
}
