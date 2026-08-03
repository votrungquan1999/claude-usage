import { expect, test } from "vitest";

import { SplitTab } from "./cost-split-view/cost-split-view.type";
import { RangePreset } from "./range-picker/range-picker.type";

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
