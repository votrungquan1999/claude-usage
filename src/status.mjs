import { dedupeAssistantTurns } from "./parser/dedupe.mjs";
import { cacheReadPrice, isPricedModel, turnCost } from "./parser/pricing.mjs";

/** Late enough to be actionable, early enough to still finish a thought. */
const COMPACTION_THRESHOLD = 0.8;

/** Matches the dashboard's own threshold (Step 4) so both signals agree on what "stale" means. */
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// Ordinary clock skew (NTP correction lag, timer coarseness) is seconds, not minutes — 5 minutes
// is generous headroom for that while still catching a real clock jump / snapshot restore /
// hand-edited watermark, which is off by hours or more (card #161 Fix B / R14).
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

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
 * @param {object} [sync] - this machine's own sync watermark, read by the caller (the I/O
 *   boundary) so this function stays pure/synchronous (card #161 D4/D10).
 * @param {string} [sync.lastContactAt] - ISO timestamp of the last successful sync. Absent when
 *   the watermark file is missing or corrupt — treated as "no data yet", never as "stale".
 * @param {Date} [sync.now] - injected rather than read internally, so this stays deterministic.
 * @returns {import("./format.mjs").StatusState}
 */
export function buildStatusState(payload, records, subagentCost = 0, sync = {}) {
	const window = payload.context_window ?? {};
	const contextTokens = window.total_input_tokens ?? 0;
	const model = payload.model?.id ?? "";

	const turns = dedupeAssistantTurns(records);
	const last = turns.at(-1);

	const warnings = warningsFor(turns, contextTokens / (window.context_window_size || Infinity));
	if (isSyncStale(sync)) warnings.push("sync broken");

	return {
		contextTokens,
		contextWindow: window.context_window_size ?? 0,
		turnCost: last ? turnCost(last) : 0,
		subagentCost,
		carryCost: (contextTokens * cacheReadPrice(model, last?.timestamp ?? "")) / 1_000_000,
		priced: isPricedModel(model),
		warnings,
	};
}

/**
 * True when this machine reached the server more than 12h ago. The status line only ever renders
 * while the machine is actively in use, so unlike the dashboard's flag (D10), a stale watermark
 * HERE really does mean broken, not merely idle.
 *
 * @param {object} sync
 * @param {string} [sync.lastContactAt]
 * @param {Date} [sync.now]
 */
function isSyncStale({ lastContactAt, now } = {}) {
	if (!lastContactAt || !now) return false;
	const contactMs = new Date(lastContactAt).getTime();
	if (Number.isNaN(contactMs)) return false;
	const elapsedMs = now.getTime() - contactMs;
	// A future watermark (clock jump, VM snapshot restore, hand-edited file) is not evidence of
	// health — a negative elapsedMs would otherwise always read as "fresh" and silently disable
	// the alarm forever (card #161 R14/R5). Fail loud: treat it as suspect, same as stale — but
	// allow a small tolerance so ordinary clock skew doesn't trip a false alarm.
	if (elapsedMs < -CLOCK_SKEW_TOLERANCE_MS) return true;
	return elapsedMs >= STALE_THRESHOLD_MS;
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
