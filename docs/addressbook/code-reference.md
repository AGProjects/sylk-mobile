# Sylk Mobile Addressbook - Code Reference

Copyright (C) 2020-2026 AG Projects B.V. (https://www.ag-projects.com)

Implementation map for the addressbook sync layer. The companion document
[`addressbook.html`](addressbook.html) explains the design and behavior; this one
maps that behavior onto the code — the functions that implement it, where they
live, and how they fit together. Section references like (Chapter 16) point back into
the design doc.

Everything described here lives in **`app/app.js`** on the root `App`
component. The cross-device data model, server contract, and reconciliation
rules are documented in `addressbook.html`; the client library surface
(`connection.addressbook`, its getters and `data*` events) is provided by
**react-native-sylkrtc** and is not part of this file.

---

## Naming conventions

- **`_ab*`** — every addressbook helper is prefixed `_ab` (e.g. `_abServerUris`,
  `_abMigrateGroups`). The prefix namespaces the layer inside the large `App`
  component and makes the addressbook surface greppable in one pass.
- **`loadPhoneAddressBook`, `_abMigrateOnce`, `_abMigratePreview`**
  — the few non-`_ab` entry points keep the established `AddressBook` (capital
  `B`) spelling used elsewhere in the codebase (`addressBookContacts`,
  `kickUnifiedSearchAddressBookLoad`). The `data*` event handlers use the `_abOn*`
  prefix (`_abOnDataLoaded`, …) to match the `_on*` handler convention in the file.
- **`R1`–`R6` tags in comments** — several helpers carry an `Rn:` marker in
  their leading comment. These are the URI-normalization / junk rules
  (`addressbook.html` Chapter 3): `R1` IP-literal domain, `R3` URI-echo name, `R4` phone
  normalization, `R5` conference anomaly, `R6` conference-domain mangling.
- **`[ab] ...` log prefix** — all addressbook console output is tagged `[ab]`
  (with sub-tags such as `[ab] [get]`, `[ab] [put]`, `[ab] [queue]`,
  `[ab] [delete]`) so a sync can be followed in the metro log.

---

## Lifecycle and entry points

On connection setup the four client-library addressbook events are bound to
the `_abOn*` handlers (and unbound first to avoid duplicate listeners):

| Event | Handler | Meaning |
|-------|---------|---------|
| `dataLoaded` | `_abOnDataLoaded` | fresh authoritative snapshot fetched |
| `dataCacheLoaded` | `_abOnDataCacheLoaded` | library served a cached snapshot (e.g. account switch-back) |
| `dataUpdated` | `_abOnDataUpdated` | fresh authoritative delta |
| `dataDeleted` | `_abOnDataDeleted` | server-authoritative contact removal |
| `dataUpdateFailed` | `_abUpdateFailed` | a write the client issued failed |

### Readiness gate and dispatch

| Function | Role |
|----------|------|
| `_abReady` | True only when the app is fully settled for the **current** account: account id set, connection ready, local contacts loaded **and stamped for this account**, `accounts.settings` committed for this account, and server data present for this account. Prevents one account's data leaking into another during a switch (Chapter 9). |
| `_abMaybeRun(source)` | Called from every readiness edge. Bails silently until `_abReady` passes; whichever edge fires last actually starts the work. On any server data it runs `syncGroupsTable` + `applySelfContactFromServer`; it only runs the migration against **authoritative** (freshly fetched) data, never a possibly-partial cache. |
| `_abOnDataLoaded` | `dataLoaded`: marks server + authoritative data present for the account, logs the pending-put queue once (Chapter 10), writes the recovery dump (Chapter 9/Chapter 20), then `_abMaybeRun('dataLoaded')`. |
| `_abOnDataCacheLoaded` | `dataCacheLoaded`: marks server data present (not authoritative), then `_abMaybeRun('dataCacheLoaded')`. |
| `_abOnDataUpdated` | `dataUpdated`: marks server + authoritative data present, then `_abMaybeRun('dataUpdated')`. |
| `_abOnDataDeleted` | `dataDeleted`: delegates to `_abApplyServerDelete`. |

The state fields `_abServerDataAccount` (any server data, cache or fresh) and
`_abAuthoritativeDataAccount` (a fresh fetch arrived) are what the gate reads to
tell a cache load apart from an authoritative one.

### OS contacts loader

| Function | Role |
|----------|------|
| `loadPhoneAddressBook` | Permission-driven loader for the **phone's OS contacts** (react-native-contacts), deferred to explicit user intent (tapping Phonebook) so the OS permission prompt only appears then. Idempotent: skips work only when permission is already authorized **and** contacts are already fetched. Distinct from the server XCAP sync above. |

---

## Migration workflow

| Function | Role |
|----------|------|
| `_abMigrateOnce(source)` | The one-time-per-account reconciliation (Chapter 9). Version-guarded by a persistent per-account marker plus an in-memory re-entrancy guard; imports/updates server contacts, puts local-only contacts, reconciles groups, applies normalization, runs in bulk mode (suppress per-contact re-render, refresh once). On a truly fresh account it enables DND for the duration of the initial sync. Guards on the cross-client `MigratedVersion` marker first: if the self XCAP contact already carries a marker `>=` the required version, it adopts it and skips the destructive reconciliation (Chapter 9). |
| `_abMigrateGroups` | Group ↔ tag convergence (Chapter 7): adopts server-group membership onto local rows, strips tags for groups deleted elsewhere (using the seen-groups baseline), and puts local-only groups up. |
| `_abConsolidateExistingUris(keepContact)` | Duplicate / URI-collision resolution support (Chapter 16.1–16.2): consolidates a shared URI onto the canonical survivor. |
| `_abMigratePreview(source)` | Dry-run of the migration that logs what **would** change without writing — the planning/diagnostic counterpart to `_abMigrateOnce`. |
| `_abApplyServerDelete(event)` | Applies a server-driven delete: drops group tags, stamps `deleted_timestamp`, and tombstones once storage is purged. Bound to `dataDeleted` via `_abOnDataDeleted` (Chapter 12, Chapter 16.3). |
| `_abMigrationVersion` | The migration version (bump to force a cross-device re-run). Compared against `accounts.ab_migration` and the self-contact marker. |
| `_abSelfServerContact()` | The server (XCAP) contact for our own account, matched by URI. Used by the privacy adopt path and the cross-client migration marker. |
| `_abWriteSelfMigrationMarker(account)` | Publishes the cross-client marker — writes `MigratedVersion = _abMigrationVersion` onto the self XCAP contact so other clients/devices skip the migration. Written on clean completion and re-published by already-migrated devices that lack it (Chapter 9, Chapter 16.4). |

---

## Live replication and the offline queue

| Function | Role |
|----------|------|
| `_abReplicateToServer(contact)` | Live put of a contact change to the server, contact first then group membership, so the contact exists before group ops reference it. |
| `_abPutLocalContactToServer(c)` | Put a local-only contact (`addContact`); on success stamps the returned server id onto the local `remote_id`. Adopts an existing server contact with the same URI rather than duplicating. |
| `_abServerContactPayload(c, id)` | Builds the server contact payload — `uris[]` (each with its own id), `default_uri`, preserved `dialog`/`presence`, name, and the `attributes` bag (Chapter 15). Mangles URIs back to the server `conference.X` form on the way out. |
| `_abFlushPendingPut(account)` | Re-puts every contact whose previous replicate failed; called on the next good sync (Chapter 10). |
| `_abUpdateFailed(e)` | `dataUpdateFailed` handler: classifies the failure — transport/5xx/408/429 retryable (queue it), 4xx permanent (drop) — using the retryable flag the server carries on the event (Chapter 10). |
| `_abPendingPutKey(account)` | Current queue key, `ab_ops_queue.<account>`. |
| `_abPendingPutLegacyKey(account)` | Legacy key `ab_pending_push.<account>`, read once and migrated forward so pre-rename writes aren't lost. |
| `_abLoadPendingPut` / `_abSavePendingPut` | Load/persist the queue (a serialized `Set` of URIs) in AsyncStorage. |
| `_abQueuePendingPut` / `_abDequeuePendingPut` | Add / remove a URI from the queue. |
| `_abLogPendingPut(account)` | Logs the queue contents once per account per run on first authoritative load (`[ab] [queue] ...`). |

### Server-call plumbing

| Function | Role |
|----------|------|
| `_abExec(label, fn)` | Promisifies a node-style `cb(err)` addressbook call so the sync code can `await` it. |
| `_abMethodTag(label)` | Derives the HTTP-method tag (`[put]`, `[delete]`, …) from an operation label for logging. |
| `_abGenerateServerId()` | Mints a server-style id: the literal `id` followed by digits. |

---

## URI normalization, mangling, and junk rules

| Function | Rule | Role |
|----------|------|------|
| `_abNormalizeUri(uri)` | R4 | Phone numbers (user part starting `+`/`0`) stored bare, without domain; otherwise lowercased/trimmed. |
| `_abIsIpDomain(uri)` | R1 | Domain is an IP literal (IPv4 or bracketed IPv6) → junk. |
| `_abIsLocalDomain(uri)` | — | URI ends in `@local` (Bonjour / LAN). |
| `_abIsConferenceAnomaly(uri)` | R5 | Conference room whose username starts with `0` → junk. |
| `_abVideoConfDomain()` | R6 | The local/Sylk conference domain (`videoconference.X`). |
| `_abSipBridgeDomain()` | R6 | The paired server SIP bridge domain (`conference.X`), a fixed client convention. |
| `_abSwapDomain(uri, from, to)` | R6 | Swap only the host between the two forms; username untouched. |
| `_abMangleConferenceDomainFromServer(uri)` | R6 | `conference.X → videoconference.X` (read / match / display). |
| `_abMangleConferenceDomainToServer(uri)` | R6 | `videoconference.X → conference.X` (write). |
| `_abNormServerUri(uri)` | R4+R6 | Mangle-from-server then normalize. |
| `_abLocalToServerUri(uri)` | R4+R6 | Normalize then mangle-to-server. |
| `_abUriUsername(uri)` | — | Extract the user part of a URI. |
| `_abIsConferenceUri(uri)` | — | True for a conference room (either bridge domain). |

---

## Contact / URI resolution

| Function | Role |
|----------|------|
| `_abServerUris(s)` | Unique lowercased list of every URI on a server contact (`default_uri` + `uris[]`), each run through `_abNormServerUri`. |
| `_abLocalContactUris(c)` | All URIs a local contact owns (primary + extras), lowercased. |
| `_abChosenDefaultUri(s)` | The server's flagged default URI, else the `uris[]` default, else `uris[0]`. |
| `_abBestUri(uris)` | Best default when none is flagged: prefer non-phone under the account domain, then any non-phone SIP, then phone, then first (Chapter 5). |
| `_abFindServerContactByUri(contact)` | Find the server contact sharing a URI with this local contact (adopt-by-URI; un-mangles conference URIs so a put adopts rather than duplicates). |

---

## Display name resolution

| Function | Role |
|----------|------|
| `_abIsUriEcho(name, uri)` | R3: name carries no real info — empty, equals the URI, the URI without `@`, or the username. |
| `_abWinningDisplayName(localName, serverName, uri)` | R3: choose the name to store — server real name wins, else local real name, else empty (Chapter 4). |
| `_abFinalDisplayName(c)` | Final stored display name for a local contact. |
| `_abServerDisplayName(s, primaryLocalUri)` | Resolved display name for a server contact (server name unless URI-echo). |
| `_abConferenceName(name, uri)` | A conference room's display name is the room number (URI username). |
| `_abCapitalizeGroup(name)` | Canonical Capitalized form for a (case-insensitive) group name. |

---

## Groups, tags, and attributes

| Function | Role |
|----------|------|
| `_abTagToGroupName(tag)` | Reserved tag → server group name (`favorite → Favorites`, `blocked → Blocked`, `tel → Tel`, `chat → Messages`); custom tags pass through. Note: `autoanswer` deliberately has **no** reserved group name — it is per-device and must never sync. |
| `_abGroupNameToTag(name)` | Reverse mapping, server group name → local tag. |
| `_abIsPurgeGroup(name)` | A server group that must be deleted from the server, never imported. |
| `_abIsPurgeTag(tag)` | A local tag mapping to a purge group. |
| `_abContactQualifiesForTag(c, tag)` | Whether a contact legitimately belongs to the group for a tag. |
| `_abNonGroupTags` | Set of per-contact flag tags excluded from group sync (`bypassdnd`, `muted`, `noread`, `history`, `caregiver`, `autoanswer`). |
| `_abDynamicLocalGroups` | Locally-authoritative dynamic groups (`calls`, `recent`). |
| `_abAutoLocalGroups` | Auto-derived categories, never user groups (`messages`, `chat`, `calls`, `recent`). |
| `_abSeenGroupsKey(account)` | AsyncStorage key for the seen-groups baseline, `ab_seen_groups.<account>`. |
| `_abLoadSeenGroups` / `_abSaveSeenGroups` | Load/persist the set of server group names this device has seen (drives offline-delete inference, Chapter 7). |
| `_abContactAttributes(c)` | The synced attribute subset of a local contact written to the server `attributes` bag. |
| `_abApplyServerAttrs(contact, s)` | Apply the server `attributes` onto a local contact — additive, tolerant of string/bool values (Chapter 6). |
| `_abRecordPendingEdit(uri, fields)` | Record an authoritative-field edit so an in-flight re-fetch doesn't revert it (Chapter 6, edit protection). |
| `_abEditProtected(uri, field, serverVal)` | True when adoption should skip a field because of a recent local edit still within `_abEditWindowMs` (30s). |

---

## PGP key save (self contact)

The account keypair is carried on the self contact's `keys` attribute so it replicates
across devices over XCAP (design: Chapter 22). The private key is symmetrically encrypted
with the account password.

| Function | Role |
|----------|------|
| `_abEnsureSelfKeys(account, options)` | Save the local keypair onto the self contact when none is present on the server; with a local keypair absent but a saved record present, falls through to restore. Idempotent and best-effort; skips when no account password is available. `options.force` re-saves even when one already exists (used on password change); `options.password` encrypts with a supplied password instead of `state.password`. |
| `_abRestoreSelfKeys(account, serverKeys)` | Decrypt the saved `private_key` with the account password and import the keypair (`savePrivateKey`), so a new/keyless device adopts the account key automatically. Logs and returns on a wrong/empty password or malformed blob. |
| `_abParseSelfKeys(selfServer)` | Parse the server self contact's `keys` attribute (JSON text) into an object, or null. |
| `_abSelfKeysAttr` | Stash (`{ acc, v }`) carried into `_abServerContactPayload` → `_abContactAttributes` so the `keys` attribute is written and preserved on later self writes. |
| `_abSelfKeysWriting` | Per-account in-flight guard preventing concurrent/duplicate save writes within a session. |

`changeSipPassword(newPassword)` calls `_abEnsureSelfKeys(account, { force: true, password: newPassword })` after the new password is committed locally, re-encrypting the saved record with the new password. The call is deferred 5s so the server commits the password before the contact update. It is best-effort: a failure is logged and does not fail the password change.

---

## Recency, diagnostics, and dumps

| Function | Role |
|----------|------|
| `_abLatestMessageTimestamp(uri)` | Latest real-message timestamp (unix seconds) for a URI, or null — drives list order (Chapter 14). |
| `_abImportTimestamp` | Fixed historic date for contacts with no message history, so pure imports sort below people you've talked to. |
| `_abDumpHistory()` | On authoritative load, snapshot the full server addressbook (contacts + groups + policies) to the account's private folder for recovery, and print the `[ab] CONTACTS` / `CONTACTS DIFF` diagnostic tables (Chapter 20). |
| `_abWriteDump(filename, text)` | Write a dump file under the account's dump dir. |
| `_abAccountDir(account)` / `_abDumpDir(account)` | Resolve the per-account private / dump directory. |
| `_abPurgeDumpDir(account)` | Remove the account's entire dump folder (on account delete). |
| `_abPurgeLegacyDump()` | One-time cleanup of legacy dump locations. |

---

## Actual workflow

1. Connection setup binds the `data*` events to the `_abOnData*` handlers.
2. A snapshot arrives → `_abOnData*` records which account the data is for and
   calls `_abMaybeRun`.
3. `_abMaybeRun` checks `_abReady`; once the last readiness edge
   passes it runs `syncGroupsTable` + `applySelfContactFromServer`, and — only
   on authoritative data — `_abMigrateOnce`.
4. The migration reconciles contacts and groups using the resolution
   (`_abFindServerContactByUri`, `_abServerUris`), normalization
   (`_abNormalizeUri`, the mangle helpers), name (`_abWinningDisplayName`), and group
   (`_abMigrateGroups`) helpers, writing through `_abServerContactPayload` /
   `_abPutLocalContactToServer` / `_abExec`.
5. Later user edits replicate live via `_abReplicateToServer`; failed writes land in the
   AsyncStorage queue (`_abQueuePendingPut`) and are retried by
   `_abFlushPendingPut` on the next good sync.

For the rules behind each step — server-authoritative precedence, dedup by
lowest id, conference mangling, offline-delete inference, the empty-snapshot
safety gate — see [`addressbook.html`](addressbook.html).
