import { expect, test } from "@playwright/test";

import { MACHINE_IDS } from "./fixtures/corpus";

/**
 * Runs on the `mobile` Playwright project only (390×844, touch enabled — see `playwright.config.ts`
 * and card #170 D8/D26). Scoped here by `testMatch` so the rest of the existing suite never runs at
 * phone width before the layout fixes later in this plan land (D26).
 *
 * Mirrors `dashboard.spec.ts`'s own smoke test: the operator's real phone reaching the dashboard,
 * signed in, is exactly what a green run of this suite is supposed to mean (card #170 Step 1).
 */
test("an authenticated operator on a phone reaches the dashboard instead of the login gate", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "Claude Usage" })).toBeVisible();
	// The proxy redirects an unauthenticated request to /login, so staying on / is the assertion:
	// it proves the cached session was actually accepted, not merely that a page rendered.
	expect(new URL(page.url()).pathname).toBe("/");
});

/**
 * Card #170 Step 2. Two independent things have to be true at once for this to pass:
 *
 * 1. The date-range preset and calendar controls (369px combined, always present on any dataset)
 *    stack instead of sitting side by side.
 * 2. A KPI tile — an otherwise unremarkable card — stays sized to the screen. At the time this
 *    test was written the machine sync tile right next to it in the same grid was still wide (raw
 *    64-char ids); Step 3 later shortened those too, so today neither tile is wide on its own. The
 *    assertion still guards the shared-grid-track MECHANISM, not any one sibling's current width:
 *    if that track ever regressed to sizing itself off its widest child again, this is what would
 *    catch it, independent of which sibling happened to be the wide one.
 */
test("the date-range controls stack instead of sitting side by side, and an ordinary card stays sized to the screen", async ({
	page,
}) => {
	await page.goto("/");

	const viewportWidth = page.viewportSize()?.width ?? 390;

	const presetBox = await page.getByRole("combobox", { name: "Date range" }).boundingBox();
	const calendarBox = await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).boundingBox();
	if (presetBox === null || calendarBox === null) throw new Error("the date-range controls did not render a bounding box");
	// Stacked, not side by side: the calendar button starts on a new line below the select rather
	// than sharing its row.
	expect(calendarBox.y).toBeGreaterThanOrEqual(presetBox.y + presetBox.height);

	// "Spend today" is a KPI tile's label — a fixed-period figure, unrelated to the machine sync
	// tile that sits directly above/below it in the same page grid.
	const kpiBox = await page.getByText("Spend today").locator("..").boundingBox();
	if (kpiBox === null) throw new Error("the KPI tile did not render a bounding box");
	expect(kpiBox.x + kpiBox.width).toBeLessThanOrEqual(viewportWidth);
});

/**
 * Card #170 Step 3 — the headline fix this whole plan exists to deliver. The measured 749px real
 * page becomes 390px here: Step 2 stopped one wide sibling dragging the shared grid track wide,
 * and Step 3 removed the last unshrinkable content (the raw 64-char machine id) that was still
 * overflowing on its own even after the track fix. Nothing after this step is required to close
 * the page-overflow problem — everything later is readability, reachability and the nickname.
 */
test("the whole dashboard requires no horizontal scrolling at 390px", async ({ page }) => {
	await page.goto("/");

	// Precondition: the dashboard actually rendered its real content, not a login redirect, an
	// all-cards-error state, or a Suspense fallback still in flight — any of those is also a
	// narrow page and would make the overflow check below pass vacuously. "Spend today" is a KPI
	// tile's label that only exists once a real card has loaded.
	await expect(page.getByText("Spend today")).toBeVisible();

	// NOTE: scrollWidth measures the DOCUMENT's own overflow only. It is blind to a table scrolling
	// sideways INSIDE its own `overflow-x-auto` container (`table.tsx:11` wraps every table in one)
	// — that reachability/keyboard-focus behaviour is Step 5's coverage, not this test's.
	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	);
	expect(hasHorizontalOverflow).toBe(false);
});

/**
 * Card #170 Step 8, D4 — 44px on MOBILE ONLY. Desktop sizing is untouched, so every one of this
 * step's tests measures both viewports in one run rather than trusting a mobile-only pass: "made
 * everything bigger everywhere" would still pass a test that never looked at desktop. Resized via
 * `page.setViewportSize` mid-test (this file is scoped to the `mobile` Playwright project only —
 * D26/D31 — so it never runs under `chromium`), to `devices["Desktop Chrome"]`'s own 1280×720
 * default, matching what the `chromium` project itself renders at.
 */
test("the date-range preset control reaches a 44px tap target on a phone, and keeps today's size on desktop", async ({
	page,
}) => {
	await page.goto("/");

	const trigger = page.getByRole("combobox", { name: "Date range" });
	const mobileBox = await trigger.boundingBox();
	if (mobileBox === null) throw new Error("the date-range preset trigger did not render a bounding box");
	expect(mobileBox.height).toBeGreaterThanOrEqual(44);

	await page.setViewportSize({ width: 1280, height: 720 });
	const desktopBox = await trigger.boundingBox();
	if (desktopBox === null) throw new Error("the date-range preset trigger did not render a bounding box");
	// h-8 today (`data-[size=default]:h-8`) = 32px — toBeCloseTo (sub-pixel rendering can shift
	// boundingBox by a fraction), so a control bumped at both viewports (the stated failure mode)
	// is still caught precisely rather than merely "not over 44".
	expect(desktopBox.height).toBeCloseTo(32, 0);
});

/**
 * Card #170 Step 4. The machine dimension's chart (default tab, so no click needed) must relabel
 * its legend the same way the totals table relabels its rows — a chart with no `dimension`/`tab`
 * signal of its own before this step (`cost-chart.tsx` investigation). Run at 390px specifically:
 * this is the one width narrow enough for recharts 3.8.0's #7200 legend-measurement regression to
 * actually show up (the totals table's own card is ~294-326px wide at this viewport — see Step 5
 * investigation's own measurement), so a real-browser check here is what the plan asked for rather
 * than an assumption.
 */
test("the machine chart's legend shows short display ids, not the 64-char hash, with no overlap between items", async ({
	page,
}) => {
	await page.goto("/");

	const legend = page.locator(".recharts-legend-wrapper");
	const firstId = MACHINE_IDS[0].slice(0, 8);
	const secondId = MACHINE_IDS[1].slice(0, 8);

	const firstItem = legend.getByText(firstId, { exact: true });
	const secondItem = legend.getByText(secondId, { exact: true });
	await expect(firstItem).toBeVisible();
	await expect(secondItem).toBeVisible();

	const firstBox = await firstItem.boundingBox();
	const secondBox = await secondItem.boundingBox();
	if (firstBox === null || secondBox === null) throw new Error("a legend item did not render a bounding box");
	expect(firstBox.width).toBeGreaterThan(0);
	expect(secondBox.width).toBeGreaterThan(0);
	// Order-agnostic: the two items' horizontal ranges must not intersect, whichever comes first.
	const noOverlap = firstBox.x + firstBox.width <= secondBox.x || secondBox.x + secondBox.width <= firstBox.x;
	expect(noOverlap).toBe(true);
});

/**
 * Card #170 Step 8, D4. The worst offender named in the plan: 28px day cells and nav buttons, both
 * driven by the calendar's own `--cell-size` custom property (`calendar.tsx`) — one call-site
 * override reaches both at once (`range-picker.ui.tsx`'s `RangeCalendarField`). Located by the
 * `data-day` attribute `CalendarDayButton` stamps on every rendered day (unambiguous even with two
 * months open, where a bare day number like "15" repeats), and by the nav buttons' own accessible
 * names — real react-day-picker defaults, not invented strings.
 */
test("the calendar's day cells and nav buttons reach a 44px tap target on a phone, and keep today's size on desktop", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).click();

	const mobileDayBox = await page.locator("[data-day]").first().boundingBox();
	if (mobileDayBox === null) throw new Error("no calendar day cell rendered");
	expect(mobileDayBox.height).toBeGreaterThanOrEqual(44);
	expect(mobileDayBox.width).toBeGreaterThanOrEqual(44);

	const mobileNavBox = await page.getByRole("button", { name: "Go to the Next Month" }).boundingBox();
	if (mobileNavBox === null) throw new Error("no calendar nav button rendered");
	expect(mobileNavBox.height).toBeGreaterThanOrEqual(44);

	// Close before resizing: base-ui positions the popover at open time (R31), so a resize while it
	// is open risks a stale/relocated position rather than exercising the real desktop render.
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).click();

	// --spacing(7) today = 28px — toBeCloseTo, same over-correction sensitivity as the preset test.
	const desktopDayBox = await page.locator("[data-day]").first().boundingBox();
	if (desktopDayBox === null) throw new Error("no calendar day cell rendered");
	expect(desktopDayBox.height).toBeCloseTo(28, 0);

	const desktopNavBox = await page.getByRole("button", { name: "Go to the Next Month" }).boundingBox();
	if (desktopNavBox === null) throw new Error("no calendar nav button rendered");
	expect(desktopNavBox.height).toBeCloseTo(28, 0);
});

/**
 * Card #170 Step 8, D20. Two months of 44px cells stack to ~528px, taller than a phone can spare
 * (worse in landscape) — so `numberOfMonths` stays 2 (unchanged, D20 rejected letting the popover
 * scroll or overflow instead), and the SECOND month is hidden below `sm` rather than un-rendered:
 * a viewport-width CSS rule, matching D21's "sizing keys off viewport width", not a JS breakpoint.
 * Counted by each month's own `role="status"` caption (`calendar.tsx`'s `CaptionLabel`) inside the
 * popover — a `display:none` month drops out of the accessibility tree, so the count is a direct
 * read of what actually rendered, not an assumption from the class list.
 */
test("the range calendar shows one month on a phone and two months on desktop", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).click();

	const popoverContent = page.locator('[data-slot="popover-content"]');
	await expect(popoverContent.getByRole("status")).toHaveCount(1);

	// Close before resizing — see the day-cell test above for why (R31).
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).click();

	await expect(popoverContent.getByRole("status")).toHaveCount(2);
});

/**
 * Card #170 Step 8, D4 + D5. The `Machine | Project | Model | Repo` strip stays tabs (never a
 * Select, which would give the control two identities across viewports) and grows to 44px on
 * mobile only. `TabsList`'s height sits behind `group-data-horizontal/tabs:h-8` — a gated variant,
 * not a plain class — so the override repeats that exact modifier chain rather than a bare `h-11`
 * (see `INVESTIGATION_STEP_8.md`'s TRAP). Also checks the scroll-sideways mechanism directly
 * (`overflow-x`): today's four tabs fit at 390px (nothing to visibly overflow, so an assertion on
 * an actual scrollbar would be vacuous), but the CSS property itself is a real, omittable behavior
 * — this assertion fails if it is missing, same as it would the day a fifth tab is added.
 */
test("the dimension tab strip reaches a 44px tap target on a phone, keeps today's size on desktop, and stays scrollable", async ({
	page,
}) => {
	await page.goto("/");

	const tabStrip = page.getByRole("tablist");
	const mobileBox = await tabStrip.boundingBox();
	if (mobileBox === null) throw new Error("the dimension tab strip did not render a bounding box");
	expect(mobileBox.height).toBeGreaterThanOrEqual(44);

	const overflowX = await tabStrip.evaluate((element) => getComputedStyle(element).overflowX);
	expect(overflowX).toBe("auto");

	await page.setViewportSize({ width: 1280, height: 720 });
	const desktopBox = await tabStrip.boundingBox();
	if (desktopBox === null) throw new Error("the dimension tab strip did not render a bounding box");
	// group-data-horizontal/tabs:h-8 today = 32px — toBeCloseTo, same over-correction sensitivity
	// as the other controls in this step.
	expect(desktopBox.height).toBeCloseTo(32, 0);
});

/**
 * Card #170 Step 8, D4. The session list's sort control is `size="sm"` (`data-[size=sm]:h-7`), a
 * gated variant like the calendar's height override above — same reason the override repeats the
 * exact modifier chain rather than a bare `h-11`.
 */
test("the session-list sort control reaches a 44px tap target on a phone, and keeps today's size on desktop", async ({
	page,
}) => {
	await page.goto("/");

	const sortControl = page.getByRole("combobox", { name: "Sort sessions" });
	const mobileBox = await sortControl.boundingBox();
	if (mobileBox === null) throw new Error("the session sort control did not render a bounding box");
	expect(mobileBox.height).toBeGreaterThanOrEqual(44);

	await page.setViewportSize({ width: 1280, height: 720 });
	const desktopBox = await sortControl.boundingBox();
	if (desktopBox === null) throw new Error("the session sort control did not render a bounding box");
	// data-[size=sm]:h-7 today = 28px — toBeCloseTo, same over-correction sensitivity as the other tests.
	expect(desktopBox.height).toBeCloseTo(28, 0);
});

/**
 * Card #170 Step 5, D2/D25. The session table is genuinely wider than its 390px card (measured:
 * 765px of content in a 294px scroll region), so this is a real overflow, not a contrived one. The
 * Session column is the row's only identifying text — it must stay put while everything else
 * scrolls under it, painted opaquely (bg-card, not the page's bg-background — a different token in
 * the dark theme, D25's correction) so scrolled content doesn't show through, and capped in width
 * since a model-generated session title has no length bound of its own (risk R27).
 */
test("scrolling the session table sideways keeps the Session column pinned, opaque, and capped in width", async ({
	page,
}) => {
	await page.goto("/");

	const region = page.getByRole("region", { name: "Session list" });
	const firstRow = region.getByRole("row").nth(1);
	const pinnedCell = firstRow.getByRole("cell").first();
	const eventsCell = firstRow.getByRole("cell").nth(5);

	const beforePinned = await pinnedCell.boundingBox();
	const beforeEvents = await eventsCell.boundingBox();
	if (beforePinned === null || beforeEvents === null) throw new Error("a cell did not render a bounding box");

	await region.evaluate((element) => element.scrollTo({ left: 300 }));

	const afterPinned = await pinnedCell.boundingBox();
	const afterEvents = await eventsCell.boundingBox();
	if (afterPinned === null || afterEvents === null) throw new Error("a cell did not render a bounding box");

	// Pinned: the Session cell's screen position does not move with the scroll.
	expect(afterPinned.x).toBeCloseTo(beforePinned.x, 0);
	// Not pinned: a later column genuinely scrolled — proves the scroll happened at all, so the
	// unchanged Session position above is a real pin, not a table that simply didn't scroll.
	expect(afterEvents.x).toBeLessThan(beforeEvents.x - 100);

	// Opaque: an implementer could add `sticky` and forget the background, which would look fine
	// in a screenshot taken at scrollLeft=0 and only show the seam once something is scrolled
	// underneath it.
	const backgroundColor = await pinnedCell.evaluate((element) => getComputedStyle(element).backgroundColor);
	expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

	// Capped: a `max-width` on the pinned cell (or its content wrapper) is what stops an unbounded
	// model-generated title from consuming the whole viewport and leaving nothing to scroll into.
	// Checked as a CSS property rather than with a long fixture title, since the corpus fixture's
	// titles are short by design (card #170 Step 1) — this still fails for real if no cap exists at
	// all (computed max-width reads "none").
	const maxWidthPx = await pinnedCell.evaluate((element) => parseFloat(getComputedStyle(element).maxWidth));
	expect(maxWidthPx).toBeGreaterThan(0);
	expect(maxWidthPx).toBeLessThan(390);
});

/**
 * Card #170 Step 5, D25. The totals table's literal first column is a decorative colour swatch —
 * pinning it alone would leave the row's actual identifying text (the name column next to it)
 * scrolling away, defeating the point. Project is the tab under test rather than Machine: a
 * project slug ("personal/claude-usage") is long enough to genuinely overflow the ~294px card at
 * 390px (measured: 319px of content), where Machine's own short display ids (Step 4) no longer do
 * — this keeps the scroll assertions below non-vacuous. Also capped in width (D25), the same
 * treatment D33 gave the session table's own pinned column and for the same reason: an unbounded
 * project slug or a 40-char nickname would otherwise consume the whole 390px viewport and leave
 * nothing to scroll into.
 */
test("scrolling the totals table sideways keeps its colour swatch and name pinned together, and the name stays capped in width", async ({
	page,
}) => {
	await page.goto("/?tab=project");

	const region = page.getByRole("region", { name: "Project totals" });
	const firstRow = region.getByRole("row").nth(1);
	const swatchCell = firstRow.getByRole("cell").nth(0);
	const nameCell = firstRow.getByRole("cell").nth(1);
	const costCell = firstRow.getByRole("cell").nth(2);

	const before = {
		swatch: await swatchCell.boundingBox(),
		name: await nameCell.boundingBox(),
		cost: await costCell.boundingBox(),
	};
	if (before.swatch === null || before.name === null || before.cost === null) {
		throw new Error("a cell did not render a bounding box");
	}

	await region.evaluate((element) => element.scrollTo({ left: 999 }));

	const after = {
		swatch: await swatchCell.boundingBox(),
		name: await nameCell.boundingBox(),
		cost: await costCell.boundingBox(),
	};
	if (after.swatch === null || after.name === null || after.cost === null) {
		throw new Error("a cell did not render a bounding box");
	}

	// Pinned together: both the swatch and the name stay at their original screen position.
	expect(after.swatch.x).toBeCloseTo(before.swatch.x, 0);
	expect(after.name.x).toBeCloseTo(before.name.x, 0);
	// Not pinned: the Cost column moves by exactly however far the region actually scrolled. Asking
	// the region for its own scrollLeft beats a fixed pixel threshold, because capping the pinned
	// name column narrows the table and so makes the available overflow a moving target.
	const scrolled = await region.evaluate((element) => element.scrollLeft);
	expect(scrolled).toBeGreaterThan(0);
	expect(after.cost.x).toBeCloseTo(before.cost.x - scrolled, 0);

	// Capped: a `max-width` on the pinned name cell is what stops an unbounded project slug or a
	// 40-char nickname from consuming the whole viewport and leaving nothing to scroll into (D25).
	// Checked as a CSS property, same as the session table's own version of this assertion — this
	// still fails for real if no cap exists at all (computed max-width reads "none").
	const maxWidthPx = await nameCell.evaluate((element) => parseFloat(getComputedStyle(element).maxWidth));
	expect(maxWidthPx).toBeGreaterThan(0);
	expect(maxWidthPx).toBeLessThan(390);
});

/**
 * Card #170 Step 5. The session detail page's "Cost by model" table (4 columns: Model, Cost,
 * Subagent cost, Events) is the third and last table in scope. Its markup lived inline in the
 * SERVER component `page.tsx` — per ADR 0001 (server components carry no styling), it has to move
 * into `session-detail.ui.tsx` before it can carry the sticky/pinned classes this step adds, the
 * same extraction Step 2 already did for the page's layout wrapper. 346px of content in a 294px
 * card (measured) — a genuine overflow, not a contrived one.
 */
test("scrolling the session's Cost by model table sideways keeps the Model column pinned", async ({ page }) => {
	await page.goto("/session/e2e-session-30");

	const region = page.getByRole("region", { name: "Cost by model" });
	const firstRow = region.getByRole("row").nth(1);
	const modelCell = firstRow.getByRole("cell").nth(0);
	const eventsCell = firstRow.getByRole("cell").nth(3);

	const beforeModel = await modelCell.boundingBox();
	const beforeEvents = await eventsCell.boundingBox();
	if (beforeModel === null || beforeEvents === null) throw new Error("a cell did not render a bounding box");

	await region.evaluate((element) => element.scrollTo({ left: 999 }));

	const afterModel = await modelCell.boundingBox();
	const afterEvents = await eventsCell.boundingBox();
	if (afterModel === null || afterEvents === null) throw new Error("a cell did not render a bounding box");

	expect(afterModel.x).toBeCloseTo(beforeModel.x, 0);
	expect(afterEvents.x).toBeLessThan(beforeEvents.x - 30);
});

/**
 * Card #170 Step 8, D4. The pager's Previous/Next/current-page controls are all `Button`-backed
 * (`pagination.tsx`), whose size classes are plain, non-gated `cva` variants — so a plain
 * `className="h-11 sm:h-8"` reliably wins through `twMerge`, unlike the `data-[size=...]`-gated
 * controls above. Located the same way `sessions.spec.ts` does: by label, since base-ui's
 * `nativeButton={false}` stamps `role="button"` on these `<a href>` elements.
 */
test("the session-list pager reaches a 44px tap target on a phone, and keeps today's size on desktop", async ({
	page,
}) => {
	await page.goto("/");

	const nextButton = page.getByRole("button", { name: "Go to next page" });
	const mobileBox = await nextButton.boundingBox();
	if (mobileBox === null) throw new Error("the pager's next-page button did not render a bounding box");
	expect(mobileBox.height).toBeGreaterThanOrEqual(44);

	await page.setViewportSize({ width: 1280, height: 720 });
	// toHaveCSS (auto-retrying), not a one-shot boundingBox read: resizing reveals this button's own
	// `hidden sm:block` "Next" text, and measuring immediately after the resize event caught that
	// reflow mid-settle in practice (33.03px, not a rounding-only artifact) — auto-retry waits out
	// the transient instead of asserting against a single unstable frame.
	// size="default" -> h-8 today = 32px — same over-correction sensitivity as the rest.
	await expect(nextButton).toHaveCSS("height", "32px");
});

/**
 * Card #170 Step 10, D4. The sync tile's rename trigger is `Button`-backed, like the pager above —
 * a plain `className="h-11 sm:h-7"` reliably wins through `twMerge` since `size="sm"`'s own class
 * is an ungated `cva` variant, not a `data-[size=...]`-gated one. The Input/Save/Cancel controls
 * that replace it once editing starts carry the identical override, so this one trigger stands in
 * for all of them rather than repeating the same measurement three more times.
 */
test("the sync tile's rename control reaches a 44px tap target on a phone, and keeps today's size on desktop", async ({
	page,
}) => {
	await page.goto("/");

	const renameButton = page.getByRole("button", { name: /^Rename /u }).first();
	const mobileBox = await renameButton.boundingBox();
	if (mobileBox === null) throw new Error("the rename button did not render a bounding box");
	expect(mobileBox.height).toBeGreaterThanOrEqual(44);

	await page.setViewportSize({ width: 1280, height: 720 });
	// toHaveCSS (auto-retrying), not a one-shot boundingBox read — same reflow-timing sensitivity
	// the pager test above already found: a snapshot taken immediately after the resize event can
	// catch layout mid-settle. size="sm" -> h-7 today = 28px.
	await expect(renameButton).toHaveCSS("height", "28px");
});

/**
 * Card #170 Step 6, D10. recharts' own default axis `interval` ("preserveEnd") only guarantees
 * the LAST tick survives its pixel-density measurement — confirmed in a real browser before
 * writing this: at 390px the cost chart's 15-bucket window showed only its 4 most-recent ticks,
 * dropping the window's own first day. `interval="preserveStartEnd"` is what pins the other end
 * too, so the operator can always see where the window began, not only where it ends.
 */
test("the cost chart's X-axis keeps the window's first bucket tick visible, not only its last, once there are more buckets than fit at 390px", async ({
	page,
}) => {
	await page.goto("/");

	const rangeButton = page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ });
	const rangeLabel = await rangeButton.innerText();
	const fromDay = rangeLabel.split(" → ")[0];
	const firstTick = fromDay.slice(2); // matches bucketAxisTick's own two-digit-year form

	const chart = page.locator(".recharts-wrapper").first();
	// Precondition: the chart actually rendered its bars, not a "No data" placeholder or a
	// Suspense fallback still in flight — either of those has no axis at all, which would make
	// the tick assertion below fail for the wrong reason.
	await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();

	await expect(chart.getByText(firstTick, { exact: true })).toBeVisible();
});

/**
 * Card #170 Step 6. Only 2 machines exist in this fixture, so the legend never has enough items
 * to actually overflow one row here — a real overflow needs 5-6 series (machine ids have no space
 * to soft-wrap on, unlike "New work"/"Subagent carry" elsewhere), which this corpus can't produce
 * without touching fixture conventions outside this step's scope. Checked as a CSS property
 * instead, same precedent as Step 8's tab-strip `overflow-x: auto` check: a real, omittable
 * behaviour that fails today (no `flex-wrap` class exists) and would matter the day a chart's
 * legend grows past 2 items.
 */
test("the chart legend can wrap onto more than one row instead of overflowing, once it holds more items than one row fits", async ({
	page,
}) => {
	await page.goto("/");

	const legend = page.locator(".recharts-legend-wrapper").first();
	await expect(legend).toBeVisible();

	const flexWrap = await legend.locator(":scope > div").evaluate((element) => getComputedStyle(element).flexWrap);
	expect(flexWrap).toBe("wrap");
});

/**
 * Card #170 Step 6 — the recharts 3.8.0 / #7200 regression this step was told to verify, not
 * assume. Confirmed in a real browser before writing this test: the app never resizes a chart's
 * container after its first paint (the page loads directly at 390px), which is the specific
 * trigger #7200 needs (a narrowing container post-mount, un-observed because the installed
 * `useElementOffset.js` lacks the ResizeObserver the fix adds) — so the regression does not
 * reproduce here today. This asserts the outcome directly rather than trusting that reasoning.
 */
test("the chart legend sits below the bars, never drawing on top of them", async ({ page }) => {
	await page.goto("/");

	const chart = page.locator(".recharts-wrapper").first();
	const bars = chart.locator(".recharts-bar-rectangle");
	await expect(bars.first()).toBeVisible();

	const barsBox = await chart.locator(".recharts-bar-rectangles").first().boundingBox();
	const legendBox = await chart.locator(".recharts-legend-wrapper").boundingBox();
	if (barsBox === null || legendBox === null) throw new Error("the bars or the legend did not render a bounding box");

	expect(legendBox.y).toBeGreaterThanOrEqual(barsBox.y + barsBox.height);
});

/**
 * Card #170 Step 6. `cache-savings-chart.tsx`'s Y-axis is the widest of the 5 charts (`width={64}`,
 * the dollar-formatted axis) — the one PLAN_STEPS.md names as the container's worst offender at a
 * 294px card. Confirmed in a real browser before writing this: today the axis labels stay legible
 * and real plot width remains, so this is a regression guard on that outcome, not a fabricated red.
 *
 * Measured off the CartesianGrid's own horizontal line rather than any one bar's position: several
 * of this chart's buckets are gap-filled zeros (only the corpus's real ~10 days carry cache
 * savings), so "the first bar in DOM order" is not reliably the leftmost one on screen — the grid
 * line spans the plot's full width regardless of which buckets happen to hold data.
 */
test("the cache savings chart's Y-axis gutter leaves the plot with real width, not squeezed to nothing", async ({
	page,
}) => {
	await page.goto("/");

	const card = page.locator("text=What caching saved").locator("../..");
	await card.scrollIntoViewIfNeeded();
	const chart = card.locator(".recharts-wrapper").first();
	await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();

	const gridLineBox = await chart.locator(".recharts-cartesian-grid-horizontal line").first().boundingBox();
	const chartBox = await chart.boundingBox();
	if (gridLineBox === null || chartBox === null) throw new Error("the grid line or the chart did not render a bounding box");

	// The plot itself (right of the axis gutter) still gets more than half the card's width.
	expect(gridLineBox.width).toBeGreaterThan(chartBox.width / 2);
});

/**
 * Card #170 Step 7. Today no chart sets a `trigger` prop, so recharts' default `"hover"` applies —
 * a touch tap dispatches touch events, not the mouse-enter/move events hover listens for, so
 * nothing shows. `page.tap()` needs `hasTouch: true`, which only this project's `mobile` config
 * declares (D8). The chart is scrolled into view first — real coordinates matter for a tap, unlike
 * the geometry-only assertions elsewhere in this file. The tooltip is scoped to THIS chart's own
 * wrapper: every `ChartContainer` on the page renders its own `.recharts-tooltip-wrapper`
 * (present but empty until active), so a page-wide selector is ambiguous across all 5 charts.
 */
test("tapping a bar on the cost chart shows its figures at 390px", async ({ page }) => {
	await page.goto("/");

	const chart = page.locator(".recharts-wrapper").first();
	// No scroll here: `tap()` scrolls and retries by itself, whereas touching the DOM before
	// recharts finishes its first width measurement races the SVG children being swapped out.
	const bar = chart.locator(".recharts-bar-rectangles").nth(0).locator(".recharts-bar-rectangle").nth(0);
	await expect(bar).toBeVisible();

	await bar.tap();

	// Page-wide, not scoped to `chart`: the tooltip renders through a portal into `document.body`
	// (D-Step-7, escaping the card's `overflow-hidden`), so it is no longer a DOM descendant of the
	// chart it belongs to. Every chart's tooltip wrapper exists in the DOM even when inactive but
	// empty — `:not(:empty)` finds the one currently showing content, page-wide.
	const tooltip = page.locator(".recharts-tooltip-wrapper:not(:empty)");
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toContainText(MACHINE_IDS[0].slice(0, 8));
});

/**
 * Card #170 Step 7. `chart.tsx:194`'s `ChartTooltipContent` has `min-w-32` and no `max-width`;
 * `card.tsx:15`'s `overflow-hidden` is what clips it. The LAST bucket's bar sits closest to the
 * card's right edge (~294-326px wide at 390px, per the Step 5 investigation's own measurement) —
 * recharts positions the tooltip near the tapped point, so this is where an edge-clip would
 * actually show up, not a contrived position.
 */
test("the tapped bar's tooltip stays within the screen, not cut off by the card edge", async ({ page }) => {
	await page.goto("/");

	const viewportWidth = page.viewportSize()?.width ?? 390;
	const chart = page.locator(".recharts-wrapper").first();
	// No scroll here: `tap()` scrolls and retries by itself, whereas touching the DOM before
	// recharts finishes its first width measurement races the SVG children being swapped out.
	const lastBar = chart.locator(".recharts-bar-rectangles").last().locator(".recharts-bar-rectangle").last();
	await expect(lastBar).toBeVisible();

	await lastBar.tap();

	const tooltip = page.locator(".recharts-tooltip-wrapper:not(:empty)");
	await expect(tooltip).toBeVisible();
	const box = await tooltip.boundingBox();
	if (box === null) throw new Error("the tooltip did not render a bounding box");

	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
});

/**
 * Card #170 Step 7. recharts' click-trigger mode has no built-in tap-outside-to-dismiss — a
 * tapped tooltip otherwise stays pinned open until another bar is tapped, which would leave the
 * operator unable to see the chart underneath without tapping a bar again. Taps a fixed viewport
 * corner (5, 5) via the touchscreen API directly — reliable regardless of scroll position, unlike
 * a named element that could itself have scrolled out of view.
 */
test("tapping outside the chart dismisses its open tooltip", async ({ page }) => {
	await page.goto("/");

	const chart = page.locator(".recharts-wrapper").first();
	// No scroll here: `tap()` scrolls and retries by itself, whereas touching the DOM before
	// recharts finishes its first width measurement races the SVG children being swapped out.
	const bar = chart.locator(".recharts-bar-rectangles").nth(0).locator(".recharts-bar-rectangle").nth(0);
	await expect(bar).toBeVisible();

	await bar.tap();
	const tooltip = page.locator(".recharts-tooltip-wrapper:not(:empty)");
	await expect(tooltip).toBeVisible();

	await page.touchscreen.tap(5, 5);
	await expect(tooltip).toHaveCount(0);
});

/**
 * D13. A touch screen must read a bar's figures by tap, and a pointing device by hover — and
 * recharts 3.8.0 makes those mutually exclusive, so the mode is chosen from the browser's own
 * `(hover: hover)` answer rather than from the viewport width.
 *
 * Asserted on the rendered mode rather than on tapping, deliberately: Chromium synthesises mouse
 * events from a tap, so a tap opens the tooltip in EITHER mode. A tap-based assertion therefore
 * passes whether or not the pointer detection works at all, which makes it no evidence.
 */
test("a touch screen gets the tap-to-read tooltip mode, not the hover one", async ({ page }) => {
	await page.goto("/");

	const chart = page.locator("[data-slot='chart']").first();
	await expect(chart).toHaveAttribute("data-tooltip-trigger", "click");
});
