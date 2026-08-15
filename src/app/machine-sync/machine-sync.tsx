import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { evaluateMachineSyncStatus, machineDisplayName } from "../dashboard-format";
import { loadMachineSyncStatus } from "../dashboard-loaders";
import { MachineSyncRow, MachineSyncTile } from "./machine-sync.ui";

export interface MachineSyncStatusProps {
	/** The instant the request is being served, epoch milliseconds — passed in rather than read
	 * here so this agrees with every other card about what "now" means (matches `KpiCards`). */
	nowMs: number;
}

/**
 * Per-machine last contact, with one flagged when it has gone quiet for 12h (card #161 D4/D10).
 * NOT scoped by the range picker (D22 precedent: `earliestEventTimestamp`) — a staleness signal
 * that dimmed with the window would misread as "no sync in the selected range".
 */
export async function MachineSyncStatus({ nowMs }: MachineSyncStatusProps): Promise<React.JSX.Element> {
	const rows = await loadMachineSyncStatus();
	// The null-to-"never" mapping and the timestamp formatting both happen inside
	// evaluateMachineSyncStatus now (card #161 Batch A fix pass, Fix 4) — this component only
	// composes the already-formatted strings, so that decision stays covered by a unit test
	// instead of living in a display component this repo's vitest config can't reach.
	const statuses = evaluateMachineSyncStatus(rows, nowMs, DASHBOARD_TIMEZONE);

	// D17 — sorted by what the tile actually shows, not by the raw id: a visible list ordered by
	// an invisible key reads as unsorted. `rankDimensionTotals`'s tie-break deliberately does NOT
	// follow this rule (D17) — that ordering is load-bearing for pagination stability (D38).
	const rowsToRender = statuses
		.map((status) => ({ ...status, displayName: machineDisplayName(status.name ?? undefined, status.machineId) }))
		.sort((a, b) => a.displayName.localeCompare(b.displayName));

	return (
		<MachineSyncTile>
			{rowsToRender.map((status) => (
				<MachineSyncRow
					key={status.machineId}
					displayName={status.displayName}
					machineId={status.machineId}
					name={status.name}
					lastContact={status.lastContact}
					lastAccepted={status.lastAccepted}
					stale={status.stale}
				/>
			))}
		</MachineSyncTile>
	);
}
