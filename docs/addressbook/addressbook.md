# Sylk Mobile Addressbook - Design

## Purpose

**Sync each user's contact list across all of their devices.** A contact that is
created, edited, renamed, re-grouped, or deleted on one device appears the same way on
every other device signed into the same account. The shared store is the SylkServer
[XCAP](https://openxcap.org) addressbook; every device keeps a local SQLite copy for
offline use and fast rendering,
and reconciles it against the server.

Guiding principle: **the server is authoritative.** Where a contact exists on both sides,
server data wins. Purely local data — call history, message previews, and per-device
preferences — is preserved and never overwritten by sync.

Operations can be done online or offline, and all operations are reconciled, eventually.

Use this document when building another client that stores its addressbook in XCAP, or
that has to interoperate with Sylk. By obeying the same rules, the addressbook stays
consistent across different implementations — see
[Chapter 16 Interoperability](#16-interoperability-with-other-clients).

Companion: [`code-reference.html`](code-reference.html) maps this design onto the
implementation — the `_ab*` functions in `app/app.js`, grouped by concern.

**Disclaimer:** always check the code for the actual reference and for undocumented
changes. Documentation can always be out of date.

---

## 1. Architecture

Three layers cooperate:

- **App (sylk-mobile).** The local SQLite `contacts` table is the source of truth for the
  UI. The app renders from SQLite and reconciles it against the server addressbook on
  every load/update.
- **react-native-sylkrtc.** The client library exposes the addressbook as
  `connection.addressbook` — getters `contacts` / `groups` / `policies`, and events
  `dataLoaded`, `dataUpdated`, `dataDeleted`, `dataUpdateFailed`. It keeps an in-memory
  mirror of the server addressbook.
- **SylkServer webrtcgateway → openxcap.** The gateway proxies addressbook reads and
  writes to the openxcap REST API, which stores the addressbook as an XCAP XML document.
  When the document changes, openxcap notifies the gateway (XCAP `xcap-diff` PUBLISH) and
  the gateway tells every online device of that account to converge.

Cross-device propagation therefore flows: **device A writes → gateway → openxcap →
xcap-diff → gateway → all online devices re-fetch and reconcile.**

---

## 2. Data model

### Server contact

```json
{
  "id": "string",
  "name": "display name",
  "uris": [ { "id": "...", "uri": "alice@example.com", "type": "", "attributes": {}, "default": false } ],
  "default_uri": { "id": "...", "uri": "alice@example.com" },
  "dialog": { "policy": "default", "subscribe": false },
  "presence": { "policy": "default", "subscribe": false },
  "attributes": { }
}
```

### Server group

A group is the cross-device form of the app's per-contact **tags** (see Chapter 7). Its
membership is carried as full contact objects (same shape as above), not id
references, and is replaced wholesale on each `addGroup` / `updateGroup`.

```json
{
  "id": "string",
  "name": "Favorites",
  "attributes": { },
  "contacts": [ { "id": "string", "name": "display name", "uris": [ ... ], "default_uri": { ... }, "dialog": { ... }, "presence": { ... }, "attributes": { } } ]
}
```

### Local SQLite `contacts` (key `account` + `contact_id`)

| column | role |
|--------|------|
| `contact_id` | stable local identity (UUID) |
| `remote_id` | the server contact id — the strong link between local row and server contact |
| `uri` | primary/default URI |
| `uris` | additional URIs (CSV) |
| `name`, `organization`, `email` | display fields (synced) |
| `tags` | category / group membership (CSV) |
| `properties`, `local_properties` | JSON; per-device data (preserved, mostly local-only) |
| `deleted` | soft-delete flag (local trash) |
| messaging / call columns, `photo`, `public_key` | local-only, never overwritten by sync |

### In-memory contact

```javascript
{ id, uri, uris:[], name, organization, email, tags:[], properties:{}, localProperties:{}, ... }
```

`uris` is an array of plain URI strings. The contact index resolves a contact by its
`uri`, `id`, any entry in `uris`, or a phone-number variant of any of those.

---

## 3. URI normalization rules

A small set of fixed conventions keep stored URIs consistent across devices and the
server, and keep junk out of the addressbook.

- **Phone numbers are stored without a domain.** A URI whose user part is a phone number
  (`+34918034800@sylk.link`) is stored as the bare number `+34918034800`. The domain is
  appended only on the wire at call/chat time. Matching between the bare number and a
  domain-qualified form is handled by phone-number variants.
- **Conference domains are swapped at the boundary.** The local/Sylk world uses the
  `videoconference.X` bridge; the server addressbook uses the linked `conference.X`
  bridge. On push the local domain is mapped to the server form
  (`videoconference.X → conference.X`); on import/display it is mapped back
  (`conference.X → videoconference.X`). Only the domain is swapped, the username is untouched.
  A conference room is **discovered from a call-history CDR**, saved locally as
  `@videoconference.X`, and **created on XCAP by the client** as `@conference.X`. See Chapter 17 for
  the full conference model.
- **Junk is purged from the server.** Contacts on an IP-literal domain (`user@1.2.3.4`),
  conference rooms whose username starts with `0`, and Bonjour/link-local `@local`
  contacts are not imported. IP/anomaly contacts are deleted from the server; `@local`
  contacts (other LAN clients) are left on the server but skipped locally.

---

## 4. Display name resolution

Only a **real** display name is ever stored. A name is treated as a *URI-echo* (i.e. not
a real name) when it is empty, equals the full URI, equals the URI with `@` removed, or
equals the URI's username. The stored name is chosen as:

```
name = server name   if it is a real name (authoritative)
     = local name     else if the local name is a real name
     = empty           else (the UI shows the URI/username)
```

For a phone-number contact with no real name, the number is looked up in the device's OS
address book and that name is used if found. The UI prettifies a username
(`john.doe → "John Doe"`) only when no real name is stored.

---

## 5. Server ↔ local matching

For each server contact `S`, the app computes `serverUris = unique(default_uri + uris)`
and finds local matches by `remote_id === S.id` (strong link) or by any shared URI:

- **No match → import.** Create a local row with `remote_id = S.id`, the chosen default
  URI, the full URI list, and the resolved name.
- **One match → update (server wins).** Set name / URIs / `remote_id`; leave local-only
  fields untouched.
- **Server duplicates** that share an identical URI set are folded onto one canonical
  server contact and the local row is relinked onto it (`remote_id` adopts the survivor's
  id). See Chapter 16 for how the survivor is chosen and why the redundant server copies are
  **relinked, never deleted**.

The chosen default URI prefers a non-phone address under the account's domain, then any
non-phone SIP address, then a phone number, then the first URI.

---

## 6. Contact attributes

The server contact's free-form `attributes` dict carries the cross-device fields that
have no first-class server column:

| attribute | meaning |
|-----------|---------|
| `organization`, `email` | display fields |
| `bypassdnd`, `muted` | per-contact behavioral flags (stored locally as tags) |
| `read_receipts` | `false` ⇔ the local `noread` tag (receipts off); default `true` |
| `caregiver` | relationship flag (stored locally in `localProperties`) |
| `keys` | **self contact only** — the account PGP keypair saved for cross-device restore (Chapter 22) |

Per-device data — codecs, encryption mode, zRTP state, auto-record, auto-answer, and the
OS-address-book link — is **never** synced.

**Adoption is additive.** XCAP omits unset attributes, so an absent attribute is
indistinguishable from "explicitly false". Adoption therefore only *adds/sets* what the
server explicitly carries and never *removes* a local flag because the server's copy is
empty. Consequence: turning a flag **on** propagates across devices; turning it **off**
is a per-device change. Flag values are read tolerantly as either booleans or the strings
`"true"`/`"false"` (XCAP stores attribute values as text).

**Edit protection.** When the user edits an authoritative field (name / organization /
email), the new value is recorded per contact-field. A re-fetch that is still in flight
can briefly return the pre-edit value; until the server confirms the new value (or a
short timeout elapses), adoption keeps the local edit rather than reverting it.

---

## 7. Groups ↔ tags

Server groups are the cross-device form of the app's per-contact **tags**, which drive
the category bar. A contact in several groups carries several tags; the group **name** is
the tag, resolved to the server **group id** only when talking to the server.

- **Group tags** (`favorite`, `blocked`, `tel`, and any custom tag) map to server groups.
  Reserved tags use canonical names (`favorite → Favorites`, `blocked → Blocked`,
  `tel → Tel`, `chat → Messages`); custom tags use the tag text. The server group name is
  the displayed label. Names are case-insensitive with a Capitalized canonical form.
- **Auto-derived categories** (`messages`, `chat`, `calls`, `recent`, `missed`) are
  computed on each device from message and call history. They are **not** user groups and
  are excluded from group sync entirely.
- **Flag tags** (`bypassdnd`, `muted`, `noread`) and the **`caregiver`** and
  **`autoanswer`** flags are per-contact flags, not groups, and are excluded from
  group treatment — in both directions. `autoanswer` is per-device (see above) and
  is neither published as a group nor adopted from one; a server group named
  `Caregivers` is an ordinary group with no bearing on auto-answer.
- **Conference** group collects all conference contacts (detected by bridge domain).

A per-account local cache maps server group id ↔ name and is replaced from the server set
on every load.

### Live group convergence

- **Adoption (server → local).** For every server group, any local member missing the
  corresponding tag is tagged — continuously, on every sync, not only at first import.
- **Deletion while online.** A group deletion is relayed to all online devices; the client
  library evicts the item from its cache and the app strips the group's tag from local
  members.
- **Deletion while offline.** A device that was offline at delete time receives only a full
  snapshot, with no per-group delete signal. Each device therefore persists the set of
  server group names it has seen: a local-only group that *was* seen before and is now
  gone was deleted elsewhere → its tag is stripped; a group *never* seen on the server is a
  new local group and is kept (and pushed). The first run seeds the baseline from the
  server set only, so a group created locally while offline is never mistaken for a
  deletion.

---

## 8. Cross-device name & attribute sync

Display names and attributes propagate through the server so all devices converge:

- **Push up.** When the local value is real but the server still has only a URI-echo /
  empty value, push the local value up. A real server value is never replaced by a
  username/echo.
- **Adopt down.** When the server carries a value the local row lacks, adopt it. Adoption
  is idempotent and non-replicating, so a change another device pushed shows up here
  without a full re-sync.

---

## 9. First-sync reconciliation & ongoing replication

The addressbook layer stays dormant until the app is fully settled for the current
account (account id set, connection ready, local contacts loaded for this account,
settings loaded, and server data delivered for this account). This prevents one account's
data from leaking into another while switching accounts.

A one-time reconciliation runs **once per account** (guarded by a persistent per-account
marker, with an in-memory re-entrancy guard). It imports/updates server contacts, pushes
local-only contacts up, reconciles groups, and applies the normalization rules — running
in a bulk mode that suppresses per-contact re-renders and then refreshes once. An
interrupted run fast-forwards on the next attempt via a per-contact change signature.

The "once per account" guard is also **published to the server** so it holds across *all*
devices and clients, not just locally. On a clean completion the migration version is
written both to the local `accounts.ab_migration` column and, as the `MigratedVersion`
attribute, onto the user's own (self) XCAP contact. A client that has not migrated yet
checks that attribute first: if the server already carries a marker at or above the version
it would run, the migration is treated as already done — the client adopts the marker into
its local column and **skips** the destructive reconciliation, rather than re-importing
contacts another client deleted on the server. A device that migrated under an older build
re-publishes the marker on its next load. (Bumping the migration version forces a
coordinated re-run: the server marker is then below the new required version everywhere.)

After that, ongoing user edits replicate live (contact then group membership) on save;
deletes replicate to the server. A push adopts an existing server contact with the same
URI rather than creating a duplicate.

On each authoritative load a JSON snapshot of the full server addressbook is written under
the account's private folder for recovery; deleting the account purges that folder.

---

## 10. Offline resilience & retry

Writes are durable across connectivity gaps:

- A contact whose write does not reach the server — because the connection wasn't ready,
  or the server-side write failed transiently — is queued per account.
- The queue is flushed on the next **good** sync (server confirmed reachable), re-pushing
  each queued contact.
- Failures are classified: transport errors and 5xx/408/429 are **retryable** and queued;
  4xx is a **permanent** rejection and is dropped (no infinite retry). The retryable
  classification is produced by the server and carried to the client on the update-failed
  event.

The real success/failure of a write arrives as an asynchronous event (the send callback
only acknowledges transport), so the queue is driven by that event plus the
connection-not-ready case.

**Where the queue lives.** The queue is persisted in **AsyncStorage**, one key per
account: **`ab_ops_queue.<account>`** (the legacy key `ab_pending_push.<account>` is read
once and migrated forward, so writes queued before the rename are not lost). The value is a
JSON array of normalized contact URIs (a serialized `Set`), so it survives app reloads and
restarts and carries the backlog across an offline period until the next good sync drains
it. A related per-account key, `ab_seen_groups.<account>`, backs the group baseline of Chapter 7.

**Logged at startup.** On the **first authoritative load per account** (the `dataLoaded`
entry point), the contents of the pending-push queue are logged once — either
`[ab] [queue] pending-push queue empty (<key>)` or `[ab] [queue] N contact(s) queued for
re-push (<key>): <uris>`. This surfaces writes still owed to the server right away, rather
than only when the queue is flushed (`[ab] [put] flushing N queued contact push(es)`).

---

## 11. Surviving an unreachable server

A transient XCAP outage must never look like "everything was deleted":

- **App safety gate.** If a server snapshot is completely empty (no contacts and no
  groups) while the device still has server-linked local contacts, it is treated as a
  failed fetch and *all* reconciliation is skipped. The UI renders from SQLite, so it is
  never blanked, and the next good snapshot syncs normally.
- **Server skips empty broadcasts.** When a change-triggered re-fetch fails, the gateway
  sends nothing rather than broadcasting an empty addressbook to every device, so a blip
  on one account doesn't wipe state everywhere.

---

## 12. Contact trash (soft / hard delete)

- A dedicated `deleted` column is the soft-delete flag and stays local — a trashed contact
  remains on the server until a hard delete.
- Long-press enters multi-select; a floating action deletes the selection. In normal views
  the action **soft-deletes** (moves the contact to the **Deleted** category, no
  confirmation); inside the Deleted view it **hard-deletes** (server + local + emptied
  groups) with a confirmation. Restore moves a contact back out of Deleted.
- Soft-deleted contacts are hidden from every view except Deleted; the own-account contact
  is never trashable.

---

## 13. Editing behavior

- The edit form is populated from the **selected contact** (name, organization, email,
  tags) and is repopulated only when the modal opens or a different contact is loaded — a
  background sync arriving mid-edit never overwrites what the user is typing.
- A phone-number contact is added to the `Tel` group once at creation; the user may remove
  that later.
- Editing a contact's metadata does not change its position in the list (see Chapter 14).

---

## 14. List order = communication recency

The contact list orders by a timestamp that represents *who you last communicated with*,
not when a row was last touched:

- A contact's timestamp comes from its latest real chat message. System rows (key-received
  notices, call-log entries) do not count.
- A contact with no message history is pinned to a fixed historic date so pure addressbook
  imports sort below people you've actually talked to, instead of jumping to the top.
- A brand-new contact gets "now"; editing an existing contact and background sync never
  bump recency.

---

## 15. Server-side storage requirements

The addressbook is persisted by openxcap as an XCAP XML document, with specific
constraints the gateway and app honor:

- **Attribute values are XML text — strings only.** Non-string scalars are coerced to
  their string form on write (`true`/`false`, numbers), and the app reads attribute flags
  tolerantly as either form.
- **A contact's URI list is replaced, not appended, on update,** and is de-duplicated by
  URI value, so repeated edits cannot accumulate duplicate URIs.
- **Schemaless attribute bags are preserved verbatim** through the gateway models, so
  organization / email / flags round-trip intact.
- **Contact payloads** must carry a `uris[]` where each entry has its own id, a
  `default_uri`, `dialog` and `presence` objects, a non-empty name (the URI username is
  used when there is no real name), and `attributes`. Ids are server-style (`id` + digits).
  Group membership is sent as full contact objects via `addGroup` / `updateGroup`.
- **`dialog` and `presence` are preserved, not reset.** Sylk does not manage these
  event-handling policies, but the server requires them in the payload and overwrites the
  stored values with whatever is sent. An update therefore carries the existing server
  contact's `dialog`/`presence` through unchanged; only a genuinely new contact gets the
  defaults (`{policy: 'default', subscribe: false}`). This avoids clobbering a policy set
  by another client.

---

## 16. Interoperability with other clients

The XCAP addressbook is **shared infrastructure**. Blink, the web client, and any other
SIP/XCAP client on the same account read and write the same document Sylk does. The rules
below describe how Sylk behaves so other clients can converge with it instead of fighting
it. The recurring failure mode is two clients reacting to each other's writes in a loop;
everything here is designed to make that loop impossible.

### 16.1 Contact resolution — one URI, one canonical contact

Two clients can independently create a server contact for the *same* person: a phone
re-creates a contact Blink already had, or two devices add the same address before either
has synced. The result is several server contacts that share an identical URI set. Sylk
resolves this **deterministically** so every device — and ideally every client — lands on
the same survivor without coordinating:

- Contacts are grouped by their full URI set (`default_uri` + `uris[]`, lowercased,
  sorted). A group of size one needs no resolution.
- Within a colliding group, the **survivor is the contact with the lowest `id` by string
  comparison** (`String(a.id).localeCompare(String(b.id))`). Because the rule is a pure
  function of the ids, every device computes the same winner offline, with no locking and
  no last-writer-wins races. Both the live fold path and the one-time first-sync migration
  use the lowest-id rule outright (a real local name is never lost — it is preserved locally
  and pushed back up to the survivor, see Chapter 8).
- Sylk then **relinks** locally: every local row whose `remote_id` pointed at a loser is
  repointed to the survivor's id, **and the losing server contacts are deleted** (see Chapter 16.2).

**Why "lowest id by string sort"?** Ids are server-minted strings (`id` + digits). String
comparison is stable, total, and identical on every platform, so two clients never disagree
about which entry is canonical. Do not use numeric comparison, creation time, or "the one I
made" — those diverge across clients.

### 16.2 Deleting the duplicate (relink, then delete)

When folding duplicates Sylk **relinks every local row onto the lowest-id survivor and then
deletes the losing server contacts**, in both the live fold path and the first-sync
migration. The keeper is chosen by Chapter 16.1 (lowest id), so every device/client agrees on which
entry survives and which are removed.

**History — why this was once relink-only.** Deleting a duplicate used to trigger a cascade:
the Blink/desktop client reacted to the XCAP contact removal by issuing an
`account-remove-conversation`, which the server stored and **re-broadcast forever**, burying
the contact in the Deleted folder on every device. For a long time Sylk therefore *only*
relinked and left the loser in place (harmless but cosmetic). **That server-side issue has
since been fixed**, so the redundant entry is now removed outright rather than accumulating.

**Ordering matters.** Always relink local rows onto the survivor *first*, then delete the
loser — never delete a contact a local row still points at. Each delete also drops any group
left empty by the removal.

### 16.3 Conversation-remove is only honored when the contact is truly gone

A delete is signalled two ways that can arrive in any order: the XCAP contact disappears,
and an `account-remove-conversation` event fires. Sylk treats the **XCAP addressbook as the
authority**: a conversation-remove only buries a contact when that URI is *also* absent
from the live server addressbook. If the URI is still a live server contact, the remove is
treated as spurious — typically another client reacting to a dedup, or a stale
re-broadcast — and is **ignored**, so a contact that still exists is never dropped into the
Deleted folder.

For other clients this cuts both ways: do not emit a conversation-remove for a contact that
still exists in XCAP (e.g. as a reaction to someone else's relink/dedup), and do not expect
Sylk to act on one. A genuine delete removes the contact from XCAP first; the remove then
applies because the URI is absent. Sylk also stamps removes with the action time, so a
replayed or stale remove can never tombstone activity that happened after it.

### 16.4 Payload conventions other clients must respect

To round-trip cleanly through the same document, other clients should follow the same
conventions Sylk relies on (full detail in Chapter 3, Chapter 6, Chapter 15):

- **Preserve `dialog`/`presence`.** The server overwrites these with whatever is sent.
  Carry the existing values through on update; only set the `{policy:'default',
  subscribe:false}` defaults for a genuinely new contact. Resetting them clobbers a policy
  another client set.
- **Preserve the `attributes` bag verbatim.** It carries cross-device fields with no
  first-class column (`organization`, `email`, `bypassdnd`, `muted`, `read_receipts`,
  `caregiver`). Attribute values are XML text, so write scalars as strings (`"true"` /
  `"false"`) and read them tolerantly. Do not drop attributes you don't recognize.
- **Attributes are additive.** An absent attribute is indistinguishable from "false", so
  adoption only *sets* what is present and never *removes* a local flag because the server's
  copy is empty. Turning a flag on propagates; turning it off is per-device. Don't assume a
  missing attribute means another client cleared it.
- **Replace, don't append, the URI list, and de-duplicate by URI value** so repeated edits
  can't accumulate duplicate URIs on one contact.
- **Match URI normalization.** Phone-number URIs are stored bare, without a domain; the
  conference bridge domain is swapped at the boundary (`videoconference.X ↔ conference.X`);
  IP-literal (`user@1.2.3.4`), `@local` Bonjour, and conference rooms whose username starts
  with `0` are treated as junk and not imported. A client that stores a phone number with a
  domain, or imports these junk forms, creates URI-set mismatches that defeat the dedup in
  Chapter 16.1.
- **Don't replace a real display name with a URI-echo.** A name equal to the URI, the URI
  without `@`, or the username is treated as "no real name". Pushing an echo over a real
  name will be rejected by Sylk's resolution and just churns the document.
- **Honor the migration marker on the self contact.** Once any client has run the one-time
  reconciliation, it stamps `MigratedVersion` (the migration version) on the account
  owner's own XCAP contact (the contact whose URI is the account). A client that performs an
  equivalent first-sync cleanup (purging junk, folding duplicates, deleting server entries)
  must check this attribute first and **skip** that cleanup when the server already carries a
  marker at or above its own version — otherwise it re-creates contacts a previous client
  deleted. Publish the same marker after completing your own cleanup so other clients defer
  to it. See Chapter 9.

---

## 17. Conference rooms (videoconference ↔ conference mangling)

Conference rooms live under two linked bridge domains: the **local/Sylk** world addresses a
room as `<room>@videoconference.X` (the `defaultConferenceDomain`, e.g.
`videoconference.sip2sip.info`), while the **server / SIP** world — XCAP, CDRs, the focus —
uses the paired SIP bridge `<room>@conference.X` (e.g. `conference.sip2sip.info`). The two
are a fixed client convention derived by swapping the host prefix
(`videoconference. ⇄ conference.`); only the domain is swapped, the room number (user part)
is never touched.

### 17.1 The mangle, in one place

| direction | function | maps |
|-----------|----------|------|
| server → local (read/import/match/display) | `_abMangleFromServer` → `_abNormServerUri` | `conference.X → videoconference.X` |
| local → server (write/push payload) | `_abMangleToServer` → `_abLocalToServerUri` | `videoconference.X → conference.X` |

`_abServerUris(s)` runs every server URI through `_abNormServerUri`, so the rest of the code
only ever sees the local `videoconference.X` form — matching, dedup (Chapter 16.1), display, and the
contact index all work without special-casing conference rooms. `_abContactServerPayload`
runs the URIs back through `_abLocalToServerUri`, so any write lands on the `conference.X`
form. The swap is scoped to the **configured** domain pair; a non-default conference domain
passes through unchanged on both sides (kept consistent because the same function is used in
both directions).

### 17.2 The client creates the room contact (CDR-driven), stored local / pushed server

A conference room is **discovered from call history and created by the client** — locally
under `@videoconference.X`, and on the server (XCAP) under `@conference.X`. The flow:

- **Discover + store local.** Server call-history CDRs name the remote party on the SIP
  bridge (`<room>@conference.X`). `processServerCallHistory` un-mangles that to
  `<room>@videoconference.X` (instead of dropping it, as it used to), and `saveHistory`
  **creates the local room contact on demand** if it doesn't exist yet (tagging it
  `Conference`) and otherwise updates it. So every joined room becomes a local contact, named
  from the CDR display name / room number, and is always stored under the `videoconference.X`
  form.
- **Create on the server.** A room contact with no `remote_id` is **pushed to XCAP by the
  client** like any other local-only contact (it is *not* excluded from `unlinkedList`). The
  push mangles the URI back to `<room>@conference.X` via `_abLocalToServerUri` /
  `_abContactServerPayload`, and the adopt-by-URI matcher (`_abFindServerContactByUri`)
  un-mangles, so the push **adopts an existing** server room rather than duplicating it.

So the two representations stay paired: local `@videoconference.X` ⇄ server `@conference.X`,
with the client owning both ends. (There is no server-side auto-creation; the client is the
one that writes the XCAP room contact.)

### 17.3 Anomalies and exclusions

A conference room whose **username starts with `0`** is treated as junk (`_abIsConferenceAnomaly`)
— not imported locally, purged from the server, kept out of the push, and excluded from the
CDR-driven create path. Real conference rooms are also excluded from the orphan → graveyard
pass (Chapter 18): they are re-derived from call history, so a missing server entry means "re-create
it on the next push", not "bury it".

---

## 18. Stale server links: orphan-relink and orphan → graveyard

A local row's `remote_id` can end up pointing at a server contact that no longer exists —
e.g. another client deleted that XCAP entry, or an older "wrong-survivor" dedup removed the
keeper a local row was linked to. Such a row is **orphaned**: it is skipped by the adoption
loop (its `remote_id` matches no live server id) and ignored by the local-only push (it
*does* carry a `remote_id`, just a dead one), so it neither converges nor pushes. On every
authoritative load Sylk repairs these, in order:

1. **Orphan-relink.** If the orphan's URI set still maps to a **live** server contact (the
   entry was re-created under a new id, or a duplicate sharing the URI survives), repoint
   `remote_id` onto that live contact (lowest id wins, per Chapter 16.1). The name sync-up (Chapter 8) then
   pushes the real local name up to the survivor.
2. **Orphan → graveyard.** If the orphan's `remote_id` is gone **and** none of its URIs are on
   the server, the contact was genuinely deleted server-side. Sylk **clears `remote_id` and
   tombstones it (`deleted = 1`)** so it becomes a real Graveyard entry instead of a phantom
   active contact. Conference rooms, `@local`, and the own-account contact are excluded.

Both passes run only on a **confirmed-good** snapshot — the empty-snapshot safety gate (Chapter 11)
bails the entire reconciliation when the server returns zero contacts and zero groups while
local contacts exist, so a failed fetch can never mass-relink or mass-bury. (A *partial*
fetch is not caught by that gate; tightening this to a drop-ratio threshold is a known
possible hardening.)

---

## 19. URI `type` on the server payload

Each URI written to the server carries a `type`: a phone number is `tel`, any regular
`user@domain` SIP address is `sip` (`utils.isPhoneNumber` decides, with the conference domain
excluded). `default_uri.type` mirrors the chosen default URI's type. Empty types are no
longer written.

---

## 20. Diagnostics

On the **first authoritative load per launch**, Sylk prints two console tables (read at a
glance in metro instead of 100+ lines):

- `[ab] CONTACTS (N)` — the server XCAP addressbook verbatim, one row per server contact:
  `SERVER DN` (the name as stored on the server, no echo-blanking), `LOCAL DN` (the matched
  local row's name, by `remote_id` then shared URI), `URI`, and `SERVER_ID`. A divergence
  between the two DN columns is visible at a glance.
- `[ab] CONTACTS DIFF (M = local L − server S)` — the local rows that are **not** live server
  contacts, i.e. exactly what accounts for the gap between the local count and the server
  count, each categorized: `self`, `deleted`, `conference`, `junk`, `orphan-link` (dead
  `remote_id`, should be rare once Chapter 18 runs), and `local-only` (never pushed).

---

## 21. Backup & restore

Contact data is protected in layers, from fully automatic to manual.

- **The server is the live backup.** Because every contact and group is replicated to the
  SylkServer XCAP addressbook (Chapter 9), the authoritative copy lives off-device. A
  reinstall or a brand-new device restores the full addressbook just by signing in and
  re-fetching — there is no manual step. The empty-snapshot safety gate (Chapter 11) makes
  sure a transient empty fetch is never mistaken for "everything deleted", so the local
  copy is never blanked by a server blip.
- **Automatic local snapshots (recovery).** On each authoritative load the client writes a
  JSON snapshot of the full server addressbook — contacts, groups, and policies — into the
  account's private folder (`<account>/addressbook/history/`), throttled to at most one per
  week (`_abDumpHistory`). These are a point-in-time recovery / audit record of what the
  server held, kept per account and purged when the account is deleted (`_abPurgeDumpDir`).
- **Manual backup.** A "Backup contacts" action (`backupContacts`) writes an on-demand JSON
  of the authoritative **local** rows straight from SQLite into the same folder
  (`contacts-local-<timestamp>.json`). Unlike the weekly snapshot it is not throttled and
  captures everything on the device, including local-only contacts not yet put to the
  server.
- **Restore from trash (in-app).** Soft-deleted contacts move to the Deleted folder rather
  than being erased (Chapter 12); `restoreContacts` revives a selection back into the active
  list, and `restoreGraveyardContacts` revives tombstoned entries from the Graveyard. This
  is the everyday "undo a delete".
- **Restoring from a snapshot file** is an operator/manual step: the JSON dumps are
  human-readable records intended for recovery and debugging, not an in-app "import this
  file" button. Routine restore is the server re-fetch above; the snapshots are the safety
  net when the server copy itself needs to be reconstructed.

---

## 22. PGP private-key save on the self contact

The account's PGP keypair is saved on the user's **own** server contact so it
replicates across the user's devices over the same XCAP channel as everything else — no
separate transport, no manual export. The keypair travels in the self contact's `keys`
attribute (Chapter 6) as a JSON record:

```
{ private_key, public_key, device, timestamp }
```

`private_key` is **symmetrically encrypted with the account (SIP) password** and is never
stored in clear. The `public_key`, the writing `device` label, and an ISO `timestamp`
travel in clear so any device can see which device saved the key and when. Because the
record is just another contact attribute, it rides the normal contact-write path
(Chapter 9) to the server and on to the user's other devices.

**Save (key landing).** When a keypair is generated or imported on a device, the save
fires (a tick after the keypair is committed locally, and again on each authoritative
addressbook load). It is **idempotent**: it only writes when the self contact carries no
`keys` attribute on the server, so the first device to set up the account wins and later
loads are no-ops. If the account has no password available, the save is **skipped** —
an unprotected key is never stored.

**Restore (new or keyless device).** A device that signs in without a local keypair but
finds a saved `keys` record on its own server contact decrypts `private_key` with the account
password and imports the keypair automatically. This supersedes the manual "import key"
modal: signing in on a new device with the right password is enough to recover messaging.
A wrong or missing password just logs and leaves the manual import as the fallback.

**Re-save on password change.** Because `private_key` is encrypted with the account
password, changing the password leaves the saved copy encrypted with the **old** one,
which a later restore could no longer open. A successful password change therefore forces
a re-save: the private key is re-encrypted with the **new** password and the `keys`
attribute is rewritten through the normal contact update. The contact update is **delayed
by 5 seconds** so the server has time to commit the new password before the rewrite goes
out. This is **best-effort** — the
password change has already succeeded on the server, so a re-save failure is logged but
never surfaced as a password-change error (the next authoritative load will not repair it,
since a saved record already exists; recovery is to change the password again or re-import).
