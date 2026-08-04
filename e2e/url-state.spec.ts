import { expect, test } from "@playwright/test";

test("the whole view survives a reload, because the URL is the only place it lives", async ({ page }) => {
	await page.goto("/");

	// Three independent pieces of view state, each set through its own control.
	await page.getByRole("combobox", { name: "Date range" }).click();
	await page.getByRole("option", { name: "Last 7 days" }).click();
	await expect(page).toHaveURL(/[?&]preset=7d/);

	await page.getByRole("tab", { name: "Project", exact: true }).click();
	// Each control must ADD its key while preserving the others; a control that rebuilds the query
	// from scratch would silently discard whatever the operator set before it.
	await expect(page).toHaveURL(/[?&]preset=7d/);
	await expect(page).toHaveURL(/[?&]tab=project/);

	await page.getByRole("combobox", { name: "Sort sessions" }).click();
	await page.getByRole("option", { name: "Most recent" }).click();
	await expect(page).toHaveURL(/[?&]preset=7d/);
	await expect(page).toHaveURL(/[?&]tab=project/);
	await expect(page).toHaveURL(/[?&]sort=recent/);

	const urlBeforeReload = page.url();
	await page.reload();

	// A reload is the honest test. State kept in React would look identical until this point and
	// vanish here; state mirrored into the URL by an effect would race and sometimes survive.
	expect(page.url()).toBe(urlBeforeReload);
	await expect(page.getByRole("combobox", { name: "Date range" })).toContainText("Last 7 days");
	await expect(page.getByRole("tab", { name: "Project", exact: true })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("combobox", { name: "Sort sessions" })).toContainText("Most recent");

	// And the data agrees with the restored controls, rather than the controls merely looking right:
	// over 7 days, personal/lms keeps sessions 3, 6, 12, 15, 21, 24 and 27 — $27.00 across 7 events.
	const lmsRow = page.getByRole("tabpanel").getByRole("row").filter({ hasText: "personal/lms" });
	await expect(lmsRow).toContainText("$27.00");
	await expect(lmsRow).toContainText("7");
});
