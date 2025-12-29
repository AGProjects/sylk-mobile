package com.agprojects.sylk;

import android.content.Intent;
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

    @Override
    protected String getMainComponentName() {
        return "Sylk";
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Log.d("[SYLK]", "MainActivity onCreate intent=" + getIntent());

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
            e.printStackTrace();
        }
    }

    /* ----------------------------------
     *   CENTRAL INTENT DISPATCH
     * ---------------------------------- */
    private void handleIntent(Intent intent) {
        if (intent == null) return;

        // Only keep intent parsing here if truly needed
        // Otherwise delegate to services that call ReactEventEmitter
    }

    /* ----------------------------------
     *   SINGLE-TASK INTENT REUSE
     * ---------------------------------- */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Log.d("[SYLK]", "MainActivity onNewIntent intent=" + intent);

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
        Log.w("[SYLK]", "MainActivity lost focus");
    }
}
