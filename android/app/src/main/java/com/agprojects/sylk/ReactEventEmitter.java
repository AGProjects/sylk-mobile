package com.agprojects.sylk;

import android.util.Log;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.agprojects.sylk.CallEventModule;

public class ReactEventEmitter {

    private static final String LOG_TAG = "[SYLK REACT EMITT]";

    public static synchronized void sendEventToReact(
            String action,
            String callUUID,
            String fromUri,
            String toUri,
            boolean phoneLocked,
            String event,
            ReactApplication app
    ) {
        try {
            ReactInstanceManager rim =
                app.getReactNativeHost().getReactInstanceManager();
            ReactContext rc = rim.getCurrentReactContext();

            WritableMap payload = Arguments.createMap();
            payload.putString("callUUID", callUUID);
            payload.putString("fromUri", fromUri);
            payload.putString("toUri", toUri);
            payload.putString("action", action);
            payload.putString("event", event);
            payload.putBoolean("phoneLocked", phoneLocked);

            Log.d(LOG_TAG, "action " + action);
            Log.d(LOG_TAG, "event " + event);

			if (rc != null && CallEventModule.isRNready()) {
                Log.d(LOG_TAG, "RN ready → event emitted");
                emit(rc, payload);
            } else {
				CallEventModule.setLastEvent(payload);
				Log.w(LOG_TAG, "RN not ready → event stored for pull");
            }

        } catch (Exception e) {
            Log.e(LOG_TAG, "Error sending RN event", e);
        }
    }

    private static void emit(ReactContext rc, WritableMap payload) {
        rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("IncomingCallAction", payload);
    }

}
