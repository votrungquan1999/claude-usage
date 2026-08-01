import { normalizeModel } from "./models.mjs";

/**
 * USD per million tokens, by model, as periods ordered oldest-first.
 *
 * Prices are effective-dated so historical spend keeps the price it was actually billed at —
 * a flat table silently reprices all past usage the moment an introductory rate expires.
 */
const PRICES = {
	"claude-opus-5": [{ from: "", input: 5, output: 25 }],
	"claude-opus-4-8": [{ from: "", input: 5, output: 25 }],
	"claude-opus-4-7": [{ from: "", input: 5, output: 25 }],
	"claude-sonnet-5": [
		{ from: "", input: 2, output: 10 }, // introductory
		{ from: "2026-09-01", input: 3, output: 15 }, // list
	],
	"claude-sonnet-4-6": [{ from: "", input: 3, output: 15 }],
	"claude-fable-5": [{ from: "", input: 10, output: 50 }],
	"claude-haiku-4-5": [{ from: "", input: 1, output: 5 }],
};

/** ISO-8601 UTC strings compare correctly lexicographically. */
function priceAt(model, timestamp) {
	const periods = PRICES[normalizeModel(model)];
	if (!periods) return null;

	let match = null;
	for (const period of periods) {
		if (period.from <= timestamp) match = period;
	}
	return match;
}

/** Cache tiers bill as multiples of the base input price. */
export const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2.0;

/**
 * Whether a cost figure for this model can be trusted.
 *
 * Unknown models cost $0, which reads as "cheap" rather than "unmeasured" — callers use
 * this to render `?` instead. A new model release is exactly when this matters.
 *
 * @param {string} model
 * @returns {boolean}
 */
export function isPricedModel(model) {
	return normalizeModel(model) in PRICES;
}

/**
 * Base input price for a model at a point in time, USD per million tokens.
 *
 * @param {string} model
 * @param {string} timestamp
 * @returns {number} 0 when the model is unknown
 */
export function inputPrice(model, timestamp) {
	return priceAt(model, timestamp)?.input ?? 0;
}

/**
 * What a single turn cost, in USD.
 *
 * @param {import("./dedupe.mjs").Turn} turn
 * @returns {number} USD
 */
export function turnCost(turn) {
	const price = priceAt(turn.model, turn.timestamp);
	if (!price) return 0;

	const usage = turn.usage;
	const creation = usage.cache_creation ?? {};

	const perMillion =
		usage.input_tokens * price.input +
		usage.cache_read_input_tokens * price.input * CACHE_READ +
		(creation.ephemeral_5m_input_tokens ?? 0) * price.input * CACHE_WRITE_5M +
		(creation.ephemeral_1h_input_tokens ?? 0) * price.input * CACHE_WRITE_1H +
		usage.output_tokens * price.output;

	return perMillion / 1_000_000;
}
