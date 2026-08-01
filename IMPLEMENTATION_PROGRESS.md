# Implementation Progress: Claude Code usage tracking

Plan: [PLAN.md](./PLAN.md) · AI-Kanban #112 (local readout), #118 (sync + dashboard)

---

### Step 1: Report the true size and cost of the current session

**Status:** ✅ Done

**Tests Written (13 tests, all passing ✅):**

1. ✅ Streaming copies of one assistant message collapse to the MAX output_tokens
2. ✅ Context size is the last turn's input fields, not a sum across turns
3. ✅ Each cache tier is priced at its own multiplier
4. ✅ A model string carrying a `[1m]` suffix resolves to the 1M window
5. ✅ A model string carrying a `[1m]` suffix is priced
6. ✅ A model string carrying a dated suffix resolves to its window
7. ✅ Cost uses the price effective at the message's timestamp
8. ✅ Session total sums the cost of every deduped turn
9. ✅ Carry cost is context x input price x 0.1
10. ✅ Golden: reproduces ccusage cost for claude-sonnet-5
11. ✅ Golden: reproduces ccusage cost for claude-haiku-4-5
12. ✅ Golden: reproduces ccusage cost for claude-fable-5
13. ✅ Golden: prices Opus 5 within the bound ccusage implies

**Notes:**

- Four modules, zero dependencies: `dedupe.mjs`, `models.mjs`, `pricing.mjs`, `session.mjs`.
- `dedupeAssistantTurns` returns a normalized `Turn` (`requestId`, `messageId`, `model`, `timestamp`, `usage`) so downstream modules don't reach through `message.usage`.

**Three real bugs caught, all by tests:**

1. **Price table was wrong on every Opus model** — I had $15/$75; the real rate is **$5/$25**, a 3x overstatement. Caught by the golden test: Opus 5's all-5m cost *floor* came out at $659 against a real ccusage total of $254.75. Fable 5 was missing from the table entirely and priced at $0.
2. **`[1m]` suffix broke pricing** — the price lookup used the raw model string, so every live `claude-opus-5[1m]` turn cost $0.
3. **Dated suffix broke lookups** — `claude-haiku-4-5-20251001` missed both the window and price tables.

**How the prices were verified:** `ccusage daily --json` gives per-model tokens and cost. Solving for `(input, output)` such that the implied cache-creation multiplier lands in [1.25, 2.0] admits exactly one candidate per model — and models that only used 5m cache land on exactly 1.25, making the fit unambiguous. Verified table: Opus 5/4.8/4.7 $5/$25, Fable 5 $10/$50, Sonnet 4.6 $3/$15, Sonnet 5 $2/$10 intro then $3/$15, Haiku 4.5 $1/$5.

**Decided:** an unknown model renders `$?`, never `$0.00` — `isPricedModel` carries the signal.

---

### Steps 2-4: Status line, warnings, subagent spend

**Status:** ✅ Done

**Tests Written (11 tests, all passing ✅):**

1. ✅ Discards the partial line the tail window cuts through
2. ✅ Reads a multi-MB transcript in under 100ms
3. ✅ Renders context, last turn and carry as one line
4. ✅ Breaks subagent spend out of the turn cost rather than folding it in
5. ✅ Appends warnings without displacing the figures
6. ✅ Shows `?` rather than `$0.00` when a model has no known price
7. ✅ Takes context from the statusLine payload and turn cost from the transcript
8. ✅ Warns when a turn rewrites more cache than it reads
9. ✅ Warns when context is close enough to full that compaction is coming
10. ✅ Counts only subagent work done since the previous turn

**Design change — Claude Code already reports context.** The statusLine payload includes a
`context_window` block (`total_input_tokens`, `context_window_size`, `used_percentage`, and a
`current_usage` breakdown), so context size and the model's real window are handed to us and
never have to be inferred. The transcript is still needed for the **5m/1h cache split**, which
the payload omits and which the two write tiers price differently (1.25x vs 2.0x).

**Subagent attribution:** a single session's subagent transcripts can reach 85MB, so full reads
are impossible on a per-render path. Files untouched since the previous turn are skipped on
`mtime` alone; the rest are tail-read. Measured at 3.4ms across a real session.

**Verified live:** `◔ 18.9% (189K/1M) · turn $0.12 · carry $0.09/turn` on this session's own
2.98MB transcript in **36ms**, against a 100ms budget.

**Payload extras not yet used:** `rate_limits` carries 5-hour and 7-day subscription usage with
reset times — a natural status line addition, but out of scope for the current plan.

---

### Steps 5-6: Installer, report, skill

**Status:** ✅ Done

**Tests Written (6 tests, all passing ✅):**

1. ✅ Adds the status line without disturbing existing settings
2. ✅ Links the repo to a stable path and wires the status line
3. ✅ Re-running is safe and keeps a copy of what it replaced
4. ✅ Splits session spend by model so a cheap model's share is visible
5. ✅ Keeps the first record, which the tail reader deliberately drops
6. ✅ Finds the session's transcript even when the shell has cd'd elsewhere

**Bug caught by test 6:** the report resolved its project directory from `cwd`, so running it
from a subdirectory of the session's project looked in a folder with no transcript at all and
failed outright. `CLAUDE_CODE_SESSION_ID` is authoritative — search the project dirs for it
rather than deriving a path.

**Installer:** symlinks the checkout to `~/.claude/claude-usage` so settings, hooks and the
skill all reference one fixed path regardless of clone location. Patches `~/.claude/settings.json`
by merge, never rewrite, backing up first, and follows the file if it is itself a symlink.

**Skill:** `AI-rules-repo/skills/claude-code/claude-usage/SKILL.md`, a thin wrapper over
`bin/report.mjs`. Skills prime from the filesystem, so no manifest entry is needed. The
`.claude/skills/` dogfood copy is CLI-generated and was not touched.

**Verified live:** report reads this session's 3MB transcript in 78ms — 242 turns, $53.34.

**Note on strict TDD:** the installer's backup and idempotency were written alongside the first
installer test rather than driven by their own failing test, so test 3 was green on first run.
Tests 5 and 6 in Steps 2-4, and test 5 here, were likewise green from the start (trivial
delegation). Called out rather than papered over.
