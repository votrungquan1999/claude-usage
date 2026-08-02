import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { install, withStatusLine } from "../src/install.mjs";

function fakeHome() {
	const home = mkdtempSync(join(tmpdir(), "claude-usage-home-"));
	mkdirSync(join(home, ".claude"), { recursive: true });
	return home;
}

test("links the repo to a stable path and wires the status line", () => {
	const home = fakeHome();

	install({ home, repoRoot: "/opt/claude-usage" });

	assert.equal(readlinkSync(join(home, ".claude", "claude-usage")), "/opt/claude-usage");

	const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
	assert.deepEqual(settings.statusLine, {
		type: "command",
		command: `node ${join(home, ".claude", "claude-usage", "bin", "statusline.mjs")}`,
		padding: 0,
	});
});

test("re-running is safe and keeps a copy of what it replaced", () => {
	const home = fakeHome();
	const settingsPath = join(home, ".claude", "settings.json");
	writeFileSync(settingsPath, JSON.stringify({ model: "opus" }));

	install({ home, repoRoot: "/opt/claude-usage" });
	install({ home, repoRoot: "/opt/claude-usage" });

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.equal(settings.model, "opus", "unrelated settings survive both runs");
	assert.equal(settings.statusLine.type, "command");

	const backups = readdirSync(join(home, ".claude")).filter((f) => f.includes(".backup-"));
	assert.ok(backups.length >= 1, "the pre-existing settings file was backed up");
	assert.deepEqual(JSON.parse(readFileSync(join(home, ".claude", backups[0]), "utf8")), {
		model: "opus",
	});
});

test("wires both hooks alongside the status line, preserving an unrelated existing hook entry", () => {
	const home = fakeHome();
	const settingsPath = join(home, ".claude", "settings.json");
	writeFileSync(
		settingsPath,
		JSON.stringify({
			hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "existing.mjs" }] }] },
		}),
	);

	install({ home, repoRoot: "/opt/claude-usage" });

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const linkPath = join(home, ".claude", "claude-usage");

	assert.deepEqual(settings.hooks.UserPromptSubmit, [
		{ hooks: [{ type: "command", command: "existing.mjs" }] },
		{ hooks: [{ type: "command", command: `node ${join(linkPath, "hooks", "user-prompt-submit.mjs")}` }] },
	]);
	assert.deepEqual(settings.hooks.SessionStart, [
		{ hooks: [{ type: "command", command: `node ${join(linkPath, "hooks", "session-start.mjs")}` }] },
	]);
});

test("re-running install() twice does not duplicate the hook entries", () => {
	const home = fakeHome();

	install({ home, repoRoot: "/opt/claude-usage" });
	install({ home, repoRoot: "/opt/claude-usage" });

	const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
	assert.equal(settings.hooks.UserPromptSubmit.length, 1);
	assert.equal(settings.hooks.SessionStart.length, 1);
});

test("adds the status line without disturbing existing settings", () => {
	// ~/.claude/settings.json is live config — hooks, permissions, MCP servers all live here.
	const existing = {
		hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "existing.mjs" }] }] },
		model: "opus",
	};

	const updated = withStatusLine(existing, "node /opt/claude-usage/bin/statusline.mjs");

	assert.deepEqual(updated, {
		hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "existing.mjs" }] }] },
		model: "opus",
		statusLine: { type: "command", command: "node /opt/claude-usage/bin/statusline.mjs", padding: 0 },
	});
});
