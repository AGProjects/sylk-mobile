import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import uuid from 'react-native-uuid';

import Logger from "../../Logger";
import AudioCallBox from './AudioCallBox';
import LocalMedia from './LocalMedia';
import VideoBox from './VideoBox';
import config from '../config';
import utils from '../utils';

const logger = new Logger("Call");


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.waitCounter = 0;
        this.waitInterval = 20;

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            //logger.debug('Will send audio only');
            audioOnly = true;
        }

        let remoteUri = '';
        let remoteDisplayName = '';
        let callState = null;
        let direction = 'outgoing';
        let callUUID;

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
                      accountId: this.props.account.id,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID
                      }
    }

    lookupContact() {
        let remoteUri = '';
        let remoteDisplayName = '';

        if (this.props.call !== null) {
            remoteUri = this.props.call.remoteIdentity.uri;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
            //console.log('Incoming call remoteUri', remoteUri);
            //console.log('Incoming call remoteDisplayName', remoteDisplayName);
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
                this.setState({remoteDisplayName: remoteDisplayName});
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
                       reconnectingCall: false
                       });
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.props.call != null && this.props.call != nextProps.currentCall) {
            if (nextProps.currentCall != null) {
                nextProps.currentCall.on('stateChanged', this.callStateChanged);
            }
        }

        this.setState({reconnectingCall: nextProps.reconnectingCall});
    }

    callStateChanged(oldState, newState, data) {
        //console.log('Call: callStateChanged', oldState, '->', newState);
        if (newState === 'established') {
            // Check the media type again, remote can choose to not accept all offered media types
            const currentCall = this.props.call;
            const remoteHasStreams = currentCall.getRemoteStreams().length > 0;
            const remoteHasNoVideoTracks = currentCall.getRemoteStreams()[0].getVideoTracks().length === 0;
            const remoteIsRecvOnly = currentCall.remoteMediaDirections.video[0] === 'recvonly';
            const remoteIsInactive = currentCall.remoteMediaDirections.video[0] === 'inactive';

            if (remoteHasStreams && (remoteHasNoVideoTracks || remoteIsRecvOnly || remoteIsInactive) && !this.state.audioOnly) {
                //console.log('Media type changed to audio');
                // Stop local video
                if (this.props.localMedia.getVideoTracks().length !== 0) {
                    currentCall.getLocalStreams()[0].getVideoTracks()[0].stop();
                }
                this.setState({audioOnly: true});
                this.props.speakerphoneOff();
            } else {
                this.forceUpdate();
            }
            currentCall.removeListener('stateChanged', this.callStateChanged);
        // Switch to video earlier. The callOverlay has a handle on
        // 'established'. It starts a timer. To prevent a state updating on
        // unmounted component we try to switch on 'accept'. This means we get
        // to localMedia first.
        } else if (newState === 'accepted') {
            // Switch if we have audioOnly and local videotracks. This means
            // the call object switched and we are transitioning to an
            // incoming call.
            if (this.state.audioOnly &&  this.props.localMedia && this.props.localMedia.getVideoTracks().length !== 0) {
                //console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
                this.props.speakerphoneOn();
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
                let callUUID = uuid.v4();
                this.setState({callUUID: callUUID});
                if (oldState === 'ready' && this.state.direction === 'outgoing') {
                    utils.timestampedLog('Call: reconnecting the call using new UUID', callUUID);
                    this.waitInterval = 20;
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
        utils.timestampedLog('Call: start call', this.props.callUUID, 'when ready to', this.props.targetUri);
        this.waitCounter = 0;

        utils.timestampedLog('Call: waiting for establishing call', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (!this.props.connection || this.props.connection.state !== 'ready' || this.props.account === null) {
                utils.timestampedLog('Call: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
                await this._sleep(1000);
            } else {
                this.waitCounter = 0;

                this.call();

                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Call: terminating call', this.props.callUUID, 'that did not start yet');
                this.hangupCall('timeout');
            }

            this.waitCounter++;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    call() {
        //console.log('Call: creating new call', this.props.callUUID);
        assert(this.props.call === null, 'currentCall is not null');

        this.lookupContact();

        let options = {pcConfig: {iceServers: config.iceServers}, id: this.props.callUUID};
        options.localStream = this.props.localMedia;

        let call = this.props.account.call(this.props.targetUri, options);
        console.log('Call: call initiated', call.id);
        call.on('stateChanged', this.callStateChanged);
    }

    answerCall() {
        //console.log('Call: Answer call');
        assert(this.props.call !== null, 'currentCall is null');

        this.lookupContact();

        let options = {pcConfig: {iceServers: config.iceServers}};
        options.localStream = this.props.localMedia;
        this.props.call.answer(options);
    }

    hangupCall(reason) {
        let callUUID = this.props.call ? this.props.call._callkeepUUID : this.state.callUUID;
        this.waitInterval = 20;

        this.props.callUUID || this.props.call._callkeepUUID;
        console.log('Call: hangup call', callUUID, 'reason', reason);

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

    mediaPlaying() {
        if (this.props.call === null) {
            this.startCallWhenReady();
        } else {
            this.answerCall();
        }
    }

    render() {
        //console.log('Call: render', this.state.direction, 'call', this.props.callUUID, 'reconnect=', this.state.reconnectingCall);

        let box = null;

        if (this.props.localMedia !== null) {
            if (this.state.audioOnly) {
                box = (
                    <AudioCallBox
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        hangupCall = {this.hangupCall}
                        call = {this.props.call}
                        accountId={this.state.accountId}
                        connection = {this.props.connection}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        callKeepToggleMute = {this.props.callKeepToggleMute}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        orientation = {this.props.orientation}
                        isTablet = {this.props.isTablet}
                        reconnectingCall = {this.props.reconnectingCall}
                    />
                );
            } else {
                if (this.props.call != null && this.props.call.state === 'established') {
                    box = (
                        <VideoBox
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            hangupCall = {this.hangupCall}
                            call = {this.props.call}
                            accountId={this.state.accountId}
                            connection = {this.props.connection}
                            localMedia = {this.props.localMedia}
                            shareScreen = {this.props.shareScreen}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            callKeepToggleMute = {this.props.callKeepToggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            orientation = {this.props.orientation}
                            isTablet = {this.props.isTablet}
                            reconnectingCall = {this.props.reconnectingCall}
                        />
                    );
                } else {
                    if (this.props.call && this.props.call.state && this.props.call.state === 'terminated') {
                        // do not render
                    } else {
                        box = (
                            <LocalMedia
                                remoteUri = {this.state.remoteUri}
                                remoteDisplayName = {this.state.remoteDisplayName}
                                localMedia = {this.props.localMedia}
                                mediaPlaying = {this.mediaPlaying}
                                hangupCall = {this.hangupCall}
                                generatedVideoTrack = {this.props.generatedVideoTrack}
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
    call                    : PropTypes.object,
    localMedia              : PropTypes.object,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    callKeepToggleMute      : PropTypes.func,
    speakerphoneOn          : PropTypes.func,
    speakerphoneOff         : PropTypes.func,
    callUUID                : PropTypes.string,
    contacts                : PropTypes.array,
    intercomDtmfTone        : PropTypes.string,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool
};


export default Call;
