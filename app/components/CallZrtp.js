// CallZrtp.js
//
// Per-call ZRTP-style E2EE handshake state machine — SIMULATION ONLY.
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
import OpenPGP from 'react-native-fast-openpgp';
import CryptoJS from 'crypto-js';
import utils from '../utils';                  // timestampedLog() for [ZRTP] lines that should also reach the in-app Show Logs viewer

export const ZRTP_CONTENT_TYPE = 'application/sylk-zrtp-negotiation';
const VERSION = 1;

// Diagnostic switch — set to true to short-circuit the install steps and
// run the handshake in "logging only" mode (keys derived, SAS shown, but
// no FrameEncryptor / FrameDecryptor is attached to the peer connection).
// Useful for isolating broken-video issues from the encryption layer.
const ZRTP_INSTALL_DISABLED = false;

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
// Wired from app.js's _applyDevicePreferences at boot and from
// setDevicePreference() when the user changes the radio.
const ENCRYPTION_MODES = ['sdes', 'zrtp_optional', 'zrtp_mandatory'];
const ENCRYPTION_MODE_DEFAULT = 'zrtp_optional';
const ZRTP_MANDATORY_TIMEOUT_MS = 6000;

let _encryptionMode = ENCRYPTION_MODE_DEFAULT;

export function setEncryptionMode(mode) {
    if (ENCRYPTION_MODES.indexOf(mode) === -1) {
        utils.timestampedLog('[ZRTP] setEncryptionMode: invalid mode', mode,
                    '— ignoring (recognized:', ENCRYPTION_MODES.join('/'), ')');
        return;
    }
    _encryptionMode = mode;
    utils.timestampedLog('[ZRTP] encryption mode =', _encryptionMode);
}

export function getEncryptionMode() {
    return _encryptionMode;
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

// ----- HKDF-SHA256(IKM, salt, info, L) using crypto-js -------------------

function hkdf(ikm, salt, infoStr, length) {
    const ikmWA = CryptoJS.enc.Hex.parse(toHex(ikm));
    const saltWA = CryptoJS.enc.Hex.parse(toHex(salt));
    const prk = CryptoJS.HmacSHA256(ikmWA, saltWA);                      // extract
    const infoWA = CryptoJS.enc.Utf8.parse(infoStr).concat(CryptoJS.enc.Hex.parse('01'));
    const t1 = CryptoJS.HmacSHA256(infoWA, prk);                         // expand (single block)
    return fromHex(t1.toString(CryptoJS.enc.Hex).substring(0, length * 2));
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
        // Video bitrate cap is applied once per session.
        this._videoBitrateApplied = false;
        this._log('created — local ephem pub (hex prefix):',
            toHex(this.ephemeral.publicKey).slice(0, 16) + '… call_id=', this.callId);
    }

    _log(...args) {
        console.log('[ZRTP]', this.localId, this.role, ...args);
    }

    /**
     * Update internal state and emit a 'zrtpStateChanged' event on the
     * sylkrtc Call so React components (e.g. AudioCallBox) can react.
     * Possible states: idle | probing | key-agreed | failed.
     */
    _setState(newState) {
        this.state = newState;
        try {
            this.call.emit('zrtpStateChanged', newState);
        } catch (e) {
            // Call object may be torn down already; ignore.
        }
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
        this._log('SEND probe (via account.sendMessage):', payload);

        let encrypted;
        try {
            encrypted = await this._pgpWrap(JSON.stringify(payload));
        } catch (e) {
            this._log('pgp wrap failed:', (e && e.message) || e);
            this._setState('failed');
            return;
        }

        // account.sendMessage(uri, content, contentType, options, cb)
        this.account.sendMessage(this.peerUri, encrypted, ZRTP_CONTENT_TYPE, {}, (err) => {
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

        if (payload.v !== VERSION) {
            this._log('version mismatch — got', payload.v, 'expected', VERSION);
            return;
        }
        // Account-messages may be forked to other devices of the recipient.
        // Each device only acts on the handshake when its active call's SIP
        // Call-ID matches the payload's; otherwise drop silently.
        if (payload.call_id && payload.call_id !== this.callId) {
            this._log('call_id mismatch — payload', payload.call_id, 'ours', this.callId, '— ignoring');
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
        if (!payload.ephem_pub_hex) { this._log('probe missing ephem_pub_hex'); return; }
        this.peerEphemPub = fromHex(payload.ephem_pub_hex);
        this._deriveAndLog();

        // Phase A on this side: install recv_dec only.
        await this._installReceivers();

        const accept = {
            v: VERSION,
            type: 'accept',
            call_id: this.callId,
            ephem_pub_hex: toHex(this.ephemeral.publicKey),
        };
        this._log('SEND accept:', accept);
        await this._sendSigned(accept, 'accept');
    }

    // Caller receives callee's accept: derive keys, install recv_dec, then
    // signal recv_ready so callee knows it can install sender_enc safely.
    async _handleAccept(payload) {
        if (!payload.ephem_pub_hex) { this._log('accept missing ephem_pub_hex'); return; }
        this.peerEphemPub = fromHex(payload.ephem_pub_hex);
        this._deriveAndLog();

        // Phase A: install recv_dec.
        await this._installReceivers();

        const recvReady = { v: VERSION, type: 'recv_ready', call_id: this.callId };
        this._log('SEND recv_ready');
        await this._sendSigned(recvReady, 'recv_ready');
    }

    // recv_ready arrived — peer has its decryptor in place. We can safely
    // install sender_enc on this side. After install, signal sender_ready.
    async _handleRecvReady(/*payload*/) {
        if (this._sendersInstalled) {
            this._log('recv_ready: senders already installed — ignoring');
            return;
        }
        // Caller may not yet have installed its own recv_dec when this
        // ack arrives (callee is the one that sent it after its own
        // handshake). Install our receivers if we haven't already.
        await this._installReceivers();

        await this._installSenders();

        const senderReady = { v: VERSION, type: 'sender_ready', call_id: this.callId };
        this._log('SEND sender_ready');
        await this._sendSigned(senderReady, 'sender_ready');

        this._setState('key-agreed');
        this._log('state -> key-agreed');
    }

    // sender_ready arrived — peer has installed sender_enc. We may not
    // yet have installed our own sender_enc on this side (caller path).
    async _handleSenderReady(/*payload*/) {
        await this._installSenders();
        this._setState('key-agreed');
        this._log('state -> key-agreed');
    }

    async _sendSigned(obj, label) {
        let encrypted;
        try {
            encrypted = await this._pgpWrap(JSON.stringify(obj));
        } catch (e) {
            this._log('pgp wrap failed (' + label + '):', (e && e.message) || e);
            this._setState('failed');
            return;
        }
        this.account.sendMessage(this.peerUri, encrypted, ZRTP_CONTENT_TYPE, {}, (err) => {
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

    // Phase A — install FrameDecryptor on every receiver. Safe to call as
    // soon as keys are derived: the C++ decryptor is permissive — it passes
    // through any bytes that don't decrypt, so peer plaintext frames still
    // reach the codec while we wait for the peer to install its sender_enc.
    async _installReceivers() {
        if (this._receiversInstalled) return;
        if (ZRTP_INSTALL_DISABLED) {
            this._log('_installReceivers: ZRTP_INSTALL_DISABLED — skipping');
            this._receiversInstalled = true;
            return;
        }
        const k = this._directionKeys();
        if (!k) { this._log('_installReceivers: no derived keys yet'); return; }
        const pc = this.call._pc;
        if (!pc || typeof pc.getReceivers !== 'function') {
            this._log('_installReceivers: no _pc/getReceivers'); return;
        }
        const codec  = this._negotiatedVideoCodec();
        const prefix = ZrtpSession.unencryptedVideoPrefixForCodec(codec);
        this._log('[video] PHASE A install receivers; role=' + this.role +
                  ' recv.key=' + k.recvKey.slice(0, 8) + '… codec=' + codec + ' prefix=' + prefix);
        const receivers = pc.getReceivers();
        for (const r of receivers) {
            if (!r.track) continue;
            try {
                await r.setMediaDecryption(k.recvKey, k.recvSalt, k.keyId, prefix);
                this._log('[' + r.track.kind + '] receiver decryption installed');
                // Applog proof: the native call returned without throwing,
                // which means react-native-webrtc bound the FrameDecryptor
                // for this RTP receiver. Frames arriving on this track
                // are now decrypted through our HKDF-derived key in the
                // native pipeline before the JS side ever sees them.
                // The 8-char key prefix is included so a support engineer
                // can correlate caller and callee logs without exposing
                // the full key.
                utils.timestampedLog('[ZRTP]', r.track.kind, 'receiver SRTP DECRYPTION ACTIVE',
                    'with peer', this.peerUri,
                    'key prefix=' + (k.recvKey ? k.recvKey.slice(0, 8) : '?') + '…',
                    'codec=', codec);
            } catch (e) {
                this._log('[' + r.track.kind + '] receiver install failed:', (e && e.message) || e);
                utils.timestampedLog('[ZRTP]', r.track.kind, 'receiver SRTP install FAILED with peer',
                    this.peerUri, '— error:', (e && e.message) || String(e));
            }
        }
        this._receiversInstalled = true;
    }

    // Phase B — install FrameEncryptor on every sender. Only called after
    // peer has signaled recv_ready (or sender_ready), confirming peer has
    // its decryptor installed. From this point on, frames going out the
    // wire are AES-128-GCM ciphertext.
    // Apply the JS-side video bitrate cap to the video sender, if one is set.
    // Idempotent — safe to call multiple times. Has no effect when there's
    // no video sender on the call.
    async _applyVideoBitrate() {
        if (this._videoBitrateApplied) return;
        if (_videoMaxBitrateKbps === null) return;
        const pc = this.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') return;
        for (const s of pc.getSenders()) {
            if (s.track && s.track.kind === 'video') {
                try {
                    const params = s.getParameters();
                    if (!params.encodings || params.encodings.length === 0) {
                        params.encodings = [{}];
                    }
                    params.encodings[0].maxBitrate = _videoMaxBitrateKbps * 1000;
                    await s.setParameters(params);
                    this._log('[video] sender maxBitrate set to', _videoMaxBitrateKbps, 'kbps');
                } catch (e) {
                    this._log('[video] bitrate setParameters failed:', (e && e.message) || e);
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
        if (ZRTP_INSTALL_DISABLED) {
            this._log('_installSenders: ZRTP_INSTALL_DISABLED — skipping');
            this._sendersInstalled = true;
            return;
        }
        const k = this._directionKeys();
        if (!k) { this._log('_installSenders: no derived keys yet'); return; }
        const pc = this.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') {
            this._log('_installSenders: no _pc/getSenders'); return;
        }
        const codec  = this._negotiatedVideoCodec();
        const prefix = ZrtpSession.unencryptedVideoPrefixForCodec(codec);
        this._log('[video] PHASE B install senders; role=' + this.role +
                  ' send.key=' + k.sendKey.slice(0, 8) + '… codec=' + codec + ' prefix=' + prefix);
        const senders = pc.getSenders();
        for (const s of senders) {
            if (!s.track) continue;
            try {
                await s.setMediaEncryption(k.sendKey, k.sendSalt, k.keyId, prefix);
                this._log('[' + s.track.kind + '] sender encryption installed');
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
                utils.timestampedLog('[ZRTP]', s.track.kind, 'sender SRTP ENCRYPTION ACTIVE',
                    'with peer', this.peerUri,
                    'key prefix=' + (k.sendKey ? k.sendKey.slice(0, 8) : '?') + '…',
                    'codec=', codec);
            } catch (e) {
                this._log('[' + s.track.kind + '] sender install failed:', (e && e.message) || e);
                utils.timestampedLog('[ZRTP]', s.track.kind, 'sender SRTP install FAILED with peer',
                    this.peerUri, '— error:', (e && e.message) || String(e));
            }
        }
        this._sendersInstalled = true;
    }

    _deriveAndLog() {
        // X25519 ECDH
        this.sharedSecret = nacl.scalarMult(this.ephemeral.secretKey, this.peerEphemPub);
        this._log('ECDH shared secret hex:', toHex(this.sharedSecret));

        // HKDF-SHA256 — derive 4 outputs labeled by direction (caller↔callee)
        const salt = new Uint8Array(32); // RFC 5869: zero-salt when no salt available
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

        this._log('HKDF caller->callee key  =', this.derivedKeys.audioCallerToCallee);
        this._log('HKDF callee->caller key  =', this.derivedKeys.audioCalleeToCaller);
        this._log('HKDF caller->callee salt =', this.derivedKeys.audioCallerToCalleeSalt);
        this._log('HKDF callee->caller salt =', this.derivedKeys.audioCalleeToCallerSalt);

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
                verification = (currentKey && stored.publicKey === currentKey)
                    ? 'verified'
                    : 'mismatch';
            }
        } catch (e) { /* default to 'unverified' */ }
        utils.timestampedLog('[ZRTP] handshake completed with', this.peerUri,
            'role=', this.role, 'sas=', chars, emojis, 'peer=', verification);
    }

    async _pgpWrap(plaintext) {
        const publicKeys = this.myKeys.public + '\n' + this.contact.publicKey;
        return await OpenPGP.encrypt(plaintext, publicKeys);
    }

    destroy() {
        this._log('destroy');
    }
}

// ----- registry keyed by sylkrtc Call's local id -------------------------

const sessions = new Map();

const _idOf = (call) => call._id || call.id;

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

// H.264 with E2EE doesn't work on our current FrameEncryptor. The H.264
// RTP packetizer uses STAP-A (multi-NAL aggregation) for small frames;
// our fixed N-byte unencrypted prefix only protects the first NAL's
// header, leaving the size fields and subsequent NAL headers encrypted
// — depacketizer reads garbage, decoder drops the packet, video freezes
// both ways. Audio works because Opus has no equivalent layer.
//
// Until we ship a NAL-aware encryptor, we silently skip ZRTP install
// when H.264 is negotiated. The picker UI tags H.264 with "(no E2EE)"
// to set user expectations. Calls still go through, just over plain
// SRTP / DTLS without the extra E2EE layer.
function _shouldSkipZrtpForCodec(call) {
    const codec = _peekNegotiatedVideoCodec(call);
    if (codec === 'H264') {
        utils.timestampedLog('[ZRTP] negotiated codec is H264 — skipping E2EE install'
                  + ' (FrameEncryptor STAP-A limitation; see CallZrtp.js)');
        return true;
    }
    return false;
}

function _attachCleanup(call, id, session) {
    const onState = (oldS, newS) => {
        if (newS === 'terminated') {
            console.log('[ZRTP] cleanup session', id);
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
    utils.timestampedLog('[ZRTP] MANDATORY mode failed: reason=' + reasonCode
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
        console.log('[ZRTP] zrtpMandatoryFailed emit threw (' +
                    ((e && e.message) || e) + ')');
        delivered = false;
    }
    if (!delivered) {
        utils.timestampedLog('[ZRTP] no listener for zrtpMandatoryFailed — terminating call');
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
    utils.timestampedLog('[ZRTP] MANDATORY mode immediate-fail (reason=' + reasonCode
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
            console.log('[ZRTP] deferred mandatory-fail prompt cancelled — call already terminated');
            return;
        }
        _emitMandatoryFailed(call, reasonCode, detail);
    }, ZRTP_MANDATORY_TIMEOUT_MS);
}

// In MANDATORY mode the call must reach key-agreed within
// ZRTP_MANDATORY_TIMEOUT_MS. If it doesn't, we DON'T terminate the call
// directly — instead we emit a 'zrtpMandatoryFailed' event on the
// sylkrtc Call object. The UI catches it (Call.js / AudioCallBox /
// VideoBox) and shows a confirmation modal letting the user choose:
//
//   • End call    — they actually want mandatory enforcement
//   • Continue    — they accept the call continuing without E2E
//
// This avoids the abrupt-disconnect-with-no-explanation experience.
//
// In OPTIONAL mode this helper is a no-op.
//
// The session's own _setState path is monkey-patched so the timer can
// be cancelled the moment state transitions to 'key-agreed' (success).
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
    if (_encryptionMode === 'sdes') {
        utils.timestampedLog('[ZRTP] mode=sdes — no end-to-end encryption requested,'
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
        utils.timestampedLog('[ZRTP] no public key for', contact && contact.uri, '— skipping');
        return null;
    }
    if (!account) {
        console.log('[ZRTP] no account passed — skipping');
        return null;
    }
    if (_shouldSkipZrtpForCodec(call)) {
        if (_encryptionMode === 'zrtp_mandatory') {
            // Codec (H.264) is incompatible with our FrameEncryptor.
            // Same UX as above — let the user decide. Deferred by 10 s.
            _emitMandatoryFailedDelayed(call, 'incompatible-codec',
                'negotiated codec is not compatible with E2E (H.264 STAP-A)');
        }
        return null;
    }
    const id = _idOf(call);
    if (sessions.has(id)) {
        console.log('[ZRTP] session already exists for call', id);
        return sessions.get(id);
    }
    const s = new ZrtpSession({ call, account, contact, myKeys, role: 'caller' });
    sessions.set(id, s);
    _attachCleanup(call, id, s);
    _attachMandatoryTimeout(call, id, s);
    s.startProbe();
    return s;
}

/**
 * Receiver-side dispatcher: invoke when a PGP-decrypted account-message
 * with contentType === ZRTP_CONTENT_TYPE arrives. Creates a callee-role
 * session on first contact and feeds it the JSON. Devices that aren't in
 * the matching call drop the message via call_id check inside handleIncoming.
 */
export function dispatchIncomingZrtp(call, account, contact, myKeys, decryptedContent) {
    if (_encryptionMode === 'sdes') {
        console.log('[ZRTP] mode=sdes — ignoring incoming key exchange');
        return;
    }
    if (!contact || !contact.publicKey) {
        if (_encryptionMode === 'zrtp_mandatory') {
            _emitMandatoryFailedDelayed(call, 'no-public-key',
                'no PGP public key cached for ' + (contact && contact.uri));
            return;
        }
        console.log('[ZRTP] no public key for', contact && contact.uri, '— ignoring incoming');
        return;
    }
    if (!account) {
        console.log('[ZRTP] no account passed — ignoring incoming');
        return;
    }
    if (_shouldSkipZrtpForCodec(call)) {
        if (_encryptionMode === 'zrtp_mandatory') {
            _emitMandatoryFailedDelayed(call, 'incompatible-codec',
                'negotiated codec is not compatible with E2E (H.264 STAP-A)');
        }
        return;
    }
    const id = _idOf(call);
    let s = sessions.get(id);
    if (!s) {
        s = new ZrtpSession({ call, account, contact, myKeys, role: 'callee' });
        sessions.set(id, s);
        _attachCleanup(call, id, s);
        _attachMandatoryTimeout(call, id, s);
    }
    s.handleIncoming(decryptedContent);
}

/** Test helper: peek at session state from outside the module. */
export function getZrtpSession(call) {
    return sessions.get(_idOf(call));
}
