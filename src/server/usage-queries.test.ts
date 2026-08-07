import { MongoMemoryServer } from "mongodb-memory-server";
import { type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, expect, test } from "vitest";

import { USAGE_EVENTS_COLLECTION, ensureUsageIndexes, saveUsageEvents, type UsageEventDocument } from "./usage-store";
import {
	CostSplitDimension,
	costPerDay,
	dailyEfficiency,
	dailyEfficiencyByModel,
	dimensionValueDomain,
	earliestEventTimestamp,
	getSessionBreakdown,
	listSessions,
	SessionSortOrder,
	splitValueBreakdown,
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

test("earliestEventTimestamp reports the oldest recorded event, giving the widest window a real bound (D36)", async () => {
	// Own database: this query spans the WHOLE collection, so it would otherwise see every event
	// the other tests in this file leave behind.
	const isolated = client.db("claude-usage-earliest");
	await saveUsageEvents(isolated, [
		event({ requestId: "req_mid", timestamp: new Date("2026-06-15T08:00:00.000Z") }),
		event({ requestId: "req_oldest", timestamp: new Date("2026-05-30T02:00:00.000Z") }),
		event({ requestId: "req_new", timestamp: new Date("2026-08-01T09:00:00.000Z") }),
	]);

	const earliest = await earliestEventTimestamp(isolated);

	expect(earliest).toEqual(new Date("2026-05-30T02:00:00.000Z"));
});

test("earliestEventTimestamp is null on an empty corpus, so all-time has something to fall back from (D36)", async () => {
	expect(await earliestEventTimestamp(client.db("claude-usage-empty"))).toBeNull();
});

test("dailyEfficiency reports a day's unpriced events, so a month total can be shown as a lower bound (D17)", async () => {
	const range = dayRange("2026-09-14");
	await saveUsageEvents(db, [
		event({ requestId: "req_eff_priced", timestamp: new Date("2026-09-14T10:00:00.000Z") }),
		event({ requestId: "req_eff_unpriced", timestamp: new Date("2026-09-14T11:00:00.000Z"), priced: false, costUsd: 0 }),
	]);

	const [day] = await dailyEfficiency(db, range);

	expect(day.unpricedEventCount).toBe(1);
	expect(day.totalEventCount).toBe(2);
});

test("the repo split never renders the raw repoKey hash, which is a confirmable identifier and not an opaque token", async () => {
	const range = dayRange("2026-09-20");
	await saveUsageEvents(db, [
		event({
			requestId: "req_repo_hash",
			messageId: "msg_repo_hash",
			timestamp: range.from,
			projectSlug: "personal/lms",
			repoKey: "00ae847a1b2c3d4e5f",
			costUsd: 3,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Repo, range);

	expect(rows.some((row) => row.dimensionValue === "00ae847a1b2c3d4e5f")).toBe(false);
	expect(rows).toContainEqual(expect.objectContaining({ dimensionValue: "personal/lms", costUsd: 3 }));
});

test("on the repo split, every project with no repository collapses into ONE named bucket — the opposite of the project split", async () => {
	const range = dayRange("2026-09-21");
	await saveUsageEvents(db, [
		// Two unrelated projects, neither in a git repo, BOTH with a real slug — deliberately no
		// null-slug row here. A null slug is already labelled "(unattributed)" before the merge
		// runs, so including one would let this test pass even if the merge kept a project's name.
		event({ requestId: "req_nr_a", messageId: "msg_nr_a", timestamp: range.from, projectSlug: "git-repos/personal", costUsd: 3 }),
		event({ requestId: "req_nr_b", messageId: "msg_nr_b", timestamp: range.from, projectSlug: "git-repos/concrete_engine", costUsd: 5 }),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Repo, range);

	// On the Project tab these stand alone; here "no repository" is the answer itself, and it is
	// over half of all spend — splitting it across project names would hide that.
	expect(rows).toEqual([expect.objectContaining({ dimensionValue: "(unattributed)", costUsd: 8, eventCount: 2 })]);
});

test("a row missing its project slug entirely joins the same unattributed repo bucket, not a second one", async () => {
	const range = dayRange("2026-09-23");
	await saveUsageEvents(db, [
		event({ requestId: "req_ns_a", messageId: "msg_ns_a", timestamp: range.from, projectSlug: "git-repos/personal", costUsd: 3 }),
		event({ requestId: "req_ns_b", messageId: "msg_ns_b", timestamp: range.from, projectSlug: undefined, costUsd: 2 }),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Repo, range);

	expect(rows).toEqual([expect.objectContaining({ dimensionValue: "(unattributed)", costUsd: 5, eventCount: 2 })]);
});

test("on the repo split, checkouts sharing a repoKey merge under the shortest project slug (D20)", async () => {
	const range = dayRange("2026-09-22");
	await saveUsageEvents(db, [
		event({ requestId: "req_rw_main", messageId: "msg_rw_main", timestamp: range.from, projectSlug: "personal/ccp", repoKey: "hash-rw", costUsd: 1 }),
		event({
			requestId: "req_rw_tree",
			messageId: "msg_rw_tree",
			timestamp: range.from,
			projectSlug: "personal/ccp-TICKET-42",
			repoKey: "hash-rw",
			costUsd: 2,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Repo, range);

	expect(rows).toContainEqual(expect.objectContaining({ dimensionValue: "personal/ccp", costUsd: 3, eventCount: 2 }));
	expect(rows.some((row) => row.dimensionValue === "personal/ccp-TICKET-42")).toBe(false);
});

test("a repository keeps ONE label across the window, including days when only its worktree ran", async () => {
	// Picking the shortest slug per DAY splits one repository into two ranked rows as soon as a
	// worktree works a branch alone for a day — each carrying part of the cost, and each linking
	// to part of the sessions.
	const range = { from: new Date("2026-12-01T00:00:00.000Z"), to: new Date("2026-12-02T23:59:59.999Z") };
	await saveUsageEvents(db, [
		event({
			requestId: "req_wl_main",
			messageId: "msg_wl_main",
			timestamp: new Date("2026-12-01T10:00:00.000Z"),
			projectSlug: "personal/rules",
			repoKey: "hash-wl",
			costUsd: 1,
		}),
		event({
			requestId: "req_wl_tree",
			messageId: "msg_wl_tree",
			timestamp: new Date("2026-12-02T10:00:00.000Z"),
			projectSlug: "personal/rules-feature-branch",
			repoKey: "hash-wl",
			costUsd: 2,
		}),
	]);

	const rows = await costPerDay(db, CostSplitDimension.Repo, range);

	expect(rows.map((row) => row.dimensionValue)).toEqual(["personal/rules", "personal/rules"]);
});

test("drilling into a repository covers every worktree checkout that shares it", async () => {
	const range = dayRange("2026-12-05");
	await saveUsageEvents(db, [
		event({
			requestId: "req_dd_main",
			messageId: "msg_dd_main",
			sessionId: "dd-main",
			timestamp: range.from,
			projectSlug: "personal/dd",
			repoKey: "hash-dd",
			costUsd: 1,
		}),
		event({
			requestId: "req_dd_tree",
			messageId: "msg_dd_tree",
			sessionId: "dd-tree",
			timestamp: range.from,
			projectSlug: "personal/dd-TICKET-1",
			repoKey: "hash-dd",
			costUsd: 2,
		}),
	]);

	const breakdown = await splitValueBreakdown(
		db,
		CostSplitDimension.Repo,
		"personal/dd",
		range,
		0,
		25,
		SessionSortOrder.Cost,
	);

	// The clicked row is worth $3 on the Repo tab, so the page it opens must be worth $3 too — the
	// worktree's session cannot be missing just because the row is labelled with the main checkout.
	expect(breakdown.costUsd).toBe(3);
	expect(breakdown.sessionCount).toBe(2);
	expect(breakdown.sessions.map((session) => session.sessionId)).toEqual(["dd-tree", "dd-main"]);
});

test("drilling into a project covers both its repository and the turns that resolved no repository", async () => {
	// Since per-turn attribution a turn that resolved the repo and one that fell back to the
	// project directory land on the SAME slug, and the Project tab sums them into one row. A
	// drill-down matching only the repository would show two thirds of the number clicked.
	const range = dayRange("2026-12-06");
	await saveUsageEvents(db, [
		event({
			requestId: "req_pp_repo",
			messageId: "msg_pp_repo",
			sessionId: "pp-repo",
			timestamp: range.from,
			projectSlug: "personal/pp",
			repoKey: "hash-pp",
			costUsd: 1,
		}),
		event({
			requestId: "req_pp_bare",
			messageId: "msg_pp_bare",
			sessionId: "pp-bare",
			timestamp: range.from,
			projectSlug: "personal/pp",
			costUsd: 2,
		}),
	]);

	const breakdown = await splitValueBreakdown(
		db,
		CostSplitDimension.Project,
		"personal/pp",
		range,
		0,
		25,
		SessionSortOrder.Cost,
	);

	expect(breakdown.costUsd).toBe(3);
	expect(breakdown.sessionCount).toBe(2);
});

test("drilling into a model covers every raw variant that normalizes to its name", async () => {
	const range = dayRange("2026-12-07");
	await saveUsageEvents(db, [
		event({
			requestId: "req_mm_plain",
			messageId: "msg_mm_plain",
			sessionId: "mm-plain",
			timestamp: range.from,
			model: "claude-opus-5",
			costUsd: 1,
		}),
		event({
			requestId: "req_mm_long",
			messageId: "msg_mm_long",
			sessionId: "mm-long",
			timestamp: range.from,
			model: "claude-opus-5[1m]",
			costUsd: 2,
		}),
	]);

	const breakdown = await splitValueBreakdown(
		db,
		CostSplitDimension.Model,
		"claude-opus-5",
		range,
		0,
		25,
		SessionSortOrder.Cost,
	);

	expect(breakdown.costUsd).toBe(3);
	expect(breakdown.sessionCount).toBe(2);
});

test("drilling into the unattributed bucket covers every session with no repository, and only those", async () => {
	const range = dayRange("2026-12-08");
	await saveUsageEvents(db, [
		event({
			requestId: "req_un_a",
			messageId: "msg_un_a",
			sessionId: "un-a",
			timestamp: range.from,
			projectSlug: "personal/un-a",
			costUsd: 1,
		}),
		event({
			requestId: "req_un_b",
			messageId: "msg_un_b",
			sessionId: "un-b",
			timestamp: range.from,
			projectSlug: "personal/un-b",
			costUsd: 2,
		}),
		// Attributed to a real repository, so it belongs to that row rather than this bucket.
		event({
			requestId: "req_un_repo",
			messageId: "msg_un_repo",
			sessionId: "un-repo",
			timestamp: range.from,
			projectSlug: "personal/un-c",
			repoKey: "hash-un",
			costUsd: 4,
		}),
	]);

	const breakdown = await splitValueBreakdown(
		db,
		CostSplitDimension.Repo,
		"(unattributed)",
		range,
		0,
		25,
		SessionSortOrder.Cost,
	);

	expect(breakdown.costUsd).toBe(3);
	expect(breakdown.sessionCount).toBe(2);
	expect(breakdown.sessions.some((session) => session.sessionId === "un-repo")).toBe(false);
});

test("a session's cost on a drill-down is the slice attributed to that value, not the whole session", async () => {
	// Per-turn attribution lets one session span repositories, so "what this session cost" has two
	// answers. The row shows the slice — that is what makes the rows sum to the total above them —
	// and carries the whole-session figure alongside so clicking through is not a surprise.
	const range = dayRange("2026-12-09");
	await saveUsageEvents(db, [
		event({
			requestId: "req_sp_a",
			messageId: "msg_sp_a",
			sessionId: "sp-split",
			timestamp: range.from,
			projectSlug: "personal/sp-a",
			repoKey: "hash-sp-a",
			costUsd: 1,
		}),
		event({
			requestId: "req_sp_b",
			messageId: "msg_sp_b",
			sessionId: "sp-split",
			timestamp: range.from,
			projectSlug: "personal/sp-b",
			repoKey: "hash-sp-b",
			costUsd: 3,
		}),
	]);

	const breakdown = await splitValueBreakdown(
		db,
		CostSplitDimension.Repo,
		"personal/sp-a",
		range,
		0,
		25,
		SessionSortOrder.Cost,
	);

	expect(breakdown.costUsd).toBe(1);
	expect(breakdown.sessions).toHaveLength(1);
	expect(breakdown.sessions[0].costUsd).toBe(1);
	expect(breakdown.sessions[0].totalCostUsd).toBe(4);
});

test("dailyEfficiencyByModel splits a day's cache savings by model, so the mix and the savings agree", async () => {
	const range = dayRange("2026-10-05");
	await saveUsageEvents(db, [
		event({
			requestId: "req_bm_opus",
			messageId: "msg_bm_opus",
			timestamp: range.from,
			model: "claude-opus-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
		event({
			requestId: "req_bm_haiku",
			messageId: "msg_bm_haiku",
			timestamp: range.from,
			model: "claude-haiku-4-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
	]);

	const rows = await dailyEfficiencyByModel(db, range);

	// $5/MTok and $1/MTok base prices; a read saves 0.9x of that.
	expect(rows.find((row) => row.model === "claude-opus-5")?.netSavedUsd).toBeCloseTo(4.5, 6);
	expect(rows.find((row) => row.model === "claude-haiku-4-5")?.netSavedUsd).toBeCloseTo(0.9, 6);
});

test("a local day straddling a price change prices each side at the rate it was actually billed at (D6a)", async () => {
	// claude-sonnet-5 moves from $2/MTok to $3/MTok at 2026-09-01T00:00Z. The local day
	// 2026-09-01 in Asia/Ho_Chi_Minh runs 2026-08-31T17:00Z -> 2026-09-01T16:59Z, so it spans that
	// boundary. Both events below land on the SAME local day and on DIFFERENT sides of the change.
	const range = { from: new Date("2026-08-31T17:00:00.000Z"), to: new Date("2026-09-01T16:59:59.999Z") };
	await saveUsageEvents(db, [
		event({
			requestId: "req_boundary_old",
			messageId: "msg_boundary_old",
			timestamp: new Date("2026-08-31T18:00:00.000Z"),
			model: "claude-sonnet-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
		event({
			requestId: "req_boundary_new",
			messageId: "msg_boundary_new",
			timestamp: new Date("2026-09-01T10:00:00.000Z"),
			model: "claude-sonnet-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
		// A second model on the same day, so the merge cannot pass by collapsing everything.
		event({
			requestId: "req_boundary_other",
			messageId: "msg_boundary_other",
			timestamp: new Date("2026-09-01T10:00:00.000Z"),
			model: "claude-haiku-4-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
	]);

	const rows = await dailyEfficiencyByModel(db, range);
	const sonnet = rows.filter((row) => row.day === "2026-09-01" && row.model === "claude-sonnet-5");

	// One merged row: $1.80 at the old rate plus $2.70 at the new one. Pricing the whole local day
	// at either single rate gives $3.60 or $5.40 — both wrong, and both silently so.
	expect(sonnet).toHaveLength(1);
	expect(sonnet[0].grossSavedUsd).toBeCloseTo(4.5, 6);
	expect(sonnet[0].totalEventCount).toBe(2);
});

test("raw model variants that normalize to the same model merge into one row, so a 1m-context variant is not a second series", async () => {
	const range = dayRange("2026-10-08");
	await saveUsageEvents(db, [
		event({
			requestId: "req_nm_plain",
			messageId: "msg_nm_plain",
			timestamp: range.from,
			model: "claude-opus-5",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
		event({
			requestId: "req_nm_1m",
			messageId: "msg_nm_1m",
			timestamp: range.from,
			model: "claude-opus-5[1m]",
			cacheReadTokens: 1_000_000,
			cacheWrite5mTokens: 0,
			cacheWrite1hTokens: 0,
		}),
	]);

	const rows = await dailyEfficiencyByModel(db, range);

	expect(rows).toHaveLength(1);
	expect(rows[0].model).toBe("claude-opus-5");
	expect(rows[0].grossSavedUsd).toBeCloseTo(9, 6);
});

test("a session's title is the most recent one recorded, even when its newest event carries none", async () => {
	const range = dayRange("2026-11-06");
	await saveUsageEvents(db, [
		event({
			requestId: "req_t1",
			messageId: "msg_t1",
			sessionId: "sess-titled",
			timestamp: new Date("2026-11-06T01:00:00.000Z"),
			sessionTitle: "Investigate flaky test",
		}),
		event({
			requestId: "req_t2",
			messageId: "msg_t2",
			sessionId: "sess-titled",
			timestamp: new Date("2026-11-06T02:00:00.000Z"),
			sessionTitle: "Migrate the test runner",
		}),
		// Newest event, no title: a tail sync whose window did not reach back to the `ai-title`
		// record. Taking the newest event's title outright would blank a session that HAS a name.
		event({
			requestId: "req_t3",
			messageId: "msg_t3",
			sessionId: "sess-titled",
			timestamp: new Date("2026-11-06T03:00:00.000Z"),
		}),
	]);

	const page = await listSessions(db, range, 0, 25, SessionSortOrder.Cost);

	expect(page.rows[0].sessionTitle).toBe("Migrate the test runner");
});

test("listSessions ranks a window's sessions by what they cost in it, breaking ties by session id (D38)", async () => {
	const range = dayRange("2026-11-02");
	await saveUsageEvents(db, [
		// Inserted in reverse id order so the assertion below is about the SORT, not about insertion.
		// Honest limitation: this engine's $group happens to emit a deterministic order, so removing
		// the `_id: 1` tie-break does not fail here — verified by injecting exactly that. The
		// tie-break stays because that determinism is not guaranteed on a real deployment, and once
		// $skip paginates, an unstable tie puts a session on two pages or on none (D38).
		event({ requestId: "req_sl_c", messageId: "msg_sl_c", sessionId: "sess-c", timestamp: range.from, costUsd: 5 }),
		event({ requestId: "req_sl_a", messageId: "msg_sl_a", sessionId: "sess-b", timestamp: range.from, costUsd: 5 }),
		event({ requestId: "req_sl_b", messageId: "msg_sl_b", sessionId: "sess-a", timestamp: range.from, costUsd: 9 }),
	]);

	const page = await listSessions(db, range, 0, 25, SessionSortOrder.Cost);

	expect(page.rows.map((row) => row.sessionId)).toEqual(["sess-a", "sess-b", "sess-c"]);
	expect(page.totalCount).toBe(3);
});

test("a session straddling the window's edge shows its in-window slice AND its full total (D32)", async () => {
	// ~5-15 sessions start per day, so a session that began before the window is routine, not
	// exotic. The in-window figure is what sorts, keeping the list consistent with the chart above.
	const range = dayRange("2026-11-05");
	await saveUsageEvents(db, [
		event({ requestId: "req_st_before", messageId: "msg_st_before", sessionId: "sess-straddle", timestamp: new Date("2026-11-04T10:00:00.000Z"), costUsd: 7 }),
		event({ requestId: "req_st_inside", messageId: "msg_st_inside", sessionId: "sess-straddle", timestamp: range.from, costUsd: 3 }),
	]);

	const page = await listSessions(db, range, 0, 25, SessionSortOrder.Cost);
	const row = page.rows.find((candidate) => candidate.sessionId === "sess-straddle");

	expect(row?.costUsd).toBe(3);
	expect(row?.totalCostUsd).toBe(10);
});

test("listSessions pages through a window without dropping or repeating a session (D34)", async () => {
	const range = dayRange("2026-11-08");
	await saveUsageEvents(
		db,
		[1, 2, 3, 4, 5].map((n) =>
			event({
				requestId: `req_pg_${n}`,
				messageId: `msg_pg_${n}`,
				sessionId: `sess-pg-${n}`,
				timestamp: range.from,
				costUsd: n,
			}),
		),
	);

	const first = await listSessions(db, range, 0, 2, SessionSortOrder.Cost);
	const second = await listSessions(db, range, 1, 2, SessionSortOrder.Cost);

	expect(first.rows.map((row) => row.sessionId)).toEqual(["sess-pg-5", "sess-pg-4"]);
	expect(second.rows.map((row) => row.sessionId)).toEqual(["sess-pg-3", "sess-pg-2"]);
	// The count describes the whole window, not the page — the pager needs it to know how far to go.
	expect(first.totalCount).toBe(5);
});

test("listSessions reports normalized model names, not the raw dated ids stored on the events", async () => {
	const range = dayRange("2026-11-11");
	await saveUsageEvents(db, [
		event({ requestId: "req_mn_a", messageId: "msg_mn_a", sessionId: "sess-models", timestamp: range.from, model: "claude-opus-5" }),
		event({ requestId: "req_mn_b", messageId: "msg_mn_b", sessionId: "sess-models", timestamp: range.from, model: "claude-opus-5[1m]" }),
	]);

	const page = await listSessions(db, range, 0, 25, SessionSortOrder.Cost);

	expect(page.rows.find((row) => row.sessionId === "sess-models")?.models).toEqual(["claude-opus-5"]);
});

test("listSessions can order by most recent activity instead of cost", async () => {
	const range = dayRange("2026-11-15");
	await saveUsageEvents(db, [
		// The cheapest session is the most recent one, so cost order and recency order disagree —
		// otherwise this test would pass under either.
		event({ requestId: "req_so_rich", messageId: "msg_so_rich", sessionId: "sess-rich", timestamp: new Date("2026-11-15T02:00:00.000Z"), costUsd: 90 }),
		event({ requestId: "req_so_late", messageId: "msg_so_late", sessionId: "sess-late", timestamp: new Date("2026-11-15T20:00:00.000Z"), costUsd: 1 }),
	]);

	const byRecent = await listSessions(db, range, 0, 25, SessionSortOrder.Recent);
	const byCost = await listSessions(db, range, 0, 25, SessionSortOrder.Cost);

	expect(byRecent.rows.map((row) => row.sessionId)).toEqual(["sess-late", "sess-rich"]);
	expect(byCost.rows.map((row) => row.sessionId)).toEqual(["sess-rich", "sess-late"]);
});

test("listSessions can order by how busy a session was, which is not the same as what it cost", async () => {
	const range = dayRange("2026-11-18");
	await saveUsageEvents(db, [
		// One expensive event vs three cheap ones: cost and volume rank these in opposite orders.
		event({ requestId: "req_sb_big", messageId: "msg_sb_big", sessionId: "sess-costly", timestamp: range.from, costUsd: 50 }),
		...[1, 2, 3].map((n) =>
			event({ requestId: `req_sb_${n}`, messageId: `msg_sb_${n}`, sessionId: "sess-busy", timestamp: range.from, costUsd: 1 }),
		),
	]);

	const page = await listSessions(db, range, 0, 25, SessionSortOrder.Events);

	expect(page.rows.map((row) => row.sessionId)).toEqual(["sess-busy", "sess-costly"]);
});
