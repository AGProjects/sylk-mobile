
import React, { Component } from 'react';
import PropTypes from 'prop-types';
// const hark              = require('hark');
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { Title, Badge, Text } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { RTCView } from 'react-native-webrtc';
import { View } from 'react-native';

import utils from '../utils';

//import styles from '../assets/styles/ConferenceMatrixParticipant';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },

  portraitContainer: {
    flexBasis: '50%',
    height: '50%',
  },

  landscapeContainer: {
    flexBasis: '50%',
    width: '50%',
  },

  soloContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  videoContainer: {
    height: '100%',
    width: '100%',
  },

  video: {
    height: '100%',
    width: '100%',
  },

  controlsTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'row',
    maxHeight: 50,
    minHeight: 50,
    paddingLeft: 20,
  },

  badge: {
    backgroundColor: '#5cb85c',
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '500',
  },

  // Per-tile pill rendered on a pinned tile — "Main speaker" in
  // 1-speaker layout, "Speaker 1" / "Speaker 2" in 2-speaker
  // layout. Anchored to the tile's BOTTOM-RIGHT corner so each
  // participant's pill stays with their own video frame and
  // away from the floating call buttons bar / bandwidth panel
  // at the top of the screen. zIndex 11 lifts it above the
  // gradient name strip (zIndex 10).
  speakerTagWrapper: {
    position: 'absolute',
    bottom: 12,
    right: 8,
    zIndex: 11,
    pointerEvents: 'none',
  },
  speakerTag: {
    backgroundColor: 'rgba(33, 150, 243, 0.85)',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    letterSpacing: 0.3,
  },

  // Red warning chip rendered top-center of a tile whose video
  // m-line was REJECTED in our answer (codec mismatch — the
  // publisher offered a codec this device can't decode, e.g.
  // desktop H264 Baseline 42001f vs Android's Constrained
  // Baseline 42e01f / High 640c1f). The track object still
  // exists so the grid thinks video:1, but nothing ever decodes
  // — without this chip the user just sees a black tile.
  codecWarnWrapper: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 12,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  codecWarn: {
    backgroundColor: 'rgba(211, 47, 47, 0.85)',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    maxWidth: '90%',
  },

  controls: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'flex-end',
    flexDirection: 'row',
    maxHeight: 114,
    minHeight: 114,
    paddingLeft: 20,
  },
  lead: {
    color: '#fff',
    marginBottom: 10,
    // Previously marginLeft: 120 — that was sized for a single
    // full-screen tile in landscape where the gradient strip had
    // plenty of horizontal room. In a portrait 2x2 grid each
    // tile is ~50% screen width, and a 120-px left margin left
    // basically no room for the username text — long local-parts
    // (two mid-length display names) wrapped to 2-3 lines on the narrow
    // right column. Tighten to 12 so the text starts near the
    // left edge of the gradient strip, and rely on the explicit
    // numberOfLines={1} on the rendered Title to truncate
    // anything that still wouldn't fit on one line.
    marginLeft: 12,
    fontSize: 14,
  },
  status: {
    color: '#fff',
    fontSize: 8,
    marginBottom: 16,
    marginLeft: 5,
  },
});


class ConferenceMatrixParticipant extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            hasVideo: false,
            sharesScreen: false,
            audioMuted: false,
            stream: null,
            status: this.props.status,
            // Bumped each time a new track is observed via the
            // participant's 'streamAdded' event. RTCView keys off
            // `${streamURL}-${trackVersion}` so it remounts when
            // the underlying stream object accumulates a new track
            // (audio receiver arrives first, video later — without
            // a remount the RTCView stays bound to the audio-only
            // view of the mutated stream and the tile reads gray).
            trackVersion: 0,
        }
        this.speechEvents = null;

        this.videoElement = React.createRef();

        if (!props.isLocal) {
            // Two events drive maybeAttachStream:
            //
            //   • stateChanged → 'established' covers the case where
            //     the participant becomes ready after this component
            //     mounted, e.g. the very first remote join right
            //     after we switched into video view.
            //   • streamAdded fires every time the underlying
            //     RTCPeerConnection's `track` event lands a new
            //     receiver. That's the one that was missing — when a
            //     participant was already 'established' before this
            //     tile mounted (they joined while we were in audio
            //     view, then we switched to video view), maybeAttach
            //     Stream ran once at mount and caught only whichever
            //     receivers had been delivered by then. Any later
            //     track arrival (the video receiver showing up after
            //     the audio receiver) silently never refreshed the
            //     tile, which left RTCView pointing at an audio-only
            //     view of the stream — i.e. a gray rectangle. Sub
            //     -scribing here closes that gap.
            props.participant.on('stateChanged', this.onParticipantStateChanged);
            props.participant.on('streamAdded', this.onStreamAdded);
        }
    }

    onStreamAdded() {
        this.maybeAttachStream(true);
    }

    UNSAFE_componentWillReceiveProps(nextProps) {

        if (nextProps.hasOwnProperty('status')) {
            this.setState({status: nextProps.status});
        }

        if (nextProps.hasOwnProperty('stream')) {
            this.setState({stream: nextProps.stream});
        }

        if (nextProps.hasOwnProperty('hasVideo')) {
            this.setState({hasVideo: nextProps.hasVideo});
        }

        if (nextProps.hasOwnProperty('audioMuted')) {
            this.setState({audioMuted: nextProps.audioMuted});
        }

        // Re-attach stream when the participant object itself changes.
        //
        // Self-pinned-speaker case: applySpeakerLayout setStates
        // activeSpeakers FIRST with the picker's optimistic stand-in
        // ({id, publisherId, identity}, NO streams), and the matrix
        // tile mounts against that — maybeAttachStream runs once,
        // sees streams undefined, bails. THEN the server echoes
        // roomConfigured, sylkrtc replaces the entry with a fresh
        // synthetic {id, publisherId, identity, streams: getLocalStreams()},
        // ConferenceBox setStates activeSpeakers again. React reuses
        // this component instance (same key={p.id}), and only this
        // cWRP fires — componentDidMount won't re-run. Without this
        // block, state.stream stays null and the RTCView paints
        // streamURL=null forever. Symptom: user pins themselves as
        // a speaker, log confirms the pin, but the tile is blank.
        //
        // Guard with a !== check so we only do the work on real swaps
        // (parent prop spread on every render still passes the same
        // object reference when the participant hasn't changed) and
        // with a stream-identity check so we don't churn the
        // trackVersion on every render.
        if (nextProps.participant
            && nextProps.participant !== this.props.participant
            && nextProps.participant.streams
            && nextProps.participant.streams.length > 0) {
            const _newStream = nextProps.participant.streams[0];
            if (_newStream && this.state.stream !== _newStream) {
                const _hasVideo = _newStream.getVideoTracks
                    && _newStream.getVideoTracks().length > 0;
                this.setState((prev) => ({
                    stream: _newStream,
                    hasVideo: !!_hasVideo,
                    trackVersion: prev.trackVersion + 1,
                }));
            }
        }
    }

    componentDidMount() {
        this._mounted = true;
        this.maybeAttachStream();
        // Force a video-subscription resume whenever this tile
        // mounts (and isn't gated as an off-screen thumbnail via
        // pauseVideo prop). The previous logic gated this on
        // `participant.videoPaused === true` — relying on the
        // local pause-flag staying in sync with the server. That
        // sync was fragile: ConferenceAudioParticipant pauses the
        // subscription whenever the user is in audio view, and a
        // mid-call hiccup (re-negotiation, brief network
        // interruption, server-side timeout) can leave the local
        // flag at false while the server still has the
        // subscription paused. The user-visible symptom is
        // "video disappeared after a while in video view, and a
        // round-trip to contacts list + back fixes it" (because
        // the unmount/remount forces a fresh resume). Calling
        // resumeVideo unconditionally is idempotent on the server
        // side (just `_sendUpdate({video: true})`), so it costs
        // nothing if the subscription was already active.
        if (!this.props.pauseVideo && !this.props.isLocal) {
            try { this.props.participant.resumeVideo(); } catch (e) { /* best effort */ }
        }

        // Defensive polling for the case where this tile mounts
        // AFTER the participant's PC was already established —
        // typically when the user was sitting in audio view while
        // remote participants joined, then flipped to video view.
        // The streamAdded event fired in the past; our subscription
        // in the constructor missed it. The streams getter returns
        // whatever tracks the PC currently has, but RTCView keys
        // off (URL, trackVersion) and won't refresh if the underlying
        // stream picks up new tracks via the getter's addTrack
        // mutation without a track-event landing.
        //
        // The retries below probe getReceivers a handful of times
        // after mount and force a refresh if the receiver track
        // set changed. Bounded so a participant that genuinely has
        // no video (the muted-camera audio-only case) doesn't churn
        // forever — once we see video or we've hit the cap, we
        // stop.
        this._retryAttempts = 0;
        this._retryTimer = null;
        this._scheduleAttachRetry();
    }

    _scheduleAttachRetry() {
        if (this.props.isLocal) return;
        if (this._retryTimer) return;
        const MAX_RETRIES = 8;        // 8 * 400 ms = ~3 s total
        const INTERVAL_MS = 400;
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            if (!this._mounted) return;
            this._retryAttempts += 1;
            const hadVideo = this.state.hasVideo;
            this.maybeAttachStream(true);
            const nowHasVideo = (this.props.participant.streams &&
                this.props.participant.streams[0] &&
                this.props.participant.streams[0].getVideoTracks().length > 0);
            // Keep retrying while:
            //   • we still haven't observed video tracks (the
            //     publisher's video might land late), AND
            //   • we're under the retry cap.
            // Stop the moment we see video, or the cap is reached.
            if (!nowHasVideo && this._retryAttempts < MAX_RETRIES) {
                this._scheduleAttachRetry();
            }
        }, INTERVAL_MS);
    }

    componentWillUnmount() {
        this._mounted = false;
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        if (!this.props.isLocal) {
            this.props.participant.removeListener('stateChanged', this.onParticipantStateChanged);
            this.props.participant.removeListener('streamAdded', this.onStreamAdded);
        }
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    onParticipantStateChanged(oldState, newState) {
        console.log('onParticipantStateChanged', newState);
        if (newState === 'established') {
            this.maybeAttachStream();
            // Same defensive resume as componentDidMount — if the
            // participant's subscription was re-established
            // (e.g. ICE restart, server-side reattach, view-
            // toggle pause/resume race) make sure we ask for
            // video. Local pause flag may be misleading; the
            // request is idempotent so re-calling is safe.
            if (!this.props.pauseVideo && !this.props.isLocal) {
                try { this.props.participant.resumeVideo(); } catch (e) { /* best effort */ }
            }
        }
    }

    handleResize(event) {
        // console.log(event.srcElement.videoWidth);
        const resolutions = ['1280x720', '960x540', '640x480', '640x360', '480x270', '320x180'];
        if (this.state.hasVideo) {
            const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
            if (resolutions.indexOf(videoResolution) === -1) {
                this.setState({sharesScreen: true});
            } else {
                this.setState({sharesScreen: false});
            }
        }
    }

    maybeAttachStream(bumpVersion = false) {
        // Two flavours of "isLocal=true" participant land here:
        //
        //   1. The picker's optimistic stand-in
        //        {id, publisherId, identity}                 — no streams
        //      pushed into state.activeSpeakers by applySpeakerLayout
        //      BEFORE the server's roomConfigured echo arrives.
        //
        //   2. Sylkrtc's post-echo synthetic self
        //        {id, publisherId, identity, streams: getLocalStreams()}
        //      built in react-native-sylkrtc/lib/conference.js when the
        //      server includes call.id in active_participants. This one
        //      already has a fully-populated `streams` array pointing at
        //      the local MediaStream.
        //
        // The previous code early-returned on `isLocal` to dodge a
        // (mis-described) crash from case (1) — but that also skipped
        // case (2), so a self-pinned tile rendered blank even though
        // the local stream was sitting right there.
        //
        // The defensive `if (streams && streams.length > 0)` guard
        // below already short-circuits the no-streams case safely,
        // so we don't need a separate isLocal bail-out. The other
        // isLocal-gated paths (constructor's `.on()` listener
        // registration, componentDidMount's `.resumeVideo()`,
        // _scheduleAttachRetry, onParticipantStateChanged,
        // componentWillUnmount's `.removeListener()`) all stay as
        // they were — the synthetic self is a plain object with
        // neither EventEmitter nor resumeVideo, so those skips are
        // still required.
        const streams = this.props.participant && this.props.participant.streams;
        //console.log('maybeAttachStream', streams);

        if (streams && streams.length > 0) {
            const _videoTracks = streams[0].getVideoTracks().length;
            const _audioTracks = streams[0].getAudioTracks().length;
            const _hadVideo = this.state.hasVideo;
            const _hasVideo = _videoTracks > 0;

            // [media] log every transition in the per-participant
            // video-track presence so a tile going gray (or
            // recovering) has a grep-able marker. Three things
            // can flip _hasVideo:
            //   • initial mount when receivers arrived in time —
            //     _hadVideo undefined → true (gained).
            //   • late-arriving receiver fires streamAdded (or the
            //     retry loop picks it up) — false → true (gained).
            //   • the publisher unpublished or the receiver track
            //     ended — true → false (lost). Doesn't happen via
            //     this code path today but logged defensively.
            if (_hasVideo !== _hadVideo) {
                const _uri = this.props.participant.identity
                    && this.props.participant.identity._uri;
                console.log('[conference] [media]',
                    _hasVideo ? 'GAINED' : 'LOST',
                    'video for',
                    _uri,
                    '— audio tracks:', _audioTracks,
                    'video tracks:', _videoTracks,
                    'trigger:', bumpVersion ? 'streamAdded/retry' : 'mount');
            }

            // Reading SylkRTC's participant.streams getter mutates
            // the underlying _stream object to include any newly
            // landed receiver tracks (see the addTrack loop in
            // the getter). The stream OBJECT identity doesn't
            // change as tracks accumulate, so React's setState
            // won't see a "different" reference for state.stream.
            // Bump trackVersion when we know the track set has
            // changed (streamAdded path) so the RTCView's key
            // changes and it remounts against the fresh track
            // list. Mount-time call goes through with bumpVersion
            // false because the initial render against streams[0]
            // already picks up whatever tracks are present at
            // that moment.
            this.setState((prev) => ({
                stream: streams[0],
                hasVideo: _hasVideo,
                trackVersion: bumpVersion ? prev.trackVersion + 1 : prev.trackVersion,
            }));

            // const options = {
            //     interval: 150,
            //     play: false
            // };
            // this.speechEvents = hark(streams[0], options);
            // this.speechEvents.on('speaking', () => {
            //     this.setState({active: true});
            // });
            // this.speechEvents.on('stopped_speaking', () => {
            //     this.setState({active: false});
            // });
        }
    }

    // First real video codec ("H264/42001f", "VP8", …) from an
    // RTCSessionDescription, or null when the m=video line is
    // absent / rejected / carries only rtx-red-ulpfec plumbing.
    // Mirrors ConferenceBox._pcVideoCodec's parser.
    _firstVideoCodec(desc) {
        try {
            if (!desc || !desc.sdp) return null;
            const m = desc.sdp.match(/^m=video\s+\d+\s+\S+\s+([\d ]+)\s*$/m);
            if (!m) return null;
            let section = desc.sdp.slice(desc.sdp.indexOf(m[0]));
            const next = section.indexOf('\nm=', 1);
            if (next > -1) section = section.slice(0, next);
            const ignored = /^(rtx|red|ulpfec|flexfec-03|cn)$/i;
            for (const pt of m[1].trim().split(/\s+/)) {
                const rtp = section.match(new RegExp('^a=rtpmap:' + pt + ' ([^/\\s]+)', 'm'));
                if (!rtp || ignored.test(rtp[1])) continue;
                const fmtp = section.match(new RegExp('^a=fmtp:' + pt + ' .*?profile-level-id=([0-9a-fA-F]{6})', 'm'));
                return fmtp ? rtp[1] + '/' + fmtp[1] : rtp[1];
            }
        } catch (e) { /* best effort */ }
        return null;
    }

    // Detects the undecodable-video case: the publisher's offer
    // carries a real video codec but our generated answer carries
    // NONE — libwebrtc found no shared codec and rejected the
    // m-line. Returns the codec the remote offered (so the chip
    // can say WHAT we couldn't decode), or null when negotiation
    // is fine / not applicable.
    _videoCodecMismatch() {
        try {
            const pc = this.props.participant && this.props.participant._pc;
            if (!pc || !pc.remoteDescription || !pc.localDescription) return null;
            const offered = this._firstVideoCodec(pc.remoteDescription);
            if (!offered) return null;             // remote sends no video at all
            const negotiated = this._firstVideoCodec(pc.localDescription);
            return negotiated ? null : offered;    // answer kept a codec → fine
        } catch (e) {
            return null;
        }
    }

    render() {
        // const classes = classNames({
        //     'poster' : !this.state.hasVideo,
        //     'fit'    : this.state.sharesScreen
        // });
        // const remoteVideoClasses = classNames({
        //     'remote-video'      : true,
        //     'large'             : this.props.large,
        //     'conference-active' : this.state.active
        // });

        //console.log('Participant', this.props.participant.identity.uri, 'status', this.state.status);

        // Compact label — prefer displayName, fall back to the
        // URI's local-part (everything before the @). Stripping
        // the domain keeps long SIP URIs from overflowing the
        // tile gradient and matches what the audio participant
        // list / contact list already show. Defensive against
        // both null displayName and a URI with no @.
        const _identity = this.props.participant.identity || {};
        const _rawLabel = _identity.displayName || _identity.uri || '';
        const _label = (_rawLabel.indexOf('@') > -1)
            ? _rawLabel.split('@')[0]
            : _rawLabel;
        const participantInfo = (
            <LinearGradient start={{x: 0, y: .55}}  end={{x: 0, y: 1}} colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, .5)']} style={styles.controls}>
                <Title
                    style={styles.lead}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {_label}
                </Title>
                <Text style={styles.status}>{this.state.status}</Text>
            </LinearGradient>
        );

        // Legacy green "Speaker" badge for the local tile is removed
        // — the new top-center pill ("Main speaker" / "Speaker 1" /
        // "Speaker 2") supersedes it, and the user identifies their
        // own tile via the self-PIP mirror / gradient name strip.
        let activeIcon = null;

        const remoteStreamUrl = this.state.stream ? this.state.stream.toURL() : null
        //console.log('remoteStreamUrl', remoteStreamUrl);

        // Per-tile inbound video bandwidth overlay. videoBandwidth
        // arrives in kbps from ConferenceBox.getConnectionStats
        // (computed off the inbound-rtp report's bytesReceived
        // delta). Suppress the chip when undefined / 0 so freshly
        // joined or stalled peers don't show a misleading "0 kbit/s"
        // before the first sample lands. Format swaps to Mbit/s past
        // 1024 kbps so a high-bitrate sender (≥1 Mbps) stays
        // readable.
        let _bwLabel = null;
        if (typeof this.props.videoBandwidth === 'number' && this.props.videoBandwidth > 0) {
            _bwLabel = this.props.videoBandwidth >= 1024
                ? (this.props.videoBandwidth / 1024).toFixed(1) + ' Mbit/s'
                : Math.round(this.props.videoBandwidth) + ' kbit/s';
        }

        // Per-tile speaker pill. Three sources:
        //   • activeSpeakers.length === 1 → "Main speaker"
        //   • activeSpeakers.length === 2 → "Speaker 1" / "Speaker 2"
        //   • else → no pill
        // ConferenceBox supplies the exact label via speakerLabel
        // so layout decisions stay in one place. Anchored to the
        // tile's bottom-right corner — see speakerTagWrapper.
        // Codec-mismatch warning chip — see codecWarnWrapper for
        // the rationale. Only meaningful on remote tiles (the
        // local tile renders our own camera, no decode involved).
        let codecWarning = null;
        if (!this.props.isLocal) {
            const _badCodec = this._videoCodecMismatch();
            if (_badCodec) {
                // Decode the H.264 profile hex for humans —
                // "H264/42001f" → "H264 Baseline 3.1 (42001f)".
                // Non-H264 / unknown hex falls back to the raw form.
                let _codecLabel = _badCodec;
                const _h = _badCodec.match(/^(H264)\/([0-9a-fA-F]{6})$/i);
                if (_h) {
                    const _friendly = utils.h264ProfileLevelName(_h[2]);
                    if (_friendly) {
                        _codecLabel = _h[1] + ' ' + _friendly + ' (' + _h[2] + ')';
                    }
                }
                codecWarning = (
                    <View style={styles.codecWarnWrapper}>
                        <Text style={styles.codecWarn} numberOfLines={2}>
                            {'Video codec not supported: ' + _codecLabel}
                        </Text>
                    </View>
                );
            }
        }

        const _pillLabel = this.props.speakerLabel;
        const mainSpeakerTag = _pillLabel ? (
            <View style={styles.speakerTagWrapper}>
                <Text style={styles.speakerTag}>{_pillLabel}</Text>
            </View>
        ) : null;

        // Degraded fallback — the participant is held in the matrix
        // (matrix-inertia strategy 1) but their media is lost.
        // Render an initials-on-coloured-circle avatar covering the
        // RTCView so the tile slot stays put without showing a black
        // square. Driven by the parent's `degraded` prop, set from
        // ConferenceBox.state.degradedOccupants. When the participant
        // recovers, parent clears the flag and the RTCView returns.
        let degradedOverlay = null;
        if (this.props.degraded) {
            // Initials: first letter of the label, uppercased. Falls
            // back to "?" when the label is empty (anonymous /
            // unknown participant).
            const _initial = (_label && _label.length > 0)
                ? _label.charAt(0).toUpperCase()
                : '?';
            // Background colour derived from a cheap hash of the
            // identity URI so the same person gets the same colour
            // every time. Eight-slot palette of muted Material hues.
            const _palette = ['#5e7cb2', '#7c5eb2', '#b25e92', '#b27c5e',
                              '#92b25e', '#5eb27c', '#5eb2b2', '#7c8a99'];
            const _src = (_identity.uri || _identity.displayName || '?');
            let _h = 0;
            for (let i = 0; i < _src.length; i++) {
                _h = ((_h << 5) - _h + _src.charCodeAt(i)) | 0;
            }
            const _bg = _palette[Math.abs(_h) % _palette.length];
            degradedOverlay = (
                <View style={{
                    position: 'absolute',
                    top: 0, bottom: 0, left: 0, right: 0,
                    backgroundColor: _bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 5,
                }}>
                    <View style={{
                        width: 88,
                        height: 88,
                        borderRadius: 44,
                        backgroundColor: 'rgba(255,255,255,0.18)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Text style={{
                            color: '#ffffff',
                            fontSize: 44,
                            fontWeight: '600',
                        }}>
                            {_initial}
                        </Text>
                    </View>
                </View>
            );
        }

        return (
			<View style={[{ flex: 1, width: '100%', height: '100%'}]}>
				{activeIcon}
				{mainSpeakerTag}
				{codecWarning}
				{participantInfo}
				{degradedOverlay}
				<View style={styles.videoContainer}>
					<RTCView
						// Keyed off trackVersion so the RTCView
						// remounts whenever a newly-arrived receiver
						// extended the stream's track list — see
						// maybeAttachStream + onStreamAdded for the
						// rationale. Without this, late-arriving
						// video receivers would mutate the same
						// stream object the RTCView was already bound
						// to and never refresh its rendered tracks,
						// leaving the tile gray.
						//
						// aspectRatio is part of the key as well:
						// the native RTCView does not always redraw
						// when objectFit changes on an existing
						// instance (most visible in solo fullscreen
						// where the self tile sits under Paper's
						// Surface — toggling "Aspect ratio" from the
						// Video... picker did nothing until the view
						// was forced to remount). Including it here
						// keeps every matrix tile in sync with the
						// self tile on toggle.
						key={`rtc-${remoteStreamUrl || 'none'}-${this.state.trackVersion}-${this.props.aspectRatio || 'cover'}`}
						// 'cover' fills the tile (may crop edges);
						// 'contain' fits the whole frame inside
						// (letterbox). Driven by ConferenceBox's
						// state.aspectRatio, toggled via the kebab
						// menu "Aspect ratio" item. Falls back to
						// 'cover' for safety when the prop isn't
						// wired upstream.
						objectFit={this.props.aspectRatio || 'cover'}
						style={styles.video}
						poster="assets/images/transparent-1px.png"
						ref={this.videoElement}
						streamURL={remoteStreamUrl}
					/>
					{/* Per-tile bandwidth chip suppressed — the
					    room-summary panel at top-right (rendered
					    by ConferenceBox._renderBandwidthOverview)
					    already lists every participant's reading
					    in one place, so the per-tile duplicate
					    was adding noise without adding info.
					    Re-enable by uncommenting if you want
					    inline-per-tile readings again.
					{_bwLabel ? (
						<View style={{
							position: 'absolute',
							top: 6,
							right: 6,
							paddingHorizontal: 6,
							paddingVertical: 2,
							borderRadius: 4,
							backgroundColor: 'rgba(0,0,0,0.55)',
							flexDirection: 'row',
							alignItems: 'center',
							maxWidth: '70%',
						}}>
							<Text style={{
								color: '#ffffff',
								fontSize: 11,
								fontVariant: ['tabular-nums'],
								marginRight: 6,
							}}>
								{_bwLabel}
							</Text>
							<Text
								numberOfLines={1}
								style={{
									color: '#ffffff',
									fontSize: 11,
									flexShrink: 1,
								}}
							>
								{_label}
							</Text>
						</View>
					) : null}
					*/}
				</View>
			</View>
        );
    }
}

ConferenceMatrixParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    isLocal: PropTypes.bool,
    status: PropTypes.string,
    audioMuted: PropTypes.bool,
    // Inbound video bandwidth in kbps for this participant,
    // sampled once per second by ConferenceBox.getConnectionStats
    // off the underlying inbound-rtp report's bytesReceived
    // delta. Used to render the bandwidth chip overlay on the
    // top-right of the tile. Optional — when absent / 0 the
    // chip is suppressed.
    videoBandwidth: PropTypes.number,
    // Optional pill label rendered at the top-center of the tile
    // ("Main speaker" / "Speaker 1" / "Speaker 2"). Driven by
    // ConferenceBox per activeSpeakers count + position. When
    // null/undefined no pill is rendered.
    speakerLabel: PropTypes.string,
    // Drives the portrait pill drop so it doesn't sit under the
    // floating action bar in fullscreen, or under the call
    // buttons bar in non-fullscreen.
    isLandscape: PropTypes.bool,
    // Whether the conference is currently in fullscreen mode.
    // Combined with isLandscape to pick the right pill offset
    // (fullscreen portrait: 48; non-fullscreen portrait: 160).
    isFullScreen: PropTypes.bool,
    // Aspect ratio for the RTCView objectFit, propagated from
    // ConferenceBox.state.aspectRatio so a single toggle flips
    // every tile at once.
    aspectRatio: PropTypes.string,
    // Matrix-inertia (strategy 1): when true, the participant's
    // media is lost and we render an initials avatar covering
    // the RTCView. Tile slot is preserved either way.
    degraded: PropTypes.bool,
};

export default ConferenceMatrixParticipant;
