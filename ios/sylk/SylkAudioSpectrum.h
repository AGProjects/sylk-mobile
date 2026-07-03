#import <Foundation/Foundation.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * iOS live remote-audio spectrum analyser. The counterpart of the
 * Android SylkAudioSpectrum: it taps the remote RTCAudioTrack via
 * WebRTC's RTCAudioRenderer protocol (renderPCMBuffer:) — the same
 * post-decode point the call recorder uses — runs a windowed FFT and
 * emits 16 log-spaced band energies (dBFS-ish) over a per-session
 * display range [fLow, fHigh] as 'SylkAudioBands' events.
 *
 * The display range is set by the caller from the negotiated codec
 * (Opus 2-16k, G.722 1-8k, G.711 0.5-4k), so the bars zoom to the
 * codec's band. On iOS webrtc-sdk delivers Int16 mono at 48 kHz, so
 * every range is representable regardless of the codec.
 *
 * JS bridge name: "SylkAudioSpectrum" — same as Android, so
 * AudioSpectrum.js / useRemoteAudioBands work unchanged. The local-mic
 * (startMic/stopMic) path is Android-only for now and intentionally
 * not exported here, so AudioSpectrum.micAvailable() stays false on
 * iOS and the voice-message mic spectrum sits at floor.
 */
@interface SylkAudioSpectrum : RCTEventEmitter <RCTBridgeModule>
@end

NS_ASSUME_NONNULL_END
