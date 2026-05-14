// app/callRecordingDisclosure.js
//
// Per-account persistence for the "call recording can have legal
// consequences" disclaimer acknowledgement.
//
// Storage moved from per-account-keyed AsyncStorage
//   callRecordingDisclosureAcknowledged.v1.<accountId>
// into the SQL `accounts.settings` JSON blob, under the path
//   disclaimers.callRecording  (boolean)
// alongside the rest of the user's per-account settings. Call sites
// (PreferencesModal mount + auto-record gate, AudioCallBox in-call
// record button) keep their existing readAcknowledged /
// setAcknowledged / clearAcknowledged signatures unchanged — the
// disclosure module now routes through accountSettingsAccess.js
// rather than the AsyncStorage `storage` wrapper.
//
// The accountId argument is ignored — accounts.settings is already
// scoped per-account at the SQL row level — but kept on the API for
// backwards compatibility with the call sites.
//
// No carry-over from the old AsyncStorage flag: by design, the user
// is re-prompted once after upgrade if they try to enable call
// recording again.

import {
    getAccountSetting,
    setAccountSetting,
} from './accountSettingsAccess';

const SETTING_PATH = 'disclaimers.callRecording';

/**
 * Read the per-account flag. Returns false when no account is loaded
 * yet (the bridge returns undefined → coerced to false). Callers
 * treat that as "not yet acknowledged" so the disclaimer is shown
 * rather than silently allowing recording.
 */
export async function readAcknowledged(/* accountId */) {
    return getAccountSetting(SETTING_PATH) === true;
}

export async function setAcknowledged(/* accountId */) {
    await setAccountSetting(SETTING_PATH, true);
}

export async function clearAcknowledged(/* accountId */) {
    await setAccountSetting(SETTING_PATH, false);
}

export default {
    readAcknowledged,
    setAcknowledged,
    clearAcknowledged,
};
