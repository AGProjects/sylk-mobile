// NetworkSpeedometer.js
//
// Two visual dials shown side-by-side in the in-call header:
//
//   1. Bandwidth dial — single 180° dial with two needles.
//      blue  needle  = upload   bits/s
//      white needle  = download bits/s
//      color zones grow red → orange → yellow → green as bitrate rises.
//
//   2. Network quality dial — single 180° dial with two needles.
//      blue  needle  = round-trip-time (ms, 0–500 scale)
//      white needle  = packet loss     (%,  0–10 scale)
//      color zones grow green → yellow → orange → red as the metrics
//      grow worse, so a needle on the LEFT of the dial means good and
//      a needle on the RIGHT means trouble.
//
// The component subscribes to call.statistics on mount and recomputes
// the four values on every 'stats' event. Smoothing window is 15s
// (3 samples at sylkrtc's 5s polling interval).

import React from 'react';
import PropTypes from 'prop-types';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, G, Text as SvgText, TSpan } from 'react-native-svg';


// ---------- dial geometry ---------------------------------------------------

// 20% smaller than the original 80×48 sizing, so two dials sit
// comfortably to the right of the title without crowding the kebab.
const W = 64;
const H = 38;
const CX = W / 2;
const CY = H - 4;
const R  = W / 2 - 3;

// Polar -> cartesian. 0° = left (9 o'clock), 90° = up, 180° = right (3 o'clock).
function polar(angleDeg, radius = R) {
    const rad = (Math.PI * (180 - angleDeg)) / 180;
    return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

function arcPath(startDeg, endDeg, radius = R) {
    const s = polar(startDeg, radius);
    const e = polar(endDeg, radius);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
}

// ---------- single-color arc selection --------------------------------------
//
// The arc is a single solid color per dial that reflects the current
// metric's quality band — no multi-zone gradient. Colors picked from
// the same palette AudioSpeedometer uses for textual readouts.

const COLOR_GREEN  = '#2ecc71';
const COLOR_ORANGE = '#e67e22';
const COLOR_RED    = '#e74c3c';

// Bandwidth (total bits/s, up+down): low = green, high = red.
// User-defined thresholds: < 1 Mbps green, > 3 Mbps red, else orange.
function bandwidthColor(bitsPerSec) {
    if (bitsPerSec > 3_000_000) return COLOR_RED;
    if (bitsPerSec < 1_000_000) return COLOR_GREEN;
    return COLOR_ORANGE;
}

// RTT (ms): matches AudioSpeedometer's rttColor — high = bad.
function rttColor(rttMs) {
    if (rttMs > 350) return COLOR_RED;
    if (rttMs < 200) return COLOR_GREEN;
    return COLOR_ORANGE;
}

// Needle colors.
const COLOR_UPLOAD   = '#3498db'; // blue
const COLOR_DOWNLOAD = '#ffffff'; // white
const COLOR_RTT      = '#3498db'; // blue
const COLOR_LOSS     = '#ffffff'; // white

// ---------- format helpers --------------------------------------------------

function fmtBits(b) {
    if (b > 1_000_000) return (b / 1_000_000).toFixed(1) + 'M';
    if (b > 1_000)     return (b / 1_000).toFixed(0)     + 'k';
    if (b <= 0)        return '0';
    return b.toFixed(0);
}

// ---------- codec feature parsing -------------------------------------------
//
// Mirrors the AudioSpeedometer's parseFmtp / buildFeatureTokens but for
// video. Shows the codec-specific knobs we can extract from the negotiated
// SDP fmtp line, so the user can see e.g. H.264 profile + packetization
// mode, VP9 profile-id, or AV1 profile/level.

function parseFmtp(line) {
    const out = {};
    if (!line || typeof line !== 'string') return out;
    line.split(';').forEach((kv) => {
        const eq = kv.indexOf('=');
        if (eq < 0) return;
        const k = kv.slice(0, eq).trim().toLowerCase();
        const v = kv.slice(eq + 1).trim();
        if (k) out[k] = v;
    });
    return out;
}

// Pretty-name the H.264 profile_idc byte (first byte of profile-level-id).
// Profile values per ITU-T H.264 Annex A.
function h264ProfileName(profileLevelId) {
    if (!profileLevelId || profileLevelId.length < 6) return null;
    const idc = parseInt(profileLevelId.slice(0, 2), 16);
    const iop = parseInt(profileLevelId.slice(2, 4), 16);
    let name;
    switch (idc) {
        case 0x42: name = (iop & 0x40) ? 'CB' : 'B'; break; // Constrained baseline / Baseline
        case 0x4D: name = 'M'; break; // Main
        case 0x58: name = 'EX'; break; // Extended
        case 0x64: name = 'H'; break;  // High
        case 0x6E: name = 'H10'; break; // High 10
        case 0x7A: name = 'H422'; break; // High 4:2:2
        case 0xF4: name = 'H444'; break; // High 4:4:4
        default:   name = '0x' + idc.toString(16); break;
    }
    // level_idc → "3.1" form: e.g. 0x1f = 31 → "3.1"
    const levelByte = parseInt(profileLevelId.slice(4, 6), 16);
    const levelStr = (Math.floor(levelByte / 10) + '.' + (levelByte % 10));
    return name + ' ' + levelStr;
}

// Returns an array of short tokens. Caller joins with " · ".
function buildVideoFeatureTokens(videoCodec, codecMeta, framesPerSecond) {
    const tokens = [];
    if (framesPerSecond && framesPerSecond > 0) {
        tokens.push(Math.round(framesPerSecond) + 'fps');
    }
    if (!codecMeta) return tokens;
    const fmtp = codecMeta.fmtp || {};
    const codec = (videoCodec || '').toUpperCase().replace(/^VIDEO\//, '');

    if (codec === 'H264') {
        const prof = h264ProfileName(fmtp['profile-level-id']);
        if (prof) tokens.push(prof);
        if (fmtp['packetization-mode']) tokens.push('pkt' + fmtp['packetization-mode']);
    } else if (codec === 'VP9') {
        if (fmtp['profile-id'] !== undefined) tokens.push('p' + fmtp['profile-id']);
    } else if (codec === 'AV1') {
        if (fmtp['profile'] !== undefined) tokens.push('p' + fmtp['profile']);
        if (fmtp['level-idx'] !== undefined) tokens.push('L' + fmtp['level-idx']);
    }
    if (fmtp['max-fr']) tokens.push('≤' + fmtp['max-fr'] + 'fps');
    return tokens;
}

// ---------- one dial, possibly multi-needle ---------------------------------

// centerLabel can be:
//   - a string (rendered uniformly white)
//   - an array of {text, color} segments (rendered as colored TSpans
//     joined inline so each part can match the corresponding needle)
//
// arcColor: single solid color for the 180° dial border. Caller picks
// the color based on the current metric (e.g. bandwidthColor / rttColor).
function Dial({ arcColor, needles, caption, centerLabel }) {
    return (
        <View style={styles.dial}>
            <Svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                // Multiple flags to convince Android that the SVG's
                // backing surface should be transparent. The grey-fill
                // we saw was the SurfaceView's default tint.
                style={{ backgroundColor: 'transparent' }}
                opacity={1}
                renderToHardwareTextureAndroid={false}
                needsOffscreenAlphaCompositing
                collapsable={false}
            >
                <G>
                    <Path
                        d={arcPath(0, 180)}
                        stroke={arcColor}
                        strokeWidth={3}
                        fill="none"
                        strokeLinecap="round"
                    />
                    {centerLabel ? (
                        // Sits in the empty area above the pivot, between
                        // the two needles' resting positions. Supports
                        // either a plain string or an array of colored
                        // segments so each part can match a needle color.
                        <SvgText
                            x={CX}
                            y={CY - R * 0.4}
                            fill="#ffffff"
                            fontSize={10}
                            fontWeight="700"
                            textAnchor="middle"
                            alignmentBaseline="middle"
                        >
                            {Array.isArray(centerLabel)
                                ? centerLabel.map((seg, i) => (
                                    <TSpan key={i} fill={seg.color || '#ffffff'}>
                                        {seg.text}
                                    </TSpan>
                                  ))
                                : centerLabel}
                        </SvgText>
                    ) : null}
                    {needles.map((n, i) => {
                        const clamped = Math.min(Math.max(n.value, 0), n.max);
                        const tip = polar((clamped / n.max) * 180, R - 2);
                        return (
                            <Line
                                key={'n' + i}
                                x1={CX} y1={CY}
                                x2={tip.x} y2={tip.y}
                                stroke={n.color}
                                strokeWidth={1.6}
                                strokeLinecap="round"
                            />
                        );
                    })}
                    <Circle cx={CX} cy={CY} r={2.2} fill="#fff" />
                </G>
            </Svg>
            {caption}
        </View>
    );
}

// Per-call running state, kept module-scoped so toggling between the
// header-embedded speedometer and the fullscreen overlay doesn't wipe
// the previous-bytes / history buffer (which would yield 0-bitrate
// readings for ~10s after every remount). Keyed by call object id.
//
// Cleared lazily — the entry is replaced when a new call with the same
// id object never reappears, and JS GC reclaims it once no speedometer
// instance still references it.
const _runningState = new WeakMap();

function _getCallState(call) {
    if (!call) return null;
    let s = _runningState.get(call);
    if (!s) {
        s = {
            // Per-PC running state, keyed by connectionId. In a conference
            // sylkrtc emits one 'stats' event per peer-connection (publisher
            // PC for upload + one subscriber PC per remote for download).
            // Keeping prev-bytes per PC is essential — sharing 'vDown'
            // across PCs gives garbage deltas (alternating B1, B2, B1, …).
            //
            // Each entry: { prev: {kind→{bytes,ts}}, up, down, ts }
            //   up/down  = this PC's last computed bps
            //   ts       = wall time of the last event from this PC; used
            //              to age out PCs whose participant has left.
            pcs: {},
            history: [],
            snapshot: {
                up: 0, down: 0, rtt: 0, loss: 0,
                videoCodec: '', audioCodec: '',
                inW: 0,  inH: 0,
                outW: 0, outH: 0,
                fps: 0,
                videoCodecMeta: null,
            },
        };
        _runningState.set(call, s);
    }
    return s;
}


// ---------- top-level subscriber + renderer ---------------------------------

export default class NetworkSpeedometer extends React.Component {
    static propTypes = {
        call: PropTypes.object,
        videoCodec: PropTypes.string,
        audioCodec: PropTypes.string,
        // When true, render an extra caption row below the dials with
        // the inbound and outbound video resolutions ("in WxH out WxH").
        // The header-embedded speedometer keeps this off; the fullscreen
        // overlay turns it on so the resolutions sit just under the dials.
        showResolution: PropTypes.bool,
    };

    // Tunable scales — change here if your environment regularly
    // exceeds these and you want more headroom on the dial.
    static BANDWIDTH_MAX_BPS = 3_000_000; // 3 Mbps full deflection
                                          // (needle pins at max if rate > 3 Mbps)
    static RTT_MAX_MS        = 1000;      // 1 s   full deflection
                                          // (needle pins at max if RTT  > 1000 ms)
    static LOSS_MAX_PCT      = 30;        // 30%   full deflection
                                          // (needle pins at max if loss > 30%)

    constructor(props) {
        super(props);
        // Seed state from the per-call running snapshot so a freshly
        // remounted speedometer (e.g. after toggling fullscreen) shows
        // the last known readings instead of zeroed dials.
        const seeded = _getCallState(props.call);
        this.state = seeded
            ? { ...seeded.snapshot }
            : {
                up: 0, down: 0, rtt: 0, loss: 0,
                videoCodec: '', audioCodec: '',
                inW: 0,  inH: 0,
                outW: 0, outH: 0,
            };
        this._onStats = this._onStats.bind(this);
    }

    componentDidMount()  { this._attach(this.props.call); }
    componentWillUnmount() { this._detach(this.props.call); }
    componentDidUpdate(prevProps) {
        if (prevProps.call !== this.props.call) {
            this._detach(prevProps.call);
            this._attach(this.props.call);
        }
    }

    _attach(call) {
        if (call && call.statistics) {
            call.statistics.on('stats', this._onStats);
        }
    }
    _detach(call) {
        if (call && call.statistics) {
            try { call.statistics.removeListener('stats', this._onStats); } catch (e) {}
        }
    }

    _onStats(stats) {
        const cs = _getCallState(this.props.call);
        if (!cs) return;
        const { audio, video, connection } = stats.data || {};
        const audioIn  = audio?.inbound?.[0];
        const audioOut = audio?.outbound?.[0];
        const videoIn  = video?.inbound?.[0];
        const videoOut = video?.outbound?.[0];

        // Identify which peer-connection this event came from. In a 1:1
        // call there's one PC and connectionId is constant; in a
        // conference each subscriber PC reports separately. Fall back to
        // 'default' so an event without metadata still works.
        const connId = (stats && (stats.connectionId || stats.peerId)) || 'default';
        let pc = cs.pcs[connId];
        if (!pc) {
            pc = { prev: {}, up: 0, down: 0, ts: 0 };
            cs.pcs[connId] = pc;
        }

        // Sanity ceiling for a per-track instantaneous rate. WebRTC
        // mobile video over LTE/Wi-Fi shouldn't realistically exceed
        // ~10 Mbps. We saw absurd readings (>>100 Mbps) right after
        // reconnects / first-sample races: the previous bytes counter
        // wraps or the timestamp is inconsistent (rn-webrtc occasionally
        // reports timestamps in different units across platforms),
        // producing a single bad delta that then pollutes the 15-second
        // rolling average. Clamp anything above this to 0 — a brief
        // flat spot is much better than a wildly wrong needle.
        const SANE_MAX_BPS = 25_000_000;

        const calc = (key, bytes, ts) => {
            const prev = pc.prev[key];
            if (!prev) { pc.prev[key] = { bytes, ts }; return null; }
            const dB = bytes - prev.bytes;
            const dT = (ts - prev.ts) / 1000;
            pc.prev[key] = { bytes, ts };
            if (dT <= 0 || dB < 0) return 0;
            const rate = (dB * 8) / dT;
            if (!isFinite(rate) || rate > SANE_MAX_BPS) {
                // Likely a timestamp anomaly or counter wrap.
                return 0;
            }
            return rate;
        };

        // Per-PC up/down: only count the records that exist on THIS PC.
        // calc() returns null on the very first sample for any given key
        // (no prior bytes to subtract); treat that as 0 for this tick.
        const fold = (v) => (v === null ? 0 : v);
        const pcUp   = fold(videoOut ? calc('vUp',   videoOut.bytesSent,    videoOut.timestamp) : null)
                     + fold(audioOut ? calc('aUp',   audioOut.bytesSent,    audioOut.timestamp) : null);
        const pcDown = fold(videoIn  ? calc('vDown', videoIn.bytesReceived, videoIn.timestamp)  : null)
                     + fold(audioIn  ? calc('aDown', audioIn.bytesReceived, audioIn.timestamp)  : null);

        const now = Date.now();
        pc.up   = pcUp;
        pc.down = pcDown;
        pc.ts   = now;

        // Aggregate across all live PCs (publisher + per-participant
        // subscribers in a conference). Drop entries that haven't
        // emitted in a while — a participant left and won't refresh.
        let upRaw = 0, downRaw = 0;
        for (const id in cs.pcs) {
            const e = cs.pcs[id];
            if (now - e.ts > 15000) {
                delete cs.pcs[id];
                continue;
            }
            upRaw   += e.up   || 0;
            downRaw += e.down || 0;
        }

        // Smooth bandwidth over ~15s.
        cs.history.push({ ts: now, up: upRaw, down: downRaw });
        cs.history = cs.history.filter(d => now - d.ts < 15000);
        const N = cs.history.length || 1;
        const sUp   = cs.history.reduce((a, b) => a + b.up,   0) / N;
        const sDown = cs.history.reduce((a, b) => a + b.down, 0) / N;

        // Each PC has its own transport, so rtt is reported per-event in
        // a conference. Prefer a fresh non-zero value, otherwise hold the
        // previous snapshot to avoid flickering to 0 between events.
        const rtt = connection?.currentRoundTripTime
            ? connection.currentRoundTripTime * 1000
            : (cs.snapshot.rtt || 0);

        // Use video loss when present (typically the more interesting
        // direction); fall back to audio loss otherwise.
        const lossOf = (rtp) => {
            if (!rtp) return 0;
            const recv = rtp.packetsReceived || 0;
            const lost = rtp.packetsLost || 0;
            const total = recv + lost;
            return total > 0 ? (lost / total) * 100 : 0;
        };
        const loss = videoIn ? lossOf(videoIn) : lossOf(audioIn);

        // Extract codec mimeType. sylkrtc parseStats puts mimeType
        // directly on inbound/outbound rtp records when available
        // (M124 stats include 'codec' rows referenced by codecId).
        const codecOf = (rtp) =>
            (rtp && (rtp.mimeType || rtp.codec || '')).toString();
        const videoCodec = codecOf(videoIn) || codecOf(videoOut) || cs.snapshot.videoCodec;
        const audioCodec = codecOf(audioIn) || codecOf(audioOut) || cs.snapshot.audioCodec;

        // Frame dimensions. Inbound = what the remote peer sends and we
        // decode; outbound = what we encode and send. Both populated by
        // libwebrtc's standard inbound-rtp / outbound-rtp records once
        // a video frame has been processed in that direction.
        const inW  = videoIn?.frameWidth   || cs.snapshot.inW  || 0;
        const inH  = videoIn?.frameHeight  || cs.snapshot.inH  || 0;
        const outW = videoOut?.frameWidth  || cs.snapshot.outW || 0;
        const outH = videoOut?.frameHeight || cs.snapshot.outH || 0;
        const fps  = videoIn?.framesPerSecond || cs.snapshot.fps || 0;

        // Codec metadata (clockRate, channels, sdpFmtpLine) — patched
        // sylkrtc copies these from the WebRTC codec record onto the
        // inbound/outbound rtp records. Prefer inbound (what we decode);
        // hold previous snapshot if a particular stats event didn't
        // include the codecId reference.
        const pickMeta = (rtp) => {
            if (!rtp) return null;
            if (rtp.clockRate == null && rtp.channels == null && !rtp.sdpFmtpLine) return null;
            return {
                clockRate: rtp.clockRate,
                channels:  rtp.channels,
                sdpFmtpLine: rtp.sdpFmtpLine || '',
                fmtp: parseFmtp(rtp.sdpFmtpLine || ''),
            };
        };
        const videoCodecMeta = pickMeta(videoIn) || pickMeta(videoOut) || cs.snapshot.videoCodecMeta;

        // Persist for the next mount: a remounted speedometer reads
        // these via _getCallState() in its constructor and shows the
        // same numbers immediately instead of zeroing for ~10s.
        cs.snapshot = {
            up: sUp, down: sDown, rtt, loss,
            videoCodec, audioCodec,
            inW, inH, outW, outH,
            fps, videoCodecMeta,
        };

        this.setState(cs.snapshot);
    }

    render() {
        const { up, down, rtt, loss, inW, inH, outW, outH, fps, videoCodecMeta } = this.state;
        // Strip "video/" / "audio/" prefix that sometimes prefixes mimeType.
        const cleanCodec = (c) => (c || '').replace(/^video\//i, '').replace(/^audio\//i, '');
        // Prefer codec extracted from stats; fall back to props if parent
        // happens to know it (e.g. for the very first render before any
        // stats arrive).
        const vCodec = cleanCodec(this.state.videoCodec || this.props.videoCodec);
        const showRes = !!this.props.showResolution;
        // Codec feature pills (e.g. "30fps · CB 3.1 · pkt1"). Only rendered
        // in the fullscreen overlay where we have room.
        const featureTokens = showRes
            ? buildVideoFeatureTokens(vCodec, videoCodecMeta, fps)
            : [];
        return (
            <View style={styles.column}>
            <View style={styles.row}>
                <Dial
                    arcColor={bandwidthColor(up + down)}
                    needles={[
                        { value: up,   max: NetworkSpeedometer.BANDWIDTH_MAX_BPS, color: COLOR_UPLOAD   },
                        { value: down, max: NetworkSpeedometer.BANDWIDTH_MAX_BPS, color: COLOR_DOWNLOAD },
                    ]}
                    centerLabel={vCodec || null}
                    caption={
                        <Text style={styles.caption}>
                            <Text style={{ color: COLOR_UPLOAD   }}>⇡{fmtBits(up)}</Text>
                            <Text> </Text>
                            <Text style={{ color: COLOR_DOWNLOAD }}>⇣{fmtBits(down)}</Text>
                        </Text>
                    }
                />
                <Dial
                    arcColor={rttColor(rtt)}
                    needles={[
                        { value: rtt,  max: NetworkSpeedometer.RTT_MAX_MS,   color: COLOR_RTT  },
                        { value: loss, max: NetworkSpeedometer.LOSS_MAX_PCT, color: COLOR_LOSS },
                    ]}
                    centerLabel={[
                        { text: 'RTT', color: COLOR_RTT },
                    ]}
                    caption={
                        <Text style={styles.caption}>
                            <Text style={{ color: COLOR_RTT  }}>{rtt.toFixed(0)}ms</Text>
                            <Text> </Text>
                            <Text style={{ color: COLOR_LOSS }}>{loss.toFixed(1)}%</Text>
                        </Text>
                    }
                />
            </View>
            {showRes ? (
                <Text style={styles.resolution}>
                    <Text>in </Text>
                    <Text style={styles.resValue}>
                        {inW > 0 && inH > 0 ? `${inW}×${inH}` : '—'}
                    </Text>
                    <Text>   out </Text>
                    <Text style={styles.resValue}>
                        {outW > 0 && outH > 0 ? `${outW}×${outH}` : '—'}
                    </Text>
                </Text>
            ) : null}
            {showRes && featureTokens.length > 0 ? (
                <Text style={styles.features}>
                    {featureTokens.join(' · ')}
                </Text>
            ) : null}
            </View>
        );
    }
}


const styles = StyleSheet.create({
    column: {
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    dial: {
        alignItems: 'center',
        marginHorizontal: 3,
        backgroundColor: 'transparent',
    },
    caption: {
        color: '#fff',
        fontSize: 8,
        marginTop: -2,
    },
    codec: {
        color: '#bbbbbb',
        fontSize: 8,
        fontStyle: 'italic',
    },
    resolution: {
        color: '#bbbbbb',
        fontSize: 9,
        marginTop: 2,
        textAlign: 'center',
    },
    resValue: {
        color: '#ffffff',
        fontWeight: '600',
    },
    features: {
        color: '#dddddd',
        fontSize: 9,
        marginTop: 1,
        textAlign: 'center',
    },
});
