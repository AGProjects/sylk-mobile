// VuMeter.js
//
// A small, reusable LED-segment style horizontal VU meter. Used on:
//   1. AudioCallBox — live, driven by WebRTC inbound-rtp / media-source
//      audioLevel stats while a call is in progress.
//   2. ContactsListBox call-recording bubble — driven during playback
//      by either a synthetic oscillator (current default) or a real
//      peaks array embedded in the message metadata (future).
//
// 20 segments, color-graded green→yellow→red, with an optional
// caption underneath. Width is configurable so callers can size it
// to the parent (60% of screen on the call screen, slider-width on
// the bubble) without forking the component.
//
// Stateless / pure render — drive it by passing a fresh `level` (0..1)
// on every render. Smoothing should happen at the call site.

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';

const SEGMENTS = 20;

export default function VuMeter({ level, label, width = '60%', cellHeight = 8 }) {
    const lit = Math.min(SEGMENTS, Math.round((level || 0) * SEGMENTS));
    const cells = [];
    for (let i = 0; i < SEGMENTS; i++) {
        const isLit = i < lit;
        let color;
        if (i < SEGMENTS * 0.6) {
            color = isLit ? 'rgba(0, 200, 90, 0.95)'  : 'rgba(255,255,255,0.18)';
        } else if (i < SEGMENTS * 0.85) {
            color = isLit ? 'rgba(230, 180, 0, 0.95)' : 'rgba(255,255,255,0.18)';
        } else {
            color = isLit ? 'rgba(220, 30, 30, 0.95)' : 'rgba(255,255,255,0.18)';
        }
        cells.push(
            <View key={'vu-cell-' + i} style={{
                flex: 1,
                height: cellHeight,
                marginHorizontal: 1,
                borderRadius: 1,
                backgroundColor: color,
            }} />
        );
    }
    // Outer wrapper does NOT set alignSelf — that's the caller's job.
    // The call screen wraps two of these in a centred column; the chat
    // bubble wraps them in a column anchored to the same edge as the
    // slider above. By staying alignment-neutral here we let either
    // surface position the meter without forking the component.
    return (
        <View style={{
            width,
            alignItems: 'center',
            marginTop: 6,
        }}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'stretch',
            }}>
                {cells}
            </View>
            {label ? (
                <Text style={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 10,
                    marginTop: 2,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                }}>
                    {label}
                </Text>
            ) : null}
        </View>
    );
}
