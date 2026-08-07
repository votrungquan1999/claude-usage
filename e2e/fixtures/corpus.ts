import type { UsageEventDocument } from "../../src/server/usage-store";

/**
 * The fabricated corpus every e2e assertion is written against.
 *
 * Shaped, not merely present. A fixture that renders *something* lets a pager test pass while
 * asserting nothing, so this deliberately carries more than one page of sessions, more than one
 * value on every split dimension, and both repo-attributed and repo-less spend.
 */

/** 30 sessions against a 25-row page — so paging forward has somewhere to go, and page 2 has 5. */
export const SESSION_COUNT = 30;

/** Session N costs N × $0.25. Multiples of 0.25 are exact in binary, so the total is exact too
 * and the assertions can be literal strings rather than tolerances. */
const COST_STEP_USD = 0.25;

/** $0.25 × (1 + 2 + … + 30) = $0.25 × 465. */
export const TOTAL_COST_USD = 116.25;

/** Session 30 is the priciest at $7.50, so it leads the default "most expensive" ordering. */
export const MOST_EXPENSIVE_SESSION_ID = "e2e-session-30";

/** Spread over 10 days, all comfortably inside the 30-day default window. */
const DAY_SPAN = 10;

export const PROJECT_SLUGS = ["personal/claude-usage", "personal/ai-kanban", "personal/lms"];
export const MACHINE_IDS = ["e2e-macbook", "e2e-studio"];
export const MODELS = ["claude-opus-5", "claude-sonnet-5"];

/** Only the first project carries one, so the Repo tab shows a real repository AND the
 * `(unattributed)` bucket that the other two collapse into. */
const REPO_KEY = "e2e00000000000000000000000000000000000000000000000000000000beef";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Builds the corpus relative to a supplied "now".
 *
 * Each event sits a whole number of days BEFORE `now`, which puts it on the right calendar date in
 * every timezone at once — no offset arithmetic, and nothing near a boundary where the UTC day and
 * the dashboard's UTC+7 day disagree about which date an event belongs to.
 *
 * The day-zero events land on `now` itself rather than at a fixed hour, and that is the point: a
 * fixed clock time is in the FUTURE for part of every day, and the dashboard clamps every window
 * to `[earliest, now]`. Seeding today at 03:00 UTC made the whole suite fail between 00:00 and
 * 03:00 UTC — three sessions silently outside the window, on a fixture whose figures are asserted
 * as exact literals.
 *
 * @param now - the instant the window is measured back from
 */
export function buildCorpus(now: Date): UsageEventDocument[] {
	const events: UsageEventDocument[] = [];

	for (let n = 1; n <= SESSION_COUNT; n++) {
		const daysAgo = (n - 1) % DAY_SPAN;
		const day = new Date(now.getTime() - daysAgo * MILLISECONDS_PER_DAY);

		const projectIndex = (n - 1) % PROJECT_SLUGS.length;
		const sessionId = `e2e-session-${String(n).padStart(2, "0")}`;

		events.push({
			requestId: `e2e-req-${n}`,
			messageId: `e2e-msg-${n}`,
			sessionId,
			projectSlug: PROJECT_SLUGS[projectIndex],
			machineId: MACHINE_IDS[(n - 1) % MACHINE_IDS.length],
			// Absent, not null, for the projects meant to land in the unattributed bucket.
			...(projectIndex === 0 ? { repoKey: REPO_KEY } : {}),
			model: MODELS[(n - 1) % MODELS.length],
			timestamp: day,
			inputTokens: 1_000,
			cacheReadTokens: 100_000,
			cacheWrite5mTokens: 10_000,
			cacheWrite1hTokens: 0,
			outputTokens: 2_000,
			costUsd: n * COST_STEP_USD,
			// Every event is priced, so no figure renders as a lower bound and the assertions stay
			// exact strings. The unpriced path has its own coverage in the server suite.
			priced: true,
			isSubagent: n % 5 === 0,
		});
	}

	return events;
}
