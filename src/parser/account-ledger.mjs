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

/**
 * Which account was active for a session at a given moment.
 *
 * @param {Record<string, AccountEntry[]>} ledger
 * @param {string} sessionId
 * @param {string} timestamp - ISO timestamp of the turn being attributed
 * @returns {{accountUuid: string, orgUuid: string}|null} null when the session is unknown
 */
export function accountFor(ledger, sessionId, timestamp) {
	const entries = ledger?.[sessionId];
	if (!entries?.length) return null;

	// Latest entry that had already taken effect — same effective-dating as the price table.
	let match = null;
	for (const entry of entries) {
		if (entry.from <= timestamp) match = entry;
	}

	// A turn predating the first record still belongs to that session's earliest known account.
	const chosen = match ?? entries[0];
	return { accountUuid: chosen.accountUuid, orgUuid: chosen.orgUuid };
}
