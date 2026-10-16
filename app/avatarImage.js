/*
 * avatarImage.js
 *
 * Builds the bytes of a contact avatar the way every client does
 * (Blink docs/CONTACT-AVATARS.md, "Building the avatar"):
 *
 *   1. honour the camera rotation (EXIF orientation)
 *   2. crop: the largest centred square
 *   3. scale: into a fresh 96x96 bitmap, high quality (area average when
 *      shrinking, bilinear when growing). A fresh bitmap carries no
 *      metadata: no EXIF, no GPS, no thumbnail.
 *   4. flatten onto white (JPEG has no alpha)
 *   5. encode: JPEG, quality 70
 *
 * Pure JavaScript, so it runs the same on iOS, Android and under node. The
 * input is what react-native-image-picker hands back with includeBase64
 * (already shrunk to at most 512 px by the picker): JPEG or PNG. Android's
 * picker does not rotate the pixels when it resizes, it copies the EXIF
 * orientation tag, so step 1 is not optional.
 *
 * jpeg-js writes 4:4:4 chroma (the spec suggests 4:2:0): at 96x96 that is a
 * few hundred bytes more, and every decoder reads it.
 */

'use strict';

const jpeg = require('jpeg-js');
const pako = require('pako');
const { Buffer } = require('buffer');

const AVATAR_PIXELS = 96;
const AVATAR_JPEG_QUALITY = 70;

// --- PNG ------------------------------------------------------------------

function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

// Non-interlaced PNG, bit depth 8 or 16 (any colour type), or a palette of
// depth 1/2/4/8 -- what the image picker and every phone writes.
function decodePng(bytes) {
    if (readU32(bytes, 0) !== 0x89504e47) throw new Error('not a PNG');
    let pos = 8;
    let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
    let palette = null, trns = null;
    const idat = [];
    while (pos + 8 <= bytes.length) {
        const len = readU32(bytes, pos);
        const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
        const data = bytes.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = readU32(data, 0); height = readU32(data, 4);
            depth = data[8]; ctype = data[9]; interlace = data[12];
        } else if (type === 'PLTE') {
            palette = data;
        } else if (type === 'tRNS') {
            trns = data;
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + len;
    }
    if (!width || !height) throw new Error('PNG without IHDR');
    if (interlace) throw new Error('interlaced PNG is not supported');
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!channels) throw new Error('unknown PNG colour type ' + ctype);
    if (ctype === 3 ? [1, 2, 4, 8].indexOf(depth) === -1 : (depth !== 8 && depth !== 16)) {
        throw new Error('unsupported PNG bit depth ' + depth);
    }
    let total = 0;
    for (const d of idat) total += d.length;
    const joined = new Uint8Array(total);
    let off = 0;
    for (const d of idat) { joined.set(d, off); off += d.length; }
    const raw = pako.inflate(joined);

    const bitsPerPixel = channels * depth;
    const bpp = Math.max(1, bitsPerPixel >> 3);           // filter unit
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    const lines = new Uint8Array(stride * height);
    let prev = new Uint8Array(stride);
    let src = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[src++];
        const line = lines.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < stride; x++) {
            const v = raw[src++];
            const a = x >= bpp ? line[x - bpp] : 0;
            const b = prev[x];
            const c = x >= bpp ? prev[x - bpp] : 0;
            let out;
            switch (filter) {
                case 0: out = v; break;
                case 1: out = v + a; break;
                case 2: out = v + b; break;
                case 3: out = v + ((a + b) >> 1); break;
                case 4: out = v + paeth(a, b, c); break;
                default: throw new Error('bad PNG filter ' + filter);
            }
            line[x] = out & 0xff;
        }
        prev = line;
    }

    const rgba = new Uint8Array(width * height * 4);
    const sample = (line, i) => {   // i-th sample of a line, 8-bit
        if (depth === 8) return line[i];
        if (depth === 16) return line[i * 2];
        const perByte = 8 / depth;
        const byte = line[Math.floor(i / perByte)];
        const shift = 8 - depth * ((i % perByte) + 1);
        return (byte >> shift) & ((1 << depth) - 1);
    };
    for (let y = 0; y < height; y++) {
        const line = lines.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            let r, g, b, a = 255;
            if (ctype === 3) {
                const idx = sample(line, x);
                r = palette ? palette[idx * 3] : 0;
                g = palette ? palette[idx * 3 + 1] : 0;
                b = palette ? palette[idx * 3 + 2] : 0;
                if (trns && idx < trns.length) a = trns[idx];
            } else if (ctype === 0) {
                r = g = b = sample(line, x);
            } else if (ctype === 4) {
                r = g = b = sample(line, x * 2); a = sample(line, x * 2 + 1);
            } else if (ctype === 2) {
                r = sample(line, x * 3); g = sample(line, x * 3 + 1); b = sample(line, x * 3 + 2);
            } else {
                r = sample(line, x * 4); g = sample(line, x * 4 + 1); b = sample(line, x * 4 + 2); a = sample(line, x * 4 + 3);
            }
            rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
        }
    }
    return { width, height, data: rgba, orientation: 1 };
}

// --- JPEG -----------------------------------------------------------------

// EXIF orientation (1..8) from the APP1 payload jpeg-js hands back.
function exifOrientation(exif) {
    if (!exif || exif.length < 14) return 1;
    // Find the TIFF header: jpeg-js strips "Exif\0" but leaves the pad byte,
    // other writers keep the whole "Exif\0\0" prefix.
    let p = -1;
    for (let i = 0; i <= 8 && i + 4 <= exif.length; i++) {
        if ((exif[i] === 0x49 && exif[i + 1] === 0x49 && exif[i + 2] === 0x2a && exif[i + 3] === 0x00)
            || (exif[i] === 0x4d && exif[i + 1] === 0x4d && exif[i + 2] === 0x00 && exif[i + 3] === 0x2a)) { p = i; break; }
    }
    if (p < 0) return 1;
    const le = exif[p] === 0x49 && exif[p + 1] === 0x49;
    const u16 = (o) => (le ? exif[o] | (exif[o + 1] << 8) : (exif[o] << 8) | exif[o + 1]);
    const u32 = (o) => (le ? (exif[o] | (exif[o + 1] << 8) | (exif[o + 2] << 16) | (exif[o + 3] << 24))
                           : ((exif[o] << 24) | (exif[o + 1] << 16) | (exif[o + 2] << 8) | exif[o + 3])) >>> 0;
    if (u16(p + 2) !== 42) return 1;
    const ifd = p + u32(p + 4);
    if (ifd + 2 > exif.length) return 1;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > exif.length) break;
        if (u16(e) === 0x0112) {
            const v = u16(e + 8);
            return v >= 1 && v <= 8 ? v : 1;
        }
    }
    return 1;
}

function decodeJpeg(bytes) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true,
                                     maxResolutionInMP: 64, maxMemoryUsageInMB: 256 });
    return { width: img.width, height: img.height, data: img.data, orientation: exifOrientation(img.exifBuffer) };
}

// --- geometry -------------------------------------------------------------

// Apply an EXIF orientation, returning upright pixels.
function orient(img) {
    const o = img.orientation || 1;
    if (o === 1) return img;
    const { width: w, height: h, data } = img;
    const swap = o >= 5;
    const W = swap ? h : w, H = swap ? w : h;
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let X, Y;
            switch (o) {
                case 2: X = w - 1 - x; Y = y; break;
                case 3: X = w - 1 - x; Y = h - 1 - y; break;
                case 4: X = x; Y = h - 1 - y; break;
                case 5: X = y; Y = x; break;
                case 6: X = h - 1 - y; Y = x; break;
                case 7: X = h - 1 - y; Y = w - 1 - x; break;
                case 8: X = y; Y = w - 1 - x; break;
                default: X = x; Y = y;
            }
            const s = (y * w + x) * 4, d = (Y * W + X) * 4;
            out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
        }
    }
    return { width: W, height: H, data: out, orientation: 1 };
}

// Flattened (on white) RGB of source pixel (x, y), as floats.
function px(img, x, y, out) {
    const i = (y * img.width + x) * 4;
    const a = img.data[i + 3] / 255;
    out[0] = img.data[i] * a + 255 * (1 - a);
    out[1] = img.data[i + 1] * a + 255 * (1 - a);
    out[2] = img.data[i + 2] * a + 255 * (1 - a);
}

// Centre square crop scaled to size x size, flattened on white, RGBA out.
function cropScale(img, size) {
    const side = Math.min(img.width, img.height);
    const ox = (img.width - side) / 2, oy = (img.height - side) / 2;
    const out = new Uint8Array(size * size * 4);
    const scale = side / size;
    const tmp = [0, 0, 0];
    for (let Y = 0; Y < size; Y++) {
        for (let X = 0; X < size; X++) {
            let r = 0, g = 0, b = 0;
            if (scale > 1) {
                // area average over the source footprint of this pixel
                const x0 = ox + X * scale, x1 = x0 + scale;
                const y0 = oy + Y * scale, y1 = y0 + scale;
                let wsum = 0;
                for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
                    const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
                    if (wy <= 0 || sy < 0 || sy >= img.height) continue;
                    for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
                        const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
                        if (wx <= 0 || sx < 0 || sx >= img.width) continue;
                        const w = wx * wy;
                        px(img, sx, sy, tmp);
                        r += tmp[0] * w; g += tmp[1] * w; b += tmp[2] * w; wsum += w;
                    }
                }
                if (wsum > 0) { r /= wsum; g /= wsum; b /= wsum; } else { r = g = b = 255; }
            } else {
                // bilinear when the source is smaller than the avatar
                const fx = Math.min(Math.max(ox + (X + 0.5) * scale - 0.5, 0), img.width - 1);
                const fy = Math.min(Math.max(oy + (Y + 0.5) * scale - 0.5, 0), img.height - 1);
                const xa = Math.floor(fx), ya = Math.floor(fy);
                const xb = Math.min(xa + 1, img.width - 1), yb = Math.min(ya + 1, img.height - 1);
                const tx = fx - xa, ty = fy - ya;
                const acc = (sx, sy, w) => { px(img, sx, sy, tmp); r += tmp[0] * w; g += tmp[1] * w; b += tmp[2] * w; };
                acc(xa, ya, (1 - tx) * (1 - ty)); acc(xb, ya, tx * (1 - ty));
                acc(xa, yb, (1 - tx) * ty); acc(xb, yb, tx * ty);
            }
            const d = (Y * size + X) * 4;
            out[d] = Math.round(r); out[d + 1] = Math.round(g); out[d + 2] = Math.round(b); out[d + 3] = 255;
        }
    }
    return out;
}

// --- entry point ----------------------------------------------------------

function decode(bytes) {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return decodePng(bytes);
    throw new Error('unsupported image format (JPEG or PNG only)');
}

// jpeg-js returns a Buffer from encode() and reaches for the global one.
function jpegEncode(raw, quality) {
    const hadBuffer = typeof global.Buffer !== 'undefined';
    const saved = global.Buffer;
    if (!hadBuffer) global.Buffer = Buffer;
    try {
        return jpeg.encode(raw, quality).data;
    } finally {
        if (!hadBuffer) {
            try { delete global.Buffer; } catch (e) { global.Buffer = saved; }
        }
    }
}

/*
 * Image bytes (base64 of a JPEG or PNG) -> avatar (base64 JPEG, 96x96).
 * Throws on an image it cannot read.
 */
function encodeAvatarBase64(sourceBase64, size = AVATAR_PIXELS, quality = AVATAR_JPEG_QUALITY) {
    const bytes = new Uint8Array(Buffer.from(String(sourceBase64 || ''), 'base64'));
    if (!bytes.length) throw new Error('empty image');
    const img = orient(decode(bytes));
    if (!img.width || !img.height) throw new Error('empty image');
    const rgba = cropScale(img, size);
    const out = jpegEncode({ data: rgba, width: size, height: size }, quality);
    return Buffer.from(out).toString('base64');
}

module.exports = {
    AVATAR_PIXELS,
    AVATAR_JPEG_QUALITY,
    encodeAvatarBase64,
    // exported for tests
    decodePng,
    decodeJpeg,
    exifOrientation,
    orient,
    cropScale,
};
