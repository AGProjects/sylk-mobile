package com.agprojects.sylk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class HeadsetBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_HEADSET_PLUG) {
            AudioRouteModule.onHeadsetEvent()
        }
    }
}
