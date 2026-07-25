import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import Svg, { Rect } from 'react-native-svg';

// Traffic-stats bar charts for the in-call quality panel (imported as
// TrafficStats). Reimplemented 2026-07-23 on plain react-native-svg (already
// a dependency) after removing the dead react-native-svg-charts — that library
// pinned an ancient react-native-svg and blocked the svg 12→15 bump. The old
// usage was two trivial vertical bar charts, so a ~30-line Rect renderer
// replaces it 1:1 (no victory-native / Skia / reanimated needed).

// We deliberately don't import the SCSS module here. Its `.container`
// uses `margin: 0 auto` and `flex: 1`, neither of which translates
// reliably from sass to RN — the result was the bar charts taking up
// all the vertical space and the label rows getting pushed off-screen
// (or clipped by an ancestor with overflow:hidden). Use explicit RN
// styles below instead.

const CONTAINER_STYLE = {
    width: 170,
    alignSelf: 'center',
    paddingTop: 20,
    // No flex:1 — let the View shrink-wrap its children so the labels
    // have actual room to render below each chart.
};

const LABEL_WRAP = {
    width: '100%',
    paddingVertical: 2,
};

const LABEL_BASE = {
    fontSize: 11,
    textAlign: 'center',
    color: '#ffffff',
    backgroundColor: 'transparent',
};

// Minimal drop-in for react-native-svg-charts' <BarChart>: vertical bars, one
// per data point, spanning the measured width, scaled to the series max and
// growing from the bottom, with a small gap between bars and an optional
// top/bottom contentInset. Width is measured via onLayout (the old library
// auto-filled its parent's width, which here is the fixed 170-wide container).
const BarChart = ({ data, height, fill, contentInset }) => {
    const [width, setWidth] = React.useState(0);
    const inTop = (contentInset && contentInset.top) || 0;
    const inBottom = (contentInset && contentInset.bottom) || 0;
    const plotHeight = Math.max(0, height - inTop - inBottom);

    const values = (data || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const n = values.length || 1;
    // Guard against an all-zero series (flat baseline on a healthy call):
    // max of at least 1 avoids divide-by-zero and simply renders no visible
    // bars, matching the old library's flat-baseline behavior.
    const max = Math.max(1, ...values);

    // Matches react-native-svg-charts' default inner spacing (~0.05 gap).
    const step = width / n;
    const barWidth = step * 0.95;

    return (
        <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 ? (
                <Svg width={width} height={height}>
                    {values.map((val, i) => {
                        const barH = (val / max) * plotHeight;
                        const x = i * step + (step - barWidth) / 2;
                        const y = inTop + (plotHeight - barH);
                        return (
                            <Rect
                                key={i}
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barH}
                                fill={fill}
                            />
                        );
                    })}
                </Svg>
            ) : null}
        </View>
    );
};

const TrafficStats = (props) => {
    const { data, isTablet, isLandscape, isFolded, footer } = props;

    if (!data || !Array.isArray(data) || data.length === 0) {
        return <View style={CONTAINER_STYLE} />;
    }

    const latencyQueue = [...Array(30).fill(0), ...data.map(item => item.latency)].slice(-30);
    const packetLossQueue = [...Array(30).fill(0), ...data.map(item => (item.packetsLostInbound || 0) + (item.packetsLostOutbound || 0))].slice(-30);
    // Pick the most recent non-empty codec so a single early stats event
    // without codec info doesn't permanently kill the label below the
    // chart. Defaults to '' which the renderer below handles.
    const audioCodec = (
        [...data].reverse().find(d => d && d.audioCodec)?.audioCodec || ''
    ).toString();

    if (!packetLossQueue || !latencyQueue) {
        return <View style={CONTAINER_STYLE} />;
    }

    // (Removed: previously this hid stats on phone+landscape because the
    // single-column layout had no room. AudioCallBox now renders stats in
    // a dedicated right-hand column for landscape, so always show them.)

    // Make bar chart shorter when folded so both bars + labels fit the
    // available vertical room on the cover display.
    const chartHeight = isFolded ? 40 : 60;

    // Average last 3 packet loss values
    const currentLossNum = packetLossQueue
        .slice(-3)
        .reduce((a, b) => a + b, 0) / Math.min(3, packetLossQueue.length);

    // Average last 3 latency values
    let latency = latencyQueue
        .slice(-3)
        .reduce((a, b) => a + b, 0) / Math.min(3, latencyQueue.length);

    // (Removed the previous `if (!latency) return …` early-out — a
    //  zero or near-zero one-way latency reading is still valid info,
    //  and bailing out hid the codec label below the chart in calls
    //  where the peer-reported RTT was not available.)

    // Bar fill + text colors.
    //
    // Latency thresholds match the spec used by the audio speedometer
    // (orange ≥ 200ms, red ≥ 350ms).
    //
    // Packet-loss never goes green: any non-zero loss is at least
    // orange, and red kicks in at ≥ 5%. Only a strict zero-loss
    // reading shows green.
    let lossColor = '#2ecc71';
    let latencyColor = '#2ecc71';

    if (currentLossNum >= 5) {
        lossColor = '#e74c3c';
    } else if (currentLossNum > 0) {
        lossColor = '#e67e22';
    }

    if (latency >= 350) {
        latencyColor = '#e74c3c';
    } else if (latency >= 200) {
        latencyColor = '#e67e22';
    }

    // Only caption the packet-loss chart when there's actually loss to
    // report. On a healthy call (currentLossNum < 1) the bar chart is a
    // flat baseline, so a "No packet loss" label underneath it is just
    // noise — leave it off and let the empty graph speak for itself.
    // When loss is present we show the percentage.
    const hasLoss = currentLossNum >= 1;
    const lossLabel = hasLoss
        ? 'Packet loss ' + currentLossNum.toFixed(currentLossNum < 10 ? 1 : 0) + '%'
        : null;

    const codecLabel = audioCodec
        ? audioCodec.charAt(0).toUpperCase() + audioCodec.slice(1)
        : 'Audio';

    latency = Math.ceil(latency);

    return (
        <View style={CONTAINER_STYLE}>
            <BarChart
                height={chartHeight}
                data={latencyQueue}
                fill={latencyColor}
                contentInset={{ top: 5, bottom: 5 }}
            />
            <View style={LABEL_WRAP}>
                <Text style={[LABEL_BASE, { color: latencyColor }]}>
                    {codecLabel} - Latency {latency} ms
                </Text>
            </View>

            <BarChart
                height={chartHeight}
                data={packetLossQueue}
                fill={lossColor}
                contentInset={{ top: 5, bottom: 5 }}
            />
            {lossLabel ? (
                <View style={LABEL_WRAP}>
                    <Text style={[LABEL_BASE, { color: lossColor }]}>
                        {lossLabel}
                    </Text>
                </View>
            ) : null}
            {footer}
        </View>
    );
};

TrafficStats.propTypes = {
    isLandscape: PropTypes.bool,
    isTablet: PropTypes.bool,
    isFolded: PropTypes.bool,
    media: PropTypes.string,
    data: PropTypes.array.isRequired,
    footer: PropTypes.node,
};

export default TrafficStats;
