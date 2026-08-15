# Canonical repository name

A repository on the dashboard is named after its **main checkout**, resolved from git at sync time — not after whichever checkout happened to run the most.

Card #177. Follows card #166 (which made the label most-events) and D20 (which made worktrees group by remote hash).

## The problem this solves

Worktrees already merged correctly. All 44 `upredict-backend-*` directories share one origin remote, so they share one `repoKey` and fold into a single row carrying the whole repository's cost. What they could not do was name that row: the label went to the checkout with the most events in the window, and a ticket-branch worktree the operator lives in wins that vote easily. The dashboard's top repository read `workspace/upredict-backend-ubet-4179`.

## Behaviours

- **A repository is named after its main checkout, whatever ran most.** A worktree with three times the events does not take the repository's name.
- **The checkout that ran is still recorded as itself.** `projectSlug` keeps the worktree's own folder; `repoName` rides alongside it. "Which worktree did this?" stays answerable.
- **A repository with no recorded canonical name keeps the previous rule** — the slug carrying the most events, ties broken shortest-then-alphabetical. This covers events synced before this shipped, and bare repositories.
- **Machines that lay a repository out under different parents settle on one name**, chosen by the same ranking rather than by result order.
- **The rendered row, the chart's colour domain, and the drill-down all derive the same name.** Three separate aggregations; all three read the field.
- **A bare repository is keyed but unnamed.** It has no working tree, so no folder stands for it — left absent rather than guessed from the bare directory's name.

## How the name is resolved

`git rev-parse --git-common-dir`, asked of the checkout that ran:

- a **worktree** answers with the main checkout's absolute `.git`
- a **main checkout** answers with a path relative to the cwd (`.git`, or `../../.git` from a subdirectory)
- a **bare repository** answers with a directory that is not a `.git` inside a checkout

`path.resolve(root, answer)` collapses the first two correctly from any directory; anything not ending in `/.git` is the third case and yields no name. The two-segment form (`<parent>/<name>`) is the same shape `projectSlug` has carried since D5, for the same reason: a wider name would carry employer directory names off the machine.

## Why not a hard-coded name rule

This was the opening request, and it is unsafe here. `workspace/upredict-backend-worktrees` sits in the same folder as 44 genuine `upredict-backend` worktrees, shares their prefix, and is a **different repository** (`SportsFI-UBet/ubet-devenv`). A prefix rule swallows it. That is the false positive D20 rejected name-matching for, present in the real corpus rather than hypothetical. An explicit alias map dodges the wildcard but must be maintained per repository forever, and does nothing for one not yet listed.

## Key files

- `src/parser/repo.mjs` — `mainRootOf`, and `ResolvedRepo.mainRoot`
- `src/parser/attribution.mjs` — both attribution paths carry `repoName`
- `src/parser/events.mjs`, `src/server/usage-store.ts` — the stored field
- `src/app/api/sync/route.ts` — the allowlist entry and the copy
- `src/server/usage-queries.ts` — `repoLabelsAcrossRange` (the two tiers), `dimensionAccumulators`, `repoKeyForLabel`

## What a test cannot tell you here

- **The stored history is not retrofitted by shipping this.** Events already in the database carry no canonical name and keep the old label until `bin/backfill.mjs` is re-run. Recent windows self-correct as new events arrive; long windows do not.
- **`usage-queries.test.ts` shares one database across its tests with no per-test cleanup.** A new test that reuses another test's day silently changes that test's totals. Pick an unused day.
- **The e2e suite does not exercise this.** No fixture carries `repoName`, so e2e runs entirely on the fallback tier.
