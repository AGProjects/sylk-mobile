// MicSpectrumBars.js
//
// Live 16-band spectrum of the LOCAL MIC, for the voice-message
// composer (ReadyBox). Mount it while recording with `active` true —
// it drives the native 48 kHz mic analyser via useMicAudioBands and
// renders through the shared SpectrumBarsView.
//
// Because the tap runs at 48 kHz, the bars reach ~24 kHz and show the
// microphone's TRUE bandwidth — even though the sent voice message is
// AAC 16 kHz (capped at 8 kHz). A faint marker isn't drawn here; the
// label just reports the live top frequency.
//
// Android only; on iOS the hook stays at floor (see useMicAudioBands).

import React from 'react';

import SpectrumBarsView from './SpectrumBarsView';
import { useMicAudioBands } from './useMicAudioBands';

export default function MicSpectrumBars({
    active = true,
    width = 240,
    height = 64,
    label = 'Mic spectrum',
}) {
    // The native mic analyser uses a fixed 1-16 kHz range, so we let
    // SpectrumBarsView fall back to its matching defaults (range +
    // ticks) rather than passing a codec-derived scale.
    const { bands } = useMicAudioBands(active);
    return (
        <SpectrumBarsView
            bands={bands}
            width={width}
            height={height}
            label={label}
        />
    );
}
