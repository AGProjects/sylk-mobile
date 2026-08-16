// MediaInfoPanel — live media-plane diagnostic modal shared by
// AudioCallBox and VideoBox. Self-contained: takes the active sylkrtc
// `call`, a `visible` flag, an `onClose` callback, and an optional
// `mediaStuck` boolean. While visible it runs a 1 Hz pc.getStats()
// poller, parses the result + the local/remote SDP into a snapshot,
// and renders the same Dialog the AudioCallBox used to render inline.
//
// The component manages its own snapshot state and poller lifecycle
// so callers don't need to thread getStats / SDP parsing through their
// own state. Callers still own the `mediaStuck` signal (it comes from
// the per-call CallZrtp session) and pass it in so the panel can show
// the amber stuck banner when relevant.
//
// Why a separate component: AudioCallBox and VideoBox both need the
// same modal, the same poller behaviour, and the same SDP parsing —
// extracting avoids ~250 lines of duplication and keeps the parser
// rules consistent (e.g. a fix to candidate-pair display lands once,
// not twice).

import React, { Component } from 'react';
import {
    View,
    Platform,
    ScrollView,
    Modal,
    Pressable,
    StyleSheet,
    Dimensions,
} from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import PropTypes from 'prop-types';
// Share the Modal + overlay + Surface shell with AboutModal /
// EditContactModal / ShareLocationModal / ActiveLocationSharesModal /
// DeleteHistoryModal so the diagnostic panel uses the same
// rounded-corner card on a dimmed backdrop as every other dialog in
// the app. Replaces the old Paper Dialog/Portal wrapper that produced
// nested-Portal artefacts on iOS (two overlapping cards / scrims when
// rendered alongside the call-screen's own Portal block).
import containerStyles from '../assets/styles/ContainerStyles';
// Surface the qos-stats sampler's latest snapshot inside the modal.
// The sampler is started by AudioCallBox / ConferenceBox when the call
// reaches 'established' and updates its cache every 5 s — same numbers
// that land in metro.log as [qos] STATS lines. We don't start it from
// here; if the sampler isn't running (e.g. user opens the panel before
// call established), getLastQosSnapshot() simply returns null and the
// QoS section renders a "waiting for first sample" placeholder.
import { getLastQosSnapshot } from '../../qos/qos-stats';

const _mono = { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' };

// Parse a SDP string into [{kind, port, addr, proto, payloads,
// codecs, direction, rtcp}] for every m-line.
//   - session-level c= is used as fallback for m-sections without
//     their own c=.
//   - codecs are extracted from a=rtpmap.
//   - direction is set from a=sendrecv/sendonly/recvonly/inactive.
//   - rtcp port override from a=rtcp:<port>.
function parseMediaLines(sdp) {
    if (!sdp || typeof sdp !== 'string') return [];
    const lines = sdp.split(/\r?\n/);
    const out = [];
    let current = null;
    let sessionAddr = null;
    for (const raw of lines) {
        const ln = raw.trim();
        if (!ln) continue;
        if (ln.startsWith('c=') && current === null) {
            const parts = ln.substring(2).split(' ');
            if (parts.length >= 3) sessionAddr = parts[2];
            continue;
        }
        if (ln.startsWith('m=')) {
            if (current) out.push(current);
            const tail = ln.substring(2).split(' ');
            current = {
                kind: tail[0] || '?',
                port: tail[1] || '?',
                proto: tail[2] || '?',
                payloads: tail.slice(3),
                addr: sessionAddr || '?',
                rtcp: null,
                codecs: [],
                direction: null,
            };
            continue;
        }
        if (!current) continue;
        if (ln.startsWith('c=')) {
            const parts = ln.substring(2).split(' ');
            if (parts.length >= 3) current.addr = parts[2];
        } else if (ln.startsWith('a=rtcp:')) {
            current.rtcp = ln.substring(7).split(' ')[0];
        } else if (ln.startsWith('a=rtpmap:')) {
            const m = /^a=rtpmap:(\d+)\s+(\S+)/.exec(ln);
            if (m) {
                current.codecs.push({ pt: m[1], name: m[2] });
            }
        } else if (ln === 'a=sendrecv' || ln === 'a=sendonly'
                   || ln === 'a=recvonly' || ln === 'a=inactive') {
            current.direction = ln.substring(2);
        }
    }
    if (current) out.push(current);
    return out;
}

// Pull a structured snapshot out of an RTCPeerConnection's getStats()
// result + its current local/remote SDP.
async function snapshotMedia(call) {
    const pc = call && call._pc;
    if (!pc || typeof pc.getStats !== 'function') return null;
    let stats;
    try {
        stats = await pc.getStats();
    } catch (_) {
        return null;
    }
    const inbound = [];
    const outbound = [];
    const pairs = [];
    const codecs = new Map();
    let iceConnectionState = pc.iceConnectionState || '?';
    let selectedPairId = null;
    let transportBytesReceived = 0;
    let transportBytesSent = 0;
    stats.forEach((r) => {
        if (!r) return;
        if (r.type === 'codec') {
            codecs.set(r.id, {
                mimeType: r.mimeType || null,
                clockRate: r.clockRate || null,
                channels: r.channels || null,
                payloadType: r.payloadType != null ? r.payloadType : null,
            });
        } else if (r.type === 'inbound-rtp') {
            inbound.push({
                kind: r.kind || r.mediaType || '?',
                ssrc: r.ssrc != null ? r.ssrc : null,
                packetsReceived: Number(r.packetsReceived || 0),
                bytesReceived: Number(r.bytesReceived || 0),
                packetsLost: Number(r.packetsLost || 0),
                jitter: r.jitter != null ? r.jitter : null,
                codecId: r.codecId || null,
            });
        } else if (r.type === 'outbound-rtp') {
            outbound.push({
                kind: r.kind || r.mediaType || '?',
                ssrc: r.ssrc != null ? r.ssrc : null,
                packetsSent: Number(r.packetsSent || 0),
                bytesSent: Number(r.bytesSent || 0),
                codecId: r.codecId || null,
            });
        } else if (r.type === 'transport') {
            transportBytesReceived += Number(r.bytesReceived || 0);
            transportBytesSent += Number(r.bytesSent || 0);
            if (r.selectedCandidatePairId) selectedPairId = r.selectedCandidatePairId;
        } else if (r.type === 'candidate-pair') {
            pairs.push({
                id: r.id,
                state: r.state || '?',
                nominated: !!r.nominated,
                bytesReceived: Number(r.bytesReceived || 0),
                bytesSent: Number(r.bytesSent || 0),
                currentRoundTripTime: r.currentRoundTripTime != null
                    ? r.currentRoundTripTime : null,
            });
        }
    });
    for (const row of inbound) {
        if (row.codecId && codecs.has(row.codecId)) {
            row.codec = codecs.get(row.codecId).mimeType;
        }
    }
    for (const row of outbound) {
        if (row.codecId && codecs.has(row.codecId)) {
            row.codec = codecs.get(row.codecId).mimeType;
        }
    }
    const local = (pc.localDescription && pc.localDescription.sdp) || null;
    const remote = (pc.remoteDescription && pc.remoteDescription.sdp) || null;
    return {
        capturedAt: Date.now(),
        iceConnectionState,
        selectedPairId,
        transportBytesReceived,
        transportBytesSent,
        inbound,
        outbound,
        pairs,
        localMedia: parseMediaLines(local),
        remoteMedia: parseMediaLines(remote),
    };
}

class MediaInfoPanel extends Component {
    constructor(props) {
        super(props);
        this.state = {
            snapshot: null,
            qos: null,
            winHeight: Dimensions.get('window').height,
            // Tracked alongside winHeight so render() can tell portrait
            // from landscape without a prop — the card's horizontal
            // safe-area handling differs between the two.
            winWidth: Dimensions.get('window').width,
        };
        this._poller = null;
    }

    componentDidMount() {
        // Track viewport height so the modal can re-cap its scroll area
        // the instant the phone rotates while the panel is open —
        // otherwise a portrait-sized card would linger after rotating to
        // landscape (and vice-versa) until the next poll re-render.
        this._dimSub = Dimensions.addEventListener('change', ({ window }) => {
            if (!window || !window.height || !window.width) return;
            if (window.height !== this.state.winHeight
                    || window.width !== this.state.winWidth) {
                this.setState({ winHeight: window.height, winWidth: window.width });
            }
        });
        if (this.props.visible) {
            this._start();
        }
    }

    componentDidUpdate(prevProps) {
        if (this.props.visible && !prevProps.visible) {
            this._start();
        } else if (!this.props.visible && prevProps.visible) {
            this._stop();
        }
    }

    componentWillUnmount() {
        if (this._dimSub && typeof this._dimSub.remove === 'function') {
            this._dimSub.remove();
            this._dimSub = null;
        }
        this._stop();
    }

    _start() {
        this._refresh();
        if (this._poller) return;
        this._poller = setInterval(() => this._refresh(), 1000);
    }

    _stop() {
        if (this._poller) {
            clearInterval(this._poller);
            this._poller = null;
        }
    }

    async _refresh() {
        // In-flight guard: snapshotMedia() awaits pc.getStats(). If it
        // runs slower than the 1s poll, overlapping ticks would stack
        // pending native callbacks. Skip while a refresh is pending;
        // the stale-timeout re-arms if a getStats promise is ever lost.
        if (this._refreshInFlight
                && (Date.now() - this._refreshInFlightSince) < 5000) {
            return;
        }
        this._refreshInFlight = true;
        this._refreshInFlightSince = Date.now();
        try {
            const snap = await snapshotMedia(this.props.call);
            if (this._poller === null && !this.props.visible) return;
            // Pull the latest qos-stats sample alongside the local getStats
            // snapshot. getLastQosSnapshot() is synchronous (it just reads a
            // module-level cache populated by the qos-stats sampler every
            // 5 s) so there's no extra await here.
            const qos = getLastQosSnapshot();
            this.setState({ snapshot: snap, qos });
        } catch (e) {
            // getStats can throw transiently during teardown — ignore and
            // let the next tick retry.
        } finally {
            this._refreshInFlight = false;
        }
    }

    _row(k, v) {
        return (
            <View key={k} style={{ flexDirection: 'row', marginBottom: 2 }}>
                <Text style={[_mono, { fontSize: 11, color: '#444', minWidth: 130 }]}>
                    {k}
                </Text>
                <Text style={[_mono, { fontSize: 11, color: '#000', flex: 1 }]}>
                    {String(v)}
                </Text>
            </View>
        );
    }

    _sectionHeader(label) {
        return (
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#222', marginTop: 10, marginBottom: 4 }}>
                {label}
            </Text>
        );
    }

    _renderMediaLines(mlines) {
        if (!mlines || mlines.length === 0) {
            return (
                <Text style={[_mono, { fontSize: 10, color: '#888' }]}>
                    (none)
                </Text>
            );
        }
        return mlines.map((m, i) => {
            const codecList = m.codecs.length
                ? m.codecs.map(c => c.pt + ':' + c.name).join(', ')
                : (m.payloads || []).join(',');
            return (
                <View key={'m' + i} style={{ marginBottom: 6 }}>
                    <Text style={[_mono, { fontSize: 11, color: '#000', fontWeight: '600' }]}>
                        {m.kind} {m.addr}:{m.port}
                        {m.direction ? ' [' + m.direction + ']' : ''}
                    </Text>
                    <Text style={[_mono, { fontSize: 10, color: '#555' }]}>
                        proto={m.proto}
                        {m.rtcp ? '  rtcp=' + m.rtcp : ''}
                    </Text>
                    <Text style={[_mono, { fontSize: 10, color: '#555' }]}>
                        codecs: {codecList || '(none)'}
                    </Text>
                </View>
            );
        });
    }

    render() {
        if (!this.props.visible) return null;
        const snap = this.state.snapshot;
        const close = this.props.onClose;
        const mediaStuck = !!this.props.mediaStuck;
        const isFolded = !!this.props.isFolded;

        // LANDSCAPE horizontal safe area.
        //
        // The panel lives in a plain RN <Modal>, which is always
        // presented EDGE TO EDGE — it is not a child of the app-level
        // SafeAreaView, so it knows nothing about the notch. In
        // portrait that's harmless (left/right insets are 0), but in
        // landscape iOS reports a ~44-59 px inset on the sensor-housing
        // side, and containerStyles.overlay's flat padding:16 let the
        // card run straight under it. The result was a card visibly
        // WIDER than the call content behind it and off-centre relative
        // to the visible area.
        //
        // Fix: in landscape, pad the overlay by the real inset on each
        // side on top of the usual 16. The card then matches the width
        // of the content underneath and sits centred in the area the
        // user can actually see. this.context is the safe-area inset
        // object (wired up via MediaInfoPanel.contextType at the bottom
        // of this file); React context crosses the Modal boundary, so
        // the values stay live across rotation.
        const _ctxInsets = this.context || {};
        const _leftInset = _ctxInsets.left || 0;
        const _rightInset = _ctxInsets.right || 0;
        const _winWidth = this.state.winWidth || Dimensions.get('window').width;
        const _isLandscape = _winWidth > (this.state.winHeight
            || Dimensions.get('window').height);
        const _landscapeInsetPad = (!isFolded && _isLandscape
                && (_leftInset || _rightInset))
            ? { paddingLeft: 16 + _leftInset, paddingRight: 16 + _rightInset }
            : null;

        // Folded (cover-display) overrides — the Razr outer screen is
        // narrow and short; the default modal overlay padding (16)
        // plus modalSurface borderRadius / title would push the
        // scrollable content out of view. Compact every wrapper.
        const overlayStyle = isFolded
            ? [containerStyles.overlay, { padding: 4 }]
            : [containerStyles.overlay, _landscapeInsetPad];
        const surfaceStyle = isFolded
            ? [containerStyles.modalSurface, { padding: 2 }]
            : containerStyles.modalSurface;
        const titleStyle = isFolded
            ? [containerStyles.title, { fontSize: 13, paddingTop: 4, paddingBottom: 2, marginBottom: 0 }]
            : containerStyles.title;

        // Cap the scroll area to the current viewport so the whole card
        // (title + scroll body + Close button) fits on screen. In
        // landscape the phone is only ~360-400 px tall, so the fixed
        // 420 px portrait height pushed the title and Close button off
        // both edges. Subtract the modal chrome (overlay padding + title
        // + button row + surface padding, ~200 px) from the window
        // height, clamp to a sane floor, and keep portrait at its
        // original 420 px ceiling so that layout is unchanged.
        const winHeight = this.state.winHeight
            || Dimensions.get('window').height;
        const scrollMaxHeight = isFolded
            ? 220
            : Math.min(420, Math.max(140, Math.round(winHeight - 200)));
        return (
            <Modal
                visible={true}
                transparent
                animationType="fade"
                onRequestClose={close}
                /* iOS-only — without this, RN's Modal defaults to
                   supportedOrientations: ['portrait'], which forces the
                   underlying app to portrait while the modal is presented.
                   Include both landscape variants so the modal inherits
                   whichever orientation the user is in. */
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <View style={overlayStyle}>
                    {/* Backdrop-as-sibling pattern, mirrored from
                        SwitchAccountModal: a Pressable that absolute-fills
                        the overlay, rendered BEFORE the Surface so the
                        Surface ends up on top in z-order. Tap outside
                        the Surface → Pressable fires onPress → modal
                        closes. Tap on the Surface → Surface absorbs the
                        touch; the Pressable underneath sees nothing.

                        Why this instead of TouchableWithoutFeedback
                        wrapping the Surface: any tap-handler wrapping
                        the Surface ends up in a responder fight with
                        the inner ScrollView on Android. The wrapper
                        claims the responder on touch start, the
                        ScrollView tries to take it back on move, and
                        the hand-off fails — the panel shows a
                        scrollbar but pan gestures do nothing. The
                        sibling-backdrop layout leaves the ScrollView
                        as the only responder candidate inside the
                        card, so vertical pans always reach it. */}
                    <Pressable
                        style={StyleSheet.absoluteFillObject}
                        onPress={close}
                        accessibilityLabel="Close"
                    />
                    <Surface style={surfaceStyle}>
                        <Text style={titleStyle}>Media info</Text>
                        <ScrollView
                            style={{ maxHeight: scrollMaxHeight }}
                            contentContainerStyle={{ paddingHorizontal: isFolded ? 6 : 16, paddingBottom: isFolded ? 4 : 8 }}
                            keyboardShouldPersistTaps="handled"
                            /* Same Android gesture-path tightening
                               SwitchAccountModal / PreferencesModal use:
                                 nestedScrollEnabled — let the inner
                                   ScrollView take pans even if the
                                   ancestor view tree includes scrollables;
                                 removeClippedSubviews=false — keeps
                                   off-screen rows mounted so a fast pan
                                   doesn't get dropped mid-flick by a
                                   freshly mounted child claiming the
                                   responder;
                                 directionalLockEnabled — once the pan is
                                   vertical, ignore sideways thumb wobble;
                                 overScrollMode 'always' (Android) — show
                                   the edge glow so the panel reads as
                                   scrollable even when content barely
                                   exceeds maxHeight;
                                 scrollEventThrottle + decelerationRate —
                                   snappy feel matching the rest of the
                                   modal pickers. */
                            nestedScrollEnabled={true}
                            showsVerticalScrollIndicator={true}
                            overScrollMode={Platform.OS === 'android' ? 'always' : undefined}
                            removeClippedSubviews={false}
                            directionalLockEnabled={true}
                            scrollEventThrottle={16}
                            decelerationRate="normal"
                        >
                            {mediaStuck && (
                                <View style={{
                                    backgroundColor: 'rgba(230, 120, 0, 0.12)',
                                    borderLeftWidth: 3,
                                    borderLeftColor: 'rgba(230, 120, 0, 0.95)',
                                    padding: 8,
                                    marginBottom: 10,
                                }}>
                                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#a05a00', marginBottom: 4 }}>
                                        ⚠ Media stuck
                                    </Text>
                                    <Text style={{ fontSize: 11, color: '#5a3a00' }}>
                                        ZRTP handshake completed and SRTP is installed on both
                                        sides, but no inbound RTP has arrived for over 5 s.
                                        Audio will be silent until media flows. Likely:
                                        (a) peer never sent media; (b) peer aborted encryptor
                                        install; (c) Janus dropped the stream; (d) DTLS-SRTP
                                        unwrap failing on the Janus→mobile leg.
                                    </Text>
                                </View>
                            )}
                            {snap ? (
                                <View>
                                    {this._sectionHeader('Audio actually flowing?')}
                                    <Text style={{ fontSize: 11, color: '#555', marginBottom: 6, fontStyle: 'italic' }}>
                                        These counters only move when real RTP audio is decoded.
                                    </Text>
                                    <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#222', marginBottom: 2 }}>
                                        Incoming
                                    </Text>
                                    {snap.inbound.length === 0 ? (
                                        <Text style={[_mono, { fontSize: 11, color: '#a00' }]}>
                                            (no inbound-rtp reports — peer never sent media)
                                        </Text>
                                    ) : snap.inbound.map((r, i) => {
                                        const noMedia = r.packetsReceived === 0;
                                        return (
                                            <Text key={'in' + i} style={[_mono, { fontSize: 11, color: noMedia ? '#a00' : '#0a6' }]}>
                                                {r.kind} pkts={r.packetsReceived} bytes={r.bytesReceived} lost={r.packetsLost} jitter={r.jitter != null ? r.jitter : '?'} codec={r.codec || r.codecId || '?'}
                                            </Text>
                                        );
                                    })}
                                    <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#222', marginTop: 6, marginBottom: 2 }}>
                                        Outgoing
                                    </Text>
                                    {snap.outbound.length === 0 ? (
                                        <Text style={[_mono, { fontSize: 11, color: '#888' }]}>
                                            (no outbound-rtp reports)
                                        </Text>
                                    ) : snap.outbound.map((r, i) => {
                                        const noMedia = r.packetsSent === 0;
                                        return (
                                            <Text key={'out' + i} style={[_mono, { fontSize: 11, color: noMedia ? '#a60' : '#0a6' }]}>
                                                {r.kind} pkts={r.packetsSent} bytes={r.bytesSent} codec={r.codec || r.codecId || '?'}
                                            </Text>
                                        );
                                    })}

                                    {this._sectionHeader('QoS sampler (last [qos] STATS)')}
                                    {this.state.qos ? (() => {
                                        const q = this.state.qos;
                                        // Visual cues: red when pps_recv is
                                        // zero/unknown (the headline "no
                                        // audio arriving" failure mode),
                                        // green when it's near the 50 pps
                                        // Opus rate, amber when it's far
                                        // below.
                                        const pps = (typeof q.ppsRecv === 'string' && /^\d+$/.test(q.ppsRecv))
                                            ? parseInt(q.ppsRecv, 10) : null;
                                        let ppsColor = '#888';
                                        if (pps === 0) ppsColor = '#a00';
                                        else if (pps != null && pps >= 40) ppsColor = '#0a6';
                                        else if (pps != null) ppsColor = '#a60';
                                        const ageSec = Math.round((Date.now() - q.capturedAt) / 1000);
                                        return (
                                            <View>
                                                <Text style={[_mono, { fontSize: 11, color: '#666' }]}>
                                                    {q.local} {'<->'} {q.remote}
                                                </Text>
                                                <Text style={[_mono, { fontSize: 11, color: ppsColor, fontWeight: 'bold' }]}>
                                                    pps_recv={q.ppsRecv}{pps === 0 ? '  (no audio arriving)' : ''}
                                                </Text>
                                                <Text style={[_mono, { fontSize: 11, color: '#333' }]}>
                                                    loss_out={q.lossOut}%  loss_in={q.lossIn}%
                                                </Text>
                                                <Text style={[_mono, { fontSize: 11, color: '#333' }]}>
                                                    conceal={q.concealPct}%  jb_delay={q.jbDelayMs}ms  jb_flushes={q.jbFlushesDelta}
                                                </Text>
                                                <Text style={[_mono, { fontSize: 11, color: '#333' }]}>
                                                    rtt={q.rttMs}ms
                                                </Text>
                                                <Text style={{ fontSize: 10, color: '#999', marginTop: 4, fontStyle: 'italic' }}>
                                                    sample age: {ageSec}s (qos sampler refreshes every 5 s)
                                                </Text>
                                            </View>
                                        );
                                    })() : (
                                        <Text style={[_mono, { fontSize: 11, color: '#888' }]}>
                                            (waiting for first qos sample — first one lands ~5 s after call established)
                                        </Text>
                                    )}

                                    {this._sectionHeader('Network plumbing (not media)')}
                                    <Text style={{ fontSize: 11, color: '#888', marginBottom: 6, fontStyle: 'italic' }}>
                                        Includes STUN keepalives + DTLS. NOT the same as audio bytes — these grow even when the call is silent.
                                    </Text>
                                    <Text style={[_mono, { fontSize: 10, color: '#666' }]}>
                                        ICE state: {snap.iceConnectionState}
                                    </Text>
                                    <Text style={[_mono, { fontSize: 10, color: '#666' }]}>
                                        transport rx={snap.transportBytesReceived} tx={snap.transportBytesSent}
                                    </Text>
                                    {snap.pairs.length === 0 ? (
                                        <Text style={[_mono, { fontSize: 10, color: '#888' }]}>
                                            (no candidate pairs)
                                        </Text>
                                    ) : snap.pairs.map((p, i) => (
                                        <Text key={'cp' + i} style={[_mono, { fontSize: 10, color: '#666' }]}>
                                            {p.nominated ? '★ ' : '  '}{p.state} rx={p.bytesReceived} tx={p.bytesSent} rtt={p.currentRoundTripTime != null ? p.currentRoundTripTime + 's' : '?'}
                                        </Text>
                                    ))}

                                    {this._sectionHeader('Local SDP m-lines (port → IP)')}
                                    {this._renderMediaLines(snap.localMedia)}

                                    {this._sectionHeader('Remote SDP m-lines (port → IP)')}
                                    {this._renderMediaLines(snap.remoteMedia)}

                                    <Text style={{ fontSize: 10, color: '#999', marginTop: 12 }}>
                                        Captured {snap.capturedAt
                                            ? new Date(snap.capturedAt).toLocaleTimeString()
                                            : '?'} — refreshes every 1 s while open.
                                    </Text>
                                </View>
                            ) : (
                                <Text style={{ fontSize: 12, color: '#666' }}>
                                    Media snapshot not yet available — waiting for first poll…
                                </Text>
                            )}
                        </ScrollView>
                        <View style={{
                            flexDirection: 'row',
                            justifyContent: 'flex-end',
                            paddingHorizontal: isFolded ? 4 : 8,
                            paddingVertical: isFolded ? 2 : 8,
                        }}>
                            <Button compact={isFolded} onPress={close}>Close</Button>
                        </View>
                    </Surface>
                </View>
            </Modal>
        );
    }
}

// Legacy context API on the class (rather than a `static contextType`
// class field) so this stays valid whatever the Babel class-properties
// setup is. Gives render() `this.context` = { top, bottom, left, right }
// from react-native-safe-area-context — needed because the panel is a
// bare RN <Modal> and therefore renders OUTSIDE the app-level
// SafeAreaView. Context still flows across the Modal boundary (it's a
// React tree relationship, not a native-view one).
MediaInfoPanel.contextType = SafeAreaInsetsContext;

MediaInfoPanel.propTypes = {
    call: PropTypes.object,
    visible: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    mediaStuck: PropTypes.bool,
    isFolded: PropTypes.bool,
};

MediaInfoPanel.defaultProps = {
    mediaStuck: false,
    isFolded: false,
};

export default MediaInfoPanel;
