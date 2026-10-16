# `application/sylk-messages-bulk-delete`

"Delete everything that matches these criteria, on every device of the
account." A device sends this after the user deletes messages in bulk by
criteria (type, action, contact, period), for example in the Data manager of
Blink. Every other device of the account that receives it erases what matches
in its own history.

- **Direction**: self. The device sends
  `application/sylk-api-messages-bulk-delete` to its own account URI.
  SylkServer stores it once in the account's journal as
  `application/sylk-messages-bulk-delete` and relays it to every device of
  the account, the sender's included.
- **Encrypted**: no. It is a control payload, and the server reads it.
- **Persistence**: not retained as a chat row. It is acted on, live or from
  the journal, and then dropped.

This document is the spec for implementing it in Sylk Mobile, both receiving
it and, optionally, sending it. Blink Qt implements both sides; see
[Reference implementation](#reference-implementation).

---

## 1. Flow

On the deleting device, in this order:

1. The user picks a type, a contact and a period (all three required) and
   presses Delete. Blink asks no confirmation; a checkbox "Also delete them
   from my other devices", checked by default, decides whether step 2 runs.
2. **Before anything else**, it sends the bulk delete message (section 3).
   The user asked for these messages to go, so the other devices are told
   even if the server removal in step 3 fails or is stopped.
3. It removes the ids from the server journal with `POST …/remove`
   (section 5), in batches of at most 1000. Accounts without a SylkServer
   journal skip this step and delete locally only.
4. After each batch, it erases the rows locally.

Deleting one message is not a bulk delete: Blink's Data manager shows a
Delete This Message button with the selected message, which sends the
ordinary `sylk-api-message-remove` to the contact.

On every other device: when the message arrives, it erases what matches
(section 4).

## 2. Body shape

The body is `JSON.stringify(payload)`, the same string on the API request and
on the relayed message:

```json
{
  "v": 1,
  "bulk_delete_id": "6f1c2b8e-1d70-4d1b-a4ef-0d8b3f0d7d2d",
  "device_id": "c359a142-6669-48ad-81c8-de2d1af12396",
  "timestamp": "2026-10-11T11:37:12.000Z",
  "criteria": {
    "content_type": "application/sylk-message-metadata",
    "action": "location",
    "contact": "florig@sylk.link",
    "from": "2026-05-01T03:00:00.000Z",
    "until": "2026-06-01T03:00:00.000Z"
  },
  "files": true,
  "cascade": true
}
```

| Field | Type | Notes |
|---|---|---|
| `v` | int | 1. |
| `bulk_delete_id` | string | A new UUID per deletion. The server uses it as the journal entry's message id. |
| `device_id` | string | The sending device. A receiver whose own device id equals this ignores the message: it is its own echo. On mobile, use `this.deviceId`. |
| `timestamp` | string | When the deletion was made, ISO 8601 UTC with milliseconds and `Z`. |
| `criteria` | object | See below. |
| `files` | bool | Also erase the downloaded files of the matching file transfers. |
| `cascade` | bool | Also erase the rows filed against the matching ones by `related_msg_id`, recursively (section 4, step 4). |

### Criteria

| Field | Required | Matches |
|---|---|---|
| `category` | exactly one of `category` / `content_type` | The persisted `category` column, only for `text`, `image`, `audio`, `video`, `other`, `call`. Never `location` (see below). |
| `content_type` | | The wire content type, lowercase, e.g. `application/sylk-message-metadata` or `application/sylk-location-sharing`. |
| `action` | no; only with `content_type` | The row's action (section 4, step 3). Location sharing: `location_start`, `location_update`, `location_stop`, `location_once`, `location_request`, `meeting_request`, `meeting_start`, `meeting_accept`, `meeting_reject`, `meeting_end`, `location`. Metadata: `reply`, `label`, `peaks`, `consumed`, `rotation`, `call_recording`, `location`, `location_request`, `conference_request`, …; `encrypted` for a body still PGP ciphertext with no `related_action` |
| `contact` | yes | The other party, `user@domain`. On mobile: `from_uri` for incoming rows, `to_uri` for outgoing ones, matched against every URI of that contact (`getAllContactUris`). |
| `from` | yes | Message time ≥ this, ISO UTC. |
| `until` | yes | Message time < this, ISO UTC: the end of the period, or the deletion's own `timestamp` if that is earlier. |

Rules:

- **Criteria only, never message ids.** A bulk delete always covers the whole
  selection the filters make. Single messages are deleted in the conversation
  (`sylk-message-remove`). A receiver ignores a bulk delete whose `criteria`
  carries `ids`.
- **Type, contact and period are all required.** Exactly one of `category`
  or `content_type`, plus `contact`, `from` and `until`. A mistake can then
  only reach one kind of message, with one contact, in one period. A receiver
  ignores a message that breaks this rule.
- **Location is always selected by `content_type`.** Clients disagree on
  categories here. Mobile gives the origin of a share, and metadata location
  origins, the category `location`; Blink gives metadata rows no category at
  all. A receiver must therefore match `content_type` and `action` only, and
  never look at `category`, when `content_type` is set.
- **The sender turns its local period into UTC bounds.** A local year, month or
  day becomes `[from, until)` in UTC, so devices in other time zones select the
  same rows. For example, May 2026 in UTC−3 is
  `2026-05-01T03:00:00.000Z` .. `2026-06-01T03:00:00.000Z`.
- **`action: "encrypted"` is a criterion.** It is what the user selected:
  the rows of that type whose action cannot be read on the receiving device,
  because the body is still PGP ciphertext and there is no `related_action`.
  Rows this device has already decrypted have a readable action and do not
  match.

## 3. Sending (mobile)

```js
this.state.account.sendMessage(
    this.state.account.id,                      // to your own account
    JSON.stringify(payload),
    'application/sylk-api-messages-bulk-delete');
```

SylkServer intercepts this content type in `account-message` (websocket,
`handler.py` `_RH_account_message`) and in SIP (`sip_handlers.py`). It does
not store it as a chat message and does not send it to anyone else. Instead it
calls `relay_bulk_delete`, which does three things:

- stores `application/sylk-messages-bulk-delete` in the account's journal;
- sends it over SIP to the account's SIP devices (Blink);
- posts it to every websocket session of the account as an ordinary incoming
  `message` event with `contentType: 'application/sylk-messages-bulk-delete'`.

The server refuses a bulk delete addressed to any URI other than the sender's
own account.

## 4. Receiving (mobile)

It arrives in two places:

- **Live**: `incomingMessageFromWebSocket` (from `account.on('incomingMessage')`).
- **From the journal**: `_syncConversations`. Give it its own branch next to
  the `sylk-message-remove` and `sylk-conversation-remove` branches. Do not
  derive `uri` from it and do not create a contact for it. It is addressed to
  the account itself.

In both places:

1. **Parse and check.** Parse the content. Drop it unless `criteria` is an
   object that passes the rules above.
2. **Skip the echo.** If `payload.device_id === this.deviceId`, stop.
3. **Select** the account's rows. Include rows already marked deleted: they
   are erased too.
   ```sql
   SELECT msg_id, content_type, category, related_action, related_msg_id, content, local_url, from_uri, to_uri, direction
     FROM messages
    WHERE account = ?
      AND (category = ?            -- only when criteria.category
           OR lower(content_type) = ?)  -- only when criteria.content_type
      AND (from_uri IN (?...) OR to_uri IN (?...))  -- criteria.contact, all URIs of that contact
      AND unix_timestamp >= ?      -- criteria.from (seconds)
      AND unix_timestamp <  ?      -- criteria.until (seconds)
   ```
   - `unix_timestamp` is in seconds on mobile. Convert the bounds with
     `Math.floor(new Date(x).getTime() / 1000)`. Rows written without it
     (`unix_timestamp = 0`) fall back to parsing `timestamp`.
   - When `criteria.action` is set, keep only the rows whose **action** equals
     it. The action is `related_action` when it is set; it is in clear even
     when the body is encrypted. Otherwise it is the `action` key of the
     plaintext JSON body. A row whose body is still PGP ciphertext and has no
     `related_action` has the action `encrypted`: it matches
     `action: "encrypted"` and nothing else. Use the decrypted content: mobile
     keeps plaintext in `content` once decrypted.
4. **Cascade** (when `payload.cascade`). Add every row whose `related_msg_id`
   is the `msg_id` of a selected row. Repeat for the newly added rows until
   nothing new is found. This takes along:
   - the `location_update` and `location_stop` ticks of a deleted share start;
     their `related_msg_id` is the start's id, the same as the cleartext
     `sessionId`;
   - the `reply`, `label`, `peaks` and `call_recording` sidecars of a deleted
     message.

   The cascade only goes downward. Deleting ticks never deletes their start.
5. **Erase.** Run `DELETE FROM messages WHERE account = ? AND msg_id IN (…)`
   in chunks. These are real deletes, not `deleted = 1`. Nothing is kept
   pending: a matching message that arrives later is either newer than
   `until`, or was removed from the server journal and will not arrive. When
   `payload.files`, also delete the local files of the file transfers among
   them (`local_url`, thumbnails, decrypted copies), as `deleteMessage` does
   for one transfer.
6. **Refresh once** for all the rows, not once per row:
   - remove them from `this._messagesMap()` / the open chat,
   - recompute `lastMessage` / `lastMessageId` of the affected contacts,
   - recompute unread counts,
   - refresh the thumbnail grid, if open.

   Nothing is notified and nothing counts as unread.
7. **Log one line**, for example:
   `Bulk delete <bulk_delete_id>: erased 2365 rows (application/sylk-message-metadata · location, florig@sylk.link, 2026-05-01 .. 2026-06-01) on request of <device_id>, live`.

The same bulk delete reaches a device twice: live, then again on the next
journal sync. It also replays on every full resync. The second run selects
nothing, so no bookkeeping is needed. To spare the query, you can keep the
`bulk_delete_id`s already applied in AsyncStorage.

Do **not** apply the conversation-remove "floor guard" to this type. A bulk
delete is bounded by its own `until`, so replaying an old one cannot remove
anything newer than it.

## 5. Removing from the server journal (sender only)

```
POST <server>/webrtcgateway/messages/history/<account>/remove
Authorization: Apikey <journal token>
Content-Type: application/json

{"ids": ["<msg_id>", ...], "progress": 100}
```

- **Batch size.** At most 1000 ids per request. Send the ids of every row
  being erased, cascaded rows included.
- **What is removed.** Only this account's rows with those ids. No tombstone,
  no notification to anyone, and the peer keeps its copy. There is no
  location-session cascade here: send every tick yourself.
- **Shared transfer files.** A transfer's file is stored once on the server
  and both parties' rows point to it. Removing a file-transfer row deletes the
  file only when the other party's journal no longer has that transfer id.
- **Answer without `progress`.** One JSON object:
  `{"ok": true, "requested": N, "removed": [ids]}`.
- **Answer with `"progress": N`.** JSON lines (`application/x-ndjson`): first
  `{"done", "removed", "total"}` every N ids, then the object above. Read the
  answer as a stream to drive a progress bar. If you close the connection, the
  server stops at the next id.
- **Errors.** 404 or 405 means the server has no bulk removal: stop and tell
  the user, and do not fall back to one request per id. 401 means the token
  was refused. 400 means a bad body or more than 1000 ids.
- **The token.** Mobile syncs over the websocket and has not needed this token
  so far. Blink obtains it by sending `application/sylk-api-token`, body
  `Token request`, to its own account. SylkServer answers with a message of
  the same type whose body is `{"token": "…", "url": "<…/messages/history/<account>>"}`;
  the remove URL is `url + '/remove'`. **Verify that this request works over
  the websocket `account-message` path before relying on it.** If it does
  not, add a websocket request that returns the token.

## 6. Building the selection on mobile (sender, optional UI)

If mobile gets its own bulk delete screen (the Data manager in Blink), its
filters narrow each other in any order, each showing counts:

| Filter | Values |
|---|---|
| Type | `category` for categorized rows, `location` for every `application/sylk-location-sharing` row, otherwise `content_type` |
| Action | under location sharing and the uncategorized types; `encrypted (action unknown)` is announced as `action: "encrypted"` |
| Contact | |
| Year → Month → Day | in local time |

There is no picking rows by hand: Delete always takes the whole selection.
Map the selection to criteria like this:

- **Type `location`**: `content_type: 'application/sylk-location-sharing'`.
- **A category** among `text`, `image`, `audio`, `video`, `other`, `call`:
  `category`.
- **Anything else**: `content_type` with that type.
- **Action**: only with `content_type`.
- **Contact**: as selected.
- **Period**: `from` is its start, `until` is `min(end of period, now)`.

Do not offer Delete until a type, a contact and a year, month or day are all
chosen.

Expand the selection with the cascade (section 4, step 4) before deleting,
and show what goes with it. For example: "153 messages;
5529 related messages go too: location_update 5399, location_stop 130".

## 7. Testing

1. **Blink to mobile, live.** On a Blink Qt with the Data manager, delete
   Location sharing · `location_start` for one contact and one day. The phone,
   online, logs the bulk delete. Its map bubbles and their trails for that day
   are gone, and other days are untouched.
2. **Blink to mobile, offline.** Repeat with the phone offline. On reconnect,
   `_syncConversations` applies it.
3. **Mobile to Blink.** Send a bulk delete from mobile. The Blink Activity log
   shows `[data] Bulk delete of N rows … on request of <mobile device id>, live`.
4. **Echo.** The sending phone ignores its own echo, both live and from the
   journal.
5. **Missing scope.** A payload missing the type, the contact, `from` or
   `until` is ignored and logged.
6. **Time zones.** Put the phone in a different time zone from Blink and check
   that the same rows are deleted.

## Reference implementation

Blink Qt (`~/work/blink-qt`):

| File | What it holds |
|---|---|
| `blink/data_manage.py` | `classify()`, `bulk_delete_payload()`, `bulk_delete_criteria()`, `criteria_matches_action()`, `with_related()`, `period_bounds()`, `remove_from_journal()` (streaming client) |
| `blink/datawindow.py` | The Data manager UI and the send → `/remove` → erase sequence |
| `blink/messages.py` | `send_messages_bulk_delete()`, `apply_messages_bulk_delete()` (live and journal) |
| `blink/history.py` | `bulk_delete()`, `_with_related_rows()`, `_erase_rows()` |
| `docs/messaging/messages-bulk-delete.md` | This protocol from Blink's side |

SylkServer, `webrtcgateway/`:

| File | What it holds |
|---|---|
| `web.py` | `/messages/history/<account>/remove` |
| `storage.py` | `removeMessages()`, `release_transfer_files()` |
| `sip_handlers.py` | `_handle_messages_bulk_delete()`, `relay_bulk_delete()` |
| `handler.py` | `_RH_account_message` intercept for websocket clients |
