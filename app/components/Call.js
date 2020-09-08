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

        let callUUID;
        let remoteUri = '';
        let remoteDisplayName = '';
        let callState = null;
        let direction = null;
        let callEnded = false;
        this.mediaIsPlaying = false;
        this.ended = false;
        this.answering = false;

        if (this.props.call) {
            // If current call is available on mount we must have incoming
            this.props.call.on('stateChanged', this.callStateChanged);
            remoteUri = this.props.call.remoteIdentity.uri;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
            direction = this.props.call.direction;
            callUUID = this.props.call.id;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
            callUUID = this.props.callUUID;
            direction = this.props.callUUID ? 'outgoing' : null;
        }

        if (this.props.connection) {
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            audioOnly = true;
        }

        this.state = {
                      call: this.props.call,
                      targetUri: this.props.targetUri,
                      audioOnly: audioOnly,
                      boo: false,
                      remoteUri: remoteUri,
                      remoteDisplayName: remoteDisplayName,
                      localMedia: this.props.localMedia,
                      connection: this.props.connection,
                      accountId: this.props.account ? this.props.account.id : null,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID,
                      reconnectingCall: this.props.reconnectingCall
                      }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.ended) {
            return;
        }

        this.setState({accountId: nextProps.account ? nextProps.account.id : null});

        if (nextProps.call !== null) {
            if (this.state.call !== nextProps.call) {
                nextProps.call.on('stateChanged', this.callStateChanged);

                this.setState({
                               call: nextProps.call,
                               remoteUri: nextProps.call.remoteIdentity.uri,
                               direction: nextProps.call.direction,
                               callUUID: nextProps.call.id,
                               remoteDisplayName: nextProps.call.remoteIdentity.displayName
                               });

                if (nextProps.call.direction === 'incoming') {
                    this.mediaPlaying();
                }

                this.lookupContact();
            }
        } else {
            if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
                this.setState({'callUUID': nextProps.callUUID,
                               'direction': 'outgoing',
                               'call': null
                               });

                this.startCallWhenReady(nextProps.callUUID);
            }
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.targetUri !== this.state.targetUri && this.state.direction === 'outgoing') {
            this.setState({targetUri: nextProps.targetUri});
        }

        this.setState({registrationState: nextProps.registrationState});

        if (nextProps.localMedia !== null && nextProps.localMedia !== this.state.localMedia) {
            let audioOnly = false;

            if (nextProps.localMedia.getVideoTracks().length === 0) {
                audioOnly = true;
            }

            this.setState({localMedia: nextProps.localMedia,
                           audioOnly: audioOnly});

            this.mediaPlaying(nextProps.localMedia);
        }
    }

    mediaPlaying(localMedia) {
        if (this.state.direction === 'incoming') {
            const media = localMedia ? localMedia : this.state.localMedia;
            this.answerCall(media);
        } else {
            this.mediaIsPlaying = true;
        }
    }

    answerCall(localMedia) {
        const media = localMedia ? localMedia : this.state.localMedia;
        if (this.state.call && this.state.call.state === 'incoming' && media) {
            let options = {pcConfig: {iceServers: config.iceServers}};
            options.localStream = media;
            if (!this.answering) {
                this.answering = true;
                const connectionState = this.state.connection.state ? this.state.connection.state : null;
                utils.timestampedLog('Call: answering call in connection state', connectionState);
                this.state.call.answer(options);
            } else {
                utils.timestampedLog('Call: answering call in progress...');
            }
        } else {
            if (!media) {
                utils.timestampedLog('Call: waiting for local media');
            }
            if (!this.state.call) {
                utils.timestampedLog('Call: waiting for incoming call data');
            }
        }
    }

    componentDidMount() {
        this.lookupContact();
        if (this.state.direction === 'outgoing' && this.state.callUUID) {
            this.startCallWhenReady(this.state.callUUID);
        }
    }

    componentWillUnmount() {
        this.ended = true;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }
    }

    lookupContact() {
        let photo = null;
        let remoteUri = this.state.remoteUri || '';
        let remoteDisplayName = this.state.remoteDisplayName || '';

        if (!remoteUri) {
            return;
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

    callStateChanged(oldState, newState, data) {
        //console.log('Call: callStateChanged', oldState, '->', newState);
        if (this.ended) {
            return;
        }

        let remoteHasNoVideoTracks;
        let remoteIsRecvOnly;
        let remoteIsInactive;
        let remoteStreams;

        if (newState === 'established') {
            this.setState({reconnectingCall: false});
            const currentCall = this.state.call;

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
                if (this.state.localMedia.getVideoTracks().length !== 0) {
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
            if (this.state.audioOnly &&  this.state.localMedia && this.state.localMedia.getVideoTracks().length !== 0) {
                //console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
            }
        }

        this.forceUpdate();
    }

    connectionStateChanged(oldState, newState) {
        switch (newState) {
            case 'closed':
                break;
            case 'ready':
                break;
            case 'disconnected':
                if (oldState === 'ready' && this.state.direction === 'outgoing') {
                    utils.timestampedLog('Call: reconnecting the call...');
                    this.waitInterval = this.defaultWaitInterval;
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

    canConnect() {
        if (!this.state.connection) {
            console.log('Call: no connection yet');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            console.log('Call: connection is not ready');
            return false;
        }

        if (this.props.registrationState !== 'registered') {
            console.log('Call: account not ready yet');
            return false;
        }

        if (!this.mediaIsPlaying) {
            console.log('Call: media is not playing');
            return false;
        }

        return true;
    }

    async startCallWhenReady(callUUID) {
        utils.timestampedLog('Call: start call', callUUID, 'when ready to', this.state.targetUri);
        this.waitCounter = 0;


        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (this.waitCounter === 1) {
                utils.timestampedLog('Call: waiting for establishing call', this.waitInterval, 'seconds');
            }

            if (this.userHangup) {
                this.hangupCall('user_cancelled');
                return;
            }

            if (this.ended) {
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                this.hangupCall('timeout');
            }

            if (!this.canConnect()) {
                //utils.timestampedLog('Call: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
                if (this.state.call && this.state.call.id === callUUID && this.state.call.state !== 'terminated') {
                    return;
                }

                console.log('Wait', this.waitCounter);
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
        utils.timestampedLog('Call: starting call', this.state.callUUID);

        if (this.state.localMedia === null)  {
            console.log('Call: cannot create new call without local media');
            return;
        }

        let options = {pcConfig: {iceServers: config.iceServers}, id: this.state.callUUID};
        options.localStream = this.state.localMedia;

        let call = this.props.account.call(this.state.targetUri, options);
        if (call) {
            call.on('stateChanged', this.callStateChanged);
        }
    }

    hangupCall(reason) {
        let callUUID = this.state.call ? this.state.call.id : this.state.callUUID;
        this.waitInterval = this.defaultWaitInterval;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
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
        if (this.state.localMedia !== null) {
            if (this.state.audioOnly) {

                box = (
                    <AudioCallBox
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        photo = {this.state.photo}
                        hangupCall = {this.hangupCall}
                        call = {this.state.call}
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
                if (this.state.call !== null && (this.state.call.state === 'established' || (this.state.call.state === 'terminated' && this.state.reconnectingCall))) {

                    box = (
                        <VideoBox
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            photo = {this.state.photo}
                            hangupCall = {this.hangupCall}
                            call = {this.state.call}
                            accountId={this.state.accountId}
                            connection = {this.props.connection}
                            localMedia = {this.state.localMedia}
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
                    if (this.state.call && this.state.call.state === 'terminated' && this.state.reconnectingCall) {
                        //console.log('Skip render local media because we will reconnect');
                    } else {
                        box = (
                            <LocalMedia
                                call = {this.state.call}
                                remoteUri = {this.state.remoteUri}
                                remoteDisplayName = {this.state.remoteDisplayName}
                                photo = {this.state.photo}
                                localMedia = {this.state.localMedia}
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
        } else {
            box = (
                <AudioCallBox
                    remoteUri = {this.state.remoteUri}
                    remoteDisplayName = {this.state.remoteDisplayName}
                    photo = {this.state.photo}
                    hangupCall = {this.hangupCall}
                    call = {this.state.call}
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

        }
        return box;
    }
}

Call.propTypes = {
    targetUri               : PropTypes.string,
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
    toggleSpeakerPhone      : PropTypes.func,
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
