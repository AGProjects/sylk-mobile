# `application/sylk-conversation-read`

"Mark this conversation as read on my other devices." Sent when the user
reads a conversation on one device so siblings can clear their unread
badges and dot-indicators in lockstep.

- **Direction**: self only — addressed to the user's own account URI; the
  peer never sees these.
- **Encrypted**: no.
- **Persistence**: not retained as a chat row. The replay path applies the
  side-effect (`contact.unread = []`) and then deletes the SQL row on the
  next chat restore.

## Body shape

Like [`conversation-remove`](./sylk-conversation-remove.md), the decrypted
`content` is the bare peer URI string. The journal-replay branch reads it
straight:

```js
} else if (message.contentType === 'application/sylk-conversation-read') {
    uri = message.content;
}
```

## Example payload

```json
{
  "id": "2f3e4d5c-6b7a-8c9d-0e1f-2a3b4c5d6e7f",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "application/sylk-conversation-read",
  "content": "bob@sip2sip.info"
}
```

## Notes

- Produced by `account.markConversationRead(uri, callback)` via the
  `op.action === 'readConversation'` branch in `replayJournal`.
- Excluded from the bidirectional-chat gate and the journal export filter
  alongside the other control types: see `excludedContentTypes` in
  `syncConversations`.
