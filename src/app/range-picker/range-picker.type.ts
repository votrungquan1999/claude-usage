/** The windows the operator can select from the picker. Values are the literal `?preset=` strings
 * — a closed set, so an unrecognised value can never widen a query (see `parseDashboardRange`). */
export enum RangePreset {
	Today = "today",
	Last7Days = "7d",
	Last30Days = "30d",
	Last90Days = "90d",
	AllTime = "all",
}

/** The window used when the URL names no preset. Omitted from generated links (`dashboardHref`)
 * so a default view has a clean URL. */
export const DEFAULT_RANGE_PRESET = RangePreset.Last30Days;

/** How many calendar days each fixed-length preset spans, counting today as the last one — so
 * "last 7 days" renders exactly 7 bars, not 8. `AllTime` has no fixed length; it resolves from the
 * earliest recorded event (D36). */
export const PRESET_DAY_SPANS: Record<string, number> = {
	[RangePreset.Today]: 1,
	[RangePreset.Last7Days]: 7,
	[RangePreset.Last30Days]: 30,
	[RangePreset.Last90Days]: 90,
};
