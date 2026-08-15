import { expect, test } from "@playwright/test";

import { MACHINE_IDS, REPO_KEY } from "./fixtures/corpus";

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
	await expect(page.getByRole("heading", { level: 2, name: "Sessions" })).toBeVisible();

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
	// The repoKey is an unsalted SHA-256 of a git remote and must never surface as this drill-down's
	// own text (heading, summary, back link) — that's the invariant this assertion exists to catch.
	// Machine ids are ALSO 64-char hex now (card #170 Step 1) and legitimately render in the session
	// table's Machine column, so a page-wide "no hex" check would flag a real id instead of a leak
	// (D24). Scoped instead: every hex match anywhere on the page must be one of the table's own
	// machine-id cells — none may come from outside it.
	const hexMatchesAnywhere = page.getByText(/[0-9a-f]{64}/);
	const hexMatchesInTable = page.getByRole("table").getByText(/[0-9a-f]{64}/);
	expect(await hexMatchesAnywhere.count()).toBe(await hexMatchesInTable.count());
	// Shape-independent companion: the count comparison above is blind to a repoKey rendered
	// INSIDE the table (both counts rise together, so the leak would go unnoticed). Matching the
	// literal repoKey text catches that case directly, and is unaffected by hex-shaped machine ids.
	await expect(page.getByText(REPO_KEY)).toHaveCount(0);
});

test("clicking a machine row opens its own drill-down, addressed by id, with a readable name on the heading (card #170 D12)", async ({
	page,
}) => {
	await page.goto("/?tab=machine");

	// The row's link text is the short display name, but the address it points to is still the
	// full machine id — D12's whole point: a nickname (or, until Step 10, this short id) is a
	// label, never a key. Substituting the label into the href here would have sent this exact
	// row to "No data in this range" on a machine with real spend, the failure class D12 exists
	// to make structurally impossible.
	const link = page.getByRole("tabpanel").getByRole("link", { name: "a1f909db", exact: true });
	await expect(link).toHaveAttribute("href", new RegExp(MACHINE_IDS[1]));

	await link.click();

	await expect(page).toHaveURL(new RegExp(`/split/machine/${MACHINE_IDS[1]}`));
	// The heading names the machine the same short way the row did — not the 64-char id the
	// address bar carries.
	await expect(page.getByRole("heading", { name: "a1f909db", exact: true })).toBeVisible();
	// The same figure the row showed, on the page it opened — proves the drill-down resolved the
	// real machine rather than merging it with another or matching nothing.
	await expect(page.getByText("$60.00")).toBeVisible();
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

/**
 * Card #170 D1's surface list names the drill-down heading explicitly, alongside the sync tile,
 * both totals tables, the chart legend and the chart tooltip — but until this fix the heading was
 * the one surface still showing the short id after a rename. Renamed via the same API route the
 * sync tile's own Save button calls (`e2e/machine-sync.spec.ts`'s established technique), from
 * inside the page so the browser sends a real same-origin Origin header. Runs last in this file
 * and cleans up in its own afterEach (matching machine-sync.spec.ts's convention) so no other test
 * here or in a later file sees a leftover nickname on this fixture machine.
 */
test("a renamed machine's drill-down heading shows the nickname, not the short id (card #170 D1)", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(async (id) => {
		await fetch("/api/machines", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ machineId: id, name: "Studio Rig" }),
		});
	}, MACHINE_IDS[1]);

	await page.goto(`/split/machine/${MACHINE_IDS[1]}`);

	await expect(page.getByRole("heading", { name: "Studio Rig", exact: true })).toBeVisible();
	// Not the short id any more — the whole point of the fix.
	await expect(page.getByRole("heading", { name: "a1f909db", exact: true })).toHaveCount(0);
});

test.afterEach(async ({ page }) => {
	// Best-effort, unconditional (pass or fail) — see the doc comment above the rename test.
	await page.evaluate(async (id) => {
		try {
			await fetch("/api/machines", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ machineId: id, name: "" }),
			});
		} catch {
			// Best-effort cleanup only.
		}
	}, MACHINE_IDS[1]);
});
