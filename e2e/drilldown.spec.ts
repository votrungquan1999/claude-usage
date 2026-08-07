import { expect, test } from "@playwright/test";

test("a totals row links to that value's drill-down, carrying the window that was on screen", async ({ page }) => {
	await page.goto("/?tab=project&preset=90d");

	// The window rides along because the row's figure is a WINDOW figure — landing on a page
	// showing different days would contradict the number that was clicked.
	const link = page.getByRole("tabpanel").getByRole("link", { name: "personal/lms" });
	await expect(link).toHaveAttribute("href", "/split/project/personal%2Flms?preset=90d");
});

test("clicking a project row opens its drill-down, and the page agrees with the row clicked", async ({ page }) => {
	await page.goto("/?tab=project");

	// Sessions round-robin across three projects, so personal/lms takes 3,6,…,30 — $41.25 over 10.
	const row = page.getByRole("tabpanel").getByRole("row").filter({ hasText: "personal/lms" });
	await expect(row).toContainText("$41.25");
	await row.getByRole("link", { name: "personal/lms" }).click();

	await expect(page).toHaveURL(/\/split\/project\/personal%2Flms/);
	await expect(page.getByRole("heading", { name: "personal/lms" })).toBeVisible();

	// The same figure, on the page it opened — a drill-down that disagrees with the row that
	// opened it is worse than no drill-down.
	await expect(page.getByText("$41.25")).toBeVisible();
	await expect(page.getByText("10 sessions")).toBeVisible();
});

test("drilling into the unattributed bucket lists the sessions with no repository", async ({ page }) => {
	await page.goto("/?tab=repo");

	await page.getByRole("tabpanel").getByRole("link", { name: "(unattributed)" }).click();

	// Two of the three fixture projects carry no repoKey: $38.75 + $41.25 = $80.00 over 20 sessions.
	await expect(page.getByRole("heading", { name: "(unattributed)" })).toBeVisible();
	await expect(page.getByText("$80.00")).toBeVisible();
	await expect(page.getByText("20 sessions")).toBeVisible();
	// The hash is an unsalted SHA-256 of a git remote — it must not reach the browser even here,
	// where the whole page is about one repository.
	await expect(page.getByText(/[0-9a-f]{64}/)).toHaveCount(0);
});

test("a value nothing matches reads as an empty range rather than an error", async ({ page }) => {
	const response = await page.goto("/split/project/never-worked-on-this");

	expect(response?.status()).toBe(200);
	await expect(page.getByText("No data in this range")).toBeVisible();
});

test("a split the dashboard does not offer is refused rather than guessed at", async ({ page }) => {
	// The segment picks the field an aggregation groups by, so an unknown one must not reach a query.
	const response = await page.goto("/split/accountUuid/someone");

	expect(response?.status()).toBe(404);
});
