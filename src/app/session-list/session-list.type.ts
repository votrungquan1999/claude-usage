/** How the session list is ordered. Values are the literal `?sort=` strings — a closed allowlist,
 * so a URL can never order the list by a field the app does not offer.
 *
 * Deliberately separate from the server's own `SessionSortOrder`, mirroring how `SplitTab` is
 * separate from `CostSplitDimension`: the URL vocabulary and the query vocabulary are mapped at one
 * visible place rather than a URL value reaching an aggregation directly. */
export enum SessionSort {
	Cost = "cost",
	Recent = "recent",
	Events = "events",
}

/** The order used when the URL names none. Omitted from generated links (`dashboardHref`). */
export const DEFAULT_SESSION_SORT = SessionSort.Cost;
