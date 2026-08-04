"use client";

import { type ReactNode, useState } from "react";
// Type-only, from the package root — NEVER `react-day-picker/locale`, which pulls the full
// 98-locale date-fns barrel (~130 KB gzip, about 7x this whole control).
import type { DateRange as CalendarRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

import { dayKeyInTimezone } from "../dashboard-format";

export interface RangePresetFieldProps {
	/** The window currently on screen, as parsed from the URL. */
	value: string;
	/** Preset value to label, so the closed trigger can name the current window. */
	items: Record<string, string>;
	onSelect: (preset: string) => void;
	/** The `<SelectItem>` list, composed on the server so the option copy stays there. */
	children: ReactNode;
}

/**
 * The window selector. Purely a display component: it holds no state of its own and takes its
 * handler from the shell, which owns the navigation transition — so selecting a window dims the
 * whole page rather than just this control.
 */
export function RangePresetField({ value, items, onSelect, children }: RangePresetFieldProps): React.JSX.Element {
	return (
		<Select items={items} value={value} onValueChange={(next: unknown) => onSelect(String(next))}>
			{/* Named, because the trigger's only text is the current value: unlabelled it announces
			    as "combobox, Last 30 days", which says what is chosen but never what it chooses. */}
			<SelectTrigger className="w-44" aria-label="Date range">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>{children}</SelectContent>
		</Select>
	);
}

export interface RangeCalendarFieldProps {
	/** The window stated in words, composed on the server — this control's trigger copy. */
	label: string;
	/** The window's own bounds, and the days it may offer, all `YYYY-MM-DD`. */
	fromDay: string;
	toDay: string;
	earliestDay: string;
	latestDay: string;
	/** The zone the calendar reads clicks in. Without it a click is interpreted in the browser's
	 * own zone, which is a silent off-by-one day for anyone outside `DASHBOARD_TIMEZONE`. */
	timeZone: string;
	onSelectRange: (fromDay: string, toDay: string) => void;
}

/**
 * Picks an arbitrary start and end day. The in-progress selection is local state on purpose: a
 * two-click gesture is half-made after the first click, and a half-made range is not a window —
 * writing it to the URL would navigate somewhere nobody asked to go. D7 governs the COMMITTED
 * window, not the gesture that produces it.
 *
 * Its parent keys this component on the committed window, so a preset selected elsewhere resets
 * the draft by remounting rather than by mirroring props into state.
 */
export function RangeCalendarField({
	label,
	fromDay,
	toDay,
	earliestDay,
	latestDay,
	timeZone,
	onSelectRange,
}: RangeCalendarFieldProps): React.JSX.Element {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<CalendarRange | undefined>({ from: dayAnchor(fromDay), to: dayAnchor(toDay) });

	function handleSelect(next: CalendarRange | undefined): void {
		setDraft(next);
		if (next?.from === undefined || next.to === undefined) return;

		setOpen(false);
		onSelectRange(dayKeyInTimezone(next.from, timeZone), dayKeyInTimezone(next.to, timeZone));
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger render={<Button variant="outline" />}>{label}</PopoverTrigger>
			{/* PopoverContent hardcodes w-72, which clips a two-month grid. */}
			<PopoverContent className="w-auto p-0">
				<Calendar
					mode="range"
					numberOfMonths={2}
					timeZone={timeZone}
					selected={draft}
					onSelect={handleSelect}
					defaultMonth={dayAnchor(toDay)}
					disabled={{ before: dayAnchor(earliestDay), after: dayAnchor(latestDay) }}
					autoFocus
				/>
			</PopoverContent>
		</Popover>
	);
}

/**
 * An instant safely inside a `YYYY-MM-DD` local day, for a calendar that will re-read it in its
 * own timezone. Noon UTC lands on the intended date for every offset between -12 and +12.
 *
 * @param day - `YYYY-MM-DD`
 */
function dayAnchor(day: string): Date {
	return new Date(`${day}T12:00:00.000Z`);
}
