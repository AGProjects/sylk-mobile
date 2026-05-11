# Message Content Types

Sylk Mobile carries every chat-layer payload over the same SIP MESSAGE / WSS
`message` envelope. The receiver branches on the `contentType` field of that
envelope to decide how to render, store, or act on the payload. This directory
documents every content type the client sends or accepts.

The transport envelope (the part that's identical for every type) looks
roughly like this on the wire:

```json
{
  "id": "9d9cf2b4-1d70-4d1b-a4ef-0d8b3f0d7d2d",
  "sender":   { "uri": "alice@sip2sip.info", "displayName": "Alice" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "<one of the values below>",
  "content":     "<string body — see per-type doc>",
  "dispositionNotification": ["positive-delivery", "display"]
}
```

Bodies for non-key/control payloads may arrive PGP-encrypted: the `content`
string is wrapped in `-----BEGIN PGP MESSAGE----- … -----END PGP MESSAGE-----`
and the receiver decrypts with its private key before parsing. The decrypted
plaintext is what each per-type doc describes.

## Index

| Content type                              | Direction | Encrypted | Purpose                                                |
| ----------------------------------------- | --------- | --------- | ------------------------------------------------------ |
| [`text/plain`](./text-plain.md)           | both      | yes       | Regular chat text                                      |
| [`text/html`](./text-html.md)             | both      | yes       | Rich-text chat                                         |
| [`text/pgp-public-key`](./pgp-public-key.md)               | both | no  | Publish your PGP public key                            |
| [`text/pgp-private-key`](./pgp-private-key.md)             | self | yes | Multi-device private-key sync (account → own devices)  |
| [`text/pgp-public-key-imported`](./pgp-public-key-imported.md) | self | no | Notify own devices that a private key was imported     |
| [`application/sylk-file-transfer`](./sylk-file-transfer.md)   | both | yes | File / image / audio / video attachment                |
| [`application/sylk-message-metadata`](./sylk-message-metadata.md) | both | yes | Out-of-band metadata about another message (location ticks, "consumed", per-contact toggles, audio waveform peaks) |
| [`application/sylk-live-location`](./sylk-live-location.md)   | local | n/a | Synthetic UI bubble — never sent on the wire           |
| [`application/sylk-contact-update`](./sylk-contact-update.md) | self | yes | Replicate contact edits across own devices             |
| [`application/sylk-message-remove`](./sylk-message-remove.md) | both | no  | Delete a single message everywhere                     |
| [`application/sylk-conversation-remove`](./sylk-conversation-remove.md) | both | no | Delete an entire conversation                  |
| [`application/sylk-conversation-read`](./sylk-conversation-read.md) | self | no | Mark a conversation as read on own devices             |
| [`message/imdn`](./imdn.md)               | both      | no        | Delivery / read / error receipts                       |

## Conventions used in the per-type docs

- **Direction** — *both* = sent and received between any two parties; *self* =
  the user sends it to their own account URI to fan out to sibling devices;
  *local* = generated client-side only, never reaches the wire.
- **Encrypted** — whether the `content` is PGP-encrypted before transmission.
  Control / key-exchange payloads are sent in plaintext on purpose.
- **Body shape** — what the receiver sees inside `message.content` after any
  PGP decryption. JSON-shaped bodies are pretty-printed in the examples; on
  the wire they're sent as compact `JSON.stringify(...)` output.
- **Persistence** — what the client writes to its local SQLite `messages`
  table for the row, if anything.
