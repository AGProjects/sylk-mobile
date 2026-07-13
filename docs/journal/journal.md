# Sylk Mobile Journal Sync - Design

## Purpose

**Pull each account's message history onto the device and keep it current.** The server
keeps a per-account *journal* — an ordered log of message events (texts, file transfers,
IMDN receipts, conversation/message removes, reads, location ticks). On launch and on
reconnect the client syncs that journal into the local SQLite `messages` table so chats
render offline and stay consistent across devices.

The journal is ordered by **delivery**, not by message timestamp. A cursor
(`last_sync_id` + `last_sync_timestamp`) marks how far the device has consumed it; each
sync resumes from the cursor and fetches only what is newer.

Operations can run online or offline; the cursor and the on-disk cache make the sync
resumable and idempotent.

**Disclaimer:** always check the code for the actual reference and for undocumented
changes. Documentation can always be out of date.

The companion document [`../addressbook/addressbook.html`](../addressbook/addressbook.html)
describes the addressbook, on which the first journal sync depends (see Chapter 2).

---

## 1. The three phases

A journal sync is **request → download/cache → process**, and the three are deliberately
decoupled so a crash between them never loses or re-pulls data.

1. **Request** — `requestSyncConversations(lastId, options, uri)` decides the window
   (cursor delta, or a 5-year window for a true first sync) and asks the SDK
   (`account.syncConversations`) for a batch.
2. **Download / cache** — `syncConversations(messages)` receives a batch, writes it to disk
   as JSON files under the account's journal folder (`writeJournal`), advances the durable
   cursor for what was cached, and paginates until the server returns an empty batch.
3. **Process** — the cached files are read back, parsed, and applied to SQL
   (`_syncConversations`), one file at a time; each file is deleted after it is applied.

The key invariant: **the cursor tracks what has been cached; processing is driven by the
files on disk, not by the cursor.** So the cursor may legitimately run ahead of processing,
and nothing is skipped because the on-disk files remain the source of truth until applied.

---

## 2. Dependencies and ordering

The first journal sync has exactly **one** dependency: the **addressbook import must be
finished**. It does **not** depend on encryption keys.

- The addressbook is marked synced by `_abMarkImportFinished(account)` — called at the end
  of `syncGroupsTable` (the server-marker skip / ongoing reconcile path) and at the
  fresh-migration clean-done. It records `_abImportDoneForAccount` and releases the
  import-gated work (the deferred journal first sync **and** the import-key modal). It is
  **not** fired from the migration guard itself, which on the skip path completes instantly
  while the contact import still runs in `syncGroupsTable`.
- `requestSyncConversations` defers a genuine first full sync (no `lastSyncId` and no
  `lastSyncTimestamp`) until `_abImportDoneForAccount` matches the current account,
  stashing the request in `_pendingFirstJournalSync`. A returning device already holds its
  addressbook and a cursor, so it syncs immediately.
- Keys are **not** a gate. Encrypted messages are stored as ciphertext and decrypted on
  demand or after a key is imported (Chapter 5). The order on a fresh device is therefore:
  **addressbook import → journal sync**, regardless of whether a private key exists yet.

---

## 3. Download & caching

- The server batch is written to disk by `writeJournal`, chunked at **500 messages per
  file**. Each file is named `<lastMsgSafeTimestamp>-<lastMsgId>.json` under
  `<DocumentDirectory>/<account>/journal/`, so files sort oldest → newest by name.
- Remove/read/IMDN control types are filtered out of the *first*-sync cache write (they are
  not durable history), but applied normally during processing.
- Pagination: on a first sync, each cached batch keeps `this.state.lastSyncId` **null** and
  recurses with the batch's last id as the `since` cursor (`this.lastServerJournalId` holds
  the in-memory position). When the server returns an empty batch, pagination ends and
  processing begins.

### First-sync window

When there is neither a `lastSyncId` nor a stored `last_sync_timestamp`,
`requestSyncConversations` requests a **5-year** `since` window (a bare null/null request
returns a truncated batch from the server). If a `last_sync_timestamp` exists it is used as
the `since` fallback, so a pruned server id still resumes by time instead of re-downloading
everything.

---

## 4. The cursor (`last_sync_id` / `last_sync_timestamp`)

The cursor lives in the `accounts` table and is mirrored in `state.lastSyncId` /
`state.lastSyncTimestamp`. It is written by `saveLastSyncId(id, force, messageTimestamp,
allowClear, durableOnly)`.

- **Owned by the sync, never by live deliveries.** Live WebSocket arrivals call
  `saveLastSyncId(..., force=false)` and **do not** advance the cursor. The journal is
  delivery-ordered, so a re-delivered or echoed message carries a fresh-looking id/timestamp
  but an *old* journal position; adopting it would rewind the cursor and re-download the
  backlog. Only the authoritative sync (`force=true`) moves the cursor; any live message is
  picked up and de-duplicated by `msg_id` on the next sync.
- **Cache-time checkpoint (`durableOnly=true`).** As soon as a batch is written to disk, the
  cursor is persisted to SQL **without** touching `state.lastSyncId` (which must stay null to
  keep first-sync pagination going). This is what makes a crash mid-download safe: the next
  launch reads the persisted cursor, fetches only newer journals, and processes the cached
  files already on disk instead of re-downloading them.
- **Per-file checkpoint.** During processing, after each cached file is applied, the cursor
  advances (`force=true`) to that file's last id. Files apply oldest → newest, so the cursor
  moves strictly forward and an interrupted processing pass resumes from the last applied
  file.
- **Null-id protection.** A `null` id only ever comes from the explicit refetch
  (`allowClear=true`), which clears `last_sync_id` but **preserves** `last_sync_timestamp`
  so a later sync resumes by time. Any other `null` is blocked and logged (it would trigger
  a full re-download).

---

## 5. Encryption handling

Journal import does not require a key. Message rows carry an `encrypted` state:

| value | meaning |
|-------|---------|
| `0` / `null` | not encrypted |
| `1` | encrypted ciphertext (not yet decrypted) |
| `2` | decrypted plaintext stored in `content` |
| `3` | failed to decrypt (e.g. broken PGP envelope) |

- Encrypted messages are stored as **ciphertext (`1`)** and decrypted **lazily on demand**
  at load/display time (`decryptMessage`). There is no bulk decrypt at boot.
- `decryptMessage` bails immediately when there is no private key, so a keyless import never
  marks messages `3`; they simply stay `1` until a key exists.
- **Only on key generation or import** (`savePrivateKey`) does the client run
  `UPDATE messages SET encrypted = 1 WHERE encrypted = 3` and retry the deferred sync — so
  anything previously marked failed is re-queued for on-demand decryption. This is the sole
  place that flip happens.

Encrypted **file** attachments are not auto-downloaded without a private key
(`autoDownloadFile denied — encrypted, no private key yet`); they download once the key is
present.

---

## 6. Crash safety & resumability

The cache + cursor design makes every interruption point recoverable:

- **Killed mid-download:** the durable cache-time cursor points at the last cached batch.
  Next launch fetches only newer journals; the already-cached files are processed from disk.
- **Killed mid-processing:** processed files are deleted and the cursor advanced per file;
  unprocessed files remain on disk. Next launch fetches newer (often none) and applies the
  leftover cached files. The cursor may be ahead of processing, which is safe because
  processing reads the on-disk files directly.
- **Pruned server id:** `last_sync_timestamp` lets the sync resume by time instead of
  restarting the whole backfill.

---

## 7. UI signal

`firstSyncPending` drives the sync spinner. It is set when a sync round-trip starts and
cleared by `clearFirstSyncPending` when the sync completes, with a **15-second safety
timeout** so the spinner can never get stuck. Paginated batches reuse a single timeout
window rather than resetting it each batch.

---

## 8. Code reference

All in `app/app.js`.

| Function | Role |
|----------|------|
| `requestSyncConversations(lastId, options, uri)` | Decides the window (cursor delta / 5y first-sync), gates the first sync on addressbook-import-finished, arms the spinner, and asks the SDK for a batch. |
| `syncConversations(messages)` | Receives a batch: caches it to disk (`writeJournal`), advances the durable cache-time cursor, paginates, then drives the processing loop over cached files. |
| `writeJournal(messages, dir)` | Writes the batch to disk as 500-message JSON files named `<timestamp>-<id>.json`. |
| `_syncConversations(messages, file, firstSync)` | Applies one cached file's messages to SQL (insert/update, category/has_link, dedupe by `msg_id`). |
| `saveLastSyncId(id, force, messageTimestamp, allowClear, durableOnly)` | Persists the cursor. `force` = authoritative sync writer; `durableOnly` = SQL-only cache checkpoint that leaves `state.lastSyncId` untouched; `allowClear` = explicit refetch. |
| `_abMarkImportFinished(account)` | True "addressbook synced" hook (end of `syncGroupsTable` / migration clean-done). Sets `_abImportDoneForAccount` and releases the deferred first journal sync and the import-key modal. Idempotent per account. |
| `afterFirstSync()` | Post-first-sync tasks (welcome message, test numbers, push-permission prompt, etc.). |
| `clearFirstSyncPending(reason)` | Clears the sync spinner (idempotent; 15s timeout backstop). |
| `replayJournal()` | Re-dispatches queued **outgoing** journal ops (removes/reads/IMDN). Distinct from the inbound sync above. |
| `decryptMessage(message)` | Lazily decrypts a ciphertext row on demand; bails without a private key. |
| `savePrivateKey(keys)` | On key generation/import: stores keys, flips `encrypted 3 → 1`, and retries the deferred first sync. |
