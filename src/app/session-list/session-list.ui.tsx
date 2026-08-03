"use client";

import type { ReactNode } from "react";

import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

import { useSessionPageNavigation } from "./session-list.state";

/**
 * Stacks the session table above its pager.
 */
export function SessionListLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className={cn("gap-4", "grid")}>{children}</div>;
}

/**
 * A session's cost, with its whole-session total underneath when the two differ (D32).
 */
export function SessionCostCell({ children }: { children: ReactNode }): React.JSX.Element {
	return <div className={cn("gap-0.5", "grid")}>{children}</div>;
}

/**
 * The qualifier under a session's in-window cost — what the whole session cost, when it started
 * before the window or ran past it.
 */
export function SessionCostNote({ children }: { children: ReactNode }): React.JSX.Element {
	return <span className="text-xs text-muted-foreground">{children}</span>;
}

/**
 * The link into a session's drill-down.
 */
export function SessionLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
	return (
		<a href={href} className="font-medium text-foreground underline-offset-4 hover:underline">
			{children}
		</a>
	);
}

export interface SessionPagerProps {
	/** 1-based. */
	currentPage: number;
	pageCount: number;
}

/**
 * Moves between pages of sessions. Each control is a real link AND a client-side transition: the
 * `href` keeps the page shareable, the handler keeps turning a page from reloading the dashboard.
 */
export function SessionPager({ currentPage, pageCount }: SessionPagerProps): React.JSX.Element {
	const { goToPage, hrefForPage } = useSessionPageNavigation();

	function handleClick(event: React.MouseEvent, page: number): void {
		// Leave modified clicks alone so "open in new tab" still works.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		goToPage(page);
	}

	const previousPage = Math.max(1, currentPage - 1);
	const nextPage = Math.min(pageCount, currentPage + 1);

	return (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href={hrefForPage(previousPage)}
						aria-disabled={currentPage === 1}
						onClick={(event) => handleClick(event, previousPage)}
					/>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href={hrefForPage(currentPage)} isActive size="default">
						{`${currentPage} / ${pageCount}`}
					</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext
						href={hrefForPage(nextPage)}
						aria-disabled={currentPage === pageCount}
						onClick={(event) => handleClick(event, nextPage)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
