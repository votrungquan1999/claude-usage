/**
 * Builds the link to a session's drill-down page. The one place this URL shape is constructed —
 * every caller (the session lookup form now, the session list later) imports this instead of
 * hand-building the path.
 *
 * @param sessionId - the session identifier to link to
 */
export function sessionHref(sessionId: string): string {
	return `/session/${encodeURIComponent(sessionId)}`;
}
