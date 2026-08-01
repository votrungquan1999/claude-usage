/** Tokens the model can hold, keyed by normalized model id. */
const CONTEXT_WINDOWS = {
	"claude-opus-5": 1_000_000,
	"claude-opus-4-8": 1_000_000,
	"claude-opus-4-7": 1_000_000,
	"claude-sonnet-5": 1_000_000,
	"claude-sonnet-4-6": 1_000_000,
	"claude-fable-5": 1_000_000,
	"claude-haiku-4-5": 200_000,
};

/**
 * Strip the variant suffix Claude Code appends to the model id, e.g. `claude-opus-5[1m]`.
 *
 * @param {string} model
 * @returns {string}
 */
export function normalizeModel(model) {
	return String(model ?? "").replace(/\[.*\]$/, "");
}

/**
 * How many tokens the model can hold.
 *
 * @param {string} model - raw model string, may carry a `[1m]` suffix
 * @returns {number} tokens, 0 when the model is unknown
 */
export function contextWindow(model) {
	return CONTEXT_WINDOWS[normalizeModel(model)] ?? 0;
}
