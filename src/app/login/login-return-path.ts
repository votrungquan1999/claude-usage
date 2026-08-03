/** Where an operator lands after signing in when the URL names nowhere to go back to. */
const DASHBOARD_ROOT = "/";

/**
 * The path to return to after a successful sign-in, or the dashboard root when the URL's `next`
 * value is absent or is not a same-origin path (D43).
 *
 * `next` is attacker-controllable and is reflected into a navigation, so this is a security
 * boundary rather than input tidying. The obvious "starts with a slash" check is NOT enough: it
 * accepts `//evil.com`, which browsers read as protocol-relative, and `/\evil.com`, where the
 * backslash is normalised to a slash and produces the same thing.
 *
 * @param raw - the `next` parameter's value, or `null` when absent
 */
export function safeReturnPath(raw: string | null): string {
	if (raw === null) return DASHBOARD_ROOT;
	// One leading slash, and the next character must not be another slash or a backslash — that
	// pair is what turns a "path" into an authority, and so into a different origin.
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return DASHBOARD_ROOT;
	return raw;
}
