import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { streamRecords } from "./read.mjs";

/**
 * Memoized by project directory, same shape as `resolveProjectSlug` (project.mjs): resolved
 * once per run and inherited by every file underneath it.
 * @type {Map<string, string|undefined>}
 */
const cache = new Map();

/**
 * Resolve a project directory's repository identity (D20): an opaque hash of its git remote,
 * normalized first so the SSH and HTTPS forms of the same remote (`git@host:org/repo.git` vs.
 * `https://host/org/repo.git`) hash identically — without that, two machines recording either
 * form would never group, silently defeating the whole point of this field.
 *
 * Only the hash is ever returned — never the remote URL itself, which would carry employer/org
 * names straight into hosted Atlas, exactly what the two-segment projectSlug (D5) was chosen to
 * strip.
 *
 * Optional by design: a project directory whose recorded cwd no longer exists, or which is not
 * a git repository at all, simply has no key — never fabricated, never a name-based guess.
 *
 * @param {string} projectDir - absolute path to a directory under ~/.claude/projects
 * @returns {string|undefined} opaque repo key, or undefined when no git remote is resolvable
 */
export function resolveRepoKey(projectDir) {
	if (cache.has(projectDir)) return cache.get(projectDir);

	const key = findRepoKey(projectDir);
	// Same non-caching-undefined rationale as resolveProjectSlug: a directory with no resolvable
	// remote today (empty so far, or its cwd doesn't exist yet) might resolve one later in a
	// long-running process (backfill) — caching undefined would poison every later call.
	if (key !== undefined) cache.set(projectDir, key);
	return key;
}

function findRepoKey(projectDir) {
	const cwd = findFirstCwd(projectDir);
	if (!cwd) return undefined;

	const remote = readGitRemote(cwd);
	if (!remote) return undefined;

	return hashRemote(normalizeGitRemote(remote));
}

/** Same shallow-scan idiom as `project.mjs`'s `findCwdSlug` — stop at the first cwd-bearing record. */
function findFirstCwd(projectDir) {
	let entries;
	try {
		entries = readdirSync(projectDir);
	} catch {
		return null;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".jsonl")) continue;
		for (const record of streamRecords(join(projectDir, entry))) {
			if (record.cwd) return record.cwd;
		}
	}

	return null;
}

/** `git remote get-url origin` run in `cwd`; null on any failure — not a repo, no origin, cwd gone. */
function readGitRemote(cwd) {
	if (!existsSync(cwd)) return null;
	try {
		return execFileSync("git", ["remote", "get-url", "origin"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Normalize a git remote URL so the SSH and HTTPS forms of the same repository compare equal.
 * Handles the scp-like SSH form, any URL scheme, a trailing `.git`, a trailing slash, and case.
 *
 * @param {string} remote
 * @returns {string} normalized form, e.g. "github.com/org/repo"
 */
export function normalizeGitRemote(remote) {
	let normalized = remote.trim();

	// scp-like SSH form (`[user@]host:path`, colon NOT followed by `//`) -> a uniform host/path
	// shape, e.g. "git@github.com:org/repo.git" -> "github.com/org/repo.git".
	normalized = normalized.replace(/^([^@/]+@)?([^:/]+):(?!\/\/)/, "$2/");

	// Any URL scheme (https://, ssh://, git://, git+ssh://, ...) plus an optional user@.
	normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?/i, "");

	normalized = normalized.replace(/\/+$/, ""); // trailing slash
	normalized = normalized.replace(/\.git$/i, ""); // trailing .git

	return normalized.toLowerCase();
}

/** @param {string} normalizedRemote */
function hashRemote(normalizedRemote) {
	return createHash("sha256").update(normalizedRemote).digest("hex");
}
