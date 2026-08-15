"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cn } from "@/lib/utils";

import { useMachineRename } from "./machine-sync.state";

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
	/** Short, readable display text — nickname, else a head-8 id (D1/D7). Computed in
	 * the server component `machine-sync.tsx`, not here (this file renders only what it is given).
	 * Renamed from `displayId` (Step 3) now that it can hold an operator-typed nickname, not only a
	 * shortened id (Step 10). */
	displayName: string;
	/** The full stored id — never the primary visible text (that's `displayName`); reachable via a
	 * hover `title` and a screen-reader-only companion span. */
	machineId: string;
	/** The machine's raw stored nickname, or `null` when unset — what an edit starts pre-filled
	 * with (never the short-id fallback, so editing doesn't look like typing over it). */
	name: string | null;
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

/** One machine: its id, a control to rename it, when it was last heard from, when it last
 * delivered work, and — only when stale — why that's flagged. The id and its timestamps stack
 * (Step 3) rather than sharing one `grid-cols-[1fr_auto_auto_auto]` row, whose unshrinkable `1fr`
 * track was the dashboard's single biggest mobile overflow before this fix. */
export function MachineSyncRow({ displayName, machineId, name, lastContact, lastAccepted, stale }: MachineSyncRowProps): React.JSX.Element {
	return (
		<div className={cn("gap-1 text-sm", "grid min-w-0")}>
			{/* aria-hidden: a screen reader reads the sr-only companion below instead, so the full
			    id is announced once, not both the short and full forms back to back. */}
			<span className="font-mono text-foreground" title={machineId} aria-hidden="true">
				{displayName}
			</span>
			<span className="sr-only">{machineId}</span>
			{/* A flat sibling of the id spans, not a wrapper around them — so a row's own timestamp
			    line stays a direct descendant of the SAME ancestor the id renders under (existing
			    tests locate "the row" via the id span's parent). */}
			<MachineRenameControl machineId={machineId} displayName={displayName} name={name} />

			<div className={cn("items-center gap-x-3 gap-y-1 text-muted-foreground", "flex flex-wrap")}>
				<span>{lastContact}</span>
				<span>{lastAccepted}</span>
				{stale && <span className="text-xs text-destructive">No activity in 12h</span>}
			</div>
		</div>
	);
}

interface MachineRenameControlProps {
	machineId: string;
	/** Only for the edit trigger's accessible name — two rows can both say "Rename", which is
	 * ambiguous once read outside the row that gives it context. */
	displayName: string;
	name: string | null;
}

/**
 * The sync tile's write path (D6): open, edit, save or cancel. Saving posts to
 * `/api/machines` and, on success, refreshes the page's server data (D11) — the actual
 * propagation to every other card happens there, not in this component.
 */
function MachineRenameControl({ machineId, displayName, name }: MachineRenameControlProps): React.JSX.Element {
	const { isEditing, value, submitting, error, startEdit, cancelEdit, setValue, save } = useMachineRename(machineId, name);

	if (!isEditing) {
		return (
			<Button type="button" variant="ghost" size="sm" onClick={startEdit} className={cn("h-11", "sm:h-7")}>
				{`Rename ${displayName}`}
			</Button>
		);
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
			className={cn("items-center gap-2", "flex flex-wrap")}
		>
			<Input
				value={value}
				onChange={(event) => setValue(event.target.value)}
				aria-label={`Name for ${displayName}`}
				placeholder="Machine name"
				disabled={submitting}
				className={cn("w-40", "h-11 sm:h-8")}
			/>
			<Button type="submit" size="sm" disabled={submitting} className={cn("h-11", "sm:h-7")}>
				{submitting ? "Saving…" : "Save"}
			</Button>
			<Button type="button" variant="ghost" size="sm" onClick={cancelEdit} disabled={submitting} className={cn("h-11", "sm:h-7")}>
				Cancel
			</Button>
			{error !== null && (
				<p role="alert" className="w-full text-xs text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}
