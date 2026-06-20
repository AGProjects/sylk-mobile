/*
 * exportArchive.js
 *
 * Pure (no React-Native imports) helpers that turn a selection of message /
 * contact rows into the export's on-disk layout and a streamed ZIP. Shared by
 * the on-device server (app/ExportServer.js) and the Node mock so the archive
 * format is verified by the same code path.
 *
 * Export kinds (see docs/EXPORT_FEATURE_PLAN.md):
 *   contacts  — always all contacts, no filter   → <account>/contacts.json
 *   messages  — text/links/location, filterable   → <account>/<contact>/<YYYY-MM-DD>/chat.txt   (story)
 *                                                  or <account>/<contact>/messages.json          (json)
 *   files     — image/audio/video/other, filterable
 *                 <account>/<contact>/<id>/<filename>            (the app's exact tree)
 *                 <account>/<contact>/<id>/transfer-<id>.metadata (full SQL row as JSON)
 *
 * ZIP: STORE (no compression — media is already compressed), streamed with
 * data descriptors so files are read once; total length is precomputed so we
 * can send an honest Content-Length instead of chunked encoding.
 */

'use strict';

const { Buffer } = require('buffer');

// --- CRC32 (IEEE, for ZIP) ---------------------------------------------------

const CRC_TABLE = (function build() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, seed) {
  let c = seed === undefined ? 0xffffffff : (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
// Running CRC: pass previous *finalized* crc back in; we re-invert internally.

// --- path helpers ------------------------------------------------------------

// The file-transfer tree on the device is
//   <DocumentDirectory>/<account>/<contact>/<id>/<filename>
// so the export-relative path is simply local_url with the doc-dir prefix
// stripped. That guarantees the archive tree is byte-for-byte the app's tree.
function relPathFromLocalUrl(localUrl, docDirPath) {
  if (!localUrl) return null;
  let p = String(localUrl).replace(/^file:\/\//, '');
  const base = String(docDirPath || '').replace(/^file:\/\//, '').replace(/\/+$/, '');
  if (base && p.indexOf(base) === 0) p = p.slice(base.length);
  return p.replace(/^\/+/, '');
}

function sidecarName(transferId) { return `transfer-${transferId}.metadata`; }

function safeSeg(s) {
  return String(s == null ? '' : s).replace(/[\/\\]/g, '_').replace(/\.\.+/g, '_');
}

// --- text rendering ----------------------------------------------------------

// A readable per-day transcript. rows are the messages for one contact+day,
// each: { unix_timestamp, direction, sender, content, content_type, category }.
function renderChatTxt(accountId, contact, day, rows) {
  const lines = [];
  lines.push(`Blink chat — ${contact}`);
  lines.push(`Account: ${accountId}`);
  lines.push(`Date: ${day}`);
  lines.push('='.repeat(48));
  lines.push('');
  rows.slice().sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0)).forEach((m) => {
    const t = new Date((m.unix_timestamp || 0) * 1000);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const who = m.direction === 'outgoing' ? 'me' : (m.sender || contact);
    let body = m.content == null ? '' : String(m.content);
    if (m.content_type === 'text/html') body = body.replace(/<[^>]+>/g, '');
    lines.push(`[${hh}:${mm}] ${who}: ${body}`);
  });
  lines.push('');
  return Buffer.from(lines.join('\n'), 'utf8');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A styled, self-contained HTML transcript for one contact+day.
function renderChatHtml(accountId, contact, day, rows) {
  const sorted = rows.slice().sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0));
  const bubbles = sorted.map((m) => {
    const t = new Date((m.unix_timestamp || 0) * 1000);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const out = m.direction === 'outgoing';
    const who = out ? 'me' : (m.sender || contact);
    let body = m.content == null ? '' : String(m.content);
    if (m.content_type === 'text/html') body = body.replace(/<[^>]+>/g, '');
    return `<div class="row ${out ? 'out' : 'in'}"><div class="b">`
      + `<div class="who">${esc(who)}</div>`
      + `<div class="txt">${esc(body)}</div>`
      + `<div class="t">${hh}:${mm}</div></div></div>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${esc(contact)} — ${esc(day)}</title><style>`
    + `body{margin:0;background:#0e1320;color:#e8edf6;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}`
    + `.wrap{max-width:680px;margin:0 auto;padding:20px 14px 60px}`
    + `h1{font-size:16px;margin:0 0 2px}.sub{color:#8a97b0;font-size:12px;margin-bottom:18px}`
    + `.row{display:flex;margin:8px 0}.row.out{justify-content:flex-end}`
    + `.b{max-width:78%;background:#1d2640;border:1px solid #28324a;border-radius:14px;padding:8px 12px}`
    + `.row.out .b{background:#244; border-color:#2bd9a4}`
    + `.who{font-size:11px;color:#8a97b0;margin-bottom:2px}.txt{white-space:pre-wrap;word-wrap:break-word}`
    + `.t{font-size:10px;color:#8a97b0;text-align:right;margin-top:3px}`
    + `</style></head><body><div class="wrap">`
    + `<h1>${esc(contact)}</h1><div class="sub">${esc(accountId)} · ${esc(day)} · ${sorted.length} messages</div>`
    + bubbles + `</div></body></html>`;
  return Buffer.from(html, 'utf8');
}

// --- ZIP (STORE, streaming, precomputed length) ------------------------------

const LOCAL_HEADER = 30;
const DATA_DESCRIPTOR = 16;
const CENTRAL_HEADER = 46;
const EOCD = 22;

// entries: [{ name, size }]  (size = exact byte length of the file content)
function zipContentLength(entries) {
  let total = 0;
  entries.forEach((e) => {
    const nameLen = Buffer.byteLength(e.name, 'utf8');
    total += LOCAL_HEADER + nameLen + e.size + DATA_DESCRIPTOR; // local section
    total += CENTRAL_HEADER + nameLen;                          // central dir
  });
  total += EOCD;
  return total;
}

// entries: [{ name, size, chunks: async function*() -> Buffer }]
// Yields Buffers forming a valid ZIP. Sizes must match the real byte counts
// (used both for Content-Length and the headers).
async function* zipStream(entries) {
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const flags = 0x0808; // bit3: data descriptor, bit11: UTF-8 names

    const lh = Buffer.alloc(LOCAL_HEADER);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(0, 8);      // method 0 = store
    lh.writeUInt16LE(0, 10);     // mod time
    lh.writeUInt16LE(0x21, 12);  // mod date (1980-01-01)
    lh.writeUInt32LE(0, 14);     // crc (in descriptor)
    lh.writeUInt32LE(0, 18);     // comp size (in descriptor)
    lh.writeUInt32LE(0, 22);     // uncomp size (in descriptor)
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    yield Buffer.concat([lh, nameBuf]);

    const localOffset = offset;
    offset += LOCAL_HEADER + nameBuf.length;

    let crc = 0;
    let size = 0;
    for await (const chunk of e.chunks()) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(b, crc);
      size += b.length;
      offset += b.length;
      yield b;
    }

    const dd = Buffer.alloc(DATA_DESCRIPTOR);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(size >>> 0, 8);
    dd.writeUInt32LE(size >>> 0, 12);
    yield dd;
    offset += DATA_DESCRIPTOR;

    central.push({ name: nameBuf, crc: crc >>> 0, size: size >>> 0, localOffset, flags });
  }

  const cdStart = offset;
  for (const c of central) {
    const ch = Buffer.alloc(CENTRAL_HEADER);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(c.flags, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.size, 20);
    ch.writeUInt32LE(c.size, 24);
    ch.writeUInt16LE(c.name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(c.localOffset, 42);
    yield Buffer.concat([ch, c.name]);
    offset += CENTRAL_HEADER + c.name.length;
  }
  const cdSize = offset - cdStart;

  const eocd = Buffer.alloc(EOCD);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  yield eocd;
}

module.exports = {
  crc32,
  relPathFromLocalUrl,
  sidecarName,
  safeSeg,
  renderChatTxt,
  renderChatHtml,
  zipStream,
  zipContentLength,
};
