import { type NextRequest, NextResponse } from "next/server";

import { verifySecret } from "@/app/api/lib/verify-secret";

/**
 * Gates the dashboard on the shared-secret session cookie. Next 16 always runs proxy.ts on
 * Node, so this can share the exact constant-time verifier the API routes use — there is no
 * edge-runtime reason to fork the comparison the way an edge-era proxy would have.
 */
export function proxy(request: NextRequest): NextResponse {
	if (verifySecret(request)) return NextResponse.next();

	const loginUrl = new URL("/login", request.url);
	// Carry the whole view — the window and the active split both live in the query string, so a
	// bare pathname would still lose everything the operator was looking at.
	const destination = requestedPath(request);
	if (destination !== "/") loginUrl.searchParams.set("next", destination);

	return NextResponse.redirect(loginUrl);
}

/**
 * Where the request was headed, as a same-origin path. Next's own `_rsc` cache-buster is dropped:
 * a client-side navigation adds it, and returning the operator to a URL carrying one stale value
 * would be sending them somewhere they never actually were.
 *
 * @param request - the request the proxy is turning away
 */
function requestedPath(request: NextRequest): string {
	const params = new URLSearchParams(request.nextUrl.search);
	params.delete("_rsc");

	const query = params.toString();
	return query === "" ? request.nextUrl.pathname : `${request.nextUrl.pathname}?${query}`;
}

export const config = {
	matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
