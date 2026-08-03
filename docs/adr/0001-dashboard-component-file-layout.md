# ADR 0001: Dashboard component file layout

## Status

Accepted.

## Context

Five of the twelve behaviours planned for the `claude-usage-dashboard-insights` run land inside one 134-line file, `src/app/page.tsx`. It has to be decomposed before those behaviours can be added without producing an unreviewable diff (a mix of moved lines and changed lines).

The repo has no existing example of its own component-file conventions in practice — `*.ui.tsx` (client display), `*.state.tsx` (client state), `*.type.ts` (shared types), and a colocated `href.ts` (URL factory) are all documented in `.claude/rules/` but nothing under `src/app/` uses them yet. Whatever this run writes becomes the precedent every later dashboard feature copies.

## Decision

Colocate feature surfaces under `src/app/`, deliberately **not** inside a `src/app/dashboard/` folder — that would read as a `/dashboard` route, and moving already-correct, untouched files into it would be a repo-wide rename this run has no reason to do.

Target shape:

- `page.tsx` — server entry only. Reads the URL, computes the window, composes children. No queries, no styling.
- `href.ts` — the one place URLs are built (`sessionHref`, later `dashboardHref`) and the one place URL parameter names are declared.
- `dashboard-format.ts` — all pure, unit-tested derivation (window parsing, gap fill, projections, lower-bound wording). Already existed; extended by this run only.
- `dashboard-loaders.ts` — shared data loaders (added when the run reaches the step that needs them), so two cards needing the same data issue one database query.
- `dashboard-shell.ui.tsx` — the page frame (header row, filter row, card grid), added when the run reaches the step that needs it.
- One directory per feature surface — `cost-split-view/`, `efficiency/`, and later `range-picker/`, `kpi-cards/`, `session-list/` — each holding its own server entry, its client display file (`*.ui.tsx`), and its state file (`*.state.tsx`) where interaction exists.

Every file inside a feature directory follows the existing `file-structure-patterns.md` / `composition-patterns.md` split: server component for data + composition, `*.ui.tsx` for display (always `"use client"`, per D25 of the run's decision log), `*.state.tsx` for interaction, `*.type.ts` for shared types (`interface`/`enum`, never a bare string-literal union).

## Alternatives considered

- **Leave everything in `page.tsx`.** Free today, but the file was already at 134 lines before any of the twelve behaviours landed; each new surface would add another block to one file with no natural seam, and the five behaviours that touch it would produce diffs no reviewer could untangle from each other.
- **A `src/app/dashboard/` route folder.** Groups the feature more explicitly, but the dashboard already lives at the site root (`src/app/page.tsx` is `/`), so nesting it under `dashboard/` would require either a redundant route segment or moving files that don't need a route at all (`dashboard-format.ts`, `href.ts`) into a folder named after a route. Also would have forced moving several files this run doesn't otherwise touch, growing the diff for no behavioural reason.

## Consequences

- This run's first two new files (`href.ts`, `href.test.ts`) already establish the test-colocation convention (`*.test.ts` beside its source, matching `dashboard-format.ts` ↔ `dashboard-format.test.ts` and `usage-queries.ts` ↔ `usage-queries.test.ts`) — every later step's test file follows the same pattern by default.
- Splitting `efficiency-charts.tsx` into `efficiency/subagent-share-chart.tsx` and `efficiency/cache-efficiency-chart.tsx` is a copy-into-two-plus-delete, not a `git mv` — there is no single-file rename that produces two files.
- Future dashboard features should default to a new `src/app/<feature>/` directory rather than adding to `page.tsx` or to an existing unrelated feature's directory.
