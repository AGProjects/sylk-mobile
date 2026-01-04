package com.agprojects.sylk;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

import android.system.ErrnoException;
import android.system.Os;

import io.wazo.callkeep.RNCallKeepModule;

public class MainActivity extends ReactActivity {

    private static final String TAG = "[SYLK]";

    @Override
    protected String getMainComponentName() {
        return "Sylk";
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Log.d(TAG, "MainActivity onCreate intent=" + getIntent());

        // Handle the launch intent (replaces SplashActivity)
        handleIntent(getIntent());

        // Fix EXTERNAL_STORAGE env (legacy native code dependency)
        try {
            Os.setenv(
                "EXTERNAL_STORAGE",
                getExternalFilesDir(null) != null
                    ? getExternalFilesDir(null).getAbsolutePath()
                    : "",
                true
            );
        } catch (ErrnoException e) {
            Log.e(TAG, "Failed to set EXTERNAL_STORAGE", e);
        }
    }

    /* ----------------------------------
     *   CENTRAL INTENT DISPATCH
     * ---------------------------------- */
    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        Uri data = intent.getData();

        Log.d(TAG, "handleIntent action=" + action + " data=" + data);

        // This exactly mirrors what SplashActivity forwarded
        if (Intent.ACTION_VIEW.equals(action) && data != null) {
            handleViewIntent(data);
        }

        // ACTION_MAIN = normal launcher start
        // Other intent types (SEND, calls, notifications)
        // are already handled by RN / CallKeep services
    }

    /**
     * Handle deep links (sylk://, https://webrtc.sipthor.net)
     * Forward to React Native via Linking / event emitter
     */
    private void handleViewIntent(Uri uri) {
        Log.d(TAG, "Deep link received: " + uri);

        // IMPORTANT:
        // Do NOT start another Activity here.
        // React Native's Linking module will read getInitialURL()
        // or receive this via onNewIntent.

        // If you later want to manually emit:
        // ReactContext ctx = getReactInstanceManager().getCurrentReactContext();
        // ...
    }

    /* ----------------------------------
     *   SINGLE-TASK INTENT REUSE
     * ---------------------------------- */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        Log.d(TAG, "MainActivity onNewIntent intent=" + intent);

        // Required so RN Linking sees updated intent
        setIntent(intent);

        handleIntent(intent);
    }

    /* ----------------------------------
     *   BACK BUTTON BEHAVIOR
     * ---------------------------------- */
    @Override
    public void invokeDefaultOnBackPressed() {
        moveTaskToBack(true);
    }

    /* ----------------------------------
     *   PERMISSION RESULT (CALLKEEP)
     * ---------------------------------- */
    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == RNCallKeepModule.REQUEST_READ_PHONE_STATE) {
            RNCallKeepModule.onRequestPermissionsResult(
                requestCode,
                permissions,
                grantResults
            );
        }
    }

    @Override
    protected ReactActivityDelegate createReactActivityDelegate() {
        return new DefaultReactActivityDelegate(
            this,
            getMainComponentName(),
            DefaultNewArchitectureEntryPoint.getFabricEnabled()
        );
    }

    /* ----------------------------------
     *   DEBUG
     * ---------------------------------- */
    @Override
    protected void onPause() {
        super.onPause();
        Log.w(TAG, "MainActivity lost focus");
    }
}
