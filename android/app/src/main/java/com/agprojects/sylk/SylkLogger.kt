// SylkLogger.kt
//
// Centralised native logging sink for the Android side. Wraps
// android.util.Log so every existing call still appears in Logcat
// AND appends each line to a rotating file in the app's internal
// storage. The React Native side reads that file once on startup
// via NativeLoggerModule so the in-app log view shows lines emitted
// while the JS process wasn't running yet — most importantly from
// MyFirebaseMessagingService and the foreground services, which
// can run in their own process when the main app is killed.
//
// Storage:
//   - filesDir/sylk-native.log         (current)
//   - filesDir/sylk-native.log.1       (one rotated backup)
//   - filesDir/sylk-native.log.read    (set aside by drainStart)
//
// Multi-process safety: SharedPreferences would NOT be safe across
// processes (FCM service runs separate). Plain FileOutputStream with
// append=true is — POSIX guarantees appends are atomic for short
// writes. We still wrap writes in synchronized so the same-process
// rotation race can't double-rotate.
//
// Two-phase drain — see Objective-C SylkLogger.m for rationale.

package com.agprojects.sylk

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object SylkLogger {

    private const val TAG = "SYLK_APP"
    private const val LOG_FILE = "sylk-native.log"
    private const val BACKUP_FILE = "sylk-native.log.1"
    private const val READ_FILE = "sylk-native.log.read"
    private const val MAX_BYTES = 512L * 1024L     // 512 KB

    @Volatile
    private var appContext: Context? = null

    // Live streaming hook. While non-null, every append() call routes
    // its line to this listener INSTEAD of writing to the rotating
    // disk buffer. Logcat output continues either way.
    //
    // The subscribe-first / no-duplicate guarantee: JS subscribes
    // first (sets this), THEN drains the disk file. Lines emitted
    // during the drain window go ONLY to this listener — they're
    // never persisted, so a subsequent app boot can't re-deliver
    // them as part of the next drain.
    @Volatile
    private var liveListener: ((String) -> Unit)? = null

    private val tsFormat = SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ss.SSS", Locale.US
    )

    private val ioLock = Any()

    /**
     * Wire the logger up from MainApplication.onCreate (and from any
     * other process entry point — FCM service onCreate, foreground
     * service onCreate, etc.). Idempotent. Without this, log calls
     * still hit Logcat but are silently dropped on disk.
     */
    @JvmStatic
    fun init(context: Context) {
        if (appContext == null) {
            appContext = context.applicationContext
        }
    }

    @JvmStatic
    fun d(message: String) {
        Log.d(TAG, message)
        append("D", message, null)
    }

    @JvmStatic
    @JvmOverloads
    fun e(message: String, throwable: Throwable? = null) {
        if (throwable != null) Log.e(TAG, message, throwable)
        else Log.e(TAG, message)
        append("E", message, throwable)
    }

    @JvmStatic
    @JvmOverloads
    fun w(message: String, throwable: Throwable? = null) {
        if (throwable != null) Log.w(TAG, message, throwable)
        else Log.w(TAG, message)
        append("W", message, throwable)
    }

    @JvmStatic
    fun i(message: String) {
        Log.i(TAG, message)
        append("I", message, null)
    }

    /**
     * Phase 1 of the drain. Atomically renames the current log file
     * to "<name>.read" and returns its contents. Any prior unacked
     * .read file is preserved (we append the current file into it
     * rather than overwrite, so two crashes in a row don't lose
     * lines).
     */
    @JvmStatic
    fun drainStart(): String {
        val ctx = appContext ?: return ""
        synchronized(ioLock) {
            val current = File(ctx.filesDir, LOG_FILE)
            val readFile = File(ctx.filesDir, READ_FILE)

            if (readFile.exists()) {
                if (current.exists() && current.length() > 0) {
                    try {
                        FileOutputStream(readFile, /* append = */ true).use { out ->
                            current.inputStream().use { it.copyTo(out) }
                        }
                    } catch (t: Throwable) {
                        Log.e(TAG, "[SylkLogger] merge into read file failed", t)
                    }
                    try { current.delete() } catch (_: Throwable) {}
                }
            } else if (current.exists()) {
                if (!current.renameTo(readFile)) {
                    // Rename across same directory should always work,
                    // but fall back to copy+delete just in case.
                    try {
                        FileOutputStream(readFile, false).use { out ->
                            current.inputStream().use { it.copyTo(out) }
                        }
                        current.delete()
                    } catch (t: Throwable) {
                        Log.e(TAG, "[SylkLogger] fallback copy failed", t)
                        return ""
                    }
                }
            }

            return if (readFile.exists()) {
                try { readFile.readText(Charsets.UTF_8) } catch (_: Throwable) { "" }
            } else {
                ""
            }
        }
    }

    /**
     * Phase 2 of the drain. Deletes the .read file. Safe to call
     * even if it doesn't exist.
     */
    @JvmStatic
    fun drainAck() {
        val ctx = appContext ?: return
        synchronized(ioLock) {
            val readFile = File(ctx.filesDir, READ_FILE)
            if (readFile.exists()) {
                try { readFile.delete() } catch (_: Throwable) {}
            }
        }
    }

    /**
     * Install / clear the live listener. Pass null to fall back to
     * disk persistence. NativeLoggerModule wires this on first
     * addListener / clears it when the last listener goes away.
     */
    @JvmStatic
    fun setLiveListener(listener: ((String) -> Unit)?) {
        liveListener = listener
    }

    // -- internals ----------------------------------------------------

    private fun append(level: String, message: String, throwable: Throwable?) {
        val ctx = appContext ?: return

        val ts = synchronized(tsFormat) { tsFormat.format(Date()) }
        val pid = android.os.Process.myPid()

        // ONE-LINE INVARIANT (matches utils.js log2file). Replace any
        // embedded CR / LF / CRLF in the message or throwable text
        // with the literal " \n " escape so the on-disk file always
        // has exactly one line per log call. Without this, a native
        // log line whose body contains a real newline would be
        // split by LogsModal's per-line parser into a tagged head
        // and one or more "untagged" tail fragments.
        val safeMessage = message.replace("\r\n", " \\n ")
                                 .replace("\n", " \\n ")
                                 .replace("\r", " \\n ")
        val safeThrow = throwable?.let { t ->
            val raw = "${t.javaClass.simpleName}: ${t.message}"
            raw.replace("\r\n", " \\n ").replace("\n", " \\n ").replace("\r", " \\n ")
        }
        val bodyNoNewline = if (safeThrow == null) {
            "$ts | $level | pid=$pid | $safeMessage"
        } else {
            "$ts | $level | pid=$pid | $safeMessage | $safeThrow"
        }

        // Snapshot the listener once. If we read it twice (e.g. for
        // the null-check then the invocation), it could be cleared
        // between the two reads and we'd NPE. Snapshotting also
        // means a clear-during-call still delivers this line — the
        // listener is "current as of this log call".
        val listener = liveListener
        if (listener != null) {
            try {
                listener(bodyNoNewline)
            } catch (t: Throwable) {
                // Don't recurse via SylkLogger here. The line is
                // lost from the bridge stream — but Logcat already
                // got it above.
                Log.e(TAG, "[SylkLogger] live listener threw", t)
            }
            return
        }

        // No live observer: persist to the rotating disk buffer so
        // the next app start can drain it.
        val data = (bodyNoNewline + "\n").toByteArray(Charsets.UTF_8)
        synchronized(ioLock) {
            try {
                val current = File(ctx.filesDir, LOG_FILE)
                if (current.exists() && current.length() + data.size > MAX_BYTES) {
                    val backup = File(ctx.filesDir, BACKUP_FILE)
                    if (backup.exists()) backup.delete()
                    current.renameTo(backup)
                }
                FileOutputStream(current, /* append = */ true).use { it.write(data) }
            } catch (t: Throwable) {
                Log.e(TAG, "[SylkLogger] append failed", t)
            }
        }
    }
}
