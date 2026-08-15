# claude-usage

Context size and cost readout for Claude Code, plus cross-machine usage sync and a dashboard.

Claude Code bills context as a **recurring** cost — every turn re-reads the whole conversation. On a 438K-token session, 78% of each turn's cost was re-reading context before a single new token was generated. This tool makes that visible while you work, instead of at the end of the month.

## What it does

- **Status line** — live context %, last turn cost, and *carry cost* (what the next turn costs before you type anything), with warnings when the cache prefix is invalidated.
- **Skill / report** — deep on-demand breakdown of the current session, including subagent spend.
- **Sync** — pushes per-message token aggregates to a remote DB so usage from multiple machines lands in one place. **Transcripts never leave the machine** — only token counts.
- **Dashboard** — cost per day / machine / project / model, subagent share, cache efficiency, and a drill-down from any split row to the sessions behind it.

**Live** at <https://claude-usage.quanvo.dev>, gated by the shared secret.

## Set up on a new machine

Written to be handed to a coding agent: *"read the README and set claude-usage up on this machine."* Follow it in order — step 4 is what tells you it actually worked, and skipping it is how a machine ends up silently uploading nothing for days.

**Prerequisites:** Node 22+ and git. The CLI half — status line, report, sync, backfill — uses **node builtins only**, so there is no `npm install` and no build step. `npm install` is only for working on the dashboard itself.

### 1. Clone

```sh
git clone https://github.com/votrungquan1999/claude-usage.git
cd claude-usage
```

### 2. Get the shared secret

It already exists — **do not generate a new one.** A fresh secret means this machine's uploads are rejected with 401 while every command still reports success. Read the deployed value on a machine that has the Pulumi token:

```sh
cd ../personal-infra
export PULUMI_ACCESS_TOKEN="$(grep '^PULUMI_ACCESS_TOKEN=' .env | cut -d= -f2-)"
pulumi stack output claudeUsageSecret --show-secrets
```

The stack name is org-qualified: `--stack prod` fails with *no stack named 'prod' found*; use `votrungquan1999/prod` or omit `--stack` entirely. **Pipe the value where you can** rather than pasting it — an argument lands in the process list, and an echo lands in terminal scrollback *and* in the agent transcript, which this tool then uploads.

### 3. Install

```sh
node scripts/install.mjs --api-url https://claude-usage.quanvo.dev --secret <shared secret>
```

Symlinks the clone to `~/.claude/claude-usage`, patches `~/.claude/settings.json` to wire in the status line and the two sync hooks (`UserPromptSubmit`, `SessionStart`), and writes the `.env`. Re-running is safe: unrelated keys survive and the secret is never echoed. Update later with `git pull`.

Both flags are optional — run it bare to install the readout without turning sync on. The status line and report still work and the hooks skip uploading silently.

### 4. Verify, in this order

Each step alone proves nothing. Together they separate the three ways this fails.

**a. Probe auth and routing.** Writes nothing, so it is safe to repeat:

```sh
set -a; . ~/.claude/claude-usage/.env; set +a
curl -s -X POST "$CLAUDE_USAGE_API_URL/api/sync" \
  -H "x-claude-usage-secret: $CLAUDE_USAGE_SECRET" \
  -H 'Content-Type: application/json' -d '{"machineId":"probe","events":[]}'
```

Expect `{"accepted":0,"rejected":0}`. A **401** means the secret is wrong. Anything else — HTML, a redirect, a 404 — means the URL is wrong.

**b. Send something real.** On a new machine this doubles as the initial import:

```sh
node bin/backfill.mjs
```

Read the summary line. `events sent` must be non-zero.

**c. Confirm the dashboard moved.** Open <https://claude-usage.quanvo.dev> and check the newest bar advanced. Only this proves the events were stored rather than accepted and dropped.

## Backfill

The hooks only sync a session's own tail as it happens, so anything already on the machine
before sync was turned on — or from a stretch where sync was broken — needs a one-time import:

```sh
node bin/backfill.mjs
```

Walks every transcript under `~/.claude/projects` (main sessions, subagents, and subagents
launched inside a workflow), dedupes and maps them the same way the hooks do, and posts them in
batches of 2,000 events through the same uploader. It requires `CLAUDE_USAGE_API_URL` and
`CLAUDE_USAGE_SECRET` to already be set, same as the hooks and out of the same `.env` (the loader
tries two paths, but on an installed machine both resolve to one file — see Troubleshooting).
Running it unconfigured is loud, not a silent no-op: it prints which variable(s) are missing and
exits non-zero.

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

## Troubleshooting

**`sent: 0` tells you almost nothing.** Four different situations produce it and the caller cannot tell them apart: nothing to send · wrong host · wrong secret · lock already held. `postEvents` turns every non-2xx into `{sent: 0}` without throwing, and `syncTail` catches everything. Diagnose with the probe in step 4a, never by re-running the sync and hoping.

**There is only one `.env`.** `~/.claude/claude-usage` is a symlink to the checkout, so `~/.claude/claude-usage/.env` and `<checkout>/.env` are the same file. The loader's prefer-installed-then-fall-back-to-repo-root logic reads like two locations; it is one. `ls -la` shows a regular file from either path because the symlink is on the parent *directory* — compare `stat -f %i` on both if in doubt.

**Nothing warns you when sync stops.** There is no staleness signal anywhere in the UI. A wrong URL and a stale secret both present as a dashboard that quietly stops advancing, which is how this went unnoticed for two days. If the newest bar looks old, start at step 4a.

**`CLAUDE_USAGE_API_URL` is the base URL**, not the sync endpoint — the uploader appends `/api/sync` itself, handling a base that already ends in it or carries a trailing slash without doubling up. Posting straight at the base used to hit the dashboard page, which returned 200 and dropped every event (R31); a bare 200 is no longer treated as success, and the response must carry the sync route's own `{accepted, rejected}` body.

## Status

All three phases are built and tested — 264 tests under vitest plus 17 Playwright e2e tests. Local readout (status line, report, installer, skill), cross-machine sync (mapper, `POST /api/sync`, both hooks, backfill), and the dashboard (aggregation layer, views, auth, split drill-down).

Behaviour and the invariants that must not be broken live in [docs/features/](docs/features/) — one spec per feature, each carrying the reasoning behind its constraints.
