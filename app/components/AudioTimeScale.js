// AudioTimeScale.js
//
// Seconds axis rendered directly under the audio progress slider — the
// temporal sibling of SpectrumBarsView's kHz axis, and styled to match
// it (same SVG ticks, same 8/9px fonts and theme-aware colors) so the
// slider + spectrum read as a set.
//
// Behaviour (per spec):
//   - exactly 5 evenly-spaced markers from 0 .. durationSec,
//   - labelled in seconds (one decimal for clips < 10 s, whole seconds
//     otherwise so the numbers don't collide),
//   - a duration caption underneath (left) plus the "sec" unit (right),
//   - hidden entirely for short clips (< 3 s) where markers are clutter.
//
// Pure render: width + durationSec are the only inputs. The slider maps
// time→x linearly across the same width, so marker x = (t/dur)*width
// lines up with the needle position at that moment.

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Line, Text as SvgText } from 'react-native-svg';

import DarkModeManager from '../DarkModeManager';

const AXIS_H = 14;
const NUM_MARKERS = 5;
const MIN_DURATION_SEC = 3;   // shorter clips: no markers

export default function AudioTimeScale({ width = 240, durationSec = 0 }) {
    const _isDark = (() => {
        try { return !!DarkModeManager.getTheme().isDark; } catch (e) { return true; }
    })();
    const _baseline = _isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)';
    const _tick     = _isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.40)';
    const _axisText = _isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';
    const _capText  = _isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';

    const dur = durationSec > 0 ? durationSec : 0;
    // Short clip — no markers (would just be clutter).
    if (dur < MIN_DURATION_SEC) return null;

    const decimals = dur < 10;
    const fmt = (t, isLast) => {
        if (decimals) return t.toFixed(1);
        // Whole seconds for longer clips; floor the final marker so it
        // matches the duration caption (and the bubble's "Recording of
        // Ns" label) rather than rounding 12.6 up to 13.
        return String(isLast ? Math.floor(dur) : Math.round(t));
    };

    const xFor = (t) => (t / dur) * width;
    const marks = [];
    for (let i = 0; i < NUM_MARKERS; i++) {
        marks.push((dur * i) / (NUM_MARKERS - 1));
    }

    return (
        <View style={{ alignItems: 'center', marginTop: -8 }}>
            <Svg width={width} height={AXIS_H}>
                <Line x1={0} y1={0.5} x2={width} y2={0.5}
                      stroke={_baseline} strokeWidth={1} />
                {marks.map((t, i) => {
                    const isLast = i === NUM_MARKERS - 1;
                    const x = Math.max(0, Math.min(width, xFor(t)));
                    const anchor = i === 0 ? 'start' : (isLast ? 'end' : 'middle');
                    return (
                        <React.Fragment key={'tm-' + i}>
                            <Line x1={x} y1={0} x2={x} y2={3}
                                  stroke={_tick} strokeWidth={1} />
                            <SvgText x={x} y={AXIS_H - 2} fontSize={8}
                                     fill={_axisText} textAnchor={anchor}>
                                {fmt(t, isLast)}
                            </SvgText>
                        </React.Fragment>
                    );
                })}
            </Svg>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width }}>
                <Text style={{ fontSize: 9, color: _capText }}>Duration</Text>
                <Text style={{ fontSize: 9, color: _capText }}>sec</Text>
            </View>
        </View>
    );
}
