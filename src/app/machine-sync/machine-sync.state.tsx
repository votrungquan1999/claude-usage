"use client";

import { useRouter } from "next/navigation";
import { useReducer } from "react";

interface MachineRenameState {
	isEditing: boolean;
	value: string;
	submitting: boolean;
	error: string | null;
}

type MachineRenameAction =
	| { type: "START_EDIT"; value: string }
	| { type: "CANCEL_EDIT" }
	| { type: "SET_VALUE"; value: string }
	| { type: "SUBMIT_START" }
	| { type: "SUBMIT_SUCCESS" }
	| { type: "SUBMIT_ERROR"; error: string };

function machineRenameReducer(state: MachineRenameState, action: MachineRenameAction): MachineRenameState {
	switch (action.type) {
		case "START_EDIT":
			return { isEditing: true, value: action.value, submitting: false, error: null };
		case "CANCEL_EDIT":
			return { ...state, isEditing: false, error: null };
		case "SET_VALUE":
			return { ...state, value: action.value };
		case "SUBMIT_START":
			return { ...state, submitting: true, error: null };
		case "SUBMIT_SUCCESS":
			return { ...state, isEditing: false, submitting: false, error: null };
		case "SUBMIT_ERROR":
			// D22 — a failed save keeps whatever the operator typed; only `submitting` and `error` change.
			return { ...state, submitting: false, error: action.error };
		default:
			return state;
	}
}

export interface MachineRename {
	isEditing: boolean;
	value: string;
	submitting: boolean;
	error: string | null;
	startEdit: () => void;
	cancelEdit: () => void;
	setValue: (value: string) => void;
	save: () => void;
}

/**
 * Edits one machine's display name through `POST /api/machines` (Step 9's already-authorised
 * route). A save that succeeds calls `router.refresh()` (D11) so every card reading
 * `loadMachineSyncStatus` — the sync tile, the session list, the split totals table and the chart
 * legend — re-renders with the new name on the same request, without a full page load.
 *
 * @param machineId - the machine being renamed
 * @param initialName - its current stored name, or `null` — what an edit starts pre-filled with
 */
export function useMachineRename(machineId: string, initialName: string | null): MachineRename {
	const router = useRouter();
	const [state, dispatch] = useReducer(machineRenameReducer, {
		isEditing: false,
		value: initialName ?? "",
		submitting: false,
		error: null,
	});

	function startEdit(): void {
		dispatch({ type: "START_EDIT", value: initialName ?? "" });
	}

	function cancelEdit(): void {
		dispatch({ type: "CANCEL_EDIT" });
	}

	function setValue(value: string): void {
		dispatch({ type: "SET_VALUE", value });
	}

	async function save(): Promise<void> {
		dispatch({ type: "SUBMIT_START" });

		let response: Response;
		try {
			response = await fetch("/api/machines", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ machineId, name: state.value }),
			});
		} catch {
			dispatch({ type: "SUBMIT_ERROR", error: "Could not reach the server. Try again." });
			return;
		}

		if (!response.ok) {
			// D22 — `/api` sits outside the proxy's matcher, so an expired session surfaces here as a
			// bare 401, not the usual `/login?next=` redirect.
			const message =
				response.status === 401 ? "Your session expired — sign in again to save." : "Could not save the name. Try again.";
			dispatch({ type: "SUBMIT_ERROR", error: message });
			return;
		}

		dispatch({ type: "SUBMIT_SUCCESS" });
		router.refresh();
	}

	return { ...state, startEdit, cancelEdit, setValue, save };
}
