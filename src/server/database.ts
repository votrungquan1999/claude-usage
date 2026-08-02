import { type Db, MongoClient } from "mongodb";

// Module-scoped singleton, no test-only export. The URI is read LAZILY inside
// getDatabase() — reading it at module scope would freeze it before a setup file runs.
let client: MongoClient | null = null;
let database: Db | null = null;

/**
 * Returns the shared Db handle, connecting lazily on first use.
 */
export async function getDatabase(): Promise<Db> {
	if (database) return database;
	const uri = process.env.MONGODB_URI;
	if (!uri) throw new Error("MONGODB_URI is not set");
	client ??= new MongoClient(uri, { maxPoolSize: 5 });
	database = client.db(process.env.MONGODB_DB_NAME || undefined);
	return database;
}

/**
 * Closes the pooled client. Called by test teardown so vitest can exit.
 */
export async function closeDatabase(): Promise<void> {
	await client?.close();
	client = null;
	database = null;
}
