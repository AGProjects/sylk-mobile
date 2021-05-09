import React, { useState, useEffect, useRef, Fragment, Component } from 'react';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';

import momentFormat from 'moment-duration-format';
import { Text, Appbar } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import styles from '../assets/styles/blink/_ConferenceHeader.scss';


class ConferenceHeader extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            callState: this.props.call ? this.props.call.state : null,
            participants: this.props.participants,
            reconnectingCall: this.props.reconnectingCall,
            info: this.props.info
        }

        this.duration = null;
        this.timer = null;
        this._isMounted = false;
    }

    componentDidMount() {
        this._isMounted = true;

        if (!this.state.call) {
            return;
        }

        if (this.state.call.state === 'established') {
            this.startTimer();
        }
        this.state.call.on('stateChanged', this.callStateChanged);
        this.setState({callState: this.state.call.state});
    }

    startTimer() {
        if (this.timer !== null) {
            // already armed
            return;
        }

        // TODO: consider using window.requestAnimationFrame

        const startTime = new Date();
        this.timer = setInterval(() => {
            const duration = moment.duration(new Date() - startTime);

            if (this.duration > 3600) {
                this.duration = duration.format('hh:mm:ss', {trim: false});
            } else {
                this.duration = duration.format('mm:ss', {trim: false});
            }

            if (this.props.show) {
                this.forceUpdate();
            }
        }, 1000);
    }

    componentWillUnmount() {
        this._isMounted = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        clearTimeout(this.timer);
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (!this._isMounted) {
            return;
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            this.setState({call: nextProps.call});
        }

        this.setState({info: nextProps.info,
                       participants: nextProps.participants});
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established' && this._isMounted && !this.props.terminated) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.state.call) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        if (!this._isMounted) {
            return;
        }

        this.setState({callState: newState});
    }

    render() {

        let videoHeader;
        let callButtons;

        if (this.props.terminated) {
            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        if (this.props.show) {
            const room = this.props.remoteUri.split('@')[0];
            let callDetail;

            if (this.state.reconnectingCall) {
                callDetail = 'Reconnecting call...';
            } else if (this.state.terminated) {
                callDetail = 'Conference ended';
            } else if (this.duration) {
                callDetail = (this.props.isTablet ? 'Duration: ' : '') + this.duration + ' - ' + this.state.participants + ' participant' + (this.state.participants > 1 ? 's' : '');
            }

            if (this.state.info) {
                callDetail = callDetail + ' - ' + this.state.info;
            }

            videoHeader = (
                <Appbar.Header style={{backgroundColor: 'rgba(34,34,34,.7)'}}>
                     <Appbar.Content
                        title={`Conference: ${room}`}
                        subtitle={callDetail}
                    />
                    {this.props.audioOnly ? null : this.props.buttons.top.right}
                </Appbar.Header>
            );

            callButtons = (
                <View style={styles.buttonContainer}>
                    {this.props.buttons.bottom}
                </View>
            );
        }

        return (
            <View style={styles.container}>
                {videoHeader}
                {callButtons}
            </View>
        );
    }
}

ConferenceHeader.propTypes = {
    show: PropTypes.bool.isRequired,
    remoteUri: PropTypes.string.isRequired,
    call: PropTypes.object,
    isTablet: PropTypes.bool,
    participants: PropTypes.number,
    buttons: PropTypes.object.isRequired,
    reconnectingCall: PropTypes.bool,
    audioOnly: PropTypes.bool,
    terminated: PropTypes.bool,
    info: PropTypes.string,
    goBackFunc: PropTypes.func
};


export default ConferenceHeader;
