#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * iOS call recorder. Mirrors the Android SylkCallRecorder native module:
 *
 *  - Remote leg: tapped via WebRTC's RTCAudioRenderer protocol on the
 *    remote RTCAudioTrack — fires post-decode at the negotiated sample
 *    rate, exactly the same point the Android AudioTrackSink fires.
 *    This is only available now that we've moved iOS off JitsiWebRTC
 *    (which strips RTCAudioRenderer from the public Obj-C headers)
 *    onto the vanilla WebRTC-SDK pod.
 *
 *  - Local leg: mic captured via AVAudioEngine's input tap. WebRTC's
 *    own audio session capture coexists fine with an additional tap;
 *    iOS audio framework permits multiple consumers on the input
 *    node within the same process.
 *
 *  - A writer queue pairs mic + remote 100 ms-ish slices, interleaves
 *    them stereo (L = mic, R = remote), and writes them to a 16 kHz
 *    stereo PCM .wav. Peaks per channel are computed inline while
 *    walking the samples and shipped back to JS as a compact JSON
 *    string — same shape as Android's getLastPeaksJson().
 *
 *  - `start` returns the output path on success (peaks come out of
 *    `stop`). Returns the literal "not_implemented" if we can't
 *    resolve a remote audio track via the WebRTCModule, so the JS
 *    wrapper falls back to mic-only react-native-audio-record.
 */
@interface SylkCallRecorder : NSObject <RCTBridgeModule>
@end

NS_ASSUME_NONNULL_END
