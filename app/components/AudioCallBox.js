import React, { Component } from 'react';
import { View } from 'react-native';
import { IconButton } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import Logger from "../../Logger";
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import EscalateConferenceModal from './EscalateConferenceModal';
import UserIcon from './UserIcon';

import styles from '../assets/styles/blink/_AudioCallBox.scss';


const logger = new Logger("AudioCallBox");


class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            active                      : false,
            audioMuted                  : false,
            showDtmfModal               : false,
            showEscalateConferenceModal : false
        };
        // this.speechEvents = null;

        this.remoteAudio = React.createRef();
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        if (this.props.call != null) {
            switch (this.props.call.state) {
                case 'established':
                    this.attachStream(this.props.call);
                    break;
                case 'incoming':
                    this.props.mediaPlaying();
                    // fall through
                default:
                    this.props.call.on('stateChanged', this.callStateChanged);
                    break;
            }
        } else {
            this.props.mediaPlaying();
        }
    }

    componentWillReceiveProps(nextProps) {
        if (this.props.call == null && nextProps.call) {
            if (nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
            } else {
                nextProps.call.on('stateChanged', this.callStateChanged);
            }
        }
    }

    componentWillUnmount() {
        clearTimeout(this.callTimer);
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established') {
            this.attachStream(this.props.call);
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
        this.props.hangupCall();
    }

    muteAudio(event) {
        event.preventDefault();
        //const localStream = this.props.call.getLocalStreams()[0];

        if(this.state.audioMuted) {
            logger.debug('Unmute microphone');
            this.props.callKeepToggleMute(false);
            //localStream.getAudioTracks()[0].enabled = true;
            this.setState({audioMuted: false});
        } else {
            logger.debug('Mute microphone');
            //localStream.getAudioTracks()[0].enabled = false;
            this.props.callKeepToggleMute(true);
            this.setState({audioMuted: true});
        }

    }

    toggleSpeakerPhone() {
        this.setState({audioMuted: true});
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
        let remoteIdentity;

        if (this.props.call !== null) {
            remoteIdentity = this.props.call.remoteIdentity;
        } else {
            remoteIdentity = {uri: this.props.remoteIdentity};
        }

        return (
            <View style={styles.container}>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteIdentity={this.props.remoteIdentity}
                    call={this.props.call}
                />
                <View style={styles.userIconContainer}>
                    <UserIcon identity={remoteIdentity} large={true} active={this.state.active} />
                </View>
                <View style={styles.buttonContainer}>
                    <IconButton
                        size={34}
                        style={styles.button}
                        icon="account-plus"
                        onPress={this.toggleEscalateConferenceModal}
                    />
                    <IconButton
                        size={34}
                        style={styles.button}
                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                        onPress={this.muteAudio}
                    />
                    <IconButton
                        size={34}
                        style={[styles.button]}
                        icon={this.props.speakerPhoneEnabled ? 'volume-off' : 'volume-high'}
                        onPress={this.props.toggleSpeakerPhone}
                    />
                    <IconButton
                        size={34}
                        style={styles.button}
                        icon="dialpad"
                        onPress={this.showDtmfModal}
                        disabled={!(this.props.call && this.props.call.state === 'established')}
                    />
                    <IconButton
                        size={34}
                        style={[styles.button, styles.hangupButton]}
                        icon="phone-hangup"
                        onPress={this.hangupCall}
                    />
                </View>
                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.props.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.props.call}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
            </View>
        );
    }
}

AudioCallBox.propTypes = {
    call                    : PropTypes.object,
    escalateToConference    : PropTypes.func,
    hangupCall              : PropTypes.func,
    mediaPlaying            : PropTypes.func,
    remoteIdentity          : PropTypes.string,
    callKeepSendDtmf        : PropTypes.func,
    callKeepToggleMute      : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool
};

export default AudioCallBox;
