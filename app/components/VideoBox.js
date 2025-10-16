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
//debug.enable('*');

const MAX_POINTS = 30;

function appendBits(bits) {
    let i = -1;
    const byteUnits = 'kMGTPEZY';
    do {
        bits = bits / 1000;
        i++;
    } while (bits > 1000);

    return `${Math.max(bits, 0.1).toFixed(bits < 100 ? 1 : 0)} ${byteUnits[i]}bits/s`;
};

class VideoBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            remoteUri: this.props.remoteUri,
            photo: this.props.photo,
            remoteDisplayName: this.props.remoteDisplayName,
            call: this.props.call,
            reconnectingCall: this.props.reconnectingCall,
            audioMuted: this.props.muted,
            videoMuted: this.props.videoMuted,
            terminatedReason: this.props.terminatedReason,
            mirror: true,
            callOverlayVisible: true,
            localVideoShow: true,
            remoteVideoShow: true,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            callContact: this.props.callContact,
            selectedContact: this.props.selectedContact,
            selectedContacts: this.props.selectedContacts,
            localStream: this.props.call.getLocalStreams()[0],
            remoteStream: this.props.call.getRemoteStreams()[0],
            showDtmfModal: false,
            doorOpened: false,
            localMedia                  : this.props.localMedia,
            statistics: []
        };

        this.overlayTimer = null;
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();
        this.userHangup = false;
        if (this.props.call) {
            this.props.call.statistics.on('stats', this.statistics);
        }
        
		const localStream = this.state.localStream;
		if (localStream.getVideoTracks().length > 0) {
			if (this.props.videoMuted) {
				const track = localStream.getVideoTracks()[0];
				track.enabled = false;
				console.log('Initial video is muted');
			} else {
				console.log('Initial video is not muted');
			}
		} else {
			console.log('No video track');
		}
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.hasOwnProperty('info')) {
            this.setState({info: nextProps.info});
        }

        if (nextProps.hasOwnProperty('videoMuted')) {
            this.setState({videoMuted: nextProps.videoMuted});
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

        this.setState({
                       callContact: nextProps.callContact,
                       remoteUri: nextProps.remoteUri,
                       photo: nextProps.photo ? nextProps.photo : this.state.photo,
                       remoteDisplayName: nextProps.remoteDisplayName,
                       selectedContact: nextProps.selectedContact,
                       selectedContacts: nextProps.selectedContacts,
                       localMedia: nextProps.localMedia,
                       terminatedReason: nextProps.terminatedReason
                       });

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

        if (this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

		if (this.state.call != null && this.state.call.statistics != null) {
			this.state.call.statistics.removeListener('stats', this.statistics);
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

    statistics(stats) {
        const { audio: audioData, video: videoData, remote } = stats.data;
        const { audio: audioRemoteData, video: videoRemoteData } = remote;

        const audioInbound = audioData?.inbound?.[0];
        const audioOutbound = audioData?.outbound?.[0];
        const videoInbound = videoData?.inbound?.[0];
        const videoOutbound = videoData?.outbound?.[0];

        const remoteAudioInbound = audioRemoteData?.inbound?.[0];
        const remoteVideoInbound = videoRemoteData?.inbound?.[0];

        const audioRemoteExists = !!remoteAudioInbound;
        const videoRemoteExists = !!remoteVideoInbound;

        if (!audioRemoteExists && !videoRemoteExists) return;

        const videoRTT = remoteVideoInbound?.roundTripTime || 0;
        const audioRTT = remoteAudioInbound?.roundTripTime || 0;
        const finalVideoRTT = videoRTT || audioRTT;

        const addData = {
            audio: {
                timestamp: audioData?.timestamp,
                incomingBitrate: audioInbound?.bitrate || 0,
                outgoingBitrate: audioOutbound?.bitrate || 0,
                latency: (audioRTT / 2) || 0,
                jitter: audioInbound?.jitter || 0,
                packetsLostOutbound: remoteAudioInbound?.packetLossRate || 0,
                packetsLostInbound: audioInbound?.packetLossRate || 0,
                packetRateOutbound: audioOutbound?.packetRate || 0,
                packetRateInbound: audioInbound?.packetRate || 0,
                audioCodec: (remoteAudioInbound?.mimeType?.split?.('/')?.[1]) || ''
            },
            video: {
                timestamp: videoData?.timestamp,
                incomingBitrate: videoInbound?.bitrate || 0,
                outgoingBitrate: videoOutbound?.bitrate || 0,
                latency: (finalVideoRTT / 2) || 0,
                jitter: videoInbound?.jitter || 0,
                packetsLostOutbound: remoteVideoInbound?.packetLossRate || 0,
                packetsLostInbound: videoInbound?.packetLossRate || 0,
                packetRateOutbound: videoOutbound?.packetRate || 0,
                packetRateInbound: videoInbound?.packetRate || 0,
                videoCodec: (remoteVideoInbound?.mimeType?.split?.('/')?.[1]) || ''
            }
        };

        let info = '';
        let bandwidthUpload, bandwidthDownload;
        if (addData.video.incomingBitrate > 0 || addData.video.outgoingBitrate > 0) {
            bandwidthUpload = addData.video.outgoingBitrate;
            bandwidthDownload = addData.video.incomingBitrate;
        }

        if (bandwidthDownload > 0 && bandwidthUpload > 0) {
            info = '⇣' + appendBits(bandwidthDownload) + ' ⇡' + appendBits(bandwidthUpload);
        } else if (bandwidthDownload > 0) {
            info = '⇣' + appendBits(bandwidthDownload);
        } else if (bandwidthUpload > 0) {
            info = '⇡' + appendBits(bandwidthUpload);
        }

        this.setState(state => ({
            statistics: [...state.statistics, addData].slice(-MAX_POINTS),
            info: info
        }));
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
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }

        this.setState({
            callOverlayVisible          : false,
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    render() {

        if (this.state.call === null) {
            return null;
        }

        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

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

        let disablePlus = false;
        if (this.state.callContact) {
            if (isPhoneNumber) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('test') > -1) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('conference') > -1) {
                disablePlus = true;
            }
        }

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonContainerClass}>
                {!disablePlus ?
                <IconButton
                    size={buttonSize}
                    style={buttonClass}
                    onPress={this.props.inviteToConferenceFunc}
                    icon="account-plus"
                />
                : null}
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
                    icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'headphones'}
                    onPress={this.props.toggleSpeakerPhone}
                />
                <IconButton
                    size={buttonSize}
                    style={[buttonClass, styles.hangupButton]}
                    onPress={this.hangupCall}
                    icon="phone-hangup"
                />
            </View>);
            buttons = (<View style={styles.buttonContainer}>{content}</View>);
        }

        const remoteStreamUrl = this.state.remoteStream ? this.state.remoteStream.toURL() : null
        const show = this.state.callOverlayVisible || this.state.reconnectingCall;

        return (
            <View style={styles.container}>
                <CallOverlay
                    show = {show}
                    remoteUri = {this.state.remoteUri}
                    remoteDisplayName = {this.state.remoteDisplayName}
                    photo = {this.state.photo}
                    localMedia = {this.state.localMedia}
                    call = {this.state.call}
                    connection = {this.state.connection}
                    accountId = {this.state.accountId}
                    info={this.state.info}
                    media='video'
                    videoCodec={this.props.videoCodec}
                    audioCodec={this.props.audioCodec}
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                    terminatedReason={this.state.terminatedReason}
                />
                {this.state.remoteVideoShow && !this.state.reconnectingCall ?
                        <TouchableWithoutFeedback onPress={this.toggleCallOverlay}>
                    <View style={[styles.container, styles.remoteVideoContainer]}>
                            <RTCView
                                objectFit='cover'
                                style={[styles.video, styles.remoteVideo]}
                                poster="assets/images/transparent-1px.png"
                                ref={this.remoteVideo}
                                streamURL={remoteStreamUrl}
                            />
                    </View>
                        </TouchableWithoutFeedback>
                    : null }
                { this.state.localVideoShow ?
                        <TouchableWithoutFeedback onPress={this.toggleCamera}>
                    <View style={[styles.localVideoContainer]}>
                            <RTCView
                                objectFit='cover'
                                style={[styles.video, styles.localVideo]}
                                ref={this.localVideo}
                                streamURL={this.state.localStream ? this.state.localStream.toURL() : null}
                                mirror={this.state.mirror}
                            />
                    </View>
                        </TouchableWithoutFeedback>
                    : null }

                {this.state.reconnectingCall ?
                    <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={'#D32F2F'} />
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
                    selectedContacts={this.state.selectedContacts}
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
    callContact             : PropTypes.object,
    selectedContact         : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    terminatedReason        : PropTypes.string,
    videoMuted              : PropTypes.bool
};

export default VideoBox;
