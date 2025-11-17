// SylkBridge.kt
package com.agprojects.sylk

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class SylkBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SylkBridge"

    private val prefs: SharedPreferences =
        reactContext.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)

    @ReactMethod
    fun setActiveChat(chatId: String?) {
        prefs.edit().putString("currentChat", chatId).apply()
    }

    @ReactMethod
    fun getActiveChat(promise: Promise) {
        val chatId = prefs.getString("currentChat", null)
        promise.resolve(chatId)
    }
}
