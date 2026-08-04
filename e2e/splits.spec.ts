import { expect, test } from "@playwright/test";

test("switching the split re-groups the same spend by a different dimension", async ({ page }) => {
	await page.goto("/");

	const splitPanel = page.getByRole("tabpanel");
	await expect(splitPanel.getByRole("row").filter({ hasText: "e2e-studio" })).toContainText("$60.00");

	await page.getByRole("tab", { name: "Project", exact: true }).click();

	await expect(page).toHaveURL(/[?&]tab=project/);

	// The same $116.25, cut a different way: sessions round-robin across three projects, so
	// personal/lms takes sessions 3,6,…,30 — $41.25 across 10 events. Machine names must be gone
	// from the panel entirely, or the tab swapped the label without swapping the query.
	const lmsRow = splitPanel.getByRole("row").filter({ hasText: "personal/lms" });
	await expect(lmsRow).toContainText("$41.25");
	await expect(lmsRow).toContainText("10");
	await expect(splitPanel.getByRole("row").filter({ hasText: "e2e-studio" })).toHaveCount(0);
});

test("the repository split folds every repo-less project into one unattributed bucket", async ({ page }) => {
	await page.goto("/");

	await page.getByRole("tab", { name: "Repo", exact: true }).click();
	await expect(page).toHaveURL(/[?&]tab=repo/);

	const splitPanel = page.getByRole("tabpanel");

	// This split INVERTS the project split's rule. On the Project tab each repo-less project stands
	// alone; here they collapse together, because "no repository" is the answer itself rather than
	// a missing field. Two of the three fixture projects carry no repoKey: $38.75 + $41.25 = $80.00
	// across 20 events. A per-project breakdown appearing instead would mean the fold was lost.
	const unattributedRow = splitPanel.getByRole("row").filter({ hasText: "(unattributed)" });
	await expect(unattributedRow).toContainText("$80.00");
	await expect(unattributedRow).toContainText("20");

	// The one project that DOES carry a repoKey is labelled by its slug, never by the hash — the
	// repoKey is an unsalted SHA-256 of a git remote and must not reach the browser.
	await expect(splitPanel.getByRole("row").filter({ hasText: "personal/claude-usage" })).toContainText("$36.25");
	await expect(splitPanel.getByText(/[0-9a-f]{64}/)).toHaveCount(0);
});
