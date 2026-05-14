import React, { useState, useEffect, useRef, Fragment, Component } from 'react';
import { View, TouchableOpacity } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import { StyleSheet } from 'react-native';
import { Platform, Dimensions} from 'react-native';
import momentFormat from 'moment-duration-format';
import { Text, Appbar, Menu, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import utils from '../utils';

const styles = StyleSheet.create({
  container: {
    position: 'absolute', // float above video
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,         // ensures it's on top
  },
});


class ConferenceHeader extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            displayName: this.props.callContact ? this.props.callContact.name : this.props.remoteUri,
            callState: this.props.call ? this.props.call.state : null,
            participants: this.props.participants,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            reconnectingCall: this.props.reconnectingCall,
            info: this.props.info,
            remoteUri: this.props.remoteUri,
            menuVisible: false,
            audioMenuVisible: false,
            chatView: this.props.chatView,
            audioView: this.props.audioView,
            isLandscape: this.props.isLandscape,
            visible:  this.props.visible,
            audioOnly: this.props.audioOnly,
            enableMyVideo: this.props.enableMyVideo,
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets
        }

        this.duration = null;
        this.timer = null;
        this._isMounted = false;
        this.menuRef = React.createRef();
    }

    componentDidMount() {
        this._isMounted = true;

        if (!this.state.call) {
            return;
        }

        if (this.state.call.state === 'established') {
            this.startTimer();
        }
        this.state.call.on('stateChanged', this.callStateChanged);
        this.setState({callState: this.state.call.state});
    }

    startTimer() {
        // Always clear before re-arming. The previous early-return
        // ("if (this.timer !== null) return;") meant that if the prior
        // conference's interval was still alive — e.g. because the
        // component instance was reused across two conferences and the
        // first never went through this listener's 'terminated' branch
        // — the new conference would inherit the old closure, which
        // captured the old startTime and kept ticking from it. Result:
        // a brand-new conference rendered "08:18" because the meter
        // was still counting from the previous conference's start.
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Read startTime out of state on every tick instead of
        // capturing it in the closure. callStateChanged fires the
        // 'established' event on the Call object synchronously, which
        // can land BEFORE the parent's setState(callsState[uuid] = …)
        // has propagated into our props (and from there into
        // state.startTime via componentWillReceiveProps). Capturing
        // here would freeze whatever value state held at startTimer-
        // time — typically the previous conference's startTime,
        // hence the stale meter. Reading per-tick means the next
        // refresh after props finally land shows the correct elapsed
        // time, with at most one second of stutter on first tick.
        this.timer = setInterval(() => {
            const startTime = this.state.startTime;
            if (!startTime) {
                return;
            }
            const duration = moment.duration(new Date() - startTime);
            // Compare against the numeric duration (asSeconds), not
            // `this.duration` — which after the first tick is a
            // formatted string like "00:42", so "00:42" > 3600
            // coerced through Number is NaN and the hh:mm:ss branch
            // never fires. Long conferences silently kept the mm:ss
            // format and wrapped past 60.
            if (duration.asSeconds() > 3600) {
                this.duration = duration.format('hh:mm:ss', {trim: false});
            } else {
                this.duration = duration.format('mm:ss', {trim: false});
            }
        }, 1000);
    }

    componentWillUnmount() {
        this._isMounted = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
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
            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            // The Call object just swapped — we're now showing a
            // different conference. Drop the previous timer + the
            // stale `this.duration` string so the header doesn't
            // flash the old conference's elapsed time while the new
            // call is settling into 'established'. The new timer
            // gets armed by callStateChanged once the new call
            // reports 'established' (or immediately if it already
            // is).
            if (this.timer !== null) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.duration = null;

            this.setState({call: nextProps.call});

            // If the swapped-in call is already past 'established'
            // (e.g. it raced through that state before we registered
            // our listener), we won't get a stateChanged event to
            // arm the timer. Arm it directly so the meter starts.
            if (nextProps.call.state === 'established' && this._isMounted && !nextProps.terminated) {
                this.startTimer();
            }
        }

        this.setState({info: nextProps.info,
                       remoteUri: nextProps.remoteUri,
                       displayName: nextProps.callContact ? nextProps.callContact.name : nextProps.remoteUri,
                       startTime: nextProps.callState ? nextProps.callState.startTime : null,
                       chatView: nextProps.chatView,
                       audioView: nextProps.audioView,
                       isLandscape: nextProps.isLandscape,
                       visible: nextProps.visible,
                       audioOnly: nextProps.audioOnly,
                       enableMyVideo: nextProps.enableMyVideo,
                       participants: nextProps.participants,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets
					   });
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established' && this._isMounted && !this.props.terminated) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.state.call) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            // The previous code used clearTimeout for an interval
            // ID. JS engines accept that crossover, but using the
            // matching clearInterval makes the intent obvious and
            // avoids relying on the timer-pool implementation
            // detail.
            if (this.timer !== null) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.duration = null;
        }

        if (!this._isMounted) {
            return;
        }

        this.setState({callState: newState});
    }

    goBack() {
       this.props.goBackFunc();
    }

    hangUp() {
        console.log('Hangup');
        this.props.hangUpFunc();
    }

    handleMenu(event) {
        //console.log('handleMenu', event);
        switch (event) {
            case 'back':
                this.goBack();
                break;
            case 'invite':
                this.props.inviteToConferenceFunc();
                break;
            case 'hangup':
                this.hangUp();
                break;
            case 'chat':
                this.props.toggleChatFunc();
                break;
            case 'speakers':
                // Open the unified speaker-layout modal directly.
                // The legacy path opened the room-config drawer
                // whose only purpose was to host the "Select first
                // speaker" / "Select second speaker" buttons; the
                // new modal subsumes that flow with mode tabs +
                // per-column pickers.
                if (typeof this.props.toggleSpeakerSelection === 'function') {
                    this.props.toggleSpeakerSelection();
                } else if (typeof this.props.toggleDrawer === 'function') {
                    this.props.toggleDrawer();
                }
                break;
            case 'share':
                this.props.toggleInviteModal();
                break;
            case 'myVideo':
                this.props.toggleMyVideo();
                break;
            case 'aspectRatio':
                // Driven by ConferenceBox.toggleAspectRatio (set
                // up on the matching prop in render()). Mirrors
                // VideoBox's aspect-ratio toggle: flips the tile
                // objectFit between 'cover' and 'contain'.
                if (typeof this.props.toggleAspectRatio === 'function') {
                    this.props.toggleAspectRatio();
                }
                break;
            case 'viewMode':
                // Independent of wire-level media composition —
                // ConferenceBox owns the actual toggle. See the
                // viewMode comment in its constructor for the
                // rationale.
                if (typeof this.props.toggleViewMode === 'function') {
                    this.props.toggleViewMode();
                }
                break;
            default:
                break;
        }

        this.setState({menuVisible: false});
    }

    render() {
        //console.log('render conf header lanscape =', this.state.isLandscape);
        
        if (!this.state.visible) {
			return (null);
        }

        let videoHeader;
        let callButtons;

        if (this.props.terminated) {
            if (this.timer !== null) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.duration = null;
        }

        const room = this.state.remoteUri.split('@')[0];
        let displayName = (this.state.displayName && this.state.displayName !== this.state.remoteUri) ? this.state.displayName : room;
        let callDetail = '';
        
        displayName = 'Room ' + displayName;

        if (this.state.reconnectingCall) {
            callDetail = 'Reconnecting call...';
        } else if (this.state.terminated) {
            callDetail = 'Conference ended';
        } else if (this.duration) {
            callDetail = this.duration;
            if (this.state.participants > 0) {
                var participants = this.state.participants + 1;
                callDetail = callDetail +  ' - ' + participants + ' participant' + (participants > 1 ? 's' : '');
            } else {
                callDetail = callDetail + ' and nobody joined yet';
            }
        } else {
			callDetail = 'Nobody joined yet';
        }

        if (this.state.info && callDetail) {
            //callDetail = callDetail + ' - ' + this.state.info;
        }

/*
				<Appbar.Action color="white" onPress={() => this.handleMenu('invite')} icon="account-plus" />
				<Appbar.Action color="white" onPress={() => this.handleMenu('share')} icon="share-variant" />
*/

        let myVideoTitle = this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror';
        
		const { width, height } = Dimensions.get('window');
		const topInset = this.state.insets.top || 0;
		const bottomInset = this.state.insets.bottom || 0;
		const rightInset = this.state.insets.right || 0;
		const leftInset = this.state.insets.left || 0;

        let chatTitle = this.state.chatView ? 'Hide chat' : 'Show chat';
		
		let appBarContainer = {
			backgroundColor: 'rgba(34,34,34,.7)',
			height: 60,
			// Landscape: parent SafeAreaView already pushes us in by
			// leftInset, AND Paper's outer Appbar wrapper adds its own
			// paddingHorizontal = max(left, right). That stacks to
			// 2 × leftInset of indent. Cancel Paper's padding so the
			// visible content lands exactly at the safe-area boundary
			// — same x as the video container below. Mirrors the fix
			// applied in CallOverlay.
			marginLeft: this.state.isLandscape
				? -Math.max(leftInset, rightInset)
				: 0,
			marginTop: -topInset,
			width: this.state.isLandscape ? width - rightInset - leftInset: width,
		}

		if (Platform.OS === "ios") {
			//appBarContainer.marginTop = 0;
			if (this.state.isLandscape) {
				// On iOS, the conference is rendered through a container
				// that already shifts the navbar to device x=0, so we only
				// need to compensate for Paper's own paddingHorizontal
				// (one paperPad), not the SafeAreaView's leftInset.
				const paperPad = Math.max(leftInset, rightInset);
				appBarContainer.marginLeft = -paperPad;
				appBarContainer.width = width;
			}
        } else {
			if (Platform.Version < 34) {
				appBarContainer.marginTop = 0;
			}
		}
        
        return (
			<Appbar.Header
			  style={[appBarContainer]}
			  dark={true}
			>
			  <Appbar.BackAction onPress={this.goBack} color="white" />

			  {/* Title + Subtitle */}
			  <View style={{ flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
				<Text style={{ fontSize: 16, fontWeight: 'bold', color: 'white' }}
				numberOfLines={1}
				ellipsizeMode="tail"
				>

				  {displayName}
				</Text>
				<Text style={{ fontSize: 14, color: 'white' }}
				numberOfLines={1}
				ellipsizeMode="tail"
				>
				  {callDetail}
				</Text>
			  </View>

			  {/* Right-aligned buttons */}
			  <View style={{ flexDirection: 'row', alignItems: 'center'}}>
				{/* In landscape, the call-control buttons live inline in
				    the navbar (space is tight). In portrait they render
				    as a floating overlay in ConferenceBox, below the
				    navbar. */}
				{this.state.isLandscape &&
				  this.props.buttons.bottom?.map((btn, idx) => (
					<View key={idx} style={{ marginLeft: 2 }}>
					  {btn}
					</View>
				  ))
				}

				{this.props.buttons.additional}

				{/* Optional in-navbar content (e.g. landscape speedometer)
				    rendered as a sibling of the right-side buttons so it
				    sits inside the navbar's vertical band rather than
				    floating below it. */}
				{this.props.navbarExtras ? (
				  <View style={{ marginLeft: 8, justifyContent: 'center' }}>
				    {this.props.navbarExtras}
				  </View>
				) : null}

				{/* Inline view-mode toggle on the navbar so the user
				    doesn't have to dig through the kebab to switch
				    layouts. The button renders as a tiny
				    transition row — [current view glyph] → [arrow]
				    → [destination view glyph] — so the tap intent
				    reads as obviously directional. A single glyph
				    by itself (an earlier iteration) was ambiguous:
				    the user couldn't tell whether they were seeing
				    the CURRENT mode or the DESTINATION.
				       • volume-high glyph = audio view.
				       • apps glyph (9 solid squares, 3x3) = video
				         matrix view.
				       • arrow-right between them shows the
				         transition direction.
				    In audio view:  [volume-high] → [apps]
				    In video view:  [apps] → [volume-high]
				    Only rendered when ConferenceBox has wired up
				    toggleViewMode — same gate as the kebab item. */}
				{typeof this.props.toggleViewMode === 'function' ? (
				  (() => {
				    const _fromIcon = this.props.audioOnly ? 'volume-high' : 'apps';
				    const _toIcon = this.props.audioOnly ? 'apps' : 'volume-high';
				    const _a11y = this.props.audioOnly ? 'Switch to video view' : 'Switch to audio view';
				    return (
				      <TouchableOpacity
				        onPress={() => this.props.toggleViewMode()}
				        accessibilityRole="button"
				        accessibilityLabel={_a11y}
				        // Match the Appbar.Action visual footprint
				        // so the row sits comfortably inside the
				        // header's vertical band. hitSlop pads the
				        // touch target so the transition glyph
				        // pair is easy to land on without making
				        // the visual chip wider than necessary.
				        // Larger left margin in landscape so the
				        // transition glyph row doesn't crowd the
				        // inline buttons.bottom call-control icons
				        // that only appear in landscape (mute,
				        // hangup, etc., rendered just above this
				        // block). Portrait keeps a tighter spacing
				        // because navbarExtras / additional are
				        // usually empty there.
				        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
				        style={{
				          flexDirection: 'row',
				          alignItems: 'center',
				          justifyContent: 'center',
				          paddingHorizontal: 6,
				          marginLeft: this.state.isLandscape ? 16 : 0,
				          height: 40,
				        }}
				      >
				        <Icon name={_fromIcon} size={20} color="white" />
				        <Icon
				          name="arrow-right"
				          size={14}
				          color="white"
				          style={{ marginHorizontal: 2 }}
				        />
				        <Icon name={_toIcon} size={20} color="white" />
				      </TouchableOpacity>
				    );
				  })()
				) : null}

                <Menu
                    visible={this.state.menuVisible}
                    onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                    anchor={
                    <View style={{ marginLeft: 30}}>
                        <Appbar.Action
                            ref={this.menuRef}
                            color="white"
                            icon="menu"
                            onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                        />
                        </View>
                    }
                >
                    <Menu.Item onPress={() => this.handleMenu('invite')} icon="account-plus" title="Invite participants..." />
                    <Menu.Item onPress={() => this.handleMenu('share')} icon="share-variant" title="Share conference link..." />
                    {this.state.participants > 1 && !this.state.audioOnly?
                    <Menu.Item onPress={() => this.handleMenu('speakers')} icon="account-tie" title="Select speakers..." />
                    : null}
                    {/* Hide / Show mirror — toggles enableMyVideo,
                        which controls both the audio-view self-PIP
                        AND the video-view floating self-PIP (the
                        "showMyself" tile that appears when the
                        visible-remote count puts self off the
                        matrix: counts 0, 2, 4+). In video view at
                        counts 1 / 3 the self tile is already in
                        the matrix and this toggle is a no-op for
                        that tile — but harmless. Always shown so
                        the user can suppress their own preview
                        from either layout. */}
                    <Menu.Item onPress={() => this.handleMenu('myVideo')} icon="video" title={myVideoTitle} />
                    {/* Aspect ratio — same toggle VideoBox's
                        kebab offers for 1:1 calls. Flips between
                        'cover' (fill the tile, possibly cropping)
                        and 'contain' (fit the whole frame,
                        letterbox bars). Only relevant in video
                        view (audio view has no video tiles to
                        re-fit). */}
                    {!this.props.audioOnly && typeof this.props.toggleAspectRatio === 'function' ? (
                    <Menu.Item onPress={() => this.handleMenu('aspectRatio')} icon="aspect-ratio" title="Toggle aspect ratio" />
                    ) : null}
                    {/* View-mode toggle. Independent of wire-level
                        media composition (props.audioOnly here is
                        the VIEW signal, not the wire capability —
                        ConferenceBox passes audioOnlyView, see its
                        viewMode comment). Title reflects the
                        destination state so the user always sees
                        the action they're about to take. Only
                        rendered when ConferenceBox actually wired
                        the handler, so we don't surface a no-op
                        on surfaces that haven't adopted the
                        toggle yet. */}
                    {typeof this.props.toggleViewMode === 'function' ? (
                    <Menu.Item
                        onPress={() => this.handleMenu('viewMode')}
                        icon={this.props.audioOnly ? 'video' : 'volume-high'}
                        title={this.props.audioOnly ? 'Switch to video view' : 'Switch to audio view'}
                    />
                    ) : null}

                    {/* Audio device picker — sits AFTER the
                        view-mode toggle (per request). The two
                        items are conceptually related ("change
                        how this call is heard / seen") so they
                        cluster together; keeping the device
                        picker immediately below the view toggle
                        means a single open of the kebab covers
                        both audio routing and video/audio
                        layout in one glance. */}
					<Menu
						visible={this.state.audioMenuVisible}
						onDismiss={() => this.setState({audioMenuVisible: false})}
						anchor={
							<Menu.Item
								title="Audio device"
								icon={utils.availableAudioDevicesIconsMap[this.props.selectedAudioDevice] || "volume-high"}
								onPress={() => this.setState({audioMenuVisible: true})}
							/>
						}
					>
						{this.props.availableAudioDevices.map(device => {
							const isSelected = device === this.props.selectedAudioDevice;
							const deviceTitle = utils.availableAudioDeviceNames[device] || device;

							return (
								<Menu.Item
									key={device}
									title={
										isSelected
											? `✓ ${deviceTitle}`
											: deviceTitle
									}
									onPress={() => {
										this.props.selectAudioDevice(device);
										this.setState({
											audioMenuVisible: false,
											menuVisible: false
										});
									}}
								/>
							);
						})}
					</Menu>

                    {/* Extra breathing room above Hangup. Mirrors the
                        CallOverlay layout — the dropdown items are
                        tall enough that a fast double-tap after
                        dismissing one entry can land on the next
                        one, and for Hangup that means an accidental
                        conference termination, which is unrecoverable.
                        The Divider plus a 24-px spacer push Hangup
                        into its own visual zone at the bottom of
                        the menu. */}
                    <Divider />
                    <View style={{ height: 24 }} />
                    <Menu.Item onPress={() => this.handleMenu('hangup')} icon="phone-hangup" title="Hangup"/>
                </Menu>

			  </View>
			</Appbar.Header>
			);
		}
	}

ConferenceHeader.propTypes = {
    visible: PropTypes.bool,
    height: PropTypes.number,
    remoteUri: PropTypes.string.isRequired,
    call: PropTypes.object,
    isTablet: PropTypes.bool,
    isLandscape: PropTypes.bool,
    participants: PropTypes.number,
    buttons: PropTypes.object.isRequired,
    reconnectingCall: PropTypes.bool,
    audioOnly: PropTypes.bool,
    terminated: PropTypes.bool,
    info: PropTypes.string,
    callContact: PropTypes.object,
    toggleChatFunc: PropTypes.func,
    toggleAudioParticipantsFunc: PropTypes.func,
    goBackFunc: PropTypes.func,
    hangUpFunc: PropTypes.func,
    toggleInviteModal: PropTypes.func,
    inviteToConferenceFunc: PropTypes.func,
    // Flips ConferenceBox.viewMode between 'audio' and 'video'.
    // Wired by ConferenceBox; absent on surfaces that haven't
    // adopted the toggle (in which case the menu item is hidden).
    toggleViewMode: PropTypes.func,
    // Flips ConferenceBox.aspectRatio between 'cover' and
    // 'contain' — same shape as VideoBox's identically-named
    // prop. Drives the objectFit of every video tile.
    toggleAspectRatio: PropTypes.func,
    audioView: PropTypes.bool,
    chatView: PropTypes.bool,
    callState: PropTypes.object,
    toggleDrawer: PropTypes.func,
    // Opens the new SpeakerSelectionModal in ConferenceBox. The
    // 'speakers' kebab item calls this in preference to
    // toggleDrawer when wired.
    toggleSpeakerSelection: PropTypes.func,
    enableMyVideo: PropTypes.bool,
    toggleMyVideo: PropTypes.func,
    availableAudioDevices: PropTypes.array,
    selectedAudioDevice: PropTypes.string,
    selectAudioDevice: PropTypes.func,
    insets: PropTypes.object,
    navbarExtras: PropTypes.node
};

export default ConferenceHeader;

