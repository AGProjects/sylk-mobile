#!/usr/bin/env bash
# qos-log.sh — run alongside metro-logs.sh to produce a unified per-day qos.log
# containing Sylk Mobile's [qos] STATS lines and qos-probe's [qos-probe]
# iperf3 results.
#
# Layout (relative to the sylk-mobile repo root):
#
#   sylk-mobile/
#     metro.log                <- written by metro-logs.sh
#     qos/
#       qos-log.sh                 <- this script
#       qos-probe.py           <- spawns iperf3 probes against the call's remote IP
#       qos-stats.js           <- React Native module (imported by AudioCallBox.js)
#       logs/
#         YYYY-MM-DD-qos.log   <- output (one per UTC day)
#
# Usage:
#   cd sylk-mobile/qos
#   ./qos-log.sh
#
# Then, in another terminal:
#   tail -F logs/$(date +%F)-qos.log
#
# Environment overrides:
#   METRO_LOG       path to the Metro log to read (default: ../metro.log)
#   QOS_LOG         path to the output log (default: logs/$(date +%F)-qos.log)
#   PROBE_PORT      iperf3 server port (default: 5001)
#   PROBE_BITRATE   probe bitrate (default: 80K, matches Opus)
#   PROBE_DURATION  seconds per probe iteration (default: 5)

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

METRO_LOG="${METRO_LOG:-../metro.log}"
PROBE_PORT="${PROBE_PORT:-5001}"
PROBE_BITRATE="${PROBE_BITRATE:-80K}"
PROBE_DURATION="${PROBE_DURATION:-5}"
QOS_SSH_HOST="${QOS_SSH_HOST:-}"
QOS_REMOTE_SCRIPT="${QOS_REMOTE_SCRIPT:-qos-server.py}"

mkdir -p logs
QOS_LOG="${QOS_LOG:-logs/$(date +%F)-qos.log}"

# Make sure metro.log exists so tail -F doesn't busy-fail.
touch "$METRO_LOG"

# Header in the day-log
{
  echo "----"
  echo "$(date '+%H:%M:%S') [qos-log] starting"
  echo "$(date '+%H:%M:%S') [qos-log] metro_log=$METRO_LOG qos_log=$QOS_LOG probe_port=$PROBE_PORT bitrate=$PROBE_BITRATE duration=${PROBE_DURATION}s"
} >> "$QOS_LOG"

# If server-side probing is enabled, ship qos-server.py to the server
# once at startup so the remote copy is always fresh. We use the
# QOS_REMOTE_SCRIPT path as the scp destination, then chmod +x. Also
# ensure an iperf3 server is listening on $PROBE_PORT (idempotent —
# if one's already running we leave it alone).
if [[ -n "$QOS_SSH_HOST" ]]; then
    SERVER_SRC="$SCRIPT_DIR/qos-server.py"
    if [[ ! -f "$SERVER_SRC" ]]; then
        echo "qos-log.sh: WARNING: $SERVER_SRC not found — server probe will fail"
        echo "$(date '+%H:%M:%S') [qos-log] WARNING: $SERVER_SRC missing" >> "$QOS_LOG"
    else
        echo "qos-log.sh: scp $SERVER_SRC -> $QOS_SSH_HOST:$QOS_REMOTE_SCRIPT"
        if scp -q -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
               "$SERVER_SRC" "${QOS_SSH_HOST}:${QOS_REMOTE_SCRIPT}"; then
            ssh -o BatchMode=yes "$QOS_SSH_HOST" \
                "chmod +x ${QOS_REMOTE_SCRIPT}" 2>/dev/null || true
            echo "$(date '+%H:%M:%S') [qos-log] scp qos-server.py to $QOS_SSH_HOST:$QOS_REMOTE_SCRIPT OK" >> "$QOS_LOG"
        else
            echo "qos-log.sh: WARNING: scp failed — remote probe may be missing/stale"
            echo "$(date '+%H:%M:%S') [qos-log] WARNING: scp to $QOS_SSH_HOST failed" >> "$QOS_LOG"
        fi
    fi

    # Idempotently start iperf3 -s on the server. We check for an
    # existing listener on PROBE_PORT and skip if one's already there.
    # `setsid` puts iperf3 in its own session so it can't be killed when
    # the SSH client (or any parent) goes away. nohup + null stdin/out
    # is the belt-and-suspenders version of the same idea.
    echo "qos-log.sh: ensuring iperf3 -s -p $PROBE_PORT is running on $QOS_SSH_HOST"
    IPERF_BOOT_CMD="if ss -ulnH 2>/dev/null | awk '{print \$5}' | grep -q ':'$PROBE_PORT'\$'; then \
        echo iperf3-already-running; \
    else \
        setsid nohup iperf3 -s -p $PROBE_PORT >/tmp/qos-iperf3.log 2>&1 </dev/null & \
        disown 2>/dev/null; \
        for i in 1 2 3 4 5 6 7 8 9 10; do \
            sleep 0.3; \
            if ss -ulnH 2>/dev/null | awk '{print \$5}' | grep -q ':'$PROBE_PORT'\$'; then \
                echo iperf3-started; \
                exit 0; \
            fi; \
        done; \
        echo iperf3-failed; \
        echo \"iperf3 stderr/stdout:\"; \
        cat /tmp/qos-iperf3.log 2>/dev/null | head -5; \
    fi"
    IPERF_STATUS=$(ssh -o BatchMode=yes "$QOS_SSH_HOST" "$IPERF_BOOT_CMD" 2>/dev/null || echo "ssh-failed")
    echo "$(date '+%H:%M:%S') [qos-log] iperf3 server: $IPERF_STATUS" >> "$QOS_LOG"
    if [[ "$IPERF_STATUS" == "ssh-failed" ]]; then
        echo "qos-log.sh: WARNING: could not start iperf3 server via SSH"
    fi
fi

# Filter [qos] lines from metro.log into qos.log.
#
# The awk step extracts everything starting at "[qos] " and dedupes by
# that payload alone. Metro's dev runtime can multiplex each
# console.warn into N events on stdout (one for the WS log channel,
# one for the LogBox warning, etc.), so we routinely see the SAME
# logical [qos] line repeated. By keying the dedupe on the payload
# (not the full line with timestamp), we collapse those copies cleanly
# and prefix our own [HH:MM:SS] [METRO] tag so the source is visible.
( tail -n0 -F "$METRO_LOG" 2>/dev/null \
  | grep --line-buffered -E '\[qos\][[:space:]]' \
  | awk '{
        i = index($0, "[qos] ")
        if (i <= 0) next
        payload = substr($0, i)
        if (payload == last_payload) next
        last_payload = payload
        cmd = "date +%H:%M:%S"
        ts = ""; cmd | getline ts; close(cmd)
        print "[" ts "] [METRO] " payload
        fflush()
    }' \
  >> "$QOS_LOG" ) &
TAIL_PID=$!

# qos-probe.py tails qos.log itself (which has [qos] lines from
# whichever source — Metro.log filter above, or adb logcat below).
# It watches for [qos] CONNECT/STATS/DISCONNECT and runs iperf3 probes,
# writing [qos-probe] lines back into qos.log. If QOS_SSH_HOST is set,
# it also SSH-launches qos-server.py on the WebRTC host for each call.
PROBE_ARGS=(
    --log "$QOS_LOG"
    --output "$QOS_LOG"
    --port "$PROBE_PORT"
    --bitrate "$PROBE_BITRATE"
    --duration "$PROBE_DURATION"
    --remote-script "$QOS_REMOTE_SCRIPT"
)
if [[ -n "$QOS_SSH_HOST" ]]; then
    PROBE_ARGS+=(--ssh-host "$QOS_SSH_HOST")
fi
python3 "$SCRIPT_DIR/qos-probe.py" "${PROBE_ARGS[@]}" &
PROBE_PID=$!

# If adb is available and Android devices are connected, also tail
# their logcat — this is the path that works for RELEASE builds where
# Metro isn't running. qos-adb.sh appends to the same QOS_LOG. Dedup
# in each source means duplicates between metro.log and adb logcat
# don't pile up in practice for the same JS context, but harmless if
# they do.
ADB_QOS_PID=""
if command -v adb >/dev/null 2>&1; then
    ADB_DEVICES=$(adb devices 2>/dev/null | awk 'NR>1 && /device$/ {print $1}' | tr '\n' ' ')
    if [[ -n "$ADB_DEVICES" ]]; then
        echo "qos-log.sh: starting qos-adb.sh for: $ADB_DEVICES"
        QOS_LOG="$QOS_LOG" "$SCRIPT_DIR/qos-adb.sh" >/dev/null 2>&1 &
        ADB_QOS_PID=$!
    fi
fi

cleanup() {
  kill "$TAIL_PID" "$PROBE_PID" 2>/dev/null
  if [[ -n "$ADB_QOS_PID" ]]; then
    kill "$ADB_QOS_PID" 2>/dev/null
  fi
  echo "$(date '+%H:%M:%S') [qos-log] stopped" >> "$QOS_LOG"
  exit 0
}
trap cleanup INT TERM

echo "qos-log.sh: filtering [qos] from $METRO_LOG, probes -> $QOS_LOG"
echo "qos-log.sh: in another terminal:"
echo "          tail -F $SCRIPT_DIR/$QOS_LOG"
echo "qos-log.sh: press Ctrl-C to stop"
wait
