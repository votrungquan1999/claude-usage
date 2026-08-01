import { dedupeAssistantTurns } from "./parser/dedupe.mjs";
import { CACHE_READ, inputPrice, isPricedModel, turnCost } from "./parser/pricing.mjs";

/** Late enough to be actionable, early enough to still finish a thought. */
const COMPACTION_THRESHOLD = 0.8;

/**
 * Build the status line state from the statusLine payload plus the transcript tail.
 *
 * Context size and window come from the payload — Claude Code reports them authoritatively
 * and for free. The transcript is only needed for the 5m/1h cache split, which the payload
 * omits and which the two cache-write tiers price differently.
 *
 * @param {object} payload - the JSON Claude Code writes to the command's stdin
 * @param {object[]} records - parsed records from the transcript tail
 * @param {number} subagentCost - USD spent by subagents during this turn
 * @returns {import("./format.mjs").StatusState}
 */
export function buildStatusState(payload, records, subagentCost = 0) {
	const window = payload.context_window ?? {};
	const contextTokens = window.total_input_tokens ?? 0;
	const model = payload.model?.id ?? "";

	const turns = dedupeAssistantTurns(records);
	const last = turns.at(-1);

	return {
		contextTokens,
		contextWindow: window.context_window_size ?? 0,
		turnCost: last ? turnCost(last) : 0,
		subagentCost,
		carryCost: (contextTokens * inputPrice(model, last?.timestamp ?? "") * CACHE_READ) / 1_000_000,
		priced: isPricedModel(model),
		warnings: warningsFor(turns, contextTokens / (window.context_window_size || Infinity)),
	};
}

/**
 * Only the conditions worth interrupting for — a wrong warning trains you to ignore the line.
 *
 * @param {import("./parser/dedupe.mjs").Turn[]} turns
 * @param {number} contextFraction - 0..1 of the model's window in use
 * @returns {string[]}
 */
function warningsFor(turns, contextFraction) {
	const warnings = [];
	const last = turns.at(-1);

	if (contextFraction >= COMPACTION_THRESHOLD) warnings.push("compaction near");

	// Skipped on the first turn, where writing the whole prompt to cache is expected.
	if (last && turns.length >= 2) {
		const usage = last.usage;
		if (usage.cache_creation_input_tokens > usage.cache_read_input_tokens) {
			warnings.push("cache miss");
		}
	}

	return warnings;
}
