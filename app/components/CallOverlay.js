import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';


class CallOverlay extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.duration = null;
        this.timer = null;
        this._isMounted = true;
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

    componentWillReceiveProps(nextProps) {
        if (this.props.call == null && nextProps.call) {
            if (nextProps.call.state === 'established') {
                this.startTimer();
            } else if (nextProps.call.state !== 'terminated') {
                nextProps.call.on('stateChanged', this.callStateChanged);
            }
        }
    }

    componentWillUnmount() {
        this._isMounted = false;
        clearTimeout(this.timer);
    }

    callStateChanged(oldState, newState, data) {
        // Prevent starting timer when we are unmounted
        if (newState === 'established' && this._isMounted) {
            this.startTimer();
            this.props.call.removeListener('stateChanged', this.callStateChanged);
        }
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
        let header = null;

        let displayName = this.props.remoteUri;
        console.log('uri', this.props.remoteUri);

        if (this.props.remoteDisplayName && this.props.remoteDisplayName !== this.props.remoteUri) {
            displayName = this.props.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail;
            if (this.duration !== null) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = 'Duration:' + this.duration;
            } else {
                callDetail = 'Connecting...'
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
                    <Appbar.Header style={{backgroundColor: 'black'}}>
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
    remoteDisplayName: PropTypes.string.isRequired,
    call: PropTypes.object
};


export default CallOverlay;
