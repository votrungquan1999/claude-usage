import { expect, test } from "@playwright/test";

test("choosing a shorter window narrows the figures and records itself in the URL", async ({ page }) => {
	await page.goto("/");

	const splitPanel = page.getByRole("tabpanel");
	// The row's link text is the short display id (card #170 Step 4), not the full 64-char hash.
	const studioRow = splitPanel.getByRole("row").filter({ hasText: "a1f909db" });

	// The 30-day default covers the whole 10-day corpus.
	await expect(studioRow).toContainText("$60.00");

	await page.getByRole("combobox", { name: "Date range" }).click();
	await page.getByRole("option", { name: "Last 7 days" }).click();

	// The URL is the single source of view state, so a window change must be visible there — that
	// is what makes the view shareable rather than a local preference.
	await expect(page).toHaveURL(/[?&]preset=7d/);

	// Only days 0-6 remain: the studio machine keeps sessions 2,4,6,12,14,16,22,24,26 — 9 events
	// summing to $31.50. Asserting the NEW figure rather than merely "something changed" is what
	// proves the cards re-read the window instead of re-rendering the same rows.
	await expect(studioRow).toContainText("$31.50");
	// toContainText, not toHaveText, would be vacuous — the studio machine id itself contains "9"
	// several times over, so this would pass regardless of the re-counted total. Scoped to the last
	// cell (Events, per dimension-totals-table.ui.tsx's column order) so it can only pass on the
	// real re-counted figure.
	await expect(studioRow.getByRole("cell").last()).toHaveText("9");
});
