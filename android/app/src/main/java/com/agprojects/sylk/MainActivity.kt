package com.agprojects.sylk

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.system.ErrnoException
import android.system.Os
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import io.wazo.callkeep.RNCallKeepModule

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "Sylk"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun invokeDefaultOnBackPressed() {
    // Instead of closing the app, put it in the background.
    moveTaskToBack(true)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      Os.setenv("EXTERNAL_STORAGE", getExternalFilesDir(null)?.absolutePath, true)
      System.loadLibrary("indy")
    } catch (e: ErrnoException) {
      e.printStackTrace()
    }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      RNCallKeepModule.REQUEST_READ_PHONE_STATE -> {
        RNCallKeepModule.onRequestPermissionsResult(requestCode, permissions, grantResults)
      }
    }
  }

  override fun onStart() {
    super.onStart()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      @Suppress("DEPRECATION")
      val wl = pm.newWakeLock(
        PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
        "myapp:wakeLock"
      )
      wl.acquire()

      window.addFlags(
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
          or WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
          or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
      )
    }
  }
}

