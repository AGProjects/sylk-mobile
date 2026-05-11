# sylkserver: `session-dtmf-info` request handler

> **Status: implemented in-tree.** This document is preserved as a
> reference for the protocol contract. The actual code lives in
> sylkserver/sylk/applications/webrtcgateway/{models/sylkrtc.py,
> models/janus.py, janus.py, handler.py}. Search those files for
> `SessionDtmfInfoRequest`, `SIPDtmfInfo`, `sendDtmfInfo`, and
> `_RH_session_dtmf_info`.

## What this is

The sylk-mobile app now offers a "SIP INFO" DTMF mode in Preferences. When
selected, every digit press emits a websocket request of type
`session-dtmf-info` to sylkserver. The server is expected to forward the
digit to the Janus SIP plugin's built-in `dtmf_info` API, which in turn
emits a SIP INFO request inside the active dialog with body
`Content-Type: application/dtmf-relay`.

This is the canonical PSTN-trunk DTMF path. It bypasses RTP entirely
and avoids libwebrtc 124's broken RFC 4733 packetisation. Asterisk
with `dtmfmode=auto` (or `info`) picks it up reliably; PSTN gateways
that don't trust RTP-band DTMF accept it directly.

## Wire format — request from client

The websocket frame from sylk-mobile looks exactly like every other
sylkrtc request: a JSON object with a `sylkrtc` discriminator and a
sylkserver-managed transaction id. sylkrtc's existing `_sendRequest`
machinery wraps the request — server only needs to handle the
discriminator value `session-dtmf-info`.

Payload fields:

```json
{
  "sylkrtc": "session-dtmf-info",
  "session": "<session-uuid>",
  "digit":   "<single-character>",
  "duration": 200
}
```

| Field      | Type     | Description                                  |
|------------|----------|----------------------------------------------|
| `session`  | UUID str | The Sylk session UUID (matches the existing  |
|            |          | `session-create` / `session-trickle`         |
|            |          | request keying — same handle table)          |
| `digit`    | char     | A single character: `0`–`9`, `*`, `#`,       |
|            |          | `A`–`D` (the latter four rare but RFC-valid) |
| `duration` | int (ms) | Tone duration. Default 200 ms client-side.   |

## Wire format — response to client

Standard sylkrtc ack:

```json
{ "sylkrtc": "ack", "transaction": "<id>" }
```

Or on error:

```json
{
  "sylkrtc": "error",
  "transaction": "<id>",
  "error": "<short error reason>"
}
```

The client (sylkrtc `Call.sendDtmfInfo`) doesn't propagate ack/error
to the UI — DTMF is fire-and-forget by spec — but does DEBUG-log
errors. So a sane error message helps debugging but isn't
user-visible.

## Server behaviour

For each `session-dtmf-info` request:

1. Look up the session by `session` UUID. Reject with
   `"unknown session"` error if not found.
2. Verify the session is in a media-flowing state (the sylkserver-
   side equivalent of `established`). Reject with
   `"call not active"` if not — the SIP INFO can't be sent inside
   a non-existent dialog.
3. Send a Janus plugin message to the SIP plugin on the Janus
   handle bound to this session:

   ```json
   {
     "janus": "message",
     "session_id": <janus-session-id>,
     "handle_id":  <janus-handle-id>,
     "transaction": "<your-server-transaction-id>",
     "body": {
       "request":  "dtmf_info",
       "digit":    "5",
       "duration": 200
     }
   }
   ```

   This is the documented Janus SIP plugin command:
   <https://janus.conf.meetecho.com/docs/sip>, search for
   `dtmf_info`.

4. The Janus plugin emits an in-dialog SIP INFO toward the SIP
   peer with:

   ```
   INFO sip:peer@... SIP/2.0
   ...
   Content-Type: application/dtmf-relay
   Content-Length: 22

   Signal=5
   Duration=200
   ```

5. Acknowledge back to the websocket client.

## Implementation hints

- The handler should look almost identical to the existing
  `session-trickle` handler in shape — same dispatch path, same
  session lookup, same response shape. Wire it next to that one.
- Error paths should NOT terminate the call — DTMF failures are
  benign. Log + reply with `error`.
- The Janus SIP plugin's `dtmf_info` requires the SIP session to
  be in `incall` / established state. If you're routing the call
  through the sip-via-rtpforward variant, double-check the plugin
  variant supports `dtmf_info` (the standard `janus.plugin.sip`
  does).

## Client-side reference

Look at:

- `node_modules/react-native-sylkrtc/lib/call.js` —
  `Call.sendDtmfInfo(digit, duration)` (search for "sendDtmfInfo").
- `app/CallManager.js` — `sendDTMF` `'info'` branch.
- `app/app.js` — `callKeepSendDtmf` mode dispatch.
- `app/components/PreferencesModal.js` — `DTMF_OPTIONS` array, the
  `value: 'info'` entry.

## Once deployed

When sylkserver ships the handler, the client side is ready: users
can pick "SIP INFO" in Preferences → DTMF and digits route through
the new path automatically. No app rebuild required (it's all JS).
