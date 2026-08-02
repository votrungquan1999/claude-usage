import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Link the checkout to a stable path and wire the status line into Claude Code settings.
 *
 * @param {object} options
 * @param {string} options.home - the user's home directory
 * @param {string} options.repoRoot - where this repo is checked out
 * @returns {void}
 */
export function install({ home, repoRoot }) {
	const claudeDir = join(home, ".claude");
	mkdirSync(claudeDir, { recursive: true });

	// A fixed link path means settings, hooks and the skill all reference one location,
	// no matter where each machine cloned the repo.
	const linkPath = join(claudeDir, "claude-usage");
	rmSync(linkPath, { force: true, recursive: true });
	symlinkSync(repoRoot, linkPath);

	const settingsPath = resolveSettingsPath(join(claudeDir, "settings.json"));
	const existing = readSettings(settingsPath);

	// settings.json holds live config — never rewrite it without a copy to fall back on.
	if (existing.found) {
		copyFileSync(settingsPath, `${settingsPath}.backup-${new Date().toISOString()}`);
	}

	const statusLineCommand = `node ${join(linkPath, "bin", "statusline.mjs")}`;
	const withStatus = withStatusLine(existing.settings, statusLineCommand);
	const hookCommands = {
		UserPromptSubmit: `node ${join(linkPath, "hooks", "user-prompt-submit.mjs")}`,
		SessionStart: `node ${join(linkPath, "hooks", "session-start.mjs")}`,
	};
	writeFileSync(settingsPath, `${JSON.stringify(withHooks(withStatus, hookCommands), null, 2)}\n`);
}

/** Claude Code reads through a symlinked settings file, so patch the target, not the link. */
function resolveSettingsPath(path) {
	try {
		return lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
	} catch {
		return path;
	}
}

function readSettings(path) {
	try {
		return { found: true, settings: JSON.parse(readFileSync(path, "utf8")) };
	} catch {
		return { found: false, settings: {} };
	}
}

/**
 * Add the status line to a settings object, leaving everything else alone.
 *
 * @param {object} settings - parsed ~/.claude/settings.json
 * @param {string} command - the shell command Claude Code should run
 * @returns {object} a new settings object
 */
export function withStatusLine(settings, command) {
	// padding 0 removes Claude Code's default left indent, which wastes a column.
	return { ...settings, statusLine: { type: "command", command, padding: 0 } };
}

/**
 * Add or update this tool's own hook entries, leaving every other event and every other
 * entry within an event alone.
 *
 * `settings.hooks.<Event>` is an array of groups that may already hold entries unrelated
 * to this tool (a foreign `UserPromptSubmit` hook, say) — unlike `withStatusLine`'s single
 * scalar key, a naive spread-and-append would duplicate this tool's own entry on every
 * `install()` re-run. Instead, match-and-replace by command string: it's deterministic,
 * since the command is always `node <linkPath>/hooks/<name>.mjs`.
 *
 * @param {object} settings - parsed ~/.claude/settings.json
 * @param {Record<string, string>} commands - event name -> this tool's own command for it
 * @returns {object} a new settings object
 */
export function withHooks(settings, commands) {
	const hooks = { ...settings.hooks };
	for (const [event, command] of Object.entries(commands)) {
		const group = { hooks: [{ type: "command", command }] };
		const existingGroups = (hooks[event] ?? []).filter((g) => g.hooks?.[0]?.command !== command);
		hooks[event] = [...existingGroups, group];
	}
	return { ...settings, hooks };
}
