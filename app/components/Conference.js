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
        this.waitInterval = 90;
        this.userHangup = false;
        this.confCall = null;

        this.state = {
              currentCall: this.props.currentCall,
              localMedia: this.props.localMedia,
              connection: this.props.connection,
              account: this.props.account,
              callState: this.props.connection ? this.props.connection.state : null,
              startedByPush: this.props.startedByPush,
              started: false
              }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        //utils.timestampedLog('--Conference got props in connection startedByPush = ', this.state.startedByPush);
        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({account: nextProps.account});
        }
        if (nextProps.connection !== null && nextProps.connection !== this.props.accconnectionount) {
            this.setState({connection: nextProps.connection, callState: nextProps.connection.state});
        }

        if (nextProps.localMedia !== null && nextProps.localMedia !== this.state.localMedia) {
            this.setState({localMedia: nextProps.localMedia});
        }

        if (nextProps.currentCall != this.state.currentCall) {
            this.setState({currentCall: nextProps.currentCall});
        }

        this.mediaPlaying();
    }

    canConnect() {
        if (this.state.started) {
            return false;
        }

        if (!this.state.localMedia) {
            console.log('Conference: no local media');
            return false;
        }

        if (this.state.callState !== 'ready') {
            console.log('Conference: connection is not ready');
            return false;
        }

        if (this.state.currentCall) {
            console.log('Conference: call already in progress');
            return false;
        }

        return true;
    }

    mediaPlaying() {
        if (this.canConnect()) {
            this.setState({started: true});
            this.startConferenceWhenReady();
        }
    }

    confStateChanged(oldState, newState, data) {
        utils.timestampedLog('Conference: callStateChanged', oldState, '->', newState);
        if (newState === 'established') {
            this.forceUpdate();
        }
    }

    hangup() {
        this.props.hangupCall(this.props.callUUID, 'user_press_hangup');
        this.userHangup = true;
    }

    async startConferenceWhenReady() {
        utils.timestampedLog('Conference: start conference', this.props.callUUID, 'when ready to', this.props.targetUri);
        this.waitCounter = 0;

        //utils.timestampedLog('Conference: waiting for connecting to the conference', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (this.userHangup) {
                this.props.hangupCall(this.props.callUUID, 'user_cancelled');
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Conference: cancelling conference', this.props.callUUID);
                this.props.hangupCall(this.props.callUUID, 'timeout');
            }

            this.waitCounter++;

            if (!this.state.connection ||
                !this.props.account ||
                this.state.callState !== 'ready' ||
                this.props.registrationState !== 'registered') {
                utils.timestampedLog('Conference: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
//                utils.timestampedLog('Conference: connection', this.state.connection);
//                utils.timestampedLog('Conference: account', this.props.account);

                await this._sleep(1000);
            } else {
                this.waitCounter = 0;

                this.start();

                return;
            }
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        if (this.state.currentCall === null && this.confCall === null) {
            const options = {
                id: this.props.callUUID,
                pcConfig: {iceServers: config.iceServers},
                localStream: this.state.localMedia,
                audio: this.props.proposedMedia.audio,
                video: this.props.proposedMedia.video,
                offerOptions: {
                    offerToReceiveAudio: false,
                    offerToReceiveVideo: false
                },
                initialParticipants: this.props.participantsToInvite
            };
             utils.timestampedLog('Conference: Sylkrtc.js will start conference call', this.props.callUUID, 'to', this.props.targetUri.toLowerCase());
            this.confCall = this.state.account.joinConference(this.props.targetUri.toLowerCase(), options);
            this.confCall.on('stateChanged', this.confStateChanged);
        } else {
            //utils.timestampedLog('There is already a conference in progress');
        }
    }

    render() {
        //console.log('Render conference');
        let box = null;

        if (this.state.localMedia !== null) {
            if (this.state.currentCall != null && this.state.currentCall.state === 'established') {
                box = (
                    <ConferenceBox
                        notificationCenter = {this.props.notificationCenter}
                        call = {this.state.currentCall}
                        connection = {this.state.connection}
                        hangup = {this.hangup}
                        saveParticipant = {this.props.saveParticipant}
                        saveInvitedParties = {this.props.saveInvitedParties}
                        previousParticipants = {this.props.previousParticipants}
                        remoteUri = {this.props.targetUri}
                        shareScreen = {this.props.shareScreen}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleMute = {this.props.toggleMute}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        isLandscape = {this.props.isLandscape}
                        isTablet = {this.props.isTablet}
                        muted = {this.props.muted}
                        defaultDomain = {this.props.defaultDomain}
                   />
                );
            } else if (!this.state.startedByPush) {
                box = (
                    <LocalMedia
                        call = {this.state.currentCall}
                        connection = {this.state.connection}
                        remoteUri = {this.props.targetUri}
                        remoteDisplayName = {this.props.targetUri}
                        localMedia = {this.state.localMedia}
                        mediaPlaying = {this.mediaPlaying}
                        hangupCall = {this.hangup}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                    />
                );
            }

        } else {
            console.log('Error: render conference has no local media');
        }

        return box;
    }
}

Conference.propTypes = {
    notificationCenter      : PropTypes.func.isRequired,
    account                 : PropTypes.object.isRequired,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    hangupCall              : PropTypes.func.isRequired,
    saveParticipant         : PropTypes.func,
    saveInvitedParties      : PropTypes.func,
    previousParticipants    : PropTypes.array,
    currentCall             : PropTypes.object,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    participantsToInvite    : PropTypes.array,
    generatedVideoTrack     : PropTypes.bool,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    callUUID                : PropTypes.string,
    proposedMedia           : PropTypes.object,
    isLandscape             : PropTypes.bool,
    isTablet                : PropTypes.bool,
    muted                   : PropTypes.bool,
    defaultDomain           : PropTypes.string,
    startedByPush           : PropTypes.bool

};


export default Conference;
