import { expect, test } from "@playwright/test";

/**
 * `e2e-macbook` is seeded 13h stale, `e2e-studio` 1h fresh (`e2e/global-setup.ts`) — a real pair
 * to distinguish the flag on, rather than asserting against a tile with nothing to differ on.
 *
 * The stale/fresh split lives entirely in `global-setup.ts`'s seed, not in this file — no literal
 * hour count is asserted here, only the resulting flag text, per this suite's own convention of
 * literal EXPECTED VALUES without importing them from the fixture module.
 */
test("flags the machine that has gone silent 12h, and leaves the recently-active one clean", async ({ page }) => {
	await page.goto("/");

	// Scoped to the tile: both machine ids also appear in the split table and session list below,
	// so an unscoped lookup would match rows there too.
	const tile = page.getByText("Machine sync", { exact: true }).locator("..");

	const staleRow = tile.getByText("e2e-macbook", { exact: true }).locator("..");
	await expect(staleRow).toContainText("No activity in 12h");

	const freshRow = tile.getByText("e2e-studio", { exact: true }).locator("..");
	// A positive assertion, not just the negated one below (card #161 Batch A fix pass, Fix 6):
	// a row that stopped rendering entirely would still pass `not.toContainText`, so that
	// matcher alone can pass vacuously. Asserting the row actually shows a rendered timestamp
	// closes that gap.
	await expect(freshRow).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
	await expect(freshRow).not.toContainText("No activity in 12h");
});
