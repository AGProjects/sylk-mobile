// SylkBridge.kt
package com.agprojects.sylk

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import android.util.Log


class SylkBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SYLK_APP"
    }

    override fun getName(): String = "SylkBridge"

    private val prefs: SharedPreferences =
        reactContext.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)

    @ReactMethod
    fun setActiveChat(chatId: String?) {
        SylkLogger.d("[bridge] setActiveChat: $chatId")
        prefs.edit().putString("currentChat", chatId).apply()
    }

    @ReactMethod
    fun getActiveChat(promise: Promise) {
        val chatId = prefs.getString("currentChat", null)
        promise.resolve(chatId)
    }

    @ReactMethod
    fun setActiveCall(target: String?) {
        SylkLogger.d("[bridge] setActiveCall: $target")
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
        SylkLogger.d("[bridge] setAppActive: $active")
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
}
