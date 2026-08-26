package com.agprojects.sylk;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
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

    private static final String TAG = "SYLK_APP";
    private static Intent pendingShareIntent;
    private static boolean shareHandled = false;

    @Override
    protected String getMainComponentName() {
        return "Sylk";
    }

    /**
     * Neutralise the system "Bold font" accessibility setting for this app.
     *
     * On Android 12 (API 31) and up, the Display → "Bold font" toggle sets a
     * global Configuration.fontWeightAdjustment of +300. Android RENDERS every
     * glyph heavier, but React Native (0.73) measures text with the UN-adjusted
     * weight, so every Text box is sized a few pixels too narrow and the
     * trailing word/letters get dropped ("Forwar" instead of "Forward",
     * "Aic" instead of "Aici", chat bubbles + action sheet + reaction bar all
     * clipped on the right). Forcing fontWeightAdjustment back to 0 makes the
     * app draw text at its normal weight, so measurement and rendering agree
     * again and nothing is clipped.
     *
     * We hook applyOverrideConfiguration (which AppCompatActivity always calls
     * during attachBaseContext startup) rather than attachBaseContext itself:
     * the config the framework hands us here is the one actually applied to the
     * activity, so editing it reliably sticks. The value must be an explicit 0
     * — FONT_WEIGHT_ADJUSTMENT_UNDEFINED is treated as "inherit" and would keep
     * the system's +300.
     *
     * Trade-off: the app no longer follows the OS "Bold font" preference. The
     * rest of the system (status bar, other apps) is unaffected. If we ever
     * upgrade to a React Native version that measures fontWeightAdjustment
     * correctly, this override can be removed to restore in-app bold.
     */
    @Override
    public void applyOverrideConfiguration(Configuration overrideConfiguration) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && overrideConfiguration != null) {
            overrideConfiguration.fontWeightAdjustment = 0;
        }
        super.applyOverrideConfiguration(overrideConfiguration);
    }

    @Override
    protected void attachBaseContext(Context newBase) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Configuration base = newBase.getResources().getConfiguration();

            // Remember the ORIGINAL system "Bold font" adjustment (+300 when
            // the user enabled Display → Bold font, 0 otherwise) BEFORE we
            // neutralise it below. JS reads this back via
            // SylkBridge.getSystemFontWeightAdjustment() and, when it's set,
            // re-applies bold itself with an explicit fontWeight — which React
            // Native measures correctly, so we keep the user's bold preference
            // without the trailing-character clipping the OS-level adjustment
            // caused.
            try {
                newBase.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)
                    .edit()
                    .putInt("systemFontWeightAdjustment", base.fontWeightAdjustment)
                    .apply();
            } catch (Throwable t) {
                SylkLogger.w("[app] storing systemFontWeightAdjustment failed: " + t.getMessage());
            }

            Configuration override = new Configuration(base);
            override.fontWeightAdjustment = 0;
            newBase = newBase.createConfigurationContext(override);
        }
        super.attachBaseContext(newBase);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SylkLogger.d("[app] MainActivity onCreate intent=" + getIntent());

        // Stamp the launch intent's URI into SylkPrefs IF this was a
        // sylk://message/ tap. SylkBridge.consumeLaunchMessageUri()
        // reads it synchronously from JS's componentDidMount so the
        // very first render can hide the contacts list — Linking's
        // 'url' event doesn't fire until 2–3 s later, too late to
        // prevent the contacts-list flash.
        try {
            Intent _launch = getIntent();
            Uri _data = _launch != null ? _launch.getData() : null;
            String _scheme = _data != null ? _data.getScheme() : null;
            String _host = _data != null ? _data.getHost() : null;
            if (Intent.ACTION_VIEW.equals(_launch.getAction())
                    && "sylk".equalsIgnoreCase(_scheme)
                    && "message".equalsIgnoreCase(_host)) {
                getSharedPreferences("SylkPrefs", MODE_PRIVATE)
                    .edit()
                    .putString("launchMessageUri", _data.toString())
                    .apply();
                SylkLogger.d("[app] launchMessageUri stamped: " + _data);
            }
        } catch (Throwable t) {
            SylkLogger.w("[app] stamping launchMessageUri failed: " + t.getMessage());
        }

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
            SylkLogger.e("[app] Failed to set EXTERNAL_STORAGE", e);
        }
    }

    /* ----------------------------------
     *   CENTRAL INTENT DISPATCH
     * ---------------------------------- */
    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        Uri data = intent.getData();

        //SylkLogger.d("[app] handleIntent action=" + action + " data=" + data);

        // Dial-out intents. The system dialer, the contacts app and
        // some click-to-dial widgets send ACTION_DIAL with a tel:/sip:
        // URI instead of the ACTION_VIEW a browser uses. Both mean the
        // same thing to us, but React Native's LinkingModule only
        // reports ACTION_VIEW from getInitialURL(), so a cold start via
        // ACTION_DIAL would reach JS with no URL at all. Rewrite the
        // action in place — this is the activity's own intent object, so
        // the setIntent() below (and the one onNewIntent already did)
        // point at the same instance — and let the ACTION_VIEW branch
        // handle it from here.
        if (Intent.ACTION_DIAL.equals(action) && data != null) {
            SylkLogger.d("[app] Dial intent rewritten to ACTION_VIEW: " + data);
            intent.setAction(Intent.ACTION_VIEW);
            setIntent(intent);
            action = Intent.ACTION_VIEW;
        }

        // This exactly mirrors what SplashActivity forwarded
        if (Intent.ACTION_VIEW.equals(action) && data != null) {
			SylkLogger.d("[app] handleViewIntent");
            handleViewIntent(data);
        }

		if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
			// VERY IMPORTANT: keep intent so RN can read it
			SylkLogger.d("[app] Caching share intent");
			pendingShareIntent = intent;
			if (!shareHandled) {
				setIntent(intent);
				SylkLogger.d("[app] setIntent");
				emitShareIntent(intent);
				shareHandled = true;
			}
		}

        // Bluetooth-headset redial hotkey. Long-press on the call
        // button of an HFP headset (e.g. Plantronics Voyager) sends
        // AT+BVRA; Android converts it to ACTION_VOICE_COMMAND (or
        // VOICE_SEARCH_HANDSFREE on some OEMs) and launches whichever
        // app the user picked in the "Complete action using" chooser.
        // The matching intent-filters live on this activity in the
        // manifest. Forward to JS, which redials the last dialed URI
        // (headsetRedial in app.js).
        if (Intent.ACTION_VOICE_COMMAND.equals(action)
                || "android.speech.action.VOICE_SEARCH_HANDSFREE".equals(action)) {
            SylkLogger.d("[app] Headset voice-command intent: " + action);
            emitVoiceCommandIntent(action);
        }

        // ACTION_MAIN = normal launcher start
        // Other intent types (SEND, calls, notifications)
        // are already handled by RN / CallKeep services
    }

    /**
     * Forward a headset voice-command intent to JS.
     *
     * Warm start (app already running): emit a SylkVoiceCommand
     * device event — app.js listens next to SylkDeepLink and redials
     * immediately.
     *
     * Cold start (JS not bundled yet, ReactContext == null): stamp
     * pendingVoiceCommandTs into SylkPrefs. The App constructor
     * consumes it synchronously via
     * SylkBridge.consumeVoiceCommandTs() and arms a deferred redial
     * that registrationStateChanged fires once the account is
     * registered — dialing before registration would fail. The
     * timestamp lets JS discard stale stamps (e.g. a press that
     * never resulted in a full app start).
     */
    private void emitVoiceCommandIntent(String action) {
        try {
            ReactContext context = getReactInstanceManager().getCurrentReactContext();
            if (context == null) {
                getSharedPreferences("SylkPrefs", MODE_PRIVATE)
                    .edit()
                    .putLong("pendingVoiceCommandTs", System.currentTimeMillis())
                    .apply();
                SylkLogger.d("[app] emitVoiceCommandIntent: ReactContext null — stamped pendingVoiceCommandTs");
                return;
            }
            WritableMap payload = Arguments.createMap();
            payload.putString("source", action);
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("SylkVoiceCommand", payload);
            SylkLogger.d("[app] emitVoiceCommandIntent: emitted SylkVoiceCommand");
        } catch (Throwable t) {
            SylkLogger.w("[app] emitVoiceCommandIntent failed: " + t.getMessage());
        }
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
				SylkLogger.d("[app] Re-applying pending share intent");
				setIntent(pendingShareIntent);
				shareHandled = true;
			}
		}
	}

    /**
     * Handle deep links (sylk://, https://webrtc.sipthor.net)
     * Forward to React Native via Linking / event emitter.
     *
     * Why we emit a custom event instead of relying on Linking:
     * react-native-linking ties its 'url' DeviceEventEmitter to
     * AppState lifecycle transitions. On a warm-start notification
     * tap (app already running) the activity's onNewIntent fires
     * IMMEDIATELY but the 'url' event isn't dispatched to JS until
     * the activity's onResume / AppState transitions complete — a
     * 3-second window in field traces (logcat "Deep link received"
     * at 14:03:36, JS "Event from url" at 14:03:39). User stares at
     * the previous screen for those 3 seconds before the chat opens.
     *
     * Mirror what emitShareIntent does for ACTION_SEND: push the
     * URL into a custom RCTDeviceEventEmitter event so JS can react
     * instantly via a dedicated DeviceEventEmitter listener — no
     * Linking lifecycle wait. JS still keeps the Linking listener
     * as a fallback for any caller that goes through getInitialURL
     * + addEventListener('url', ...).
     */
    private void handleViewIntent(Uri uri) {
        SylkLogger.d("[app] Deep link received: " + uri);

        emitDeepLinkIntent(uri);
    }

    /**
     * Emit a SylkDeepLink event with the URL so JS can navigate
     * synchronously, bypassing react-native-linking's lifecycle-
     * gated event timing. Mirrors emitShareIntent for ACTION_SEND.
     *
     * If the React context isn't ready yet (cold-start, JS hasn't
     * bundled), we silently no-op — cold-start is already covered
     * by the launchMessageUri SharedPreferences read in
     * App.constructor (SylkBridge.consumeLaunchMessageUri).
     */
    private void emitDeepLinkIntent(Uri uri) {
        if (uri == null) return;
        try {
            ReactContext context = getReactInstanceManager().getCurrentReactContext();
            if (context == null) {
                // Cold-start path — JS not bundled yet. The constructor's
                // SylkBridge.consumeLaunchMessageUri() will pick up the
                // stamped SharedPreferences value as soon as JS mounts.
                SylkLogger.d("[app] emitDeepLinkIntent: ReactContext null — relying on launchMessageUri pref");
                return;
            }
            WritableMap payload = Arguments.createMap();
            payload.putString("url", uri.toString());
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("SylkDeepLink", payload);
            SylkLogger.d("[app] emitDeepLinkIntent: emitted SylkDeepLink for " + uri);
        } catch (Throwable t) {
            SylkLogger.w("[app] emitDeepLinkIntent failed: " + t.getMessage());
        }
    }

    /* ----------------------------------
     *   SINGLE-TASK INTENT REUSE
     * ---------------------------------- */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        SylkLogger.d("[app] MainActivity onNewIntent intent=" + intent);

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
        //SylkLogger.w("[app] MainActivity lost focus");
    }

	@Override
	protected void onStart() {
		super.onStart();
		//SylkLogger.d("[app] MainActivity onStart");
	}
	
	@Override
	protected void onStop() {
		super.onStop();
		//SylkLogger.d("[app] MainActivity onStop");
	}
	
	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		//SylkLogger.d("[app] MainActivity onWindowFocusChanged: " + hasFocus);
	}
	

}
