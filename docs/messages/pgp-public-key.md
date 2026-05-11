# `text/pgp-public-key`

Publishes a PGP public key. Sent in two situations:

1. As a self-message from the account to itself (`receiver === sender.uri`)
   to upload the public key onto the server, where peers can fetch it.
2. As a message between peers when they explicitly exchange keys.

- **Direction**: both
- **Encrypted**: no — plaintext, by design. The body *is* the key.
- **Persistence**: not stored as a chat row. Incoming keys are routed into
  `savePublicKey(sender.uri, message.content)` and kept in the per-contact
  key cache.

## Body shape

The decrypted `content` is an ASCII-armoured OpenPGP public key block.

## Example payload

```json
{
  "id": "3c9c5a2e-31f0-4b56-be72-3e7e3f0d4d99",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:00.000Z",
  "contentType": "text/pgp-public-key",
  "content": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQENBGRf...\n=Tj9p\n-----END PGP PUBLIC KEY BLOCK-----\n"
}
```

## Notes

- The receiver's general PGP encrypt path explicitly skips encrypting outgoing
  `text/pgp-public-key` payloads — sending an encrypted key would defeat
  the bootstrap. See the `message.contentType !== 'text/pgp-public-key'`
  branch in `sendMessage`.
- Keys arriving on the WSS path log
  `[pubkey-recv] websocket arrival from <uri>` — useful for debugging key
  delivery.
