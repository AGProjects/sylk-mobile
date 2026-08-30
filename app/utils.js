// react-native-uuid (same module app.js uses) instead of the legacy
// `uuid/v4` deep import. The deep import ran through util.deprecate
// (an ERROR in metro on first call) and its RNG throws
// "crypto.getRandomValues() not supported" when the getRandomValues
// polyfill (only imported by CallZrtp) isn't loaded before first use —
// which silently killed the resend chunk loop in sendMessage: the old
// bubble was already deleted and no chunks ever went out, so the
// message appeared to vanish.
import rnUuid from 'react-native-uuid';
import SillyNames from './SillyNames';
import MaterialColors from './MaterialColors';
import { Clipboard, Dimensions } from 'react-native';
import Contacts from 'react-native-contacts';
import xss from 'xss';
import {decode as atob, encode as btoa} from 'base-64';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { generateColor } from './MaterialColors';
import CryptoJS from 'crypto-js';
import ReactNativeBlobUtil from 'react-native-blob-util';
import path from 'path-browserify';


// Per-account log file. The active accountId is set via
// setLogAccount() whenever the SIP identity changes (autologin
// success, sign-in success, account switch, sign-out). All log
// reads/writes resolve the current path through getLogfilePath()
// which derives a filename like:
//   logs.alice@sylk.link.txt
// on a per-account basis. When no account is in scope (very early
// boot, signed-out state) we fall back to a generic 'logs.txt' so
// boot/signout diagnostics still go somewhere.
//
// The accountId is sanitised to keep the filename POSIX-safe: SIP
// URIs already use only [a-zA-Z0-9._@+-] in practice, but we still
// strip path separators and control characters defensively. The
// '@' character is kept verbatim — it's legal in filenames on
// every filesystem we care about.
let _currentLogAccount = null;

function _sanitiseAccountForFilename(accountId) {
    if (!accountId || typeof accountId !== 'string') return null;
    // Replace anything outside the safe set with an underscore. Keeps
    // '@' (lots of SIP URIs) and '.' (TLDs) intact.
    return accountId.replace(/[^A-Za-z0-9._@+-]/g, '_');
}

function setLogAccount(accountId) {
    _currentLogAccount = _sanitiseAccountForFilename(accountId);
}

function getLogfilePath() {
    if (_currentLogAccount) {
        return RNFS.DocumentDirectoryPath + '/logs.' + _currentLogAccount + '.txt';
    }
    return RNFS.DocumentDirectoryPath + '/logs.txt';
}

// --- Contact-deletion audit -------------------------------------------------
//
// The main log file is capped at MAX_LOG_LINES (5000) and trimmed every ~40
// heartbeats, which on an active account is roughly four days of history. That
// cost us the 2026-08-05 incident: 68 contacts were swept into the graveyard in
// 34 seconds and by the time the user noticed (twelve days later) the lines
// that would have named the responsible code path had long rolled off. All we
// could do was reconstruct the event from the tombstone rows themselves.
//
// So destructive contact operations get their OWN file, which the trimmer never
// touches:
//
//   logs.<account>.deletions.txt
//
// It is append-only, one line per event, and rare by nature — a normal user
// produces a handful of lines a year. showLogs() prepends its contents to the
// log body, so it travels with every "Send to support" upload and shows up in
// the in-app viewer. deleteAccount() unlinks it alongside the main log so the
// history dies with the identity it belonged to.
//
// The cap below only exists so a pathological delete loop can't grow the file
// without bound. It keeps the OLDEST entries (the opposite of the main log)
// because the first sweep is the one that explains the loss; later ones are
// usually its echo. When it trips, a marker line records that fact.
const MAX_AUDIT_LINES = 4000;

function getDeletionAuditPath() {
    if (_currentLogAccount) {
        return RNFS.DocumentDirectoryPath + '/logs.' + _currentLogAccount + '.deletions.txt';
    }
    return RNFS.DocumentDirectoryPath + '/logs.deletions.txt';
}

// Append one audit line. Mirrors it into the normal log as well (via
// timestampedLog) so a fresh log still reads chronologically — the audit file
// is the copy that OUTLIVES the trim, not the only copy.
//   text  — already-formatted event text, no newlines
//   mirror — set false to write only to the audit file (avoids double lines
//            when the caller has already logged its own richer trace)
function auditContactDeletion(text, mirror = true) {
    const flat = String(text).replace(/\r\n|\r|\n/g, ' \\n ').replace(/\s+$/, '');
    const line = new Date().toISOString() + ' ' + flat;
    if (mirror) {
        timestampedLog('[trash] [audit] ' + flat);
    } else {
        console.log('[APPLOG] [trash] [audit] ' + flat);
    }
    RNFS.appendFile(getDeletionAuditPath(), line + '\r\n', 'utf8')
        .then(() => _trimDeletionAudit())
        .catch((err) => {
            console.log('[trash] [audit] append failed:', err && err.message);
        });
}

// Bounded-growth guard for the audit file. Unlike trimLogs() this keeps the
// HEAD of the file — see the rationale above.
let _auditTrimInFlight = false;
function _trimDeletionAudit() {
    if (_auditTrimInFlight) return;
    _auditTrimInFlight = true;
    const p = getDeletionAuditPath();
    RNFS.readFile(p, 'utf8')
        .then((content) => {
            const lines = content.split('\n');
            if (lines.length <= MAX_AUDIT_LINES + 50) return null;
            const kept = lines.slice(0, MAX_AUDIT_LINES).join('\n');
            const marker = new Date().toISOString()
                + ' AUDIT TRUNCATED — file reached ' + lines.length
                + ' lines; newest entries beyond ' + MAX_AUDIT_LINES + ' dropped';
            return RNFS.writeFile(p, kept + '\r\n' + marker + '\r\n', 'utf8');
        })
        .catch((err) => {
            // ENOENT simply means nothing has ever been deleted on this account.
            console.log('[trash] [audit] trim skipped:', err && err.message);
        })
        .finally(() => { _auditTrimInFlight = false; });
}

// Read the audit file back for the log viewer / support upload. Resolves to ''
// when the account has never deleted anything.
function readDeletionAudit() {
    return RNFS.readFile(getDeletionAuditPath(), 'utf8')
        .then((content) => content || '')
        .catch(() => '');
}

let HUGE_FILE_SIZE = 15 * 1000 * 1000;
let ENCRYPTABLE_FILE_SIZE = 20 * 1000 * 1000;

let polycrc = require('polycrc');

/**
 * Get the expected partial download file path for a RNBackgroundDownloader task.
 * @param {string} taskId - The id used in RNBackgroundDownloader.download()
 * @returns {string} - Path to the temporary/partial file
 */
function getPartialDownloadPath(taskId) {
    if (Platform.OS === 'android') {
        // Android: partial files are in cache directory with taskId as filename
        return `${RNFS.CachesDirectoryPath}/${taskId}.download`;
    } else if (Platform.OS === 'ios') {
        // iOS: partial files are in the temporary directory with taskId as filename
        return `${RNFS.TemporaryDirectoryPath}${taskId}.download`;
    } else {
        throw new Error('Unsupported platform');
    }
}

function log2file(text) {
    // Log to console synchronously FIRST so timestampedLog output interleaves
    // in chronological order with plain console.log calls from the same JS
    // frame. The file-append goes through the native bridge asynchronously,
    // and previously we only console.logged after its promise resolved —
    // which is why Metro showed `Registration state changed:` and similar
    // messages out of order relative to surrounding console.log lines.
    //
    // The `[APPLOG]` tag is added ONLY to the console line so devs can
    // grep Metro output (and metro.log via logs.sh) for everything that
    // ended up in the on-device log file. The file itself, the in-app
    // Show Logs viewer, the clipboard copy, and the support-email
    // attachment all see the clean, untagged text — `[APPLOG]` is a
    // dev-tooling marker, not user-facing content.
    //
    // ONE-LINE INVARIANT: every entry written to the on-disk log file
    // must occupy exactly one '\n'-delimited line. LogsModal reads the
    // file with .split('\n') and matches the [tag] pill regex per
    // line — any embedded newline in `text` would split a single
    // logical entry into multiple "lines", and the fragments without
    // a leading [tag] would pile up in the "untagged" pill bucket.
    //
    // Sources of accidental newlines in `text`:
    //   - JSON.stringify(obj, null, 2) — the pretty-print indent
    //   - Error stack traces (.stack contains '\n')
    //   - Multi-line template literals
    //   - Native log lines that for some reason carried '\n'
    //
    // Replace every CR / LF / CRLF with the literal two-char escape
    // ' \n ' so the boundary is still visible in the viewer and
    // grep-friendly, but doesn't break the per-line parser. Trim the
    // trailing run so we don't end up with " \n \r\n" tail noise.
    const flat = String(text).replace(/\r\n|\r|\n/g, ' \\n ').replace(/\s+$/, '');
    console.log('[APPLOG] ' + flat);

    RNFS.appendFile(getLogfilePath(), flat + '\r\n', 'utf8')
      .catch((err) => {
        console.log(err.message);
      });
}

function isAnonymous(uri) {
    if (!uri || typeof uri !== 'string') {
        return false;
    }

    // Match every flavour of unidentified caller:
    //   - <random>@guest.<host>        Sylk guest callers
    //   - anything@anonymous.<host>    canonical anonymous@anonymous.invalid
    //                                  and any @anonymous domain
    //   - anonymous@<anything>         the "anonymous" local part on any host
    //   - <user>@192.168.* / @10.*     direct LAN-IP calls with no identity
    if (uri.indexOf('@guest.') > -1
            || uri.indexOf('@anonymous') > -1
            || uri.indexOf('anonymous@') > -1) {
        return true;
    }

    if (uri.indexOf('@192.168.') > -1) {
        return true;
    }

    if (uri.indexOf('@10.') > -1) {
        return true;
    }

    return false;
}

// Collapse every flavour of unidentified guest/anonymous caller URI into a
// single canonical contact, so saved chat and call history from anonymous
// peers don't fan out into many throwaway rows. Matches:
//   - anything@guest.<host>        (Sylk guest callers)
//   - anything@anonymous.<host>    (also catches the malformed double-@
//                                   form "x@@anonymous...", since "@anonymous."
//                                   is still a substring)
// and returns "anonymous@anonymous.invalid". The match is case-insensitive.
// Any other URI is returned unchanged. Safe to call repeatedly (idempotent):
// the canonical value itself contains "@anonymous." and maps back to itself.
function normalizeAnonymousUri(uri) {
    if (!uri || typeof uri !== 'string') {
        return uri;
    }
    const lower = uri.toLowerCase();
    if (lower.indexOf('@guest.') > -1 || lower.indexOf('@anonymous.') > -1) {
        return 'anonymous@anonymous.invalid';
    }
    return uri;
}


function appendLeadingZeroes(n){
    if (n <= 9) {
        return "0" + n;
     }
    return n;
}

function timestampedLog() {
  const current_datetime = new Date();
  const formatted_date =
    current_datetime.getFullYear() +
    '-' +
    appendLeadingZeroes(current_datetime.getMonth() + 1) +
    '-' +
    appendLeadingZeroes(current_datetime.getDate()) +
    ' ' +
    appendLeadingZeroes(current_datetime.getHours()) +
    ':' +
    appendLeadingZeroes(current_datetime.getMinutes()) +
    ':' +
    appendLeadingZeroes(current_datetime.getSeconds());

  // The `[APPLOG]` tag for grep-from-Metro lives in `log2file`'s
  // console.log only — see the comment there. The file/viewer payload
  // we build here is just `<timestamp> <message>` so it's
  // human-readable in the in-app Show Logs viewer and in the support
  // email attachment.
  let message = formatted_date;

  for (let i = 0; i < arguments.length; i++) {
    let arg = arguments[i];
    let txt;

    if (typeof arg === 'object') {
      try {
        // Compact JSON — NOT pretty-printed. The 2-space indent
        // version injected '\n' inside the message body, which
        // log2file's flatten now handles, but inflated the on-disk
        // log size for no reader benefit (the in-app viewer is a
        // single-line-per-entry view, indenting just gets squashed
        // back into ' \n ' literals). Compact stays one line and
        // stays readable.
        txt = JSON.stringify(arg);
      } catch (e) {
        txt = '[Unserializable object]';
      }
    } else if (arg instanceof Error) {
      // Error objects don't survive JSON.stringify cleanly (most
      // properties are non-enumerable). Hand-build a single-line
      // representation; log2file will flatten any '\n' in .stack.
      txt = (arg.name || 'Error') + ': ' + (arg.message || String(arg))
            + (arg.stack ? ' | ' + arg.stack : '');
    } else {
      txt = String(arg);
    }

    message += ' ' + txt;
  }

  // Auto-tag any line whose body mentions the word "call" (or
  // calls/called/calling) with a [call] prefix so the in-app
  // log viewer's pill filter has a single canonical tag for the
  // call subsystem. Doing this once here is cheaper and safer
  // than editing the ~50 individual timestampedLog call sites
  // scattered across app.js, and it'll auto-pick up future logs
  // too. Word-boundary regex so we don't match "callback",
  // "callKeeper", "calling-card", etc. Skipped when a [call]
  // token is already present (idempotent on re-runs and on
  // already-tagged sites like '[call] handle incoming [wss] call').
  if (/\bcall(s|ed|ing)?\b/i.test(message) && message.indexOf('[call]') === -1) {
    // Insert just after the leading "<timestamp> " portion so the
    // format stays "<ts> [call] <rest>".
    const sp = message.indexOf(' ');
    if (sp > 0) {
      message = message.slice(0, sp) + ' [call]' + message.slice(sp);
    } else {
      message = '[call] ' + message;
    }
  }

  log2file(message);
  // console.log(message);
}



function generateUniqueId() {
    const uniqueId = String(rnUuid.v4()).replace(/-/g, '').slice(0, 16);
    return uniqueId;
}

function sylk2GiftedChat(sylkMessage, decryptedBody=null, direction='incoming') {
    direction = direction || sylkMessage.direction;
    
    //console.log('sylk2GiftedChat', sylkMessage);

    let encrypted = decryptedBody ? 2 : 0;

    let system = false;
    let image = null;
    let video = null;
    let audio = null;
    let text = null;
    let metadata = {};
    let content = decryptedBody || sylkMessage.content;
    let file_transfer;

    if (content.indexOf('Welcome!') > -1) {
        system = true;
    }

	let html = null;
    if (sylkMessage.contentType === 'text/html') {
		html = cleanHtml(content);
		text = html2text(content); // optional fallback
    } else if (sylkMessage.contentType === 'text/plain') {
        text = content;
    } else if (sylkMessage.contentType === 'application/sylk-file-transfer') {
        try {
            metadata = JSON.parse(content);
            let file_name = metadata.filename;
            let encrypted = file_name.endsWith('.asc');
            let decrypted_file_name = encrypted ? file_name.slice(0, -4) : file_name;
            text = beautyFileNameForBubble(metadata);

            if (metadata.local_url && metadata.error != 'decryption failed') {
                // Normalise the stored path: collapse stray double slashes
                // and re-anchor an old iOS/Android container prefix to the
                // current install. See resolveLocalUrl() — without this,
                // any image saved in a previous app install opens black
                // because the absolute path embeds the old container UUID.
                const _resolved = resolveLocalUrl(metadata.local_url);
                if (isImage(decrypted_file_name, metadata.filetype)) {
                    image = Platform.OS === "android" ? 'file://'+ _resolved : _resolved;
                } else if (isAudio(decrypted_file_name, metadata.filetype)) {
                    audio = Platform.OS === "android" ? 'file://'+ _resolved : _resolved;
                } else if (isVideo(decrypted_file_name, metadata.filetype)) {
                    video = Platform.OS === "android" ? 'file://'+ _resolved : _resolved;
                }
            }

        } catch (e) {
            console.log("Error decoding json in sylk message:", e);
        }
    } else if (sylkMessage.contentType.indexOf('image/') > -1) {
        image = `data:${sylkMessage.contentType};base64,${content}`
        text = 'Photo';
    } else if (sylkMessage.contentType === 'application/sylk-location-sharing') {
        // Location shares are rendered as their own map bubble via
        // _injectLocationBubble, never as chat text. If one ever reaches this
        // generic builder it must be LOGGED to the app log, not shown on the
        // phone as an "Unknown message received ..." bubble. Leave text null so
        // no chat bubble text is produced.
        timestampedLog('[location] sylk2GiftedChat: location content not rendered as chat text: '
            + sylkMessage.contentType + ' id=' + sylkMessage.id);
        text = null;
    } else {
        // Unknown/unsupported type — log it to the app log so it is diagnosable
        // there rather than surfacing a bare "Unknown message" bubble silently.
        timestampedLog('[message] Unknown message received ' + sylkMessage.contentType
            + ' id=' + sylkMessage.id);
        text = 'Unknown message received ' + sylkMessage.contentType;
    }

    let g_id = sylkMessage.id;

    // Normalise to a real Date object. sylkrtc delivers `timestamp` as
    // an ISO string from the websocket payload; the outgoing bubble
    // path (GiftedChat onSend) hands us a Date instance instead. The
    // mixed-type sort in ContactsListBox.componentWillReceiveProps
    // (`a.createdAt < b.createdAt`) silently no-ops when one side is
    // a Date and the other a string — both `<` and `>` come back false
    // because the ISO string coerces to NaN under numeric comparison —
    // which is why a freshly arrived reply was rendering above the
    // user's just-sent bubble. Coercing here keeps every chat bubble
    // comparable as Date <-> Date.
    let createdAt = sylkMessage.timestamp;
    if (!(createdAt instanceof Date)) {
        const parsed = new Date(createdAt);
        createdAt = isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    let msg = {
        _id: g_id,
        key: g_id,
        text: text,
        html: html,
        image: image,
        video: video,
        audio: audio,
        metadata: metadata,
        contentType: sylkMessage.contentType,
        pinned: false,
        createdAt: createdAt,
        received: direction === 'incoming',
        direction: direction,
		failed: false,
        system: system,
        user: direction === 'incoming' ? {_id: sylkMessage.sender.uri, name: sylkMessage.sender.toString()} : {}
        }

        return msg;
}

let sql2GiftedChatErrorId = 0;

// -------------------------
// SAFE LOGGER (never throws)
// -------------------------
function nullWithLog(extra = {}) {
    return null;

    sql2GiftedChatErrorId += 1;

    const msgId    = ("msgId" in extra)    ? extra.msgId    : "";
    const filename = ("filename" in extra) ? extra.filename : "";
    const category = ("category" in extra) ? extra.category : "";
    const reason   = ("reason" in extra)   ? extra.reason   : "";

    console.log(
        `sql2GiftedChat NULL #${sql2GiftedChatErrorId}: ${msgId} ${filename} is not ${category || reason}`
    );

    return null;
}


function fixLocalUrl(localUrl) {
	const parts = localUrl.split("/");
	// Iterate and remove consecutive duplicates of user@domain segments
	for (let i = 1; i < parts.length; i++) {
		if (parts[i].includes("@") && parts[i] === parts[i - 1]) {
			parts.splice(i, 1);
			i--; // stay at the same index after removal
		}
	}
	return parts.join("/");
}

// Resolve a stored local_url to a path that's valid in the CURRENT
// app install. Three real-world failure modes this absorbs:
//
//   1. The filename concatenation in app.js (~line 17169) does
//      `DocumentDirectoryPath + "/" + ... + "/" + filename`. If
//      filename itself starts with a slash (older code derived basename
//      from a picker URI without stripping a leading "/"), the result
//      contains a `//` and points at a file that was never written
//      there in the first place. Collapse repeated slashes (skipping
//      the scheme's `://`) so the path matches what was actually
//      created on disk.
//
//   2. iOS regenerates the app container UUID
//      (`/var/mobile/Containers/Data/Application/<UUID>/Documents/...`)
//      on every install and on some OS upgrades. Absolute paths stored
//      in SQL from a previous install no longer resolve. If we spot
//      the iOS Documents prefix in the stored path, re-anchor the
//      tail under the CURRENT RNFS.DocumentDirectoryPath.
//
//   3. Android equivalent: `/data/user/0/<pkg>/files/...` can change
//      across reinstalls of an old build / restore-from-backup flows.
//      Re-anchor under the current DocumentDirectoryPath the same way.
//
// Returns the normalised path. Caller is responsible for the RNFS.exists
// check — a returned value being non-null does NOT guarantee the file
// is on disk now, only that we tried our best to point at where it
// *should* be.
function resolveLocalUrl(localUrl) {
	if (!localUrl || typeof localUrl !== 'string') return localUrl;

	let p = localUrl;

	// Strip and remember the scheme (file://, content://) so we don't
	// collapse the `//` that's part of it.
	let scheme = '';
	const schemeMatch = p.match(/^([a-z][a-z0-9+.-]*:\/\/)/i);
	if (schemeMatch) {
		scheme = schemeMatch[1];
		p = p.slice(scheme.length);
	}

	// (1) collapse any run of slashes inside the path to a single slash.
	p = p.replace(/\/{2,}/g, '/');

	// (2) re-anchor to current DocumentDirectoryPath if the path used to
	// live under an iOS/Android app-container prefix that's now stale.
	// We do this only when the CURRENT prefix isn't already in the path
	// (cheap exact-match check), and when we can find the Documents/
	// boundary.
	const currentDocs = RNFS.DocumentDirectoryPath; // contains current UUID/pkg
	if (currentDocs && p.indexOf(currentDocs) !== 0) {
		// iOS pattern.
		const iosMatch = p.match(/^\/var\/mobile\/Containers\/Data\/Application\/[A-F0-9-]+\/Documents\/(.*)$/i);
		if (iosMatch) {
			p = currentDocs.replace(/\/$/, '') + '/' + iosMatch[1];
		} else {
			// Android pattern: /data/user/N/<pkg>/files/<rest>
			const androidMatch = p.match(/^\/data\/user\/\d+\/[^/]+\/files\/(.*)$/);
			if (androidMatch) {
				p = currentDocs.replace(/\/$/, '') + '/' + androidMatch[1];
			}
		}
	}

	return scheme + p;
}

function parseSylkConferenceUrl(url) {
  try {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('sylk://')) return null;

    // Remove scheme
    const withoutScheme = url.replace('sylk://', '');

    // Split into domain + path
    const firstSlash = withoutScheme.indexOf('/');

    if (firstSlash === -1) return null;

    const sylkDomain = withoutScheme.substring(0, firstSlash);
    const path = withoutScheme.substring(firstSlash + 1);

    const parts = path.split('/').filter(Boolean);

    // Expect: conference/<room>
    if (parts.length < 2) return null;
    if (parts[0] !== 'conference') return null;

    const conferenceRoom = parts[1];

    if (!sylkDomain || !conferenceRoom) return null;

    return {
      sylkDomain,
      conferenceRoom,
    };
  } catch (e) {
    console.log('parse error:', e);
    return null;
  }
}

// Extract a {latitude, longitude} pair from a Google Maps URL or geo:
// URI embedded in arbitrary text. Returns null if no parseable
// coordinate pair is found. Tolerates extra whitespace, trailing
// punctuation, surrounding text in the same body, and the most common
// Google Maps URL variants — both the canonical share-from-mobile
// formats and the legacy /maps?q= form.
//
// Supported patterns (in priority order):
//   • https://maps.google.com/?q=<lat>,<lng>
//   • https://www.google.com/maps?q=<lat>,<lng>
//   • https://www.google.com/maps/?q=<lat>,<lng>
//   • https://www.google.com/maps/place/<lat>,<lng>/...
//   • https://www.google.com/maps/search/?api=1&query=<lat>,<lng>
//   • https://maps.google.com/?q=loc:<lat>,<lng>   (legacy "loc:" prefix)
//   • geo:<lat>,<lng>[?q=<lat>,<lng>]
//
// NOT supported (would require a server lookup): shortened
// `https://maps.app.goo.gl/...` redirects. The user can long-press the
// link to open it in Maps and then re-share the resulting full link.
//
// Lat must be in [-90, 90], lng in [-180, 180]. Anything outside is
// rejected as a coincidence (a 6-digit pair in some other URL).
function parseSharedLocationUrl(text) {
    if (!text || typeof text !== 'string') return null;

    // Helper: validate and return a normalised pair. Allows up to 7
    // decimals (which is roughly 1 cm — beyond what consumer GPS
    // resolves; Google Maps shares 5–6 dp typically).
    const _check = (latStr, lngStr) => {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < -90 || lat > 90) return null;
        if (lng < -180 || lng > 180) return null;
        return {latitude: lat, longitude: lng};
    };

    // Common decimal-pair regex used by every URL pattern below.
    // Reluctant on the decimal portion so trailing slashes / ampersands
    // don't get greedily eaten.
    const COORD = '(-?\\d{1,3}(?:\\.\\d{1,7})?),(-?\\d{1,3}(?:\\.\\d{1,7})?)';

    // 1. /place/<lat>,<lng>/    — the "search-then-share-place" output
    //    e.g. https://www.google.com/maps/place/44.20957,28.62033/...
    let m = text.match(new RegExp(`/maps/place/${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 2. /search/?api=1&query=<lat>,<lng>  — Google Maps URL Scheme
    m = text.match(new RegExp(`/maps/search/[^\\s]*?[?&]query=${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 3. ?q=loc:<lat>,<lng>     — legacy Maps "loc:" prefix
    m = text.match(new RegExp(`[?&]q=loc:${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 4. ?q=<lat>,<lng> or ?query=<lat>,<lng>  — canonical mobile
    //    share format. maps.google.com, www.google.com/maps,
    //    google.com/maps all land here.
    m = text.match(new RegExp(`[?&](?:q|query)=${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 5. geo:<lat>,<lng>        — RFC 5870 geo URI scheme. Optional
    //    `?q=` suffix is allowed but ignored — the bare prefix already
    //    carries the coords.
    m = text.match(new RegExp(`\\bgeo:${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 6. /@<lat>,<lng>,<zoom>z   — Google Maps' viewport-anchor format
    //    used after redirects from maps.app.goo.gl shorteners. Common
    //    shapes:
    //      https://www.google.com/maps/place/<name>/@44.2,28.6,17z/...
    //      https://www.google.com/maps/@44.2,28.6,15z
    //      https://www.google.com/maps/dir/.../@44.2,28.6,12z/...
    //    The `@lat,lng` is the camera viewport centre — for a /place/
    //    URL it's exactly the place location, for the others it's the
    //    map view centre, which is the right answer for "where is this
    //    sharing pointing me".
    m = text.match(new RegExp(`/@${COORD}(?:,\\d+(?:\\.\\d+)?z)?`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 7. !3d<lat>!4d<lng>        — Google Maps' encoded "data" payload
    //    that appears in long redirect URLs and embedded HTML. Look
    //    for the `!3d<lat>!4d<lng>` triplet which always carries the
    //    canonical place coordinates regardless of viewport.
    m = text.match(new RegExp(`!3d(-?\\d{1,3}(?:\\.\\d{1,7})?)!4d(-?\\d{1,3}(?:\\.\\d{1,7})?)`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 8. center=<lat>,<lng>      — Maps embed / iframe URL parameter,
    //    sometimes appears in interstitial HTML response bodies.
    m = text.match(new RegExp(`[?&]center=${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    // 9. ll=<lat>,<lng>          — Apple Maps query format. Some users
    //    paste these into our chat too; might as well support them.
    m = text.match(new RegExp(`[?&]ll=${COORD}`, 'i'));
    if (m) { const r = _check(m[1], m[2]); if (r) return r; }

    return null;
}

// Extract a "shareable location link" descriptor from text: either a
// direct coordinate pair (anything `parseSharedLocationUrl` recognises)
// OR a shortened-URL that needs network resolution before we can pull
// coords out of it. Returned shape:
//
//   {type: 'direct', coords: {latitude, longitude}}
//   {type: 'short',  url: '<the short URL>'}
//   null  — no recognised location link in the text
//
// Field-reported case: the user shared `maps.app.goo.gl/<id>` from
// Google Maps mobile. We can't resolve those offline (the short id
// is opaque server-side state). Returning a `'short'` descriptor lets
// the UI surface the action optimistically and defer the fetch+resolve
// to the moment the user actually taps "Meet me there...".
//
// Recognised shorteners:
//   • https://maps.app.goo.gl/<id>     — Google Maps mobile share
//   • https://goo.gl/maps/<id>         — legacy Google Maps short URL
function extractLocationLink(text) {
    if (!text || typeof text !== 'string') return null;
    // Direct match takes priority — if the text already contains a
    // coordinate-bearing URL we don't need a network round-trip.
    const direct = parseSharedLocationUrl(text);
    if (direct) {
        return {type: 'direct', coords: direct};
    }
    // Shortened-URL detection. Capture the full short URL so the
    // resolver can fetch it as-is. The path id is alphanumeric +
    // hyphens / underscores — restrict to those so we don't grab
    // adjacent punctuation (the user might write "see <url>." with
    // a trailing period).
    const SHORT_PATTERNS = [
        /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+/i,
        /https?:\/\/goo\.gl\/maps\/[A-Za-z0-9_-]+/i,
    ];
    for (const re of SHORT_PATTERNS) {
        const m = text.match(re);
        if (m) return {type: 'short', url: m[0]};
    }
    return null;
}

// Resolve a shortened Google Maps URL to coordinates by following the
// HTTP redirect to its canonical form and then re-parsing. Returns a
// Promise<{latitude, longitude} | null>.
//
// Two-stage strategy:
//   1. Fetch with `redirect: 'follow'`. The shortener responds with a
//      302 to the canonical maps.google.com URL whose query string or
//      `/place/<lat>,<lng>/` segment carries the coords. The fetch
//      runtime exposes the final URL via `response.url`.
//   2. Pass that final URL to `parseSharedLocationUrl`. If that fails
//      (e.g. a `place/<name>` URL with no coordinates), fall back to
//      scanning the response BODY — Google's interstitial HTML
//      sometimes embeds the coords as `?center=<lat>,<lng>` in a meta
//      tag or in inline JSON.
//
// Network failures, non-2xx responses, and URLs that resolve to a
// non-coord landing page all return null. Caller should surface a
// brief "couldn't resolve" hint to the user in that case.
// Decode the escape forms Google uses to embed a destination Maps URL
// inside an interstitial HTML body: percent-encoding (in a consent-form
// `continue=` value) and JS string escapes (\uXXXX / \/ inside inline
// <script> JSON). Returns a decoded copy safe to run through
// parseSharedLocationUrl; never throws. We translate a fixed set of URL /
// coordinate punctuation rather than calling decodeURIComponent on the
// whole page (which throws on any stray % in the HTML).
function decodeEmbeddedLocationUrls(s) {
    if (!s || typeof s !== 'string') return '';
    let out = s;
    try {
        // JS string escapes.
        out = out
            .replace(/\\u002[fF]/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\u003[dD]/g, '=')
            .replace(/\\u0040/g, '@')
            .replace(/\\u0021/g, '!')
            .replace(/\\x2[fF]/g, '/')
            .replace(/\\x40/g, '@')
            .replace(/\\\//g, '/');
    } catch (e) {}
    try {
        // Percent-encoded punctuation from a consent continue= URL.
        out = out
            .replace(/%2[Ff]/g, '/')
            .replace(/%40/g, '@')
            .replace(/%2[Cc]/g, ',')
            .replace(/%3[Aa]/g, ':')
            .replace(/%3[Ff]/g, '?')
            .replace(/%3[Dd]/g, '=')
            .replace(/%26/g, '&')
            .replace(/%21/g, '!');
    } catch (e) {}
    return out;
}

// Pull the `continue=<url>` destination out of a Google consent
// interstitial — from the (possibly stale) final URL query string or from
// a form field / link in the body. Google percent-encodes the value
// (occasionally twice). Returns a decoded absolute URL or null.
function extractContinueUrl(finalUrl, body) {
    const _find = (str) => {
        if (!str || typeof str !== 'string') return null;
        // Query-string form: ...?continue=<url>&...  (consent redirect URL
        // or an href inside the page).
        let m = str.match(/[?&]continue=([^&"'\\\s]+)/i);
        if (m) return m[1];
        // Hidden-form-field form: <input name="continue" value="<url>">
        // (the consent page POSTs this).
        m = str.match(/name=["']continue["'][^>]*?value=["']([^"']+)["']/i);
        if (m) return m[1];
        return null;
    };
    let raw = _find(finalUrl) || _find(body);
    if (!raw) return null;
    for (let i = 0; i < 2; i++) {
        try {
            const dec = decodeURIComponent(raw);
            if (dec === raw) break;
            raw = dec;
        } catch (e) { break; }
    }
    if (!/^https?:\/\//i.test(raw)) return null;
    return raw;
}

// Emit a compact structural summary of an unparseable resolve body so a
// field log tells us exactly what Google served (consent wall vs JS stub
// vs something new) without dumping 34 KB of markup.
function logResolveDiagnostics(label, finalUrl, sampled) {
    try {
        const _titleM = sampled.match(/<title[^>]*>([^<]{0,120})/i);
        const _title = _titleM ? _titleM[1].trim() : '(none)';
        const _isConsent = /consent\.google|Before you continue|consent\.youtube/i.test(sampled);
        const _snippet = (needle) => {
            const k = sampled.search(needle);
            if (k < 0) return null;
            return sampled.slice(Math.max(0, k - 20), k + 180).replace(/\s+/g, ' ').trim();
        };
        timestampedLog('[location] resolveShort: NO MATCH (' + label + ')',
            'finalUrl=', finalUrl,
            'bodyLen=', sampled.length,
            'title=', JSON.stringify(_title),
            'consentPage=', _isConsent);
        const _c = _snippet(/continue=/i);
        if (_c) timestampedLog('[location] resolveShort: diag continue~', JSON.stringify(_c));
        const _m = _snippet(/\/maps\//i);
        if (_m) timestampedLog('[location] resolveShort: diag maps~', JSON.stringify(_m));
        const _f = _snippet(/<form[^>]*action=/i);
        if (_f) timestampedLog('[location] resolveShort: diag form~', JSON.stringify(_f));
        const _g = _snippet(/!3d-?\d|@-?\d{1,3}\.\d|center=-?\d/);
        if (_g) timestampedLog('[location] resolveShort: diag geo~', JSON.stringify(_g));
    } catch (e) {}
}

async function resolveShortLocationUrl(shortUrl, _depth) {
    if (!shortUrl || typeof shortUrl !== 'string') return null;
    _depth = _depth || 0;
    // Version marker — lets a field log confirm which build's resolver ran.
    if (_depth === 0) {
        try { timestampedLog('[location] resolveShort: v3 (consent-aware) for', shortUrl); } catch (e) {}
    }

    const _UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Resolution strategies, tried in order until one yields coords. From an
    // EU / GDPR network Google answers browser-shaped requests to
    // maps.app.goo.gl with a "Before you continue to Google Maps" consent
    // interstitial (HTTP 200, ~34 KB, no coords, response.url unchanged)
    // instead of the 302 -> canonical /maps/place/.../data=!3d<lat>!4d<lng>
    // URL. A logged-in browser clears the wall with a stored consent cookie
    // (which is why sharing works in the web app but not here). We try:
    //   1. browser UA + accepted-consent cookies (SOCS is the current
    //      post-2022 cookie; CONSENT=YES+ is the legacy one — send both)
    //   2. a plain non-browser UA, no cookies — Google commonly serves the
    //      raw 302 to non-interactive clients, skipping the wall entirely
    // Each attempt parses response.url, the body, and a de-escaped copy of
    // the body, then follows a consent `continue=` target once (bounded by
    // _depth) before falling through to the next strategy.
    const _strategies = [
        {
            label: 'browser+consent',
            headers: {
                'User-Agent': _UA_BROWSER,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                // SOCS: a published "consent granted" value. If Google rotates
                // its expected token this attempt simply falls through to the
                // plain-UA strategy and the continue= follow below.
                'Cookie': 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+',
            },
        },
        {
            label: 'plain',
            headers: {
                'User-Agent': 'curl/8.4.0',
            },
        },
    ];

    for (const strat of _strategies) {
        let response;
        try {
            response = await fetch(shortUrl, {method: 'GET', redirect: 'follow', headers: strat.headers});
        } catch (e) {
            try { timestampedLog('[location] resolveShort: fetch failed (' + strat.label + ')', e && e.message ? e.message : e); } catch (e2) {}
            continue;
        }
        if (!response) {
            try { timestampedLog('[location] resolveShort: no response (' + strat.label + ') for', shortUrl); } catch (e) {}
            continue;
        }
        try {
            timestampedLog('[location] resolveShort: HTTP', response.status,
                '(' + strat.label + ')', 'finalUrl=', response.url);
        } catch (e) {}

        // (a) the redirected URL — the common non-EU case.
        if (response.url && response.url !== shortUrl) {
            const fromUrl = parseSharedLocationUrl(response.url);
            if (fromUrl) {
                try { timestampedLog('[location] resolveShort: matched final URL (' + strat.label + ')'); } catch (e) {}
                return fromUrl;
            }
        }

        // Read + cap the body once (200 KB — modern Maps HTML is ~150 KB).
        let sampled = '';
        try {
            const body = await response.text();
            sampled = body && body.length > 0 ? body.slice(0, 200 * 1024) : '';
        } catch (e) {
            try { timestampedLog('[location] resolveShort: body read failed (' + strat.label + ')', e && e.message ? e.message : e); } catch (e2) {}
        }
        if (!sampled) continue;

        // (b) coords embedded directly in the body.
        let fromBody = parseSharedLocationUrl(sampled);
        if (fromBody) {
            try { timestampedLog('[location] resolveShort: matched body (' + strat.label + ')'); } catch (e) {}
            return fromBody;
        }
        // (c) coords embedded percent-/unicode-escaped in the body.
        const _decoded = decodeEmbeddedLocationUrls(sampled);
        if (_decoded && _decoded !== sampled) {
            fromBody = parseSharedLocationUrl(_decoded);
            if (fromBody) {
                try { timestampedLog('[location] resolveShort: matched body decoded (' + strat.label + ')'); } catch (e) {}
                return fromBody;
            }
        }

        // (d) consent wall: follow the `continue=` destination once.
        if (_depth < 2) {
            const cont = extractContinueUrl(response.url, _decoded || sampled);
            if (cont && cont !== shortUrl) {
                const fromCont = parseSharedLocationUrl(cont);
                if (fromCont) {
                    try { timestampedLog('[location] resolveShort: matched continue= url'); } catch (e) {}
                    return fromCont;
                }
                try { timestampedLog('[location] resolveShort: following continue= (' + strat.label + ') ->', cont.slice(0, 200)); } catch (e) {}
                const r2 = await resolveShortLocationUrl(cont, _depth + 1);
                if (r2) return r2;
            }
        }

        // Structural diagnostics for this failed attempt.
        logResolveDiagnostics(strat.label, response.url, sampled);
    }

    return null;
}
// Extract a `?q=<value>` parameter from a URL. Used by the meet-me-there
// fallback path to recover an address string from a Google Maps "share by
// name" URL like `maps.google.com/?q=Atic+Millennium,+Bulevardul+Mamaia`
// when no `@<lat>,<lng>` form is reachable. Returns the URL-decoded
// value (with `+` translated to spaces) or null.
function extractQueryAddress(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/[?&](?:q|query)=([^&]+)/i);
    if (!m) return null;
    let raw = m[1];
    try {
        raw = decodeURIComponent(raw);
    } catch (e) {
        // Fall through with the encoded value if decode fails.
    }
    return raw.replace(/\+/g, ' ').trim() || null;
}

// Geocode an address via Nominatim (OpenStreetMap's free geocoder).
// Returns {latitude, longitude} or null on failure / no match.
//
// Nominatim usage policy: identify yourself in the User-Agent header
// (we use the app's bundleId), keep request volume low (we only call
// once per meet-me-there tap), and don't hammer at high frequency.
// See https://operations.osmfoundation.org/policies/nominatim/.
//
// Latitude / longitude are validated against the same bounds as
// parseSharedLocationUrl so a malformed or out-of-range response
// can't produce a phantom destination pin.
async function geocodeAddress(address) {
    if (!address || typeof address !== 'string') return null;
    try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
            + encodeURIComponent(address);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Sylk/1.0 (com.agprojects.sylk; meet-me-there)',
                'Accept': 'application/json',
            },
        });
        if (!response || !response.ok) {
            try { timestampedLog('[location] geocode: HTTP', response && response.status, 'for', address); } catch (e) {}
            return null;
        }
        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) {
            try { timestampedLog('[location] geocode: no results for', address); } catch (e) {}
            return null;
        }
        const lat = parseFloat(json[0].lat);
        const lng = parseFloat(json[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        try { timestampedLog('[location] geocode: matched', address, '→', lat.toFixed(5), ',', lng.toFixed(5)); } catch (e) {}
        return {latitude: lat, longitude: lng};
    } catch (e) {
        try { timestampedLog('[location] geocode: error', e && e.message ? e.message : e); } catch (e2) {}
        return null;
    }
}

function parseSylkCallUrl(url) {
  // Recognizes https://<host>[:<port>]/call/<sip-uri> and returns the SIP URI.
  // Example: https://dune.sylk.link:60000/call/paul@dune.sylk.link -> paul@dune.sylk.link
  try {
    if (!url || typeof url !== 'string') return null;

    const match = url.match(/^https?:\/\/[^/]+\/call\/(.+)$/i);
    if (!match) return null;

    let target = match[1];

    // Strip query string and fragment if present
    target = target.split('?')[0].split('#')[0];

    // Strip trailing slashes
    target = target.replace(/\/+$/, '');

    if (!target) return null;

    // Decode URI-encoded characters (e.g. %40 -> @)
    try {
      target = decodeURIComponent(target);
    } catch (e) {
      // keep target as-is if decoding fails
    }

    return target;
  } catch (e) {
    console.log('parseSylkCallUrl error:', e);
    return null;
  }
}

async function sql2GiftedChat(item, content, filter = {}) {
    //console.log('-- sql2GiftedChat', item);
    let msg;
    let image = null;
    let html = null;
    let video = null;
    let audio = null;
    let metadata = {};
    let category = filter.category || null;

    let timestamp = new Date(item.unix_timestamp * 1000);
    let text = content || item.content;

	if (item.content_type === 'text/html') {
		html = cleanHtml(text);
	}

    if (text && text.indexOf("-----BEGIN PGP MESSAGE-----") > -1) {
        text = "";
    }

    let failed = (item.received === 0 || item.encrypted === 3);
    let received = item.received === 1;
    let sent = item.sent === 1;
    let pending = item.pending === 1;
    let from_uri = item.sender ? item.sender : item.from_uri;

    // -------------------------
    // Parse file-transfer JSON
    //---------------------------
    if (item.content_type === "application/sylk-file-transfer") {
        // No category-reject loop here anymore — the SQL slice in
        // app.js#getMessages now gates on the persisted `category`
        // column (v17), so a row with this content_type only
        // reaches us when the caller actually wants file-transfer
        // bubbles. The previous text/links short-circuit is
        // redundant; left as a defensive null-out for callers that
        // bypass the SQL layer with a hand-built item (rare —
        // exists in test paths).
        if (category == 'text' || category == 'links') {
			return null;
        }

        let sql_metadata = item.metadata || text;
        try {
            Object.assign(metadata, JSON.parse(sql_metadata));
        } catch (e) {
            console.log("Error decoding file transfer JSON:", e);
            return nullWithLog({
                msgId: item.msg_id,
                reason: "invalid-json"
            });
        }
    } else if (item.metadata && typeof item.metadata === 'string' && item.metadata.length > 0) {
        // Non-file-transfer rows can also carry a JSON metadata blob —
        // e.g. call system messages store {trace:{callid,fromtag,totag,
        // proxyIP}} so a tap can open the CDRTool SIP-trace page. Parse
        // it best-effort; a bad blob just yields no metadata rather than
        // dropping the whole message.
        try {
            Object.assign(metadata, JSON.parse(item.metadata));
        } catch (e) {
            // leave metadata as-is; not fatal for a text/system bubble
        }
    }

    let must_check_category = true;

    // -------------------------
    // If filtering for media, but no filename → drop. 'text' and
    // 'links' are both text-shaped (no filename expected); they
    // skip this gate so plain text bubbles survive into the JS
    // post-filter that narrows links further.
    // -------------------------
    if (category && category !== "text" && category !== "links" && !metadata.filename) {
        return nullWithLog({
            msgId: item.msg_id,
            filename: "",
            category
        });
    }

    // -------------------------
    // If we have a file transfer
    // -------------------------
    if (metadata.filename) {
        let filename = metadata.filename;  // <--- ALWAYS LOWERCASE
        text = beautyFileNameForBubble(metadata);
        
        if (metadata.local_url) {
            // Re-anchor stale iOS/Android container paths and collapse
            // any stray `//` from older filename concatenation bugs.
            // Without this step, every reinstall (which regenerates the
            // iOS container UUID) instantly orphans every image/audio/
            // video the user had downloaded, because the next check
            // requires the stored path to start with the CURRENT
            // DocumentDirectoryPath — which it no longer does. We
            // rewrite the path in-place so downstream sites
            // (sql2GiftedChat consumers, viewers, sharing, etc.) all
            // see the corrected value.
            const _resolved = resolveLocalUrl(metadata.local_url);
            if (_resolved !== metadata.local_url) {
                metadata.local_url = _resolved;
            }

            if (!metadata.local_url.startsWith(RNFS.DocumentDirectoryPath)) {
				metadata.local_url = null;
            } else {
				const exists = await RNFS.exists(metadata.local_url);
				if (exists) {
					try {
						const { size } = await ReactNativeBlobUtil.fs.stat(metadata.local_url);
						//console.log('File exists local', metadata.local_url);
						if (size === 0) {
							metadata.local_url = null;
						} else {
							//console.log('FT', item.msg_id, metadata.filename, beautySize(size));

						}
					} catch (e) {
						console.log('Error stat file:', e.message);
					}
				} else {
					// Per-row file-missing log was very noisy on accounts
					// with lots of historical transfers whose local files
					// have been cleaned up. Local_url is reset to null
					// silently — the bubble's download affordance picks
					// up from there. Re-enable while debugging if a
					// specific msg_id needs to be traced.
					//console.log('File does not exist', item.msg_id, metadata.local_url);
					metadata.local_url = null;
				}
            }
        }

        metadata.playing = false;
        if (!metadata.position) {
			metadata.position = 0;
        }

        if (!metadata.consumed) {
			metadata.consumed = 0;
        }
        
        let isImg = isImage(filename, metadata.filetype);
        let isAud = isAudio(filename, metadata.filetype);
        let isVid = isVideo(filename, metadata.filetype);

        // -------------------------
        // Category check
        // -------------------------
        if (must_check_category && category) {
            if (category === "image" && !isImg) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "audio" && !isAud) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "video" && !isVid) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "other") {
                // Keep rows that are NOT image/audio/video — those
                // are exactly the "other" leftover bucket. The old
                // implementation unconditionally returned null
                // here, which silently dropped every row when the
                // user picked the Other chip (the bug surfaced
                // once the v17 category column made the SQL slice
                // honest and actually return 'other' rows).
                if (isImg || isAud || isVid) {
                    return nullWithLog({
                        msgId: item.msg_id,
                        filename,
                        category
                    });
                }
            }
        }

        // -------------------------
        // Selected media type
        // -------------------------
        if (metadata.local_url && !metadata.error) {
            let local_url = Platform.OS === "android" ? "file://" + metadata.local_url : metadata.local_url;

			/*
			const fixed_local_url = fixLocalUrl(local_url);
			if (fixed_local_url != local_url) {
				local_url = fixed_local_url;
				//console.log('Local URL was fixed', fixed_local_url);
			}
			*/
			
			if (local_url) {
				if (isImg) {
					image = metadata.b64
						? `data:${metadata.filetype};base64,${metadata.b64}`
						: local_url;
				} else if (isAud) {
					audio = local_url;
				} else if (isVid) {
					video = local_url;
				}
			}
        }

        if (metadata.error) {
            failed = true;
            text = text + " - " + metadata.error;
        }

    } else {
        // -------------------------
        // Non-file-transfer behavior
        // -------------------------
        if (item.image || metadata.local_url) {
            // Prefer metadata.local_url over the SQL image column.
            // updateFileTransferSql only writes the metadata column on
            // download success — the legacy image column keeps whatever
            // path was stored on first send/receive, which is often the
            // truncated/broken pre-repair value. metadata.local_url is
            // the canonical "this is where the bytes actually live now"
            // pointer; we still resolveLocalUrl it as belt-and-braces
            // against stale container UUIDs.
            image = resolveLocalUrl(metadata.local_url || item.image);
            text = "Photo";
        }

        if (item.encrypted === 3) {
            text = text + " - decryption failed";
        }
    }
    
    const thumbnail = metadata.thumbnail || null;
    const rotation = metadata.rotation || 0;
    const label = metadata.label || null;
    const consumed = metadata.consumed || 0;
    const position = metadata.position || 0;
    const playing = metadata.playing || false;
    const dispositionNotification = item.disposition_notification ? item.disposition_notification.split(",") : [];

    // -------------------------
    // Construct final message
    // -------------------------
    msg = {
        _id: item.msg_id,
        key: item.msg_id,
        direction: item.direction,
        dispositionNotification,
        audio,
        image,
        video,
        thumbnail,
        rotation,
        label,
        consumed,
        playing,
        position,
        metadata,
        contentType: item.content_type,
        text,
        html,
        createdAt: timestamp,
        sent,
        received,
        pending,
        system: item.system === 1,
        // SIP Call-ID this message belongs to (call system messages),
        // carried through so the converge step can match in memory.
        callId: item.call_id || null,
        failed,
        pinned: item.pinned === 1,
        user: item.direction === "incoming"
            ? { _id: from_uri, name: from_uri }
            : {}

    };

    return msg;
}

function beautyFileNameForBubble(metadata, lastMessage=false) {
    let text = metadata.filename;
    let file_name = metadata.filename;
    //console.log('beautyFileNameForBubble', metadata);

    let prefix = '';
 
    let encrypted = metadata.filename.endsWith('.asc');
    let decrypted_file_name = encrypted ? file_name.slice(0, -4) : file_name;

    if (metadata.preview) {
        return metadata.duration? 'Movie' : 'Photo';
    }

    // Locally-recorded calls (saveCallRecording in app.js) are stamped
    // with call_recording AND filename matching `sylk-call-recording-*`.
    // Render them with a clearer label than the generic "Audio".
    //
    // Conference recordings (saved by ConferenceBox._stopConferenceRecording)
    // carry the same call_recording=true flag plus is_conference=true.
    // We branch on is_conference so the chat bubble says "Conference
    // recording" instead of the 1-to-1 "Call recording" — same look
    // and feel, just an unambiguous label for the multi-party file
    // (mic L, sum of all remote participants on R).
    // `call_recording` is the reliable signal only on the device that made
    // the recording. A recording that came up through the upload endpoint
    // arrives with an envelope SylkServer rebuilt from the URL, and every
    // custom field is gone from it -- so on every OTHER device the name is
    // all there is. `audio-recording-` is what Blink uploads a call
    // recording as; a voice note is `sylk-audio-recording` and keeps the
    // plain label.
    const isCallRecording = (metadata.call_recording === true)
        || (file_name && file_name.toLowerCase().startsWith('sylk-call-recording-'))
        || (file_name && file_name.toLowerCase().startsWith('sylk-conf-recording-'))
        || (file_name && file_name.toLowerCase().startsWith('audio-recording-'));
    const isConferenceRecording = (metadata.is_conference === true)
        || (file_name && file_name.toLowerCase().startsWith('sylk-conf-recording-'));

    if (isImage(decrypted_file_name, metadata.filetype)) {
        text = 'Photo';
    } else if (isAudio(decrypted_file_name, metadata.filetype)) {
        if (isConferenceRecording) {
            text = 'Conference recording';
        } else if (isCallRecording) {
            text = 'Call recording';
        } else {
            text = 'Audio recording';
        }
    } else if (isVideo(decrypted_file_name, metadata.filetype)) {
        text = 'Video';
    } else {
        if (lastMessage) {
            text = decrypted_file_name;
        } else {
            if (metadata.local_url) {
                if (encrypted) {
                    if (metadata.local_url && !metadata.local_url.endsWith('.asc')) {
                        text = decrypted_file_name;
                    } else {
                        text = 'Decrypt ' + decrypted_file_name;
                    }
                } else {
                    if (metadata.failed && metadata.direction === "outgoing") {
                        text = 'Upload ' + file_name;
                    } else {
                        text = file_name;
                    }
                }
            } else {
                text = prefix + ' ' + decrypted_file_name;
            }
        }
    }

    //console.log(text);
    return text;

    // + '\n' + RNFS.DocumentDirectoryPath + '\n' + metadata.local_url;
}

function html2text(content) {
    content = xss(content, {
              whiteList: [], // empty, means filter out all tags
              stripIgnoreTag: true, // filter out all HTML not in the whitelist
              stripIgnoreTagBody: ["script", "style"] // the script tag is a special case, we need
              // to filter out its content
            });

    return content.replace(/&nbsp;/g, ' ');
}

function cleanHtml(html) {
  if (!html) return html;

  return html
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '');
}

/**
 * If `localPart` is a phone number once its visual separators are collapsed,
 * return the collapsed form; otherwise return null.
 *
 * The ORDER matters and is the whole reason this exists. isPhoneNumber anchors
 * on a leading '+' or '0', so an ordinary address-book spelling like
 * '(023) 799-3800' does NOT match in its stored form. Testing before
 * collapsing therefore misclassified it as a SIP username and left the
 * separators in — '023799-3800@domain' went on the wire. Collapse first, then
 * ask.
 *
 * Returning null (rather than the input) for the non-number case keeps callers
 * honest: 'bob smith' must not silently become 'bobsmith', and a SIP username
 * like 'john-doe' has to keep its '-'.
 */
/**
 * The two characters to draw inside an avatar circle for a contact that is a
 * phone number and has no usable name.
 *
 * Initials are meaningless for a number: the first two characters are the
 * country code, so every Dutch contact in the list wore an identical '+3'
 * badge and none of them could be told apart at a glance. The LAST two digits
 * are the part that actually varies per subscriber.
 *
 *   +31641372960 -> '60'
 *   +31641371120 -> '20'
 *   0031641372960 -> '60'   (the 00 wire form lands on the same label)
 *
 * Returns null when the URI is not a phone number, so callers fall through to
 * their normal initials logic untouched.
 */
function phoneAvatarLabel(uri) {
    if (typeof uri !== 'string' || !uri) {
        return null;
    }
    const atIdx = uri.indexOf('@');
    const localPart = atIdx > -1 ? uri.substring(0, atIdx) : uri;
    const domain = atIdx > -1 ? uri.substring(atIdx + 1) : '';

    // Conference room ids are all-digit (generateSillyName) but are never
    // phone numbers. They have their own group-icon avatar; make sure a
    // room can never be pulled into this branch by digit shape alone.
    if (domain.indexOf('videoconference') > -1) {
        return null;
    }
    if (!isPhoneNumber(localPart)) {
        return null;
    }

    const digits = localPart.replace(/\D/g, '');
    if (!digits) {
        return null;
    }
    return digits.slice(-2);
}

function collapsedPhoneNumber(localPart) {
    if (typeof localPart !== 'string') {
        return null;
    }
    const collapsed = localPart.replace(/[\s\-_()]/g, '');
    return isPhoneNumber(collapsed) ? collapsed : null;
}

function normalizeUri(uri, defaultDomain) {
    // Unwrap tel: before anything else — the '@' split, the phone-number
    // detection and the separator strip below all expect a bare number.
    let targetUri = stripTelScheme(uri);
    let idx = targetUri.indexOf('@');
    let username;
    let domain;
    if (idx !== -1) {
        username = targetUri.substring(0, idx);
        domain = targetUri.substring(idx + 1);
    } else {
        username = targetUri;
        domain = defaultDomain;
    }
    // Phone-number usernames: collapse the human-friendly separators people
    // type or paste — spaces, dashes, underscores and parens — so
    // '+1-313-1313', '+1 313 1313' and '(023) 799-3800' all reduce to their
    // canonical digits. Anything that is NOT a number after collapsing
    // takes the generic SIP strip instead, which deliberately leaves '-'
    // and '_' alone so usernames like 'john-doe' survive intact.
    const _collapsed = collapsedPhoneNumber(username);
    if (_collapsed !== null) {
        username = _collapsed;
    } else {
        username = username.replace(/[<>\s()\[\]\'\"\~\!\%\&\*\{\}\|\\]/g, '');
    }
    return `${username}@${domain}`;
}

function copyToClipboard(text) {
    Clipboard.setString(text);
    return true;
}

async function findContact(uri) {
    // react-native-contacts 8.x is Promise-based: checkPermission /
    // getContactsByEmailAddress / getContactsMatchingString take no
    // callback and return Promises. The old callback form silently
    // never resolved (the callback was never invoked), hanging any
    // awaiter — migrated to async/await.
    const permission = await Contacts.checkPermission();
    if (permission !== 'authorized') {
        console.log('not authorised');
        throw new Error('Not Authorised');
    }
    const byEmail = await Contacts.getContactsByEmailAddress(uri);
    if (byEmail) {
        return byEmail;
    }
    return await Contacts.getContactsMatchingString(uri);
}

function generateSillyName() {
    // 6-digit numeric room ID (range 100000..999999) — replaces the
    // previous adjective+noun+noun+digit generator. Easier to read,
    // dictate over the phone, and keeps the room URI compact.
    return String(Math.floor(100000 + Math.random() * 900000));
}

function generateMaterialColor(text) {
    return generateColor(text);
}

function generateVideoTrack(stream, width = 640, height = 480) {
    // const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // const analyser = audioCtx.createAnalyser();
    // const source = audioCtx.createMediaStreamSource(stream);
    // source.connect(analyser);

    // analyser.fftSize = 256;
    // const bufferLength = analyser.frequencyBinCount;
    // const dataArray = new Uint8Array(bufferLength);

    // const canvas = Object.assign(document.createElement('canvas'), {width, height});
    // const ctx = canvas.getContext('2d');

    // const img = new Image();
    // const blinkLogo = new Image();
    // img.addEventListener('load', () => {
    //     draw();
    // });

    // const draw = () => {
    //     if (stream.active) {
    //         const drawVisual = requestAnimationFrame(draw);
    //     }
    //     analyser.getByteFrequencyData(dataArray);

    //     ctx.fillStyle = 'rgb(35, 35, 35)';
    //     ctx.fillRect(0, 0, width, height);
    //     ctx.filter = 'grayscale(100%) brightness(90%)';
    //     ctx.drawImage(blinkLogo, (width / 2) - 150, (height / 2) - 150, 300, 300);
    //     ctx.filter = 'none';
    //     ctx.drawImage(img, (width / 2) - 45 , height / 3, 90, 90);
    //     const barWidth = (width / bufferLength) * 2.5;
    //     let barHeight;
    //     let x = 0;
    //     for(var i = 0; i < bufferLength; i++) {
    //         barHeight = dataArray[i] / 2;

    //         ctx.fillStyle = 'rgb(' + (barHeight + 100) + ', 50, 50)';
    //         ctx.fillRect(x, 2 * height / 3 - barHeight / 2, barWidth, barHeight);

    //         x += barWidth + 1;
    //     }
    // };
    // img.src = 'assets/images/video-camera-slash.png';
    // blinkLogo.src = 'assets/images/blink-white-big.png';

    // const canvasStream = canvas.captureStream();


    return Object.assign(stream.getVideoTracks()[0], {enabled: true});
}

function getWindowHeight() {
    return Dimensions.get('window').height;
}

function escapeHtml(text) {
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

/**
 * Unwrap an RFC 3966 `tel:` URI down to the bare number it carries.
 *
 * A `tel:` prefix is decoration, not part of the number: it arrives from
 * pasted web links (<a href="tel:+31612345678">), from QR codes (which
 * encode phone numbers as tel: URIs almost universally) and from OS share
 * intents. Everything downstream — isPhoneNumber below, normalizeUri, the
 * digit-ish contact matcher in ContactsListBox and the PSTN
 * replaceLeadingZero / replacePlus rewrites in Call.js — expects the bare
 * number, so the scheme is stripped once, as early as possible, and the
 * value then travels the ordinary PSTN path.
 *
 * Also dropped: the `//` some sources wrongly insert, the RFC 3966
 * parameter tail (`;ext=42`, `;phone-context=+31`) which is not diallable,
 * percent-encoded '+', and the visual separators RFC 3966 explicitly
 * allows inside a tel: number (space, '-', '.', parens).
 *
 *   tel:+31612345678         -> +31612345678
 *   TEL:+1-313-1313          -> +13131313
 *   tel://0031612345678      -> 0031612345678
 *   tel:%2B31612345678;ext=4 -> +31612345678
 *
 * Anything that is not a tel: URI is returned untouched.
 */
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

/**
 * Remove a national trunk prefix that a badly-formatted source glued onto
 * an ALREADY international number.
 *
 * Click-to-dial widgets and hand-written <a href="tel:"> links get this
 * wrong constantly: they take a number printed in national form WITH its
 * trunk prefix (023 799 3800) and prepend the country code without
 * dropping the 0 — tel:+31-023-7993800. E.164 has no room for a trunk
 * prefix after a country code, so the resulting +310237993800 is not a
 * dialable number; the gateway either rejects it or routes it somewhere
 * unexpected.
 *
 * We can repair it without guessing, because the account already tells us
 * which country it lives in. The "Replace 0 with" preference
 * (pstn.replaceLeadingZero, e.g. '0031') is by construction
 * <international access code><home country code>. Peel the access code
 * (pstnRules.replacePlus, '00' by default) off the front and what is left
 * is the home country code, '31'. A number starting '+31' or '0031'
 * followed by a 0 is therefore carrying a trunk prefix that must go.
 *
 * Deliberately narrow — every one of these bounds is load-bearing:
 *   • HOME country code only, never a foreign one. There is no country-code
 *     table here, and guessing where a foreign CC ends would mangle good
 *     numbers.
 *   • Only when "Replace 0 with" is configured. No rule -> no known home
 *     country -> no rewrite.
 *   • Never for +39. Italy (and San Marino / Vatican, which share the code)
 *     is the one country whose national numbers KEEP their leading 0 in
 *     E.164 — +39 06 6982 is the Vatican switchboard, not a typo.
 *   • Exactly one 0 is removed, and only from an otherwise all-digit local
 *     part, so a half-typed number is never rewritten under the user.
 *
 *   +31-023-7993800   -> +31237993800   (after stripTelScheme)
 *   00310237993800    -> 0031237993800
 *   +310237993800@d   -> +31237993800@d
 *   +31237993800      -> unchanged (already correct)
 *   +390212345678     -> unchanged (Italy keeps its trunk 0)
 *   0612345678        -> unchanged (national form; the replaceLeadingZero
 *                                   rule in Call.js owns that case)
 */
/**
 * Recover the canonical E.164 form of a PSTN number from the WIRE form the
 * dialing rules produce — the inverse of the replaceLeadingZero /
 * replacePlus rewrites Call.js applies at the SIP boundary.
 *
 * Both rules funnel into the same shape: the number leaves as
 * <international-access-code><country-code><subscriber>, e.g. '+31612345678'
 * -> '0031612345678' (replacePlus '00') and '0612345678' ->
 * '0031612345678' (replaceLeadingZero '0031'). So one inverse covers both:
 * swap a leading access code back for '+'.
 *
 * Needed because call.remoteIdentity.uri carries the WIRE form — that is what
 * was actually dialed — while CallKit writes its handle into the iOS Recents
 * list, where '0031612345678' reads as a foreign string and does not match
 * the user's own contact cards. E.164 is what iOS expects there.
 *
 * The configured code (rules.replacePlus) is tried first, then a plain '00'
 * fallback: '00' is the ITU international prefix, so a number stored
 * nationally as '0031…' converts correctly even for accounts whose
 * replacePlus is something else (e.g. the North-American '011').
 *
 * A local part that is already '+…', or that is not all digits, is returned
 * untouched — as is a national number with no recoverable country code
 * ('0612345678' stays as it is, because guessing a country would be wrong).
 */
/**
 * Clean a dialable destination that arrived from OUTSIDE the app — an OS call
 * intent's contact handle, a tel: link, a QR payload — WITHOUT appending a
 * domain.
 *
 * Address books and web pages store numbers with the visual separators people
 * read by: '+31 6 41 37 29 60', '(023) 799-3800', '+1-313-1313'. Those cannot
 * travel any further: they break the URI field's contact matching and are not
 * valid in a SIP request-URI.
 *
 * normalizeUri collapses the same separators, but it also appends the default
 * domain — wrong for the URI field, where an external tel: link shows a bare
 * number and a Contacts-card tap should look identical. Hence this narrower
 * cousin: unwrap tel:, collapse separators when the value is a phone number,
 * and stop there.
 */
function cleanDialHandle(uri) {
    if (typeof uri !== 'string') {
        return uri;
    }
    const value = stripTelScheme(uri).trim();
    const atIdx = value.indexOf('@');
    const localPart = atIdx > -1 ? value.substring(0, atIdx) : value;
    const domainPart = atIdx > -1 ? value.substring(atIdx) : '';

    // Same collapse-then-test rule as normalizeUri, shared so the two can
    // never drift. When the collapsed form is not a number the original is
    // returned verbatim: 'bob smith' must not become 'bobsmith'.
    const collapsed = collapsedPhoneNumber(localPart);
    return collapsed !== null ? collapsed + domainPart : value;
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

/* Split the address shape check into a strict ASCII form for SIP URIs and a
 * Unicode-tolerant form for real email addresses. These are two different
 * grammars and conflating them was wrong in both directions:
 *
 *   - A SIP address is an ASCII protocol identifier. It travels in REGISTER /
 *     INVITE headers, in XCAP addressbook documents and in SQL contact keys,
 *     none of which round-trip non-ASCII reliably. "андрей@sylk.link" must be
 *     refused at the point the user types it.
 *   - An email address MAY be internationalized (RFC 6531 / EAI). Refusing
 *     "андрей@почта.рф" in the contact's Email field is simply a bug — that
 *     field is metadata, not a routing key.
 *
 * BOTH keep the linear, non-backtracking structure introduced when the old
 * single regex /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/ was replaced: the
 * OPTIONAL separator in ([\.-]?\w+)* makes it behave like (\w+)*, which is
 * exponential and, on Hermes, threw "Maximum regex stack depth reached" for
 * some contact values — aborting the whole addressbook migration. Each group
 * here is REQUIRED to consume a separator, so matching stays linear. Neither
 * uses \p{...} property escapes, which are not dependable on Hermes; the
 * "any non-ASCII" range \u0080-\uffff is used instead.
 */

// Strict ASCII. This is the SIP-address rule — sanitizeContact and the
// add/edit contact address fields gate on it.
function isSipAddress(uri) {
    if (typeof uri !== 'string') return false;
    uri = uri.trim().toLowerCase();
    if (uri.length === 0 || uri.length > 254) return false;
    const at = uri.indexOf('@');
    if (at <= 0 || at !== uri.lastIndexOf('@')) return false; // exactly one '@', not leading
    const local = uri.slice(0, at);
    const domain = uri.slice(at + 1);
    const localRe  = /^\w+(?:[.-]\w+)*$/;          // linear: each group consumes a separator
    const domainRe = /^\w+(?:[.-]\w+)*\.[a-z]{2,}$/; // labels + a 2+ letter TLD
    return localRe.test(local) && domainRe.test(domain);
}

// Unicode-tolerant (EAI). This is the EMAIL-FIELD rule — it accepts every
// address isSipAddress does, plus internationalized local parts, domain
// labels and TLDs. Do NOT use it to validate a SIP URI.
function isEmailAddress(uri) {
    if (typeof uri !== 'string') return false;
    uri = uri.trim().toLowerCase();
    if (uri.length === 0 || uri.length > 254) return false;
    const at = uri.indexOf('@');
    if (at <= 0 || at !== uri.lastIndexOf('@')) return false; // exactly one '@', not leading
    const local = uri.slice(0, at);
    const domain = uri.slice(at + 1);
    // Same shape as isSipAddress, with the word class widened to include any
    // non-ASCII code point and the TLD allowed to be non-ASCII too (.рф, .中国).
    const localRe  = /^[0-9a-z_\u0080-\uffff]+(?:[.-][0-9a-z_\u0080-\uffff]+)*$/;
    const domainRe = /^[0-9a-z_\u0080-\uffff]+(?:[.-][0-9a-z_\u0080-\uffff]+)*\.[a-z\u0080-\uffff]{2,}$/;
    return localRe.test(local) && domainRe.test(domain);
}

/* The accept rule for an address a USER typed into the Add/Edit contact
 * address field, mirroring app.js sanitizeContact() so a modal can never
 * submit something the sanitizer will refuse. sanitizeContact returns null
 * for a rejected URI, newContact() propagates that null, and the save path
 * then crashes on it -- the 8.3.5 "Cannot set property 'uri' of null".
 * app.js guards that dereference now, but the modals gate their Save button
 * on THIS so a typo is visible before the tap rather than swallowed.
 *
 * Deliberately ASCII-only for the address itself (via isSipAddress). The
 * contact's Email field and Display name are separate and DO accept
 * Cyrillic and other non-ASCII text.
 *
 * Keep in sync with sanitizeContact's accept set, in the same order.
 */
function isUsableContactAddress(value, defaultDomain) {
    const v = (value || '').trim().toLowerCase();
    if (!v) return false;
    if (isPhoneNumber(v)) return true;
    const call = parseSylkCallUrl(v);
    const c = call ? String(call).toLowerCase() : v;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return true;
    if (c.split('@')[0] === '*') return true;
    const qualified = c.indexOf('@') === -1 ? c + '@' + (defaultDomain || '') : c;
    if (isSipAddress(qualified)) return true;
    return !!parseSylkConferenceUrl(c);
}

function isImage(filename, filetype=null) {
     //console.log('isImage', filename, filetype);

    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('image/')) {
        return true
    }

    if (filename.toLowerCase().endsWith('.png')) {
        return true
    } else if (filename.toLowerCase().endsWith('.jpg')) {
        return true
    } else if (filename.toLowerCase().endsWith('.jpeg')) {
        return true
    } else if (filename.toLowerCase().endsWith('.gif')) {
        return true
    } else if (filename.toLowerCase().endsWith('.tiff')) {
        return true
    } else if (filename.toLowerCase().endsWith('.tif')) {
        return true
    }

    return false;
}

function isAudio(filename, filetype=null) {
    //console.log('isAudio', filename, filetype);
    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('audio/')) {
        return true
    }

    // File-extension fallback (used when no MIME type is available).
    // Cover the common audio containers — extending the original list
    // (.mp3/.opus/.wav) with the formats users actually receive: .m4a
    // (AAC in MOV-style container, the iOS-friendly transcode target),
    // .aac (raw AAC), .flac, .ogg, and .oga.
    const lower = filename.toLowerCase();
    const audioExts = ['.mp3', '.opus', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga'];
    for (const ext of audioExts) {
        if (lower.endsWith(ext)) return true;
    }

    if (lower.startsWith('sylk-audio-recording')) {
        return true;
    }

    return false;
}

function isVideo(filename, filetype=null) {
    //console.log('isVideo', filename, filetype);
    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('video/')) {
        return true
    }
    
    if (filename.toLowerCase().endsWith('.mpeg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mp4')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.webm')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.ogg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mpg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mov')) {
        return true;
    }
    
    return false;
}

function titleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function beautySize(fsize) {
    let size = fsize + " B";
    if (fsize > 1024 * 1024 * 1024) {
        size = Math.ceil(fsize/1024/1024/1024) + " GB";
    } else if (fsize > 1024 * 1024) {
        size = Math.ceil(fsize/1024/1024) + " MB";
    } else if (fsize < 1024 * 1024) {
        size = Math.ceil(fsize/1024) + " KB";
    }
    return size;
}


/* OpenPGP radix-64/base64 string encoding/decoding
 * Copyright 2005 Herbert Hanewinkel, www.haneWIN.de
 * version 1.0, check www.haneWIN.de for the latest version
 *
 * This software is provided as-is, without express or implied warranty.
 * Permission to use, copy, modify, distribute or sell this software, with or
 * without fee, for any purpose and by any individual or organization, is hereby
 * granted, provided that the above copyright notice and this paragraph appear
 * in all copies. Distribution as a part of an application or binary must
 * include the above copyright notice in the documentation and/or other materials
 * provided with the application or distribution.
 */

var b64s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function radix64(t) {
	var a, c, n;
	var r = '', l = 0, s = 0;
	var tl = t.length;

	for (n = 0; n < tl; n++) {
		c = t.charCodeAt(n);
		if (s == 0) {
			r += b64s.charAt((c >> 2) & 63);
			a = (c & 3) << 4;
		} else if (s == 1) {
			r += b64s.charAt((a | (c >> 4) & 15));
			a = (c & 15) << 2;
		} else if (s == 2) {
			r += b64s.charAt(a | ((c >> 6) & 3));
			l += 1;
			if ((l % 60) == 0)
				r += "\n";
			r += b64s.charAt(c & 63);
		}
		l += 1;
		if ((l % 60) == 0)
			r += "\n";

		s += 1;
		if (s == 3)
			s = 0;
	}
	if (s > 0) {
		r += b64s.charAt(a);
		l += 1;
		if ((l % 60) == 0)
			r += "\n";
		r += '=';
		l += 1;
	}
	if (s == 1) {
		if ((l % 60) == 0)
			r += "\n";
		r += '=';
	}

	return r;
}

// maxSize is the user-configurable ceiling (Preferences → File Encryption).
// Falls back to the built-in default when not provided or invalid. Applies to
// videos too: a clip compressed under the limit is encrypted like any other
// attachment; only larger files are sent in the clear.
function isFileEncryptable(file_transfer, maxSize) {
    try {
		const limit = (typeof maxSize === 'number' && maxSize > 0)
		    ? maxSize
		    : ENCRYPTABLE_FILE_SIZE;
		if (file_transfer.filesize > limit) {
			return false;
		}
    } catch (e) {
		console.log('isFileEncryptable e', e)
    }

    return true;
}


function base64ToArrayBuffer(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Calculates a checksum over the given data and returns it base64 encoded
 * @param data [String] data to create a CRC-24 checksum for
 * @return [String] base64 encoded checksum
 * http://www.faqs.org/rfcs/rfc4880.html
 */

function getPGPCheckSum(base64_content) {
        let buffer = base64ToArrayBuffer(base64_content);
        let crc24 = polycrc.crc24;
        let checksum = crc24(buffer);

        var str = "" + String.fromCharCode(checksum >> 16)+
                                   String.fromCharCode((checksum >> 8) & 0xFF)+
                                   String.fromCharCode(checksum & 0xFF);
        return radix64(str);
}

// ---- Streaming OpenPGP CRC-24 (for chunked armoring) ----------------------
// Same model as polycrc.crc24 (width 24, poly 0x864CFB, init 0xB704CE, no
// reflection) but folded incrementally so an armored message can be built
// chunk-by-chunk without ever holding the whole file in memory. Verified
// byte-identical to getPGPCheckSum's one-shot result. Table-driven for speed
// (one lookup per byte instead of 8 bit-iterations).
let _crc24Table = null;
function _crc24BuildTable() {
    const t = new Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n << 16;
        for (let k = 0; k < 8; k++) {
            c <<= 1;
            if (c & 0x1000000) c ^= 0x1864CFB;
        }
        t[n] = c & 0xFFFFFF;
    }
    return t;
}
function crc24Init() {
    return 0xB704CE;
}
// Fold the raw bytes represented by a base64 chunk into the running CRC.
// Decodes the chunk with the same atob path base64ToArrayBuffer uses.
function crc24UpdateFromBase64(crc, base64) {
    if (!_crc24Table) _crc24Table = _crc24BuildTable();
    const bin = atob(base64);
    for (let i = 0; i < bin.length; i++) {
        crc = ((crc << 8) ^ _crc24Table[((crc >> 16) ^ bin.charCodeAt(i)) & 0xFF]) & 0xFFFFFF;
    }
    return crc;
}
// Final 24-bit CRC -> 4-char radix64 checksum (same encoding as getPGPCheckSum).
function crc24Checksum(crc) {
    const str = String.fromCharCode((crc >> 16) & 0xFF)
              + String.fromCharCode((crc >> 8) & 0xFF)
              + String.fromCharCode(crc & 0xFF);
    return radix64(str);
}


async function listAllFilesRecursive(path, level = 0) {
  let totalSize = 0;

  try {
    const items = await RNFS.readDir(path);

    for (const item of items) {
      if (item.isFile()) {
        //console.log(`${'  '.repeat(level)}File: ${item.name} - ${item.size} bytes`);
        totalSize += item.size;
      } else if (item.isDirectory()) {
        //console.log(`${'  '.repeat(level)}Directory: ${item.name}`);
        const dirSize = await listAllFilesRecursive(item.path, level + 1);
        console.log(`${'     '.repeat(level + 1)}[Directory ${item.path} total size: ${dirSize} bytes]`);
        totalSize += dirSize;
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${path}:`, err);
  }

  return totalSize;
}

/**
 * Returns a list of { remote_party, size, prettySize } sorted by folder size (desc),
 * including a synthetic 'all' entry with the total size of all remote_party folders.
 * @param {string} accountId
 * @returns {Promise<Array<{ remote_party: string, size: number, prettySize: string }>>}
 */
 

async function getRemotePartySizes(accountId, uri) {
  const accountPath = `${RNFS.DocumentDirectoryPath}/${accountId}`;
  let remoteParties = [];
  try {
	const remoteParties = await RNFS.readDir(accountPath);
    const results = [];
    let totalSize = 0;

    for (const item of remoteParties) {
      if (item.isDirectory()) {
        const remoteParty = item.name;
        if (uri && remoteParty != uri) {
			continue;
        }
        const remotePartyPath = item.path;
        const size = await getFolderSize(remotePartyPath, false);
        const dirs = await getDirs(remotePartyPath);
        //console.log('Space used for', item.name, '->', beautySize(size), 'dirs', dirs.length);
        //listAllFilesRecursive(item.path);        
        totalSize += size;
        results.push({
          remote_party: remoteParty,
          size,
          dirs,
           prettySize: formatBytes(size),
        });
      }
    }

    // Sort descending by size
    results.sort((a, b) => b.size - a.size);

    // Add synthetic 'all' entry at the top
    results.unshift({
      remote_party: 'all',
      size: totalSize,
      prettySize: formatBytes(totalSize),
    });

    return results;
  } catch (error) {
    //console.log('No remote parties:', error);
    return [];
  }
}

/**
 * Recursively calculates the total size of a folder in bytes.
 */
async function getFolderSize(folderPath, log=false) {
  let totalSize = 0;
  let dirSize = 0;
  try {
    // Probe existence first — a missing folder is an expected case for
    // callers tallying file-transfer disk usage (the folder may have been
    // cleaned up already). Skip silently so we don't spam the logs with
    // "doesn't exist" errors for rows the caller already tolerates.
    const exists = await RNFS.exists(folderPath);
    if (!exists) return 0;

    const items = await RNFS.readDir(folderPath);
    // Per-file/per-folder scan logging removed — it spammed the log on every
    // file-transfer disk-usage tally. The `log` param is kept for signature
    // compatibility but no longer emits anything.
    for (const item of items) {
      if (item.isFile()) {
        totalSize += Number(item.size);
      } else if (item.isDirectory()) {
		dirSize = await getFolderSize(item.path, log);
        totalSize += dirSize;
      }
    }
  } catch (error) {
    // Still log unexpected errors (permission denied, I/O faults, etc.)
    const msg = error && (error.message || String(error));
    if (msg && /doesn't exist|ENOENT|No such file/i.test(msg)) {
      // swallow — expected for already-cleaned folders
    } else {
      console.error(`Error calculating size for ${folderPath}:`, error);
    }
  }
  return totalSize;
}

async function getDirs(folderPath) {
  let dirs = [];
  try {
    const items = await RNFS.readDir(folderPath);
    for (const item of items) {
      if (item.isDirectory()) {
        dirs.push(item.name);
      }
    }
  } catch (error) {
    console.error(`Error getting dirs for ${folderPath}:`, error);
  }
  return dirs;
}

/**
 * Converts bytes to a human-readable string (B, KB, MB, GB, TB).
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = Math.ceil(bytes / Math.pow(k, i));
  return `${value} ${sizes[i]}`;
}

function getErrorMessage(error) {
  if (typeof error === 'string') {
    // error is a plain string
    return error;
  } else if (error && typeof error === 'object') {
    // error is an object
    const message = error.error || 'Unknown error';
    if (error.errorCode == 404) {
       return 'File not found';
    } else if (error.errorCode !== undefined) {
      return `${message} (${error.errorCode})`;
    }

    return message;
  } else {
    // fallback if error is null or some other type
    return 'Unknown error';
  }
}


function formatPGPMessage(pgpMessage, lineLength = 64) {
	// Split the message into lines if it already has them
	const lines = pgpMessage.split(/\r?\n/).filter(line => line.trim() !== '');

	// Keep the header and footer intact
	const beginMarker = '-----BEGIN PGP MESSAGE-----';
	const endMarker = '-----END PGP MESSAGE-----';
	const header = lines[0] === beginMarker ? lines.shift() : '';
	const footer = lines[lines.length - 1] === endMarker ? lines.pop() : '';

	// Join the remaining content into a single string
	const body = lines.join('').replace(/\r?\n/g, '');

	// Break the body into chunks of lineLength
	const formattedBody = body.match(new RegExp(`.{1,${lineLength}}`, 'g')).join('\n');

	// Reconstruct the message
	return [header, formattedBody, footer].filter(Boolean).join('\n');
}

async function fileChecksum(filePath) {
  try {
    // Read file as base64 string
    const fileBase64 = await RNFS.readFile(filePath, 'base64');
    
    // Convert base64 to WordArray for CryptoJS
    const wordArray = CryptoJS.enc.Base64.parse(fileBase64);
    
    // Compute hash (choose MD5, SHA1, SHA256, etc.)
    const checksum = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    
    console.log('SHA256 Checksum:', checksum);
    return checksum;
  } catch (err) {
    console.error('Error calculating checksum:', err);
    return null;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;

  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (let key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

const availableAudioDevicesIconsMap = {
	BUILTIN_EARPIECE: 'phone-in-talk',
	WIRED_HEADSET: 'headphones',
	USB_HEADSET: 'headphones',
	BLUETOOTH_SCO: 'bluetooth-audio',
	BUILTIN_SPEAKER: 'volume-high',
};

const availableAudioDeviceNames = {
	BUILTIN_EARPIECE: 'Earpiece',
	WIRED_HEADSET: 'Wired headset',
	USB_HEADSET: 'USB headset',
	BLUETOOTH_SCO: 'Bluetooth',
	BUILTIN_SPEAKER: 'Speaker',
};

// --- Current INPUT (microphone) device ---------------------------------
// The app never tracks a "selected input" of its own — on both platforms
// the active mic follows whatever output route is selected (BT route → BT
// mic, wired route → headset mic, earpiece/speaker → built-in mic). So we
// derive the active mic from the selected route type rather than from a
// separate selection.

// Selected output route type → the mic type that route uses.
const inputTypeForRoute = {
	BUILTIN_EARPIECE: 'BUILTIN_MIC',
	BUILTIN_SPEAKER:  'BUILTIN_MIC',
	WIRED_HEADSET:    'WIRED_HEADSET',
	USB_HEADSET:      'USB_HEADSET',
	BLUETOOTH_SCO:    'BLUETOOTH_SCO',
};

// Friendly fallback labels per mic type. Used when the native input list
// doesn't carry a usable product name (e.g. Android skips the BT mic in
// getAudioInputs(), and the built-in mic's productName is just the phone
// model, which we'd rather not show).
const inputDeviceNames = {
	BUILTIN_MIC:    'Built-in microphone',
	WIRED_HEADSET:  'Wired headset mic',
	USB_HEADSET:    'USB headset mic',
	BLUETOOTH_SCO:  'Bluetooth mic',
};

const inputDeviceIconsMap = {
	BUILTIN_MIC:    'microphone',
	WIRED_HEADSET:  'headphones',
	USB_HEADSET:    'headphones',
	BLUETOOTH_SCO:  'bluetooth-audio',
};

// Resolve the currently-active microphone for display.
//   selectedRoute: the selected output route type (this.state.selectedAudioDevice)
//   audioInputs:   native input list [{type, name, id}, ...] (this.state.audioInputs)
// Returns {type, name, icon}. For headset routes we prefer the real device
// name reported by the native input list (e.g. "AirPods Pro"); for the
// built-in mic we keep the friendly label.
function getActiveInputDevice(selectedRoute, audioInputs) {
	const micType = inputTypeForRoute[selectedRoute] || 'BUILTIN_MIC';
	let name = inputDeviceNames[micType] || 'Microphone';

	if (micType !== 'BUILTIN_MIC' && Array.isArray(audioInputs)) {
		const match = audioInputs.find(d => d && d.type === micType);
		if (match && match.name && match.name !== 'UNKNOWN') {
			name = match.name;
		}
	}

	return { type: micType, name: name, icon: inputDeviceIconsMap[micType] || 'microphone' };
}

// Pick the active microphone when there's NO call route to follow — e.g.
// while recording a voice message. Without an explicit route, both
// platforms route mic capture to a connected headset over the built-in
// mic, so we pick the highest-priority connected input from the native
// input list (AudioRouteModule.getAudioInputs()). For headsets we prefer
// the real reported device name; for the built-in mic we keep the
// friendly label. Returns {type, name, icon}.
function pickActiveInputFromList(audioInputs) {
	if (!Array.isArray(audioInputs) || audioInputs.length === 0) {
		return {
			type: 'BUILTIN_MIC',
			name: inputDeviceNames.BUILTIN_MIC,
			icon: inputDeviceIconsMap.BUILTIN_MIC,
		};
	}

	const priority = ['BLUETOOTH_SCO', 'USB_HEADSET', 'WIRED_HEADSET', 'BUILTIN_MIC'];
	let best = null;
	for (let i = 0; i < priority.length; i++) {
		best = audioInputs.find(d => d && d.type === priority[i]);
		if (best) break;
	}
	if (!best) best = audioInputs[0];

	const type = best.type || 'BUILTIN_MIC';
	let name = inputDeviceNames[type] || best.name || 'Microphone';
	if (type !== 'BUILTIN_MIC' && best.name && best.name !== 'UNKNOWN') {
		name = best.name;
	}

	return { type: type, name: name, icon: inputDeviceIconsMap[type] || 'microphone' };
}
                    
// URL detection used by the persisted `has_link` column and the
// runtime Links chip JS post-filter. Single source of truth so a
// change to the URL definition lights up both places. Matches:
//   • http(s)://… (with non-whitespace tail)
//   • www.… (bare-www domains people paste informally)
//   • bare-domain `<word>.<common TLD>(/path)?` — conservative
//     TLD list to avoid flagging "file.txt" or "v1.2" as a link.
// Tested against text/plain and the rendered text of text/html
// bodies (URLs survive linkifyHtml + utils.html2text). Run on the
// concat of the body + html so HTML bodies whose plaintext flatten
// happens to drop scheme prefixes still match.
const _URL_REGEX = /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|co|dev|me|gov|edu|info|ai|xyz)(?:\/\S*)?)/i;
function containsUrl(text, html) {
    const body = ((text || '') + ' ' + (html || '')).trim();
    if (!body) return false;
    return _URL_REGEX.test(body);
}

// Date-period tags for the chat date filter. Returns a stable
// identifier per period plus a human-readable label suited for
// display in a horizontal tag scroller. Used by ContactsListBox to:
//   • compute available periods from the visible messages
//   • compare a message's tag against the user-selected tag
//
// `id` is what gets compared / stored; `label` is what the user
// sees. Two messages on the same calendar day share day.id; the
// week id uses the ISO-8601 week number so Mon-of-week-21 and
// Sun-of-week-21 collapse to the same tag.
function getMessageDateTags(date) {
    if (!(date instanceof Date)) {
        try { date = new Date(date); } catch (e) { return null; }
    }
    if (!date || isNaN(date.getTime())) return null;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    // ISO 8601 week number. Algorithm: shift to the Thursday of the
    // current week (ISO weeks are defined by their Thursday), then
    // count weeks from Jan 1.
    const tmp = new Date(Date.UTC(yyyy, date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    const isoYear = tmp.getUTCFullYear();
    const monthShort = date.toLocaleString('default', { month: 'short' });
    return {
        day:   { id: `${yyyy}-${mm}-${dd}`,
                 label: `${parseInt(dd, 10)} ${monthShort} ${yyyy}`,
                 sortKey: date.getTime() },
        week:  { id: `${isoYear}-W${String(weekNum).padStart(2, '0')}`,
                 label: `Week ${weekNum}, ${isoYear}`,
                 sortKey: tmp.getTime() },
        month: { id: `${yyyy}-${mm}`,
                 label: `${monthShort} ${yyyy}`,
                 sortKey: new Date(yyyy, date.getMonth(), 1).getTime() },
        year:  { id: `${yyyy}`,
                 label: `${yyyy}`,
                 sortKey: new Date(yyyy, 0, 1).getTime() },
    };
}

exports.getMessageDateTags = getMessageDateTags;
exports.containsUrl = containsUrl;
exports.formatPGPMessage = formatPGPMessage;
exports.getErrorMessage = getErrorMessage;
exports.formatBytes = formatBytes;
exports.getRemotePartySizes = getRemotePartySizes;
exports.getPartialDownloadPath = getPartialDownloadPath;
exports.copyToClipboard = copyToClipboard;
exports.normalizeUri = normalizeUri;
exports.generateSillyName = generateSillyName;
exports.timestampedLog = timestampedLog;
exports.log2file = log2file;
exports.appendLeadingZeroes = appendLeadingZeroes;
exports.generateUniqueId = generateUniqueId;
exports.generateMaterialColor = generateMaterialColor;
exports.generateVideoTrack = generateVideoTrack;
exports.getWindowHeight = getWindowHeight;
exports.findContact = findContact;
exports.sylk2GiftedChat = sylk2GiftedChat;
exports.fixLocalUrl = fixLocalUrl;
exports.resolveLocalUrl = resolveLocalUrl;
exports.sql2GiftedChat = sql2GiftedChat;
exports.isAnonymous = isAnonymous;
exports.normalizeAnonymousUri = normalizeAnonymousUri;
exports.html2text = html2text;
exports.isEmailAddress = isEmailAddress;
exports.isSipAddress = isSipAddress;
exports.isUsableContactAddress = isUsableContactAddress;
exports.isPhoneNumber = isPhoneNumber;
exports.stripTelScheme = stripTelScheme;
exports.stripTrunkZeroAfterCountryCode = stripTrunkZeroAfterCountryCode;
exports.pstnWireUriToE164 = pstnWireUriToE164;
exports.cleanDialHandle = cleanDialHandle;
exports.collapsedPhoneNumber = collapsedPhoneNumber;
exports.phoneAvatarLabel = phoneAvatarLabel;
exports.isImage = isImage;
exports.isAudio = isAudio;
exports.isVideo = isVideo;
exports.titleCase = titleCase;
exports.beautyFileNameForBubble = beautyFileNameForBubble;
exports.beautySize = beautySize;
exports.HUGE_FILE_SIZE = HUGE_FILE_SIZE;
exports.getPGPCheckSum = getPGPCheckSum;
exports.isFileEncryptable = isFileEncryptable;
exports.crc24Init = crc24Init;
exports.crc24UpdateFromBase64 = crc24UpdateFromBase64;
exports.crc24Checksum = crc24Checksum;
exports.fileChecksum = fileChecksum;
exports.deepEqual = deepEqual;
exports.availableAudioDevicesIconsMap = availableAudioDevicesIconsMap;
exports.availableAudioDeviceNames = availableAudioDeviceNames;
exports.inputDeviceNames = inputDeviceNames;
exports.inputDeviceIconsMap = inputDeviceIconsMap;
exports.getActiveInputDevice = getActiveInputDevice;
exports.pickActiveInputFromList = pickActiveInputFromList;
exports.getFolderSize = getFolderSize;
exports.cleanHtml = cleanHtml;
exports.parseSylkConferenceUrl = parseSylkConferenceUrl;
exports.parseSylkCallUrl = parseSylkCallUrl;
exports.parseSharedLocationUrl = parseSharedLocationUrl;
exports.extractLocationLink = extractLocationLink;
exports.resolveShortLocationUrl = resolveShortLocationUrl;
exports.extractQueryAddress = extractQueryAddress;
exports.geocodeAddress = geocodeAddress;
exports.setLogAccount = setLogAccount;
exports.getLogfilePath = getLogfilePath;
exports.getDeletionAuditPath = getDeletionAuditPath;
exports.auditContactDeletion = auditContactDeletion;
exports.readDeletionAudit = readDeletionAudit;





// --- anonymizeEmails — stable email scrubber (moved from anonymizeEmails.js) ---
// Replaces every user@domain literal with a stable random@random substitute.
// Each unique original maps to ONE substitute for the whole export so the text
// still reads coherently. Used by the support-log share flow (LogsModal) and
// the automatic ANR/crash reporter (appExitReporter).
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function _fakeUserFor(idx) {
    const group = Math.floor(idx / 2) + 1;
    const baseName = idx % 2 === 0 ? 'alice' : 'bob';
    return group === 1 ? baseName : `${baseName}${group}`;
}

function anonymizeEmails(text) {
    if (!text) return text;
    const emailMap = new Map();
    const domainMap = new Map();
    let userIdx = 0;
    let domainIdx = 0;
    return text.replace(EMAIL_RE, (orig) => {
        if (emailMap.has(orig)) return emailMap.get(orig);
        const fakeUser = _fakeUserFor(userIdx++);
        const at = orig.indexOf('@');
        const origDomain = orig.slice(at + 1);
        let fakeDomain = domainMap.get(origDomain);
        if (!fakeDomain) {
            domainIdx++;
            fakeDomain = `example${domainIdx}.com`;
            domainMap.set(origDomain, fakeDomain);
        }
        const fake = `${fakeUser}@${fakeDomain}`;
        emailMap.set(orig, fake);
        return fake;
    });
}

exports.anonymizeEmails = anonymizeEmails;


// --- h264ProfileLevelName — decode RFC 6184 profile-level-id ---
// Turns the cryptic 6-hex-digit H.264 profile-level-id from SDP into
// a human-readable "<Profile> <Level>" string:
//
//   42001f → "Baseline 3.1"
//   42e01f → "Constrained Baseline 3.1"
//   4d001f → "Main 3.1"
//   640c1f → "Constrained High 3.1"
//   64001f → "High 3.1"
//
// Layout (three bytes): profile_idc | profile-iop (constraint flags
// constraint_set0..5 in the top bits) | level_idc. The profile is
// picked from profile_idc + the constraint flags using the same
// patterns libwebrtc applies in h264_profile_level_id.cc — this is
// why 4200 (Baseline) and 42e0 (Constrained Baseline) are DIFFERENT
// profiles to the negotiator even though they look almost identical:
// libwebrtc requires an exact profile match, so a device that only
// decodes Constrained Baseline rejects a plain Baseline offer.
// The level is level_idc/10 ("1f" = 31 → 3.1), with the special
// "level 1b" case (level_idc 11 + constraint_set3, or legacy 9).
// Returns null for anything unrecognised — callers show the raw hex.
function h264ProfileLevelName(hex) {
    try {
        if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
        const profileIdc = parseInt(hex.slice(0, 2), 16);
        const iop = parseInt(hex.slice(2, 4), 16);   // constraint flags
        const levelIdc = parseInt(hex.slice(4, 6), 16);
        let profile = null;
        switch (profileIdc) {
            case 0x42:  // Baseline family — constraint_set1 ⇒ Constrained
                profile = (iop & 0x40) ? 'Constrained Baseline' : 'Baseline';
                break;
            case 0x4d:  // Main family — constraint_set0 ⇒ also CB-compatible
                profile = (iop & 0x80) ? 'Constrained Baseline' : 'Main';
                break;
            case 0x58:  // Extended family
                profile = (iop & 0x80)
                    ? ((iop & 0x40) ? 'Constrained Baseline' : 'Baseline')
                    : 'Extended';
                break;
            case 0x64:  // High family — iop 0x0c ⇒ Constrained High
                profile = (iop === 0x0c) ? 'Constrained High' : 'High';
                break;
            case 0x6e: profile = 'High 10'; break;
            case 0x7a: profile = 'High 4:2:2'; break;
            case 0xf4: profile = 'High 4:4:4'; break;
            default: return null;
        }
        let level;
        if (levelIdc === 9 || (levelIdc === 11 && (iop & 0x10))) {
            level = '1b';
        } else {
            level = (levelIdc / 10).toFixed(1);
        }
        return profile + ' ' + level;
    } catch (e) {
        return null;
    }
}

exports.h264ProfileLevelName = h264ProfileLevelName;
