import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { runBackfill } from "../bin/backfill.mjs";

/** A fake $HOME carrying only what backfill needs: the machine id from ~/.claude.json. */
function fakeHome({ machineId = "machine-abc" } = {}) {
	const home = mkdtempSync(join(tmpdir(), "claude-usage-backfill-home-"));
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(join(home, ".claude.json"), JSON.stringify({ machineID: machineId }));
	return home;
}

function writeTranscript(dir, filename, records) {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, filename);
	writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
	return path;
}

function assistantRecord({ requestId, messageId, sessionId, timestamp, cwd, isSidechain = false, prose = "hi" }) {
	return {
		type: "assistant",
		requestId,
		sessionId,
		isSidechain,
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

/** Captures received request bodies; responds 200 immediately. 404s any path other than
 * /api/sync (R31: a wrong path must never be mistaken for the real sync route). */
function startFakeServer() {
	const received = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			received.push(JSON.parse(body));
			if (req.url !== "/api/sync") {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end("<html><body>Not Found</body></html>");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: JSON.parse(body).events.length }));
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve({ server, url: `http://127.0.0.1:${port}`, received });
		});
	});
}

test("walks a project's main transcript and posts its events to the sync endpoint", async () => {
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_1",
			messageId: "msg_1",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		expect(received).toHaveLength(1);
		expect(received[0].machineId).toBe("machine-abc");
		expect(received[0].events[0].requestId).toBe("req_1");
	} finally {
		server.close();
	}
});

test("posts repoKey once per project directory when its cwd is a real git repo", async () => {
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));

	const repoDir = mkdtempSync(join(tmpdir(), "claude-usage-backfill-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	execFileSync("git", ["remote", "add", "origin", "https://github.com/org/repo.git"], { cwd: repoDir });

	const projectDir = join(projectsRoot, "-Users-me-repo-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_repo",
			messageId: "msg_repo",
			sessionId: "session-repo",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: repoDir,
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		expect(received[0].events[0].repoKey, "expected a sha256 hex digest").toMatch(/^[0-9a-f]{64}$/);
	} finally {
		server.close();
	}
});

test("finds transcripts at every walk depth, including a subagent nested inside a workflow", async () => {
	// Real corpus shape: depth 7 main transcripts, depth 9 ordinary subagents
	// (<session>/subagents/agent-*.jsonl), depth 11 workflow-launched subagents
	// (<session>/subagents/workflows/wf_<id>/agent-*.jsonl). A walk hard-coded to two fixed
	// levels misses the depth-11 shape entirely.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	const cwd = "/Users/me/project";

	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({ requestId: "req_main", messageId: "msg_main", sessionId: "session-1", timestamp: "2026-08-01T10:00:00.000Z", cwd }),
	]);
	writeTranscript(join(projectDir, "session-1", "subagents"), "agent-a.jsonl", [
		assistantRecord({
			requestId: "req_sub",
			messageId: "msg_sub",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:01:00.000Z",
			cwd,
			isSidechain: true,
		}),
	]);
	writeTranscript(join(projectDir, "session-1", "subagents", "workflows", "wf_1"), "agent-b.jsonl", [
		assistantRecord({
			requestId: "req_workflow_sub",
			messageId: "msg_workflow_sub",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:02:00.000Z",
			cwd,
			isSidechain: true,
		}),
	]);
	// Workflow orchestration bookkeeping, never an assistant record — must not crash the walk
	// and must not itself require special-casing to stay excluded from the network payload.
	writeTranscript(join(projectDir, "session-1", "subagents", "workflows", "wf_1"), "journal.jsonl", [
		{ type: "started", at: "2026-08-01T10:02:00.000Z" },
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent, "all three assistant transcripts contributed their event").toBe(3);
		const requestIds = received.flatMap((body) => body.events.map((e) => e.requestId)).sort();
		expect(requestIds).toStrictEqual(["req_main", "req_sub", "req_workflow_sub"]);
	} finally {
		server.close();
	}
});

test("a transcript with no assistant turns triggers no request at all", async () => {
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		{ type: "user", sessionId: "session-1", cwd: "/Users/me/project", timestamp: "2026-08-01T10:00:00.000Z" },
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(0);
		expect(received, "an empty batch must not even attempt a round trip").toHaveLength(0);
	} finally {
		server.close();
	}
});

test("a project directory with no cwd-bearing transcript resolves no identity and is skipped, not crashed — and the skip is counted", async () => {
	// projectSlug is written $setOnInsert — a null written once can never self-correct on a later
	// re-run — so backfill must never send an event whose project identity failed to resolve.
	// The skip itself must also be visible in the summary: a bare, uncounted `continue` here is
	// harmless while the directory is genuinely empty, but invisible if a non-empty directory ever
	// hits the same branch (e.g. a main transcript deleted, leaving an orphaned subagent subtree).
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-empty-project");
	mkdirSync(projectDir, { recursive: true }); // exists, but holds zero transcripts

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(0);
		expect(received).toHaveLength(0);
		expect(summary.directoriesSkipped, "the null-slug directory is counted, not silently skipped").toBe(1);
	} finally {
		server.close();
	}
});

test("a file whose turns exceed the per-request cap splits into more than one request", async () => {
	// Vercel's request body cap is a hard, non-configurable 4.5 MB; 2,000 events/request (~1.1 MB)
	// is the pinned batch size. One request over the cap would fail outright past that limit.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	const cwd = "/Users/me/project";

	const TURN_COUNT = 2001;
	const records = [];
	for (let i = 0; i < TURN_COUNT; i++) {
		records.push(
			assistantRecord({
				requestId: `req_${i}`,
				messageId: `msg_${i}`,
				sessionId: "session-1",
				timestamp: "2026-08-01T10:00:00.000Z",
				cwd,
			}),
		);
	}
	writeTranscript(projectDir, "session-1.jsonl", records);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(TURN_COUNT);
		expect(received, "2,001 events at a 2,000 cap must split into two requests").toHaveLength(2);
		expect(received[0].events).toHaveLength(2000);
		expect(received[1].events).toHaveLength(1);
	} finally {
		server.close();
	}
});

test("a malformed line in a transcript is skipped, not fatal to the run", async () => {
	// Mirrors read.mjs's own truncated-tail tolerance: a record still being written mid-flush
	// reappears complete on the next read, so a bad line here must be silently dropped, not thrown.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	mkdirSync(projectDir, { recursive: true });
	const goodRecord = assistantRecord({
		requestId: "req_good",
		messageId: "msg_good",
		sessionId: "session-1",
		timestamp: "2026-08-01T10:00:00.000Z",
		cwd: "/Users/me/project",
	});
	writeFileSync(join(projectDir, "session-1.jsonl"), `not valid json {{{\n${JSON.stringify(goodRecord)}\n`);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		expect(received[0].events[0].requestId).toBe("req_good");
	} finally {
		server.close();
	}
});

test("re-running against the same corpus produces the same set of events", async () => {
	// No persisted done/checkpoint state exists — the store's $max upsert is the sole correctness
	// mechanism, and a full re-run is the intended recovery path. Backfill's own output must be
	// stable across runs for that upsert to actually converge rather than drift.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_1",
			messageId: "msg_1",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const env = { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" };
		const first = await runBackfill({ projectsRoot, home, env });
		const firstEvents = received.splice(0, received.length).flatMap((b) => b.events);

		const second = await runBackfill({ projectsRoot, home, env });
		const secondEvents = received.splice(0, received.length).flatMap((b) => b.events);

		expect(first.eventsSent).toBe(second.eventsSent);
		expect(secondEvents, "the exact same event payload is produced on both runs").toStrictEqual(firstEvents);
	} finally {
		server.close();
	}
});

test("only the mapper's aggregate fields ever leave the process — no raw transcript content", async () => {
	const SENTINEL = "the launch code is ALPHA-BRAVO-9182";
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
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
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		const rawBody = JSON.stringify(received[0]);
		expect(rawBody.includes(SENTINEL), "no raw prose in the request body").toBe(false);
		expect(rawBody.includes("cwd"), "no raw record field outside the mapper's allowlist").toBe(false);

		expect(
			Object.keys(received[0].events[0]).sort(),
			"only MappedUsageEvent fields leave this file — the aggregates-only guarantee",
		).toStrictEqual([
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
			].sort());
	} finally {
		server.close();
	}
});

test("reads the local account ledger once per run, attributing a backfilled event whose session is already known", async () => {
	const home = fakeHome();
	mkdirSync(join(home, ".claude", "claude-usage-state"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "claude-usage-state", "accounts.json"),
		JSON.stringify({
			"session-1": [{ from: "2026-07-01T00:00:00.000Z", accountUuid: "account-work", orgUuid: "org-work" }],
		}),
	);
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({
			requestId: "req_1",
			messageId: "msg_1",
			sessionId: "session-1",
			// After the ledger entry's `from` — the ledger, not a live oauthAccount read, must
			// supply the account for a backfilled (offline, already-finished) session.
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
		}),
	]);

	const { server, url, received } = await startFakeServer();
	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		expect(received[0].events[0].accountUuid).toBe("account-work");
		expect(received[0].events[0].orgUuid).toBe("org-work");
	} finally {
		server.close();
	}
});

test("a request that THROWS (dropped connection, not just a non-2xx response) for one file doesn't stop the run — later files still get processed and the failure is reported", async () => {
	// A non-2xx response is handled today via `response.ok`. A throw — a dropped connection, the
	// shared 5s AbortSignal.timeout, or a transcript vanishing between listing and reading — is a
	// different code path: it rejects the promise instead of resolving it. Without a try/catch
	// around the per-file work, that rejection propagates out of runBackfill entirely, aborting
	// every file not yet attempted.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({ requestId: "req_1", messageId: "msg_1", sessionId: "session-1", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
	]);
	writeTranscript(projectDir, "session-2.jsonl", [
		assistantRecord({ requestId: "req_2", messageId: "msg_2", sessionId: "session-2", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
	]);

	let requestCount = 0;
	const received = [];
	const server = createServer((req, res) => {
		requestCount++;
		if (requestCount === 1) {
			// Simulate a dropped connection: destroy the socket before any HTTP response is sent,
			// which makes `fetch` reject (`TypeError: fetch failed`) rather than resolve.
			req.socket.destroy();
			return;
		}
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			received.push(JSON.parse(body));
			if (req.url !== "/api/sync") {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end("<html><body>Not Found</body></html>");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: JSON.parse(body).events.length }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;

	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(received, "the second file's request still landed after the first threw").toHaveLength(1);
		expect(summary.eventsSent, "only the succeeding file's event is counted as sent").toBe(1);
		expect(summary.failures, "the thrown request is reported, not silently dropped or fatal").toHaveLength(1);
	} finally {
		server.close();
	}
});

test("reports which env vars are missing, and attempts no work at all, when unconfigured", async () => {
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	writeTranscript(join(projectsRoot, "-Users-me-project"), "session-1.jsonl", [
		assistantRecord({
			requestId: "req_1",
			messageId: "msg_1",
			sessionId: "session-1",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/me/project",
		}),
	]);

	const summary = await runBackfill({ projectsRoot, home, env: {} });

	expect(summary.missingConfig).toStrictEqual(["CLAUDE_USAGE_API_URL", "CLAUDE_USAGE_SECRET"]);
	expect(summary.filesProcessed, "must not even walk the corpus when unconfigured").toBe(0);
});

test("the CLI itself exits non-zero and names the missing vars when run unconfigured", () => {
	const home = fakeHome();
	const BACKFILL_BIN = join(import.meta.dirname, "..", "bin", "backfill.mjs");

	// CLAUDE_USAGE_API_URL/SECRET forced empty (not merely absent): process.loadEnvFile never
	// overwrites a key already present in process.env, even an empty one -- this keeps the
	// assertion true regardless of what .env resolveDotEnvPath's fallback might otherwise find
	// (this repo checkout's own real .env), so the test can never reach the real API/DB.
	const result = spawnSync(process.execPath, [BACKFILL_BIN], {
		env: { ...process.env, HOME: home, CLAUDE_USAGE_API_URL: "", CLAUDE_USAGE_SECRET: "" },
		encoding: "utf8",
	});

	expect(result.status, "unconfigured must exit non-zero, not read as success").toBe(1);
	const output = result.stdout + result.stderr;
	expect(output).toMatch(/CLAUDE_USAGE_API_URL/);
	expect(output).toMatch(/CLAUDE_USAGE_SECRET/);
});

test("a failed upload for one file doesn't stop the run — later files still get processed and the failure is reported", async () => {
	// A one-time run over ~2,000 files must survive a single flaky request; the operator re-runs
	// afterward to sweep only the reported stragglers rather than losing an otherwise-successful run.
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({ requestId: "req_1", messageId: "msg_1", sessionId: "session-1", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
	]);
	writeTranscript(projectDir, "session-2.jsonl", [
		assistantRecord({ requestId: "req_2", messageId: "msg_2", sessionId: "session-2", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
	]);

	let requestCount = 0;
	const received = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			requestCount++;
			received.push(JSON.parse(body));
			if (req.url !== "/api/sync") {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end("<html><body>Not Found</body></html>");
				return;
			}
			// The first request this test process makes fails; every one after succeeds.
			const status = requestCount === 1 ? 500 : 200;
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: status === 200 ? JSON.parse(body).events.length : 0 }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;

	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(received, "both files were attempted, not aborted after the first failure").toHaveLength(2);
		expect(summary.eventsSent, "only the succeeding file's event is counted as sent").toBe(1);
		expect(summary.failures, "the failed file is reported, not silently dropped").toHaveLength(1);
	} finally {
		server.close();
	}
});

test("runBackfill totals the server's rejected count across the run rather than hiding it (D21)", async () => {
	const home = fakeHome();
	const projectsRoot = mkdtempSync(join(tmpdir(), "claude-usage-backfill-projects-"));
	const projectDir = join(projectsRoot, "-Users-me-project");
	writeTranscript(projectDir, "session-1.jsonl", [
		assistantRecord({ requestId: "req_1", messageId: "msg_1", sessionId: "session-1", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
		assistantRecord({ requestId: "req_2", messageId: "msg_2", sessionId: "session-1", timestamp: "2026-08-01T10:01:00.000Z", cwd: "/Users/me/project" }),
	]);

	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (req.url !== "/api/sync") {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end("<html><body>Not Found</body></html>");
				return;
			}
			// Server accepts only 1 of the 2 submitted events (the route's own D21 skip-malformed behavior).
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: 1, rejected: 1 }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;

	try {
		const summary = await runBackfill({
			projectsRoot,
			home,
			env: { CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
		});

		expect(summary.eventsSent).toBe(1);
		expect(summary.eventsRejected, "rejected must be totalled and reported, not silently dropped").toBe(1);
	} finally {
		server.close();
	}
});

test("the CLI's printed summary names the rejected count, not just events sent (D21)", async () => {
	const home = fakeHome();
	writeTranscript(join(home, ".claude", "projects", "-Users-me-project"), "session-1.jsonl", [
		assistantRecord({ requestId: "req_1", messageId: "msg_1", sessionId: "session-1", timestamp: "2026-08-01T10:00:00.000Z", cwd: "/Users/me/project" }),
		assistantRecord({ requestId: "req_2", messageId: "msg_2", sessionId: "session-1", timestamp: "2026-08-01T10:01:00.000Z", cwd: "/Users/me/project" }),
	]);

	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (req.url !== "/api/sync") {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end("<html><body>Not Found</body></html>");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: 1, rejected: 1 }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	const BACKFILL_BIN = join(import.meta.dirname, "..", "bin", "backfill.mjs");

	try {
		// spawn, not spawnSync: the fake server above lives in THIS process's event loop, and
		// spawnSync blocks that event loop until the child exits -- the child's request would
		// never be accepted, deadlocking until the fetch timeout (proven while writing this test).
		const stdout = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [BACKFILL_BIN], {
				env: { ...process.env, HOME: home, CLAUDE_USAGE_API_URL: url, CLAUDE_USAGE_SECRET: "shh" },
			});
			let out = "";
			child.stdout.on("data", (chunk) => {
				out += chunk;
			});
			child.on("error", reject);
			child.on("close", () => resolve(out));
		});

		expect(stdout, "the operator must see rejected events, not just a lower sent count").toMatch(/1 rejected/);
	} finally {
		server.close();
	}
});
