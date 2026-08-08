import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const STATUSLINE_BIN = join(import.meta.dirname, "..", "bin", "statusline.mjs");

/** A fake $HOME carrying only the sync watermark bin/statusline.mjs reads (the I/O boundary). */
function fakeHome() {
	return mkdtempSync(join(tmpdir(), "claude-usage-statusline-home-"));
}

function writeWatermark(home, contents) {
	const dir = join(home, ".claude", "claude-usage-state");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "sync-watermark.json"),
		typeof contents === "string" ? contents : JSON.stringify(contents),
	);
}

const PAYLOAD = {
	model: { id: "claude-opus-5" },
	context_window: { total_input_tokens: 500_000, context_window_size: 1_000_000 },
};

/** Runs bin/statusline.mjs as Claude Code would: JSON on stdin, its own stdout read back. */
function runStatusline(home, payload) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [STATUSLINE_BIN], { env: { ...process.env, HOME: home } });
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("close", () => resolve(stdout));
		child.stdin.write(JSON.stringify(payload));
		child.stdin.end();
	});
}

test("prints a staleness warning when the sync watermark is more than 12h old", async () => {
	const home = fakeHome();
	writeWatermark(home, { lastContactAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() });

	const stdout = await runStatusline(home, PAYLOAD);

	expect(stdout).toContain("⚠ sync broken");
});

test("does not warn when the sync watermark is recent", async () => {
	const home = fakeHome();
	writeWatermark(home, { lastContactAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

	const stdout = await runStatusline(home, PAYLOAD);

	expect(stdout).not.toContain("sync broken");
	expect(stdout, "the rest of the line must still render").toContain("50.0%");
});

test("a corrupt watermark file suppresses only the warning, not the whole status line", async () => {
	const home = fakeHome();
	writeWatermark(home, "not valid json {{{");

	const stdout = await runStatusline(home, PAYLOAD);

	expect(stdout, "the outer catch must not blank the line over a bad watermark file").toContain("50.0%");
	expect(stdout).not.toContain("sync broken");
});

test("a missing watermark file (a machine that has never synced) suppresses the warning, not the whole line", async () => {
	const home = fakeHome();
	// No sync-watermark.json written at all.

	const stdout = await runStatusline(home, PAYLOAD);

	expect(stdout, "the outer catch must not blank the line when no watermark file exists yet").toContain("50.0%");
	expect(stdout).not.toContain("sync broken");
});
