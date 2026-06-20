/*
 * exportCrypto.js
 *
 * Symmetric encryption for the LAN export/import transfer. The exporter mints a
 * random key at server start and ships it inside the PGP-encrypted announcement
 * (so only the user's own devices learn it). Each HTTP body is then sealed with
 * NaCl secretbox (XSalsa20-Poly1305): output = nonce(24) || box. This gives the
 * phone-to-phone import end-to-end confidentiality over plain HTTP, without
 * depending on TLS (which the app's HTTP client rejects for self-signed certs).
 *
 * Pure (no RN imports) so it runs in the on-device server, the import client,
 * and the Node mock unchanged.
 */

'use strict';

const nacl = require('tweetnacl');
const { Buffer } = require('buffer');

const KEY_LEN = nacl.secretbox.keyLength;     // 32
const NONCE_LEN = nacl.secretbox.nonceLength; // 24

// Random base64 key for a session.
function generateKey() {
  return Buffer.from(nacl.randomBytes(KEY_LEN)).toString('base64');
}

function keyBytes(keyB64) {
  const k = Buffer.from(String(keyB64 || ''), 'base64');
  if (k.length !== KEY_LEN) throw new Error('bad key length');
  return Uint8Array.from(k);
}

// Encrypt a Buffer/Uint8Array → Buffer of nonce||box.
function encrypt(keyB64, plain) {
  const key = keyBytes(keyB64);
  const nonce = nacl.randomBytes(NONCE_LEN);
  const msg = Uint8Array.from(Buffer.isBuffer(plain) ? plain : Buffer.from(plain));
  const box = nacl.secretbox(msg, nonce, key);
  const out = new Uint8Array(NONCE_LEN + box.length);
  out.set(nonce, 0);
  out.set(box, NONCE_LEN);
  return Buffer.from(out);
}

// Decrypt a Buffer/Uint8Array of nonce||box → Buffer (throws on auth failure).
function decrypt(keyB64, data) {
  const key = keyBytes(keyB64);
  const d = Uint8Array.from(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const nonce = d.slice(0, NONCE_LEN);
  const box = d.slice(NONCE_LEN);
  const plain = nacl.secretbox.open(box, nonce, key);
  if (!plain) throw new Error('decryption failed (wrong key or corrupted data)');
  return Buffer.from(plain);
}

module.exports = { generateKey, encrypt, decrypt, KEY_LEN, NONCE_LEN };
