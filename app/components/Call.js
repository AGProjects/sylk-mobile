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

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            //logger.debug('Will send audio only');
            audioOnly = true;
        }

        let remoteUri = '';
        let remoteDisplayName = '';

        if (this.props.call !== null) {
            // If current call is available on mount we must have incoming
            this.props.call.on('stateChanged', this.callStateChanged);
            remoteUri = this.props.call.remoteIdentity.uri;
            remoteDisplayName = this.props.call.remoteIdentity.displayName;
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
        }

        this.state = {
                      audioOnly: audioOnly,
                      remoteUri: remoteUri,
                      remoteDisplayName: remoteDisplayName
                      }

    }

    lookupContact() {
        // console.log('Lookup contact');
        let remoteUri = '';
        let remoteDisplayName = '';

        if (this.props.call !== null) {
            remoteUri = this.props.call.remoteIdentity.uri;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
            console.log('Incoming call remoteUri', remoteUri);
            console.log('Incoming call remoteDisplayName', remoteDisplayName);
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
                       remoteUri: remoteUri
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
    }

    callStateChanged(oldState, newState, data) {
        // console.log('Call: callStateChanged', newState, '->', newState);
        if (newState === 'established') {
            // Check the media type again, remote can choose to not accept all offered media types
            const currentCall = this.props.call;
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
        //console.log('Call: Make new call');
        assert(this.props.call === null, 'currentCall is not null');

        this.lookupContact();

        let options = {pcConfig: {iceServers: config.iceServers}, id: this.props.callUUID};
        options.localStream = this.props.localMedia;
        let call = this.props.account.call(this.props.targetUri, options);
        call.on('stateChanged', this.callStateChanged);
    }

    answerCall() {
        //console.log('Call: Answer call');
        assert(this.props.call !== null, 'currentCall is null');

        this.lookupContact();
        console.log('lookup done');

        let options = {pcConfig: {iceServers: config.iceServers}};
        options.localStream = this.props.localMedia;
        this.props.call.answer(options);
    }

    hangupCall() {
        let callUUID = this.props.call._callkeepUUID;
        this.props.call.removeListener('stateChanged', this.callStateChanged);
        this.props.hangupCall(callUUID);
    }

    mediaPlaying() {
        if (this.props.call === null) {
            this.call();
        } else {
            this.answerCall();
        }
    }

    render() {
        //console.log('Call: render call to', this.state.remoteUri);
        let box = null;

        if (this.props.localMedia !== null) {
            if (this.state.audioOnly) {
                box = (
                    <AudioCallBox
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        hangupCall = {this.hangupCall}
                        call = {this.props.call}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        callKeepToggleMute = {this.props.callKeepToggleMute}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        orientation = {this.props.orientation}
                        isTablet = {this.props.isTablet}
                    />
                );
            } else {
                if (this.props.call != null && this.props.call.state === 'established') {
                    box = (
                        <VideoBox
                            call = {this.props.call}
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            localMedia = {this.props.localMedia}
                            shareScreen = {this.props.shareScreen}
                            hangupCall = {this.hangupCall}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            callKeepToggleMute = {this.props.callKeepToggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            orientation = {this.props.orientation}
                            isTablet = {this.props.isTablet}
                        />
                    );
                } else {
                    //console.log('Will render local media');
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
    account                 : PropTypes.object.isRequired,
    hangupCall              : PropTypes.func.isRequired,
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
    isTablet                : PropTypes.bool
};


export default Call;
