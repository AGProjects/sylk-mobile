package com.agprojects.sylk;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.oney.WebRTCModule.WebRTCModule;

import org.webrtc.MediaStreamTrack;

/**
 * React Native bridge for SylkAudioSpectrum — the live remote-audio
 * band analyser. Mirrors SylkCallRecorderModule's track-resolution
 * (WebRTCModule.getTrack(pcId, trackId)) but, instead of writing a
 * file, streams NUM_BANDS log-spaced band energies to JS as
 * "SylkAudioBands" DeviceEventEmitter events while the call is up.
 *
 * JS usage:
 *   import { NativeModules, NativeEventEmitter } from 'react-native';
 *   const { SylkAudioSpectrum } = NativeModules;
 *   const emitter = new NativeEventEmitter(SylkAudioSpectrum);
 *   const sub = emitter.addListener('SylkAudioBands', e => {
 *       // e.bands: number[16] (dBFS, ~ -120..0)
 *       // e.sampleRate: native codec rate (8000/16000/48000)
 *       // e.nyquist: sampleRate / 2 — top band's upper edge
 *   });
 *   await SylkAudioSpectrum.start(remotePcId, remoteTrackId);
 *   ...
 *   await SylkAudioSpectrum.stop();
 *   sub.remove();
 */
public class SylkAudioSpectrumModule extends ReactContextBaseJavaModule
        implements SylkAudioSpectrum.BandsListener, SylkMicSpectrum.BandsListener {

    private final ReactApplicationContext mReactContext;
    private SylkAudioSpectrum mAnalyzer;
    private SylkMicSpectrum mMicAnalyzer;

    public SylkAudioSpectrumModule(ReactApplicationContext reactContext) {
        super(reactContext);
        mReactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "SylkAudioSpectrum";
    }

    @ReactMethod
    public void start(int remotePcId, String remoteTrackId,
                      double fLowHz, double fHighHz, Promise promise) {
        try {
            WebRTCModule webrtc = mReactContext.getNativeModule(WebRTCModule.class);
            if (webrtc == null) {
                promise.reject("ENOWEBRTC", "WebRTCModule not available");
                return;
            }
            MediaStreamTrack remote = (remoteTrackId != null)
                ? webrtc.getTrack(remotePcId, remoteTrackId) : null;
            if (remote == null) {
                promise.reject("ENOTRACK", "Remote track not resolved");
                return;
            }
            synchronized (this) {
                if (mAnalyzer != null) mAnalyzer.stop();
                mAnalyzer = new SylkAudioSpectrum(this);
                boolean ok = mAnalyzer.start(remote, fLowHz, fHighHz);
                if (!ok) {
                    mAnalyzer = null;
                    // Track resolved but isn't a sinkable AudioTrack.
                    promise.resolve("not_implemented");
                    return;
                }
            }
            promise.resolve(true);
        } catch (Throwable t) {
            SylkLogger.e("[call] [spectrum] start failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void stop(Promise promise) {
        try {
            synchronized (this) {
                if (mAnalyzer != null) {
                    mAnalyzer.stop();
                    mAnalyzer = null;
                }
            }
            promise.resolve(true);
        } catch (Throwable t) {
            SylkLogger.e("[call] [spectrum] stop failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    // ---------------------------------------------------------------
    // Local mic spectrum (voice-message composer). Opens its own
    // AudioRecord @48kHz in parallel with the recorder so the live
    // view shows the mic's TRUE bandwidth (~24 kHz) while recording.
    // Emits the same 'SylkAudioBands' event as the remote path.
    // ---------------------------------------------------------------
    @ReactMethod
    public void startMic(Promise promise) {
        try {
            synchronized (this) {
                if (mMicAnalyzer != null) mMicAnalyzer.stop();
                mMicAnalyzer = new SylkMicSpectrum(this);
                boolean ok = mMicAnalyzer.start();
                if (!ok) {
                    mMicAnalyzer = null;
                    // Mic busy / can't open a second capture — UI no-ops.
                    promise.resolve("not_implemented");
                    return;
                }
            }
            promise.resolve(true);
        } catch (Throwable t) {
            SylkLogger.e("[mic] [spectrum] start failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    @ReactMethod
    public void stopMic(Promise promise) {
        try {
            synchronized (this) {
                if (mMicAnalyzer != null) {
                    mMicAnalyzer.stop();
                    mMicAnalyzer = null;
                }
            }
            promise.resolve(true);
        } catch (Throwable t) {
            SylkLogger.e("[mic] [spectrum] stop failed", t);
            promise.reject("EFAIL", t.getMessage());
        }
    }

    // RN NativeEventEmitter bookkeeping — no-ops, but required so the
    // JS-side addListener/removeListeners don't log "no method" warnings.
    @ReactMethod public void addListener(String eventName) { }
    @ReactMethod public void removeListeners(int count) { }

    // -----------------------------------------------------------------
    // BandsListener — called from the analyser (WebRTC audio thread).
    // -----------------------------------------------------------------
    @Override
    public void onBands(float[] dbBands, int sampleRate) {
        if (!mReactContext.hasActiveReactInstance()) return;
        WritableArray arr = Arguments.createArray();
        for (float v : dbBands) arr.pushDouble(v);
        WritableMap ev = Arguments.createMap();
        ev.putArray("bands", arr);
        ev.putInt("sampleRate", sampleRate);
        ev.putInt("nyquist", sampleRate / 2);
        mReactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit("SylkAudioBands", ev);
    }

    @Override
    public void onCatalystInstanceDestroy() {
        synchronized (this) {
            if (mAnalyzer != null) { mAnalyzer.stop(); mAnalyzer = null; }
            if (mMicAnalyzer != null) { mMicAnalyzer.stop(); mMicAnalyzer = null; }
        }
    }
}
