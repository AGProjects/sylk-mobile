# Plan: Extract the audio recorder out of ReadyBox

## Goal

Move the entire voice-message feature (recording, input-device selection, live
metering, preview playback, and send/delete) out of `app/components/ReadyBox.js`
into a new self-contained component, `app/components/AudioRecorder.js`.

After this change, recording / preview / send no longer live in ReadyBox.
ReadyBox only renders `<AudioRecorder/>`, forwards a few app-level props, and
keeps a small mirror of "is the recorder active" so its existing layout gates
keep working.

## Chosen architecture

Self-contained child + `ref` + callbacks:

- `AudioRecorder` owns all recording **state** and **logic** internally.
- ReadyBox triggers a recording via a `ref` (the composer mic button lives in a
  sibling, `ContactsListBox`, so the start signal has to be forwarded).
- `AudioRecorder` reports activity changes up via an `onStateChange` callback.
  ReadyBox stores those five values and its existing getters read them, so the
  many `this.state.recording` / `recordingFile` checks scattered through
  ReadyBox keep working with a one-word rename.

## What moves into AudioRecorder.js

### Imports / module setup
- `AudioRecorderPlayer` (+ the `AVEncoding*` / `AudioEncoderAndroid*` enums),
  `RNFS`, `Sound`, `SpectrumRecorder`, `MicSpectrumBars`, `VuMeter`,
  `AudioWaveform`, `SpectrumPlayback`, `AudioProgressSlider`.
- The module-level `const audioRecorderPlayer = new AudioRecorderPlayer();`.
- The relevant `styles.recordingContainer` / `styles.activityTitle` (reused from
  the shared stylesheet — no change needed, just import the same stylesheet).

### State (~18 fields)
`recording`, `recordArmed`, `recordStarting`, `recordingFile`, `recordingPeaks`,
`recordingSpectrum`, `recordingDuration`, `recordingElapsedMs`,
`recordingInputDevice`, `recordInputs`, `selectedRecordInput`,
`recordInputMenuVisible`, `previewRecording`, `playRecording`, `level`,
`playTime`, `currentPositionSec`, `currentDurationSec`.

### Methods (~20)
`recordAudio`, `armRecording`, `startArmedRecording`, `cancelArming`,
`selectRecordInput`, `renderRecordInputSelector`, `onStartRecord`,
`onStopRecord`, `stopRecording`, `stopRecordingTimer`, `deleteAudio`,
`deleteAudioAction`, `audioRecorded`, `sendAudioFile`, `transferFile`,
`previewAudio`, `pausePreviewAudio`, `onStopPlay`, `startAudioPlayer`,
`stopAudioPlayer`.

### Render
The three conditional blocks currently in ReadyBox's render:
1. The pre-record "armed" screen (input-device selector + Start/Cancel).
2. The live recording screen (VuMeter, MicSpectrumBars, elapsed counter).
3. The preview/send bubble (waveform, spectrum, slider, play/pause).

`AudioRecorder.render()` returns these three blocks (or `null` when idle).

### Lifecycle that moves
- The "stop recording when a call starts" interrupt (currently in ReadyBox's
  `componentWillReceiveProps`) moves into AudioRecorder, which receives `call`
  as a prop and reacts to it.
- Handling of the incoming `playRecording` / `recordingDuration` props moves with
  the state.

## Interface of AudioRecorder

Props (forwarded by ReadyBox from app.js):
- `selectedContact`, `call`
- `requestMicPermission`, `file2GiftedChat`, `sendMessage`, `sendPeaksMessage`,
  `getMessages`, `vibrate`
- `playRecording`, `recordingDuration` (the externally-driven values)
- `onStateChange({ recording, recordArmed, previewRecording, playRecording,
  recordingFile })` — fired on every relevant transition.

Imperative API (called through the ref):
- `recordAudio()` — the composer mic tap entry point.
- `sendAudioFile()` — the composer "send" tap.
- `startAudioPlayer()` / `stopAudioPlayer()` — bubble playback hooks.

## What stays in ReadyBox

- A mirror object in state, e.g. `recorderState = { recording, recordArmed,
  previewRecording, playRecording, recordingFile }`, updated from
  `onStateChange`.
- The getters (`showCallButtons`, `showConferenceButton`, `showAudioSendButton`,
  `showAudioDeleteButton`, `showAudioStopButton`, `showAudioRecordButton`,
  `showContactsList`, `showNavigationBar`) — repointed from
  `this.state.recording` → `this.state.recorderState.recording`, etc. Pure
  rename, no logic change.
- Thin forwarders so `ContactsListBox`'s existing props don't change:
  `recordAudio`, `sendAudioFile`, `startAudioPlayer`, `stopAudioPlayer` each call
  the corresponding ref method; `isAudioRecording`, `audioArmed`, `recordingFile`,
  `playRecording`, `canRecordAudio` read from the mirror.
- `<AudioRecorder ref={this.audioRecorderRef} .../>` placed exactly where the
  three render blocks are today.

## ContactsListBox

No interface change. It keeps calling `this.props.recordAudio` /
`this.props.sendAudioFile` and reading `isAudioRecording` / `audioArmed` /
`recordingFile` / `playRecording` / `canRecordAudio` — ReadyBox now satisfies
those from forwarders + mirror state instead of its own local state.

## Risks & mitigations

- **No-flash transitions**: ReadyBox today relies on combined `setState` calls so
  the chat view never flashes between recording states. Because the mirror in
  ReadyBox now updates one tick after the child, there's a risk of a 1-frame
  flash. Mitigation: gate the chat/contacts view on `recorderState` AND keep the
  child mounted over the same region; the child renders its own full-screen
  overlay while active, so even a 1-frame mirror lag shows the overlay, not the
  chat.
- **`audioRecorderPlayer` is a shared singleton**: keep exactly one instance
  (now inside AudioRecorder). Nothing else in ReadyBox uses it directly besides
  the seek/pause calls inside the moved render block, which move with it.
- **autoBind**: AudioRecorder will use the same `autoBind(this)` pattern so the
  `this.method` references inside the moved render keep their binding.
- **Large mechanical edit**: ReadyBox is ~287KB. Edits will be surgical
  (remove-by-exact-block) and verified by a metro/babel parse of both files
  after each stage.

## Verification

1. `npx babel` / metro bundle parse of `AudioRecorder.js` and `ReadyBox.js` to
   confirm no syntax/binding breakage.
2. Lint the two changed files.
3. Manual parity checklist: arm → pick input → record → live meter/spectrum →
   stop → preview play/seek → send (peaks + spectrum attached) → delete; plus the
   call-interrupt path and the chat/contacts gating.
