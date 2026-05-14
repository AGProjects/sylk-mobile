import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors, Menu, Dialog, Button, Portal, Text as PaperText } from 'react-native-paper';
import { getZrtpSession } from './CallZrtp';
import { View, Text, Dimensions, TouchableWithoutFeedback, TouchableOpacity, Platform, TouchableHighlight  } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {StatusBar} from 'react-native';
import Immersive from 'react-native-immersive';
import { StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import CallOverlay from './CallOverlay';
import NetworkSpeedometer from './NetworkSpeedometer';

import EscalateConferenceModal from './EscalateConferenceModal';
import InCallManager from 'react-native-incall-manager';

//import TrafficStats from './BarChart';
import utils from '../utils';

import styles from '../assets/styles/VideoCall';

const DEBUG = debug('blinkrtc:Video');
//debug.enable('*');


const MAX_POINTS = 30;

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
            showMyself: true,
            remoteVideoShow: true,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
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
			videoPickerVisible: false,
            // ZRTP state, mirroring AudioCallBox.
            zrtpState: null,
            zrtpDialogVisible: false,
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
        };

		this.prevStats = {}; // initialize here
		this.prevValues = {};
        this.overlayTimer = null;
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();

        this.userHangup = false;
        if (this.props.call) {
            this.props.call.statistics.on('stats', this.statistics);
        }

		const localStream = this.state.localStream;
		if (localStream.getVideoTracks().length > 0) {
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
		}
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted') && nextProps.muted !== this.props.muted) {
            this.setState({audioMuted: nextProps.muted});
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

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
                this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
                this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            }
            const existing = getZrtpSession(nextProps.call);
            const newLocalStream = nextProps.call.getLocalStreams()[0];
            this.setState({call: nextProps.call,
                           localStream: newLocalStream,
                           remoteStream: nextProps.call.getRemoteStreams()[0],
                           zrtpState: (existing && existing.state) ? existing.state : null
            });

            // Re-attach the local-video-track health listeners to the
            // new stream. For incoming video calls the SDP answer
            // arrives after VideoBox mounts and swaps in a different
            // localStream — without this re-attach we'd silently
            // monitor the old (discarded) track.
            this._attachLocalVideoTrackListeners(newLocalStream);
        }

        if ('aspectRatio' in nextProps) {
			this.setState({aspectRatio: nextProps.aspectRatio});
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        this.setState({
                       callContact: nextProps.callContact,
                       remoteUri: nextProps.remoteUri,
                       photo: nextProps.photo ? nextProps.photo : this.state.photo,
                       remoteDisplayName: nextProps.remoteDisplayName,
                       selectedContact: nextProps.selectedContact,
                       selectedContacts: nextProps.selectedContacts,
                       localMedia: nextProps.localMedia,
                       terminatedReason: nextProps.terminatedReason,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   isLandscape: nextProps.isLandscape
                       });

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
        }
        if (newState === 'established') {
            // Streams attach to the peer connection on answer. Refresh
            // our refs so the remote video starts rendering and the
            // local stream switches from props.localMedia to the
            // sender's actual track.
            const ls = this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0];
            const rs = this.props.call.getRemoteStreams && this.props.call.getRemoteStreams()[0];
            this.setState({
                localStream: ls || this.state.localStream,
                remoteStream: rs || this.state.remoteStream,
            });
            this._startVideoStatsProbe();
        }
        this.forceUpdate();
    }

    // Diagnostic: periodically dump video receiver stats so we can see
    // what's happening in the M124 receive pipeline. Logs key counters
    // (framesReceived/Decoded/Dropped, keyFramesDecoded, nackCount,
    // pliCount, decoderImplementation) every 5s for the first 30s of
    // the call. Fires regardless of E2EE state — we want raw info on
    // the receive path that's been showing black on this build.
    _startVideoStatsProbe() {
        if (this._videoStatsTimer) return;
        // Disable for production — the periodic getStats() calls can
        // disturb the renderer. Flip back to true when diagnosing.
        const ENABLE_VIDEO_STATS_PROBE = false;
        if (!ENABLE_VIDEO_STATS_PROBE) return;
        const call = this.props.call;
        const pc = call && call._pc;
        if (!pc || typeof pc.getStats !== 'function') return;

        let ticks = 0;
        const dump = async () => {
            ticks += 1;
            try {
                const stats = await pc.getStats(null);
                let inbound = null, outbound = null;
                stats.forEach((r) => {
                    if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
                    if (r.type === 'outbound-rtp' && r.kind === 'video') outbound = r;
                });
                const fmt = (r) => r ? {
                    frR: r.framesReceived,
                    frD: r.framesDecoded,
                    keyF: r.keyFramesDecoded,
                    drop: r.framesDropped,
                    nack: r.nackCount,
                    pli:  r.pliCount,
                    fir:  r.firCount,
                    dec:  r.decoderImplementation,
                    enc:  r.encoderImplementation,
                    bytes: r.bytesReceived || r.bytesSent,
                    ssrc: r.ssrc,
                    codec: r.codecId,
                } : null;
                console.log('[VideoStats]', 't=' + (ticks * 5) + 's',
                            'inbound=', JSON.stringify(fmt(inbound)),
                            'outbound=', JSON.stringify(fmt(outbound)));
            } catch (e) {
                console.log('[VideoStats] getStats failed:', (e && e.message) || e);
            }
            if (ticks >= 6) this._stopVideoStatsProbe();
        };
        // Fire after 5s, then every 5s thereafter (6 ticks = 30s window).
        this._videoStatsTimer = setInterval(dump, 5000);
    }

    _stopVideoStatsProbe() {
        if (this._videoStatsTimer) {
            clearInterval(this._videoStatsTimer);
            this._videoStatsTimer = null;
        }
    }

    zrtpStateChanged(newState) {
        if (this.unmounted) return;
        this.setState({ zrtpState: newState });
    }

    // Fired by CallZrtp.js when zRTP-mandatory mode fails to agree on
    // keys. Surfaces the warning dialog so the user can choose End
    // call (mandatory enforcement honored) or Continue (downgrade to
    // optional behavior — DTLS-only between us and the relay).
    zrtpMandatoryFailed(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[call] [ZRTP] VideoBox received zrtpMandatoryFailed:', info);
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
        this.forceUpdate();
    }

    /** Find the RTCRtpSender carrying the video track on this call's pc. */
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

    /** While the camera-enable prompt is visible the user sees a local
     *  preview rendered from the live track. To prevent that preview from
     *  leaking to the remote BEFORE the user has chosen, we detach the
     *  video track from the RTCRtpSender via replaceTrack(null). The
     *  track stays alive and the local <RTCView> keeps rendering it; only
     *  the wire stream stops carrying video. We re-attach (or drop) the
     *  track based on the user's choice in _onEnableCamera /
     *  _onKeepAudioOnly.
     */
    _enableTrackForPreview() {
        const localStream = this.state.localStream
            || (this.props.call && this.props.call.getLocalStreams && this.props.call.getLocalStreams()[0]);
        if (!localStream || !localStream.getVideoTracks) return;
        const tracks = localStream.getVideoTracks();
        if (tracks.length === 0) return;
        const track = tracks[0];

        // Stash the track so we can re-attach it on Enable; keep a flag
        // for the cleanup paths.
        this._previewVideoTrack = track;
        this._previewTrackWasReEnabled = true;

        // 1. Detach from the wire — peer stops getting frames immediately.
        const sender = this._videoSender();
        if (sender && typeof sender.replaceTrack === 'function') {
            try {
                sender.replaceTrack(null);
                this._previewSender = sender;
            } catch (e) {
                // Best-effort; if replaceTrack isn't supported here we
                // fall back to enabling the track without unhooking,
                // which means brief leak — at least we logged it.
                console.log('VideoBox: sender.replaceTrack(null) failed:', e && e.message);
            }
        }

        // 2. Enable the track so RTCView renders the local preview.
        if (track.enabled === false) track.enabled = true;
    }

    /** Camera-enable prompt actions. */
    _onEnableCamera() {
        // Sticky: don't show the prompt again on this call even if the
        // user backgrounds and returns to the call screen.
        if (this.props.call) this.props.call._sylkCameraPromptHandled = true;
        this.setState({ videoEnableDialogVisible: false });

        // Re-attach the track to the wire so the remote sees video.
        if (this._previewSender && this._previewVideoTrack
            && typeof this._previewSender.replaceTrack === 'function') {
            try { this._previewSender.replaceTrack(this._previewVideoTrack); }
            catch (e) { console.log('VideoBox: re-attach replaceTrack failed:', e && e.message); }
        }
        this._previewSender = null;
        this._previewVideoTrack = null;

        if (this.state.videoMuted && typeof this.toggleVideoMute === 'function') {
            this.toggleVideoMute();
        }
        this._previewTrackWasReEnabled = false;
    }

    _onKeepAudioOnly() {
        // Track stays detached from the sender (replaceTrack was already
        // called with null in _enableTrackForPreview). Disable it so the
        // local preview goes black too, and clear our refs.
        if (this._previewVideoTrack) {
            try { this._previewVideoTrack.enabled = false; } catch (e) {}
        }
        this._previewSender = null;
        this._previewVideoTrack = null;
        this._previewTrackWasReEnabled = false;
        // Sticky: don't show the prompt again on this call even if the
        // user backgrounds and returns to the call screen.
        if (this.props.call) this.props.call._sylkCameraPromptHandled = true;
        this.setState({ videoEnableDialogVisible: false });
    }

    componentDidMount() {
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
            const existing = getZrtpSession(this.state.call);
            if (existing && existing.state) {
                this.setState({ zrtpState: existing.state });
            }

            // Trigger the answer for incoming video calls (mirrors what
            // AudioCallBox does for incoming audio). Previously this
            // happened inside LocalMedia's componentDidMount, which made
            // the user briefly see the preview screen flash by; now we
            // render VideoBox directly and answer from here.
            if (this.state.call.state === 'incoming' && this.props.mediaPlaying) {
                this.props.mediaPlaying();
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

        this.armOverlayTimer();

        if (this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }
    }

    componentWillUnmount() {
        // Release the keep-screen-on we asserted at mount so the
        // OS idle timer resumes once the video UI is torn down.
        // Counterpart to setKeepScreenOn(true) in componentDidMount.
        try { InCallManager.setKeepScreenOn(false); } catch (e) { /* best effort */ }

        this.unmounted = true;
        this._stopVideoStatsProbe();
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
        }

		if (this.state.call != null && this.state.call.statistics != null) {
			this.state.call.statistics.removeListener('stats', this.statistics);
        }

        this._detachLocalVideoTrackListeners();
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

            utils.timestampedLog(
                '[video-track] [call] monitor attached',
                'id=', track.id,
                'enabled=', track.enabled,
                'muted=', track.muted,
                'callUUID=', (this.props.call && this.props.call.id)
            );
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

    get showMyself() {
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
                this.setState({videoMuted: false});
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
				<Menu
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
				<View style={styles.buttonContainer}>
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
						onPress={() => this.setState({
							audioDevicePickerVisible: !this.state.audioDevicePickerVisible,
							// Collapse the video picker when opening (or
							// toggling) the audio picker — only one
							// floating menu should be visible at a time.
							videoPickerVisible: false
						})}
					/>
				</View>
			);
		}

		return null;
	}

    toggleCamera(event) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: this.state.cameraFacing === 'front' ? 'back' : 'front'
            });
        }
    }

    selectCamera(facing) {
        // If video is currently muted, picking a camera should also
        // unmute it — that's the only way out of the muted state from
        // the picker (the Unmute row is hidden when muted).
        if (this.state.videoMuted) {
            this.toggleVideoMute();
        }
        // No-op (apart from the unmute above) if we're already on the
        // requested camera.
        if (facing === this.state.cameraFacing) return;
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: facing
            });
        }
    }

    renderVideoPicker(buttonSize, buttonClass) {
        const facing = this.state.cameraFacing || 'front';
        const muted = this.state.videoMuted;
        const enableMyVideo = this.state.enableMyVideo;
        // Main button reflects the currently active camera. Muted state is
        // shown as a big red X overlay on top of the camera icon so the user
        // knows both *which* camera is active *and* that it's muted.
        const mainIcon = facing === 'front' ? 'camera-front' : 'camera-rear';

        // Pick the swap icon so its diagonal points through the corner
        // where the PIP thumbnail currently sits. Thumb in topLeft or
        // bottomRight → use the "\" diagonal; thumb in topRight or
        // bottomLeft → use the "/" diagonal. That way the arrow's top
        // tip points to the thumb when it's at the top, and its bottom
        // tip points to the thumb when it's at the bottom.
        const corner = this.state.myVideoCorner;
        const swapIcon = (corner === 'topLeft' || corner === 'bottomRight')
            ? 'arrow-top-left-bottom-right-bold'
            : 'arrow-top-right-bottom-left-bold';

        // Build the camera options. When the camera is currently in
        // use (not muted), drop the active one so the user only sees
        // the camera they can switch *to*. When muted, show BOTH so
        // the user can pick which camera to unmute into — tapping
        // either unmutes (and switches if needed) via selectCamera.
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
            .filter(opt => muted || opt.facing !== facing)
            .map(opt => ({
                key: opt.key,
                icon: opt.icon,
                label: opt.label,
                onPress: () => this.selectCamera(opt.facing)
            }));

        // The picker rows are *actions*, not radio choices — there is
        // no persistent "selected" highlight. The icon/label of each
        // row already reflects the next state (e.g. "Hide Myself" vs
        // "Show Myself", "Mute Camera" hidden when muted), which is
        // enough to communicate current state.
        const items = [
            ...cameraOptions,
            // Hide the Unmute row entirely when muted — the only way to
            // unmute from the picker is to choose one of the camera
            // options above.
            ...(muted ? [] : [{
                key: 'mute',
                icon: 'video-off',
                label: 'Mute Camera',
                onPress: () => this.toggleVideoMute()
            }]),
            {
                key: 'myself',
                icon: enableMyVideo ? 'eye-off' : 'eye',
                label: enableMyVideo ? 'Hide Myself' : 'Show Myself',
                onPress: () => this.toggleMyVideo()
            },
            {
                key: 'swap',
                // Diagonal two-headed arrow — chosen so its diagonal
                // passes through the corner where the PIP thumbnail
                // currently sits (see swapIcon computation above).
                icon: swapIcon,
                label: 'Swap Video',
                onPress: () => this.swapVideo()
            },
            {
                key: 'aspect',
                icon: 'aspect-ratio',
                label: 'Aspect Ratio',
                onPress: () => this.toggleAspectRatio()
            }
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
                            <Icon
                                name="close-thick"
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
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall() {
        this.props.hangupCall('user_cancel_call');
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
        this.setState({enableMyVideo: !this.state.enableMyVideo});    
    }

    swapVideo() {
        if (!this.state.swapVideo) {
			this.setState({enableMyVideo: false});    
        }
        this.setState({swapVideo: !this.state.swapVideo});    
    }
    
    get localStreamUrl() {
		if (this.state.swapVideo) {
			return this.state.remoteStream ? this.state.remoteStream.toURL() : null
        }
		return this.state.localStream ? this.state.localStream.toURL() : null;
    }

    get remoteStreamUrl() {
		if (this.state.swapVideo) {
			return this.state.localStream ? this.state.localStream.toURL() : null;
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

        let disablePlus = true;
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
        }

        const show = this.state.callOverlayVisible || this.state.reconnectingCall;

        const myVideoCorner = this.state.myVideoCorner;

        let container = styles.container;
        let remoteVideoContainer = styles.remoteVideoContainer;
        let buttonsContainer = styles.buttonsContainer;
        let video = styles.video;

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonsContainerClass}>
                {!disablePlus ?
                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        onPress={this.props.inviteToConferenceFunc}
                        icon="account-plus"
                    />
                </View>
                : null}

                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        onPress={this.muteAudio}
                        icon={muteButtonIcons}
                    />
                </View>

                {/* Single video picker button: tapping it shows a floating
                    panel with Front/Back Camera, Mute, Hide Myself, Swap
                    Video and Aspect Ratio. The bar icon itself reflects
                    the active camera (front/back) and overlays a red X
                    when the camera is muted. */}
                {this.renderVideoPicker(buttonSize, buttonClass)}

                {this.renderAudioDevicePicker(buttonSize, buttonClass)}

                <View style={[styles.buttonContainer, {marginLeft: 30}]}>
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass, styles.hangupButton]}
                        onPress={this.hangupCall}
                        icon="phone-hangup"
                    />
                </View>
            </View>);
            // The local PIP thumbnail wrapper uses zIndex: 1000, so the
            // buttons View (which hosts the floating video/audio picker
            // panels) must sit above it for the panels to render on top
            // of the thumbnail when they overlap.
            buttons = (
                <View style={[buttonsContainer, {zIndex: 2000, elevation: 30}]}>
                    {content}
                </View>
            );
        }
        
        const debugBorderWidth = 0;
        const headerBarHeight = 60;

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
			bottom: this.state.fullScreen ? -bottomInset : 0,
			borderWidth: debugBorderWidth,
			borderColor: 'red',
			width: '100%',
			height: '100%',
//			width: this.state.fullScreen ? width + rightInset : width,
//			height: this.state.fullScreen ? height : height - headerBarHeight - bottomInset - topInset
		};

		if (this.state.isLandscape) {
			remoteVideoContainer.width = this.state.fullScreen ? width : width - rightInset - leftInset;
		}

		if (Platform.OS === 'ios') {
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
		}
		
		// Self-video thumbnail dimensions. On the Razr cover display we
		// have very little real estate, so shrink the picture-in-picture
		// to roughly half size. The outer wrapper (below) uses the same
		// numbers so the surface and its hit target stay aligned.
		const selfThumbWidth  = this.props.isFolded ? 72 : 120;
		const selfThumbHeight = this.props.isFolded ? 96 : 160;
		const selfSurfaceHeight = this.props.isFolded ? 54 : 90;

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
			+ '-' + this.state.myVideoCorner;

        // ZRTP indicator overlay — pill anchored above the call buttons.
        // Hidden together with the buttons when the overlay is collapsed
        // (full-screen video) so the encryption indicator doesn't float
        // alone on screen. Only shown once the key has been agreed —
        // the intermediate "negotiating" stage stays hidden so the user
        // doesn't see a transient yellow pill on every call setup.
        const renderZrtpBadge = () => {
            if (!this.state.callOverlayVisible) {
                return null;
            }
            if (this.state.zrtpState !== 'key-agreed') {
                return null;
            }
            let bg, label;
            const status = this._zrtpVerificationStatus();
            if (status === 'verified') {
                bg = 'rgba(0, 170, 80, 0.9)';
                label = '🔒 zRTP verified';
            } else if (status === 'mismatch') {
                bg = 'rgba(200, 30, 30, 0.9)';
                label = '⚠ SAS changed';
            } else {
                bg = 'rgba(230, 120, 0, 0.95)';
                label = '🔒 zRTP end-to-end encrypted';
            }
            const isTappable = this.state.zrtpState === 'key-agreed';
            const inner = (
                <View style={{
                    backgroundColor: bg,
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                }}>
                    <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{label}</Text>
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
                    {isTappable ? (
                        <TouchableOpacity onPress={this._onZrtpBadgePress}>{inner}</TouchableOpacity>
                    ) : inner}
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
                </View>
            );
        };

        const zrtpSession = this.state.zrtpDialogVisible ? getZrtpSession(this.state.call) : null;
        const zrtpSas = zrtpSession && zrtpSession.sas;
        const verificationStatus = this._zrtpVerificationStatus();
        const zrtpStored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;

        return (
            <View style={styles.container}>
                <Portal>
                    {this.state.videoEnableDialogVisible && (() => {
                        const _topInset = (this.state.insets && this.state.insets.top) ? this.state.insets.top : 24;
                        const _bottomInset = (this.state.insets && this.state.insets.bottom) ? this.state.insets.bottom : 0;
                        // Reserve room for the call's Appbar.Header so the
                        // caller name + kebab menu stay visible while the
                        // user is deciding on the camera. headerBarHeight
                        // matches what the rest of VideoBox uses for that
                        // bar (kept in sync with the constant near render()).
                        const _headerBarHeight = 60;
                        const localStreamUrl = this.state.localStream && this.state.localStream.toURL
                            ? this.state.localStream.toURL()
                            : null;
                        return (
                            <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
                                {/* Dim backdrop — starts BELOW the navbar so the caller
                                    name and menu remain readable. Blocks taps on the
                                    video underneath, but lets header taps pass through. */}
                                <View style={{position:'absolute', top: _topInset + _headerBarHeight, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.55)'}} pointerEvents="auto" />

                                {/* Local camera preview — fills the screen above the bottom panel.
                                    Uses top + bottom anchors so the rectangle stretches to use
                                    all available space; objectFit:'cover' fills with the video.
                                    A small camera-switch button overlays the top-right corner
                                    so the user can flip front/back before committing. */}
                                {localStreamUrl && (
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
                                        <RTCView
                                            objectFit="cover"
                                            streamURL={localStreamUrl}
                                            mirror={this.state.cameraFacing !== 'back'}
                                            style={{flex: 1}}
                                        />
                                        {/* Camera-flip button — top-right of the preview. */}
                                        <View style={{
                                            position: 'absolute',
                                            top: 8,
                                            right: 8,
                                            backgroundColor: 'rgba(0,0,0,0.55)',
                                            borderRadius: 24,
                                        }}>
                                            <IconButton
                                                icon="camera-flip"
                                                size={24}
                                                color="#ffffff"
                                                onPress={() => {
                                                    // Same logic as renderVideoPicker's swap:
                                                    // toggle front/back via the local track and
                                                    // mirror the preview accordingly.
                                                    const localStream = this.state.localStream;
                                                    if (localStream && localStream.getVideoTracks().length > 0) {
                                                        const track = localStream.getVideoTracks()[0];
                                                        try { track._switchCamera(); } catch (e) {}
                                                        this.setState({
                                                            cameraFacing: this.state.cameraFacing === 'front' ? 'back' : 'front',
                                                        });
                                                    }
                                                }}
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
                                )}

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
                                    <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
                                        <Button onPress={this._onKeepAudioOnly}>Audio only</Button>
                                        <Button mode="contained" onPress={this._onEnableCamera} style={{marginLeft: 8}}>Enable camera</Button>
                                    </View>
                                </View>
                            </View>
                        );
                    })()}
                    <Dialog
                        visible={this.state.zrtpDialogVisible}
                        onDismiss={() => this.setState({ zrtpDialogVisible: false })}
                    >
                        <Dialog.Title>Verify zRTP encryption</Dialog.Title>
                        <Dialog.Content>
                            <PaperText style={{ marginBottom: 12 }}>
                                {`Compare these with ${this.state.remoteDisplayName || this.state.remoteUri || 'the other party'}. Both phones must show the same letters AND emojis.`}
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
                                    ✓ Previously verified on {new Date(zrtpStored.verifiedAt).toLocaleString()}
                                </PaperText>
                            )}
                            {verificationStatus === 'mismatch' && zrtpStored && (
                                <PaperText style={{ color: 'red', marginTop: 8 }}>
                                    ⚠ The other party's identity key has changed since the last verification on {new Date(zrtpStored.verifiedAt).toLocaleString()}. Re-verify carefully before tapping Match.
                                </PaperText>
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
                            <PaperText>
                                The zRTP key exchange did not complete. You set
                                encryption to "mandatory" in Preferences, but the
                                other party may not support it.
                                {'\n\n'}
                                You can end the call now, or continue without
                                end-to-end encryption. The call will still be
                                encrypted between your phone and the SylkServer
                                relay (DTLS), but the relay can read the media.
                            </PaperText>
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
                {renderZrtpBadge()}
                <CallOverlay
                    show = {show}
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
                />

                {this.showRemote?
					<View style={[container, remoteVideoContainer]}>
					  <RTCView
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
						key={this._remoteRtcMountKey}
						objectFit={this.state.aspectRatio}
						style={styles.video}
						streamURL={this.remoteStreamUrl}
					  />
					  <TouchableWithoutFeedback onPress={this.toggleFullScreen}>
						<View style={StyleSheet.absoluteFillObject} />
					  </TouchableWithoutFeedback>
					</View>
				: null }


                {this.showMyself ?
				  <View
					key={'vb-myself-wrap-' + _videoRemountKey}
					style={myselfContainer}
				  >
					<View
					  key={'vb-myself-pos-' + _videoRemountKey}
					  style={{
						position: 'absolute',
						width: selfThumbWidth,
						height: selfThumbHeight,
						...corner,
					  }}
					>
					  <TouchableOpacity
						style={{ flex: 1 }}
						onPress={() => {
						  const currentIndex = cornerOrder.indexOf(this.state.myVideoCorner);
						  const nextIndex = (currentIndex + 1) % cornerOrder.length;
						  this.setState({ myVideoCorner: cornerOrder[nextIndex] });
						}}
					  >
					  <Surface key={'vb-myself-surf-' + _videoRemountKey} style={mySurfaceContainer}>
						<RTCView
							key={'vb-myself-rtc-' + _videoRemountKey}
							objectFit='cover'
							style={styles.video}
							ref={this.localVideo}
							streamURL={this.localStreamUrl}
							mirror={this.state.mirror}
						/>
					</Surface>
					  </TouchableOpacity>
					</View>

				  </View>
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

                {buttons}

                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
                    selectedContacts={this.state.selectedContacts}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />

                {/* Fullscreen-only network HUD. Two states:
                    - Hidden behind a small "i" info icon (default).
                    - User taps the icon → speedometer expands.
                    - User taps the speedometer → collapses back to icon.
                    Both elements share the same top-right anchor. */}
                {this.state.fullScreen && this.state.call && !this.state.videoEnableDialogVisible ? (
                    <View
                        style={{
                            position: 'absolute',
                            top: (this.state.insets.top || 0) + 16,
                            right: (this.state.insets.right || 0) + 4,
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
                                    videoCodec={this.props.videoCodec}
                                    audioCodec={this.props.audioCodec}
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
