# claude-usage

Context size and cost readout for Claude Code, plus cross-machine usage sync and a dashboard.

Claude Code bills context as a **recurring** cost — every turn re-reads the whole conversation. On a 438K-token session, 78% of each turn's cost was re-reading context before a single new token was generated. This tool makes that visible while you work, instead of at the end of the month.

## What it does

- **Status line** — live context %, last turn cost, and *carry cost* (what the next turn costs before you type anything), with warnings when the cache prefix is invalidated.
- **Skill / report** — deep on-demand breakdown of the current session, including subagent spend.
- **Sync** — pushes per-message token aggregates to a remote DB so usage from multiple machines lands in one place. **Transcripts never leave the machine** — only token counts.
- **Dashboard** — cost per day / machine / project / model, subagent share, cache efficiency, session drill-down.

## Status

All three phases are built and tested — 155 tests across two runners. Local readout (status line,
report, installer, skill), cross-machine sync (mapper, `POST /api/sync`, both hooks, backfill), and
the dashboard (aggregation layer, views, auth).

**Not yet run in production.** Nothing is deployed, no real Atlas connection has been made, backfill
has never posted to the hosted API, and `scripts/install.mjs` has not been run on this machine. The
database is provisioned by an open PR against `personal-infra`, not by a merge.

Behaviour and the invariants that must not be broken are documented in
[docs/features/claude-usage-sync-dashboard/spec.md](docs/features/claude-usage-sync-dashboard/spec.md).

## Install

```sh
git clone https://github.com/votrungquan1999/claude-usage.git
cd claude-usage && node scripts/install.mjs
```

Symlinks the clone to `~/.claude/claude-usage` and patches `~/.claude/settings.json` — wiring in
the status line and the two sync hooks (`UserPromptSubmit`, `SessionStart`). Update with `git pull`
— there is no build step.

To turn sync on, copy `.env.example` to `~/.claude/claude-usage/.env` (or, running straight from
a clone with no installer symlink yet, to the repo root's own `.env` — that path is checked as a
fallback) and fill in `CLAUDE_USAGE_API_URL` and `CLAUDE_USAGE_SECRET` (`CLAUDE_USAGE_MACHINE_LABEL`
is optional — a missing label just shows the raw machine id on the dashboard instead of a name).
Without either `.env`, the status line and report still work; the hooks silently skip syncing.

`CLAUDE_USAGE_API_URL` is the deployed app's **base URL** (e.g. `https://usage.example.com`), not
the sync endpoint itself — the uploader appends `/api/sync` (once; a base already ending in it, or
carrying a trailing slash, is handled without doubling it). Posting straight to the base used to
hit the dashboard page instead, which returned 200 and silently dropped every event (R31) — a 200
alone is no longer treated as success; the response must carry the sync route's own
`{accepted, rejected}` body.

## Backfill

The hooks only sync a session's own tail as it happens, so anything already on the machine
before sync was turned on — or from a stretch where sync was broken — needs a one-time import:

```sh
node bin/backfill.mjs
```

Walks every transcript under `~/.claude/projects` (main sessions, subagents, and subagents
launched inside a workflow), dedupes and maps them the same way the hooks do, and posts them in
batches of 2,000 events through the same uploader. It requires `CLAUDE_USAGE_API_URL` and
`CLAUDE_USAGE_SECRET` to already be set, same as the hooks (loaded from the same `.env`, checked
in the same two locations). Running it unconfigured is loud, not a silent no-op: it prints which
variable(s) are missing and exits non-zero.

There is no checkpoint file — **re-running it is always safe and is the intended way to recover**
from an interrupted run or a flaky request (the store's upsert can only raise a stored count, never
lower one). A project directory whose transcripts carry no recorded working directory is skipped
rather than sent with a guessed identity, and the count of skipped directories is printed in the
summary. A single file's upload failing — whether the server responds with an error or the request
never completes at all (a dropped connection, a timeout, a transcript deleted mid-run) — is recorded
against that file and the run moves on to the next one; it never aborts the whole import. Exits
non-zero if any individual upload failed, printing which file so a re-run can be targeted or the
whole thing simply run again. The summary line (files processed, events sent, requests sent,
failures, directories skipped) always prints, even on a run that ends badly.
