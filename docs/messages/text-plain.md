# `text/plain`

Regular chat text. The default content type for `sendMessage()` when no
explicit type is supplied.

- **Direction**: both
- **Encrypted**: yes — encrypted to the recipient's PGP public key when one is
  known and the local key pair is available; otherwise sent as plaintext (the
  client also flips `encrypted=0` in SQL for that row).
- **Persistence**: stored in the `messages` SQLite table with
  `content_type = 'text/plain'`.

## Body shape

The decrypted `content` is the user-typed string, exactly as entered. No
JSON wrapping, no metadata.

## Example payload

Outgoing envelope (encrypted body shown elided):

```json
{
  "id": "f3d7a14e-8b62-4f70-9d0c-2e5e7c2c9a44",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "text/plain",
  "content": "-----BEGIN PGP MESSAGE-----\n…\n-----END PGP MESSAGE-----",
  "dispositionNotification": ["positive-delivery", "display"]
}
```

Decrypted body the receiver renders:

```
Hi Bob — see you at the meeting at 3pm.
```

## Notes

- The contact's `chat` tag is added on first incoming or outgoing
  `text/plain` (or `text/html`) so the conversation shows up in the chat
  list. See `app.js` around the journal-replay branches for the gate.
- For "Photo"/"Audio"/"File" previews, see
  [`application/sylk-file-transfer`](./sylk-file-transfer.md). `text/plain`
  is for typed text only.
