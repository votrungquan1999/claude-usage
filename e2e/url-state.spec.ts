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

test("two controls fired in quick succession both take effect, instead of the second erasing the first (card #161 D6/D8)", async ({
	page,
}) => {
	await page.goto("/");

	// Opening the combobox is setup, not part of the race: it does not itself write the URL.
	await page.getByRole("combobox", { name: "Date range" }).click();

	// Fired with NO await between them (unlike every other step in this file) — a second control's
	// handler must run before the first write's `useSearchParams()` snapshot catches up, which is
	// exactly the window that hid this bug: sequential, always-awaited clicks never land in it.
	await Promise.all([
		page.getByRole("option", { name: "Last 7 days" }).click(),
		page.getByRole("tab", { name: "Project", exact: true }).click(),
	]);

	// The auto-retrying assertion is the settling mechanism (D8): a real race drops one key, so one
	// of these two times out rather than both resolving instantly.
	await expect(page).toHaveURL(/[?&]preset=7d/);
	await expect(page).toHaveURL(/[?&]tab=project/);
});

test("three controls fired in quick succession all take effect, instead of one being silently dropped (card #161 R61)", async ({
	page,
}) => {
	await page.goto("/");

	// Each `Select` traps the rest of the page as inert while its own listbox is open (confirmed: a
	// second `Select`'s trigger click never recovers once the first wins the open-race, because the
	// SAME "Date range" trigger loses every retry indefinitely rather than eventually succeeding —
	// a UI mechanic unrelated to the writer bug this test targets). So only ONE combobox is
	// pre-opened as setup, exactly like the two-control test above; its own option click needs no
	// further opening and fires first. The other two writes — the tab, and the Sort combobox's own
	// open-then-select — race against it with no await between any of the three.
	await page.getByRole("combobox", { name: "Date range" }).click();

	await Promise.all([
		page.getByRole("option", { name: "Last 7 days" }).click(),
		page.getByRole("tab", { name: "Project", exact: true }).click(),
		page
			.getByRole("combobox", { name: "Sort sessions" })
			.click()
			.then(() => page.getByRole("option", { name: "Most recent" }).click()),
	]);

	// The auto-retrying assertion is the settling mechanism (D8): a real race drops one key, so one
	// of these three times out rather than all three resolving.
	await expect(page).toHaveURL(/[?&]preset=7d/);
	await expect(page).toHaveURL(/[?&]tab=project/);
	await expect(page).toHaveURL(/[?&]sort=recent/);
});
