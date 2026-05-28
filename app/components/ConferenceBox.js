'use strict';

import React, {useState, Component, Fragment} from 'react';
import { Alert, Clipboard, Platform, TouchableOpacity, Dimensions, SafeAreaView, ScrollView, FlatList, TouchableHighlight, Switch, PanResponder, NativeModules} from 'react-native';
import PropTypes from 'prop-types';
import * as sylkrtc from 'react-native-sylkrtc';
import classNames from 'classnames';
import debug from 'react-native-debug';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Appbar, Portal, Modal, Surface, Paragraph, Text, Menu } from 'react-native-paper';
import { View, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Animated, Easing} from 'react-native';
import { GiftedChat, Bubble, MessageText, Send, MessageImage } from 'react-native-gifted-chat'
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import VideoPlayer from 'react-native-video-player';
import Immersive from 'react-native-immersive';
import { getStatusBarHeight } from 'react-native-status-bar-height';

import { useEffect, useRef } from 'react';

import uuid from 'react-native-uuid';

import utils from '../utils';
//import AudioPlayer from './AudioPlayer';
import ConferenceDrawer from './ConferenceDrawer';
import ConferenceDrawerLog from './ConferenceDrawerLog';
// import ConferenceDrawerFiles from './ConferenceDrawerFiles';
import ConferenceDrawerParticipant from './ConferenceDrawerParticipant';
import ConferenceDrawerParticipantList from './ConferenceDrawerParticipantList';
import ConferenceDrawerSpeakerSelection from './ConferenceDrawerSpeakerSelection';
import ConferenceDrawerSpeakerSelectionWrapper from './ConferenceDrawerSpeakerSelectionWrapper';
import SpeakerSelectionModal from './SpeakerSelectionModal';
import ConferenceHeader from './ConferenceHeader';
import NetworkSpeedometer from './NetworkSpeedometer';
import AudioSpeedometer from './AudioSpeedometer';
import ConferenceCarousel from './ConferenceCarousel';
import ConferenceParticipant from './ConferenceParticipant';
import ConferenceMatrixParticipant from './ConferenceMatrixParticipant';
import ConferenceParticipantSelf from './ConferenceParticipantSelf';
import ConferenceAudioParticipantList from './ConferenceAudioParticipantList';
import ConferenceAudioParticipant from './ConferenceAudioParticipant';
// Day / night palette resolver — used to swap the per-participant
// muted-mic icon between salmon (dark mode) and dark grey (day mode).
// Pulled in as a peer of the other audio-tile imports above so the
// theming choice lives next to the components it styles.
import DarkModeManager from '../DarkModeManager';

// QoS instrumentation — see qos/qos-stats.js and qos/README.md.
// Gated on __DEV__ so production builds skip the bridge cost entirely.
import {
    startQosLogging as _startQosLogging,
    stopQosLogging  as _stopQosLogging,
} from '../../qos/qos-stats';
const startQosLogging = __DEV__ ? _startQosLogging : () => {};
const stopQosLogging  = __DEV__ ? _stopQosLogging  : () => {};

import { applyVideoEncoderParamsToPc } from './CallZrtp';
// Note: `ContactsListBox` does NOT export `renderBubble` as a named
// symbol — it lives as a class method on the component. The old
// `import { renderBubble } from './ContactsListBox'` line was
// resolving to `undefined`, which is why GiftedChat in this file
// fell back to its narrow default Bubble (the "squeezed file
// upload" symptom). The local renderBubble method defined inside
// this component now handles the wrapping; no import needed.
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import UpgradeVideoModal from './UpgradeVideoModal';
import StartCameraPreviewModal from './StartCameraPreviewModal';
import KeyboardSpacer from 'react-native-keyboard-spacer';
import InCallManager from 'react-native-incall-manager';

import xss from 'xss';
import * as RNFS from 'react-native-fs';
import CallRecorder from '../CallRecorder';
import CallRecordingDisclosureModal from './CallRecordingDisclosureModal';
import {
    readAcknowledged as readConferenceRecordingDisclosure,
    setAcknowledged  as setConferenceRecordingDisclosure,
} from '../conferenceRecordingDisclosure';
import RNBackgroundDownloader from '@kesha-antonov/react-native-background-downloader'

import md5 from "react-native-md5";
import FileViewer from 'react-native-file-viewer';
import _ from 'lodash'; import { produce } from "immer"
import moment from 'moment';
import {StatusBar} from 'react-native';

import styles from '../assets/styles/ConferenceCall';

const DEBUG = debug('blinkrtc:ConferenceBox');
//debug.enable('*');

const MAX_POINTS = 30;

function appendBits(bits) {
    let i = -1;
    const byteUnits = 'kMGTPEZY';
    do {
        bits = bits / 1000;
        i++;
    } while (bits > 1000);

    return `${Math.max(bits, 0.1).toFixed(bits < 100 ? 1 : 0)} ${byteUnits[i]}bits/s`;
};

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

function useLogChanges(label, value) {
  const prevValue = usePrevious(value);
  useEffect(() => {
    if (prevValue !== undefined && JSON.stringify(prevValue) !== JSON.stringify(value)) {
      console.log(`--- ${label} changed ---`);
      console.log('previous:', prevValue);
      console.log('current:', value);
    }
  }, [value]);
}

const conferenceHeaderHeight = 60;

  const availableAudioDevicesIconsMap = {
	BUILTIN_EARPIECE: 'phone-in-talk',
	WIRED_HEADSET: 'headphones',
	BLUETOOTH_SCO: 'bluetooth-audio',
	BUILTIN_SPEAKER: 'volume-high',
  };

// Audio device picker style:
//   'cycle'    - legacy: tap cycles through available devices
//   'menu'     - react-native-paper dropdown Menu (icon + name per row)
//   'floating' - WhatsApp-style: extra IconButtons float below the main button
//                (below because the conference button bar is at the top of the screen)
const AUDIO_DEVICE_PICKER_MODE = 'floating';

// Self-view style while waiting alone in a video conference:
//   true  - fill the whole screen with the local video until someone joins
//   false - always show the small corner rectangle (legacy behavior)
const SOLO_SELF_FULLSCREEN = true;

// If a participant doesn't deliver any inbound video for this many ms,
// hide their tile and recompute the grid; restore it the moment data
// flows again. Tuned to ride out short hiccups without blanking the
// grid on every brief stall.
const PARTICIPANT_STALL_MS = 20000;


// Tiny opacity-pulse wrapper used to draw attention to muted-state
// mute icons (per-participant inline mics + the local action-bar
// mute button). `active=true` runs an infinite ping-pong fade
// (1.0 → 0.35 → 1.0) on the wrapper; `active=false` snaps back to
// fully opaque and stops the loop. native-driver opacity keeps the
// animation off the JS thread so the rest of the conference UI
// stays smooth.
class PulsingView extends Component {
    constructor(props) {
        super(props);
        this._opacity = new Animated.Value(props.active ? 1 : 1);
        this._loop = null;
    }
    componentDidMount() {
        if (this.props.active) this._startLoop();
    }
    componentDidUpdate(prevProps) {
        if (this.props.active && !prevProps.active) {
            this._startLoop();
        } else if (!this.props.active && prevProps.active) {
            this._stopLoop();
        }
    }
    componentWillUnmount() {
        this._stopLoop();
    }
    _startLoop() {
        this._stopLoop();
        this._loop = Animated.loop(
            Animated.sequence([
                Animated.timing(this._opacity, {
                    toValue: 0.35,
                    duration: 600,
                    useNativeDriver: true,
                }),
                Animated.timing(this._opacity, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: true,
                }),
            ])
        );
        this._loop.start();
    }
    _stopLoop() {
        if (this._loop) {
            this._loop.stop();
            this._loop = null;
        }
        this._opacity.setValue(1);
    }
    render() {
        return (
            <Animated.View style={[this.props.style, {opacity: this._opacity}]}>
                {this.props.children}
            </Animated.View>
        );
    }
}


class ConferenceBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.prevValues = {};
        // Native Animated.Value driving the participants-area collapse on
        // keyboard show. 1.0 = visible at full bounded height, 0.0 = fully
        // collapsed. Animating this instead of setStating keyboardVisible
        // avoids re-rendering ConferenceBox, so GiftedChat's TextInput
        // keeps focus and the keyboard doesn't fold back.
        this._participantsVisibility = new Animated.Value(1);

        this.downloadRequests = {};

        this.packetLoss = new Map();

        this.latency = new Map();

        this.mediaLost = new Map();

        // Per-participant codec info (mimeType subtype, e.g. "VP8", "H264", "opus")
        this.videoCodec = new Map();
        this.audioCodec = new Map();

        // Wall-clock timestamp (ms) of the last sample where this
        // participant's inbound video bytes increased. Used to time-out
        // tiles whose remote has stopped sending video for >
        // PARTICIPANT_STALL_MS, then restore them when data flows again.
        this.lastVideoActivity = new Map();

        this.sampleInterval = 1;

        // One-shot latch — set true the first time getConnectionStats
        // observes inbound video bytes from any remote participant
        // while we're in audio view. When that happens we surface
        // the UpgradeVideoModal so the user can choose to start
        // their own camera (Accept) or stay in audio (Cancel).
        // Either path flips the latch true; subsequent video
        // starts / stops are the user's responsibility via the
        // kebab. Lives on the instance (not state) because it's a
        // one-time operational signal — its truthiness gates the
        // detector, not any rendered output.
        this._autoEscalatedToVideo = false;

        // Latch for the user-initiated audio→video toggle's first-
        // time "Start your camera?" prompt. Once the user has been
        // asked (whether they accepted or cancelled), subsequent
        // toggles bypass the prompt and just flip the camera /
        // view mode immediately. Independent of
        // _autoEscalatedToVideo because the two prompts have
        // different triggers and we only want each path to ask at
        // most once.
        this._cameraStartPromptShown = false;

        // True after the user has explicitly tapped Stop video (or
        // Mute Camera) during this conference session. Distinct
        // from videoMutedbyUser which is also true when the user
        // simply pressed the Audio button at call start —
        // _userExplicitlyStoppedVideo is set ONLY by an explicit
        // mid-call stop and gates the audio→video toggle's auto-
        // resume so the camera doesn't silently come back on when
        // the user flips views. Cleared by Start video (explicit
        // resume) so the next stop cycle re-arms it correctly.
        this._userExplicitlyStoppedVideo = false;

        // Per-participant VU-meter audio levels (0..1). Keyed by
        // participant id for remote participants and by the literal
        // string 'myself' for the local microphone. Same map shape
        // AudioCallBox uses for its 2-channel meter, just with one
        // entry per conference attendee. Maintained at ~5 Hz by
        // _sampleConferenceAudioLevels (separate from the 1 Hz
        // bandwidth / loss sampler — VU updates need to feel live).
        this.audioLevels = new Map();

        this.typingTimer = null;
        
        this.myself = null;

        let renderMessages = [];
        this.participantStats = {};
        if (this.props.remoteUri in this.props.messages) {
            renderMessages = this.props.messages[this.props.remoteUri];
        }

        let duration = 0;

        if (this.props.call) {
            let giftedChatMessage;
            let direction;
            // Guarded — same pattern the self-tile path at line ~6542
            // uses. props.callState comes from app.js's callsState[call.id]
            // dict, which is populated when the call transitions to
            // 'accepted' / 'established' (see callStateChanged in app.js
            // ~9420-9481). On the first ConferenceBox render after a
            // newly-accepted conference invite there's a brief window
            // where the parent's callsState setState hasn't flushed yet
            // even though Conference.js has already flipped its own
            // local callState to 'established' and triggered our render
            // — in that window props.callState is undefined and this
            // constructor would otherwise crash trying to read
            // .startTime. Fall back to 0 duration; the next render
            // tick will have the populated object.
            const _startTime = this.props.callState && this.props.callState.startTime;
            duration = _startTime ? Math.floor((new Date() - _startTime) / 1000) : 0;

            this.props.call.messages.forEach((sylkMessage) => {
                if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                    return;
                }

                if (sylkMessage.type === 'status') {
                    return;
                }

                const existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                if (existingMessages.length > 0) {
                    return;
                }

                direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                    direction = 'outgoing';
                }

                giftedChatMessage = utils.sylk2GiftedChat(sylkMessage, null, direction);
                renderMessages.push(giftedChatMessage);
                this.saveConferenceMessage(this.props.remoteUri, giftedChatMessage);
            });
        }

        const videoEnabled = this.props.call && this.props.call.getLocalStreams()[0].getVideoTracks().length > 0;

        let participants = [];
        if (props.call) {
            props.call.participants.forEach((p) => {
                if (!p.timestamp) {
                    p.timestamp = Date.now();
                }
            });
            participants = props.call.participants.slice();
        }

        this.state = {
            callOverlayVisible: true,
            remoteUri: this.props.remoteUri,
            call: this.props.call,
            accountId: this.props.call ? this.props.call.account.id : null,
            renderMessages: renderMessages,
            ended: false,
            duration: duration,
            isTyping: false,
            keyboardVisible: false,
            videoEnabled: videoEnabled,
            audioMuted: this.props.muted,
            // Initial camera-mute state. Two inputs:
            //   • props.audioOnly — the user's intent at start
            //     ("Audio" button vs "Video" button on the
            //     conference start screen). The wire-level call
            //     ALWAYS negotiates video now (see callKeepStart-
            //     Conference in app.js), so audioOnly here is a
            //     pure UX signal: "start with the camera track
            //     suppressed (track.enabled = false) and the
            //     audio layout selected". Flipping it off later
            //     via the camera picker just toggles track.enabled
            //     and frames start flowing — no renegotiation,
            //     no permission re-request.
            //   • !this.props.inFocus — the previous behavior
            //     where backgrounded calls also start with the
            //     camera suppressed. Kept so backgrounded video
            //     starts don't immediately broadcast frames.
            videoMuted: this.props.audioOnly || !this.props.inFocus,
            videoMutedbyUser: !!this.props.audioOnly,
            // Track which camera is active so the self-thumbnail and
            // large self-view only mirror when the front camera is in
            // use. WebRTC's getUserMedia defaults to the front camera
            // on mobile, so we start at 'front' and flip on each
            // _switchCamera() call below.
            cameraFacing: 'front',
            messages: this.props.messages,
            participants: participants,
            audioChatView: false,
            // Local raised-hand status — derived in onRaisedHands by
            // checking the server-sent list against the local URI.
            // The button onPress (toggleRaisedHand) calls
            // Conference.toggleHand and lets the round-trip update
            // flip this rather than flipping it optimistically.
            raisedHand: false,
            // Bridge tile visibility. Default false (bridge hidden
            // from the participant list because most users don't
            // want to see it). When true, the bridge tile appears
            // among the SIP audio participants. Toggled from the
            // ConferenceHeader kebab menu when a bridge is detected
            // in the room.
            showBridge: false,
            // Snapshot of participant.id values currently with a
            // raised hand. Replaced wholesale every time a
            // `raisedHands` event arrives (the payload is the full
            // list). Tile renderers read from this set to decide
            // whether to show the yellow hand badge.
            raisedHandsByPid: new Set(),
            // Seed sipParticipants from the long-lived call object so
            // navigating to the contact list and back doesn't lose the
            // SIP-side roster between ConferenceBox remounts. The call
            // is owned by Conference.js / app.js and persists across
            // routes while the conference is alive; we cache the last
            // snapshot we received on it.
            sipParticipants: (props.call && Array.isArray(props.call._sipParticipants)) ? props.call._sipParticipants : [],
            // Server-authoritative conference duration captured once on
            // join (seconds). Used by ConferenceHeader to seed its
            // running meter to "conference has been going N seconds" —
            // independent of when this user joined. Restored from the
            // long-lived call object across ConferenceBox remounts the
            // same way sipParticipants is.
            conferenceDurationAtJoin: (props.call && typeof props.call._conferenceDurationAtJoin === 'number')
                ? props.call._conferenceDurationAtJoin
                : null,
            // Per-participant live audio levels keyed by participant_id.
            // Re-populated every audio_level_notify_period (default
            // ~250ms) from the sipConferenceAudioLevels event. Tiles
            // look up their own participant_id in this map and render
            // a VU bar from `.rx_peak` (mean of µ-law averages is too
            // smooth to drive a meter usefully — peak is bursty enough
            // to track speech).
            sipAudioLevels: {},
            sipAudioLevelsTs: null,
            showInviteModal: false,
            showDrawer: false,
            keyboardHeight: 0,
            showFiles: false,
            shareOverlayVisible: false,
            showSpeakerSelection: false,
            activeSpeakers: props.call.activeParticipants.slice(),
            selfDisplayedLarge: false,
            eventLog: [],
            sharedFiles: props.call.sharedFiles.slice(),
            largeVideoStream: null,
            previousParticipants: this.props.previousParticipants,
            inFocus:  this.props.inFocus,
            reconnectingCall: this.props.reconnectingCall,
            terminated: this.props.terminated,
            chatView: !videoEnabled,
            audioView: !videoEnabled,
            isLandscape: this.props.isLandscape,
            selectedContacts: this.props.selectedContacts,
            activeDownloads: {},
            myVideoCorner: 'bottomRight',
            // Initial self-PIP / "mirror" visibility.
            //
            // The audio-view PIP and the video-view floating self-
            // tile both gate on state.enableMyVideo. When the user
            // chose Audio at start (props.audioOnly = true), the
            // intent was "minimum surface — just the participant
            // list" and they likely don't expect a mirror at all.
            // Hide it by default so the audio start is uncluttered;
            // the user can flip it on via the kebab's "Show mirror"
            // item if they want a preview. A Video start keeps the
            // mirror enabled, mirroring the previous behaviour.
            enableMyVideo: !this.props.audioOnly,
            offset          : 0,
            statistics: [],
            // IDs of participants whose inbound video has been silent for
            // PARTICIPANT_STALL_MS. Tile hidden + grid recalculated until
            // data resumes.
            stalledParticipants: new Set(),
            // Multi-track conference recording state. Sibling to
            // AudioCallBox's isRecording/recordingElapsedSec, but the
            // file model is different: one .wav per source (mic +
            // each remote participant) plus a manifest.json. See
            // CallRecorder.js for the on-disk layout.
            //   • isConferenceRecording — toggles the red record dot
            //     + the action-bar button colour.
            //   • conferenceRecordingDir — absolute path of the
            //     directory the native recorder is populating; set
            //     when _startConferenceRecording resolves.
            //   • conferenceRecordingElapsedSec — driven by a 1 Hz
            //     setInterval for the action-bar timer pill.
            isConferenceRecording: false,
            conferenceRecordingDir: null,
            conferenceRecordingElapsedSec: 0,
            // Conference recording disclaimer gate. The disclaimer is
            // stored independently from the 1-to-1 call recording one
            // (see conferenceRecordingDisclosure.js) because recording
            // a multi-party room is meaningfully different — more
            // consents matter, the moderator may not be you, the file
            // captures every attendee at once. showConferenceRecording
            // Disclosure flips true on the first Record tap if the
            // flag isn't already set; the modal's onContinue persists
            // the flag and resumes the start, onCancel just closes
            // and leaves the recorder un-started.
            showConferenceRecordingDisclosure: false,
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			audioDevicePickerVisible: false,
			// Toggles the floating camera-action panel that replaces
			// the standalone mute-video + toggle-camera buttons on
			// the conference action bar. Same name / pattern VideoBox
			// uses for its picker so the audio-device picker's
			// "collapse the other panel when opening" logic stays
			// symmetrical across the two surfaces.
			videoPickerVisible: false,
			// Per-participant bandwidth overlay (top-left floating
			// panel) — default expanded. Tap to collapse to a small
			// speedometer chip; tap the chip to expand again. State
			// persists for the duration of the call.
			bwOverlayCollapsed: false,
			// Free-drag position for the stats panel. null = use
			// the default top-right anchored placement; once the
			// user drags the panel, switches to absolute {x, y}
			// from the top-left. Same shape and clamping as
			// pipPosition (the audio-view mirror's drag).
			statsPosition: null,
			// Aspect ratio for ALL video tiles (matrix participants
			// + self PIP / self matrix tile). Matches VideoBox's
			// state.aspectRatio — 'cover' fills the tile with
			// possible cropping at the edges; 'contain' fits the
			// whole frame inside the tile with letterbox bars.
			// Toggled by the kebab "Aspect ratio" menu item.
			aspectRatio: 'cover',
			// User-controlled view mode, independent of the call's
			// media capability (props.audioOnly). The conference UI
			// has two distinct layouts:
			//
			//   • 'audio' — participant list with VU meters, no
			//     video grid. Compact, low-bandwidth on the
			//     receiving brain.
			//   • 'video' — active-speaker grid with PIP self-view,
			//     floating action bar overlaid on the video.
			//
			// Initialised from the call's starting media constraint
			// so an audio call opens in audio view and a video call
			// opens in video view (existing behaviour). After that
			// the user toggles freely via the kebab menu — even an
			// All conference joins now START in 'audio' view —
			// even outgoing calls that the user opted to bring up
			// with video. Rationale: audio view is calmer, has
			// no flashing camera tile grid, and avoids the
			// "joined into a noisy mosaic" feeling for invitees.
			// The auto-escalate guard inside getConnectionStats
			// flips to 'video' ONCE when any remote participant
			// is detected sending video — see this._autoEscalatedToVideo
			// for the one-shot latch. Users who never see remote
			// video stay in audio view and can manually switch via
			// the kebab. Users who started a call expecting video
			// land in audio for the first tick or two, then
			// auto-promote as soon as their own / a peer's video
			// frames begin to flow.
			viewMode: 'audio',
			// "Start your camera?" prompt shown when the first
			// remote participant sends video (see _autoEscalatedToVideo
			// + the inbound-video branch in getConnectionStats).
			// Uses the existing UpgradeVideoModal so the prompt
			// matches the one shown when a peer escalates a 1:1
			// audio call to video — same green Accept / red Cancel
			// IconButtons. cameraPromptRemoteUri carries the URI
			// of the first remote that triggered the prompt so
			// the dialog can name them ("alice@…  wants to add
			// video to this call").
			cameraPromptVisible: false,
			cameraPromptRemoteUri: '',
			// Drives the StartCameraPreviewModal — the full-screen
			// preview + "Enable your camera?" panel we show on the
			// first audio→video toggle of the session. Decoupled
			// from cameraPromptVisible (the UpgradeVideoModal's
			// auto-escalate prompt) so a remote-driven escalate
			// and a user-driven toggle don't fight for the same
			// surface.
			cameraStartPreviewVisible: false,
			// Free-drag position for the audio-view self-PIP
			// (renders only when state.videoEnabled). null = use
			// the default bottom-right placement; once the user
			// drags the thumbnail anywhere on screen it switches
			// to absolute {x, y} from the top-left, persisted on
			// state so subsequent renders honour it. Clamped to
			// the window in the PanResponder so it can't be
			// dragged off-screen.
			pipPosition: null,
		    insets: this.props.insets,
		    publicUrl: this.props.publicUrl
        };

        const friendlyName = this.state.remoteUri ? this.state.remoteUri.split('@')[0] : '';
        //if (window.location.origin.startsWith('file://')) {
            this.conferenceUrl = `${this.state.publicUrl}/conference/${friendlyName}`;
        //} else {
        //    this.conferenceUrl = `${window.location.origin}/conference/${friendlyName}`;
        //}

        this.overlayTimer = null;
        this.logEvent = {};
        this.uploads = [];
        this.selectSpeaker = 1;
        this.foundContacts = new Map();

        // PanResponder for the draggable audio-view self-PIP.
        //
        // Behaviour:
        //   • onStartShouldSetPanResponder returns false so single
        //     taps on the overlay buttons (mute camera, switch
        //     camera) reach those TouchableOpacity handlers
        //     without the wrapper stealing them.
        //   • onMoveShouldSetPanResponder claims the gesture only
        //     once the user has moved ~5px on either axis — that's
        //     the threshold above which the gesture clearly stops
        //     reading as a tap. Anything below stays a tap and
        //     hits the buttons normally.
        //   • On grant, we cache the PIP's starting top-left so
        //     gestureState's cumulative dx/dy can be added without
        //     incremental drift.
        //   • On move, the new position is clamped to the window
        //     so the PIP can never be flung off-screen.
        //   • On release, no extra work — pipPosition state holds
        //     wherever the gesture ended.
        //
        // PIP_W / PIP_H are kept in sync with the inline style on
        // the rendered <View> below. If you change the thumbnail
        // size, update both.
        this._PIP_W = 120;
        this._PIP_H = 160;
        this._pipDragStart = null;
        this._pipPanResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onStartShouldSetPanResponderCapture: () => false,
            onMoveShouldSetPanResponder: (_e, g) =>
                Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
                Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
            onPanResponderGrant: () => {
                this._pipDragStart = this.state.pipPosition || this._getDefaultPipPosition();
            },
            onPanResponderMove: (_e, g) => {
                if (!this._pipDragStart) return;
                const { width, height } = Dimensions.get('window');
                let x = this._pipDragStart.x + g.dx;
                let y = this._pipDragStart.y + g.dy;
                x = Math.max(0, Math.min(width - this._PIP_W, x));
                y = Math.max(0, Math.min(height - this._PIP_H, y));
                this.setState({ pipPosition: { x, y } });
            },
            onPanResponderRelease: () => { this._pipDragStart = null; },
            onPanResponderTerminate: () => { this._pipDragStart = null; },
        });

        // PanResponder for the floating stats panel (per-
        // participant bandwidth + RTT + loss). Same threshold-
        // before-claim pattern as the PIP responder above so taps
        // on the close (×) button and on row text are NOT stolen
        // by the wrapper. Move > 5 px on either axis flips the
        // gesture into a drag; under that it stays a tap and
        // reaches the underlying TouchableOpacity / Text.
        //
        // Width/height for clamping aren't fixed — the panel
        // grows/shrinks with the participant count. We approximate
        // using maxWidth (320) and observed minHeight (kept loose
        // at 200 since rows are tiny). The render uses these same
        // constants to validate state.statsPosition after an
        // orientation change so the panel can't end up stranded
        // off-screen.
        this._STATS_W = 320;
        this._STATS_H = 200;
        this._statsDragStart = null;
        this._statsPanResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onStartShouldSetPanResponderCapture: () => false,
            onMoveShouldSetPanResponder: (_e, g) =>
                Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
                Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
            onPanResponderGrant: () => {
                this._statsDragStart = this.state.statsPosition || this._getDefaultStatsPosition();
            },
            onPanResponderMove: (_e, g) => {
                if (!this._statsDragStart) return;
                const { width, height } = Dimensions.get('window');
                let x = this._statsDragStart.x + g.dx;
                let y = this._statsDragStart.y + g.dy;
                // Clamp using the panel's MEASURED size (captured
                // via onLayout — see the panel render below).
                // The previous clamp used this._STATS_W (the
                // maxWidth cap of 320) which over-constrained the
                // drag to the right: with the shrink-to-fit
                // panel only ~180 px wide in healthy rooms, the
                // upper bound stayed at width-320 and the user
                // couldn't drag the panel past roughly the
                // middle of the screen. Falling back to
                // _STATS_W when we haven't measured yet keeps
                // the very first drag conservative.
                const _w = this._statsMeasuredW || this._STATS_W;
                const _h = this._statsMeasuredH || this._STATS_H;
                x = Math.max(0, Math.min(width - _w, x));
                y = Math.max(0, Math.min(height - _h, y));
                this.setState({ statsPosition: { x, y } });
            },
            onPanResponderRelease: () => { this._statsDragStart = null; },
            onPanResponderTerminate: () => { this._statsDragStart = null; },
        });
        if (this.props.call) {
            this.lookupContact(this.props.call.localIdentity._uri, this.props.call.localIdentity._displayName);
        }

        [
            'error',
            'warning',
            'info',
            'debug'
        ].forEach((level) => {
            this.logEvent[level] = (
                (action, messages, originator) => {
                    const log = this.state.eventLog.slice();
                    log.unshift({originator, originator, level: level, action: action, messages: messages});
                    this.setState({eventLog: log});
                }
            );
        });

        // Persist the invited-participants map on the long-lived call
        // object so it survives ConferenceBox remounts (e.g. when the
        // user navigates to the contact picker via the + button and
        // returns). A fresh `new Map()` per mount would silently drop
        // previously-failed invite tiles the user hasn't dismissed.
        if (props.call) {
            if (!props.call._invitedParticipants) {
                props.call._invitedParticipants = new Map();
            }
            this.invitedParticipants = props.call._invitedParticipants;
        } else {
            this.invitedParticipants = new Map();
        }
        // Per-URI 60s "no-update" timers. Restart for any URIs still
        // in 'Invited'/'progress' state on mount so a navigate-away and
        // back doesn't extend the original 60s window.
        this._inviteTimers = new Map();
        //console.log('Initial call duration', duration);

        props.initialParticipants.forEach((uri) => {
            const existing_participants = participants.filter(p => p.identity._uri === uri);
            if (existing_participants.length === 0 && !this.invitedParticipants.has(uri)) {
                this.invitedParticipants.set(uri, {timestamp: Date.now(), status: duration < 10 ? 'Invited' : 'No answer'})
                this.lookupContact(uri);
            }
        });

        this.participantsTimer = setInterval(() => {
             this.updateParticipantsStatus();
        }, this.sampleInterval * 1000);

        // Fast VU-meter sampler. Runs at ~5 Hz so the per-participant
        // signal-strength bars feel live without flooding the JS
        // bridge. Reuses each participant's existing peer connection
        // (p._pc) and the local call's PC (this.props.call._pc) —
        // no extra WebRTC plumbing needed. Cleared in
        // componentWillUnmount alongside the slower bandwidth /
        // status sampler.
        this._vuSamplerTimer = setInterval(() => {
            this._sampleConferenceAudioLevels();
        }, 200);

        this.props.getMessages(this.state.remoteUri.split('@')[0]);

        setTimeout(() => {
            this.listSharedFiles();
        }, 1000);
    }

	componentDidUpdate(prevProps, prevState) {
	     if (this.state.insets != prevState.insets) {
			//console.log(' --- CB insets did change', this.state.insets);
			let { width, height } = Dimensions.get('window');
			//console.log('width', width);
			//console.log('height', height);
	     }

	     if (this.state.isLandscape != prevState.isLandscape) {
			let { width, height } = Dimensions.get('window');
			//console.log('width', width);
			//console.log('height', height);
	     }

	     // Auto-lower hand when the raise-hand button is no longer
	     // visible. The button is gated by `_showRaiseHand` in render
	     // — (_webrtcTotal + _sipRealCount) > 2 — so when the room
	     // shrinks to ≤2 attendees the gate flips off and the
	     // affordance disappears. If we'd left the hand RAISED on the
	     // conference focus, the user can no longer see / interact
	     // with the lower-hand affordance, and the server state stays
	     // stuck (raised hand badge still shows on remote tiles).
	     // Detect the moment state.raisedHand is true while the gate
	     // is closed and fire a single toggleHand to lower it. The
	     // round-trip will clear state.raisedHand via the usual
	     // onRaisedHands path, so this only fires once per stuck
	     // condition (re-entry would see raisedHand=false and skip).
	     const _roomCount = ((this.state.participants ? this.state.participants.length : 0) + 1)
	         + ((this.state.sipParticipants || []).filter((sp) => sp && sp.type === 'sip').length);
	     const _raiseHandVisible = _roomCount > 2;
	     if (!_raiseHandVisible && this.state.raisedHand && this.props.call
	             && typeof this.props.call.toggleHand === 'function') {
	         console.log('[ConferenceBox] [conference] auto-lowering hand: raise-hand UI hidden (roomCount=' + _roomCount + ')');
	         try {
	             this.props.call.toggleHand();
	         } catch (e) {
	             console.log('[ConferenceBox] [conference] auto-lower hand toggleHand threw: ' + (e && e.message));
	         }
	     }
	}

    componentDidMount() {
        // Keep the screen awake for the entire lifetime of the
        // conference UI. Without this, the OS idle timer dims and
        // locks the screen after ~30s of no touch — fine for a
        // phone call, useless for a video conference where the
        // user is just watching. Works on both platforms:
        // iOS sets UIApplication.isIdleTimerDisabled; Android sets
        // FLAG_KEEP_SCREEN_ON on the activity window. Safe to call
        // regardless of whether InCallManager.start() has run.
        try { InCallManager.setKeepScreenOn(true); } catch (e) { /* best effort */ }

        // Re-arm the 45s "no-update" timer for any persisted invited
        // entries that haven't seen a final status yet.
        try {
            for (const [uri, entry] of this.invitedParticipants.entries()) {
                if (!entry) continue;
                const s = String(entry.status || '');
                const isFinal = /^[2-6]\d\d\b/.test(s) || s === 'Accepted';
                if (!isFinal) this._scheduleInviteTimeout(uri);
            }
        } catch (e) { /* best effort */ }

        // [qos] — start the QoS sampler against the conference's own
        // PeerConnection. Mirrors the AudioCallBox integration; emits
        // [qos] CONNECT / STATS / DISCONNECT into metro.log so
        // qos/qos.sh and qos/qos-probe.py can pick it up.
        if (this.props.call && this.props.call._pc) {
            startQosLogging(this.props.call._pc);
        }

        for (let p of this.state.participants) {
            p.on('stateChanged', this.onParticipantStateChanged);
            p.attach();
        }

        this.keyboardDidShowListener = Keyboard.addListener(
              'keyboardDidShow',
              this._keyboardDidShow
            );
        this.keyboardDidHideListener = Keyboard.addListener(
              'keyboardDidHide',
              this._keyboardDidHide
            );

        this.props.call.on('participantJoined', this.onParticipantJoined);
        this.props.call.on('participantLeft', this.onParticipantLeft);
        this.props.call.on('roomConfigured', this.onConfigureRoom);
        this.props.call.on('fileSharing', this.onFileSharing);
        this.props.call.on('composingIndication', this.composingIndicationReceived);
        this.props.call.on('message', this.messageReceived);

        // Server-driven room-state events. raisedHands carries the
        // FULL list of participants with hands up (snapshot, not
        // delta) — see sylkrtc API.md. muteAudio fires on every
        // attendee when any participant invokes
        // muteAudioParticipants; we treat it as a request to mute
        // the local mic.
        this.props.call.on('raisedHands', this.onRaisedHands);
        this.props.call.on('muteAudio', this.onMuteAudio);
        // Per-participant mute request from the gateway — another
        // attendee invoked muteParticipant() targeting our session.
        // Flip the local mic to match `event.muted` so the recipient's
        // mic state reflects what the moderator asked for, then the
        // existing onMuteAudio plumbing takes care of broadcasting the
        // state change for the rest of the UI.
        this.props.call.on('muteRequest', this.onMuteRequest);

        // Seed the raised-hands set from whatever snapshot the
        // conference already holds (Conference.raisedHands getter).
        // Without this, hands raised BEFORE we joined would only
        // surface on the next toggle event.
        if (typeof this.props.call.raisedHands !== 'undefined') {
            try {
                const _seedList = this.props.call.raisedHands;
                this.onRaisedHands(Array.isArray(_seedList) ? _seedList : []);
            } catch (e) { /* best effort */ }
        }

        this.props.call.on('sipConferenceParticipants', (participants, duration) => {
            // Verbose JSON dump silenced — was useful while pinning
            // down the muted-state serialization issue, now too
            // chatty per NOTIFY. Re-enable by uncommenting the
            // JSON.stringify line if a future shape question comes up.
            // console.log('[ConferenceBox] sipConferenceParticipants duration=' + duration + ':\n' +
            //             JSON.stringify(participants, null, 2));
            const _list = Array.isArray(participants) ? participants : [];
            // Diagnostic — proves the listener is actually firing and
            // shows the size + types of the snapshot so we can match
            // it against the Conference.js "SIP conference participants:"
            // log line which is on the same emit. If this line is
            // missing while Conference.js's is present, the
            // ConferenceBox listener never got wired up (timing /
            // remount race) and we'll need to defer the attach.
            try {
                const _summary = _list.map((sp) => {
                    if (!sp) return '?';
                    const _muted = (sp.endpoints && sp.endpoints[0]
                        && sp.endpoints[0].muted) ? '[muted]' : '';
                    return (sp.type || '?') + ':' + (sp.uri || '?') + _muted;
                }).join(', ');
                console.log('[ConferenceBox] sipConferenceParticipants tick:',
                    'size=', _list.length,
                    'primed=', !!this._sipRosterPrimed,
                    'prev=', (this._prevSipUris ? Array.from(this._prevSipUris).join(',') : '∅'),
                    'curr=[', _summary, ']');
            } catch (e) {
                console.log('[ConferenceBox] sipConferenceParticipants tick log failed:',
                    e && e.message);
            }

            // Diff the SIP roster so PSTN / SIP callers get the same
            // join/leave chat-log entries the WebRTC participants get
            // via onParticipantJoined / onParticipantLeft. The
            // videoroom's `participantJoined` event only fires for
            // WebRTC peers; SIP / PSTN callers come through the audio
            // bridge and only ever show up in the
            // sipConferenceParticipants snapshot we're processing
            // here. Without this, you'd see "X was invited" in the
            // chat but no matching "X joined" when they connected,
            // and no "X left" when they hung up — exactly the
            // symptom you described.
            //
            // _prevSipUris is the participant URI set from the
            // previous tick. New URIs → joins, removed URIs → leaves.
            // Bridge entries are skipped (sp.type === 'bridge') so
            // the plumbing doesn't show up in the chat audit log,
            // matching what we do for WebRTC bridge tiles.
            try {
                const _prevSet = this._prevSipUris || new Set();
                const _currSet = new Set();
                const _currByUri = new Map();
                for (const sp of _list) {
                    if (!sp || !sp.uri) continue;
                    if (sp.type === 'bridge') continue;
                    const _u = String(sp.uri);
                    _currSet.add(_u);
                    _currByUri.set(_u, sp);
                }
                // Only post join/leave messages once the FIRST snapshot
                // has been seen — otherwise the very first snapshot
                // (which already has the existing participants in it)
                // would generate a spurious "joined" for everyone who
                // was in the room before we did. After the first
                // snapshot, _prevSipUris is populated and the diff
                // produces the right thing.
                if (this._sipRosterPrimed) {
                    for (const _u of _currSet) {
                        if (!_prevSet.has(_u)) {
                            this.postChatSystemMessage(_u + ' joined', true);
                            // Auto-unmute workaround. The server-side
                            // _auto_mute_new_sip_participants in
                            // sylkserver/webrtcgateway/handler.py
                            // muted every new SIP arrival before we
                            // added the room-size gate; in any
                            // deployment that hasn't been restarted
                            // since (or where the gate misfires) the
                            // PSTN caller still arrives muted. When
                            // the WebRTC roster is just me (no other
                            // WebRTC publishers) and a new SIP caller
                            // appears, schedule an unmute REFER 1s
                            // later so the small 1-on-1 case (the
                            // most surprising one — you dialled a
                            // PSTN number and can't hear them)
                            // recovers automatically.
                            this._maybeAutoUnmuteNewSipParticipant(_u, _currByUri.get(_u));
                        }
                    }
                    for (const _u of _prevSet) {
                        if (!_currSet.has(_u)) {
                            this.postChatSystemMessage(_u + ' left', true);
                        }
                    }
                }
                this._prevSipUris = _currSet;
                this._sipRosterPrimed = true;
            } catch (e) {
                console.log('[conference] [chat] sip roster diff failed:', e && e.message);
            }

            // Cache on the call object so a subsequent ConferenceBox
            // remount can seed state.sipParticipants from it instead
            // of starting empty. Conference.js also attaches its own
            // early-bound cache listener (so the FIRST snapshot —
            // which often arrives before ConferenceBox mounts — isn't
            // lost on the floor). This assignment just keeps the same
            // cache fresh on every later delta.
            if (this.props.call) {
                this.props.call._sipParticipants = _list;
            }
            const _update = {sipParticipants: _list};
            // Server-authoritative conference duration anchor (seconds
            // since the videoroom was created on the webrtcgateway).
            // Stored once on first NON-ZERO arrival — the running
            // counter in ConferenceHeader is driven by local elapsed
            // time from that anchor; we don't keep ratcheting it
            // from each NOTIFY to avoid jitter.
            //
            // A 0 reading from the session-accept conferenceDuration
            // event (fires when the gateway hasn't yet computed the
            // room age) used to lock the anchor at 0 and cause
            // ConferenceHeader.serverDurationApplied to flip
            // permanently, ignoring every later non-zero value. We
            // now wait for the first duration > 0.
            const _haveRealAnchor = typeof this.state.conferenceDurationAtJoin === 'number'
                                    && this.state.conferenceDurationAtJoin > 0;
            if (typeof duration === 'number' && duration > 0 && !_haveRealAnchor) {
                _update.conferenceDurationAtJoin = duration;
                if (this.props.call) {
                    this.props.call._conferenceDurationAtJoin = duration;
                }
                // Surface the very first non-zero duration sample
                // from the server so the operator can confirm the
                // anchor matches the focus's clock at startup.
                console.log('[ConferenceBox] conference duration anchor (from server, first sample): '
                    + duration + 's');
            }
            this.setState(_update);
        });

        // Diagnostic — show what the server told us about the
        // running conference duration at the moment ConferenceBox
        // mounted. Three possible sources, in order of preference:
        //   • state.conferenceDurationAtJoin  → seeded by the
        //     constructor from props.call._conferenceDurationAtJoin
        //     (which Conference.js's early cache populated before
        //     this component mounted)
        //   • props.call._conferenceDurationAtJoin → same cache,
        //     read directly in case the constructor missed it
        //   • null → no anchor has arrived yet; the navbar meter
        //     will start at 00:00 until the first
        //     sipConferenceParticipants / conferenceDuration event
        //     fires.
        const _stateDur = this.state.conferenceDurationAtJoin;
        const _cacheDur = this.props.call && this.props.call._conferenceDurationAtJoin;
        console.log('[ConferenceBox] mount: initial server conference duration anchor: state=' +
                    (_stateDur == null ? 'null' : _stateDur + 's') +
                    ' cache=' +
                    (typeof _cacheDur === 'number' ? _cacheDur + 's' : 'null'));

        // Race-window backfill for the duration anchor — same logic
        // as the sipParticipants backfill below. If the
        // `conferenceDuration` / `sipConferenceParticipants` event
        // landed in the cache between constructor and mount, lift
        // it into state so the header meter picks up immediately.
        if (this.state.conferenceDurationAtJoin == null
            && typeof _cacheDur === 'number') {
            console.log('[ConferenceBox] backfilling conferenceDurationAtJoin from cache at mount =',
                        _cacheDur, 's');
            this.setState({conferenceDurationAtJoin: _cacheDur});
        }

        // Race-window backfill: the constructor seeded
        // state.sipParticipants from props.call._sipParticipants, but a
        // snapshot landing in the cache BETWEEN constructor and
        // componentDidMount would miss that seed. Re-read the cache
        // here, and push to state if it's non-empty and state is
        // still empty. The listener attached above handles every
        // future delta.
        if (this.props.call
            && Array.isArray(this.props.call._sipParticipants)
            && this.props.call._sipParticipants.length > 0
            && this.state.sipParticipants.length === 0) {
            console.log('[ConferenceBox] backfilling sipParticipants from cache at mount, count=' +
                        this.props.call._sipParticipants.length);
            this.setState({sipParticipants: this.props.call._sipParticipants});
        }

        // The webrtcgateway also stamps the initial session-accept
        // event with the gateway-side conference duration. Catch that
        // path too so the meter is correct from the very first frame
        // even if no SIP conference-info NOTIFY has landed yet (e.g.
        // a brand-new room with only this user in it).
        this.props.call.on('conferenceDuration', (duration) => {
            console.log('[ConferenceBox] conferenceDuration anchor=', duration);
            // Skip 0 — see the matching comment on the
            // sipConferenceParticipants handler above. The
            // session-accept event fires with 0 when the gateway
            // hasn't computed the room age yet; locking that in
            // would cause ConferenceHeader to ignore the real
            // duration when it arrives later via the SIP NOTIFY.
            const _haveRealAnchor = typeof this.state.conferenceDurationAtJoin === 'number'
                                    && this.state.conferenceDurationAtJoin > 0;
            if (typeof duration === 'number' && duration > 0 && !_haveRealAnchor) {
                if (this.props.call) {
                    this.props.call._conferenceDurationAtJoin = duration;
                }
                this.setState({conferenceDurationAtJoin: duration});
            }
        });

        // Real-time per-participant audio levels (mean+peak), pushed by
        // the webrtcgateway every audio_level_notify_period (default
        // 250ms). Indexed by participant_id so a tile component renders
        // the matching VU bar in one O(1) lookup. We replace the whole
        // map on every event — the snapshot already carries every
        // participant in the room, so a diff would add no value.
        this.props.call.on('sipConferenceAudioLevels', ({levels, ts}) => {
            const map = {};
            for (const entry of (levels || [])) {
                if (!entry || !entry.participant_id) continue;
                map[entry.participant_id] = {
                    tx: entry.tx || 0,
                    rx: entry.rx || 0,
                    tx_peak: entry.tx_peak || 0,
                    rx_peak: entry.rx_peak || 0,
                };
            }
            this.setState({sipAudioLevels: map, sipAudioLevelsTs: ts || null});
        });

        this.props.call.on('inviteStatus', (status) => {
            const _state = status && status.state;
            const _participant = status && status.participant;
            const _code = status && status.code;
            const _reason = status && status.reason;
            console.log('[ConferenceBox] [conference] inviteStatus event participant=' + _participant +
                        ' state=' + _state + ' code=' + _code + ' reason=' + (_reason || ''));
            if (_state === 'progress') {
                console.log('[ConferenceBox] [conference] PROGRESS  ' + _participant + ' -> ' + _code + ' ' + (_reason || ''));
            } else if (_state === 'success') {
                console.log('[ConferenceBox] [conference] SUCCESS   ' + _participant + ' -> ' + _code + ' ' + (_reason || ''));
            } else if (_state === 'failed') {
                console.log('[ConferenceBox] [conference] FAILED    ' + _participant + ' -> ' + _code + ' ' + (_reason || ''));
            }
            if (!status || !_participant) return;
            const _normalize = (u) => {
                if (!u) return u;
                if (u.indexOf('sip:') === 0) return u.slice(4);
                if (u.indexOf('sips:') === 0) return u.slice(5);
                return u;
            };
            const target = _normalize(_participant).split(';')[0];
            let matchedKeys = 0;
            for (const key of Array.from(this.invitedParticipants.keys())) {
                if (_normalize(key).split(';')[0] !== target) continue;
                matchedKeys++;
                const existing = this.invitedParticipants.get(key) || {};
                let label;
                if (_state === 'failed') {
                    label = (_code ? _code + ' ' : '') + (_reason || 'Failed');
                } else if (_state === 'success') {
                    label = 'Accepted';
                } else if (_state === 'progress') {
                    label = (_code ? _code + ' ' : '') + (_reason || 'Progress');
                } else {
                    label = _state || 'Unknown';
                }
                this.invitedParticipants.set(key, Object.assign({}, existing, {status: label}));
                // A real status update arrived — cancel the 60s
                // "no-update" timeout. The tile now stays in whatever
                // status the server reported until removed.
                this._cancelInviteTimeout(key);
                console.log('[ConferenceBox] [conference] tile updated key=' + key + ' status=' + label);
            }
            if (matchedKeys === 0) {
                console.log('[ConferenceBox] [conference] no invitedParticipants entry matched aor=' + target +
                            ' (current keys=' + Array.from(this.invitedParticipants.keys()).join(',') + ')');
            }
            this.forceUpdate();
        });

        this.fullScreenTimer();

        // attach to ourselves first if there are no other participants
        if (this.state.participants.length === 0) {
            setTimeout(() => {
                const item = {
                    stream: this.props.call.getLocalStreams()[0],
                    identity: this.props.call.localIdentity
                };
                this.selectVideo(item);
            });
        } else {
            this.state.participants.forEach((p) => {
                if (p.identity._uri.search('guest.') === -1 && p.identity._uri !== this.props.call.localIdentity._uri) {
                    // used for history item
                    this.props.saveParticipant(this.props.call.id, this.state.remoteUri, p.identity._uri);
                    this.lookupContact(p.identity._uri, p.identity._displayName);
                }
            });
            // this.changeResolution();
        }

        if (this.state.videoMuted) {
            this._muteVideo();
        }

        //let msg = "Others can join the conference using a web browser at " + this.conferenceUrl;
        //this.postChatSystemMessage(msg, false);

        if (this.state.selectedContacts) {
            this.inviteParticipants(this.state.selectedContacts);
        }

        // Initial roster dump at conference start. state.participants
        // was already seeded from props.call.participants in the
        // constructor — anyone who was in the room before we joined
        // is already there. Logs zero remotes (just self) for a
        // brand-new room, or the existing roster when joining a
        // call in progress. Subsequent joins/leaves/view-toggles
        // re-emit via the setState callbacks at those sites.
        this._dumpParticipantRoster('start');

        //this.props.call.statistics.on('stats', this.statistics);
    }
    
    get fullScreen() {
		return !this.state.callOverlayVisible;
	}
        
    get conferenceStarted() {
		return this.state.participants.length > 0;
	}

    /** Heuristic — true if `p` is the PSTN / SIP audio bridge leg
     *  rather than a real attendee. Mirrors the _isBridge function
     *  used by the audio-tile builder and the per-participant
     *  bandwidth overlay so all three surfaces agree on what counts
     *  as "plumbing". Display-name "bridge" + URI rooted in
     *  @conference. are the load-bearing tests; AOR cross-check
     *  against sipParticipants[type==='bridge'] catches the cases
     *  where the display name is missing. */
    _isBridgeParticipant(p) {
        if (!p || !p.identity) return false;
        const dn = p.identity._displayName || p.identity.displayName || '';
        if (/bridge/i.test(dn)) return true;
        const uri = p.identity._uri || p.identity.uri || '';
        if (uri.indexOf('@conference.') > -1) return true;
        // AOR check — strip scheme + params, compare against the
        // sipParticipants snapshot for any entry tagged type='bridge'.
        const _aor = (() => {
            let s = uri;
            if (s.indexOf('sip:') === 0) s = s.slice(4);
            else if (s.indexOf('sips:') === 0) s = s.slice(5);
            return s.split(';')[0];
        })();
        if (_aor && Array.isArray(this.state.sipParticipants)) {
            for (const sp of this.state.sipParticipants) {
                if (sp && sp.type === 'bridge') {
                    let bs = sp.uri || '';
                    if (bs.indexOf('sip:') === 0) bs = bs.slice(4);
                    else if (bs.indexOf('sips:') === 0) bs = bs.slice(5);
                    const _baor = bs.split(';')[0];
                    if (_baor && _baor === _aor) return true;
                }
            }
        }
        return false;
    }

    /** When a new SIP/PSTN participant joins, schedule a 1s deferred
     *  unmute IF the WebRTC roster is just me (no other WebRTC
     *  publishers in this.state.participants).
     *
     *  Why this exists: sylkserver's webrtcgateway runs
     *  _auto_mute_new_sip_participants on every conference-info
     *  NOTIFY and sends REFER ;method=MUTE to the focus for newly-
     *  seen SIP arrivals. I added a room-size gate there (skip the
     *  mute if participants <= 3 and no active speakers), but the
     *  gate only takes effect after sylkserver restart, and there
     *  are deployments where we don't control the restart cadence.
     *  This client-side workaround undoes the mute for the most
     *  surprising case: you dialled a PSTN number, you're the only
     *  one in the room, and you can't hear them because they came
     *  in muted.
     *
     *  The 1s delay lets the mute REFER land and propagate first
     *  (otherwise our unmute REFER races the mute REFER and the
     *  result depends on focus serialization order); we then send
     *  the un-mute and the focus broadcasts the un-muted state via
     *  the next conference-info NOTIFY, which both updates the SIP
     *  participant's tile and unmutes their audio stream so we
     *  actually hear them.
     *
     *  Only fires when alone in the WebRTC sense — multi-WebRTC
     *  rooms keep the auto-mute behaviour so a moderator's choice
     *  to mute newcomers isn't undone by everyone else's client.
     *  Also gated on the new arrival's reported muted state at the
     *  +1s tick: if they came in un-muted (e.g. the server gate is
     *  working) we don't send a redundant un-mute REFER. */
    _maybeAutoUnmuteNewSipParticipant(uri, snapshotEntry) {
        if (!uri || !snapshotEntry) return;
        const myPid = snapshotEntry.participant_id;
        if (!myPid) return;
        // Skip the bridge itself — already filtered upstream in the
        // SIP diff (sp.type === 'bridge' is excluded from _currSet)
        // but belt-and-braces in case the heuristic changes.
        if (snapshotEntry.type === 'bridge') return;
        // Skip if there's already another WebRTC publisher — the mute
        // was probably intentional (moderator running a managed-floor
        // meeting). Counted at SCHEDULE time, then re-checked at
        // FIRE time to handle the race where someone else joins in
        // the 1s window.
        const _webrtcOthersNow = (this.state.participants || []).length;
        if (_webrtcOthersNow > 0) {
            console.log('[conference] [auto-unmute] skipping for', uri,
                '— there are', _webrtcOthersNow, 'WebRTC publishers');
            return;
        }
        setTimeout(() => {
            if (this.unmounted) return;
            if (!this.props.call) return;
            // Re-check at fire time so a join during the 1s window
            // doesn't trigger a stale unmute. Same "only me" gate
            // as above.
            const _webrtcOthersThen = (this.state.participants || []).length;
            if (_webrtcOthersThen > 0) {
                console.log('[conference] [auto-unmute] cancelled for', uri,
                    '— WebRTC roster grew to', _webrtcOthersThen);
                return;
            }
            // Re-look-up the participant in the current snapshot —
            // they may have left during the 1s window, or their pid
            // may have changed (rare but possible for bridge-renamed
            // entries). If they're already un-muted server-side
            // there's nothing to do.
            const _currentList = this.state.sipParticipants || [];
            const _current = _currentList.find(
                (sp) => sp && sp.uri === uri && sp.participant_id);
            if (!_current) {
                console.log('[conference] [auto-unmute] cancelled for', uri,
                    '— no longer in SIP roster');
                return;
            }
            if (!_current.muted) {
                console.log('[conference] [auto-unmute] already un-muted server-side:',
                    uri, 'pid=', _current.participant_id);
                return;
            }
            if (typeof this.props.call.muteParticipant !== 'function') {
                console.log('[conference] [auto-unmute] muteParticipant RPC unavailable on call');
                return;
            }
            console.log('[conference] [auto-unmute] sending unmute for', uri,
                'pid=', _current.participant_id);
            try {
                // muteParticipant(pid, false) is the unmute branch —
                // same RPC the per-tile mute toggle uses (see the
                // SIP tile mute IconButton around line 7134).
                this.props.call.muteParticipant(_current.participant_id, false);
                this.postChatSystemMessage(
                    'Auto-unmuted ' + uri + ' (you are alone in the room)',
                    true);
            } catch (e) {
                console.log('[conference] [auto-unmute] failed:', e && e.message);
            }
        }, 1000);
    }

    // Pulse opacity for the recording pill. Same shape as the
    // AudioCallBox 1-to-1 recorder pill (_recordPulse there): loops
    // 1 → 0.4 → 1 over ~1.2 s while recording, sits at 1 otherwise.
    // Instance field so it survives re-renders without resetting;
    // started from _startConferenceRecording, stopped from
    // _stopConferenceRecording. Lives on the class instance (set in
    // constructor via the `=` initializer pattern wasn't reliable
    // across the older React Native classes here, so explicit
    // assignment in componentDidMount handles it — guarded so a
    // hot-reload doesn't double-allocate the Animated.Value).
    _ensureRecordPulse() {
        if (!this._recordPulse) {
            this._recordPulse = new Animated.Value(1);
        }
    }

    _startRecordPulse() {
        this._ensureRecordPulse();
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
        if (this._recordPulse) {
            this._recordPulse.setValue(1);
        }
    }

    /** Render the AudioCallBox-style recording pill. Two visual
     *  states (no "armed" because a conference is already live by
     *  the time the user sees the action bar):
     *
     *    - Idle:      translucent white background, red dot, label
     *                 "Record conference".
     *    - Active:    solid red background, white dot, label
     *                 "Recording". Pill opacity pulses via
     *                 _recordPulse so the bar visually communicates
     *                 "we're capturing right now".
     *
     *  Returns null if the native conference-mix API is missing so
     *  the surrounding layout collapses cleanly (same behaviour as
     *  the previous IconButton variant). */
    _renderConferenceRecordControl() {
        if (!CallRecorder.conferenceAvailable()) return null;
        this._ensureRecordPulse();

        const isRec = !!this.state.isConferenceRecording;
        let bg, label, dotColor;
        if (isRec) {
            bg = 'rgba(220, 30, 30, 0.95)';
            dotColor = '#fff';
            label = 'Recording';
        } else {
            bg = 'rgba(255, 255, 255, 0.18)';
            dotColor = '#e53935';
            label = 'Record conference';
        }

        return (
            <Animated.View style={{ opacity: isRec ? this._recordPulse : 1 }}>
                <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={(e) => {
                        if (e && e.stopPropagation) e.stopPropagation();
                        this._toggleConferenceRecording();
                    }}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: bg,
                        // Pill dimensions cloned verbatim from
                        // AudioCallBox._renderRecordControl so the
                        // conference pill is visually identical to
                        // the one users already know from 1-to-1
                        // calls — same paddingVertical/Horizontal,
                        // same borderRadius, same dot 12 × 12 with
                        // marginLeft -10 to anchor left.
                        paddingVertical: 10,
                        paddingHorizontal: 24,
                        borderRadius: 16,
                    }}
                >
                    <View style={{
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
                        marginRight: -7,
                    }}>
                        {label}
                    </Text>
                </TouchableOpacity>
            </Animated.View>
        );
    }

    /** Begin a compressed-mix conference recording.
     *
     *  Writes the same stereo Opus-OGG (Android) / AAC m4a (iOS) the
     *  1-to-1 AudioCallBox recorder produces — mic on L, sum of all
     *  remote participants on R with int16 clip-guard — so the
     *  resulting file plays back in the existing audio chat bubble
     *  without any changes. Late joiners are picked up by
     *  onParticipantJoined; leavers by onParticipantLeft.
     *
     *  No-op if a recording is already running or the native module
     *  doesn't expose the conference API. */
    async _startConferenceRecording() {
        if (this.state.isConferenceRecording) return;
        if (!CallRecorder.conferenceAvailable()) {
            utils.timestampedLog('[conference] [recorder] native module missing the conference API — record button disabled');
            return;
        }
        // Disclaimer gate. First-time conference recording needs an
        // explicit user agreement that's stored independently from
        // the 1-to-1 call recording disclaimer (see
        // conferenceRecordingDisclosure.js for why). If not agreed,
        // pop the modal and bail out of this start attempt — the
        // modal's onContinue calls _startConferenceRecording again
        // after persisting the flag.
        try {
            const agreed = await readConferenceRecordingDisclosure();
            if (!agreed) {
                utils.timestampedLog('[conference] [recorder] disclosure not yet acknowledged — showing modal');
                if (!this.unmounted) {
                    this.setState({ showConferenceRecordingDisclosure: true });
                }
                return;
            }
        } catch (e) {
            // If the read failed, fall through and let the recording
            // happen — better than silently locking out the feature
            // because the settings bridge had a hiccup.
            console.log('[conference] [recorder] disclosure read failed:', e && e.message);
        }
        const ts = Date.now();
        const docDir = RNFS && RNFS.DocumentDirectoryPath;
        // File extension follows the per-platform native format the
        // existing 1-to-1 recorder uses, so utils.isAudio +
        // AudioRecorderPlayer decode it correctly for the chat
        // bubble preview path when we wire that up.
        const ext = Platform.OS === 'android' ? 'ogg' : 'm4a';
        const outPath = docDir
            ? `${docDir}/sylk-conf-recording-${ts}.${ext}`
            : `sylk-conf-recording-${ts}.${ext}`;
        try {
            const result = await CallRecorder.startConference(
                this.props.call,
                this.state.participants || [],
                outPath
            );
            if (result === 'not_implemented') {
                utils.timestampedLog('[conference] [recorder] native module returned not_implemented');
                return;
            }
            this._conferenceRecordingTick = setInterval(() => {
                if (this.unmounted) return;
                this.setState((s) => ({
                    conferenceRecordingElapsedSec:
                        (s.conferenceRecordingElapsedSec || 0) + 1,
                }));
            }, 1000);
            this.setState({
                isConferenceRecording: true,
                conferenceRecordingDir: outPath,
                conferenceRecordingElapsedSec: 0,
            });
            this._startRecordPulse();
            utils.timestampedLog('[conference] [recorder] started:', outPath,
                'initial participants=', (this.state.participants || []).length);
        } catch (e) {
            console.log('[conference] [recorder] start failed:', e && e.message);
            this.setState({
                isConferenceRecording: false,
                conferenceRecordingDir: null,
                conferenceRecordingElapsedSec: 0,
            });
        }
    }

    /** Stop the conference recording, move the file into the per-room
     *  folder ({Documents}/{accountId}/{conferenceUri}/{transfer_id}/
     *  {filename}, the same convention every other file transfer uses),
     *  and inject a synthetic sylk-file-transfer system message into
     *  the conference chat so the audio bubble shows up alongside the
     *  participant join/leave entries.
     *
     *  Returns the persisted message id (also used as the directory
     *  name under the conference URI) for debugging — actual UI side-
     *  effects are driven entirely by saveConferenceMessage updating
     *  state.messages, which the chat panel observes via the
     *  parent-passed messages prop. */
    async _stopConferenceRecording() {
        if (!this.state.isConferenceRecording) return;
        if (this._conferenceRecordingTick) {
            clearInterval(this._conferenceRecordingTick);
            this._conferenceRecordingTick = null;
        }
        this._stopRecordPulse();
        const elapsed = this.state.conferenceRecordingElapsedSec || 0;
        let r = null;
        try {
            r = await CallRecorder.stopConference();
        } catch (e) {
            console.log('[conference] [recorder] stop failed:', e && e.message);
        }
        if (!this.unmounted) {
            this.setState({
                isConferenceRecording: false,
                conferenceRecordingElapsedSec: 0,
            });
        }
        const srcPath = r && r.path;
        if (!srcPath) {
            utils.timestampedLog('[conference] [recorder] stopConference returned no path');
            return;
        }
        utils.timestampedLog('[conference] [recorder] stopped:',
            srcPath, 'duration', elapsed, 's',
            'peaks=', !!(r && r.peaks));

        // Resolve the conference URI + account id. The conference URI
        // is on this.props.remoteUri (Conference.js passes
        // remoteUri = this.state.room); the account id comes from the
        // call object the way AudioCallBox / app.js do it.
        const conferenceUri = this.props.remoteUri;
        const accountId = (this.props.account && this.props.account.id)
            || (this.props.call && this.props.call.account && this.props.call.account.id);
        if (!conferenceUri || !accountId) {
            console.log('[conference] [recorder] missing conferenceUri/accountId; file kept at',
                srcPath);
            return;
        }

        // Per-room storage path matches the file-transfer convention
        // used elsewhere in app.js (e.g. saveCallRecording's destDir
        // around line 31984, file2GiftedChat's localPath around
        // line 16727): {Documents}/{accountId}/{remote_party}/
        // {transfer_id}/{filename}. remote_party here is the
        // conference URI, transfer_id is a fresh uuid we use for
        // both the chat msg_id and the storage subfolder.
        const id = uuid.v4();
        const basename = (srcPath.split('/').pop() || `sylk-conf-recording-${Date.now()}.ogg`)
            .replace(/\s|:/g, '_');
        const destDir = `${RNFS.DocumentDirectoryPath}/${accountId}/${conferenceUri}/${id}`;
        const destPath = `${destDir}/${basename}`;
        try {
            await RNFS.mkdir(destDir);
            const stripped = srcPath.startsWith('file://') ? srcPath.substr(7) : srcPath;
            const exists = await RNFS.exists(stripped);
            if (exists) {
                try {
                    await RNFS.copyFile(stripped, destPath);
                    // Remove the source so we don't leave two copies on
                    // disk — the app's DocumentDirectory root would
                    // otherwise accumulate one sylk-conf-recording-*.ogg
                    // per recording with no cleanup path.
                    try { await RNFS.unlink(stripped); } catch (e) {}
                } catch (e) {
                    console.log('[conference] [recorder] copy failed:', e && e.message);
                }
            } else {
                console.log('[conference] [recorder] source missing:', stripped);
            }
        } catch (e) {
            console.log('[conference] [recorder] mkdir/copy error:', e && e.message);
        }

        let filesize = 0;
        try {
            const stat = await RNFS.stat(destPath);
            filesize = stat && stat.size ? Number(stat.size) : 0;
        } catch (e) { /* best-effort */ }

        // Pick mime from the actual extension — same logic as
        // saveCallRecording. The conference recorder writes Opus-OGG
        // on Android (.ogg) and AAC m4a on iOS (.m4a).
        const lower = (basename || '').toLowerCase();
        let filetype = 'audio/mp4';
        if (lower.endsWith('.ogg') || lower.endsWith('.opus')) {
            filetype = 'audio/ogg';
        }

        // Build the file_transfer metadata blob — same shape as the
        // 1-to-1 recorder's payload so the chat bubble code path
        // (utils.isAudio + AudioRecorderPlayer) renders it as an
        // audio message bubble identically. sender = us (we made
        // the recording), receiver = the conference. call_recording
        // flag rides along so any future "this isn't a wire message"
        // checks can still tell.
        const localDisplayName =
            (this.props.call && this.props.call.localIdentity
                && (this.props.call.localIdentity._displayName
                    || this.props.call.localIdentity.displayName))
            || accountId;
        const file_transfer = {
            path: destPath,
            local_url: destPath,
            filename: basename,
            sender: { uri: accountId, displayName: localDisplayName },
            receiver: { uri: conferenceUri },
            transfer_id: id,
            direction: 'outgoing',
            filesize: filesize,
            filetype: filetype,
            duration: elapsed,
            call_recording: true,
            // Conference-mix marker. The bubble in ContactsListBox
            // reads this to relabel the right-channel waveform from
            // "Remote" → "Participants" — for a conference recording
            // the R channel is the sum of every other attendee, not a
            // single remote party, so the original label was
            // misleading. Anything else that ever wants to special-
            // case conference recordings (e.g. transcript routing)
            // can read the same flag instead of pattern-matching the
            // receiver URI for @videoconference.
            is_conference: true,
        };
        if (r && r.peaks && Array.isArray(r.peaks.l) && Array.isArray(r.peaks.r)) {
            file_transfer.peaks = r.peaks;
        }

        const ts = new Date();
        const text = (utils.beautyFileNameForBubble
            ? utils.beautyFileNameForBubble(file_transfer)
            : basename);

        const giftedChatMessage = {
            _id: id,
            key: id,
            text: text,
            metadata: file_transfer,
            createdAt: ts,
            direction: 'outgoing',
            audio: destPath,
            local_url: destPath,
            sent: 1,
            user: { _id: accountId, name: localDisplayName },
        };

        // saveConferenceMessage takes the conference URI as the "room"
        // key and persists the message into the SQL messages table
        // (content_type = application/sylk-file-transfer) AND into
        // state.messages[room] so the chat panel updates without a
        // round-trip refetch. Stashes the result on the instance for
        // debugging.
        if (typeof this.props.saveConferenceMessage === 'function') {
            try {
                await this.props.saveConferenceMessage(conferenceUri, giftedChatMessage);
                utils.timestampedLog('[conference] [recorder] message persisted to chat:',
                    'id=', id, 'destPath=', destPath);
            } catch (e) {
                console.log('[conference] [recorder] saveConferenceMessage failed:', e && e.message);
            }
        } else {
            console.log('[conference] [recorder] saveConferenceMessage prop missing; file kept at',
                destPath);
        }

        // Also drop a short system line in the chat so the recording
        // is easy to spot among the other audit entries. Same shape
        // as the join/leave/mute lines (system message, save=true).
        try {
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const dur = mins > 0
                ? `${mins}m ${secs}s`
                : `${secs}s`;
            this.postChatSystemMessage('Conference recording saved (' + dur + ')', true);
        } catch (e) { /* best-effort */ }

        this._lastConferenceRecording = {
            filePath:    destPath,
            peaks:       r && r.peaks,
            durationSec: elapsed,
            remoteUri:   conferenceUri,
            transferId:  id,
        };
    }

    /** Disclosure modal — user tapped "I agree". Persist the flag
     *  under disclaimers.conferenceRecording (+ companion timestamp
     *  via setAcknowledged) and resume the start. The resume goes
     *  through the same _startConferenceRecording entry point so the
     *  whole flow is identical to "user tapped Record after already
     *  agreeing previously" — just one extra round-trip. */
    async _onConferenceRecordingDisclosureContinue() {
        try {
            await setConferenceRecordingDisclosure();
            utils.timestampedLog('[disclaimer] user agreed to conference recording disclaimer');
        } catch (e) {
            console.log('[conference] [recorder] persisting disclosure failed:', e && e.message);
        }
        if (this.unmounted) return;
        this.setState({ showConferenceRecordingDisclosure: false }, () => {
            this._startConferenceRecording();
        });
    }

    /** Disclosure modal — user tapped "Cancel". Close the modal and
     *  leave the recorder untouched (no recording, no persisted
     *  agreement). They can tap Record again later to re-prompt. */
    _onConferenceRecordingDisclosureCancel() {
        if (this.unmounted) return;
        this.setState({ showConferenceRecordingDisclosure: false });
        utils.timestampedLog('[disclaimer] user declined conference recording disclaimer');
    }

    /** Action-bar record button handler. Stops if active, starts if not. */
    _toggleConferenceRecording() {
        if (this.state.isConferenceRecording) {
            this._stopConferenceRecording();
        } else {
            this._startConferenceRecording();
        }
    }

    /** Attach a late-joiner to an active recording. Retries a few
     *  times because the participant's RTCPeerConnection receiver
     *  doesn't have an audio track until WebRTC's ontrack event
     *  fires, which can land slightly after onParticipantJoined.
     *  Without the retry the first ~100 ms of a late join would
     *  return false from addConferenceParticipant and that
     *  participant would never get recorded. */
    _attachConferenceRecordingParticipant(p, attempt = 0) {
        if (!this.state.isConferenceRecording) return;
        if (!p || this.unmounted) return;
        CallRecorder.addConferenceParticipant(p).then((ok) => {
            if (ok || attempt >= 20) return;   // 20 × 100ms = 2s budget
            setTimeout(() => {
                this._attachConferenceRecordingParticipant(p, attempt + 1);
            }, 100);
        }).catch(() => {
            // The recorder spits at the JS layer through `false`, not
            // by rejecting, so a rejection here usually means the
            // native call itself blew up — log once and stop trying.
            console.log('[conference] [recorder] addConferenceParticipant rejected for pid=',
                p && p.id);
        });
    }

    componentWillUnmount() {
        // Cancel all 60s "no-update" invite timers. The persisted
        // invitedParticipants map outlives ConferenceBox, but the
        // setTimeout handles are instance-scoped and would otherwise
        // fire on a torn-down component.
        if (this._inviteTimers) {
            for (const tid of this._inviteTimers.values()) {
                try { clearTimeout(tid); } catch (e) {}
            }
            this._inviteTimers.clear();
        }

        // Release the keep-screen-on we asserted at mount so the
        // OS idle timer resumes once the conference UI is torn
        // down. Counterpart to the setKeepScreenOn(true) in
        // componentDidMount.
        try { InCallManager.setKeepScreenOn(false); } catch (e) { /* best effort */ }

        // Restore system chrome on the way out.
        //
        // fullScreenTimer() and toggleFullScreen() drive the device
        // into immersive mode (StatusBar.setHidden(true) +
        // Immersive.on() on Android) so the video matrix gets a
        // clean canvas. The overlay timer in particular fires
        // automatically after 15s of inactivity, so by the time a
        // remote hangs up — or the local user hangs up via the OS
        // call notification, a hardware key, CallKit, or any path
        // that skips toggleFullScreen() — the conference UI is
        // almost always sitting in immersive state. When the
        // component unmounts, that state never gets cleared and
        // Android keeps both the system bar and the navigation bar
        // hidden, dropping the user back to the ready screen with
        // no chrome until they swipe from the edge.
        //
        // Reset unconditionally here. StatusBar.setHidden(false) is
        // a no-op if the bar is already showing; Immersive.off() is
        // guarded with try/catch because the native side throws on
        // platforms where it never armed. We also call
        // disableFullScreen() so the parent's `fullscreen` state
        // flag mirrors the native truth (the parent already calls
        // it from hangupCall, but going through the prop here keeps
        // the unmount path self-consistent for every termination
        // route).
        try { StatusBar.setHidden(false, 'fade'); } catch (e) { /* best effort */ }
        if (Platform.OS === 'android') {
            try { Immersive.off(); } catch (e) { /* best effort */ }
            if (typeof this.props.disableFullScreen === 'function') {
                try { this.props.disableFullScreen(); } catch (e) { /* best effort */ }
            }
        }

        // [qos] — stop the sampler started in componentDidMount.
        stopQosLogging();

        // Audio-mode diagnostic. If the recording playback sounds bad
        // (thin / muffled) it's usually because the system is still
        // in MODE_IN_COMMUNICATION post-call instead of MODE_NORMAL.
        // Log the mode at three points:
        //   • here (right as ConferenceBox tears down, before app.js
        //     audioManagerStop fires),
        //   • +500 ms (after audioManagerStop has had a chance to
        //     flip the mode back), and
        //   • +1500 ms (catches a delayed transition that some
        //     Android OEM stacks do via a deferred audio-focus
        //     callback).
        // Android-only — iOS doesn't expose the equivalent API
        // through AudioRouteModule.
        if (Platform.OS === 'android'
                && NativeModules.AudioRouteModule
                && typeof NativeModules.AudioRouteModule.getAudioModeName === 'function') {
            const _ar = NativeModules.AudioRouteModule;
            const _log = (when) => {
                _ar.getAudioModeName().then((mode) => {
                    utils.timestampedLog('[audio-mode] ConferenceBox ' + when + ':', mode);
                }).catch((e) => {
                    utils.timestampedLog('[audio-mode] ConferenceBox ' + when + ': lookup failed',
                        e && e.message);
                });
            };
            _log('unmount');
            setTimeout(() => _log('unmount +500ms'), 500);
            setTimeout(() => _log('unmount +1500ms'), 1500);
        }

        // Mark unmounted so the conference recording's setInterval
        // tick and late-joiner retry timers can short-circuit instead
        // of calling setState on a torn-down component. The flag is
        // also read by a couple of older async paths (line ~1166
        // referenced it without anyone setting it, which would have
        // never short-circuited those) — setting it here fixes both.
        this.unmounted = true;

        // Finalise any in-flight conference recording so the WAV
        // files are properly closed (RIFF + data chunk sizes patched
        // in) and the manifest is written. Fire-and-forget — we
        // can't await inside componentWillUnmount but the native
        // recorder's stop path is synchronous on disk.
        if (this.state.isConferenceRecording) {
            this._stopConferenceRecording().catch(() => {});
        }
        if (this._conferenceRecordingTick) {
            clearInterval(this._conferenceRecordingTick);
            this._conferenceRecordingTick = null;
        }

        clearTimeout(this.overlayTimer);
        clearTimeout(this.participantsTimer);
        // VU-meter sampler — see _sampleConferenceAudioLevels.
        if (this._vuSamplerTimer) {
            clearInterval(this._vuSamplerTimer);
            this._vuSamplerTimer = null;
        }
        this.uploads.forEach((upload) => {
            this.props.notificationCenter().removeNotification(upload[1]);
            upload[0].abort();
        })
        this.keyboardDidShowListener.remove();
        this.keyboardDidHideListener.remove();
        //this.props.call.statistics.removeListener('stats', this.statistics);
    }

    messageExists(giftedChatMessage, sylkMessage) {
       if (sylkMessage._id === giftedChatMessage._id) {
           return true;
       }

       let gs_timestamp = giftedChatMessage.createdAt;
       let sylk_timestamp = sylkMessage.timestamp;

       gs_timestamp.setMilliseconds(0);
       sylk_timestamp.setMilliseconds(0);

       if (gs_timestamp.toString() === sylk_timestamp.toString() && giftedChatMessage.text === sylkMessage.content) {
           return true;
       }

       return false;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.hasOwnProperty('keyboardVisible')) {
            this.setState({keyboardVisible: nextProps.keyboardVisible});
        }

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            this.setState({call: nextProps.call});
        }

        if (nextProps.inFocus !== this.state.inFocus) {
            if (nextProps.inFocus) {
                if (!this.state.videoMutedbyUser) {
                    this._resumeVideo();
                }
            } else {
                this._muteVideo();
            }
            this.setState({inFocus: nextProps.inFocus});
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        let renderMessages = [];
        if (nextProps.remoteUri in nextProps.messages) {
            nextProps.messages[nextProps.remoteUri].forEach((message) => {
                const existingMessages = this.state.renderMessages.filter(msg => msg._id === message._id);
                if (existingMessages.length > 0) {
                    return;
                }
                renderMessages.push(message);
            });

            if (nextProps.call) {
                this.setState({sharedFiles: nextProps.call.sharedFiles.slice()});

                let giftedChatMessage;
                let existingMessages;
                let previousMessages;

                nextProps.call.messages.forEach((sylkMessage) => {
                    if (sylkMessage.type === 'status') {
                        return;
                    }

                    if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                        return;
                    }

                    existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                    if (existingMessages.length > 0) {
                        return;
                    }

                    existingMessages = this.state.renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                    if (existingMessages.length > 0) {
                        return;
                    }

                    let direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                    if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                        direction = 'outgoing';
                    }

                    giftedChatMessage = utils.sylk2GiftedChat(sylkMessage, null, direction);
                    renderMessages.push(giftedChatMessage);
                    this.saveConferenceMessage(this.props.remoteUri, giftedChatMessage);
                });
            }
        }
        
        if ('enableMyVideo' in nextProps) {
            this.setState({enableMyVideo: nextProps.enableMyVideo});
        }

        this.setState({terminated: nextProps.terminated,
                       remoteUri: nextProps.remoteUri,
                       renderMessages: GiftedChat.append(this.state.renderMessages, renderMessages),
                       isLandscape: nextProps.isLandscape,
                       messages: nextProps.messages,
                       offset: nextProps.offset,
                       activeDownloads: nextProps.activeDownloads,
                       accountId: !this.state.accountId && nextProps.call ? this.props.call.account.id : this.state.accountId,
                       selectedContacts: nextProps.selectedContacts,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   publicUrl: nextProps.publicUrl
                       });

    }

    saveConferenceMessage(uri, message) {
        this.props.saveConferenceMessage(uri, message);
    }

    updateConferenceMessage(uri, message) {
        this.props.updateConferenceMessage(uri, message);
    }

    onSendFromUser() {
        console.log('On send from user...');
    }

    uploadBegin(response) {
      var jobId = response.jobId;
      console.log('UPLOAD HAS BEGUN! JobId: ' + jobId);
    };

    uploadProgress(response) {
      var percentage = Math.floor((response.totalBytesSent/response.totalBytesExpectedToSend) * 100);
      console.log('UPLOAD IS ' + percentage + '% DONE!');
    };

    transferComplete(evt) {
        console.log("Upload has finished", evt);
    }

    transferFailed(evt) {
      console.log("An error occurred while transferring the file.", evt);
    }

    transferCanceled(evt) {
      console.log("The transfer has been canceled by the user.");
    }

    filePath(filename) {
        let dir = RNFS.DocumentDirectoryPath + '/' + this.state.accountId + '/conference/' + this.state.remoteUri + '/files';
        let path;
        RNFS.mkdir(dir);
        path = dir + '/' + filename.toLowerCase();
        return path;
    }

    tsize(fsize) {
        let size = fsize + + " B";
        if (fsize > 1024 * 1024) {
            size = Math.ceil(fsize/1024/1024) + " MB";
        } else if (fsize < 1024 * 1024) {
            size = Math.ceil(fsize/1024) + " KB";
        }
        return size;
    }

    toggleDownload(metadata) {
        //console.log('toggleDownload', metadata);
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === metadata.transfer_id) {
                 //console.log('Found message', msg.metadata);
                 if (msg.metadata.progress === null) {
                     msg.metadata.progress = 0;
                     msg.metadata.failed = false;
                     //console.log('Start metadata', msg.metadata);
                     this.downloadFile(metadata);
                 } else {
                     //console.log('Stop metadata', msg.metadata);
                     this.stopDownloadFile(metadata);
                     msg.metadata.progress = null;
                 }
                 this.updateConferenceMessage(this.props.remoteUri, msg);
             }
        });
    }

    async _launchCamera() {
        let options = {saveToPhotos: true,
                       mediaType: 'photo',
                       maxWidth: 2000,
                       cameraType: 'front'
                       }
        await launchCamera(options, this.cameraCallback);
    }

    async _launchImageLibrary() {
        let options = {};
        await launchImageLibrary(options, this.cameraCallback);
    }

    cameraCallback (result) {
        if (result.assets) {
            this.uploadFile(result.assets[0]);
        }
    }

    async _pickDocument() {
          try {
            const result = await DocumentPicker.pick({
              type: [DocumentPicker.types.allFiles],
              copyTo: 'documentDirectory',
              mode: 'import',
              allowMultiSelection: false,
            });

            const fileUri = result[0].fileCopyUri;
            if (!fileUri) {
              console.log('File URI is undefined or null');
              return;
            }

            console.log('Send file', fileUri);

            this.uploadfile(fileUri);

          } catch (err) {
            if (DocumentPicker.isCancel(err)) {
              console.log('User cancelled file picker');
            } else {
              console.log('DocumentPicker err => ', err);
              throw err;
            }
          }
    };

    renderSend = (props) => {
        let chatRightActionsContainer = Platform.OS === 'ios' ? styles.chatRightActionsContaineriOS : styles.chatRightActionsContainer;
        return (
            <Send {...props}>
              <View style={styles.chatSendContainer}>
              <TouchableOpacity onPress={this._launchCamera} onLongPress={this._launchImageLibrary}>
                <Icon
                  style={chatRightActionsContainer}
                  // Reverted to the original `camera` glyph — this
                  // composer button takes a still SNAPSHOT for the
                  // conference chat message, not a video clip. See
                  // the matching note in ContactsListBox.js.
                  name="camera"
                  size={20}
                  color='gray'
                />
                </TouchableOpacity>
                  <TouchableOpacity onPress={this._launchImageLibrary} onLongPress={this.pickDocument}>
                    <Icon
                      style={chatRightActionsContainer}
                      type="font-awesome"
                      name="paperclip"
                      size={20}
                      color='gray'
                    />
                    </TouchableOpacity>
                <Icon
                  type="font-awesome"
                  name="send"
                  style={styles.chatSendArrow}
                  size={20}
                  color={'gray'}
                />
              </View>
            </Send>
        );
    };

    /** Conference chat bubble renderer.
     *
     *  The previous `import { renderBubble } from './ContactsListBox';`
     *  was broken: `ContactsListBox.renderBubble` is a class method
     *  bound to that component's state, not a named export, so the
     *  import resolved to `undefined`. GiftedChat then fell back to
     *  its default <Bubble> wrapper, which caps its content at a
     *  relatively narrow maxWidth and which doesn't expand to fit
     *  file-transfer rows. The "squeezed" file-upload bubbles the
     *  user reported are exactly this default — once the import is
     *  undefined, the bubble's maxWidth wins.
     *
     *  Local renderer: a thin wrapper around GiftedChat's Bubble
     *  with a generous maxWidth on both sides (image / file
     *  attachment bubbles benefit from breathing room — the
     *  thumbnail width in renderMessageImage above already wants
     *  to fill ~98% of the bubble). Visual style — colours, time
     *  text — is left to GiftedChat's defaults; this isn't trying
     *  to be the full ContactsListBox / ChatBubble experience,
     *  just the same layout horsepower so attachments stop being
     *  cramped. */
    renderBubble = (props) => {
        const w = Dimensions.get('window').width;
        // Cap at 88% of the viewport (vs GiftedChat's default ~60-80%).
        // Same value on both `left` (incoming) and `right` (outgoing)
        // so file rows stretch consistently regardless of direction.
        const max = Math.round(w * 0.88);
        return (
            <Bubble
                {...props}
                wrapperStyle={{
                    left:  { maxWidth: max },
                    right: { maxWidth: max },
                }}
            />
        );
    };

    renderMessageImage =(props) => {
        // Concrete pixel width — `width: '98%'` collapsed to a tiny
        // ~50px sliver in conference chat, because MessageImage's
        // parent is GiftedChat's default Bubble whose intrinsic
        // content width is driven by its OTHER text children
        // (e.g. the file-name text, which is short). Percentages
        // resolve against the smallest parent. Using a fixed pixel
        // width pinned to ~80% of the device viewport gives the
        // photo a predictable, large display area that matches what
        // the 1:1 chat path renders. We also drop the height to
        // the same value so the cover-resize keeps a square-ish
        // aspect — matches the 1:1 chat behaviour.
        const w = Math.round(Dimensions.get('window').width * 0.8);
        return (
          <MessageImage
            {...props}
            imageStyle={{
              width: w,
              height: w,
              resizeMode: 'cover'
            }}
          />
    )
    }

    renderMessageVideo(props){
        const { currentMessage } = props;

        return (
        <View style={styles.videoContainer}>
            <VideoPlayer
                video={{ uri: currentMessage.video}}
                autoplay={false}
                pauseOnPress={true}
                showDuration={true}
                controlsTimeout={2}
                fullScreenOnLongPress={true}
                customStyles={styles.videoPlayer}
            />
        </View>
        );
    };

    renderCustomView(props) {
        const {currentMessage} = props;
        const { text: currText } = currentMessage;

        if (!currentMessage.metadata) {
            return null;
        }

        let status = '';
        let label = 'Uploading...';

        let showSwitch = currentMessage.download || (currentMessage.url && (currentMessage.metadata.progress || !currentMessage.metadata.progress !== 100) && !currentMessage.local_url && !utils.isImage(currentMessage.metadata.name)) ;
        let switchOn = (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) ? true : false;

        if (currentMessage.direction === 'incoming') {
            label = 'Downloading...';
            if (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) {
                status = currentMessage.label + ' - ' + currentMessage.metadata.progress + '%';
            } else {
                if (!utils.isImage(currentMessage.metadata.name)) {
                    status = 'Swipe to download \n' + currentMessage.label;
                } else {
                    status = currentMessage.label;
                }
            }
        } else {
            if (!currentMessage.local_url && currentMessage.metadata.progress === null) {
                switchOn = false;
            }

            if (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) {
                status = currentMessage.label + ' - ' + currentMessage.metadata.progress + '%';
            } else {
                status = currentMessage.label;
            }
        }

        if (currentMessage.url && !currentMessage.local_url) {
            //console.log('--- Render message', currentMessage.metadata.name, currentMessage.metadata.progress);
        }

        if (!utils.isImage(currentMessage.metadata.name) && !currentMessage.local_url) {
            //console.log('Show switch', currentMessage._id, currentMessage.metadata.name, switchOn, currentMessage.metadata.progress);
        }
        //console.log('text =', currentMessage.text, 'label =', label, 'status =', status);

        let progress = 'Download';

        if (currentMessage.metadata.progress !== null) {
            progress = currentMessage.metadata.progress + ' %';
        }
        if (showSwitch) {
            return (
                <View style={styles.downloadContainer}>
                    <Text style={styles.uploadProgress}>{progress}</Text>
                    <View style={styles.switch}>
                    {/* Custom oval+circle toggle — same as PlatformToggle.
                        iOS's native Switch couldn't be styled to look
                        consistent in OFF vs ON state, so we draw it
                        from primitives. */}
                    <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => this.toggleDownload(currentMessage.metadata)}
                        style={{
                            width: 44,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: switchOn ? '#2ecc71' : '#9e9e9e',
                            justifyContent: 'center',
                        }}
                    >
                        <View style={{
                            position: 'absolute',
                            top: 2,
                            left: switchOn ? 22 : 2,
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: '#ffffff',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.2,
                            shadowRadius: 1.5,
                        }} />
                    </TouchableOpacity>
                    </View>
                </View>
               );

        } else {
            return null;
        }
    };

    failedFileUploadMessage(id) {
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                 msg.sent = true;
                 msg.received = false;
                 msg.failed = true;
                 msg.metadata.progress = null;
                 msg.metadata.started = false;
             }
             newRenderMessages.push(msg);
             this.updateConferenceMessage(this.state.remoteUri, msg);
        });
    }

    async uploadFile(fileObject) {
        console.log('Uploading file', fileObject);

        var id =  md5.hex_md5(this.state.remoteUri + '_' + basename);
        let filepath = fileObject.uri ? fileObject.uri : fileObject;
        const basename = filepath.split('\\').pop().split('/').pop();
        let stats_filename = filepath.startsWith('file://') ? filepath.substr(7, filepath.length - 1) : filepath;
        const { size } = await ReactNativeBlobUtil.fs.stat(stats_filename);

        let file_transfer = { 'path': filepath,
                              'filename': basename,
                              'filesize': fileObject.fileSize || size,
                              'sender': {'uri': this.state.accountId},
                              'receiver': {'uri': this.state.remoteUri},
                              'transfer_id': id,
                              'direction': 'outgoing'
                              };

        if (fileObject.filetype) {
            file_transfer.filetype = fileObject.filetype;
        }

        let text = utils.beautyFileNameForBubble(file_transfer);

        let msg = {
            _id: id,
            key: id,
            text: text,
            metadata: file_transfer,
            received: false,
            sent: false,
            pending: true,
            createdAt: new Date(),
            direction: 'outgoing',
            user: {}
            }

        if (utils.isImage(basename)) {
            msg.image = filepath;
        } else if (utils.isAudio(basename)) {
            msg.audio = filepath;
        } else if (utils.isVideo(basename)) {
            msg.video = filepath;
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg])});

        file_transfer.url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + this.props.call.id + '/' + basename;
        file_transfer.transfer_id = id;
        let localPath = this.filePath(basename);
        await RNFS.copyFile(file_transfer.path, localPath);
        //console.log('Copy file to', localPath);
        file_transfer.local_url = localPath;
        file_transfer.progress = 0;
        msg.metadata = file_transfer;

        RNFS.readFile(localPath, 'base64').then(res => {
            // Persist the now-fully-populated message (metadata
            // including url, local_url, transfer_id, progress=0)
            // to the conference chat history table.
            //
            // NOTE: do NOT GiftedChat.append the same msg into
            // renderMessages again here. The message was already
            // added to renderMessages above (line ~1113, right
            // after constructing the initial msg), and msg.metadata
            // was then mutated in place (line ~1122). React state
            // holds the same object reference, so the updated
            // metadata is already visible to the next render.
            // Appending again resulted in a duplicate bubble for
            // every uploaded file — the "double message" the user
            // reported. Removing the second append leaves a single
            // bubble whose progress animates 0→100 as expected.
            this.saveConferenceMessage(this.state.remoteUri, msg);

            var oReq = new XMLHttpRequest();
            oReq.addEventListener("load", this.transferComplete);
            oReq.addEventListener("error", this.transferFailed);
            oReq.addEventListener("abort", this.transferCanceled);
            oReq.open('POST', file_transfer.url);
            const formData = new FormData();
            formData.append(res);

            oReq.send(formData);
            if (oReq.upload) {
                oReq.upload.onprogress = ({ total, loaded }) => {
                    const progress = Math.ceil(loaded / total * 100);
                    this.updateFileMessage(id, progress);
                };
            }
        })
        .catch(err => {
            console.log('Failed to upload file', err.message, err.code);
        });
    }

    updateFileMessage(id, progress, failed=false) {
    //make a change togglePlay(msgidx) {

        //console.log('Update file progress', id, progress);
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        let nextState;
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                //console.log('Update file transfer for msg', msg);
                 if (failed) {
                     msg.failed = true;
                     msg.sent = true;
                     msg.pending = false;
                     msg.received = false;
                     msg.metadata.progress = null;
                     this.postChatSystemMessage('Download failed', false);
                     this.updateConferenceMessage(this.state.remoteUri, msg);
                 }

                 msg.metadata.progress = progress;

                 if (progress !== null) {
                     msg.failed = false;
                     msg.received = null;
                 }

                 if (progress === 100 && (!msg.sent || !msg.received)) {
                     msg.failed = false;
                     msg.pending = false;
                     msg.sent = msg.direction === 'outgoing' ? true : false;
                     msg.received = true;
                     msg.text = utils.beautyFileNameForBubble(msg.metadata);
                     console.log(msg.metadata.filename, msg.direction === 'outgoing' ? 'Upload completed' : 'Download completed');
                     //console.log('Update metadata', msg.metadata);
                     this.updateConferenceMessage(this.state.remoteUri, msg);
                 }
             }
             newRenderMessages.push(msg);
        });

        this.setState({renderMessages: GiftedChat.append(newRenderMessages, [])});
    }

    purgeSharedFiles() {
        this.state.renderMessages.forEach((msg) => {
            if (msg.url) {
                if (!msg.image && !msg.local_url) {
                    const parts = msg.url.split('/');
                    const filename = parts[parts.length - 1];
                    let existingFiles = this.state.sharedFiles.filter(file => md5.hex_md5(this.state.remoteUri + '_' + filename) === msg._id);
                    if (existingFiles.length === 0) {
                        this.props.deleteConferenceMessage(this.state.remoteUri, msg);
                    }
                }
            }
        });
    }

    async listSharedFiles() {
        //console.log('--- List shared files');

        let messages = this.state.renderMessages;
        let new_messages = [];
        let found = false;
        let exists = false;

        for (const file of this.state.sharedFiles) {
            if (file.session === this.props.call.id) {
                // skip my own files
                continue;
            }

            let metadata = {};
            let text;
            let url;
            let msg;
            found = false;
            exists = false;

            metadata.transfer_id = md5.hex_md5(this.state.remoteUri + '_' + file.filename);

            for (const msg of messages) {
                if (msg._id === metadata.transfer_id) {
                    found = true;
                    metadata = msg.metadata;
                    console.log('File transfer', metadata.filename, 'already exists');
                    msg.text = utils.beautyFileNameForBubble(metadata);
                    exists = await RNFS.exists(metadata.local_url);
                    if (exists) {
                        console.log('Local file', metadata.filename, 'already exists');
                        metadata.received = true;
                        if (utils.isImage(metadata.filename)) {
                            msg.image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        } else if (utils.isAudio(metadata.filename)) {
                            msg.audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        } else if (utils.isVideo(metadata.filename)) {
                            msg.video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        }
                     } else {
                         metadata.received = false;
                         msg.image = null;
                         msg.audio = null;
                         msg.video = null;
                     }
                     console.log('Updated message', msg);
                     new_messages.push(msg);
                }
            }

            if (found) {
                 this.setState({renderMessages: GiftedChat.append(new_messages, [])});
                 console.log('Update list and return');
                 return;
            }

            metadata.filesize = file.filesize;
            metadata.filename = file.filename;
            metadata.sender = {uri: file.uploader.uri};
            metadata.receiver = {uri: this.state.remoteUri};
            metadata.session = file.session;
            metadata.url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + metadata.session + '/' + metadata.name;
            metadata.direction = metadata.sender.uri === this.props.account.id ? 'outgoing' : 'incoming';
            metadata.local_url = this.filePath(metadata.filename);

            console.log('--- Shared file:', metadata);

            text = utils.beautyFileNameForBubble(metadata);

            msg = {
                  _id: metadata.transfer_id,
                  key: metadata.transfer_id,
                  createdAt: new Date(),
                  text: text,
                  url: url,
                  metadata: metadata,
                  received: false,
                  failed: false,
                  sent: false,
                  user: metadata.direction === 'incoming' ? {_id: metadata.sender.uri, name: metadata.sender.displayName || metadata.sender.uri} : {}
                };

            exists = await RNFS.exists(metadata.local_url);
            if (exists) {
                console.log('Local file new', metadata.local_url, 'already exists');
                metadata.received = true;

                if (utils.isImage(metadata.filename)) {
                    msg.image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (utils.isAudio(metadata.filename)) {
                    msg.audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (utils.isVideo(metadata.filename)) {
                    msg.video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                }

            } else {
                metadata.progress = 0;
                if (isImage) {
                    this.downloadFile(metadata);
                }
            }
            this.saveConferenceMessage(this.state.remoteUri, msg);
            console.log('Adding message for file transfer', msg);
            this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg])});
        }

        setTimeout(() => {
            this.purgeSharedFiles();
        }, 1000);
    }

    async stopDownloadFile(metadata) {
        let renderMessages = this.state.renderMessages;
        renderMessages.forEach((msg) => {
             if (msg._id === metadata.transfer_id) {
                 msg.metadata.progress = null;
                 this.updateConferenceMessage(this.state.remoteUri, msg);
             }
        });

        if (metadata.transfer_id in this.downloadRequests) {
            console.log('Stop download', metadata.url);
            let task = this.downloadRequests[metadata.transfer_id];
            task.stop();
            delete this.downloadRequests[metadata.transfer_id];
        }
    }

    async downloadFile(metadata) {
        //console.log('downloadFile', metadata);
        let lostTasks = await RNBackgroundDownloader.checkForExistingDownloads();

        /*
        TODO: server needs support for this resume

        if (metadata.transfer_id in this.downloadRequests) {
            let task = this.downloadRequests[metadata.transfer_id];
            console.log('Resume download', metadata.url);
            task.resume();
            return;
        }
        */

        const existingTask = lostTasks.filter(task => task.id === metadata.transfer_id);

        if (existingTask.length === 1) {
            var task = existingTask[0];
            console.log('Found existing download task', task);
            task.progress((percent) => {
                const progress = Math.ceil(percent * 100);
                this.updateFileMessage(metadata.transfer_id, progress);
            }).begin((expectedBytes) => {
                this.updateFileMessage(metadata.transfer_id, 0);
            }).done(() => {
                this.updateFileMessage(metadata.transfer_id, 100);
            }).error((error) => {
                this.updateFileMessage(metadata.transfer_id, 0, error);
                console.log(task.url, 'download error:', error);
            });
        } else {
            console.log('Start new download:', metadata.url);
            this.updateFileMessage(metadata.transfer_id, 0);
            this.downloadRequests[metadata.transfer_id] = RNBackgroundDownloader.download({
                id: metadata.transfer_id,
                url: metadata.url,
                destination: metadata.local_url
            }).begin((tinfo) => {
	            if (tinfo.expectedBytes) {
                    this.updateFileMessage(metadata.transfer_id, 0);
                    console.log(metadata.name, 'will download', expectedBytes, 'bytes');
                }
            }).progress((pdata) => {
				if (pdata && pdata.bytesDownloaded && pdata.bytesTotal) {
					const percent = pdata.bytesDownloaded/pdata.bytesTotal * 100;
					const progress = Math.ceil(percent);
					file_transfer.progress = progress;
                    this.updateFileMessage(metadata.transfer_id, progress);
				}
            }).done(() => {
                this.updateFileMessage(metadata.transfer_id, 100);
                delete this.downloadRequests[metadata.transfer_id];
            }).error((error) => {
                console.log(metadata.name, 'download error:', error);
                this.updateFileMessage(metadata.transfer_id, 0, error);
                delete this.downloadRequests[metadata.transfer_id];
            });
        }
    }

    onLongMessagePress(context, currentMessage) {
        if (currentMessage && currentMessage.text) {
            let options = []
            options.push('Copy');
            if (currentMessage.local_url) {
                options.push('Open');
            }
            options.push('Cancel');

            //console.log('currentMessage', currentMessage);
            let l = options.length - 1;

            context.actionSheet().showActionSheetWithOptions({options, l}, (buttonIndex) => {
                let action = options[buttonIndex];
                if (action === 'Copy') {
                    Clipboard.setString(currentMessage.text);
                } else if (action === 'Open') {
                    FileViewer.open(currentMessage.local_url, { showOpenWithDialog: true })
                    .then(() => {
                        // success
                    })
                    .catch(error => {
                        // error
                    });
                }
            });
        }
    };

    removeInvitedParticipant(uri) {
        console.log('[ConferenceBox] [conference] removeInvitedParticipant uri=' + uri +
                    ' present=' + this.invitedParticipants.has(uri));
        if (this.invitedParticipants.has(uri) > 0) {
            const entry = this.invitedParticipants.get(uri);
            this.invitedParticipants.delete(uri);
            this._cancelInviteTimeout(uri);
            console.log('[ConferenceBox] [conference] invite tile removed for ' + uri +
                        ' (was status=' + (entry && entry.status) + ')');
            this.forceUpdate();
        } else {
            console.log('[ConferenceBox] [conference] removeInvitedParticipant: no entry for ' + uri);
        }
    }

    // Kick an already-joined participant out of the conference. Opens
    // a confirmation dialog first — the kick is irreversible (the
    // kicked party gets BYE'd / Janus-kicked and would have to rejoin
    // manually), so a fat-finger guard is warranted. Tapping Cancel
    // is a no-op; tapping Remove proceeds with _kickParticipantNow.
    kickParticipant(uri, displayName) {
        if (!uri) return;
        const _label = (displayName && String(displayName).trim()) || uri;
        Alert.alert(
            'Remove from conference?',
            _label + ' will be disconnected from the conference.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => this._kickParticipantNow(uri),
                },
            ],
            { cancelable: true }
        );
    }

    // Actual kick — runs only after the user confirms in the dialog
    // above. Sends a videoroom-remove request to the webrtcgateway,
    // which fans out per participant type (SIP → REFER ;method=BYE
    // to the conference focus; WebRTC → Janus videoroom kick). Posts
    // a system message in the chat so the room sees who was removed.
    // The participant disappears from the participants list on the
    // next NOTIFY / publisher-leaving event — no client-side cache
    // munging needed.
    _kickParticipantNow(uri) {
        if (!uri) return;
        console.log('[ConferenceBox] [conference] kickParticipant uri=' + uri);
        if (!this.props.call || typeof this.props.call.removeParticipants !== 'function') {
            console.log('[ConferenceBox] [conference] kickParticipant: call.removeParticipants not available');
            return;
        }
        try {
            this.props.call.removeParticipants([uri]);
        } catch (e) {
            console.log('[ConferenceBox] [conference] kickParticipant: removeParticipants threw: ' + (e && e.message));
            return;
        }
        try {
            this.postChatSystemMessage(uri + ' was removed', true);
        } catch (e) { /* non-fatal */ }
    }

    updateParticipantsStatus() {
        let participants_uris = [];

        this.state.participants.forEach((p) => {
            participants_uris.push(p.identity._uri);
        });

        // SIP participants come through sipConferenceParticipants (RFC 4575
        // conference-info), not through state.participants — include their
        // AORs in the membership set used to drop entries from
        // invitedParticipants once the invitee actually joins. Without this
        // an invited SIP URI sticks in the Map forever (and the tile keeps
        // rendering) because the AOR never matches the full sip:URI key.
        if (Array.isArray(this.state.sipParticipants)) {
            this.state.sipParticipants.forEach((sp) => {
                if (!sp || (sp.type !== 'sip' && sp.type !== 'bridge')) return;
                const _spUri = sp.uri || '';
                if (!_spUri) return;
                participants_uris.push(_spUri);
                // Also push the bare AOR (sip:user@host -> user@host)
                // since invitedParticipants keys may be stored either
                // with or without the URI scheme depending on caller.
                let _aor = _spUri;
                if (_aor.indexOf('sip:') === 0) _aor = _aor.slice(4);
                else if (_aor.indexOf('sips:') === 0) _aor = _aor.slice(5);
                _aor = _aor.split(';')[0];
                if (_aor && _aor !== _spUri) participants_uris.push(_aor);
            });
        }

        this.getConnectionStats();

        const invitedParties = Array.from(this.invitedParticipants.keys());
        //console.log('Invited participants', invitedParties);
        //console.log('Current participants', participants_uris);

        // Membership test that tolerates either "sip:user@host" or the
        // bare "user@host" form on either side of the comparison. The
        // previous `indexOf(_uri) > 0` was doubly broken: `> 0` skipped
        // index 0 (so the first-listed joiner was never cleaned up), and
        // it required exact-string equality which fails when one side
        // has the sip: scheme and the other doesn't.
        const _normAor = (u) => {
            if (!u) return '';
            let s = String(u);
            if (s.indexOf('sip:') === 0) s = s.slice(4);
            else if (s.indexOf('sips:') === 0) s = s.slice(5);
            return s.split(';')[0];
        };
        const _participantAorSet = new Set(participants_uris.map(_normAor).filter(Boolean));
        const _isInRoom = (uri) => _participantAorSet.has(_normAor(uri));

        let p;
        let interval;

        invitedParties.forEach((_uri) => {
            if (_isInRoom(_uri)) {
                this.invitedParticipants.delete(_uri);
                this._cancelInviteTimeout && this._cancelInviteTimeout(_uri);
                return;
            }

            p = this.invitedParticipants.get(_uri);
            if (!p) {
                return;
            }

            interval = Math.floor((Date.now() - p.timestamp) / 1000);
            // 45-second invite window — matches the
            // _scheduleInviteTimeout default further below. Earlier
            // this was 60s and was lowered per user request; the
            // countdown shown on the tile must match the actual
            // timeout or the user sees the tile go from "Waiting
            // ...15" straight to "408 No answer" with no clear
            // reason why.
            const remaining = 45 - interval;

            // If a server-side status update already arrived
            // (success, failure 3xx/4xx/5xx/6xx, 'Accepted', or the
            // final '408 No answer' we set on timeout), don't touch
            // the entry anymore.
            const _isFinal = /^[2-6]\d\d\b/.test(String(p.status || '')) || p.status === 'Accepted';
            if (_isFinal) return;

            if (remaining <= 0) {
                p.status = '408 No answer';
                p.remaining = 0;
                this.postChatSystemMessage(_uri + ' did not answer', true);
            } else {
                // Keep top status as 'Invited' so the failure regex
                // doesn't trigger early; expose remaining seconds for
                // the tile to render "Waiting ...XX" in its bottom slot.
                p.status = 'Invited';
                p.remaining = remaining;
            }
        });

        this.forceUpdate();
    }

    postChatSystemMessage(text, save=true) {
        var now = new Date();
        var hours = now.getHours();
        var mins = now.getMinutes();
        var secs = now.getSeconds();
        var ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        mins = mins < 10 ? '0' + mins : mins;
        secs = secs < 10 ? '0' + secs : secs;
        text = text + ' at ' + hours + ":" + mins + ':' + secs + ' ' + ampm;

        var id = uuid.v4();

        const giftedChatMessage = {
              _id: uuid.v4(),
              key: id,
              createdAt: now,
              text: text,
              system: true,
            };

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        if (save) {
            this.saveConferenceMessage(this.state.remoteUri, giftedChatMessage);
        }
    }

    _scheduleInviteTimeout(uri, totalMs = 45000) {
        if (!this._inviteTimers) this._inviteTimers = new Map();
        // Cancel any pre-existing timer for this URI before scheduling a new one.
        if (this._inviteTimers.has(uri)) {
            clearTimeout(this._inviteTimers.get(uri));
            this._inviteTimers.delete(uri);
        }
        const entry = this.invitedParticipants.get(uri);
        if (!entry) return;
        const elapsed = Date.now() - (entry.timestamp || Date.now());
        const remaining = totalMs - elapsed;
        const _fire = () => {
            if (!this.invitedParticipants) return;
            const e2 = this.invitedParticipants.get(uri);
            if (!e2) return;
            // Only mark as timed-out if no status update arrived in the meantime.
            // Final-state strings ('Accepted', '4xx Reason', etc.) leave it alone.
            const s = String(e2.status || '');
            const isFinal = /^[2-6]\d\d\b/.test(s) || s === 'Accepted';
            if (isFinal) return;
            this.invitedParticipants.set(uri, Object.assign({}, e2, {status: '408 No answer'}));
            console.log('[ConferenceBox] [conference] invite timed out for ' + uri);
            this.forceUpdate();
        };
        if (remaining <= 0) {
            _fire();
            return;
        }
        const tid = setTimeout(_fire, remaining);
        this._inviteTimers.set(uri, tid);
    }

    _cancelInviteTimeout(uri) {
        if (!this._inviteTimers) return;
        if (this._inviteTimers.has(uri)) {
            clearTimeout(this._inviteTimers.get(uri));
            this._inviteTimers.delete(uri);
        }
    }

    _keyboardDidShow(e) {
       // In audio-only view, do NOT change layout in response to the
       // keyboard. Even a one-shot Animated.setValue triggers a layout
       // pass that the Android IME interprets as keyboard interaction,
       // leading to oscillation. The system's adjustResize + KAV
       // behavior='height' together handle the chat composer; the
       // participants area stays visible (just bounded at 50% of screen
       // via its static maxHeight). Acceptable trade-off: less screen
       // real estate when typing, but the keyboard stays up reliably.
       if (this.audioOnlyView) return;
       this.setState({keyboardVisible: true, keyboardHeight: e.endCoordinates.height});
    }

    _keyboardDidHide() {
        if (this.audioOnlyView) return;
        this.setState({keyboardVisible: false, keyboardHeight: 0});
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    composingIndicationReceived(data) {
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }

        this.setState({isTyping: true});

        this.typingTimer = setTimeout(() => {
            this.setState({isTyping: false});
            this.typingTimer = null;
        }, 5000);
    }

    messageReceived(sylkMessage) {
        //console.log('Conference got message', sylkMessage);

        if (typeof sylkMessage.content === 'string' && sylkMessage.content.startsWith('?OTR')) {
            return;
        }

        if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
            return;
        }

        const existingMessages = this.state.renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
        if (existingMessages.length > 0) {
            return;
        }

        if (sylkMessage.direction === 'incoming' && sylkMessage.sender.uri === this.state.accountId) {
            sylkMessage.direction = 'outgoing';
        }

        const giftedChatMessage = utils.sylk2GiftedChat(sylkMessage);
        if (sylkMessage.type === 'status') {
            return;
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        this.saveConferenceMessage(this.state.remoteUri, giftedChatMessage);
    }

    onSendMessage(messages) {
        if (!this.props.call) {
            return;
        }
        messages.forEach((message) => {
            this.props.sendConferenceMessage(message);
        });
        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    lookupContact(uri, displayName) {
        let photo;
        let username = uri.split('@')[0];

        // Prefer the saved contact's name when one exists locally —
        // that's what the rest of the UI (contact list, navbar) uses.
        let contact = this.props.lookupContact(uri);
        if (contact && contact.name) {
            displayName = contact.name;
        }

        // If a display name was provided (by the caller or pulled from
        // a saved contact above), preserve it exactly — just trim
        // surrounding whitespace. Don't title-case or otherwise rewrite
        // it; the user picked that capitalization deliberately. Only
        // title-case the URI local-part fallback, where we're synthesizing
        // a label from a machine identifier.
        let finalName;
        if (displayName) {
            finalName = String(displayName).trim();
        } else {
            finalName = toTitleCase(username);
        }

        const c = {photo: photo, displayName: finalName};
        this.foundContacts.set(uri, c);
    }

     onParticipantJoined(p) {
        // [grid] one-line transition log for the matrix sizing
        // pipeline. Logs the remote-participant count BEFORE and
        // AFTER this join so it's easy to spot which event flipped
        // the grid from e.g. 1→2 tiles (self+remote → 2 remotes,
        // self drops out of the matrix into a PIP) without grepping
        // the wider participant-state spam. Same pattern in
        // onParticipantLeft and getConnectionStats' stalled set
        // recompute so any membership change in visibleParticipants
        // has a single grep-able marker.
        const _prev = this.state.participants.length;
        console.log('[conference] [grid] participant joined', p.identity && p.identity._uri,
            'remote-count', _prev, '->', _prev + 1);

        // Suppress chat-line logging for the PSTN audio bridge —
        // it's plumbing (sylk-janus-audio-bridge → conference
        // focus), not a real attendee. Same heuristic the audio
        // tile builder and the per-participant bandwidth overlay
        // use (display name contains "bridge" or URI rooted in
        // @conference.). The participant itself still gets added
        // to state.participants and lights up its tile / stats —
        // we only skip the system message in the persistent chat
        // thread so the audit log stays human-readable.
        const _isBridgeJoin = this._isBridgeParticipant(p);
        if (_isBridgeJoin) {
            console.log('[conference] [chat] suppressing bridge join from chat log:',
                p.identity && p.identity._uri);
        } else if (p.identity._uri.search('guest.') === -1) {
            if (p.identity._uri !== this.props.call.localIdentity._uri) {
                // used for history item
                this.props.saveParticipant(this.props.call.id, this.state.remoteUri, p.identity._uri);
            }
            const dn = p.identity._uri + ' joined';
            // save=true so the join lands in the persistent conference
            // chat thread via saveConferenceMessage — was previously
            // dropped after the call ended, which is why the chat
            // showed only "outgoing call ended" after disconnect.
            this.postChatSystemMessage(dn, true);
        } else {
            this.postChatSystemMessage('An anonymous guest joined', true);
        }

        this.lookupContact(p.identity._uri, p.identity._displayName);
        if (this.invitedParticipants.has(p.identity._uri)) {
            this.invitedParticipants.delete(p.identity._uri);
        }
        // this.refs.audioPlayerParticipantJoined.play();
        p.on('stateChanged', this.onParticipantStateChanged);
        p.attach();
        p.timestamp = Date.now();
        this.setState({
            participants: this.state.participants.concat([p])
        }, () => {
            // Dump after setState resolves so the roster the log
            // shows reflects the participant we just added.
            this._dumpParticipantRoster('participant joined');
        });
        // this.changeResolution();
        this.fullScreenTimer();

        // Conference recording: hook the new participant's audio track
        // into the multi-track recorder if one is active. Their
        // RTCPeerConnection's receiver is wired up here as part of
        // p.attach(), but the audio track may take a beat longer to
        // appear — schedule the attach asynchronously and retry a few
        // times rather than racing the WebRTC track-added callback.
        if (this.state.isConferenceRecording) {
            this._attachConferenceRecordingParticipant(p);
        }
    }

	/** Per-participant VU-meter sampler — runs at ~5 Hz from the
	 *  `_vuSamplerTimer` set up in the constructor.
	 *
	 *  Pulls WebRTC `getStats()` once per peer connection:
	 *    • Each remote participant has its own `_pc`. We look at
	 *      its inbound-rtp audio reports' `audioLevel` (0..1
	 *      averaged over the most recent sampling window) and
	 *      bucket it under the participant's id.
	 *    • The local microphone level comes from the main call's
	 *      `_pc`: the `media-source` audio report's audioLevel
	 *      (with `outbound-rtp.audioLevel` as a fallback for the
	 *      older RN-WebRTC builds that don't emit media-source).
	 *      Bucketed under the literal key 'myself' to match the
	 *      `key="myself"` ConferenceAudioParticipant element.
	 *
	 *  Smoothing matches AudioCallBox's call-screen meter so the
	 *  bars feel consistent across surfaces: fast attack (instant
	 *  rise to new peaks), slow release (~150 ms half-life at
	 *  5 Hz → 0.75 multiplier per tick on the way down). The
	 *  result is stored on a plain `this.audioLevels` Map and a
	 *  setState({_vuTick: …}) tick forces re-render; the render
	 *  pass reads `this.audioLevels.get(p.id)` per participant
	 *  and forwards it to the ConferenceAudioParticipant. */
	async _sampleConferenceAudioLevels() {
		if (this.userHangup) return;
		const participants = this.state.participants || [];
		if (!this.props.call) return;

		// Iterate remote participants + local PC in parallel.
		// `Promise.all` here is purely a parallelism gain — each
		// getStats() is independent and the bridge handles them
		// concurrently. Tolerate per-PC failures: a transient
		// renegotiation or teardown error on one peer must not
		// stop the rest of the meters from updating.
		const targets = [];
		participants.forEach((p) => {
			if (p && p._pc) targets.push({ key: p.id, pc: p._pc, local: false });
		});
		if (this.props.call._pc) {
			targets.push({ key: 'myself', pc: this.props.call._pc, local: true });
		}

		const samples = await Promise.all(targets.map(async (t) => {
			try {
				const stats = await t.pc.getStats();
				let raw = 0;
				if (stats && typeof stats.forEach === 'function') {
					stats.forEach((report) => {
						if (!report) return;
						const isAudio = (report.kind === 'audio' || report.mediaType === 'audio');
						if (!isAudio) return;
						if (t.local) {
							// Local mic: media-source first, fall back
							// to outbound-rtp if the stack doesn't emit
							// media-source. Same lookup AudioCallBox uses.
							if (report.type === 'media-source'
									&& typeof report.audioLevel === 'number') {
								raw = report.audioLevel;
							} else if (report.type === 'outbound-rtp'
									&& typeof report.audioLevel === 'number'
									&& raw === 0) {
								raw = report.audioLevel;
							}
						} else {
							// Remote participant: the only audio level
							// that matters is what's coming IN over
							// this participant's PC.
							if (report.type === 'inbound-rtp'
									&& typeof report.audioLevel === 'number') {
								raw = report.audioLevel;
							}
						}
					});
				}
				return { key: t.key, raw };
			} catch (e) {
				return { key: t.key, raw: 0 };
			}
		}));

		// Apply the same fast-attack / slow-release envelope per
		// participant key. sqrt() pulls quieter voices up a band
		// so a normal speaking voice lights ~60% of the meter
		// instead of just the first couple of green LEDs.
		let anyChange = false;
		samples.forEach(({ key, raw }) => {
			const scaled = Math.min(1, Math.sqrt(Math.max(0, raw)));
			const prev = this.audioLevels.get(key) || 0;
			const next = scaled > prev ? scaled : (prev * 0.75 + scaled * 0.25);
			if (Math.abs(next - prev) > 0.005) {
				this.audioLevels.set(key, next);
				anyChange = true;
			}
		});

		// Drop entries for participants that have gone away
		// (left the conference or were never connected). Without
		// this the map would grow unbounded across long sessions.
		const liveKeys = new Set(targets.map((t) => t.key));
		this.audioLevels.forEach((_, key) => {
			if (!liveKeys.has(key)) {
				this.audioLevels.delete(key);
				anyChange = true;
			}
		});

		if (anyChange && !this.userHangup) {
			// Single setState per sample → at most ~5 renders/s
			// for the meter. The _vuTick value itself is irrelevant
			// to the render output (the render reads audioLevels
			// directly off `this`), it just forces React to
			// re-run render so the updated levels propagate to
			// each ConferenceAudioParticipant via props.
			this.setState((s) => ({ _vuTick: ((s && s._vuTick) || 0) + 1 }));
		}
	}

	async getConnectionStats() {
		try {
			// --- Initialize all maps if they don’t exist
			this.audioBytesReceived = this.audioBytesReceived || new Map();
			this.videoBytesReceived = this.videoBytesReceived || new Map();
			this.audioBandwidth = this.audioBandwidth || new Map();
			this.videoBandwidth = this.videoBandwidth || new Map();
			this.audioPacketLoss = this.audioPacketLoss || new Map();
			this.videoPacketLoss = this.videoPacketLoss || new Map();
			this.packetLoss = this.packetLoss || new Map();
			this.latency = this.latency || new Map();
			this.mediaLost = this.mediaLost || new Map();
			this.videoCodec = this.videoCodec || new Map();
			this.audioCodec = this.audioCodec || new Map();
	
			if (this.state.participants.length === 0) {
				// console.log("No participants, resetting bandwidth");
				this.bandwidthDownload = 0;
				this.bandwidthUpload = 0;
				this.videoBandwidth.set('total', 0);
				this.audioBandwidth.set('total', 0);
				return;
			}
	
			const participants = this.state.participants.concat(this.props.call);
			// console.log("Participants to process:", participants.length);
	
			for (const p of participants) {
				if (!p._pc) {
					// console.log("Skipping participant with no peer connection:", p.id || p);
					continue;
				}
	
				const identity = p.identity ? p.identity.uri : 'myself';
				// console.log("Processing participant:", identity);
	
				// Ensure per-participant map entries
				if (!this.audioBytesReceived.has(p.id)) this.audioBytesReceived.set(p.id, 0);
				if (!this.videoBytesReceived.has(p.id)) this.videoBytesReceived.set(p.id, 0);
				if (!this.audioBandwidth.has(p.id)) this.audioBandwidth.set(p.id, 0);
				if (!this.videoBandwidth.has(p.id)) this.videoBandwidth.set(p.id, 0);
				if (!this.latency.has(p.id)) this.latency.set(p.id, 0);
				if (!this.audioPacketLoss.has(p.id)) this.audioPacketLoss.set(p.id, 0);
				if (!this.videoPacketLoss.has(p.id)) this.videoPacketLoss.set(p.id, 0);
				if (!this.packetLoss.has(p.id)) this.packetLoss.set(p.id, 0);
	
				try {
					const stats = await p._pc.getStats();
					// console.log("Stats received for", identity, stats.size);
	
					let audioPackets = 0,
						videoPackets = 0,
						audioPacketsLost = 0,
						videoPacketsLost = 0;
	
					let totalPackets = 0,
						totalPacketsLost = 0;
	
					let totalAudioBandwidth = 0,
						totalVideoBandwidth = 0,
						bandwidthUpload = 0;

					// Capture codecIds on the active RTP streams for this
					// participant; resolved to codec names after the forEach
					// pass via stats.get(codecId).mimeType.
					let inboundAudioCodecId  = null;
					let inboundVideoCodecId  = null;
					let outboundAudioCodecId = null;
					let outboundVideoCodecId = null;

					stats.forEach(report => {
						try {
							const kind = report.kind; // "audio" or "video"
	
							// --- Inbound media (received from remote)
							if (report.type === "inbound-rtp" && identity !== 'myself') {
								if (report.codecId) {
									if (kind === 'audio') inboundAudioCodecId = report.codecId;
									else if (kind === 'video') inboundVideoCodecId = report.codecId;
								}
								const { bytesReceived, packetsReceived, packetsLost } = report;
								if (bytesReceived !== undefined) {
									const lastBytes = kind === 'audio'
										? this.audioBytesReceived.get(p.id)
										: this.videoBytesReceived.get(p.id);
									const diff = bytesReceived - lastBytes;
									const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
									if (kind === 'audio') {
										totalAudioBandwidth += speed;
										this.audioBandwidth.set(p.id, speed);
										this.audioBytesReceived.set(p.id, bytesReceived);
									} else if (kind === 'video') {
										totalVideoBandwidth += speed;
										this.videoBandwidth.set(p.id, speed);
										// Refresh activity timestamp whenever
										// inbound video bytes increase, so the
										// stall-detector below can tell who
										// has gone silent. We initialize on
										// first sight too, otherwise a
										// participant who never delivered any
										// frames yet (still negotiating) would
										// look stalled from the start.
										if (diff > 0 || !this.lastVideoActivity.has(p.id)) {
											this.lastVideoActivity.set(p.id, Date.now());
										}
										this.videoBytesReceived.set(p.id, bytesReceived);
										// One-shot "start your camera?" prompt.
										// The conference always JOINS in audio
										// mode (see constructor). The first
										// time we observe a REMOTE participant
										// actually sending video bytes, surface
										// the UpgradeVideoModal so the user can
										// choose to start their own camera
										// (Accept) or stay audio-only (Cancel).
										// Either branch flips the latch so the
										// prompt only fires once per session;
										// subsequent video starts/stops are
										// the user's responsibility via the
										// kebab. Gated on:
										//   • `identity !== 'myself'` — our
										//     own outbound stream doesn't
										//     count; we only prompt when a
										//     PEER has video.
										//   • `bytesReceived > 0` — guards
										//     against the first-sight init
										//     above where we set lastVideo-
										//     Activity for a track that has
										//     not delivered a byte yet.
										//   • `!_autoEscalatedToVideo` —
										//     latch fires exactly once per
										//     session.
										//   • `viewMode === 'audio'` — never
										//     prompt if the user has already
										//     moved to video on their own.
										//   • `!this.state.cameraPromptVisible`
										//     — defensive guard against a
										//     burst of stats updates while the
										//     prompt is already up.
										if (!this._autoEscalatedToVideo
												&& identity !== 'myself'
												&& bytesReceived > 0
												&& this.state.viewMode === 'audio'
												&& !this.state.cameraPromptVisible) {
											this._autoEscalatedToVideo = true;
											console.log('[conference] prompting to start camera —',
												'remote', identity, 'sending video');
											// Defer the setState one tick so
											// we don't mutate state in the
											// middle of the stats forEach.
											setTimeout(() => this.setState({
												cameraPromptVisible: true,
												cameraPromptRemoteUri: identity,
											}), 0);
										}
									}
									// console.log(`[${identity}] ${kind} inbound speed: ${speed} kbps`);
								}
	
								if (packetsReceived !== undefined && packetsLost !== undefined) {
									totalPackets += packetsReceived;
									totalPacketsLost += packetsLost;
									if (kind === 'audio') {
										audioPackets += packetsReceived;
										audioPacketsLost += packetsLost;
									} else if (kind === 'video') {
										videoPackets += packetsReceived;
										videoPacketsLost += packetsLost;
									}
									// console.log(`[${identity}] ${kind} inbound packets received: ${packetsReceived}, lost: ${packetsLost}`);
								}
							}
	
							// --- Outbound media (sent by us)
							if (report.type === "outbound-rtp" && identity === 'myself') {
								if (report.codecId) {
									if (kind === 'audio') outboundAudioCodecId = report.codecId;
									else if (kind === 'video') outboundVideoCodecId = report.codecId;
								}
								const { bytesSent, packetsSent } = report;
								if (bytesSent !== undefined) {
									const lastBytes = kind === 'audio'
										? this.audioBytesReceived.get(p.id)
										: this.videoBytesReceived.get(p.id);
									const diff = bytesSent - lastBytes;
									const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
									bandwidthUpload += speed;
									if (kind === 'audio') this.audioBandwidth.set(p.id, speed);
									else if (kind === 'video') this.videoBandwidth.set(p.id, speed);
									if (kind === 'audio') this.audioBytesReceived.set(p.id, bytesSent);
									else this.videoBytesReceived.set(p.id, bytesSent);
									// console.log(`[${identity}] ${kind} outbound speed: ${speed} kbps`);
								}
	
								if (packetsSent !== undefined) {
									totalPackets += packetsSent;
									// console.log(`[${identity}] ${kind} outbound packets sent: ${packetsSent}`);
								}
							}
	
							// --- Latency / RTT
							if ((report.type === "remote-inbound-rtp" || report.type === "transport") && report.roundTripTime !== undefined) {
								const delay = report.roundTripTime * 1000; // ms
								this.latency.set(p.id, Math.ceil(delay));
								// console.log(`[${identity}] RTT from ${report.type}: ${delay.toFixed(2)} ms`);
							}
	
							if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime !== undefined) {
								const delay = report.currentRoundTripTime * 1000;
								this.latency.set(p.id, Math.ceil(delay));
								// console.log(`[${identity}] RTT from candidate-pair: ${delay.toFixed(2)} ms`);
							}
	
						} catch (err) {
							console.warn("Error processing report", report.type, err);
						}
					});
	
					// --- Resolve codec name from codecId references.
					//     For each remote participant, the inbound-rtp record
					//     points at a codec record with mimeType e.g. "video/VP8".
					//     For 'myself' we look at the outbound side instead.
					const codecName = (codecId) => {
						if (!codecId) return null;
						let entry = null;
						try { entry = stats.get ? stats.get(codecId) : null; } catch (e) { entry = null; }
						if (!entry) {
							// Fallback: scan stats for a matching id (older RN-WebRTC).
							stats.forEach(r => { if (!entry && r && r.id === codecId) entry = r; });
						}
						if (!entry || !entry.mimeType) return null;
						const parts = entry.mimeType.split('/');
						return parts.length > 1 ? parts[1] : entry.mimeType;
					};

					const vCodec = identity === 'myself'
						? codecName(outboundVideoCodecId)
						: codecName(inboundVideoCodecId);
					const aCodec = identity === 'myself'
						? codecName(outboundAudioCodecId)
						: codecName(inboundAudioCodecId);

					if (vCodec) this.videoCodec.set(p.id, vCodec);
					if (aCodec) this.audioCodec.set(p.id, aCodec);

					// --- Compute packet loss %
					const audioPacketLoss = audioPackets > 0 ? Math.floor(audioPacketsLost / audioPackets * 100) : 100;
					const videoPacketLoss = videoPackets > 0 ? Math.floor(videoPacketsLost / videoPackets * 100) : 100;
					const totalPacketLoss = totalPackets > 0 ? Math.floor(totalPacketsLost / totalPackets * 100) : 100;
	
					this.audioPacketLoss.set(p.id, audioPacketLoss);
					this.videoPacketLoss.set(p.id, videoPacketLoss);
					this.packetLoss.set(p.id, totalPacketLoss);
	
					// --- Update totals
					this.bandwidthDownload = totalAudioBandwidth + totalVideoBandwidth;
					this.bandwidthUpload = bandwidthUpload;
					this.videoBandwidth.set('total', totalVideoBandwidth);
					this.audioBandwidth.set('total', totalAudioBandwidth);
	
					// console.log(`[${identity}] audio loss: ${audioPacketLoss}%, video loss: ${videoPacketLoss}%, total loss: ${totalPacketLoss}%`);
					// console.log(`[${identity}] audio bandwidth: ${totalAudioBandwidth} kbps, video bandwidth: ${totalVideoBandwidth} kbps`);
					// console.log(`[${identity}] latency: ${this.latency.get(p.id)} ms`);
	
				} catch (err) {
					console.error("Error getting stats for participant", identity, err);
				}
			}

			// Re-evaluate the stalled set: any participant whose inbound
			// video bytes haven't moved for PARTICIPANT_STALL_MS gets its
			// tile hidden until data resumes. The set is only setState'd
			// when membership actually changes — avoids re-renders every
			// poll.
			//
			// Skip the recompute entirely while in audio view. Audio
			// view actively pauses every remote's video subscription
			// (ConferenceAudioParticipant.maybeAttachStream →
			// participant.pauseVideo()), so the absence of inbound
			// video bytes is BY DESIGN, not a stall. Letting the
			// recompute run during audio view would mark every peer
			// stalled within a couple of seconds and the audio→video
			// return path would then have to undo that. Whatever
			// state stalledParticipants is in at the moment of
			// entering audio view is preserved across the audio
			// session and resumed on return.
			if (this.audioOnlyView) {
				return;
			}
			const now = Date.now();
			const newStalled = new Set();
			for (const p of this.state.participants) {
				const lastTs = this.lastVideoActivity.get(p.id);
				if (lastTs && (now - lastTs) > PARTICIPANT_STALL_MS) {
					newStalled.add(p.id);
				}
			}
			const prevStalled = this.state.stalledParticipants || new Set();
			const sameSize = prevStalled.size === newStalled.size;
			let same = sameSize;
			if (sameSize) {
				for (const id of newStalled) {
					if (!prevStalled.has(id)) { same = false; break; }
				}
			}
			if (!same) {
				// [grid] stalled-set membership changed — this is the
				// SECOND input to grid sizing besides participants.
				// length (visibleParticipants = participants - stalled).
				// Log each id that transitioned so a "video tile went
				// gray" event can be traced to either:
				//   • newly added → media stopped flowing for that
				//     peer for PARTICIPANT_STALL_MS; the tile will
				//     hide and the grid recompute around fewer tiles.
				//   • newly dropped → media resumed; the tile comes
				//     back and the grid expands again.
				const _added = [];
				const _dropped = [];
				for (const id of newStalled) {
					if (!prevStalled.has(id)) _added.push(id);
				}
				for (const id of prevStalled) {
					if (!newStalled.has(id)) _dropped.push(id);
				}
				console.log('[conference] [grid] stalled set changed —',
					'visible',
					this.state.participants.length - prevStalled.size,
					'->',
					this.state.participants.length - newStalled.size,
					'+added', _added,
					'-dropped', _dropped);
				this.setState({ stalledParticipants: newStalled }, () => {
					this._dumpParticipantRoster('stalled set changed');
				});

				// Best-effort recovery for newly-stalled video streams.
				// Audio for these peers is still flowing (the user
				// confirmed audio is fine, only video stalls), so
				// the subscriber PC itself is alive; just the video
				// receiver has gone quiet. Two server-side nudges
				// are cheap and idempotent:
				//
				//   1. pauseVideo + resumeVideo — sends two
				//      `videoroom-update` requests in sequence
				//      ({video: false} then {video: true}). On Janus
				//      VideoRoom this is enough to make the server
				//      re-send a keyframe to this subscriber, which
				//      often fixes "stuck on a corrupted I-frame"
				//      after a brief network blip.
				//   2. Only one attempt per stall event, tracked in
				//      this._stallRecoveryAttempts, so a genuinely
				//      broken stream doesn't get bombarded with
				//      pause/resume cycles every second of poll.
				//      The flag clears when the participant comes
				//      back into visibleParticipants (handled in
				//      the `_dropped` loop below).
				if (!this._stallRecoveryAttempts) {
					this._stallRecoveryAttempts = new Set();
				}
				_added.forEach((pid) => {
					if (this._stallRecoveryAttempts.has(pid)) return;
					const p = this.state.participants.find((x) => x.id === pid);
					if (!p) return;
					this._stallRecoveryAttempts.add(pid);
					const _uri = (p.identity && p.identity._uri) || pid;
					console.log('[conference] [media] stall recovery — pause/resume video for', _uri);
					try {
						p.pauseVideo();
						// Small delay so the two updates don't race
						// at the server. 300 ms is well under the
						// stall window so we still get another
						// chance on the next poll if this doesn't
						// stick.
						setTimeout(() => {
							try {
								p.resumeVideo();
							} catch (e) {
								console.log('[conference] [media] resume-after-pause threw for', _uri, e && e.message);
							}
						}, 300);
					} catch (e) {
						console.log('[conference] [media] pauseVideo threw for', _uri, e && e.message);
					}
				});
				// Clear the recovery flag for anyone who recovered
				// (media started flowing again) so the next stall
				// gets a fresh attempt.
				_dropped.forEach((pid) => {
					this._stallRecoveryAttempts.delete(pid);
				});
			}
		} catch (err) {
			console.error("Error in getConnectionStats", err);
		}
	}

    onParticipantLeft(p) {
        // [grid] mirror of the join log — see onParticipantJoined.
        // Logs the remote-participant count transition so a
        // "video disappeared" event has a single grep-able marker
        // when the cause is a peer actually leaving rather than a
        // stream stall or subscription pause.
        const _prev = this.state.participants.length;
        console.log('[conference] [grid] participant left', p.identity && p.identity.uri,
            'remote-count', _prev, '->', Math.max(0, _prev - 1));

        const participants = this.state.participants.slice();

        this.latency.delete(p.id);
        this.packetLoss.delete(p.id);
        this.mediaLost.delete(p.id);
        if (this.videoCodec) this.videoCodec.delete(p.id);
        if (this.audioCodec) this.audioCodec.delete(p.id);
        if (this.lastVideoActivity) this.lastVideoActivity.delete(p.id);
        if (this.state.stalledParticipants && this.state.stalledParticipants.has(p.id)) {
            const next = new Set(this.state.stalledParticipants);
            next.delete(p.id);
            this.setState({ stalledParticipants: next });
        }
        
        //console.log(this.participantStats);
        
		if (this.participantStats[p.id]) {
			delete this.participantStats[p.id];
		}

        const idx = participants.indexOf(p);
        if (idx !== -1) {
            participants.splice(idx, 1);
            this.setState({
                participants: participants
            }, () => {
                this._dumpParticipantRoster('participant left');
            });
        }

        p.detach(true);
        // this.changeResolution();

        setTimeout(() => {
			this.exitFullScreenIfAlone();
		}, 100);

        // save=true so the leave shows up in the persisted conference
        // chat (paired with the join event from onParticipantJoined).
        // Same bridge-suppression check as onParticipantJoined — if
        // we silenced the join we silence the leave too so the chat
        // log doesn't show an unmatched "left" line for plumbing.
        if (this._isBridgeParticipant(p)) {
            console.log('[conference] [chat] suppressing bridge leave from chat log:',
                p.identity && p.identity.uri);
        } else {
            this.postChatSystemMessage(p.identity.uri + ' left', true);
        }

        // Conference recording: finalise this participant's WAV file
        // in place if one is currently active. The native side records
        // the leave timestamp into the manifest so post-processing can
        // align the truncated track against the rest of the timeline.
        if (this.state.isConferenceRecording) {
            CallRecorder.removeConferenceParticipant(p).catch(() => {});
        }
    }

    onParticipantStateChanged(oldState, newState) {
        if (newState === 'established' || newState === null) {
            this.maybeSwitchLargeVideo();
        }
    }

    onConfigureRoom(config) {
        const newState = {};
        newState.activeSpeakers = config.activeParticipants;
        this.setState(newState);

        if (config.activeParticipants.length === 0) {
            this.logEvent.info('set speakers to', ['Nobody'], config.originator);
        } else {
            const speakers = config.activeParticipants.map((p) => {return p.identity.displayName || p.identity.uri});
            this.logEvent.info('set speakers to', speakers, config.originator);
        }
        this.maybeSwitchLargeVideo();
    }

    onFileSharing(files) {
        let stateFiles = this.state.sharedFiles;
        stateFiles = stateFiles.concat(files);
        this.setState({sharedFiles: stateFiles});
        this.listSharedFiles();
    }

    onVideoSelected(item) {
        const participants = this.state.participants.slice();
        const idx = participants.indexOf(item);
        participants.splice(idx, 1);
        participants.unshift(item);
        if (item.videoPaused) {
            item.resumeVideo();
        }
        this.setState({
            participants: participants
        });
    }

    changeResolution() {
        let stream = this.props.call.getLocalStreams()[0];
        if (this.state.participants.length < 2) {
            this.props.call.scaleLocalTrack(stream, 1.5);
        } else if (this.state.participants.length < 5) {
            this.props.call.scaleLocalTrack(stream, 2);
        } else {
            this.props.call.scaleLocalTrack(stream, 1);
        }
        // sylkrtc's scaleLocalTrack calls setParameters with a fresh
        // encodings array containing only { scaleResolutionDownBy }.
        // WebRTC's setParameters takes the WHOLE encodings array (no
        // partial updates) so the call WIPES our maxBitrate cap. Re-
        // apply the cap right after so the encoder doesn't quietly
        // drift back to libwebrtc's default (~1.5–2 Mbps for 480p).
        // The setParameters inside scaleLocalTrack resolves on a
        // promise so we defer one tick to let it land first.
        setTimeout(() => {
            applyVideoEncoderParamsToPc(this.props.call && this.props.call._pc,
                                        'conference-changeResolution');
        }, 0);
    }

    selectVideo(item) {
        DEBUG('Switching video to: %o', item);
        if (item.stream) {
            this.setState({selfDisplayedLarge: true, largeVideoStream: item.stream});
        }
    }

    maybeSwitchLargeVideo() {
        // Switch the large video to another source, maybe.
        if (this.state.participants.length === 0 && !this.state.selfDisplayedLarge) {
            // none of the participants are eligible, show ourselves
            const item = {
                stream: this.props.call.getLocalStreams()[0],
                identity: this.props.call.localIdentity
            };
            this.selectVideo(item);
        } else if (this.state.selfDisplayedLarge) {
            this.setState({selfDisplayedLarge: false});
        }
    }

    handleShareOverlayEntered() {
        this.setState({shareOverlayVisible: true});
    }

    handleShareOverlayExited() {
        this.setState({shareOverlayVisible: false});
    }

    toggleMyVideo() {
        this.setState({enableMyVideo: !this.state.enableMyVideo});
    }

    // Flip the video-tile objectFit between 'cover' (fill the
    // tile, possibly cropping) and 'contain' (fit the whole
    // frame inside the tile, with letterbox bars). Mirrors
    // VideoBox.toggleAspectRatio. All matrix tiles
    // (ConferenceMatrixParticipant) and the self tile
    // (ConferenceParticipantSelf) pick up the new value via the
    // aspectRatio prop wired in the render below.
    toggleAspectRatio() {
        this.setState({
            aspectRatio: this.state.aspectRatio === 'cover' ? 'contain' : 'cover'
        });
    }

    // Dump the current participant roster + their media tracks to
    // the console, one per line, with a 1-based "N/M" index prefix
    // so a quick scan tells you both who's in the room AND where
    // they sit in the iteration order. Called from every code
    // path that can change the grid composition (participant
    // joined / left, stalled-set membership flip, viewMode
    // toggle) so a "video disappeared / appeared" event has a
    // matching snapshot of the full state right next to it.
    //
    // Order:
    //   1) local user (myself), always idx 1
    //   2) remote participants in this.state.participants order
    //
    // Each line is `[grid] N/M <uri> audio:X video:Y stalled:Y/N`.
    // The stalled flag mirrors the visibleParticipants filter so
    // you can tell from a single line whether a participant is in
    // the rendered grid right now.
    _dumpParticipantRoster(reason) {
        const remote = this.state.participants || [];
        const stalled = this.state.stalledParticipants || new Set();
        const total = remote.length + 1; // +1 for self

        // Try local stream first — failure here shouldn't block
        // dumping remotes.
        let myAudio = 0;
        let myVideo = 0;
        try {
            const local = this.props.call && this.props.call.getLocalStreams
                ? this.props.call.getLocalStreams()[0] : null;
            if (local) {
                myAudio = local.getAudioTracks().length;
                myVideo = local.getVideoTracks().length;
            }
        } catch (e) { /* best effort */ }

        const myUri = (this.props.call && this.props.call.localIdentity)
            ? this.props.call.localIdentity._uri : '(local)';

        console.log('[conference] [grid] === participants after',
            reason, '(viewMode=' + this.state.viewMode + ') ===');
        console.log('[conference] [grid]', `1/${total}`, myUri,
            'type:webrtc',
            'audio:' + myAudio, 'video:' + myVideo,
            'stalled:N',
            'self');

        const rosterShort = [];
        rosterShort.push(this._shortLabel(myUri, true));

        remote.forEach((p, i) => {
            let audio = 0, video = 0;
            try {
                const streams = p.streams;
                if (streams && streams.length > 0 && streams[0]) {
                    audio = streams[0].getAudioTracks().length;
                    video = streams[0].getVideoTracks().length;
                }
            } catch (e) { /* best effort */ }
            const uri = (p.identity && p.identity._uri) || '(unknown)';
            const dn = (p.identity && p.identity._displayName) || '';
            // Classify the participant by URI + display-name. Same
            // rules as the rest of the grid plumbing:
            //   • bridge — display name contains "bridge" or URI is
            //     under @conference. (PSTN gateway endpoint, audio
            //     only).
            //   • sip — looks like a plain SIP/PSTN user (no
            //     @sip2sip / @sylk style suffix would also fit,
            //     here we infer "sip" when there's no video track
            //     at all and it's not a bridge).
            //   • webrtc — has video, native Sylk-style endpoint.
            let pType = 'webrtc';
            if (/bridge/i.test(dn) || uri.indexOf('@conference.') > -1) {
                pType = 'bridge';
            } else if (video === 0) {
                pType = 'sip';
            }
            const isStalled = stalled.has(p.id) ? 'Y' : 'N';
            console.log('[conference] [grid]', `${i + 2}/${total}`, uri,
                'type:' + pType,
                'audio:' + audio, 'video:' + video,
                'stalled:' + isStalled);
            if (!stalled.has(p.id)) {
                rosterShort.push(this._shortLabel(uri, false));
            }
        });

        // Render the ASCII grid the UI is currently drawing so the
        // log line up with what's on screen. See _renderAsciiLayout
        // for the layout rules — they mirror getVideoLayout() and
        // the showMyself getter exactly.
        const orientation = this.state.isLandscape ? 'landscape' : 'portrait';
        const ascii = this._renderAsciiLayout(rosterShort, orientation);
        ascii.forEach((line) => console.log('[conference] [grid]', line));
    }

    // Compress a SIP URI's local-part for an ASCII grid cell.
    // "alice@sip.example.com" → "alice". The cell width is sized
    // to comfortably fit typical conference usernames (up to ~20
    // chars) so the dumped grid label matches what the user reads
    // on screen — the previous 7-char cap collapsed everything
    // longer to a single trailing `~`, which was useless for
    // matching log lines against the UI.
    //
    // Self gets a trailing `*` so the grid call-out distinguishes
    // local from remote tiles at a glance.
    _shortLabel(uri, isSelf) {
        if (!uri) return isSelf ? 'me*' : '?';
        const local = (uri.indexOf('@') > -1 ? uri.split('@')[0] : uri) || '?';
        const max = 20;
        const truncated = local.length > max
            ? local.slice(0, max - 1) + '~'
            : local;
        return isSelf ? truncated + '*' : truncated;
    }

    // ASCII rendering of the current matrix grid based on viewMode,
    // orientation, and visible participant count. Mirrors the JSX
    // tree built in render() — see getVideoLayout() for the tile
    // count → flex container/item mapping, and showMyself for when
    // self lands in the matrix vs the floating PIP.
    //
    // Returns an array of strings (one per output line) that the
    // caller logs under the `[grid]` prefix.
    //
    // Layout matrix (re-derived from getVideoLayout + showMyself):
    //
    //   audio view  → vertical participant list (all rows), one
    //                 mirror PIP floating right-middle when
    //                 enableMyVideo and the camera is live.
    //   video view, 0 visible remotes → self full-screen.
    //   video view, 1 visible remote  → self + remote side-by-side
    //                                   (portrait: 2 rows; landscape:
    //                                   2 cols). No PIP.
    //   video view, 2 visible remotes → 2 remotes side-by-side, self
    //                                   in floating PIP.
    //   video view, 3 visible remotes → 2x2 with self at idx 4.
    //   video view, 4+ visible remotes → 2x2 with the first 4 remotes,
    //                                    self in floating PIP, rest
    //                                    in side-strip thumbnails.
    _renderAsciiLayout(roster, orientation) {
        // roster[0] is self (with trailing *), roster[1..] are
        // remotes in iteration order, stalled remotes excluded.
        if (!roster || roster.length === 0) return [];
        const self = roster[0];
        const remotes = roster.slice(1);
        const out = [];
        const header = (this.state.viewMode === 'audio' ? 'AUDIO' : 'VIDEO')
            + ' view, ' + orientation
            + ', visible=' + remotes.length;
        out.push('layout — ' + header);

        // Cell width tracks the max label length (~20 chars in
        // _shortLabel + the optional self `*` suffix). Bumped from
        // 8 so usernames like "android17" or "support" land
        // legibly instead of being trimmed to a trailing tilde.
        const CW = 22;
        const rule1 = '+' + '-'.repeat(CW + 2) + '+';
        const rule2 = '+' + '-'.repeat(CW + 2) + '+' + '-'.repeat(CW + 2) + '+';

        if (this.state.viewMode === 'audio') {
            // Vertical participant list.
            out.push(rule1);
            out.push('| ' + this._cell(self, CW) + ' |');
            remotes.forEach((r) => out.push('| ' + this._cell(r, CW) + ' |'));
            out.push(rule1);
            const pipNote = this.state.enableMyVideo && this.state.videoEnabled && !this.state.videoMuted
                ? '(mirror PIP shown right-middle)'
                : '(mirror PIP hidden)';
            out.push(pipNote);
            return out;
        }

        // Video view. Tile composition mirrors the showMyself getter:
        //   1 remote → [self, remote]  (self is in the matrix)
        //   3 remote → [self, r1, r2, r3]
        //   else     → [r0, r1, r2, r3]  (self in floating PIP)
        let tiles;
        if (remotes.length === 0) {
            tiles = [self];
        } else if (remotes.length === 1) {
            tiles = [self, remotes[0]];
        } else if (remotes.length === 3) {
            tiles = [self, remotes[0], remotes[1], remotes[2]];
        } else {
            tiles = remotes.slice(0, 4);
        }

        const pipForSelf = !tiles.includes(self);

        if (tiles.length === 1) {
            out.push(rule1);
            out.push('| ' + this._cell('', CW) + ' |');
            out.push('| ' + this._cell(tiles[0], CW) + ' |');
            out.push('| ' + this._cell('', CW) + ' |');
            out.push(rule1);
        } else if (tiles.length === 2) {
            if (orientation === 'landscape') {
                // Side-by-side.
                out.push(rule2);
                out.push('| ' + this._cell(tiles[0], CW) + ' | ' + this._cell(tiles[1], CW) + ' |');
                out.push(rule2);
            } else {
                // Top / bottom.
                out.push(rule1);
                out.push('| ' + this._cell(tiles[0], CW) + ' |');
                out.push(rule1);
                out.push('| ' + this._cell(tiles[1], CW) + ' |');
                out.push(rule1);
            }
        } else {
            // 3 or 4 tiles → 2x2 in both orientations.
            const fill = (i) => tiles[i] ? this._cell(tiles[i], CW) : this._cell('-', CW);
            out.push(rule2);
            out.push('| ' + fill(0) + ' | ' + fill(1) + ' |');
            out.push(rule2);
            out.push('| ' + fill(2) + ' | ' + fill(3) + ' |');
            out.push(rule2);
        }

        // PIP note. Only the floating self-PIP is reported here — the
        // off-screen side-strip thumbnails (when remotes > 4) are not
        // captured separately because they're a fixed-position list
        // anchored on the right edge.
        if (pipForSelf) {
            const pipShown = this.state.enableMyVideo && !this.state.videoMuted;
            out.push(pipShown
                ? '(self in floating PIP: ' + self + ')'
                : '(self PIP hidden — mirror off or camera muted)');
        }
        if (remotes.length > 4) {
            out.push('(side-strip thumbnails: ' + (remotes.length - 4) + ' more remotes)');
        }
        return out;
    }

    // Floating per-participant bandwidth panel rendered at the
    // TOP-RIGHT of the conference view, just below the existing
    // "i" speedometer button. Shows one row per participant
    // (self first, remotes in the same order as the matrix
    // iteration), with their current video kbps. Remotes that
    // are stalled are flagged so the meter doesn't read as "zero
    // traffic, must be a network issue" when really we just
    // haven't received a sample recently.
    //
    // Visibility is gated on the SAME state.showUsage flag the
    // speedometer toggle uses, so a tap on the "i" / speedometer
    // chip surfaces BOTH the network speedometer AND this
    // per-participant breakdown together. Compact format so it
    // never competes with the video tiles for real estate.
    _renderBandwidthOverview() {
        const remote = this.state.participants || [];
        const stalled = this.state.stalledParticipants || new Set();

        // Always render in Mbps with one decimal (e.g. 0.2 Mbps,
        // 1.4 Mbps). The previous auto-scale between kbit/s and
        // Mbit/s made the column width jitter as the reading
        // crossed 1 Mbit/s — a fixed unit + tabular-nums keeps
        // the column aligned at all magnitudes. 1 Mbps = 1000
        // kbps (decimal megabits-per-second, what most ISPs and
        // codec settings use), distinct from 1 Mibit/s = 1024
        // kbit/s.
        const _formatBw = (kbps) => {
            if (typeof kbps !== 'number') return '–';
            if (kbps <= 0) return '0.0 Mbps';
            return (kbps / 1000).toFixed(1) + ' Mbps';
        };
        const _short = (uri) => {
            if (!uri) return '?';
            return (uri.indexOf('@') > -1 ? uri.split('@')[0] : uri);
        };

        const myUri = (this.props.call && this.props.call.localIdentity)
            ? this.props.call.localIdentity._uri : '(local)';
        const myBw = this.videoBandwidth ? this.videoBandwidth.get(this.props.call ? this.props.call.id : 'self') : undefined;

        const rows = [];
        rows.push({
            uri: myUri,
            isSelf: true,
            bw: myBw,
            // No remote RTT for self (we're the publisher, not
            // a subscriber to ourselves); latency Map only
            // contains per-participant subscriber-PC stats.
            rtt: undefined,
            // Self packet loss is also a subscriber-side concept
            // — the inbound RTCP receiver reports loss for what we
            // RECEIVED, not what others received from us. Leave
            // undefined; renders as "00%" placeholder for column
            // alignment.
            loss: undefined,
            stalled: false,
        });
        // Bridge filter — the PSTN gateway leg surfaces in
        // state.participants like any other WebRTC publisher, but
        // it's not a "user" the operator should see traffic for
        // (its bandwidth represents the aggregated phone-side
        // audio, which is misleading in a per-participant breakdown).
        // Match the same heuristic the audio-view tile builder uses:
        // display name contains "bridge" OR the URI is rooted in the
        // @conference. subdomain. AOR cross-check against the
        // sipParticipants list (bridge entries) catches the cases
        // where the display name is missing.
        const _bridgeAorPre = (uri) => {
            if (!uri) return '';
            let s = uri;
            if (s.indexOf('sip:') === 0) s = s.slice(4);
            else if (s.indexOf('sips:') === 0) s = s.slice(5);
            return s.split(';')[0];
        };
        const _sipBridgeAors = new Set();
        if (Array.isArray(this.state.sipParticipants)) {
            this.state.sipParticipants.forEach((sp) => {
                if (sp && sp.type === 'bridge') {
                    const a = _bridgeAorPre(sp.uri || '');
                    if (a) _sipBridgeAors.add(a);
                }
            });
        }
        const _isBridge = (pp) => {
            if (!pp || !pp.identity) return false;
            const _dn = pp.identity._displayName || '';
            if (/bridge/i.test(_dn)) return true;
            const _uri = pp.identity._uri || '';
            if (_uri.indexOf('@conference.') > -1) return true;
            const _aor = _bridgeAorPre(_uri);
            if (_aor && _sipBridgeAors.has(_aor)) return true;
            return false;
        };

        remote.forEach((p) => {
            if (_isBridge(p)) return; // skip PSTN gateway leg
            const bw = this.videoBandwidth ? this.videoBandwidth.get(p.id) : undefined;
            const rtt = this.latency ? this.latency.get(p.id) : undefined;
            // packetLoss Map holds the aggregate loss percentage
            // (audio + video, see getConnectionStats line ~1877).
            // Per-kind loss is in videoPacketLoss / audioPacketLoss
            // if needed separately later.
            const loss = this.packetLoss ? this.packetLoss.get(p.id) : undefined;
            rows.push({
                uri: (p.identity && p.identity._uri) || '(unknown)',
                isSelf: false,
                bw: bw,
                rtt: rtt,
                loss: loss,
                stalled: stalled.has(p.id),
            });
        });

        // Gate on state.showUsage so a single tap on the "i"
        // speedometer chip surfaces both speedometer + this panel,
        // and the close × on this panel dismisses both.
        if (!this.state.showUsage) {
            return null;
        }

        // Position resolution. If state.statsPosition is set
        // (user dragged the panel), use it as the top-left
        // anchor. Otherwise compute the default (under the
        // speedometer, right edge). Re-validate on every render
        // so an orientation change can't strand the panel off-
        // screen — same defensive clamp the PIP uses, with the
        // measured panel size (falling back to maxWidth /
        // STATS_H) so a position the user dragged to the right
        // edge isn't falsely judged off-screen and reset to
        // default on the next render.
        const _winDims = Dimensions.get('window');
        const _saved = this.state.statsPosition;
        const _measuredW = this._statsMeasuredW || this._STATS_W;
        const _measuredH = this._statsMeasuredH || this._STATS_H;
        const _valid = _saved
            && _saved.x >= 0
            && _saved.y >= 0
            && _saved.x + _measuredW <= _winDims.width
            && _saved.y + _measuredH <= _winDims.height;
        const _pos = _valid ? _saved : this._getDefaultStatsPosition();

        return (
            <View
                {...this._statsPanResponder.panHandlers}
                onLayout={(e) => {
                    // Capture the panel's actual rendered size so
                    // the drag clamp uses the real footprint
                    // instead of the conservative this._STATS_W
                    // maxWidth. Stored on instance fields rather
                    // than state so the PanResponder.onMove
                    // closure picks up the latest value without
                    // a re-render cycle. nativeEvent.layout
                    // values are in points / dp, same units the
                    // Dimensions.get('window') values use.
                    const layout = e && e.nativeEvent && e.nativeEvent.layout;
                    if (layout) {
                        this._statsMeasuredW = layout.width;
                        this._statsMeasuredH = layout.height;
                    }
                }}
                style={{
                    position: 'absolute',
                    left: _pos.x,
                    top: _pos.y,
                    zIndex: 1800,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    borderRadius: 6,
                    // Extra right padding so the rows don't run
                    // under the close button overlay.
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    paddingRight: 26,
                    // Width shrinks to content (alignSelf:
                    // 'flex-start') so the panel never extends
                    // beyond what the longest row actually needs.
                    // maxWidth caps growth. numberOfLines: 1
                    // still truncates a single oversized
                    // username inside that cap.
                    alignSelf: 'flex-start',
                    maxWidth: this._STATS_W,
                }}
            >
                {/* Close (×) button — tap dismisses the entire
                    stats panel by flipping state.showUsage off.
                    That also collapses the speedometer chip above
                    (same flag controls both). Bring everything
                    back with the "i" icon at top-right. Anchored
                    absolute to the panel's top-right corner with
                    a translucent dark backplate to read against
                    any video frame underneath. */}
                <TouchableOpacity
                    onPress={() => this.setState({showUsage: false})}
                    accessibilityRole="button"
                    accessibilityLabel="Close stats overlay"
                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                    style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        zIndex: 10,
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    <Icon name="close" size={12} color="#ffffff" />
                </TouchableOpacity>
                {(() => {
                    // Decide which columns to show by scanning all
                    // rows once. The diagnostic columns (RTT, loss)
                    // are only useful when at least one participant
                    // shows a meaningful value — otherwise they
                    // just take up width and read as "everything's
                    // fine" noise.
                    //
                    //   • RTT column shows when any non-self,
                    //     non-stalled participant's RTT > 300 ms.
                    //   • Loss column shows when any non-self,
                    //     non-stalled participant's loss > 3 %.
                    //
                    // Self is excluded because RTT/loss are
                    // subscriber-side metrics not available for the
                    // local publisher; stalled is excluded because
                    // those rows skip the diagnostic columns anyway.
                    const _showRtt = rows.some((r) =>
                        !r.isSelf && !r.stalled
                        && typeof r.rtt === 'number'
                        && r.rtt > 300);
                    const _showLoss = rows.some((r) =>
                        !r.isSelf && !r.stalled
                        && typeof r.loss === 'number'
                        && r.loss > 3);

                    // Fixed-width monospace font so the conditional
                    // columns line up cleanly across rows. Courier
                    // on iOS, monospace on Android — both ship as
                    // platform defaults.
                    const _monoFontFamily = Platform.select({
                        ios: 'Courier',
                        android: 'monospace',
                        default: 'monospace',
                    });

                    return rows.map((row, idx) => {
                        // Single-Text row (see prior commit for the
                        // flex-edge-case rationale).
                        //
                        // Bandwidth and username are always
                        // present; RTT and loss are slotted in
                        // between only when the room-wide gate
                        // above said so. Stalled rows still skip
                        // both diagnostic columns regardless of
                        // the column gates, since the values are
                        // meaningless when no bytes flow.
                        const _bwText = row.stalled ? 'stalled' : _formatBw(row.bw);
                        let _rttText = '';
                        let _lossText = '';
                        if (!row.stalled) {
                            if (_showRtt) {
                                if (row.isSelf || typeof row.rtt !== 'number') {
                                    _rttText = '000 ms';
                                } else {
                                    const ms = Math.min(Math.max(Math.round(row.rtt), 0), 999);
                                    _rttText = String(ms).padStart(3, '0') + ' ms';
                                }
                            }
                            if (_showLoss) {
                                if (row.isSelf || typeof row.loss !== 'number') {
                                    _lossText = '00%';
                                } else {
                                    const pct = Math.min(Math.max(Math.round(row.loss), 0), 99);
                                    _lossText = String(pct).padStart(2, '0') + '%';
                                }
                            }
                        }
                        const _nameText = _short(row.uri) + (row.isSelf ? ' *' : '');
                        const _parts = [_bwText];
                        if (!row.stalled && _showRtt) _parts.push(_rttText);
                        if (!row.stalled && _showLoss) _parts.push(_lossText);
                        _parts.push(_nameText);
                        const _line = _parts.join('   ');
                        return (
                            <Text
                                key={'bwrow-' + idx}
                                numberOfLines={1}
                                style={{
                                    color: row.stalled ? '#ffb74d' : '#ffffff',
                                    fontSize: 11,
                                    fontFamily: _monoFontFamily,
                                    paddingVertical: 1,
                                }}
                            >
                                {_line}
                            </Text>
                        );
                    });
                })()}
            </View>
        );
    }

    // Pad/truncate a label to a fixed character width so the ASCII
    // table columns line up. Right-pads with spaces, truncates with
    // a trailing tilde when overflow.
    _cell(text, width) {
        const s = String(text == null ? '' : text);
        if (s.length >= width) {
            return s.slice(0, Math.max(0, width - 1)) + '~';
        }
        return s + ' '.repeat(width - s.length);
    }

    // User-controlled view-mode toggle. Independent of the wire-level
    // media composition (this.props.audioOnly) — see the viewMode
    // comment in the constructor for the rationale. Used by the
    // ConferenceHeader kebab "Switch to audio/video view" item.
    /** Accept handler for the "Start your camera?" prompt
     *  (UpgradeVideoModal). User said yes — flip the view to
     *  video, which will also resume the camera track if it was
     *  suppressed. setState clears the prompt at the same time so
     *  the modal doesn't linger over the new view. */
    onCameraPromptAccept = () => {
        this.setState({cameraPromptVisible: false, cameraPromptRemoteUri: ''}, () => {
            if (this.state.viewMode === 'audio') {
                this.toggleViewMode();
            }
        });
    };

    /** Reject handler for the "Start your camera?" prompt.
     *  User chose to stay audio-only. Just hide the modal —
     *  the auto-escalate latch (_autoEscalatedToVideo) was
     *  flipped true at the time we surfaced the prompt, so we
     *  won't ask again this session. The user can still flip to
     *  video manually any time via the kebab's "Switch to video
     *  view" item. */
    onCameraPromptReject = () => {
        this.setState({cameraPromptVisible: false, cameraPromptRemoteUri: ''});
    };

    /** Accept handler for the first-time audio→video toggle preview
     *  (StartCameraPreviewModal). Camera track was already enabled
     *  in toggleViewMode before we opened the preview, so the user
     *  is already broadcasting; we just need to hide the preview
     *  and complete the view-mode flip. The latch
     *  _cameraStartPromptShown was set when the preview opened, so
     *  this re-entry into toggleViewMode skips the prompt and
     *  proceeds straight to the audio→video transition. */
    onCameraStartPreviewAccept = () => {
        this.setState({cameraStartPreviewVisible: false}, () => {
            if (this.state.viewMode === 'audio') {
                this.toggleViewMode();
            }
        });
    };

    /** Cancel handler for the same preview. User backed out — we
     *  need to undo the camera track enable we did in
     *  toggleViewMode (so remote participants stop seeing our
     *  frames) and stay in audio view. The _cameraStartPromptShown
     *  latch stays set; the user can switch via the kebab again
     *  later without re-prompting (mirrors the auto-escalate
     *  latch behaviour). */
    onCameraStartPreviewCancel = () => {
        // Hide the camera-preview AND drop the self-PIP. Muting the
        // track via _muteVideo() sets track.enabled=false, which
        // stops outbound frames going to peers — but locally the
        // RTCView in the self-PIP keeps showing live camera capture
        // (react-native-webrtc preserves local preview regardless of
        // enabled). Setting enableMyVideo:false hides the PIP
        // entirely so the user doesn't see themselves in their own
        // tile after backing out of the audio→video upgrade.
        // Don't force viewMode back to audio — the user may already
        // be in video view watching OTHER participants' video; Cancel
        // here just means "I'm not enabling MY camera", not "leave
        // video view". Let the view stay where it is.
        // Also clear _cameraStartPromptShown so a SUBSEQUENT
        // audio→video toggle (e.g. user changes their mind) re-shows
        // the preview prompt. Without this, the latch sticks and the
        // next toggle silently enables the camera.
        this._cameraStartPromptShown = false;
        this.setState({
            cameraStartPreviewVisible: false,
            enableMyVideo: false,
            videoMuted: true,
        }, () => {
            try {
                this._muteVideo && this._muteVideo();
            } catch (e) {
                // _muteVideo is the symmetric helper; if absent for
                // any reason, fall back to flipping the track
                // ourselves so we don't leave the camera live.
                try {
                    const localStream = this.props.call && this.props.call.getLocalStreams()[0];
                    if (localStream && localStream.getVideoTracks().length > 0) {
                        const track = localStream.getVideoTracks()[0];
                        track.enabled = false;
                    }
                } catch (e2) { /* best effort */ }
            }
        });
    };

    toggleViewMode() {
        const nextMode = this.state.viewMode === 'audio' ? 'video' : 'audio';

        // When leaving video view, tear down anything related to
        // fullscreen / overlay auto-hide. fullScreenTimer() itself
        // already early-returns in audio view so it won't arm a
        // NEW timer, but any timer that was armed before the
        // toggle keeps ticking and will fire mid-audio-view —
        // which would then call setState({callOverlayVisible:
        // false}) + StatusBar.setHidden(true) + Immersive.on() on
        // Android, sending the audio layout into a fullscreen
        // mode it has no business being in. Cancel the pending
        // tick here and force the overlay back to visible so the
        // audio render path's chrome stays on screen. Also undo
        // any Immersive / parent fullscreen state the video view
        // may have already applied.
        if (nextMode === 'audio') {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
            if (Platform.OS === 'android') {
                try { Immersive.off(); } catch (e) { /* best effort */ }
                if (typeof this.props.disableFullScreen === 'function') {
                    this.props.disableFullScreen();
                }
            }
            StatusBar.setHidden(false, 'fade');
            // Coming OUT of video view → reveal the mirror PIP if
            // the camera is available. The user has been seeing
            // their own camera tile in the matrix the whole time
            // they were in video view; suddenly dropping it on
            // switch to audio reads as "where did I go?". Show the
            // PIP so they can see their own preview continues. If
            // they didn't want it, the kebab's "Hide mirror" item
            // still toggles it off. (For a user who pressed the
            // Audio button at start AND never visited video view,
            // enableMyVideo stays false per the constructor — this
            // path doesn't fire.)
            // Only auto-restore the self-PIP (enableMyVideo:true) if
            // the user actually has the camera live. After Cancel-ing
            // the audio→video preview the user explicitly said they
            // don't want their camera on; a force-enable here would
            // pop the PIP back up the moment they re-entered audio
            // view, contradicting the Cancel. Track `videoMuted` —
            // if it's true the camera is off (Cancel or Stop-video)
            // and the PIP should stay hidden until the user re-arms
            // video explicitly.
            const _autoShowPip = !this.state.videoMuted;
            this.setState({
                viewMode: nextMode,
                callOverlayVisible: true,
                enableMyVideo: _autoShowPip ? true : this.state.enableMyVideo,
            }, () => {
                this._dumpParticipantRoster('view → audio');
            });
            return;
        }

        // If the user explicitly stopped video earlier in this
        // session (Stop video / Mute Camera kebab item), DO NOT
        // touch the camera track on a view switch. The user has
        // already expressed a preference — flipping back to video
        // view should just change the LAYOUT, not silently turn
        // their camera back on. They re-arm video manually via the
        // "Start video" item in the Video... kebab submenu, which
        // clears _userExplicitlyStoppedVideo.
        //
        // Same gate also suppresses the first-time preview prompt
        // — the user has already seen and committed to a video
        // state by virtue of having stopped it, so re-prompting
        // them would be noise.
        if (this._userExplicitlyStoppedVideo) {
            this.setState({
                viewMode: nextMode,
                enableMyVideo: true,
            }, () => {
                this._dumpParticipantRoster('view → video (camera stays off, user-stopped)');
            });
            return;
        }

        // First-time confirmation gate for the audio→video toggle.
        // Surface a full-screen camera preview overlay (same visual
        // shape as the audio call's "Enable your camera?" upgrade
        // prompt in Call.js) instead of just flipping the track.
        // The preview wants real frames, so we enable the video
        // track here BEFORE showing — on Cancel we re-disable it
        // and stay in audio view; on Start the toggle proceeds.
        // Once shown (regardless of which button the user picks),
        // the per-session latch suppresses re-prompting on later
        // toggles. Skipped when the auto-escalate prompt already
        // ran this session.
        // First-time preview modal removed — the user reported that
        // the audio→video tap required two clicks (the first showed
        // the preview modal + logged "Resume camera", the second
        // actually committed the view switch). Flipping the camera
        // track AND the view in one step makes the formation a true
        // single-tap action. Re-introduce a preview modal here
        // (gated on _cameraStartPromptShown) if the confirmation UX
        // is needed back.
        if (this.state.videoMuted) {
            this._cameraStartPromptShown = true;
            try {
                const localStream = this.props.call && this.props.call.getLocalStreams()[0];
                if (localStream && localStream.getVideoTracks().length > 0) {
                    const track = localStream.getVideoTracks()[0];
                    if (track.enabled !== true) {
                        console.log('Resume camera');
                        track.enabled = true;
                    }
                }
            } catch (e) { /* best effort */ }
            this.setState({
                videoMuted: false,
                viewMode: nextMode,
                enableMyVideo: true,
                callOverlayVisible: true,
            }, () => {
                this._dumpParticipantRoster('view → video (one-tap, no preview)');
            });
            return;
        }

        // Switching to video view = "I want to show video now".
        // If the camera track is currently suppressed — either
        // because the user pressed the Audio button at start
        // (state.videoMuted seeded true from props.audioOnly),
        // or because they hit Mute Camera in the audio-view PIP /
        // picker — flip the track live so the video view actually
        // shows frames. Without this, the local self-PIP renders
        // black and other participants see the user's tile as
        // black too, which is exactly the "switched to video view
        // and no video appeared" symptom: the track was still
        // enabled=false from the audio-button start. Reset
        // videoMutedbyUser as well so the inFocus background/
        // foreground cycle can keep the camera live without a
        // second explicit unmute.
        if (this.state.videoMuted) {
            this._resumeVideo();
        }

        // Stall accounting on audio→video transition.
        //
        // While in audio view, ConferenceAudioParticipant called
        // participant.pauseVideo() on every remote — the SERVER
        // stopped forwarding video to us (correct, saves
        // bandwidth). lastVideoActivity didn't tick for any
        // participant for the entire audio-view session, so if we
        // recompute the stall set on return, every remote looks
        // stalled even though their server-side feed is fine.
        //
        // Fix: refresh lastVideoActivity to "now" ONLY for
        // participants NOT currently in stalledParticipants —
        // i.e., the ones that WERE flowing fine before audio
        // view started. That gives them a fresh stall window
        // post-return. Participants already in stalledParticipants
        // stay there, with their old (pre-audio-view) lastVideo
        // Activity untouched; the only way they leave the stalled
        // set is if real video bytes arrive (getConnectionStats
        // updates lastVideoActivity inside the inbound-rtp diff
        // branch). This preserves "this peer was already broken"
        // state across the round trip — the user's expectation
        // is that a stalled tile stays stalled until media
        // genuinely resumes, not that a view-toggle whitewashes
        // the diagnostic.
        if (this.lastVideoActivity) {
            const _now = Date.now();
            const _stalledNow = this.state.stalledParticipants || new Set();
            for (const p of this.state.participants) {
                if (_stalledNow.has(p.id)) continue;
                this.lastVideoActivity.set(p.id, _now);
            }
        }
        // Recovery-attempts tracker stays — if a stalled peer
        // already got its one pause/resume kick during audio
        // view (won't happen with the skip-during-audio guard
        // below, but defensively), don't burn another attempt
        // immediately. Clears naturally when the peer recovers.

        // Reveal the mirror in video view too. Same reasoning as
        // the video→audio direction above: the user is opting INTO
        // video, expects to see their own preview somewhere. If
        // the visible-remote count puts self in the matrix
        // (visibleCount === 1 or 3) this is a no-op for the
        // matrix tile; if self is in the floating PIP (counts 0,
        // 2, 4+), enableMyVideo=true is what makes the PIP
        // actually render. The constructor seeds enableMyVideo
        // = !audioOnly, so an Audio-button start would otherwise
        // leave enableMyVideo=false and the PIP hidden even after
        // toggling to video view — which is exactly the
        // "with 3 participants I don't see myself in video mode"
        // symptom. Hide mirror is still one tap away in the kebab.
        // Note: stalledParticipants is NOT reset here. A peer
        // that was stalled before the audio-view detour should
        // stay stalled until media actually resumes (their
        // lastVideoActivity timestamp wasn't refreshed above
        // either, so the next stall recompute keeps them in the
        // set). Refreshed peers (non-stalled at toggle time) get
        // a fresh stall window per the lastVideoActivity update
        // above and won't be re-added unless they fail to deliver
        // bytes within PARTICIPANT_STALL_MS.
        this.setState({
            viewMode: nextMode,
            videoMutedbyUser: false,
            enableMyVideo: true,
        }, () => {
            this._dumpParticipantRoster('view → video');
        });
    }

    // Single source of truth for "render the audio layout".
    // Render-time consumers should ask THIS, not props.audioOnly,
    // so the layout follows the user's preference rather than how
    // the call was negotiated. props.audioOnly stays as the wire-
    // level "is there a video track" signal for code that needs to
    // know what's actually being sent.
    get audioOnlyView() {
        return this.state.viewMode === 'audio';
    }

    handleActiveSpeakerSelected(participant, secondVideo=false) {      // eslint-disable-line space-infix-ops
        let newActiveSpeakers = this.state.activeSpeakers.slice();
        if (secondVideo) {
            if (participant.id !== 'none') {
                if (newActiveSpeakers.length >= 1) {
                    newActiveSpeakers[1] = participant;
                } else {
                    newActiveSpeakers[0] = participant;
                }
            } else {
                newActiveSpeakers.splice(1,1);
            }
        } else {
            if (participant.id !== 'none') {
                newActiveSpeakers[0] = participant;
            } else {
                newActiveSpeakers.shift();
            }
        }

        this.toggleDrawer();

        this.props.call.configureRoom(newActiveSpeakers.map((element) => element.publisherId), (error) => {
            if (error) {
                // This causes a state update, hence the drawer lists update
                this.logEvent.error('set speakers failed', [], this.localIdentity);
            }
        });
    }

    toggleSpeakerSelection() {
        this.setState({showSpeakerSelection: !this.state.showSpeakerSelection});
    }

    startSpeakerSelection(number) {
        this.selectSpeaker = number;
        this.toggleSpeakerSelection();
    }

    // Apply path used by the new SpeakerSelectionModal. The modal
    // hands us an already-ordered array of participant objects
    // (0, 1 or 2 entries) — we project them to publisherIds and ask
    // the SylkRTC call to update its pinned-speaker configuration.
    // The activeSpeakers state mirror is updated optimistically so
    // the UI doesn't have to wait for the server roomConfigured
    // event to redraw the matrix.
    applySpeakerLayout(speakers) {
        const next = Array.isArray(speakers) ? speakers.slice() : [];
        this.setState({ activeSpeakers: next });
        this.props.call.configureRoom(next.map(p => p.publisherId), (error) => {
            if (error) {
                this.logEvent.error('set speakers failed', [], this.localIdentity);
            }
        });
    }

    preventOverlay(event) {
        // Stop the overlay when we are the thumbnail bar
        event.stopPropagation();
    }

    muteAudio(event) {
        event.preventDefault();
        if (this.state.audioMuted) {
            // Log the local-side mute toggle into the conference chat
            // so the audit trail captures who muted/unmuted and when.
            // save=true persists it; the matching "remote requested"
            // event (room asked us to mute) is logged separately in
            // onMuteAudio below.
            this.postChatSystemMessage('You unmuted your microphone', true);
            this.props.toggleMute(this.props.call.id, false);
        } else {
            this.postChatSystemMessage('You muted your microphone', true);
            this.props.toggleMute(this.props.call.id, true);
        }
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

    toggleChat(event) {
        //event.preventDefault();
        if (!this.state.videoEnabled) {
            if (this.state.chatView && !this.state.audioView) {
                this.setState({audioView: !this.state.audioView});
            }
        }
        this.setState({chatView: !this.state.chatView});
    }

    toggleAudioParticipants(event) {
        //event.preventDefault();
        if (this.state.audioView && !this.state.chatView) {
            this.setState({chatView: !this.state.chatView});
        }
        this.setState({audioView: !this.state.audioView});
    }

    // Flip the audio-conference chat overlay on/off — used by the
    // navbar's chat → audio two-icon formation in ConferenceHeader.
    // audioChatView=true shows the GiftedChat column below the navbar
    // and hides the participants list; false flips it back. Separate
    // from toggleAudioParticipants (which controls the audio↔video
    // layout mode at a higher level) — the two were getting confused
    // because the navbar formation onPress used to call toggleAudio
    // Participants and that toggled audioView instead of the chat
    // overlay, so tapping chat→audio appeared to do nothing.
    toggleAudioChatView() {
        this.setState({audioChatView: !this.state.audioChatView});
    }

    toggleCamera(event) {
        // Same callable-from-multiple-paths pattern as muteVideo —
        // the picker / audio-mode PIP overlay call this without an
        // event arg; the action-bar IconButton (when video view's
        // bar was used) passed a synthetic event. Guard
        // preventDefault for the no-event path.
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            // Keep cameraFacing in sync so the self-PIP and large
            // self-view stop mirroring when the back camera is on.
            this.setState({
                cameraFacing: this.state.cameraFacing === 'front' ? 'back' : 'front'
            });
        }
    }

    // Default top-left coords for the stats panel — converted
    // from the original top + right anchor so PanResponder's
    // delta-based math works in the same coord system once the
    // user starts dragging. Position: just below the speedometer
    // chip on the right edge of the screen. Uses measured panel
    // width when available so the right-edge anchor lands at the
    // ACTUAL right edge instead of where a 320-px maxWidth
    // would have placed it.
    _getDefaultStatsPosition() {
        const { width } = Dimensions.get('window');
        const topInset = (this.state.insets && this.state.insets.top) || 0;
        const rightInset = (this.state.insets && this.state.insets.right) || 0;
        const SPEEDOMETER_TOP = topInset + 12;
        const SPEEDOMETER_HEIGHT_EXPANDED = 96;
        const top = SPEEDOMETER_TOP + SPEEDOMETER_HEIGHT_EXPANDED + 6;
        const _w = this._statsMeasuredW || this._STATS_W;
        const x = Math.max(0, width - _w - rightInset - 4);
        return { x, y: top };
    }

    // Resolve the default top-left for the audio-view self-PIP.
    // Anchors to the RIGHT edge of the screen (16px margin) at
    // the vertical middle so the thumbnail doesn't compete with
    // the chat input bar at the bottom or the conference header
    // at the top. The user can drag it anywhere afterwards;
    // pipPosition state then takes over.
    _getDefaultPipPosition() {
        // Default position: TOP-RIGHT, just under the navbar.
        // Walked back from "right-edge, vertically centered" — the
        // PIP now starts where most users expect it to (out of the
        // way at the top-right) and can be dragged anywhere from
        // there. topOffset accounts for the safe-area inset plus
        // the conference navbar (60 dp) plus a small breathing gap.
        const { width } = Dimensions.get('window');
        const topInset = (this.state.insets && this.state.insets.top) || 0;
        const topOffset = topInset + conferenceHeaderHeight + 8;
        return {
            x: Math.max(0, width - this._PIP_W - 16),
            y: Math.max(0, topOffset),
        };
    }

    selectCamera(facing) {
        // Picker-driven camera selection — mirrors VideoBox.selectCamera.
        // If video is currently muted, picking a camera should ALSO
        // unmute (that's the only way out of the muted state from the
        // picker because the Mute Camera row hides itself when muted).
        if (this.state.videoMuted) {
            this._resumeVideo();
            this.setState({videoMutedbyUser: false});
        }
        if (facing === this.state.cameraFacing) {
            return;
        }
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            this.setState({cameraFacing: facing});
        }
    }

    renderVideoPicker(buttonSize, buttonClass) {
        // Floating camera-action panel — same shape as
        // VideoBox.renderVideoPicker so a user moving between a 1:1
        // video call and a video conference encounters the same menu.
        // Items:
        //   • Front Camera / Back Camera (whichever isn't currently
        //     selected; both shown when muted so the user can pick
        //     which camera to unmute into).
        //   • Mute Camera (hidden when already muted — only path back
        //     is to pick a camera).
        //
        // Hide/Show Myself, Swap Video, and Aspect Ratio from
        // VideoBox are intentionally NOT exposed here:
        //   • Hide Myself in a 1:1 call just toggles the local PIP
        //     thumbnail. In a conference it conflates with grid
        //     placement (am I in the active-speaker tiles? in the
        //     PIP? in neither?) — the affordance reads as something
        //     different than the user expects, and the existing
        //     toggleMyVideo state is consumed by the conference's
        //     own visibility logic (showMyself / grid sizing), not
        //     a simple show/hide.
        //   • Swap Video / Aspect Ratio operate on a fixed
        //     remote/self pair, which a server-driven active-
        //     speaker grid doesn't have.
        const facing = this.state.cameraFacing || 'front';
        const muted = this.state.videoMuted;
        // Stable `video` glyph on the call-bar button — see the
        // matching note in VideoBox.js. The picker rows below
        // still use distinct camera-front / camera-rear icons.
        const mainIcon = 'video';

        const cameraOptions = [
            {key: 'front', icon: 'camera-front', label: 'Front Camera', facing: 'front'},
            {key: 'back',  icon: 'camera-rear',  label: 'Back Camera',  facing: 'back'}
        ]
            .filter(opt => muted || opt.facing !== facing)
            .map(opt => ({
                key: opt.key,
                icon: opt.icon,
                label: opt.label,
                onPress: () => this.selectCamera(opt.facing)
            }));

        const items = [
            ...cameraOptions,
            ...(muted ? [{
                // Symmetric "Start video" entry while muted.
                // Re-uses _resumeVideo (the existing helper that
                // flips state.videoMuted + re-enables the local
                // track). Also clears videoMutedbyUser so a
                // future inFocus transition doesn't auto-mute the
                // track again. See the matching rename + add in
                // VideoBox.js / LocalMedia.js.
                //
                // Side effect: if the self-PIP ("mirror") is
                // currently hidden, force it back on as part of
                // re-enabling video. Same UX rationale as in
                // VideoBox.toggleVideoMute — a user who stopped
                // video AND hid the mirror has no on-screen
                // feedback that the camera is actually running
                // when they tap Start video. Bringing the
                // mirror back avoids the "did I really turn it
                // on?" moment; users who explicitly want the
                // mirror hidden can re-hide it after with Hide
                // mirror.
                key: 'unmute',
                icon: 'video',
                label: 'Start video',
                onPress: () => {
                    const next = {videoMutedbyUser: false};
                    if (this.state.enableMyVideo === false) {
                        next.enableMyVideo = true;
                    }
                    this.setState(next);
                    this._resumeVideo();
                    // Explicit Start video — clear the
                    // "user-explicitly-stopped" latch so future
                    // audio→video view toggles can auto-resume.
                    this._userExplicitlyStoppedVideo = false;
                }
            }] : [{
                key: 'mute',
                icon: 'video-off',
                // Renamed from "Mute Camera" → "Stop video" for
                // consistency with the other call surfaces.
                label: 'Stop video',
                // Re-uses the existing instance method that flips
                // videoMutedbyUser AND mutes the track — calling it
                // without an event arg is safe (it only does
                // preventDefault() on a truthy event).
                onPress: () => this.muteVideo()
            }]),
            // Hide / Show mirror — toggles the local self-PIP
            // (state.enableMyVideo). Matches the same row
            // VideoBox.renderVideoPicker exposes; using the
            // "mirror" verb here aligns with the kebab-menu /
            // ConferenceHeader twin item that already uses the
            // same phrasing. Eye icon flips so the row visually
            // reflects the next-action state.
            //
            // DISABLED when no remote participants are present:
            // the local self-PIP is the user's own video, and
            // hiding it / showing it is only meaningful when
            // there's a remote tile to compare with or look at
            // alongside. In an empty room there is no "other
            // view" — toggling the mirror would leave a blank
            // screen, which confuses users. Greyed out + ignore
            // taps via `disabled`; once another participant
            // joins, the row activates automatically on the
            // next render.
            (() => {
                const hasOthers = Array.isArray(this.state.participants)
                    && this.state.participants.length > 0;
                return {
                    key: 'myself',
                    icon: this.state.enableMyVideo ? 'eye-off' : 'eye',
                    label: this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror',
                    disabled: !hasOthers,
                    onPress: () => this.toggleMyVideo()
                };
            })(),
            // Aspect ratio toggle inside the camera picker —
            // matches the same row VideoBox.renderVideoPicker
            // offers. Flips the rendered objectFit on every
            // video tile between 'cover' (fill, possibly crop)
            // and 'contain' (fit whole frame, letterbox bars).
            // The camera-picker label is the short "Aspect ratio"
            // (the kebab-menu mirror item carries the verb
            // "Toggle aspect ratio" so it reads as an action).
            {
                key: 'aspect',
                icon: 'aspect-ratio',
                label: 'Aspect ratio',
                onPress: () => this.toggleAspectRatio()
            }
        ];

        // Sizing math copied from VideoBox so the row icons read at
        // the same comfortable touch size and the panel width fits
        // the longest label on a single line.
        const rowIconSize = buttonSize + 14;
        const rowFontSize = 18;
        const itemRowHeight = rowIconSize + 18;
        const iconColumnPadLeft = Math.max(10 - (rowIconSize - buttonSize) / 2, 0);
        // Longest label is "Aspect ratio" (12 chars) — sized to fit
        // every item in this picker on a single line.
        const longestLabelChars = 13;
        const panelWidth = iconColumnPadLeft
            + rowIconSize
            + 14
            + Math.ceil(longestLabelChars * rowFontSize * 0.6)
            + 12;

        // The conference action bar sits at the TOP of the screen
        // (floating buttons overlaid on the video grid), unlike
        // VideoBox where the same row anchors to the BOTTOM. Drop
        // the panel BELOW the trigger button (top: '100%' +
        // marginTop) instead of VideoBox's upward layout
        // (bottom: '100%' + marginBottom) so it expands into empty
        // space rather than colliding with the conference header
        // above it.
        // The conference action bar sits at the TOP of the screen
        // (floating buttons overlaid on the video grid), unlike
        // VideoBox where the same row anchors to the BOTTOM. Drop
        // the panel BELOW the trigger button (top: '100%' +
        // marginTop) instead of VideoBox's upward layout
        // (bottom: '100%' + marginBottom) so it expands into empty
        // space rather than colliding with the conference header
        // above it.
        return (
            <View style={[styles.buttonContainer, {position: 'relative'}]} key="videoPicker">
                {/* Tap-outside backdrop. Rendered before the panel
                    so it sits below it in z-order; its onPress
                    closes the picker. Using a generously oversized
                    box (–9999 to +9999 in every direction) instead
                    of pinning to screen Dimensions because the
                    enclosing buttonsContainer is itself absolute-
                    positioned at the top of the screen and doesn't
                    clip overflowing children — the overflow is what
                    gives the panel itself the freedom to extend
                    below the 60-px action-bar strip, and the same
                    rule lets this backdrop cover the rest of the
                    UI without needing to look up window dimensions.
                    pointerEvents stays default so it actually
                    captures the tap; the dismiss is the whole
                    point. Z-index 90 keeps it below the panel
                    (100) so a tap on a menu row hits the row
                    first. */}
                {this.state.videoPickerVisible && (
                    <TouchableWithoutFeedback
                        onPress={() => this.setState({videoPickerVisible: false})}
                    >
                        <View style={{
                            position: 'absolute',
                            top: -9999, bottom: -9999, left: -9999, right: -9999,
                            zIndex: 90,
                            backgroundColor: 'transparent'
                        }} />
                    </TouchableWithoutFeedback>
                )}
                {/* Trigger button. Wrapped in the same styles.
                    roundshape (48x48) the audio device picker
                    uses, so the two buttons have identical
                    horizontal margins in the floating call bar
                    (the user reported "different margin left of
                    audio dev compared to video dev button" before
                    this — the video trigger was inheriting the
                    IconButton's intrinsic width while the audio
                    one was pinned to 48 dp by roundshape). The
                    relative-positioned inner wrapper is preserved
                    so the muted-X overlay anchors against the
                    icon glyph's geometric center.  */}
                <View style={[styles.roundshape, {position: 'relative'}]}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon={mainIcon}
                        onPress={() => this.setState({
                            videoPickerVisible: !this.state.videoPickerVisible,
                            // Only one floating menu open at a time —
                            // collapse the audio-device picker if it
                            // happens to be visible.
                            audioDevicePickerVisible: false
                        })}
                    />
                    {muted && (
                        <View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}
                        >
                            {/* `close` is the regular-weight X
                                glyph; the previous `close-thick`
                                was a heavier stroke that drew the
                                eye away from the underlying
                                camera icon. */}
                            <Icon
                                name="close"
                                size={buttonSize + 14}
                                color="#D32F2F"
                            />
                        </View>
                    )}
                </View>
                {this.state.videoPickerVisible && (
                    <View style={{
                        position: 'absolute',
                        // Opens UPWARD now that the video conference
                        // call-bar sits at the bottom of the screen.
                        // bottom:'100%' pins the panel's bottom edge
                        // to the trigger's top edge; marginBottom
                        // adds the same 8 px gap the old downward
                        // (top:'100%' + marginTop:8) layout used.
                        bottom: '100%',
                        left: 0,
                        width: panelWidth,
                        marginBottom: 8,
                        zIndex: 100,
                        elevation: 10,
                        backgroundColor: 'rgba(34,34,34,0.92)',
                        borderRadius: 8,
                        paddingVertical: 4
                    }}>
                        {items.map(item => (
                            <TouchableOpacity
                                key={item.key}
                                /* Respect item.disabled — required so
                                   the Hide/Show mirror row goes inert
                                   in an empty conference room (no
                                   remote participants → toggling the
                                   mirror would leave nothing on
                                   screen, see the rationale where the
                                   item is constructed). disabled
                                   short-circuits both the press
                                   handler AND the visual feedback. */
                                disabled={!!item.disabled}
                                onPress={() => {
                                    if (item.disabled) return;
                                    this.setState({videoPickerVisible: false});
                                    // Defer the action a tick so the panel
                                    // closes cleanly before any state churn.
                                    setTimeout(() => item.onPress(), 50);
                                }}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    height: itemRowHeight,
                                    paddingLeft: iconColumnPadLeft,
                                    paddingRight: 12,
                                    backgroundColor: 'transparent',
                                    opacity: item.disabled ? 0.35 : 1,
                                }}
                            >
                                <Icon name={item.icon} size={rowIconSize} color="white" />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        color: 'white',
                                        marginLeft: 14,
                                        fontSize: rowFontSize
                                    }}
                                >
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>
        );
    }

    muteVideo(event) {
        // Callable from both the (now-removed) action-bar IconButton
        // (which used to pass a synthetic event) AND from the camera
        // picker's TouchableOpacity onPress handler, which calls
        // muteVideo() with no arguments. Guard preventDefault so the
        // no-event picker path doesn't crash.
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (this.state.videoMuted) {
            this._resumeVideo();
            this.setState({videoMutedbyUser: false});
            // Explicit Start video tap clears the
            // "user-explicitly-stopped" latch — subsequent view
            // toggles can auto-resume again if applicable.
            this._userExplicitlyStoppedVideo = false;
        } else {
            this.setState({videoMutedbyUser: true});
            this._muteVideo();
            // Explicit Stop video tap: arm the latch so the next
            // audio→video view toggle does NOT auto-resume the
            // camera. The user has to come back through the
            // explicit Start video kebab item.
            this._userExplicitlyStoppedVideo = true;
        }
    }

    _muteVideo() {
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            // Apply track.enabled = false whenever the track is
            // currently sending, REGARDLESS of state.videoMuted.
            // The previous guard (`if (!this.state.videoMuted)`)
            // made the constructor's componentDidMount-time
            // _muteVideo call a no-op when state.videoMuted was
            // already true (audio-button start, backgrounded
            // start) — the track stayed enabled and the
            // "muted at start" intent silently leaked live frames
            // for the duration of the call. Anchor the work on
            // the TRACK's actual state instead; the setState is
            // gated separately so we still avoid a redundant
            // re-render when state already says muted.
            if (track.enabled !== false) {
                console.log('Mute camera');
                track.enabled = false;
            }
            if (!this.state.videoMuted) {
                this.setState({videoMuted: true});
            }
        }
    }

    _resumeVideo() {
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            // Same idempotence fix as _muteVideo — anchor the
            // track-state work on the track and only setState when
            // the React state actually needs updating. Without
            // this the symmetrical bootstrap case (track somehow
            // disabled on a state.videoMuted = false render)
            // wouldn't recover.
            if (track.enabled !== true) {
                console.log('Resume camera');
                track.enabled = true;
            }
            if (this.state.videoMuted) {
                this.setState({videoMuted: false});
            }
        }
    }

    hangup(event) {
        //event.preventDefault();
        for (let participant of this.state.participants) {
            participant.detach();
        }
        this.props.hangup('user_hangup_conference');
    }

    fullScreenTimer() {
        // Audio view has no fullscreen overlay to dismiss, regardless
        // of whether the call carries video — gate on the view, not
        // the wire capability.
        if (this.audioOnlyView) {
            return;
        }

		clearTimeout(this.overlayTimer);

        if (this.state.participants.length > 0 && !this.state.chatView) {
            this.overlayTimer = setTimeout(() => {
                // Re-check the live-call gate AT FIRE TIME (not just
                // when the timer was set up). The user reported Android
                // entering Immersive while still contacting the
                // server — the original check only required
                // participants.length > 0, which is also true during
                // the establishing phase. Add an explicit
                // conferenceStarted gate so Immersive only kicks in
                // once the conference is actually live AND we're not
                // in the audio-only view.
                if (this.state.chatView) return;
                if (this.audioOnlyView) return;
                if (!this.conferenceStarted) return;
                this.setState({callOverlayVisible: false});
                StatusBar.setHidden(true, 'fade');   // hide
                if (Platform.OS === 'android') {
                    Immersive.on();
                    this.props.enableFullScreen();
                }
            }, 15000);
        }
    }

    toggleFullScreen() {
		//console.log(' --toggleFullScreen');
		if (this.state.callOverlayVisible && !this.state.chatView && !this.audioOnlyView && this.conferenceStarted) {
			this.setState({callOverlayVisible: !this.state.callOverlayVisible});
			StatusBar.setHidden(true, 'fade');   // hide
			if (Platform.OS === 'android') {
				Immersive.on();
				this.props.enableFullScreen();
			}
			
			this.fullScreenTimer();
		} else {
			this.setState({callOverlayVisible: true});
			StatusBar.setHidden(false, 'fade');   // hide
			if (Platform.OS === 'android') {
				Immersive.off();
				this.props.disableFullScreen();

			}
		}
    }

    exitFullScreenIfAlone() {
        if (this.state.participants.length > 0) {
            console.log('Still not alone');
			return;
        } 

		clearTimeout(this.overlayTimer);

		this.setState({callOverlayVisible: true});
		StatusBar.setHidden(false, 'fade');
		if (Platform.OS === 'android') {
			Immersive.off();
			this.props.disableFullScreen();
		}
    }

    toggleInviteModal() {
        this.setState({showInviteModal: !this.state.showInviteModal});
    }

    // Flip the bridge-tile visibility. The bridge is the PSTN
    // gateway; it's a real WebRTC publisher contributing to the
    // download bandwidth but most users don't want to see it as a
    // separate roster row. Hidden by default; the kebab menu exposes
    // this toggle when a bridge IS present.
    toggleBridgeVisibility() {
        this.setState({showBridge: !this.state.showBridge});
    }

    // Raise/lower the local participant's hand via sylkrtc's
    // Conference.toggleHand RPC. The server broadcasts a
    // `raisedHands` event back to every attendee (including us), and
    // onRaisedHands below reconciles state.raisedHand /
    // state.raisedHandsByPid from that list. We deliberately do NOT
    // flip state.raisedHand optimistically here — letting the server
    // round-trip drive the badge keeps every client in agreement and
    // avoids a flicker if the toggle is rejected.
    toggleRaisedHand() {
        if (!this.props.call || typeof this.props.call.toggleHand !== 'function') {
            console.log('[ConferenceBox] [conference] toggleHand not available on call');
            return;
        }
        console.log('[ConferenceBox] [conference] toggleHand requested');
        this.props.call.toggleHand();
    }

    // Mute everyone in the room except the local user. The action is
    // destructive (every other attendee's audio is cut at once), so
    // the button presents a confirmation dialog first; the actual
    // signalling only fires when the user taps "Mute all" in the
    // prompt. The sylkrtc method is Conference.muteAudioParticipants
    // (see API.md) — every participant then receives a `muteAudio`
    // event from the server.
    muteAllParticipants() {
        Alert.alert(
            'Mute all participants',
            'Are you sure you want to mute all participants?',
            [
                {text: 'Cancel', style: 'cancel'},
                {
                    text: 'Mute all',
                    style: 'destructive',
                    onPress: () => this._doMuteAllParticipants(),
                },
            ],
            {cancelable: true},
        );
    }

    // Confirmed branch of muteAllParticipants — runs only after the
    // user accepts the prompt above.
    _doMuteAllParticipants() {
        if (!this.props.call || typeof this.props.call.muteAudioParticipants !== 'function') {
            console.log('[ConferenceBox] [conference] muteAudioParticipants not available on call');
            return;
        }
        // Arm the local-suppression latch BEFORE firing the RPC. The
        // server broadcasts a muteAudio event back to every
        // participant including us; without this latch the local
        // user would self-mute on their own "Mute all" tap. The
        // latch is cleared either by the first incoming muteAudio
        // event after we set it (in onMuteAudio), or by a 5s
        // timeout safety net in case the event never lands.
        this._suppressNextMuteAudio = true;
        if (this._suppressMuteAudioTimer) clearTimeout(this._suppressMuteAudioTimer);
        this._suppressMuteAudioTimer = setTimeout(() => {
            console.log('[ConferenceBox] [conference] mute-all latch timeout — clearing without consuming');
            this._suppressNextMuteAudio = false;
            this._suppressMuteAudioTimer = null;
        }, 5000);
        console.log('[ConferenceBox] [conference] mute-all: latch armed, sending muteAudioParticipants RPC');
        this.props.call.muteAudioParticipants();
    }

    // Server-pushed raised-hands snapshot. sylkrtc emits this with
    // a payload of `{raisedHands: [Participant, ...]}` (see
    // conference.js line 823: `this.emit('raisedHands',
    // {raisedHands: this._raisedHands})`), and the `raisedHands`
    // GETTER returns just the array. We accept BOTH shapes so the
    // mount-time seed (passes the array directly) and the live event
    // (passes the wrapping object) both work.
    //
    // The snapshot is the FULL list of participants currently with a
    // raised hand, so we replace state wholesale every time rather
    // than diffing — anyone NOT in the list has either lowered their
    // hand or left the room.
    //
    // The snapshot is stored two ways:
    //   • state.raisedHandsByPid — Set of participant ids, consumed
    //     by the tile render loop so it can pass raisedHand to each
    //     ConferenceAudioParticipant element.
    //   • state.raisedHand — derived boolean for the LOCAL user,
    //     used by the top action-bar toggle and the self-tile badge.
    //     Set by comparing each participant's URI against the call's
    //     localIdentity.
    onRaisedHands(payload) {
        let _list = [];
        if (Array.isArray(payload)) {
            _list = payload;
        } else if (payload && Array.isArray(payload.raisedHands)) {
            _list = payload.raisedHands;
        }
        const byPid = new Set();
        let myHandUp = false;
        // Match the local user ONLY by session id (call.id), not by
        // URI. URI matching was a fallback but failed badly with
        // multi-device sign-in: two devices on the same SIP account
        // share a URI, so lowering on device A while device B kept
        // its hand raised left myHandUp stuck at true on device A
        // (URI of B's entry matched local URI). Session id is unique
        // per device — each one toggles independently.
        const _localId = this.props.call ? this.props.call.id : null;
        _list.forEach((p) => {
            if (p && p.id) byPid.add(p.id);
            if (_localId && p && p.id === _localId) {
                myHandUp = true;
            }
        });
        console.log('[ConferenceBox] onRaisedHands localId=' + _localId
            + ' incoming_count=' + _list.length
            + ' incoming_ids=' + JSON.stringify(Array.from(byPid))
            + ' myHandUp=' + myHandUp);
        this.setState({raisedHandsByPid: byPid, raisedHand: myHandUp});
    }

    // Server-pushed mute-audio request. sylkrtc emits this with
    // `{originator: identity}` whenever ANY participant (including
    // ourselves) triggers muteAudioParticipants. We don't need the
    // originator for the action — every recipient just mutes their
    // own mic.
    //
    // Calls this.props.toggleMute directly rather than going through
    // this.muteAudio: muteAudio's first line is event.preventDefault()
    // because it's wired straight to an IconButton onPress, so
    // calling it without an event crashes with "Cannot read property
    // 'preventDefault' of undefined". Going around it keeps
    // state.audioMuted / the bottom action-bar icon / the actual
    // track mute all in sync via the same toggleMute prop the UI
    // uses.
    onMuteAudio(payload) {
        const _origUri = (payload && payload.originator &&
            (payload.originator._uri || payload.originator.uri)) || '?';
        console.log('[ConferenceBox] [conference] onMuteAudio fired:' +
                    ' originator=' + _origUri +
                    ' latch=' + (!!this._suppressNextMuteAudio));
        // Local-suppression latch — armed in _doMuteAllParticipants
        // right before we call call.muteAudioParticipants(). The
        // server then broadcasts muteAudio to everyone INCLUDING us;
        // without this latch the local user would self-mute on their
        // own "Mute all" tap.
        if (this._suppressNextMuteAudio) {
            this._suppressNextMuteAudio = false;
            if (this._suppressMuteAudioTimer) {
                clearTimeout(this._suppressMuteAudioTimer);
                this._suppressMuteAudioTimer = null;
            }
            console.log('[ConferenceBox] [conference] muteAudio suppressed — we initiated this mute-all');
            return;
        }
        if (this.state.audioMuted) {
            console.log('[ConferenceBox] [conference] onMuteAudio: already muted, no-op');
            return;
        }
        if (this.props.call && typeof this.props.toggleMute === 'function') {
            console.log('[ConferenceBox] [conference] onMuteAudio: muting local mic');
            this.props.toggleMute(this.props.call.id, true);
            // Log the remote-initiated mute into the conference chat.
            // The originator URI was extracted at the top of this
            // method; fall back to a generic phrasing if the gateway
            // payload didn't carry it.
            const _by = _origUri && _origUri !== '?'
                ? _origUri
                : 'another participant';
            this.postChatSystemMessage('You were muted by ' + _by, true);
        }
    }

    // Server-pushed per-participant mute request. Fired by sylkrtc when
    // the gateway sends a `mute-request` event addressed at THIS WS
    // session — another attendee invoked muteParticipant(myPid, muted)
    // and the gateway routed the WebRTC branch (locally-owned session)
    // to us. We flip the local mic to match payload.muted via the same
    // toggleMute prop used by the bottom action bar, so state.audioMuted,
    // the toolbar icon, and the actual audio track all move together.
    // Idempotent — if the local mic already matches the requested state
    // we no-op (avoids redundant track-mute churn when several
    // moderators tap the same button in quick succession).
    onMuteRequest(payload) {
        const _muted = !!(payload && payload.muted);
        const _origUri = (payload && payload.originator &&
            (payload.originator._uri || payload.originator.uri)) || '?';
        console.log('[ConferenceBox] [conference] onMuteRequest fired:' +
                    ' originator=' + _origUri +
                    ' muted=' + _muted);
        if (!!this.state.audioMuted === _muted) {
            console.log('[ConferenceBox] [conference] onMuteRequest: already at requested state, no-op');
            return;
        }
        if (this.props.call && typeof this.props.toggleMute === 'function') {
            console.log('[ConferenceBox] [conference] onMuteRequest: setting local mic muted=' + _muted);
            this.props.toggleMute(this.props.call.id, _muted);
            // Persist the per-participant mute request into the
            // conference chat. Mirrors the room-wide onMuteAudio
            // log above; differentiates 'muted' vs 'unmuted' since
            // muteParticipant carries an explicit boolean (the
            // room-wide event is always "mute").
            const _by = _origUri && _origUri !== '?'
                ? _origUri
                : 'another participant';
            this.postChatSystemMessage(
                (_muted ? 'You were muted by ' : 'You were unmuted by ') + _by,
                true);
        }
    }

    toggleDrawer() {
        this.setState({callOverlayVisible: true, showDrawer: !this.state.showDrawer, showFiles: false, showSpeakerSelection: false});
        clearTimeout(this.overlayTimer);
    }

    toggleFiles() {
        this.setState({callOverlayVisible: true, showFiles: !this.state.showFiles, showDrawer: false});
        clearTimeout(this.overlayTimer);
    }

    showFiles() {
        this.setState({callOverlayVisible: true, showFiles: true, showDrawer: false});
        clearTimeout(this.overlayTimer);
    }

    async inviteParticipants(uris=[]) {
        console.log('[ConferenceBox] [conference] inviteParticipants called with uris=' + JSON.stringify(uris));
        if (uris.length === 0) {
            console.log('[ConferenceBox] [conference] inviteParticipants: no URIs, returning');
            return;
        }

        // Mirror of the 1-to-1 PSTN dial guard in App.callKeepStartCall.
        // If any invitee URI looks like a phone number AND we haven't
        // yet captured the user's own SIM number, prompt for
        // READ_PHONE_NUMBERS so future PSTN dials / invites use a
        // proper Caller ID and so billing has a number to reconcile
        // against payments. Pure SIP invitees (no phone-number form
        // in the URI) skip the prompt entirely. Helper is a no-op on
        // iOS and an early-return when a number is already on file,
        // so calling it on every invite is cheap.
        if (typeof this.props.ensurePstnCallerIdCaptured === 'function') {
            try {
                const ok = await this.props.ensurePstnCallerIdCaptured(uris);
                if (!ok) {
                    console.log('[ConferenceBox] [conference] inviteParticipants: phone permission denied, aborting invite');
                    return;
                }
            } catch (e) {
                // Never let the permission helper kill the invite —
                // worst case we proceed without a captured Caller ID.
                console.log('[ConferenceBox] [conference] inviteParticipants: ensurePstnCallerIdCaptured threw', e && e.message);
            }
        }
        // Normalise phone-number invitees by appending the local
        // SIP domain. The AB Phonebook entries arrive here as bare
        // numbers (e.g. "+1234567890") because that's what the OS
        // address book stores; the conference focus expects every
        // invitee to be a SIP URI of the form "user@domain", and
        // its SIP bridge dials the user-part as a number on the
        // PSTN side. Anything that already has an '@' is left as-is.
        const _defaultDomain = (this.props.defaultDomain
            || (this.props.call && this.props.call.account
                && typeof this.props.call.account.id === 'string'
                && this.props.call.account.id.split('@')[1])
            || '').trim().toLowerCase();
        // PSTN dialing rule: mirror what Call.js does at the
        // SIP-call boundary (~line 877) for 1-to-1 outgoing calls.
        // When the server-config `pstn.rules.replacePlus` is set
        // (typically '00') and the invitee's local part begins with
        // '+', rewrite the leading '+' to that prefix BEFORE handing
        // the URI to the conference focus. The focus's SIP bridge
        // dials the local part as a number on the PSTN side and most
        // PSTN gateways want the international-access prefix form
        // (e.g. 00 in most of Europe) rather than a literal '+'.
        // Without this, "+40…@sylk.link" reaches the gateway as
        // "+40…" and is rejected / misrouted, while the 1-to-1 dial
        // path for the same number works fine because Call.js
        // already applies the rewrite. Same rule, same place in the
        // pipeline.
        const _pstnRules = this.props.pstnRules;
        const _applyReplacePlus = (localPart) => {
            if (!_pstnRules || typeof _pstnRules.replacePlus !== 'string') {
                return localPart;
            }
            if (!localPart.startsWith('+')) {
                return localPart;
            }
            const rewritten = _pstnRules.replacePlus + localPart.substring(1);
            console.log('[ConferenceBox] [conference] [pstn] replacePlus rule applied:',
                localPart, '→', rewritten);
            return rewritten;
        };

        const _normalisedUris = uris.map((u) => {
            if (typeof u !== 'string') return u;
            const _u = u.replace(/ /g, '');
            if (!_u) return _u;
            if (_u.indexOf('@') !== -1) {
                // URI already has a domain — still rewrite the local
                // part if it starts with '+', so an invitee picked
                // from contacts as "+40…@sylk.link" gets the same
                // gateway-friendly form a fresh dial-out would.
                const atIdx = _u.indexOf('@');
                const localPart = _u.substring(0, atIdx);
                const domainPart = _u.substring(atIdx);
                return _applyReplacePlus(localPart) + domainPart;
            }
            // No domain → assume it's a phone number / dial-out
            // candidate. Append the local SIP domain so the conference
            // focus's SIP bridge can route it.
            const localRewritten = _applyReplacePlus(_u);
            if (_defaultDomain) {
                return localRewritten + '@' + _defaultDomain;
            }
            return localRewritten;
        });
        console.log('[ConferenceBox] [conference] inviteParticipants: forwarding ' + _normalisedUris.length + ' URI(s) to call.inviteParticipants (normalised='
            + JSON.stringify(_normalisedUris) + ')');
        this.props.call.inviteParticipants(_normalisedUris);
        _normalisedUris.forEach((uri) => {
            if (typeof uri !== 'string') return;
            uri = uri.replace(/ /g, '');
            if (this.props.call.localIdentity._uri === uri) {
                console.log('[ConferenceBox] [conference] inviteParticipants: skipping self uri=' + uri);
                return;
            }
            console.log('[ConferenceBox] [conference] invite started for ' + uri);
            this.postChatSystemMessage(uri + ' was invited', true);
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.props.saveParticipant(this.props.call.id, this.state.remoteUri, uri);
            this.lookupContact(uri);
            this._scheduleInviteTimeout(uri);
            // Bump the invitee's row in the contacts list: bump
            // timestamp to now and overwrite last_message preview to
            // "Conference call" so the row floats to the top with a
            // meaningful subtitle. Same row-update path saveSylkContact
            // uses, so the UI re-sort is automatic. Wired in via
            // app.js → Conference → ConferenceBox (see
            // updateContactOnConferenceInvite at app.js ~29923).
            if (typeof this.props.updateContactOnConferenceInvite === 'function') {
                this.props.updateContactOnConferenceInvite(uri);
            }
        });

        this.props.finishInvite();
        this.forceUpdate()
    }
    
    get amIspeaker() {
		return this.state.activeSpeakers.some(speaker => {
			return speaker.identity && speaker.identity._uri === this.state.accountId;
		});
	}

    // Participants whose tile should currently be visible — excludes any
    // who've gone silent for >PARTICIPANT_STALL_MS. Used by both
    // showMyself and getVideoLayout so the grid recomputes around the
    // smaller live set.
    get visibleParticipants() {
        const stalled = this.state.stalledParticipants || new Set();
        if (stalled.size === 0) return this.state.participants;
        return this.state.participants.filter(p => !stalled.has(p.id));
    }

    get showMyself() {
        if (this.state.chatView && !this.audioOnlyView) {
			return true;
        }

		// When the user has pinned one or two speakers via the
		// SpeakerSelectionModal, the intent is "I want to focus on
		// those speakers". The floating self-PIP would just steal
		// real estate from the pinned tile(s), so suppress it here
		// — unless the user IS one of the pins, in which case their
		// own video is already in the matrix and amIspeaker below
		// catches it anyway. amIspeaker is checked further down for
		// the unpinned case where self happens to land in the grid
		// as the 2nd / 4th tile.
		const stalled = this.state.stalledParticipants || new Set();
		const pinnedCount = (this.state.activeSpeakers || [])
			.filter(p => p && !stalled.has(p.id)).length;
		if (pinnedCount > 0) {
			return false;
		}

		// 1 remote → split-screen self+remote (case handled in
		// videos[]). 3 remote → 2x2 grid with self as 4th tile.
		// Either way the floating PIP is redundant.
		const visibleCount = this.visibleParticipants.length;
		if (visibleCount === 1 || visibleCount === 3) {
			return false;
		}

		if (this.amIspeaker) {
			return false;
		}

		if (!this.state.enableMyVideo) {
			return false;
		}

		if (this.state.showDrawer) {
			return false;
		}

        return !this.state.videoMuted && !this.state.chatView;
    }

	getVideoLayout() {
		// When the user has pinned speakers via the speaker-layout
		// modal, the matrix contains ONLY those pins (everyone else
		// is shunted to the off-screen side strip). Size the layout
		// to the number of pinned tiles so:
		//   • 1 pinned speaker fills the screen
		//   • 2 pinned speakers split 50/50
		// instead of inheriting a 2x2 grid sized for the full
		// participant set.
		const activeSpeakers = this.state.activeSpeakers || [];
		const stalled = this.state.stalledParticipants || new Set();
		const pinnedCount = activeSpeakers.filter(p => p && !stalled.has(p.id)).length;

		// We render a 50/50 split when there's exactly ONE remote
		// participant (us + them = 2 tiles). For 0 remotes we still
		// fill the screen with the lone tile (just us / placeholder).
		const remoteCount = this.visibleParticipants.length;
		// Effective tile count:
		//   • pinnedCount > 0 → exactly that many tiles in the matrix
		//   • 1 remote        → 2 tiles (self + remote)
		//   • otherwise       → remoteCount, capped at 4
		const count = pinnedCount > 0
			? Math.min(pinnedCount, 4)
			: (remoteCount === 1
				? 2
				: Math.min(remoteCount, 4));
		const isLandscape = this.state.isLandscape;

		let container = {};
		let item = {};

		switch (count) {
			case 1:
				container = { flexDirection: 'column', flexWrap: 'nowrap', justifyContent: 'center', alignItems: 'center' };
				item = { width: '100%', height: '100%' };
				break;
			case 2:
				if (isLandscape) {
					// 2 tiles → 2 columns
					container = { flexDirection: 'row', flexWrap: 'nowrap' };
					item = { width: '50%', height: '100%' };
				} else {
					// 2 tiles → 2 rows
					container = { flexDirection: 'column', flexWrap: 'nowrap' };
					item = { width: '100%', height: '50%' };
				}
				break;
			case 3:
			case 4:
			default:
				// Always 2x2 grid
				container = { flexDirection: 'row', flexWrap: 'wrap' };
				item = { width: '50%', height: '50%' };
				break;
		}

		return { container, item };
	}

	renderAudioDeviceButtons() {
	  return null; 
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  
	  if (!this.state.callOverlayVisible) {
		 return null;
	  }
	
	  if (!call || call.state !== 'established') {
		 return null;
	  }
	 
	  if (this.props.useInCallManger) {
		 return null;
	  }

      if (!availableAudioDevices) {
		  return null;
      }
	  
	  return (
		<View style={styles.audioDeviceContainer}>
		  {availableAudioDevices.map((device) => {
			const icon = availableAudioDevicesIconsMap[device];
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
				size={25}
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

	renderAudioDevicePicker(buttonSize, buttonClass) {
		const devices = this.state.availableAudioDevices || [];
		const selectedIcon = availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || 'phone-in-talk';

		// Variant 1: cycle through devices on tap (legacy behavior)
		if (AUDIO_DEVICE_PICKER_MODE === 'cycle') {
			return (
				<View style={styles.buttonContainer} key="audioDevice">
					<TouchableHighlight style={styles.roundshape}>
						<IconButton
							size={buttonSize}
							style={buttonClass}
							icon={selectedIcon}
							onPress={this.toggleAudioDevice}
							key="toggleAudioDevice"
						/>
					</TouchableHighlight>
				</View>
			);
		}

		// Variant 2: react-native-paper Menu (icon + device name per row)
		if (AUDIO_DEVICE_PICKER_MODE === 'menu') {
			return (
				<View style={styles.buttonContainer} key="audioDevice">
					<Menu
						visible={this.state.audioDevicePickerVisible}
						onDismiss={() => this.setState({audioDevicePickerVisible: false})}
						anchor={
							<TouchableHighlight style={styles.roundshape}>
								<IconButton
									size={buttonSize}
									style={buttonClass}
									icon={selectedIcon}
									onPress={() => this.setState({audioDevicePickerVisible: true})}
								/>
							</TouchableHighlight>
						}
					>
						{devices.map(device => {
							const isSelected = device === this.state.selectedAudioDevice;
							const deviceIcon = availableAudioDevicesIconsMap[device] || 'phone-in-talk';
							const deviceName = (utils.availableAudioDeviceNames && utils.availableAudioDeviceNames[device]) || device;
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
				</View>
			);
		}

		// Variant 3: WhatsApp-style floating icon buttons stacked ABOVE the main
		// button. Previously the picker opened DOWNWARD (top:'100%') because
		// the conference button bar sat at the top of the screen. With the
		// audio-view action bar now pinned to the bottom (mirroring
		// AudioCallBox.portraitButtonContainer), opening downward would push
		// the picker off-screen / behind the keyboard. Switched to
		// bottom:'100%' so the choices stack upward into the body area
		// instead.
		if (AUDIO_DEVICE_PICKER_MODE === 'floating') {
			const otherDevices = devices.filter(d => d !== this.state.selectedAudioDevice);
			return (
				<View style={styles.buttonContainer} key="audioDevice">
					{/* Outside-tap dismiss for the floating audio
					    picker. Mirrors the backdrop the camera picker
					    above uses: a transparent absolute-fill
					    TouchableWithoutFeedback covers the screen
					    when the picker is open; tapping anywhere
					    outside the picker rows (or the trigger
					    button) collapses the picker. Z-index 90
					    keeps the backdrop BELOW the picker rows
					    (100) so taps on the rows hit the rows
					    first. Without this the picker stayed open
					    until the user explicitly tapped the audio
					    trigger button again, which was non-obvious
					    when the picker was opened from the kebab's
					    Audio... entry. */}
					{this.state.audioDevicePickerVisible && (
					    <TouchableWithoutFeedback
					        onPress={() => this.setState({audioDevicePickerVisible: false})}
					    >
					        <View style={{
					            position: 'absolute',
					            top: -9999, bottom: -9999, left: -9999, right: -9999,
					            zIndex: 90,
					            backgroundColor: 'transparent'
					        }} />
					    </TouchableWithoutFeedback>
					)}
					{this.state.audioDevicePickerVisible && otherDevices.length > 0 && (
						<View style={{
							position: 'absolute',
							// Anchor the floating list ABOVE the
							// trigger: bottom:'100%' pins the list's
							// bottom edge to the trigger's top edge,
							// and marginBottom adds the same 4px gap
							// the old downward variant used between
							// the trigger and the first floating row.
							bottom: '100%',
							left: 0,
							right: 0,
							alignItems: 'center',
							marginBottom: 4,
							zIndex: 100,
							elevation: 10,
						}}>
							{otherDevices.map(device => (
								<TouchableHighlight key={device} style={[styles.roundshape, {marginBottom: 6}]}>
									<IconButton
										size={buttonSize}
										style={buttonClass}
										icon={availableAudioDevicesIconsMap[device] || 'phone-in-talk'}
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
							size={buttonSize}
							style={buttonClass}
							icon={selectedIcon}
							onPress={() => this.setState({audioDevicePickerVisible: !this.state.audioDevicePickerVisible})}
						/>
					</TouchableHighlight>
				</View>
			);
		}

		return null;
	}

    render() {
        if (this.props.call === null) {
            return (<View></View>);
        }

        //console.log('---- Conference box', this.state.renderMessages.length);

        let watermark;
        let renderMessages = this.state.renderMessages;
        //renderMessages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);

        renderMessages = renderMessages.sort(function(a, b) {
          if (a.createdAt < b.createdAt) {
            return 1; //nameA comes first
          }

          if (a.createdAt > b.createdAt) {
              return -1; // nameB comes first
          }

          if (a.createdAt === b.createdAt) {
              if (a.msg_id < b.msg_id) {
                return 1; //nameA comes first
              }
              if (a.msg_id > b.msg_id) {
                  return -1; // nameB comes first
              }
          }

          return 0;  // names must be equal
        });

        const largeVideoClasses = classNames({
            'animated'      : true,
            'fadeIn'        : true,
            'large'         : true,
            'mirror'        : !this.props.call.sharingScreen && !this.props.generatedVideoTrack && this.state.cameraFacing !== 'back',
            'fit'           : this.props.call.sharingScreen
        });

        let matrixClasses = classNames({
            'matrix'        : true
        });

        const containerClasses = classNames({
            'video-container': true,
            'conference': true,
            'drawer-visible': this.state.showDrawer || this.state.showFiles
        });

        const buttons = {};

        const muteButtonIcon = this.state.audioMuted ? 'microphone-off' : 'microphone';
        // muteVideoButtonIcon was removed when the standalone
        // mute-video / toggle-camera buttons were folded into the
        // unified renderVideoPicker. The picker's main glyph
        // already reflects the active camera with a red X overlay
        // for muted, so no separate icon variable is needed.
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;
        
        let unselectItem = {id: 'none', publisherId: null, identity: {uri: 'none', displayName: 'No speaker'}};

        // Populate the speaker-selection list with ONLY valid video
        // participants. A valid participant is:
        //   • NOT a bridge (PSTN gateway endpoint — display-name
        //     contains "bridge" or URI sits under @conference.).
        //     Bridges carry only audio so they can never be a
        //     speaker tile.
        //   • Has a real video track on their first stream (the
        //     previous code only checked streams.length > 0, which
        //     let audio-only participants leak into the picker).
        let speakerSelectionParticipants = [];
        this.state.participants.forEach((p) => {
            const _dn = (p.identity && p.identity._displayName) || '';
            const _uri = (p.identity && p.identity._uri) || '';
            if (/bridge/i.test(_dn) || _uri.indexOf('@conference.') > -1) {
                return;
            }
            if (!p.streams || p.streams.length === 0) {
                return;
            }
            const tracks = p.streams[0].getVideoTracks
                ? p.streams[0].getVideoTracks()
                : [];
            if (!tracks || tracks.length === 0) {
                return;
            }
            speakerSelectionParticipants.push(p);
        });

        // Real REMOTE video-participant count, captured BEFORE we
        // push myself + the synthetic "unselect" item. The gates
        // that decide whether to show the Speaker-layout button /
        // kebab item use this to ignore the synthetic entries —
        // otherwise the picker would surface even in a 1:1 video
        // call (myself + unselect = 2 items) where there's nothing
        // to pick between.
        const _remoteVideoSpeakerCount = speakerSelectionParticipants.length;
        // Log the count only when it changes — render() fires
        // dozens of times during a call, and a per-render log just
        // floods Metro with identical lines. _lastLoggedVideoCount
        // / _lastLoggedTotalCount are instance fields (initialized
        // lazily; undefined on first render so the first log
        // always fires).
        // _totalParticipants is the Janus-side roster size used as the
        // floor for the header subtitle ("you + N others"). state.
        // participants includes the PSTN bridge as a regular WebRTC
        // publisher, but the bridge is plumbing, not a person — count
        // it would inflate the user-visible total by 1 in any room
        // that has SIP callers. Filter it out the same way the audio
        // tile builder does (display name matches /bridge/i OR URI is
        // rooted in the @conference. subdomain).
        const _isBridgeForOverlay = (pp) => {
            if (!pp || !pp.identity) return false;
            const _dn = pp.identity._displayName || '';
            if (/bridge/i.test(_dn)) return true;
            const _uri = pp.identity._uri || '';
            return _uri.indexOf('@conference.') > -1;
        };
        const _totalParticipants = this.state.participants.filter((p) => !_isBridgeForOverlay(p)).length;
        if (this._lastLoggedVideoCount !== _remoteVideoSpeakerCount
            || this._lastLoggedTotalCount !== _totalParticipants) {
            console.log('[conference] video participants (remote, excluding bridges/audio-only):',
                _remoteVideoSpeakerCount,
                'total participants in state (excluding bridge):', _totalParticipants);
            this._lastLoggedVideoCount = _remoteVideoSpeakerCount;
            this._lastLoggedTotalCount = _totalParticipants;
        }

        // Count of OTHER participants for the ConferenceHeader subtitle.
        // state.participants is the Janus-side webrtc roster (excludes
        // self by construction); state.sipParticipants is the union of
        // webrtc + sip + bridge tagged by type (includes self, includes
        // the audio bridge). When the SIP-side conference-info NOTIFY
        // has landed, use it as the authoritative count (excluding the
        // bridge and self) — that's the only way a SIP-only participant
        // who was in the room before we joined gets counted. Fall back
        // to the Janus count until the first NOTIFY arrives.
        let _selfUri = null;
        try {
            _selfUri = this.props.call
                && this.props.call.localIdentity
                && this.props.call.localIdentity._uri;
        } catch (e) { /* best effort */ }
        const _stripScheme = (u) => (u || '').toString().replace(/^sips?:/, '');
        const _selfBare = _stripScheme(_selfUri);
        const _sipRoster = Array.isArray(this.state.sipParticipants)
            ? this.state.sipParticipants
            : [];
        let _otherSipCount = 0;
        for (const p of _sipRoster) {
            if (!p) continue;
            if ((p.type || '') === 'bridge') continue;
            const _puri = _stripScheme(p.uri);
            if (_selfBare && _puri === _selfBare) continue;
            _otherSipCount += 1;
        }
        // Defensive max — a transient SIP-roster glitch must not make
        // the count smaller than what Janus directly observes.
        const _otherParticipantsCount = _sipRoster.length > 0
            ? Math.max(_otherSipCount, _totalParticipants)
            : _totalParticipants;

        let myself = {id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity};

        speakerSelectionParticipants.push(myself);
        speakerSelectionParticipants.push(unselectItem);

        //console.log('----speakerSelectionParticipants', speakerSelectionParticipants);
        const floatingButtons = [];

        // The floatingButtons array drives two surfaces:
        //
        //  • the video-mode floating action bar (rendered absolute
        //    over the video grid), and
        //  • the "myself" row's extraButtons slot in the audio
        //    participant list (audio view shoves the same bar
        //    sideways into the local participant card).
        //
        // Which buttons belong in each layout follows the VIEW, not
        // the wire capability — so a video call switched to audio
        // view shouldn't carry the video picker / chat-toggle /
        // video-style hangup into the myself row (where they
        // overflow and overlap the participant list below). Use
        // _useVideoLayout for "video-style buttons" gating and
        // _useAudioLayout for "audio-style hangup" gating; both
        // collapse to the same behaviour as the previous
        // state.videoEnabled checks when the call's wire setup
        // and the user's view are aligned.
        const _useVideoLayout = this.state.videoEnabled && !this.audioOnlyView;
        const _useAudioLayout = !_useVideoLayout;

        /*
        if (!this.state.showDrawer && speakerSelectionParticipants.length > 3 && this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="selects">
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Select speaker"
                    onPress={this.toggleDrawer}
                    icon="account-tie"
                    key="select-speaker"
                />
                </TouchableHighlight>
              </View>
            );
        }
        
        */
        
        if (_useVideoLayout) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="chat">
                <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Chat"
                    onPress={this.toggleChat}
                    icon={!this.state.chatView ? "chat" : "chat-remove"} // toggle icon
                    key="toggleChat"
                />
                </TouchableHighlight>
              </View>
            );
       }

     // NOTE: the audio-view hangup button was previously pushed FIRST
     // (leftmost) here. Moved to AFTER the Mute / Invite pushes below
     // (~line 4890) per user request — "Move Hangup button more to
     // the right". With the centered floating row, pushing it last
     // puts it on the rightmost slot of the visible button group.

       if (_useAudioLayout && !this.state.isLandscape) {
            /*
               floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    title="Audio"
                    onPress={this.toggleAudioParticipants}
                    icon="account-multiple"
                    key="toggleAudio"
                />
                </TouchableHighlight>
              </View>
            );
            */
        }

        floatingButtons.push(
              <View style={styles.buttonContainer} key="Mute">
                <PulsingView active={!!this.state.audioMuted}>
                  <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Mute/unmute audio"
                onPress={this.muteAudio}
                icon={muteButtonIcon}
                key="muteAudioButton"
            />
                  </TouchableHighlight>
                </PulsingView>
              </View>
        );

        floatingButtons.push(
              <View style={styles.buttonContainer} key="InviteParticipants">
                  <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Invite participants"
                onPress={this.toggleInviteModal}
                icon="account-plus"
                key="inviteParticipantsButton"
            />
                </TouchableHighlight>
              </View>
        );

        // Conference recording button (compressed stereo mix —
        // mic L, sum of all remote participants on R, same
        // Opus-OGG / AAC m4a the 1-to-1 recorder produces so the
        // existing audio chat bubble plays it back). Only shown
        // when the native module exposes the conference API —
        // older builds without the conference-mix path linked in
        // fall through to no button rather than a tap that does
        // nothing.
        //
        // One-shot diagnostic — logs the gating result on first
        // render of this layout so it's obvious from metro.log
        // whether the button is hidden because the native module
        // is missing the conference methods (i.e. the app hasn't
        // been rebuilt since the conference-mix patch landed) vs
        // some other bug. Guard with an instance flag so we don't
        // spam on every re-render.
        if (!this._loggedConferenceAvailability) {
            this._loggedConferenceAvailability = true;
            utils.timestampedLog('[conference] [recorder] conferenceAvailable=',
                CallRecorder.conferenceAvailable(),
                ' startConference type=',
                (NativeModules.SylkCallRecorder
                    ? typeof NativeModules.SylkCallRecorder.startConference
                    : 'no-module'));
        }
        if (CallRecorder.conferenceAvailable()) {
            const recIcon = this.state.isConferenceRecording
                ? 'record-rec' : 'record';
            floatingButtons.push(
              <View style={styles.buttonContainer} key="RecordConference">
                <PulsingView active={!!this.state.isConferenceRecording}>
                  <TouchableHighlight style={styles.roundshape}>
                    <IconButton
                        size={this.state.videoEnabled ? 25 : 25}
                        style={buttonClass}
                        title={this.state.isConferenceRecording
                            ? 'Stop recording'
                            : 'Record conference'}
                        onPress={this._toggleConferenceRecording}
                        icon={recIcon}
                        key="recordConferenceButton"
                    />
                  </TouchableHighlight>
                </PulsingView>
              </View>
            );
        }

       // Audio-view hangup, pushed LAST so it lands on the right end
       // of the centered floating button row. Extra marginLeft visually
       // separates the destructive action from the Mute / Invite group
       // to its left so the user can't tap-and-end by mistake.
       if (_useAudioLayout) {
         floatingButtons.push(
            <View style={[styles.hangupButtonAudioContainer, {marginLeft: 24, marginRight: 0}]} key="leave">
            <TouchableHighlight style={styles.roundshape}>
              <IconButton
                  size={25}
                  style={[buttonClass, styles.hangupButton]}
                  title="Leave conference"
                  onPress={this.hangup}
                  icon="phone-hangup"
                  key="hangupButton"
              />
              </TouchableHighlight>
            </View>
         );
         }

        // Speaker layout — dual-person icon opens the
        // SpeakerSelectionModal (Grid / 1-Speaker / 2-Speaker tabs).
        // Same entry the kebab "Select speakers..." item provides,
        // but a single tap from the floating action bar. Only shown
        // in video layout (no matrix to pin against in audio view)
        // and only when there's at least one remote candidate.
        // Speaker-layout button: only worth showing when there are
        // at least 2 remote video candidates to choose between. The
        // previous `speakerSelectionParticipants.length > 1` check
        // was fooled by the synthetic myself + unselect entries
        // pushed onto the list.
        if (_useVideoLayout && _remoteVideoSpeakerCount > 1) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="speakers">
                <TouchableHighlight style={styles.roundshape}>
                  <IconButton
                    size={25}
                    style={buttonClass}
                    title="Speaker layout"
                    onPress={this.toggleSpeakerSelection}
                    icon="account-multiple"
                    key="speakerLayoutButton"
                  />
                </TouchableHighlight>
              </View>
            );
        }

       // Mute-video + toggle-camera have been folded into the unified
       // camera picker below — matches VideoBox.renderVideoPicker so
       // the same affordance lives on both surfaces. Items inside the
       // panel: Front Camera / Back Camera (with camera-front /
       // camera-rear icons), Stop video / Start video (the latter
       // shown only when video is muted). The MAIN button glyph
       // is a stable `video` (camcorder) icon regardless of which
       // camera is active — switching cameras used to flip the
       // button between camera-front and camera-rear, which was
       // visually noisy without conveying anything actionable. A
       // red X overlays the button while the camera is muted.
       //
       // Video picker / audio device picker / video-mode hangup
       // ALL gate on _useVideoLayout — they only appear in the
       // video layout. When the user is in audio view (even on a
       // video call), they get the audio-mode hangup added above
       // and skip these. Putting them in extraButtons of the
       // "myself" audio participant row used to overflow that row
       // and overlap the participant list below.
       if (_useVideoLayout) {
            floatingButtons.push(this.renderVideoPicker(25, buttonClass));
        }

        if (_useVideoLayout) {
            floatingButtons.push(this.renderAudioDevicePicker(25, buttonClass));
        }

     if (_useVideoLayout) {
       floatingButtons.push(
          <View style={styles.hangupButtonVideoContainer} key='leavec'>
          <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={25}
                style={[buttonClass, styles.hangupButton]}
                title="Leave conference"
                onPress={this.hangup}
                icon="phone-hangup"
                key="hangupButton"
            />
            </TouchableHighlight>
          </View>
       );
       }

        /*
        floatingButtons.push(
          <View style={styles.buttonContainer}>
              <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Share"
                onPress={this.toggleInviteModal}
                icon="share"
                key="share"
            />
            </TouchableHighlight>
          </View>
        );
        */

        /*
        floatingButtons.push(
          <View style={styles.buttonContainer}>
              <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Share"
                onPress={this.props.inviteToConferenceFunc}
                icon="account-plus"
                key="invite"
            />
            </TouchableHighlight>
          </View>
        );
        */

        if (this.props.isLandscape && !this.audioOnlyView) {
            buttons.additional = floatingButtons;
        } else {
            buttons.additional = [];
        }

        /*
        buttons.additional.push(
          <View style={styles.buttonContainer}>
          <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                disabled={true}
                title="space"
                key="spacer"
            />
            </TouchableHighlight>
          </View>
        );
        */

        /*
        floatingButtons.push(
          <View style={styles.buttonContainer}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                title="spacer"
                key="spacer"
            />
          </View>
        );
        */

        const audioParticipants = [];
        let _contact;
        let _identity;
        let participants_uris = [];
        let sessionButtons = floatingButtons;

        let callUrl = callUrl = this.state.publicUrl + "/call/" + this.state.accountId;
        const friendlyName = this.state.remoteUri ? this.state.remoteUri.split('@')[0] : '';
        const conferenceUrl = `${this.state.publicUrl}/conference/${friendlyName}`;
        const conferenceRoom = `${friendlyName}`;

        //console.log(this.state.publicUrl);
        let container = styles.container;

		let { width, height } = Dimensions.get('window');

		let mediaContainer = this.state.isLandscape ? styles.audioContainerLandscape : styles.audioContainer;
		let conferenceContainer = this.state.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
		let chatContainer = this.state.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;
		let conferenceHeader = styles.conferenceHeader;

		const topInset = this.state.insets?.top || 0;
		const bottomInset = this.state.insets?.bottom || 0;
		const leftInset = this.state.insets?.left || 0;
		const rightInset = this.state.insets?.right || 0;
		let debugBorderWidth = 0;
		
		if (this.audioOnlyView) {
			chatContainer = this.state.isLandscape ? styles.chatContainerLandscapeAudio : styles.chatContainerPortraitAudio;
		}

        if (this.audioOnlyView) {
            sessionButtons = [];
            buttons.additional = [];

            // Audio-view control buttons — chat/participants toggle,
            // audio device picker, mute, hangup. In portrait they
            // render as a horizontal bar pinned to the bottom of the
            // conferenceContainer (audioViewActionBar uses
            // marginTop:'auto' to absorb the slack above), matching
            // the screen position of AudioCallBox.portraitButtonContainer.
            // Button glyphs are sized to match the regular AudioCallBox
            // (size 34 for phone, 40 for tablet) so the two views feel
            // like the same control bar. In landscape vertical space
            // is tight, so we hand them off to ConferenceHeader via
            // buttons.bottom (the same inline-in-navbar slot the
            // video conference path already uses) and skip the
            // in-body bar entirely.
            const audioBarButtonSize = this.props.isTablet ? 40 : 34;
            const audioChatToggleButton = (
                <TouchableHighlight style={styles.roundshape} key="bar-chat-wrap">
                    <IconButton
                        size={audioBarButtonSize}
                        style={buttonClass}
                        title={this.state.audioChatView ? "Show participants" : "Show chat"}
                        onPress={() => this.setState({audioChatView: !this.state.audioChatView})}
                        icon={this.state.audioChatView ? "account-group" : "message-text"}
                        key="bar-chat"
                    />
                </TouchableHighlight>
            );
            const audioDevicePickerButton = this.renderAudioDevicePicker(audioBarButtonSize, buttonClass);
            const audioMuteButton = (
                <TouchableHighlight style={styles.roundshape} key="bar-mute-wrap">
                    <IconButton
                        size={audioBarButtonSize}
                        style={buttonClass}
                        title="Mute/unmute audio"
                        onPress={this.muteAudio}
                        icon={muteButtonIcon}
                        key="bar-mute"
                    />
                </TouchableHighlight>
            );
            const audioHangupButton = (
                <TouchableHighlight style={styles.roundshape} key="bar-hangup-wrap">
                    <IconButton
                        size={audioBarButtonSize}
                        style={[buttonClass, styles.hangupButton]}
                        title="Leave conference"
                        onPress={this.hangup}
                        icon="phone-hangup"
                        key="bar-hangup"
                    />
                </TouchableHighlight>
            );

            // Conference recording pill — visually identical to the
            // 1-to-1 AudioCallBox recording pill, rendered as an
            // overlay above the action bar (not inline within it) so
            // the bar's chat/audio/mute/hangup rhythm stays
            // unchanged. Same dimensions, same colours, same pulse
            // animation. See _renderConferenceRecordControl above
            // for the JSX — guarded on
            // CallRecorder.conferenceAvailable() so a build without
            // the native conference-mix path linked in collapses
            // the overlay to nothing.

            // Portrait action bar layout: each button sits in its own
            // flex:1/maxWidth:72 slot — same rhythm as
            // AudioCallBox.portraitButtonContainer so the four buttons
            // are evenly spaced across the bar's content width. The
            // previous layout grouped the audio picker + mute together
            // and pushed hangup over with a wide marginLeft, which
            // bunched the controls toward the centre and left uneven
            // gaps. Flat layout matches the regular audio call.
            //
            // Suppressed in the chat view (state.audioChatView) — the
            // user asked to hide the bottom bar while typing so the
            // keyboard isn't crowded by call controls. A small
            // back-to-audio button is rendered above the chat instead
            // (see the chatBackToAudioButton block further down).
            // Folded (cover-display) audio conference: drop the entire
            // action bar lower than its baseline. styles.audio
            // ViewActionBar pins to `bottom: 50` (matching the rest of
            // the app's floating bars). History on this offset:
            //   50 → 30 (user "lower 20 px")
            //   30 → 25 (user "lower 5 px")
            //   25 → 15 (user "lower 10 px")
            //   15 → 10 (user "5 px more")
            // Net: bar sits 10 px from the screen bottom in folded.
            const _audioActionBarFoldedOverride = this.props.isFolded
                ? { bottom: 10 }
                : null;
            var audioViewActionBar = (this.state.isLandscape || this.state.audioChatView) ? null : (
                <View style={[styles.audioViewActionBar, _audioActionBarFoldedOverride]}>
                    <View style={styles.audioViewActionBarButton}>
                        {audioChatToggleButton}
                    </View>
                    <View style={styles.audioViewActionBarButton}>
                        {audioDevicePickerButton}
                    </View>
                    <View style={styles.audioViewActionBarButton}>
                        {audioMuteButton}
                    </View>
                    {/* Hangup slot picks up an extra marginLeft so the
                        destructive button sits visibly to the right of
                        the safe controls — matches AudioCallBox's
                        hangupMarginLeft (30) so the two views share
                        the same "stray-tap protection" gap. */}
                    <View style={[styles.audioViewActionBarButton, {marginLeft: 30}]}>
                        {audioHangupButton}
                    </View>
                </View>
            );

            // Recording pill overlay — positioned ABOVE the audio
            // action bar at the same screen position AudioCallBox
            // uses for its 1-to-1 pill (~130 px from screen bottom
            // on phones, more on tablets). pointerEvents="box-none"
            // so the surrounding empty space doesn't intercept
            // touches meant for the audio body / participant list
            // underneath; the pill itself is fully tappable. The
            // overlay is suppressed in landscape (same as
            // audioViewActionBar above — landscape folds the
            // controls into ConferenceHeader's buttons.bottom) and
            // in the chat view (the keyboard would push the pill
            // off-screen).
            var conferenceRecordPillOverlay = null;
            if (!this.state.isLandscape && !this.state.audioChatView
                    && CallRecorder.conferenceAvailable()) {
                let pillBottom = 130;
                if (this.props.isTablet) {
                    pillBottom = 200;
                }
                conferenceRecordPillOverlay = (
                    <View
                        pointerEvents="box-none"
                        style={{
                            position: 'absolute',
                            bottom: pillBottom,
                            left: 0, right: 0,
                            alignItems: 'center',
                            zIndex: 1500,
                            elevation: 25,
                        }}>
                        {this._renderConferenceRecordControl()}
                    </View>
                );
            }

            // Top-of-list action bar — three buttons rendered ABOVE
            // the participant list in the audio view:
            //   • Raise hand   → toggles state.raisedHand, which
            //                    drives the amber hand badge on the
            //                    self tile (and eventually the
            //                    broadcast to other clients).
            //   • Mute all     → asks the room to mute every other
            //                    attendee (placeholder for the
            //                    sylkrtc/videoroom mute-all RPC).
            //   • Add          → opens the invite-participants flow.
            //                    Moved here from the self tile's
            //                    extraButtons cluster so all "room
            //                    operator" affordances sit in the
            //                    same row.
            // Hidden in the chat view to avoid crowding the keyboard;
            // also hidden in landscape where the navbar already
            // carries the equivalent affordances. The icons reuse
            // audioBarButtonSize so they match the bottom action bar
            // visually.
            // Raise / lower toggle. State communicated via icon style:
            //   • not raised → plain OUTLINED hand in dark grey, so the
            //                  glyph reads as a quiet "tap to raise"
            //                  affordance against the white button.
            //   • raised     → STACKED hand: yellow filled underneath +
            //                  black outline on top, so the icon looks
            //                  like a vivid yellow hand with a clean
            //                  black border. Matches the per-tile
            //                  avatar overlay's stacked style.
            // The stacked variant is passed to IconButton's icon prop
            // as a render function — IconButton accepts (size, color)
            // → node — which lets us render two MCI icons at the same
            // origin (the outline absolutely-positioned on top of the
            // filled).
            const raiseHandFunc = ({size}) => (
                <View style={{width: size, height: size, position: 'relative'}}>
                    <Icon name="hand-back-right" size={size} color="#FFEB3B" />
                    {/* Outline at the same size as the filled hand,
                        solid black. Earlier we tried scaling the
                        outline down to thin the strokes, but at any
                        scale below 1 the outline drifted INSIDE the
                        yellow palm instead of hugging its edge, which
                        looked worse than just leaving the outline at
                        full thickness. MaterialCommunityIcons doesn't
                        expose a stroke-width knob, so this is as thin
                        as the outline will get while still aligning
                        with the palm silhouette. */}
                    <Icon
                        name="hand-back-right-outline"
                        size={size}
                        color="#000"
                        style={{position: 'absolute', top: 0, left: 0}}
                    />
                </View>
            );
            const raiseHandIcon = this.state.raisedHand
                ? raiseHandFunc
                : 'hand-back-right-outline';
            // Colour only used by the not-raised branch (the function
            // form ignores IconButton's iconColor since it renders its
            // own icons with explicit colours).
            const raiseHandColor = '#222';
            // Hide the Raise hand toggle for small meetings — with
            // fewer than 3 WebRTC participants (self + ≥2 remotes)
            // the affordance has no audience to signal to. Counted
            // here from this.state.participants (remote WebRTC,
            // sylkrtc-managed) filtered to exclude bridge-looking
            // entries, plus 1 for the local user.
            const _webrtcRemoteCount = (this.state.participants || []).filter((p) => {
                if (!p || !p.identity) return false;
                const _dn = p.identity._displayName || '';
                if (/bridge/i.test(_dn)) return false;
                const _uri = p.identity._uri || '';
                if (_uri.indexOf('@conference.') > -1) return false;
                return true;
            }).length;
            const _webrtcTotal = _webrtcRemoteCount + 1; // +1 for self
            // Mute all + Raise hand gate — bridges are NOT real
            // participants; SIP callers are (Mute all reaches them
            // via the room-wide RPC, raised hands travel through the
            // same conference-info plumbing). Hide both affordances
            // when there's only you + 1 other person, because a
            // raised hand or mute-all is meaningless in a 1-on-1.
            const _sipRealCountForBar = (this.state.sipParticipants || [])
                .filter((sp) => sp && sp.type === 'sip').length;
            const _showMuteAll = (_webrtcTotal + _sipRealCountForBar) > 2;
            // Show the raise-hand button under the SAME criterion as
            // Mute all — both are room-scale affordances that only
            // make sense with 2+ other attendees to address.
            const _showRaiseHand = (_webrtcTotal + _sipRealCountForBar) > 2;
            // Folded (cover-display) audio conference: hide the
            // top action bar entirely. In folded mode the invite
            // button is already hidden (separate gate above),
            // mute-all is hidden when ≤ 2 participants, and the
            // remaining raise-hand button isn't worth dedicating a
            // bar row to on the cramped cover display. Suppressing
            // the whole bar also gives a clean "navbar → first
            // participant" geometry so the 10 px gap requested by
            // the user lands predictably.
            var audioListTopActionBar = (this.state.audioChatView || this.state.isLandscape || this.props.isFolded) ? null : (
                <View style={styles.audioListTopActionBar}>
                    {_showRaiseHand ? (
                    <View style={styles.audioListTopActionBarButton}>
                        <TouchableHighlight style={styles.roundshape} key="top-raisehand-wrap">
                            <IconButton
                                size={audioBarButtonSize}
                                style={buttonClass}
                                // White when not raised, yellow when
                                // raised — visible state toggle right
                                // on the button glyph. raiseHandColor
                                // is computed just above based on
                                // state.raisedHand. Both iconColor
                                // (paper v5) and color (legacy alias)
                                // are set so the tint applies whether
                                // the installed minor honours the new
                                // or legacy name.
                                iconColor={raiseHandColor}
                                color={raiseHandColor}
                                title={this.state.raisedHand ? 'Lower hand' : 'Raise hand'}
                                onPress={this.toggleRaisedHand}
                                icon={raiseHandIcon}
                                key="top-raisehand"
                            />
                        </TouchableHighlight>
                    </View>
                    ) : null}
                    {/* "Mute all" rendered as the standard round
                        microphone-off icon button with a small "All"
                        badge overlaid on the corner — mirrors the
                        avatar SIP badge style so the action reads as
                        "mute, but for everyone". Same shape as the
                        adjacent round icon buttons so the row sits
                        as a uniform set. Hidden when there are 2 or
                        fewer real participants — same gate as the
                        per-tile kick button. */}
                    {_showMuteAll ? (
                    <View style={styles.audioListTopActionBarButton}>
                        <View style={{position: 'relative'}}>
                            <TouchableHighlight style={styles.roundshape} key="top-muteall-wrap">
                                <IconButton
                                    size={audioBarButtonSize}
                                    style={buttonClass}
                                    title="Mute all participants"
                                    onPress={this.muteAllParticipants}
                                    icon="microphone-off"
                                    color="#e57373"
                                    iconColor="#e57373"
                                    key="top-muteall"
                                />
                            </TouchableHighlight>
                            <View style={styles.muteAllBadge} pointerEvents="none">
                                <Text style={styles.muteAllBadgeText}>All</Text>
                            </View>
                        </View>
                    </View>
                    ) : null}
                    {/* Add-participant button is hidden in folded
                        (cover-display) mode per user request: the
                        cover screen doesn't have room for the full
                        invite flow, and the user can re-open the
                        conference on the main display to add people. */}
                    {!this.props.isFolded ? (
                    <View style={styles.audioListTopActionBarButton}>
                        <TouchableHighlight style={styles.roundshape} key="top-invite-wrap">
                            <IconButton
                                size={audioBarButtonSize}
                                style={buttonClass}
                                title="Invite participants"
                                onPress={() => {
                                    if (typeof this.props.inviteToConferenceFunc === 'function') {
                                        this.props.inviteToConferenceFunc();
                                    } else {
                                        this.toggleInviteModal();
                                    }
                                }}
                                icon="account-plus"
                                key="top-invite"
                            />
                        </TouchableHighlight>
                    </View>
                    ) : null}
                </View>
            );

            // Standalone "back to audio" affordance removed — the
            // chat→audio transition now lives on the ConferenceHeader
            // navbar two-icon formation. No spacer needed; the chat
            // sits directly under the navbar.
            var chatBackToAudioButton = null;

            if (this.state.isLandscape) {
                // ConferenceHeader renders buttons.bottom inline in
                // the navbar's right-aligned cluster when landscape.
                // Order matches the portrait action bar so the muscle
                // memory carries over: chat-toggle, audio picker,
                // mute, hangup.
                buttons.bottom = [
                    audioChatToggleButton,
                    audioDevicePickerButton,
                    audioMuteButton,
                    audioHangupButton,
                ];
            }

            // selfTileButtons used to carry the "Invite participants"
            // (account-plus) button as an extra on the local user's
            // tile. The button has since moved to the new
            // audioListTopActionBar above the participant list (next
            // to Raise hand and Mute all), so the self tile no longer
            // owns any extra buttons. Kept as an empty array so the
            // ConferenceAudioParticipant call site stays the same.
            var selfTileButtons = [];

            // Kick-button gate: show the per-tile kick-out affordance
            // whenever there is at least one OTHER participant in the
            // room (total > 1, i.e. self + ≥1 other). Previously
            // hidden until > 2 on the theory that a 1-on-1 should be
            // ended with your own hangup button, but the affordance
            // is useful even with one other party — e.g. an invitee
            // joined the wrong room or you want to drop them without
            // hanging up the whole conference. With just yourself in
            // the room (total = 1) there's no one to kick, so the
            // button stays hidden. Total = 1 (self) + remote WebRTC
            // (excluding bridges) + SIP. The per-tile MUTE indicator
            // is left in place regardless of this gate — it's status
            // info, not an action.
            const _isBridgeForCount = (pp) => {
                if (!pp || !pp.identity) return false;
                const _dn = pp.identity._displayName || '';
                if (/bridge/i.test(_dn)) return true;
                const _uri = pp.identity._uri || '';
                return _uri.indexOf('@conference.') > -1;
            };
            const _remoteWebrtcCount = (this.state.participants || [])
                .filter((pp) => !_isBridgeForCount(pp)).length;
            const _sipCount = (this.state.sipParticipants || [])
                .filter((sp) => sp && sp.type === 'sip').length;
            const _totalParticipants = 1 + _remoteWebrtcCount + _sipCount;
            const _showKickButton = _totalParticipants > 1;

            const _sipAorPre = (uri) => {
                if (!uri) return '';
                let s = uri;
                if (s.indexOf('sip:') === 0) s = s.slice(4);
                else if (s.indexOf('sips:') === 0) s = s.slice(5);
                return s.split(';')[0];
            };
            const bridgeAors = new Set();
            this.state.sipParticipants.forEach((sp) => {
                if (sp && sp.type === 'bridge') {
                    const a = _sipAorPre(sp.uri || '');
                    if (a) bridgeAors.add(a);
                }
            });
            const bridgeWebRtcByAor = new Map();

            const _looksLikeBridge = (pp) => {
                if (!pp || !pp.identity) return false;
                const _dn = pp.identity._displayName || '';
                if (/bridge/i.test(_dn)) return true;
                const _uri = pp.identity._uri || '';
                if (_uri.indexOf('@conference.') > -1) return true;
                return false;
            };
            this.state.participants.forEach((p) => {
                const _pAor = _sipAorPre(p.identity._uri);
                if ((_pAor && bridgeAors.has(_pAor)) || _looksLikeBridge(p)) {
                    if (_pAor) bridgeWebRtcByAor.set(_pAor, p);
                    return;
                }
                _contact = this.foundContacts.get(p.identity._uri);
                // Normalize the displayed name the same way the rest
                // of the app does (contact list / nav bar). If the SIP
                // From header carried a display name, we now preserve
                // it verbatim (just trim) instead of forcing title
                // case — the remote party picked that capitalization
                // on purpose ("AG Projects", "iPhone of John"). Only
                // the URI local-part fallback gets title-cased, since
                // that's a synthetic label derived from a machine
                // identifier. foundContacts entries (set in
                // lookupContact) follow the same rule and win when
                // present.
                const _rawDn = p.identity._displayName;
                const _fallbackDn = _rawDn && _rawDn.length > 0
                    ? String(_rawDn).trim()
                    : toTitleCase(p.identity._uri.split('@')[0]);
                _identity = {uri: p.identity._uri.indexOf('@guest') > -1 ? 'From the web': p.identity._uri,
                             key: p.identity._uri,
                             displayName: (_contact && _contact.displayName) ? _contact.displayName : _fallbackDn,
                             photo: _contact ? _contact.photo: null
                            };

                participants_uris.push(p.identity._uri);

                let status = '';
                let duration = 0;

                if (p.timestamp) {
                    duration = Math.floor(new Date() - p.timestamp) / 1000;
                    if (duration > 3600) {
                        status = moment.duration(new Date() - p.timestamp).format('hh:mm:ss', {trim: false});
                    } else {
                        status = moment.duration(new Date() - p.timestamp).format('mm:ss', {trim: false});
                    }
                }
                
                //console.log('Push', p.id);
                //console.log(this.latency);
                //console.log(this.packetLoss);

                // Per-tile hangup button. Sends REFER ;method=BYE for
                // this participant via the webrtcgateway, which BYEs
                // their call leg in the focus. Skipped on the local
                // ("myself") tile — self-kick wouldn't go through
                // the same focus path and is handled by the main
                // hangup button — and on bridge tiles further below.
                const _pUri = p.identity && p.identity._uri;
                const _pDn = (_identity && _identity.displayName) || _pUri;
                // Per-participant mute indicator. Sits to the LEFT of
                // the kick button (so the destructive action stays on
                // the right edge) and reflects the muted prop —
                // microphone-off in salmon when muted, microphone in
                // white when not. No onPress: sylkrtc has no
                // per-participant mute RPC (only the room-wide
                // muteAudioParticipants), so this is purely a status
                // display. If a future API lands, wire it into the
                // onPress here without changing the layout.
                const _isPMuted = !!(p.audioMuted || p.muted);
                // Mute indicator: only rendered when the participant
                // IS muted, otherwise the slot is empty. Showing a
                // "microphone" glyph in white when not muted produced
                // an invisible icon on the semi-white button — the
                // user saw "an empty white circle" and couldn't tell
                // what it represented. With the indicator gated on
                // the muted state, an absent icon means "not muted"
                // and the user reads only the kick button (if shown)
                // on the tile.
                // Inline mute indicator that sits next to the VU
                // meter (passed as `inlineMuteButton`, not via the
                // `extraButtons` slot anymore — see ConferenceAudio
                // Participant for the description-row layout). Size
                // shrunk to 19 (~75% of the original 25 used by kick)
                // so the glyph reads as a status badge alongside the
                // meter cells without dominating the row. Salmon on
                // the dark tile background — no pill wrapper here.
                // Still only rendered when the participant is muted
                // for WebRTC (read-only status; no per-participant
                // mute RPC on the WebRTC branch).
                // Day-vs-night mic colour. The salmon (#e57373) used to
                // call out the muted state reads well on the dark tile
                // background but disappears into the light linen Day
                // tile. In Day mode we drop to a dark grey so the icon
                // still reads as muted-status against the lighter
                // backplate. Night mode keeps the original salmon.
                const _isDarkMicTheme = DarkModeManager.getTheme().isDark;
                const _mutedMicColor = _isDarkMicTheme ? '#e57373' : '#444444';
                const _webrtcMuteIndicator = (_isPMuted && _pUri && _pUri !== (this.props.call && this.props.call.localIdentity._uri)) ? (
                    <PulsingView key={`webrtc-mute-${_pUri}`} active={true}>
                        <IconButton
                            size={28}
                            style={{margin: 0, marginHorizontal: -6, padding: 0}}
                            icon="microphone-off"
                            color={_mutedMicColor}
                            iconColor={_mutedMicColor}
                        />
                    </PulsingView>
                ) : null;
                // "Self" was previously detected by URI match, but
                // joining the same account from two devices gives
                // both tiles the same URI — neither could be kicked
                // because both looked like self. Switching to
                // participant-id comparison: only the actual local
                // session (call.id) is excluded, every OTHER
                // publisher — including sibling devices on the same
                // account — gets the kick affordance.
                const _localUriCmp = this.props.call && this.props.call.localIdentity
                    ? this.props.call.localIdentity._uri : null;
                const _isNonSelf = !!p && p.id !== (this.props.call && this.props.call.id);
                // Same-account-different-session: same URI but a
                // different participant id. This is "another device
                // logged into my account is also in the room". The
                // user always wants to kick those, regardless of
                // the > 1-participant gate that hides the kick
                // button when self is alone in the room.
                const _isSameAccountSibling = _isNonSelf
                    && !!_pUri && !!_localUriCmp
                    && _pUri === _localUriCmp;
                // Close-X kick glyph in a small dark circle. The circle
                // makes the affordance read as a discrete "remove"
                // chip rather than a stray glyph floating on the
                // tile chrome. TouchableOpacity + raw Icon (instead
                // of react-native-paper's IconButton) so the
                // wrapping View can be sized exactly to the
                // circle's bounds — IconButton has internal padding
                // that would inflate the chip. hitSlop expands the
                // tap target without growing the visual.
                const _webrtcKickItem = (
                    <TouchableOpacity
                        key={`webrtc-kick-${_pUri}`}
                        style={styles.kickCircle}
                        onPress={() => this.kickParticipant(_pUri, _pDn)}
                        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                    >
                        <Icon name="close" size={11} color="#ffffff" />
                    </TouchableOpacity>
                );
                // Kick is gated by _showKickButton (total participants
                // > 2) OR by the same-account-sibling case where the
                // user always wants the affordance to disconnect
                // another device on their account in a 1-on-1.
                // Passed in as `kickButton` (NOT extraButtons) so it
                // renders as the floating top-right close-X overlay
                // on the tile — see ConferenceAudioParticipant.
                const _kickAllowed = _showKickButton || _isSameAccountSibling;
                const _webrtcKickButton = _isNonSelf && _kickAllowed
                    ? _webrtcKickItem
                    : null;

                // Per-participant total bandwidth (kbps), audio +
                // video for this PC. Rendered as a small prefix on
                // the latency line of the tile.
                const _pAudioBw = (this.audioBandwidth && this.audioBandwidth.get(p.id)) || 0;
                const _pVideoBw = (this.videoBandwidth && this.videoBandwidth.get(p.id)) || 0;
                const _pBwKbps = Math.round(_pAudioBw + _pVideoBw);
                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={p.id}
                        participant={p}
                        identity={_identity}
                        latency={this.latency.has(p.id) ? this.latency.get(p.id) : null}
                        loss={this.packetLoss.has(p.id) && duration > 10 ? this.packetLoss.get(p.id) : 0}
                        bandwidth={_pBwKbps}
                        // VU-meter level (0..1) maintained by the
                        // ~5 Hz _sampleConferenceAudioLevels sampler.
                        // The remote participant's inbound-rtp audio
                        // level is bucketed under p.id; falls back to
                        // 0 (bar dark) until WebRTC reports its first
                        // sample for this PC.
                        audioLevel={this.audioLevels.get(p.id) || 0}
                        timestamp={p.timestamp}
                        isLocal={false}
                        // Per-participant status flags. Mute still
                        // reads from the participant object (set by
                        // the server-pushed muteAudio handler / a
                        // future per-participant audioMuted field).
                        // Raised hand comes from state.raisedHandsByPid
                        // — populated by the `raisedHands` event
                        // handler from the sylkrtc Conference.toggleHand
                        // round trip — so the badge stays in sync with
                        // the server snapshot.
                        muted={!!(p.audioMuted || p.muted)}
                        raisedHand={this.state.raisedHandsByPid.has(p.id)}
                        status={status}
                        inlineMuteButton={_webrtcMuteIndicator}
                        kickButton={_webrtcKickButton}
                    />
                );
            });

            const _sipAor = _sipAorPre;
            // First-seen timestamps per SIP-participant AOR, cached on
            // the long-lived call object so durations survive remounts
            // (e.g. navigating to contacts and back). Each tile renders
            // mm:ss / hh:mm:ss since the first NOTIFY that listed it.
            if (this.props.call && !this.props.call._sipParticipantSeenAt) {
                this.props.call._sipParticipantSeenAt = new Map();
            }
            const _sipSeenAt = (this.props.call && this.props.call._sipParticipantSeenAt) || new Map();
            const _formatDuration = (sinceMs) => {
                const secs = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
                return secs >= 3600
                    ? moment.duration(secs * 1000).format('hh:mm:ss', {trim: false})
                    : moment.duration(secs * 1000).format('mm:ss', {trim: false});
            };
            var sipAudioParticipants = [];
            var sipBridgeTiles = [];
            var sipParticipantTiles = [];
            // Bridge audio level + bandwidth captured as we walk the
            // bridge tiles. The bridge is a mix of every SIP
            // participant's audio, so when there's exactly ONE SIP
            // participant the bridge and that participant are
            // effectively the same signal — surfacing the bridge
            // level AND its bandwidth on the SIP tile (with the
            // bridge tile itself hidden) is more readable than
            // showing both. Tracks the highest non-zero values seen.
            let _bridgeAudioLevel = 0;
            let _bridgeBandwidth = 0;
            // RTT + loss of the bridge's WebRTC participant. With
            // exactly one SIP caller behind the bridge, the bridge's
            // connection quality IS that caller's effective quality
            // (the SIP tile has no PC of its own, so without this
            // transfer its latency/loss columns would be empty). Set
            // to null/0 sentinels so the clone-with logic below can
            // tell when a real value was observed.
            let _bridgeLatency = null;
            let _bridgeLoss = 0;
            // First pass: stamp any URIs not yet seen with "now" so the
            // duration counter starts from this NOTIFY for new arrivals.
            this.state.sipParticipants.forEach((sp) => {
                if (!sp || (sp.type !== 'sip' && sp.type !== 'bridge')) return;
                const _aorTmp = _sipAor(sp.uri || '');
                if (!_aorTmp) return;
                if (!_sipSeenAt.has(_aorTmp)) _sipSeenAt.set(_aorTmp, Date.now());
            });
            this.state.sipParticipants.forEach((sp) => {
                if (!sp || (sp.type !== 'sip' && sp.type !== 'bridge')) return;
                const _sipUri = sp.uri || '';
                const _aor = _sipAor(_sipUri);
                if (!_aor) return;
                const isBridge = sp.type === 'bridge';
                if (!isBridge && (participants_uris.indexOf(_aor) > -1 || participants_uris.indexOf(_sipUri) > -1)) {
                    return;
                }
                let _sipDisplayName = (sp.display_name && String(sp.display_name).trim()) || toTitleCase((_aor || _sipUri).split('@')[0]);
                if (isBridge) {
                    const _pstn = this.props.conferenceSettings && this.props.conferenceSettings.pstnBridge;
                    if (_pstn) {
                        _sipDisplayName = _sipDisplayName + ' ' + _pstn;
                    }
                }
                const _sipIdentity = {
                    uri: _aor || _sipUri,
                    key: _sipUri,
                    displayName: _sipDisplayName,
                    photo: null,
                };
                let tile;
                const _sipDurationStr = _sipSeenAt.has(_aor) ? _formatDuration(_sipSeenAt.get(_aor)) : '';
                if (isBridge) {
                    const webrtcP = bridgeWebRtcByAor.get(_aor);
                    if (webrtcP) {
                        let bDuration = 0;
                        if (webrtcP.timestamp) {
                            bDuration = Math.floor(new Date() - webrtcP.timestamp) / 1000;
                        }
                        const _thisBridgeLevel = this.audioLevels.get(webrtcP.id) || 0;
                        if (_thisBridgeLevel > _bridgeAudioLevel) _bridgeAudioLevel = _thisBridgeLevel;
                        const _bAudioBw = (this.audioBandwidth && this.audioBandwidth.get(webrtcP.id)) || 0;
                        const _bVideoBw = (this.videoBandwidth && this.videoBandwidth.get(webrtcP.id)) || 0;
                        const _bBwTotal = Math.round(_bAudioBw + _bVideoBw);
                        if (_bBwTotal > _bridgeBandwidth) _bridgeBandwidth = _bBwTotal;
                        const _bLat = this.latency.has(webrtcP.id) ? this.latency.get(webrtcP.id) : null;
                        const _bLossVal = (this.packetLoss.has(webrtcP.id) && bDuration > 10) ? this.packetLoss.get(webrtcP.id) : 0;
                        if (typeof _bLat === 'number' && _bLat > 0) _bridgeLatency = _bLat;
                        if (_bLossVal > _bridgeLoss) _bridgeLoss = _bLossVal;
                        tile = (
                            <ConferenceAudioParticipant
                                key={'bridge:' + _sipUri}
                                participant={webrtcP}
                                identity={_sipIdentity}
                                isLocal={false}
                                status={_sipDurationStr}
                                bottomLabel="SIP"
                                isBridge={true}
                                latency={this.latency.has(webrtcP.id) ? this.latency.get(webrtcP.id) : null}
                                loss={this.packetLoss.has(webrtcP.id) && bDuration > 10 ? this.packetLoss.get(webrtcP.id) : 0}
                                bandwidth={_bBwTotal}
                                audioLevel={_thisBridgeLevel}
                                timestamp={webrtcP.timestamp}
                            />
                        );
                    } else {
                        tile = (
                            <ConferenceAudioParticipant
                                key={'bridge:' + _sipUri}
                                identity={_sipIdentity}
                                isLocal={false}
                                status={_sipDurationStr}
                                bottomLabel="SIP"
                                isBridge={true}
                                noAudioMetrics={true}
                                audioLevel={0}
                            />
                        );
                    }
                } else {
                    // SIP participant tile gets a hangup button. Tapping
                    // it sends videoroom-remove → REFER ;method=BYE for
                    // this participant. The bridge tile (above) is
                    // intentionally excluded — kicking the bridge would
                    // unplug the PSTN side of the room, not what the
                    // user usually wants from a per-tile control. To
                    // tear the bridge down, all WebRTC users must leave
                    // (the server-side auto-kick handles that case).
                    const _sipKickUri = _sipUri;
                    const _sipKickDn = _sipDisplayName;
                    // Endpoint list, hoisted to the top of this branch so
                    // both the mute-button setup below AND the audio-level
                    // join below can reuse it without re-declaring. Was
                    // previously declared only inside the audio-level
                    // block lower down; the mute button needs it earlier
                    // and re-declaring `const _spEndpoints` in the same
                    // lexical block would also conflict with the lower
                    // declaration once both exist.
                    const _spEndpoints = Array.isArray(sp.endpoints) ? sp.endpoints : [];
                    // Mute state lives on the ENDPOINT element of the
                    // RFC 4575 conference-info payload, not on the
                    // participant. Tolerant of multiple representations
                    // — sipsimple's BooleanProperty has shipped as a
                    // bare JS boolean in some payloads and as the
                    // string "true" / "True" in others, and the user
                    // confirmed the icon stays on the unmuted state
                    // even when the server logs muted=True. Accept any
                    // of: bool true, integer 1, string "true"/"1"
                    // (case-insensitive). False / missing fields stay
                    // unmuted.
                    const _truthyMuted = (_m) => {
                        if (_m === true || _m === 1) return true;
                        if (typeof _m === 'string') {
                            const _s = _m.trim().toLowerCase();
                            return _s === 'true' || _s === '1' || _s === 'yes';
                        }
                        return false;
                    };
                    const _isSipMuted = _spEndpoints.some(
                        (_ep) => _ep && _truthyMuted(_ep.muted));
                    // Pick the first endpoint's participant_id as the
                    // mute target. The conference focus assigns a
                    // stable per-session participant_id to every
                    // endpoint behind the bridge; in practice a SIP
                    // caller has exactly one endpoint so endpoints[0]
                    // is unambiguous. With multiple endpoints we still
                    // pick the first — same compromise used everywhere
                    // else in this loop (audio-level join key, mute
                    // indicator state).
                    let _sipMutePid = null;
                    for (const _ep of _spEndpoints) {
                        if (_ep && _ep.participant_id) {
                            _sipMutePid = _ep.participant_id;
                            break;
                        }
                    }
                    // Explicit, ALWAYS-visible clickable mute toggle for
                    // SIP-bridge participants. Microphone-off (salmon)
                    // when the focus reports the participant as muted,
                    // microphone (white) when not — both states are
                    // tappable. onPress fires the new sylkrtc
                    // muteParticipant() RPC with the inverted state,
                    // which the webrtcgateway routes to the conference
                    // focus's admin HTTP API (POST /rooms/<uri>/
                    // participants/<pid>/mute with {"muted": bool})
                    // because SIP-side participants have no local WS
                    // session to dispatch to. Suppressed only when we
                    // never learned a participant_id for this entry
                    // (the focus didn't publish one yet) — the RPC
                    // requires that field server-side.
                    // Inline mute toggle that sits next to the VU
                    // meter (passed as `inlineMuteButton` below — no
                    // pill wrapper here so the icon sits flush in the
                    // description row). Size 19 (~75% of the kick
                    // button's 25). Always rendered when we have a
                    // participant_id; clicking flips the muted state
                    // via the sylkrtc muteParticipant() RPC, which the
                    // gateway routes to the conference focus as a
                    // REFER ;method=MUTE / UNMUTE for SIP targets.
                    // White on the dark tile background for unmuted;
                    // salmon for muted so the destructive affordance
                    // stays obvious.
                    // Day-vs-night mic colour, mirroring the WebRTC
                    // mute indicator above. Muted picks dark grey on
                    // the light Day tile (instead of salmon, which
                    // gets lost on linen); unmuted picks dark grey
                    // there too (the previous solid white was
                    // invisible against the lighter backplate). Night
                    // mode keeps the legacy salmon/white pair.
                    const _isDarkSipMicTheme = DarkModeManager.getTheme().isDark;
                    const _sipMutedColor   = _isDarkSipMicTheme ? '#e57373' : '#444444';
                    const _sipUnmutedColor = _isDarkSipMicTheme ? '#ffffff' : '#444444';
                    const _sipMuteIndicator = _sipMutePid ? (
                        <PulsingView key={`sip-mute-${_sipKickUri}`} active={_isSipMuted}>
                            <IconButton
                                size={28}
                                style={{margin: 0, marginHorizontal: -6, padding: 0}}
                                icon={_isSipMuted ? 'microphone-off' : 'microphone'}
                                color={_isSipMuted ? _sipMutedColor : _sipUnmutedColor}
                                iconColor={_isSipMuted ? _sipMutedColor : _sipUnmutedColor}
                                onPress={() => {
                                    if (this.props.call
                                            && typeof this.props.call.muteParticipant === 'function') {
                                        console.log('[ConferenceBox] muteParticipant pid=' + _sipMutePid +
                                                    ' muted=' + (!_isSipMuted));
                                        this.props.call.muteParticipant(_sipMutePid, !_isSipMuted);
                                    } else {
                                        console.log('[ConferenceBox] muteParticipant not available on call');
                                    }
                                }}
                            />
                        </PulsingView>
                    ) : null;
                    // Close-X kick glyph in a small dark circle —
                    // identical treatment to the webrtc kick above.
                    // See that block for the rationale (Touchable
                    // Opacity + raw Icon to avoid IconButton's
                    // internal padding inflating the chip).
                    const _sipKickItem = (
                        <TouchableOpacity
                            key={`sip-kick-${_sipKickUri}`}
                            style={styles.kickCircle}
                            onPress={() => this.kickParticipant(_sipKickUri, _sipKickDn)}
                            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                        >
                            <Icon name="close" size={11} color="#ffffff" />
                        </TouchableOpacity>
                    );
                    // Kick still gated by _showKickButton (total > 2).
                    // Passed in as `kickButton` (not extraButtons).
                    const _sipKickButton = _showKickButton ? _sipKickItem : null;

                    // Per-SIP-participant VU meter level.
                    // sipConferenceAudioLevels (every ~250ms from the
                    // webrtcgateway, populated into state.sipAudioLevels
                    // — see the handler at line ~900) carries an entry
                    // per participant_id with {tx, rx, tx_peak, rx_peak}
                    // on the Janus 0..127 audio-bridge scale. Each SIP
                    // participant `sp` carries one or more `endpoints`,
                    // each with its own participant_id; in practice a
                    // SIP caller has one endpoint so endpoints[0].
                    // participant_id is the join key. We take the
                    // strongest rx_peak across endpoints (the SIP
                    // caller's voice level, as heard by the gateway),
                    // normalise on 127 and apply the same sqrt boost
                    // _sampleConferenceAudioLevels uses for WebRTC
                    // peers so the meter response matches the rest of
                    // the room. Quiet rooms produce 0; meter stays
                    // dark until someone speaks. Pre-fix this tile
                    // rendered with noAudioMetrics=true and no VU,
                    // leaving SIP callers' tiles permanently dead
                    // even though their audio levels were already
                    // arriving on the wire.
                    let _sipLevel = 0;
                    const _sipAudioLevels = this.state.sipAudioLevels || {};
                    // _spEndpoints is hoisted above (alongside the mute
                    // button setup) so we can reuse it here without
                    // re-declaring.
                    for (const _ep of _spEndpoints) {
                        const _pid = _ep && _ep.participant_id;
                        if (!_pid) continue;
                        const _entry = _sipAudioLevels[_pid];
                        if (!_entry) continue;
                        const _peak = Math.max(_entry.rx_peak || 0, _entry.rx || 0);
                        if (_peak > _sipLevel) _sipLevel = _peak;
                    }
                    _sipLevel = Math.min(1, Math.sqrt(_sipLevel / 127));

                    tile = (
                        <ConferenceAudioParticipant
                            key={'sip:' + _sipUri}
                            identity={_sipIdentity}
                            isLocal={false}
                            status={_sipDurationStr}
                            bottomLabel="SIP"
                            // noAudioMetrics suppresses the "Waiting for
                            // audio…" placeholder when there's no PC to
                            // measure. We now feed audioLevel from the
                            // sipConferenceAudioLevels stream, so the
                            // VU meter has real data — leave the
                            // placeholder off and let the meter draw.
                            noAudioMetrics={false}
                            audioLevel={_sipLevel}
                            // SIP participants get the same per-tile
                            // badge wiring as WebRTC participants. The
                            // sip-conference-info payload (see the
                            // sipConferenceParticipants event handler)
                            // exposes muted/raisedHand on each ENDPOINT
                            // (not on the participant itself — earlier
                            // `!!sp.muted` was always false and the
                            // mute badge never appeared). _isSipMuted
                            // above already does the .some() walk over
                            // endpoints; reuse it. raisedHand stays a
                            // best-effort .some() too for symmetry.
                            muted={_isSipMuted}
                            raisedHand={_spEndpoints.some((_ep) => _ep && _truthyMuted(_ep.raisedHand))}
                            inlineMuteButton={_sipMuteIndicator}
                            kickButton={_sipKickButton}
                        />
                    );
                }
                if (isBridge) {
                    sipBridgeTiles.push(tile);
                } else {
                    sipParticipantTiles.push(tile);
                }
                participants_uris.push(_aor);
            });
            bridgeWebRtcByAor.forEach((webrtcP, aor) => {
                if (!aor || participants_uris.indexOf(aor) > -1) return;
                const _dn = (webrtcP.identity && webrtcP.identity._displayName) || aor.split('@')[0];
                const _bridgeIdentity = {
                    uri: aor,
                    key: aor,
                    displayName: _dn,
                    photo: null,
                };
                let bDuration = 0;
                let bStatus = '';
                if (webrtcP.timestamp) {
                    bDuration = Math.floor(new Date() - webrtcP.timestamp) / 1000;
                    bStatus = bDuration > 3600
                        ? moment.duration(new Date() - webrtcP.timestamp).format('hh:mm:ss', {trim: false})
                        : moment.duration(new Date() - webrtcP.timestamp).format('mm:ss', {trim: false});
                }
                if (!_sipSeenAt.has(aor)) _sipSeenAt.set(aor, Date.now());
                const _thisBridgeLevel = this.audioLevels.get(webrtcP.id) || 0;
                if (_thisBridgeLevel > _bridgeAudioLevel) _bridgeAudioLevel = _thisBridgeLevel;
                const _bridgeAudioBw = (this.audioBandwidth && this.audioBandwidth.get(webrtcP.id)) || 0;
                const _bridgeVideoBw = (this.videoBandwidth && this.videoBandwidth.get(webrtcP.id)) || 0;
                const _bridgeBwTotal = Math.round(_bridgeAudioBw + _bridgeVideoBw);
                if (_bridgeBwTotal > _bridgeBandwidth) _bridgeBandwidth = _bridgeBwTotal;
                const _b2Lat = this.latency.has(webrtcP.id) ? this.latency.get(webrtcP.id) : null;
                const _b2LossVal = (this.packetLoss.has(webrtcP.id) && bDuration > 10) ? this.packetLoss.get(webrtcP.id) : 0;
                if (typeof _b2Lat === 'number' && _b2Lat > 0) _bridgeLatency = _b2Lat;
                if (_b2LossVal > _bridgeLoss) _bridgeLoss = _b2LossVal;
                sipBridgeTiles.push(
                    <ConferenceAudioParticipant
                        key={'bridge-detected:' + aor}
                        participant={webrtcP}
                        identity={_bridgeIdentity}
                        isLocal={false}
                        status={_formatDuration(_sipSeenAt.get(aor))}
                        bottomLabel="SIP"
                        isBridge={true}
                        latency={this.latency.has(webrtcP.id) ? this.latency.get(webrtcP.id) : null}
                        loss={this.packetLoss.has(webrtcP.id) && bDuration > 10 ? this.packetLoss.get(webrtcP.id) : 0}
                        bandwidth={_bridgeBwTotal}
                        audioLevel={_thisBridgeLevel}
                        timestamp={webrtcP.timestamp}
                    />
                );
                participants_uris.push(aor);
            });

            // Bridge tile visibility is a user-controlled toggle
            // (state.showBridge), exposed in the ConferenceHeader
            // kebab menu when a bridge is detected. Default hidden —
            // the bridge is plumbing, not a user.
            const _bridgePresent = sipBridgeTiles.length > 0;
            if (!this.state.showBridge) {
                sipBridgeTiles = [];
                // When the bridge is hidden AND there's exactly ONE
                // SIP participant behind it, transfer the bridge's
                // bandwidth / RTT / loss onto that SIP tile so its
                // corner labels aren't dead. The SIP tile itself has
                // no PC of its own to measure, so these are the only
                // honest numbers we can show for that single caller.
                //
                // We used to also clone _bridgeAudioLevel here. That
                // was a half-truth — the bridge's audioLevel reflects
                // the MIXED audio of everyone routed through the
                // bridge, not the specific SIP caller's voice level.
                // It read fine with exactly one SIP caller (because
                // the mix IS that caller) but became misleading the
                // moment a second SIP caller joined. Now that the SIP
                // tile is fed by the per-participant
                // sipConferenceAudioLevels stream (see the SIP tile
                // build above), the bridge-VU clone is no longer
                // needed — each SIP tile lights up with its own
                // voice level, regardless of how many other SIP
                // callers are in the room.
                if (sipParticipantTiles.length === 1) {
                    const _clonedProps = {};
                    if (_bridgeBandwidth > 0)  _clonedProps.bandwidth  = _bridgeBandwidth;
                    if (typeof _bridgeLatency === 'number' && _bridgeLatency > 0) {
                        _clonedProps.latency = _bridgeLatency;
                    }
                    if (_bridgeLoss > 0) _clonedProps.loss = _bridgeLoss;
                    if (Object.keys(_clonedProps).length > 0) {
                        sipParticipantTiles[0] = React.cloneElement(sipParticipantTiles[0], _clonedProps);
                    }
                }
            }
            sipAudioParticipants = sipBridgeTiles.concat(sipParticipantTiles);
            // Stash for the ConferenceHeader prop pass below.
            this._bridgePresent = _bridgePresent;

            const invitedParties = Array.from(this.invitedParticipants.keys());
            let alreadyInvitedParticipants = []
            let p;
            var invitedTiles = [];

            // Same normalisation as updateParticipantsStatus(): match
            // invited URIs against everyone currently in the room
            // (webrtc participants + SIP participants), tolerating the
            // sip: scheme being present on one side and not the other.
            // Also skip an invited entry if we ever saw this AOR in the
            // room — that means the invitee actually joined; if the
            // tile still appears here it's only because the entry
            // wasn't pruned (e.g. on a subsequent leave). Drop them
            // outright so a "left after joining" doesn't resurrect the
            // invited tile.
            const _renderNormAor = (u) => {
                if (!u) return '';
                let s = String(u);
                if (s.indexOf('sip:') === 0) s = s.slice(4);
                else if (s.indexOf('sips:') === 0) s = s.slice(5);
                return s.split(';')[0];
            };
            const _renderRoomAors = new Set();
            participants_uris.forEach((u) => { const a = _renderNormAor(u); if (a) _renderRoomAors.add(a); });
            (this.state.sipParticipants || []).forEach((sp) => {
                if (!sp || (sp.type !== 'sip' && sp.type !== 'bridge')) return;
                const a = _renderNormAor(sp.uri || '');
                if (a) _renderRoomAors.add(a);
            });
            invitedParties.forEach((_uri) => {
                if (_renderRoomAors.has(_renderNormAor(_uri))) {
                    // Currently in the room — no invited tile needed.
                    // Also prune the map so a later leave doesn't bring
                    // it back as a stale "Waiting…" tile.
                    this.invitedParticipants.delete(_uri);
                    this._cancelInviteTimeout && this._cancelInviteTimeout(_uri);
                    return;
                }

                p = this.invitedParticipants.get(_uri);
                if (!p) {
                    return;
                }
                _contact = this.foundContacts.get(_uri);
                // Same normalization as the joined-participants
                // branch above — foundContacts is title-cased by
                // lookupContact, so the only path that can land
                // here uncased is the brief window before the
                // post-invite lookupContact runs. Fall back to the
                // title-cased URI local part instead of the raw
                // URI string so the row reads as a name rather
                // than "adi@sylk.link".
                _identity = {uri: _uri,
                             displayName: (_contact && _contact.displayName) ? _contact.displayName : toTitleCase(_uri.split('@')[0]),
                             photo: _contact ? _contact.photo: null
                            };

                if (p.status != 'No answer') {
                    alreadyInvitedParticipants.push(_uri)
                }

                //console.log('p.status', p.status);

                let extraButtons = [];
                let invite_uris = [];
                invite_uris.push(_uri);

                const _isInviteFailure = /^[3-6]\d\d\b/.test(String(p.status || ''));

                // Failed / reinvite tile gets a refresh button in the
                // right-slot extraButtons cluster (so the retry stays
                // next to the duration area) and the close-X chip in
                // the top-right kickButton overlay (replaces the old
                // trash icon — same visual as a per-participant kick).
                // For failed-invite tiles we also suppress the
                // mediaContainer so the right slot only carries the
                // retry button; the status text is already shown in
                // the VU-meter slot via progressText.
                let _inviteKickButton = null;
                if (p.status === 'reinvite' || _isInviteFailure) {
                    extraButtons = [
                      <View style={[styles.buttonContainer, {marginRight: 20}]} key={`invitee-reinvite-${_uri}`}>
                        <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={25}
                            style={buttonClass}
                            icon={'refresh'}
                            onPress={() => this.inviteParticipants(invite_uris)}
                        />
                        </TouchableHighlight>
                      </View>
                    ];
                    _inviteKickButton = (
                        <TouchableOpacity
                            key={`invitee-delete-${_uri}`}
                            style={styles.kickCircle}
                            onPress={() => this.removeInvitedParticipant(_uri)}
                            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                        >
                            <Icon name="close" size={11} color="#ffffff" />
                        </TouchableOpacity>
                    );
                }
                // Combined progress/result text for the 3rd-line slot
                // (where the VU meter normally lives). During the
                // 45-second invite window this is "Waiting ...NN";
                // after the window expires or a final status lands,
                // it's the status text itself (e.g. "408 No answer",
                // "Accepted"). Single label across both phases keeps
                // the tile visually stable.
                let _progressText = '';
                if (!_isInviteFailure && typeof p.remaining === 'number' && p.remaining > 0) {
                    _progressText = 'Waiting ...' + p.remaining;
                } else if (typeof p.status === 'string' && p.status.length > 0) {
                    _progressText = p.status;
                }
                invitedTiles.push(
                    <ConferenceAudioParticipant
                        key={_uri}
                        identity={_identity}
                        isLocal={false}
                        status={p.status}
                        extraButtons={extraButtons}
                        kickButton={_inviteKickButton}
                        noAudioMetrics={_isInviteFailure}
                        suppressMediaContainer={_isInviteFailure}
                        progressText={_progressText}
                    />
                );
            });
            
            audioParticipants.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1)
            _contact = this.foundContacts.get(this.props.call.localIdentity._uri);
            const _localDn = (_contact && _contact.displayName)
                ? _contact.displayName
                : (this.props.call.localIdentity._displayName
                    || toTitleCase(this.props.call.localIdentity._uri.split('@')[0]));
            const _localPhoto = _contact ? _contact.photo : null;
            _identity = {uri: this.props.call.localIdentity._uri,
                         displayName: _localDn,
                         photo: _localPhoto
                        };

            participants_uris.push(this.props.call.localIdentity._uri);

            // Self-tile duration. Mirrors the format the remote
            // participant tiles use (mm:ss / hh:mm:ss via moment so
            // long calls roll into the hours column). Sourced from
            // props.callState.startTime — the same conference-start
            // timestamp the top-of-component duration calc uses.
            // Falls back to an empty status if startTime isn't yet
            // available (the call is still establishing).
            let _selfStatus = '';
            const _selfStart = this.props.callState && this.props.callState.startTime;
            if (_selfStart) {
                const _selfElapsedMs = new Date() - _selfStart;
                const _selfElapsedSec = Math.floor(_selfElapsedMs / 1000);
                _selfStatus = _selfElapsedSec > 3600
                    ? moment.duration(_selfElapsedMs).format('hh:mm:ss', {trim: false})
                    : moment.duration(_selfElapsedMs).format('mm:ss', {trim: false});
            }

            // Self upload bandwidth (kbps). bandwidthUpload is in
            // kbps already (see getConnectionStats's
            // `Math.floor(diff / sampleInterval * 8 / 1000)`).
            // Shown in the tile's bottom-right corner with an ↑
            // arrow (the isLocal flag flips the arrow direction
            // inside ConferenceAudioParticipant — remote tiles use ↓
            // since their bandwidth represents what WE receive).
            const _selfBwKbps = Math.round(this.bandwidthUpload || 0);
            audioParticipants.splice(0, 0,
                <ConferenceAudioParticipant
                    key="myself"
                    participant={null}
                    identity={_identity}
                    isLocal={true}
                    timestamp={Date.now()}
                    // Local mic VU level — sampled from the main
                    // call's PC media-source / outbound-rtp report.
                    // Same map the remote participants read from,
                    // bucketed under the literal 'myself' key.
                    audioLevel={this.audioLevels.get('myself') || 0}
                    // Conference running time, formatted the same way
                    // as remote participant tiles. Sits in the tile's
                    // top-right text slot so the user can read total
                    // elapsed time at a glance without leaving the
                    // audio view.
                    status={_selfStatus}
                    // Upload speed — what THIS user is publishing.
                    // Same prop the remote tiles use for download
                    // speed; isLocal=true flips the arrow direction
                    // (↑ vs ↓) in the tile renderer.
                    bandwidth={_selfBwKbps}
                    // Raised-hand badge mirrors state.raisedHand — the
                    // same flag the "Raise hand" button in the top
                    // action bar toggles. ConferenceAudioParticipant
                    // suppresses the muted badge for isLocal but does
                    // render raisedHand, so the user sees a visible
                    // indicator that their own hand is up.
                    raisedHand={!!this.state.raisedHand}
                    extraButtons={selfTileButtons}
                />
            );

			//console.log('topInset', topInset);
			//console.log('bottomInset', bottomInset);

			const marginRight = this.state.isLandscape && Platform.OS === 'android' ? 48 : 0;
			const marginBottom = this.state.isLandscape && Platform.OS === 'android' ? -48 : 0;

			// Audio-view list sizing.
			//
			// The list is rendered inline by ConferenceAudioParticipantList
			// (a plain View — see the comment in that file for why it's
			// no longer a FlatList). Scrolling is handled by the outer
			// ScrollView that also wraps the SIP / invited tile groups
			// below. The container around it gets a fixed height so the
			// chat panel that swaps in via the action-bar toggle knows
			// how much flex space it has. Cap that height to fit 5
			// participants (60 px card + ~10 px VU-row = 70 px per
			// row) so a busy room scrolls instead of letting the list
			// shove the chat off-screen, and SHRINK to the actual
			// count when fewer than 5 participants are present so we
			// don't reserve dead space.
			//
			// audioParticipants already includes the "myself" row
			// (spliced at index 0 a few lines above) so its length
			// is the total rows the list renders.
			//
			// Keyboard visible: clamp further so the list doesn't
			// crowd the composer.
			// Tile metrics — keep in sync with ConferenceAudioParticipant
			// styles.card height (78) + tileWrapper marginVertical
			// (2 + 2) + tileWrapper borderWidth (1 + 1) = 84 per tile.
			// One extra pixel for sub-pixel rounding so the bottom
			// border is never clipped.
			const AUDIO_ROW_HEIGHT = 86;
			const AUDIO_MAX_ROWS = 5;
			// Landscape lays the tiles out as a 2-column grid
			// (ConferenceAudioParticipantList wraps each tile in a
			// 50%-width cell when isLandscape is true). That halves
			// the row count for any given participant count, so the
			// height reservation halves with it — without this, the
			// container would still reserve 5 single-column rows and
			// push the SIP / invited groups off-screen.
			const _tilesPerRow = this.state.isLandscape ? 2 : 1;
			const _visibleRows = Math.min(
				Math.ceil(Math.max(audioParticipants.length, 1) / _tilesPerRow),
				AUDIO_MAX_ROWS
			);
			// mediaContainer holds ONLY the webrtc participant tiles
			// now — SIP / invited groups render as separate siblings
			// below and self-size. So audioHeight is just enough for
			// the visible webrtc rows; scrolling kicks in past
			// AUDIO_MAX_ROWS via the outer ScrollView.
			let audioHeight = _visibleRows * AUDIO_ROW_HEIGHT;
			const _audioHeightCeiling = Math.max(150, Math.floor(height * 0.55));
			audioHeight = Math.min(audioHeight, _audioHeightCeiling);
			const marginTop = Platform.OS === 'ios' ? topInset : 0;
			
			debugBorderWidth = 0;

			container = {
				flex: 1,
				flexDirection: 'column',
	            borderWidth: debugBorderWidth,
			    borderColor: 'white',
 		    };

  		    conferenceHeader = {
			  height: conferenceHeaderHeight,
	          borderWidth: debugBorderWidth,
			  borderColor: 'yellow',
			  // zIndex + elevation so the navbar stays on top of
			  // the chat / participants column rendered as a flex
			  // sibling below it. Without this the chat's bounds
			  // (KAV-wrapped, with marginTop:40) still painted
			  // over the navbar's lower edge and ate the first
			  // taps on the chat→audio / audio→video formation.
			  // zIndex alone isn't enough on Android — elevation
			  // also has to be set so the native view hierarchy
			  // actually layers the navbar above the chat.
			  zIndex: 2000,
			  elevation: 10,
		    };

            if (Platform.OS === 'ios' ) {
                if (this.state.isLandscape) {
					conferenceHeader.width = width - rightInset - leftInset;
                }
            }

			// conferenceContainer is always a column: action bar on
			// top, then either the participant list or the chat
			// underneath (picked by the audioChatView toggle).
			// Making it always-column avoids the previous bug where
			// flexDirection:'row' in landscape turned the horizontal
			// audioViewActionBar into a narrow vertical strip wedged
			// to the left of the body.
			//
			// Folded (cover-display) audio conference: paddingTop
			// clears the absolutely-positioned ConferenceHeader
			// (height 60). With audioListTopActionBar suppressed in
			// folded (see the gate above), the first in-flow child
			// is participantsListColumn whose own marginTop:10 then
			// supplies the gap below the navbar. History on this:
			//   paddingTop:60 + marginTop:10  (gap = 10 below navbar)
			//   → user said too low
			//   paddingTop:55                  (gap =  5)
			//   → user said "lift 5 more"
			//   paddingTop:50                  (gap =  0, tile meets
			//                                   navbar bottom)
			//   → user said "lift 5 more" again
			//   paddingTop:45                  (gap = -5, tile slides
			//                                   behind the navbar)
			//   → user said "more"
			//   paddingTop:40                  (gap = -10)
			//   → user said "more"
			//   paddingTop:35                  (gap = -15)
			//   → user said "lift 5 px more"
			//   paddingTop:30                  (gap = -20, top 20 px
			//                                   of the list now sits
			//                                   behind the navbar).
			conferenceContainer = {
			  flex: 1,
			  flexDirection: 'column',
			  alignContent: 'flex-start',
			  justifyContent: 'flex-start',
	          borderWidth: debugBorderWidth,
			  borderColor: 'blue',
			  paddingTop: this.props.isFolded ? 30 : 0,
			};

			// Participant list container — same dimensions in both
			// orientations now that landscape uses the same toggle
			// behavior as portrait. The previous 50%/100% landscape
			// values were left over from a half-implemented
			// side-by-side layout and rendered nothing legible.
		    mediaContainer = {
			  width: '100%',
			  height: audioHeight,
	          borderWidth: debugBorderWidth,
			  borderColor: 'green'
			};

			// Chat container — gray hairline border removed (the
			// rgba(255,255,255,0.18) top edge was reading as a
			// visible line above the chat). marginTop 40 keeps
			// the chat positioned correctly below the navbar.
			chatContainer = {
			  flex: 1,
			  width: '100%',
			  marginTop: 40,
			  overflow: 'hidden',
			};

			const insets = this.state.insets;

			if (debugBorderWidth) {
				const values = {
				  topInset,
				  bottomInset,
				  leftInset,
				  rightInset,
				  container,
				  conferenceHeader,
				  buttonsContainer,
				  conferenceContainer,
				  mediaContainer,
				  chatContainer,
				  insets				  
				};

				const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
			
				Object.entries(values).forEach(([key, value]) => {
				  const prev = this.prevValues[key];
				   const paddedKey = key.padStart(maxKeyLength, ' '); // right
				  if (JSON.stringify(prev) !== JSON.stringify(value)) {
					console.log(paddedKey, value);
				  }
				});
	
				this.prevValues = values;
			}

			return (
			   <View 
			        key={this.state.isLandscape ? 'landscape' : 'portrait'}
			        style={container}>

				<ShareConferenceLinkModal
					notificationCenter={this.props.notificationCenter}
					show={this.state.showInviteModal && !this.state.reconnectingCall}
					close={this.toggleInviteModal}
					conferenceUrl={conferenceUrl}
                    conferenceRoom={conferenceRoom}
                    sylkDomain={this.props.sylkDomain}
                    conferenceSettings={this.props.conferenceSettings}

				/>

				<View style={conferenceHeader}>
					<ConferenceHeader
					    visible={true}
					    height={conferenceHeader.height}
						remoteUri={this.state.remoteUri}
						callContact={this.props.callContact}
						isTablet={this.props.isTablet}
						isLandscape={this.state.isLandscape}
						/* Folded (cover-display) flag — ConferenceHeader
						   uses it to hide the Audio... / Video... /
						   Hangup / Show PSTN bridge kebab items that
						   don't fit / don't apply on the cramped cover
						   screen. */
						isFolded={this.props.isFolded}
						call={this.state.call}
						participantsCount={_otherParticipantsCount}
						serverDuration={this.state.conferenceDurationAtJoin}
						videoParticipantCount={_remoteVideoSpeakerCount}
						reconnectingCall={this.state.reconnectingCall}
						buttons={buttons}
						audioOnly={this.audioOnlyView}
						toggleViewMode={this.toggleViewMode}
						toggleAspectRatio={this.toggleAspectRatio}
						terminated={this.state.terminated}
						info={this.state.info}
						goBackFunc={this.props.goBackFunc}
						toggleInviteModal={this.toggleInviteModal}
						bridgePresent={!!this._bridgePresent}
						showBridge={this.state.showBridge}
						toggleBridgeVisibility={this.toggleBridgeVisibility}
						inviteToConferenceFunc={this.props.inviteToConferenceFunc}
						callState={this.props.callState}
						toggleAudioParticipantsFunc={this.toggleAudioParticipants}
						toggleChatFunc={this.toggleChat}
						hangUpFunc={this.hangup}
						audioView={this.state.audioView}
						chatView={this.state.chatView}
						audioChatView={this.state.audioChatView}
						toggleAudioChatViewFunc={this.toggleAudioChatView}
						toggleDrawer={this.toggleDrawer}
						toggleSpeakerSelection={this.toggleSpeakerSelection}
						enableMyVideo={this.state.enableMyVideo}
						toggleMyVideo={this.toggleMyVideo}
						/* Used by the audio-view Video... submenu
						   for the Stop / Start video row. Toggle
						   wraps the existing muteVideo /
						   _resumeVideo pair so a single tap can
						   move either direction.
						   Unmute branch also force-restores the
						   mirror if it was previously hidden — see
						   the matching note on the camera picker's
						   unmute row above for the rationale. */
						videoMuted={this.state.videoMuted}
						toggleVideoMute={() => {
						    if (this.state.videoMuted) {
						        const next = {videoMutedbyUser: false};
						        if (this.state.enableMyVideo === false) {
						            next.enableMyVideo = true;
						        }
						        this.setState(next);
						        this._resumeVideo();
						    } else {
						        this.muteVideo();
						    }
						}}
						/* Forwarded so the Video... submenu can
						   disable Hide/Show mirror when there is no
						   remote tile to view alongside. */
						participants={this.state.participants}
						/* Opens the camera picker overlay from the
						   kebab's "Video..." item. Same panel the
						   call-bar video button toggles.
						   Mutually exclusive with the audio picker:
						   opening one closes the other so only one
						   floating panel is on screen at a time
						   (avoids two overlapping pickers stacked
						   on top of each other when the user jumps
						   between the kebab's Audio... and Video...
						   entries). */
						openVideoPicker={() => this.setState({
						    videoPickerVisible: true,
						    audioDevicePickerVisible: false,
						})}
						/* Opens the audio device picker overlay
						   from the kebab's "Audio..." item. Same
						   panel the call-bar audio button toggles
						   (renderAudioDevicePicker's "floating" /
						   "menu" variants both read
						   audioDevicePickerVisible). Closes the
						   video picker for the same one-at-a-time
						   reason. */
						openAudioPicker={() => this.setState({
						    audioDevicePickerVisible: true,
						    videoPickerVisible: false,
						})}
						/* Tapping the kebab again resets device
						   pickers. Single setState clears both so
						   the call bar returns to its idle "no
						   picker open" state in one render. */
						closeMediaPickers={() => this.setState({
						    audioDevicePickerVisible: false,
						    videoPickerVisible: false,
						})}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						insets = {this.state.insets}
						useInCallManger = {this.props.useInCallManger}
					/>
				</View>

				{/* No floating speedometer in this audio-only conference
				    render path. The video render path (separate return
				    below) handles the i-icon + landscape-navbar toggle. */}

				<View style={[styles.buttonsContainer]}>
					{sessionButtons}
				</View>

				<View style={conferenceContainer}>
					{this.props.isLandscape ? null : this.renderAudioDeviceButtons()}

					{/* audioViewActionBar moved BELOW the body — see
					    the matching block right above the closing
					    </View> of conferenceContainer. The bar now
					    pins to the bottom of the column via
					    marginTop:'auto', matching the screen position
					    of AudioCallBox.portraitButtonContainer. */}

					{/* Audio-view body. The action-bar toggle picks
					    between the participant list and the chat in
					    both portrait and landscape.

					    Layout note: the AudioSpeedometer used to live
					    ABOVE the participant list as a sibling block.
					    User requested a two-column arrangement instead
					    — speedometer in the LEFT column, participants in
					    the RIGHT column. The block below builds that
					    side-by-side row, and the speedometer column is
					    only rendered while the call is flowing
					    (established/accepted) so it doesn't show stale
					    zeros during ringing. In landscape the action
					    bar is reorganised into the navbar, but the
					    side-by-side layout still applies. */}
					{/* PORTRAIT speedometer — above the participants list,
					    centered. Rendered as a sibling of the column
					    wrapper below (NOT inside it) because the wrapper
					    has overflow:'hidden' for ScrollView clipping,
					    which would also clip a child speedometer with
					    a negative top margin. Only shows once the call
					    is flowing so the dial doesn't sit on zeros
					    during ringing, and only in the participants
					    tab so it doesn't appear over the chat. */}
					{!this.state.isLandscape
					 && !this.state.audioChatView
					 && !this.props.isFolded
					 && this.state.call
					 && (this.state.call.state === 'established'
					     || this.state.call.state === 'accepted') ? (
						<View style={{
							alignItems: 'center',
							// Speedometer sits 30 px below the conference
							// overlay navbar per user request. Same value
							// on both platforms — the previous platform-
							// gated negative margin (Android -20 / iOS 0)
							// pulled the dial up into the appbar; flat
							// +30 keeps a comfortable gap below the
							// navbar on both.
							// Folded (cover-display) mode hides this
							// block entirely (the !this.props.isFolded
							// gate above) — the dial doesn't fit the
							// narrow cover screen and the user asked
							// for it gone there.
							marginTop: 30,
							paddingBottom: 6,
							zIndex: 2,
						}}>
							<AudioSpeedometer
								call={this.state.call}
								isFolded={false}
							/>
						</View>
					) : null}

					{(() => {
					// Audio-view body.
					//
					// Portrait: single-column participant list (the
					//   speedometer sibling block above sits over it).
					// Landscape: exact 50/50 split per user request.
					//   LEFT half  → AudioSpeedometer, centered both
					//                axes. flex:1 so it grows with the
					//                screen width.
					//   RIGHT half → participants stacked VERTICALLY
					//                (single column of tiles), not the
					//                two-column landscape grid — the
					//                row half-width is already narrow,
					//                so forcing one-tile-per-row keeps
					//                each tile readable.
					//                Achieved by passing
					//                isLandscape={false} to
					//                ConferenceAudioParticipantList,
					//                which suppresses the 2-column wrap.
					//   Speedometer column only renders once the call
					//   is actually flowing (established/accepted);
					//   before then the row collapses to participants-
					//   only so the user doesn't stare at a zeros dial
					//   during ringing.
					// Folded (cover-display) audio conference: drop the
					// speedometer entirely — the cover screen doesn't
					// have room for it in either orientation, and the
					// dial duplicated information already shown in the
					// navbar speedometer for the user's main call.
					const speedometerLive = !this.props.isFolded
						&& this.state.call
						&& (this.state.call.state === 'established'
						    || this.state.call.state === 'accepted');

					// Force vertical stacking in BOTH orientations:
					//   • Portrait was already isLandscape={false} →
					//     unchanged behaviour.
					//   • Landscape used to pass isLandscape={true},
					//     which triggers ConferenceAudioParticipantList's
					//     2-column wrap. With the speedometer eating the
					//     left half of the screen, the right half is too
					//     narrow for a 2-column grid, so override to
					//     false and stack tiles top-to-bottom in that
					//     half.
					const _listIsLandscape = false;

					// Folded (cover-display) audio conference: nudge the
					// participant list 10 px down from the chrome above
					// per user request. Other form factors keep the
					// natural baseline so the layout doesn't shift on
					// phones / tablets. The temporary red debug border
					// previously here has been removed once the layout
					// was confirmed visually.
					const _listMarginTop = this.props.isFolded ? 10 : 0;
					const participantsListColumn = (
						<View style={{flex: 1, overflow: 'hidden', marginTop: _listMarginTop}}>
							<ScrollView>
								<View style={mediaContainer}>
									<ConferenceAudioParticipantList isLandscape={_listIsLandscape}>
										{audioParticipants}
									</ConferenceAudioParticipantList>
								</View>
								{/* SIP & invited tiles also go through
								    ConferenceAudioParticipantList so
								    the (portrait-grid / landscape-stack)
								    rule above applies uniformly. */}
								<View style={sipAudioParticipants && sipAudioParticipants.length > 0 ? styles.sipParticipantsGroup : null}>
									<ConferenceAudioParticipantList isLandscape={_listIsLandscape}>
										{sipAudioParticipants}
									</ConferenceAudioParticipantList>
								</View>
								<View style={invitedTiles && invitedTiles.length > 0 ? styles.invitedParticipantsGroup : null}>
									<ConferenceAudioParticipantList isLandscape={_listIsLandscape}>
										{invitedTiles}
									</ConferenceAudioParticipantList>
								</View>
							</ScrollView>
						</View>
					);

					// LANDSCAPE: 50/50 row. flex:1 on BOTH children
					// gives an exact half-half split — the
					// AudioSpeedometer is centered in its half, the
					// list scrolls vertically in the other.
					// PORTRAIT: just hand the list column through —
					// no wrapper, no speedometer.
					// FOLDED (cover display): skip the 50/50 split
					// even in landscape so the participants get the
					// full width — with the speedometer hidden, the
					// left half would otherwise be a permanently empty
					// column eating the narrow cover screen.
					const participantsColumn = (this.state.isLandscape && !this.props.isFolded) ? (
						<View style={{flex: 1, flexDirection: 'row'}}>
							<View style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4}}>
								{speedometerLive ? (
									// transform translateY:-50 lifts the
									// dial 50 px from its center-justified
									// resting position. History on this
									// knob: -10 → -100 → -50 ("less 50px"
									// from -100). Translate is a pure
									// paint shift, so the surrounding
									// flexbox row math is undisturbed —
									// the right column's participant list
									// stays in place. Landscape only.
									<View style={{transform: [{translateY: -50}]}}>
										<AudioSpeedometer
											call={this.state.call}
											isFolded={false}
										/>
									</View>
								) : null}
							</View>
							{participantsListColumn}
						</View>
					) : participantsListColumn;

					// Original KAV config restored — behavior='height'
					// on Android (so the input bar lifts above the
					// keyboard) and keyboardVerticalOffset set to
					// the navbar + status-bar inset distance. The
					// chat's vertical positioning relative to the
					// navbar is now controlled by the negative
					// marginTop on chatContainer above, not by
					// fighting the KAV config.
					const chatColumn = (Platform.OS === 'android'
						? (
							<KeyboardAvoidingView
								key={this.state.isLandscape ? 'landscape' : 'portrait'}
								style={chatContainer}
								behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
								keyboardVerticalOffset={conferenceHeaderHeight + topInset}
							>
								<GiftedChat
									key={this.state.isLandscape ? 'landscape' : 'portrait'}
									messages={renderMessages}
									isTyping={this.state.isTyping}
									onLongPress={this.onLongMessagePress}
									onSend={this.onSendMessage}
									renderCustomView={this.renderCustomView}
									renderSend={this.renderSend}
									renderBubble={this.renderBubble}
									renderMessageImage={this.renderMessageImage}
									renderMessageVideo={this.renderMessageVideo}
									shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
									alwaysShowSend={true}
									scrollToBottom
									lockStyle={styles.lock}
									inverted={true}
									timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
									infiniteScroll
								/>
							</KeyboardAvoidingView>
						)
						: (
							// iOS path. Wrapped in KAV with
							// behavior='padding' so the input bar
							// lifts above the soft keyboard. The
							// keyboardVerticalOffset is set to the
							// bottom safe-area inset so the
							// padding-bottom KAV applies when the
							// keyboard rises equals
							// (keyboard_height - bottomInset). That
							// closes the ~34 dp gap the user saw
							// between the input bar and the keyboard
							// on iPhones with a home indicator —
							// without the offset, GiftedChat's
							// default safe-area handling left the
							// input bar bottomInset above the
							// keyboard top.
							<KeyboardAvoidingView
								key={this.state.isLandscape ? 'landscape' : 'portrait'}
								style={chatContainer}
								behavior="padding"
								keyboardVerticalOffset={bottomInset}
							>
								<GiftedChat
									key={this.state.isLandscape ? 'landscape' : 'portrait'}
									messages={renderMessages}
									isTyping={this.state.isTyping}
									onLongPress={this.onLongMessagePress}
									onSend={this.onSendMessage}
									renderCustomView={this.renderCustomView}
									renderSend={this.renderSend}
									renderBubble={this.renderBubble}
									renderMessageImage={this.renderMessageImage}
									renderMessageVideo={this.renderMessageVideo}
									shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
									alwaysShowSend={true}
									scrollToBottom
									lockStyle={styles.lock}
									inverted={true}
									timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
									infiniteScroll
								/>
							</KeyboardAvoidingView>
						)
					);

					// Same toggle behavior in both orientations:
					// exactly one of {participants, chat} is on
					// screen, picked by the audioChatView state which
					// the action-bar toggle button flips.
					// While the chat is on screen, the bottom action
					// bar is suppressed (see audioViewActionBar above)
					// and chatBackToAudioButton — a single round
					// button — is rendered just above the chat as the
					// only call-control affordance in that view.
					return (
						<Fragment>
							{!this.state.audioChatView ? audioListTopActionBar : null}
							{!this.state.audioChatView ? participantsColumn : null}
							{this.state.audioChatView ? chatBackToAudioButton : null}
							{this.state.audioChatView ? chatColumn : null}
						</Fragment>
					);
				})()}

				{/* Action bar pinned to the bottom of the audio-view
				    column. Its marginTop:'auto' eats any extra
				    vertical space above it so the buttons sit at the
				    same screen position as AudioCallBox's portrait
				    button row. Landscape suppresses this (the buttons
				    are folded into the ConferenceHeader via
				    buttons.bottom instead), so audioViewActionBar is
				    null in that orientation. */}
				{audioViewActionBar}
				{/* Recording pill — same AudioCallBox-style pill
				    rendered as an overlay above the action bar so
				    its red dot + label sits cleanly above the
				    button row (matches the 1-to-1 call visual). */}
				{conferenceRecordPillOverlay}
				{/* Conference recording disclosure modal — first-tap
				    consent gate, surfaces only when the user taps
				    the Record pill and disclaimers.conferenceRecording
				    is not yet acknowledged. Kind='conference' swaps
				    the title + footer copy vs the 1-to-1 call flow
				    that AudioCallBox uses. */}
				<CallRecordingDisclosureModal
				    show={this.state.showConferenceRecordingDisclosure}
				    kind="conference"
				    onContinue={this._onConferenceRecordingDisclosureContinue}
				    onCancel={this._onConferenceRecordingDisclosureCancel}
				/>
				</View>

				{/* Floating self-PIP for audio view, only when the
				    local call carries a video track AND the user
				    hasn't hidden the mirror via the kebab. The
				    video layout already has its own self-PIP
				    wired off showMyself / myselfContainer; audio
				    view used to leave the user with no view of
				    their own camera at all, which became
				    confusing once the user could keep filming
				    after switching layouts. The thumbnail shows
				    the local stream (mirrored when on the front
				    camera) with two overlay controls along the
				    bottom: a video-off / video toggle (mutes the
				    camera but keeps the call's video track) and
				    a camera-switch glyph. When the camera is
				    muted the RTCView is swapped for a placeholder
				    so we don't pay the cost of rendering a
				    still-running track that the user chose to
				    hide.
				    Sized 120x160 (kept in sync with this._PIP_W /
				    this._PIP_H); positioned via state.pipPosition
				    (top-left) once the user drags it, or the
				    default right-middle placement on first render.
				    PanResponder claims the gesture only after a
				    ~5px move so single taps still reach the
				    overlay buttons. zIndex 1500 keeps it above
				    the participant list.
				    enableMyVideo is the user's explicit Hide
				    mirror / Show mirror choice from the audio-
				    view kebab — when false, the PIP is suppressed
				    entirely. Camera state is unchanged (the track
				    keeps doing whatever it was doing); only the
				    local preview is hidden. */}
				{this.state.videoEnabled && this.state.enableMyVideo ? (() => {
				    // Re-clamp on every render so an orientation
				    // change (or any other window-size shift) can't
				    // strand the PIP off-screen. Either dimension
				    // overflow falls back to the default placement,
				    // and otherwise the saved drag position is
				    // honoured unchanged.
				    const _winDims = Dimensions.get('window');
				    const _saved = this.state.pipPosition;
				    const _valid = _saved
				        && _saved.x >= 0
				        && _saved.y >= 0
				        && _saved.x + this._PIP_W <= _winDims.width
				        && _saved.y + this._PIP_H <= _winDims.height;
				    const _pipPos = _valid ? _saved : this._getDefaultPipPosition();
				    return (
				<View
				    {...this._pipPanResponder.panHandlers}
				    style={{
				        position: 'absolute',
				        left: _pipPos.x,
				        top: _pipPos.y,
				        width: this._PIP_W,
				        height: this._PIP_H,
				        zIndex: 1500,
				        borderRadius: 8,
				        overflow: 'hidden',
				        backgroundColor: '#1a1a1a',
				        elevation: 8,
				    }}
				>
				    {!this.state.videoMuted && this.props.call ? (
				        <RTCView
				            streamURL={this.props.call.getLocalStreams()[0] ? this.props.call.getLocalStreams()[0].toURL() : null}
				            style={{flex: 1}}
				            mirror={this.state.cameraFacing === 'front'}
				            objectFit="cover"
				        />
				    ) : (
				        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
				            <Icon name="video-off" size={36} color="#888" />
				        </View>
				    )}
				    <View style={{
				        position: 'absolute',
				        bottom: 0,
				        left: 0,
				        right: 0,
				        flexDirection: 'row',
				        justifyContent: 'space-evenly',
				        alignItems: 'center',
				        paddingVertical: 4,
				        backgroundColor: 'rgba(0,0,0,0.45)'
				    }}>
				        <TouchableOpacity
				            onPress={() => this.muteVideo()}
				            accessibilityLabel={this.state.videoMuted ? 'Resume camera' : 'Mute camera'}
				            hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
				        >
				            <Icon
				                name={this.state.videoMuted ? 'video-off' : 'video'}
				                size={22}
				                color="white"
				            />
				        </TouchableOpacity>
				        <TouchableOpacity
				            onPress={() => this.toggleCamera()}
				            accessibilityLabel="Switch camera"
				            hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
				        >
				            <Icon name="camera-switch" size={22} color="white" />
				        </TouchableOpacity>
				    </View>
				    {/* Close (×) button at the top-right of the
				        audio-view mirror PIP. Tap → enableMyVideo
				        = false → the PIP unrenders on the next
				        render (it's gated on
				        state.videoEnabled && state.enableMyVideo).
				        Bring it back via the kebab's "Show mirror"
				        item. */}
				    <TouchableOpacity
				        onPress={() => this.setState({enableMyVideo: false})}
				        accessibilityRole="button"
				        accessibilityLabel="Close mirror"
				        hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
				        style={{
				            position: 'absolute',
				            top: 4,
				            right: 4,
				            zIndex: 1600,
				            width: 22,
				            height: 22,
				            borderRadius: 11,
				            backgroundColor: 'rgba(0,0,0,0.55)',
				            justifyContent: 'center',
				            alignItems: 'center',
				        }}
				    >
				        <Icon name="close" size={16} color="#ffffff" />
				    </TouchableOpacity>
				</View>
				    );
				})() : null}
			</View>
			);
        }

		const participants = [];
		const drawerParticipants = [];

		drawerParticipants.push(
			<ConferenceDrawerParticipant
				key="myself1"
				participant={{identity: this.props.call.localIdentity}}
				isLocal={true}
			/>
		);

		let videos = [];
		let status = '';
		
		if (this.state.participants.length === 0) {
		    /*
			videos.push(
			</View>
				// Parent wrapper
				<View style={{ flex: 1 }}>
					<RTCView
						key="self"
						objectFit="cover"
						style={{ flex: 1 }}
						ref="largeVideo"
						poster="assets/images/transparent-1px.png"
						streamURL={this.state.largeVideoStream ? this.state.largeVideoStream.toURL() : null}
					/>
				</View>
			);
			*/

		} else {
			const activeSpeakers = this.state.activeSpeakers;
			const activeSpeakersCount = activeSpeakers.length;

			const stalled = this.state.stalledParticipants || new Set();

			if (activeSpeakersCount > 0) {
				// Track the visible position within the pinned list so
				// the 2-speaker layout can label tiles "Speaker 1" /
				// "Speaker 2" (the original forEach index lies if any
				// of the earlier speakers were stalled and skipped).
				let _visibleIdx = 0;
				activeSpeakers.forEach((p) => {
					// Hide tile entirely while inbound video is stalled
					// (>20s with no bytes received). Restored as soon as
					// data resumes — see getConnectionStats.
					if (stalled.has(p.id)) return;
					status = '';
					if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
						status = 'Muted';
					} else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
						if (this.packetLoss.get(p.id) === 100) {
							status = 'No media';
							return;
						} else {
							status = this.packetLoss.get(p.id) + '% loss';
						}

					} else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
						status = this.latency.get(p.id) + ' ms';
					}

					if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
						status = 'Muted';
					} else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
						if (this.packetLoss.get(p.id) === 100) {
							status = 'No media';
							return;
						} else {
							status = this.packetLoss.get(p.id) + '% loss';
						}
					}


					{
						const _bwKbps = (this.videoBandwidth && this.videoBandwidth.get)
							? this.videoBandwidth.get(p.id)
							: undefined;
						// Pill label per layout:
						//   1 pinned speaker  → "Main speaker"
						//   2 pinned speakers → "Speaker 1" / "Speaker 2"
						// based on the visible position within the
						// pinned set (skipping any stalled pins).
						let _speakerLabel = null;
						if (activeSpeakersCount === 1) {
							_speakerLabel = 'Main speaker';
						} else if (activeSpeakersCount === 2) {
							_speakerLabel = `Speaker ${_visibleIdx + 1}`;
						}
						videos.push(
							<ConferenceMatrixParticipant
								key={p.id}
								participant={p}
								isLocal={p.id === this.props.call.id}
								status={status}
								videoBandwidth={_bwKbps}
								aspectRatio={this.state.aspectRatio}
								speakerLabel={_speakerLabel}
								isLandscape={this.state.isLandscape}
								isFullScreen={this.fullScreen}
							/>
						);
						_visibleIdx += 1;
					}
				});

				this.state.participants.forEach((p) => {
					status = '';
					if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
						status = 'Muted';
					} else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
						if (this.packetLoss.get(p.id) === 100) {
							status = 'No media';
							// fall through so the drawer still lists them
						} else {
							status = this.packetLoss.get(p.id) + '% loss';
						}
					} else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
						status = this.latency.get(p.id) + ' ms';
					}


					// Side-list of off-screen video tiles: skip when
					// stalled or fully lossy ("No media").
					if (!stalled.has(p.id) && status !== 'No media'
						&& this.state.activeSpeakers.indexOf(p) === -1) {
						participants.push(
							<ConferenceParticipant
								key={p.id}
								participant={p}
								selected={() => {}}
								pauseVideo={true}
								display={false}
								status={status}
								isLandscape={this.state.isLandscape}
							/>
						);
					}

					drawerParticipants.push(
						<ConferenceDrawerParticipant
							key={p.id}
							participant={p}
						/>
					);

				});
			} else {
			    //console.log('=====');
				let vtrack;
				// Push "myself" into the video tile list when:
				//   - exactly 1 remote participant → 2 tiles, 50/50 split
				//   - exactly 3 remote participants → 4 tiles, 2x2 grid
				// For other counts (0, 2, 4+), leave self as the floating
				// PIP managed elsewhere by `showMyself`. Use the visible
				// (non-stalled) count so the grid recalculates around
				// remotes whose video has gone silent.
				const visibleCount = this.visibleParticipants.length;
				// Only include "myself" in the matrix when the user
				// actually wants their video shown. Without these
				// gates the user could still appear as a tile after
				// Cancel-ing the camera-start preview (enableMyVideo:
				// false, videoMuted: true) — the gates mirror what
				// the floating PIP getter `showMyself` already
				// applies so the two surfaces are consistent.
				if ((visibleCount === 1 || visibleCount === 3)
				    && this.state.enableMyVideo
				    && !this.state.videoMuted) {
					videos.push(
						<ConferenceParticipantSelf
						  key="myself2"
						  visible={true}
						  stream={this.props.call.getLocalStreams()[0]}
						  identity={this.props.call.localIdentity}
						  audioMuted={this.state.audioMuted}
						  isLandscape={this.state.isLandscape}
						  generatedVideoTrack={this.props.generatedVideoTrack}
						  cameraFacing={this.state.cameraFacing}
						  big={true}
						  fullScreen={this.fullScreen}
						/>
					);
				}

				this.state.participants.forEach((p, idx) => {
					// Bridge participants (PSTN gateway endpoints)
					// only carry audio — there's no video track to
					// render, so a video tile for them is just a
					// black square or worse, a stretched avatar. Skip
					// them from the matrix AND the side participant
					// list AND the drawer (we early-return after the
					// gate). Audio view still shows them via the
					// dedicated SIP / bridge participant group in the
					// audioOnlyView branch. Detection mirrors the
					// audio path's _looksLikeBridge: display-name
					// contains "bridge" OR URI sits under the
					// conference domain.
					const _bridgeDn = (p.identity && p.identity._displayName) || '';
					const _bridgeUri = (p.identity && p.identity._uri) || '';
					if (/bridge/i.test(_bridgeDn) || _bridgeUri.indexOf('@conference.') > -1) {
						return;
					}
					// We still want stalled participants to show in the
					// drawer below, so we don't early-return — instead
					// each tile push is gated.
					const isStalled = stalled.has(p.id);
					status = '';
					if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
						status = 'Muted';
						//console.log(p.identity.uri, 'media lost');
					} else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
						if (this.packetLoss.get(p.id) === 100) {
							status = 'No media';
							console.log(p.identity.uri, 'has no media');
						} else {
							status = this.packetLoss.get(p.id) + '% loss';
							//console.log(p.identity.uri, 'has packet loss', status);
						}
					} else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
						status = this.latency.get(p.id) + ' ms';
					}


					if (p.streams && p.streams.length > 0) {
						if (p.streams[0].getVideoTracks().length > 0) {
							vtrack = p.streams[0].getVideoTracks()[0];
							//console.log(vtrack);
							if (vtrack.muted) {
								//console.log(p.identity.uri, 'has video explicitly muted');
								//return;
							}
						}
					}
					//console.log(p.identity.uri, 'video added');
					if (!isStalled) {
						// videoBandwidth Map is populated by
						// getConnectionStats every second from
						// the inbound-rtp stats — kbps per peer.
						// Default to undefined when no sample
						// has landed yet so the overlay can
						// suppress itself rather than render a
						// misleading "0".
						const _bwKbps = (this.videoBandwidth && this.videoBandwidth.get)
							? this.videoBandwidth.get(p.id)
							: undefined;
						videos.push(
							<ConferenceMatrixParticipant
								key = {p.id}
								participant = {p}
								pauseVideo={(idx >= 4)}
								videoBandwidth={_bwKbps}
								aspectRatio={this.state.aspectRatio}
								status={status}
							/>
						);

						if (idx >= 4 || idx >= 2 && this.props.isTablet === false) {
							participants.push(
								<ConferenceParticipant
									key={p.id}
									participant={p}
									selected={this.onVideoSelected}
									pauseVideo={true}
									display={true}
									status={status}
									isLandscape={this.state.isLandscape}
								/>
							);
						}
					}

					drawerParticipants.push(
						<ConferenceDrawerParticipant
							key={p.id}
							participant={p}
						/>
					);

				});
			}
	
			const currentParticipants = this.state.participants.map((p) => {return p.identity.uri})
			const alreadyInvitedParticipants = this.invitedParticipants ? Array.from(this.invitedParticipants.keys()) : [];		
		}

		if (this.state.callOverlayVisible) {
			buttons.bottom = floatingButtons;
			buttons.additional = [];
		}

		let corners = {
			  topLeft: { top: 0, left: 0 },
			  topRight: { top: 0, right: 0 },
			  bottomRight: { bottom: 0, right: 0 },
			  bottomLeft: { bottom: 0, left: 0},
			  id: 'init'
		};

		let buttonsContainer = this.state.isLandscape ? styles.buttonsContainerLandscape : styles.buttonsContainer;
		mediaContainer = this.state.isLandscape? styles.videoContainerLandscape : styles.videoContainer;
        
		const marginRight = this.state.isLandscape ? rightInset : 0;
		const marginBottom = this.state.isLandscape  ? -rightInset : 0;

		let audioHeight = this.state.renderMessages.length < 6 ? 300 : 240; 
		audioHeight = this.state.keyboardVisible ? 150 : audioHeight;

		const statusBarHeight = getStatusBarHeight(); 

		let navigationBarHeight = 0;

		if (Platform.OS === 'android') {
            navigationBarHeight = bottomInset;
        }

        const videoGridContainer = styles.videoGridContainer;

		debugBorderWidth = 0;

		container = {
			flex: 1,
			flexDirection: 'column',
			borderWidth: debugBorderWidth,
			borderColor: 'red',         // red    = container (outer)
		};

		// Video render: the header and buttons bar both float as
		// overlays on top of the video grid so the video fills the
		// entire parent view (no reserved strip at the top). This
		// matches typical video-call UIs (Zoom / Meet) and behaves
		// the same in portrait and landscape.
		conferenceHeader = {
		  position: 'absolute',
		  top: 0,
		  left: 0,
		  right: 0,
		  height: conferenceHeaderHeight,
		  zIndex: 2000,
		  borderWidth: debugBorderWidth,
		  borderColor: 'yellow'         // yellow = conferenceHeader (floating)
		};

		buttonsContainer = {
			position: 'absolute',
			// Floating call-bar moved from `top: conferenceHeader.height`
			// (just under the navbar) to `bottom: 50` so it matches
			// every other surface's bar height — the audio-conference
			// action bar (audioViewActionBar uses bottom:50), the 1:1
			// AudioCall and VideoCall portrait button containers, and
			// the LocalMedia / pre-call bars all sit at bottom:50.
			// The video conference is now consistent with the rest;
			// the user no longer has to look in a different place
			// when switching between call modes.
			bottom: 50,
			height: conferenceHeaderHeight,
			left: 0,
			right: 0,
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 1500,                    // above myselfContainer (1000) so the floating
			                                 // control bar stays visible & tappable when
			                                 // the solo self-view fills the whole parent.
			backgroundColor: 'transparent',  // float: only the buttons render; bar is see-through
			borderWidth: debugBorderWidth,
			borderColor: 'magenta'      // magenta = buttonsContainer (floating)
		};

		conferenceContainer = {
		  flex: 1,
		  flexDirection: this.state.isLandscape ? 'row' : 'column',
		  alignContent: this.state.isLandscape ? 'flex-end' : 'flex-start',
		  justifyContent: this.state.isLandscape ? 'flex-start' : 'flex-start',
		  marginTop: this.fullscreen ? -topInset: 0,
		  borderColor: 'blue',
		  borderWidth: debugBorderWidth,
		  marginBottom: 0,
//		  height: this.fullScreen ? height + bottomInset + topInset: height,
		  position: 'relative'
		};
					
		let videoWidth = this.state.chatView ? '50%' : '100%' ;

		mediaContainer = {
		  position: 'absolute',
		  resizeMode: 'cover',
		  height:  '100%',
		  width: '100%',
		  borderWidth: debugBorderWidth,
		  borderColor: 'lime',          // lime   = mediaContainer (absolute 100%)
		};
					
		let top = 0;
	    //console.log('width', width);
	    //console.log('height', height);
	    
		chatContainer = {
			...(this.state.isLandscape ? {} : {flex: 1}),
		  borderWidth: 0,
		  borderColor: 'gray',
		  width: '100%',
		};
	    
        if (Platform.OS === 'ios') {
		    if (this.state.isLandscape) {
		        if (this.fullScreen) {
				    corners = {
						  topLeft: { top: 0, left: 0 },
						  topRight: { top: 0, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'ios-landscape'
					};

					container = {
						width: this.fullScreen ? width: width,
						height: height,
						marginLeft: -rightInset,
						marginBottom: marginBottom,
						borderWidth: debugBorderWidth,
						borderColor: 'blue'
					};

		        } else {
				    // Landscape: call buttons live inline in the navbar,
				    // so the PIP self-view only needs to clear the header.
				    corners = {
						  topLeft: { top: conferenceHeader.height, left: 0 },
						  topRight: { top: conferenceHeader.height, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'ios-landscape'
						};

					// Stretch the container across the full window
					// width so there is no empty black space on the
					// left or right. marginLeft: -leftInset cancels
					// the native iOS left-notch offset so content
					// reaches x=0, and width: width carries it all
					// the way to the right device edge.
					container = {
						width: width,
						height: height,
						marginLeft: -leftInset,
						marginBottom: marginBottom,
						borderWidth: debugBorderWidth,
						borderColor: 'blue'
					};

					// Header is now an absolute overlay, so the
					// conferenceContainer fills the full parent height.
					conferenceContainer = {
					  flexDirection: 'row',
					  alignContent: 'flex-start',
					  justifyContent: 'flex-start',
					  height: height,
					  width: width,
					  borderColor: 'green',
					  borderWidth: debugBorderWidth,
					};

					// Leave mediaContainer at the shared default
					// (position: absolute, height: 100%, width: 100%) so
					// the video fills the container edge-to-edge with
					// the same sizing scheme used in fullscreen — no
					// vertical jump when toggling, no overflow.
				}

			} else {
				  corners = {
					  topLeft: { top: this.fullScreen ? 0 : conferenceHeader.height + buttonsContainer.height, left: 0 },
					  topRight: { top: this.fullScreen ? 0: conferenceHeader.height + buttonsContainer.height, right: 0 },
					  bottomRight: { bottom: 0, right: 0 },
					  bottomLeft: { bottom: 0, left: 0},
					  id: 'ios-portrait'
				  };

				// iOS portrait. In fullscreen we want the video to cover
				// the entire screen edge-to-edge (including the camera
				// cutout area at the top), so we simply shift the whole
				// view up by the top inset — undoing the app-level
				// SafeAreaView top padding. The height stays equal to
				// the window height, so the container bottom still lands
				// exactly at the screen's bottom edge and the PIP
				// thumbnails' `bottom: 0` positions correctly.
				container = {
				  ...(this.fullScreen ? {} : {flex: 1}),  // adds flex:1 only if fullScreen
				  top: 0,
				  left: 0,
				  flexDirection: 'column',
				  width: width,
				  height: this.fullScreen ? height : '100%',
				  marginTop: this.fullScreen ? -topInset : 0,
				  marginBottom: this.fullScreen ? 0 : marginBottom,
				  borderWidth: debugBorderWidth,
				  borderColor: 'green',
				};

				mediaContainer = {
				  position: 'absolute',
				  resizeMode: 'cover',
				  height: this.fullScreen ? height : '100%',
				  width: width,
				  borderWidth: debugBorderWidth,
				  borderColor: 'white'
				};
			}
		} else {
		    // android
		    if (this.state.isLandscape) {
				const aRightInset = Platform.Version < 34 ? rightInset + bottomInset : rightInset;
		        if (this.fullScreen) {
		             const aRightInset = Platform.Version < 34 ? 0 : rightInset;
		             console.log('aRightInset', aRightInset);
					 corners = {
						  topLeft: { top: 0, left: aRightInset },
						  topRight: { top: 0, right: -aRightInset },
						  bottomRight: { bottom: 0, right: -aRightInset },
						  bottomLeft: { bottom: 0, left: aRightInset},
						  id: 'android-landscape-fs'
					};

				} else {
				    // Landscape: call buttons live inline in the navbar,
				    // so the PIP self-view only needs to clear the header.
				    // Corners are symmetric and flush with the container
				    // edges — the previous asymmetric aRightInset offsets
				    // made the left corners sit inward by ~rightInset
				    // while the right corners extended past the container,
				    // which visually read as all thumbnails being shifted
				    // left relative to their intended corners.
				    //
				    // In non-fullscreen the Android nav bar is visible and
				    // interactive, so we let mediaContainer keep its default
				    // width:100% and size to the safe-area-clamped parent.
				    // The video grid therefore stops at the safe-area edge
				    // just like the PIP thumbnails — nothing important sits
				    // under the nav bar. (Fullscreen hides the nav bar, so
				    // the container itself is responsible for spanning the
				    // whole screen when that mode is enabled.)
				    corners = {
						  topLeft: { top: conferenceHeader.height, left: 0 },
						  topRight: { top: conferenceHeader.height, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0 },
						  id: 'android-landscape'
					};
				}

			} else {
			      // android portrait
		          if (!this.fullScreen) {
					  corners = {
						  topLeft: { top: conferenceHeader.height + buttonsContainer.height, left: 0 },
						  topRight: { top: conferenceHeader.height + buttonsContainer.height, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'android-portrait'
					  };
				  }
			}
		}
		
		if (this.state.chatView) {
			mediaContainer.height = 0;
		}
				
		let corner = {
		  ...corners[this.state.myVideoCorner],
		};

        if (this.state.chatView) {
			 corner = corners['topLeft'];
		}
					
        const gridLayoutContainer = this.getVideoLayout().container;
        const videoObjectsCount = videos.length;
        // myselfContainer is the positioning "canvas" for the floating
        // self-view PIP. On Android SDK >= 34 landscape the outer
        // MainContainer is inset by leftInset/rightInset for the
        // translucent nav bar.
        //
        // In FULLSCREEN the nav bar is hidden, so we extend the canvas
        // past the safe-area margins — corner:0 then lands at the true
        // screen edges where the edge-to-edge solo self-video reaches.
        //
        // In NON-FULLSCREEN the nav bar is visible and interactive; the
        // canvas stays inside the safe area so the right-edge PIPs don't
        // slide under the nav bar and become partially obscured. The
        // video grid below still extends to the screen edges via the
        // mediaContainer override — the PIPs intentionally stop short.
        const extendMyselfPastInsets =
            Platform.OS === 'android' && this.state.isLandscape && this.fullScreen;
        const myselfExtendLeft = extendMyselfPastInsets ? -leftInset : 0;
        const myselfExtendRight = extendMyselfPastInsets ? -rightInset : 0;
        const myselfContainer = {
				  position: 'absolute',
				  top: 0,
				  left: myselfExtendLeft,
				  right: myselfExtendRight,
				  bottom: 0,
				  zIndex: 1000,
				  pointerEvents: 'box-none'
				};


		if (debugBorderWidth) {
			const values = {
			  corners,
			  navigationBarHeight,
			  statusBarHeight,
			  topInset,
			  bottomInset,
			  leftInset,
			  rightInset,
			  container,
			  conferenceHeader,
			  buttonsContainer,
			  conferenceContainer,
			  mediaContainer,
			  myselfContainer,
			  videoGridContainer,
			  gridLayoutContainer
			};

			const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
		
			Object.entries(values).forEach(([key, value]) => {
			  const prev = this.prevValues[key];
			   const paddedKey = key.padStart(maxKeyLength, ' '); // right
			  if (JSON.stringify(prev) !== JSON.stringify(value)) {
				console.log(paddedKey, value);
			  }
			});

			this.prevValues = values;
		}

		if (debugBorderWidth) {
			videos = [];
			//buttons.bottom = [];
		}
		
		//console.log('activeSpeakers', this.state.activeSpeakers);
		
        return (
			<View 
			      key={this.state.isLandscape ? 'landscape' : 'portrait'}
			      style={container}>

                <ShareConferenceLinkModal
                    notificationCenter={this.props.notificationCenter}
                    show={this.state.showInviteModal && !this.state.reconnectingCall}
                    close={this.toggleInviteModal}
                    conferenceUrl={conferenceUrl}
                    conferenceRoom={conferenceRoom}
                    sylkDomain={this.props.sylkDomain}
                    conferenceSettings={this.props.conferenceSettings}
                />
                    
 				{!this.fullScreen || this.state.chatView ?

				<View style={conferenceHeader}>
					<ConferenceHeader
					    visible={true}
						remoteUri={this.state.remoteUri}
						callContact={this.props.callContact}
						isTablet={this.props.isTablet}
						isLandscape={this.state.isLandscape}
						/* Same folded-mode kebab-item gate as the
						   audio-only render path above — see that
						   block for the rationale. */
						isFolded={this.props.isFolded}
						call={this.state.call}
						participantsCount={_otherParticipantsCount}
						serverDuration={this.state.conferenceDurationAtJoin}
						videoParticipantCount={_remoteVideoSpeakerCount}
						reconnectingCall={this.state.reconnectingCall}
						buttons={buttons}
						audioOnly={this.audioOnlyView}
						toggleViewMode={this.toggleViewMode}
						toggleAspectRatio={this.toggleAspectRatio}
						terminated={this.state.terminated}
						info={this.state.info}
						goBackFunc={this.props.goBackFunc}
						toggleInviteModal={this.toggleInviteModal}
						bridgePresent={!!this._bridgePresent}
						showBridge={this.state.showBridge}
						toggleBridgeVisibility={this.toggleBridgeVisibility}
						inviteToConferenceFunc={this.props.inviteToConferenceFunc}
						callState={this.props.callState}
						toggleAudioParticipantsFunc={this.toggleAudioParticipants}
						toggleChatFunc={this.toggleChat}
						hangUpFunc={this.hangup}
						audioView={this.state.audioView}
						chatView={this.state.chatView}
						audioChatView={this.state.audioChatView}
						toggleAudioChatViewFunc={this.toggleAudioChatView}
						toggleDrawer={this.toggleDrawer}
						toggleSpeakerSelection={this.toggleSpeakerSelection}
						enableMyVideo={this.state.enableMyVideo}
						toggleMyVideo={this.toggleMyVideo}
						/* Used by the audio-view Video... submenu
						   for the Stop / Start video row. Toggle
						   wraps the existing muteVideo /
						   _resumeVideo pair so a single tap can
						   move either direction.
						   Unmute branch also force-restores the
						   mirror if it was previously hidden — see
						   the matching note on the camera picker's
						   unmute row above for the rationale. */
						videoMuted={this.state.videoMuted}
						toggleVideoMute={() => {
						    if (this.state.videoMuted) {
						        const next = {videoMutedbyUser: false};
						        if (this.state.enableMyVideo === false) {
						            next.enableMyVideo = true;
						        }
						        this.setState(next);
						        this._resumeVideo();
						    } else {
						        this.muteVideo();
						    }
						}}
						/* Forwarded so the Video... submenu can
						   disable Hide/Show mirror when there is no
						   remote tile to view alongside. */
						participants={this.state.participants}
						/* Opens the camera picker overlay from the
						   kebab's "Video..." item. Same panel the
						   call-bar video button toggles.
						   Mutually exclusive with the audio picker:
						   opening one closes the other so only one
						   floating panel is on screen at a time
						   (avoids two overlapping pickers stacked
						   on top of each other when the user jumps
						   between the kebab's Audio... and Video...
						   entries). */
						openVideoPicker={() => this.setState({
						    videoPickerVisible: true,
						    audioDevicePickerVisible: false,
						})}
						/* Opens the audio device picker overlay
						   from the kebab's "Audio..." item. Same
						   panel the call-bar audio button toggles
						   (renderAudioDevicePicker's "floating" /
						   "menu" variants both read
						   audioDevicePickerVisible). Closes the
						   video picker for the same one-at-a-time
						   reason. */
						openAudioPicker={() => this.setState({
						    audioDevicePickerVisible: true,
						    videoPickerVisible: false,
						})}
						/* Tapping the kebab again resets device
						   pickers. Single setState clears both so
						   the call bar returns to its idle "no
						   picker open" state in one render. */
						closeMediaPickers={() => this.setState({
						    audioDevicePickerVisible: false,
						    videoPickerVisible: false,
						})}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						insets = {this.state.insets}
						useInCallManger = {this.props.useInCallManger}
					/>
				</View>

				: null}

				{/* Floating per-participant bandwidth overview.
				    Always rendered while the call is up (video or
				    audio view) so the user can see the throughput
				    for EVERY stream in the room, including ones
				    that aren't currently visible in the matrix
				    (stalled, off-screen at counts > 4, or hidden
				    while the user is in audio view). Self goes
				    first (outbound bytes; populated by the
				    same getConnectionStats path that handles
				    inbound for remotes). Position: top-left,
				    just below the safe-area inset. Compact
				    monospace-ish font so digits don't jitter.
				    The per-tile chip in ConferenceMatrixParticipant
				    remains — that's the contextual reading on the
				    visible tile; this overlay is the room
				    summary. */}
				{this.state.call ? this._renderBandwidthOverview() : null}

				{/* Fullscreen-only "i" info icon at top-right; tap to
				    reveal speedometer; tap dials to collapse back.
				    In landscape (not fullscreen) the speedometer is
				    rendered inside the navbar via navbarExtras.
				    In portrait (not fullscreen) nothing is shown — use the
				    i icon after going fullscreen. */}
				{this.fullScreen && this.state.call && !this.audioOnlyView ? (
					<View
						style={{
							position: 'absolute',
							top: (this.state.insets && this.state.insets.top ? this.state.insets.top : 0) + 12,
							right: (this.state.insets && this.state.insets.right ? this.state.insets.right : 0) + 4,
							zIndex: 9999,
						}}
					>
						{this.state.showUsage ? (
							<TouchableOpacity
								activeOpacity={0.7}
								onPress={() => this.setState({ showUsage: false })}
								style={{
									backgroundColor: 'rgba(0,0,0,0.35)',
									borderRadius: 6,
									paddingHorizontal: 4,
									paddingVertical: 2,
								}}
							>
								<NetworkSpeedometer
									call={this.state.call}
									showResolution
								/>
							</TouchableOpacity>
						) : (
							<TouchableOpacity
								activeOpacity={0.7}
								onPress={() => this.setState({ showUsage: true })}
								style={{
									width: 32,
									height: 32,
									borderRadius: 16,
									backgroundColor: 'rgba(0,0,0,0.45)',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<Icon
									name="information-outline"
									size={20}
									color="#ffffff"
								/>
							</TouchableOpacity>
						)}
					</View>
				) : null}

				{!this.fullScreen && !this.props.isLandscape && !this.state.showDrawer ?
				<View style={buttonsContainer} pointerEvents="box-none">
					{buttons.bottom}
				</View>
				: null}

				<View style={conferenceContainer}>
				   {!this.state.keyboardVisible && !this.state.chatView?  // videos show up here
					<TouchableWithoutFeedback onPress={this.toggleFullScreen}>
						<View style={[mediaContainer]}>
							<View style={[videoGridContainer, gridLayoutContainer]}>
								{videos.length === 0 ? (
									<View style={{
										flex: 1,
										width: '100%',
										justifyContent: 'center',
										alignItems: 'center',
										padding: 24,
									}}>
										<Text style={{
											color: 'white',
											fontSize: 18,
											textAlign: 'center',
										}}>
											No video participants
										</Text>
									</View>
								) : (
									videos.slice(0, 4).map((video, index) => (
										<View key={index} style={this.getVideoLayout().item}>
											{video}
										</View>
									))
								)}
							</View>
						</View>
					</TouchableWithoutFeedback>
					: null}

				{this.state.chatView && Platform.OS === 'android'?
					<KeyboardAvoidingView
					  key={this.state.isLandscape ? 'landscape' : 'portrait'} // re-layout when rotate or keyboard changes
					  style={chatContainer}
					  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
					  // In the VIDEO render path the conferenceHeader is
					  // absolute-positioned (overlay) — see
					  // `conferenceHeader.position: 'absolute'` ~3386 and
					  // the matching mediaContainer at 3428 — so the
					  // chat KAV starts at the top of the
					  // conferenceContainer (y ≈ 0 in fullscreen,
					  // y ≈ topInset otherwise) rather than below a
					  // header that takes layout space. The audio
					  // branch's offset (`conferenceHeaderHeight +
					  // topInset`) reserves space the video chat
					  // doesn't owe, and the extra 60 px is exactly
					  // what was lifting the input row above the
					  // keyboard — matching the user-reported
					  // "hovering up" with a flush-to-keyboard input
					  // working fine in audio-only conferences (same
					  // KAV pattern but the audio header IS in flow
					  // so the offset is correct there).
					  keyboardVerticalOffset={this.fullScreen ? 0 : topInset}
					>

					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
					  messages={renderMessages}
					  isTyping={this.state.isTyping}
					  onLongPress={this.onLongMessagePress}
					  onSend={this.onSendMessage}
					  renderCustomView={this.renderCustomView}
					  renderSend={this.renderSend}
					  renderBubble={this.renderBubble}
					  renderMessageImage={this.renderMessageImage}
					  renderMessageVideo={this.renderMessageVideo}
					  shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
					  alwaysShowSend={true}
					  scrollToBottom
					  lockStyle={styles.lock}
					  inverted={true}
					  timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
					  infiniteScroll
					/>
				   </KeyboardAvoidingView>
				:

				<View style={styles.carouselContainer}>
					<ConferenceCarousel align={'right'}>
						{participants}
					</ConferenceCarousel>
				</View>
				}

				{this.state.chatView && Platform.OS === 'ios' ?
					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
					  messages={renderMessages}
					  isTyping={this.state.isTyping}
					  onLongPress={this.onLongMessagePress}
					  onSend={this.onSendMessage}
					  renderCustomView={this.renderCustomView}
					  renderSend={this.renderSend}
					  renderBubble={this.renderBubble}
					  renderMessageImage={this.renderMessageImage}
					  renderMessageVideo={this.renderMessageVideo}
					  shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
					  alwaysShowSend={true}
					  scrollToBottom
					  lockStyle={styles.lock}
					  inverted={true}
					  timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
					  infiniteScroll
					/>
				:
				<View style={styles.carouselContainer}>
					<ConferenceCarousel align={'right'}>
						{participants}
					</ConferenceCarousel>
				</View>
				}

			</View>
			  <View
				style={myselfContainer}
			  >
				{(() => {
				  // Resolve the PIP position for the non-solo branch:
				  // honour the dragged pipPosition when it's a valid
				  // on-screen rect, otherwise fall back to the default
				  // top-right-under-navbar placement. Re-clamps on every
				  // render so an orientation change doesn't strand the
				  // PIP off-screen. Same logic the audio-view PIP uses.
				  const _winDims = Dimensions.get('window');
				  const _saved = this.state.pipPosition;
				  const _valid = _saved
				      && _saved.x >= 0
				      && _saved.y >= 0
				      && _saved.x + this._PIP_W <= _winDims.width
				      && _saved.y + this._PIP_H <= _winDims.height;
				  const _videoPipPos = _valid ? _saved : this._getDefaultPipPosition();
				  const _isSoloFullscreen = SOLO_SELF_FULLSCREEN && !this.audioOnlyView && this.visibleParticipants.length === 0;
				  return (
				<View
				  // In solo-fullscreen the self-video covers the whole parent,
				  // which would otherwise intercept taps and hide the floating
				  // control bar that lives behind it in tree order. We set
				  // pointerEvents="none" so taps fall through to the button bar
				  // (and header), keeping the controls tappable and persistent.
				  pointerEvents={_isSoloFullscreen ? 'none' : 'auto'}
				  // Drag handlers wired to the existing _pipPanResponder
				  // (shared with the audio-view PIP). PanResponder claims
				  // the gesture only after a ~5 px move, so quick taps
				  // still reach overlays inside the PIP wrapper without
				  // immediately initiating a drag.
				  {...(!_isSoloFullscreen ? this._pipPanResponder.panHandlers : {})}
				  style={
					_isSoloFullscreen
					  ? {
						  // Fill the entire parent edge-to-edge. Parent
						  // (myselfContainer) is already extended past the
						  // safe area on Android landscape, so a simple
						  // 0/0/0/0 rectangle reaches the actual screen
						  // edges on iOS and Android alike.
						  position: 'absolute',
						  top: 0,
						  bottom: 0,
						  left: 0,
						  right: 0,
						}
					  : {
						  position: 'absolute',
						  width: 120,
						  height: 160,
						  left: _videoPipPos.x,
						  top: _videoPipPos.y,
						}
				  }
				>
				  <View
					style={{ flex: 1 }}
				  >
					{/* Key includes viewMode + enableMyVideo so the
				    component fully remounts whenever the parent
				    toggles either. ConferenceParticipantSelf
				    captures props.visible into its own state at
				    construction and updates it via componentWill-
				    ReceiveProps — that path was leaving the PIP
				    stuck-hidden across an audio→video toggle even
				    after showMyself flipped to true (the kebab
				    title would correctly read "Hide mirror" but
				    the PIP wouldn't appear until a manual hide+
				    show cycle forced a fresh receiveProps pass).
				    Keying off the trigger inputs guarantees a
				    clean mount with the right visible prop. */}
				<ConferenceParticipantSelf
					  key={'myself2-' + this.state.viewMode + '-' + (this.state.enableMyVideo ? '1' : '0')}
					  visible={this.showMyself}
					  stream={this.props.call.getLocalStreams()[0]}
					  identity={this.props.call.localIdentity}
					  audioMuted={this.state.audioMuted}
					  isLandscape={this.state.isLandscape}
					  generatedVideoTrack={this.props.generatedVideoTrack}
					  cameraFacing={this.state.cameraFacing}
					  big={SOLO_SELF_FULLSCREEN && !this.audioOnlyView && this.visibleParticipants.length === 0}
					  fullScreen={this.fullScreen}
					  aspectRatio={this.state.aspectRatio}
					/>
				  </View>
				  {/* Close (×) button overlaying the top-right of
				      the mirror PIP. Tap → enableMyVideo=false →
				      showMyself returns false → PIP is suppressed
				      on the next render. Bring it back via the
				      kebab's "Show mirror" item. The outer wrapper
				      View handles drag via PanResponder (which only
				      claims the gesture after ~5 px of movement, so
				      a quick tap on the X reaches this handler
				      first). Only rendered when self is actually in
				      the floating PIP (showMyself=true). */}
				  {this.showMyself ? (
				    <TouchableOpacity
				      onPress={() => this.setState({enableMyVideo: false})}
				      accessibilityRole="button"
				      accessibilityLabel="Close mirror"
				      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
				      style={{
				        position: 'absolute',
				        top: 4,
				        right: 4,
				        zIndex: 1600,
				        width: 22,
				        height: 22,
				        borderRadius: 11,
				        backgroundColor: 'rgba(0,0,0,0.55)',
				        justifyContent: 'center',
				        alignItems: 'center',
				      }}
				    >
				      <Icon name="close" size={16} color="#ffffff" />
				    </TouchableOpacity>
				  ) : null}
				</View>
				  );
				})()}

			  </View>

			<ConferenceDrawer
				show={this.state.showDrawer && !this.state.reconnectingCall}
				close={this.toggleDrawer}
				isLandscape={this.state.isLandscape}
				title="Room configuration"
			>
				<View style={this.state.isLandscape ? [{maxHeight: Dimensions.get('window').height - conferenceHeaderHeight}, styles.landscapeDrawer] : styles.container}>
					<View style={{flex: this.state.isLandscape ? 1 : 2}}>
						<ConferenceDrawerSpeakerSelectionWrapper
							selectSpeaker={this.startSpeakerSelection}
							activeSpeakers={this.state.activeSpeakers}
							closeDrawer={this.toggleDrawer}
						/>
						<ConferenceDrawerParticipantList style={styles.container}>
							{drawerParticipants}
						</ConferenceDrawerParticipantList>
					</View>
				</View>
			</ConferenceDrawer>

			{/* New unified speaker-layout modal.
			    Replaces the legacy two-step flow (room-config drawer
			    → per-slot picker). The modal owns Grid / 1-speaker /
			    2-speaker mode tabs at the top and the per-column
			    participant pickers below. On Apply we forward the
			    chosen publisherIds to configureRoom — empty array
			    clears all pins (Grid). */}
			<SpeakerSelectionModal
				show={this.state.showSpeakerSelection}
				close={this.toggleSpeakerSelection}
				participants={speakerSelectionParticipants}
				activeSpeakers={this.state.activeSpeakers}
				onApply={this.applySpeakerLayout}
			/>

			{/* "Start your camera?" prompt — fires once per
			    conference session, the moment any remote
			    participant is detected sending video bytes
			    while we're still in audio view (see the latch
			    in getConnectionStats / _autoEscalatedToVideo).
			    Reuses the existing UpgradeVideoModal so the
			    confirmation flow looks identical to the 1:1
			    audio→video upgrade prompt. Direction is
			    'incoming' because from the user's perspective
			    SOMEONE ELSE is bringing video to the call —
			    same wording: "wants to add video to this call".
			    Accept → toggleViewMode (which resumes the
			    camera). Cancel → stay audio-only; latch
			    prevents re-prompting. */}
			{/* First-time audio→video toggle preview. Same look as
			    Call.js's mid-call audio→video upgrade prompt:
			    local-camera preview in the upper portion + an
			    "Enable your camera?" action panel at the bottom
			    with Cancel / Enable camera buttons. Fires once per
			    conference session. */}
			<StartCameraPreviewModal
				visible={this.state.cameraStartPreviewVisible}
				localStream={this.props.call && this.props.call.getLocalStreams ? this.props.call.getLocalStreams()[0] : null}
				onStart={this.onCameraStartPreviewAccept}
				onCancel={this.onCameraStartPreviewCancel}
			/>

			<UpgradeVideoModal
				visible={this.state.cameraPromptVisible}
				direction="incoming"
				remoteUri={this.state.cameraPromptRemoteUri}
				remoteDisplayName={(() => {
					const u = this.state.cameraPromptRemoteUri;
					if (!u) return '';
					const c = this.foundContacts && this.foundContacts.get(u);
					return (c && c.displayName) ? c.displayName : (u.split('@')[0] || u);
				})()}
				onAccept={this.onCameraPromptAccept}
				onReject={this.onCameraPromptReject}
				onHide={this.onCameraPromptReject}
			/>
		</View>
        );
    }
}

ConferenceBox.propTypes = {
    notificationCenter  : PropTypes.func.isRequired,
    call                : PropTypes.object,
    connection          : PropTypes.object,
    hangup              : PropTypes.func,
    saveParticipant     : PropTypes.func,
    updateContactOnConferenceInvite : PropTypes.func,
    saveConferenceMessage: PropTypes.func,
    updateConferenceMessage : PropTypes.func,
    deleteConferenceMessage : PropTypes.func,
    messages            : PropTypes.array,
    previousParticipants: PropTypes.array,
    remoteUri           : PropTypes.string,
    generatedVideoTrack : PropTypes.bool,
    toggleMute          : PropTypes.func,
    toggleSpeakerPhone  : PropTypes.func,
    speakerPhoneEnabled : PropTypes.bool,
    isLandscape         : PropTypes.bool,
    isTablet            : PropTypes.bool,
    muted               : PropTypes.bool,
    defaultDomain       : PropTypes.string,
    pstnRules           : PropTypes.object,
    ensurePstnCallerIdCaptured: PropTypes.func,
    inFocus             : PropTypes.bool,
    reconnectingCall    : PropTypes.bool,
    audioOnly           : PropTypes.bool,
    initialParticipants : PropTypes.array,
    terminated          : PropTypes.bool,
    allContacts         : PropTypes.array,
    lookupContact       : PropTypes.func,
    goBackFunc          : PropTypes.func,
    inviteToConferenceFunc: PropTypes.func,
    selectedContacts    : PropTypes.array,
    callState           : PropTypes.object,
    callContact         : PropTypes.object,
    finishInvite        : PropTypes.func,
    account             : PropTypes.object,
    messages            : PropTypes.object,
    getMessages         : PropTypes.func,
    fileSharingUrl      : PropTypes.string,
    sendConferenceMessage   : PropTypes.func,
    useInCallManger         : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
    publicUrl               : PropTypes.string,
    insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func,
	sylkDomain              : PropTypes.string

};

export default ConferenceBox;
