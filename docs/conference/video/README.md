# Video Conference Logic

How the participant matrix is built and reshuffled, and what happens both
client-side and server-side when somebody joins or leaves a room.

The single source of truth for layout is `ConferenceBox.js` (the screen) —
everything below traces back through that file. The wire protocol lives in
`react-native-sylkrtc` (`node_modules/react-native-sylkrtc/lib/conference.js`)
and is spoken by the SylkServer webrtcgateway, which fronts the Janus
VideoRoom plugin.

Index:

- [Glossary](#glossary)
- [Server-side model](#server-side-model)
- [Client-side state](#client-side-state)
- [The matrix layout algorithm](#the-matrix-layout-algorithm)
- [Self-tile placement](#self-tile-placement)
- [Join — UI and wire](#join--ui-and-wire)
- [Leave — UI and wire](#leave--ui-and-wire)
- [Active speaker / pinned-speaker reshuffle](#active-speaker--pinned-speaker-reshuffle)
- [Stalled participants — the silent reshuffle](#stalled-participants--the-silent-reshuffle)
- [Side carousel and drawer](#side-carousel-and-drawer)
- [SIP / PSTN participants](#sip--pstn-participants)
- [Render chain summary](#render-chain-summary)


## Glossary

- **publisher** — the participant's outbound feed in the VideoRoom. Created
  when they join. There is one publisher per participant.
- **subscriber** / **feed** — the inbound peer connection THIS client opens
  to receive ONE remote publisher. One subscriber PC per remote.
- **focus** — the SIP side of the room. SylkServer's webrtcgateway acts as a
  B2BUA between the SIP focus and the Janus VideoRoom.
- **active speakers** / **pinned speakers** — participants the room has
  elected to show in the foreground. Driven by `videoroom-configure` from
  either the user (via the speaker-selection modal) or by the server's own
  voice-activity detection.
- **matrix** — the up-to-4 tile grid at the centre of the video view.
- **carousel** — the right-edge vertical strip of small tiles for
  participants beyond the matrix.
- **drawer** — the slide-in roster panel showing every participant
  (including ones with no media).


## Server-side model

The client never opens N peer connections in one shot. The flow per peer is:

1. The client opens ONE **publisher** PC (`videoroom-join`) when it joins
   the room. The local stream goes out on this PC.
2. The server replies with `initial-publishers`, listing the publishers
   already in the room.
3. For each remote publisher, the client opens a separate **subscriber** PC
   by sending `videoroom-feed-attach`. The server replies with an SDP offer
   inside `feed-attached`; the client answers with `videoroom-feed-answer`.
4. While the room is alive the server pushes:
   - `publishers-joined` whenever a new publisher arrives
   - `publishers-left` whenever a publisher leaves
   - `configure` whenever the active-speakers set changes
   - `conference-audio-levels` every ~250 ms (VU meters)
   - `conference-participants` (RFC 4575 conference-info NOTIFY) for the
     SIP/PSTN side of the room
5. When the local user leaves they send `videoroom-leave`. The server
   tears down their publisher and broadcasts `publishers-left` to everyone
   else.

The sylkrtc library (`node_modules/react-native-sylkrtc/lib/conference.js`)
translates each of these into a JS event on the call object:

| Wire message            | sylkrtc event                  | Source        |
|-------------------------|--------------------------------|---------------|
| `publishers-joined`     | `participantJoined`            | line 760      |
| `publishers-left`       | `participantLeft`              | line 769      |
| `feed-attached`         | (subscriber SDP offer)         | line 773      |
| `feed-established`      | participant `stateChanged`     | line 779      |
| `configure`             | `roomConfigured`               | line 813      |
| `conference-audio-levels` | (internal accumulator)       | —             |
| `conference-participants` | `sipConferenceParticipants` | line 971      |

And the outbound requests the client sends:

| sylkrtc method                      | Wire `sylkrtc` field           |
|-------------------------------------|--------------------------------|
| `account.joinConference(room, opts)`| `videoroom-join`               |
| `participant.attach()`              | `videoroom-feed-attach`        |
| `participant.detach()`              | `videoroom-feed-detach`        |
| `participant.pauseVideo()`          | `videoroom-session-update {video: false}` |
| `participant.resumeVideo()`         | `videoroom-session-update {video: true}`  |
| `conference._sendConfigureRoom(ps)` | `videoroom-configure`          |
| `conference.terminate()`            | `videoroom-leave`              |


## Client-side state

`ConferenceBox.state` carries the four pieces of state the matrix is built
from:

- `participants` — array of remote participants. The wire roster, mutated
  by `onParticipantJoined` / `onParticipantLeft`.
- `activeSpeakers` — array of pinned participants from the server's most
  recent `roomConfigured` event. Seeded from `props.call.activeParticipants`
  at construct time so the matrix is correct on the very first paint.
- `stalledParticipants` — `Set` of participant ids whose video has been
  silent for more than `PARTICIPANT_STALL_MS` (20 s). The grid hides them.
- `enableMyVideo`, `videoMuted`, `cameraStartPreviewVisible`, `showDrawer`,
  `chatView` — the local-side gates for the self-tile/self-PIP.

Two derived getters drive the actual render:

- `get visibleParticipants()` (ConferenceBox.js:5947) —
  `participants` filtered to exclude (a) stalled ids and (b) participants
  whose packet loss reads 100% ("No media"). This is the live count that
  feeds layout.
- `get showMyself()` (ConferenceBox.js:5965) — whether the floating
  self-PIP is visible. See [self-tile placement](#self-tile-placement).

`getVideoLayout()` (ConferenceBox.js:6023) consumes these to return
`{container, item}` flexbox styles for the grid.


## The matrix layout algorithm

The effective tile count is computed once per render in `getVideoLayout()`:

```
pinnedCount = activeSpeakers.filter(p => !stalled.has(p.id)).length
remoteCount = visibleParticipants.length

if pinnedCount > 0:
    count = min(pinnedCount, 4)        # matrix = pinned set ONLY
elif remoteCount == 1:
    count = 2                          # self + remote, 50/50
else:
    count = min(remoteCount, 4)        # remote count, capped
```

The grid CSS that comes out of the switch:

| count | container                         | item             | shape           |
|-------|-----------------------------------|------------------|-----------------|
| 1     | column, no wrap, centred          | 100% × 100%      | single fullscreen tile |
| 2     | row (landscape) or column (portrait), no wrap | 50% / 100% on the major axis | side-by-side or stacked |
| 3, 4+ | row + wrap                        | 50% × 50%        | 2 × 2 grid      |

`ConferenceBox.render()` then slices `videos.slice(0, 4)` (line 9666) so
no more than four tiles ever land in the matrix; overflow goes to the side
carousel.

Notes:

- When `pinnedCount > 0` the matrix shows ONLY the pinned set. Every other
  participant is shunted to the side carousel, even if there are only two
  of them and the matrix is otherwise empty. This is intentional — pinning
  means "I want focus on these speakers".
- A 100%-loss participant is treated the same as a stalled one for grid
  purposes (`visibleParticipants` filters them) so the grid doesn't size
  itself for a slot that renders as a black square. They still appear in
  the drawer roster.


## Self-tile placement

The local video has two possible surfaces and they're mutually exclusive:

1. **As a matrix tile** (`ConferenceParticipantSelf`, line 8952) — inserted
   into the `videos[]` array directly when there are exactly 1 or 3 remote
   visible participants. That way:
   - 1 remote + self = 2 tiles in a 50/50 split.
   - 3 remotes + self = 4 tiles in a 2 × 2 grid.
2. **As a floating PIP** (`ConferenceParticipantSelf` rendered separately,
   line 9856, gated by `this.showMyself`) — used for 0, 2, 4+ remote
   visible participants. Floats over the top-right of the matrix.

`get showMyself()` (ConferenceBox.js:5965) gates the floating PIP. It
returns `false` (PIP hidden) when:

- the camera-start preview modal is up,
- any speaker is pinned (`pinnedCount > 0`),
- visibleCount is 1 or 3 (self is already in the matrix tile),
- the local user is one of the active speakers,
- the user disabled their video, muted it, or opened the drawer.

Inverse logic in the matrix branch (line 8949) makes sure the matrix self
tile is gated by the same `enableMyVideo && !videoMuted` so a Cancel from
the camera-start modal can't leave a self-tile in the grid.


## Join — UI and wire

When the server sends `publishers-joined`:

1. **Wire → sylkrtc** (`conference.js:754`): a `Participant` object is
   created and stored in `_participants`, then `participantJoined` is
   emitted.
2. **`ConferenceBox.onParticipantJoined`** (`ConferenceBox.js:3183`):
   - Logs `[grid] participant joined ... remote-count N -> N+1`.
   - Posts a "X joined" chat system message (suppressed for the PSTN bridge
     and for anonymous-guest URIs which post "An anonymous guest joined").
   - Hooks `stateChanged` on the participant.
   - Calls `p.attach()` — sylkrtc sends `videoroom-feed-attach` to open the
     subscriber peer connection (`conference.js:164`). The server answers
     with `feed-attached` carrying the SDP offer; sylkrtc creates the local
     `RTCPeerConnection`, sets remote, generates an answer, and sends
     `videoroom-feed-answer`. When media starts flowing the participant's
     state becomes `'established'` (`feed-established`).
   - `setState({ participants: participants.concat([p]) })` — this is the
     trigger for the grid to recompute. React re-renders ConferenceBox;
     `visibleParticipants` returns one more entry; `getVideoLayout()`
     returns a new `{container, item}`; existing tiles re-flow into the new
     grid; the freshly-added participant's `ConferenceMatrixParticipant`
     mounts and attaches to the stream.
3. **Tile mount** (`ConferenceMatrixParticipant.componentDidMount`,
   line 207):
   - Calls `maybeAttachStream()` to copy `participant.streams[0]` into
     local state and render it via `RTCView`.
   - Unconditionally calls `participant.resumeVideo()` — idempotent on the
     server (just `videoroom-session-update {video: true}`), but defends
     against the server-side subscription being paused from a previous
     audio-view stint.
   - Schedules a bounded retry loop (`_scheduleAttachRetry`, line 253):
     re-checks for video receivers every 400 ms for up to 8 attempts. This
     covers the case where the audio receiver arrives before the video
     one and `streamAdded` fires after `componentDidMount` has run.
   - Subscribes to the participant's `streamAdded` event so a late-arriving
     video receiver bumps `trackVersion` and forces the `RTCView` to
     remount keyed on the new track set.
4. **Reshuffle summary** for join transitions:
   - 0→1 remote: layout switches from "lone self fullscreen" or PIP to a
     50/50 split (self matrix tile + remote tile).
   - 1→2 remotes: self drops OUT of the matrix into a floating PIP; the
     two remotes get 50/50.
   - 2→3 remotes: self comes BACK INTO the matrix as the 4th tile; 2 × 2.
   - 3→4 remotes: self drops out again; four remote tiles fill the 2 × 2;
     PIP shows self.
   - ≥5 remotes: matrix stays capped at four tiles, additional remotes go
     to the side carousel.


## Leave — UI and wire

When the server sends `publishers-left`:

1. **Wire → sylkrtc** (`conference.js:763`): `participantLeft` is emitted.
2. **`ConferenceBox.onParticipantLeft`** (`ConferenceBox.js:3813`):
   - Logs `[grid] participant left ... remote-count N -> N-1`.
   - Cleans per-participant maps: `latency`, `packetLoss`, `mediaLost`,
     `videoCodec`, `audioCodec`, `lastVideoActivity`, and removes them
     from `stalledParticipants` if present.
   - `setState({ participants: participants.splice(idx, 1) })` — this
     drops the participant and triggers grid recomputation.
   - Calls `p.detach(true)` — `true` means "the server already told us
     they're gone so don't send `videoroom-feed-detach`; just close the
     local subscriber PC". For deliberate local detaches (e.g. switching
     a tile out of view) `detach(false)` would send the wire request
     first.
   - Posts a "X left" chat system message (suppressed for bridge URIs).
   - Schedules an `exitFullScreenIfAlone()` check 100 ms later — if the
     local user is now alone in the room we drop out of fullscreen.
3. **Reshuffle summary** for leave transitions: the inverse of the join
   transitions above. The matrix recomputes around the smaller live set;
   `ConferenceMatrixParticipant.componentWillUnmount` (line 278) tears down
   the dead tile's listeners and retry timer.
4. **Self leaving the room** — `terminate()` on the call sends
   `videoroom-leave`; the server broadcasts `publishers-left` to everyone
   else, who run their own `onParticipantLeft` for us.


## Active speaker / pinned-speaker reshuffle

`activeSpeakers` is a parallel piece of state that can change without
anyone joining or leaving. Two paths feed it:

1. **Server-driven** — Janus emits a `configure` message when its
   voice-activity detection elects new dominant speakers. sylkrtc
   translates this into `roomConfigured` (`conference.js:813`) with
   `{originator, activeParticipants}`.
2. **User-driven** — `ConferenceDrawerSpeakerSelection` calls
   `conference._sendConfigureRoom([ids])` which goes out as
   `videoroom-configure`. The server echoes the change back as
   `configure`, closing the loop. The mobile client also optimistically
   updates local `activeSpeakers` state (ConferenceBox.js:4948) so the UI
   reflects the pin immediately without waiting for the round trip.

`onConfigureRoom` (ConferenceBox.js:3887) writes `activeSpeakers` into
state and calls `maybeSwitchLargeVideo()`. The next render picks up the
new pinned set in the matrix-building branch starting at line 8820.

When `activeSpeakers.length > 0` (pinned-speaker mode):

- The matrix renders ONLY the pinned tiles, with per-tile "Main speaker"
  / "Speaker 1" / "Speaker 2" pill labels (line 8868–8872, surfaced by
  `ConferenceMatrixParticipant` via the `speakerLabel` prop).
- Every other participant — including the local user — goes into the
  side carousel.
- The floating self-PIP is suppressed (`get showMyself()` line 5996).

When `activeSpeakers` empties out, the matrix reverts to the
remote-count-driven layout above.


## Stalled participants — the silent reshuffle

The grid also reshuffles when nobody joined or left, but a remote stopped
sending video. `getConnectionStats()` (ConferenceBox.js:~3550–3800) runs
at 1 Hz and tracks `lastVideoActivity` per participant from the inbound-rtp
bytes-received counter.

If a participant has been silent for `PARTICIPANT_STALL_MS` (20 s):

1. They're added to `state.stalledParticipants`.
2. `visibleParticipants` excludes them; the matrix recomputes around the
   smaller live set.
3. A best-effort recovery is attempted (line 3776): `pauseVideo()` then
   `resumeVideo()` 300 ms later. On Janus VideoRoom this commonly forces a
   keyframe re-send and unblocks "stuck I-frame" stalls. Tracked in
   `_stallRecoveryAttempts` so a permanently-dead stream isn't bombarded
   every second.
4. When bytes start flowing again, they're dropped from `stalledParticipants`
   and the matrix expands again.

Stalled-set changes are logged as
`[conference] [grid] stalled set changed — visible N -> M +added [...] -dropped [...]`
so any "video tile went gray" event has a single grep-able marker. The
recompute is skipped entirely while in audio view (line 3703) because
every remote's video subscription is paused by design there.


## Side carousel and drawer

`ConferenceBox.render()` builds three parallel arrays per render:

- `videos[]` — full matrix tiles (`ConferenceMatrixParticipant` +
  optional `ConferenceParticipantSelf`), sliced to 4 (line 9666).
- `participants[]` — small carousel thumbnails (`ConferenceParticipant`,
  line 8910 and 9051) for participants beyond the matrix cap, rendered
  with `pauseVideo={true}` so the subscriber stays open but doesn't pull
  video bytes for the off-screen tile.
- `drawerParticipants[]` — `ConferenceDrawerParticipant` entries listing
  every participant for the slide-in roster. Unlike the other two this is
  populated unconditionally so participants who are stalled or 100%-lossy
  still show up in the roster.

The carousel is rendered by `ConferenceCarousel` at the right edge of the
screen when `chatView` is off (line 9724).


## SIP / PSTN participants

The WebRTC roster (above) is one half. The SIP side of the room is fed by
`sipConferenceParticipants` (`conference.js:971`): the focus sends an
RFC 4575 conference-info NOTIFY listing SIP/PSTN callees, and sylkrtc
emits the parsed list plus a `duration` field (seconds since the room was
created on the gateway).

`Conference.js:457` registers a listener on `confCall` immediately after
creation so the first snapshot — which lands during the join handshake
BEFORE ConferenceBox mounts — is cached on `confCall._sipParticipants`.
ConferenceBox's constructor seeds from that cache, so SIP participants are
visible the first time the box paints.

Subsequent snapshots are diff'd against the previous one to generate
join/leave chat messages for SIP-side endpoints (so the chat log stays
in sync with the unified roster even though SIP joins don't fire
`publishers-joined`).


## Render chain summary

What flips the grid on a join (server pushes a `publishers-joined`):

```
ws://server  publishers-joined
       │
       ▼  sylkrtc/conference.js:754
   emit 'participantJoined'
       │
       ▼  ConferenceBox.js:3183
   onParticipantJoined(p)
     - p.attach()  ──►  wire 'videoroom-feed-attach'
                          │
                          ▼  server answers with SDP offer
                        'feed-attached' ──► sylkrtc opens subscriber PC,
                                            answers, eventually
                                            'feed-established'
     - setState({participants: [...old, p]})
       │
       ▼  React re-renders
   ConferenceBox.render()
     - visibleParticipants recomputes
     - getVideoLayout() returns new flex container/item
     - videos[] rebuilt; new ConferenceMatrixParticipant mounts
     - existing tiles re-flow into new layout
       │
       ▼  ConferenceMatrixParticipant.componentDidMount
     - maybeAttachStream() copies stream into local state
     - participant.resumeVideo()  ──►  wire 'videoroom-session-update {video:true}'
     - retry loop covers late-arriving video receiver
```

What flips it on a leave:

```
ws://server  publishers-left
       │
       ▼  sylkrtc/conference.js:763
   emit 'participantLeft'
       │
       ▼  ConferenceBox.js:3813
   onParticipantLeft(p)
     - clears per-participant maps
     - setState({participants: participants - p})
     - p.detach(true)  (close subscriber PC; server already removed feed)
       │
       ▼  React re-renders
   ConferenceBox.render()
     - visibleParticipants smaller
     - getVideoLayout() returns new flex container/item
     - dead tile unmounts; remaining tiles re-flow
```

And the silent reshuffle on stall:

```
getConnectionStats tick (1 Hz)
       │
       ▼  ConferenceBox.js:~3700
   stalled set membership changed
     - setState({stalledParticipants: newSet})
     - p.pauseVideo() / p.resumeVideo() recovery nudge
       │
       ▼  React re-renders
   visibleParticipants now excludes stalled ids
     - matrix recomputes around fewer tiles
```

Three inputs, one layout. Anything that changes `participants`,
`activeSpeakers`, or `stalledParticipants` reshuffles the grid via the
same single render path.
