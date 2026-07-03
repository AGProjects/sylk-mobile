/**
 * AudioSpectrum — JS wrapper around the native SylkAudioSpectrum
 * module (android/app/src/main/java/com/agprojects/sylk/
 * SylkAudioSpectrum*.java).
 *
 * Same idea as CallRecorder.js: resolve the remote audio track on the
 * call's peer connection to a (peerConnectionId, trackId) pair and
 * hand it to the native analyser, which attaches an AudioTrackSink and
 * streams 16 log-spaced band energies back as 'SylkAudioBands' events.
 *
 * Unlike the recorder this analyses the remote PCM at its NATIVE codec
 * rate (no 16 kHz downsample), so the band edges scale to the live
 * Nyquist — that's what lets you actually see how wideband the remote
 * mic is in real time.
 */
import { NativeModules, Platform } from 'react-native';

const { SylkAudioSpectrum } = NativeModules;

// iOS local-mic spectrum runs a parallel AVAudioEngine input tap
// alongside the AVAudioRecorder that writes the voice-message .m4a.
// On some iOS versions that second capture can disturb the recorder —
// the symptom is `new Sound(recordedFile)` failing afterwards with
// kAudioFileUnspecifiedError ("Failed to load the audio"). Flip this to
// false (JS reload only, no native rebuild) to disable the iOS mic tap
// and confirm whether it's the cause: if the load error disappears,
// the engine is to blame and we should move the iOS mic spectrum to
// post-recording file analysis instead. Android is unaffected.
const IOS_MIC_SPECTRUM_ENABLED = true;

/** Find the first audio track on a list of receivers.
 *  Returns { pcId, trackId } or null. Mirrors CallRecorder._findAudioTrack. */
function _findRemoteAudioTrack(rtpEntries) {
    if (!rtpEntries || !rtpEntries.length) return null;
    for (const entry of rtpEntries) {
        const track = entry && entry.track;
        if (track && track.kind === 'audio' && track.id) {
            const pcId = track.remote
                ? (typeof track._peerConnectionId === 'number'
                    ? track._peerConnectionId : -1)
                : -1;
            return { pcId, trackId: track.id };
        }
    }
    return null;
}

// Ref-count so overlapping mounts (e.g. a foldable rendering both the
// folded cover layout and the main layout for a frame mid-fold) don't
// stop the singleton native analyser out from under a still-mounted
// consumer. Native start() only fires on 0 -> 1, stop() on 1 -> 0.
let _refs = 0;
let _micRefs = 0;

const AudioSpectrum = {
    /** Native module present (Android; iOS once the RTCAudioRenderer
     *  sink lands in SylkAudioSpectrum.m). */
    available() {
        return !!SylkAudioSpectrum;
    },

    /** Start streaming bands for the remote leg of `call` over the
     *  display range [fLowHz, fHighHz] (the 16 bars are log-spaced
     *  across it). Pass the codec-derived range so the bars zoom to
     *  the codec's band. Ref-counted: the first caller attaches the
     *  native sink; subsequent callers just bump the count. Resolves
     *  true on success, or 'not_implemented' if the remote track isn't
     *  a sinkable native AudioTrack. */
    async start(call, fLowHz = 1000, fHighHz = 16000) {
        if (!SylkAudioSpectrum) return 'not_implemented';
        if (!call) throw new Error('AudioSpectrum.start: call is required');

        _refs += 1;
        if (_refs > 1) return true; // already running

        const receivers = (typeof call.getReceivers === 'function')
            ? call.getReceivers() : [];
        const remote = _findRemoteAudioTrack(receivers);
        if (!remote) {
            _refs -= 1;
            throw new Error('AudioSpectrum.start: no remote audio track');
        }
        try {
            return await SylkAudioSpectrum.start(
                remote.pcId, remote.trackId, fLowHz, fHighHz);
        } catch (e) {
            _refs -= 1;
            throw e;
        }
    },

    /** Decrement the ref-count; detach the native sink only when the
     *  last consumer goes away. */
    async stop() {
        if (!SylkAudioSpectrum) return;
        if (_refs > 0) _refs -= 1;
        if (_refs > 0) return; // other consumers still mounted
        try {
            await SylkAudioSpectrum.stop();
        } catch (e) {
            // best-effort; call may already be torn down
        }
    },

    /** True iff the native LOCAL-MIC analyser is available. Android
     *  only for now — iOS can't open a second capture on the shared
     *  audio session (see SylkMicSpectrum / ReadyBox notes). */
    micAvailable() {
        if (Platform.OS === 'ios' && !IOS_MIC_SPECTRUM_ENABLED) return false;
        return !!(SylkAudioSpectrum
            && typeof SylkAudioSpectrum.startMic === 'function');
    },

    /** Start the live local-mic spectrum (48 kHz, ~24 kHz top band),
     *  for the voice-message composer. Emits the same 'SylkAudioBands'
     *  events. Ref-counted so the live bars and the SpectrumRecorder
     *  collector can both keep the mic analyser alive. Resolves
     *  'not_implemented' if the mic can't be opened for a second
     *  capture. */
    async startMic() {
        if (!this.micAvailable()) return 'not_implemented';
        _micRefs += 1;
        if (_micRefs > 1) return true;
        try {
            return await SylkAudioSpectrum.startMic();
        } catch (e) {
            _micRefs -= 1;
            throw e;
        }
    },

    async stopMic() {
        if (!this.micAvailable()) return;
        if (_micRefs > 0) _micRefs -= 1;
        if (_micRefs > 0) return;
        try {
            await SylkAudioSpectrum.stopMic();
        } catch (e) {
            // best-effort
        }
    },
};

export default AudioSpectrum;
