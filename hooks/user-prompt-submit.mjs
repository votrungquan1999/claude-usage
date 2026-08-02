#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Must return well before Claude Code's own timeout and must never
 * exit non-zero — exit code 2 erases the user's prompt (Step 14).
 *
 * Spawns `bin/sync.mjs` detached so the upload can't add latency to the prompt. `stdio:
 * "ignore"` is as load-bearing as `detached: true`: Claude Code captures this hook's own
 * stdout/stderr as pipes, and a wait on an inherited pipe only reaches EOF once every
 * process holding its write end closes it — including a "detached" grandchild that still
 * inherited the pipe.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
	let input = {};
	try {
		input = JSON.parse(readFileSync(0, "utf8"));
	} catch {
		input = {};
	}

	if (input.transcript_path) {
		try {
			const syncScript = join(import.meta.dirname, "..", "bin", "sync.mjs");
			const child = spawn(process.execPath, [syncScript, input.transcript_path], {
				detached: true,
				stdio: "ignore",
			});
			child.unref();
		} catch {
			// spawn failure — nothing to sync this cycle, next prompt/SessionStart retries
		}
	}

	process.exit(0);
}

main().catch(() => process.exit(0));
