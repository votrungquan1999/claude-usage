"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Posts the operator's shared secret to `/api/auth`. On success, forces a full page load so
 * the httpOnly session cookie the browser just received is present on the request the proxy
 * evaluates — a client-side transition (`router.push`) cannot guarantee that.
 */
export function LoginForm(): React.JSX.Element {
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const secretId = useId();

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setSubmitting(true);
		setError(null);
		const response = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ secret }),
		});
		setSubmitting(false);
		if (response.ok) {
			window.location.href = "/";
			return;
		}
		setError("Incorrect secret. Please try again.");
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground"
		>
			<div className="grid gap-2">
				<Label htmlFor={secretId}>Shared secret</Label>
				<Input
					id={secretId}
					type="password"
					value={secret}
					onChange={(event) => setSecret(event.target.value)}
					autoComplete="current-password"
					required
				/>
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
			<Button type="submit" disabled={submitting || !secret}>
				{submitting ? "Signing in…" : "Sign in"}
			</Button>
		</form>
	);
}
