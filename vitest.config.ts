import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// Spinning up a real mongod is slower than a unit test but far more honest than
		// mocking the driver — the upsert semantics are the thing under test.
		testTimeout: 60_000,
		hookTimeout: 60_000,
		env: {
			// Reuse the mongod already installed via homebrew instead of downloading one.
			MONGOMS_SYSTEM_BINARY: "/opt/homebrew/bin/mongod",
		},
	},
});
