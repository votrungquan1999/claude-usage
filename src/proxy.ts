import { type NextRequest, NextResponse } from "next/server";

import { verifySecret } from "@/app/api/lib/verify-secret";

/**
 * Gates the dashboard on the shared-secret session cookie. Next 16 always runs proxy.ts on
 * Node, so this can share the exact constant-time verifier the API routes use — there is no
 * edge-runtime reason to fork the comparison the way an edge-era proxy would have.
 */
export function proxy(request: NextRequest): NextResponse {
	if (verifySecret(request)) return NextResponse.next();
	return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
	matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
