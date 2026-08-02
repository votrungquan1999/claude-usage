import { type NextRequest, NextResponse } from "next/server";

import { matchesConfiguredSecret, SESSION_COOKIE } from "@/app/api/lib/verify-secret";

interface AuthBody {
	secret?: unknown;
	action?: unknown;
}

/**
 * Logs the operator in with the shared secret (setting the httpOnly session cookie the proxy
 * and sync route both check) or signs them out (clearing it). The cookie IS the session — there
 * is no server-side store, so clearing it is the entire logout.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	let body: AuthBody;
	try {
		body = (await request.json()) as AuthBody;
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	if (typeof body !== "object" || body === null) {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	const secure = process.env.NODE_ENV === "production";

	if (body.action === "logout") {
		const response = NextResponse.json({ ok: true }, { status: 200 });
		response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
		return response;
	}

	const secret = typeof body.secret === "string" ? body.secret : undefined;
	if (!matchesConfiguredSecret(secret)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const response = NextResponse.json({ ok: true }, { status: 200 });
	response.cookies.set(SESSION_COOKIE, secret as string, {
		httpOnly: true,
		secure,
		sameSite: "lax",
		path: "/",
	});
	return response;
}
