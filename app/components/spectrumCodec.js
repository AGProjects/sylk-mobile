// spectrumCodec.js
//
// Compact wire format for a recorded spectrogram — the per-frame 16
// band energies captured during a recording, so playback can animate
// the spectrum in sync (the spectral sibling of the waveform `peaks`).
//
// A frame is 16 dB values. We quantise each to one byte over a fixed
// dB window, pack frames row-major into a Uint8Array, and base64 the
// bytes. The metadata object is small and JSON-safe:
//
//   { v: 1, rate: 10, bands: 16, count: N, lo: -100, hi: 0, data: <b64> }
//
// At 10 fps × 16 bytes that's 160 B/s ≈ 12.8 KB/min of base64 — fine
// for short voice notes, and FRAME_CAP bounds anything longer.

export const BANDS = 16;
export const RATE_HZ = 10;          // frames per second stored
export const DB_LO = -100;          // quantisation floor (byte 0)
export const DB_HI = 0;             // quantisation ceil  (byte 255)
export const FRAME_CAP = 1800;      // ~3 min at 10 fps

// --- quantisation ---------------------------------------------------

export function quantizeFrame(db) {
    const out = new Uint8Array(BANDS);
    for (let i = 0; i < BANDS; i++) {
        let v = (db && i < db.length) ? db[i] : DB_LO;
        if (!isFinite(v)) v = DB_LO;
        let q = Math.round(((v - DB_LO) / (DB_HI - DB_LO)) * 255);
        if (q < 0) q = 0; else if (q > 255) q = 255;
        out[i] = q;
    }
    return out;
}

export function dequantizeByte(q) {
    return DB_LO + (q / 255) * (DB_HI - DB_LO);
}

// --- base64 (self-contained; no Buffer/btoa dependency) -------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes) {
    let out = '';
    const n = bytes.length;
    for (let i = 0; i < n; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < n ? bytes[i + 1] : 0;
        const b2 = i + 2 < n ? bytes[i + 2] : 0;
        out += B64[b0 >> 2];
        out += B64[((b0 & 3) << 4) | (b1 >> 4)];
        out += (i + 1 < n) ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
        out += (i + 2 < n) ? B64[b2 & 63] : '=';
    }
    return out;
}

function b64ToBytes(str) {
    if (!str) return new Uint8Array(0);
    const lookup = new Int16Array(256).fill(-1);
    for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
    const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
    const len = Math.floor((clean.length * 3) / 4);
    const out = new Uint8Array(len);
    let p = 0;
    for (let i = 0; i < clean.length; i += 4) {
        const c0 = lookup[clean.charCodeAt(i)] | 0;
        const c1 = lookup[clean.charCodeAt(i + 1)] | 0;
        const c2 = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)] : -1;
        const c3 = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)] : -1;
        if (p < len) out[p++] = (c0 << 2) | (c1 >> 4);
        if (c2 >= 0 && p < len) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
        if (c3 >= 0 && p < len) out[p++] = ((c2 & 3) << 6) | c3;
    }
    return out;
}

// --- encode / decode ------------------------------------------------

// frames: array of Float32Array|number[] (each length BANDS, in dB) OR
// already-quantised Uint8Array rows. opts carries the display range so
// the recipient can label the axis identically: { fLow, fHigh, ticks }.
// Returns the metadata object, or null if there are no frames.
export function encodeSpectrum(frames, opts = {}) {
    if (!frames || !frames.length) return null;
    const count = Math.min(frames.length, FRAME_CAP);
    const bytes = new Uint8Array(count * BANDS);
    for (let f = 0; f < count; f++) {
        const row = frames[f];
        const q = (row instanceof Uint8Array) ? row : quantizeFrame(row);
        bytes.set(q.subarray ? q.subarray(0, BANDS) : q, f * BANDS);
    }
    const meta = {
        v: 1,
        rate: RATE_HZ,
        bands: BANDS,
        count,
        lo: DB_LO,
        hi: DB_HI,
        data: bytesToB64(bytes),
    };
    if (opts.fLow) meta.fLow = opts.fLow;
    if (opts.fHigh) meta.fHigh = opts.fHigh;
    if (opts.ticks) meta.ticks = opts.ticks;
    return meta;
}

// Returns a lightweight accessor over a decoded spectrum:
//   { count, rate, bands, frameAt(i) -> Float32Array(BANDS) of dB,
//     frameAtTime(sec), frameAtProgress(p, durationSec) }
export function decodeSpectrum(meta) {
    if (!meta || !meta.data) return null;
    const bands = meta.bands || BANDS;
    const rate = meta.rate || RATE_HZ;
    const lo = (typeof meta.lo === 'number') ? meta.lo : DB_LO;
    const hi = (typeof meta.hi === 'number') ? meta.hi : DB_HI;
    const bytes = b64ToBytes(meta.data);
    const count = meta.count || Math.floor(bytes.length / bands);

    const frameAt = (i) => {
        const out = new Float32Array(bands);
        if (count <= 0) return out;
        let idx = i < 0 ? 0 : (i >= count ? count - 1 : i);
        const base = idx * bands;
        for (let b = 0; b < bands; b++) {
            out[b] = lo + (bytes[base + b] / 255) * (hi - lo);
        }
        return out;
    };

    return {
        count,
        rate,
        bands,
        fLow: meta.fLow || 0,
        fHigh: meta.fHigh || 0,
        ticks: meta.ticks || null,
        frameAt,
        frameAtTime: (sec) => frameAt(Math.floor((sec || 0) * rate)),
        frameAtProgress: (p, durationSec) => {
            if (durationSec > 0) return frameAt(Math.floor((p || 0) * durationSec * rate));
            return frameAt(Math.floor((p || 0) * (count - 1)));
        },
    };
}

export default { encodeSpectrum, decodeSpectrum, quantizeFrame, dequantizeByte };
