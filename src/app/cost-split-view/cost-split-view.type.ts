/** A shown dimension value's resolved chart colour (D21) — one `var(--chart-N)` custom property
 * per value, keyed by the value itself. Shared between `CostChart` (bar fill) and
 * `DimensionTotalsTable` (swatch column) so a name and its bar always agree on colour. */
export interface SeriesColorMap {
	[dimensionValue: string]: string;
}

/** Which cost split the operator is looking at. D30 — this is a CLOSED allowlist, not an open
 * string: the tab selects a `CostSplitDimension`, which `costPerDay` interpolates straight into
 * the aggregation as a field name, so an unrecognised `?tab=` value must never reach a query. */
export enum SplitTab {
	Machine = "machine",
	Project = "project",
	Model = "model",
	Repo = "repo",
}

/** The split shown when the URL names no tab. Omitted from generated links (`dashboardHref`). */
export const DEFAULT_SPLIT_TAB = SplitTab.Machine;
