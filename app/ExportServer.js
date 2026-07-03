/*
 * ExportServer.js
 *
 * On-device HTTPS server for the "Export data" feature. Runs only while the
 * Export modal is open. Serves a small web app to a browser on the same LAN so
 * the user can pull their full local history (contacts / messages / file
 * transfers) off this phone — for phone-to-phone migration or computer backup.
 *
 *   Transport:  react-native-tcp-socket  (TLS server + raw sockets)
 *   Routing:    app/exportRouter.js  (shared with the Node mock — same code
 *               path is verified by tools/export-mock-server.js)
 *   Data:       read-only queries against sylk.db (SQLite, WAL)
 *
 * Milestone 1: TLS, token+cookie auth, served web UI, GET /api/summary.
 * Phase-2 data endpoints are routed but return 501. See docs/EXPORT_FEATURE_PLAN.md.
 */

import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import SQLite from 'react-native-sqlite-storage';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import NetInfo from '@react-native-community/netinfo';

import { ExportRouter, parseRequest, buildHead } from './ExportRouter';
import { relPathFromLocalUrl } from './ExportArchive';
import utils from './utils';

const ExportCrypto = require('./ExportCrypto');

const { Buffer } = require('buffer');

// Tagged log helper — goes to Metro AND the in-app Logs viewer ([export] pill).
function elog(...args) {
  try { utils.timestampedLog('[export]', ...args); } catch (e) { /* logging must never throw */ }
}

const FILE_READ_CHUNK = 256 * 1024; // bytes per RNFS base64 read

// HTTP is always served (phone-to-phone import). Additionally serve HTTPS for an
// external browser. Best-effort: if the TLS keystore can't load, HTTP-only
// continues. Set false to disable the HTTPS listener entirely.
const SERVE_HTTPS = true;

// TLS keystore (no-password PKCS#12 from tools/gen-export-cert.sh).
//
// react-native-tcp-socket resolves `keystore` via Image.resolveAssetSource(x).uri
// and the native side then does: getIdentifier(uri.replace('-','_'), 'raw', pkg).
//   • Android: pass { uri: 'server_keystore' } so it loads directly from
//     android/app/src/main/res/raw/server_keystore.p12 — the SAME path in dev
//     AND release (no Metro dependency, which is what made dev TLS hang).
//   • iOS: use the Metro/bundled asset require (the p12 must also be added to the
//     Xcode "Copy Bundle Resources" phase — see tools/gen-export-cert.sh).
// Either way the keystore is committed under res/raw / ios/, so a native rebuild
// is required for the HTTPS listener to pick it up.
const KEYSTORE = Platform.OS === 'android'
  ? { uri: 'server_keystore' }
  : require('../server-keystore.p12');

SQLite.enablePromise(true);

const PORT_MIN = 49152;
const PORT_MAX = 65535;
const PORT_TRIES = 8;
const FILE_CATEGORIES = ['image', 'audio', 'video', 'other'];
const MESSAGE_CATEGORIES = ['text', 'links', 'location', 'image', 'audio', 'video', 'other'];

function randomPort() { return PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN)); }

// The export server is IPv4-only: it binds 0.0.0.0 and the URL/QR handed to a
// LAN browser must be a dotted-quad. DeviceInfo.getIpAddress() can hand back an
// IPv6 address on some networks, which is both unusable here and would produce a
// malformed (unbracketed) URL — so reject anything that isn't a valid IPv4.
function isIPv4(addr) {
  if (typeof addr !== 'string') return false;
  const m = addr.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  if (!m.slice(1).every((o) => Number(o) <= 255)) return false;
  return addr.trim() !== '0.0.0.0';
}

// Resolve this device's LAN IPv4. DeviceInfo.getIpAddress() is unreliable on
// iOS (can return an IPv6 address or empty), so prefer NetInfo's details.ipAddress
// — which is the dotted-quad IPv4 of the active Wi-Fi interface — and fall back
// to DeviceInfo only if NetInfo doesn't yield a valid IPv4.
async function resolveLocalIPv4() {
  try {
    const state = await NetInfo.fetch();
    const ip = state && state.details && state.details.ipAddress;
    if (isIPv4(ip)) return ip.trim();
  } catch (e) { /* fall through to DeviceInfo */ }
  try {
    const ip = await DeviceInfo.getIpAddress();
    if (isIPv4(ip)) return ip.trim();
  } catch (e) { /* none */ }
  return null;
}

// Reproduce the app's SIP User-Agent string (app.js owns it as a module-scope
// const that isn't exported): "Blink Mobile <ver> (<DeviceLabel> on <platform>)".
function buildUserAgent() {
  let platform = Platform.OS;
  try {
    if (Platform.OS === 'android') platform = `Android ${DeviceInfo.getSystemVersion()}`;
    else if (Platform.OS === 'ios') platform = `iOS ${Platform.Version}`;
    else if (Platform.Version) platform = `${Platform.OS} ${Platform.Version}`;
  } catch (e) { /* ignore */ }
  let brand = ''; let model = '';
  try { brand = (DeviceInfo.getBrand() || '').trim(); } catch (e) { /* ignore */ }
  try { model = (DeviceInfo.getModel() || '').trim(); } catch (e) { /* ignore */ }
  const label = (model && brand && model.toLowerCase().startsWith(brand.toLowerCase()))
    ? model : `${brand} ${model}`.trim();
  let version = '';
  try { version = (DeviceInfo.getVersion() || '').trim(); } catch (e) { /* ignore */ }
  return version
    ? `Blink Mobile ${version} (${label} on ${platform})`
    : `Blink Mobile (${label} on ${platform})`;
}

// ---------------------------------------------------------------------------
// SQLite-backed read-only data provider. Opens its own connection to the same
// sylk.db; WAL (enabled by the app at startup) permits concurrent reads.
// ---------------------------------------------------------------------------

function createSqliteDataProvider(accountId, userAgent) {
  let db = null;

  async function open() {
    if (!db) db = await SQLite.openDatabase({ name: 'sylk.db', location: 'default' });
    return db;
  }

  async function query(sql, params) {
    const d = await open();
    const [res] = await d.executeSql(sql, params || []);
    const rows = [];
    for (let i = 0; i < res.rows.length; i++) rows.push(res.rows.item(i));
    return rows;
  }

  return {
    accountId,

    async getSummary() {
      const acct = accountId;

      const catRows = await query(
        `SELECT category, COUNT(*) AS c
           FROM messages
          WHERE account = ? AND (deleted IS NULL OR deleted = 0)
          GROUP BY category`,
        [acct],
      );
      const messages = { total: 0 };
      MESSAGE_CATEGORIES.forEach((c) => { messages[c] = 0; });
      catRows.forEach((r) => {
        const cat = r.category || 'other';
        if (messages[cat] === undefined) messages[cat] = 0;
        messages[cat] += r.c;
        messages.total += r.c;
      });

      const contactRows = await query(
        `SELECT COUNT(*) AS c FROM contacts WHERE account = ?`, [acct],
      );
      const contacts = { total: contactRows.length ? contactRows[0].c : 0 };

      const fileRows = await query(
        `SELECT category, metadata
           FROM messages
          WHERE account = ? AND content_type = 'application/sylk-file-transfer'
            AND (deleted IS NULL OR deleted = 0)`,
        [acct],
      );
      const files = { total: { count: 0, bytes: 0 } };
      FILE_CATEGORIES.forEach((c) => { files[c] = { count: 0, bytes: 0 }; });
      fileRows.forEach((r) => {
        const cat = FILE_CATEGORIES.indexOf(r.category) >= 0 ? r.category : 'other';
        let bytes = 0;
        try {
          const m = r.metadata ? JSON.parse(r.metadata) : null;
          if (m) bytes = Number(m.filesize || m.size || 0) || 0;
        } catch (e) { /* malformed metadata */ }
        files[cat].count += 1;
        files[cat].bytes += bytes;
        files.total.count += 1;
        files.total.bytes += bytes;
      });

      // getDeviceName() returns "unknown" on Android without BLUETOOTH_CONNECT
      // permission — fall back to the model (no permission needed), then platform.
      let deviceName = '';
      try { deviceName = await DeviceInfo.getDeviceName(); } catch (e) { /* perm */ }
      if (!deviceName || /^unknown$/i.test(deviceName)) {
        try { deviceName = DeviceInfo.getModel(); } catch (e) { /* ignore */ }
      }
      if (!deviceName || /^unknown$/i.test(deviceName)) deviceName = Platform.OS;

      return {
        device: {
          name: deviceName,
          platform: Platform.OS,
          app_version: DeviceInfo.getVersion ? DeviceInfo.getVersion() : null,
          // The app's SIP User-Agent, passed in from app.js (falls back to a
          // reconstructed string if not provided).
          useragent: userAgent || buildUserAgent(),
        },
        account: acct,
        generated_at: new Date().toISOString(),
        contacts,
        messages,
        files,
      };
    },

    // Account-wide date index for the calendar filter. Mirrors the app's
    // getContactDateIndex bucketing: day_id is computed in LOCAL time
    // (strftime 'localtime') so calendar pills line up with the app, and
    // 'links' = text rows with has_link = 1 (same as the v18 column).
    async getCalendar(opts) {
      const contact = (opts && opts.contact) || null;
      const params = [accountId];
      let contactClause = '';
      if (contact) {
        contactClause = ' AND ((from_uri = ? AND to_uri = ?) OR (from_uri = ? AND to_uri = ?))';
        params.push(accountId, contact, contact, accountId);
      }
      const rows = await query(
        `SELECT strftime('%Y-%m-%d', unix_timestamp, 'unixepoch', 'localtime') AS day_id,
                category, has_link, COUNT(*) AS cnt
           FROM messages
          WHERE account = ?
            AND (deleted IS NULL OR deleted = 0)
            AND category IS NOT NULL${contactClause}
          GROUP BY day_id, category, has_link`,
        params,
      );

      // Per-category map: { category: { day_id: count } }, plus 'all' and 'links'.
      const cats = {};
      const bump = (cat, day, n) => {
        if (!cats[cat]) cats[cat] = {};
        cats[cat][day] = (cats[cat][day] || 0) + n;
      };
      rows.forEach((r) => {
        if (!r.day_id) return;
        const c = r.category || 'other';
        const n = r.cnt || 0;
        bump(c, r.day_id, n);
        bump('all', r.day_id, n);
        if (c === 'text' && r.has_link) bump('links', r.day_id, n);
      });

      // Convert to sorted arrays of { day, count }.
      const index = {};
      Object.keys(cats).forEach((c) => {
        index[c] = Object.keys(cats[c])
          .sort((a, b) => (a < b ? 1 : -1)) // day_id desc
          .map((day) => ({ day, count: cats[c][day] }));
      });

      return { generated_at: new Date().toISOString(), index };
    },

    // ---- phase 2: selection + downloads ----

    // The other party of a message relative to this account.
    _other(row) {
      return row.from_uri === accountId ? row.to_uri : row.from_uri;
    },

    // Always all contacts (no filter). Photos (BLOB) are omitted from the JSON.
    async getContacts() {
      const rows = await query(
        `SELECT account, contact_id, uri, uris, name, organization, tags, email,
                participants, public_key, timestamp, direction, last_message,
                last_message_id, last_call_media, last_call_duration,
                last_call_timestamp, conference
           FROM contacts WHERE account = ?
          ORDER BY name COLLATE NOCASE`,
        [accountId],
      );
      return rows;
    },

    // Text-type messages (categories text/links/location), filtered by
    // category + period (+ optional contact). Returns normalized rows.
    async getMessages(opts) {
      const category = (opts && opts.category) || 'all';
      const period = (opts && opts.period) || 'all';
      const contact = (opts && opts.contact) || null;

      let catClause = " AND category IN ('text','location')";
      const params = [accountId];
      if (category === 'text') catClause = " AND category = 'text'";
      else if (category === 'links') catClause = " AND category = 'text' AND has_link = 1";
      else if (category === 'location') catClause = " AND category = 'location'";

      let outer = ' WHERE 1=1';
      const outerParams = [];
      if (period && period !== 'all') { outer += ' AND day_id LIKE ?'; outerParams.push(period + '%'); }
      if (contact) {
        outer += ' AND ((from_uri = ? AND to_uri = ?) OR (from_uri = ? AND to_uri = ?))';
        outerParams.push(accountId, contact, contact, accountId);
      }

      const rows = await query(
        `SELECT * FROM (
            SELECT *, strftime('%Y-%m-%d', unix_timestamp, 'unixepoch', 'localtime') AS day_id
              FROM messages
             WHERE account = ? AND (deleted IS NULL OR deleted = 0)${catClause}
         )${outer}
         ORDER BY unix_timestamp ASC`,
        params.concat(outerParams),
      );

      return rows.map((r) => ({
        contact: this._other(r),
        day: r.day_id,
        unix_timestamp: r.unix_timestamp,
        direction: r.direction,
        sender: r.sender,
        content: r.content == null ? '' : String(r.content),
        content_type: r.content_type,
        category: r.category,
        row: r,
      }));
    },

    // File-transfer messages (categories image/audio/video/other), filtered.
    async getFiles(opts) {
      const category = (opts && opts.category) || 'all';
      const period = (opts && opts.period) || 'all';
      const contact = (opts && opts.contact) || null;

      let catClause = " AND category IN ('image','audio','video','other')";
      if (['image', 'audio', 'video', 'other'].indexOf(category) >= 0) catClause = ' AND category = ?';

      const params = [accountId];
      if (catClause.indexOf('?') >= 0) params.push(category);

      let outer = ' WHERE 1=1';
      const outerParams = [];
      if (period && period !== 'all') { outer += ' AND day_id LIKE ?'; outerParams.push(period + '%'); }
      if (contact) {
        outer += ' AND ((from_uri = ? AND to_uri = ?) OR (from_uri = ? AND to_uri = ?))';
        outerParams.push(accountId, contact, contact, accountId);
      }

      const rows = await query(
        `SELECT * FROM (
            SELECT *, strftime('%Y-%m-%d', unix_timestamp, 'unixepoch', 'localtime') AS day_id
              FROM messages
             WHERE account = ? AND content_type = 'application/sylk-file-transfer'
               AND (deleted IS NULL OR deleted = 0)${catClause}
         )${outer}
         ORDER BY unix_timestamp ASC`,
        params.concat(outerParams),
      );

      const out = [];
      for (const r of rows) {
        let meta = {};
        try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch (e) { meta = {}; }
        const localUrl = meta.local_url || r.local_url || null;
        const filename = meta.filename || (localUrl ? localUrl.split('/').pop() : 'file');
        const transferId = meta.transfer_id || r.related_msg_id || r.msg_id;
        let filesize = Number(meta.filesize || meta.size || 0) || null;
        let present = false;
        if (localUrl) {
          try {
            const st = await RNFS.stat(localUrl.replace(/^file:\/\//, ''));
            present = true;
            if (!filesize) filesize = Number(st.size) || null;
          } catch (e) { present = false; }
        }
        out.push({
          id: r.msg_id,
          transfer_id: transferId,
          contact: this._other(r),
          filename,
          filetype: meta.filetype || null,
          filesize,
          file_present: present,
          local_url: localUrl,
          rel_path: localUrl ? relPathFromLocalUrl(localUrl, RNFS.DocumentDirectoryPath) : null,
          row: r,
        });
      }
      return out;
    },

    // Contacts that have media in the current kind/category/period, with their
    // message/file counts — ordered by count DESC. Powers the contact pill row.
    async getContactCounts(opts) {
      const kind = (opts && opts.kind) || 'messages';
      const category = (opts && opts.category) || 'all';
      const period = (opts && opts.period) || 'all';
      const rows = kind === 'files'
        ? await this.getFiles({ category, period })
        : await this.getMessages({ category, period, contact: null });
      const m = {};
      rows.forEach((r) => { if (r.contact) m[r.contact] = (m[r.contact] || 0) + 1; });
      const result = Object.keys(m)
        .map((c) => ({ contact: c, count: m[c] }))
        .sort((a, b) => b.count - a.count);
      elog('contacts-counts', kind, category, period, '· rows', rows.length, '· contacts', result.length);
      return result;
    },

    // Unique ids in a selection, for the receiving device's add-only diff.
    // messages/files → msg_id; contacts → contact uri.
    async getIds(opts) {
      const kind = (opts && opts.kind) || 'messages';
      const contact = (opts && opts.contact) || null;
      if (kind === 'contacts') {
        const rows = await this.getContacts();
        return rows.map((r) => r.uri).filter(Boolean);
      }
      if (kind === 'files') {
        const rows = await this.getFiles({ category: opts.category, period: opts.period, contact });
        return rows.map((r) => r.id);
      }
      const rows = await this.getMessages({ category: opts.category, period: opts.period, contact });
      return rows.map((r) => r.row.msg_id);
    },

    // (id, day) pairs for a kind/category/contact across all periods — lets the
    // importing device diff against local ids and know which days still have
    // un-imported items (so it can stop drilling into fully-imported periods).
    async getIdIndex(opts) {
      const kind = (opts && opts.kind) || 'messages';
      const contact = (opts && opts.contact) || null;
      if (kind === 'contacts') return [];
      const rows = kind === 'files'
        ? await this.getFiles({ category: opts.category, period: 'all', contact })
        : await this.getMessages({ category: opts.category, period: 'all', contact });
      return rows.map((r) => ({
        id: kind === 'files' ? r.id : r.row.msg_id,
        day: r.day || (r.row && r.row.day_id) || '',
        contact: r.contact || '',
      }));
    },

    // Full message row by msg_id (sidecar / /api/meta).
    async getRow(id) {
      const rows = await query(`SELECT * FROM messages WHERE account = ? AND msg_id = ? LIMIT 1`, [accountId, id]);
      return rows.length ? rows[0] : null;
    },

    // Open a file transfer's bytes for streaming. Returns { filename, size, chunks }.
    async openFile(id) {
      const row = await this.getRow(id);
      if (!row) return null;
      let meta = {};
      try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch (e) { meta = {}; }
      const localUrl = (meta.local_url || row.local_url || '').replace(/^file:\/\//, '');
      if (!localUrl) return null;
      let size = Number(meta.filesize || meta.size || 0) || 0;
      try { const st = await RNFS.stat(localUrl); size = Number(st.size) || size; } catch (e) { return null; }
      const filename = meta.filename || localUrl.split('/').pop();
      return {
        filename,
        size,
        chunks: async function* () {
          let pos = 0;
          while (pos < size) {
            const len = Math.min(FILE_READ_CHUNK, size - pos);
            const b64 = await RNFS.read(localUrl, len, pos, 'base64');
            if (!b64) break;
            const buf = Buffer.from(b64, 'base64');
            if (!buf.length) break;
            yield buf;
            pos += buf.length;
          }
        },
      };
    },

    async close() {
      if (db) { try { await db.close(); } catch (e) {} db = null; }
    },
  };
}

// ---------------------------------------------------------------------------
// ExportServer singleton — wires TLS sockets to the shared router.
// ---------------------------------------------------------------------------

class ExportServer {
  constructor() {
    this._servers = [];
    this._router = null;
    this._status = {
      running: false, ip: null, token: null, enc: null,
      httpUrl: null, httpsUrl: null, httpPort: null, httpsPort: null,
      url: null, tls: false, requests: 0, lastEvent: null,
    };
    this._onStatus = null;
  }

  isRunning() { return this._status.running; }
  getStatus() { return Object.assign({}, this._status); }
  onStatus(cb) { this._onStatus = cb; }

  _emit(patch) {
    Object.assign(this._status, patch || {});
    if (this._onStatus) { try { this._onStatus(this.getStatus()); } catch (e) {} }
  }

  async start(opts = {}) {
    if (this._status.running) return this.getStatus();

    elog('starting export server', opts.accountId ? `· account=${opts.accountId}` : '');

    const provider = opts.dataProvider || createSqliteDataProvider(opts.accountId, opts.userAgent);
    // Per-session symmetric key — shipped to other devices inside the PGP
    // announcement; the import app uses it to decrypt the transfer over HTTP.
    const encKey = ExportCrypto.generateKey();
    this._router = new ExportRouter({ provider, encKey });
    this._router.onEvent = (label) => {
      this._emit({ requests: this._status.requests + 1, lastEvent: label });
      elog('request', label);
    };

    const ip = await resolveLocalIPv4();
    if (!ip) elog('could not resolve a LAN IPv4 address — URL will use 0.0.0.0');
    const host = ip || '0.0.0.0';

    // Always serve HTTP — the phone-to-phone import uses it (the app's HTTP
    // client rejects self-signed TLS, but the payload is already encrypted via
    // the shared key). Additionally serve HTTPS (best-effort) for an external
    // browser, which can accept the self-signed cert.
    const httpPort = await this._listenOne(false, null);
    let httpsPort = null;
    const wantTls = opts.tls != null ? !!opts.tls : SERVE_HTTPS;
    if (wantTls) {
      try { httpsPort = await this._listenOne(true, { keystore: opts.tlsKeystore || KEYSTORE }); }
      catch (e) { elog('https listener unavailable:', (e && e.message) || e); httpsPort = null; }
    }

    const httpUrl = `http://${host}:${httpPort}`;
    const httpsUrl = httpsPort ? `https://${host}:${httpsPort}` : null;
    this._emit({
      running: true,
      ip: host,
      token: this._router.token,
      enc: encKey,
      httpUrl, httpsUrl, httpPort, httpsPort,
      url: httpsUrl || httpUrl, // what the browser/QR uses (prefer HTTPS)
      tls: !!httpsUrl,
      requests: 0,
      lastEvent: 'listening',
    });
    elog('LISTENING · http', httpUrl, '· https', httpsUrl || '(none)', '· ip', host, '· auth key', this._router.token);
    return this.getStatus();
  }

  // Start one listener (plain or TLS) on a random port, retrying on conflict.
  _listenOne(useTls, tlsOptions) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tag = useTls ? 'https' : 'http';
      const tryListen = () => {
        attempt += 1;
        const port = randomPort();
        const handler = (socket) => this._handleSocket(socket);
        const server = useTls
          ? TcpSocket.createTLSServer(tlsOptions, handler)
          : TcpSocket.createServer(handler);
        server.on('error', (err) => {
          elog(tag, 'listen attempt', attempt, 'on port', port, 'failed:', (err && err.message) || err);
          try { server.close(); } catch (e) {}
          if (attempt < PORT_TRIES) tryListen(); else reject(err);
        });
        server.listen({ port, host: '0.0.0.0' }, () => {
          this._servers.push(server);
          resolve(port);
        });
      };
      tryListen();
    });
  }

  _handleSocket(socket) {
    const remote = socket && socket.remoteAddress
      ? `${socket.remoteAddress}:${socket.remotePort || ''}` : 'client';
    elog('connection from', remote);

    let buf = Buffer.alloc(0);
    let handled = false;

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (handled) return;
      const req = parseRequest(buf);
      if (req.incomplete) return;
      handled = true;
      this._router.handle(req)
        .then((out) => this._send(socket, out))
        .catch((e) => {
          elog('request error', (e && e.message) || e);
          try {
            socket.end(Buffer.from('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{"error":"internal"}'));
          } catch (e2) { try { socket.end(); } catch (e3) {} }
        });
    });

    socket.on('error', () => {});
    socket.on('close', () => {});
  }

  // Resolve when a single write has actually flushed over the native bridge.
  // react-native-tcp-socket fires the write callback on the 'written' event;
  // awaiting it gives us both ordering AND backpressure (one in-flight write
  // at a time), so large files don't balloon memory.
  _write(socket, buf) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      try { socket.write(buf, undefined, fin); } catch (e) { fin(); }
      setTimeout(fin, 8000); // safety: never hang the pipeline
    });
  }

  // Write a router result and close GRACEFULLY. The critical detail: a bare
  // socket.end() ends immediately and can FIN the connection before a prior
  // write() has flushed (→ intermittent "Load failed"). socket.end(data)
  // writes then ends only after the write completes, so we route the FINAL
  // bytes through end(data) and await every earlier write.
  async _send(socket, out) {
    if (!out || Buffer.isBuffer(out)) {
      try { socket.end(out || Buffer.alloc(0)); } catch (e) { try { socket.end(); } catch (e2) {} }
      return;
    }
    if (out.__stream) {
      try {
        await this._write(socket, buildHead(out.status, out.headers));
        let last = null;
        for await (const chunk of out.iterator) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (last) await this._write(socket, last); // flush previous, hold current
          last = b;
        }
        if (last) socket.end(last); // final bytes flushed before FIN
        else socket.end();
      } catch (e) {
        elog('stream error', (e && e.message) || e);
        try { socket.destroy(); } catch (e2) {}
      }
      return;
    }
    try { socket.end(); } catch (e) {}
  }

  async stop() {
    if (!this._status.running && (!this._servers || !this._servers.length)) return;
    elog('stopping export server · served', this._status.requests, 'request(s)');
    if (this._router) this._router.reset();
    (this._servers || []).forEach((s) => { try { s.close(); } catch (e) {} });
    this._servers = [];
    if (this._router && this._router.provider && this._router.provider.close) {
      try { await this._router.provider.close(); } catch (e) {}
    }
    this._router = null;
    this._emit({
      running: false, ip: null, token: null,
      httpUrl: null, httpsUrl: null, httpPort: null, httpsPort: null, url: null,
      lastEvent: 'stopped',
    });
    elog('stopped');
  }
}

const instance = new ExportServer();
export default instance;
export { createSqliteDataProvider };
