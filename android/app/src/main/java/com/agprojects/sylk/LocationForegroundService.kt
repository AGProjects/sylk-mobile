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
        startInForeground()
        return START_STICKY
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
