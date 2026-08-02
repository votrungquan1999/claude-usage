import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeAssistantTurns } from "../src/parser/dedupe.mjs";
import { mapTurnToEvent } from "../src/parser/events.mjs";

test("maps a normal turn to a storable usage event with project, machine and time, leaving the account unattributed when the session predates the ledger", () => {
	// Every one of the 201 real sessions today predates the account ledger — this is the
	// modal case in production data, not an edge case.
	const [turn] = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_1",
			sessionId: "sess_1",
			isSidechain: false,
			timestamp: "2026-08-01T10:00:00.000Z",
			message: {
				id: "msg_1",
				model: "claude-sonnet-5",
				usage: {
					input_tokens: 100,
					cache_read_input_tokens: 50,
					cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
					output_tokens: 200,
				},
			},
		},
	]);

	const event = mapTurnToEvent(turn, {
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		accountLedger: {},
	});

	assert.deepEqual(event, {
		requestId: "req_1",
		messageId: "msg_1",
		sessionId: "sess_1",
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		model: "claude-sonnet-5",
		timestamp: new Date("2026-08-01T10:00:00.000Z"),
		inputTokens: 100,
		cacheReadTokens: 50,
		cacheWrite5mTokens: 10,
		cacheWrite1hTokens: 5,
		outputTokens: 200,
		costUsd: 0.002255,
		priced: true,
		isSubagent: false,
	});
});

test("skips <synthetic> placeholder turns and requestId-less turns, but still maps real turns to spend", () => {
	// Both clauses need independent coverage: on real data every requestId-less record is also
	// <synthetic>, so a fixture that only exercised the model check would leave the second
	// clause (the defensive invariant guard) untested.
	const turns = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_real",
			sessionId: "sess_1",
			isSidechain: false,
			timestamp: "2026-08-01T10:00:00.000Z",
			message: {
				id: "msg_real",
				model: "claude-sonnet-5",
				usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
			},
		},
		{
			type: "assistant",
			requestId: "req_synthetic",
			sessionId: "sess_1",
			isSidechain: false,
			timestamp: "2026-08-01T10:01:00.000Z",
			message: {
				id: "msg_synthetic",
				model: "<synthetic>",
				usage: { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
			},
		},
		{
			type: "assistant",
			// requestId omitted on purpose: a non-synthetic record with no requestId.
			sessionId: "sess_1",
			isSidechain: false,
			timestamp: "2026-08-01T10:02:00.000Z",
			message: {
				id: "msg_no_request_id",
				model: "claude-sonnet-5",
				usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
			},
		},
	]);

	const context = { projectSlug: "personal/claude-usage", machineId: "machine-abc", accountLedger: {} };
	const events = turns.map((turn) => mapTurnToEvent(turn, context)).filter((event) => event !== null);

	assert.equal(events.length, 1);
	assert.equal(events[0].messageId, "msg_real");
});

test("reports priced:false and $0 cost for a real (non-synthetic) model with no known price", () => {
	// No unpriced non-synthetic model exists in the real corpus today (Step 8 investigation) —
	// this fixture stands in for a future, not-yet-priced model release.
	const [turn] = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_unreleased",
			sessionId: "sess_1",
			isSidechain: false,
			timestamp: "2026-08-01T10:00:00.000Z",
			message: {
				id: "msg_unreleased",
				model: "claude-something-unreleased",
				usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 },
			},
		},
	]);

	const event = mapTurnToEvent(turn, {
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		accountLedger: {},
	});

	assert.equal(event.priced, false);
	assert.equal(event.costUsd, 0);
});

test("reports priced:false when the timestamp is missing, even for a model with a known price", () => {
	// priced means "this cost is trustworthy", not "this model name is known" — a priced model
	// with no timestamp cannot have its cost period resolved, so it must not read as trustworthy.
	const [turn] = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_no_ts",
			sessionId: "sess_1",
			isSidechain: false,
			// timestamp omitted on purpose
			message: {
				id: "msg_no_ts",
				model: "claude-sonnet-5",
				usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 },
			},
		},
	]);

	const event = mapTurnToEvent(turn, {
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		accountLedger: {},
	});

	assert.equal(event.priced, false);
});

test("emits exactly the allowed 17-key set, plus accountUuid/orgUuid, when the session's account is known in the ledger", () => {
	const [turn] = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_attributed",
			sessionId: "sess_attributed",
			isSidechain: false,
			timestamp: "2026-08-01T10:00:00.000Z",
			message: {
				id: "msg_attributed",
				model: "claude-sonnet-5",
				usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
			},
		},
	]);

	const event = mapTurnToEvent(turn, {
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		repoKey: "9f8e7d6c5b4a",
		accountLedger: {
			sess_attributed: [{ from: "2026-07-01T00:00:00.000Z", accountUuid: "account-work", orgUuid: "org-work" }],
		},
	});

	const EXPECTED_KEYS = [
		"requestId",
		"messageId",
		"sessionId",
		"projectSlug",
		"machineId",
		"repoKey",
		"accountUuid",
		"orgUuid",
		"model",
		"timestamp",
		"inputTokens",
		"cacheReadTokens",
		"cacheWrite5mTokens",
		"cacheWrite1hTokens",
		"outputTokens",
		"costUsd",
		"priced",
		"isSubagent",
	];

	assert.deepEqual(Object.keys(event).sort(), EXPECTED_KEYS.sort());
	assert.equal(event.accountUuid, "account-work");
	assert.equal(event.orgUuid, "org-work");
});

test("emits exactly the allowed key set and no transcript content, even from a hostile-fixture record", () => {
	// A known-good fixture would still pass this check even if the mapper spread `record` or
	// `turn` — real records already carry cwd/gitBranch/etc. Only an unrecognised top-level
	// field AND an unrecognised nested field under `message`, alongside recognisable prose,
	// actually prove the mapper is allowlist-based rather than merely omitting what it happens
	// to not read today.
	const SENTINEL = "the launch code is ALPHA-BRAVO-9182";
	const [turn] = dedupeAssistantTurns([
		{
			type: "assistant",
			requestId: "req_hostile",
			sessionId: "sess_hostile",
			isSidechain: false,
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd: "/Users/quanvo/some/project",
			gitBranch: "main",
			debugPrompt: "unrecognised top-level field a future record might carry",
			message: {
				id: "msg_hostile",
				model: "claude-sonnet-5",
				content: [{ type: "text", text: SENTINEL }],
				rawTranscriptExcerpt: "unrecognised nested field a future record might carry",
				usage: {
					input_tokens: 100,
					cache_read_input_tokens: 50,
					cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
					output_tokens: 200,
					service_tier: "standard",
					inference_geo: "us-east",
				},
			},
		},
	]);

	const event = mapTurnToEvent(turn, {
		projectSlug: "personal/claude-usage",
		machineId: "machine-abc",
		repoKey: "a1b2c3d4e5f6",
		accountLedger: {}, // unattributed: accountUuid/orgUuid must be absent, not just falsy
	});

	const EXPECTED_KEYS = [
		"requestId",
		"messageId",
		"sessionId",
		"projectSlug",
		"machineId",
		"repoKey",
		"model",
		"timestamp",
		"inputTokens",
		"cacheReadTokens",
		"cacheWrite5mTokens",
		"cacheWrite1hTokens",
		"outputTokens",
		"costUsd",
		"priced",
		"isSubagent",
	];

	assert.deepEqual(Object.keys(event).sort(), EXPECTED_KEYS.sort());
	const serialized = JSON.stringify(event);
	assert.equal(serialized.includes(SENTINEL), false);
	assert.equal(serialized.includes("debugPrompt"), false);
	assert.equal(serialized.includes("rawTranscriptExcerpt"), false);
});
