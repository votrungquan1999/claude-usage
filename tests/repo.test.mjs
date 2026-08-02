import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveRepoKey } from "../src/parser/repo.mjs";

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

	assert.ok(sshKey, "expected a resolved key for the ssh-remote repo");
	assert.equal(sshKey, httpsKey);
});

test("a project directory whose cwd is not a git repository has no repoKey", () => {
	const plainDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-nongit-"));

	const key = resolveRepoKey(makeProjectDir(plainDir));

	assert.equal(key, undefined);
});

test("a project directory whose recorded cwd no longer exists has no repoKey", () => {
	const goneDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-gone-"));
	rmSync(goneDir, { recursive: true, force: true });

	const key = resolveRepoKey(makeProjectDir(goneDir));

	assert.equal(key, undefined);
});

test("a project directory with no cwd data yet is not permanently cached as no-repoKey — a later call resolves it once the repo appears", () => {
	// backfill is the one long-running process that can call resolveRepoKey many times for the
	// same directory over its lifetime; caching a transient miss forever would poison every
	// later call, mirroring resolveProjectSlug's own null-caching fix (project.mjs).
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-repo-projects-"));
	const dir = join(projectsRoot, "late-project");
	mkdirSync(dir, { recursive: true });

	const firstLook = resolveRepoKey(dir);
	assert.equal(firstLook, undefined, "no transcript exists yet, so there is genuinely nothing to resolve");

	const repoDir = initGitRepo("git@github.com:org/late-repo.git");
	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify(cwdRecord(repoDir))}\n`);

	const secondLook = resolveRepoKey(dir);
	assert.notEqual(secondLook, undefined, "the undefined from the first look must not have been cached forever");
});
