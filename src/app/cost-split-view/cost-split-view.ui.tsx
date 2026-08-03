"use client";

export interface UnpricedRangeNoticeProps {
	children: React.ReactNode;
}

/**
 * Displays the range-level unpriced-events statement above a cost split's chart (D5). Purely a
 * styling wrapper — the sentence itself is composed server-side in `cost-split-view.tsx` from
 * `summarizeUnpricedDays`, the single source both this notice and the totals table's
 * lower-bound wording read from.
 */
export function UnpricedRangeNotice({ children }: UnpricedRangeNoticeProps): React.JSX.Element {
	return <p className="text-xs text-muted-foreground">{children}</p>;
}
