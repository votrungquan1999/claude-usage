import { expect, test } from "@playwright/test";

test("an authenticated operator reaches the dashboard instead of the login gate", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "Claude Usage" })).toBeVisible();
	// The proxy redirects an unauthenticated request to /login, so staying on / is the assertion:
	// it proves the cached session was actually accepted, not merely that a page rendered.
	expect(new URL(page.url()).pathname).toBe("/");
});

test("every card renders its own content, none falling back to an error boundary", async ({ page }) => {
	await page.goto("/");

	for (const title of [
		"Cost per day",
		"Subagent share of cost",
		"What caching saved",
		"Model mix over time",
		"Sessions in this range",
		"Open a session by id",
	]) {
		await expect(page.getByText(title, { exact: true })).toBeVisible();
	}

	// Each card carries its own CardErrorBoundary, so one failed query degrades a single card
	// instead of the page. That also means a broken card is easy to miss by eye — the whole
	// dashboard still looks fine. Asserting the fallback copy is absent is what catches it.
	await expect(page.getByText("This card could not be loaded")).toHaveCount(0);
	await expect(page.getByText("Headline figures could not be loaded")).toHaveCount(0);
});
