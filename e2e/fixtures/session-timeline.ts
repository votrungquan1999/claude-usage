import type { UsageEventDocument } from "../../src/server/usage-store";

/**
 * F2's own isolated fixture (card #161 D12) — separate from `e2e/fixtures/corpus.ts` so no
 * existing spec's literal totals can move. `corpus.ts` seeds one event per session with tokens
 * unrelated to `costUsd`, which is exactly why a carry/new split cannot be asserted against it
 * (INVESTIGATION_STEP_9.md) — this fixture's turns are priced so `carryUsd + newUsd === costUsd`
 * exactly, verified against the real pricing formulas before being fixed here.
 */

/** Outside `corpus.ts`'s `e2e-session-NN` numbering, so it can never collide with it. Not
 * exported — `session-timeline.spec.ts` hardcodes this id as its own literal, matching
 * `machine-sync.spec.ts`'s precedent of importing nothing from its fixture module at all. */
const SESSION_TIMELINE_SESSION_ID = "e2e-timeline-session";

/** `claude-opus-5` has one flat pricing period — no `claude-sonnet-5`-style effective-dated
 * reprice to account for, the simplest model for hand-computed literals. */
const MODEL = "claude-opus-5";

/**
 * More than 30 days before "now" clears every windowed literal the rest of the suite asserts
 * (`corpus.spec`/`splits.spec`/`window.spec`/`sessions.spec`/`drilldown.spec` all assert only
 * inside a <=30-day window) — including the repo-split "(unattributed)" catch-all, which an
 * in-window session without a `repoKey` would inflate regardless of machine/project choice
 * (INVESTIGATION_STEP_9.md). `getSessionTurns`/`getSessionBreakdown` are unwindowed
 * (`$match: {sessionId}` only), so this placement does not affect reachability by direct URL.
 */
const DAYS_BEFORE_NOW = 400;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const PRICE_PER_MILLION_INPUT = 5;
const PRICE_PER_MILLION_OUTPUT = 25;
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2.0;

/** One turn's raw token counts, before `costUsd` is derived from them. */
interface TurnTokens {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
	outputTokens: number;
	isSubagent: boolean;
}

/**
 * Six turns — four main, two subagent. `turnCount` (6) is <= `MAX_CHART_BARS` (20), so
 * `planTurnBuckets` gives each turn its OWN bucket ("Turn 1".."Turn 6") — a chart with a real
 * shape, never a single bar. Every pair below was chosen so neither of a turn's own carry/new
 * literals is a substring of the other (e.g. never 0.04 vs 0.045), so an e2e assertion checking
 * for one cannot pass on account of the other.
 */
const TURNS: TurnTokens[] = [
	// Turn 1 (main): carryUsd=0.04, newUsd=0.06
	{ inputTokens: 2_000, cacheReadTokens: 80_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 2_000, isSubagent: false },
	// Turn 2 (main): carryUsd=0.09, newUsd=0.02
	{ inputTokens: 2_000, cacheReadTokens: 0, cacheWrite5mTokens: 14_400, cacheWrite1hTokens: 0, outputTokens: 400, isSubagent: false },
	// Turn 3 (subagent): carryUsd=0.03, newUsd=0.05
	{ inputTokens: 6_000, cacheReadTokens: 60_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 800, isSubagent: true },
	// Turn 4 (main): carryUsd=0 (no cache tokens at all), newUsd=0.07
	{ inputTokens: 4_000, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 2_000, isSubagent: false },
	// Turn 5 (main): carryUsd=0.08, newUsd=0.03
	{ inputTokens: 1_000, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 8_000, outputTokens: 1_000, isSubagent: false },
	// Turn 6 (subagent): carryUsd=0.05, newUsd=0.01
	{ inputTokens: 1_000, cacheReadTokens: 40_000, cacheWrite5mTokens: 4_800, cacheWrite1hTokens: 0, outputTokens: 200, isSubagent: true },
];

/**
 * Mirrors `turnCost` (`src/parser/pricing.mjs`) exactly, so the stored `costUsd` genuinely
 * reconciles with the tokens above rather than being an unrelated hand-picked number, the way
 * `corpus.ts`'s `n × $0.25` is. Not imported from `pricing.mjs` directly — this fixture is
 * deliberately standalone (D12's isolation), and the formula is pinned to `claude-opus-5`'s one
 * flat period, so it cannot drift from the real one silently.
 *
 * @param tokens - one turn's raw token counts
 * @returns the turn's cost in USD, exact per the same arithmetic `turnCost` performs
 */
function costForTurn(tokens: TurnTokens): number {
	const perMillion =
		tokens.inputTokens * PRICE_PER_MILLION_INPUT +
		tokens.cacheReadTokens * PRICE_PER_MILLION_INPUT * CACHE_READ_MULTIPLIER +
		tokens.cacheWrite5mTokens * PRICE_PER_MILLION_INPUT * CACHE_WRITE_5M_MULTIPLIER +
		tokens.cacheWrite1hTokens * PRICE_PER_MILLION_INPUT * CACHE_WRITE_1H_MULTIPLIER +
		tokens.outputTokens * PRICE_PER_MILLION_OUTPUT;
	return perMillion / 1_000_000;
}

/**
 * Builds the isolated multi-turn session fixture, relative to a supplied "now" — same discipline
 * as `corpus.ts`'s `buildCorpus`: a fixed clock time would drift the placement in/out of "more
 * than 30 days ago" across runs.
 *
 * @param now - the instant this fixture's placement is measured back from
 */
export function buildSessionTimelineFixture(now: Date): UsageEventDocument[] {
	const placement = new Date(now.getTime() - DAYS_BEFORE_NOW * MILLISECONDS_PER_DAY);

	return TURNS.map((turn, index) => ({
		requestId: `e2e-timeline-req-${index + 1}`,
		messageId: `e2e-timeline-msg-${index + 1}`,
		sessionId: SESSION_TIMELINE_SESSION_ID,
		projectSlug: "personal/claude-usage-timeline",
		machineId: "e2e-timeline-machine",
		model: MODEL,
		// A minute apart so ordering is unambiguous; all still comfortably >30 days ago.
		timestamp: new Date(placement.getTime() + index * 60_000),
		inputTokens: turn.inputTokens,
		cacheReadTokens: turn.cacheReadTokens,
		cacheWrite5mTokens: turn.cacheWrite5mTokens,
		cacheWrite1hTokens: turn.cacheWrite1hTokens,
		outputTokens: turn.outputTokens,
		costUsd: costForTurn(turn),
		priced: true,
		isSubagent: turn.isSubagent,
	}));
}
