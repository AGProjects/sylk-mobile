package com.agprojects.sylk;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import com.oney.WebRTCModule.WebRTCModule;

import org.webrtc.MediaStreamTrack;

/**
 * React Native bridge for SylkCallRecorder. The JS layer hands us
 * (micPcId, micTrackId, remotePcId, remoteTrackId, outputPath) — we
 * resolve those to AudioTrack instances via WebRTCModule.getTrack
 * (which is a public method that handles both local pcId=-1 and
 * remote pcId>=0 cases) and start the recorder.
 */
public class SylkCallRecorderModule extends ReactContextBaseJavaModule {
    // metro-logs.sh filters logcat strictly on tag SYLK_APP — keep
    // the tag uniform so any Log.x calls in this file land in
    // metro.log alongside the rest of the native traces.
    private static final String TAG = "SYLK_APP";

    private final ReactApplicationContext mReactContext;

    public SylkCallRecorderModule(ReactApplicationContext reactContext) {
        super(reactContext);
        mReactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "SylkCallRecorder";
    }

    @ReactMethod
    public void start(int micPcId, String micTrackId,
                      int remotePcId, String remoteTrackId,
                      String outputPath, Promise promise) {
        try {
            WebRTCModule webrtc = mReactContext.getNativeModule(WebRTCModule.class);
            if (webrtc == null) {
                promise.reject("ENOWEBRTC", "WebRTCModule not available");
                return;
            }

            MediaStreamTrack mic = (micTrackId != null)
                ? webrtc.getTrack(micPcId, micTrackId) : null;
            MediaStreamTrack remote = (remoteTrackId != null)
                ? webrtc.getTrack(remotePcId, remoteTrackId) : null;

            if (mic == null && remote == null) {
                promise.reject("ENOTRACK", "Neither mic nor remote track resolved");
                return;
            }

            boolean ok = SylkCallRecorder.getInstance().start(mic, remote, outputPath);
            if (!ok) {
                // Tracks resolved but neither was an org.webrtc.AudioTrack
                // we can sink — fall back via the JS wrapper.
                promise.resolve("not_implemented");
                return;
            }
            promise.resolve(outputPath);
        } catch (IllegalStateException e) {
            promise.reject("EBUSY", e.getMessage());
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] start failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void stop(Promise promise) {
        try {
            String path  = SylkCallRecorder.getInstance().stop();
            // The recorder builds the peaks JSON synchronously inside
            // stop(), so it's available the moment the call returns.
            // Older JS clients that expect a bare-string result still
            // work — see CallRecorder.stop() in CallRecorder.js, which
            // accepts both shapes.
            String peaks = SylkCallRecorder.getInstance().getLastPeaksJson();
            WritableMap result = Arguments.createMap();
            result.putString("path", path);
            if (peaks != null) {
                result.putString("peaks", peaks);
            }
            promise.resolve(result);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] stop failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }
}
