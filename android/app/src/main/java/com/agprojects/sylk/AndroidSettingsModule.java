package com.agprojects.sylk;

import android.content.Intent;
import android.provider.Settings;
import android.app.NotificationManager;
import android.content.Context;

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

    @ReactMethod
    public boolean hasDndAccess() {
        NotificationManager nm =
            (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);

        return nm != null && nm.isNotificationPolicyAccessGranted();
    }
}
