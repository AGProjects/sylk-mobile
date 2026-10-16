package com.agprojects.sylk

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import com.agprojects.sylk.SylkBridgePackage
import com.oney.WebRTCModule.WebRTCModuleOptions

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
              add(AppExitInfoPackage())
              add(PointerOverlayPackage())

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

  /**
   * Pin the react-native-vector-icons typefaces into ReactFontManager's
   * customTypefaceCache at process start.
   *
   * Why: RN resolves `fontFamily: "MaterialDesignIcons"` through
   * ReactFontManager.createAssetTypeface(), which does
   * Typeface.createFromAsset(assets, "fonts/<family>.ttf") inside a
   * try/catch that SWALLOWS RuntimeException and falls back to
   * Typeface.create(<family>, style) -- i.e. the plain system face, in
   * which every icon codepoint (Private Use Area) renders as tofu. Worse,
   * getTypeface() then CACHES that fallback in its fontCache for the
   * lifetime of the process, so one transient failure turns every icon in
   * the app into a box until the process is force-stopped. Reported in the
   * field (whole-app tofu on a single handset) and not reproducible here.
   *
   * customTypefaceCache is consulted BEFORE that asset path and is never
   * poisoned by it, so registering here makes the asset lookup irrelevant.
   * We load from res/font first (goes through the resource loader rather
   * than AssetManager, which also sidesteps OEM typeface substitution --
   * Samsung "Font style" / Xiaomi Themes -- a known cause of the same
   * symptom), and only fall back to the asset copy. If both fail we log it
   * so the bug reporter shows a cause instead of a silently boxed UI.
   */
  private fun registerIconFont(family: String, resId: Int, assetName: String) {
    val typeface: Typeface? =
        runCatching { ResourcesCompat.getFont(this, resId) }.getOrNull()
            ?: runCatching { Typeface.createFromAsset(assets, "fonts/$assetName") }.getOrNull()

    if (typeface != null) {
      ReactFontManager.getInstance().addCustomFont(family, typeface)
    } else {
      SylkLogger.e("FONT: $family unavailable from res/font and assets/fonts -- icons will render as tofu")
    }
  }

  override fun onCreate() {
    super.onCreate()
    // Initialise the native log sink before anything else so calls
    // from boot-time SylkTelecom.register, FCM, etc. land on disk.
    SylkLogger.init(this)
    // Capture uncaught exceptions through SylkLogger so native crashes
    // appear in metro.log / the in-app log view (our logcat capture
    // filters to the SYLK_APP tag and would otherwise drop them).
    SylkLogger.installCrashHandler()

    // Icon fonts: register before any React view can ask for them (see
    // registerIconFont's comment for the RN fallback/caching trap).
    registerIconFont("MaterialDesignIcons", R.font.materialdesignicons, "MaterialDesignIcons.ttf")
    registerIconFont("FontAwesome", R.font.fontawesome, "FontAwesome.ttf")
    // RN 0.76: SoLoader.init now takes an SoMapping. OpenSourceMergedSoMapping
    // is the OSS default (replaces the old `SoLoader.init(this, false)` form).
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }

    // Enable react-native-webrtc's MediaProjection foreground service.
    // getDisplayMedia() screen capture only delivers frames while a
    // foregroundServiceType=mediaProjection service is running — and on
    // Android 14+ (API 34) the OS mandates it: without a running such
    // service the MediaProjection is torn down immediately. rn-webrtc ships
    // that service (MediaProjectionService, merged from its own manifest)
    // but gates *starting* it behind this opt-in flag, which defaults to
    // false. With the flag off, getDisplayMedia() still resolves with a
    // screen track but it produces ZERO frames and the video encoder stalls
    // (outbound video freezes; the far end sees nothing). Pairs with the
    // FOREGROUND_SERVICE_MEDIA_PROJECTION permission in AndroidManifest.xml.
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true

    // Flipper was removed in React Native 0.76, so there is no longer a
    // debug-only Flipper init here. (The previous concern — that
    // ReactNativeFlipper.initializeFlipper eagerly built the RN bridge at
    // Application.onCreate via reactNativeHost.reactInstanceManager, spinning
    // up AudioRouteModule/UnreadModule/etc. on a push-only process start — is
    // now moot; the bridge stays cold until MainActivity actually starts.)

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
