package com.agprojects.sylk;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

/**
 * MainThreadWatchdog — catches the intermittent "UI not responding" ANR.
 *
 * The OS only writes /data/anr traces after the 5 s deadline, and on release
 * builds you often can't pull them. This watchdog catches the freeze the
 * instant it starts: a background thread posts a heartbeat to the main
 * Looper every {@link #PING_MS}. If the main thread doesn't run the heartbeat
 * within {@link #STALL_MS}, the main thread is wedged — so we dump its stack
 * to logcat under the SYLK_WATCHDOG tag. The top frame is "what hogs the UI".
 *
 * Wire it up once, early, from MainApplication.onCreate():
 *
 *     MainThreadWatchdog.start();
 *
 * Then reproduce the call-end freeze and run:
 *     adb logcat -s SYLK_WATCHDOG:V
 *
 * Strongly recommended to compile this only into debug builds (guard the
 * start() call with if (BuildConfig.DEBUG)).
 */
public final class MainThreadWatchdog {

    private static final String TAG = "SYLK_WATCHDOG";
    private static final long PING_MS  = 1000;  // how often we ping the main thread
    private static final long STALL_MS = 2500;  // dump if main hasn't answered within this
    private static final long REPORT_COOLDOWN_MS = 4000; // don't spam dumps for one long freeze

    private static volatile boolean running = false;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static volatile long lastPongUptime = SystemClock.uptimeMillis();
    private static volatile long lastReportUptime = 0;

    private MainThreadWatchdog() {}

    public static synchronized void start() {
        if (running) return;
        running = true;
        lastPongUptime = SystemClock.uptimeMillis();

        Thread watcher = new Thread(() -> {
            final Runnable heartbeat = () -> lastPongUptime = SystemClock.uptimeMillis();
            while (running) {
                // Ask the main thread to stamp the time.
                mainHandler.post(heartbeat);
                try {
                    Thread.sleep(PING_MS);
                } catch (InterruptedException e) {
                    return;
                }
                long stalledFor = SystemClock.uptimeMillis() - lastPongUptime;
                if (stalledFor >= STALL_MS) {
                    long now = SystemClock.uptimeMillis();
                    if (now - lastReportUptime >= REPORT_COOLDOWN_MS) {
                        lastReportUptime = now;
                        dumpMainStack(stalledFor);
                    }
                }
            }
        }, "SylkMainThreadWatchdog");
        watcher.setDaemon(true);
        watcher.start();
        Log.i(TAG, "started (ping=" + PING_MS + "ms stall=" + STALL_MS + "ms)");
    }

    public static synchronized void stop() {
        running = false;
    }

    private static void dumpMainStack(long stalledForMs) {
        Thread main = Looper.getMainLooper().getThread();
        StackTraceElement[] frames = main.getStackTrace();
        StringBuilder sb = new StringBuilder();
        sb.append("MAIN THREAD WEDGED for ~").append(stalledForMs)
          .append("ms — this is what hogs the UI:\n");
        for (StackTraceElement f : frames) {
            sb.append("    at ").append(f).append('\n');
        }
        Log.w(TAG, sb.toString());
    }
}
