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

`repoKey` is an unsalted SHA-256 over a normalised git remote — dictionary-confirmable, so an identifier rather than an opaque token. Every other split interpolates its own field as the row label; `Repo` reads `projectSlug` instead (`groupingFieldFor`) and labels each repository with the shortest slug that maps to it.

The repo split also **inverts** the project split's rule for repo-less rows. On the Project tab each stands alone, so an unrelated project is never folded in just because both lack the field. On the Repo tab they all collapse into one `(unattributed)` bucket: "no repository" is the answer itself there, and spreading it across project names would hide exactly that.

That bucket was 54.8% of all spend, and the two tabs were consequently identical in every other respect — verified by running both grouping rules over the real corpus, which produced byte-identical output once the collapse was removed. Per-turn attribution (see the sync spec) changed both facts: the bucket is now a genuine ~7% residue of work outside any repository, and the tabs genuinely differ, because four worktree directories now resolve to their main repository's key and merge on this tab while standing alone on the Project tab.

### Pricing arithmetic stays server-side

`src/app/dashboard-format.ts` compiles into the **client** bundle. It receives already-priced dollars and must never import `src/parser/pricing.mjs`, which would ship the whole price table to the browser. The one savings helper lives in `pricing.mjs`; the multipliers stay private to it.

### Absent days stay visible; a share of nothing is a break, not a zero

Gap fill only ever **inserts** — overwriting a present day would erase its `unpricedEventCount` and delete a lower-bound warning. Filled rows carry an explicit `eventCount: 0`, which is what lets the "no data in this range" guards mean anything once a dead window is 30 zero rows rather than an empty list. A day with no priced spend has no defined model mix and renders as a break; a flat zero would claim the models were not used.

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
