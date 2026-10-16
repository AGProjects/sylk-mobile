# Sylk Mobile Addressbook - Code Reference

Copyright (C) 2020-2026 AG Projects B.V. (https://www.ag-projects.com)

Implementation map for the addressbook sync layer. The companion document
[`addressbook.html`](addressbook.html) explains the design and behavior; this one
maps that behavior onto the code — the functions that implement it, where they
live, and how they fit together. Section references like (Chapter 16) point back into
the design doc. The last two sections map the same behavior in **sylk-desktop** and the
**Blink / python3-sipsimple** changes it relies on (Chapter 27).

Everything described here lives in **`app/app.js`** on the root `App`
component, except the naming rules: the spelling of addresses, echo names, and
group kinds live in **`app/addressbookRules.js`**. That file is pure, and
sylk-desktop uses it verbatim (see *Shared rules file* below). The cross-device data model, server contract, and reconciliation
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
| `loadPhoneAddressBook` | Permission-driven loader for the **phone's OS contacts** (react-native-contacts), deferred to explicit user intent (tapping Phonebook) so the OS permission **prompt** only appears then. Idempotent: skips work only when permission is already authorized **and** contacts are already fetched. Distinct from the server XCAP sync above. |
| `_abAdoptPhonebookNames()` | Startup read of the phonebook for name adoption, at the end of the heal. Prompting is user intent, **reading is not**: this calls `Contacts.checkPermission()` (which never shows a dialog) and reads only when already `authorized`. `abPermissionDenied` short-circuits ahead of even that check (Chapter 25.7). |
| `_abPhonebookRead` | Set only by a **successful** `getABContacts()`. `addresBookLoaded` is not a substitute — it is also raised on a denial, to stop the retry loop. |
| `_abApplyPhotosToContacts()` | Applies phonebook photo, email **and name** over the loaded contacts. Guarded on *any* of the three maps being populated, not on `avatarPhotos` alone — cards with names and no thumbnails used to abort the pass and take the name adoption with it. |

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
| `_abServerContactPayload(c, id)` | Builds the server contact payload — `uris[]` (each with its own id), `default_uri` (the gateway stores it as `defaultUri`), preserved `dialog`/`presence`, name, and the `attributes` bag (Chapter 15). Mangles URIs back to the server `conference.X` form on the way out. |
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

## Shared rules file

`app/addressbookRules.js` holds every rule that must come out the same on every
client (Chapter 25.1). `src/app/addressbookRules.js` in sylk-desktop is the same file;
change it here and copy it there. `test_addressbook_rules.cjs` pins the spellings
with vectors.

- **What the account supplies.** `create(context)` binds the rules that depend on the
  account. `context` gives `defaultDomain`, `defaultConferenceDomain`, `pstnRules`
  and `onPstnCanon`, and each field is read at call time. `App._abRules` passes getters
  over `this.state`, plus `getEffectivePstnRules()` and `_abLogPstnCanon`.
- **What stays the same in `app.js`.** The `_ab*` members listed in the tables below
  are one-line delegates to the module, so every call site is unchanged. The group
  tables (`_abGroupKinds`, `_abTagForKind`, `_abReservedIdForKind`,
  `_abReservedGroupKeys`, `_abNonGroupTags`, `_abAutoLocalGroups`,
  `_abDynamicLocalGroups`) are the module's objects.
- **Phone-number helpers.** `utils.isPhoneNumber`, `utils.stripTelScheme`,
  `utils.pstnWireUriToE164` and `utils.stripTrunkZeroAfterCountryCode` also
  delegate to the module. There is one copy of each.

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
| `_abServerUris(s)` | Unique canonical list of every URI on a server contact (the chosen default + `uris[]`), each run through `_abNormServerUri`. |
| `_abLocalContactUris(c)` | All URIs a local contact owns (primary + extras), lowercased. |
| `_abChosenDefaultUri(s)` | The server's `defaultUri` (`default_uri` also read), else the `uris[]` entry flagged default, else `_abBestUri` of `uris[]`. The gateway (`webrtcgateway/models/xcap.py`) accepts `default_uri` on input but only ever sends `defaultUri`, filled with `uris[0]` when the document names none; reading `default_uri` alone never saw it (Chapter 2). |
| `_abBestUri(uris)` | Best default when none is flagged: prefer non-phone under the account domain, then any non-phone SIP, then phone, then first (Chapter 5). |
| `_abFindServerContactByUri(contact)` | Find the server contact sharing a URI with this local contact (adopt-by-URI; un-mangles conference URIs so a put adopts rather than duplicates). |

---

## Display name resolution

| Function | Role |
|----------|------|
| `_abIsUriEcho(name, uri)` | R3: name carries no real info — empty, equals the URI, the URI without `@`, the username, or any `+`/`00` **phone variant** of those. The variant arm is what stops `0034913336701` being pushed up as a name over `+34913336701`. |
| `_abNameIsEcho(name, uri)` | The same test from the local contact's side; an empty name counts as an echo, which is what makes adoption "into a hole" (Chapter 25.5). |
| `_abNameForContact(uri)` | The OS phonebook's name for an address, tried against the URI, then every `_phoneNumberVariants` spelling, then the bare username. |
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
| `_abNonGroupTags` | Set of per-contact flag tags excluded from group sync (`bypassdnd`, `muted`, `noread`, `history`, `caregiver`, `autoanswer`, `phone`, `email`). `email` is here so no Email group is ever generated again (Chapter 24.5). |
| `_abDynamicLocalGroups` | Locally-authoritative dynamic groups (`calls`, `recent`). |
| `_abAutoLocalGroups` | Auto-derived categories, never user groups (`messages`, `chat`, `calls`, `recent`). Superset of `_abDynamicLocalGroups`. |
| `_abGroupKinds` | The kinds this client understands: `calls`, `tel`, `blocked`, `conference`, `missed`, `favorites` (Chapter 5b). |
| `_abTagForKind` | kind → the local tag that represents membership. Note the **singular** `favorite`. |
| `_abReservedIdForKind` | kind → the id a group of that kind is CREATED with (`_calls`, `_tel`, `_blocked`, `_conference`, `_missed`, `_favorites`) — Chapter 5b.1. |
| `_abReservedGroupKeys` | Reserved server id → reconcile key, including both spellings of Favorites (`favorites` and `_favorites`) so the migration can cross between them. |
| `_abGroupKey(g)` | The reconcile key for a server group: **kind → reserved id → canonical name**. What makes a rename survivable. |
| `_abGroupIsShared(g)` | `!!_abGroupKind(g)` — a kind means another client owns the group, so the heal must never delete it (Chapter 23). |
| `_abIsDeviceLocalGroup(key, g)` | `_abAutoLocalGroups.has(key) && !_abGroupKind(g)` — the negation that stopped this client deleting Blink's Calls group. |
| `_abIsDeviceLocalName(key)` | The same question for a group not on the server yet, where only the name can answer: create the categories we know a kind for, never the purely derived ones. |
| `_abCreateGroup(ab, name, members, why)` | Create a group, pinning the reserved id for its kind. Gates on a snapshot, then re-checks live `kind` and reserved id before writing, so two devices racing produce one group. |
| `_abMigrateReservedIds(ab)` | Delete-and-re-create the special groups under their reserved ids. Bounded to three attempts and reads the **live** `ab.groups` each pass — a pre-stamp snapshot silently skips groups stamped in the same pass. |
| `_abApplyServerDelete(...)` | Applies a server group deletion. Ignores it when a surviving group shares the deleted group's key: a fold is a merge, not a removal (Chapter 5b.2). |
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

## Startup repairs

Every one of these has a counterpart in Blink desktop running the same rule; a
repair only one client performs is undone by the other (Chapter 24).

| Function | Role |
|----------|------|
| `_abCanonicalPstn(uri)` | Phone-number URI → bare E.164, with an 8-digit floor so short codes are left alone (Chapter 24.3). |
| `_abApplyLeadingZeroRule(...)` | The trunk-zero-after-country-code rule, shared with desktop's `pstn_apply_leading_zero_rule`. |
| `_abLogPstnCanon(...)` | Prints what the canonicalisation changed. |
| `_abServerConferenceUri(uri)` | Unconditional `videoconference.X` → `conference.X` at the server boundary; this client never uploads the other form (Chapter 24.1). |
| `_abCanonicalServerContact(s)` | Canonical URIs plus echo-name healing for one server contact — a room becomes its **room number**, not its whole address (Chapter 24.2). |
| `_abNormalizePstnContacts(ab, sContacts)` | The generalised drift pass: PSTN URI, conference domain (compared by **domain**, not whole address), echoed name — one walk over the server contacts. |
| `_abFileIntoKindGroup(ab, kind, canonName, wanted, why)` | File contacts into a kinded group. The rule is derived from the URI, not from a tag, so it is self-correcting. |
| `_abFileConferenceContacts(...)` | The conference case of the above. **Repair before filing** — the first version filed unrepaired `videoconference.` rows into Conference. |
| `_abRepairAddressNames()` | Local-only repair for rows whose name is the contact's own **full address** (`gogo@sylk.link` on `gogo@sylk.link`). Nothing writes a name that way deliberately, so the shape is a reliable signature; self-limiting, since after the rewrite the name has no `@` left to match. Names that echo only the *username* (`harb`, `king`) are deliberately left alone (Chapter 25.5). |

---

## Origin stamps

Who changed an entry and when (Chapter 26). Pure logic in **`app/addressbookOrigin.js`**,
pinned against Blink's fingerprints by `test_addressbook_origin.cjs`.

| Function | Role |
|----------|------|
| `_abInstallOriginStamping(ab)` | Wraps `addContact` / `updateContact` / `addGroup` / `updateGroup` on the addressbook instance, once. Reads the server's copy first, then sends `abOrigin.stampPayload(...)`. |
| `_abExecWhy(reason, label, fn, change)` | `_abExec` with `modified_reason` set for exactly that write. |
| `_abWithReason(reason, fn)` / `_abCurrentWriteReason()` | The synchronous reason slot; falls back to the `_abCtx` sub-tag (`migrate`). |
| `_abLogOrigins(account)` | On `dataLoaded` / `dataUpdated`: diff against `ab_origin_snapshot.<account>` and log `[ab] [origin]` lines. Serialised on `_abOriginChain`. |
| `abOrigin.contactFingerprint` / `groupFingerprint` | The shared fingerprint (Chapter 26.3). |
| `abOrigin.stampPayload(kind, payload, previous, opts)` | Stamp on a content change, carry the previous stamp otherwise; returns a copy. |
| `abOrigin.describeOrigin` / `diffDocument` / `formatChanges` | The receive side (Chapter 26.4). |

---

## Change notifications

`app/addressbookNotify.js` is the `application/sylk-addressbook-update` wire format and
its throttles. sylk-desktop has the same file (Chapter 27.6).

| Function | Role |
|----------|------|
| `abNotify.buildTick` / `parseTick` / `CONTENT_TYPE` | Tick payload out and in. |
| `abNotify.SendThrottle` / `FetchScheduler` | Coalesce outgoing ticks; schedule the refetch a received tick asks for. |
| `_abNoteChange(change)` | Called by `_abExec` after a write the server confirmed, when the caller passed a `change`. Heals and copies pass none (Chapter 25.4). |
| `_abArmNotify` / `_abFlushNotify` / `_abSendNotify(tick)` | Wait until `_abNotifySettled` (no write in flight, no reconcile running), then send the tick to the own account, `skipJournal`, `skipDisposition`. |
| `handleAddressbookNotify(message)` | A tick from another device: parse, add its ids to `_abFetchWanted`, arm `_abFireNotifyFetch`. Ticks are dropped from the message paths and never stored. |

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
| `_abDumpContactStore(source)` | Every row of the local `contacts` table after migration + heal + adoption, once per run. Reads **SQL**, not `state.allContacts`: a row that never reached memory is the one worth seeing. Echo names are flagged `(echo)`, unreplicated rows as `remote=<local-only>`. The `uris` column is a comma-separated string, not JSON (Chapter 25.8). |
| `[ab] [kind]` group dump | Every server group with its members named, six per line, capped at 60. An unresolvable member id prints as `<id>`. |

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

---

## sylk-desktop

sylk-desktop follows the same rules (Chapter 27). All files are in `src/app/`; each pure
module has a standalone `test_*.cjs` in the repository root.

### Shared and account files

| File | Role |
|------|------|
| `addressbookRules.js`, `addressbookOrigin.js`, `addressbookNotify.js` | Verbatim copies of the sylk-mobile files. Change them in sylk-mobile, then copy. |
| `addressbookAccountRules.js` | `addressbookRules.create()` bound to `config.domain`, `config.defaultConferenceDomain` and the effective PSTN rules. Also exports `getEffectivePstnRules`, `get/setReplaceLeadingZero`, `cleanReplaceLeadingZero`, `DEFAULT_PSTN_RULES`. |
| `pstnPreferences.js` | `load` / `save` / `clear` of the per-account **Replace 0 with** value (`pstnReplaceLeadingZero-<account>`). Edited in `components/PhoneNumbersModal.js` (⋮ menu → Phone numbers); `config.js` supplies `pstn.rules` (default `{replacePlus: '00'}`). |

### Write boundary (`AddressbookProvider.tsx`)

| Function | Role |
|----------|------|
| `installOriginStamping(addressbook, agent)` | Wraps `addContact`, `updateContact`, `addGroup`, `updateGroup`, `deleteContact`, `deleteGroup`: build the payload (`contactPayload.forServer`), stamp it (`abOrigin.stampPayload`), and tell the notifier once the server answers. |
| `withAddressbookReason(reason, fn)` | Sets `modified_reason` for the writes `fn` makes. Exposed on the ref as `withReason`. |
| `loadOriginDeviceId()` | The persistent device id (`addressbookOriginDeviceId`). |
| `logOrigins(addressbook, account)` | `[ab] [origin]` lines for each fetched document, as `_abLogOrigins`. |
| `observeDeletes(addressbook, account)` | Feeds each authoritative document to the tombstones. |
| `scheduleStartupHeal` / `runStartupHeal` / `healWrite` | Once per account per run, `HEAL_SETTLE_MS` (15 s) after the first document, announcements suppressed: contact repairs, then kind-group filing. Each write times out after `HEAL_WRITE_TIMEOUT_MS`. |
| `fileIntoKindGroups` | Files a contact this client created into Tel / Conference once the server has it. |
| `flushQueue` | Replays the offline queue through `offlineQueue.decide`, reason `offline-queue`. |
| ref additions | `withReason`, `adoptsDisplayName`, `isDeleted`, `tombstonesReady`, `isAddressbookUpdate`, `receiveAddressbookUpdate`; the `onContactsChanged` prop. Types in `types/Addressbook.ts`. |

### Rule modules

| File / function | Role |
|-----------------|------|
| `contactIndex.js` — `ContactIndex(rules)` | Map-like index keyed by `normServerUri` of every owned address. `add`, then `seal` orders owners lowest id first; `best(uri)` prefers the owner whose default it is (Chapter 16.1). |
| `contactPayload.forServer(contact, existing, rules, {keepRealName})` | The server payload: canonical, de-duplicated addresses, server URI ids reused, `tel`/`sip` types (others kept), one default in `defaultUri`, dialog / presence / attributes carried from `existing`. An automatic write never replaces a real server name with an echo. |
| `contactPayload.nameReplacement(name, addresses, rules)` | Port of Blink's `echoed_name_replacement` (Chapter 24.2): a room becomes its number, a number in another spelling becomes the number, an old spelling follows the address, a SIP contact named by its own full address is left alone, and the result must be no worse. `echoSpellings` lists the spellings it compares. |
| `contactPayload.cachedRealName` / `adoptsDisplayName` | A display name is adopted only into a hole (Chapter 25.5). |
| `conversationContacts.js` — `skipReason(uri, {contacts, accountId, deleted})` / `claim` | Whether a conversation may create a contact: `no-address`, `bonjour`, `ip-literal`, `conference-anomaly`, `guest`, `anonymous`, `own-account`, `known`, `deleted`, `pending` (claimed in the last 30 s). |
| `addressTombstones.js` — `use` / `load` / `observe` / `has` / `forgive` | Inferred deletes against the persisted seen-baseline (Chapter 7). The first document is a baseline; an empty document after a non-empty one is ignored (Chapter 11). |
| `kindGroups.js` — `kindsFor` / `findGroup` / `filingWrites` / `filingWritesForAll` | Kind from the URI; group found by kind → reserved id → name; a missing group is created under its reserved id. |
| `addressbookNotifier.js` — `writeStarted` / `receive` / `isTick` / `suppress` / `resume` / `attach` | The desktop counterpart of `_abNoteChange` and `handleAddressbookNotify`, built on `addressbookNotify.js`. Refetches with `Addressbook.refresh()`. |
| `conversationRemoves.js` — `decide` / `park` / `release` / `newestMessageMs` | Chapter 16.3: apply a remote remove only when the contact is gone; park a live remove up to `PARK_MS` (10 min); drop a journal remove for a live contact or one older than the newest message. |
| `addressbookHeal.js` — `planContactRepairs` / `planFiling` | The startup heal plans; the provider executes them. |
| `offlineQueue.js` — `baseFor(addressbook, id)` / `decide(op, {current, contacts, rules, deviceId})` | Records the server copy's fingerprint when an op is queued; on replay returns `send`, `applied`, `gone`, `overtaken` or `exists`. Old entries without a fingerprint replay only when no other device has stamped the contact. |

### `app.js`

| Place | Role |
|-------|------|
| `updateAddressbook` | Waits for `tombstonesReady`, then `addConversationContacts` through `conversationContacts.claim`. |
| `incomingMessage` / `outgoingMessage` / `sendingMessage` / `syncConversations` | Drop addressbook ticks; `incomingMessage` honours one only from the own account. Also carries the incoming-message crash fix. |
| `remoteRemoveConversation` / `contactsChanged` | Route remote removes through `conversationRemoves`; release parked removes when contacts change. |
| `originAgent` prop, `pstnPreferences` load / clear | Agent string for the stamps; per-account PSTN preference lifecycle. |

### sylkrtc.js

Edited in place in `node_modules/sylkrtc/lib/`, to be ported to the sylkrtc.js repo:

| Addition | Role |
|----------|------|
| `Account.fetchAddressbook(cb)` | Public refetch over the guarded `_fetchAddressbook(cb)`. |
| `Addressbook.refresh(cb)` | Refetch; the result arrives as an ordinary `dataLoaded`, `cb` is called once. |
| `sendMessage(..., {skipJournal, skipDisposition})` | Ticks are neither journalled nor acknowledged. |

---

## Blink and python3-sipsimple

| Where | Role |
|-------|------|
| `sipsimple/account/xcap/__init__.py` — `applying_remote_document()` / `is_applying_remote_document()` | Thread-local flag set while a server document is applied. Every `XCAPManagerDid*` notification carries `data.remote`. |
| `sipsimple/addressbook.py` — `_applying_remote_document`, `_remote_originated` | Enters the xcap flag and marks `_internal_save` / `_internal_delete` from a non-local originator. |
| Blink `SMSWindowManager._abNoteXCAPChange` | Returns on `data.remote`, so a copy of another device's change is not announced (Chapter 25.4). |
| Blink `AddressbookOrigin.py` | Stamps and fingerprints, byte-identical to `addressbookOrigin.js`; installed from `SIPManager`, reasons via `@AddressbookOrigin.with_reason`. |
