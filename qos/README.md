# Sylk Mobile QoS — client telemetry + call-quality reconciliation

This folder is the **client side** of Sylk's media-plane QoS tooling. The
heavy lifting now happens elsewhere:

- **Server-side capture** lives in the SylkServer repo at
  **`sylkserver/qos-server/`** (`sylk-qos-server`). It runs on the WebRTC/Janus
  host, **auto-captures every call** from Janus events (no registration), and
  serves a per-call summary over HTTP(S). See that folder's README.
- **In-app reconciliation** lives in the Sylk Mobile app (`app/`): at call end
  the app fetches the server summary by Call-ID, compares it against the
  client's own measured packet counts, and shows a **Quality of Service**
  panel (with a "Send to support" button).

So `qos/` itself is now just:

```
qos/
  qos-stats.js   <- the React Native QoS module the app imports (load-bearing)
  qos-probe.py   <- OPTIONAL dev-host helper: iperf3 probe + read-only summary fetch
  qos-test.sh    <- LEGACY dev-host harness (SSH/tcpdump) — superseded by sylk-qos-server
  qos-log.sh     <- LEGACY internal: log merge + SSH probe
  qos-adb.sh     <- internal: tails adb logcat for release builds
  logs/          <- merged daily dev logs
```

## 1. `qos-stats.js` — the client module

Imported by `app/components/AudioCallBox.js` (and friends). It samples the
call's `RTCPeerConnection` and:

- emits `[qos]` log lines (CONNECT / STATS / VERDICT / media-plane) — these are
  captured into the app log (`console.log` is patched into the applog), so they
  ship with "Send to support".
- stores a per-call result keyed by **SIP Call-ID** (`getQosResult(callId)`),
  captured continuously during the call (3 s one-shot, every sampler tick, and
  teardown) so it survives the PeerConnection closing. This is what the app
  reconciles against the server summary.

`[qos] STATS` fields (audio):

| field | meaning |
|---|---|
| `pps_recv` | inbound RTP packets/sec (`inbound-rtp.packetsReceived` delta) |
| `loss_out` | RTCP `fractionLost` × 100 — loss the server reports about what WE sent |
| `loss_in` | per-tick `packetsLost`/`packetsReceived` — RTP gaps the receiver sees |
| `conceal` | `concealedSamples / totalSamplesReceived` — AUDIBLE loss after FEC/PLC |
| `jb_delay` | avg jitter-buffer delay per emitted packet, ms (healthy 40–100) |
| `jb_flushes` | jitter-buffer resets this tick (should be 0) |
| `rtt` | selected candidate-pair RTT, ms |

All of these now also feed the QoS report (the CLIENT section).

## 2. End-of-call flow (the modern path)

When a call ends:

1. The Janus host's `sylk-qos-server` has already captured the call (driven by
   Janus events) and written `<trace_dir>/qos/<YYYYMMDD>/<ts>-<CallId>/`.
2. The app (`app/app.js#fetchAndStoreNewCallTraces`) fetches:
   - the CDRTool SIP trace + media trace (as before), and
   - the **qos summary** from `sylk-qos-server`:
     `GET <qosServerUrl>/call/<CallId>/summary`
   and saves them next to each other under
   `<account>/<contact>/calls/<ts>-<CallId>.{sip,media,qos.json}`.
3. It **reconciles** the server's per-leg packet counts with the client's
   measured `sent`/`received` and logs `[qos] reconcile …` (uplink/downlink
   loss + both verdicts + agreement).
4. The call's chat system message is tappable → opens the **Quality of
   Service** panel (server + client counts, quality metrics, reconciliation, a
   clickable "Open full SIP trace in browser" link, and "Send to support").

The server publishes its base URL to the client as `configuration.qosServerUrl`
(stored in app state as `qosServerUrl`, persisted like the other server
settings). Without it, the app skips the qos fetch and behaves as before.

## 3. `qos-probe.py` — optional dev-host helper

Tails the `[qos]` CONNECT/STATS/DISCONNECT lines (from `metro.log` or adb
logcat) and adds an independent **iperf3** plain-UDP probe on the same
client→server path. The server-side capture is NOT driven from here anymore —
`sylk-qos-server` auto-captures from Janus. If `--daemon-url` is set, on
DISCONNECT it also does a **read-only** `GET /call/<id>/summary` and logs the
server's verdict + per-leg counts into `qos.log` for correlation.

```
# dev host
QOS_DAEMON_URL=https://webrtc-gateway.example.com:9810 ./qos-test.sh
```

Per-call endpoints need no token (the Call-ID is the capability). Set
`QOS_FETCH_DIR=./bundles` to also download each call's `.tar.gz`.

## 4. Legacy dev harness (`qos-test.sh` / `qos-log.sh`)

These predate `sylk-qos-server`: they SSH to the Janus host and run an ad-hoc
remote `tcpdump`. They still work for quick local debugging with Metro/adb logs,
but the server-side capture they do is **superseded** by `sylk-qos-server`
(which is more accurate, auto-triggered, and persistent). Prefer deploying
`sylk-qos-server` and using `qos-probe.py --daemon-url` for the read-only
summary fetch.

`qos-adb.sh` greps `[qos]` from `adb logcat` (tag `ReactNativeJS`) so release
builds (no Metro) feed the same `qos.log`.

## Where the client hooks live

`app/components/AudioCallBox.js`:

```js
import { startQosLogging, stopQosLogging } from '../../qos/qos-stats';
```

Wired at call `established` (start) and `terminated` / unmount (stop). The app
reads the captured result via `getQosResult(callId)` from the same module.
