// SpectrumPlayback.js
//
// Renders a recorded spectrogram at a given playback position — the
// spectral companion to AudioWaveform. Pass the spectrum metadata
// (from spectrumCodec.encodeSpectrum / message metadata) plus the
// current progress, and it draws the frame for that moment through the
// shared SpectrumBarsView.
//
// Drive it from the same playback clock the waveform uses:
//   - progress (0..1) + durationSec  (preferred; exact frame), or
//   - positionSec directly.
//
// Decoding is memoised on the metadata object so scrubbing/ticking is
// cheap (just an array index per render).

import React, { useMemo } from 'react';

import SpectrumBarsView from './SpectrumBarsView';
import { decodeSpectrum } from './spectrumCodec';

const EMPTY = new Float32Array(16).fill(-120);

export default function SpectrumPlayback({
    spectrum,          // metadata object (or JSON string)
    progress = 0,      // 0..1
    positionSec,       // optional: overrides progress if provided
    durationSec = 0,
    width = 240,
    height = 64,
    label = 'Spectrum',
    fLow,              // optional axis overrides; fall back to metadata
    fHigh,
    ticksKHz,
}) {
    const decoded = useMemo(() => {
        let meta = spectrum;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch (e) { meta = null; }
        }
        return decodeSpectrum(meta);
    }, [spectrum]);

    if (!decoded || decoded.count <= 0) {
        return (
            <SpectrumBarsView
                bands={EMPTY}
                fLow={fLow}
                fHigh={fHigh}
                ticksKHz={ticksKHz}
                width={width}
                height={height}
                label={label}
            />
        );
    }

    const bands = (typeof positionSec === 'number')
        ? decoded.frameAtTime(positionSec)
        : decoded.frameAtProgress(progress, durationSec);

    return (
        <SpectrumBarsView
            bands={bands}
            fLow={fLow || decoded.fLow || undefined}
            fHigh={fHigh || decoded.fHigh || undefined}
            ticksKHz={ticksKHz || decoded.ticks || undefined}
            width={width}
            height={height}
            label={label}
        />
    );
}
