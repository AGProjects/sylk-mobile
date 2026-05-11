/**
 * CallRecorder — JS wrapper around the native SylkCallRecorder module.
 *   Android: WebRTC AudioTrackSink → MediaCodec → Opus-OGG.
 *   iOS:     RTCAudioRenderer + AVAudioEngine → AVAssetWriter → AAC m4a.
 * Both backends mix mic (L) + remote (R) into a stereo file. If the
 * native module isn't ready (e.g. iOS remote track not attached yet)
 * the start() call resolves to 'not_implemented' and the caller falls
 * back to mic-only AAC capture via audioRecorderPlayer.
 *
 * Usage:
 *   const path = await CallRecorder.start(call, '/abs/path/file.m4a');
 *   if (path === 'not_implemented') { ...fallback... }
 *   ...
 *   await CallRecorder.stop();
 *
 * The call argument is a sylkrtc Call object; we walk its peer
 * connection's senders/receivers to find the audio tracks and pass the
 * (peerConnectionId, trackId) pairs to the native module.
 */

import { NativeModules, Platform } from 'react-native';

const { SylkCallRecorder } = NativeModules;

/** Find the first audio track on a list of senders or receivers.
 *  Returns { pcId, trackId } or null if no audio track exists. */
function _findAudioTrack(rtpEntries) {
    if (!rtpEntries || !rtpEntries.length) return null;
    for (const entry of rtpEntries) {
        const track = entry && entry.track;
        if (track && track.kind === 'audio' && track.id) {
            // Local tracks: native lookup uses pcId=-1 (see
            // react-native-webrtc MediaStream.ts line 102:
            // `track.remote ? track._peerConnectionId : -1`).
            // Remote tracks: use track._peerConnectionId.
            const pcId = track.remote
                ? (typeof track._peerConnectionId === 'number'
                    ? track._peerConnectionId : -1)
                : -1;
            return { pcId, trackId: track.id };
        }
    }
    return null;
}

const CallRecorder = {
    /** Available iff the native module is registered (Android always,
     *  iOS too now that we've moved to vanilla WebRTC-SDK and have
     *  the RTCAudioRenderer hook). False on non-RN platforms. */
    available() {
        return !!SylkCallRecorder;
    },

    /** Returns true on platforms where the native side actually
     *  records both legs (Android). False where the stub falls back
     *  to mic-only (iOS for now). */
    fullyImplemented() {
        return Platform.OS === 'android';
    },

    /** Start recording. Returns a promise that resolves to the output
     *  path on success, or to the literal string 'not_implemented' on
     *  iOS (caller should fall back to mic-only capture).
     */
    async start(call, outputPath) {
        if (!SylkCallRecorder) {
            return 'not_implemented';
        }
        if (!call) {
            throw new Error('CallRecorder.start: call is required');
        }

        // Resolve mic + remote audio tracks via the call's peer
        // connection. sylkrtc's Call exposes getSenders / getReceivers
        // which mirror RTCPeerConnection.
        const senders = (typeof call.getSenders === 'function') ? call.getSenders() : [];
        const receivers = (typeof call.getReceivers === 'function') ? call.getReceivers() : [];
        const mic = _findAudioTrack(senders);
        const remote = _findAudioTrack(receivers);

        if (!mic && !remote) {
            throw new Error('CallRecorder.start: no audio tracks on call');
        }

        const micPcId = mic ? mic.pcId : -1;
        const micTrackId = mic ? mic.trackId : null;
        const remotePcId = remote ? remote.pcId : -1;
        const remoteTrackId = remote ? remote.trackId : null;

        return await SylkCallRecorder.start(
            micPcId, micTrackId,
            remotePcId, remoteTrackId,
            outputPath
        );
    },

    /** Stop recording. Returns `{ path, peaks }` where `peaks` is
     *  `{ l: number[], r: number[] }` (each entry 0..255 representing
     *  the per-100 ms peak amplitude on that channel) or `null` if the
     *  current native build doesn't compute peaks. Backward compatible
     *  with the older bridge that returned a bare string path.
     */
    async stop() {
        if (!SylkCallRecorder) return { path: null, peaks: null };
        const result = await SylkCallRecorder.stop();
        // Older bridge: bare string path, no peaks.
        if (typeof result === 'string') {
            return { path: result, peaks: null };
        }
        // Newer bridge: { path, peaks } where peaks is a JSON string
        // built inside the native module. Parse + validate here so the
        // rest of the JS stack gets typed arrays without each caller
        // duplicating the try/catch.
        let peaks = null;
        if (result && typeof result.peaks === 'string') {
            try {
                const parsed = JSON.parse(result.peaks);
                if (parsed && Array.isArray(parsed.l) && Array.isArray(parsed.r)) {
                    peaks = parsed;
                }
            } catch (e) {
                peaks = null;
            }
        }
        return {
            path:  result && result.path ? result.path : null,
            peaks: peaks,
        };
    },
};

export default CallRecorder;
