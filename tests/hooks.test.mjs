import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { postEvents, resolveDotEnvPath, syncTail } from "../bin/sync.mjs";

const USER_PROMPT_SUBMIT_HOOK = join(import.meta.dirname, "..", "hooks", "user-prompt-submit.mjs");
const SESSION_START_HOOK = join(import.meta.dirname, "..", "hooks", "session-start.mjs");

/**
 * Runs a hook script as Claude Code would: JSON on stdin, its own stdout/stderr piped back.
 * `payload` is JSON-stringified unless it's already a string (used to feed malformed stdin).
 */
function runHook(hookPath, payload, envOverrides) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [hookPath], {
			env: { ...process.env, ...envOverrides },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		// "close", not "exit": Claude Code reads a hook's stdout to EOF, and a spawned grandchild
		// that inherited that pipe keeps it open past the hook's own exit. Resolving on "exit"
		// would report the hook as fast even when it left the parent's pipe held open.
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
		child.stdin.end();
	});
}

/** A fake $HOME carrying only what a hook needs: the machine id (and, once tests need it,
 * the live account) from ~/.claude.json. */
function fakeHome({ machineId = "machine-abc", account } = {}) {
	const home = mkdtempSync(join(tmpdir(), "claude-usage-sync-home-"));
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(
		join(home, ".claude.json"),
		JSON.stringify({ machineID: machineId, ...(account && { oauthAccount: account }) }),
	);
	return home;
}

function writeTranscript(dir, filename, records) {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, filename);
	writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
	return path;
}

/** A non-assistant filler line, ignored by dedupeAssistantTurns but real bytes on disk —
 * used to push an earlier real turn more than `bytes` behind the tail window. */
function paddingRecord(bytes) {
	return { type: "user", isSidechain: false, message: { role: "user", content: "x".repeat(bytes) } };
}

function assistantRecord({ requestId, messageId, sessionId, timestamp, cwd, prose }) {
	return {
		type: "assistant",
		requestId,
		sessionId,
		isSidechain: false,
		timestamp,
		cwd,
		message: {
			id: messageId,
			model: "claude-sonnet-5",
			content: [{ type: "text", text: prose }],
			usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 },
		},
	};
}

/**
 * Captures received request bodies; responds after an optional delay, with a configurable
 * status. 404s any path other than /api/sync (R31: a wrong path must never be mistaken for the
 * real sync route) and, on a real 200, reports `accepted` from the actual submitted event count
 * rather than a hardcoded number — so a test asserting `result.sent` is exercising postEvents'
 * real body-parsing, not a fake that happens to always say the same thing.
 */
function startFakeServer({ delayMs = 0, status = 200 } = {}) {
	const received = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			const respond = () => {
				received.push({ body, headers: req.headers, receivedAt: Date.now() });
				if (req.url !== "/api/sync") {
					res.writeHead(404, { "Content-Type": "text/html" });
					res.end("<html><body>Not Found</body></html>");
					return;
				}
				const events = JSON.parse(body).events ?? [];
				res.writeHead(status, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ accepted: status === 200 ? events.length : 0, rejected: 0 }));
			};
			if (delayMs > 0) setTimeout(respond, delayMs);
			else respond();
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve({ server, url: `http://127.0.0.1:${port}`, received });
		});
	});
}

test("posts a mapped aggregate event to the sync endpoint, never leaking raw transcript prose", async () => {
	const SENTINEL = "the launch code is ALPHA-BRAVO-9182";
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_1",
			messageId: "msg_1",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: SENTINEL,
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 1);
		assert.equal(received.length, 1);
		assert.equal(received[0].body.includes(SENTINEL), false, "no raw prose in the request body");
		assert.equal(received[0].headers["x-claude-usage-secret"], "shh");

		const posted = JSON.parse(received[0].body);
		assert.equal(posted.machineId, "machine-abc");
		assert.equal(posted.events.length, 1);
		assert.deepEqual(
			Object.keys(posted.events[0]).sort(),
			[
				"cacheReadTokens",
				"cacheWrite1hTokens",
				"cacheWrite5mTokens",
				"costUsd",
				"inputTokens",
				"isSubagent",
				"machineId",
				"messageId",
				"model",
				"outputTokens",
				"priced",
				"projectSlug",
				"requestId",
				"sessionId",
				"timestamp",
			].sort(),
			"only MappedUsageEvent fields leave this file — the aggregates-only guarantee",
		);
	} finally {
		server.close();
	}
});

test("posts repoKey when the transcript's cwd is a real git repo, and omits it when the cwd isn't a repo", async () => {
	const home = fakeHome({ machineId: "machine-abc" });

	const repoDir = mkdtempSync(join(tmpdir(), "claude-usage-sync-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", "git@github.com:org/repo.git"], { cwd: repoDir });

	const projectDir = join(home, ".claude", "projects", "-Users-me-repo-project");
	const transcript = writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_repo",
			messageId: "msg_repo",
			sessionId: "session-repo",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: repoDir,
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 1);
		const posted = JSON.parse(received[0].body);
		assert.match(posted.events[0].repoKey, /^[0-9a-f]{64}$/, "expected a sha256 hex digest");
	} finally {
		server.close();
	}
});

test("two concurrent syncs of the same transcript don't both upload — the uploader is single-flight", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-10.jsonl", [
		assistantRecord({
			requestId: "req_10",
			messageId: "msg_10",
			sessionId: "session-10",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	// Slow enough that the second call's lock check happens while the first is still holding it.
	const { server, url, received } = await startFakeServer({ delayMs: 150 });
	try {
		const env = { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" };
		const [first, second] = await Promise.all([
			syncTail({ transcriptPath: transcript, home, env }),
			syncTail({ transcriptPath: transcript, home, env }),
		]);

		assert.equal(received.length, 1, "only one of the two concurrent syncs should have uploaded");
		assert.equal(first.sent + second.sent, 1, "exactly one call reports a send, the other skipped");
	} finally {
		server.close();
	}
});

test("a lock file older than the 30s staleness window is reclaimed, so the sync still uploads", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-stale.jsonl", [
		assistantRecord({
			requestId: "req_stale",
			messageId: "msg_stale",
			sessionId: "session-stale",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	// A crash-leftover lock: some other pid's lock file, backdated well past the 30s staleness
	// window (via utimesSync, not a real 30s sleep) — the exact shape reclaimIfStale must accept.
	const lockPath = join(home, ".claude", "claude-usage-state", "locks", "session-stale.jsonl.lock");
	mkdirSync(dirname(lockPath), { recursive: true });
	writeFileSync(lockPath, "999999");
	const staleTime = new Date(Date.now() - 60_000);
	utimesSync(lockPath, staleTime, staleTime);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 1, "a stale lock must be reclaimed, not treated as still-held");
		assert.equal(received.length, 1);
	} finally {
		server.close();
	}
});

test("a stale lock reclaimed by several real processes at once is claimed by exactly one of them (R21)", async () => {
	// reclaimIfStale's statSync-then-writeFileSync is two steps with no atomicity between them.
	// That race is invisible to same-process concurrency (Node's sync fs calls never yield
	// mid-call, so two `await`ed syncTail() calls in one process can't interleave inside it) --
	// it only shows up across genuinely separate OS processes, so this test spawns real ones,
	// barrier-synchronised on a byte of stdin so they all race the reclaim within microseconds
	// of each other, mirroring how a burst of prompts fires right after a crash/reboot.
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-race.jsonl", [
		assistantRecord({
			requestId: "req_race",
			messageId: "msg_race",
			sessionId: "session-race",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const lockPath = join(home, ".claude", "claude-usage-state", "locks", "session-race.jsonl.lock");
	mkdirSync(dirname(lockPath), { recursive: true });
	writeFileSync(lockPath, "999999"); // crash-leftover: some other pid's lock
	const staleTime = new Date(Date.now() - 60_000);
	utimesSync(lockPath, staleTime, staleTime);

	const childDir = mkdtempSync(join(tmpdir(), "claude-usage-race-child-"));
	const childPath = join(childDir, "child.mjs");
	const syncPath = join(import.meta.dirname, "..", "bin", "sync.mjs");
	writeFileSync(
		childPath,
		[
			`import { syncTail } from ${JSON.stringify(syncPath)};`,
			`const [transcriptPath, home, apiUrl] = process.argv.slice(2);`,
			`process.stdin.once("data", async () => {`,
			`  const result = await syncTail({ transcriptPath, home, env: { CLAUDE_USAGE_API_URL: apiUrl, CLAUDE_USAGE_SECRET: "shh" } });`,
			`  process.stdout.write(JSON.stringify(result));`,
			`  process.exit(0);`,
			`});`,
		].join("\n"),
	);

	const { server, url, received } = await startFakeServer({ delayMs: 150 });
	try {
		const N = 8;
		const children = Array.from({ length: N }, () =>
			spawn(process.execPath, [childPath, transcript, home, url], { stdio: ["pipe", "pipe", "inherit"] }),
		);
		const outputs = children.map(
			(child) =>
				new Promise((resolve) => {
					let out = "";
					child.stdout.on("data", (d) => {
						out += d;
					});
					child.on("exit", () => resolve(out.trim()));
				}),
		);
		// Let every child finish importing sync.mjs and park on the stdin read before firing.
		await new Promise((resolve) => setTimeout(resolve, 300));
		for (const child of children) child.stdin.write("go");
		const results = await Promise.all(outputs);

		const uploaders = results.filter((r) => r && JSON.parse(r).sent > 0).length;
		assert.equal(uploaders, 1, "exactly one of the racing processes should have reclaimed the lock and uploaded");
		assert.equal(received.length, 1, "only one request should have reached the server");
	} finally {
		server.close();
	}
});

test("a fresh lock file (within the 30s staleness window) blocks the sync, making no network call", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-fresh.jsonl", [
		assistantRecord({
			requestId: "req_fresh",
			messageId: "msg_fresh",
			sessionId: "session-fresh",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	// A lock file some other pid wrote moments ago — well within the staleness window.
	const lockPath = join(home, ".claude", "claude-usage-state", "locks", "session-fresh.jsonl.lock");
	mkdirSync(dirname(lockPath), { recursive: true });
	writeFileSync(lockPath, "999999");

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 0, "a fresh lock must not be reclaimed");
		assert.equal(received.length, 0, "no network call while the lock is held");
		assert.equal(existsSync(lockPath), true, "syncTail must not delete a lock file it never acquired");
	} finally {
		server.close();
	}
});

test("makes no network call when the tail holds no assistant turns yet (first prompt of a new session)", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-2.jsonl", [
		{ type: "user", sessionId: "session-2", cwd: "/Users/me/project", timestamp: "2026-08-01T10:00:00.000Z" },
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 0);
		assert.equal(received.length, 0, "no request should ever have been sent");
	} finally {
		server.close();
	}
});

test("the hook exits well before a slow upload finishes, and the upload still completes after it exits", async () => {
	// How long the fake server sits on the response. This is the budget for the whole assertion
	// below, so it has to comfortably exceed the cost of SPAWNING a node process — which is what
	// `hookDuration` is almost entirely made of, and which a loaded machine can stretch well past
	// half a second. At 500ms this test failed roughly one run in six.
	const DELAY_MS = 2000;
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-3.jsonl", [
		assistantRecord({
			requestId: "req_3",
			messageId: "msg_3",
			sessionId: "session-3",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer({ delayMs: DELAY_MS });
	try {
		const start = Date.now();
		const { code } = await runHook(
			USER_PROMPT_SUBMIT_HOOK,
			{ transcript_path: transcript, session_id: "session-3", cwd: "/Users/me/project" },
			{ HOME: home, CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		);
		const hookDuration = Date.now() - start;

		assert.equal(code, 0);
		// Returning in under half the server's delay can only happen if the hook did NOT wait for
		// the upload — waiting would cost at least DELAY_MS. The threshold is a fraction of
		// DELAY_MS rather than a fixed number of ms so raising the delay widens the budget with it.
		assert.ok(hookDuration < DELAY_MS / 2, `hook took ${hookDuration}ms, expected well under ${DELAY_MS / 2}ms`);

		// Poll for the detached child's own upload to complete — proves stdio:"ignore" +
		// detached:true actually let it outlive the hook process, not merely that the hook
		// itself returned quickly.
		//
		// Derived from DELAY_MS, NOT a fixed number: the server only records the request AFTER
		// sitting on it for DELAY_MS, so a hardcoded window silently becomes too short the moment
		// someone raises the delay — trading this test's flake for a worse one.
		const deadline = Date.now() + DELAY_MS + 3000;
		while (received.length === 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		assert.equal(received.length, 1, "the detached upload should have completed after the hook exited");
		assert.ok(
			received[0].receivedAt >= start + hookDuration,
			"upload was recorded strictly after the hook process had already exited",
		);
	} finally {
		server.close();
	}
});

test("records the live account from ~/.claude.json into the local ledger, and the synced event carries it", async () => {
	const home = fakeHome({
		machineId: "machine-abc",
		account: { accountUuid: "acc-work", organizationUuid: "org-work" },
	});
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	// Timestamp close to "now", not a stale hardcoded date: this test represents the genuine
	// same-sitting case (a fresh session, observed within the R12 fix's plausible-observation
	// window of its own first turn) -- not the days-later resume case covered separately below.
	const transcript = writeTranscript(projectDir, "session-4.jsonl", [
		assistantRecord({
			requestId: "req_4",
			messageId: "msg_4",
			sessionId: "session-4",
			timestamp: new Date(Date.now() - 60_000).toISOString(),
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 1);
		const posted = JSON.parse(received[0].body);
		assert.equal(posted.events[0].accountUuid, "acc-work");
		assert.equal(posted.events[0].orgUuid, "org-work");

		const ledgerPath = join(home, ".claude", "claude-usage-state", "accounts.json");
		const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
		assert.equal(ledger["session-4"][0].accountUuid, "acc-work");
	} finally {
		server.close();
	}
});

test("a session first synced days after it actually ran ships unattributed, never stamped with today's logged-in account (R12)", async () => {
	// The turn ran a week ago under some other account; the machine is logged into
	// "acc-personal" only as of right now, at sync time. The ledger has never seen this
	// session before. Stamping the live account would attribute a week-old turn to whatever
	// account happens to be logged in today -- exactly the outcome D7/R12 forbid, and it would
	// be permanent (entries[0] never moves).
	const home = fakeHome({
		machineId: "machine-abc",
		account: { accountUuid: "acc-personal", organizationUuid: "org-personal" },
	});
	const projectDir = join(home, ".claude", "projects", "-Users-me-work-project");
	const transcript = writeTranscript(projectDir, "session-old.jsonl", [
		assistantRecord({
			requestId: "req_old",
			messageId: "msg_old",
			sessionId: "session-old",
			timestamp: "2026-07-25T09:00:00.000Z", // a week before this sync fires
			cwd: "/Users/me/work-project",
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 1);
		const posted = JSON.parse(received[0].body);
		assert.equal("accountUuid" in posted.events[0], false, "must not guess today's account for a week-old turn");
		assert.equal("orgUuid" in posted.events[0], false);
	} finally {
		server.close();
	}
});

test("hooks/session-start.mjs runs the sync inline, so the upload is already done by the time the hook process exits", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-5.jsonl", [
		assistantRecord({
			requestId: "req_5",
			messageId: "msg_5",
			sessionId: "session-5",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer({ delayMs: 100 });
	try {
		const { code } = await runHook(
			SESSION_START_HOOK,
			{ transcript_path: transcript, session_id: "session-5", cwd: "/Users/me/project", source: "startup" },
			{ HOME: home, CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		);

		assert.equal(code, 0);
		// Unlike UserPromptSubmit's detach, SessionStart blocks — the upload must already be
		// recorded by the time the hook process itself has exited.
		assert.equal(received.length, 1, "the sync must have completed before the hook process exited");
	} finally {
		server.close();
	}
});

test("hooks/session-start.mjs sweeps the whole transcript, not just the fixed tail window, so a turn one long response pushed behind it is still picked up (R19)", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	// One real turn, then >262,144 bytes of filler (one long agentic turn's worth of tool
	// output), then a second real turn -- the tail-only reader can only ever see the second.
	const transcript = writeTranscript(projectDir, "session-long.jsonl", [
		assistantRecord({
			requestId: "req_early",
			messageId: "msg_early",
			sessionId: "session-long",
			timestamp: "2026-08-01T09:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
		paddingRecord(300_000),
		assistantRecord({
			requestId: "req_late",
			messageId: "msg_late",
			sessionId: "session-long",
			timestamp: "2026-08-01T09:30:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi again",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const { code } = await runHook(
			SESSION_START_HOOK,
			{ transcript_path: transcript, session_id: "session-long", cwd: "/Users/me/project", source: "resume" },
			{ HOME: home, CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		);

		assert.equal(code, 0);
		assert.equal(received.length, 1);
		const posted = JSON.parse(received[0].body);
		const requestIds = posted.events.map((e) => e.requestId).sort();
		assert.deepEqual(requestIds, ["req_early", "req_late"], "both turns must reach the store, not only the tail one");
	} finally {
		server.close();
	}
});

test("syncTail also uploads subagent work, including a subagent launched inside a workflow, not just the main transcript (R22/R31)", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-sub.jsonl", [
		assistantRecord({
			requestId: "req_main",
			messageId: "msg_main",
			sessionId: "session-sub",
			timestamp: "2026-08-01T09:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);
	const sessionDir = join(projectDir, "session-sub");
	// Ordinary subagent, one level deep.
	writeTranscript(
		join(sessionDir, "subagents"),
		"agent-a.jsonl",
		[
			assistantRecord({
				requestId: "req_sub_a",
				messageId: "msg_sub_a",
				sessionId: "session-sub",
				timestamp: "2026-08-01T09:05:00.000Z",
				cwd: "/Users/me/project",
				prose: "sub a",
			}),
		].map((r) => ({ ...r, isSidechain: true })),
	);
	// Workflow-launched subagent, two levels deep -- the walk must be genuinely recursive.
	writeTranscript(
		join(sessionDir, "subagents", "workflows", "wf_1"),
		"agent-b.jsonl",
		[
			assistantRecord({
				requestId: "req_sub_b",
				messageId: "msg_sub_b",
				sessionId: "session-sub",
				timestamp: "2026-08-01T09:06:00.000Z",
				cwd: "/Users/me/project",
				prose: "sub b",
			}),
		].map((r) => ({ ...r, isSidechain: true })),
	);
	// Hostile fixture: journal.jsonl carries a real turn too and must stay excluded.
	writeTranscript(
		join(sessionDir, "subagents", "workflows", "wf_1"),
		"journal.jsonl",
		[
			assistantRecord({
				requestId: "req_journal",
				messageId: "msg_journal",
				sessionId: "session-sub",
				timestamp: "2026-08-01T09:07:00.000Z",
				cwd: "/Users/me/project",
				prose: "must not count",
			}),
		].map((r) => ({ ...r, isSidechain: true })),
	);

	const { server, url, received } = await startFakeServer();
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
			full: true,
		});

		assert.equal(result.sent, 3);
		const posted = JSON.parse(received[0].body);
		const events = posted.events;
		assert.deepEqual(
			events.map((e) => e.requestId).sort(),
			["req_main", "req_sub_a", "req_sub_b"],
			"main plus both subagent turns must reach the store; journal.jsonl must stay excluded",
		);
		const subA = events.find((e) => e.requestId === "req_sub_a");
		const main = events.find((e) => e.requestId === "req_main");
		assert.equal(subA.isSubagent, true);
		assert.equal(main.isSubagent, false);
	} finally {
		server.close();
	}
});

test("a 401 response (wrong/missing secret) is swallowed — sync no-ops without throwing", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-6.jsonl", [
		assistantRecord({
			requestId: "req_6",
			messageId: "msg_6",
			sessionId: "session-6",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url } = await startFakeServer({ status: 401 });
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "wrong" },
		});

		assert.equal(result.sent, 0, "a non-ok response must never be treated as a successful send");
	} finally {
		server.close();
	}
});

test("a 500 response (server/DB failure) is swallowed the same way", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-7.jsonl", [
		assistantRecord({
			requestId: "req_7",
			messageId: "msg_7",
			sessionId: "session-7",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url } = await startFakeServer({ status: 500 });
	try {
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		assert.equal(result.sent, 0);
	} finally {
		server.close();
	}
});

test("an unreachable server (connection refused) doesn't crash sync", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-8.jsonl", [
		assistantRecord({
			requestId: "req_8",
			messageId: "msg_8",
			sessionId: "session-8",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	// Nothing is listening on this port — a real connection-refused case.
	const result = await syncTail({
		transcriptPath: transcript,
		home,
		env: { CLAUDE_USAGE_API_URL: "http://127.0.0.1:1", CLAUDE_USAGE_SECRET: "shh" },
	});

	assert.equal(result.sent, 0);
});

test("missing/incomplete env config skips the network call entirely", async () => {
	const home = fakeHome({ machineId: "machine-abc" });
	const projectDir = join(home, ".claude", "projects", "-Users-me-project");
	const transcript = writeTranscript(projectDir, "session-9.jsonl", [
		assistantRecord({
			requestId: "req_9",
			messageId: "msg_9",
			sessionId: "session-9",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
			prose: "hi",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		// CLAUDE_USAGE_API_URL set (a real, reachable server — so a missed guard would actually
		// reach it), CLAUDE_USAGE_SECRET missing — the exact "installer ran but .env was never
		// filled in" case. A missing-URL variant would not distinguish "skipped" from "fetch
		// threw on an invalid URL and got swallowed by the outer try/catch" either way.
		const result = await syncTail({
			transcriptPath: transcript,
			home,
			env: { CLAUDE_USAGE_API_URL: url },
		});

		assert.equal(result.sent, 0);
		assert.equal(received.length, 0, "no request should even be attempted without a secret");
	} finally {
		server.close();
	}
});

test("resolveDotEnvPath falls back to the repo checkout's own .env when the installed ~/.claude/claude-usage/.env doesn't exist", () => {
	// A clone that never ran scripts/install.mjs -- no ~/.claude/claude-usage symlink at all.
	const home = mkdtempSync(join(tmpdir(), "claude-usage-dotenv-home-"));
	const repoRootEnvPath = join(import.meta.dirname, "..", ".env");

	assert.equal(resolveDotEnvPath(home), repoRootEnvPath);
});

test("resolveDotEnvPath prefers the installed ~/.claude/claude-usage/.env over the repo checkout's own when both exist", () => {
	const home = mkdtempSync(join(tmpdir(), "claude-usage-dotenv-home-"));
	const installedDir = join(home, ".claude", "claude-usage");
	mkdirSync(installedDir, { recursive: true });
	const installedPath = join(installedDir, ".env");
	writeFileSync(installedPath, "CLAUDE_USAGE_API_URL=http://installed\n");

	// The repo checkout's own .env exists too (this repo's real one, gitignored) -- the
	// installed location must still win.
	assert.equal(resolveDotEnvPath(home), installedPath);
});

test("the UserPromptSubmit hook exits 0 and writes nothing to stdout even with malformed stdin", async () => {
	const { code, stdout } = await runHook(USER_PROMPT_SUBMIT_HOOK, "not valid json {{{", {});
	assert.equal(code, 0);
	assert.equal(stdout, "");
});

test("postEvents posts to <apiUrl>/api/sync, not to apiUrl itself (R31: CLAUDE_USAGE_API_URL is a base URL)", async () => {
	let requestedPath = null;
	const server = createServer((req, res) => {
		requestedPath = req.url;
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: 1, rejected: 0 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		await postEvents({
			apiUrl: `http://127.0.0.1:${port}`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }],
		});

		assert.equal(requestedPath, "/api/sync", "the base URL alone must never be the POST target");
	} finally {
		server.close();
	}
});

test("postEvents strips a trailing slash on the base URL instead of producing a double slash", async () => {
	let requestedPath = null;
	const server = createServer((req, res) => {
		requestedPath = req.url;
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: 1, rejected: 0 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		await postEvents({
			apiUrl: `http://127.0.0.1:${port}/`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }],
		});

		assert.equal(requestedPath, "/api/sync");
	} finally {
		server.close();
	}
});

test("postEvents does not double-append /api/sync when the base URL already ends with it", async () => {
	let requestedPath = null;
	const server = createServer((req, res) => {
		requestedPath = req.url;
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: 1, rejected: 0 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		await postEvents({
			apiUrl: `http://127.0.0.1:${port}/api/sync`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }],
		});

		assert.equal(requestedPath, "/api/sync", "must not become /api/sync/api/sync");
	} finally {
		server.close();
	}
});

test("postEvents treats a 200 response that isn't JSON as a failure, not a success (R31: a wrong-path 200 silently dropped events)", async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<html><body>dashboard</body></html>");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const result = await postEvents({
			apiUrl: `http://127.0.0.1:${port}`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }],
		});

		assert.equal(result.sent, 0, "an HTML 200 must never be reported as a successful send");
	} finally {
		server.close();
	}
});

test("postEvents treats valid JSON without an `accepted` field as a failure", async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const result = await postEvents({
			apiUrl: `http://127.0.0.1:${port}`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }],
		});

		assert.equal(result.sent, 0, "JSON without the sync route's own shape must not read as success");
	} finally {
		server.close();
	}
});

test("postEvents reports sent from the server's accepted count, not from events.length (D21: the route skips malformed events)", async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: 1, rejected: 2 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const result = await postEvents({
			apiUrl: `http://127.0.0.1:${port}`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }, { requestId: "req_2" }, { requestId: "req_3" }],
		});

		assert.equal(result.sent, 1, "sent must be the server's accepted count, not the client's own events.length");
	} finally {
		server.close();
	}
});

test("postEvents surfaces the server's rejected count rather than hiding it (D21)", async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: 1, rejected: 2 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const result = await postEvents({
			apiUrl: `http://127.0.0.1:${port}`,
			secret: "shh",
			machineId: "machine-abc",
			events: [{ requestId: "req_1" }, { requestId: "req_2" }, { requestId: "req_3" }],
		});

		assert.equal(result.rejected, 2, "rejected must be surfaced on the return value, not silently dropped");
	} finally {
		server.close();
	}
});
