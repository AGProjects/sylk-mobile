import React, { Component } from 'react';
import { View, Platform, TouchableWithoutFeedback, TouchableHighlight, TouchableOpacity, Dimensions, DeviceEventEmitter, Animated, Easing } from 'react-native';
import { IconButton, Dialog, Button, Portal, Text, ActivityIndicator, Menu, Surface } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import uuid from 'react-native-uuid';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import { getZrtpSession, constantTimeStringEqual, formatEncryptedKindsLabel, formatVerifiedTimestamp } from './CallZrtp';
import utils from '../utils';
import LoadingScreen from './LoadingScreen';

import TrafficStats from './BarChart';
import AudioSpeedometer from './AudioSpeedometer';
import VuMeter from './VuMeter';

// Used by _logProposedCodec: we re-run sylkrtc's mungeSdp() with the
// currently active preferred-codec settings against pc.localDescription.sdp
// so the log reflects what was actually shipped over the wire (the
// PeerConnection's localDescription holds the un-munged SDP that
// createOffer produced; the munged SDP goes to the wire but isn't set
// back on the PC).
import * as sylkrtc from 'react-native-sylkrtc';

// QoS instrumentation: emits [qos] CONNECT / STATS / DISCONNECT lines
// into metro.log / adb logcat so qos/qos-log.sh + qos/qos-probe.py can
// correlate WebRTC-reported loss with iperf3 UDP probes and the
// server-side qos-server.py tcpdump diagnostic.
//
// Gated on __DEV__: in production builds the calls become no-ops, so
// the JS↔native bridge isn't loaded with extra getStats() traffic and
// no [qos] lines appear in logcat.
import {
    startQosLogging as _startQosLogging,
    stopQosLogging  as _stopQosLogging,
} from '../../qos/qos-stats';
const startQosLogging = __DEV__ ? _startQosLogging : () => {};
const stopQosLogging  = __DEV__ ? _stopQosLogging  : () => {};

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
            // ZRTP indicator state, mirroring CallZrtp.js's state machine:
            //   null         not started
            //   probing      handshake in flight
            //   key-agreed   handshake done, decryptor installed, but
            //                NOT yet proven to be processing peer's
            //                ciphertext (pill stays OFF here)
            //   key-active   receiver counters confirm peer is emitting
            //                AES-GCM ciphertext (pill ON)
            //   failed       handshake gave up (pill OFF)
            zrtpState                   : null,
            zrtpDialogVisible           : false,
            // Shown when the call is in zRTP-mandatory mode and the
            // handshake fails (no PGP key, incompatible codec, or 10s
            // timeout). Lets the user choose whether to terminate the
            // call or continue without end-to-end encryption.
            zrtpMandatoryFailedVisible  : false,
            zrtpMandatoryFailedInfo     : null,
            zrtpDowngradeBannerVisible  : false,
            zrtpDowngradeBannerInfo     : null,
            zrtpMismatchAlarmVisible    : false,
            // Toggle between the AudioSpeedometer (default) and the
            // legacy TrafficStats bar-chart. Tap the stats area to flip.
            showOldStats                : false,
            // 10-second auto-start countdown for the outgoing-audio
            // pre-call screen. Reaches 0 → confirmStartCall() fires
            // automatically. Updated by the interval started in
            // _startAutoStartTimer.
            autoStartCountdown          : 0,
            // The INITIAL total seconds the countdown was armed with
            // (the value `autoStartCountdown` starts at on a fresh
            // run). Held separately so the progress bar can render
            // exactly that many segments — one cell per second — and
            // keep them stable across pause/resume even though
            // `autoStartCountdown` itself ticks down. 0 when no
            // countdown is in flight.
            autoStartTotal              : 0,
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
            // Small panel anchored to the avatar's bottom-right "+"
            // chip. Currently surfaces a single action: "Escalate to
            // conference". Tap the + to toggle, tap anywhere outside
            // (overlay press) to dismiss — same self-dismiss pattern
            // as the audio-device floating picker.
            showConferenceRequestPanel  : false,
            // True between sending a conference_request to the peer
            // and either: (a) receiving the peer's accept echo, or
            // (b) the peer's explicit reject, or (c) the 60 s window
            // expiring. While true the + chip shows a pulsing
            // "waiting" look so the user knows the peer hasn't
            // responded yet.
            conferenceRequestPending    : false,
            // Tracks the requestId of the outgoing conference_request
            // so the DeviceEventEmitter('conferenceRequestResolved')
            // listener can match the event to this specific request
            // (multiple sends would otherwise race the chip state).
            conferenceRequestPendingId  : null,
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

    // Pulse opacity for the recording pill. Starts at 1 (visible),
    // loops 1 → 0.4 → 1 every ~1.2 s while recording. Instance-level
    // so it survives re-renders without resetting; started in
    // componentDidUpdate when isRecording flips true and stopped
    // when it flips false (see _startRecordPulse / _stopRecordPulse).
    _recordPulse = new Animated.Value(1);

    _startRecordPulse() {
        if (this._recordPulseLoop) return;
        this._recordPulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(this._recordPulse, {
                    toValue: 0.4,
                    duration: 600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(this._recordPulse, {
                    toValue: 1,
                    duration: 600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        this._recordPulseLoop.start();
    }

    _stopRecordPulse() {
        if (this._recordPulseLoop) {
            this._recordPulseLoop.stop();
            this._recordPulseLoop = null;
        }
        this._recordPulse.setValue(1);
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        // UI transition trace, AudioCallBox mount. This is the moment the
        // user-visible audio call screen is rendered. Anything between
        // [ui] 04 route_change_call_requested (in app.acceptCall) and
        // this line is JS+RN render time; anything between this line and
        // [ui] 11 answer_sent is waiting for the localMedia prop (i.e.
        // getUserMedia + microphone warmup on Android).
        const _cid = (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id))
                  || (this.props.call && (this.props.call._callId || this.props.call.callId || this.props.call.id))
                  || '?';
        const _hasMediaProp = !!(this.props.localMedia);
        try {
            utils.timestampedLog('[call] [ui] call_id=' + _cid,
                '09 audiocallbox_mount call.state=' + (this.state.call && this.state.call.state)
                + ' direction=' + (this.state.call && this.state.call.direction)
                + ' hasLocalMediaProp=' + _hasMediaProp);
        } catch (e) {}

        if (this.state.call != null) {
            switch (this.state.call.state) {
                case 'established':
                    this.attachStream(this.state.call);
                    // Already mid-call when we mounted — start the VU
                    // sampler immediately so the meter populates
                    // without waiting for the next state change.
                    this._startVuSampler();
                    // Same for [qos] telemetry — start it now so the
                    // qos pipeline can correlate stats from the
                    // already-running call.
                    if (this.state.call._pc) {
                        startQosLogging(this.state.call._pc);
                    }
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
            this.state.call.on('zrtpDowngradeWarning', this.zrtpDowngradeWarning);
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

        // Listen for app.js → AudioCallBox notifications that an
        // outstanding conference_request was resolved (accept, reject,
        // or sibling-handled). Clears the "Waiting…" chip immediately
        // instead of waiting on the 60 s self-clear.
        this._conferenceRequestResolvedSub = DeviceEventEmitter.addListener(
            'conferenceRequestResolved',
            this._handleConferenceRequestResolved
        );

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
     *  Default 4 s; takes an explicit `seconds` arg so the resume path
     *  can pick up from a frozen countdown value. The interval ticks
     *  once per second to update the display + sliding progress bar;
     *  the timeout fires the actual confirmStartCall when 0 is reached.
     *  Idempotent — cancels any previous timer first.
     *
     *  `isResume` distinguishes a fresh start from picking the timer
     *  back up after a pause. On a fresh start we (re)stamp
     *  `autoStartTotal` so the progress bar draws exactly one cell
     *  per second of the new duration; on resume we leave it alone so
     *  the bar still shows the original total — only the lit-cell
     *  count shrinks. */
    _startAutoStartTimer(seconds = 4, isResume = false) {
        this._cancelAutoStartTimer();
        if (this.unmounted) return;
        const startSeconds = Math.max(1, seconds);
        // Clear the paused flag — running again means we're not frozen.
        // On a fresh start, also reset `autoStartTotal` to the new
        // duration so the bar redraws with the right number of cells.
        const _patch = { autoStartCountdown: startSeconds, autoStartPaused: false };
        if (!isResume) _patch.autoStartTotal = startSeconds;
        this.setState(_patch);
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
        if (!this.unmounted
            && (this.state.autoStartCountdown !== 0
                || this.state.autoStartTotal !== 0)) {
            // Reset both so the next fresh start re-stamps total from
            // its own `seconds` arg, and so the bar isn't briefly left
            // rendering empty cells from the previous duration.
            this.setState({ autoStartCountdown: 0, autoStartTotal: 0 });
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
        // isResume=true: preserve `autoStartTotal` so the progress
        // bar keeps the same number of segments — only the lit count
        // shrinks to `remaining`.
        this._startAutoStartTimer(remaining, true);
    }

    zrtpStateChanged(newState) {
        if (this.unmounted) {
            return;
        }
        this.setState({ zrtpState: newState }, () => {
            if (newState !== 'key-active') return;
            const status = this._zrtpVerificationStatus();
            if (status === 'mismatch' && !this.state.zrtpMismatchAlarmVisible) {
                utils.timestampedLog('[call] [zrtp] call_id='
                    + (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)),
                    'SAS mismatch detected — opening alarm modal');
                this.setState({ zrtpMismatchAlarmVisible: true });
            }
            // Auto-upgrade legacy PGP-verified peers to v2 rs1
            // continuity. When this call's continuityState is first-time
            // / one-sided (no rs1 was mixed) but the legacy PGP-key
            // fallback would say 'verified' (which is why the pill is
            // green right now), treat that as user consent to seed v2
            // rs1 — so the NEXT call between these peers has real
            // protocol-level continuity instead of relying on the PGP
            // anchor again. Idempotent: confirmSasAndSeedRs1 just
            // re-derives the same next_rs1.
            this._maybeAutoUpgradeRs1(status);
        });
    }

    _maybeAutoUpgradeRs1(status) {
        if (status !== 'verified') return;
        const session = getZrtpSession(this.state.call);
        if (!session) return;
        const cs = session.continuityState;
        if (cs !== 'first-time' && cs !== 'one-sided-local'
                && cs !== 'one-sided-peer') return;
        if (this._rs1AutoUpgraded) return;
        if (typeof session.confirmSasAndSeedRs1 !== 'function') return;
        try {
            session.confirmSasAndSeedRs1();
            this._rs1AutoUpgraded = true;
            utils.timestampedLog('[call] [zrtp] call_id='
                + (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)),
                'auto-upgraded legacy verification to v2 rs1 continuity (was=' + cs + ')');
        } catch (e) {
            utils.timestampedLog('[call] [zrtp] rs1 auto-upgrade threw:',
                (e && e.message) || e);
        }
    }

    _onZrtpMismatchAcknowledge() {
        // User chose to continue past the mismatch alarm. Drop the
        // stored rs1 so subsequent calls re-bootstrap (no continuity
        // until the user verifies SAS again). Without this clear, the
        // old rs1 would stay in place and the same mismatch would fire
        // on every future call.
        const session = getZrtpSession(this.state.call);
        if (session && typeof session.clearRs1 === 'function') {
            try { session.clearRs1(); } catch (e) {}
        }
        this.setState({ zrtpMismatchAlarmVisible: false });
    }

    _onZrtpMismatchEndCall() {
        this.setState({ zrtpMismatchAlarmVisible: false });
        if (this.state.call) {
            try { this.state.call.terminate(); } catch (e) {}
        }
    }

    // Fired by CallZrtp.js when zRTP-mandatory mode fails to agree on
    // keys (no public PGP key for peer, codec incompatible with our
    // FrameEncryptor, or the 10s timer ran out). The user gets to
    // decide: terminate (mandatory enforcement honored) or continue
    // without E2E (downgrade to optional).
    zrtpMandatoryFailed(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[call] [zrtp] call_id='
            + (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)),
            'AudioCallBox received zrtpMandatoryFailed:', info);
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

    zrtpDowngradeWarning(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[call] [zrtp] call_id='
            + (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)),
            'AudioCallBox received zrtpDowngradeWarning:', info);
        this.setState({
            zrtpDowngradeBannerVisible: true,
            zrtpDowngradeBannerInfo: info,
        });
    }

    _onZrtpDowngradeBannerDismiss() {
        this.setState({ zrtpDowngradeBannerVisible: false });
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
        // The SAS verification dialog is only meaningful when media is
        // actually flowing through the AES-GCM decryptor. 'key-agreed'
        // alone means handshake done; 'key-active' means decryptor
        // counters confirm the peer is encrypting. Bind both the pill
        // and the SAS modal to 'key-active' for consistency.
        if (this.state.zrtpState !== 'key-active') return null;
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) return null;
        // Primary anchor: v2 retained-secret (rs1) continuity decision
        // taken inside the session at _deriveAndLog time.
        if (session.continuityState === 'verified') return 'verified';
        if (session.continuityState === 'mismatch') return 'mismatch';
        // New-device guard: when the peer advertised a device_id AND we
        // hold NO per-device rs1 for that specific device, treat the
        // call as unverified — don't fall through to the legacy PGP
        // compare. The PGP key is per-account, so without this guard a
        // brand-new device behind a previously-verified account would
        // automatically get the green pill, which silently grants trust
        // to a device that has never been verified.
        if (session.peerDeviceId && !session.localRs1) {
            return 'unverified';
        }
        // Legacy fallback for v1 / v2 peers (no device_id advertised) or
        // sessions where we did once seed rs1 under the AOR-only slot —
        // compare stored PGP key fingerprint as we did before v3.
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;
        if (!stored || !stored.publicKey) return 'unverified';
        const currentKey = this.props.callContact && this.props.callContact.publicKey;
        if (currentKey && constantTimeStringEqual(stored.publicKey, currentKey)) return 'verified';
        return 'mismatch';
    }

    _onZrtpBadgePress() {
        // Match the pill's visibility gate — modal only opens when media
        // is actually flowing through the decryptor (see renderZrtpBadge).
        if (this.state.zrtpState === 'key-active') {
            this.setState({ zrtpDialogVisible: true });
        }
    }

    _onZrtpReset() {
        // Mirror the SDK's /zrtp_reset: wipe rs1 in-memory on the
        // session, clear the persisted contact.localProperties.zrtp
        // record, and close the dialog. The next call between these
        // peers re-bootstraps from continuity=first-time. Pill flips
        // to unverified once the contact prop refreshes.
        const session = getZrtpSession(this.state.call);
        if (session && typeof session.clearRs1 === 'function') {
            try { session.clearRs1(); } catch (e) {}
        }
        if (session) {
            try {
                session.continuityState = 'first-time';
                session.localRs1 = null;
                session.localRsIdHex = null;
            } catch (e) {}
        }
        if (this.props.resetContactZrtp && this.state.remoteUri) {
            try { this.props.resetContactZrtp(this.state.remoteUri); } catch (e) {}
        }
        this._rs1AutoUpgraded = false;
        this.setState({ zrtpDialogVisible: false });
        this.forceUpdate();
    }

    _onZrtpVerifyConfirm() {
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) {
            this.setState({ zrtpDialogVisible: false });
            return;
        }
        // Seed (or refresh) the per-peer retained secret. The session
        // emits 'zrtpRs1Update' on the Call which app.js listens for and
        // persists into contact.localProperties.zrtp.rs1_hex.
        if (typeof session.confirmSasAndSeedRs1 === 'function') {
            try { session.confirmSasAndSeedRs1(); } catch (e) {}
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
        this._stopRecordPulse();
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            this.state.call.removeListener('zrtpDowngradeWarning', this.zrtpDowngradeWarning);
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

        // Defensive: stop the [qos] sampler if it was still running
        // (the 'terminated' state transition already does this, but a
        // hard navigate-away can bypass that path).
        stopQosLogging();

        // Outgoing conference-request expiry timer — clear it if the
        // user navigates away before the 60 s window elapses, so the
        // setState callback doesn't fire on an unmounted instance.
        if (this._conferenceRequestExpiryTimer) {
            clearTimeout(this._conferenceRequestExpiryTimer);
            this._conferenceRequestExpiryTimer = null;
        }
        if (this._conferenceRequestResolvedSub) {
            this._conferenceRequestResolvedSub.remove();
            this._conferenceRequestResolvedSub = null;
        }
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

    /** Start a periodic interval that polls the peer connection for
     *  inbound audioLevel and feeds it into a smoothed envelope so
     *  the VU meter responds to speech but doesn't flicker on every
     *  micro-pause. Idempotent.
     *
     *  Interval is 200 ms (5 Hz) — a compromise between meter
     *  responsiveness and bridge throughput. 10 Hz can overload
     *  WebRTCModule.peerConnectionGetStats on Android and cause
     *  audible inbound RTP loss; 1 Hz feels sluggish. If you see
     *  "Excessive number of pending callbacks" warnings or hear
     *  RTP loss correlated with the meter, raise this back toward
     *  500–1000 ms. */
    _startVuSampler() {
        if (this._vuSamplerInterval) return;
        this._vuSamplerInterval = setInterval(() => {
            this._sampleAudioLevels();
        }, 200);
    }

    /** Log the audio codecs we PROPOSED in our outgoing offer, in
     *  preference order (the order they appear on the m=audio line).
     *
     *  Important: pc.localDescription.sdp holds the UN-munged SDP that
     *  createOffer produced — the preferred-codec reorder is applied
     *  later by sylkrtc's mungeSdp() and the munged result is sent on
     *  the wire but never written back to pc. So to log what actually
     *  shipped, we re-run mungeSdp() with the same preferences sylkrtc
     *  has stored. */
    _logProposedCodec() {
        const call = this.state.call;
        if (!call || !call._pc) return;
        const rawSdp = call._pc.localDescription && call._pc.localDescription.sdp;
        if (!rawSdp) return;
        try {
            // Re-apply the same preferred-codec munging sylkrtc did when
            // it shipped the offer. If sylkrtc.utils isn't exposing the
            // helpers (older builds), fall back to the raw SDP — at
            // least the log is correct about what the PC had.
            let sdp = rawSdp;
            let prefAudioDebug = '(no util)';
            let prefVideoDebug = '(no util)';
            try {
                const u = sylkrtc && sylkrtc.utils;
                if (u && typeof u.mungeSdp === 'function') {
                    const prefVideo = typeof u.getPreferredVideoCodec === 'function'
                        ? u.getPreferredVideoCodec() : null;
                    const prefAudio = typeof u.getPreferredAudioCodec === 'function'
                        ? u.getPreferredAudioCodec() : null;
                    prefAudioDebug = String(prefAudio);
                    prefVideoDebug = String(prefVideo);
                    sdp = u.mungeSdp(rawSdp, prefVideo, false, prefAudio);
                }
            } catch (e) {
                prefAudioDebug = 'mungeSdp threw: ' + (e && e.message);
            }
            utils.timestampedLog('[call] codec preference at log-time: audio=', prefAudioDebug, 'video=', prefVideoDebug);

            // Find the m=audio line.
            const mLine = sdp.split(/\r?\n/).find(l => l.startsWith('m=audio'));
            if (!mLine) return;
            // m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 126
            const ptList = mLine.split(/\s+/).slice(3); // payload types
            // Index a=rtpmap:<pt> <codec>/<rate>[/<channels>] and a=fmtp:<pt> <params>
            const rtpmap = {};
            const fmtp   = {};
            for (const line of sdp.split(/\r?\n/)) {
                let m = line.match(/^a=rtpmap:(\d+)\s+(\S+)/);
                if (m) rtpmap[m[1]] = m[2];
                m = line.match(/^a=fmtp:(\d+)\s+(.*)$/);
                if (m) fmtp[m[1]] = m[2];
            }
            const summary = ptList.map(pt => {
                const codec = rtpmap[pt] || '?';
                const params = fmtp[pt] ? ` (${fmtp[pt]})` : '';
                return `${codec} pt=${pt}${params}`;
            }).join(', ');
            utils.timestampedLog('[call] proposed audio codecs (offer m-line order):', summary);
        } catch (e) {
            utils.timestampedLog('[call] codec parse failed:', (e && e.message) || e);
        }
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
        // VU meter vertical offset in LANDSCAPE only — net 0
        // (history: -30 → +20 → -10 → -10 more = back to natural
        // position). Keeping the conditional in case future
        // landscape tweaks add another offset. Portrait keeps
        // natural too.
        const _vuLift = this.state.isLandscape ? { transform: [{ translateY: 0 }] } : null;
        return (
            <View style={[{ alignSelf: 'stretch', alignItems: 'center' }, _vuLift]}>
                {/* Labels removed per user request — the bar geometry
                    (remote on top, local on bottom) is consistent
                    enough that the captions weren't carrying weight. */}
                <VuMeter level={this.state.remoteAudioLevel} width="60%" />
                <VuMeter level={this.state.localAudioLevel}  width="60%" />
            </View>
        );
    }

    componentDidUpdate(prevProps, prevState) {
        // Pulse the recording pill while a recording is in progress.
        // Starts the loop on the false→true edge and stops it on the
        // true→false edge — instance-level Animated.Value so the
        // animation doesn't restart on every render.
        if (!prevState.isRecording && this.state.isRecording) {
            this._startRecordPulse();
        } else if (prevState.isRecording && !this.state.isRecording) {
            this._stopRecordPulse();
        }
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
        // Two specific cwrp transitions matter for the accept-latency
        // trace: the moment the sylkrtc Call prop first arrives (for
        // outgoing or post-mount incoming), and the moment localMedia
        // becomes non-null (the prop that unblocks answerCall on the
        // incoming path). Logged with [ui] tag + call_id so the trace
        // composes with the app.acceptCall lines.
        try {
            const newCall = nextProps.call;
            const oldCall = this.state.call;
            const _cid = (newCall && (newCall._callId || newCall.callId || newCall.id))
                       || (oldCall && (oldCall._callId || oldCall.callId || oldCall.id))
                       || '?';
            if (newCall && newCall !== oldCall) {
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    '10 audiocallbox_call_prop_arrived state=' + newCall.state
                    + ' direction=' + newCall.direction);
            }
            if (nextProps.localMedia && !this.props.localMedia) {
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    '11 audiocallbox_localmedia_prop_arrived — answerCall path next');
            }
        } catch (e) {}

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
                this.state.call.removeListener('zrtpDowngradeWarning', this.zrtpDowngradeWarning);
            }

            // Attach new listener if available
            if (nextProps.call && nextProps.call.on) {
                nextProps.call.on('stateChanged', this.callStateChanged);
                nextProps.call.on('zrtpStateChanged', this.zrtpStateChanged);
                nextProps.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
                nextProps.call.on('zrtpDowngradeWarning', this.zrtpDowngradeWarning);
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
            // Final UI transition stage — call.state went 'accepted' →
            // 'established', meaning ICE/DTLS finished and audio frames
            // can now flow. attachStream wires the remote audio track
            // to the audio renderer, which is what the user actually
            // hears.
            const _cid = (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)) || '?';
            utils.timestampedLog('[call] [ui] call_id=' + _cid,
                '15 state_established — attachStream next (audio audible after this)');
            this._logNegotiatedSdp();
            this.attachStream(this.state.call);
            utils.timestampedLog('[call] [ui] call_id=' + _cid,
                '16 attachStream_done — UI transition complete');
            this.setState({reconnectingCall: false});
            // Kick off the VU meter sampler now that there's a media
            // stream to read audioLevel from.
            this._startVuSampler();
            // Start [qos] CONNECT / STATS sampler against the same
            // PeerConnection — see qos/qos-stats.js.
            if (this.state.call && this.state.call._pc) {
                startQosLogging(this.state.call._pc);
            }
            // One-shot: log the audio codecs proposed in our outgoing
            // offer (m=audio payload-type list with the rtpmap names).
            this._logProposedCodec();
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
            // Clear ALL Sylk-ZRTP-related UI state so nothing lingers
            // on the wrap-up screen — the pill, the SAS dialog, the
            // mismatch alarm, and the downgrade banner all hide.
            this.setState({
                zrtpState: null,
                zrtpDialogVisible: false,
                zrtpMismatchAlarmVisible: false,
                zrtpDowngradeBannerVisible: false,
                recordingArmed: false,
                remoteAudioLevel: 0,
                localAudioLevel: 0,
                vuMetersHaveData: false,
            });

            // Auto-stop the recording on call end. componentWillUnmount
            // already does this when AudioCallBox actually unmounts, but
            // on the callee side the box hangs around for the wrap-up
            // screen — the timer was happily ticking after the call
            // died because nothing else stopped it.
            if (this.state.isRecording) {
                utils.timestampedLog('[call] auto-stopping recording — call terminated');
                this._stopCallRecording();
            }
            // Emit [qos] DISCONNECT and stop the qos sampler.
            stopQosLogging();
        }
    }

    attachStream(call) {
        this.setState({stream: call.getRemoteStreams()[0]}); //we dont use it anywhere though as audio gets automatically piped
    }

    /*
     * Dump the SDP that we actually received from SylkServer/Janus, so
     * we can diff it against what the SIP peer (e.g. Blink/pjsip)
     * thinks it sent. Janus's SIP plugin terminates the SIP SDP and
     * builds a fresh JSEP offer for libwebrtc on this side; the
     * re-write can silently strip codec attributes (rtcp-fb,
     * transport-cc, extmap, rtx, fec), force a particular profile,
     * or reorder codecs.
     *
     * One-shot per call. Fires from callStateChanged on 'established'.
     * Identical helper lives on VideoBox.js for the video-call path.
     */
    _logNegotiatedSdp() {
        if (this._sdpDumped) return;
        this._sdpDumped = true;
        const call = this.state && this.state.call;
        const pc = call && call._pc;
        if (!pc) {
            console.log('[sdp-dump] no peer connection yet, skipping');
            return;
        }
        const cid = (call && (call.id || call._callId || call.callId)) || '?';
        const dump = (label, desc) => {
            if (!desc || typeof desc.sdp !== 'string') {
                console.log('[sdp-dump] cid=' + cid, label, '<none>');
                return;
            }
            console.log('[sdp-dump] cid=' + cid, label, 'type=' + desc.type,
                        'len=' + desc.sdp.length);
            const lines = desc.sdp.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].length === 0) continue;
                console.log('[sdp-dump] cid=' + cid, label,
                            '[' + (i + 1).toString().padStart(3, '0') + ']',
                            lines[i]);
            }
        };
        try {
            const rem = pc.remoteDescription || pc.currentRemoteDescription;
            const loc = pc.localDescription  || pc.currentLocalDescription;
            dump('REMOTE', rem);
            dump('LOCAL',  loc);
        } catch (e) {
            console.log('[sdp-dump] failed:', (e && e.message) || e);
        }
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    // Handler for the 'conferenceRequestResolved' event emitted by
    // app.js when the peer accepts / rejects our outstanding
    // conference_request, or when a sibling device handles it. Clears
    // the chip's pending state if the event's requestId matches the
    // one we're currently waiting on.
    _handleConferenceRequestResolved(event) {
        if (!event || !event.requestId) return;
        if (this.state.conferenceRequestPendingId !== event.requestId) return;
        if (this._conferenceRequestExpiryTimer) {
            clearTimeout(this._conferenceRequestExpiryTimer);
            this._conferenceRequestExpiryTimer = null;
        }
        this.setState({
            conferenceRequestPending: false,
            conferenceRequestPendingId: null,
        });
    }

    // Toggle the small "+" panel that floats off the avatar's
    // bottom-right corner. Today it surfaces a single action
    // (escalate-to-conference handshake); adding more in-call quick
    // actions later is a one-line append inside the panel render.
    toggleConferenceRequestPanel() {
        this.setState({ showConferenceRequestPanel: !this.state.showConferenceRequestPanel });
    }

    closeConferenceRequestPanel() {
        if (this.state.showConferenceRequestPanel) {
            this.setState({ showConferenceRequestPanel: false });
        }
    }

    // User picked "Escalate to conference" from the + panel.
    //
    // Ships a single application/sylk-message-metadata payload to the
    // peer with action='conference_request', a freshly generated room
    // URI (sorted local/remote usernames + short suffix, scoped to the
    // account's defaultConferenceDomain), and a 60 s expires window.
    // Mirrors the location_request handshake shape so the peer's
    // metadata router recognises it without bespoke plumbing.
    //
    // No room-side state is created here — both sides defer creating
    // the conference until the accept echo lands. That keeps a
    // declined / expired request from leaving a stale empty room on
    // the conference server.
    // DJB2 hash of an arbitrary string → 9-digit numeric room name.
    // Deterministic, no crypto needed: the room name is just a label
    // for routing on the conference server, not a secret. Output is
    // padded out to 9 digits so the URI's local-part looks like a
    // proper extension (e.g. 074219385@videoconference…) instead of
    // a variable-width 1–9 digit run.
    _hashUsernamesToRoom(input) {
        let h = 5381;
        for (let i = 0; i < input.length; i++) {
            // h * 33 + c, coerced to int32 so it doesn't blow up
            // into floating-point land for long inputs.
            h = ((h << 5) + h + input.charCodeAt(i)) | 0;
        }
        // | 0 leaves a signed int32. >>> 0 reinterprets to uint32.
        const positive = (h >>> 0);
        const mod = positive % 1000000000;
        // Pad to 9 chars so the room URI's local part is always the
        // same width — easier to spot in logs.
        return mod.toString().padStart(9, '0');
    }

    sendConferenceRequest() {
        this.closeConferenceRequestPanel();

        const call = this.state.call;
        if (!call || !call.remoteIdentity) {
            console.log('[conference-request] no active call, cannot send');
            return;
        }
        const peerUri = call.remoteIdentity.uri;
        if (!peerUri) {
            console.log('[conference-request] active call has no remote uri');
            return;
        }
        if (typeof this.props.sendMessage !== 'function') {
            console.log('[conference-request] sendMessage prop not wired');
            return;
        }
        const myUri = this.props.accountId;
        const conferenceDomain = this.props.defaultConferenceDomain || 'videoconference.sip2sip.info';
        const myUser = (myUri && myUri.split('@')[0]) || 'me';
        const peerUser = peerUri.split('@')[0] || 'peer';
        // Room name is a deterministic numeric hash of the sorted
        // caller + callee usernames. Same inputs in either order yield
        // the same number — useful as a sanity check both sides can
        // run locally if the metadata is ever lost in flight, and
        // keeps the conference URI's local part short / human-readable
        // (max 9 digits, fits a typical extension-style identifier).
        // DJB2 hashed → unsigned 32-bit → mod 1e9.
        const parts = [myUser, peerUser].map(s => s.toLowerCase()).sort();
        const room = `${this._hashUsernamesToRoom(parts.join('|'))}@${conferenceDomain}`;

        const requestId = uuid.v4();
        const now = new Date();
        const expiresAtIso = new Date(Date.now() + 60 * 1000).toISOString();

        const metadataContent = {
            action: 'conference_request',
            messageId: requestId,
            timestamp: now,
            uri: peerUri,
            room,
            expires: expiresAtIso,
            // `requester` on the outgoing leg is the local user. The
            // receiver flips this to its own uri on its accept echo;
            // that flip is what the originator listens for.
            requester: myUri,
            // call_id binds this conference_request to the in-flight
            // 1-1 call. Sibling devices of either party that aren't
            // participating in that specific call session use this
            // to recognise "this request belongs to a call we're not
            // on" and skip both the modal popup and any push
            // notification.
            //
            // IMPORTANT: this is the SIP Call-ID header
            // (`call._callId` / `call.callId`), NOT `call.id`.
            // `call.id` is each side's locally-generated sylkrtc
            // UUID — caller and callee see different values for the
            // same call so it can't be used to pair them. The SIP
            // Call-ID is set from the server's signalling layer (see
            // react-native-sylkrtc/lib/call.js _initIncoming /
            // _initOutgoing message.call_id assignments) and is
            // identical on both sides of the dialogue.
            call_id: (call._callId || call.callId || call.id),
        };
        const metadataMessage = {
            _id: requestId,
            key: requestId,
            createdAt: now,
            metadata: metadataContent,
            text: JSON.stringify(metadataContent),
            user: {},
        };

        try {
            this.props.sendMessage(peerUri, metadataMessage, 'application/sylk-message-metadata');
        } catch (e) {
            console.log('[conference-request] send failed',
                e && e.message ? e.message : e);
            return;
        }

        // Mark the local "waiting" state and arm a 60 s self-clear
        // mirroring the metadata's expires window. Either of the
        // accept-echo (host hangup → start-conference) or the
        // explicit reject (DeviceEventEmitter dispatch in
        // _handleConferenceRequestResolved) will clear this sooner.
        this.setState({
            conferenceRequestPending: true,
            conferenceRequestPendingId: requestId,
        });
        if (this._conferenceRequestExpiryTimer) {
            clearTimeout(this._conferenceRequestExpiryTimer);
        }
        this._conferenceRequestExpiryTimer = setTimeout(() => {
            this._conferenceRequestExpiryTimer = null;
            if (this.state.conferenceRequestPendingId === requestId) {
                this.setState({
                    conferenceRequestPending: false,
                    conferenceRequestPendingId: null,
                });
            }
        }, 60 * 1000);

        console.log('[conference-request] sent →', peerUri,
            'room=', room, 'reqId=', requestId);
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
        // Hide the recording pill until the call is actually live —
        // there's no recording to start while we're still ringing /
        // negotiating, and the pill was visually noise during the
        // pre-connected phase. Only render once the call reaches
        // 'accepted' or 'established'.
        const _cs = this.state.call && this.state.call.state;
        if (_cs !== 'accepted' && _cs !== 'established') {
            return null;
        }
        const isRec = !!this.state.isRecording;
        const isArmed = !isRec && !!this.state.recordingArmed;

        let bg, label, dotColor;
        if (isRec) {
            bg = 'rgba(220, 30, 30, 0.95)';
            dotColor = '#fff';
            // Elapsed-time counter removed from the pill per user
            // request — the red dot + "Recording" label already
            // communicates the state, and dropping the dynamic
            // HH:MM:SS keeps the pill width stable.
            label = 'Recording';
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
            <Animated.View style={{ opacity: isRec ? this._recordPulse : 1 }}>
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
                    // Pill body thickness — bumped twice per user:
                    // 3 → 6 ("5px thicker") → 10 ("4 px more").
                    // borderRadius bumped to keep corners proportional.
                    // paddingHorizontal bumped 10 → 24 per
                    // "enlarge width of recording pill".
                    paddingVertical: 10,
                    paddingHorizontal: 24,
                    borderRadius: 16,
                }}
            >
                <View style={{
                    // Dot enlarged + more gap to "Record" label per
                    // user request: 8×8 → 12×12, marginRight 6 → 12.
                    // Negative marginLeft pulls the dot toward the
                    // pill's LEFT edge per "shift red more to the
                    // left" — visually anchors the indicator at the
                    // start of the pill instead of after the
                    // paddingHorizontal gutter.
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: dotColor,
                    marginLeft: -10,
                    marginRight: 12,
                }} />
                <Text style={{
                    color: '#fff',
                    fontWeight: 'bold',
                    fontSize: 12,
                    // Right margin: started symmetric with the dot's
                    // -10 marginLeft (so the distance from "Record"
                    // to the right pill edge mirrored the left), then
                    // bumped 3 px more breathing room per user
                    // request → -10 + 3 = -7.
                    marginRight: -7,
                }}>
                    {label}
                </Text>
            </TouchableOpacity>
            </Animated.View>
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
        // Same dedupe in LANDSCAPE: we now render the record-call
        // pill inline under the URI in the left column of the
        // landscape two-column layout (see render() landscape
        // branch). Without this guard the floating overlay below
        // would also draw, producing two record buttons.
        if (this.state.isLandscape && !this.props.isTablet) {
            return null;
        }
        // Vertical offset has to clear the button bar, whose position
        // and button size both vary by form factor / orientation.
        // Paper's IconButton wraps the icon in a touch target ~16dp
        // wider than the `size` prop, so on tablet (size=40) each
        // button is closer to ~56dp tall — taller than the simple
        // size-only estimate suggests, which is why the earlier 165dp
        // pill offset still read as "too close".
        //
        //   tablet portrait:  bottom 60 + mb 40 + ~56 btn + ~44 gap ≈ 200
        //   tablet landscape: bottom 60 + mb  0 + ~56 btn + ~34 gap ≈ 150
        //   phone portrait:   mb 50 + ~50 btn + ~30 gap ≈ 130 (unchanged)
        //   phone landscape:  bottom 30 + ~50 btn + ~50 gap ≈ 130 (unchanged)
        //
        // If a user reports the pill still kisses the buttons on a
        // new device class, bump the matching branch — don't cap the
        // overall maximum, since over-lifting on small phones would
        // push the pill into the AudioSpeedometer above it.
        let bottomOffset = 130;
        if (this.props.isTablet) {
            bottomOffset = this.state.isLandscape ? 150 : 200;
        }
        return (
            <View
                pointerEvents="box-none"
                style={{
                    position: 'absolute',
                    bottom: bottomOffset,
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
        // Both stats views share the SAME slot width AND height so
        // flipping between graph and speedo never resizes the
        // column — width was 170 (BarChart's natural width) but
        // squeezed the zRTP pill rendered below; 260 fits the long
        // pill label on one line.
        // Height pinned to 200 dp covers the tallest of the two
        // (TrafficStats: ~180dp = 2× chartHeight(60) + labels +
        // paddingTop. AudioSpeedometer: ~150dp = W=162 dial +
        // metrics line). With a fixed height, the zRTP pill below
        // sits at the same y regardless of which view is showing.
        const _statsSlotWidth = 260;
        const _statsSlotHeight = 200;
        return (
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={this.toggleStatsView}
                style={{ alignSelf: 'center', width: _statsSlotWidth }}
            >
                <View style={{
                    display: showOld ? 'flex' : 'none',
                    width: _statsSlotWidth,
                    height: _statsSlotHeight,
                    alignItems: 'center',
                }}>
                    <TrafficStats
                        key={'cb-stats-' + remountKey}
                        isTablet={this.props.isTablet}
                        isLandscape={this.state.isLandscape}
                        isFolded={this.props.isFolded}
                        data={this.state.audioGraphData}
                        media="audio"
                        /* Footer (zRTP pill) used to render INSIDE
                           TrafficStats whose internal container is
                           only 170 dp wide — which constrained the
                           pill and made its width visibly differ
                           between graph and speedo modes. Now the
                           footer is rendered as a sibling of both
                           views below, so it shares the same 260 dp
                           slot regardless of which stats view is
                           visible. */
                        footer={null}
                    />
                </View>
                <View style={{
                    display: showOld ? 'none' : 'flex',
                    width: _statsSlotWidth,
                    height: _statsSlotHeight,
                    alignItems: 'center',
                    // Folded cover-display layout history:
                    //   +10 (initial nudge down)
                    //   -20 (user "20 px up")
                    //   +10 (user "10 px down")
                    //   ±0  → +5 (user "speedo add 5 px margin top in folded")
                    // Net = +5 px nudge below the column baseline.
                    marginTop: this.props.isFolded ? 5 : 0,
                    // Raise the speedometer in LANDSCAPE only — and
                    // only on Android. iOS uses a slightly different
                    // navbar height + safe-area handling, so the same
                    // -18 lift pushed the dial up under the appbar
                    // on iOS landscape. Cap iOS to 0 (no lift) and
                    // keep the Android value at -18 where the layout
                    // worked.
                    transform: (this.state.isLandscape && Platform.OS === 'android')
                        ? [{ translateY: -18 }]
                        : undefined,
                }}>
                    <AudioSpeedometer
                        key={'cb-spd-' + remountKey}
                        call={this.state.call}
                        audioCodec={this.props.audioCodec}
                        isFolded={this.props.isFolded}
                    />
                    {!showOld ? this._renderRemoteVuMeter() : null}
                </View>
                {/* Footer (zRTP pill) rendered ONCE as a sibling of
                    both stats views, so its container width is the
                    same 260 dp slot in both graph and speedo modes —
                    fixes the pill changing width when toggling. */}
                {footer}
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

    // "+" affordance anchored at the avatar's bottom-right corner +
    // its drop-up panel. Today the panel surfaces a single action,
    // "Escalate to conference", which fires sendConferenceRequest.
    // The whole stack is gated on the call being in flight (no use
    // showing it while the line is still ringing — there's no peer
    // session to address a metadata payload to yet) and is rendered
    // inside a relatively positioned wrapper so the absolute
    // positioning here pins to the avatar, not the screen.
    _renderConferenceRequestPlus(avatarSize) {
        const c = this.state.call;
        const callLive = c
            && (c.state === 'accepted'
                || c.state === 'established'
                || c.state === 'early-media')
            && !this.state.reconnectingCall;
        if (!callLive) return null;

        // Suppress the "+" escalate-to-conference affordance for
        // contacts where escalation is meaningless or impossible:
        //   • 'test' tag — echo/IVR/playback endpoints have nobody on
        //     the other end to invite into a multi-party call. Mirrors
        //     the isTestCall gate the in-call action bar uses for the
        //     legacy invite IconButton (see render(), ~line 2435).
        //   • no publicKey — the conference-request handshake is
        //     delivered as an end-to-end encrypted metadata payload.
        //     Without the peer's public key we can't address them, so
        //     the request would silently fail. Hide the "+" entirely
        //     rather than letting the user tap into a dead path.
        const contact = this.state.callContact;
        if (contact) {
            const tags = Array.isArray(contact.tags) ? contact.tags : [];
            if (tags.indexOf('test') > -1) return null;
            if (!contact.publicKey) return null;
        } else {
            // No contact resolved at all — safer to hide than to show
            // an action that can't be wired up.
            return null;
        }

        // Chip size: keep it readable but visually subordinate to the
        // avatar. ~24% of the avatar diameter lands at 27 px on the
        // 113 px portrait avatar and 18 px on the 75 px landscape
        // avatar — both look like a quick-action affordance rather
        // than a primary button.
        const chipSize = Math.max(20, Math.round(avatarSize * 0.24));
        const pending = this.state.conferenceRequestPending;
        const showPanel = this.state.showConferenceRequestPanel;
        // Drop-UP panel: anchored so its bottom-right corner sits
        // right above the chip. Width is a fixed comfortable value
        // (190 px) so the single label "Escalate to conference"
        // doesn't wrap on smaller phones.
        const panelOffset = chipSize + 6;

        return (
            <>
                <TouchableOpacity
                    onPress={this.toggleConferenceRequestPanel}
                    accessibilityLabel="More call actions"
                    style={{
                        position: 'absolute',
                        right: -2,
                        bottom: -2,
                        width: chipSize,
                        height: chipSize,
                        borderRadius: chipSize / 2,
                        backgroundColor: pending ? 'rgba(255,193,7,0.95)' : 'rgba(33,150,243,0.95)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        // Soft shadow / elevation so the chip lifts
                        // off the avatar background regardless of
                        // light/dark.
                        elevation: 6,
                        shadowColor: '#000',
                        shadowOpacity: 0.25,
                        shadowRadius: 3,
                        shadowOffset: { width: 0, height: 1 },
                        zIndex: 50,
                    }}
                >
                    <Text style={{
                        color: 'white',
                        fontSize: Math.round(chipSize * 0.65),
                        lineHeight: Math.round(chipSize * 0.85),
                        fontWeight: '700',
                        // Tiny optical nudge: the `+` glyph in the
                        // default font renders slightly below center.
                        marginTop: -1,
                    }}>
                        {pending ? '…' : '+'}
                    </Text>
                </TouchableOpacity>

                {showPanel ? (
                    <View
                        style={{
                            position: 'absolute',
                            right: -2,
                            bottom: panelOffset,
                            width: 220,
                            zIndex: 60,
                            elevation: 10,
                        }}
                    >
                        <Surface
                            style={{
                                borderRadius: 8,
                                paddingVertical: 4,
                                backgroundColor: 'rgba(40,40,40,0.97)',
                            }}
                        >
                            <TouchableOpacity
                                onPress={this.sendConferenceRequest}
                                disabled={pending}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingHorizontal: 12,
                                    paddingVertical: 10,
                                    opacity: pending ? 0.5 : 1,
                                }}
                            >
                                <IconButton
                                    icon="account-multiple-plus"
                                    size={20}
                                    style={{ margin: 0, marginRight: 6 }}
                                    color="#FFFFFF"
                                />
                                <Text style={{ color: 'white', fontSize: 14, flexShrink: 1 }}>
                                    {pending ? 'Waiting for response…' : 'Escalate to conference'}
                                </Text>
                            </TouchableOpacity>
                        </Surface>
                    </View>
                ) : null}
            </>
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
            // Folded cover-display avatar — was 113, dropped 10% to
            // 102 per user request ("lower size of avatar 10%"). The
            // rest of the cover-display layout (foldedTopRow.height
            // = 140) still accommodates the avatar + name + URI
            // stack.
            userIconSize = 102;
        } else {
            // Portrait avatar — was 113, dropped 10% to 102.
            // Landscape avatar — was 75, dropped 10% to 68.
            userIconSize = this.state.isLandscape ? 68 : 102;
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
        // Tap the pill (when key-active) to open the SAS verification modal.
        //
        // The pill is gated on 'key-active', NOT 'key-agreed': 'key-agreed'
        // means the DH handshake completed and our setMediaEncryption /
        // setMediaDecryption native calls returned without throwing, but
        // it does NOT prove the peer is actually emitting AES-GCM
        // ciphertext. The decryptor's per-frame counters do — CallZrtp.js
        // polls receiver.getMediaDecryptionStats() every 500ms and
        // promotes us to 'key-active' only when decryptedFrames climbs.
        // It demotes back to 'key-agreed' (pill off) after 2 s of all-
        // passthrough. So the pill is an HONEST media-encryption signal,
        // not a "handshake done" signal.
        const renderZrtpBadge = () => {
            if (this.state.zrtpState !== 'key-active') {
                return null;
            }
            // Defensive: if the call has terminated but our state hasn't
            // caught up yet (rare race between BYE and the stateChanged
            // listener), still hide the pill — the encryption state is
            // meaningless once there's no media leg.
            const callState = this.state.call && this.state.call.state;
            if (!this.state.call || callState === 'terminated') {
                return null;
            }
            // Suppress the pill while the audio-device picker is open.
            // The pill sits above the call buttons and overlaps the
            // floating device picker panel; raising the picker above
            // the pill is fragile because it lives inside several
            // relatively-positioned wrappers whose stacking contexts
            // trap zIndex locally. Hiding the pill while the user is
            // interacting with the picker is the cleaner UX — the
            // pill returns the moment the picker closes.
            if (this.state.audioDevicePickerVisible) {
                return null;
            }
            let bg, label;
            const status = this._zrtpVerificationStatus();
            const session = getZrtpSession(this.state.call);
            const kinds = (session && session.encryptedKinds) || [];
            const kindsLabel = formatEncryptedKindsLabel(kinds);
            // In AudioCallBox the call is audio-only, so kindsLabel
            // is essentially always 'audio' and the word is
            // redundant in the pill. Suppress it here — keep the
            // kindsLabel ONLY when it carries something other than
            // plain 'audio' (e.g. 'audio and video' if the call
            // ever escalates) so an unusual state still surfaces.
            // Label simplification — AudioCallBox-specific rules:
            // this component renders for AUDIO-ONLY calls, so a
            // kindsLabel of 'audio' just means "everything in the
            // call is encrypted" and the "audio only" qualifier is
            // misleading (there's no video to compare against).
            // → 'audio' or 'audio and video' or '' → no prefix
            // → 'video' (would be unusual here) → 'video only '
            //   prefix to flag that audio isn't encrypted
            let _kindsPrefix = '';
            if (kindsLabel === 'video') {
                _kindsPrefix = 'video only ';
            }
            // Folded (cover-display) layout has very little horizontal
            // room in the stats column, so the long "end to end
            // encryption" copy gets swapped for the compact "encrypted"
            // wording per user request ('zRTP encrypted'). The
            // video-only prefix is still honoured because it's the only
            // way to convey that audio isn't covered by the agreed key.
            const _zrtpLabel = this.props.isFolded
                ? '🔒 zRTP ' + _kindsPrefix + 'encrypted'
                : '🔒 zRTP ' + _kindsPrefix + 'end to end encryption';
            if (status === 'verified') {
                bg = 'rgba(0, 170, 80, 0.9)';     // green — verified
                // "verified" word suppressed in the green pill per
                // user request — the green colour itself already
                // communicates the verified state. The mismatch /
                // unverified branches keep their text since their
                // colours alone aren't as self-explanatory.
                label = _zrtpLabel;
            } else if (status === 'mismatch') {
                bg = 'rgba(200, 30, 30, 0.9)';    // red — failed/MITM
                label = '⚠ SAS changed';
            } else {
                bg = 'rgba(230, 120, 0, 0.95)';   // orange — unverified
                label = _zrtpLabel;
            }
            const isTappable = true;
            const inner = (
                <View style={{
                    backgroundColor: bg,
                    paddingVertical: 3,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                    alignSelf: 'center',
                    flexShrink: 0,
                    // Don't let the stats column's narrow width
                    // truncate or wrap the pill. Letting the View
                    // overflow horizontally — combined with the
                    // numberOfLines/ellipsizeMode trio dropped from
                    // the Text — keeps the pill at its NATURAL full
                    // width regardless of the parent's flex math.
                }}>
                    <Text
                        style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}
                    >
                        {label}
                    </Text>
                </View>
            );
            // Dim "Tap to verify" sub-label is shown under the pill
            // ONLY when verification hasn't happened yet (orange /
            // unverified state). On the green "verified" pill we
            // skip the call-to-action entirely — re-verifying isn't
            // something the user usually wants to do, and the green
            // pill is already self-explanatory.
            // marginTop separates the badge from the stats dial.
            const _showTapToVerify = status !== 'verified';
            return (
                <View style={{ alignItems: 'center', marginTop: 26, overflow: 'visible' }}>
                    {isTappable ? (
                        <TouchableOpacity onPress={this._onZrtpBadgePress}>{inner}</TouchableOpacity>
                    ) : inner}
                    {_showTapToVerify ? (
                        <Text style={{
                            color: 'rgba(255, 255, 255, 0.55)',
                            fontSize: 10,
                            fontStyle: 'italic',
                            marginTop: 4,
                        }}>
                            Tap to verify
                        </Text>
                    ) : null}
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
                        <IconButton
                            icon="close"
                            size={22}
                            onPress={() => this.setState({ zrtpDialogVisible: false })}
                            accessibilityLabel="Close"
                            style={{ position: 'absolute', top: 4, right: 4, zIndex: 10, margin: 0 }}
                        />
                        <Dialog.Title>Verify zRTP encryption</Dialog.Title>
                        <Dialog.Content>
                            {zrtpSession && (
                                <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                                    Sylk-ZRTP v{zrtpSession.negotiatedVersion || '?'} · {zrtpSession.continuityState || 'first-time'}
                                </Text>
                            )}
                            <Text style={{ marginBottom: 12 }}>
                                Compare these with the other party. Both parties must show the same letters AND emojis.
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
                                    ✓ Verified on {formatVerifiedTimestamp(stored.verifiedAt)}
                                </Text>
                            )}
                            {verificationStatus === 'mismatch' && stored && (
                                <Text style={{ color: 'red', marginTop: 8 }}>
                                    ⚠ The other party's identity key has changed since the last verification on {formatVerifiedTimestamp(stored.verifiedAt)}. They may have reinstalled — or this could be a MITM. Re-verify carefully before tapping Confirm.
                                </Text>
                            )}
                        </Dialog.Content>
                        <Dialog.Actions style={{ justifyContent: 'space-between' }}>
                            <Button onPress={this._onZrtpReset}>Reset</Button>
                            <Button onPress={this._onZrtpVerifyConfirm} disabled={!zrtpSas}>Confirm</Button>
                        </Dialog.Actions>
                    </Dialog>
                    {/* zRTP mandatory-mode handshake failure prompt
                        used to live HERE (inside <Portal>, as a Paper
                        Dialog). That renders above the entire app,
                        which the user didn't want — the failure is a
                        per-call event and should be presented inside
                        the call screen. The panel has moved out of the
                        Portal and now renders as an in-call banner
                        below — see the View just below the downgrade
                        banner. */}
                    <Dialog
                        visible={this.state.zrtpMismatchAlarmVisible}
                        onDismiss={this._onZrtpMismatchAcknowledge}
                        dismissable={false}
                    >
                        <Dialog.Title style={{ color: 'red' }}>
                            ⚠ Identity key changed
                        </Dialog.Title>
                        <Dialog.Content>
                            <Text>
                                The other party's identity key has changed since
                                your last verified call with them.
                                {'\n\n'}
                                This may mean they reinstalled the app, OR
                                someone is impersonating them in a
                                man-in-the-middle attack.
                                {'\n\n'}
                                Verify in person or through a trusted channel
                                before continuing the conversation. Tap the
                                lock icon to re-check the SAS.
                            </Text>
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={this._onZrtpMismatchEndCall}>
                                End call
                            </Button>
                            <Button mode="contained" onPress={this._onZrtpMismatchAcknowledge}>
                                I understand
                            </Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>
                {this.state.zrtpDowngradeBannerVisible && (
                    <View
                        style={{
                            backgroundColor: 'rgba(230, 120, 0, 0.95)',
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            flexDirection: 'row',
                            alignItems: 'center',
                        }}
                    >
                        <Text style={{ color: 'white', flex: 1, fontSize: 13 }}>
                            ⚠ End-to-end encryption was attempted but did not
                            activate. This call is encrypted only between your
                            device and the relay (DTLS), not end-to-end.
                        </Text>
                        <Button
                            compact
                            mode="text"
                            onPress={this._onZrtpDowngradeBannerDismiss}
                            labelStyle={{ color: 'white', fontSize: 12 }}
                        >
                            Dismiss
                        </Button>
                    </View>
                )}
                {/* zRTP mandatory-mode handshake failure panel —
                    previously a Paper Dialog inside Portal (covered
                    the whole app), now an in-call banner so the
                    prompt is visually anchored to the call it
                    qualifies. Red backplate to distinguish from the
                    softer-orange downgrade-only banner above. The
                    two are mutually exclusive in practice but render
                    independently so a stacked appearance is benign
                    if it ever happens (red sits below orange,
                    obvious which one is more urgent). */}
                {this.state.zrtpMandatoryFailedVisible && (
                    <View
                        style={{
                            backgroundColor: 'rgba(200, 30, 30, 0.95)',
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                        }}
                    >
                        <Text style={{
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 'bold',
                            marginBottom: 6,
                        }}>
                            End-to-end encryption failed
                        </Text>
                        <Text style={{
                            color: 'white',
                            fontSize: 12,
                            lineHeight: 16,
                        }}>
                            The zRTP key exchange did not complete. You set
                            encryption to "mandatory" in Preferences, but the
                            other party may not support it.{'\n\n'}
                            You can end the call now, or continue without
                            end-to-end encryption. The call will still be
                            encrypted between your phone and the SylkServer
                            relay (DTLS), but the relay can read the media.
                        </Text>
                        <View style={{
                            flexDirection: 'row',
                            justifyContent: 'flex-end',
                            marginTop: 8,
                        }}>
                            <Button
                                compact
                                mode="text"
                                onPress={this._onZrtpMandatoryContinue}
                                labelStyle={{ color: 'white', fontSize: 12 }}
                            >
                                Continue
                            </Button>
                            <Button
                                compact
                                mode="contained"
                                onPress={this._onZrtpMandatoryEndCall}
                                buttonColor="white"
                                labelStyle={{ color: 'rgb(200, 30, 30)', fontSize: 12 }}
                                style={{ marginLeft: 8 }}
                            >
                                End call
                            </Button>
                        </View>
                    </View>
                )}
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
                    /* Drives the "Accepting call…" copy in the warmup
                       branch — see render() in CallOverlay. True only
                       while the cold-start push-accept route gate is
                       open in app.js. */
                    pushAcceptInProgress={this.props.pushAcceptInProgress}
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
										{/* "Start now" Button hidden per user request — only the countdown bar below remains, so the call auto-starts when the timer expires. */}
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
											{/* One cell per second of the original
											    countdown (`autoStartTotal`), filling
											    from left as `autoStartCountdown` ticks
											    down. So a 5 s timer = 5 bars max. */}
											{[...Array(this.state.autoStartTotal || 0)].map((_, i) => (
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
									// Folded layout only: lift the ZRTP
									// pill above its natural slot inside
									// the stats column. History: first
									// pass lifted by 70 px to pull the
									// pill close to the dial; lowered 30
									// (net -40); user then asked for 20
									// more up, net -60. The badge's own
									// outer wrapper has marginTop: 26
									// (see renderZrtpBadge), so net
									// effect from the speedometer
									// baseline is 26 - 60 = -34.
									this.renderStatsBlock(_callRemountKey, (
										<View style={{ marginTop: -60 }}>
											{renderZrtpBadge()}
										</View>
									))
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
							{/* Record-call pill in folded mode is lifted
							    30 px above its row baseline per user
							    request ("Lift Record Call pill 30px"). A
							    negative marginTop is used rather than
							    moving styles.foldedBottomRow's marginTop
							    so that the now-empty right column doesn't
							    follow it up — only the pill moves. */}
							<View style={[styles.foldedBottomLeft, { marginTop: -30 }]}>
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
						{/* Landscape left column. translateY: 0 — the
						    previous -50 lift was reverted per user
						    request ("lower avatar 50 px" after the
						    earlier 30 px lift, net = sits at natural
						    centerline). Restoring the natural position
						    lets the row anchor to the vertical centre
						    again. */}
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
							<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.displayName}>{displayName}</Dialog.Title>
							<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
								<Text key={'cb-uri-' + _callRemountKey} style={styles.uri}>{displayUri}</Text>
							</TouchableWithoutFeedback>
							{/* Record-call pill — sits under the URI in
							    landscape. marginTop history: 50 →
							    40 → 20 → 25 → 30 → 0 per "raise
							    record pill 30px". */}
							<View style={{ marginTop: 0 }}>
							    {this._renderRecordControl()}
							</View>
						</View>
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
							{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
						</View>
					</View>
				) : (
					<>
						<View key={'cb-usericon-wrap-' + _callRemountKey} style={userIconContainerClass}>
							{/* Avatar + bottom-right "+" chip live in a
							    relatively positioned wrapper so the chip
							    can be absolutely positioned against the
							    avatar's bounds without perturbing the
							    surrounding column layout (the column
							    still measures the avatar at userIconSize
							    × userIconSize). The chip + its drop-up
							    panel only render while the call is
							    actually in progress — see
							    _renderConferenceRequestPlus for the
							    state gate. */}
							<View style={{ width: userIconSize, height: userIconSize }}>
								<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
								{this._renderConferenceRequestPlus(userIconSize)}
							</View>
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
                            {/* Start video — mid-call upgrade button.
                                Sends a Janus SIP plugin "update"
                                request (SIP re-INVITE) with a fresh
                                offer that adds m=video to the existing
                                audio-only session. Visible only when
                                the call is fully established and the
                                running library exposes addVideo()
                                (added by patches/react-native-sylkrtc).
                                Hidden on PSTN calls — the gateway and
                                the PSTN side won't take video anyway,
                                so the button would just emit a
                                guaranteed-to-fail re-INVITE. */}
                            {this.props.startVideo
                              && this.state.call
                              && typeof this.state.call.addVideo === 'function'
                              && this.state.call.state === 'established'
                              && !isPhoneNumber ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-startvideo-' + _callRemountKey}
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            // MaterialCommunityIcons "video-outline".
                                            // Tried `video-plus` and
                                            // `video-plus-outline` first — both MCI
                                            // glyphs render the `+` INSIDE the camera
                                            // lens (the only difference between the
                                            // two is the silhouette stroke weight),
                                            // which reads as a focus reticle / busy
                                            // icon at the 24-32 px sizes we use. No
                                            // MCI variant puts the `+` in a corner
                                            // badge.
                                            //
                                            // Plain `video-outline` instead. The
                                            // audio call screen only has hangup +
                                            // this button when the call is
                                            // established AND the peer supports
                                            // video, so the meaning ("add video to
                                            // this call") is unambiguous from
                                            // context alone — the centred-`+` badge
                                            // wasn't carrying load.
                                            icon="video-outline"
                                            onPress={this.props.startVideo}
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
                                bar — absolutely positioned ABOVE the
                                audio-device / hangup button bar. Auto-
                                fires in 9 s if the user doesn't tap X.
                                bottom:150 puts the action right above
                                the button bar (which itself sits ~100
                                px from the bottom edge in portrait),
                                so the Start button is in easy thumb
                                reach next to the controls instead of
                                floating high near the avatar.
                                Hidden in folded mode: the cover-
                                display layout renders the same Button
                                + progress bar inline inside
                                foldedStatsColumn (the right half of
                                foldedTopRow) so the action sits next
                                to the avatar instead of floating
                                over it. */}
                            {this.props.isFolded ? null : (
                            <View style={{
                                position: 'absolute',
                                // bottom:190 leaves a comfortable gap
                                // above the call-buttons bar. The bar
                                // sits at marginBottom:50 with its
                                // own ~60 px height (top at y≈110);
                                // anchoring the Start wrapper at 190
                                // puts its bottom edge ~80 px above
                                // the bar's top — comfortable thumb-
                                // reach gap without crowding either
                                // surface.
                                bottom: 190,
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
                                    {/* "Start now" Button hidden per user request — only the countdown bar below remains, so the call auto-starts when the timer expires. */}

                                    {/* Sliding bar — width inherited
                                        from the wrapper (= Start button
                                        width). One cell per second of
                                        the original countdown
                                        (`autoStartTotal`), so the
                                        rightmost cell is fully filled
                                        at start regardless of whether
                                        the timer was armed for 4 s, 5 s,
                                        10 s, etc. */}
                                    <View style={{
                                        flexDirection: 'row',
                                        marginTop: 10,
                                        height: 6,
                                        alignSelf: 'stretch',
                                        justifyContent: 'space-between',
                                    }}>
                                        {/* One cell per second of the original
                                            countdown (`autoStartTotal`), filling
                                            from left as `autoStartCountdown` ticks
                                            down. So a 5 s timer = 5 bars max. */}
                                        {[...Array(this.state.autoStartTotal || 0)].map((_, i) => (
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
    // Mid-call audio -> audio+video upgrade. Invoked by the "Start
    // video" button rendered in the action bar of an established
    // audio-only call. Owner (Call.js) handles the getUserMedia +
    // call.addVideo() + state flip; here we just trigger it.
    startVideo: PropTypes.func,
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
	saveCallRecording: PropTypes.func,
	// Default sylk conference domain (e.g. videoconference.sip2sip.info)
	// used to compose the room URI sent in conference_request metadata.
	// Falls back to the hard-coded default inside sendConferenceRequest
	// when omitted, so this prop being undefined never breaks the
	// escalation flow.
	defaultConferenceDomain: PropTypes.string
};

export default AudioCallBox;
