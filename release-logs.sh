#!/usr/bin/env bash
#
# Capture filtered adb logcat output from every connected Android
# device in parallel into a single combined log file. Each line is
# prefixed with the originating device serial so multi-device sessions
# (e.g. Nokia 6.2 + Razr 60 Ultra side-by-side) stay disentangleable
# after the fact.
#
# Usage:
#   ./release-logs.sh                  # writes to release.log
#   ./release-logs.sh path/to/my.log   # custom output path
#
# Ctrl-C cleanly tears down every per-device logcat subprocess AND
# every pipeline child (adb / grep / awk) it spawned. Previous
# versions only killed the per-device subshell, leaving its pipeline
# children (`adb -s <serial> logcat ... | grep ... | awk ...`)
# orphaned and still writing to the log file. The next invocation
# would then write the same events twice (the new stream + the orphan
# from the previous run); a third run wrote each event three times;
# and so on — "after every phone app reload / restart one more line".
# Mirroring metro-logs.sh's kill_descendants + PID-file approach so
# (a) a stale instance is torn down at startup and (b) Ctrl-C kills
# every adb logcat process this script ever started.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOG="${1:-$SCRIPT_DIR/release.log}"
PID_FILE="$SCRIPT_DIR/.release-logs.pid"

# Filter spec: app logs + JS console + native crashes; everything else
# silenced. Kept in sync with the single-device version.
FILTER=(SYLK_APP:D ReactNativeJS:D AndroidRuntime:E '*:S')

# Recursively send a signal to every descendant of $1 (NOT $1 itself).
# Uses pgrep, which is available on macOS and Linux. This is the
# heart of the duplicate-line fix: `kill $subshell_pid` only kills
# the bash subshell hosting the pipeline; the adb / grep / awk
# children inside the pipeline keep running with their stdout still
# pointing at $LOG, producing exact duplicates on every subsequent
# event. Walking the tree and signalling each child guarantees the
# adb stream actually stops.
kill_descendants() {
    local parent=$1
    local sig=${2:-TERM}
    local kid
    for kid in $(pgrep -P "$parent" 2>/dev/null); do
        kill_descendants "$kid" "$sig"
        kill -"$sig" "$kid" 2>/dev/null || true
    done
}

# If a previous instance is still alive, terminate it (and its tree) first.
# Without this, an earlier run that was force-quit (kill -9, terminal
# closed, machine put to sleep) leaves orphan `adb logcat` processes
# alive, still appending to $LOG. Spawning a fresh stream on top of
# those orphans is exactly what produces the N-way duplication the
# user sees.
if [[ -f "$PID_FILE" ]]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
        echo "Stopping previous instance (PID $old_pid)..." >&2
        kill_descendants "$old_pid" TERM
        kill -TERM "$old_pid" 2>/dev/null || true
        for _ in 1 2 3 4 5; do
            kill -0 "$old_pid" 2>/dev/null || break
            sleep 0.2
        done
        if kill -0 "$old_pid" 2>/dev/null; then
            kill_descendants "$old_pid" KILL
            kill -KILL "$old_pid" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

# Enumerate connected, authorised devices. `adb devices` prints a
# header line ("List of devices attached") plus one row per device:
#   <serial>\tdevice              (ready)
#   <serial>\tunauthorized        (USB-debug prompt pending)
#   <serial>\toffline             (transport lost)
# Only the "device" rows are usable for logcat.
mapfile -t DEVICES < <(adb devices | awk '$2 == "device" { print $1 }')

if [[ ${#DEVICES[@]} -eq 0 ]]; then
    echo "release-logs.sh: no connected Android devices (adb devices shows none in 'device' state)" >&2
    rm -f "$PID_FILE"
    exit 1
fi

# Archive the previous run's log before this run appends to it. Each
# start moves the existing $LOG into logs/YYYYMMDDHHMMSS-release.log so
# prior runs are preserved instead of accumulating into one file.
# Timestamp uses the file's own mtime (when that run finished writing),
# falling back to "now" if unavailable.
if [[ -e "$LOG" ]]; then
    ARCHIVE_DIR="$SCRIPT_DIR/logs"
    mkdir -p "$ARCHIVE_DIR"
    base="$(basename "$LOG" .log)"
    ts=$(date -r "$LOG" '+%Y%m%d%H%M%S' 2>/dev/null || date '+%Y%m%d%H%M%S')
    archive="$ARCHIVE_DIR/${ts}-${base}.log"
    # Avoid clobbering if two runs share the same second.
    if [[ -e "$archive" ]]; then
        archive="$ARCHIVE_DIR/${ts}-$$-${base}.log"
    fi
    mv "$LOG" "$archive"
    echo "release-logs.sh: archived previous log to $archive" >&2
fi

echo "release-logs.sh: capturing from ${#DEVICES[@]} device(s) into $LOG" >&2
for d in "${DEVICES[@]}"; do
    echo "  - $d" >&2
done

# Per-device PIDs so the trap can stop them on Ctrl-C / SIGTERM.
PIDS=()

cleanup_done=0
cleanup() {
    [[ $cleanup_done -eq 1 ]] && return
    cleanup_done=1
    # Disarm further traps so we don't recurse during the kill cascade.
    trap '' INT TERM EXIT
    # Drop the background jobs from the shell's job table BEFORE killing
    # them. Otherwise bash reaps each signalled job and prints a
    # job-control completion notice — "Done   adb -s ... | grep ... | awk
    # '{ …the whole awk script… }'" — to the terminal on Ctrl-C, i.e. pages
    # of noise per device. `disown` does NOT detach the processes from our
    # tree, so kill_descendants (which walks `pgrep -P`, not the job table)
    # still tears every one of them down; it only silences the notices.
    disown -a 2>/dev/null || true
    # Tear down EVERY descendant — the subshells we spawned AND the
    # adb / grep / awk pipeline processes inside them. Without the
    # recursion the pipeline children get orphaned and keep writing
    # to $LOG, which is exactly the bug this rewrite fixes.
    kill_descendants $$ TERM
    # Brief grace period so children can flush & exit cleanly.
    for _ in 1 2 3 4 5; do
        [[ -z "$(pgrep -P $$ 2>/dev/null)" ]] && break
        sleep 0.2
    done
    # Anything still alive gets SIGKILL.
    kill_descendants $$ KILL
    # No `wait` here: the jobs are disowned (not waitable) and already
    # signalled, and waiting on a signalled job is what re-triggers the
    # completion notice we just suppressed.
    rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

# Clear the ring buffer on every device first so the capture starts
# at "now" rather than including whatever scrolled past before we
# attached. `adb -s <serial> logcat -c` is a one-shot that exits
# immediately.
for serial in "${DEVICES[@]}"; do
    adb -s "$serial" logcat -c || true
done

# Substring blacklist applied to every log line before it's written
# to disk. These tags are loud, low-signal, and drown the rest of
# the file. Add more here as they show up.
#   rn-webrtc:pc:DEBUG  — react-native-webrtc per-stat / per-event
#                         spam (multiple lines per second during a
#                         call, hundreds of KB per minute).
#
#   Qualcomm/QTI vendor crashes — on Qualcomm-chipset devices (e.g.
#   the Sony XQ-EC72) the system process `com.qti.qcc` repeatedly
#   FATAL-crashes inside `com.qualcomm.qti.qdma.*` (RegionServer /
#   ActiveCareService / DMENativeInterface) with a
#   StringIndexOutOfBoundsException parsing the serving MCC while the
#   radio has no full network yet. This is a vendor/firmware bug,
#   totally unrelated to Sylk (`com.agprojects.sylk`), but it spams
#   the AndroidRuntime:E channel with full stack traces. Drop the
#   vendor frames + the crash header that name these packages. Real
#   Sylk crashes don't reference com.qualcomm/com.qti so they pass
#   through untouched.
#   The captured trace often arrives WITHOUT the com.qualcomm.* frames
#   (only the generic AOSP frames survive logcat), so package-name
#   matching alone isn't enough. We also drop the bug's distinctive
#   signature: a StringIndexOutOfBoundsException routed through
#   String.substring/checkBoundsBeginEnd on a vendor "Thread-N" (Sylk's
#   own crashes land on "main" / "mqt_*", never "Thread-N", so they're
#   unaffected). Only the boilerplate bottom frame (java.lang.Thread.run)
#   is shared with real traces — losing that one frame doesn't hide a
#   genuine crash, whose exception + app frames still print.
SUPPRESS_REGEX='rn-webrtc:pc:DEBUG|com\.qualcomm\.qti|com\.qti\.qcc|qdma\.(util|dme|app)|RegionServer|DMENativeInterface|ActiveCareService|StringIndexOutOfBoundsException|String\.checkBoundsBeginEnd|at java\.lang\.String\.substring|FATAL EXCEPTION: Thread-|at java\.lang\.Thread\.run\(Thread\.java'

# Spawn one logcat-tail per device. Each one prefixes every line with
# "[<serial>] " via awk so the merged file stays grep-friendly:
#   grep '\[ZY22LCXTPW\]'  release.log
#   grep '\[abcd1234\]'    release.log
# The awk pipeline runs unbuffered (-W interactive on mawk, line
# buffering elsewhere via `fflush()`).
#
# Newline un-escaping: adb logcat is line-oriented, so React Native's
# Android logging bridge collapses a multi-line console.log into a
# SINGLE logcat entry, encoding the line breaks as the two literal
# characters backslash-n ("\n"). Metro, which receives the same
# message over its websocket, prints real line breaks — hence a
# CONTACTS table that reads one-per-line in metro.log arrives as one
# giant `...\n...\n...` blob in release.log. We split each logcat
# entry on the literal "\n" sequence and re-emit each piece as its
# own real line, re-applying the [serial] prefix so multi-device
# disentangling still works and the table is readable again.
for serial in "${DEVICES[@]}"; do
    (
        # --line-buffered keeps the filter responsive (grep would
        # otherwise hold a full pipe buffer before flushing, making
        # the live tail laggy). The awk prefix step also uses
        # fflush() for the same reason.
        adb -s "$serial" logcat -v threadtime "${FILTER[@]}" \
            | grep --line-buffered -Ev "$SUPPRESS_REGEX" \
            | awk -v dev="$serial" '{
                  raw = $0; hms = "";
                  # logcat threadtime prefix: "MM-DD HH:MM:SS.mmm  PID  TID  L  TAG: msg".
                  # Keep only HH:MM:SS (chars 7-14) and drop the date, millis, pid/tid,
                  # level and tag (e.g. "I ReactNativeJS:") so the file is readable.
                  if (raw ~ /^[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]\./) {
                      hms = substr(raw, 7, 8);
                      sub(/^[0-9][0-9]-[0-9][0-9] [0-9:.]+ +[0-9]+ +[0-9]+ +[A-Z] +[^:]+: /, "", raw);
                  }
                  pfx = "[" dev "] " (hms == "" ? "" : hms " ");
                  m = split(raw, parts, /\\n/);
                  for (i = 1; i <= m; i++) print pfx parts[i];
                  fflush();
              }'
    ) >> "$LOG" &
    PIDS+=($!)
done

# Echo to the terminal as well as the file so the user can watch
# live. tail -f follows the same file the background writers are
# appending to.
tail -n 0 -f "$LOG" &
PIDS+=($!)

# Wait on the first child to exit (typically tail when the user
# Ctrl-C's). Once that happens the trap fires and tears down the
# rest of the tree via kill_descendants.
wait -n
