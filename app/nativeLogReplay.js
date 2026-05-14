// nativeLogReplay.js
//
// Two halves of the same problem:
//
//   1. STARTUP DRAIN — pull lines that SylkLogger persisted to disk
//      while the JS process wasn't around (PushKit / VoIP / FCM
//      lines emitted before this React tree mounted).
//
//   2. LIVE STREAM — once JS is alive, every native log line goes
//      straight through the bridge instead of being persisted, and
//      lands in the on-disk APPLOG via utils.timestampedLog like
//      every other in-app log entry.
//
// No-duplicate guarantee
// ----------------------
// We always do SUBSCRIBE-FIRST, THEN DRAIN. Native side: while a
// live observer is registered, log() routes lines to the observer
// and SKIPS the disk write. So:
//
//   • Lines emitted before JS subscribes  → on disk → drain returns them
//   • Lines emitted after JS subscribes   → live stream only, NEVER on disk
//   • Lines emitted DURING the drain      → live stream (subscribe was first)
//
// A line therefore can never end up both in the drain payload and
// in the live stream of the same session, and can never end up in
// the live stream of one session and the drain of the next.
//
// All replay + stream lines flow through utils.timestampedLog so
// they end up in the same per-account APPLOG file LogsModal reads,
// tagged [native].

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import utils from './utils';

const NativeLogger =
    (NativeModules && NativeModules.NativeLogger) || null;

const TAG = '[native]';
const EVENT_NAME = 'NativeLogLine';

let _replayInFlight = false;
let _liveSubscription = null;     // EmitterSubscription | null

function _emitLine(line) {
    if (!line) return;
    // Defence in depth: log2file already flattens embedded newlines,
    // but a native line that for some reason contains '\n' would be
    // split BEFORE log2file gets it (e.g. by a caller that does its
    // own .split on the raw text). Strip CR/LF here so the value
    // handed to timestampedLog is always one line.
    const flat = String(line).replace(/\r\n|\r|\n/g, ' \\n ');
    try {
        utils.timestampedLog(TAG, flat);
    } catch (err) {
        // Fall back to console.log so we don't recurse via
        // utils.timestampedLog if log2file itself broke.
        // eslint-disable-next-line no-console
        console.log('[APPLOG] [native] (fallback)', flat,
                    'err=', err && err.message ? err.message : String(err));
    }
}

/**
 * Subscribe to the live native log stream. Call this BEFORE the
 * drain. Idempotent — subsequent calls are a no-op while a
 * subscription is already alive.
 *
 * Returns the unsubscribe function (rarely needed; the subscription
 * naturally lives for the rest of the JS process).
 */
export function subscribeNativeLogStream() {
    if (!NativeLogger) {
        return () => {};
    }
    if (_liveSubscription) {
        return () => _liveSubscription && _liveSubscription.remove();
    }

    // NativeEventEmitter on iOS REQUIRES the module to be an
    // RCTEventEmitter (NativeLoggerModule on iOS is). On Android the
    // ctor argument is optional but harmless to pass — and required
    // by RN >= 0.65 to silence the "new NativeEventEmitter() was
    // called with a non-null argument" warning consistently across
    // platforms.
    const emitter = new NativeEventEmitter(NativeLogger);
    _liveSubscription = emitter.addListener(EVENT_NAME, (payload) => {
        // Native sends {line: "..."} — see NativeLoggerModule on
        // both platforms. Defensive shape check for forward
        // compatibility.
        const line = (payload && typeof payload === 'object')
            ? payload.line
            : payload;
        _emitLine(line);
    });

    return () => {
        if (_liveSubscription) {
            _liveSubscription.remove();
            _liveSubscription = null;
        }
    };
}

/**
 * One-shot startup drain. Subscribe-first, drain, replay, ack —
 * in that order, so any line that fires during the drain goes
 * via the live stream rather than ending up on disk and being
 * replayed in the next session.
 *
 * Safe to call multiple times — drainStart returns "" once the
 * file has been moved to the .read sidecar, and the subscription
 * helper is idempotent.
 */
export async function replayPersistedNativeLogs() {
    if (!NativeLogger) {
        return { replayed: 0, skipped: 'no-native-module' };
    }

    if (_replayInFlight) {
        return { replayed: 0, skipped: 'in-flight' };
    }
    _replayInFlight = true;

    let replayed = 0;
    try {
        // 1. SUBSCRIBE FIRST. From this moment on, native log calls
        //    flow through the live channel and skip disk persistence.
        subscribeNativeLogStream();

        // 2. DRAIN. Returns whatever was on disk before the
        //    subscribe took effect.
        const text = await NativeLogger.getPersistedLogs();

        // 3. REPLAY. Push each line through the same APPLOG pipeline
        //    as live entries.
        if (text && typeof text === 'string') {
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                _emitLine(line);
                replayed += 1;
            }
        }

        // 4. ACK. Delete the .read sidecar so the same lines aren't
        //    re-delivered next launch. Only after every line has
        //    been emitted; if step 3 throws, we DON'T ack, so a
        //    retry next launch picks the lines up again.
        await NativeLogger.acknowledgePersistedLogs();
    } catch (err) {
        // eslint-disable-next-line no-console
        console.log('[APPLOG] [native] replay failed:',
                    Platform.OS, err && err.message ? err.message : String(err));
    } finally {
        _replayInFlight = false;
    }

    return { replayed };
}

// Default export so existing `import replay from ...` callers still
// work without churn.
export default replayPersistedNativeLogs;
