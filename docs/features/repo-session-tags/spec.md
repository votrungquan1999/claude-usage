# Repository session tags

The **Repo** tab and its drill-down (`/split/repo/<label>`) place each **session** under every repository it worked in, and give each of those repositories the session's **full** cost. Per-turn attribution (`attributeTurns`) no longer decides this tab.

Same rule as the owner's Claude Office app, with two deliberate differences listed below.

## The problem this solves

Per-turn attribution guessed one repository per turn (cwd, then the dominant file folder, then the repository carried from the turn before). A session started from a folder that holds several repositories split its cost between them by those guesses, and much of it landed in the unattributed bucket. "Which sessions touched this repository, and what did they cost?" had no straight answer.

## Behaviours

- **A session is tagged with every repository it showed work in.** Evidence comes from the main transcript and every subagent transcript: each record's `cwd`, plus the folder of every `tool_use` `file_path` / `notebook_path` (relative paths resolved against the record's `cwd`).
- **Each folder resolves through git to the repository's main checkout.** A worktree tags the repository it was added from. A folder that does not exist yet (or was deleted) is looked up at its nearest existing ancestor.
- **Tags only grow.** No ranking, no carry-over. A tail sync that sees part of a session adds what it saw; nothing is ever removed.
- **Every tagged repository gets the whole session.** Repository totals add up to more than real spend. The owner accepted this.
- **Sessions with no tag document yet keep the old placement**, each event by its own `repoKey`. History is only re-tagged by re-running `bin/backfill.mjs`.
- **Sessions with neither tags nor any `repoKey` stay in `(unattributed)`.** A tagged session never appears there.
- **Two different repositories with the same name stay two rows.** Repeats are numbered (`personal/twin`, `personal/twin (2)`) in repoKey order, and each drills into its own sessions.
- **The rendered row, the colour domain, and the drill-down all use one labelling rule** (`repoTabRows` then `repoTabLabels`), so every row can be drilled into.
- **Machine, Project and Model tabs are unchanged.** Events still carry `projectSlug` / `repoKey` / `repoName` from `attributeTurns`, and the Project tab still reads them.

## Differences from Claude Office

- **The start folder's repository counts as a tag.** Claude Office skips it, and any repository that wraps it.
- **The tag key is the remote hash** (`resolveRepoAt` → `key`), not a path hash, so the same repository groups across machines. The tag name is `lastTwoSegments(mainRoot ?? root)`. A folder with no `origin` remote, or outside any repository, gives no tag.

## Wire and storage

- `POST /api/sync` takes an optional `sessionTags: [{ sessionId, tags: [{ key, name }] }]`. Older clients that omit it sync as before.
- A tag key must be 64 lowercase hex characters: it becomes part of a field path when stored. A malformed entry is dropped and the rest are kept, like events.
- Stored in `session_repo_tags`, one document per session (`{ sessionId, repos: { <key>: <name> } }`, unique index on `sessionId`), written with `$set: { "repos.<key>": name }`.

## Key files

- `src/parser/repo-tags.mjs`: `tapEvidenceDirs`, `resolveRepoTags`, `repoTagsOf`
- `bin/sync.mjs`, `bin/backfill.mjs`: collect folders during the existing single read, send `sessionTags`
- `src/app/api/sync/route.ts`, `src/server/usage-store.ts`: validation, `saveSessionRepoTags`, index
- `src/server/usage-queries.ts`: `repoTabRows`, `repoTabLabels`, `repoValueBreakdown`

## What a test cannot tell you here

- **Stored history is not re-tagged by shipping this.** Until `bin/backfill.mjs` is re-run, old sessions use the per-event fallback.
- **The Repo chart stacks its bars**, so a day's stack height on this tab is larger than that day's real spend.
- **The colour domain uses a 365-day window**, so when a name collision exists only in that window the numbered labels there can differ from the selected window's labels. Only the colour is affected.
