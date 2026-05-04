package com.agprojects.sylk

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
                // ACTION_SCREEN_ON fires when the display turns on, even
                // while the keyguard is still in front. During an active
                // call this is the signal we want: it captures the user
                // tap-to-wake on the lockscreen. ACTION_USER_PRESENT only
                // fires after the keyguard is dismissed, so it misses the
                // window in which the user wakes the screen but never
                // unlocks (typical mid-call behaviour).
                Intent.ACTION_SCREEN_ON -> sendEvent("onScreenOn")
                Intent.ACTION_USER_PRESENT -> sendEvent("onScreenUnlock")
            }
        }
    }

    init {
        val filter = IntentFilter()
        filter.addAction(Intent.ACTION_SCREEN_OFF)
        filter.addAction(Intent.ACTION_SCREEN_ON)
        filter.addAction(Intent.ACTION_USER_PRESENT)
        reactContext.registerReceiver(screenReceiver, filter)
    }

    private fun sendEvent(eventName: String) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, null)
    }

    // Required no-op stubs for RN's NativeEventEmitter — without them JS
    // logs the `new NativeEventEmitter()` … missing addListener /
    // removeListeners warnings on every boot. We don't track listener
    // counts here (the BroadcastReceiver fires regardless of whether JS
    // is listening), so the bodies are intentionally empty.
    @ReactMethod
    fun addListener(eventName: String) {
        // no-op
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // no-op
    }

    override fun getName() = "ScreenLockModule"
}
