import { CostSplitDimension } from "@/server/usage-queries";

import { SplitTab } from "../cost-split-view/cost-split-view.type";

/** One drill-down route: which split it is, in all three vocabularies the app keeps separate —
 * the URL's, the query's, and the operator's. */
export interface SplitDimensionRoute {
	/** The URL segment, and the dashboard tab to return to. */
	tab: SplitTab;
	/** The stored field the aggregation groups by. */
	dimension: CostSplitDimension;
	/** What the split is called on screen. */
	label: string;
}

/** Every split the dashboard offers, keyed by URL segment. A `Map` rather than an object literal
 * on purpose: an object lookup answers `constructor` and `toString` with Object.prototype's own
 * members, which would turn a nonsense URL into a route. */
const SPLIT_ROUTES = new Map<string, SplitDimensionRoute>([
	[SplitTab.Machine, { tab: SplitTab.Machine, dimension: CostSplitDimension.Machine, label: "Machine" }],
	[SplitTab.Project, { tab: SplitTab.Project, dimension: CostSplitDimension.Project, label: "Project" }],
	[SplitTab.Model, { tab: SplitTab.Model, dimension: CostSplitDimension.Model, label: "Model" }],
	[SplitTab.Repo, { tab: SplitTab.Repo, dimension: CostSplitDimension.Repo, label: "Repository" }],
]);

/**
 * Resolves a URL path segment to the split it names.
 *
 * A closed allowlist, and that is a security boundary rather than tidiness: the dimension is
 * interpolated into the aggregation as a field name, so an unrecognised segment must never reach a
 * query. Undefined is the caller's cue to 404 — unlike `?tab=`, which falls back, a path segment
 * names a resource and a wrong one has no sensible substitute.
 *
 * @param segment - the raw `[dimension]` segment from the URL
 */
export function parseSplitDimension(segment: string): SplitDimensionRoute | undefined {
	return SPLIT_ROUTES.get(segment);
}

/**
 * The label a `[value]` segment names. Next hands dynamic segments over STILL ENCODED, so a
 * project slug arrives with its slash escaped and has to be decoded before it can be matched
 * against a stored value.
 *
 * Undefined when the segment is not a valid escape sequence — `decodeURIComponent` throws on one,
 * and an unparseable URL deserves the same 404 an unknown split gets, not a 500.
 *
 * @param segment - the raw `[value]` segment from the URL
 */
export function decodeSplitValue(segment: string): string | undefined {
	// An error boundary, not defensive wrapping: this is where an attacker-supplied URL becomes an
	// application value, and `decodeURIComponent` is the one call that can reject it.
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}
