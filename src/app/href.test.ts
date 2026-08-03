import { expect, test } from "vitest";

import { sessionHref } from "./href";

test("sessionHref builds an encoded /session/:id path", () => {
	expect(sessionHref("abc-123")).toBe("/session/abc-123");
});
