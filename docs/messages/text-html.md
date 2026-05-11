# `text/html`

Rich-text / HTML chat body. Used when the sender forwards or composes content
that needs limited markup (links, line-breaks, basic formatting).

- **Direction**: both
- **Encrypted**: yes — same PGP rules as `text/plain`.
- **Persistence**: stored in `messages` with `content_type = 'text/html'`.
  ContactsListBox renders it through `utils.cleanHtml(content)` for the
  preview line and through the chat bubble's HTML renderer for the body.

## Body shape

The decrypted `content` is a UTF-8 HTML fragment (not a full document). The
client whitelists tags before rendering — never trust arbitrary HTML
end-to-end.

## Example payload

Decrypted body:

```html
<p>Hi Bob,</p>
<p>The notes are here: <a href="https://example.com/notes">notes</a>.</p>
<p>— A.</p>
```

Wire envelope:

```json
{
  "id": "8b0c3a92-2dab-49aa-b86b-1bd3f3e1d6c1",
  "sender":   { "uri": "alice@sip2sip.info" },
  "receiver": "bob@sip2sip.info",
  "timestamp": "2026-05-07T09:14:30.000Z",
  "contentType": "text/html",
  "content": "-----BEGIN PGP MESSAGE-----\n…\n-----END PGP MESSAGE-----",
  "dispositionNotification": ["positive-delivery", "display"]
}
```

## Notes

- Like `text/plain`, the contact's `chat` tag is added on first send/receive.
- HTML messages count as "real" exchanges for the bidirectional-chat gate
  used by location sharing — see `realContentTypes` in `app.js`
  (`['text/plain', 'text/html', 'application/sylk-file-transfer']`).
