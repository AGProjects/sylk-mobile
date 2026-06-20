/*
 * importClient.js
 *
 * Receiving-device logic for importing a selection from another phone's export
 * server. Transport-agnostic (HTTP fetching is injected) so it runs in React
 * Native and is unit-testable against the Node mock.
 *
 * Semantics (per spec): import is **add-only** — it diffs the server's selection
 * against the local device by unique id and only ADDS messages/files/contacts
 * that aren't already present. It never updates or deletes anything local. The
 * preview therefore shows only what WILL be added, not everything exported.
 *
 *   messages / files → unique id is msg_id
 *   contacts         → unique id is the contact uri
 *
 * Encryption note: the announcement that triggers this is a normal PGP message
 * encrypted to the user's OWN public key (not the symmetric pgp-private-key
 * scheme). That happens in the messaging layer; this module just talks HTTP to
 * the server once the user has the {server, key}.
 */

'use strict';

// The contacts table stores secondary URIs in the `uris` column as the array
// serialized with .toString() (comma-separated); some rows may be JSON. Parse
// either, and return ALL of a contact's URIs (primary + secondary), deduped.
function parseContactUris(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  if (s[0] === '[') { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.filter(Boolean); } catch (e) { /* fall through */ } }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
function contactUris(c) {
  return Array.from(new Set([c && c.uri].concat(parseContactUris(c && c.uris)).filter(Boolean)));
}

function buildUrl(server, path, params, token) {
  const base = String(server || '').replace(/\/+$/, '');
  const q = Object.assign({}, params || {});
  if (token) q.token = token;
  const qs = Object.keys(q)
    .filter(function (k) { return q[k] != null && q[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); })
    .join('&');
  return base + path + (qs ? '?' + qs : '');
}

/**
 * @param {object} opts
 * @param {string} opts.server     export server base URL (http://ip:port)
 * @param {string} opts.token      auth key
 * @param {(url:string)=>Promise<object>} opts.fetchJson   GET → parsed JSON
 * @param {(url:string)=>Promise<Uint8Array|Buffer>} [opts.fetchBytes] GET → raw bytes
 */
function createImportClient(opts) {
  const server = opts.server;
  const token = opts.token;
  const fetchJson = opts.fetchJson;
  const fetchBytes = opts.fetchBytes;
  const url = function (path, params) { return buildUrl(server, path, params, token); };

  function diffNew(serverIds, localIds) {
    const set = localIds instanceof Set ? localIds : new Set(localIds || []);
    return (serverIds || []).filter(function (id) { return !set.has(id); });
  }

  return {
    diffNew: diffNew,

    async listIds(sel) {
      const r = await fetchJson(url('/api/ids', { kind: sel.kind, category: sel.category, period: sel.period, contact: sel.contact || null }));
      return (r && r.ids) || [];
    },

    // Contacts with media in a kind/category/period, ordered by count desc.
    async getContactCounts(sel) {
      const r = await fetchJson(url('/api/contacts-counts', { kind: sel.kind, category: sel.category, period: sel.period }));
      return (r && r.contacts) || [];
    },

    async fetchRow(id) { return fetchJson(url('/api/meta', { id: id })); },
    async fetchBlob(id) { return fetchBytes(url('/api/blob', { id: id })); },
    // All rows for a slice in one request (messages: full rows; files: rows
    // whose bytes are fetched separately by id).
    async fetchRowsBulk(sel) {
      const r = await fetchJson(url('/api/rows-bulk', { kind: sel.kind, category: sel.category, period: sel.period, contact: sel.contact || null }));
      return (r && r.rows) || [];
    },
    async fetchContacts() { return fetchJson(url('/api/contacts.json')); },
    async getSummary() { return fetchJson(url('/api/summary')); },
    async getCalendar(sel) { return fetchJson(url('/api/calendar', sel && sel.contact ? { contact: sel.contact } : {})); },
    async getIdIndex(sel) {
      const r = await fetchJson(url('/api/idindex', { kind: sel.kind, category: sel.category, contact: sel.contact || null }));
      return (r && r.items) || [];
    },

    // The exporting device's SIP User-Agent — stamped on imported rows' `origin`.
    async fetchRemoteUserAgent() {
      try { const s = await fetchJson(url('/api/summary')); return (s && s.device && s.device.useragent) || ''; }
      catch (e) { return ''; }
    },

    // What WILL be added: diff the server selection against local ids.
    async previewSelection(sel, localIds) {
      const serverIds = await this.listIds(sel);
      const newIds = diffNew(serverIds, localIds);
      return { kind: sel.kind, serverCount: serverIds.length, newCount: newIds.length, newIds: newIds };
    },

    // Copy the new items. Callbacks do the actual local writes:
    //   onRow(row)            — insert a message / contact row
    //   onFile(row, bytes)    — insert a file-transfer row + save bytes to disk
    //   onProgress(done,total)
    // Returns { serverCount, newCount, imported }.
    async importSelection(sel, localIds, handlers) {
      handlers = handlers || {};
      const onRow = handlers.onRow || async function () {};
      const onFile = handlers.onFile || null;
      const onProgress = handlers.onProgress || function () {};
      const shouldCancel = handlers.shouldCancel || function () { return false; };

      const localSet = localIds instanceof Set ? localIds : new Set(localIds || []);
      let done = 0;
      let cancelled = false;

      if (sel.kind === 'contacts') {
        // Contacts come whole in one request; diff by uri.
        const serverIds = await this.listIds(sel);
        const newIds = diffNew(serverIds, localSet);
        const targetIds = handlers.onlyIds ? newIds.filter((id) => handlers.onlyIds.has(id)) : newIds;
        const all = await this.fetchContacts();
        const wanted = new Set(targetIds);
        for (const c of all) {
          if (shouldCancel()) { cancelled = true; break; }
          if (wanted.has(c.uri)) { await onRow(c); done++; onProgress(done, targetIds.length); }
        }
        return { serverCount: serverIds.length, newCount: targetIds.length, imported: done, cancelled: cancelled };
      }

      if (sel.kind === 'files') {
        // Files are few and large → fetch each one's row + bytes individually.
        const serverIds = await this.listIds(sel);
        const newIds = diffNew(serverIds, localSet);
        const targetIds = handlers.onlyIds ? newIds.filter((id) => handlers.onlyIds.has(id)) : newIds;
        for (const id of targetIds) {
          if (shouldCancel()) { cancelled = true; break; }
          const row = await this.fetchRow(id);
          if (onFile) {
            let bytes = null;
            try { bytes = await this.fetchBlob(id); } catch (e) { bytes = null; }
            await onFile(row, bytes);
          } else { await onRow(row); }
          done++;
          onProgress(done, targetIds.length);
        }
        return { serverCount: serverIds.length, newCount: targetIds.length, imported: done, cancelled: cancelled };
      }

      // Messages are small and many → fetch the whole slice in ONE request.
      const rows = await this.fetchRowsBulk(sel);
      let newRows = rows.filter((r) => r && r.msg_id && !localSet.has(r.msg_id));
      if (handlers.onlyIds) newRows = newRows.filter((r) => handlers.onlyIds.has(r.msg_id));
      for (const row of newRows) {
        if (shouldCancel()) { cancelled = true; break; }
        await onRow(row);
        done++;
        onProgress(done, newRows.length);
      }
      return { serverCount: rows.length, newCount: newRows.length, imported: done, cancelled: cancelled };
    },
  };
}

module.exports = { createImportClient, buildUrl, contactUris, parseContactUris };
