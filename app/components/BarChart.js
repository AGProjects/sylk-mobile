import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import PropTypes from 'prop-types';
import { BarChart } from 'react-native-svg-charts';

import styles from '../assets/styles/blink/_TrafficStats.scss';


const TrafficStats = (props) => {
    const { data, isTablet, orientation } = props;

    if (!data || !Array.isArray(data) || data.length === 0) {
        return <View style={styles.container} />;
    }

    const latencyQueue = data.map(item => item.latency);
    const packetLossQueue = data.map(item => item.packetsLostInbound + item.packetsLostOutbound);
    const audioCodec = data[0].audioCodec;

    if (!packetLossQueue || !latencyQueue) {
        return <View style={styles.container} />;
    }

    if (!isTablet && orientation === 'landscape') {
        return <View style={styles.container} />;
    }

    const showLoss = packetLossQueue.some(val => val > 0);

    // Average last 3 packet loss values
    let currentLoss = packetLossQueue
        .slice(-3)
        .reduce((a, b) => a + b, 0) / Math.min(3, packetLossQueue.length);

    // Average last 3 latency values
    let latency = latencyQueue
        .slice(-3)
        .reduce((a, b) => a + b, 0) / Math.min(3, latencyQueue.length);

    if (!latency) {
        return <View style={styles.container} />;
    }

    // Colors
    let lossColor = 'orange';
    let latencyColor = 'green';

    if (currentLoss < 3) {
        currentLoss = 'No packet loss';
    } else {
        currentLoss = 'Packet loss ' + Math.ceil(currentLoss) + '%';
        if (currentLoss > 10) {
            lossColor = 'red';
        }
    }

    if (latency > 175 && latency < 400) {
        latencyColor = 'orange';
    } else if (latency >= 400) {
        latencyColor = 'red';
    }
    latency = Math.ceil(latency);
    return (
        <View style={styles.container}>
            <BarChart
                style={{ height: 60 }}
                data={latencyQueue}
                svg={{ fill: latencyColor }}
                contentInset={{ top: 5, bottom: 5 }}
            />
            <Text style={styles.text}>{audioCodec.charAt(0).toUpperCase()  + audioCodec.slice(1) } - Latency {latency} ms</Text>

            <BarChart
                style={{ height: 60 }}
                data={packetLossQueue}
                svg={{ fill: lossColor }}
                contentInset={{ top: 5, bottom: 5 }}
            />
            {showLoss && <Text style={styles.text}>{currentLoss}</Text>}
        </View>
    );
};

TrafficStats.propTypes = {
    orientation: PropTypes.string,
    isTablet: PropTypes.bool,
    media: PropTypes.string,
    data: PropTypes.array.isRequired
};

export default TrafficStats;

