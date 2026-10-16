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

Three clients share the addressbook of an account:

- **sylk-mobile** (React Native, react-native-sylkrtc), described throughout this document.
- **sylk-desktop** (Electron, sylkrtc.js), which follows the same rules through the same shared
  JavaScript files. Its implementation is described in [Chapter 27](#27-sylk-desktop).
- **Blink desktop for macOS** (Python, python3-sipsimple), which talks XCAP directly and
  implements the same rules in Python.

On the mobile, three layers cooperate:

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
  "defaultUri": { "id": "...", "uri": "alice@example.com" },
  "dialog": { "policy": "default", "subscribe": false },
  "presence": { "policy": "default", "subscribe": false },
  "attributes": { }
}
```

The default URI travels as **`defaultUri`**: that is the field the gateway sends (webrtcgateway
`models/xcap.py`, `Contact`), filled with `uris[0]` when the document names no default. The
gateway also accepts `default_uri` on writes and renames it. A client reading a contact must
read `defaultUri` first; reading only `default_uri` never sees the server's default
(`addressbookRules.chosenDefaultUri` reads both, `defaultUri` first).

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

## 5b. Group attributes

A group carries an `attributes` bag exactly as a contact does, and it holds one
field:

| attribute | meaning |
|-----------|---------|
| `kind` | what the group **is**, independent of what it is called: `calls`, `tel`, `blocked`, `conference`, `missed`, `favorites`, or absent for an ordinary user group |

`blocked` matters more than the other two: it is what a client reads to decide
whether to reject an incoming call, so a group whose identity depends on its
name would stop blocking the moment somebody renamed it.

Note what `blocked` does **not** mean. A presence policy of `block` says "do
not tell them whether I am available" and must never decide whether a call
rings — a user can perfectly well take calls from someone they do not share
presence with. The two are separate lists that happen to share a word.

**Why it exists.** A group's `id` belongs to whichever client created it — ours
come from `_abGenerateServerId`, Blink's from its own allocator — and its `name`
is a label the user may rename at any time. Neither is an identity two clients
can agree on. Blink looked for the Calls group by name and would have created a
second one the first time it was renamed; that second group then replicates back
here and shows up alongside the first.

`kind` is the identity that survives both. Resolution order, in every client:
**kind → name → create.** The name fallback is permanent: every group that
exists today predates the attribute and carries no `kind`.

**Rules, and they are the same on both sides:**

- Never create a group in order to stamp one. No group, no write.
- Never overwrite a `kind` another client wrote. A value you did not write is a
  fact about someone else's intent, not a free slot.
- Preserve the rest of the bag (chapter 16.4 already requires this).
- Stamp at most once per account per session: every write re-triggers
  `dataUpdated` → reconcile, and that loop is easy to start.

Values are lowercase machine words, never display text. Blink writes the same
ones through `BlinkGroupExtension.kind`, a sipsimple `SharedSetting` that lands
in this same XCAP attribute bag.

### 5b.1 Reserved group ids

The rule, and it applies to every client:

> A group the software creates by itself — from calls, from missed calls, from
> a number being a number — is not the user's group and must not depend on the
> user's spelling of its name. It gets a reserved id.

`_messages` has worked exactly that way for years. It works because only one
client ever creates it; once two clients create the same group, an id nobody
has to agree on in advance is the only thing that makes them the same group.

| kind | reserved id | local tag | mapped name |
|------|-------------|-----------|-------------|
| `calls` | `_calls` | `calls` | Calls |
| `tel` | `_tel` | `tel` | Tel |
| `blocked` | `_blocked` | `blocked` | Blocked |
| `conference` | `_conference` | `conference` | Conference |
| `missed` | `_missed` | `missed` | Missed |
| `favorites` | `_favorites` (legacy `favorites`) | `favorite` — **singular** | Favorites |
| — | `_messages` | `messages` (device-local) | Messages |
| — | `_deleted` | — | Deleted |

The singular `favorite` is the tag this client has always stored, and
`_abGroupNameToTag('Favorites')` maps onto it. Writing `favorites` there would
tag every member with a string nothing else matches.

`_abReservedIdForKind` supplies the id to `_abCreateGroup`, which pins it
instead of minting one from `_abGenerateServerId`. This client deliberately did
*not* pin ids before, and the reason has gone: it minted a server-shaped id for
every group it created, so a pinned id would simply have lost the race. Blink
pins the same ids now, so whichever client gets there first produces the same
one and the second finds it.

**`kind` does not go away.** An id cannot be changed: every group already in
the wild carries the arbitrary id of whichever client created it, and the only
way to give it a reserved one is to delete and re-create it, which drops the
membership on every device that has not synced. The two mechanisms cover
different populations —

- `kind` identifies the groups that already exist;
- the reserved id identifies the groups created from now on.

Resolution order, in both clients: **kind → reserved id → name**. The name
fallback is permanent, for groups that predate both.

`_abReservedGroupKeys` maps ids onto reconcile keys and resolves *both*
spellings of Favorites (`favorites` and `_favorites`) onto one key, so the
migration can move between them without either client losing sight of the group
in between. `_abMigrateReservedIds(ab)` performs the delete-and-re-create,
bounded to three attempts and reading the **live** `ab.groups` each pass — a
snapshot taken before stamping silently skips the groups stamped during the
same pass.

### 5b.2 A fold is a merge, not a removal

When two groups collapse onto one reconcile key, the loser's disappearance is
**not** a membership removal. `_abApplyServerDelete` ignores a delete when a
surviving group shares the deleted group's key. Without that guard the fold
stripped the tag from 17 contacts, which the next reconcile re-adopted — a
churn loop with no end state.

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
  computed on each device from message and call history. `messages`, `chat` and `recent`
  are **not** user groups and are excluded from group sync entirely — they carry no
  `kind`, no other client owns them, and the server copy is per-device.
  `calls`, `missed` and `favorites` are the exception and are **bidirectional**: when the
  server group carries a `kind` (chapter 5b) another client created it as part of the
  cross-client contract, so its membership is shared — this device contributes its own
  call parties and adopts the ones other clients filed. See chapter 23 for what happened
  when that was not true.
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
  default URI (`defaultUri`; `default_uri` is accepted on writes, see Chapter 2), `dialog` and `presence` objects, a non-empty name (the URI username is
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

The two signals race. sylk-desktop holds a live remove whose contact is still in the
addressbook for up to ten minutes and applies it once the addressbook shows the address gone;
a journal replay for a live contact is dropped (Chapter 27.7).

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
- **A phone number must announce itself with `+` or a leading `0`.** The detector
  (`utils.isPhoneNumber`, `/^(\+|0)[\d\-()_\s]+$/` on the local part) deliberately
  rejects a bare digit string, so `31208005160@sylk.link` is an ordinary SIP
  contact and never gets `type=tel`, never reaches the PSTN canonicalisation, and
  never lands in the Tel group. This is not an oversight to be widened. Digits
  with no prefix are ambiguous by nature: `1233@sylk.link`, `3333@sylk.link` and
  `4444@sylk.link` are extensions on this very account, and a rule generous
  enough to catch `31208005160` catches those too — and misfiling one rewrites
  its address in the shared document for every client. A number that should be
  dialable is written `+31208005160`, by whoever adds it; a client does not get
  to guess. Reviewed and reaffirmed 2026-09-09; the alternatives considered and
  rejected were a home-country-code prefix test and an
  only-when-a-canonical-twin-already-exists test.
- **The domain goes on at the wire, never in storage.** A phone contact is stored
  bare and the account domain is appended only when a call or a message is
  actually sent, at the one boundary each client has for that (sylk-mobile:
  `_wireUri` in `_sendMessage`, and `callKeepStartCall` / `CallManager.startCall`;
  Blink: `normalize_sip_uri_for_outgoing_session`). Storing the wire form
  instead is the mistake this rule exists to prevent — it also bypasses the
  account's dial plan, because the PSTN rewrite is gated on the URI having no
  domain yet.
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

---

## 23. Shared groups: the day the Calls group vanished

On 2026-09-05 the account's Calls group went from 30 members to 1. This client
deleted it — a Blink Mobile 8.4.1 handset issued
`DELETE …/groups/id1784208880483595094913657` three seconds after connecting —
and everything in chapters 5b.1 and 24 exists because of it.

### What the heal believed

The **self-heal stale dynamic groups** loop treated `calls` and `recent` as
*locally authoritative*: they are derived on the handset from its own call log,
so a copy of one sitting on the server can only be this device's own leftover,
and the heal deletes it.

That premise held for exactly as long as this client was the only one writing
them. Blink desktop then started publishing a Calls group of its own, and
nothing told the heal. It saw a server-only `Calls`, concluded it was stale,
and removed it. Desktop's in-flight `PUT` of the same document took a
**412 Precondition Failed**, re-`GET`, and sipsimple's reload correctly dropped
the local group — with its 30 memberships.

### The fix, in one negation

```js
_abIsDeviceLocalGroup = (key, g) =>
    this._abAutoLocalGroups.has(key) && !this._abGroupKind(g);
```

A `kind` means another client created the group as part of the cross-client
contract, so its membership is **shared**, not derived — the heal can no longer
delete it, and this device adopts it instead of fighting it.

`_abIsDeviceLocalName(key)` answers the same question for a group that does not
exist on the server yet, where only the name can answer it: create the
categories we know a kind for (Calls), never the purely derived ones (Messages,
Recent).

### Rules that came out of it

- **Never delete a server group you did not create**, unless it carries no
  `kind` *and* its key is one this device derives.
- **A group that exists on both sides and means the same thing on both sides
  must actually cross.** Before this, desktop published a Calls group nobody on
  mobile read, while the handset held 33 contacts tagged `calls` that never
  reached the server.
- **Creation re-reads the live set.** `_abCreateGroup` gates on a snapshot and
  then re-checks live `kind` and reserved id before writing, so two devices
  racing to create the same group produce one group.

---

## 24. Startup repairs

Four kinds of drift had accumulated in the shared document. All four are
repaired automatically, by this client **and** by Blink desktop, so it does not
matter which one the user launches first. Both sides run the same rules; the
symmetry is the point, because a repair only one client performs is undone by
the other.

### 24.1 The conference domain

`_abServerConferenceUri` rewrites `videoconference.X` → `conference.X`
unconditionally at the server boundary, and this client never uploads the
`videoconference.` form again. Rooms addressed the other way are not reachable
from Blink on macOS (chapter 17 has the two-domain background).

Comparison is by **domain**, not by whole address: a contact whose URI has
already been repaired no longer matches a whole-address test, which is how a
display name was left reading `338318@videoconference.sip2sip.info` after its
URI had been fixed.

### 24.2 Display names that echo the URI

A name equal to the address, the address without `@`, or the username is not a
name — it is the absence of one (chapter 4). For a conference room the
replacement is the **room number**, not the whole address: `338318`, not
`338318@conference.sip2sip.info`. Matching is on the local part, for the same
reason as 24.1.

**What a repair may write instead is narrower than what counts as an echo.** "No
real name" decides whether a name may be *filled* (25.5). It does not license
rewriting one echo into another. The reference is Blink's
`echoed_name_replacement` (HistoryManager.py), which sylk-desktop ports exactly
(`contactPayload.nameReplacement`):

| stored name | address | repaired name |
|-------------|---------|---------------|
| `338318@videoconference.sip2sip.info` | `338318@conference.sip2sip.info` | `338318` (a room is its number) |
| `+31618853125@sylk.link` | `+31618853125` | `+31618853125` (the number) |
| `0034913336701` | `+34913336701` | `+34913336701` (the number, another spelling) |
| `foo@old.example.com` | `foo@new.example.com` | `foo@new.example.com` (follows the address) |
| `gogo@sylk.link` | `gogo@sylk.link` | **unchanged** |
| `1233` | `1233@sylk.link` | **unchanged** (an extension is not a number) |
| `Nissan Rustman` | anything | **unchanged** |

A SIP contact named by its own full address keeps that name. Its username is not a better
name, and often a worse one: an account with `4444@sip2sip.info`, `4444@sip1.budgetphone.nl`
and `4444@ag-projects.com` shows three contacts called `4444` once the domains are stripped.
Blink states the constraint as *"a name has to be no worse after this function than
before it"*.

On 2026-09-16 a sylk-desktop build that wrote the username for every echo renamed 31
contacts on one account this way before it was caught. The origin stamps (Chapter 26) named
the device and the pass, and the names were restored from the `was` values in Blink's
`[ab] [origin]` log.

*Open:* the mobile heal (`_abCanonicalServerContact`) replaces any echo with the default
address, so a contact named `gogo` or `Gogo` on `gogo@sylk.link` is renamed to
`gogo@sylk.link` here and left alone by Blink and sylk-desktop. It does not loop, because
nobody renames it back, but the clients disagree about it.

### 24.3 PSTN canonicalisation

`_abCanonicalPstn` / `_abApplyLeadingZeroRule` put every phone-number URI into
the bare E.164 form chapter 3 specifies, with an 8-digit floor so short codes
are left alone. `_abLogPstnCanon` prints what changed.

### 24.4 Filing into the kinded groups

`_abFileIntoKindGroup(ab, kind, canonName, wanted, why)` and
`_abFileConferenceContacts`: every conference contact belongs in Conference,
every phone number in Tel, and so on. The rule is derived from the **URI**, not
from a tag, so it is self-correcting.

**Repair first, then file.** The first version filed the `videoconference.`
rows into the Conference group without repairing them, so the group ended up
holding addresses that could not be dialled.

`_abNormalizePstnContacts(ab, sContacts)` is the generalised drift pass that
carries all three of the above — PSTN URI, conference domain (by domain
comparison), echoed name — over the server contacts in one walk.

### 24.5 The Email group is no longer created

Nothing auto-generates it, on either client. `email` joins `_abNonGroupTags`
alongside `bypassdnd`, `muted`, `noread`, `history`, `caregiver`, `autoanswer`
and `phone`. An Email group that already exists is left alone — deleting
somebody's group is not a repair — so the one in the wild has to be removed by
hand once every device is running the new build.

### 24.6 What the heal may still delete

The heal loop now reads, in order:

```
if (this._abGroupIsShared(g)) KEEP      // carries a kind: another client owns it
if (healMembers)              KEEP      // it still has members we can account for
else                          DELETE
```

`_abGroupIsShared = (g) => !!this._abGroupKind(g)` is the whole of the first
rule, and it is the one that was missing in chapter 23.

---

## 25. Safe healing: E.164 addresses and adopted display names

Two clients share one document and each holds a rule about how an address should
be spelled. That is enough to build a machine that never settles: A rewrites a
contact its way and publishes, B fetches, rewrites it back its way and
publishes, A fetches. Nobody is malfunctioning — each step is a client
correctly applying its own rule — and the document changes for ever.

A loop needs three ingredients, and removing any one of them stops it. The
design removes all three.

### 25.1 One canon, or nothing else matters

Both clients must compute the **same** canonical form, so that healing is
idempotent not just within a client but across them:

    heal(heal(x)) == heal(x)          and          heal_blink(x) == heal_mobile(x)

For a PSTN address that canon is bare E.164 — `+3180081867`, no domain, `tel`
type (R4, chapter 3). Mobile and sylk-desktop compute it with the same file,
`addressbookRules.js` (`normalizeUri` / `canonicalPstn`); Blink uses `pstn_e164` /
`canonical_pstn_uri`. If those two
ever disagree about one number, no amount of scheduling saves the document:
each client will forever "correct" the other. Scheduling is the second line of
defence; agreement is the first.

### 25.2 Heal after adopting, never before

The heal runs on the **merged** state: fetch the server document, apply it
locally, and only then look for rows to repair.

    fetch → apply → settle → heal → publish

Healing local rows before the snapshot arrives is worse than useless. Those rows
are about to be overwritten by the server's copy, so the work is thrown away —
and then the server's copy lands carrying the old spelling, which the client
sees as fresh damage and heals again on the next launch. That is the shape of a
loop that looks like a stubborn bug: the same contacts repaired every single
start.

- **Mobile**: the heal is triggered from `_abMarkImportFinished`, the hook that
  fires when the addressbook is genuinely synced — never from the boot timer it
  used to hang off.
- **Blink**: `repair_contact_addresses()` runs from
  `calls_group_startup_check(xcap_loaded=True)`, reached through
  `_callsGroupAfterReload`, which `ContactListModel` schedules
  `XCAP_SETTLE_DELAY` after the document was applied.

### 25.3 Once per run, not once per change

A heal triggered by a *change* is a feedback path: it sees its own published
result come back and acts on it. A heal triggered by *startup* is not — it runs,
converges, and stops.

Both clients hold a per-run guard (mobile `_abHealedAccounts`, Blink
`_conference_uris_repaired`). This also makes the log diagnostic: a heal that
finds work every launch means something else is un-healing it between runs, and
that something is the bug. Running the heal more often would hide it.

### 25.4 A heal is never announced

`application/sylk-addressbook-update` says "a person changed something, come and
look". A heal is derived state: every device computes the same result from the
same document, so telling them is redundant at best, and at worst it is the
loop's carrier signal — A's heal wakes B, whose heal writes back, which wakes A.

So every reload-driven repair runs inside a suppression scope (chapter 5 of the
message spec): mobile for the whole of `_abRunReconcile`, Blink around
`_callsGroupAfterReload`, sylk-desktop around its startup heal. Scope it to the work,
never to a clock — a timed window drops a user's edit that lands inside it and lets a
repair through on whichever account's window has expired.

**Nor is a copy.** Blink keeps one addressbook for all its accounts: applying one account's
fetched document writes the same contacts into every other account's document, through the
same mutators a user edit uses. The `AddressbookManager.applying_remote_data` counter covered
that stretch, but the notifications it causes are delivered later, on Blink's GUI thread,
after the counter is back to zero. On 2026-09-17 Blink therefore announced 16 copied contacts
to every device. python3-sipsimple now decides at the moment of posting: every
`XCAPManagerDid*` notification carries `data.remote`, true while the posting thread is
applying a server document (`xcap.applying_remote_document()`), and Blink ignores those.

### 25.5 Display names: adopt only into a hole

The same rules, plus one about precedence.

A name is **data** only if someone typed it. A name that echoes the address —
empty, equal to the URI, the URI without its `@`, the username, or any `+`/`00`
variant of those (R3) — is the *absence* of a name wearing the address as a
placeholder. Only the absence may be filled.

    user-typed name  >  address-book name  >  server name  >  echo

- Adoption is **terminal**: the moment a real name lands, the echo test stops
  matching, so the next launch leaves it alone. That is what makes it "once"
  without needing a flag.
- Adoption is **into a hole on both sides**. If the server already carries a
  real name, that name wins and the OS phonebook does not override it — two
  clients each preferring their own real name is exactly the oscillation this
  chapter exists to prevent. Push-up (chapter 8) still applies: a real local
  name replaces a server *echo*, never a server name.
- A phone contact with no card in the OS address book keeps the number as its
  display name. That is not a failure to heal; there is simply nothing to adopt.

**Between two echoes there is no authority — compute the answer.** When the
server's name and the local name are *both* echoes, neither side is a
tie-breaker, and treating one as such produces a loop:

- Adopting the server's echo over the local one is only meaningful where a
  canonical form exists. It exists for a **phone number** (bare E.164) and does
  not exist for a **SIP address**. `Gogo` and `gogo@sylk.link` are both echoes of
  `gogo@sylk.link`; one is what a person should read and the other is the raw
  address, and there is no rule making the server's copy the better one. On
  2026-09-09 a rule that missed this distinction rewrote 20 contacts to their own
  addresses in a single pass. `_localNameStale` is now gated on
  `utils.isPhoneNumber(c.uri)` for exactly that reason.
- Even for a number, the server is a peer and not an oracle. The same rule then
  adopted `0034913336701` over `+34913336701`, because the other client had just
  pushed the wire form up. So the pass does not copy a name at all in this case —
  it sets `_abCanonicalPstn(c.uri)`, a pure function of the number and the dial
  plan that every client computes identically. Both ends converge on one string
  and the next pass is a no-op, whichever client ran first.

> When two clients disagree about a value that is *derivable*, neither adopts the
> other's — both derive it. Adoption is for values only a person can supply.

A user-typed name is not derivable, so the server remains authoritative for it
(`sNameReal` is unchanged and still wins). An echo is derivable, so it is
computed from the address on both sides. Blink's half of this is
`echoed_name_replacement()`, which recognises the same `+`/`00` variants; see
PSTN-CALLS-GROUP.md §36.2 and §40.

### 25.6 The lifetime of the addressbook at start

The stages, and the log line that marks each. Anything that writes to the
document before the last of them is writing against a view it has not finished
loading.

| Stage | Mobile | Blink |
| ----- | ------ | ----- |
| Snapshot requested | the lib fetches on `registered` | `XCAPManagerDidChangeState` → `fetching` |
| Snapshot arrived | `[ab] [lifecycle] snapshot FETCHED … N contacts, M groups` | `XCAPManagerDidReloadData` |
| Being applied | `[ab] [lifecycle] applying the server addressbook (edge=…)` | `Addressbook of X: a new document arrived, applying it` |
| Applied | `[ab] [lifecycle] applied in Nms, K write(s) issued` | manager returns to `insync` |
| Writable | `[ab] [lifecycle] writes ENABLED` (or `BLOCKED — <reasons>`) | `Addressbook of X is in sync and open for writes` |
| Stable | `[ab] [lifecycle] addressbook STABLE … open for writes` | — |
| Healing | `[ab] [lifecycle] heal starting/finished` | `Addressbook: healing pass starting/finished` |

Mobile's write gate is logged on the **edge**, not per call — it is consulted on
every write, so the value would drown the log while the transition is the thing
anyone wants: when the account became writable, and if it never did, which of
`registered` / `connection ready` / `server snapshot` is missing.

After the healing pass finishes, a contact change is a user edit by definition,
and IS announced.

### 25.7 Reading the OS phonebook, and never asking for it

Adoption needs the phonebook, and reading the phonebook is what makes Android and
iOS show a permission dialog. Those two facts pulled in opposite directions long
enough to leave the feature dead.

**How it was broken.** `getABContacts()` ran only on user intent — opening the
Phonebook tab, the unified search, or the conference invite picker — because the
prompt belongs on a tap. Adoption was then bolted onto the photo pass that runs
off the `addresBookLoaded` edge. A launch where none of those three screens was
opened never read the phonebook at all, so nothing was ever adopted, and a number
sitting in the OS address book under a real name kept displaying as the number.
On top of that the photo pass began with `if (avatarPhotos is empty) return`, so
even when the phonebook *had* been read, a set of cards carrying names but no
thumbnails aborted the pass and took the name adoption with it.

**The split that resolves it.** *Prompting* is user intent; *reading* is not.

- `_abAdoptPhonebookNames()` runs at the end of the heal and calls
  `Contacts.checkPermission()`, which asks the OS what it already decided and
  never shows a dialog.
- `authorized` → read silently. The user granted access for this.
- anything else → one log line and return. No prompt, no banner, no retry. The
  next Phonebook tap prompts, as it always did, and picks the work up.
- `abPermissionDenied` short-circuits ahead of even the permission check. A
  refusal already given is final for the launch, and a background repair must
  never be the thing that goes near the phonebook after the user said no.

`addresBookLoaded` is **not** the flag for "we have a phonebook": it is also
raised on a denial to stop the retry loop. `_abPhonebookRead`, set only by a
successful `getABContacts()`, is the one that means what it says. Conflating them
is what made a denied account take the "already read this launch" branch.

The photo pass's guard now passes if *any* of `avatarPhotos`, `avatarNames` or
`avatarEmails` is populated, since it carries three things off the phonebook and
must not be gated on one of them.

### 25.8 Diagnostics: what the startup log will show you

Two dumps, once per account per launch, both after the repairs rather than
before — the point is the settled state, not a snapshot of something mid-repair.

- `[ab] [kind]` — every server group with its members named, six per line, capped
  at 60 with `… and N more`. A member the addressbook cannot resolve prints as
  `<id>` in angle brackets, which is how an orphaned group reference shows up.
- `[ab] [dump]` — every row of the local `contacts` table: address, name, id,
  `remote=<local-only>` for a row that has never replicated, the extra URI list,
  tags, org, email, whether a public key is held. A name that is only an echo is
  flagged `(echo)`, so the rows still waiting for a real name are visible at a
  glance instead of looking like they have one.

The `uris` column is a **comma-separated string** (`contact.uris.toString()` on
write, `String(row.uris).split(',')` on read), not JSON. The first version of the
dump parsed it as JSON and printed `<unparseable>` for every populated row, which
said more about the dump than about the data. It now also marks a repeat inside
the list as `DUPLICATE(...)` — the §16.1 case the heal removes.

Filter on `[ab]` for everything addressbook, `[ab] [lifecycle]` for the
fetch → apply → writes-enabled timeline, `[ab] [name]` for adoptions and repairs.

---

## 26. Origin stamps: who changed an entry, and when

Every contact and group a client writes carries five attributes naming the device that made
the change. Sylk mobile, sylk-desktop and Blink desktop implement the same rules and produce
byte-identical fingerprints:

- **Sylk mobile:** `app/addressbookOrigin.js`. `test_addressbook_origin.cjs` checks it against
  vectors computed by Blink's code.
- **sylk-desktop:** `src/app/addressbookOrigin.js`, the same file copied verbatim. Change it
  here and copy it there.
- **Blink desktop:** `AddressbookOrigin.py`.

### 26.1 The attributes

| attribute         | value                                                                     |
|-------------------|---------------------------------------------------------------------------|
| `modified_by`     | id of the writing device (mobile: `this.deviceId`; Blink: bare instance id; sylk-desktop: a UUID persisted under `addressbookOriginDeviceId`) |
| `modified_agent`  | the device's user agent, e.g. `Blink Mobile 4.1.0 (Pixel 8 on android)`  |
| `modified_at`     | UTC, ISO 8601 to the second: `2026-09-16T11:44:07Z`                       |
| `modified_reason` | why an automatic write happened; empty for a user edit                    |
| `modified_hash`   | fingerprint of the content at the moment of stamping                      |

All values are strings (Chapter 15). Treat the set of reasons as open. This client writes
`repair`, `file-into-kind-group`, `create-group`, `reserved-id`, `group-kind`,
`fold-duplicates`, `group-members`, `name-sync`, `migrate`, `migrate-groups`,
`migration-marker` and `keys`. sylk-desktop writes `conversation-history`, `message-sender`,
`name-cache`, `repair`, `file-into-kind-group` and `offline-queue`. Blink writes `repair`,
`file-into-kind-group`, `ensure-group`, `group-kind`, `call-history`, `backfill` and `block`.

### 26.2 When a write is stamped

- **Content changed:** the write is stamped with this device. For a contact, the content is its
  name, URIs, presence handling or dialog handling. For a group, it is its name or members.
- **Content unchanged:** the write carries the server's current stamp unchanged, for example a
  re-put of the same data or a change to other attributes only. A stale local copy of the bag
  therefore cannot roll a stamp back.
- **Applying a fetched document:** nothing is stamped. The writer's stamp is kept.

### 26.3 Fingerprint

1. Build the object below, with keys in sorted order.
2. Serialise it compactly (`,` and `:` separators, non-ASCII left unescaped).
3. Take the SHA-1 of the UTF-8 bytes and keep the first 16 hex characters.

**Contact:**

```json
{"dialog":["<policy>",<subscribe>],
 "name":"<name>",
 "presence":["<policy>",<subscribe>],
 "uris":[["<uri, trimmed>","<type or empty>"], ...]}
```

Sort `uris` by uri, then by type. A missing handling counts as `["default",false]`. `subscribe`
is a boolean, and the strings `"true"` and `"1"` count as true.

**Group:**

```json
{"contacts":["<member id>", ...],"name":"<name>"}
```

Sort `contacts`. Members sent as full contact objects contribute only their `id`.

Attributes are never part of the fingerprint. The bag holds values that one client registers
and another does not, so a hash over the attributes would not survive a round trip.

### 26.4 Reading a stamp

The bag is carried through verbatim (Chapter 16.4), so a client that edits an entry without
stamping it leaves the previous stamp on content that stamp never vouched for. On arrival,
recompute the fingerprint:

- **Matches `modified_hash`:** the entry was changed by `modified_by` at `modified_at`.
- **Does not match:** the entry was changed by a client that does not stamp, some time after
  that stamp.
- **No stamp at all:** the entry has never been stamped.

A removal carries no stamp, so the device that deleted an entry is unknown.

### 26.5 Implementation here

- **Where writes are stamped.** `_abInstallOriginStamping(ab)` wraps `addContact`,
  `updateContact`, `addGroup` and `updateGroup` on the addressbook instance when the listeners
  are bound, so every write path is stamped. Before calling the library it reads the server's
  copy with `getContact` / `getGroup`, because the library overwrites its cache synchronously.
  `addGroupMember` / `deleteGroupMember` send no body and are not stamped; nothing uses them.
- **How the reason is passed.** `_abExecWhy(reason, label, fn, change)` is `_abExec` with the
  reason set only during the synchronous library call. `_abExec` runs `fn` inside the Promise
  executor, so the reason cannot leak into another write across an `await`. Without an explicit
  reason, a write made during the migration gets `migrate` (from `_abCtx`).
- **What gets logged.** `_abLogOrigins(account)` runs on `dataLoaded` and `dataUpdated`. It
  compares the addressbook with the snapshot in AsyncStorage (`ab_origin_snapshot.<account>`)
  and logs:

```
[ab] [origin] ag@sylk.link: 2 change(s) since the last document
[ab] [origin]   update contact id207347636fab4309 "Adrian G" (was "+31646630425") -- by Blink 9.8.0 (MacOSX) device 1abd76fb-... at 2026-09-16T11:44:06Z (repair)
[ab] [origin]   add contact id3 "338318" -- by a client that does not stamp (never stamped)
```

  The first document ever seen for an account only records a baseline.

---

## 27. sylk-desktop

sylk-desktop (Electron, sylkrtc.js) had no addressbook rules of its own: it indexed contacts by
the address as stored, created contacts named by their URI, re-added a contact for every
conversation on every start, and knew nothing of groups, kinds or the other clients. It now
follows this document. Everything below lives in `src/app/`; the provider is
`AddressbookProvider.tsx`.

### 27.1 Shared files

| file | shared with | what |
|------|-------------|------|
| `addressbookRules.js` | sylk-mobile `app/addressbookRules.js`, verbatim | URI canon, echo names, groups, kinds (Chapter 25.1) |
| `addressbookOrigin.js` | sylk-mobile `app/addressbookOrigin.js`, verbatim | origin stamps (Chapter 26) |
| `addressbookNotify.js` | sylk-mobile `app/addressbookNotify.js`, verbatim | `application/sylk-addressbook-update` wire format and throttles |

Change them in sylk-mobile and copy them over. Each has a standalone test in both trees
(`test_addressbook_rules.cjs`, `test_addressbook_origin.cjs`, `test_addressbook_notify.cjs`).
`addressbookAccountRules.js` binds the rules to the live config: `config.domain`,
`config.defaultConferenceDomain`, and `config.pstn.rules` from the server's sylk configuration
(default `{replacePlus: '00'}`), plus the per-account **Replace 0 with** preference
(`pstnPreferences.js`, ⋮ menu → Phone numbers), so a national number has the same canonical
form as on a mobile with the same setting.

### 27.2 One write boundary

`installOriginStamping` wraps `addContact`, `updateContact`, `addGroup`, `updateGroup`,
`deleteContact` and `deleteGroup` on the addressbook instance. Every write, whichever path
makes it, is:

1. **built** by `contactPayload.forServer` (contacts only): canonical addresses de-duplicated
   by value, server URI ids reused, `tel`/`sip` types (other types such as `XMPP` kept), one
   default in `defaultUri`, dialog/presence and the attributes bag carried from the server
   copy, client-local fields dropped, names per Chapter 24.2;
2. **stamped** (Chapter 26), with the reason set by `withAddressbookReason`;
3. **reported** to the notifier (27.6) once the server answers.

An automatic write never replaces a real server name with an echo; a user's edit may.

### 27.3 Matching by canonical address

The provider's contact index (`contactIndex.js`) keys every contact by `normServerUri` of each
address it owns, so a lookup in any spelling finds it: `+31618853125@sylk.link` finds
`+31618853125`, `…@videoconference.X` finds the room at `conference.X`. Several owners of one
address are ordered lowest id first (16.1); `best(uri)` prefers the one whose default address
it is.

### 27.4 Contacts created from conversations

Two paths add a contact without the user asking: `updateAddressbook()` on start, for
conversations without a contact, and an incoming message from an unknown sender.
`conversationContacts.js` skips `@local`, IP literals, conference anomalies, guests,
anonymous, the own account, an address a contact already owns in any spelling, an address
claimed in the last 30 s, and an address whose contact was deleted (27.5). A display name is
adopted only into a hole (25.5).

### 27.5 Deleted contacts stay deleted

`addressTombstones.js` infers deletes by comparing each authoritative document with the
addresses seen in the last one (the seen-baseline of Chapter 7, persisted per account). An
address that disappeared is not re-added from its conversation until it comes back into the
addressbook or the user adds the contact themselves. The first document is a baseline; an empty
document after a non-empty one is a failed fetch (Chapter 11) and ignored.

### 27.6 Change notifications

`addressbookNotifier.js` sends `application/sylk-addressbook-update` after writes the server
confirmed (cleartext, `skipJournal`, `skipDisposition`) and refetches with `Addressbook.refresh()`
when another device announces one. Ticks are never stored or shown: they are dropped in
`incomingMessage` (Blink's SIP tick, honoured only from the own account), `outgoingMessage`
(another device's carbon), `sendingMessage` and the journal replay. sylkrtc.js gained
`Account.fetchAddressbook(cb)`, `Addressbook.refresh(cb)` and the `skipJournal` /
`skipDisposition` options on `sendMessage`, as react-native-sylkrtc has.

### 27.7 Remote conversation removes

`conversationRemoves.js` applies Chapter 16.3: another device's remove deletes the
conversation only when its contact is gone; a live remove that arrives first is parked until the
addressbook shows the address gone (ten minutes at most, in memory); a journal remove for a live
contact, or one older than the newest message, is dropped.

### 27.8 Kinded groups and the startup heal

A contact this client creates is filed into Tel or Conference once the server has it
(`kindGroups.js`: kind → reserved id → name; a missing group is created under its reserved id
with its kind). Once per account per run, 15 s after the first fetched document and with
announcements suppressed, `addressbookHeal.js` repairs contacts (canonical addresses,
duplicate addresses, names per 24.2) and then files every qualifying contact that is not a
member, one write per group.

### 27.9 The offline queue

An operation made before the addressbook is ready is queued and replayed on the next load.
Each entry records the server copy's fingerprint at queue time, and `offlineQueue.decide`
replays it only when that copy is unchanged and the write is not already applied: an update
of a contact another device edited since, a delete of a contact edited since, or an add of an
address someone else created is dropped and logged (`[ab] [queue] … not replayed`). Entries
from older builds carry no fingerprint and are replayed only when no other device has stamped
the contact.
