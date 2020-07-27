import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';

import ConferenceBox from './ConferenceBox';
import LocalMedia from './LocalMedia';
import config from '../config';
import utils from '../utils';

const DEBUG = debug('blinkrtc:Conference');
debug.enable('*');

class Conference extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.waitCounter = 0;
        this.waitInterval = 180;
    }

    confStateChanged(oldState, newState, data) {
        DEBUG(`Conference state changed ${oldState} -> ${newState}`);
        if (newState === 'established') {
            this.forceUpdate();
        }
    }

    async startConferenceWhenReady() {
        if (!this.props.callUUID || !this.props.targetUri) {
            return;
        }
        utils.timestampedLog('Call: start conference', this.props.callUUID, 'when ready to', this.props.targetUri);
        this.waitCounter = 0;

        utils.timestampedLog('Call: waiting for connecting to the conference', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (!this.props.connection || this.props.connection.state !== 'ready' || this.props.account === null) {
                utils.timestampedLog('Call: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
                await this._sleep(1000);
            } else {
                this.waitCounter = 0;

                this.start();

                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Call: terminating conference', this.props.callUUID, 'that did not start yet');
                this.hangup('timeout');
            }

            this.waitCounter++;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        if (this.props.currentCall === null) {
            const options = {
                id: this.props.callUUID,
                pcConfig: {iceServers: config.iceServers},
                localStream: this.props.localMedia,
                audio: this.props.proposedMedia.audio,
                video: this.props.proposedMedia.video,
                offerOptions: {
                    offerToReceiveAudio: false,
                    offerToReceiveVideo: false
                },
                initialParticipants: this.props.participantsToInvite
            };
            //console.log('Sylkrtc.js will start conference call', this.props.callUUID, 'to', this.props.targetUri.toLowerCase(), options);
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
            this.startConferenceWhenReady();
        }
    }

    render() {
        let box = null;

        if (this.props.localMedia !== null) {
            if (this.props.currentCall != null && this.props.currentCall.state === 'established') {
                console.log('Render conference in call state', this.props.currentCall.state);
                box = (
                    <ConferenceBox
                        notificationCenter = {this.props.notificationCenter}
                        call = {this.props.currentCall}
                        connection = {this.props.connection}
                        hangup = {this.hangup}
                        saveParticipant = {this.props.saveParticipant}
                        saveInvitedParties = {this.props.saveInvitedParties}
                        previousParticipants = {this.props.previousParticipants}
                        remoteUri = {this.props.targetUri}
                        shareScreen = {this.props.shareScreen}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        isLandscape = {this.props.isLandscape}
                        isTablet = {this.props.isTablet}
                    />
                );
            } else {
                box = (
                    <LocalMedia
                        call = {this.props.currentCall}
                        connection = {this.props.connection}
                        remoteUri = {this.props.targetUri}
                        remoteDisplayName = {this.props.targetUri}
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
    connection              : PropTypes.object,
    hangupCall              : PropTypes.func.isRequired,
    saveParticipant         : PropTypes.func,
    saveInvitedParties      : PropTypes.func,
    previousParticipants    : PropTypes.array,
    currentCall             : PropTypes.object,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    participantsToInvite    : PropTypes.array,
    generatedVideoTrack     : PropTypes.bool,
    callUUID                : PropTypes.string,
    proposedMedia           : PropTypes.object,
    isLandscape             : PropTypes.bool,
    isTablet                : PropTypes.bool
};


export default Conference;
