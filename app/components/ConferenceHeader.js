import React, { useState, useEffect, useRef, Fragment, Component } from 'react';
import { View, TouchableOpacity, Image } from 'react-native';
import DarkModeManager from '../DarkModeManager';
const _blinkLogoConf = require('../assets/images/blink-white-big.png');
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
            // Count of other participants (excluding self and the audio
            // bridge), computed in ConferenceBox from the union of the
            // Janus webrtc roster and the SIP-side conference-info
            // roster. Distinct prop from `participants` (which is the
            // webrtc array, used by the kebab menu for its "Hide
            // mirror" disabled check) — same JSX element used to ship
            // two `participants={...}` lines and the array silently
            // overwrote the count via JSX last-write-wins, making the
            // "Nobody joined yet" subtitle stick even when SIP-only
            // participants were already in the room.
            participantsCount: this.props.participantsCount,
            // Server-authoritative conference duration anchor in
            // seconds (computed by webrtcgateway as time since the
            // videoroom was created — independent of any SIP focus
            // clock). When non-null on first arrival, shifts the
            // local startTime back by serverDuration so the running
            // timer shows "conference has been going N seconds"
            // rather than "I joined N seconds ago".
            serverDuration: this.props.serverDuration,
            serverDurationApplied: false,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            reconnectingCall: this.props.reconnectingCall,
            info: this.props.info,
            remoteUri: this.props.remoteUri,
            menuVisible: false,
            audioMenuVisible: false,
            // Nested-submenu visibility for the audio-view Video...
            // entry. Only used when this.props.audioOnly is true —
            // in video view, Video... opens the camera picker
            // overlay anchored to the call-bar instead.
            videoMenuVisible: false,
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

        // Compute the timer anchor.
        //
        // Three cases:
        //   (a) Server duration already applied → freeze startTime to
        //       whatever the previous shift produced. Each subsequent
        //       receiveProps used to blindly reset startTime to
        //       nextProps.callState.startTime, which is the original
        //       un-shifted join time — that erased the shift and the
        //       meter dropped back to 0 (the user reported "starts
        //       from zero even though server says 728").
        //   (b) Server duration not yet applied, but a non-zero
        //       sample is arriving now AND we know our join time:
        //       shift back by serverDuration*1000 so (now - startTime)
        //       ≈ serverDuration at the first tick. Gate is >0 (not
        //       >=0) because a 0 reading from the session-accept
        //       conferenceDuration event would otherwise satisfy
        //       the condition with no actual shift, flipping
        //       serverDurationApplied to true and ignoring every
        //       later non-zero NOTIFY.
        //   (c) Otherwise → use the raw join time from props (meter
        //       starts at 0 and counts up until a real anchor lands).
        const _liveStartTime = nextProps.callState ? nextProps.callState.startTime : null;
        let _nextStartTime;
        let _serverDurationApplied = this.state.serverDurationApplied;
        if (_serverDurationApplied) {
            _nextStartTime = this.state.startTime;
        } else if (typeof nextProps.serverDuration === 'number'
                && nextProps.serverDuration > 0
                && _liveStartTime) {
            _nextStartTime = new Date(new Date(_liveStartTime).getTime() - nextProps.serverDuration * 1000);
            _serverDurationApplied = true;
        } else {
            _nextStartTime = _liveStartTime;
        }

        this.setState({info: nextProps.info,
                       remoteUri: nextProps.remoteUri,
                       displayName: nextProps.callContact ? nextProps.callContact.name : nextProps.remoteUri,
                       startTime: _nextStartTime,
                       chatView: nextProps.chatView,
                       audioView: nextProps.audioView,
                       isLandscape: nextProps.isLandscape,
                       visible: nextProps.visible,
                       audioOnly: nextProps.audioOnly,
                       enableMyVideo: nextProps.enableMyVideo,
                       participants: nextProps.participants,
                       participantsCount: nextProps.participantsCount,
                       serverDuration: nextProps.serverDuration,
                       serverDurationApplied: _serverDurationApplied,
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
            case 'bridge':
                // Toggle the PSTN bridge tile's visibility in the
                // participants list. ConferenceBox owns the state
                // (default hidden) and the bridge tile gating logic;
                // this handler just forwards the user tap.
                if (typeof this.props.toggleBridgeVisibility === 'function') {
                    this.props.toggleBridgeVisibility();
                }
                this.setState({menuVisible: false});
                break;
            case 'myVideo':
                this.props.toggleMyVideo();
                break;
            case 'videoPicker':
                // Open the camera picker overlay that ConferenceBox
                // already renders for the call-button-bar video
                // button (renderVideoPicker → setState
                // videoPickerVisible). Wired via the
                // openVideoPicker prop so the kebab and the bar's
                // button surface the SAME panel (Front Camera /
                // Back Camera / Stop video / Start video / Hide
                // mirror / Show mirror / Aspect ratio). Avoids
                // re-implementing the camera picker as a Paper
                // Menu nested under the kebab.
                if (typeof this.props.openVideoPicker === 'function') {
                    this.props.openVideoPicker();
                }
                break;
            case 'audioPicker':
                // Open the audio device picker overlay that
                // ConferenceBox already renders for the call-button-
                // bar audio device button (renderAudioDevicePicker
                // → setState audioDevicePickerVisible). Same
                // pattern as videoPicker above: kebab and bar
                // dispatch to one shared picker surface so users
                // see the same list of devices (speaker /
                // bluetooth / earpiece / wired) regardless of
                // entry point. Replaces the previous nested
                // Paper Menu submenu inside the kebab.
                if (typeof this.props.openAudioPicker === 'function') {
                    this.props.openAudioPicker();
                }
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

        // Count of OTHER participants in the room (excluding self and
        // the audio bridge), passed in as a distinct prop so this
        // check stays well-typed even though the legacy `participants`
        // prop on this same component carries the webrtc roster ARRAY
        // (used elsewhere for the menu's mirror-toggle disabled gate).
        const otherCount = (typeof this.state.participantsCount === 'number')
            ? this.state.participantsCount
            : 0;

        if (this.state.reconnectingCall) {
            callDetail = 'Reconnecting call...';
        } else if (this.state.terminated) {
            callDetail = 'Conference ended';
        } else if (this.duration) {
            callDetail = this.duration;
            if (otherCount > 0) {
                const participants = otherCount + 1;
                callDetail = callDetail +  ' - ' + participants + ' participant' + (participants > 1 ? 's' : '');
            } else {
                callDetail = callDetail + ' and I am still alone';
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
		
		// Unified Sylk-blue background — same recipe as CallOverlay
		// and the main app navbar. Slight 0.92 alpha so a hint of the
		// underlying conference video still bleeds through behind
		// the header. Brand colour: Pantone Process Uncoated DS 211-3U
		// = #5476A5 (see DarkModeManager SYLK_BLUE_DEEP).
		let appBarContainer = {
			backgroundColor: 'rgba(67, 98, 148, 0.92)',
			height: 60,
			// Landscape: extend the navbar from screen-left to the
			// safe-area-right boundary (matches the outer container
			// override in ConferenceBox for Android landscape so the
			// kebab sits flush with the right margin instead of being
			// indented by leftInset). marginLeft cancels Paper's
			// padding + the SafeAreaView push so the appbar's left
			// edge lands at x=0; width carries it to width -
			// rightInset (screen edge minus Android system-buttons
			// strip).
			marginLeft: this.state.isLandscape
				? -Math.max(leftInset, rightInset)
				: 0,
			marginTop: -topInset,
			width: this.state.isLandscape ? width - rightInset : width,
		}

		if (Platform.OS === "ios") {
			//appBarContainer.marginTop = 0;
			if (this.state.isLandscape) {
				// Paper's Appbar.Header is wrapped in an outer root-
				// layer View that auto-applies paddingHorizontal =
				// max(left, right). Negative marginLeft = -paperPad
				// cancels Paper's left padding so the Appbar's left
				// edge sits flush at x=0 of its parent (Orange).
				// Width must MATCH the parent's width or Red will
				// visibly overflow Orange on the right (audio mode)
				// or stop short of Orange on the right (video mode):
				//   • Audio view: ConferenceBox sets
				//     conferenceHeader.width = width - rightInset
				//     - leftInset (a sized View).
				//   • Video view: conferenceHeader is an absolute
				//     overlay with left:0, right:0 filling the
				//     container (= `width` pixels in iOS landscape).
				const paperPad = Math.max(leftInset, rightInset);
				appBarContainer.marginLeft = -paperPad;
				appBarContainer.width = this.props.audioOnly
					? width - rightInset - leftInset
					: width;
			}
        } else {
			if (Platform.Version < 34) {
				appBarContainer.marginTop = 0;
			}
		}
        
        // Slim Sylk logo + "Sylk Mobile" brand strip above the
        // conference header — portrait only. Sits BELOW the OS
        // status bar (no negative marginTop) — earlier revision had
        // marginTop:-topInset which put the wordmark behind the
        // system clock/battery icons.
        // When the strip is shown, the Appbar's own marginTop:-topInset
        // is neutralised so it doesn't pull up behind the strip.
        const _showConfBrandStrip = !this.state.isLandscape;
        // In-call brand strip is intentionally pinned to the DARK
        // (Night) palette regardless of the active theme. The
        // conference surface (audio tiles / video grid) is dark, so a
        // white Day-theme strip across the top reads as a jarring
        // bright band above the call. We keep the literals here in
        // sync with NIGHT_THEME.brandStripBackground / brandStripText
        // in DarkModeManager.js — if you re-skin Night mode, mirror
        // the change here. Dimensions (height 34 / 22×22 logo / 14px
        // text) still match the main NavigationBar strip so the chrome
        // has the same shape as the rest of the app.
        const _CALL_STRIP_BG   = '#121212';
        const _CALL_STRIP_TEXT = '#FFFFFF';
        const _confBrandStrip = _showConfBrandStrip ? (
            <View style={{
                backgroundColor: _CALL_STRIP_BG,
                height: 34,
                paddingLeft: 12,
                paddingRight: 12,
                flexDirection: 'row',
                alignItems: 'center',
                width: Dimensions.get('window').width,
                zIndex: 1000,
                elevation: 10,
            }}>
                <Image source={_blinkLogoConf}
                    style={{ width: 22, height: 22, marginRight: 8, marginLeft: leftInset }} />
                <Text style={{ color: _CALL_STRIP_TEXT, fontSize: 14, fontWeight: '400' }}>Blink</Text>
            </View>
        ) : null;
        const _appBarStyleWithStrip = _showConfBrandStrip
            ? [appBarContainer, { marginTop: 0 }]
            : [appBarContainer];
        return (
          <Fragment>
            {_confBrandStrip}
			<Appbar.Header
			  style={_appBarStyleWithStrip}
			  /* statusBarHeight={0} when the brand strip is shown:
			     suppresses Paper's internal safe-area-top padding,
			     which would otherwise leave a topInset-tall empty
			     band between the brand strip and the Appbar. */
			  statusBarHeight={_showConfBrandStrip ? 0 : undefined}
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
					// No extra marginLeft on the wrapper — each btn
					// already carries its own 5 dp left/right
					// margin via styles.buttonContainer (margin:5),
					// so a 10 dp inter-button gap matches portrait.
					// An earlier 10 dp wrapper-marginLeft stacked
					// with the per-button margins for an effective
					// 20 dp gap, which the user reported as "too
					// much space".
					<View key={idx}>
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
				    // Audio view ↔ Video view transition pair.
				    // Video side now uses the classic `video`
				    // camcorder glyph instead of `apps` (the 3×3
				    // grid-of-dots). `apps` reads as "app drawer"
				    // / "launcher" to most users and didn't
				    // communicate "video view" — the camcorder
				    // glyph maps directly to what the user is
				    // toggling. Matches the icon already used by
				    // the kebab-menu twin of this control just
				    // below. The audio side stays `volume-high`,
				    // unchanged.
				    // Three-state formation:
				    //   chat view  → [chat] → [volume-high]  (exit to audio)
				    //   audio view → [volume-high] → [video] (switch to video)
				    //   video view → [video] → [volume-high] (switch to audio)
				    // When in chat the onPress routes through toggleChatFunc
				    // (which already closes the chat overlay and lands the
				    // user back on the audio participants view); otherwise
				    // it falls through to toggleViewMode. This replaces the
				    // standalone "back to audio" group-icon button that used
				    // to sit above the chat — the navbar formation is the
				    // single source of truth for view-switch affordances.
				    // Chat detection.
				    //   • Audio-only conference: only audioChatView
				    //     actually means "chat panel is on screen";
				    //     chatView is initialised to !videoEnabled
				    //     (i.e. always TRUE in audio conferences)
				    //     so it can't be used as a signal here.
				    //     The earlier `audioChatView || chatView`
				    //     check made the formation render the
				    //     chat → audio variant even in the
				    //     participants view, which is what made the
				    //     audio → video tap appear dead.
				    //   • Video conference: chatView is the
				    //     definitive chat-on-screen flag (chat
				    //     splits alongside the video tiles).
				    const _inChat = this.props.audioOnly
				        ? !!this.props.audioChatView
				        : !!this.props.chatView;
				    let _fromIcon;
				    let _toIcon;
				    let _a11y;
				    let _onPress;
				    if (_inChat) {
				        _fromIcon = 'chat';
				        _toIcon = 'volume-high';
				        _a11y = 'Switch to audio view';
				        _onPress = () => {
				            // Diagnostic — tracing why the chat → audio
				            // formation appeared to do nothing. Logs
				            // which branch (if any) we take when the
				            // user taps the formation.
				            console.log('[ConferenceHeader] chat→audio tap'
				                + ' audioChatView=' + !!this.props.audioChatView
				                + ' chatView=' + !!this.props.chatView
				                + ' hasToggleAudioChatViewFunc=' + (typeof this.props.toggleAudioChatViewFunc === 'function')
				                + ' hasToggleChatFunc=' + (typeof this.props.toggleChatFunc === 'function')
				                + ' hasToggleViewMode=' + (typeof this.props.toggleViewMode === 'function'));
				            if (this.props.audioChatView
				                    && typeof this.props.toggleAudioChatViewFunc === 'function') {
				                console.log('[ConferenceHeader] → calling toggleAudioChatViewFunc');
				                this.props.toggleAudioChatViewFunc();
				            } else if (typeof this.props.toggleChatFunc === 'function') {
				                console.log('[ConferenceHeader] → calling toggleChatFunc');
				                this.props.toggleChatFunc();
				            } else if (typeof this.props.toggleViewMode === 'function') {
				                console.log('[ConferenceHeader] → calling toggleViewMode');
				                this.props.toggleViewMode();
				            } else {
				                console.log('[ConferenceHeader] → no handler available');
				            }
				        };
				    } else {
				        _fromIcon = this.props.audioOnly ? 'volume-high' : 'video';
				        _toIcon = this.props.audioOnly ? 'video' : 'volume-high';
				        _a11y = this.props.audioOnly ? 'Switch to video view' : 'Switch to audio view';
				        _onPress = () => this.props.toggleViewMode();
				    }
				    return (
				      <TouchableOpacity
				        onPress={_onPress}
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

                {/* Quick-access "+" invite button removed from the
                    navbar entirely (per user request). The same
                    action is still available from the kebab menu's
                    "Invite participants…" entry below. */}

                <Menu
                    visible={this.state.menuVisible}
                    onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                    anchor={
                    /* marginLeft trimmed from 30 → 4. The kebab
                       used to sit a noticeable gap to the right
                       of the audio↔video transition button, which
                       looked like dead space inside the header.
                       Tighter spacing keeps the two right-side
                       controls visually paired without crowding —
                       Appbar.Action already adds its own internal
                       padding so we only need a few px of nudge
                       between them. */
                    <View style={{ marginLeft: 4}}>
                        <Appbar.Action
                            ref={this.menuRef}
                            color="white"
                            icon="menu"
                            /* Kebab toggle. Tapping closes any open
                               device picker overlay (audio / video)
                               BEFORE toggling the kebab itself, so a
                               second tap on the kebab feels like a
                               "reset to default": picker collapses,
                               kebab opens or closes. Without this,
                               a picker opened from a previous kebab
                               session would stay visible behind the
                               freshly-opened kebab and crowd the
                               screen. closeMediaPickers is wired by
                               ConferenceBox to clear both
                               audioDevicePickerVisible and
                               videoPickerVisible in one setState. */
                            onPress={() => {
                                if (typeof this.props.closeMediaPickers === 'function') {
                                    this.props.closeMediaPickers();
                                }
                                this.setState({menuVisible: !this.state.menuVisible});
                            }}
                        />
                        </View>
                    }
                >
                    <Menu.Item onPress={() => this.handleMenu('invite')} icon="account-plus" title="Invite participants..." />
                    <Menu.Item onPress={() => this.handleMenu('share')} icon="share-variant" title="Share conference link..." />
                    {/* PSTN bridge toggle — only shown when a bridge
                        is actually present in the room (bridgePresent
                        prop). Title reflects the next action so the
                        user knows what'll happen on tap: "Show PSTN
                        bridge" when currently hidden, "Hide PSTN
                        bridge" when currently shown. Icon mirrors the
                        bridge avatar used in the participant list. */}
                    {/* Folded (cover-display) mode also hides this
                        Show/Hide PSTN bridge toggle per user request —
                        the bridge controls aren't useful on the cramped
                        cover screen. */}
                    {this.props.bridgePresent && !this.props.isFolded ? (
                        <Menu.Item
                            onPress={() => this.handleMenu('bridge')}
                            icon="bridge"
                            title={this.props.showBridge ? 'Hide PSTN bridge' : 'Show PSTN bridge'}
                        />
                    ) : null}
                    {/* Speaker selection only makes sense with 2+
                        remote VIDEO participants to choose between.
                        ConferenceBox passes videoParticipantCount =
                        count of remote participants with an actual
                        video track (bridges and audio-only remotes
                        excluded). Falling back to the total
                        participants > 2 check when the new prop
                        isn't wired keeps older parents working. */}
                    {(this.props.videoParticipantCount != null
                        ? this.props.videoParticipantCount > 1
                        : this.state.participants > 2)
                     && !this.state.audioOnly ?
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
                    {/* Media-controls group: a single bounded
                        block of view / audio / video items, fenced
                        above and below by Dividers so it reads as
                        one cluster inside the longer kebab list.
                        Order:
                          1. Switch to xxx view (audio ↔ video layout)
                          2. Audio... (opens the audio device picker
                             overlay anchored to the call-bar button)
                          3. Video... (opens the camera picker overlay
                             — front/back camera, Stop/Start video,
                             Hide/Show mirror, Aspect ratio)
                        Hide-mirror and Toggle-aspect-ratio used to
                        live as standalone kebab items here; both
                        have been folded into the Video... picker so
                        every video-tile affordance is under one
                        entry point. */}
                    {/* Divider above the media-controls group — hidden
                        in folded mode along with the items it
                        separates so the menu doesn't show an orphan
                        rule bracketing nothing. */}
                    {!this.props.isFolded ? <Divider /> : null}
                    {/* Switch to video view / Switch to audio view —
                        hidden in folded mode per user request. The
                        cover screen has no useful video layout, so
                        offering the toggle doesn't lead anywhere
                        meaningful. */}
                    {!this.props.isFolded && typeof this.props.toggleViewMode === 'function' ? (
                    <Menu.Item
                        onPress={() => this.handleMenu('viewMode')}
                        icon={this.props.audioOnly ? 'video' : 'volume-high'}
                        title={this.props.audioOnly ? 'Switch to video view' : 'Switch to audio view'}
                    />
                    ) : null}

                    {/* Audio... — in VIDEO view the call-button-bar
                        carries an audio device button, so the kebab
                        item just opens that bar's picker overlay
                        (one shared visible surface).
                        In AUDIO view there's no bar button to anchor
                        to, so we fall back to the classic nested
                        Paper Menu pattern — devices render as
                        inline rows inside the kebab.
                        Folded mode: hide entirely. The cover screen
                        has no room for the picker overlay and the
                        user can change the route from the main
                        display when needed. */}
                    {!this.props.isFolded && (
                    this.props.audioOnly ? (
                        <Menu
                            visible={this.state.audioMenuVisible}
                            onDismiss={() => this.setState({audioMenuVisible: false})}
                            anchor={
                                <Menu.Item
                                    title="Audio..."
                                    icon={utils.availableAudioDevicesIconsMap[this.props.selectedAudioDevice] || "volume-high"}
                                    onPress={() => this.setState({audioMenuVisible: true})}
                                />
                            }
                        >
                            {(this.props.availableAudioDevices || []).map(device => {
                                const isSelected = device === this.props.selectedAudioDevice;
                                const deviceTitle = (utils.availableAudioDeviceNames && utils.availableAudioDeviceNames[device]) || device;
                                return (
                                    <Menu.Item
                                        key={device}
                                        icon={utils.availableAudioDevicesIconsMap[device] || 'volume-high'}
                                        title={isSelected ? `✓ ${deviceTitle}` : deviceTitle}
                                        onPress={() => {
                                            this.props.selectAudioDevice(device);
                                            this.setState({audioMenuVisible: false, menuVisible: false});
                                        }}
                                    />
                                );
                            })}
                        </Menu>
                    ) : (
                        <Menu.Item
                            onPress={() => this.handleMenu('audioPicker')}
                            icon={utils.availableAudioDevicesIconsMap[this.props.selectedAudioDevice] || "volume-high"}
                            title="Audio..."
                        />
                    ))}

                    {/* Video... — same audio-vs-video-view split as
                        Audio... above. In video view, defer to the
                        camera-picker overlay anchored to the call-
                        bar video button. In audio view there is no
                        camera-bar button to anchor to, so render a
                        classic Paper submenu inline. The audio-view
                        submenu carries only the controls that are
                        actionable without a live tile in front of
                        the user: Stop / Start video, Hide / Show
                        mirror, Aspect ratio. Camera-front /
                        camera-rear selection is intentionally
                        omitted from this submenu — switching
                        cameras while in audio view has no immediate
                        visual feedback, and the full picker is
                        still one tap away after switching to
                        video view. */}
                    {/* Folded mode: hide Video... entirely. Same
                        reasoning as the Audio... gate above. */}
                    {!this.props.isFolded && (
                    this.props.audioOnly ? (
                        <Menu
                            visible={this.state.videoMenuVisible}
                            onDismiss={() => this.setState({videoMenuVisible: false})}
                            anchor={
                                <Menu.Item
                                    title="Video..."
                                    icon="video"
                                    onPress={() => this.setState({videoMenuVisible: true})}
                                />
                            }
                        >
                            {typeof this.props.toggleVideoMute === 'function' ? (
                                <Menu.Item
                                    icon={this.props.videoMuted ? 'video' : 'video-off'}
                                    title={this.props.videoMuted ? 'Start video' : 'Stop video'}
                                    onPress={() => {
                                        this.props.toggleVideoMute();
                                        this.setState({videoMenuVisible: false, menuVisible: false});
                                    }}
                                />
                            ) : null}
                            {typeof this.props.toggleMyVideo === 'function' ? (
                                <Menu.Item
                                    icon={this.state.enableMyVideo ? 'eye-off' : 'eye'}
                                    title={this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror'}
                                    /* Mirror only makes sense when there's a
                                       remote tile to see alongside — same
                                       rule as the camera picker's row in
                                       ConferenceBox. */
                                    disabled={!(Array.isArray(this.props.participants) && this.props.participants.length > 0)}
                                    onPress={() => {
                                        this.props.toggleMyVideo();
                                        this.setState({videoMenuVisible: false, menuVisible: false});
                                    }}
                                />
                            ) : null}
                            {typeof this.props.toggleAspectRatio === 'function' ? (
                                <Menu.Item
                                    icon="aspect-ratio"
                                    title="Toggle aspect ratio"
                                    onPress={() => {
                                        this.props.toggleAspectRatio();
                                        this.setState({videoMenuVisible: false, menuVisible: false});
                                    }}
                                />
                            ) : null}
                        </Menu>
                    ) : (
                        <Menu.Item
                            onPress={() => this.handleMenu('videoPicker')}
                            icon="video"
                            title="Video..."
                        />
                    ))}
                    {/* Divider just below the media-controls group —
                        suppressed in folded mode along with the items
                        above it. */}
                    {!this.props.isFolded ? <Divider /> : null}

                    {/* Extra breathing room above Hangup. Mirrors the
                        CallOverlay layout — the dropdown items are
                        tall enough that a fast double-tap after
                        dismissing one entry can land on the next
                        one, and for Hangup that means an accidental
                        conference termination, which is unrecoverable.
                        The Divider plus a 24-px spacer push Hangup
                        into its own visual zone at the bottom of
                        the menu. Both the Divider and the spacer are
                        also hidden in folded mode since the Hangup
                        item itself is hidden — leaving the divider
                        would bracket nothing. */}
                    {!this.props.isFolded ? <Divider /> : null}
                    {!this.props.isFolded ? <View style={{ height: 24 }} /> : null}
                    {/* Folded mode: hide Hangup from the kebab. On the
                        cover screen the audio-view bottom bar still
                        carries the hangup button, so removing the
                        duplicate from the overflow menu cleans up the
                        cramped UI per user request. */}
                    {!this.props.isFolded ? (
                        <Menu.Item onPress={() => this.handleMenu('hangup')} icon="phone-hangup" title="Hangup"/>
                    ) : null}
                </Menu>

			  </View>
			</Appbar.Header>
          </Fragment>
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
    // Distinct count of OTHER participants (excluding self / bridge),
    // computed in ConferenceBox from webrtc roster ∪ SIP roster. Used
    // only for the "N participants" / "nobody joined yet" subtitle.
    // The legacy `participants` prop on this same component carries
    // the webrtc-array form and is still used by the menu's
    // mirror-toggle disabled gate further down.
    participantsCount: PropTypes.number,
    // Server-authoritative conference duration anchor in seconds —
    // shifts the running timer's startTime backwards on first arrival
    // so the meter shows the true conference age rather than time
    // since the local user joined.
    serverDuration: PropTypes.number,
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
    // Opens the camera-picker overlay (renderVideoPicker on
    // ConferenceBox) from the kebab's "Video..." item. Same
    // panel the call-bar video button toggles, so the user sees
    // a consistent set of camera / mute / mirror / aspect ratio
    // controls regardless of entry point.
    openVideoPicker: PropTypes.func,
    // Opens the audio-device picker overlay
    // (renderAudioDevicePicker on ConferenceBox) from the kebab's
    // "Audio..." item. Same panel the call-bar audio device
    // button toggles.
    openAudioPicker: PropTypes.func,
    // Force-closes ALL device picker overlays
    // (audioDevicePickerVisible + videoPickerVisible) on
    // ConferenceBox. Invoked by the kebab toggle in the
    // Appbar.Action above so a second tap on the kebab clears
    // any picker the user opened from the previous tap.
    closeMediaPickers: PropTypes.func,
    // Video-mute state and toggle, used by the audio-view Video...
    // submenu's "Stop video / Start video" row. ConferenceBox
    // wires these alongside enableMyVideo / toggleMyVideo.
    videoMuted: PropTypes.bool,
    toggleVideoMute: PropTypes.func,
    // Current remote participants list. Used by the Video...
    // submenu to disable the Hide/Show mirror row when no
    // remote tile exists to view alongside.
    participants: PropTypes.array,
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

