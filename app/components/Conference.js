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
            console.log('Creating conference call', this.props.targetUri.toLowerCase(), options);
            const confCall = this.props.account.joinConference(this.props.targetUri.toLowerCase(), options);
            confCall.on('stateChanged', this.confStateChanged);
        } else {
            console.log('Cannot start conference, there is already a call in progress');
        }
    }

    hangup() {
        this.props.hangupCall();
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
                        remoteIdentity = {this.props.targetUri}
                        shareScreen = {this.props.shareScreen}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    />
                );
            } else {
                box = (
                    <LocalMedia
                        remoteIdentity = {this.props.targetUri.split('@')[0]}
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
    currentCall             : PropTypes.object,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    participantsToInvite    : PropTypes.array,
    generatedVideoTrack     : PropTypes.bool
};


export default Conference;
