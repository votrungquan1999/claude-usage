"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { dashboardHref } from "../href";
import { useUrlWriter } from "../url-navigation.state";
import type { RangePreset } from "./range-picker.type";

export interface RangeNavigation {
	/** Selects a window. Safe to call with the value already selected — the URL simply does not change. */
	selectPreset: (preset: RangePreset) => void;
	/** Selects an explicit window from two `YYYY-MM-DD` local days. */
	selectCustomRange: (fromDay: string, toDay: string) => void;
	/** True while the new window is being fetched, so the caller can hold and dim the current view. */
	isPending: boolean;
}

/**
 * Moves the dashboard to a different window by rewriting the URL, which is the sole source of
 * view state (D7). Written from the change handler — never mirrored out of a `useEffect`.
 *
 * The navigation runs inside a transition (D33): React then holds the whole current page until
 * the new one is fully ready, instead of letting each card repaint as its own query returns and
 * briefly showing a headline, a chart and a table that describe three different periods.
 *
 * Called ONCE, by the shell, which needs `isPending` to dim everything below the filter row — two
 * separate `useTransition` calls would not share a pending flag.
 */
export function useRangeNavigation(): RangeNavigation {
	const router = useRouter();
	const { write } = useUrlWriter();
	const [isPending, startTransition] = useTransition();

	function selectPreset(preset: RangePreset): void {
		startTransition(() => {
			router.replace(
				write((base) => dashboardHref(base, { preset })),
				{ scroll: false },
			);
		});
	}

	function selectCustomRange(fromDay: string, toDay: string): void {
		startTransition(() => {
			router.replace(
				write((base) => dashboardHref(base, { customRange: { fromDay, toDay } })),
				{ scroll: false },
			);
		});
	}

	return { selectPreset, selectCustomRange, isPending };
}
