import React, { Component } from 'react';

import { View } from 'react-native'
import { Text } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { BarChart, Grid, XAxis } from 'react-native-svg-charts'
import * as scale from 'd3-scale'

import styles from '../assets/styles/blink/_TrafficStats.scss';


class TrafficStats extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            audioBandwidthQueue: this.props.audioBandwidthQueue,
            videoBandwidthQueue: this.props.videoBandwidthQueue,
            packetLossQueue: this.props.packetLossQueue,
            latencyQueue: this.props.latencyQueue
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('packetLossQueue')) {
            this.setState({packetLossQueue: nextProps.packetLossQueue});
        }

        if (nextProps.hasOwnProperty('latencyQueue')) {
            this.setState({latencyQueue: nextProps.latencyQueue});
        }

        if (nextProps.hasOwnProperty('audioBandwidthQueue')) {
            this.setState({audioBandwidthQueue: nextProps.audioBandwidthQueue});
        }

        if (nextProps.hasOwnProperty('videoBandwidthQueue')) {
            this.setState({videoBandwidthQueue: nextProps.videoBandwidthQueue});
        }
    }

    render() {
        let showBv = false;
        this.state.audioBandwidthQueue.forEach(val => {
            if (val > 0) {
                showBv = true;
            }
        });

        let showLoss = false;
        this.state.packetLossQueue.forEach(val => {
            if (val > 0) {
                showLoss = true;
            }
        });

        if (!this.props.isTablet && this.props.orientation === 'landscape') {
            return (null);
        }

        const currentBandwidth = this.state.audioBandwidthQueue[this.state.audioBandwidthQueue.length-1] + ' kbit/s';

        let currentLoss = (this.state.packetLossQueue[this.state.packetLossQueue.length-1] +
                          this.state.packetLossQueue[this.state.packetLossQueue.length-2] +
                          this.state.packetLossQueue[this.state.packetLossQueue.length-3]
                          ) / 3;

        let latency = (this.state.latencyQueue[this.state.latencyQueue.length-1] +
                          this.state.latencyQueue[this.state.latencyQueue.length-2] +
                          this.state.latencyQueue[this.state.latencyQueue.length-3]
                          ) / 3;

        let lossColor = 'orange';

        if (currentLoss < 3) {
            currentLoss = 'No packet loss';
        } else {
            currentLoss = 'Packet loss ' + Math.ceil(currentLoss) + '%';
            if (currentLoss > 10) {
                lossColor = 'red';
            }
        }

        let latencyColor = 'green';

        if (latency) {
            if (latency > 175 && latency < 400) {
                latencyColor = 'orange';
            } else if (latency >= 400) {
                latencyColor = 'red';
            }
            latency = Math.ceil(latency);
        }

        if (!latency) {
            return (null);
        }

        return (
                <View style={styles.container}>
                <BarChart
                style = {{ height: 60}}
                data = { this.state.latencyQueue }
                svg = {{ fill: latencyColor }}
                contentInset={{ top: 5, bottom: 5 }}
                >
                </BarChart>
                <Text style={styles.text}>{this.props.audioCodec} latency {latency} ms</Text>

                <BarChart
                style = {{ height: 60}}
                data = { this.state.packetLossQueue }
                svg = {{ fill: lossColor }}
                contentInset={{ top: 5, bottom: 5 }}
                >
                </BarChart>
                { showLoss ?
                <Text style={styles.text}>{currentLoss}</Text>
                : null}

                </View>

        );
    }

}

TrafficStats.propTypes = {
    packetLossQueue         : PropTypes.array,
    videoBandwidthQueue     : PropTypes.array,
    audioBandwidthQueue     : PropTypes.array,
    latencyQueue            : PropTypes.array,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    media                   : PropTypes.string,
    audioCodec                   : PropTypes.string
};

export default TrafficStats
