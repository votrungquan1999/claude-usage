import { DEFAULT_SPLIT_TAB, SplitTab } from "./cost-split-view/cost-split-view.type";
import { DEFAULT_SESSION_SORT, SessionSort } from "./session-list/session-list.type";
import { DEFAULT_RANGE_PRESET, RangePreset } from "./range-picker/range-picker.type";

/**
 * The dashboard's URL parameter schema — declared here, in one place, because the URL is the sole
 * source of dashboard view state (D7) and two modules read it (`parseDashboardRange` parses,
 * `dashboardHref` serializes). Both import these keys rather than spelling them twice.
 *
 * - `preset` — one of `RangePreset`; omitted when it equals `DEFAULT_RANGE_PRESET`.
 * - `tab` — one of `SplitTab`; omitted when it equals `DEFAULT_SPLIT_TAB`.
 * - `sort` — one of `SessionSort`; omitted at the default, and it CLEARS `page` for the same
 *   reason a window change does.
 * - `page` — 1-based session-list page; omitted on page 1, and CLEARED by any window change,
 *   since page 7 of the old window is meaningless in the new one (D34).
 * - `from` / `to` — `YYYY-MM-DD` local days in `DASHBOARD_TIMEZONE`, for an explicit custom range.
 *   When both are present they WIN over `preset`, which is then dropped from the link (D37).
 *   Introduced with the calendar; nothing reads them yet.
 *
 * Any value outside its declared set falls back to the default rather than reaching a query (D30).
 */
export const RANGE_PRESET_PARAM = "preset";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const SPLIT_TAB_PARAM = "tab";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const SESSION_SORT_PARAM = "sort";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const SESSION_PAGE_PARAM = "page";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const RANGE_FROM_PARAM = "from";

/** See `RANGE_PRESET_PARAM` for the full schema. */
export const RANGE_TO_PARAM = "to";

/** What a dashboard link changes relative to the URL it is built from. Every field is optional —
 * an omitted one keeps whatever the current URL says, so changing the tab never disturbs the
 * window and vice versa. */
export interface DashboardHrefChanges {
	preset?: RangePreset;
	tab?: SplitTab;
	/** An explicit window, as `YYYY-MM-DD` local days in `DASHBOARD_TIMEZONE`. */
	customRange?: DashboardCustomRange;
	/** How the session list is ordered. */
	sort?: SessionSort;
	/** 1-based session-list page. */
	page?: number;
}

/** The two ends of an explicitly picked window. */
export interface DashboardCustomRange {
	fromDay: string;
	toDay: string;
}

/**
 * The dashboard's link rules applied to any path. A drill-down pages through its OWN session list,
 * so its pager has to stay on its own URL — links built against the dashboard root would send page
 * 2 somewhere the page number means something else entirely.
 *
 * @param pathname - the path the link stays on
 * @param current - the parameters the page is being viewed with
 * @param changes - the parameters this link sets; omitted keys keep their current value
 */
export function pathHref(pathname: string, current: URLSearchParams, changes: DashboardHrefChanges): string {
	const next = new URLSearchParams(current);

	// A window comes from a preset OR from explicit dates, never both — writing one clears the
	// other. Leaving the old key behind would let a stale value keep describing the window, since
	// the parser resolves explicit dates ahead of any preset (D37).
	if (changes.preset !== undefined) {
		setOrClearDefault(next, RANGE_PRESET_PARAM, changes.preset, DEFAULT_RANGE_PRESET);
		next.delete(RANGE_FROM_PARAM);
		next.delete(RANGE_TO_PARAM);
	}
	if (changes.customRange !== undefined) {
		next.set(RANGE_FROM_PARAM, changes.customRange.fromDay);
		next.set(RANGE_TO_PARAM, changes.customRange.toDay);
		next.delete(RANGE_PRESET_PARAM);
	}
	if (changes.sort !== undefined) setOrClearDefault(next, SESSION_SORT_PARAM, changes.sort, DEFAULT_SESSION_SORT);
	// A window change OR a re-sort invalidates the page number: page 7 of one ordering is a
	// different set of sessions from page 7 of another, and landing past the end of a shorter list
	// reads as "no sessions" (D34).
	if (changes.preset !== undefined || changes.customRange !== undefined || changes.sort !== undefined) {
		next.delete(SESSION_PAGE_PARAM);
	}
	if (changes.page !== undefined) setOrClearDefault(next, SESSION_PAGE_PARAM, String(changes.page), String(FIRST_PAGE));
	if (changes.tab !== undefined) setOrClearDefault(next, SPLIT_TAB_PARAM, changes.tab, DEFAULT_SPLIT_TAB);

	const query = next.toString();
	return query === "" ? pathname : `${pathname}?${query}`;
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
	return pathHref(DASHBOARD_PATH, current, changes);
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

/** Pages are 1-based in the URL and omitted at the first one, so a default view has a clean link. */
export const FIRST_PAGE = 1;

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

/** Drill-down pages live under here; the split and the value are path segments, not parameters,
 * so each value has one canonical address rather than one per parameter ordering. */
const SPLIT_PATH = "/split";

/** The only parameters a drill-down link carries over. `tab` is dropped because the path already
 * names the split, and `sort`/`page` because the drill-down's own session list is a different list
 * — landing on page 7 of it is the D34 bug wearing a new hat. */
const WINDOW_PARAMS = [RANGE_PRESET_PARAM, RANGE_FROM_PARAM, RANGE_TO_PARAM];

/**
 * Builds the link from a cost-split totals row to that value's drill-down page.
 *
 * @param current - the parameters the dashboard is being viewed with
 * @param tab - which split the row was read from
 * @param value - the row's visible label
 */
export function splitValueHref(current: URLSearchParams, tab: SplitTab, value: string): string {
	const next = new URLSearchParams();
	for (const key of WINDOW_PARAMS) {
		const carried = current.get(key);
		if (carried !== null) next.set(key, carried);
	}

	const path = `${SPLIT_PATH}/${tab}/${encodeURIComponent(value)}`;
	const query = next.toString();
	return query === "" ? path : `${path}?${query}`;
}
