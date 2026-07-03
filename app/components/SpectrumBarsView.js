// SpectrumBarsView.js
//
// Presentational 16-band spectrum display. Pure render — pass it a
// `bands` array (dBFS-ish, ~ -120..0) and the `nyquist` of the source
// and it draws one vertical bar per log-spaced band, with a kHz
// frequency axis underneath so the log scale is readable. Shared by:
//   - SpectrumBars      (remote call leg, live)
//   - MicSpectrumBars   (local mic, live, voice-message composer)
//
// The band edges MUST match the native analyser (SylkAudioSpectrum /
// SylkMicSpectrum): NUM_BANDS log-spaced bands from F_LOW up to the
// source Nyquist. We recompute the same edges here purely to label the
// axis — the bar heights themselves come from the native `bands`.
//
// Reading the bandwidth at a glance:
//   bars roll off ~3-4 kHz   -> narrowband (PSTN / G.711)
//   energy up to ~8 kHz      -> wideband (G.722 / Opus WB / 16 kHz mic)
//   energy up to ~20-24 kHz  -> fullband (48 kHz Opus / true mic)

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';

import DarkModeManager from '../DarkModeManager';

const NUM_BANDS = 16;

// Default display scale if a caller doesn't pass one. The actual range
// is provided per-render via the fLow/fHigh props so it can track the
// negotiated codec (must match the native analyser's range for that
// session). Defaults match the local-mic analyser (1-16 kHz).
const DEFAULT_F_LOW_HZ = 1000;
const DEFAULT_F_HIGH_HZ = 16000;
const DEFAULT_TICKS_KHZ = [1, 2, 4, 8, 12, 16];

// dB range mapped to bar height.
const DB_MIN = -90;
const DB_MAX = -20;

// Height reserved under the bars for the kHz axis labels.
const AXIS_H = 14;

function dbToFrac(db) {
    if (db == null || !isFinite(db)) return 0;
    const f = (db - DB_MIN) / (DB_MAX - DB_MIN);
    return f < 0 ? 0 : f > 1 ? 1 : f;
}

function colorFor(frac) {
    // green -> yellow -> red, matching the VuMeter palette.
    if (frac < 0.6) return 'rgba(0, 200, 90, 0.95)';
    if (frac < 0.85) return 'rgba(230, 180, 0, 0.95)';
    return 'rgba(220, 30, 30, 0.95)';
}

// Index of the bar whose log band contains the given frequency (kHz)
// on the [fLow, fHigh] scale, so the label sits under the right bar.
// Matches the native band-edge formula
//   f(i) = fLow * (fHigh/fLow)^(i/NUM_BANDS).
function barIndexForKHz(khz, fLow, fHigh) {
    const ratio = Math.pow(fHigh / fLow, 1 / NUM_BANDS);
    let idx = Math.floor(Math.log((khz * 1000) / fLow) / Math.log(ratio));
    if (idx < 0) idx = 0;
    if (idx > NUM_BANDS - 1) idx = NUM_BANDS - 1;
    return idx;
}

export default function SpectrumBarsView({
    bands,
    fLow = DEFAULT_F_LOW_HZ,
    fHigh = DEFAULT_F_HIGH_HZ,
    ticksKHz = DEFAULT_TICKS_KHZ,
    width = 240,
    height = 70,
    label = 'Spectrum',
    showScale = true,
}) {
    // Theme-aware axis chrome — same convention as VuMeter: white-based
    // marks on dark surfaces, channel-flipped to black-based on the
    // light Day surfaces so the labels/ticks/baseline don't wash out.
    // Bar colours (green/yellow/red) read at high contrast either way,
    // so they're left untouched.
    const _isDark = (() => {
        try { return !!DarkModeManager.getTheme().isDark; } catch (e) { return true; }
    })();
    const _baseline = _isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)';
    const _tick     = _isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.40)';
    const _axisText = _isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';
    const _capText  = _isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';

    const n = NUM_BANDS;
    const gap = 2;
    const barW = (width - gap * (n - 1)) / n;
    const barH = height; // drawing area for the bars
    const svgH = barH + (showScale ? AXIS_H : 0);

    // kHz ticks, each aligned to the bar containing that frequency on
    // the active [fLow, fHigh] scale.
    const ticks = showScale
        ? (ticksKHz || []).map((khz) => ({ khz, i: barIndexForKHz(khz, fLow, fHigh) }))
        : [];

    const barCenterX = (i) => i * (barW + gap) + barW / 2;

    return (
        <View style={{ alignItems: 'center' }}>
            <Svg width={width} height={svgH}>
                {/* baseline */}
                <Line x1={0} y1={barH - 0.5} x2={width} y2={barH - 0.5}
                      stroke={_baseline} strokeWidth={1} />
                {Array.from({ length: n }).map((_, i) => {
                    const frac = dbToFrac(bands && bands[i]);
                    const h = Math.max(1, frac * (barH - 2));
                    return (
                        <Rect
                            key={'sb-' + i}
                            x={i * (barW + gap)}
                            y={barH - h}
                            width={barW}
                            height={h}
                            rx={1}
                            fill={colorFor(frac)}
                        />
                    );
                })}
                {showScale && ticks.map(({ khz, i }) => (
                    <React.Fragment key={'tick-' + khz}>
                        <Line
                            x1={barCenterX(i)} y1={barH}
                            x2={barCenterX(i)} y2={barH + 3}
                            stroke={_tick} strokeWidth={1}
                        />
                        <SvgText
                            x={barCenterX(i)}
                            y={barH + AXIS_H - 2}
                            fontSize={8}
                            fill={_axisText}
                            textAnchor="middle"
                        >
                            {khz}
                        </SvgText>
                    </React.Fragment>
                ))}
            </Svg>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width }}>
                <Text style={{ fontSize: 9, color: _capText }}>{label}</Text>
                <Text style={{ fontSize: 9, color: _capText }}>kHz</Text>
            </View>
        </View>
    );
}
