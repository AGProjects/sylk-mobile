import React, { Component } from 'react';
import { View, Platform, TouchableWithoutFeedback, TouchableHighlight, TouchableOpacity, Dimensions } from 'react-native';
import { IconButton, Dialog, Button, Portal, Text, ActivityIndicator, Menu } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import { getZrtpSession } from './CallZrtp';
import utils from '../utils';
import LoadingScreen from './LoadingScreen';

import TrafficStats from './BarChart';
import AudioSpeedometer from './AudioSpeedometer';
import VuMeter from './VuMeter';

// Call recording.
//   • Android: SylkCallRecorder taps libwebrtc AudioTrackSink for both
//     the local mic and the remote audio track and mixes them stereo
//     into an Opus-OGG file (~3 KB/s).
//   • iOS: SylkCallRecorder taps RTCAudioRenderer for the remote
//     leg and AVAudioEngine for the mic, mixes them stereo and
//     encodes to AAC m4a via AVAssetWriter (~8 KB/s).
//   • Fallback (either platform): if the native module reports
//     'not_implemented' (e.g. iOS pre-track-resolution race), we
//     fall back to mic-only AAC capture via audioRecorderPlayer.
//     One-sided record but the same compressed format.
import CallRecorder from '../CallRecorder';
import AudioRecorderPlayer, {
    AudioEncoderAndroidType,
    AudioSourceAndroidType,
    AVEncodingOption,
    AVEncoderAudioQualityIOSType,
    OutputFormatAndroidType,
} from 'react-native-audio-recorder-player';
const RNFS = require('react-native-fs');

import CallRecordingDisclosureModal from './CallRecordingDisclosureModal';
import {
    readAcknowledged as readCallRecordingDisclosure,
    setAcknowledged as setCallRecordingDisclosure,
} from '../callRecordingDisclosure';

import styles from '../assets/styles/AudioCall';

// Module-level recorder instance — separate from the playback
// instance in ReadyBox so a call recording started while a chat
// preview is playing back doesn't fight the same _isRecording
// flag inside the wrapper class.
const _callRecorderPlayer = new AudioRecorderPlayer();


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

const MAX_POINTS = 30;

// Audio device picker variant. Change this value to switch styles:
//   'cycle'    - tap the button to cycle through available devices (legacy behaviour)
//   'menu'     - react-native-paper dropdown Menu with device icon + name per row
//   'floating' - WhatsApp-style: extra IconButtons float above the main button
const AUDIO_DEVICE_PICKER_MODE = 'floating';

class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            remoteUri                   : this.props.remoteUri,
            remoteDisplayName           : this.props.remoteDisplayName,
            photo                       : this.props.photo,
            active                      : false,
            audioMuted                  : this.props.muted,
            showDtmfModal               : false,
            showEscalateConferenceModal : false,
            call                        : this.props.call,
            reconnectingCall            : this.props.reconnectingCall,
            info                        : this.props.info,
            selectedContacts            : this.props.selectedContacts,
            declineReason               : this.props.declineReason,
            callContact                 : this.props.callContact,
            selectedContact             : this.props.selectedContact,
            terminatedReason            : this.props.terminatedReason,
            speakerPhoneEnabled         : this.props.speakerPhoneEnabled,
            audioGraphData              : [],
            userStartedCall             : this.props.userStartedCall,
			availableAudioDevices       : this.props.availableAudioDevices,
			selectedAudioDevice         : this.props.selectedAudioDevice,
			insets                      : this.props.insets,
			isLandscape                 : this.props.isLandscape,
			audioDevicePickerVisible    : false,
            // ZRTP indicator state. null = not started, 'probing' = in
            // negotiation (yellow), 'key-agreed' = active (green), 'failed'
            // (silent — call stays SDES-only).
            zrtpState                   : null,
            zrtpDialogVisible           : false,
            // Shown when the call is in zRTP-mandatory mode and the
            // handshake fails (no PGP key, incompatible codec, or 10s
            // timeout). Lets the user choose whether to terminate the
            // call or continue without end-to-end encryption.
            zrtpMandatoryFailedVisible  : false,
            zrtpMandatoryFailedInfo     : null,
            // Toggle between the AudioSpeedometer (default) and the
            // legacy TrafficStats bar-chart. Tap the stats area to flip.
            showOldStats                : false,
            // 10-second auto-start countdown for the outgoing-audio
            // pre-call screen. Reaches 0 → confirmStartCall() fires
            // automatically. Updated by the interval started in
            // _startAutoStartTimer.
            autoStartCountdown          : 0,
            // Local-mic call recording state. `isRecording` toggles the
            // record button look + the red dot/timer indicator.
            // `recordingElapsedSec` is incremented by a 1-Hz interval
            // started in _startCallRecording.
            // `recordingArmed` is set when the user taps the record
            // button BEFORE the call is established — the pill shows
            // an "armed / will record" look, and the moment the call
            // transitions to accepted/established we auto-fire
            // _startCallRecording (see callStateChanged).
            isRecording                 : false,
            recordingArmed              : false,
            recordingElapsedSec         : 0,
            recordingFile               : null,
            // Call-recording disclosure gate. `null` = hidden;
            // otherwise an object describing what the user is being
            // asked about so the modal's Continue/Cancel callbacks
            // know what to do next:
            //   { kind: 'autostart' }
            //     The caller wants auto-record on this call but the
            //     legal disclosure hasn't been accepted yet. Continue
            //     → set the flag, arm/start recording, AND let the
            //     call proceed (calling props.confirmStartCall when
            //     we're still in the awaiting-user-start phase).
            //     Cancel → don't start the call at all (props.hangup
            //     so the user is returned to the previous screen).
            //   { kind: 'manual' }
            //     The user tapped the record pill mid-call. Continue
            //     → set the flag, then run the same logic
            //     _toggleCallRecording would have done (start now
            //     if call live, else arm). Cancel → no state change
            //     (call continues, recorder stays off).
            recordingDisclosurePending  : null,
            // Smoothed remote-side audio level for the VU meter,
            // 0..1. Sampled by _sampleAudioLevels at ~10 Hz
            // (faster than the default sylkrtc statistics emitter)
            // and run through a fast-attack / slow-release envelope
            // so the bar feels responsive without flickering on
            // every consonant.
            remoteAudioLevel            : 0,
            // Same idea, for the local mic. Pulled from getStats()'s
            // media-source report (kind=audio), which the encoder
            // updates in lockstep with the outbound RTP stream.
            localAudioLevel             : 0,
            // Latched true the first time either audioLevel arrives
            // from getStats(). Gates the "Remote" / "Local" labels
            // in _renderRemoteVuMeter so they don't appear next to
            // unlit bars during the ~2 s between call-connect and
            // the first stats sample.
            vuMetersHaveData            : false,
        };

        this.remoteAudio = React.createRef();
        this.userHangup = false;
        // Auto-start timer handles. _autoStartTimer is the setTimeout
        // that fires confirmStartCall after 10 s; _autoStartTickInterval
        // updates the countdown label every second.
        this._autoStartTimer = null;
        this._autoStartTickInterval = null;
        // 1-Hz interval that ticks recordingElapsedSec while recording.
        this._recordingTickInterval = null;
        // ~10 Hz interval that samples the remote audio level for the
        // VU meter via call._pc.getStats().
        this._vuSamplerInterval = null;
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        if (this.state.call != null) {
            switch (this.state.call.state) {
                case 'established':
                    this.attachStream(this.state.call);
                    // Already mid-call when we mounted — start the VU
                    // sampler immediately so the meter populates
                    // without waiting for the next state change.
                    this._startVuSampler();
                    break;
                case 'incoming':
                    this.props.mediaPlaying();
                    // fall through
                default:
                    this.state.call.on('stateChanged', this.callStateChanged);
                    break;
            }
            this.props.call.statistics.on('stats', this.statistics);
            // ZRTP: emitted by CallZrtp.js whenever per-call session state
            // changes (probing / key-agreed / failed).
            this.state.call.on('zrtpStateChanged', this.zrtpStateChanged);
            // Mandatory-mode handshake failure: surface the warning
            // dialog so the user can pick End call vs Continue.
            this.state.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            // Catch up if the session already finished its handshake before
            // this component mounted (e.g. after a Fast Refresh / reload).
            const existing = getZrtpSession(this.state.call);
            if (existing && existing.state) {
                this.setState({ zrtpState: existing.state });
            }
        }

        if (this.state.selectedContacts && this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }

        // If we mounted directly into the awaiting-outgoing state, kick
        // off the auto-start timer immediately. componentDidUpdate
        // handles later transitions into / out of awaiting.
        if (this.props.awaitingUserCallStart && this.props.confirmStartCall) {
            this._startAutoStartTimer();
        }

        // Auto-record arming. Two inputs combine, with the contact-level
        // override winning when both are set (mirrors the per-contact
        // encryption / codec override pattern):
        //   contact.localProperties.enableAudioRecording === true   → record
        //   contact.localProperties.enableAudioRecording === false  → don't record
        //   contact override unset (null/undefined)                 → fall back
        //                                                             to device pref
        // Net effect: a contact tagged "always record" picks up
        // recording even when the device-wide toggle is OFF; a contact
        // tagged "never record" stays off even when the device toggle
        // is ON.
        const cl = this.state.callContact && this.state.callContact.localProperties;
        const contactAutoRecord = cl
            ? (cl.enableAudioRecording === true || cl.enableAudioRecording === false
                ? cl.enableAudioRecording
                : null)
            : null;
        const wantAutoRecord = contactAutoRecord !== null
            ? contactAutoRecord
            : !!this.props.enableAudioRecording;
        if (wantAutoRecord
            && !this.state.isRecording
            && !this.state.recordingArmed) {
            // Disclosure gate. Auto-record is opt-in legally — see
            // CallRecordingDisclosureModal — so before we arm or
            // start the recorder we must confirm the user has
            // acknowledged the EU one-party / all-party consent
            // summary at least once for THIS SIP identity. If they
            // haven't, pause the auto-start countdown, surface the
            // disclosure, and let the modal's Continue/Cancel
            // callbacks decide whether the call (and the recording)
            // proceeds.
            this._gateAutoRecordOnDisclosure(contactAutoRecord !== null ? 'contact' : 'device');
        }
    }

    /** Helper used by both componentDidMount auto-record arming and
     *  componentDidUpdate (for the case where the device-pref or
     *  contact-override flips ON mid-call). Resolves the disclosure
     *  flag asynchronously and either runs the actual arm/start
     *  logic immediately (already acknowledged) or pops the
     *  disclosure modal (kind='autostart') and waits for the user.
     */
    _gateAutoRecordOnDisclosure(source) {
        readCallRecordingDisclosure(this.props.accountId)
            .then((acknowledged) => {
                if (this.unmounted) return;
                if (acknowledged) {
                    this._armOrStartAutoRecord(source);
                    return;
                }
                utils.timestampedLog('[call] auto-record requested but disclosure not acknowledged —',
                    'pausing auto-start countdown and showing disclosure modal');
                // Freeze the auto-start countdown so the call doesn't
                // dial out from under the user while they're reading
                // the legal text. _resumeAutoStartTimer / a fresh
                // countdown is restarted on Continue; the call is
                // hung up on Cancel.
                this._cancelAutoStartTimer();
                this.setState({ recordingDisclosurePending: { kind: 'autostart', source } });
            })
            .catch((e) => {
                // Storage read failure → don't silently start a
                // recording without consent. Surface the modal as if
                // the flag were unset; the user can always cancel.
                console.log('[call] disclosure read failed, treating as not-acknowledged:', e && e.message);
                this._cancelAutoStartTimer();
                this.setState({ recordingDisclosurePending: { kind: 'autostart', source } });
            });
    }

    /** Run the original arm-or-start logic that lived inline in
     *  componentDidMount before the disclosure gate was added. Kept
     *  separate so both the "already acknowledged" fast path and the
     *  modal's onContinue can call it. */
    _armOrStartAutoRecord(source) {
        if (this.unmounted) return;
        if (this.state.isRecording || this.state.recordingArmed) return;
        const cs = this.state.call && this.state.call.state;
        if (cs === 'established' || cs === 'accepted' || cs === 'early-media') {
            utils.timestampedLog('[call] auto-record on, call already active — starting recording now (source=',
                source, ')');
            this._startCallRecording();
        } else {
            utils.timestampedLog('[call] auto-record on — arming recorder for auto-start on connect (source=',
                source, ')');
            this.setState({ recordingArmed: true });
        }
    }

    /** Modal callback: user accepted the disclosure. Persist the
     *  flag for this account, dismiss the modal, then dispatch on
     *  the kind of pending request:
     *    'autostart' — resume the call: arm/start recording, then
     *      either let the auto-start timer fire confirmStartCall on
     *      its own deadline (we restart it here) or — if the user
     *      already pressed Start manually before opening the modal —
     *      it'll be a no-op.
     *    'manual' — the user was mid-call and tapped record. Do the
     *      same arm-or-start logic _toggleCallRecording was about to
     *      run when we intercepted it.
     */
    _onRecordingDisclosureContinue = () => {
        const pending = this.state.recordingDisclosurePending;
        // Persist first — fire-and-forget; failure just means
        // they'll re-prompt next call, which is acceptable.
        if (this.props.accountId) {
            setCallRecordingDisclosure(this.props.accountId).catch(() => {});
        }
        this.setState({ recordingDisclosurePending: null });
        if (!pending) return;
        if (pending.kind === 'autostart') {
            // Arm/start recording per the original auto-record
            // request, then dial. Skip the auto-start countdown —
            // the user has already made an explicit choice in the
            // modal, no need to make them wait another 6s.
            this._armOrStartAutoRecord(pending.source);
            this._cancelAutoStartTimer();
            if (this.props.awaitingUserCallStart && this.props.confirmStartCall) {
                this.props.confirmStartCall();
            }
        } else if (pending.kind === 'manual') {
            // Re-run the toggle's start/arm branch directly —
            // bypassing the disclosure check at the top of
            // _toggleCallRecording (which would now pass anyway,
            // but the extra promise round-trip would be wasted).
            this._doStartOrArmFromManualTap();
        }
    };

    /** Modal callback: user dismissed the disclosure.
     *    'autostart' — proceed with the call but WITHOUT recording.
     *      The user wants to make the call; they just don't want
     *      auto-record on this one. Fire confirmStartCall directly
     *      (rather than restart the auto-start countdown) — the
     *      countdown is a "give the user a moment to bail" UX,
     *      and they've already explicitly chosen to proceed by
     *      pressing Cancel here, so no extra delay is warranted.
     *      Recording stays off (we deliberately don't call
     *      _armOrStartAutoRecord); they can opt back in later via
     *      Preferences → "View disclaimer".
     *    'manual' — no-op. The call continues; the recorder stays
     *      off. The user can tap record again later (which would
     *      re-show the disclosure).
     */
    _onRecordingDisclosureCancel = () => {
        const pending = this.state.recordingDisclosurePending;
        this.setState({ recordingDisclosurePending: null });
        if (!pending) return;
        if (pending.kind === 'autostart') {
            utils.timestampedLog('[call] disclosure declined for autostart —',
                'proceeding with call WITHOUT recording, awaitingUserCallStart=',
                this.props.awaitingUserCallStart, 'has confirmStartCall=',
                typeof this.props.confirmStartCall === 'function');
            // Make sure no leftover countdown is ticking (the gate
            // already cancelled it but be defensive — a previous
            // timer could have been restarted by some other path
            // while the modal was up).
            this._cancelAutoStartTimer();
            // Fire confirmStartCall unconditionally on the prop's
            // existence, NOT gated on awaitingUserCallStart. Reason:
            // by the time the user reads the disclosure and taps
            // Cancel, the prop snapshot we hold could be stale
            // relative to the parent's re-render timing — better to
            // call confirmStartCall (which is idempotent — Call.js's
            // implementation just sets userStartedCall=true and the
            // start() polling loop picks it up) than to skip it on
            // a false-negative awaiting check.
            if (typeof this.props.confirmStartCall === 'function') {
                this.props.confirmStartCall();
            }
        }
    };

    /** Auto-start countdown for the outgoing-audio pre-call screen.
     *  Default 6 s; takes an explicit `seconds` arg so the resume path
     *  can pick up from a frozen countdown value. The interval ticks
     *  once per second to update the display + sliding progress bar;
     *  the timeout fires the actual confirmStartCall when 0 is reached.
     *  Idempotent — cancels any previous timer first. */
    _startAutoStartTimer(seconds = 6) {
        this._cancelAutoStartTimer();
        if (this.unmounted) return;
        const startSeconds = Math.max(1, seconds);
        // Clear the paused flag — running again means we're not frozen.
        this.setState({ autoStartCountdown: startSeconds, autoStartPaused: false });
        this._autoStartTickInterval = setInterval(() => {
            if (this.unmounted) {
                this._cancelAutoStartTimer();
                return;
            }
            this.setState((s) => ({
                autoStartCountdown: Math.max(0, (s.autoStartCountdown || 0) - 1)
            }));
        }, 1000);
        this._autoStartTimer = setTimeout(() => {
            this._cancelAutoStartTimer();
            if (this.unmounted) return;
            if (this.props.confirmStartCall && this.props.awaitingUserCallStart) {
                this.props.confirmStartCall();
            }
        }, startSeconds * 1000);
    }

    /** Stop the auto-start countdown — fired on user X-tap, manual
     *  Start tap, transition out of awaiting, and unmount. Safe to
     *  call when no timer is running. */
    _cancelAutoStartTimer() {
        if (this._autoStartTimer) {
            clearTimeout(this._autoStartTimer);
            this._autoStartTimer = null;
        }
        if (this._autoStartTickInterval) {
            clearInterval(this._autoStartTickInterval);
            this._autoStartTickInterval = null;
        }
        if (!this.unmounted && this.state.autoStartCountdown !== 0) {
            this.setState({ autoStartCountdown: 0 });
        }
    }

    /** Stop the timer but keep `autoStartCountdown` so the resume can
     *  pick up where we left off. Called when the device picker opens.
     *  Sets `autoStartPaused` so the progress bar can recolour to
     *  signal "frozen — waiting for you". */
    _pauseAutoStartTimer() {
        if (this._autoStartTimer) {
            clearTimeout(this._autoStartTimer);
            this._autoStartTimer = null;
        }
        if (this._autoStartTickInterval) {
            clearInterval(this._autoStartTickInterval);
            this._autoStartTickInterval = null;
        }
        if (!this.unmounted) {
            this.setState({ autoStartPaused: true });
        }
    }

    /** Resume from the frozen countdown value. If 0 (picker stayed open
     *  past the deadline) fire the call immediately. */
    _resumeAutoStartTimer() {
        if (this.unmounted) return;
        if (!this.props.awaitingUserCallStart) return;
        const remaining = (this.state && this.state.autoStartCountdown) || 0;
        if (remaining <= 0) {
            if (this.props.confirmStartCall) this.props.confirmStartCall();
            return;
        }
        this._startAutoStartTimer(remaining);
    }

    zrtpStateChanged(newState) {
        if (this.unmounted) {
            return;
        }
        this.setState({ zrtpState: newState });
    }

    // Fired by CallZrtp.js when zRTP-mandatory mode fails to agree on
    // keys (no public PGP key for peer, codec incompatible with our
    // FrameEncryptor, or the 10s timer ran out). The user gets to
    // decide: terminate (mandatory enforcement honored) or continue
    // without E2E (downgrade to optional).
    zrtpMandatoryFailed(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[ZRTP] AudioCallBox received zrtpMandatoryFailed:', info);
        this.setState({
            zrtpMandatoryFailedVisible: true,
            zrtpMandatoryFailedInfo: info,
        });
    }

    _onZrtpMandatoryEndCall() {
        this.setState({ zrtpMandatoryFailedVisible: false });
        if (this.state.call) {
            try { this.state.call.terminate(); } catch (e) {}
        }
    }

    _onZrtpMandatoryContinue() {
        this.setState({ zrtpMandatoryFailedVisible: false });
    }

    /** Determine the verification status for the badge. Anchored to the
     *  peer's PGP public key (a stable per-peer value), NOT to the per-call
     *  SAS — the SAS legitimately differs every call due to fresh ephemeral
     *  X25519 keys (forward secrecy).
     *    'unverified' — encrypted but no prior verification, or a legacy
     *                   record without a stored publicKey
     *    'verified'   — prior verification exists and the peer's PGP key
     *                   still matches
     *    'mismatch'   — prior verification exists but the peer's PGP key
     *                   has changed since (key rotation OR potential MITM)
     */
    _zrtpVerificationStatus() {
        if (this.state.zrtpState !== 'key-agreed') return null;
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) return null;
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;
        if (!stored || !stored.publicKey) return 'unverified';
        const currentKey = this.props.callContact && this.props.callContact.publicKey;
        if (currentKey && stored.publicKey === currentKey) return 'verified';
        return 'mismatch';
    }

    _onZrtpBadgePress() {
        if (this.state.zrtpState === 'key-agreed') {
            this.setState({ zrtpDialogVisible: true });
        }
    }

    _onZrtpVerifyConfirm() {
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) {
            this.setState({ zrtpDialogVisible: false });
            return;
        }
        if (this.props.markZrtpVerified && this.state.remoteUri) {
            this.props.markZrtpVerified(this.state.remoteUri, session.sas.chars, session.sas.emojis);
        }
        this.setState({ zrtpDialogVisible: false });
        // Force a re-render so badge flips from "encrypted" to "verified".
        this.forceUpdate();
    }

    componentWillUnmount() {
        console.log('AudioCallBox will unmount');
        this.unmounted = true;
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
        }

        if (this.state.call != null && this.state.call.statistics != null) {
            this.state.call.statistics.removeListener('stats', this.statistics);
        }

        if (this.callTimer) {
            clearTimeout(this.callTimer);
        }

        // Clear the auto-start countdown if the user navigates away
        // before either tapping Start or letting it auto-fire.
        this._cancelAutoStartTimer();

        // If recording was still active when the user hung up / the
        // component went away, stop the recorder cleanly so the WAV
        // file is finalised on disk and the mic resource is released.
        if (this.state.isRecording) {
            this._stopCallRecording().catch(() => {});
        }
        if (this._recordingTickInterval) {
            clearInterval(this._recordingTickInterval);
            this._recordingTickInterval = null;
        }

        // Stop the VU meter sampler.
        this._stopVuSampler();
    }

    /** Start capturing the call to a compressed audio file. On
     *  Android SylkCallRecorder writes Opus-OGG; on iOS it writes
     *  AAC m4a via AVAssetWriter. Both backends mix the mic + remote
     *  audio tracks (stereo, L=mic R=remote) so both sides land in
     *  the file. If SylkCallRecorder reports 'not_implemented' (e.g.
     *  the iOS remote audio track hasn't been added yet) we fall
     *  back to mic-only AAC capture via audioRecorderPlayer.
     *
     *  Filename: `sylk-call-recording-<ts>.ogg` (Android) or
     *  `.m4a` (iOS) in the app's document directory.
     *  _recordingBackend is set so _stopCallRecording knows which API
     *  to call (no global state on the recorder side).
     */
    async _startCallRecording() {
        if (this.state.isRecording) return;
        const ts = Date.now();
        // File format & extension differ per platform. Android's
        // SylkCallRecorder writes Opus-in-OGG (~3 KB/s) via
        // MediaMuxer. iOS's SylkCallRecorder writes 16 kHz stereo
        // AAC m4a via AVAssetWriter (~8 KB/s). The mic-only
        // fallback (used when SylkCallRecorder can't get a remote
        // track) writes AAC m4a too via audioRecorderPlayer.
        // Filename extension reflects the actual on-disk format so
        // chat playback (utils.isAudio + AudioRecorderPlayer) decodes
        // correctly on either platform.
        const recName = Platform.OS === 'android'
            ? `sylk-call-recording-${ts}.ogg`
            : `sylk-call-recording-${ts}.m4a`;
        const fallbackName = `sylk-call-recording-${ts}.m4a`;

        // Resolve a writable absolute path for both backends —
        // MediaMuxer (Android), AVAssetWriter (iOS) and the
        // audioRecorderPlayer fallback all need a real filesystem
        // path.
        const docDir = RNFS && RNFS.DocumentDirectoryPath;
        const absPath = docDir ? `${docDir}/${recName}` : recName;

        let usedBackend = 'fallback';
        let fallbackPath = docDir
            ? `${docDir}/${fallbackName}`
            : fallbackName;
        let usedFilename = fallbackName;
        try {
            if (CallRecorder.available() && this.state.call) {
                // Retry loop. SylkCallRecorder needs a remote AudioTrack
                // to sink, but the auto-record arm fires on
                // callStateChanged 'accepted' which lands BEFORE
                // WebRTC's ontrack adds the receiver. The first attempt
                // typically fails with 'not_implemented' for that
                // reason; the track usually shows up within ~100 ms.
                // Up to ~1 s of waiting before we give up and use the
                // mic-only fallback (audioRecorderPlayer AAC, peaks via
                // currentMetering).
                let result = null;
                for (let attempt = 0; attempt < 10; attempt++) {
                    try {
                        result = await CallRecorder.start(this.state.call, absPath);
                    } catch (err) {
                        result = null;
                    }
                    if (result && result !== 'not_implemented') break;
                    if (this.unmounted || !this.state.call) break;
                    // Brief wait, then check again.
                    await new Promise(r => setTimeout(r, 100));
                }
                if (result && result !== 'not_implemented') {
                    usedBackend = 'callrecorder';
                    usedFilename = recName;
                } else {
                    utils.timestampedLog(
                        '[call] CallRecorder unavailable after 10 attempts — falling back to AAC mic-only (peaks via metering)');
                }
            }

            if (usedBackend !== 'callrecorder') {
                // Mic-only fallback: AAC m4a via audioRecorderPlayer.
                // Same compressed format the native CallRecorder
                // produces (16 kHz stereo on iOS, ~64 kbps; here
                // mono ~32 kbps since we only have the local mic).
                // Peaks come from addRecordBackListener's
                // currentMetering (dBFS) — the remote side stays
                // empty because there's no track to tap on this code
                // path; the bubble's two-waveform UI shows a populated
                // Local strip and a flat-baseline Remote strip.
                this._iosPcmPeaks = { l: [], rIgnored: true };
                const audioSet = {
                    AVFormatIDKeyIOS: AVEncodingOption.aac,
                    AVSampleRateKeyIOS: 16000,
                    AVNumberOfChannelsKeyIOS: 1,
                    AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.medium,
                    AVEncoderBitRateKeyIOS: 32000,
                    AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
                    AudioSourceAndroid: AudioSourceAndroidType.MIC,
                    OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
                    AudioSamplingRateAndroid: 16000,
                    AudioChannelsAndroid: 1,
                    AudioEncodingBitRateAndroid: 32000,
                };
                await _callRecorderPlayer.startRecorder(fallbackPath, audioSet, true);
                _callRecorderPlayer.addRecordBackListener((e) => {
                    // currentMetering in dBFS (-160..0). Map to
                    // 0..255 with a -50 dB noise floor so ambient
                    // tone doesn't clip the bottom of the waveform.
                    const db = (typeof e.currentMetering === 'number')
                        ? e.currentMetering : -160;
                    const NOISE_FLOOR_DB = -50;
                    const norm = Math.max(0, Math.min(1, (db - NOISE_FLOOR_DB) / -NOISE_FLOOR_DB));
                    this._iosPcmPeaks.l.push(Math.round(norm * 255));
                });
            }

            this._recordingBackend = usedBackend;
            this.setState({
                isRecording: true,
                recordingElapsedSec: 0,
                recordingFile: usedBackend === 'callrecorder' ? absPath : fallbackPath,
            });
            this._recordingTickInterval = setInterval(() => {
                if (this.unmounted) return;
                this.setState((s) => ({
                    recordingElapsedSec: (s.recordingElapsedSec || 0) + 1,
                }));
            }, 1000);
            utils.timestampedLog('[call] Call recording started:', usedFilename, 'backend=', usedBackend);
        } catch (e) {
            console.log('Failed to start call recording:', e && e.message);
            this.setState({ isRecording: false });
        }
    }

    /** Stop the recorder and finalise the AAC m4a file (Opus-OGG on
     *  Android via SylkCallRecorder). The path comes back from the
     *  active backend (CallRecorder.stop() for the native paths,
     *  audioRecorderPlayer.stopRecorder() for the mic-only fallback).
     *  After the file lands on disk we hand it to the parent via
     *  `props.saveCallRecording({filePath, remoteUri, durationSec})`
     *  so the chat layer can (a) inject it into the local
     *  conversation as an inbound message from the remote party and
     *  (b) sync it to our other devices through the existing
     *  file-transfer pipeline. */
    async _stopCallRecording() {
        if (this._recordingTickInterval) {
            clearInterval(this._recordingTickInterval);
            this._recordingTickInterval = null;
        }
        if (!this.state.isRecording) return;
        const elapsed = this.state.recordingElapsedSec || 0;
        const backend = this._recordingBackend || 'fallback';
        try {
            let path;
            let peaks = null;
            if (backend === 'callrecorder') {
                // CallRecorder.stop now returns { path, peaks } so the
                // playback VU meter can be driven by real per-100ms
                // amplitude data instead of a synthetic ticker.
                const r = await CallRecorder.stop();
                path  = r && r.path;
                peaks = r && r.peaks;
            } else {
                // AAC mic-only fallback (audioRecorderPlayer). The
                // remote side is empty because there's no track
                // tapping on this path — peaks.r stays an empty
                // array; the bubble's two-waveform UI shows the
                // mic strip and a flat-baseline remote strip.
                try {
                    path = await _callRecorderPlayer.stopRecorder();
                } catch (e) {
                    path = null;
                    console.log('stopRecorder error', e && e.message);
                }
                try { _callRecorderPlayer.removeRecordBackListener(); } catch (_e) {}
                if (this._iosPcmPeaks
                        && Array.isArray(this._iosPcmPeaks.l)
                        && this._iosPcmPeaks.l.length > 0) {
                    peaks = { l: this._iosPcmPeaks.l, r: [] };
                }
                this._iosPcmPeaks = null;
            }
            utils.timestampedLog('[call] Call recording saved:', path,
                'duration', elapsed, 's', 'backend=', backend);
            if (!this.unmounted) {
                this.setState({
                    isRecording: false,
                    recordingFile: path || this.state.recordingFile,
                });
            }
            if (this.props.saveCallRecording && path) {
                try {
                    await this.props.saveCallRecording({
                        filePath: path,
                        remoteUri: this.state.remoteUri,
                        remoteDisplayName: this.state.remoteDisplayName,
                        durationSec: elapsed,
                        peaks: peaks,
                    });
                } catch (e) {
                    console.log('saveCallRecording handler failed:', e && e.message);
                }
            }
        } catch (e) {
            console.log('Failed to stop call recording:', e && e.message);
            if (!this.unmounted) {
                this.setState({ isRecording: false });
            }
        } finally {
            this._recordingBackend = null;
        }
    }

    /** Toggle handler bound to the record button.
     *
     *  Three branches:
     *    - Currently recording → stop.
     *    - Call is live (accepted/established/early-media) → start now.
     *    - Otherwise (pre-call awaiting / dialing / etc.) → flip the
     *      `recordingArmed` flag. The actual recording fires later
     *      from callStateChanged when the call reaches established.
     */
    _toggleCallRecording() {
        if (this.state.isRecording) {
            utils.timestampedLog('[call] user tapped record pill — stop');
            this._stopCallRecording();
            return;
        }
        // STARTING (or arming) — gate on the disclosure flag. Same
        // legal reason as the auto-record path: the user must
        // acknowledge the EU consent summary before we can lawfully
        // capture the call. If they haven't, surface the modal and
        // bail out; the modal's onContinue re-enters this method's
        // start branch directly (see _onRecordingDisclosureContinue).
        readCallRecordingDisclosure(this.props.accountId)
            .then((acknowledged) => {
                if (this.unmounted) return;
                if (!acknowledged) {
                    utils.timestampedLog('[call] manual record requested but disclosure not acknowledged —',
                        'showing disclosure modal');
                    this.setState({ recordingDisclosurePending: { kind: 'manual' } });
                    return;
                }
                this._doStartOrArmFromManualTap();
            })
            .catch((e) => {
                console.log('[call] disclosure read failed on manual tap, treating as not-acknowledged:', e && e.message);
                this.setState({ recordingDisclosurePending: { kind: 'manual' } });
            });
    }

    /** Start-or-arm logic used by both the disclosure-acknowledged
     *  fast path of _toggleCallRecording and the modal's
     *  onContinue. Pulled out so neither caller has to duplicate
     *  the call-state branching. */
    _doStartOrArmFromManualTap() {
        const cs = this.state.call && this.state.call.state;
        if (cs === 'established' || cs === 'accepted' || cs === 'early-media') {
            utils.timestampedLog('[call] user tapped record pill — start (call state=', cs, ')');
            this.setState({ recordingArmed: false });
            this._startCallRecording();
            return;
        }
        const willArm = !this.state.recordingArmed;
        utils.timestampedLog('[call] user tapped record pill — pre-call,',
            willArm ? 'arming for auto-start' : 'cancelling armed state');
        this.setState(s => ({ recordingArmed: !s.recordingArmed }));
    }

    /** Format the elapsed-seconds counter as M:SS for the indicator. */
    _formatRecordingElapsed(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${r < 10 ? '0' : ''}${r}`;
    }

    /** Start a 100 ms interval that polls the peer connection for
     *  inbound audioLevel and feeds it into a smoothed envelope so
     *  the VU meter responds quickly to speech but doesn't flicker
     *  on every micro-pause. Idempotent. */
    _startVuSampler() {
        if (this._vuSamplerInterval) return;
        this._vuSamplerInterval = setInterval(() => {
            this._sampleAudioLevels();
        }, 100);
    }

    /** Stop the VU meter sampler. */
    _stopVuSampler() {
        if (this._vuSamplerInterval) {
            clearInterval(this._vuSamplerInterval);
            this._vuSamplerInterval = null;
        }
    }

    /** One sample tick: pull WebRTC stats, find both the inbound
     *  audio's audioLevel and the local mic's audioLevel (each
     *  normalized 0..1), apply fast-attack / slow-release smoothing,
     *  push into state. getStats() gives a snapshot averaged over
     *  the most recent window — fine for a meter at 10 Hz.
     *
     *  Source mapping:
     *   - remote: `inbound-rtp` audio report's audioLevel
     *   - local : `media-source` report (kind=audio) audioLevel,
     *             which is the mic level the encoder is seeing.
     *             Falls back to `outbound-rtp` audioLevel if the
     *             stack populates it instead. */
    async _sampleAudioLevels() {
        if (this.unmounted) return;
        const call = this.state.call;
        if (!call || !call._pc) return;
        try {
            const stats = await call._pc.getStats();
            let remote = 0;
            let local = 0;
            if (stats && typeof stats.forEach === 'function') {
                stats.forEach((report) => {
                    if (!report) return;
                    const isAudio = (report.kind === 'audio' || report.mediaType === 'audio');
                    if (report.type === 'inbound-rtp'
                            && isAudio
                            && typeof report.audioLevel === 'number') {
                        remote = report.audioLevel;
                    } else if (report.type === 'media-source'
                            && isAudio
                            && typeof report.audioLevel === 'number') {
                        local = report.audioLevel;
                    } else if (report.type === 'outbound-rtp'
                            && isAudio
                            && typeof report.audioLevel === 'number'
                            && local === 0) {
                        // Fallback if the stack doesn't emit media-source
                        // (some older builds expose audioLevel here).
                        local = report.audioLevel;
                    }
                });
            }
            const update = {};
            // Clamp + non-linear scale so soft voice is visible.
            // sqrt(0.04) = 0.2, sqrt(0.25) = 0.5, sqrt(1) = 1.
            const scaledR = Math.min(1, Math.sqrt(Math.max(0, remote)));
            const scaledL = Math.min(1, Math.sqrt(Math.max(0, local)));
            const prevR = this.state.remoteAudioLevel || 0;
            const prevL = this.state.localAudioLevel || 0;
            // Fast attack (instant rise), slow release (~150 ms half-life
            // at 10 Hz: 0.85 multiplier per tick).
            const nextR = scaledR > prevR ? scaledR : (prevR * 0.85 + scaledR * 0.15);
            const nextL = scaledL > prevL ? scaledL : (prevL * 0.85 + scaledL * 0.15);
            // Skip updates that won't change pixels — avoids unnecessary
            // re-renders during silence.
            if (Math.abs(nextR - prevR) > 0.005) update.remoteAudioLevel = nextR;
            if (Math.abs(nextL - prevL) > 0.005) update.localAudioLevel = nextL;
            // Latch a "have we seen any VU data yet" flag the FIRST
            // time either audioLevel is reported. Used by
            // _renderRemoteVuMeter to suppress the "Remote" / "Local"
            // labels for the ~2 s after the call connects but before
            // WebRTC starts publishing audioLevel — without this,
            // labels appeared under fully-unlit bars and looked
            // broken. Once true the flag stays true so the labels
            // don't flicker off during silence.
            if (!this.state.vuMetersHaveData && (remote > 0 || local > 0)) {
                update.vuMetersHaveData = true;
            }
            if (Object.keys(update).length > 0) {
                this.setState(update);
            }
        } catch (e) {
            // getStats can throw transiently during teardown / SDP renegotiation.
        }
    }

    /** Render the pair of VU meters: remote on top, local mic below.
     *  Uses the shared VuMeter component so the in-call meter and the
     *  bubble playback meter render exactly the same widget. The
     *  outer wrapper centres each 60%-wide bar across the screen. */
    _renderRemoteVuMeter() {
        // Suppress the WHOLE VU-meter block (bars AND labels) until
        // WebRTC publishes its first audioLevel sample. The latch in
        // the stats handler sets vuMetersHaveData=true the first
        // time either remote or local audioLevel is non-zero —
        // until then we render nothing, so the user doesn't see
        // unlit bars without labels during the ~2 s between
        // call-connect and the first stats sample. Once the latch
        // flips, bars + labels appear together.
        if (!this.state.vuMetersHaveData) {
            return null;
        }
        return (
            <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
                <VuMeter level={this.state.remoteAudioLevel} label="Remote" width="60%" />
                <VuMeter level={this.state.localAudioLevel}  label="Local"  width="60%" />
            </View>
        );
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevProps.call == null && this.props.call) {
            this.props.call.statistics.on('stats', this.statistics);
        }
        const enteredAwaiting = !prevProps.awaitingUserCallStart && this.props.awaitingUserCallStart;
        const leftAwaiting = prevProps.awaitingUserCallStart && !this.props.awaitingUserCallStart;
        if (enteredAwaiting && this.props.confirmStartCall) {
            this._startAutoStartTimer();
        }
        if (leftAwaiting) {
            this._cancelAutoStartTimer();
        }

        // Pause the auto-start countdown while the device-picker popup
        // is open so the call doesn't auto-fire mid-selection. Resumes
        // from the frozen countdown value when the picker closes.
        if (this.props.awaitingUserCallStart) {
            const wasOpen = !!prevState.audioDevicePickerVisible;
            const isOpen = !!this.state.audioDevicePickerVisible;
            if (!wasOpen && isOpen) {
                this._pauseAutoStartTimer();
            } else if (wasOpen && !isOpen) {
                this._resumeAutoStartTimer();
            }
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Auto-record arming on the call's first appearance. Mirrors the
        // componentDidMount block — if the call object only arrives via
        // props after mount (typical for the outgoing flow), arm the
        // recorder here so the existing callStateChanged auto-start
        // path catches the connect.
        const callJustArrived = nextProps.call !== null
            && nextProps.call !== this.state.call;
        if (callJustArrived
            && !this.state.isRecording
            && !this.state.recordingArmed) {
            // Recompute against the latest contact prop (callContact
            // can arrive in the same UNSAFE_componentWillReceiveProps
            // pass as the call itself for incoming calls).
            const cl2 = nextProps.callContact && nextProps.callContact.localProperties;
            const contactAutoRecord2 = cl2
                ? (cl2.enableAudioRecording === true || cl2.enableAudioRecording === false
                    ? cl2.enableAudioRecording
                    : null)
                : null;
            const wantAutoRecord2 = contactAutoRecord2 !== null
                ? contactAutoRecord2
                : !!nextProps.enableAudioRecording;
            if (wantAutoRecord2) {
                // Disclosure gate (same legal reason as
                // componentDidMount). Defer one tick so the call /
                // listener wiring below this block completes before
                // we read state.call. The fast-path arm is wrapped in
                // _gateAutoRecordOnDisclosure so a not-yet-
                // acknowledged user gets the modal instead of an
                // immediate recording.
                const source = contactAutoRecord2 !== null ? 'contact' : 'device';
                setTimeout(() => {
                    if (this.unmounted) return;
                    this._gateAutoRecordOnDisclosure(source);
                }, 0);
            }
        }

        // Safe listener handling
        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            // Remove previous listener safely
            if (this.state.call != null && this.state.call.removeListener) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
                this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
                this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            }

            // Attach new listener if available
            if (nextProps.call && nextProps.call.on) {
                nextProps.call.on('stateChanged', this.callStateChanged);
                nextProps.call.on('zrtpStateChanged', this.zrtpStateChanged);
                nextProps.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
                // Catch up: if the session already reached key-agreed on a
                // prior mount, pull its state so the badge shows immediately.
                const existing = getZrtpSession(nextProps.call);
                if (existing && existing.state) {
                    this.setState({ zrtpState: existing.state });
                }
            }

            if (nextProps.call && nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            }

            this.setState({ call: nextProps.call, zrtpState: null });
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }
        
        if ('userStartedCall' in nextProps) {
			this.setState({userStartedCall: nextProps.userStartedCall});
		}

        this.setState({
            audioMuted: nextProps.muted,
            info: nextProps.info,
            packetLossQueue: nextProps.packetLossQueue,
            audioBandwidthQueue: nextProps.audioBandwidthQueue,
            latencyQueue: nextProps.latencyQueue,
            remoteUri: nextProps.remoteUri,
            remoteDisplayName: nextProps.remoteDisplayName,
            photo: nextProps.photo ? nextProps.photo : this.state.photo,
            declineReason: nextProps.declineReason,
            callContact: nextProps.callContact,
            audioCodec: nextProps.audioCodec,
            selectedContacts: nextProps.selectedContacts,
            selectedContact: nextProps.selectedContact,
            terminatedReason: nextProps.terminatedReason,
            speakerPhoneEnabled: nextProps.speakerPhoneEnabled,
            localMedia: nextProps.localMedia,
		    availableAudioDevices: nextProps.availableAudioDevices,
			selectedAudioDevice: nextProps.selectedAudioDevice,
			insets: nextProps.insets,
			isLandscape: nextProps.isLandscape
        });
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established') {
            this.attachStream(this.state.call);
            this.setState({reconnectingCall: false});
            // Kick off the VU meter sampler now that there's a media
            // stream to read audioLevel from.
            this._startVuSampler();
            // Honour pre-call "armed" recording requests: if the user
            // tapped the record pill before the call connected, kick
            // off the recorder now that there's actually a media leg
            // to capture.
            if (this.state.recordingArmed && !this.state.isRecording) {
                utils.timestampedLog('[call] call established with armed recorder — starting recording now');
                this.setState({ recordingArmed: false });
                this._startCallRecording();
            }
        }
        if (newState === 'accepted' && this.state.recordingArmed && !this.state.isRecording) {
            // 'accepted' fires before 'established' on some paths
            // (e.g. answer-without-renegotiation). Start as soon as
            // we're in the active range; if the established branch
            // also fires it'll see isRecording=true and skip.
            utils.timestampedLog('[call] call accepted with armed recorder — starting recording now');
            this.setState({ recordingArmed: false });
            this._startCallRecording();
        }
        if (newState === 'terminated') {
            // Hide ZRTP pill (and dismiss any open verification dialog) the
            // moment the call ends, even though the AudioCallBox component
            // sticks around for a few seconds for the wrap-up UI. Also
            // clear any leftover "armed" state — there's no call to
            // start recording on anymore. Stop the VU sampler too —
            // no more audio to meter.
            this._stopVuSampler();
            this.setState({ zrtpState: null, zrtpDialogVisible: false, recordingArmed: false, remoteAudioLevel: 0, localAudioLevel: 0, vuMetersHaveData: false });

            // Auto-stop the recording on call end. componentWillUnmount
            // already does this when AudioCallBox actually unmounts, but
            // on the callee side the box hangs around for the wrap-up
            // screen — the timer was happily ticking after the call
            // died because nothing else stopped it.
            if (this.state.isRecording) {
                utils.timestampedLog('[call] auto-stopping recording — call terminated');
                this._stopCallRecording();
            }
        }
    }

    attachStream(call) {
        this.setState({stream: call.getRemoteStreams()[0]}); //we dont use it anywhere though as audio gets automatically piped
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    hangupCall() {
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall() {
        // X-tap on the awaiting screen also cancels the auto-start
        // countdown so a stray fire doesn't race the hangup.
        this._cancelAutoStartTimer();
        this.props.hangupCall('user_cancel_call');
    }

    muteAudio() {
        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
    }

    statistics(stats) {
        // The previous version of this function early-returned whenever
        // any of remote-inbound / local-inbound / local-outbound was
        // absent, which left audioGraphData empty on builds where the
        // peer's inbound rtp record isn't surfaced to JS — that in turn
        // hid the TrafficStats bar-chart entirely (BarChart.js renders
        // nothing when data is empty). Be defensive instead: fall back
        // to whatever stats are available so the bar-chart and the
        // speedometer always see something to draw.
        const { audio, connection } = stats.data || {};
        const remoteAudio   = stats.data?.remote?.audio;
        const inboundAudio  = audio?.inbound?.[0];
        const outboundAudio = audio?.outbound?.[0];
        const remoteInbound = remoteAudio?.inbound?.[0];

        if (!inboundAudio && !outboundAudio) return;

        // RTT: prefer the remote-inbound report (peer-measured RTT for
        // OUR upstream) and fall back to the ICE pair's currentRTT,
        // which is always populated for established calls.
        const rttSec = (remoteInbound && typeof remoteInbound.roundTripTime === 'number')
            ? remoteInbound.roundTripTime
            : (connection?.currentRoundTripTime || 0);
        const latency = (rttSec / 2) * 1000;

        // Codec: try remote-inbound first (peer's view of the codec we
        // send), then either local rtp record. mimeType comes back as
        // "audio/opus" — strip the prefix.
        const rawCodec = remoteInbound?.mimeType
                      || inboundAudio?.mimeType
                      || outboundAudio?.mimeType
                      || '';
        const audioCodec = (rawCodec.split?.('/')?.[1]) || rawCodec || '';

        const addData = {
            timestamp: audio?.timestamp || Date.now(),
            incomingBitrate: inboundAudio?.bitrate || 0,
            outgoingBitrate: outboundAudio?.bitrate || 0,
            latency,
            jitter: inboundAudio?.jitter || 0,
            packetsLostOutbound: remoteInbound?.packetLossRate || 0,
            packetsLostInbound: inboundAudio?.packetLossRate || 0,
            packetRateOutbound: outboundAudio?.packetRate || 0,
            packetRateInbound: inboundAudio?.packetRate || 0,
            audioCodec
        };

        this.setState(state => ({
            audioGraphData: [...state.audioGraphData, addData].slice(-MAX_POINTS)
        }));
    }

	toggleAudioDevice() {
		console.log('toggleAudioDevice');

		const devices = this.props.availableAudioDevices;
		const current = this.props.selectedAudioDevice;

		if (!devices || devices.length === 0) return;

		// Find current index
		const currentIndex = devices.indexOf(current);

		// Compute next index (wrap around)
		const nextIndex = (currentIndex + 1) % devices.length;

		// Select next device
		const nextDevice = devices[nextIndex];

		console.log('Switching audio device to:', nextDevice);
		this.props.selectAudioDevice(nextDevice);
	}

	renderAudioDevicePicker(buttonSize, buttonStyle, remountKey, slotStyle) {
		const devices = this.props.availableAudioDevices || [];
		const selectedIcon = utils.availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || 'phone-in-talk';
		const _rk = remountKey || '';
		const _slot = slotStyle || styles.buttonContainer;

		// If there's only a single audio device (or none), there's nothing
		// for the user to switch to — hide the picker entirely.
		if (devices.length <= 1) {
			return null;
		}

		// Variant 1: cycle through devices on tap
		if (AUDIO_DEVICE_PICKER_MODE === 'cycle') {
			return (
				<View style={_slot}>
					<TouchableHighlight style={styles.roundshape}>
						<IconButton
							key={'cb-btn-audio-' + _rk}
							size={buttonSize}
							style={buttonStyle}
							icon={selectedIcon}
							onPress={() => this.toggleAudioDevice()}
						/>
					</TouchableHighlight>
				</View>
			);
		}

		// Variant 2: react-native-paper Menu (icon + device name per row)
		if (AUDIO_DEVICE_PICKER_MODE === 'menu') {
			return (
				<Menu
					visible={this.state.audioDevicePickerVisible}
					onDismiss={() => this.setState({audioDevicePickerVisible: false})}
					anchor={
						<View style={_slot}>
							<TouchableHighlight style={styles.roundshape}>
								<IconButton
									key={'cb-btn-audio-' + _rk}
									size={buttonSize}
									style={buttonStyle}
									icon={selectedIcon}
									onPress={() => this.setState({audioDevicePickerVisible: true})}
								/>
							</TouchableHighlight>
						</View>
					}
				>
					{devices.map(device => {
						const isSelected = device === this.props.selectedAudioDevice;
						const deviceIcon = utils.availableAudioDevicesIconsMap[device] || 'phone-in-talk';
						const deviceName = utils.availableAudioDeviceNames[device] || device;
						return (
							<Menu.Item
								key={device}
								icon={deviceIcon}
								title={isSelected ? `✓ ${deviceName}` : deviceName}
								onPress={() => {
									this.setState({audioDevicePickerVisible: false});
									setTimeout(() => this.props.selectAudioDevice(device), 50);
								}}
							/>
						);
					})}
				</Menu>
			);
		}

		// Variant 3: WhatsApp-style floating icon buttons stacked above the main button
		if (AUDIO_DEVICE_PICKER_MODE === 'floating') {
			const otherDevices = devices.filter(d => d !== this.props.selectedAudioDevice);
			return (
				<View style={[_slot, {position: 'relative'}]}>
					{this.state.audioDevicePickerVisible && otherDevices.length > 0 && (
						<View style={{
							position: 'absolute',
							bottom: '100%',
							left: 0,
							right: 0,
							alignItems: 'center',
							marginBottom: 4,
							zIndex: 100,
							elevation: 10,
						}}>
							{otherDevices.map(device => (
								<TouchableHighlight key={device} style={[styles.roundshape, {marginBottom: 21}]}>
									<IconButton
										key={'cb-btn-audio-other-' + device + '-' + _rk}
										size={buttonSize}
										style={buttonStyle}
										icon={utils.availableAudioDevicesIconsMap[device] || 'phone-in-talk'}
										onPress={() => {
											this.props.selectAudioDevice(device);
											this.setState({audioDevicePickerVisible: false});
										}}
									/>
								</TouchableHighlight>
							))}
						</View>
					)}
					<TouchableHighlight style={styles.roundshape}>
						<IconButton
							key={'cb-btn-audio-' + _rk}
							size={buttonSize}
							style={buttonStyle}
							icon={selectedIcon}
							onPress={() => this.setState({audioDevicePickerVisible: !this.state.audioDevicePickerVisible})}
						/>
					</TouchableHighlight>
				</View>
			);
		}

		return null;
	}

    showDtmfModal() {
        this.setState({showDtmfModal: true});
    }

    hideDtmfModal() {
        this.setState({showDtmfModal: false});
    }

    toggleEscalateConferenceModal() {
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }
        this.setState({
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    handleDoubleTap() {
        const now = Date.now();
        const DOUBLE_PRESS_DELAY = 300;
        if (this.lastTap && now - this.lastTap < DOUBLE_PRESS_DELAY) {
          this.props.showLogs();
        } else {
          this.lastTap = now;
        }
    }

    toggleStatsView() {
        this.setState(s => ({ showOldStats: !s.showOldStats }));
    }

    /** Render the record-call pill. Three visual states:
     *    - Idle:   white-translucent pill with a small red dot, label
     *              "Record call".
     *    - Armed:  orange pill, label "Will record" — user tapped it
     *              before the call was live; it'll auto-fire when the
     *              call reaches accepted/established.
     *    - Active: red pill with a white dot, label
     *              "Recording M:SS".
     *  Tap behaviour is delegated to _toggleCallRecording, which
     *  decides between start / stop / arm based on call state.
     */
    _renderRecordControl() {
        const isRec = !!this.state.isRecording;
        const isArmed = !isRec && !!this.state.recordingArmed;

        let bg, label, dotColor;
        if (isRec) {
            bg = 'rgba(220, 30, 30, 0.95)';
            dotColor = '#fff';
            label = `Recording ${this._formatRecordingElapsed(this.state.recordingElapsedSec)}`;
        } else if (isArmed) {
            bg = 'rgba(230, 140, 0, 0.95)';
            dotColor = '#fff';
            label = 'Will record';
        } else {
            bg = 'rgba(255, 255, 255, 0.18)';
            dotColor = '#e53935';
            label = 'Record call';
        }

        return (
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    this._toggleCallRecording();
                }}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: bg,
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: 18,
                }}
            >
                <View style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: dotColor,
                    marginRight: 8,
                }} />
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>
                    {label}
                </Text>
            </TouchableOpacity>
        );
    }

    /** Absolutely-positioned wrapper that sits just above the bottom
     *  action button bar. Same vertical position whether we're in the
     *  awaiting-call-start state or the in-call state, so the button
     *  doesn't visually jump when the call connects.
     *
     *  Hidden in two cases:
     *    - The audio-device picker menu is open: that menu uses the
     *      WhatsApp-style "floating IconButtons stacked above the
     *      main button" layout, and 2-3 of those items would overlap
     *      the record pill. The user is making a routing choice in
     *      that moment and the record affordance can step out of
     *      the way.
     *    - The call has terminated: AudioCallBox sticks around for
     *      ~5 s of wrap-up UI (call summary, ZRTP fade), but the
     *      recorder is already stopped and there's nothing to
     *      record on a dead call. Don't tease a Record button on
     *      a call that's already over.
     */
    _renderRecordControlOverlay() {
        if (this.state.audioDevicePickerVisible) {
            return null;
        }
        const cs = this.state.call && this.state.call.state;
        if (cs === 'terminated') {
            return null;
        }
        // In folded (cover-display) layout the record pill is rendered
        // inline under the avatar inside foldedCallerColumn — see the
        // isFolded branch in render(). Skip the floating overlay so we
        // don't draw it twice.
        if (this.props.isFolded) {
            return null;
        }
        return (
            <View
                pointerEvents="box-none"
                style={{
                    position: 'absolute',
                    bottom: 130,
                    left: 0,
                    right: 0,
                    alignItems: 'center',
                    zIndex: 1500,
                    elevation: 25,
                }}
            >
                {this._renderRecordControl()}
            </View>
        );
    }

    /** Render BOTH the AudioSpeedometer and the legacy TrafficStats
     *  bar-chart, hiding the inactive one with display:'none' instead
     *  of conditional mounting. This keeps the speedometer's
     *  call.statistics listener attached across toggles, so its
     *  needles don't reset to zero (or stale-snapshot) every time the
     *  user flips views. The whole block is wrapped in a
     *  TouchableOpacity — a single tap anywhere on the stats flips
     *  between the two views. The ZRTP badge (passed in via `footer`)
     *  sits below either view in the same spot so users always see
     *  verification state in the same place. The record-call button
     *  is rendered between the speedometer and the ZRTP footer.
     */
    renderStatsBlock(remountKey, footer) {
        // No useful stats before the media starts flowing — hide the
        // whole block until the call reaches 'established'. The ZRTP
        // badge that normally rides along with the stats is still
        // rendered (without the dial) so the user sees verification
        // state during ringing.
        const cs = this.state.call && this.state.call.state;
        const isConnected = cs === 'established' || cs === 'accepted';
        if (!isConnected) {
            return footer || null;
        }

        const showOld = this.state.showOldStats;
        return (
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={this.toggleStatsView}
            >
                <View style={{ display: showOld ? 'flex' : 'none' }}>
                    <TrafficStats
                        key={'cb-stats-' + remountKey}
                        isTablet={this.props.isTablet}
                        isLandscape={this.state.isLandscape}
                        isFolded={this.props.isFolded}
                        data={this.state.audioGraphData}
                        media="audio"
                        footer={showOld ? footer : null}
                    />
                </View>
                <View style={{
                    display: showOld ? 'none' : 'flex',
                    alignItems: 'center',
                }}>
                    <AudioSpeedometer
                        key={'cb-spd-' + remountKey}
                        call={this.state.call}
                        audioCodec={this.props.audioCodec}
                        isFolded={this.props.isFolded}
                    />
                    {!showOld ? this._renderRemoteVuMeter() : null}
                    {!showOld ? footer : null}
                </View>
            </TouchableOpacity>
        );
    }

	renderAudioDeviceButtons() {
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  //console.log('renderAudioDeviceButtons', selectedAudioDevice);
	  
	  if (!call) {
		 return null;
	  }
	
	  if (call.state !== 'established' && call.state !== 'accepted' ) {
	     console.log('Call state is not established or accepted:', call.state);
		 return null;
 	  }
	 
	  if (this.props.useInCallManger) {
	     console.log('useInCallManger');
		 return null;
	  }

      if (!availableAudioDevices) return null;
	  
	  return (
		<View style={styles.audioDeviceContainer}>
		  {availableAudioDevices.map((device) => {
			const icon = utils.availableAudioDevicesIconsMap[device];
			if (!icon) return null;
	
			const isSelected = device === selectedAudioDevice;
	
		return (
		  <View
			key={device}
			style={[
			  styles.audioDeviceButtonContainer,
			  isSelected && styles.audioDeviceSelected
			]}
		  >
			<TouchableHighlight>
			  <IconButton
				size={34}
				style={styles.audioDeviceWhiteButton}
				icon={icon}
				onPress={() => this.props.selectAudioDevice(device)}
			  />
			</TouchableHighlight>
			  </View>
			);
		  })}
		</View>
	  );
	}

    render() {

        let buttonContainerClass;
        let userIconContainerClass;

        const remoteIdentity = {
            uri: this.state.remoteUri || '',
            name: this.state.remoteDisplayName || '',
            photo: this.state.photo
        };

        const username = this.state.remoteUri.split('@')[0];
        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

        let displayName = this.state.remoteUri ? toTitleCase(this.state.remoteUri.split('@')[0]) : '';

        if (this.state.remoteDisplayName && this.state.remoteUri !== this.state.remoteDisplayName) {
            displayName = this.state.remoteDisplayName;
        }

        // Display URI: for calls placed to a phone number we strip the
        // SIP domain (e.g. '+40xxxx@sylk.link' → '+40xxxx') so the
        // dialed number — what the user actually picked from the
        // address book — is what's shown in the call screen. Non-phone
        // SIP URIs keep their full form so the user can see the
        // remote's full identity (user@domain).
        const displayUri = (isPhoneNumber && username) ? username : this.state.remoteUri;

        if (this.props.isTablet) {
            buttonContainerClass = this.state.isLandscape ? styles.tabletLandscapeButtonContainer : styles.tabletPortraitButtonContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonContainerClass = this.state.isLandscape ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
            userIconContainerClass = styles.userIconContainer;
        }

        // Folded (cover display) overrides — very limited vertical room.
        if (this.props.isFolded) {
            buttonContainerClass = styles.foldedButtonContainer;
        }

        const buttonSize = this.props.isTablet ? 40 : (this.props.isFolded ? 32 : 34);

        // Per-button slot + hangup spacer differ between folded and
        // unfolded so buttons pack tighter on the narrow cover display.
        const slotContainerStyle = this.props.isFolded ? styles.foldedSlotContainer : styles.buttonContainer;
        const hangupMarginLeft = this.props.isFolded ? 24 : 30;

        let disableChat = false;
        // Test calls (e.g. echo / playback / IVR test endpoints
        // tagged 'test' in the contact list) shouldn't surface the
        // "add to conference" invite button — there's nobody on the
        // other end to invite into a multi-party call. Tracking this
        // separately from disableChat so the invite button can be
        // hidden without also disabling the chat button.
        let isTestCall = false;
        if (this.state.callContact) {
            if (isPhoneNumber) disableChat = true;
            if (this.state.callContact.tags.indexOf('conference') > -1) disableChat = true;
            if (this.state.callContact.tags.indexOf('test') > -1) isTestCall = true;
        }

        let whiteButtonClass         = Platform.OS === 'ios' ? styles.whiteButtoniOS         : styles.whiteButton;
        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS         : styles.greenButton;
        let hangupButtonClass        = Platform.OS === 'ios' ? styles.hangupButtoniOS        : styles.hangupButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS : styles.disabledGreenButton;
        
        let userIconSize;
        if (this.props.isFolded) {
            // Folded avatar enlarged 25% (90 → 113) — the rest of
            // the cover-display layout (foldedTopRow.height = 140)
            // still accommodates the avatar + name + URI stack
            // because the row's overflow defaults to visible, and
            // the bottom row sits below it with marginTop:56 of
            // breathing room.
            userIconSize = 113;
        } else {
            // Portrait avatar shrunk 25% (150 → 113) so the
            // record-call pill overlay no longer overlaps the
            // "Tap to verify" sub-label of the ZRTP badge on
            // shorter portrait screens. Landscape avatar
            // unchanged — that layout is two-column and the
            // record overlay sits well below the right-hand
            // stats block.
            userIconSize = this.state.isLandscape ? 75 : 113;
        }

        // Force-remount key for the audio call UI. Same stale-native-frame
        // problem we hit on NavigationBar / ReadyBox: IconButtons and Text
        // cache their measured frames at the density they were first
        // mounted under, so we remount them when fold state or window
        // dimensions change.
        const { width: _cbW, height: _cbH } = Dimensions.get('window');
        const _callRemountKey = (this.props.isFolded ? 'f' : 'u')
            + '-' + (this.state.isLandscape ? 'l' : 'p')
            + '-' + Math.round(_cbW) + 'x' + Math.round(_cbH);

        let extraStyles = {};
        let extraButtonContainerClass = {};       
        let container = styles.container;
        
        // ZRTP indicator — rendered inline below the TrafficStats packet
        // loss graph. Hidden during the transient "negotiating" stage and
        // only shown once keys are agreed (so the user doesn't see a
        // yellow pill flash on every setup). Distinct look once the user
        // has verified SAS for this contact.
        // Tap the pill (when key-agreed) to open the SAS verification modal.
        const renderZrtpBadge = () => {
            if (this.state.zrtpState !== 'key-agreed') {
                return null;
            }
            let bg, label;
            const status = this._zrtpVerificationStatus();
            if (status === 'verified') {
                bg = 'rgba(0, 170, 80, 0.9)';     // green — verified
                label = '🔒 zRTP verified';
            } else if (status === 'mismatch') {
                bg = 'rgba(200, 30, 30, 0.9)';    // red — failed/MITM
                label = '⚠ SAS changed';
            } else {
                bg = 'rgba(230, 120, 0, 0.95)';   // orange — unverified
                label = '🔒 zRTP end-to-end encrypted';
            }
            const isTappable = true;
            const inner = (
                <View style={{
                    backgroundColor: bg,
                    paddingVertical: 3,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                }}>
                    <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{label}</Text>
                </View>
            );
            // Dim "Tap to verify" sub-label is always shown (even on
            // the green verified state) so the pill always invites
            // the user to re-check / open the SAS dialog. The pill
            // itself no longer carries the "(tap to verify)" suffix —
            // the call-to-action lives here as a quieter sub-label so
            // the pill can stay focused on conveying the encrypted
            // state.
            // marginTop separates the badge from the stats dial.
            // Same value across folded and unfolded — the badge
            // now renders inside renderStatsBlock in both layouts,
            // so it always sits directly under the speedometer.
            return (
                <View style={{ alignItems: 'center', marginTop: 26 }}>
                    {isTappable ? (
                        <TouchableOpacity onPress={this._onZrtpBadgePress}>{inner}</TouchableOpacity>
                    ) : inner}
                    <Text style={{
                        color: 'rgba(255, 255, 255, 0.55)',
                        fontSize: 10,
                        fontStyle: 'italic',
                        marginTop: 4,
                    }}>
                        Tap to verify
                    </Text>
                </View>
            );
        };

        // ZRTP SAS verification dialog — opened by tapping the green pill.
        const zrtpSession = this.state.zrtpDialogVisible ? getZrtpSession(this.state.call) : null;
        const zrtpSas = zrtpSession && zrtpSession.sas;
        const verificationStatus = this._zrtpVerificationStatus();
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;

        return (
            <View style={[styles.container, {borderColor: 'blue', borderWidth: 0}, extraStyles]}>
                <Portal>
                    <Dialog
                        visible={this.state.zrtpDialogVisible}
                        onDismiss={() => this.setState({ zrtpDialogVisible: false })}
                    >
                        <Dialog.Title>Verify zRTP encryption</Dialog.Title>
                        <Dialog.Content>
                            <Text style={{ marginBottom: 12 }}>
                                Compare these with the other party. Both phones must show the same letters AND emojis.
                            </Text>
                            {zrtpSas ? (
                                <View style={{ alignItems: 'center', marginVertical: 12 }}>
                                    <Text style={{ fontSize: 36, fontWeight: 'bold', letterSpacing: 8 }}>{zrtpSas.chars}</Text>
                                    <Text style={{ fontSize: 32, marginTop: 6, letterSpacing: 6 }}>{zrtpSas.emojis}</Text>
                                </View>
                            ) : (
                                <Text>Waiting for handshake to complete…</Text>
                            )}
                            {verificationStatus === 'verified' && stored && (
                                <Text style={{ color: 'green', marginTop: 8 }}>
                                    ✓ Previously verified on {new Date(stored.verifiedAt).toLocaleString()}
                                </Text>
                            )}
                            {verificationStatus === 'mismatch' && stored && (
                                <Text style={{ color: 'red', marginTop: 8 }}>
                                    ⚠ The other party's identity key has changed since the last verification on {new Date(stored.verifiedAt).toLocaleString()}. They may have reinstalled — or this could be a MITM. Re-verify carefully before tapping Match.
                                </Text>
                            )}
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={() => this.setState({ zrtpDialogVisible: false })}>Close</Button>
                            <Button onPress={this._onZrtpVerifyConfirm} disabled={!zrtpSas}>Match</Button>
                        </Dialog.Actions>
                    </Dialog>
                    {/* zRTP mandatory-mode handshake failure prompt. */}
                    <Dialog
                        visible={this.state.zrtpMandatoryFailedVisible}
                        onDismiss={this._onZrtpMandatoryContinue}
                        dismissable={false}
                    >
                        <Dialog.Title>End-to-end encryption failed</Dialog.Title>
                        <Dialog.Content>
                            <Text>
                                The zRTP key exchange did not complete. You set
                                encryption to "mandatory" in Preferences, but the
                                other party may not support it.
                                {'\n\n'}
                                You can end the call now, or continue without
                                end-to-end encryption. The call will still be
                                encrypted between your phone and the SylkServer
                                relay (DTLS), but the relay can read the media.
                            </Text>
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={this._onZrtpMandatoryContinue}>
                                Continue
                            </Button>
                            <Button mode="contained" onPress={this._onZrtpMandatoryEndCall}>
                                End call
                            </Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteUri={this.state.remoteUri}
                    remoteDisplayName={this.state.remoteDisplayName}
                    call={this.state.call}
                    reconnectingCall={this.state.reconnectingCall}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                    media='audio'
                    localMedia={this.state.localMedia}
                    declineReason={this.state.declineReason}
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                    terminatedReason={this.state.terminatedReason}
                    isLandscape={this.state.isLandscape}
                    isFolded={this.props.isFolded}
					hangupCall = {this.hangupCall}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
					shareLocationFromCall = {this.props.shareLocationFromCall}
					requestLocationFromCall = {this.props.requestLocationFromCall}
					showDtmfFunc = {this.showDtmfModal}
                />

				{this.props.isFolded ? (
					<>
						{/* foldedTopRow always uses the same marginTop
						    (from the stylesheet) — no conditional bump
						    for the awaiting state — so the avatar's
						    vertical position never moves between
						    pre-call and in-call. Right-column content
						    changes (Start button → speedometer) but is
						    centered inside its own column, and the
						    column itself stretches to the avatar
						    column's height (alignItems:stretch on the
						    row). Result: the LEFT side and the bottom
						    row stay put across state transitions. */}
						<View
							key={'cb-toprow-' + _callRemountKey}
							style={styles.foldedTopRow}
						>
							<View style={styles.foldedCallerColumn}>
								<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
								<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.foldedDisplayName} numberOfLines={1}>{displayName}</Dialog.Title>
								<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
									<Text key={'cb-uri-' + _callRemountKey} style={styles.foldedUri} numberOfLines={1}>{displayUri}</Text>
								</TouchableWithoutFeedback>
							</View>
							<View style={styles.foldedStatsColumn}>
								{/* In folded outgoing-audio pre-call
								    state, the Start audio call button +
								    countdown progress bar live HERE in
								    the right column (next to the
								    avatar) rather than as an absolutely-
								    positioned overlay near the action
								    bar. On the cover display the overlay
								    landed on top of the avatar; pulling
								    it into the column gives both halves
								    of the top row a clear job: caller
								    identity on the left, call action on
								    the right.

								    Once the call is connected the same
								    slot renders the stats block
								    (speedometer). renderStatsBlock
								    returns null while not yet
								    established, so the two states never
								    fight for the space. Pass null as
								    the footer so the ZRTP badge is NOT
								    rendered here — in folded view it's
								    hoisted into the bottom row below
								    alongside the record pill so the two
								    share a single baseline. */}
								{this.props.awaitingUserCallStart && this.props.confirmStartCall ? (
									// flex:1 + alignSelf:'stretch' lets this
									// wrapper fill the foldedStatsColumn's
									// height (the column was switched to
									// justifyContent:'flex-start' so the
									// speedometer's top would line up with
									// the avatar). justifyContent:'center'
									// inside the wrapper then re-centers
									// the Start-call button + countdown
									// bar vertically against the avatar
									// column's mid-line during the
									// pre-call awaiting state.
									<View style={{
										flex: 1,
										alignSelf: 'stretch',
										alignItems: 'center',
										justifyContent: 'center',
									}}>
										<Button
											mode="contained"
											onPress={() => {
												this._cancelAutoStartTimer();
												if (this.props.confirmStartCall) {
													this.props.confirmStartCall();
												}
											}}
											// Right margin pulls the
											// Start button (and the
											// countdown bar below it)
											// away from the cover-
											// display's right edge.
											// minWidth holds the
											// button at its widest
											// label ("Start audio
											// call (10)") so the
											// button doesn't visibly
											// shrink as the countdown
											// ticks 10 → 1 → blank.
											style={{ marginRight: 12, minWidth: 180 }}
										>
											{this.state.autoStartCountdown > 0
												? `Start audio call (${this.state.autoStartCountdown})`
												: 'Start audio call'}
										</Button>
										<View style={{
											flexDirection: 'row',
											marginTop: 10,
											height: 6,
											// Sized to roughly match the
											// Start-call button's natural
											// width on the folded right
											// column. alignSelf:'stretch'
											// (full column) was too wide,
											// 100 px was too narrow, 150
											// hugs the button.
											width: 150,
											justifyContent: 'space-between',
											// Match the Start button's
											// right margin so the
											// countdown bar lines up
											// with the button width.
											marginRight: 12,
										}}>
											{[...Array(6)].map((_, i) => (
												<View
													key={'autostart-cell-folded-' + i}
													style={{
														flex: 1,
														marginHorizontal: 1,
														borderRadius: 2,
														backgroundColor: i < (this.state.autoStartCountdown || 0)
															? (this.state.autoStartPaused
																? 'rgba(255,255,255,0.85)'
																: 'rgba(0,200,90,0.9)')
															: 'rgba(255,255,255,0.20)',
													}}
												/>
											))}
										</View>
									</View>
								) : (
									this.renderStatsBlock(_callRemountKey, renderZrtpBadge())
								)}
							</View>
						</View>

						{/* Folded bottom row: record-call pill on the left
						    (directly under the avatar column), ZRTP badge
						    on the right (under the stats column), both
						    anchored to the row's top edge so they share
						    a single baseline.

						    Record pill is intentionally NOT gated on
						    this.state.call — in the outgoing pre-call
						    awaiting state there's no call object yet,
						    but the user must still be able to tap the
						    pill to "arm" the recorder so it auto-fires
						    when the call reaches accepted/established.
						    Same hide rules as
						    _renderRecordControlOverlay: skip while the
						    audio-device picker is open, and skip once
						    the call has terminated. */}
						<View key={'cb-bottomrow-' + _callRemountKey} style={styles.foldedBottomRow}>
							<View style={styles.foldedBottomLeft}>
								{(!this.state.audioDevicePickerVisible
									&& !(this.state.call && this.state.call.state === 'terminated')) ?
									this._renderRecordControl()
								: null}
							</View>
							<View style={styles.foldedBottomRight} />
						</View>
					</>
				) : this.state.isLandscape && !this.props.isTablet ? (
					/* Landscape on a regular phone: two-column layout — caller
					   info on the left, stats (with ZRTP badge) on the right. */
					<View key={'cb-landscape-row-' + _callRemountKey} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: -20 }] }}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
							<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.displayName}>{displayName}</Dialog.Title>
							<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
								<Text key={'cb-uri-' + _callRemountKey} style={styles.uri}>{displayUri}</Text>
							</TouchableWithoutFeedback>
						</View>
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
							{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
						</View>
					</View>
				) : (
					<>
						<View key={'cb-usericon-wrap-' + _callRemountKey} style={userIconContainerClass}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
						</View>

						<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.displayName}>{displayName}</Dialog.Title>
						<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
							<Text key={'cb-uri-' + _callRemountKey} style={styles.uri}>{displayUri}</Text>
						</TouchableWithoutFeedback>

						{false && (
						  <View style={styles.confirmContainer}>
								<Text style={styles.confirm}>Please confirm...</Text>
								<View style={[buttonContainerClass, extraButtonContainerClass]}>
								<View style={styles.buttonContainer}>
								  <TouchableHighlight style={styles.roundshape}>
									<IconButton
										size={buttonSize}
										style={greenButtonClass}
										icon="phone"
										onPress={this.props.confirmStartCall}
									/>
								</TouchableHighlight>
							  </View>
								<View style={styles.buttonContainer}>
								  <TouchableHighlight style={styles.roundshape}>
									<IconButton
										size={buttonSize}
										style={hangupButtonClass}
										icon="phone-hangup"
										onPress={this.cancelCall}
									/>
								</TouchableHighlight>
							  </View>
							  </View>
							  </View>
							  )}

						{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
					</>
				)}

                {!this.state.isLandscape && this.state.reconnectingCall ?
                    <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={'#D32F2F'} />
                    : null
                }

                {this.state.call && ((this.state.call.state === 'accepted' || this.state.call.state === 'established' || this.state.call.state === 'early-media') && !this.state.reconnectingCall) ?
                        <>
                        {this._renderRecordControlOverlay()}
                        <View key={'cb-btnbar-' + _callRemountKey} style={[buttonContainerClass, extraButtonContainerClass]}>
                            {!disableChat ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-chat-' + _callRemountKey}
                                            size={buttonSize}
                                            style={disableChat ? disabledGreenButtonClass : greenButtonClass}
                                            icon="chat"
                                            onPress={this.props.goBackFunc}
                                            disabled={disableChat} />
                                    </TouchableHighlight>
                                </View>
                                : null}

                            {/* "Add to conference" invite button —
                                temporarily commented out at user
                                request. The action-bar was getting
                                crowded and the kebab-menu route into
                                an in-call invite is sufficient for
                                now. The handler / state machine for
                                inviteToConferenceFunc + the
                                EscalateConferenceModal underneath are
                                untouched, so re-enabling this is a
                                one-block uncomment when we want it
                                back. */}
                            {false && !disableChat && !isTestCall ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-invite-' + _callRemountKey}
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="account-plus"
                                            onPress={this.props.inviteToConferenceFunc}
                                            disabled={disableChat} />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={slotContainerStyle}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        key={'cb-btn-mute-' + _callRemountKey}
                                        size={buttonSize}
                                        style={whiteButtonClass}
                                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                                        onPress={this.muteAudio} />
                                </TouchableHighlight>
                            </View>

                            {this.renderAudioDevicePicker(buttonSize, whiteButtonClass, _callRemountKey, slotContainerStyle)}

                            {/* Dialpad icon — surfaces the DTMF
                                modal during the call. Shown when:
                                  (a) the destination is a phone
                                      number (URI parses as one), OR
                                  (b) the contact is explicitly
                                      tagged 'tel' (e.g. a contact
                                      saved from AddressBook for a
                                      SIP-backed PSTN gateway whose
                                      URI may not look numeric).
                                AND audio is flowing — call state
                                'early-media' / 'accepted' /
                                'established'. Before audio is
                                flowing the IVR can't hear DTMF
                                anyway, so the icon stays hidden
                                until then to avoid implying it'd
                                work earlier. */}
                            {((isPhoneNumber)
                              || (this.state.callContact
                                  && Array.isArray(this.state.callContact.tags)
                                  && this.state.callContact.tags.indexOf('tel') > -1))
                              && this.state.call
                              && (this.state.call.state === 'early-media'
                                  || this.state.call.state === 'accepted'
                                  || this.state.call.state === 'established') ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-dtmf-' + _callRemountKey}
                                            // Match the other
                                            // action-bar buttons —
                                            // the previous 25% bump
                                            // made the inner glyph
                                            // overflow visually past
                                            // the white circle.
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="dialpad"
                                            onPress={this.showDtmfModal}
                                        />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={[slotContainerStyle, {marginLeft: hangupMarginLeft}]}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        key={'cb-btn-hangup-' + _callRemountKey}
                                        size={buttonSize}
                                        style={hangupButtonClass}
                                        icon="phone-hangup"
                                        onPress={this.hangupCall} />
                                </TouchableHighlight>
                            </View>
                        </View></>
                    :

                    this.props.awaitingUserCallStart && this.props.confirmStartCall ? (
                        // Outgoing-audio pre-call layout: audio device
                        // picker high up, "Start audio call" Button at the
                        // bottom (where the cancel icon used to be), and a
                        // small X close icon top-left to abort before any
                        // SIP signaling fires. Mirrors the outgoing-video
                        // pre-call layout in LocalMedia.
                        //
                        // Each block is absolutely positioned with alignItems
                        // centered on its own row — avoids the marginTop:'auto'
                        // conflicts of the shared buttonContainerClass when
                        // we tried to switch it to column layout.
                        //
                        // Auto-start: a 10-second countdown begins when the
                        // awaiting state is entered (see componentDidUpdate
                        // / componentDidMount). If the user doesn't tap X
                        // (cancel) the call fires automatically. The timer
                        // is cleared on X-tap, manual Start tap, or unmount.
                        <>
                            {/* X close icon — hidden per user request.
                                The bottom-bar hangup IconButton already
                                provides the cancel action. Wrapped in
                                `false &&` so it can be re-enabled later
                                with a one-line change. */}
                            {false && (
                                <View style={{
                                    position: 'absolute',
                                    top: 56 + 20,
                                    left: 8,
                                    zIndex: 2100,
                                    elevation: 31,
                                }}>
                                    <TouchableHighlight style={[styles.roundshape, {borderRadius: 24}]}>
                                        <IconButton
                                            size={28}
                                            style={{backgroundColor: 'rgba(0,0,0,0.45)', margin: 0}}
                                            iconColor="#ffffff"
                                            color="#ffffff"
                                            icon="close"
                                            onPress={this.cancelCall}
                                        />
                                    </TouchableHighlight>
                                </View>
                            )}

                            {/* Record-call pill above the action bar.
                                Tappable in this pre-call awaiting
                                state — tap arms the recorder, which
                                auto-fires once the call reaches
                                accepted/established. Same vertical
                                position as in-call so the button
                                doesn't visually jump when the call
                                connects. */}
                            {this._renderRecordControlOverlay()}

                            {/* Audio device picker + hangup IconButton at
                                the SAME bottom-bar position used after the
                                call connects, so the picker doesn't
                                visually jump when the user taps Start.
                                The hangup is duplicated here (alongside
                                the X at top-left) so the user has the
                                familiar end-call control even during the
                                10-second auto-start countdown. */}
                            <View key={'cb-btnbar-' + _callRemountKey}
                                  style={[buttonContainerClass, extraButtonContainerClass]}>
                                {this.renderAudioDevicePicker(buttonSize, whiteButtonClass, _callRemountKey, slotContainerStyle)}
                                <View style={[slotContainerStyle, {marginLeft: hangupMarginLeft}]}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-cancel-await-' + _callRemountKey}
                                            size={buttonSize}
                                            style={hangupButtonClass}
                                            icon="phone-hangup"
                                            onPress={this.cancelCall}
                                        />
                                    </TouchableHighlight>
                                </View>
                            </View>

                            {/* Start audio call + sliding reverse-progress
                                bar — absolutely positioned ABOVE the device
                                picker bar. Auto-fires in 9 s if the user
                                doesn't tap X. The button label shows the
                                remaining seconds. Pulled 200 px higher to
                                clear the user-icon / display-name area.

                                Hidden in folded mode: the cover-display
                                layout renders the same Button + progress
                                bar inline inside foldedStatsColumn (the
                                right half of foldedTopRow) so the action
                                sits next to the avatar instead of
                                floating over it. */}
                            {this.props.isFolded ? null : (
                            <View style={{
                                position: 'absolute',
                                bottom: 330,
                                left: 0,
                                right: 0,
                                alignItems: 'center',
                                zIndex: 2000,
                                elevation: 30,
                            }}>
                                {/* Inner wrapper auto-sizes to the
                                    Start button's natural width; the
                                    progress bar then stretches to
                                    match (alignSelf: 'stretch'),
                                    keeping countdown width === button
                                    width regardless of label changes. */}
                                <View>
                                    <Button
                                        mode="contained"
                                        onPress={() => {
                                            this._cancelAutoStartTimer();
                                            if (this.props.confirmStartCall) {
                                                this.props.confirmStartCall();
                                            }
                                        }}
                                    >
                                        {this.state.autoStartCountdown > 0
                                            ? `Start audio call (${this.state.autoStartCountdown})`
                                            : 'Start audio call'}
                                    </Button>

                                    {/* 6-cell sliding bar — width
                                        inherited from the wrapper
                                        (= Start button width). Cell
                                        count matches the 6-second
                                        countdown so the rightmost
                                        cell is fully filled at start. */}
                                    <View style={{
                                        flexDirection: 'row',
                                        marginTop: 10,
                                        height: 6,
                                        alignSelf: 'stretch',
                                        justifyContent: 'space-between',
                                    }}>
                                        {[...Array(6)].map((_, i) => (
                                            <View
                                                key={'autostart-cell-' + i}
                                                style={{
                                                    flex: 1,
                                                    marginHorizontal: 1,
                                                    borderRadius: 2,
                                                    // Paused → white filled cells (frozen).
                                                    // Running → green filled cells (active
                                                    // countdown). Empty → dim translucent.
                                                    backgroundColor: i < (this.state.autoStartCountdown || 0)
                                                        ? (this.state.autoStartPaused
                                                            ? 'rgba(255,255,255,0.85)'
                                                            : 'rgba(0,200,90,0.9)')
                                                        : 'rgba(255,255,255,0.20)',
                                                }}
                                            />
                                        ))}
                                    </View>
                                </View>
                            </View>
                            )}
                        </>
                    ) : (
                        // Normal pre-connection bar (outgoing dialing /
                        // incoming ringing): audio device picker + red
                        // hangup IconButton on a single horizontal row.
                        // Record pill overlay rendered above so the
                        // armed "Will record" state is visible while
                        // the call is connecting — same vertical
                        // position as in-call so it doesn't visually
                        // jump when the call connects.
                        <>
                          {this._renderRecordControlOverlay()}
                          <View key={'cb-btnbar-' + _callRemountKey} style={[buttonContainerClass, extraButtonContainerClass]}>
                            {this.renderAudioDevicePicker(buttonSize, whiteButtonClass, _callRemountKey, slotContainerStyle)}

                            <View style={[slotContainerStyle, {marginLeft: hangupMarginLeft}]}>
                                <TouchableHighlight style={styles.roundshape}>
                                  <IconButton
                                      key={'cb-btn-cancel-' + _callRemountKey}
                                      size={buttonSize}
                                      style={hangupButtonClass}
                                      icon="phone-hangup"
                                      onPress={this.cancelCall}
                                  />
                              </TouchableHighlight>
                            </View>
                          </View>
                        </>
                    )
                }

                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.state.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
                    selectedContacts={this.state.selectedContacts}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
                {/* Call-recording legal disclaimer. Pops on two
                    triggers: (a) auto-record arming when the user
                    hasn't acknowledged yet — the call's auto-start
                    countdown is paused while the modal is up;
                    cancelling hangs up the call. (b) the user taps
                    the in-call record pill before acknowledging —
                    cancelling just leaves recording off (call
                    continues). recordingDisclosurePending stores
                    which trigger so onContinue / onCancel can
                    dispatch correctly. */}
                <CallRecordingDisclosureModal
                    show={!!this.state.recordingDisclosurePending}
                    onContinue={this._onRecordingDisclosureContinue}
                    onCancel={this._onRecordingDisclosureCancel}
                />
            </View>
        );
    }
}

AudioCallBox.propTypes = {
    remoteUri: PropTypes.string,
    remoteDisplayName: PropTypes.string,
    photo: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    accountId: PropTypes.string,
    escalateToConference: PropTypes.func,
    info: PropTypes.string,
    hangupCall: PropTypes.func,
    mediaPlaying: PropTypes.func,
    localMedia: PropTypes.object,
    callKeepSendDtmf: PropTypes.func,
    toggleMute: PropTypes.func,
    toggleSpeakerPhone: PropTypes.func,
    speakerPhoneEnabled: PropTypes.bool,
    isLandscape: PropTypes.bool,
    isTablet: PropTypes.bool,
    isFolded: PropTypes.bool,
    reconnectingCall: PropTypes.bool,
    muted: PropTypes.bool,
    showLogs: PropTypes.func,
    goBackFunc: PropTypes.func,
    callState: PropTypes.object,
    messages: PropTypes.object,
    sendMessage: PropTypes.func,
    reSendMessage: PropTypes.func,
    confirmRead: PropTypes.func,
    deleteMessage: PropTypes.func,
    expireMessage: PropTypes.func,
    getMessages: PropTypes.func,
    pinMessage: PropTypes.func,
    unpinMessage: PropTypes.func,
    callContact: PropTypes.object,
    selectedContact: PropTypes.object,
    selectedContacts: PropTypes.array,
    inviteToConferenceFunc: PropTypes.func,
    finishInvite: PropTypes.func,
    terminatedReason: PropTypes.string,
	confirmStartCall: PropTypes.func,
	// True when this is an outgoing call and the user has not yet
	// tapped "Start audio call". When true, AudioCallBox renders the
	// device picker + Start button + X close layout instead of the
	// regular dialing bar.
	awaitingUserCallStart: PropTypes.bool,
	userStartedCall: PropTypes.bool,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice: PropTypes.func,
    useInCallManger: PropTypes.bool,
	insets: PropTypes.object,
	// Called by AudioCallBox when a local-mic recording finishes.
	// Receives { filePath, remoteUri, remoteDisplayName, durationSec }
	// so the parent can persist it as an inbound chat message from
	// the remote party and sync it to other devices of the user.
	saveCallRecording: PropTypes.func
};

export default AudioCallBox;
