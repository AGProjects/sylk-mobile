#!/usr/bin/env python3
"""
qos-probe.py - Network packet-loss probe correlated with Sylk Mobile WebRTC stats.

Tails a Metro log for lines like:

    [qos] CONNECT local=192.168.1.5:54321 remote=174.142.205.47:50000
    [qos] DISCONNECT

When CONNECT is seen, extracts the remote media IP and runs an iperf3 UDP
probe loop against it on the configured iperf3 server port (default 5001),
emitting one summary line per probe iteration. Each line is tagged with
[qos-probe] so it can be merged into qos.log alongside the Sylk Mobile
[qos] STATS lines for line-by-line correlation.

Default invocation (use qos-log.sh which wires defaults correctly):

    python3 qos-probe.py --log ../metro.log --output logs/$(date +%F)-qos.log

Prerequisites on the server being probed:

    iperf3 -s -p 5001
"""
import argparse
import datetime
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CONNECT_RE = re.compile(
    r'\[qos\]\s+CONNECT\s+'
    r'(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\s+<->\s+'
    r'(\d{1,3}(?:\.\d{1,3}){3}):(\d+)'
)
# Fallback for the older verbose CONNECT format (local=… remote=…)
CONNECT_LEGACY_RE = re.compile(
    r'\[qos\]\s+CONNECT\b.*?'
    r'local=(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\s+'
    r'remote=(\d{1,3}(?:\.\d{1,3}){3}):(\d+)'
)
# Fallback for the oldest single-side CONNECT format
CONNECT_REMOTE_ONLY_RE = re.compile(
    r'\[qos\]\s+CONNECT\b.*?remote=(\d{1,3}(?:\.\d{1,3}){3}):(\d+)'
)
DISCONNECT_RE = re.compile(r'\[qos\]\s+DISCONNECT\b')
# Used as a heartbeat to detect calls that die without emitting DISCONNECT.
STATS_RE = re.compile(r'\[qos\]\s+STATS\b')
# SIP Call-ID carried at the end of CONNECT/STATS/DISCONNECT lines.
CALLID_RE = re.compile(r'callid=(\S+)')


def now_str():
    return datetime.datetime.now().strftime('%H:%M:%S')


class Output:
    """Thread-safe writer for timestamped [qos-probe] lines."""

    def __init__(self, path=None):
        self.lock = threading.Lock()
        self.fh = open(path, 'a', buffering=1) if path else None

    def write(self, msg):
        line = f"{now_str()} [qos-probe] {msg}\n"
        with self.lock:
            sys.stdout.write(line)
            sys.stdout.flush()
            if self.fh:
                self.fh.write(line)

    def write_raw(self, line):
        """Pass-through writer for lines that already carry their own
        timestamp and tag (e.g. qos-server's [qos-server] output)."""
        if not line.endswith('\n'):
            line = line + '\n'
        with self.lock:
            sys.stdout.write(line)
            sys.stdout.flush()
            if self.fh:
                self.fh.write(line)

    def close(self):
        if self.fh:
            self.fh.close()
            self.fh = None


class Watchdog:
    """If no [qos] STATS line is observed within `timeout_s`, assume the
    call died without an explicit [qos] DISCONNECT and tear down the
    active probes. Heartbeat is bumped every time a STATS line is read
    by the main loop, and on every CONNECT.
    """

    def __init__(self, out, timeout_s, on_idle):
        self.out = out
        self.timeout_s = timeout_s
        self.on_idle = on_idle
        self.last_beat = None  # None == not armed
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def arm(self):
        with self.lock:
            self.last_beat = time.monotonic()

    def beat(self):
        with self.lock:
            if self.last_beat is not None:
                self.last_beat = time.monotonic()

    def disarm(self):
        with self.lock:
            self.last_beat = None

    def stop(self):
        self.stop_event.set()

    def _loop(self):
        while not self.stop_event.is_set():
            time.sleep(1.0)
            with self.lock:
                lb = self.last_beat
            if lb is None:
                continue
            if time.monotonic() - lb > self.timeout_s:
                self.out.write(
                    f"watchdog: no [qos] STATS for {self.timeout_s}s — "
                    "assuming call ended, stopping probes"
                )
                with self.lock:
                    self.last_beat = None
                try:
                    self.on_idle()
                except Exception as e:
                    self.out.write(f"watchdog on_idle error: {e}")


class DaemonClient:
    """Read-only client for sylk-qos-server (on the WebRTC/Janus host).

    The daemon now AUTO-CAPTURES every call from Janus events, and the Sylk
    Mobile app already fetches + reconciles the per-call summary itself. So this
    no longer registers or stops anything — on call end it just FETCHES the
    server-side summary by Call-ID and logs it into qos.log, for correlation
    with the client [qos] STATS lines and the iperf3 probe. Optionally also
    downloads the full .tar.gz bundle (--fetch-bundle).

    Per-call endpoints need no token (the Call-ID is the capability)."""

    def __init__(self, out, base_url, fetch_dir=None):
        self.out = out
        self.base_url = base_url.rstrip('/')
        self.fetch_dir = fetch_dir

    def _get(self, path, timeout=8):
        req = urllib.request.Request(self.base_url + path, method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()

    def fetch(self, call_id):
        """Fetch + log the server-side summary for a just-finished call."""
        if not call_id:
            self.out.write("daemon: no call-id for this call — cannot fetch summary")
            return
        cid = urllib.parse.quote(call_id, safe="")
        summary = None
        # The server finalizes shortly after the BYE; retry a few times on 404.
        for _ in range(6):
            try:
                _status, raw = self._get(f'/call/{cid}/summary')
                summary = json.loads(raw or b'{}')
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    time.sleep(1)
                    continue
                self.out.write(f"daemon summary fetch HTTP {e.code} for {call_id}")
                return
            except Exception as e:
                self.out.write(f"daemon summary fetch failed for {call_id}: {e}")
                return
        if not summary:
            self.out.write(f"daemon: no summary for call_id={call_id} (not captured / aged out)")
            return
        legs = summary.get('legs') or {}
        w = legs.get('webrtc') or {}
        s = legs.get('sip') or {}
        self.out.write(f"daemon summary call_id={call_id} :: "
                       f"{summary.get('evaluation_text') or summary.get('evaluation')}")
        self.out.write(f"daemon   webrtc client->server={w.get('packets_client_to_server')} "
                       f"server->client={w.get('packets_server_to_client')}")
        if s:
            self.out.write(f"daemon   sip    janus->mp={s.get('packets_janus_to_mediaproxy')} "
                           f"mp->janus={s.get('packets_mediaproxy_to_janus')}")
        if self.fetch_dir:
            self._fetch_bundle(call_id)

    def _fetch_bundle(self, call_id):
        try:
            os.makedirs(self.fetch_dir, exist_ok=True)
            _status, raw = self._get(f'/call/{urllib.parse.quote(call_id, safe="")}/tar', timeout=30)
            safe = re.sub(r'[^A-Za-z0-9._@+-]', '_', call_id)[:160]
            dest = os.path.join(self.fetch_dir, safe + '.tar.gz')
            with open(dest, 'wb') as f:
                f.write(raw)
            self.out.write(f"daemon bundle saved -> {dest} ({len(raw)} bytes)")
        except Exception as e:
            self.out.write(f"daemon bundle fetch failed: {e}")


class Prober:
    """Runs iperf3 UDP probes in a loop against a target IP."""

    def __init__(self, out, port, bitrate, length, duration):
        self.out = out
        self.port = port
        self.bitrate = bitrate
        self.length = length
        self.duration = duration
        self.lock = threading.Lock()
        self.proc = None
        self.target_ip = None
        self.stop_event = threading.Event()
        self.runner_thread = None

    def start(self, ip):
        with self.lock:
            if (self.target_ip == ip and
                    self.runner_thread and self.runner_thread.is_alive()):
                return  # already probing this target
            self._stop_locked()
            self.target_ip = ip
            self.stop_event = threading.Event()
            self.runner_thread = threading.Thread(
                target=self._loop, args=(ip,), daemon=True
            )
            self.runner_thread.start()
        self.out.write(
            f"probe started target={ip}:{self.port} "
            f"bitrate={self.bitrate} duration={self.duration}s"
        )

    def stop(self):
        with self.lock:
            was_running = self.target_ip is not None
            self._stop_locked()
        if was_running:
            self.out.write("probe stopped")

    def _stop_locked(self):
        self.stop_event.set()
        proc = self.proc
        if proc is not None and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGTERM)
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        self.proc = None
        self.target_ip = None

    def _loop(self, ip):
        while not self.stop_event.is_set():
            cmd = [
                'iperf3',
                '-c', ip,
                '-p', str(self.port),
                '-u',
                '-b', self.bitrate,
                '-t', str(self.duration),
                '-l', str(self.length),
                '--get-server-output',  # fetch receiver-side loss/jitter
                '--forceflush',
            ]
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=1,
                    text=True,
                )
            except FileNotFoundError:
                self.out.write("ERROR: iperf3 not found in PATH")
                return

            with self.lock:
                self.proc = proc

            got_receiver = False
            for raw in proc.stdout:
                line = raw.rstrip()
                if not line:
                    continue
                # Receiver summary, e.g.:
                # [  5]   0.00-5.05  sec   38 KBytes  61.5 Kbits/sec  0.7 ms  60/300 (20%)  receiver
                m = re.search(
                    r'\[\s*\d+\]\s+([\d.]+-[\d.]+)\s+sec\s+\S+\s+\S+\s+'
                    r'(\S+\s+\S+)\s+([\d.]+)\s+ms\s+(\d+)/(\d+)\s+\(([\d.]+)%\)\s+receiver',
                    line,
                )
                if m:
                    # --get-server-output causes iperf3 to emit two
                    # "receiver" lines (one in the client's own summary
                    # block, one in the appended "Server output" block).
                    # Only emit the first one per iperf3 run.
                    if got_receiver:
                        continue
                    _interval, rate, jitter, lost, total, pct = m.groups()
                    self.out.write(
                        f"iperf3 -> {ip}:{self.port} "
                        f"loss={pct}% ({lost}/{total}) "
                        f"jitter={jitter}ms rate={rate} "
                        f"duration={self.duration}s"
                    )
                    got_receiver = True
                elif ('unable to connect' in line.lower()
                      or 'iperf3:' in line.lower()
                      or 'error' in line.lower()):
                    self.out.write(f"iperf3 -> {ip}:{self.port} {line}")

            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

            with self.lock:
                self.proc = None

            if not got_receiver and not self.stop_event.is_set():
                # If we didn't get a receiver summary, back off a bit so
                # we don't spam in a broken-state loop.
                self.stop_event.wait(timeout=2)
            else:
                # Small gap between probes
                self.stop_event.wait(timeout=0.2)

        # Clean exit
        with self.lock:
            self.target_ip = None


def tail(path):
    """Generator that yields appended lines, follows truncation/rotation."""
    inode = None
    fh = None
    while True:
        try:
            st = Path(path).stat()
            if fh is None or st.st_ino != inode:
                if fh:
                    fh.close()
                fh = open(path, 'r', errors='replace')
                inode = st.st_ino
                fh.seek(0, 2)  # tail from end
        except FileNotFoundError:
            if fh:
                fh.close()
                fh = None
                inode = None
            time.sleep(1)
            continue

        line = fh.readline()
        if not line:
            # Check for truncation
            try:
                pos = fh.tell()
                size = Path(path).stat().st_size
                if size < pos:
                    fh.seek(0)
                    continue
            except FileNotFoundError:
                fh.close()
                fh = None
                inode = None
                continue
            time.sleep(0.1)
            continue
        yield line.rstrip()


def main():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--log', default=None,
                   help='Log to tail for [qos] CONNECT/STATS/DISCONNECT lines. '
                        'Default: the same qos.log we write [qos-probe] lines to, '
                        'which is fed from either metro.log (dev) or adb logcat '
                        '(release) by qos-log.sh.')
    p.add_argument('--output', default=None,
                   help='Append [qos-probe] lines to this file as well as stdout')
    p.add_argument('--port', type=int, default=5001,
                   help='iperf3 server port (default: 5001)')
    p.add_argument('--bitrate', default='80K',
                   help='Probe bitrate matching Opus (default: 80K)')
    p.add_argument('--length', type=int, default=160,
                   help='UDP payload length in bytes (default: 160)')
    p.add_argument('--duration', type=int, default=5,
                   help='Seconds per iperf3 probe iteration (default: 5)')
    # sylk-qos-server (read-only). The daemon auto-captures every call from
    # Janus events; we only FETCH the per-call summary at call end for
    # correlation. Per-call endpoints need no token.
    p.add_argument('--daemon-url', default=os.environ.get('QOS_DAEMON_URL'),
                   help='Base URL of sylk-qos-server, e.g. '
                        'https://webrtc-gateway.example.com:9810 (default: $QOS_DAEMON_URL). '
                        'When set, the per-call summary is fetched into qos.log at call end.')
    p.add_argument('--fetch-bundle', default=os.environ.get('QOS_FETCH_DIR'),
                   help='Directory to download each call bundle (.tar.gz) into on '
                        'DISCONNECT (default: $QOS_FETCH_DIR; unset = leave on server)')
    p.add_argument('--idle-timeout', type=int, default=30,
                   help='If no [qos] STATS line for this many seconds while '
                        'probes are running, stop them (default: 30)')
    args = p.parse_args()

    # If --log wasn't given, default to the same qos.log we write to.
    log_path = args.log or args.output
    if not log_path:
        sys.stderr.write("qos-probe: --log or --output must be set\n")
        sys.exit(2)

    out = Output(args.output)
    out.write(f"qos-probe started, tailing {log_path}")
    out.write(
        f"iperf3 params: port={args.port} bitrate={args.bitrate} "
        f"length={args.length} duration={args.duration}s"
    )

    # Read-only daemon client (summary fetch on call end). The server-side
    # capture itself is driven by Janus events, not by us.
    daemon = None
    if args.daemon_url:
        daemon = DaemonClient(out, args.daemon_url, fetch_dir=args.fetch_bundle)
        out.write(f"daemon summary fetch enabled: {args.daemon_url} "
                  f"fetch_bundle={args.fetch_bundle or 'off'}")
    else:
        out.write("daemon summary fetch disabled (set --daemon-url/$QOS_DAEMON_URL to enable)")

    prober = Prober(out, args.port, args.bitrate, args.length, args.duration)
    # Tracks the call_id of the in-flight call so DISCONNECT can fetch the right
    # server-side summary (keyed by Call-ID).
    active = {'call_id': None}

    def on_call_end():
        """DISCONNECT or watchdog idle-timeout: stop the iperf3 loop and fetch
        the server-side summary for the call (the daemon already finalized its
        own capture from the Janus hangup event)."""
        prober.stop()
        if daemon and active['call_id']:
            daemon.fetch(active['call_id'])
        active['call_id'] = None

    def stop_all_probes():
        """Called on full shutdown of qos-probe.py — kill the iperf3 loop."""
        prober.stop()

    watchdog = Watchdog(out, args.idle_timeout, on_idle=on_call_end)

    def shutdown(*_):
        watchdog.stop()
        stop_all_probes()
        out.close()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    for line in tail(log_path):
        # We tail the same qos.log we write to. Skip lines that
        # originated from qos-probe or qos-server so our own status
        # line doesn't loop back into the CONNECT matcher and trigger
        # an endless re-detection.
        if '[qos-probe]' in line or '[qos-server]' in line:
            continue
        # Try the new compact "ip:port <-> ip:port" format first, then
        # fall back to the older "local=…  remote=…" formats.
        mc = CONNECT_RE.search(line) or CONNECT_LEGACY_RE.search(line)
        if mc:
            client_ip, client_port = mc.group(1), int(mc.group(2))
            server_ip, server_port = mc.group(3), int(mc.group(4))
            cid_m = CALLID_RE.search(line)
            call_id = cid_m.group(1) if cid_m and cid_m.group(1) != '?' else None
            active['call_id'] = call_id
            out.write(
                f"detected CONNECT {client_ip}:{client_port} <-> "
                f"{server_ip}:{server_port} callid={call_id or '?'}"
            )
            prober.start(server_ip)
            watchdog.arm()
            continue
        # Fallback for the oldest CONNECT format (remote only)
        mr = CONNECT_REMOTE_ONLY_RE.search(line)
        if mr:
            server_ip, server_port = mr.group(1), int(mr.group(2))
            out.write(
                f"detected CONNECT <unknown> <-> {server_ip}:{server_port} "
                f"(no local — server probe skipped)"
            )
            prober.start(server_ip)
            watchdog.arm()
            continue
        if STATS_RE.search(line):
            watchdog.beat()
            continue
        if DISCONNECT_RE.search(line):
            out.write("detected DISCONNECT (fetching server-side summary)")
            on_call_end()
            watchdog.disarm()


if __name__ == '__main__':
    main()
