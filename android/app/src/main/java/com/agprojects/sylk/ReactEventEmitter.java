package com.agprojects.sylk;

import android.util.Log;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.Queue;
import java.util.LinkedList;
import android.os.Handler;
import android.os.Looper;

public class ReactEventEmitter {

    private static final String LOG_TAG = "[SYLK REACT EMITT]";
    private static final Queue<WritableMap> pendingEvents = new LinkedList<>();

    // Add phoneLocked as argument
    public static void sendEventToReact(String action, String callUUID,  String fromUri, boolean phoneLocked, ReactApplication app) {
        try {
            ReactInstanceManager reactInstanceManager = app.getReactNativeHost().getReactInstanceManager();
            ReactContext reactContext = reactInstanceManager.getCurrentReactContext();

            WritableMap payload = Arguments.createMap();
            payload.putString("callUUID", callUUID);
            payload.putString("fromUri", fromUri);
            payload.putString("action", action);
            payload.putBoolean("phoneLocked", phoneLocked);

            if (reactContext != null) {
                flushPendingEvents(reactContext);
				new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
					reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
							.emit("IncomingCallAction", payload);
					Log.d(LOG_TAG, "RN event sent: " + action + " -> " + callUUID + " locked=" + phoneLocked);
				}, 200); // 200ms delay
            } else {
                pendingEvents.add(payload);
                Log.w(LOG_TAG, "RN not ready, event queued: " + action + " -> " + callUUID);
                if (!reactInstanceManager.hasStartedCreatingInitialContext()) {
                    reactInstanceManager.createReactContextInBackground();
                }

                reactInstanceManager.addReactInstanceEventListener(new ReactInstanceManager.ReactInstanceEventListener() {
                    @Override
                    public void onReactContextInitialized(ReactContext context) {
                        flushPendingEvents(context);
                        reactInstanceManager.removeReactInstanceEventListener(this);
                    }
                });

                // Optional: delayed retry
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    ReactContext retryContext = reactInstanceManager.getCurrentReactContext();
                    if (retryContext != null) {
                        Log.d(LOG_TAG, "RN became ready, flushing queued events after delay");
                        flushPendingEvents(retryContext);
                    }
                }, 200);
            }

        } catch (Exception e) {
            Log.e(LOG_TAG, "Error sending RN event", e);
        }
    }

    private static void flushPendingEvents(ReactContext reactContext) {
        while (!pendingEvents.isEmpty()) {
            WritableMap pending = pendingEvents.poll();
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("IncomingCallAction", pending);
        }
    }
}
