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

    // Both bridges are instrumented via SylkLogger so the exported log file
    // shows the JS request AND the native outcome. startForegroundService()
    // throws ForegroundServiceStartNotAllowedException on API 31+ when the app
    // is not in a state allowed to start one; swallowing that is how a share
    // ends up running with no foreground promotion, no network while the
    // screen is off, and nothing in the log to explain it.
    @ReactMethod
    fun startService() {
        try {
            val intent = Intent(reactApplicationContext, LocationForegroundService::class.java)
            reactApplicationContext.startForegroundService(intent)
            SylkLogger.d("[location] [fgs] startForegroundService dispatched")
        } catch (t: Throwable) {
            SylkLogger.e("[location] [fgs] startForegroundService REFUSED by platform", t)
        }
    }

    @ReactMethod
    fun stopService() {
        try {
            val intent = Intent(reactApplicationContext, LocationForegroundService::class.java)
            reactApplicationContext.stopService(intent)
            SylkLogger.d("[location] [fgs] stopService dispatched")
        } catch (t: Throwable) {
            SylkLogger.e("[location] [fgs] stopService failed", t)
        }
    }
}
