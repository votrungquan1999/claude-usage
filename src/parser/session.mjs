import { cacheReadPrice, turnCost } from "./pricing.mjs";

/**
 * What the whole session has cost so far, in USD.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns - deduped turns
 * @returns {number} USD
 */
export function sessionTotal(turns) {
	return turns.reduce((total, turn) => total + turnCost(turn), 0);
}

/**
 * What the next turn costs before you type anything — the context re-read as a cache hit.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns - deduped turns
 * @returns {number} USD per turn
 */
export function carryCost(turns) {
	const last = lastRealTurn(turns);
	if (!last) return 0;

	return (contextSize(turns) * cacheReadPrice(last.model, last.timestamp)) / 1_000_000;
}

/**
 * How much context the model is carrying right now.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns - deduped turns in chronological order
 * @returns {number} tokens
 */
export function contextSize(turns) {
	const last = lastRealTurn(turns);
	if (!last) return 0;

	// Everything the model re-read this turn — uncached, freshly cached, and cache hits.
	// NOT a sum across turns: that gives cumulative usage, which is ~15x larger.
	return (
		last.usage.input_tokens +
		last.usage.cache_creation_input_tokens +
		last.usage.cache_read_input_tokens
	);
}

/**
 * The most recent turn that isn't an API-error placeholder.
 *
 * Claude Code appends an all-zero-usage `<synthetic>` turn after an API error (observed trailing
 * runs up to 2 long), which would otherwise be read as "the last turn" right when the real
 * context/cost matters most.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns
 * @returns {import("./dedupe.mjs").Turn|undefined}
 */
function lastRealTurn(turns) {
	for (let i = turns.length - 1; i >= 0; i--) {
		if (turns[i].model !== "<synthetic>") return turns[i];
	}
	return undefined;
}
