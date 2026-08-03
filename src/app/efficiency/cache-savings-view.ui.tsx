"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Stacks the range-level savings statement above its chart.
 */
export function CacheSavingsLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className={cn("gap-3", "grid")}>{children}</div>;
}

/**
 * States what caching did across the whole selected range, so the answer does not have to be
 * assembled by eye from the bars.
 */
export function CacheSavingsStatement({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-sm text-foreground">{children}</p>;
}
