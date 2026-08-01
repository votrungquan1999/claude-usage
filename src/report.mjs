import { dedupeAssistantTurns } from "./parser/dedupe.mjs";
import { normalizeModel } from "./parser/models.mjs";
import { turnCost } from "./parser/pricing.mjs";
import { carryCost, contextSize, sessionTotal } from "./parser/session.mjs";

/**
 * Summarise a whole session for the on-demand readout.
 *
 * @param {object[]} records - every record in the transcript
 * @param {number} subagentCost - USD spent by subagents across the session
 * @returns {object}
 */
export function buildReport(records, subagentCost) {
	const turns = dedupeAssistantTurns(records);

	/** @type {Map<string, {model: string, turns: number, cost: number}>} */
	const models = new Map();
	for (const turn of turns) {
		const model = normalizeModel(turn.model);
		const entry = models.get(model) ?? { model, turns: 0, cost: 0 };
		entry.turns += 1;
		entry.cost += turnCost(turn);
		models.set(model, entry);
	}

	return {
		turnCount: turns.length,
		sessionTotal: sessionTotal(turns),
		contextTokens: contextSize(turns),
		carryCost: carryCost(turns),
		byModel: [...models.values()].sort((a, b) => b.cost - a.cost),
		subagentCost,
	};
}
