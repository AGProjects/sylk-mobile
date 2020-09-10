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

        this.defaultWaitInterval = 90; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        this.userHangup = false;
        this.confCall = null;
        this.ended = false;
        this.started = false;

        this.state = {
              currentCall: null,
              callUUID: this.props.callUUID,
              localMedia: this.props.localMedia,
              connection: this.props.connection,
              account: this.props.account,
              registrationState: this.props.registrationState,
              startedByPush: this.props.startedByPush,
              reconnectingCall: this.props.reconnectingCall
              }

        if (this.props.connection) {
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

    }

    componentWillUnmount() {
        this.ended = true;

        if (this.state.currentCall) {
            this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }
    }

    callStateChanged(oldState, newState, data) {
        utils.timestampedLog('Conference: callStateChanged', oldState, '->', newState);
        if (newState === 'established') {
            this.setState({reconnectingCall: false});
        }
    }

    connectionStateChanged(oldState, newState) {
        switch (newState) {
            case 'disconnected':
                if (oldState === 'ready') {
                    utils.timestampedLog('Conference: connection failed, reconnecting the call...');
                    this.waitInterval = this.defaultWaitInterval;
                }
                break;
            default:
                break;
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        //console.log('Conference got props');

        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({account: nextProps.account});
        }

        this.setState({registrationState: nextProps.registrationState});

        if (nextProps.connection !== null && nextProps.connection !== this.state.connection) {
            this.setState({connection: nextProps.connection});
            nextProps.connection.on('stateChanged', this.connectionStateChanged);
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.localMedia !== null && nextProps.localMedia !== this.state.localMedia) {
            this.setState({localMedia: nextProps.localMedia});
        }

        if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
            this.setState({callUUID: nextProps.callUUID,
                           reconnectingCall: true,
                           currentCall: null});

            this.startCallWhenReady();
        }
    }

    mediaPlaying() {
        this.startCallWhenReady();
    }

    canConnect() {
        if (!this.state.localMedia) {
            console.log('Conference: no local media');
            return false;
        }

        if (!this.state.connection) {
            console.log('Conference: no connection yet');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            console.log('Conference: connection is not ready');
            return false;
        }

        if (!this.state.account) {
            console.log('Conference: no account yet');
            return false;
        }

        if (this.state.registrationState !== 'registered') {
            console.log('Conference: account not ready yet');
            return false;
        }

        if (this.state.currentCall) {
            console.log('Conference: call already in progress');
            return false;
        }

        return true;
    }

    async startCallWhenReady() {
        utils.timestampedLog('Conference: start conference', this.state.callUUID, 'when ready to', this.props.targetUri);
        this.waitCounter = 0;

        //utils.timestampedLog('Conference: waiting for connecting to the conference', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (this.userHangup) {
                this.props.hangupCall(this.state.callUUID, 'user_cancelled');
                return;
            }

            if (this.state.currentCall) {
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Conference: cancelling conference', this.state.callUUID);
                this.props.hangupCall(this.state.callUUID, 'timeout');
            }

            if (!this.canConnect()) {
                //console.log('Waiting', this.waitCounter);
                await this._sleep(1000);
            } else {
                this.waitCounter = 0;
                this.start();
                return;
            }

            this.waitCounter++;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        const options = {
            id: this.state.callUUID,
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
        utils.timestampedLog('Conference: Sylkrtc.js will start conference call', this.state.callUUID, 'to', this.props.targetUri.toLowerCase());
        confCall = this.state.account.joinConference(this.props.targetUri.toLowerCase(), options);
        if (confCall) {
            confCall.on('stateChanged', this.callStateChanged);
            this.setState({currentCall: confCall});
        }
    }

    hangup() {
        this.props.hangupCall(this.state.callUUID, 'user_press_hangup');
        this.userHangup = true;

        if (this.waitCounter > 0) {
            this.waitCounter = this.waitInterval;
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
                        audioOnly = {!this.props.proposedMedia.video}
                        reconnectingCall={this.state.reconnectingCall}
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
                        inFocus = {this.props.inFocus}
                        reconnectingCall={this.state.reconnectingCall}
                        contacts={this.props.contacts}
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
    notificationCenter      : PropTypes.func,
    account                 : PropTypes.object,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    hangupCall              : PropTypes.func,
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
    startedByPush           : PropTypes.bool,
    inFocus                 : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    contacts                : PropTypes.array
};


export default Conference;
