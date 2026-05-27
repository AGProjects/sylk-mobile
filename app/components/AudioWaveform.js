// AudioWaveform.js
//
// Static stereo amplitude bar-graph for the call-recording bubble.
// Reads the per-100ms peaks shipped in message.metadata.peaks
// (computed by SylkCallRecorder.writerLoop) and renders them as a
// horizontal column of bars: remote (R) growing up from a centre
// line, local mic (L) growing down. Width matches the slider above
// it so you can read the loudness pattern alongside the playback
// position.
//
// Bars to the LEFT of the current playback position render in the
// slider's orange — they're the "played" portion of the audio.
// Bars to the RIGHT render dim — the "unplayed" portion. Like the
// slider's fill, but vertically encoding level too.
//
// Pure render — `peaks` and `progress` are the only inputs. Safe to
// re-render on every parent state change; the bars are simple Views
// and React reconciles the colour swap cheaply.

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';

// Default colors when the caller doesn't override. The waveform
// renders the played portion in `playedColor` and the unplayed
// portion in a faint white so you can read both channels at a
// glance even on the unplayed side. Caller can pass `playedColor`
// to give each channel its own hue (Remote one shade, Local
// another) so the two strips are distinguishable.
const DEFAULT_PLAYED   = 'orange';
const DEFAULT_UNPLAYED = 'rgba(255, 255, 255, 0.35)';

/**
 * Distil a peaks array down to `barCount` buckets by max-pooling
 * adjacent entries. Returns a Float-ish array of `barCount` values
 * each 0..1. If the source already has fewer than barCount entries
 * we just normalise & pad with zeroes.
 */
function downsample(src, barCount) {
    const out = new Array(barCount).fill(0);
    if (!src || src.length === 0) return out;
    const ratio = src.length / barCount;
    if (ratio <= 1) {
        // Source is shorter than the bar grid. Stretch by repeating.
        for (let i = 0; i < barCount; i++) {
            const j = Math.min(src.length - 1, Math.floor(i * ratio));
            out[i] = (src[j] || 0) / 255;
        }
        return out;
    }
    for (let i = 0; i < barCount; i++) {
        const from = Math.floor(i * ratio);
        const to   = Math.min(src.length, Math.floor((i + 1) * ratio));
        let peak = 0;
        for (let j = from; j < to; j++) {
            const v = src[j] || 0;
            if (v > peak) peak = v;
        }
        out[i] = peak / 255;
    }
    return out;
}

export default function AudioWaveform({
    peaks,
    progress = 0,
    width,
    height = 36,
    barCount = 60,
    gap = 1,
    channel = null,         // null = stereo mirror, 'l' = local only, 'r' = remote only
    label = null,           // optional caption rendered under the strip
    // Caption colour for the "Remote" / "Local" label below each strip.
    // Defaults to the legacy white-on-dark tone for callers that haven't
    // opted in to theming yet (keeps old call sites on dark surfaces
    // looking identical). The audio bubble passes a dark tint in Day
    // mode so the captions stay readable on the white bubble.
    labelColor = 'rgba(255,255,255,0.55)',
    playedColor = DEFAULT_PLAYED,
    unplayedColor = DEFAULT_UNPLAYED,
}) {
    const COLOR_PLAYED   = playedColor;
    const COLOR_UNPLAYED = unplayedColor;
    if (!peaks
        || !Array.isArray(peaks.l)
        || !Array.isArray(peaks.r)
        || peaks.l.length === 0) {
        // No peaks → draw a flat dim baseline so it's obvious the
        // strip is in place, just empty. Helps diagnose "I can't
        // see the waveform" — if you see the line, peaks are
        // missing from the metadata; if you don't see the line,
        // the component isn't being rendered at all.
        return (
            <View style={{
                width, height,
                justifyContent: 'center',
                alignItems: 'stretch',
            }}>
                <View style={{
                    height: 1,
                    backgroundColor: COLOR_UNPLAYED,
                }} />
            </View>
        );
    }

    // Fraction of the strip that should render in "played" colour.
    const playedFrac = Math.max(0, Math.min(1, (progress || 0) / 100));
    const playedThru = playedFrac * barCount;

    // Single-channel mode: bars grow from a baseline at the bottom.
    // Used when the bubble shows separate Remote / Local waveforms
    // stacked. Cleaner to read than a tiny mirrored strip.
    if (channel === 'l' || channel === 'r') {
        const data = downsample(channel === 'r' ? peaks.r : peaks.l, barCount);
        // Normalize so the loudest moment of the recording fills
        // the strip's full height. Without this a quietly-recorded
        // voice memo (peaks max=0.25 out of 1.0) renders as ~25%-
        // tall bars max — looks like a flat line with one taller
        // tick. Multiplier rescales so the loudest bin = 1.0 = full
        // height. Falls back to no scaling for completely-silent
        // input (avoids divide-by-zero).
        let dataMax = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > dataMax) dataMax = data[i];
        }
        const norm = dataMax > 0.001 ? (1 / dataMax) : 1;
        const bars = [];
        for (let i = 0; i < barCount; i++) {
            const isPlayed = i < playedThru;
            const colour = isPlayed ? COLOR_PLAYED : COLOR_UNPLAYED;
            // Reserve at least 1 px so silent regions still draw a
            // baseline tick rather than disappearing entirely.
            const h = Math.max(1, Math.min(height, data[i] * norm * height));
            bars.push(
                <View key={'wf-' + channel + '-' + i} style={{
                    flex: 1,
                    marginHorizontal: gap / 2,
                    height,
                    justifyContent: 'flex-end',
                }}>
                    <View style={{
                        height: h,
                        backgroundColor: colour,
                        borderTopLeftRadius: 1,
                        borderTopRightRadius: 1,
                    }} />
                </View>
            );
        }
        return (
            <View style={{ width }}>
                <View style={{
                    width,
                    height,
                    flexDirection: 'row',
                    alignItems: 'flex-end',
                }}>
                    {bars}
                </View>
                {label ? (
                    <Text style={{
                        color: labelColor,
                        fontSize: 9,
                        marginTop: 1,
                        letterSpacing: 0.4,
                        textTransform: 'uppercase',
                    }}>
                        {label}
                    </Text>
                ) : null}
            </View>
        );
    }

    // Stereo mirror mode (default). Top half = remote, bottom half =
    // local, mirrored around a 1px centre gap.
    const remote = downsample(peaks.r, barCount);
    const local  = downsample(peaks.l, barCount);
    const halfH = (height - 1) / 2;

    // Per-channel normalization so each side fills its half-height
    // independently — keeps quiet recordings legible without
    // squashing a loud side against the other.
    let rMax = 0, lMax = 0;
    for (let i = 0; i < barCount; i++) {
        if (remote[i] > rMax) rMax = remote[i];
        if (local[i]  > lMax) lMax = local[i];
    }
    const rNorm = rMax > 0.001 ? (1 / rMax) : 1;
    const lNorm = lMax > 0.001 ? (1 / lMax) : 1;

    const bars = [];
    for (let i = 0; i < barCount; i++) {
        const isPlayed = i < playedThru;
        const colour = isPlayed ? COLOR_PLAYED : COLOR_UNPLAYED;
        const rH = Math.max(1, Math.min(halfH, remote[i] * rNorm * halfH));
        const lH = Math.max(1, Math.min(halfH, local[i]  * lNorm * halfH));
        bars.push(
            <View key={'wf-' + i} style={{
                flex: 1,
                marginHorizontal: gap / 2,
                height,
            }}>
                <View style={{ height: halfH - rH }} />
                <View style={{
                    height: rH,
                    backgroundColor: colour,
                    borderTopLeftRadius: 1,
                    borderTopRightRadius: 1,
                }} />
                <View style={{ height: 1 }} />
                <View style={{
                    height: lH,
                    backgroundColor: colour,
                    borderBottomLeftRadius: 1,
                    borderBottomRightRadius: 1,
                }} />
            </View>
        );
    }

    return (
        <View style={{
            width,
            height,
            flexDirection: 'row',
            alignItems: 'center',
        }}>
            {bars}
        </View>
    );
}
