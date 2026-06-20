/*
 * exportRouter.js
 *
 * Framework-free HTTP routing + auth for the Export feature. Deliberately has
 * NO React-Native imports so it runs unchanged under:
 *   - the on-device TLS server (app/ExportServer.js), and
 *   - the Node mock (tools/export-mock-server.js) used to verify the flow
 *     without a device rebuild.
 *
 * It owns: the one-time auth token, the session table, request parsing, the
 * route table, and response building. The transport (TLS sockets vs Node
 * https) and the data provider are injected.
 */

'use strict';

const { Buffer } = require('buffer');
const { PAGE } = require('./exportWebUI');
const Archive = require('./exportArchive');
const Crypto = require('./exportCrypto');

// MIME guess for served file blobs (kept tiny — just the common transfer types).
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', mp4: 'image/mp4', mov: 'video/quicktime',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
};
function mimeFor(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
function qstr(q, k, d) { return q && q[k] != null && q[k] !== '' ? String(q[k]) : (d || ''); }

const SESSION_TTL_MS = 30 * 60 * 1000;
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

const STATUS_TEXT = {
  200: 'OK', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error',
  501: 'Not Implemented',
};

// --- randomness (works in RN via global.crypto, in Node via require) ---------

function fillRandom(out) {
  // Both targets expose Web Crypto: React Native via react-native-get-random-values
  // (imported at app startup), and Node >= 19 natively as global.crypto.
  const g = typeof global !== 'undefined' ? global : {};
  if (g.crypto && g.crypto.getRandomValues) {
    g.crypto.getRandomValues(out);
    return out;
  }
  // Last-resort fallback (should not be hit on either supported target).
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function makeToken() {
  const b = fillRandom(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < 8; i++) s += TOKEN_ALPHABET[b[i] % TOKEN_ALPHABET.length];
  return s;
}

function makeSessionId() {
  const b = fillRandom(new Uint8Array(16));
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Normalize an entered token: uppercase, drop the display hyphen / spaces /
// anything outside the base32 alphabet. So "xnnm-ne8m" === "XNNMNE8M".
function normToken(t) { return String(t || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }

// --- HTTP parsing / building -------------------------------------------------

function buildResponse(status, headers, bodyBuf) {
  const reason = STATUS_TEXT[status] || 'OK';
  const h = Object.assign(
    {
      'Content-Length': bodyBuf ? bodyBuf.length : 0,
      Connection: 'close',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    headers || {},
  );
  let head = `HTTP/1.1 ${status} ${reason}\r\n`;
  Object.keys(h).forEach((k) => { head += `${k}: ${h[k]}\r\n`; });
  head += '\r\n';
  const headBuf = Buffer.from(head, 'utf8');
  return bodyBuf && bodyBuf.length ? Buffer.concat([headBuf, bodyBuf]) : headBuf;
}

// Build just the HTTP status line + headers (no body) for streamed responses.
function buildHead(status, headers) {
  const reason = STATUS_TEXT[status] || 'OK';
  const h = Object.assign({ Connection: 'close', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {});
  let head = `HTTP/1.1 ${status} ${reason}\r\n`;
  Object.keys(h).forEach((k) => { head += `${k}: ${h[k]}\r\n`; });
  head += '\r\n';
  return Buffer.from(head, 'utf8');
}

function parseCookies(headers) {
  const raw = headers.cookie || headers.Cookie || '';
  const out = {};
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

// Parse one HTTP request from a Buffer. Returns { incomplete:true } if more
// bytes are needed, else { method, path, query, headers, body, consumed }.
function parseRequest(buf) {
  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd === -1) return { incomplete: true };

  const headerText = buf.slice(0, headerEnd).toString('utf8');
  const lines = headerText.split('\r\n');
  const parts = lines[0].split(' ');
  const method = (parts[0] || 'GET').toUpperCase();
  const rawPath = parts[1] || '/';

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > 0) headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
  }

  const contentLength = parseInt(headers['content-length'] || '0', 10);
  const bodyStart = headerEnd + 4;
  if (buf.length - bodyStart < contentLength) return { incomplete: true };
  const body = buf.slice(bodyStart, bodyStart + contentLength);

  const qIdx = rawPath.indexOf('?');
  const path = qIdx === -1 ? rawPath : rawPath.slice(0, qIdx);
  const query = {};
  if (qIdx !== -1) {
    rawPath.slice(qIdx + 1).split('&').forEach((kv) => {
      const eq = kv.indexOf('=');
      const k = eq === -1 ? kv : kv.slice(0, eq);
      const v = eq === -1 ? '' : kv.slice(eq + 1);
      if (k) try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { query[k] = v; }
    });
  }

  return { method, path, query, headers, body, consumed: bodyStart + contentLength };
}

// --- Router ------------------------------------------------------------------

class ExportRouter {
  /** @param {object} opts { provider, token?, encKey? } */
  constructor(opts = {}) {
    this.provider = opts.provider || null;
    this.token = opts.token || makeToken();
    this.encKey = opts.encKey || null; // base64 symmetric key (optional)
    this.sessions = new Map(); // sid -> expiry ms
    this.onEvent = null; // optional (label) => void
  }

  _event(label) { if (this.onEvent) { try { this.onEvent(label); } catch (e) {} } }

  // A client opts into encryption by sending `X-Sylk-Enc: 1` (the import app
  // does; the browser doesn't, so it keeps getting plaintext).
  _wantsEnc(req) {
    return !!(this.encKey && req && req.headers && req.headers['x-sylk-enc']);
  }

  // Seal a body when the client asked for encryption: ciphertext = nonce||box,
  // Content-Type octet-stream, X-Sylk-Enc: 1 so the client knows to decrypt.
  _seal(enc, status, headers, body) {
    if (!enc) return buildResponse(status, headers, body);
    const ct = Crypto.encrypt(this.encKey, body || Buffer.alloc(0));
    return buildResponse(status, { 'Content-Type': 'application/octet-stream', 'X-Sylk-Enc': '1' }, ct);
  }

  _json(status, obj, extraHeaders, enc) {
    return this._seal(!!enc, status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders),
      Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  _newSession() {
    const sid = makeSessionId();
    this.sessions.set(sid, Date.now() + SESSION_TTL_MS);
    return sid;
  }

  _validSession(req) {
    const headers = (req && req.headers) || req || {};
    const query = (req && req.query) || {};
    // Token in the URL — used by download links so they don't depend on the
    // SameSite httpOnly cookie being attached to download navigations.
    if (query.token && safeEqual(normToken(query.token), this.token)) return true;
    const auth = headers.authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) {
      return safeEqual(normToken(auth.slice(7)), this.token);
    }
    const sid = parseCookies(headers).sylk_export;
    if (!sid) return false;
    const exp = this.sessions.get(sid);
    if (!exp || exp < Date.now()) { this.sessions.delete(sid); return false; }
    this.sessions.set(sid, Date.now() + SESSION_TTL_MS); // sliding
    return true;
  }

  reset() { this.sessions.clear(); }

  /** Handle a parsed request, returns Promise<Buffer> (full HTTP response). */
  async handle(req) {
    this._event(`${req.method} ${req.path}`);
    // Encrypt responses for clients that ask (the import app); the browser does
    // not send the header and keeps getting plaintext (e.g. the page below).
    const enc = this._wantsEnc(req);

    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      return buildResponse(200, { 'Content-Type': 'text/html; charset=utf-8' }, Buffer.from(PAGE, 'utf8'));
    }

    // Liveness check (no auth) — the import side polls this to detect the
    // exporter stopping. Any HTTP reply means "still up"; a network error means
    // the server is gone.
    if (req.method === 'GET' && req.path === '/api/ping') {
      return buildResponse(200, { 'Content-Type': 'application/json' }, Buffer.from('{"ok":true}', 'utf8'));
    }

    if (req.path === '/api/login') {
      if (req.method !== 'POST') return this._json(405, { error: 'method not allowed' });
      let token = '';
      try { token = normToken(JSON.parse((req.body || Buffer.alloc(0)).toString('utf8') || '{}').token); }
      catch (e) { return this._json(400, { error: 'bad json' }); }
      if (!safeEqual(token, this.token)) return this._json(401, { error: 'invalid token' });
      const sid = this._newSession();
      return this._json(200, { ok: true }, {
        'Set-Cookie': `sylk_export=${sid}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
      });
    }

    if (req.path === '/api/logout') {
      const sid = parseCookies(req.headers).sylk_export;
      if (sid) this.sessions.delete(sid);
      return this._json(200, { ok: true }, { 'Set-Cookie': 'sylk_export=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (!this._validSession(req)) return this._json(401, { error: 'unauthorized' });

    if (req.method === 'GET' && req.path === '/api/summary') {
      const summary = await this.provider.getSummary();
      return this._json(200, summary, undefined, enc);
    }

    // Account-wide date index powering the Category + Year/Month/Day calendar.
    // Optional ?contact= scopes the counts to one contact.
    if (req.method === 'GET' && req.path === '/api/calendar') {
      const calendar = await this.provider.getCalendar({ contact: qstr(req.query, 'contact') || null });
      return this._json(200, calendar, undefined, enc);
    }

    // --- selection manifest (browseable links + a download-all zip) ---
    if (req.method === 'GET' && req.path === '/api/selection') {
      return this._json(200, await this._buildManifest(req.query));
    }

    // --- unique ids in a selection (for the receiving device's add-only diff) ---
    if (req.method === 'GET' && req.path === '/api/ids') {
      const ids = await this.provider.getIds({
        kind: qstr(req.query, 'kind', 'messages'),
        category: qstr(req.query, 'category', 'all'),
        period: qstr(req.query, 'period', 'all'),
        contact: qstr(req.query, 'contact') || null,
      });
      return this._json(200, { kind: qstr(req.query, 'kind', 'messages'), count: ids.length, ids }, undefined, enc);
    }

    // --- bulk rows for a slice in ONE request (avoids per-message round-trips).
    // messages → full rows (with content); files → full rows (metadata; the
    // bytes are still fetched per id via /api/blob). ---
    if (req.method === 'GET' && req.path === '/api/rows-bulk') {
      const k = qstr(req.query, 'kind', 'messages');
      const sel = { category: qstr(req.query, 'category', 'all'), period: qstr(req.query, 'period', 'all'), contact: qstr(req.query, 'contact') || null };
      const rows = k === 'files'
        ? (await this.provider.getFiles(sel)).map((f) => f.row)
        : (await this.provider.getMessages({ category: sel.category, period: sel.period, contact: sel.contact })).map((m) => m.row);
      return this._json(200, { count: rows.length, rows }, undefined, enc);
    }

    // --- (id, day) index for the importer's "remaining to import" calendar ---
    if (req.method === 'GET' && req.path === '/api/idindex') {
      const items = await this.provider.getIdIndex({
        kind: qstr(req.query, 'kind', 'messages'),
        category: qstr(req.query, 'category', 'all'),
        contact: qstr(req.query, 'contact') || null,
      });
      return this._json(200, { items }, undefined, enc);
    }

    // --- contacts that have media in this selection, ordered by count DESC ---
    if (req.method === 'GET' && req.path === '/api/contacts-counts') {
      const contacts = await this.provider.getContactCounts({
        kind: qstr(req.query, 'kind', 'messages'),
        category: qstr(req.query, 'category', 'all'),
        period: qstr(req.query, 'period', 'all'),
      });
      return this._json(200, { count: contacts.length, contacts }, undefined, enc);
    }

    // --- contacts.json (always all contacts) ---
    if (req.method === 'GET' && req.path === '/api/contacts.json') {
      const contacts = await this.provider.getContacts();
      return this._seal(enc, 200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="contacts.json"',
      }, Buffer.from(JSON.stringify(contacts, null, 2), 'utf8'));
    }

    // --- one file transfer's bytes ---
    if (req.method === 'GET' && req.path === '/api/blob') {
      const id = qstr(req.query, 'id');
      const f = await this.provider.openFile(id);
      if (!f) return this._json(404, { error: 'file not found or not on device', id }, undefined, enc);
      if (enc) {
        // Encrypted import: buffer the file and seal it (one file at a time).
        const parts = [];
        for await (const c of f.chunks()) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        return this._seal(true, 200, { 'Content-Type': mimeFor(f.filename) }, Buffer.concat(parts));
      }
      return {
        __stream: true,
        status: 200,
        headers: {
          'Content-Type': mimeFor(f.filename),
          'Content-Length': f.size,
          'Content-Disposition': `attachment; filename="${(f.filename || 'file').replace(/"/g, '')}"`,
        },
        iterator: f.chunks(),
      };
    }

    // --- one file transfer's metadata sidecar (full SQL row as JSON) ---
    if (req.method === 'GET' && req.path === '/api/meta') {
      const id = qstr(req.query, 'id');
      const row = await this.provider.getRow(id);
      if (!row) return this._json(404, { error: 'transfer not found', id }, undefined, enc);
      const body = Buffer.from(JSON.stringify(row, null, 2), 'utf8');
      return this._seal(enc, 200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${Archive.sidecarName(id)}"`,
      }, body);
    }

    // --- a day's chat transcript (story text or HTML) ---
    if (req.method === 'GET' && req.path === '/api/chat') {
      const contact = qstr(req.query, 'contact');
      const day = qstr(req.query, 'day');
      const category = qstr(req.query, 'category', 'all');
      const isHtml = qstr(req.query, 'format', 'story') === 'html';
      const rows = await this.provider.getMessages({ category, period: day, contact });
      const body = isHtml
        ? Archive.renderChatHtml(this.provider.accountId, contact, day, rows)
        : Archive.renderChatTxt(this.provider.accountId, contact, day, rows);
      return buildResponse(200, {
        'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="chat-${Archive.safeSeg(contact)}-${day}.${isHtml ? 'html' : 'txt'}"`,
      }, body);
    }

    // --- messages.json for a contact (or whole selection) ---
    if (req.method === 'GET' && req.path === '/api/messages.json') {
      const contact = qstr(req.query, 'contact');
      const category = qstr(req.query, 'category', 'all');
      const period = qstr(req.query, 'period', 'all');
      const rows = await this.provider.getMessages({ category, period, contact: contact || null });
      return buildResponse(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="messages.json"',
      }, Buffer.from(JSON.stringify(rows, null, 2), 'utf8'));
    }

    // --- download the whole selection as a streamed ZIP ---
    if (req.method === 'GET' && req.path === '/api/export.zip') {
      return this._zipResponse(req.query);
    }

    // Reserved for the import side (phase 3).
    return this._json(404, { error: 'not found' }, undefined, enc);
  }

  // ---- selection assembly ----

  // Build the list of archive entries [{ name, size, chunks }] for a selection,
  // plus a lightweight manifest of browseable items. Pure orchestration over
  // the injected provider — works the same on device and in the mock.
  async _collect(query) {
    const kind = qstr(query, 'kind', 'messages');
    const category = qstr(query, 'category', 'all');
    const period = qstr(query, 'period', 'all');
    const format = qstr(query, 'format', 'story');
    const contact = qstr(query, 'contact') || null;
    const acct = this.provider.accountId;
    const entries = [];
    const items = [];

    // Every archive expands under a shared BlinkArchive/<Kind>/ root so that
    // extracting several zips (contacts, messages, images, …) merges them into
    // one BlinkArchive/ tree: BlinkArchive/Contacts, /Messages, /Files.
    const KIND_DIR = { contacts: 'Contacts', messages: 'Messages', files: 'Files' };
    const root = `BlinkArchive/${KIND_DIR[kind] || 'Messages'}/`;

    if (kind === 'contacts') {
      const contacts = await this.provider.getContacts();
      const body = Buffer.from(JSON.stringify(contacts, null, 2), 'utf8');
      entries.push({ name: `${root}${Archive.safeSeg(acct)}/contacts.json`, size: body.length, chunks: async function* () { yield body; } });
      items.push({ type: 'contacts_json', count: contacts.length, url: '/api/contacts.json' });
      return { kind, category, period, format, entries, items, count: contacts.length };
    }

    if (kind === 'files') {
      const rows = await this.provider.getFiles({ category, period, contact });
      for (const r of rows) {
        const rel = r.rel_path || `${Archive.safeSeg(acct)}/${Archive.safeSeg(r.contact)}/${Archive.safeSeg(r.transfer_id)}/${Archive.safeSeg(r.filename)}`;
        const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
        // sidecar (always — even if bytes absent, the record is preserved)
        const sidecar = Buffer.from(JSON.stringify(r.row, null, 2), 'utf8');
        entries.push({ name: `${root}${dir}${Archive.sidecarName(r.transfer_id)}`, size: sidecar.length, chunks: async function* () { yield sidecar; } });
        // file bytes (only when present on disk)
        if (r.file_present && r.filesize != null) {
          const id = r.id;
          const provider = this.provider;
          entries.push({
            name: root + rel,
            size: r.filesize,
            chunks: async function* () { const f = await provider.openFile(id); if (f) yield* f.chunks(); },
          });
        }
        items.push({
          type: 'file', id: r.id, transfer_id: r.transfer_id, contact: r.contact, filename: r.filename,
          filetype: r.filetype, filesize: r.filesize, present: !!r.file_present,
          blob_url: r.file_present ? `/api/blob?id=${encodeURIComponent(r.id)}` : null,
          meta_url: `/api/meta?id=${encodeURIComponent(r.id)}`,
        });
      }
      return { kind, category, period, format, entries, items, count: rows.length };
    }

    // kind === 'messages'
    const rows = await this.provider.getMessages({ category, period, contact });
    if (format === 'json') {
      // One messages.json per contact.
      const byContact = {};
      rows.forEach((m) => { (byContact[m.contact] = byContact[m.contact] || []).push(m.row); });
      Object.keys(byContact).forEach((c) => {
        const body = Buffer.from(JSON.stringify(byContact[c], null, 2), 'utf8');
        entries.push({ name: `${root}${Archive.safeSeg(acct)}/${Archive.safeSeg(c)}/messages.json`, size: body.length, chunks: async function* () { yield body; } });
        items.push({ type: 'messages_json', contact: c, count: byContact[c].length, url: `/api/messages.json?contact=${encodeURIComponent(c)}&category=${encodeURIComponent(category)}&period=${encodeURIComponent(period)}` });
      });
    } else {
      // Story (chat.txt) or HTML (chat.html): one file per contact+day.
      const isHtml = format === 'html';
      const fileName = isHtml ? 'chat.html' : 'chat.txt';
      const byCD = {};
      rows.forEach((m) => { const k = m.contact + '\\t' + m.day; (byCD[k] = byCD[k] || []).push(m); });
      Object.keys(byCD).forEach((k) => {
        const parts = k.split('\\t');
        const contact = parts[0]; const day = parts[1];
        const buf = isHtml
          ? Archive.renderChatHtml(acct, contact, day, byCD[k])
          : Archive.renderChatTxt(acct, contact, day, byCD[k]);
        entries.push({ name: `${root}${Archive.safeSeg(acct)}/${Archive.safeSeg(contact)}/${day}/${fileName}`, size: buf.length, chunks: async function* () { yield buf; } });
        items.push({ type: 'chat', contact, day, file: fileName, count: byCD[k].length, url: `/api/chat?contact=${encodeURIComponent(contact)}&day=${day}&category=${encodeURIComponent(category)}&format=${format}` });
      });
    }
    return { kind, category, period, format, entries, items, count: rows.length };
  }

  // Archive filename carries the selection: Blink-contacts.zip,
  // Blink-messages-2026.zip, Blink-images-2026-03.zip, Blink-videos-2026-03-01.zip
  _zipName(sel) {
    const plural = { image: 'images', video: 'videos' };
    let label;
    if (sel.kind === 'contacts') label = 'contacts';
    else if (sel.kind === 'messages') label = sel.category === 'all' ? 'messages' : sel.category;
    else label = sel.category === 'all' ? 'files' : (plural[sel.category] || sel.category);
    const per = sel.period && sel.period !== 'all' ? '-' + sel.period : '';
    return `Blink-${Archive.safeSeg(label)}${per}.zip`;
  }

  async _buildManifest(query) {
    const sel = await this._collect(query);
    const zipName = this._zipName(sel);
    const zipBytes = Archive.zipContentLength(sel.entries);
    const q = ['kind', 'category', 'period', 'format']
      .map((k) => `${k}=${encodeURIComponent(qstr(query, k, sel[k]))}`).join('&');
    return {
      account: this.provider.accountId,
      kind: sel.kind, category: sel.category, period: sel.period, format: sel.format,
      count: sel.count,
      items: sel.items,
      zip: { url: `/api/export.zip?${q}`, filename: zipName, bytes: zipBytes },
    };
  }

  async _zipResponse(query) {
    const sel = await this._collect(query);
    const zipName = this._zipName(sel);
    const length = Archive.zipContentLength(sel.entries);
    return {
      __stream: true,
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': length,
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
      iterator: Archive.zipStream(sel.entries),
    };
  }
}

module.exports = {
  ExportRouter,
  parseRequest,
  buildResponse,
  buildHead,
  parseCookies,
  makeToken,
  makeSessionId,
  safeEqual,
  SESSION_TTL_MS,
};
