"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { pathHref } from "../href";
import { useUrlWriter } from "../url-navigation.state";
import type { SessionSort } from "./session-list.type";

export interface SessionPageNavigation {
	/** Moves to a 1-based page. */
	goToPage: (page: number) => void;
	/** Re-orders the list. The page number is cleared by `dashboardHref`, since page 7 of one
	 * ordering is a different set of sessions from page 7 of another. */
	selectSort: (sort: string) => void;
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
	const { write } = useUrlWriter();
	// Read rather than hardcoded: this same pager runs on the dashboard AND on a drill-down page,
	// which pages through its own list and must stay on its own URL.
	const pathname = usePathname();
	const [isPending, startTransition] = useTransition();

	function goToPage(page: number): void {
		startTransition(() => {
			router.replace(
				write((base) => pathHref(pathname, base, { page })),
				{ scroll: false },
			);
		});
	}

	function selectSort(sort: string): void {
		startTransition(() => {
			router.replace(
				write((base) => pathHref(pathname, base, { sort: sort as SessionSort })),
				{ scroll: false },
			);
		});
	}

	function hrefForPage(page: number): string {
		return pathHref(pathname, searchParams, { page });
	}

	return { goToPage, selectSort, hrefForPage, isPending };
}
