import { readdirSync } from "node:fs";
import { join } from "node:path";

import { streamRecords } from "./read.mjs";

/**
 * Memoized by project directory: identity is resolved once per run and inherited by every
 * file underneath it, so re-resolving the same directory should never re-scan its files.
 * @type {Map<string, string|null>}
 */
const cache = new Map();

/**
 * Resolve a project directory's identity: the last two path segments of the `cwd` recorded
 * in its own transcripts.
 *
 * Two different projects can share a directory basename (`workspace` is the basename of both
 * a personal checkout and a work repo in the real corpus) — the last two segments of the
 * actual recorded `cwd` disambiguate them where the directory name alone cannot.
 *
 * Uses a SHALLOW `readdirSync`, never recursive: subagent transcripts live two levels deeper
 * and their `cwd` drifts into a worktree 27.5% of the time, which would poison identity if
 * one of those files were read first.
 *
 * @param {string} projectDir - absolute path to a directory under ~/.claude/projects
 * @returns {string|null} `<parent>/<basename>` of the recorded cwd, or null when no transcript
 *   in this directory carries one (including an empty directory)
 */
export function resolveProjectSlug(projectDir) {
	if (cache.has(projectDir)) return cache.get(projectDir);

	const slug = findCwdSlug(projectDir);
	// Only a real resolution is cached. A null means "no cwd found (yet)" — for a short-lived
	// caller that's the final answer, but backfill is long-running and can revisit the same
	// directory after more data has landed; caching the miss would poison every later call, and
	// since projectSlug is written $setOnInsert, a null recorded once could never self-correct.
	if (slug !== null) cache.set(projectDir, slug);
	return slug;
}

function findCwdSlug(projectDir) {
	let entries;
	try {
		entries = readdirSync(projectDir);
	} catch {
		return null;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".jsonl")) continue;

		// Stop at the first cwd-bearing record — never read a whole file just to find one field.
		for (const record of streamRecords(join(projectDir, entry))) {
			if (record.cwd) return lastTwoSegments(record.cwd);
		}
	}

	return null;
}

function lastTwoSegments(cwd) {
	return cwd.split("/").filter(Boolean).slice(-2).join("/");
}
