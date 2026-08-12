// crashCapture — persist uncaught JS errors + unhandled promise rejections so
// the crash reporter can attach real stacks to Android exit records.
//
// WHY: Android's ApplicationExitInfo (read by AppExitInfoModule) only retains a
// thread dump for ANR and NATIVE_CRASH records. A plain Java/JS uncaught
// exception is recorded as REASON_CRASH with NO retrievable trace — which is
// why the automatic exit reports (app/appExitReporter.js) kept arriving as
// "(no thread dump retained)". Here we install a global JS error handler that
// stashes the stack in a small persistent ring buffer; on the next launch
// appExitReporter matches those stacks to the OS CRASH records by timestamp.
//
// Best-effort by nature: on a hard crash the process can die before an async
// AsyncStorage write reaches disk. In practice the write is dispatched to the
// native storage thread synchronously from JS, so it usually survives; when it
// doesn't, we simply fall back to the previous "no dump" behaviour. Non-fatal
// errors and unhandled rejections persist reliably.

import { Platform, DevSettings } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { timestampedLog } from './utils';

export const CRASH_RECORDS_KEY = 'crashCapture.records';

// Keep the buffer small: enough to cover a burst of crashes between launches,
// bounded so a crash loop can't grow storage without limit.
const MAX_RECORDS = 10;
// Cap a single stack so a pathological trace can't bloat the report / storage.
const MAX_STACK_CHARS = 8000;

let _installed = false;
// In-memory mirror of the persisted buffer so each record write is a single
// setItem of the whole (small) array — no read-modify-write on the crash path,
// where we may not get a chance to await a read.
let _records = [];

function _clip(s, max) {
    if (typeof s !== 'string') return '';
    return s.length > max ? s.slice(0, max) + '\n... [truncated] ...' : s;
}

function _now() {
    try { return Date.now(); } catch (_) { return 0; }
}

// Record a single crash into the ring buffer and persist (fire-and-forget).
function recordCrash(error, isFatal, kind) {
    try {
        const err = error || {};
        const rec = {
            ts: _now(),
            isFatal: !!isFatal,
            kind: kind || (isFatal ? 'fatal' : 'error'),
            name: (err && err.name) ? String(err.name) : '',
            message: (err && err.message) ? String(err.message)
                : (typeof err === 'string' ? err : ''),
            stack: _clip((err && err.stack) ? String(err.stack) : '', MAX_STACK_CHARS),
        };

        _records.push(rec);
        if (_records.length > MAX_RECORDS) {
            _records = _records.slice(_records.length - MAX_RECORDS);
        }

        // Persist the whole small array in one shot. Can't await on the fatal
        // path, so fire it and let the native storage thread flush it.
        AsyncStorage.setItem(CRASH_RECORDS_KEY, JSON.stringify(_records))
            .catch(() => { /* best-effort */ });

        try {
            timestampedLog('[crash-capture] recorded',
                rec.kind, rec.isFatal ? '(fatal)' : '',
                rec.name || rec.message || '(no message)');
        } catch (_) { /* logging must never throw here */ }
    } catch (_) {
        // Never let crash capture become the crash.
    }
}

/**
 * Install global capture. Idempotent. Call as early as possible (index.js).
 */
export function installCrashCapture() {
    if (_installed) return;
    _installed = true;

    // Hydrate the in-memory buffer from any records a previous run left behind
    // that appExitReporter hasn't consumed yet, so we append rather than
    // clobber them.
    AsyncStorage.getItem(CRASH_RECORDS_KEY)
        .then((raw) => {
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                // Existing on-disk records go ahead of anything captured during
                // hydration; cap to the ring size.
                _records = parsed.concat(_records).slice(-MAX_RECORDS);
            }
        })
        .catch(() => { /* first run / corrupt — start clean */ });

    // 1. Uncaught JS exceptions (the ones that become Android REASON_CRASH).
    //    Chain to the previous handler so RN's redbox / native fatal path is
    //    unchanged — we only observe.
    try {
        const g = global;
        if (g && g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === 'function') {
            const prior = typeof g.ErrorUtils.getGlobalHandler === 'function'
                ? g.ErrorUtils.getGlobalHandler() : null;
            g.ErrorUtils.setGlobalHandler((error, isFatal) => {
                recordCrash(error, isFatal, 'uncaughtException');
                if (typeof prior === 'function') {
                    prior(error, isFatal);
                }
            });
        }
    } catch (e) {
        try { timestampedLog('[crash-capture] setGlobalHandler failed:', e && e.message); } catch (_) {}
    }

    // 2. Unhandled promise rejections. In production RN does not track these,
    //    so enabling it is additive; in __DEV__ RN installs its own tracker and
    //    we leave it alone to preserve the dev warning overlay.
    if (!__DEV__) {
        try {
            const tracking = require('promise/setimmediate/rejection-tracking');
            if (tracking && typeof tracking.enable === 'function') {
                tracking.enable({
                    allRejections: true,
                    onUnhandled: (id, error) => recordCrash(error, false, 'unhandledRejection'),
                    onHandled: () => { /* a late-handled rejection isn't a crash */ },
                });
            }
        } catch (e) {
            try { timestampedLog('[crash-capture] rejection tracking unavailable:', e && e.message); } catch (_) {}
        }
    }

    // 3. Dev-only: a "Throw test crash" entry in the RN dev menu (shake /
    //    Cmd+M) so the capture path can be exercised on demand. DevSettings is
    //    dev-only; the __DEV__ guard keeps it out of release entirely.
    if (__DEV__) {
        try {
            if (DevSettings && typeof DevSettings.addMenuItem === 'function') {
                DevSettings.addMenuItem('Throw test crash', () => throwTestCrash('fatal'));
            }
        } catch (e) {
            try { timestampedLog('[crash-capture] dev menu item failed:', e && e.message); } catch (_) {}
        }
    }

    try {
        timestampedLog('[crash-capture] installed (platform ' + Platform.OS + ')');
    } catch (_) {}
}

/**
 * Return the captured crash records (oldest first). Best-effort: reads straight
 * from storage so it reflects records persisted by a prior process too.
 */
export async function getCrashRecords() {
    try {
        const raw = await AsyncStorage.getItem(CRASH_RECORDS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/**
 * Drop persisted records at or before beforeTs (ms). Called by appExitReporter
 * once it has attached/accounted for them, so the buffer doesn't re-attach the
 * same stack on every launch.
 */
export async function pruneCrashRecords(beforeTs) {
    try {
        const cutoff = typeof beforeTs === 'number' ? beforeTs : 0;
        let disk = [];
        try {
            const raw = await AsyncStorage.getItem(CRASH_RECORDS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) disk = parsed;
            }
        } catch (_) { /* treat as empty */ }
        const kept = disk
            .filter((r) => r && typeof r.ts === 'number' && r.ts > cutoff)
            .slice(-MAX_RECORDS);
        _records = kept;
        await AsyncStorage.setItem(CRASH_RECORDS_KEY, JSON.stringify(kept));
    } catch (_) {
        // non-fatal — the ring buffer is self-trimming anyway
    }
}

/**
 * Dev-only: deliberately crash to exercise the capture -> persist -> attach
 * path. Wired into the RN dev menu by installCrashCapture under __DEV__, and
 * also callable directly (e.g. from the Metro console):
 *   require('./app/crashCapture').throwTestCrash('fatal' | 'rejection').
 *
 *  - 'fatal' (default): an uncaught exception on the JS thread. Thrown from a
 *      timer so it routes through the global handler exactly like a real crash
 *      (and in a release build terminates the process -> Android records it as
 *      REASON_CRASH, which is what lets appExitReporter attach the stack next
 *      launch).
 *  - 'rejection': an unhandled promise rejection. Note: in __DEV__ RN's own
 *      rejection tracker handles this (our tracker is only enabled in release),
 *      so use a release build to see it flow through crashCapture.
 *
 * No-op unless __DEV__ or opts.force is set — the in-app Developer-mode button
 * passes force so it also works in release/internal builds; otherwise it can
 * never fire.
 */
export function throwTestCrash(kind = 'fatal', opts = {}) {
    if (!__DEV__ && !opts.force) return;
    try { timestampedLog('[crash-capture] throwTestCrash requested:', kind); } catch (_) {}
    if (kind === 'rejection') {
        // Intentionally un-.catch()ed so the rejection tracker records it.
        Promise.reject(new Error('SYLK dev test - intentional unhandled promise rejection'));
        return;
    }
    // 'fatal' / default: become a genuine uncaught exception on the next tick.
    setTimeout(() => {
        throw new Error('SYLK dev test crash - intentional (throwTestCrash)');
    }, 0);
}

export default {
    installCrashCapture,
    getCrashRecords,
    pruneCrashRecords,
    throwTestCrash,
    CRASH_RECORDS_KEY,
};
