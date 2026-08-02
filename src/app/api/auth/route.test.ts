import { NextRequest } from "next/server";
import { afterEach, expect, test } from "vitest";

import { POST } from "./route";

const SECRET = "auth-route-test-secret";

afterEach(() => {
	delete process.env.CLAUDE_USAGE_SECRET;
});

function authRequest(body: unknown): NextRequest {
	return new NextRequest("http://localhost/api/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

test("logging in with the correct secret returns 200 and sets the httpOnly session cookie", async () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	const response = await POST(authRequest({ secret: SECRET }));

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
	const setCookie = response.headers.get("set-cookie") ?? "";
	expect(setCookie).toContain(`session=${SECRET}`);
	expect(setCookie).toContain("HttpOnly");
	expect(setCookie).toContain("Path=/");
	expect(setCookie).toContain("SameSite=lax");
	// No maxAge — a browser-session cookie that survives reloads but not a closed browser.
	expect(setCookie).not.toMatch(/Max-Age/i);
});

test("logging in with an incorrect secret returns 401 and sets no cookie", async () => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;

	const response = await POST(authRequest({ secret: "wrong-secret" }));

	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ error: "Unauthorized" });
	expect(response.headers.get("set-cookie")).toBeNull();
});

test("a malformed JSON body is a 400, not a crash", async () => {
	const request = new NextRequest("http://localhost/api/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "not json",
	});

	const response = await POST(request);

	expect(response.status).toBe(400);
});

test("signing out clears the session cookie", async () => {
	const response = await POST(authRequest({ action: "logout" }));

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
	const setCookie = response.headers.get("set-cookie") ?? "";
	// Same Path as login's Set-Cookie, or the browser treats them as different cookies and
	// logout silently fails to clear the one the proxy checks.
	expect(setCookie).toContain("session=;");
	expect(setCookie).toContain("Path=/");
	expect(setCookie).toMatch(/Max-Age=0/i);
});

test("a JSON body that parses to null is a 400, not a crash", async () => {
	const request = new NextRequest("http://localhost/api/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "null",
	});

	const response = await POST(request);

	expect(response.status).toBe(400);
});
