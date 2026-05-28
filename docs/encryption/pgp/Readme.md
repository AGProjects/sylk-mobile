# Sylk-PGP key management and encryption

Copyright (C) 2019-2027 AG Projects B.V. (https://www.ag-projects.com)

End-to-end encryption layer for sylk-mobile chat messages, file
transfers, and the v3 ZRTP signed handshake. The transport is RFC 4880
OpenPGP wrapped around the `react-native-fast-openpgp` library
(Go-backed native module on both Android and iOS). Sylk uses PGP for
three distinct jobs:

1. **Per-account identity.** A 4096-bit RSA keypair per Sylk account,
   generated on first start and persisted in SQLite. The public key is
   what other Sylk users encrypt to and verify against.
2. **Per-message confidentiality.** Outgoing chat messages and file
   transfers are encrypted to the peer's public key (and to our own
   key, so our other devices can decrypt). Incoming messages are
   decrypted with the local private key.
3. **Per-call identity binding.** The v3 ZRTP signed handshake attaches
   detached PGP signatures to every `probe`/`accept` payload — see
   `docs/encryption/zrtp/Readme.md` for that protocol.

This document describes the implementation that currently ships,
including key generation, on-device storage, server-side sync, the
exchange protocol, the encrypt/decrypt path for messages and files,
and the multi-device backup/restore flow.

---

## Layout in the codebase

| File | Role |
|---|---|
| `app/app.js` | Key generation, SQL persistence, send/save public key, encrypt/decrypt for messages and files, export/restore private key. |
| `app/components/RestoreKeyModal.js` | Clipboard-paste private-key restore UI: paste armored blob, enter password, decrypt with `OpenPGP.decryptSymmetric`. |
| `app/components/ContactsListBox.js` | Imports `OpenPGP` for contact-side helpers. |
| `app/components/CallZrtp.js` | v3 detached `OpenPGP.sign` / `OpenPGP.verify` over canonical-JSON ZRTP payloads. See `docs/encryption/zrtp/Readme.md`. |

All PGP work in JS goes through one wrapper:
`import OpenPGP from "react-native-fast-openpgp"`. The library is a JS
binding to a Go implementation; both Android and iOS ship the same
binary so signatures and ciphertexts interop one-for-one with
`python3-sipsimple`'s `pgpy` on the server side.

---

## Key generation

### Algorithm

`generateKeys()` in `app.js`:

```js
const KeyOptions = {
  cipher: "aes256",
  hash:   "sha512",
  RSABits: 4096,
}

const Options = {
  comment:     'Sylk key',
  email:       this.state.accountId,         // SIP AOR, e.g. ag@sip2sip.info
  name:        this.state.displayName || this.state.accountId,
  keyOptions:  KeyOptions,
}
await OpenPGP.generate(Options);
```

Result is `{publicKey, privateKey}` — both ASCII-armored. Sylk
normalises them by stripping `\r` and trimming, then stores them on
`state.keys = {public, private}` and persists via `savePrivateKey()`.

### Triggers

`generateKeys()` runs when the boot key-status check (`keyStatus`)
concludes the account has no key on the server AND none on the device:

| existsOnServer | existsLocal | action |
|---|---|---|
| no  | no  | `generateKeys()` — brand-new keypair |
| no  | yes | nothing; local key will get pushed on next `sendPublicKey` |
| yes | no  | `showImportPrivateKeyModal` — user must paste the encrypted backup |
| yes | yes, equal | nothing; steady state |
| yes | yes, different | `keyDifferentOnServer = true`; `showImportPrivateKeyModal` — local key is out of sync, user must reconcile |

The `keyDifferentOnServer` flag short-circuits outgoing encryption
(`sendPublicKey`, `_sendMessage` encrypt branches) so we never encrypt
to a stale public key while the user resolves the conflict.

---

## On-device storage

### SQLite

Both halves of the keypair live in the `accounts` table:

```sql
update accounts set private_key = ?, public_key = ? where account = ?
```

Driven by `updateKeySql(keys)`. There is **no** at-rest passphrase on
the on-device private key — the SQLite database itself is the security
boundary (sandboxed app storage on iOS / Android). The passphrase only
comes in for transit / backup (see *Export and restore* below).

### Loading at boot

The account-row select reads `private_key` and `public_key` out
alongside the rest of the account data:

```js
const data = rows.item(0);
keys.public  = data.public_key;
keys.private = data.private_key;
if (keys.public && keys.private) {
    keyStatus.existsLocal = true;
}
```

`state.keys = {private, public}` is the canonical in-memory copy that
every encrypt/decrypt site reads from.

### Per-contact peer keys

A contact's public key lives on `contact.publicKey`, persisted by
`saveSylkContact()` into the same SQL `contacts_ng` table that holds
the rest of the contact record. It is what `OpenPGP.encrypt(text,
contact.publicKey)` reads at outgoing-message time.

---

## Public-key exchange protocol

Sylk public keys travel on the same SylkServer message bus that
carries chat messages, distinguished by content-type
`text/pgp-public-key`.

### Outgoing — `sendPublicKey` / `sendPublicKeyToUri`

Both call into `_dispatchPublicKeySend(uri, origin)`, which checks
preconditions (account ready, key present, `canSend()`), logs the key
length and BEGIN/END markers, and ships the armored block:

```js
this.state.account.sendMessage(
    uri,
    this.state.keys.public,
    'text/pgp-public-key',
    undefined,
    (error) => { /* log ACK or failure */ }
);
```

`sendPublicKey(puri, force)` is the broadcast / addressed variant.
When `keyDifferentOnServer` is true and `force` is false, the send is
suppressed — we don't want to overwrite the server-side copy with a
stale local one while the user is still mid-reconcile.

`sendPublicKeyToUri(uri)` is the targeted variant used in reply paths
and from in-chat reactions.

A per-session `sentPublicKeyUris` Set deduplicates the cross-domain
auto-push (see below) so a single app run sends our key to a given
cross-domain peer at most once.

### Cross-domain push optimisation

Same-domain peers can fetch our key from the SylkServer that runs the
account. Cross-domain peers cannot. `lookupPublicKey(contact, opts)`
fires the cross-domain auto-push BEFORE asking the server for the
peer's key:

```js
const myDomain   = this.state.accountId.split('@')[1];
const peerDomain = contact.uri.split('@')[1];
if (myDomain && peerDomain && peerDomain !== myDomain
        && !this.sentPublicKeyUris.has(contact.uri)) {
    this.sendPublicKeyToUri(contact.uri);
    this.sentPublicKeyUris.add(contact.uri);
}
this.state.connection.lookupPublicKey(contact.uri);
```

The push is gated by `sentPublicKeyUris` so it's idempotent per
session even when `lookupPublicKey` is called multiple times for the
same URI (incoming-call setup + chat icon tap, etc.).

### Incoming — `savePublicKey(uri, key)`

The websocket message handler in `app.js` routes
`text/pgp-public-key` to `savePublicKey(uri, content)`. The function
applies a precondition gauntlet, deciding whether to learn / store /
auto-create:

1. **Account-transition guard.** `accountId` empty → drop. Prevents
   journal-replay items from leaking into a freshly signed-in
   account.
2. **Self-loop guard.** `uri === accountId` → drop. We never store our
   own key as a "contact".
3. **`rejectNonContacts` privacy toggle.** If on AND no existing
   contact row → drop.
4. **Format guard.** Must start with `-----BEGIN PGP PUBLIC KEY
   BLOCK-----` and end with the matching END marker. Whitespace and
   `\r` are normalised first.
5. **Speculative-lookup guard.** If we asked the server for this URI
   via `lookupPublicKey({speculative: true})` (tap-an-AB-row case),
   skip the contact autocreate so we don't mint a ghost contact for
   someone the user only browsed. The flag is consumed regardless of
   the outcome.
6. **Autocreate.** Otherwise, if no contact row exists for the URI
   (e.g. cross-domain first contact), create one via
   `lookupContact(uri, true, true)` — the peer pushing us their key
   is a strong "we're about to talk" signal.
7. **Normalised compare.** For each resolved contact, compare the
   stripped/trimmed incoming key against the stripped/trimmed stored
   key. On change, write `contact.publicKey = key` and
   `saveSylkContact(...)`. This dodges the bug where stored rows
   with `\r` line endings would diff against fresh `\n`-only incoming
   blobs and spam "Public key received" on every connect.
8. **Cross-domain auto-reply.** If `peerDomain !== myDomain` AND we
   haven't already sent ours this session, fire
   `sendPublicKeyToUri(uri)` and mark `sentPublicKeyUris`.

After savePublicKey writes a new key, `_sendMessage`'s encrypt branch
will pick it up the next time the user sends to this URI.

---

## Message encryption

### Outgoing text

The send path in `_sendMessage` (and the analogous outgoing-message
helpers) is:

```js
if (contact && contact.publicKey && this.state.keys.public) {
    let public_keys = contact.publicKey + "\n" + this.state.keys.public;
    await OpenPGP.encrypt(text, public_keys).then((encryptedMessage) => {
        this._sendMessage(uri, encryptedMessage, id, contentType, ts);
    });
}
```

The newline-joined `public_keys` string is the OpenPGP-native way to
encrypt to multiple recipients: the library packs one PKESK per
recipient key into a single PGP MESSAGE. Sylk always adds our own
public key as a recipient so messages we send remain decryptable on
our other devices (multi-device sync via SylkServer broadcast).

Content-types that skip encryption regardless:

- `application/sylk-file-transfer` (encryption is handled by the
  file-transfer pipeline; see *File transfer* below).
- `text/pgp-public-key` (the key blob itself — must travel in clear so
  the recipient can read it).
- Control / sync types: `application/sylk-conversation-read`,
  `application/sylk-conversation-remove`,
  `application/sylk-message-remove`, `message/imdn`,
  `application/sylk-zrtp-negotiation`.

Encryption is also skipped when `keyDifferentOnServer` is true (we
don't have a confirmed-good key state), when the peer has no
`publicKey` stored, or when we don't have a local public key yet
(brand-new account before `generateKeys` completed).

### Incoming text

The websocket handler detects PGP-encrypted bodies by markers:

```js
const is_encrypted =
    message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 &&
    message.content.indexOf('-----END PGP MESSAGE-----')   > -1;

if (is_encrypted) {
    await OpenPGP.decrypt(message.content, this.state.keys.private)
        .then((decryptedBody) => this.handleIncomingMessage(message, decryptedBody))
        .catch((error) => {
            this.saveSystemMessage(message.sender.uri,
                'Received message encrypted with wrong key', 'incoming');
            this.sendPublicKeyToUri(message.sender.uri);  // peer has our stale key
        });
}
```

A decrypt failure is treated as evidence the peer is encrypting under
a stale public key for us — Sylk re-sends our current public key
back to them and saves a system message into the chat. Decryption is
also gated on having a private key at all; without one, the message is
parked encrypted with `encrypted=3` so a later `savePrivateKey` can
re-trigger decryption (the SQL update at the end of `savePrivateKey`
flips `encrypted=3` rows back to `encrypted=1` for retry).

### Location-metadata encryption

Location-action metadata (`message.metadata.action === 'location'`)
gets the same `OpenPGP.encrypt(message.text, public_keys)` path as a
regular text message — it's confidential. Other metadata actions
(`consumed`, `autoanswer`, `label`, `reply`, `rotation`, …) ship as
plaintext.

---

## File transfer encryption

File transfers go through SylkServer's HTTP file-transfer relay. The
file on disk is encrypted with PGP before upload, then decrypted by
the recipient after download. Plaintext never crosses the network.

### Outgoing — `OpenPGP.encryptFile`

```js
let public_keys = contact.publicKey;
if (this.state.keys && this.state.keys.public) {
    public_keys = public_keys + "\n" + this.state.keys.public;
}

await OpenPGP.encryptFile(
    local_url,       // plaintext input path
    encrypted_file,  // ciphertext output path
    public_keys,     // newline-joined recipient public keys
    null,
    { fileName: file_transfer.filename }
);
file_transfer.encrypted = true;
```

The `.asc`-suffixed ciphertext is then base64-wrapped (60-char lines)
and posted to the file-transfer URL. `file_transfer.encrypted = true`
is persisted in the JSON metadata column so the sender's bubble
renders the lock badge on subsequent app starts even though
`file_transfer.url` itself is the relay URL, not an `.asc` path.

### Incoming — chunked decrypt

Downloaded files arrive as base64; Sylk reassembles them into a
binary `.asc` on disk and then calls `OpenPGP.decryptFile`. For large
files the decrypt runs through `decryptInChunks(file_transfer, out,
privateKey)` to keep the JS thread responsive. After success:

- `local_url` is moved to the de-suffixed `outputPath`
- `filename` has the trailing `.asc` stripped
- `file_transfer.encrypted = true` is set on the metadata so the
  bubble still shows the lock badge after the suffix is gone
- the temp base64 / encrypted .asc files are unlinked
- `transferProgress[transfer_id]` is cleared so the bubble switches
  from "decrypting…" back to "tap to open"

---

## Multi-device private-key sync

Sylk lets a user run the same account on multiple devices and have
chat history decrypt on every device. That requires the private key
itself to be syncable, not just the public key. The flow is:
**symmetric-encrypt the private key with a user-chosen password, ship
it through the existing message bus, prompt the receiving device to
decrypt with the same password.**

### Export — `exportPrivateKey(password, email)`

Two destinations:

**(a) Email (off-device backup).** Builds `public_key + "\n" +
private_key`, symmetrically encrypts with the user password, base64s
the ciphertext, and opens a `mailto:` URL prefilled with the body:

```js
const keyPair = public_key + '\n' + private_key;
await OpenPGP.encryptSymmetric(keyPair, password, undefined, KeyOptions);
//                                              ^^^^^^^^^   ^^^^^^^^^^
//                                              fileHints   options (cipher/hash)
```

**Footgun fixed in the current tree.** The library signature is
`(message, passphrase, fileHints, options)` — `KeyOptions` goes in
the **fourth** slot. Earlier code passed it as the third argument,
which silently put `{cipher:"aes256", hash:"sha512", RSABits:4096}`
into `fileHints` and fell back to library defaults for the actual
cipher/hash. The current tree threads `undefined` into `fileHints` and
`KeyOptions` into the options slot so AES-256 + SHA-512 actually take
effect.

**(b) SylkServer broadcast (multi-device).** After `sendPublicKey()`,
encrypts the private key alone with the password and ships
`public_key + "\n" + encryptedBuffer` to **our own account URI** with
content-type `text/pgp-private-key`:

```js
this.state.account.sendMessage(
    this.state.account.id,
    public_key + "\n" + encryptedBuffer,
    'text/pgp-private-key'
);
```

SylkServer fans the message out to every other device signed in to the
same account.

### Restore — incoming `text/pgp-private-key`

The receiving device's message handler routes the content-type
through `handleRemotePrivateKey(keyPair)`:

1. Extract the embedded public key with a regex.
2. If it equals `state.keys.public`, the device is already in sync —
   ack with `sendPublicKey(null, true)` and show a "Private key is the
   same" toast.
3. Otherwise open `showImportPrivateKeyModal` with the encrypted
   payload prefilled, waiting for the user's password.

### Decrypt — `decryptPrivateKey(password)`

The password flow runs `OpenPGP.decryptSymmetric(encrypted_key,
password)`. Two error paths are split apart:

```js
const isWrongPassword =
    errStr.indexOf('password')        > -1 ||
    errStr.indexOf('passphrase')      > -1 ||
    errStr.indexOf('session key')     > -1 ||
    errStr.indexOf('decryption failed') > -1;
this.setState({
    privateKeyImportStatus: isWrongPassword ? 'Incorrect password!' : 'Decryption failed',
    privateKeyImportSuccess: false,
});
```

Without this split, every failure showed "No key received" and a user
who fat-fingered the password couldn't tell apart from a corrupt blob.

On success, `processPrivateKey(keyPair)` extracts both the `BEGIN PGP
PUBLIC KEY BLOCK` and `BEGIN PGP PRIVATE KEY BLOCK` regions, calls
`savePrivateKey({private, public})` (which writes SQL, fans the new
key out to every existing contact record, and re-runs the deferred
first-sync if registration was already done), and ships a
`text/pgp-public-key-imported` notice back to our own account so
sibling devices can render an info bubble in the self-chat.

### `RestoreKeyModal` (clipboard path)

`RestoreKeyModal.js` provides an alternate restore for the
email-backup case. Pasting a base64 body from the email and entering
the password gates `OpenPGP.decryptSymmetric(fullPrivateKey,
password)`. On success the user taps **Use Key** which calls the
parent's `saveFunc(decryptedKey)` — typically `processPrivateKey`.

The component validates clipboard contents up front: it base64-decodes
the paste, looks for `BEGIN PGP MESSAGE` / `END PGP MESSAGE` markers,
and only accepts the substring between them. Malformed input is
rejected before the user is even asked for a password.

---

## PGP-message marker content-types

| Content-type | Direction | Body | Purpose |
|---|---|---|---|
| `text/pgp-public-key` | both | armored PGP PUBLIC KEY BLOCK | Per-contact key exchange. Routed to `savePublicKey`. |
| `text/pgp-private-key` | both (self → self) | `public_key \n encryptedBuffer` | Multi-device private-key sync. Routed to `handleRemotePrivateKey`. |
| `text/pgp-public-key-imported` | both (self → self) | `'Private key imported on another device'` | Informational bubble in self-chat after a successful restore. |

All three are filtered by `isMessageAllowed` so they don't pollute the
journal-on-disk in the same way as ZRTP-negotiation envelopes do — see
the journal-write filters in `syncConversations`.

---

## Interaction with the ZRTP layer

The v3 ZRTP signed handshake reuses these same PGP keys with zero
additional key management:

- `myKeys.private` (local) is read straight off the cached
  `state.keys.private`.
- The peer's `contact.publicKey` is read straight off the cached
  contact row.
- `OpenPGP.sign(text, privateKey, '')` produces an RFC 4880 detached
  signature over the canonical-JSON encoding of every other ZRTP
  payload field.
- `OpenPGP.verify(sigArmored, text, publicKey)` checks the signature
  on the receiver side; a verified failure transitions the ZRTP
  session to `failed`.

This means a user who has only ever exchanged a chat with their peer
already has both the cryptographic material and the cached state for
a v3-protected call — there is no separate "ZRTP keypair". See
`docs/encryption/zrtp/Readme.md` for the wire format and the
receive-side accept/reject policy.

---

## State / capability tracking

### `keyStatus` (in-memory, transient)

```js
{
    existsLocal:     boolean,  // SQL row populated?
    existsOnServer:  boolean,  // server reports a key?
    serverPublicKey: string,   // armored, set when existsOnServer
}
```

Drives the boot-time generate / import / reconcile decision (see
*Triggers* above).

### `state.keys` (in-memory, durable for session)

```js
{
    public:  string,   // -----BEGIN PGP PUBLIC KEY BLOCK-----…
    private: string,   // -----BEGIN PGP PRIVATE KEY BLOCK-----…
}
```

Everything that calls `OpenPGP.encrypt`, `.decrypt`, `.sign`, `.verify`,
`.encryptFile`, `.decryptFile`, `.encryptSymmetric`, `.decryptSymmetric`
reads from here.

### `state.keyDifferentOnServer` (in-memory boolean)

Set when boot reconciliation finds the server's public key differs from
the local one. Suppresses:

- outgoing `sendPublicKey(uri, false)` (would propagate the stale key)
- outgoing message encryption (would encrypt to whoever holds the
  stale-key private half)

Cleared by every successful path through
`decryptPrivateKey` / `savePrivateKey` / `handleRemotePrivateKey`.

### `speculativeLookups` (per-session Set\<uri\>)

Marks URIs we proactively `lookupPublicKey`'d (e.g. AB-row tap)
without the user having committed to actually messaging that contact.
`savePublicKey` honours the flag by skipping the autocreate branch, so
a server reply to a speculative lookup doesn't mint a ghost Sylk
contact. The flag is consumed on first use regardless of outcome.

### `sentPublicKeyUris` (per-session Set\<uri\>)

Dedups the cross-domain public-key auto-push so we send our key to a
given cross-domain peer at most once per app run, even when
`lookupPublicKey` and the savePublicKey reply-path both want to fire.

---

## Quick reference

### Key options

```js
const KeyOptions = {
    cipher:  "aes256",
    hash:    "sha512",
    RSABits: 4096,
};
```

### Generate

```js
const { publicKey, privateKey } = await OpenPGP.generate({
    comment:    'Sylk key',
    email:      accountId,
    name:       displayName || accountId,
    keyOptions: KeyOptions,
});
```

### Encrypt to peer + self

```js
const public_keys = contact.publicKey + "\n" + state.keys.public;
const ciphertext  = await OpenPGP.encrypt(plaintext, public_keys);
```

### Decrypt

```js
const plaintext = await OpenPGP.decrypt(ciphertext, state.keys.private);
```

### Symmetric encrypt (backup)

```js
//                          message,  passphrase, fileHints, options
const blob = await OpenPGP.encryptSymmetric(keyPair, password, undefined, KeyOptions);
```

### Symmetric decrypt (restore)

```js
const keyPair = await OpenPGP.decryptSymmetric(encryptedBlob, password);
```

### Send public key

```js
account.sendMessage(uri, state.keys.public, 'text/pgp-public-key');
```

### ZRTP detached signature

```js
const sig = await OpenPGP.sign(canonicalJson, state.keys.private, '');
const ok  = await OpenPGP.verify(sigArmored,   canonicalJson, contact.publicKey);
```
