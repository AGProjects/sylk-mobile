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

    override fun getName(): String = "SylkBridge"

    private val prefs: SharedPreferences =
        reactContext.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)

    @ReactMethod
    fun setActiveChat(chatId: String?) {
        Log.d("[SYLK]", "setActiveChat: $chatId")
        prefs.edit().putString("currentChat", chatId).apply()
    }

    @ReactMethod
    fun getActiveChat(promise: Promise) {
        val chatId = prefs.getString("currentChat", null)
        promise.resolve(chatId)
    }

    @ReactMethod
    fun setActiveCall(target: String?) {
        Log.d("[SYLK]", "setActiveCall: $target")
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
        Log.d("[SYLK]", "setAppActive: $active")
        prefs.edit().putBoolean("appActive", active).apply()
    }
}
