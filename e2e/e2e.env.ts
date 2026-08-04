/**
 * Everything the e2e run needs to agree on: the port, the throwaway secret, and — most
 * importantly — the database it is allowed to touch.
 *
 * Shared by `playwright.config.ts` (which passes these to the dev server) and the setup project
 * (which logs in and seeds). Declared once so the two can never drift apart.
 */

/** Not 3000 — the operator usually has a dev server there, and two `next dev` on one port hang. */
export const E2E_PORT = 3100;

/**
 * `localhost`, NOT `127.0.0.1` — Next 16 treats them as different origins and blocks its own dev
 * resources across them ("Blocked cross-origin request to Next.js dev resource"). The page still
 * renders, so this looks like it works, but the client runtime never loads and NOTHING HYDRATES:
 * every control is inert and every interaction test fails for no visible reason.
 *
 * The alternative — `allowedDevOrigins` in next.config — would weaken a real safety default in a
 * production file to accommodate a test. Matching the origin costs nothing.
 */
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * A throwaway secret, only ever held by the e2e dev server. Deliberately NOT the deployed secret:
 * the real one lives in Pulumi and nothing here needs it. This one gates a local server holding
 * fabricated data, so it is not a credential in any meaningful sense.
 */
export const E2E_SECRET = "e2e-not-a-real-secret";

/**
 * A FIXED name, dropped and re-seeded on every run — never a timestamped one.
 *
 * The mongod on this machine already carries ~300 orphaned `ai-rules-e2e-<timestamp>` and
 * `lms-test-<uuid>` databases from other projects' suites, because a unique-name-per-run scheme
 * has nowhere to clean up from once the run dies. A fixed name cannot accumulate.
 */
// Annotated `string`, not left as a literal type. Without this TypeScript narrows it to
// "claude-usage-e2e" and rejects the production-database guard in global-setup.ts as a comparison
// that can never be true — which is exactly the check that must survive someone editing this line.
export const E2E_DB_NAME: string = "claude-usage-e2e";

export const E2E_MONGODB_URI = "mongodb://127.0.0.1:27017";

/** Where the authenticated browser state is cached between tests. */
export const E2E_STORAGE_STATE = "e2e/.auth/operator.json";
