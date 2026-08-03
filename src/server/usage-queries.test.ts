import { MongoMemoryServer } from "mongodb-memory-server";
import { type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, expect, test } from "vitest";

import { USAGE_EVENTS_COLLECTION, ensureUsageIndexes, saveUsageEvents, type UsageEventDocument } from "./usage-store";
import {
	CostSplitDimension,
	costPerDay,
	dailyEfficiency,
	dimensionValueDomain,
	getSessionBreakdown,
	type DateRange,
} from "./usage-queries";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
	server = await MongoMemoryServer.create();
	client = await MongoClient.connect(server.getUri());
	db = client.db("claude-usage-test");
	await ensureUsageIndexes(db);
});

afterAll(async () => {
	await client?.close();
	await server?.stop();
});

/**
 * Full-day UTC bounds for a `YYYY-MM-DD` string. Each test uses its OWN day so events inserted
 * by other tests (the collection is never cleared between tests, matching this repo's existing
 * `usage-store.test.ts` pattern) can never be pulled into an aggregate this test asserts on.
 */
function dayRange(dateStr: string): DateRange {
	return { from: new Date(`${dateStr}T00:00:00.000Z`), to: new Date(`${dateStr}T23:59:59.999Z`) };
}

function event(overrides: Partial<UsageEventDocument> = {}): UsageEventDocument {
	return {
		requestId: "req_a",
		messageId: "msg_1",
		sessionId: "session-1",
		projectSlug: "personal/claude-usage",
		machineId: "machine-1",
		accountUuid: "account-1",
		orgUuid: "org-1",
		model: "claude-opus-5",
		timestamp: new Date("2026-08-01T10:00:00.000Z"),
		inputTokens: 0,
		cacheReadTokens: 400_000,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
		outputTokens: 1_505,
		costUsd: 0.225,
		priced: true,
		isSubagent: false,
		...overrides,
	};
}

test("cost per day split by machine sums priced cost into the requesting machine's day bucket", async () => {
	const range = dayRange("2026-08-01");
	await saveUsageEvents(db, [
		event({ requestId: "req_m1", messageId: "msg_m1", machineId: "work-mac", timestamp: range.from, costUsd: 1.5 }),
		event({ requestId: "req_m2", messageId: "msg_m2", machineId: "home-mac", timestamp: range.from, costUsd: 2.5 }),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Machine, range);

	const workRow = rows.find((row) => row.dimensionValue === "work-mac");
	expect(workRow?.costUsd).toBe(1.5);
});

test("an unpriced event is excluded from the day's cost but still counted as volume (D17/D8)", async () => {
	// costUsd is deliberately NON-zero: a stored event can be priced:false while still carrying a
	// cost ($max keeps the previously-written figure, $set demotes priced on a later resync). A
	// zero-cost fixture here would pass identically against an unguarded `$sum: "$costUsd"`.
	const range = dayRange("2026-08-02");
	await saveUsageEvents(db, [
		event({
			requestId: "req_unpriced",
			messageId: "msg_unpriced",
			machineId: "unpriced-mac",
			timestamp: range.from,
			priced: false,
			costUsd: 9.99,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Machine, range);

	const unpricedRow = rows.find((row) => row.dimensionValue === "unpriced-mac");
	expect(unpricedRow).toEqual(expect.objectContaining({ costUsd: 0, unpricedEventCount: 1, eventCount: 1 }));
});

test("splitting by model merges raw variants that normalize to the same model (e.g. a [1m] suffix)", async () => {
	const range = dayRange("2026-08-03");
	await saveUsageEvents(db, [
		event({ requestId: "req_variant_a", messageId: "msg_variant_a", timestamp: range.from, model: "claude-opus-5", costUsd: 1 }),
		event({
			requestId: "req_variant_b",
			messageId: "msg_variant_b",
			timestamp: range.from,
			model: "claude-opus-5[1m]",
			costUsd: 2,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Model, range);

	const opusRows = rows.filter((row) => row.dimensionValue === "claude-opus-5");
	expect(opusRows).toHaveLength(1);
	expect(opusRows[0].costUsd).toBe(3);
});

test("a day boundary is Asia/Ho_Chi_Minh, not UTC (D16)", async () => {
	// 17:30 UTC = 00:30 the NEXT day in Asia/Ho_Chi_Minh (UTC+7). Under UTC bucketing this
	// event would land on 2026-08-04; under D16 it must land on 2026-08-05.
	const utcTimestamp = new Date("2026-08-04T17:30:00.000Z");
	await saveUsageEvents(db, [
		event({
			requestId: "req_tz",
			messageId: "msg_tz",
			machineId: "tz-mac",
			timestamp: utcTimestamp,
			costUsd: 4,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Machine, {
		from: new Date("2026-08-04T00:00:00.000Z"),
		to: new Date("2026-08-05T23:59:59.999Z"),
	});

	const tzRows = rows.filter((row) => row.dimensionValue === "tz-mac");
	expect(tzRows).toEqual([expect.objectContaining({ day: "2026-08-05", costUsd: 4 })]);
});

test("project rows sharing a repoKey (D20: a worktree checkout of the same repo) roll up into one row labeled with the shortest projectSlug in the group", async () => {
	const range = dayRange("2026-08-05");
	await saveUsageEvents(db, [
		// Same repository, two checkouts — the main one and a ticket-branch worktree. The
		// worktree's slug is longer, so the merged row must be labeled with the main checkout's.
		event({
			requestId: "req_worktree_main",
			messageId: "msg_worktree_main",
			timestamp: range.from,
			projectSlug: "personal/ccp",
			repoKey: "hash-ccp",
			costUsd: 1,
		}),
		event({
			requestId: "req_worktree_branch",
			messageId: "msg_worktree_branch",
			timestamp: range.from,
			projectSlug: "personal/ccp-notification-system",
			repoKey: "hash-ccp",
			costUsd: 2,
		}),
		// A different, unrelated repository whose slug happens to share the same prefix — this is
		// the confirmed real false-positive investigation named (icp / icp-shell-client). It must
		// NOT be folded in just because the strings look related; only a shared repoKey merges.
		event({
			requestId: "req_lookalike",
			messageId: "msg_lookalike",
			timestamp: range.from,
			projectSlug: "personal/ccp-lookalike",
			repoKey: "hash-different-repo",
			costUsd: 5,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Project, range);

	const ccpRow = rows.find((row) => row.dimensionValue === "personal/ccp");
	expect(ccpRow).toEqual(expect.objectContaining({ costUsd: 3, eventCount: 2 }));
	expect(rows.some((row) => row.dimensionValue === "personal/ccp-notification-system")).toBe(false);

	const lookalikeRow = rows.find((row) => row.dimensionValue === "personal/ccp-lookalike");
	expect(lookalikeRow).toEqual(expect.objectContaining({ costUsd: 5, eventCount: 1 }));
});

test("a project with no repoKey stands alone, never merged by name with another repoKey-less project", async () => {
	const range = dayRange("2026-08-08");
	await saveUsageEvents(db, [
		event({ requestId: "req_no_key_a", messageId: "msg_no_key_a", timestamp: range.from, projectSlug: "personal/ccp", costUsd: 1 }),
		event({
			requestId: "req_no_key_b",
			messageId: "msg_no_key_b",
			timestamp: range.from,
			projectSlug: "personal/ccp-notification-system",
			costUsd: 2,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Project, range);

	expect(rows.find((row) => row.dimensionValue === "personal/ccp")).toEqual(expect.objectContaining({ costUsd: 1 }));
	expect(rows.find((row) => row.dimensionValue === "personal/ccp-notification-system")).toEqual(
		expect.objectContaining({ costUsd: 2 }),
	);
});

test("subagent cost is summed separately from total cost for the day", async () => {
	const range = dayRange("2026-08-06");
	await saveUsageEvents(db, [
		event({ requestId: "req_eff_main", messageId: "msg_eff_main", timestamp: range.from, isSubagent: false, costUsd: 3 }),
		event({ requestId: "req_eff_sub", messageId: "msg_eff_sub", timestamp: range.from, isSubagent: true, costUsd: 2 }),
		// An unpriced subagent event carrying a cost: both money sums must skip it while the
		// volume counts still see it. Without a non-zero cost here neither $cond guard is proven.
		event({
			requestId: "req_eff_sub_unpriced",
			messageId: "msg_eff_sub_unpriced",
			timestamp: range.from,
			isSubagent: true,
			priced: false,
			costUsd: 9.99,
		}),
	]);

	const rows = await dailyEfficiency(db, range);

	expect(rows).toEqual([
		expect.objectContaining({
			day: "2026-08-06",
			totalCostUsd: 5,
			subagentCostUsd: 2,
			totalEventCount: 3,
			subagentEventCount: 2,
		}),
	]);
});

test("cache read and write tokens are summed regardless of priced status (D8 — tokens are real either way)", async () => {
	const range = dayRange("2026-08-07");
	await saveUsageEvents(db, [
		event({
			requestId: "req_cache_priced",
			messageId: "msg_cache_priced",
			timestamp: range.from,
			cacheReadTokens: 1000,
			cacheWrite5mTokens: 100,
			cacheWrite1hTokens: 0,
			priced: true,
		}),
		event({
			requestId: "req_cache_unpriced",
			messageId: "msg_cache_unpriced",
			timestamp: range.from,
			cacheReadTokens: 500,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 50,
			priced: false,
			costUsd: 0,
		}),
	]);

	const rows = await dailyEfficiency(db, range);

	expect(rows).toEqual([
		expect.objectContaining({ day: "2026-08-07", cacheReadTokens: 1500, cacheWrite5mTokens: 100, cacheWrite1hTokens: 50 }),
	]);
});

test("a session's breakdown groups its cost by model", async () => {
	await saveUsageEvents(db, [
		event({
			requestId: "req_session_a",
			messageId: "msg_session_a",
			sessionId: "session-breakdown",
			model: "claude-opus-5",
			costUsd: 3,
		}),
		event({
			requestId: "req_session_b",
			messageId: "msg_session_b",
			sessionId: "session-breakdown",
			model: "claude-haiku-4-5",
			costUsd: 1,
		}),
	]);

	const summary = await getSessionBreakdown(db, "session-breakdown");

	const opusRow = summary?.byModel.find((row) => row.model === "claude-opus-5");
	const haikuRow = summary?.byModel.find((row) => row.model === "claude-haiku-4-5");
	expect(opusRow?.costUsd).toBe(3);
	expect(haikuRow?.costUsd).toBe(1);
});

test("a session id with no matching events returns null", async () => {
	const summary = await getSessionBreakdown(db, "session-does-not-exist");

	expect(summary).toBeNull();
});

test("an unpriced event in a session is excluded from totalCostUsd but counted in unpricedEventCount (D17)", async () => {
	await saveUsageEvents(db, [
		event({
			requestId: "req_session_unpriced",
			messageId: "msg_session_unpriced",
			sessionId: "session-unpriced",
			priced: false,
			// Non-zero on purpose — see the costPerDay unpriced test: a zero here would pass
			// against an unguarded `$sum: "$costUsd"` in either facet.
			costUsd: 9.99,
		}),
	]);

	const summary = await getSessionBreakdown(db, "session-unpriced");

	expect(summary).toEqual(expect.objectContaining({ totalCostUsd: 0, unpricedEventCount: 1 }));
	expect(summary?.byModel).toEqual([expect.objectContaining({ costUsd: 0, unpricedEventCount: 1, eventCount: 1 })]);
});

test("a model row's subagent-cost figure carries its own unpriced count, scoped to subagent events only (R41 — the whole-row count over-states hidden subagent spend that doesn't exist)", async () => {
	await saveUsageEvents(db, [
		event({
			requestId: "req_sub_main_priced",
			messageId: "msg_sub_main_priced",
			sessionId: "session-sub-scoped",
			model: "claude-x",
			costUsd: 4,
		}),
		event({
			requestId: "req_sub_main_unpriced",
			messageId: "msg_sub_main_unpriced",
			sessionId: "session-sub-scoped",
			model: "claude-x",
			priced: false,
			costUsd: 10,
		}),
		event({
			requestId: "req_sub_agent_unpriced",
			messageId: "msg_sub_agent_unpriced",
			sessionId: "session-sub-scoped",
			model: "claude-x",
			priced: false,
			isSubagent: true,
			costUsd: 500,
		}),
	]);

	const summary = await getSessionBreakdown(db, "session-sub-scoped");
	const row = summary?.byModel.find((r) => r.model === "claude-x");

	expect(row?.unpricedEventCount).toBe(2); // whole-row count: both unpriced events (main + subagent)
	expect(row?.subagentUnpricedEventCount).toBe(1); // scoped count: only the subagent one
});

test("a null projectSlug (a rogue/older client bypassing the mapper's allowlist) renders as explicitly unattributed, never a blank/null dimensionValue (absent-data at ingest)", async () => {
	const range = dayRange("2026-08-09");
	// Bypasses saveUsageEvents/UsageEventDocument's type on purpose — /api/sync copies every
	// per-event field unvalidated, so a rogue or older client can post `projectSlug: null` and it
	// reaches Mongo verbatim (see the ADVERSARIAL_REVALIDATION "Absent data at ingest" finding).
	await db.collection(USAGE_EVENTS_COLLECTION).insertOne({
		requestId: "req_null_slug",
		messageId: "msg_null_slug",
		sessionId: "session-null-slug",
		projectSlug: null,
		machineId: "machine-1",
		model: "claude-opus-5",
		timestamp: range.from,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
		outputTokens: 0,
		costUsd: 1,
		priced: true,
		isSubagent: false,
	});

	const rows = await costPerDay(db, CostSplitDimension.Project, range);

	expect(rows.some((row) => row.dimensionValue === null)).toBe(false);
	expect(rows.find((row) => row.costUsd === 1)?.dimensionValue).toBe("(unattributed)");
});

test("dimensionValueDomain orders dimension values by cost descending over the lookback range (D21)", async () => {
	const range = dayRange("2026-08-10");
	await saveUsageEvents(db, [
		event({ requestId: "req_domain_a", messageId: "msg_domain_a", machineId: "small-mac", timestamp: range.from, costUsd: 1 }),
		event({ requestId: "req_domain_b", messageId: "msg_domain_b", machineId: "big-mac", timestamp: range.from, costUsd: 5 }),
	]);

	const domain = await dimensionValueDomain(db, CostSplitDimension.Machine, range);

	expect(domain.indexOf("big-mac")).toBeLessThan(domain.indexOf("small-mac"));
});

test("dimensionValueDomain breaks a cost tie alphabetically (D21)", async () => {
	const range = dayRange("2026-08-11");
	await saveUsageEvents(db, [
		event({ requestId: "req_tie_b", messageId: "msg_tie_b", machineId: "b-mac", timestamp: range.from, costUsd: 2 }),
		event({ requestId: "req_tie_a", messageId: "msg_tie_a", machineId: "a-mac", timestamp: range.from, costUsd: 2 }),
	]);

	const domain = await dimensionValueDomain(db, CostSplitDimension.Machine, range);

	expect(domain.indexOf("a-mac")).toBeLessThan(domain.indexOf("b-mac"));
});

test("dimensionValueDomain merges raw model variants that normalize to the same model, like costPerDay does (D21)", async () => {
	const range = dayRange("2026-08-12");
	await saveUsageEvents(db, [
		event({ requestId: "req_domain_variant_a", messageId: "msg_domain_variant_a", timestamp: range.from, model: "claude-opus-5", costUsd: 1 }),
		event({
			requestId: "req_domain_variant_b",
			messageId: "msg_domain_variant_b",
			timestamp: range.from,
			model: "claude-opus-5[1m]",
			costUsd: 2,
		}),
	]);

	const domain = await dimensionValueDomain(db, CostSplitDimension.Model, range);

	expect(domain.filter((value) => value === "claude-opus-5")).toHaveLength(1);
});

test("dimensionValueDomain rolls up project rows sharing a repoKey, like costPerDay does (D21/D20)", async () => {
	const range = dayRange("2026-08-13");
	await saveUsageEvents(db, [
		event({
			requestId: "req_domain_repo_main",
			messageId: "msg_domain_repo_main",
			timestamp: range.from,
			projectSlug: "personal/ccp",
			repoKey: "hash-ccp-domain",
			costUsd: 1,
		}),
		event({
			requestId: "req_domain_repo_worktree",
			messageId: "msg_domain_repo_worktree",
			timestamp: range.from,
			projectSlug: "personal/ccp-notification-system",
			repoKey: "hash-ccp-domain",
			costUsd: 2,
		}),
	]);

	const domain = await dimensionValueDomain(db, CostSplitDimension.Project, range);

	expect(domain.includes("personal/ccp")).toBe(true);
	expect(domain.includes("personal/ccp-notification-system")).toBe(false);
});

test("a session that switched accounts mid-session reports its first chronological account (deliberate default)", async () => {
	await saveUsageEvents(db, [
		event({
			requestId: "req_mixed_first",
			messageId: "msg_mixed_first",
			sessionId: "session-mixed-account",
			accountUuid: "account-first",
			timestamp: new Date("2026-08-01T10:00:00.000Z"),
		}),
		event({
			requestId: "req_mixed_second",
			messageId: "msg_mixed_second",
			sessionId: "session-mixed-account",
			accountUuid: "account-second",
			timestamp: new Date("2026-08-01T11:00:00.000Z"),
		}),
	]);

	const summary = await getSessionBreakdown(db, "session-mixed-account");

	expect(summary?.accountUuid).toBe("account-first");
});
