package com.agprojects.sylk

import android.content.Intent
import com.facebook.react.bridge.*

// JS bridge for LocationForegroundService. Exposes startService()/
// stopService() that the "Share location" flow in NavigationBar.js
// calls when the share begins / ends.
//
// Mirrors CallForegroundServiceModule so the two bridges have identical
// shapes; the only difference is the Service class they point at.
class LocationForegroundServiceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "LocationForegroundServiceModule"

    @ReactMethod
    fun startService() {
        val intent = Intent(reactApplicationContext, LocationForegroundService::class.java)
        reactApplicationContext.startForegroundService(intent)
    }

    @ReactMethod
    fun stopService() {
        val intent = Intent(reactApplicationContext, LocationForegroundService::class.java)
        reactApplicationContext.stopService(intent)
    }
}
