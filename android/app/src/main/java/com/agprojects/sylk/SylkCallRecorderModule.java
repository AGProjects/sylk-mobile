package com.agprojects.sylk;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
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

    // ---------------------------------------------------------------
    // Conference recording — compressed stereo mix (mic L, all
    // remotes summed on R). Same Opus-OGG container the 1-to-1
    // recorder produces, so the existing audio chat bubble can play
    // it back without any changes.
    //
    // Delegates to SylkCallRecorder (the 1-to-1 recorder) — its
    // pipeline already produces stereo Opus-OGG; the only addition
    // is the in-class "N remote tracks summed before writer" path
    // wired up in startConference().
    // ---------------------------------------------------------------

    @ReactMethod
    public void startConference(int micPcId, String micTrackId,
                                ReadableArray remotes,
                                String outputPath,
                                Promise promise) {
        try {
            WebRTCModule webrtc = mReactContext.getNativeModule(WebRTCModule.class);
            if (webrtc == null) {
                promise.reject("ENOWEBRTC", "WebRTCModule not available");
                return;
            }
            MediaStreamTrack mic = (micTrackId != null)
                ? webrtc.getTrack(micPcId, micTrackId) : null;
            java.util.List<SylkCallRecorder.RemoteEntry> entries = new java.util.ArrayList<>();
            if (remotes != null) {
                for (int i = 0; i < remotes.size(); i++) {
                    ReadableMap m = remotes.getMap(i);
                    if (m == null) continue;
                    int pcId = m.hasKey("pcId") ? m.getInt("pcId") : -1;
                    String trackId = m.hasKey("trackId") ? m.getString("trackId") : null;
                    String pid     = m.hasKey("participantId") ? m.getString("participantId") : "";
                    if (trackId == null) continue;
                    MediaStreamTrack track = webrtc.getTrack(pcId, trackId);
                    if (track == null) continue;
                    entries.add(new SylkCallRecorder.RemoteEntry(track, pid));
                }
            }
            boolean ok = SylkCallRecorder.getInstance().startConference(mic, entries, outputPath);
            if (!ok) {
                promise.resolve("not_implemented");
                return;
            }
            promise.resolve(outputPath);
        } catch (IllegalStateException e) {
            promise.reject("EBUSY", e.getMessage());
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] startConference failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void addConferenceRemote(int pcId, String trackId,
                                    String participantId,
                                    Promise promise) {
        try {
            WebRTCModule webrtc = mReactContext.getNativeModule(WebRTCModule.class);
            if (webrtc == null) {
                promise.reject("ENOWEBRTC", "WebRTCModule not available");
                return;
            }
            MediaStreamTrack track = (trackId != null)
                ? webrtc.getTrack(pcId, trackId) : null;
            if (track == null) { promise.resolve(false); return; }
            boolean ok = SylkCallRecorder.getInstance().addConferenceRemote(
                new SylkCallRecorder.RemoteEntry(track, participantId));
            promise.resolve(ok);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] addConferenceRemote failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void removeConferenceRemote(String participantId, Promise promise) {
        try {
            boolean ok = SylkCallRecorder.getInstance().removeConferenceRemote(participantId);
            promise.resolve(ok);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] removeConferenceRemote failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void stopConference(Promise promise) {
        // Conference-mix mode uses the same stop() path as the 1-to-1
        // recorder — the writer thread drains, the muxer finalises the
        // OGG, peaks are computed inline. We forward to the existing
        // stop() and return the same { path, peaks } shape so JS
        // doesn't have to care which mode produced the file.
        try {
            String path  = SylkCallRecorder.getInstance().stop();
            String peaks = SylkCallRecorder.getInstance().getLastPeaksJson();
            WritableMap result = Arguments.createMap();
            result.putString("path", path);
            if (peaks != null) result.putString("peaks", peaks);
            promise.resolve(result);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] stopConference failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

}
