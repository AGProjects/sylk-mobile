// SpectrumBars.js
//
// Live 16-band spectrum for the REMOTE leg of a call. Subscribes to
// the native 'SylkAudioBands' events (see AudioSpectrum.js +
// SylkAudioSpectrum*.java) via useRemoteAudioBands and renders them
// through the shared SpectrumBarsView. Used in AudioCallBox's meter
// cycle. Pure react-native-svg — no Skia needed.
//
// The display range zooms to the negotiated codec's band (the 16 bars
// are log-spaced across it), so narrowband legs aren't squeezed into
// the bottom few bars:
//   Opus  -> 2 kHz .. 16 kHz
//   G.722 -> 1 kHz .. 8 kHz
//   G.711 (PCMU/PCMA) -> 0.5 kHz .. 4 kHz

import React from 'react';

import SpectrumBarsView from './SpectrumBarsView';
import { useRemoteAudioBands } from './useRemoteAudioBands';

// Map the codec (from WebRTC mimeType, e.g. "opus", "G722", "PCMU") to
// a display range + the kHz axis ticks to draw across it.
export function codecSpectrum(codec) {
    const c = (codec || '').toLowerCase();
    if (c.indexOf('opus') !== -1) {
        return { fLow: 2000, fHigh: 16000, ticks: [2, 4, 8, 10, 12, 14] };
    }
    if (c.indexOf('g722') !== -1) {
        return { fLow: 1000, fHigh: 8000, ticks: [1, 2, 3, 4, 6, 8] };
    }
    if (c.indexOf('pcmu') !== -1 || c.indexOf('pcma') !== -1
            || c.indexOf('g711') !== -1) {
        return { fLow: 500, fHigh: 4000, ticks: [0.5, 1, 2, 3, 4] };
    }
    // Unknown / not yet reported — sensible wideband default.
    return { fLow: 1000, fHigh: 16000, ticks: [1, 2, 4, 8, 12, 16] };
}

export default function SpectrumBars({
    call,
    active = true,
    codec = '',
    width = 240,
    height = 70,
    label,
}) {
    const { fLow, fHigh, ticks } = codecSpectrum(codec);
    const { bands } = useRemoteAudioBands(call, active, fLow, fHigh);
    const _label = label || (codec ? `Remote · ${codec}` : 'Remote spectrum');
    return (
        <SpectrumBarsView
            bands={bands}
            fLow={fLow}
            fHigh={fHigh}
            ticksKHz={ticks}
            width={width}
            height={height}
            label={_label}
        />
    );
}
