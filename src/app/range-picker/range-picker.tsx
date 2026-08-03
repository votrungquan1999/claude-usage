import { SelectItem } from "@/components/ui/select";

import { RangePreset } from "./range-picker.type";

/** What each window is called on screen. Server-owned copy, passed to the picker so its closed
 * trigger names the current window with the same words as the open list. */
export const RANGE_PRESET_LABELS: Record<string, string> = {
	[RangePreset.Today]: "Today",
	[RangePreset.Last7Days]: "Last 7 days",
	[RangePreset.Last30Days]: "Last 30 days",
	[RangePreset.Last90Days]: "Last 90 days",
	[RangePreset.AllTime]: "All time",
};

/**
 * The window options, composed on the server. Each label counts today as the window's last day,
 * so "Last 7 days" draws exactly 7 bars.
 */
export function RangePresetOptions(): React.JSX.Element {
	return (
		<>
			{Object.entries(RANGE_PRESET_LABELS).map(([preset, label]) => (
				<SelectItem key={preset} value={preset}>
					{label}
				</SelectItem>
			))}
		</>
	);
}
