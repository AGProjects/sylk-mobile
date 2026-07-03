// spectrumSmooth.js
//
// Fast-attack / slow-release smoothing for the spectrum bars, so a
// band that drops doesn't vanish instantly — it falls back gradually
// like a classic analyser. Rising values jump up immediately (no
// attack lag); falling values are clamped to drop at most
// RELEASE_DB_PER_FRAME each emit.
//
// The native side emits ~25 frames/s (EMIT_INTERVAL_MS = 40 ms), so a
// release of ~3.5 dB/frame ≈ 88 dB/s — a bar at the top of the
// display range (~70 dB span) falls to the floor in ~0.8 s: a quick
// but still visible tail. Tune RELEASE_DB_PER_FRAME for faster/slower
// decay (higher = snappier).

export const RELEASE_DB_PER_FRAME = 3.5;

// Returns a new array where each band rises instantly to `next` but
// falls no faster than RELEASE_DB_PER_FRAME from `prev`.
export function smoothBands(prev, next, releaseDb = RELEASE_DB_PER_FRAME) {
    if (!next) return prev;
    if (!prev || prev.length !== next.length) return next.slice();
    const out = new Array(next.length);
    for (let i = 0; i < next.length; i++) {
        const n = next[i];
        const p = prev[i];
        // Fast attack: rise (or equal) -> take the new value as-is.
        // Slow release: fall -> step down by at most releaseDb, but
        // never below the new (true) value.
        out[i] = (n >= p) ? n : Math.max(n, p - releaseDb);
    }
    return out;
}

export default smoothBands;
