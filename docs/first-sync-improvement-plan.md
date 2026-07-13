# First-sync improvement — design & patch plan

Status: proposal for review. No code changed yet.

## Goal

Make the first journal sync on a fresh phone *feel* instant: show the newest
messages first, push older history to the background, quieten the per-row
logging that bloats the sync, and tell the user once when their recent
messages have landed.

Baseline measured from `metro.log` (fresh emulator boot, 2026-06-30):

| Phase | Duration |
|---|---|
| Journal fetch (download + write 34 files) | ~24 s |
| Journal **processing** (apply 34 files oldest→newest) | **~83 s** |
| Per-row `Process journal N of 500` log lines emitted | ~10,000+ |

The user stares at a populating/old-first list for ~83 s while ~10k log lines
stream over the bridge. The four changes below address that without touching
the download path or the message-correctness pipeline.

---

## Where the code lives

All in `app/app.js` unless noted.

- `_runSyncConversations(messages)` — line ~29909. Downloads batches, writes
  journal files, then the **apply loop** (line ~30295) reads each file and
  calls `_syncConversations`.
- Apply loop: `cachedJournals.sort()` (ascending = oldest→newest), per-file
  read → `_syncConversations(_journalMessages, file, finishedFirstSync)` →
  `unlink` → `saveLastSyncId(...)` checkpoint. Lines ~30295–30359.
- `_syncConversations(messages, file, firstSync=false)` — line ~30378. The
  per-message loop. The loud per-row log is line ~30488.
- `afterFirstSync()` — line ~4925. Already the "first sync finished" hook.
- Banner UI: `app/components/ContactsListBanners.js` (presentational) rendered
  by `app/components/ReadyBox.js` line ~3181.
- Prop-flow pattern to copy (for the banner): `app.js` holds
  `state.contactsSyncing` → `<ReadyBox contactsSyncing={...}>` (line ~45856) →
  `<ContactsListBanners contactsSyncing={this.props.contactsSyncing}>`.

---

## Change 1 — quiet per-row logging during first sync

**What:** the user clarified point 1 means *skip the per-row `console.log`s*,
not the SQL/pipeline.

`_syncConversations` already receives `firstSync`. Gate the in-loop logs on it.

Line ~30488, inside the message loop:

```js
// before
if (message.contentType === 'text/plain' || message.contentType === 'text/html') {
    console.log('Process journal', i, 'of', messages.length, message.id, direction, message.contentType, uri);
}

// after
if (!firstSync && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
    console.log('Process journal', i, 'of', messages.length, message.id, direction, message.contentType, uri);
}
```

Also gate the other per-row `console.log`s in the same loop on `!firstSync`
(the `Skip incoming/outgoing message for uri`, `Skip broken journal message…`,
`Skipping unread increment`, `Skip blocked contact` lines). Keep a single
per-file summary line (`Sync N journal messages from <file>`) so first sync is
still observable — just not 10k lines deep.

**Note (separate, optional win):** `DIAG_AGGREGATE_JOURNAL = true` at line
~29942 runs a *second* full pass over every batch, including
`OpenPGP.decrypt(...)` on metadata entries, purely for diagnostics. Flipping it
to `false` removes a real chunk of first-sync CPU. Flagged for your call; not
required by this plan.

**Risk:** none functional — logging only. `firstSync` is already plumbed.

---

## Change 2 + 3 — newest journal first, older ones in the background

Files are named `${timestamp}-${id}.json`, so `cachedJournals.sort()` ascending
is strictly oldest→newest. Today the loop applies them in that order, so the
newest (what the user wants to read) lands *last*, ~83 s in.

**The hazard:** the per-file `saveLastSyncId(lastMessage.id, true, lastMessage.timestamp)`
checkpoint (line ~30342) advances a **monotonic-forward cursor** — it
explicitly blocks regressions (`lastSyncId regress BLOCKED`, line ~3382). If we
apply the newest file first and checkpoint it, every older file afterward
regresses the cursor and gets blocked — the exact bug the existing comments
(lines ~30264–30271) warn about.

**Strategy — isolate the change to the first-sync path only:**

The durable download-head is already persisted before the loop at line ~30271
(`saveLastSyncId(this.lastServerJournalId, …, durableOnly=true)`), so "what to
fetch on resume" does **not** depend on the per-file checkpoints. During first
sync the on-disk files themselves are the resume unit (un-applied files survive
a crash and are re-read by `readDir`). That lets us reorder safely:

```js
const cachedJournals = await RNFS.readDir(journalDirectory);
cachedJournals.sort();                       // oldest → newest

let applyOrder = cachedJournals;
if (finishedFirstSync && cachedJournals.length > 1) {
    const newest = cachedJournals[cachedJournals.length - 1];
    const older  = cachedJournals.slice(0, -1);   // still oldest → newest
    applyOrder = [newest, ...older];              // newest FIRST, then backfill
}
```

Then in the loop, **suppress the per-file `saveLastSyncId` while
`finishedFirstSync` is true** (the head checkpoint at 30271 already covers
fetch-resume; the per-file save is what fights the reorder). For continuing
(non-first) syncs, keep today's behaviour byte-for-byte: oldest→newest +
per-file checkpoint.

After the newest file is applied, hand control back to the event loop (the loop
already does `setTimeout(0)` yields every 5 messages via `SYNC_YIELD_EVERY`) so
the contact list re-renders with recent conversations *before* the older files
churn. The remaining files then apply as background work in the same loop.

**Why correctness holds when newest applies first:** the per-message handler
already guards contact mutations with `_origTs` — a contact is only updated by a
message *newer* than its current last-activity. So applying newest-first sets
each conversation's last-message/timestamp correctly, and the older backfill
messages (all older than what's already applied) will **not** regress it. Unread
tallies and message rows are keyed by message id, so insertion order doesn't
change the final state — only the order things appear on screen.

**Risk (the #1 test item):** the cursor/resume interaction. Verify (a) a clean
first sync ends with the SQL cursor at the true head, (b) killing the app
mid-backfill and relaunching resumes from the on-disk files with no
re-download and no `regress BLOCKED` spam, (c) a *second* launch (returning
device, `lastSyncId` set) still uses the unchanged oldest→newest + per-file
path.

---

## Change 4 — one-time "storage up to date" banner

**Trigger:** when the newest-first file finishes applying during first sync
(i.e. right after Change 2's first iteration), not when all 34 finish.

### 4a. State + trigger in `app.js`

Add state near `firstSyncPending` (line ~1633): `storageUpToDateBanner: false`.

In the apply loop, immediately after the first iteration completes when
`finishedFirstSync && i === 1`, fire once:

```js
if (finishedFirstSync && i === 1 && !this._storageBannerShown) {
    this._storageBannerShown = true;            // guard: once per first sync
    this.setState({ storageUpToDateBanner: true });
    setTimeout(() => this.setState({ storageUpToDateBanner: false }), 10000);  // 10s auto-hide
}
```

`this._storageBannerShown` (instance flag, not state) prevents re-showing on
continuing syncs or reloads within the session.

### 4b. Thread the prop

`app.js` `<ReadyBox …>` (line ~45739): add
`storageUpToDate={!!this.state.storageUpToDateBanner}`.

`ReadyBox.js` `<ContactsListBanners …>` (line ~3181): add
`storageUpToDate={this.props.storageUpToDate}`.

### 4c. Render the banner

In `ContactsListBanners.js`, destructure `storageUpToDate`, add it to
`propTypes`, and render a success-styled strip gated on
`storageUpToDate && inPlainContactsList` (same gate the syncing pill uses):

```jsx
{storageUpToDate && inPlainContactsList ? (
    <View style={readyBoxStorageBannerStyles.banner}>
        <MaterialCommunityIcon name="check-circle-outline" size={20} color="#1d7a3a" />
        <Text style={readyBoxStorageBannerStyles.text}>
            Blink storage is now up to date!
        </Text>
    </View>
) : null}
```

Add a green/success `StyleSheet` block mirroring the existing amber
`readyBoxSyncingStyles`. Wording per request: **"Blink storage is now up to
date!"** (heads-up: every other in-app string says "Sylk", e.g. "let Sylk read
your contacts" — using "Blink" here is intentionally your choice but will read
inconsistently).

**Risk:** low — additive presentational banner. The only thing to verify is the
single-fire guard and the 10 s timer being cleared if the component unmounts /
user logs out mid-window (clear the timeout in the sign-out path alongside
`_firstSyncTimeoutId`).

---

## Files touched

| File | Change |
|---|---|
| `app/app.js` | gate per-row logs on `!firstSync`; reorder apply list (newest-first) + suppress per-file checkpoint during first sync; add `storageUpToDateBanner` state + one-shot trigger + 10s timer; pass `storageUpToDate` to `<ReadyBox>` |
| `app/components/ReadyBox.js` | pass `storageUpToDate` prop through to `<ContactsListBanners>` |
| `app/components/ContactsListBanners.js` | new success banner block + style + propType |

## Test plan

1. **Fresh install, online** — newest conversations appear within a few
   seconds; banner shows once, auto-hides at 10 s; older history fills in
   behind it; final list matches a known-good device.
2. **Kill mid-backfill, relaunch** — resumes from on-disk files, no
   re-download, no `regress BLOCKED` lines, no duplicate messages.
3. **Second launch (returning device)** — unchanged oldest→newest path, no
   banner.
4. **Log volume** — confirm first sync no longer emits ~10k `Process journal`
   lines (per-file summaries only).
5. **Unread/last-message correctness** — a conversation with unread + a newer
   outgoing reply shows the right unread count and preview after first sync and
   after a subsequent restart.
6. **Timing** — re-measure processing wall-clock; expect time-to-first-useful
   list to drop from ~83 s to seconds (total backfill time roughly unchanged,
   but off the critical path).

## Out of scope / follow-ups

- Windowing the *fetch* (only pull recent history first, lazy-load older) —
  bigger change, larger win, separate proposal.
- Turning off `DIAG_AGGREGATE_JOURNAL` (line ~29942) — independent CPU win.
- Batching SQLite inserts in one transaction per file — if not already batched.
