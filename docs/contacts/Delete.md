# Deleting contacts and messages — lifecycle & all paths

This documents how a contact (and its messages) move through deletion in the
app, the data that drives each state, the multi-device sync, and the UI.
References are to `app/app.js`, `app/components/ReadyBox.js`, and
`app/components/ContactsListBox.js`. Function names are the source of truth.

---

## 1. The columns

`contacts` table:

- **`deleted_timestamp`** (TEXT, nullable) — ISO time the contact was moved to
  the Deleted folder (local delete) or the time an XCAP delete was seen.
- **`storage_purged`** (TEXT, nullable) — set when the contact's storage was
  purged (local delete, or a `removeConversation` from another device).
- **`deleted`** (INTEGER 0/1) — the **tombstone** flag. `1` = killed on XCAP,
  kept as a row in the Graveyard.

**Core invariant:** a contact becomes a tombstone (`deleted = 1`) **only after**
its storage was purged (`storage_purged` set). Tombstoning never precedes purge.

`messages` table uses **`deleted`** (0/1) as a *hide* flag: `1` hides the
message from every view but keeps it on disk (recoverable). A hard purge does a
real `DELETE FROM messages`.

---

## 2. The four states

| State | Data | Where it shows |
|---|---|---|
| **Active** | no deletion columns set | main contact list |
| **Deleted folder** | `storage_purged` OR `deleted_timestamp` set, `deleted = 0` | Deleted folder (messages hidden, `deleted=1` on its message rows) |
| **Graveyard** | `deleted = 1` (tombstone, row kept) | Graveyard (loaded separately; not in `allContacts`) |
| **Ejected** | row physically removed (`DELETE FROM contacts`) | gone — the only truly irreversible step |

Tombstones (`deleted = 1`) are **not loaded** into `allContacts` (skipped in
`loadSylkContacts`), so they can never resurrect via a server import / journal
echo. The Graveyard view loads them on demand (`loadGraveyardContacts`).

---

## 3. Local delete (this device)

The chat-menu **"Delete contact" / "Remove conference"** routes through
`deleteMessages(deleteContact)` → intercepted to **`softDeleteContacts`**
(no confirm modal — the Deleted folder is the undo):

- sets `deleted_timestamp` + `storage_purged`,
- **hides** the contact's messages (`deleted = 1`, recoverable),
- does **nothing** on the server,
- closes the chat and jumps to the Deleted folder (`gotoDeletedSignal`).

Multi-select trash (`ReadyBox.handleContactDelete`) does the same soft delete.

---

## 4. The Deleted folder (tap a contact → dialog)

In the Deleted view a tap does **not** open the chat — it shows
`showDeletedContactOptions`:

- **Restore** → `_reviveContact`: clears `deleted_timestamp` + `storage_purged`,
  **resets `remote_id`**, un-hides the messages, and re-pushes (adopt-by-URI if
  the server still has it, else `addContact` with a fresh id).
- **Proceed** → `hardDeleteContacts`: the manual "kill on XCAP". For each URI:
  send `removeConversation`, hard-purge messages + on-disk transfer folders,
  delete the contact from XCAP, then tombstone (`deleted = 1`) → Graveyard.
  Processed top→bottom so tiles vanish live.

The **"all messages will be deleted"** warning is shown only when the contact
still has stored (hidden) messages — i.e. it was **locally deleted**. If it was
**remotely purged** (messages already hard-deleted), just the buttons show.
(`contactHasStoredMessages` counts rows including hidden ones.)

---

## 5. The Graveyard (tap a tombstone → dialog)

`showGraveyardContactOptions`:

- **Revive** → `_reviveContact` (handles tombstones): `deleted = 0`, clears the
  markers, resets `remote_id`, un-hides, re-pushes, and reloads so it returns to
  the active list.
- **Eject** → `ejectContact`: the ultimate, irreversible step — `DELETE FROM
  contacts` physically removes the row. (Messages/files were already hard-purged
  when it was killed on XCAP.)

---

## 6. Multi-device (secondary device)

A delete on one device reaches others as **two independent signals**, in any
order. Tombstoning waits until both are satisfied (purge done + delete known):

- **`removeConversation`** (server event / journal) → `_purgeContactStorage`:
  hard-deletes the conversation's messages + files and sets `storage_purged`. If
  the contact is already marked for deletion, it finalizes the tombstone.
- **XCAP contact delete** (`dataDeleted` → `previewAddressbookDelete`, now an
  active handler) → sets `deleted_timestamp`; if `storage_purged` is already set,
  finalizes the tombstone.

### Offline reconciliation (diff at load)

The live `dataDeleted` only reaches devices online at delete time. So on every
addressbook load, on a confirmed-good server snapshot, the sync **diffs** local
linked contacts against the server set: a contact with `storage_purged` set whose
`remote_id`/URI is **no longer on the server** is finalized to a tombstone (it
was deleted elsewhere). If it is **still on the server**, it stays in the Deleted
folder — **XCAP removal is never automatic**; someone must Proceed/kill it
manually. (Look for `[XCAP] [ab] [get] [reconcile]` log lines.)

---

## 7. Revival rules

- Revival clears `deleted` / `deleted_timestamp` / `storage_purged`, **resets the
  (stale) `remote_id`** so the contact re-links or re-creates cleanly on XCAP,
  un-hides the conversation, and re-pushes.
- **Call-history revival** (`saveHistory`): a call **newer** than the deletion
  marker (`storage_purged` or `deleted_timestamp`) auto-revives the contact; a
  call **older** is stale history and is skipped.

---

## 8. UI summary

- The **Deleted** category pill is always shown; **All** is always the first pill
  (one-tap reset of any filter).
- Entering Deleted collapses the category bar to **All · Deleted · Graveyard**
  (Graveyard only appears inside Deleted). The bar remounts on filter change so
  it lays out cleanly.
- **No navbar kebab** in the Deleted / Graveyard views — they offer their own
  per-contact actions instead.
- A tap in Deleted/Graveyard never opens the chat; it shows the action dialog.

---

## 9. Guarantees

- The own/self contact is never deleted.
- `deleted = 1` is only ever set **after** `storage_purged` (purge-before-tombstone).
- `updateSylkContact` can never blank a stored `remote_id` (COALESCE guard); the
  private key write is similarly guarded — neither is lost by an empty/raced write.
- XCAP removal is **never automatic** — only an explicit Proceed/kill, or a delete
  that already happened on the server, finalizes a tombstone.
- Tombstones are never loaded and are excluded from the live local→server push, so
  a deleted URI cannot resurrect. The only way a row leaves the DB is **Eject**.

---

## 10. Startup audit

At startup the app logs every contact carrying any delete-state column under
`[contact] [deleted]`, with a derived label:
`active` / `trash-marker-only` / `DELETED(folder)` / `TOMBSTONE(graveyard)`, plus
the raw `deleted`, `deleted_timestamp`, `storage_purged`, `remote_id`.
