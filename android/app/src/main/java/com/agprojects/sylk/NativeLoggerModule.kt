// NativeLoggerModule.kt
//
// React Native bridge to SylkLogger.
//
// JS API:
//
//   NativeModules.NativeLogger.getPersistedLogs()         -> Promise<string>
//   NativeModules.NativeLogger.acknowledgePersistedLogs() -> Promise<void>
//
//   const em = new NativeEventEmitter(NativeModules.NativeLogger);
//   em.addListener("NativeLogLine", ({line}) => ...);
//
// addListener / removeListeners are wired to SylkLogger.setLiveListener
// so the FIRST JS subscription flips the native sink from disk to the
// live event channel; the LAST removal flips it back. While the live
// sink is active, lines are NOT persisted to disk — that's the
// no-duplicate guarantee. JS subscribes BEFORE draining so any line
// fired during the drain goes via the bridge instead of leaking onto
// disk and being replayed in the next session.

package com.agprojects.sylk

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativeLoggerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        // Belt and braces — MainApplication.onCreate already calls
        // SylkLogger.init.
        SylkLogger.init(reactContext.applicationContext)
    }

    override fun getName(): String = "NativeLogger"

    // -- live event stream ---------------------------------------------

    // Reference-counted observer model. RN calls addListener once per
    // JS subscriber; we install the SylkLogger live listener on the
    // first add and clear it on the last remove. NativeEventEmitter
    // on the JS side maintains the count.
    @Volatile
    private var listenerCount: Int = 0
    private val listenerLock = Any()

    @ReactMethod
    fun addListener(eventName: String) {
        synchronized(listenerLock) {
            listenerCount += 1
            if (listenerCount == 1) {
                installLiveListener()
            }
        }
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        synchronized(listenerLock) {
            listenerCount = (listenerCount - count).coerceAtLeast(0)
            if (listenerCount == 0) {
                SylkLogger.setLiveListener(null)
            }
        }
    }

    private fun installLiveListener() {
        SylkLogger.setLiveListener { line ->
            try {
                if (!reactContext.hasActiveCatalystInstance()) return@setLiveListener
                val payload = Arguments.createMap().apply { putString("line", line) }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("NativeLogLine", payload)
            } catch (_: Throwable) {
                // The bridge can be torn down between checks. Swallow
                // — the native line still landed in Logcat. Don't
                // recurse via SylkLogger here.
            }
        }
    }

    // -- one-shot drain (two-phase) -----------------------------------

    @ReactMethod
    fun getPersistedLogs(promise: Promise) {
        try {
            promise.resolve(SylkLogger.drainStart())
        } catch (t: Throwable) {
            promise.reject("sylk_logger_drain_failed", t.message ?: "unknown", t)
        }
    }

    @ReactMethod
    fun acknowledgePersistedLogs(promise: Promise) {
        try {
            SylkLogger.drainAck()
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("sylk_logger_ack_failed", t.message ?: "unknown", t)
        }
    }
}
