# ChatBox Extraction Plan

Goal: pull the chat/messaging surface out of `ContactsListBox.js` into a standalone
`ChatBox` component. After this, `ContactsListBox` renders only the contacts list;
when a contact is selected it mounts `<ChatBox>`, and on back it shows the list again.

---

## 1. What the analysis found

`app/components/ContactsListBox.js` is ~11,970 lines. A single class holds **both** the
contacts FlatList and a full GiftedChat surface (text/image/video/audio bubbles, file
transfer, reactions, emoji picker, message menus, date-calendar filter, media grids,
fullscreen viewers). Roughly **60+ of its methods and ~35 of its state fields are
chat-only**; only a handful are truly shared.

**Good news for the refactor:** selection is already parent-driven. `selectedContact`
is owned by `app.js`, threaded down through `ReadyBox` → `ContactsListBox` as a prop
(`ReadyBox.js:4147`). Tapping a row calls `props.setTargetUri` up to the parent
(`ContactsListBox.js:2855-2867`); the parent sets `selectedContact`; back clears it
(`app.js:15006` and friends). Inside the component the chat-vs-list choice is just:

- `render()` (line 9283): the FlatList renders only when `!state.selectedContact`
  (line 10403); the chat surface renders when `showChat` is true (getter at line 8934,
  which ultimately keys off `props.selectedContact`).

So the seam already exists. The work is moving the chat branch + its methods/state into
`ChatBox`, not inventing new navigation.

### Render branches in `render()` (return at line 10401)
- Contacts `FlatList` — lines 10403–10469 (stays)
- Shared overlays (`gettingSharedAsset`, `messagesLoading`) — 10472–10513
- Image grid (`showImageGrid`) — ~10520–10633 (chat-side media → moves)
- Video grid (`showVideoGrid`) — ~10656–10748 (moves)
- Chat view (`showChat`, GiftedChat) — ~10750–11500 (moves)
- Readonly chat (`showReadonlyChat`) — ~11549+ (moves)
- Modals (image viewer, video player, location/HTML fullscreen, emoji picker,
  reaction bar, message menu, message/edit/share/delete modals) — ~11290–11970 (move
  the chat-related ones)

---

## 2. Target architecture

`ContactsListBox` keeps: contact state/filtering pipeline, `renderContactItem`,
`matchContact`, favorites/blocked/deleted/graveyard actions, the FlatList, and the
contact-source/search wiring. In its render it replaces the inline chat branch with:

```jsx
{this.props.selectedContact
  ? <ChatBox selectedContact={this.props.selectedContact} {...chatProps} />
  : <FlatList ...contacts... />}
```

`ChatBox` (new file `app/components/ChatBox.js`) owns: all chat state, all chat methods,
GiftedChat render, media grids, the date-period bar, fullscreen viewers, and the chat
modals. It is mounted only while a contact is selected and unmounts on back (driven by
the existing parent `selectedContact` prop), which also gives us free per-contact reset.

### Proposed ChatBox props (passed straight through from ReadyBox/app via ContactsListBox)
Data: `selectedContact`, `messages`, `messagesMetadata`, `keys`, `dark`, `insets`,
`isTablet`, `isLandscape`, `orientation`, `appBarHeight`, `account`, `password`,
`fontScale`, `messageZoomFactor`, `call`, `searchMessages`, `searchString`,
`messagesCategoryFilter`, `transferProgress`, `playRecording`, `recordingFile`,
`isAudioRecording`, `callHistoryUrl`, `appState`.

Callbacks: `sendMessage`, `reSendMessage`, `deleteMessage(s)`, `expireMessage`,
`deleteFiles`, `getMessages`, `getContactDateIndex`, `pinMessage`, `unpinMessage`,
`confirmRead`, `downloadFile`, `autoDownloadFile`, `uploadFile`, `decryptFunc`,
`file2GiftedChat`, `forwardMessagesFunc`, `clearMessageCategoryFilter`,
`clearMessageSearch`, `startCall`, `requestCameraPermission`,
`requestStoragePermission(s)`, `requestMicPermission`, `postSystemNotification`,
`openLogAttachment`, plus the location-share family (`contactStartShare`,
`pauseLocationShare`, etc.).

`onBack` is optional: today back is handled by the parent setting `selectedContact:null`,
so ChatBox mainly needs to expose its `backPressed()` overlay-closer (emoji picker /
reaction bar / message menu) so the hardware-back chain still works.

### Imports that move to ChatBox
`react-native-gifted-chat` (+ `GiftedChatContext`), `ChatBubble`, `LocationBubble`,
`ChatActions`, `MessageInfoModal`, `EditMessageModal`, `ShareMessageModal`,
`DeleteMessageModal`, `EmojiPicker`, `ReactionBar`, `MessageContextMenu`,
`SwipeReplyRow`, `ThumbnailGrid`, `AudioProgressSlider`/`VuMeter`/`AudioWaveform`/
`SpectrumPlayback`, `react-native-video(-player)`, `react-native-image-zoom-viewer`,
`react-native-file-viewer`, `react-native-document-picker`,
`react-native-audio-recorder-player`, `react-native-create-thumbnail`, render-html,
webview, image-picker, share, fast-openpgp, progress. `ContactCard` stays in
ContactsListBox. `utils`, `moment`, `RNFS`, `styles` are shared (imported in both).

---

## 3. Step-by-step sequence (each step independently testable on device)

1. **Scaffold** `ChatBox.js`: new class, `autoBind`, `propTypes`, copy the chat-only
   imports, and an empty/minimal render. Wire it into ContactsListBox behind a flag so
   nothing renders yet. Verify build still bundles.
2. **Move state**: relocate the ~35 chat-only `state` fields and chat-only instance
   fields/refs (`chatListRef`, `flatListRef`, keyboard/call listeners, audio timers,
   `customInputToolbar`, memo caches) into ChatBox's constructor + lifecycle.
3. **Move pure render helpers** first (lowest coupling): `renderMessageText`,
   `renderMessageImage/Video/Audio`, `renderComposer`, `renderCustomActions`,
   `noChatInputToolbar`, `noKeyInputToolbar`, `renderDatePeriodBar`, bubble/tick
   helpers.
4. **Move interaction handlers**: `onSendMessage`, `onMessagePress`,
   `onLongMessagePress`, `openMessageMenu`/`closeMessageMenu`/`onMessageMenuSelect`,
   reactions (`quickReact`, `dismissReactionBar`), emoji picker handlers, audio
   playback chain, file transfer (`uploadFile`, `transferComplete/Failed/Canceled`,
   `cancelTransfer`), media pickers, `getServerHistory`, `loadEarlierMessages`,
   date-index/focus-mode methods.
5. **Move the render branches**: chat view, readonly chat, image/video grids, and the
   chat modals from `ContactsListBox.render()` into `ChatBox.render()`. Replace them in
   ContactsListBox with `<ChatBox .../>`.
6. **Re-point the back chain**: keep `backPressed()` overlay logic in ChatBox; have
   ContactsListBox/parent delegate to it (e.g. via a ref or a forwarded handler) so the
   Android hardware-back order (menu → emoji → reaction bar → exit chat) is preserved.
7. **Clean up** dead chat code, unused imports, and the now-unused `showChat`/
   `showImageGrid`/`showVideoGrid`/`showReadonlyChat` getters in ContactsListBox.

I'll keep each step as a separate, reviewable diff so you can build + smoke-test on
device between steps and bisect easily if something regresses.

---

## 4. Risks & how I'll manage them

- **Shared methods that do double duty** — `setTargetUri`, `resetContact`,
  `componentDidMount/WillReceiveProps/WillUnmount`, `searchedContact`. I'll split these:
  contact-list halves stay, chat halves move; lifecycle listeners (keyboard/call/audio)
  move to ChatBox so they only run while chat is mounted.
- **External references to ContactsListBox internals** — comments across the codebase
  reference `ContactsListBox.renderMessageAudio`, `renderBubble`, `onLongMessagePress`,
  `onViewableItemsChanged`, etc. (ConferenceBox, AudioRecorder, NavigationBar, app.js).
  These are mostly comments, but I'll grep for any real imports/calls and keep names
  stable or re-export as needed before deleting anything.
- **Mount/unmount churn** — ChatBox now unmounts on back, so any state that needs to
  survive (e.g. cached audio durations, scroll offset) must live in the parent or be
  acceptable to reset. I'll confirm current behavior already resets these on contact
  change (it largely does via `resetContact`).
- **Styles** — both components share `../assets/styles/ContactsListBox`; I'll keep that
  shared import rather than splitting the stylesheet in this pass.
- **Hardware back ordering** — verified the current `backPressed` only handles chat
  overlays; the list/exit path is parent-owned, so the contract is preserved.

---

## 5. Verification (you test on device)

Per your choice, I won't run a device build. After implementation I'll:
- run the project's linter / available static checks and review the full diff, and
- give you a focused smoke-test checklist: open a contact → chat loads; send text /
  image / audio; long-press menu, reactions, emoji picker; image/video grid; date
  filter; file download/upload; hardware back closes overlays then returns to the list;
  blocked/anonymous/phone/conference contacts; readonly chat.

---

---

## IMPLEMENTED (phase 1 — behavior-preserving seam)

Done and verified to transform cleanly with the project's
`@react-native/babel-preset`:

- **`app/components/ChatBox.js`** (new): the standalone chat component. It
  contains the full chat surface and its logic, as a self-contained component
  with its own state/lifecycle. (Class renamed to `ChatBox`; the
  `../assets/styles/ContactsListBox` stylesheet import is intentionally
  unchanged — both components share it.)
- **`app/components/ContactsListBox.js`**: now imports `ChatBox` and, at the top
  of `render()`, returns `<ChatBox {...this.props} />` whenever
  `this.props.selectedContact` is set. So selecting a contact mounts ChatBox;
  the parent clearing `selectedContact` (back) unmounts it and the contacts
  list renders again. ChatBox receives the same props, so it initialises chat
  state exactly as the old inline path did.

This delivers the requested behavior (select → ChatBox, back → list) with a
single, low-risk change to the working file (one early return + one import).
Verification of runtime behavior is on-device, per your choice.

Why phase 1 keeps both files whole: ContactsListBox's lifecycle
(`componentDidMount`/`Unmount`, `UNSAFE_componentWillReceiveProps`,
`componentDidUpdate`) references chat methods/state, so deleting chat code from
it without careful lifecycle surgery would risk dangling references that only
surface at runtime. Establishing the seam first (this phase) lets each later
prune be verified on-device in isolation.

## PHASE 2 — DONE (duplication pruned, safely)

Pruning was driven by a transitive reachability analysis (from the React entry
points: constructor / render / lifecycle) using the project's Babel AST. Any
method never referenced via `this.x` anywhere in the file is provably
uncallable, so removing it cannot introduce a runtime `ReferenceError`. Verified
there are no dynamic `this[expr]()` dispatches and no parent attaches a `ref` to
either component, so external calls can't reach their methods either. After every
step both files were re-checked: they transform cleanly with
`@react-native/babel-preset` and contain zero dead methods / zero dangling
references.

What was removed:
- ContactsListBox: chat JSX branches from `render()` (contacts-only now),
  `componentDidUpdate` (chat-only), 103 provably-uncallable chat methods, and
  unused imports. **11,982 → 4,044 lines (−66%).** Kept: contacts pipeline +
  FlatList, `UNSAFE_componentWillReceiveProps` (still updates contacts state),
  `renderContactItem`, `matchContact`, `searchedContact`, and the `<ChatBox>`
  mount. 48 members remain (0 dead).
- ChatBox: contacts-items pipeline + FlatList branch removed from `render()`
  (chat-only now), 17 unused contacts methods removed, unused imports removed.
  135 members (0 dead).

Note: a few chat helper methods remain in ContactsListBox because its retained
`UNSAFE_componentWillReceiveProps` / `componentDidMount` (keyboard + call
listeners) still reference them. Removing those would mean trimming the 497-line
CWRP — higher risk, low remaining payoff — so it was intentionally left. The
contacts list is fully functional without it.

### Original phase-2 sketch (for reference)

Now that the seam exists, slim each side. Suggested order, each step
independently on-device testable:

1. ChatBox: drop the contacts-list code paths it no longer uses — the
   contacts-items pipeline + FlatList branch in `render()`, and the
   contacts-only methods (`renderContactItem`, `matchContact`, `searchedContact`,
   `setFavoriteUri`, `setBlockedUri`, `showDeleted/GraveyardContactOptions`,
   `findObjectByKey`). Keep its `render()` chat-only.
2. ContactsListBox: remove the now-unreachable chat JSX branches from `render()`
   (image grid, video grid, chat view, readonly chat, chat modals), then the
   chat-only methods/state, fixing `componentDidMount/Unmount` (drop keyboard +
   audio listeners) and splitting `UNSAFE_componentWillReceiveProps` /
   `componentDidUpdate` so no removed method is referenced.
3. Remove unused imports from each file; re-run the Babel parse check + on-device
   smoke test.

### Member map (AST line numbers in the pre-extraction file) for phase 2

Chat-only members to keep in ChatBox / remove from ContactsListBox include:
`_keyboardDidShow/Hide`, camera/library/document pickers, `renderComposer`,
`renderSend`, `renderBubble`, `renderMessageText/Image/Video/Audio`, `renderDay`,
`renderSystemMessage`, `renderTime`, `onSendMessage`, `sendEditedMessage`,
`onMessagePress`, `onLongMessagePress`, `openMessageMenu`, reactions/emoji
handlers, the audio-playback chain, file-transfer (`uploadFile`,
`transfer*`, `cancelTransfer`), `getServerHistory`, `loadEarlierMessages`,
`componentDidUpdate`, the date-index/focus-mode methods, `renderDatePeriodBar`,
the `showImageGrid/showVideoGrid/showChat/showReadonlyChat` getters, and the
media-grid methods. Contacts-only members to keep in ContactsListBox:
`renderContactItem`, `matchContact`, `searchedContact`, `setFavoriteUri`,
`setBlockedUri`, `showDeleted/GraveyardContactOptions`, `findObjectByKey`,
`closeConfirmDialog`. Shared/split: `constructor`, `componentDidMount/Unmount`,
`UNSAFE_componentWillReceiveProps`, `backPressed`, `resetContact`, `setTargetUri`.

---

## Open questions / your call
1. File name/location: `app/components/ChatBox.js` — good?
2. Scope of this pass: full extraction (steps 1–7), or stop after the chat branch is
   moved and leave style-splitting/dead-getter cleanup for a follow-up?
3. Any constraint on touching `ReadyBox.js`/`app.js`? Ideally ChatBox props are just
   forwarded through ContactsListBox so the parent barely changes.
