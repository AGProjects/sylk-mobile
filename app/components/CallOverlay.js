import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Colors } from 'react-native-paper';

import styles from '../assets/styles/blink/_AudioCallBox.scss';


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

class CallOverlay extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            callState: null,
            direction: this.props.call ? this.props.call.direction : 'outgoing'
        }

        this.duration = null;
        this.finalDuration = null;
        this.timer = null;
        this._isMounted = true;
        this.reconnecting = false;

        if (this.props.call) {
            this.props.call.on('stateChanged', this.callStateChanged);
        }
    }

    componentDidMount() {
        if (this.props.call) {
            if (this.props.call.state === 'established') {
                this.startTimer();
            } else if (this.props.call.state !== 'terminated') {
                this.props.call.on('stateChanged', this.callStateChanged);
            }
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.props.call == null && nextProps.call) {
            if (nextProps.call.state !== 'terminated') {
                nextProps.call.on('stateChanged', this.callStateChanged);
            }
        }
    }

    componentWillUnmount() {
        if (this.props.call) {
            this.props.call.removeListener('stateChanged', this.callStateChanged);
        }
        this._isMounted = false;
        clearTimeout(this.timer);
    }

    callStateChanged(oldState, newState, data) {
        //console.log('Overlay: callStateChanged', newState, '->', newState);
        if (newState === 'established' && this._isMounted) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.props.call) {
                this.props.call.removeListener('stateChanged', this.callStateChanged);
            }

            clearTimeout(this.timer);
            this.finalDuration = this.duration;
            this.duration = null;
            this.timer = null;
        }

        this.setState({callState: newState});
    }

    startTimer() {
        if (this.timer !== null) {
            // already armed
            return;
        }

        // TODO: consider using window.requestAnimationFrame

        const startTime = new Date();
        this.timer = setInterval(() => {
            this.duration = moment.duration(new Date() - startTime).format('hh:mm:ss', {trim: false});
            if (this.props.show) {
                this.forceUpdate();
            }
        }, 300);
    }

    render() {
        //console.log('Render call overlay');
        let header = null;

        let displayName = this.props.remoteUri;

        if (this.props.remoteDisplayName && this.props.remoteDisplayName !== this.props.remoteUri) {
            displayName = this.props.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail;

            if (this.duration) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = 'Duration:' + this.duration;
            } else {
                if (!this.props.connection || this.props.connection.state !== 'ready' || !this.props.accountId) {
                    if (this.state.callState || this.state.callState === 'terminated') {
                        callDetail = 'Restoring the conversation...';
                        this.reconnecting = true;
                    } else {
                        callDetail = 'Waiting for connection...';
                    }
                } else {
                    if (this.state.callState === 'terminated' && this.finalDuration) {
                        callDetail = 'Call ended after ' +  this.finalDuration;
                    } else {
                        callDetail = this.state.callState ? toTitleCase(this.state.callState) : 'Connecting...';
                    }
                }
            }

            if (this.props.remoteUri.search('videoconference') > -1) {
                header = (
                    <Appbar.Header style={{backgroundColor: 'black'}}>
                        <Appbar.Content
                            title={`Conference: ${displayName}`} subtitle={callDetail}
                        />
                    </Appbar.Header>
                );
            } else {
                header = (
                    <Appbar.Header style={styles.appbarContainer}>
                        <Appbar.Content
                            title={`Call with ${displayName}`} subtitle={callDetail}
                        />
                    </Appbar.Header>
                );
            }
        }

        return header
    }
}

CallOverlay.propTypes = {
    show: PropTypes.bool.isRequired,
    remoteUri: PropTypes.string.isRequired,
    remoteDisplayName: PropTypes.string,
    accountId: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object
};


export default CallOverlay;
