// app/locationDisclosure.js
//
// Per-account persistence for the Android Google-Play "before-the-fact
// in-app location disclosure" acknowledgement.
//
// Storage moved from per-account-keyed AsyncStorage
//   locationDisclosureAcknowledged.v2.<accountId>
// into the SQL `accounts.settings` JSON blob, under the path
//   disclaimers.locationPolicy  (boolean)
// alongside the rest of the user's per-account settings (codecs,
// encryption mode, location knobs, etc.). The disclosure modules now
// route through accountSettingsAccess.js so the call sites
// (NavigationBar mount, NavigationBar share-flow gate, NavigationBar
// viewer, app.js meeting-request modal, app.js location-request
// modal) keep their existing readAcknowledged / setAcknowledged /
// clearAcknowledged signatures unchanged.
//
// The accountId argument is ignored — accounts.settings is already
// scoped per-account at the SQL row level — but kept on the API for
// backwards compatibility with the call sites.
//
// No carry-over from the old AsyncStorage flag: by design, the user
// is re-prompted once after upgrade.

import {
    getAccountSetting,
    setAccountSetting,
} from './accountSettingsAccess';

const SETTING_PATH = 'disclaimers.locationPolicy';

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
