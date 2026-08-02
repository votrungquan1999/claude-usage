import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { findTranscript } from "../src/locate.mjs";

test("finds the session's transcript even when the shell has cd'd elsewhere", () => {
	// The project dir is fixed at session start; an agent that cd's into a subrepo would
	// otherwise resolve to a directory that has no transcript at all.
	const projects = mkdtempSync(join(tmpdir(), "claude-usage-projects-"));
	const sessionDir = join(projects, "-Users-me-work");
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(join(sessionDir, "abc-123.jsonl"), "");
	mkdirSync(join(projects, "-Users-me-work-subrepo"), { recursive: true });

	const found = findTranscript({
		projectsRoot: projects,
		sessionId: "abc-123",
		cwd: "/Users/me/work/subrepo",
	});

	assert.equal(found, join(sessionDir, "abc-123.jsonl"));
});

test("falls back to the cwd slug when no session id is given, mapping dots and underscores too", () => {
	// No CLAUDE_CODE_SESSION_ID (invoked outside a running session): resolve by cwd alone.
	// Claude Code's real project dirs map '.', '_' and '/' all to '-', not just '/'.
	const projects = mkdtempSync(join(tmpdir(), "claude-usage-projects-"));
	const sessionDir = join(projects, "-Users-me-wo-rk-dir");
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(join(sessionDir, "xyz-789.jsonl"), "");

	const found = findTranscript({
		projectsRoot: projects,
		cwd: "/Users/me/wo.rk_dir",
	});

	assert.equal(found, join(sessionDir, "xyz-789.jsonl"));
});
