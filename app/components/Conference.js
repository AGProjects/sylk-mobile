import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';

import ConferenceBox from './ConferenceBox';
import LocalMedia from './LocalMedia';
import config from '../config';

const DEBUG = debug('blinkrtc:Conference');
debug.enable('*');

class Conference extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);
    }

    confStateChanged(oldState, newState, data) {
        DEBUG(`Conference state changed ${oldState} -> ${newState}`);
        if (newState === 'established') {
            this.forceUpdate();
        }
    }

    start() {
        if (this.props.currentCall === null) {
            const options = {
                id: this.props.callUUID,
                pcConfig: {iceServers: config.iceServers},
                localStream: this.props.localMedia,
                audio: true,
                video: true,
                offerOptions: {
                    offerToReceiveAudio: false,
                    offerToReceiveVideo: false
                },
                initialParticipants: this.props.participantsToInvite
            };
            console.log('Starting conference call', this.props.callUUID, 'to', this.props.targetUri.toLowerCase(), options);
            const confCall = this.props.account.joinConference(this.props.targetUri.toLowerCase(), options);
            confCall.on('stateChanged', this.confStateChanged);
        } else {
            console.log('Cannot start conference, there is already a call in progress');
        }
    }

    hangup() {
        this.props.hangupCall(this.props.callUUID);
    }

    mediaPlaying() {
        if (this.props.currentCall === null) {
            this.start();
        } else {
            DEBUG('CALL ALREADY STARTED');
        }
    }

    render() {
        let box = null;

        if (this.props.localMedia !== null) {
            if (this.props.currentCall != null && this.props.currentCall.state === 'established') {
                box = (
                    <ConferenceBox
                        notificationCenter = {this.props.notificationCenter}
                        call = {this.props.currentCall}
                        hangup = {this.hangup}
                        saveParticipant = {this.props.saveParticipant}
                        saveInvitedParties = {this.props.saveInvitedParties}
                        previousParticipants = {this.props.previousParticipants}
                        remoteUri = {this.props.targetUri}
                        shareScreen = {this.props.shareScreen}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    />
                );
            } else {
                box = (
                    <LocalMedia
                        remoteUri = {this.props.targetUri}
                        localMedia = {this.props.localMedia}
                        mediaPlaying = {this.mediaPlaying}
                        hangupCall = {this.hangup}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                    />
                );
            }
        }

        return box;
    }
}

Conference.propTypes = {
    notificationCenter      : PropTypes.func.isRequired,
    account                 : PropTypes.object.isRequired,
    hangupCall              : PropTypes.func.isRequired,
    saveParticipant         : PropTypes.func,
    saveInvitedParties      : PropTypes.func,
    previousParticipants    : PropTypes.array,
    currentCall             : PropTypes.object,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    participantsToInvite    : PropTypes.array,
    generatedVideoTrack     : PropTypes.bool,
    callUUID                : PropTypes.string
};


export default Conference;
