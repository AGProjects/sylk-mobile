package com.agprojects.sylk

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.flipper.ReactNativeFlipper
import com.facebook.soloader.SoLoader

import com.agprojects.sylk.SylkBridgePackage

class MainApplication : Application(), ReactApplication {


  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(ScreenLockPackage())
              add(SylkBridgePackage())
              add(ThumbnailServicePackage())
              add(CallForegroundServicePackage())
              add(LocationForegroundServicePackage())
              add(AndroidSettingsPackage())
              add(AudioRoutePackage())
              add(UnreadPackage())
              add(SylkCallRecorderPackage())
              add(NativeLoggerPackage())

            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(this.applicationContext, reactNativeHost)

    override fun registerReceiver(receiver: BroadcastReceiver?, filter: IntentFilter?): Intent? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            super.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            super.registerReceiver(receiver, filter)
        }
    }

  override fun onCreate() {
    super.onCreate()
    // Initialise the native log sink before anything else so calls
    // from boot-time SylkTelecom.register, FCM, etc. land on disk.
    SylkLogger.init(this)
    SoLoader.init(this, false)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
    // Flipper init is a DEBUG-only diagnostic. The dangerous part of
    // calling it unconditionally is `reactNativeHost.reactInstanceManager`
    // — that getter eagerly creates the React bridge, which iterates
    // getPackages() and calls createNativeModules() on every package.
    // That spawns AudioRouteModule, BluetoothScoManager, UnreadModule,
    // etc. at Application.onCreate time — even when the process was
    // started solely to run MyFirebaseMessagingService for an incoming
    // chat push and there is no Activity in sight (canonical symptom:
    // `[audio] AudioRouteModule init` appearing in APPLOG right after
    // a swipe-kill + push). The native side now writes the message
    // straight into sylk.db without ever needing the RN bridge, so
    // keep the bridge cold until MainActivity actually starts.
    if (BuildConfig.DEBUG) {
      ReactNativeFlipper.initializeFlipper(this, reactNativeHost.reactInstanceManager)
    }

    // Eagerly register our self-managed PhoneAccount so the Telecom framework
    // already knows about it the moment the first FCM push arrives. Idempotent
    // and a no-op on Android < O.
    SylkTelecom.register(this)

    // Clear the inConference flag on every process start. The flag is
    // owned by JS — set at conference 'established', cleared at
    // 'terminated' — but if the process was force-killed mid-conference
    // (or RN bridge crashed before reaching the terminated handler),
    // the SharedPreferences entry persists and the next incoming call
    // push gets wrongly suppressed as "in conference". Resetting at
    // boot guarantees a clean slate; JS re-sets it once a real
    // conference is in progress.
    applicationContext
        .getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("inConference", false)
        .apply()
  }
}
