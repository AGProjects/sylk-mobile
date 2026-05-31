// CallZrtp.js
//
// Per-call ZRTP-style E2EE handshake state machine
// Sends a PGP-wrapped X25519 key-exchange over the in-dialog session-message
// channel (sylkrtc Call.sendMessage) and logs every step. Does NOT install
// any keys on RTCRtpSender yet; that's a later step once the native bridge
// exists. The point of this module right now is to validate that:
//   * call.sendMessage delivers reliably between the two devices on the call
//   * PGP wrap/unwrap of the JSON envelope round-trips
//   * Both sides derive the SAME shared secret + HKDF keys (logged in hex)
//
// If the two log lines "ECDH shared secret hex: ..." match between caller
// and callee, the messaging + cryptography works end-to-end and we can
// proceed to writing the native FrameEncryptor bridge with confidence.

import 'react-native-get-random-values';      // polyfills crypto.getRandomValues so tweetnacl can seed itself
import nacl from 'tweetnacl';
import CryptoJS from 'crypto-js';
import OpenPGP from 'react-native-fast-openpgp';   // v3 signed-handshake: detached PGP sign + verify
import utils from '../utils';                  // timestampedLog() for [call] [zrtp] lines that should also reach the in-app Show Logs viewer

export const ZRTP_CONTENT_TYPE = 'application/sylk-zrtp-negotiation';
// Highest wire version we speak.
//   v1 — original protocol (no continuity, no signatures).
//   v2 — adds rs_id_hex to probe/accept for RFC 6189-style continuity.
//   v3 — adds detached PGP signatures on probe/accept payloads.
// Older peers stay interoperable; negotiated version is min-pinned per
// session, so a v3 mobile talking to a v1 peer behaves like v1.
const VERSION = 3;
const LOCAL_SUITES = ['AES-128-GCM'];
// SHA-256(rs1)[:8] hex-encoded = 16 hex chars.
const RS_ID_HEX_LEN = 16;
const RS_BYTES = 32;

// SIP header advertising that the caller supports the Sylk-flavoured
// ZRTP-over-in-dialog-MESSAGE negotiation, with the suite list. Caller
// puts this on the outgoing INVITE; the callee's app receives it via
// Call.headers (sylkrtc forwards SIP custom headers verbatim) and can
// decide whether to expect a probe and whether to display a "peer
// supports E2EE" hint before the handshake even starts.
//
// Value grammar — RFC 3261 parameter list:
//   v       = protocol version we'll speak (currently 1)
//   suites  = comma-separated list of AEAD suites we support
//
// Future versions can advertise multiple v= values ("v=1,2") or add
// other params (kex=x25519, etc.) without breaking existing peers; the
// receiver only acts on parameters it recognises.
export const ZRTP_CAPABILITY_HEADER_NAME  = 'X-Sylk-ZRTP';
export const ZRTP_CAPABILITY_HEADER_VALUE = 'v=' + VERSION + '; suites=AES-128-GCM';

// True if the current Sylk encryption mode is one that will actually
// run the handshake. 'sdes' means the user explicitly opted out of
// E2EE — sending X-Sylk-ZRTP in that case would be a lie. Used by
// Call.js to decide whether to put the capability header on outgoing
// INVITEs (and, on the callee path, on the 200 OK acceptance).
export function shouldAdvertiseZrtpCapability() {
    return _encryptionMode === 'zrtp_optional' || _encryptionMode === 'zrtp_mandatory';
}

// Parse an X-Sylk-ZRTP value string ('v=1; suites=AES-128-GCM,…') into
// {version: int, suites: [str,…]} or null if not parseable. Tolerant of
// extra whitespace and unknown params — only 'v' and 'suites' are read
// so future params can be added without breaking older parsers.
export function parseZrtpCapability(value) {
    if (!value || typeof value !== 'string') return null;
    let version = null;
    let suites = [];
    for (const part of value.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const name = trimmed.slice(0, eq).trim().toLowerCase();
        const val = trimmed.slice(eq + 1).trim();
        if (name === 'v') {
            const n = parseInt(val, 10);
            if (!isNaN(n)) version = n;
        } else if (name === 'suites') {
            suites = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
        }
    }
    if (version === null) return null;
    if (version < 1 || version > VERSION) return null;
    return { version, suites };
}

// Scan a headers payload — accepts either sylkrtc's {name,value}[] array
// (Call.headers) or a plain {name: value} object (some incoming event
// shapes) — and return parsed capability or null. Used both for the
// caller's INVITE headers (incoming-call side) and the callee's 200 OK
// headers (outgoing-call side, delivered on the 'stateChanged' event
// when state transitions to 'accepted').
export function peerSupportsZrtpFromHeaders(headers) {
    if (!headers) return null;
    let value = null;
    if (Array.isArray(headers)) {
        const found = headers.find(h => h && h.name === ZRTP_CAPABILITY_HEADER_NAME);
        if (found) value = found.value;
    } else if (typeof headers === 'object') {
        value = headers[ZRTP_CAPABILITY_HEADER_NAME];
    }
    return parseZrtpCapability(value);
}


// Video sender bitrate cap (kbps). Set once at app boot via
// setVideoMaxBitrateKbps(). Null = leave WebRTC's congestion control on
// its own (typically tries 1.5–2 Mbps for 480p+). Applied via
// RTCRtpSender.setParameters() on every call's video sender.
let _videoMaxBitrateKbps = null;

export function setVideoMaxBitrateKbps(kbps) {
    if (typeof kbps === 'number' && kbps > 0) {
        _videoMaxBitrateKbps = kbps;
    } else {
        _videoMaxBitrateKbps = null;
    }
}

// Encoder-side target resolution and framerate. The getUserMedia
// constraints are a HINT to the camera driver — react-native-webrtc on
// Android (Camera2) routinely returns a larger native mode when its
// preview-size selector can't find an exact match. e.g. with
// width:{max:640}+frameRate:{max:24} a Motorola razr will hand us its
// 1088x1088 / 30 fps "square selfie" mode and the peer sees 1088x1088
// over the wire. The encoder-side knobs below run AFTER the camera,
// inside libwebrtc, so they are a hard guarantee independent of
// whatever resolution the capture stage produced.
let _videoTargetWidth = null;
let _videoTargetHeight = null;
let _videoTargetFramerate = null;

export function setVideoEncoderTarget(width, height, framerate) {
    _videoTargetWidth     = (typeof width     === 'number' && width     > 0) ? width     : null;
    _videoTargetHeight    = (typeof height    === 'number' && height    > 0) ? height    : null;
    _videoTargetFramerate = (typeof framerate === 'number' && framerate > 0) ? framerate : null;
}

// Snapshot of the current encoder target, in the same shape app.js
// passes to setVideoEncoderTarget. Returned for the audio→video
// upgrade path in Call.js, which needs the same width/height/framerate
// to build getUserMedia constraints (so the camera capture side
// matches the profile applied by the initial-video path's
// getLocalMedia in app.js). Returning a snapshot rather than the live
// module-level lets, so callers can't accidentally mutate the source.
export function getVideoEncoderTarget() {
    return {
        width:     _videoTargetWidth,
        height:    _videoTargetHeight,
        frameRate: _videoTargetFramerate,
    };
}

// Encryption mode — set from Preferences → Encryption.
// One of:
//   'sdes'           — plain SRTP/DTLS only, no zRTP at all. Outgoing
//                       and incoming zRTP messages are ignored. The
//                       call's media is still encrypted between the
//                       device and the SylkServer relay (via DTLS-SRTP),
//                       but there's no end-to-end layer.
//   'zrtp_optional'  — DEFAULT. Run zRTP key exchange and install the
//                       FrameEncryptor when it succeeds. If the handshake
//                       times out or fails, the call continues without
//                       end-to-end encryption (over the SDES layer).
//   'zrtp_mandatory' — Run zRTP. If the handshake doesn't reach
//                       key-agreed within ZRTP_MANDATORY_TIMEOUT_MS,
//                       the call is terminated.
//
// Wired from app.js's _applyAccountSettings on login and from
// setAccountSetting() when the user changes the radio.
const ENCRYPTION_MODES = ['sdes', 'zrtp_optional', 'zrtp_mandatory'];
const ENCRYPTION_MODE_DEFAULT = 'zrtp_optional';
const ZRTP_MANDATORY_TIMEOUT_MS = 6000;

let _encryptionMode = ENCRYPTION_MODE_DEFAULT;

export function setEncryptionMode(mode) {
    if (ENCRYPTION_MODES.indexOf(mode) === -1) {
        utils.timestampedLog('[zrtp] setEncryptionMode: invalid mode', mode,
                    '— ignoring (recognized:', ENCRYPTION_MODES.join('/'), ')');
        return;
    }
    _encryptionMode = mode;
    utils.timestampedLog('[zrtp] encryption mode =', _encryptionMode);
}

export function getEncryptionMode() {
    return _encryptionMode;
}

// Transport for ZRTP negotiation messages. Two options:
//
//   'account' — sylkrtc Account.sendMessage(uri, content, ...).
//               This is the cross-account messaging path: the
//               envelope is delivered to ALL of the recipient's
//               registered devices (forking). Each device's incoming
//               handler filters out forks whose payload.call_id
//               doesn't match its own active call's. Survives mid-
//               handshake transport hiccups because account-messages
//               are queued by the messaging service. Default since
//               we switched away from session-message transport.
//
//   'call'    — sylkrtc Call.sendMessage(content, ...). In-dialog
//               session-message scoped to this single call. Reaches
//               only the device(s) party to the call (no forking)
//               and is naturally call-id-bound. Was the original
//               transport before the cross-device sync migration;
//               kept reachable behind this flag so we can A/B test
//               or fall back when the account-message path
//               misbehaves.
//
// Defaulted to 'account' to match current production behaviour.
// Flip via setZrtpMessageTransport('call') from anywhere in JS;
// applies to subsequent ZRTP sends, no need to restart the call.
const ZRTP_TRANSPORTS = ['call'];
const ZRTP_TRANSPORT_DEFAULT = 'call';
let _zrtpMessageTransport = ZRTP_TRANSPORT_DEFAULT;

// Local device identifier — a stable per-install UUID, used to key rs1
// in storage as (peer_aor, peer_device_id). app.js pulls it from
// react-native-device-info's getUniqueId() and pushes it down once via
// setLocalDeviceId at boot. Without it the protocol behaves like v2
// (AOR-only keying); with it the multi-device collapse problem is fixed
// (different devices behind the same account no longer overwrite each
// other's rs1).
let _localDeviceId = null;

export function setLocalDeviceId(id) {
    if (typeof id === 'string' && id.length > 0) {
        _localDeviceId = id;
    }
}

export function setZrtpMessageTransport(mode) {
    if (ZRTP_TRANSPORTS.indexOf(mode) === -1) {
        utils.timestampedLog('[zrtp] setZrtpMessageTransport: rejected mode', mode,
            '— only', ZRTP_TRANSPORTS.join('/'), 'is supported');
        return;
    }
    _zrtpMessageTransport = mode;
    utils.timestampedLog('[zrtp] message transport =', _zrtpMessageTransport);
}

export function getZrtpMessageTransport() {
    return _zrtpMessageTransport;
}

// SAS — Short Authentication String. Both endpoints derive identical 4-char
// + 4-emoji strings from the shared secret; users compare verbally during
// the call to detect MITM. 32-symbol alphabets (5 bits/symbol → 20 bits of
// MITM detection from 4 symbols).
const SAS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
const SAS_EMOJIS = [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼',
    '🐨','🐯','🦁','🐮','🐷','🐸','🐵','🦄',
    '🐔','🐧','🦅','🦉','🐺','🐴','🦓','🦒',
    '🐘','🦏','🐊','🐢','🐳','🦈','🐙','🦋',
];

// ----- small hex helpers (avoid pulling in tweetnacl-util) ---------------

const toHex = (bytes) =>
    Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (s) => {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(s.substr(i * 2, 2), 16);
    }
    return out;
};

const _isDev = () =>
    (typeof __DEV__ !== 'undefined' && __DEV__);

const _hexForLog = (bytes) => _isDev() ? toHex(bytes) : '<redacted>';

const _keyPrefixForLog = (hexKey) =>
    _isDev() ? (hexKey ? hexKey.slice(0, 8) : '?') : '<redacted>';

// Constant-time string compare. Returns false on null/length mismatch (the
// length-leak is unavoidable in JS without rewriting in WASM); for equal
// lengths it XORs every char and runs to the end so timing doesn't reveal
// the prefix-match length. Used for security-relevant string equality
// (stored PGP key fingerprint, SAS).
// Format an encryptedKinds array into a short human-readable suffix used
// by the pill label. Returns 'audio', 'video', 'audio and video', or ''
// (the empty string when nothing is encrypted yet).
export function formatEncryptedKindsLabel(kinds) {
    if (!Array.isArray(kinds) || kinds.length === 0) return '';
    const hasA = kinds.indexOf('audio') !== -1;
    const hasV = kinds.indexOf('video') !== -1;
    if (hasA && hasV) return 'audio and video';
    if (hasA) return 'audio';
    if (hasV) return 'video';
    return '';
}

// Format a timestamp (ms since epoch) as "YYYY-MM-DD HH:MM" in local time.
// Used by the SAS verification dialog and mismatch alarm so the displayed
// time is unambiguous and short regardless of locale.
export function formatVerifiedTimestamp(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function constantTimeStringEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// ----- HKDF-SHA256(IKM, salt, info, L) using crypto-js -------------------
// TODO(hardening #21): swap to @noble/hashes or react-native-quick-crypto
// (both constant-time and audited). Neither is currently a project dep —
// adding one is a Phase 2 task; keep CryptoJS for now.

function hkdf(ikm, salt, infoStr, length) {
    const ikmWA = CryptoJS.enc.Hex.parse(toHex(ikm));
    const saltWA = CryptoJS.enc.Hex.parse(toHex(salt));
    const prk = CryptoJS.HmacSHA256(ikmWA, saltWA);                      // extract
    const infoWA = CryptoJS.enc.Utf8.parse(infoStr).concat(CryptoJS.enc.Hex.parse('01'));
    const t1 = CryptoJS.HmacSHA256(infoWA, prk);                         // expand (single block)
    return fromHex(t1.toString(CryptoJS.enc.Hex).substring(0, length * 2));
}

// SHA-256 of the given bytes, returning the first 8 bytes hex-encoded.
// This is the rs_id sent on the wire — a public commitment to which rs1
// each side holds, without exposing rs1 itself.
function rsIdHexOf(rs1Bytes) {
    if (!rs1Bytes || rs1Bytes.length !== RS_BYTES) return null;
    const wa = CryptoJS.enc.Hex.parse(toHex(rs1Bytes));
    const digestHex = CryptoJS.SHA256(wa).toString(CryptoJS.enc.Hex);
    return digestHex.substring(0, RS_ID_HEX_LEN);
}

// ----- v3 PGP signed handshake ------------------------------------------
//
// Canonical JSON: byte-identical with python3-sipsimple's
// _canonical_json_bytes. Sorted keys at every depth, no whitespace, the
// 'sig' field itself is excluded (the sig signs what it's stored alongside,
// not itself). Both sides sign / verify against the same string of bytes.

function canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJson).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
    return '{' + parts.join(',') + '}';
}

function stripSig(payload) {
    const out = {};
    for (const k of Object.keys(payload)) {
        if (k !== 'sig') out[k] = payload[k];
    }
    return out;
}

// Detached-sign the canonical JSON of `payload` (sans 'sig') with the
// armored private key. Returns the armored signature string on success,
// or null on any failure / when keys are missing.
async function signPayload(privateKeyArmored, payload) {
    if (!privateKeyArmored) return null;
    try {
        const body = canonicalJson(stripSig(payload));
        return await OpenPGP.sign(body, privateKeyArmored, '');
    } catch (e) {
        console.log('[zrtp] PGP sign failed:', (e && e.message) || e);
        return null;
    }
}

// Verify a detached armored signature against the canonical JSON of the
// payload (sans 'sig'). Returns true iff verification succeeded.
async function verifyPayload(publicKeyArmored, payload, sigArmored) {
    if (!publicKeyArmored || !sigArmored) return false;
    try {
        const body = canonicalJson(stripSig(payload));
        return await OpenPGP.verify(sigArmored, body, publicKeyArmored);
    } catch (e) {
        console.log('[zrtp] PGP verify failed:', (e && e.message) || e);
        return false;
    }
}

// ----- one handshake instance, per call ---------------------------------

class ZrtpSession {
    constructor({ call, account, contact, myKeys, role }) {
        this.call = call;
        this.account = account;          // sylkrtc Account, for account.sendMessage
        this.contact = contact;
        this.myKeys = myKeys;            // { public, private } PGP armored
        this.role = role;                // 'caller' | 'callee'
        this.localId = call._id || call.id;
        // SIP Call-ID — same on both endpoints; used in payload for
        // forked-message filtering when account-message is delivered to
        // multiple devices of the same recipient.
        this.callId = call._callId || call.callId || this.localId;
        this.peerUri = contact.uri;
        this.state = 'idle';
        this.ephemeral = nacl.box.keyPair();   // X25519: { publicKey, secretKey }
        this.peerEphemPub = null;
        this.sharedSecret = null;
        this.derivedKeys = null;
        // Two-phase install guards — see _installReceivers / _installSenders.
        this._receiversInstalled = false;
        this._sendersInstalled = false;
        // Per-kind tracking — which media kinds ('audio' / 'video') ended up
        // wrapped in FrameEncryptor / FrameDecryptor. Drives the pill label.
        this._installedSenderKinds = new Set();
        this._installedReceiverKinds = new Set();
        // Video bitrate cap is applied once per session.
        this._videoBitrateApplied = false;
        // ---- v2 retained-secret continuity -----------------------------
        // Negotiated wire version (1 or 2). Pinned to peer's version on
        // first incoming payload. v1 means no rs1 mix.
        this.negotiatedVersion = VERSION;
        // Stash the full localProperties.zrtp record on the session so
        // we can re-look-up rs1 by composite key (peer_aor, peer_device_id)
        // after we learn the peer's device_id from their first payload.
        this._contactZrtpRecord = (contact && contact.localProperties
                                   && contact.localProperties.zrtp) || null;
        // Initial localRs1 from the LEGACY single-device slot — used as
        // the outgoing probe's rs_id_hex (best guess; peer_device_id is
        // not yet known at probe-send time). On receive we re-resolve
        // via _resolveLocalRs1ForPeerDevice() and switch to the composite
        // per-device slot.
        const legacyHex = this._contactZrtpRecord && this._contactZrtpRecord.rs1_hex;
        this.localRs1 = (typeof legacyHex === 'string'
                         && /^[0-9a-fA-F]{64}$/.test(legacyHex))
                        ? fromHex(legacyHex)
                        : null;
        this.localRsIdHex = this.localRs1 ? rsIdHexOf(this.localRs1) : null;
        // rs_id seen on the wire from the peer (set in handleIncoming
        // before _deriveAndLog runs).
        this.peerRsIdHex = null;
        // One of: 'first-time', 'verified', 'mismatch', 'one-sided-local',
        // 'one-sided-peer'. See _deriveAndLog for the decision matrix.
        this.continuityState = 'first-time';
        // True iff _deriveAndLog actually mixed rs1 into HKDF. Drives
        // automatic post-call rotation.
        this._mixedRs1 = false;
        // ---- v3 PGP signed handshake ----------------------------------
        // myKeys is { public, private } (PGP armored) for the local
        // account. contact.publicKey is the peer's PGP public key. Both
        // are already cached by app.js for chat encryption, so v3 sign /
        // verify costs zero extra key management.
        this.localPrivKey = (myKeys && myKeys.private) || null;
        this.peerPubKey = (contact && contact.publicKey) || null;
        // ---- v3 device-id keying --------------------------------------
        // Our local device id (pushed in at boot via setLocalDeviceId).
        // The peer's device id is learned from their first probe/accept
        // payload and stored on this.peerDeviceId. rs1 storage is then
        // keyed by composite (peer_aor, peer_device_id) so multiple
        // devices behind the same SIP AOR don't overwrite each other's
        // continuity secrets.
        this.localDeviceId = _localDeviceId;
        this.peerDeviceId = null;
        // ---- media-plane stuck-state surface ---------------------------
        // True once the activity poller has decided we're "stuck at key-
        // agreed with no inbound RTP" (same condition that fires the
        // one-shot DIAGNOSTIC log line). Used by AudioCallBox / VideoBox
        // to render the amber "Media" pill alongside the ZRTP pill, and
        // by the panel that pops up when the user taps that pill. The
        // snapshot is refreshed on every subsequent poll tick (~500 ms)
        // so the panel always shows fresh stats when opened.
        //
        // Transitions:
        //   false → true  : emitted as 'zrtpMediaStuckChanged'
        //                   { stuck: true,  snapshot }
        //   true  → false : emitted as 'zrtpMediaStuckChanged'
        //                   { stuck: false, snapshot: null }
        //                   (fires the moment inbound RTP starts flowing)
        this.mediaStuck = false;
        this.mediaStuckSnapshot = null;
        this._log('created — local ephem pub (hex prefix):',
            toHex(this.ephemeral.publicKey).slice(0, 16) + '… call_id=', this.callId);
    }

    _log(...args) {
        // Every line includes the SIP Call-ID so a single grep through
        // metro.log finds the whole handshake for a given call.
        //   - [call] [zrtp]   : line classification, mirrors what app.js
        //                       and the [message] [call] [zrtp] sender lines
        //                       already use so filters compose.
        //   - call_id=<sip>   : the SIP Call-ID (this.callId), the same
        //                       one that travels on the wire and matches
        //                       the peer's logs end-to-end.
        //   - this.localId    : the JS-side per-session UUID, useful to
        //                       disambiguate when the same SIP Call-ID
        //                       hosts re-INVITE/upgrade ZRTP sessions.
        if (this._isLogRateLimited()) return;
        console.log('[call] [zrtp] call_id=' + this.callId,
                    this.localId, this.role, ...args);
    }

    _isLogRateLimited() {
        const MAX_PER_WINDOW = 30;      // lines
        const WINDOW_MS      = 1000;    // per 1s
        const now = Date.now();
        if (!this._logWindowStart || (now - this._logWindowStart) > WINDOW_MS) {
            if (this._logSuppressedInWindow > 0) {
                console.log('[call] [zrtp] call_id=' + this.callId,
                    this.localId, this.role,
                    '[rate-limit] suppressed', this._logSuppressedInWindow,
                    'lines in last', WINDOW_MS, 'ms');
            }
            this._logWindowStart = now;
            this._logCountInWindow = 0;
            this._logSuppressedInWindow = 0;
        }
        if (this._logCountInWindow >= MAX_PER_WINDOW) {
            this._logSuppressedInWindow++;
            return true;
        }
        this._logCountInWindow++;
        return false;
    }

    // Single point of dispatch for an outgoing ZRTP envelope. Picks
    // between Call.sendMessage (in-session, single-device) and
    // Account.sendMessage (cross-account, may fork to multiple
    // devices) based on the module-level _zrtpMessageTransport flag.
    // The two API shapes differ — call.sendMessage takes no URI, it
    // already knows the peer; account.sendMessage needs the URI as
    // first arg — so the helper hides that here and the call sites
    // stay short.
    _sendEncrypted(encrypted, label, cb) {
        const transport = _zrtpMessageTransport;
        const sizeBytes = encrypted ? encrypted.length : 0;
        // Compact context block reused by every line below so each
        // entry/exit log carries enough info to correlate against an
        // applog timeline without grep-sed gymnastics: which envelope
        // (label), which transport, who the peer is, the call id,
        // and the encrypted payload size.
        const ctx = 'label=' + label
            + ' transport=' + transport
            + ' peer=' + this.peerUri
            + ' call_id=' + this.callId
            + ' size=' + sizeBytes + 'B';

        // ---- callee-side state gate -------------------------------------
        // sylk-server's `session-message` handler rejects sends while the
        // server-side session is in `accepted` state with the error
        // "Invalid state session ...: accepted for sending messages".
        // This bites the callee path: we receive the peer's probe BEFORE
        // sylk-server has finished moving the session from `accepted` to
        // `established` (which happens once media is actually flowing
        // both ways). When we try to fire back `accept` here, the server
        // rejects and the handshake stalls — pill never comes on.
        //
        // The fix is to defer the in-dialog send until the call's public
        // .state getter reports `established`. We attach a one-shot
        // stateChanged listener and recurse from there; if the call goes
        // to `terminated` first we deliver an error to the caller cb.
        // The OUTGOING side (caller) goes through state `accepted` very
        // briefly before `established`, so this gate is essentially a
        // no-op for it — the wait is unobservable for normal traffic.
        if (transport === 'call'
                && this.call
                && this.call.state !== 'established'
                && !this._destroyed
                && typeof this.call.on === 'function') {
            this._log('deferring ' + label + ' — call.state=' + this.call.state +
                      ', waiting for established (sylk-server session-message gate)');
            const onStateChange = (oldS, newS) => {
                if (newS === 'established') {
                    try { this.call.removeListener('stateChanged', onStateChange); } catch (e) {}
                    this._log(label + ' resumed — call.state=established');
                    this._sendEncrypted(encrypted, label, cb);
                } else if (newS === 'terminated') {
                    try { this.call.removeListener('stateChanged', onStateChange); } catch (e) {}
                    if (cb) cb(new Error('call terminated before ' + label + ' could be sent'));
                }
            };
            try { this.call.on('stateChanged', onStateChange); } catch (e) {
                this._log('could not attach stateChanged listener: ' + ((e && e.message) || e));
                if (cb) cb(e);
            }
            return;
        }
        // -------------------------------------------------------------------

        if (transport === 'call' && this.call && typeof this.call.sendMessage === 'function') {
            utils.timestampedLog('[message] [call] [zrtp] sending via call.sendMessage', ctx);
            this._log('transport=call (session-message):', label);
            try {
                this.call.sendMessage(encrypted, ZRTP_CONTENT_TYPE, {}, (err) => {
                    if (err) {
                        utils.timestampedLog('[message] [call] [zrtp] call.sendMessage FAILED', ctx,
                            'err=', err && err.message ? err.message : String(err));
                    } else {
                        utils.timestampedLog('[message] [call] [zrtp] call.sendMessage OK', ctx);
                    }
                    if (cb) cb(err);
                });
            } catch (e) {
                const errMsg = e && e.message ? e.message : String(e);
                utils.timestampedLog('[message] [call] [zrtp] call.sendMessage THREW — falling back to account', ctx,
                    'err=', errMsg);
                this._log('call.sendMessage threw — falling back to account:', errMsg);
                this.account.sendMessage(this.peerUri, encrypted, ZRTP_CONTENT_TYPE, {}, (err) => {
                    if (err) {
                        utils.timestampedLog('[message] [call] [zrtp] account.sendMessage FAILED (fallback)', ctx,
                            'err=', err && err.message ? err.message : String(err));
                    } else {
                        utils.timestampedLog('[message] [call] [zrtp] account.sendMessage OK (fallback)', ctx);
                    }
                    if (cb) cb(err);
                });
            }
        } else {
            utils.timestampedLog('[message] [call] [zrtp] sending via account.sendMessage', ctx);
            this._log('transport=account (account-message):', label);
            this.account.sendMessage(this.peerUri, encrypted, ZRTP_CONTENT_TYPE, {}, (err) => {
                if (err) {
                    utils.timestampedLog('[message] [call] [zrtp] account.sendMessage FAILED', ctx,
                        'err=', err && err.message ? err.message : String(err));
                } else {
                    utils.timestampedLog('[message] [call] [zrtp] account.sendMessage OK', ctx);
                }
                if (cb) cb(err);
            });
        }
    }

    /**
     * Update internal state and emit a 'zrtpStateChanged' event on the
     * sylkrtc Call so React components (e.g. AudioCallBox) can react.
     * Possible states:
     *   idle        — no handshake yet
     *   probing     — probe sent, waiting for accept (caller) / accept sent (callee)
     *   key-agreed  — DH done + keys derived + setMediaEncryption/Decryption
     *                 native install calls returned without throwing. Does NOT
     *                 mean media is actually encrypted yet — peer might not
     *                 have installed its half. UI shows a "negotiating" pip
     *                 here at most, NOT the verified-encrypted pill.
     *   key-active  — RTP packets are flowing inbound on at least one
     *                 receiver AND our sender encryption is installed
     *                 (_sendersInstalled). The handshake already proved
     *                 both ends agree on the keys; once packets are
     *                 actually arriving while both sides have their
     *                 crypto installed, by transitivity those packets are
     *                 encrypted under the negotiated key. This is the
     *                 state the UI pill watches.
     *   failed      — handshake or install gave up.
     *
     * `key-active` is a strict refinement of `key-agreed`. Transitions are
     * managed by _startMediaActivityPoller; do NOT call _setState('key-active')
     * from any other code path.
     */
    _setState(newState) {
        this.state = newState;
        try {
            this.call.emit('zrtpStateChanged', newState);
        } catch (e) {
            // Call object may be torn down already; ignore.
        }
    }

    /**
     * Start the inbound-RTP activity poller. Called once, right after
     * _setState('key-agreed') in _handleRecvReady / _handleSenderReady.
     *
     * Every 500 ms we call pc.getStats() and look at every inbound-rtp
     * report's `packetsReceived`, computing the delta vs the previous
     * poll. The state machine is:
     *
     *   if (any inbound-rtp packetsReceived delta > 0
     *       AND _sendersInstalled is true):
     *           -> 'key-active' (pill on)
     *           reset no-activity counter
     *   else if (state == 'key-active'):
     *           noActivityTicks++
     *           if (noActivityTicks >= 4)   // 4 polls * 500ms = 2 s
     *               -> 'key-agreed' (pill off)
     *
     * Why this is a sufficient signal for the pill: the handshake state
     * machine only sets _sendersInstalled = true after PHASE B (our
     * MediaFrameEncryptor is installed under the agreed key). The peer
     * only emits 'sender_ready' after installing its own encryptor under
     * the symmetric key. So once both sides are at key-agreed AND inbound
     * packets are flowing, those packets MUST be the peer's encrypted
     * output under the negotiated key — there is no other code path that
     * produces inbound media for the call. If decryption were silently
     * failing the audio decoder would conceal the frames and the user
     * would notice immediately; the pill flickering off then on isn't
     * the failure mode we need to guard against here.
     *
     * The 2-second hysteresis prevents the pill from flickering during
     * brief mid-call lulls (talk-spurt boundaries, brief packet loss).
     *
     * The poller stops itself when the call state transitions to terminated
     * (cleanup hook in CallZrtp.js's call.on('stateChanged') listener calls
     * stop()).
     */
    _startMediaActivityPoller() {
        if (this._activityTimer) return;   // idempotent
        // Map of inbound-rtp stat id -> packetsReceived from the previous
        // poll. First poll just establishes the baseline. We key on the
        // stat report id rather than ssrc because Safari/older RN-webrtc
        // builds sometimes omit ssrc on the report.
        this._lastPacketsReceived = new Map();
        this._noActivityTicks = 0;
        const POLL_MS = 500;
        const STALE_TICKS = 4;             // 2 seconds of zero inbound
        // Safety-net auto-stop. The poller normally stops via
        // _attachCleanup when the sylkrtc Call emits stateChanged
        // 'terminated'. In the wild we have observed that a remote
        // hang-up sometimes does NOT make it to the caller's JS Call
        // object — the peer's BYE / WebSocket session-end is missed,
        // packets stop arriving, but call.state never transitions and
        // _attachCleanup never fires. The poller then ticks forever
        // (logged: tick=320 → tick=1520 with aggDelta=0 throughout),
        // burning CPU and pinning the FrameEncryptor's pc.getStats
        // path indefinitely.
        //
        // The auto-stop watches for a long run of zero-delta ticks
        // WHILE in 'key-agreed' (the post-active resting state). If we
        // see DEAD_MS milliseconds of no inbound media after the call
        // has demonstrably been active, treat the call as effectively
        // ended and self-terminate the session. The 60 s window is
        // long enough to outlast any legitimate one-sided silence on
        // an established call (network blip + held-call) but well
        // below human "I'd notice this is broken" tolerance.
        const DEAD_MS = 60000;
        const DEAD_TICKS = DEAD_MS / POLL_MS;
        // Stuck-at-key-agreed diagnostic. If, STUCK_DIAG_MS after the
        // poller started, we are still at 'key-agreed' AND have never
        // observed inbound RTP AND our senders are installed, the pill
        // will not light and the user will hear silence — emit a single
        // explanatory log line so support can grep for it instead of
        // staring at the same trailing "state -> key-agreed" we've been
        // shipping for months. The threshold sits above realistic media-
        // start latency (~500ms for SIP-over-Janus) but well below human
        // patience (~5s).
        const STUCK_DIAG_MS = 5000;
        const STUCK_DIAG_TICKS = STUCK_DIAG_MS / POLL_MS;
        let __consecutiveZeroDelta = 0;
        let __everSawActivity = false;
        let __tickCount = 0;
        let __stuckDiagFired = false;
        let __getStatsErrorLogged = false;
        const tick = async () => {
            __tickCount++;
            if (this._destroyed) return;
            const pc = this.call && this.call._pc;
            if (!pc || typeof pc.getStats !== 'function') {
                return;
            }
            let aggDelta = 0;
            try {
                const stats = await pc.getStats();
                stats.forEach((report) => {
                    if (!report || report.type !== 'inbound-rtp') return;
                    const id = report.id || ('ssrc=' + report.ssrc) || 'unknown';
                    const cur = Number(report.packetsReceived || 0);
                    const prev = this._lastPacketsReceived.get(id) || 0;
                    const d = Math.max(0, cur - prev);
                    this._lastPacketsReceived.set(id, cur);
                    aggDelta += d;
                });
            } catch (e) {
                // Don't spam the log on every poll if getStats is
                // chronically failing (would have masked the stuck-at-
                // key-agreed condition before this patch). Log once with
                // a marker so support knows the poller is degraded.
                if (!__getStatsErrorLogged) {
                    __getStatsErrorLogged = true;
                    this._log('activity poller: pc.getStats() threw — '
                              + 'pill cannot light until this clears '
                              + '(will not log again this session): '
                              + ((e && e.message) || String(e)));
                }
                return;
            }
            if (aggDelta > 0 && this._sendersInstalled) {
                this._noActivityTicks = 0;
                __consecutiveZeroDelta = 0;
                __everSawActivity = true;
                if (this.state !== 'key-active') {
                    this._log('inbound media flowing (Δpkts=' + aggDelta +
                              ') -> key-active');
                    this._setState('key-active');
                    // Clear the media-stuck condition if it was latched.
                    // Inbound RTP has started flowing, so any Media pill /
                    // diagnostic panel the UI is showing should disappear.
                    if (this.mediaStuck) {
                        this.mediaStuck = false;
                        this.mediaStuckSnapshot = null;
                        try {
                            this.call.emit('zrtpMediaStuckChanged',
                                           { stuck: false, snapshot: null });
                        } catch (_) { /* call torn down */ }
                    }
                    // Auto-rotate rs1 only when this call's _deriveAndLog
                    // actually mixed the existing rs1 into HKDF (i.e. the
                    // peer proved they held the same secret). Other states
                    // (first-time, mismatch, one-sided-*) require an
                    // explicit user SAS Confirm before any rs1 is written.
                    if (this._mixedRs1 && !this._rotated) {
                        this._rotated = true;
                        const next = this._deriveNextRs1();
                        if (next) {
                            this._emitRs1Update(next);
                        }
                    }
                }
            } else if (this.state === 'key-active') {
                this._noActivityTicks++;
                __consecutiveZeroDelta++;
                if (this._noActivityTicks >= STALE_TICKS) {
                    this._log('no inbound media for ' + (STALE_TICKS * POLL_MS) +
                              'ms -> key-agreed (pill off)');
                    this._setState('key-agreed');
                }
            } else {
                // key-agreed (or earlier): count zero-delta ticks for
                // the auto-stop safety net.
                __consecutiveZeroDelta++;
            }
            // Stuck-at-key-agreed detector. Catches the failure mode where
            // both sides reach key-agreed but the peer never actually sends
            // encoded media — typically because the peer aborted
            // FrameEncryptor install (e.g. v3 verify failed on their side
            // with no peer_pub_key plumbed, or the bridge tore the audio
            // stream down). In that case the mobile sits at key-agreed
            // indefinitely, the pill never lights, and any "decrypted"
            // audio is noise.
            //
            // Two surfaces consume this signal:
            //   1. The metro.log DIAGNOSTIC line (emitted exactly once via
            //      __stuckDiagFired) — for support engineers grep-ing the
            //      log post-mortem.
            //   2. The UI "Media" pill (driven by zrtpMediaStuckChanged /
            //      zrtpMediaDiagUpdated events) — for the user looking at
            //      the call screen in real time. The pill appears the
            //      instant the stuck condition latches and disappears the
            //      instant inbound RTP starts flowing (handled in the
            //      key-active transition branch above). Tapping the pill
            //      opens a panel that re-reads this.mediaStuckSnapshot;
            //      we refresh the snapshot on every poll tick (~500 ms)
            //      so the panel shows fresh stats while it's open.
            const stuckNow = this.state === 'key-agreed'
                             && this._sendersInstalled
                             && !__everSawActivity
                             && __tickCount >= STUCK_DIAG_TICKS;
            if (stuckNow) {
                // Snapshot pc.getStats — full enough to distinguish (a)/(b)
                // from (c)/(d):
                //   - "no inbound-rtp reports at all" → the PC never even saw
                //     an SSRC; Janus isn't forwarding for this call, or DTLS
                //     never finished, or candidate-pair selection failed.
                //     transport.bytesReceived will confirm: zero == nothing
                //     on the wire, non-zero == bytes flowed but couldn't be
                //     RTP-parsed (DTLS-SRTP key mismatch is the textbook
                //     cause of "bytes received but zero RTP packets").
                //   - "inbound-rtp report exists but packetsReceived=0" →
                //     report was created (so an SSRC was at least announced
                //     via SDP) but no packet has ever decoded successfully —
                //     same DTLS-SRTP suspicion, just a different code path
                //     created the report stub.
                //   - "inbound-rtp report exists, packetsReceived>0, but our
                //     delta is still 0" → packets ARE arriving, the poller's
                //     baseline accidentally captured them and is stuck at the
                //     ceiling; that's a poller bug.
                // The snapshot is published on the session AND emitted on
                // the Call so the UI panel can subscribe. We do this as a
                // self-invoking IIFE so the await doesn't block the outer
                // poller tick's control flow.
                const fireLogLines = !__stuckDiagFired;
                if (fireLogLines) {
                    __stuckDiagFired = true;
                    this._log('DIAGNOSTIC: ' + STUCK_DIAG_MS + 'ms past key-agreed'
                              + ' with no inbound RTP — pill will stay OFF and audio'
                              + ' will be silent. Likely causes: (a) peer never sent'
                              + ' media; (b) peer aborted FrameEncryptor install'
                              + ' (check peer log for v3 verify failure / missing'
                              + ' "media now end-to-end encrypted" line); (c) Janus'
                              + ' / sylk-server bridge dropped the audio stream;'
                              + ' (d) DTLS-SRTP unwrap failing on the Janus→mobile'
                              + ' leg (packets arrive on the wire but never reach'
                              + ' the inbound-rtp accounting layer).'
                              + ' role=' + this.role
                              + ' _sendersInstalled=' + this._sendersInstalled
                              + ' encryptedKinds=[' + this.encryptedKinds.join(',') + ']'
                              + ' negotiatedVersion=' + this.negotiatedVersion
                              + ' continuity=' + this.continuityState);
                }
                (async () => {
                    let diag;
                    try {
                        diag = await this._snapshotMediaDiag(pc);
                    } catch (e) {
                        this._log('DIAGNOSTIC stats: getStats snapshot failed: '
                                  + ((e && e.message) || String(e)));
                        return;
                    }
                    if (fireLogLines) {
                        this._log('DIAGNOSTIC stats: iceConnectionState=' + diag.iceConnectionState
                                  + ' inbound-rtp.count=' + diag.inboundCount
                                  + ' transport.bytesReceived=' + diag.transportBytesReceived
                                  + ' selectedCandidatePairId=' + (diag.selectedCandidatePairId || '<none>'));
                        if (diag.inboundLines.length === 0) {
                            this._log('DIAGNOSTIC stats: NO inbound-rtp reports — '
                                      + 'PC never observed an SSRC for this call');
                        } else {
                            for (const line of diag.inboundLines) {
                                this._log('DIAGNOSTIC stats: inbound-rtp ' + line);
                            }
                        }
                        for (const line of diag.pairLines) {
                            this._log('DIAGNOSTIC stats: candidate-pair ' + line);
                        }
                    }
                    // Publish to UI listeners. mediaStuck latches on the
                    // first stuck tick; subsequent ticks only refresh the
                    // snapshot (no transition emit). The panel listens on
                    // zrtpMediaDiagUpdated to live-refresh while open.
                    this.mediaStuckSnapshot = diag;
                    if (!this.mediaStuck) {
                        this.mediaStuck = true;
                        try {
                            this.call.emit('zrtpMediaStuckChanged',
                                           { stuck: true, snapshot: diag });
                        } catch (_) { /* call torn down */ }
                    } else {
                        try {
                            this.call.emit('zrtpMediaDiagUpdated',
                                           { snapshot: diag });
                        } catch (_) { /* call torn down */ }
                    }
                })();
            }
            // Safety-net stop. If we previously saw real media (so the
            // call was actually live) and we've now had DEAD_MS of zero
            // packet movement, the remote end is gone but sylkrtc never
            // delivered a 'terminated' event. Tear the session down
            // ourselves so the poller stops burning CPU and the per-
            // session state can be reclaimed. Note we only do this AFTER
            // observing activity so a slow handshake on a fresh call
            // (where the very first inbound packet hasn't arrived yet)
            // isn't killed off prematurely.
            if (__everSawActivity && __consecutiveZeroDelta >= DEAD_TICKS) {
                this._log('safety-net: ' + DEAD_MS + 'ms of zero inbound media'
                          + ' while in state=' + this.state
                          + ' — sylkrtc never reported terminated; stopping poller'
                          + ' and tearing down ZRTP session');
                try {
                    const id = _idOf(this.call);
                    sessions.delete(id);
                } catch (_) {}
                this.destroy();
                return;
            }
            // else: not yet active, no inbound yet — wait for activity.
        };
        // Fire one tick immediately to seed _lastPacketsReceived, then
        // settle into the periodic interval.
        tick();
        this._activityTimer = setInterval(tick, POLL_MS);
    }

    _stopMediaActivityPoller() {
        if (this._activityTimer) {
            clearInterval(this._activityTimer);
            this._activityTimer = null;
        }
        this._lastPacketsReceived = null;
        this._noActivityTicks = 0;
    }

    /**
     * Parse pc.getStats() into the diagnostic structure that the metro.log
     * DIAGNOSTIC lines and the UI "Media" panel both consume.
     *
     * Returns an object with the same fields the log line prints:
     *   iceConnectionState         — string from pc.iceConnectionState
     *   inboundCount               — number of inbound-rtp reports
     *   transportBytesReceived     — sum of all transport.bytesReceived
     *   selectedCandidatePairId    — id of the selected pair (or null)
     *   inboundLines               — pre-formatted inbound-rtp summaries
     *   pairLines                  — pre-formatted candidate-pair summaries
     *   inbound                    — structured per-stream rows for the UI
     *   pairs                      — structured candidate-pair rows
     *   role, sendersInstalled,    — context fields the panel surfaces
     *   encryptedKinds, negotiatedVersion, continuity, capturedAt
     *
     * Keeping the pre-formatted lines lets the existing _log path stay
     * byte-identical to the pre-refactor output; the structured fields
     * are what the React panel renders.
     */
    async _snapshotMediaDiag(pc) {
        const snap = await pc.getStats();
        let inboundCount = 0;
        let transportBytesReceived = 0;
        const iceConnectionState = (this.call && this.call._pc
                                    && this.call._pc.iceConnectionState) || '?';
        let selectedCandidatePairId = null;
        const inboundLines = [];
        const pairLines = [];
        const inbound = [];
        const pairs = [];
        snap.forEach((r) => {
            if (!r) return;
            if (r.type === 'inbound-rtp') {
                inboundCount++;
                inboundLines.push(
                    '{kind=' + (r.kind || r.mediaType || '?')
                    + ' ssrc=' + (r.ssrc != null ? r.ssrc : '?')
                    + ' packetsReceived=' + (r.packetsReceived || 0)
                    + ' bytesReceived=' + (r.bytesReceived || 0)
                    + ' jitter=' + (r.jitter != null ? r.jitter : '?')
                    + ' codec=' + (r.codecId || '?') + '}');
                inbound.push({
                    kind: r.kind || r.mediaType || '?',
                    ssrc: r.ssrc != null ? r.ssrc : null,
                    packetsReceived: Number(r.packetsReceived || 0),
                    bytesReceived: Number(r.bytesReceived || 0),
                    jitter: r.jitter != null ? r.jitter : null,
                    codec: r.codecId || null,
                });
            } else if (r.type === 'transport') {
                transportBytesReceived += Number(r.bytesReceived || 0);
                if (r.selectedCandidatePairId) {
                    selectedCandidatePairId = r.selectedCandidatePairId;
                }
            } else if (r.type === 'candidate-pair') {
                pairLines.push(
                    '{id=' + r.id
                    + ' state=' + (r.state || '?')
                    + ' nominated=' + (r.nominated ? 'yes' : 'no')
                    + ' bytesReceived=' + (r.bytesReceived || 0)
                    + ' bytesSent=' + (r.bytesSent || 0) + '}');
                pairs.push({
                    id: r.id,
                    state: r.state || '?',
                    nominated: !!r.nominated,
                    bytesReceived: Number(r.bytesReceived || 0),
                    bytesSent: Number(r.bytesSent || 0),
                });
            }
        });
        return {
            capturedAt: Date.now(),
            role: this.role,
            sendersInstalled: !!this._sendersInstalled,
            encryptedKinds: this.encryptedKinds.slice(),
            negotiatedVersion: this.negotiatedVersion,
            continuity: this.continuityState,
            iceConnectionState,
            inboundCount,
            transportBytesReceived,
            selectedCandidatePairId,
            inboundLines,
            pairLines,
            inbound,
            pairs,
        };
    }

    async startProbe() {
        if (this.state !== 'idle') {
            this._log('startProbe ignored — state is', this.state);
            return;
        }
        this._setState('probing');
        const payload = {
            v: VERSION,
            type: 'probe',
            call_id: this.callId,
            ephem_pub_hex: toHex(this.ephemeral.publicKey),
            suites: ['AES-128-GCM'],
        };
        if (this.localRsIdHex) {
            payload.rs_id_hex = this.localRsIdHex;
        }
        if (this.localDeviceId) {
            payload.device_id = this.localDeviceId;
        }
        // Per-device rs_id candidates. Caller can't know which of the
        // peer's devices will pick up this call (multiple devices may be
        // registered behind the same AOR), so we ship the rs_id_hex
        // computed from every per-device rs1 record we have stored for
        // this peer URI. The callee picks the entry whose device_id
        // matches its own localDeviceId — see handleIncoming(). This
        // fixes the "caller stored rs1 only in the per-device slot, so
        // the legacy rs_id_hex field is empty and the callee sees us as
        // having no continuity" failure mode that caused asymmetric
        // continuity classification (one side 'verified', the other
        // 'one-sided-local') and the cascading mismatch problem.
        const candidates = this._collectRsIdHexCandidates();
        if (candidates.length > 0) {
            payload.rs_id_hex_candidates = candidates;
        }
        await this._maybeSign(payload);
        this._log('SEND probe (transport=' + _zrtpMessageTransport + '):', payload);

        // Plain JSON on the wire — the handshake payload (ephemeral
        // X25519 public key + suite list + call_id tag) is not
        // secret. Confidentiality of the call comes from the SAS-
        // verified shared secret derived from this exchange, not
        // from a transport-layer PGP wrap. Removing the wrap also
        // makes the handshake work for peers who haven't yet
        // exchanged PGP keys.
        const wireBody = JSON.stringify(payload);

        // _sendEncrypted picks between call.sendMessage (in-session)
        // and account.sendMessage (cross-device) based on the
        // _zrtpMessageTransport module flag. See setZrtpMessageTransport.
        // (Function name kept for now — the "encrypted" arg is now
        // the plaintext envelope; transport choice is the only
        // concern of that helper.)
        this._sendEncrypted(wireBody, 'probe', (err) => {
            if (err) this._log('probe send error:', err);
            else this._log('probe sent OK');
        });
    }

    async handleIncoming(decryptedJson) {
        let payload;
        try {
            payload = JSON.parse(decryptedJson);
        } catch (e) {
            this._log('JSON parse failed:', e.message);
            return;
        }

        this._log('RECV:', payload);

        if (typeof payload.v !== 'number' || payload.v < 1 || payload.v > VERSION) {
            this._log('unsupported wire version', payload.v, '— expected 1..' + VERSION);
            return;
        }
        // Pin negotiated version to the minimum of ours and peer's so a
        // v1 peer keeps v1 derivation semantics (no rs1 mix).
        this.negotiatedVersion = Math.min(payload.v, VERSION);
        // Account-messages may be forked to other devices of the recipient.
        // Each device only acts on the handshake when its active call's SIP
        // Call-ID matches the payload's; otherwise drop silently.
        if (!payload.call_id || payload.call_id !== this.callId) {
            this._log('call_id missing or mismatched — payload',
                JSON.stringify(payload.call_id), 'ours', this.callId, '— rejecting');
            return;
        }
        // Stash peer's device_id BEFORE we touch rs1 — if present, the
        // localRs1 slot we should compare against is the per-device one,
        // not the legacy AOR-only slot we read at construction time.
        if (payload.type === 'probe' || payload.type === 'accept') {
            if (typeof payload.device_id === 'string' && payload.device_id) {
                this.peerDeviceId = payload.device_id;
                this._resolveLocalRs1ForPeerDevice();
            }
        }
        // Stash peer's rs_id (if any) BEFORE _deriveAndLog runs. Only on
        // probe and accept; the other types don't carry it.
        //
        // Resolution order (first match wins):
        //   1. rs_id_hex_candidates — array of {device_id, rs_id_hex}.
        //      If our localDeviceId appears in this list, use that entry.
        //      This is the "drawer fix": lets the caller advertise every
        //      per-device rs_id it has stored for this peer URI so the
        //      callee can pick the one keyed to its own device, avoiding
        //      the asymmetric-classification problem where caller has
        //      per-device rs1 but ships nothing in the legacy slot.
        //   2. rs_id_hex — the single legacy field. Used when the peer
        //      didn't send candidates, or none matched our localDeviceId.
        //
        // Either way the value is validated and lower-cased before being
        // stashed for the continuity decision in _deriveAndLog.
        if ((payload.type === 'probe' || payload.type === 'accept')
                && this.negotiatedVersion >= 2) {
            let resolved = null;
            const cands = payload.rs_id_hex_candidates;
            if (Array.isArray(cands) && this.localDeviceId) {
                for (const c of cands) {
                    if (!c || typeof c !== 'object') continue;
                    if (c.device_id !== this.localDeviceId) continue;
                    const rid = c.rs_id_hex;
                    if (typeof rid === 'string'
                            && rid.length === RS_ID_HEX_LEN
                            && /^[0-9a-fA-F]+$/.test(rid)) {
                        resolved = rid.toLowerCase();
                        break;
                    }
                }
            }
            if (!resolved) {
                const rid = payload.rs_id_hex;
                if (typeof rid === 'string' && rid.length === RS_ID_HEX_LEN
                        && /^[0-9a-fA-F]+$/.test(rid)) {
                    resolved = rid.toLowerCase();
                }
            }
            this.peerRsIdHex = resolved;
        }

        if (payload.type === 'probe' || payload.type === 'accept') {
            if (Array.isArray(payload.suites) && payload.suites.length > 0) {
                const overlap = payload.suites.filter(s => LOCAL_SUITES.indexOf(s) !== -1);
                if (overlap.length === 0) {
                    this._log('suite negotiation failed — peer offered '
                        + JSON.stringify(payload.suites)
                        + ', local supports ' + JSON.stringify(LOCAL_SUITES)
                        + ' — rejecting');
                    this._setState('failed');
                    return;
                }
            }
        }

        // v3 signature verification on probe/accept/recv_ready/sender_ready.
        // A failed verification transitions the session to 'failed' and
        // stops processing this payload.
        if (!(await this._verifyOrReject(payload))) {
            return;
        }

        switch (payload.type) {
            case 'probe':         return this._handleProbe(payload);
            case 'accept':        return this._handleAccept(payload);
            case 'recv_ready':    return this._handleRecvReady(payload);
            case 'sender_ready':  return this._handleSenderReady(payload);
            default:
                this._log('unknown payload type:', payload.type);
        }
    }

    // Callee receives caller's probe: derive keys, install recv_dec, reply
    // with accept (which carries our ephemeral pub so the caller can derive).
    async _handleProbe(payload) {
        if (this.role !== 'callee') {
            this._log('probe ignored — caller role does not accept probes');
            return;
        }
        if (this.state !== 'idle') {
            this._log('probe ignored — state=' + this.state + ' (already past handshake start)');
            return;
        }
        if (!payload.ephem_pub_hex) { this._log('probe missing ephem_pub_hex'); return; }
        if (typeof payload.ephem_pub_hex !== 'string'
                || !/^[0-9a-fA-F]{64}$/.test(payload.ephem_pub_hex)) {
            this._log('probe ephem_pub_hex has wrong length/format: '
                + (payload.ephem_pub_hex && payload.ephem_pub_hex.length)
                + ' chars — rejecting');
            this._setState('failed');
            return;
        }
        this.peerEphemPub = fromHex(payload.ephem_pub_hex);
        if (this.peerEphemPub.length !== 32) {
            this._log('probe peer ephem pub decoded to '
                + this.peerEphemPub.length + ' bytes — rejecting');
            this._setState('failed');
            return;
        }
        this._setState('probing');
        this._deriveAndLog();

        // Phase A on this side: install recv_dec only.
        await this._installReceivers();

        const accept = {
            v: this.negotiatedVersion,
            type: 'accept',
            call_id: this.callId,
            ephem_pub_hex: toHex(this.ephemeral.publicKey),
        };
        if (this.negotiatedVersion >= 2 && this.localRsIdHex) {
            accept.rs_id_hex = this.localRsIdHex;
        }
        if (this.localDeviceId) {
            accept.device_id = this.localDeviceId;
        }
        await this._maybeSign(accept);
        this._log('SEND accept:', accept);
        await this._sendSigned(accept, 'accept');
    }

    // Caller receives callee's accept: derive keys, install recv_dec, then
    // signal recv_ready so callee knows it can install sender_enc safely.
    async _handleAccept(payload) {
        if (this.role !== 'caller') {
            this._log('accept ignored — callee role does not accept accepts');
            return;
        }
        if (this.state !== 'probing') {
            this._log('accept ignored — state=' + this.state + ' (expected probing)');
            return;
        }
        if (this.peerEphemPub) {
            this._log('accept ignored — peer ephem pub already set (duplicate accept?)');
            return;
        }
        if (!payload.ephem_pub_hex) { this._log('accept missing ephem_pub_hex'); return; }
        if (typeof payload.ephem_pub_hex !== 'string'
                || !/^[0-9a-fA-F]{64}$/.test(payload.ephem_pub_hex)) {
            this._log('accept ephem_pub_hex has wrong length/format: '
                + (payload.ephem_pub_hex && payload.ephem_pub_hex.length)
                + ' chars — rejecting');
            this._setState('failed');
            return;
        }
        this.peerEphemPub = fromHex(payload.ephem_pub_hex);
        if (this.peerEphemPub.length !== 32) {
            this._log('accept peer ephem pub decoded to '
                + this.peerEphemPub.length + ' bytes — rejecting');
            this._setState('failed');
            return;
        }
        this._deriveAndLog();

        // Phase A: install recv_dec.
        await this._installReceivers();

        const recvReady = { v: this.negotiatedVersion, type: 'recv_ready', call_id: this.callId };
        this._log('SEND recv_ready');
        await this._sendSigned(recvReady, 'recv_ready');
    }

    // recv_ready arrived — peer has its decryptor in place. We can safely
    // install sender_enc on this side. After install, signal sender_ready.
    async _handleRecvReady(/*payload*/) {
        if (this.state === 'key-active' || this.state === 'failed') {
            this._log('recv_ready ignored — state=' + this.state);
            return;
        }
        if (!this.derivedKeys) {
            this._log('recv_ready ignored — no derived keys yet (handshake out of order)');
            return;
        }
        if (this._sendersInstalled) {
            this._log('recv_ready: senders already installed — ignoring');
            return;
        }
        // Caller may not yet have installed its own recv_dec when this
        // ack arrives (callee is the one that sent it after its own
        // handshake). Install our receivers if we haven't already.
        await this._installReceivers();

        await this._installSenders();

        const senderReady = { v: this.negotiatedVersion, type: 'sender_ready', call_id: this.callId };
        this._log('SEND sender_ready');
        await this._sendSigned(senderReady, 'sender_ready');

        this._setState('key-agreed');
        this._log('state -> key-agreed');
        // From here on the pill stays OFF until receiver decryption counters
        // confirm the peer is actually emitting our ciphertext. The poller
        // promotes us to 'key-active' (pill on) and demotes back to
        // 'key-agreed' (pill off) after 2 s of all-passthrough.
        this._startMediaActivityPoller();
    }

    // sender_ready arrived — peer has installed sender_enc. We may not
    // yet have installed our own sender_enc on this side (caller path).
    async _handleSenderReady(/*payload*/) {
        if (this.state === 'key-active' || this.state === 'failed') {
            this._log('sender_ready ignored — state=' + this.state);
            return;
        }
        if (!this.derivedKeys) {
            this._log('sender_ready ignored — no derived keys yet (handshake out of order)');
            return;
        }
        await this._installSenders();
        this._setState('key-agreed');
        this._log('state -> key-agreed');
        // See _handleRecvReady — gate the pill on observed media activity.
        this._startMediaActivityPoller();
    }

    async _sendSigned(obj, label) {
        // Plain JSON on the wire — see comment in startProbe. The
        // legacy method name "_sendSigned" is kept for blame-history
        // continuity; the body is no longer signed/wrapped, just
        // serialised.
        const wireBody = JSON.stringify(obj);
        // Routed through _sendEncrypted so the call.sendMessage vs
        // account.sendMessage choice lives in exactly one place.
        this._sendEncrypted(wireBody, label, (err) => {
            if (err) this._log(label + ' send error:', err);
            else this._log(label + ' sent OK');
        });
    }

    // Number of leading plaintext bytes the FrameEncryptor must leave
    // un-encrypted at the start of each video frame. WebRTC's RTP codec
    // packetizers read this region of the encoded frame to extract codec-
    // specific metadata. The numbers below match what we've verified on
    // M124 hardware:
    //   VP8: descriptor's X bit + PictureID extension occupy 2-3 bytes in
    //        practice — 1-byte prefix breaks fragmentation, 3 works.
    //   VP9: descriptor with I=1, M=1 (always set by WebRTC) is 3 bytes.
    //   H264: FU-A indicator + FU header (2 bytes) suffice; STAP-A and
    //        single-NAL only need 1 — 2 covers all forms.
    //   AV1:  OBU header is 1 byte.
    static unencryptedVideoPrefixForCodec(codec) {
        const c = (codec || '').toUpperCase();
        if (c === 'VP8')  return 3;
        if (c === 'VP9')  return 3;
        if (c === 'H264') return 2;
        if (c === 'AV1')  return 1;
        return 3; // safe upper bound
    }

    // Pull the negotiated video codec out of the SDP. The first codec in
    // an OFFER is the offerer's preference; the first codec in an ANSWER
    // is the AGREED codec (both sides will use it). So both endpoints
    // must parse the ANSWER, not the offer:
    //
    //   caller : pc.remoteDescription = peer's answer        → ANSWER ✓
    //   callee : pc.localDescription  = our answer (munged)  → ANSWER ✓
    //   callee : pc.remoteDescription = peer's offer         → OFFER  ✗
    //
    // Earlier this only checked remoteDescription; on the callee side
    // that returned the offerer's preference (e.g. caller's account
    // default VP8) instead of the agreed codec (e.g. H264 picked by the
    // answer munge), and the prefix mismatch silently produced frozen
    // video both ways through the permissive decryptor.
    //
    // Returns 'VP8' as the safe default if no SDP is parseable yet.
    // Log every m=… and m=video-related a=rtpmap line we can find in BOTH
    // SDPs. Helps eyeball whether the offer/answer are agreeing on the
    // codec, and which payload number maps to which codec name on each
    // side (these are independently chosen). Called once before we pick
    // the negotiated codec so the metro.log story is self-contained.
    _logSdpMlines() {
        try {
            const pc = this.call._pc;
            if (!pc) return;
            const localSdp  = ((pc.localDescription  || pc.currentLocalDescription)  || {}).sdp;
            const remoteSdp = ((pc.remoteDescription || pc.currentRemoteDescription) || {}).sdp;
            const dump = (label, sdp) => {
                if (!sdp) { this._log('[video] ' + label + ' SDP: <none yet>'); return; }
                const lines = sdp.split('\r\n');
                let inVideo = false;
                for (const line of lines) {
                    if (line.startsWith('m=')) {
                        inVideo = line.startsWith('m=video ');
                        this._log('[video] ' + label + ' ' + line);
                        continue;
                    }
                    if (inVideo && line.startsWith('a=rtpmap:')) {
                        this._log('[video] ' + label + ' ' + line);
                    }
                    if (inVideo && line.startsWith('a=fmtp:')) {
                        this._log('[video] ' + label + ' ' + line);
                    }
                }
            };
            dump('local ', localSdp);
            dump('remote', remoteSdp);
        } catch (e) {
            this._log('[video] _logSdpMlines threw:', (e && e.message) || e);
        }
    }

    // Both endpoints parse pc.remoteDescription:
    //   caller : remoteDescription = peer's answer
    //   callee : remoteDescription = peer's offer
    // The first codec in either is the agreed codec, AS LONG AS the
    // answer munge mirrors the offer's first codec — which sylkrtc's
    // call.js answer() now does via pickAnswerVideoCodec(this._incomingSdp).
    // If you ever see the prefix mismatch again ("audio works, video
    // frozen"), the first thing to check is that call.js fix is still
    // in place in node_modules/react-native-sylkrtc/lib/call.js.
    //
    // We can't parse pc.localDescription on the callee — sylkrtc's
    // mungeSdp runs AFTER setLocalDescription, so localDescription holds
    // the libwebrtc-natural codec ordering (often H264-first), not the
    // mirrored ordering that's actually sent on the wire.
    //
    // Returns 'VP8' as the safe default if no SDP is parseable yet.
    _negotiatedVideoCodec() {
        // Dump m= / a=rtpmap / a=fmtp lines from both SDPs once per
        // negotiation so a future asymmetric-codec bug is visible at a
        // glance from metro.log.
        if (!this._sdpMlinesLogged) {
            this._logSdpMlines();
            this._sdpMlinesLogged = true;
        }
        try {
            const pc = this.call._pc;
            if (!pc) return 'VP8';
            const desc = pc.remoteDescription || pc.currentRemoteDescription;
            const sdp = (desc || {}).sdp;
            if (!sdp) return 'VP8';
            const lines = sdp.split('\r\n');
            let firstPayload = null;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('m=video ')) {
                    const parts = line.split(' ');
                    firstPayload = parts[3];
                    continue;
                }
                if (line.startsWith('m=')) firstPayload = null;
                if (firstPayload && line.startsWith('a=rtpmap:' + firstPayload + ' ')) {
                    const codec = line.split(' ')[1].split('/')[0];
                    return (codec || 'VP8').toUpperCase();
                }
            }
        } catch (e) {
            // fall through
        }
        return 'VP8';
    }

    // Returns the audio codec name negotiated for this call ('OPUS',
    // 'PCMA', etc.) by parsing the m=audio line of pc.remoteDescription.
    // Returns null on audio-less calls or parse failures — callers should
    // omit the codec from their logs in that case rather than substitute
    // a fake one (this function exists specifically to stop the
    // misleading "audio sender ... codec= VP8" log line, where VP8 was
    // the VIDEO fallback being reused for the audio sender's log).
    _negotiatedAudioCodec() {
        try {
            const pc = this.call._pc;
            if (!pc) return null;
            const desc = pc.remoteDescription || pc.currentRemoteDescription;
            const sdp = (desc || {}).sdp;
            if (!sdp) return null;
            const lines = sdp.split('\r\n');
            let firstPayload = null;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('m=audio ')) {
                    const parts = line.split(' ');
                    firstPayload = parts[3];
                    continue;
                }
                if (line.startsWith('m=')) firstPayload = null;
                if (firstPayload && line.startsWith('a=rtpmap:' + firstPayload + ' ')) {
                    const codec = line.split(' ')[1].split('/')[0];
                    return (codec || '').toUpperCase() || null;
                }
            }
        } catch (e) {
            // fall through
        }
        return null;
    }

    // Direction key/salt convention (HKDF labels):
    //   caller sends with caller->callee key/salt
    //   caller receives with callee->caller key/salt
    //   callee mirrored.
    _directionKeys() {
        if (!this.derivedKeys) return null;
        const isCaller = this.role === 'caller';
        return {
            sendKey:  isCaller ? this.derivedKeys.audioCallerToCallee     : this.derivedKeys.audioCalleeToCaller,
            sendSalt: isCaller ? this.derivedKeys.audioCallerToCalleeSalt : this.derivedKeys.audioCalleeToCallerSalt,
            recvKey:  isCaller ? this.derivedKeys.audioCalleeToCaller     : this.derivedKeys.audioCallerToCallee,
            recvSalt: isCaller ? this.derivedKeys.audioCalleeToCallerSalt : this.derivedKeys.audioCallerToCalleeSalt,
            keyId: 1,
        };
    }

    // Wait until libwebrtc has actually wired up a remote receiver on
    // the PeerConnection. The C++ RTPReceiver is constructed when the
    // 'track' event fires on _pc; we use that — plus a fast poll on
    // pc.getReceivers() — as the install-ready signal. Three short-
    // circuits:
    //
    //   1. pc.getReceivers() already shows a receiver with a live track
    //      → libwebrtc wired things before we got here (typical caller
    //      path, where install runs long after DTLS).
    //   2. Raw 'track' event on _pc. (Earlier we hooked sylkrtc's
    //      higher-level 'streamAdded' on Call, but that only emits when
    //      event.streams[0] is non-empty — Janus' SDP often lacks
    //      a=msid so streams[0] is undefined and 'streamAdded' never
    //      fires. Listening on _pc directly catches it regardless of
    //      msid.) We also keep the higher-level event as a belt-and-
    //      braces fallback.
    //   3. Poll: every 200ms re-check getReceivers(). On some builds
    //      the 'track' event fires before our listener is attached, so
    //      a fixed-cadence poll catches the post-fact case.
    //   4. 2000ms timeout — proceed anyway so a misbehaving build
    //      can't deadlock the handshake.
    async _waitForRemoteStream() {
        const pc = this.call && this.call._pc;
        if (!pc) return;
        const haveLiveReceiver = () => {
            try {
                const recvs = typeof pc.getReceivers === 'function' ? (pc.getReceivers() || []) : [];
                for (const r of recvs) {
                    const t = r && r.track;
                    if (t && t.kind && t.readyState && t.readyState !== 'ended') return true;
                }
            } catch (e) { /* ignore */ }
            return false;
        };
        if (haveLiveReceiver()) {
            this._log('_waitForRemoteStream: pc.getReceivers() already shows a live receiver; proceeding');
            return;
        }
        if (typeof pc.getRemoteStreams === 'function') {
            try {
                const existing = pc.getRemoteStreams();
                if (existing && existing.length > 0) {
                    this._log('_waitForRemoteStream: already have ' + existing.length + ' remote stream(s); proceeding');
                    return;
                }
            } catch (e) {
                this._log('_waitForRemoteStream: getRemoteStreams threw: ' + ((e && e.message) || e));
            }
        }
        this._log('_waitForRemoteStream: waiting (track event | poll | timeout) — install gated until receiver is live');
        await new Promise((resolve) => {
            let done = false;
            const finish = (reason) => {
                if (done) return;
                done = true;
                try { pc.removeEventListener && pc.removeEventListener('track', onPcTrack); } catch (e) {}
                try { this.call.removeListener && this.call.removeListener('streamAdded', onStream); } catch (e) {}
                try { this.call.removeListener && this.call.removeListener('stateChanged', onState); } catch (e) {}
                if (pollId) clearInterval(pollId);
                if (timeoutId) clearTimeout(timeoutId);
                this._log('_waitForRemoteStream: ' + reason);
                resolve();
            };
            const onPcTrack = (event) => {
                const kindHint = event && event.track && event.track.kind
                    ? event.track.kind
                    : (event && event.receiver && event.receiver.track && event.receiver.track.kind)
                        || '?';
                finish('pc.track event fired (kind=' + kindHint + ')');
            };
            const onStream = (stream) => {
                finish('streamAdded fired (kinds: '
                       + ((stream && stream.getTracks && stream.getTracks().map(t => t.kind).join(',')) || '?')
                       + ')');
            };
            const onState = (oldS, newS) => {
                if (newS === 'terminated') finish('call terminated while waiting');
            };
            try { pc.addEventListener && pc.addEventListener('track', onPcTrack); } catch (e) {}
            try { this.call.on && this.call.on('streamAdded', onStream); } catch (e) {}
            try { this.call.on && this.call.on('stateChanged', onState); } catch (e) {}
            // Belt-and-braces poll — catches the case where 'track' fired
            // before this Promise was constructed.
            const pollId = setInterval(() => {
                if (haveLiveReceiver()) finish('poll detected live receiver');
            }, 200);
            // Safety timeout.
            const timeoutId = setTimeout(() => finish('wait timeout (2000ms) — proceeding'), 2000);
        });
    }

    // Strict-mode H264 video drop. When encryptionMode is
    // 'zrtp_mandatory' and the negotiated video codec is H264 (which we
    // cannot end-to-end encrypt because of STAP-A multi-NAL packetisation),
    // refuse the video media entirely: stop the local video sender,
    // disable the remote video receiver, and emit 'zrtpStrictH264VideoDrop'
    // so the UI suppresses camera-enable prompts and the local preview.
    // Audio installs normally. Idempotent — guarded by _strictH264Dropped.
    _maybeStrictDropH264Video(skipVideoForH264) {
        if (!skipVideoForH264) return;
        if (_encryptionMode !== 'zrtp_mandatory') return;
        if (this._strictH264Dropped) return;
        this._strictH264Dropped = true;
        this._log('STRICT mode + H264 video — dropping video media entirely');
        try { this.call._zrtpStrictNoVideo = true; } catch (e) {}
        const pc = this.call && this.call._pc;
        if (pc) {
            try {
                const senders = (typeof pc.getSenders === 'function') ? pc.getSenders() : [];
                for (const s of senders) {
                    if (s && s.track && s.track.kind === 'video') {
                        try { s.replaceTrack(null); } catch (e) {}
                        try { if (s.track.stop) s.track.stop(); } catch (e) {}
                    }
                }
            } catch (e) {
                this._log('strict-H264 sender drop threw:', (e && e.message) || e);
            }
            try {
                const receivers = (typeof pc.getReceivers === 'function') ? pc.getReceivers() : [];
                for (const r of receivers) {
                    if (r && r.track && r.track.kind === 'video') {
                        try { if (r.track.stop) r.track.stop(); } catch (e) {}
                    }
                }
            } catch (e) {
                this._log('strict-H264 receiver drop threw:', (e && e.message) || e);
            }
        }
        try {
            this.call.emit('zrtpStrictH264VideoDrop', {
                reason: 'strict-mode-no-h264',
                detail: 'zRTP strict mode does not allow unencrypted H264 video',
            });
        } catch (e) {
            this._log('zrtpStrictH264VideoDrop emit threw:', (e && e.message) || e);
        }
    }

    // Phase A — install FrameDecryptor on every receiver. Safe to call as
    // soon as keys are derived: the C++ decryptor is permissive — it passes
    // through any bytes that don't decrypt, so peer plaintext frames still
    // reach the codec while we wait for the peer to install its sender_enc.
    async _installReceivers() {
        this._log('_installReceivers ENTER: call.state='
                  + (this.call && this.call.state)
                  + ' _receiversInstalled=' + this._receiversInstalled
                  + ' role=' + this.role);
        if (this._receiversInstalled) {
            this._log('_installReceivers: already installed — skipping');
            return;
        }
        const k = this._directionKeys();
        if (!k) { this._log('_installReceivers: no derived keys yet'); return; }
        const pc = this.call._pc;
        if (!pc || typeof pc.getReceivers !== 'function') {
            this._log('_installReceivers: no _pc/getReceivers'); return;
        }

        // Defer install until call.state === 'established'. In libwebrtc the
        // Java RtpReceiver wrapper exists as soon as setRemoteDescription
        // completes (i.e. at call.state='accepted'), but the actual receive-
        // side decode pipeline isn't constructed until ICE+DTLS finish and
        // the call transitions to 'established'. A setFrameDecryptor() call
        // against the pre-'established' wrapper binds to a placeholder; the
        // FrameDecryptor::Decrypt() callback is then NEVER invoked on the
        // real decode path. Symptom: pc.getReceivers() returns the audio
        // receiver, setMediaDecryption resolves successfully, but the poller
        // observes aggDec=0 aggPass=0 forever.
        //
        // Note: on the caller side this is essentially a no-op — by the time
        // the caller receives the callee's 'accept', the call has already
        // gone through accepted → established (the callee can only respond
        // once media is flowing). The deferral matters for the callee, where
        // _handleProbe fires the moment the in-dialog MESSAGE arrives and
        // the call may still be at 'accepted' for several seconds while
        // ICE/DTLS settle.
        if (this.call && this.call.state && this.call.state !== 'established' && !this._destroyed
                && typeof this.call.on === 'function') {
            this._log('_installReceivers: deferring install — call.state='
                      + this.call.state + ', waiting for established '
                      + '(libwebrtc placeholder-receiver guard)');
            await new Promise((resolve, reject) => {
                const onStateChange = (oldS, newS) => {
                    if (newS === 'established') {
                        try { this.call.removeListener('stateChanged', onStateChange); } catch (e) {}
                        this._log('_installReceivers: resumed — call.state=established');
                        resolve();
                    } else if (newS === 'terminated') {
                        try { this.call.removeListener('stateChanged', onStateChange); } catch (e) {}
                        reject(new Error('call terminated before receivers could be installed'));
                    }
                };
                try { this.call.on('stateChanged', onStateChange); }
                catch (e) { reject(e); }
            }).catch(e => {
                this._log('_installReceivers: deferred-wait failed:', (e && e.message) || e);
                throw e;
            });
            // Re-check the install guards after the wait — another path
            // (e.g. the symmetric _handleRecvReady call) may have raced
            // ahead and already installed while we were waiting.
            if (this._receiversInstalled) {
                this._log('_installReceivers: post-defer — already installed by another path');
                return;
            }
        }

        // Second gate: even when call.state='established' is reached on the
        // signaling side, the libwebrtc receive-side decode pipeline can
        // still be a beat behind on the callee — the underlying C++
        // RTPReceiver is constructed by libwebrtc when the first decoded
        // remote track is wired, which is signalled via the 'track' event
        // (sylkrtc emits this as 'streamAdded' on the Call). Installing
        // BEFORE that event means setFrameDecryptor binds to a Java wrapper
        // that's about to be re-bound when the real receiver is created,
        // so the FrameDecryptor::Decrypt callback is never invoked. We
        // wait for streamAdded too (or a short timeout — by which point
        // getReceivers() is reliable on every libwebrtc build I've seen).
        await this._waitForRemoteStream();

        // Diagnostic: dump every receiver libwebrtc currently exposes so
        // the next failure tells us what shape getReceivers returned at
        // install time (id, kind, track presence, track readyState).
        // react-native-webrtc exposes receiver.id as a string getter
        // (NOT a method) and track.id likewise, so we coerce to string
        // and wrap the whole dump in try/catch — a thrown TypeError here
        // used to kill the surrounding loop silently, never reaching
        // setMediaDecryption. Symptom: log ends at "returned N receivers"
        // and the decryptor never actually installs.
        try {
            const allRecv = pc.getReceivers() || [];
            this._log('_installReceivers: pc.getReceivers() returned ' + allRecv.length + ' receivers');
            for (const r of allRecv) {
                try {
                    const rid = (typeof r.id === 'function') ? r.id() : r.id;
                    const t = r.track;
                    const tid = t && ((typeof t.id === 'function') ? t.id() : t.id);
                    this._log('  receiver id=' + (rid || '?')
                              + ' kind=' + (t ? t.kind : '<no track>')
                              + ' trackId=' + (tid || '?')
                              + ' readyState=' + (t ? t.readyState : '?'));
                } catch (e) {
                    this._log('  receiver dump failed: ' + ((e && e.message) || e));
                }
            }
        } catch (e) {
            this._log('  receiver-list dump failed: ' + ((e && e.message) || e));
        }
        // The "video codec" we negotiate the unencrypted prefix from only
        // applies to video tracks. Resolve it once for the video case;
        // audio tracks get prefix=0 from the C++ side regardless and we
        // log the audio codec separately in the per-receiver line.
        const videoCodec = this._negotiatedVideoCodec();
        const audioCodec = this._negotiatedAudioCodec();
        const videoPrefix = ZrtpSession.unencryptedVideoPrefixForCodec(videoCodec);
        const skipVideoForH264 = _shouldSkipVideoZrtpForCodec(this.call);
        // Strict-mode + H264 video: refuse the video media entirely. We
        // can't E2E-encrypt H264 with our fixed-prefix scheme, and
        // 'zrtp_mandatory' means the user wants encryption-or-nothing.
        // Drop the video sender / receiver and tell the UI to suppress
        // camera prompts. Audio still gets E2E installed normally.
        this._maybeStrictDropH264Video(skipVideoForH264);
        this._log('PHASE A install receivers; role=' + this.role +
                  ' recv.key=' + _keyPrefixForLog(k.recvKey) + '… '
                  + 'videoCodec=' + videoCodec + ' videoPrefix=' + videoPrefix
                  + ' audioCodec=' + (audioCodec || '?')
                  + (skipVideoForH264 ? ' (video receivers will be SKIPPED — H264 STAP-A limit)' : ''));
        const receivers = pc.getReceivers();
        let installSuccesses = 0;
        let installFailures = 0;
        for (const r of receivers) {
            if (!r.track) continue;
            // Honest per-track codec for logging — the previous code
            // logged `codec=<videoCodec>` even for audio senders, which
            // was misleading (and showed VP8 on calls that had no VP8).
            const trackCodec = r.track.kind === 'audio' ? (audioCodec || '?') : videoCodec;
            // H264 video can't be safely E2E-encrypted with our fixed-
            // prefix FrameEncryptor (STAP-A multi-NAL). Audio still
            // installs and is fully encrypted; video just falls back to
            // plain SRTP/DTLS. Without this branch we'd install the
            // decryptor on the video receiver but the peer wouldn't be
            // encrypting it (or, with the symmetric fix on python3-
            // sipsimple side, would encrypt and produce broken frames).
            if (skipVideoForH264 && r.track.kind === 'video') {
                this._log('[video] receiver decryption SKIPPED — H264 negotiated (STAP-A); audio remains E2E encrypted');
                continue;
            }
            try {
                // Per-track prefix: audio carries no codec-metadata
                // header in its RTP payload (the Opus frame starts at
                // byte 0), so the AEAD must encrypt from byte 0 and
                // the decryptor must use prefix=0. Video formats with
                // a payload-format header that needs to stay readable
                // for the depacketizer (VP8/VP9 = 3 bytes, H264 = 2,
                // AV1 = 1) keep the videoPrefix value. A previous bug
                // passed videoPrefix to every receiver including
                // audio — that made the Opus-decryptor expect 3 bytes
                // of plaintext at the start of every audio frame, the
                // AEAD tag check failed on every frame, and the
                // permissive-passthrough kicked in so audio appeared
                // to work but was actually flowing unencrypted.
                const perTrackPrefix = r.track.kind === 'audio' ? 0 : videoPrefix;
                await r.setMediaDecryption(k.recvKey, k.recvSalt, k.keyId, perTrackPrefix);
                installSuccesses++;
                this._installedReceiverKinds.add(r.track.kind);
                this._log('[' + r.track.kind + '] receiver decryption installed (codec=' + trackCodec + ', prefix=' + perTrackPrefix + ')');
                // Applog proof: the native call returned without throwing,
                // which means react-native-webrtc bound the FrameDecryptor
                // for this RTP receiver. Frames arriving on this track
                // are now decrypted through our HKDF-derived key in the
                // native pipeline before the JS side ever sees them.
                // The 8-char key prefix is included so a support engineer
                // can correlate caller and callee logs without exposing
                // the full key.
                utils.timestampedLog('[call] [zrtp] call_id=' + this.callId,
                    r.track.kind, 'receiver SRTP DECRYPTION ACTIVE',
                    'with peer', this.peerUri,
                    'key prefix=' + _keyPrefixForLog(k.recvKey) + '…',
                    'codec=', trackCodec);
            } catch (e) {
                installFailures++;
                this._log('[' + r.track.kind + '] receiver install failed:', (e && e.message) || e);
                utils.timestampedLog('[call] [zrtp] call_id=' + this.callId,
                    r.track.kind, 'receiver SRTP install FAILED with peer',
                    this.peerUri, '— error:', (e && e.message) || String(e));
            }
        }
        if (installSuccesses > 0) {
            this._receiversInstalled = true;
        } else if (installFailures > 0) {
            this._log('_installReceivers: ALL installs failed — _receiversInstalled=false');
            this._setState('failed');
        } else {
            this._log('_installReceivers: no tracks to install on — _receiversInstalled=false');
        }
    }

    // Phase B — install FrameEncryptor on every sender. Only called after
    // peer has signaled recv_ready (or sender_ready), confirming peer has
    // its decryptor installed. From this point on, frames going out the
    // wire are AES-128-GCM ciphertext.
    // Apply the JS-side video bitrate cap AND encoder-side resolution /
    // framerate target to the video sender. Idempotent — safe to call
    // multiple times. Has no effect when there's no video sender on the
    // call.
    //
    // Why both? The getUserMedia constraints are only a hint to the
    // camera; react-native-webrtc on Android can still hand us a
    // larger native mode (e.g. 1088x1088/30fps from Motorola front
    // cameras even when we asked for 640x480/24fps). The encoder
    // knobs below run inside libwebrtc, after the camera, so they're
    // a hard guarantee that what goes on the wire matches our target.
    async _applyVideoBitrate() {
        if (this._videoBitrateApplied) return;
        if (_videoMaxBitrateKbps === null
            && _videoTargetWidth === null
            && _videoTargetHeight === null
            && _videoTargetFramerate === null) return;
        const pc = this.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') return;
        for (const s of pc.getSenders()) {
            if (s.track && s.track.kind === 'video') {
                try {
                    const params = s.getParameters();
                    if (!params.encodings || params.encodings.length === 0) {
                        params.encodings = [{}];
                    }

                    if (_videoMaxBitrateKbps !== null) {
                        params.encodings[0].maxBitrate = _videoMaxBitrateKbps * 1000;
                    }
                    if (_videoTargetFramerate !== null) {
                        params.encodings[0].maxFramerate = _videoTargetFramerate;
                    }

                    // Compute scaleResolutionDownBy from the actual
                    // track size, NOT a hardcoded constant: if the
                    // camera honoured our hint and gave us 640x480
                    // we want scale=1; if it gave us 1088x1088 we
                    // want scale=1088/640 ~= 1.7. We bias to the
                    // larger of the two axes so neither axis
                    // exceeds the target.
                    if (_videoTargetWidth !== null && _videoTargetHeight !== null) {
                        let scale = 1.0;
                        try {
                            const settings = (typeof s.track.getSettings === 'function')
                                ? s.track.getSettings() : null;
                            const tw = settings && settings.width  ? settings.width  : null;
                            const th = settings && settings.height ? settings.height : null;
                            if (tw && th) {
                                const sx = tw / _videoTargetWidth;
                                const sy = th / _videoTargetHeight;
                                scale = Math.max(1.0, Math.max(sx, sy));
                                this._log('[video] track is', tw + 'x' + th,
                                          '-> scaleResolutionDownBy=', scale.toFixed(3));
                            } else {
                                this._log('[video] track size unknown; defaulting scaleResolutionDownBy=1');
                            }
                        } catch (sizeErr) {
                            this._log('[video] track.getSettings() failed:',
                                      (sizeErr && sizeErr.message) || sizeErr);
                        }
                        // setParameters rejects values < 1.0, so floor
                        // here to be safe. Values == 1.0 are a no-op.
                        if (scale < 1.0) scale = 1.0;
                        params.encodings[0].scaleResolutionDownBy = scale;
                    }

                    // Re-fetch encoder params immediately before
                    // setParameters and merge our 3 fields onto the
                    // fresh snapshot. The original code captured
                    // `params` once at the top of this block, did the
                    // (potentially slow) track.getSettings() probe in
                    // between, and only then called setParameters —
                    // long enough for VideoBox._onEnableCamera's
                    // setParameters({active:true}) to race with us and
                    // get clobbered, leaving encodings inactive even
                    // after the user pressed Enable Camera. We saw
                    // this in metro.log for
                    // call_id=2b1d8d02-2474-06db-6b46-5c5c19e07cd8
                    // (2026-05-19 08:00:48..08:01:01): outbound-rtp
                    // stats stayed at frames=0/0/0 for the whole call.
                    //
                    // We only own the 3 encoder fields below; the
                    // active flag and anything else on the encoding
                    // belong to the rest of the call (VideoBox's
                    // camera-enable modal flow) and must NOT be
                    // overwritten with our stale snapshot.
                    try {
                        const fresh = s.getParameters();
                        if (fresh && Array.isArray(fresh.encodings) && fresh.encodings.length > 0) {
                            const ours = params.encodings[0];
                            fresh.encodings.forEach((e) => {
                                if (ours.maxBitrate !== undefined) e.maxBitrate = ours.maxBitrate;
                                if (ours.maxFramerate !== undefined) e.maxFramerate = ours.maxFramerate;
                                if (ours.scaleResolutionDownBy !== undefined) {
                                    e.scaleResolutionDownBy = ours.scaleResolutionDownBy;
                                }
                            });
                            await s.setParameters(fresh);
                            this._log('[video] sender encoder params set (merged onto fresh snapshot):',
                                      'maxBitrate=', _videoMaxBitrateKbps, 'kbps',
                                      'maxFramerate=', _videoTargetFramerate,
                                      'scaleResolutionDownBy=', ours.scaleResolutionDownBy,
                                      'active=', fresh.encodings.map(e => e.active !== false).join(','));
                        } else {
                            await s.setParameters(params);
                            this._log('[video] sender encoder params set (no fresh snapshot):',
                                      'maxBitrate=', _videoMaxBitrateKbps, 'kbps',
                                      'maxFramerate=', _videoTargetFramerate,
                                      'scaleResolutionDownBy=', params.encodings[0].scaleResolutionDownBy);
                        }
                    } catch (mergeErr) {
                        this._log('[video] fresh-snapshot merge failed, falling back to staged params:',
                                  (mergeErr && mergeErr.message) || mergeErr);
                        await s.setParameters(params);
                        this._log('[video] sender encoder params set (fallback path):',
                                  'maxBitrate=', _videoMaxBitrateKbps, 'kbps',
                                  'maxFramerate=', _videoTargetFramerate,
                                  'scaleResolutionDownBy=', params.encodings[0].scaleResolutionDownBy);
                    }
                } catch (e) {
                    this._log('[video] setParameters failed:', (e && e.message) || e);
                }
            }
        }
        this._videoBitrateApplied = true;
    }

    async _installSenders() {
        // Bitrate cap applies regardless of whether crypto install is on or
        // off — set it before bailing out on the diagnostic flag.
        await this._applyVideoBitrate();

        if (this._sendersInstalled) return;
        const k = this._directionKeys();
        if (!k) { this._log('_installSenders: no derived keys yet'); return; }
        const pc = this.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') {
            this._log('_installSenders: no _pc/getSenders'); return;
        }
        const videoCodec = this._negotiatedVideoCodec();
        const audioCodec = this._negotiatedAudioCodec();
        const videoPrefix = ZrtpSession.unencryptedVideoPrefixForCodec(videoCodec);
        const skipVideoForH264 = _shouldSkipVideoZrtpForCodec(this.call);
        this._log('PHASE B install senders; role=' + this.role +
                  ' send.key=' + _keyPrefixForLog(k.sendKey) + '… '
                  + 'videoCodec=' + videoCodec + ' videoPrefix=' + videoPrefix
                  + ' audioCodec=' + (audioCodec || '?')
                  + (skipVideoForH264 ? ' (video senders will be SKIPPED — H264 STAP-A limit)' : ''));
        const senders = pc.getSenders();
        let installSuccesses = 0;
        let installFailures = 0;
        for (const s of senders) {
            if (!s.track) continue;
            // Honest per-track codec — was previously logging the video
            // codec for audio senders too, producing the misleading
            // "audio sender ... codec= VP8" line on calls that had no
            // VP8 in them.
            const trackCodec = s.track.kind === 'audio' ? (audioCodec || '?') : videoCodec;
            // Same H264-skip rule as in _installReceivers above. Audio is
            // installed; video isn't because the STAP-A packetizer would
            // break under our fixed-prefix encryptor.
            if (skipVideoForH264 && s.track.kind === 'video') {
                this._log('[video] sender encryption SKIPPED — H264 negotiated (STAP-A); audio remains E2E encrypted');
                continue;
            }
            try {
                // Symmetric per-track prefix fix — see the matching
                // comment in _installReceivers. Audio MUST be 0 so the
                // AEAD wraps the whole Opus frame; video keeps the
                // codec-metadata prefix unencrypted so the depacketizer
                // can still parse it before our payload starts.
                const perTrackPrefix = s.track.kind === 'audio' ? 0 : videoPrefix;
                await s.setMediaEncryption(k.sendKey, k.sendSalt, k.keyId, perTrackPrefix);
                installSuccesses++;
                this._installedSenderKinds.add(s.track.kind);
                this._log('[' + s.track.kind + '] sender encryption installed (codec=' + trackCodec + ', prefix=' + perTrackPrefix + ')');
                // Applog proof: the native call returned without throwing,
                // which means react-native-webrtc bound the FrameEncryptor
                // for this RTP sender. From this point on every frame
                // leaving this device for this track is AES-128-GCM
                // ciphertext at the native pipeline level — even before
                // it hits the SRTP/DTLS transport layer. The 8-char key
                // prefix lets a support engineer correlate the caller's
                // sender log with the callee's receiver log (the cross-
                // direction keys differ but the prefix identifies which
                // HKDF-derived key was used).
                utils.timestampedLog('[call] [zrtp] call_id=' + this.callId,
                    s.track.kind, 'sender SRTP ENCRYPTION ACTIVE',
                    'with peer', this.peerUri,
                    'key prefix=' + _keyPrefixForLog(k.sendKey) + '…',
                    'codec=', trackCodec);
            } catch (e) {
                installFailures++;
                this._log('[' + s.track.kind + '] sender install failed:', (e && e.message) || e);
                utils.timestampedLog('[call] [zrtp] call_id=' + this.callId,
                    s.track.kind, 'sender SRTP install FAILED with peer',
                    this.peerUri, '— error:', (e && e.message) || String(e));
            }
        }
        if (installSuccesses > 0) {
            this._sendersInstalled = true;
        } else if (installFailures > 0) {
            this._log('_installSenders: ALL installs failed — _sendersInstalled=false');
            this._setState('failed');
        } else {
            this._log('_installSenders: no tracks to install on — _sendersInstalled=false (NOT lighting pill)');
        }
    }

    // v3 — sign the outgoing payload in-place with our PGP private key
    // when v3 is negotiated and we hold a key. No-op on v < 3 or when
    // no private key is available.
    async _maybeSign(payload) {
        if (this.negotiatedVersion < 3 || !this.localPrivKey) return;
        const sig = await signPayload(this.localPrivKey, payload);
        if (sig) {
            payload.sig = sig;
        }
    }

    // v3 — verify an incoming probe/accept payload's signature against
    // the peer's PGP public key.
    //   v < 3                              → always accept (peer agreed
    //                                       to no-sig semantics).
    //   v >= 3 + no peer key plumbed in    → accept with warning (rollout
    //                                       phase; can't verify).
    //   v >= 3 + peer key + no sig present → accept with warning (likely
    //                                       downgrade-strip).
    //   v >= 3 + peer key + sig + verify   → return verifier's verdict;
    //                                       on FALSE, transition to
    //                                       'failed' and stop processing.
    async _verifyOrReject(payload) {
        if (this.negotiatedVersion < 3) return true;
        const sig = (payload && payload.sig) || null;
        if (!this.peerPubKey) {
            if (sig) {
                this._log('peer sent v3 sig but no peer PGP key cached — accepting anyway');
            }
            return true;
        }
        if (!sig) {
            this._log('v3 negotiated and peer key cached but payload has no sig — likely downgrade-strip; accepting but channel is NOT signed-handshake protected');
            return true;
        }
        const ok = await verifyPayload(this.peerPubKey, payload, sig);
        if (!ok) {
            this._log('v3 signature verification FAILED — rejecting payload');
            this._setState('failed');
            return false;
        }
        this._log('v3 signature verified');
        return true;
    }

    // Re-resolve localRs1 from the composite per-device slot
    // (contact.localProperties.zrtp.devices[peer_device_id]) once
    // peer_device_id is known. Called from handleIncoming on the first
    // probe/accept that carries it. When the composite slot is empty
    // (no prior call with THIS specific peer device), drop the legacy
    // single-device rs1 — that slot belongs to a different peer device
    // and using it here would produce a spurious 'mismatch' continuity
    // state in the multi-device case.
    _resolveLocalRs1ForPeerDevice() {
        if (!this.peerDeviceId) return;
        const devices = this._contactZrtpRecord && this._contactZrtpRecord.devices;
        const slot = devices && devices[this.peerDeviceId];
        const hex = slot && slot.rs1_hex;
        if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex)) {
            this.localRs1 = fromHex(hex);
            this.localRsIdHex = rsIdHexOf(this.localRs1);
            return;
        }
        this.localRs1 = null;
        this.localRsIdHex = null;
    }

    // Build the array shipped in the probe's rs_id_hex_candidates field.
    // Iterates every per-device rs1 record we have stored for this peer
    // URI and emits {device_id, rs_id_hex} for each — letting the callee
    // pick the entry that matches its own local device_id.
    //
    // The legacy single-slot rs_id_hex still travels in the top-level
    // rs_id_hex field for backward compatibility with peers that don't
    // know how to read the array. Callees that DO read the array prefer
    // the device-matched entry over the legacy field.
    _collectRsIdHexCandidates() {
        const devices = this._contactZrtpRecord && this._contactZrtpRecord.devices;
        if (!devices || typeof devices !== 'object') return [];
        const out = [];
        for (const peerDeviceId of Object.keys(devices)) {
            const slot = devices[peerDeviceId];
            const hex = slot && slot.rs1_hex;
            if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) continue;
            try {
                out.push({
                    device_id: peerDeviceId,
                    rs_id_hex: rsIdHexOf(fromHex(hex)),
                });
            } catch (_) { /* skip malformed entry */ }
        }
        return out;
    }

    // Derive the next per-peer retained secret (rs1) for this device pair.
    // Both sides MUST compute identical bytes from identical inputs so the
    // rs_id_hex one side sends on the next call matches what the other
    // side computes locally.
    //
    // Algorithm: HKDF(sharedSecret, salt=zeros, info='sylk-zrtp/v2/next-rs1').
    //
    // Earlier versions mixed the existing rs1 into the HKDF salt when
    // continuityState === 'verified', as a forward-secrecy chain. That
    // turned out to be the root cause of the cascading "SAS changed"
    // problem: the two sides decide continuityState independently from
    // local visibility (whose probe carried rs_id_hex, whose didn't), so
    // when one side computed 'verified' and the other computed
    // 'one-sided-local' on the SAME call, they took different salt
    // branches and persisted DIFFERENT next_rs1 values. Every subsequent
    // call between those devices then showed mismatch on whichever side
    // received an rs_id_hex first, forever.
    //
    // Salt=zeros makes the derivation symmetric by construction. Both
    // sides see the same sharedSecret and use the same salt, so they
    // ALWAYS produce the same next_rs1. The cost is a shallower forward
    // secrecy chain — an attacker who recovered ONE call's sharedSecret
    // could compute the next rs_id. We accept that trade because the
    // continuity indicator misfiring on legitimate calls is the actual
    // observed problem; chain-deep forward secrecy on rs1 isn't.
    _deriveNextRs1() {
        if (!this.sharedSecret) return null;
        const salt = new Uint8Array(32);
        try {
            return hkdf(this.sharedSecret, salt, 'sylk-zrtp/v2/next-rs1', RS_BYTES);
        } catch (e) {
            this._log('next_rs1 derivation failed:', (e && e.message) || e);
            return null;
        }
    }

    // Emit a zrtpRs1Update event on the Call object carrying the new rs1
    // (32 bytes hex) and the peer URI. app.js listens on the Call and
    // persists this into contact.localProperties.zrtp.rs1_hex via
    // saveSylkContact.
    _emitRs1Update(rs1Bytes) {
        const hex = toHex(rs1Bytes);
        try {
            this.call.emit('zrtpRs1Update', {
                uri: this.peerUri,
                device_id: this.peerDeviceId || null,
                rs1_hex: hex,
                continuity: this.continuityState,
            });
        } catch (e) {
            this._log('zrtpRs1Update emit threw:', (e && e.message) || e);
        }
        // Track locally so subsequent code paths in this same session can
        // see the rotated value without waiting for the round-trip back
        // through props/state.
        this.localRs1 = rs1Bytes;
        this.localRsIdHex = rsIdHexOf(rs1Bytes);
    }

    // Called by app.js when the user has compared the SAS and tapped
    // Confirm in the SAS dialog. Seeds (or refreshes) rs1 regardless of
    // the current continuity state — this is the user's explicit
    // statement that "this is the right peer".
    //
    // Also flips continuityState to 'verified' so the UI pill stops
    // showing 'mismatch'/'first-time' immediately. Without this the
    // session-level continuity decision would stay frozen at whatever
    // _deriveAndLog computed at handshake time, and _zrtpVerificationStatus
    // would keep returning 'mismatch' until the next call.
    confirmSasAndSeedRs1() {
        const next = this._deriveNextRs1();
        if (!next) return null;
        this._emitRs1Update(next);
        this._rotated = true;
        this.continuityState = 'verified';
        return toHex(next);
    }

    // Forget the stored rs1 for this peer. Used when the user taps
    // Continue past the mismatch alarm — we drop our binding and the
    // call proceeds without continuity until the user re-verifies SAS.
    clearRs1() {
        this.localRs1 = null;
        this.localRsIdHex = null;
        try {
            this.call.emit('zrtpRs1Clear', {
                uri: this.peerUri,
                device_id: this.peerDeviceId || null,
            });
        } catch (e) {
            this._log('zrtpRs1Clear emit threw:', (e && e.message) || e);
        }
    }

    // Media kinds ('audio' / 'video') that are end-to-end encrypted in
    // BOTH directions on this session. Used by the UI pill to say
    // "zRTP audio", "zRTP video", or "zRTP audio and video".
    get encryptedKinds() {
        const out = [];
        for (const kind of ['audio', 'video']) {
            if (this._installedSenderKinds.has(kind)
                    && this._installedReceiverKinds.has(kind)) {
                out.push(kind);
            }
        }
        return out;
    }

    _deriveAndLog() {
        // X25519 ECDH
        this.sharedSecret = nacl.scalarMult(this.ephemeral.secretKey, this.peerEphemPub);
        this._log('ECDH shared secret hex:', _hexForLog(this.sharedSecret));

        // Decide continuity state and pick HKDF salt accordingly.
        // See docs/encryption/zrtp/Readme.md for the policy table.
        let salt = new Uint8Array(32); // RFC 5869: zero-salt when no salt available
        const localId = this.localRsIdHex;
        const peerId = this.peerRsIdHex;
        if (this.negotiatedVersion < 2 || !this.localRs1) {
            if (peerId && !this.localRs1) {
                this.continuityState = 'one-sided-peer';
            } else if (localId && !peerId) {
                this.continuityState = 'one-sided-local';
            } else {
                this.continuityState = 'first-time';
            }
            this._mixedRs1 = false;
        } else if (!peerId) {
            this.continuityState = 'one-sided-local';
            this._mixedRs1 = false;
        } else if (peerId === localId) {
            this.continuityState = 'verified';
            salt = this.localRs1;
            this._mixedRs1 = true;
        } else {
            // Both sides hold an rs1 but they differ — reinstall or MitM.
            // Derive with zero salt so the call still proceeds, but do NOT
            // rotate the stored secret automatically; the app surfaces the
            // mismatch alarm and the user decides.
            this.continuityState = 'mismatch';
            this._mixedRs1 = false;
        }
        this._log('continuity=', this.continuityState, 'mixed_rs1=', this._mixedRs1);

        // HKDF-SHA256 — derive 4 outputs labeled by direction (caller↔callee)
        const k_c2e = hkdf(this.sharedSecret, salt, 'sylk-e2ee/v1/audio-caller-to-callee', 16);
        const k_e2c = hkdf(this.sharedSecret, salt, 'sylk-e2ee/v1/audio-callee-to-caller', 16);
        const s_c2e = hkdf(this.sharedSecret, salt, 'sylk-e2ee/v1/audio-caller-to-callee-salt', 8);
        const s_e2c = hkdf(this.sharedSecret, salt, 'sylk-e2ee/v1/audio-callee-to-caller-salt', 8);

        this.derivedKeys = {
            audioCallerToCallee: toHex(k_c2e),
            audioCalleeToCaller: toHex(k_e2c),
            audioCallerToCalleeSalt: toHex(s_c2e),
            audioCalleeToCallerSalt: toHex(s_e2c),
        };

        if (_isDev()) {
            this._log('HKDF caller->callee key  =', this.derivedKeys.audioCallerToCallee);
            this._log('HKDF callee->caller key  =', this.derivedKeys.audioCalleeToCaller);
            this._log('HKDF caller->callee salt =', this.derivedKeys.audioCallerToCalleeSalt);
            this._log('HKDF callee->caller salt =', this.derivedKeys.audioCalleeToCallerSalt);
        } else {
            this._log('HKDF keys/salts derived (redacted in release build)');
        }

        // SAS — derive 8 bytes; first 4 → chars, next 4 → emojis. Both
        // endpoints derive identical SAS from the same shared secret.
        const sasBytes = hkdf(this.sharedSecret, salt, 'sylk-zrtp/v1/sas', 8);
        const chars = Array.from(sasBytes.slice(0, 4)).map(b => SAS_CHARS[b & 0x1F]).join('');
        const emojis = Array.from(sasBytes.slice(4, 8)).map(b => SAS_EMOJIS[b & 0x1F]).join('');
        this.sas = { chars, emojis };
        this._log('SAS chars:', chars, 'emojis:', emojis);

        // User-facing handshake-success summary — ECDH + HKDF + SAS
        // are all done at this point, both sides have the same shared
        // key. Emit ONE clean line into the applog so it shows up in
        // the in-app Show Logs viewer / support email; the verbose
        // per-step traces above stay on console only via this._log.
        //
        // Same verification logic as AudioCallBox._zrtpVerificationStatus:
        //   - no stored SAS+key on file → 'unverified' (first time on
        //     this peer, user can verify on the dialog)
        //   - stored.publicKey matches the current contact PGP key →
        //     'verified' (we trust the binding established earlier)
        //   - stored.publicKey differs from current PGP key → 'mismatch'
        //     (peer's identity key rotated; could be reinstall, could
        //     be MITM — surfaced loudly so support can see it).
        let verification = 'unverified';
        try {
            const stored = this.contact
                && this.contact.localProperties
                && this.contact.localProperties.zrtp;
            const currentKey = this.contact && this.contact.publicKey;
            if (stored && stored.publicKey) {
                verification = (currentKey && constantTimeStringEqual(stored.publicKey, currentKey))
                    ? 'verified'
                    : 'mismatch';
            }
        } catch (e) { /* default to 'unverified' */ }
        utils.timestampedLog('[call] [zrtp] call_id=' + this.callId,
            'handshake completed with', this.peerUri,
            'role=', this.role, 'sas=', chars, emojis, 'peer=', verification);
    }

    destroy() {
        this._log('destroy');
        this._destroyed = true;
        this._stopMediaActivityPoller();
    }
}

// ----- registry keyed by sylkrtc Call's local id -------------------------

const sessions = new Map();

// Persistence callbacks injected by app.js at boot. The session emits
// 'zrtpRs1Update' / 'zrtpRs1Clear' on the Call when rs1 needs to be
// persisted or forgotten; the listeners attached inside startZrtpForCall
// and dispatchIncomingZrtp fan those out to these module-level hooks so
// the storage logic stays in app.js (where saveSylkContact lives) without
// CallZrtp.js needing to import it.
let _rs1PersistFn = null;
let _rs1PersistClearFn = null;

export function registerZrtpRs1Handlers(persistFn, clearFn) {
    _rs1PersistFn = typeof persistFn === 'function' ? persistFn : null;
    _rs1PersistClearFn = typeof clearFn === 'function' ? clearFn : null;
}

function _attachRs1Listeners(call) {
    if (!call || typeof call.on !== 'function') return;
    try {
        call.on('zrtpRs1Update', (info) => {
            try {
                if (_rs1PersistFn && info && info.uri && info.rs1_hex) {
                    _rs1PersistFn(info.uri, info.device_id, info.rs1_hex, info.continuity);
                }
            } catch (e) {
                console.log('[zrtp] zrtpRs1Update handler threw:', (e && e.message) || e);
            }
        });
        call.on('zrtpRs1Clear', (info) => {
            try {
                if (_rs1PersistClearFn && info && info.uri) {
                    _rs1PersistClearFn(info.uri, info.device_id);
                }
            } catch (e) {
                console.log('[zrtp] zrtpRs1Clear handler threw:', (e && e.message) || e);
            }
        });
    } catch (e) {
        console.log('[zrtp] _attachRs1Listeners failed:', (e && e.message) || e);
    }
}

const _idOf = (call) => call._id || call.id;

// Resolve the SIP Call-ID off a sylkrtc Call object — used by every
// log line outside ZrtpSession so a single grep through metro.log can
// filter the whole call lifecycle by SIP Call-ID. Inside ZrtpSession
// we have `this.callId` directly; this helper exists for module-level
// helpers (startZrtpForCall, dispatchIncomingZrtp, _attachCleanup,
// _emitMandatoryFailed*) that only get the Call object.
const _callIdOf = (call) => {
    if (!call) return '?';
    return call._callId || call.callId || call._id || call.id || '?';
};

// Standalone version of ZrtpSession._negotiatedVideoCodec for use BEFORE
// the session is created. Reads the call's pc.remoteDescription, finds
// the first non-rtx/red codec on the m=video line, returns its name in
// uppercase. Returns null if no SDP / no video m-line / parse error —
// caller treats null as "couldn't determine, proceed with E2EE".
function _peekNegotiatedVideoCodec(call) {
    try {
        const pc = call && call._pc;
        if (!pc) return null;
        const desc = pc.remoteDescription || pc.currentRemoteDescription;
        const sdp = (desc || {}).sdp;
        if (!sdp) return null;
        const lines = sdp.split('\r\n');
        let firstPayload = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('m=video ')) {
                const parts = line.split(' ');
                firstPayload = parts[3];
                continue;
            }
            if (line.startsWith('m=')) firstPayload = null;
            if (firstPayload && line.startsWith('a=rtpmap:' + firstPayload + ' ')) {
                const codec = line.split(' ')[1].split('/')[0];
                return (codec || '').toUpperCase();
            }
        }
    } catch (e) {
        // fall through
    }
    return null;
}

// H.264 with E2EE doesn't work on our current video FrameEncryptor. The
// H.264 RTP packetizer uses STAP-A (multi-NAL aggregation) for small
// frames; our fixed N-byte unencrypted prefix only protects the first
// NAL's header, leaving the size fields and subsequent NAL headers
// encrypted — depacketizer reads garbage, decoder drops the packet, video
// freezes both ways. Audio works because Opus has no equivalent layer.
//
// PRE-FIX: This function was used as an early-return gate at the start of
// startZrtpForCall / dispatchIncomingZrtp, which meant the H.264 case
// skipped EVERYTHING — including the audio handshake. That dropped audio
// E2EE for any call that had H264 video, even though Opus audio E2EE
// works fine.
//
// NOW: the function is renamed to indicate it only suppresses VIDEO
// E2EE install, and the early-return gates are gone. The handshake
// completes, audio install proceeds normally, and only the per-video-
// track install/decrypt is skipped inside _installReceivers /
// _installSenders. Audio frames are still AES-128-GCM end-to-end; video
// continues to flow plain SRTP/DTLS until a NAL-aware encryptor ships.
function _shouldSkipVideoZrtpForCodec(call) {
    const codec = _peekNegotiatedVideoCodec(call);
    if (codec === 'H264') {
        return true;
    }
    return false;
}

function _attachCleanup(call, id, session) {
    const onState = (oldS, newS) => {
        if (newS === 'terminated') {
            console.log('[call] [zrtp] call_id=' + _callIdOf(call),
                        'cleanup session', id);
            session.destroy();
            sessions.delete(id);
            try { call.removeListener('stateChanged', onState); } catch (e) {}
        }
    };
    call.on('stateChanged', onState);
}

// Surface a "mandatory zRTP could not be established" event on the
// sylkrtc Call. Call.js listens and pops the user-facing modal with
// End-call / Continue actions. If nothing is listening (test harness,
// rendering bug, race), fall back to terminating so users still get
// mandatory enforcement honored — just without the prompt.
//
// reasonCode: short machine-readable string ('no-public-key' /
//   'incompatible-codec' / 'timeout') for diagnostics.
// detail: longer human-readable string for the log.
function _emitMandatoryFailed(call, reasonCode, detail) {
    const cid = _callIdOf(call);
    utils.timestampedLog('[call] [zrtp] call_id=' + cid,
              'MANDATORY mode failed: reason=' + reasonCode
              + ' detail=' + detail
              + ' — emitting zrtpMandatoryFailed');
    let delivered = false;
    try {
        // EventEmitter.emit returns true iff at least one listener was
        // invoked — use that to detect "nobody listened" and fall back
        // to terminating the call so mandatory enforcement is honored
        // even if Call.js isn't mounted yet (rare race window).
        delivered = call.emit('zrtpMandatoryFailed',
                              { reason: reasonCode, detail }) === true;
    } catch (e) {
        console.log('[call] [zrtp] call_id=' + cid,
                    'zrtpMandatoryFailed emit threw (' +
                    ((e && e.message) || e) + ')');
        delivered = false;
    }
    if (!delivered) {
        utils.timestampedLog('[call] [zrtp] call_id=' + cid,
                    'no listener for zrtpMandatoryFailed — terminating call');
        try { call.terminate(); } catch (_) {}
    }
}

// Same as _emitMandatoryFailed, but waits ZRTP_MANDATORY_TIMEOUT_MS
// (10 s) before firing. Used by the immediate-fail paths in
// startZrtpForCall / dispatchIncomingZrtp (no PGP key, H.264 codec) so
// the user-facing prompt doesn't pop up the instant the call connects.
// Aligns the visible behavior with the regular handshake-timeout path,
// where the user only sees the modal after the same 10-second window.
//
// Cancelled if the call terminates before the deadline (no point
// prompting for an already-ended call).
function _emitMandatoryFailedDelayed(call, reasonCode, detail) {
    const cid = _callIdOf(call);
    utils.timestampedLog('[call] [zrtp] call_id=' + cid,
              'MANDATORY mode immediate-fail (reason=' + reasonCode
              + ') — deferring prompt by ' + ZRTP_MANDATORY_TIMEOUT_MS + 'ms');
    let cancelled = false;
    const onState = (oldS, newS) => {
        if (newS === 'terminated') {
            cancelled = true;
            try { call.removeListener('stateChanged', onState); } catch (_) {}
        }
    };
    try { call.on('stateChanged', onState); } catch (_) {}
    setTimeout(() => {
        try { call.removeListener('stateChanged', onState); } catch (_) {}
        if (cancelled) {
            console.log('[call] [zrtp] call_id=' + cid,
                        'deferred mandatory-fail prompt cancelled — call already terminated');
            return;
        }
        _emitMandatoryFailed(call, reasonCode, detail);
    }, ZRTP_MANDATORY_TIMEOUT_MS);
}

// REMOVED: _attachOptionalDowngradeWarning
//
// Previously, in OPTIONAL mode we emitted a 'zrtpDowngradeWarning' event
// when the handshake didn't reach key-agreed within
// ZRTP_MANDATORY_TIMEOUT_MS, which AudioCallBox / VideoBox surfaced as
// the "End-to-end encryption was attempted but did not activate" banner.
//
// That contradicted the OPTIONAL-mode contract documented in the
// Preferences screen ("falls back to DTLS if negotiation fails") — the
// user-visible promise is a SILENT fallback. The banner also duplicated
// existing UX surface for the case the user actually wants signalled:
// MANDATORY mode failure already shows a dedicated end-or-continue
// modal via _attachMandatoryTimeout → 'zrtpMandatoryFailed' →
// AudioCallBox.zrtpMandatoryFailed.
//
// Optional-mode failure is therefore now silent. If you ever need a
// soft warning in optional mode again, re-introduce a helper here and
// re-wire it at the two call sites (sender path after startProbe(),
// callee path in dispatchIncomingZrtp). The banner UI itself lives in
// AudioCallBox.js (zrtpDowngradeBannerVisible) and VideoBox.js and is
// retained as dead code in case it gets reused.

function _attachMandatoryTimeout(call, id, session) {
    if (_encryptionMode !== 'zrtp_mandatory') return;
    let cancelled = false;
    const timer = setTimeout(() => {
        if (cancelled) return;
        const st = session.state;
        if (st === 'key-agreed') return;
        _emitMandatoryFailed(call, 'timeout',
            'handshake did not reach key-agreed within '
            + ZRTP_MANDATORY_TIMEOUT_MS + 'ms (state=' + st + ')');
    }, ZRTP_MANDATORY_TIMEOUT_MS);

    const onState = (oldS, newS) => {
        if (newS === 'key-agreed' || newS === 'terminated') {
            cancelled = true;
            clearTimeout(timer);
            try { call.removeListener('stateChanged', onState); } catch (e) {}
        }
    };
    call.on('stateChanged', onState);
    // Monkey-patch session._setState so we cancel the timer the
    // moment ZRTP key-agreed is reached. Cleaner than exposing a new
    // event surface on ZrtpSession just for this diagnostic.
    const origSetState = session._setState
        ? session._setState.bind(session) : null;
    if (origSetState) {
        session._setState = (newS) => {
            origSetState(newS);
            if (newS === 'key-agreed') {
                cancelled = true;
                clearTimeout(timer);
            }
        };
    }
}

/**
 * Caller-side: kick off the probe once the call is established.
 * Safe to call multiple times — only the first call per Call object starts a
 * session.
 */
export function startZrtpForCall(call, account, contact, myKeys) {
    const cid = _callIdOf(call);
    if (_encryptionMode === 'sdes') {
        utils.timestampedLog('[call] [zrtp] call_id=' + cid,
                  'mode=sdes — no end-to-end encryption requested,'
                  + ' skipping outgoing key exchange');
        return null;
    }
    if (!contact || !contact.publicKey) {
        if (_encryptionMode === 'zrtp_mandatory') {
            // Mandatory mode but we have no PGP key for this contact —
            // the handshake can't even start. Surface the prompt so the
            // user decides (end / continue) instead of silently dropping.
            // Deferred by 10 s so the user has a chance to see the call
            // connect before the warning lands.
            _emitMandatoryFailedDelayed(call, 'no-public-key',
                'no PGP public key cached for ' + (contact && contact.uri));
            return null;
        }
        utils.timestampedLog('[call] [zrtp] call_id=' + cid,
                  'no public key for', contact && contact.uri, '— skipping');
        return null;
    }
    if (!account) {
        console.log('[call] [zrtp] call_id=' + cid,
                    'no account passed — skipping');
        return null;
    }
    // Capability gate: only start the handshake if the peer signaled
    // X-Sylk-ZRTP on the 200 OK. The flag is set by Call.js when the
    // call's state transitions to 'accepted' (see the stateChanged
    // listener that calls peerSupportsZrtpFromHeaders on the headers
    // payload). Saves probe-vs-500-reject roundtrip on non-Sylk peers
    // and avoids racing legacy ZRTP/SRTP on peers that don't speak
    // our scheme.
    if (!call._peerSupportsZrtp) {
        utils.timestampedLog('[call] [zrtp] call_id=' + cid,
                  'peer did not signal X-Sylk-ZRTP on 200 OK — skipping probe');
        return null;
    }
    // H.264 used to bail here entirely; that dropped audio E2EE too. Now
    // we proceed with the handshake unconditionally and the H.264 check
    // moves inside _installReceivers/_installSenders, where it only
    // suppresses the VIDEO install. Audio still gets full AES-128-GCM.
    const id = _idOf(call);
    if (sessions.has(id)) {
        console.log('[call] [zrtp] call_id=' + cid,
                    'session already exists for call', id);
        return sessions.get(id);
    }
    const s = new ZrtpSession({ call, account, contact, myKeys, role: 'caller' });
    sessions.set(id, s);
    _attachCleanup(call, id, s);
    _attachRs1Listeners(call);
    _attachMandatoryTimeout(call, id, s);
    // OPTIONAL-mode downgrade banner intentionally not attached — see the
    // removal note where _attachOptionalDowngradeWarning used to live.
    // Optional mode silently falls back to DTLS, matching the contract
    // promised by the Preferences screen.
    s.startProbe();
    return s;
}

/**
 * Receiver-side dispatcher: invoke when an incoming message with
 * contentType === ZRTP_CONTENT_TYPE arrives (plain JSON on the wire —
 * the PGP wrap was removed because the handshake payload is not
 * secret). Creates a callee-role session on first contact and feeds
 * it the JSON. Devices that aren't in the matching call drop the
 * message via call_id check inside handleIncoming.
 */
export function dispatchIncomingZrtp(call, account, contact, myKeys, content) {
    const cid = _callIdOf(call);
    if (_encryptionMode === 'sdes') {
        console.log('[call] [zrtp] call_id=' + cid,
                    'mode=sdes — ignoring incoming key exchange');
        return;
    }
    if (!account) {
        console.log('[call] [zrtp] call_id=' + cid,
                    'no account passed — ignoring incoming');
        return;
    }
    // Callee policy: always honor an incoming application/sylk-zrtp-negotiation
    // MESSAGE as a legitimate escalation request. The X-Sylk-ZRTP capability
    // header is only useful on the *caller* side (so SIP clients don't fire
    // probes at peers that would reject the MESSAGE with 500). On the callee
    // side a probe arriving at all is itself proof the peer can speak it —
    // gating it on a header sylk-server may have stripped between Janus and
    // the WebSocket would lock out raw SIP callers. If the peer did
    // advertise it (e.g. another Sylk Mobile or a sip-session3 reachable
    // through a header-forwarding gateway), call._peerSupportsZrtp is
    // already set and we just engage; if it didn't, engage anyway.
    if (!call._peerSupportsZrtp) {
        utils.timestampedLog('[call] [zrtp] call_id=' + cid,
                  'incoming probe accepted (peer did not advertise X-Sylk-ZRTP, but the MESSAGE itself is sufficient evidence)');
    }
    // H.264-codec early-return removed — see the matching comment in
    // startZrtpForCall. The handshake now always runs; H.264 only causes
    // the video-track install to be skipped inside _installReceivers /
    // _installSenders. Audio E2EE works regardless.
    const id = _idOf(call);
    let s = sessions.get(id);
    if (!s) {
        s = new ZrtpSession({ call, account, contact, myKeys, role: 'callee' });
        sessions.set(id, s);
        _attachCleanup(call, id, s);
        _attachRs1Listeners(call);
        _attachMandatoryTimeout(call, id, s);
        // OPTIONAL-mode downgrade banner intentionally not attached —
        // see the removal note where _attachOptionalDowngradeWarning
        // used to live.
    }
    s.handleIncoming(content);
}

/** Test helper: peek at session state from outside the module. */
export function getZrtpSession(call) {
    return sessions.get(_idOf(call));
}

/**
 * Re-apply the encoder-side video target (scaleResolutionDownBy +
 * maxFramerate + maxBitrate) on the video sender for `call`. The
 * normal install path runs _applyVideoBitrate ONCE during the ZRTP
 * handshake; once it succeeds (or no-ops because there's no video
 * sender yet) _videoBitrateApplied latches true and the function
 * is never called again.
 *
 * That's the wrong shape for the audio→video upgrade path: a call
 * that started as audio has the ZRTP handshake (and one-shot encoder
 * apply) complete before there's any video sender at all. When
 * call.addVideo() / call.answerUpdate() add the new video track
 * mid-call, the new sender starts with the camera's native preferred
 * mode (commonly 1088x1088 or 1920x1080 @ 30 fps on phones that pick
 * a "square selfie" / portrait capture mode) and libwebrtc never
 * gets the scaleResolutionDownBy / maxFramerate caps that the
 * initial-video path applied.
 *
 * Call this from Call.js's mediaUpdated handler so the upgrade path
 * gets the same encoder treatment as the initial-video path. No-op
 * when no session exists for the call (e.g. encryption mode = sdes,
 * or the handshake hasn't started yet — in that case the install
 * path will pick this up the first time it runs).
 */
export function reapplyVideoEncoderParams(call) {
    if (!call) return;
    const s = sessions.get(_idOf(call));
    if (!s) return;
    // Force the one-shot guard to drop so the next apply actually
    // visits each video sender.
    s._videoBitrateApplied = false;
    try { s._applyVideoBitrate(); } catch (e) {
        try {
            utils.timestampedLog('[call] [zrtp] call_id=' + _callIdOf(call),
                'reapplyVideoEncoderParams threw:', (e && e.message) || e);
        } catch (_) {}
    }
}

/**
 * Apply the video encoder caps (maxBitrate / maxFramerate /
 * scaleResolutionDownBy) directly to a peer connection's video
 * senders, WITHOUT requiring a ZrtpSession to exist.
 *
 * Background: _applyVideoBitrate() lives on ZrtpSession and is the
 * only place that calls RTCRtpSender.setParameters({encodings:
 * [{maxBitrate}]}). For 1-to-1 calls the ZRTP handshake (and its
 * one-shot encoder apply) runs whenever the peer has a PGP key.
 * Conferences don't HAVE a peer-to-peer ZRTP session — the call
 * target is a room, not a person — so startZrtpForCall returns
 * null and the encoder caps never get pushed. The result: the
 * publisher PC runs at libwebrtc's default (~1.5–2 Mbps for 480p)
 * instead of the configured VIDEO_PROFILE.maxBitrateKbps (800 kbps
 * for 480p).
 *
 * This helper is the conference-friendly version. It reads the
 * SAME module-level _videoMaxBitrateKbps / _videoTargetWidth /
 * _videoTargetHeight / _videoTargetFramerate that
 * _applyVideoBitrate uses, so a single setVideoMaxBitrateKbps()
 * call at app boot caps both paths. The fresh-snapshot merge logic
 * is duplicated here (rather than refactored) to avoid disturbing
 * the well-tested ZrtpSession version on the way to a fix.
 *
 * `label` is a short string used in log lines so the call site is
 * identifiable in metro.log (e.g. 'conference-join',
 * 'conference-resolution-change').
 */
export async function applyVideoEncoderParamsToPc(pc, label) {
    if (!pc || typeof pc.getSenders !== 'function') return;
    if (_videoMaxBitrateKbps === null
        && _videoTargetWidth === null
        && _videoTargetHeight === null
        && _videoTargetFramerate === null) return;
    const tag = '[video] [' + (label || 'conference') + ']';
    for (const s of pc.getSenders()) {
        if (!s.track || s.track.kind !== 'video') continue;
        try {
            const params = s.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            if (_videoMaxBitrateKbps !== null) {
                params.encodings[0].maxBitrate = _videoMaxBitrateKbps * 1000;
            }
            if (_videoTargetFramerate !== null) {
                params.encodings[0].maxFramerate = _videoTargetFramerate;
            }
            // Compute scaleResolutionDownBy from actual track size so
            // a camera that overshot our hint (1088x1088 on some
            // Android cameras) still ends up scaled down to the
            // target resolution. Same approach as ZrtpSession's
            // _applyVideoBitrate.
            if (_videoTargetWidth !== null && _videoTargetHeight !== null) {
                let scale = 1.0;
                try {
                    const settings = (typeof s.track.getSettings === 'function')
                        ? s.track.getSettings() : null;
                    const tw = settings && settings.width  ? settings.width  : null;
                    const th = settings && settings.height ? settings.height : null;
                    if (tw && th) {
                        const sx = tw / _videoTargetWidth;
                        const sy = th / _videoTargetHeight;
                        scale = Math.max(1.0, Math.max(sx, sy));
                    }
                } catch (sizeErr) { /* best effort */ }
                if (scale < 1.0) scale = 1.0;
                params.encodings[0].scaleResolutionDownBy = scale;
            }

            // Re-fetch encoder params right before setParameters and
            // MERGE our 3 fields onto each encoding (rather than
            // overwriting the whole array). WebRTC's setParameters
            // requires the complete encodings array — passing a
            // partial object resets every other field (including
            // `active`, `rid`, the simulcast layers, etc.) on the
            // wire. The merge keeps anything else the call may have
            // set (camera-enable's active:true flag, etc.) intact.
            try {
                const fresh = s.getParameters();
                if (fresh && Array.isArray(fresh.encodings) && fresh.encodings.length > 0) {
                    const ours = params.encodings[0];
                    fresh.encodings.forEach((e) => {
                        if (ours.maxBitrate !== undefined) e.maxBitrate = ours.maxBitrate;
                        if (ours.maxFramerate !== undefined) e.maxFramerate = ours.maxFramerate;
                        if (ours.scaleResolutionDownBy !== undefined) {
                            e.scaleResolutionDownBy = ours.scaleResolutionDownBy;
                        }
                    });
                    await s.setParameters(fresh);
                } else {
                    await s.setParameters(params);
                }
                utils.timestampedLog(tag, 'sender encoder params set:',
                          'maxBitrate=', _videoMaxBitrateKbps, 'kbps',
                          'maxFramerate=', _videoTargetFramerate,
                          'scaleResolutionDownBy=', params.encodings[0].scaleResolutionDownBy);
            } catch (mergeErr) {
                try { await s.setParameters(params); } catch (_) {}
                utils.timestampedLog(tag, 'merge path threw, fallback applied:',
                          (mergeErr && mergeErr.message) || mergeErr);
            }
        } catch (e) {
            utils.timestampedLog(tag, 'setParameters failed:',
                      (e && e.message) || e);
        }
    }
}

/**
 * Force-teardown the ZRTP session for a given Call object. Safe to
 * call from anywhere (idempotent: no-op if there's no session for the
 * call). Belt-and-braces companion to _attachCleanup — for the cases
 * where sylkrtc never delivers a stateChanged → 'terminated' event
 * (observed when a remote BYE is missed by the WebSocket: caller's
 * pc stays alive, packets stop, call.state never transitions, the
 * media-activity poller ticks forever). Hook this into UI teardown
 * (componentWillUnmount, hangup) so the session is reclaimed even
 * when the sylkrtc event path is unreliable.
 */
export function stopZrtpForCall(call) {
    if (!call) return;
    const id = _idOf(call);
    const s = sessions.get(id);
    if (!s) return;
    try {
        utils.timestampedLog('[call] [zrtp] call_id=' + _callIdOf(call),
            'stopZrtpForCall — explicit teardown for session', id);
    } catch (_) {}
    try { s.destroy(); } catch (_) {}
    sessions.delete(id);
}
