import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from 'react-native-paper';
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
            call: this.props.call,
            callState: this.props.call ? this.props.call.state : null,
            direction: this.props.call ? this.props.call.direction: null,
            remoteUri: this.props.remoteUri,
            remoteDisplayName: this.props.remoteDisplayName,
            reconnectingCall: this.props.reconnectingCall
        }

        this.duration = null;
        this.finalDuration = null;
        this.timer = null;
        this._isMounted = true;
    }

    componentDidMount() {
        if (this.state.call) {
            if (this.state.call.state === 'established') {
                this.startTimer();
            }
            this.state.call.on('stateChanged', this.callStateChanged);
            this.setState({callState: this.state.call.state});
        }
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

        this.setState({remoteDisplayName: nextProps.remoteDisplayName, remoteUri: nextProps.remoteUri});
    }

    componentWillUnmount() {
        this._isMounted = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        clearTimeout(this.timer);
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
            this.finalDuration = this.duration;
            this.duration = null;
            this.timer = null;
        }

        if (!this._isMounted) {
            return;
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

    render() {
        let header = null;

        if (this.props.terminated) {
            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        let displayName = this.state.remoteUri;

        if (this.state.remoteDisplayName && this.state.remoteDisplayName !== this.state.remoteUri) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail;

            if (this.duration) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = 'Duration: ' + this.duration;
            } else {
                if (this.state.reconnectingCall) {
                    callDetail = 'Reconnecting the call...';
                } else if (this.props.terminated) {
                    callDetail = 'Call ended';
                } else if (this.state.callState === 'terminated') {
                    callDetail = this.finalDuration ? 'Call ended after ' + this.finalDuration : 'Call ended';
                } else {
                   if (this.state.callState) {
                       if (this.state.callState === 'incoming') {
                           callDetail = 'Waiting for incoming call...';
                       } else {
                           callDetail = toTitleCase(this.state.callState);
                       }

                   } else if (this.state.direction) {
                       callDetail = 'Connecting', this.state.direction, 'call...';
                   } else {
                       callDetail = 'Connecting...';
                   }
                }
            }

            if (this.props.info) {
                callDetail = callDetail + ' - ' + this.props.info;
            }

            if (this.state.remoteUri && this.state.remoteUri.search('videoconference') > -1) {
                displayName = this.state.remoteUri.split('@')[0];

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
    remoteUri: PropTypes.string,
    remoteDisplayName: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    reconnectingCall: PropTypes.bool,
    terminated : PropTypes.bool,
    info: PropTypes.string
};


export default CallOverlay;
