# `message/imdn`

Instant Message Disposition Notification (IMDN, RFC 5438). Carries
delivery, display, and error receipts for previously-sent messages.

- **Direction**: both — the receiver of a message produces an IMDN that
  flows back to the original sender. The user's own devices also see
  these so each device's "delivered / read" tick state stays in sync.
- **Encrypted**: no.
- **Persistence**: never stored as a chat row. The chat-restore loop
  explicitly deletes any `message/imdn` rows that ended up in SQL from
  older write paths (`app.js` line ~14355). Live IMDN flips columns on
  the *target* row (`received` 0 → 1 for delivered, 1 → 2 for displayed)
  rather than inserting its own row.

## Body shape

IMDN is delivered through sylkrtc's higher-level
`account.sendDispositionNotification(uri, id, timestamp, state, cb)` API,
so the client doesn't hand-craft the wire body. The salient fields the
client passes in / observes:

| Field        | Type                                           | Notes |
| ------------ | ---------------------------------------------- | ----- |
| `uri`        | string                                         | Original sender's URI (where the receipt is going). |
| `id`         | string                                         | `msg_id` of the message being acknowledged. |
| `timestamp`  | ISO8601                                        | Original message's timestamp. |
| `state`      | `"delivered"` \| `"displayed"` \| `"error"`    | The receipt kind. |
| `wireSend`   | boolean (internal flag)                        | When true, force a wire IMDN even for `sylk-message-metadata` (used for location-share origin ticks so the sender sees the share land). |
| `save_only`  | boolean (internal flag)                        | When true, only update local SQL, don't transmit. |

## Example payload

The shape an incoming IMDN takes when sylkrtc surfaces it to the app:

```json
{
  "id": "4b5c6d7e-8f9a-0b1c-2d3e-4f5a6b7c8d9e",
  "sender":   { "uri": "bob@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:30.000Z",
  "contentType": "message/imdn",
  "content": {
    "messageId": "f3d7a14e-8b62-4f70-9d0c-2e5e7c2c9a44",
    "state":     "displayed",
    "datetime":  "2026-05-07T09:14:30.000Z"
  }
}
```

## States

| `state`     | Meaning                                                                   | Local effect                                       |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `delivered` | Receiver's account got the message; not necessarily seen by a human yet.  | `messages.received = 1` on the original row.       |
| `displayed` | Message has been rendered on a foregrounded chat (or audio Play pressed). | `messages.received = 2`. Updates the double-tick.  |
| `error`     | Receiver couldn't decrypt or process the message.                         | Surfaced in the bubble's status; original stays `received = 1` (or whatever it was). |

## Suppression rules

- `sylk-message-metadata` rows do **not** trigger a wire IMDN by default
  (sender doesn't need a receipt for every location follow-up tick).
  Origin ticks override this with `wireSend: true`.
- Per-contact `noread` tag suppresses outgoing `displayed` IMDN for that
  contact — the local row is still flipped to `received = 2` so the user
  sees their own "read" state.
- The account-wide "Read receipts" off switch (`state.readReceipts ===
  false`) suppresses `displayed` globally; `delivered` continues to flow.
- Audio file-transfer rows skip the chat-open auto-`displayed` IMDN; the
  receipt is sent only when the user presses Play
  (`markAudioMessageDisplayed`).
