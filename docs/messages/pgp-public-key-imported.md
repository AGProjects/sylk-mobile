# `text/pgp-public-key-imported`

Notification that a PGP private key was imported on another device. Used so
sibling devices on the same account can update their "key in sync" indicator
without duplicating the private-key transmission.

- **Direction**: self only — fanned out from the device that just imported
  the key to its own account URI.
- **Encrypted**: no.
- **Persistence**: not stored. The chat-restore path explicitly drops these
  with a `continue` when it encounters them in the local SQL backlog.

## Body shape

A short human-readable string. There's no structured schema — the receiver
doesn't parse the body, only the content type.

## Example payload

```json
{
  "id": "7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:30.000Z",
  "contentType": "text/pgp-public-key-imported",
  "content": "Private key imported on another device"
}
```

## Notes

- See `app.js` line ~10642:
  `this.state.account.sendMessage(this.state.accountId, 'Private key imported on another device', 'text/pgp-public-key-imported');`
