import { expect, test } from "@playwright/test";

/**
 * Proves the seeded corpus reaches the browser intact, by asserting figures that can only be
 * right if the whole path worked — seed, query, timezone bucketing, and formatting.
 *
 * The numbers are literals, not derived from the fixture module. Deriving them would make the
 * test agree with the fixture by construction and stop it noticing when a change to either one
 * quietly moves the arithmetic.
 */
test("the seeded corpus renders its exact per-machine totals", async ({ page }) => {
	await page.goto("/");

	// Scoped to the open tab panel, because machine names also appear in the session list below —
	// an unscoped row lookup matches both tables. `tabpanel` is a real ARIA role, so this needs no
	// test-only attribute.
	const splitPanel = page.getByRole("tabpanel");

	// Machine is the default split. Even-numbered sessions bill to the studio machine ($0.25 × sum
	// of 2…30 = $60.00), odd ones to the macbook machine ($0.25 × sum of 1…29 = $56.25). Together
	// they are the whole $116.25 corpus, so both being right means nothing was dropped or
	// double-counted. Ids are stored as 64-char hex (card #170 Step 1) but shown as the short
	// display id (card #170 Step 4), which is what the row's own text now carries.
	const studioRow = splitPanel.getByRole("row").filter({ hasText: "a1f909db" });
	await expect(studioRow).toContainText("$60.00");
	// toContainText, not toHaveText, above would be vacuous — scoped to the last cell (Events, per
	// dimension-totals-table.ui.tsx's column order) so a coincidental digit match elsewhere in the
	// row can't pass this vacuously.
	await expect(studioRow.getByRole("cell").last()).toHaveText("15");

	const macbookRow = splitPanel.getByRole("row").filter({ hasText: "0ddfda8e" });
	await expect(macbookRow).toContainText("$56.25");
});
