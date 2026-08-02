import type { Db, ObjectId } from "mongodb";

/** Name of the collection holding one row per assistant message. */
export const USAGE_EVENTS_COLLECTION = "usage_events";

/**
 * One assistant message's token usage, as stored. Aggregates only — no transcript content
 * ever reaches this collection.
 */
export interface UsageEventDocument {
	// Typed as ObjectId rather than unknown: the driver's insert signature demands it,
	// and `unknown` makes every insertOne on this collection a type error.
	_id?: ObjectId;
	requestId: string;
	messageId: string;
	sessionId: string;
	projectSlug: string;
	machineId: string;
	// Opaque hash of the normalized git remote (D20) — absent, not null, when the project
	// directory's cwd isn't a git repo, or no longer exists. Never the remote URL itself.
	repoKey?: string;
	// Absent, not null, when a session predates the account ledger (D7) — every one of the
	// 201 real sessions today falls in this case, so this is the common shape, not an edge one.
	accountUuid?: string;
	orgUuid?: string;
	model: string;
	timestamp: Date;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
	outputTokens: number;
	costUsd: number;
	// Whether costUsd is trustworthy: false when the model is unpriced OR the timestamp was
	// missing. Never $max'd — see saveUsageEvents — since BSON orders false < true and a $max
	// boolean can only ratchet toward true, never demote a corrected resync back down.
	priced: boolean;
	isSubagent: boolean;
}

/**
 * Create the indexes the sync path depends on. Safe to call repeatedly.
 *
 * @param db - the connected database
 */
export async function ensureUsageIndexes(db: Db): Promise<void> {
	const collection = db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION);

	// The identity of a message. Unique so overlapping syncs from either machine collapse
	// instead of double-counting — this is what makes re-sending a range free.
	await collection.createIndex({ requestId: 1, messageId: 1 }, { unique: true, name: "message_identity" });

	// Every dashboard view slices by time, usually within one machine or project.
	await collection.createIndex({ timestamp: -1 }, { name: "by_time" });
	await collection.createIndex({ machineId: 1, timestamp: -1 }, { name: "by_machine_time" });
	await collection.createIndex({ projectSlug: 1, timestamp: -1 }, { name: "by_project_time" });

	// The session drill-down (Step 21) filters on sessionId alone; nothing else covers it, so
	// without this it's a full COLLSCAN over the whole collection on a shared M0. Ascending
	// timestamp too so the matched set comes back pre-sorted for the breakdown.
	await collection.createIndex({ sessionId: 1, timestamp: 1 }, { name: "by_session" });
}

/**
 * Upsert usage events, keyed on `(requestId, messageId)`.
 *
 * @param db - the connected database
 * @param events - events to write
 * @returns the number of events processed
 */
export async function saveUsageEvents(db: Db, events: UsageEventDocument[]): Promise<number> {
	if (events.length === 0) return 0;

	const operations = events.map((event) => {
		const {
			requestId,
			messageId,
			sessionId,
			projectSlug,
			machineId,
			repoKey,
			model,
			timestamp,
			isSubagent,
			inputTokens,
			cacheReadTokens,
			cacheWrite5mTokens,
			cacheWrite1hTokens,
			outputTokens,
			costUsd,
			...rest // priced, and accountUuid/orgUuid when known — always the mapper's latest determination
		} = event;

		return {
			updateOne: {
				filter: { requestId, messageId },
				update: {
					// First writer wins: identity of who ran a message, never re-stamped by a later
					// sync. D18 — a session forked from an earlier one must not migrate an inherited
					// message's cost out of the parent session's drill-down. repoKey joins this group
					// (D20) — it identifies which repository the message belongs to, not a count, and
					// is spread in only when present so an undefined value is never sent to Mongo.
					$setOnInsert: { sessionId, projectSlug, machineId, model, timestamp, isSubagent, ...(repoKey !== undefined && { repoKey }) },
					// $max, never $set: a sync that caught a message mid-stream carries partial
					// counts, and this makes that impossible to persist. Covers every token field,
					// not just output — the cache read-vs-write view depends on all of them. Cost
					// rises with output for the same message, so it is monotonic too.
					$max: { inputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens, outputTokens, costUsd },
					$set: rest,
				},
				upsert: true,
			},
		};
	});

	// Unordered so one rejected event cannot block the rest of the batch.
	await db.collection<UsageEventDocument>(USAGE_EVENTS_COLLECTION).bulkWrite(operations, { ordered: false });

	return events.length;
}
