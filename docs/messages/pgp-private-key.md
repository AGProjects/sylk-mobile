# `text/pgp-private-key`

Multi-device private-key sync. Lets the user export the private key from one
of their own devices and import it on another, so all their devices can
decrypt the same conversation history.

- **Direction**: self only — sender and receiver are the same account URI.
  The receiver path is gated on
  `message.sender.uri === this.state.account.id`.
- **Encrypted**: yes — the private key blob is symmetrically encrypted with a
  user-supplied passphrase before transmission. `content` is the
  `encryptedBuffer` produced by the export flow.
- **Persistence**: not stored as a chat row. Incoming payloads are routed
  into `handleRemotePrivateKey(message.content)`, which prompts the user
  for the passphrase and then installs the decrypted key.

## Body shape

The `content` is an opaque, passphrase-encrypted blob (Base64 / armoured —
the format is whatever `OpenPGP.encrypt(...)` produces in the export step).
The receiver doesn't parse it directly; the password modal hands it back to
OpenPGP for decryption.

## Example payload

```json
{
  "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "alice@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "text/pgp-private-key",
  "content": "-----BEGIN PGP MESSAGE-----\n\nwy4ECQMI…\n=AbCd\n-----END PGP MESSAGE-----"
}
```

## Notes

- A successful import on the receiving device also fans out
  [`text/pgp-public-key-imported`](./pgp-public-key-imported.md) to other
  devices on the account so they can refresh their UI.
- The receive path is silently dropped if `message.sender.uri` isn't the
  account's own URI — defends against a peer trying to inject a private
  key into the user's keychain.
