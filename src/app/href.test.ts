import { expect, test } from "vitest";

import { SplitTab } from "./cost-split-view/cost-split-view.type";
import { RangePreset } from "./range-picker/range-picker.type";
import { SessionSort } from "./session-list/session-list.type";

import { dashboardHref, sessionHref } from "./href";

test("sessionHref builds an encoded /session/:id path", () => {
	expect(sessionHref("abc-123")).toBe("/session/abc-123");
});

test("a dashboard link carries the newly selected preset", () => {
	expect(dashboardHref(new URLSearchParams(), { preset: RangePreset.Last90Days })).toBe("/?preset=90d");
});

test("a dashboard link drops a parameter that carries its default value, so the default view has a clean URL", () => {
	expect(dashboardHref(new URLSearchParams("preset=7d"), { preset: RangePreset.Last30Days })).toBe("/");
});

test("changing the tab leaves the selected window alone, so one control never resets the other", () => {
	const href = dashboardHref(new URLSearchParams("preset=90d"), { tab: SplitTab.Model });

	expect(href).toBe("/?preset=90d&tab=model");
});

test("picking explicit dates replaces the preset, so only one thing describes the window (D37)", () => {
	const href = dashboardHref(new URLSearchParams("preset=90d"), {
		customRange: { fromDay: "2026-07-01", toDay: "2026-07-15" },
	});

	expect(href).toBe("/?from=2026-07-01&to=2026-07-15");
});

test("going back to a preset clears the explicit dates, so the preset click actually changes the window", () => {
	// The parser resolves explicit dates AHEAD of any preset, so leaving from/to behind would make
	// this click do nothing at all.
	const href = dashboardHref(new URLSearchParams("from=2026-07-01&to=2026-07-15"), {
		preset: RangePreset.Last7Days,
	});

	expect(href).toBe("/?preset=7d");
});

test("changing the window clears the session-list page, so nobody lands on an empty page 7 (D34)", () => {
	const href = dashboardHref(new URLSearchParams("preset=90d&page=7"), { preset: RangePreset.Today });

	expect(href).toBe("/?preset=today");
});

test("a session-list page is carried in the link, and page 1 is left out of it", () => {
	expect(dashboardHref(new URLSearchParams(), { page: 3 })).toBe("/?page=3");
	expect(dashboardHref(new URLSearchParams("page=3"), { page: 1 })).toBe("/");
});

test("re-sorting the session list clears the page, since page 7 of one ordering is a different set", () => {
	const href = dashboardHref(new URLSearchParams("page=7"), { sort: SessionSort.Recent });

	expect(href).toBe("/?sort=recent");
});
