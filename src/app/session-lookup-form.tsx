"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { sessionHref } from "./href";

/**
 * Free-text jump to a session's drill-down page (Step 21). No session list view exists yet, so
 * this is the only way in besides a direct URL.
 */
export function SessionLookupForm(): React.JSX.Element {
	const router = useRouter();
	const [sessionId, setSessionId] = useState("");
	const inputId = useId();

	function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const trimmed = sessionId.trim();
		if (!trimmed) return;
		router.push(sessionHref(trimmed));
	}

	return (
		<form onSubmit={handleSubmit} className="grid grid-cols-[1fr_auto] items-end gap-2">
			<div className="grid gap-2">
				<Label htmlFor={inputId}>Session id</Label>
				<Input id={inputId} value={sessionId} onChange={(event) => setSessionId(event.target.value)} required />
			</div>
			<Button type="submit">Open</Button>
		</form>
	);
}
