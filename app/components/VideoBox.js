import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors } from 'react-native-paper';
import { View, Dimensions, TouchableWithoutFeedback, Platform  } from 'react-native';
import { RTCView } from 'react-native-webrtc';

import CallOverlay from './CallOverlay';
import EscalateConferenceModal from './EscalateConferenceModal';
import DTMFModal from './DTMFModal';
import config from '../config';
import styles from '../assets/styles/blink/_VideoBox.scss';

const DEBUG = debug('blinkrtc:Video');
debug.enable('*');


class VideoBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            callOverlayVisible: true,
            audioMuted: false,
            videoMuted: false,
            localVideoShow: false,
            remoteVideoShow: false,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            localStream: null,
            remoteStream: null,
            showDtmfModal: false,
            doorOpened: false
        };

        this.overlayTimer = null;
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();
        this.userHangup = false;
    }

    callStateChanged(oldState, newState, data) {
        this.forceUpdate();
    }

    openDoor() {
        const tone = this.props.intercomDtmfTone;
        DEBUG('DTMF tone sent to intercom: ' + tone);
        this.setState({doorOpened: true});
        this.forceUpdate();

        dtmf.stopTone(); //don't play a tone at the same time as another
        dtmf.playTone(dtmf['DTMF_' + tone], 1000);

        if (this.props.call !== null && this.props.call.state === 'established') {
            this.props.call.sendDtmf(tone);
            /*this.props.notificationCenter.postSystemNotification('Door opened', {timeout: 5});*/
        }
    }

    componentDidMount() {
        this.setState({
            localStream: this.props.call.getLocalStreams()[0],
            localVideoShow: true,
            remoteStream: this.props.call.getRemoteStreams()[0],
            remoteVideoShow: true
        });

        if (this.props.call) {
            this.props.call.on('stateChanged', this.callStateChanged);
        }
        this.armOverlayTimer();
    }

    componentWillUnmount() {
        if (this.props.call != null) {
            this.props.call.removeListener('stateChanged', this.callStateChanged);
        }
    }

    showDtmfModal() {
        this.setState({showDtmfModal: true});
    }

    hideDtmfModal() {
        this.setState({showDtmfModal: false});
    }

    handleFullscreen(event) {
        event.preventDefault();
        // this.toggleFullscreen();
    }

    handleRemoteVideoPlaying() {
        this.setState({remoteVideoShow: true});
    }

    handleRemoteResize(event, target) {
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({remoteSharesScreen: true});
        } else {
            this.setState({remoteSharesScreen: false});
        }
    }

    muteAudio(event) {
        event.preventDefault();
        const localStream = this.state.localStream;
        if (localStream.getAudioTracks().length > 0) {
            const track = localStream.getAudioTracks()[0];
            if(this.state.audioMuted) {
                DEBUG('Unmute microphone');
                track.enabled = true;
                this.props.callKeepToggleMute(false);
                this.setState({audioMuted: false});
            } else {
                DEBUG('Mute microphone');
                track.enabled = false;
                this.props.callKeepToggleMute(true);
                this.setState({audioMuted: true});
            }
        }
    }

    muteVideo(event) {
        event.preventDefault();
        const localStream = this.state.localStream;
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if(this.state.videoMuted) {
                DEBUG('Unmute camera');
                track.enabled = true;
                this.setState({videoMuted: false});
            } else {
                DEBUG('Mute camera');
                track.enabled = false;
                this.setState({videoMuted: true});
            }
        }
    }

    toggleCamera(event) {
        event.preventDefault();
        const localStream = this.state.localStream;
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
        }
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_press_hangup');
        this.userHangup = true;
    }

    cancelCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_cancelled');
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    armOverlayTimer() {
        clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(() => {
            this.setState({callOverlayVisible: false});
        }, 4000);
    }

    toggleCallOverlay() {
        this.setState({callOverlayVisible: !this.state.callOverlayVisible});
    }

    toggleEscalateConferenceModal() {
        this.setState({
            callOverlayVisible          : false,
            showEscalateConferenceModal : !this.state.showEscalateConferenceModal
        });
    }

    render() {
        if (this.props.call === null) {
            return null;
        }

        // 'mirror'          : !this.props.call.sharingScreen && !this.props.generatedVideoTrack,
        // we do not want mirrored local video once the call has started, just in preview

        const localVideoClasses = classNames({
            'video-thumbnail' : true,
            'hidden'          : !this.state.localVideoShow,
            'animated'        : true,
            'fadeIn'          : this.state.localVideoShow || this.state.videoMuted,
            'fadeOut'         : this.state.videoMuted,
            'fit'             : this.props.call.sharingScreen
        });

        const remoteVideoClasses = classNames({
            'poster'        : !this.state.remoteVideoShow,
            'animated'      : true,
            'fadeIn'        : this.state.remoteVideoShow,
            'large'         : true,
            'fit'           : this.state.remoteSharesScreen
        });

        let buttonContainerClass;
        let userIconContainerClass;

        let buttons;
        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcons = this.state.videoMuted ? 'video-off' : 'video';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        const buttonSize = this.props.isTablet ? 40 : 34;

        if (this.props.isTablet) {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.tabletLandscapeButtonContainer : styles.tabletPortraitButtonContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
            userIconContainerClass = styles.userIconContainer;
        }

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonContainerClass}>
                <IconButton
                    size={buttonSize}
                    style={buttonClass}
                    onPress={this.toggleEscalateConferenceModal}
                    icon="account-plus"
                />
                <IconButton
                    size={buttonSize}
                    style={buttonClass}
                    onPress={this.muteAudio}
                    icon={muteButtonIcons}
                />
                <IconButton
                    size={buttonSize}
                    style={buttonClass}
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcons}
                />
                <IconButton
                    size={buttonSize}
                    style={[buttonClass]}
                    icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                    onPress={this.props.toggleSpeakerPhone}
                />
                <IconButton
                    size={buttonSize}
                    style={[buttonClass, styles.hangupButton]}
                    onPress={this.hangupCall}
                    icon="phone-hangup"
                />
            </View>);
            if (this.props.intercomDtmfTone) {
                content = (<View style={buttonContainerClass}>
                    <IconButton
                        size={50}
                        style={buttonClass}
                        icon={this.state.doorOpened ? "door-open": "door" }
                        onPress={this.openDoor}
                        disabled={!(this.props.call && this.props.call.state === 'established')}
                    />
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass]}
                        icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                        onPress={this.props.toggleSpeakerPhone}
                    />
                    <IconButton
                        size={50}
                        style={[styles.button, styles.hangupButton]}
                        onPress={this.hangupCall}
                        icon="phone-hangup"
                    />
                </View>);
            }
            buttons = (<View style={styles.buttonContainer}>{content}</View>);
        }

        const remoteStreamUrl = this.state.remoteStream ? this.state.remoteStream.toURL() : null
        //console.log('Render remote video stream Url', remoteStreamUrl);

        return (
            <View style={styles.container}>
                <CallOverlay
                    show = {this.state.callOverlayVisible || this.props.reconnectingCall}
                    remoteUri = {this.props.remoteUri}
                    remoteDisplayName = {this.props.remoteDisplayName}
                    call = {this.props.call}
                    connection = {this.props.connection}
                    accountId = {this.props.accountId}
                />
                {this.state.remoteVideoShow && !this.props.reconnectingCall ?
                    <View style={[styles.container, styles.remoteVideoContainer]}>
                        <TouchableWithoutFeedback onPress={this.toggleCallOverlay}>
                            <RTCView
                                objectFit='cover'
                                style={[styles.video, styles.remoteVideo]}
                                poster="assets/images/transparent-1px.png"
                                ref={this.remoteVideo}
                                streamURL={remoteStreamUrl}
                            />
                        </TouchableWithoutFeedback>
                    </View>
                    : null }
                { this.state.localVideoShow ?
                    <View style={[styles.localVideoContainer]}>
                        <TouchableWithoutFeedback onPress={this.toggleCamera}>
                            <RTCView
                                objectFit='cover'
                                style={[styles.video, styles.localVideo]}
                                ref={this.localVideo}
                                streamURL={this.state.localStream ? this.state.localStream.toURL() : null}
                                mirror={true}
                            />
                        </TouchableWithoutFeedback>
                    </View>
                    : null }

                {this.props.reconnectingCall
                    ? <ActivityIndicator style={styles.reconnectContainer} animating={true} size={'large'} color={Colors.red800} />
                    : null
                }
                {buttons}
                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.props.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.props.call}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
            </View>
        );
    }
}

VideoBox.propTypes = {
    call                    : PropTypes.object,
    connection              : PropTypes.object,
    accountId               : PropTypes.string,
    remoteUri               : PropTypes.string,
    remoteDisplayName       : PropTypes.string,
    localMedia              : PropTypes.object,
    hangupCall              : PropTypes.func,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    callKeepToggleMute      : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    intercomDtmfTone        : PropTypes.string,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool
};

export default VideoBox;
