# `application/sylk-message-metadata`

A general-purpose envelope for "out-of-band" facts about another message or
about a contact. The payload's `action` field selects the sub-type. The
client switches on `action` after decryption to decide what to do.

- **Direction**: both
- **Encrypted**: yes — same PGP rules as text messages.
- **Persistence**: stored in `messages` with
  `content_type = 'application/sylk-message-metadata'`. The `metadata`
  column always carries the JSON-stringified `metadataContent`; the
  `content` column carries the same JSON in plaintext (or PGP-armoured,
  if the row is encrypted) so SQL `LIKE` searches over `content` work for
  encrypted rows too.

## Common envelope

Every `sylk-message-metadata` body is a JSON object with at least:

```jsonc
{
  "action":     "<consumed|autoanswer|caregiver|location|location_request>",
  "messageId":  "<UUID — the message this metadata is about>",
  "metadataId": "<UUID — null on the origin tick, set on follow-ups>",
  "value":      "<action-specific>",
  "timestamp":  "2026-05-07T09:14:00.000Z"
}
```

`messageId` and `metadataId` together let the receiver tell "first event for
this thing" (`metadataId == null`) apart from "follow-up update" (the
location-share follow-up tick is the canonical case).

## Sub-types by `action`

### `label`

Attaches (or replaces) a caption / label on another message — most often the
caption text under an image or other file-transfer attachment, edited after
the original was already sent. Carries the new caption in `value`. The
receiver matches it back to the target via `messageId`.

`messageId` here is the `_id` of the message being labelled (the
file-transfer); `metadataId` is the metadata message's own id, used so the
sender can later edit or remove the label without disturbing the underlying
attachment.

```json
{
  "action":     "label",
  "messageId":  "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
  "metadataId": "a68693c2-7e1f-4d5a-9b0c-1d2e3f4a5b6c",
  "value":      "Cat photo from yesterday's hike 🐱",
  "timestamp":  "2026-05-07T09:14:30.000Z",
  "uri":        "bob@sip2sip.info"
}
```

Wire envelope (the metadata body is JSON-stringified into `content`,
typically PGP-encrypted):

```json
{
  "id": "a68693c2-7e1f-4d5a-9b0c-1d2e3f4a5b6c",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:30.000Z",
  "contentType": "application/sylk-message-metadata",
  "content": "-----BEGIN PGP MESSAGE-----\n…\n-----END PGP MESSAGE-----"
}
```

To **edit** the caption later, the sender first deletes the previous label
metadata (by its `metadataId`) and then sends a fresh `label` with a new
`metadataId` — see `sendEditedMessage` in `ContactsListBox.js`. Querying the
current label on a message goes through `getMetadataByAction('label')`,
which returns the most recent label entry for the target.

### `consumed`

Sent back to the file-transfer sender once the receiver has viewed the file.
The sender uses it to flip the row's "consumed" indicator.

```json
{
  "action":     "consumed",
  "messageId":  "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
  "metadataId": "0c2d4e6f-1a3b-5c7d-9e0f-2b4d6f8a0c1e",
  "value":      true,
  "timestamp":  "2026-05-07T09:14:30.000Z"
}
```

### `autoanswer`

Replicates the per-contact "auto-answer" toggle across the user's own
devices. Sent from the device that flipped the toggle, addressed to the
user's own account URI.

```json
{
  "action":    "autoanswer",
  "value":     true,
  "uri":       "bob@sip2sip.info",
  "device":    "0e0d4c4b-3a2b-1c0d-9e8f-7a6b5c4d3e2f",
  "timestamp": "2026-05-07T09:14:00.000Z"
}
```

### `caregiver`

Same shape as `autoanswer` but mirrors the per-contact "caregiver" toggle.

```json
{
  "action":    "caregiver",
  "value":     true,
  "uri":       "bob@sip2sip.info",
  "device":    "0e0d4c4b-3a2b-1c0d-9e8f-7a6b5c4d3e2f",
  "timestamp": "2026-05-07T09:14:00.000Z"
}
```

### `location`

A live-location share tick. The first tick of a session is the *origin*
(`metadataId === null`); every subsequent tick UPDATEs the origin row's
`content` blob in place. See also
[`application/sylk-live-location`](./sylk-live-location.md), which is the
in-memory render bubble derived from these ticks.

```jsonc
{
  "action":     "location",
  "messageId":  "f2c4e6a8-1b3d-5e7f-9a0c-2e4f6a8c0e2d",
  "metadataId": null,
  "value": {
    "latitude":  52.370216,
    "longitude": 4.895168,
    "accuracy":  12,
    "timestamp": "2026-05-07T09:14:00.000Z"
  },
  "expires":    "2026-05-07T13:14:00.000Z",
  "timestamp":  "2026-05-07T09:14:00.000Z",
  "uri":        "bob@sip2sip.info",

  // Optional "until we meet" handshake fields. Stamped on every tick of
  // a meeting flow so the bubble can be reconstructed from any single tick.
  "meeting_request": true,
  "in_reply_to":     null
}
```

A follow-up tick has `metadataId` set to a fresh UUID:

```jsonc
{
  "action":     "location",
  "messageId":  "f2c4e6a8-1b3d-5e7f-9a0c-2e4f6a8c0e2d",
  "metadataId": "9a8b7c6d-5e4f-3a2b-1c0d-0e1f2a3b4c5d",
  "value": {
    "latitude":  52.370298,
    "longitude": 4.895402,
    "accuracy":  10,
    "timestamp": "2026-05-07T09:15:00.000Z"
  },
  "expires":    "2026-05-07T13:14:00.000Z",
  "timestamp":  "2026-05-07T09:15:00.000Z",
  "uri":        "bob@sip2sip.info"
}
```

### `location_request`

"Could you share your current location, please?" — a request for the peer to
start sharing. There's no `value` field; the request is the message itself.

```json
{
  "action":     "location_request",
  "messageId":  "1d2e3f4a-5b6c-7d8e-9f0a-1b2c3d4e5f60",
  "timestamp":  "2026-05-07T09:14:00.000Z",
  "uri":        "bob@sip2sip.info",
  "expires":    "2026-05-07T09:24:00.000Z"
}
```

### `peaks`

Carries the per-100ms amplitude waveform for an
[`application/sylk-file-transfer`](./sylk-file-transfer.md) audio recording
(call recording or voice memo). SylkServer's file-transfer broadcast only
relays a fixed set of fields (`filename`, `filesize`, `sender`, `receiver`,
`transfer_id`, `timestamp`, `until`, `url`, `filetype`, `hash`) — any custom
field stamped on the upload's metadata, including `peaks`, is dropped on the
way out. So the sender ships a separate `sylk-message-metadata{action:'peaks'}`
follow-up immediately after the file_transfer; the receiver attaches it to
the file_transfer row's `metadata.peaks` field, where the chat bubble's
`AudioWaveform` reads it from.

```jsonc
{
  "action":     "peaks",
  "messageId":  "4d53dbc1-b60e-48e7-a45c-b8a85be946e9",  // file_transfer.transfer_id
  "metadataId": "6cea6cb5-3c55-40b6-a615-d7704170736e",
  "value": {
    "l": [2, 2, 0, 0, 0, 0, 0, 0, 0, 5, ...],   // local channel (mic), 0..255 per bin
    "r": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...]    // remote channel (peer), 0..255 per bin
  },
  "timestamp":  "2026-05-10T11:14:23.911Z"
}
```

Each entry is the peak amplitude over a 100 ms window, scaled to 0..255 so
the wire payload stays compact (~1 KB per minute of recording). Voice memos
have only the local mic — `r` ships as an empty array `[]` and the bubble's
waveform component renders a flat dim baseline for that channel.

`peaks` rides the same generic apply/replay machinery as `rotation`, `label`,
`reply` (see [Apply / replay lifecycle](#apply--replay-lifecycle) below) — the
only special-case is at message-load time: the replay loop writes
`existingMsg.metadata.peaks = value` (where the bubble reads from) instead of
the default `existingMsg[action] = value` (which is where rotation / label /
reply go because their renderers read top-level fields).

## Apply / replay lifecycle

The receiver applies a `sylk-message-metadata` row's `value` to its target
message identified by `messageId`. Because the wire ordering is **not
guaranteed** — the small metadata follow-up can overtake its target message,
especially when the target is a `file_transfer` whose broadcast is gated on
the SylkServer-side upload completing — every action goes through three
layers of resilience so it lands either way:

### 1. Live apply

When `saveIncomingMessage` parses a `sylk-message-metadata` body, it
synchronously calls `updateMetadataFromRemote(messageId, action, value)`.
This SELECTs the target row in `messages` by `msg_id = messageId`:

- **Target row exists** → parse its `metadata` column, mutate the right
  field (`metadata.consumed = value`, `metadata.peaks = value`, etc.),
  re-serialize, UPDATE the row, then call `updateFileTransferBubble` /
  equivalent to refresh the in-memory `state.messages` map so the chat
  re-renders. Done — the metadata row's job is over.

- **Target row missing (the metadata arrived first)** → the apply can't
  happen yet. Fall through to layer 2.

### 2. In-memory buffer

For races within the same app session, `updateMetadataFromRemote` stores
the value in `this._pendingPeaks[messageId]` (or the analogous map for
other actions) when the SELECT comes back with zero rows. When the matching
file_transfer eventually lands via `saveIncomingMessage`'s file-transfer
branch, the INSERT path calls `_applyPendingPeaks(transfer_id)` which:

1. Pops the buffered value out of `_pendingPeaks`.
2. Re-runs `updateMetadataFromRemote(transfer_id, 'peaks', value)` — the
   row now exists, so the same SQL UPDATE + bubble refresh logic from
   layer 1 fires.

The buffer is intentionally narrow (single value per `messageId`, keyed on
the transfer_id) and is cleared on apply, so it never grows unbounded.

### 3. SQL replay (durable)

The buffer is in-memory and dies with the app. For races that span an app
restart — peaks-metadata received in session A, file_transfer received in
session B, app reload in between — the metadata row's persistence handles
it.

`saveIncomingMessage` always INSERTs the metadata row into `messages` with:

- `content_type = 'application/sylk-message-metadata'`
- `metadata` column = JSON-stringified payload
- `related_msg_id = messageId` (the target)
- `related_action = action` (`'peaks'`, `'rotation'`, etc.)

Two replay paths kick in:

- **On file_transfer arrival** — `_applyPendingPeaks(transfer_id)` first
  checks the in-memory buffer (layer 2), then queries SQL with
  `WHERE related_msg_id = ? AND related_action = 'peaks' AND content_type
  = 'application/sylk-message-metadata'`. Any rows it finds are routed
  through `updateMetadataFromRemote` so the file_transfer's `metadata`
  column gets the peaks merged in once and for all.

- **On chat reload** — `getMessages` walks every row for the conversation,
  builds `messagesMetadata[messageId]` arrays from each
  `sylk-message-metadata` row, and replays them onto the matching
  in-memory message. The default handler writes `existingMsg[action] =
  value` (used by rotation / label / reply / consumed). `peaks` is
  special-cased here — the loop writes `existingMsg.metadata.peaks = value`
  because the bubble's `renderMessageAudio` reads from
  `currentMessage.metadata.peaks`, not from a top-level field.

After layer 3 the file_transfer row's SQL `metadata` column has `peaks`
embedded permanently, so future loads don't need the metadata-row replay.

### Diagnostic logging

Every layer emits `[peaks-diag]` lines when triaging a "no waveform on
receiver" report:

| Log line                                                    | Meaning                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `incoming file_transfer ... inline_peaks_in_broadcast=false`| Broadcast arrived; confirms server stripped peaks (expected).            |
| `incoming peaks-metadata ... value_ok=true value_len=...`   | Peaks-metadata follow-up arrived; confirms sender shipped it.            |
| `updateMetadataFromRemote peaks APPLIED ...`                | Layer 1 — target row existed at apply time, peaks landed.                |
| `updateMetadataFromRemote peaks BUFFERED ...`               | Layer 1 missed (target row absent), value parked in `_pendingPeaks`.     |
| `applying buffered peaks ...`                               | Layer 2 — file_transfer landed, in-memory buffer drained.                |
| `applying SQL-replayed peaks ...`                           | Layer 3 — file_transfer landed, persistent metadata row found in SQL.    |
| `updateFileTransferBubble ... has_peaks=true`               | Bubble's in-memory state now has peaks; render will show waveform.       |
| `[audio] start metadata ... has_peaks=true`                 | At play time, the bubble actually had peaks (sanity check).              |

A healthy lifecycle for a fresh peaks-bearing recording where the metadata
beats the broadcast is:

```
incoming peaks-metadata          ← arrives first (small, direct)
peaks BUFFERED                   ← target row not yet present
incoming file_transfer           ← broadcast arrives second
applying buffered peaks          ← in-memory buffer drained
peaks APPLIED                    ← SQL UPDATE writes peaks into file_transfer.metadata
updateFileTransferBubble has_peaks=true   ← bubble refreshed
```

## Notes

- Location metadata rows that aren't part of a meeting handshake get a
  7-day SQL expiry stamped on them via the `expire` column, so a force-kill
  of the app doesn't leak location ticks past their useful life.
- `metadata.action` values of `consumed` and `autoanswer` are skipped by the
  generic save path — they're treated as side-effect-only.
- The receiver side never renders a metadata row as a chat bubble directly;
  the data either updates a sibling row's state (e.g. `consumed`) or is
  rehydrated into a synthesized [`sylk-live-location`](./sylk-live-location.md)
  bubble.
- The three apply/replay layers above are deliberately idempotent — applying
  the same metadata twice (e.g. buffer drain followed by SQL replay) is a
  no-op because each layer routes through the same `updateMetadataFromRemote`
  apply path which simply writes the latest value into the target row's
  `metadata` column.
