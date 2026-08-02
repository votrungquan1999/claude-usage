# Plan: Claude Code usage tracking — local readout + cross-machine sync + dashboard

Implements AI-Kanban **#112** (local readout) and **#118** (sync + dashboard).

---

## 0. Shape

**One parser, four consumers, one new repo + one skill.**

```
personal/claude-usage/            # NEW repo — cloned on both machines
  src/parser/                     # shared core. zero deps, plain ESM
    read.mjs                      #   tail-read + full-read a transcript
    dedupe.mjs                    #   (requestId, message.id) -> MAX output_tokens
    pricing.mjs                   #   effective-dated price table
    session.mjs                   #   context size, per-turn cost, carry, warnings
    subagents.mjs                 #   walk <session-id>/subagents/agent-*.jsonl
  bin/statusline.mjs              # ONE line to stdout        (tail-read, <100ms)
  bin/report.mjs                  # deep readout, JSON+text   (full read)
  bin/sync.mjs                    # upload aggregates          (detached)
  bin/backfill.mjs                # one-shot whole history
  hooks/session-start.mjs         # inline sync
  hooks/user-prompt-submit.mjs    # dirty marker + detach      (<10ms)
  scripts/install.mjs             # symlink + patch ~/.claude/settings.json
  db/migrations/
  web/                            # Next.js dashboard (TS)
  tests/fixtures/*.jsonl          # synthesized, hand-built

AI-rules-repo/skills/claude-code/claude-usage/SKILL.md   # thin: shells to report.mjs
```

### Why a new repo and not AI-rules-repo

The statusline and the sync hooks must apply to **every** project on the machine, so they install into `~/.claude/settings.json` at user level — not per-project, which is all the AI-rules CLI does. Distribution is `git clone` + `git pull`, exactly the openclaw-ops pattern already running on this machine.

`scripts/install.mjs` symlinks the clone to **`~/.claude/claude-usage`** so every reference (statusline command, hooks, skill) uses one stable absolute path regardless of where each machine cloned it.

The **skill** is the exception — it goes in AI-rules-repo, because skills genuinely do distribute per-project via the CLI, and it is only a few lines pointing at `~/.claude/claude-usage/bin/report.mjs`.

### Language

`src/parser` + `bin/` + `hooks/` are **plain `.mjs` with JSDoc types, no build step**. A compile step means a forgotten `npm run build` after `git pull` silently breaks the statusline on the other machine. `web/` is normal TypeScript/Next.

---

## Phase 1 — Local readout (card #112)

### Step 1: Report the true size and cost of the current session

**AC:** Given a transcript, the parser returns context size, last-turn cost, carry cost, and session total, and its totals match `ccusage` on real history.
**Test type:** unit (synthesized fixtures) + one opt-in golden test vs ccusage.

Covers the four verified mechanics: MAX-`output_tokens` dedupe, context = last assistant record's three input fields (not a sum), cache tiers 0.1× / 1.25× / 2.0×, `[1m]` suffix stripping.

Pricing is **effective-dated from day one**, not a flat map — Sonnet 5's intro $2/$10 expires **2026-08-31** (~4 weeks out). Every price lookup takes the message timestamp.

### Step 2: See context and cost without asking, in the terminal

**AC:** `statusline.mjs` prints the #112 line in <100ms on a multi-MB transcript, and wiring it to `statusLine.command` shows it live.
**Test type:** unit on formatting + a timing assertion against a large fixture.

Tail-reads ~256KB. Deliberately **no session total on the line** — a running total needs the whole file; the line carries only what the tail can prove (context %, last turn, carry, warnings). Session total belongs to `report`.

### Step 3: Be warned before an expensive turn, not after

**AC:** The line flags cache-prefix invalidation (large `cache_creation` + small `cache_read`) and context crossing a threshold.
**Test type:** unit.

### Step 4: See what subagents cost, separately

**AC:** Subagent spend for the current session is walked from the nested path and rendered as a separate `+$X` term.
**Test type:** unit with a nested fixture tree.

### Step 5: Install it on a machine in one command

**AC:** `node scripts/install.mjs` symlinks to `~/.claude/claude-usage`, patches `~/.claude/settings.json` non-destructively, is idempotent, and backs up the settings file first.
**Test type:** integration against a temp `$HOME`.

### Step 6: Get the deep readout inside VSCode, where there is no status line

**AC:** The `claude-usage` skill returns a full breakdown for the current session in both terminal and extension.
**Test type:** manual invocation.

`statusLine` is CLI-only and the extension is proprietary + minified, so the skill is the *only* ambient-ish display that works in VSCode today.

### Step 7 (conditional): VSCode status bar bridge

Build **only if step 6 proves insufficient in daily use.** Thin wrapper shelling to `statusline.mjs`, inferring the session by newest-mtime `.jsonl`. Deferred by default.

---

## Phase 2 — Sync (card #118)

### Step 8: Store usage so a re-sync can never corrupt what is already there ✅ DONE

**AC:** `usage_events` keyed on `(requestId, messageId)` with a unique index; upsert uses `$max` on
`outputTokens` and `costUsd`; identity (`machineId`, `accountUuid`, `orgUuid`) and `isSubagent`
stored; time/machine/project indexes for the dashboard.
**Test type:** integration against a real `mongod`.

`$max` is the Mongo form of the planned `GREATEST` — a partial streaming count becomes impossible
to persist, so correctness stops depending on the reader.

### Step 9: Turn a parsed session into storable events

**AC:** A pure mapper takes deduped `Turn`s plus machine identity and returns `UsageEventDocument`s
— cost computed at map time from the price effective at each message's timestamp, subagent turns
flagged, 5m/1h cache tiers kept separate.
**Test type:** unit.

Cost is frozen at write time on purpose: Sonnet 5's intro rate expires **2026-08-31**, and
computing at query time would silently reprice all pre-expiry history.

### Step 10: Accept usage over the network without exposing the database

**AC:** `POST /api/sync` accepts `{ machineId, accountUuid, orgUuid, events[] }`, rejects a missing
or wrong `x-claude-usage-secret` with 401 before touching Mongo, and returns a count. Re-posting
the same batch changes nothing.
**Test type:** integration.

Constant-time compare via `timingSafeEqual`, mirroring `AI-rules-repo`. The route self-guards on
the header rather than relying on the edge proxy, so hooks keep working while pages stay gated.

### Step 11: Keep it fresh without a scheduler

**AC:** `SessionStart` syncs inline; `UserPromptSubmit` writes a dirty marker and returns in <10ms
with a genuinely detached upload; both fail silently.
**Test type:** integration + a latency assertion.

Detach must be `spawn(..., {detached:true, stdio:'ignore'}).unref()` — `& disown` is not enough,
Claude Code can wait on inherited fds.

### Step 12: Bring in the existing history

**AC:** `backfill.mjs` walks all history (~46K events) through the same parser, mapper and endpoint;
safe to re-run; batched so one request never carries the whole history.
**Test type:** integration.

---

## Phase 3 — Dashboard (card #118)

### Step 13: Get into the dashboard, and keep everyone else out

**AC:** `/login` posts the secret to `/api/auth`, which sets an httpOnly `session` cookie on a
constant-time match; an edge proxy redirects unauthenticated page requests to `/login`.
**Test type:** integration.

The edge proxy compares with plain `===` — `node:crypto` is unavailable in the edge runtime. The
constant-time compare guards *issuing* the cookie, which is the step that matters.

### Step 14: See spend broken down the ways that drive decisions

**AC:** Cost per day / machine / project / model; subagent share over time; cache read-vs-write
efficiency; session drill-down. Aggregation runs in Mongo, not in the page.
**Test type:** unit on the aggregation layer + e2e on the views.

UI is shadcn on **Base UI** (its default since 2026-07), style `base-nova`, `neutral` base colour,
dark-first.

Dropped from #118: the `~/.claude/usage-data/session-meta/*.json` join. That directory **no longer
exists** (verified 2026-08-01) — it was a one-off snapshot, not a live feed.

---

## 3. Risks

- **MAX-`output_tokens` dedupe** — highest risk in the whole build; a first-copy read undercounts output ~38% and misreports the headline by up to 200×. Pinned by a dedicated fixture and re-caught by the DB's `greatest(...)` upsert, so it is impossible to *persist* even if the reader regresses.
- **Tail-read straddling** — a 256KB window can cut a record mid-line and can split streaming copies. Discard the first partial line; only derive tail-safe values on the status line.
- **Pricing drift** — flat price maps silently reprice history the moment intro pricing expires. Effective-dating is not optional, and the expiry is ~4 weeks out.
- **Secrets on two machines** — DB key in `~/.claude/claude-usage/.env`, gitignored, never in the repo.
- **Settings patching** — `~/.claude/settings.json` is live config; back it up and merge, never rewrite.

---

## 4. Decisions taken for Phase 2

**DB host — MongoDB Atlas, the existing shared cluster.** Add `claude-usage` to `DATABASES` in
`personal-infra/resources/mongodb-atlas.ts`, which provisions a scoped `claude-usage-app` user on
the `personal-shared` M0 cluster (AWS Singapore, co-located with Vercel `sin1`) and emits a
connection string. That file's own comment describes this exact case — "one cluster, a database
+ user per app". A telemetry sidecar does not justify its own Atlas project. Infra lands via PR,
never a local `pulumi up`.

**Deployment — this repo becomes a Next.js app on Vercel**, serving both the sync API and the
dashboard. The zero-dep `src/parser/`, `bin/`, `hooks/` and `scripts/` stay exactly as they are;
Next.js only adds `src/app/`.

**Auth — one shared secret, two carriers**, mirroring `AI-rules-repo`:

- Machines send `x-claude-usage-secret` on `POST /api/sync`.
- The browser posts the secret once to `/api/auth`, which sets an httpOnly `session` cookie whose
  value *is* the secret; an edge proxy gates the dashboard by comparing that cookie.
- Constant-time `timingSafeEqual` in the node runtime; the edge proxy uses plain `===` because
  `node:crypto` is unavailable there. The proxy only guards pages — `/api/sync` self-guards on the
  header so the hooks keep working.

**UI — shadcn with Base UI** (the default since 2026-07), style `base-nova`, `neutral` base colour,
dark-first since it is a data dashboard.

**Account topology — still unanswered, and deliberately not blocking.** `accountUuid` is modelled
as a first-class field regardless, so adding a work account later needs no migration.

## 5. Phase 2 shape

```
POST /api/sync   { machineId, accountUuid, orgUuid, events: [...] }
                 -> bulkWrite of upserts, $max on outputTokens
GET  /api/stats  aggregation pipelines behind the session cookie
```

**Why an API rather than the machines talking to Mongo directly:** the hooks then hold only an
opaque app token, not database credentials. A leaked token can write usage rows; a leaked
connection string can drop collections. It also keeps the Mongo driver out of the zero-dep half.

**Mongo equivalents of the locked SQL rules:**

- PK `(requestId, messageId)` becomes a unique compound index and the upsert filter.
- The self-healing `GREATEST` becomes `{ $max: { outputTokens: … } }` — same guarantee, so a row
  written from a partial streaming record is corrected upward by any later sync.
- `bulkWrite(..., { ordered: false })` so one bad event cannot block the batch.
