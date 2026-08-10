# claude-usage dashboard: windows, splits, savings, sessions

A living spec for the dashboard's *reading* surface — what an operator can select, how what they select reaches every card, and which figures are honest about their own uncertainty.

The sync half (hooks, mapper, `/api/sync`, storage) is a separate feature with its own spec at [`../claude-usage-sync-dashboard/spec.md`](../claude-usage-sync-dashboard/spec.md). Nothing here touches the write path. Its invariants — aggregates only, the two allowlists, upsert ownership, the D17 lower-bound rule — still hold and are not restated.

## What the operator sees

`src/app/page.tsx` reads the whole view state out of the URL and composes six cards. It issues no card query itself: each card either runs its own or reads a `cache()`-wrapped shared loader.

- **Headline figures** (`kpi-cards/`) — spend today, month to date, projected month end.
- **Cost per day** (`cost-split-view/`) — a stacked bar chart plus an exact totals table, split four ways: machine, project, model, repository.
- **Subagent share of cost** (`efficiency/subagent-share-*`).
- **What caching saved** (`efficiency/cache-savings-*`) — net dollars per day.
- **Model mix over time** (`efficiency/model-mix-*`) — share of each day's spend.
- **Sessions in this range** (`session-list/`) — 25 a page, most expensive first, linking into `/session/[id]`.

Every totals-table row also links into `/split/[dimension]/[value]`, a drill-down with its own spec at [`../split-drilldown/spec.md`](../split-drilldown/spec.md). Two things here changed for it: `dashboardHref` is now a delegate to `pathHref`, so the shared pager stays on whichever page renders it; and a repository's label is resolved per WINDOW rather than per day — see the repoKey section below.

A session's own page (`/session/[id]`) is otherwise out of this file's scope, but the turn-by-turn carry-vs-new timeline card #161 added there (`turn-timeline.ui.tsx`) follows the same pricing and bucketing rules as the six cards above, so it is covered in the Invariants below rather than getting a page of its own.

## Invariants

Each of these was expensive to establish. Undoing one silently reintroduces what it was built to prevent — silently, in every case, which is why they are written down.

### The URL is the only source of view state

The window, the active split, and the session page all live in `searchParams`, read on the server by `parseDashboardRange`. Client components write with `router.replace` **inside a change handler**, never mirrored out of a `useEffect`. The parameter names are declared once, in `src/app/href.ts`, and imported by both the parser and the link builder.

A window comes from a **preset OR from explicit dates, never both**. `dashboardHref` clears whichever key it is not setting, because the parser resolves explicit dates ahead of any preset — leaving a stale `from`/`to` behind would make a preset click do nothing at all.

### `?tab=` is a closed allowlist, and that is a security boundary

The tab selects a `CostSplitDimension`, which `costPerDay` interpolates **straight into the aggregation as a field name**. An unvalidated value would let a URL split spend by an internal identity field the app never returns to the browser. `parseSplitTab` accepts only the four members of `SplitTab`; anything else is the default. This is the same bug class as the NoSQL operator injection the previous run caught on the write path.

### Every window is clamped to `[earliest recorded event, now]`

"All time" resolves through a min-timestamp lookup rather than running unbounded — every query must carry a time bound. The clamp also closes a hole that gap-fill opened: fill spans the *requested* range, so `?from=1970-01-01&to=2099-12-31` would otherwise synthesize roughly 47,000 day rows from a URL parameter. Both ends are clamped, not just the start.

### A parameter that could not be honoured is announced

A malformed, backwards, half-written, or out-of-range window falls back to the default **and the page says so**. A silently corrected parameter is a lie about which period is on screen — which is the class of quiet failure this whole feature exists to remove.

### Chart colour follows the dimension VALUE, over a window-independent domain

A value's colour comes from its rank in a domain computed over **at least a year, always ending at now** (`colorDomainWindow`), never from its rank inside the selected window. Assigning by current rank is the "recolor-on-filter" anti-pattern: widening the window repaints every survivor.

Two failure modes were found and fixed here, both invisible to tests:

- Tying the domain's **end** to the selected window's end reintroduces the bug from the other direction — a window ending in the past ranks over a domain missing everything since, so a recently-grown value is absent from one window's domain and top of another's.
- A window reaching further back than the lookback would leave its oldest values unranked, which falls back to rank-based colouring. The domain stretches to cover it.

### Shared loaders take primitives, and are wrapped once at module scope

`React.cache` memoises on argument **identity**. Three siblings passing freshly-built `{from, to}` objects run the query three times, silently, with nothing failing — and `Date` arguments fail exactly the same way. Every loader in `dashboard-loaders.ts` takes `number` milliseconds.

`cache()` also caches **thrown** errors, so one failed query is re-thrown to every consumer of a shared loader. That is why each card carries its own `CardErrorBoundary` — a hand-rolled class component, because Next's `error.tsx` only isolates at the route level and would blank the whole dashboard.

### Cache savings are NET, and net can be negative

Gross is what the reads saved. The write premium is what populating the cache cost **above** the base input price. Net is the difference, and on the real corpus it is negative on 2 of 53 days (worst: 2026-06-11 at −$1.98, from one 417K-token one-hour write barely read back). Nothing clamps it, and negative money reads as *"caching cost you $1.98"* — never `$-1.98`, which puts the sign in the wrong place. `gross × 0.96` is exact all-time and wrong at day granularity, where the ratio ranges from −18.19 to +0.986.

### Prices are effective-dated as UTC instants; a dashboard day is UTC+7

So a local day can straddle a price change — and `claude-sonnet-5` changes price on 2026-09-01. `dailyEfficiencyByModel` groups by **UTC day as well as local day**, prices each sub-row at its own rate, and sums them back. Pricing after the merge instead of before is the bug. It costs $0.00 today; from September it would have been wrong by up to 50% for seven hours of every affected day. The real corpus cannot exercise it, so there is a fixture that does.

### The repoKey hash never reaches the browser

`repoKey` is an unsalted SHA-256 over a normalised git remote — dictionary-confirmable, so an identifier rather than an opaque token. Every other split interpolates its own field as the row label; `Repo` reads `projectSlug` instead (`groupingFieldFor`) and labels each repository with the slug that carried the most of its events (ties: shortest, then alphabetical — see the drill-down spec for why length alone was unsafe).

The repo split also **inverts** the project split's rule for repo-less rows. On the Project tab each stands alone, so an unrelated project is never folded in just because both lack the field. On the Repo tab they all collapse into one `(unattributed)` bucket: "no repository" is the answer itself there, and spreading it across project names would hide exactly that.

**A repository's label is resolved across the whole window, not per day.** This reverses half of the rule above. Picking the label inside each *day's* merge named a repository after whichever checkout ran that day, so a worktree working a branch alone for a day named that day after itself — and since `rankDimensionTotals` groups by the label *string*, one repository then occupied **two ranked rows**, splitting its cost. The merge grouping is still per (day, repoKey), which is what draws one bar per day; only the label is window-wide, so it never depends on Mongo's row order. Consequence: a repo that used to show as two rows now shows as one.

**The daily split groups by repoKey as part of its key, not `$first`.** A folder can carry several repositories' keys — or a mix of "has one" and "has none" — since per-turn attribution, and keeping one key per (day, folder) discarded the rest. That under-counted repository rows, inflated `(unattributed)` by the same spend, and let the drill-down derive a label the dashboard never rendered. Machine and Model deliberately do *not* group by it: their rows are keyed by their own field, and adding a repository would split one machine's day into several rows the chart then draws twice.

That bucket was 54.8% of all spend, and the two tabs were consequently identical in every other respect — verified by running both grouping rules over the real corpus, which produced byte-identical output once the collapse was removed. Per-turn attribution (see the sync spec) changed both facts: the bucket is now a genuine ~7% residue of work outside any repository, and the tabs genuinely differ, because four worktree directories now resolve to their main repository's key and merge on this tab while standing alone on the Project tab.

### Pricing arithmetic stays server-side

`src/app/dashboard-format.ts` compiles into the **client** bundle. It receives already-priced dollars and must never import `src/parser/pricing.mjs`, which would ship the whole price table to the browser. The one savings helper lives in `pricing.mjs`; the multipliers stay private to it.

The same rule holds for the turn-timeline functions card #161 added to `dashboard-format.ts` (`planTurnBuckets`, `bucketTurnDollars`, `buildTurnTimeline`, `turnTimelineTotalUsd`, `turnTimelineDivergenceNote`) — they only ever combine `carryUsd`/`newUsd` dollars a server component already computed; none of them prices anything or imports `pricing.mjs`.

### Absent days stay visible; a share of nothing is a break, not a zero

Gap fill only ever **inserts** — overwriting a present day would erase its `unpricedEventCount` and delete a lower-bound warning. Filled rows carry an explicit `eventCount: 0`, which is what lets the "no data in this range" guards mean anything once a dead window is 30 zero rows rather than an empty list. A day with no priced spend has no defined model mix and renders as a break; a flat zero would claim the models were not used.

**The break is per DAY, never per model.** `modelMixByDay` resolves the series list over the whole window and writes every key on every day that had priced spend, `0` where a model went unused. A model absent from such a day is a *measured* zero, not missing data — and because the areas are stacked, letting it break punches a hole between the series below it and the series above, showing the page background rather than a thin band. That is what the operator saw on 2026-08-06: a black wedge across the day `claude-opus-5` first appeared, and smaller holes wherever an occasional model skipped a day. The old code only wrote a key for models that had a row, so the omission was invisible in the data and only surfaced as a rendering artifact.

The distinction the whole rule turns on: **the denominator, not the numerator.** No priced spend that day → every share is undefined → the whole stack breaks together, which reads as a gap. Priced spend but none from this model → `0`.

### Every ranking has a deterministic tie-break

Dimension totals tie-break by name; the session list by session id. Without it the Model tab and the model-mix chart can order tied models differently while claiming to describe the same thing, and under `$skip` a tied session appears on two pages or on none.

**Honest limitation:** the session-list tie-break is asserted but *not proven*. `mongodb-memory-server`'s `$group` emits a deterministic order, so removing it fails no test even with the tied fixtures inserted in reverse. It stays because a real deployment makes no such guarantee.

### Fixed-period figures sit ABOVE the filter row

"Spend today" is meaningless at "last 90 days", and a projection would be nonsense. Rather than a caption explaining that the filter does not reach them, the layout carries it. Today is labelled partial.

The projection divides by days that have **fully ended**, which is zero on the 1st of every month — a guaranteed monthly division by zero. It reads "not enough data yet" instead. Known and deliberate: month-to-date includes today's partial spend while the denominator counts only complete days, so the projection runs high, and converges to month-to-date only *after* the month ends, not on its last day.

### An expired session preserves the view

The proxy carries `pathname + search` as `?next=`, stripping Next's `_rsc` cache-buster. That value is attacker-controllable and reflected into a navigation, so it is validated **on the server** before the login form sees it — and the check is stricter than "starts with a slash", which accepts `//evil.com` (protocol-relative) and `/\evil.com` (backslash normalised to a slash).

### Every per-day chart caps at 20 bars

`planDayBuckets` folds a window's calendar days into at most 20 buckets — one rule for every window, not a special case for the long ones. 30 days becomes 15 two-day buckets, 90 becomes 18 five-day ones. At 20 days or fewer each bucket is a single day carrying a bare `YYYY-MM-DD` label, byte-identical to what the charts rendered before bucketing existed.

Two consequences accepted when this was chosen over capping at 31 (which would have kept a calendar month daily): the **default 30-day view visibly changed**, and a one-day spike now merges into its neighbour on the window where that spike matters most.

Applies to **all four** per-day charts — cost split, model mix, cache savings, subagent share. They sit on one dashboard over one window, so leaving two at 90 bars while the others show 18 would read as a bug.

**A bucket sums the underlying quantities and recomputes every ratio from those sums.** Model mix is a share of spend and subagent share is a ratio of costs; combining the daily *percentages* would be wrong in a way that looks entirely plausible on screen. This is structural rather than a rule to remember: `relabelRowsToBuckets` rewrites each row's `day` to its bucket label **before** the roll-up each view already ran, and every roll-up in the codebase (`pivotForChart`, `modelMixByDay`, `rollUpDailySavings`, `rollUpEfficiencyByDay`) groups by `day` and sums. The averaged-percentage version cannot be expressed.

Leftover days land on the **oldest** bucket, never the newest. The eye reads the right edge as "now", so a short final bar looks like spending collapsed when it only means the bucket is young.

A multi-day bucket labels itself `first…last`, which is what the tooltip shows; the axis tick keeps only the first day, because 20 full range labels collide into exactly the mess bucketing exists to remove.

### A turn's cost splits into carry and new work, and the split is a residual by construction

Card #161 added a per-session timeline (`/session/[id]`) showing, turn by turn, how much of each turn's cost re-paid existing cached context ("carry") versus bought new work ("new"). `turnCarrySplit` (`src/parser/pricing.mjs`) computes carry from **cache reads AND cache writes** — `cacheReadTokens × 0.1 + cacheWrite5mTokens × 1.25 + cacheWrite1hTokens × 2.0`, all at the turn's own input price (D3). Reads alone would miss the single most expensive thing that can happen in a long session: when a cache entry is invalidated, the context has to be re-written from scratch, and that re-payment would file under "new work" and hide precisely the event this chart exists to expose — `src/status.mjs` already treats a cache miss as warning-worthy, so this treats it as the same pathology, not progress.

`new` is **not** computed independently — it is the residual, `costUsd − carry`, clamped at zero (D11). Two independently-computed halves were tried and rejected: over 2,000,000 randomized realistic inputs, the independent form missed `costUsd` in ~29.6% of cases (at ~1e-15, pure floating point), and even `costUsd − carry` without the clamp missed in ~5.2%. As a *definition* the residual sums exactly — `carry + new === costUsd` holds by construction, not by luck — so no epsilon is used or needed anywhere a test asserts it, matching this repo's `toBe()`/`toStrictEqual()` convention for money. The clamp also covers a second, separate case: cost is frozen at write time but carry is recomputed at read time from the current price table, so a price correction can push a turn's re-priced carry above what it actually cost — the clamp keeps that from rendering as a negative bar.

**The chart's own total can therefore read higher than the session's "Total cost" line above it, and that divergence is surfaced explicitly rather than silently reconciled.** `turnTimelineDivergenceNote` compares the sum of every bar's `carryUsd + newUsd` against the session's own stored total and, when they disagree, renders a plain-English note under the chart naming both figures. Re-deriving "Total cost" from the clamped splits instead was considered and rejected: it would change what that figure means everywhere else it appears on the page — from "what was actually billed" (frozen at write time, an existing invariant) to "what the current price table implies" — which reopens the exact definition D11 already settled. Leaving the two numbers to disagree with no explanation was the other rejected option.

### A session's turn timeline buckets by turn ordinal, not by day

Turns bucket the same way days do (see *Every per-day chart caps at 20 bars* above) — `planTurnBuckets` mirrors `planDayBuckets`'s span/remainder algorithm, but keyed on a turn's ordinal position in the session rather than a calendar day, since turns have no gaps to fill. The cap is still 20 bars; any remainder still lands on the OLDEST bucket; a bucket's dollars are still summed and every share recomputed from those sums, never averaged from per-turn ratios.

Subagent turns are their own series, bucketed against the SAME plan as the main series (D6) so bucket N means the same slice of the session in both — a **turn-order axis**, not a wall-clock one, since bucketing is by ordinal position, never by timestamp. A bucket with no turns from a given series is zero-filled, never omitted, so an entirely-main or entirely-subagent session still renders a full-length series for the other.

## Things a test cannot tell you here

There is no DOM harness. `vitest` runs node-only, and adding jsdom would produce **false greens** for anything layout-dependent — `getBoundingClientRect` returns zeros, so a tick "survives" in the test while the browser deletes it. Every rendering claim below is unverified and needs a human to look:

- The five series colours are distinguishable, and each totals-table swatch matches its bar.
- The two-month calendar is not clipped by the popover, and its disabled days match `[first recorded day, today]`.
- The page dims and holds during a window change, rather than repainting card by card.
- **Reviewed, accepted:** today's bar is not marked partial on the chart. The KPI tile saying so is deemed enough. Closed deliberately, not still unexamined.
- **Reviewed, accepted:** a fully-unpriced day and a gap-filled empty day both draw a zero-height bar. They stay distinguishable in the data (`eventCount`) and the range-level statement still fires; the visual ambiguity is tolerated.
- **Fixed** — see *Every per-day chart caps at 20 bars* below. The X axis was crowded at 90-day and all-time windows; consecutive days now fold into buckets.

## Where the reasoning lives

Decisions, with the alternatives they beat, are in `tmp/claude-usage-dashboard-insights/DECISIONS.md` (D1–D48). Findings, open questions and reusable commands are in that directory's `JOURNAL.md`. The frozen risk catalog is `BEHAVIOR_RISKS.md`.
