import { MongoClient } from "mongodb";

import {
	ensureUsageIndexes,
	MACHINE_SYNC_STATE_COLLECTION,
	recordMachineSync,
	saveUsageEvents,
	USAGE_EVENTS_COLLECTION,
} from "../src/server/usage-store";
import { E2E_DB_NAME, E2E_MONGODB_URI } from "./e2e.env";
import { buildCorpus, MACHINE_IDS } from "./fixtures/corpus";

/** More than the dashboard's 12h staleness threshold, so this machine reads as stale. */
const STALE_HOURS_AGO = 13;
/** Well inside the 12h threshold, so this machine reads as fresh. */
const FRESH_HOURS_AGO = 1;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** The database holding the only copy of the backfill. Nothing here may ever open it for write. */
const PRODUCTION_DB_NAME = "claude-usage";

/**
 * Drops and re-seeds the e2e database before any test runs.
 *
 * Seeding lives in `globalSetup` rather than a setup project because it needs only mongod, not the
 * dev server — which removes any dependence on the relative order of the two.
 *
 * Written through `saveUsageEvents`, not a raw `insertMany`: the fixture then cannot drift from
 * the real document shape, because it takes the same path the sync endpoint does.
 */
export default async function globalSetup(): Promise<void> {
	if (E2E_DB_NAME === PRODUCTION_DB_NAME) {
		throw new Error(`refusing to seed: E2E_DB_NAME is the production database (${PRODUCTION_DB_NAME})`);
	}

	const client = await MongoClient.connect(E2E_MONGODB_URI);
	try {
		const db = client.db(E2E_DB_NAME);
		const now = new Date();

		// Dropped every run, so a fixture change can never leave stale documents behind to be
		// silently counted by the next run's assertions.
		await db.collection(USAGE_EVENTS_COLLECTION).deleteMany({});
		await ensureUsageIndexes(db);
		await saveUsageEvents(db, buildCorpus(now));

		// Same discipline as usage_events above (card #161): dropped every run, and timestamps built
		// relative to `now` rather than a fixed clock — corpus.ts's own history records exactly this
		// class of flakiness when seeding used a fixed hour instead.
		await db.collection(MACHINE_SYNC_STATE_COLLECTION).deleteMany({});
		// Through the real store function, not a raw insert, so the seed can never drift from the
		// document shape the live sync route actually writes.
		await recordMachineSync(db, MACHINE_IDS[0], 1, new Date(now.getTime() - STALE_HOURS_AGO * MILLISECONDS_PER_HOUR));
		await recordMachineSync(db, MACHINE_IDS[1], 1, new Date(now.getTime() - FRESH_HOURS_AGO * MILLISECONDS_PER_HOUR));
	} finally {
		await client.close();
	}
}
