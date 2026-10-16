/*
 * addressbookOrigin.js
 *
 * Who last changed an addressbook entry, and when. The same rules as Blink
 * desktop's AddressbookOrigin.py; the spec is docs/addressbook/addressbook.md,
 * Chapter 26.
 *
 * Every contact and group this device writes carries, in its attributes bag:
 *
 *   modified_by      this device's id (this.deviceId)
 *   modified_agent   USER_AGENT, 'Blink Mobile 4.1.0 (Pixel 8 on android)'
 *   modified_at      UTC, ISO 8601 to the second, '2026-09-16T11:44:07Z'
 *   modified_reason  what made the write when it was not the user: 'repair',
 *                    'migrate', ... -- empty for an ordinary edit
 *   modified_hash    fingerprint of the content the stamp vouches for
 *
 * The hash is what makes a stamp trustworthy across clients that do not stamp.
 * The attributes bag is carried through verbatim (Chapter 16.4), so a client
 * that edits an entry without stamping leaves the previous writer's stamp on
 * content that writer never saved. Recomputing the fingerprint on arrival
 * tells the two apart.
 *
 * The fingerprint MUST be byte-identical to Blink's: same fields, same JSON
 * serialisation, same digest. test_addressbook_origin.cjs pins it against
 * vectors computed by the Python implementation.
 *
 * The same file is used verbatim by sylk-desktop (src/app/addressbookOrigin.js).
 * Change it here and copy it there.
 *
 * Pure: no RN imports, no storage, no clock of its own. app.js wraps the
 * addressbook writes and owns the snapshot in AsyncStorage.
 */

'use strict';

const SHA1 = require('crypto-js/sha1');

const STAMP_KEYS = ['modified_by', 'modified_agent', 'modified_at', 'modified_reason', 'modified_hash'];
const SNAPSHOT_VERSION = 1;

function _text(value) {
    return value === null || value === undefined ? '' : String(value);
}

// XCAP attribute text and JSON booleans both reach us; 'false' is not true.
function _bool(value) {
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return v === 'true' || v === '1';
    }
    return !!value;
}

function _event(handling) {
    handling = handling || {};
    // Missing is what the server stores: policy 'default', not subscribed.
    const policy = handling.policy === undefined || handling.policy === null ? 'default' : handling.policy;
    return [_text(policy), _bool(handling.subscribe)];
}

// Code-point order on BMP text, which is what Python's sort gives.
function _cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Keys are written in sorted order by construction: JSON.stringify keeps
// insertion order, Python's json.dumps(sort_keys=True) sorts. Separators
// are the compact ',' and ':' on both sides, non-ASCII is left unescaped.
function _digest(json) {
    return SHA1(json).toString().slice(0, 16);
}

function contactFingerprint(contact) {
    contact = contact || {};
    const uris = (Array.isArray(contact.uris) ? contact.uris : [])
        .map(u => (u && typeof u === 'object')
            ? [_text(u.uri).trim(), _text(u.type)]
            : [_text(u).trim(), ''])
        .sort((a, b) => _cmp(a[0], b[0]) || _cmp(a[1], b[1]));
    return _digest(JSON.stringify({
        dialog: _event(contact.dialog),
        name: _text(contact.name),
        presence: _event(contact.presence),
        uris
    }));
}

function _memberIds(group) {
    const contacts = group && Array.isArray(group.contacts) ? group.contacts : [];
    return contacts
        .map(m => (m && typeof m === 'object') ? _text(m.id) : _text(m))
        .filter(Boolean);
}

function groupFingerprint(group) {
    return _digest(JSON.stringify({
        contacts: _memberIds(group).sort(_cmp),
        name: _text(group && group.name)
    }));
}

function fingerprintFor(kind) {
    return kind === 'group' ? groupFingerprint : contactFingerprint;
}

function utcTimestamp(ms) {
    return new Date(ms === undefined ? Date.now() : ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function _stampOf(obj) {
    const attributes = (obj && obj.attributes) || {};
    const out = {};
    for (const key of STAMP_KEYS) out[key] = _text(attributes[key]);
    return out;
}

/*
 * The payload that should actually go to the server for a write.
 *
 *   kind      'contact' | 'group'
 *   payload   what the caller built
 *   previous  the server's current copy of the same id, or null
 *
 * A write that changes what the document says about the entry is stamped
 * with this device. A write that does not -- a re-put of the same content, an
 * attributes-only change -- carries the previous stamp through, so a stale
 * local copy of the bag can never roll a stamp back.
 *
 * Returns a copy; the caller's object is not touched.
 */
function stampPayload(kind, payload, previous, { deviceId, agent, reason, now } = {}) {
    if (!payload || typeof payload !== 'object') return payload;
    const fingerprint = fingerprintFor(kind);
    const current = fingerprint(payload);
    const attributes = Object.assign({}, payload.attributes || {});
    const changed = !previous || fingerprint(previous) !== current;
    if (changed) {
        // In STAMP_KEYS order: by, agent, at, reason, hash.
        const values = [_text(deviceId), _text(agent), utcTimestamp(now), _text(reason), current];
        STAMP_KEYS.forEach((key, i) => { attributes[key] = values[i]; });
    } else {
        const stamp = _stampOf(previous);
        for (const key of STAMP_KEYS) {
            if (stamp[key]) attributes[key] = stamp[key];
            else delete attributes[key];
        }
    }
    return Object.assign({}, payload, { attributes });
}

function describeOrigin(obj, fingerprint, thisDevice) {
    const stamp = _stampOf(obj);
    if (!stamp.modified_by && !stamp.modified_hash) {
        return 'by a client that does not stamp (never stamped)';
    }
    const who = (thisDevice && stamp.modified_by === String(thisDevice))
        ? 'this device'
        : (stamp.modified_agent || '?') + ' device ' + (stamp.modified_by || '?');
    const when = stamp.modified_at || '?';
    const why = stamp.modified_reason ? ' (' + stamp.modified_reason + ')' : '';
    if (stamp.modified_hash === fingerprint(obj)) {
        return 'by ' + who + ' at ' + when + why;
    }
    return 'by a client that does not stamp, after the last stamp: ' + who + ' at ' + when + why;
}

/*
 * Compare a fetched addressbook ({contacts, groups}) against the snapshot of
 * the last one. Returns {changes, snapshot}; changes is null when there was
 * no snapshot -- the first document ever seen is a baseline, not additions.
 */
function diffDocument(addressbook, previous, thisDevice) {
    const snapshot = { v: SNAPSHOT_VERSION, contacts: {}, groups: {} };
    const usable = previous && previous.v === SNAPSHOT_VERSION ? previous : null;
    const changes = usable ? [] : null;
    const kinds = [['contact', 'contacts', contactFingerprint], ['group', 'groups', groupFingerprint]];
    for (const [kind, collection, fingerprint] of kinds) {
        const before = (usable && usable[collection]) || {};
        const seen = new Set();
        for (const item of ((addressbook && addressbook[collection]) || [])) {
            if (!item || item.id === undefined || item.id === null) continue;
            const id = _text(item.id);
            const digest = fingerprint(item);
            const name = _text(item.name);
            seen.add(id);
            snapshot[collection][id] = [digest, name];
            if (!changes) continue;
            const known = before[id];
            if (known && known[0] === digest) continue;
            changes.push({ op: known ? 'update' : 'add', kind, id, name,
                           was: known ? known[1] : null,
                           origin: describeOrigin(item, fingerprint, thisDevice) });
        }
        if (changes) {
            for (const id of Object.keys(before)) {
                if (seen.has(id)) continue;
                changes.push({ op: 'remove', kind, id, name: before[id][1], was: null,
                               origin: 'by an unknown device (a removal carries no stamp)' });
            }
        }
    }
    return { changes, snapshot };
}

function formatChanges(changes, cap = 50) {
    const lines = (changes || []).slice(0, cap).map(ch => {
        const renamed = ch.was !== null && ch.was !== ch.name ? ' (was ' + JSON.stringify(ch.was) + ')' : '';
        return ch.op + ' ' + ch.kind + ' ' + ch.id + ' ' + JSON.stringify(ch.name) + renamed + ' -- ' + ch.origin;
    });
    if ((changes || []).length > cap) {
        lines.push('... ' + (changes.length - cap) + ' more not listed (cap ' + cap + ')');
    }
    return lines;
}

// Accepts the JSON text (AsyncStorage) or the object itself (localforage).
function parseSnapshot(value) {
    try {
        const data = typeof value === 'string' ? JSON.parse(value) : value;
        return data && typeof data === 'object' && data.v === SNAPSHOT_VERSION ? data : null;
    } catch (e) {
        return null;
    }
}

module.exports = {
    STAMP_KEYS,
    SNAPSHOT_VERSION,
    contactFingerprint,
    groupFingerprint,
    fingerprintFor,
    utcTimestamp,
    stampPayload,
    describeOrigin,
    diffDocument,
    formatChanges,
    parseSnapshot
};
