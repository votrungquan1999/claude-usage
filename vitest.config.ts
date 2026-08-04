import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two projects rather than one merged config. They test genuinely different things and need
 * different environments: the `cli` suites drive plain `.mjs` and real child processes, while
 * `server` spins up a real mongod. Merging them would force the CLI tests — which run in
 * milliseconds — to inherit a 60s timeout and a mongod binary path they never use.
 */
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "cli",
					// Parser, hooks, installer and sync CLI. These spawn REAL node processes at real
					// file paths, so nothing here is transformed by vitest — the runner only hosts
					// the harness.
					include: ["tests/**/*.test.mjs"],
				},
			},
			{
				resolve: {
					// Vitest does not read tsconfig "paths"; route handlers importing "@/server/..."
					// fail to resolve without this mirror of tsconfig.json's "@/*" mapping.
					alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
				},
				test: {
					name: "server",
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
			},
		],
	},
});
