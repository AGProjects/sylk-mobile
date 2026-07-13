# Bulk SQL insert for the first XCAP contacts import — design & patch plan

Status: proposal for review. No code changed yet.

## Goal

Replace the per-contact `INSERT` during the **first** XCAP server-contacts
import with a **single transaction** (one commit), and fall back to the current
per-contact path if the bulk insert fails for any reason.

Observed in `metro.log` (fresh boot): ~65 `SQL inserted contact … by
addressbook-import` lines over ~22 s, one DB round-trip per contact.

## Why it's slow today

The import loop (`app/app.js` line ~40612, inside the `syncGroupsTable` /
reconcile path) does, per contact:

```js
await this.saveSylkContact(contact.uri, contact, 'addressbook-import');   // line ~40674
```

`saveSylkContact` (line ~19782) per call:

1. `await waitForContactsLoaded()`
2. a **dedup `SELECT`** (`SELECT contact_id, remote_id FROM contacts WHERE … lower(uri)=lower(?)`, line ~19837)
3. public-key safeguard JS
4. the **`INSERT`** (line ~20007) — and `ExecuteQuery` (line ~6188) wraps
   *every* statement in its own `this.db.transaction(...)`, so each insert is a
   **separate commit**.

So N contacts ≈ N dedup SELECTs + N INSERTs across N commits. WAL +
`synchronous=NORMAL` are already set (line ~5026), but commit overhead per row
still dominates. Re-rendering is *already* batched: `_abBulkMode` suppresses
per-save `setState`, and the reconcile does a single
`loadSylkContacts('post-ab-import', true)` at the end (line ~40881). **Only the
SQL is per-row.**

## The constraint that shapes the design

`react-native-sqlite-storage` binds `?` params with SQLite's
`SQLITE_MAX_VARIABLE_NUMBER` limit (**999** on the bundled engine). The contacts
INSERT has **24 columns**, so a single multi-row `VALUES (…),(…)` statement caps
at `floor(999/24) = 41` rows. A 65-contact import would already overflow one
statement.

Two ways to get "one commit":

- **(A) One transaction, many `executeSql`** — open `db.transaction(tx => …)`
  once, call `tx.executeSql(INSERT…, params)` per row inside it, commit once. No
  variable-limit math, keeps the exact existing single-row INSERT + params.
  **Recommended.**
- **(B) Multi-row `INSERT … VALUES (…),(…)`** — fewer statements, but must be
  chunked to ≤ ~40 rows and the params flattened. More code, more edge cases.

Both achieve the real win (collapse N commits → 1). (A) is lower-risk and is
what this plan implements; (B) is noted as an alternative.

## Proposed changes (all in `app/app.js`)

### 1. Extract param-building so both paths stay identical

Pull the column/param construction (lines ~19992–20006, the `params = [...]`
array) out of `saveSylkContact` into a small helper so the bulk path can't drift
from the single-row path:

```js
// Returns the 24-value params array in the exact column order of the
// contacts INSERT. Single source of truth for both saveSylkContact and
// _bulkInsertContacts.
_buildContactInsertParams(uri, contact) {
    const conference = contact.conference ? 1 : 0;
    const media = contact.lastCallMedia.toString();
    const participants = contact.participants.toString();
    const uris = contact.uris ? contact.uris.toString() : '';
    const unixTime = Math.floor(contact.timestamp / 1000);
    const properties = contact.properties ? JSON.stringify(contact.properties) : '';
    const localProperties = contact.localProperties ? JSON.stringify(contact.localProperties) : '';
    const unread_messages = /* same expression saveSylkContact uses today */;
    return [ contact.id, contact.remote_id || '', this.state.accountId, uri, uris,
        contact.email || '', contact.photo || '', unixTime, contact.name || '',
        contact.organization || '', unread_messages, contact.tags.toString(),
        participants, contact.publicKey || '', contact.direction || '',
        media || '', conference || 0, contact.lastCallId || '',
        contact.lastCallDuration || 0,
        (contact.lastCallTimestamp instanceof Date)
            ? Math.floor(contact.lastCallTimestamp.getTime() / 1000)
            : (typeof contact.lastCallTimestamp === 'number'
                ? Math.floor(contact.lastCallTimestamp) : null),
        properties, localProperties, contact.lastMessage || '',
        contact.lastMessageId || '' ];
}
```

`saveSylkContact` then calls this helper for its existing single-row INSERT — no
behavioral change to that path.

### 2. New `_bulkInsertContacts(contacts)` — one transaction, with fallback

```js
const CONTACTS_INSERT_SQL =
  "INSERT OR IGNORE INTO contacts (contact_id, remote_id, account, uri, uris, email, photo, timestamp, name, organization, unread_messages, tags, participants, public_key, direction, last_call_media, conference, last_call_id, last_call_duration, last_call_timestamp, properties, local_properties, last_message, last_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

// One transaction, one commit, N inserts. Resolves true on full success.
// Rejects (→ caller falls back) on any SQL/transaction error.
_bulkInsertContacts(contacts) {
    return new Promise((resolve, reject) => {
        if (!contacts || !contacts.length) return resolve(true);
        this.db.transaction(
            (tx) => {
                for (const { uri, contact } of contacts) {
                    tx.executeSql(CONTACTS_INSERT_SQL,
                        this._buildContactInsertParams(uri, contact));
                }
            },
            (error) => reject(error),   // transaction rolled back as a unit
            () => resolve(true)         // committed once
        );
    });
}
```

Notes:
- `INSERT OR IGNORE` keeps one stray duplicate from aborting the whole batch on
  the fresh table; the fresh-import gate (below) means collisions are unexpected
  anyway. (If you prefer to *detect* collisions and fall back instead, drop `OR
  IGNORE` and let the transaction reject.)
- The transaction-error callback rejects the whole promise → the caller runs the
  current per-contact path. That is the requested fallback.
- For very large imports, chunk into transactions of ~500 rows (a `for` loop of
  awaited `_bulkInsertContacts` calls over slices). 65 fits in one.

### 3. Rework the import loop to collect-then-bulk-insert

In the `for (const s of serverOnlyList)` loop (line ~40612): keep all the
per-contact *preparation* (it's cheap JS — `newContact`, group/tag derivation,
`_abLatestMessageTimestamp`, timestamp anchor), but instead of awaiting
`saveSylkContact` per contact, push the prepared `{uri, contact}` into an array.

After the loop, if this is the **first import** and the batch is non-trivial:

```js
const _firstImport = this._abImportDoneForAccount !== this.state.accountId;
let _bulkOk = false;
if (_firstImport && prepared.length > 1) {
    this._abBulkMode = true;                 // already used here (line ~41385)
    try {
        await this._bulkInsertContacts(prepared);
        _bulkOk = true;
        _reconcileChanged = true;
        utils.timestampedLog('[ab] [get] bulk-inserted ' + prepared.length + ' server contacts');
    } catch (e) {
        utils.timestampedLog('[ab] [get] bulk insert failed (' +
            (e && e.message ? e.message : e) + ') — falling back to per-contact');
    } finally {
        this._abBulkMode = false;
    }
}

if (!_bulkOk) {
    // FALLBACK: existing path, unchanged — full dedup + UNIQUE→UPDATE handling.
    for (const { uri, contact } of prepared) {
        await this.saveSylkContact(uri, contact, 'addressbook-import');
        _reconcileChanged = true;
    }
}
```

The existing end-of-reconcile `if (_reconcileChanged) loadSylkContacts(…)` (line
~40881) then repaints once, and `_abMarkImportFinished` runs as today — so the
in-memory `allContacts` / `contactIndex` are rebuilt from SQL after the bulk
write (the bulk path deliberately does **not** touch in-memory state per row;
the single reload covers it).

## What the bulk path intentionally skips (and why it's safe here)

| `saveSylkContact` step | Skipped in bulk? | Safe because |
|---|---|---|
| dedup `SELECT` per row | yes | fresh import → empty table; `_importClaim` + `lookupContacts` guards in the loop already prevent in-batch dupes; `INSERT OR IGNORE` covers a stray |
| UNIQUE-constraint → `updateSylkContact` | yes | a real collision/any error → whole batch falls back to per-contact, which has this |
| pubkey-preserve safeguard | n/a | no pre-existing key on a fresh import; the prepared `contact.publicKey` is authoritative |
| per-row `setState(allContacts)` | yes (already, via `_abBulkMode`) | single `loadSylkContacts` reload at loop end |
| `_abReplicateToServer` | yes | not called for `addressbook-import` origin anyway |
| self-contact name/email propagation | yes | self contact isn't part of `serverOnlyList`; if it ever is, route it through `saveSylkContact` separately |

## Risks / test plan

1. **Fresh install, online** — confirm one `bulk-inserted N server contacts`
   line replaces the ~65 per-row lines; all contacts + group tags present; list
   identical to current behaviour; measure the time drop for the import phase.
2. **Forced bulk failure** — temporarily make `_bulkInsertContacts` reject (or
   feed a deliberately bad row); verify it logs the fallback line and every
   contact still lands via the per-contact path.
3. **Variable limit** — if you choose option (B) instead, test an import of
   >41 contacts to confirm chunking; option (A) has no limit but still test the
   real ~65-contact set.
4. **Duplicate safety** — run the reconcile twice (dataLoaded then dataUpdated
   passes); confirm no duplicate rows and no `UNIQUE constraint` errors.
5. **Returning device** — `_abImportDoneForAccount` already set → bulk path
   skipped, per-contact path unchanged; late single additions still sort to
   "now".
6. **Groups/categories** — Favorites/Business/Family/etc. tags applied at import
   time still produce the right category bar after the single reload.

## Files touched

| File | Change |
|---|---|
| `app/app.js` | add `_buildContactInsertParams`; refactor `saveSylkContact` INSERT to use it; add `_bulkInsertContacts`; collect-then-bulk-insert in the `serverOnlyList` loop with per-contact fallback |

No schema change, no new dependency. Behaviour change is confined to the
first-import path; the fallback is the current code verbatim.
