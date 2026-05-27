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

    private static final String LOG_TAG = "SYLK_APP";

    public static synchronized void sendEventToReact(
            String action,
            String callUUID,
            String fromUri,
            String toUri,
            boolean phoneLocked,
            String event,
            ReactApplication app
    ) {
        sendEventToReact(action, callUUID, fromUri, toUri, phoneLocked, event, null, app);
    }

    /**
     * Variant that also carries the raw SIP-level display name from the push
     * payload (FCM "from_display_name"). This is the display name the
     * remote party put in their SIP From header, before any local
     * contact-name resolution. JS uses it to seed a missing/URI-equal
     * contact name on the matched contact.
     */
    public static synchronized void sendEventToReact(
            String action,
            String callUUID,
            String fromUri,
            String toUri,
            boolean phoneLocked,
            String event,
            String fromDisplayName,
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
            if (fromDisplayName != null) {
                payload.putString("fromDisplayName", fromDisplayName);
            }

            SylkLogger.d("[bridge] [event] action " + action);
            SylkLogger.d("[bridge] [event] event " + event);

			if (rc != null && CallEventModule.isRNready()) {
                SylkLogger.d("[bridge] [event] RN ready → event emitted");
                emit(rc, payload);
            } else {
				CallEventModule.setLastEvent(payload);
				SylkLogger.w("[bridge] [event] RN not ready → event stored for pull");
            }

        } catch (Exception e) {
            SylkLogger.e("[bridge] [event] Error sending RN event", e);
        }
    }

    private static void emit(ReactContext rc, WritableMap payload) {
        rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("IncomingCallAction", payload);
    }

    /**
     * Wake-the-app-early signal fired from MyFirebaseMessagingService the
     * moment an incoming_session or incoming_conference_request FCM push
     * is recognised. Carries the minimal info JS needs to start prep
     * work (WSS reconnect / handleRegistration kick) BEFORE the user
     * presses Accept.
     *
     * Without this, on Android the JS thread doesn't process the FCM
     * data push until the user taps Accept (~3 s gap visible in
     * metro.log as "FCM in-app event: incoming call" lagging behind
     * the native "[fcm]incoming_session" line). During that gap, the
     * OS may have suspended the WSS connection, and the device's
     * acceptCall then arrives at sylk-server AFTER sylk-server has
     * already sent 480 Temporarily Unavailable to the caller in
     * response to the WebSocket close it saw on its side.
     *
     * The fix: ping JS immediately on FCM arrival. JS handler runs
     * scheduleBackToForeground / handleRegistration, the WSS
     * reconnect overlaps the ringing window, and by the time the user
     * taps Accept the device is registered and the acceptCall reaches
     * sylk-server before the gateway times out / tears down.
     *
     * If RN isn't running at all (truly cold process), nothing is
     * emitted — the existing ACTION_ACCEPT path still wakes the
     * activity on tap. This event is a pure latency optimisation, not
     * a correctness requirement.
     */
    public static synchronized void sendCallPrepEvent(
            String callUUID,
            String fromUri,
            String toUri,
            String event,
            ReactApplication app
    ) {
        try {
            ReactInstanceManager rim =
                app.getReactNativeHost().getReactInstanceManager();
            ReactContext rc = rim.getCurrentReactContext();

            // No fallback to setLastEvent / drained pull: the prep
            // event is opportunistic. If RN isn't ready, JS will
            // wake up via the normal accept path and do its work
            // then (it'll just be slower for this one call). We
            // don't want a stored prep payload bleeding into a
            // future cold start.
            if (rc == null || !CallEventModule.isRNready()) {
                SylkLogger.d("[bridge] [event] RN not ready → prep event dropped (callId=" + callUUID + ")");
                return;
            }

            WritableMap payload = Arguments.createMap();
            payload.putString("callUUID", callUUID);
            if (fromUri != null) payload.putString("fromUri", fromUri);
            if (toUri != null)   payload.putString("toUri", toUri);
            if (event != null)   payload.putString("event", event);

            SylkLogger.d("[bridge] [event] prep emit callId=" + callUUID
                    + " from=" + fromUri + " event=" + event);
            rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
              .emit("IncomingCallPrep", payload);
        } catch (Exception e) {
            SylkLogger.e("[bridge] [event] Error sending RN prep event", e);
        }
    }

}
