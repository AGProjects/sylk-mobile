# `application/sylk-live-location`

A *synthetic* content type. It never travels on the wire — the wire format
for live-location sharing is `application/sylk-message-metadata` with
`action: "location"` (see
[`sylk-message-metadata.md`](./sylk-message-metadata.md#location)). The
client mints `application/sylk-live-location` locally so the chat bubble
renderer and the metadata filter can tell location bubbles apart from other
metadata rows.

- **Direction**: local-only (never sent or received).
- **Encrypted**: n/a.
- **Persistence**: appears in the in-memory `state.messages[uri]` list as a
  GiftedChat-shaped bubble. The corresponding SQL row is the
  `application/sylk-message-metadata` origin tick — there's no separate
  `application/sylk-live-location` row in the database.

## Body shape

This is a UI bubble, not a wire payload. The relevant shape is the JS
object the client builds:

```js
const bubble = {
  _id:         metadataContent.messageId,    // origin tick's UUID
  key:         metadataContent.messageId,
  createdAt:   new Date(metadataContent.timestamp),
  contentType: 'application/sylk-live-location',
  metadata:    metadataContent,              // the full sylk-message-metadata body
  text:        String(createdAt.getTime()),  // bumped per tick to bust memoization
  direction:   'incoming' | 'outgoing',
  user:        direction === 'incoming' ? { _id: peerUri, name: peerUri } : {},
  pending:     direction === 'outgoing',
  sent:        direction !== 'outgoing',
  received:    false
};
```

## Example

```json
{
  "_id":         "f2c4e6a8-1b3d-5e7f-9a0c-2e4f6a8c0e2d",
  "key":         "f2c4e6a8-1b3d-5e7f-9a0c-2e4f6a8c0e2d",
  "createdAt":   "2026-05-07T09:14:00.000Z",
  "contentType": "application/sylk-live-location",
  "direction":   "incoming",
  "user":        { "_id": "bob@sip2sip.info", "name": "bob@sip2sip.info" },
  "metadata": {
    "action":     "location",
    "messageId":  "f2c4e6a8-1b3d-5e7f-9a0c-2e4f6a8c0e2d",
    "metadataId": null,
    "value": {
      "latitude":  52.370216,
      "longitude": 4.895168,
      "accuracy":  12,
      "timestamp": "2026-05-07T09:14:00.000Z"
    },
    "expires":   "2026-05-07T13:14:00.000Z",
    "timestamp": "2026-05-07T09:14:00.000Z",
    "uri":       "bob@sip2sip.info"
  },
  "text":     "1746609240000",
  "pending":  false,
  "sent":     true,
  "received": false
}
```

## Notes

- `text` is intentionally a string version of `createdAt.getTime()` — every
  tick rewrites it so ChatBubble's `React.memo` detects the change and
  re-renders the marker on the map.
- `application/sylk-live-location` short-circuits the bidirectional-chat
  gate used by location sharing: a single live-location bubble counts as
  both an outgoing and incoming exchange. This is intentional so a
  receive-only "until I return" share doesn't hide the share button after
  the share ends.
- `buildLastMessage()` returns `null` for both `sylk-live-location` and
  `sylk-message-metadata` so location ticks never overwrite the contact's
  last-message preview.
