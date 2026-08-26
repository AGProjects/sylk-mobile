// SylkBridge.kt
package com.agprojects.sylk

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import android.util.Log
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat


class SylkBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SYLK_APP"
        // Inlined from react-native-draw-overlay (2026-07-22).
        private const val DRAW_OVER_OTHER_APP_PERMISSION_REQUEST_CODE = 1222
        private const val DRAW_OVERLAY_ERROR = "Permission was not granted"
        // Delay before the confirming WindowInsets pass. Long enough to
        // outlast the system-bar show animation (~250ms on stock Android),
        // short enough that the user never sees the un-padded frame settle.
        private const val INSETS_SETTLE_MS = 400L
    }

    override fun getName(): String = "SylkBridge"

    private val prefs: SharedPreferences =
        reactContext.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)

    // ---------------------------------------------------------------
    // Inlined from the dead, patched react-native-draw-overlay package
    // (2026-07-22). Provides the two methods JS used to check / request
    // the "display over other apps" (SYSTEM_ALERT_WINDOW) permission,
    // needed so the incoming-call alert panel can appear over the lock
    // screen and other apps. The ask path launches the system settings
    // screen and resolves the stored promise from onActivityResult —
    // hence the ActivityEventListener registered below (SylkBridge had
    // no activity-result plumbing before this). Android-only, matching
    // the removed native module (it never existed on iOS).
    // ---------------------------------------------------------------
    private var drawOverlayPromise: Promise? = null

    private val drawOverlayActivityEventListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity?,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                super.onActivityResult(activity, requestCode, resultCode, data)
                if (requestCode == DRAW_OVER_OTHER_APP_PERMISSION_REQUEST_CODE) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (activity != null && Settings.canDrawOverlays(activity.applicationContext)) {
                            drawOverlayPromise?.resolve(true)
                        } else {
                            drawOverlayPromise?.reject(Throwable(DRAW_OVERLAY_ERROR))
                        }
                    } else {
                        drawOverlayPromise?.resolve(true)
                    }
                    drawOverlayPromise = null
                }
            }
        }

    init {
        reactContext.addActivityEventListener(drawOverlayActivityEventListener)
    }

    @ReactMethod
    fun setActiveChat(chatId: String?) {
        //SylkLogger.d("[bridge] setActiveChat: $chatId")
        prefs.edit().putString("currentChat", chatId).apply()
    }

    @ReactMethod
    fun getActiveChat(promise: Promise) {
        val chatId = prefs.getString("currentChat", null)
        promise.resolve(chatId)
    }

    @ReactMethod
    fun setActiveCall(target: String?) {
        //SylkLogger.d("[bridge] setActiveCall: $target")
        prefs.edit().putString("currentCall", target).apply()
    }

    @ReactMethod
    fun getActiveCall(promise: Promise) {
        val callId = prefs.getString("currentCall", null)
        promise.resolve(callId)
    }

    // Post a silent missed-call notification on rejected_calls_channel_v2,
    // identical to the one the FCM service posts when an incoming push is
    // dropped (in-conference, OS DND, app DND). Called from JS when the
    // WSS-delivered incomingCall handler decides to drop the call before
    // SDP/ICE warmup. Fire-and-forget — the channel bypasses OS DND so
    // the entry appears on the shade/lockscreen even during DND.
    @ReactMethod
    fun showSuppressedCallNotification(fromUri: String?, isConference: Boolean, reasonText: String?) {
        val event = if (isConference) "incoming_conference_request" else "incoming_session"
        val reason = reasonText ?: "Do Not Disturb"
        SylkLogger.d("[bridge] showSuppressedCallNotification from=$fromUri reason=$reason isConf=$isConference")
        MyFirebaseMessagingService.showSuppressedCallNotification(
            reactApplicationContext, fromUri, event, reason
        )
    }

    // ---------------------------------------------------------------
    // appActive flag — written by JS on AppState 'active'/'background'
    // transitions. MyFirebaseMessagingService.isAppInForeground reads
    // this; it can't trust ActivityManager.getMyMemoryState because
    // the FCM service runs in its own process and reports its own
    // (background) importance, not the React Native app's. Without
    // this hint the FCM service ran incrementUnreadForContact even
    // when the JS process was actively handling the same WS-delivered
    // message, double-counting the launcher badge.
    // ---------------------------------------------------------------
    @ReactMethod
    fun setAppActive(active: Boolean) {
        //SylkLogger.d("[bridge] setAppActive: $active")
        prefs.edit().putBoolean("appActive", active).apply()
    }

    // ---------------------------------------------------------------
    // sipBridgeDomain — written by JS whenever the server
    // configuration (configuration.conference.sipBridge) is loaded.
    // MyFirebaseMessagingService.onMessageReceived reads it to drop
    // duplicate "incoming_session" pushes that are the SIP audio twin
    // of a sylk "incoming_conference_request" push (the conference
    // focus dialing the invitee in addition to the conferenceInvite
    // signalled over websocket). The drop is keyed strictly on the
    // from_uri host part, so a misconfigured (empty) value means "no
    // dedupe" — never accidentally rejects legitimate calls.
    // ---------------------------------------------------------------
    // ---------------------------------------------------------------
    // inConference flag — written by JS when the user enters an
    // active conference call and cleared when they leave. The FCM
    // service reads it on incoming-call push receipt: if the user is
    // already mid-conference, the loud full-screen Telecom ringer
    // would interrupt the active media session and there's no clean
    // way to accept the new call without dropping the conference.
    // The push is silently dropped and a regular (silent) "missed
    // call from X" notification is posted instead. Mirrors the
    // shouldDisplayMessageFromPayload gate on iOS.
    // ---------------------------------------------------------------
    @ReactMethod
    fun setInConference(active: Boolean) {
        SylkLogger.d("[bridge] setInConference: $active")
        prefs.edit().putBoolean("inConference", active).apply()
    }

    @ReactMethod
    fun setSipBridgeDomain(domain: String?) {
        val trimmed = domain?.trim()?.lowercase()
        SylkLogger.d("[bridge] setSipBridgeDomain: $trimmed")
        if (trimmed.isNullOrEmpty()) {
            prefs.edit().remove("sipBridgeDomain").apply()
        } else {
            prefs.edit().putString("sipBridgeDomain", trimmed).apply()
        }
    }

    /**
     * Single-shot synchronous read of the deep-link URI that brought
     * the app to foreground when the launch intent was a
     * sylk://message/incoming/<uri> tap. MainActivity.onCreate stamps
     * this pref as the very first thing it does so JS can pick it up
     * before any user-visible render happens.
     *
     * Returns the URI string (and atomically clears the pref) or null
     * if the launch wasn't a message-push tap. JS uses this to suppress
     * the contacts list during the 2–3 s gap before Linking's 'url'
     * event fires — without flashing the contacts list to the user
     * when they tapped a notification.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun consumeLaunchMessageUri(): String? {
        val uri = prefs.getString("launchMessageUri", null)
        if (uri != null) {
            prefs.edit().remove("launchMessageUri").apply()
        }
        return uri
    }

    /**
     * The original system Configuration.fontWeightAdjustment captured by
     * MainActivity.attachBaseContext BEFORE the activity neutralises it.
     * +300 means the user turned on Display → "Bold font"; 0 means off.
     * (Integer.MAX_VALUE = UNDEFINED on some OEMs / pre-Android-12 — JS
     * treats anything outside a sane 1..1000 range as "not bold".)
     *
     * JS reads this once at startup and, when set, re-applies bold to all
     * text with an explicit fontWeight that RN can measure correctly — so
     * the user keeps their bold preference without the OS-level adjustment's
     * trailing-character clipping. Synchronous so it can run before the
     * first Text renders.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getSystemFontWeightAdjustment(): Int {
        return prefs.getInt("systemFontWeightAdjustment", 0)
    }

    /**
     * Single-shot synchronous read of the Bluetooth-headset
     * voice-command stamp. MainActivity.emitVoiceCommandIntent writes
     * pendingVoiceCommandTs when an ACTION_VOICE_COMMAND /
     * VOICE_SEARCH_HANDSFREE intent (long-press on an HFP headset
     * call button, e.g. Plantronics Voyager) cold-starts the app
     * before the ReactContext exists. The App constructor consumes it
     * to arm a deferred redial of the last dialed URI, fired once
     * registration completes (headsetRedial in app.js).
     *
     * Returns the epoch-millis timestamp of the press (and atomically
     * clears the pref), or 0 when no press is pending. Returned as
     * Double because the RN sync bridge has no Long.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun consumeVoiceCommandTs(): Double {
        val ts = prefs.getLong("pendingVoiceCommandTs", 0L)
        if (ts != 0L) {
            prefs.edit().remove("pendingVoiceCommandTs").apply()
        }
        return ts.toDouble()
    }

    // Inlined from the dead react-native-minimize package (2026-07-22):
    // sends the app to the background by launching the HOME intent —
    // identical behavior to the removed lib's minimizeApp(). Used by
    // the phone-was-locked / screen-off call-teardown paths in app.js
    // (Android-only flows).
    @ReactMethod
    fun minimizeApp() {
        try {
            val startMain = android.content.Intent(android.content.Intent.ACTION_MAIN)
            startMain.addCategory(android.content.Intent.CATEGORY_HOME)
            startMain.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            reactApplicationContext.startActivity(startMain)
        } catch (e: Exception) {
            SylkLogger.e("[bridge] minimizeApp failed: ${e.message}")
        }
    }

    // Bring the app's MainActivity back to the foreground. Used when the
    // user taps "Stop" on the Android system screen-cast pill while the app
    // is backgrounded (they'd shared their screen and switched away): once
    // the projection stops we want to return them to the live call UI rather
    // than leave them staring at whatever app was on top. Uses the launcher
    // intent with REORDER_TO_FRONT so an existing task instance is raised
    // (no relaunch / no state loss); NEW_TASK is required to start an
    // activity from a non-activity context.
    @ReactMethod
    fun bringAppToForeground() {
        try {
            val ctx = reactApplicationContext
            val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            if (intent != null) {
                intent.addFlags(
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                    android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                )
                ctx.startActivity(intent)
            } else {
                SylkLogger.e("[bridge] bringAppToForeground: no launch intent")
            }
        } catch (e: Exception) {
            SylkLogger.e("[bridge] bringAppToForeground failed: ${e.message}")
        }
    }

    // Force Android to re-show the system bars and RE-DISPATCH window insets
    // to the (react-native-safe-area-context) SafeAreaProvider. Needed after a
    // screen-share session ends: while sharing/immersive the status + nav bars
    // were hidden and the insets collapsed to 0; when the bars come back the
    // inset listener isn't always re-fired, so JS keeps the stale 0 insets and
    // the app content overlaps the phone's top status bar and bottom button
    // bar. Clearing the immersive flags and calling requestApplyInsets() makes
    // the OS deliver a fresh WindowInsets pass so the safe-area padding is
    // recomputed. Android-only; no-op if there's no current activity.
    @ReactMethod
    fun refreshSystemInsets() {
        val activity = currentActivity ?: return
        activity.runOnUiThread {
            try {
                showSystemBars(activity)
            } catch (e: Exception) {
                SylkLogger.e("[bridge] refreshSystemInsets failed: ${e.message}")
            }
        }
    }

    // The single "put the phone back the way we found it" routine.
    //
    // Must run on the UI thread. Every path that leaves fullscreen funnels
    // here: setImmersive(false), refreshSystemInsets(), and (via JS) the
    // call-terminated handler, the VideoBox/ConferenceBox unmounts and the
    // screen-share teardown.
    //
    // Why this is not just `systemUiVisibility = 0` any more:
    //
    // The app targets SDK 36. From Android 15 (SDK 35) on, the window is
    // permanently edge-to-edge -- Window#setDecorFitsSystemWindows is
    // "deprecated and disabled", so nothing can opt the window back into
    // the fitted layout. The only supported way to hide and re-show the
    // bars in that world is WindowInsetsController. The legacy
    // View#setSystemUiVisibility flags we used to write are translated
    // into that same controller by the framework, but the translation is
    // not symmetric once anything else has driven the controller directly
    // -- and something else does: React Native's own StatusBar module
    // (WindowUtil.statusBarHide/Show in RN 0.77) touches the window on
    // every StatusBar.setHidden() call, which VideoBox/ConferenceBox issue
    // right next to every Immersive.on()/off(). The result was an exit
    // path that hid the bars reliably and un-hid them only sometimes:
    // IMMERSIVE_STICKY survived the call, so the status bar and the
    // navigation bar stayed gone AND the insets stayed at 0 -- exactly the
    // "app is edge to edge with no top/bottom inset after a video call"
    // report.
    //
    // So: show through the controller (authoritative), reset the sticky
    // behaviour, clear the legacy flags and RN's FLAG_FULLSCREEN in case
    // an older code path or a race left them set, then force the inset
    // re-dispatch.
    private fun showSystemBars(activity: Activity) {
        val window = activity.window ?: return
        val decor = window.decorView

        val controller = WindowCompat.getInsetsController(window, decor)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
        controller.show(WindowInsetsCompat.Type.systemBars())

        // Belt and braces: FLAG_FULLSCREEN is what RN's
        // StatusBar.setHidden(true) adds, and it keeps the status bar down
        // independently of the controller. Clearing it here makes the exit
        // self-sufficient even when the matching StatusBar.setHidden(false)
        // never runs (OS-initiated hangup, CallKit, process shuffle).
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.addFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN)

        @Suppress("DEPRECATION")
        decor.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE

        requestInsetsPass(decor)
    }

    // Ask the OS for a fresh WindowInsets dispatch — twice.
    //
    // The bars do not reappear instantly: the first requestApplyInsets() can
    // run while the system is still animating them back in, and the values
    // SafeAreaProvider then receives are the ones from mid-animation (often
    // still 0). The OS does not guarantee another pass afterwards, so a single
    // request leaves JS holding those stale numbers with nothing to correct
    // them. The second pass, after the animation window, is what actually
    // lands the final values. Cheap, idempotent, and invisible when the first
    // one already got it right.
    private fun requestInsetsPass(decor: android.view.View) {
        androidx.core.view.ViewCompat.requestApplyInsets(decor)
        decor.postDelayed({
            try {
                androidx.core.view.ViewCompat.requestApplyInsets(decor)
            } catch (e: Exception) {
                SylkLogger.e("[bridge] delayed requestApplyInsets failed: ${e.message}")
            }
        }, INSETS_SETTLE_MS)
    }

    // Replaces the dead react-native-immersive package (2026-07-22):
    // sticky-immersive fullscreen toggle used by the video call /
    // conference UI. Migrated off the lib's SYSTEM_UI_FLAG_* writes to
    // WindowInsetsController (2026-08-22) — see showSystemBars() for why
    // the legacy flags could hide the bars but not reliably bring them
    // back at targetSdk 35+.
    @ReactMethod
    fun setImmersive(isOn: Boolean) {
        val activity = currentActivity ?: return
        activity.runOnUiThread {
            try {
                if (isOn) {
                    val window = activity.window ?: return@runOnUiThread
                    val controller = WindowCompat.getInsetsController(window, window.decorView)
                    // Sticky immersive: bars stay hidden, a swipe from the
                    // edge shows them transiently without pushing the video
                    // around. Same user-visible behaviour as the old
                    // SYSTEM_UI_FLAG_IMMERSIVE_STICKY, expressed in the API
                    // that is still supported at targetSdk 35+.
                    controller.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    controller.hide(WindowInsetsCompat.Type.systemBars())
                } else {
                    // Leaving immersive is exactly the moment the insets
                    // change, and clearing flags is not enough on its own to
                    // make the OS redeliver them -- see showSystemBars().
                    // Every Immersive.off() caller in JS (VideoBox /
                    // ConferenceBox unmount, the call-terminated handler in
                    // app.js, the fullscreen toggle, screen-share teardown)
                    // gets the full restore from this one place instead of
                    // having to remember a second call.
                    showSystemBars(activity)
                }
            } catch (e: Exception) {
                SylkLogger.e("[bridge] setImmersive failed: ${e.message}")
            }
        }
    }

    // Inlined from the dead, patched react-native-draw-overlay package
    // (2026-07-22). Launches the system "display over other apps"
    // settings screen if the SYSTEM_ALERT_WINDOW permission isn't granted
    // yet, and resolves the promise from onActivityResult above once the
    // user returns; resolves immediately if already granted. Byte-for-byte
    // the removed lib's askForDisplayOverOtherAppsPermission().
    @ReactMethod
    fun askForDisplayOverOtherAppsPermission(promise: Promise) {
        drawOverlayPromise = promise
        if (!Settings.canDrawOverlays(reactApplicationContext)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + reactApplicationContext.packageName)
            )
            reactApplicationContext.startActivityForResult(
                intent, DRAW_OVER_OTHER_APP_PERMISSION_REQUEST_CODE, null
            )
        } else {
            promise.resolve(true)
        }
    }

    // Inlined from react-native-draw-overlay's locally-patched
    // checkForDisplayOverOtherAppsPermission(): rejects when the overlay
    // permission is missing (JS opens app settings on the rejection),
    // resolves(true) when already granted.
    @ReactMethod
    fun checkForDisplayOverOtherAppsPermission(promise: Promise) {
        if (!Settings.canDrawOverlays(reactApplicationContext)) {
            promise.reject(Throwable(DRAW_OVERLAY_ERROR))
        } else {
            promise.resolve(true)
        }
    }
}
