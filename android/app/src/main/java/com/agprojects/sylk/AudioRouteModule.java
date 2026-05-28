/*
 * Copyright (c) 2025 Adrian Georgescu ag@ag-projects.com
 * 
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

package com.agprojects.sylk;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Display;

import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;

import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.concurrent.Executor;

import android.media.AudioFocusRequest;
import android.media.AudioAttributes;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothHeadset;

// Telecom plumbing — used by setActiveDevice(callUuid, ...) so that we update
// the Telecom framework's audio-route view *and* AudioManager from a single
// native entry point. Without this, AudioManager.setCommunicationDevice() can
// land successfully and then be silently re-overridden by Telecom because its
// route hasn't moved (the case we used to patch with RNCallKeep.setAudioRoute
// from JS, which raced against AudioRouteModule.setActiveDevice).
import android.telecom.CallAudioState;
import android.telecom.Connection;
import android.telecom.DisconnectCause;

import java.util.List;
import java.util.Set;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import com.agprojects.sylk.BluetoothScoManager;


public class AudioRouteModule extends ReactContextBaseJavaModule implements LifecycleEventListener {

    private final ReactApplicationContext reactContext;
    private BroadcastReceiver headsetReceiver;
    public static AudioRouteModule instance;
    private BluetoothHeadset bluetoothHeadset = null;
    private int lastScoState = AudioManager.SCO_AUDIO_STATE_DISCONNECTED;
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;
    // Periodic event fields
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable periodicRunnable = null;
    private int periodicIntervalMs = 0; // 0 = disabled
    private BluetoothScoManager scoManager;
    private static final String TAG = "SYLK_APP";
    private final AudioManager audioManager;
    private int origAudioMode = AudioManager.MODE_INVALID;
    private boolean started = false;
    private String currentRoute = "BUILTIN_EARPIECE";

    private Object communicationDeviceListener; // holds the listener only on supported API
    private boolean listenerStarted = false;
    // Last device info we logged for the OnCommunicationDeviceChangedListener,
    // used to suppress the duplicate-burst that Android's audio policy fires
    // after each route flip (the same callback can come in 4–8 times back-to-
    // back with identical content). Format: "<id> <name> <type>" — a string so
    // we don't have to track three primitive fields.
    private String lastLoggedCommDevice = null;
    // When the user requests BT routing before SCO is established, store the target
    // device here and apply it as soon as SCO audio connects.
    private Map<String, String> pendingBtDevice = null;

    // [FoldDiag] Jetpack WindowManager observer — emits a log when the device posture
    // changes (FLAT / HALF_OPENED). Needs an Activity, so we wire it up via
    // LifecycleEventListener.onHostResume() and tear it down on onHostPause().
    private WindowInfoTrackerCallbackAdapter windowInfoTracker;
    private Consumer<WindowLayoutInfo> foldStateCallback;
    private Executor mainExecutor;
    private Activity foldObservedActivity;
    // Cached posture so the [AudioDiag] emit line can include it in its one-liner.
    private volatile String lastFoldState = "NONE";
    private volatile String lastFoldOrientation = "NONE";

    // [FoldDiag] Hinge angle sensor (API 30+). Gives us the actual hinge angle
    // in degrees — FoldingFeature only exposes FLAT / HALF_OPENED which is too
    // coarse to pick a "hide earpiece" threshold (on Razr the audible speaker
    // takeover happens ~60° open, well inside HALF_OPENED).
    private SensorManager sensorManager;
    private Sensor hingeSensor;
    private SensorEventListener hingeListener;
    private volatile float lastHingeAngle = Float.NaN;      // latest raw value
    private float lastLoggedHingeAngle = Float.NaN;         // last value we logged

    // Angle below which we consider the device "folded closed enough" to hide
    // the earpiece. Empirically derived on Razr 60 Ultra: half-open is ~90°,
    // inner display turns off around 76°, HAL forces speaker around 60°. 85°
    // gives the UI time to react while earpiece still physically works.
    private static final float FOLDED_THRESHOLD_DEGREES = 85f;
    private volatile boolean lastIsFolded = false;
    // Tracks the last non-NONE FoldingFeature state so we can detect the
    // "HALF_OPENED -> NONE" transition as a fallback for devices without
    // a TYPE_HINGE_ANGLE sensor.
    private volatile String lastNonNoneFoldState = "NONE";

    public AudioRouteModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
        instance = this;
        registerReceivers();
        reactContext.addLifecycleEventListener(this);
        SylkLogger.d("[audio] AudioRouteModule init");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startCommunicationDeviceListener();
            startAudioModeListener();
        } else {
            SylkLogger.d("[audio] Communication device listener not supported on this Android version");
        }
    }

    // ---- Passive audio-mode observer ------------------------------------------
    // Tracks every AudioManager mode transition (including those initiated by
    // Telecom, rn-webrtc, or other apps) so we can identify "who set
    // IN_COMMUNICATION and when". Strictly observational — does NOT call
    // setMode. Logs each change with timestamp, thread, and a short stack
    // snippet. The stack will only identify the SETTER when the listener is
    // invoked synchronously on the setter's thread (often the case for
    // in-process setMode calls); for cross-process setters (Telecom, system)
    // the stack will be the binder/dispatch frames and the thread name is
    // usually the only clue.

    private Object modeChangedListenerRef; // typed Object to avoid API-level import issues
    private static volatile int lastObservedMode = AudioManager.MODE_INVALID;
    private static volatile long lastObservedModeAt = 0L;
    private static volatile String lastObservedModeCaller = null;

    /**
     * Snapshot of the AudioManager mode at the moment the FCM push for an
     * incoming call arrived (i.e. BEFORE Telecom flipped to RINGTONE and
     * then IN_COMMUNICATION). Used by {@link #stop} as the restore target
     * — origAudioMode captured later in start() is already polluted to
     * IN_COMMUNICATION on this device. Sentinel -1 means "no snapshot".
     */
    private static volatile int preCallMode = -1;

    /**
     * Capture the current AudioManager mode into {@link #preCallMode}. Call
     * from any native code path that observes the very first signal of a
     * new call (typically MyFirebaseMessagingService.onMessageReceived on
     * an incoming-call event). Idempotent: if a snapshot is already
     * present, the new call is logged but the existing value is kept (so
     * back-to-back pushes don't overwrite a clean NORMAL with a stale
     * IN_COMMUNICATION from a still-in-flight call).
     */
    public static void capturePreCallMode(Context ctx, String source) {
        try {
            if (ctx == null) return;
            android.media.AudioManager am = (android.media.AudioManager)
                    ctx.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            int mode = am.getMode();
            if (preCallMode != -1) {
                // [audio] capturePreCallMode skip telemetry — disabled.
                // Re-enable when debugging pre-call mode caching across
                // multiple FCM-push entry points.
                /*
                SylkLogger.d("[audio] SYLK_APP audio mode capturePreCallMode skipped, already have "
                        + getAudioModeDescription(preCallMode)
                        + " (new value would be " + getAudioModeDescription(mode)
                        + ", source=" + source + ")");
                */
                return;
            }
            preCallMode = mode;
            // [audio] capturePreCallMode capture telemetry — disabled.
            /*
            SylkLogger.d("[audio] SYLK_APP audio mode capturePreCallMode captured "
                    + getAudioModeDescription(mode) + " (source=" + source + ")");
            */
        } catch (Exception e) {
            SylkLogger.e("[audio] SYLK_APP audio mode capturePreCallMode failed (source=" + source + ")", e);
        }
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.S)
    private void startAudioModeListener() {
        if (audioManager == null) return;
        try {
            AudioManager.OnModeChangedListener listener = (newMode) -> {
                // KEEP the cache updates (other code reads
                // lastObservedMode / lastObservedModeAt /
                // lastObservedModeCaller via SYLK_APP cleanupTelecomConnection
                // path), but skip the per-event log line + the briefStack
                // call that built the giant verbose payload. The OS
                // fires this many times in a row with the same mode
                // during call setup; the diagnostic was written once
                // to figure out who was repeatedly setting
                // IN_COMMUNICATION and is now permanent noise.
                long now = System.currentTimeMillis();
                String thread = Thread.currentThread().getName();
                lastObservedMode = newMode;
                lastObservedModeAt = now;
                lastObservedModeCaller = thread; // stack omitted to avoid briefStack() cost
                /*
                String desc = getAudioModeDescription(newMode);
                String prev = getAudioModeDescription(lastObservedMode);
                String stack = briefStack();
                lastObservedModeCaller = thread + " | " + stack;
                SylkLogger.d("[audio] SYLK_APP audio mode observed " + prev + " -> " + desc
                        + " at=" + now
                        + " thread=" + thread
                        + " stack=" + stack);
                */
            };
            audioManager.addOnModeChangedListener(
                    java.util.concurrent.Executors.newSingleThreadExecutor(),
                    listener);
            modeChangedListenerRef = listener;
            // Seed with the current value so the first transition has a
            // meaningful "from".
            lastObservedMode = audioManager.getMode();
            lastObservedModeAt = System.currentTimeMillis();
            SylkLogger.d("[audio] SYLK_APP audio mode listener started; current="
                    + getAudioModeDescription(lastObservedMode));
        } catch (Exception e) {
            SylkLogger.e("[audio] failed to register OnModeChangedListener", e);
        }
    }

    /**
     * Capture a brief, log-friendly stack snippet (skipping the first few
     * VM/listener frames). Useful for in-process callers; mostly noise for
     * cross-process setters but the binder frames at least confirm where
     * the call came from.
     */
    private static String briefStack() {
        try {
            StackTraceElement[] st = Thread.currentThread().getStackTrace();
            StringBuilder sb = new StringBuilder();
            int kept = 0;
            for (int i = 0; i < st.length && kept < 6; i++) {
                String cls = st[i].getClassName();
                // Skip the boilerplate frames at the top of every stack.
                if (cls.startsWith("java.lang.Thread")
                        || cls.startsWith("com.agprojects.sylk.AudioRouteModule$")
                        || cls.contains("OnModeChangedListener")) {
                    continue;
                }
                if (sb.length() > 0) sb.append(" <- ");
                sb.append(cls).append("#").append(st[i].getMethodName())
                        .append(":").append(st[i].getLineNumber());
                kept++;
            }
            return sb.length() == 0 ? "<empty>" : sb.toString();
        } catch (Throwable t) {
            return "<stack-unavailable>";
        }
    }

    // ---- Fold observer (LifecycleEventListener) -------------------------------

    @Override
    public void onHostResume() {
        startFoldObserver();
        startHingeSensor();
    }

    @Override
    public void onHostPause() {
        stopFoldObserver();
        stopHingeSensor();
    }

    @Override
    public void onHostDestroy() {
        stopFoldObserver();
        stopHingeSensor();
    }

    private void startFoldObserver() {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] startFoldObserver: no activity yet"); */
            return;
        }
        if (windowInfoTracker != null && foldObservedActivity == activity) {
            return; // already observing this activity
        }
        stopFoldObserver(); // clear any previous observer

        try {
            windowInfoTracker = new WindowInfoTrackerCallbackAdapter(
                    WindowInfoTracker.getOrCreate(activity));
            mainExecutor = ContextCompat.getMainExecutor(activity);
            foldObservedActivity = activity;

            foldStateCallback = new Consumer<WindowLayoutInfo>() {
                @Override
                public void accept(WindowLayoutInfo info) {
                    String state = "NONE";
                    String orientation = "NONE";
                    String occlusion = "NONE";
                    boolean isSeparating = false;

                    for (DisplayFeature feature : info.getDisplayFeatures()) {
                        if (feature instanceof FoldingFeature) {
                            FoldingFeature fold = (FoldingFeature) feature;
                            state = fold.getState().toString();
                            orientation = fold.getOrientation().toString();
                            occlusion = fold.getOcclusionType().toString();
                            isSeparating = fold.isSeparating();
                            break;
                        }
                    }

                    // Cache for inclusion in [AudioDiag] emit one-liners
                    lastFoldState = state;
                    lastFoldOrientation = orientation;
                    if (!"NONE".equals(state)) {
                        lastNonNoneFoldState = state;
                    }

                    Display display = foldObservedActivity != null
                            ? foldObservedActivity.getWindowManager().getDefaultDisplay()
                            : null;

                    /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] layout"
                            + " state=" + state
                            + " orientation=" + orientation
                            + " occlusion=" + occlusion
                            + " separating=" + isSeparating
                            + " features=" + info.getDisplayFeatures().size()
                            + " display=" + (display != null ? (display.getDisplayId() + "(" + display.getName() + ")") : "null")); */

                    updateFoldStateAndMaybeEmit();
                }
            };

            windowInfoTracker.addWindowLayoutInfoListener(activity, mainExecutor, foldStateCallback);
            /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] observer started for activity=" + activity.getClass().getSimpleName()); */
        } catch (Throwable t) {
            // Safety net: don't let a Jetpack/WindowManager issue crash the audio module.
            /* [FoldUI] disabled */ /* SylkLogger.e("[audio] [FoldUI] failed to start fold observer", t); */
            windowInfoTracker = null;
            foldObservedActivity = null;
        }
    }

    private void stopFoldObserver() {
        if (windowInfoTracker != null && foldStateCallback != null) {
            try {
                windowInfoTracker.removeWindowLayoutInfoListener(foldStateCallback);
            } catch (Throwable t) {
                /* [FoldUI] disabled */ /* SylkLogger.w("[audio] [FoldUI] error removing listener: " + t.getMessage()); */
            }
        }
        windowInfoTracker = null;
        foldStateCallback = null;
        mainExecutor = null;
        foldObservedActivity = null;
    }

    // ---- Hinge angle sensor (TYPE_HINGE_ANGLE, API 30+) -----------------------
    //
    // FoldingFeature only exposes coarse buckets (FLAT / HALF_OPENED). On the
    // Razr the audible speaker takeover happens around 60° open — well inside
    // HALF_OPENED — so we can't pick a precise "hide earpiece" threshold from
    // that alone. TYPE_HINGE_ANGLE gives us the continuous angle in degrees
    // (0.0 = fully closed, 180.0 = fully open) on devices that support it.
    //
    // We throttle logging to "≥ 2° change since last log" so we don't flood
    // logcat while the user slowly folds/unfolds the device.

    private void startHingeSensor() {
        if (hingeListener != null) return; // already listening

        try {
            if (sensorManager == null) {
                sensorManager = (SensorManager) reactContext.getSystemService(Context.SENSOR_SERVICE);
            }
            if (sensorManager == null) {
                /* [FoldUI] disabled */ /* SylkLogger.w("[audio] [FoldUI] no SensorManager available"); */
                return;
            }

            // TYPE_HINGE_ANGLE constant exists on API 30+; getDefaultSensor() safely
            // returns null on devices without the sensor, so no SDK_INT guard needed
            // beyond a simple try/catch on older runtime classes.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] hinge sensor not supported on this Android version"); */
                return;
            }

            hingeSensor = sensorManager.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE);
            if (hingeSensor == null) {
                /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] no TYPE_HINGE_ANGLE sensor on this device"); */
                return;
            }

            hingeListener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    if (event.values == null || event.values.length == 0) return;
                    float angle = event.values[0];
                    lastHingeAngle = angle;

                    // Per-sample angle logging disabled — too noisy in normal
                    // operation. The [AudioDiag] emit line still carries the
                    // latest hinge value, and [FoldDiag] isFolded transitions
                    // are still logged. Re-enable here if more granular data
                    // is needed.

                    // Recompute folded state every sample (cheap); the helper
                    // only fires an event on actual transition.
                    updateFoldStateAndMaybeEmit();
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {
                    /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] hinge accuracy=" + accuracy); */
                }
            };

            boolean registered = sensorManager.registerListener(
                    hingeListener, hingeSensor, SensorManager.SENSOR_DELAY_NORMAL);
            /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] hinge sensor registered=" + registered
                    + " name=" + hingeSensor.getName()
                    + " vendor=" + hingeSensor.getVendor()
                    + " maxRange=" + hingeSensor.getMaximumRange()); */
        } catch (Throwable t) {
            /* [FoldUI] disabled */ /* SylkLogger.e("[audio] [FoldUI] failed to start hinge sensor", t); */
            hingeListener = null;
            hingeSensor = null;
        }
    }

    private void stopHingeSensor() {
        try {
            if (sensorManager != null && hingeListener != null) {
                sensorManager.unregisterListener(hingeListener);
            }
        } catch (Throwable t) {
            /* [FoldUI] disabled */ /* SylkLogger.w("[audio] [FoldUI] error unregistering hinge listener: " + t.getMessage()); */
        }
        hingeListener = null;
        hingeSensor = null;
        // Keep sensorManager reference — it's cheap, and onHostResume() may re-register.
    }

    /**
     * Decide whether the device should be treated as "folded closed enough to
     * hide the earpiece". Prefers the continuous hinge sensor when available;
     * falls back to the coarse FoldingFeature posture for devices without
     * TYPE_HINGE_ANGLE.
     */
    private boolean computeIsFolded() {
        // Primary signal: hinge angle below the threshold.
        if (!Float.isNaN(lastHingeAngle)) {
            return lastHingeAngle < FOLDED_THRESHOLD_DEGREES;
        }
        // Fallback: FoldingFeature reports NONE (no feature visible) after we
        // had just been in HALF_OPENED. On Razr-style flips this is what
        // fires when the inner display turns off, i.e. the device is closed.
        return "NONE".equals(lastFoldState) && "HALF_OPENED".equals(lastNonNoneFoldState);
    }

    /**
     * Recompute `lastIsFolded`; if it changed, push a CommunicationsDevicesChanged
     * event so JS can react immediately (hide earpiece, auto-flip UI selection).
     */
    private void updateFoldStateAndMaybeEmit() {
        boolean isFolded = computeIsFolded();
        if (isFolded == lastIsFolded) return;
        lastIsFolded = isFolded;
        /* [FoldUI] disabled */ /* SylkLogger.d("[audio] [FoldUI] isFolded -> " + isFolded
                + " (hinge=" + (Float.isNaN(lastHingeAngle) ? "NA" : lastHingeAngle)
                + " fold=" + lastFoldState + "/" + lastFoldOrientation + ")"); */
        sendReactNativeEvent();
    }

    @Override
    public String getName() {
        return "AudioRouteModule";
    }

    // Required by RN's NativeEventEmitter so it can call into the module
    // to track listener counts. Without these, the JS side prints
    //   `new NativeEventEmitter()` was called with a non-null argument
    //   without the required `addListener` / `removeListeners` method
    // on every boot. We don't track counts here (events fire regardless),
    // so the implementations are intentional no-ops.
    @ReactMethod
    public void addListener(String eventName) {
        // no-op
    }

    @ReactMethod
    public void removeListeners(double count) {
        // no-op
    }

    public static void routeToBluetooth() {
        if (instance != null) {
            //
        }
    }

    public static void onHeadsetEvent() {
        if (instance != null) {
            SylkLogger.d("[audio] Static onHeadsetEvent() invoked");
            instance.sendReactNativeEvent();
        }
    }

    private boolean hasBluetoothScoDeviceNew() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
    
        List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
        for (AudioDeviceInfo dev : devices) {
            if (dev.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true;
        }
        return false;
    }

	private void acquireAudioFocus() {
		audioFocusListener = focusChange -> {
			SylkLogger.d("[audio] AudioFocus change: " + focusChange);
		};
	
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
				.setAudioAttributes(new AudioAttributes.Builder()
					.setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
					.setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
					.build())
				.setAcceptsDelayedFocusGain(false)
				.setOnAudioFocusChangeListener(audioFocusListener)
				.build();
			audioManager.requestAudioFocus(request);
		} else {
			audioManager.requestAudioFocus(audioFocusListener,
				AudioManager.STREAM_VOICE_CALL,
				AudioManager.AUDIOFOCUS_GAIN);
		}
	}

    private void startCommunicationDeviceListener() {
        if (listenerStarted) return;
    
        communicationDeviceListener = new AudioManager.OnCommunicationDeviceChangedListener() {
            @Override
            public void onCommunicationDeviceChanged(AudioDeviceInfo deviceInfo) {
                String deviceName = deviceInfo.getProductName() != null
                        ? deviceInfo.getProductName().toString()
                        : "UNKNOWN";

                String typeName = getDeviceTypeName(deviceInfo.getType());
                int deviceId = deviceInfo.getId();

                // Dedupe: Android fires this callback in rapid bursts (4-8x
                // identical) for a single route change. Log the first one and
                // skip every duplicate until the device actually changes.
                String key = deviceId + " " + deviceName + " " + typeName;
                if (!key.equals(lastLoggedCommDevice)) {
                    SylkLogger.d("[audio] Communication device changed to " + key);
                    lastLoggedCommDevice = key;
                }

                sendReactNativeEvent();
            }
        };
    
        audioManager.addOnCommunicationDeviceChangedListener(
                reactContext.getMainExecutor(),
                (AudioManager.OnCommunicationDeviceChangedListener) communicationDeviceListener
        );
    
        listenerStarted = true;
    }
    
    public void stopCommunicationDeviceListener() {
        if (!listenerStarted || communicationDeviceListener == null) return;
    
        audioManager.removeOnCommunicationDeviceChangedListener(
                (AudioManager.OnCommunicationDeviceChangedListener) communicationDeviceListener
        );
    
        listenerStarted = false;
    }

    private void registerReceivers() {
        // Register on all API levels so BT/headset connect events update the device
        // list on old Android (< 31) too. getAudioOutputs() uses getDevices() (API 23+)
        // so all the sendReactNativeEvent() calls inside are safe on old Android.

        //SylkLogger.d("[audio] Registering headset/Bluetooth/SCO receivers…");
        headsetReceiver = new BroadcastReceiver() {
            private int lastHeadsetProfileState = BluetoothProfile.STATE_DISCONNECTED;
            private int lastScoAudioState = AudioManager.SCO_AUDIO_STATE_DISCONNECTED;
            private long lastEventTime = 0;
            private static final long EVENT_COOLDOWN_MS = 100;
    
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
    
                long now = System.currentTimeMillis();
                if (now - lastEventTime < EVENT_COOLDOWN_MS) {
                    return; // suppress burst spam
                }
                lastEventTime = now;
    
                switch (action) {
                    case BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED: {
                        int profileState = intent.getIntExtra(
                                BluetoothProfile.EXTRA_STATE,
                                BluetoothProfile.STATE_DISCONNECTED
                        );
                    
                        if (profileState == lastHeadsetProfileState) return;
                        lastHeadsetProfileState = profileState;
                    
                        SylkLogger.d("[audio] BT profile state=" + headsetProfileStateToString(profileState));

                        // Notify JS so the device list updates on all Android versions.
                        // Auto-route to BT only on API 31+ (uses getAvailableCommunicationDevices).
                        if (profileState == BluetoothProfile.STATE_CONNECTED) {
                            SylkLogger.d("[audio] BT headset connected");
                            sendReactNativeEvent(); // update device list on old Android
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                handler.postDelayed(() -> {
                                    List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                                    for (AudioDeviceInfo device : devices) {
                                        if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                                            Map<String, String> btDevice = new HashMap<>();
                                            btDevice.put("id", String.valueOf(device.getId()));
                                            btDevice.put("name", device.getProductName() != null
                                                    ? device.getProductName().toString() : "UNKNOWN");
                                            btDevice.put("type", "BLUETOOTH_SCO");
                                            // [audio] Auto routing to BLUETOOTH — disabled.
                                            // Inside a for-loop iterating BT devices, can fire
                                            // multiple times per profile-state change. Re-enable
                                            // when debugging BT auto-routing on connection.
                                            //SylkLogger.d("[audio] Auto routing to BLUETOOTH");
                                            switchAudioRoute(btDevice);
                                            break;
                                        }
                                    }
                                }, 100);
                            }
                        } else {
                            sendReactNativeEvent(); // BT disconnected — update list
                        }
                    
                        break;
                    }
    
                    case AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED: {
                        int scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);

                        // SUPPRESS CONNECTED → CONNECTING noise
                        if (lastScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_CONNECTING) {
                            return;
                        }

                        // ignore repeated DISCONNECTED
                        if (scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && lastScoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && !audioManager.isBluetoothScoOn()) {
                            return;
                        }

                        if (scoState == lastScoState) return;

                        SylkLogger.d("[audio] BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + audioManager.isBluetoothScoOn() + ")");

                        int prevScoState = lastScoState;
                        lastScoState = scoState; // UPDATE THE MODULE FIELD

                        if (prevScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                            sendReactNativeEvent();
                        }

                        if (prevScoState != AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            sendReactNativeEvent();
                        }

                        break;
                    }

                    case AudioManager.ACTION_AUDIO_BECOMING_NOISY:
                        SylkLogger.d("[audio] ACTION_HEADSET_PLUG event");
                        sendReactNativeEvent();
                        break;
    
                    case Intent.ACTION_HEADSET_PLUG:
                        // Always notify JS so the device list updates on all Android versions.
                        // Auto-route to the wired device only on API 31+ (uses getAvailableCommunicationDevices).
                        sendReactNativeEvent();
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            handler.postDelayed(() -> {
                                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                                // [audio] HEADSET plugged event — disabled.
                                // Inside a postDelayed inside the headset receiver; the
                                // ensuing per-device traces (Auto route to wired/USB
                                // headset below) carry the actionable signal.
                                //SylkLogger.d("[audio] HEADSET plugged event");
                                for (AudioDeviceInfo device : devices) {
                                    if (device.getType() == AudioDeviceInfo.TYPE_WIRED_HEADSET) {
                                        Map<String, String> wiredDevice = new HashMap<>();
                                        wiredDevice.put("id", String.valueOf(device.getId()));
                                        wiredDevice.put("name", device.getProductName() != null ? device.getProductName().toString() : "UNKNOWN");
                                        wiredDevice.put("type", "WIRED_HEADSET");
                                        SylkLogger.d("[audio] Auto route to wired headset");
                                        switchAudioRoute(wiredDevice);
                                    } else if (device.getType() == AudioDeviceInfo.TYPE_USB_HEADSET) {
                                        Map<String, String> wiredDevice = new HashMap<>();
                                        wiredDevice.put("id", String.valueOf(device.getId()));
                                        wiredDevice.put("name", device.getProductName() != null ? device.getProductName().toString() : "UNKNOWN");
                                        wiredDevice.put("type", "USB_HEADSET");
                                        SylkLogger.d("[audio] Auto route to USB headset");
                                        switchAudioRoute(wiredDevice);
                                    } else {
                                        String typeName = getDeviceTypeName(device.getType());
                                        SylkLogger.d("[audio] Audio device: " + device.getId() + " Type: " + device.getType() + " " + typeName);
                                    }
                                }
                            }, 50);
                        }
                        break;
                }
            }
        };
    
        IntentFilter noisyFilter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        reactContext.registerReceiver(headsetReceiver, noisyFilter);
    
        // Bluetooth headset / ACL
        IntentFilter btFilter = new IntentFilter();
        btFilter.addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED);
        btFilter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        btFilter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        reactContext.registerReceiver(headsetReceiver, btFilter);
    
        // Wired headset
        IntentFilter wiredFilter = new IntentFilter(Intent.ACTION_HEADSET_PLUG);
        reactContext.registerReceiver(headsetReceiver, wiredFilter);
    
        // SCO audio
        IntentFilter scoFilter = new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
        reactContext.registerReceiver(headsetReceiver, scoFilter);
    
        //SylkLogger.d("[audio] Receivers registered successfully");
    }

    @ReactMethod
    public void getEvent() {
        sendReactNativeEvent();
    }

	@ReactMethod
	public void getAudioMode(Promise promise) {
		try {
			int mode = audioManager.getMode();
			promise.resolve(mode);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

	/**
	 * JS-friendly mode formatter. Returns the current AudioManager mode in
	 * "NAME(int)" form, e.g. "IN_COMMUNICATION(3)".
	 */
	@ReactMethod
	public void getAudioModeName(Promise promise) {
		try {
			promise.resolve(getAudioModeDescription(audioManager.getMode()));
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

	/**
	 * Tear down the Telecom Connection for a specific callId — used to plug
	 * the leak where in-app hangups don't go through any of the existing
	 * removal paths (SylkTelecom.endCall, SylkIncomingConnection.on*). JS
	 * should call this from its hangup/terminated path with the callId so
	 * that SylkTelecom.CONNECTIONS doesn't accumulate stale entries.
	 *
	 * Idempotent: SylkTelecom.endCall is a no-op when the callId isn't in
	 * the map. DisconnectCause.LOCAL is used because this represents the
	 * user-initiated hangup case (the only one not already covered).
	 */
	@ReactMethod
	public void cleanupTelecomConnection(String callId, Promise promise) {
		try {
			if (callId == null || callId.isEmpty()) {
				promise.resolve(false);
				return;
			}
			boolean present = SylkTelecom.CONNECTIONS.containsKey(callId);
			// [audio] cleanupTelecomConnection telemetry — disabled.
			// Re-enable when debugging Telecom connection lifecycle
			// (was useful to diagnose why setMode kept reverting to
			// IN_COMMUNICATION after a call ended).
			/*
			int sizeBefore = SylkTelecom.CONNECTIONS.size();
			SylkLogger.d("[audio] SYLK_APP cleanupTelecomConnection callId=" + callId
					+ " sizeBefore=" + sizeBefore
					+ " present=" + present);
			*/
			SylkTelecom.endCall(callId, DisconnectCause.LOCAL);
			/*
			int sizeAfter = SylkTelecom.CONNECTIONS.size();
			SylkLogger.d("[audio] SYLK_APP cleanupTelecomConnection callId=" + callId
					+ " sizeAfter=" + sizeAfter);
			*/
			promise.resolve(present);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

	/**
	 * Live snapshot of the SylkTelecom Connection map for JS inspection.
	 * Resolves to { size: int, keys: [callId, ...] }. Useful for confirming
	 * that hangup paths cleaned up the Connection (size should drop to 0
	 * shortly after a call ends).
	 */
	@ReactMethod
	public void getTelecomConnections(Promise promise) {
		try {
			com.facebook.react.bridge.WritableMap out = Arguments.createMap();
			out.putInt("size", SylkTelecom.CONNECTIONS.size());
			com.facebook.react.bridge.WritableArray keys = Arguments.createArray();
			for (String k : SylkTelecom.CONNECTIONS.keySet()) {
				keys.pushString(k);
			}
			out.putArray("keys", keys);
			promise.resolve(out);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

	/**
	 * Inspect the most recent mode transition seen by our passive
	 * OnModeChangedListener. Resolves to a map:
	 *   { mode: int, modeName: "NAME(int)", at: ms-since-epoch, caller: "thread | stack" }
	 * or null if no transition has been observed yet (or pre-API 31).
	 */
	@ReactMethod
	public void getLastModeChange(Promise promise) {
		try {
			if (lastObservedMode == AudioManager.MODE_INVALID
					|| lastObservedModeAt == 0L) {
				promise.resolve(null);
				return;
			}
			com.facebook.react.bridge.WritableMap out =
					Arguments.createMap();
			out.putInt("mode", lastObservedMode);
			out.putString("modeName", getAudioModeDescription(lastObservedMode));
			out.putDouble("at", (double) lastObservedModeAt);
			out.putString("caller", lastObservedModeCaller == null
					? "" : lastObservedModeCaller);
			promise.resolve(out);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}
	
	@ReactMethod
	public void setAudioMode(int mode, Promise promise) {
		try {
			audioManager.setMode(mode);
			promise.resolve(true);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

    @ReactMethod
    public void start(ReadableMap deviceMap, Promise promise) {
        if (started) return;
        started = true;
    
        SylkLogger.d("[audio] AudioRouteModule start");

        try {
            // Capture original audio state
            origAudioMode = audioManager.getMode();
            SylkLogger.d("[audio] Original audio mode: " + getAudioModeDescription(origAudioMode));

            // Set communication mode
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            SylkLogger.d("[audio] Audio mode switched to: IN_COMMUNICATION");

			acquireAudioFocus();

            sendReactNativeEvent();
    
            // Instantiate SCO manager if not yet created
            if (scoManager == null) {
                scoManager = new BluetoothScoManager(reactContext);

                // Fired when BT headset profile first connects (auto-route on headset plug-in)
                scoManager.setEventListener(() -> {
                    try {
                        List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                        for (AudioDeviceInfo device : devices) {
                            int deviceType = device.getType();
                            if (deviceType == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                                SylkLogger.d("[audio] auto route to BLUETOOTH_SCO");
                                Map<String, String> btDevice = new HashMap<>();
                                btDevice.put("id", String.valueOf(device.getId()));
                                btDevice.put("name", device.getProductName() != null
                                        ? device.getProductName().toString() : "UNKNOWN");
                                btDevice.put("type", "BLUETOOTH_SCO");
                                switchAudioRoute(btDevice);
                                break;
                            }
                        }
                    } catch (Exception e) {
                        SylkLogger.e("[audio] Error routing to BT device on headset connect", e);
                    }
                });

                // Fired when SCO audio channel is actually established (CONNECTED state).
                // If the user requested BT routing while SCO was still negotiating, apply
                // the pending route now that audio is ready.
                scoManager.setScoConnectedListener(() -> {
                    try {
                        if (pendingBtDevice != null) {
                            SylkLogger.d("[audio] SCO connected — applying pending BT route: " + pendingBtDevice);
                            Map<String, String> device = pendingBtDevice;
                            pendingBtDevice = null;
                            // Re-look up the device by type in case id changed
                            String targetType = device.get("type");
                            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                            for (AudioDeviceInfo d : devices) {
                                if (getDeviceTypeName(d.getType()).equals(targetType)) {
                                    boolean result = audioManager.setCommunicationDevice(d);
                                    // [audio] Pending BT setCommunicationDevice result — disabled.
                                    // Re-enable when debugging the deferred-BT-route path
                                    // (legacy SCO-then-route on API < 31).
                                    /*
                                    SylkLogger.d("[audio] Pending BT setCommunicationDevice result=" + result
                                        + " device=" + d.getId() + " " + d.getProductName());
                                    */
                                    sendReactNativeEvent();
                                    break;
                                }
                            }
                        } else {
                            // No pending manual selection — just notify JS so it can update the UI
                            sendReactNativeEvent();
                        }
                    } catch (Exception e) {
                        SylkLogger.e("[audio] Error applying pending BT route on SCO connected", e);
                    }
                });
            }
    
            // Start SCO if a BT SCO device is available
            boolean hasBtSco = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? hasBluetoothScoDeviceNew()
                    : audioManager.isBluetoothScoAvailableOffCall();
    
            if (hasBtSco && scoManager != null) {
                scoManager.startScoIfNeeded();
            }
    
            // --- Route switch (if provided) ---
            if (deviceMap != null && !deviceMap.toHashMap().isEmpty()) {
                Map<String, String> device = new HashMap<>();
                ReadableMapKeySetIterator iterator = deviceMap.keySetIterator();
                while (iterator.hasNextKey()) {
                    String key = iterator.nextKey();
                    try {
                        device.put(key, deviceMap.getString(key));
                    } catch (Exception e) {
                        SylkLogger.w("[audio] Skipping non-string value for key: " + key, e);
                    }
                }
                SylkLogger.d("[audio] Starting with device: " + device.toString());

                boolean switched = switchAudioRoute(device);
                if (!switched) {
                    SylkLogger.w("[audio] Failed to switch audio route to " + device.get("type"));
                }
            }
    
            promise.resolve(true);
    
        } catch (Exception e) {
            SylkLogger.e("[audio] Error starting audio route", e);
            promise.reject("ERROR", e);
        }
    }

    /**
     * Centralised "mode int → human name" helper. Public-static so other
     * native modules (e.g. MyFirebaseMessagingService) can format the mode
     * the same way our internal logs do, and so the value is available to
     * JS via {@link #getAudioModeName}. Returned as "NAME(int)" so logs
     * always carry both representations.
     */
    public static String getAudioModeDescription(int mode) {
        String name;
        switch (mode) {
            case AudioManager.MODE_NORMAL: name = "NORMAL"; break;
            case AudioManager.MODE_RINGTONE: name = "RINGTONE"; break;
            case AudioManager.MODE_IN_CALL: name = "IN_CALL"; break;
            case AudioManager.MODE_IN_COMMUNICATION: name = "IN_COMMUNICATION"; break;
            case AudioManager.MODE_CALL_SCREENING: name = "CALL_SCREENING"; break;
            default: name = "UNKNOWN"; break;
        }
        return name + "(" + mode + ")";
    }

    private String getDeviceTypeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "BUILTIN_EARPIECE";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "BUILTIN_SPEAKER";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "WIRED_HEADSET";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "WIRED_HEADPHONES";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB_HEADSET";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "BLUETOOTH_SCO";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "BLUETOOTH_A2DP";
            case AudioDeviceInfo.TYPE_TELEPHONY: return "TELEPHONY";
            case AudioDeviceInfo.TYPE_HEARING_AID: return "HEARING_AID";
            case AudioDeviceInfo.TYPE_AUX_LINE: return "AUX_LINE";
            case AudioDeviceInfo.TYPE_LINE_ANALOG: return "LINE_ANALOG";
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "USB_DEVICE";
            default: return "UNKNOWN (" + type + ")";
        }
    }

    private String headsetProfileStateToString(int state) {
        switch (state) {
            case BluetoothProfile.STATE_DISCONNECTED:
                return "DISCONNECTED";
            case BluetoothProfile.STATE_CONNECTING:
                return "CONNECTING";
            case BluetoothProfile.STATE_CONNECTED:
                return "CONNECTED";
            case BluetoothProfile.STATE_DISCONNECTING:
                return "DISCONNECTING";
            default:
                return "UNKNOWN(" + state + ")";
        }
    }

    private String scoStateToString(int state) {
        switch (state) {
            case AudioManager.SCO_AUDIO_STATE_DISCONNECTED:
                return "DISCONNECTED";
            case AudioManager.SCO_AUDIO_STATE_CONNECTED:
                return "CONNECTED";
            case AudioManager.SCO_AUDIO_STATE_CONNECTING:
                return "CONNECTING";
            case AudioManager.SCO_AUDIO_STATE_ERROR:
                return "ERROR";
            default:
                return "UNKNOWN(" + state + ")";
        }
    }

    private int getAudioDeviceTypeFromString(String type) {
        if (type == null) return -1;
    
        switch (type) {
            case "EARPIECE": return AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            case "BUILTIN_EARPIECE": return AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            case "BUILTIN_SPEAKER": return AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
            case "SPEAKER_PHONE": return AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
            case "WIRED_HEADSET": return AudioDeviceInfo.TYPE_WIRED_HEADSET;
            case "WIRED_HEADPHONES": return AudioDeviceInfo.TYPE_WIRED_HEADPHONES;
            case "USB_HEADSET": return AudioDeviceInfo.TYPE_USB_HEADSET;
            case "BLUETOOTH_SCO": return AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
            default: return -1;
        }
    }

    @ReactMethod
    public void stop(Promise promise) {
        if (!started) return;
        started = false;

        SylkLogger.d("[audio] AudioRouteModule stop");

        // Connection-leak observability. Log the live SylkTelecom Connection
        // count at stop entry (the "before") and again ~500ms later (the
        // "after"). If the count stays > 0 after the call has ended,
        // Telecom is still holding the Connection — that explains why
        // setMode below may be silently overridden back to IN_COMMUNICATION.
        // [audio] CONNECTIONS-size before/after-stop telemetry — disabled.
        // Re-enable when debugging Telecom holding ConnectionService refs
        // longer than expected (was useful to figure out why setMode below
        // was being silently overridden back to IN_COMMUNICATION).
        /*
        try {
            int beforeSize = SylkTelecom.CONNECTIONS.size();
            SylkLogger.d("[audio] SYLK_APP audio mode SylkTelecom.CONNECTIONS before stop: size="
                    + beforeSize + " keys=" + SylkTelecom.CONNECTIONS.keySet());
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                int afterSize = SylkTelecom.CONNECTIONS.size();
                int currentMode = audioManager.getMode();
                SylkLogger.d("[audio] SYLK_APP audio mode SylkTelecom.CONNECTIONS 500ms after stop: size="
                        + afterSize + " keys=" + SylkTelecom.CONNECTIONS.keySet()
                        + " modeNow=" + getAudioModeDescription(currentMode));
            }, 500);
        } catch (Throwable t) {
            SylkLogger.w("[audio] CONNECTIONS size logging failed", t);
        }
        */

        pendingBtDevice = null;
        // ALWAYS restore to MODE_NORMAL when a call ends.
        //
        // Previously we preferred preCallMode (the snapshot taken at FCM
        // push receipt, before Telecom polluted the mode) and fell back
        // to origAudioMode for outgoing calls. The fallback path was
        // fundamentally broken on devices where some earlier audio
        // component (WebRTC's JavaAudioDeviceModule, a leaked previous
        // call's lingering audio session, etc.) had already set the mode
        // to IN_COMMUNICATION before AudioRouteModule.start() captured
        // origAudioMode. In that case origAudioMode held IN_COMMUNICATION
        // and restoreAudioMode dutifully "restored" to IN_COMMUNICATION
        // — perpetuating the pollution call-after-call. The user
        // observed this on a Razr 60 Ultra: even immediately post-reboot
        // the very first conference start logged "Original audio mode:
        // IN_COMMUNICATION(3)" because libwebrtc had already flipped the
        // mode internally before the JS-side audioManagerStart() ran.
        //
        // MODE_NORMAL is the correct end-of-call state regardless of
        // what was happening before — MediaPlayer (chat-bubble audio
        // playback, ringtones, notification sounds) all expect it. The
        // ringtone path uses MODE_RINGTONE while a ringtone is actually
        // playing and reverts to NORMAL on its own; we don't need to
        // preserve a transient RINGTONE state across an end-of-call.
        //
        // preCallMode / origAudioMode are still captured at start() (for
        // diagnostic logging) but no longer consulted here. The whole
        // pollution-propagation problem is resolved at the source.
        int restoreTarget = AudioManager.MODE_NORMAL;
        audioManager.setMode(restoreTarget);
        SylkLogger.d("[audio] Audio mode restored to " + getAudioModeDescription(restoreTarget)
                + " (source=force-NORMAL; ignored origAudioMode="
                + getAudioModeDescription(origAudioMode)
                + ", preCallMode="
                + (preCallMode == -1 ? "none" : getAudioModeDescription(preCallMode))
                + ")");
        // Consume the FCM preCallMode snapshot so it doesn't survive
        // into the next call's restore. We don't use it but keeping the
        // sentinel honest avoids stale state if anyone re-introduces a
        // consumer of this field later.
        if (preCallMode != -1) {
            preCallMode = -1;
        }

        try {
            if (scoManager != null) {
                scoManager.stopScoIfActive();
                scoManager.release();  // unregister receiver and close proxy
                scoManager = null;
                //SylkLogger.d("[audio] Bluetooth SCO stopped and manager released");
            }
            promise.resolve(true);
        } catch (Exception e) {
            SylkLogger.e("[audio] Error stopping Bluetooth SCO", e);
            promise.reject("ERROR", e);
        }
    }

    private boolean isBluetoothConnected() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return false;
    
        int profileState = adapter.getProfileConnectionState(BluetoothProfile.HEADSET);
        
        boolean scoBool = audioManager.isBluetoothScoOn();
        int scoState = lastScoState; // or you can read EXTRA_SCO_AUDIO_STATE
    
        //SylkLogger.d("[audio] BT HEADSET profile state=" + headsetProfileStateToString(profileState));
        //SylkLogger.d("[audio] BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + scoBool + ")");
    
        return (profileState == BluetoothProfile.STATE_CONNECTED);
    }

    @ReactMethod
    public void setActiveDevice(ReadableMap deviceMap, Promise promise) {
        // Backwards-compat overload: no call uuid → AudioManager-only path.
        // The new callers pass a uuid via setActiveDeviceForCall so that we
        // can also update Telecom's audio route (see comment on imports).
        setActiveDeviceForCall(null, deviceMap, promise);
    }

    /**
     * Single native entry point that updates Telecom's audio route AND the
     * AudioManager communication device for the given call. Replaces the
     * previous JS-side pair of RNCallKeep.setAudioRoute() + setActiveDevice()
     * which raced against each other on Motorola/Razr (Telecom would land
     * after AudioManager and undo the route).
     *
     * Order matters: Telecom first (so the framework's route lock matches
     * what we're about to put on AudioManager), then setCommunicationDevice
     * for the concrete device. Both are synchronous from Telecom's
     * perspective by the time this method returns.
     *
     * callUuid may be null/empty to skip the Telecom step (e.g. routing
     * outside of a call, or for WIRED_HEADSET where there is no Telecom
     * route name at all).
     */
    @ReactMethod
    public void setActiveDeviceForCall(String callUuid, ReadableMap deviceMap, Promise promise) {
        try {
            if (deviceMap == null) {
                promise.reject("ERROR", "No device provided");
                return;
            }

            Map<String, String> device = new HashMap<>();
            ReadableMapKeySetIterator iterator = deviceMap.keySetIterator();
            while (iterator.hasNextKey()) {
                String key = iterator.nextKey();
                device.put(key, deviceMap.getString(key));
            }

            String type = device.get("type");
            SylkLogger.d("[audio] setActiveDeviceForCall callUuid=" + callUuid + " device=" + device);

            // 1. Tell Telecom which route the call is on. Skipping this leaves
            //    Telecom on its previous route and the framework will overwrite
            //    AudioManager again within a tick. No-op if uuid is missing or
            //    no Connection is registered for it (e.g. WIRED_HEADSET path).
            if (callUuid != null && !callUuid.isEmpty()) {
                applyTelecomAudioRoute(callUuid, type);
            }

            // 2. Land the concrete device on AudioManager.
            boolean switched = switchAudioRoute(device);

            if (switched) {
                promise.resolve(true);
            } else {
                promise.reject("ERROR", "Requested audio device not available: " + type);
            }

        } catch (Exception e) {
            SylkLogger.e("[audio] setActiveDeviceForCall ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    /**
     * Look up the {@link Connection} registered with Telecom for this call
     * (RNCallKeep's VoiceConnectionService for outgoing calls; SylkTelecom's
     * own ConnectionService for FCM-driven incoming calls) and call
     * {@link Connection#setAudioRoute(int)} with the matching CallAudioState
     * route mask. Errors and missing-connection cases are logged and swallowed
     * — the AudioManager step still runs after this returns.
     */
    private void applyTelecomAudioRoute(String callUuid, String type) {
        if (type == null) return;
        int route;
        if (type.equals("BUILTIN_SPEAKER")) {
            route = CallAudioState.ROUTE_SPEAKER;
        } else if (type.equals("BUILTIN_EARPIECE")) {
            route = CallAudioState.ROUTE_EARPIECE;
        } else if (type.equals("BLUETOOTH_SCO") || type.equals("BLUETOOTH_A2DP")) {
            route = CallAudioState.ROUTE_BLUETOOTH;
        } else if (type.equals("WIRED_HEADSET") || type.equals("USB_HEADSET")) {
            route = CallAudioState.ROUTE_WIRED_HEADSET;
        } else {
            SylkLogger.d("[audio] applyTelecomAudioRoute: no Telecom route mapping for type=" + type);
            return;
        }

        Connection conn = null;
        // Prefer RNCallKeep's VoiceConnectionService (covers outgoing calls and
        // most incoming calls handled through the JS app).
        try {
            conn = io.wazo.callkeep.VoiceConnectionService.getConnection(callUuid);
        } catch (Throwable t) {
            // Class may not be on the classpath in some build variants; fine.
            SylkLogger.d("[audio] applyTelecomAudioRoute: VoiceConnectionService lookup threw: " + t);
        }
        // Fall back to SylkTelecom's own self-managed connection (used for
        // FCM-presented incoming calls before JS has a chance to take over).
        if (conn == null) {
            conn = SylkTelecom.CONNECTIONS.get(callUuid);
        }

        if (conn == null) {
            SylkLogger.d("[audio] applyTelecomAudioRoute: no Connection registered for uuid=" + callUuid);
            return;
        }

        try {
            conn.setAudioRoute(route);
            SylkLogger.d("[audio] applyTelecomAudioRoute uuid=" + callUuid + " type=" + type + " route=0x" + Integer.toHexString(route));
        } catch (Exception e) {
            SylkLogger.w("[audio] applyTelecomAudioRoute failed", e);
        }
    }

    private void logWritableArray(String label, WritableArray array) {
        StringBuilder sb = new StringBuilder();
        sb.append(label).append(": [");
    
        for (int i = 0; i < array.size(); i++) {
            // assuming your "routes" array contains strings
            sb.append(array.getString(i));
    
            if (i < array.size() - 1) {
                sb.append(", ");
            }
        }
    
        sb.append("]");
    
        SylkLogger.d("[audio]" + sb.toString());
    }
    
    private void sendReactNativeEvent() {
        try {
            if (!reactContext.hasActiveCatalystInstance()) {
                //SylkLogger.w("[audio] React context not active; skipping emit");
                return;
            }

            WritableMap event = Arguments.createMap();

            WritableArray inputs = getAudioInputs();
            WritableArray outputs = getAudioOutputs();
            Map<String, String> selectedInfo = getCurrentRouteInfo();

            String selectedType = selectedInfo.get("type");
            WritableMap selectedMap = Arguments.createMap();

            for (Map.Entry<String, String> entry : selectedInfo.entrySet()) {
                selectedMap.putString(entry.getKey(), entry.getValue());
            }

            int mode = audioManager.getMode();

            // [AudioDiag] Build the type-list strings BEFORE event.putArray() below —
            // putArray() transfers ownership of the WritableArray to the event, after
            // which outputs.size()/getMap() return 0/null and the log would show
            // "outputs=[]". Snapshot the types here while the arrays are still ours.
            StringBuilder outTypes = new StringBuilder();
            for (int i = 0; i < outputs.size(); i++) {
                if (i > 0) outTypes.append(",");
                ReadableMap m = outputs.getMap(i);
                outTypes.append(m != null ? m.getString("type") : "null");
            }
            StringBuilder inTypes = new StringBuilder();
            for (int i = 0; i < inputs.size(); i++) {
                if (i > 0) inTypes.append(",");
                ReadableMap m = inputs.getMap(i);
                inTypes.append(m != null ? m.getString("type") : "null");
            }
            // Display context — on Razr-style flip phones the app can migrate to
            // the cover display when folded closed. Log the active display so we
            // can spot that in the [AudioDiag] stream even without a fold event.
            String displayDesc = "null";
            try {
                Activity act = getCurrentActivity();
                if (act != null) {
                    Display d = act.getWindowManager().getDefaultDisplay();
                    if (d != null) {
                        displayDesc = d.getDisplayId() + "(" + d.getName() + ")";
                    }
                }
            } catch (Throwable ignored) { /* best-effort */ }

            String hingeDesc = Float.isNaN(lastHingeAngle)
                    ? "NA"
                    : String.format("%.1f", lastHingeAngle);

            // [AudioDiag] emit one-liner — disabled. Re-enable by
            // uncommenting if you need to debug fold/route transitions
            // again. Kept around because reproducing the foldable HAL
            // state without it is painful.
            /*
            SylkLogger.d("[audio] [AudioDiag] emit"
                    + " mode=" + getAudioModeDescription(mode)
                    + " selected=" + (selectedType != null ? selectedType : "NONE")
                    + "(" + (selectedInfo.get("name") != null ? selectedInfo.get("name") : "-") + ")"
                    + " currentRoute=" + (currentRoute != null ? currentRoute : "null")
                    + " outputs=[" + outTypes + "]"
                    + " inputs=[" + inTypes + "]"
                    + " scoOn=" + audioManager.isBluetoothScoOn()
                    + " speakerOn=" + audioManager.isSpeakerphoneOn()
                    + " fold=" + lastFoldState + "/" + lastFoldOrientation
                    + " hinge=" + hingeDesc
                    + " folded=" + lastIsFolded
                    + " display=" + displayDesc);
            */

            // Always send all available output devices so the UI can show the full
            // device list regardless of which device is currently selected.
            // (The previous BT-only filter was hiding earpiece/speaker when BT was active.)
            event.putArray("inputs", inputs);
            event.putArray("outputs", outputs);
            event.putMap("selected", selectedMap);
            event.putString("mode", getAudioModeDescription(mode));
            event.putBoolean("folded", lastIsFolded);

            //SylkLogger.d("[audio] --- AudioDevicesChanged payload ---");
            //logWritableArray("Inputs", inputs);
            //logWritableArray("Outputs", outputs);
            //SylkLogger.d("[audio] Current: " + currentRoute + ", SCO: " + scoState + ", Available: " + availableList);
    
            // Emit event
            reactContext.runOnUiQueueThread(() -> {
                try {
                    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("CommunicationsDevicesChanged", event);
                    //SylkLogger.w("[audio] RN event emitted");

                } catch (Exception e) {
                    SylkLogger.e("[audio] Emit failed", e);
                }
            });
    
        } catch (Exception e) {
            SylkLogger.e("[audio] sendReactNativeEvent ERROR", e);
        }
    }

    @ReactMethod
    public void getCurrentRoute(Promise promise) {
        try {
            Map<String, String> info = getCurrentRouteInfo();
    
            WritableMap map = Arguments.createMap();
    
            for (Map.Entry<String, String> entry : info.entrySet()) {
                map.putString(entry.getKey(), entry.getValue());
            }
    
            promise.resolve(map);
        } catch (Exception e) {
            SylkLogger.e("[audio] getCurrentRoute ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    /**
     * Internal helper to switch audio route without needing a Promise.
     * Accepts a device object (Map<String, String>) instead of a string route.
     */
    private boolean switchAudioRoute(Map<String, String> deviceMap) {
        if (deviceMap == null) return false;
    
        String targetType = deviceMap.get("type");        
        if (currentRoute == null ? targetType == null : currentRoute.equals(targetType)) {
            return true;
        }        

        //SylkLogger.d("[audio] switchAudioRoute from " + currentRoute + " -> " + targetType);
        
        // No SCO active, switch immediately
        return switchAudioRouteInternal(deviceMap);
    }
    
    private boolean switchAudioRouteInternal(Map<String, String> deviceMap) {
        if (deviceMap == null) return false;
    
        // Add this check at the top:
		if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
			SylkLogger.w("[audio] Audio mode was reset, restoring MODE_IN_COMMUNICATION");
			audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
		}
    
        String type = deviceMap.get("type");
        String idStr = deviceMap.get("id");
        SylkLogger.d("[audio] Switch audio route to audio device: " + deviceMap);
    
        try {
            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
            AudioDeviceInfo selectedDevice = null;
    
            int deviceId = -1;
            try {
                deviceId = Integer.parseInt(idStr);
            } catch (Exception ignored) {}
    
            for (AudioDeviceInfo device : devices) {
                // Match by ID if possible
                if (device.getId() == deviceId) {
                    selectedDevice = device;
                    break;
                }
    
                // Otherwise match by type
                if (device.getType() == getAudioDeviceTypeFromString(type)) {
                    selectedDevice = device;
                    break;
                }
            }
    
            if (selectedDevice != null) {
                // Update currentRoute for logging/state
                currentRoute = type;

				//audioManager.clearCommunicationDevice();


				if (type != null && type.equals("BUILTIN_SPEAKER")) {
					// Stop BT SCO before activating speaker. When SCO is active, BT takes
					// priority over speaker in the HAL and both setCommunicationDevice(SPEAKER)
					// and setSpeakerphoneOn() will be ignored. clearCommunicationDevice() +
					// stopScoIfActive() removes BT from the audio path first.
					pendingBtDevice = null;
					if (scoManager != null) {
						scoManager.stopScoIfActive();
					}
					audioManager.clearCommunicationDevice();

					if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
						// Try the modern API first.
						SylkLogger.d("[audio] Switching to BUILTIN_SPEAKER via setCommunicationDevice (API 31+)");
						boolean result = audioManager.setCommunicationDevice(selectedDevice);
						AudioDeviceInfo actual = audioManager.getCommunicationDevice();
						int actualId = actual != null ? actual.getId() : -1;
						SylkLogger.d("[audio] setCommunicationDevice(BUILTIN_SPEAKER) result=" + result
							+ " communicationDevice=" + actualId);

						// On Motorola RAZR (and similar OEMs) setCommunicationDevice returns true
						// but getCommunicationDevice() still reports earpiece — the HAL silently
						// ignores the request. Detect this and fall through to the MODE_NORMAL
						// workaround path.
						if (result && actualId == selectedDevice.getId()) {
							currentRoute = type;
							return true;
						}
						SylkLogger.w("[audio] setCommunicationDevice did not take effect (OEM override), "
							+ "falling back to MODE_NORMAL + setSpeakerphoneOn");
					}
					// Workaround for Motorola RAZR 60 (and similar OEMs) where the audio HAL
					// locks MODE_IN_COMMUNICATION and ignores both setCommunicationDevice(SPEAKER)
					// and setMode(MODE_NORMAL). Steps:
					//   1. clearCommunicationDevice() — release the HAL's routing lock
					//   2. setMode(MODE_IN_CALL) — native telephony mode; Motorola honors
					//      setSpeakerphoneOn here but not in MODE_IN_COMMUNICATION
					//   3. setSpeakerphoneOn(true)
					// We do NOT switch back to IN_COMMUNICATION while speaker is active.
					// The earpiece path below restores IN_COMMUNICATION when speaker is deselected.
					SylkLogger.d("[audio] Forcing speaker: clearCommunicationDevice + MODE_IN_CALL + setSpeakerphoneOn(true)");
					audioManager.clearCommunicationDevice();
					audioManager.setMode(AudioManager.MODE_IN_CALL);
					audioManager.setSpeakerphoneOn(true);
					SylkLogger.d("[audio] isSpeakerphoneOn=" + audioManager.isSpeakerphoneOn()
						+ " mode=" + getAudioModeDescription(audioManager.getMode()));
					currentRoute = type;
					return true;
				} else if (type != null && type.startsWith("BLUETOOTH")) {
					// BT routing: do NOT call clearCommunicationDevice() here —
					// clearing the routing context before SCO establishment prevents
					// the system from establishing SCO on Motorola and similar devices.
					SylkLogger.d("[audio] Routing to BT, disabling speakerphone");
					audioManager.setSpeakerphoneOn(false);
					audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

					if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
						// API 31+: setCommunicationDevice() triggers SCO establishment
						// automatically — no need to call startBluetoothSco() separately.
						// OnCommunicationDeviceChangedListener fires when routing completes.
						pendingBtDevice = null;
						boolean result = audioManager.setCommunicationDevice(selectedDevice);
						// [audio] BT setCommunicationDevice telemetry — disabled.
						// Three near-identical lines along the BT route paths
						// (API 31+, legacy SCO connected, legacy SCO non-existent).
						// Re-enable when debugging Razr/SCO race conditions.
						/*
						SylkLogger.d("[audio] BT setCommunicationDevice result=" + result
							+ " device=" + selectedDevice.getId() + " " + selectedDevice.getProductName());
						*/
						return result;
					}

					// API < 31: legacy SCO path
					if (scoManager != null) {
						if (lastScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
							// [audio] SCO already connected — disabled
							//SylkLogger.d("[audio] SCO already connected, routing directly to BT");
							pendingBtDevice = null;
							boolean result = audioManager.setCommunicationDevice(selectedDevice);
							//SylkLogger.d("[audio] BT setCommunicationDevice result=" + result);
							return result;
						} else {
							// [audio] SCO not connected, deferring BT route — disabled
							//SylkLogger.d("[audio] SCO not connected, starting legacy SCO and deferring BT route");
							audioManager.setCommunicationDevice(selectedDevice);
							pendingBtDevice = new HashMap<>(deviceMap);
							scoManager.startScoIfNeeded();
							return true;
						}
					}
					boolean result = audioManager.setCommunicationDevice(selectedDevice);
					//SylkLogger.d("[audio] BT setCommunicationDevice result=" + result);
					return result;

				} else {
					// Earpiece, wired headset, etc.
					// clearCommunicationDevice() releases the HAL speaker lock so that
					// the subsequent setCommunicationDevice(earpiece/wired) takes effect.
                    // [audio] earpiece/wired switch trace — disabled.
                    // Re-enable when debugging the HAL speaker-lock release that
                    // makes setCommunicationDevice(earpiece/wired) actually take.
                    //SylkLogger.d("[audio] setSpeakerphoneOff + clearCommunicationDevice, restoring MODE_IN_COMMUNICATION");
					audioManager.setSpeakerphoneOn(false);
					audioManager.clearCommunicationDevice();
					audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
				}

                boolean result = audioManager.setCommunicationDevice(selectedDevice);

                if (result) {
                    // [audio] success-trace — disabled. The eventual
                    // OnCommunicationDeviceChangedListener emits a deduped
                    // "[audio] Communication device changed to ..." line that
                    // covers the same signal without firing for failed attempts.
                    //SylkLogger.d("[audio] requested change to " + selectedDevice.getId() + " " + selectedDevice.getProductName() + " " + type + " " + getAudioDeviceTypeFromString(type));
                } else {
                    // KEEP: actual failure to switch is genuinely actionable.
                    SylkLogger.d("[audio] setCommunicationDevice failed to switch");
                }

                return result;
            } else {
                SylkLogger.d("[audio] No matching AudioDeviceInfo found for device: " + deviceMap);
                return false;
            }
    
        } catch (Exception e) {
            SylkLogger.e("[audio] switchAudioRouteInternal ERROR", e);
            return false;
        }
    }

	private void reapplyCurrentRoute() {
		List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
		for (AudioDeviceInfo device : devices) {
			if (getDeviceTypeName(device.getType()).equals(currentRoute)) {
				audioManager.setCommunicationDevice(device);
				SylkLogger.d("[audio] Re-applied route to " + currentRoute);
				return;
			}
		}
	}

    private Map<String, String> getCurrentRouteInfo() {
        Map<String, String> info = new HashMap<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { // Android 12+
            AudioDeviceInfo device = audioManager.getCommunicationDevice();

            if (device != null) {
                String typeName = getDeviceTypeName(device.getType());
                String productName = device.getProductName() != null
                        ? device.getProductName().toString()
                        : "UNKNOWN";

                String deviceId = String.valueOf(device.getId());

                info.put("name", productName);
                info.put("id", deviceId);
                info.put("type", typeName);
                currentRoute = typeName;
                SylkLogger.d("[audio] Current device: " + deviceId + " " + productName + " " + typeName);
                return info;
            }

            // [AudioDiag] getCommunicationDevice() returned null on Android 12+.
            // This is the signal that the UI will show no checkmark next to any
            // device. On Motorola Razr (folded) and similar OEMs the HAL can force
            // a route (e.g. speaker) without updating the CommunicationDevice.
            // Log the mode and a few quick HAL flags so we can reason about what
            // the system actually thinks the route is.
            // [AudioDiag] HAL probe — disabled. Re-enable to surface
            // the OEM HAL state when getCommunicationDevice returns
            // null on Razr-style foldables.
            /*
            SylkLogger.w("[audio] [AudioDiag] getCommunicationDevice()=null"
                    + " mode=" + getAudioModeDescription(audioManager.getMode())
                    + " speakerOn=" + audioManager.isSpeakerphoneOn()
                    + " scoOn=" + audioManager.isBluetoothScoOn()
                    + " wiredHeadsetOn=" + audioManager.isWiredHeadsetOn()
                    + " currentRouteCached=" + (currentRoute != null ? currentRoute : "null"));
            */
        }

        // No device routed
        return info;
    }

    @ReactMethod
    public void getAudioInputs(Promise promise) {
        //SylkLogger.e("[audio] getAudioInputs");
        try {
            WritableArray inputs = getAudioInputs();
            promise.resolve(inputs);
        } catch (Exception e) {
            SylkLogger.e("[audio] getAudioInputs ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    @ReactMethod
    public void getAudioOutputs(Promise promise) {
        //SylkLogger.e("[audio] getAudioOutputs");
        try {
            WritableArray outputs = getAudioOutputs();
            promise.resolve(outputs);
        } catch (Exception e) {
            SylkLogger.e("[audio] getAudioInputs ERROR", e);
            promise.reject("ERROR", e);
        }
    }
    
    private WritableArray getAudioInputs() {
        WritableArray inputsArray = Arguments.createArray();
    
        // --- INPUTS ---
        AudioDeviceInfo[] inputs = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS);
        Set<String> seenInputNames = new HashSet<>();
        
        for (AudioDeviceInfo device : inputs) {
            String typeName;
            String productName = device.getProductName() != null
                    ? device.getProductName().toString()
                    : "UNKNOWN";
    
            //SylkLogger.d("[audio] Input Device: " + device.getType() + ", Name: " + productName + ", ID: " + device.getId());

            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_BUILTIN_MIC: typeName = "BUILTIN_MIC"; break;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET: typeName = "WIRED_HEADSET"; break;
                case AudioDeviceInfo.TYPE_USB_HEADSET: typeName = "USB_HEADSET"; break;
                case AudioDeviceInfo.TYPE_AUX_LINE: typeName = "AUX_LINE"; break;
                case AudioDeviceInfo.TYPE_LINE_ANALOG: typeName = "LINE_ANALOG"; break;
                default: continue; // skip unknowns
            }
    
            WritableMap inputDevice = Arguments.createMap();
            inputDevice.putString("type", typeName);
            inputDevice.putString("name", productName);
            inputDevice.putString("id", String.valueOf(device.getId())); // <-- added device ID
    
            inputsArray.pushMap(inputDevice);
    
            // [audio] per-device enumeration line — disabled. Re-enable
            // when debugging which Input Devices the HAL is reporting.
            //SylkLogger.d("[audio] Input Device: " + typeName + ", Name: " + productName + ", ID: " + device.getId());
        }
    
        return inputsArray;
    }

    private boolean isKnownOutputType(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_HDMI:
                return true;
    
            default:
                return false; // skip unknowns
        }
    }

    private WritableArray getAudioOutputs() {
        WritableArray outputsArray = Arguments.createArray();
    
        AudioDeviceInfo[] outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
    
        for (AudioDeviceInfo device : outputs) {
            int type = device.getType();
    
            // Skip Bluetooth A2DP (same as original)
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) continue;
    
            // Skip unknowns — keep same behavior as getAudioInputs()
            if (!isKnownOutputType(type)) continue;
    
            String productName = device.getProductName() != null
                    ? device.getProductName().toString()
                    : "UNKNOWN";
    
            WritableMap outputDevice = Arguments.createMap();
            outputDevice.putString("type", getDeviceTypeName(type));
            outputDevice.putString("name", productName);
            outputDevice.putString("id", String.valueOf(device.getId())); // <-- added device ID
    
            outputsArray.pushMap(outputDevice);
    
            // [audio] per-device enumeration line — disabled. Re-enable
            // when debugging which Output Devices the HAL is reporting.
            //SylkLogger.d("[audio] Output Device: " + getDeviceTypeName(type) + ", Name: " + productName + ", ID: " + device.getId());
        }
    
        return outputsArray;
    }
    
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        if (headsetReceiver != null) {
            reactContext.unregisterReceiver(headsetReceiver);
            headsetReceiver = null;
        }
        stopFoldObserver();
        stopHingeSensor();
        sensorManager = null;
        try {
            reactContext.removeLifecycleEventListener(this);
        } catch (Throwable ignored) { /* best-effort */ }
    }
}

