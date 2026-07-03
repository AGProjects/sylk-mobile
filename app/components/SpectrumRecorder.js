// SpectrumRecorder.js
//
// Collects a spectrogram (per-frame 16-band energies) during a
// recording so it can be stored alongside the audio and animated on
// playback — the spectral sibling of the waveform `peaks`.
//
// It subscribes to the native 'SylkAudioBands' event stream (the same
// one the live bars use), throttles to spectrumCodec.RATE_HZ, quantises
// each frame, and accumulates up to FRAME_CAP frames. It also keeps the
// underlying analyser alive via AudioSpectrum's ref-counted start so
// capture works even when the live bars aren't on screen (e.g. a call
// recording while the user is on a different in-call view).
//
// Usage (voice messages only — call recordings compute their spectrum
// natively in SylkCallRecorder now):
//   await SpectrumRecorder.startMic({ fLow, fHigh, ticks });
//   ... recording ...
//   const meta = await SpectrumRecorder.stop();   // -> metadata or null
//
// Single in-flight session, so this is a module-level singleton.

import { NativeModules, NativeEventEmitter } from 'react-native';

import AudioSpectrum from './AudioSpectrum';
import { encodeSpectrum, quantizeFrame, RATE_HZ, FRAME_CAP } from './spectrumCodec';

const { SylkAudioSpectrum } = NativeModules;

let _sub = null;
let _frames = [];          // [{ t: epochMs, q: Uint8Array(BANDS) }]
let _lastKeptMs = 0;
let _opts = null;
let _mode = null;          // 'mic' | 'remote'
let _t0 = 0;               // audio-start anchor (epoch ms), set by markStart()
// Capture a bit faster than the stored RATE_HZ so the resample grid in
// stop() always has a real sample within half a grid step. The wire
// format still stores RATE_HZ frames.
const _minGapMs = 1000 / (RATE_HZ * 2);

function _attachListener() {
    if (_sub || !SylkAudioSpectrum) return;
    const emitter = new NativeEventEmitter(SylkAudioSpectrum);
    _sub = emitter.addListener('SylkAudioBands', (e) => {
        if (!e || !e.bands) return;
        const now = Date.now();
        if (now - _lastKeptMs < _minGapMs) return;   // throttle
        if (_frames.length >= FRAME_CAP * 2) return;  // size cap (raw)
        _lastKeptMs = now;
        _frames.push({ t: now, q: quantizeFrame(e.bands) });
    });
}

// Resample irregularly-timed captured frames onto a uniform RATE_HZ
// grid spanning [0, spanMs], anchored at the audio start (_t0). This is
// what makes playback line up with what you hear:
//   - frames captured before t0 (analyser warm-up) are dropped, so the
//     stored spectrum starts with real energy instead of a flat head;
//   - the grid covers the FULL recording duration, so the spectrum
//     no longer runs out before the audio ends (the frozen-tail bug);
//   - each grid slot takes the nearest captured frame, so uneven
//     native cadence / dropped frames no longer cause drift.
function _resampleToGrid(frames, t0, spanMs) {
    // Rebase to audio-relative time, dropping the analyser warm-up
    // pre-roll captured before the audio anchor (t0).
    const rel = [];
    for (let i = 0; i < frames.length; i++) {
        const r = frames[i].t - t0;
        // Keep only frames at/after the audio anchor. Everything before
        // it is analyser warm-up (pre-roll), which is exactly the flat
        // head we want to drop so frame 0 carries real energy at t=0.
        if (r >= 0) rel.push({ t: r, q: frames[i].q });
    }
    if (!rel.length) {
        // Nothing after t0 (very short take / late anchor) — fall back
        // to whatever we captured so we don't lose the spectrum entirely.
        for (let i = 0; i < frames.length; i++) {
            rel.push({ t: Math.max(0, frames[i].t - (frames[0] ? frames[0].t : t0)), q: frames[i].q });
        }
    }
    rel.sort((a, b) => a.t - b.t);

    const lastT = rel[rel.length - 1].t;
    let span = (spanMs && spanMs > 0) ? spanMs : (lastT + 1000 / RATE_HZ);
    if (span <= 0) span = 1000 / RATE_HZ;

    let count = Math.round((span / 1000) * RATE_HZ);
    if (count < 1) count = 1;
    if (count > FRAME_CAP) count = FRAME_CAP;

    const out = new Array(count);
    let j = 0;
    for (let k = 0; k < count; k++) {
        const gt = (k / RATE_HZ) * 1000;   // grid time in ms
        // Advance to the last captured frame at or before gt.
        while (j + 1 < rel.length && rel[j + 1].t <= gt) j++;
        let idx = j;
        // Pick whichever of the bracketing frames is closer in time.
        if (j + 1 < rel.length) {
            if (Math.abs(rel[j + 1].t - gt) < Math.abs(rel[idx].t - gt)) idx = j + 1;
        }
        out[k] = rel[idx].q;
    }
    return out;
}

function _detachListener() {
    if (_sub) { _sub.remove(); _sub = null; }
}

const SpectrumRecorder = {
    available() {
        return !!SylkAudioSpectrum;
    },

    /** Begin collecting from the local mic analyser. */
    async startMic(opts = {}) {
        await this._begin('mic', opts);
        if (AudioSpectrum.micAvailable()) {
            try { await AudioSpectrum.startMic(); } catch (e) { /* best-effort */ }
        }
    },

    // NOTE: startRemote() (remote-leg capture for call recordings) was
    // removed — call recordings now compute their spectrogram natively in
    // SylkCallRecorder, from the same PCM they encode, so it's aligned with
    // the waveform. This JS analyser path remains only for voice messages
    // (startMic). The 'remote' mode branch in stop() is kept as a harmless
    // no-op in case any caller reappears.

    async _begin(mode, opts) {
        // If a previous session was left open, tear it down first.
        if (_mode) { try { await this.stop(); } catch (e) {} }
        _mode = mode;
        _opts = opts || {};
        _frames = [];
        _lastKeptMs = 0;
        // Default the anchor to "now" so a caller that never calls
        // markStart() still gets a sane (if warm-up-inclusive) timeline.
        _t0 = Date.now();
        _attachListener();
    },

    /**
     * Mark the moment audio recording actually begins. Frames captured
     * before this (analyser warm-up) are discarded by stop(), and the
     * playback grid is measured from here — so the first stored frame
     * carries real energy at audio t=0 instead of a flat warm-up frame.
     * Call right after startRecorder() resolves.
     */
    markStart() {
        _t0 = Date.now();
    },

    /** Stop collecting and return the encoded spectrum metadata (or
     *  null if nothing was captured). Releases the analyser ref.
     *  Pass the recorded audio duration in ms (e.g. the recorder's
     *  last reported elapsed) so the spectrum is resampled to cover the
     *  whole clip; omit it to span only up to the last captured frame. */
    async stop(durationMs) {
        const mode = _mode;
        const opts = _opts || {};
        const frames = _frames;
        const t0 = _t0;
        _detachListener();
        _mode = null;
        _opts = null;
        _frames = [];
        _t0 = 0;

        if (mode === 'mic') {
            try { await AudioSpectrum.stopMic(); } catch (e) {}
        } else if (mode === 'remote') {
            try { await AudioSpectrum.stop(); } catch (e) {}
        }

        if (!frames || !frames.length) return null;
        // Resample the irregular, warm-up-padded capture onto a uniform
        // RATE_HZ grid anchored at audio start so playback stays in sync.
        const grid = _resampleToGrid(frames, t0, durationMs);
        if (!grid || !grid.length) return null;
        return encodeSpectrum(grid, {
            fLow: opts.fLow,
            fHigh: opts.fHigh,
            ticks: opts.ticks,
        });
    },
};

export default SpectrumRecorder;
