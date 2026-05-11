# `application/sylk-conversation-remove`

"Delete an entire conversation." Generated when the user removes a contact's
chat history on one device.

- **Direction**: both — primarily fanned out to the user's own devices, but
  the server drops its server-side history copy too.
- **Encrypted**: no.
- **Persistence**: not retained. Same SQL-cleanup branch as
  [`message-remove`](./sylk-message-remove.md) — straggling rows are deleted
  on chat restore.

## Body shape

The decrypted `content` is the bare peer URI string (no JSON wrapping). The
journal-replay branch uses `uri = message.content` directly:

```js
} else if (message.contentType === 'application/sylk-conversation-remove') {
    uri = message.content;
}
```

## Example payload

```json
{
  "id": "9e0d1c2b-3a4f-5e6d-7c8b-9a0f1e2d3c4b",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "application/sylk-conversation-remove",
  "content": "bob@sip2sip.info"
}
```

## Notes

- The receiver only honours the request if
  `messageTimestamp > contact.timestamp` — i.e. the remove is newer than
  any local activity. If the contact has messages dated *after* the remove
  request, the local copy wins. This protects against a stale remove
  arriving late from a slow/disconnected sibling device and wiping out
  legitimate newer messages.
- Outgoing wire production goes through
  `account.removeConversation(uri, callback)` (see the `replayJournal`
  branch with `op.action === 'removeConversation'`).
