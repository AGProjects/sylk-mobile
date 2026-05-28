// app/conferenceRecordingDisclosure.js
//
// Per-account persistence for the conference-recording disclaimer
// acknowledgement. Sibling to callRecordingDisclosure.js but stored
// under a SEPARATE flag (`disclaimers.conferenceRecording`) because
// recording a conference is meaningfully different from recording a
// 1-to-1 call (multi-party consent, more attendees, the moderator
// of the room may not be you) and the user should be able to opt
// in / out independently.
//
// Storage shape mirrors the other two disclaimers in
// accounts.settings:
//   disclaimers.conferenceRecording     (boolean)
//   disclaimers.conferenceRecordingAt   (Unix ms of agreement)
//
// The Disclaimers section in PreferencesModal reads all three
// disclaimers (location, call recording, conference recording) via
// their readAcknowledged + readAcknowledgedAt pairs and renders one
// row per disclaimer with the agreement timestamp formatted as a
// human-readable date.

import {
    getAccountSetting,
    setAccountSetting,
} from './accountSettingsAccess';

const SETTING_PATH = 'disclaimers.conferenceRecording';
const SETTING_PATH_AT = 'disclaimers.conferenceRecordingAt';

export async function readAcknowledged(/* accountId */) {
    return getAccountSetting(SETTING_PATH) === true;
}

export async function readAcknowledgedAt(/* accountId */) {
    const v = getAccountSetting(SETTING_PATH_AT);
    return typeof v === 'number' && v > 0 ? v : 0;
}

export async function setAcknowledged(/* accountId */) {
    await setAccountSetting(SETTING_PATH, true);
    await setAccountSetting(SETTING_PATH_AT, Date.now());
}

export async function clearAcknowledged(/* accountId */) {
    await setAccountSetting(SETTING_PATH, false);
    await setAccountSetting(SETTING_PATH_AT, 0);
}

export default {
    readAcknowledged,
    readAcknowledgedAt,
    setAcknowledged,
    clearAcknowledged,
};
