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

### A second, isolated fixture backs the turn timeline

`e2e/fixtures/session-timeline.ts` seeds one standalone session (6 turns, dated 400 days back) through the same `saveUsageEvents` path as the shared corpus, but never merges into `corpus.ts` and is never imported by its own spec — `session-timeline.spec.ts` hardcodes the session id as a literal, matching `machine-sync.spec.ts`'s own precedent of not importing fixture identifiers even when they're exported. The reason is combinatorial, not stylistic (card #161 D12): seven existing specs (`dashboard`, `corpus`, `splits`, `window`, `url-state`, `sessions`, `drilldown`) assert exact literal totals derived from the shared corpus, and adding turns to any session already in it moves those literals. An isolated fixture sidesteps that entirely; a shared one would have needed every one of those seven files re-derived.

**The shared corpus's own token counts are unrelated to its `costUsd` figures** (`n × $0.25`, chosen for exact-binary totals — see above), so a carry/new split computed against an old corpus session will not reconcile to that session's stored cost. This is the other reason the turn timeline needed its own fixture rather than reusing the corpus: reconciling `carry + new` back to `costUsd` is the whole thing under test, and the shared corpus was never built to make that hold.

### Assert figures, not "something changed"

Narrowing to a 7-day window asserts a specific `$31.50`, not merely that the number moved. A card that re-rendered stale rows would pass the looser check.

Expected values are **literals in the test**, never imported from the fixture module — deriving them makes the test agree with the fixture by construction.

### Selectors: role, then text, then `data-testid` — and there are none

Where a tier-1 selector was missing, the **accessibility gap was fixed** rather than worked around: both `Select` triggers now carry an `aria-label`, because their only text is the current value and they otherwise announce as "combobox, Last 30 days" — saying what is chosen but never what it chooses.

Where structure sufficed, real ARIA was used: `role="tabpanel"` scopes the split tables, and a unique `Cost in range` column header scopes the session list.

One trap worth knowing: the pager's anchors go through base-ui's `Button` with `nativeButton={false}`, which stamps `role="button"` on them — so they are not `link`s in the accessibility tree despite being `<a href>`. (A second trap used to live here — `CardTitle` rendered a plain `<div>`, so card titles were not headings — closed by F3; see *Gaps found here, since closed* below.)

### The e2e suite runs serially, and that is faster

`workers: 1`, on measurement rather than caution. Every test drives one `next dev`, which compiles routes on demand; parallel workers queue behind each other's compiles until interactions time out. Five workers: **42.7s with 3 flaky failures**. One worker: **19.5s green**. Parallelism here was both slower and less reliable.

### Two allowlists, and a test that touches only one proves nothing

`saveUsageEvents` is not the write path the machines use — `POST /api/sync` is, and it rebuilds every event as a fresh object literal, so a field the mapper sends is silently dropped unless the route copies it too.

A field added to the mapper and covered only by tests that call `saveUsageEvents` directly will pass everywhere and still never reach Mongo in production. `sessionTitle` did exactly that. Any new event field needs a test that goes **through the route**.

### Wait for each navigation to land before the next interaction

Two URL-writing controls used back-to-back race: the second reads `useSearchParams` before the first navigation has committed and rebuilds the query without the first's key. Asserting `toHaveURL` between steps is what makes a multi-step journey test the journey rather than the race.

## Gaps found here, since closed

Neither was a test problem; the e2e work is what exposed both, and card #161 closed both.

- **No heading structure — closed (F3, D5/D15).** `CardTitle` now takes an optional `level?: "h2" | "h3"` prop defaulting to `h2` — every one of the 9 existing call sites needed no change. `h1` is deliberately excluded from the union: every page's own `<h1>` is hand-rendered outside `CardTitle`, and letting `level` reach `h1` would let a call site silently create a second top-level heading. `card.tsx` is shadcn-generated, so a future `shadcn add card` can still revert it silently — the e2e heading assertions (`getByRole("heading", {level, name})`, across `dashboard.spec.ts`, `sessions.spec.ts`, `drilldown.spec.ts`, all 9 call sites) are what makes that revert loud, which is why they are required rather than optional coverage.
- **A race between two URL-writing controls — closed (F4, D6/D8/D16).** Selecting a window and immediately clicking a split tab used to lose the window. One shared writer (`src/app/url-navigation.state.tsx`'s `useUrlWriter`) now backs all three URL-writing hooks, replacing four local patches that each read a stale `useSearchParams()` snapshot. The regression test fires two controls' clicks with no `await` between them (`Promise.all`, not sequential) and asserts the combined end-state URL via an auto-retrying `toHaveURL` — a real race drops one key and the assertion times out rather than passing on a false positive. Not every pair of controls can prove this: setting a preset or a sort always clears `page` by design (the pager's own clearing rule), so racing `(preset, page)` or `(sort, page)` could never fail regardless of whether the underlying race is fixed — `(preset, tab)` is the pair the test actually races, being the one cross-hook pair with no page-clearing interaction. A real trap worth knowing before adding a similar test elsewhere.

## Known app-level gaps this surfaced

Recorded because the e2e work (and, for the first one, adversarial testing after it shipped) is what exposed them.

- **The visible split tab can lag the URL.** `SplitTabs` is an uncontrolled `<Tabs defaultValue={...}>`. A URL change that happens without a tab click — browser back/forward landing on a URL with a different `tab=`, or the losing side of a race between a tab click and another control — does not move the visible selection until the next reload. Known and accepted (D8); adversarial testing confirmed it is still there and that it self-heals once the URL settles (the visible tab and the address bar agree again without a reload), so the disagreement window is real but transient (sub-2-second in testing).
- **A third racing control dropping a write — closed (R61).** Firing three controls with no `await` between any of them silently dropped the first-executed write in 7 of 10 runs, while the identical two-control race passed. The cause was not the race itself: `useUrlWriter` is called by three components that do **not** all mount in the same commit — the session list sits behind its own data fetch, so it can still be mounting while the range picker and split tabs are already interactive and already racing. React runs a fresh instance's effect once on mount, and the reconciling effect could not tell "my own late first mount, whose `searchParams` closure is already behind another writer's in-flight write" from "the URL changed externally, adopt it". The late writer's first effect therefore reset the shared bookkeeping to the pre-race value. Fixed with a per-instance ref so a writer's first-ever effect only initialises the shared value when it is still unset, never overwriting one another writer has already established; every later run reconciles as before. 10/10 after, with the two-control race and back/forward both re-verified. Ruled out by instrumentation rather than assumed: `isPending` re-renders and `searchParams` reference instability were both investigated and are not involved.

- **Locators over Recharts output are only as stable as the author's DOM-index arithmetic.** Recharts renders **no element at all** for a zero-valued bar, so a spec indexing into rendered bars is implicitly indexing rendered-and-nonzero ones. Adding `minPointSize` later makes every bar render, silently shifting each index by the number of preceding zeros — and two zero-valued series then land at the same screen position, where the later-declared one intercepts pointer events aimed at the other. This exact locator has now been got wrong twice for this reason, once when written and once when `minPointSize` was added. Re-derive the indices from a real DOM dump whenever anything changes which values Recharts draws.

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
