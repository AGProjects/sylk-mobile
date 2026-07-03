// ContactCapabilities — pure, side-effect-free predicates that answer
// "what can this contact / URI do?". These rules were previously duplicated
// (and had started to drift) across ReadyBox's showCallButtons /
// showAudioRecordButton / showLocationShareButton / chatDisabledForUri and the
// *ButtonDisabled getters. Centralising them here gives one place to read and
// change the rules, and makes them unit-testable in isolation.
//
// Everything here is a pure function of its arguments — no `this`, no props,
// no state — so the same helper can be reused by any component (e.g. the
// NavigationBar menu, which enforces the same location-share rules).

import utils from '../utils';

// Conference rooms ----------------------------------------------------------

// Video conference room, e.g. `room@videoconference.example.com`.
export function isVideoConferenceUri(uri) {
    return !!uri && uri.indexOf('@videoconference') > -1;
}

// Audio-only conference room, e.g. `room@conference.example.com`. Distinct
// from a video conference (matched above). Audio rooms don't accept inbound
// file transfers, so voice memos can't be delivered to them.
export function isAudioConferenceUri(uri) {
    return !!uri && uri.indexOf('@conference') > -1;
}

// Anonymous / guest peers -----------------------------------------------------

// The canonical anonymous@anonymous.invalid contact (and the legacy
// <random>@guest.<host> form) collapses many throwaway peers into one
// synthetic row with no reachable address.
export function isAnonymousUri(uri) {
    return !!uri && utils.isAnonymous(uri);
}

// PSTN-style numbers ----------------------------------------------------------

// A phone-number local part entered with a leading 0 or + (e.g.
// `012345@domain` or `+3912345@domain`). These are PSTN destinations that
// can't receive Sylk file transfers — so neither voice memos nor live-location
// shares can be delivered to them.
export function isLeadingPhoneNumberUri(uri) {
    if (!uri) {
        return false;
    }
    const username = uri.split('@')[0];
    if (!utils.isPhoneNumber(username)) {
        return false;
    }
    return username.startsWith('0') || username.startsWith('+');
}

// Contact-object predicates ---------------------------------------------------

// `test`-tagged contacts are local-only stubs used for QA / first-run
// scaffolding; file transfers (and therefore voice-memo delivery) are disabled
// for them.
export function isTestContact(contact) {
    return !!contact
        && Array.isArray(contact.tags)
        && contact.tags.indexOf('test') > -1;
}

// Location sharing ships encrypted with no plaintext fallback, so the contact
// must have a PGP public key for it to be possible.
export function contactHasPublicKey(contact) {
    return !!(contact && contact.publicKey);
}

// Composed capabilities -------------------------------------------------------

// Can a recorded voice memo (file transfer) actually be delivered to this
// contact? Mirrors the contact-type gating in ReadyBox.showAudioRecordButton
// (the call-state and mic-permission gates stay in the getter since they're
// not properties of the contact).
export function canReceiveVoiceMemo(contact) {
    if (!contact || !contact.uri) {
        return false;
    }
    const uri = contact.uri;
    if (isVideoConferenceUri(uri)) {
        return false;
    }
    if (isAnonymousUri(uri)) {
        return false;
    }
    if (isAudioConferenceUri(uri)) {
        return false;
    }
    if (isTestContact(contact)) {
        //return false;
    }
    if (isLeadingPhoneNumberUri(uri)) {
        return false;
    }
    return true;
}

// Static (contact-only) gate for live-location sharing: a real 1:1 peer with a
// PGP key. The dynamic gates — an already-active share, or a bidirectional
// chat history — depend on app state and stay in the caller.
export function canShareLocationWith(contact) {
    if (!contact || !contact.uri) {
        return false;
    }
    const uri = contact.uri;
    if (isVideoConferenceUri(uri)) {
        return false;
    }
    if (isAnonymousUri(uri)) {
        return false;
    }
    if (isLeadingPhoneNumberUri(uri)) {
        return false;
    }
    if (!contactHasPublicKey(contact)) {
        return false;
    }
    return true;
}
