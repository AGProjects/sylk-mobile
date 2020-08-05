import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import uuid from 'react-native-uuid';

import AudioCallBox from './AudioCallBox';
import LocalMedia from './LocalMedia';
import VideoBox from './VideoBox';
import config from '../config';
import utils from '../utils';


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.defaultWaitInterval = 60; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            audioOnly = true;
        }

        let remoteUri = '';
        let remoteDisplayName = '';
        let callState = null;
        let direction = 'outgoing';
        let callUUID;
        let callEnded = false;
        this.mediaIsPlaying = false;

        if (this.props.call !== null) {
            // If current call is available on mount we must have incoming
            this.props.call.on('stateChanged', this.callStateChanged);
            callState = this.props.call.state;
            remoteUri = this.props.call.remoteIdentity.uri;
            direction = this.props.call.direction;
            callUUID = this.props.call.id;
            remoteDisplayName = this.props.call.remoteIdentity.displayName;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
            callUUID = this.props.callUUID;
        }

        if (this.props.connection) {
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        this.state = {
                      audioOnly: audioOnly,
                      remoteUri: remoteUri,
                      remoteDisplayName: remoteDisplayName,
                      connection: this.props.connection,
                      accountId: this.props.account ? this.props.account.id : null,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID,
                      reconnectingCall: this.props.reconnectingCall
                      }
    }

    mediaPlaying() {
        if (this.state.direction === 'incoming') {
            this.answerCall();
        } else {
            this.mediaIsPlaying = true;
        }
    }

    componentDidMount() {
        if (this.state.direction === 'outgoing') {
            this.startCallWhenReady();
        }
    }

    componentWillUnmount() {
        //console.log('Call: will unmount');
    }

    lookupContact() {
        let remoteUri = '';
        let remoteDisplayName = '';
        let photo = null;

        if (this.props.call !== null) {
            remoteUri = this.props.call.remoteIdentity.uri;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
        }

        if (remoteUri.indexOf('3333@') > -1) {
            remoteDisplayName = 'Video Test';
        } else if (remoteUri.indexOf('4444@') > -1) {
            remoteDisplayName = 'Echo Test';
        } else if (this.props.contacts) {
            let username = remoteUri.split('@')[0];
            let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

            if (isPhoneNumber) {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', remoteUri);
            }

            if (contact_obj) {
                remoteDisplayName = contact_obj.displayName;
                photo = contact_obj.photo;
                if (isPhoneNumber) {
                    remoteUri = username;
                }
            } else {
                if (isPhoneNumber) {
                    remoteUri = username;
                    remoteDisplayName = username;
                }
            }
        }

        this.setState({remoteDisplayName: remoteDisplayName,
                       remoteUri: remoteUri,
                       photo: photo
                       });
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        //console.log('Call: received props');
        // Needed for switching to incoming call while in a call
        if (this.props.call != null && this.props.call != nextProps.currentCall) {
            if (nextProps.currentCall != null) {
                nextProps.currentCall.on('stateChanged', this.callStateChanged);
            }
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }
    }

    callStateChanged(oldState, newState, data) {
        //console.log('Call: callStateChanged', oldState, '->', newState);
        let remoteHasNoVideoTracks;
        let remoteIsRecvOnly;
        let remoteIsInactive;
        let remoteStreams;

        if (newState === 'established') {
            this.setState({reconnectingCall: false});
            const currentCall = this.props.call;

            if (currentCall) {
                remoteStreams = currentCall.getRemoteStreams();
                if (remoteStreams) {
                    if (remoteStreams.length > 0) {
                        const remotestream = remoteStreams[0];
                        remoteHasNoVideoTracks = remotestream.getVideoTracks().length === 0;
                        remoteIsRecvOnly = currentCall.remoteMediaDirections.video[0] === 'recvonly';
                        remoteIsInactive = currentCall.remoteMediaDirections.video[0] === 'inactive';
                    }
                }
            }

            if (remoteStreams && (remoteHasNoVideoTracks || remoteIsRecvOnly || remoteIsInactive) && !this.state.audioOnly) {
                //console.log('Media type changed to audio');
                // Stop local video
                if (this.props.localMedia.getVideoTracks().length !== 0) {
                    currentCall.getLocalStreams()[0].getVideoTracks()[0].stop();
                }
                this.setState({audioOnly: true});
            } else {
                this.forceUpdate();
            }

        } else if (newState === 'accepted') {
            // Switch if we have audioOnly and local videotracks. This means
            // the call object switched and we are transitioning to an
            // incoming call.
            if (this.state.audioOnly &&  this.props.localMedia && this.props.localMedia.getVideoTracks().length !== 0) {
                //console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
            }
        }

        this.forceUpdate();
    }

    connectionStateChanged(oldState, newState) {
        utils.timestampedLog('Call: connection state changed:', oldState, '->' , newState);
        switch (newState) {
            case 'closed':
                break;
            case 'ready':
                break;
            case 'disconnected':
                if (oldState === 'ready' && this.state.direction === 'outgoing') {
                    utils.timestampedLog('Call: reconnecting the call');
                    this.waitInterval = this.defaultWaitInterval;
                    this.startCallWhenReady();
                }
                break;
            default:
                break;
        }
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    async startCallWhenReady() {
        if (!this.props.callUUID || !this.props.targetUri) {
            return;
        }
        utils.timestampedLog('Call: start call', this.props.callUUID, 'when ready to', this.props.targetUri);
        this.waitCounter = 0;

        this.lookupContact();

        utils.timestampedLog('Call: waiting for establishing call', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (this.userHangup) {
                this.hangupCall('user_cancelled');
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Call: terminating conference', this.props.callUUID, 'that did not start yet');
                this.hangupCall('timeout');
            }

            if (!this.props.connection ||
                 this.props.connection.state !== 'ready' ||
                 this.props.registrationState !== 'registered' ||
                 !this.mediaIsPlaying
                 ) {
                utils.timestampedLog('Call: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
                await this._sleep(1000);
            } else {
                this.waitCounter = 0;

                this.call();

                return;
            }

            this.waitCounter++;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    call() {
        utils.timestampedLog('Call: starting call', this.props.callUUID);

        if (this.props.localMedia === null)  {
            console.log('Call: cannot create new call without local media');
            return;
        }

        let options = {pcConfig: {iceServers: config.iceServers}, id: this.props.callUUID};
        options.localStream = this.props.localMedia;

        let call = this.props.account.call(this.props.targetUri, options);
        call.on('stateChanged', this.callStateChanged);
    }

    answerCall() {
        if (this.props.call && this.props.call.state === 'incoming') {
            this.lookupContact();
            let options = {pcConfig: {iceServers: config.iceServers}};
            options.localStream = this.props.localMedia;
            this.props.call.answer(options);
        }
    }

    hangupCall(reason) {
        let callUUID = this.props.call ? this.props.call._callkeepUUID : this.props.callUUID;
        this.waitInterval = this.defaultWaitInterval;

        this.props.callUUID || this.props.call._callkeepUUID;

        if (this.props.call) {
            this.props.call.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.props.connection) {
            this.props.connection.removeListener('stateChanged', this.connectionStateChanged);
        }

        if (this.waitCounter > 0) {
            this.waitCounter = this.waitInterval;
        }

        this.props.hangupCall(callUUID, reason);
    }

    render() {
        let box = null;

        if (this.props.localMedia !== null) {
            if (this.state.audioOnly) {
                box = (
                    <AudioCallBox
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        photo = {this.state.photo}
                        hangupCall = {this.hangupCall}
                        call = {this.props.call}
                        accountId={this.state.accountId}
                        connection = {this.props.connection}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        toggleMute = {this.props.toggleMute}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        orientation = {this.props.orientation}
                        isTablet = {this.props.isTablet}
                        reconnectingCall = {this.state.reconnectingCall}
                        muted = {this.props.muted}
                    />
                );
            } else {
                if (this.props.call != null && (this.props.call.state === 'accepted' || (this.props.call.state === 'terminated' && this.state.reconnectingCall))) {
                    box = (
                        <VideoBox
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            photo = {this.state.photo}
                            hangupCall = {this.hangupCall}
                            call = {this.props.call}
                            accountId={this.state.accountId}
                            connection = {this.props.connection}
                            localMedia = {this.props.localMedia}
                            shareScreen = {this.props.shareScreen}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            toggleMute = {this.props.toggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            orientation = {this.props.orientation}
                            isTablet = {this.props.isTablet}
                            reconnectingCall = {this.state.reconnectingCall}
                            muted = {this.props.muted}
                        />
                    );
                } else {
                    if (this.props.call && this.props.call.state === 'terminated' && this.state.reconnectingCall) {
                        //console.log('Skip render local media because we will reconnect');
                    } else {
                        box = (
                            <LocalMedia
                                call = {this.props.call}
                                remoteUri = {this.state.remoteUri}
                                remoteDisplayName = {this.state.remoteDisplayName}
                                photo = {this.state.photo}
                                localMedia = {this.props.localMedia}
                                mediaPlaying = {this.mediaPlaying}
                                hangupCall = {this.hangupCall}
                                generatedVideoTrack = {this.props.generatedVideoTrack}
                                accountId={this.state.accountId}
                                connection = {this.props.connection}
                                orientation = {this.props.orientation}
                                isTablet = {this.props.isTablet}
                            />
                        );
                    }
                }
            }
        }
        return box;
    }
}

Call.propTypes = {
    targetUri               : PropTypes.string.isRequired,
    account                 : PropTypes.object,
    hangupCall              : PropTypes.func,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    call                    : PropTypes.object,
    localMedia              : PropTypes.object,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    callUUID                : PropTypes.string,
    contacts                : PropTypes.array,
    intercomDtmfTone        : PropTypes.string,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool
};


export default Call;
