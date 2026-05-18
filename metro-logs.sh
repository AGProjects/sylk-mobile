#!/usr/bin/env bash
# Run `adb logcat | grep -i SYLK` (one stream per attached Android
# device), `idevicesyslog | grep SylkZRTP|SylkE2EE` (one stream per
# attached iOS device), and `npx react-native start` in parallel,
# tagging each line with its source and writing everything to one log
# file.
#
# Usage: ./logs.sh [--wifi] [logfile]
#   --wifi       Enable the wireless Android watcher (mDNS-based
#                discovery + auto `adb connect` for paired phones
#                with Wireless debugging on). USB devices are
#                always picked up; this flag turns the wireless
#                path on top of that. Off by default because in
#                most workflows it duplicates an already-USB-
#                connected phone or attaches devices the operator
#                didn't intend to log (e.g. someone else's phone
#                on the same LAN).
#   logfile      Path to the log file. Defaults to metro.log in the
#                script's directory.
#
# Behavior:
#   * One adb pipeline per attached Android device and one
#     idevicesyslog pipeline per attached iOS device. Background
#     watchers poll `adb devices` and `idevice_id -l` every few seconds
#     and spin up a new pipeline when a device is plugged in
#     mid-session, so you don't have to restart the script when adding
#     a phone over USB.
#   * Each per-device pipeline auto-restarts if it exits (e.g. cable
#     unplug) — when the device returns the stream resumes on its own.
#   * Metro runs in the foreground as the last task so its stdin stays
#     attached to the TTY and the interactive keys (`r` to reload, `d`
#     for the dev menu, etc.) keep working. Backgrounded jobs cannot
#     read from the controlling terminal.
#   * Ctrl-C reliably stops every adb / idevicesyslog stream, both
#     watchers, Metro, and every child process they spawn.
#   * Only one instance runs at a time. Launching a new one terminates
#     the previous instance (using a PID file in the script's
#     directory).
#
# iOS support requires libimobiledevice — install with
#     brew install libimobiledevice
# Without it, the iOS watcher logs a one-shot META notice and exits;
# Android + Metro continue normally.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse arguments. Order-independent; non-flag positional becomes the
# optional logfile. Wireless Android discovery is OFF by default —
# pass --wifi to opt in.
WIFI_ANDROID=0
LOG_FILE=""
for arg in "$@"; do
    case "$arg" in
        --wifi|--wireless)
            WIFI_ANDROID=1
            ;;
        -h|--help)
            # Range covers the Usage + Behavior + iOS-support blocks
            # in the header comment. Bump the upper bound when
            # adding lines to the header so the help message keeps
            # printing the whole block instead of getting cut off
            # mid-Behavior.
            sed -n '2,46p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            echo "Unknown flag: $arg" >&2
            echo "Usage: $0 [--wifi] [logfile]" >&2
            exit 2
            ;;
        *)
            LOG_FILE="$arg"
            ;;
    esac
done
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/metro.log}"
PID_FILE="$SCRIPT_DIR/.logs.pid"

# Recursively send a signal to every descendant of $1 (NOT $1 itself).
# Uses pgrep, which is available on macOS and Linux.
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
if [[ -f "$PID_FILE" ]]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
        echo "Stopping previous instance (PID $old_pid)..."
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

: > "$LOG_FILE"
echo "Logging to: $LOG_FILE  (Ctrl-C to stop)"

# Tag-column width (excluding the surrounding brackets). Chosen so the
# longest realistic source tag — `ADB:<serial>` with a typical 11-char
# Android serial = 15 chars — fits without truncation, while shorter
# tags like `METRO` / `META` / `IOS:8charudid` get right-padded with
# spaces to the same width so columns line up.
LOG_TAG_WIDTH=15
# Device-name column width (chars between brackets). Metro's device
# names vary wildly ("iPhone 14" vs "motorola razr 60 ultra Android 16");
# fix this so each Metro line's [device] bracket is the same width.
LOG_DEV_WIDTH=20

# Prefix each line with timestamp + tag, mirror to terminal AND log
# file. Both the tag and the device bracket are normalized to fixed
# widths so columns align when you grep / tail / diff the log.
#
# Lines that don't start with `[device-name]` (Metro's own bundler
# chatter, adb/iOS lines that already had their tag stripped) get
# the same tag formatting but no device column.
prefix_and_tee() {
    local tag
    printf -v tag "%-${LOG_TAG_WIDTH}.${LOG_TAG_WIDTH}s" "$1"
    local ts dev rest
    while IFS= read -r line; do
        ts=$(date '+%H:%M:%S')
        if [[ "$line" =~ ^\[([^]]+)\](.*)$ ]]; then
            dev="${BASH_REMATCH[1]}"
            rest="${BASH_REMATCH[2]}"
            # Strip noisy vendor prefixes that eat up column space
            # without identifying the device meaningfully.
            dev="${dev#motorola }"
            printf -v dev "%-${LOG_DEV_WIDTH}.${LOG_DEV_WIDTH}s" "$dev"
            printf '[%s] [%s] [%s]%s\n' "$ts" "$tag" "$dev" "$rest"
        else
            printf '[%s] [%s] %s\n' "$ts" "$tag" "$line"
        fi
    done | tee -a "$LOG_FILE"
}

# Print a META line both to the terminal and the log file. Used to
# announce when devices come and go and when pipelines respawn.
log_meta() {
    local tag
    printf -v tag "%-${LOG_TAG_WIDTH}.${LOG_TAG_WIDTH}s" "META"
    printf '[%s] [%s] %s\n' "$(date '+%H:%M:%S')" "$tag" "$1" | tee -a "$LOG_FILE"
}

# `adb devices` output looks like:
#     List of devices attached
#     QV770JRAMM\tdevice
#     ZY22LCXTPW\tdevice
#     192.168.1.42:39145\tdevice          <- wireless-debugging entry
# Grab everything before the tab on lines that end with the literal
# string "device" (skips header, offline, unauthorized, emulator-*,
# etc.). Returns one serial per line; nothing if no devices.
# Wireless devices show up with `host:port` as the serial, so the
# downstream `adb -s "$serial" logcat` pipeline works unchanged.
discover_devices() {
    adb devices 2>/dev/null \
        | awk '$2=="device" {print $1}'
}

# `adb mdns services` (requires adb 30.0.0+, ships with platform-tools
# 30+) prints any nearby device that has Settings → Developer options →
# Wireless debugging turned on. Output looks like:
#     List of discovered mdns services
#     adb-XXXXXXXX-YYYYYY    _adb-tls-connect._tcp.    192.168.1.42:39145
#     adb-XXXXXXXX-YYYYYY    _adb-tls-pairing._tcp.    192.168.1.42:38291
# We want only `_adb-tls-connect` entries — those are devices we've
# already paired with and can re-attach to silently. Pairing entries
# require a 6-digit code shown on the phone and are surfaced as a META
# hint instead (one-time manual step).
#
# `sort -u` because Bonjour often advertises the same service on
# multiple interfaces (en0 + utun, IPv4 + IPv6 link-local, etc.) and
# `adb mdns services` faithfully echoes each one, which would otherwise
# cause every connect attempt to be tried — and every error logged —
# twice per cycle.
#
# We also drop `0.0.0.0:PORT` and `[::]:PORT` entries: `adb mdns
# services` occasionally surfaces the advertisement before the link
# address has resolved (or on the loopback interface) and prints the
# wildcard address. It is never a usable pair/connect target — both
# `adb connect 0.0.0.0:PORT` and `adb pair 0.0.0.0:PORT` will fail —
# so suppress them at the source rather than letting the watcher trip
# over them.
# Yields lines of `<serial> <host:port>` per discovered Wi-Fi-debug
# advertisement. The serial is parsed out of the mDNS service name
# `adb-<SERIAL>-<id>` and is the device's USB serial — we need it so
# the watcher can skip wirelessly attaching a phone that's already on
# the USB cable. (Without that check, Gradle's `installRelease` ends
# up installing the same APK twice on the same physical device — once
# fast over USB, once *minutes* slow over Wi-Fi — and the slow leg
# blocks the build from finishing.) Falls back to `?` when the
# service name doesn't have a parseable serial, so the watcher can
# still try the connect rather than silently dropping it.
#
# `awk match(...)` here is gawk-only; we use a portable substr/index
# pattern instead so this works with macOS's BWK awk too.
#
# 0.0.0.0 / [::] entries are dropped as before — Bonjour can briefly
# advertise the wildcard on certain interfaces and adb can never
# connect to it.
discover_wifi_android_connect_with_serial() {
    if ! command -v adb >/dev/null 2>&1; then
        return 0
    fi
    adb mdns services 2>/dev/null \
        | awk '/_adb-tls-connect\._tcp/ {
              name=$1; hostport=$3
              # Expect `adb-<SERIAL>-<id>`; extract <SERIAL>.
              serial="?"
              if (substr(name,1,4)=="adb-") {
                  rest=substr(name,5)
                  i=index(rest,"-")
                  if (i>1) serial=substr(rest,1,i-1)
              }
              print serial, hostport
          }' \
        | grep -vE ' (0\.0\.0\.0|\[::\]):' \
        | sort -u
}

discover_wifi_android_pairing() {
    if ! command -v adb >/dev/null 2>&1; then
        return 0
    fi
    adb mdns services 2>/dev/null \
        | awk '/_adb-tls-pairing\._tcp/ {print $3}' \
        | grep -vE '^(0\.0\.0\.0|\[::\]):' \
        | sort -u
}

# Background watcher: polls mDNS and `adb connect`s any endpoint that
# isn't already in `adb devices`. Once connected, the device shows up
# in `adb devices` with `host:port` as its serial, and the existing
# device_watcher picks it up and starts an adb_loop for it — same code
# path as a USB device. So all this watcher has to do is establish the
# transport.
#
# Pairing endpoints (one-time, requires a code from the phone) get a
# one-shot META notice with the exact `adb pair` command to run. We
# remember which pairing endpoints we've already announced so the
# message doesn't repeat every poll.
# Quick TCP reachability probe. Returns 0 if we can open a socket to
# host:port within 1 second, non-zero otherwise. Used as a pre-flight
# before `adb connect` so we never hand an unreachable endpoint to the
# adb server — `adb connect` to a dead host blocks for ~10s in its
# TLS retry loop AND holds the adb-server's connection serializer,
# which makes any concurrent `adb install` (or anything else from
# another shell) appear to hang. mDNS also keeps advertising stale
# wireless-debugging endpoints for a while after the panel is closed,
# so without this guard every poll cycle would pile up an adb stall.
#
# `nc -z -w 1` works on both BSD nc (macOS) and GNU netcat. -z is
# zero-I/O probe, -w bounds the connect to 1 second.
tcp_probe() {
    local hostport="$1"
    local host="${hostport%:*}"
    local port="${hostport##*:}"
    nc -z -w 1 "$host" "$port" >/dev/null 2>&1
}

wifi_android_watcher() {
    if ! command -v adb >/dev/null 2>&1; then
        log_meta "adb not in PATH — wireless Android watcher disabled"
        return 0
    fi
    # Sanity check that this adb supports mdns. Older builds print
    # "Unknown command" on stderr; we don't want to hammer that every
    # poll cycle, so bail early with a single META if unsupported.
    if ! adb mdns check >/dev/null 2>&1; then
        log_meta "adb mdns unavailable — upgrade platform-tools to 30.0.0+ for wireless Android discovery"
        return 0
    fi
    if ! command -v nc >/dev/null 2>&1; then
        log_meta "nc not in PATH — wireless Android watcher disabled (needed to pre-flight reachability so adb connect doesn't stall installs)"
        return 0
    fi

    # Startup announcement — show what mDNS sees right now so the user
    # isn't left wondering whether the watcher is alive. List every
    # _adb-tls-connect endpoint (already-attached and not-yet-attached)
    # plus any pairing offers. If nothing comes back, say so explicitly.
    log_meta "wireless adb watcher: scanning mDNS for _adb-tls-connect._tcp and _adb-tls-pairing._tcp..."
    local _connect_count=0
    while IFS=' ' read -r _serial _endpoint; do
        [[ -z "${_endpoint:-}" ]] && continue
        log_meta "wireless adb watcher: discovered connect endpoint $_endpoint (serial: $_serial)"
        _connect_count=$((_connect_count + 1))
    done < <(discover_wifi_android_connect_with_serial)
    local _pair_count=0
    for _pairing in $(discover_wifi_android_pairing); do
        log_meta "wireless adb watcher: discovered pairing endpoint $_pairing — run: adb pair $_pairing  (use the 6-digit code on the phone)"
        _pair_count=$((_pair_count + 1))
    done
    if [[ $_connect_count -eq 0 && $_pair_count -eq 0 ]]; then
        log_meta "wireless adb watcher: no Android devices advertising on this LAN. Check: (1) phone has Wireless debugging ON in Developer options, (2) phone and Mac are on the SAME WiFi / VLAN, (3) router doesn't block mDNS / multicast (UDP 5353)"
    else
        log_meta "wireless adb watcher: found $_connect_count connect + $_pair_count pairing endpoint(s); will poll mDNS every 10s"
    fi

    # Track which (endpoint, error) pairs we've already announced, so a
    # genuinely unreachable phone doesn't spam the log every 5 seconds.
    # Format: " endpoint=ERR_CODE " (space-padded for substring lookups,
    # bash 3.2-compatible — no associative arrays).
    #
    # ERR_CODE classification:
    #   ok      = `adb connect` returned "connected" or "already connected"
    #   pair    = needs pairing (auth failure, missing keys)
    #   refused = port not listening (Wireless debugging toggled off,
    #             stale mDNS cache, screen closed and port rotated)
    #   other   = some other failure we couldn't classify
    local seen_status=" "
    local announced_pairing=" "
    while true; do
        local connected
        connected=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
        while IFS=' ' read -r serial endpoint; do
            [[ -z "${endpoint:-}" ]] && continue
            # Skip wirelessly attaching a phone that's already on
            # the USB cable. The serial parsed out of the mDNS
            # service name is the device's USB serial, so a match
            # against `adb devices` is enough to detect the dupe.
            # Without this check, Gradle's installRelease double-
            # installs the same APK on the same physical device —
            # once fast over USB, once minutes-slow over Wi-Fi —
            # and the slow leg blocks the build from finishing.
            if [[ "$serial" != "?" ]] && grep -qx "$serial" <<<"$connected"; then
                local usb_key="$endpoint=usb"
                if [[ "$seen_status" != *" $usb_key "* ]]; then
                    seen_status=$(printf '%s' "$seen_status" \
                        | sed -E "s/ ${endpoint//./\\.}=[a-z]+ / /g")
                    seen_status="$seen_status$usb_key "
                    log_meta "wireless adb $endpoint skipped — $serial is already attached over USB"
                fi
                continue
            fi
            # Already attached? Either via this watcher on a previous
            # tick, or via `adb connect` from another shell. Skip.
            if grep -qx "$endpoint" <<<"$connected"; then
                if [[ "$seen_status" != *" $endpoint=ok "* ]]; then
                    seen_status="$seen_status$endpoint=ok "
                    log_meta "wireless adb connected: $endpoint (device_watcher will start the log pipeline)"
                fi
                continue
            fi
            # Pre-flight TCP probe. If this fails, do NOT call
            # `adb connect` — it would hold the adb server's connection
            # lock for ~10s of TLS retries and stall any concurrent
            # `adb install` running from another shell. Synthesize a
            # `refused` result so the rest of the state machine
            # (announce-once-then-quiet) still works.
            local out err_code
            if ! tcp_probe "$endpoint"; then
                err_code="refused"
                out="tcp probe to $endpoint failed within 1s (skipped adb connect to avoid blocking the adb server)"
            else
                # `adb connect` is chatty about *why* it failed; capture
                # both stdout and stderr so we can classify and so the
                # user can see the real reason once.
                out=$(adb connect "$endpoint" 2>&1)
                if grep -qE 'connected|already' <<<"$out"; then
                    err_code="ok"
                elif grep -qiE 'authent|missing.*key|not paired' <<<"$out"; then
                    err_code="pair"
                elif grep -qiE 'refused|no route|timed out|unreachable' <<<"$out"; then
                    err_code="refused"
                else
                    err_code="other"
                fi
            fi
            local key="$endpoint=$err_code"
            if [[ "$seen_status" != *" $key "* ]]; then
                seen_status="$seen_status$key "
                # When status changes for an endpoint, drop its previous
                # status tag so the new one isn't shadowed. (e.g. went
                # from `pair` to `refused`, or from `ok` back to a
                # failure after a drop.)
                seen_status=$(printf '%s' "$seen_status" \
                    | sed -E "s/ ${endpoint//./\\.}=[a-z]+ / /g")
                seen_status="$seen_status$key "
                case "$err_code" in
                    ok)
                        log_meta "wireless adb connected: $endpoint (device_watcher will start the log pipeline)"
                        ;;
                    pair)
                        log_meta "wireless adb $endpoint not paired with this Mac. On the phone: Settings → Developer options → Wireless debugging → 'Pair device with pairing code', then run: adb pair <ip:port> (use the port + code shown on the phone, NOT $endpoint — the pairing port is different from the connect port)"
                        ;;
                    refused)
                        log_meta "wireless adb $endpoint not reachable: $(printf '%s' "$out" | tr '\n' ' ') — Wireless debugging may have been toggled off, or the phone reopened the panel and rotated to a new port"
                        ;;
                    *)
                        log_meta "wireless adb connect $endpoint failed: $(printf '%s' "$out" | tr '\n' ' ')"
                        ;;
                esac
            fi
        done < <(discover_wifi_android_connect_with_serial)
        for pairing in $(discover_wifi_android_pairing); do
            if [[ "$announced_pairing" != *" $pairing "* ]]; then
                announced_pairing="$announced_pairing$pairing "
                log_meta "wireless Android pairing offered at $pairing — run: adb pair $pairing  (enter the 6-digit code shown on the phone)"
            fi
        done
        # 10s instead of 5s. Wireless discovery doesn't need to be
        # snappy — devices stay advertised — and a longer interval
        # halves the background adb chatter so it stays out of the
        # way of foreground `adb install` / `adb shell` work.
        sleep 10
    done
}

# Per-device adb pipeline. Auto-respawns on exit so we recover from
# unplug/replug without operator intervention. The trap kills this
# subshell with SIGTERM, which interrupts `sleep` and exits the loop
# cleanly.
adb_loop() {
    local serial="$1"
    while true; do
        # Native code now uses a single logcat tag `SYLK_APP` for every
        # Log.x call; the per-class short marker (e.g. [FCM], [Audio])
        # lives inside the message body, so we filter on the tag column
        # only.
        #
        # PREVIOUS approach: `adb logcat 2>&1 | grep -E '\bSYLK_APP\b'`
        # — that ran the firehose of every tag over the USB transport
        # and only filtered locally, AND it was sloppy: any unrelated
        # message body containing the substring `SYLK_APP` (e.g. a
        # framework crash spew that names our package) would slip
        # through, contributing to the "tons of unfiltered native
        # logs" floor the operator complained about.
        #
        # NEW approach: use logcat's own tag filter spec
        #     -s SYLK_APP:V '*:S'
        # which silences EVERY tag (`*:S`) and re-enables SYLK_APP at
        # Verbose. The filter runs server-side on the device, so
        # unrelated tags are dropped before they cross the USB cable.
        # Strict by construction — only the SYLK_APP tag column
        # passes; substring matches inside other tags' message bodies
        # never appear.
        #
        # `-T 1` starts the tail from the current time. Without it,
        # `adb logcat` replays the entire main-buffer history on
        # connect AND on every respawn (every cable replug, every
        # wireless-debugging blip). That replay is exactly the
        # "flood of native logs at startup" the operator saw — old
        # SYLK_APP lines from previous runs would also reappear here.
        #
        # The sed step below strips the logcat threadtime header
        #     05-03 10:42:40.673  1234  1234 D SYLK_APP:
        # so each line ends up as just `<our timestamp> <our tag>
        # [<short>] <message>`. The platform timestamp and tag column
        # are duplicated by `prefix_and_tee` already.
        # The awk step dedupes back-to-back identical lines. Several
        # Android system callbacks fire multiple times for one logical
        # event (e.g. AudioManager's OnCommunicationDeviceChangedListener
        # emits the same line N times per device-change). Collapsing
        # consecutive duplicates here keeps the unified log readable.
        adb -s "$serial" logcat -v threadtime -T 1 -s SYLK_APP:V '*:S' 2>&1 \
            | grep --line-buffered -vE '^--------- beginning of' \
            | sed -l -E 's/^.*SYLK_APP: //' \
            | awk '$0 != prev { print; prev = $0; fflush(); }' \
            | prefix_and_tee "ADB:${serial}"
        log_meta "adb($serial) pipeline exited; respawning in 2s..."
        sleep 2
    done
}

# Background watcher: polls `adb devices` every few seconds and spawns
# an adb_loop for any newly-attached serial. Already-known serials are
# left alone — their loops self-heal on disconnect/reconnect, so we
# never need to restart them.
device_watcher() {
    # Space-padded list of serials we've already started a loop for.
    # Lives inside this subshell, which is fine — the watcher is the
    # only thing that needs to consult it.
    local seen=" "
    while true; do
        local current
        current=$(discover_devices)
        for s in $current; do
            if [[ "$seen" != *" $s "* ]]; then
                seen="$seen$s "
                log_meta "device $s attached — starting adb pipeline"
                adb_loop "$s" &
            fi
        done
        sleep 3
    done
}

# `idevice_id -l` (libimobiledevice) prints one UDID per line — 40 hex
# chars on older devices, 25 chars with a hyphen on newer Apple Silicon
# iPhones. Returns nothing if libimobiledevice isn't installed or no
# iOS device is plugged in.
discover_ios_devices() {
    if ! command -v idevice_id >/dev/null 2>&1; then
        return 0
    fi
    idevice_id -l 2>/dev/null | grep -v '^$'
}

# Per-iOS-device idevicesyslog pipeline. idevicesyslog reads
# /var/log/syslog off USB-attached iOS devices; per-line output looks
# like:
#     May  2 11:13:48.554160 sylk(sylk.debug.dylib)[1291] <Notice>: [SylkZRTP] ...
# We filter for "SylkZRTP" and "SylkE2EE" — same vocabulary the
# Android side surfaces — so a single grep ladder works for both
# platforms when reading metro.log. Tag uses the first 8 chars of the
# UDID to keep log lines readable.
ios_loop() {
    local udid="$1"
    while true; do
        # iOS NSLog has no separate "tag" column the way logcat does;
        # the bracketed prefix lives inside the message body. Native
        # code now uniformly leads every log line with `[SYLK_APP]`,
        # followed by a per-class short marker (e.g. [App], [Audio],
        # [FCM]). Match the prefix literally — `[` and `]` are escaped
        # in the ERE.
        #
        # idevicesyslog produces full /var/log/syslog lines with their
        # own date, host process, PID, and severity, e.g.:
        #     May  3 10:42:40.673710 sylk(sylk.debug.dylib)[1815] <Notice>: [SYLK_APP] [App] willPresentNotification...
        # All of that header is redundant — `prefix_and_tee` already
        # stamps `[HH:MM:SS] [IOS:<udid>]` on the front. The sed step
        # below strips everything up to (and not including) `[SYLK_APP]`
        # so each line ends up as just `<our timestamp> <our tag>
        # [SYLK_APP] [<short>] <message>`.
        #
        # `sed -l` is BSD-sed (macOS) line-buffered mode — without it
        # the strip step would block in 4KB chunks and lines would only
        # appear when a chunk fills, defeating the live tail.
        #
        # We also drop the `[SYLK_APP] ` token itself (the source tag
        # `[IOS:<udid>]` from prefix_and_tee already tells you the
        # platform, and we filtered for it upstream). The `[<short>] `
        # marker (e.g. [App], [Audio], [FCM]) stays — it's the useful
        # bit. So a raw line like:
        #     May  3 10:42:40.673710 sylk(sylk.debug.dylib)[1815] <Notice>: [SYLK_APP] [App] willPresentNotification ...
        # ends up as:
        #     [10:42:40] [IOS:00008120] [App] willPresentNotification ...
        idevicesyslog -u "$udid" 2>&1 \
            | grep --line-buffered -E '\[SYLK_APP\]' \
            | sed -l -E 's/^.*\[SYLK_APP\] //' \
            | prefix_and_tee "IOS:${udid:0:8}"
        log_meta "ios($udid) pipeline exited; respawning in 2s..."
        sleep 2
    done
}

# iOS counterpart to device_watcher. Skips itself entirely if
# libimobiledevice isn't installed (with a one-shot META notice so the
# operator knows why iOS streams aren't appearing).
ios_watcher() {
    if ! command -v idevice_id >/dev/null 2>&1; then
        log_meta "idevice_id not in PATH — iOS watcher disabled (brew install libimobiledevice)"
        return 0
    fi
    local seen=" "
    while true; do
        local current
        current=$(discover_ios_devices)
        for u in $current; do
            if [[ "$seen" != *" $u "* ]]; then
                seen="$seen$u "
                log_meta "iOS device $u attached — starting idevicesyslog pipeline"
                ios_loop "$u" &
            fi
        done
        sleep 3
    done
}

cleanup_done=0
cleanup() {
    [[ $cleanup_done -eq 1 ]] && return
    cleanup_done=1
    # Disarm further traps so we don't recurse during the kill cascade.
    trap '' INT TERM EXIT
    echo
    echo "Stopping adb / Metro..."
    kill_descendants $$ TERM
    # Brief grace period so children can flush & exit cleanly.
    for _ in 1 2 3 4 5; do
        [[ -z "$(pgrep -P $$ 2>/dev/null)" ]] && break
        sleep 0.2
    done
    kill_descendants $$ KILL
    wait 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "Done. Log saved to: $LOG_FILE"
}
trap cleanup INT TERM EXIT

# Device watchers (backgrounded). Each discovers currently-attached
# devices on its first pass and keeps polling so phones plugged in
# mid-session are picked up automatically. Each device gets its own
# per-device pipeline (adb_loop / ios_loop).
#
# wifi_android_watcher is a thin layer on top: it scans mDNS for
# Android devices with Wireless debugging enabled and runs `adb
# connect` on them. Once connected they appear in `adb devices` and
# device_watcher starts the actual logcat pipeline — so wireless
# devices reuse the exact same code path as USB devices.
device_watcher &
if [[ "$WIFI_ANDROID" == "1" ]]; then
    wifi_android_watcher &
else
    log_meta "wireless Android watcher disabled (default; pass --wifi to enable)"
fi
ios_watcher &

# Pairing hint — printed once at startup, ahead of Metro's banner, so
# it stays visible above the log scroll and the operator doesn't have
# to dig for it. Goes straight to stderr (not into prefix_and_tee or
# the log file) so it doesn't clutter metro.log: this is a UI cue for
# the human running the script, not part of the captured run record.
cat >&2 <<'EOF'

To pair an Android phone wirelessly:

  1. Settings → System → Developer options → Wireless debugging → Pair device with pairing code
  2. Leave that screen open. The phone displays an IP, a port, and a 6-digit code.
  3. In another terminal: adb pair <ip>:<port>   (then enter the 6-digit code)

EOF

# Metro bundler — MUST run in the foreground (no trailing `&`) and as
# the script's last task. Backgrounded jobs can't read from the
# controlling terminal, which is why interactive keys (`r` to reload,
# `d` for the dev menu, etc.) silently stopped working when this was
# also `&`-ed. Keeping Metro's stdin attached to the TTY restores them.
# The cleanup trap fires on exit/Ctrl-C and tears down the watcher and
# every adb pipeline it spawned.
#
# Filter pipeline applied to Metro's stdout, top → bottom:
#
#   • drop noisy per-call lines we never want to see in the tail.
#     `rn-webrtc:pc:DEBUG … getStats` fires once per second per
#     peer connection (one local + N subscriber PCs), produces
#     ~5 lines/sec into the console with no actionable info. The
#     library has its own internal `Logger.enable('rn-webrtc:*')`
#     call that fights debug-package disables at runtime AND
#     survives in Metro's module cache between `--reset-cache`
#     runs, so suppressing here is the most reliable path. Add
#     other namespace patterns to the alternation if other rn-
#     webrtc spam shows up (e.g. INFO / WARN equivalents).
#
#   • `sed` strips Metro's leading ` LOG  ` token from app
#     console.log lines — it's redundant since LOG is the default
#     and every other line shows it. WARN and ERROR are kept
#     intact because their severity is genuinely useful at a
#     glance.
#
#   • `prefix_and_tee` stamps the line with `[HH:MM:SS] [METRO]`
#     and writes to the unified log file.
( cd "$SCRIPT_DIR" && npx react-native start 2>&1 \
    | grep --line-buffered -vE 'rn-webrtc:[a-z]+:DEBUG' \
    | sed -l -E 's/^ LOG +//' \
    | prefix_and_tee "METRO" )
