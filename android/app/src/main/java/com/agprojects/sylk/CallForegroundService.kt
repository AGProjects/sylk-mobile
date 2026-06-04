package com.agprojects.sylk

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class CallForegroundService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        // NOT_STICKY: if the process is killed (low memory, user swipes
        // the app from recents, OS background restrictions), DO NOT let
        // Android recreate this service on its own. A previous
        // START_STICKY return caused a zombie "Call in progress / Your
        // microphone is active" notification: the OS would recreate the
        // service with a null intent after the process died, the new
        // instance would immediately re-post the ongoing notification,
        // and because setOngoing(true) makes it un-swipeable the user
        // had no way to clear it. The service must only ever run while
        // JS explicitly asked for it via startService().
        return START_NOT_STICKY
    }

    // When the user swipes the app away from recents the JS bridge dies
    // without getting a chance to call CallForegroundServiceModule
    // .stopService(), so the foreground service (and its un-dismissible
    // ongoing notification) would otherwise be left running. Tear it
    // down explicitly here. If a real call is still in progress this is
    // the right call too — losing the JS bridge means the call is
    // already broken.
    override fun onTaskRemoved(rootIntent: Intent?) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    private fun startInForeground() {
        val channelId = "call_service_channel"

        val notificationManager =
            getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Ongoing Call",
                NotificationManager.IMPORTANCE_LOW
            )
            notificationManager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Call in progress")
            .setContentText("Your microphone is active.")
            .setSmallIcon(android.R.drawable.presence_audio_online)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // On Android 14+ (API 34) startForeground() must be called
            // with an explicit foregroundServiceType matching the one
            // declared in AndroidManifest (microphone), otherwise the
            // platform throws and the service silently dies — which
            // leaves the audio session in an undefined state. Pass it
            // explicitly from API 29+ to mirror LocationForegroundService.
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 1
    }
}
