import { MongoMemoryServer } from "mongodb-memory-server";
import { type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
	ensureUsageIndexes,
	saveUsageEvents,
	USAGE_EVENTS_COLLECTION,
	type UsageEventDocument,
} from "./usage-store";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
	server = await MongoMemoryServer.create();
	client = await MongoClient.connect(server.getUri());
	db = client.db("claude-usage-test");
});

afterAll(async () => {
	await client?.close();
	await server?.stop();
});

function event(overrides: Partial<UsageEventDocument> = {}): UsageEventDocument {
	return {
		requestId: "req_a",
		messageId: "msg_1",
		sessionId: "session-1",
		projectSlug: "-Users-me-work",
		machineId: "machine-1",
		accountUuid: "account-1",
		orgUuid: "org-1",
		model: "claude-opus-5",
		timestamp: new Date("2026-08-01T10:00:00.000Z"),
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

test("ensureUsageIndexes creates a compound index on sessionId and timestamp", async () => {
	// The session drill-down (Step 21) queries by sessionId; without this index it is a full
	// COLLSCAN over the whole collection on a shared M0.
	await ensureUsageIndexes(db);

	const indexes = await db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION).indexes();
	const bySession = indexes.find((index) => index.name === "by_session");

	expect(bySession?.key).toEqual({ sessionId: 1, timestamp: 1 });
});

test("two machines racing on the same message cannot create a duplicate row", async () => {
	// The upsert filter alone loses a race; only a unique index makes the key enforceable.
	await ensureUsageIndexes(db);

	const collection = db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION);
	await collection.insertOne(event({ requestId: "req_race", messageId: "msg_race" }));

	await expect(collection.insertOne(event({ requestId: "req_race", messageId: "msg_race" }))).rejects.toThrow(
		/duplicate key/i,
	);
});

test("a re-sync can only raise a stored count, never lower it", async () => {
	// A sync that reads a mid-stream record carries partial counts. The store must make that
	// impossible to persist, so correctness does not depend on the reader. Every count ratchets,
	// not just output — the cache read-vs-write view is computed from all of them.
	const partial = {
		inputTokens: 3,
		cacheReadTokens: 12,
		cacheWrite5mTokens: 1,
		cacheWrite1hTokens: 2,
		outputTokens: 7,
		costUsd: 0.001,
	};
	const complete = {
		inputTokens: 900,
		cacheReadTokens: 400_000,
		cacheWrite5mTokens: 5_000,
		cacheWrite1hTokens: 6_000,
		outputTokens: 1_505,
		costUsd: 0.225,
	};

	await saveUsageEvents(db, [event(partial)]);
	await saveUsageEvents(db, [event(complete)]);
	await saveUsageEvents(db, [event(partial)]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.find({ requestId: "req_a", messageId: "msg_1" })
		.toArray();

	expect(stored).toHaveLength(1);
	expect(stored[0].inputTokens).toBe(900);
	expect(stored[0].cacheReadTokens).toBe(400_000);
	expect(stored[0].cacheWrite5mTokens).toBe(5_000);
	expect(stored[0].cacheWrite1hTokens).toBe(6_000);
	expect(stored[0].outputTokens).toBe(1_505);
	expect(stored[0].costUsd).toBe(0.225);
});

test("a forked session cannot re-stamp who owns an already-synced message", async () => {
	// D18: the first writer's ownership fields (sessionId here) must win. Without this, a
	// session forked from an earlier one would migrate an inherited message's cost out of the
	// parent session's drill-down on its next resync.
	await saveUsageEvents(db, [
		event({ requestId: "req_ownership", messageId: "msg_ownership", sessionId: "session-parent" }),
	]);
	await saveUsageEvents(db, [
		event({ requestId: "req_ownership", messageId: "msg_ownership", sessionId: "session-fork" }),
	]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({ requestId: "req_ownership", messageId: "msg_ownership" });

	expect(stored?.sessionId).toBe("session-parent");
});

test("a resync cannot change a message's repoKey once the first sync recorded one", async () => {
	// D20: repoKey is an ownership field (which repository a message belongs to), not a count —
	// it must follow D18's first-writer-wins rule exactly like sessionId, or a later resync from
	// a machine that resolved a different (or no) repoKey could migrate a message's dashboard
	// grouping after the fact.
	await saveUsageEvents(db, [
		event({ requestId: "req_repo_key", messageId: "msg_repo_key", repoKey: "hash-a" }),
	]);
	await saveUsageEvents(db, [
		event({ requestId: "req_repo_key", messageId: "msg_repo_key", repoKey: "hash-b" }),
	]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({ requestId: "req_repo_key", messageId: "msg_repo_key" });

	expect(stored?.repoKey).toBe("hash-a");
});

test("a corrected resync can demote priced back to false", async () => {
	// priced must live in $set, never $max: BSON orders false < true, so a $max boolean can
	// only ratchet toward true and a corrected resync could never demote it back down.
	await saveUsageEvents(db, [event({ requestId: "req_priced_demote", messageId: "msg_priced_demote", priced: true })]);
	await saveUsageEvents(db, [
		event({ requestId: "req_priced_demote", messageId: "msg_priced_demote", priced: false }),
	]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({ requestId: "req_priced_demote", messageId: "msg_priced_demote" });

	expect(stored?.priced).toBe(false);
});
