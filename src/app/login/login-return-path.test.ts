import { expect, test } from "vitest";

import { safeReturnPath } from "./login-return-path";

test("a same-origin path is returned intact, so signing in again lands on the view that expired", () => {
	expect(safeReturnPath("/?preset=90d&tab=model")).toBe("/?preset=90d&tab=model");
});

test("an off-origin destination is refused, however it is disguised (D43)", () => {
	// Each of these passes a naive "starts with a slash" check and still leaves the app.
	expect(safeReturnPath("//evil.com")).toBe("/");
	expect(safeReturnPath("/\\evil.com")).toBe("/");
	expect(safeReturnPath("https://evil.com")).toBe("/");
	expect(safeReturnPath("https:/evil.com")).toBe("/");
	expect(safeReturnPath("javascript:alert(1)")).toBe("/");
	expect(safeReturnPath("")).toBe("/");
});

test("no next parameter lands on the dashboard root", () => {
	expect(safeReturnPath(null)).toBe("/");
});
