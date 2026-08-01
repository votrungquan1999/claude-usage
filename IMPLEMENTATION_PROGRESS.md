# Implementation Progress: Claude Code usage tracking

Plan: [PLAN.md](./PLAN.md) · AI-Kanban #112 (local readout), #118 (sync + dashboard)

---

### Step 1: Report the true size and cost of the current session

**Status:** 🔄 In Progress — parser core done, golden test vs ccusage outstanding

**Tests Written (8 tests, all passing ✅):**

1. ✅ Streaming copies of one assistant message collapse to the MAX output_tokens
2. ✅ Context size is the last turn's input fields, not a sum across turns
3. ✅ Each cache tier is priced at its own multiplier
4. ✅ A model string carrying a `[1m]` suffix resolves to the 1M window
5. ✅ A model string carrying a `[1m]` suffix is priced (found a real bug — see notes)
6. ✅ Cost uses the price effective at the message's timestamp
7. ✅ Session total sums the cost of every deduped turn
8. ✅ Carry cost is context x input price x 0.1

**Notes:**

- Four modules, zero dependencies: `dedupe.mjs`, `models.mjs`, `pricing.mjs`, `session.mjs`.
- `dedupeAssistantTurns` returns a normalized `Turn` (`requestId`, `messageId`, `model`, `timestamp`, `usage`) rather than the raw record, so downstream modules don't reach through `message.usage`.
- **Bug caught by test 5:** pricing looked up the raw model string, so every real `claude-opus-5[1m]` turn priced at $0. Both the window lookup and the price lookup now go through `normalizeModel`.
- **Prices are unverified.** The table was written from memory, not checked against a source. Opus $15/$75 and Haiku 4.5 $1/$5 in particular need confirming, and Fable 5 has no entry at all (unknown models return $0, which fails silent). The ccusage golden test is what closes this.

**Outstanding for this step:** golden test asserting parser totals match `npx ccusage` on real history.
