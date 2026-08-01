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
