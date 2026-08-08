import { MongoMemoryServer } from "mongodb-memory-server";
import { type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
	ensureUsageIndexes,
	MACHINE_SYNC_STATE_COLLECTION,
	recordMachineSync,
	saveUsageEvents,
	USAGE_EVENTS_COLLECTION,
	type MachineSyncStateDocument,
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

test("recordMachineSync accepts an injected `now`, so a seed fixture can stamp a historical timestamp rather than always the real current time", async () => {
	const historicalNow = new Date("2020-01-01T00:00:00.000Z");

	await recordMachineSync(db, "machine-historical", 1, historicalNow);

	const state = await db
		.collection<MachineSyncStateDocument>(MACHINE_SYNC_STATE_COLLECTION)
		.findOne({ _id: "machine-historical" });
	expect(state?.lastContactAt).toEqual(historicalNow);
	expect(state?.lastAcceptedAt).toEqual(historicalNow);
});

test("an out-of-order arrival (an earlier response landing after a later one) does not move lastContactAt or lastAcceptedAt backward — monotonic, not last-write-wins (card #161 R26)", async () => {
	// Proven live in ADVERSARIAL_REVALIDATION.md R26: a plain $set let a delayed/retried upload
	// that arrives out of order move the record BACKWARD, firing a false "stale" alarm on a
	// healthy machine. Every other field this store writes already guards against this ($max in
	// saveUsageEvents) — recordMachineSync must use the same discipline.
	const later = new Date("2026-08-08T10:05:00.000Z");
	const earlier = new Date("2026-08-08T10:00:00.000Z");

	await recordMachineSync(db, "machine-race", 1, later);
	await recordMachineSync(db, "machine-race", 1, earlier);

	const state = await db
		.collection<MachineSyncStateDocument>(MACHINE_SYNC_STATE_COLLECTION)
		.findOne({ _id: "machine-race" });
	expect(state?.lastContactAt).toEqual(later);
	expect(state?.lastAcceptedAt).toEqual(later);
});

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

test("a resync re-attributes a message's repository and project, so better attribution reaches rows already stored", async () => {
	// REVERSES D20's first-writer-wins rule for these two fields. That rule was written when
	// attribution was resolved once per project DIRECTORY, where a later sync could only be a
	// DIFFERENT guess, never a better one. Per-turn attribution makes a resync strictly better
	// informed, and a re-backfill is the only route by which history gets it — under the old rule
	// every one of the 55,158 stored events would have kept its "no repository" answer forever.
	//
	// D18's actual concern is sessionId — a session forked from an earlier one migrating an
	// inherited message out of its parent's drill-down — and that still never moves.
	await saveUsageEvents(db, [
		event({ requestId: "req_repo_key", messageId: "msg_repo_key", projectSlug: "git-repos/personal" }),
	]);
	await saveUsageEvents(db, [
		event({
			requestId: "req_repo_key",
			messageId: "msg_repo_key",
			projectSlug: "personal/quant-trading",
			repoKey: "hash-quant",
		}),
	]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({ requestId: "req_repo_key", messageId: "msg_repo_key" });

	expect(stored?.projectSlug).toBe("personal/quant-trading");
	expect(stored?.repoKey).toBe("hash-quant");
});

test("a resync that resolved NO repository leaves a recorded repoKey alone, rather than erasing it", async () => {
	// The machine that owns a repository can resolve it; another that has never checked it out
	// cannot. Re-attribution must be able to improve an answer without a less-informed sync being
	// able to blank one — same conditional-spread rule sessionTitle follows.
	await saveUsageEvents(db, [
		event({ requestId: "req_repo_keep", messageId: "msg_repo_keep", repoKey: "hash-known" }),
	]);
	await saveUsageEvents(db, [event({ requestId: "req_repo_keep", messageId: "msg_repo_keep" })]);

	const stored = await db
		.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION)
		.findOne({ requestId: "req_repo_keep", messageId: "msg_repo_keep" });

	expect(stored?.repoKey).toBe("hash-known");
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
