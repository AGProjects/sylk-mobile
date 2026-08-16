package com.agprojects.sylk

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Draws a brief pulsing marker on top of everything on THIS device's screen,
 * at a normalized (0..1, 0..1) coordinate. Used by the "remote pointer"
 * feature: while this device shares its screen in a 1-1 video call, the remote
 * helper taps the shared video; those normalized coordinates arrive over the
 * in-call message channel (application/sylk-pointer) and are drawn here so the
 * person being helped sees "tap here". The marker auto-fades after a few
 * seconds. Purely visual — it never injects touch (that would need an
 * AccessibilityService); the local user still does the tapping.
 *
 * Requires the SYSTEM_ALERT_WINDOW ("display over other apps") permission the
 * app already requests via SylkBridge; if it isn't granted, showPointer no-ops.
 */
class PointerOverlayModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var overlayView: PointerView? = null
    private var windowManager: WindowManager? = null
    private val removeRunnable = Runnable { removeOverlay() }

    override fun getName() = "PointerOverlay"

    @ReactMethod
    fun showPointer(xNorm: Double, yNorm: Double) {
        mainHandler.post {
            try {
                val ctx = reactApplicationContext
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
                    return@post
                }
                val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                windowManager = wm

                val metrics = DisplayMetrics()
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealMetrics(metrics)
                val sw = metrics.widthPixels
                val sh = metrics.heightPixels
                val px = (xNorm.coerceIn(0.0, 1.0) * sw).toFloat()
                val py = (yNorm.coerceIn(0.0, 1.0) * sh).toFloat()
                Log.i("SYLK_APP", "[pointer] recv norm=(" + xNorm + "," + yNorm + ") screen=" + sw + "x" + sh + " -> px=(" + px + "," + py + ")")

                if (overlayView == null) {
                    val view = PointerView(ctx)
                    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    else
                        @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
                    val lp = WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.MATCH_PARENT,
                        type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                    )
                    lp.gravity = Gravity.TOP or Gravity.START
                    wm.addView(view, lp)
                    overlayView = view
                }
                overlayView?.setPoint(px, py)
                mainHandler.removeCallbacks(removeRunnable)
                mainHandler.postDelayed(removeRunnable, 3200)
            } catch (e: Exception) {
                // best effort — never crash the app over a guide marker
            }
        }
    }

    @ReactMethod
    fun hidePointer() {
        mainHandler.post { removeOverlay() }
    }

    private fun removeOverlay() {
        try {
            val v = overlayView
            if (v != null) {
                windowManager?.removeView(v)
                overlayView = null
            }
        } catch (e: Exception) {
        }
    }

    // NativeEventEmitter compatibility no-ops (harmless if JS never subscribes).
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    /** A transparent full-screen view that draws a pulsing ring at the last point. */
    private class PointerView(context: Context) : View(context) {
        private var cx = -1f
        private var cy = -1f
        private var animStart = 0L
        private val density = resources.displayMetrics.density
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(120, 33, 150, 243); style = Paint.Style.FILL
        }
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(235, 33, 150, 243); style = Paint.Style.STROKE
            strokeWidth = 6f * density
        }

        fun setPoint(x: Float, y: Float) {
            cx = x; cy = y
            animStart = System.currentTimeMillis()
            invalidate()
        }

        private var offsetLogged = false
        override fun onDraw(canvas: Canvas) {
            if (cx < 0) return
            // The overlay window's top-left may not be physical (0,0) on
            // every device (e.g. inset by the status bar), which would make
            // the marker land ~status-bar-height too low. Subtract the view's
            // actual on-screen position so px/py (physical-screen coords) map
            // exactly, regardless of any window inset.
            val loc = IntArray(2)
            getLocationOnScreen(loc)
            if (!offsetLogged) {
                offsetLogged = true
                Log.i("SYLK_APP", "[pointer] overlay onScreen offset=(" + loc[0] + "," + loc[1] + ")")
            }
            val ox = loc[0].toFloat()
            val oy = loc[1].toFloat()
            val elapsed = (System.currentTimeMillis() - animStart).coerceAtLeast(0)
            val period = 900f
            val phase = ((elapsed % period.toLong()).toFloat()) / period // 0..1
            val baseR = 22f * density
            val pulseR = baseR + phase * baseR * 1.4f
            ring.alpha = (235 * (1f - phase)).toInt().coerceIn(0, 255)
            canvas.drawCircle(cx - ox, cy - oy, pulseR, ring)
            canvas.drawCircle(cx - ox, cy - oy, baseR * 0.45f, fill)
            postInvalidateOnAnimation()
        }
    }
}
