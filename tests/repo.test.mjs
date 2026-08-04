import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { resolveRepoAt, resolveRepoKey } from "../src/parser/repo.mjs";

/** A minimal record carrying the one field the resolver looks for. */
function cwdRecord(cwd) {
	return { type: "user", cwd };
}

/** A project directory (mirrors ~/.claude/projects/<slug>) whose transcript's cwd is `cwd`. */
function makeProjectDir(cwd) {
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-repo-projects-"));
	const dir = join(projectsRoot, "project");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify(cwdRecord(cwd))}\n`);
	return dir;
}

/** A real, local-only git repo (no network) with one remote — the fixture the assignment requires. */
function initGitRepo(remoteUrl) {
	const repoDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-git-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: repoDir });
	return repoDir;
}

test("the SSH and HTTPS forms of the same remote resolve to the same repoKey", () => {
	// git@github.com:org/repo.git and https://github.com/org/repo.git are the same repository —
	// without normalizing before hashing, two machines recording either form would never group,
	// silently defeating D20's whole point.
	const sshRepo = initGitRepo("git@github.com:org/repo.git");
	const httpsRepo = initGitRepo("https://github.com/org/repo.git");

	const sshKey = resolveRepoKey(makeProjectDir(sshRepo));
	const httpsKey = resolveRepoKey(makeProjectDir(httpsRepo));

	expect(sshKey, "expected a resolved key for the ssh-remote repo").toBeTruthy();
	expect(sshKey).toBe(httpsKey);
});

test("a project directory whose cwd is not a git repository has no repoKey", () => {
	const plainDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-nongit-"));

	const key = resolveRepoKey(makeProjectDir(plainDir));

	expect(key).toBe(undefined);
});

test("a project directory whose recorded cwd no longer exists has no repoKey", () => {
	const goneDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-gone-"));
	rmSync(goneDir, { recursive: true, force: true });

	const key = resolveRepoKey(makeProjectDir(goneDir));

	expect(key).toBe(undefined);
});

test("a project directory with no cwd data yet is not permanently cached as no-repoKey — a later call resolves it once the repo appears", () => {
	// backfill is the one long-running process that can call resolveRepoKey many times for the
	// same directory over its lifetime; caching a transient miss forever would poison every
	// later call, mirroring resolveProjectSlug's own null-caching fix (project.mjs).
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-repo-projects-"));
	const dir = join(projectsRoot, "late-project");
	mkdirSync(dir, { recursive: true });

	const firstLook = resolveRepoKey(dir);
	expect(firstLook, "no transcript exists yet, so there is genuinely nothing to resolve").toBe(undefined);

	const repoDir = initGitRepo("git@github.com:org/late-repo.git");
	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify(cwdRecord(repoDir))}\n`);

	const secondLook = resolveRepoKey(dir);
	expect(secondLook, "the undefined from the first look must not have been cached forever").not.toBe(undefined);
});

test("a directory nested inside a repository resolves to that repository's top level and key", () => {
	// The per-turn signal is a working directory or an edited file's folder, which is almost never
	// the repository root itself — resolving only exact roots would attribute nothing.
	const repoDir = initGitRepo("git@github.com:org/nested.git");
	mkdirSync(join(repoDir, "src", "deep"), { recursive: true });

	const nested = resolveRepoAt(join(repoDir, "src", "deep"));

	expect(nested?.root).toBe(realpathSync(repoDir));
	expect(nested?.key).toBe(resolveRepoAt(repoDir)?.key);
});
