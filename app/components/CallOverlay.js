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
            terminatedReason: this.props.terminatedReason,
            media: this.props.media ? this.props.media : 'audio',
            callState: this.props.call ? this.props.call.state : null,
            direction: this.props.call ? this.props.call.direction: null,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            remoteUri: this.props.remoteUri,
            localMedia: this.props.localMedia,
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

            this.setState({call: nextProps.call, direction:
                           nextProps.call.direction});
        }

        this.setState({remoteDisplayName: nextProps.remoteDisplayName,
                       remoteUri: nextProps.remoteUri,
                       media: nextProps.media,
                       localMedia: nextProps.localMedia,
                       startTime: nextProps.callState ? nextProps.callState.startTime : null,
                       terminatedReason: nextProps.terminatedReason
                       });
    }

    callStateChanged(oldState, newState, data) {
        // console.log('callStateChanged', oldState, newState);
        if (newState === 'established' && this._isMounted) {
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

        if (newState === 'proceeding') {
            if (this.state.callState === 'ringing' || data.code === 110 || data.code === 180) {
                newState = 'ringing';
            }
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

        this.timer = setInterval(() => {
            const duration = moment.duration(new Date() - this.state.startTime);
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
        let displayName = this.state.remoteUri;

        if (this.state.remoteDisplayName && this.state.remoteDisplayName !== this.state.remoteUri) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail = 'Contacting server...';

            if (this.duration) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = 'Duration: ' + this.duration;
            } else {
                if (this.state.reconnectingCall) {
                    callDetail = 'Reconnecting call...';
                } else if (this.state.callState === 'terminated') {
                    if (this.finalDuration) {
                        callDetail = 'Call ended after ' + this.finalDuration;
                    } else if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    }
                } else if (this.state.callState === 'incoming') {
                    callDetail = 'Connecting...';
                } else if (this.state.callState === 'accepted') {
                    callDetail = 'Waiting for ' + this.state.media + '...';
                } else if (this.state.callState === 'progress') {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = "Call in progress..."
                    }
                } else if (this.state.callState === 'established') {
                    callDetail = 'Media established';
                } else if (this.state.callState) {
                    callDetail = toTitleCase(this.state.callState);
                } else if (!this.state.localMedia) {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = 'Getting local media...';
                    }
                }
            }

            //console.log(' --- render overlay', this.state.callState, this.state.terminatedReason);
            if (this.props.info) {
                callDetail = callDetail + ' - ' + this.props.info;
            }

            let mediaLabel = 'Audio call';

            if (this.state.media) {
                mediaLabel = toTitleCase(this.state.media) + ' call';
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
                        <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                        <Appbar.Content
                            title={mediaLabel} subtitle={callDetail}
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
    localMedia: PropTypes.object,
    remoteDisplayName: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    reconnectingCall: PropTypes.bool,
    terminatedReason : PropTypes.string,
    media: PropTypes.string,
    audioCodec: PropTypes.string,
    videoCodec: PropTypes.string,
    info: PropTypes.string,
    goBackFunc: PropTypes.func,
    callState : PropTypes.object
};

export default CallOverlay;
