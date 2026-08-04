import { dirname } from "node:path";

import { lastTwoSegments } from "./project.mjs";
import { resolveRepoAt } from "./repo.mjs";

/**
 * Which repository one turn's spend belongs to.
 *
 * @typedef {object} TurnAttribution
 * @property {string} projectSlug - `<parent>/<name>` of the repository root, or the project
 *   directory's own slug when no repository could be resolved
 * @property {string} [repoKey] - absent, not null, when no repository could be resolved
 */

/**
 * Attribute each turn of one session to a repository.
 *
 * Exists because attributing a whole project directory by its first recorded cwd answers nothing
 * for a session launched from a folder that CONTAINS repositories rather than being one — the
 * common case for anyone keeping shared rules at the parent level. Every turn is placed on its own
 * evidence instead, in falling order of directness.
 *
 * @param {import("./dedupe.mjs").Turn[]} turns - one session's turns, chronological
 * @param {TurnAttribution} fallback - the project directory's own identity, used where a turn
 *   offers no evidence at all
 * @param {(dir: string) => import("./repo.mjs").ResolvedRepo|undefined} [lookup] - injectable for
 *   tests; defaults to the real git-backed resolver
 * @returns {TurnAttribution[]} one entry per turn, in the same order
 */
export function attributeTurns(turns, fallback, lookup = resolveRepoAt) {
	/** @type {import("./repo.mjs").ResolvedRepo|undefined} */
	let carried;

	return turns.map((turn) => {
		// cwd outranks the files: a turn run inside one repository while READING a file from
		// another is working on the first. Where cwd is the parent folder it resolves to nothing
		// and the files decide, which is the whole case this exists for.
		const resolved = repoFromCwd(turn, lookup) ?? dominantRepoAmongFiles(turn, carried, lookup) ?? carried;
		if (!resolved) return fallback;

		carried = resolved;
		return { projectSlug: lastTwoSegments(resolved.root), repoKey: resolved.key };
	});
}

/**
 * The repository the turn actually ran in, when its working directory is inside one.
 *
 * @param {import("./dedupe.mjs").Turn} turn
 * @param {(dir: string) => import("./repo.mjs").ResolvedRepo|undefined} lookup
 */
function repoFromCwd(turn, lookup) {
	return turn.cwd ? lookup(turn.cwd) : undefined;
}

/**
 * The repository holding most of the files this turn touched.
 *
 * @param {import("./dedupe.mjs").Turn} turn
 * @param {import("./repo.mjs").ResolvedRepo|undefined} carried - the repository the session is
 *   currently in, which breaks a tie so a turn touching one file from each does not flap
 * @param {(dir: string) => import("./repo.mjs").ResolvedRepo|undefined} lookup
 */
function dominantRepoAmongFiles(turn, carried, lookup) {
	/** @type {Map<string, {repo: import("./repo.mjs").ResolvedRepo, count: number, firstIndex: number}>} */
	const byRoot = new Map();

	turn.filePaths.forEach((path, index) => {
		const repo = lookup(dirname(path));
		if (!repo) return;
		const entry = byRoot.get(repo.root);
		if (entry) entry.count++;
		else byRoot.set(repo.root, { repo, count: 1, firstIndex: index });
	});

	const isCarried = (entry) => (carried && entry.repo.root === carried.root ? 1 : 0);
	// Fully ordered, so the same turn always attributes the same way: most files, then the repo
	// already in play, then whichever was touched first.
	const ranked = [...byRoot.values()].sort(
		(a, b) => b.count - a.count || isCarried(b) - isCarried(a) || a.firstIndex - b.firstIndex,
	);

	return ranked[0]?.repo;
}
