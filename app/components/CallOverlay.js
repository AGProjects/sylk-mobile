import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from 'react-native-paper';
import SylkAppbarContent from './SylkAppbarContent';
import { Platform, Dimensions} from 'react-native';
import utils from '../utils';
import NetworkSpeedometer from './NetworkSpeedometer';

import styles from '../assets/styles/AudioCall';


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}


class CallOverlay extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            terminatedReason: this.props.terminatedReason,
            media: this.props.media ? this.props.media : 'audio',
            callState: this.props.call ? this.props.call.state : null,
            direction: this.props.call ? this.props.call.direction: null,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            remoteUri: this.props.remoteUri,
            localMedia: this.props.localMedia,
            remoteDisplayName: this.props.remoteDisplayName,
            reconnectingCall: this.props.reconnectingCall,
            isLandscape: this.props.isLandscape,
            menuVisible: false,
            // Show the network speedometers by default; user can hide
            // via the menu's 'Hide bandwidth' item.
            showUsage: true,
            enableMyVideo: this.props.enableMyVideo,
		    availableAudioDevices: this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets,
			aspectRatio: this.props.aspectRatio
        }

        this.duration = null;
        this.finalDuration = null;
        this.timer = null;
        this._isMounted = true;
    }

    componentDidMount() {
        if (this.state.call) {
            if (this.state.call.state === 'established') {
                this.startTimer();
            }
            this.state.call.on('stateChanged', this.callStateChanged);
            this.setState({callState: this.state.call.state});
        }
    }

    componentWillUnmount() {
        this._isMounted = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        clearTimeout(this.timer);
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (!this._isMounted) {
            return;
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
           console.log('Next call:', nextProps.call?.id);

            if (this.state.call !== null) {
			   console.log('Previous call', this.state.call?.id);
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            
            if (nextProps.call  !== null) {
				nextProps.call.on('stateChanged', this.callStateChanged);
            }

            this.setState({call: nextProps.call, 
                           direction: nextProps.call ? nextProps.call.direction : null});
        }

        if ('showUsage' in nextProps && nextProps.showUsage !== undefined) {
			this.setState({showUsage: nextProps.showUsage});
        }

        if ('aspectRatio' in nextProps) {
			this.setState({aspectRatio: nextProps.aspectRatio});
        }

        this.setState({remoteDisplayName: nextProps.remoteDisplayName,
                       remoteUri: nextProps.remoteUri,
                       media: nextProps.media,
                       localMedia: nextProps.localMedia,
                       startTime: nextProps.callState ? nextProps.callState.startTime : null,
                       terminatedReason: nextProps.terminatedReason,
                       isLandscape: nextProps.isLandscape,
                       enableMyVideo: nextProps.enableMyVideo,
						availableAudioDevices: nextProps.availableAudioDevices,
						selectedAudioDevice: nextProps.selectedAudioDevice,
						insets: nextProps.insets
                       });
				// Only log when the audio device values actually changed
				if (nextProps.availableAudioDevices !== this.state.availableAudioDevices ||
					nextProps.selectedAudioDevice !== this.state.selectedAudioDevice) {
					console.log('[CallOverlay] audio devices updated — available:', nextProps.availableAudioDevices, 'selected:', nextProps.selectedAudioDevice);
				}
    }

    callStateChanged(oldState, newState, data) {
        // console.log('callStateChanged', oldState, newState);
        if (newState === 'established' && this._isMounted) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.state.call) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            clearTimeout(this.timer);
            this.finalDuration = this.duration;
            this.duration = null;
            this.timer = null;
        }

        if (newState === 'proceeding') {
            if (this.state.callState === 'ringing' || data.code === 110 || data.code === 180) {
                newState = 'ringing';
            }
        }

        if (!this._isMounted) {
            return;
        }

        this.setState({callState: newState});
    }

    handleMenu(event) {
        switch (event) {
            case 'hangup':
                this.props.hangupCall();
                break;
            case 'myVideo':
                this.props.toggleMyVideo();
                break;
			case 'toggleUsage':
				// Prefer the parent-owned toggle (VideoBox) so the
				// fullscreen speedometer overlay tracks the same flag.
				if (typeof this.props.toggleUsage === 'function') {
					this.props.toggleUsage();
				} else {
					this.setState({showUsage: !this.state.showUsage});
				}
                break;
            case 'swapVideo':
                this.props.swapVideo();
                break;
            case 'aspectRatio':
                this.props.toggleAspectRatio();
                break;
            case 'chat':
                // Same handler as the green chat button in the bottom
                // button bar (AudioCallBox.props.goBackFunc) — pops the
                // call view back to the chat for the active peer
                // without ending the call.
                if (typeof this.props.goBackFunc === 'function') {
                    this.props.goBackFunc();
                }
                break;
            case 'shareLocation':
                // Mirrors the chat-header kebab "Share location..." item.
                // Delegates up to app.js → NavigationBar.handleMenu so
                // the disclosure / OS-permission / duration-picker flow
                // is exactly the same as outside a call.
                //
                // Two-step: first pop back to the peer's chat view
                // (goBackFunc) so the modal (and the resulting "▶️
                // Live location sharing started" system note +
                // location bubble) land on a visible surface; THEN —
                // after a small defer so the route change and the
                // selectedContact setState in goBackToHomeFromCall
                // have settled — fire the share action. Without the
                // defer, NavigationBar.showShareLocationModal()'s
                // setState races with the call→chat re-render and
                // the modal silently never appears (we land on the
                // chat with no picker). Same shape for requestLocation
                // below.
                if (typeof this.props.goBackFunc === 'function') {
                    this.props.goBackFunc();
                }
                if (typeof this.props.shareLocationFromCall === 'function') {
                    setTimeout(() => {
                        this.props.shareLocationFromCall();
                    }, 150);
                }
                break;
            case 'requestLocation':
                if (typeof this.props.goBackFunc === 'function') {
                    this.props.goBackFunc();
                }
                if (typeof this.props.requestLocationFromCall === 'function') {
                    setTimeout(() => {
                        this.props.requestLocationFromCall();
                    }, 150);
                }
                break;
            case 'dtmf':
                // Toggle the AudioCallBox-owned DTMF modal. Unlike the
                // chat / location items above, this one stays inside
                // the call view — there's nothing to navigate away
                // from. The parent owns the modal state, so we just
                // poke its showDtmf handler and let it manage the
                // visibility.
                if (typeof this.props.showDtmfFunc === 'function') {
                    this.props.showDtmfFunc();
                }
                break;
            default:
                break;
        }

        this.setState({menuVisible: false});
    }

    startTimer() {
        if (this.timer !== null) {
            // already armed
            return;
        }

        // TODO: consider using window.requestAnimationFrame

        this.timer = setInterval(() => {
            const duration = moment.duration(new Date() - this.state.startTime);
            if (this.duration > 3600) {
                this.duration = duration.format('hh:mm:ss', {trim: false});
            } else {
                this.duration = duration.format('mm:ss', {trim: false});
            }

            if (this.props.show) {
                this.forceUpdate();
            }
        }, 1000);
    }

    render() {
        let header = null;
        let displayName = this.state.remoteUri;

        if (this.state.remoteDisplayName && this.state.remoteDisplayName !== this.state.remoteUri) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail = 'Contacting server...';

            if (this.duration) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = this.duration + 's';
            } else {
                if (this.state.reconnectingCall) {
                    callDetail = 'Reconnecting call...';
                } else if (this.state.callState === 'terminated') {
                    if (this.finalDuration) {
                        callDetail = 'Call ended after ' + this.finalDuration;
                    } else if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    }
                } else if (this.state.callState === 'incoming') {
                    callDetail = 'Connecting...';
                } else if (this.state.callState === 'accepted') {
                    callDetail = 'Waiting for ' + this.state.media + '...';
                } else if (this.state.callState === 'progress') {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = "Call in progress..."
                    }
                } else if (this.state.callState === 'established') {
                    callDetail = 'Media established';
                } else if (this.state.callState) {
                    callDetail = toTitleCase(this.state.callState);
                } else if (!this.state.call) {
					callDetail = 'Starting call...';
                } else if (!this.state.localMedia) {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = 'Getting local media...';
                    }
                }
            }

            //console.log(' --- render overlay', this.state.callState, this.state.call);
            // info is now visualized via <NetworkSpeedometer/> below.
            // Keep the text fallback only when the speedometer can't
            // attach (no call yet) — useful while dialing.
            if (this.props.info && this.state.showUsage && !this.state.call) {
                callDetail = callDetail + ' ' + this.props.info;
            }

            let mediaLabel = 'Audio call';

            if (this.state.media) {
                mediaLabel = displayName;
            }
            
			const { width, height } = Dimensions.get('window');
	
			const topInset = this.state.insets.top || 0;
			const bottomInset = this.state.insets.bottom || 0;
			const rightInset = this.state.insets.right || 0;
			const leftInset = this.state.insets.left || 0;

			let myVideoTitle = this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror';
			let myUsageTitle = this.state.showUsage ? 'Hide bandwidth' : 'Show bandwidth';
			let myAspectRatio = this.state.aspectRatio == 'cover' ? 'Contain': 'Cover';
			myAspectRatio = 'Toggle aspect ratio';
			
			let appBarContainer = {
				backgroundColor: 'rgba(34,34,34,.7)',
				height: 60,
				// Restore the bleed-up so the appbar background merges
				// with the video container behind it (same look as
				// before Xcode 26).
				marginLeft: this.state.isLandscape
					? -Math.max(leftInset, rightInset)
					: 0,
				marginTop: -topInset,
				width: this.state.isLandscape ? width - rightInset - leftInset: width,
				zIndex: 1000,
				elevation: 10,
			}

			// Remount key — same stale-native-frame fix as NavigationBar /
			// ReadyBox. SylkAppbarContent's Text + Appbar.Action IconButtons
			// cache their measured frame at the density they were first
			// mounted under, so a fold transition must change this key to
			// force re-measurement.
			const _overlayRemountKey = (this.props.isFolded ? 'f' : 'u')
				+ '-' + (this.state.isLandscape ? 'l' : 'p')
				+ '-' + Math.round(width) + 'x' + Math.round(height);

			if (Platform.OS === "ios") {
				//appBarContainer.marginTop = 0;
				if (this.state.isLandscape) {
					// Paper's Appbar.Header renders an outer wrapper
					// View that applies paddingHorizontal:
					// Math.max(left, right) from real safe-area insets
					// (see AppbarHeader.tsx). The style we pass here
					// ends up on the INNER Appbar that lives inside
					// that padded content box.
					//
					// Unlike ConferenceBox (whose container View is
					// pulled to device x=0 via its own negative
					// marginLeft), CallOverlay is rendered directly
					// inside the app-level SafeAreaView, so its
					// natural origin is at device x=leftInset. We must
					// compensate for BOTH the SafeAreaView left inset
					// AND Paper's paddingHorizontal to reach x=0, then
					// give the inner Appbar the window's full width so
					// it spans edge-to-edge.
					const paperPad = Math.max(leftInset, rightInset);
					appBarContainer.marginLeft = -(leftInset + paperPad);
					appBarContainer.width = width;
				}
			} else {
				if (Platform.Version < 34) {
					appBarContainer.marginTop = 0;
				}
			}
        
			header = (
				<Appbar.Header key={'co-header-' + _overlayRemountKey} style={[appBarContainer]}
						dark={true}
						>
					<Appbar.BackAction key={'co-back-' + _overlayRemountKey} onPress={() => {this.props.goBackFunc()}} />
					{/* Two-line caller info. We can't use Paper's
					    Appbar.Content here because Paper 5 / V3 only
					    renders the `subtitle` prop in V2 themes — in
					    V3 it silently drops the second line and
					    centers the title alone, vertically.
					    Hand-rolled stack: title on the row
					    centerline (matches BackAction / kebab) and
					    subtitle just below it. Achieved by NOT
					    centering the pair (which would put title in
					    the top half) — instead we anchor the title's
					    bottom edge at the row's centerline so the
					    title sits in the upper half but with its
					    visual baseline level with the icons, then
					    the subtitle continues down past the
					    centerline. */}
					<View style={{
						flex: 1,
						// Match the main NavBar's title baseline (which
						// uses SylkAppbarContent + NavigationBar's
						// `title` (fontSize 16) and `subtitle`
						// (fontSize 12) styles). Same font sizes and
						// no lineHeight/marginTop overrides means
						// React Native's text-line-box places the
						// glyphs in the same vertical position in
						// both headers, so the URI line sits at
						// exactly the same y-offset whether the user
						// is on ReadyBox or in a call.
						marginLeft: 4,
					}}>
						<Text
							numberOfLines={1}
							ellipsizeMode="tail"
							style={{
								color: 'white',
								fontSize: 16,
							}}
						>
							{mediaLabel}
						</Text>
						<Text
							numberOfLines={1}
							ellipsizeMode="tail"
							style={{
								color: 'rgba(255,255,255,0.7)',
								fontSize: 12,
							}}
						>
							{callDetail}
						</Text>
					</View>

					{/* Navbar speedometer for video calls — temporarily hidden
					    per request. Re-enable by uncommenting the JSX below.
					    The fullscreen-only NetworkSpeedometer in VideoBox is
					    unaffected (that's the small "i" → expand HUD).
					    Audio calls already render their own larger
					    speedometer in the AudioCallBox body, and conferences
					    use their own fullscreen-only overlay. */}
					{/*
					{this.state.call
						&& this.state.callState === 'established'
						&& this.state.media !== 'audio'
						&& !this.props.hideSpeedometers ? (
						<View
							pointerEvents="none"
							style={{
								position: 'absolute',
								right: 52,           // clear the kebab menu
								top: 0,
								bottom: 0,
								justifyContent: 'center',
							}}
						>
							<NetworkSpeedometer
								key={'co-speedo-' + _overlayRemountKey}
								call={this.state.call}
								videoCodec={this.props.videoCodec}
								audioCodec={this.props.audioCodec}
							/>
						</View>
					) : null}
					*/}

                <Menu
                    visible={this.state.menuVisible}
                    onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                    anchor={
                    <View style={{ marginLeft: 50 }}>
                        <Appbar.Action
                            key={'co-menu-' + _overlayRemountKey}
                            ref={this.menuRef}
                            color="white"
                            icon="menu"
                            onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                        />
                        </View>
                    }
                >
					{this.state.media === 'video' && this.state.callState == "established" && (
					<>
                    <Menu.Item onPress={() => this.handleMenu('myVideo')} icon="video" title={myVideoTitle} />
                    <Menu.Item onPress={() => this.handleMenu('aspectRatio')} icon="video" title={myAspectRatio} />
                    <Menu.Item onPress={() => this.handleMenu('swapVideo')} icon="camera-switch" title={'Swap video'} />
                    <Menu.Item onPress={() => this.handleMenu('toggleUsage')} icon="network" title={myUsageTitle} />
					<Divider />
					</>
                    )}
			
					<Menu
						visible={this.state.audioMenuVisible}
						onDismiss={() => this.setState({audioMenuVisible: false})}
						anchor={
							<Menu.Item
								title="Audio device"
								icon="volume-high"
								onPress={() => {
								console.log('[CallOverlay] audio menu opened — available:', this.props.availableAudioDevices, 'selected:', this.props.selectedAudioDevice);
								this.setState({audioMenuVisible: true});
							}}
							/>
						}
					>
						{this.props.availableAudioDevices.map(device => {
							const isSelected = device === this.props.selectedAudioDevice;
							const deviceTitle = utils.availableAudioDeviceNames[device];
				
							return (
								<Menu.Item
									key={device}
									title={
										isSelected
											? `✓ ${deviceTitle}`
											: deviceTitle
									}
									onPress={() => {
										console.log('[CallOverlay] tapped device:', device, '(currently selected:', this.props.selectedAudioDevice, ')');
										this.setState({
											audioMenuVisible: false,
											menuVisible: false
										});
										setTimeout(() => this.props.selectAudioDevice(device), 50);
									}}
								/>
							);
						})}
					</Menu>

					{/* Dialpad — only relevant for audio calls. Opens
						the DTMF modal (the same one the in-call action-
						bar dialpad button used to be the only way to
						reach). Adding it to the kebab makes the dial-
						pad reachable on every audio call regardless of
						whether the destination URI parses as a phone
						number or carries the 'tel' tag, and keeps the
						bottom action bar uncluttered. Hidden when
						media === 'video' since video calls already
						have their own action set above the divider. */}
					{this.state.media !== 'video'
						&& typeof this.props.showDtmfFunc === 'function' && (
						<Menu.Item
							onPress={() => this.handleMenu('dtmf')}
							icon="dialpad"
							title="Dialpad..."
						/>
					)}

					{/* Chat + Share / Request location group — mirrors
						the chat-header kebab and the green chat button
						in the in-call button bar. "Chat..." matches
						AudioCallBox's bottom-bar chat icon (goBackFunc:
						return to the peer's chat without ending the
						call). Share / Request location reuse the same
						NavigationBar handlers as the per-contact menu
						(disclosure → permission → duration picker).
						Delimited with Dividers above and below so the
						group reads as a single block. */}
					{(typeof this.props.goBackFunc === 'function'
					  || typeof this.props.shareLocationFromCall === 'function'
					  || typeof this.props.requestLocationFromCall === 'function') && (
						<>
							<Divider />
							{typeof this.props.goBackFunc === 'function' ? (
								<Menu.Item
									onPress={() => this.handleMenu('chat')}
									icon="chat"
									title="Chat..."
								/>
							) : null}
							{/* Separate "go to chat" from the location
								actions — the items below mutate
								outgoing state (start a share / send a
								request) while Chat is purely a view
								switch, so they belong in their own
								visual sub-group. */}
							{typeof this.props.goBackFunc === 'function'
							  && (typeof this.props.shareLocationFromCall === 'function'
								  || typeof this.props.requestLocationFromCall === 'function') ? (
								<Divider />
							) : null}
							{typeof this.props.shareLocationFromCall === 'function' ? (
								<Menu.Item
									onPress={() => this.handleMenu('shareLocation')}
									icon="map-marker"
									title="Share location..."
								/>
							) : null}
							{typeof this.props.requestLocationFromCall === 'function' ? (
								<Menu.Item
									onPress={() => this.handleMenu('requestLocation')}
									icon="map-marker-question"
									title="Request location..."
								/>
							) : null}
						</>
					)}

					{/* Extra breathing room above Hangup. The dropdown
						items are tall enough that a fast double-tap
						after dismissing one entry can land on the next
						one — for Hangup that means an accidental call
						termination, which is unrecoverable. The spacer
						(plus the Divider above it) pushes Hangup ~24px
						away from the previous item so it sits in its
						own visual zone. */}
					<Divider />
					<View style={{ height: 24 }} />
                    <Menu.Item onPress={() => this.handleMenu('hangup')} icon="phone-hangup" title="Hangup"/>

                </Menu>
                
				</Appbar.Header>
			);
        }
        return header;
    }
}

CallOverlay.propTypes = {
    show: PropTypes.bool.isRequired,
    remoteUri: PropTypes.string,
    localMedia: PropTypes.object,
    remoteDisplayName: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    reconnectingCall: PropTypes.bool,
    terminatedReason : PropTypes.string,
    media: PropTypes.string,
    audioCodec: PropTypes.string,
    videoCodec: PropTypes.string,
    info: PropTypes.string,
    goBackFunc: PropTypes.func,
    callState : PropTypes.object,
    isLandscape: PropTypes.bool,
    isFolded: PropTypes.bool,
    toggleMyVideo: PropTypes.func,
    swapVideo: PropTypes.func,
    enableMyVideo: PropTypes.bool,
    hangupCall: PropTypes.func,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice: PropTypes.func,
    useInCallManger: PropTypes.bool,
    insets: PropTypes.object,
    aspectRatio: PropTypes.string,
    toggleAspectRatio: PropTypes.func,
    shareLocationFromCall: PropTypes.func,
    requestLocationFromCall: PropTypes.func,
    // Optional: opens the DTMF dialpad modal owned by AudioCallBox.
    // When omitted (e.g. on video calls or while the modal is being
    // wired up by another caller), the menu item is hidden.
    showDtmfFunc: PropTypes.func,
};

export default CallOverlay;
