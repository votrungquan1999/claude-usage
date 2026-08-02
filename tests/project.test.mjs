import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveProjectSlug } from "../src/parser/project.mjs";

/** A minimal record carrying the one field the resolver looks for. */
function cwdRecord(cwd) {
	return { type: "user", cwd };
}

test("two project directories that share a basename resolve to different identities", () => {
	// `workspace` is the basename of both a personal dotfile checkout and a work repo in the
	// real corpus — basename alone would merge their spend into one dashboard row.
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-projects-"));

	const personalDir = join(projectsRoot, "-Users-me--openclaw-workspace");
	mkdirSync(personalDir, { recursive: true });
	writeFileSync(join(personalDir, "session-a.jsonl"), `${JSON.stringify(cwdRecord("/Users/me/.openclaw/workspace"))}\n`);

	const workDir = join(projectsRoot, "-Users-me-work-ubet-devenv-workspace");
	mkdirSync(workDir, { recursive: true });
	writeFileSync(join(workDir, "session-b.jsonl"), `${JSON.stringify(cwdRecord("/Users/me/work/ubet-devenv/workspace"))}\n`);

	const personalSlug = resolveProjectSlug(personalDir);
	const workSlug = resolveProjectSlug(workDir);

	assert.equal(personalSlug, ".openclaw/workspace");
	assert.equal(workSlug, "ubet-devenv/workspace");
	assert.notEqual(personalSlug, workSlug);
});

test("a directory with no cwd data yet is not permanently cached as null — a later call resolves it once data appears", () => {
	// backfill is the one long-running process that can call resolveProjectSlug many times for
	// the same directory over its lifetime; caching a transient/empty read as null forever would
	// poison every later call for that directory, and projectSlug is written $setOnInsert so a
	// null recorded once could never be corrected by a re-run.
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-projects-"));
	const dir = join(projectsRoot, "-Users-me-late-project");
	mkdirSync(dir, { recursive: true });

	const firstLook = resolveProjectSlug(dir);
	assert.equal(firstLook, null, "no transcript exists yet, so there is genuinely nothing to resolve");

	writeFileSync(join(dir, "session-a.jsonl"), `${JSON.stringify(cwdRecord("/Users/me/late-project"))}\n`);

	const secondLook = resolveProjectSlug(dir);
	assert.equal(secondLook, "me/late-project", "the null from the first look must not have been cached forever");
});
