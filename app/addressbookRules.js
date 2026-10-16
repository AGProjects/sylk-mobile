/*
 * addressbookRules.js
 *
 * The addressbook's naming rules -- how an address is spelled when it is
 * stored, matched and published, what counts as a real display name, which
 * group a kind maps onto -- in one file that every JavaScript client shares.
 *
 * Used verbatim by sylk-mobile (app/addressbookRules.js) and sylk-desktop
 * (src/app/addressbookRules.js). Change it here and copy it there. Blink
 * desktop implements the same rules in Python (util.py pstn_e164 /
 * canonical_pstn_uri, HistoryManager.py echoed_name_replacement).
 *
 * The spec is docs/addressbook/addressbook.md: R1-R6 in Chapter 3, display
 * names in Chapters 4 and 25.5, groups in Chapter 5b, the startup repairs in
 * Chapter 24, and why two clients must agree on one canon in Chapter 25.1.
 *
 * Pure: no React Native, no storage, no network, no clock. What depends on the
 * running account -- its domain, its conference bridge, its dial plan -- comes
 * in through the context given to create():
 *
 *   defaultDomain            'sylk.link'
 *   defaultConferenceDomain  'conference.sip2sip.info'
 *   pstnRules                { replacePlus, replaceLeadingZero, ... } or null
 *   onPstnCanon(from, to)    optional, told about each canonical rewrite
 *
 * The context is read at call time, field by field, so an object with getters
 * over live app state works and a value that is not known yet reads as unset.
 */

'use strict';

// ---- phone numbers, independent of the account ------------------------------

function stripTelScheme(uri) {
    if (typeof uri !== 'string') {
        return uri;
    }
    if (!/^\s*tel:/i.test(uri)) {
        return uri;
    }
    let value = uri.trim().replace(/^tel:(\/\/)?/i, '');
    const semi = value.indexOf(';');
    if (semi > -1) {
        value = value.substring(0, semi);
    }
    value = value.replace(/%2b/gi, '+');
    // Visual separators only — '+', digits and the dial codes '*'/'#' stay.
    value = value.replace(/[\s\-.()]/g, '');
    return value;
}

// Returns the match array (truthy) or null, as it always has: callers test it
// for truth, never for identity with true.
function isPhoneNumber(uri, conferenceDomain) {
    // A tel: URI is a phone number wearing a scheme. Unwrap it first so
    // every caller of this detector (the PSTN pre-flight gate, the 'tel'
    // auto-tag, normalizeUri below) agrees that tel:+31612345678 IS a
    // phone number.
    uri = stripTelScheme(uri);
    let username = uri;
    let domain = '';
    if (uri.indexOf('@') > -1) {
        const _parts = uri.split('@');
        username = _parts[0].trim();
        domain = (_parts[1] || '').trim().toLowerCase();
    }
    // Conference URIs are NEVER phone numbers, even when the room
    // name is all digits or starts with a leading 0. We can ONLY
    // know it's a conference if the caller tells us which domain
    // the account's conference bridge lives on — substrings like
    // 'conference.' aren't a reliable signal (e.g. a vanity domain
    // like conference.example.com is not necessarily a Sylk
    // conference bridge). When the caller passes the account's
    // configured `defaultConferenceDomain` here, we compare the
    // URI's domain to it (case-insensitively) and short-circuit
    // to false. Callers that don't have the domain handy just
    // omit it and we fall back to the legacy regex.
    if (conferenceDomain && domain && domain === String(conferenceDomain).toLowerCase()) {
        return false;
    }
    // Allow the human-friendly separators people type or paste inside a
    // number — spaces, dashes, underscores and parentheses — so forms
    // like '+1-313-1313', '+1313_1313' and '+1 313 1313' are all still
    // recognised as phone numbers (normalizeUri then strips them to the
    // canonical digits).
    return username.match(/^(\+|0)([\d\-\(\)_\s]+)$/);
}

function pstnWireUriToE164(uri, rules) {
    if (typeof uri !== 'string' || !uri) {
        return uri;
    }
    const atIdx = uri.indexOf('@');
    const localPart = atIdx > -1 ? uri.substring(0, atIdx) : uri;
    const domainPart = atIdx > -1 ? uri.substring(atIdx) : '';

    if (localPart.charAt(0) === '+') {
        return uri;
    }
    if (!/^\d+$/.test(localPart)) {
        return uri;
    }

    const configured = (rules && typeof rules.replacePlus === 'string')
        ? rules.replacePlus.trim()
        : '';
    const codes = [];
    if (configured) {
        codes.push(configured);
    }
    if (codes.indexOf('00') === -1) {
        codes.push('00');
    }

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (/^\d+$/.test(code)
                && localPart.length > code.length
                && localPart.indexOf(code) === 0) {
            return '+' + localPart.substring(code.length) + domainPart;
        }
    }
    return uri;
}

function stripTrunkZeroAfterCountryCode(uri, rules) {
    if (typeof uri !== 'string' || !rules) {
        return uri;
    }

    const replaceLeadingZero = typeof rules.replaceLeadingZero === 'string'
        ? rules.replaceLeadingZero.trim()
        : '';
    if (!replaceLeadingZero) {
        return uri;
    }

    const accessCode = (typeof rules.replacePlus === 'string' && rules.replacePlus)
        ? rules.replacePlus
        : '00';

    let countryCode = null;
    if (replaceLeadingZero.indexOf(accessCode) === 0) {
        countryCode = replaceLeadingZero.substring(accessCode.length);
    } else if (replaceLeadingZero.charAt(0) === '+') {
        countryCode = replaceLeadingZero.substring(1);
    } else if (replaceLeadingZero.indexOf('00') === 0) {
        countryCode = replaceLeadingZero.substring(2);
    }

    if (!countryCode || !/^\d{1,3}$/.test(countryCode)) {
        return uri;
    }

    if (countryCode === '39') {
        return uri;
    }

    const atIdx = uri.indexOf('@');
    const localPart = atIdx > -1 ? uri.substring(0, atIdx) : uri;
    const domainPart = atIdx > -1 ? uri.substring(atIdx) : '';

    // Both international spellings the app can be handed: the canonical
    // '+31…' it keeps in state / history, and the '0031…' wire form the
    // replacePlus rule produces (or that a web page wrote directly).
    const prefixes = ['+' + countryCode];
    if (prefixes.indexOf(accessCode + countryCode) === -1) {
        prefixes.push(accessCode + countryCode);
    }
    if (prefixes.indexOf('00' + countryCode) === -1) {
        prefixes.push('00' + countryCode);
    }

    for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i];
        const tail = localPart.substring(prefix.length + 1);
        if (localPart.indexOf(prefix + '0') === 0 && /^\d+$/.test(tail)) {
            return prefix + tail + domainPart;
        }
    }

    return uri;
}

// The "Replace 0 with" dial rule, forward direction: a national number with a
// SINGLE leading 0 gets that 0 replaced by the configured prefix, which is by
// construction <access code><country code> ('0612345678' -> '0031612345678').
// Mirrors Call.js, with Blink desktop's correction: never fire on a number
// that is ALREADY international, which on an account whose access code is not
// '00' ('011...') still starts with a single 0 and would otherwise be
// rewritten into nonsense.
function applyLeadingZeroRule(username, rules) {
    const rule = (rules && typeof rules.replaceLeadingZero === 'string')
        ? rules.replaceLeadingZero.trim() : '';
    if (!rule || !username) return username;
    if (!/^0\d+$/.test(username)) return username;      // digits, one leading 0
    if (username.charAt(1) === '0') return username;    // '00...' is already international
    const access = (rules && typeof rules.replacePlus === 'string' && rules.replacePlus.trim())
        ? rules.replacePlus.trim() : '00';
    if (access && access !== '0' && username.indexOf(access) === 0) return username;
    return rule + username.substring(1);
}

// ---- addresses, independent of the account ----------------------------------

function uriUsername(uri) {
    const u = (uri || '').trim().toLowerCase();
    const at = u.indexOf('@');
    return at > -1 ? u.substring(0, at) : u;
}

// R1: '@local' is another LAN client's Bonjour contact.
function isLocalDomain(uri) {
    return /@local$/i.test((uri || '').trim());
}

// R1: IP-literal domain = junk.
function isIpDomain(uri) {
    if (!uri) return false;
    const at = uri.lastIndexOf('@');
    if (at === -1) return false;
    let domain = uri.slice(at + 1).trim();
    if (domain.indexOf('[') > -1 && domain.indexOf(']') > -1) return true; // [IPv6]
    domain = domain.split(':')[0]; // strip :port (IPv4 only)
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain);
}

// All URIs a local contact owns (primary + extras), lowercased and deduped.
function localContactUris(c) {
    const out = [];
    const seen = new Set();
    [(c && c.uri) || '', ...((c && Array.isArray(c.uris)) ? c.uris : [])]
        .forEach(u => {
            const v = (u || '').trim().toLowerCase();
            if (v && !seen.has(v)) { seen.add(v); out.push(v); }
        });
    return out;
}

// ---- groups -----------------------------------------------------------------

// Per-contact flags that are never groups (Chapter 7, 24.5).
const NON_GROUP_TAGS = new Set(['bypassdnd', 'muted', 'noread', 'history', 'caregiver',
    'autoanswer', 'phone', 'email']);

// Locally-authoritative dynamic groups (from call state).
const DYNAMIC_LOCAL_GROUPS = new Set(['calls', 'recent']);

// Auto-derived categories, never server-owned unless the group carries a kind.
const AUTO_LOCAL_GROUPS = new Set(['messages', 'chat', 'calls', 'recent']);

// What a group IS (Chapter 5b). Lowercase machine words; Blink writes the same
// ones through BlinkGroupExtension.kind.
const GROUP_KINDS = { calls: 'calls', tel: 'tel', blocked: 'blocked', conference: 'conference',
    missed: 'missed', favorites: 'favorites' };

// The local tag for membership of a kinded group. NOTE the singular 'favorite'.
const TAG_FOR_KIND = { calls: 'calls', tel: 'tel', blocked: 'blocked', conference: 'conference',
    missed: 'missed', favorites: 'favorite' };

// The id a group of this kind is CREATED with (Chapter 5b.1).
const RESERVED_ID_FOR_KIND = { calls: '_calls', tel: '_tel', blocked: '_blocked',
    conference: '_conference', missed: '_missed', favorites: '_favorites' };

// Reserved ids -> reconcile key, both spellings of Favorites included.
const RESERVED_GROUP_KEYS = { _messages: 'messages', favorites: 'favorites',
    _favorites: 'favorites', _calls: 'calls', _tel: 'tel', _blocked: 'blocked',
    _conference: 'conference', _missed: 'missed' };

// Group names are case-insensitive; canonical form is Capitalized.
function capitalizeGroup(name) {
    const n = (name || '').trim();
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

// Reserved tag -> server group name. There is deliberately NO autoanswer entry:
// auto-answer is per-device and never synced (Chapter 6).
function tagToGroupName(tag) {
    const map = { favorite: 'Favorites', blocked: 'Blocked', tel: 'Tel', chat: 'Messages' };
    return map[(tag || '').toLowerCase()] || capitalizeGroup(tag);
}

// Reverse: the local tag stored for a given server group name.
function groupNameToTag(name) {
    const rev = { favorites: 'favorite', blocked: 'blocked', tel: 'tel' };
    const n = (name || '').trim();
    return rev[n.toLowerCase()] || n;
}

// A server group that must be purged, never cached/merged (auto-created 'contact',
// or a corrupted stringified-array tag such as '["chat"]').
function isPurgeGroup(name) {
    const n = (name || '').trim().toLowerCase();
    if (n === 'contact') return true;
    if (/^\[.*\]$/.test(n)) return true;
    return false;
}

function isPurgeTag(tag) {
    return isPurgeGroup(tag) || isPurgeGroup(tagToGroupName(tag));
}

// The kind currently on a server group, tolerant about shape: XCAP attribute
// values are text, and an absent attribute is not an error.
function groupKind(g) {
    try {
        const attributes = (g && g.attributes) || {};
        return String(attributes.kind == null ? '' : attributes.kind).trim().toLowerCase();
    } catch (e) {
        return '';
    }
}

// The reconcile key for a server group: kind -> reserved id -> canonical name.
function groupKey(g) {
    const kind = groupKind(g);
    if (kind && GROUP_KINDS[kind]) return kind;
    const reserved = RESERVED_GROUP_KEYS[(g && g.id) || ''];
    if (reserved) return reserved;
    return capitalizeGroup((g && g.name) || '').toLowerCase();
}

// The local tag a server group maps to: its kind's tag, its reserved id's tag,
// its name-derived tag otherwise.
function tagForGroup(g) {
    const kind = groupKind(g);
    if (kind && TAG_FOR_KIND[kind]) return TAG_FOR_KIND[kind];
    const reserved = RESERVED_GROUP_KEYS[(g && g.id) || ''];
    if (reserved) return groupNameToTag(capitalizeGroup(reserved));
    return groupNameToTag(capitalizeGroup((g && g.name) || ''));
}

// A kind means another client owns the group: never this device's to delete.
function groupIsShared(g) {
    return !!groupKind(g);
}

function isDeviceLocalGroup(key, g) {
    return AUTO_LOCAL_GROUPS.has(key) && !groupKind(g);
}

function isDeviceLocalName(key) {
    return AUTO_LOCAL_GROUPS.has(key) && !GROUP_KINDS[key];
}

// Server-style id: 'id' followed by digits (no hyphens - XCAP node addressing
// breaks on them).
function generateServerId() {
    return 'id' + Date.now().toString() + Math.floor(Math.random() * 1e12).toString();
}

// ---- rules that depend on the account ---------------------------------------

function create(context) {
    const ctx = context || {};
    const confDomain = () => ctx.defaultConferenceDomain;

    // Every equivalent URI shape of a phone number EXCEPT the input itself:
    // '+CC' <-> '00CC', crossed with bare / @defaultDomain / the original
    // domain. SIP usernames are left alone.
    function phoneNumberVariants(uriString) {
        if (!uriString) return [];
        const atIdx = uriString.indexOf('@');
        const localPart = atIdx > -1 ? uriString.substring(0, atIdx) : uriString;
        const originalDomain = atIdx > -1 ? uriString.substring(atIdx) : null; // includes the '@'
        if (!isPhoneNumber(localPart)) {
            return [];
        }
        const locals = new Set();
        locals.add(localPart);
        if (localPart.startsWith('+')) {
            locals.add('00' + localPart.substring(1));
        } else if (localPart.startsWith('00')) {
            locals.add('+' + localPart.substring(2));
        }
        const variants = new Set();
        const domains = new Set();
        domains.add(''); // bare
        if (ctx.defaultDomain) {
            domains.add('@' + ctx.defaultDomain);
        }
        if (originalDomain) {
            domains.add(originalDomain);
        }
        for (const lp of locals) {
            for (const dom of domains) {
                variants.add(lp + dom);
            }
        }
        variants.delete(uriString);
        return Array.from(variants);
    }

    // Canonical +E.164 for a PSTN URI, the URI unchanged otherwise (Chapter
    // 24.3). The same pipeline, in the same order, as Blink's
    // canonical_pstn_uri / pstn_e164:
    //
    //     bare local part -> trunk-zero repair -> "Replace 0 with" -> wire->E.164
    //
    // Falls back to the bare local part when the rules are not configured or
    // the result is not a plausible number; the 8-digit floor is Blink's.
    function canonicalPstn(uri) {
        const u = (uri || '').trim().toLowerCase();
        if (!u) return u;
        try {
            if (!isPhoneNumber(u, confDomain())) return u;
        } catch (e) { return u; }
        const at = u.indexOf('@');
        // Visual separators first, exactly as Blink desktop does
        // (strip_addressbook_special_characters) before any rewrite.
        const bare = (at > -1 ? u.substring(0, at) : u).replace(/[\s\-()_.]/g, '');
        try {
            const rules = ctx.pstnRules || {};
            let n = stripTrunkZeroAfterCountryCode(bare, rules) || bare;
            n = applyLeadingZeroRule(n, rules);
            const e164 = pstnWireUriToE164(n, rules) || n;
            if (/^\+\d{8,}$/.test(e164)) {
                if (e164 !== bare && typeof ctx.onPstnCanon === 'function') ctx.onPstnCanon(bare, e164);
                return e164;
            }
        } catch (e) { /* fall through to the bare form */ }
        return bare;
    }

    // The SERVER boundary: canonical PSTN form (lowercased and trimmed for
    // everything else). Local rows keep the spelling they were created with;
    // only the identity matched and published across clients is canonicalised.
    function normServerUri(uri) {
        return canonicalPstn(uri);
    }

    function localToServerUri(uri) {
        return canonicalPstn(uri);
    }

    // R4: PSTN numbers (user part starts + or 0) are stored bare, no domain; the
    // domain is appended only on the wire. Everything else lowercased/trimmed.
    function normalizeUri(uri) {
        const u = (uri || '').trim().toLowerCase();
        if (!u) return u;
        if (isPhoneNumber(u, confDomain())) {
            const at = u.indexOf('@');
            return at > -1 ? u.substring(0, at) : u;
        }
        return u;
    }

    function isConferenceUri(uri) {
        const u = (uri || '').trim().toLowerCase();
        const at = u.indexOf('@');
        if (at === -1) return false;
        const dom = u.substring(at + 1);
        const cd = String(confDomain() || '').toLowerCase();
        return (cd && dom === cd)
            || dom.startsWith('conference.');
    }

    // R5: conference URI whose username starts with '0' is an anomaly -> purge.
    function isConferenceAnomaly(uri) {
        const u = (uri || '').trim().toLowerCase();
        const at = u.indexOf('@');
        if (at === -1) return false;
        const user = u.substring(0, at);
        const domain = u.substring(at + 1);
        const configured = String(confDomain() || '').toLowerCase();
        const isConfDomain = (configured && domain === configured)
            || domain.startsWith('conference.');
        return isConfDomain && user.startsWith('0');
    }

    // R3: a name is a "URI echo" (not a real display name) when empty, or equals
    // a URI / a URI minus '@' / a URI's username, in any '+'/'00' spelling of a
    // number. `uri` may be a string or an array; an echo of ANY owned URI counts.
    function isUriEcho(name, uri) {
        const n = (name || '').trim().toLowerCase();
        if (n === '') return true;
        const list = Array.isArray(uri) ? uri : [uri];
        for (const raw of list) {
            const u = (raw || '').trim().toLowerCase();
            if (!u) continue;
            if (n === u || n === u.replace('@', '') || n === uriUsername(u)) return true;
            for (const v of (phoneNumberVariants(u) || [])) {
                const _v = String(v).trim().toLowerCase();
                if (n === _v || n === uriUsername(_v)) return true;
            }
        }
        return false;
    }

    // The same question for one stored name against one address, where an
    // address that is not known makes nothing an echo but the empty name.
    function nameIsEcho(name, uri) {
        const _name = (name || '').trim().toLowerCase();
        if (!_name) return true;
        const _uri0 = String(uri || '').trim().toLowerCase();
        if (!_uri0) return false;
        for (const _uri of [_uri0]) {
            if (_name === _uri) return true;
            if (_name === _uri.replace('@', '')) return true;
            if (_name === _uri.split('@')[0]) return true;
            for (const v of (phoneNumberVariants(_uri) || [])) {
                const _v = String(v).toLowerCase();
                if (_name === _v || _name === _v.split('@')[0]) return true;
            }
        }
        return false;
    }

    // R3: display name to store - server real name wins, else local real name,
    // else empty (Chapter 4).
    function winningDisplayName(localName, serverName, uri) {
        if (!isUriEcho(serverName, uri)) return serverName;
        if (!isUriEcho(localName, uri)) return localName;
        return '';
    }

    // A conference room's display name is the room number (URI username) or a
    // real name - never a URI echo. Non-conference URIs pass through.
    function conferenceName(name, uri) {
        if (!isConferenceUri(uri)) return name;
        if (!name || isUriEcho(name, uri)) return uriUsername(uri) || '';
        return name;
    }

    // Best default URI: prefer local-domain non-number, then any SIP non-number,
    // then a phone number, else the first URI (Chapter 5).
    function bestUri(uris) {
        const arr = (uris || []).filter(Boolean);
        if (arr.length === 0) return null;
        const localDom = String(ctx.defaultDomain || '').toLowerCase();
        const isTel = (u) => !!isPhoneNumber(u, confDomain());
        const domainOf = (u) => { const at = u.indexOf('@'); return at > -1 ? u.substring(at + 1).toLowerCase() : ''; };

        const local = localDom && arr.find(u => !isTel(u) && domainOf(u) === localDom);
        if (local) return local;
        const sip = arr.find(u => u.indexOf('@') > -1 && !isTel(u));
        if (sip) return sip;
        const tel = arr.find(u => isTel(u));
        if (tel) return tel;
        return arr[0];
    }

    // The server's default URI, else the uris[] entry flagged default, else the
    // best of uris[].
    //
    // The gateway's field is defaultUri (webrtcgateway models/xcap.py Contact):
    // it accepts default_uri on the way in, renames it, and only ever sends
    // defaultUri -- filled with uris[0] when the document names no default.
    // Reading default_uri alone never saw it, so the flag or bestUri decided
    // instead of the server. Both spellings are read, defaultUri first.
    function chosenDefaultUri(s) {
        const serverDefault = s && (s.defaultUri || s.default_uri);
        if (serverDefault && serverDefault.uri) return serverDefault.uri;
        const list = (Array.isArray(s && s.uris) ? s.uris : []).filter(u => u && u.uri);
        if (list.length === 0) return null;
        const flagged = list.find(u => u.default);
        if (flagged) return flagged.uri;
        return bestUri(list.map(u => u.uri));
    }

    // Unique, canonical list of every URI on a server contact (default + uris[]).
    function serverUris(s) {
        const list = Array.isArray(s && s.uris) ? s.uris : [];
        const all = [];
        const def = chosenDefaultUri(s);
        if (def) all.push(def);
        list.forEach(u => { if (u && u.uri) all.push(u.uri); });
        return [...new Set(all.map(u => normServerUri(u)).filter(Boolean))];
    }

    // The URI type written to the server (Chapter 19).
    function uriType(uri) {
        return isPhoneNumber(uri, confDomain()) ? 'tel' : 'sip';
    }

    // Whether a contact legitimately belongs to a tag's group: 'tel' needs a
    // real phone number; 'calls' excludes conference contacts.
    function contactQualifiesForTag(c, tag) {
        const t = (tag || '').toLowerCase();
        const uri = (c && c.uri) || '';
        if (t === 'tel') return !!isPhoneNumber(uri, confDomain());
        if (t === 'calls') return !isConferenceUri(uri);
        return true;
    }

    return {
        phoneNumberVariants,
        canonicalPstn,
        normServerUri,
        localToServerUri,
        normalizeUri,
        isConferenceUri,
        isConferenceAnomaly,
        isUriEcho,
        nameIsEcho,
        winningDisplayName,
        conferenceName,
        bestUri,
        chosenDefaultUri,
        serverUris,
        uriType,
        contactQualifiesForTag
    };
}

module.exports = {
    create,
    // phone numbers
    stripTelScheme,
    isPhoneNumber,
    pstnWireUriToE164,
    stripTrunkZeroAfterCountryCode,
    applyLeadingZeroRule,
    // addresses
    uriUsername,
    isLocalDomain,
    isIpDomain,
    localContactUris,
    // groups
    NON_GROUP_TAGS,
    DYNAMIC_LOCAL_GROUPS,
    AUTO_LOCAL_GROUPS,
    GROUP_KINDS,
    TAG_FOR_KIND,
    RESERVED_ID_FOR_KIND,
    RESERVED_GROUP_KEYS,
    capitalizeGroup,
    tagToGroupName,
    groupNameToTag,
    isPurgeGroup,
    isPurgeTag,
    groupKind,
    groupKey,
    tagForGroup,
    groupIsShared,
    isDeviceLocalGroup,
    isDeviceLocalName,
    generateServerId
};
