import { expect, test } from "vitest";

import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";

/** Minimal assistant record in the shape Claude Code writes to its JSONL. */
function assistantRecord({ requestId, messageId, outputTokens }) {
	return {
		type: "assistant",
		requestId,
		timestamp: "2026-08-01T10:00:00.000Z",
		message: {
			id: messageId,
			model: "claude-opus-5",
			usage: {
				input_tokens: 2,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 435784,
				output_tokens: outputTokens,
			},
		},
	};
}

test("collapses streaming copies of one message to the MAX output_tokens", () => {
	// Claude Code rewrites the same message as it streams; early copies hold partial counts.
	const records = [
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 7 }),
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 289 }),
		assistantRecord({ requestId: "req_a", messageId: "msg_1", outputTokens: 1505 }),
	];

	const turns = dedupeAssistantTurns(records);

	expect(turns, "three copies of one message must collapse to one turn").toHaveLength(1);
	expect(turns[0].usage.output_tokens).toBe(1505);
});

test("a turn carries the directory it ran in and the files its tool calls touched", () => {
	// Both are what attributes a turn to a repository when the session was launched from a parent
	// directory holding many of them — cwd alone answers nothing there.
	const record = {
		type: "assistant",
		requestId: "req_a",
		cwd: "/repos/alpha",
		timestamp: "2026-08-01T10:00:00.000Z",
		message: {
			id: "msg_1",
			model: "claude-opus-5",
			usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 },
			content: [
				{ type: "text", text: "editing" },
				{ type: "tool_use", name: "Edit", input: { file_path: "/repos/alpha/src/a.ts" } },
				{ type: "tool_use", name: "Read", input: { file_path: "/repos/beta/src/b.ts" } },
				{ type: "tool_use", name: "Bash", input: { command: "ls" } },
			],
		},
	};

	const [turn] = dedupeAssistantTurns([record]);

	expect(turn.cwd).toBe("/repos/alpha");
	expect(turn.filePaths).toStrictEqual(["/repos/alpha/src/a.ts", "/repos/beta/src/b.ts"]);
});
