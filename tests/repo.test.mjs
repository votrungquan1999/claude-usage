import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { resolveProjectRepo, resolveRepoAt } from "../src/parser/repo.mjs";

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

/** A repo plus a linked worktree of it. The commit exists because `git worktree add` needs a HEAD. */
function initGitRepoWithWorktree(remoteUrl, worktreeName) {
	const repoDir = initGitRepo(remoteUrl);
	const identity = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
	execFileSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repoDir });
	const worktreeDir = `${repoDir}-${worktreeName}`;
	execFileSync("git", ["worktree", "add", "-q", "-b", worktreeName, worktreeDir], { cwd: repoDir });
	return { repoDir, worktreeDir };
}

test("a worktree resolves to its main checkout's root, while its own top level stays the worktree", () => {
	// A ticket-branch worktree shares its main checkout's remote, so the two already group under one
	// repoKey. What the group cannot do is name itself: the busiest checkout wins, and that is
	// routinely the worktree. The main checkout is the answer, and only git knows which one it is.
	const { repoDir, worktreeDir } = initGitRepoWithWorktree("git@github.com:org/worktreed.git", "ticket-123");

	const resolved = resolveRepoAt(worktreeDir);

	expect(resolved?.root).toBe(realpathSync(worktreeDir));
	expect(resolved?.mainRoot).toBe(realpathSync(repoDir));
});

test("a worktree of a bare repository resolves a key but no main checkout to name it after", () => {
	// A bare repo has no working tree, so there is no checkout whose folder name could stand for
	// the repository. Guessing one from the bare directory's own name is exactly the name-based
	// inference this whole approach exists to avoid — the repository stays keyed but unnamed.
	const seedDir = initGitRepo("git@github.com:org/seed.git");
	const identity = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
	execFileSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "init"], { cwd: seedDir });
	const bareDir = `${seedDir}-bare.git`;
	execFileSync("git", ["clone", "-q", "--bare", seedDir, bareDir]);
	execFileSync("git", ["remote", "set-url", "origin", "git@github.com:org/bare.git"], { cwd: bareDir });
	const worktreeDir = `${bareDir}-ticket-9`;
	execFileSync("git", ["worktree", "add", "-q", "-b", "ticket-9", worktreeDir], { cwd: bareDir });

	const resolved = resolveRepoAt(worktreeDir);

	expect(resolved?.root, "the worktree itself still resolves as a repository").toBe(realpathSync(worktreeDir));
	expect(resolved?.mainRoot).toBe(undefined);
});

test("a main checkout is its own main checkout", () => {
	// Every repository must answer this, not only the ones with worktrees — a label that is present
	// for worktrees and absent for ordinary checkouts would leave most repositories on the old
	// most-events rule, which is the behaviour being replaced.
	const repoDir = initGitRepo("git@github.com:org/plain.git");

	const resolved = resolveRepoAt(repoDir);

	expect(resolved?.mainRoot).toBe(realpathSync(repoDir));
});

test("the SSH and HTTPS forms of the same remote resolve to the same repoKey", () => {
	// git@github.com:org/repo.git and https://github.com/org/repo.git are the same repository —
	// without normalizing before hashing, two machines recording either form would never group,
	// silently defeating D20's whole point.
	const sshRepo = initGitRepo("git@github.com:org/repo.git");
	const httpsRepo = initGitRepo("https://github.com/org/repo.git");

	const sshKey = resolveProjectRepo(makeProjectDir(sshRepo))?.key;
	const httpsKey = resolveProjectRepo(makeProjectDir(httpsRepo))?.key;

	expect(sshKey, "expected a resolved key for the ssh-remote repo").toBeTruthy();
	expect(sshKey).toBe(httpsKey);
});

test("a project directory whose cwd is not a git repository has no repoKey", () => {
	const plainDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-nongit-"));

	const key = resolveProjectRepo(makeProjectDir(plainDir));

	expect(key).toBe(undefined);
});

test("a project directory whose recorded cwd no longer exists has no repoKey", () => {
	const goneDir = mkdtempSync(join(tmpdir(), "claude-usage-repo-gone-"));
	rmSync(goneDir, { recursive: true, force: true });

	const key = resolveProjectRepo(makeProjectDir(goneDir));

	expect(key).toBe(undefined);
});

test("a project directory with no cwd data yet is not permanently cached as no-repoKey — a later call resolves it once the repo appears", () => {
	// backfill is the one long-running process that can call resolveProjectRepo many times for the
	// same directory over its lifetime; caching a transient miss forever would poison every
	// later call, mirroring resolveProjectSlug's own null-caching fix (project.mjs).
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-repo-projects-"));
	const dir = join(projectsRoot, "late-project");
	mkdirSync(dir, { recursive: true });

	const firstLook = resolveProjectRepo(dir);
	expect(firstLook, "no transcript exists yet, so there is genuinely nothing to resolve").toBe(undefined);

	const repoDir = initGitRepo("git@github.com:org/late-repo.git");
	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify(cwdRecord(repoDir))}\n`);

	const secondLook = resolveProjectRepo(dir);
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
