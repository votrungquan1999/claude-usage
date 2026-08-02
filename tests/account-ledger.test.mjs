import assert from "node:assert/strict";
import { test } from "node:test";

import { accountFor, recordAccount } from "../src/parser/account-ledger.mjs";

test("only records an entry when the account actually changes", () => {
	// UserPromptSubmit fires on every prompt; an entry per turn would bloat the ledger.
	let ledger = {};
	const work = { accountUuid: "work", orgUuid: "work-org" };

	ledger = recordAccount(ledger, "session-1", work, "2026-08-02T09:00:00.000Z");
	ledger = recordAccount(ledger, "session-1", work, "2026-08-02T09:05:00.000Z");
	ledger = recordAccount(ledger, "session-1", work, "2026-08-02T09:10:00.000Z");

	assert.equal(ledger["session-1"].length, 1);

	ledger = recordAccount(
		ledger,
		"session-1",
		{ accountUuid: "personal", orgUuid: "personal-org" },
		"2026-08-02T14:00:00.000Z",
	);

	assert.equal(ledger["session-1"].length, 2);
	assert.equal(ledger["session-1"][1].from, "2026-08-02T14:00:00.000Z");
});

test("attributes a turn to the account that was active when it ran", () => {
	// Switching accounts overwrites ~/.claude.json, so "current account" is only correct for
	// events happening right now. Catch-up syncs must not restamp older turns.
	const ledger = {
		"session-1": [
			{ from: "2026-08-02T09:00:00.000Z", accountUuid: "work", orgUuid: "work-org" },
			{ from: "2026-08-02T14:00:00.000Z", accountUuid: "personal", orgUuid: "personal-org" },
		],
	};

	assert.deepEqual(accountFor(ledger, "session-1", "2026-08-02T10:30:00.000Z"), {
		accountUuid: "work",
		orgUuid: "work-org",
	});
	assert.deepEqual(accountFor(ledger, "session-1", "2026-08-02T15:00:00.000Z"), {
		accountUuid: "personal",
		orgUuid: "personal-org",
	});
});
