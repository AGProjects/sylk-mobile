import React, { Component } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { BarChart } from 'react-native-svg-charts';

import styles from '../assets/styles/blink/_TrafficStats.scss';

class TrafficStats extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            audioBandwidthQueue: props.audioBandwidthQueue || [],
            videoBandwidthQueue: props.videoBandwidthQueue || [],
            packetLossQueue: props.packetLossQueue || [],
            latencyQueue: props.latencyQueue || []
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            audioBandwidthQueue: nextProps.audioBandwidthQueue || [],
            videoBandwidthQueue: nextProps.videoBandwidthQueue || [],
            packetLossQueue: nextProps.packetLossQueue || [],
            latencyQueue: nextProps.latencyQueue || []
        });
    }

    render() {
        const { audioBandwidthQueue, packetLossQueue, latencyQueue } = this.state;

        // Safety: don't crash if undefined
        if (!audioBandwidthQueue || !packetLossQueue || !latencyQueue) {
            return <View style={styles.container} />;
        }

        // Only hide charts in tablet landscape
        if (!this.props.isTablet && this.props.orientation === 'landscape') {
            return <View style={styles.container} />;
        }

        // Determine if we have data
        const showBv = audioBandwidthQueue.some(val => val > 0);
        const showLoss = packetLossQueue.some(val => val > 0);

        if (audioBandwidthQueue.length === 0) {
            return <View style={styles.container} />; // preserve layout
        }

        // Current bandwidth, loss, latency calculations
        const currentBandwidth = audioBandwidthQueue[audioBandwidthQueue.length - 1] + ' kbit/s';
        let currentLoss = packetLossQueue.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, packetLossQueue.length);
        let latency = latencyQueue.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, latencyQueue.length);

        // Colors
        let lossColor = 'orange';
        let latencyColor = 'green';

        if (currentLoss < 3) currentLoss = 'No packet loss';
        else {
            currentLoss = 'Packet loss ' + Math.ceil(currentLoss) + '%';
            if (currentLoss > 10) lossColor = 'red';
        }

        if (latency) {
            if (latency > 175 && latency < 400) latencyColor = 'orange';
            else if (latency >= 400) latencyColor = 'red';
            latency = Math.ceil(latency);
        } else {
            return <View style={styles.container} />;
        }

        return (
            <View style={styles.container}>
                <BarChart
                    style={{ height: 60 }}
                    data={latencyQueue}
                    svg={{ fill: latencyColor }}
                    contentInset={{ top: 5, bottom: 5 }}
                />
                <Text style={styles.text}>{this.props.audioCodec} latency {latency} ms</Text>

                <BarChart
                    style={{ height: 60 }}
                    data={packetLossQueue}
                    svg={{ fill: lossColor }}
                    contentInset={{ top: 5, bottom: 5 }}
                />
                {showLoss && <Text style={styles.text}>{currentLoss}</Text>}
            </View>
        );
    }
}

TrafficStats.propTypes = {
    packetLossQueue: PropTypes.array,
    videoBandwidthQueue: PropTypes.array,
    audioBandwidthQueue: PropTypes.array,
    latencyQueue: PropTypes.array,
    orientation: PropTypes.string,
    isTablet: PropTypes.bool,
    media: PropTypes.string,
    audioCodec: PropTypes.string
};

export default TrafficStats;

