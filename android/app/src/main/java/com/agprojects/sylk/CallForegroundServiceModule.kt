package com.agprojects.sylk

import android.content.Intent
import com.facebook.react.bridge.*

class CallForegroundServiceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "CallForegroundServiceModule"

    @ReactMethod
    fun startService() {
        val intent = Intent(reactApplicationContext, CallForegroundService::class.java)
        reactApplicationContext.startForegroundService(intent)
    }

    @ReactMethod
    fun stopService() {
        val intent = Intent(reactApplicationContext, CallForegroundService::class.java)
        reactApplicationContext.stopService(intent)
    }
}
