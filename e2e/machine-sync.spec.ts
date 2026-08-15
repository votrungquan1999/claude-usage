import { expect, test } from "@playwright/test";

/**
 * Card #170 Step 10 is the only part of this file that mutates `machine_sync_state` — every test
 * below restores both machines to unnamed afterward, regardless of pass/fail, so later specs
 * (which assert the literal short ids "0ddfda8e"/"a1f909db") never see a leftover nickname from a
 * run of this file. Posted from inside the page, not via Playwright's own request context, so the
 * browser sets a real same-origin `Origin` header the same way the UI's own save does — the
 * route's 403 check depends on it. Best-effort: if a test cleared cookies to force a 401 (D22),
 * this also gets a 401, which is fine — nothing was saved for it to undo.
 */
test.afterEach(async ({ page }) => {
	for (const machineId of [
		"0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2",
		"a1f909dbfba5753b265a08b451cf6a00f8f399fb354baef941592015c6211c1f",
	]) {
		await page.evaluate(async (id) => {
			try {
				await fetch("/api/machines", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ machineId: id, name: "" }),
				});
			} catch {
				// Best-effort cleanup only — see the doc comment above.
			}
		}, machineId);
	}
});

/**
 * `MACHINE_ID_MACBOOK` is seeded 13h stale, `MACHINE_ID_STUDIO` 1h fresh (`e2e/global-setup.ts`) —
 * a real pair to distinguish the flag on, rather than asserting against a tile with nothing to
 * differ on. 64-char hex (card #170 Step 1) — production shape, not the old 10/11-char placeholder.
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

	// The SHORT form (card #170 D7 — `shortenMachineId`'s head-8), not the full hash: the tile's
	// visible text changed with Step 3, so matching on the old full id would either miss the row
	// entirely or, worse, pass vacuously against the id's own `sr-only` companion span rather than
	// against what the operator actually sees.
	const staleRow = tile.getByText("0ddfda8e", { exact: true }).locator("..");
	await expect(staleRow).toContainText("No activity in 12h");

	const freshRow = tile.getByText("a1f909db", { exact: true }).locator("..");
	// A positive assertion, not just the negated one below (card #161 Batch A fix pass, Fix 6):
	// a row that stopped rendering entirely would still pass `not.toContainText`, so that
	// matcher alone can pass vacuously. Asserting the row actually shows a rendered timestamp
	// closes that gap.
	await expect(freshRow).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
	await expect(freshRow).not.toContainText("No activity in 12h");
});

/**
 * Card #170 Step 3 — the headline machine-sync fix: a short readable id in place of the 64-char
 * hash, without losing the full identifier for assistive technology.
 */
test("shows a short readable id instead of the 64-char hash, keeps the full id reachable by a screen reader and a hover title, and stacks the timestamps below the id rather than sharing its line", async ({
	page,
}) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const fullId = "a1f909dbfba5753b265a08b451cf6a00f8f399fb354baef941592015c6211c1f";
	const shortId = "a1f909db";

	// The operator sees the short form, and can confirm which machine it is via a hover title.
	const idText = tile.getByText(shortId, { exact: true });
	await expect(idText).toBeVisible();
	await expect(idText).toHaveAttribute("title", fullId);

	// The full id is still reachable by a screen reader, via a visually-hidden companion — not
	// merely present as a hover title, which a screen reader does not read by default. Located by
	// its TEXT, not the `.sr-only` CSS class: a class-based locator only proves a node with that
	// class exists in the DOM, and would keep passing even if `aria-hidden` migrated onto an
	// ANCESTOR of that node (e.g. the row wrapper) — CSS classes are invisible to the accessibility
	// tree, so that exact regression would go undetected. This instead confirms the text is
	// genuinely reachable: present, and not hidden by `aria-hidden="true"` on itself or any ancestor.
	const fullIdText = tile.getByText(fullId, { exact: true });
	await expect(fullIdText).toHaveCount(1);
	const hiddenFromScreenReader = await fullIdText.evaluate((node) => {
		for (let el: Element | null = node; el !== null; el = el.parentElement) {
			if (el.getAttribute("aria-hidden") === "true") return true;
		}
		return false;
	});
	expect(hiddenFromScreenReader).toBe(false);

	// Stacked: the timestamp line starts below the id's own line, not beside it. Scoped to this
	// machine's own row — the tile holds two rows, and each carries two matching timestamps
	// (lastContact and lastAccepted), so an unscoped lookup resolves to more than one element.
	const row = idText.locator("..");
	const idBox = await idText.boundingBox();
	const timestampBox = await row.getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/).first().boundingBox();
	if (idBox === null || timestampBox === null) throw new Error("the id or the timestamp did not render a bounding box");
	expect(timestampBox.y).toBeGreaterThanOrEqual(idBox.y + idBox.height);
});

/**
 * Card #170 Step 10 — the headline behaviour: a name typed on the sync tile has to reach every
 * other place a machine appears in the SAME render pass the operator is looking at, not after a
 * reload. Session 30 (the corpus's priciest, `$7.50`) bills to this machine and sorts to the
 * session list's own first row under the default "Cost in range" order, so one rename exercises
 * all four surfaces without a second fixture lookup.
 */
test("renaming a machine from the sync tile updates the tile, the session list, the split totals table and the chart legend — without the operator reloading (D1/D6/D11)", async ({
	page,
}) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const fullId = "a1f909dbfba5753b265a08b451cf6a00f8f399fb354baef941592015c6211c1f";
	const shortId = "a1f909db";
	const newName = "Studio Rig";

	const row = tile.getByText(fullId, { exact: true }).locator("..");
	await row.getByRole("button", { name: `Rename ${shortId}` }).click();
	await row.getByRole("textbox").fill(newName);
	await row.getByRole("button", { name: "Save", exact: true }).click();

	// The tile itself, live, no reload.
	await expect(row.getByText(newName, { exact: true })).toBeVisible();

	// The session list's Machine column — the fixed 3rd column (Session, Project, Machine, …).
	const sessionTable = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Cost in range" }) });
	await expect(sessionTable.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText(newName);

	// The split totals table (Machine is the default tab, D30) — same row `splits.spec.ts` pins to
	// $60.00, now under its new name instead of its short id.
	const splitPanel = page.getByRole("tabpanel");
	await expect(splitPanel.getByRole("row").filter({ hasText: newName })).toContainText("$60.00");

	// The chart legend.
	const legend = page.locator(".recharts-legend-wrapper");
	await expect(legend.getByText(newName, { exact: true })).toBeVisible();
});

/**
 * Card #170 Step 10 — the AC's other half: a rename is a real stored fact, not a client-side
 * illusion `router.refresh()` (Test above) could paper over. A hard reload throws away every bit
 * of client state and asks the server fresh, so this is a materially different check from the
 * live-update test even though both start from the same action.
 */
test("a rename survives a fresh page load, not just the live refresh right after saving", async ({ page }) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const fullId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";
	const shortId = "0ddfda8e";
	const newName = "Backup Mac";

	const row = tile.getByText(fullId, { exact: true }).locator("..");
	await row.getByRole("button", { name: `Rename ${shortId}` }).click();
	await row.getByRole("textbox").fill(newName);
	await row.getByRole("button", { name: "Save", exact: true }).click();
	await expect(row.getByText(newName, { exact: true })).toBeVisible();

	await page.reload();

	const reloadedTile = page.getByText("Machine sync", { exact: true }).locator("..");
	await expect(reloadedTile.getByText(newName, { exact: true })).toBeVisible();
	await expect(reloadedTile.getByText(shortId, { exact: true })).toHaveCount(0);
});

/**
 * Card #170 D14 — clearing is the operator's undo, not a validation error. Renames, then clears
 * the SAME machine in a second edit, so the assertion is sensitive to a route that treats an
 * empty save as "leave the old name alone" rather than genuinely unsetting it.
 */
test("clearing the name returns the machine to its short id", async ({ page }) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const fullId = "a1f909dbfba5753b265a08b451cf6a00f8f399fb354baef941592015c6211c1f";
	const shortId = "a1f909db";
	const newName = "Render Box";

	const row = tile.getByText(fullId, { exact: true }).locator("..");
	await row.getByRole("button", { name: `Rename ${shortId}` }).click();
	await row.getByRole("textbox").fill(newName);
	await row.getByRole("button", { name: "Save", exact: true }).click();
	await expect(row.getByText(newName, { exact: true })).toBeVisible();

	await row.getByRole("button", { name: `Rename ${newName}` }).click();
	await row.getByRole("textbox").fill("");
	await row.getByRole("button", { name: "Save", exact: true }).click();

	await expect(row.getByText(shortId, { exact: true })).toBeVisible();
	await expect(row.getByText(newName, { exact: true })).toHaveCount(0);
});

/**
 * Card #170 D17 — the tile orders by what the operator SEES, not by the raw id underneath it. The
 * two fixture machines' short ids ("0ddfda8e", "a1f909db") already sort MacBook-first under the
 * raw id; naming the MacBook machine "Zephyr" sorts it AFTER "a1f909db" instead — the old raw-id
 * order would still put it first, so this only passes if the tile re-sorts on the new text.
 */
test("renaming a machine to a name that sorts differently reorders the tile by the new displayed name, not the raw id", async ({
	page,
}) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const renamedFullId = "0ddfda8e5787540f000f31a99698c255240bfcefdd12bfb61ef432691c68f6d2";
	const renamedShortId = "0ddfda8e";
	const otherShortId = "a1f909db";
	const newName = "Zephyr";

	const row = tile.getByText(renamedFullId, { exact: true }).locator("..");
	await row.getByRole("button", { name: `Rename ${renamedShortId}` }).click();
	await row.getByRole("textbox").fill(newName);
	await row.getByRole("button", { name: "Save", exact: true }).click();
	await expect(row.getByText(newName, { exact: true })).toBeVisible();

	// Index-based, not a fixed-length array: the tile also lists whichever machine
	// `session-timeline.ts`'s own fixture seeds, which this test does not touch and must not
	// assume a position for.
	const rowTexts = await tile.locator("span.font-mono").allTextContents();
	expect(rowTexts.indexOf(otherShortId)).toBeLessThan(rowTexts.indexOf(newName));
});

/**
 * Card #170 D22 — a failed save must not throw away what the operator typed, and must say
 * something rather than fail silently. Clearing the session cookie mid-edit removes
 * `verifySecret`'s only fallback for a browser request, forcing the exact bare-401 shape D22
 * calls out (`/api` sits outside the proxy's matcher, so this is not the usual login redirect).
 */
test("a failed save shows an inline error and keeps what the operator typed", async ({ page, context }) => {
	await page.goto("/");

	const tile = page.getByText("Machine sync", { exact: true }).locator("..");
	const fullId = "a1f909dbfba5753b265a08b451cf6a00f8f399fb354baef941592015c6211c1f";
	const shortId = "a1f909db";
	const typedName = "Unsaved Name";

	const row = tile.getByText(fullId, { exact: true }).locator("..");
	await row.getByRole("button", { name: `Rename ${shortId}` }).click();
	await row.getByRole("textbox").fill(typedName);

	await context.clearCookies();
	await row.getByRole("button", { name: "Save", exact: true }).click();

	await expect(row.getByRole("alert")).toBeVisible();
	await expect(row.getByRole("textbox")).toHaveValue(typedName);
});
