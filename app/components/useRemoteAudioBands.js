// useRemoteAudioBands.js
//
// React hook that drives the live remote spectrum. It:
//   1. starts the native analyser (AudioSpectrum.start) for the given
//      call when `active` flips true,
//   2. subscribes to 'SylkAudioBands' DeviceEventEmitter events and
//      exposes the latest { bands, sampleRate, nyquist },
//   3. stops + unsubscribes on unmount or when `active` flips false.
//
// `bands` is a number[16] of dBFS-ish values (≈ -120..0). The native
// side already throttles to ~25 Hz, so re-render cost is bounded.

import { useEffect, useRef, useState } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';

import AudioSpectrum from './AudioSpectrum';
import { smoothBands } from './spectrumSmooth';

const { SylkAudioSpectrum } = NativeModules;

const EMPTY = new Array(16).fill(-120);

export function useRemoteAudioBands(call, active, fLowHz = 1000, fHighHz = 16000) {
    const [state, setState] = useState({ bands: EMPTY, sampleRate: 0, nyquist: 0 });
    const subRef = useRef(null);
    // Last DISPLAYED bands, so falls can be rate-limited across emits.
    const dispRef = useRef(EMPTY);

    useEffect(() => {
        if (!active || !call || !AudioSpectrum.available()) {
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

        // Range is fixed for the native session, so a codec change
        // (new fLow/fHigh) re-runs this effect and restarts with the
        // new band edges.
        AudioSpectrum.start(call, fLowHz, fHighHz)
            .catch(() => { /* track not ready / not sinkable */ });

        return () => {
            cancelled = true;
            if (subRef.current) { subRef.current.remove(); subRef.current = null; }
            AudioSpectrum.stop();
            dispRef.current = EMPTY;
            setState({ bands: EMPTY, sampleRate: 0, nyquist: 0 });
        };
    }, [call, active, fLowHz, fHighHz]);

    return state;
}

export default useRemoteAudioBands;
