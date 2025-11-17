package com.agprojects.sylk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import com.facebook.react.bridge.*
import java.util.*

class ThumbnailServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val pending = HashMap<String, Promise>()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ThumbnailService.ACTION_RESULT) return

            val requestId = intent.getStringExtra(ThumbnailService.EXTRA_REQUEST_ID)
            if (requestId == null || !pending.containsKey(requestId)) return

            val promise = pending.remove(requestId)
            val resultPath = intent.getStringExtra(ThumbnailService.EXTRA_RESULT_PATH)
            val error = intent.getStringExtra(ThumbnailService.EXTRA_RESULT_ERROR)

            if (resultPath != null) {
                promise?.resolve(resultPath)
            } else {
                promise?.reject("THUMBNAIL_ERROR", error ?: "unknown_error")
            }
        }
    }

    override fun getName(): String = "ThumbnailServiceModule"

    override fun initialize() {
        super.initialize()
        reactApplicationContext.registerReceiver(receiver, IntentFilter(ThumbnailService.ACTION_RESULT))
    }

    override fun onCatalystInstanceDestroy() {
        reactApplicationContext.unregisterReceiver(receiver)
        super.onCatalystInstanceDestroy()
    }

    @ReactMethod
    fun extract(
        uri: String,
        timestampMs: Double,
        maxWidth: Int,
        maxHeight: Int,
        format: String?,
        promise: Promise
    ) {
        val ctx = reactApplicationContext
        val requestId = UUID.randomUUID().toString()
        pending[requestId] = promise

        val intent = Intent(ctx, ThumbnailService::class.java)
        intent.action = ThumbnailService.ACTION_EXTRACT
        intent.putExtra(ThumbnailService.EXTRA_REQUEST_ID, requestId)
        intent.putExtra(ThumbnailService.EXTRA_URI, uri)
        intent.putExtra(ThumbnailService.EXTRA_TIMESTAMP_MS, timestampMs.toLong())
        intent.putExtra(ThumbnailService.EXTRA_MAX_WIDTH, maxWidth)
        intent.putExtra(ThumbnailService.EXTRA_MAX_HEIGHT, maxHeight)
        intent.putExtra(ThumbnailService.EXTRA_FORMAT, format ?: "jpeg")

        ctx.startService(intent)
    }
}
