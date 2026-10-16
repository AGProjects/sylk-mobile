/*
 * messagesBulkDelete.js
 *
 * application/sylk-messages-bulk-delete — "erase everything that matches these
 * criteria, on every device of the account". Receive side only: another
 * client (Blink's Data manager) decides what goes; this device applies it.
 *
 * Spec: docs/messages/sylk-messages-bulk-delete.md
 *
 * Pure: no RN imports, no SQL execution. app.js runs the queries this module
 * builds and owns the refresh of the UI state.
 */

'use strict';

const CONTENT_TYPE = 'application/sylk-messages-bulk-delete';

// Categories a bulk delete may select by. `location` is deliberately absent:
// clients disagree on it, so location is always selected by content_type.
const CATEGORIES = new Set(['text', 'image', 'audio', 'video', 'other', 'call']);

const SQL_CHUNK = 500;   // stays under SQLite's 999 host-parameter limit

function _isoMs(v) {
    if (typeof v !== 'string' || !v) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

// Parse a body (string from the wire, or an already-parsed object from the
// journal) into a checked payload. Returns {payload} or {error}.
function parse(content) {
    let p = content;
    if (typeof p === 'string') {
        try { p = JSON.parse(p); } catch (e) { return {error: 'body is not JSON'}; }
    }
    if (!p || typeof p !== 'object') return {error: 'body is not an object'};
    const c = p.criteria;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return {error: 'no criteria object'};

    const hasCategory = c.category != null && c.category !== '';
    const hasType = c.content_type != null && c.content_type !== '';
    const hasContact = c.contact != null && c.contact !== '';
    // Devices share the criteria, never lists of message ids: each device
    // selects by the same criteria in its own history.
    if (c.ids != null) return {error: 'selection by message ids is not supported, only criteria'};

    // Type, contact and period are all required, so a mistake can only reach
    // one kind of message, with one contact, in one period.
    if (hasCategory && hasType) return {error: 'both category and content_type set'};
    if (!hasCategory && !hasType) return {error: 'missing scope: no category or content_type'};
    if (!hasContact) return {error: 'missing scope: no contact'};
    if (hasCategory && !CATEGORIES.has(String(c.category))) return {error: 'unknown category ' + c.category};
    if (c.action != null && c.action !== '' && !hasType) return {error: 'action without content_type'};

    const untilMs = _isoMs(c.until);
    if (untilMs == null) return {error: 'missing scope: no or bad until'};
    const fromMs = _isoMs(c.from);
    if (fromMs == null) return {error: 'missing scope: no or bad from'};

    return {
        payload: {
            id: p.bulk_delete_id || '(no id)',
            deviceId: p.device_id || null,
            files: p.files !== false,   // Blink: erased unless explicitly false
            cascade: p.cascade === true,
            criteria: {
                category: hasCategory ? String(c.category) : null,
                contentType: hasType ? String(c.content_type).toLowerCase() : null,
                action: (c.action != null && c.action !== '') ? String(c.action) : null,
                contact: hasContact ? String(c.contact) : null,
                fromMs,
                untilMs,
            },
        },
    };
}

const SELECT_COLUMNS = 'msg_id, content_type, category, related_action, related_msg_id,'
    + ' content, metadata, local_url, from_uri, to_uri, direction, timestamp, unix_timestamp';

// The primary selection. Rows with unix_timestamp = 0 are let through the
// time bounds here and checked in JS against `timestamp` (rowTimeMs).
// Rows already flagged deleted are included on purpose: they are erased too.
function buildSelect(account, criteria, contactUris) {
    let sql = 'SELECT ' + SELECT_COLUMNS + ' FROM messages WHERE account = ?';
    const params = [account];

    if (criteria.category) {
        sql += ' AND category = ?';
        params.push(criteria.category);
    } else if (criteria.contentType) {
        sql += ' AND lower(content_type) = ?';
        params.push(criteria.contentType);
    }

    if (criteria.contact) {
        const uris = (contactUris && contactUris.length) ? contactUris : [criteria.contact];
        const ph = uris.map(() => '?').join(', ');
        sql += ` AND (from_uri IN (${ph}) OR to_uri IN (${ph}))`;
        params.push(...uris, ...uris);
    }

    sql += ' AND (unix_timestamp IS NULL OR unix_timestamp = 0 OR (unix_timestamp >= ? AND unix_timestamp < ?))';
    params.push(Math.floor(criteria.fromMs / 1000), Math.floor(criteria.untilMs / 1000));

    return {sql, params};
}

function buildRelatedSelect(account, ids) {
    const ph = ids.map(() => '?').join(', ');
    return {
        sql: 'SELECT ' + SELECT_COLUMNS + ` FROM messages WHERE account = ? AND related_msg_id IN (${ph})`,
        params: [account, ...ids],
    };
}

function buildDelete(account, ids) {
    const ph = ids.map(() => '?').join(', ');
    return {
        sql: `DELETE FROM messages WHERE account = ? AND msg_id IN (${ph})`,
        params: [account, ...ids],
    };
}

// Message time of a row in ms. unix_timestamp is in seconds; rows written
// without it fall back to the stored `timestamp` (JSON-quoted ISO or plain).
function rowTimeMs(row) {
    const u = Number(row && row.unix_timestamp);
    if (u > 0) return u * 1000;
    const t = row && row.timestamp;
    if (t == null || t === '') return null;
    let s = t;
    if (typeof s === 'string' && s.charAt(0) === '"') {
        try { s = JSON.parse(s); } catch (e) {}
    }
    const ms = new Date(s).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function inPeriod(row, criteria) {
    const u = Number(row && row.unix_timestamp);
    if (u > 0) return true;   // already bounded by SQL
    const ms = rowTimeMs(row);
    if (ms == null) return false;
    if (ms >= criteria.untilMs || ms < criteria.fromMs) return false;
    return true;
}

const ENCRYPTED = 'encrypted';

// The row's action: related_action when set (clear even when the body is
// encrypted), else the `action` key of the plaintext JSON body. A body still
// in PGP ciphertext with no related_action has the action `encrypted`: it
// matches action "encrypted" and nothing else. Rows this device already
// decrypted have their plaintext in `content` and a readable action.
function rowAction(row) {
    if (row && row.related_action) return String(row.related_action);
    let body = row && row.content;
    if (body == null) return null;
    if (typeof body !== 'string') {
        try { body = String(body); } catch (e) { return null; }
    }
    if (!body) return null;
    if (body.startsWith('-----BEGIN PGP')) return ENCRYPTED;
    const first = body.trimStart().charAt(0);
    if (first !== '{') return null;
    try {
        const j = JSON.parse(body);
        return (j && typeof j.action === 'string') ? j.action : null;
    } catch (e) {
        return null;
    }
}

function matches(row, criteria) {
    return whyNot(row, criteria) === null;
}

// null when the row matches, else what excluded it: 'period' or 'action'.
function whyNot(row, criteria) {
    if (!inPeriod(row, criteria)) return 'period';
    if (criteria.action && rowAction(row) !== criteria.action) return 'action';
    return null;
}

// The other party of a row (the conversation it is filed under).
function rowPeer(row) {
    if (!row) return null;
    return row.direction === 'incoming' ? row.from_uri : row.to_uri;
}

// File-transfer metadata of a row, or null.
function fileTransferOf(row) {
    if (!row || !row.metadata) return null;
    let ft;
    try { ft = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; } catch (e) { return null; }
    if (ft && ft.sender && ft.receiver && (ft.transfer_id || ft.filename || ft.local_url || ft.url)) return ft;
    return null;
}

function chunks(arr, size = SQL_CHUNK) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function _day(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

// "application/sylk-message-metadata · location, florig@sylk.link, 2026-05-01 .. 2026-06-01"
function describe(criteria) {
    const parts = [];
    let what = criteria.category || criteria.contentType;
    if (what && criteria.action) what += ' · ' + criteria.action;
    if (what) parts.push(what);
    if (criteria.contact) parts.push(criteria.contact);
    parts.push(_day(criteria.fromMs) + ' .. ' + _day(criteria.untilMs));
    return parts.join(', ');
}

module.exports = {
    CONTENT_TYPE,
    ENCRYPTED,
    CATEGORIES,
    SQL_CHUNK,
    parse,
    buildSelect,
    buildRelatedSelect,
    buildDelete,
    rowTimeMs,
    rowAction,
    matches,
    whyNot,
    rowPeer,
    fileTransferOf,
    chunks,
    describe,
};
