/** A shown dimension value's resolved chart colour (D21) — one `var(--chart-N)` custom property
 * per value, keyed by the value itself. Shared between `CostChart` (bar fill) and
 * `DimensionTotalsTable` (swatch column) so a name and its bar always agree on colour. */
export interface SeriesColorMap {
	[dimensionValue: string]: string;
}
