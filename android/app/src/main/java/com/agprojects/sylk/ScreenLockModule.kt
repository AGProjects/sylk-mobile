package com.agprojects.sylk

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter

class ScreenLockModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> sendEvent("onScreenLock")
                Intent.ACTION_USER_PRESENT -> sendEvent("onScreenUnlock")
            }
        }
    }

    init {
        val filter = IntentFilter()
        filter.addAction(Intent.ACTION_SCREEN_OFF)
        filter.addAction(Intent.ACTION_USER_PRESENT)
        reactContext.registerReceiver(screenReceiver, filter)
    }

    private fun sendEvent(eventName: String) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, null)
    }

    override fun getName() = "ScreenLockModule"
}
