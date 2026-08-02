import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readAllRecords, readTailRecords } from "../src/parser/read.mjs";

/** Writes a JSONL file and returns its path. */
function transcript(lines) {
	const dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
	const path = join(dir, "session.jsonl");
	writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
	return path;
}

test("discards the partial line the tail window cuts through", () => {
	const path = transcript([
		{ type: "assistant", marker: "a".repeat(400) },
		{ type: "assistant", marker: "second" },
		{ type: "assistant", marker: "third" },
	]);

	// A window landing mid-way through record one must not yield a broken record.
	const records = readTailRecords(path, 200);

	assert.deepEqual(
		records.map((r) => r.marker),
		["second", "third"],
	);
});

test("keeps the first record, which the tail reader deliberately drops", () => {
	const path = transcript([
		{ type: "assistant", marker: "first" },
		{ type: "assistant", marker: "second" },
	]);

	assert.deepEqual(
		readAllRecords(path).map((r) => r.marker),
		["first", "second"],
	);
});

test("keeps a multi-byte UTF-8 record intact when it straddles the internal 1 MiB chunk boundary", () => {
	// streamRecords reads in fixed 1 MiB chunks; a record's bytes can legitimately split across
	// two reads. Line 1 is padded so the multi-byte record on line 2 starts exactly one byte
	// before the boundary, splitting the emoji's 4-byte UTF-8 sequence across both chunks.
	const CHUNK = 1 << 20;
	const record = JSON.stringify({ s: "é🎯漢" });
	const emojiByteOffset = Buffer.byteLength(record.slice(0, record.indexOf("🎯")));
	const padLength = CHUNK - 2 - emojiByteOffset;

	const dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
	const path = join(dir, "session.jsonl");
	// Line 1 is deliberately not valid JSON — it's padding only, silently skipped on parse.
	writeFileSync(path, `${"a".repeat(padLength)}\n${record}\n`);

	const records = readAllRecords(path);

	assert.deepEqual(records, [{ s: "é🎯漢" }]);
});

test("reads a multi-MB transcript fast enough to render every turn", () => {
	// The status line runs on each render, so cost scales with the tail window, not the file.
	const bulky = { type: "assistant", padding: "x".repeat(2_000) };
	const path = transcript(Array.from({ length: 2_000 }, () => bulky));

	const started = process.hrtime.bigint();
	readTailRecords(path);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

	assert.ok(elapsedMs < 100, `tail read took ${elapsedMs.toFixed(1)}ms`);
});
