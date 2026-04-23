import React, { Component } from 'react';
import { View, Platform, TouchableWithoutFeedback, TouchableHighlight, Dimensions } from 'react-native';
import { IconButton, Dialog, Text, ActivityIndicator, Menu } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import utils from '../utils';
import LoadingScreen from './LoadingScreen';

import TrafficStats from './BarChart';

import styles from '../assets/styles/AudioCall';

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

const MAX_POINTS = 30;

// Audio device picker variant. Change this value to switch styles:
//   'cycle'    - tap the button to cycle through available devices (legacy behaviour)
//   'menu'     - react-native-paper dropdown Menu with device icon + name per row
//   'floating' - WhatsApp-style: extra IconButtons float above the main button
const AUDIO_DEVICE_PICKER_MODE = 'floating';

class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            remoteUri                   : this.props.remoteUri,
            remoteDisplayName           : this.props.remoteDisplayName,
            photo                       : this.props.photo,
            active                      : false,
            audioMuted                  : this.props.muted,
            showDtmfModal               : false,
            showEscalateConferenceModal : false,
            call                        : this.props.call,
            reconnectingCall            : this.props.reconnectingCall,
            info                        : this.props.info,
            selectedContacts            : this.props.selectedContacts,
            declineReason               : this.props.declineReason,
            callContact                 : this.props.callContact,
            selectedContact             : this.props.selectedContact,
            terminatedReason            : this.props.terminatedReason,
            speakerPhoneEnabled         : this.props.speakerPhoneEnabled,
            audioGraphData              : [],
            userStartedCall             : this.props.userStartedCall,
			availableAudioDevices       : this.props.availableAudioDevices,
			selectedAudioDevice         : this.props.selectedAudioDevice,
			insets                      : this.props.insets,
			isLandscape                 : this.props.isLandscape,
			audioDevicePickerVisible    : false
        };

        this.remoteAudio = React.createRef();
        this.userHangup = false;
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        if (this.state.call != null) {
            switch (this.state.call.state) {
                case 'established':
                    this.attachStream(this.state.call);
                    break;
                case 'incoming':
                    this.props.mediaPlaying();
                    // fall through
                default:
                    this.state.call.on('stateChanged', this.callStateChanged);
                    break;
            }
            this.props.call.statistics.on('stats', this.statistics);
        }

        if (this.state.selectedContacts && this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }
    }

    componentWillUnmount() {
        console.log('AudioCallBox will unmount');
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.state.call != null && this.state.call.statistics != null) {
            this.state.call.statistics.removeListener('stats', this.statistics);
        }

        if (this.callTimer) {
            clearTimeout(this.callTimer);
        }
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevProps.call == null && this.props.call) {
            this.props.call.statistics.on('stats', this.statistics);
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Safe listener handling
        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            // Remove previous listener safely
            if (this.state.call != null && this.state.call.removeListener) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            // Attach new listener if available
            if (nextProps.call && nextProps.call.on) {
                nextProps.call.on('stateChanged', this.callStateChanged);
            }

            if (nextProps.call && nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            }

            this.setState({ call: nextProps.call });
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }
        
        if ('userStartedCall' in nextProps) {
			this.setState({userStartedCall: nextProps.userStartedCall});
		}

        this.setState({
            audioMuted: nextProps.muted,
            info: nextProps.info,
            packetLossQueue: nextProps.packetLossQueue,
            audioBandwidthQueue: nextProps.audioBandwidthQueue,
            latencyQueue: nextProps.latencyQueue,
            remoteUri: nextProps.remoteUri,
            remoteDisplayName: nextProps.remoteDisplayName,
            photo: nextProps.photo ? nextProps.photo : this.state.photo,
            declineReason: nextProps.declineReason,
            callContact: nextProps.callContact,
            audioCodec: nextProps.audioCodec,
            selectedContacts: nextProps.selectedContacts,
            selectedContact: nextProps.selectedContact,
            terminatedReason: nextProps.terminatedReason,
            speakerPhoneEnabled: nextProps.speakerPhoneEnabled,
            localMedia: nextProps.localMedia,
		    availableAudioDevices: nextProps.availableAudioDevices,
			selectedAudioDevice: nextProps.selectedAudioDevice,
			insets: nextProps.insets,
			isLandscape: nextProps.isLandscape
        });
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established') {
            this.attachStream(this.state.call);
            this.setState({reconnectingCall: false});
        }
    }

    attachStream(call) {
        this.setState({stream: call.getRemoteStreams()[0]}); //we dont use it anywhere though as audio gets automatically piped
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    hangupCall() {
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall() {
        this.props.hangupCall('user_cancel_call');
    }

    muteAudio() {
        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
    }

    statistics(stats) {
        const { audio } = stats.data;
        const { remote: { audio: remoteAudio } } = stats.data;

        const inboundAudio = audio?.inbound?.[0];
        const outboundAudio = audio?.outbound?.[0];
        const remoteInbound = remoteAudio?.inbound?.[0];

        if (!remoteInbound || !inboundAudio || !outboundAudio) return;
        
        const addData = {
            timestamp: audio.timestamp,
            incomingBitrate: inboundAudio.bitrate || 0,
            outgoingBitrate: outboundAudio.bitrate || 0,
            latency: (remoteInbound.roundTripTime || 0) / 2 * 1000,
            jitter: inboundAudio.jitter || 0,
            packetsLostOutbound: remoteInbound.packetLossRate || 0,
            packetsLostInbound: inboundAudio.packetLossRate || 0,
            packetRateOutbound: outboundAudio.packetRate || 0,
            packetRateInbound: inboundAudio.packetRate || 0,
            audioCodec: (remoteInbound.mimeType?.split?.('/')?.[1]) || ''
        };

        this.setState(state => ({
            audioGraphData: [...state.audioGraphData, addData].slice(-MAX_POINTS)
        }));
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

	renderAudioDevicePicker(buttonSize, buttonStyle, remountKey, slotStyle) {
		const devices = this.props.availableAudioDevices || [];
		const selectedIcon = utils.availableAudioDevicesIconsMap[this.state.selectedAudioDevice] || 'phone';
		const _rk = remountKey || '';
		const _slot = slotStyle || styles.buttonContainer;

		// If there's only a single audio device (or none), there's nothing
		// for the user to switch to — hide the picker entirely.
		if (devices.length <= 1) {
			return null;
		}

		// Variant 1: cycle through devices on tap
		if (AUDIO_DEVICE_PICKER_MODE === 'cycle') {
			return (
				<View style={_slot}>
					<TouchableHighlight style={styles.roundshape}>
						<IconButton
							key={'cb-btn-audio-' + _rk}
							size={buttonSize}
							style={buttonStyle}
							icon={selectedIcon}
							onPress={() => this.toggleAudioDevice()}
						/>
					</TouchableHighlight>
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
						<View style={_slot}>
							<TouchableHighlight style={styles.roundshape}>
								<IconButton
									key={'cb-btn-audio-' + _rk}
									size={buttonSize}
									style={buttonStyle}
									icon={selectedIcon}
									onPress={() => this.setState({audioDevicePickerVisible: true})}
								/>
							</TouchableHighlight>
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
				<View style={[_slot, {position: 'relative'}]}>
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
								<TouchableHighlight key={device} style={[styles.roundshape, {marginBottom: 21}]}>
									<IconButton
										key={'cb-btn-audio-other-' + device + '-' + _rk}
										size={buttonSize}
										style={buttonStyle}
										icon={utils.availableAudioDevicesIconsMap[device] || 'phone'}
										onPress={() => {
											this.props.selectAudioDevice(device);
											this.setState({audioDevicePickerVisible: false});
										}}
									/>
								</TouchableHighlight>
							))}
						</View>
					)}
					<TouchableHighlight style={styles.roundshape}>
						<IconButton
							key={'cb-btn-audio-' + _rk}
							size={buttonSize}
							style={buttonStyle}
							icon={selectedIcon}
							onPress={() => this.setState({audioDevicePickerVisible: !this.state.audioDevicePickerVisible})}
						/>
					</TouchableHighlight>
				</View>
			);
		}

		return null;
	}

    showDtmfModal() {
        this.setState({showDtmfModal: true});
    }

    hideDtmfModal() {
        this.setState({showDtmfModal: false});
    }

    toggleEscalateConferenceModal() {
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }
        this.setState({
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    handleDoubleTap() {
        const now = Date.now();
        const DOUBLE_PRESS_DELAY = 300;
        if (this.lastTap && now - this.lastTap < DOUBLE_PRESS_DELAY) {
          this.props.showLogs();
        } else {
          this.lastTap = now;
        }
    }

	renderAudioDeviceButtons() {
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  //console.log('renderAudioDeviceButtons', selectedAudioDevice);
	  
	  if (!call) {
		 return null;
	  }
	
	  if (call.state !== 'established' && call.state !== 'accepted' ) {
	     console.log('Call state is not established or accepted:', call.state);
		 return null;
 	  }
	 
	  if (this.props.useInCallManger) {
	     console.log('useInCallManger');
		 return null;
	  }

      if (!availableAudioDevices) return null;
	  
	  return (
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
	  );
	}

    render() {

        let buttonContainerClass;
        let userIconContainerClass;

        const remoteIdentity = {
            uri: this.state.remoteUri || '',
            name: this.state.remoteDisplayName || '',
            photo: this.state.photo
        };

        const username = this.state.remoteUri.split('@')[0];
        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

        let displayName = this.state.remoteUri ? toTitleCase(this.state.remoteUri.split('@')[0]) : '';

        if (this.state.remoteDisplayName && this.state.remoteUri !== this.state.remoteDisplayName) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.isTablet) {
            buttonContainerClass = this.state.isLandscape ? styles.tabletLandscapeButtonContainer : styles.tabletPortraitButtonContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonContainerClass = this.state.isLandscape ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
            userIconContainerClass = styles.userIconContainer;
        }

        // Folded (cover display) overrides — very limited vertical room.
        if (this.props.isFolded) {
            buttonContainerClass = styles.foldedButtonContainer;
        }

        const buttonSize = this.props.isTablet ? 40 : (this.props.isFolded ? 32 : 34);

        // Per-button slot + hangup spacer differ between folded and
        // unfolded so buttons pack tighter on the narrow cover display.
        const slotContainerStyle = this.props.isFolded ? styles.foldedSlotContainer : styles.buttonContainer;
        const hangupMarginLeft = this.props.isFolded ? 24 : 30;

        let disableChat = false;
        if (this.state.callContact) {
            if (isPhoneNumber) disableChat = true;
            if (this.state.callContact.tags.indexOf('conference') > -1) disableChat = true;
        }

        let whiteButtonClass         = Platform.OS === 'ios' ? styles.whiteButtoniOS         : styles.whiteButton;
        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS         : styles.greenButton;
        let hangupButtonClass        = Platform.OS === 'ios' ? styles.hangupButtoniOS        : styles.hangupButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS : styles.disabledGreenButton;
        
        let userIconSize;
        if (this.props.isFolded) {
            userIconSize = 90;
        } else {
            userIconSize = this.state.isLandscape ? 75 : 150;
        }

        // Force-remount key for the audio call UI. Same stale-native-frame
        // problem we hit on NavigationBar / ReadyBox: IconButtons and Text
        // cache their measured frames at the density they were first
        // mounted under, so we remount them when fold state or window
        // dimensions change.
        const { width: _cbW, height: _cbH } = Dimensions.get('window');
        const _callRemountKey = (this.props.isFolded ? 'f' : 'u')
            + '-' + (this.state.isLandscape ? 'l' : 'p')
            + '-' + Math.round(_cbW) + 'x' + Math.round(_cbH);

        let extraStyles = {};
        let extraButtonContainerClass = {};       
        let container = styles.container;
        
        return (
            <View style={[styles.container, {borderColor: 'blue', borderWidth: 0}, extraStyles]}>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteUri={this.state.remoteUri}
                    remoteDisplayName={this.state.remoteDisplayName}
                    call={this.state.call}
                    reconnectingCall={this.state.reconnectingCall}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                    media='audio'
                    localMedia={this.state.localMedia}
                    declineReason={this.state.declineReason}
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                    terminatedReason={this.state.terminatedReason}
                    isLandscape={this.state.isLandscape}
                    isFolded={this.props.isFolded}
					hangupCall = {this.hangupCall}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
                />

				{this.props.isFolded ? (
					<View key={'cb-toprow-' + _callRemountKey} style={styles.foldedTopRow}>
						<View style={styles.foldedCallerColumn}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
							<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.foldedDisplayName} numberOfLines={1}>{displayName}</Dialog.Title>
							<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
								<Text key={'cb-uri-' + _callRemountKey} style={styles.foldedUri} numberOfLines={1}>{this.state.remoteUri}</Text>
							</TouchableWithoutFeedback>
						</View>
						<View style={styles.foldedStatsColumn}>
							<TrafficStats
								key={'cb-stats-' + _callRemountKey}
								isTablet={this.props.isTablet}
								isLandscape={this.state.isLandscape}
								isFolded={this.props.isFolded}
								data={this.state.audioGraphData}
								media="audio"
							/>
						</View>
					</View>
				) : (
					<>
						<View key={'cb-usericon-wrap-' + _callRemountKey} style={userIconContainerClass}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
						</View>

						<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.displayName}>{displayName}</Dialog.Title>
						<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
							<Text key={'cb-uri-' + _callRemountKey} style={styles.uri}>{this.state.remoteUri}</Text>
						</TouchableWithoutFeedback>

						{false && (
						  <View style={styles.confirmContainer}>
								<Text style={styles.confirm}>Please confirm...</Text>
								<View style={[buttonContainerClass, extraButtonContainerClass]}>
								<View style={styles.buttonContainer}>
								  <TouchableHighlight style={styles.roundshape}>
									<IconButton
										size={buttonSize}
										style={greenButtonClass}
										icon="phone"
										onPress={this.props.confirmStartCall}
									/>
								</TouchableHighlight>
							  </View>
								<View style={styles.buttonContainer}>
								  <TouchableHighlight style={styles.roundshape}>
									<IconButton
										size={buttonSize}
										style={hangupButtonClass}
										icon="phone-hangup"
										onPress={this.cancelCall}
									/>
								</TouchableHighlight>
							  </View>
							  </View>
							  </View>
							  )}

						<TrafficStats
							key={'cb-stats-' + _callRemountKey}
							isTablet={this.props.isTablet}
							isLandscape={this.state.isLandscape}
							data={this.state.audioGraphData}
							media="audio"
						/>
					</>
				)}

                {!this.state.isLandscape && this.state.reconnectingCall ?
                    <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={'#D32F2F'} />
                    : null
                }

                {this.state.call && ((this.state.call.state === 'accepted' || this.state.call.state === 'established' || this.state.call.state === 'early-media') && !this.state.reconnectingCall) ?
                        <>
                        <View key={'cb-btnbar-' + _callRemountKey} style={[buttonContainerClass, extraButtonContainerClass]}>
                            {!disableChat ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-chat-' + _callRemountKey}
                                            size={buttonSize}
                                            style={disableChat ? disabledGreenButtonClass : greenButtonClass}
                                            icon="chat"
                                            onPress={this.props.goBackFunc}
                                            disabled={disableChat} />
                                    </TouchableHighlight>
                                </View>
                                : null}

                            {!disableChat ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-invite-' + _callRemountKey}
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="account-plus"
                                            onPress={this.props.inviteToConferenceFunc}
                                            disabled={disableChat} />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={slotContainerStyle}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        key={'cb-btn-mute-' + _callRemountKey}
                                        size={buttonSize}
                                        style={whiteButtonClass}
                                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                                        onPress={this.muteAudio} />
                                </TouchableHighlight>
                            </View>

                            {this.renderAudioDevicePicker(buttonSize, whiteButtonClass, _callRemountKey, slotContainerStyle)}

                            {isPhoneNumber ?
                                <View style={slotContainerStyle}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            key={'cb-btn-dtmf-' + _callRemountKey}
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="dialpad"
                                            onPress={this.showDtmfModal}
                                            disabled={!(this.state.call && (this.state.call.state === 'early-media' || this.state.call.state === 'accepted' || this.state.call.state === 'established'))} />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={[slotContainerStyle, {marginLeft: hangupMarginLeft}]}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        key={'cb-btn-hangup-' + _callRemountKey}
                                        size={buttonSize}
                                        style={hangupButtonClass}
                                        icon="phone-hangup"
                                        onPress={this.hangupCall} />
                                </TouchableHighlight>
                            </View>
                        </View></>
                    :

                    <View key={'cb-btnbar-' + _callRemountKey} style={[buttonContainerClass, extraButtonContainerClass]}>
                      <View style={slotContainerStyle}>
                          <TouchableHighlight style={styles.roundshape}>
                            <IconButton
                                key={'cb-btn-cancel-' + _callRemountKey}
                                size={buttonSize}
                                style={hangupButtonClass}
                                icon="phone-hangup"
                                onPress={this.cancelCall}
                            />
                        </TouchableHighlight>
                      </View>
                    </View>
                }

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

AudioCallBox.propTypes = {
    remoteUri: PropTypes.string,
    remoteDisplayName: PropTypes.string,
    photo: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    accountId: PropTypes.string,
    escalateToConference: PropTypes.func,
    info: PropTypes.string,
    hangupCall: PropTypes.func,
    mediaPlaying: PropTypes.func,
    localMedia: PropTypes.object,
    callKeepSendDtmf: PropTypes.func,
    toggleMute: PropTypes.func,
    toggleSpeakerPhone: PropTypes.func,
    speakerPhoneEnabled: PropTypes.bool,
    isLandscape: PropTypes.bool,
    isTablet: PropTypes.bool,
    isFolded: PropTypes.bool,
    reconnectingCall: PropTypes.bool,
    muted: PropTypes.bool,
    showLogs: PropTypes.func,
    goBackFunc: PropTypes.func,
    callState: PropTypes.object,
    messages: PropTypes.object,
    sendMessage: PropTypes.func,
    reSendMessage: PropTypes.func,
    confirmRead: PropTypes.func,
    deleteMessage: PropTypes.func,
    expireMessage: PropTypes.func,
    getMessages: PropTypes.func,
    pinMessage: PropTypes.func,
    unpinMessage: PropTypes.func,
    callContact: PropTypes.object,
    selectedContact: PropTypes.object,
    selectedContacts: PropTypes.array,
    inviteToConferenceFunc: PropTypes.func,
    finishInvite: PropTypes.func,
    terminatedReason: PropTypes.string,
	confirmStartCall: PropTypes.func,
	userStartedCall: PropTypes.bool,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice: PropTypes.func,
    useInCallManger: PropTypes.bool,
	insets: PropTypes.object
};

export default AudioCallBox;
