import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors } from 'react-native-paper';
import { View, Dimensions, TouchableWithoutFeedback, TouchableOpacity, Platform  } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {StatusBar} from 'react-native';
import Immersive from 'react-native-immersive';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';

import CallOverlay from './CallOverlay';

import EscalateConferenceModal from './EscalateConferenceModal';

import config from '../config';
//import TrafficStats from './BarChart';
import utils from '../utils';

import styles from '../assets/styles/VideoCall';

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
            showMyself: true,
            remoteVideoShow: true,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            callContact: this.props.callContact,
            selectedContact: this.props.selectedContact,
            selectedContacts: this.props.selectedContacts,
            localStream: this.props.call.getLocalStreams()[0],
            remoteStream: this.props.call.getRemoteStreams()[0],
            localMedia: this.props.localMedia,
            statistics: [],
            myVideoCorner: 'topLeft',
            fullScreen: false,
            enableMyVideo: true,
            swapVideo: false
        };

		this.prevStats = {}; // initialize here
		this.prevValues = {};
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

    componentDidMount() {
        if (this.state.call) {
            this.state.call.on('stateChanged', this.callStateChanged);
        }

        //this.armOverlayTimer();

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

    get showMyself() {
		return this.state.showMyself && !this.state.videoMuted && this.state.enableMyVideo;
	}

    get isLandscape() {
		return this.props.orientation === 'landscape';
	}

    handleFullscreen(event) {
        event.preventDefault();
        // this.toggleFullscreen();
    }

    handleRemoteVideoPlaying() {
        this.setState({remoteVideoShow: true});
    }
    
	toggleFullScreen() {
		//console.log(' --toggleFullScreen');

		if (this.state.callOverlayVisible) {			
			this.setState({callOverlayVisible: false, fullScreen: true});
			StatusBar.setHidden(true, 'fade');
			if (Platform.OS === 'android') {
				Immersive.on();
			}
		} else {
			this.setState({callOverlayVisible: true, fullScreen: false});
			StatusBar.setHidden(false, 'fade');
			if (Platform.OS === 'android') {
				Immersive.off();
			}
		}
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

    get showRemote() {
		return this.state.remoteVideoShow && !this.state.reconnectingCall;
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
	
	  // Skip if we don’t have valid streams yet
	  if (!videoOutbound && !audioOutbound) return;
	
	  // ---- Store previous stats for bitrate calculation ----
	  if (!this.prevStats) this.prevStats = {};
	  const now = Date.now();
	
	  const calcBitrate = (type, currentBytes, currentTimestamp) => {
		const prev = this.prevStats[type];
		if (!prev || prev.bytes === 0) {
		  this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
		  return 0;
		}
	
		const bytesDelta = currentBytes - prev.bytes;
		const timeDelta = (currentTimestamp - prev.ts) / 1000; // seconds
		this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
	
		if (timeDelta <= 0 || bytesDelta < 0) return 0;
		return (bytesDelta * 8) / timeDelta; // bits/sec
	  };
	
	  // ---- Compute upload/download ----
	  let bandwidthUpload = 0;
	  let bandwidthDownload = 0;
	
	  if (videoOutbound) {
		bandwidthUpload = calcBitrate('videoUpload', videoOutbound.bytesSent, videoOutbound.timestamp);
	  }
	
	  if (videoInbound) {
		// react-native-webrtc bug: bytesReceived often = 0 on Android
		if (videoInbound.bytesReceived > 0) {
		  bandwidthDownload = calcBitrate('videoDownload', videoInbound.bytesReceived, videoInbound.timestamp);
		} else if (videoInbound.packetRate > 0) {
		  // Fallback: estimate bitrate from packet rate × avg packet size (1200 bytes)
		  const estBytesPerSec = videoInbound.packetRate * 1200;
		  bandwidthDownload = estBytesPerSec * 8; // bits/sec
		}
	  }
	  
	  //console.log('bandwidthDownload', bandwidthDownload);
	  //console.log('bandwidthUpload', bandwidthUpload)
	
	  // ---- Smooth over 2-second window ----
	  this.bandwidthHistory = this.bandwidthHistory || [];
	  this.bandwidthHistory.push({ ts: now, up: bandwidthUpload, down: bandwidthDownload });
	
	  // keep only last 2 seconds
	  this.bandwidthHistory = this.bandwidthHistory.filter(d => now - d.ts < 2000);
	
	  const smoothUpload = this.bandwidthHistory.reduce((a, b) => a + b.up, 0) / this.bandwidthHistory.length || 0;
	  const smoothDownload = this.bandwidthHistory.reduce((a, b) => a + b.down, 0) / this.bandwidthHistory.length || 0;
	
	  // ---- Format info ----
	  const appendBits = bits => {
		if (bits > 1_000_000) return (bits / 1_000_000).toFixed(1) + ' Mbits/s';
		if (bits > 1_000) return (bits / 1_000).toFixed(1) + ' kbits/s';
		return bits.toFixed(0) + ' bits/s';
	  };
	
	  let info = '';
	  if (smoothDownload > 0 && smoothUpload > 0) {
		info = `⇣${appendBits(smoothDownload)} ⇡${appendBits(smoothUpload)}`;
	  } else if (smoothDownload > 0) {
		info = `⇣${appendBits(smoothDownload)}`;
	  } else if (smoothUpload > 0) {
		info = `⇡${appendBits(smoothUpload)}`;
	  }
	
	   
	  // ---- Save to state ----
	  this.setState(state => ({
		statistics: [...state.statistics, { up: smoothUpload, down: smoothDownload }].slice(-MAX_POINTS),
		info,
	  }));
	}

    hangupCall(event) {
        //event.preventDefault();
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

    toggleEscalateConferenceModal() {
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }

        this.setState({
            callOverlayVisible          : false,
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    toggleMyVideo() {
        this.setState({enableMyVideo: !this.state.enableMyVideo});    
    }

    swapVideo() {
        if (!this.state.swapVideo) {
			this.setState({enableMyVideo: false});    
        }
        this.setState({swapVideo: !this.state.swapVideo});    
    }
    
    get localStreamUrl() {
		if (this.state.swapVideo) {
			return this.state.remoteStream ? this.state.remoteStream.toURL() : null
        }
		return this.state.localStream ? this.state.localStream.toURL() : null;
    }

    get remoteStreamUrl() {
		if (this.state.swapVideo) {
			return this.state.localStream ? this.state.localStream.toURL() : null;
        }
		return this.state.remoteStream ? this.state.remoteStream.toURL() : null
    }

    render() {

        if (this.state.call === null) {
            return null;
        }

        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

        let buttonsContainerClass;

        let buttons;
        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcons = this.state.videoMuted ? 'video-off' : 'video';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        const buttonSize = this.props.isTablet ? 40 : 34;

        if (this.props.isTablet) {
            buttonsContainerClass = this.props.orientation === 'landscape' ? styles.tabletLandscapebuttonsContainer : styles.tabletPortraitbuttonsContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonsContainerClass = this.props.orientation === 'landscape' ? styles.landscapebuttonsContainer : styles.portraitbuttonsContainer;
        }

        let disablePlus = true;
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

        const show = this.state.callOverlayVisible || this.state.reconnectingCall;
		let { width, height } = Dimensions.get('window');
        
		const topInset = initialWindowMetrics?.insets.top || 0;
		const bottomInset = initialWindowMetrics?.insets.bottom || 0;
		const leftInset = initialWindowMetrics?.insets.left || 0;
		const rightInset = initialWindowMetrics?.insets.right || 0;

	    const cornerOrder = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

		let corners = {
			  topLeft: { top: 0, left: 0 },
			  topRight: { top: 0, right: 0 },
			  bottomRight: { bottom: 0, right: 0 },
			  bottomLeft: { bottom: 0, left: 0},
			  id: 'init'
		};

        const debugBorderWidth = 0;
        
        const myVideoCorner = this.state.myVideoCorner;

        let container = styles.container;
        let remoteVideoContainer = styles.remoteVideoContainer;
        let buttonsContainer = styles.buttonsContainer;
        let video = styles.video;

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonsContainerClass}>
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
                    title="Toggle camera"
                    onPress={this.toggleCamera}
                    icon='camera-switch'
                    key="toggleVideo"
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
            buttons = (<View style={buttonsContainer}>{content}</View>);
        }
        
        const headerBarHeight = 60;
        
        container = {
            flex: 1,
			borderWidth: debugBorderWidth,
			borderColor: 'white'
        }

        let myselfContainer = {
			  position: 'absolute',
			  top: 0,
			  left: 0,
			  right: 0,
			  bottom: 0,
			  zIndex: 1000,
			  pointerEvents: 'box-none'
			};

	    remoteVideoContainer = {
			position: 'absolute',
			left: 0,
			right: 0,
			top: headerBarHeight + topInset,
			bottom: 0,
			width: this.isLandscape  ? width - bottomInset : width,
			height: this.isLandscape ? height - headerBarHeight - topInset: height - bottomInset - headerBarHeight - topInset,
			borderWidth: debugBorderWidth,
			borderColor: 'red'
		};
		
		if (this.state.fullScreen) {
			remoteVideoContainer.height = height;
			remoteVideoContainer.top = 0;
			remoteVideoContainer.width = width;
		}
		
		if (Platform.OS === 'android') {
		      if (this.isLandscape) {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, left: 0 },
					  topRight: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, right: this.state.fullScreen ? 0: bottomInset },
					  bottomRight: { bottom: -bottomInset, right: this.state.fullScreen ? 0: bottomInset },
					  bottomLeft: { bottom: -bottomInset, left: 0},
					  id: 'android-landscape'
				  };
			  } else {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, left: 0 },
					  topRight: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, right: 0},
					  bottomRight: { bottom:  this.state.fullScreen ? -bottomInset: 150, right: 0 },
					  bottomLeft: { bottom: this.state.fullScreen ? -bottomInset: 150, left: 0},
					  id: 'android-portrait'
				  };
			  }
		} else {
			// ios
		      if (this.isLandscape) {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? 0 : headerBarHeight +5, left: this.state.fullScreen ? -topInset : 0 },
					  topRight: { top: this.state.fullScreen ? 0 : headerBarHeight +5, right: this.state.fullScreen  ? -25 - bottomInset: -25 },
					  bottomRight: { bottom: -bottomInset, right: this.state.fullScreen  ? -25 - bottomInset: -25 },
					  bottomLeft: { bottom: -bottomInset, left: this.state.fullScreen ? -topInset : 0 },
					  id: 'ios-landscape'
				  };

				remoteVideoContainer = {
					position: 'absolute',
					left: this.state.fullScreen ? - topInset : 0,
					top: this.state.fullScreen ? 0 : headerBarHeight,
					width: this.state.fullScreen ? width: width - bottomInset - topInset,
					height: this.state.fullScreen ? height : height - topInset ,
					borderWidth: debugBorderWidth,
					borderColor: 'red'
				};

			  } else {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? -topInset : topInset, left: 0 },
					  topRight: { top: this.state.fullScreen ? -topInset : topInset, right: 0},
					  bottomRight: { bottom:  this.state.fullScreen ? -bottomInset: 150, right: 0 },
					  bottomLeft: { bottom: this.state.fullScreen ? -bottomInset: 150, left: 0},
					  id: 'ios-portrait'
				  };

				remoteVideoContainer = {
					position: 'absolute',
					top: this.state.fullScreen ? -topInset : headerBarHeight,
					width: width,
					height: this.state.fullScreen ? height : height - topInset -headerBarHeight ,
					borderWidth: debugBorderWidth,
					borderColor: 'red'
				};
			  }
		}

		let mySurfaceContainer = {
			flex: 1,
			width: 120,
			height: 90,
			elevation: 5,
			borderWidth: 0,
			zIndex: 1000,
		  };

				  
		let corner = {
		  ...corners[this.state.myVideoCorner],
		};
		
		let fullScreen = this.state.fullScreen;

  
		if (debugBorderWidth) {
			const values = {
			  topInset,
			  bottomInset,
			  leftInset,
			  rightInset,
			  container,
			  remoteVideoContainer,
			  buttonsContainer,
			  buttonsContainerClass,
			  myselfContainer,
			  video,
			  corner,
			  corners,
			  myVideoCorner,
			  fullScreen
			};

			const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
		
			Object.entries(values).forEach(([key, value]) => {
			  const prev = this.prevValues[key];
			   const paddedKey = key.padStart(maxKeyLength, ' '); // right
			  if (JSON.stringify(prev) !== JSON.stringify(value)) {
				console.log(paddedKey, value);
			  }
			});

			this.prevValues = values;
		}
							
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
                    isLandscape = {this.isLandscape}         
                    toggleMyVideo= {this.toggleMyVideo}    
                    swapVideo= {this.swapVideo}    
                    enableMyVideo={this.state.enableMyVideo}    
                    hangupCall={this.hangupCall}
                />

                {this.showRemote?
					<View style={[container, remoteVideoContainer]}>
					  <RTCView
						objectFit='cover'
						style={styles.video}
						streamURL={this.remoteStreamUrl}
					  />
					  <TouchableWithoutFeedback onPress={this.toggleFullScreen}>
						<View style={StyleSheet.absoluteFillObject} />
					  </TouchableWithoutFeedback>
					</View>
				: null }


                {this.showMyself ?
				  <View
					style={myselfContainer}
				  >
					<View
					  style={{
						position: 'absolute',
						width: 120,
						height: 160,
						...corner,
					  }}
					>
					  <TouchableOpacity
						style={{ flex: 1 }}
						onPress={() => {
						  const currentIndex = cornerOrder.indexOf(this.state.myVideoCorner);
						  const nextIndex = (currentIndex + 1) % cornerOrder.length;
						  this.setState({ myVideoCorner: cornerOrder[nextIndex] });
						}}
					  >
					  <Surface style={mySurfaceContainer}>
						<RTCView
							objectFit='cover'
							style={styles.video}
							ref={this.localVideo}
							streamURL={this.localStreamUrl}
							mirror={this.state.mirror}
						/>
					</Surface>
					  </TouchableOpacity>
					</View>
	
				  </View>
                 : null }

                {this.state.reconnectingCall ?
                    <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={'#D32F2F'} />
                    : null
                }

                {buttons}

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
