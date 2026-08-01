import { CACHE_READ, inputPrice, turnCost } from "./pricing.mjs";

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
	const last = turns.at(-1);
	if (!last) return 0;

	return (contextSize(turns) * inputPrice(last.model, last.timestamp) * CACHE_READ) / 1_000_000;
}

/**
 * How much context the model is carrying right now.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns - deduped turns in chronological order
 * @returns {number} tokens
 */
export function contextSize(turns) {
	const last = turns.at(-1);
	if (!last) return 0;

	// Everything the model re-read this turn — uncached, freshly cached, and cache hits.
	// NOT a sum across turns: that gives cumulative usage, which is ~15x larger.
	return (
		last.usage.input_tokens +
		last.usage.cache_creation_input_tokens +
		last.usage.cache_read_input_tokens
	);
}
