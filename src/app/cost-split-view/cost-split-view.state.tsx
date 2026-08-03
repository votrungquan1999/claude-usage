"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { dashboardHref } from "../href";
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
	const searchParams = useSearchParams();
	const [, startTransition] = useTransition();

	function selectTab(tab: SplitTab): void {
		startTransition(() => {
			router.replace(dashboardHref(searchParams, { tab }), { scroll: false });
		});
	}

	return { selectTab };
}
