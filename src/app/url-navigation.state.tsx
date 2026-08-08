"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export interface UrlWriter {
	/**
	 * Builds and records a link in one step. `buildHref` receives the params to build FROM — this
	 * writer's own last write, if there was one this page life, rather than this hook's own
	 * `useSearchParams()` snapshot — so a second control's write, even one fired before the first
	 * write's navigation commits, still builds on top of it instead of the same stale snapshot both
	 * controls would otherwise read (card #161 D6).
	 */
	write: (buildHref: (base: URLSearchParams) => string) => string;
}

/**
 * Bookkeeping only — the URL itself is still the one source of dashboard view state (`href.ts`'s
 * own D7 comment). Module-scoped rather than a `useRef`: the three writers below are three
 * separate hook instances, sometimes on different pages (the dashboard root and a drill-down
 * page), and there is exactly one browser URL for them to coordinate around.
 */
let lastWritten: URLSearchParams | null = null;

/**
 * The dashboard's one shared URL writer (card #161 D6). `useRangeNavigation`, `useSplitTabNavigation`
 * and `useSessionPageNavigation` all call this instead of building `URLSearchParams` from their own
 * `useSearchParams()` directly — that snapshot is bound to the render that created the handler
 * closure and goes stale the instant a write is in flight, since `useSearchParams()` only updates
 * after the resulting navigation actually commits. A second control's handler firing in that window
 * (no `await` between two clicks) would otherwise read the same pre-first-write snapshot and
 * silently drop whatever the first write just set.
 *
 * `href.ts` needs no changes for this: every writer already routes through `pathHref`/`dashboardHref`,
 * which copy their `current` argument rather than mutating it — this hook's only job is supplying a
 * non-stale `current`.
 */
export function useUrlWriter(): UrlWriter {
	const searchParams = useSearchParams();
	// True once THIS instance's own effect below has run at least once. Three separate components
	// mount this hook, and they do not all mount in the same commit — the session list (further down
	// the page, behind its own data fetch) can still be mounting after the range picker and split
	// tabs are already interactive. Without this guard, that late FIRST run reads as "the URL changed
	// externally, adopt it" and stomps whatever an earlier control's `write()` had already recorded
	// in the same race window (card #161 R61) — even though nothing external happened at all.
	const hasMountedOwnEffect = useRef(false);

	// Reconciles the bookkeeping to the real committed URL whenever it moved without this module's
	// own writes — back/forward, or arriving via a plain link. Keyed on `searchParams`, which only
	// changes identity on an actual commit, so this can never run mid-race from a re-render alone —
	// only a genuine navigation moves it. The one exception is this hook's OWN mount: React always
	// runs a fresh effect once on mount regardless of whether anything "changed", and for a
	// late-mounting instance that first run's `searchParams` closure can already be behind another
	// writer's synchronous, in-flight `lastWritten` update. Adopting it unconditionally would erase
	// that write, so a first mount only initializes the bookkeeping when nothing has touched it yet
	// (`lastWritten === null`, e.g. a fresh page load before any control has run); it never overwrites
	// a value some other writer already established. Every run after this instance's own mount is a
	// genuine subsequent commit and reconciles as before.
	useEffect(() => {
		if (!hasMountedOwnEffect.current) {
			hasMountedOwnEffect.current = true;
			if (lastWritten === null) lastWritten = new URLSearchParams(searchParams);
			return;
		}
		lastWritten = new URLSearchParams(searchParams);
	}, [searchParams]);

	function write(buildHref: (base: URLSearchParams) => string): string {
		const base = new URLSearchParams(lastWritten ?? searchParams);
		const href = buildHref(base);

		const queryStart = href.indexOf("?");
		lastWritten = new URLSearchParams(queryStart === -1 ? "" : href.slice(queryStart + 1));

		return href;
	}

	return { write };
}
