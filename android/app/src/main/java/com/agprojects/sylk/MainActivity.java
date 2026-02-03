package com.agprojects.sylk;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.content.ClipData;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

import android.system.ErrnoException;
import android.system.Os;

import io.wazo.callkeep.RNCallKeepModule;

import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.modules.core.DeviceEventManagerModule;


public class MainActivity extends ReactActivity {

    private static final String TAG = "[SYLK]";
    private static Intent pendingShareIntent;
    private static boolean shareHandled = false;

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
			Log.d(TAG, "handleViewIntent");
            handleViewIntent(data);
        }

		if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
			// VERY IMPORTANT: keep intent so RN can read it
			Log.d(TAG, "Caching share intent");
			pendingShareIntent = intent;
			if (!shareHandled) {
				setIntent(intent);
				Log.d(TAG, "setIntent");
				emitShareIntent(intent);
				shareHandled = true;
			}
		}

        // ACTION_MAIN = normal launcher start
        // Other intent types (SEND, calls, notifications)
        // are already handled by RN / CallKeep services
    }

	private void emitShareIntent(Intent intent) {
		ReactContext context = getReactInstanceManager().getCurrentReactContext();
	
		if (context == null) {
			pendingShareIntent = intent;
			return;
		}
	
		WritableMap payload = Arguments.createMap();
		payload.putString("type", intent.getType());
	
		// 🔹 Multiple files
		if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())
			&& intent.getClipData() != null) {
	
			ClipData clip = intent.getClipData();
			WritableArray items = Arguments.createArray();
	
			for (int i = 0; i < clip.getItemCount(); i++) {
				ClipData.Item item = clip.getItemAt(i);
				Uri uri = item.getUri();
				if (uri == null) continue;
	
				WritableMap file = Arguments.createMap();
				file.putString("uri", uri.toString());
				file.putString("type", intent.getType());
				items.pushMap(file);
			}
	
			payload.putArray("items", items);
		}
		// 🔹 Single file
		else if (intent.hasExtra(Intent.EXTRA_STREAM)) {
			Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
			if (uri != null) {
				payload.putString("uri", uri.toString());
			}
		}
		// 🔹 Text / link
		else if (intent.hasExtra(Intent.EXTRA_TEXT)) {
			payload.putString("text", intent.getStringExtra(Intent.EXTRA_TEXT));
			if (intent.hasExtra(Intent.EXTRA_SUBJECT)) {
				payload.putString("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT));
			}
			if (intent.hasExtra(Intent.EXTRA_TITLE)) {
				payload.putString("title", intent.getStringExtra(Intent.EXTRA_TITLE));
			}
		}
	
		context
			.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
			.emit("ShareIntentReceived", payload);
	}
	

	@Override
	protected void onResume() {
		super.onResume();
	
		if (pendingShareIntent != null) {
			if (!shareHandled) {
				Log.d(TAG, "Re-applying pending share intent");
				setIntent(pendingShareIntent);
				shareHandled = true;
			}
		}
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
		shareHandled = false;
        Log.w(TAG, "MainActivity lost focus");
    }

	@Override
	protected void onStart() {
		super.onStart();
		Log.d(TAG, "MainActivity onStart");
	}
	
	@Override
	protected void onStop() {
		super.onStop();
		Log.d(TAG, "MainActivity onStop");
	}
	
	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		Log.d(TAG, "MainActivity onWindowFocusChanged: " + hasFocus);
	}
	

}
