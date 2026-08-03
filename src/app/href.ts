import { DEFAULT_SPLIT_TAB, SplitTab } from "./cost-split-view/cost-split-view.type";
import { DEFAULT_RANGE_PRESET, RangePreset } from "./range-picker/range-picker.type";

/**
 * The dashboard's URL parameter schema — declared here, in one place, because the URL is the sole
 * source of dashboard view state (D7) and two modules read it (`parseDashboardRange` parses,
 * `dashboardHref` serializes). Both import these keys rather than spelling them twice.
 *
 * - `preset` — one of `RangePreset`; omitted when it equals `DEFAULT_RANGE_PRESET`.
 * - `tab` — one of `SplitTab`; omitted when it equals `DEFAULT_SPLIT_TAB`.
 * - `from` / `to` — `YYYY-MM-DD` local days in `DASHBOARD_TIMEZONE`, for an explicit custom range.
 *   When both are present they WIN over `preset`, which is then dropped from the link (D37).
 *   Introduced with the calendar; nothing reads them yet.
 *
 * Any value outside its declared set falls back to the default rather than reaching a query (D30).
 */
export const RANGE_PRESET_PARAM = "preset";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const SPLIT_TAB_PARAM = "tab";

/** What a dashboard link changes relative to the URL it is built from. Every field is optional —
 * an omitted one keeps whatever the current URL says, so changing the tab never disturbs the
 * window and vice versa. */
export interface DashboardHrefChanges {
	preset?: RangePreset;
	tab?: SplitTab;
}

/**
 * Builds a dashboard link from the current parameters plus the one thing that changed. Unrelated
 * parameters are carried through untouched, and a value equal to its default is REMOVED rather
 * than written, so the default view has a clean shareable URL and `?preset=30d` never accumulates.
 *
 * @param current - the parameters the page is being viewed with
 * @param changes - the parameters this link sets; omitted keys keep their current value
 */
export function dashboardHref(current: URLSearchParams, changes: DashboardHrefChanges): string {
	const next = new URLSearchParams(current);

	if (changes.preset !== undefined) setOrClearDefault(next, RANGE_PRESET_PARAM, changes.preset, DEFAULT_RANGE_PRESET);
	if (changes.tab !== undefined) setOrClearDefault(next, SPLIT_TAB_PARAM, changes.tab, DEFAULT_SPLIT_TAB);

	const query = next.toString();
	return query === "" ? DASHBOARD_PATH : `${DASHBOARD_PATH}?${query}`;
}

/**
 * Writes a parameter, or removes it when it carries the default value — so a shared link says only
 * what actually differs from the default view.
 *
 * @param params - the parameters being built (mutated in place)
 * @param key - the parameter name
 * @param value - the value this link selects
 * @param defaultValue - the value the app assumes when the key is absent
 */
function setOrClearDefault(params: URLSearchParams, key: string, value: string, defaultValue: string): void {
	if (value === defaultValue) params.delete(key);
	else params.set(key, value);
}

/** The dashboard lives at the root; links are absolute so `router.replace` never resolves them
 * against whatever path the operator happens to be on. */
const DASHBOARD_PATH = "/";

/**
 * Builds the link to a session's drill-down page. The one place this URL shape is constructed —
 * every caller (the session lookup form now, the session list later) imports this instead of
 * hand-building the path.
 *
 * @param sessionId - the session identifier to link to
 */
export function sessionHref(sessionId: string): string {
	return `/session/${encodeURIComponent(sessionId)}`;
}
