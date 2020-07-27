import React, { Component } from 'react';
import { View, Platform } from 'react-native';
import { IconButton, Dialog, Text, ActivityIndicator, Colors } from 'react-native-paper';

import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import Logger from "../../Logger";
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import EscalateConferenceModal from './EscalateConferenceModal';
import UserIcon from './UserIcon';

import utils from '../utils';

import styles from '../assets/styles/blink/_AudioCallBox.scss';

const logger = new Logger("AudioCallBox");


class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.userHangup = false;

        this.state = {
            active                      : false,
            audioMuted                  : false,
            showDtmfModal               : false,
            showEscalateConferenceModal : false,
            call                        : this.props.call,
            reconnectingCall            : this.props.reconnectingCall
        };
        // this.speechEvents = null;

        this.remoteAudio = React.createRef();
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
        if (nextProps.call && nextProps.call !== this.state.call) {
            if (nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            }

            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            this.setState({call: nextProps.call});
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            console.log('Audio box got prop reconnecting', nextProps.reconnectingCall);
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }
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
        // const options = {
        //     interval: 225,
        //     play: false
        // };
        // this.speechEvents = hark(remoteStream, options);
        // this.speechEvents.on('speaking', () => {
        //     this.setState({active: true});
        // });
        // this.speechEvents.on('stopped_speaking', () => {
        //     this.setState({active: false});
        // });
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_press_hangup');
        this.userHangup = true;
    }

    cancelCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_cancelled');
    }

    muteAudio(event) {
        event.preventDefault();
        const localStream = this.state.call.getLocalStreams()[0];
        const track = localStream.getAudioTracks()[0];

        if(this.state.audioMuted) {
            //console.log('Unmute microphone');
            this.state.callKeepToggleMute(false);
            track.enabled = true;
            this.setState({audioMuted: false});
        } else {
            //console.log('Mute microphone');
            track.enabled = false;
            this.state.callKeepToggleMute(true);
            this.setState({audioMuted: true});
        }
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

//  {this.props.orientation !== 'landscape' && !this.userHangup && (!this.state.call || (this.state.call && this.state.call.state !== 'established')) ?

    render() {
        let remoteIdentity = {uri: this.props.remoteUri, displayName: this.props.remoteDisplayName};

        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;
        let displayName = (this.props.remoteDisplayName && this.props.remoteUri !== this.props.remoteDisplayName) ? this.props.remoteDisplayName: this.props.remoteUri;
        let buttonContainerClass = this.props.orientation === 'landscape' ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
        //console.log('Audio box reconnecting', this.state.reconnectingCall);

        return (
            <View style={styles.container}>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteUri={this.props.remoteUri}
                    remoteDisplayName={this.props.remoteDisplayName}
                    call={this.state.call}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                />
                <View style={styles.userIconContainer}>
                    <UserIcon identity={remoteIdentity} large={true} active={this.state.active} />
                </View>
                <Dialog.Title style={styles.displayName}>{displayName}</Dialog.Title>
                { (this.props.remoteDisplayName && this.props.remoteUri !== this.props.remoteDisplayName) ?

                <Text style={styles.uri}>{this.props.remoteUri}</Text>
                : null }

                {this.props.orientation !== 'landscape' && !this.userHangup && this.state.reconnectingCall ?
                <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={Colors.red800} />
                :
                null
                }

                {this.state.call && this.state.call.state === 'established' ?
                    <View style={buttonContainerClass}>
                    <IconButton
                        size={34}
                        style={buttonClass}
                        icon="account-plus"
                        onPress={this.toggleEscalateConferenceModal}
                    />
                    <IconButton
                        size={34}
                        style={buttonClass}
                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                        onPress={this.muteAudio}
                    />
                    <IconButton
                        size={34}
                        style={buttonClass}
                        icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                        onPress={this.props.toggleSpeakerPhone}
                    />
                    <IconButton
                        size={34}
                        style={buttonClass}
                        icon="dialpad"
                        onPress={this.showDtmfModal}
                        disabled={!(this.state.call && this.state.call.state === 'established')}
                    />
                    <IconButton
                        size={34}
                        style={[buttonClass, styles.hangupButton]}
                        icon="phone-hangup"
                        onPress={this.hangupCall}
                    />
                    </View>
                    :
                    <View style={buttonContainerClass}>
                    <IconButton
                        size={34}
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
    remoteUri               : PropTypes.string.isRequired,
    remoteDisplayName       : PropTypes.string,
    call                    : PropTypes.object,
    connection              : PropTypes.object,
    accountId               : PropTypes.string,
    escalateToConference    : PropTypes.func,
    hangupCall              : PropTypes.func,
    mediaPlaying            : PropTypes.func,
    callKeepSendDtmf        : PropTypes.func,
    callKeepToggleMute      : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool
};

export default AudioCallBox;
