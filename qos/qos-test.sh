#!/usr/bin/env bash
# qos/qos-test.sh — runs the QoS probe pipeline in this terminal.
#
# Prerequisite: metro-logs.sh is already running in another terminal
# (so that metro.log is being populated). This script does NOT start
# metro-logs.sh — they are independent processes.
#
# What this script does:
#   1. scp's qos-server.py to the WebRTC server ($QOS_SSH_HOST, default
#      "webrtc") and chmod +x's it.
#   2. Starts qos-log.sh in the background. qos-log.sh filters [qos] lines from
#      metro.log into qos.log, runs looping iperf3 probes, and (when
#      $QOS_SSH_HOST is set) SSH-launches qos-server.py on every call.
#   3. Tails the merged qos.log in THIS terminal so you see every
#      [qos], [qos-probe], [qos-server] and [qos-log] line as it appears.
#
# Usage:
#   cd sylk-mobile/qos
#   ./qos-test.sh                       # SSH host defaults to "webrtc"
#   QOS_SSH_HOST=otherhost ./qos-test.sh
#   QOS_SSH_HOST= ./qos-test.sh         # disable server-side probe
#
#   # Janus-relay mode: count packets in/out per server-side UDP port.
#   # Use this when both phones show the media-stuck pill — it proves
#   # whether Janus is actually receiving and forwarding RTP between
#   # the two legs. Pass the Janus-side ports printed in metro.log's
#   # `[qos] STATS ... <-> SERVER:PORT` lines (one per leg).
#   ./qos-test.sh ports 49035 43746
#   ./qos-test.sh ports --auto         # pull ports from latest metro.log
#
# Other env vars (forwarded to qos-log.sh):
#   METRO_LOG, QOS_LOG, PROBE_PORT, PROBE_BITRATE, PROBE_DURATION,
#   QOS_REMOTE_SCRIPT, QOS_SERVER_PROBE_DURATION
#
# Stop with Ctrl-C.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QOS_SH="$SCRIPT_DIR/qos-log.sh"
QOS_LOG_PATH="$SCRIPT_DIR/logs/$(date +%F)-qos.log"

# Default the WebRTC server SSH alias to `webrtc` if unset. An empty
# string still counts as set, so `QOS_SSH_HOST= ./qos-test.sh` disables
# the server-side probe.
export QOS_SSH_HOST="${QOS_SSH_HOST-webrtc}"

# ---------------------------------------------------------------------------
# Mode 2: per-port Janus-relay packet counter.
#
# When the active-call symptom is the "media stuck" pill on BOTH phones
# (ZRTP at key-agreed, no inbound RTP either way), the question is no
# longer "is there loss on one path" — it's "is Janus receiving anything
# at all on the server-side ports it negotiated, and is it forwarding to
# the other leg?". The per-call qos-server.py probe filters by ONE
# 5-tuple, which doesn't tell us anything about the OTHER leg, so this
# mode pivots: take a SET of server-side UDP ports (one per leg, two for
# a 1:1 call, more for a conference) and report, every 5 s, how many
# packets entered and left each one. If port A's `in` rises but port B's
# `out` stays at 0, Janus isn't relaying. If both `in` columns rise but
# `out` stays at 0 on both, the receivers are deaf even though Janus is
# fine. Etc.
#
# Output line (per sample, per port):
#   [qos-ports] sample t=5s port=49035 in=247 (+247, 49pps) out=243 (+243, 48pps)
#   [qos-ports] sample t=5s port=43746 in=240 (+240, 48pps) out=247 (+247, 49pps)
#
# `in`  = packets with dst port == this port (arriving at Janus)
# `out` = packets with src port == this port (leaving Janus toward client)
#
# Implementation:
#   - One ssh into $QOS_SSH_HOST running a single tcpdump filtered to
#     `udp and (port X or port Y or ...)`. Awk on the remote host parses
#     each line, tallies per-port in/out, and emits sample summaries.
#   - Trap on Ctrl-C kills the ssh, which kills the remote tcpdump (the
#     `-tt` PIPE close + bash trap on the remote shell handle teardown).
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "ports" ]]; then
  shift
  PORTS=()

  if [[ "${1:-}" == "--auto" ]]; then
    # Parse Janus-side ports out of the latest metro.log `[qos] STATS`
    # lines. Format we're matching:
    #   [qos] STATS 5.14.22.10:54791 <-> 174.142.205.47:49035 pps_recv=...
    # The right-hand IP:PORT is the Janus side — that's what we capture.
    METRO_LOG_PATH="${METRO_LOG:-$SCRIPT_DIR/../metro.log}"
    if [[ ! -f "$METRO_LOG_PATH" ]]; then
      echo "qos-test.sh ports --auto: metro.log not found at $METRO_LOG_PATH" >&2
      echo "Set METRO_LOG=/path/to/metro.log or pass explicit ports." >&2
      exit 1
    fi
    # Take the last ~200 STATS lines (the current call), dedupe the
    # server-side ports. tail-then-grep keeps us within the active call
    # rather than ports from older calls already in the log.
    mapfile -t PORTS < <(
      tac "$METRO_LOG_PATH" \
        | grep -m 200 '\[qos\] STATS ' \
        | grep -oE '<-> [0-9.]+:[0-9]+' \
        | grep -oE ':[0-9]+$' \
        | tr -d ':' \
        | awk '!seen[$0]++'
    )
    if [[ ${#PORTS[@]} -eq 0 ]]; then
      echo "qos-test.sh ports --auto: no Janus-side ports found in $METRO_LOG_PATH" >&2
      echo "Make sure the call is live and metro-logs.sh is running." >&2
      exit 1
    fi
    echo "qos-test.sh: auto-detected Janus ports from metro.log: ${PORTS[*]}"
  else
    for arg in "$@"; do
      if ! [[ "$arg" =~ ^[0-9]+$ ]]; then
        echo "qos-test.sh ports: '$arg' is not a port number" >&2
        exit 1
      fi
      PORTS+=("$arg")
    done
    if [[ ${#PORTS[@]} -eq 0 ]]; then
      echo "Usage: $0 ports <port1> [port2] ..." >&2
      echo "       $0 ports --auto" >&2
      exit 1
    fi
  fi

  if [[ -z "${QOS_SSH_HOST:-}" ]]; then
    echo "qos-test.sh ports: QOS_SSH_HOST is empty — set it to the Janus host" >&2
    exit 1
  fi

  SAMPLE_INTERVAL="${PORTS_SAMPLE_INTERVAL:-5}"

  # Build BPF filter: udp and (port X or port Y or ...)
  BPF="udp and ("
  for i in "${!PORTS[@]}"; do
    [[ $i -gt 0 ]] && BPF+=" or "
    BPF+="port ${PORTS[$i]}"
  done
  BPF+=")"

  # Comma-separated port list passed into the remote awk (so the awk
  # only has to track the ports we care about, and ignores anything
  # else tcpdump happens to print).
  PORTS_CSV="$(IFS=,; echo "${PORTS[*]}")"

  echo "qos-test.sh ports: ssh $QOS_SSH_HOST tcpdump filter='$BPF' interval=${SAMPLE_INTERVAL}s"
  echo "Press Ctrl-C to stop."
  echo "----"

  # Heredoc explanation:
  #   * `sudo -n tcpdump -i any -n -l -tt -q $BPF`
  #       - `-i any`   : capture on every interface (Janus listens on
  #                      whatever the default-route NIC is; `any` saves
  #                      us from guessing)
  #       - `-n`       : no DNS / no service-name resolution (fast, and
  #                      our awk needs raw numbers)
  #       - `-l`       : line-buffered so awk sees lines as they arrive
  #       - `-tt`      : print epoch seconds at the start of each line
  #                      (awk uses these as the wall-clock for sample
  #                      reporting — no per-line `date` call)
  #       - `-q`       : "quick" output, one IP/UDP line per packet
  #   * awk:
  #       - extracts `src.port > dst.port` from each line. tcpdump prints
  #         IPs as `1.2.3.4.PORT`, so port is the last dotted field.
  #       - increments `in[port]` if dst port matches a tracked port,
  #         `out[port]` if src port does
  #       - every $SAMPLE_INTERVAL seconds (wall-clock from -tt) prints
  #         a sample line per tracked port
  #       - on stdin close (Ctrl-C closes the ssh pipe → tcpdump exits →
  #            awk gets EOF) prints a final summary block
  #
  # We pipe the remote script over ssh stdin (`bash -s`) instead of
  # wedging it into `bash -lc '...'`, because the awk body contains
  # single quotes and `$1` / `$3` field refs that get mauled by nested
  # shell quoting. With a quoted heredoc + manual placeholder substitution
  # for the three local values we care about ($BPF, $PORTS_CSV,
  # $SAMPLE_INTERVAL), everything else is preserved literally and the
  # remote shell sees a clean, unescaped script.
  REMOTE_TEMPLATE=$(cat <<'REMOTE_TEMPLATE_EOF'
set -u
# Use sudo only if we aren't already root. -n so it never prompts —
# misconfiguration is loud rather than hung.
if [ "$(id -u)" -eq 0 ]; then
  TCPDUMP=tcpdump
else
  TCPDUMP="sudo -n tcpdump"
fi
exec $TCPDUMP -i any -n -l -tt -q "__BPF__" 2>/dev/null \
  | awk -v ports="__PORTS_CSV__" -v interval="__INTERVAL__" '
    BEGIN {
      n = split(ports, plist, ",")
      for (i = 1; i <= n; i++) {
        p = plist[i]
        track[p] = 1
        in_cnt[p] = 0; out_cnt[p] = 0
        last_in[p] = 0; last_out[p] = 0
      }
      start = 0
      last_t = 0
    }
    {
      # tcpdump -tt -q line example:
      # 1717241565.123456 IP 86.127.76.54.42751 > 174.142.205.47.43746: UDP, length 160
      # $1 = timestamp, $3 = src IP.port, $4 = ">", $5 = dst IP.port (with trailing ":")
      t = $1 + 0
      if (start == 0) { start = t; last_t = t }
      src = $3; dst = $5
      # strip trailing ":" off dst
      sub(/:$/, "", dst)
      # last dotted field of each is the port (IPv4: a.b.c.d.PORT)
      n1 = split(src, sa, ".")
      n2 = split(dst, da, ".")
      sport = sa[n1]
      dport = da[n2]
      if (dport in track) in_cnt[dport]++
      if (sport in track) out_cnt[sport]++

      # Periodic sample
      if (t - last_t >= interval) {
        elapsed = t - last_t
        for (i = 1; i <= n; i++) {
          p = plist[i]
          d_in  = in_cnt[p]  - last_in[p]
          d_out = out_cnt[p] - last_out[p]
          ipps = elapsed > 0 ? d_in  / elapsed : 0
          opps = elapsed > 0 ? d_out / elapsed : 0
          printf("[qos-ports] sample t=%ds port=%s in=%d (+%d, %.0fpps) out=%d (+%d, %.0fpps)\n",
                 int(t - start), p, in_cnt[p], d_in, ipps, out_cnt[p], d_out, opps)
          last_in[p]  = in_cnt[p]
          last_out[p] = out_cnt[p]
        }
        fflush()
        last_t = t
      }
    }
    END {
      now = (last_t > 0) ? last_t : start
      duration = now - start
      printf("[qos-ports] end duration=%.1fs\n", duration)
      for (i = 1; i <= n; i++) {
        p = plist[i]
        printf("[qos-ports] end port=%s in_total=%d out_total=%d\n", p, in_cnt[p], out_cnt[p])
      }
      # Quick relay-health verdict. For a 1:1 call we expect each port
      # to have roughly equal in and out (RTP coming in is the OTHER
      # leg output and vice versa, modulo RTCP). Pairs of ports should
      # mirror each other: port A in ≈ port B out. Coarse check: if any
      # port has in>20 but out<5 (or vice versa), call it asymmetric.
      asym = 0
      for (i = 1; i <= n; i++) {
        p = plist[i]
        if ((in_cnt[p]  > 20 && out_cnt[p] < 5) ||
            (out_cnt[p] > 20 && in_cnt[p]  < 5)) {
          asym = 1
          break
        }
      }
      anytraffic = 0
      for (i = 1; i <= n; i++) {
        p = plist[i]
        if (in_cnt[p] + out_cnt[p] > 0) { anytraffic = 1; break }
      }
      if (!anytraffic) {
        print "[qos-ports] conclusion: NO packets on any tracked port — clients are not reaching Janus (network path / firewall / wrong ports)"
      } else if (asym) {
        print "[qos-ports] conclusion: ASYMMETRIC — some ports have inbound RTP but no outbound (or vice versa); Janus is NOT relaying for the silent leg"
      } else {
        print "[qos-ports] conclusion: SYMMETRIC traffic on all ports — Janus is receiving AND forwarding; loss is downstream of Janus (client→NIC→app)"
      }
      fflush()
    }
  '
REMOTE_TEMPLATE_EOF
)

  # Substitute the three placeholders without touching anything else.
  # Bash parameter expansion `${var//pattern/replacement}` does literal
  # global replace — no regex metacharacters in play here so ports/BPF
  # are safe.
  REMOTE_CMD="${REMOTE_TEMPLATE//__BPF__/$BPF}"
  REMOTE_CMD="${REMOTE_CMD//__PORTS_CSV__/$PORTS_CSV}"
  REMOTE_CMD="${REMOTE_CMD//__INTERVAL__/$SAMPLE_INTERVAL}"

  # ssh + bash -s reads the script from stdin so the nested awk/tcpdump
  # single quotes don't have to survive a `bash -lc '...'` trip. We use
  # `-tt` to keep the tcpdump line-buffered output flowing back through
  # ssh, and ServerAlive to keep the link healthy across long idle
  # stretches mid-call.
  ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
      "$QOS_SSH_HOST" "bash -s" <<<"$REMOTE_CMD"
  exit 0
fi
# ---------------------------------------------------------------------------
# End of Mode 2. Below is the original qos-test.sh probe orchestration.
# ---------------------------------------------------------------------------

if [[ ! -x "$QOS_SH" ]]; then
  echo "qos-test.sh: $QOS_SH not found or not executable" >&2
  exit 1
fi

# Ensure log directory + log file exist so tail -F starts cleanly.
mkdir -p "$(dirname "$QOS_LOG_PATH")"
: >> "$QOS_LOG_PATH"

# Friendly header in this terminal (NOT in qos.log, to keep that machine-parseable).
echo "qos-test.sh: starting"
echo "  qos-log.sh        : $QOS_SH"
echo "  qos log       : $QOS_LOG_PATH"
if [[ -n "$QOS_SSH_HOST" ]]; then
  echo "  server probe  : ssh $QOS_SSH_HOST python3 ${QOS_REMOTE_SCRIPT:-qos-server.py}"
else
  echo "  server probe  : disabled (QOS_SSH_HOST is empty)"
fi
echo
echo "Note: metro-logs.sh should already be running in another terminal."
echo "All [qos], [qos-probe] and [qos-server] lines stream below."
echo "Press Ctrl-C to stop."
echo "----"
echo

# Start qos-log.sh in the background. We suppress its own stdout/stderr to
# avoid duplicating lines that already land in qos.log; tail -F below
# is the single visible stream.
"$QOS_SH" >/dev/null 2>&1 &
QOS_PID=$!

# Wait briefly for qos-log.sh to scp the server script and write its
# `[qos-log] starting` banner into qos.log so it's the first line tail
# picks up.
sleep 1

# Tail the merged log in the background so the trap below can fire on
# Ctrl-C and we can clean up both children deterministically.
tail -n0 -F "$QOS_LOG_PATH" &
TAIL_PID=$!

cleanup() {
  trap - INT TERM EXIT
  echo
  echo "qos-test.sh: stopping qos-log.sh (pid=$QOS_PID) and tail (pid=$TAIL_PID)"
  # Kill the tail first so we don't echo our own teardown lines twice.
  kill -TERM "$TAIL_PID" 2>/dev/null
  # qos-log.sh spawns its own tail + python qos-probe.py; signal the group.
  kill -TERM -"$QOS_PID" 2>/dev/null || kill -TERM "$QOS_PID" 2>/dev/null
  sleep 0.3
  kill -KILL "$TAIL_PID" 2>/dev/null
  kill -KILL -"$QOS_PID" 2>/dev/null || kill -KILL "$QOS_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

# Block until tail exits (only happens on Ctrl-C, due to the trap).
wait "$TAIL_PID"
