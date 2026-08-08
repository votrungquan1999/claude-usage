import { DASHBOARD_TIMEZONE } from "@/server/usage-queries";

import { evaluateMachineSyncStatus } from "../dashboard-format";
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

	return (
		<MachineSyncTile>
			{statuses.map((status) => (
				<MachineSyncRow
					key={status.machineId}
					machineId={status.machineId}
					lastContact={status.lastContact}
					lastAccepted={status.lastAccepted}
					stale={status.stale}
				/>
			))}
		</MachineSyncTile>
	);
}
