import { SelectItem } from "@/components/ui/select";

import { RangePreset, SELECTABLE_RANGE_PRESETS } from "./range-picker.type";

/** What each window is called on screen. Server-owned copy, passed to the picker so its closed
 * trigger names the current window with the same words as the open list. */
export const RANGE_PRESET_LABELS: Record<string, string> = {
	[RangePreset.Today]: "Today",
	[RangePreset.Last7Days]: "Last 7 days",
	[RangePreset.Last30Days]: "Last 30 days",
	[RangePreset.Last90Days]: "Last 90 days",
	[RangePreset.AllTime]: "All time",
	[RangePreset.Custom]: "Custom range",
};

/**
 * The window options, composed on the server. Each label counts today as the window's last day,
 * so "Last 7 days" draws exactly 7 bars.
 */
export function RangePresetOptions(): React.JSX.Element {
	return (
		<>
			{SELECTABLE_RANGE_PRESETS.map((preset) => (
				<SelectItem key={preset} value={preset}>
					{RANGE_PRESET_LABELS[preset]}
				</SelectItem>
			))}
			{/* Always listed, never selectable: it is what the calendar beside this control sets, so
			    the trigger has a name for that state without offering a window it cannot resolve. */}
			<SelectItem value={RangePreset.Custom} disabled>
				{RANGE_PRESET_LABELS[RangePreset.Custom]}
			</SelectItem>
		</>
	);
}
