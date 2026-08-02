"use client";

import { Button } from "@/components/ui/button";

/**
 * Clears the session cookie and forces a full page load to `/login`, so no stale client-side
 * dashboard data lingers after the operator asks to leave. The cookie is the entire session, so
 * clearing it server-side (via `/api/auth`) is the entire sign-out.
 */
export function SignOutButton(): React.JSX.Element {
	async function handleSignOut(): Promise<void> {
		await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "logout" }),
		});
		window.location.href = "/login";
	}

	return (
		<Button variant="outline" onClick={handleSignOut}>
			Sign out
		</Button>
	);
}
