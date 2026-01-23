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
import utils from '../utils';

// import {
//   ConnectionStateChangedEvent,
//   ConnectionEventTypes,
//   ProofAttributeInfo,
//   ProofEventTypes,
//   AttributeFilter
// } from '@aries-framework/core';
//
function randomIntFromInterval(min,max)
{
    return Math.floor(Math.random()*(max-min+1)+min);
}


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.samples = 30;
        this.sampleInterval = 3;

        this.defaultWaitInterval = 60; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        this.mediaLost = false;

        let callUUID;
        let remoteUri = '';
        let remoteDisplayName = '';
        let callState = null;
        let direction = null;
        let callEnded = false;
        this.ended = false;
        this.answering = false;
        this.mediaIsPlaying = false;

        if (this.props.call) {
            // If current call is available on mount we must have incoming
            this.props.call.on('stateChanged', this.callStateChanged);
            this.props.call.on('incomingMessage', this.incomingMessage);
            remoteUri = this.props.call.remoteIdentity.uri;
            callState = this.props.call.state;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
            direction = this.props.call.direction;
            callUUID = this.props.call.id;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
            callUUID = this.props.callUUID;
            direction = callUUID ? 'outgoing' : 'incoming';
        }

        if (this.props.connection) {
            //console.log('Added listener for connection', this.props.connection);
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
                      account: this.props.account,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID,
                      reconnectingCall: this.props.reconnectingCall,
                      speakerPhoneEnabled: this.props.speakerPhoneEnabled,
                      info: '',
                      messages: this.props.messages,
                      selectedContact: this.props.selectedContact,
                      callContact: this.props.callContact,
                      selectedContacts: this.props.selectedContacts,
                      callEndReason: null,
                      userStartedCall: false,
                      availableAudioDevices: this.props.availableAudioDevices,
                      selectedAudioDevice: this.props.selectedAudioDevice,
                      iceServers: this.props.iceServers,
                      insets: this.props.insets,
                      isLandscape: this.props.isLandscape
                      }
    }

    componentDidMount() {
        this.lookupContact();

        if (this.state.direction === 'outgoing' && this.state.callUUID && this.state.callState !== 'established') {
            utils.timestampedLog('Call: start call', this.state.callUUID, 'when ready to', this.state.targetUri);
            this.startCallWhenReady(this.state.callUUID);
        }

        if (this.state.direction === 'incoming') {
            this.mediaPlaying();
        }
    }

    componentWillUnmount() {
        this.ended = true;
        this.answering = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }
    }

    incomingMessage(message) {
        console.log('Session message', message.id, message.contentType, 'received');
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.ended) {
            return;
        }

        if (nextProps.connection && nextProps.connection !== this.state.connection) {
            nextProps.connection.on('stateChanged', this.connectionStateChanged);
        }

        this.setState({connection: nextProps.connection,
                       account: nextProps.account,
                       call: nextProps.call,
                       callContact: nextProps.callContact,
                       accountId: nextProps.account ? nextProps.account.id : null});

        if (this.state.call === null && nextProps.call !== null) {
            nextProps.call.on('stateChanged', this.callStateChanged);
            nextProps.call.on('incomingMessage', this.incomingMessage);

            this.setState({
                           remoteUri: nextProps.call.remoteIdentity.uri,
                           direction: nextProps.call.direction,
                           callUUID: nextProps.call.id,
                           remoteDisplayName: nextProps.call.remoteIdentity.displayName
                           });

            this.lookupContact();
        } else {
            if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
                this.setState({'callUUID': nextProps.callUUID,
                               'direction': 'outgoing',
                               'call': null
                               });
            }
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.targetUri !== this.state.targetUri && this.state.direction === 'outgoing') {
            this.setState({targetUri: nextProps.targetUri});
        }

        if (nextProps.terminatedReason) {
            this.setState({terminatedReason: nextProps.terminatedReason});
        }

        if ('userStartedCall' in nextProps) {
			this.setState({userStartedCall: nextProps.userStartedCall});
        }

        if (nextProps.localMedia && !this.state.localMedia) {
            let audioOnly = nextProps.localMedia.getVideoTracks().length === 0 ? true : false;
            this.setState({localMedia: nextProps.localMedia, audioOnly: audioOnly});
            this.mediaPlaying(nextProps.localMedia);
        }

        this.setState({messages: nextProps.messages,
                         selectedContacts: nextProps.selectedContacts,
                         speakerPhoneEnabled: nextProps.speakerPhoneEnabled,
                         availableAudioDevices: nextProps.availableAudioDevices,
                         selectedAudioDevice: nextProps.selectedAudioDevice,
                         iceServers: nextProps.iceServers,
                         insets: nextProps.insets,
                         isLandscape: nextProps.isLandscape
                         });
    }

    mediaPlaying(localMedia) {
        if (this.state.direction === 'incoming') {
            const media = localMedia ? localMedia : this.state.localMedia;
            this.answerCall(media);
        } else {
            this.mediaIsPlaying = true;
        }
    }

    async answerCall(localMedia) {
        const media = localMedia ? localMedia : this.state.localMedia;
        if (this.state.call && this.state.call.state === 'incoming' && media) {
            let options = {pcConfig: {iceServers: this.state.iceServers}};
            options.localStream = media;
            utils.timestampedLog('Answering call...');

            if (!this.answering) {
                this.answering = true;
                const connectionState = this.state.connection.state ? this.state.connection.state : null;
                utils.timestampedLog('Call: answering call', this.state.call.id, 'in connection state', connectionState);
                try {
                    this.state.call.answer(options);
                    utils.timestampedLog('Call: answered');
                } catch (error) {
                    utils.timestampedLog('Call: failed to answer', error);
                    this.hangupCall('answer_failed')
                }
            } else {
                utils.timestampedLog('Call: answering call in progress...');
            }
        } else {
            if (!this.state.call) {
                utils.timestampedLog('Call: no Sylkrtc call present');
                //this.hangupCall('answer_failed');
            }

            if (!media) {
                utils.timestampedLog('Call: waiting for local media');
            }
        }
    }

    lookupContact() {
        // TODO this must lookup in myContacts
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
        } else if (this.props.myContacts.hasOwnProperty(remoteUri) && this.props.myContacts[remoteUri].name) {
            remoteDisplayName = this.props.myContacts[remoteUri].name;
        } else if (this.props.contacts) {
            let username = remoteUri.split('@')[0];
            let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

            if (isPhoneNumber) {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', remoteUri);
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

        this.answering = false;

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

            //data.headers.forEach((header) => {
            //});
        }

        if (newState === 'terminated') {
            this.setState({terminatedReason: this.state.terminatedReason});
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
            utils.timestampedLog('Call: no connection yet');
            return false;
        }

		if (!this.state.userStartedCall) {
			//console.log('Wait for user confirmation to start call');
			//return
		}

        if (this.state.connection.state !== 'ready') {
            utils.timestampedLog('Call: connection is not ready');
            return false;
        }

        if (this.props.registrationState !== 'registered') {
            utils.timestampedLog('Call: account not ready yet');
            return false;
        }

        if (!this.mediaIsPlaying) {
            utils.timestampedLog('Local media is not playing')
            if (this.waitCounter > 0) {
                console.log('Call: media is not yet playing');
                if (this.waitCounter == 10) {
                    // something went wrong
                    this.setState({terminatedReason: 'Cannot start media'});
                    this.hangupCall('local_media_timeout');
                }
            }
            return false;
        }

        return true;
    }

    async startCallWhenReady(callUUID) {
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

                if (this.waitCounter > 0 && this.waitCounter % 10 === 0) {
                    //utils.timestampedLog('Wait', this.waitCounter);
                }

                /*
                if (this.waitCounter == 3) {
					this.props.startRingback();
                }

                if (this.waitCounter == 10) {
					this.props.stopRingback();
                }

                if (this.waitCounter == 23) {
					this.props.startRingback();
                }
                */

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

    confirmStartCall() {
        this.setState({userStartedCall: true});
    }

    start() {
        if (this.state.localMedia === null)  {
            console.log('Call: cannot create new call without local media');
            return;
        }

        let options = {
                       pcConfig: {iceServers: this.state.iceServers},
                       id: this.state.callUUID,
                       localStream: this.state.localMedia
                       };

        let call = this.state.account.call(this.state.targetUri, options);
        this.setState({call: call});
    }

    hangupCall(reason) {
        let callUUID = this.state.call ? this.state.call.id : this.state.callUUID;
        this.waitInterval = this.defaultWaitInterval;

        if (this.state.call) {
            //console.log('Remove listener for call', this.state.call.id);
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
            this.setState({call: null});
        }

        if (this.state.connection) {
            //console.log('Remove listener for connection', this.state.connection);
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
            this.setState({connection: null});
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
                        connection = {this.state.connection}
                        localMedia = {this.state.localMedia}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        toggleMute = {this.props.toggleMute}
                        speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        isLandscape = {this.state.isLandscape}
                        isTablet = {this.props.isTablet}
                        reconnectingCall = {this.state.reconnectingCall}
                        muted = {this.props.muted}
                        showLogs = {this.props.showLogs}
                        goBackFunc = {this.props.goBackFunc}
                        callState = {this.props.callState}
                        messages = {this.state.messages}
                        deleteMessages = {this.props.deleteMessages}
                        sendMessage = {this.props.sendMessage}
                        expireMessage = {this.props.expireMessage}
                        reSendMessage = {this.props.reSendMessage}
                        deleteMessage = {this.props.deleteMessage}
                        getMessages = {this.props.getMessages}
                        pinMessage = {this.props.pinMessage}
                        unpinMessage = {this.props.unpinMessage}
                        selectedContact = {this.state.selectedContact}
                        selectedContacts = {this.state.selectedContacts}
                        callContact = {this.state.callContact}
                        inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                        finishInvite = {this.props.finishInvite}
                        terminatedReason = {this.state.terminatedReason}
                        confirmStartCall = {this.confirmStartCall}
                        userStartedCall = {this.state.userStartedCall}
                        availableAudioDevices = {this.state.availableAudioDevices}
                        selectedAudioDevice = {this.state.selectedAudioDevice}
                        selectAudioDevice = {this.props.selectAudioDevice}
						useInCallManger = {this.props.useInCallManger}
						insets = {this.state.insets}
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
                            connection = {this.state.connection}
                            localMedia = {this.state.localMedia}
                            shareScreen = {this.props.shareScreen}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            toggleMute = {this.props.toggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            isLandscape = {this.state.isLandscape}
                            isTablet = {this.props.isTablet}
                            reconnectingCall = {this.state.reconnectingCall}
                            muted = {this.props.muted}
                            showLogs = {this.props.showLogs}
                            goBackFunc = {this.props.goBackFunc}
                            callState = {this.props.callState}
                            messages = {this.state.messages}
                            deleteMessages = {this.props.deleteMessages}
                            sendMessage = {this.props.sendMessage}
                            expireMessage = {this.props.expireMessage}
                            reSendMessage = {this.props.reSendMessage}
                            deleteMessage = {this.props.deleteMessage}
                            getMessages = {this.props.getMessages}
                            pinMessage = {this.props.pinMessage}
                            unpinMessage = {this.props.unpinMessage}
                            selectedContact = {this.state.selectedContact}
                            selectedContacts = {this.state.selectedContacts}
                            callContact = {this.state.callContact}
                            inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                            finishInvite = {this.props.finishInvite}
                            terminatedReason = {this.state.terminatedReason}
                            videoMuted = {this.props.videoMuted}
							availableAudioDevices = {this.state.availableAudioDevices}
							selectedAudioDevice = {this.state.selectedAudioDevice}
							selectAudioDevice = {this.props.selectAudioDevice}
							useInCallManger = {this.props.useInCallManger}
							insets = {this.state.insets}
							enableFullScreen = {this.props.enableFullScreen}
							disableFullScreen = {this.props.disableFullScreen}
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
                                accountId = {this.state.accountId}
                                connection = {this.state.connection}
                                isLandscape = {this.state.isLandscape}
                                isTablet = {this.props.isTablet}
                                media = 'video'
                                showLogs = {this.props.showLogs}
                                goBackFunc = {this.props.goBackFunc}
                                terminatedReason = {this.state.terminatedReason}
								availableAudioDevices = {this.state.availableAudioDevices}
								selectedAudioDevice = {this.state.selectedAudioDevice}
								selectAudioDevice = {this.props.selectAudioDevice}
								useInCallManger = {this.props.useInCallManger}
								insets = {this.state.insets}
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
                    accountId = {this.state.accountId}
                    connection = {this.state.connection}
                    mediaPlaying = {this.mediaPlaying}
                    escalateToConference = {this.props.escalateToConference}
                    callKeepSendDtmf = {this.props.callKeepSendDtmf}
                    toggleMute = {this.props.toggleMute}
                    speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                    toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    isLandscape = {this.state.isLandscape}
                    isTablet = {this.props.isTablet}
                    reconnectingCall = {this.state.reconnectingCall}
                    muted = {this.props.muted}
                    showLogs = {this.props.showLogs}
                    goBackFunc = {this.props.goBackFunc}
                    selectedContact = {this.state.selectedContact}
                    callContact = {this.state.callContact}
                    inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                    finishInvite = {this.props.finishInvite}
                    terminatedReason = {this.state.terminatedReason}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
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
    terminatedReason        : PropTypes.string,
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
    isLandscape             : PropTypes.bool,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
    myContacts              : PropTypes.object,
    showLogs                : PropTypes.func,
    goBackFunc              : PropTypes.func,
    callState               : PropTypes.object,
    messages                : PropTypes.object,
    sendMessage             : PropTypes.func,
    reSendMessage           : PropTypes.func,
    confirmRead             : PropTypes.func,
    deleteMessage           : PropTypes.func,
    expireMessage           : PropTypes.func,
    getMessages             : PropTypes.func,
    pinMessage              : PropTypes.func,
    unpinMessage            : PropTypes.func,
    selectedContact         : PropTypes.object,
    callContact             : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    postSystemNotification  : PropTypes.func,
	videoMuted              : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
    startRingback           : PropTypes.func,
    stopRingback            : PropTypes.func,
    useInCallManger         : PropTypes.bool,
    iceServers              : PropTypes.array,
	insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func
};


export default Call;
