/**
 * @typedef {object} Turn
 * @property {string} requestId
 * @property {string} messageId
 * @property {string} sessionId
 * @property {boolean} isSidechain - Claude Code's own term for "this ran inside a subagent"
 * @property {string} model    - raw model string, may carry a `[1m]` suffix
 * @property {string} timestamp
 * @property {object} usage    - the raw `message.usage` block
 * @property {string} [cwd]    - the directory this turn ran in, as Claude Code recorded it
 * @property {string[]} filePaths - absolute paths this turn's tool calls read or wrote; the
 *   signal that attributes a turn to a repository when `cwd` is a parent directory holding many
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
			cwd: record.cwd,
			filePaths: toolFilePaths(record.message.content),
		});
	}

	return [...best.values()];
}

/** Tool inputs naming a single file. Deliberately excludes Glob/Grep's `path`, which names a
 * search root rather than a file touched — usually the very parent directory this is meant to
 * see past. */
const FILE_PATH_INPUTS = ["file_path", "notebook_path"];

/**
 * The absolute paths one assistant message's tool calls read or wrote, in the order issued.
 *
 * @param {unknown} content - the message's `content`, which is a string on a plain text reply
 * @returns {string[]} paths, possibly empty
 */
function toolFilePaths(content) {
	if (!Array.isArray(content)) return [];

	const paths = [];
	for (const block of content) {
		if (block?.type !== "tool_use") continue;
		const input = block.input ?? {};
		for (const field of FILE_PATH_INPUTS) {
			if (typeof input[field] === "string") paths.push(input[field]);
		}
	}
	return paths;
}
