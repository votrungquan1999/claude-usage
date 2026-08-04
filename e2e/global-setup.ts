import { MongoClient } from "mongodb";

import { ensureUsageIndexes, saveUsageEvents, USAGE_EVENTS_COLLECTION } from "../src/server/usage-store";
import { E2E_DB_NAME, E2E_MONGODB_URI } from "./e2e.env";
import { buildCorpus } from "./fixtures/corpus";

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
		// Dropped every run, so a fixture change can never leave stale documents behind to be
		// silently counted by the next run's assertions.
		await db.collection(USAGE_EVENTS_COLLECTION).deleteMany({});
		await ensureUsageIndexes(db);
		await saveUsageEvents(db, buildCorpus(new Date()));
	} finally {
		await client.close();
	}
}
