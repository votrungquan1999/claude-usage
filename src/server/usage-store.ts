import type { Db } from "mongodb";

/** Name of the collection holding one row per assistant message. */
export const USAGE_EVENTS_COLLECTION = "usage_events";

/**
 * One assistant message's token usage, as stored. Aggregates only — no transcript content
 * ever reaches this collection.
 */
export interface UsageEventDocument {
	_id?: unknown;
	requestId: string;
	messageId: string;
	sessionId: string;
	projectSlug: string;
	machineId: string;
	accountUuid: string;
	orgUuid: string;
	model: string;
	timestamp: Date;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWrite5mTokens: number;
	cacheWrite1hTokens: number;
	outputTokens: number;
	costUsd: number;
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
		const { requestId, messageId, outputTokens, costUsd, ...rest } = event;

		return {
			updateOne: {
				filter: { requestId, messageId },
				update: {
					// $max, never $set: a sync that caught a message mid-stream carries a partial
					// output count, and this makes that impossible to persist. Cost rises with
					// output for the same message, so it is monotonic too.
					$max: { outputTokens, costUsd },
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
