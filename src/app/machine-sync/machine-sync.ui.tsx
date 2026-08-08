"use client";

import { cn } from "@/lib/utils";

/**
 * The tile's frame: a label plus one row per machine. Sits above the filter row, like `KpiTile`,
 * since a per-machine sync signal is not scoped by the window either (D22).
 */
export function MachineSyncTile({ children }: { children: React.ReactNode }): React.JSX.Element {
	return (
		<div className={cn("gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground", "grid")}>
			<p className="text-sm text-muted-foreground">Machine sync</p>
			<div className={cn("gap-2", "grid")}>{children}</div>
		</div>
	);
}

export interface MachineSyncRowProps {
	machineId: string;
	/** "never", or an absolute timestamp already formatted in the dashboard timezone. */
	lastContact: string;
	/** card #161 Batch A fix pass, Fix 1 — the last sync that actually delivered work (D4's
	 * second timestamp), shown alongside contact so an idle-but-healthy machine can be told
	 * apart from one that connects but has silently stopped finding events. Same "never"/
	 * formatted-timestamp shape as `lastContact`. */
	lastAccepted: string;
	/** D10 — reads as "no activity in 12h", not "sync is broken". */
	stale: boolean;
}

/** One machine: its id, when it was last heard from, when it last delivered work, and — only
 * when stale — why that's flagged. */
export function MachineSyncRow({ machineId, lastContact, lastAccepted, stale }: MachineSyncRowProps): React.JSX.Element {
	return (
		<div className={cn("items-center gap-3 text-sm", "grid grid-cols-[1fr_auto_auto_auto]")}>
			<span className="text-foreground">{machineId}</span>
			<span className="text-muted-foreground">{lastContact}</span>
			<span className="text-muted-foreground">{lastAccepted}</span>
			{stale && <span className="text-xs text-destructive">No activity in 12h</span>}
		</div>
	);
}
