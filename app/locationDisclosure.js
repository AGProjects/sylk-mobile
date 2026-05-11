// app/locationDisclosure.js
//
// Per-account persistence for the Android Google-Play "before-the-fact
// in-app location disclosure" acknowledgement. The flag used to live
// under a single device-wide AsyncStorage key
//   locationDisclosureAcknowledged.v2
// which meant a second SIP identity signing in on the same physical
// device silently inherited the first account's consent. We now scope
// the key to the SIP account so each identity tracks its own decision:
//   locationDisclosureAcknowledged.v2.<accountId>
//
// Read sites (NavigationBar mount, NavigationBar share-flow gate,
// NavigationBar viewer, app.js meeting-request modal, app.js
// location-request modal) all go through readAcknowledged() so the
// legacy global key is migrated transparently on first read after
// upgrade. Write sites (viewer onContinue / onOptOut, share-flow
// onContinue) go through setAcknowledged() / clearAcknowledged().

import storage from './storage';

// Kept exactly equal to the pre-scoping key so a one-shot migration
// can detect a previously-accepted device.
const LEGACY_GLOBAL_KEY = 'locationDisclosureAcknowledged.v2';

function _key(accountId) {
    if (accountId && typeof accountId === 'string' && accountId.length > 0) {
        return `${LEGACY_GLOBAL_KEY}.${accountId}`;
    }
    return null;
}

// Read the per-account flag. Returns false when no accountId is in
// scope yet (the modal-gate code is expected to fall back to the
// "show disclosure" branch in that case rather than incorrectly
// allowing a share). On first read for a given account we also check
// the legacy global key — if that's still true on this device, copy
// the consent into the per-account key for the CURRENT account and
// remove the global one. Subsequent accounts on the same device will
// then have to acknowledge for themselves, which is the whole point
// of the scoping change.
export async function readAcknowledged(accountId) {
    const k = _key(accountId);
    if (!k) return false;
    try {
        const v = await storage.get(k);
        if (v === true) return true;
        const legacy = await storage.get(LEGACY_GLOBAL_KEY);
        if (legacy === true) {
            try {
                await storage.set(k, true);
                await storage.remove(LEGACY_GLOBAL_KEY);
            } catch (e) {
                // Migration write failure is non-fatal — we still
                // return true here so the user isn't asked to
                // re-accept just because the migration write hit a
                // transient AsyncStorage error. The next read will
                // try the migration again.
            }
            return true;
        }
    } catch (e) {
        // Read failure → caller treats as not-yet-acknowledged. Better
        // to double-disclose than to silently skip the requirement.
    }
    return false;
}

export async function setAcknowledged(accountId) {
    const k = _key(accountId);
    if (!k) return;
    try { await storage.set(k, true); }
    catch (e) { /* persistence failure is non-fatal — the modal will be re-shown next time */ }
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
