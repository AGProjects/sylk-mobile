package com.agprojects.sylk;

import android.util.Log;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class CallEventModule extends ReactContextBaseJavaModule {

    private static final String LOG_TAG = "[SYLK CALL EVENT]";

    // Last queued event (single-shot)
    private static WritableMap lastEvent = null;

    // JS readiness flag
    private static boolean rnReady = false;

    public CallEventModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "CallEventModule";
    }

    /**
     * Called by native code (ReactEventEmitter)
     */
    public static synchronized void setLastEvent(WritableMap event) {
        lastEvent = event;
        Log.d(LOG_TAG, "Event stored for when RN is listening for events");
    }

    /**
     * Called from JS AFTER listeners are registered
     */
    @ReactMethod
    public synchronized void markRNready() {
        rnReady = true;
        Log.d(LOG_TAG, "RN is now listening for events");

        // If an event arrived early, emit it now
        emitStoredEvent();
    }

    /**
     * Pull-based API (kept for compatibility)
     */
    @ReactMethod
    public synchronized void getLastCallEvent(com.facebook.react.bridge.Promise promise) {
        if (lastEvent != null) {
            promise.resolve(lastEvent);
            lastEvent = null; // consume once
        } else {
            promise.resolve(null);
        }
    }

    /**
     * Used by ReactEventEmitter to decide whether push is safe
     */
    public static synchronized boolean isRNready() {
        return rnReady;
    }

    /**
     * Emits queued event if possible
     */
    private synchronized void emitStoredEvent() {
        if (!rnReady || lastEvent == null) return;

        try {
            getReactApplicationContext()
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("IncomingCallAction", lastEvent);

            Log.d(LOG_TAG, "Queued event emitted to RN");
            lastEvent = null;

        } catch (Exception e) {
            Log.e(LOG_TAG, "Failed to emit queued event to RN", e);
        }
    }
}
