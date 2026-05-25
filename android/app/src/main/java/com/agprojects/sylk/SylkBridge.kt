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
}
