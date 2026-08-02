/**
 * @typedef {object} Turn
 * @property {string} requestId
 * @property {string} messageId
 * @property {string} sessionId
 * @property {boolean} isSidechain - Claude Code's own term for "this ran inside a subagent"
 * @property {string} model    - raw model string, may carry a `[1m]` suffix
 * @property {string} timestamp
 * @property {object} usage    - the raw `message.usage` block
 */

/**
 * Collapse the repeated streaming copies Claude Code writes for each assistant message.
 *
 * Keeps the copy with the HIGHEST output_tokens: early copies are written mid-stream and
 * hold partial counts, so taking the first one undercounts output by ~38%.
 *
 * @param {object[]} records - parsed JSONL records, any type
 * @returns {Turn[]} one turn per unique assistant message, in first-seen order
 */
export function dedupeAssistantTurns(records) {
	/** @type {Map<string, Turn>} */
	const best = new Map();

	for (const record of records) {
		if (record?.type !== "assistant") continue;

		const usage = record.message?.usage;
		if (!usage) continue;

		const key = `${record.requestId} ${record.message.id}`;
		const seen = best.get(key);
		if (seen && usage.output_tokens <= seen.usage.output_tokens) continue;

		best.set(key, {
			requestId: record.requestId,
			messageId: record.message.id,
			sessionId: record.sessionId,
			isSidechain: record.isSidechain,
			model: record.message.model,
			timestamp: record.timestamp,
			usage,
		});
	}

	return [...best.values()];
}
