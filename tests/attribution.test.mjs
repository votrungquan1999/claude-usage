import { expect, test } from "vitest";

import { attributeTurns } from "../src/parser/attribution.mjs";

const ALPHA = { root: "/repos/alpha", key: "key-alpha" };
const BETA = { root: "/repos/beta", key: "key-beta" };

/** Stands in for the git-backed resolver so these tests need no repositories on disk. */
function lookup(dir) {
	if (dir.startsWith(ALPHA.root)) return ALPHA;
	if (dir.startsWith(BETA.root)) return BETA;
	return undefined;
}

/** A turn carrying only the two fields attribution reads. */
function turn({ cwd, filePaths = [] }) {
	return { cwd, filePaths };
}

/** The project directory's own identity — what a turn falls back to with no evidence of its own. */
const FALLBACK = { projectSlug: "git-repos/personal" };

test("a turn goes to the repository most of the files IT touched belong to", () => {
	const turns = [turn({ cwd: "/git-repos/personal", filePaths: ["/repos/alpha/a.ts", "/repos/beta/b.ts", "/repos/alpha/c.ts"] })];

	const attributed = attributeTurns(turns, FALLBACK, lookup);

	expect(attributed).toStrictEqual([{ projectSlug: "repos/alpha", repoKey: "key-alpha" }]);
});

test("a turn with no evidence of its own stays in the repository the session is already in", () => {
	// Most turns run a command or just reply: they touch no file, and cwd is the parent folder that
	// resolves to nothing. Falling back to the project directory there would leave the bulk of a
	// session unattributed even though the work plainly continued in the same repository.
	const turns = [
		turn({ cwd: "/git-repos/personal", filePaths: ["/repos/alpha/a.ts"] }),
		turn({ cwd: "/git-repos/personal" }),
		turn({ cwd: "/git-repos/personal", filePaths: ["/repos/beta/b.ts"] }),
		turn({ cwd: "/git-repos/personal" }),
	];

	const attributed = attributeTurns(turns, FALLBACK, lookup);

	expect(attributed.map((entry) => entry.projectSlug)).toStrictEqual([
		"repos/alpha",
		"repos/alpha",
		"repos/beta",
		"repos/beta",
	]);
});

test("a turn before any repository is known keeps the project directory's own identity and no repoKey", () => {
	// Never a fabricated guess: absent means absent, exactly as the per-directory resolver treats it.
	const turns = [turn({ cwd: "/git-repos/personal" }), turn({ cwd: "/git-repos/personal", filePaths: ["/repos/alpha/a.ts"] })];

	const attributed = attributeTurns(turns, FALLBACK, lookup);

	expect(attributed[0]).toStrictEqual({ projectSlug: "git-repos/personal" });
	expect(attributed[1]).toStrictEqual({ projectSlug: "repos/alpha", repoKey: "key-alpha" });
});

test("a turn run inside one repository while reading a file from another stays where it ran", () => {
	// Consulting a reference file elsewhere is not a change of subject; cwd is the stronger signal
	// whenever it resolves at all.
	const turns = [turn({ cwd: "/repos/alpha/src", filePaths: ["/repos/beta/b.ts", "/repos/beta/c.ts"] })];

	const attributed = attributeTurns(turns, FALLBACK, lookup);

	expect(attributed[0].projectSlug).toBe("repos/alpha");
});
