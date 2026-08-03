"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { dashboardHref } from "../href";

export interface SessionPageNavigation {
	/** Moves to a 1-based page. */
	goToPage: (page: number) => void;
	/** A page's real URL, so the pager renders links rather than bare buttons. Built here rather
	 * than passed in: a function cannot cross the server/client boundary as a prop. */
	hrefForPage: (page: number) => string;
	/** True while the new page is loading, so the pager can show it is working. */
	isPending: boolean;
}

/**
 * Moves through the session list by rewriting the URL, so a page is shareable like everything
 * else on this dashboard (D34). The pager still renders real `href`s — this only upgrades the
 * click to a client-side transition, so a page turn does not reload the whole page.
 */
export function useSessionPageNavigation(): SessionPageNavigation {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();

	function goToPage(page: number): void {
		startTransition(() => {
			router.replace(dashboardHref(searchParams, { page }), { scroll: false });
		});
	}

	function hrefForPage(page: number): string {
		return dashboardHref(searchParams, { page });
	}

	return { goToPage, hrefForPage, isPending };
}
