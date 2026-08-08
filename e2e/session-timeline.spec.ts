import { expect, test } from "@playwright/test";

/**
 * Card #161 Step 9 — proves the carry-vs-new timeline (Step 8) end-to-end against a session long
 * enough to have a shape, using F2's own isolated fixture (D12) rather than `corpus.ts`. Reached
 * by direct navigation, not the (windowed, paginated) default session list — the fixture is
 * dated far in the past specifically so it never appears there, and the session page itself is
 * unwindowed.
 *
 * No import from `./fixtures/session-timeline` at all, matching `machine-sync.spec.ts`'s own
 * precedent — every value below, including the session id, is a literal written here. Every
 * dollar literal is hand-verified against the real pricing formulas (see
 * IMPLEMENTATION_PROGRESS.md).
 */
test("a multi-turn session's carry-vs-new timeline renders more than one bar, with both series' arithmetic correct", async ({ page }) => {
	await page.goto("/session/e2e-timeline-session");

	// Shape: 6 turns, each its own bucket (turnCount <= 20 turn cap) — never a single bar.
	for (const label of ["Turn 1", "Turn 2", "Turn 3", "Turn 4", "Turn 5", "Turn 6"]) {
		await expect(page.getByText(label, { exact: true })).toBeVisible();
	}

	// Both series rendered (D6): main and subagent each get their own legend entry.
	await expect(page.getByText("Carry", { exact: true })).toBeVisible();
	await expect(page.getByText("New work", { exact: true })).toBeVisible();
	await expect(page.getByText("Subagent carry", { exact: true })).toBeVisible();
	await expect(page.getByText("Subagent new work", { exact: true })).toBeVisible();

	const tooltip = page.locator(".recharts-tooltip-wrapper");

	// Turn 1 (main): carryUsd=0.04, newUsd=0.06 — the main series' own arithmetic, hovering its
	// (nonzero) carryUsd bar, the 1st <Bar> declared in turn-timeline.ui.tsx.
	const turn1CarryBar = page.locator(".recharts-bar-rectangles").nth(0).locator(".recharts-bar-rectangle").nth(0);
	await turn1CarryBar.hover();
	await expect(tooltip).toContainText("Turn 1");
	await expect(tooltip).toContainText("0.04");
	await expect(tooltip).toContainText("0.06");

	// Turn 3 (subagent): subagentCarryUsd=0.03, subagentNewUsd=0.05 — the subagent series' own
	// arithmetic, hovering its (nonzero) bar, the 3rd <Bar> declared. `minPointSize={2}` (card
	// #161 F2 adversarial Fix E / R40) makes Recharts render a rectangle for EVERY turn, including
	// zero-valued ones (a minimum-height sliver), so DOM index now equals turn-array index 1:1 —
	// Turn 3 is DOM index 2 within this series' group, same as its 1-based position minus one.
	// Also the bucket where the MAIN series must be correctly zero-filled (D6) rather than
	// omitted, since Turn 3 is the only turn in this bucket and it is a subagent turn.
	const turn3SubagentCarryBar = page.locator(".recharts-bar-rectangles").nth(2).locator(".recharts-bar-rectangle").nth(2);
	await turn3SubagentCarryBar.hover();
	await expect(tooltip).toContainText("Turn 3");
	await expect(tooltip).toContainText("0.03");
	await expect(tooltip).toContainText("0.05");
});
