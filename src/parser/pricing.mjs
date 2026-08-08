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

/**
 * Splits a turn's already-priced cost into carry (re-paying existing context) and new (buying new
 * work) — a residual, not two independently priced halves (card #161 D11): summing three
 * independently-rounded JS expressions misses `costUsd` by ~1e-15 in ~30% of realistic cases, which
 * would make a `toBe()` assertion flaky on fixture choice. `newUsd` is defined as `costUsd - carryUsd`,
 * clamped at zero — the clamp also covers a price-table correction pushing carry above a cost frozen
 * at write time (R35/R36).
 *
 * Not `cacheSavings` — that answers a different question (what caching saved vs. not caching at
 * all); this answers what already-billed dollars were re-paying context vs. buying new work.
 *
 * @param {string} model
 * @param {string} timestamp - ISO-8601 UTC; priced at THIS turn's own rate, never a session average
 * @param {{cacheReadTokens: number, cacheWrite5mTokens: number, cacheWrite1hTokens: number}} tokens
 * @param {number} costUsd - the turn's already-priced total (e.g. from `turnCost`)
 * @returns {{carryUsd: number, newUsd: number}}
 */
export function turnCarrySplit(model, timestamp, tokens, costUsd) {
	const price = priceAt(model, timestamp);
	if (!price) return { carryUsd: 0, newUsd: 0 };

	const carryUsd =
		((tokens.cacheReadTokens * CACHE_READ + tokens.cacheWrite5mTokens * CACHE_WRITE_5M + tokens.cacheWrite1hTokens * CACHE_WRITE_1H) *
			price.input) /
		1_000_000;

	return { carryUsd, newUsd: Math.max(0, costUsd - carryUsd) };
}

/**
 * What caching saved, in USD, on one model's tokens at one point in time.
 *
 * `grossUsd` is the saving from reads alone: a cache read bills at `CACHE_READ` times the base
 * input price, so it saves the rest. `writePremiumUsd` is what populating the cache cost EXTRA —
 * a write bills above the base price, and only that surcharge is attributable to caching.
 *
 * Net is the difference and CAN be negative: a large one-hour write that is barely read back
 * costs more than it saves. Callers must render that as a cost, never clamp it to zero.
 *
 * An unknown model returns all zeros, which is indistinguishable from no cache activity — pair
 * this with `isPricedModel` rather than reading a zero as measured.
 *
 * @param {string} model
 * @param {string} timestamp - ISO-8601 UTC, or a bare `YYYY-MM-DD`; both compare correctly
 * @param {{cacheReadTokens: number, cacheWrite5mTokens: number, cacheWrite1hTokens: number}} tokens
 * @returns {{grossUsd: number, writePremiumUsd: number, netUsd: number}}
 */
export function cacheSavings(model, timestamp, tokens) {
	const price = priceAt(model, timestamp);
	if (!price) return { grossUsd: 0, writePremiumUsd: 0, netUsd: 0 };

	const grossUsd = (tokens.cacheReadTokens * price.input * (1 - CACHE_READ)) / 1_000_000;
	const writePremiumUsd =
		(tokens.cacheWrite5mTokens * price.input * (CACHE_WRITE_5M - 1) +
			tokens.cacheWrite1hTokens * price.input * (CACHE_WRITE_1H - 1)) /
		1_000_000;

	return { grossUsd, writePremiumUsd, netUsd: grossUsd - writePremiumUsd };
}
