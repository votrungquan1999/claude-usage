# How this repo runs its tests

A living spec for the test harness itself — which runner owns what, and the conventions a new test is expected to follow.

The features under test have their own specs: [`../claude-usage-sync-dashboard/spec.md`](../claude-usage-sync-dashboard/spec.md) (write path) and [`../claude-usage-dashboard-insights/spec.md`](../claude-usage-dashboard-insights/spec.md) (read path).

## The shape

Two harnesses, because they answer different questions.

**vitest**, with **two projects** declared in `vitest.config.ts`:

- **`cli`** — `tests/**/*.test.mjs`. The parser, the hooks, the installer, the sync uploader. Plain `.mjs`, no aliases, no transform needed.
- **`server`** — `src/**/*.test.ts`. Route handlers and queries, against a real `mongod` via `mongodb-memory-server`.

**Playwright**, in `e2e/`, driving a real Chromium against a real dev server and a seeded database.

```
npm test              # both vitest projects, one summary
npm run test:cli      # --project cli
npm run test:server   # --project server
npm run test:watch    # vitest, watching both
npm run test:e2e      # playwright
```

## Invariants

### Two projects, not one merged config

Only `server` carries the 60s timeouts, the `@` → `src` alias, and `MONGOMS_SYSTEM_BINARY`. Merging them would make the CLI suites — which run in milliseconds and never touch a database — inherit a mongod binary path and a timeout they have no use for.

### One runner, because `&&` hides failures

The repo previously ran `node --test tests/*.test.mjs && vitest run`. That `&&` meant a single CLI failure stopped the server suite from executing at all: 135 tests silently unreported behind one unrelated red. This was demonstrated, not theorised — mid-migration, with 17 CLI files broken, the new setup still reported every server test.

### `toStrictEqual`, never `toEqual` — this is load-bearing

`toEqual` **ignores properties whose value is `undefined`**. The event mapper's tests assert that only allowlisted fields leave this machine; a leaked field holding `undefined` passes `toEqual` silently. Confirmed by injection — leaking `cwd` out of the mapper produced exactly that, and only `toStrictEqual` caught it.

This is the aggregates-only guarantee, so treat any future "simplify to `toEqual`" as a regression, not a cleanup.

### A test that starts green proves nothing until something is injected

Some tests cannot have a meaningful red: the minimum implementation that made the *previous* test pass already covers them. Those are written anyway — they lock the rule down — but a green first run says nothing about whether the test can detect its own rule breaking.

The convention is to inject the plausible-wrong implementation into the **source** (never the test), run, and confirm that exactly the owning test fails. Both bucketing rules were pinned this way: moving the leftover days to the newest bucket failed exactly the test that forbids it, and always emitting a range label failed exactly the two tests that depend on single-day buckets staying bare dates.

State it in the notes when a test starts green. A silent green is indistinguishable from a test that asserts nothing.

### Failure messages must carry numbers

`expect(a < b, msg).toBeTruthy()` reports `expected false to be truthy`. On a timing or threshold assertion the number *is* the diagnostic, so the numeric matchers are used instead:

```js
expect(hookDuration, `hook took ${hookDuration}ms…`).toBeLessThan(DELAY_MS / 2);
```

vitest prefixes the message to the assertion error **and** appends a structural diff. A plain truthiness check throws the diff away. Reserve `toBeTruthy` for genuine truthiness of a value, not for a comparison.

### The child-process tests run real, untransformed code

`tests/hooks.test.mjs` and the sync suites `spawn(process.execPath, [hookPath])` — a real OS process at a real file path. Nothing vitest does affects the code under test; the runner only hosts the harness. That is *why* moving off `node --test` cost nothing in fidelity.

It also means these tests can assert things a function call cannot express: that a hook exits before its upload finishes, that a detached grandchild outlives it, and that the hook does not leave stdout open — which would hang Claude Code waiting for EOF.

### Timing budgets derive from their own delay

A test that waits on a real process must express its budget as a fraction of the delay it controls, never as a hardcoded number. A fixed poll window silently becomes too short the moment someone raises the delay — trading one flake for a worse one. See `tests/hooks.test.mjs`, where both the exit budget and the poll deadline are computed from `DELAY_MS`.

## e2e invariants

### The base URL must be `localhost`, never `127.0.0.1`

Next 16 treats them as **different origins** and blocks its own dev resources across them. The failure is silent and deeply misleading: the page renders, returns 200, logs no errors and 404s nothing — but the client runtime never loads, so **nothing hydrates**. Every control is inert and every interaction test fails for no visible reason.

Diagnose it by checking for React's fibre keys on a real node, not by reasoning about timing:

```js
Object.keys(document.querySelector("input")).filter((k) => k.startsWith("__react"));
```

Empty means not hydrated. Do **not** "fix" this with `allowedDevOrigins` in `next.config.ts` — that weakens a genuine safety default in a production file to accommodate a test.

### The run may only ever touch `claude-usage-e2e`

`claude-usage` holds the only copy of the backfill. The database name is set explicitly in `webServer.env` (the name override beats any path in a `.env` connection string), and `global-setup.ts` refuses to run if it is pointed at the production name.

That guard forced the constant to be annotated `: string`. Left as a literal type, TypeScript proves the comparison can never be true and rejects it (TS2367) — and deleting the check to satisfy the compiler would remove the one thing standing between a typo and unrecoverable data loss.

### A fixed database name, dropped per run — never a timestamped one

This mongod already carries ~300 orphaned `ai-rules-e2e-<timestamp>` and `lms-test-<uuid>` databases from other projects, because a unique-name-per-run scheme has nowhere to clean up from once a run dies. A fixed name cannot accumulate.

### The fixture is seeded through `saveUsageEvents`

Not `insertMany`. Taking the same path as the sync endpoint means the fixture cannot drift from the real document shape.

Its costs are multiples of `$0.25` — exact in binary — so the total is exactly `$116.25` and assertions can be literal strings rather than tolerances.

**Every event sits a whole number of days before `now`.** No offset arithmetic and no fixed clock time, which makes it right in every timezone at once. Both halves are load-bearing, and the second was learned the hard way:

- Counting days in **UTC** is correct only until 17:00 UTC, after which it is already tomorrow in Ho Chi Minh and every window assertion shifts by a day. That is why the fixture originally shifted into UTC+7 before reading date components.
- Placing them at a **fixed hour** — 03:00 UTC, chosen as safely mid-morning local — put day-zero events in the FUTURE for the first three hours of every UTC day. The dashboard clamps every window to `[earliest, now]`, so three sessions silently fell outside it and **7 of 15 e2e tests failed between 00:00 and 03:00 UTC**, on a fixture whose figures are asserted as exact literals. Discovered at 02:32 UTC by a run that was expected to be green.

Subtracting whole days from `now` itself avoids both: day zero lands on `now`, always in the past by the time a page loads, and day *n* lands on the same clock time *n* days earlier, which is the same calendar date in every zone.

### Assert figures, not "something changed"

Narrowing to a 7-day window asserts a specific `$31.50`, not merely that the number moved. A card that re-rendered stale rows would pass the looser check.

Expected values are **literals in the test**, never imported from the fixture module — deriving them makes the test agree with the fixture by construction.

### Selectors: role, then text, then `data-testid` — and there are none

Where a tier-1 selector was missing, the **accessibility gap was fixed** rather than worked around: both `Select` triggers now carry an `aria-label`, because their only text is the current value and they otherwise announce as "combobox, Last 30 days" — saying what is chosen but never what it chooses.

Where structure sufficed, real ARIA was used: `role="tabpanel"` scopes the split tables, and a unique `Cost in range` column header scopes the session list.

Two traps worth knowing: `CardTitle` renders a plain `<div>`, so card titles are **not** headings; and the pager's anchors go through base-ui's `Button` with `nativeButton={false}`, which stamps `role="button"` on them — so they are not `link`s in the accessibility tree despite being `<a href>`.

### The e2e suite runs serially, and that is faster

`workers: 1`, on measurement rather than caution. Every test drives one `next dev`, which compiles routes on demand; parallel workers queue behind each other's compiles until interactions time out. Five workers: **42.7s with 3 flaky failures**. One worker: **19.5s green**. Parallelism here was both slower and less reliable.

### Two allowlists, and a test that touches only one proves nothing

`saveUsageEvents` is not the write path the machines use — `POST /api/sync` is, and it rebuilds every event as a fresh object literal, so a field the mapper sends is silently dropped unless the route copies it too.

A field added to the mapper and covered only by tests that call `saveUsageEvents` directly will pass everywhere and still never reach Mongo in production. `sessionTitle` did exactly that. Any new event field needs a test that goes **through the route**.

### Wait for each navigation to land before the next interaction

Two URL-writing controls used back-to-back race: the second reads `useSearchParams` before the first navigation has committed and rebuilds the query without the first's key. Asserting `toHaveURL` between steps is what makes a multi-step journey test the journey rather than the race.

## Known app-level gaps this surfaced

Neither is a test problem; both are recorded because the e2e work is what exposed them.

- **No heading structure.** Below the single `<h1>`, none of the six dashboard cards is a heading — `CardTitle` is a `<div>`. A screen-reader user cannot navigate between them.
- **A real race between URL-writing controls.** Selecting a window and *immediately* clicking a split tab loses the window. Low severity, genuinely there.

## Things these harnesses cannot tell you

- **jsdom was considered and rejected** (card #132), and Playwright is why it was never needed. `getBoundingClientRect` returns zeros under jsdom, so a chart axis tick "survives" in the test while a real browser deletes it.
- **Nothing asserts what the charts look like.** The e2e suite reads the totals tables, the URL and the session list. Bar geometry, colour distinguishability and axis crowding are still unverified — see the three open questions in the dashboard-insights spec.
- **`tsc` is the only static gate.** There is no eslint, biome or prettier config in this repo, and no lint script. Vitest does not type-check, so `npx tsc --noEmit` is not optional — and it is in no npm script.
- **No test tells you the SHAPE of an attribution answer.** Unit tests prove each rule fires; only real transcripts show what the rules produce together. Dry-run against them before trusting a change — see below.
- **Nothing here tells you the SERVER is running the code you just wrote.** Every suite exercises the local tree. `bin/backfill.mjs` posts to a deployed server, which is whatever was last merged. A parser fix plus an undeployed store fix reports total success and silently changes nothing — see below.

## Dry-run the parser against real transcripts before trusting an attribution change

A scratch script importing `attributeTurns` / `dedupeAssistantTurns` / `turnCost` directly and walking `~/.claude/projects` answers *"what will this actually do"* in **about 7 seconds**, with no database, no network and nothing written.

It is what turned "93.1% of previously-unattributed spend now lands on a repository" from an estimate into a measurement — and it surfaced something no unit test was looking for: worktree directories appearing as their own slugs, which is what proved the Repo and Project tabs would finally diverge.

Every rule in `attribution.mjs` had a passing test before that run. None of them could have told you the answer was right.

## Tests inject the git lookup rather than building repositories

`tests/attribution.test.mjs` passes its own `lookup` function, so it needs no repositories on disk, shells out to nothing, and cannot go flaky on a machine where a fixture repo failed to initialise. `tests/repo.test.mjs` still drives real `git init`, because resolving a real remote is the thing it exists to prove — the split is deliberate: exercise git once, at the boundary that wraps it.

## `backfill done: 0 rejected, 0 failures` is not evidence the write took effect

That summary counts what the server **accepted**, never what it **stored**. A run posting 65,880 events with zero rejections still re-attributed almost nothing, because the deployed server was several commits behind and its upsert still had `projectSlug` in `$setOnInsert` — it took every event and discarded the changed fields. The exit code was 0.

Two things follow:

- **Client-side fixes to attribution are inert until the server ships.** The parser computes the answer; the upsert decides whether it is allowed to land. Deploy the store change *before* running a corrective backfill, not after.
- **Verify against the store, not the summary.** Count documents and group by the field you expected to change. The one number that made this visible was `distinct projectSlug` — 7 before, 18 after, when the dry run predicted ~19 with a completely different distribution.

### Confirming the deploy is live, before spending a backfill on it

Double-send one probe event with a different `projectSlug` each time, then read the stored value:

```sh
# same requestId/messageId twice, projectSlug "probe/before" then "probe/after"
mongosh "$URI" --quiet --eval \
  'const d = db.usage_events.findOne({requestId:"deploy_probe_1"}); print(d && d.projectSlug)'
```

`probe/after` means the `$set` upsert is live; `probe/before` means the deployed build still has the field in `$setOnInsert`. Delete the probe afterwards. Two seconds, one throwaway document, and it is the only check that distinguishes "deployed" from "pushed" — a corrective backfill against a stale build costs ten minutes and reports complete success.

## Known coverage gap

Inverting the dedupe comparison in `src/parser/dedupe.mjs` fails exactly **one** test. No other fixture contains streaming duplicates, so nothing else exercises it. Pre-existing; recorded here because a single-test guard on the max-`output_tokens` rule is thinner than it looks.

## Where the reasoning lives

Decisions and the injection results are on AI-Kanban cards **#142** (test runner and e2e) and **#143** (session titles, machine setup, chart bucketing, per-turn attribution). Several entries on #143 are marked outdated and superseded — read the supersession chain, not just the first match, because two decisions there still read "NOT YET BUILT" and are wrong.

The same material, plus what the cards do not carry, is in `tmp/claude-usage-test-runner/` while that workspace survives:

- `DECISIONS.md` — each choice with the alternative it beat, which the code never records
- `JOURNAL.md` — findings, open questions, and the commands that took several attempts
- `IMPLEMENTATION_PROGRESS.md`, `PLAN.md` — what was built, in what order
