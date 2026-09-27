/** Tokens the model can hold, keyed by normalized model id. */
const CONTEXT_WINDOWS = {
	"claude-opus-5-5": 1_000_000,
	"claude-opus-5": 1_000_000,
	"claude-opus-4-8": 1_000_000,
	"claude-opus-4-7": 1_000_000,
	"claude-sonnet-5": 1_000_000,
	"claude-sonnet-4-6": 1_000_000,
	"claude-fable-5-1": 1_000_000,
	"claude-fable-5": 1_000_000,
	"claude-haiku-4-5": 200_000,
};

/**
 * Reduce a model string to its table key.
 *
 * Two suffixes appear in the wild: a context variant (`claude-opus-5[1m]`) and a release
 * date (`claude-haiku-4-5-20251001`). Both must go, or the lookup misses and the model
 * silently prices at $0.
 *
 * @param {string} model
 * @returns {string}
 */
export function normalizeModel(model) {
	return String(model ?? "")
		.replace(/\[.*\]$/, "")
		.replace(/-\d{8}$/, "");
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
