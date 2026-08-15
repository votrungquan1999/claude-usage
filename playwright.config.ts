import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_DB_NAME, E2E_MONGODB_URI, E2E_PORT, E2E_SECRET, E2E_STORAGE_STATE } from "./e2e/e2e.env";

/**
 * Browser coverage for the dashboard's rendering layer, which `npx tsc --noEmit` is otherwise the
 * only check on. jsdom was rejected for this (see docs/features/claude-usage-dashboard-insights):
 * it returns zeros from getBoundingClientRect, so layout-dependent claims pass in the harness and
 * fail in a real browser.
 */
export default defineConfig({
	testDir: "./e2e",
	// Seeds the fixture database. Needs only mongod, so it does not depend on the dev server
	// having started — unlike the setup project below, which does.
	globalSetup: "./e2e/global-setup.ts",
	// A rendering assertion can fail on a slow first compile rather than on the thing under test.
	expect: { timeout: 10_000 },
	// Serial, on evidence rather than caution. All these tests drive ONE `next dev`, which compiles
	// routes on demand; five workers hitting it at once queue behind each other's compiles until
	// interactions time out. Measured: 5 workers = 42.7s with 3 flaky failures, 1 worker = 19.5s
	// green. Parallelism here was both slower and less reliable.
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	reporter: [["list"]],

	use: {
		baseURL: E2E_BASE_URL,
		trace: "retain-on-failure",
	},

	projects: [
		{
			// Logs in and seeds. A setup PROJECT rather than `globalSetup`, because this needs the
			// dev server to already be answering — and the relative order of globalSetup and
			// webServer is not something to depend on.
			name: "setup",
			testMatch: /.*\.setup\.ts/,
		},
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
			dependencies: ["setup"],
			// `mobile.spec.ts` is the phone project's own file (D26) and, from card #170 Step 2
			// onward, asserts phone-width-ONLY layout (e.g. controls stacking below `sm`) — true at
			// 390px, false at this project's desktop viewport. Without this, `chromium`'s default
			// testMatch would pick the file up too and fail on a viewport-dependent assertion that
			// was never meant to run here.
			testIgnore: /mobile\.spec\.ts/,
		},
		{
			// Phone-width coverage (card #170 D8): Chromium at 390×844 with touch enabled, not a
			// WebKit device preset — see D8 for why (no new browser binary, layout math is
			// engine-independent, hasTouch is what tap() actually needs). Scoped to its own spec
			// file via testMatch (D26): unscoped, this would run the whole existing suite at phone
			// width before the mobile layout fixes later in the plan land.
			name: "mobile",
			testMatch: /mobile\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 390, height: 844 },
				hasTouch: true,
				storageState: E2E_STORAGE_STATE,
			},
			dependencies: ["setup"],
		},
	],

	webServer: {
		// `next dev` rather than build+start: this run is about what renders, not about production
		// output, and a build would be far slower for the same answer.
		command: `npx next dev --port ${E2E_PORT}`,
		// /login is the one route the proxy does not redirect, so it answers 200 without auth.
		url: `${E2E_BASE_URL}/login`,
		// Never adopt a server the operator already had running — its env would be theirs, and it
		// would be pointed at the REAL database.
		reuseExistingServer: false,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			// Its own build directory. Sharing `.next` with the operator's dev server hangs both.
			NEXT_DIST_DIR: ".next-e2e",
			// Set explicitly, not inherited: this is what keeps the run off the real corpus. The
			// db NAME override wins over any path in a .env MONGODB_URI.
			MONGODB_URI: E2E_MONGODB_URI,
			MONGODB_DB_NAME: E2E_DB_NAME,
			CLAUDE_USAGE_SECRET: E2E_SECRET,
		},
	},
});
