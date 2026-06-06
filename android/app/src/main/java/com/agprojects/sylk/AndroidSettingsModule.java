package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.app.NotificationManager;
import android.content.Context;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class AndroidSettingsModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;

    AndroidSettingsModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "AndroidSettings";
    }

    @ReactMethod
    public void openDndAccessSettings() {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(intent);
    }

    // Resolves true when the OS has granted notification-policy (DND /
    // "Modes" / Priority modes) access. Implemented as a Promise rather
    // than a plain value-returning @ReactMethod: the RN bridge ignores
    // return values from a normal @ReactMethod, so the previous boolean
    // signature always resolved to `undefined` on the JS side — making
    // the app believe access was never granted. Mirrors isOsDndOn below.
    @ReactMethod
    public void hasDndAccess(Promise promise) {
        try {
            NotificationManager nm =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            promise.resolve(nm != null && nm.isNotificationPolicyAccessGranted());
        } catch (Throwable t) {
            promise.resolve(false);
        }
    }

    // True when the system Do Not Disturb interruption filter is anything
    // other than INTERRUPTION_FILTER_ALL. Used by the JS incoming-call
    // handler (incomingCallFromWebSocket) to drop a WSS-delivered call
    // before SDP / ICE warmup so the NavBar never shows "Collecting ICE
    // candidates…" while the device is in DND. Mirrors
    // MyFirebaseMessagingService.isDndEnabled(), which gates FCM-delivered
    // pushes the same way. Fails open (resolves false) if the OS hasn't
    // granted notification-policy access — same safe fallback the native
    // path uses.
    @ReactMethod
    public void isOsDndOn(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(false);
                return;
            }
            NotificationManager nm =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !nm.isNotificationPolicyAccessGranted()) {
                promise.resolve(false);
                return;
            }
            int filter = nm.getCurrentInterruptionFilter();
            promise.resolve(filter != NotificationManager.INTERRUPTION_FILTER_ALL
                    && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN);
        } catch (Throwable t) {
            promise.resolve(false);
        }
    }
}
