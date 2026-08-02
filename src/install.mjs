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

	const command = `node ${join(linkPath, "bin", "statusline.mjs")}`;
	writeFileSync(settingsPath, `${JSON.stringify(withStatusLine(existing.settings, command), null, 2)}\n`);
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
