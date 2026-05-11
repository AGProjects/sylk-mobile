# `application/sylk-file-transfer`

File / image / audio / video attachment. The actual file bytes are uploaded
to the file-transfer service over HTTPS; the chat envelope only carries the
metadata describing the upload so the receiver can fetch and render it.

- **Direction**: both
- **Encrypted**: file bytes are encrypted at rest on the file-transfer
  service via PGP encryption to the recipient. The chat envelope itself is
  treated as plaintext for the purposes of `sendMessage` (the encrypt path
  in `sendMessage` explicitly excludes file-transfer because the file
  service handles encryption out of band).
- **Persistence**: stored in `messages` with
  `content_type = 'application/sylk-file-transfer'`. The `metadata` column
  carries the JSON shown below; `content` carries the user's optional
  caption text.

## Body shape

A JSON object describing the upload. The exact set of fields evolves with
the upload lifecycle:

| Field         | Type            | Notes |
| ------------- | --------------- | ----- |
| `transfer_id` | string (UUID)   | Same as the message `_id`; used as the file's address on the service. |
| `filename`    | string          | Display filename. PGP-encrypted attachments may end in `.asc`. |
| `filetype`    | string (MIME)   | `image/jpeg`, `audio/mp4`, `application/pdf`, … |
| `path`        | string \| null  | Sender-local absolute path before upload. Null after upload completes. |
| `local_url`   | string \| null  | Receiver-local cached path once downloaded. |
| `url`         | string          | HTTPS URL on the file-transfer service: `<fileTransferUrl>/<sender>/<receiver>/<transfer_id>/<filename>`. |
| `sender`      | `{uri}`         | Source URI. |
| `receiver`    | `{uri}` \| null | Destination URI; null on the sender's draft state. |
| `direction`   | `"outgoing"` \| `"incoming"` | Set by the sender / receiver respectively. |
| `fullSize`    | boolean         | If `false`, image is downscaled before upload (mirror of the user's "resize content" toggle). |
| `paused`      | boolean         | Set true while transfer is paused. |
| `failed`      | boolean         | Set true on permanent failure. |
| `error`       | string \| null  | Error reason when `failed`. |
| `until`       | ISO8601 \| null | Optional self-destruct deadline on the file-service side. |

## Example payloads

### Outgoing — image attachment

Envelope that the sender writes locally and then ships:

```json
{
  "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "application/sylk-file-transfer",
  "content": "Cat photo 🐱",
  "metadata": {
    "transfer_id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "filename":    "cat.jpg",
    "filetype":    "image/jpeg",
    "path":        "/Users/.../tmp/cat.jpg",
    "sender":      { "uri": "alice@sip2sip.info" },
    "receiver":    { "uri": "bob@sip2sip.info" },
    "direction":   "outgoing",
    "fullSize":    false,
    "paused":      false,
    "failed":      false,
    "error":       null,
    "until":       null
  }
}
```

### After upload completes

```json
{
  "metadata": {
    "transfer_id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "filename":    "cat.jpg",
    "filetype":    "image/jpeg",
    "path":        null,
    "local_url":   null,
    "url":         "https://files.sylk.example/alice@sip2sip.info/bob@sip2sip.info/c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f/cat.jpg",
    "sender":      { "uri": "alice@sip2sip.info" },
    "receiver":    { "uri": "bob@sip2sip.info" },
    "direction":   "outgoing",
    "fullSize":    false,
    "paused":      false,
    "failed":      false
  }
}
```

### Incoming — audio note

```json
{
  "metadata": {
    "transfer_id": "9b8a7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4",
    "filename":    "voice-note.m4a",
    "filetype":    "audio/mp4",
    "url":         "https://files.sylk.example/bob@sip2sip.info/alice@sip2sip.info/9b8a7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4/voice-note.m4a",
    "local_url":   "/data/data/com.sylk.app/files/alice@sip2sip.info/bob@sip2sip.info/9b8a7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4/voice-note.m4a",
    "sender":      { "uri": "bob@sip2sip.info" },
    "receiver":    { "uri": "alice@sip2sip.info" },
    "direction":   "incoming"
  }
}
```

## Notes

- Audio attachments don't auto-fire a `displayed`
  [IMDN](./imdn.md) on chat-open; the client waits until the user actually
  presses Play, then calls `markAudioMessageDisplayed()`.
- `application/sylk-file-transfer` counts as a "real" exchange for the
  bidirectional-chat gate (alongside `text/plain` and `text/html`).
- The companion `application/sylk-message-metadata` `action: "consumed"`
  payload is sent back to the sender once the file has been viewed/played.
  See [`sylk-message-metadata.md`](./sylk-message-metadata.md#consumed).

## Custom fields and the SylkServer broadcast

The `metadata` shown above is what the **sender's local SQL** stores. When
the sender uploads the file, SylkServer rebuilds the wire envelope from a
**fixed allow-list** of fields it knows about:

> `filename`, `filesize`, `sender`, `receiver`, `transfer_id`, `timestamp`,
> `until`, `url`, `filetype`, `hash`

Any client-stamped field outside this list is **dropped** by the broadcast.
This includes `duration`, `peaks`, `call_recording`, `call_recording_party`,
and the like. To get such fields across to the recipient, ride the
`application/sylk-message-metadata` follow-up channel, which lets you attach
arbitrary data to a `transfer_id` via the `messageId` field.

The current actions that piggyback on this pattern are:

- `consumed` — playback / view receipt for the file. See
  [`sylk-message-metadata.md`](./sylk-message-metadata.md#consumed).
- `peaks` — per-100ms amplitude waveform for audio recordings. See
  [`sylk-message-metadata.md`](./sylk-message-metadata.md#peaks).

Receivers handle the **wire-ordering race** (the small follow-up can
overtake the broadcast, especially since the broadcast is gated on the
upload completing) via a three-layer apply/replay machinery — live apply,
in-memory buffer, and SQL-row replay. See
[Apply / replay lifecycle](./sylk-message-metadata.md#apply--replay-lifecycle)
in the metadata doc for the full picture.
