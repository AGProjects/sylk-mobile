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
        this.ended = false;
        this.started = false;
        this.participants = [];

        this.state = {
              currentCall: null,
              callState: null,
              targetUri: this.props.targetUri,
              callUUID: this.props.callUUID,
              localMedia: this.props.localMedia,
              connection: this.props.connection,
              account: this.props.account,
              registrationState: this.props.registrationState,
              startedByPush: this.props.startedByPush,
              reconnectingCall: this.props.reconnectingCall,
              myInvitedParties: this.props.myInvitedParties,
              isFavorite: this.props.favoriteUris.indexOf(this.props.targetUri) > -1
              }

        if (this.props.connection) {
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        if (this.props.participantsToInvite) {
            this.props.participantsToInvite.forEach((p) => {
                if (this.participants.indexOf(p) === -1) {
                    this.participants.push(p);
                }
            });
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
        this.setState({callState: newState});
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

        this.setState({myInvitedParties: nextProps.myInvitedParties,
                       isFavorite: nextProps.favoriteUris.indexOf(this.props.targetUri) > -1
                       });
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
                this.props.hangupCall(this.state.callUUID, 'user_cancelled_conference');
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

    saveParticipant(callUUID, room, uri) {
        console.log('Save saveParticipant', uri);
        if (this.participants.indexOf(uri) === -1) {
            this.participants.push(uri);
        }
        this.props.saveParticipant(callUUID, room, uri);
    }

    showSaveDialog() {
        if (!this.userHangup) {
            return false;
        }

        if (this.state.reconnectingCall) {
            console.log('No save dialog because call is reconnecting')
            return false;
        }

        if (this.participants.length === 0) {
            console.log('No show dialog because there are no participants')
            return false;
        }

        if (this.state.isFavorite) {
            let room = this.state.targetUri.split('@')[0];
            let must_display = false;
            if (this.props.myInvitedParties.hasOwnProperty(room)) {
                let old_participants = this.state.myInvitedParties[room];
                this.participants.forEach((p) => {
                    if (old_participants.indexOf(p) === -1) {
                        console.log(p, 'is not in', old_participants);
                        must_display = true;
                    }
                });
            }

            if (must_display) {
                console.log('Show save dialog because we have new participants');
                return true;
            } else {
                console.log('No save dialog because is already favorite with same participants')
                return false;
            }
        } else {
            console.log('Show save dialog because is not in favorites');
            return true;
        }
        return true;
    }

    saveConference() {
        if (!this.state.isFavorite) {
            this.props.setFavoriteUri(this.props.targetUri);
        }

        let room = this.state.targetUri.split('@')[0];
        if (this.props.myInvitedParties.hasOwnProperty(room)) {
            let participants = this.state.myInvitedParties[room];
            this.participants.forEach((p) => {
                if (participants.indexOf(p) === -1) {
                    participants.push(p);
                }
            });

            this.props.saveInvitedParties(this.props.targetUri, participants);
        } else {
            this.props.saveInvitedParties(this.props.targetUri, this.participants);
        }

        this.props.hangupCall(this.state.callUUID, 'user_hangup_conference_confirmed');
    }

    hangup(reason='user_hangup_conference') {
        this.userHangup = true;

        if (!this.showSaveDialog()) {
            reason = 'user_hangup_conference_confirmed';
        }

        this.props.hangupCall(this.state.callUUID, reason);

        if (this.waitCounter > 0) {
            this.waitCounter = this.waitInterval;
        }
    }

    render() {
        let box = null;

        if (this.state.localMedia !== null) {
            if (this.state.currentCall != null && (this.state.callState === 'established')) {
                box = (
                    <ConferenceBox
                        notificationCenter = {this.props.notificationCenter}
                        call = {this.state.currentCall}
                        audioOnly = {this.props.proposedMedia ? !this.props.proposedMedia.video: false}
                        reconnectingCall={this.state.reconnectingCall}
                        connection = {this.state.connection}
                        hangup = {this.hangup}
                        saveParticipant = {this.saveParticipant}
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
                        initialParticipants={this.props.participantsToInvite}
                        terminated={this.userHangup}
                   />
                );
            } else {
                box = (
                    <LocalMedia
                        call = {this.state.currentCall}
                        remoteUri = {this.props.targetUri}
                        remoteDisplayName = {this.props.targetUri}
                        localMedia = {this.state.localMedia}
                        mediaPlaying = {this.mediaPlaying}
                        hangupCall = {this.hangup}
                        showSaveDialog={this.showSaveDialog}
                        saveConference={this.saveConference}
                        connection={this.state.connection}
                        participants={this.participants}
                        terminated={this.userHangup}
                    />
                );
            }

        } else {
            console.log('Error: cannot start conference without local media');
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
    setFavoriteUri          : PropTypes.func,
    saveInvitedParties      : PropTypes.func,
    reconnectingCall        : PropTypes.bool,
    contacts                : PropTypes.array,
    favoriteUris            : PropTypes.array
};


export default Conference;
