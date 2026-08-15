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
 * @property {string} [repoKey] - opaque hash of the normalized git remote (D20), resolved per
 *   TURN; absent, not null, when nothing about the turn or its project directory resolved a
 *   repository — never fabricated as a name-based guess
 * @property {string} [repoName] - `<parent>/<name>` of the repository's MAIN checkout, so a busy
 *   worktree cannot take the repository's name (card #177). Same two-segment shape as
 *   `projectSlug`, and absent for the same reasons `repoKey` is
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
 * @param {string} context.projectSlug - this TURN's attribution, from `attributeTurns`; falls back
 *   to the project directory's own slug when the turn offered no evidence of its own
 * @param {string} context.machineId
 * @param {string} [context.repoKey] - this TURN's repository (D20); absent, not null, when neither
 *   the turn nor the project directory resolved one — never fabricated as a name-based guess
 * @param {string} [context.repoName] - that repository's MAIN checkout name (card #177); absent
 *   when no repository resolved, or when it has no main checkout to be named after
 * @param {Record<string, import("./account-ledger.mjs").AccountEntry[]>} context.accountLedger
 * @returns {MappedUsageEvent | null} null when the turn is a placeholder that must never be
 *   stored as spend — callers map over an array of turns and filter out the nulls
 */
/**
 * The session's display name, as Claude Code recorded it.
 *
 * Lives in its OWN `ai-title` record rather than on any assistant turn, and is rewritten as the
 * session develops — so the last one is the current one.
 *
 * This is the one field here derived from conversation CONTENT rather than counts. It is uploaded
 * deliberately; `lastPrompt`, which sits in the same transcripts and holds raw prompt text, is not
 * and must never be.
 *
 * @param {object[]} records - every record read from the transcript, not just assistant turns
 * @returns {string|undefined} the latest title, or undefined when the transcript carries none
 */
export function resolveSessionTitle(records) {
	let title;
	for (const record of records) {
		// Empty titles are skipped rather than accepted: a blank one would win over a real earlier
		// title and render as an empty name column.
		if (record?.type === "ai-title" && typeof record.aiTitle === "string" && record.aiTitle !== "") {
			title = record.aiTitle;
		}
	}
	return title;
}

export function mapTurnToEvent(turn, { projectSlug, machineId, repoKey, repoName, accountLedger, sessionTitle }) {
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
		...(repoName !== undefined && { repoName }),
		// Spread in only when known, like repoKey: the store puts unlisted fields in $set, so
		// sending it as undefined would erase a title an earlier sync already recorded.
		...(sessionTitle !== undefined && { sessionTitle }),
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
