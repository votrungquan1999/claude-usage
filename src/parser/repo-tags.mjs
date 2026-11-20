import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { lastTwoSegments } from "./project.mjs";
import { resolveRepoAt } from "./repo.mjs";

/**
 * One repository a session worked in.
 *
 * @typedef {object} RepoTag
 * @property {string} key - the opaque remote hash, the same value stored as `repoKey`
 * @property {string} name - `<parent>/<name>` of the repository's main checkout
 */

/**
 * Pass records through unchanged while collecting the folders they show work in.
 *
 * @param {Iterable<object>} records - raw transcript records, any type
 * @param {Set<string>} dirs - filled in place
 * @yields {object} each record, unchanged
 */
export function* tapEvidenceDirs(records, dirs) {
	for (const record of records) {
		if (typeof record?.cwd === "string") dirs.add(record.cwd);
		const content = record?.message?.content;
		if (Array.isArray(content)) {
			for (const block of content) {
				const file = block?.input?.file_path ?? block?.input?.notebook_path;
				// Relative paths are read against the folder the call ran in, as the tool itself did.
				if (block?.type === "tool_use" && typeof file === "string") dirs.add(dirname(resolve(record.cwd ?? "/", file)));
			}
		}
		yield record;
	}
}

/**
 * The distinct repositories behind a set of folders.
 *
 * @param {Iterable<string>} dirs - absolute folder paths
 * @param {(dir: string) => import("./repo.mjs").ResolvedRepo|undefined} [lookup]
 * @returns {RepoTag[]}
 */
export function resolveRepoTags(dirs, lookup = resolveRepoAt) {
	/** @type {Map<string, RepoTag>} */
	const byKey = new Map();
	for (const dir of dirs) {
		const repo = lookup(nearestExisting(dir));
		if (!repo || byKey.has(repo.key)) continue;
		byKey.set(repo.key, { key: repo.key, name: lastTwoSegments(repo.mainRoot ?? repo.root) });
	}
	return [...byKey.values()];
}

/**
 * Every repository a run of transcript records worked in.
 *
 * @param {Iterable<object>} records - raw transcript records, any type
 * @param {(dir: string) => import("./repo.mjs").ResolvedRepo|undefined} [lookup]
 * @returns {RepoTag[]}
 */
export function repoTagsOf(records, lookup = resolveRepoAt) {
	const dirs = new Set();
	for (const _record of tapEvidenceDirs(records, dirs));
	return resolveRepoTags(dirs, lookup);
}

/**
 * The folder itself, or its nearest ancestor that exists, so a write into a folder not created yet
 * (or one deleted since) still finds the repository around it.
 *
 * @param {string} dir - absolute folder path
 * @returns {string} an existing folder, or the input when no ancestor exists
 */
function nearestExisting(dir) {
	let current = dir;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return dir;
		current = parent;
	}
	return current;
}
