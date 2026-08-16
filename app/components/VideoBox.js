import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors, Menu, Dialog, Button, Portal, Text as PaperText } from 'react-native-paper';
import getMenuTheme from '../menuTheme';
import { getZrtpSession, constantTimeStringEqual, formatEncryptedKindsLabel, formatVerifiedTimestamp,
         reapplyVideoEncoderParams } from './CallZrtp';
import { View, Text, Dimensions, TouchableWithoutFeedback, TouchableOpacity, Platform, TouchableHighlight, PanResponder, DeviceEventEmitter, PixelRatio, NativeModules, findNodeHandle, Alert  } from 'react-native';
import uuid from 'react-native-uuid';
import DeferredRTCView from './DeferredRTCView';
import UserIcon from './UserIcon';
// RNCamera is used ONLY for the camera-enable modal preview tile —
// a native AVCaptureSession / CameraX-backed view that is completely
// independent of the webrtc pipeline. This lets us show a live local
// preview during the modal phase without having to keep the webrtc
// sender active (which on both iOS and Android causes the
// webrtc-managed capture to pause when the sender is gated). The
// RNCamera component is unmounted when the user picks Enable / Audio-
// only so its camera handle is released before we re-engage the
// webrtc capture pipeline. webrtc still owns the camera for the
// actual call; RNCamera only borrows it briefly for the preview.
import CameraPreview from './CameraPreview';
import {StatusBar} from 'react-native';
import Immersive from '../immersive';
import { StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import Icon from '@react-native-vector-icons/material-design-icons';

import { mediaDevices, ScreenCapturePickerView } from 'react-native-webrtc';
import CallOverlay from './CallOverlay';
import { CAP_SCREEN_SHARING, getPeerCallCapabilities } from './CallCapabilities';
import NetworkSpeedometer from './NetworkSpeedometer';
import MediaInfoPanel from './MediaInfoPanel';

import EscalateConferenceModal from './EscalateConferenceModal';
import InCallManager from 'react-native-incall-manager';

//import TrafficStats from './BarChart';
import utils from '../utils';
import { startQosLogging, stopQosLogging } from '../../qos/qos-stats';

import styles from '../assets/styles/VideoCall';

const DEBUG = debug('blinkrtc:Video');
//debug.enable('*');


const MAX_POINTS = 30;

// How long the peer's video track may stay muted, while they claim to be
// screen sharing, before we tell the viewer the picture is stale.
//
// Note what this can and cannot mean. Android's mirrored VirtualDisplay only
// produces a frame when the screen content CHANGES, so "no frames" is exactly
// what a healthy share of a motionless screen looks like — it is indis-
// tinguishable at the transport layer from a capture that has died. So the cue
// this drives is deliberately neutral ("no updates"), not an accusation
// ("stalled/broken"), and the delay is long enough that a peer reading a static
// document does not trip it every few seconds. It exists because on 2026-08-16
// a deadlocked capture left a viewer staring at a frozen frame for 52 seconds
// with no cue at all.
const REMOTE_SHARE_STALL_MS = 15000;

// Audio device picker variant. Change this value to switch styles:
//   'cycle'    - tap the button to cycle through available devices (legacy behaviour)
//   'menu'     - react-native-paper dropdown Menu with device icon + name per row
//   'floating' - WhatsApp-style: extra IconButtons float above the main button
const AUDIO_DEVICE_PICKER_MODE = 'floating';

function appendBits(bits) {
    let i = -1;
    const byteUnits = 'kMGTPEZY';
    do {
        bits = bits / 1000;
        i++;
    } while (bits > 1000);

    return `${Math.max(bits, 0.1).toFixed(bits < 100 ? 1 : 0)} ${byteUnits[i]}bits/s`;
};


class VideoBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        // [video-preview] trace: what does VideoBox see at mount time?
        // The most common failure mode for "preview not appearing on
        // accept" is the constructor running BEFORE getLocalMedia has
        // resolved — props.localMedia is null and
        // call.getLocalStreams() returns an empty array. Log enough to
        // see which of those is the case in the field.
        try {
            const _c = props && props.call;
            const _callLs = (_c && typeof _c.getLocalStreams === 'function')
                              ? _c.getLocalStreams() : [];
            const _lmTracks = (props && props.localMedia
                              && typeof props.localMedia.getTracks === 'function')
                                ? props.localMedia.getTracks() : [];
            console.log('[video-preview] VideoBox constructor',
                'call_id=' + ((_c && (_c.id || _c._callId)) || '?'),
                'direction=' + ((_c && _c.direction) || '?'),
                'call.localStreams.len=' + _callLs.length,
                'props.localMedia=' + (props.localMedia ? 'set' : 'null'),
                'props.localMedia.tracks=' + _lmTracks.length,
                'props.videoMuted=' + !!props.videoMuted);
        } catch (e) {
            console.log('[video-preview] VideoBox constructor trace threw:',
                (e && e.message) || String(e));
        }

        // Per-mount key used by the remote RTCView. Stable within a
        // single mount (so re-renders don't churn the native view)
        // but unique per instance — every fresh constructor call
        // gets a new key, which is what we want when this VideoBox
        // remounts after a navigation cycle. See the comment on the
        // RTCView usage below for the M124 surface-binding bug this
        // works around.
        this._remoteRtcMountKey = 'rtc-remote-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

        this.state = {
            remoteUri: this.props.remoteUri,
            photo: this.props.photo,
            remoteDisplayName: this.props.remoteDisplayName,
            call: this.props.call,
            reconnectingCall: this.props.reconnectingCall,
            audioMuted: this.props.muted,
            // Source of truth for `videoMuted` is the actual local
            // video track's `enabled` state — that's what we toggle
            // when the user taps Mute Camera / Enable Camera. The
            // `props.videoMuted` snapshot is only meaningful at the
            // very first mount of a call (it tells us "the callee
            // answered an incoming video call with the camera off").
            // On every subsequent remount (the user backgrounds and
            // returns to the call view), reading the prop instead of
            // the track would resurrect the muted state even after
            // they'd already enabled the camera. Read the track when
            // we have one; fall back to the prop on first mount.
            videoMuted: (() => {
                try {
                    const ls = (this.props.call && this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0])
                        || this.props.localMedia;
                    if (ls && ls.getVideoTracks) {
                        const tracks = ls.getVideoTracks();
                        if (tracks && tracks.length > 0 && typeof tracks[0].enabled === 'boolean') {
                            return tracks[0].enabled === false;
                        }
                    }
                } catch (e) { /* fall through to prop fallback */ }
                return !!this.props.videoMuted;
            })(),
            terminatedReason: this.props.terminatedReason,
            mirror: true,
            callOverlayVisible: true,
            // Visibility of the network speedometer in the fullscreen
            // overlay. Hidden by default; user taps the "i" info icon
            // (top-right) to reveal it, taps the dials themselves to
            // hide again. Header-embedded speedometer in CallOverlay
            // is removed entirely — fullscreen-only.
            showUsage: false,
            // Drag-set position for the network speedometer overlay.
            // null = use the default top-left anchor (see
            // _getDefaultSpeedoPosition). Mirrors the ConferenceBox
            // implementation.
            speedoPosition: null,
            showMyself: true,
            remoteVideoShow: true,
            // Whether the remote party is currently sending live video.
            // false → we cover the black RTCView with their avatar (see
            // _attachRemoteVideoTrackListeners + render). Seeded from the
            // current remote track so a mid-call remount doesn't flash the
            // avatar over already-playing video.
            remoteVideoActive: (() => {
                const rs = (this.props.call.getRemoteStreams && this.props.call.getRemoteStreams()[0]) || null;
                const t = (rs && rs.getVideoTracks) ? rs.getVideoTracks()[0] : null;
                return !!(t && t.muted !== true);
            })(),
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            // Conference-request confirmation dialog (Material paper
            // Dialog rendered in this file's render method). Mirrors
            // AudioCallBox.state.showConferenceRequestPanel — same
            // peer-to-peer handshake (application/sylk-message-metadata
            // with action='conference_request') for escalating a 1-1
            // video call into a multi-party conference. Replaces the
            // earlier `EscalateConferenceModal` text-input flow that
            // never worked correctly on Android (see
            // EscalateConferenceModal.js for the Platform-import bug).
            showConferenceRequestPanel: false,
            conferenceRequestPending: false,
            conferenceRequestPendingId: null,
            // Screen-share REQUEST (kebab -> "Request screen"): we are
            // asking the PEER to share THEIR screen. Distinct from
            // `screenSharing` below, which is about OUR own capture.
            // True between sending the request and the peer's
            // accept/reject reply (or the 60 s expiry), which is what
            // greys the menu item out to "Requesting screen...".
            screenRequestPending: false,
            screenRequestPendingId: null,
            // Transient one-line banner over the video reporting the
            // outcome of a request we sent ("... declined to share
            // their screen"). Self-clears after a few seconds.
            screenRequestNotice: null,
            // Bumped whenever the local video TRACK is replaced inside the
            // existing local stream (camera restart after a share). Feeds the
            // self-view RTCView's remount key — see _videoRemountKey.
            localViewEpoch: 0,
            // Render-only override for the self-view.
            //
            // When _restartCameraCapture re-acquires the camera it swaps the
            // fresh track into the EXISTING localStream (so every consumer of
            // state.localStream.getVideoTracks()[0] — mute, camera switch,
            // sender re-attach — keeps working). But the RTCView does not
            // resolve tracks through JS: it hands stream.toURL() to the native
            // side, which looks the stream up in WebRTCModule's registry and
            // binds to the track IT has recorded there. A JS-side
            // removeTrack/addTrack does not reliably update that native
            // membership, so the renderer stays attached to the track we just
            // disposed and paints black — even though the wire is fine,
            // because the SENDER was given the new track directly.
            //
            // So render the self-view from the stream getUserMedia actually
            // returned. Kept separate from state.localStream rather than
            // replacing it: cWRP recomputes localStream from
            // call.getLocalStreams()[0] / props.localMedia on every prop
            // change and would clobber it straight back.
            //
            // Seeded from the CALL, because this state cannot start empty on a
            // remount. Every share navigates to the chat and back, so VideoBox
            // is a NEW instance after each one — and only the first stop after
            // a camera re-acquire runs _restartCameraCapture. On the second
            // and later cycles the camera is fine and no restart happens, so
            // nothing would re-establish the override: a fresh instance would
            // fall back to state.localStream, whose NATIVE track binding is
            // still the disposed original camera track, and the self-view
            // would come back stuck while the wire stayed perfectly healthy.
            localViewStream: (this.props.call && this.props.call._sylkLocalViewStream) || null,
            // What the PEER told us it can do, from its one-shot
            // advertisement at call setup (components/CallCapabilities.js).
            // Seeded from the call because the advertisement may well have
            // landed before this component mounted -- and because it must
            // survive the unmount/remount cycle of navigating away from the
            // call screen. Empty = older peer; capability-gated controls
            // stay hidden.
            peerCapabilities: getPeerCallCapabilities(this.props.call),
            callContact: this.props.callContact,
            selectedContact: this.props.selectedContact,
            selectedContacts: this.props.selectedContacts,
            // Use props.localMedia as a fallback when the call isn't yet
            // answered (incoming calls now render VideoBox directly,
            // before the SDP answer attaches streams to the peer
            // connection). The remote stream stays null until 'established'.
            localStream: (this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0])
                         || this.props.localMedia
                         || null,
            remoteStream: (this.props.call.getRemoteStreams && this.props.call.getRemoteStreams()[0]) || null,
            localMedia: this.props.localMedia,
            statistics: [],
            myVideoCorner: 'topLeft',
            // Drag-set position for the self-view PIP thumbnail.
            // null = use the default anchor (top-left, below the
            // header). Replaces the old corner cycling behaviour.
            selfThumbPosition: null,
            fullScreen: false,
            enableMyVideo: true,
            swapVideo: false,
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets,
			isLandscape: this.props.isLandscape,
			aspectRatio: 'cover',
			audioDevicePickerVisible: false,
			cameraFacing: 'front',
			// True while the outgoing video is a getDisplayMedia() screen
			// capture instead of a camera. Drives the picker (Share Screen
			// vs Stop Sharing) and the bar-button glyph. The share's state
			// (tracks, sender, encoder snapshot) lives on the CALL object
			// (call._sylkScreenShare), NOT this component — so it survives
			// VideoBox unmounting/remounting as the user navigates between
			// screens in the app while sharing. Seed from the call so a
			// remount during an active share comes up in the sharing state.
			screenSharing: !!(this.props.call && this.props.call._sylkScreenShare),
			// Remote-pointer (screen-share guidance). While pointerMode is on, a
			// tap on the remote video is sent to the peer as a normalized guide
			// coordinate (application/sylk-pointer) instead of toggling fullscreen,
			// and the remote view is forced to 'contain' so the whole shared screen
			// is visible and the tap maps exactly.
			pointerMode: false,
			remoteVideoSize: null,
			remoteVideoLayout: null,
			// True when the PEER told us (application/sylk-screen-sharing 'start')
			// they're sharing: gates the pointer button to the NON-sharing side only
			// while the peer shares, and proves the peer supports the pointer
			// protocol. Seeded from the call if the signal beat our mount.
			remotePeerSharing: !!(this.props.call && this.props.call._remotePeerSharing),
			// The peer said they are sharing, but their video track has been
			// muted (no RTP) long enough that the picture on screen is stale.
			// Drives a viewer-side "stalled" cue so a dead share is never
			// mistaken for a static one — see _remoteVideoOnMute.
			remoteShareStalled: false,
			videoPickerVisible: false,
            // ZRTP state, mirroring AudioCallBox.
            zrtpState: null,
            zrtpDialogVisible: false,
            // Media-stuck pill + info-panel visibility, mirroring
            // AudioCallBox. mediaStuck is latched true by CallZrtp.js's
            // activity poller when the call sits at 'key-agreed' for
            // >5s with no inbound RTP. mediaInfoPanelVisible toggles the
            // shared <MediaInfoPanel /> modal; the panel owns its own
            // pc.getStats() poller while visible.
            mediaStuck: false,
            mediaInfoPanelVisible: false,
            // zRTP-mandatory handshake-failed prompt — same logic as
            // AudioCallBox.
            zrtpMandatoryFailedVisible: false,
            zrtpMandatoryFailedInfo: null,
            // "Enable your camera?" prompt — fires once at mount when an
            // iOS callee answered a video call with the camera defaulted
            // to muted (set in app.js render). Outgoing callers and
            // already-unmuted incoming calls skip the prompt.
            //
            // Sticky-dismiss: the dismiss flag lives on the call object
            // (which has the same identity for the entire call lifetime,
            // even when this component unmounts/remounts as the user
            // backgrounds the call view and returns). Without this the
            // prompt re-appeared on every re-entry of the call screen
            // because the constructor re-evaluated visibility from the
            // raw videoMuted state. The flag is set in _onKeepAudioOnly
            // / _onEnableCamera; once set we never show the prompt
            // again for this call.
            videoEnableDialogVisible: this.props.call
                && (
                    (this.props.call.direction === 'incoming' && !!this.props.videoMuted)
                    || !!this.props.cameraInitiallyMuted
                )
                && !this.props.call._sylkCameraPromptHandled
                && !(this.props.call && this.props.call._zrtpStrictNoVideo),
            // Mirror of call._zrtpStrictNoVideo so a re-render fires when
            // CallZrtp emits 'zrtpStrictH264VideoDrop'. When true the
            // camera prompt and the local preview are suppressed.
            zrtpStrictNoVideo: !!(this.props.call && this.props.call._zrtpStrictNoVideo),
        };

		this.prevStats = {}; // initialize here
		this.prevValues = {};
        this.overlayTimer = null;

        // PanResponder for the i/speedometer view at the top-left of
        // the video. 15dp threshold so a normal tap (to toggle
        // showUsage) doesn't get hijacked as a drag. Mirrors the
        // implementation in ConferenceBox.
        this._SPEEDO_W = 200;
        this._SPEEDO_H = 110;
        this._speedoDragStart = null;
        this._speedoPanResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onStartShouldSetPanResponderCapture: () => false,
            onMoveShouldSetPanResponder: (_e, g) =>
                Math.abs(g.dx) > 15 || Math.abs(g.dy) > 15,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
                Math.abs(g.dx) > 15 || Math.abs(g.dy) > 15,
            onPanResponderGrant: () => {
                this._speedoDragStart = this.state.speedoPosition
                    || this._getDefaultSpeedoPosition();
            },
            onPanResponderMove: (_e, g) => {
                if (!this._speedoDragStart) return;
                const { width, height } = Dimensions.get('window');
                let x = this._speedoDragStart.x + g.dx;
                let y = this._speedoDragStart.y + g.dy;
                x = Math.max(0, Math.min(width - this._SPEEDO_W, x));
                y = Math.max(0, Math.min(height - this._SPEEDO_H, y));
                this.setState({ speedoPosition: { x, y } });
            },
            onPanResponderRelease: () => { this._speedoDragStart = null; },
            onPanResponderTerminate: () => { this._speedoDragStart = null; },
        });

        // PanResponder for the self-view PIP thumbnail. Lower 5dp
        // threshold so the thumbnail follows the finger immediately —
        // we no longer have a tap-to-cycle behaviour competing for
        // the gesture.
        this._selfThumbDragStart = null;
        this._selfThumbPanResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onStartShouldSetPanResponderCapture: () => false,
            onMoveShouldSetPanResponder: (_e, g) =>
                Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
            onMoveShouldSetPanResponderCapture: (_e, g) =>
                Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
            onPanResponderGrant: () => {
                this._selfThumbDragStart = this.state.selfThumbPosition
                    || this._getDefaultSelfThumbPosition();
            },
            onPanResponderMove: (_e, g) => {
                if (!this._selfThumbDragStart) return;
                const { width, height } = Dimensions.get('window');
                const w = this._selfThumbW || 120;
                const h = this._selfThumbH || 160;
                let x = this._selfThumbDragStart.x + g.dx;
                let y = this._selfThumbDragStart.y + g.dy;

                // Coordinate model.
                //
                // The thumbnail's parent (myselfContainer inside the
                // main render container) is wrapped by the app-level
                // SafeAreaView, so its origin sits at screen-x =
                // leftInset (only in landscape) and screen-y =
                // topInset. The PIP corner math at line 2315 confirms
                // this: `topLeft: { top: -topInset }` in fullscreen
                // means parent-y = -topInset reaches screen-y = 0.
                //
                // To clamp the thumb so its visible rectangle stays
                // on the phone screen we translate desired screen-x
                // / screen-y bounds back into parent-relative coords
                // by subtracting the parent's screen offset.
                const insets = this.state.insets || {};
                const topInset = insets.top || 0;
                const leftInset = insets.left || 0;
                const rightInset = insets.right || 0;
                const bottomInset = insets.bottom || 0;
                const headerBarHeight = 60; // call appbar only — the 34dp Blink brand strip was removed (CallOverlay._showCallBrandStrip=false), so portrait no longer adds it

                const parentScreenY = topInset;
                // SafeAreaView's left-padding behaviour differs by
                // platform: iOS landscape pushes content RIGHT by
                // leftInset (so parent x=0 = screen-x=leftInset),
                // but on Android landscape the safe-area inset is
                // applied as padding on the side WITHOUT a shift —
                // parent x=0 stays at screen-x=0. Assuming a left
                // shift on Android over-subtracted leftInset from
                // maxX, which is exactly the "thumb stops at the
                // right inset boundary" the user reported.
                const parentScreenX = (Platform.OS === 'ios' && this.state.isLandscape)
                    ? leftInset : 0;

                // Bounds are expressed in SCREEN coordinates of the
                // thumb's edge (later translated to parent-relative
                // coords via parentScreen*). Earlier the FS values
                // were stored as parent-relative offsets (`-leftInset`
                // etc.) which was wrong on Android — parentScreenX
                // is 0 there, so the thumb was free to drift to
                // parent-x = -leftInset i.e. screen-x = -leftInset
                // (off the left edge).
                let topBound, bottomBound, leftBound, rightBound;
                if (this.state.fullScreen) {
                    // Immersive fullscreen: thumb edges can reach the
                    // actual phone screen edges (0..width). On
                    // Android, Dimensions.get('window').width
                    // excludes the system-buttons column even in
                    // immersive mode, so the true right edge is at
                    // `width + rightInset`; bottom similarly. iOS
                    // hides the status bar but Dimensions already
                    // reports the full screen rectangle, so we
                    // clamp to `width` / `height` — extending by
                    // rightInset / bottomInset there would push the
                    // thumb off the visible screen.
                    topBound = 0;
                    leftBound = 0;
                    if (Platform.OS === 'android') {
                        bottomBound = height + bottomInset;
                        rightBound = width + rightInset;
                    } else {
                        bottomBound = height;
                        rightBound = width;
                    }
                } else {
                    // Non-fullscreen: thumb stays within the
                    // visible call area.
                    //   * Top: stops at the NAVBAR BOTTOM so the
                    //     thumb never overlaps the call header.
                    //   * Bottom: stops above the home-indicator /
                    //     gesture-nav strip.
                    //   * Left / Right: stop at the safe-area
                    //     boundaries. On Android the visible
                    //     content rect is shifted left by
                    //     rightInset (the system-buttons column
                    //     sits on the right but Dimensions reports
                    //     window.width as `width - rightInset`),
                    //     so both bounds need an extra
                    //     `-rightInset` shift. iOS doesn't have
                    //     that shift, so we keep the standard
                    //     safe-area bounds — otherwise the thumb
                    //     was stopping well short on iOS portrait
                    //     and overshooting in the wrong direction
                    //     on landscape.
                    topBound = topInset + headerBarHeight;
                    bottomBound = height - bottomInset;
                    if (Platform.OS === 'android') {
                        leftBound = leftInset - rightInset;
                        rightBound = width - rightInset - rightInset;
                    } else {
                        // iOS non-FS:
                        //   * Right edge: thumb can reach the
                        //     actual phone screen edge (the video
                        //     container already stretches there).
                        //   * Left edge: stops at `leftInset`
                        //     because in landscape that's where
                        //     the notch sits; the thumb shouldn't
                        //     be draggable into the notch in
                        //     non-FS. In portrait leftInset is
                        //     normally 0 so this is equivalent to
                        //     `leftBound = 0`.
                        leftBound = leftInset;
                        rightBound = width;
                    }
                }

                const minX = leftBound - parentScreenX;
                const maxX = rightBound - w - parentScreenX;
                const minY = topBound - parentScreenY;
                const maxY = bottomBound - h - parentScreenY;
                x = Math.max(minX, Math.min(maxX, x));
                y = Math.max(minY, Math.min(maxY, y));
                this.setState({ selfThumbPosition: { x, y } });
            },
            onPanResponderRelease: () => { this._selfThumbDragStart = null; },
            onPanResponderTerminate: () => { this._selfThumbDragStart = null; },
        });
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();

        this.userHangup = false;
        if (this.props.call) {
            this.props.call.statistics.on('stats', this.statistics);
        }

		// localStream is null when VideoBox mounts BEFORE getLocalMedia
		// resolves — on incoming-call accept we route-first to /call so
		// AudioCallBox/VideoBox can begin mounting before the camera is
		// ready. The post-mount stream flows in via
		// componentWillReceiveProps's localMedia→localStream sync below.
		// Without this null-guard the constructor threw on
		// localStream.getVideoTracks() and the whole component failed to
		// mount, leaving the preview tile blank for the rest of the call.
		const localStream = this.state.localStream;
		if (localStream && localStream.getVideoTracks && localStream.getVideoTracks().length > 0) {
			const track = localStream.getVideoTracks()[0];
			// Apply the "answered while muted" track disable EXACTLY
			// ONCE per call. Without this guard every re-mount of
			// VideoBox (e.g. user navigates back to the contacts list
			// and returns to the call) would re-disable the track —
			// stomping on the user's earlier "Enable camera" choice
			// and leaving the camera-mute icon stuck on. Same sticky-
			// flag pattern as _sylkCameraPromptHandled above.
			if (this.props.videoMuted && this.props.call
					&& !this.props.call._sylkInitialVideoMuteApplied) {
				track.enabled = false;
				this.props.call._sylkInitialVideoMuteApplied = true;
				console.log('Initial video is muted');
			}
			// Derive initial camera facing from the actual track
			// settings so the bar/label/swap logic doesn't start out of
			// phase with the device's real camera. RNWebRTC reports
			// facingMode as 'user' (front) or 'environment' (back) when
			// available; if the runtime doesn't expose it, we fall
			// back to the assumed 'front' default.
			let initialFacing = 'front';
			try {
				const settings = track.getSettings ? track.getSettings() : null;
				if (settings && settings.facingMode === 'environment') {
					initialFacing = 'back';
				}
			} catch (e) {
				// getSettings not supported — keep the 'front' default.
			}
			this.state.cameraFacing = initialFacing;
			// Track's actual enabled state is the ultimate source of
			// truth for `videoMuted` — if the user enabled the camera
			// earlier in the call and we're remounting now, the track
			// is enabled and we should reflect that. (My new state
			// init above already does this; this line covers the case
			// where the track exists but the LocalMedia preview path
			// disabled it.)
			if (track.enabled === false) {
				this.state.videoMuted = true;
			} else {
				this.state.videoMuted = false;
			}
		} else {
			console.log('No video track');
			// The self-view is about to bind a local stream that has NO video
			// track yet. stream.toURL() is derived from the stream ID, which
			// does not change when a track is added later, so the RTCView would
			// stay bound to an empty stream and paint nothing — a "transparent
			// mirror" that only appears once something forces a remount (e.g.
			// the user toggling Hide/Show mirror from the menu).
			//
			// This used to be masked: on an incoming call the camera-enable
			// modal's cWRP track-gate retried until the track showed up, and
			// its setState churn remounted the view as a side effect. An
			// auto-answered call skips that modal entirely, so nothing was left
			// to re-bind. cWRP now watches for the track appearing and bumps
			// localViewEpoch — see the matching block there.
			this._selfViewBoundWithoutTrack = true;
		}
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted') && nextProps.muted !== this.props.muted) {
            this.setState({audioMuted: nextProps.muted});
        }

        // System-notification reveal. Messages from NotificationCenter
        // render on the CallOverlay appbar's status line (instead of
        // the black bottom snackbar) — but in a video call the appbar
        // auto-hides into fullscreen after a few seconds. If a NEW
        // message arrives while the appbar is hidden, bring it back so
        // the message is actually seen, then re-arm the auto-hide
        // timer so the appbar tucks away again afterwards.
        if (nextProps.systemMessage
            && nextProps.systemMessage !== this.props.systemMessage
            && !this.state.callOverlayVisible) {
            this.toggleFullScreen();
            this.armOverlayTimer();
        }

        if (nextProps.hasOwnProperty('info')) {
            this.setState({info: nextProps.info});
        }

        // Only sync videoMuted when the prop's VALUE changes (not on every
        // parent re-render). Otherwise a stable upstream flag (e.g. the
        // iOS incoming-video default) keeps clobbering local state every
        // time toggleVideoMute flips it to false — leaving the camera
        // icon stuck on "muted" even though the camera is actually live.
        if (nextProps.hasOwnProperty('videoMuted') && nextProps.videoMuted !== this.props.videoMuted) {
            this.setState({videoMuted: nextProps.videoMuted});
        }

        if (nextProps.hasOwnProperty('packetLossQueue')) {
            this.setState({packetLossQueue: nextProps.packetLossQueue});
        }

        if (nextProps.hasOwnProperty('audioBandwidthQueue')) {
            this.setState({audioBandwidthQueue: nextProps.audioBandwidthQueue});
        }

        if (nextProps.hasOwnProperty('latencyQueue')) {
            this.setState({latencyQueue: nextProps.latencyQueue});
        }

        if (nextProps.call && nextProps.call !== this.state.call) {
            nextProps.call.on('stateChanged', this.callStateChanged);
            nextProps.call.on('zrtpStateChanged', this.zrtpStateChanged);
            nextProps.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            nextProps.call.on('zrtpStrictH264VideoDrop', this.zrtpStrictH264VideoDrop);
            nextProps.call.on('zrtpMediaStuckChanged', this.zrtpMediaStuckChanged);
            nextProps.call.on('zrtpMediaDiagUpdated', this.zrtpMediaDiagUpdated);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
                this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
                this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
                this.state.call.removeListener('zrtpStrictH264VideoDrop', this.zrtpStrictH264VideoDrop);
                this.state.call.removeListener('zrtpMediaStuckChanged', this.zrtpMediaStuckChanged);
                this.state.call.removeListener('zrtpMediaDiagUpdated', this.zrtpMediaDiagUpdated);
            }
            const existing = getZrtpSession(nextProps.call);
            const newLocalStream = nextProps.call.getLocalStreams()[0];
            this.setState({call: nextProps.call,
                           localStream: newLocalStream,
                           remoteStream: nextProps.call.getRemoteStreams()[0],
                           zrtpState: (existing && existing.state) ? existing.state : null,
                           mediaStuck: !!(existing && existing.mediaStuck),
                           mediaInfoPanelVisible: false
            });

            // Re-attach the local-video-track health listeners to the
            // new stream. For incoming video calls the SDP answer
            // arrives after VideoBox mounts and swaps in a different
            // localStream — without this re-attach we'd silently
            // monitor the old (discarded) track.
            this._attachLocalVideoTrackListeners(newLocalStream);
            this._attachRemoteVideoTrackListeners(nextProps.call.getRemoteStreams && nextProps.call.getRemoteStreams()[0]);
        }

        if ('aspectRatio' in nextProps) {
			this.setState({aspectRatio: nextProps.aspectRatio});
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        // localStream sync.
        //
        // The constructor seeds state.localStream from
        // call.getLocalStreams()[0] || props.localMedia at mount time.
        // For incoming-call accept that mount can happen BEFORE
        // getLocalMedia returns, so the seed is null and the local-
        // preview RTCView has no streamURL. Once props.localMedia
        // arrives in this cWRP pass, propagate it into state.localStream
        // too so the RTCView (which reads `this.localStreamUrl` from
        // `state.localStream.toURL()`) actually has a stream to render.
        // Prefer the call's own localStream if sylkrtc has already
        // attached one — that's the canonical source once the answer
        // SDP applies.
        const _callLocalStream = (nextProps.call
            && typeof nextProps.call.getLocalStreams === 'function'
            && nextProps.call.getLocalStreams()[0]) || null;
        const _resolvedLocalStream = _callLocalStream || nextProps.localMedia || this.state.localStream || null;
        // [video-preview] trace: which source won? Did the localStream
        // identity actually change this tick? Any of these going from
        // "null" → "set" is the moment the preview tile should light up.
        try {
            const _src = _callLocalStream ? 'call.getLocalStreams()[0]'
                         : (nextProps.localMedia ? 'props.localMedia'
                         : (this.state.localStream ? 'state.localStream (kept)'
                         : 'null'));
            const _resolvedTracks = (_resolvedLocalStream
                && typeof _resolvedLocalStream.getTracks === 'function')
                  ? _resolvedLocalStream.getTracks() : [];
            /* console.log('[video-preview] VideoBox cWRP localStream',
                'call_id=' + ((nextProps.call && (nextProps.call.id || nextProps.call._callId)) || '?'),
                'src=' + _src,
                'resolved=' + (_resolvedLocalStream ? 'set' : 'null'),
                'tracks=' + _resolvedTracks.length,
                'changed=' + (_resolvedLocalStream !== this.state.localStream)); */
        } catch (e) {
            console.log('[video-preview] cWRP trace threw:', (e && e.message) || String(e));
        }

        this.setState({
                       callContact: nextProps.callContact,
                       remoteUri: nextProps.remoteUri,
                       photo: nextProps.photo ? nextProps.photo : this.state.photo,
                       remoteDisplayName: nextProps.remoteDisplayName,
                       selectedContact: nextProps.selectedContact,
                       selectedContacts: nextProps.selectedContacts,
                       localMedia: nextProps.localMedia,
                       localStream: _resolvedLocalStream,
                       terminatedReason: nextProps.terminatedReason,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   isLandscape: nextProps.isLandscape
                       });

        // If we just transitioned from "no local stream" to "have one",
        // wire the local-video-track health listeners onto it (mirrors
        // the call-identity-change branch above). Without this, an
        // initially-null mount that gains the stream via this cWRP
        // would silently never get the listeners and the local
        // preview tile would render frames but log "no video track"
        // diagnostics on track events.
        //
        // CRITICAL: also re-run _enableTrackForPreview() when the
        // stream lands AFTER mount. componentDidMount only calls it
        // if state.localStream is already populated; on incoming
        // accept the stream arrives post-mount via this cWRP, so the
        // mount-time call early-returns and the video track stays
        // attached to the RTCRtpSender. The remote then sees the
        // camera while the "Enable camera?" modal is still up — the
        // exact "remote sees me before I pressed Start camera" bug
        // reported in the field. Calling it from here detaches the
        // track via replaceTrack(null) the moment the stream arrives.
        const _streamTransitionedToSet = _resolvedLocalStream && _resolvedLocalStream !== this.state.localStream;
        if (_streamTransitionedToSet) {
            // A genuinely different local stream landed (renegotiation, media
            // refresh). Any self-view override from an earlier camera restart
            // describes the OLD stream's track, so drop it — from the call
            // stash as well as this instance — and let the self-view follow
            // the new stream again.
            try {
                if (nextProps.call) nextProps.call._sylkLocalViewStream = null;
            } catch (e) { /* noop */ }
            if (this.state.localViewStream) {
                this.setState({localViewStream: null});
            }
            try { this._attachLocalVideoTrackListeners(_resolvedLocalStream); }
            catch (_) { /* listener wiring is best-effort */ }
            // Deferred camera-preference application: the mount-time
            // _applyVideoCallPrefs call couldn't switch cameras if no
            // local video track existed yet. Now that the stream has
            // landed, retry with it directly (setState above hasn't
            // committed, so pass the stream instead of reading state).
            try { this._applyVideoCallPrefs(_resolvedLocalStream); }
            catch (_) { /* pref application is best-effort */ }
        }

        // Self-view re-bind once the local video track finally exists.
        //
        // getUserMedia can resolve with the stream before its video track is
        // attached, so VideoBox's constructor can bind the mirror to a stream
        // with zero video tracks (it logs 'No video track' and sets
        // _selfViewBoundWithoutTrack). The track lands moments later, but
        // stream.toURL() is derived from the stream ID and does not change, so
        // React sees identical props and the RTCView is never re-created — it
        // stays attached as a sink on nothing and renders transparent.
        //
        // Deliberately NOT gated on videoEnableDialogVisible: that gate is why
        // this only showed up on auto-answered calls. With the camera-enable
        // modal in play its retry loop churned setState until the track
        // appeared and remounted the view as a side effect; skipping the modal
        // removed the only thing re-binding the mirror.
        //
        // Same remedy _restartCameraCapture already uses for the sibling case
        // (track REPLACED rather than added): bump localViewEpoch, which feeds
        // _videoRemountKey and re-creates the RTCView against the live track.
        // One-shot — the flag is cleared before the setState.
        if (this._selfViewBoundWithoutTrack) {
            try {
                const _selfStream = this.state.localViewStream
                    || _resolvedLocalStream
                    || this.state.localStream;
                const _hasVideo = !!(_selfStream && _selfStream.getVideoTracks
                    && _selfStream.getVideoTracks().length > 0);
                if (_hasVideo) {
                    this._selfViewBoundWithoutTrack = false;
                    console.log('[video-preview] local video track appeared after the self-view'
                        + ' bound to an empty stream — remounting the mirror');
                    this.setState(prev => ({ localViewEpoch: (prev.localViewEpoch || 0) + 1 }));
                }
            } catch (e) {
                console.log('[video-preview] self-view re-bind check threw:',
                    (e && e.message) || String(e));
            }
        }

        // Preview-only-detach retry loop.
        //
        // _enableTrackForPreview must run AFTER the RTCRtpSender for
        // the video track exists — which on incoming accept only
        // happens once sylkrtc applies the SDP answer. The mount-time
        // call from componentDidMount can fire before the sender
        // materialises (then _videoSender() returns null and the
        // detach is a no-op), and the cWRP-on-stream-transition call
        // can also be too early.
        //
        // Retry on EVERY cWRP pass while the camera-enable prompt is
        // up and we haven't successfully detached yet. cWRP fires on
        // every prop update (insets, route, state.call updates from
        // sylkrtc events, etc.) — by the time the call reaches a
        // state where the modal could possibly be dismissed, we'll
        // have had dozens of cWRP passes, and any of them where the
        // sender now exists will perform the detach.
        //
        // Idempotence: _enableTrackForPreview itself sets
        // this._previewTrackWasReEnabled = true on success, which we
        // use as the loop guard so we don't keep calling replaceTrack
        // forever.
        if (this.state.videoEnableDialogVisible
                && !this._previewTrackWasReEnabled
                && _resolvedLocalStream) {
            this._pendingPreviewStream = _resolvedLocalStream;
            try { this._enableTrackForPreview(); }
            catch (e) {
                console.log('[video-preview] cWRP _enableTrackForPreview threw:',
                    (e && e.message) || String(e));
            }
            this._pendingPreviewStream = null;
            // _enableTrackForPreview now operates on the track
            // directly (track.enabled=false), so it succeeds the
            // moment the localStream has a video track — no need to
            // wait for the RTPSender to materialise. The retry loop
            // still runs on every cWRP until success, in case the
            // first cWRP fires before getUserMedia has resolved.
            if (this._previewTrackWasReEnabled) {
                console.log('[video-preview] cWRP track-gate SUCCEEDED — modal phase active, wire silenced');
            } else {
                console.log('[video-preview] cWRP track-gate pending — localStream has no video track yet, will retry'
                    + ' (resolvedLocalStream tracks=' + ((_resolvedLocalStream.getTracks && _resolvedLocalStream.getTracks().length) || 0) + ')');
            }
        }
    }

	componentDidUpdate(prevProps, prevState) {
	     if (this.state.aspectRatio != prevState.aspectRatio) {
			 console.log(' --- aspectRatio did change', this.state.aspectRatio);
	     }
	}

    callStateChanged(oldState, newState, data) {
        if (newState === 'terminated') {
            this.setState({ zrtpState: null, zrtpDialogVisible: false });
            this._stopVideoStatsProbe();
            // Emit [qos] DISCONNECT and stop the QoS sampler (mirror AudioCallBox).
            stopQosLogging();
        }
        if (newState === 'established') {
            // Streams attach to the peer connection on answer. Refresh
            // our refs so the remote video starts rendering and the
            // local stream switches from props.localMedia to the
            // sender's actual track.
            const ls = this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0];
            const rs = this.props.call.getRemoteStreams && this.props.call.getRemoteStreams()[0];
            // [video-preview] trace: did the SDP answer attach a
            // localStream to the peer connection? Is it the SAME
            // object we already had in state, or a fresh swap-in?
            try {
                const _lsTracks = (ls && typeof ls.getTracks === 'function')
                                    ? ls.getTracks() : [];
                console.log('[video-preview] VideoBox established',
                    'call_id=' + ((this.props.call && (this.props.call.id || this.props.call._callId)) || '?'),
                    'call.localStreams=' + (ls ? 'set' : 'null'),
                    'ls.tracks=' + _lsTracks.length,
                    'sameAsState=' + (ls === this.state.localStream),
                    'state.localStream=' + (this.state.localStream ? 'set' : 'null'));
            } catch (e) {
                console.log('[video-preview] established trace threw:',
                    (e && e.message) || String(e));
            }
            this.setState({
                localStream: ls || this.state.localStream,
                remoteStream: rs || this.state.remoteStream,
            });
            this._attachRemoteVideoTrackListeners(rs || this.state.remoteStream);
            this._startVideoStatsProbe();
            // Start [qos] CONNECT/STATS capture against the call's PeerConnection
            // so video calls produce client-side stats for reconciliation (the
            // same telemetry AudioCallBox gathers for audio calls).
            if (this.props.call && this.props.call._pc) {
                const _cid = this.props.call._callId || this.props.call.callId || this.props.call.id;
                startQosLogging(this.props.call._pc, _cid);
            }
            this._logNegotiatedSdp();
        }
        this.forceUpdate();
    }

    /*
     * Dump the SDP that we actually received from SylkServer/Janus, so
     * we can diff it against what the peer (e.g. Blink/pjsip) thinks it
     * sent. Janus's SIP plugin re-writes both directions: it terminates
     * the SIP-side SDP, builds a fresh JSEP offer for libwebrtc on the
     * WebRTC side, and vice versa. That re-write can silently strip
     * codec attributes (rtcp-fb, transport-cc, extmap, rtx, fec), force
     * a particular profile (RTP/SAVPF vs RTP/AVP), or change the codec
     * preference order — any of which can explain "I added X on the
     * pjsip side but the libwebrtc peer never sees X".
     *
     * We log:
     *  - pc.remoteDescription.type ("offer" / "answer") and full sdp
     *  - pc.localDescription.type and full sdp
     *
     * One-shot per call. Fires once when callStateChanged hits
     * 'established' — at that point sylkrtc has applied
     * setRemoteDescription / setLocalDescription on both sides and
     * the peerconnection has the final negotiated SDPs.
     */
    _logNegotiatedSdp() {
        if (this._sdpDumped) return;
        this._sdpDumped = true;
        const call = this.props.call;
        const pc = call && call._pc;
        if (!pc) {
            console.log('[sdp-dump] no peer connection yet, skipping');
            return;
        }
        const cid = (call && call.id) || '?';
        const dump = (label, desc) => {
            if (!desc || typeof desc.sdp !== 'string') {
                console.log('[sdp-dump] cid=' + cid, label, '<none>');
                return;
            }
            console.log('[sdp-dump] cid=' + cid, label, 'type=' + desc.type,
                        'len=' + desc.sdp.length);
            // RN's console buffers each console.log call as ONE line in
            // metro.log. Chunk-by-line so the multi-line SDP arrives
            // legibly instead of a single 1-2 KB blob that gets
            // truncated mid-line by some log viewers.
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

    // Diagnostic: periodically dump video receiver stats so we can see
    // what's happening in the M124 receive pipeline. Logs key counters
    // (framesReceived/Decoded/Dropped, keyFramesDecoded, nackCount,
    // pliCount, decoderImplementation) every 5s for the first 30s of
    // the call. Fires regardless of E2EE state — we want raw info on
    // the receive path that's been showing black on this build.
    _startVideoStatsProbe() {
        if (this._videoStatsTimer) return;
        // Always on now — these are the only [video] diagnostic lines
        // available when debugging Blink↔Sylk interop in the field.
        // getStats() runs once every 2s for the FULL call duration; the
        // bridge cost is negligible compared to the actual video
        // pipeline so the "disturb the renderer" concern from the
        // original draft no longer applies.
        const call = this.props.call;
        const pc = call && call._pc;
        if (!pc || typeof pc.getStats !== 'function') return;

        let ticks = 0;
        // In-flight guard — skip a tick if the previous getStats(null)
        // hasn't resolved yet, so slow native getStats can't stack up
        // pending callbacks. Stale-timeout re-arms it if a promise is
        // ever lost.
        let __inFlight = false;
        let __inFlightSince = 0;
        const INFLIGHT_STALE_MS = 6000;
        // Hold deltas across ticks so we can show per-second rates
        // instead of monotonically-growing counters.
        const prev = { inB: 0, outB: 0, inF: 0, outF: 0 };
        // Codec id → codec name + clockRate + payload type. Built once
        // per call from the very first stats snapshot and re-checked
        // every tick in case the codec was switched mid-call (mid-call
        // codec switches are rare but possible via re-negotiation).
        const codecCache = new Map();

        const fmtRate = (curr, prevVal, secs) => {
            if (!secs) return 0;
            const d = (curr || 0) - (prevVal || 0);
            return d < 0 ? 0 : Math.round(d / secs);
        };

        const lookupCodec = (stats, codecId) => {
            if (!codecId) return null;
            if (codecCache.has(codecId)) return codecCache.get(codecId);
            let codec = null;
            stats.forEach((r) => {
                if (r.id === codecId && r.type === 'codec') codec = r;
            });
            if (codec) {
                const desc = (codec.mimeType || '')
                    + (codec.payloadType ? ' pt=' + codec.payloadType : '')
                    + (codec.clockRate ? ' clk=' + codec.clockRate : '')
                    + (codec.sdpFmtpLine ? ' fmtp=' + codec.sdpFmtpLine : '');
                codecCache.set(codecId, desc);
                return desc;
            }
            return null;
        };

        const dump = async () => {
            if (__inFlight && (Date.now() - __inFlightSince) < INFLIGHT_STALE_MS) {
                return;
            }
            __inFlight = true;
            __inFlightSince = Date.now();
            ticks += 1;
            try {
                const stats = await pc.getStats(null);
                let inbound = null, outbound = null;
                stats.forEach((r) => {
                    if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
                    if (r.type === 'outbound-rtp' && r.kind === 'video') outbound = r;
                });

                // Inbound (remote → us) — what we're receiving from the peer.
                if (inbound) {
                    const codec = lookupCodec(stats, inbound.codecId) || '?';
                    const w = inbound.frameWidth || 0;
                    const h = inbound.frameHeight || 0;
                    // Remote frame size -> maps a tap on the letterboxed remote
                    // view to a normalized point on the peer's shared screen.
                    if (w && h && (!this.state.remoteVideoSize
                        || this.state.remoteVideoSize.w !== w
                        || this.state.remoteVideoSize.h !== h)) {
                        this.setState({ remoteVideoSize: { w, h } });
                    }
                    const fps = inbound.framesPerSecond
                        || fmtRate(inbound.framesDecoded, prev.inF, 2);
                    const kbps = Math.round(
                        fmtRate(inbound.bytesReceived, prev.inB, 2) * 8 / 1000);
                    console.log('[video] RX',
                        'codec=' + codec,
                        'size=' + (w && h ? w + 'x' + h : '?'),
                        'fps=' + fps,
                        'kbps=' + kbps,
                        'frames(recv/dec/key/drop)=' + (inbound.framesReceived || 0) + '/'
                            + (inbound.framesDecoded || 0) + '/'
                            + (inbound.keyFramesDecoded || 0) + '/'
                            + (inbound.framesDropped || 0),
                        'lost=' + (inbound.packetsLost || 0),
                        'jitter=' + (inbound.jitter || 0),
                        'nack/pli/fir=' + (inbound.nackCount || 0) + '/'
                            + (inbound.pliCount || 0) + '/'
                            + (inbound.firCount || 0),
                        'dec=' + (inbound.decoderImplementation || '?'),
                    );
                    prev.inB = inbound.bytesReceived || 0;
                    prev.inF = inbound.framesDecoded || 0;
                } else {
                    console.log('[video] RX no inbound-rtp video stats yet'
                        + ' (peer not sending, m=video may be inactive)');
                }

                // Outbound (us → remote) — what we're transmitting.
                if (outbound) {
                    const codec = lookupCodec(stats, outbound.codecId) || '?';
                    const w = outbound.frameWidth || 0;
                    const h = outbound.frameHeight || 0;
                    const fps = outbound.framesPerSecond
                        || fmtRate(outbound.framesEncoded, prev.outF, 2);
                    const kbps = Math.round(
                        fmtRate(outbound.bytesSent, prev.outB, 2) * 8 / 1000);
                    console.log('[video] TX',
                        'codec=' + codec,
                        'size=' + (w && h ? w + 'x' + h : '?'),
                        'fps=' + fps,
                        'kbps=' + kbps,
                        'frames(sent/enc/key)=' + (outbound.framesSent || 0) + '/'
                            + (outbound.framesEncoded || 0) + '/'
                            + (outbound.keyFramesEncoded || 0),
                        'qualityLimitation=' + (outbound.qualityLimitationReason || 'none'),
                        'nack/pli/fir=' + (outbound.nackCount || 0) + '/'
                            + (outbound.pliCount || 0) + '/'
                            + (outbound.firCount || 0),
                        'enc=' + (outbound.encoderImplementation || '?'),
                    );
                    prev.outB = outbound.bytesSent || 0;
                    prev.outF = outbound.framesEncoded || 0;
                } else {
                    console.log('[video] TX no outbound-rtp video stats yet'
                        + ' (we are not sending, local m=video may be inactive)');
                }
            } catch (e) {
                console.log('[video] stats poll failed:', (e && e.message) || e);
            } finally {
                __inFlight = false;
            }
        };
        // Fire after 2s, then every 2s thereafter (no upper bound — we
        // want to see when frames stop arriving, which is the bug under
        // investigation).
        this._videoStatsTimer = setInterval(dump, 2000);
    }

    _stopVideoStatsProbe() {
        if (this._videoStatsTimer) {
            clearInterval(this._videoStatsTimer);
            this._videoStatsTimer = null;
        }
    }

    zrtpStateChanged(newState) {
        if (this.unmounted) return;
        this.setState({ zrtpState: newState }, () => {
            if (newState !== 'key-active') return;
            const status = this._zrtpVerificationStatus();
            this._maybeAutoUpgradeRs1(status);
        });
    }

    // Media-stuck listener — same shape as AudioCallBox. stuck=true
    // surfaces the amber "Media stuck" pill alongside the zRTP pill;
    // stuck=false hides it. Does NOT close the info panel — that's
    // independent of the stuck condition.
    zrtpMediaStuckChanged({ stuck }) {
        if (this.unmounted) return;
        this.setState({ mediaStuck: !!stuck });
    }

    // Sink for the per-poll diag refresh event. The shared MediaInfoPanel
    // runs its own getStats poller while visible, so we don't need to
    // store snapshots here — registering a noop sink just keeps the event
    // from being "unhandled".
    zrtpMediaDiagUpdated(/* { snapshot } */) {
        // intentionally empty
    }

    /** Default position for the i/speedometer view.
     *  - Fullscreen: anchor at the actual top-left of the phone
     *    screen. The parent container is wrapped by the safe-area
     *    inset, so reaching the screen edge means negating
     *    topInset (matches the PIP corner math at line 2315 which
     *    uses `top: -topInset` in fullscreen).
     *  - Non-fullscreen: anchor just BELOW the call navbar. The
     *    parent already accounts for topInset here, so we only add
     *    the headerBarHeight. */
    _getDefaultSpeedoPosition() {
        const insets = this.state.insets || {};
        const topInset = insets.top || 0;
        const leftInset = insets.left || 0;
        const headerBarHeight = 60; // call appbar only — the 34dp Blink brand strip was removed (CallOverlay._showCallBrandStrip=false), so portrait no longer adds it
        let x, y;
        if (this.state.fullScreen) {
            // Pull above the safe-area inset to reach the actual
            // top edge of the phone screen, then nudge 15dp in from
            // both edges so the iPhone's rounded display corner
            // doesn't clip the icon. In landscape the parent
            // container is shifted right by leftInset to clear the
            // notch — negate it so the icon reaches the screen's
            // actual left edge (matches the PIP corner math at
            // line 2315: `left: -leftInset`).
            x = (this.state.isLandscape ? -leftInset : 0) + 15;
            y = -topInset + 15;
        } else {
            // Non-fullscreen: anchor under the navbar.
            // In landscape on iOS the parent container is shifted
            // RIGHT by leftInset (the video stretches edge-to-edge
            // with marginLeft: -leftInset, see line ~2383), so to
            // push the icon flush with the actual screen-left we
            // have to negate the inset — same trick the PIP corners
            // use. In portrait the parent already starts at
            // screen-x=0, so no negation is needed.
            x = this.state.isLandscape ? -leftInset : 4;
            y = headerBarHeight + 8;
        }
        return { x, y };
    }

    /** Default position for the self-view PIP thumbnail. Anchors at
     *  the TOP-RIGHT of the visible video area so it doesn't collide
     *  with the i/speedometer overlay at the top-left. Used to seed
     *  the PanResponder and as the fallback when
     *  state.selfThumbPosition is null. */
    _getDefaultSelfThumbPosition() {
        const { width } = Dimensions.get('window');
        const insets = this.state.insets || {};
        const topInset = insets.top || 0;
        const rightInset = insets.right || 0;
        const w = this._selfThumbW || 120;
        // Mirror the previous corner math: in fullscreen the thumb
        // sits flush with the top; otherwise it clears the header
        // bar.
        const headerBarHeight = 60; // call appbar only — the 34dp Blink brand strip was removed (CallOverlay._showCallBrandStrip=false), so portrait no longer adds it
        const y = this.state.fullScreen ? Math.max(0, topInset) : headerBarHeight;
        const x = Math.max(0, width - w - rightInset);
        return { x, y };
    }

    _openMediaInfoPanel() {
        this.setState({ mediaInfoPanelVisible: true });
    }

    _closeMediaInfoPanel() {
        this.setState({ mediaInfoPanelVisible: false });
    }

    // Fired by CallZrtp when zRTP strict mode collides with H264 video.
    // The session has already stopped the local video sender; we suppress
    // the camera-enable prompt and any local preview tile.
    zrtpStrictH264VideoDrop(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[call] [zrtp] strict-H264: dropping video media on this call');
        this.setState({
            zrtpStrictNoVideo: true,
            videoEnableDialogVisible: false,
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
        } catch (e) { /* ignore */ }
    }

    // Fired by CallZrtp.js when zRTP-mandatory mode fails to agree on
    // keys. Surfaces the warning dialog so the user can choose End
    // call (mandatory enforcement honored) or Continue (downgrade to
    // optional behavior — DTLS-only between us and the relay).
    zrtpMandatoryFailed(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[call] [zrtp] call_id='
            + (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)),
            'VideoBox received zrtpMandatoryFailed:', info);
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

    _zrtpVerificationStatus() {
        // Bind to 'key-active' so the SAS modal is only meaningful when
        // media is actually flowing through the AES-GCM decryptor — see
        // the parallel comment in AudioCallBox.js / CallZrtp.js for why
        // 'key-agreed' alone isn't a sufficient signal.
        if (this.state.zrtpState !== 'key-active') return null;
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) return null;
        // Primary anchor: v2 retained-secret continuity decision.
        if (session.continuityState === 'verified') return 'verified';
        if (session.continuityState === 'mismatch') return 'mismatch';
        // New-device guard: when peer advertised device_id AND we hold
        // no per-device rs1 for them, treat as unverified — don't fall
        // through to the legacy PGP compare which is per-account.
        if (session.peerDeviceId && !session.localRs1) {
            return 'unverified';
        }
        // Legacy fallback for v1 / v2 peers / sessions without rs1 yet.
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;
        if (!stored || !stored.publicKey) return 'unverified';
        const currentKey = this.props.callContact && this.props.callContact.publicKey;
        if (currentKey && constantTimeStringEqual(stored.publicKey, currentKey)) return 'verified';
        return 'mismatch';
    }

    _onZrtpBadgePress() {
        if (this.state.zrtpState === 'key-active') {
            this.setState({ zrtpDialogVisible: true });
        }
    }

    _onZrtpReset() {
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
        if (typeof session.confirmSasAndSeedRs1 === 'function') {
            try { session.confirmSasAndSeedRs1(); } catch (e) {}
        }
        if (this.props.markZrtpVerified && this.state.remoteUri) {
            this.props.markZrtpVerified(this.state.remoteUri, session.sas.chars, session.sas.emojis);
        }
        this.setState({ zrtpDialogVisible: false });
        this.forceUpdate();
    }

    /** Find the RTCRtpSender carrying the video track on this call's pc. */
    /** Re-attach `track` to the video RTCRtpSender if the sender currently
     *  has no track. Idempotent — if the sender already carries the same
     *  track (or any video track) we leave it alone. Needed after
     *  _onKeepAudioOnly() (the "Audio only" / Cancel choice on the
     *  camera-enable modal): that path leaves the sender with
     *  replaceTrack(null) in effect and clears _previewSender, so when
     *  the user later re-enables the camera via the unmute toggle or by
     *  picking a camera, just setting track.enabled = true is not enough
     *  — the wire-level sender still has a null track and the remote
     *  never gets frames. This helper closes that gap. */
    _ensureSenderHasTrack(track) {
        if (!track) return;
        const pc = this.props.call && this.props.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') return;
        let videoSender = null;
        for (const s of pc.getSenders()) {
            if (s.track && s.track.kind === 'video') {
                // Sender already carries a video track — nothing to do.
                return;
            }
            if (!s.track && !videoSender) videoSender = s;
        }
        if (!videoSender) return;
        if (typeof videoSender.replaceTrack !== 'function') return;
        try {
            videoSender.replaceTrack(track);
            console.log('[video-preview] sender re-attached to local track (was detached)');
        } catch (e) {
            console.log('[video-preview] sender re-attach failed:', (e && e.message) || String(e));
        }
    }

    _videoSender() {
        const pc = this.props.call && this.props.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') return null;
        for (const s of pc.getSenders()) {
            if (s.track && s.track.kind === 'video') return s;
        }
        // Fall back: video sender exists but its track was replaced with null.
        for (const s of pc.getSenders()) {
            // sylkrtc tags audio sender separately; whatever's left of
            // kind 'video' or with a previously-video track is our target.
            if (!s.track) return s;
        }
        return null;
    }

    /** While the camera-enable prompt is visible we need to prevent the
     *  local camera frames from reaching the remote BEFORE the user has
     *  confirmed. The mechanism is exactly the same as the in-call
     *  "mute camera" button (`toggleVideoMute` below): set
     *  `track.enabled = false`. The wire-level RTPSender keeps its track
     *  attached and the libwebrtc encoder lifecycle stays untouched, but
     *  WebRTC replaces real frames with "silenced" frames at the track
     *  level so nothing of the user is visible to the peer until they
     *  press Enable Camera.
     *
     *  History — what was here before, and why it broke:
     *
     *  The previous implementation used either
     *    setParameters({encodings:[{active:false}]})  (preferred), or
     *    replaceTrack(null)                           (fallback).
     *  The setParameters path called {active:false} during the early
     *  accept window (around state=accepted, before state=established
     *  and before the SDP answer was set). On react-native-webrtc
     *  Android, marking encodings inactive BEFORE the encoder is
     *  instantiated makes libwebrtc skip allocating the encoder
     *  entirely — no later setParameters({active:true}) or
     *  replaceTrack(track) revives it. Symptom: outbound-rtp stats
     *  stay at framesSent=0 / framesEncoded=0 / encoderImplementation=?
     *  for the entire call, and the user's self-preview thumbnail is
     *  also empty because the same broken path stops the capturer feed.
     *  Reproduced for call_id=327373bf-... in metro.log around
     *  2026-05-19 08:27:12..08:27:27 — every TX line was 0/0/0 even
     *  after _onEnableCamera ran setParameters({active:true}) and the
     *  replaceTrack "kick".
     *
     *  Switching to track.enabled=false makes the gate symmetric with
     *  the in-call mute button (the existing, working code path),
     *  reuses the same getUserMedia stream we already acquired, and
     *  never touches the encoder/sender allocation that libwebrtc
     *  decides during negotiation.
     */
    _enableTrackForPreview() {
        // Resolution order:
        //   1. this._pendingPreviewStream — set by cWRP when the stream
        //      lands AFTER mount; setState hasn't committed yet so
        //      state.localStream is still null at this call site.
        //   2. this.state.localStream — committed state from a prior
        //      setState (mount-time or earlier cWRP).
        //   3. this.props.call.getLocalStreams()[0] — the call's own
        //      stream once sylkrtc has attached it.
        const localStream = this._pendingPreviewStream
            || this.state.localStream
            || (this.props.call && this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0]);
        if (!localStream || !localStream.getVideoTracks) return;
        const tracks = localStream.getVideoTracks();
        if (tracks.length === 0) return;
        const track = tracks[0];

        // Stash the track so _onEnableCamera / _onKeepAudioOnly can
        // act on the same instance even after cWRP swaps in a
        // different localStream object (sylkrtc re-uses the same
        // underlying track but may wrap it in a new stream after the
        // SDP answer applies).
        this._previewVideoTrack = track;

        // Stash the sender as well so the in-call code paths
        // (toggleVideoMute, _ensureSenderHasTrack, camera picker)
        // know we've already wired up a sender for this track —
        // matters when toggleVideoMute runs after _onEnableCamera and
        // expects to find the sender alive.
        const sender = this._videoSender();
        if (sender) {
            this._previewSender = sender;
        }
        // We never deactivated encodings, so there's nothing to
        // remember as a "prior" state for _onEnableCamera to restore.
        this._previewPriorEncodings = null;

        // Track-level mute — same primitive as toggleVideoMute uses.
        // Wire still negotiates m=video sendrecv and the encoder is
        // instantiated by libwebrtc the usual way, but the track
        // emits silenced frames to the encoder so the peer sees
        // nothing of the user until Enable Camera fires.
        if (track.enabled !== false) {
            try { track.enabled = false; }
            catch (e) { console.log('[video-preview] track.enabled=false threw:', (e && e.message) || String(e)); }
        }

        this._previewTrackWasReEnabled = true;
        console.log('[video-preview] track muted (track.enabled=false) — encoder lifecycle untouched');
    }

    /** Camera-enable prompt actions. */
    _onEnableCamera() {
        // Sticky: don't show the prompt again on this call even if the
        // user backgrounds and returns to the call screen.
        if (this.props.call) this.props.call._sylkCameraPromptHandled = true;
        this.setState({ videoEnableDialogVisible: false });

        // Resolve the same track _enableTrackForPreview muted.
        // Same identity-resolution order as in_enableTrackForPreview.
        const localStream = this._pendingPreviewStream
            || this.state.localStream
            || (this.props.call && this.props.call.getLocalStreams
                && this.props.call.getLocalStreams()[0])
            || null;
        const currentTrack = this._previewVideoTrack
            || (localStream && localStream.getVideoTracks
                && localStream.getVideoTracks()[0])
            || null;

        // Symmetric counterpart of the gate in _enableTrackForPreview:
        // flip the same track.enabled back to true. The libwebrtc
        // encoder was instantiated normally during negotiation (we
        // never deactivated encodings), so as soon as the track
        // emits real frames the wire gets them — no setParameters,
        // no replaceTrack, no encoder/capturer "kick" needed.
        if (currentTrack && currentTrack.enabled === false) {
            try { currentTrack.enabled = true; }
            catch (e) { console.log('[video-preview] track.enabled=true threw:', (e && e.message) || String(e)); }
        }
        console.log('[video-preview] track unmuted (track.enabled=true) — wire now sends real frames');

        // Defensive: if some earlier code path (toggleVideoMute, the
        // camera picker) had detached the sender via replaceTrack(null),
        // re-attach the track here. This is the same helper
        // toggleVideoMute calls on its unmute branch. No-op when the
        // sender already has the track.
        if (currentTrack && typeof this._ensureSenderHasTrack === 'function') {
            try { this._ensureSenderHasTrack(currentTrack); }
            catch (e) { /* best effort */ }
        }

        // Sync state.videoMuted so the camera button on the call
        // overlay renders as "camera on". We do this directly rather
        // than calling toggleVideoMute() (which would flip the track
        // back to disabled if state.videoMuted is already false).
        if (this.state.videoMuted) {
            this.setState({ videoMuted: false });
        }

        this._previewSender = null;
        this._previewVideoTrack = null;
        this._previewPriorEncodings = null;
        this._previewTrackWasReEnabled = false;
    }

    _onKeepAudioOnly() {
        // Audio-only choice. _enableTrackForPreview already muted the
        // track (track.enabled=false), so the wire keeps sending
        // silenced frames and the remote sees nothing. Just leave it
        // muted and dismiss the modal — same end state as if the user
        // had answered the call and then tapped the in-call "mute
        // camera" button. The user can later tap unmute / camera to
        // turn it on without renegotiation.
        const localStream = this.state.localStream
            || (this.props.call && this.props.call.getLocalStreams
                && this.props.call.getLocalStreams()[0])
            || null;
        const currentTrack = this._previewVideoTrack
            || (localStream && localStream.getVideoTracks
                && localStream.getVideoTracks()[0])
            || null;
        if (currentTrack && currentTrack.enabled !== false) {
            try { currentTrack.enabled = false; }
            catch (e) { console.log('[video-preview] track.enabled=false (audio-only) threw:', (e && e.message) || String(e)); }
        }
        console.log('[video-preview] audio-only chosen — track stays muted');

        // Reflect the muted state on the call overlay's camera button.
        if (!this.state.videoMuted) {
            this.setState({ videoMuted: true });
        }

        this._previewSender = null;
        this._previewVideoTrack = null;
        this._previewPriorEncodings = null;
        this._previewTrackWasReEnabled = false;
        // Sticky: don't show the prompt again on this call even if the
        // user backgrounds and returns to the call screen.
        if (this.props.call) this.props.call._sylkCameraPromptHandled = true;
        this.setState({ videoEnableDialogVisible: false });
    }

    componentDidMount() {
        this._isMounted = true;

        // Peer started/stopped screen sharing (app.js decodes
        // application/sylk-screen-sharing and re-broadcasts it here). Drives the
        // pointer button's visibility for THIS call only.
        this._screenSharingSub = DeviceEventEmitter.addListener('sylkScreenSharingChanged', (data) => {
            const myId = this.props.call && (this.props.call.id || this.props.call._callId);
            if (!data || data.callId !== myId) return;
            const update = { remotePeerSharing: !!data.sharing };
            if (!data.sharing && this.state.pointerMode) update.pointerMode = false;
            // Either edge of the share resets the stall verdict: a fresh share
            // has not stalled yet, and a stopped one is no longer stalled.
            this._clearRemoteShareStallTimer();
            update.remoteShareStalled = false;
            // Share starting: force the remote view active so a stalled-camera
            // avatar (or the first sparse-frame 'mute') doesn't hide the screen.
            if (data.sharing) update.remoteVideoActive = true;
            // The 'mute' EVENT is edge-triggered, so if the peer's video track
            // is ALREADY muted when their 'start' arrives — they had video
            // muted, or the share died before its first frame — no further edge
            // is ever emitted and the deadline would never be armed. Arm it here
            // instead, so a share that produces nothing at all still gets a cue.
            if (data.sharing) {
                const t = this._monitoredRemoteVideoTrack;
                if (t && t.muted === true) this._startRemoteShareStallTimer();
            }
            // New share → assume the sharer is in-app until told otherwise.
            if (data.sharing) update.remoteInApp = true;
            this.setState(update);
        });

        // Peer ACKed a pointer click WE sent (app.js routes it here). Echo the
        // click locally as a green "confirmed" dot so the user sees the remote
        // actually rendered it.
        this._pointerAckSub = DeviceEventEmitter.addListener('sylkPointerAck', (data) => {
            const myId = this.props.call && (this.props.call.id || this.props.call._callId);
            if (!data || data.callId !== myId) return;
            const pos = this._pendingPointers && this._pendingPointers[data.t];
            if (!pos) return;
            delete this._pendingPointers[data.t];
            this._showLocalAck(pos.locX, pos.locY);
        });

        // Sharer (iOS) reports whether their app is foregrounded. When it's not,
        // our pointer can't be drawn on their screen, so hide the cursor / stop
        // sending. Default true; reset true when a share (re)starts.
        this._pointerVisSub = DeviceEventEmitter.addListener('sylkPointerVisibility', (data) => {
            const myId = this.props.call && (this.props.call.id || this.props.call._callId);
            if (!data || data.callId !== myId) return;
            this.setState({ remoteInApp: !!data.inApp });
        });
        // Keep the screen awake for the entire lifetime of the
        // video call UI. Without this, the OS idle timer dims and
        // locks the screen after ~30s of no touch — fine for an
        // audio call, but it kills the camera output and freezes
        // the peer's view in a video call. Works on both platforms
        // (iOS isIdleTimerDisabled, Android FLAG_KEEP_SCREEN_ON)
        // independent of InCallManager.start() status.
        try { InCallManager.setKeepScreenOn(true); } catch (e) { /* best effort */ }

        if (this.state.call) {
            this.state.call.on('stateChanged', this.callStateChanged);
            this.state.call.on('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            this.state.call.on('zrtpStrictH264VideoDrop', this.zrtpStrictH264VideoDrop);
            this.state.call.on('zrtpMediaStuckChanged', this.zrtpMediaStuckChanged);
            this.state.call.on('zrtpMediaDiagUpdated', this.zrtpMediaDiagUpdated);
            const existing = getZrtpSession(this.state.call);
            if (existing && existing.state) {
                const _seed = { zrtpState: existing.state };
                if (existing.mediaStuck) _seed.mediaStuck = true;
                this.setState(_seed);
            }

            // Trigger the answer for incoming video calls (mirrors what
            // AudioCallBox does for incoming audio). Previously this
            // happened inside LocalMedia's componentDidMount, which made
            // the user briefly see the preview screen flash by; now we
            // render VideoBox directly and answer from here.
            if (this.state.call.state === 'incoming' && this.props.mediaPlaying) {
                this.props.mediaPlaying();
            }

            // Call.js renders VideoBox only once the call is ALREADY
            // 'established' (or incoming), so the 'established' stateChanged
            // event usually fired BEFORE we registered the listener above —
            // callStateChanged('established') never runs, and the QoS sampler /
            // video-stats probe never start (that's why video calls had "no
            // client data"). Mirror AudioCallBox: if we mount mid-call, start
            // them now.
            if (this.state.call.state === 'established') {
                this._startVideoStatsProbe();
                if (this.state.call._pc) {
                    const _cid = this.state.call._callId || this.state.call.callId || this.state.call.id;
                    startQosLogging(this.state.call._pc, _cid);
                }
            }
        }

        // If the camera-enable prompt is up at mount, temporarily switch
        // the local video track on so the preview shows the actual camera.
        if (this.state.videoEnableDialogVisible) {
            this._enableTrackForPreview();
        }

        // Attach health listeners to the local video track. The native
        // MediaStreamTrack fires `mute` when the OS suspends frame
        // production (e.g. Samsung OneUI pausing the camera when the
        // screen turns off mid-call) and `unmute` when frames resume.
        // `ended` fires when the track is permanently torn down. These
        // are the events we need to spot the "peer sees frozen video"
        // class of bug — without them, applog gives no signal that the
        // camera stopped producing.
        this._attachLocalVideoTrackListeners(this.state.localStream);
        this._attachRemoteVideoTrackListeners(this.state.remoteStream);

        // Restore this contact's saved video-call layout (last used
        // camera, swapped views, self-view mirror visibility). If the
        // local stream hasn't landed yet (incoming accept), the camera
        // part is retried from cWRP when the stream arrives.
        this._applyVideoCallPrefs();

        this.armOverlayTimer();

        if (this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }

        // Listen for app.js → VideoBox notifications that an
        // outstanding conference_request was resolved (accept, reject,
        // or sibling-handled). Clears the "Inviting…" button immediately
        // instead of waiting on the 60 s self-clear. Same listener
        // contract as AudioCallBox.
        this._conferenceRequestResolvedSub = DeviceEventEmitter.addListener(
            'conferenceRequestResolved',
            this._handleConferenceRequestResolved
        );

        // Peer's capability advertisement landed (app.js parses it off the
        // in-call channel, stashes it on the call and re-broadcasts here).
        // Drives which peer-dependent kebab items we offer -- notably
        // "Request screen", which stays hidden until we know the far end
        // can actually share a screen.
        this._peerCapabilitiesSub = DeviceEventEmitter.addListener(
            'sylkPeerCapabilities',
            this._handlePeerCapabilities
        );

        // Peer answered a screen-share request WE sent (app.js decodes the
        // request_accept / request_reject reply off the in-call channel and
        // re-broadcasts it here). Clears the menu item's pending state
        // immediately instead of waiting out the 60 s expiry.
        this._screenRequestResolvedSub = DeviceEventEmitter.addListener(
            'sylkScreenShareRequestResolved',
            this._handleScreenShareRequestResolved
        );

        // The LOCAL user accepted an incoming screen-share request on the
        // app.js-owned modal. app.js owns the prompt; the capture machinery
        // lives here (selectScreenShare), so it pokes us to actually start.
        this._screenShareRequestedSub = DeviceEventEmitter.addListener(
            'sylkScreenShareRequested',
            this._handleScreenShareRequested
        );

        // A screen share was stopped from outside the app (Android cast
        // pill / iOS Control Center) while we were unmounted, and app.js
        // routed us back here. Put the camera that was running before the
        // share back on the wire and align this fresh instance's state with
        // it. Deferred to the next tick so the first render (and any
        // localStream the parent is about to hand us) has settled.
        const _restoreFacing = this.props.call && this.props.call._sylkRestoreCameraFacing;
        if (_restoreFacing) {
            this.props.call._sylkRestoreCameraFacing = null;
            setTimeout(() => {
                if (this._isMounted === false) return;
                this._restoreCameraAfterShare(_restoreFacing, 0);
            }, 0);
        }

        // Same accept, but taken while this component was NOT mounted (the
        // user had stepped off the call screen into the chat when the modal
        // appeared). app.js stamps the call object in that case; consume the
        // stamp now that we're back. The small defer lets the call screen
        // finish mounting before the OS capture-consent dialog goes up.
        const _pendingShareReq = this.props.call && this.props.call._sylkPendingScreenShareStart;
        if (_pendingShareReq) {
            this.props.call._sylkPendingScreenShareStart = null;
            if (!this.props.call._sylkScreenShare) {
                setTimeout(() => {
                    if (this._isMounted === false) return;
                    if (this.state.screenSharing) return;
                    console.log('[screen-request] resuming accepted share after remount');
                    this.selectScreenShare();
                }, 400);
            }
        }
    }

    componentWillUnmount() {
        this._isMounted = false;
        try { if (this._screenSharingSub) this._screenSharingSub.remove(); } catch (e) { /* noop */ }
        try { if (this._pointerAckSub) this._pointerAckSub.remove(); } catch (e) { /* noop */ }
        try { if (this._pointerVisSub) this._pointerVisSub.remove(); } catch (e) { /* noop */ }
        try { if (this._ackEchoTimer) clearTimeout(this._ackEchoTimer); } catch (e) { /* noop */ }
        // NOTE: we intentionally do NOT stop screen sharing here. VideoBox
        // unmounts every time the user navigates from the call screen to
        // another screen in the app — and stopping the share on unmount is
        // exactly what made "I can't open another screen in my own app while
        // sharing" happen. The share lives on the call (call._sylkScreenShare)
        // and keeps running across unmount/remount; it's torn down when the
        // CALL ends (via the call 'stateChanged'->terminated listener wired in
        // selectScreenShare) or when the user explicitly taps Stop Sharing.

        // Release the keep-screen-on we asserted at mount so the
        // OS idle timer resumes once the video UI is torn down.
        // Counterpart to setKeepScreenOn(true) in componentDidMount.
        try { InCallManager.setKeepScreenOn(false); } catch (e) { /* best effort */ }

        // Restore system chrome on the way out.
        //
        // toggleFullScreen() drives the device into immersive mode
        // (StatusBar.setHidden(true) + Immersive.on() on Android) so
        // that during a video call the user sees a clean canvas. If
        // the remote hangs up — or the local user hangs up via the
        // OS call notification, a hardware key, CallKit, or any path
        // that skips toggleFullScreen() — the component unmounts
        // while Android is still in immersive state. Result: the
        // system bar and the navigation bar stay hidden after the
        // call ends and the user is dropped back into the ready
        // screen with no chrome until they swipe from the edge.
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

        this.unmounted = true;
        this._stopVideoStatsProbe();
        stopQosLogging();
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            this.state.call.removeListener('zrtpMediaStuckChanged', this.zrtpMediaStuckChanged);
            this.state.call.removeListener('zrtpMediaDiagUpdated', this.zrtpMediaDiagUpdated);
        }

		if (this.state.call != null && this.state.call.statistics != null) {
			this.state.call.statistics.removeListener('stats', this.statistics);
        }

        this._detachLocalVideoTrackListeners();
        this._detachRemoteVideoTrackListeners();

        // Conference-request expiry timer + DeviceEventEmitter
        // listener cleanup. Same pattern as AudioCallBox: clear the
        // timer first (so a pending 60 s self-clear setState doesn't
        // fire on an unmounted instance) then drop the listener.
        if (this._conferenceRequestExpiryTimer) {
            clearTimeout(this._conferenceRequestExpiryTimer);
            this._conferenceRequestExpiryTimer = null;
        }
        if (this._conferenceRequestResolvedSub) {
            this._conferenceRequestResolvedSub.remove();
            this._conferenceRequestResolvedSub = null;
        }

        // Screen-share request: same ordering (timers first, then the
        // listeners) so a pending self-clear can't setState on an
        // unmounted instance.
        if (this._screenRequestExpiryTimer) {
            clearTimeout(this._screenRequestExpiryTimer);
            this._screenRequestExpiryTimer = null;
        }
        if (this._screenRequestNoticeTimer) {
            clearTimeout(this._screenRequestNoticeTimer);
            this._screenRequestNoticeTimer = null;
        }
        if (this._peerCapabilitiesSub) {
            this._peerCapabilitiesSub.remove();
            this._peerCapabilitiesSub = null;
        }
        if (this._screenRequestResolvedSub) {
            this._screenRequestResolvedSub.remove();
            this._screenRequestResolvedSub = null;
        }
        if (this._screenShareRequestedSub) {
            this._screenShareRequestedSub.remove();
            this._screenShareRequestedSub = null;
        }
    }

    // ---------------------------------------------------------------
    // Conference-request handshake (escalate 1-1 video → conference)
    //
    // Identical wire-level handshake to AudioCallBox.sendConferenceRequest:
    // one application/sylk-message-metadata payload with
    // action='conference_request', a deterministic numeric room URI
    // (DJB2 of sorted local + remote usernames, mod 1e9), and a 60 s
    // expires window. The peer's metadata router recognises the same
    // action shape regardless of which call type initiated it. See
    // AudioCallBox.js for the full per-line rationale; this is the
    // video-call entry point for the same flow.
    _hashUsernamesToRoom(input) {
        let h = 5381;
        for (let i = 0; i < input.length; i++) {
            h = ((h << 5) + h + input.charCodeAt(i)) | 0;
        }
        const positive = (h >>> 0);
        const mod = positive % 1000000000;
        return mod.toString().padStart(9, '0');
    }

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

    toggleConferenceRequestPanel() {
        this.setState({ showConferenceRequestPanel: !this.state.showConferenceRequestPanel });
    }

    closeConferenceRequestPanel() {
        if (this.state.showConferenceRequestPanel) {
            this.setState({ showConferenceRequestPanel: false });
        }
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
            requester: myUri,
            // SIP Call-ID (call._callId / call.callId), NOT call.id —
            // see AudioCallBox.sendConferenceRequest for the full
            // rationale. Used by sibling devices to recognise "this
            // request belongs to a call we're not on".
            call_id: (call._callId || call.callId || call.id),
            // Media type of the originating 1-1 call. Both sides use
            // this to decide whether to start the conference with
            // video=true or video=false, so escalating from a video
            // call keeps you in video and escalating from an audio
            // call keeps you in audio. Echoed back unchanged in the
            // accept payload. Default downstream is 'audio' when
            // missing (back-compat with peers running older builds
            // that didn't include this field).
            media: 'video',
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

        console.log('[conference-request] sent (video) →', peerUri,
            'room=', room, 'reqId=', requestId);
    }

    // ---------------------------------------------------------------
    // Local video track health logging
    //
    // Logs mute/unmute/ended on the outgoing camera track so applog
    // captures the moment the OS pauses or resumes the camera. Tagged
    // [video-track] so it grep's cleanly. Re-attached when the local
    // stream changes (UNSAFE_componentWillReceiveProps swaps it in
    // when the SDP answer arrives for incoming calls).
    // ---------------------------------------------------------------
    _attachLocalVideoTrackListeners(localStream) {
        try {
            if (!localStream || !localStream.getVideoTracks) return;
            const tracks = localStream.getVideoTracks();
            if (!tracks || tracks.length === 0) return;
            const track = tracks[0];
            if (this._monitoredVideoTrack === track) return; // already attached

            this._detachLocalVideoTrackListeners();

            this._videoTrackOnMute = () => {
                utils.timestampedLog(
                    '[video-track] [call] mute',
                    'id=', track.id,
                    'enabled=', track.enabled,
                    'callUUID=', (this.props.call && this.props.call.id)
                );
            };
            this._videoTrackOnUnmute = () => {
                utils.timestampedLog(
                    '[video-track] [call] unmute',
                    'id=', track.id,
                    'enabled=', track.enabled,
                    'callUUID=', (this.props.call && this.props.call.id)
                );
            };
            this._videoTrackOnEnded = () => {
                utils.timestampedLog(
                    '[video-track] [call] ended',
                    'id=', track.id,
                    'callUUID=', (this.props.call && this.props.call.id)
                );
            };

            // react-native-webrtc exposes the standard WebRTC track
            // event surface — addEventListener is preferred over the
            // on* assignment because it composes with any future
            // listener (and matches how we tear down below).
            if (typeof track.addEventListener === 'function') {
                track.addEventListener('mute',   this._videoTrackOnMute);
                track.addEventListener('unmute', this._videoTrackOnUnmute);
                track.addEventListener('ended',  this._videoTrackOnEnded);
            } else {
                track.onmute   = this._videoTrackOnMute;
                track.onunmute = this._videoTrackOnUnmute;
                track.onended  = this._videoTrackOnEnded;
            }

            this._monitoredVideoTrack = track;

            /*
            utils.timestampedLog(
                '[video-track] [call] monitor attached',
                'id=', track.id,
                'enabled=', track.enabled,
                'muted=', track.muted,
                'callUUID=', (this.props.call && this.props.call.id)
            );
            */
        } catch (e) {
            console.log('[video-track] attach failed:', e && e.message);
        }
    }

    _detachLocalVideoTrackListeners() {
        const track = this._monitoredVideoTrack;
        if (!track) return;
        try {
            if (typeof track.removeEventListener === 'function') {
                if (this._videoTrackOnMute)   track.removeEventListener('mute',   this._videoTrackOnMute);
                if (this._videoTrackOnUnmute) track.removeEventListener('unmute', this._videoTrackOnUnmute);
                if (this._videoTrackOnEnded)  track.removeEventListener('ended',  this._videoTrackOnEnded);
            } else {
                if (track.onmute   === this._videoTrackOnMute)   track.onmute   = null;
                if (track.onunmute === this._videoTrackOnUnmute) track.onunmute = null;
                if (track.onended  === this._videoTrackOnEnded)  track.onended  = null;
            }
        } catch (e) { /* track may already be torn down */ }
        this._monitoredVideoTrack = null;
        this._videoTrackOnMute = null;
        this._videoTrackOnUnmute = null;
        this._videoTrackOnEnded = null;
    }

    // ---------------------------------------------------------------
    // Remote video track presence / activity
    //
    // Drives the avatar placeholder: when the remote party's video
    // track is absent, ended, or muted (RTP stalled), we cover the
    // black RTCView with the remote's round avatar — the same circle
    // AudioCallBox shows. state.remoteVideoActive is the single source
    // of truth the render reads. We set it synchronously from the
    // current track (events alone are unreliable: a track that arrives
    // already-unmuted may never fire 'unmute'), then keep it in sync
    // via mute/unmute/ended.
    // ---------------------------------------------------------------
    /** Arm the "peer's screen share looks dead" deadline. A static screen
     *  legitimately mutes the track for a few seconds at a time, so we only
     *  believe it once the track has stayed muted for REMOTE_SHARE_STALL_MS. */
    _startRemoteShareStallTimer() {
        if (this._remoteShareStallTimer) return;   // already counting down
        this._remoteShareStallTimer = setTimeout(() => {
            this._remoteShareStallTimer = null;
            if (!this.state.remotePeerSharing) return;
            const track = this._monitoredRemoteVideoTrack;
            // Recovered while we were waiting — nothing to report.
            if (track && track.muted !== true) return;
            utils.timestampedLog('[video-track] [remote] no screen updates for',
                (REMOTE_SHARE_STALL_MS / 1000) + 's —',
                'the picture on screen is stale (peer screen may simply be idle)');
            if (!this.state.remoteShareStalled) this.setState({ remoteShareStalled: true });
        }, REMOTE_SHARE_STALL_MS);
    }

    _clearRemoteShareStallTimer() {
        if (!this._remoteShareStallTimer) return;
        clearTimeout(this._remoteShareStallTimer);
        this._remoteShareStallTimer = null;
    }

    _attachRemoteVideoTrackListeners(remoteStream) {
        try {
            this._detachRemoteVideoTrackListeners();

            const tracks = (remoteStream && remoteStream.getVideoTracks)
                ? remoteStream.getVideoTracks() : [];
            const track = (tracks && tracks.length > 0) ? tracks[0] : null;

            // No live/unmuted remote video track → show the avatar. But if the
            // peer is screen sharing, treat it as active regardless of the
            // track's momentary mute state (sparse screen frames read as muted).
            const activeNow = this.state.remotePeerSharing
                ? true
                : !!(track && track.muted !== true);
            if (this.state.remoteVideoActive !== activeNow) {
                this.setState({ remoteVideoActive: activeNow });
            }
            if (!track) return;

            this._remoteVideoOnMute = () => {
                utils.timestampedLog('[video-track] [remote] mute', 'id=', track.id,
                    'callUUID=', (this.props.call && this.props.call.id),
                    'remotePeerSharing=', !!this.state.remotePeerSharing);
                // While the peer is SCREEN SHARING, a static screen sends very
                // few frames, so the track fires spurious 'mute' events even
                // though the share is fine. Switching to the avatar there is too
                // aggressive — keep showing the (last) shared frame.
                //
                // But "sparse" is not "dead", and we used to make no distinction:
                // on 2026-08-16 the peer's capture deadlocked, this fired at
                // 12:29:39, we returned, and the viewer sat on a frozen frame for
                // 52 seconds with no indication anything was wrong. So give it a
                // DEADLINE instead: if the track is still muted when the timer
                // fires, the share really is stalled and we say so.
                if (this.state.remotePeerSharing) {
                    this._startRemoteShareStallTimer();
                    return;
                }
                if (this.state.remoteVideoActive) this.setState({ remoteVideoActive: false });
            };
            this._remoteVideoOnUnmute = () => {
                utils.timestampedLog('[video-track] [remote] unmute', 'id=', track.id,
                    'callUUID=', (this.props.call && this.props.call.id));
                this._clearRemoteShareStallTimer();
                if (this.state.remoteShareStalled) this.setState({ remoteShareStalled: false });
                if (!this.state.remoteVideoActive) this.setState({ remoteVideoActive: true });
            };
            this._remoteVideoOnEnded = () => {
                utils.timestampedLog('[video-track] [remote] ended', 'id=', track.id,
                    'callUUID=', (this.props.call && this.props.call.id));
                this._clearRemoteShareStallTimer();
                // Also drop the "no updates" cue: the track is gone, so the cue
                // would otherwise stay on screen forever whenever the peer's
                // 'stop' signal never arrives — which is the whole premise of
                // the bug this was added for.
                if (this.state.remoteShareStalled) this.setState({ remoteShareStalled: false });
                if (this.state.remoteVideoActive) this.setState({ remoteVideoActive: false });
            };

            if (typeof track.addEventListener === 'function') {
                track.addEventListener('mute',   this._remoteVideoOnMute);
                track.addEventListener('unmute', this._remoteVideoOnUnmute);
                track.addEventListener('ended',  this._remoteVideoOnEnded);
            } else {
                track.onmute   = this._remoteVideoOnMute;
                track.onunmute = this._remoteVideoOnUnmute;
                track.onended  = this._remoteVideoOnEnded;
            }
            this._monitoredRemoteVideoTrack = track;
        } catch (e) {
            console.log('[video-track] remote attach failed:', e && e.message);
        }
    }

    _detachRemoteVideoTrackListeners() {
        this._clearRemoteShareStallTimer();
        const track = this._monitoredRemoteVideoTrack;
        if (!track) return;
        try {
            if (typeof track.removeEventListener === 'function') {
                if (this._remoteVideoOnMute)   track.removeEventListener('mute',   this._remoteVideoOnMute);
                if (this._remoteVideoOnUnmute) track.removeEventListener('unmute', this._remoteVideoOnUnmute);
                if (this._remoteVideoOnEnded)  track.removeEventListener('ended',  this._remoteVideoOnEnded);
            } else {
                if (track.onmute   === this._remoteVideoOnMute)   track.onmute   = null;
                if (track.onunmute === this._remoteVideoOnUnmute) track.onunmute = null;
                if (track.onended  === this._remoteVideoOnEnded)  track.onended  = null;
            }
        } catch (e) { /* track may already be torn down */ }
        this._monitoredRemoteVideoTrack = null;
        this._remoteVideoOnMute = null;
        this._remoteVideoOnUnmute = null;
        this._remoteVideoOnEnded = null;
    }

    get showMyself() {
		// During the camera-enable modal we render a NATIVE
		// (RNCamera) preview tile instead of the webrtc PIP — see
		// the renderCameraEnableModal block. Hide the PIP so the
		// user doesn't see two corner copies of their own face
		// fighting for attention while the modal is up.
		if (this.state.videoEnableDialogVisible) return false;
		// While the PEER is sharing their screen, hide our own self-view
		// ("mirror") so the shared screen has the corner to itself. Auto-
		// restores when they stop: remotePeerSharing flips back to false via
		// the sylkScreenSharingChanged listener and this getter re-evaluates.
		if (this.state.remotePeerSharing) return false;
		return this.state.showMyself && !this.state.videoMuted && this.state.enableMyVideo;
	}

    handleFullscreen(event) {
        event.preventDefault();
        // this.toggleFullscreen();
    }

    handleRemoteVideoPlaying() {
        this.setState({remoteVideoShow: true});
    }

	toggleAspectRatio() {
	    console.log('toggleAspectRatio');
	    this.setState({aspectRatio: this.state.aspectRatio == 'cover' ? 'contain' : 'cover'});
	}
    
	toggleFullScreen() {
		//console.log(' --toggleFullScreen');

		if (this.state.callOverlayVisible) {			
			this.setState({callOverlayVisible: false, fullScreen: true});
			StatusBar.setHidden(true, 'fade');
			if (Platform.OS === 'android') {
				Immersive.on();
				this.props.enableFullScreen();
			}
		} else {
			this.setState({callOverlayVisible: true, fullScreen: false});
			StatusBar.setHidden(false, 'fade');
			if (Platform.OS === 'android') {
				Immersive.off();
				this.props.disableFullScreen();
			}
		}
	}

    handleRemoteResize(event, target) {
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({remoteSharesScreen: true});
        } else {
            this.setState({remoteSharesScreen: false});
        }
    }

    muteAudio(event) {
        event.preventDefault();
        this.props.toggleMute(this.state.call.id, !this.state.audioMuted);
    }

    muteVideo(event) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        this.toggleVideoMute();
    }

    toggleVideoMute() {
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if (this.state.videoMuted) {
                DEBUG('Unmute camera');
                track.enabled = true;
                // If the user previously chose "Audio only" / Cancel on
                // the camera-enable modal, the RTCRtpSender was left
                // with replaceTrack(null) in effect. Setting
                // track.enabled = true here only un-blacks the local
                // preview — the wire-level sender still has no track,
                // so the remote stays empty. Re-attach defensively;
                // no-op if the sender is already wired up.
                this._ensureSenderHasTrack(track);
                // Pair the unmute with a forced "show mirror" if
                // the user had previously hidden it. Rationale:
                // a user who stopped video and also closed the
                // mirror has no on-screen confirmation that their
                // camera is actually running when they later tap
                // Start video — the local preview is the most
                // obvious feedback. Bringing the mirror back on
                // every unmute (when it's currently hidden)
                // avoids the "did I really turn it back on?"
                // moment. Tapping Stop video again leaves the
                // mirror state alone; tapping Hide mirror after
                // unmute still hides it explicitly. We only
                // change enableMyVideo when it's currently false,
                // so the user's "already showing" state is
                // preserved.
                const update = {videoMuted: false};
                if (this.state.enableMyVideo === false) {
                    update.enableMyVideo = true;
                }
                this.setState(update);
            } else {
                DEBUG('Mute camera');
                track.enabled = false;
                this.setState({videoMuted: true});
            }
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

	renderAudioDevicePicker(buttonSize, buttonClass) {
		const devices = this.props.availableAudioDevices || [];
		const selectedIcon = utils.availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || 'phone-in-talk';

		// Only one device available — there is nothing to switch to, so
		// don't show the audio-device button at all.
		if (devices.length <= 1) return null;

		// Variant 1: cycle through devices on tap
		if (AUDIO_DEVICE_PICKER_MODE === 'cycle') {
			return (
				<View style={styles.buttonContainer}>
					<IconButton
						size={buttonSize}
						style={[buttonClass]}
						icon={selectedIcon}
						onPress={() => this.toggleAudioDevice()}
					/>
				</View>
			);
		}

		// Variant 2: react-native-paper Menu (icon + device name per row)
		if (AUDIO_DEVICE_PICKER_MODE === 'menu') {
			return (
				<Menu theme={getMenuTheme().menuTheme}
					visible={this.state.audioDevicePickerVisible}
					onDismiss={() => this.setState({audioDevicePickerVisible: false})}
					anchor={
						<View style={styles.buttonContainer}>
							<IconButton
								size={buttonSize}
								style={[buttonClass]}
								icon={selectedIcon}
								onPress={() => this.setState({audioDevicePickerVisible: true})}
							/>
						</View>
					}
				>
					{devices.map(device => {
						const isSelected = device === this.props.selectedAudioDevice;
						const deviceIcon = utils.availableAudioDevicesIconsMap[device] || 'phone-in-talk';
						const deviceName = utils.availableAudioDeviceNames[device] || device;
						return (
							<Menu.Item theme={getMenuTheme().menuTheme}
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
			// With exactly two devices the menu is overkill — tapping the
			// button just flips to the other one. The floating list only
			// appears at 3+.
			const toggleOnly = devices.length === 2 && otherDevices.length === 1;
			return (
				<View style={styles.buttonContainer}>
					{!toggleOnly && this.state.audioDevicePickerVisible && otherDevices.length > 0 && (
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
								<IconButton
									key={device}
									size={buttonSize}
									style={[buttonClass, {marginBottom: 6}]}
									icon={utils.availableAudioDevicesIconsMap[device] || 'phone-in-talk'}
									onPress={() => {
										this.props.selectAudioDevice(device);
										this.setState({audioDevicePickerVisible: false});
									}}
								/>
							))}
						</View>
					)}
					<IconButton
						size={buttonSize}
						style={[buttonClass]}
						icon={selectedIcon}
						onPress={() => {
							if (toggleOnly) {
								this.props.selectAudioDevice(otherDevices[0]);
								// Make sure any prior floating panel is collapsed.
								this.setState({
									audioDevicePickerVisible: false,
									videoPickerVisible: false
								});
							} else {
								this.setState({
									audioDevicePickerVisible: !this.state.audioDevicePickerVisible,
									// Collapse the video picker when opening (or
									// toggling) the audio picker — only one
									// floating menu should be visible at a time.
									videoPickerVisible: false
								});
							}
						}}
					/>
				</View>
			);
		}

		return null;
	}

    /* ─── Per-contact video-call preferences ──────────────────────
     * last_camera / video_swapped / show_mirror are remembered PER
     * CONTACT, device-only (contact.localProperties in the local SQL
     * contacts table — never synced to the server, same store as the
     * ZRTP cache). Read back at mount via _applyVideoCallPrefs so a
     * video call with the same contact starts on the camera / swap /
     * mirror layout the user last used with them; written on every
     * user toggle via _persistVideoCallPrefs → props.saveVideoCallPrefs
     * (app.js). */

    _getVideoCallPrefs() {
        const contact = this.state.callContact || this.props.callContact;
        return (contact && contact.localProperties
            && contact.localProperties.videoCallPrefs) || null;
    }

    /**
     * Persist the current camera / swap / mirror choices for this
     * contact. `overrides` carries the value(s) that just changed —
     * setState is async, so callers pass the new value explicitly
     * instead of relying on this.state having updated already.
     */
    _persistVideoCallPrefs(overrides = {}) {
        try {
            if (typeof this.props.saveVideoCallPrefs !== 'function') return;
            const contact = this.state.callContact || this.props.callContact;
            const uri = (contact && contact.uri) || this.state.remoteUri || this.props.remoteUri;
            if (!uri) return;
            const prefs = Object.assign({
                last_camera: this.state.cameraFacing || 'front',
                video_swapped: !!this.state.swapVideo,
                show_mirror: !!this.state.enableMyVideo
            }, overrides);
            this.props.saveVideoCallPrefs(uri, prefs);
        } catch (e) {
            console.log('[video-prefs] persist failed:', e && e.message);
        }
    }

    /**
     * Apply this contact's saved video-call preferences.
     *
     * swap / mirror are pure UI state and are applied exactly once, at
     * mount. The camera switch needs a live local video track; on
     * incoming accept the stream can land AFTER mount (via cWRP), so
     * the camera part keeps retrying — cWRP calls back in with the
     * freshly resolved stream — until a track exists. streamOverride
     * lets that cWRP call pass the new stream before setState lands.
     */
    _applyVideoCallPrefs(streamOverride) {
        // DISABLED 2026-08-13 (per request): do NOT load/apply the last
        // per-contact video settings (video_swapped / show_mirror /
        // last_camera). Every video call now starts from the constructor
        // defaults — no swap, default mirror, front camera — regardless of
        // what layout was used with this contact before. The mark-flags are
        // set so the cWRP retry loop stops immediately. Persistence
        // (_persistVideoCallPrefs) is left intact but its output is no longer
        // read. To re-enable, delete the next three lines.
        this._videoPrefsUiApplied = true;
        this._videoPrefsCameraApplied = true;
        return;

        const prefs = this._getVideoCallPrefs();
        if (!prefs) {
            this._videoPrefsUiApplied = true;
            this._videoPrefsCameraApplied = true;
            return;
        }

        const update = {};

        if (!this._videoPrefsUiApplied) {
            this._videoPrefsUiApplied = true;
            if (typeof prefs.video_swapped === 'boolean'
                && prefs.video_swapped !== this.state.swapVideo) {
                update.swapVideo = prefs.video_swapped;
            }
            if (typeof prefs.show_mirror === 'boolean'
                && prefs.show_mirror !== this.state.enableMyVideo) {
                update.enableMyVideo = prefs.show_mirror;
            }
        }

        if (!this._videoPrefsCameraApplied) {
            if (prefs.last_camera !== 'back') {
                // front is the constructor default — nothing to switch
                this._videoPrefsCameraApplied = true;
            } else if ((this.state.cameraFacing || 'front') === 'back') {
                this._videoPrefsCameraApplied = true;
            } else {
                const localStream = streamOverride || this.state.localStream;
                const track = localStream && localStream.getVideoTracks
                    && localStream.getVideoTracks()[0];
                if (track) {
                    track._switchCamera();
                    update.mirror = !this.state.mirror;
                    update.cameraFacing = 'back';
                    this._videoPrefsCameraApplied = true;
                }
                // no track yet — leave the guard unset so the next
                // cWRP stream transition retries
            }
        }

        if (Object.keys(update).length > 0) {
            console.log('[video-prefs] applying saved prefs:', JSON.stringify(prefs));
            this.setState(update);
        }
    }

    toggleCamera(event) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            const newFacing = this.state.cameraFacing === 'front' ? 'back' : 'front';
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: newFacing
            });
            this._persistVideoCallPrefs({last_camera: newFacing});
        }
    }

    selectCamera(facing) {
        // Picking a camera while sharing the screen means "go back to the
        // camera" — tear the screen capture down first. _stopScreenShare
        // restores the camera track onto the sender, so the code below
        // then just applies the requested front/back facing on top.
        if (this.state.screenSharing) {
            this._stopScreenShare();
        }
        // If video is currently muted, picking a camera should also
        // unmute it — that's the only way out of the muted state from
        // the picker (the Unmute row is hidden when muted).
        if (this.state.videoMuted) {
            this.toggleVideoMute();
        }
        // Defensive re-attach: if state.videoMuted was already false
        // but the sender is still detached (e.g. the user pressed
        // Audio-only on the camera-enable modal then opened the
        // picker without ever using the mute toggle), toggleVideoMute
        // above was a no-op and the sender still has null track.
        // Cover that path here so picking a camera always results in
        // wire-level video.
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            this._ensureSenderHasTrack(track);
            // No-op (apart from the unmute / re-attach above) if we're
            // already on the requested camera.
            if (facing === this.state.cameraFacing) return;
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: facing
            });
            this._persistVideoCallPrefs({last_camera: facing});
        }
    }

    /** Return the RTCRtpSender that carries (or should carry) the outgoing
     *  video. Prefers a sender already holding a video track; falls back to
     *  a detached sender (e.g. when video was muted). Null if the peer
     *  connection isn't available yet. */
    _getVideoSender() {
        const pc = this.props.call && this.props.call._pc;
        if (!pc || typeof pc.getSenders !== 'function') return null;
        let detachedSender = null;
        for (const s of pc.getSenders()) {
            if (s.track && s.track.kind === 'video') return s;
            if (!s.track && !detachedSender) detachedSender = s;
        }
        return detachedSender;
    }

    /** Downscale the outgoing video so a full-resolution screen capture fits
     *  the negotiated H264 level. This is THE reason a naive replaceTrack of a
     *  phone-screen track produces no video on the far end: CallZrtp's
     *  _applyVideoBitrate() computes scaleResolutionDownBy once, from the
     *  camera size (scale≈1), and is guarded so it never re-runs. The screen
     *  (e.g. 1080x2400 on a tall device) then far exceeds level 3.1's ~3600
     *  macroblock / 1280x720 budget and the hardware encoder emits nothing —
     *  the receiver just sends unanswered PLI/FIRs and shows a frozen frame.
     *
     *  We snapshot the sender's current encodings (to restore the camera's
     *  tuning on stop) then set scaleResolutionDownBy so the longest edge is
     *  <= 1280 AND the area is within a 1280x720 budget, whichever is more
     *  aggressive. We only touch the fields we own and merge onto a fresh
     *  getParameters() snapshot, mirroring _applyVideoBitrate so we don't
     *  clobber `active` or anything else. */
    async _applyScreenEncoderParams(sender, screenTrack, share) {
        if (!sender || typeof sender.getParameters !== 'function') return;

        // Resolve the capture dimensions. Prefer the track's own settings;
        // fall back to the physical screen size in device pixels.
        let w = null, h = null;
        try {
            const st = (typeof screenTrack.getSettings === 'function') ? screenTrack.getSettings() : null;
            if (st && st.width && st.height) { w = st.width; h = st.height; }
        } catch (e) { /* fall through */ }
        if (!w || !h) {
            try {
                const d = Dimensions.get('screen');
                const pr = PixelRatio.get();
                w = Math.round(d.width * pr);
                h = Math.round(d.height * pr);
            } catch (e) { /* leave null */ }
        }

        const TARGET_MAX_LONG_EDGE = 1280;      // level 3.1 max width
        const TARGET_MAX_PIXELS = 1280 * 720;   // ~3600 macroblocks
        let scale = 1.0;
        if (w && h) {
            const longEdge = Math.max(w, h);
            const scaleLong = longEdge / TARGET_MAX_LONG_EDGE;
            const scaleArea = Math.sqrt((w * h) / TARGET_MAX_PIXELS);
            scale = Math.max(1.0, scaleLong, scaleArea);
        }
        console.log('[screen-share] capture', (w && h) ? (w + 'x' + h) : 'unknown',
            '-> scaleResolutionDownBy=', scale.toFixed(3));

        // Screen content favours resolution/clarity over motion smoothness.
        try { if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail'; } catch (e) { /* noop */ }

        try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            // Snapshot the pre-share encodings so the camera's tuning can be
            // put back exactly on stop. Stored on the share object (which lives
            // on the call) so a VideoBox that remounts mid-share can still
            // restore correctly.
            const snapshot = params.encodings.map(e => ({
                scaleResolutionDownBy: e.scaleResolutionDownBy,
                maxBitrate: e.maxBitrate,
                maxFramerate: e.maxFramerate
            }));
            if (share) share.preScreenEncodings = snapshot;
            else this._preScreenEncodings = snapshot;
            params.encodings.forEach(e => {
                e.active = true;
                e.scaleResolutionDownBy = scale;
                e.maxBitrate = 2000 * 1000;   // screen benefits from more bits
                e.maxFramerate = 15;          // ...at a lower frame rate
            });
            await sender.setParameters(params);
            console.log('[screen-share] encoder params applied for screen capture');
        } catch (e) {
            console.log('[screen-share] setParameters(screen) failed:', (e && e.message) || String(e));
        }
    }

    /** Restore the camera's encoder params captured in
     *  _applyScreenEncoderParams. Best-effort; merges onto a fresh snapshot. */
    async _restoreCameraEncoderParams(sender, share) {
        if (!sender || typeof sender.getParameters !== 'function') return;
        const snap = (share && share.preScreenEncodings) || this._preScreenEncodings;
        this._preScreenEncodings = null;
        if (!snap) return;
        try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) return;
            params.encodings.forEach((e, i) => {
                const prev = snap[i] || snap[0] || {};
                // scaleResolutionDownBy has no valid "unset" < 1; default to 1.
                e.scaleResolutionDownBy = (prev.scaleResolutionDownBy && prev.scaleResolutionDownBy >= 1)
                    ? prev.scaleResolutionDownBy : 1;
                if (prev.maxBitrate !== undefined) e.maxBitrate = prev.maxBitrate;
                if (prev.maxFramerate !== undefined) e.maxFramerate = prev.maxFramerate;
            });
            await sender.setParameters(params);
            console.log('[screen-share] camera encoder params restored');
        } catch (e) {
            console.log('[screen-share] restore encoder params failed:', (e && e.message) || String(e));
        }
    }

    /** Read the outbound-rtp framesSent counter for the video sender. Returns
     *  null when stats are unavailable — which is NOT the same as "no frames",
     *  and callers must not treat it as a stall. */
    async _readScreenFramesSent(call, sender) {
        try {
            let report = null;
            if (sender && typeof sender.getStats === 'function') {
                report = await sender.getStats();
            } else if (call && call._pc && typeof call._pc.getStats === 'function') {
                report = await call._pc.getStats();
            }
            if (!report || typeof report.forEach !== 'function') return null;
            let sent = null;
            report.forEach(s => {
                if (s && s.type === 'outbound-rtp'
                    && (s.kind === 'video' || s.mediaType === 'video')
                    && typeof s.framesSent === 'number') {
                    sent = s.framesSent;
                }
            });
            return sent;
        } catch (e) {
            return null;
        }
    }

    /** Confirmation that the screen capture is actually being transmitted.
     *  Samples the sender's outbound-rtp framesSent now and again a few seconds
     *  later; logs a clear ✓/✗ line so a test run shows at a glance whether
     *  frames are leaving the device (capture + encode OK) or the pipeline is
     *  stalled (e.g. MediaProjection foreground service not running → zero
     *  frames). Then hands over to the continuous watchdog below. */
    async _verifyScreenFramesFlowing(sender) {
        const call = this.props.call;
        const before = await this._readScreenFramesSent(call, sender);
        const myToken = (this._screenFrameCheckToken = (this._screenFrameCheckToken || 0) + 1);
        setTimeout(async () => {
            // Bail if sharing already stopped or a newer share superseded us.
            if (!this.state.screenSharing || myToken !== this._screenFrameCheckToken) return;
            const after = await this._readScreenFramesSent(call, sender);
            if (before === null || after === null) {
                console.log('[screen-share] frame check: outbound-rtp stats unavailable (before=' + before + ' after=' + after + ')');
            } else if (after > before) {
                console.log('[screen-share] ✓ screen frames FLOWING — framesSent ' + before + ' -> ' + after + ' (remote should see the screen)');
            } else {
                console.log('[screen-share] ✗ NO screen frames — framesSent stuck at ' + after
                    + ' — capture/projection not delivering (check MediaProjection foreground service + FOREGROUND_SERVICE_MEDIA_PROJECTION)');
            }
            // Whatever the verdict, keep watching for the rest of the share.
            this._startScreenShareWatchdog(call, sender);
        }, 3000);
    }

    /** Continuous liveness watchdog for an ACTIVE screen share.
     *
     *  Why this exists (freeze of 2026-08-16): the projection can die WITHOUT
     *  the native layer ever firing 'ended' on the capture track. On that
     *  occasion ScreenCapturerAndroid deadlocked between its orientation
     *  handler and MediaProjection.Callback.onStop, so onCapturerEnded() was
     *  never reached. The old one-shot +3s check had passed one second earlier
     *  and nothing ever looked again: the peer stared at a frozen frame for 52
     *  seconds, the navbar kept offering "stop sharing" with no session behind
     *  it, and no 'stop' was ever signalled.
     *
     *  So: poll framesSent for the LIFE of the share. When it stops advancing,
     *  synthesise the 'ended' the OS owed us — which runs the identical
     *  teardown path as a real system stop (restore camera, tell the peer,
     *  route back to the call).
     *
     *  The timer lives on the SHARE object, not on `this`: starting a share
     *  navigates to the chat and unmounts this VideoBox, so a component-bound
     *  timer would die exactly when we most need to be watching. */
    _startScreenShareWatchdog(call, sender) {
        const share = (call && call._sylkScreenShare) || null;
        if (!share) return;

        const POLL_MS = 3000;
        // Advisory only — see the note on framesSent below. Deliberately long:
        // somebody presenting a document really can leave the screen untouched
        // for half a minute.
        const NO_FRAMES_WARN_MS = 30000;

        try { clearTimeout(share.watchdogTimer); } catch (e) { /* noop */ }

        let lastFrames = null;
        let lastProgressAt = Date.now();
        let warned = false;

        const tick = async () => {
            // Torn down, stopped, or superseded by a newer share: we're done.
            if (!call || call._sylkScreenShare !== share) return;

            // ---- The decisive check -------------------------------------
            // A capture track whose readyState has left 'live' is dead, full
            // stop — there is no ambiguity and no false positive. We poll it
            // because the 'ended' EVENT is exactly what went missing: on
            // 2026-08-16 ScreenCapturerAndroid deadlocked before
            // onCapturerEnded() could run, so JS was never told. The native
            // deadlock itself is fixed in ScreenCaptureController.java; this is
            // the belt to that fix's braces, and it costs one property read.
            const track = share.screenTrack || null;
            if (!track || (track.readyState && track.readyState !== 'live')) {
                console.log('[screen-share] ✗ capture track is '
                    + (track ? track.readyState : 'gone')
                    + ' but no "ended" event arrived — ending the share');
                share.watchdogTimer = null;
                try {
                    // share.onEnded is the same handler the real 'ended' event
                    // runs, and is explicitly safe from an unmounted instance.
                    if (typeof share.onEnded === 'function') share.onEnded();
                    else this._teardownScreenShareResources(call, true);
                } catch (e) {
                    console.log('[screen-share] watchdog teardown threw:', (e && e.message) || String(e));
                }
                return;
            }

            // ---- The advisory check -------------------------------------
            // framesSent going flat CANNOT distinguish "the capture died" from
            // "the shared screen simply is not changing": Android's mirrored
            // VirtualDisplay only produces a buffer when the content changes, so
            // a motionless screen legitimately sends nothing. (The viewer side
            // knows this too — see the 'mute' handling in
            // _attachRemoteVideoTrackListeners.) So this NEVER tears anything
            // down; it only leaves a breadcrumb in the log, once per stall.
            const now = await this._readScreenFramesSent(call, sender);

            // Re-check after the await: teardown may have run while we were
            // reading stats, and resuming with a stale share would fire
            // onEnded() over the top of a share that is already gone.
            if (!call || call._sylkScreenShare !== share) return;

            if (now === null) {
                // Stats unreadable — not evidence of anything. Keep watching.
                share.watchdogTimer = setTimeout(tick, POLL_MS);
                return;
            }
            // `!==` rather than `>`: the counter can go BACKWARDS when the
            // outbound-rtp SSRC changes, and a `>` test would latch a permanent
            // false stall from which it could never recover.
            if (lastFrames === null || now !== lastFrames) {
                lastFrames = now;
                lastProgressAt = Date.now();
                if (warned) {
                    console.log('[screen-share] frames resumed — framesSent now ' + now);
                    warned = false;
                }
                share.watchdogTimer = setTimeout(tick, POLL_MS);
                return;
            }

            const flatFor = Date.now() - lastProgressAt;
            if (!warned && flatFor >= NO_FRAMES_WARN_MS) {
                warned = true;
                console.log('[screen-share] ⚠ no new frames for ' + Math.round(flatFor / 1000)
                    + 's (framesSent flat at ' + now + '). Normal for a motionless screen;'
                    + ' the share is NOT being touched. Capture track is still "live".');
            }
            share.watchdogTimer = setTimeout(tick, POLL_MS);
        };

        share.watchdogTimer = setTimeout(tick, POLL_MS);
    }

    /** Start (or, if already sharing, stop) a screen share. Presented in the
     *  video picker as a third input source alongside Front / Back Camera.
     *
     *  Mechanics: getDisplayMedia() prompts the OS consent dialog and (on
     *  Android) starts react-native-webrtc's MediaProjection foreground
     *  service internally. We replaceTrack() the screen track onto the
     *  existing video sender — same sender, same media kind, so there is NO
     *  SDP renegotiation and the remote/desktop side simply sees the picture
     *  change. The camera track is left running and stashed so restoring it
     *  on stop is a single replaceTrack. */
    async selectScreenShare() {
        const call = this.props.call;
        if (this.state.screenSharing || (call && call._sylkScreenShare)) {
            this._stopScreenShare();
            return;
        }
        const sender = this._getVideoSender();
        if (!sender || typeof sender.replaceTrack !== 'function') {
            // No video sender means this is an audio-only call: swapping in a
            // video track here would require a full renegotiation, which is a
            // separate path we don't attempt from the picker.
            console.log('[screen-share] no usable video sender — start a video call first');
            return;
        }

        console.log('[screen-share] start requested — platform=' + Platform.OS);
        let screenStream;
        try {
            // rn-webrtc registers getDisplayMedia on navigator.mediaDevices
            // as well; we use the imported mediaDevices for an explicit ref.
            screenStream = await mediaDevices.getDisplayMedia();
            console.log('[screen-share] getDisplayMedia resolved — capture track acquired'
                + (Platform.OS === 'ios' ? ' (awaiting broadcast start via picker)' : ''));
        } catch (e) {
            // User cancelled the system "Start recording/casting?" dialog, or
            // the projection failed to start. Nothing to clean up.
            console.log('[screen-share] getDisplayMedia rejected:', (e && e.message) || String(e));
            return;
        }

        const screenTrack = screenStream && screenStream.getVideoTracks
            && screenStream.getVideoTracks()[0];
        if (!screenTrack) {
            console.log('[screen-share] no video track in display stream');
            try { screenStream.getTracks().forEach(t => t.stop()); } catch (e) { /* noop */ }
            return;
        }

        // iOS: getDisplayMedia set up the capture socket + returned the track,
        // but on iOS the OS only starts delivering frames once the user starts
        // the broadcast via the system picker (RPSystemBroadcastPickerView).
        // Present it now by simulating a tap on the hidden ScreenCapturePickerView
        // (the extension is pre-selected via the RTCScreenSharingExtension key in
        // Info.plist). The broadcast extension retries connecting to our socket,
        // so this can fire before/after replaceTrack. (Android needs none of this
        // — MediaProjection delivers frames as soon as the foreground service is
        // up.) If the user cancels the sheet, no frames arrive — they can tap
        // Stop Sharing to revert.
        if (Platform.OS === 'ios') {
            try {
                const _tag = this._iosBroadcastPicker ? findNodeHandle(this._iosBroadcastPicker) : null;
                const _mgr = NativeModules.ScreenCapturePickerViewManager;
                if (_tag != null && _mgr && typeof _mgr.show === 'function') {
                    _mgr.show(_tag);
                    console.log('[screen-share] iOS broadcast picker presented');
                } else {
                    console.log('[screen-share] iOS picker unavailable (tag/mgr missing)');
                }
            } catch (e) {
                console.log('[screen-share] iOS picker show failed:', (e && e.message) || String(e));
            }
        }

        // The camera track currently on the sender — stash it so we can put it
        // back on stop. (On stop we prefer the CURRENT live camera track from
        // localStream, but this is a fallback.)
        const cameraTrack = (sender.track && sender.track.kind === 'video')
            ? sender.track
            : (this.state.localStream && this.state.localStream.getVideoTracks
                && this.state.localStream.getVideoTracks()[0]) || null;

        // The share record lives on the CALL, not this component, so it
        // survives VideoBox unmount/remount while the user navigates the app.
        const share = {
            screenStream,
            screenTrack,
            sender,
            cameraTrack,
            facingBefore: this.state.cameraFacing,
            preScreenEncodings: null,
            onEnded: null,
            callStateHandler: null
        };
        if (call) call._sylkScreenShare = share;
        // Fresh share: clear the 'broadcast already ended' guard used by the iOS
        // clean-stop path in _stopScreenShare (see there for why).
        this._iosBroadcastEnded = false;

        try {
            await sender.replaceTrack(screenTrack);
            console.log('[screen-share] outgoing video sender swapped to screen track');
        } catch (e) {
            console.log('[screen-share] replaceTrack(screen) failed:', (e && e.message) || String(e));
            try { screenStream.getTracks().forEach(t => t.stop()); } catch (err) { /* noop */ }
            if (call) call._sylkScreenShare = null;
            return;
        }

        // CRITICAL: without this the far end receives no frames. The sender is
        // still tuned for the (small) camera; a full-res screen overruns the
        // negotiated H264 level and the encoder stalls. Re-scale for the screen.
        await this._applyScreenEncoderParams(sender, screenTrack, share);

        // Diagnostic: log a ✓/✗ line once we know whether frames are actually
        // being transmitted, so a test run is readable at a glance.
        this._verifyScreenFramesFlowing(sender);

        // The screen track ends when the user taps "Stop" on the system cast
        // notification (or the OS revokes projection). Tear the share down —
        // guard state updates in case the component that started the share has
        // since unmounted (user navigated away while sharing).
        const onEnded = () => {
            console.log('[screen-share] screen track ENDED — broadcast/projection stopped by OS or user');
            // The broadcast has genuinely ended (system/Control-Center stop, or
            // our own picker-toggle stop). Mark it so _stopScreenShare tears down
            // instead of toggling the picker again (which would RESTART sharing).
            this._iosBroadcastEnded = true;
            clearTimeout(this._iosStopFallbackTimer);
            try { if (screenTrack.removeEventListener) screenTrack.removeEventListener('ended', onEnded); } catch (e) { /* noop */ }
            // Remember which camera was live before the share so the
            // returning video-call screen can put it back. Read from
            // `share` BEFORE teardown nulls call._sylkScreenShare, and
            // stashed on the CALL rather than in component state: on the
            // system-stop path this instance is normally unmounted (starting
            // a share navigates to the chat), so a FRESH VideoBox is what
            // has to consume it.
            if (call) {
                call._sylkRestoreCameraFacing = (share.facingBefore === 'back') ? 'back' : 'front';
            }
            // The user may have tapped "Stop" on the Android system cast pill
            // while the app was in the background (they shared, then switched
            // apps). Bring our call UI back to the foreground so they land on
            // the live call instead of whatever app was on top.
            if (Platform.OS === 'android') {
                try { NativeModules.SylkBridge && NativeModules.SylkBridge.bringAppToForeground(); }
                catch (e) { /* noop */ }
            }
            if (this._isMounted !== false && this.state.screenSharing) {
                this._stopScreenShare();
            } else {
                this._teardownScreenShareResources(call, true);
                // VideoBox is unmounted (user is on the chat screen), so
                // _stopScreenShare's inset refresh won't run — do it here so the
                // returning app doesn't overlap the top/bottom system bars.
                if (Platform.OS === 'android' && NativeModules.SylkBridge
                        && typeof NativeModules.SylkBridge.refreshSystemInsets === 'function') {
                    setTimeout(() => {
                        try { NativeModules.SylkBridge.refreshSystemInsets(); } catch (e) { /* noop */ }
                    }, 400);
                }
            }
            // Take the user back to the video-call screen. The share had
            // moved them to the chat; with nothing left to present, the call
            // UI is where the controls are. Routing is app.js's job -- this
            // component is usually unmounted at this point -- so we signal
            // and let it decide. Emitted LAST so teardown (sender restored to
            // the camera track, projection released) has finished before the
            // new VideoBox mounts and reads call._sylkRestoreCameraFacing.
            //
            // Suppressed when the CALL is what ended: stopping the tracks in
            // that path also fires 'ended', and there is nothing to go back
            // to. app.js's goBackToCall() no-ops without an active call, so
            // this is belt and braces.
            const _callAlive = call && call.state !== 'terminated'
                && call.state !== 'closed' && call.state !== 'failed';
            if (_callAlive) {
                try {
                    DeviceEventEmitter.emit('sylkScreenShareStopped', {
                        callId: call.id || call._callId,
                    });
                } catch (e) { /* noop */ }
            }
        };
        share.onEnded = onEnded;
        try {
            if (screenTrack.addEventListener) screenTrack.addEventListener('ended', onEnded);
            else screenTrack.onended = onEnded;
        } catch (e) {
            try { screenTrack.onended = onEnded; } catch (err) { /* noop */ }
        }

        // When the CALL ends, tear down the projection regardless of whether a
        // VideoBox is currently mounted — decoupled from component lifecycle.
        if (call && typeof call.on === 'function') {
            // sylkrtc emits stateChanged as (oldState, newState, data).
            const callStateHandler = (oldState, newState) => {
                if (newState === 'terminated' || newState === 'closed' || newState === 'failed') {
                    try { call.removeListener && call.removeListener('stateChanged', callStateHandler); } catch (e) { /* noop */ }
                    // iOS: the call is ending while we're still screen-sharing.
                    // End the broadcast through the SYSTEM picker FIRST so the
                    // extension finishes cleanly (broadcastFinished) instead of
                    // hitting finishBroadcastWithError — otherwise iOS pops a
                    // "Screen sharing stopped" FAILURE alert as the call hangs up.
                    // Then tear down our media (deferred briefly so the clean
                    // stop wins the race with our socket close). Best effort: the
                    // picker view must be mounted; if not, we fall back to the
                    // plain teardown (which may still show the alert).
                    let _sysStopped = false;
                    if (Platform.OS === 'ios' && !this._iosBroadcastEnded) {
                        try {
                            const _tag = this._iosBroadcastPicker ? findNodeHandle(this._iosBroadcastPicker) : null;
                            const _mgr = NativeModules.ScreenCapturePickerViewManager;
                            if (_tag != null && _mgr && typeof _mgr.show === 'function') {
                                this._iosBroadcastEnded = true;
                                _mgr.show(_tag);
                                _sysStopped = true;
                                console.log('[screen-share] call ended — stopping broadcast via system (no failure alert)');
                            }
                        } catch (e) { /* fall through to plain teardown */ }
                    }
                    if (_sysStopped) {
                        setTimeout(() => { this._teardownScreenShareResources(call, false); }, 300);
                    } else {
                        this._teardownScreenShareResources(call, false);
                    }
                }
            };
            share.callStateHandler = callStateHandler;
            try { call.on('stateChanged', callStateHandler); } catch (e) { /* noop */ }
        }

        // Sharing implicitly un-mutes outgoing video (the sender now has a
        // live track). Flip the picker into "screen" mode.
        const update = { screenSharing: true, cameraFacing: 'screen' };
        if (this.state.videoMuted) update.videoMuted = false;
        this.setState(update);

        // Commit the share (advertise to the peer + navigate to chat). On
        // Android MediaProjection delivers frames as soon as getDisplayMedia()
        // resolves, so we commit immediately. On iOS the broadcast only truly
        // STARTS once the user confirms the system picker (and its 3s
        // countdown) AND the broadcast extension connects — no frames flow
        // until then. Committing early would tell the peer we\'re sharing and
        // drop us onto the chat while the stream is actually dead (e.g. the
        // user cancels the sheet). So on iOS we wait for real outbound frames,
        // then commit — or revert if none ever arrive.
        if (Platform.OS === 'ios') {
            // Tell the peer we're sharing RIGHT NOW so their pointer button
            // appears and they can guide us — do NOT gate this on frame
            // confirmation. framesSent can lag or read stale on iOS, and if the
            // peer never learns we're sharing it never sends pointers back (so
            // the on-screen guide marker never appears). If the broadcast turns
            // out never to start, _confirmIosBroadcast reverts and
            // _stopScreenShare sends a matching 'stop'.
            this._sendScreenSharingSignal('start');
            this._confirmIosBroadcast(call, sender);
        } else {
            this._commitScreenShareStarted(call);
            this._verifyScreenFramesFlowing(sender);
        }
    }

    /** Advertise the started share to the peer and navigate back to the chat so
     *  our shared screen shows the conversation (not the video-call UI, which
     *  would echo the remote\'s own video back at them). Split out so iOS can
     *  defer it until the broadcast is confirmed actually running. */
    _commitScreenShareStarted(call) {
        // Tell the peer we\'re now sharing so their pointer button can appear.
        this._sendScreenSharingSignal('start');
        // Navigate back to the chat with the caller. The call stays active:
        // goBackFunc (goBackToHomeFromCall) routes with reason 'back to home',
        // which skips call teardown, and the screen-capture track lives on
        // call._sylkScreenShare so it survives this unmount.
        if (typeof this.props.goBackFunc === 'function') {
            try { this.props.goBackFunc(); }
            catch (e) { console.log('[screen-share] goBack on share failed:', (e && e.message) || String(e)); }
        }
    }

    /** iOS-only: confirm the broadcast REALLY started before committing.
     *  getDisplayMedia() resolves when the capture socket is ready, but frames
     *  only flow once the user starts the broadcast from the system picker and
     *  the extension connects. Poll outbound framesSent: once it grows the
     *  broadcast is live -> commit; if it is still zero after a generous
     *  timeout the user cancelled (or the extension never connected) -> revert
     *  so we are not stuck showing "sharing" over a dead stream. */
    async _confirmIosBroadcast(call, sender) {
        const readFramesSent = () => this._readScreenFramesSent(call, sender);

        const token = (this._screenFrameCheckToken = (this._screenFrameCheckToken || 0) + 1);
        const baseline = (await readFramesSent()) || 0;
        const startedAt = Date.now();
        const TIMEOUT_MS = 20000;   // allow for tapping through the picker + its 3s countdown
        const POLL_MS = 1000;

        const poll = async () => {
            // Superseded by a newer share, or the user already stopped manually.
            if (token !== this._screenFrameCheckToken) return;
            if (!this.state.screenSharing || !(call && call._sylkScreenShare)) return;

            const now = await readFramesSent();
            if (now !== null && now > baseline) {
                console.log('[screen-share] \u2713 iOS broadcast confirmed \u2014 framesSent ' + baseline + ' -> ' + now);
                this._commitScreenShareStarted(call);
                // Now that the broadcast is genuinely live, watch it for the
                // rest of the share the same way Android does.
                this._startScreenShareWatchdog(call, sender);
                return;
            }
            if (Date.now() - startedAt >= TIMEOUT_MS) {
                console.log('[screen-share] \u2717 iOS broadcast never started (no frames in '
                    + (TIMEOUT_MS / 1000) + 's) \u2014 reverting');
                if (this._isMounted !== false) {
                    this._stopScreenShare();
                } else {
                    this._teardownScreenShareResources(call, true);
                }
                try {
                    Alert.alert('Screen sharing did not start',
                        'The broadcast was not started. Tap Share Screen and choose Sylk (Blink), then "Start Broadcast".');
                } catch (e) { /* noop */ }
                return;
            }
            setTimeout(poll, POLL_MS);
        };
        setTimeout(poll, POLL_MS);
    }

    /** Tear down the screen-share MEDIA resources held on the call. Does NOT
     *  touch component state (safe to call from a stale/unmounted instance or
     *  the call-terminated listener). `restoreCamera` puts the camera track
     *  back on the sender + restores its encoder tuning; pass false when the
     *  call itself is ending (nothing to restore into). */
    _teardownScreenShareResources(call, restoreCamera) {
        const share = (call && call._sylkScreenShare) || null;
        if (!share) return;
        console.log('[screen-share] tearing down share resources (restoreCamera=' + !!restoreCamera + ')');

        // Stop the liveness watchdog first: clearing call._sylkScreenShare below
        // would already make it bail on its next tick, but there is no reason to
        // leave a timer pending through teardown.
        try { clearTimeout(share.watchdogTimer); } catch (e) { /* noop */ }
        share.watchdogTimer = null;

        if (call) call._sylkScreenShare = null;

        // Tell the peer we stopped sharing so their pointer button goes away —
        // unless hangupCall() already did it while the session was still alive.
        // Signalling from here on the call-ended path is too late: sylkrtc has
        // destroyed the session and sendMessage fails with "Unknown session".
        if (!share.stopSignalled) {
            this._sendScreenSharingSignal('stop');
            share.stopSignalled = true;
        }

        const sender = share.sender || this._getVideoSender();

        if (restoreCamera && sender && typeof sender.replaceTrack === 'function') {
            // Prefer the CURRENT live camera track from localStream over the
            // one stashed at share start: if the app refreshed local media
            // during the share, the stashed track may be stale/stopped and
            // replaceTrack-ing it back would show a black frame. Fall back to
            // the stash only if we can't read a live one now.
            const liveCameraTrack = (this.state.localStream && this.state.localStream.getVideoTracks
                && this.state.localStream.getVideoTracks()[0]) || null;
            const cameraTrack = liveCameraTrack || share.cameraTrack || null;
            try {
                sender.replaceTrack(cameraTrack || null);
            } catch (e) {
                console.log('[screen-share] restore camera replaceTrack failed:', (e && e.message) || String(e));
            }
            // Undo the screen downscale so the camera returns to normal tuning.
            this._restoreCameraEncoderParams(sender, share);
        }

        // Remove the call-terminated listener (if we're not being called from it).
        try {
            if (share.callStateHandler && call && call.removeListener) {
                call.removeListener('stateChanged', share.callStateHandler);
            }
        } catch (e) { /* noop */ }

        // Stop AND release the display-capture track. In react-native-webrtc,
        // track.stop() ONLY marks the track ended (enabled=false); it does NOT
        // dispose the native capturer, so the Android MediaProjection stays
        // alive and the system keeps showing its "casting / stop screen sharing"
        // indicator (and prompts) after we've ended the stream. track.release()
        // calls mediaStreamTrackRelease -> GetUserMediaImpl.disposeTrack ->
        // ScreenCaptureController.dispose(), which aborts the foreground service
        // AND calls mediaProjection.stop() — fully tearing the projection down so
        // the user is not asked to stop after we already stopped.
        try {
            if (share.screenStream) {
                share.screenStream.getTracks().forEach(t => {
                    try { t.stop(); } catch (e) { /* noop */ }
                    try { if (typeof t.release === 'function') t.release(); } catch (e) { /* noop */ }
                });
            }
        } catch (e) { /* noop */ }
    }

    /** Make sure the camera is actually producing again once a share ends.
     *
     *  _teardownScreenShareResources puts the camera track back on the SENDER,
     *  but that is only half of it: the track itself can still be disabled
     *  (video was muted before the share started), or the sender can have been
     *  left detached by an earlier "Audio only" choice. This is the "if not
     *  already active" part of coming back from a share.
     *
     *  Returns false when there is no usable camera track yet, so callers can
     *  retry -- the local stream can land a beat after mount. */
    _ensureCameraActiveAfterShare() {
        const localStream = this.state.localStream
            || (this.props.call && this.props.call.getLocalStreams
                && this.props.call.getLocalStreams()[0])
            || null;
        const track = (localStream && localStream.getVideoTracks
            && localStream.getVideoTracks()[0]) || null;
        if (!track) return false;
        if (track.readyState === 'ended') {
            // The camera died during the share (OS reclaimed it, or local
            // media was refreshed). Nothing to re-attach in place; the user
            // can restart video from the picker.
            console.log('[screen-share] camera track ended during share — cannot restore in place');
            return false;
        }
        if (!track.enabled) track.enabled = true;
        this._ensureSenderHasTrack(track);
        if (this.state.videoMuted) this.setState({videoMuted: false});
        return true;
    }

    /** Read the outbound video sender's framesSent, or null when stats are
     *  unavailable. Same shape as the reader inside _verifyScreenFramesFlowing;
     *  kept separate because that one is scoped to a specific share. */
    async _readOutboundFramesSent() {
        try {
            const pc = this.props.call && this.props.call._pc;
            if (!pc || typeof pc.getStats !== 'function') return null;
            const report = await pc.getStats();
            if (!report || typeof report.forEach !== 'function') return null;
            let sent = null;
            report.forEach(s => {
                if (s && s.type === 'outbound-rtp'
                    && (s.kind === 'video' || s.mediaType === 'video')
                    && typeof s.framesSent === 'number') {
                    sent = s.framesSent;
                }
            });
            return sent;
        } catch (e) {
            return null;
        }
    }

    /** Confirm the camera is REALLY producing again after a share, and repair
     *  it if not.
     *
     *  Why this is needed at all: see the note in the localStreamUrl getter.
     *  The self-view deliberately keeps rendering the camera during a share so
     *  the camera track keeps a sink and its capturer stays running — but
     *  starting a share navigates to the chat, which UNMOUNTS VideoBox and
     *  takes that last sink with it. The capturer then goes idle (and if the
     *  user leaves the app entirely, Android reclaims the camera from the
     *  backgrounded process outright). Either way the track object still looks
     *  perfectly healthy afterwards — readyState 'live', enabled true, attached
     *  to the sender — while producing no frames at all: black self-view,
     *  framesSent frozen, and the peer's PLI never answered.
     *
     *  So don't trust the track's own reported state: measure. Only repair
     *  when framesSent is genuinely not advancing, which keeps this inert on
     *  the paths that already work (stopping from the in-app button while the
     *  call screen stayed mounted). */
    async _verifyCameraAfterShare() {
        if (this._isMounted === false) return;
        const before = await this._readOutboundFramesSent();
        setTimeout(async () => {
            if (this._isMounted === false) return;
            // A new share started in the meantime — the sender is carrying the
            // screen again and framesSent says nothing about the camera.
            if (this.state.screenSharing) return;
            if (this.state.videoMuted) return;   // user chose to stop video
            const after = await this._readOutboundFramesSent();
            if (before != null && after != null && after > before) {
                console.log('[screen-share] camera frames flowing after share'
                    + ' (framesSent ' + before + ' -> ' + after + ')');
                return;
            }
            console.log('[screen-share] camera NOT producing after share'
                + ' (framesSent ' + before + ' -> ' + after + ') — restarting capture');
            this._restartCameraCapture();
        }, 1500);
    }

    /** Restart the camera capture after it went idle behind a screen share.
     *  Two escalating steps, cheapest first. */
    async _restartCameraCapture() {
        if (this._cameraRestartInFlight) return;
        this._cameraRestartInFlight = true;
        try {
            const call = this.props.call;
            const facing = (this.state.cameraFacing === 'back') ? 'back' : 'front';
            const stream = this.state.localStream
                || (call && call.getLocalStreams && call.getLocalStreams()[0])
                || null;
            const track = (stream && stream.getVideoTracks
                && stream.getVideoTracks()[0]) || null;

            // Step 1 — bounce the capture session in place with two
            // _switchCamera() calls. This restarts the Camera2 session (the
            // same primitive selectCamera / toggleCamera already rely on) and
            // lands back on the camera we started from. Preferred because the
            // track and stream identities survive: the sender stays wired and
            // the self-view renderer stays attached, so nothing else has to be
            // rebuilt. Skipped when the track is already ended — switchCamera
            // cannot revive that.
            if (track && track.readyState !== 'ended'
                    && typeof track._switchCamera === 'function') {
                console.log('[screen-share] camera restart: bouncing capture session');
                try {
                    track._switchCamera();
                    await new Promise(r => setTimeout(r, 400));
                    track._switchCamera();
                } catch (e) {
                    console.log('[screen-share] switch-camera bounce threw:',
                        (e && e.message) || String(e));
                }
                await new Promise(r => setTimeout(r, 900));
                const a = await this._readOutboundFramesSent();
                await new Promise(r => setTimeout(r, 900));
                const b = await this._readOutboundFramesSent();
                if (a != null && b != null && b > a) {
                    console.log('[screen-share] camera recovered by capture-session bounce'
                        + ' (framesSent ' + a + ' -> ' + b + ')');
                    return;
                }
                console.log('[screen-share] bounce did not revive the camera'
                    + ' (framesSent ' + a + ' -> ' + b + ') — re-acquiring');
            }

            // Step 2 — the old capturer is unrecoverable (OS reclaimed the
            // camera while we were backgrounded, or the track ended). Acquire a
            // fresh one and swap it into BOTH the sender (so the peer sees us)
            // and the local stream (so the self-view stops being black).
            let fresh = null;
            try {
                fresh = await mediaDevices.getUserMedia({
                    audio: false,
                    video: {facingMode: (facing === 'back') ? 'environment' : 'user'},
                });
            } catch (e) {
                console.log('[screen-share] camera re-acquire failed:',
                    (e && e.message) || String(e));
                return;
            }
            const newTrack = (fresh && fresh.getVideoTracks
                && fresh.getVideoTracks()[0]) || null;
            if (!newTrack) {
                console.log('[screen-share] camera re-acquire returned no video track');
                try { fresh.getTracks().forEach(t => t.stop()); } catch (e) { /* noop */ }
                return;
            }

            const sender = this._getVideoSender();
            if (sender && typeof sender.replaceTrack === 'function') {
                try {
                    await sender.replaceTrack(newTrack);
                } catch (e) {
                    console.log('[screen-share] replaceTrack(fresh camera) failed:',
                        (e && e.message) || String(e));
                }
            }

            // Swap inside the EXISTING stream object rather than replacing the
            // stream: call.getLocalStreams()[0] and props.localMedia are held
            // in several places (app.js, Call.js) and handing out a new stream
            // would desynchronise them.
            if (stream) {
                this._detachLocalVideoTrackListeners();
                if (track) {
                    try { stream.removeTrack(track); } catch (e) { /* noop */ }
                    try { track.stop(); } catch (e) { /* noop */ }
                    try { if (typeof track.release === 'function') track.release(); } catch (e) { /* noop */ }
                }
                try { stream.addTrack(newTrack); } catch (e) { /* noop */ }
                this._attachLocalVideoTrackListeners(stream);
            }

            // Outlive this component instance — see the localViewStream note
            // in the constructor for why a remount has to be able to find it.
            if (call) call._sylkLocalViewStream = fresh;

            // ...but NOT outlive the call. This stream came from our own
            // getUserMedia, so it is not part of app.js's state.localMedia and
            // closeLocalMedia() at hangup never touches it. Left alone it keeps
            // the camera device open after the call ends, and the NEXT call's
            // getUserMedia comes up with no usable video -- "video does not get
            // out of Android any more" on the second call.
            //
            // Release it when the call terminates, decoupled from this
            // component's lifecycle (VideoBox is long gone by then) -- the same
            // pattern selectScreenShare uses to tear the projection down.
            if (call && typeof call.on === 'function' && !call._sylkLocalViewStreamHandler) {
                const freeLocalViewStream = (oldState, newState) => {
                    if (newState !== 'terminated' && newState !== 'closed'
                            && newState !== 'failed') {
                        return;
                    }
                    try {
                        if (call.removeListener) {
                            call.removeListener('stateChanged', freeLocalViewStream);
                        }
                    } catch (e) { /* noop */ }
                    call._sylkLocalViewStreamHandler = null;
                    const dead = call._sylkLocalViewStream;
                    call._sylkLocalViewStream = null;
                    if (!dead) return;
                    try {
                        dead.getTracks().forEach(t => {
                            try { t.stop(); } catch (e) { /* noop */ }
                            // stop() only marks the track ended in
                            // react-native-webrtc; release() is what disposes the
                            // native capturer and actually frees the camera.
                            try { if (typeof t.release === 'function') t.release(); } catch (e) { /* noop */ }
                        });
                    } catch (e) { /* noop */ }
                    console.log('[screen-share] released re-acquired camera stream on call end');
                };
                call._sylkLocalViewStreamHandler = freeLocalViewStream;
                try { call.on('stateChanged', freeLocalViewStream); } catch (e) { /* noop */ }
            }

            if (this._isMounted !== false) {
                // Render the self-view from the stream getUserMedia handed us,
                // not the shared one — the native renderer binds to the track
                // the native stream registry knows about, which a JS-side track
                // swap does not update. localViewEpoch additionally remounts the
                // RTCView, since stream.toURL() is stable across the swap and
                // React would otherwise see no prop change at all.
                this.setState(st => ({
                    localViewStream: fresh,
                    localViewEpoch: (st.localViewEpoch || 0) + 1,
                    videoMuted: false,
                    cameraFacing: facing,
                    mirror: (facing !== 'back'),
                }));
            }
            // A fresh track means a fresh capture size, and CallZrtp's
            // one-shot _applyVideoBitrate will not re-run on its own — the
            // sender would keep whatever tuning the previous camera got. Same
            // call Call.js makes after any mid-call media change.
            try { if (call) reapplyVideoEncoderParams(call); } catch (e) {
                console.log('[screen-share] reapplyVideoEncoderParams threw:',
                    (e && e.message) || String(e));
            }
            console.log('[screen-share] camera re-acquired and swapped in (facing=' + facing + ')');
        } finally {
            this._cameraRestartInFlight = false;
        }
    }

    /** Bring a freshly-remounted VideoBox back in line with the camera that
     *  was in use before the share.
     *
     *  Deliberately NO _switchCamera() / selectCamera() here. The camera track
     *  kept running throughout the share -- selectScreenShare only swaps what
     *  the SENDER carries, it never stops the camera -- so the hardware is
     *  still pointed at `facing`. Calling selectCamera(facing) would flip it to
     *  the OTHER camera. The only thing out of date is this instance's state,
     *  which a remount reset to the constructor's front-camera default. */
    _restoreCameraAfterShare(facing, attempt) {
        const want = (facing === 'back') ? 'back' : 'front';
        if (!this._ensureCameraActiveAfterShare()) {
            const n = attempt || 0;
            if (n < 5) {
                setTimeout(() => {
                    if (this._isMounted === false) return;
                    this._restoreCameraAfterShare(want, n + 1);
                }, 300);
                return;
            }
            console.log('[screen-share] no local video track to restore after share');
        }
        const update = {};
        if (this.state.cameraFacing !== want) update.cameraFacing = want;
        // Mirror follows the facing (front is mirrored, back is not) — same
        // pairing selectCamera / toggleCamera maintain when switching.
        const wantMirror = (want !== 'back');
        if (this.state.mirror !== wantMirror) update.mirror = wantMirror;
        if (this.state.screenSharing) update.screenSharing = false;
        if (Object.keys(update).length > 0) this.setState(update);
        console.log('[screen-share] camera restored after share: facing=' + want);
        // Re-attaching the track to the sender is not proof it is producing —
        // verify and repair if it is not. See _verifyCameraAfterShare.
        this._verifyCameraAfterShare();
    }

    /** User-initiated stop (Stop Sharing row, tap Share Screen while active, or
     *  system cast-stop while the call screen is showing). Tears down the media
     *  and returns the picker to camera mode. Safe to call when not sharing. */
    _stopScreenShare() {
        const call = this.props.call;
        if (!this.state.screenSharing && !(call && call._sylkScreenShare)) return;

        // iOS: end the broadcast through the SYSTEM (toggle the broadcast picker
        // button) rather than by closing our socket. Closing the socket makes the
        // extension call finishBroadcastWithError(), which ALWAYS pops a "Screen
        // sharing stopped" alert — redundant when the user explicitly stopped.
        // Toggling the picker stops it via broadcastFinished() (clean, no alert);
        // the screen track's 'ended' event (onEnded) then drives teardown. The
        // _iosBroadcastEnded guard prevents onEnded's re-entry from re-toggling
        // (which would restart a broadcast) and avoids toggling an already-
        // finished broadcast on the Control-Center-stop path.
        if (Platform.OS === 'ios' && !this._iosBroadcastEnded) {
            try {
                const _tag = this._iosBroadcastPicker ? findNodeHandle(this._iosBroadcastPicker) : null;
                const _mgr = NativeModules.ScreenCapturePickerViewManager;
                if (_tag != null && _mgr && typeof _mgr.show === 'function') {
                    console.log('[screen-share] iOS: stopping broadcast via system picker (no alert)');
                    _mgr.show(_tag);
                    // Fallback: if the broadcast doesn't actually end (onEnded
                    // never fires), force a manual teardown so we don't get stuck
                    // "sharing". That fallback path DOES show the alert, but only
                    // when the clean stop failed.
                    clearTimeout(this._iosStopFallbackTimer);
                    this._iosStopFallbackTimer = setTimeout(() => {
                        if (this._isMounted !== false && this.state.screenSharing && !this._iosBroadcastEnded) {
                            console.log('[screen-share] iOS system stop did not end broadcast in time — forcing teardown');
                            this._iosBroadcastEnded = true;
                            this._stopScreenShare();
                        }
                    }, 3000);
                    return;
                }
            } catch (e) {
                console.log('[screen-share] iOS system-stop failed, manual teardown:', (e && e.message) || String(e));
            }
        }
        clearTimeout(this._iosStopFallbackTimer);

        const facingBefore = (call && call._sylkScreenShare && call._sylkScreenShare.facingBefore)
            || this._facingBeforeScreenShare;
        this._teardownScreenShareResources(call, true);

        const restoredFacing = (facingBefore === 'back') ? 'back' : 'front';
        this._facingBeforeScreenShare = null;
        if (this._isMounted !== false) {
            this.setState({ screenSharing: false, cameraFacing: restoredFacing });
            // The teardown above re-attached the camera track to the sender;
            // this makes sure the track is actually enabled and the sender
            // really is wired up, so stopping a share always ends with live
            // video rather than a black frame. No camera SWITCH is needed on
            // this path — the hardware never left `restoredFacing`.
            this._ensureCameraActiveAfterShare();
            // The capturer can still be idle even here (the user may have left
            // the app during the share and come back to the call screen before
            // stopping), so verify and repair on this path too.
            this._verifyCameraAfterShare();
        }

        // The share session hid the system bars (insets collapsed to 0). Ask
        // Android to re-show them and RE-DISPATCH window insets so the safe-area
        // padding is recomputed — otherwise the app overlaps the phone's top
        // status bar and bottom navigation bar and those become unreachable.
        // Deferred so it runs after the returning layout has settled (and, on
        // the system-pill path, after bringAppToForeground raises the app).
        if (Platform.OS === 'android' && NativeModules.SylkBridge
                && typeof NativeModules.SylkBridge.refreshSystemInsets === 'function') {
            setTimeout(() => {
                try { NativeModules.SylkBridge.refreshSystemInsets(); } catch (e) { /* noop */ }
            }, 350);
        }
        // Ready for the next share.
        this._iosBroadcastEnded = false;
    }

    togglePointerMode() {
        this.setState({ pointerMode: !this.state.pointerMode });
    }

    /** Tell the peer we started/stopped sharing our screen. Doubles as a
     *  capability advertisement: only clients that implement the pointer
     *  protocol send this, so a peer that receives 'start' knows it may show
     *  its pointer button and that WE can render the marker they send back. */
    _sendScreenSharingSignal(action) {
        const call = this.props.call;
        if (!call || typeof call.sendMessage !== 'function') return;
        // Once the call is terminated the sylkrtc session is gone and sendMessage
        // rejects with "Unknown session". There is nothing useful to tell a peer
        // whose call UI is tearing down anyway, so skip it rather than emit a
        // failure that reads like a bug in the logs. hangupCall() signals 'stop'
        // before the BYE precisely so this path has nothing left to do.
        const state = call.state;
        if (state === 'terminated' || state === 'closed' || state === 'failed') {
            console.log('[screen-share] skipping ' + action + ' signal — call already ' + state);
            return;
        }
        try {
            call.sendMessage(JSON.stringify({ action }), 'application/sylk-screen-sharing', {}, (err) => {
                if (err) console.log('[screen-share] signal ' + action + ' failed:', (err && err.message) || String(err));
            });
            console.log('[screen-share] signalled peer: ' + action);
        } catch (e) {
            console.log('[screen-share] signal threw:', (e && e.message) || String(e));
        }
    }


    // ---------------------------------------------------------------
    // Screen-share REQUEST (kebab -> "Request screen")
    //
    // Asks the peer to share THEIR screen; the mirror image of
    // selectScreenShare, which shares ours. The handshake rides the
    // existing in-call application/sylk-screen-sharing channel with
    // three new actions -- request / request_accept / request_reject --
    // rather than chat metadata, because it is meaningless outside this
    // call (nothing to journal or replay) and because peers on older
    // builds parse only 'start'/'stop' on that content type and return,
    // so they ignore it silently instead of rendering a junk bubble.
    //
    // The peer's app.js pops ScreenShareRequestModal; on Accept it
    // replies request_accept and starts its own share, which reaches us
    // as an ordinary 'start' signal a moment later (after their OS
    // capture-consent dialog). On Reject we get request_reject and drop
    // the pending state at once.

    _handlePeerCapabilities(event) {
        const myId = this.props.call && (this.props.call.id || this.props.call._callId);
        if (!event || !myId || event.callId !== myId) return;
        if (!Array.isArray(event.capabilities)) return;
        this.setState({peerCapabilities: event.capabilities});
    }

    /** Can we offer to ask this peer for their screen? Only when they
     *  explicitly advertised that they can produce one. Absence of an
     *  advertisement means an older build, and offering the item there
     *  would send a request nothing will ever answer. */
    _peerCanShareScreen() {
        const caps = this.state.peerCapabilities;
        return Array.isArray(caps) && caps.indexOf(CAP_SCREEN_SHARING) !== -1;
    }

    /** Human label for the peer, for the outcome banner. Same
     *  precedence the escalate-to-conference dialog uses. */
    _peerLabel() {
        const contact = this.state.callContact;
        if (contact && contact.name) return contact.name;
        if (this.state.remoteDisplayName) return this.state.remoteDisplayName;
        if (this.state.remoteUri) return this.state.remoteUri.split('@')[0];
        return 'Your contact';
    }

    /** Transient banner over the video. VideoBox has no notification
     *  centre of its own (postSystemNotification isn't threaded down
     *  here), and a reject that produced no feedback at all would read
     *  as a broken button. */
    _showScreenRequestNotice(text) {
        if (this._screenRequestNoticeTimer) {
            clearTimeout(this._screenRequestNoticeTimer);
            this._screenRequestNoticeTimer = null;
        }
        this.setState({screenRequestNotice: text});
        this._screenRequestNoticeTimer = setTimeout(() => {
            this._screenRequestNoticeTimer = null;
            if (this._isMounted === false) return;
            this.setState({screenRequestNotice: null});
        }, 5000);
    }

    sendScreenShareRequest() {
        const call = this.props.call;
        if (!call || typeof call.sendMessage !== 'function') {
            console.log('[screen-request] no active call, cannot send');
            return;
        }
        if (this.state.screenRequestPending) {
            console.log('[screen-request] a request is already in flight, ignoring');
            return;
        }
        const requestId = uuid.v4();
        const expiresAtIso = new Date(Date.now() + 60 * 1000).toISOString();
        try {
            call.sendMessage(
                JSON.stringify({action: 'request', id: requestId, expires: expiresAtIso}),
                'application/sylk-screen-sharing', {}, (err) => {
                    if (err) {
                        console.log('[screen-request] send failed:',
                            (err && err.message) || String(err));
                    }
                });
        } catch (e) {
            console.log('[screen-request] send threw:', (e && e.message) || String(e));
            return;
        }
        console.log('[screen-request] sent -> peer, reqId=', requestId);
        this.setState({
            screenRequestPending: true,
            screenRequestPendingId: requestId,
        });
        // Self-clear at the same 60 s deadline we put on the wire, so a
        // peer that never answers (old build, backgrounded, modal timed
        // out) doesn't leave the menu item stuck on "Requesting...".
        if (this._screenRequestExpiryTimer) {
            clearTimeout(this._screenRequestExpiryTimer);
        }
        this._screenRequestExpiryTimer = setTimeout(() => {
            this._screenRequestExpiryTimer = null;
            if (this.state.screenRequestPendingId !== requestId) return;
            this.setState({
                screenRequestPending: false,
                screenRequestPendingId: null,
            });
            this._showScreenRequestNotice(
                this._peerLabel() + ' did not respond to the screen request');
        }, 60 * 1000);
    }

    _handleScreenShareRequestResolved(event) {
        const myId = this.props.call && (this.props.call.id || this.props.call._callId);
        if (!event || !myId || event.callId !== myId) return;
        if (this.state.screenRequestPendingId !== event.requestId) return;
        if (this._screenRequestExpiryTimer) {
            clearTimeout(this._screenRequestExpiryTimer);
            this._screenRequestExpiryTimer = null;
        }
        this.setState({
            screenRequestPending: false,
            screenRequestPendingId: null,
        });
        this._showScreenRequestNotice(event.accepted
            ? this._peerLabel() + ' accepted \u2014 waiting for their screen\u2026'
            : this._peerLabel() + ' declined to share their screen');
    }

    /** The local user accepted an incoming request (modal owned by
     *  app.js). Run the ordinary share path -- the OS consent dialog
     *  still applies. */
    _handleScreenShareRequested(event) {
        const call = this.props.call;
        const myId = call && (call.id || call._callId);
        if (!event || !myId || event.callId !== myId) return;
        // Consume the unmounted-fallback stamp so a later remount can't
        // kick off a second share for the same request.
        if (call._sylkPendingScreenShareStart === event.requestId) {
            call._sylkPendingScreenShareStart = null;
        }
        if (this.state.screenSharing || call._sylkScreenShare) {
            console.log('[screen-request] accepted but already sharing -- nothing to do');
            return;
        }
        console.log('[screen-request] accepted locally -- starting screen share');
        this.selectScreenShare();
    }

    /** Map a tap on the remote-video view (view pixels) to a normalized point
     *  on the peer's shared screen and send it (application/sylk-pointer). While
     *  pointerMode is on the remote view is 'contain', so account for the
     *  letterbox and ignore taps in the bars. */
    /** Echo a just-ACKed click locally: a green dot at the tap position, in the
     *  same (locationX/Y) coordinate space as the remote-video tap target.
     *  Auto-clears after ~900ms. */
    _showLocalAck(locX, locY) {
        const id = Date.now();
        this._ackEchoId = id;
        this.setState({ ackEcho: { x: locX, y: locY, id } });
        if (this._ackEchoTimer) clearTimeout(this._ackEchoTimer);
        this._ackEchoTimer = setTimeout(() => {
            if (this._ackEchoId === id && this._isMounted !== false) {
                this.setState({ ackEcho: null });
            }
        }, 900);
    }

    _sendPointer(locX, locY) {
        const call = this.props.call;
        if (!call || typeof call.sendMessage !== 'function') return;
        // Sharer's app is backgrounded (iOS) — the marker can't render there.
        if (this.state.remoteInApp === false) return;
        const layout = this.state.remoteVideoLayout;
        if (!layout || !layout.w || !layout.h) return;
        const size = this.state.remoteVideoSize;
        let nx, ny;
        if (size && size.w && size.h) {
            const scale = Math.min(layout.w / size.w, layout.h / size.h);
            const dispW = size.w * scale;
            const dispH = size.h * scale;
            const offX = (layout.w - dispW) / 2;
            const offY = (layout.h - dispH) / 2;
            nx = (locX - offX) / dispW;
            ny = (locY - offY) / dispH;
        } else {
            nx = locX / layout.w;
            ny = locY / layout.h;
        }
        if (!(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) return;
        const t = Date.now();
        // Remember where we clicked, keyed by t, so we can echo it locally when
        // the peer ACKs that it rendered this click. Prune stale (>5s) entries.
        this._pendingPointers = this._pendingPointers || {};
        this._pendingPointers[t] = { locX, locY };
        Object.keys(this._pendingPointers).forEach((k) => {
            if (Number(k) < t - 5000) delete this._pendingPointers[k];
        });
        const payload = JSON.stringify({
            x: Math.round(nx * 1000) / 1000,
            y: Math.round(ny * 1000) / 1000,
            t
        });
        try {
            call.sendMessage(payload, 'application/sylk-pointer', {}, (err) => {
                if (err) console.log('[pointer] send failed:', (err && err.message) || String(err));
            });
            console.log('[pointer] tap loc=(' + Math.round(locX) + ',' + Math.round(locY) + ') -> norm=' + payload);
        } catch (e) {
            console.log('[pointer] sendMessage threw:', (e && e.message) || String(e));
        }
    }

    renderVideoPicker(buttonSize, buttonClass) {
        // Hide the camera-selection control while the peer is sharing (viewer:
        // our camera choices are noise while watching their screen) AND while WE
        // are sharing (sharer: the navbar Stop-share button is the only control
        // needed to end the share and return to the video call).
        if (this.state.remotePeerSharing || this.state.screenSharing) return null;
        const facing = this.state.cameraFacing || 'front';
        const muted = this.state.videoMuted;
        const enableMyVideo = this.state.enableMyVideo;
        // Main button reflects the currently active camera. Muted state is
        // shown as a big red X overlay on top of the camera icon so the user
        // knows both *which* camera is active *and* that it's muted.
        // Main camera button in the call action bar: always the
        // same classic `video` (camcorder) glyph, regardless of
        // whether the front or back camera is currently selected.
        // The previous code swapped between `camera-front` /
        // `camera-rear` which made the button shift glyphs each
        // time the user switched cameras — visually unstable and
        // didn't actually communicate anything useful (the user
        // already knows which camera they're on). Per-option icons
        // inside the picker dropdown stay distinct (camera-front /
        // camera-rear), so the front/back distinction is still
        // shown when it matters — at the moment of choice.
        const mainIcon = this.state.screenSharing ? 'monitor-share' : 'video';

        // Swap-video row icon: same `camera-switch` glyph the
        // CallOverlay navbar quick-access swap button and the kebab's
        // "Swap video" row use, so all three surfaces read as the same
        // action. (Previously a corner-aware diagonal double-headed
        // arrow — arrow-top-left-bottom-right-bold /
        // arrow-top-right-bottom-left-bold depending on which corner
        // the PIP thumbnail sat in.)
        const swapIcon = 'camera-switch';

        // Build the camera options. When the camera is currently in
        // use (not muted), drop the active one so the user only sees
        // the camera they can switch *to*. When muted, show BOTH so
        // the user can pick which camera to unmute into — tapping
        // either unmutes (and switches if needed) via selectCamera.
        const screenActive = this.state.screenSharing;
        const cameraOptions = [
            {
                key: 'front',
                icon: 'camera-front',
                label: 'Front Camera',
                facing: 'front'
            },
            {
                key: 'back',
                icon: 'camera-rear',
                label: 'Back Camera',
                facing: 'back'
            }
        ]
            .filter(opt => {
                if (opt.facing === 'screen') return !screenActive;
                return muted || opt.facing !== facing;
            })
            .map(opt => ({
                key: opt.key,
                icon: opt.icon,
                label: opt.label,
                onPress: opt.facing === 'screen'
                    ? () => this.selectScreenShare()
                    : () => this.selectCamera(opt.facing)
            }));

        // Share Screen row — placed LAST in the menu (per request). Hidden
        // while already sharing (the Stop Sharing row covers that case).
        const screenRow = screenActive ? null : {
            key: 'screen',
            icon: 'monitor-share',
            label: 'Share Screen',
            onPress: () => this.selectScreenShare()
        };

        // The picker rows are *actions*, not radio choices — there is
        // no persistent "selected" highlight. The icon/label of each
        // row already reflects the next state (e.g. "Hide Myself" vs
        // "Show Myself", "Mute Camera" hidden when muted), which is
        // enough to communicate current state.
        // When the camera is currently muted (i.e. video hasn't been
        // started yet for this call, or the user paused it), collapse
        // the picker down to JUST the two camera options. Tapping
        // either implicitly starts video via selectCamera →
        // toggleVideoMute → _ensureSenderHasTrack, so a separate
        // "Start video" row would be redundant. The mirror toggle,
        // swap-video and aspect-ratio rows also don't make sense when
        // there is no active local video yet — hide them too.
        const items = muted ? [
            ...cameraOptions,
            ...(screenRow ? [screenRow] : []),
        ] : screenActive ? [
            // While sharing, the picker is deliberately minimal: the two
            // camera rows (tapping either stops the share and returns to that
            // camera), an explicit Stop Sharing row, and aspect ratio. Mute /
            // mirror / swap don't have well-defined meanings mid-share.
            ...cameraOptions,
            {
                key: 'stopshare',
                icon: 'monitor-off',
                label: 'Stop Sharing',
                onPress: () => this._stopScreenShare()
            },
            {
                key: 'aspect',
                icon: 'aspect-ratio',
                label: 'Aspect Ratio',
                onPress: () => this.toggleAspectRatio()
            }
        ] : [
            ...cameraOptions,
            {
                key: 'mute',
                icon: 'video-off',
                // Renamed from "Mute Camera" → "Stop video" to
                // match the verbiage of other Sylk surfaces.
                label: 'Stop video',
                onPress: () => this.toggleVideoMute()
            },
            {
                key: 'myself',
                icon: enableMyVideo ? 'eye-off' : 'eye',
                // Renamed from "Hide Myself / Show Myself" →
                // "Hide mirror / Show mirror" to match the
                // wording the ConferenceHeader / CallOverlay
                // kebab items + the ConferenceBox camera picker
                // already use for the same action. Same toggle
                // (toggleMyVideo), same eye-off / eye glyph swap;
                // only the label text aligned across surfaces.
                label: enableMyVideo ? 'Hide mirror' : 'Show mirror',
                onPress: () => this.toggleMyVideo()
            },
            {
                key: 'swap',
                // camera-switch — matches the CallOverlay navbar swap
                // button and kebab row (see swapIcon above).
                icon: swapIcon,
                label: 'Swap Video',
                onPress: () => this.swapVideo()
            },
            {
                key: 'aspect',
                icon: 'aspect-ratio',
                label: 'Aspect Ratio',
                onPress: () => this.toggleAspectRatio()
            },
            ...(screenRow ? [screenRow] : []),
        ];

        // Size the floating-panel icons up to roughly the *visual* size
        // of the bar button (the circular IconButton, which is bigger
        // than its glyph). Bumps both the icon glyph and the row height
        // so the menu reads as comfortably touch-sized.
        const rowIconSize = buttonSize + 14;
        const rowFontSize = 18;
        const itemRowHeight = rowIconSize + 18;
        // The trigger IconButton has margin: 10 (from styles.iosButton /
        // androidButton). To keep the icon column vertically aligned
        // with the bar button, shift the row left so its icon center
        // sits directly above the bar-button center, regardless of the
        // larger row icon size.
        const iconColumnPadLeft = Math.max(10 - (rowIconSize - buttonSize) / 2, 0);
        // Estimate the panel width: longest label is "Front Camera" /
        // "Aspect Ratio" (~12 characters). At rowFontSize the text needs
        // roughly 0.6 * fontSize per character. Plus the icon column,
        // gap and right padding. The slot containing the panel has
        // maxWidth: 54 which would otherwise force the labels to wrap,
        // so we set an explicit width that's wide enough for the longest
        // label plus a small margin.
        const longestLabelChars = 13;
        const panelWidth = iconColumnPadLeft
            + rowIconSize
            + 14   // marginLeft on the text
            + Math.ceil(longestLabelChars * rowFontSize * 0.6)
            + 12;  // paddingRight on the row
        return (
            <View style={[styles.buttonContainer, {position: 'relative'}]}>
                {this.state.videoPickerVisible && (
                    <View style={{
                        position: 'absolute',
                        bottom: '100%',
                        // Anchor the left edge of the panel to the left
                        // edge of the trigger button so the icon column
                        // sits directly above the button below and the
                        // text labels extend to the right of the icons.
                        left: 0,
                        // Explicit width that fits the longest label on
                        // a single line. We can't rely on shrink-to-fit
                        // because the slot wrapping the panel has
                        // maxWidth: 54 which would otherwise force the
                        // label to wrap.
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
                                onPress={() => {
                                    this.setState({videoPickerVisible: false});
                                    // Defer the action a tick so the panel
                                    // closes cleanly before any state churn
                                    // from the action itself.
                                    setTimeout(() => item.onPress(), 50);
                                }}
                                // Standard row: icon on the left (above
                                // the trigger button), text label to its
                                // right. Every row is an *action* (not a
                                // radio choice), so we never highlight
                                // a row as "selected".
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    height: itemRowHeight,
                                    paddingLeft: iconColumnPadLeft,
                                    paddingRight: 12,
                                    backgroundColor: 'transparent'
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
                <View style={{position: 'relative'}}>
                    <IconButton
                        // Force a remount whenever the picker opens/closes.
                        // react-native-paper's IconButton on Android can drop
                        // its glyph (render blank) after it's used to toggle an
                        // overlay that changes the surrounding stacking context
                        // — the bar button then looks like it "disappeared"
                        // after you dismiss the camera menu. Keying on the
                        // open/closed state (plus the glyph itself) guarantees a
                        // fresh paint on every transition. Cheap: it's one button.
                        key={'vpick-' + mainIcon + '-' + (this.state.videoPickerVisible ? 'open' : 'closed')}
                        size={buttonSize}
                        style={[buttonClass]}
                        icon={mainIcon}
                        onPress={() => this.setState({
                            videoPickerVisible: !this.state.videoPickerVisible,
                            // Collapse the audio device picker when opening
                            // (or toggling) the video picker — only one
                            // floating menu should be visible at a time.
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
                                drew a heavier stroke that competed
                                with the underlying camera icon. */}
                            <Icon
                                name="close"
                                size={buttonSize + 14}
                                color="#D32F2F"
                            />
                        </View>
                    )}
                </View>
            </View>
        );
    }

    get showRemote() {
		return this.state.remoteVideoShow && !this.state.reconnectingCall;
	}

	// Called every getStatsInterval ms (5s after task #34) with rich
	// stats from sylkrtc. Build a compact one-liner for CallOverlay.info.
	//
	// Format (variable parts conditional):
	//   ⇡ 720k ⇣ 1.4M  640×360@24  rtt 120ms ±15  vloss 2%
	//
	// Smoothing: keep the last 3 samples (~15s with 5s polling) and
	// average. With 5s polling the prior 2-second window left only
	// one sample, so smoothing was a no-op.
	statistics(stats) {
	  const { audio, video, remote, connection } = stats.data;
	  const audioInbound  = audio?.inbound?.[0];
	  const audioOutbound = audio?.outbound?.[0];
	  const videoInbound  = video?.inbound?.[0];
	  const videoOutbound = video?.outbound?.[0];

	  if (!videoOutbound && !audioOutbound && !videoInbound && !audioInbound) return;

	  if (!this.prevStats) this.prevStats = {};
	  const now = Date.now();

	  // Per-track bitrate from delta(bytes) / delta(timestamp).
	  const calcBitrate = (type, currentBytes, currentTimestamp) => {
		const prev = this.prevStats[type];
		if (!prev) {
		  this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
		  return 0;
		}
		const bytesDelta = currentBytes - prev.bytes;
		const timeDelta  = (currentTimestamp - prev.ts) / 1000;
		this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
		if (timeDelta <= 0 || bytesDelta < 0) return 0;
		return (bytesDelta * 8) / timeDelta; // bits / second
	  };

	  let bandwidthUpload = 0, bandwidthDownload = 0;

	  if (videoOutbound) bandwidthUpload += calcBitrate('videoUpload', videoOutbound.bytesSent, videoOutbound.timestamp);
	  if (videoInbound) {
		if (videoInbound.bytesReceived > 0) {
		  bandwidthDownload += calcBitrate('videoDownload', videoInbound.bytesReceived, videoInbound.timestamp);
		} else if (videoInbound.packetRate > 0) {
		  bandwidthDownload += videoInbound.packetRate * 1200 * 8;
		}
	  }
	  if (audioOutbound) bandwidthUpload += calcBitrate('audioUpload', audioOutbound.bytesSent, audioOutbound.timestamp);
	  if (audioInbound) {
		if (audioInbound.bytesReceived > 0) {
		  bandwidthDownload += calcBitrate('audioDownload', audioInbound.bytesReceived, audioInbound.timestamp);
		} else if (audioInbound.packetRate > 0) {
		  bandwidthDownload += audioInbound.packetRate * 1200 * 8;
		}
	  }

	  // Smooth over the last ~15s (3 samples at 5s polling).
	  this.bandwidthHistory = this.bandwidthHistory || [];
	  this.bandwidthHistory.push({ ts: now, up: bandwidthUpload, down: bandwidthDownload });
	  this.bandwidthHistory = this.bandwidthHistory.filter(d => now - d.ts < 15000);
	  const N = this.bandwidthHistory.length || 1;
	  const smoothUpload   = this.bandwidthHistory.reduce((a, b) => a + b.up,   0) / N;
	  const smoothDownload = this.bandwidthHistory.reduce((a, b) => a + b.down, 0) / N;

	  // Network quality.
	  const rtt = connection?.currentRoundTripTime ? connection.currentRoundTripTime * 1000 : 0;
	  const jitter = videoInbound?.jitter
		? videoInbound.jitter * 1000
		: (audioInbound?.jitter ? audioInbound.jitter * 1000 : 0);

	  const lossPct = (rtp) => {
		if (!rtp) return 0;
		const recv = rtp.packetsReceived || 0;
		const lost = rtp.packetsLost || 0;
		const total = recv + lost;
		return total > 0 ? (lost / total) * 100 : 0;
	  };
	  const audioLoss = lossPct(audioInbound);
	  const videoLoss = lossPct(videoInbound);

	  // Video resolution and framerate from the receiver.
	  const w   = videoInbound?.frameWidth      || 0;
	  const h   = videoInbound?.frameHeight     || 0;
	  const fps = videoInbound?.framesPerSecond || 0;

	  const fmtBits = b => b > 1_000_000 ? (b / 1_000_000).toFixed(1) + 'M'
	                    :  b > 1_000     ? (b / 1_000).toFixed(0)     + 'k'
	                    :                  b.toFixed(0);

	  const parts = [];
	  parts.push(`⇡${fmtBits(smoothUpload)} ⇣${fmtBits(smoothDownload)}`);
	  if (w > 0 && h > 0) {
		parts.push(`${w}×${h}` + (fps > 0 ? `@${Math.round(fps)}` : ''));
	  }
	  if (rtt > 0) {
		parts.push(`${rtt.toFixed(0)}ms` + (jitter > 0 ? ` ±${jitter.toFixed(0)}` : ''));
	  }
	  if (videoLoss > 1) parts.push(`vloss ${videoLoss.toFixed(0)}%`);
	  if (audioLoss > 1) parts.push(`aloss ${audioLoss.toFixed(0)}%`);
	  const info = parts.join('  ');

	  this.setState(state => ({
		statistics: [...state.statistics, { up: smoothUpload, down: smoothDownload }].slice(-MAX_POINTS),
		info,
	  }));
	}

    hangupCall() {
        // Tell the peer the share is over BEFORE the session goes away. The
        // teardown that runs off the 'terminated' state change is too late: by
        // then sylkrtc has destroyed the session and call.sendMessage() fails
        // with "Unknown session", so the peer is never told (observed
        // 2026-08-16 12:30:32). Cheap, idempotent, and a no-op when not sharing.
        this._signalScreenShareStopIfSharing();
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall() {
        this._signalScreenShareStopIfSharing();
        this.props.hangupCall('user_cancel_call');
    }

    /** Send a screen-share 'stop' to the peer while the session is still alive,
     *  and mark it sent so the later teardown does not re-send it into a dead
     *  session. Safe to call when there is no share in progress. */
    _signalScreenShareStopIfSharing() {
        const call = this.props.call;
        const share = (call && call._sylkScreenShare) || null;
        if (!share || share.stopSignalled) return;
        this._sendScreenSharingSignal('stop');
        share.stopSignalled = true;
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    armOverlayTimer() {
        clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(() => {
            // Don't drop into fullscreen while the camera-enable modal
            // is up — that would hide the navbar (caller name + menu)
            // behind the modal before the user has answered with
            // video or audio. Re-arm so we try again later in case
            // the modal stays up briefly.
            if (this.state.videoEnableDialogVisible) {
                this.armOverlayTimer();
                return;
            }
            this.toggleFullScreen();
        }, 4000);
    }

    toggleEscalateConferenceModal() {
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }

        this.setState({
            callOverlayVisible          : false,
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    toggleMyVideo() {
        const newShowMirror = !this.state.enableMyVideo;
        this.setState({enableMyVideo: newShowMirror});
        this._persistVideoCallPrefs({show_mirror: newShowMirror});
    }

    swapVideo() {
        const turningOn = !this.state.swapVideo;
        if (turningOn) {
			this.setState({enableMyVideo: false});
        }
        this.setState({swapVideo: turningOn});
        // Turning swap ON also hides the self-view (above) — record
        // both so the restored layout matches what the user sees.
        this._persistVideoCallPrefs(turningOn
            ? {video_swapped: true, show_mirror: false}
            : {video_swapped: false});
    }
    
    get localStreamUrl() {
        // [video-preview] trace: log ONCE per change in url-vs-null so
        // we don't spam the bridge on every re-render but still see
        // each transition. The local RTCView reads this getter; if it
        // returns null forever, the tile stays blank.
        let _url;
        if (this.state.swapVideo) {
            _url = this.state.remoteStream ? this.state.remoteStream.toURL() : null;
        } else {
            // NOTE: even while screen sharing, the self-view keeps rendering the
            // CAMERA stream, not the screen. This is deliberate: it keeps a live
            // sink on the camera track so libwebrtc's capturer stays running the
            // whole time we're sharing. If we render the screen here instead, the
            // camera track has zero sinks (it's off the sender too) and the
            // capturer goes idle — so when the user stops sharing, replaceTrack-ing
            // the camera back yields a black frame until the capturer restarts.
            // localViewStream wins when set — see its note in the constructor.
            const _selfStream = this.state.localViewStream || this.state.localStream;
            _url = _selfStream ? _selfStream.toURL() : null;
        }
        if (this._lastLoggedLocalStreamUrlState !== !!_url) {
            this._lastLoggedLocalStreamUrlState = !!_url;
            console.log('[video-preview] localStreamUrl ->',
                _url ? ('set len=' + _url.length) : 'null',
                'swapVideo=' + !!this.state.swapVideo,
                'state.localStream=' + (this.state.localStream ? 'set' : 'null'),
                'state.remoteStream=' + (this.state.remoteStream ? 'set' : 'null'));
        }
        return _url;
    }

    get remoteStreamUrl() {
		if (this.state.swapVideo) {
			// Swapped: the LOCAL camera is what fills the main view, so it
			// needs the same localViewStream override the self-view uses.
			const _selfStream = this.state.localViewStream || this.state.localStream;
			return _selfStream ? _selfStream.toURL() : null;
        }
		return this.state.remoteStream ? this.state.remoteStream.toURL() : null
    }

	renderAudioDeviceButtons() {
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  if (!this.state.callOverlayVisible) {
		 return null;
	  }
	
	  let buttonsContainerClass;

        if (this.props.isTablet) {
            buttonsContainerClass = this.state.isLandscape ? styles.tabletLandscapebuttonsContainer : styles.tabletPortraitbuttonsContainer;
        } else {
            buttonsContainerClass = this.state.isLandscape ? styles.landscapebuttonsContainer : styles.portraitbuttonsContainer;
        }
	  
	  if (!call || call.state !== 'established') {
		 return null;
	  }
	 
	  if (this.props.useInCallManger) {
		 return null;
	  }

      if (!availableAudioDevices) return null;
	  
	  return (
	  <View style={buttonsContainerClass}>
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
		</View>
	  );
	}

    render() {

        if (this.state.call === null) {
            return null;
        }

        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

        let buttonsContainerClass;

        let buttons;
        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        const buttonSize = this.props.isTablet ? 40 : 28;

        if (this.props.isTablet) {
            buttonsContainerClass = this.state.isLandscape ? styles.tabletLandscapebuttonsContainer : styles.tabletPortraitbuttonsContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonsContainerClass = this.state.isLandscape ? styles.landscapebuttonsContainer : styles.portraitbuttonsContainer;
        }

        // Allow-by-default with disqualifying conditions setting true.
        // Previously initialised to `true` while every branch below
        // also only sets `true` — meaning the account-plus button
        // never rendered in any video call. Latent bug; the button
        // shape has been in the code for a while but was effectively
        // dead. Now: start false, let each disqualifier flip it to
        // true, and let the else branch below catch the "no
        // callContact" case explicitly.
        let disablePlus = false;
        if (this.state.callContact) {
            if (isPhoneNumber) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('test') > -1) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('conference') > -1) {
                disablePlus = true;
            }

            // conference_request handshake requires the peer's PGP
            // publicKey (the metadata payload is E2E-encrypted and
            // would silently fail without it). Same gating as
            // AudioCallBox.canEscalate. Without a key, hide the
            // account-plus button entirely so the user can't open
            // the confirmation dialog only to have the invite drop
            // on the floor.
            if (!this.state.callContact.publicKey) {
                disablePlus = true;
            }
        } else {
            // No callContact loaded → no key, no escalation. Hide
            // the button rather than showing it disabled / broken.
            disablePlus = true;
        }

        const show = this.state.callOverlayVisible || this.state.reconnectingCall;

        const myVideoCorner = this.state.myVideoCorner;

        let container = styles.container;
        let remoteVideoContainer = styles.remoteVideoContainer;
        let buttonsContainer = styles.buttonsContainer;
        let video = styles.video;

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonsContainerClass}>
                {(!disablePlus && !this.state.pointerMode && !this.state.remotePeerSharing) ?
                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        // Opens the new Portal+Dialog confirmation
                        // below, which fires sendConferenceRequest on
                        // user confirm (same handshake as AudioCallBox).
                        // The old inviteToConferenceFunc prop launched
                        // the broken EscalateConferenceModal text-input
                        // flow (Platform.OS reference without import →
                        // empty / black dialog on Android). That prop
                        // is still received from app.js for backward
                        // compat with any other call sites; this button
                        // no longer routes through it.
                        onPress={this.toggleConferenceRequestPanel}
                        disabled={this.state.conferenceRequestPending}
                        icon="account-plus"
                    />
                </View>
                : null}

                {(!this.state.pointerMode && !this.state.remotePeerSharing) ? (
                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        onPress={this.muteAudio}
                        icon={muteButtonIcons}
                    />
                </View>
                ) : null}

                {/* Single video picker button: tapping it shows a floating
                    panel with Front/Back Camera, Mute, Hide Myself, Swap
                    Video and Aspect Ratio. The bar icon itself reflects
                    the active camera (front/back) and overlays a red X
                    when the camera is muted. */}
                {this.renderVideoPicker(buttonSize, buttonClass)}

                {/* Remote-pointer toggle (viewer) and Stop screen share (sharer)
                    live in the CallOverlay navbar, in the swap-camera slot. */}

                {(!this.state.pointerMode && !this.state.remotePeerSharing) ? this.renderAudioDevicePicker(buttonSize, buttonClass) : null}

                {(!this.state.pointerMode && !this.state.remotePeerSharing) ? (
                <View style={[styles.buttonContainer, {marginLeft: 30}]}>
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass, styles.hangupButton]}
                        onPress={this.hangupCall}
                        icon="phone-hangup"
                    />
                </View>
                ) : null}
            </View>);
            // The local PIP thumbnail wrapper uses zIndex: 1000, so the
            // buttons View (which hosts the floating video/audio picker
            // panels) must sit above it for the panels to render on top
            // of the thumbnail when they overlap.
            buttons = (
                <View style={[buttonsContainer, {zIndex: 2000, elevation: 0, backgroundColor: 'transparent'}]}>
                    {content}
                </View>
            );
        }
        
        const debugBorderWidth = 0;
        // headerBarHeight = Appbar height (60) PLUS the Blink brand
        // strip above it (34dp, only shown in portrait — landscape
        // hides it). Previously hard-coded 60, which left the
        // video thumbnails / overlay content positioned UNDER the
        // brand strip in portrait. Adding the strip height in
        // portrait pushes them clear.
        const headerBarHeight = 60; // call appbar only — the 34dp Blink brand strip was removed (CallOverlay._showCallBrandStrip=false), so portrait no longer adds it

		let { width, height } = Dimensions.get('window');
        
		const topInset = this.state.insets?.top || 0;
		const bottomInset = this.state.insets?.bottom || 0;
		const leftInset = this.state.insets?.left || 0;
		const rightInset = this.state.insets?.right || 0;

	    const cornerOrder = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
       
        // On the cover display there isn't room for a 100px gap above
        // the bottom buttons, so cut it down substantially when folded.
        let bottomExtraInset = this.state.isLandscape ? 0 : (this.props.isFolded ? 40 : 100);
        let extraRightInset = 0;
         
		let corners = {
			topLeft: { top: this.state.fullScreen ? -topInset : headerBarHeight, left: 0},
			topRight: { top: this.state.fullScreen ? -topInset : headerBarHeight, right: extraRightInset},
			bottomRight: { bottom: this.state.fullScreen ? 0 : bottomInset + bottomExtraInset, right: extraRightInset},
			bottomLeft: { bottom: this.state.fullScreen ? 0: bottomInset + bottomExtraInset, left: 0},
		    id: 'init'
		};
				
        container = {
            flex: 1,
			borderWidth: debugBorderWidth,
			borderColor: 'white'
        }

        let myselfContainer = {
			  position: 'absolute',
			  top: 0,
			  left: 0,
			  right: 0,
			  bottom: 0,
			  zIndex: 1000,
			  pointerEvents: 'box-none'
			};

	    remoteVideoContainer = {
			position: 'absolute',
			top: this.state.fullScreen ? 0: headerBarHeight,
			bottom: this.state.fullScreen ? -bottomInset : (this.state.remotePeerSharing ? bottomInset : 0),
			borderWidth: debugBorderWidth,
			borderColor: 'red',
			width: '100%',
			height: '100%',
//			width: this.state.fullScreen ? width + rightInset : width,
//			height: this.state.fullScreen ? height : height - headerBarHeight - bottomInset - topInset
		};

		// Viewer watching the remote shared screen: the base height:'100%'
		// wins over top+bottom in Yoga (top+height takes precedence), so the
		// box overflowed the Android nav bar and — being too tall — vertically
		// re-centred the contained video, making it look shifted down. Drop the
		// explicit height so top + bottom (= bottomInset, which subtracts the
		// nav bar) size the box to fit exactly between the header and nav bar.
		if (this.state.remotePeerSharing && !this.state.fullScreen) {
			delete remoteVideoContainer.height;
		}

		if (this.state.isLandscape) {
			remoteVideoContainer.width = this.state.fullScreen ? width : width - rightInset - leftInset;
		}

		if (Platform.OS === 'ios' && this.state.remotePeerSharing && !this.state.fullScreen) {
			// Viewer watching the REMOTE SHARED SCREEN on iOS, windowed.
			//
			// The camera path below deliberately bleeds the video under the
			// header bar (marginTop:-topInset) and oversizes it to the full
			// window (height:height). That is invisible with objectFit:'cover'
			// because the overflow is simply cropped -- but the share path
			// uses objectFit:'contain', so the video is fitted to the BOX,
			// and a box that starts ~topInset above the screen and runs
			// headerBarHeight past the bottom pushes the top and bottom of
			// the remote screen off the visible area (the earlier
			// `delete remoteVideoContainer.height` was undone right here).
			//
			// Size the box explicitly instead. The parent (app-level
			// SafeAreaView) has its origin at screen-y = topInset, so:
			//   box top    (screen) = topInset + headerBarHeight  -> just under the appbar
			//   box bottom (screen) = windowHeight - bottomInset  -> just above the home indicator
			// top + height also take precedence over `bottom` in Yoga, so we
			// drop `bottom` rather than leave a conflicting anchor behind.
			remoteVideoContainer.marginTop = 0;
			remoteVideoContainer.top = headerBarHeight;
			remoteVideoContainer.height = height - topInset - headerBarHeight - bottomInset;
			delete remoteVideoContainer.bottom;

			if (this.state.isLandscape) {
				// Same edge-to-edge treatment as the windowed landscape
				// camera path: reach device x=0 and let width carry to the
				// right edge, so the shared screen is not pillarboxed by
				// the safe-area insets on top of its own letterboxing.
				remoteVideoContainer.marginLeft = -leftInset;
				remoteVideoContainer.width = width;
			}
		} else if (Platform.OS === 'ios') {
		    if (this.state.isLandscape) {
				if (this.state.fullScreen) {
					corners = {
						topLeft: { top: 0, left: -leftInset},
						topRight: { top: 0, right: -rightInset},
						bottomRight: { bottom: -bottomInset, right: -rightInset},
						bottomLeft: { bottom: -bottomInset, left: -leftInset},
						id: 'ios'
					};
					remoteVideoContainer.marginLeft = -leftInset;
					remoteVideoContainer.height = height;
				} else {
					// Non-fullscreen landscape: stretch the video
					// edge-to-edge just like fullscreen does, but keep
					// the header bar visible at the top. Pull left by
					// -leftInset to reach device x=0 and let width
					// carry it all the way to the right device edge.
					// PIP thumbnails mirror the fullscreen layout and
					// push out to the device edges (negative insets)
					// so they sit in the notch-area corners — only
					// the top edges are bumped down under the navbar.
					corners = {
						topLeft: { top: headerBarHeight, left: -leftInset},
						topRight: { top: headerBarHeight, right: -rightInset},
						bottomRight: { bottom: -bottomInset, right: -rightInset},
						bottomLeft: { bottom: -bottomInset, left: -leftInset},
						id: 'init'
					};
					remoteVideoContainer.marginLeft = -leftInset;
					remoteVideoContainer.width = width;
				}
			} else {
				remoteVideoContainer.marginTop = -topInset;
				remoteVideoContainer.height = height;
			}
		} else {
			// Android.
			//
			// In landscape, stretch the video edge-to-edge so the
			// picture isn't pillarboxed by the OS-provided left
			// safe-area inset (gesture-nav indicator / notch area).
			// Without this the video sits inside the safe-area and
			// the left strip of the screen stays as the call screen
			// background.
			//
			// Mirrors the iOS pattern: shift the
			// remoteVideoContainer (NOT the whole VideoBox
			// container) so CallOverlay — which has its own
			// landscape marginLeft shift — doesn't end up
			// double-shifted off-screen.
			if (this.state.isLandscape) {
				// Use absolute left/right anchoring instead of
				// marginLeft+width so the video container's edges
				// can be pinned to the actual screen edges
				// independently. width: '100%' from the base
				// style is irrelevant once `left` and `right` are
				// both set, but we clear it explicitly so the
				// layout engine doesn't try to honour both.
				delete remoteVideoContainer.width;
				remoteVideoContainer.left = -leftInset;
				// Fullscreen: pull the right edge OUT by rightInset
				// so the video covers the entire phone screen
				// (the OS hides system buttons in immersive mode).
				// Non-fullscreen: stop AT the safe-area boundary
				// so we don't render under the Android system
				// buttons on the right.
				remoteVideoContainer.right = this.state.fullScreen ? -rightInset : 0;
				if (this.state.fullScreen) {
					corners = {
						topLeft: { top: 0, left: -leftInset},
						topRight: { top: 0, right: -rightInset},
						bottomRight: { bottom: 0, right: -rightInset},
						bottomLeft: { bottom: 0, left: -leftInset},
						id: 'android-landscape-fs'
					};
				} else {
					corners = {
						topLeft: { top: headerBarHeight, left: -leftInset},
						topRight: { top: headerBarHeight, right: -rightInset},
						bottomRight: { bottom: 0, right: -rightInset},
						bottomLeft: { bottom: 0, left: -leftInset},
						id: 'android-landscape'
					};
				}
			}
		}
		
		// Self-video thumbnail dimensions. On the Razr cover display we
		// have very little real estate, so shrink the picture-in-picture
		// to roughly half size. The outer wrapper (below) uses the same
		// numbers so the surface and its hit target stay aligned.
		const selfThumbWidth  = this.props.isFolded ? 72 : 120;
		const selfThumbHeight = this.props.isFolded ? 96 : 160;
		const selfSurfaceHeight = this.props.isFolded ? 54 : 90;
		// Cache the current thumbnail dimensions on the instance so
		// the PanResponder (which closes over `this` rather than this
		// render scope) can clamp the drag against the live size on
		// fold/unfold and orientation transitions.
		this._selfThumbW = selfThumbWidth;
		this._selfThumbH = selfThumbHeight;

		let mySurfaceContainer = {
			flex: 1,
			width: selfThumbWidth,
			height: selfSurfaceHeight,
			elevation: 5,
			borderWidth: 0,
			zIndex: 1000,
		  };

				  
		let corner = {
		  ...corners[this.state.myVideoCorner],
		};
		
		let fullScreen = this.state.fullScreen;
		let insets = this.state.insets;
		let isLandscape = this.state.isLandscape;
  
		if (debugBorderWidth) {
			const values = {
//			  insets, 
			  container,
			  remoteVideoContainer,
//			  buttonsContainer,
//			  buttonsContainerClass,
			  myselfContainer,
//			  video,
//			  corner,
			  corners,
//			  myVideoCorner,
			  fullScreen,
			  height,
			  width,
			  rightInset,
			  topInset,
			  bottomInset,
			  isLandscape
			  
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

		// Force-remount key for fold/density transitions. IconButton and
		// RTCView/Surface cache their measured frames at the density they
		// were first mounted under; changing this key on fold/unfold and
		// on orientation/dimension changes forces React to remount them
		// so they re-measure at the new display metrics.
		const _videoRemountKey = (this.props.isFolded ? 'f' : 'u')
			+ '-' + (this.state.isLandscape ? 'l' : 'p')
			+ '-' + Math.round(width) + 'x' + Math.round(height)
			+ '-' + this.state.myVideoCorner
			// Bumped by _restartCameraCapture when it swaps a FRESH camera
			// track into the local stream. stream.toURL() is derived from the
			// stream id, which does not change when its tracks are replaced,
			// so the renderer would stay bound to the dead track and keep
			// painting black. Changing the key remounts the RTCView, which
			// re-attaches it as a sink on the new track.
			+ '-c' + (this.state.localViewEpoch || 0);

        // ZRTP indicator overlay — pill anchored above the call buttons.
        // Hidden together with the buttons when the overlay is collapsed
        // (full-screen video) so the encryption indicator doesn't float
        // alone on screen. Only shown once the key has been agreed —
        // the intermediate "negotiating" stage stays hidden so the user
        // doesn't see a transient yellow pill on every call setup.
        //
        // Gated on 'key-active' (decryptor counters confirm peer is
        // emitting our AES-GCM ciphertext) NOT 'key-agreed' (handshake
        // done but media flow not yet verified). See CallZrtp.js's
        // _startMediaActivityPoller for the state-machine details.
        // Standalone Media-stuck pill — used when zRTP didn't reach
        // key-active (so the main badge is hidden) but the activity
        // poller has latched mediaStuck=true. Tapping opens the same
        // shared MediaInfoPanel.
        const renderMediaStuckPill = () => {
            if (!this.state.mediaStuck) return null;
            if (!this.state.callOverlayVisible) return null;
            if (this.state.videoPickerVisible || this.state.audioDevicePickerVisible) return null;
            let bottomOffset;
            if (this.props.isTablet) {
                bottomOffset = this.state.isLandscape ? 140 : 200;
            } else {
                bottomOffset = this.state.isLandscape ? 80 : 130;
            }
            return (
                <View pointerEvents="box-none" style={{
                    position: 'absolute',
                    bottom: bottomOffset,
                    left: 0,
                    right: 0,
                    alignItems: 'center',
                    zIndex: 3000,
                    elevation: 40,
                }}>
                    <TouchableOpacity onPress={this._openMediaInfoPanel}>
                        <View style={{
                            backgroundColor: 'rgba(230, 120, 0, 0.95)',
                            paddingVertical: 4,
                            paddingHorizontal: 10,
                            borderRadius: 12,
                            alignSelf: 'center',
                        }}>
                            <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
                                ⚠ Media stuck — tap for info
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>
            );
        };
        const renderZrtpBadge = () => {
            if (!this.state.callOverlayVisible) {
                return null;
            }
            if (this.state.zrtpState !== 'key-active') {
                // Fall back to the Media-stuck pill so the user has
                // something to tap when the handshake never lit the
                // green badge but media is broken.
                return renderMediaStuckPill();
            }
            // Suppress the pill while either the camera picker or the
            // audio-device picker is open. The pill sits at zIndex:3000
            // / elevation:40 and visually overlaps the floating picker
            // panels that pop up from the call button bar; raising the
            // pickers above the pill is fragile because the picker
            // panels live deep inside several relatively-positioned
            // wrappers whose stacking contexts trap zIndex locally.
            // Hiding the pill while the user is interacting with a
            // picker is the cleaner UX — the pill returns the moment
            // the picker closes.
            if (this.state.videoPickerVisible || this.state.audioDevicePickerVisible) {
                return null;
            }
            let bg, label;
            const status = this._zrtpVerificationStatus();
            const session = getZrtpSession(this.state.call);
            const kinds = (session && session.encryptedKinds) || [];
            const kindsLabel = formatEncryptedKindsLabel(kinds);
            // Label simplification per user spec — dropped the longer
            // "end to end encryption" copy to match AudioCallBox. The
            // lock glyph + "zRTP encrypted" already communicates the
            // state without the qualifier eating pill width. The audio-
            // only / video-only prefix is still honoured for the
            // unusual cases where only one stream is end-to-end
            // encrypted (e.g. mid-call upgrade with one half still
            // mismatched).
            let _kindsPrefix = '';
            if (kindsLabel === 'audio') {
                _kindsPrefix = 'audio only ';
            } else if (kindsLabel === 'video') {
                _kindsPrefix = 'video only ';
            }
            const _zrtpLabel = '🔒 zRTP ' + _kindsPrefix + 'encrypted';
            if (status === 'verified') {
                bg = 'rgba(0, 170, 80, 0.9)';
                // "verified" suffix suppressed in the green pill — the
                // green colour communicates the state on its own.
                label = _zrtpLabel;
            } else if (status === 'mismatch') {
                bg = 'rgba(200, 30, 30, 0.9)';
                label = '⚠ SAS changed';
            } else {
                bg = 'rgba(230, 120, 0, 0.95)';
                label = _zrtpLabel;
            }
            const isTappable = this.state.zrtpState === 'key-active';
            const inner = (
                <View style={{
                    backgroundColor: bg,
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    alignSelf: 'center',
                    flexShrink: 0,
                }}>
                    <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}
                    >
                        {label}
                    </Text>
                </View>
            );
            // Dim "Tap to verify" sub-label is always shown (even on
            // the green verified state) so the pill always invites
            // the user to re-check / open the SAS dialog. The pill
            // itself no longer carries the "(tap to verify)" suffix —
            // the call-to-action lives here as a quieter sub-label
            // so the pill can stay focused on conveying the encrypted
            // state.
            // Anchor the pill above the call buttons row. Phone portrait
            // buttons sit ~50px from bottom + ~60px tall; phone landscape
            // buttons sit at the very bottom + ~60px tall. Tablets use
            // larger icons (size 40) and the buttons row sits higher, so
            // the pill needs a bigger offset to clear it. Add a small gap
            // so the pill doesn't crowd the icons.
            //
            // Also use a zIndex that sits above the buttons wrapper
            // (which uses zIndex: 2000) so the pill is never occluded by
            // the buttons bar — on iPad in particular the buttons row
            // landed on top of the pill at the previous zIndex.
            let bottomOffset;
            if (this.props.isTablet) {
                bottomOffset = this.state.isLandscape ? 140 : 200;
            } else {
                bottomOffset = this.state.isLandscape ? 80 : 130;
            }
            // Hide "Tap to verify" once the SAS has been confirmed —
            // the green pill is enough on its own and re-verification
            // isn't a normal user task.
            const _showTapToVerify = status !== 'verified';
            // Secondary "i" pill — opens the shared MediaInfoPanel.
            // Sits as a sibling next to the zRTP pill in the same
            // horizontal row, matched height + corner radius so the
            // two pills read as a unit.
            const _infoPill = (
                <TouchableOpacity
                    accessibilityLabel="Media info"
                    onPress={this._openMediaInfoPanel}
                    style={{
                        marginLeft: 14,
                        paddingVertical: 4,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        backgroundColor: 'rgba(255,255,255,0.20)',
                        alignSelf: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Text style={{
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 'bold',
                        fontStyle: 'italic',
                    }}>
                        i
                    </Text>
                </TouchableOpacity>
            );
            return (
                <View pointerEvents="box-none" style={{
                    position: 'absolute',
                    bottom: bottomOffset,
                    left: 0,
                    right: 0,
                    alignItems: 'center',
                    zIndex: 3000,
                    elevation: 40,
                }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {isTappable ? (
                            <TouchableOpacity onPress={this._onZrtpBadgePress}>{inner}</TouchableOpacity>
                        ) : inner}
                        {_infoPill}
                    </View>
                    {_showTapToVerify ? (
                        <Text style={{
                            color: 'rgba(255, 255, 255, 0.65)',
                            fontSize: 10,
                            fontStyle: 'italic',
                            marginTop: 4,
                            textShadowColor: 'rgba(0, 0, 0, 0.6)',
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 2,
                        }}>
                            Tap to verify
                        </Text>
                    ) : null}
                </View>
            );
        };

        const zrtpSession = this.state.zrtpDialogVisible ? getZrtpSession(this.state.call) : null;
        const zrtpSas = zrtpSession && zrtpSession.sas;
        const verificationStatus = this._zrtpVerificationStatus();
        const zrtpStored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;

        // Pre-compute the modal preview's streamURL so we can render the
        // RTCView OUTSIDE the <Portal> below — on iOS 26 +
        // react-native-webrtc M124, an RTCView mounted inside a Portal
        // never binds its native CALayer to the WebRTC video source
        // (the tile stays black even though localStream is set,
        // streamURL is valid, and the track is enabled — see the
        // `[video-preview] modal render` log lines). The Portal is
        // still needed for the dim backdrop + Audio-only / Enable-camera
        // buttons (those rendering paths are fine inside it).
        const _modalPreviewUrl = (this.state.videoEnableDialogVisible
            && this.state.localStream
            && this.state.localStream.toURL)
              ? this.state.localStream.toURL()
              : null;

        // Camera-enable modal with a NATIVE camera preview tile.
        //
        // The preview is rendered via RNCamera (react-native-camera),
        // NOT via the webrtc RTCView. Reason: both iOS and Android
        // pause the webrtc-managed AVCaptureSession / CameraX session
        // when the RTCRtpSender is gated (replaceTrack(null) or
        // setParameters({active:false})), so an RTCView mounted
        // during the modal stays black even though all JS state looks
        // correct. RNCamera opens its OWN native camera handle that
        // has nothing to do with webrtc, so the preview always shows
        // live frames. The webrtc capture is paused during this
        // window (the sender's encodings are inactive), which also
        // frees the camera hardware for RNCamera to use without
        // multi-output conflicts. On Enable / Audio-only we unmount
        // RNCamera FIRST (release the camera handle), then either
        // un-gate webrtc (Enable) or leave it gated (Audio-only).
        const renderCameraEnableModal = () => {
            if (!this.state.videoEnableDialogVisible) return null;
            const _topInset = (this.state.insets && this.state.insets.top) ? this.state.insets.top : 24;
            const _bottomInset = (this.state.insets && this.state.insets.bottom) ? this.state.insets.bottom : 0;
            // Same brand-strip adjustment as the headerBarHeight
            // above — portrait adds the 34dp Blink strip on top of
            // the 60dp Appbar.
            const _headerBarHeight = 60; // call appbar only — brand strip removed, no portrait extra
            try {
                console.log('[video-preview] modal render (RNCamera)',
                    'cameraFacing=' + this.state.cameraFacing,
                    'detached=' + !!this._previewTrackWasReEnabled,
                    'isFolded=' + !!this.props.isFolded);
            } catch (e) {
                console.log('[video-preview] modal render trace threw:', (e && e.message) || String(e));
            }

            // Folded (Razr cover display) variant. The cover display is
            // tiny and the preview tile + descriptive panel don't fit
            // comfortably, so when an incoming video call brings up the
            // camera-enable prompt we collapse the modal down to just
            // the two action buttons — Start Camera and Audio only —
            // stacked in the centre of the cover screen. Both buttons
            // call the same handlers as their full-size counterparts in
            // the unfolded modal (_onEnableCamera / _onKeepAudioOnly).
            // We deliberately omit the RNCamera preview tile (the
            // "Video Preview") and the explanatory text — there's no
            // room for them on the cover display.
            if (this.props.isFolded) {
                return (
                    <View
                        pointerEvents="box-none"
                        style={[StyleSheet.absoluteFillObject, { zIndex: 5000, elevation: 50 }]}
                    >
                        {/* Opaque backdrop — starts BELOW the navbar so the
                            caller name + kebab menu stay visible, same as
                            the unfolded variant below. */}
                        <View
                            style={{
                                position: 'absolute',
                                top: _topInset + _headerBarHeight,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: '#000',
                            }}
                            pointerEvents="auto"
                        />
                        {/* Centred action buttons — Start Camera on top,
                            Audio only below. Stacked vertically because
                            the cover display is too narrow to fit them
                            side by side at a comfortable tap target. */}
                        <View
                            style={{
                                position: 'absolute',
                                top: _topInset + _headerBarHeight,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1,
                            }}
                            pointerEvents="box-none"
                        >
                            <Button
                                mode="contained"
                                icon="video"
                                onPress={this._onEnableCamera}
                            >
                                Start Camera
                            </Button>
                            <Button
                                mode="outlined"
                                onPress={this._onKeepAudioOnly}
                                style={{ marginTop: 12 }}
                                color="white"
                            >
                                Audio only
                            </Button>
                        </View>
                    </View>
                );
            }

            return (
                <View
                    pointerEvents="box-none"
                    style={[StyleSheet.absoluteFillObject, { zIndex: 5000, elevation: 50 }]}
                >
                    {/* Opaque backdrop — starts BELOW the navbar so the
                        caller name + kebab menu stay visible. */}
                    <View style={{position:'absolute', top: _topInset + _headerBarHeight, left:0, right:0, bottom:0, backgroundColor:'#000'}} pointerEvents="auto" />

                    {/* Native RNCamera preview tile. Independent of
                        webrtc — its own AVCaptureSession (iOS) /
                        CameraX session (Android) gives us a live
                        preview that survives the webrtc sender being
                        gated. */}
                    <View style={{
                        position:'absolute',
                        top: _topInset + _headerBarHeight + 8,
                        left: 12,
                        right: 12,
                        bottom: _bottomInset + 200,
                        borderRadius: 12,
                        overflow: 'hidden',
                        backgroundColor: '#222',
                    }}>
                        <DeferredRTCView
                            // Camera-enable modal preview — the webrtc
                            // localStream itself, NOT a second (vision-camera)
                            // capture session. The native
                            // mediaStreamTrackSetEnabled patch keeps the camera
                            // capturing while the track is "muted"
                            // (track.enabled=false) during this modal, so the
                            // webrtc stream keeps producing frames and shows a
                            // live preview here. One camera client (webrtc)
                            // removes the vision-camera<->webrtc handoff that left
                            // the outbound video at 0 frames after Enable on some
                            // devices (Sony XQ-EC72). Rendered outside the
                            // <Portal>s above so the RTCView binds on iOS M124.
                            key={'vb-modal-preview-' + this._remoteRtcMountKey}
                            style={{flex: 1}}
                            objectFit='cover'
                            streamURL={_modalPreviewUrl}
                            mirror={this.state.mirror}
                        />
                        {/* Top-right camera-flip button — same icon /
                            size / placement / styling as the audio→
                            video upgrade preview in Call.js so the
                            two surfaces look identical. */}
                        <View style={{position: 'absolute', top: 12, right: 12}}>
                            <IconButton
                                icon="camera-flip"
                                size={28}
                                onPress={() => {
                                    // webrtc owns the capture now (the preview is
                                    // the webrtc localStream), so actually switch
                                    // the live camera. toggleCamera() calls
                                    // track._switchCamera() and updates mirror +
                                    // cameraFacing.
                                    this.toggleCamera();
                                }}
                                style={{backgroundColor: 'rgba(255,255,255,0.85)'}}
                            />
                        </View>
                        {/* Small label showing which camera is active. */}
                        <View style={{
                            position: 'absolute',
                            bottom: 8,
                            left: 8,
                            backgroundColor: 'rgba(0,0,0,0.55)',
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                        }}>
                            <PaperText style={{ color: '#fff', fontSize: 12 }}>
                                {this.state.cameraFacing === 'back' ? 'Back camera' : 'Front camera'}
                            </PaperText>
                        </View>
                    </View>

                    {/* Bottom panel with the question + actions. */}
                    <View style={{
                        position:'absolute',
                        bottom: _bottomInset + 12,
                        left: 12,
                        right: 12,
                        backgroundColor: 'white',
                        borderRadius: 12,
                        paddingTop: 14,
                        paddingBottom: 6,
                        paddingHorizontal: 16,
                        elevation: 8,
                    }} pointerEvents="auto">
                        <PaperText style={{fontSize: 18, fontWeight: 'bold', marginBottom: 8}}>
                            Enable your camera?
                        </PaperText>
                        <PaperText style={{marginBottom: 12}}>
                            {(this.state.remoteDisplayName || this.state.remoteUri || 'The other party')} is calling with video. Pick whether to start your camera now, or stay audio-only and turn it on later.
                        </PaperText>
                        {/* Camera-flip lives in the top-right of the
                            preview tile (matches the audio→video
                            upgrade screen). Bottom row is just the
                            Audio-only / Enable-camera actions. */}
                        <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
                            <Button onPress={this._onKeepAudioOnly}>Audio only</Button>
                            <Button mode="contained" onPress={this._onEnableCamera} style={{marginLeft: 8}}>Enable camera</Button>
                        </View>
                    </View>
                </View>
            );
        };

        return (
            <View style={styles.container}>
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
                                <PaperText style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                                    Sylk-ZRTP v{zrtpSession.negotiatedVersion || '?'} · {zrtpSession.continuityState || 'first-time'}
                                </PaperText>
                            )}
                            {zrtpSession && (
                                // Per-device keying breadcrumb. Both
                                // values truncated for screen real
                                // estate; the full strings are in the
                                // [zrtp] log lines.
                                //   this device — our localDeviceId
                                //     (+sip.instance / device UUID we
                                //     put on the wire so the peer can
                                //     pick the right rs1 slot for us).
                                //   peer        — peerDeviceId from
                                //     the most recent probe/accept;
                                //     '<none>' if the peer didn't send
                                //     it (older stack, sipsimple with
                                //     settings.instance_id unset).
                                <PaperText style={{ fontSize: 11, color: '#888', marginBottom: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                                    this device: {(zrtpSession.localDeviceId || '<none>').slice(0, 16)}
                                    {'\n'}peer: {(zrtpSession.peerDeviceId || '<none>').slice(0, 16)}
                                </PaperText>
                            )}
                            <PaperText style={{ marginBottom: 12 }}>
                                {`Compare these with ${this.state.remoteDisplayName || this.state.remoteUri || 'the other party'}. Both parties must show the same letters AND emojis.`}
                            </PaperText>
                            {zrtpSas ? (
                                <View style={{ alignItems: 'center', marginVertical: 12 }}>
                                    <PaperText style={{ fontSize: 36, fontWeight: 'bold', letterSpacing: 8 }}>{zrtpSas.chars}</PaperText>
                                    <PaperText style={{ fontSize: 32, marginTop: 6, letterSpacing: 6 }}>{zrtpSas.emojis}</PaperText>
                                </View>
                            ) : (
                                <PaperText>Waiting for handshake to complete…</PaperText>
                            )}
                            {verificationStatus === 'verified' && zrtpStored && (
                                <PaperText style={{ color: 'green', marginTop: 8 }}>
                                    ✓ Verified on {formatVerifiedTimestamp(zrtpStored.verifiedAt)}
                                </PaperText>
                            )}
                            {verificationStatus === 'mismatch' && zrtpStored && (
                                <PaperText style={{ color: 'red', marginTop: 8 }}>
                                    ⚠ The other party's identity key has changed since the last verification on {formatVerifiedTimestamp(zrtpStored.verifiedAt)}. Re-verify carefully before tapping Confirm.
                                </PaperText>
                            )}
                        </Dialog.Content>
                        <Dialog.Actions style={{ justifyContent: 'space-between' }}>
                            <Button onPress={this._onZrtpReset}>Reset</Button>
                            <Button onPress={this._onZrtpVerifyConfirm} disabled={!zrtpSas}>Confirm</Button>
                        </Dialog.Actions>
                    </Dialog>
                    {/* zRTP mandatory-mode handshake failure prompt
                        moved out of the Portal — see AudioCallBox for
                        the same change. The in-call banner that
                        replaces it is rendered as a sibling of the
                        Portal below so it sits inside the call
                        screen, not above the whole app. */}
                </Portal>
                {/* In-call zRTP mandatory-failed banner. Renders as a
                    full-width red bar pinned just above the rest of
                    the video UI when the handshake gives up in
                    mandatory mode. Continue / End call actions stay
                    available; "Continue" downgrades to DTLS-only
                    (relay can read media), "End call" tears down. */}
                {this.state.zrtpMandatoryFailedVisible && (
                    <View
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(200, 30, 30, 0.95)',
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            zIndex: 2000,
                            elevation: 30,
                        }}
                    >
                        <PaperText style={{
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 'bold',
                            marginBottom: 6,
                        }}>
                            End-to-end encryption failed
                        </PaperText>
                        <PaperText style={{
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
                        </PaperText>
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
                {/* Hide the ZRTP/SAS security pill while a screen share is
                    active in EITHER direction — it overlaps the shared content
                    and adds clutter the sharer/viewer doesn't need mid-share.
                    Reappears automatically when the share ends. */}
                {(this.state.screenSharing || this.state.remotePeerSharing) ? null : renderZrtpBadge()}
                <MediaInfoPanel
                    call={this.state.call}
                    visible={!!this.state.mediaInfoPanelVisible}
                    onClose={this._closeMediaInfoPanel}
                    mediaStuck={!!this.state.mediaStuck}
                />
                <CallOverlay
                    show = {show}
                    remotePeerSharing = {this.state.remotePeerSharing}
                    leftInsetOrigin = {true}
                    parentBledLeft = {true}
                    systemMessage = {this.props.systemMessage}
                    remoteUri = {this.state.remoteUri}
                    remoteDisplayName = {this.state.remoteDisplayName}
                    photo = {this.state.photo}
                    localMedia = {this.state.localMedia}
                    call = {this.state.call}
                    connection = {this.state.connection}
                    accountId = {this.state.accountId}
                    info={this.state.info}
                    media='video'
                    videoCodec={this.props.videoCodec}
                    audioCodec={this.props.audioCodec}
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                    terminatedReason={this.state.terminatedReason}
                    isLandscape = {this.state.isLandscape}         
                    toggleMyVideo= {this.toggleMyVideo}    
                    swapVideo= {this.swapVideo}    
                    enableMyVideo={this.state.enableMyVideo}    
                    hangupCall={this.hangupCall}
                    screenSharing={this.state.screenSharing}
                    stopScreenShare={() => this._stopScreenShare()}
                    pointerMode={this.state.pointerMode}
                    togglePointerMode={() => this.togglePointerMode()}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
					aspectRatio = {this.state.aspectRatio}
					toggleAspectRatio = {this.toggleAspectRatio}
					showUsage = {this.state.showUsage}
					toggleUsage = {() => this.setState(s => ({ showUsage: !s.showUsage }))}
					hideSpeedometers = {this.state.videoEnableDialogVisible}
					shareLocationFromCall = {this.props.shareLocationFromCall}
					requestLocationFromCall = {this.props.requestLocationFromCall}
					/* Passed as undefined when the peer never advertised
					   screen-sharing support, which is what hides the
					   "Request screen" kebab item -- CallOverlay gates
					   every item in that group on `typeof prop ===
					   'function'`, so there is no separate flag to keep
					   in sync. */
					requestScreenShare = {this._peerCanShareScreen()
						? this.sendScreenShareRequest
						: undefined}
					screenRequestPending = {this.state.screenRequestPending}
					showMediaInfo = {this._openMediaInfoPanel}
					callHasVideo = {this.props.callHasVideo}
					switchCallView = {this.props.switchCallView}
                />

                {/* Outcome of a screen-share request we sent (accepted /
                    declined / timed out). Sits just under the header so it
                    doesn't collide with the network HUD at the top-left or
                    the action bar at the bottom. pointerEvents none so it
                    never eats a tap meant for the video. */}
                {this.state.screenRequestNotice ? (
                    <View pointerEvents="none" style={{
                        position: 'absolute',
                        top: 90,
                        left: 20,
                        right: 20,
                        alignItems: 'center',
                        zIndex: 1200,
                    }}>
                        <View style={{
                            backgroundColor: 'rgba(0,0,0,0.75)',
                            borderRadius: 16,
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                        }}>
                            <PaperText style={{color: '#fff', fontSize: 13, textAlign: 'center'}}>
                                {this.state.screenRequestNotice}
                            </PaperText>
                        </View>
                    </View>
                ) : null}

                {/* Remote party's User-Agent moved into the network HUD:
                    it renders under the speedometers, only while the HUD
                    is expanded (showUsage) — see the NetworkSpeedometer
                    block below. The always-on label that used to float
                    here over the video was removed on request. */}

                {this.showRemote?
					<View style={[container, remoteVideoContainer,
					    this.state.remotePeerSharing
					        ? { borderWidth: 5, borderColor: '#E53935', backgroundColor: '#000' }
					        : null]}>
					  {/* Viewer-side cue: while the peer shares their screen, a
					      thick red border + a red "REMOTE SCREEN" chip make it
					      obvious this is THEIR screen, not our own camera (both
					      apps otherwise look identical). Gated on remotePeerSharing
					      so it only shows on the watching side and clears on stop.
					      pointerEvents none so it never eats pointer/fullscreen taps. */}
					  {/* Viewer-side "remote" label, bottom-right corner, while the
					      peer is sharing their screen. */}
					  {this.state.remotePeerSharing ? (
					    <View pointerEvents="none" style={{
					        position: 'absolute', bottom: 6, right: 6,
					        zIndex: 2000, elevation: 30,
					        backgroundColor: this.state.remoteShareStalled ? '#616161' : '#E53935',
					        borderRadius: 4,
					        paddingHorizontal: 5, paddingVertical: 1,
					    }}>
					      <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 8, letterSpacing: 0.3 }}>
					        {this.state.remoteShareStalled ? 'REMOTE — NO UPDATES' : 'REMOTE'}
					      </Text>
					    </View>
					  ) : null}
					  {/* The peer's screen has not sent a frame in a while. State
					      that neutrally: a motionless screen looks identical to a
					      dead capture from here, and we must not accuse a working
					      share of being broken. Either way the viewer now knows
					      the picture is old, instead of staring at a frozen frame
					      believing it is live — the failure of 2026-08-16. */}
					  {(this.state.remotePeerSharing && this.state.remoteShareStalled) ? (
					    <View pointerEvents="none" style={{
					        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
					        alignItems: 'center', justifyContent: 'center',
					        zIndex: 1999, elevation: 29,
					    }}>
					      <View style={{
					          backgroundColor: 'rgba(0,0,0,0.72)',
					          borderRadius: 8,
					          paddingHorizontal: 12, paddingVertical: 8,
					      }}>
					        <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' }}>
					          No screen updates
					        </Text>
					        <Text style={{ color: '#ddd', fontSize: 11, marginTop: 2, textAlign: 'center' }}>
					          Showing the last frame received
					        </Text>
					      </View>
					    </View>
					  ) : null}
					  <DeferredRTCView
					    // Force a fresh native view on every VideoBox
					    // mount by keying on `_remoteRtcMountKey` (set
					    // once per instance in the constructor).
					    // Without this, RTCView on Android M124 can
					    // hold onto a stale surface from a previous
					    // mount even when the streamURL hasn't
					    // changed — symptom: audio→video upgrade
					    // renders correctly on first display, then
					    // shows a black remote frame after navigating
					    // away from /call and back. Because the key
					    // changes per mount (not per render), it does
					    // NOT thrash within a single mount.
					    // DeferredRTCView holds streamURL back one tick
					    // on mount so the native createView batch never
					    // carries a stream — see DeferredRTCView.js for
					    // the UI-thread deadlock this prevents.
						key={this._remoteRtcMountKey}
						objectFit={(this.state.pointerMode || this.state.remotePeerSharing) ? 'contain' : this.state.aspectRatio}
						// While viewing the remote screen the container height comes
						// from top+bottom, so styles.video's height:'100%' can't
						// resolve (video top-tucks). absoluteFill fills the box, and
						// objectFit:'contain' then centres the video with equal black
						// bars (container has a black background).
						style={this.state.remotePeerSharing ? StyleSheet.absoluteFillObject : styles.video}
						streamURL={this.remoteStreamUrl}
					  />
					  <View
					      style={StyleSheet.absoluteFillObject}
					      onLayout={(e) => {
					          const { width: lw, height: lh } = e.nativeEvent.layout;
					          if (lw && lh && (!this.state.remoteVideoLayout
					              || this.state.remoteVideoLayout.w !== lw
					              || this.state.remoteVideoLayout.h !== lh)) {
					              this.setState({ remoteVideoLayout: { w: lw, h: lh } });
					          }
					      }}
					      onStartShouldSetResponder={() => true}
					      onResponderRelease={(e) => {
					          if (this.state.pointerMode) {
					              this._sendPointer(e.nativeEvent.locationX, e.nativeEvent.locationY);
					          } else {
					              this.toggleFullScreen();
					          }
					      }}
					  />
					  {/* Local echo of a click the peer ACKed rendering — green dot
					      at the tap position (same locationX/Y space as the target
					      above). Confirms the remote actually showed our pointer. */}
					  {this.state.ackEcho ? (
					    <View
					      pointerEvents="none"
					      style={{
					        position: 'absolute',
					        left: this.state.ackEcho.x - 11,
					        top: this.state.ackEcho.y - 11,
					        width: 22, height: 22, borderRadius: 11,
					        borderWidth: 3, borderColor: '#4CAF50',
					        backgroundColor: 'rgba(76,175,80,0.35)',
					      }}
					    />
					  ) : null}
					  {/* Show the avatar (video-lost look) whenever the remote video
					      would render — OR while WE are screen-sharing, so our
					      captured screen never echoes the peer's own video back
					      to them. */}
					  {(!this.state.remoteVideoActive || this.state.screenSharing) ? (
					    <View
					      pointerEvents="none"
					      style={[StyleSheet.absoluteFillObject, {
					        backgroundColor: '#000',
					        alignItems: 'center',
					        justifyContent: 'center',
					      }]}
					    >
					      <UserIcon
					        identity={{
					          uri: this.state.remoteUri || '',
					          name: this.state.remoteDisplayName || '',
					          photo: this.state.photo,
					        }}
					        size={Math.max(96, Math.round(Math.min(width, height) * 0.35))}
					      />
					      {(this.state.remoteDisplayName || this.state.remoteUri) ? (
					        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 18, marginTop: 16, maxWidth: '80%', textAlign: 'center' }}>
					          {this.state.remoteDisplayName || this.state.remoteUri}
					        </Text>
					      ) : null}
					    </View>
					  ) : null}
					</View>
				: null }


                {this.showMyself ?
				  (() => {
				    // Resolve the thumbnail's on-screen position.
				    // selfThumbPosition is set the first time the
				    // user drags; until then we anchor at the
				    // default top-right just below the header. We no
				    // longer use the fixed corner cycling.
				    const _pos = this.state.selfThumbPosition
				        || this._getDefaultSelfThumbPosition();
				    return (
				      <View
					key={'vb-myself-wrap-' + _videoRemountKey}
					pointerEvents="box-none"
					style={myselfContainer}
				  >
					<View
					  key={'vb-myself-pos-' + _videoRemountKey}
					  {...this._selfThumbPanResponder.panHandlers}
					  style={{
						position: 'absolute',
						width: selfThumbWidth,
						height: selfThumbHeight,
						top: _pos.y,
						left: _pos.x,
					  }}
					>
					  <Surface key={'vb-myself-surf-' + _videoRemountKey} style={mySurfaceContainer}>
						<DeferredRTCView
							key={'vb-myself-rtc-' + _videoRemountKey}
							objectFit='cover'
							style={styles.video}
							ref={this.localVideo}
							streamURL={this.localStreamUrl}
							mirror={this.state.mirror}
						/>
					</Surface>
					{/* Swap-camera affordance, top-left of the
					    thumbnail. Stays above the RTCView via
					    zIndex/elevation. hitSlop expands the tap
					    area beyond the small visible glyph. */}
					<TouchableOpacity
					    onPress={() => this.toggleCamera()}
					    accessibilityLabel="Switch camera"
					    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
					    style={{
					        position: 'absolute',
					        top: 4,
					        left: 4,
					        zIndex: 1600,
					        elevation: 30,
					        width: 26,
					        height: 26,
					        borderRadius: 13,
					        backgroundColor: 'rgba(0,0,0,0.45)',
					        alignItems: 'center',
					        justifyContent: 'center',
					    }}
					>
					    <Icon
					        name="camera-switch"
					        size={16}
					        color="#ffffff"
					    />
					</TouchableOpacity>
					{/* Close (hide self-view), top-right of the
					    thumbnail. Sets enableMyVideo=false so the
					    PIP is removed; the user can bring it back
					    via the video picker's "Show myself" toggle. */}
					<TouchableOpacity
					    onPress={() => {
					        this.setState({enableMyVideo: false});
					        this._persistVideoCallPrefs({show_mirror: false});
					    }}
					    accessibilityRole="button"
					    accessibilityLabel="Close self-view"
					    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
					    style={{
					        position: 'absolute',
					        top: 4,
					        right: 4,
					        zIndex: 1600,
					        elevation: 30,
					        width: 26,
					        height: 26,
					        borderRadius: 13,
					        backgroundColor: 'rgba(0,0,0,0.45)',
					        alignItems: 'center',
					        justifyContent: 'center',
					    }}
					>
					    <Icon
					        name="close"
					        size={16}
					        color="#ffffff"
					    />
					</TouchableOpacity>
					</View>

				  </View>
				    );
				  })()
                 : null }

                {this.state.reconnectingCall ?
                    <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={'#D32F2F'} />
                    : null
                }

                {/* Fullscreen invisible backdrop that dismisses the
                    floating video picker when the user taps anywhere
                    outside the panel. Rendered before {buttons} so the
                    buttons (and the panel itself, which lives inside
                    them) remain on top and stay tappable. */}
                {this.state.videoPickerVisible && (
                    <TouchableWithoutFeedback
                        onPress={() => this.setState({videoPickerVisible: false})}
                    >
                        <View style={StyleSheet.absoluteFillObject} />
                    </TouchableWithoutFeedback>
                )}

                {/* iOS-only, zero-size: the system broadcast picker we tap
                    programmatically from selectScreenShare to start whole-screen
                    sharing. Harmless/absent on Android. */}
                {Platform.OS === 'ios' ? (
                    <ScreenCapturePickerView
                        ref={(r) => { this._iosBroadcastPicker = r; }}
                        style={{ width: 0, height: 0 }}
                    />
                ) : null}

                {buttons}

                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
                    selectedContacts={this.state.selectedContacts}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />

                {/* Conference-request confirmation — same Material
                    paper Dialog as AudioCallBox._renderConferenceRequestPlus,
                    so the escalation UX is identical across audio and
                    video calls and renders the same on iOS / Android.
                    Replaces the old EscalateConferenceModal text-input
                    flow as the account-plus button's target. */}
                <Portal>
                    <Dialog
                        visible={!!this.state.showConferenceRequestPanel}
                        onDismiss={this.closeConferenceRequestPanel}
                    >
                        <Dialog.Title>Escalate to conference</Dialog.Title>
                        <Dialog.Content>
                            <PaperText>
                                {(() => {
                                    let peerLabel = '';
                                    const contact = this.state.callContact;
                                    if (contact && contact.name) {
                                        peerLabel = contact.name;
                                    } else if (this.state.remoteDisplayName) {
                                        peerLabel = this.state.remoteDisplayName;
                                    } else if (this.state.remoteUri) {
                                        peerLabel = this.state.remoteUri.split('@')[0];
                                    }
                                    return peerLabel
                                        ? `Invite ${peerLabel} into a video conference? They will receive a request and can accept or decline.`
                                        : 'Invite the other party into a video conference? They will receive a request and can accept or decline.';
                                })()}
                            </PaperText>
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={this.closeConferenceRequestPanel}>
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                onPress={this.sendConferenceRequest}
                                disabled={!!this.state.conferenceRequestPending}
                                icon="account-multiple-plus"
                            >
                                {this.state.conferenceRequestPending ? 'Inviting…' : 'Invite'}
                            </Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>

                {/* Network HUD. Two states:
                    - Hidden behind a small "i" info icon (default).
                    - User taps the icon → speedometer expands.
                    - User taps the speedometer → collapses back to icon.
                    Anchored at the top-left of the video, matching the
                    conference UI. Rendered in BOTH fullscreen and
                    non-fullscreen — the default y already accounts
                    for the navbar so the icon stays clear when the
                    header is visible. When the speedometer is
                    expanded the user can drag it anywhere on screen;
                    the i icon stays fixed at the default anchor. */}
                {this.state.call && !this.state.videoEnableDialogVisible ? (() => {
                    const _spd = this.state.speedoPosition;
                    const _default = this._getDefaultSpeedoPosition();
                    const _posLeft = (this.state.showUsage && _spd) ? _spd.x : _default.x;
                    const _posTop = (this.state.showUsage && _spd) ? _spd.y : _default.y;
                    const _panProps = this.state.showUsage
                        ? this._speedoPanResponder.panHandlers
                        : {};
                    return (
                    <View
                        {..._panProps}
                        style={{
                            position: 'absolute',
                            top: _posTop,
                            left: _posLeft,
                            zIndex: 9999,
                            // Android: zIndex alone doesn't stack
                            // above other absolutely-positioned
                            // siblings (the remote-video container
                            // with its full-screen TouchableWithoutFeedback,
                            // for example). elevation lifts this
                            // layer above them.
                            elevation: 50,
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
                                    videoCodec={this.props.videoCodec}
                                    audioCodec={this.props.audioCodec}
                                    showResolution
                                />
                                {/* Remote party's client User-Agent (SIP
                                    User-Agent / Server header forwarded by
                                    sylk-server via Call.js). Glued under
                                    the speedometers inside the same HUD
                                    box, so it's only visible while the
                                    HUD is expanded and moves with it when
                                    dragged. Replaces the always-on label
                                    that used to float over the video. */}
                                {this.props.remoteUserAgent ? (
                                    <Text
                                        numberOfLines={2}
                                        ellipsizeMode="tail"
                                        style={{
                                            color: 'rgba(255, 255, 255, 0.7)',
                                            fontSize: 11,
                                            textAlign: 'center',
                                            maxWidth: 220,
                                            alignSelf: 'center',
                                            paddingHorizontal: 6,
                                            paddingTop: 2,
                                            paddingBottom: 2,
                                        }}
                                    >
                                        {this.props.remoteUserAgent}
                                    </Text>
                                ) : null}
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
                    );
                })() : null}

                {/* Camera-enable modal (RTCView + backdrop + buttons).
                    Rendered OUTSIDE the Portal so the iOS RTCView
                    native CALayer binds correctly. See comments at the
                    top of render() for the full story. */}
                {renderCameraEnableModal()}
            </View>
        );
    }
}

VideoBox.propTypes = {
    call                    : PropTypes.object,
    connection              : PropTypes.object,
    photo                   : PropTypes.string,
    accountId               : PropTypes.string,
    remoteUri               : PropTypes.string,
    remoteDisplayName       : PropTypes.string,
    remoteUserAgent         : PropTypes.string,
    localMedia              : PropTypes.object,
    hangupCall              : PropTypes.func,
    info                    : PropTypes.string,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    intercomDtmfTone        : PropTypes.string,
    isLandscape             : PropTypes.bool,
    isTablet                : PropTypes.bool,
    isFolded                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
    showLogs                : PropTypes.func,
    goBackFunc              : PropTypes.func,
    callState               : PropTypes.object,
    messages                : PropTypes.object,
    sendMessage             : PropTypes.func,
    reSendMessage           : PropTypes.func,
    confirmRead             : PropTypes.func,
    deleteMessage           : PropTypes.func,
    expireMessage           : PropTypes.func,
    getMessages             : PropTypes.func,
    pinMessage              : PropTypes.func,
    unpinMessage            : PropTypes.func,
    callContact             : PropTypes.object,
    selectedContact         : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    terminatedReason        : PropTypes.string,
    videoMuted              : PropTypes.bool,
    cameraInitiallyMuted    : PropTypes.bool,
	useInCallManger         : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
	insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func

};

export default VideoBox;
