#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { install } from "../src/install.mjs";

/**
 * Reads `--flag value` pairs. Deliberately not `--flag=value` only: a secret pasted after a space
 * is what people actually type, and supporting one form badly is worse than supporting both.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Record<string, string>}
 */
function parseFlags(argv) {
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const [name, inline] = argv[i].slice(2).split("=");
		flags[name] = inline ?? argv[++i] ?? "";
	}
	return flags;
}

const flags = parseFlags(process.argv.slice(2));
const repoRoot = dirname(import.meta.dirname);
const home = homedir();
const linkPath = join(home, ".claude", "claude-usage");

const apiUrl = flags["api-url"] ?? process.env.CLAUDE_USAGE_API_URL;
const secret = flags.secret ?? process.env.CLAUDE_USAGE_SECRET;

install({ home, repoRoot, apiUrl, secret });

console.log(`Linked ${repoRoot} -> ${linkPath}`);
console.log(`Status line and sync hooks wired into ${join(home, ".claude", "settings.json")} (previous version backed up).`);

if (apiUrl && secret) {
	// The URL is safe to echo and confirms the machine points where it should. The secret is not,
	// and printing it would put it in the terminal scrollback of every machine ever set up.
	console.log(`Sync configured -> ${apiUrl} (secret written to ${join(linkPath, ".env")}, not shown).`);
} else {
	console.log("");
	console.log("Sync is NOT on yet — it needs a URL and a secret. Set up this machine with:");
	console.log("");
	console.log("  node scripts/install.mjs \\");
	console.log("    --api-url https://claude-usage.quanvo.dev \\");
	console.log("    --secret <shared secret>");
	console.log("");
	console.log("The secret is the one already deployed. Read it on a machine that has the Pulumi token:");
	console.log("");
	console.log("  cd personal-infra");
	console.log('  export PULUMI_ACCESS_TOKEN="$(grep \'^PULUMI_ACCESS_TOKEN=\' .env | cut -d= -f2-)"');
	console.log("  pulumi stack output claudeUsageSecret --show-secrets");
}

console.log("");
console.log("Open a new Claude Code session in the terminal to see it.");
