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
//import TrafficStats from './BarChart';
import utils from '../utils';

const DEBUG = debug('blinkrtc:Video');
debug.enable('*');


class VideoBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            reconnectingCall: this.props.reconnectingCall,
            audioMuted: this.props.muted,
            mirror: true,
            callOverlayVisible: true,
            videoMuted: false,
            localVideoShow: true,
            remoteVideoShow: true,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            localStream: this.props.call.getLocalStreams()[0],
            remoteStream: this.props.call.getRemoteStreams()[0],
            info: this.props.info,
            showDtmfModal: false,
            doorOpened: false,
            packetLossQueue             : [],
            audioBandwidthQueue         : [],
            latencyQueue                : []
        };

        this.overlayTimer = null;
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();
        this.userHangup = false;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.hasOwnProperty('info')) {
            this.setState({info: nextProps.info});
        }

        if (nextProps.hasOwnProperty('packetLossQueue')) {
            this.setState({packetLossQueue: nextProps.packetLossQueue});
        }

        if (nextProps.hasOwnProperty('audioBandwidthQueue')) {
            this.setState({audioBandwidthQueue: nextProps.audioBandwidthQueue});
        }

        if (nextProps.hasOwnProperty('latencyQueue')) {
            this.setState({latencyQueue: nextProps.latencyQueue});
        }

        if (nextProps.call && nextProps.call !== this.state.call) {
            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            this.setState({call: nextProps.call,
                           localStream: nextProps.call.getLocalStreams()[0],
                           remoteStream: nextProps.call.getRemoteStreams()[0]
            });
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

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

        if (this.state.call !== null && this.state.call.state === 'established') {
            this.state.call.sendDtmf(tone);
        }
    }

    componentDidMount() {
        if (this.state.call) {
            this.state.call.on('stateChanged', this.callStateChanged);
        }
        this.armOverlayTimer();
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
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
        this.props.toggleMute(this.state.call.id, !this.state.audioMuted);
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
            this.setState({mirror: !this.state.mirror});
        }
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_cancel_call');
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
        if (this.state.call === null) {
            return null;
        }

        // 'mirror'          : !this.state.call.sharingScreen && !this.props.generatedVideoTrack,
        // we do not want mirrored local video once the call has started, just in preview

        const localVideoClasses = classNames({
            'video-thumbnail' : true,
            'hidden'          : !this.state.localVideoShow,
            'animated'        : true,
            'fadeIn'          : this.state.localVideoShow || this.state.videoMuted,
            'fadeOut'         : this.state.videoMuted,
            'fit'             : this.state.call.sharingScreen
        });

        const remoteVideoClasses = classNames({
            'poster'        : !this.state.remoteVideoShow,
            'animated'      : true,
            'fadeIn'        : this.state.remoteVideoShow,
            'large'         : true,
            'fit'           : this.state.remoteSharesScreen
        });

        let buttonContainerClass;

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
                        disabled={!(this.state.call && this.state.call.state === 'accepted')}
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
        const show = this.state.callOverlayVisible || this.state.reconnectingCall;

        return (
            <View style={styles.container}>
                <CallOverlay
                    show = {show}
                    remoteUri = {this.props.remoteUri}
                    remoteDisplayName = {this.props.remoteDisplayName}
                    photo={this.props.photo}
                    call = {this.state.call}
                    connection = {this.props.connection}
                    accountId = {this.props.accountId}
                    info={this.state.info}
                    media='video'
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                />
                {this.state.remoteVideoShow && !this.state.reconnectingCall ?
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
                                mirror={this.state.mirror}
                            />
                        </TouchableWithoutFeedback>
                    </View>
                    : null }

                {this.state.reconnectingCall
                    ? <ActivityIndicator style={styles.reconnectContainer} animating={true} size={'large'} color={Colors.red800} />
                    : null
                }
                {buttons}
                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.state.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
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
    photo                   : PropTypes.string,
    accountId               : PropTypes.string,
    remoteUri               : PropTypes.string,
    remoteDisplayName       : PropTypes.string,
    localMedia              : PropTypes.object,
    hangupCall              : PropTypes.func,
    info                    : PropTypes.string,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    intercomDtmfTone        : PropTypes.string,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
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
    selectedContact         : PropTypes.object
};

export default VideoBox;
