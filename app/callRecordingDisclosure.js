// app/callRecordingDisclosure.js
//
// Per-account persistence for the "call recording can have legal
// consequences" disclaimer acknowledgement. Mirrors locationDisclosure.js
// so the same per-SIP-identity scoping applies — a second account
// signing in on the same physical device must accept the disclaimer
// for itself rather than silently inheriting the first user's choice.
//
// Key shape:
//   callRecordingDisclosureAcknowledged.v1.<accountId>
// Value: boolean true once the user opts in. Absent / false means
// either "never asked" or "explicitly opted out" — the toggle gate
// in PreferencesModal will re-show the modal next time the user
// flips Automatic call recording back on, and (separately) the
// viewer link in Preferences re-opens it in opt-out mode.
//
// Read sites: PreferencesModal mount + the auto-record gate.
// Write sites: PreferencesModal toggle (set on opt-in / clear on
// opt-out via the viewer button).

import storage from './storage';

const STORAGE_KEY_PREFIX = 'callRecordingDisclosureAcknowledged.v1';

function _key(accountId) {
    if (accountId && typeof accountId === 'string' && accountId.length > 0) {
        return `${STORAGE_KEY_PREFIX}.${accountId}`;
    }
    return null;
}

/**
 * Read the per-account flag. Returns false when no accountId is in
 * scope yet (callers must treat that as "not yet acknowledged" so the
 * disclaimer is shown rather than silently allowing recording).
 */
export async function readAcknowledged(accountId) {
    const k = _key(accountId);
    if (!k) return false;
    try {
        const v = await storage.get(k);
        return v === true;
    } catch (e) {
        // Read failure → treat as not-yet-acknowledged. Better to
        // re-prompt than to silently skip the disclosure.
        return false;
    }
}

export async function setAcknowledged(accountId) {
    const k = _key(accountId);
    if (!k) return;
    try { await storage.set(k, true); }
    catch (e) { /* persistence failure is non-fatal — modal will be re-shown next time */ }
}

export async function clearAcknowledged(accountId) {
    const k = _key(accountId);
    if (!k) return;
    try { await storage.remove(k); }
    catch (e) { /* noop */ }
}

export default {
    readAcknowledged,
    setAcknowledged,
    clearAcknowledged,
};
