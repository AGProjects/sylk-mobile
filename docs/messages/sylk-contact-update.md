# `application/sylk-contact-update`

Replicates a contact-book edit (add / rename / re-tag / remove) across the
user's own devices.

- **Direction**: self only — sent from the device that did the edit to its
  own account URI.
- **Encrypted**: yes — same PGP path as text messages.
- **Persistence**: not retained as a chat row; the journal-replay path
  deletes the SQL row after applying it (see `app.js` around line 14347:
  `'application/sylk-contact-update' → contact.totalMessages-- ; DELETE
  from messages WHERE msg_id = ?`).

> Note: in the current source the receive handlers
> `handleReplicateContact` / `handleReplicateContactSync` are placeholder
> stubs that immediately `return` (`app.js` around line 22930). The wire
> format below is what the senders produce; the receive logic that
> consumes it has been intentionally left unimplemented for now.

## Body shape

The decrypted `content` is a JSON-stringified contact object. The contact
shape mirrors the `contacts` SQLite table — the same one
`saveSylkContact` / `updateSylkContact` operate on. Roughly:

| Field             | Type                | Notes |
| ----------------- | ------------------- | ----- |
| `id`              | string (UUID)       | Stable contact id; survives URI changes. |
| `uri`             | string              | Primary URI. |
| `uris`            | string[]            | Secondary URIs (alias addresses). |
| `name`            | string              | Display name. |
| `email`           | string              | Optional. |
| `tags`            | string[]            | `favorite`, `blocked`, `chat`, `noread`, `bypassdnd`, `muted`, `autoanswer`, `caregiver` … |
| `localProperties` | object              | Per-device settings; only flags meant to roam (e.g. `caregiver`) end up replicated. |
| `lastCallMedia`   | string              | `audio` / `video` / empty. |
| `unread`          | string[]            | Pending-read message ids. |
| `timestamp`       | number (ms epoch)   | Last-update vector clock. |

## Example payload

```json
{
  "id": "5d4e3f2a-1b0c-9d8e-7f6a-5b4c3d2e1f0a",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "application/sylk-contact-update",
  "content": "-----BEGIN PGP MESSAGE-----\n…\n-----END PGP MESSAGE-----"
}
```

Decrypted body (the JSON-stringified contact):

```json
{
  "id":   "0c2d4e6f-1a3b-5c7d-9e0f-2b4d6f8a0c1e",
  "uri":  "bob@sip2sip.info",
  "uris": [],
  "name": "Bob (work)",
  "email": "bob@example.org",
  "tags": ["favorite", "chat"],
  "localProperties": { "caregiver": false },
  "lastCallMedia": "audio",
  "unread": [],
  "timestamp": 1746609240000
}
```

## Notes

- Edits triggered through the `editContact` and `chat` origins call
  `replicateContact(contact)`; that's the only entry point that produces a
  `sylk-contact-update` envelope.
- Because the edits are applied to local state synchronously and only
  *then* replicated, the wire envelope is also the source of truth for
  rebuilding state on a fresh sibling device that wasn't connected at
  edit time.
