// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

package com.agprojects.sylk.sylk;

import android.app.ActivityManager;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import android.os.Bundle;

import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.util.List;
import android.app.Activity;

public class SylkNative extends ReactContextBaseJavaModule {
    private static ReactApplicationContext reactContext;
    public static final String LOG_TAG = "Sylk:SylkNative";
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
            Log.e(LOG_TAG, "Class not found", e);
            return;
        }
    }

    @ReactMethod
    public void requestUnlock(final Promise promise) {
        Log.d(LOG_TAG, "requestUnlock");

        KeyguardManager keyguardManager = (KeyguardManager) reactContext.getSystemService(Context.KEYGUARD_SERVICE);
        keyguardManager.requestDismissKeyguard(this.getCurrentActivity(), new KeyguardManager.KeyguardDismissCallback() {
            @Override
            public void onDismissError() {
                Log.d(LOG_TAG, "onDismissError");
                promise.reject("DISMISS_FAILED");
            }

            @Override
            public void onDismissSucceeded() {
                Log.d(LOG_TAG, "onDismissSucceeded");
                promise.resolve(null);
            }

            @Override
            public void onDismissCancelled() {
                Log.d(LOG_TAG, "onDismissCancelled");
                promise.reject("DISMISS_CANCELLED");
            }
        });
    }

    @ReactMethod
    public Boolean isKeyguardLocked() {
        Log.d(LOG_TAG, "isKeyguardLocked");

        KeyguardManager keyguardManager = (KeyguardManager) reactContext.getSystemService(Context.KEYGUARD_SERVICE);
        return keyguardManager.isKeyguardLocked();
    }

    @ReactMethod
    public static void emitDeviceEvent(String eventName, ReadableMap message) {
        Log.d(LOG_TAG, "emitDeviceEvent: " + message);
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, Arguments.fromBundle(Arguments.toBundle(message)));
    }
}
