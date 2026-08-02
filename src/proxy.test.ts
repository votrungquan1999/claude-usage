import { NextRequest } from "next/server";
import { beforeAll, expect, test } from "vitest";

import { config, proxy } from "./proxy";

const SECRET = "proxy-test-secret";

beforeAll(() => {
	process.env.CLAUDE_USAGE_SECRET = SECRET;
});

test("a cookieless request to a gated page is redirected to /login", () => {
	const request = new NextRequest("http://localhost/");

	const response = proxy(request);

	expect(response.status).toBe(307);
	expect(response.headers.get("location")).toBe("http://localhost/login");
});

test("a request carrying the valid session cookie passes through", () => {
	const request = new NextRequest("http://localhost/", {
		headers: { cookie: `session=${SECRET}` },
	});

	const response = proxy(request);

	expect(response.status).toBe(200);
	// NextResponse.next() marks itself with this internal header.
	expect(response.headers.get("x-middleware-next")).toBe("1");
});

test("the matcher gates everything except /login, /api/*, and Next's framework-internal paths", () => {
	expect(config.matcher).toEqual(["/((?!login|api|_next/static|_next/image|favicon.ico).*)"]);
});
