import { type Db, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test } from "vitest";

import { closeDatabase } from "@/server/database";
import { POST } from "./route";

const SECRET = "route-test-secret";

let server: MongoMemoryServer;
let verifier: MongoClient;
let db: Db;

beforeAll(async () => {
	server = await MongoMemoryServer.create();
	process.env.MONGODB_URI = server.getUri();
	process.env.MONGODB_DB_NAME = "claude-usage-test";
	process.env.CLAUDE_USAGE_SECRET = SECRET;
	verifier = await MongoClient.connect(server.getUri());
	db = verifier.db("claude-usage-test");
});

afterAll(async () => {
	await closeDatabase();
	await verifier?.close();
	await server?.stop();
});

/** One wire-shaped event as a machine would send it — no machineId, that is batch-level. */
function usageEvent(overrides: Record<string, unknown> = {}) {
	return {
		requestId: "req_1",
		messageId: "msg_1",
		sessionId: "session-1",
		projectSlug: "personal/claude-usage",
		model: "claude-opus-5",
		timestamp: "2026-08-01T10:00:00.000Z",
		inputTokens: 0,
		cacheReadTokens: 400_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
		outputTokens: 1_505,
		costUsd: 0.225,
		priced: true,
		isSubagent: false,
		...overrides,
	};
}

function syncRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
	return new NextRequest("http://localhost/api/sync", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

test("a batch posted with the shared secret persists each event, stamping the batch's machineId onto every document while keeping each event's own account", async () => {
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-work",
				events: [
					usageEvent({ requestId: "req_a", messageId: "msg_a", accountUuid: "account-work", orgUuid: "org-work" }),
					usageEvent({ requestId: "req_b", messageId: "msg_b", accountUuid: "account-personal" }),
				],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 2, rejected: 0 });

	const stored = await db.collection("usage_events").find({}).sort({ requestId: 1 }).toArray();
	expect(stored).toHaveLength(2);
	expect(stored[0]).toMatchObject({ requestId: "req_a", machineId: "machine-work", accountUuid: "account-work", orgUuid: "org-work" });
	expect(stored[1]).toMatchObject({ requestId: "req_b", machineId: "machine-work", accountUuid: "account-personal" });
	expect(stored[1].orgUuid).toBeUndefined();
	expect(stored[0].timestamp).toBeInstanceOf(Date);
});

test("a hostile event carrying extra top-level fields and a client-supplied _id is stored with exactly the allowed key set, never leaking the extra fields or crashing on the immutable _id", async () => {
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-hostile",
				events: [
					usageEvent({
						requestId: "req_hostile",
						messageId: "msg_hostile",
						repoKey: "hostile-repo-hash",
						_id: "client-supplied-id",
						promptText: "SECRET-PROSE-SENTINEL",
						errorText: "some raw error output",
					}),
				],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });

	const stored = await db.collection("usage_events").findOne({ requestId: "req_hostile" });
	expect(stored).not.toBeNull();
	expect(Object.keys(stored as Record<string, unknown>).sort()).toEqual(
		[
			"_id",
			"requestId",
			"messageId",
			"sessionId",
			"projectSlug",
			"machineId",
			"repoKey",
			"model",
			"timestamp",
			"inputTokens",
			"cacheReadTokens",
			"cacheWrite5mTokens",
			"cacheWrite1hTokens",
			"outputTokens",
			"costUsd",
			"priced",
			"isSubagent",
		].sort(),
	);
	expect(stored?._id?.toString()).not.toBe("client-supplied-id");
	expect(stored?.repoKey).toBe("hostile-repo-hash");
});

test("re-posting the exact same batch does not change the stored total", async () => {
	const batch = {
		machineId: "machine-resend",
		events: [usageEvent({ requestId: "req_resend", messageId: "msg_resend" })],
	};

	await POST(syncRequest(batch, { "x-claude-usage-secret": SECRET }));
	const second = await POST(syncRequest(batch, { "x-claude-usage-secret": SECRET }));

	expect(await second.json()).toEqual({ accepted: 1, rejected: 0 });
	const stored = await db.collection("usage_events").find({ requestId: "req_resend" }).toArray();
	expect(stored).toHaveLength(1);
});

test("an empty events array is accepted and nothing is written", async () => {
	const response = await POST(
		syncRequest({ machineId: "machine-empty", events: [] }, { "x-claude-usage-secret": SECRET }),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 0, rejected: 0 });
	expect(await db.collection("usage_events").countDocuments({ machineId: "machine-empty" })).toBe(0);
});

test("a batch with a missing or non-string machineId is rejected as 400", async () => {
	const missing = await POST(syncRequest({ events: [usageEvent()] }, { "x-claude-usage-secret": SECRET }));
	expect(missing.status).toBe(400);

	const wrongType = await POST(
		syncRequest({ machineId: 42, events: [usageEvent()] }, { "x-claude-usage-secret": SECRET }),
	);
	expect(wrongType.status).toBe(400);
});

test("a batch with a missing or non-array events field is rejected as 400", async () => {
	const missing = await POST(syncRequest({ machineId: "machine-x" }, { "x-claude-usage-secret": SECRET }));
	expect(missing.status).toBe(400);

	const wrongType = await POST(
		syncRequest({ machineId: "machine-x", events: "not-an-array" }, { "x-claude-usage-secret": SECRET }),
	);
	expect(wrongType.status).toBe(400);
});

test("a malformed JSON body is a 400, not a crash", async () => {
	const request = new NextRequest("http://localhost/api/sync", {
		method: "POST",
		headers: { "content-type": "application/json", "x-claude-usage-secret": SECRET },
		body: "not json",
	});

	const response = await POST(request);

	expect(response.status).toBe(400);
});

test("the httpOnly session cookie authenticates a POST when no header is present", async () => {
	const response = await POST(
		syncRequest(
			{ machineId: "machine-cookie", events: [usageEvent({ requestId: "req_cookie", messageId: "msg_cookie" })] },
			{ cookie: `session=${SECRET}` },
		),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });
});

test("a request with no secret at all is rejected with 401, and nothing is written", async () => {
	const response = await POST(
		syncRequest({
			machineId: "machine-nosecret",
			events: [usageEvent({ requestId: "req_nosecret", messageId: "msg_nosecret" })],
		}),
	);

	expect(response.status).toBe(401);
	expect(await db.collection("usage_events").countDocuments({ requestId: "req_nosecret" })).toBe(0);
});

test("an event with an operator-valued requestId/messageId is rejected and never touches an unrelated stored document", async () => {
	// Proven live in ADVERSARIAL_REVALIDATION.md R7 part 2: requestId/messageId flow straight
	// into saveUsageEvents' updateOne FILTER, so a Mongo query operator as the "value" matches
	// an arbitrary existing document instead of failing to find one.
	await POST(
		syncRequest(
			{ machineId: "machine-victim", events: [usageEvent({ requestId: "req_victim", messageId: "msg_victim", costUsd: 1, accountUuid: "account-victim" })] },
			{ "x-claude-usage-secret": SECRET },
		),
	);
	const countBefore = await db.collection("usage_events").countDocuments({});

	const response = await POST(
		syncRequest(
			{
				machineId: "machine-attacker",
				events: [
					usageEvent({
						requestId: { $gt: "" },
						messageId: { $gt: "" },
						costUsd: 999_999,
						accountUuid: "INJECTED-PROSE",
					}),
				],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
	const victim = await db.collection("usage_events").findOne({ requestId: "req_victim" });
	expect(victim).toMatchObject({ costUsd: 1, accountUuid: "account-victim" });
	expect(await db.collection("usage_events").countDocuments({})).toBe(countBefore);
});

test("an event with wrong-typed values in other allowlisted fields is rejected wholesale, not stored with mixed types", async () => {
	// Proven live in ADVERSARIAL_REVALIDATION.md R7 part 3: model as {text:"..."}, sessionId as
	// an array, orgUuid as a number, and costUsd/outputTokens as objects (which poison every
	// $sum/$max) were all stored verbatim because the allowlist only checked key names.
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-hostile-types",
				events: [
					usageEvent({
						requestId: "req_typeconfusion",
						messageId: "msg_typeconfusion",
						model: { text: "SENTINEL-TRANSCRIPT-BODY" },
						sessionId: ["SENTINEL-A", "SENTINEL-B"],
						orgUuid: 12345,
						costUsd: { $numberDecimal: "1e9" },
						outputTokens: { bogus: true },
					}),
				],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
	expect(await db.collection("usage_events").findOne({ requestId: "req_typeconfusion" })).toBeNull();
});

test("an event with an unparseable timestamp is rejected rather than landing at 1970-01-01", async () => {
	// Cross-referenced in ADVERSARIAL_REVALIDATION.md R5/R41: an unparseable timestamp survives
	// as an Invalid Date, serialises to null over JSON, and `new Date(null)` rehydrates to the
	// epoch — silently mis-dated and excluded from every bounded dashboard range.
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-badtime",
				events: [usageEvent({ requestId: "req_badtime", messageId: "msg_badtime", timestamp: "not-a-date" })],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
	expect(await db.collection("usage_events").findOne({ requestId: "req_badtime" })).toBeNull();
});

test("a null entry in events[] is skipped rather than crashing the whole request with a 500", async () => {
	// Proven live in ADVERSARIAL_REVALIDATION.md R7 part 3: events: [null] threw an unhandled
	// TypeError reading a property off null and surfaced as a 500, discarding the whole batch.
	const response = await POST(
		syncRequest({ machineId: "machine-nullentry", events: [null] }, { "x-claude-usage-secret": SECRET }),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
});

test("a string entry in events[] is skipped rather than stored as an all-null junk row", async () => {
	// Proven live in ADVERSARIAL_REVALIDATION.md R7 part 3: events: ["a string"] returned 200
	// and inserted an all-null junk row dated 1970-01-01.
	const response = await POST(
		syncRequest({ machineId: "machine-stringentry", events: ["not an object"] }, { "x-claude-usage-secret": SECRET }),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
	expect(await db.collection("usage_events").findOne({ requestId: null })).toBeNull();
});

test("a batch mixing one hostile event with valid ones stores the valid ones and only rejects the hostile one — a bad event does not fail the whole batch", async () => {
	// Pins the D22 decision (DECISIONS.md): validation is per-event, not per-batch. If a single
	// malformed event instead failed the whole request, the two good events below would be
	// rejected right alongside the hostile one.
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-mixed",
				events: [
					usageEvent({ requestId: "req_mixed_good_1", messageId: "msg_mixed_good_1" }),
					usageEvent({ requestId: { $gt: "" }, messageId: "msg_mixed_bad" }),
					usageEvent({ requestId: "req_mixed_good_2", messageId: "msg_mixed_good_2" }),
				],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);

	expect(await response.json()).toEqual({ accepted: 2, rejected: 1 });
	expect(await db.collection("usage_events").findOne({ requestId: "req_mixed_good_1" })).not.toBeNull();
	expect(await db.collection("usage_events").findOne({ requestId: "req_mixed_good_2" })).not.toBeNull();
});

test("a wrong secret never causes the database to be contacted", async () => {
	// A syntactically invalid URI makes MongoClient's constructor throw synchronously the
	// moment anything (getDatabase/ensureUsageIndexes/saveUsageEvents) tries to connect. If
	// the auth check runs first, POST resolves cleanly to 401 and this line is never reached —
	// proving the DB was never even contacted, not merely that nothing was written.
	// closeDatabase() first is load-bearing: getDatabase memoizes its Db handle, so without
	// dropping it the earlier tests' live connection would be reused and the invalid URI never
	// read — the test would pass even if the route contacted the database before authenticating.
	await closeDatabase();
	const realUri = process.env.MONGODB_URI;
	process.env.MONGODB_URI = "not-a-valid-mongodb-uri";

	let response: Response;
	try {
		response = await POST(
			syncRequest(
				{ machineId: "machine-wrong", events: [usageEvent({ requestId: "req_wrong", messageId: "msg_wrong" })] },
				{ "x-claude-usage-secret": "totally-wrong-secret" },
			),
		);
	} finally {
		process.env.MONGODB_URI = realUri;
	}

	expect(response.status).toBe(401);
	// Belt-and-suspenders: also confirm nothing landed, via the separate always-real connection.
	expect(await db.collection("usage_events").countDocuments({ requestId: "req_wrong" })).toBe(0);
});

test("the session title survives the server's own allowlist and reaches the stored document", async () => {
	// The route rebuilds each event as a fresh object literal rather than trusting the client's,
	// so a field the mapper sends is dropped unless the route copies it too. Every other test here
	// writes through saveUsageEvents directly, which bypasses exactly that step — this one does not.
	const response = await POST(
		syncRequest(
			{
				machineId: "machine-title",
				events: [usageEvent({ requestId: "req_title", messageId: "msg_title", sessionTitle: "Migrate the test runner" })],
			},
			{ "x-claude-usage-secret": SECRET },
		),
	);
	expect(response.status).toBe(200);

	const stored = await db.collection("usage_events").findOne({ requestId: "req_title" });
	expect(stored?.sessionTitle).toBe("Migrate the test runner");
});
