// useMicAudioBands.js
//
// React hook driving the live LOCAL-MIC spectrum for the voice-message
// composer. When `active` is true it starts the native 48 kHz mic
// analyser (AudioSpectrum.startMic) and subscribes to 'SylkAudioBands'
// events; it stops + unsubscribes on unmount or when `active` flips
// false.
//
// `bands` is number[16] of dBFS-ish values (≈ -120..0). sampleRate is
// 48000 and nyquist 24000, so the bars show the mic's true bandwidth
// even though the sent .m4a is 16 kHz.
//
// Android only — on iOS AudioSpectrum.micAvailable() is false (a second
// capture can't open on the shared AVAudioSession), so the hook stays
// at floor and starts nothing.

import { useEffect, useRef, useState } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';

import AudioSpectrum from './AudioSpectrum';
import { smoothBands } from './spectrumSmooth';

const { SylkAudioSpectrum } = NativeModules;

const EMPTY = new Array(16).fill(-120);

export function useMicAudioBands(active) {
    const [state, setState] = useState({ bands: EMPTY, sampleRate: 0, nyquist: 0 });
    const subRef = useRef(null);
    // Last DISPLAYED bands, so falls can be rate-limited across emits.
    const dispRef = useRef(EMPTY);

    useEffect(() => {
        if (!active || !AudioSpectrum.micAvailable()) {
            return undefined;
        }

        let cancelled = false;
        dispRef.current = EMPTY;
        const emitter = new NativeEventEmitter(SylkAudioSpectrum);
        subRef.current = emitter.addListener('SylkAudioBands', (e) => {
            if (cancelled || !e || !e.bands) return;
            const smoothed = smoothBands(dispRef.current, e.bands);
            dispRef.current = smoothed;
            setState({
                bands: smoothed,
                sampleRate: e.sampleRate || 0,
                nyquist: e.nyquist || 0,
            });
        });

        AudioSpectrum.startMic().catch(() => { /* mic busy / not available */ });

        return () => {
            cancelled = true;
            if (subRef.current) { subRef.current.remove(); subRef.current = null; }
            AudioSpectrum.stopMic();
            dispRef.current = EMPTY;
            setState({ bands: EMPTY, sampleRate: 0, nyquist: 0 });
        };
    }, [active]);

    return state;
}

export default useMicAudioBands;
