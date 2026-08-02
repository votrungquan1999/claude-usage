import { NextRequest } from "next/server";
import { afterEach, expect, test } from "vitest";

import { matchesConfiguredSecret, verifySecret } from "./verify-secret";

const SECRET = "verify-secret-test-value";

afterEach(() => {
	delete process.env.CLAUDE_USAGE_SECRET;
});

test("matches only the exact configured secret", () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	expect(matchesConfiguredSecret(SECRET)).toBe(true);
	expect(matchesConfiguredSecret("wrong-value")).toBe(false);
});

test("is fail-closed without throwing: no candidate, no configured secret, and a length mismatch all return false", () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;
	expect(matchesConfiguredSecret(undefined)).toBe(false);
	// A shorter/longer candidate would make node:crypto's timingSafeEqual throw if compared
	// directly — the length check must short-circuit before that call.
	expect(matchesConfiguredSecret("short")).toBe(false);

	delete process.env.CLAUDE_USAGE_SECRET;
	expect(matchesConfiguredSecret(SECRET)).toBe(false);
});

function requestWith(headers: Record<string, string>): NextRequest {
	return new NextRequest("http://localhost/api/sync", { headers });
}

test("verifySecret authenticates via the header", () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	expect(verifySecret(requestWith({ "x-claude-usage-secret": SECRET }))).toBe(true);
});

test("verifySecret falls back to the session cookie when the header is absent", () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	expect(verifySecret(requestWith({ cookie: `session=${SECRET}` }))).toBe(true);
});

test("verifySecret prefers a correct header over a simultaneously wrong cookie", () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	expect(
		verifySecret(requestWith({ "x-claude-usage-secret": SECRET, cookie: "session=wrong-cookie-value" })),
	).toBe(true);
});
