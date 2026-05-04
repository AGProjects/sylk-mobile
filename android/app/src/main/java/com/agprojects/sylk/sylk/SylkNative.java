package com.agprojects.sylk.sylk;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import android.telecom.DisconnectCause;

import android.app.Activity;

import com.agprojects.sylk.SylkTelecom;

public class SylkNative extends ReactContextBaseJavaModule {
    private static ReactApplicationContext reactContext;
    public static final String LOG_TAG = "SYLK_APP";
    private static Bundle pendingBundle = null;

    public SylkNative(ReactApplicationContext context) {
        super(context);
        reactContext = context;
    }

    @Override
    public String getName() {
        return "SylkNative";
    }

    @ReactMethod
    public void launchMainActivity(String uri) {
        String packageName = reactContext.getPackageName();
        Intent launchIntent = reactContext.getPackageManager().getLaunchIntentForPackage(packageName);
        String className = launchIntent.getComponent().getClassName();

        try {
            Class<?> activityClass = Class.forName(className);
            Intent activityIntent;
            if (uri != null) {
                activityIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), reactContext, activityClass);
            } else {
                activityIntent = new Intent(reactContext, activityClass);
            }
            activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(activityIntent);
        } catch(Exception e) {
            Log.e(LOG_TAG, "[Native] Class not found", e);
            return;
        }
    }

    @ReactMethod
    public void requestUnlock(final Promise promise) {
        Log.d(LOG_TAG, "[Native] requestUnlock");

        KeyguardManager keyguardManager = (KeyguardManager) reactContext.getSystemService(Context.KEYGUARD_SERVICE);
        Activity currentActivity = this.getCurrentActivity();

        if (currentActivity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { // API 26+
            keyguardManager.requestDismissKeyguard(currentActivity, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissError() {
                    Log.d(LOG_TAG, "[Native] onDismissError");
                    promise.reject("DISMISS_FAILED");
                }

                @Override
                public void onDismissSucceeded() {
                    Log.d(LOG_TAG, "[Native] onDismissSucceeded");
                    promise.resolve(null);
                }

                @Override
                public void onDismissCancelled() {
                    Log.d(LOG_TAG, "[Native] onDismissCancelled");
                    promise.reject("DISMISS_CANCELLED");
                }
            });
        } else {
            Log.w(LOG_TAG, "[Native] requestDismissKeyguard requires API 26+. Skipping.");
            promise.reject("UNSUPPORTED_API", "requestDismissKeyguard requires API 26+");
        }
    }

    @ReactMethod
    public Boolean isKeyguardLocked() {
        Log.d(LOG_TAG, "[Native] isKeyguardLocked");

        KeyguardManager keyguardManager = (KeyguardManager) reactContext.getSystemService(Context.KEYGUARD_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { // API 23+
            return keyguardManager.isKeyguardLocked();
        } else {
            Log.w(LOG_TAG, "[Native] isKeyguardLocked requires API 23+. Returning false.");
            return false;
        }
    }

    @ReactMethod
    public static void emitDeviceEvent(String eventName, ReadableMap message) {
        Log.d(LOG_TAG, "[Native] emitDeviceEvent: " + message);
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, Arguments.fromBundle(Arguments.toBundle(message)));
    }

    /**
     * End the self-managed Telecom Connection associated with a call. JS
     * should call this whenever a call terminates (local hangup, remote
     * hangup, network drop, etc.) so the BT car kit / Android Auto see the
     * call end immediately. Idempotent — no-op if no Connection exists for
     * the given callUUID.
     *
     * cause is one of:
     *   "local"   — user hung up on this device
     *   "remote"  — caller / remote side ended the call
     *   "missed"  — call was never answered
     *   "rejected"— user rejected the call
     *   anything else maps to LOCAL.
     */
    @ReactMethod
    public void endTelecomCall(String callUUID, String cause) {
        int dc;
        if ("remote".equalsIgnoreCase(cause)) {
            dc = DisconnectCause.REMOTE;
        } else if ("missed".equalsIgnoreCase(cause)) {
            dc = DisconnectCause.MISSED;
        } else if ("rejected".equalsIgnoreCase(cause)) {
            dc = DisconnectCause.REJECTED;
        } else {
            dc = DisconnectCause.LOCAL;
        }
        SylkTelecom.endCall(callUUID, dc);
    }
}
