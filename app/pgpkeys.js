// pgpkeys.js — pure-JS OpenPGP packet inspection (no native deps).
//
// react-native-fast-openpgp (gopenpgp bridge) gives us encrypt/decrypt but no
// packet-level API, so when a message fails to decrypt we can't ask it WHICH
// key the message was encrypted to. This module parses just enough OpenPGP
// (RFC 4880) to answer two questions:
//
//   pgpMessageKeyIds(armoredMessage) -> ['81F9111B644B4936', ...]
//       recipient key IDs from the PKESK (tag 1) packets that prefix every
//       public-key encrypted message. These are in CLEARTEXT — no key needed.
//
//   pgpKeyIds(armoredKey) -> [{keyId, fingerprint, type}, ...]
//       key IDs of the primary key (tag 6/5) and all subkeys (tag 14/7) of an
//       armored public OR private key. v4 key ID = last 8 bytes of the SHA-1
//       fingerprint over (0x99, len, public-key-packet-body). Encryption is
//       done to a SUBKEY, so compare message key IDs against the subkey ids.
//
// Everything is synchronous and safe to call from a catch block.

'use strict';

// ---- minimal SHA-1 (public-domain style, operates on a byte array) ---------

function sha1(bytes) {
    const ml = bytes.length;
    const withOne = ml + 1;
    const total = (Math.ceil((withOne + 8) / 64)) * 64;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[ml] = 0x80;
    const bitLen = ml * 8;
    // 64-bit big-endian length (JS numbers are fine below 2^53)
    msg[total - 8] = (bitLen / 0x100000000000000) & 0xff;
    msg[total - 7] = (bitLen / 0x1000000000000) & 0xff;
    msg[total - 6] = (bitLen / 0x10000000000) & 0xff;
    msg[total - 5] = (bitLen / 0x100000000) & 0xff;
    msg[total - 4] = (bitLen >>> 24) & 0xff;
    msg[total - 3] = (bitLen >>> 16) & 0xff;
    msg[total - 2] = (bitLen >>> 8) & 0xff;
    msg[total - 1] = bitLen & 0xff;

    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
        h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Int32Array(80);
    const rol = (n, s) => (n << s) | (n >>> (32 - s));

    for (let i = 0; i < total; i += 64) {
        for (let j = 0; j < 16; j++) {
            w[j] = (msg[i + j * 4] << 24) | (msg[i + j * 4 + 1] << 16) |
                   (msg[i + j * 4 + 2] << 8) | msg[i + j * 4 + 3];
        }
        for (let j = 16; j < 80; j++) {
            w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let j = 0; j < 80; j++) {
            let f, k;
            if (j < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
            else if (j < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
            else if (j < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
            const t = (rol(a, 5) + f + e + k + w[j]) | 0;
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    const out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach((h, i) => {
        out[i * 4] = (h >>> 24) & 0xff; out[i * 4 + 1] = (h >>> 16) & 0xff;
        out[i * 4 + 2] = (h >>> 8) & 0xff; out[i * 4 + 3] = h & 0xff;
    });
    return out;
}

// ---- armor + packet walking -------------------------------------------------

function dearmor(text, blockName) {
    if (!text) return null;
    // Tolerate strings that carry LITERAL backslash-n sequences (keys/messages
    // that round-tripped through JSON or SQL escaping).
    text = String(text).replace(/\\r/g, '').replace(/\\n/g, '\n');
    const begin = '-----BEGIN PGP ' + blockName + '-----';
    const end = '-----END PGP ' + blockName + '-----';
    const b = text.indexOf(begin);
    if (b < 0) return null;
    const e = text.indexOf(end, b);
    // Truncated armor (missing END): parse what we have — the PKESK packets
    // sit at the very start, so recipient key ids usually survive.
    const inner = text.slice(b + begin.length, e > -1 ? e : undefined);
    const lines = inner.split(/\r?\n/).map(l => l.trim());
    // Base64 lines never contain ':' (not in the alphabet, lines are trimmed),
    // so dropping every line with one removes armor headers ("Version: ...")
    // whether or not the RFC's blank separator line is present. Checksum
    // lines start with '='.
    const b64 = lines.filter(l => l && l[0] !== '=' && l.indexOf(':') === -1).join('');
    return b64decode(b64);
}

// Pure-JS base64 decoder — no atob/Buffer dependency (Hermes-safe).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64decode(s) {
    const lut = b64decode._lut || (b64decode._lut = (() => {
        const t = new Int16Array(256).fill(-1);
        for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
        return t;
    })());
    const out = [];
    let buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
        const v = lut[s.charCodeAt(i)];
        if (v < 0) continue;                    // skip padding/whitespace
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buf >> bits) & 0xff);
        }
    }
    return out.length ? Uint8Array.from(out) : null;
}

function* packets(blob) {
    let off = 0;
    while (off < blob.length) {
        const ctb = blob[off];
        if (!(ctb & 0x80)) return;
        let tag, plen, hlen;
        if (ctb & 0x40) {                       // new format
            tag = ctb & 0x3f;
            const l1 = blob[off + 1];
            if (l1 < 192)      { plen = l1; hlen = 2; }
            else if (l1 < 224) { plen = ((l1 - 192) << 8) + blob[off + 2] + 192; hlen = 3; }
            else if (l1 === 255) {
                plen = (blob[off + 2] << 24 | blob[off + 3] << 16 |
                        blob[off + 4] << 8 | blob[off + 5]) >>> 0;
                hlen = 6;
            } else return;                       // partial lengths: stop
        } else {                                 // old format
            tag = (ctb >> 2) & 0x0f;
            const lt = ctb & 0x03;
            if (lt === 0)      { plen = blob[off + 1]; hlen = 2; }
            else if (lt === 1) { plen = (blob[off + 1] << 8) | blob[off + 2]; hlen = 3; }
            else if (lt === 2) {
                plen = (blob[off + 1] << 24 | blob[off + 2] << 16 |
                        blob[off + 3] << 8 | blob[off + 4]) >>> 0;
                hlen = 5;
            } else return;                       // indeterminate: stop
        }
        yield { tag, body: blob.subarray(off + hlen, off + hlen + plen) };
        off += hlen + plen;
    }
}

const hex = (bytes) =>
    Array.from(bytes).map(b => ('0' + b.toString(16)).slice(-2)).join('').toUpperCase();

// ---- public API -------------------------------------------------------------

// Recipient key IDs of an armored PGP MESSAGE (from its PKESK packets).
function pgpMessageKeyIds(armoredMessage) {
    const blob = dearmor(armoredMessage, 'MESSAGE');
    if (!blob) return [];
    const ids = [];
    for (const p of packets(blob)) {
        if (p.tag !== 1) break;                 // PKESKs always come first
        if (p.body.length >= 10 && p.body[0] === 3) {
            ids.push(hex(p.body.subarray(1, 9)));
        }
    }
    return ids;
}

// Key IDs (primary + subkeys) of an armored public or private key.
function pgpKeyIds(armoredKey) {
    const blob = dearmor(armoredKey, 'PUBLIC KEY BLOCK') ||
                 dearmor(armoredKey, 'PRIVATE KEY BLOCK');
    if (!blob) return [];
    const out = [];
    for (const p of packets(blob)) {
        // 6=public key, 14=public subkey, 5=secret key, 7=secret subkey
        if (p.tag !== 6 && p.tag !== 14 && p.tag !== 5 && p.tag !== 7) continue;
        let body = p.body;
        if (body.length < 6 || body[0] !== 4) continue;   // v4 only
        if (p.tag === 5 || p.tag === 7) {
            // secret key packet = public part + secret part; the fingerprint
            // is over the PUBLIC part only, so truncate after the public MPIs.
            body = publicPortion(body);
            if (!body) continue;
        }
        const prefix = new Uint8Array(3 + body.length);
        prefix[0] = 0x99;
        prefix[1] = (body.length >> 8) & 0xff;
        prefix[2] = body.length & 0xff;
        prefix.set(body, 3);
        const fpr = hex(sha1(prefix));
        out.push({
            type: (p.tag === 6 || p.tag === 5) ? 'primary' : 'subkey',
            fingerprint: fpr,
            keyId: fpr.slice(-16),
        });
    }
    return out;
}

// Length of the public portion of a v4 (secret) key packet body.
function publicPortion(body) {
    // version(1) + time(4) + algo(1) + algorithm-specific public MPIs
    let off = 6;
    const algo = body[5];
    let nMpis;
    if (algo === 1 || algo === 2 || algo === 3) nMpis = 2;        // RSA: n, e
    else if (algo === 17) nMpis = 4;                              // DSA
    else if (algo === 16 || algo === 20) nMpis = 3;               // ElGamal
    else if (algo === 18 || algo === 19 || algo === 22) {         // ECC
        if (off >= body.length) return null;
        off += 1 + body[off];                                     // OID
        nMpis = 1;                                                // point
        if (algo === 18) {                                        // ECDH: +KDF
            // read the point MPI, then KDF params, handled after loop
        }
    } else return null;
    for (let i = 0; i < nMpis; i++) {
        if (off + 2 > body.length) return null;
        const bits = (body[off] << 8) | body[off + 1];
        off += 2 + Math.ceil(bits / 8);
    }
    if (algo === 18) {
        if (off >= body.length) return null;
        off += 1 + body[off];                                     // KDF params
    }
    if (off > body.length) return null;
    return body.subarray(0, off);
}

// One-call helper for logging from a decrypt-failure handler.
// Returns a printable one-liner, never throws.
function describeDecryptFailure(armoredMessage, armoredOwnKey) {
    try {
        const msgIds = pgpMessageKeyIds(armoredMessage);
        const mine = pgpKeyIds(armoredOwnKey);
        const mineIds = mine.map(k => k.keyId + (k.type === 'subkey' ? '(sub)' : '(pri)'));
        const overlap = msgIds.filter(id => mine.some(k => k.keyId === id));
        return 'encrypted to [' + (msgIds.join(', ') || 'none/unparsable') + '] ' +
               'my key [' + (mineIds.join(', ') || 'none/unparsable') + '] ' +
               (overlap.length ? 'MATCH on ' + overlap.join(', ')
                               : 'NO MATCH — message was not encrypted to this device\'s key');
    } catch (e) {
        return 'pgp inspect error: ' + (e && e.message);
    }
}

module.exports = { pgpMessageKeyIds, pgpKeyIds, describeDecryptFailure };
