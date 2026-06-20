/*
 * exportAnnounce.js
 *
 * The "I'm exporting — come and get it" announcement that the exporting device
 * sends to the user's OWN account so it forks to all their other devices.
 *
 *   contentType: application/sylk-data-export   (PGP-encrypted on the wire)
 *   payload:     { v, server, key, timestamp }
 *     server    — base URL of the on-device export server (http://ip:port)
 *     key       — the one-time auth token for that server
 *     timestamp — unix seconds when the announcement was created
 *
 * Receiving devices:
 *   - skip it entirely when it arrives via journal replay (stale),
 *   - and only act on it when it's FRESH (< 60s old) and the device is online,
 *     popping the Import modal.
 *
 * Pure module (no RN imports) so the format + freshness logic is unit-testable.
 */

'use strict';

const EXPORT_CONTENT_TYPE = 'application/sylk-data-export';
const FRESH_WINDOW_SECONDS = 60;
const PAYLOAD_VERSION = 1;

function nowSeconds() { return Math.floor(Date.now() / 1000); }

// Build the JSON payload (this is what gets PGP-encrypted before sending).
// `enc` is the base64 symmetric key the importing device uses to decrypt the
// transfer (see exportCrypto.js) — exchanged securely inside this PGP message.
function buildAnnouncement(opts) {
  opts = opts || {};
  return JSON.stringify({
    v: PAYLOAD_VERSION,
    server: opts.server || '',
    key: opts.key || '',
    enc: opts.enc || '',
    timestamp: opts.timestamp != null ? opts.timestamp : nowSeconds(),
  });
}

// Parse a decrypted payload string. Returns null if it isn't a valid
// announcement (so callers can safely ignore garbage / wrong-type content).
function parseAnnouncement(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (!obj.server || !obj.key || typeof obj.timestamp !== 'number') return null;
  return { v: obj.v || 1, server: String(obj.server), key: String(obj.key), enc: obj.enc ? String(obj.enc) : '', timestamp: obj.timestamp };
}

// Fresh = created within the last FRESH_WINDOW_SECONDS (and not in the future
// by more than a small clock-skew allowance). Journal replays of old
// announcements fail this and are ignored.
function isFresh(timestamp, nowSec, windowSec) {
  const now = nowSec != null ? nowSec : nowSeconds();
  const win = windowSec != null ? windowSec : FRESH_WINDOW_SECONDS;
  if (typeof timestamp !== 'number') return false;
  const age = now - timestamp;
  return age >= -10 && age <= win; // allow 10s of clock skew
}

module.exports = {
  EXPORT_CONTENT_TYPE,
  FRESH_WINDOW_SECONDS,
  PAYLOAD_VERSION,
  buildAnnouncement,
  parseAnnouncement,
  isFresh,
  nowSeconds,
};
