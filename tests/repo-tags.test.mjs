import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { lastTwoSegments } from "../src/parser/project.mjs";
import { resolveRepoAt } from "../src/parser/repo.mjs";
import { repoTagsOf } from "../src/parser/repo-tags.mjs";

/** A real, local-only git repo with one remote, under a fresh parent folder. */
function initGitRepo(remoteUrl, name = "repo") {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "claude-usage-tags-")));
	const repoDir = join(parent, name);
	mkdirSync(repoDir);
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: repoDir });
	return repoDir;
}

/** An assistant record whose tool calls name the given files. */
function toolRecord(cwd, files) {
	return {
		type: "assistant",
		cwd,
		message: { content: files.map((file_path) => ({ type: "tool_use", name: "Edit", input: { file_path } })) },
	};
}

test("a session is tagged with its start folder's repository and every repository it edited a file in", () => {
	const startRepo = initGitRepo("git@github.com:org/start.git", "start");
	const editedRepo = initGitRepo("git@github.com:org/edited.git", "edited");

	const tags = repoTagsOf([{ type: "user", cwd: startRepo }, toolRecord(startRepo, [join(editedRepo, "a.ts")])]);

	expect(tags.map((tag) => tag.name).sort()).toEqual([lastTwoSegments(editedRepo), lastTwoSegments(startRepo)].sort());
	expect(tags.find((tag) => tag.name === lastTwoSegments(editedRepo))?.key).toBe(resolveRepoAt(editedRepo)?.key);
});

test("a file written into a folder that does not exist yet still tags the repository around it", () => {
	const repo = initGitRepo("git@github.com:org/fresh.git", "fresh");

	const tags = repoTagsOf([toolRecord("/", [join(repo, "docs", "new-feature", "spec.md")])]);

	expect(tags).toEqual([{ key: resolveRepoAt(repo)?.key, name: lastTwoSegments(repo) }]);
});

test("work inside a worktree tags the repository's main checkout, not the worktree folder", () => {
	const repo = initGitRepo("git@github.com:org/worktreed.git", "worktreed");
	const identity = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
	execFileSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
	const worktree = `${repo}-ticket-7`;
	execFileSync("git", ["worktree", "add", "-q", "-b", "ticket-7", worktree], { cwd: repo });

	const tags = repoTagsOf([{ type: "user", cwd: worktree }, toolRecord(worktree, [join(worktree, "a.ts")])]);

	expect(tags).toEqual([{ key: resolveRepoAt(repo)?.key, name: lastTwoSegments(repo) }]);
});
