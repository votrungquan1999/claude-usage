import { expect, test } from "vitest";

import { CostSplitDimension } from "@/server/usage-queries";

import { decodeSplitValue, parseSplitDimension } from "./split-params";

test("a split segment outside the allowlist is refused, including keys inherited from Object", () => {
	expect(parseSplitDimension("project")?.dimension).toBe(CostSplitDimension.Project);

	// The segment picks the field an aggregation groups by, so this is the same boundary `?tab=`
	// guards — except a path names a resource, so an unknown one is a 404 rather than a fallback.
	expect(parseSplitDimension("accountUuid")).toBeUndefined();
	// A plain object lookup would answer this one with Object.prototype's own member.
	expect(parseSplitDimension("constructor")).toBeUndefined();
});

test("a value segment is decoded, and a malformed one is refused rather than throwing", () => {
	// Next hands the segment over still encoded, so a project slug arrives with its slash escaped.
	expect(decodeSplitValue("personal%2Flms")).toBe("personal/lms");
	// encodeURIComponent leaves parentheses alone, so the unattributed bucket round-trips as-is.
	expect(decodeSplitValue("(unattributed)")).toBe("(unattributed)");
	// A lone % is not a valid escape; decoding it throws, which would be a 500 for a bad URL.
	expect(decodeSplitValue("%")).toBeUndefined();
});
