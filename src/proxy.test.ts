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

test("an expired session is redirected to /login carrying where it was going, so the view survives signing in again", () => {
	const request = new NextRequest("http://localhost/?preset=90d&tab=model");

	const response = proxy(request);

	expect(response.headers.get("location")).toBe("http://localhost/login?next=%2F%3Fpreset%3D90d%26tab%3Dmodel");
});

test("Next's own _rsc cache-buster is dropped from the carried destination", () => {
	// A client-side navigation appends _rsc. Returning the operator to a URL carrying a stale one
	// would send them somewhere they were never actually looking at.
	const request = new NextRequest("http://localhost/?preset=7d&_rsc=1a2b3c");

	const response = proxy(request);

	expect(response.headers.get("location")).toBe("http://localhost/login?next=%2F%3Fpreset%3D7d");
});
