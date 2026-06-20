# First-Start Sequence

## Purpose

Describe what happens, in order, the **first time a freshly installed device signs
into an account** — and how that differs from a normal reload. The first start is
sequenced deliberately so the heavy one-time work (importing the server contact list,
backfilling message history) runs without interruption and without confusing the user
with prompts, banners, or incoming calls before the account is set up.

The guiding rule: **import the authoritative contact list first, keep the device quiet
while doing it, then bring the user into a ready, fully-set-up state.**

---

## Actors

- **App** — local SQLite is the source of truth for the UI; it reconciles against the
  server and renders from SQLite.
- **react-native-sylkrtc** — the connection/account library; exposes the addressbook and
  emits journal (message-history) batches.
- **SylkServer + openxcap** — registration/auth, the XCAP addressbook, and the message
  journal.

---

## Fresh first start (the sequenced path)

1. **Launch.** The active account row is loaded from SQLite; local contacts load (empty on
   a fresh install). PGP keys do not exist yet.

2. **Connect and register.** The account is added to the connection and **registers**.
   Registration is mandatory — it is the authentication step, and it is also what triggers
   the server to deliver the **XCAP addressbook**. (We cannot skip it to avoid incoming
   traffic; instead the device is quieted with DND, below.)

3. **Journal waits for keys.** The first message-history (journal) sync is requested but
   parks itself — *"waiting for keys"* — because messages are end-to-end encrypted and
   can't be processed without the private key.

4. **Contacts sync begins (the one-time migration).** Once the addressbook data arrives and
   the app state is fully settled for this account, the **addressbook migration** runs
   (guard sees `ab_migration = 0`). While it runs, the device is put into a quiet,
   non-distracting setup mode:

   - **Silent DND** is enabled — incoming calls / live messages are dropped client-side so
     they don't compete with the import. No "Do not disturb" toast is shown, and the DND
     pill / navbar bell-off glyph are hidden (the user didn't turn it on).
   - A **"Syncing contacts…" spinner** is shown above the contacts list.
   - The **"no private key" banner is hidden**, the **import-key modal is deferred**, the
     **server call-history is deferred**, and **notification-permission prompts are held
     back**.
   - `syncGroupsTable` (the live group sync) is **skipped** while the migration runs — the
     migration owns group reconciliation — and the migration's group phase runs in bulk
     mode. Per-contact writes are coalesced and zero-unread native writes are skipped, so
     the import is fast (single-digit seconds for ~100 contacts).
   - The per-account **`install_date`** is recorded; SIP/media/QoS traces for calls older
     than the install are never backfilled.

5. **Contacts sync completes.** The migration persists its marker (`ab_migration = 18`),
   then, **in order**: restores DND, hides the spinner, and only **then** surfaces the
   deferred work — the **import-key modal** ("Another Sylk device?") appears and the
   deferred server call-history is replayed. (The modal is intentionally shown *after* the
   spinner clears, never overlapping it.)

6. **User imports the private key.** Keys now exist on the device.

7. **Journal (message history) backfills.** With keys present, the parked journal sync
   runs. Because the contact list is already authoritative as of the sync-start moment, the
   journal **never creates new contacts** and **skips messages for URIs that aren't
   contacts** (history for since-deleted contacts) — except messages newer than the
   sync-start boundary, which arrived live during the backfill. Contact updates from the
   journal are coalesced into a single write pass per page.

8. **First journal sync completes.** Only now is the **OS notification-permission prompt**
   surfaced (it was deferred through the whole setup). The device is fully ready.

Net experience: register → quiet "Syncing contacts…" → (a few seconds) → import-key modal
→ import key → history fills in → notification prompt. No stray calls, banners, or prompts
during setup.

---

## Normal reload (already-migrated account)

On every subsequent start the account is already migrated, so the path is much shorter:

- Register; the addressbook is delivered.
- The migration **guard** sees `ab_migration` is current and returns immediately, marking
  the account ready — which **flushes the same deferred work**: any pending import-key
  modal is shown and any deferred call-history is replayed. (Same `_onContactsReady` hook
  as the fresh path, so the import-key modal is never shown before contacts are known.)
- No silent DND, no "Syncing contacts…" spinner, no contacts migration delay.
- Journal sync runs incrementally from the saved cursor; notification permission isn't
  re-prompted if already decided.

---

## Why each thing is deferred

| Deferred until… | Item | Reason |
|-----------------|------|--------|
| Migration done | Import-key ("Another Sylk device?") modal | The user shouldn't be asked about keys before their contacts exist; and it must not overlap the syncing spinner. |
| Migration done | Server call-history processing | Tallying calls against a half-built contact list mislabels them as "no-contact"; it also competes with the migration for SQLite. |
| Migration done | "No private key" banner | The import-key modal is deferred, so a "no key" banner would be premature. |
| First journal sync done | OS notification-permission prompt | An OS dialog shouldn't interrupt initial setup. |
| (Never, on fresh) | Incoming calls / live messages | Silenced via client-side DND for the migration window, restored after. |

---

## Resilience during boot

- **Unreachable server.** If a fetch returns an empty addressbook (XCAP down) while the
  device still has server-linked contacts, the app treats it as a failed fetch and skips
  reconciliation — it never mistakes an outage for "everything was deleted". The UI renders
  from local SQLite regardless.
- **Interrupted migration.** The migration is marked done only on a fully clean run;
  otherwise it retries on the next load. The deferred modal/history are surfaced only once
  the migration truly completes.
- **Failed writes.** Contact writes that don't reach the server are queued and re-pushed on
  the next good sync.

---

## Key signals (for reference)

- `ab_migration` (accounts column) — `0` = never migrated (fresh); `>= current version` =
  done.
- `contactsSyncing` (state) — true only during a fresh migration; drives the spinner, hides
  the no-key banner, and (via the migration-done gate) defers the import-key modal.
- `_firstJournalSyncDone` (session flag) **OR** `lastSyncId` (persisted) — gates the
  notification-permission prompt. The persisted `lastSyncId` is essential: it means the
  first sync already completed in a prior session, so a reload doesn't defer the prompt
  forever (the session flag alone would).
- `install_date` (accounts column) — boundary for skipping historical call-trace backfill.
- `_onContactsReady()` — single hook that surfaces deferred work (import-key modal +
  call-history), called from both the fresh clean-done path and the already-migrated guard.

---

## Performance (measured)

A full from-scratch run on a mid-range device (FIIO M27, Android 13), account with
**87 server contacts** and **~9,130 messages** of history:

| Phase | Volume | Time | Notes |
|-------|--------|------|-------|
| Contacts migration (XCAP → local) | 87 contacts | **8.9 s** | Down from **~73 s** before optimization — ~**8× faster**. |
| Journal backfill (message history) | ~9,130 msgs, 20 files | **93.4 s** | Fetch + insert of **still-encrypted** rows (~10 ms/msg). Decryption is *not* done here — it's deferred to chat-open. |
| Call traces / QoS for old calls | 100 historical calls | **0 fetched** | Skipped by the `install_date` gate (saved ~200 HTTP round-trips). |
| Whole boot (register → history done) | — | **~2 m 46 s** | Contacts usable at ~9 s; the rest streams in. |

**Where the migration's ~8× came from.** The original 73 s was dominated by *contention*,
not per-write cost: server call-history processing, `syncGroupsTable`, and message saves
all hit the single SQLite connection concurrently. Removing that contention did most of
the work:

- Defer **server call-history** until the migration is done (no competing writes).
- **Skip `syncGroupsTable`** while the migration runs (it owns group reconciliation).
- Run the migration's group phase in **bulk mode** (no per-save re-render / favorite-blocked
  churn).
- **Skip the native unread write** for zero-unread imported contacts.

Measured migration writes: 137 contact rows for 87 contacts in 8.9 s.

**Journal coalescing.** Contact updates from the 20 journal files were **coalesced into a
single flush of 27 writes** instead of one write per (file × contact) — which would have
been many hundreds. The remaining 93 s is fetching and inserting the ~9,130 encrypted rows
(network + IO); batching the inserts into transactions is the next available lever.

**Decryption is lazy and viewport-first.** Crucially, the journal backfill does **not**
decrypt anything — messages land still-encrypted and are decrypted only when a contact is
opened. Because a busy thread holds back the UI, the per-chat decrypt is ordered
**newest-first**: rows load `unix_timestamp DESC`, so the most recent (in-viewport) messages
and images decrypt first while older history above the fold drains afterward with bounded
concurrency. Text uses a 4-wide queue (newest 4 with no breath); already-downloaded
encrypted images use a 2-wide queue (newest 2 with no breath). Leaving the chat aborts the
rest. The user can read the latest messages within a beat instead of waiting for the whole
conversation to decrypt.

**Quiet, gated setup.** Across the whole run: **0 errors**, **0 moment warnings**, migration
ran **exactly once**, DND was silently on for the 8.9 s contacts window only, and no OS
prompts or stray "no key" banners appeared before the contacts were ready.

---

## Lessons learned

1. **Contention, not per-operation cost, dominated.** The first instinct (batch the SQL
   into one transaction) would have been risky and largely unnecessary. The real win was
   *serializing* the one-time work and *deferring* everything that competed with it. Measure
   where the wall-clock actually goes before refactoring a hot path.
2. **Surface modals after the setup UI is cleared, not during.** The import-key modal first
   appeared ~4 s *before* the migration finished, because it was triggered in the clean-done
   branch while a slow DB persist still ran (the modal's `setTimeout` fired during the
   `await`). Fix: clear the spinner/DND in the `finally`, *then* surface deferred modals.
   Lesson: end-of-phase UI transitions belong after all the phase's `await`s, in one place.
3. **Deferral implies re-entrancy — make the deferred work idempotent.** Replaying
   `processServerCallHistory` re-ran a timezone conversion that *mutated* `startTime` into a
   Date; the second pass then fed a Date to moment and logged a deprecation warning. Guard
   mutations so a second pass is a no-op (`typeof === 'string'`, `instanceof Date`, etc.).
4. **Gate one-time-setup behavior on persisted state, not session flags.**
   `_firstJournalSyncDone` is reset every launch, so it deferred the notification prompt
   *forever* on reloads of an already-synced account. The durable `lastSyncId` is the
   correct "first sync ever completed" signal.
5. **Don't act on encrypted data before the key exists — and re-act when it arrives.**
   Without a private key, encrypted downloads/decrypts must be denied (no wasted fetches, no
   stranded "Decrypting…" bubbles). Equally important: once the key lands, the deferred
   decrypts must be *re-triggered* (on chat open), or the user is left with empty bubbles.
6. **Outgoing ≠ "I have it locally."** On a new device, an outgoing file's metadata still
   carries the sender's local `path`, which doesn't exist here — so "tap to act" must prefer
   **download** whenever a server `url` exists, not attempt a re-upload.
7. **The journal backfill is now the dominant first-run cost** (~93 s for ~9k messages) —
   but it's *fetch + insert*, not decryption. Messages are stored still-encrypted; nothing is
   decrypted until a contact is opened. Contact writes are no longer a factor (coalesced to
   27). The next optimization, if needed, is batching the message inserts into transactions.
8. **Decrypt what the user is looking at first.** Decryption happens lazily per-chat, and a
   long decrypt run holds back the UI, so order matters: decrypt **newest-first** (the
   viewport) and let older history drain behind it with bounded concurrency, abortable when
   the user leaves. Don't fire every encrypted item at once — that starves the very messages
   the user wants to read. (This caught a regression where re-enabling deferred *image*
   decrypts kicked off every `.asc` on the page simultaneously, fire-and-forget, with no
   ordering; it's now a 2-wide newest-first queue, matching the text path.)
