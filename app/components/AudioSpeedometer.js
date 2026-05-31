// AudioSpeedometer.js
//
// A larger single-dial speedometer used in the in-call AudioCallBox in
// place of the traffic-stats bars. Tap toggles between this dial and the
// legacy bar-chart view.
//
//   - One 180° dial with TWO needles:
//       blue  needle = round-trip time   (ms, 0–500 scale)
//       white needle = packet loss       (%,  0–30 scale)
//
//   - The white loss needle is hidden when loss < 1%. Sub-1% loss is
//     normal jitter on a healthy link; we only render the needle once
//     loss climbs to something the user could act on.
//
//   - Audio codec is rendered inside the dial, between the two needles'
//     resting positions.
//
//   - Bandwidth (up / down, smoothed over ~15s) is rendered below the
//     dial in a single line.
//
//   - The dial has two concentric arcs, each rendered as a fixed
//     green / orange / red scale (segments at the quality thresholds
//     of the metric, not the metric's current value):
//        outer arc = RTT  scale (0..500 ms, equal thirds)
//        inner arc = loss scale (0..30 %, CODEC-DEPENDENT thresholds)
//
//     Loss tolerance varies wildly between codecs, so the inner arc's
//     green/orange/red boundaries come from a per-codec profile
//     (see LOSS_PROFILE_BY_CODEC):
//        Opus       : 0–10 green, 10–20 orange, 20–30 red
//        PCMA/PCMU  : 0–2  green, 2–10  orange, 10–30 red
//        G722       : same as PCMA/PCMU
//
//     The scale max stays 30% for all codecs so the dial's geometry
//     is constant — only the colored boundaries shift, which means
//     the same needle position can read green for Opus and orange or
//     red for G.711.
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
import { View, Text, StyleSheet, Animated, TouchableWithoutFeedback } from 'react-native';
import Svg, { Path, Line, Circle, G, Text as SvgText } from 'react-native-svg';
import DarkModeManager from '../DarkModeManager';


// ---------- dial geometry ---------------------------------------------------

// Bigger than NetworkSpeedometer (which is 64×38 per dial). This sits
// alone where the bar-chart used to live, so we have plenty of room.
// Dropped 10% per user request — was 180×110, now 162×99.
const W  = 162;
const H  = 99;
const CX = W / 2;
const CY = H - 18;
const R  = W / 2 - 18;       // outer arc radius — RTT lives here
const R_INNER = R - 7;       // inner arc radius — loss lives here
                             // (tight gap so the two scales read as a
                             // pair of stacked rings rather than two
                             // separate dials)

// Needle-tip offsets. Each needle's tip ends just inside its own
// arc's stroke so it visually "touches" the ring rather than punching
// through. With arc strokeWidth 3, the arc occupies ±1.5px of its
// nominal radius; a 2px inset leaves a hair of clearance.
const RTT_TIP_OFFSET  = 2;
const LOSS_TIP_OFFSET = 2;

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

// Needle / accent colors. Each needle has a fixed identity color
// (blue = RTT, white = loss); the corresponding numeric readout below
// the dial uses the SAME color so eye + label match. Quality is
// communicated by the colored segments of each arc itself — the
// needle simply rides across the green / orange / red zones.
const COLOR_RTT      = '#3498db'; // blue
const COLOR_LOSS     = '#ffffff'; // white
const COLOR_UPLOAD   = '#3498db'; // blue
const COLOR_DOWNLOAD = '#ffffff'; // white

// Ring quality palette.
const COLOR_GREEN    = '#2ecc71';
const COLOR_ORANGE   = '#e67e22';
const COLOR_RED      = '#e74c3c';

// Tunable scales — change here if you want more headroom on the dial.
// RTT pegs at 500ms — the red threshold sits at 350ms (rttColor()
// below), so the worst-quality zone occupies the rightmost ~30% of
// the dial. Anything above 500ms parks the needle at full deflection.
const RTT_MAX_MS   = 500;   // 500ms full deflection

// Full-deflection bandwidth for the "speed" mode of the dial (toggled
// in by tapping the dial). Two scales:
//   • BANDWIDTH_MAX_BPS (120 kbit/s) — used when the call is audio
//     ONLY (no video stream flowing). Opus tops out around 50-64
//     kbps so 120 kbit/s leaves clean headroom without leaving
//     most of the dial unused.
//   • VIDEO_BANDWIDTH_MAX_BPS (3 Mbit/s) — used when video is
//     flowing (audio-conference upgraded to video, or any video
//     call). A typical 1080p send is 1-2 Mbps, so 3 Mbps gives
//     the needle a useful sweep range without leaving most of
//     the dial unused.
// The render path picks between them via the existing isAudioOnly
// flag (see _dialBwMax below). The TEXT readout under the dial is
// not clamped at either value — only the dial scale is — so the
// real number is always shown even when the dial pins.
const BANDWIDTH_MAX_BPS       = 120_000;
const VIDEO_BANDWIDTH_MAX_BPS = 3_000_000;
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
        // FEC token suppressed per user request — the codec line in
        // the speedometer caption now omits the "FEC" indicator
        // (applies to both portrait and landscape since the token
        // assembly is a single code path).
        // if (fmtp.useinbandfec === '1') tokens.push('FEC');
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

// ---------- RTT scale (codec-independent) -----------------------------------
//
// The outer arc is split into three EQUAL 60° segments — green /
// orange / red, left to right. Thresholds derive from RTT_MAX_MS / 3
// so segments and band-checks can never drift apart:
//   RTT  (max 500ms)  → green 0–167, orange 167–333, red 333–500
const SEG_GREEN_END_DEG  = 60;   // 0°  →  60°  : green
const SEG_ORANGE_END_DEG = 120;  // 60° → 120°  : orange
                                 // 120°→ 180°  : red

const RTT_GOOD_MAX  = RTT_MAX_MS / 3;
const RTT_MID_MAX   = RTT_MAX_MS * 2 / 3;

// ---------- loss scale (per-codec) ------------------------------------------
//
// Loss tolerance depends heavily on the audio codec in use:
//   - Opus has aggressive FEC + PLC and tolerates double-digit loss
//     before quality collapses (equal-thirds 0/10/20/30 scale).
//   - G.711 (PCMA / PCMU) and G.722 have no error correction; even
//     a few percent loss is audible (green ends at 2%, orange ends
//     at 10%, anything past 10% is red).
//
// The scale max stays at 30% for all codecs so the dial geometry is
// stable; only the colored-segment boundaries (and therefore where
// the same needle position reads as "green" vs. "red") changes.
const DEFAULT_LOSS_PROFILE = {
    good: LOSS_MAX_PCT / 3,       // 10 — equal-third green
    mid:  LOSS_MAX_PCT * 2 / 3,   // 20 — equal-third orange
    max:  LOSS_MAX_PCT,           // 30 — full deflection
};
const LOSS_PROFILE_BY_CODEC = {
    OPUS: DEFAULT_LOSS_PROFILE,
    PCMA: { good: 2, mid: 10, max: LOSS_MAX_PCT },
    PCMU: { good: 2, mid: 10, max: LOSS_MAX_PCT },
    G722: { good: 2, mid: 10, max: LOSS_MAX_PCT },
};

// Normalise a codec name as it appears in stats (e.g. "audio/opus",
// "audio/PCMU", "G722/8000") to the map key.
function _normaliseCodecKey(codec) {
    if (!codec) return '';
    return codec
        .toString()
        .replace(/^audio\//i, '')   // strip "audio/" prefix
        .replace(/\/.*$/, '')        // strip "/8000" / "/48000" suffix
        .toUpperCase();
}

function lossProfileFor(codec) {
    return LOSS_PROFILE_BY_CODEC[_normaliseCodecKey(codec)] || DEFAULT_LOSS_PROFILE;
}

// Map a value to the 0..180° position on the dial.
function valueToAngle(value, max) {
    return (Math.min(Math.max(value, 0), max) / max) * 180;
}

function rttBand(rtt) {
    if (rtt > RTT_MID_MAX)  return 2; // bad
    if (rtt < RTT_GOOD_MAX) return 0; // good
    return 1;                         // mid
}
// Loss band depends on the codec — pass the active codec so the
// per-codec profile is honored. Falls back to DEFAULT_LOSS_PROFILE
// for unknown codecs.
function lossBand(loss, codec) {
    const p = lossProfileFor(codec);
    if (loss > p.mid)  return 2;
    if (loss < p.good) return 0;
    return 1;
}
function bandColor(band) {
    if (band === 2) return COLOR_RED;
    if (band === 0) return COLOR_GREEN;
    return COLOR_ORANGE;
}

// Kept for backwards compatibility with any external import. The
// in-component drawing no longer calls them — the arc segments are
// rendered with fixed colors at fixed angular ranges.
function ringColorFor(rtt, loss, codec) {
    return bandColor(Math.max(rttBand(rtt), lossBand(loss, codec)));
}
function rttColor(rtt)         { return bandColor(rttBand(rtt));          }
function lossColor(loss, codec) { return bandColor(lossBand(loss, codec)); }

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

// Currently-mounted AudioSpeedometer instance per call. _onStats may
// be bound to a stale (unmounted) instance — the iOS conference path
// re-mounts the speedometer and the listener stays attached to the
// original instance whose setState/forceUpdate is a no-op. Tracking
// the live instance here lets _onStats reach across to whichever one
// is currently in the tree and force it to repaint.
const _liveInstance = new WeakMap();

function _getCallState(call) {
    if (!call) return null;
    let s = _runningState.get(call);
    if (!s) {
        s = {
            prev: {},
            history: [],
            // Per-peer-connection state. In a conference each PC has
            // its own bytesSent/bytesReceived counters; we MUST keep
            // their byte deltas separate or the calc() function mixes
            // counters from different PCs and produces wildly wrong
            // (or negative-clamped-to-zero) rates. Same approach
            // NetworkSpeedometer uses. Keyed by stats.connectionId
            // (or stats.peerId if no connectionId).
            pcs: {},
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
        // Dial display mode — toggled by tapping the dial. Persisted
        // on the per-call WeakMap so the choice survives remounts /
        // navigation away and back. Default 'rtt' (RTT + loss);
        // 'speed' shows up/down bandwidth needles instead.
        this.state.dialMode = (seeded && seeded.dialMode) || 'rtt';
        this._onStats = this._onStats.bind(this);
        this._toggleDialMode = this._toggleDialMode.bind(this);
        // Animated value driving the one-shot "shift down from above"
        // appearance: opacity 0→1 + translateY -12→0. Stays at 1 for
        // the rest of the call so we don't re-trigger the animation
        // on every metric tick.
        this._appearAnim = new Animated.Value(seeded && _hasMetrics(seeded.snapshot) ? 1 : 0);
        this._didAppear = !!(seeded && _hasMetrics(seeded.snapshot));
    }

    componentDidMount()    {
        this._isMounted = true;
        if (this.props.call) {
            _liveInstance.set(this.props.call, this);
        }
        this._attach(this.props.call);
    }
    componentWillUnmount() {
        this._isMounted = false;
        if (this.props.call && _liveInstance.get(this.props.call) === this) {
            _liveInstance.delete(this.props.call);
        }
        this._detach(this.props.call);
    }

    // (Diagnostic console.log statements that helped track down the
    // iOS-conference no-render issue have been removed now that the
    // fix is in place. The structural changes that solved it remain:
    // try/catch around _onStats, render reads from cs.snapshot
    // directly, and _liveInstance tracks the mounted component.)
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

    _toggleDialMode() {
        const next = this.state.dialMode === 'rtt' ? 'speed' : 'rtt';
        // Persist on the per-call WeakMap so remounts pick up the
        // user's choice (e.g. tapping the dial then navigating to
        // contacts and back keeps it on the speed view).
        const cs = _getCallState(this.props.call);
        if (cs) cs.dialMode = next;
        this.setState({dialMode: next});
    }
    _detach(call) {
        if (call && call.statistics) {
            try { call.statistics.removeListener('stats', this._onStats); } catch (e) {}
        }
    }

    _onStats(stats) {
        // Wrap the body in a try/catch — react-native's EventEmitter
        // silently swallows listener exceptions, which previously
        // hid a TypeError thrown by an unguarded codecOf(undefined)
        // call on iOS conference subscriber PCs. The bug is fixed
        // now (codecOf returns '' for falsy rtp) but the safety net
        // stays so a future regression surfaces in the log instead
        // of mysteriously freezing the dial at zero.
        try {
            this._onStatsImpl(stats);
        } catch (err) {
            console.log('[AudioSpeedometer] _onStats threw: ' +
                        (err && err.message ? err.message : String(err)));
        }
    }

    _onStatsImpl(stats) {
        const cs = _getCallState(this.props.call);
        if (!cs) return;
        const { audio, video, connection } = stats.data || {};
        const audioIn  = audio?.inbound?.[0];
        const audioOut = audio?.outbound?.[0];
        const videoIn  = video?.inbound?.[0];
        const videoOut = video?.outbound?.[0];

        // Per-PC bookkeeping. In a conference each PC has its own
        // bytesSent/bytesReceived counters, so we can't share a
        // single `aUp`/`aDown` slot across events from different PCs
        // — the delta would mix counters and produce nonsense rates.
        // Same per-PC layout NetworkSpeedometer uses for the same
        // reason. connectionId is preferred; fall back to peerId so
        // we still get a stable slot.
        const connId = (stats && (stats.connectionId || stats.peerId)) || 'default';
        let pc = cs.pcs[connId];
        if (!pc) {
            pc = {prev: {}, up: 0, down: 0, ts: 0};
            cs.pcs[connId] = pc;
        }

        // Sanity ceiling on instantaneous rate. Any per-PC delta
        // above 5 Mbps is treated as a timestamp anomaly / counter
        // wrap and clamped to 0 rather than being smoothed into the
        // 15-second history. 5 Mbps is enough headroom for a typical
        // conference (multi-participant audio + a few hundred kbps of
        // video per stream) without letting one wild reading dominate
        // the dial.
        const SANE_MAX_BPS = 5_000_000;

        const calc = (key, bytes, ts) => {
            const prev = pc.prev[key];
            if (!prev) { pc.prev[key] = { bytes, ts }; return null; }
            const dB = bytes - prev.bytes;
            const dT = (ts - prev.ts) / 1000;
            pc.prev[key] = { bytes, ts };
            if (dT <= 0 || dB < 0) return 0;
            const rate = (dB * 8) / dT;
            if (!isFinite(rate) || rate > SANE_MAX_BPS) return 0;
            return rate;
        };

        // calc() returns null on the very first sample (no prior bytes
        // to subtract). Treat as 0 contribution for that direction.
        const fold = (val) => (val === null ? 0 : val);

        // Per-track byte-rate computation. Some libwebrtc builds
        // report bytesSent/bytesReceived as 0 (or missing) for some
        // tracks. Match VideoBox's fallback: first try the byte-delta
        // computation; if the rtp record exposes packetRate but no
        // usable byte counter, estimate the bitrate as packetRate *
        // 1200 bytes/packet * 8 bits/byte.
        const rateOut = (rtp, key) => {
            if (!rtp) return 0;
            if ((rtp.bytesSent || 0) > 0) {
                return fold(calc(key, rtp.bytesSent, rtp.timestamp));
            }
            if (rtp.bitrate)    return rtp.bitrate;
            if (rtp.packetRate) return rtp.packetRate * 1200 * 8;
            return 0;
        };
        const rateIn = (rtp, key) => {
            if (!rtp) return 0;
            if ((rtp.bytesReceived || 0) > 0) {
                return fold(calc(key, rtp.bytesReceived, rtp.timestamp));
            }
            if (rtp.bitrate)    return rtp.bitrate;
            if (rtp.packetRate) return rtp.packetRate * 1200 * 8;
            return 0;
        };

        // Per-PC, per-track rates. We track audio and video bytes
        // separately so the audio-only detector at render-time looks
        // at "are video bytes flowing" rather than "did the SDP
        // negotiate a video codec" — the SDP ALWAYS carries video for
        // conferences (camera-mute is a track.enabled toggle, not a
        // renegotiation), so any video-codec-presence check would
        // report "video session" for every conference even with the
        // camera off.
        const pcAUp   = rateOut(audioOut, 'aUp');
        const pcVUp   = rateOut(videoOut, 'vUp');
        const pcADown = rateIn(audioIn,   'aDown');
        const pcVDown = rateIn(videoIn,   'vDown');
        const now = Date.now();
        pc.aUp   = pcAUp;
        pc.vUp   = pcVUp;
        pc.aDown = pcADown;
        pc.vDown = pcVDown;
        pc.up    = pcAUp + pcVUp;
        pc.down  = pcADown + pcVDown;
        pc.ts = now;

        // Aggregate across all live PCs (publisher + per-participant
        // subscribers). Drop entries that haven't reported in >15s
        // — a participant left and won't refresh.
        let upRaw = 0, downRaw = 0, vUpRaw = 0, vDownRaw = 0;
        for (const id in cs.pcs) {
            const e = cs.pcs[id];
            if (now - e.ts > 15000) { delete cs.pcs[id]; continue; }
            upRaw    += e.up    || 0;
            downRaw  += e.down  || 0;
            vUpRaw   += e.vUp   || 0;
            vDownRaw += e.vDown || 0;
        }

        // Smooth bandwidth over ~15s. We smooth the video totals too
        // so the hasVideo flag doesn't flicker when a single stats
        // tick happens to land mid-keyframe / mid-silence.
        cs.history.push({ ts: now, up: upRaw, down: downRaw, vUp: vUpRaw, vDown: vDownRaw });
        cs.history = cs.history.filter(d => now - d.ts < 15000);
        const N = cs.history.length || 1;
        const sUp    = cs.history.reduce((a, b) => a + b.up,           0) / N;
        const sDown  = cs.history.reduce((a, b) => a + b.down,         0) / N;
        const sVUp   = cs.history.reduce((a, b) => a + (b.vUp   || 0), 0) / N;
        const sVDown = cs.history.reduce((a, b) => a + (b.vDown || 0), 0) / N;
        // hasVideo = at least one direction has any non-trivial video
        // bytes (smoothed over the same 15-second window as the
        // bandwidth totals). 1 kbps threshold cuts STUN keepalive /
        // RTCP traffic, which can show up as ~hundreds of bps even
        // with the camera fully off.
        const hasVideo = (sVUp + sVDown) > 1000;

        // RTT — three-tier source so iOS (which often leaves
        // currentRoundTripTime undefined / 0 on the candidate-pair
        // report) still gets a number:
        //   1) connection.currentRoundTripTime (Android, Chrome) —
        //      preferred, reflects the most recent STUN probe.
        //   2) totalRoundTripTime / responsesReceived (iOS) — the
        //      average RTT over every STUN response so far. Same
        //      seconds unit; ×1000 for ms.
        //   3) hold the previous snapshot value if both sources are
        //      missing, so a single stats tick with no RTT data
        //      doesn't drop the needle to 0.
        let rtt = 0;
        if (connection?.currentRoundTripTime) {
            rtt = connection.currentRoundTripTime * 1000;
        } else if (connection
                   && typeof connection.totalRoundTripTime === 'number'
                   && typeof connection.responsesReceived === 'number'
                   && connection.responsesReceived > 0) {
            rtt = (connection.totalRoundTripTime / connection.responsesReceived) * 1000;
        } else {
            rtt = cs.snapshot.rtt || 0;
        }

        // Loss is computed over a sliding 5-second window rather than
        // the cumulative call totals so the needle reflects RECENT
        // network conditions, not the whole-call average. A brief
        // bad patch then recovery will visibly come and go; the
        // cumulative metric would have averaged a 6% burst down to
        // 1–2% across the call's lifetime and hidden it from the user.
        //
        // We keep a small per-stream ring of (ts, packetsReceived,
        // packetsLost) samples spanning ~5.5 s and compare the current
        // sample against the oldest still in the window. Until we have
        // two samples in the window the loss is reported as 0%.
        const lossOf = (rtp, key) => {
            if (!rtp) return 0;
            const recv = rtp.packetsReceived || 0;
            const lost = rtp.packetsLost     || 0;
            const ts = Date.now();
            if (!cs.lossHistory) cs.lossHistory = {};
            if (!cs.lossHistory[key]) cs.lossHistory[key] = [];
            cs.lossHistory[key].push({ ts, recv, lost });
            // Keep ~5.5 s of samples so the oldest entry is close to
            // (but not less than) 5 s ago in steady state.
            cs.lossHistory[key] = cs.lossHistory[key].filter(s => ts - s.ts <= 5500);
            const oldest = cs.lossHistory[key][0];
            if (!oldest || oldest.ts === ts) return 0;
            const dRecv = recv - oldest.recv;
            const dLost = lost - oldest.lost;
            const dTotal = dRecv + dLost;
            return dTotal > 0 ? (dLost / dTotal) * 100 : 0;
        };
        const loss = lossOf(audioIn, 'aLossIn');

        // codecOf used to be:
        //   (rtp && (rtp.mimeType || rtp.codec || '')).toString()
        // which throws "Cannot read property 'toString' of undefined"
        // when rtp is undefined — `undefined && (...)` evaluates to
        // `undefined`, then `.toString()` blows up. iOS conference's
        // subscriber PCs can have audioIn/audioOut as undefined (vs
        // Android, which gives them as `{}`), which is what triggered
        // the silent listener crash that left the dial blank.
        // The corrected form returns '' for any falsy rtp before
        // calling toString.
        const codecOf = (rtp) => {
            if (!rtp) return '';
            return (rtp.mimeType || rtp.codec || '').toString();
        };
        const audioCodec = codecOf(audioIn) || codecOf(audioOut) || cs.snapshot.audioCodec;
        // Video codec — surfaced in the dial centre label when
        // present so an active video call reads as "OPUS / VP8" and
        // an audio-only call reads as just "OPUS". Also drives the
        // audio-only flag (any video codec name = video session).
        const videoCodec = codecOf(videoIn) || codecOf(videoOut) || cs.snapshot.videoCodec || '';

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

        cs.snapshot = {
            up: sUp, down: sDown, rtt, loss,
            audioCodec, videoCodec, codecMeta,
            // hasVideo reflects whether ANY video bytes are flowing
            // (smoothed). The SDP always negotiates video for a
            // conference, so codec presence alone can't distinguish
            // an audio-only call from one with the camera on — only
            // actual byte flow can. Used at render-time to switch
            // the dial cap and to gate the video-codec label.
            hasVideo,
            // Flips true the first time we land any meaningful
            // datapoint, used by render() to gate the dial behind a
            // placeholder until the first stats sample arrives.
            hasData: (rtt > 0) || (loss > 0) || (sUp > 0) || (sDown > 0)
                     || (cs.snapshot && cs.snapshot.hasData) || false,
        };
        this.setState(cs.snapshot);
        // Belt-and-suspenders: force a re-paint of the currently-
        // mounted instance for this call. _onStats here may be bound
        // to a stale (unmounted) instance whose setState/forceUpdate
        // is a no-op — _liveInstance maps the call to the instance
        // that's actually in the tree right now. render() reads from
        // cs.snapshot (just updated above), so a single forceUpdate
        // on the live instance is enough to repaint with new values
        // regardless of which instance the EventEmitter listener was
        // bound to.
        const live = this.props.call ? _liveInstance.get(this.props.call) : null;
        if (live && live._isMounted) {
            live.forceUpdate();
        }
    }

    render() {
        // Read straight from the per-call WeakMap snapshot instead of
        // this.state. setState on iOS conference was landing on a
        // stale/unmounted instance — the rendered instance kept
        // seeing state.rtt=0 even after stats events updated values
        // computed by _onStats. cs.snapshot is module-scoped and
        // mutated by _onStats every tick regardless of which
        // AudioSpeedometer instance the listener is attached to, so
        // the rendered tree always picks up the latest numbers.
        // Falls back to this.state if no snapshot is available
        // (e.g. props.call is null on first render).
        const _renderSnap = (() => {
            const _s = _getCallState(this.props.call);
            return (_s && _s.snapshot) ? _s.snapshot : this.state;
        })();
        const { up, down, rtt, loss } = _renderSnap;

        // Delay the dial until the first stats sample lands. Once
        // hasData latches true (in _onStatsImpl) it stays true for
        // the life of the call — we don't want the dial to flicker
        // back to "no data yet" if a single tick happens to land
        // with all-zero values. Until then, render a same-footprint
        // empty placeholder so the layout doesn't jump when the
        // dial appears.
        if (!_renderSnap.hasData) {
            const _foldedZeroMarginPre = this.props.isFolded ? {
                marginTop: -22,
                marginBottom: 0,
                paddingTop: 0,
            } : null;
            return (
                <View style={[styles.container, { minHeight: CONTENT_HEIGHT }, _foldedZeroMarginPre]} />
            );
        }

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
        // Placeholder branch disabled — always render the live dial,
        // even when no metrics have arrived yet. iOS conference
        // listeners weren't reliably triggering re-renders, so the
        // dial was stuck on the placeholder forever. With this gate
        // removed the SVG renders immediately, and the needles just
        // sit at 0 / no-codec until the first stats tick lands.
        // (The hasData / _hasMetrics calculation above is still
        // computed for the appear animation reference, but it no
        // longer hides the dial.)

        const cleanCodec = (c) =>
            (c || '').replace(/^audio\//i, '').replace(/^video\//i, '').toUpperCase();
        // Codec + meta also read from the WeakMap snapshot so they
        // stay consistent with rtt/up/down/loss above (rather than
        // from a stale this.state on the rendered instance).
        const codec = cleanCodec(_renderSnap.audioCodec || this.props.audioCodec);
        // Video codec for the dial centre label.
        const videoCodec = cleanCodec(_renderSnap.videoCodec);
        // Audio-only detection runs off ACTUAL video byte flow
        // (snapshot.hasVideo), not codec presence. The SDP always
        // negotiates a video m-line for conferences regardless of
        // whether the camera is on, so a codec name in stats is not
        // evidence of an active video session — only video bytes
        // crossing the wire are.
        const isAudioOnly = !_renderSnap.hasVideo;
        // Combined label: "OPUS / VP8" only when video is actually
        // flowing; just "OPUS" otherwise. Same hasVideo gate keeps
        // the label honest in a camera-off conference.
        const dialLabel = (_renderSnap.hasVideo && videoCodec)
            ? (codec + ' / ' + videoCodec)
            : codec;

        // Negotiated codec details (channels, clockRate, fmtp flags).
        // Rendered as a small "OPUS · 48k · stereo · FEC · 510k" line
        // below the metrics row when at least one token is available.
        const featureTokens = buildFeatureTokens(_renderSnap.codecMeta);
        const featuresLine = featureTokens.length
            ? featureTokens.join(' · ')
            : null;

        // Per-codec loss profile (Opus tolerates 10%+ before turning
        // red; G.711 / G.722 turn red at 10%). Used by ringColorFor()
        // to band-color the loss side of the single quality ring.
        const lossProfile = lossProfileFor(codec);

        // Two dial modes, toggled by tapping the dial:
        //   • 'rtt'   → outer needle = RTT, inner = loss. Default.
        //   • 'speed' → outer needle = down speed, inner = up speed,
        //               both against BANDWIDTH_MAX_BPS (5 Mbps full
        //               deflection). The TEXT bandwidth row below
        //               stays uncapped so the real number is always
        //               visible even when the dial pins.
        const isSpeed = this.state.dialMode === 'speed';

        // Ring color: in RTT mode reflect the worse of RTT/loss
        // (existing behaviour). In speed mode just use a neutral
        // accent so the dial doesn't lie about congestion — high
        // bandwidth isn't necessarily bad.
        const ringCol = isSpeed ? '#888888' : ringColorFor(rtt, loss, codec);

        // Dial cap depends on whether video is actually flowing:
        //   • audio-only call/conf → BANDWIDTH_MAX_BPS (120 kbit/s)
        //     — opus tops out around 64 kbps, so 120 kbit/s gives
        //     the needle a useful sweep range.
        //   • call/conf with video → VIDEO_BANDWIDTH_MAX_BPS
        //     (3 Mbit/s) — covers a typical 1080p send (1-2 Mbps)
        //     without pinning during bursts.
        // The TEXT bandwidth row below is uncapped so the real
        // number stays visible regardless of which cap the dial
        // uses.
        const _dialBwMax = isAudioOnly ? BANDWIDTH_MAX_BPS : VIDEO_BANDWIDTH_MAX_BPS;
        const rttClamped   = Math.min(Math.max(rtt,  0), RTT_MAX_MS);
        const lossClamped  = Math.min(Math.max(loss, 0), lossProfile.max);
        const upClamped    = Math.min(Math.max(up,   0), _dialBwMax);
        const downClamped  = Math.min(Math.max(down, 0), _dialBwMax);
        // Two needles per mode. In RTT mode: outer = rtt, inner = loss.
        // In speed mode: outer = down, inner = up. Geometry / offsets
        // are identical so the dial size stays constant.
        const outerTip = isSpeed
            ? polar((downClamped / _dialBwMax) * 180, R - RTT_TIP_OFFSET)
            : polar((rttClamped  / RTT_MAX_MS) * 180, R - RTT_TIP_OFFSET);
        const innerTip = isSpeed
            ? polar((upClamped   / _dialBwMax)        * 180, R - LOSS_TIP_OFFSET)
            : polar((lossClamped / lossProfile.max)   * 180, R - LOSS_TIP_OFFSET);
        // Needle colors. Reusing blue for "outer" in both modes
        // (RTT / Down) means the eye doesn't have to relearn which
        // needle matters when toggling. Both needles share the same
        // theme-aware palette as the metric-line text below the
        // dial so the needle and its numeric readout always read in
        // the same colour family.
        const _spDark = !!(DarkModeManager && DarkModeManager.isDark && DarkModeManager.isDark());
        const _needleRtt  = _spDark ? COLOR_RTT  : '#1565c0';
        const _needleLoss = _spDark ? COLOR_LOSS : '#000000';
        const _needleUp   = _spDark ? '#7ed957'  : '#2e7d32';
        const _needleDown = _spDark ? '#5eb1ff'  : '#1565c0';
        const outerColor = isSpeed ? _needleDown : _needleRtt;
        const innerColor = isSpeed ? _needleUp   : _needleLoss;
        // Inner needle visibility: in RTT mode hide loss < 1% (jitter).
        // In speed mode always show — the up needle is the user's
        // own outbound signal, so silence (0) is itself informative.
        const showInnerNeedle = isSpeed || loss >= 1;

        // Render the dial directly in a plain View instead of an
        // Animated.View. The previous code wrapped the dial in an
        // Animated.View whose opacity faded from 0 → 1 the first
        // time metrics arrived, with useNativeDriver:true. On iOS
        // that opacity transform doesn't always reach the child
        // <Svg> (react-native-svg's native view doesn't honour every
        // native-driven parent transform), so the dial would stay at
        // opacity 0 forever even though state.rtt was clearly being
        // updated. Dropping the animation makes the dial visible the
        // moment _hasMetrics(this.state) flips true.
        return (
            <View style={[
                styles.container,
                { minHeight: CONTENT_HEIGHT },
                _foldedZeroMargin,
            ]}>
                <TouchableWithoutFeedback onPress={this._toggleDialMode}>
                <View>
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
                        {/* Single 180° arc, solid color = worst of
                            RTT and loss. ringColorFor() picks the
                            worst band between the two (codec-aware
                            for loss). Both needles share this one
                            arc — the white loss needle is hidden
                            when loss < 1%, leaving the RTT needle
                            alone on a healthy call. */}
                        <Path
                            d={arcPath(0, 180, R)}
                            stroke={ringCol}
                            strokeWidth={3}
                            fill="none"
                            strokeLinecap="round"
                        />
                        {dialLabel ? (
                            <SvgText
                                x={CX}
                                y={CY - R * 0.55}
                                fill="#ffffff"
                                fontSize={14}
                                fontWeight="700"
                                textAnchor="middle"
                                alignmentBaseline="middle"
                            >
                                {dialLabel}
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
                        {/* Outer needle:
                            • RTT mode: blue, RTT value vs RTT_MAX_MS
                            • Speed mode: blue, down vs BANDWIDTH_MAX_BPS */}
                        <Line
                            x1={CX} y1={CY}
                            x2={outerTip.x} y2={outerTip.y}
                            stroke={outerColor}
                            strokeWidth={2.6}
                            strokeLinecap="round"
                        />
                        {/* Inner needle:
                            • RTT mode: white, loss vs codec profile (hidden < 1%)
                            • Speed mode: green, up vs BANDWIDTH_MAX_BPS (always shown) */}
                        {showInnerNeedle ? (
                            <Line
                                x1={CX} y1={CY}
                                x2={innerTip.x} y2={innerTip.y}
                                stroke={innerColor}
                                strokeWidth={2.6}
                                strokeLinecap="round"
                            />
                        ) : null}
                        <Circle cx={CX} cy={CY} r={3.6} fill="#fff" />
                    </G>
                </Svg>
                </View>
                </TouchableWithoutFeedback>

                {/* Fixed-footprint label slot — same height in both
                    dial modes so toggling between RTT and Speed
                    doesn't shift the dial up/down. Both potential
                    rows have the same vertical baseline (the
                    wrapper's marginTop replaces the per-row offsets
                    that used to differ). */}
                <View style={styles.metricsSlot}>
                    {/* Theme-aware readout colors. The conference
                        AudioSpeedometer sits inside a white surface in
                        Day theme, so the previous high-luminance
                        values (loss = #ffffff, up = #7ed957 bright
                        green, down = #5eb1ff light blue) were
                        effectively invisible. Switch to darker, high-
                        contrast variants on Day theme; the original
                        Night-theme palette is preserved unchanged. */}
                    {(() => {
                        const _dark = !!(DarkModeManager && DarkModeManager.isDark && DarkModeManager.isDark());
                        const _cRtt   = _dark ? COLOR_RTT  : '#1565c0';   // darker blue
                        const _cLoss  = _dark ? COLOR_LOSS : '#000000';   // black instead of white
                        const _cUp    = _dark ? '#7ed957'  : '#2e7d32';   // darker green
                        const _cDown  = _dark ? '#5eb1ff'  : '#1565c0';   // darker blue
                        const _cGap   = _dark ? '#888888'  : '#555555';
                        return !isSpeed ? (
                            <Text style={styles.metricsLine}>
                                <Text style={{ color: _cRtt, fontWeight: '700' }}>{rtt.toFixed(0)} ms</Text>
                                {loss > 1 ? (
                                    <>
                                        <Text style={{ color: _cGap }}>   </Text>
                                        <Text style={{ color: _cLoss, fontWeight: '700' }}>{Math.round(loss)}% loss</Text>
                                    </>
                                ) : null}
                            </Text>
                        ) : (
                            <Text style={styles.metricsLine}>
                                <Text style={{ color: _cUp,   fontWeight: '700' }}>{'↑ ' + _formatBps(up)}</Text>
                                <Text style={{ color: _cGap }}>{'   '}</Text>
                                <Text style={{ color: _cDown, fontWeight: '700' }}>{'↓ ' + _formatBps(down)}</Text>
                            </Text>
                        );
                    })()}
                </View>
            </View>
        );
    }
}

// Format bits-per-second as human-readable text. Stays in kbps until
// it crosses 1 Mbps so audio rates (typically 12–128 kbps) read
// naturally without "0.0 Mbps" rounding everything to nothing.
function _formatBps(bps) {
    if (!bps || bps <= 0) return '0 kbps';
    if (bps < 1_000_000) return Math.round(bps / 1000) + ' kbps';
    return (bps / 1_000_000).toFixed(1) + ' Mbps';
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
    // Fixed-footprint slot for the dial's text label (RTT/loss or
    // speed). Both modes render their text into the SAME wrapper so
    // the dial above doesn't shift up/down when toggling. The
    // minHeight matches one line of fontSize:12 text plus a comfortable
    // gap; marginTop carries the small lift the old metricsRow had so
    // the dial-to-label spacing is unchanged.
    metricsSlot: {
        minHeight: 18,
        marginTop: -4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    metricsLine: {
        fontSize: 12,
    },
});
