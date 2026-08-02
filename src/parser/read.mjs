import { closeSync, openSync, readSync, statSync } from "node:fs";

/**
 * Read a whole transcript. For the on-demand report, where session totals need every turn.
 *
 * @param {string} path
 * @returns {object[]} parsed records, oldest first
 */
export function readAllRecords(path) {
	return [...streamRecords(path)];
}

const CHUNK = 1 << 20; // 1 MiB
const NL = 0x0a;

/**
 * Parse one JSONL line, tolerating the truncated-tail case (a record still being written).
 *
 * @param {string} line
 * @returns {object|undefined} the parsed record, or undefined for a blank/unparseable line
 */
function parseRecord(line) {
	if (!line) return undefined;
	try {
		return JSON.parse(line);
	} catch {
		// A record still being written is truncated; it reappears complete next read.
		return undefined;
	}
}

/**
 * Stream a transcript record-by-record with bounded memory.
 *
 * The whole-file read this replaces allocates one buffer for the entire file, which throws
 * `ERR_STRING_TOO_LONG` past V8's ~512 MiB string cap — a cliff a transcript will eventually
 * cross. Reading in fixed 1 MiB chunks keeps memory bounded regardless of file size.
 *
 * @param {string} path
 * @yields {object} parsed records, oldest first
 */
export function* streamRecords(path) {
	const fd = openSync(path, "r");
	const buf = Buffer.allocUnsafe(CHUNK);
	let carry = Buffer.alloc(0);
	try {
		let bytes;
		while ((bytes = readSync(fd, buf, 0, CHUNK, null)) > 0) {
			// Prepend whatever line fragment the previous chunk cut off mid-line.
			const view = carry.length ? Buffer.concat([carry, buf.subarray(0, bytes)]) : buf.subarray(0, bytes);
			let start = 0;
			let nl;
			while ((nl = view.indexOf(NL, start)) !== -1) {
				const line = view.toString("utf8", start, nl);
				start = nl + 1;
				const record = parseRecord(line);
				if (record !== undefined) yield record;
			}
			carry = Buffer.from(view.subarray(start)); // copy: buf is reused next loop
		}
	} finally {
		closeSync(fd);
	}
	if (carry.length) {
		const record = parseRecord(carry.toString("utf8"));
		if (record !== undefined) yield record;
	}
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
		const record = parseRecord(line);
		if (record !== undefined) records.push(record);
	}
	return records;
}
