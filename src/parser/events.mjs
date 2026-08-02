import { accountFor } from "./account-ledger.mjs";
import { isPricedModel, turnCost } from "./pricing.mjs";

/**
 * One assistant message's token usage, as stored. Aggregates only — no transcript content
 * ever reaches this shape.
 *
 * Keep in sync with `UsageEventDocument` in `src/server/usage-store.ts` — this module cannot
 * import it (tsconfig excludes `src/parser`), so nothing else enforces the two staying aligned.
 *
 * @typedef {object} MappedUsageEvent
 * @property {string} requestId
 * @property {string} messageId
 * @property {string} sessionId
 * @property {string} projectSlug
 * @property {string} machineId
 * @property {string} [repoKey] - opaque hash of the normalized git remote (D20); absent, not
 *   null, when the project directory's cwd isn't a git repo, or no longer exists — never
 *   fabricated as a name-based guess
 * @property {string} [accountUuid] - absent, not null, when the session predates the ledger (D7)
 * @property {string} [orgUuid]
 * @property {string} model         - raw, not normalized — grouping happens at query time
 * @property {Date} timestamp
 * @property {number} inputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWrite5mTokens
 * @property {number} cacheWrite1hTokens
 * @property {number} outputTokens
 * @property {number} costUsd
 * @property {boolean} priced - whether costUsd is trustworthy: false when the model is unpriced
 *   OR the timestamp is missing (never means "free")
 * @property {boolean} isSubagent
 */

/**
 * Turn one deduped turn into a storable usage event. Pure: no fs, no fetch — every per-file
 * or per-run value (project identity, machine, account history) is supplied by the caller,
 * never read here.
 *
 * @param {import("./dedupe.mjs").Turn} turn
 * @param {object} context
 * @param {string} context.projectSlug - resolved once per project directory (Step 5), not per turn
 * @param {string} context.machineId
 * @param {string} [context.repoKey] - resolved once per project directory (D20), not per turn;
 *   absent, not null, when the project directory's cwd isn't a git repo or no longer exists
 * @param {Record<string, import("./account-ledger.mjs").AccountEntry[]>} context.accountLedger
 * @returns {MappedUsageEvent | null} null when the turn is a placeholder that must never be
 *   stored as spend — callers map over an array of turns and filter out the nulls
 */
export function mapTurnToEvent(turn, { projectSlug, machineId, repoKey, accountLedger }) {
	// Claude Code writes zero-usage "<synthetic>" turns for errors/interruptions; the
	// requestId check is a defensive invariant guard (vacuous on today's data — every
	// non-synthetic record already carries a requestId — but cheap to keep for a future
	// Claude Code version that renames or drops the marker).
	if (turn.model === "<synthetic>" || !turn.requestId) return null;

	const usage = turn.usage;
	const creation = usage.cache_creation ?? {};
	const account = accountFor(accountLedger, turn.sessionId, turn.timestamp);

	return {
		requestId: turn.requestId,
		messageId: turn.messageId,
		sessionId: turn.sessionId,
		projectSlug,
		machineId,
		...(repoKey !== undefined && { repoKey }),
		...(account && { accountUuid: account.accountUuid, orgUuid: account.orgUuid }),
		model: turn.model,
		timestamp: new Date(turn.timestamp),
		inputTokens: usage.input_tokens,
		cacheReadTokens: usage.cache_read_input_tokens,
		cacheWrite5mTokens: creation.ephemeral_5m_input_tokens ?? 0,
		cacheWrite1hTokens: creation.ephemeral_1h_input_tokens ?? 0,
		outputTokens: usage.output_tokens,
		costUsd: turnCost(turn),
		// "Trustworthy cost", not "known model name": false whenever costUsd cannot be trusted —
		// an unpriced model, or a missing timestamp (priceAt needs one to pick the right period).
		priced: isPricedModel(turn.model) && Boolean(turn.timestamp),
		isSubagent: turn.isSidechain,
	};
}
