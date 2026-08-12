package com.agprojects.sylk;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import androidx.annotation.RequiresApi;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * AppExitInfoModule — surfaces Android's own record of why this app's previous
 * processes died, including the full ANR / crash thread dump.
 *
 * Android (API 30+) keeps a short history of process-death reasons via
 * {@link ActivityManager#getHistoricalProcessExitReasons}. For ANRs and native
 * crashes it also retains the SIGQUIT thread dump (the same content you would
 * otherwise have to pull from /data/anr or a bugreport), retrievable through
 * {@link ApplicationExitInfo#getTraceInputStream()} — no root, no adb. We read
 * it on the *next* launch and hand it to JS, which forwards ANR/crash reports
 * to support over the existing encrypted log-share path.
 *
 * iOS has no equivalent here; on iOS this module simply isn't registered and
 * the JS side no-ops.
 */
public class AppExitInfoModule extends ReactContextBaseJavaModule {

    // Cap any single trace we read so a pathological dump can't blow up the
    // bridge payload. ANR thread dumps are typically tens to a few hundred KB.
    private static final int MAX_TRACE_BYTES = 512 * 1024;

    private final ReactApplicationContext reactContext;

    public AppExitInfoModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "AppExitInfo";
    }

    /**
     * Returns recent process-exit records newer than {@code sinceTimestampMs}.
     *
     * @param sinceTimestampMs only return exits with a timestamp strictly
     *                         greater than this (epoch millis). Pass 0 for all.
     * @param maxRecords       upper bound on records to ask the OS for.
     * @param promise          resolves to a JS array of exit objects:
     *                         { timestamp, reason, reasonText, description,
     *                           importance, pss, rss, processName, trace,
     *                           traceUnavailableReason }.
     *                         `trace` is present (non-empty) only for ANR /
     *                         native-crash records that carried a dump.
     */
    @ReactMethod
    public void getRecentExits(double sinceTimestampMs, int maxRecords, Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                // ApplicationExitInfo is API 30+. Nothing to offer on older
                // devices — resolve empty so JS treats it as "no reports".
                promise.resolve(Arguments.createArray());
                return;
            }
            promise.resolve(collect((long) sinceTimestampMs, Math.max(1, maxRecords)));
        } catch (Exception e) {
            promise.reject("E_APP_EXIT_INFO", e.getMessage(), e);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private WritableArray collect(long sinceTimestampMs, int maxRecords) {
        WritableArray out = Arguments.createArray();

        ActivityManager am =
                (ActivityManager) reactContext.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            return out;
        }

        // packageName = null, pid = 0 → all exits for our own UID.
        List<ApplicationExitInfo> reasons =
                am.getHistoricalProcessExitReasons(null, 0, maxRecords);
        if (reasons == null) {
            return out;
        }

        for (ApplicationExitInfo info : reasons) {
            long ts = info.getTimestamp();
            if (ts <= sinceTimestampMs) {
                continue;
            }

            WritableMap row = Arguments.createMap();
            row.putDouble("timestamp", (double) ts);
            row.putInt("reason", info.getReason());
            row.putString("reasonText", reasonToString(info.getReason()));
            row.putString("description",
                    info.getDescription() != null ? info.getDescription() : "");
            row.putInt("importance", info.getImportance());
            row.putDouble("pss", (double) info.getPss());   // KB
            row.putDouble("rss", (double) info.getRss());   // KB
            row.putString("processName",
                    info.getProcessName() != null ? info.getProcessName() : "");

            TraceResult tr = readTrace(info);
            row.putString("trace", tr.trace != null ? tr.trace : "");
            row.putString("traceUnavailableReason",
                    tr.trace != null ? "" : (tr.reason != null ? tr.reason : ""));

            out.pushMap(row);
        }

        return out;
    }

    /** Result of a trace read: {@code trace} is non-null on success, otherwise
     *  {@code reason} explains why (no stream, empty stream, or read error) so
     *  the JS report can say more than a bare "no thread dump". */
    private static final class TraceResult {
        final String trace;
        final String reason;
        TraceResult(String trace, String reason) { this.trace = trace; this.reason = reason; }
    }

    /**
     * Reads the retained SIGQUIT/crash dump for this exit, if any. Returns a
     * {@link TraceResult} whose {@code trace} is non-null only for records that
     * actually retained one (ANR / native crash); otherwise {@code reason}
     * distinguishes "no trace present" from a genuine read failure.
     */
    @RequiresApi(api = Build.VERSION_CODES.R)
    private TraceResult readTrace(ApplicationExitInfo info) {
        InputStream is = null;
        try {
            is = info.getTraceInputStream();
            if (is == null) {
                return new TraceResult(null, "no OS trace stream for this exit "
                        + "(reason=" + reasonToString(info.getReason())
                        + "; only ANR/native-crash retain one)");
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int total = 0;
            int n;
            while ((n = is.read(buf)) != -1 && total < MAX_TRACE_BYTES) {
                int take = Math.min(n, MAX_TRACE_BYTES - total);
                bos.write(buf, 0, take);
                total += take;
            }
            String s = new String(bos.toByteArray(), StandardCharsets.UTF_8);
            if (total >= MAX_TRACE_BYTES) {
                s = s + "\n... [trace truncated at " + MAX_TRACE_BYTES + " bytes] ...\n";
            }
            if (s.isEmpty()) {
                return new TraceResult(null, "OS trace stream was present but empty");
            }
            return new TraceResult(s, null);
        } catch (Exception e) {
            return new TraceResult(null, "trace read failed: "
                    + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        } finally {
            if (is != null) {
                try { is.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static String reasonToString(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_ANR:                 return "ANR";
            case ApplicationExitInfo.REASON_CRASH:               return "CRASH";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:        return "CRASH_NATIVE";
            case ApplicationExitInfo.REASON_LOW_MEMORY:          return "LOW_MEMORY";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                                                                 return "EXCESSIVE_RESOURCE_USAGE";
            case ApplicationExitInfo.REASON_SIGNALED:            return "SIGNALED";
            case ApplicationExitInfo.REASON_USER_REQUESTED:      return "USER_REQUESTED";
            case ApplicationExitInfo.REASON_USER_STOPPED:        return "USER_STOPPED";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED:     return "DEPENDENCY_DIED";
            case ApplicationExitInfo.REASON_OTHER:               return "OTHER";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE:
                                                                 return "INITIALIZATION_FAILURE";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE:   return "PERMISSION_CHANGE";
            case ApplicationExitInfo.REASON_EXIT_SELF:           return "EXIT_SELF";
            default:                                             return "UNKNOWN(" + reason + ")";
        }
    }
}
