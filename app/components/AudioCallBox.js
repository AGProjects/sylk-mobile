import React, { Component } from 'react';
import { View, Platform } from 'react-native';
import { IconButton, Dialog, Text, ActivityIndicator, Colors } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import styles from '../assets/styles/blink/_AudioCallBox.scss';
import utils from '../utils';

import TrafficStats from './BarChart';


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}


class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            remoteUri                   : this.props.remoteUri,
            remoteDisplayName           : this.props.remoteDisplayName,
            photo                       : this.props.photo,
            active                      : false,
            audioMuted                  : this.props.muted,
            showDtmfModal               : false,
            showEscalateConferenceModal : false,
            call                        : this.props.call,
            reconnectingCall            : this.props.reconnectingCall,
            info                        : this.props.info,
            packetLossQueue             : [],
            audioBandwidthQueue         : [],
            latencyQueue                : []
        };

        this.remoteAudio = React.createRef();
        this.userHangup = false;
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        if (this.state.call != null) {
            switch (this.state.call.state) {
                case 'established':
                    this.attachStream(this.state.call);
                    break;
                case 'incoming':
                    this.props.mediaPlaying();
                    // fall through
                default:
                    this.state.call.on('stateChanged', this.callStateChanged);
                    break;
            }
        } else {
            this.props.mediaPlaying();
        }
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            if (nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            } else if (nextProps.call.state === 'incoming') {
                this.props.mediaPlaying();
            }

            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            this.setState({call: nextProps.call});
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.hasOwnProperty('info')) {
            this.setState({info: nextProps.info});
        }

        if (nextProps.hasOwnProperty('packetLossQueue')) {
            this.setState({packetLossQueue: nextProps.packetLossQueue});
        }

        if (nextProps.hasOwnProperty('audioBandwidthQueue')) {
            this.setState({audioBandwidthQueue: nextProps.audioBandwidthQueue});
        }

        if (nextProps.hasOwnProperty('latencyQueue')) {
            this.setState({latencyQueue: nextProps.latencyQueue});
        }

        this.setState({remoteUri: nextProps.remoteUri,
                       remoteDisplayName: nextProps.remoteDisplayName,
                       photo: nextProps.photo
                       });
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }
        clearTimeout(this.callTimer);
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established') {
            this.attachStream(this.state.call);
            this.setState({reconnectingCall: false});
        }
    }

    attachStream(call) {
        this.setState({stream: call.getRemoteStreams()[0]}); //we dont use it anywhere though as audio gets automatically piped
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_cancelled_call');
    }

    muteAudio(event) {
        event.preventDefault();
        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
     }

    showDtmfModal() {
        this.setState({showDtmfModal: true});
    }

    hideDtmfModal() {
        this.setState({showDtmfModal: false});
    }

    toggleEscalateConferenceModal() {
        this.setState({
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    render() {
        let buttonContainerClass;
        let userIconContainerClass;

        let remoteIdentity = {uri: this.state.remoteUri || '',
                              displayName: this.state.remoteDisplayName || '',
                              photo: this.state.photo
                              };


        let displayName = this.state.remoteUri ? toTitleCase(this.state.remoteUri.split('@')[0]) : '';

        if (this.state.remoteDisplayName && this.state.remoteUri !== this.state.remoteDisplayName) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.isTablet) {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.tabletLandscapeButtonContainer : styles.tabletPortraitButtonContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
            userIconContainerClass = styles.userIconContainer;
        }

        const buttonSize = this.props.isTablet ? 40 : 34;
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        return (
            <View style={styles.container}>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteUri={this.state.remoteUri}
                    remoteDisplayName={this.state.remoteDisplayName}
                    call={this.state.call}
                    reconnectingCall={this.state.reconnectingCall}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                />
                <View style={userIconContainerClass}>
                    <UserIcon identity={remoteIdentity} large={true} active={this.state.active} />
                </View>

                <Dialog.Title style={styles.displayName}>{displayName}</Dialog.Title>
                <Text style={styles.uri}>{this.state.remoteUri}</Text>

                {this.props.orientation !== 'landscape' && this.state.reconnectingCall ?
                <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={Colors.red800} />
                :
                null
                }

                <TrafficStats
                    packetLossQueue = {this.state.packetLossQueue}
                    latencyQueue = {this.state.latencyQueue}
                    audioBandwidthQueue = {this.state.audioBandwidthQueue}
                    videoBandwidthQueue = {this.state.videoBandwidthQueue}
                    isTablet = {this.props.isTablet}
                    orientation = {this.props.orientation}
                    media = 'audio'
                />

                {this.state.call && ((this.state.call.state === 'accepted' || this.state.call.state === 'established') && !this.state.reconnectingCall) ?
                    <View style={buttonContainerClass}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon="account-plus"
                        onPress={this.toggleEscalateConferenceModal}
                    />
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                        onPress={this.muteAudio}
                    />
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                        onPress={this.props.toggleSpeakerPhone}
                    />
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon="dialpad"
                        onPress={this.showDtmfModal}
                        disabled={!(this.state.call && (this.state.call.state === 'accepted' || this.state.call.state === 'established'))}
                    />
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass, styles.hangupButton]}
                        icon="phone-hangup"
                        onPress={this.hangupCall}
                    />
                    </View>
                    :
                    <View style={buttonContainerClass}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                        onPress={this.props.toggleSpeakerPhone}
                    />
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass, styles.hangupButton]}
                        icon="phone-hangup"
                        onPress={this.cancelCall}
                    />
                    </View>
                }

                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.state.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
            </View>
        );
    }
}

AudioCallBox.propTypes = {
    remoteUri               : PropTypes.string,
    remoteDisplayName       : PropTypes.string,
    photo                   : PropTypes.string,
    call                    : PropTypes.object,
    connection              : PropTypes.object,
    accountId               : PropTypes.string,
    escalateToConference    : PropTypes.func,
    info                    : PropTypes.string,
    hangupCall              : PropTypes.func,
    mediaPlaying            : PropTypes.func,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
    packetLossQueue         : PropTypes.array,
    videoBandwidthQueue     : PropTypes.array,
    audioBandwidthQueue     : PropTypes.array,
    latencyQueue            : PropTypes.array
};

export default AudioCallBox;
