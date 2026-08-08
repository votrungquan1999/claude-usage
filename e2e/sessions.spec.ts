import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The session list, scoped by a column header unique to it. The page holds several tables and the
 * list sits in a plain card with no landmark role, so this is the narrowest handle that needs no
 * test-only attribute.
 */
function sessionTable(page: Page): Locator {
	return page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Cost in range" }) });
}

/** Row 0 is the header, so data rows start at 1. */
function sessionLinkAt(page: Page, index: number): Locator {
	return sessionTable(page)
		.getByRole("row")
		.nth(index + 1)
		.getByRole("link");
}

test("the list opens most-expensive-first, agreeing with the chart above it", async ({ page }) => {
	await page.goto("/");

	// Session 30 costs $7.50, the most of any in the corpus. The row shows its project name, not
	// its id — the id is only in the link target, which is what makes this assertion specific.
	await expect(sessionLinkAt(page, 0)).toHaveAttribute("href", "/session/e2e-session-30");
});

test("paging forward shows the next page of sessions, and says so in the URL", async ({ page }) => {
	await page.goto("/");

	// 30 sessions at 25 a page: page one runs from session 30 down to session 06, so page two must
	// begin at session 05. Asserting the exact first row of page two is what proves the offset is
	// applied — a pager that navigated but re-served page one would pass a looser check.
	await expect(sessionTable(page).getByRole("row")).toHaveCount(26);

	// By label, not by role: the pager's anchors are rendered through base-ui's Button with
	// nativeButton={false}, which stamps role="button" on them, so they are not links in the
	// accessibility tree despite being <a href>.
	await page.getByLabel("Go to next page").click();

	await expect(page).toHaveURL(/[?&]page=/);
	await expect(sessionLinkAt(page, 0)).toHaveAttribute("href", "/session/e2e-session-05");
	// Page two holds the remaining 5, plus the header row.
	await expect(sessionTable(page).getByRole("row")).toHaveCount(6);
});

test("re-ordering the list sends the operator back to page one", async ({ page }) => {
	await page.goto("/");
	await page.getByLabel("Go to next page").click();
	await expect(sessionTable(page).getByRole("row")).toHaveCount(6);

	await page.getByRole("combobox", { name: "Sort sessions" }).click();
	await page.getByRole("option", { name: "Most recent" }).click();

	await expect(page).toHaveURL(/[?&]sort=recent/);
	// Staying on page 2 would show rows 26-30 of a DIFFERENT ordering — an offset into a list the
	// operator never saw the start of. A full page of results is the proof it reset.
	await expect(page).not.toHaveURL(/[?&]page=/);
	await expect(sessionTable(page).getByRole("row")).toHaveCount(26);

	// Newest first. Sessions 1, 11 and 21 all sit on the most recent day and share a timestamp, so
	// which of them leads is settled by the session-id tie-break — any other session would mean
	// the ordering did not change.
	await expect(sessionLinkAt(page, 0)).toHaveAttribute("href", /\/session\/e2e-session-(01|11|21)$/);
});

test("clicking a session opens its own page", async ({ page }) => {
	await page.goto("/");

	await sessionLinkAt(page, 0).click();

	// This is the journey the list exists for: before it, reaching a session meant pasting its id.
	await expect(page).toHaveURL(/\/session\/e2e-session-30$/);
	await expect(page.getByRole("heading", { level: 1, name: "Session e2e-session-30" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "Overview" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "Cost by model" })).toBeVisible();
});
