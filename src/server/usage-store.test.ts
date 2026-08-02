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
		isSubagent: false,
		...overrides,
	};
}

test("two machines racing on the same message cannot create a duplicate row", async () => {
	// The upsert filter alone loses a race; only a unique index makes the key enforceable.
	await ensureUsageIndexes(db);

	const collection = db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION);
	await collection.insertOne(event({ requestId: "req_race", messageId: "msg_race" }));

	await expect(collection.insertOne(event({ requestId: "req_race", messageId: "msg_race" }))).rejects.toThrow(
		/duplicate key/i,
	);
});

test("a re-sync can only raise an output count, never lower it", async () => {
	// A sync that reads a mid-stream record carries a partial output count. The store must
	// make that impossible to persist, so correctness does not depend on the reader.
	await saveUsageEvents(db, [event({ outputTokens: 7 })]);
	await saveUsageEvents(db, [event({ outputTokens: 1_505 })]);
	await saveUsageEvents(db, [event({ outputTokens: 7 })]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.find({ requestId: "req_a", messageId: "msg_1" })
		.toArray();

	expect(stored).toHaveLength(1);
	expect(stored[0].outputTokens).toBe(1_505);
});
