"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { dashboardHref, splitValueHref } from "../href";
import { useUrlWriter } from "../url-navigation.state";
import type { SplitTab } from "./cost-split-view.type";

export interface SplitTabNavigation {
	/** Records the newly shown split in the URL. */
	selectTab: (tab: SplitTab) => void;
}

/**
 * Records which split is on screen in the URL, so a view can be shared or bookmarked (D8).
 *
 * Written from the change handler, never mirrored out of a `useEffect`. All three splits are
 * already rendered, so the tab itself switches from local state the instant it is clicked — this
 * only updates the address bar, which is why the navigation runs inside a transition: the URL
 * catching up must never make the operator wait for a tab they are already looking at.
 */
export function useSplitTabNavigation(): SplitTabNavigation {
	const router = useRouter();
	const { write } = useUrlWriter();
	const [, startTransition] = useTransition();

	function selectTab(tab: SplitTab): void {
		startTransition(() => {
			router.replace(
				write((base) => dashboardHref(base, { tab })),
				{ scroll: false },
			);
		});
	}

	return { selectTab };
}

export interface SplitValueLinks {
	/** A dimension value's drill-down URL. Built here rather than passed in: a function cannot
	 * cross the server/client boundary as a prop, and the window it carries lives in the URL. */
	hrefForValue: (value: string) => string;
}

/**
 * Links each totals row to its drill-down page, carrying the window currently on screen — the row
 * reports a WINDOW figure, so a page showing other days would contradict the number clicked.
 *
 * @param tab - which split the rows were read from
 */
export function useSplitValueLinks(tab: SplitTab): SplitValueLinks {
	const searchParams = useSearchParams();

	return { hrefForValue: (value: string) => splitValueHref(searchParams, tab, value) };
}
