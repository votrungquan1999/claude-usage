/**
 * @typedef {object} AccountEntry
 * @property {string} from  - ISO timestamp this account became active for the session
 * @property {string} accountUuid
 * @property {string} orgUuid
 */

/**
 * Note the account a session is running under, if it differs from what is already known.
 *
 * @param {Record<string, AccountEntry[]>} ledger
 * @param {string} sessionId
 * @param {{accountUuid: string, orgUuid: string}} account
 * @param {string} at - ISO timestamp of the observation
 * @returns {Record<string, AccountEntry[]>} a new ledger
 */
export function recordAccount(ledger, sessionId, account, at) {
	const entries = ledger[sessionId] ?? [];
	const latest = entries.at(-1);

	if (latest?.accountUuid === account.accountUuid && latest?.orgUuid === account.orgUuid) {
		return ledger;
	}

	return {
		...ledger,
		[sessionId]: [...entries, { from: at, accountUuid: account.accountUuid, orgUuid: account.orgUuid }],
	};
}

// A turn predating every ledger entry can only inherit the earliest one when that entry was
// recorded close enough to the turn to plausibly be a genuine session-start observation (R13)
// — not a delayed first sync, days or weeks later, that happens to land while a DIFFERENT
// account is logged in (R12). `entries[0]` never moves once written and `accountUuid` is
// `$set`, so a wrong guess here is permanent and self-reinforcing on every re-backfill. D7:
// absent-means-absent beats a guess, so outside this window the turn ships unattributed.
const PLAUSIBLE_OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which account was active for a session at a given moment.
 *
 * @param {Record<string, AccountEntry[]>} ledger
 * @param {string} sessionId
 * @param {string} timestamp - ISO timestamp of the turn being attributed
 * @returns {{accountUuid: string, orgUuid: string}|null} null when the session is unknown, or
 *   when it is known only from an observation too far after this turn to trust (R12)
 */
export function accountFor(ledger, sessionId, timestamp) {
	const entries = ledger?.[sessionId];
	if (!entries?.length) return null;

	// Latest entry that had already taken effect — same effective-dating as the price table.
	let match = null;
	for (const entry of entries) {
		if (entry.from <= timestamp) match = entry;
	}
	if (match) return { accountUuid: match.accountUuid, orgUuid: match.orgUuid };

	const first = entries[0];
	const gapMs = Date.parse(first.from) - Date.parse(timestamp);
	if (Number.isNaN(gapMs) || gapMs < 0 || gapMs > PLAUSIBLE_OBSERVATION_WINDOW_MS) return null;
	return { accountUuid: first.accountUuid, orgUuid: first.orgUuid };
}
