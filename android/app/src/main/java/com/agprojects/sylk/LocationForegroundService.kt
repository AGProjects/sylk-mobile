package com.agprojects.sylk

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Foreground service that keeps the JS engine alive and the process
// promoted past background throttling while the user is sharing live
// location. Android 14+ (API 34) requires:
//   - FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION permissions in
//     AndroidManifest.
//   - <service> declaration with foregroundServiceType="location".
//   - startForeground() called with ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION.
//
// We mirror CallForegroundService's shape (same package layout, same
// NotificationCompat.Builder pattern) so the existing Sylk Kotlin
// conventions stay consistent.
class LocationForegroundService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // INSTRUMENTED. Whether this service is actually running decides
        // whether the process keeps its network while the screen is off. A
        // field log that shows location ticks being produced but never
        // delivered needs to be able to answer "was the FGS up?" without a
        // debugger, so both the request and the outcome are written to the
        // APPLOG via SylkLogger (Log.d alone does not reach the exported file).
        SylkLogger.d("[location] [fgs] onStartCommand flags=$flags startId=$startId")
        try {
            startInForeground()
            SylkLogger.d("[location] [fgs] startForeground OK (type=location) — process promoted, network should survive screen-off")
        } catch (t: Throwable) {
            // On API 34+ a missing FOREGROUND_SERVICE_LOCATION permission or a
            // start-from-background restriction throws here. Silently losing
            // this is precisely how the process ends up firewalled with no
            // explanation in the log.
            SylkLogger.e("[location] [fgs] startForeground FAILED — sharing will run WITHOUT foreground promotion", t)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        SylkLogger.d("[location] [fgs] service destroyed — foreground promotion released")
        super.onDestroy()
    }

    private fun startInForeground() {
        val channelId = "location_service_channel"

        val notificationManager =
            getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Live Location Sharing",
                NotificationManager.IMPORTANCE_LOW
            )
            notificationManager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Sharing live location")
            .setContentText("Sylk is sharing your location with a contact.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // On API 29+ startForeground accepts an explicit type. Passing
            // FOREGROUND_SERVICE_TYPE_LOCATION is what allows the process
            // to keep receiving location updates while backgrounded.
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        // Distinct from CallForegroundService's id (1) so the two can
        // coexist (call + location share at the same time).
        private const val NOTIFICATION_ID = 2
    }
}
