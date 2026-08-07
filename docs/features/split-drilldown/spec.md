# Drilling down from a cost-split row to its sessions

A living spec for the `/split/[dimension]/[value]` pages — what a machine, project, model or repository cost in the selected window, and which sessions worked on it.

The dashboard's reading surface is a separate feature with its own spec at [`../claude-usage-dashboard-insights/spec.md`](../claude-usage-dashboard-insights/spec.md); the write path is at [`../claude-usage-sync-dashboard/spec.md`](../claude-usage-sync-dashboard/spec.md). Their invariants still hold and are not restated — except where this feature changed one, which is called out below.

## What the operator gets

Every row in the Cost-per-day totals table is a link, on all four tabs. Following it opens a page for that value showing what it cost in the window that was on screen, plus its sessions, 25 a page, with the same three orderings the dashboard list offers.

Landed on `main` in `bdd7fed`, which also carries the window-stable label fix below. The model-mix fix in `c436532` is a different feature's chart and is unrelated.

- `src/app/split/split-params.ts` — resolves the two path segments.
- `src/app/split/[dimension]/[value]/page.tsx` — the page.
- `splitValueBreakdown` in `src/server/usage-queries.ts` — the one query behind it.
- `splitValueHref` / `pathHref` in `src/app/href.ts` — the link shapes.

## Invariants

### The row label is not the query

Every split merges before it labels, so the page has to reproduce that merge or it will disagree with the row that opened it. `splitValueMatch` is the one place that mapping lives:

- **Machine** — the machine itself.
- **Model** — every raw stored string that normalizes to the clicked name, mirroring the merge `mergeByNormalizedDimension` does after the `$group`.
- **Project** — the repository the label names, **OR** repo-less events carrying that same slug. Both, because since per-turn attribution a turn that resolved the repository and a turn that fell back to the project directory land on the same name, and `rankDimensionTotals` sums them into one row. Matching only the repository showed two thirds of the clicked figure in the test that caught it.
- **Repo** — the repository alone; `(unattributed)` means every event with no repository at all. This tab does *not* get the Project tab's `$or`, because here repo-less rows have already collapsed into their own bucket.

A label the dashboard never rendered resolves to a filter nothing matches, which surfaces as "No data in this range" rather than an error — an unknown *value* is an empty window, not a bad request.

### A repository has ONE label per window

**This reverses the labelling half of card #132's worktree-merge rule.** That rule picked the shortest projectSlug inside each *day's* merge, which named a repository after whichever checkout happened to run that day. A worktree working a branch alone for a day named that whole day after the worktree — and `rankDimensionTotals` groups by the label *string*, so one repository emitted **two ranked rows**, each holding part of its cost and each linking to part of its sessions.

`repoLabelsAcrossRange` now resolves the label over the whole window before any per-day grouping, ties broken alphabetically so it never depends on the order Mongo returned rows in. The merge *grouping* is still per (day, repoKey) — that is what draws one bar per day. Only the label is window-wide.

Consequence, accepted: a repository that used to appear as two rows on the Project and Repo tabs now appears as one. That is a visible change to the dashboard, not only to this feature.

`repoKeyForLabel` re-derives label → repoKey using that same function, so the resolver and the split cannot drift apart.

### The repoKey still never reaches the browser

The link carries the visible label and the server resolves it back. `repoKey` is an unsalted SHA-256 over a normalised git remote — dictionary-confirmable, so an identifier rather than an opaque token. This is why the drill-down is addressed by label at all, and it is asserted directly: the unattributed drill-down e2e fails if any 64-hex string appears on the page.

### Header and table come from one aggregation

`splitValueBreakdown` runs a single `$facet` over one grouped set, so the total above the table is the **sum of the table by construction** rather than a second query that has to agree with the first. "The total disagrees with the rows under it" is the specific failure that makes a drill-down worse than none.

Turning a page recomputes totals that do not change with the page. Known, and cheap against a bounded window.

### A session row shows the slice, not the session

Since per-turn attribution one session's events can carry different repositories, so "what this session cost" has two honest answers. The row shows **the cost attributed to the clicked value**, which is what makes the rows add up to the header; the whole-session total appears beside it when the two differ, the same D32 rule the dashboard list follows. The column is labelled `Cost here`, not `Cost in range`, because it measures something narrower — without that the two figures read as a contradiction.

### The window rides along, and the page number does not

A row's figure is a *window* figure, so the link carries `preset`/`from`/`to` and the page opens on the same days. It drops `tab` (the path already names the split) and drops `sort`/`page`: the drill-down's session list is a different list, and landing on page 7 of it is D34's bug wearing a new hat.

`dashboardHref` is now a one-line delegate to `pathHref(pathname, …)`, so the existing pager — which reads `usePathname()` — serves both pages and the D34 clearing rules apply on both without being restated.

### `[dimension]` is a closed allowlist, and that is a security boundary

The segment selects a `CostSplitDimension`, which `splitValueMatch` and `costPerDay` interpolate into an aggregation as a field name. Same bug class as `?tab=`, with one difference: a path names a resource, so an unknown one **404s** rather than falling back to a default.

It is a `Map` lookup, not an object lookup. An object literal keyed by segment answers `constructor` and `toString` with `Object.prototype`'s own members, which would turn a nonsense URL into a route.

### Next hands `[value]` over still encoded

Dynamic segments are **not** decoded for you — `personal/lms` arrives as `personal%2Flms`. Found by e2e, not by reasoning: the first click-through rendered a heading reading `personal%2Flms` above an empty page. `decodeSplitValue` decodes it and returns undefined on a malformed escape, so a bad URL is a 404 rather than a 500 from `decodeURIComponent` throwing.

`encodeURIComponent` leaves parentheses alone, so `(unattributed)` round-trips unescaped.

## Things a test cannot tell you here

Same limitation as the dashboard: `vitest` runs node-only and there is no DOM harness, so anything layout-dependent needs a human to look.

- The row links read as links without making the totals table look like a wall of blue.
- The summary row wraps sensibly on a narrow screen.
- The back link is findable — it is the first thing on the page, above the heading.

## Where the reasoning lives

Decisions, with the alternatives they beat, are on AI-Kanban card **#144** and in `tmp/split-drilldown/DECISIONS.md` (D1–D8) while that workspace survives. The card outlives the workspace, so prefer it — and read its supersession chain: its first entry is a malformed duplicate of its second and is marked outdated.

The rest of the workspace:

- `IMPLEMENTATION_PROGRESS.md` — which tests were real reds, which started green, and which injection proved each green-first test actually detects its bug. Also the sync repair that followed this feature in the same session, and what was left undone.
- `JOURNAL.md` — findings, refuted assumptions, and commands that took more than one attempt. Read this before re-deriving anything about Next's route params, Pulumi's stack naming, or why a sync reporting `{sent: 0}` tells you nothing.
- `PLAN.md` — the original five steps.

Card **#143** carries the history this feature builds on (per-turn attribution, chart bucketing) and one correction: its progress notes originally described the sync fault as a wrong URL across two `.env` files, and both halves of that were wrong.

Two fixes landed here that were not part of the feature and are recorded on the card: the per-day labelling bug above, and an e2e fixture that seeded "today" at a fixed 03:00 UTC while the dashboard clamps every window to `now` — so between 00:00 and 03:00 UTC three sessions sat in the future and 7 of 15 e2e tests failed. The fixture now anchors each day to `now` minus whole days, which is boundary-proof in every timezone at once.
