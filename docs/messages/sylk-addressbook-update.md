# `application/sylk-addressbook-update` (proposal)

A self-message that says **"the server addressbook changed — refetch it"**.
It carries no contact data: the XCAP document is the source of truth, and the
message is only a cache-invalidation tick.

- **Direction**: self only — sent to the account's own URI so it forks to every
  other device/session of the account.
- **Encrypted**: no. The payload carries no URIs, names or attributes, so there
  is nothing to protect, and a plaintext control type can be processed before a
  private key exists (a fresh device gets the addressbook before it gets keys).
- **Journalled**: **never**. Sent with `skipJournal` (WSS) /
  `X-Sylk-Skip-Journal` (SIP).
- **Persistence**: none. No SQL row, no bubble, no unread count, no
  notification, no IMDN.
- **Status**: implemented in both clients.
  - sylk-mobile: `app/addressbookNotify.js` (wire format + throttles), wired in
    `app/app.js`; the sylkrtc addition is carried as
    `patches/react-native-sylkrtc+2.1.0.patch`; probe:
    `node test_addressbook_notify.cjs`.
  - Blink: `AddressbookNotify.py`, wired in `SMSWindowManager.py`; probe:
    `python3 scripts/addressbook_notify_selftest.py`.

---

## 1. Why a message and not xcap-diff

RFC 5875 `xcap-diff` is the standard answer and sipsimple already implements the
subscription. It is not the one taken here because:

- the mobile client speaks the sylkrtc WSS API, not SIP SUBSCRIBE — it would
  need a second, transport-specific notification path;
- the self-message fan-out (own AOR → all registrations + all WSS sessions) is
  already in place and already used by `sylk-conversation-read`,
  `sylk-data-export` and `text/pgp-private-key`;
- both non-journalled transports already exist (see §4), so the server needs no
  new mechanism, only a new type in its filters.

xcap-diff stays a valid future addition; it is not a prerequisite.

## 2. Body shape

Cleartext JSON, compact on the wire:

```json
{
  "v": 1,
  "origin": "6f3f2b0a-9c11-4d2e-8f4a-2b6d0e7c1a55",
  "timestamp": 1757320800,
  "contactIds": ["id2417", "id903"],
  "groupIds": ["_favorites"]
}
```

| Field       | Type       | Required | Notes |
| ----------- | ---------- | -------- | ----- |
| `v`         | number     | yes      | Payload version. `1`. |
| `origin`    | string     | yes      | Stable per-device id of the sender. Blink: `SIPSimpleSettings().instance_id`. Mobile: `getUniqueIdSync()`. Receivers drop their own echo on this. |
| `timestamp` | number     | yes      | Unix seconds when the tick was built. Freshness guard (§6). |
| `contactIds` | string[]  | see below | Server contact ids touched in this burst. |
| `groupIds`   | string[]  | see below | Server group ids touched in this burst. |
| `truncated`  | bool      | no        | `true` when the lists are not a complete description of the burst: the cap was exceeded, an op could not name its id, or a still-running burst was forced out by `NOTIFY_MAX_DEFER` (§5). |

**Present-vs-absent is load-bearing:**

- an **empty array** means *nothing in that collection changed*;
- an **absent** field means *unknown — assume everything in it changed*.

A sender that knows what it touched always emits both `contactIds` and
`groupIds`, even when one of them is `[]`. A sender that cannot enumerate (a
bulk import, a burst past the cap) omits both and sets `truncated: true`.

There is no `policyIds`, and there never will be — see the scope rule below.

Ids are **server-side ids only** — never URIs, display names or attributes.
Add, update and delete are deliberately indistinguishable: the id says
*something about this row moved*, and the refetched document says what. Cap
each list at 64; past that, drop both lists and set `truncated`.

There is no `reason` field. A burst routinely mixes adds, updates and deletes,
so a single verb would be a lie in the common case, and nothing branches on it.

### Scope: contacts and groups only

**`pres-rules` and `dialog-rules` must never trigger this message.** The type
covers the addressbook — the `resource-lists` document — and nothing else.

A write to a policy document produces no tick and contributes no ids. On the
receive side the refetch names `resource-lists` alone, so even a tick that
somehow arrived after a policy-only edit would not pull the rules documents.
The presence and dialog policies keep whatever synchronisation they have today
(the fetch on start, and the manager's own refresh): they are low-churn, they
are not what a user edits in a contact sheet, and dragging them into an
addressbook signal would mean every subscription-policy change wakes every
device on the account.

**The ids scope the apply, never the fetch.** Neither transport can fetch part
of an addressbook — XCAP `resource-lists` is fetched whole, and
`account-fetch-addressbook` returns a full snapshot — so a receiver that
understands `v: 1` always refetches everything, whatever the lists say. What the
ids buy is the step *after*: re-render and reconcile only the rows named,
instead of walking the whole book, and a log line that answers "why did this
device refetch" with the ids that moved. A receiver that ignores both fields
entirely is still correct, only slower.

Deliberately **not** in the payload: contact bodies, URIs, an XCAP etag, or a
document version. Anything richer invites a client to apply a delta instead of
refetching, which is exactly the divergence this type exists to avoid.

## 3. Wire

Mobile (sylkrtc WSS):

```js
this.state.account.sendMessage(
    this.state.account.id,
    JSON.stringify(payload),
    'application/sylk-addressbook-update',
    { skipJournal: true, skipDisposition: true }
);
```

Blink (SIP MESSAGE to own AOR), in `SMSViewController._sendMessage`:

```python
additional_sip_headers.append(Header('X-Sylk-Skip-Journal', 'yes'))
```

and no `Disposition-Notification` CPIM header (the type is not renderable, so
`is_renderable()` already suppresses the IMDN request once the type is listed
with the other control types).

## 4. Not journalled — what already exists

Neither side needs a new server mechanism:

- **WSS**: `Account.sendMessage(..., options)` already forwards
  `options.skipJournal` as `skipJournal: true` on the `account-message`
  request (`react-native-sylkrtc/lib/account.js`). Already used in production
  by the `meeting_update` location tick.
- **SIP**: Blink already sends `X-Sylk-Skip-Journal: yes` on OTR messages;
  `sip_handlers.py` checks for the header's **presence** before storing, for
  both the originator and the recipient leg.

Consequence: a device that is offline when the addressbook changes never learns
about it. That is correct and needs no compensation — both clients refetch the
addressbook on register (Blink on `XCAPManagerDidStart`, mobile on
`registration-state: registered` → `account-fetch-addressbook`), so a device
that missed the tick gets the new document the moment it comes back.

## 5. Sender rules

**Fire only for locally originated writes, and only after the server has the
change.** Never for data adopted *from* the server — that is the ping-pong
this design has to avoid.

**One tick per burst, never one per contact.** Renaming a contact, re-tagging
it and dropping it from a group is one edit to the user and must be one message
on the wire; so is a 40-contact import or a key-escrow write that touches every
contact carrying our URI. Every write goes into a pending set, and the tick is
emitted only once the whole burst has *settled* — the debounce has expired
**and** nothing of ours is still in flight (Blink: `insync` with an empty
journal; mobile: no `_abExec` outstanding and an empty pending-put queue).
Writing while a tick is due re-arms the debounce, so the message goes out after
the last write, not the first.

Deferring can't be unbounded: `NOTIFY_MAX_DEFER` (30 s) from the first pending
id forces the tick out even if writes are still arriving, so a slow drip does
not leave the other devices stale for minutes. That forced tick carries
`truncated: true`, since the burst it describes has not finished.

Blink:

- The public `XCAPManager` mutators (`add_contact`, `update_contact`,
  `remove_contact`, `add_group`, `update_group`, `remove_group`,
  `add_group_member`, `remove_group_member`) each post an
  `XCAPManagerDid*` notification at *schedule* time, carrying the contact or
  group object. Observe them and add `.id` to a per-account pending set
  (contacts and groups kept apart; a group-member op names the group).
  `XCAPManagerDidAddPolicy` / `DidUpdatePolicy` / `DidRemovePolicy` and the
  `set_default_presence_policy` / `set_default_dialog_policy` writers are
  **not** observed.
- Send when `XCAPManagerDidChangeState` reports `updating → insync` **and** the
  pending set is non-empty; drain it into `contactIds` / `groupIds` and clear.
  That transition is the point at which the journal has been flushed to the
  server, so a receiver that fetches immediately cannot read a stale document.
- `NOTIFY_DEBOUNCE` (2 s) on top of that, re-armed by every further write, so a
  multi-contact edit or a key-escrow write across several contacts sends one
  tick. `insync` alone is not enough — the manager passes through `insync`
  between the batches of a long edit.

Mobile:

- Collect ids in the `_abExec` success path for `[put]` / `[delete]` operations
  issued by `_abReplicateToServer`, `_abPutLocalContactToServer`,
  `_abFlushPendingPut` and the group writers — the server id, i.e. the
  contact's `remote_id` (or the id just minted by `_abGenerateServerId`), and
  the group id for group ops. A local contact whose put failed has no server id
  and contributes nothing; if any op in the burst cannot name its id, drop both
  lists and set `truncated: true` rather than sending a partial one. The policy
  writers (`Addressbook.addPolicy` / `updatePolicy` / `deletePolicy`) are
  excluded — a policy-only edit sends nothing.
- **Suppress** for the whole duration of `_abMigrateOnce`, `syncGroupsTable`
  adoption, `applySelfContactFromServer` and any other adopt-down path — a
  reconcile that echoes server state back up must not tell the other devices to
  refetch what they just sent. A single `_abSuppressNotify` counter around
  those blocks, checked at flush time.
- Trailing `NOTIFY_DEBOUNCE` (3 s) after the last successful write, then send
  the accumulated sets.

Both: a write made while *applying* what the server just handed us is silent —
mobile suppresses for the whole of `_abRunReconcile`, Blink around each piece of
reload-driven work: the `XCAPManagerDidReloadData` handler body, and
`_callsGroupAfterReload` (which `ContactListModel` defers by `XCAP_SETTLE_DELAY`
and which runs `repair_contact_addresses`, the kind-group filing and the call
backfill).

**Applying a document is not an edit, even though it writes.** In Blink the
addressbook is shared by every account: applying one account's fetched document
copies each contact into every *other* account's XCAP manager (sipsimple
`addressbook.py`, the propagation loop in `_internal_save`), through the same
public mutators a user edit uses, posting the same `XCAPManagerDid*`
notifications. Nothing in the notification says which it was. Seen on
2026-09-09: two accounts, and every reload announced the whole document —
11 contacts — to every device, twice per launch, before the repair pass had even
started. sipsimple now counts the stretch in which it is copying a fetched
document (`AddressbookManager.applying_remote_data`), and the sender checks it.

**Scope it to the work, never to a clock.** The first attempt suppressed for a
fixed window after the reload, on the theory that it would cover a repair
running 15s later. A timed window is wrong in both directions: it swallows a
user's edit that happens to land inside it, and it lets a repair through on
whichever account's window has already expired. On 2026-09-08 one repair pass
rewrote four contacts and announced exactly one of them, on one of two accounts,
purely on timer alignment. The suppression is a counter held across the call
that does the writing, and it applies to every account at once — reloads for two
accounts overlap, and the repair is global anyway. That covers the group/name convergence, the
self-contact apply, the migration, and the escrow repair. It is deliberately
wider than "adopt-down": a reconcile write is this device catching up with a
document every other device is reading too, and they reach the same place from
it without being told. What is left announcing itself is exactly what a person
did — an edit, a delete, a group change, an escrow written by the key UI.

### 5.1 Throttle and fuse

The debounce collapses a burst. The throttle below is the second line of
defence, against a *bug* — an adopt-down path that was missed, two devices
answering each other, a write loop in a reconcile. It is not tuning; it is the
thing that keeps a defect from turning into a message storm across every device
on the account.

- **Floor.** `NOTIFY_MIN_INTERVAL` (10 s) between two ticks per account. A tick
  due inside the floor is not dropped — its ids merge into the next one, which
  goes out when the floor expires.
- **Fuse.** `NOTIFY_FUSE_MAX` (6) ticks per `NOTIFY_FUSE_WINDOW` (5 min). Past
  that, **stop sending** and log a warning naming the ids that kept arriving.
  A healthy client never gets near this: six addressbook bursts in five minutes
  is not human editing, it is a loop. Sending resumes when the window drains.
  The fuse tripping is a bug report, not a condition to tune around.
- Fuse state is per account and lives in memory only — a restart clears it, and
  a restart is not a loop.

## 6. Receiver rules

1. **Self only, then drop own echo.** A tick is account-to-own-account by
   definition: Blink checks the SIP sender against the account before anything
   else (honouring one from a stranger would hand any sender a way to keep this
   client fetching), and on mobile the carbon path is our own account by
   construction. Then `origin === myDeviceId` → ignore. (Mobile's server does
   not echo a self-message back to the sender today; SIP forking to the own AOR
   can. The guard is cheap and makes the type transport-independent.)
2. **Freshness**: ignore when `now - timestamp > 120 s`, evaluated **on
   arrival**, before any timer is armed — never re-checked when the jitter
   expires, or a 30 s delay on a 110 s-old tick would discard a fetch that is
   still wanted. Defends against a
   server that ignores the skip-journal flag and replays the tick, and against
   a tick queued behind a slow delivery.
3. **Never fetch while we are mid-write.** If a fetch is already in flight, or
   *our own* addressbook writes are still settling (Blink: state is not
   `insync`, or the XCAP journal is non-empty; mobile: an `_abExec` is
   outstanding, the pending-put queue is non-empty, or a migration is running),
   do not fetch. Set the pending flag and re-arm for when the client is settled.
   A snapshot landing on top of our own unflushed journal is how a reconcile
   ends up re-pushing rows we were in the middle of replacing.
4. **Jitter every fetch.** Arm it at a uniform random delay in
   `[FETCH_JITTER_MIN, FETCH_JITTER_MAX]` = **[2 s, 9 s]**, never immediately.
   Every device on the account receives the same tick in the same instant; with
   no jitter they all issue the GET in the same second, and one edit on the
   desktop becomes a synchronised burst against the XCAP server from every
   phone, tablet and desktop the account owns. Most of those are 304s, which
   makes the spike cheap but not free — and on a large account it is neither.
5. **Coalesce**: every tick that arrives while a fetch is pending or in flight
   merges into that one fetch (ids union) instead of arming another. At most
   one fetch per `FETCH_MIN_INTERVAL` (15 s) per account; a tick inside the
   cooldown schedules exactly one fetch at the end of it, jittered again. The
   floor stays above `FETCH_JITTER_MAX`, so it can never cut a jitter window
   short and pull the fetches back together.
6. **Back off on repetition.** More than `FETCH_FUSE_MAX` (10) fetches in
   `FETCH_FUSE_WINDOW` (5 min) means something upstream is looping. Back off
   exponentially — 30 s, 60 s, 120 s, capped at 300 s — log it, and keep
   serving the newest tick when the backoff expires. The receiver protects the
   server even when a sender's fuse (§5.1) has failed to.
7. **Fetch, don't apply**. The message never mutates local state directly.
8. **Never gate the fetch on the ids.** `contactIds` / `groupIds` may narrow
   what is re-reconciled and re-rendered after the snapshot lands, and belong in
   the log line; they may not decide *whether* to fetch. `truncated: true`, or
   an absent list, simply means the full reconcile runs.

Blink:

```python
from sipsimple.threading.green import Command
account.xcap_manager.command_channel.send(
    Command('fetch', documents={'resource-lists'}))
```

`resource-lists` is the whole set, deliberately: the rules documents are out of
scope (§2), and refetching them here would be work nobody asked for. A fetch
ends in `_CH_update` → `_load_data()` → `XCAPManagerDidReloadData`, which
`SMSWindowManager` and `HistoryManager` already observe, so no new apply path is
needed anywhere in Blink.

**The fetch is unconditional.** `Document.fetch()` always sends `If-None-Match`
with the cached etag, and a 304 takes `_CH_fetch`'s early return: straight back
to `insync`, no `_load_data`, no `XCAPManagerDidReloadData`. That is right for
the periodic poll the code was written for and wrong here — a tick is another
device *asserting* that the document changed, which is better information than
an etag the server may not have bumped for the write that caused it. So Blink
clears `manager.resource_lists.etag` immediately before sending the command.

**A fetch that reaches `insync` without passing through `Updating` has not
necessarily seen a 304.** Blink's `_fetch_one_document` turns an `XCAPError`
into a `log.warning` (a network blip mid-fetch is ordinary and the retry happens
anyway), and a document that fails to PARSE raises the same `XCAPError`. In both
cases `fetch_time` is left untouched, so `_CH_fetch` takes the identical early
return and the state trace is identical. Read the XCAPTrace line, not the state
line: a parse failure is logged with code 500 and the lxml message, a 304 says
"did not change". Seen for real on 2026-09-08 — a display name edited on a phone
arrived on the other phone and never on the Mac, because the `resource-lists`
document the gateway had just written was not well-formed XML and sipsimple was
correctly refusing it, keeping the last good copy and its stale names.

Dropping the etag is safe at that point and no other: the fetch only runs
settled (§6 rule 3 — `insync`, empty journal), so no `update()` is waiting to
PUT with `If-Match`, and `_CH_fetch` stores the fresh etag before the normalize
pass can write anything.

**A tick-driven fetch retries itself once.** Nothing below it will: `_CH_fetch`
has a 60-second retry, but it hangs off an `XCAPError` propagating out of
`_fetch_documents`, and `_fetch_one_document` deliberately swallows that — a
network blip mid-fetch is ordinary and the periodic poll comes round again. For
a fetch the tick asked for there is no poll coming round: the tick was the only
prompt and it has been consumed, so one bad response would freeze the account's
addressbook until something unrelated happened to trigger another fetch. That is
exactly what the 2026-09-08 incident was — the document was well formed again
minutes later, and the Mac still showed the old name until it was restarted.

So a fetch that brings back no document is asked once more after 20s, and only
then logged as a warning. Once, not a loop: if the second attempt also fails, a
third will not help, and the scheduler's floor and fuse apply to both.

(The wider gap is upstream: `_fetch_one_document` swallowing the error disables
that 60-second retry for *every* fetch — startup, xcap-diff, the periodic poll —
not just ours. Worth fixing in sipsimple rather than working around per caller.)

Mobile: one small addition to `react-native-sylkrtc`, carried as
`patches/react-native-sylkrtc+2.1.0.patch` — the request already existed as the
private `Account._fetchAddressbook()`, guarded by `!this._addressbookFetched` so
it only ever ran once per registration:

```js
// account.js
fetchAddressbook(cb = null) { this._fetchAddressbook(cb); }   // unguarded
// addressbook.js
refresh(cb = null) { for (const [, a] of this._connection._accounts) a.fetchAddressbook(cb); }
```

A build whose `node_modules` predates the patch degrades quietly: the receiver
logs that there is no `refresh()` and does nothing, and the addressbook still
arrives on the next registration.

The response path is unchanged: `addressbook-fetched` → `Addressbook._load()`
→ `dataLoaded` → `_abOnDataLoaded` → `_abMaybeRun('dataLoaded')`, i.e. the
existing authoritative-snapshot reconcile. `_populate()` already replaces the
caches wholesale, so a contact deleted on another device disappears.

### 6.1 Constants

One place per client, tunable, same names on both sides:

| Constant | Value | Side | What it stops |
| -------- | ----- | ---- | ------------- |
| `NOTIFY_DEBOUNCE`     | 2 s (Blink) / 3 s (mobile) | send | One tick per contact instead of one per burst. |
| `NOTIFY_MAX_DEFER`    | 30 s  | send | A long drip of writes deferring the tick indefinitely. |
| `NOTIFY_MIN_INTERVAL` | 10 s  | send | Back-to-back ticks; ids merge instead. |
| `NOTIFY_FUSE_MAX` / `NOTIFY_FUSE_WINDOW` | 6 / 5 min | send | A send loop becoming a storm. |
| `FETCH_JITTER_MIN` / `FETCH_JITTER_MAX`  | 2 s / 9 s | receive | Every device GETting in the same second. |
| `FETCH_MIN_INTERVAL`  | 15 s  | receive | A tick burst becoming a fetch burst. Never below `FETCH_JITTER_MAX`. |
| `FETCH_FUSE_MAX` / `FETCH_FUSE_WINDOW`   | 10 / 5 min | receive | A fetch loop hammering XCAP; triggers 30/60/120/300 s backoff. |
| `FRESHNESS_WINDOW`    | 120 s | receive | Acting on a stale or replayed tick. |
| `ID_LIST_CAP`         | 64    | send | An unbounded payload; overflow sets `truncated`. |

A 9 s spread means the last device to refetch is a few seconds behind the one
that made the edit — close enough to feel immediate, wide enough that a large
account's devices do not all GET in the same second. The window only has to be
longer than the server takes to answer one conditional GET; past that, widening
it buys nothing and only makes the edit feel late.

Worst case for one account with a device stuck in a loop: 6 messages and 10
conditional GETs per five minutes, most of them 304. That is the number these
constants exist to guarantee.

## 7. Non-persistence checklist

Blink (`SMSViewController` / `SMSWindowManager`):

- add the type to the control-type tuples alongside
  `application/sylk-conversation-read`: the `is_renderable` exclusion list
  (~line 117), the "stored but does not move the conversation" tuple (~3277 —
  it is **not** stored, so it must *not* be added there), the no-CPIM/no-IMDN
  set (~3717), and the send-path exclusions at ~3943 and ~5029;
- handle it in the live dispatch **before** the `_persistUnsupportedLiveMessage`
  fallback (~5715), which would otherwise store every tick as an unread
  unsupported message;
- add a `continue` in the journal-replay loop (~1690) — defensive only; with
  skip-journal working, one should never appear there.

Mobile (`app.js`):

- handle it in `outgoingMessage()` (the sibling carbon path — a self-message
  reaches other devices as an outgoing carbon, not as `incomingMessage`),
  exactly where `EXPORT_CONTENT_TYPE` is handled at ~43644, and `return`
  before `saveLastSyncId` / `saveOutgoingMessage`;
- skip in `_syncJournal` (~44175) and in `saveOutgoingMessageSql` (~44173),
  same shape as the data-export announcement;
- no entry in the transcript category classifier, no unread bump, no
  notification.

## 8. Server checklist (SylkServer / OpenSIPS)

1. `skipJournal` (WSS) and `X-Sylk-Skip-Journal` (SIP) must suppress storage on
   **both** legs for this type — originator and recipient.
2. A skip-journal self-message must still be **relayed** to the account's other
   WSS sessions and SIP registrations. Confirm the skip path drops only the
   journal write, not the fan-out.
3. Cross-transport: a SIP-originated tick (Blink) must reach WSS sessions
   (mobile) and vice versa. This is the only genuinely new requirement.
4. **Push**: this type must be added to the no-push content-type list. Without
   it, every contact edit on the desktop wakes every phone on the account.
5. No IMDN / disposition notification generated for it.

## 9. Rollout

The current Blink stores an unknown content type as an *unread unsupported
message*, so a tick sent to an older Blink shows up as junk in the transcript.
Therefore:

1. **Release N** — both clients: recognise the type and ignore it (receive side
   + non-persistence, §7). No sending.
2. **Release N+1** — enable sending (§5) and the refetch (§6).

Not journalled means there is no backlog to worry about between the two: a tick
only ever reaches devices that are live at the time.

## 10. Relationship to `application/sylk-contact-update`

`sylk-contact-update` replicates a whole contact object per edit, is journalled,
and its mobile receive handlers (`handleReplicateContact` /
`handleReplicateContactSync`) are stubs that return immediately. It duplicates
the XCAP document as a second, weaker source of truth.

**Decided: `sylk-contact-update` is deprecated.** The addressbook itself is the
payload; a tick that says "refetch" cannot go out of sync with it, and a
replicated contact object can.

Retirement order, on top of the §9 stages:

1. **Release N+1** (the release that starts sending the tick): Blink — the only
   client still emitting it — stops sending `sylk-contact-update`.
   `replicateContact()` and its `editContact` / `chat` call sites go. Both
   clients keep *accepting* it, so a device still on release N keeps working.
2. **Release N+2**: delete the receive branches — Blink's live handler
   (`SMSWindowManager` ~5584) and journal branch (~1690) with the
   `contacts_queue` consumer behind them, and mobile's `handleReplicateContact`
   / `handleReplicateContactSync` stubs and the `outgoingMessage` branch at
   ~44160. An arriving tick then falls through to "unknown type, ignore".
3. Journal entries from before the cut stay in the server journal and will
   replay on a fresh device. Both clients must keep *skipping* the type on
   journal replay indefinitely — that branch is not deleted, only the branch
   that acted on it.

Nothing is lost in the cut: mobile's receive handlers were stubs that returned
immediately, so contact replication only ever worked Blink → Blink, and XCAP
already carried the same data authoritatively.

## 11. Settled / open

Settled: the name is `application/sylk-addressbook-update`; the payload carries
`contactIds` and `groupIds`; scope is contacts and groups only — `pres-rules`
and `dialog-rules` neither trigger the tick nor are refetched by it;
`sylk-contact-update` is deprecated (§10).

Open:

- The **cap** of 64 ids per list is a guess. It only has to be above a normal
  human edit burst; a bulk import is meant to trip it and send `truncated`.
