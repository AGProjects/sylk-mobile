#!/usr/bin/env bash
# qos-adb.sh — capture [qos] lines from adb logcat into qos.log.
#
# Works with release Android builds (no Metro needed). React Native
# forwards every console.log call to Android's logcat under tag
# `ReactNativeJS`; this script greps those for "[qos]", strips the
# logcat prefix, dedupes consecutive duplicates, and appends to
# qos.log so qos-probe.py and qos-test.sh can pick them up the same
# way they pick up Metro-sourced lines.
#
# Usage:
#   ./qos-adb.sh                 # all connected Android devices
#   ./qos-adb.sh -d <serial>     # one specific device
#
# Env vars:
#   QOS_LOG     output log (default: logs/$(date +%F)-qos.log)
#
# Stop with Ctrl-C.
#
# Caveat for release builds: if your babel config strips console.log
# (babel-plugin-transform-remove-console), no [qos] lines will appear
# in logcat. Either remove that plugin in the variant you're debugging
# or switch qos-stats.js to use a native logger that isn't stripped.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QOS_LOG="${QOS_LOG:-$SCRIPT_DIR/logs/$(date +%F)-qos.log}"
mkdir -p "$(dirname "$QOS_LOG")"
: >> "$QOS_LOG"

if ! command -v adb >/dev/null 2>&1; then
    echo "qos-adb.sh: adb not found in PATH" >&2
    exit 1
fi

DEVICES=""
if [[ "${1:-}" == "-d" && -n "${2:-}" ]]; then
    DEVICES="$2"
else
    DEVICES=$(adb devices 2>/dev/null | awk 'NR>1 && /device$/ {print $1}')
fi

if [[ -z "$DEVICES" ]]; then
    echo "qos-adb.sh: no Android device connected (run 'adb devices')" >&2
    exit 1
fi

echo "qos-adb.sh: writing [qos] lines to $QOS_LOG"
echo "qos-adb.sh: devices:"
for d in $DEVICES; do echo "  $d"; done
echo "qos-adb.sh: Ctrl-C to stop"
echo "$(date '+%H:%M:%S') [qos-adb] starting; devices=$DEVICES" >> "$QOS_LOG"

ADB_PIDS=()
for dev in $DEVICES; do
    short_dev="${dev:0:12}"
    # adb logcat -T 1 starts at "now" (skips the entire backlog).
    # `ReactNativeJS:V *:S` keeps only the JS tag at any priority.
    ( adb -s "$dev" logcat -v threadtime -T 1 ReactNativeJS:V '*:S' 2>/dev/null \
      | grep --line-buffered -E '\[qos\]' \
      | awk -v dev="$short_dev" '{
            i = index($0, "[qos] ")
            if (i <= 0) next
            payload = substr($0, i)
            # RN wraps the console.log arg in single quotes; strip a
            # trailing closing quote if present.
            sub(/'"'"'[[:space:]]*$/, "", payload)
            if (payload == last) next
            last = payload
            # Pull wallclock HH:MM:SS by shelling out once per line.
            cmd = "date +%H:%M:%S"
            ts = ""; cmd | getline ts; close(cmd)
            print "[" ts "] [ADB:" dev "] " payload
            fflush()
        }' \
      >> "$QOS_LOG" ) &
    ADB_PIDS+=($!)
done

cleanup() {
    trap - INT TERM EXIT
    echo
    echo "qos-adb.sh: stopping"
    for pid in "${ADB_PIDS[@]}"; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
    echo "$(date '+%H:%M:%S') [qos-adb] stopped" >> "$QOS_LOG"
    exit 0
}
trap cleanup INT TERM EXIT

wait
