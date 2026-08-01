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

**Open design question:** an unknown model currently returns $0 silently. See PLAN.md §4.
