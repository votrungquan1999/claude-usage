import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { install, withStatusLine, withSyncConfig } from "../src/install.mjs";

function fakeHome() {
	const home = mkdtempSync(join(tmpdir(), "claude-usage-home-"));
	mkdirSync(join(home, ".claude"), { recursive: true });
	return home;
}

test("links the repo to a stable path and wires the status line", () => {
	const home = fakeHome();

	install({ home, repoRoot: "/opt/claude-usage" });

	expect(readlinkSync(join(home, ".claude", "claude-usage"))).toBe("/opt/claude-usage");

	const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
	expect(settings.statusLine).toStrictEqual({
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
	expect(settings.model, "unrelated settings survive both runs").toBe("opus");
	expect(settings.statusLine.type).toBe("command");

	const backups = readdirSync(join(home, ".claude")).filter((f) => f.includes(".backup-"));
	expect(backups.length, "the pre-existing settings file was backed up").toBeGreaterThanOrEqual(1);
	expect(JSON.parse(readFileSync(join(home, ".claude", backups[0]), "utf8"))).toStrictEqual({
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

	expect(settings.hooks.UserPromptSubmit).toStrictEqual([
		{ hooks: [{ type: "command", command: "existing.mjs" }] },
		{ hooks: [{ type: "command", command: `node ${join(linkPath, "hooks", "user-prompt-submit.mjs")}` }] },
	]);
	expect(settings.hooks.SessionStart).toStrictEqual([
		{ hooks: [{ type: "command", command: `node ${join(linkPath, "hooks", "session-start.mjs")}` }] },
	]);
});

test("re-running install() twice does not duplicate the hook entries", () => {
	const home = fakeHome();

	install({ home, repoRoot: "/opt/claude-usage" });
	install({ home, repoRoot: "/opt/claude-usage" });

	const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
	expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
	expect(settings.hooks.SessionStart).toHaveLength(1);
});

test("install writes the sync config so a new machine needs no hand-edited .env", () => {
	const home = fakeHome();
	// A REAL directory, unlike the other tests' "/opt/claude-usage": the installed .env path goes
	// through the symlink, so a dangling target would make the write fail rather than the assertion.
	const repoRoot = mkdtempSync(join(tmpdir(), "claude-usage-repo-"));

	install({ home, repoRoot, apiUrl: "https://usage.example.com", secret: "fresh" });

	const envPath = join(home, ".claude", "claude-usage", ".env");
	expect(existsSync(envPath), "install should have written the .env itself").toBe(true);
	expect(readFileSync(envPath, "utf8")).toContain("CLAUDE_USAGE_API_URL=https://usage.example.com");
});

test("writing the sync config sets both keys and leaves unrelated ones alone", () => {
	// The server machine's .env also holds MONGODB_URI, and a stale secret must be replaced rather
	// than appended twice — a duplicate key silently wins or loses depending on the parser.
	const existing = "MONGODB_URI=mongodb://localhost:27017/claude-usage\nCLAUDE_USAGE_SECRET=stale\n";

	const updated = withSyncConfig(existing, { apiUrl: "https://usage.example.com", secret: "fresh" });

	expect(updated).toContain("MONGODB_URI=mongodb://localhost:27017/claude-usage");
	expect(updated).toContain("CLAUDE_USAGE_API_URL=https://usage.example.com");
	expect(updated).toContain("CLAUDE_USAGE_SECRET=fresh");
	expect(updated, "the replaced secret must not survive alongside its replacement").not.toContain("stale");
});

test("adds the status line without disturbing existing settings", () => {
	// ~/.claude/settings.json is live config — hooks, permissions, MCP servers all live here.
	const existing = {
		hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "existing.mjs" }] }] },
		model: "opus",
	};

	const updated = withStatusLine(existing, "node /opt/claude-usage/bin/statusline.mjs");

	expect(updated).toStrictEqual({
		hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "existing.mjs" }] }] },
		model: "opus",
		statusLine: { type: "command", command: "node /opt/claude-usage/bin/statusline.mjs", padding: 0 },
	});
});
