import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors } from 'react-native-paper';
import { View, Dimensions, TouchableWithoutFeedback, TouchableOpacity, Platform, TouchableHighlight  } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {StatusBar} from 'react-native';
import Immersive from 'react-native-immersive';
import { StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';

import CallOverlay from './CallOverlay';

import EscalateConferenceModal from './EscalateConferenceModal';

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
            swapVideo: false,
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets,
			isLandscape:  this.props.isLandscape
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
                       terminatedReason: nextProps.terminatedReason,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   isLandscape: nextProps.isLandscape
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

	toggleAudioDevice() {
		console.log('toggleAudioDevice');
	
		const devices = this.props.availableAudioDevices;
		const current = this.props.selectedAudioDevice;
	
		if (!devices || devices.length === 0) return;
	
		// Find current index
		const currentIndex = devices.indexOf(current);
	
		// Compute next index (wrap around)
		const nextIndex = (currentIndex + 1) % devices.length;
	
		// Select next device
		const nextDevice = devices[nextIndex];
	
		console.log('Switching audio device to:', nextDevice);
		this.props.selectAudioDevice(nextDevice);
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
	  const { audio, video, remote, connection } = stats.data;
	  const audioInbound = audio?.inbound?.[0];
	  const audioOutbound = audio?.outbound?.[0];
	  const videoInbound = video?.inbound?.[0];
	  const videoOutbound = video?.outbound?.[0];
	
	  const remoteAudioInbound = remote?.audio?.inbound?.[0];
	  const remoteVideoInbound = remote?.video?.inbound?.[0];
	
	  if (!videoOutbound && !audioOutbound) return;
	
	  if (!this.prevStats) this.prevStats = {};
	  const now = Date.now();
	
	  const calcBitrate = (type, currentBytes, currentTimestamp) => {
		const prev = this.prevStats[type];
		if (!prev) {
		  this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
		  return 0;
		}
		const bytesDelta = currentBytes - prev.bytes;
		const timeDelta = (currentTimestamp - prev.ts) / 1000;
		this.prevStats[type] = { bytes: currentBytes, ts: currentTimestamp };
		if (timeDelta <= 0 || bytesDelta < 0) return 0;
		return (bytesDelta * 8) / timeDelta;
	  };
	
	  let bandwidthUpload = 0;
	  let bandwidthDownload = 0;
	
	  // --- Video bandwidth ---
	  if (videoOutbound) bandwidthUpload += calcBitrate('videoUpload', videoOutbound.bytesSent, videoOutbound.timestamp);
	  if (videoInbound) {
		if (videoInbound.bytesReceived > 0) {
		  bandwidthDownload += calcBitrate('videoDownload', videoInbound.bytesReceived, videoInbound.timestamp);
		} else if (videoInbound.packetRate > 0) {
		  bandwidthDownload += videoInbound.packetRate * 1200 * 8;
		}
	  }
	
	  // --- Audio bandwidth ---
	  if (audioOutbound) bandwidthUpload += calcBitrate('audioUpload', audioOutbound.bytesSent, audioOutbound.timestamp);
	  if (audioInbound) {
		if (audioInbound.bytesReceived > 0) {
		  bandwidthDownload += calcBitrate('audioDownload', audioInbound.bytesReceived, audioInbound.timestamp);
		} else if (audioInbound.packetRate > 0) {
		  bandwidthDownload += audioInbound.packetRate * 1200 * 8;
		}
	  }
	
	  // ---- Round Trip Time ----
	  const rtt = connection?.currentRoundTripTime ? connection.currentRoundTripTime * 1000 : 0; // ms
	
	  // ---- Packet Loss ----
	  const audioLoss = audioInbound && audioInbound.packetsLost
		? (audioInbound.packetsLost / audioInbound.packetsReceived) * 100
		: 0;
	  const videoLoss = videoInbound && videoInbound.packetsLost
		? (videoInbound.packetsLost / videoInbound.packetsReceived) * 100
		: 0;
	
	  // ---- Smooth over 2 seconds ----
	  this.bandwidthHistory = this.bandwidthHistory || [];
	  this.bandwidthHistory.push({ ts: now, up: bandwidthUpload, down: bandwidthDownload });
	
	  this.bandwidthHistory = this.bandwidthHistory.filter(d => now - d.ts < 2000);
	
	  const smoothUpload = this.bandwidthHistory.reduce((a, b) => a + b.up, 0) / this.bandwidthHistory.length || 0;
	  const smoothDownload = this.bandwidthHistory.reduce((a, b) => a + b.down, 0) / this.bandwidthHistory.length || 0;
	
	  const appendBits = bits => {
		if (bits > 1_000_000) return (bits / 1_000_000).toFixed(1) + 'Mbps';
		if (bits > 1_000) return (bits / 1_000).toFixed(0) + 'kbps';
		return bits.toFixed(0) + 'bits/s';
	  };
	
	  let info = `⇣${appendBits(smoothDownload)} ${rtt.toFixed(0)}ms`;
	  if (videoLoss > 10) {
		  info = info + ` ${videoLoss.toFixed(0)}%loss`;
	  }
	
	  this.setState(state => ({
		statistics: [...state.statistics, { up: smoothUpload, down: smoothDownload }].slice(-MAX_POINTS),
		info,
	  }));
	}
	

    hangupCall() {
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall() {
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

	renderAudioDeviceButtons() {
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  if (!this.state.callOverlayVisible) {
		 return null;
	  }
	
	  let buttonsContainerClass;

        if (this.props.isTablet) {
            buttonsContainerClass = this.state.isLandscape ? styles.tabletLandscapebuttonsContainer : styles.tabletPortraitbuttonsContainer;
        } else {
            buttonsContainerClass = this.state.isLandscape ? styles.landscapebuttonsContainer : styles.portraitbuttonsContainer;
        }
	  
	  if (!call || call.state !== 'established') {
		 return null;
	  }
	 
	  if (this.props.useInCallManger) {
		 return null;
	  }

      if (!availableAudioDevices) return null;
	  
	  return (
	  <View style={buttonsContainerClass}>
		<View style={styles.audioDeviceContainer}>
		  {availableAudioDevices.map((device) => {
			const icon = utils.availableAudioDevicesIconsMap[device];
			if (!icon) return null;
	
			const isSelected = device === selectedAudioDevice;
	
		return (
		  <View
			key={device}
			style={[
			  styles.audioDeviceButtonContainer,
			  isSelected && styles.audioDeviceSelected
			]}
		  >
			<TouchableHighlight>
			  <IconButton
				size={34}
				style={styles.audioDeviceWhiteButton}
				icon={icon}
				onPress={() => this.props.selectAudioDevice(device)}
			  />
			</TouchableHighlight>
			  </View>
			);
		  })}
		</View>
		</View>
	  );
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
            buttonsContainerClass = this.state.isLandscape ? styles.tabletLandscapebuttonsContainer : styles.tabletPortraitbuttonsContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonsContainerClass = this.state.isLandscape ? styles.landscapebuttonsContainer : styles.portraitbuttonsContainer;
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
        
		const topInset = this.state.insets.top || 0;
		const bottomInset = this.state.insets.bottom || 0;
		const leftInset = this.state.insets.left || 0;
		const rightInset = this.state.insets.right || 0;

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

				{ this.props.useInCallManger ?
                <IconButton
                    size={buttonSize}
                    style={[buttonClass]}
                    icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'headphones'}
                    onPress={this.props.toggleSpeakerPhone}
                />
                : 
                <IconButton
                    size={buttonSize}
                    style={[buttonClass]}
                    icon={utils.availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || "phone"}
                    onPress={() => this.toggleAudioDevice()}
                />
                }

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
			width: this.state.isLandscape ? width - bottomInset : width,
			height: this.state.isLandscape ? height - headerBarHeight - topInset: height - bottomInset - headerBarHeight - topInset,
			borderWidth: debugBorderWidth,
			borderColor: 'red'
		};
		
		if (this.state.fullScreen) {
			remoteVideoContainer.height = height;
			remoteVideoContainer.top = 0;
			remoteVideoContainer.width = width;
		}
		
		if (Platform.OS === 'android') {
		      if (this.state.isLandscape) {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, left: 0 },
					  topRight: { top: this.state.fullScreen ? 0 : headerBarHeight + topInset, right: this.state.fullScreen ? 0: rightInset },
					  bottomRight: { bottom: this.state.fullScreen ? -rightInset - headerBarHeight: -rightInset, right: this.state.fullScreen ? 0: rightInset },
					  bottomLeft: { bottom: this.state.fullScreen ? -rightInset - headerBarHeight: -rightInset, left: 0},
					  id: 'android-landscape'
				  };

				  remoteVideoContainer.width = remoteVideoContainer.width - rightInset;

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
		      if (this.state.isLandscape) {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? 0 : headerBarHeight,  left: this.state.fullScreen ? -rightInset -topInset : 0 },
					  topRight: { top: this.state.fullScreen ? 0 : headerBarHeight, right: -rightInset},
					  bottomRight: { bottom: -bottomInset,                          right: -rightInset },
					  bottomLeft: { bottom: -bottomInset,                           left: this.state.fullScreen ? -rightInset -topInset : 0 },
					  id: 'ios-landscape'
				  };

				remoteVideoContainer = {
					position: 'absolute',
					left: this.state.fullScreen ? - rightInset : 0,
					top: this.state.fullScreen ? 0 : headerBarHeight,
					width: this.state.fullScreen ? width: width -rightInset -topInset,
					height: this.state.fullScreen ? height : height - topInset ,
					borderWidth: debugBorderWidth,
					borderColor: 'red'
				};

			  } else {
				  corners = {
					  topLeft: { top: this.state.fullScreen ? -topInset : topInset, left: 0 },
					  topRight: { top: this.state.fullScreen ? -topInset : topInset, right: 0},
					  bottomRight: { bottom:  this.state.fullScreen ? -bottomInset: 120, right: 0 },
					  bottomLeft: { bottom: this.state.fullScreen ? -bottomInset: 120, left: 0},
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
                    isLandscape = {this.state.isLandscape}         
                    toggleMyVideo= {this.toggleMyVideo}    
                    swapVideo= {this.swapVideo}    
                    enableMyVideo={this.state.enableMyVideo}    
                    hangupCall={this.hangupCall}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
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
    isLandscape             : PropTypes.bool,
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
    videoMuted              : PropTypes.bool,
	useInCallManger         : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
	insets                  : PropTypes.object
};

export default VideoBox;
