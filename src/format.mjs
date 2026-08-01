/**
 * @typedef {object} StatusState
 * @property {number} contextTokens
 * @property {number} contextWindow
 * @property {number} turnCost
 * @property {number} subagentCost
 * @property {number} carryCost
 * @property {boolean} priced      - false when a model has no known price
 * @property {string[]} warnings
 */

/**
 * Render the one-line status readout.
 *
 * @param {StatusState} state
 * @returns {string}
 */
export function formatStatusLine(state) {
	const pct = (state.contextTokens / state.contextWindow) * 100;

	const parts = [
		`${gauge(pct)} ${pct.toFixed(1)}% (${tokens(state.contextTokens)}/${tokens(state.contextWindow)})`,
		`turn ${money(state.turnCost, state.priced)}${subagent(state)}`,
		`carry ${money(state.carryCost, state.priced)}/turn`,
	];

	for (const warning of state.warnings) parts.push(`⚠ ${warning}`);

	return parts.join(" · ");
}

/** Shown separately so subagent spend is never mistaken for the main turn's cost. */
function subagent(state) {
	if (!state.subagentCost) return "";
	return ` (+${money(state.subagentCost, state.priced)} sub)`;
}

/** Fills as context climbs, so the line is readable without reading the number. */
function gauge(pct) {
	if (pct < 12.5) return "○";
	if (pct < 37.5) return "◔";
	if (pct < 62.5) return "◐";
	if (pct < 87.5) return "◕";
	return "●";
}

function tokens(count) {
	if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
	return String(count);
}

/** `?` rather than `$0.00` when a model has no known price — see isPricedModel. */
function money(amount, priced) {
	return priced ? `$${amount.toFixed(2)}` : "$?";
}
