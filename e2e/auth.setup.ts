import { expect, test as setup } from "@playwright/test";

import { E2E_DB_NAME, E2E_SECRET, E2E_STORAGE_STATE } from "./e2e.env";

/** The one database this machine must never be written to — it holds the only copy of the backfill. */
const PRODUCTION_DB_NAME = "claude-usage";

setup("sign in and cache the session", async ({ page }) => {
	// Fail the whole run rather than risk a write to the real corpus. Cheap, and the consequence
	// of getting it wrong is unrecoverable.
	expect(E2E_DB_NAME, "e2e must never point at the real backfill database").not.toBe(PRODUCTION_DB_NAME);

	await page.goto("/login");

	// Driven through the UI rather than POSTed to /api/auth: signing in is itself a user journey,
	// and doing it here covers the form for free on every run.
	//
	// Retried because the field is server-rendered before React attaches: a fill that lands first
	// is wiped when hydration resets the input to its (empty) state, leaving the submit button
	// disabled forever. Re-filling until the button enables is the signal that React is listening.
	const submitButton = page.getByRole("button", { name: "Sign in" });
	await expect(async () => {
		await page.getByLabel("Shared secret").fill(E2E_SECRET);
		await expect(submitButton).toBeEnabled({ timeout: 1_000 });
	}).toPass({ timeout: 30_000 });

	await submitButton.click();

	// The form does a full page load on success, so this also proves the session cookie survived
	// into the request the proxy evaluated — the whole point of not using router.push there.
	await expect(page.getByRole("heading", { level: 1, name: "Claude Usage" })).toBeVisible();

	await page.context().storageState({ path: E2E_STORAGE_STATE });
});
