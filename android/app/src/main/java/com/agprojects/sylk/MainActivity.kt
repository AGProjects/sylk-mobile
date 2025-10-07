package com.agprojects.sylk

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.os.PowerManager
import android.system.ErrnoException
import android.system.Os
import android.view.WindowManager
import androidx.appcompat.app.AlertDialog
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.wazo.callkeep.RNCallKeepModule

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "Sylk"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIncomingCallIntent(intent)
        requestDndPermission()

        try {
            Os.setenv("EXTERNAL_STORAGE", getExternalFilesDir(null)?.absolutePath, true)
        } catch (e: ErrnoException) {
            e.printStackTrace()
        }
    }

    private fun handleIncomingCallIntent(intent: Intent?) {
        if (intent == null) return

        val event = intent.getStringExtra("event")
        val callUUID = intent.getStringExtra("session-id")

        if (!event.isNullOrEmpty() && !callUUID.isNullOrEmpty()) {
            val reactInstanceManager: ReactInstanceManager =
                (application as ReactApplication).reactNativeHost.reactInstanceManager

            reactInstanceManager.addReactInstanceEventListener { reactContext: ReactContext ->
                val map = Arguments.createMap()
                map.putString("event", event)
                map.putString("callUUID", callUUID)
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("IncomingCallAction", map)

                Log.d("MainActivity", "[SYLK] Dict event sent to React Native: $map")
            }

            // Ensure React context is created if app was cold
            reactInstanceManager.createReactContextInBackground()
        }
    }

    private fun requestDndPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (!notificationManager.isNotificationPolicyAccessGranted) {
                AlertDialog.Builder(this)
                    .setTitle("Do Not Disturb Access Required")
                    .setMessage("Sylk needs permission to show incoming call notifications even when Do Not Disturb is on.")
                    .setPositiveButton("Grant") { _, _ ->
                        val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                        startActivity(intent)
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun invokeDefaultOnBackPressed() {
        moveTaskToBack(true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingCallIntent(intent)
        setIntent(intent)
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
