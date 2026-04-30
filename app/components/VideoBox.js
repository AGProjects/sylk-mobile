import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import dtmf from 'react-native-dtmf';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton, ActivityIndicator, Colors, Menu } from 'react-native-paper';
import { View, Text, Dimensions, TouchableWithoutFeedback, TouchableOpacity, Platform, TouchableHighlight  } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {StatusBar} from 'react-native';
import Immersive from 'react-native-immersive';
import { StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import CallOverlay from './CallOverlay';

import EscalateConferenceModal from './EscalateConferenceModal';

//import TrafficStats from './BarChart';
import utils from '../utils';

import styles from '../assets/styles/VideoCall';

const DEBUG = debug('blinkrtc:Video');
//debug.enable('*');


const MAX_POINTS = 30;

// Audio device picker variant. Change this value to switch styles:
//   'cycle'    - tap the button to cycle through available devices (legacy behaviour)
//   'menu'     - react-native-paper dropdown Menu with device icon + name per row
//   'floating' - WhatsApp-style: extra IconButtons float above the main button
const AUDIO_DEVICE_PICKER_MODE = 'floating';

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
			isLandscape: this.props.isLandscape,
			aspectRatio: 'cover',
			audioDevicePickerVisible: false,
			cameraFacing: 'front',
			videoPickerVisible: false
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
			const track = localStream.getVideoTracks()[0];
			if (this.props.videoMuted) {
				track.enabled = false;
				console.log('Initial video is muted');
			}
			// Derive initial camera facing from the actual track
			// settings so the bar/label/swap logic doesn't start out of
			// phase with the device's real camera. RNWebRTC reports
			// facingMode as 'user' (front) or 'environment' (back) when
			// available; if the runtime doesn't expose it, we fall
			// back to the assumed 'front' default.
			let initialFacing = 'front';
			try {
				const settings = track.getSettings ? track.getSettings() : null;
				if (settings && settings.facingMode === 'environment') {
					initialFacing = 'back';
				}
			} catch (e) {
				// getSettings not supported — keep the 'front' default.
			}
			this.state.cameraFacing = initialFacing;
			// If the user muted video back in the LocalMedia preview,
			// the same underlying track is already disabled. Reflect
			// that in our state so the UI doesn't show the camera as
			// "live" when it isn't.
			if (track.enabled === false) {
				this.state.videoMuted = true;
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

        if ('aspectRatio' in nextProps) {
			this.setState({aspectRatio: nextProps.aspectRatio});
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

	componentDidUpdate(prevProps, prevState) {
	     if (this.state.aspectRatio != prevState.aspectRatio) {
			 console.log(' --- aspectRatio did change', this.state.aspectRatio);
	     }
	}

    callStateChanged(oldState, newState, data) {
        this.forceUpdate();
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

	toggleAspectRatio() {
	    console.log('toggleAspectRatio');
	    this.setState({aspectRatio: this.state.aspectRatio == 'cover' ? 'contain' : 'cover'});
	}
    
	toggleFullScreen() {
		//console.log(' --toggleFullScreen');

		if (this.state.callOverlayVisible) {			
			this.setState({callOverlayVisible: false, fullScreen: true});
			StatusBar.setHidden(true, 'fade');
			if (Platform.OS === 'android') {
				Immersive.on();
				this.props.enableFullScreen();
			}
		} else {
			this.setState({callOverlayVisible: true, fullScreen: false});
			StatusBar.setHidden(false, 'fade');
			if (Platform.OS === 'android') {
				Immersive.off();
				this.props.disableFullScreen();
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
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        this.toggleVideoMute();
    }

    toggleVideoMute() {
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if (this.state.videoMuted) {
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

	renderAudioDevicePicker(buttonSize, buttonClass) {
		const devices = this.props.availableAudioDevices || [];
		const selectedIcon = utils.availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || 'phone';

		// Only one device available — there is nothing to switch to, so
		// don't show the audio-device button at all.
		if (devices.length <= 1) return null;

		// Variant 1: cycle through devices on tap
		if (AUDIO_DEVICE_PICKER_MODE === 'cycle') {
			return (
				<View style={styles.buttonContainer}>
					<IconButton
						size={buttonSize}
						style={[buttonClass]}
						icon={selectedIcon}
						onPress={() => this.toggleAudioDevice()}
					/>
				</View>
			);
		}

		// Variant 2: react-native-paper Menu (icon + device name per row)
		if (AUDIO_DEVICE_PICKER_MODE === 'menu') {
			return (
				<Menu
					visible={this.state.audioDevicePickerVisible}
					onDismiss={() => this.setState({audioDevicePickerVisible: false})}
					anchor={
						<View style={styles.buttonContainer}>
							<IconButton
								size={buttonSize}
								style={[buttonClass]}
								icon={selectedIcon}
								onPress={() => this.setState({audioDevicePickerVisible: true})}
							/>
						</View>
					}
				>
					{devices.map(device => {
						const isSelected = device === this.props.selectedAudioDevice;
						const deviceIcon = utils.availableAudioDevicesIconsMap[device] || 'phone';
						const deviceName = utils.availableAudioDeviceNames[device] || device;
						return (
							<Menu.Item
								key={device}
								icon={deviceIcon}
								title={isSelected ? `✓ ${deviceName}` : deviceName}
								onPress={() => {
									this.setState({audioDevicePickerVisible: false});
									setTimeout(() => this.props.selectAudioDevice(device), 50);
								}}
							/>
						);
					})}
				</Menu>
			);
		}

		// Variant 3: WhatsApp-style floating icon buttons stacked above the main button
		if (AUDIO_DEVICE_PICKER_MODE === 'floating') {
			const otherDevices = devices.filter(d => d !== this.props.selectedAudioDevice);
			return (
				<View style={styles.buttonContainer}>
					{this.state.audioDevicePickerVisible && otherDevices.length > 0 && (
						<View style={{
							position: 'absolute',
							bottom: '100%',
							left: 0,
							right: 0,
							alignItems: 'center',
							marginBottom: 4,
							zIndex: 100,
							elevation: 10,
						}}>
							{otherDevices.map(device => (
								<IconButton
									key={device}
									size={buttonSize}
									style={[buttonClass, {marginBottom: 6}]}
									icon={utils.availableAudioDevicesIconsMap[device] || 'phone'}
									onPress={() => {
										this.props.selectAudioDevice(device);
										this.setState({audioDevicePickerVisible: false});
									}}
								/>
							))}
						</View>
					)}
					<IconButton
						size={buttonSize}
						style={[buttonClass]}
						icon={selectedIcon}
						onPress={() => this.setState({
							audioDevicePickerVisible: !this.state.audioDevicePickerVisible,
							// Collapse the video picker when opening (or
							// toggling) the audio picker — only one
							// floating menu should be visible at a time.
							videoPickerVisible: false
						})}
					/>
				</View>
			);
		}

		return null;
	}

    toggleCamera(event) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: this.state.cameraFacing === 'front' ? 'back' : 'front'
            });
        }
    }

    selectCamera(facing) {
        // If video is currently muted, picking a camera should also
        // unmute it — that's the only way out of the muted state from
        // the picker (the Unmute row is hidden when muted).
        if (this.state.videoMuted) {
            this.toggleVideoMute();
        }
        // No-op (apart from the unmute above) if we're already on the
        // requested camera.
        if (facing === this.state.cameraFacing) return;
        const localStream = this.state.localStream;
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: facing
            });
        }
    }

    renderVideoPicker(buttonSize, buttonClass) {
        const facing = this.state.cameraFacing || 'front';
        const muted = this.state.videoMuted;
        const enableMyVideo = this.state.enableMyVideo;
        // Main button reflects the currently active camera. Muted state is
        // shown as a big red X overlay on top of the camera icon so the user
        // knows both *which* camera is active *and* that it's muted.
        const mainIcon = facing === 'front' ? 'camera-front' : 'camera-rear';

        // Pick the swap icon so its diagonal points through the corner
        // where the PIP thumbnail currently sits. Thumb in topLeft or
        // bottomRight → use the "\" diagonal; thumb in topRight or
        // bottomLeft → use the "/" diagonal. That way the arrow's top
        // tip points to the thumb when it's at the top, and its bottom
        // tip points to the thumb when it's at the bottom.
        const corner = this.state.myVideoCorner;
        const swapIcon = (corner === 'topLeft' || corner === 'bottomRight')
            ? 'arrow-top-left-bottom-right-bold'
            : 'arrow-top-right-bottom-left-bold';

        // Build the camera options. When the camera is currently in
        // use (not muted), drop the active one so the user only sees
        // the camera they can switch *to*. When muted, show BOTH so
        // the user can pick which camera to unmute into — tapping
        // either unmutes (and switches if needed) via selectCamera.
        const cameraOptions = [
            {
                key: 'front',
                icon: 'camera-front',
                label: 'Front Camera',
                facing: 'front'
            },
            {
                key: 'back',
                icon: 'camera-rear',
                label: 'Back Camera',
                facing: 'back'
            }
        ]
            .filter(opt => muted || opt.facing !== facing)
            .map(opt => ({
                key: opt.key,
                icon: opt.icon,
                label: opt.label,
                onPress: () => this.selectCamera(opt.facing)
            }));

        // The picker rows are *actions*, not radio choices — there is
        // no persistent "selected" highlight. The icon/label of each
        // row already reflects the next state (e.g. "Hide Myself" vs
        // "Show Myself", "Mute Camera" hidden when muted), which is
        // enough to communicate current state.
        const items = [
            ...cameraOptions,
            // Hide the Unmute row entirely when muted — the only way to
            // unmute from the picker is to choose one of the camera
            // options above.
            ...(muted ? [] : [{
                key: 'mute',
                icon: 'video-off',
                label: 'Mute Camera',
                onPress: () => this.toggleVideoMute()
            }]),
            {
                key: 'myself',
                icon: enableMyVideo ? 'eye-off' : 'eye',
                label: enableMyVideo ? 'Hide Myself' : 'Show Myself',
                onPress: () => this.toggleMyVideo()
            },
            {
                key: 'swap',
                // Diagonal two-headed arrow — chosen so its diagonal
                // passes through the corner where the PIP thumbnail
                // currently sits (see swapIcon computation above).
                icon: swapIcon,
                label: 'Swap Video',
                onPress: () => this.swapVideo()
            },
            {
                key: 'aspect',
                icon: 'aspect-ratio',
                label: 'Aspect Ratio',
                onPress: () => this.toggleAspectRatio()
            }
        ];

        // Size the floating-panel icons up to roughly the *visual* size
        // of the bar button (the circular IconButton, which is bigger
        // than its glyph). Bumps both the icon glyph and the row height
        // so the menu reads as comfortably touch-sized.
        const rowIconSize = buttonSize + 14;
        const rowFontSize = 18;
        const itemRowHeight = rowIconSize + 18;
        // The trigger IconButton has margin: 10 (from styles.iosButton /
        // androidButton). To keep the icon column vertically aligned
        // with the bar button, shift the row left so its icon center
        // sits directly above the bar-button center, regardless of the
        // larger row icon size.
        const iconColumnPadLeft = Math.max(10 - (rowIconSize - buttonSize) / 2, 0);
        // Estimate the panel width: longest label is "Front Camera" /
        // "Aspect Ratio" (~12 characters). At rowFontSize the text needs
        // roughly 0.6 * fontSize per character. Plus the icon column,
        // gap and right padding. The slot containing the panel has
        // maxWidth: 54 which would otherwise force the labels to wrap,
        // so we set an explicit width that's wide enough for the longest
        // label plus a small margin.
        const longestLabelChars = 13;
        const panelWidth = iconColumnPadLeft
            + rowIconSize
            + 14   // marginLeft on the text
            + Math.ceil(longestLabelChars * rowFontSize * 0.6)
            + 12;  // paddingRight on the row
        return (
            <View style={[styles.buttonContainer, {position: 'relative'}]}>
                {this.state.videoPickerVisible && (
                    <View style={{
                        position: 'absolute',
                        bottom: '100%',
                        // Anchor the left edge of the panel to the left
                        // edge of the trigger button so the icon column
                        // sits directly above the button below and the
                        // text labels extend to the right of the icons.
                        left: 0,
                        // Explicit width that fits the longest label on
                        // a single line. We can't rely on shrink-to-fit
                        // because the slot wrapping the panel has
                        // maxWidth: 54 which would otherwise force the
                        // label to wrap.
                        width: panelWidth,
                        marginBottom: 8,
                        zIndex: 100,
                        elevation: 10,
                        backgroundColor: 'rgba(34,34,34,0.92)',
                        borderRadius: 8,
                        paddingVertical: 4
                    }}>
                        {items.map(item => (
                            <TouchableOpacity
                                key={item.key}
                                onPress={() => {
                                    this.setState({videoPickerVisible: false});
                                    // Defer the action a tick so the panel
                                    // closes cleanly before any state churn
                                    // from the action itself.
                                    setTimeout(() => item.onPress(), 50);
                                }}
                                // Standard row: icon on the left (above
                                // the trigger button), text label to its
                                // right. Every row is an *action* (not a
                                // radio choice), so we never highlight
                                // a row as "selected".
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    height: itemRowHeight,
                                    paddingLeft: iconColumnPadLeft,
                                    paddingRight: 12,
                                    backgroundColor: 'transparent'
                                }}
                            >
                                <Icon name={item.icon} size={rowIconSize} color="white" />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        color: 'white',
                                        marginLeft: 14,
                                        fontSize: rowFontSize
                                    }}
                                >
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
                <View style={{position: 'relative'}}>
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass]}
                        icon={mainIcon}
                        onPress={() => this.setState({
                            videoPickerVisible: !this.state.videoPickerVisible,
                            // Collapse the audio device picker when opening
                            // (or toggling) the video picker — only one
                            // floating menu should be visible at a time.
                            audioDevicePickerVisible: false
                        })}
                    />
                    {muted && (
                        <View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}
                        >
                            <Icon
                                name="close-thick"
                                size={buttonSize + 14}
                                color="#D32F2F"
                            />
                        </View>
                    )}
                </View>
            </View>
        );
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
            this.toggleFullScreen();
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
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        const buttonSize = this.props.isTablet ? 40 : 28;

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

        const myVideoCorner = this.state.myVideoCorner;

        let container = styles.container;
        let remoteVideoContainer = styles.remoteVideoContainer;
        let buttonsContainer = styles.buttonsContainer;
        let video = styles.video;

        if (this.state.callOverlayVisible) {
            let content = (<View style={buttonsContainerClass}>
                {!disablePlus ?
                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        onPress={this.props.inviteToConferenceFunc}
                        icon="account-plus"
                    />
                </View>
                : null}

                <View style={styles.buttonContainer}>
                    <IconButton
                        size={buttonSize}
                        style={buttonClass}
                        onPress={this.muteAudio}
                        icon={muteButtonIcons}
                    />
                </View>

                {/* Single video picker button: tapping it shows a floating
                    panel with Front/Back Camera, Mute, Hide Myself, Swap
                    Video and Aspect Ratio. The bar icon itself reflects
                    the active camera (front/back) and overlays a red X
                    when the camera is muted. */}
                {this.renderVideoPicker(buttonSize, buttonClass)}

                {this.renderAudioDevicePicker(buttonSize, buttonClass)}

                <View style={[styles.buttonContainer, {marginLeft: 30}]}>
                    <IconButton
                        size={buttonSize}
                        style={[buttonClass, styles.hangupButton]}
                        onPress={this.hangupCall}
                        icon="phone-hangup"
                    />
                </View>
            </View>);
            // The local PIP thumbnail wrapper uses zIndex: 1000, so the
            // buttons View (which hosts the floating video/audio picker
            // panels) must sit above it for the panels to render on top
            // of the thumbnail when they overlap.
            buttons = (
                <View style={[buttonsContainer, {zIndex: 2000, elevation: 30}]}>
                    {content}
                </View>
            );
        }
        
        const debugBorderWidth = 0;
        const headerBarHeight = 60;

		let { width, height } = Dimensions.get('window');
        
		const topInset = this.state.insets?.top || 0;
		const bottomInset = this.state.insets?.bottom || 0;
		const leftInset = this.state.insets?.left || 0;
		const rightInset = this.state.insets?.right || 0;

	    const cornerOrder = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
       
        // On the cover display there isn't room for a 100px gap above
        // the bottom buttons, so cut it down substantially when folded.
        let bottomExtraInset = this.state.isLandscape ? 0 : (this.props.isFolded ? 40 : 100);
        let extraRightInset = 0;
         
		let corners = {
			topLeft: { top: this.state.fullScreen ? -topInset : headerBarHeight, left: 0},
			topRight: { top: this.state.fullScreen ? -topInset : headerBarHeight, right: extraRightInset},
			bottomRight: { bottom: this.state.fullScreen ? 0 : bottomInset + bottomExtraInset, right: extraRightInset},
			bottomLeft: { bottom: this.state.fullScreen ? 0: bottomInset + bottomExtraInset, left: 0},
		    id: 'init'
		};
				
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
			top: this.state.fullScreen ? 0: headerBarHeight,
			bottom: this.state.fullScreen ? -bottomInset : 0,
			borderWidth: debugBorderWidth,
			borderColor: 'red',
			width: '100%',
			height: '100%',
//			width: this.state.fullScreen ? width + rightInset : width,
//			height: this.state.fullScreen ? height : height - headerBarHeight - bottomInset - topInset
		};

		if (this.state.isLandscape) {
			remoteVideoContainer.width = this.state.fullScreen ? width : width - rightInset - leftInset;
		}

		if (Platform.OS === 'ios') {
		    if (this.state.isLandscape) {
				if (this.state.fullScreen) {
					corners = {
						topLeft: { top: 0, left: -leftInset},
						topRight: { top: 0, right: -rightInset},
						bottomRight: { bottom: -bottomInset, right: -rightInset},
						bottomLeft: { bottom: -bottomInset, left: -leftInset},
						id: 'ios'
					};
					remoteVideoContainer.marginLeft = -leftInset;
					remoteVideoContainer.height = height;
				} else {
					// Non-fullscreen landscape: stretch the video
					// edge-to-edge just like fullscreen does, but keep
					// the header bar visible at the top. Pull left by
					// -leftInset to reach device x=0 and let width
					// carry it all the way to the right device edge.
					// PIP thumbnails mirror the fullscreen layout and
					// push out to the device edges (negative insets)
					// so they sit in the notch-area corners — only
					// the top edges are bumped down under the navbar.
					corners = {
						topLeft: { top: headerBarHeight, left: -leftInset},
						topRight: { top: headerBarHeight, right: -rightInset},
						bottomRight: { bottom: -bottomInset, right: -rightInset},
						bottomLeft: { bottom: -bottomInset, left: -leftInset},
						id: 'init'
					};
					remoteVideoContainer.marginLeft = -leftInset;
					remoteVideoContainer.width = width;
				}
			} else {
				remoteVideoContainer.marginTop = -topInset;
				remoteVideoContainer.height = height;
			}
		}
		
		// Self-video thumbnail dimensions. On the Razr cover display we
		// have very little real estate, so shrink the picture-in-picture
		// to roughly half size. The outer wrapper (below) uses the same
		// numbers so the surface and its hit target stay aligned.
		const selfThumbWidth  = this.props.isFolded ? 72 : 120;
		const selfThumbHeight = this.props.isFolded ? 96 : 160;
		const selfSurfaceHeight = this.props.isFolded ? 54 : 90;

		let mySurfaceContainer = {
			flex: 1,
			width: selfThumbWidth,
			height: selfSurfaceHeight,
			elevation: 5,
			borderWidth: 0,
			zIndex: 1000,
		  };

				  
		let corner = {
		  ...corners[this.state.myVideoCorner],
		};
		
		let fullScreen = this.state.fullScreen;
		let insets = this.state.insets;
		let isLandscape = this.state.isLandscape;
  
		if (debugBorderWidth) {
			const values = {
//			  insets, 
			  container,
			  remoteVideoContainer,
//			  buttonsContainer,
//			  buttonsContainerClass,
			  myselfContainer,
//			  video,
//			  corner,
			  corners,
//			  myVideoCorner,
			  fullScreen,
			  height,
			  width,
			  rightInset,
			  topInset,
			  bottomInset,
			  isLandscape
			  
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

		// Force-remount key for fold/density transitions. IconButton and
		// RTCView/Surface cache their measured frames at the density they
		// were first mounted under; changing this key on fold/unfold and
		// on orientation/dimension changes forces React to remount them
		// so they re-measure at the new display metrics.
		const _videoRemountKey = (this.props.isFolded ? 'f' : 'u')
			+ '-' + (this.state.isLandscape ? 'l' : 'p')
			+ '-' + Math.round(width) + 'x' + Math.round(height)
			+ '-' + this.state.myVideoCorner;

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
					aspectRatio = {this.state.aspectRatio}
					toggleAspectRatio = {this.toggleAspectRatio}
                />

                {this.showRemote?
					<View style={[container, remoteVideoContainer]}>
					  <RTCView
						objectFit={this.state.aspectRatio}
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
					key={'vb-myself-wrap-' + _videoRemountKey}
					style={myselfContainer}
				  >
					<View
					  key={'vb-myself-pos-' + _videoRemountKey}
					  style={{
						position: 'absolute',
						width: selfThumbWidth,
						height: selfThumbHeight,
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
					  <Surface key={'vb-myself-surf-' + _videoRemountKey} style={mySurfaceContainer}>
						<RTCView
							key={'vb-myself-rtc-' + _videoRemountKey}
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

                {/* Fullscreen invisible backdrop that dismisses the
                    floating video picker when the user taps anywhere
                    outside the panel. Rendered before {buttons} so the
                    buttons (and the panel itself, which lives inside
                    them) remain on top and stay tappable. */}
                {this.state.videoPickerVisible && (
                    <TouchableWithoutFeedback
                        onPress={() => this.setState({videoPickerVisible: false})}
                    >
                        <View style={StyleSheet.absoluteFillObject} />
                    </TouchableWithoutFeedback>
                )}

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
    isFolded                : PropTypes.bool,
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
	insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func

};

export default VideoBox;
