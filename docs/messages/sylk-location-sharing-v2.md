# `application/sylk-location-sharing` — payload version 2

One-shot, live location sharing and the "until we meet" rendezvous, in a
**single message type** with a **cleartext lifecycle envelope** and an
**encrypted coordinate payload**. Only the coordinates are end-to-end
encrypted; everything needed to route, tag, group, filter and tear down a share
travels in cleartext, so no path ever needs the private key to store or
classify a row.

**What version 2 changes: where those two halves live.** In v1 they were one
JSON body, the ciphertext nested inside it under `value`. In v2 they are
separated at the transport level — the envelope rides in the message
**metadata**, and the **content is nothing but the armoured blob**:

```
v1   content  = {"action":"location_start","value":"-----BEGIN PGP…","sessionId":"…","version":"1.0"}
     metadata = (absent, or a mirror of the envelope minus "value")

v2   content  = -----BEGIN PGP MESSAGE-----…-----END PGP MESSAGE-----
     metadata = {"action":"location_start","sessionId":"…","version":"2.0"}
```

Nothing else about the protocol changes. The action vocabulary, the session
model, the meet handshake, receipts, retention and every system note are
exactly as they were in
[v1](./sylk-location-sharing-v1.md); this document restates them so it stands
alone, and marks the v2-specific parts.

**Why.** A reader that wants the lifecycle fields — the server deciding whether
a tick warrants a push, the journal grouping a trail, the admin UI labelling a
row, the receiving client classifying before it decrypts — had to parse a JSON
body and pick around a 1.2 KB base64 blob to get 180 bytes of envelope. In v2
those fields are a first-class side-band: a column in the journal, a header on
the wire, an object on the client. The body is one thing again — ciphertext.

**Unlike v1, this version has a compatibility layer.** v1 declared "the wire is
exactly what this document describes"; v2 cannot, because peers roll over one
build at a time. Every v2 reader accepts both versions. See
[Version negotiation](#version-negotiation).

### Concurrent sessions per contact

A contact can have **up to three location sessions live at once**, held in
separate registries on the `LocationSharingManager` engine:

- **one meet** ("Until we meet") — `outgoingMeetSessions`
- **one outgoing plain share** (timed / until-I-return) — `outgoingLocationSessions`
- **one incoming share** (peer → us) — `incomingLocationSessions`

Both outgoing stores are keyed by peer uri; a session is addressed by its
`originLocationId` (the origin tick's id) — or, for a meet, its
`meetingSessionId` — via `_entryByOrigin`, so a meet and a plain share to the
same contact never collide on one slot. The share **picker disables** the
option types already live (a live plain share leaves only "Until we meet" and
"Once"; a live meet disables "Until we meet"), and when both startable types
are live the pin opens the **active-sessions** list instead of the picker.

## Message type

- **Content-type**: `application/sylk-location-sharing`
- **Direction**: both
- **Encrypted**: the content is the PGP-armoured coordinates, and nothing else.
  The envelope in `metadata` is cleartext.
- **Covers**: one-shot, plain live shares (2h / 4h / 8h / 24h / "until I
  return"), the meet-me handshake (`location_request` / `meeting_request` /
  `meeting_accept`) **and** the meet-me coordinate streams, plus the teardown
  signals `location_stop`, `meeting_end` and the decline signal
  `meeting_reject`.

## Wire layout

A v2 message has two parts.

**`content`** — the PGP-armoured coordinates, verbatim, with no wrapper. A
[coordinate-free signal](#handshake-signals-coordinate-free) has no coordinates
to carry, so **its content is the empty string**.

> **An empty content is not a malformed message.** In v2 the payload lives in
> two slots, and a coordinate-free signal legitimately fills only one of them.
> A message is empty only when **content AND metadata are both empty**.
> Validating on `content` alone classifies every `location_stop`,
> `location_request` and meet handshake signal as broken — see
> [Journal replay](#journal-replay) for why that is destructive rather than
> merely wasteful.

This is the one wire shape v2
introduces that has no v1 counterpart.

**`metadata`** — the cleartext lifecycle envelope, a JSON object. It is
relayed to the peer as a CPIM body header and stored in the journal's
`metadata` column (see [Transport](#transport-of-the-metadata-envelope)).

Every message carries an explicit `action` naming its purpose, set by the
sender and stored verbatim as `related_action` on the peer (no re-derivation),
and an explicit `version`.

The envelope fields, and when each appears:

| field                                                       | on                              | meaning |
| ----------------------------------------------------------- | ------------------------------- | ------- |
| `version`                                                   | every message                   | the payload version — `"2.0"`. Decides where a reader looks for the envelope; see [Version negotiation](#version-negotiation) |
| `action`                                                    | every message                   | the tick's purpose. **Coordinate-free** (empty content): `location_request` / `meeting_accept` / `meeting_reject` / `location_stop` / `meeting_end`. **Coordinate-bearing**: `location_once` / `location_start` / `location_update` / `meeting_request` (value-bearing invite — start-on-request) / `meeting_start` / `meeting_update`. All are journaled (delivered offline on replay) **except `meeting_update`** — live-only over the websocket, never journaled |
| `sessionId`                                                 | live + meet (not one-shot)      | groups every tick of one session; for a meet it is the `meeting_request` `msg_id`, shared by both legs. **MANDATORY on `location_stop`** — it is the only field that ties the stop to its track |
| `messageId`                                                 | handshake signals               | the signal's own id, so a replayed signal can be matched to its session. **Not sent on `location_stop`** — there it only ever duplicated `sessionId`; the stop's own id is already on the SIP envelope. Readers keep accepting it as a legacy fallback |
| `role`                                                      | meet (coordinate + handshake)   | `inviter` / `invited` — tells the two meet coordinate tracks apart |
| `expires`                                                   | live + meet origins             | the share window |
| `perm`                                                      | origins                         | the sender's OS location-permission state (`always` / `whenInUse` / …), so a stalled trail can be traced to a foreground-only grant on the other side |
| `deviceId`                                                  | every message                   | which of the sender's devices emitted this tick |
| `reason`                                                    | `location_stop` / `meeting_end` | why it ended (see the reason tables) |
| `requestId`                                                 | a one-shot answering a request  | the `location_request` id it answers |
| `privacyDeferred` / `privacyDeferredRadiusMeters` / `dummy` | privacy-radius meet             | the coordinates are a destination / throwaway, not the real origin |

**`value` never appears in metadata.** It is the one field that does not move:
metadata is cleartext and is relayed as a single-line header, so putting
ciphertext there would leak nothing but would double every tick's wire size for
no reader's benefit. Implementations delete the key defensively on both sides —
a metadata `value` is ignored on receive and can neither forge nor erase the
real coordinates.

The concrete payload for **every action** is shown per type below — the
coordinate-free ones in
[Handshake signals](#handshake-signals-coordinate-free), the coordinate ones in
[Share types & example payloads](#share-types--example-payloads).

`sessionId` groups a session. For a plain-live share it is the origin tick's
own id; for a **meet** it is **the `msg_id` of the `meeting_request` message**
that opened the session (not a fresh UUID) — carried by **both** legs so the
whole rendezvous is one session, the two coordinate tracks told apart by `role`,
not by separate ids. The receiver reads `sessionId` straight into the indexed
`related_msg_id` column.

> **`sessionId` is a grouping key, not a row id.** Every tick keeps its own
> unique `msg_id` (the SIP envelope id / SQL primary key); `sessionId` is
> independent, so both meet legs can share one `sessionId` without their origin
> rows colliding on `msg_id`.

### Transport of the metadata envelope

`metadata` is the generic per-message side-band the messaging stack already
carries; location sharing is its first user. End to end:

| hop | carrier |
| --- | ------- |
| client → server | the `metadata` field of the sylkrtc `account-message` / `session-message` request (`options.metadata` on `sendMessage`; an object is serialized for you) |
| server → peer server | a CPIM body header — name `Metadata`, namespace `urn:ag-projects:xml:ns:cpim` (prefix `agp`). A **body** header, not a SIP header |
| server → client | the `metadata` field of `account-message` / `session-message` events, `syncConversations` rows, and the history HTTP API |
| at rest on the server | the journal's `metadata` text column |

Two constraints follow from the CPIM header grammar, enforced by the server
(`sanitize_metadata`) and mirrored by the client serializer:

- **single line** — CR and LF are folded to spaces. A JSON envelope has none,
  so this is a no-op in practice.
- **≤ 4096 bytes** — anything larger is **dropped, not truncated** (a truncated
  JSON string is worse than none). A location envelope is ~200 bytes, so the
  cap is nowhere near.

The server never interprets the metadata blob generically — by convention it is
a JSON string, and only the location reader parses it.

## Version negotiation

The `version` field is the whole negotiation. There is no capability exchange
and no per-peer state: every reader decides per message.

> **Metadata is authoritative from version 2 on. Below that, the content is.**

Concretely, for any location message:

```
if metadata parses as a JSON object AND its version is ≥ 2:
    envelope    = the metadata
    coordinates = the content            (empty ⇒ a coordinate-free signal)
else:
    envelope    = the content parsed as JSON     (v1 — unchanged behaviour)
    coordinates = envelope.value
```

The **≥ 2** test, rather than "metadata present", is deliberate. A late-v1
client already populated `metadata` as a *mirror* of the body it was also
sending. That mirror is ignored: a v1 tick is always read from its body,
whether or not the mirror is there, so the v1 path behaves exactly as it did
before v2 existed. Only a sender that declares 2.0 is promising that its
content is blob-only.

A reader that rebuilds the envelope from metadata splices the coordinates back
in **immediately after `action`** — reproducing the exact object, key order
included, that a v1 peer would have sent. Everything downstream of that one
function therefore sees one shape and never learns a version exists.

Only the major number is compared, and it is parsed leniently: `"2"`, `"2.0"`,
`"2.1.3"`, `2` and `2.0` all read as 2. A missing, empty or unparseable
`version` reads as "no version", which fails the ≥ 2 test and falls to the v1
path.

### Interop matrix

| sender | receiver | result |
| ------ | -------- | ------ |
| v1 | v1 | unchanged |
| v1 | v2 | the mirror is ignored, the body is parsed — identical to v1↔v1 |
| v2 | v2 | envelope from metadata, blob from content |
| v2 | v1 | **broken** — a v1 reader parses the body, gets a PGP blob, and drops the tick |

The last row is why the **client rolls out before the sender flips**: a build
that can read v2 must be deployed to a peer population before that peer
population starts sending it. The reading half is backwards-safe on its own —
shipping it changes nothing until a v2 sender appears.

**Server**, independently: a v2-aware server reads the envelope from metadata
and rebuilds the v1-shaped body for pushes (see
[Push notifications](#push-notifications)). An **un-upgraded** server still
relays a v2 message correctly — content and metadata both pass through
untouched, so the peer client is fine — but it cannot classify the tick, so it
falls back to its "no readable envelope" path: **no push is raised**, and a
tick that would have woken a backgrounded peer arrives only on the next
websocket connect or journal replay. Upgrade the server first, or accept a push
gap for the overlap.

### `value` plaintext (inside the encrypted blob)

Unchanged from v1. Decrypted, the coordinates are one of two shapes:

- **Bare coordinates** — one-shot, plain live, and meet without a shared
  destination:

  ```jsonc
  { "latitude": 52.370216, "longitude": 4.895168, "accuracy": 12, "timestamp": 1785606428772 }
  ```

- **Wrapped** — meet *with* a shared destination (the only coordinate-derived
  field that rides the wire; `peerCoords` / `distanceMeters` are computed
  locally on each device, never sent):

  ```jsonc
  { "value": { "latitude": …, "longitude": …, "accuracy": …, "timestamp": … },
    "destination": { "latitude": …, "longitude": … } }
  ```

The receiver detects the shape: a top-level `latitude` ⇒ bare coords; a
top-level `value` ⇒ wrapped. Note this inner `value` is inside the ciphertext
and is unrelated to the v1 envelope's outer `value` field, which v2 retires.

### Encryption

The coordinates are PGP-encrypted to `own_public_key + peer_public_key`, once
per tick (no per-session symmetric key — a location tick is small and
PGP-per-tick is not a performance concern in practice). Only the coordinates
(and, for meet, the destination) are encrypted. The envelope is cleartext.

**Key handling.** The peer's public key is verified **once**, before a session
starts. From then on the tick path relies on the key already being present — a
live share never re-fires `lookupPublicKey` (per-tick key warming was needless
cross-domain push traffic). If the key is nonetheless missing at wire-send time
(it went away mid-session), the tick is **not sent** and the session is
**ended** (`stopLocationSharing`, reason `no-key`) with a single `📍 Cannot
share location: no encryption key for this contact` note — rather than the
timer spinning ticks that can never encrypt.

## Handshake signals (coordinate-free)

Three `action`s set up a share. They drive a modal + a dedicated
[push](#push-notifications) + a breadcrumb system note, and are **journaled** so
an offline peer still gets them on reconnect. `sessionId` on these == the
request id. `location_request` and `meeting_accept` are **coordinate-free** —
**in v2 their content is empty** and the whole message is its metadata.
`meeting_request` is the exception: it is **value-bearing** (it carries the
inviter's coords, because the meet session starts on request, see
[Meet-me](#3-meet-me)).

| action            | direction        | metadata                                             | content | receiver action |
| ----------------- | ---------------- | ---------------------------------------------------- | ------- | --------------- |
| `location_request`| asker → peer     | `{ action, sessionId, expires, version }`            | *empty* | Yes/No **location** modal; on *Yes* the peer answers with a one-shot (`location_once`) carrying `requestId = sessionId` |
| `meeting_request` | inviter → invited| `{ action, sessionId, role:"inviter", expires, version }` | `…PGP…` | **meeting** modal (keyed off `meeting_request:true`); the inviter's live trail is already flowing (start-on-request) |
| `meeting_accept`  | invited → inviter| `{ action, sessionId, role:"invited", version }`     | *empty* | marks the invite accepted; the **invited** side now streams its own coordinates too, and the inviter emits one `meeting_start` for its first post-accept GPS |

Meet flow (all one `sessionId` = the meeting request id):

**The meet session starts ON REQUEST, not on accept.** The invite is
value-bearing — the `meeting_request` origin carries the inviter's live
coordinates (and any destination) as its content — and the inviter's recurring
coordinate stream flows **immediately**, not held until the invitee acts. So
the invitee sees the inviter's position the moment the invite lands and watches
it move while deciding.

```
inviter ──meeting_request──▶ invited        (value-bearing: inviter's coords; modal + push; journaled, show once unless expired)
        …meeting_update ─▶ …                 (inviter's live trail — flows from request, live websocket only)
inviter ◀──meeting_accept─── invited         (coord-free; push; journaled — invited now streams its own coords too)
        …meeting_update ⇄ meeting_update…    (coords, both sides; live websocket only — never journaled)
        …meeting_end / meeting_end…          (coord-free teardown; journaled)

inviter ◀──meeting_reject─── invited         (DECLINE instead of accept; coord-free; NO push; journaled — inviter stops its share)
```

If the **inviter cancels a not-yet-accepted invite** (taps Stop on the invite
bubble / active-sessions list), a `meeting_end` goes out and the invitee's open
accept/decline modal is **dismissed in real time** (matched by session id, and
the queued pending request is dropped so it can't re-open).

`location_request` and `meeting_request` are **journaled and replayed**, and
each shows its modal **exactly once** (dedup persisted across restarts) and only
if it hasn't **expired** by the time the peer reconnects. `meeting_accept` is
journaled too (so an offline inviter learns of the acceptance). The only thing
never journaled is `meeting_update` — the high-frequency meet trail, which flows
over the live websocket only (see [Journal replay](#journal-replay)).

### Teardown signals (coordinate-free)

Also empty-content in v2.

| action          | meaning                                                    | receiver action |
| --------------- | --------------------------------------------------------- | --------------- |
| `location_stop` | a live share ended — carries a `reason` (below)           | post a reason-specific end note (live **and** journal replay) |
| `meeting_end`   | a meet session was torn down — carries a `reason` (proximity / expired / ended) | wipe the session (see [Meet-me teardown](#meet-me-teardown)) **and** post the reason-aware end note — on live receive **and** journal replay. If a **not-yet-accepted** invite is being cancelled, also dismiss the invitee's open accept/decline modal and drop the queued pending request |
| `meeting_reject`| the invited peer **declined** the meet from the modal (invited → inviter) | the inviter **wipes the session — stopping its share** — and posts `📍 <name> declined your meet-up request`; the decliner posts `📍 Meet-up declined`. **Never pushed** (websocket / journal only) |

Both teardown signals are **journaled and replayed** (see
[Journal replay](#journal-replay)): a peer who was offline when a share ended
still gets the end note (and, for a meet, the session wipe) when the journal
catches up. The handler posts the note without storing a row.

**`location_stop` identity.** A stop carries **`sessionId` and nothing else**
to identify itself. It is mandatory: a stop without one cannot be attributed to
a track, and a receiver that cannot attribute it will leave the map pinned
"live" forever. Senders MUST set it; receivers SHOULD log a warning when a stop
arrives without one.

`messageId` is **no longer sent on `location_stop`**. It only ever repeated
`sessionId` — both slots held the same origin id:

```jsonc
{ "action": "location_stop", "reason": "returned",
  "sessionId": "6aceb67c-…", "messageId": "6aceb67c-…" }   // the old, redundant shape
```

The stop's own message id is already on the SIP envelope, so nothing is lost.
Receivers MUST resolve the session as **`sessionId || messageId`** — that
precedence, not the reverse: `messageId` remains only as a fallback for peers
still running the older sender, and a reader that checks `messageId` first
breaks the moment it stops arriving.

**`location_stop` reason** — a cleartext `reason` drives the end note and the
[push](#push-notifications) label:

| `reason`   | when                                                    | note / push text                          |
| ---------- | ------------------------------------------------------- | ----------------------------------------- |
| `returned` | "until I return" share — sender got back to the start   | `📍 <name> returned`                      |
| `expired`  | the timed cap lapsed                                    | `📍 <name>'s location sharing expired`    |
| `ended`    | anything else — a manual stop, delete, logout           | `📍 <name> stopped sharing live location` |

**`meeting_end` reason** — `proximity` (the parties met), `expired`, or
`ended`. **`expired` is suppressed server-side** (no banner); `proximity` and
`ended` push. A **proximity** meet-end is the "you met" success signal — its
push body is `🎉 Nice to meet you!` so a backgrounded / non-detecting peer still
learns the meet succeeded; `ended` pushes `📍 Meet-up ended`. The chat-visible
end marker is a persistent lifecycle note (see
[System notes](#system-notes-symmetric-on-both-ends)).

## Share types & example payloads

Only fields the SIP envelope can't supply are sent: `timestamp` and `uri` are
never on the wire. Content is written `…PGP…` (the armoured coordinate blob).

### 1. One-time sharing

A single static location: **one** message, no trail, no stop. `action` is
`location_once`; a one-shot omits `sessionId` — its session is the envelope id.

```jsonc
// metadata
{
  "action":   "location_once",   // stored as related_action, no computation on the peer
  "deviceId": "…",
  "version":  "2.0"
}

// content
"…PGP…"                          // encrypted coords: { latitude, longitude, accuracy, timestamp }
```

- Rendered inline on the **main** message path (not the trail query) and
  rebuilt from SQL on every load, so the map never vanishes on reload.
- Standard delivery: requests `display`, the receiver acknowledges **once**,
  then the tick freezes displayed. Bumps unread by one. Generates one push.
- **Answer to a location_request**: the same one-shot, plus `requestId = <the
  location_request id>`, so the answerer's *other* devices close their prompt
  when a sibling answers (see [Multi-device](#multi-device-sibling-mirror)).

### 2. Live location sharing (until stopped / until return)

An origin (`action: "location_start"`) opens the session; updates
(`action: "location_update"`) carry each new position (~60s); a coordinate-free
`location_stop` with a `reason` ends it. All three share one `sessionId`.

```jsonc
// ORIGIN — opens the session
// metadata
{
  "action":    "location_start",
  "deviceId":  "…",
  "sessionId": "sess1",        // groups every tick of this map
  "expires":   "…",            // the live-share window
  "perm":      "always",
  "version":   "2.0"
}
// content
"…PGP…"

// UPDATE — one per ~60s
// metadata
{
  "action":    "location_update",
  "deviceId":  "…",
  "sessionId": "sess1",
  "version":   "2.0"
}
// content
"…PGP…"

// STOP — coordinate-free; `reason` says why it ended
// metadata
{
  "action":    "location_stop",
  "reason":    "ended",        // ended | returned | expired
  "deviceId":  "…",
  "sessionId": "sess1",       // MANDATORY — the only link back to the track
  "version":   "2.0"
}
// content
""                             // empty — nothing to encrypt
```

- Only the ORIGIN carries delivery/receipt/unread/push; UPDATE ticks are silent
  telemetry (no disposition, no receipt, no unread, no push). The stop signal
  pushes once and posts the reason-specific end note — on live receive **and**
  journal replay.
- Chat-wise this is **one** message (the origin map); the trail points are
  loaded by the secondary query, orthogonal to the message stream.

### 3. Meet-me

A rendezvous. The handshake (`meeting_request` → `meeting_accept` — see
[Handshake signals](#handshake-signals-coordinate-free)) establishes the
session; then **both** sides stream coordinates as `meeting_start` +
`meeting_update`, sharing **one** `sessionId` (the meeting request id) and told
apart by `role`.

```jsonc
// The two coordinate origins — SAME sessionId, different role.
// INVITER (sends first, right after seeing meeting_accept)
// metadata
{
  "action":    "meeting_start",
  "sessionId": "reqSess",      // == the msg_id of the meeting_request message that opened the session
  "role":      "inviter",
  "expires":   "…",
  "deviceId":  "…",
  "version":   "2.0"
}
// content: "…PGP…"

// INVITED
// metadata
{
  "action":    "meeting_start",
  "sessionId": "reqSess",      // SAME session as the inviter
  "role":      "invited",
  "expires":   "…",
  "deviceId":  "…",
  "version":   "2.0"
}
// content: "…PGP…"

// UPDATE (either side) — role re-stamped so every row is self-describing
// metadata
{
  "action":    "meeting_update",
  "sessionId": "reqSess",
  "role":      "invited",      // or "inviter"
  "deviceId":  "…",
  "version":   "2.0"
}
// content: "…PGP…"
```

```jsonc
// TEARDOWN — one signal: wipes the session, posts the end note, pushes,
// and is journaled + replayed (so an offline peer still learns it ended).
// metadata
{
  "action":    "meeting_end",
  "reason":    "ended",        // proximity (the parties met) | expired | ended
  "sessionId": "reqSess",
  "messageId": "…",
  "deviceId":  "…",
  "version":   "2.0"
}
// content: ""
```

- **One map, two tracks by role.** Both legs' coordinate ticks group under the
  one `sessionId`. On each device its **own** role's ticks are the owner pin and
  the **peer's** ticks feed `peerCoords`, so the rendezvous renders as a
  **single** map bubble with both dots — never two bubbles (see
  [Read / render paths](#read--render-paths-no-decryption-to-classify)).
- **Meeting point (a 3rd pin).** A meet can be started with a fixed **meeting
  point** — a geo location both parties converge on — most commonly by starting
  the meet **from a shared map link** (`meetMeAt` resolves the Maps link /
  coords into the destination). The point is held **locally** on the inviter
  until the share begins, then rides every meet tick inside the encrypted
  content as the **wrapped** shape
  `{ value: <own coords>, destination: <meeting point> }` (see
  [`value` plaintext](#value-plaintext-inside-the-encrypted-blob)) —
  `destination` is the only coordinate-derived field that goes on the wire;
  `peerCoords` and distance are computed locally, never sent. The map then shows
  **three** pins: your own track, the peer's track, and the **green
  meeting-point pin**, so both sides see where they're heading. Without a
  meeting point the meet is just the two live tracks.
- **Privacy-radius variant**: the origin's coordinates are the *destination*
  (not the real position), flagged with `privacyDeferred` +
  `privacyDeferredRadiusMeters` (or `dummy` when there is no shared
  destination) until the sender crosses the perimeter, after which real-coord
  updates flow.
- No text announcement — the location [push](#push-notifications) is the meet
  notification and the map bubble is its chat-visible marker.

## SQL storage

**Unchanged by v2, on both ends.** This is not a coincidence: the client's
`content` column already held the coordinates alone — v1's split-on-receive
extracted `value` and stored *that*, discarding the envelope wrapper into the
`related_*` columns and `metadata`. v2 simply moves that split from the
receiver to the sender. The rows are byte-identical either way.

Every **coordinate** tick (one-shot, live origin/update, meet origin/update) is
one row in the `messages` table. **No new columns.** The coordinate-free
handshake/teardown signals do **not** create a coordinate row — they're acted on
live (modal / session wipe) and leave a **system-note breadcrumb** (a
`system = 1` row) as their persistent, reloadable timeline marker.

| column                    | value stored for a location-sharing row |
| ------------------------- | ---------------------------------------- |
| `content_type`            | `'application/sylk-location-sharing'` |
| `encrypted`               | `1` at write (the `content` blob is PGP ciphertext); flips to `2` after the first decrypt-on-load (`content` is then cached plaintext) |
| `msg_id`                  | this tick's own message id — **always unique**, independent of `sessionId` |
| `content`                 | the coordinates. **On write** the PGP ciphertext (no decryption on the store path). **On first load/render** decrypted and rewritten as a decrypt-once cache — `content` ← plaintext coords, `encrypted` → `2`, original ciphertext preserved in `content_encrypted` — so later reads don't re-run PGP. (The standard message decrypt-cache, not location-specific.) |
| `metadata`                | only the envelope fields with no column that aren't derivable — `expires`, `role` (meet), `deviceId`, `perm`, `requestId`, and the privacy fields `privacyDeferred` / `privacyDeferredRadiusMeters` / `dummy`. `messageId`, `timestamp`, `uri`, `action`, `one_shot`, `meeting_request` are reconstructed on read. For a plain-live tick this is just `{"expires":"…"}`. **Note this is the client's storage whitelist, not the wire envelope** — the two are different objects that happen to share a name |
| `related_action`          | **the row's purpose**, verbatim from the envelope `action` — `location_once` / `location_start` / `meeting_start` for origins, `location_update` / `meeting_update` for trail ticks. Indexed and decryption-free |
| `related_msg_id`          | the **session grouping id**, from the envelope `sessionId` — so **both meet legs** and every trail tick share one key (each with its own distinct `msg_id`) |
| `category`                | `'location'` on browsable rows (origins + one-shot) so the media browser finds them; `null` on trail update ticks. Derived from `related_action`, no decryption |
| `from_uri` / `to_uri`     | sender / account (incoming); account / peer (outgoing) |
| `direction`               | `'incoming'` or `'outgoing'` |
| `timestamp` / `unix_timestamp` | ISO string / epoch **seconds** (ordering) |
| `expire`                  | `now + 30 days` in epoch **seconds** — drives `purgeExpiredMessages()`. One constant, `LOCATION_RETENTION_SEC` in `app/app.js`; it is also the number quoted to the user in the share and privacy modals and in the store privacy text |
| `disposition_notification`| requested IMDN dispositions, comma-joined — **incoming** origin rows only |

Write paths: `saveOutgoingMessage` (sender), `saveIncomingMessage` (live
receive) and the journal-replay store. All three take `related_action` and
`related_msg_id` from the envelope — read from metadata for a v2 tick, from the
body for a v1 one — so the columns are correct on every row **without
decryption**. The journal path stores the ciphertext verbatim, so replaying a
journal of 1000 update ticks costs **zero** PGP work (coordinates are decrypted
lazily, only when a bubble renders).

`related_action` values (the purpose of each stored coordinate row):

| `related_action`  | the item |
| ----------------- | -------- |
| `location_once`   | one-shot static share (standalone bubble) |
| `location_start`  | plain live share — the origin/start tick |
| `location_update` | a trail tick of a **plain live** share |
| `meeting_start`   | a meet coordinate origin — **both** legs (`role` tells which) |
| `meeting_update`  | a trail tick of a **meet** session |

**Reconstructed on read** (`_locationContentFromRow`): the render metadata is
rebuilt from the columns — `messageId = related_msg_id` (the session/bubble id),
`isUpdate` from `related_action IN ('location_update','meeting_update')`,
`timestamp` / `uri` from the columns, `action = 'location'`, `one_shot` from
`related_action == 'location_once'`, and for a `meeting_start` row the
`meeting_request` flag is re-derived when `role !== 'invited'` (the inviter
leg); the stored fields (`expires`, `role`, privacy) are merged back in.

### On the server

The journal row is unchanged too, except that its `metadata` column is now
**populated for every location tick and is the authoritative copy of the
envelope**. The server stores content and metadata exactly as they arrive; it
does not merge them at rest.

## Server-side reading

The server reads the envelope — never the coordinates — in four places, all
through one version-aware helper
(`sylk/applications/webrtcgateway/location.py`):

| what | why it reads the envelope |
| ---- | ------------------------- |
| push gate (`sip_handlers.py`) | decide whether this tick warrants a notification, from `action` + `reason` |
| push payload (`push.py`) | rebuild the single-JSON body push consumers read — see below |
| track cascade-delete (`storage.py`) | `sessionId` groups a share's trail, so removing an origin removes its ticks |
| admin UI (`web.py`) | label a row's action and nest a trail under its origin |

A v2 tick that arrives with **no usable metadata** has no readable envelope on
either side — it cannot be classified, so it gets no push, and the server logs
a warning naming the message id and sender. That is the signature of a metadata
field lost in transit, and the one thing worth grepping for during a rollover.

## Push notifications

`application/sylk-location-sharing` has its **own** push path. The server reads
the cleartext `action` **and `reason`** and pushes on:

- **Coordinate origins**: `location_once`, `location_start`.
- **Coordinate-free handshake wakeups**: `meeting_request`, `meeting_accept`,
  `location_request`.
- **Teardown**: `location_stop`, `meeting_end` — **except the value-less
  variants below**, which the server drops so no banner is ever raised.

**Never pushed** (delivered over the websocket / journal only): the trail ticks
`location_update` / `meeting_update`, the coordinate origin `meeting_start`, the
decline `meeting_reject`, and these suppressed teardown reasons:

| suppressed push             | why |
| --------------------------- | --- |
| `location_stop` · `expired` | a timed cap lapsing isn't worth a banner |
| `meeting_end` · `expired`   | ditto for a meet window lapsing |

### The push payload is still v1-shaped

**This is the one place v2 deliberately un-does its own split.** The push body
is consumed by code that cannot be upgraded in lockstep with the protocol — the
Sylk push server, and the native notification layers that build the banner
before JavaScript is running (the Android FCM service and the iOS Notification
Service Extension). Both read the lifecycle fields straight out of `content`.

So the server **reassembles** the payload: it takes the metadata envelope,
splices the armoured blob back in right after `action`, and sends that as the
push `content`. The result is byte-for-byte what a v1 sender would have put on
the wire, with one exception — `version` passes through as the sender set it,
so a rebuilt payload still says `"2.0"` and names the version its sender spoke:

```jsonc
// stored
metadata = {"action":"location_start","deviceId":"…","sessionId":"…","expires":"…","perm":"always","version":"2.0"}
content  = "-----BEGIN PGP MESSAGE-----…"

// pushed
content  = {"action":"location_start","value":"-----BEGIN PGP MESSAGE-----…","deviceId":"…",
            "sessionId":"…","expires":"…","perm":"always","version":"2.0"}
```

A v1 tick's payload is passed through untouched — there is nothing to
reassemble. **No push-side change is needed for v2**, and the client's
push-tap handlers keep parsing the body as they always did.

The payload's coordinates are encrypted, so a push can never render a map — it
only **wakes + routes**: the tap opens the chat and the map renders from the
delivered/journalled message via the lazy decrypt. The ~1.2 KB of ciphertext
buys nothing on this path but is kept for shape compatibility; note that a
payload over the provider cap (4096 bytes) has its `content` **stripped
entirely** before send, which loses the action along with it — an oversize
location push falls back to the generic banner and loses its deep link.

Client handling:

- **Label** is set natively from the cleartext envelope in the push body: the
  **sender's name is the title**, and an explicit `📍` body names the action:

  | action (· reason)          | body |
  | -------------------------- | ---- |
  | `meeting_request`          | 📍 Meet-up request |
  | `meeting_accept`           | 📍 Accepted your meet-up request |
  | `meeting_end` · proximity  | 🎉 Nice to meet you! |
  | `meeting_end` · ended      | 📍 Meet-up ended |
  | `location_once`            | 📍 Shared current location |
  | `location_start`           | 📍 Started sharing location |
  | `location_stop` · returned | 📍 Returned home |
  | `location_stop` · other    | 📍 Stopped sharing location |
  | any other action           | 📍 Location update (defensive fallback) |

- **No native raw insert**: the native push handlers deliberately do **not**
  write the location row to SQL. Storing the envelope verbatim would create a
  row that could win the `msg_id` UNIQUE race against the proper split-store
  from the WS/journal path, leaving a location row that never renders. Native
  shows the notification; JS (WS/journal) does the store.

## Read / render paths (no decryption to classify)

Unchanged by v2 — every one of these reads columns, not the wire.

- **Isolate a session by purpose, key-free**: `related_action` names it
  directly; `related_msg_id` (= `sessionId`) groups it. No metadata parsing, no
  decryption.
- **Trail / map load** (`getMessages` secondary query): select
  `content_type = 'application/sylk-location-sharing'` (skipping
  `related_action = 'location_once'`, which renders on the main path), decrypt
  each row's coordinates, reconstruct via `_locationContentFromRow`, and group
  by `related_msg_id`.
- **Origin detection is by `isUpdate == false`**, not `msg_id == messageId` —
  because a meet origin's `msg_id` is a fresh id, distinct from its `sessionId`.
- **One meet bubble, role-filtered.** Both legs group under one `sessionId`. The
  reload keeps **your** role's leg as the bubble (owner trail) and folds the
  **peer's** leg into `peerCoords` — mirroring the live path, so a reopened meet
  rebuilds the same single two-dot bubble instead of two.
- **Chat-wise a live/meet map is ONE message**; the trail points are orthogonal
  render data from the secondary query. The synthesized bubble carries the
  origin row's `pending`/`sent`/`received`, so its tick reflects only whether the
  initial map was delivered/seen.
- **Coordinates**: decrypted lazily from `content` when a bubble first renders,
  then cached back into the row as plaintext (`encrypted → 2`, ciphertext kept
  in `content_encrypted`) so subsequent loads skip the PGP work.

### Client render store (`locationData`, isolated from `messagesMetadata`)

Location render data lives in a **dedicated `locationData` store** (a top-level
`state.locationData` plus a per-contact `contact.locationData` mirror), keyed by
message id → the array of `action:'location'` events for that bubble. It is
isolated from the general `messagesMetadata` bag (which holds only true message
metadata — labels, rotations, replies, reactions), so location ticks don't
contend with those merges. Every location writer routes here:

- **load** (`getMessages`) partitions the loaded slice — location rows to
  `locationData`, everything else to `messagesMetadata`;
- **live ticks** apply through `updateLocationFromRemote` (the location
  counterpart of `updateMetadataFromRemote`), basing the merge on `locationData`
  and writing it back;
- the **ended / meetOutcome** stamp and the meet **peer-coords** propagation
  write `locationData` too.

The chat reads location exclusively from `locationData` and re-renders on any
`locationData` reference change; end-of-life fields (`ended` / `endedReason` /
`meetOutcome`) are folded into each bubble's per-tick change signature so an
in-place stamp still flips the footer to "Track ended" / "Meet-up cancelled"
live on the receiver and on sibling devices, without a reload.

## Delivery receipts & unread

Unchanged by v2. A location share joins the normal IMDN + unread pipeline, but
**only at the origin** — the single chat message that renders the map. Update
ticks are silent.

- **Disposition**: the ORIGIN tick requests `display`; every UPDATE tick
  (`location_update` / `meeting_update`) is sent with disposition suppressed. A
  live share of N ticks yields exactly **one** read receipt, not N.
- **Displayed**: on chat open, `confirmRead` sends a single `displayed` for the
  origin. Its query includes location origins explicitly
  (`related_action NOT IN ('location_update','meeting_update')`) because the rows
  are `encrypted = 1`; update ticks are never selected.
- **Ticks, frozen**: because updates carry no disposition and are never
  acknowledged, displayed stays displayed for the life of the share.
- **Unread**: an incoming ORIGIN (one-shot, live start, meet start) bumps the
  badge by **one**, on both the live and journal-replay paths. Update ticks
  never bump.

## Multi-device (sibling mirror)

Sends are replicated to the sender's other devices as `outgoingMessage` carbons.
**The carbon carries the metadata**, so a sibling reads a v2 tick exactly as the
peer does. A dedicated location branch mirrors the handshake so a modal open on
a sibling closes when another of your devices acts:

- a **one-shot** carbon with `requestId` → close the **location-request** prompt
  for that request id (`_noteSiblingAnsweredLocationRequest`);
- a `meeting_accept` **or** `role:"invited"` `meeting_start` carbon → mark the
  meet **accepted** so the meeting modal closes
  (`_noteSiblingAcceptedMeetingRequest`);
- trail ticks (`location_update` / `meeting_update`) are dropped from sibling
  replication (bridge-saturation guard).

A sibling device also **mirrors an active share it did not start** (a
`_activeRemoteShares` entry, unioned with its React-state twin) so it can show
the live map and the **"Stop sharing"** control for the whole session; tapping
Stop there **relays** the teardown (`location_stop` / `meeting_end`) so both the
peer **and** the broadcasting sibling tear down — "start on one device, finish
on another". A session that has genuinely ended (durable ended marker) is never
revived by a reload's mirror seed or a journal replay.

## Journal replay

The journal is the offline catch-up: when the app starts / reconnects, the
server replays everything received while it was offline. **Each replayed row
carries its `metadata`**, so a v2 tick replays exactly as it arrived live.

- **Coordinate rows** — `location_once` / `location_start` / `location_update` /
  `meeting_start` are journaled and stored (ciphertext verbatim, no PGP work);
  the map rebuilds from SQL. **`meeting_update` is the exception**: the sender
  sets `skipJournal`, so the server never journals it — the meet trail arrives
  **only over the live websocket** while both sides are running. The client
  still saves each live `meeting_update` to SQL so the trail renders when the
  chat is opened, and the whole session is deleted at meet-end.
- **`location_request` / `meeting_request`** — journaled + replayed; each shows
  its modal **exactly once** (dedup persisted across restarts) and only if it
  hasn't **expired** by the time you reconnect.
- **`meeting_accept`** — journaled, so an inviter who was offline still learns
  the peer accepted (and starts sharing) on reconnect.
- **`location_stop`** — posts its reason note (stores no row).
- **`meeting_end` / `meeting_reject`** — run the session wipe **and** post the
  note. A journal batch is **pre-scanned** for these end signals before any
  `meeting_request` in the same batch is dispatched, so a request whose end is
  present in the same fetch is **discarded** (no modal). Ended sessions are held
  in a persistent tombstone, and the `Meet-up request by <name>` breadcrumb is
  suppressed when a lifecycle `system = 1` note for that session already exists
  in SQL — so an already-finished meet replayed from the journal adds nothing
  new.

> **A replayed row with an empty `content` MUST NOT be treated as corrupt.**
> Discard the entry only when `content` and `metadata` are *both* empty.
>
> This is not a style point. A client that purged on empty `content` alone also
> journaled a `removeMessage` for each discarded entry — and because the server
> cascades a removal to every sibling sharing the entry's `sessionId`, throwing
> away one empty-bodied `location_stop` deleted **the whole track**, origin and
> every tick, from the server journal and from every device on the account.
> Observed 2026-08-24; fixed in `_syncJournal`.

## Meet-me teardown

A meet session is torn down on `meeting_end` (or a local stop). Every tick of a
session carries the session id in the indexed `related_msg_id` column, so an
exact match wipes the whole session (both legs). Scoped to the location type:

```sql
DELETE FROM messages
 WHERE (system IS NULL OR system = 0)
   AND content_type = 'application/sylk-location-sharing'
   AND (msg_id = :sessionId OR related_msg_id = :sessionId);
```

No `metadata LIKE` scan and no decryption — the grouping key is a real column.

A meet emits **only `meeting_` actions** — `location_stop{meet_end}` is a legacy
receiver-side path, never sent by a current client. `meeting_end` does
everything itself: on **live receive and journal replay** it runs the wipe above
and posts the reason-aware end note. So a peer who was offline when the meet
ended still gets the wipe + note on reconnect. **`meeting_reject`** takes the
same teardown path on the inviter: the invited peer declining from the modal
wipes the inviter's session (stopping its share) and posts the decline note.
`meeting_end`'s value-less variant (`expired`) and `meeting_reject` are **not
pushed**; a `proximity` meet-end **does** push (the success banner).

The server runs the same cascade on its own journal, keyed off the envelope's
`sessionId` — read from metadata for a v2 tick.

## System notes (symmetric on both ends)

Unchanged by v2. Plain live shares surface as system notes rather than a chat
bubble:

- **Sender start** — `📍 Sharing live location at HH:MM for <period>`, stamped
  ~1s before the origin tick so it sorts above the first map bubble.
- **Receiver start** — `📍 <name> started sharing live location at HH:MM`.
- **End (both sides)** — the reason-specific note (`returned` / `expired` /
  stopped for live; `expired` / ended for meet), posted on live receive **and**
  journal replay.

The handshake asks drop deduped breadcrumbs on the sender
(`📍 Location requested at HH:MM` / `📍 Meet-up requested at HH:MM`).

The **meet-me lifecycle** is recorded as persistent `system = 1` notes — they
survive the session wipe (map + dots go, the notes stay), are written on every
path (push / websocket / journal), and are deduped per `session:kind`:

| stage | note |
| ----- | ---- |
| request received | `Meet-up request by <name> at HH:MM` — suppressed if the meet already started/ended (a lifecycle note for the session exists in SQL) |
| accepted (both sides) | `Meet-up started at HH:MM` |
| close (proximity near) | `You are close to each other at HH:MM` |
| end · proximity | `You met at HH:MM` |
| end · expired | `Meet-up expired at HH:MM` |
| end · cancelled / declined | `Meet-up cancelled at HH:MM` |
| end · other | `Meet-up ended at HH:MM` |
| declined — on the decliner | `Meet-up declined` |
| declined — on the inviter | `<name> declined your meet-up request at HH:MM` |

A re-delivered `meeting_request` for a session that already has any of these
notes re-adds nothing (dedup + ended-session tombstone).

**Replayed notes stamp at the event time.** When a system note is written from a
journal replay (a stop/end/decline/request breadcrumb caught up on reconnect),
it is stamped with the **journalled message's timestamp**, not "now" — so a
device that wakes up and drains an old journal slots the breadcrumbs into their
correct chronological place instead of piling them at the current time.

## Retention

- All location-sharing rows carry `expire = now + 30 days`; the periodic sweep
  (`purgeExpiredMessages()`, at every startup) removes them after the window.
  Journal-replayed rows are stamped from **replay** time, so a late catch-up
  restarts the clock for those rows.
- The window is a user-facing promise, quoted in the share modal, the privacy
  disclosure modal and the store privacy text. It lives in one constant —
  `LOCATION_RETENTION_DAYS` / `LOCATION_RETENTION_SEC` in `app/app.js` — and the
  copy must be changed with it.
- Plain live shares persist their per-tick trail for later playback; there is no
  peer stop signal beyond `location_stop` (the sender simply stops ticking).
- Meet sessions are additionally deleted on end (above).

### Deletion

One rule governs every path that removes location data:

> **Never *emit* a `removeMessage` that no user asked for. Always *honour* one
> that arrives.**

An inbound `removeMessage` is authoritative — it means a person pressed delete,
and their intent outranks the receiver's wish to keep the data, so it is honoured
in full including the meet sibling-leg cascade. What must never happen is a
*device* fabricating that request on its own: journal purges, pending sweeps,
metadata de-duplication, permission-denial rollbacks and any other housekeeping
delete are **local-only**. Remote propagation is reserved for an explicit user
action (deleting a bubble, deleting history, wiping the device).

Because one `removeMessage` on a location row cascades server-side across the
whole `sessionId`, an automatic remote delete is never a small mistake.

**Auditing it.** Every deletion that touches location rows logs
`[location] [audit] DELETING <n> location row(s) id=… reason=…`. Deliberate
call sites pass a `reason` (`user:delete-bubble`, `user:delete-history`,
`user:reject-meeting`, `peer:removeMessage`, …); anything without one is stamped
`NO REASON GIVEN`. `tools/check-location-deletes.py` reads an exported log and
fails on any unattributed location deletion.

## Privacy tradeoff (explicit)

The exposure is **the same set of facts as v1** — v2 moves them, it does not add
or remove any. The server / journal / admin see location **metadata** in
cleartext: that a share happened, whether it's one-shot / live / meet, its
timing and frequency, the session lifecycle, `role`, `deviceId`, the sender's OS
permission state, and — for meet — that a rendezvous is being coordinated and
with whom. They do **not** see coordinates, distance, or destination, which stay
E2EE in the content on the wire and in the journal.

What v2 changes is **legibility**: those fields used to be buried in a JSON body
that a human had to unpick from a wall of base64, and are now a plain column.
That makes the exposure easier to audit — and easier to browse. Worth stating
plainly rather than treating a format change as privacy-neutral by default.

The admin UI reflects this: the message list shows a row's **action**, and the
metadata envelope is shown only when a specific message is opened, not as a
column on every row.

**Caveat — at rest on the device:** coordinates are stored ciphertext on write,
but on first view each row is decrypt-cached (`content` ← plaintext coords,
`encrypted → 2`, ciphertext retained in `content_encrypted`), so a location row
that has been opened holds the coordinates in plaintext locally — the standard
message decrypt-cache, not specific to location.

## Implementation map

The version logic lives in exactly one file per side. They are the same
algorithm, and they must stay that way — a tick the server classifies one way
and the client reads another is the failure mode this design is most exposed to.

| | client (sylk-mobile) | server (sylkserver) |
| --- | --- | --- |
| module | `app/locationEnvelope.js` | `sylk/applications/webrtcgateway/location.py` |
| split for send | `splitLocationEnvelope()` — called once, in `_sendMessage` | — |
| rebuild on read | `locationEnvelope()` / `messageLocationEnvelope()` | `location_envelope()` |
| version test | `locationMetadata()` / `envelopeVersion()` | `location_metadata()` / `envelope_version()` |
| push payload | — | `location_push_content()`, called from `push.py` |
| metadata transport | sylkrtc `options.metadata` | `metadata.py` (CPIM header, sanitising, size cap) |
| probe | `test_location_envelope.mjs` | `test_location_metadata.py` |

Both probes are standalone — no dependencies, no server needed:

```
node test_location_envelope.mjs      # in sylk-mobile
python3 test_location_metadata.py    # in sylkserver
```

**On the send side there is exactly one split point.** Every location payload —
both envelope builders, every signal, every pending-sweep resend — funnels
through `_sendMessage`, and that is the only place that takes an envelope apart.
Everything upstream still builds one whole object and never learns a version
exists. The receive side mirrors this: the envelope is rebuilt at each entry
point, and every reader below it sees the v1 shape it always saw.
