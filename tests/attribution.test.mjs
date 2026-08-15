import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { attributeTurns, resolveProjectAttribution } from "../src/parser/attribution.mjs";
import { resolveRepoAt } from "../src/parser/repo.mjs";

/** A project directory (mirrors ~/.claude/projects/<slug>) whose transcript's cwd is `cwd`. */
function makeProjectDir(cwd) {
	const dir = join(mkdtempSync(join(tmpdir(), "claude-usage-attr-projects-")), "project");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify({ type: "user", cwd })}\n`);
	return dir;
}

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

/** A ticket-branch worktree: its own top level, but named after the main checkout it belongs to. */
const GAMMA_WORKTREE = { root: "/repos/gamma-ticket-1", key: "key-gamma", mainRoot: "/repos/gamma" };

/** Stands in for the git-backed resolver, answering only inside the worktree. */
function worktreeLookup(dir) {
	return dir.startsWith(GAMMA_WORKTREE.root) ? GAMMA_WORKTREE : undefined;
}

test("a turn attributed to a worktree carries the MAIN checkout's name, not the worktree's", () => {
	// projectSlug stays the checkout that actually ran — the canonical name rides alongside it
	// rather than replacing it, so which worktree did the work is still answerable later.
	const turns = [turn({ cwd: "/repos/gamma-ticket-1" })];

	const attributed = attributeTurns(turns, FALLBACK, worktreeLookup);

	expect(attributed).toStrictEqual([
		{ projectSlug: "repos/gamma-ticket-1", repoKey: "key-gamma", repoName: "repos/gamma" },
	]);
});

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

test("the project-directory fallback names the repository after its main checkout too", () => {
	// The fallback is the one path that could break the invariant attributeTurns now holds: a turn
	// with no evidence of its own must land on a repository named the same way as one with evidence,
	// or the same repository answers to two names depending on which turns happened to have files.
	const base = mkdtempSync(join(tmpdir(), "claude-usage-attr-worktree-"));
	const repoDir = join(base, "workspaces", "my-app");
	mkdirSync(repoDir, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", "git@github.com:org/my-app.git"], { cwd: repoDir });
	const identity = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
	execFileSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repoDir });
	const worktreeDir = join(base, "workspaces", "my-app-ticket-7");
	execFileSync("git", ["worktree", "add", "-q", "-b", "ticket-7", worktreeDir], { cwd: repoDir });

	const attribution = resolveProjectAttribution(makeProjectDir(worktreeDir));

	expect(attribution).toStrictEqual({
		projectSlug: "workspaces/my-app-ticket-7",
		repoKey: resolveRepoAt(repoDir).key,
		repoName: "workspaces/my-app",
	});
});

test("a project directory's own attribution names the repository it resolves to, not the folder its transcript ran in", () => {
	// The two halves used to be resolved by two independent directory scans — one for the folder
	// name, one for the repository — so they could answer about different transcripts and glue a
	// folder that merely CONTAINS repositories onto a real repository's key. One scan, one answer.
	const base = mkdtempSync(join(tmpdir(), "claude-usage-attr-"));
	const repoDir = join(base, "workspaces", "my-app");
	mkdirSync(join(repoDir, "src", "deep"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", "git@github.com:org/my-app.git"], { cwd: repoDir });

	const attribution = resolveProjectAttribution(makeProjectDir(join(repoDir, "src", "deep")));

	expect(attribution).toStrictEqual({
		projectSlug: "workspaces/my-app",
		repoKey: resolveRepoAt(repoDir).key,
		// A checkout with no worktrees is its own main checkout, so it names itself.
		repoName: "workspaces/my-app",
	});
});

test("a project directory that is not in a repository keeps its own folder name and gets no repository key", () => {
	// The real `git-repos/personal` case: a folder holding repositories rather than being one. It
	// must stay unattributed — a key here is what made two repositories answer to this name.
	const holder = join(mkdtempSync(join(tmpdir(), "claude-usage-attr-")), "git-repos", "personal");
	mkdirSync(holder, { recursive: true });

	const attribution = resolveProjectAttribution(makeProjectDir(holder));

	expect(attribution).toStrictEqual({ projectSlug: "git-repos/personal" });
});

/** The real ubet-devenv shape: a workspace folder that holds checkouts, inside a repo of its own. */
const DEVENV = { root: "/repos/ubet-devenv", key: "key-devenv" };
const BACKEND = { root: "/repos/ubet-devenv/workspace/upredict-backend", key: "key-backend" };

/** `workspace` has no repo of its own, so git answers with the repo CONTAINING it. */
function devenvLookup(dir) {
	if (dir.startsWith(BACKEND.root)) return BACKEND;
	if (dir.startsWith(DEVENV.root)) return DEVENV;
	return undefined;
}

test("stepping out to the folder that HOLDS the checkouts does not move the session off the checkout", () => {
	// Most turns run a command or just reply, with cwd back at the workspace root. That folder sits
	// inside the devenv repo, so git names devenv — a true answer to "which repo is this folder in",
	// and the wrong answer to "what is this turn working on".
	const turns = [turn({ cwd: "/repos/ubet-devenv/workspace/upredict-backend" }), turn({ cwd: "/repos/ubet-devenv/workspace" })];

	const attributed = attributeTurns(turns, FALLBACK, devenvLookup);

	expect(attributed.map((entry) => entry.projectSlug)).toStrictEqual(["workspace/upredict-backend", "workspace/upredict-backend"]);
});

test("the folder that holds the checkouts also loses to the checkout THIS turn's files are in", () => {
	// The very first turn of a session has no history to fall back on, so the files are the only
	// narrower answer available.
	const turns = [turn({ cwd: "/repos/ubet-devenv/workspace", filePaths: ["/repos/ubet-devenv/workspace/upredict-backend/src/app.ts"] })];

	const attributed = attributeTurns(turns, FALLBACK, devenvLookup);

	expect(attributed).toStrictEqual([{ projectSlug: "workspace/upredict-backend", repoKey: "key-backend" }]);
});

test("a session that really is working on the outer repository still lands there", () => {
	// The rule only discards the outer repository when a NARROWER answer exists. With nothing
	// nested in play, work on the container repo itself must still be its own.
	// No files anywhere: cwd is the ONLY evidence, so discarding it would strand both turns on the
	// project directory's fallback rather than on the repository they actually ran in.
	const turns = [turn({ cwd: "/repos/ubet-devenv" }), turn({ cwd: "/repos/ubet-devenv/workspace" })];

	const attributed = attributeTurns(turns, FALLBACK, devenvLookup);

	expect(attributed.map((entry) => entry.projectSlug)).toStrictEqual(["repos/ubet-devenv", "repos/ubet-devenv"]);
});
