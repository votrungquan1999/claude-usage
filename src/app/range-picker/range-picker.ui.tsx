"use client";

import type { ReactNode } from "react";

import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

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
			<SelectTrigger className="w-44">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>{children}</SelectContent>
		</Select>
	);
}
