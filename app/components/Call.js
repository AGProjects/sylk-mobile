import React, { Component } from 'react';
import { View, StyleSheet } from 'react-native';
import DeferredRTCView from './DeferredRTCView';
import { Button, IconButton, Text as PaperText } from 'react-native-paper';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import uuid from 'react-native-uuid';

import AudioCallBox from './AudioCallBox';
import LocalMedia from './LocalMedia';
import VideoBox from './VideoBox';
import utils from '../utils';
import { startZrtpForCall, ZRTP_CONTENT_TYPE,
         ZRTP_CAPABILITY_HEADER_NAME, ZRTP_CAPABILITY_HEADER_VALUE,
         peerSupportsZrtpFromHeaders, shouldAdvertiseZrtpCapability,
         reapplyVideoEncoderParams, getVideoEncoderTarget } from './CallZrtp';

// Media-loss watchdog. Polls pc.getStats() every MEDIA_LOSS_POLL_MS and
// sums packetsReceived across all inbound-rtp reports. If the sum has not
// increased for MEDIA_LOSS_THRESHOLD_MS, the media plane is considered
// dead. Caller side (direction === 'outgoing') triggers a redial through
// the existing 'outgoing_connection_failed' path in app.js. Callee side
// (direction === 'incoming') signals the caller with an in-session
// MEDIA_LOST_CONTENT_TYPE message every poll while the loss persists;
// caller redials on receipt of that message via the same hangup path.
// The 15 s threshold is well above any normal RTP keepalive cadence
// (Opus DTX comfort-noise frames still tick packetsReceived) so brief
// network blips don't cause spurious redials.
export const MEDIA_LOST_CONTENT_TYPE = 'application/sylk-media-lost';
const MEDIA_LOSS_POLL_MS = 2000;
const MEDIA_LOSS_THRESHOLD_MS = 15000;

// Custom header carrying the client identity end-to-end.
//
// The real SIP User-Agent header cannot be used for this: Janus's SIP
// plugin sets its own User-Agent on outgoing requests (from
// janus.plugin.sip.jcfg user_agent), so adding another would produce a
// duplicate — and on the RECEIVING side Sofia-SIP parses User-Agent
// into a typed field that never lands in the unknown-header list Janus
// forwards, so it would be invisible to the callee anyway (see the
// NOTE on incomingHeaderPrefixes in app.js). Mirroring it in an X-
// header rides the existing X-* pass-through instead: it survives
// Janus → OpenSIPS → Janus and surfaces in call.headers on the peer.
export const USER_AGENT_HEADER_NAME = 'X-Sylk-User-Agent';

// Build getUserMedia constraints for the audio→video upgrade path
// that match the initial-video path's profile (set once at app
// startup via setVideoEncoderTarget in app.js). Previously the
// upgrade calls in startVideo / onUpdateRequest issued
// getUserMedia({ video: true }) with no resolution / framerate
// hints, which let phone camera drivers default to their preferred
// native capture mode — commonly 1088x1088 / 30 fps on Android
// "square selfie" cameras or 1920x1080 / 30 fps on iOS. The result
// was that an audio call escalated to video produced a noticeably
// different on-wire resolution and framerate than a call that
// started as video. Pulling the profile in via getVideoEncoderTarget
// (defined in CallZrtp.js, where the libwebrtc-side caps live)
// avoids a circular Call.js → app.js import and keeps the two paths
// in lockstep.
const _buildUpgradeVideoConstraints = () => {
    const target = getVideoEncoderTarget() || {};
    const w  = target.width     != null ? target.width     : 640;
    const h  = target.height    != null ? target.height    : 480;
    const fr = target.frameRate != null ? target.frameRate : null;
    const video = {
        // ideal+max pair — `max` is what actually pins phone camera
        // drivers; `ideal` alone is routinely ignored when the driver
        // has a preferred capture mode it wants to default to. Same
        // shape as getLocalMedia in app.js so a profile change there
        // propagates here automatically.
        width:  { ideal: w, max: w },
        height: { ideal: h, max: h },
    };
    if (fr != null) {
        video.frameRate = { ideal: fr, max: fr };
    }
    return { audio: false, video };
};

// import {
//   ConnectionStateChangedEvent,
//   ConnectionEventTypes,
//   ProofAttributeInfo,
//   ProofEventTypes,
//   AttributeFilter
// } from '@aries-framework/core';
//
function randomIntFromInterval(min,max)
{
    return Math.floor(Math.random()*(max-min+1)+min);
}


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.samples = 30;
        this.sampleInterval = 3;

        this.defaultWaitInterval = 60; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        this.mediaLost = false;

        // Media-loss watchdog state (see MEDIA_LOST_CONTENT_TYPE comment).
        // _mediaLossPoller     : setInterval handle
        // _mediaLossLastPackets: last summed inbound-rtp packetsReceived
        // _mediaLossLastTickTs : wall-clock ts of the last sum increase
        // _mediaLossActive     : true while currently in the lost state
        //                        (drives the per-poll re-emit on the callee)
        // _mediaLossRedialFired: idempotency guard on the caller so the
        //                        local watchdog and an incoming
        //                        sylk-media-lost message don't redial twice
        this._mediaLossPoller = null;
        this._mediaLossLastPackets = 0;
        this._mediaLossLastTickTs = 0;
        this._mediaLossActive = false;
        this._mediaLossRedialFired = false;
        // In-flight guard so a slow getStats can't let watchdog ticks
        // overlap and leak pending native callbacks.
        this._mediaLossInFlight = false;
        this._mediaLossInFlightSince = 0;

        let callUUID;
        let remoteUri = '';
        let remoteDisplayName = '';
        let remoteUserAgent = null;
        let callState = null;
        let direction = null;
        let callEnded = false;
        this.ended = false;
        this.answering = false;
        this.mediaIsPlaying = false;

        if (this.props.call) {
            // If current call is available on mount we must have incoming.
            // Detect peer ZRTP capability from the caller's INVITE headers,
            // which sylkrtc has already populated on call.headers.
            this._detectPeerZrtpCapability(this.props.call, this.props.call.headers, 'INVITE');
            // For an incoming call the offer SDP (with its s= session
            // name) is already on call._incomingSdp; capture the remote
            // client identity for display on the call screen.
            remoteUserAgent = this._extractRemoteUserAgent(this.props.call);
            this.props.call.on('stateChanged', this.callStateChanged);
            this.props.call.on('incomingMessage', this.incomingMessage);
            // Mid-call renegotiation events emitted by react-native-sylkrtc
            // (audio -> audio+video upgrade via Janus SIP plugin "update"):
            //   mediaUpdated  : a renegotiation completed; payload tells
            //                   us whether local and remote sides now
            //                   carry video, so we can flip audioOnly
            //                   and let render() swap AudioCallBox out
            //                   for VideoBox.
            //   updateRequest : peer initiated a re-INVITE that added
            //                   media. The library has already applied
            //                   the remote offer; we capture local
            //                   video (if any) and call answerUpdate().
            //   updateFailed  : something went wrong on either side of
            //                   the renegotiation — log and keep
            //                   running on the current media set.
            this.props.call.on('mediaUpdated', this.onMediaUpdated);
            this.props.call.on('updateRequest', this.onUpdateRequest);
            this.props.call.on('updateFailed', this.onUpdateFailed);
            utils.timestampedLog('[message] [call] [zrtp] attached incomingMessage handler to call (mount)',
                'call_id=', this.props.call._callId || this.props.call.callId || this.props.call.id,
                'peer=', this.props.call.remoteIdentity && this.props.call.remoteIdentity.uri,
                'inlineMessaging=', !!this.props.call.enableInlineMessaging);
            // For OUTGOING calls, prefer props.targetUri (canonical
            // `+40…@sylk.link`) over call.remoteIdentity.uri (wire
            // form `0040…@sylk.link` after the pstnRules.replacePlus
            // rewrite at the SIP boundary). The user dialed the
            // canonical number; the rewrite is an implementation
            // detail of the gateway path and should not surface in
            // the call screen. For INCOMING calls keep using
            // remoteIdentity.uri — that's the canonical SIP URI of
            // the caller as the server reported it.
            direction = this.props.call.direction;
            if (direction === 'outgoing' && this.props.targetUri) {
                remoteUri = this.props.targetUri;
            } else {
                remoteUri = this.props.call.remoteIdentity.uri;
            }
            callState = this.props.call.state;
            // pickRealName: returns the first candidate that's a "real" display
            // name — i.e. not empty, not equal to the URI, not equal to the
            // URI's local part. Auto-created contacts are stored with
            // `name = localPart` (e.g. "living233"), which has the same
            // information value as no name at all; preferring the SIP From
            // header's display name in that case shows "My living" on the
            // call screen instead of the URI fragment. Matches the spec
            // applied in app.js's applyPushDisplayName.
            const _localPart = (remoteUri && remoteUri.indexOf('@') > -1)
                ? remoteUri.split('@')[0]
                : remoteUri;
            const _isRealName = (n) => !!(n
                && typeof n === 'string'
                && n.toLowerCase() !== (remoteUri || '').toLowerCase()
                && n.toLowerCase() !== (_localPart || '').toLowerCase());
            const _pickRealName = (...candidates) => {
                for (const c of candidates) { if (_isRealName(c)) return c; }
                // Fall back to the first non-empty so we still render
                // *something* if nothing is "real" — keeps the previous
                // behaviour at the bottom of the chain.
                for (const c of candidates) { if (c) return c; }
                return null;
            };
            remoteDisplayName = _pickRealName(
                this.props.callContact?.name,
                this.props.call?.remoteIdentity?.displayName,
                this.props.call?.remoteIdentity?.uri
            );
            callUUID = this.props.call.id;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.callContact?.name || this.props.targetUri;
            callUUID = this.props.callUUID;
            direction = callUUID ? 'outgoing' : 'incoming';
        }

        if (this.props.connection) {
            //console.log('Added listener for connection', this.props.connection);
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            audioOnly = true;
        }
        // If the call was upgraded from audio to audio+video mid-session
        // (Janus SIP plugin "update" / SIP re-INVITE flow), addVideo()
        // captures a fresh MediaStream and addTrack's it directly to the
        // existing RTCPeerConnection — it deliberately does NOT replace
        // props.localMedia, because that state belongs to the app and is
        // the *initial* media we started the call with. The first check
        // above will therefore still say "audio only" on every remount
        // (e.g., after navigating away and back via the pulsing call
        // icon in the navbar), and we'd render AudioCallBox over a call
        // that actually carries video. Detect that case by asking the
        // call object directly: getLocalStreams()[0] reflects the live
        // PC senders (post-upgrade it has a video track), and
        // remoteMediaDirections.video reflects the negotiated remote
        // direction (post-upgrade it's sendrecv, not absent/inactive).
        if (audioOnly && this.props.call) {
            const localStreams = this.props.call.getLocalStreams && this.props.call.getLocalStreams();
            const hasLocalVideo =
                localStreams && localStreams[0]
                && localStreams[0].getVideoTracks
                && localStreams[0].getVideoTracks().length > 0;
            const remoteDirs = this.props.call.remoteMediaDirections;
            const hasRemoteVideo =
                remoteDirs && remoteDirs.video
                && remoteDirs.video.some(d => d && d !== 'inactive');
            if (hasLocalVideo || hasRemoteVideo) {
                audioOnly = false;
            }
        }

        this.state = {
                      call: this.props.call,
                      targetUri: this.props.targetUri,
                      audioOnly: audioOnly,
                      // User-initiated view override, independent of the
                      // negotiated media. When a call carries video
                      // (audioOnly === false) the user can still choose to
                      // look at the audio call layout via the CallOverlay
                      // "Switch to audio view" menu item. The media is NOT
                      // renegotiated — the video tracks stay live on the
                      // peer connection — we simply render AudioCallBox
                      // instead of VideoBox. Toggling back (or the call
                      // dropping to true audio-only, see onMediaUpdated)
                      // clears this. Only meaningful while audioOnly is
                      // false; on a genuine audio call there's nothing to
                      // switch to.
                      forceAudioView: false,
                      boo: false,
                      remoteUri: remoteUri,
                      remoteDisplayName: remoteDisplayName,
                      remoteUserAgent: remoteUserAgent,
                      localMedia: this.props.localMedia,
                      connection: this.props.connection,
                      accountId: this.props.account ? this.props.account.id : null,
                      account: this.props.account,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID,
                      reconnectingCall: this.props.reconnectingCall,
                      speakerPhoneEnabled: this.props.speakerPhoneEnabled,
                      info: '',
                      messages: this.props.messages,
                      selectedContact: this.props.selectedContact,
                      callContact: this.props.callContact,
                      selectedContacts: this.props.selectedContacts,
                      callEndReason: null,
                      // True only for a fresh outgoing call that's
                      // waiting on the user's explicit "Start audio
                      // call" tap. When we re-enter /call as a
                      // reconnect after outgoing_connection_failed,
                      // the user already started the call; pretending
                      // otherwise would re-render the awaiting UI
                      // and restart the 6-second auto-start countdown.
                      //
                      // Also true when this is a remount of a Call
                      // subtree mid-dial. app.js keys <Call> on
                      // activeCall.id (with a 'no-call' fallback
                      // before the SIP Call object lands), so the
                      // moment account.call() returns and currentCall
                      // gets set, the key flips and this constructor
                      // runs again on a fresh instance. props.call
                      // being non-null on mount means there is
                      // already a SIP call in flight — the user has
                      // unambiguously committed. Without this branch
                      // the fresh state.userStartedCall would be
                      // false, awaiting would compute true once the
                      // call terminates and state.call goes null, and
                      // AudioCallBox / LocalMedia would fire a brand-
                      // new auto-start countdown on the post-call
                      // screen.
                      // skipCountdown: the parent marked this outgoing
                      // call as pre-committed — e.g. started by the
                      // Bluetooth-headset redial hotkey or another
                      // handsfree path — so the camera-preview
                      // Start-call countdown must not gate the INVITE:
                      // go straight to making the call. Mirrors the
                      // Conference component's skipCountdown prop.
                      userStartedCall: this.props.reconnectingCall === true
                          || this.props.skipCountdown === true
                          || this.props.call != null,
                      // Mid-call audio→video upgrade prompt state.
                      // upgradePromptMode = 'outgoing' when the user
                      // tapped +video, 'incoming' when the peer sent
                      // a re-INVITE that adds m=video. While the
                      // prompt is visible NO SIP renegotiation has
                      // started — we only call addVideo() /
                      // answerUpdate() when the user explicitly taps
                      // "Enable camera". Cancel stops the captured
                      // track and leaves the call audio-only.
                      upgradePromptMode: null,        // 'outgoing' | null (incoming auto-accepts)
                      upgradePromptStream: null,      // MediaStream
                      cameraInitiallyMuted: false,
                      // Front (mirrored) vs back camera in the prompt
                      // preview. Toggled by the flip IconButton; flips
                      // the captured track in place via _switchCamera
                      // so we don't have to re-acquire a stream.
                      upgradePromptFacing: 'front',
                      availableAudioDevices: this.props.availableAudioDevices,
                      selectedAudioDevice: this.props.selectedAudioDevice,
                      iceServers: this.props.iceServers,
                      insets: this.props.insets,
                      isLandscape: this.props.isLandscape,
                      }
    }

    componentDidMount() {
        this.lookupContact();

        // !this.state.call: skip startCallWhenReady when a SIP call
        // object is already live. app.js keys <Call> on activeCall.id
        // ('no-call' → call.id), so the moment account.call() returns
        // and currentCall gets set, the key flips and this whole subtree
        // remounts on a fresh instance with props.call already populated.
        // Without this guard, the remount's componentDidMount would fire
        // startCallWhenReady → start() → account.call() AGAIN with the
        // same options.id, sending a duplicate session-create. The
        // server rejects the second one with "Session ID … already in
        // use" and the call terminates as a sendCall_request_error
        // before ringing even starts. Mirrors the same !this.props.call
        // guard LocalMedia.js uses around its auto-start countdown.
        if (this.state.direction === 'outgoing'
            && this.state.callUUID
            && this.state.callState !== 'established'
            && !this.state.call) {
            utils.timestampedLog('[call] start', this.state.callUUID, 'when ready to', this.state.targetUri);
            this.startCallWhenReady(this.state.callUUID);
        } else if (this.state.direction === 'outgoing'
            && this.state.callUUID
            && this.state.call) {
            utils.timestampedLog('[call] componentDidMount skip startCallWhenReady — call already in flight',
                'callUUID=', this.state.callUUID,
                'callState=', this.state.call && this.state.call.state);
        }

        if (this.state.direction === 'incoming') {
            this.mediaPlaying();
        }
    }

    componentWillUnmount() {
        this.ended = true;
        this.answering = false;
        this._cancelUpgradePromptTimer();
        // Stop the media-loss watchdog before any teardown so a poll
        // tick can't fire against a half-detached call object.
        this._stopMediaLossPoller();

        // If the user has the upgrade prompt open and navigates away
        // from /call, stop the captured camera track so the indicator
        // light doesn't stay on. We don't try to answer a pending
        // remote re-INVITE here — the call object outlives this
        // component and the next /call mount will pick up the
        // updateRequest event again if it arrives.
        if (this.state.upgradePromptStream) {
            try {
                this.state.upgradePromptStream.getTracks().forEach(t => t.stop());
            } catch (e) { /* ignore */ }
        }

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
            // Symmetric to the listeners attached in the constructor
            // and in componentWillReceiveProps. Forgetting these would
            // leak references to the unmounted component and re-fire
            // setState() on a dead component during the next
            // renegotiation (which would log a React warning).
            this.state.call.removeListener('mediaUpdated', this.onMediaUpdated);
            this.state.call.removeListener('updateRequest', this.onUpdateRequest);
            this.state.call.removeListener('updateFailed', this.onUpdateFailed);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }
    }

    // Build the extra X- headers attached to what we send out: the
    // outgoing INVITE (placing a call) or the 200 OK (answering one).
    // Central place so both directions stay symmetric:
    //   - X-Sylk-ZRTP capability advert (only when the local encryption
    //     mode will actually run the handshake — see
    //     shouldAdvertiseZrtpCapability in CallZrtp.js)
    //   - X-Sylk-User-Agent with the local client identity, always
    // The identity string is NOT rebuilt here: app.js already computes
    // the canonical USER_AGENT constant (e.g. "Blink Mobile 1.2.3
    // (motorola razr 60 ultra on Android 15)") — the same one shown in
    // NavigationBar and attached to QoS reports — and passes it down as
    // the userAgent prop, so all surfaces stay in lockstep.
    // Logs the full set so the wire content is visible in applog next
    // to the 'extra SIP headers from sylk-server' receive-side lines.
    // `source` is just the log label: 'INVITE' or '200 OK'.
    _buildOutgoingHeaders(source) {
        const headers = [];
        if (shouldAdvertiseZrtpCapability()) {
            headers.push({name: ZRTP_CAPABILITY_HEADER_NAME, value: ZRTP_CAPABILITY_HEADER_VALUE});
        }
        const localUserAgent = (this.props.userAgent || '').trim();
        if (localUserAgent) {
            headers.push({name: USER_AGENT_HEADER_NAME, value: localUserAgent});
        }
        const _cid = (this.state.call
            && (this.state.call._callId || this.state.call.callId || this.state.call.id))
            || this.state.callUUID || '?';
        try {
            const dump = headers.map(h => h.name + '=' + h.value).join('; ');
            utils.timestampedLog('[call] [headers] call_id=' + _cid,
                'extra SIP headers sent on ' + source + ': ' + dump);
        } catch (e) {
            // logging must never break call setup
        }
        return headers;
    }

    // Parse the X-Sylk-ZRTP header out of the given headers payload and,
    // if present + parseable, stash a non-null capability descriptor on
    // the sylkrtc Call as call._peerSupportsZrtp. startZrtpForCall and
    // dispatchIncomingZrtp (in CallZrtp.js) gate their behaviour on this
    // flag — handshake only runs when both ends have signaled support.
    //
    // `source` is just a label for the log line: 'INVITE' for the
    // caller-side advertisement (read at mount / cwrp), '200 OK' for the
    // callee's response (read in callStateChanged when newState=='accepted').
    // Once set, we don't downgrade: a present-then-absent transition
    // should never happen on a single call.
    _detectPeerZrtpCapability(call, headers, source) {
        if (!call) return;
        // Surface every X-* / capability header sylk-server passed through
        // from the SIP signalling. Useful to confirm the
        // 'incoming_header_prefixes' = ['X-'] register option is
        // working end-to-end (Sylk Mobile → sylk-server → Janus →
        // incoming INVITE). Logged before the capability-detection log
        // so the raw input is visible even when peerSupportsZrtpFromHeaders
        // returns null.
        const callIdStr = (call._callId || call.callId || call.id);
        if (headers && headers.length) {
            try {
                const dump = headers
                    .map(h => (h && h.name ? (h.name + '=' + (h.value !== undefined ? h.value : '')) : String(h)))
                    .join('; ');
                utils.timestampedLog('[call] [zrtp] call_id=' + callIdStr,
                    'extra SIP headers from sylk-server on ' + source + ': ' + dump);
            } catch (e) {
                utils.timestampedLog('[call] [zrtp] call_id=' + callIdStr,
                    'extra SIP headers from sylk-server on ' + source + ': <unprintable: ' + e + '>');
            }
        } else {
            utils.timestampedLog('[call] [zrtp] call_id=' + callIdStr,
                'no extra SIP headers received from sylk-server on ' + source
                + ' (Janus may have stripped them, or the account-add request did not request X-* prefixes)');
        }
        const cap = peerSupportsZrtpFromHeaders(headers);
        if (cap !== null) {
            call._peerSupportsZrtp = cap;
            utils.timestampedLog('[call] [zrtp] call_id=' + callIdStr,
                'peer signaled X-Sylk-ZRTP capability v=' + cap.version
                + ' suites=' + (cap.suites.join(',') || '?')
                + ' on ' + source);
        }
    }

    // Pull the remote party's client identity off the call.
    //
    // The obvious source — the SIP User-Agent / Server header — is NOT
    // reachable from here: Janus's SIP plugin only forwards CUSTOM
    // (unknown) headers in its event `headers` map, and Sofia-SIP parses
    // User-Agent/Server into typed fields that never land in that list.
    // Janus confirms this with `"headers": {}` on the incoming-session
    // event even when the peer sent a User-Agent.
    //
    // What DOES survive the bridge is the SDP session-name (s=) line.
    // Janus passes it through verbatim from the remote offer/answer, e.g.
    // `s=Blink 9.3.2 (MacOSX)`. The source SDP differs by direction:
    //
    //   INCOMING call: the remote is the CALLER. Its identity is in the
    //   offer SDP, available immediately as call._incomingSdp (set in
    //   sylkrtc's _initIncoming).
    //
    //   OUTGOING call: the remote is the CALLEE. Its identity is in the
    //   ANSWER SDP. sylkrtc emits stateChanged('accepted') BEFORE it runs
    //   setRemoteDescription(answer), so the answer is NOT yet on the PC
    //   at 'accepted'; it only lands once setRemoteDescription resolves,
    //   which is exactly when 'established' is emitted. So for outgoing we
    //   read call._pc.remoteDescription.sdp and must do it at/after
    //   'established', not at 'accepted'.
    //
    // We therefore pick the source by direction: the answer
    // (remoteDescription) first for an outgoing call, the offer
    // (_incomingSdp) first for an incoming one, with the other as a
    // fallback.
    //
    // Not every client sets a meaningful s= — RFC 4566 allows a bare
    // `s=-`, and plain browser WebRTC offers usually do exactly that. We
    // treat '-', empty, and Janus's own placeholder as "no name" so we
    // never show a meaningless string.
    _extractRemoteUserAgent(call) {
        if (!call) {
            return null;
        }

        // Preferred source: the peer's X-Sylk-User-Agent header, which Sylk
        // Mobile now sends on both the INVITE and the 200 OK (see
        // _buildOutgoingHeaders). The header list MUST be chosen by
        // direction, because sylkrtc's call.headers is direction-dependent:
        //
        //   INCOMING call: call.headers holds the REMOTE caller's INVITE
        //   headers (sylkrtc's _initIncoming sets _headers from the
        //   incoming-session event). This IS the peer's identity.
        //
        //   OUTGOING call: call.headers holds OUR OWN INVITE headers
        //   (sylkrtc's _initOutgoing does `this._headers = options.headers`,
        //   i.e. the exact array _buildOutgoingHeaders produced, including
        //   our local X-Sylk-User-Agent). Reading it here would echo the
        //   LOCAL client identity back as if it were the remote's — the
        //   bug this guard prevents. The peer's identity on an outgoing
        //   call lives only in call._acceptedHeaders (the 200 OK response
        //   headers, stashed in callStateChanged on the 'accepted' event).
        //
        // So: outgoing → 200 OK headers only; incoming → INVITE headers
        // only. When the chosen list carries no X-Sylk-User-Agent (e.g. a
        // plain SIP callee, or SylkServer answering with only its Server
        // header and no X-Sylk-User-Agent), we fall through to the SDP s=
        // sniffing below — which yields the correct remote token such as
        // 's=SylkServer-6.7.0'.
        const outgoingCall = call.direction === 'outgoing';
        const headerLists = outgoingCall
            ? [call._acceptedHeaders]
            : [call.headers];
        for (const list of headerLists) {
            if (list && list.length) {
                const uaHeader = list.find(h => h && h.name
                    && h.name.toLowerCase() === USER_AGENT_HEADER_NAME.toLowerCase());
                if (uaHeader && uaHeader.value && String(uaHeader.value).trim()) {
                    return String(uaHeader.value).trim();
                }
            }
        }

        const offerSdp = call._incomingSdp || null;
        // Prefer sylkrtc's RAW answer SDP (call._answerSdp). The native
        // PC re-serializes SDP on setRemoteDescription and libwebrtc
        // rewrites the session name to `s=-`, so call._pc.remoteDescription
        // would have already lost the callee's s= product token. Fall
        // back to remoteDescription only if the raw answer isn't present.
        const answerSdp = call._answerSdp
            || ((call._pc && call._pc.remoteDescription)
                ? call._pc.remoteDescription.sdp
                : null);

        // Outgoing → callee's answer first; incoming → caller's offer
        // first. Fall back to whichever else is present.
        const outgoing = call.direction === 'outgoing';
        const candidates = outgoing ? [answerSdp, offerSdp] : [offerSdp, answerSdp];

        for (const sdp of candidates) {
            if (!sdp || typeof sdp !== 'string') {
                continue;
            }
            const match = sdp.match(/^s=(.*)$/m);
            if (!match) {
                continue;
            }
            const name = match[1].trim();
            if (!name || name === '-' || /^janus/i.test(name)) {
                continue;
            }
            return name;
        }
        return null;
    }

    incomingMessage(message) {
        console.log('Session message', message.id, message.contentType, 'received');

        // Media-loss signal from the peer. Caller honors it by triggering
        // the same redial path as a local watchdog trip. Callee ignores
        // (the receiver is the one emitting these; we don't expect to
        // receive our own copy, but be defensive about a future symmetric
        // policy). Filter early so this never falls through to ZRTP / chat
        // dispatch below.
        if (message && message.contentType === MEDIA_LOST_CONTENT_TYPE) {
            utils.timestampedLog('[call] [media-loss] received sylk-media-lost from peer',
                'msg_id=', message.id,
                'direction=', this.state.direction,
                'peer=', message.sender && message.sender.uri);
            if (this.state.direction === 'outgoing') {
                this._triggerMediaLostRedial('peer-signal');
            }
            return;
        }

        // Surface ZRTP envelopes that arrive on the call's session-
        // message channel separately so the receive side is visible
        // in applog alongside the [message] [call] [zrtp] send lines.
        // Note: by default sylkrtc has call.enableInlineMessaging =
        // false and forwards in-dialog messages up to
        // account.on('incomingMessage') instead, so this handler may
        // never fire unless the call is opted into inline mode.
        if (message && message.contentType === ZRTP_CONTENT_TYPE) {
            utils.timestampedLog('[message] [call] [zrtp] received via call.incomingMessage',
                'msg_id=', message.id,
                'peer=', message.sender && message.sender.uri,
                'size=', (message.content ? message.content.length : 0) + 'B');
        }
    }

    // -----------------------------------------------------------------
    // Media-loss watchdog
    // -----------------------------------------------------------------

    _startMediaLossPoller() {
        if (this._mediaLossPoller) {
            return;
        }
        // Reset accounting on (re)start so a previous loss state doesn't
        // carry over across mid-call renegotiations.
        this._mediaLossLastPackets = 0;
        this._mediaLossLastTickTs = Date.now();
        this._mediaLossActive = false;
        utils.timestampedLog('[call] [media-loss] watchdog armed',
            'threshold=', MEDIA_LOSS_THRESHOLD_MS + 'ms',
            'direction=', this.state.direction);
        this._mediaLossPoller = setInterval(() => {
            this._pollMediaLossOnce();
        }, MEDIA_LOSS_POLL_MS);
    }

    _stopMediaLossPoller() {
        if (this._mediaLossPoller) {
            clearInterval(this._mediaLossPoller);
            this._mediaLossPoller = null;
            utils.timestampedLog('[call] [media-loss] watchdog stopped');
        }
        this._mediaLossActive = false;
    }

    async _pollMediaLossOnce() {
        if (this.ended) {
            this._stopMediaLossPoller();
            return;
        }
        const call = this.state.call;
        const pc = call && call._pc;
        if (!pc || typeof pc.getStats !== 'function') {
            return;
        }
        // In-flight guard: skip this tick if the previous getStats hasn't
        // resolved. The only await is the getStats below, so the guard
        // window is exactly that try/finally; everything after runs
        // synchronously. Stale-timeout re-arms if a promise is lost.
        if (this._mediaLossInFlight
                && (Date.now() - this._mediaLossInFlightSince) < 5000) {
            return;
        }
        this._mediaLossInFlight = true;
        this._mediaLossInFlightSince = Date.now();
        let totalPackets = 0;
        try {
            const stats = await pc.getStats();
            stats.forEach((r) => {
                if (r && r.type === 'inbound-rtp') {
                    totalPackets += Number(r.packetsReceived || 0);
                }
            });
        } catch (e) {
            // getStats can throw transiently during teardown / SDP
            // renegotiation. Don't treat that as media loss — wait for
            // the next tick.
            return;
        } finally {
            this._mediaLossInFlight = false;
        }

        const now = Date.now();
        if (totalPackets > this._mediaLossLastPackets) {
            // Media is flowing again (or still flowing). Clear any
            // previously-active loss state and reset the threshold clock.
            if (this._mediaLossActive) {
                utils.timestampedLog('[call] [media-loss] media recovered',
                    'packets=', totalPackets);
            }
            this._mediaLossActive = false;
            this._mediaLossLastPackets = totalPackets;
            this._mediaLossLastTickTs = now;
            return;
        }

        // No new packets this tick. Check if we've crossed the threshold.
        const stallMs = now - this._mediaLossLastTickTs;
        if (stallMs < MEDIA_LOSS_THRESHOLD_MS) {
            return;
        }

        // Media has been silent for >= MEDIA_LOSS_THRESHOLD_MS.
        if (!this._mediaLossActive) {
            this._mediaLossActive = true;
            utils.timestampedLog('[call] [media-loss] threshold crossed',
                'stall_ms=', stallMs,
                'packets=', totalPackets,
                'direction=', this.state.direction);
        }

        if (this.state.direction === 'outgoing') {
            // Caller: redial through the existing outgoing_connection_failed
            // path (5 s setTimeout + options.reconnect=true in app.js's
            // changeRoute('/ready', 'outgoing_connection_failed') branch).
            this._triggerMediaLostRedial('local-watchdog');
        } else {
            // Callee: emit sylk-media-lost every poll while still in the
            // lost state. The caller is responsible for the actual redial;
            // we just keep nudging until packets resume or the call ends.
            this._sendMediaLostSignal();
        }
    }

    _sendMediaLostSignal() {
        const call = this.state.call;
        if (!call || typeof call.sendMessage !== 'function') {
            return;
        }
        try {
            call.sendMessage('', MEDIA_LOST_CONTENT_TYPE, {}, (err) => {
                if (err) {
                    utils.timestampedLog('[call] [media-loss] sendMessage FAILED',
                        'err=', err && err.message ? err.message : err);
                } else {
                    utils.timestampedLog('[call] [media-loss] sylk-media-lost sent to peer');
                }
            });
        } catch (e) {
            utils.timestampedLog('[call] [media-loss] sendMessage THREW',
                'err=', e && e.message ? e.message : e);
        }
    }

    _triggerMediaLostRedial(reason) {
        if (this._mediaLossRedialFired) {
            return;
        }
        this._mediaLossRedialFired = true;
        this._stopMediaLossPoller();
        const callUUID = this.state.call && this.state.call.id;
        utils.timestampedLog('[call] [media-loss] triggering redial',
            'reason=', reason,
            'callUUID=', callUUID);
        // Flip reconnectingCall=true BEFORE the hangup so the overlay shows
        // "Media lost. Reconnecting..." immediately. Without this, the call
        // terminates first (callState='terminated', finalDuration captured)
        // and the overlay flashes "Call ended after <duration>" for the
        // render(s) before app.js's reconnect branch sets reconnectingCall.
        try { this.setState({reconnectingCall: true}); } catch (e) { /* mid-teardown */ }
        // Reuse the existing outgoing_connection_failed flow. app.js's
        // changeRoute('/ready', 'outgoing_connection_failed') branch
        // (around line 6322) already handles hangup, 5 s delay, and
        // restart with options.reconnect=true so the "Reconnecting
        // call..." banner stays consistent with WSS-loss-driven redials.
        //
        // Call.js's own hangupCall(reason) takes a single arg and looks
        // up callUUID from state.call before forwarding to
        // props.hangupCall(callUUID, reason) — which is the app.js
        // implementation that actually owns the redial branch. Going
        // through the component method (not props directly) also flips
        // this.ended and removes the listeners, so any late watchdog
        // tick or stateChanged event won't fire setState on a torn-down
        // component.
        if (typeof this.hangupCall === 'function') {
            this.hangupCall('outgoing_connection_failed');
        } else if (callUUID && this.props && typeof this.props.hangupCall === 'function') {
            // Defensive fallback: if for some reason the method has been
            // detached (autoBind/instance shadowing), go straight to the
            // props.hangupCall — same end behavior in app.js.
            this.props.hangupCall(callUUID, 'outgoing_connection_failed');
        }
    }

	componentDidUpdate(prevProps, prevState) {
	  if (prevState.callContact !== this.state.callContact) {
            this.lookupContact();
      }

	  if (prevState.call !== this.state.call) {
            this.lookupContact();
      }

	  if (prevState.remoteDisplayName !== this.state.remoteDisplayName) {
	        console.log('remoteDisplayName has changed', this.state.remoteDisplayName);
      }

    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.ended) {
            return;
        }

        if (nextProps.connection && nextProps.connection !== this.state.connection) {
            nextProps.connection.on('stateChanged', this.connectionStateChanged);
        }

        this.setState({connection: nextProps.connection,
                       account: nextProps.account,
                       call: nextProps.call,
                       callContact: nextProps.callContact,
                       accountId: nextProps.account ? nextProps.account.id : null});

        if (this.state.call === null && nextProps.call !== null) {
            // Same detection path as in the constructor — covers the
            // outgoing-call case where props.call shows up via cwrp.
            // For an OUTGOING call the headers array is still empty at
            // this moment (the 200 OK hasn't arrived yet); the
            // detection then runs again from callStateChanged when
            // newState='accepted', which is when sylkrtc populates the
            // 200 OK headers on the event payload.
            this._detectPeerZrtpCapability(nextProps.call, nextProps.call.headers, 'INVITE');
            const incomingUa = this._extractRemoteUserAgent(nextProps.call);
            if (incomingUa) {
                this.setState({remoteUserAgent: incomingUa});
            }
            nextProps.call.on('stateChanged', this.callStateChanged);
            nextProps.call.on('incomingMessage', this.incomingMessage);
            // Mid-call upgrade listeners — see the constructor for what
            // each event does. We attach them here too so they cover
            // the outgoing-call case where props.call is null on mount
            // and only arrives later via componentWillReceiveProps.
            nextProps.call.on('mediaUpdated', this.onMediaUpdated);
            nextProps.call.on('updateRequest', this.onUpdateRequest);
            nextProps.call.on('updateFailed', this.onUpdateFailed);
            utils.timestampedLog('[message] [call] [zrtp] attached incomingMessage handler to call (cwrp)',
                'call_id=', nextProps.call._callId || nextProps.call.callId || nextProps.call.id,
                'peer=', nextProps.call.remoteIdentity && nextProps.call.remoteIdentity.uri,
                'inlineMessaging=', !!nextProps.call.enableInlineMessaging);

            // Same canonical-URI preference as the constructor: for
            // outgoing calls show props.targetUri (canonical `+40…`),
            // not call.remoteIdentity.uri (wire-rewritten `0040…`).
            const _direction = nextProps.call.direction;
            const _remoteUri = (_direction === 'outgoing' && nextProps.targetUri)
                ? nextProps.targetUri
                : nextProps.call.remoteIdentity.uri;
            this.setState({
                           remoteUri: _remoteUri,
                           direction: _direction,
                           callUUID: nextProps.call.id,
                           remoteDisplayName: nextProps.call.remoteIdentity.displayName
                           });

        } else {
            if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
                this.setState({'callUUID': nextProps.callUUID,
                               'direction': 'outgoing',
                               'call': null
                               });
            }
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            // When the parent flips reconnectingCall to true after a
            // failed outgoing call, the user has ALREADY confirmed
            // the original placement — the retry is automatic and
            // must skip both the awaiting-confirm UI and the 4-second
            // auto-start countdown in AudioCallBox. The constructor
            // covers the fresh-mount case via the same prop; this
            // covers the in-place transition where Call.js stays
            // mounted across the retry and userStartedCall would
            // otherwise stay at its pre-failure value.
            const _patch = { reconnectingCall: nextProps.reconnectingCall };
            if (nextProps.reconnectingCall === true && !this.state.userStartedCall) {
                _patch.userStartedCall = true;
            }
            this.setState(_patch);
        }

        // skipCountdown flipping true after mount (parent marked this
        // outgoing call as pre-committed — headset redial / handsfree
        // start): same semantics as the constructor branch, skip the
        // Start-call gate and countdown and fire the INVITE.
        if (nextProps.skipCountdown === true && !this.state.userStartedCall) {
            this.setState({userStartedCall: true});
        }

        if (nextProps.targetUri !== this.state.targetUri && this.state.direction === 'outgoing') {
            this.setState({targetUri: nextProps.targetUri});
        }

        if (nextProps.terminatedReason) {
            this.setState({terminatedReason: nextProps.terminatedReason});
        }

        if ('userStartedCall' in nextProps) {
			this.setState({userStartedCall: nextProps.userStartedCall});
        }

        if (nextProps.localMedia && !this.state.localMedia) {
            let audioOnly = nextProps.localMedia.getVideoTracks().length === 0 ? true : false;
            this.setState({localMedia: nextProps.localMedia, audioOnly: audioOnly});
            this.mediaPlaying(nextProps.localMedia);
        }

        this.setState({messages: nextProps.messages,
                         selectedContacts: nextProps.selectedContacts,
                         speakerPhoneEnabled: nextProps.speakerPhoneEnabled,
                         availableAudioDevices: nextProps.availableAudioDevices,
                         selectedAudioDevice: nextProps.selectedAudioDevice,
                         iceServers: nextProps.iceServers,
                         insets: nextProps.insets,
                         isLandscape: nextProps.isLandscape
                         });
    }

    mediaPlaying(localMedia) {
        if (this.state.direction === 'incoming') {
            const media = localMedia ? localMedia : this.state.localMedia;
            this.answerCall(media);
        } else {
            this.mediaIsPlaying = true;
        }
    }

    async answerCall(localMedia) {
        const media = localMedia ? localMedia : this.state.localMedia;
        const _cid = (this.state.call && (this.state.call._callId || this.state.call.callId || this.state.call.id)) || '?';
        if (this.state.call && this.state.call.state === 'incoming' && media) {
            // ICE servers: restored. Empty list broke cellular/CGNAT
            // calls because the device's host candidate (RFC1918 LAN
            // IP) is unreachable from Janus. STUN lets the device
            // signal its public-mapped (server-reflexive) candidate
            // too, so Janus can route RTP back. The ~500 ms STUN
            // setup is acceptable cost for reliable connectivity.
            let options = {pcConfig: {iceServers: this.state.iceServers || []}};
            options.localStream = media;
            // Mirror the outgoing-INVITE advertisement: when we accept
            // an incoming call we also need to tell the caller we
            // support the handshake, otherwise their startZrtpForCall
            // sees no flag and refuses to probe. The ZRTP gate lives in
            // _buildOutgoingHeaders; X-Sylk-User-Agent is always included so
            // the caller learns our client identity from the 200 OK.
            options.headers = this._buildOutgoingHeaders('200 OK');
            utils.timestampedLog('[call] [ui] call_id=' + _cid,
                '12 answerCall_invoked — call.answer() next');

            if (!this.answering) {
                this.answering = true;
                const connectionState = this.state.connection.state ? this.state.connection.state : null;
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    '13 sylkrtc_answer_send connectionState=' + connectionState);
                try {
                    this.state.call.answer(options);
                    utils.timestampedLog('[call] [ui] call_id=' + _cid,
                        '14 sylkrtc_answer_returned — waiting for state=established');
                } catch (error) {
                    utils.timestampedLog('[call] [ui] call_id=' + _cid,
                        'sylkrtc_answer_threw:', error);
                    this.hangupCall('answer_failed')
                }
            } else {
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    'answering already in progress, skipping');
            }
        } else {
            if (!this.state.call) {
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    'answerCall skipped: no Sylkrtc Call present yet');
                //this.hangupCall('answer_failed');
            }

            if (!media) {
                utils.timestampedLog('[call] [ui] call_id=' + _cid,
                    'answerCall waiting for local media to arrive');
            }
        }
    }

    lookupContact() {
        if (!this.state.remoteUri) {
            return;
        }

        let photo = null;
        let remoteUri = this.state.remoteUri;
        let remoteDisplayName = this.state.remoteDisplayName || '';

        // Same "URI local part counts as no name" guard as the constructor.
        // Without it, a contact whose stored name is the URI local part
        // (auto-created contacts) wins over a SIP-side display name we
        // actually want to show. Inline rather than extracted because
        // lookupContact lives on the class and we want a self-contained
        // local closure (no `this` binding gymnastics).
        const _localPart = (remoteUri && remoteUri.indexOf('@') > -1)
            ? remoteUri.split('@')[0]
            : remoteUri;
        const _isRealContactName = (n) => !!(n
            && typeof n === 'string'
            && n.toLowerCase() !== (remoteUri || '').toLowerCase()
            && n.toLowerCase() !== (_localPart || '').toLowerCase());

        if (this.props.callContact && _isRealContactName(this.props.callContact.name)) {
            // Sylk contacts — only when the stored name is a real display
            // name, not when it's just the URI local part.
            remoteDisplayName = this.props.callContact.name;
        } else if (this.props.ABContacts) {
            // AB contacts
            let username = remoteUri.split('@')[0];
            let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

            if (isPhoneNumber) {
                var contact_obj = this.findObjectByKey(this.props.ABContacts, 'uri', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.ABContacts, 'uri', remoteUri);
            }

            if (contact_obj) {
                remoteDisplayName = contact_obj.displayName;
                photo = contact_obj.photo;
                if (isPhoneNumber) {
                    remoteUri = username;
                }
            } else {
                if (isPhoneNumber) {
                    remoteUri = username;
                    remoteDisplayName = username;
                }
            }
        }

        this.setState({remoteDisplayName: remoteDisplayName,
                       remoteUri: remoteUri,
                       photo: photo
                       });
    }

    callStateChanged(oldState, newState, data) {
        //console.log('Call: callStateChanged', oldState, '->', newState);

        if (this.ended) {
            return;
        }

        // The 'accepted' transition carries the 200 OK headers on the
        // event payload (sylkrtc's call.js maps them into data.headers
        // as a [{name,value},…] array). This is the moment to detect
        // peer Sylk-ZRTP capability on the OUTGOING-call side; the
        // INVITE-side detection already ran at constructor / cwrp time.
        // Both startZrtpForCall and dispatchIncomingZrtp consult the
        // resulting call._peerSupportsZrtp flag before doing anything.
        if (newState === 'accepted' && this.state.call) {
            // Stash the 200 OK headers on the sylkrtc Call object.
            // call.headers only carries the INVITE headers for INCOMING
            // calls (set in _initIncoming); on the outgoing side the
            // response headers exist solely on this event payload, so
            // without stashing them _extractRemoteUserAgent would have
            // nothing to read the callee's X-Sylk-User-Agent from.
            if (data && data.headers && data.headers.length) {
                this.state.call._acceptedHeaders = data.headers;
            }
            this._detectPeerZrtpCapability(this.state.call, data && data.headers, '200 OK');
            // NOTE: do NOT expect the callee's answer SDP here. On an
            // OUTGOING call sylkrtc emits 'accepted' BEFORE it runs
            // setRemoteDescription(answer), so call._pc.remoteDescription
            // is still empty at this point. We try anyway (it's a no-op
            // until the answer lands), but the real capture happens at
            // 'established' below, which fires only after the answer has
            // been applied.
            const acceptedUa = this._extractRemoteUserAgent(this.state.call);
            if (acceptedUa) {
                this.setState({remoteUserAgent: acceptedUa});
            }
        }

        let remoteHasNoVideoTracks;
        let remoteIsRecvOnly;
        let remoteIsInactive;
        let remoteStreams;

        this.answering = false;

        if (newState === 'established') {
            this.setState({reconnectingCall: false});
            // Arm the media-loss watchdog now that media is supposed to
            // be flowing. Doing it earlier (e.g. on 'accepted') would
            // race with the 1-3 s pre-media gap after the 200 OK and
            // could trip during normal ICE/DTLS settling.
            this._startMediaLossPoller();
            const currentCall = this.state.call;

            // Canonical capture point for the OUTGOING case: the callee's
            // answer SDP (and its s= session name) is now applied as the
            // PC's remoteDescription, so _extractRemoteUserAgent can read
            // the callee's client identity. Logged once so the bridge can
            // be confirmed on a real outgoing call to Blink/SIP.
            if (!this.state.remoteUserAgent) {
                const establishedUa = this._extractRemoteUserAgent(currentCall);
                if (establishedUa) {
                    this.setState({remoteUserAgent: establishedUa});
                    utils.timestampedLog('[call] [ua] remote client (X-Sylk-User-Agent header or callee answer s=):',
                        establishedUa,
                        'direction=', this.state.direction);
                } else {
                    utils.timestampedLog('[call] [ua] no usable s= session name in'
                        + ' callee answer (client sent s=- or none)',
                        'direction=', this.state.direction);
                }
            }

            // ZRTP simulation: caller-side kick-off. Only the outgoing leg
            // sends the probe; the callee waits for it and replies inside
            // dispatchIncomingE2EE (driven from app.js's Account dispatch).
            // Transport is account.sendMessage so the message rides the
            // standard PGP-chat path; recipient-side filtering by call_id
            // ensures only the device in the call acts on it.
            // Silent no-op if the contact has no PGP public key cached.
            if (this.state.direction === 'outgoing' && this.props.callContact && this.props.myKeys && this.props.account) {
                try {
                    startZrtpForCall(currentCall, this.props.account, this.props.callContact, this.props.myKeys);
                } catch (e) {
                    utils.timestampedLog('[call] [zrtp] call_id='
                        + (currentCall && (currentCall._callId || currentCall.callId || currentCall.id)),
                        'startZrtpForCall threw:', e);
                }
            }

            if (currentCall) {
                remoteStreams = currentCall.getRemoteStreams();
                if (remoteStreams) {
                    if (remoteStreams.length > 0) {
                        const remotestream = remoteStreams[0];
                        remoteHasNoVideoTracks = remotestream.getVideoTracks().length === 0;
                        remoteIsRecvOnly = currentCall.remoteMediaDirections.video[0] === 'recvonly';
                        remoteIsInactive = currentCall.remoteMediaDirections.video[0] === 'inactive';
                    }
                }
            }

            if (remoteStreams && (remoteHasNoVideoTracks || remoteIsRecvOnly || remoteIsInactive) && !this.state.audioOnly) {
                //console.log('Media type changed to audio');
                // Stop local video
                if (this.state.localMedia.getVideoTracks().length !== 0) {
                    currentCall.getLocalStreams()[0].getVideoTracks()[0].stop();
                }
                this.setState({audioOnly: true});
            } else {
                this.forceUpdate();
            }

        } else if (newState === 'accepted') {
            // Switch if we have audioOnly and local videotracks. This means
            // the call object switched and we are transitioning to an
            // incoming call.
            if (this.state.audioOnly &&  this.state.localMedia && this.state.localMedia.getVideoTracks().length !== 0) {
                //console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
            }

            //data.headers.forEach((header) => {
            //});
        }

        if (newState === 'terminated') {
            this.setState({terminatedReason: this.state.terminatedReason});
            // Stop the media-loss watchdog so no late tick races against
            // a teardown call._pc that's already being torn down.
            this._stopMediaLossPoller();
        }

        this.forceUpdate();
    }

    connectionStateChanged(oldState, newState) {
        switch (newState) {
            case 'closed':
                break;
            case 'ready':
                break;
            case 'disconnected':
                if (oldState === 'ready' && this.state.direction === 'outgoing') {
                    utils.timestampedLog('reconnecting [call]...');
                    this.waitInterval = this.defaultWaitInterval;
                }
                break;
            default:
                break;
        }
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    canConnect() {
        if (!this.state.connection) {
            utils.timestampedLog('[call] no connection yet');
            return false;
        }

		// For outgoing calls we wait for the user to tap "Start" before
		// firing SIP signaling. Same pattern for both video (LocalMedia
		// preview with Start video call button) and audio (AudioCallBox
		// pre-connection bar with Start audio call button). userStartedCall
		// is flipped by confirmStartCall(). Incoming calls bypass this
		// gate (they're committed by the time the user is on the call
		// screen).
		if (this.state.direction === 'outgoing' && !this.state.userStartedCall) {
			//utils.timestampedLog('[call] waiting for user to confirm outgoing call');
			return false;
		}

        if (this.state.connection.state !== 'ready') {
            utils.timestampedLog('[call] connection is not ready');
            return false;
        }

        if (this.props.registrationState !== 'registered') {
            utils.timestampedLog('[call] account not ready yet');
            return false;
        }

        if (!this.mediaIsPlaying) {
            utils.timestampedLog('[call] local [media] is not playing')
            if (this.waitCounter > 0) {
                console.log('[call] local [media] is not yet playing');
                if (this.waitCounter == 10) {
                    // something went wrong
                    this.setState({terminatedReason: 'Cannot start media'});
                    this.hangupCall('local_media_timeout');
                }
            }
            return false;
        }

        return true;
    }

    async startCallWhenReady(callUUID) {
        this.waitCounter = 0;

        // Retry indefinitely until one of three things happens:
        //   1. the user cancels       -> hangupCall('user_cancelled')
        //   2. the call ends elsewhere -> this.ended is set, just return
        //   3. canConnect() goes true  -> this.start() fires the INVITE
        //
        // We deliberately do NOT cap this loop with a "60 seconds and
        // give up" timer anymore. The previous cap penalised the user
        // for time spent waiting on the network/registration to come
        // back — when the websocket was flapping or REGISTER kept
        // 408ing, the loop hit 60s and the call hung up with
        // reason: timeout, even though nothing about the call itself
        // had failed. The post-INVITE timeout (caller waiting for the
        // remote to answer) is still enforced separately in app.js
        // off the 'progress' call state — so a stalled ringing call
        // is still bounded; only the pre-INVITE wait is now patient.
        while (true) {
            if (this.waitCounter === 1) {
                utils.timestampedLog('waiting for [call] to be ready (will retry indefinitely)');
            }

            if (this.userHangup) {
                this.hangupCall('user_cancelled');
                return;
            }

            if (this.ended) {
                return;
            }

            if (!this.canConnect()) {
                if (this.state.call && this.state.call.id === callUUID && this.state.call.state !== 'terminated') {
                    return;
                }

                await this._sleep(1000);
                this.waitCounter++;
                continue;
            }

            // canConnect() returned true — fire the actual INVITE and
            // exit the loop. waitCounter is reset so any future
            // reconnect logic starts from zero.
            this.waitCounter = 0;
            this.start();
            return;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    confirmStartCall() {
        this.setState({userStartedCall: true});
    }

    start() {
        if (this.state.localMedia === null)  {
            console.log('Call: cannot create new call without local media');
            return;
        }

        let options = {
                       // ICE servers restored — see answerCall comment.
                       // Empty list broke cellular calls (host candidate
                       // unreachable from Janus); STUN ensures the
                       // server-reflexive candidate is signaled.
                       pcConfig: {iceServers: this.state.iceServers || []},
                       id: this.state.callUUID,
                       localStream: this.state.localMedia,
                       };
        // Advertise Sylk ZRTP-over-MESSAGE capability on the outgoing
        // INVITE — but only when the current encryption mode is one
        // that will actually run the handshake (zrtp_optional or
        // zrtp_mandatory). 'sdes' mode means the user opted out of
        // E2EE; sending X-Sylk-ZRTP in that case would be a lie and
        // cause the peer to wait for a probe that never comes. The
        // shouldAdvertiseZrtpCapability helper (via _buildOutgoingHeaders)
        // owns the decision so the rule is in one place. X-Sylk-User-Agent is
        // always included so the callee learns our client identity from
        // the INVITE.
        options.headers = this._buildOutgoingHeaders('INVITE');

        // PSTN dialing rule applied at the SIP-call boundary, NOT in
        // app.js's callKeepStartCall. Keeping the rewrite here means
        // state.targetUri stays in its canonical `+40…` form for
        // history / contact lookup / chat routing; only the wire URI
        // handed to account.call() carries the `0040…` form the
        // gateway expects.
        //
        // Skipped for conferences (room names never start with '+').
        let dialUri = this.state.targetUri;
        const rules = this.props.pstnRules;

        // "Replace 0 with" rule (Preferences → Advanced → Audio Calls
        // → Phone numbers, persisted at pstn.replaceLeadingZero and
        // merged into pstnRules by app.js getEffectivePstnRules).
        // Runs FIRST — during tel normalization, before the
        // replacePlus rewrite below: a numeric local part starting
        // with a SINGLE 0 (e.g. 0612345678, NOT 0031… which already
        // carries the international-access 00 form) gets its leading
        // 0 replaced by the configured prefix (0 → 0031 turns
        // 0612345678 into 0031612345678). Ordering matters only for
        // clarity here — a rewritten 00… number no longer matches the
        // '+' rule anyway — but keeping it first mirrors the stated
        // normalization pipeline: leading-0 → then '+'.
        if (rules && typeof rules.replaceLeadingZero === 'string'
                && rules.replaceLeadingZero.length > 0) {
            const atIdx = dialUri.indexOf('@');
            const localPart = atIdx > -1 ? dialUri.substring(0, atIdx) : dialUri;
            const domainPart = atIdx > -1 ? dialUri.substring(atIdx) : '';
            if (/^0\d+$/.test(localPart) && !localPart.startsWith('00')) {
                const rewritten = rules.replaceLeadingZero + localPart.substring(1);
                utils.timestampedLog('[pstn] replaceLeadingZero rule applied:',
                                     localPart, '→', rewritten);
                dialUri = rewritten + domainPart;
            }
        }

        if (rules && typeof rules.replacePlus === 'string') {
            const atIdx = dialUri.indexOf('@');
            const localPart = atIdx > -1 ? dialUri.substring(0, atIdx) : dialUri;
            const domainPart = atIdx > -1 ? dialUri.substring(atIdx) : '';
            if (localPart.startsWith('+')) {
                const rewritten = rules.replacePlus + localPart.substring(1);
                utils.timestampedLog('[pstn] replacePlus rule applied:',
                                     localPart, '→', rewritten);
                dialUri = rewritten + domainPart;
            }
        }

        let call = this.state.account.call(dialUri, options);
        this.setState({call: call});
    }

    hangupCall(reason) {
        let callUUID = this.state.call ? this.state.call.id : this.state.callUUID;
        this.waitInterval = this.defaultWaitInterval;

        // Signal the startCallWhenReady loop to exit on its next tick.
        // Used to rely on bumping waitCounter past waitInterval to
        // break out of the while-loop; the loop is now infinite (it
        // retries indefinitely until canConnect() succeeds), so we
        // need an explicit "stop" flag. componentWillUnmount also
        // sets this.ended, so a route change away from /call cleans
        // up the loop too.
        this.ended = true;

        if (this.state.call) {
            //console.log('Remove listener for call', this.state.call.id);
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
            this.setState({call: null});
        }

        if (this.state.connection) {
            //console.log('Remove listener for connection', this.state.connection);
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
            this.setState({connection: null});
        }

        this.props.hangupCall(callUUID, reason);
    }

    // ---- Mid-call upgrade (audio -> audio+video) ------------------------
    //
    // Tapping +video goes straight to the video call layout — same
    // visual transition the user sees after tapping the green-video
    // button on IncomingCallModal (no separate confirm panel, no
    // preview screen, no countdown). The flow:
    //   1. startVideo() captures the camera via getUserMedia.
    //   2. call.addVideo({ localStream }) fires immediately — the
    //      library does addTrack + createOffer + sends session-update.
    //   3. Server forwards to Janus; Janus issues SIP re-INVITE.
    //   4. Remote answers; the library applies the answer and emits
    //      'mediaUpdated'.
    //   5. onMediaUpdated flips state.audioOnly to false; render()
    //      then picks VideoBox, which reads local video from
    //      call.getLocalStreams()[0].
    //
    // For peer-initiated upgrades (remote re-INVITE adds m=video),
    // onUpdateRequest captures the camera and answers immediately,
    // mirroring the same "tap = commit" semantics.
    //
    // We deliberately do NOT touch this.state.localMedia. That state
    // is owned by the top-level app component (initial audio-only
    // capture); the new video track is wired to the peer connection's
    // senders only, and VideoBox prefers call.getLocalStreams()[0]
    // over props.localMedia anyway.
    startVideo() {
        // Tap +video on AudioCallBox: capture the camera, show the
        // "Enable your camera?" prompt over the audio call screen.
        // CRITICAL: do NOT call addVideo() yet. The renegotiation
        // (SIP re-INVITE) only fires when the user taps "Enable
        // camera" — see onEnableCamera below. Tapping "Cancel" stops
        // the captured track and the call stays purely audio (no
        // session-update goes out, peer never knows anything
        // happened).
        const call = this.state.call;
        if (!call) return;
        if (typeof call.addVideo !== 'function') {
            utils.timestampedLog('[upgrade] startVideo: call.addVideo is not available');
            return;
        }
        if (this.state.upgradePromptMode) return;     // prompt already up
        utils.timestampedLog('[upgrade] startVideo: acquiring camera for prompt');
        navigator.mediaDevices.getUserMedia(_buildUpgradeVideoConstraints())
            .then((localStream) => {
                this.setState({
                    upgradePromptMode: 'outgoing',
                    upgradePromptStream: localStream,
                });
            })
            .catch((error) => {
                utils.timestampedLog('[upgrade] startVideo: getUserMedia failed:', error && error.message);
            });
    }

    // Flip between the video and audio layouts for the *same* call
    // without touching the media. The video tracks remain attached to
    // the peer connection; we only change which component renders.
    // VideoBox reads its streams from call.getLocalStreams()[0] on
    // mount, so switching back picks the live video sender straight
    // back up ("the call object is compatible"). No-op on a genuine
    // audio-only call — there's no video layout to switch to.
    toggleCallView() {
        if (this.state.audioOnly) return;
        this.setState(state => {
            const next = !state.forceAudioView;
            utils.timestampedLog('[call] toggleCallView ->', next ? 'audio view' : 'video view');
            return { forceAudioView: next };
        });
    }

    onMediaUpdated(payload) {
        utils.timestampedLog('[upgrade] mediaUpdated:', JSON.stringify(payload));
        this._cancelUpgradePromptTimer();
        const nowAudioOnly = !payload || (!payload.hasLocalVideo && !payload.hasRemoteVideo);
        if (this.state.audioOnly !== nowAudioOnly) {
            this.setState({ audioOnly: nowAudioOnly });
        }
        // The view-override only makes sense while the call carries
        // video. If the media just dropped to true audio-only, drop the
        // override too so a later re-upgrade defaults back to the video
        // layout instead of staying stuck on the forced audio view.
        if (nowAudioOnly && this.state.forceAudioView) {
            this.setState({ forceAudioView: false });
        }
        // Audio→video upgrade just landed. The ZRTP install path
        // already ran (one-shot) back during the initial audio
        // handshake, with no video sender to act on, so libwebrtc's
        // encoder for the just-added video sender is sitting at its
        // defaults (no scaleResolutionDownBy, no maxFramerate cap,
        // no maxBitrate cap). The result was visibly higher
        // resolution / framerate on the upgrade path than on a call
        // that started as video. Re-apply the encoder target now
        // that a video sender exists.
        //
        // Re-apply on EVERY mediaUpdated rather than only
        // audio→video transitions: subsequent re-INVITEs that
        // toggle direction or replace the camera track also produce
        // a fresh sender that needs the cap, and the underlying
        // helper is idempotent — it walks pc.getSenders(), sets
        // sender.setParameters() with the latest profile, and bails
        // when there's no video sender.
        try {
            if (this.state.call && payload && (payload.hasLocalVideo || payload.hasRemoteVideo)) {
                reapplyVideoEncoderParams(this.state.call);
            }
        } catch (e) {
            utils.timestampedLog('[upgrade] reapplyVideoEncoderParams threw:',
                e && e.message ? e.message : e);
        }
    }

    _startUpgradePromptTimer() {
        this._cancelUpgradePromptTimer();
        this._upgradePromptTimer = setTimeout(() => {
            this._upgradePromptTimer = null;
            if (this.state.upgradePromptMode) {
                utils.timestampedLog('[upgrade] prompt timeout — auto-cancelling',
                    'mode=', this.state.upgradePromptMode);
                this.onCancelUpgrade();
            }
        }, 25000);
    }

    _cancelUpgradePromptTimer() {
        if (this._upgradePromptTimer) {
            clearTimeout(this._upgradePromptTimer);
            this._upgradePromptTimer = null;
        }
    }

    onUpdateRequest(payload) {
        utils.timestampedLog('[upgrade] updateRequest from peer');
        const call = this.state.call;
        if (!call || typeof call.answerUpdate !== 'function') return;
        const remoteHasVideo =
            payload && payload.remoteMediaDirections && payload.remoteMediaDirections.video
            && payload.remoteMediaDirections.video.some(d => d && d !== 'inactive');
        if (!remoteHasVideo) {
            try { call.answerUpdate({}); } catch (e) {
                utils.timestampedLog('[upgrade] answerUpdate threw:', e && e.message);
            }
            return;
        }
        navigator.mediaDevices.getUserMedia(_buildUpgradeVideoConstraints())
            .then((localStream) => {
                try {
                    localStream.getVideoTracks().forEach(t => { t.enabled = false; });
                } catch (e) { /* ignore */ }
                try { if (call) call._sylkCameraPromptHandled = false; } catch (e) {}
                this.setState({ cameraInitiallyMuted: true });
                try {
                    call.answerUpdate({ localStream });
                } catch (err) {
                    utils.timestampedLog('[upgrade] auto-answerUpdate threw:', err && err.message);
                    try { localStream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
                    this.setState({ cameraInitiallyMuted: false });
                }
            })
            .catch((error) => {
                utils.timestampedLog('[upgrade] updateRequest getUserMedia failed:', error && error.message);
                // No camera at all — finish the renegotiation recvonly.
                try { call.answerUpdate({}); } catch (e) { /* ignore */ }
            });
    }

    onEnableCamera() {
        this._cancelUpgradePromptTimer();
        const call = this.state.call;
        const stream = this.state.upgradePromptStream;
        const mode = this.state.upgradePromptMode;
        if (!call || !stream || !mode) {
            this.setState({ upgradePromptMode: null, upgradePromptStream: null });
            return;
        }
        this.setState({ upgradePromptMode: null, upgradePromptStream: null });

        // The user has just confirmed video on the upgrade prompt
        // panel. Mark the call so VideoBox's own "Enable your
        // camera?" modal does NOT pop again when VideoBox mounts
        // post-renegotiation. Without these flags the user would
        // have to confirm video TWICE on the side that initiated
        // the upgrade:
        //   1. Confirm Video on this upgrade prompt (commits the
        //      session-update / addVideo).
        //   2. Confirm Video again on the VideoBox modal that fires
        //      because props.videoMuted is still true (app.js
        //      derives it from state.incomingCall which is not
        //      cleared on accept) AND direction==='incoming' AND
        //      _sylkCameraPromptHandled is still false.
        // Worse, VideoBox's constructor would also re-disable the
        // freshly-attached video track (it sees videoMuted=true and
        // !_sylkInitialVideoMuteApplied) and mute the wire we just
        // committed. Setting both flags here keeps the
        // user's "yes, send video" choice from this panel
        // authoritative through the VideoBox mount.
        try {
            call._sylkCameraPromptHandled = true;
            call._sylkInitialVideoMuteApplied = true;
        } catch (e) { /* call is a plain object; flag set is best-effort */ }

        try {
            if (mode === 'outgoing') {
                call.addVideo({ localStream: stream });
                this._startUpgradePromptTimer();
            } else {
                call.answerUpdate({ localStream: stream });
            }
        } catch (err) {
            utils.timestampedLog('[upgrade] enableCamera threw:', err && err.message);
            try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
        }
    }

    flipUpgradeCamera() {
        // Toggle front/back on the captured-but-not-yet-published
        // video track. Uses react-native-webrtc's _switchCamera()
        // which flips in place — no need to stop the track and
        // re-acquire a new stream (which would briefly black out the
        // preview).
        const stream = this.state.upgradePromptStream;
        if (!stream) return;
        try {
            const tracks = stream.getVideoTracks();
            if (tracks && tracks.length > 0 && typeof tracks[0]._switchCamera === 'function') {
                tracks[0]._switchCamera();
                this.setState({
                    upgradePromptFacing: this.state.upgradePromptFacing === 'front' ? 'back' : 'front',
                });
            }
        } catch (e) {
            utils.timestampedLog('[upgrade] flipCamera failed:', e && e.message);
        }
    }

    onCancelUpgrade() {
        this._cancelUpgradePromptTimer();
        const call = this.state.call;
        const stream = this.state.upgradePromptStream;
        const mode = this.state.upgradePromptMode;
        if (stream) {
            try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
        }
        if (mode === 'incoming' && call && typeof call.answerUpdate === 'function') {
            try { call.answerUpdate({}); } catch (e) {
                utils.timestampedLog('[upgrade] cancel answerUpdate threw:', e && e.message);
            }
        }
        this.setState({ upgradePromptMode: null, upgradePromptStream: null });
    }

    onUpdateFailed(error) {
        // The renegotiation failed: glare with the peer, transport
        // error inside Janus, or a local createOffer/createAnswer
        // exception. The call itself is unaffected (audio keeps
        // flowing on the existing PC), so we just log; the user can
        // retry the upgrade.
        utils.timestampedLog('[upgrade] updateFailed:', error && (error.message || error));
    }

    render() {
        let box = null;
        if (this.state.localMedia !== null) {
            // forceAudioView: user chose the audio layout for a call that
            // actually carries video (see toggleCallView). Render
            // AudioCallBox over the live video call; the video senders
            // stay attached and VideoBox re-mounts onto them when the
            // user switches back.
            if (this.state.audioOnly || this.state.forceAudioView) {
                box = (
                    <AudioCallBox
                        systemMessage = {this.props.navbarSystemMessage}
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        remoteUserAgent = {this.state.remoteUserAgent}
                        photo = {this.state.photo}
                        hangupCall = {this.hangupCall}
                        call = {this.state.call}
                        accountId={this.state.accountId}
                        connection = {this.state.connection}
                        localMedia = {this.state.localMedia}
                        /* Forwarded to CallOverlay so the warmup line
                           reads "Accepting call…" instead of "Calling
                           X…" during the cold-start push-accept
                           window. See _openPushAcceptGate in app.js. */
                        pushAcceptInProgress = {this.props.pushAcceptInProgress}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        defaultConferenceDomain = {this.props.defaultConferenceDomain}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        toggleMute = {this.props.toggleMute}
                        speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        isLandscape = {this.state.isLandscape}
                        isTablet = {this.props.isTablet}
                        isFolded = {this.props.isFolded}
                        reconnectingCall = {this.state.reconnectingCall}
                        muted = {this.props.muted}
                        showLogs = {this.props.showLogs}
                        goBackFunc = {this.props.goBackFunc}
                        callState = {this.props.callState}
                        messages = {this.state.messages}
                        deleteMessages = {this.props.deleteMessages}
                        sendMessage = {this.props.sendMessage}
                        expireMessage = {this.props.expireMessage}
                        reSendMessage = {this.props.reSendMessage}
                        deleteMessage = {this.props.deleteMessage}
                        getMessages = {this.props.getMessages}
                        pinMessage = {this.props.pinMessage}
                        unpinMessage = {this.props.unpinMessage}
                        selectedContact = {this.state.selectedContact}
                        selectedContacts = {this.state.selectedContacts}
                        callContact = {this.state.callContact}
                        inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                        finishInvite = {this.props.finishInvite}
                        terminatedReason = {this.state.terminatedReason}
                        confirmStartCall = {this.confirmStartCall}
                        userStartedCall = {this.state.userStartedCall}
                        // The "Start audio call" pre-call layout +
                        // 6-second auto-start countdown should only
                        // appear for a *fresh* user-initiated outgoing
                        // call. On a reconnect — after
                        // outgoing_connection_failed, the app remounts
                        // /call via callKeepStartCall — the user is
                        // not "awaiting" anything; they're trying to
                        // recover an in-progress call. Adding the
                        // !reconnectingCall guard keeps the awaiting
                        // UI off in that case (and the countdown
                        // doesn't restart). The user can still see the
                        // regular reconnecting bar on the normal
                        // in-call layout.
                        // Also gate on call.state !== 'terminated' so
                        // the countdown / Start-call button doesn't
                        // reappear on the post-hangup render of the
                        // pre-call preview surface (the user reported
                        // seeing "Start call" + countdown after a
                        // video call ended).
                        awaitingUserCallStart = {this.state.direction === 'outgoing' && !this.state.userStartedCall && !this.state.reconnectingCall && (!this.state.call || this.state.call.state !== 'terminated')}
                        availableAudioDevices = {this.state.availableAudioDevices}
                        selectedAudioDevice = {this.state.selectedAudioDevice}
                        audioInputs = {this.props.audioInputs}
                        selectAudioDevice = {this.props.selectAudioDevice}
						useInCallManger = {this.props.useInCallManger}
						insets = {this.state.insets}
                        markZrtpVerified = {this.props.markZrtpVerified}
                        resetContactZrtp = {this.props.resetContactZrtp}
                        shareLocationFromCall = {this.props.shareLocationFromCall}
                        requestLocationFromCall = {this.props.requestLocationFromCall}
                        saveCallRecording = {this.props.saveCallRecording}
                        enableAudioRecording = {this.props.enableAudioRecording}
                        startVideo = {this.startVideo}
                        // View switching: callHasVideo is true when the
                        // call actually carries video (i.e. we're here
                        // because the user forced the audio layout, not
                        // because the call is genuinely audio-only). Only
                        // then does the CallOverlay expose "Switch to
                        // video view".
                        callHasVideo = {!this.state.audioOnly}
                        switchCallView = {this.toggleCallView}
					/>
                );
            } else {
                if (this.state.call !== null && (
                        this.state.call.state === 'established'
                        || (this.state.call.state === 'terminated' && this.state.reconnectingCall)
                        // Skip the LocalMedia preview flash on incoming
                        // video. Render VideoBox immediately; it triggers
                        // mediaPlaying() in componentDidMount the same way
                        // AudioCallBox does for incoming audio, and falls
                        // back to props.localMedia for the local-stream
                        // ref until the SDP answer attaches the sender.
                        || this.state.direction === 'incoming'
                    )) {

                    box = (
                        <VideoBox
                            systemMessage = {this.props.navbarSystemMessage}
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            remoteUserAgent = {this.state.remoteUserAgent}
                            photo = {this.state.photo}
                            hangupCall = {this.hangupCall}
                            call = {this.state.call}
                            markZrtpVerified = {this.props.markZrtpVerified}
                        resetContactZrtp = {this.props.resetContactZrtp}
                            saveVideoCallPrefs = {this.props.saveVideoCallPrefs}
                            accountId={this.state.accountId}
                            connection = {this.state.connection}
                            localMedia = {this.state.localMedia}
                            shareScreen = {this.props.shareScreen}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            toggleMute = {this.props.toggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            isLandscape = {this.state.isLandscape}
                            isTablet = {this.props.isTablet}
                            isFolded = {this.props.isFolded}
                            reconnectingCall = {this.state.reconnectingCall}
                            muted = {this.props.muted}
                            showLogs = {this.props.showLogs}
                            goBackFunc = {this.props.goBackFunc}
                            callState = {this.props.callState}
                            messages = {this.state.messages}
                            deleteMessages = {this.props.deleteMessages}
                            sendMessage = {this.props.sendMessage}
                            expireMessage = {this.props.expireMessage}
                            reSendMessage = {this.props.reSendMessage}
                            deleteMessage = {this.props.deleteMessage}
                            getMessages = {this.props.getMessages}
                            pinMessage = {this.props.pinMessage}
                            unpinMessage = {this.props.unpinMessage}
                            selectedContact = {this.state.selectedContact}
                            selectedContacts = {this.state.selectedContacts}
                            callContact = {this.state.callContact}
                            inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                            finishInvite = {this.props.finishInvite}
                            terminatedReason = {this.state.terminatedReason}
                            videoMuted = {this.props.videoMuted}
                            cameraInitiallyMuted = {this.state.cameraInitiallyMuted}
							availableAudioDevices = {this.state.availableAudioDevices}
							selectedAudioDevice = {this.state.selectedAudioDevice}
							selectAudioDevice = {this.props.selectAudioDevice}
							useInCallManger = {this.props.useInCallManger}
							insets = {this.state.insets}
							enableFullScreen = {this.props.enableFullScreen}
							disableFullScreen = {this.props.disableFullScreen}
                            shareLocationFromCall = {this.props.shareLocationFromCall}
                            requestLocationFromCall = {this.props.requestLocationFromCall}
                            // View switching: in VideoBox the call always
                            // carries video, so "Switch to audio view" is
                            // always available.
                            callHasVideo = {true}
                            switchCallView = {this.toggleCallView}
						/>
                    );
                } else {
                    if (this.state.call && this.state.call.state === 'terminated' && this.state.reconnectingCall) {
                        //console.log('Skip render local media because we will reconnect');
                    } else {
                        box = (
                            <LocalMedia
                                call = {this.state.call}
                                remoteUri = {this.state.remoteUri}
                                remoteDisplayName = {this.state.remoteDisplayName}
                                photo = {this.state.photo}
                                localMedia = {this.state.localMedia}
                                mediaPlaying = {this.mediaPlaying}
                                hangupCall = {this.hangupCall}
                                generatedVideoTrack = {this.props.generatedVideoTrack}
                                accountId = {this.state.accountId}
                                connection = {this.state.connection}
                                isLandscape = {this.state.isLandscape}
                                isTablet = {this.props.isTablet}
                                isFolded = {this.props.isFolded}
                                media = 'video'
                                showLogs = {this.props.showLogs}
                                goBackFunc = {this.props.goBackFunc}
                                terminatedReason = {this.state.terminatedReason}
								availableAudioDevices = {this.state.availableAudioDevices}
								selectedAudioDevice = {this.state.selectedAudioDevice}
								selectAudioDevice = {this.props.selectAudioDevice}
								useInCallManger = {this.props.useInCallManger}
								insets = {this.state.insets}
								// !reconnectingCall: auto-retries after a
								// failed outgoing call must skip the
								// awaiting-confirm UI and the 4-second
								// auto-start countdown — the user
								// already confirmed once.
								// Also gate on call not being terminated so
								// the countdown / Start button doesn't pop
								// back up after a hangup.
								awaitingUserCallStart = {this.state.direction === 'outgoing' && !this.state.audioOnly && !this.state.userStartedCall && !this.state.reconnectingCall && (!this.state.call || this.state.call.state !== 'terminated')}
								confirmStartCall = {this.confirmStartCall}
							/>
                        );
                    }
                }
            }
        } else if (this.props.outgoingMediaIsVideo && this.state.direction === 'outgoing') {
            // Suppress the AudioCallBox flash that used to fire for the
            // brief window between route → /call and getLocalMedia
            // returning the video stream. localMedia is null at that
            // point, but rendering AudioCallBox here looks like a
            // wrong-call-type glitch ("audio call without video"
            // flashes in for ~200 ms before the camera preview lands).
            // Render nothing — the next render with localMedia set
            // will mount LocalMedia and the camera preview takes over.
            box = null;
        } else {
            box = (
                <AudioCallBox
                    systemMessage = {this.props.navbarSystemMessage}
                    remoteUri = {this.state.remoteUri}
                    remoteDisplayName = {this.state.remoteDisplayName}
                    remoteUserAgent = {this.state.remoteUserAgent}
                    photo = {this.state.photo}
                    hangupCall = {this.hangupCall}
                    call = {this.state.call}
                    accountId = {this.state.accountId}
                    connection = {this.state.connection}
                    /* See the matching prop on the audio-only branch
                       above — forwarded into the CallOverlay so the
                       warmup copy reads "Accepting call…" instead of
                       "Calling X…" while the push-accept gate is up. */
                    pushAcceptInProgress = {this.props.pushAcceptInProgress}
                    mediaPlaying = {this.mediaPlaying}
                    escalateToConference = {this.props.escalateToConference}
                    callKeepSendDtmf = {this.props.callKeepSendDtmf}
                    toggleMute = {this.props.toggleMute}
                    speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                    toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    isLandscape = {this.state.isLandscape}
                    isTablet = {this.props.isTablet}
                    isFolded = {this.props.isFolded}
                    reconnectingCall = {this.state.reconnectingCall}
                    muted = {this.props.muted}
                    showLogs = {this.props.showLogs}
                    goBackFunc = {this.props.goBackFunc}
                    selectedContact = {this.state.selectedContact}
                    callContact = {this.state.callContact}
                    inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                    finishInvite = {this.props.finishInvite}
                    terminatedReason = {this.state.terminatedReason}
                    confirmStartCall = {this.confirmStartCall}
                    userStartedCall = {this.state.userStartedCall}
                    // !reconnectingCall: see the matching note on
                    // the VideoBox awaitingUserCallStart prop above.
                    // Also gate on call not being terminated.
                    awaitingUserCallStart = {this.state.direction === 'outgoing' && !this.state.userStartedCall && !this.state.reconnectingCall && (!this.state.call || this.state.call.state !== 'terminated')}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					audioInputs = {this.props.audioInputs}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
                    markZrtpVerified = {this.props.markZrtpVerified}
                        resetContactZrtp = {this.props.resetContactZrtp}
                    shareLocationFromCall = {this.props.shareLocationFromCall}
                    requestLocationFromCall = {this.props.requestLocationFromCall}
                    saveCallRecording = {this.props.saveCallRecording}
                    enableAudioRecording = {this.props.enableAudioRecording}
				/>
            );
        }
        // Mid-call audio→video upgrade prompt overlay. Visually
        // matches the "Enable your camera?" bottom panel inside
        // VideoBox (line ~1820), but rendered here over AudioCallBox
        // BEFORE any SIP renegotiation has started. The user's tap on
        // "Enable camera" is what triggers addVideo() / answerUpdate();
        // tapping "Cancel" stops the captured track and leaves the
        // call audio-only (no session-update sent for outgoing, or a
        // recvonly answer for incoming so the peer's re-INVITE
        // completes — but our UI stays on AudioCallBox).
        if (this.state.upgradePromptMode) {
            const peerLabel = this.state.remoteDisplayName || this.state.remoteUri || 'The other party';
            const detail = this.state.upgradePromptMode === 'incoming'
                ? `${peerLabel} wants to add video. Start your camera to share back, or cancel to keep the call audio-only.`
                : `Add video to this call with ${peerLabel}. Tap Enable camera to share, or Cancel to stay audio-only.`;
            const bottomInset = (this.state.insets && this.state.insets.bottom) || 0;
            const topInset = (this.state.insets && this.state.insets.top) || 0;
            const previewUrl = this.state.upgradePromptStream
                ? this.state.upgradePromptStream.toURL()
                : null;
            const mirror = this.state.upgradePromptFacing === 'front';
            return (
                <View style={{ flex: 1, backgroundColor: 'black' }}>
                    {/* Underlying call view stays mounted so audio is
                        uninterrupted — the prompt overlay floats above
                        it. */}
                    {box}
                    {/* Backdrop dims the call screen behind the
                        prompt. Tapping it does NOTHING; the user must
                        pick Enable camera or Cancel explicitly. */}
                    <View style={{
                        ...StyleSheet.absoluteFillObject,
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        zIndex: 2900,
                    }} pointerEvents="none" />
                    {/* Self-view preview taking the upper portion of
                        the screen. RTCView is keyed on the stream URL
                        so the surface tears down cleanly when the
                        prompt closes. mirror flips the front-camera
                        view so the user sees themselves the way they
                        do in a normal mirror. */}
                    {previewUrl ? (
                        <View style={{
                            position: 'absolute',
                            top: topInset + 24,
                            left: 24,
                            right: 24,
                            bottom: bottomInset + 220,
                            backgroundColor: 'black',
                            borderRadius: 12,
                            overflow: 'hidden',
                            zIndex: 3000,
                        }}>
                            <DeferredRTCView
                                key={'upgrade-preview-' + previewUrl}
                                streamURL={previewUrl}
                                objectFit="cover"
                                mirror={mirror}
                                style={StyleSheet.absoluteFillObject}
                            />
                            {/* Flip-camera button overlaid on the
                                preview. Tapping it calls
                                track._switchCamera() — flips the same
                                track in place rather than re-acquiring
                                a stream. */}
                            <View style={{
                                position: 'absolute',
                                top: 12,
                                right: 12,
                            }}>
                                <IconButton
                                    icon="camera-flip"
                                    size={28}
                                    onPress={this.flipUpgradeCamera}
                                    style={{backgroundColor: 'rgba(255,255,255,0.85)'}}
                                />
                            </View>
                        </View>
                    ) : null}
                    {/* Action panel pinned to the bottom — keeps the
                        existing "Enable your camera?" panel shape from
                        VideoBox so the gesture and look are consistent
                        between the two surfaces. */}
                    <View style={{
                        position: 'absolute',
                        bottom: bottomInset + 12,
                        left: 12,
                        right: 12,
                        backgroundColor: 'white',
                        borderRadius: 12,
                        paddingTop: 14,
                        paddingBottom: 6,
                        paddingHorizontal: 16,
                        elevation: 8,
                        zIndex: 3000,
                    }} pointerEvents="auto">
                        <PaperText style={{fontSize: 18, fontWeight: 'bold', marginBottom: 8}}>
                            Enable your camera?
                        </PaperText>
                        <PaperText style={{marginBottom: 12}}>
                            {detail}
                        </PaperText>
                        <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
                            <Button onPress={this.onCancelUpgrade}>Cancel</Button>
                            <Button mode="contained" onPress={this.onEnableCamera} style={{marginLeft: 8}}>
                                Enable camera
                            </Button>
                        </View>
                    </View>
                </View>
            );
        }
        return box;
    }
}

Call.propTypes = {
    skipCountdown           : PropTypes.bool,
    userAgent               : PropTypes.string,
    targetUri               : PropTypes.string,
    pstnRules               : PropTypes.object,
    account                 : PropTypes.object,
    hangupCall              : PropTypes.func,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    call                    : PropTypes.object,
    terminatedReason        : PropTypes.string,
    localMedia              : PropTypes.object,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    callUUID                : PropTypes.string,
    ABContacts              : PropTypes.array,
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
    selectedContact         : PropTypes.object,
    callContact             : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    postSystemNotification  : PropTypes.func,
	videoMuted              : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    audioInputs             : PropTypes.array,
    selectAudioDevice       : PropTypes.func,
    startRingback           : PropTypes.func,
    stopRingback            : PropTypes.func,
    useInCallManger         : PropTypes.bool,
    iceServers              : PropTypes.array,
	insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func,
	// True when the user is initiating an outgoing video call. Used by
	// render() to skip the AudioCallBox fallback during the brief window
	// between route→/call and getLocalMedia returning the video stream,
	// which otherwise flashes a misleading "audio call without video"
	// view for ~200 ms before LocalMedia takes over.
	outgoingMediaIsVideo    : PropTypes.bool,
	// Default sylk conference domain (e.g. videoconference.sip2sip.info)
	// forwarded to AudioCallBox so it can compose the room URI sent in
	// conference_request metadata on escalation.
	defaultConferenceDomain : PropTypes.string
};


export default Call;
