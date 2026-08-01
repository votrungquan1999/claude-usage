import { closeSync, openSync, readSync, statSync } from "node:fs";

/**
 * Read a whole transcript. For the on-demand report, where session totals need every turn.
 *
 * @param {string} path
 * @returns {object[]} parsed records, oldest first
 */
export function readAllRecords(path) {
	return readTailRecords(path, Number.MAX_SAFE_INTEGER);
}

/**
 * Read the last `bytes` of a JSONL transcript and parse what survives.
 *
 * Transcripts run to multiple MB and the status line renders every turn, so reading the
 * whole file is not an option. Only the tail is needed: context size comes from the last
 * record, and recent turns sit at the end by construction.
 *
 * @param {string} path
 * @param {number} bytes - how much of the tail to read
 * @returns {object[]} parsed records, oldest first
 */
export function readTailRecords(path, bytes = 262_144) {
	const size = statSync(path).size;
	const start = Math.max(0, size - bytes);
	const length = size - start;

	const buffer = Buffer.allocUnsafe(length);
	const fd = openSync(path, "r");
	try {
		readSync(fd, buffer, 0, length, start);
	} finally {
		closeSync(fd);
	}

	const lines = buffer.toString("utf8").split("\n");

	// A window starting mid-file almost always cuts a record in half — drop that fragment.
	if (start > 0) lines.shift();

	const records = [];
	for (const line of lines) {
		if (!line) continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			// A record still being written is truncated; it reappears complete next render.
		}
	}
	return records;
}
