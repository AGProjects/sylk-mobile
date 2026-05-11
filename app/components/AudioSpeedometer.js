// AudioSpeedometer.js
//
// A larger single-dial speedometer used in the in-call AudioCallBox in
// place of the traffic-stats bars. Tap toggles between this dial and the
// legacy bar-chart view.
//
//   - One 180° dial with TWO needles:
//       blue  needle = round-trip time   (ms, 0–1000 scale)
//       white needle = packet loss       (%,  0–30 scale)
//
//   - Audio codec is rendered inside the dial, between the two needles'
//     resting positions.
//
//   - Bandwidth (up / down, smoothed over ~15s) is rendered below the
//     dial in a single line.
//
//   - The dial container has a colored border that summarises overall
//     call quality:
//        green  if RTT < 100ms AND loss < 2%
//        red    if loss > 5%   OR  RTT > 400ms
//        orange otherwise
//
//   - Sized noticeably bigger than NetworkSpeedometer so it fills the
//     space the old TrafficStats bar chart used to occupy.
//
// The component subscribes to call.statistics on mount and recomputes
// the four values on every 'stats' event. Smoothing window is 15s
// (3 samples at sylkrtc's 5s polling interval). Per-call running state
// is kept in a module-scoped WeakMap keyed by the call object so a
// remount (e.g. after toggling the bar chart) doesn't reset bandwidth
// to zero for ~10s.

import React from 'react';
import PropTypes from 'prop-types';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Path, Line, Circle, G, Text as SvgText } from 'react-native-svg';


// ---------- dial geometry ---------------------------------------------------

// Bigger than NetworkSpeedometer (which is 64×38 per dial). This sits
// alone where the bar-chart used to live, so we have plenty of room.
const W  = 180;
const H  = 110;
const CX = W / 2;
const CY = H - 18;
const R  = W / 2 - 18;

// Pre-reserved layout footprint of the speedometer's content area
// (SVG dial + metrics row), independent of margins / padding which
// styles.container already supplies. We pin this on both the
// pre-data placeholder and the live dial wrapper so the VU meters
// directly underneath stay anchored at their final position from
// the moment the screen mounts — when the dial finally renders it
// fades + slides in from above into the slot we already reserved.
const CONTENT_HEIGHT = 122; // 110 SVG + 12 metrics row

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

// ---------- colors ----------------------------------------------------------

// Needle / accent colors.
const COLOR_RTT      = '#3498db'; // blue
const COLOR_LOSS     = '#ffffff'; // white
const COLOR_UPLOAD   = '#3498db'; // blue
const COLOR_DOWNLOAD = '#ffffff'; // white

// Tunable scales — change here if you want more headroom on the dial.
const RTT_MAX_MS   = 1000;  // 1 s   full deflection
const LOSS_MAX_PCT = 30;    // 30%   full deflection

// ---------- format helpers --------------------------------------------------

function fmtBits(b) {
    if (b > 1_000_000) return (b / 1_000_000).toFixed(1) + 'M';
    if (b > 1_000)     return (b / 1_000).toFixed(0)     + 'k';
    if (b <= 0)        return '0';
    return b.toFixed(0);
}

// Parse a codec's sdpFmtpLine (e.g. "minptime=10;useinbandfec=1;stereo=1
// ;sprop-stereo=1;maxaveragebitrate=510000;usedtx=1") into an object
// keyed by parameter name. Empty / missing input yields {}.
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

// Build the small "feature pills" line shown below the codec name.
// Pulls from both the parsed fmtp and the channels/clockRate fields.
// Returns an array of short tokens — caller joins with " · ".
function buildFeatureTokens(codecMeta) {
    if (!codecMeta) return [];
    const { channels, clockRate, fmtp } = codecMeta;
    const tokens = [];

    if (clockRate) {
        // Render Hz as "48k" / "8k" — typical sample rates are exact.
        tokens.push((clockRate >= 1000)
            ? Math.round(clockRate / 1000) + 'k'
            : String(clockRate));
    }
    if (channels === 2) {
        tokens.push('stereo');
    } else if (channels === 1) {
        tokens.push('mono');
    }
    if (fmtp) {
        if (fmtp.useinbandfec === '1') tokens.push('FEC');
        if (fmtp.usedtx === '1')       tokens.push('DTX');
        if (fmtp.cbr === '1')          tokens.push('CBR');
        if (fmtp.maxaveragebitrate) {
            const mb = parseInt(fmtp.maxaveragebitrate, 10);
            if (mb > 0) {
                tokens.push((mb >= 1000)
                    ? Math.round(mb / 1000) + 'k'
                    : mb + '');
            }
        }
    }
    return tokens;
}

// Ring color summarises call health.
//   green  if RTT < 200ms AND loss < 2%
//   red    if loss > 5%   OR  RTT > 350ms
//   orange otherwise
function ringColorFor(rtt, loss) {
    if (loss > 5 || rtt > 350) return '#e74c3c';
    if (rtt < 200 && loss < 2) return '#2ecc71';
    return '#e67e22';
}

// Per-metric quality colors used for the readout below the dial.
// Mirrors the same thresholds as the ring but applied to each value
// individually so the user can see which metric is the offender.
function rttColor(rtt) {
    if (rtt > 350) return '#e74c3c';
    if (rtt < 200) return '#2ecc71';
    return '#e67e22';
}
function lossColor(loss) {
    if (loss > 5) return '#e74c3c';
    if (loss < 2) return '#2ecc71';
    return '#e67e22';
}

// True once any of the four metrics has reported a non-zero value —
// used to decide whether to show the placeholder or the live dial,
// and to detect the transition that fires the appear animation.
function _hasMetrics(s) {
    if (!s) return false;
    return (s.rtt > 0) || (s.loss > 0) || (s.up > 0) || (s.down > 0);
}

// ---------- per-call running state ------------------------------------------

// Same trick as NetworkSpeedometer: module-scoped per-call snapshot so a
// remount (e.g. when toggling between speedometer and bar-chart) shows
// the last known readings instead of a freshly zeroed dial.
const _runningState = new WeakMap();

function _getCallState(call) {
    if (!call) return null;
    let s = _runningState.get(call);
    if (!s) {
        s = {
            prev: {},
            history: [],
            snapshot: {
                up: 0, down: 0, rtt: 0, loss: 0,
                audioCodec: '',
                // Negotiated codec metadata pulled out of the codec
                // record (and sdpFmtpLine) by the patched sylkrtc:
                // clockRate, channels, sdpFmtpLine raw string.
                codecMeta: null,
            },
        };
        _runningState.set(call, s);
    }
    return s;
}


// ---------- top-level subscriber + renderer ---------------------------------

export default class AudioSpeedometer extends React.Component {
    static propTypes = {
        call:       PropTypes.object,
        audioCodec: PropTypes.string,
    };

    static RTT_MAX_MS   = RTT_MAX_MS;
    static LOSS_MAX_PCT = LOSS_MAX_PCT;

    constructor(props) {
        super(props);
        const seeded = _getCallState(props.call);
        this.state = seeded
            ? { ...seeded.snapshot }
            : { up: 0, down: 0, rtt: 0, loss: 0, audioCodec: '', codecMeta: null };
        this._onStats = this._onStats.bind(this);
        // Animated value driving the one-shot "shift down from above"
        // appearance: opacity 0→1 + translateY -12→0. Stays at 1 for
        // the rest of the call so we don't re-trigger the animation
        // on every metric tick.
        this._appearAnim = new Animated.Value(seeded && _hasMetrics(seeded.snapshot) ? 1 : 0);
        this._didAppear = !!(seeded && _hasMetrics(seeded.snapshot));
    }

    componentDidMount()    { this._attach(this.props.call); }
    componentWillUnmount() { this._detach(this.props.call); }
    componentDidUpdate(prevProps, prevState) {
        if (prevProps.call !== this.props.call) {
            this._detach(prevProps.call);
            this._attach(this.props.call);
        }
        // Fire the slide-down animation exactly once: the first time
        // we transition from "no metrics yet" to "have metrics".
        if (!this._didAppear) {
            const had = _hasMetrics(prevState);
            const has = _hasMetrics(this.state);
            if (!had && has) {
                this._didAppear = true;
                Animated.timing(this._appearAnim, {
                    toValue: 1,
                    duration: 350,
                    useNativeDriver: true,
                }).start();
            }
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
        const { audio, connection } = stats.data || {};
        const audioIn  = audio?.inbound?.[0];
        const audioOut = audio?.outbound?.[0];

        const calc = (key, bytes, ts) => {
            const prev = cs.prev[key];
            if (!prev) { cs.prev[key] = { bytes, ts }; return null; }
            const dB = bytes - prev.bytes;
            const dT = (ts - prev.ts) / 1000;
            cs.prev[key] = { bytes, ts };
            if (dT <= 0 || dB < 0) return 0;
            return (dB * 8) / dT;
        };

        // calc() returns null on the very first sample (no prior bytes
        // to subtract). Keep the previous snapshot value in that case
        // so a freshly remounted speedometer doesn't show zero.
        const fold = (val, prevVal) => (val === null ? prevVal : val);

        // Some libwebrtc builds report bytesSent/bytesReceived as 0 (or
        // missing) for audio inbound/outbound. Match VideoBox's fallback:
        // first try the byte-delta computation; if the rtp record exposes
        // packetRate but no usable byte counter, estimate the bitrate as
        // packetRate * ~1200 bytes/packet * 8 bits/byte. This is what
        // VideoBox already does for the same audio fields.
        const computeUp = () => {
            if (!audioOut) return 0;
            if ((audioOut.bytesSent || 0) > 0) {
                return fold(calc('aUp', audioOut.bytesSent, audioOut.timestamp), cs.snapshot.up);
            }
            if (audioOut.bitrate)   return audioOut.bitrate;
            if (audioOut.packetRate) return audioOut.packetRate * 1200 * 8;
            return cs.snapshot.up;
        };
        const computeDown = () => {
            if (!audioIn) return 0;
            if ((audioIn.bytesReceived || 0) > 0) {
                return fold(calc('aDown', audioIn.bytesReceived, audioIn.timestamp), cs.snapshot.down);
            }
            if (audioIn.bitrate)    return audioIn.bitrate;
            if (audioIn.packetRate) return audioIn.packetRate * 1200 * 8;
            return cs.snapshot.down;
        };

        const upRaw   = computeUp();
        const downRaw = computeDown();

        // Smooth bandwidth over ~15s.
        const now = Date.now();
        cs.history.push({ ts: now, up: upRaw, down: downRaw });
        cs.history = cs.history.filter(d => now - d.ts < 15000);
        const N = cs.history.length || 1;
        const sUp   = cs.history.reduce((a, b) => a + b.up,   0) / N;
        const sDown = cs.history.reduce((a, b) => a + b.down, 0) / N;

        const rtt = connection?.currentRoundTripTime
            ? connection.currentRoundTripTime * 1000
            : 0;

        const lossOf = (rtp) => {
            if (!rtp) return 0;
            const recv = rtp.packetsReceived || 0;
            const lost = rtp.packetsLost     || 0;
            const total = recv + lost;
            return total > 0 ? (lost / total) * 100 : 0;
        };
        const loss = lossOf(audioIn);

        const codecOf = (rtp) =>
            (rtp && (rtp.mimeType || rtp.codec || '')).toString();
        const audioCodec = codecOf(audioIn) || codecOf(audioOut) || cs.snapshot.audioCodec;

        // Pull the extended codec metadata that the patched sylkrtc
        // copies from the WebRTC codec record (channels, clockRate,
        // sdpFmtpLine). Prefer inbound (what we're decoding), fall
        // back to outbound. If neither rtp record carries the field,
        // hold on to the previous snapshot's codecMeta so a single
        // stats event missing the codecId doesn't blank the line.
        const pickMeta = (rtp) => {
            if (!rtp) return null;
            if (rtp.clockRate == null && rtp.channels == null && !rtp.sdpFmtpLine) return null;
            return {
                clockRate: rtp.clockRate,
                channels: rtp.channels,
                sdpFmtpLine: rtp.sdpFmtpLine || '',
                fmtp: parseFmtp(rtp.sdpFmtpLine || ''),
            };
        };
        const codecMeta = pickMeta(audioIn) || pickMeta(audioOut) || cs.snapshot.codecMeta;

        cs.snapshot = { up: sUp, down: sDown, rtt, loss, audioCodec, codecMeta };
        this.setState(cs.snapshot);
    }

    render() {
        const { up, down, rtt, loss } = this.state;

        // Until at least one metric has reported a non-zero value we
        // render an *invisible* placeholder of the same outer
        // footprint as the live dial. The component is still mounted
        // (so its call.statistics listener stays attached and
        // snapshots keep accumulating); the dial itself is hidden.
        // Reserving the slot here means anything below us in the
        // layout (the VU meters) sits at its final position from the
        // moment the screen mounts — when the dial finally appears
        // it fades + slides into place from above without pushing
        // the meters down. Also avoids the "0ms / 0.0% / no codec"
        // placeholder dial flashing in for a frame.
        const hasData = _hasMetrics(this.state);
        // Folded view: kill the container's normal vertical
        // breathing room (marginTop 16, paddingTop 2, marginBottom 6)
        // AND apply a negative marginTop to absorb the empty space
        // at the TOP of the SVG itself — the dial is anchored at
        // the bottom of its 180×110 box (CY = H - 18 = 92, R = 72)
        // so y=0..20 inside the SVG is just empty pixels. Pulling
        // the whole container up by ~22 px lets the dial appear
        // flush against the foldedStatsColumn's top edge.
        const _foldedZeroMargin = this.props.isFolded ? {
            marginTop: -22,
            marginBottom: 0,
            paddingTop: 0,
        } : null;
        if (!hasData) {
            return <View style={[styles.container, { height: CONTENT_HEIGHT }, _foldedZeroMargin]} />;
        }

        const cleanCodec = (c) =>
            (c || '').replace(/^audio\//i, '').toUpperCase();
        const codec = cleanCodec(this.state.audioCodec || this.props.audioCodec);
        const ringCol = ringColorFor(rtt, loss);

        // Negotiated codec details (channels, clockRate, fmtp flags).
        // Rendered as a small "OPUS · 48k · stereo · FEC · 510k" line
        // below the metrics row when at least one token is available.
        const featureTokens = buildFeatureTokens(this.state.codecMeta);
        const featuresLine = featureTokens.length
            ? featureTokens.join(' · ')
            : null;

        const rttClamped  = Math.min(Math.max(rtt,  0), RTT_MAX_MS);
        const lossClamped = Math.min(Math.max(loss, 0), LOSS_MAX_PCT);
        const rttTip  = polar((rttClamped  / RTT_MAX_MS)   * 180, R - 4);
        const lossTip = polar((lossClamped / LOSS_MAX_PCT) * 180, R - 4);

        // Slide-down + fade-in: pinned to a one-shot animation that
        // fires the first time metrics arrive (see componentDidUpdate).
        // useNativeDriver=true so this is silky even when JS is busy.
        const animatedStyle = {
            opacity: this._appearAnim,
            transform: [{
                translateY: this._appearAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-12, 0],
                }),
            }],
        };

        return (
            <Animated.View style={[styles.container, { minHeight: CONTENT_HEIGHT }, animatedStyle, _foldedZeroMargin]}>
                <Svg
                    width={W}
                    height={H}
                    viewBox={`0 0 ${W} ${H}`}
                    style={{ backgroundColor: 'transparent' }}
                    opacity={1}
                    renderToHardwareTextureAndroid={false}
                    needsOffscreenAlphaCompositing
                    collapsable={false}
                >
                    <G>
                        {/* Single solid arc whose color summarises overall
                            call quality. Replaces the rectangular border
                            we previously drew around the container. */}
                        <Path
                            d={arcPath(0, 180)}
                            stroke={ringCol}
                            strokeWidth={3}
                            fill="none"
                            strokeLinecap="round"
                        />
                        {codec ? (
                            <SvgText
                                x={CX}
                                y={CY - R * 0.55}
                                fill="#ffffff"
                                fontSize={14}
                                fontWeight="700"
                                textAnchor="middle"
                                alignmentBaseline="middle"
                            >
                                {codec}
                            </SvgText>
                        ) : null}
                        {featuresLine ? (
                            <SvgText
                                x={CX}
                                y={CY - R * 0.55 + 15}
                                fill="#bbbbbb"
                                fontSize={12}
                                textAnchor="middle"
                                alignmentBaseline="middle"
                            >
                                {featuresLine}
                            </SvgText>
                        ) : null}
                        <Line
                            x1={CX} y1={CY}
                            x2={rttTip.x} y2={rttTip.y}
                            stroke={COLOR_RTT}
                            strokeWidth={2.6}
                            strokeLinecap="round"
                        />
                        <Line
                            x1={CX} y1={CY}
                            x2={lossTip.x} y2={lossTip.y}
                            stroke={COLOR_LOSS}
                            strokeWidth={2.6}
                            strokeLinecap="round"
                        />
                        <Circle cx={CX} cy={CY} r={3.6} fill="#fff" />
                    </G>
                </Svg>

                <Text style={styles.metricsRow}>
                    <Text style={{ color: rttColor(rtt),  fontWeight: '700' }}>{rtt.toFixed(0)}ms</Text>
                    <Text style={{ color: '#ffffff' }}>   </Text>
                    <Text style={{ color: lossColor(loss), fontWeight: '700' }}>{loss.toFixed(1)}%</Text>
                </Text>
            </Animated.View>
        );
    }
}


const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: 'transparent',
        paddingHorizontal: 4,
        paddingTop: 2,
        paddingBottom: 4,
        marginTop: 16,    // 6 base + 10 to lower the dial
        marginBottom: 6,
    },
    metricsRow: {
        fontSize: 12,
        marginTop: -4,
    },
    features: {
        color: '#bbbbbb',
        fontSize: 10,
        marginTop: 2,
        textAlign: 'center',
    },
    bandwidth: {
        fontSize: 12,
        marginTop: 3,
    },
});
