import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Name of the httpOnly cookie the login route sets and this verifier reads as a fallback. */
export const SESSION_COOKIE = "session";

/**
 * Constant-time compare of a candidate secret against the configured one.
 */
export function matchesConfiguredSecret(candidate: string | undefined): boolean {
	const configured = process.env.CLAUDE_USAGE_SECRET;
	if (!configured || !candidate) return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(configured);
	// timingSafeEqual throws on a length mismatch rather than returning false.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

const SECRET_HEADER = "x-claude-usage-secret";

/**
 * Header wins, cookie is the fallback for in-browser requests.
 */
export function verifySecret(request: NextRequest): boolean {
	const header = request.headers.get(SECRET_HEADER) ?? undefined;
	if (matchesConfiguredSecret(header)) return true;
	const cookie = request.cookies.get(SESSION_COOKIE)?.value;
	return matchesConfiguredSecret(cookie);
}
