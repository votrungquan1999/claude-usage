# claude-usage

Context size and cost readout for Claude Code, plus cross-machine usage sync and a dashboard.

Claude Code bills context as a **recurring** cost — every turn re-reads the whole conversation. On a 438K-token session, 78% of each turn's cost was re-reading context before a single new token was generated. This tool makes that visible while you work, instead of at the end of the month.

## What it does

- **Status line** — live context %, last turn cost, and *carry cost* (what the next turn costs before you type anything), with warnings when the cache prefix is invalidated.
- **Skill / report** — deep on-demand breakdown of the current session, including subagent spend.
- **Sync** — pushes per-message token aggregates to a remote DB so usage from multiple machines lands in one place. **Transcripts never leave the machine** — only token counts.
- **Dashboard** — cost per day / machine / project / model, subagent share, cache efficiency, session drill-down.

## Status

Phase 1 (local readout) is built and tested — status line, report, installer, skill. Phase 2
(cross-machine sync) and Phase 3 (dashboard) are planned but not started. See `PLAN.md` and
`IMPLEMENTATION_PROGRESS.md`.

## Install

```sh
git clone https://github.com/votrungquan1999/claude-usage.git
cd claude-usage && node scripts/install.mjs
```

Symlinks the clone to `~/.claude/claude-usage` and patches `~/.claude/settings.json`. Update with `git pull` — there is no build step.
