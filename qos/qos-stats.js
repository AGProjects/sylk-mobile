// qos/qos-stats.js — drop-in QoS instrumentation for Sylk Mobile's
// WebRTC PeerConnection. Imported from app/components/AudioCallBox.js
// (and any other component that wants the same telemetry).
//
// Emits three line shapes via console.log so Metro forwards them to
// metro.log AND adb logcat (under tag ReactNativeJS). console.log is
// chosen over console.warn because react-native's LogBox auto-appends
// a multi-line call stack to every console.warn entry, which would
// pollute logcat. This project's babel config does not strip
// console.log, so console.log survives release builds here.
//
//   [qos] CONNECT    <local-ip>:<port> <-> <remote-ip>:<port> callid=<sip-call-id>
//   [qos] STATS      <local-ip>:<port> <-> <remote-ip>:<port> ... callid=<sip-call-id>
//   [qos] DISCONNECT callid=<sip-call-id>
//
// The trailing `callid=<sip-call-id>` carries the SIP Call-ID of the
// active call (when the caller passes it in). It lets log consumers
// correlate a [qos] block with a specific call and, in turn, fetch the
// server-side SIP/media trace for that call id (see sylk_settings.phtml
// get_sip_trace / get_media_trace). It is `?` when the caller didn't
// supply an id. The token is appended at the END of each line so the
// existing CONNECT/STATS/DISCONNECT regexes in qos-probe.py keep
// matching unchanged.
//
// Lifecycle:
//   startQosLogging(pc, callId) — call once the PeerConnection is
//                         selected (ICE connected / call established).
//                         Resolves the selected candidate pair, emits
//                         CONNECT, then starts a 1 s sampler that emits
//                         STATS lines. callId is the SIP Call-ID of the
//                         call (optional; defaults to '?').
//   stopQosLogging()    — call on teardown / call terminated. Stops the
//                         sampler and emits DISCONNECT.
//
// Implementation notes:
//   - Works with react-native-webrtc's getStats() (returns a Map).
//   - loss_out is RTCP fractionLost from remote-inbound-rtp — i.e. what
//     the server says about packets WE sent. Stays "?" for the first
//     1–3 seconds while RTCP catches up.
//   - loss_in is computed from the 1 s delta of inbound-rtp.packetsLost
//     vs packetsReceived. For sendonly publish streams it stays "?".
//   - rtt is currentRoundTripTime of the selected candidate pair, in ms.

// Sampler interval in ms. Set to 5000 so [qos] STATS lines land on
// the same cadence as the iperf3 probes in qos-log.sh (default 5 s
// duration), making line-by-line correlation in qos.log direct.
const QOS_SAMPLE_INTERVAL_MS = 5000;

// Anchor the active interval handle on globalThis so that when Metro's
// Fast Refresh re-evaluates this module (every time you save the file
// or one of its importers), we can clean up the PREVIOUS instance's
// timer rather than letting them accumulate. Without this guard, you
// end up with N concurrent setIntervals firing every 5 s and each
// [qos] STATS line appears N times in metro.log.
const GLOBAL_KEY = '__qos_stats_state__';
function getGlobalState() {
  const g = (typeof globalThis !== 'undefined' && globalThis)
            || (typeof global !== 'undefined' && global)
            || {};
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { handle: null, moduleLoadedLogged: false, results: {} };
  }
  // results lives in GLOBAL (not module) scope so a Fast-Refresh / module
  // re-evaluation between call-end and the trace fetch can't wipe the captured
  // per-call result. (Survives module reload; a full JS context reset still
  // clears it, but that only happens on app relaunch.)
  if (!g[GLOBAL_KEY].results) g[GLOBAL_KEY].results = {};
  return g[GLOBAL_KEY];
}

let endpoints = { local: 'unknown', remote: 'unknown' };
let lastInbound = null;
// Stashed so stopQosLogging() (which takes no pc) can emit one last
// fault-domain verdict on teardown — important because the calls we're
// debugging are hung up within seconds, sometimes before any sampler
// tick fires.
let activePc = null;
let activeStartedAt = 0;
// SIP Call-ID of the active call, supplied by startQosLogging's caller.
// Appended as `callid=<id>` to the CONNECT / STATS / DISCONNECT lines so
// log consumers can correlate a [qos] block with a specific call (and
// fetch its server-side SIP/media trace). '?' when not supplied.
let activeCallId = '?';
// Most recent computed sample, cached so other components (e.g. the
// in-call <MediaInfoPanel /> diagnostic modal) can read the SAME numbers
// that get written to metro.log without having to re-derive them from
// pc.getStats(). Updated at the end of every successful 5 s sampler
// tick. Cleared on stopQosLogging() so a stale value can't leak across
// calls. Shape mirrors the snapshot() return object plus the resolved
// endpoints + a capturedAt millisecond timestamp.
let lastSnapshot = null;

// Mid-call downlink-stall tracking. A call can connect fine, carry audio for a
// few seconds, then the inbound RTP simply STOPS (far side / relay quits, or
// our downlink path dies) while our uplink keeps flowing. classifyMediaFault
// looks at cumulative totals so it keeps saying "OK" — these track the recent
// RATE so we can flag "receive stopped at Ns" the moment it happens.
let _stallLastRecv = 0;     // packetsReceived at the previous verdict read
let _stallLastSent = 0;     // packetsSent at the previous verdict read
let _recvStallTicks = 0;    // consecutive reads with no new recv while sending
let _recvStalledAtMs = 0;   // call-age (ms) when recv last advanced
const RECV_STALL_TICKS = 2; // ticks of frozen recv (while sending) -> STALLED

// Final per-call result, keyed by SIP Call-ID, captured at teardown so it
// survives until the app fetches the server-side trace/qos summary (which can
// be seconds-to-minutes after the call). Shape:
//   { callId, packetsSent, packetsReceived, bytesSent, bytesReceived,
//     domain, reason, iceState, dtlsState, rttMs, capturedAt }
// domain/reason come from classifyMediaFault (the client's own verdict).
// Backed by GLOBAL state (see getGlobalState) so it survives a module reload.
function qosResultsStore() {
  return getGlobalState().results;
}

// Read-only accessor for app code (reconciliation with the server summary).
export function getQosResult(callId) {
  return (callId != null && qosResultsStore()[String(callId)]) || null;
}

// ---- disk persistence -------------------------------------------------------
// The in-memory store (even in global state) does NOT survive a FULL JS context
// reload or an app relaunch — which is exactly what wiped the client result
// before the trace reconcile on iOS (the reconcile runs seconds-to-minutes
// after the call). So we ALSO mirror each per-call result to a small file.
// getQosResult() stays sync (memory only); the app falls back to
// loadQosResultFromDisk() when memory misses.
const RNFS = require('react-native-fs');
const QOS_DISK_DIR = RNFS.DocumentDirectoryPath + '/qos-client';
function _safeCid(id) { return String(id).replace(/[^A-Za-z0-9._-]/g, '_'); }
function _persistResult(callId) {
  if (!callId || callId === '?') return;
  const rec = qosResultsStore()[String(callId)];
  if (!rec) return;
  // Fire-and-forget; small JSON, ~once per sampler tick.
  RNFS.mkdir(QOS_DISK_DIR)
    .catch(() => {})
    .then(() => RNFS.writeFile(
      QOS_DISK_DIR + '/' + _safeCid(callId) + '.json',
      JSON.stringify(rec), 'utf8'))
    .catch((e) => qosLog('persist failed callid=' + callId + ' ' + ((e && e.message) || e)));
}
// Async disk read for the reconcile path. Returns the saved result or null.
export async function loadQosResultFromDisk(callId) {
  if (!callId || callId === '?') return null;
  try {
    const txt = await RNFS.readFile(QOS_DISK_DIR + '/' + _safeCid(callId) + '.json', 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function qosLog(msg) {
  // Single source of truth for the [qos] tag. console.log (not warn)
  // because LogBox auto-appends a multi-line call stack to every warn,
  // which would pollute metro.log and adb logcat. This project does
  // not strip console.log in release, so this survives in both modes.
  // eslint-disable-next-line no-console
  console.log(`[qos] ${msg}`);
}

// Module-load trace, but only the FIRST time across reloads.
(function () {
  const s = getGlobalState();
  if (!s.moduleLoadedLogged) {
    s.moduleLoadedLogged = true;
    qosLog('module loaded');
  }
  // If a previous instance left a timer running, kill it now —
  // its closure references stale module state.
  if (s.handle) {
    try { clearInterval(s.handle); } catch (e) { /* ignore */ }
    s.handle = null;
    qosLog('cleared stale interval from previous module load');
  }
})();

function pickSelectedPair(stats) {
  let pair = null;
  stats.forEach((r) => {
    if (r.type !== 'candidate-pair') return;
    const ok =
      r.state === 'succeeded' ||
      r.selected === true ||
      r.nominated === true;
    if (!ok) return;
    // Prefer succeeded over merely nominated.
    if (!pair || r.state === 'succeeded') pair = r;
  });
  return pair;
}

function indexCandidates(stats) {
  const byId = {};
  stats.forEach((r) => {
    if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
      byId[r.id] = r;
    }
  });
  return byId;
}

function fmtEndpoint(c) {
  if (!c) return 'unknown';
  const addr = c.address || c.ip || '?';
  const port = c.port != null ? c.port : '?';
  return `${addr}:${port}`;
}

async function findEndpoints(pc) {
  try {
    const stats = await pc.getStats();
    const pair = pickSelectedPair(stats);
    if (!pair) return null;
    const byId = indexCandidates(stats);
    return {
      local: fmtEndpoint(byId[pair.localCandidateId]),
      remote: fmtEndpoint(byId[pair.remoteCandidateId]),
    };
  } catch (e) {
    return null;
  }
}

async function snapshot(pc) {
  const stats = await pc.getStats();
  const pair = pickSelectedPair(stats);

  let inboundAudio = null;
  let remoteInboundAudio = null;
  stats.forEach((r) => {
    const isAudio = r.kind === 'audio' || r.mediaType === 'audio';
    if (!isAudio) return;
    if (r.type === 'inbound-rtp') inboundAudio = r;
    else if (r.type === 'remote-inbound-rtp') remoteInboundAudio = r;
  });

  const rttMs =
    pair && pair.currentRoundTripTime != null
      ? Math.round(pair.currentRoundTripTime * 1000)
      : '?';

  // Outbound loss: server tells us via RTCP receiver reports.
  let lossOut = '?';
  if (remoteInboundAudio && remoteInboundAudio.fractionLost != null) {
    lossOut = (remoteInboundAudio.fractionLost * 100).toFixed(1);
  }

  // ───────────────────────────────────────────────────────────────────
  // Inbound side: compute per-interval deltas so the numbers reflect
  // "what happened during the last sampler tick" rather than averages
  // over the entire call. Each metric is guarded against missing fields
  // (rn-webrtc may not surface every spec field on every platform).
  // ───────────────────────────────────────────────────────────────────
  let lossIn = '?';   // % of RTP packets missing (sequence-number gaps)
  let ppsRecv = '?';  // RTP packets received in this tick → /interval
  let concealPct = '?'; // audible loss after PLC, in audio samples
  let jbDelayMs = '?';  // avg jitter-buffer delay per emitted packet, ms
  let jbFlushesDelta = '?'; // jitter-buffer resets during the tick

  if (inboundAudio) {
    const now = {
      packetsLost: inboundAudio.packetsLost,
      packetsReceived: inboundAudio.packetsReceived,
      concealedSamples: inboundAudio.concealedSamples,
      totalSamplesReceived: inboundAudio.totalSamplesReceived,
      jitterBufferDelay: inboundAudio.jitterBufferDelay,
      jitterBufferEmittedCount: inboundAudio.jitterBufferEmittedCount,
      jitterBufferFlushes: inboundAudio.jitterBufferFlushes,
      // For the timestamp-based pps calculation:
      tsMs: (typeof inboundAudio.timestamp === 'number'
             ? inboundAudio.timestamp
             : Date.now()),
    };

    if (lastInbound) {
      const dtSec = Math.max(0.001, (now.tsMs - lastInbound.tsMs) / 1000);

      // RTP packet receive rate
      if (now.packetsReceived != null && lastInbound.packetsReceived != null) {
        const dRecv = now.packetsReceived - lastInbound.packetsReceived;
        ppsRecv = (dRecv / dtSec).toFixed(0);
      }

      // RTP-level loss percentage
      if (now.packetsLost != null && lastInbound.packetsLost != null &&
          now.packetsReceived != null && lastInbound.packetsReceived != null) {
        const dLost = now.packetsLost - lastInbound.packetsLost;
        const dRecv = now.packetsReceived - lastInbound.packetsReceived;
        const dTotal = dLost + dRecv;
        lossIn = dTotal > 0 ? ((dLost / dTotal) * 100).toFixed(1) : '0.0';
      }

      // Audible concealment ratio (samples PLC'd / samples played).
      // This is the AUDIBLE loss after FEC/PLC has done its work —
      // it can be much lower than lossIn when RED + Opus FEC recover
      // most of the missing packets.
      if (now.concealedSamples != null && now.totalSamplesReceived != null
          && lastInbound.concealedSamples != null
          && lastInbound.totalSamplesReceived != null) {
        const dCon = now.concealedSamples - lastInbound.concealedSamples;
        const dTot = now.totalSamplesReceived - lastInbound.totalSamplesReceived;
        concealPct = dTot > 0 ? ((dCon / dTot) * 100).toFixed(2) : '0.00';
      }

      // Average jitter-buffer delay over packets emitted in this tick.
      // High values mean packets are arriving late and the buffer is
      // stretching to keep them. Persistent >150 ms on a 50 pps stream
      // means NetEQ is barely keeping up.
      if (now.jitterBufferDelay != null && now.jitterBufferEmittedCount != null
          && lastInbound.jitterBufferDelay != null
          && lastInbound.jitterBufferEmittedCount != null) {
        const dDelay = now.jitterBufferDelay - lastInbound.jitterBufferDelay;
        const dEmit = now.jitterBufferEmittedCount - lastInbound.jitterBufferEmittedCount;
        if (dEmit > 0) {
          jbDelayMs = Math.round((dDelay / dEmit) * 1000);
        }
      }

      // Jitter-buffer flushes during the tick. Non-zero means a
      // wholesale buffer reset (huge loss event).
      if (now.jitterBufferFlushes != null
          && lastInbound.jitterBufferFlushes != null) {
        jbFlushesDelta = now.jitterBufferFlushes - lastInbound.jitterBufferFlushes;
      }
    }
    lastInbound = now;
  }

  return { rttMs, lossOut, lossIn, ppsRecv, concealPct, jbDelayMs, jbFlushesDelta };
}

// ───────────────────────────────────────────────────────────────────────
// Media-fault verdict. Unlike snapshot() (which needs two ticks to derive
// per-interval rates and therefore reads "?" on short calls), this reads
// ABSOLUTE counters + transport state, so it produces a definitive answer
// on the very first sample — even on a 3-second test call.
//
// The goal is to mechanically decide which side owns a "no media" failure
// and write it to metro.log as a single [qos] VERDICT line, so we don't
// have to eyeball SDP dumps. The decision tree:
//
//   ice not connected      → domain=ICE     (no path to the gateway at all)
//   dtls not connected     → domain=SERVER  (path up, but DTLS/SRTP to the
//                                            gateway never completes → it
//                                            can't have keys to relay)
//   we send 0 packets      → domain=LOCAL   (our capture/encode/transceiver
//                                            isn't emitting RTP)
//   we send, recv 0        → domain=SERVER  (transport healthy, we ARE
//                                            sending, gateway returns no RTP
//                                            → it isn't relaying the peer leg)
//   send and recv both >0  → domain=OK      (media flows; if audio is still
//                                            bad it's codec/E2EE, not transport)
// ───────────────────────────────────────────────────────────────────────
async function collectMediaState(pc) {
  const stats = await pc.getStats();
  const pair = pickSelectedPair(stats);
  const num = (v) => (typeof v === 'number' ? v : 0);

  // Sum packets/bytes across ALL RTP streams (audio + video), because a video
  // call BUNDLEs audio and video onto one transport / 5-tuple — which is
  // exactly what the server's tcpdump counts. Counting only the audio stream
  // (as before) undercounted video calls badly and made the reconciliation
  // show huge phantom "loss" on the downlink.
  let transport = null;
  let packetsSent = 0, bytesSent = 0, packetsReceived = 0, bytesReceived = 0;
  stats.forEach((r) => {
    if (r.type === 'transport') transport = r;
    if (r.type === 'outbound-rtp') {
      packetsSent += num(r.packetsSent);
      bytesSent += num(r.bytesSent);
    } else if (r.type === 'inbound-rtp') {
      packetsReceived += num(r.packetsReceived);
      bytesReceived += num(r.bytesReceived);
    }
  });

  return {
    iceState: (pc && pc.iceConnectionState) || '?',
    pairState: pair ? pair.state : 'none',
    rttMs: pair && pair.currentRoundTripTime != null
      ? Math.round(pair.currentRoundTripTime * 1000) : '?',
    // transport.dtlsState / srtpCipher aren't surfaced by every rn-webrtc
    // build; fall back to pc.connectionState (which is 'connected' only
    // after DTLS) and to the presence of an SRTP cipher.
    dtlsState: transport && transport.dtlsState
      ? transport.dtlsState
      : ((pc && pc.connectionState) || '?'),
    srtpCipher: (transport && transport.srtpCipher) || null,
    packetsSent: packetsSent,
    bytesSent: bytesSent,
    packetsReceived: packetsReceived,
    bytesReceived: bytesReceived,
  };
}

// A direction counts as "flowing" only if it carries a MEANINGFUL number of
// packets — not just >0. One-way calls often still show a trickle (comfort
// noise / a few initial packets) on the dead side, so "received 26 vs sent 840"
// must read as one-way, not OK. "Meaningful" = at least FLOOR packets AND at
// least RATIO of the busier direction (audio is ~symmetric in pps).
const FLOW_FLOOR = 16;
const FLOW_RATIO = 0.2;
function _flowing(count, busier) {
  return count >= FLOW_FLOOR && count >= FLOW_RATIO * busier;
}

function classifyMediaFault(ms) {
  const iceOk = ms.pairState === 'succeeded'
    || ms.iceState === 'connected' || ms.iceState === 'completed';
  const dtlsOk = ms.dtlsState === 'connected' || !!ms.srtpCipher;
  const busier = Math.max(ms.packetsSent, ms.packetsReceived);
  const sending = _flowing(ms.packetsSent, busier);
  const receiving = _flowing(ms.packetsReceived, busier);

  // If RTP demonstrably flowed BOTH ways, the transport was fine — full stop.
  // getStats() read at teardown often catches ICE already 'disconnected' and
  // DTLS 'closed' (the PeerConnection is tearing down right after the call),
  // which must NOT be mistaken for an ICE/DTLS *failure*. Packets that moved
  // prove the path was up; a closed state at the end just means the call ended.
  if (sending && receiving) {
    return { domain: 'OK', reason: 'media flowing both ways' };
  }

  if (!iceOk) {
    // Only a genuine ICE failure if no media ever flowed. If we sent/received
    // some packets but the snapshot is closed, it's a teardown read, not a fault.
    if (ms.packetsSent > 0 || ms.packetsReceived > 0) {
      return { domain: 'ENDED', reason: 'call ended (ICE ' + ms.iceState + ') — media had flowed (sent=' + ms.packetsSent + ' recv=' + ms.packetsReceived + ')' };
    }
    return { domain: 'ICE', reason: 'no connected candidate pair to the gateway' };
  }
  if (!dtlsOk) {
    return { domain: 'SERVER', reason: 'DTLS/SRTP to gateway not established (dtls=' + ms.dtlsState + ') — gateway has no keys to relay' };
  }
  if (!sending) {
    return { domain: 'LOCAL', reason: 'we are emitting ' + ms.packetsSent + ' RTP packets — local capture/encode/transceiver' };
  }
  if (sending && !receiving) {
    return { domain: 'SERVER', reason: 'ONE-WAY: we sent ' + ms.packetsSent + ' pkts but received only ' + ms.packetsReceived + ' — nothing meaningful coming back (gateway/peer not relaying)' };
  }
  return { domain: 'OK', reason: 'media flowing both ways' };
}

// Emit one definitive [qos] VERDICT line. Guarded so a transient early
// read (before any RTP could possibly arrive) isn't reported as a fault:
// callers pass the call age so we only trust a "recv 0" verdict once the
// call has been up long enough for media to have arrived.
async function emitMediaVerdict(pc, callAgeMs) {
  // Capture the active Call-ID synchronously — it may be cleared by the time
  // the awaited getStats() resolves (teardown clears it right after firing us).
  const cid = activeCallId;
  try {
    const ms = await collectMediaState(pc);
    let v = classifyMediaFault(ms);
    // --- mid-call downlink-stall detection ---------------------------------
    // Track the recent recv RATE: if recv has FROZEN (no new inbound packets)
    // for RECV_STALL_TICKS reads while the uplink is still advancing, the
    // downlink stalled mid-call even though cumulative recv > 0. classifyMedia-
    // Fault would call this "OK" (251 recv > floor); override it so the user
    // sees the real fault the moment audio stops.
    const recvAdvanced = ms.packetsReceived > _stallLastRecv;
    const sentAdvanced = ms.packetsSent > _stallLastSent;
    if (recvAdvanced) {
      _recvStallTicks = 0;
      _recvStalledAtMs = callAgeMs;
    } else if (callAgeMs >= 2500 && sentAdvanced && ms.packetsReceived > 0) {
      _recvStallTicks += 1;
    }
    _stallLastRecv = ms.packetsReceived;
    _stallLastSent = ms.packetsSent;
    if (_recvStallTicks >= RECV_STALL_TICKS && (v.domain === 'OK' || v.domain === 'SERVER')) {
      const stoppedAtS = Math.round(_recvStalledAtMs / 1000);
      v = {
        domain: 'DOWNLINK-STALLED',
        reason: 'receive STOPPED ~' + stoppedAtS + 's in — recv frozen at ' + ms.packetsReceived
          + ' pkts while still sending ' + ms.packetsSent
          + ' (far side or a relay stopped, or our downlink path dropped)',
      };
    }
    // Persist absolute counts every time we read them (3 s one-shot, each
    // sampler tick, teardown) so the client result survives even if the
    // PeerConnection is already closed when the call ends. Latest wins.
    storeClientResult(cid, ms, v);
    // Suppress a premature SERVER/recv-0 verdict in the first ~2.5 s: RTP
    // may simply not have arrived yet. ICE/DTLS/LOCAL verdicts are valid
    // immediately.
    const tooEarly = callAgeMs < 2500
      && v.domain === 'SERVER'
      && ms.packetsReceived === 0
      && ms.packetsSent > 0;
    if (tooEarly) return null;
    qosLog(
      'VERDICT domain=' + v.domain
      + ' ice=' + ms.pairState + '/' + ms.iceState
      + ' dtls=' + ms.dtlsState + (ms.srtpCipher ? '(srtp=' + ms.srtpCipher + ')' : '')
      + ' sent=' + ms.packetsSent + 'p/' + ms.bytesSent + 'b'
      + ' recv=' + ms.packetsReceived + 'p/' + ms.bytesReceived + 'b'
      + ' rtt=' + ms.rttMs + 'ms age=' + Math.round(callAgeMs / 1000) + 's'
      + ' :: ' + v.reason
    );
    return v;
  } catch (e) {
    qosLog('VERDICT error=' + ((e && e.message) || e));
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Media-plane visual. Draws the end-to-end RTP pipeline FROM THIS PHONE'S
// PERSPECTIVE at call end, with a ✗ placed at the first hop where a given
// direction dies. The phone only directly observes its own two counters
// (packetsSent = uplink leaving into the gateway, packetsReceived = downlink
// arriving from the gateway); everything past Janus is inferred from the
// fault domain (classifyMediaFault) plus transport state. Pair this with the
// server-side [media-plane] block (Janus counters) and the MediaProxy trace
// for the full chain.
//
//   me ──▲ uplink ──▶ Janus ──▶ MediaProxy ──▶ Janus ──▶ peer
//   me ◀─▼ downlink ─ Janus ◀─ MediaProxy ◀─ Janus ◀─ peer
//
// emitted as multiple [qos] lines (console.log) so it survives in metro.log
// and adb logcat exactly like the STATS / VERDICT lines.
// ───────────────────────────────────────────────────────────────────────
function buildMediaPlane(ms, callAgeMs) {
  const iceOk = ms.pairState === 'succeeded'
    || ms.iceState === 'connected' || ms.iceState === 'completed';
  const dtlsOk = ms.dtlsState === 'connected' || !!ms.srtpCipher;
  const sending = ms.packetsSent > 0;
  const receiving = ms.packetsReceived > 0;
  // Don't accuse the downlink of being dead before RTP could plausibly arrive.
  const downlinkSettled = callAgeMs >= 2500;

  // A direction that actually carried packets is OK regardless of a stale
  // closed/disconnected ICE/DTLS snapshot (getStats() at teardown). Only blame
  // ICE/DTLS for a dead direction when that direction moved no packets at all.
  let up, upMark;     // me → peer
  if (sending) { up = 'OK — ' + ms.packetsSent + ' pkts into the gateway'; upMark = null; }
  else if (!iceOk) { up = 'BROKEN: no ICE path me→Janus'; upMark = 'me⇢Janus'; }
  else if (!dtlsOk) { up = 'BROKEN: DTLS/SRTP to Janus incomplete (gateway has no keys)'; upMark = 'Janus'; }
  else { up = 'BROKEN at me: emitting 0 RTP (capture / mic mute / transceiver)'; upMark = 'me'; }

  let down, downMark; // peer → me
  if (receiving) { down = 'OK — ' + ms.packetsReceived + ' pkts from the gateway'; downMark = null; }
  else if (!iceOk) { down = 'BROKEN: no ICE path Janus→me'; downMark = 'Janus⇢me'; }
  else if (!dtlsOk) { down = 'BROKEN: DTLS/SRTP to Janus incomplete'; downMark = 'Janus⇢me'; }
  else if (downlinkSettled) { down = 'BROKEN upstream of me: 0 RTP returned (Janus / MediaProxy / far leg not relaying)'; downMark = 'upstream'; }
  else { down = 'pending — no RTP yet (call only ' + Math.round(callAgeMs / 1000) + 's old)'; downMark = null; }

  // Inline ✗ position per row. The downlink ✗ sits before 📱me because the
  // loss is upstream of this phone; the uplink ✗ sits at the failing hop.
  const upRow = upMark === 'me'
    ? '📱me ✗▲ sent=' + ms.packetsSent + 'p ─▶ Janus ─▶ MediaProxy ─▶ Janus ─▶ 📱peer'
    : upMark
      ? '📱me ▲ sent=' + ms.packetsSent + 'p ─▶ ✗' + upMark + ' ─ MediaProxy ─ Janus ─ 📱peer'
      : '📱me ▲ sent=' + ms.packetsSent + 'p ─▶ Janus ─▶ MediaProxy ─▶ Janus ─▶ 📱peer';
  const downRow = downMark
    ? '📱me ◀─✗ ▼ recv=' + ms.packetsReceived + 'p ◀─ Janus ◀─ MediaProxy ◀─ Janus ◀─ 📱peer'
    : '📱me ▼ recv=' + ms.packetsReceived + 'p ◀─ Janus ◀─ MediaProxy ◀─ Janus ◀─ 📱peer';

  return [
    'media-plane callid=' + activeCallId + ' age=' + Math.round(callAgeMs / 1000) + 's  (▲ me→peer  ▼ peer→me)',
    '  ' + upRow,
    '  ' + downRow,
    '  transport: ice=' + ms.pairState + '/' + ms.iceState
      + ' dtls=' + ms.dtlsState + (ms.srtpCipher ? '(srtp)' : '') + ' rtt=' + ms.rttMs + 'ms',
    '  ▲ me→peer : ' + up,
    '  ▼ peer→me : ' + down,
  ];
}

// Store the client's per-call counters + verdict keyed by Call-ID, so app code
// can reconcile them against the server-side qos summary after the call (see
// getQosResult). Called repeatedly during the call; latest snapshot wins.
function storeClientResult(callId, ms, v) {
  if (!callId || callId === '?' || !ms) return;
  // Don't let a teardown snapshot (PC already closed -> 0 packets, ICE closed)
  // overwrite the good data captured DURING the call. If we already stored a
  // result that saw real packets and the new read is an empty/closed one, keep
  // the good one.
  const prev = qosResultsStore()[String(callId)];
  const newEmpty = (!ms.packetsSent && !ms.packetsReceived);
  if (prev && newEmpty && (prev.packetsSent || prev.packetsReceived)) return;
  qosResultsStore()[String(callId)] = {
    callId: String(callId),
    packetsSent: ms.packetsSent,
    packetsReceived: ms.packetsReceived,
    bytesSent: ms.bytesSent,
    bytesReceived: ms.bytesReceived,
    iceState: ms.pairState + '/' + ms.iceState,
    dtlsState: ms.dtlsState,
    rttMs: ms.rttMs,
    domain: (v && v.domain) || '?',
    reason: (v && v.reason) || '',
    capturedAt: Date.now(),
  };
  _persistResult(callId);
}

// Merge the per-tick quality metrics (the numbers in the [qos] STATS line)
// into the stored per-call result, so the QoS report carries them too.
function storeClientSnapshot(callId, s) {
  if (!callId || callId === '?' || !s) return;
  const r = qosResultsStore()[String(callId)] || { callId: String(callId) };
  r.lossIn = s.lossIn;
  r.lossOut = s.lossOut;
  r.concealPct = s.concealPct;
  r.jbDelayMs = s.jbDelayMs;
  r.jbFlushes = s.jbFlushesDelta;
  r.ppsRecv = s.ppsRecv;
  if (s.rttMs != null && s.rttMs !== '?') r.rttMs = s.rttMs;
  r.metricsAt = Date.now();
  qosResultsStore()[String(callId)] = r;
  _persistResult(callId);
}

// Final teardown capture. Tries one more getStats() for the most up-to-date
// counts; if the pc is already closed it FAILS QUIETLY, leaving whatever was
// captured during the call intact (never overwrites good data with an error).
async function captureFinalResult(pc, callId) {
  if (!callId || callId === '?') return;
  try {
    const ms = await collectMediaState(pc);
    storeClientResult(callId, ms, classifyMediaFault(ms));
  } catch (e) {
    if (!qosResultsStore()[String(callId)]) {
      qosResultsStore()[String(callId)] = { callId: String(callId), error: (e && e.message) || String(e), capturedAt: Date.now() };
    }
  }
}

async function emitMediaPlane(pc, callAgeMs) {
  try {
    const ms = await collectMediaState(pc);
    buildMediaPlane(ms, callAgeMs).forEach((line) => qosLog(line));
  } catch (e) {
    qosLog('media-plane error=' + ((e && e.message) || e));
  }
}

// Terminal PeerConnection states — once we see any of these in a
// sampler tick we emit DISCONNECT and stop the timer ourselves, so
// the sampler doesn't keep firing after the call ends if the caller
// forgets to invoke stopQosLogging() on teardown.
const DEAD_PC_STATES = new Set(['closed', 'failed', 'disconnected']);

function pcIsDead(pc) {
  if (!pc) return true;
  const cs = pc.connectionState;
  const ics = pc.iceConnectionState;
  if (cs && DEAD_PC_STATES.has(cs)) return true;
  if (ics && DEAD_PC_STATES.has(ics)) return true;
  return false;
}

export async function startQosLogging(pc, callId) {
  // Reset any prior session
  stopQosLogging();

  // Remember the call id for this session. Set AFTER stopQosLogging()
  // above (which resets activeCallId to '?') so it survives into the
  // CONNECT / STATS / DISCONNECT lines.
  activeCallId = (callId != null && String(callId) !== '') ? String(callId) : '?';

  qosLog(`startQosLogging called pc=${pc ? 'present' : 'null'} callid=${activeCallId}`);

  if (!pc || typeof pc.getStats !== 'function') {
    qosLog(`CONNECT error=no_peerconnection callid=${activeCallId}`);
    return;
  }

  const ep = await findEndpoints(pc);
  if (ep) endpoints = ep;
  qosLog(`CONNECT ${endpoints.local} <-> ${endpoints.remote} callid=${activeCallId}`);

  lastInbound = null;
  // Reset mid-call stall tracking for the new call.
  _stallLastRecv = 0;
  _stallLastSent = 0;
  _recvStallTicks = 0;
  _recvStalledAtMs = 0;
  let errorStreak = 0;
  const MAX_ERROR_STREAK = 3;
  const state = getGlobalState();
  const callStartedAt = Date.now();
  activePc = pc;
  activeStartedAt = callStartedAt;

  // Early one-shot verdict: test calls often get hung up at ~5 s before
  // the first 5 s sampler tick fires, so without this the [qos] VERDICT
  // line would never appear on exactly the calls we're debugging. Fire a
  // single verdict at 3 s — late enough that RTP should have arrived on a
  // healthy call, early enough to beat a frustrated hangup.
  setTimeout(() => {
    if (pc && !pcIsDead(pc)) {
      emitMediaVerdict(pc, Date.now() - callStartedAt);
      emitMediaPlane(pc, Date.now() - callStartedAt);
    }
  }, 3000);
  // Capture our own handle so a superseded interval can self-clear
  // if startQosLogging is invoked twice racily (and survive Fast
  // Refresh-induced module re-evaluation).
  const ownHandle = setInterval(async () => {
    try {
      // Safety net: if a newer interval has replaced ours (either
      // through another startQosLogging or a Fast-Refresh reload),
      // self-stop.
      if (ownHandle !== state.handle) {
        clearInterval(ownHandle);
        return;
      }
      // If the PeerConnection has died (call ended, ICE failed, etc.)
      // self-stop so we don't keep emitting STATS lines forever even
      // when the caller never wired up a teardown path.
      if (pcIsDead(pc)) {
        qosLog(`pc terminal (connectionState=${pc.connectionState} iceConnectionState=${pc.iceConnectionState}) — stopping sampler`);
        stopQosLogging();
        return;
      }
      // Re-resolve endpoints if they weren't ready on the first pass
      if (endpoints.local === 'unknown' || endpoints.remote === 'unknown') {
        const ep2 = await findEndpoints(pc);
        if (ep2) endpoints = ep2;
      }
      const s = await snapshot(pc);
      // Per-sample STATS line — re-enabled while investigating the
      // intermittent ZRTP "media stuck" failure. Without this, qos-
      // test.sh has nothing per-tick to correlate against the iperf3
      // probe and the server-side tcpdump, so the merged log just
      // shows CONNECT → (silence) → DISCONNECT and you can't tell
      // whether the WebRTC stack is seeing any inbound RTP at all.
      // Comment back out once the ZRTP failure is resolved if the
      // STATS chatter starts crowding out other debug work.
      qosLog(
        `STATS ${endpoints.local} <-> ${endpoints.remote} ` +
        `pps_recv=${s.ppsRecv} loss_out=${s.lossOut}% loss_in=${s.lossIn}% ` +
        `conceal=${s.concealPct}% jb_delay=${s.jbDelayMs}ms jb_flushes=${s.jbFlushesDelta} ` +
        `rtt=${s.rttMs}ms callid=${activeCallId}`
      );
      // Definitive fault-domain verdict alongside the rate stats. Reads
      // absolute counters + transport state so it's conclusive even when
      // the rate fields above are still "?" on a short call.
      await emitMediaVerdict(pc, Date.now() - callStartedAt);
      // Cache the just-computed sample so getLastQosSnapshot() callers
      // (MediaInfoPanel) see the SAME numbers as metro.log. We capture
      // endpoints by value because the module-level `endpoints` object
      // is mutated on every endpoint-re-resolve tick and we don't want
      // a stale-reference flicker on the panel.
      lastSnapshot = {
        capturedAt: Date.now(),
        local: endpoints.local,
        remote: endpoints.remote,
        ppsRecv: s.ppsRecv,
        lossOut: s.lossOut,
        lossIn: s.lossIn,
        concealPct: s.concealPct,
        jbDelayMs: s.jbDelayMs,
        jbFlushesDelta: s.jbFlushesDelta,
        rttMs: s.rttMs,
      };
      // Merge the per-tick quality metrics (loss / conceal / jitter-buffer /
      // rtt) into the stored per-call result so they reach the QoS report.
      storeClientSnapshot(activeCallId, s);
      errorStreak = 0;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      qosLog(`STATS error=${msg}`);
      errorStreak += 1;
      if (errorStreak >= MAX_ERROR_STREAK) {
        qosLog(`STATS ${errorStreak} consecutive errors — stopping sampler`);
        stopQosLogging();
      }
    }
  }, QOS_SAMPLE_INTERVAL_MS);
  state.handle = ownHandle;
}

export function stopQosLogging() {
  const state = getGlobalState();
  if (state.handle) {
    clearInterval(state.handle);
    state.handle = null;
    qosLog(`DISCONNECT callid=${activeCallId}`);
  }
  // Final fault-domain verdict on teardown. Fire-and-forget (getStats is
  // async and the pc may close immediately after) — captures the verdict
  // for calls hung up before any sampler tick. Snapshot the refs first
  // because we clear them synchronously below.
  const pc = activePc;
  const startedAt = activeStartedAt;
  const callId = activeCallId;
  if (pc) {
    try {
      if (!pcIsDead(pc)) {
        emitMediaVerdict(pc, Date.now() - startedAt);
        // Final end-to-end media-plane picture on teardown — the calls we're
        // debugging are often hung up within seconds, so this is the render
        // most likely to actually fire for a one-way call.
        emitMediaPlane(pc, Date.now() - startedAt);
      }
      // Persist the client's final per-call result for later reconciliation
      // with the server-side qos summary (keyed by Call-ID).
      captureFinalResult(pc, callId);
    } catch (e) { /* pc may already be closing */ }
  }
  activePc = null;
  activeStartedAt = 0;
  activeCallId = '?';
  endpoints = { local: 'unknown', remote: 'unknown' };
  lastInbound = null;
  lastSnapshot = null;
}

// Read-only accessor for the most recent computed sample. Returns null
// if no sample has been produced yet on this call (or if the sampler
// isn't running). MediaInfoPanel polls this every 1 s while open;
// startQosLogging's interval refreshes the cache every 5 s.
export function getLastQosSnapshot() {
  return lastSnapshot;
}

export default { startQosLogging, stopQosLogging, getLastQosSnapshot, getQosResult };
