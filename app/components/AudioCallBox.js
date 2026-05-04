import React, { Component } from 'react';
import { View, Platform, TouchableWithoutFeedback, TouchableHighlight, TouchableOpacity, Dimensions } from 'react-native';
import { IconButton, Dialog, Button, Portal, Text, ActivityIndicator, Menu } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import { getZrtpSession } from './CallZrtp';
import utils from '../utils';
import LoadingScreen from './LoadingScreen';

import TrafficStats from './BarChart';
import AudioSpeedometer from './AudioSpeedometer';

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
			audioDevicePickerVisible    : false,
            // ZRTP indicator state. null = not started, 'probing' = in
            // negotiation (yellow), 'key-agreed' = active (green), 'failed'
            // (silent — call stays SDES-only).
            zrtpState                   : null,
            zrtpDialogVisible           : false,
            // Shown when the call is in zRTP-mandatory mode and the
            // handshake fails (no PGP key, incompatible codec, or 10s
            // timeout). Lets the user choose whether to terminate the
            // call or continue without end-to-end encryption.
            zrtpMandatoryFailedVisible  : false,
            zrtpMandatoryFailedInfo     : null,
            // Toggle between the AudioSpeedometer (default) and the
            // legacy TrafficStats bar-chart. Tap the stats area to flip.
            showOldStats                : false
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
            // ZRTP: emitted by CallZrtp.js whenever per-call session state
            // changes (probing / key-agreed / failed).
            this.state.call.on('zrtpStateChanged', this.zrtpStateChanged);
            // Mandatory-mode handshake failure: surface the warning
            // dialog so the user can pick End call vs Continue.
            this.state.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            // Catch up if the session already finished its handshake before
            // this component mounted (e.g. after a Fast Refresh / reload).
            const existing = getZrtpSession(this.state.call);
            if (existing && existing.state) {
                this.setState({ zrtpState: existing.state });
            }
        }

        if (this.state.selectedContacts && this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }
    }

    zrtpStateChanged(newState) {
        if (this.unmounted) {
            return;
        }
        this.setState({ zrtpState: newState });
    }

    // Fired by CallZrtp.js when zRTP-mandatory mode fails to agree on
    // keys (no public PGP key for peer, codec incompatible with our
    // FrameEncryptor, or the 10s timer ran out). The user gets to
    // decide: terminate (mandatory enforcement honored) or continue
    // without E2E (downgrade to optional).
    zrtpMandatoryFailed(info) {
        if (this.unmounted) return;
        utils.timestampedLog('[ZRTP] AudioCallBox received zrtpMandatoryFailed:', info);
        this.setState({
            zrtpMandatoryFailedVisible: true,
            zrtpMandatoryFailedInfo: info,
        });
    }

    _onZrtpMandatoryEndCall() {
        this.setState({ zrtpMandatoryFailedVisible: false });
        if (this.state.call) {
            try { this.state.call.terminate(); } catch (e) {}
        }
    }

    _onZrtpMandatoryContinue() {
        this.setState({ zrtpMandatoryFailedVisible: false });
    }

    /** Determine the verification status for the badge. Anchored to the
     *  peer's PGP public key (a stable per-peer value), NOT to the per-call
     *  SAS — the SAS legitimately differs every call due to fresh ephemeral
     *  X25519 keys (forward secrecy).
     *    'unverified' — encrypted but no prior verification, or a legacy
     *                   record without a stored publicKey
     *    'verified'   — prior verification exists and the peer's PGP key
     *                   still matches
     *    'mismatch'   — prior verification exists but the peer's PGP key
     *                   has changed since (key rotation OR potential MITM)
     */
    _zrtpVerificationStatus() {
        if (this.state.zrtpState !== 'key-agreed') return null;
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) return null;
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;
        if (!stored || !stored.publicKey) return 'unverified';
        const currentKey = this.props.callContact && this.props.callContact.publicKey;
        if (currentKey && stored.publicKey === currentKey) return 'verified';
        return 'mismatch';
    }

    _onZrtpBadgePress() {
        if (this.state.zrtpState === 'key-agreed') {
            this.setState({ zrtpDialogVisible: true });
        }
    }

    _onZrtpVerifyConfirm() {
        const session = getZrtpSession(this.state.call);
        if (!session || !session.sas) {
            this.setState({ zrtpDialogVisible: false });
            return;
        }
        if (this.props.markZrtpVerified && this.state.remoteUri) {
            this.props.markZrtpVerified(this.state.remoteUri, session.sas.chars, session.sas.emojis);
        }
        this.setState({ zrtpDialogVisible: false });
        // Force a re-render so badge flips from "encrypted" to "verified".
        this.forceUpdate();
    }

    componentWillUnmount() {
        console.log('AudioCallBox will unmount');
        this.unmounted = true;
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
            this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
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
                this.state.call.removeListener('zrtpStateChanged', this.zrtpStateChanged);
                this.state.call.removeListener('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
            }

            // Attach new listener if available
            if (nextProps.call && nextProps.call.on) {
                nextProps.call.on('stateChanged', this.callStateChanged);
                nextProps.call.on('zrtpStateChanged', this.zrtpStateChanged);
                nextProps.call.on('zrtpMandatoryFailed', this.zrtpMandatoryFailed);
                // Catch up: if the session already reached key-agreed on a
                // prior mount, pull its state so the badge shows immediately.
                const existing = getZrtpSession(nextProps.call);
                if (existing && existing.state) {
                    this.setState({ zrtpState: existing.state });
                }
            }

            if (nextProps.call && nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            }

            this.setState({ call: nextProps.call, zrtpState: null });
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
        if (newState === 'terminated') {
            // Hide ZRTP pill (and dismiss any open verification dialog) the
            // moment the call ends, even though the AudioCallBox component
            // sticks around for a few seconds for the wrap-up UI.
            this.setState({ zrtpState: null, zrtpDialogVisible: false });
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
        // The previous version of this function early-returned whenever
        // any of remote-inbound / local-inbound / local-outbound was
        // absent, which left audioGraphData empty on builds where the
        // peer's inbound rtp record isn't surfaced to JS — that in turn
        // hid the TrafficStats bar-chart entirely (BarChart.js renders
        // nothing when data is empty). Be defensive instead: fall back
        // to whatever stats are available so the bar-chart and the
        // speedometer always see something to draw.
        const { audio, connection } = stats.data || {};
        const remoteAudio   = stats.data?.remote?.audio;
        const inboundAudio  = audio?.inbound?.[0];
        const outboundAudio = audio?.outbound?.[0];
        const remoteInbound = remoteAudio?.inbound?.[0];

        if (!inboundAudio && !outboundAudio) return;

        // RTT: prefer the remote-inbound report (peer-measured RTT for
        // OUR upstream) and fall back to the ICE pair's currentRTT,
        // which is always populated for established calls.
        const rttSec = (remoteInbound && typeof remoteInbound.roundTripTime === 'number')
            ? remoteInbound.roundTripTime
            : (connection?.currentRoundTripTime || 0);
        const latency = (rttSec / 2) * 1000;

        // Codec: try remote-inbound first (peer's view of the codec we
        // send), then either local rtp record. mimeType comes back as
        // "audio/opus" — strip the prefix.
        const rawCodec = remoteInbound?.mimeType
                      || inboundAudio?.mimeType
                      || outboundAudio?.mimeType
                      || '';
        const audioCodec = (rawCodec.split?.('/')?.[1]) || rawCodec || '';

        const addData = {
            timestamp: audio?.timestamp || Date.now(),
            incomingBitrate: inboundAudio?.bitrate || 0,
            outgoingBitrate: outboundAudio?.bitrate || 0,
            latency,
            jitter: inboundAudio?.jitter || 0,
            packetsLostOutbound: remoteInbound?.packetLossRate || 0,
            packetsLostInbound: inboundAudio?.packetLossRate || 0,
            packetRateOutbound: outboundAudio?.packetRate || 0,
            packetRateInbound: inboundAudio?.packetRate || 0,
            audioCodec
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

    toggleStatsView() {
        this.setState(s => ({ showOldStats: !s.showOldStats }));
    }

    /** Render BOTH the AudioSpeedometer and the legacy TrafficStats
     *  bar-chart, hiding the inactive one with display:'none' instead
     *  of conditional mounting. This keeps the speedometer's
     *  call.statistics listener attached across toggles, so its
     *  needles don't reset to zero (or stale-snapshot) every time the
     *  user flips views. The whole block is wrapped in a
     *  TouchableOpacity — a single tap anywhere on the stats flips
     *  between the two views. The ZRTP badge (passed in via `footer`)
     *  sits below either view in the same spot so users always see
     *  verification state in the same place.
     */
    renderStatsBlock(remountKey, footer) {
        // No useful stats before the media starts flowing — hide the
        // whole block until the call reaches 'established'. The ZRTP
        // badge that normally rides along with the stats is still
        // rendered (without the dial) so the user sees verification
        // state during ringing.
        const cs = this.state.call && this.state.call.state;
        const isConnected = cs === 'established' || cs === 'accepted';
        if (!isConnected) {
            return footer || null;
        }

        const showOld = this.state.showOldStats;
        return (
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={this.toggleStatsView}
            >
                <View style={{ display: showOld ? 'flex' : 'none' }}>
                    <TrafficStats
                        key={'cb-stats-' + remountKey}
                        isTablet={this.props.isTablet}
                        isLandscape={this.state.isLandscape}
                        isFolded={this.props.isFolded}
                        data={this.state.audioGraphData}
                        media="audio"
                        footer={showOld ? footer : null}
                    />
                </View>
                <View style={{
                    display: showOld ? 'none' : 'flex',
                    alignItems: 'center',
                }}>
                    <AudioSpeedometer
                        key={'cb-spd-' + remountKey}
                        call={this.state.call}
                        audioCodec={this.props.audioCodec}
                    />
                    {!showOld ? footer : null}
                </View>
            </TouchableOpacity>
        );
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
        
        // ZRTP indicator — rendered inline below the TrafficStats packet
        // loss graph. Hidden during the transient "negotiating" stage and
        // only shown once keys are agreed (so the user doesn't see a
        // yellow pill flash on every setup). Distinct look once the user
        // has verified SAS for this contact.
        // Tap the pill (when key-agreed) to open the SAS verification modal.
        const renderZrtpBadge = () => {
            if (this.state.zrtpState !== 'key-agreed') {
                return null;
            }
            let bg, label;
            const status = this._zrtpVerificationStatus();
            if (status === 'verified') {
                bg = 'rgba(0, 170, 80, 0.9)';     // green — verified
                label = '🔒 zRTP verified';
            } else if (status === 'mismatch') {
                bg = 'rgba(200, 30, 30, 0.9)';    // red — failed/MITM
                label = '⚠ SAS changed';
            } else {
                bg = 'rgba(230, 120, 0, 0.95)';   // orange — unverified
                label = '🔒 zRTP encrypted (tap to verify)';
            }
            const isTappable = true;
            const inner = (
                <View style={{
                    backgroundColor: bg,
                    paddingVertical: 3,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                }}>
                    <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{label}</Text>
                </View>
            );
            return (
                <View style={{ alignItems: 'center', marginTop: 26 }}>
                    {isTappable ? (
                        <TouchableOpacity onPress={this._onZrtpBadgePress}>{inner}</TouchableOpacity>
                    ) : inner}
                </View>
            );
        };

        // ZRTP SAS verification dialog — opened by tapping the green pill.
        const zrtpSession = this.state.zrtpDialogVisible ? getZrtpSession(this.state.call) : null;
        const zrtpSas = zrtpSession && zrtpSession.sas;
        const verificationStatus = this._zrtpVerificationStatus();
        const stored = this.props.callContact
            && this.props.callContact.localProperties
            && this.props.callContact.localProperties.zrtp;

        return (
            <View style={[styles.container, {borderColor: 'blue', borderWidth: 0}, extraStyles]}>
                <Portal>
                    <Dialog
                        visible={this.state.zrtpDialogVisible}
                        onDismiss={() => this.setState({ zrtpDialogVisible: false })}
                    >
                        <Dialog.Title>Verify zRTP encryption</Dialog.Title>
                        <Dialog.Content>
                            <Text style={{ marginBottom: 12 }}>
                                Compare these with the other party. Both phones must show the same letters AND emojis.
                            </Text>
                            {zrtpSas ? (
                                <View style={{ alignItems: 'center', marginVertical: 12 }}>
                                    <Text style={{ fontSize: 36, fontWeight: 'bold', letterSpacing: 8 }}>{zrtpSas.chars}</Text>
                                    <Text style={{ fontSize: 32, marginTop: 6, letterSpacing: 6 }}>{zrtpSas.emojis}</Text>
                                </View>
                            ) : (
                                <Text>Waiting for handshake to complete…</Text>
                            )}
                            {verificationStatus === 'verified' && stored && (
                                <Text style={{ color: 'green', marginTop: 8 }}>
                                    ✓ Previously verified on {new Date(stored.verifiedAt).toLocaleString()}
                                </Text>
                            )}
                            {verificationStatus === 'mismatch' && stored && (
                                <Text style={{ color: 'red', marginTop: 8 }}>
                                    ⚠ The other party's identity key has changed since the last verification on {new Date(stored.verifiedAt).toLocaleString()}. They may have reinstalled — or this could be a MITM. Re-verify carefully before tapping Match.
                                </Text>
                            )}
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={() => this.setState({ zrtpDialogVisible: false })}>Close</Button>
                            <Button onPress={this._onZrtpVerifyConfirm} disabled={!zrtpSas}>Match</Button>
                        </Dialog.Actions>
                    </Dialog>
                    {/* zRTP mandatory-mode handshake failure prompt. */}
                    <Dialog
                        visible={this.state.zrtpMandatoryFailedVisible}
                        onDismiss={this._onZrtpMandatoryContinue}
                        dismissable={false}
                    >
                        <Dialog.Title>End-to-end encryption failed</Dialog.Title>
                        <Dialog.Content>
                            <Text>
                                The zRTP key exchange did not complete. You set
                                encryption to "mandatory" in Preferences, but the
                                other party may not support it.
                                {'\n\n'}
                                You can end the call now, or continue without
                                end-to-end encryption. The call will still be
                                encrypted between your phone and the SylkServer
                                relay (DTLS), but the relay can read the media.
                            </Text>
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={this._onZrtpMandatoryContinue}>
                                Continue
                            </Button>
                            <Button mode="contained" onPress={this._onZrtpMandatoryEndCall}>
                                End call
                            </Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>
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
					shareLocationFromCall = {this.props.shareLocationFromCall}
					requestLocationFromCall = {this.props.requestLocationFromCall}
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
							{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
						</View>
					</View>
				) : this.state.isLandscape && !this.props.isTablet ? (
					/* Landscape on a regular phone: two-column layout — caller
					   info on the left, stats (with ZRTP badge) on the right. */
					<View key={'cb-landscape-row-' + _callRemountKey} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: -20 }] }}>
							<UserIcon key={'cb-usericon-' + _callRemountKey} identity={remoteIdentity} size={userIconSize} active={this.state.active} />
							<Dialog.Title key={'cb-title-' + _callRemountKey} style={styles.displayName}>{displayName}</Dialog.Title>
							<TouchableWithoutFeedback onPress={this.handleDoubleTap}>
								<Text key={'cb-uri-' + _callRemountKey} style={styles.uri}>{this.state.remoteUri}</Text>
							</TouchableWithoutFeedback>
						</View>
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
							{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
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

						{this.renderStatsBlock(_callRemountKey, renderZrtpBadge())}
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
