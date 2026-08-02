import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Locate the transcript for the running session.
 *
 * The project directory is fixed when the session starts, so it cannot be derived from the
 * current working directory — an agent that has cd'd into a subdirectory would resolve to a
 * project folder that holds no transcript. The session id is authoritative; search for it.
 *
 * @param {object} options
 * @param {string} options.projectsRoot - ~/.claude/projects
 * @param {string} [options.sessionId]
 * @param {string} options.cwd
 * @returns {string|null} absolute path, or null when nothing matches
 */
export function findTranscript({ projectsRoot, sessionId, cwd }) {
	if (!existsSync(projectsRoot)) return null;

	if (sessionId) {
		for (const project of readdirSync(projectsRoot)) {
			const path = join(projectsRoot, project, `${sessionId}.jsonl`);
			if (existsSync(path)) return path;
		}
	}

	// No session id (invoked outside Claude Code): fall back to the newest transcript for cwd.
	// Claude Code's real project dirs map '/', '.' and '_' all to '-' when building the slug.
	const slug = cwd.replace(/[/._]/g, "-");
	return newestTranscript(join(projectsRoot, slug));
}

function newestTranscript(dir) {
	if (!existsSync(dir)) return null;

	const candidates = readdirSync(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => join(dir, file))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

	return candidates[0] ?? null;
}
