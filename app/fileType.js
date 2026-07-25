// Inlined replacement for the dead react-native-file-type package
// (2026-07-22). Pure JS, no native code. Same contract as the old default
// export: `fileType(path) -> Promise<{ext, mime} | null>`, detecting the
// type from the file's leading magic bytes.
//
// The old lib read the first 64 bytes via react-native-fs (still a dep) and
// ran the heavy `file-type` npm package over them. This reimplements the
// same flow with a curated signature table covering the formats the app
// actually transfers (images / audio / video / pdf / archives) plus the old
// lib's <html> fallback — avoiding the modern ESM-only `file-type` dependency
// entirely. Byte reading reuses crypto-js (already a dep) to decode the
// base64 RNFS returns, so no js-base64 dependency either.
//
// Used by: app.js, components/ReadyBox.js — in both, only `.mime` is read,
// as a fallback when the type isn't already known from the filename.
import RNFS from 'react-native-fs';
import CryptoJS from 'crypto-js';

const HEADER_BYTES = 64;

// Decode the base64 RNFS.read returns into a plain byte array.
const base64ToBytes = (b64) => {
    const wa = CryptoJS.enc.Base64.parse(b64);
    const bytes = new Array(wa.sigBytes);
    for (let i = 0; i < wa.sigBytes; i++) {
        bytes[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return bytes;
};

// True if `bytes` starts with the given byte sequence (offset optional).
const startsWith = (bytes, seq, offset = 0) => {
    for (let i = 0; i < seq.length; i++) {
        if (bytes[offset + i] !== seq[i]) {
            return false;
        }
    }
    return true;
};

// ASCII helpers for the container-brand checks below.
const asciiAt = (bytes, offset, len) => {
    let s = '';
    for (let i = 0; i < len; i++) {
        s += String.fromCharCode(bytes[offset + i] || 0);
    }
    return s;
};

// Map an ISO-BMFF (ftyp) major brand to a concrete type. Covers the
// mp4/mov/m4a/3gp/heic family the app deals with.
const brandToType = (brand) => {
    const b = brand.trim();
    if (b === 'qt') {
        return { ext: 'mov', mime: 'video/quicktime' };
    }
    if (b === 'M4A') {
        return { ext: 'm4a', mime: 'audio/mp4' };
    }
    if (b === 'M4V') {
        return { ext: 'm4v', mime: 'video/mp4' };
    }
    if (b.startsWith('3g')) {
        return { ext: '3gp', mime: 'video/3gpp' };
    }
    if (b === 'heic' || b === 'heix' || b === 'hevc' || b === 'mif1' || b === 'heim' || b === 'heis') {
        return { ext: 'heic', mime: 'image/heic' };
    }
    // isom / mp41 / mp42 / iso2 / avc1 / dash / mmp4 / ... → generic mp4
    return { ext: 'mp4', mime: 'video/mp4' };
};

const detect = (bytes) => {
    // Images
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return { ext: 'jpg', mime: 'image/jpeg' };
    }
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
        return { ext: 'gif', mime: 'image/gif' };
    }
    if (startsWith(bytes, [0x42, 0x4d])) {
        return { ext: 'bmp', mime: 'image/bmp' };
    }
    // RIFF containers: WEBP (image) and WAV (audio)
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) {
        const form = asciiAt(bytes, 8, 4);
        if (form === 'WEBP') {
            return { ext: 'webp', mime: 'image/webp' };
        }
        if (form === 'WAVE') {
            return { ext: 'wav', mime: 'audio/wav' };
        }
        if (form === 'AVI ') {
            return { ext: 'avi', mime: 'video/x-msvideo' };
        }
    }
    // PDF
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
        return { ext: 'pdf', mime: 'application/pdf' };
    }
    // ISO base media (mp4 / mov / m4a / 3gp / heic): 'ftyp' box at offset 4
    if (asciiAt(bytes, 4, 4) === 'ftyp') {
        return brandToType(asciiAt(bytes, 8, 4));
    }
    // Ogg
    if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) {
        return { ext: 'ogg', mime: 'audio/ogg' };
    }
    // FLAC
    if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) {
        return { ext: 'flac', mime: 'audio/x-flac' };
    }
    // MP3: ID3 tag or MPEG audio frame sync
    if (startsWith(bytes, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
        return { ext: 'mp3', mime: 'audio/mpeg' };
    }
    // AMR
    if (startsWith(bytes, [0x23, 0x21, 0x41, 0x4d, 0x52])) {
        return { ext: 'amr', mime: 'audio/amr' };
    }
    // Matroska / WebM (EBML)
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
        return { ext: 'webm', mime: 'video/webm' };
    }
    // ZIP (and zip-based formats)
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) {
        return { ext: 'zip', mime: 'application/zip' };
    }
    return null;
};

const fileType = (path) => new Promise((resolve, reject) => {
    RNFS.stat(path)
        .then((statResult) => {
            const numberBytes = Math.min(Number(statResult.size) || 0, HEADER_BYTES);
            if (numberBytes <= 0) {
                resolve(null);
                return;
            }
            RNFS.read(path, numberBytes, 0, 'base64')
                .then((fileData) => {
                    const bytes = base64ToBytes(fileData);
                    let type = detect(bytes);
                    if (!type) {
                        // Old lib's fallback: sniff for an HTML document.
                        const decoded = String.fromCharCode.apply(null, bytes);
                        if (decoded.startsWith('<html>') || decoded.endsWith('</html>')) {
                            type = { ext: 'html', mime: 'text/html' };
                        }
                    }
                    resolve(type);
                })
                .catch(reject);
        })
        .catch(reject);
});

export default fileType;
