// appExitReporter — forward OS-recorded ANR / crash reports to support.
//
// Android (API 30+) keeps a short history of why our previous processes died,
// and for ANRs / native crashes it retains the full SIGQUIT thread dump. The
// native AppExitInfo module (android/.../AppExitInfoModule.java) reads that
// history; this module runs once per launch, picks out the report-worthy
// exits we haven't sent yet, formats them, and hands them to the existing
// encrypted "Logs -> Send to support" path (app.js#requestSupportFromLogs,
// silent mode) so they reach support@sylk.link without disturbing the user.
//
// iOS has no ApplicationExitInfo equivalent, so NativeModules.AppExitInfo is
// undefined there and every call below short-circuits to a no-op.

import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { anonymizeEmails } from './utils';
import { getCrashRecords, pruneCrashRecords } from './crashCapture';

// Watermark: epoch-ms of the newest exit we've already accounted for. Anything
// at or before this is never looked at again.
const WATERMARK_KEY = 'appExitReporter.lastTimestamp';

// ApplicationExitInfo.REASON_* values we consider worth reporting. (The native
// module sends the numeric reason plus a human-readable reasonText.)
const REASON_CRASH = 4;         // unhandled JVM / Java / Kotlin exception
const REASON_CRASH_NATIVE = 5;  // native (C/C++) crash
const REASON_ANR = 6;           // application not responding
const REPORTABLE = new Set([REASON_CRASH, REASON_CRASH_NATIVE, REASON_ANR]);

// How many recent exit records to pull from the OS per launch.
const MAX_RECORDS = 20;

// Guard against running more than once in a single JS session (e.g. multiple
// 'registered' transitions).
let _ranThisSession = false;

/**
 * Pull recent OS exit records and dispatch any new ANR/crash reports to
 * support. Best-effort and fully self-contained: never throws into the caller.
 *
 * @param {object}   deps
 * @param {string}   deps.accountId  current account URI (for the report header)
 * @param {function} deps.dispatch   async (body, subject) => boolean. Should
 *                                    resolve true only when the report was
 *                                    actually delivered (we keep retrying on
 *                                    false / throw). Wire this to
 *                                    requestSupportFromLogs(body, account,
 *                                    subject, { silent: true }).
 * @param {function} [deps.log]      optional logger, e.g. utils.timestampedLog
 */
export async function flushExitReports(deps = {}) {
    const { accountId, dispatch, log } = deps;
    const _log = typeof log === 'function' ? log : () => {};

    if (_ranThisSession) {
        return;
    }
    _ranThisSession = true;

    try {
        const native = NativeModules.AppExitInfo;
        if (!native || typeof native.getRecentExits !== 'function') {
            // iOS, or an Android build without the module — nothing to do.
            return;
        }

        let since = 0;
        try {
            const raw = await AsyncStorage.getItem(WATERMARK_KEY);
            if (raw != null) {
                const parsed = parseInt(raw, 10);
                if (!Number.isNaN(parsed)) since = parsed;
            }
        } catch (_) { /* first run / storage hiccup — treat as 0 */ }

        const exits = await native.getRecentExits(since, MAX_RECORDS);
        if (!Array.isArray(exits) || exits.length === 0) {
            return;
        }

        // Advance the watermark to the newest exit overall (reportable or not)
        // so benign exits aren't rescanned next launch. We only hold it back if
        // a reportable record fails to dispatch (see below).
        let newestTs = since;
        const reportable = [];
        for (const e of exits) {
            if (e && typeof e.timestamp === 'number' && e.timestamp > newestTs) {
                newestTs = e.timestamp;
            }
            if (e && REPORTABLE.has(e.reason)) {
                reportable.push(e);
            }
        }

        if (reportable.length > 0 && typeof dispatch === 'function') {
            reportable.sort((a, b) => a.timestamp - b.timestamp);
            // For CRASH records the OS keeps no thread dump (getTraceInputStream
            // only retains one for ANR / native crashes), so pull any JS stacks
            // we captured in-app around those times and splice them in.
            let jsCrashes = [];
            try {
                jsCrashes = await getCrashRecords();
            } catch (_) { /* best-effort — report still goes out without them */ }
            // Scrub user@domain identifiers out of the report (thread dumps and
            // descriptions can carry account/peer URIs) using the same stable
            // substitution as the manual "Send to support" flow, so support
            // gets a coherent-but-anonymized report.
            const body = anonymizeEmails(formatReport(reportable, accountId, jsCrashes));
            const hasAnr = reportable.some((e) => e.reason === REASON_ANR);
            const subject = hasAnr ? 'ANR report' : 'Crash report';

            _log('[exit-report] dispatching', reportable.length,
                'exit(s) to support, subject=', subject);

            let delivered = false;
            try {
                delivered = await dispatch(body, subject);
            } catch (err) {
                _log('[exit-report] dispatch threw:',
                    err && err.message ? err.message : err);
            }

            if (!delivered) {
                // Couldn't deliver (offline, no support key, etc). Hold the
                // watermark just before the oldest reportable record so those
                // reports are retried next launch, while still not rescanning
                // older benign exits.
                _log('[exit-report] dispatch not delivered — will retry next launch');
                newestTs = Math.min(newestTs, reportable[0].timestamp - 1);
            }
        }

        try {
            await AsyncStorage.setItem(WATERMARK_KEY, String(newestTs));
        } catch (_) { /* will simply re-evaluate next launch */ }

        // Drop captured JS stacks at or before the watermark: they've either
        // been attached to a delivered report or belong to exits we've now
        // accounted for. Records for a held-back (undelivered) report have
        // ts > newestTs and are kept for the retry next launch.
        try {
            await pruneCrashRecords(newestTs);
        } catch (_) { /* non-fatal — ring buffer is self-trimming anyway */ }
    } catch (err) {
        _log('[exit-report] flush error:',
            err && err.message ? err.message : err);
    }
}

function formatReport(exits, accountId, jsCrashes = []) {
    const lines = [];
    lines.push('SYLK app exit report');
    lines.push('account:   ' + (accountId || 'unknown'));
    lines.push('generated: ' + new Date().toISOString());
    lines.push('platform:  ' + Platform.OS + ' ' +
        (Platform.Version != null ? Platform.Version : ''));
    lines.push('records:   ' + exits.length);
    lines.push('');

    exits.forEach((e, i) => {
        lines.push('================ exit #' + (i + 1) + ' ================');
        lines.push('when:        ' + safeIso(e.timestamp));
        lines.push('reason:      ' + (e.reasonText || e.reason));
        lines.push('description: ' + (e.description || ''));
        lines.push('process:     ' + (e.processName || ''));
        lines.push('importance:  ' + e.importance);
        lines.push('pss/rss KB:  ' + e.pss + ' / ' + e.rss);
        lines.push('');
        if (e.trace) {
            lines.push('---- thread dump ----');
            lines.push(e.trace);
            lines.push('---- end thread dump ----');
        } else {
            // No OS-retained trace. Say why (from the native module), then
            // splice in any JS stack we captured in-app near this exit.
            lines.push('(no thread dump retained for this exit' +
                (e.traceUnavailableReason ? ' — ' + e.traceUnavailableReason : '') + ')');
            const js = matchJsCrash(jsCrashes, e.timestamp);
            if (js) {
                lines.push('');
                lines.push('---- JS crash captured in-app ----');
                lines.push('captured:    ' + safeIso(js.ts) +
                    '  (' + signedDeltaMs(js.ts, e.timestamp) + ' vs OS exit)');
                lines.push('fatal:       ' + (js.isFatal ? 'yes' : 'no') +
                    (js.kind ? '   kind: ' + js.kind : ''));
                if (js.name || js.message) {
                    lines.push('error:       ' +
                        [js.name, js.message].filter(Boolean).join(': '));
                }
                lines.push(js.stack || '(no stack captured)');
                lines.push('---- end JS crash ----');
            }
        }
        lines.push('');
    });

    return lines.join('\n');
}

// Pick the captured JS crash closest in time to an OS exit, within a window.
// The JS throw precedes the OS recording the death, so allow a small window on
// both sides and prefer the nearest record.
const JS_MATCH_WINDOW_MS = 60 * 1000;
function matchJsCrash(jsCrashes, exitTs) {
    if (!Array.isArray(jsCrashes) || typeof exitTs !== 'number') return null;
    let best = null;
    let bestDelta = Infinity;
    for (const r of jsCrashes) {
        if (!r || typeof r.ts !== 'number') continue;
        const delta = Math.abs(exitTs - r.ts);
        if (delta <= JS_MATCH_WINDOW_MS && delta < bestDelta) {
            best = r;
            bestDelta = delta;
        }
    }
    return best;
}

function signedDeltaMs(fromTs, toTs) {
    const d = fromTs - toTs;
    return (d >= 0 ? '+' : '') + d + 'ms';
}

function safeIso(ts) {
    try {
        return new Date(ts).toISOString();
    } catch (_) {
        return String(ts);
    }
}

export default { flushExitReports };
