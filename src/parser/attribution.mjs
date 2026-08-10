import { dirname } from "node:path";

import { lastTwoSegments, resolveProjectSlug } from "./project.mjs";
import { resolveProjectRepo, resolveRepoAt } from "./repo.mjs";

/**
 * Which repository one turn's spend belongs to.
 *
 * @typedef {object} TurnAttribution
 * @property {string} projectSlug - `<parent>/<name>` of the repository root, or the project
 *   directory's own slug when no repository could be resolved
 * @property {string} [repoKey] - absent, not null, when no repository could be resolved
 */

/**
 * The project directory's own identity — the fallback a turn with no evidence of its own lands on.
 *
 * @param {string} projectDir - absolute path to a directory under ~/.claude/projects
 * @returns {TurnAttribution|null} null when no transcript there records a cwd
 */
export function resolveProjectAttribution(projectDir) {
	// Both halves from ONE resolution. Resolving the folder name and the repository separately let
	// two independent directory scans answer about different transcripts, which is how a parent
	// folder's name ended up carrying a real repository's key.
	const repo = resolveProjectRepo(projectDir);
	if (repo) return { projectSlug: lastTwoSegments(repo.root), repoKey: repo.key };

	const projectSlug = resolveProjectSlug(projectDir);
	return projectSlug === null ? null : { projectSlug };
}

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
		const fromCwd = repoFromCwd(turn, lookup);
		// ...except when that folder holds the checkouts rather than being one of them. A workspace
		// directory can sit INSIDE a repository of its own, and `--show-toplevel` reports that
		// repository for every turn run from it — true for the question asked, wrong for this one.
		// Stepping out to it is the session zooming out, not moving to another project, so a
		// narrower answer already in hand wins.
		// Both narrower answers count: the repository the session is already in, and the one this
		// turn's own files sit in — the latter being all a session's FIRST turn has to go on.
		const fromFiles = dominantRepoAmongFiles(turn, carried, lookup);
		const outranked = strictlyContains(fromCwd, carried) || strictlyContains(fromCwd, fromFiles);
		const resolved = (outranked ? undefined : fromCwd) ?? fromFiles ?? carried;
		if (!resolved) return fallback;

		carried = resolved;
		return { projectSlug: lastTwoSegments(resolved.root), repoKey: resolved.key };
	});
}

/**
 * Whether `outer` strictly contains `inner`, making it the less specific of the two. Compares the
 * resolved roots rather than the recorded paths, so a repository is never judged by where a turn
 * happened to stand.
 *
 * @param {import("./repo.mjs").ResolvedRepo|undefined} outer
 * @param {import("./repo.mjs").ResolvedRepo|undefined} inner
 */
function strictlyContains(outer, inner) {
	return outer !== undefined && inner !== undefined && inner.root.startsWith(`${outer.root}/`);
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
