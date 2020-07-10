import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';

import Logger from "../../Logger";
import AudioCallBox from './AudioCallBox';
import LocalMedia from './LocalMedia';
import VideoBox from './VideoBox';
import config from '../config';

const logger = new Logger("Call");


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            //logger.debug('Will send audio only');
            this.state = {audioOnly: true};
        } else {
            this.state = {audioOnly: false};
        }

        // If current call is available on mount we must have incoming
        if (this.props.currentCall != null) {
            this.props.currentCall.on('stateChanged', this.callStateChanged);
        }
    }

    componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.props.currentCall != null && this.props.currentCall != nextProps.currentCall) {
            if (nextProps.currentCall != null) {
                nextProps.currentCall.on('stateChanged', this.callStateChanged);
            } else {
                this.props.currentCall.removeListener('stateChanged', this.callStateChanged);
            }
        }
    }

    callStateChanged(oldState, newState, data) {
        // console.log('Call: callStateChanged', newState, '->', newState);
        if (newState === 'established') {
            // Check the media type again, remote can choose to not accept all offered media types
            const currentCall = this.props.currentCall;
            const remoteHasStreams = currentCall.getRemoteStreams().length > 0;
            const remoteHasNoVideoTracks = currentCall.getRemoteStreams()[0].getVideoTracks().length === 0;
            const remoteIsRecvOnly = currentCall.remoteMediaDirections.video[0] === 'recvonly';
            const remoteIsInactive = currentCall.remoteMediaDirections.video[0] === 'inactive';

            if (remoteHasStreams && (remoteHasNoVideoTracks || remoteIsRecvOnly || remoteIsInactive) && !this.state.audioOnly) {
                console.log('Media type changed to audio');
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
                console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
                this.props.speakerphoneOn();
            }
        }
        this.forceUpdate();
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    call() {
        assert(this.props.currentCall === null, 'currentCall is not null');
        //console.log('Call: starting call', this.props.callUUID, 'to', this.props.targetUri);
        let options = {pcConfig: {iceServers: config.iceServers}, id: this.props.callUUID};
        options.localStream = this.props.localMedia;
        let call = this.props.account.call(this.props.targetUri, options);
        call.on('stateChanged', this.callStateChanged);
    }

    answerCall() {
        console.log('Call: answer call');
        assert(this.props.currentCall !== null, 'currentCall is null');
        let options = {pcConfig: {iceServers: config.iceServers}};
        options.localStream = this.props.localMedia;
        this.props.currentCall.answer(options);
    }

    hangupCall() {
        console.log('Call: hangup call');
        let callUUID = this.props.currentCall._callkeepUUID;
        this.props.hangupCall(callUUID);
    }

    mediaPlaying() {
        if (this.props.currentCall === null) {
            this.call();
        } else {
            this.answerCall();
        }
    }

    render() {
        //console.log('Call: render call to', this.props.targetUri);
        let box = null;

        let remoteUri = this.props.targetUri;
        let remoteDisplayName;

        if (this.props.currentCall !== null && this.props.currentCall.state == 'established') {
            remoteUri = this.props.currentCall.remoteIdentity.uri;
            remoteDisplayName = this.props.currentCall.remoteIdentity.displayName || this.props.currentCall.remoteIdentity.uri;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
        }

        if (remoteUri.indexOf('3333@') > -1) {
            remoteDisplayName = 'Video Test';
        } else if (remoteUri.indexOf('4444@') > -1) {
            remoteDisplayName = 'Echo Test';
        } else {
            var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', remoteUri);
            if (contact_obj) {
                remoteDisplayName = contact_obj.displayName;
            }
        }

        if (this.props.localMedia !== null) {
            //console.log('Will render audio box');
            if (this.state.audioOnly) {
                box = (
                    <AudioCallBox
                        remoteUri = {remoteUri}
                        remoteDisplayName = {remoteDisplayName}
                        hangupCall = {this.hangupCall}
                        call = {this.props.currentCall}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        callKeepToggleMute = {this.props.callKeepToggleMute}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    />
                );
            } else {
                if (this.props.currentCall != null && this.props.currentCall.state === 'established') {
                    box = (
                        <VideoBox
                            call = {this.props.currentCall}
                            remoteUri = {remoteUri}
                            remoteDisplayName = {remoteDisplayName}
                            localMedia = {this.props.localMedia}
                            shareScreen = {this.props.shareScreen}
                            hangupCall = {this.hangupCall}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            callKeepToggleMute = {this.props.callKeepToggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        />
                    );
                } else {
                    //console.log('Will render local media');
                    if (this.props.currentCall && this.props.currentCall.state && this.props.currentCall.state === 'terminated') {
                        // do not render
                    } else {
                        box = (
                            <LocalMedia
                                remoteUri = {remoteUri}
                                remoteDisplayName = {remoteDisplayName}
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
    account                 : PropTypes.object.isRequired,
    hangupCall              : PropTypes.func.isRequired,
    shareScreen             : PropTypes.func,
    currentCall             : PropTypes.object,
    escalateToConference    : PropTypes.func,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    callKeepToggleMute      : PropTypes.func,
    speakerphoneOn          : PropTypes.func,
    speakerphoneOff         : PropTypes.func,
    callUUID                : PropTypes.string,
    contacts                : PropTypes.object
};


export default Call;
