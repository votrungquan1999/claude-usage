"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useRangeNavigation } from "./range-picker/range-picker.state";
import type { DashboardWindowView } from "./range-picker/range-picker.type";
import { RangePreset } from "./range-picker/range-picker.type";
import { RangeCalendarField, RangePresetField } from "./range-picker/range-picker.ui";

export interface DashboardShellProps {
	/** Title and account actions, composed on the server. */
	header: ReactNode;
	/** Headline figures over FIXED periods, rendered above the filter row because the filter does
	 * not scope them (D22). */
	kpis: ReactNode;
	/** Per-machine sync status (card #161). Its own slot, not merged into `kpis`: `kpis` is a
	 * single already-composed element, and this is a visually distinct tile next to it — also not
	 * scoped by the filter row, for the same D22 reason. */
	machineSync: ReactNode;
	/** The window currently on screen, and the days the calendar may offer. */
	view: DashboardWindowView;
	/** Preset value to label, for the picker's closed trigger. */
	rangeLabels: Record<string, string>;
	/** The picker's option list, composed on the server. */
	rangeOptions: ReactNode;
	/** Stated when the URL asked for a window the app could not honour (D37); `null` otherwise. */
	notice: ReactNode;
	/** The cards. Everything here is scoped by the window above it. */
	children: ReactNode;
}

/**
 * The dashboard's frame: header, the filter row, and everything the filter scopes.
 *
 * It owns the range transition rather than delegating it to the picker, because the pending flag
 * has to reach the cards: a window change holds the whole page and swaps at once (D33), so the
 * operator never reads a chart and a table describing different periods. Two `useTransition`
 * calls would not share that flag, so there is exactly one, here.
 */
export function DashboardShell({
	header,
	kpis,
	machineSync,
	view,
	rangeLabels,
	rangeOptions,
	notice,
	children,
}: DashboardShellProps): React.JSX.Element {
	const { selectPreset, selectCustomRange, isPending } = useRangeNavigation();

	return (
		<main className={cn("gap-6 p-8", "grid")}>
			<div className={cn("items-center gap-4", "grid grid-cols-[1fr_auto]")}>{header}</div>

			{kpis}
			{machineSync}

			<div className={cn("items-center gap-3", "grid grid-cols-[auto_auto_1fr]")}>
				<RangePresetField
					value={view.preset}
					items={rangeLabels}
					onSelect={(next) => selectPreset(next as RangePreset)}
				>
					{rangeOptions}
				</RangePresetField>
				{/* Keyed on the committed window so choosing a preset resets the calendar's draft by
				    remounting, rather than by mirroring props into state in an effect. */}
				<RangeCalendarField
					key={`${view.fromDay}:${view.toDay}`}
					label={view.label}
					fromDay={view.fromDay}
					toDay={view.toDay}
					earliestDay={view.earliestDay}
					latestDay={view.latestDay}
					timeZone={view.timeZone}
					onSelectRange={selectCustomRange}
				/>
				{notice}
			</div>

			{/* Dimmed, not replaced: the previous window stays readable until the new one is ready. */}
			<div className={cn("gap-6 transition-opacity", "grid", isPending && "opacity-60")} aria-busy={isPending}>
				{children}
			</div>
		</main>
	);
}

/**
 * The dashboard's heading.
 */
export function DashboardTitle({ children }: { children: ReactNode }): React.JSX.Element {
	return <h1 className="text-lg font-medium text-foreground">{children}</h1>;
}

/**
 * States that the URL asked for something the app could not honour, next to the picker showing
 * what it fell back to (D37) — a silently corrected parameter is a lie about the period on screen.
 */
export function RangeFallbackNotice({ children }: { children: ReactNode }): React.JSX.Element {
	return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * Holds a card's space while its own query resolves, so the cards around it can paint first.
 */
export function CardPlaceholder(): React.JSX.Element {
	return <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />;
}

/**
 * Shown in place of a card whose query failed, so one failure costs one card and not the page.
 */
export function CardErrorNotice({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className="grid h-64 w-full place-items-center text-sm text-muted-foreground">{children}</div>;
}
