/**
 * CallRecorder — JS wrapper around the native SylkCallRecorder module.
 *
 *   ONE-TO-ONE calls
 *   ----------------
 *   Android: WebRTC AudioTrackSink → MediaCodec → Opus-OGG.
 *   iOS:     RTCAudioRenderer + AVAudioEngine → AVAssetWriter → AAC m4a.
 *   Both backends mix mic (L) + remote (R) into a stereo file. If the
 *   native module isn't ready (e.g. iOS remote track not attached yet)
 *   the start() call resolves to 'not_implemented' and the caller falls
 *   back to mic-only AAC capture via audioRecorderPlayer.
 *
 *     const path = await CallRecorder.start(call, '/abs/path/file.m4a');
 *     if (path === 'not_implemented') { ...fallback... }
 *     ...
 *     await CallRecorder.stop();
 *
 *   CONFERENCE calls
 *   ----------------
 *   Each remote participant has its own RTCPeerConnection (Janus
 *   VideoRoom multistream subscriber pattern), but downstream we keep
 *   the same stereo "mic L / remote R" layout the 1-to-1 path uses —
 *   the native conference-mix mode resamples every remote participant
 *   to 16 kHz mono Int16, sums them into a single R channel with
 *   int16 clip-guard, and feeds the result through the same Opus-OGG
 *   (Android) / AAC m4a (iOS) encoder the 1-to-1 recorder produces.
 *   The resulting file plays back in the existing audio chat bubble
 *   without any changes, and ffmpeg `-map_channel` can pull each side
 *   back out for transcription or post-processing if needed.
 *
 *     await CallRecorder.startConference(call, participants, outPath);
 *     await CallRecorder.addConferenceParticipant(p);     // late joiner
 *     await CallRecorder.removeConferenceParticipant(p);  // leaver
 *     const { path, peaks } = await CallRecorder.stopConference();
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

    // -------------------------------------------------------------
    // Conference recording — compressed stereo mix.
    //
    // Same file format as the 1-to-1 recorder (Opus-OGG on Android,
    // AAC m4a on iOS), L = mic, R = sum of all remote participants
    // with int16 clip-guard. Plays back in the existing audio chat
    // bubble without any changes, and post-processing (ffmpeg
    // -map_channel) can pull each side back out for transcription
    // or separation if needed.
    //
    //   startConference(call, participants, outputPath)
    //   addConferenceParticipant(p)         — late joiner
    //   removeConferenceParticipant(p)      — leaver
    //   stopConference()                    — returns { path, peaks }
    //
    // Late joiners are picked up live: the renderer + per-track
    // rolling buffer are allocated the moment addConferenceParticipant
    // resolves true. The native mixer step continues to run at the
    // writer cadence and starts including the new track on the next
    // tick. Leavers' renderers are detached immediately and any
    // unmixed bytes in their rolling buffer are dropped.
    // -------------------------------------------------------------

    /** True iff the native module exposes the compressed-mix API.
     *  Older builds without the conference path linked in fall back
     *  to "record button not shown" rather than throwing at runtime. */
    conferenceAvailable() {
        return !!(SylkCallRecorder
            && typeof SylkCallRecorder.startConference === 'function');
    },

    /** Begin a compressed-mix conference recording. Same return-shape
     *  contract as start(): resolves to the output path on success,
     *  to the literal "not_implemented" if the native side couldn't
     *  set up, rejects with an Error if the recorder failed to start. */
    async startConference(call, participants, outputPath) {
        if (!SylkCallRecorder
                || typeof SylkCallRecorder.startConference !== 'function') {
            return 'not_implemented';
        }
        if (!call) throw new Error('CallRecorder.startConference: call is required');
        if (!outputPath) throw new Error('CallRecorder.startConference: outputPath is required');

        const senders = (typeof call.getSenders === 'function')
            ? call.getSenders() : [];
        const mic = _findAudioTrack(senders);
        const micPcId    = mic ? mic.pcId    : -1;
        const micTrackId = mic ? mic.trackId : null;

        const remotes = [];
        if (Array.isArray(participants)) {
            for (const p of participants) {
                const entry = _confMixParticipantEntry(p);
                if (entry) remotes.push(entry);
            }
        }
        return await SylkCallRecorder.startConference(
            micPcId, micTrackId,
            remotes,
            outputPath
        );
    },

    /** Attach a remote participant mid-recording. Returns true if a
     *  new renderer was created, false if the participantId is
     *  already present, no audio track is on the receiver yet, or no
     *  recording is active. Callers are expected to retry on false
     *  (sylkrtc's participant.attach happens before WebRTC's ontrack
     *  fires, so the first attempt within a few ms of join can come
     *  up empty even on a valid participant). */
    async addConferenceParticipant(participant) {
        if (!SylkCallRecorder
                || typeof SylkCallRecorder.addConferenceRemote !== 'function') {
            return false;
        }
        const e = _confMixParticipantEntry(participant);
        if (!e) return false;
        try {
            const ok = await SylkCallRecorder.addConferenceRemote(
                e.pcId, e.trackId, e.participantId
            );
            return !!ok;
        } catch (err) {
            return false;
        }
    },

    /** Detach a participant from the mix. Their rolling buffer drops
     *  any unmixed bytes, the renderer comes off the audio track,
     *  and the next mixer tick stops including them. */
    async removeConferenceParticipant(participant) {
        if (!SylkCallRecorder
                || typeof SylkCallRecorder.removeConferenceRemote !== 'function') {
            return false;
        }
        if (!participant || !participant.id) return false;
        try {
            const ok = await SylkCallRecorder.removeConferenceRemote(
                String(participant.id)
            );
            return !!ok;
        } catch (err) {
            return false;
        }
    },

    /** Stop the recording. Returns the same `{ path, peaks }` shape
     *  the 1-to-1 stop() returns so the chat-bubble path can consume
     *  it without branching on which mode produced the file. */
    async stopConference() {
        if (!SylkCallRecorder
                || typeof SylkCallRecorder.stopConference !== 'function') {
            return { path: null, peaks: null };
        }
        const result = await SylkCallRecorder.stopConference();
        if (typeof result === 'string') {
            return { path: result, peaks: null };
        }
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

/** Resolve a sylkrtc Participant into the (pcId, trackId, participantId)
 *  tuple the compressed-mix native API expects. Returns null if the
 *  participant has no peer connection or no audio receiver yet — caller
 *  should retry later (e.g. on the participant's 'stateChanged' event).
 *  No display name / URI on this path because the compressed mix
 *  collapses every remote participant onto a single channel; nothing
 *  downstream is keyed per-participant. */
function _confMixParticipantEntry(participant) {
    if (!participant || !participant.id) return null;
    const pc = participant._pc;
    if (!pc || typeof pc.getReceivers !== 'function') return null;
    const audio = _findAudioTrack(pc.getReceivers());
    if (!audio) return null;
    return {
        pcId:          audio.pcId,
        trackId:       audio.trackId,
        participantId: String(participant.id),
    };
}

export default CallRecorder;
