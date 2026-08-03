/** The windows the operator can select from the picker. Values are the literal `?preset=` strings
 * — a closed set, so an unrecognised value can never widen a query (see `parseDashboardRange`). */
export enum RangePreset {
	Today = "today",
	Last7Days = "7d",
	Last30Days = "30d",
	Last90Days = "90d",
	AllTime = "all",
	/** OUTPUT ONLY — reported when the window came from an explicit `from`/`to` pair. Never
	 * accepted as a `?preset=` value: it names no window of its own, so honouring it as input
	 * would leave the parser with nothing to resolve. */
	Custom = "custom",
}

/** The presets a URL may actually ask for, and the only ones the picker lists. `Custom` is
 * deliberately absent — see the enum. */
export const SELECTABLE_RANGE_PRESETS: RangePreset[] = [
	RangePreset.Today,
	RangePreset.Last7Days,
	RangePreset.Last30Days,
	RangePreset.Last90Days,
	RangePreset.AllTime,
];

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

/** Everything the picker needs to describe the window on screen and the days it may offer. Passed
 * as one object rather than six props so the shell stays readable as later steps add to it. */
export interface DashboardWindowView {
	preset: RangePreset;
	/** The window's own first and last local day, `YYYY-MM-DD` — the calendar's current selection. */
	fromDay: string;
	toDay: string;
	/** The selectable span (D36): the first recorded day, and today. Nothing outside it is offered,
	 * so the calendar cannot ask for days the corpus never covered. */
	earliestDay: string;
	latestDay: string;
	/** The calendar reads clicks in this zone. Passed down rather than imported, so the client
	 * never reaches into `src/server/` for a constant. */
	timeZone: string;
	/** The window stated in words, composed on the server. */
	label: string;
}
