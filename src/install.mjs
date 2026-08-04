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
 * @param {string} [options.apiUrl] - base URL to sync to; with `secret`, writes .env for you
 * @param {string} [options.secret] - the shared secret; omitted leaves any existing .env alone
 * @returns {void}
 */
export function install({ home, repoRoot, apiUrl, secret }) {
	const claudeDir = join(home, ".claude");
	mkdirSync(claudeDir, { recursive: true });

	// A fixed link path means settings, hooks and the skill all reference one location,
	// no matter where each machine cloned the repo.
	const linkPath = join(claudeDir, "claude-usage");
	rmSync(linkPath, { force: true, recursive: true });
	symlinkSync(repoRoot, linkPath);

	// Only when both are supplied — a bare re-install must never blank out a working machine's
	// config, and half a config is worse than none (sync would fail with the key it does have).
	if (apiUrl && secret) {
		const envPath = join(linkPath, ".env");
		writeFileSync(envPath, withSyncConfig(readTextOrEmpty(envPath), { apiUrl, secret }));
	}

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

/** A missing .env is the normal first-install case, not an error. */
function readTextOrEmpty(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
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
 * Set this tool's two sync keys in a `.env` body, leaving every other key untouched.
 *
 * @param {string} envText - the existing .env contents ("" when there is none)
 * @param {{apiUrl: string, secret: string}} config - the values to set
 * @returns {string} the new .env contents
 */
export function withSyncConfig(envText, config) {
	const wanted = { CLAUDE_USAGE_API_URL: config.apiUrl, CLAUDE_USAGE_SECRET: config.secret };

	// Drop any prior assignment of the keys we own, then re-add. Appending without removing would
	// leave the file with the key twice, and which one wins is up to whichever parser reads it.
	const kept = envText
		.split("\n")
		.filter((line) => line.trim() !== "")
		.filter((line) => !Object.keys(wanted).some((key) => line.startsWith(`${key}=`)));

	const assigned = Object.entries(wanted).map(([key, value]) => `${key}=${value}`);
	return `${[...kept, ...assigned].join("\n")}\n`;
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
