import React, { Fragment } from 'react';
import { View, Text, Image } from 'react-native';
import DarkModeManager from '../DarkModeManager';
const _blinkLogo = require('../assets/images/blink-white-big.png');
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider } from 'react-native-paper';
import getMenuTheme from '../menuTheme';
import Icon from  '@react-native-vector-icons/material-design-icons';
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
            // Fresh-mount hygiene: only inherit the parent's
            // terminatedReason / startTime when this overlay mounts
            // onto an already-terminated call (the post-hangup summary
            // view). On a brand-new outgoing call the parent often
            // still carries the PREVIOUS call's values — its setState
            // clearing them races with the new call UI mounting — and
            // seeding them here painted the old call's fate ("Call
            // ended after X" / stale SIP reason) on the status line
            // during the pre-dial window, and a stale startTime made
            // the timer jump to the old call's elapsed time the moment
            // the new call established.
            terminatedReason: (this.props.call && this.props.call.state === 'terminated')
                ? this.props.terminatedReason : null,
            media: this.props.media ? this.props.media : 'audio',
            callState: this.props.call ? this.props.call.state : null,
            direction: this.props.call ? this.props.call.direction: null,
            startTime: (this.props.call && this.props.callState)
                ? this.props.callState.startTime : null,
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
        // Latch: has this overlay instance ever owned a live call
        // object? Until it does, the parent's terminatedReason /
        // callState.startTime props describe the PREVIOUS call and
        // must not be mirrored into state (see the generic-props
        // mirror in cWRP). Set once a call object exists at mount or
        // arrives via cWRP.
        this._everHadCall = !!this.props.call;
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

        // Fresh-appearance reset. Two triggers, both meaning "the user
        // is starting a new call attempt and any leftover state from a
        // previous call is no longer relevant":
        //
        //   • overlay just became visible (show flipped false → true)
        //     — they navigated into a call screen.
        //   • remoteUri changed to a different peer — even within the
        //     same overlay mount, this is a new conversation.
        //
        // Without this, the window BETWEEN the old call's hangup and
        // the new call's call object materialising (parent has call=null,
        // no new call object yet) falls into the render's
        // `!this.state.call` branch which checks this.finalDuration
        // first → renders "Call ended after Xs" using the previous
        // call's data. The existing cWRP block below only resets these
        // fields when a new call OBJECT arrives, which is too late —
        // the stale string already painted.
        const _overlayJustAppeared = !!nextProps.show && !this.props.show;
        const _remoteUriChanged = nextProps.remoteUri
                                  && nextProps.remoteUri !== this.state.remoteUri;
        if (_overlayJustAppeared || _remoteUriChanged) {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.duration = null;
            this.finalDuration = null;
            this.setState({
                terminatedReason: null,
                // Don't clobber callState if the new call's state is
                // already known — only clear if it was 'terminated' (a
                // leftover from the previous call).
                callState: this.state.callState === 'terminated' ? null : this.state.callState,
            });
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        // Did this cWRP pass swap the call object for a fresh one?
        // We track this so the GENERIC setState at the bottom doesn't
        // overwrite the per-call carry-overs we just reset (chiefly
        // terminatedReason: the parent's app.js often still has the
        // PREVIOUS call's terminatedReason in state when the new
        // call's props land here — its own setState to clear it races
        // with the new-call setState — and the generic setState below
        // used to clobber our null-reset with that stale value, so
        // the new call's first paint flashed "Call ended after X" or
        // a leftover SIP reason).
        let _callJustSwitched = false;

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
           console.log('Next call:', nextProps.call?.id);
           _callJustSwitched = true;
           this._everHadCall = true;

            if (this.state.call !== null) {
			   console.log('Previous call', this.state.call?.id);
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            if (nextProps.call  !== null) {
				nextProps.call.on('stateChanged', this.callStateChanged);
            }

            // Reset per-call diagnostic carry-overs so a brand-new call
            // doesn't briefly render the previous call's status line.
            //
            // Without this, when a fresh call object arrives in props
            // (back-to-back call, or a hangup-then-redial without
            // unmounting CallOverlay) the render path still sees:
            //   * this.duration   — last tick's "mm:ss" string from the
            //                       old call's timer (only cleared on
            //                       the old call's 'terminated' event,
            //                       which we may have already torn the
            //                       listener off of one line above)
            //   * this.finalDuration — set when the previous call
            //                       transitioned to 'terminated';
            //                       triggers "Call ended after X" in the
            //                       fallback branch
            //   * this.timer      — old setInterval still ticking against
            //                       the OLD state.startTime, which would
            //                       paint a wildly wrong number on every
            //                       tick until the new state.startTime
            //                       arrives
            //   * state.callState — last known state of the old call;
            //                       used by the 'terminated' branch to
            //                       render the stale "Call ended after"
            //                       /  state.terminatedReason strings
            //   * state.terminatedReason — propagated down from props
            //                       on every render until the parent
            //                       clears it; the _callJustSwitched
            //                       latch above keeps the generic
            //                       setState below from re-introducing
            //                       it on this same tick.
            // Clear them all in the same tick the new call lands so
            // the render BEFORE the new call's first stateChanged
            // event shows "Starting call..." / "Connecting..." instead
            // of leftovers from the previous one.
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.duration = null;
            this.finalDuration = null;

            this.setState({
                call: nextProps.call,
                direction: nextProps.call ? nextProps.call.direction : null,
                // Seed callState off the freshly arrived call object so
                // the very first render doesn't read the previous call's
                // last state (typically 'terminated'). The new call's
                // stateChanged listener (just attached above) will
                // refine this as soon as the actual state event fires.
                callState: nextProps.call.state || null,
                terminatedReason: null,
                // Reset startTime to whatever the parent's callState
                // has for this fresh call (likely null until established).
                startTime: nextProps.callState ? nextProps.callState.startTime : null,
            });
        }

        if ('showUsage' in nextProps && nextProps.showUsage !== undefined) {
			this.setState({showUsage: nextProps.showUsage});
        }

        if ('aspectRatio' in nextProps) {
			this.setState({aspectRatio: nextProps.aspectRatio});
        }

        // Build the generic-props mirror. When this cWRP pass swapped
        // the call object we deliberately drop terminatedReason from
        // the payload so the just-applied null reset above doesn't
        // get clobbered by the previous call's (still-set) parent
        // reason. Same logic for callState — the new call's identity
        // is now in state.call, and we'd rather keep the freshly
        // seeded nextProps.call.state from the reset block than mirror
        // any stale parent-side value.
        // Per-call fields (terminatedReason, startTime) are only
        // mirrored once this overlay instance has a live call to pin
        // them to. Before that (fresh mount, outgoing call still
        // dialing) the parent's values describe the PREVIOUS call —
        // app.js clears them asynchronously — and mirroring them
        // painted the old call's fate on the status line / fed the
        // old startTime to the duration timer.
        const _ownsCall = this._everHadCall || !!nextProps.call;
        const _genericUpdate = {
            remoteDisplayName: nextProps.remoteDisplayName,
            remoteUri: nextProps.remoteUri,
            media: nextProps.media,
            localMedia: nextProps.localMedia,
            startTime: (_ownsCall && nextProps.callState) ? nextProps.callState.startTime : null,
            isLandscape: nextProps.isLandscape,
            enableMyVideo: nextProps.enableMyVideo,
            availableAudioDevices: nextProps.availableAudioDevices,
            selectedAudioDevice: nextProps.selectedAudioDevice,
            insets: nextProps.insets
        };
        if (!_callJustSwitched && _ownsCall) {
            _genericUpdate.terminatedReason = nextProps.terminatedReason;
        }
        this.setState(_genericUpdate);
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
            case 'switchView':
                // Flip between the video and audio layouts for the same
                // call (Call.js.toggleCallView). The media isn't touched —
                // a video call keeps its video tracks live while we render
                // the audio screen, and switching back re-mounts VideoBox
                // onto the still-attached senders.
                if (typeof this.props.switchCallView === 'function') {
                    this.props.switchCallView();
                }
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
            case 'requestScreen':
                // Ask the peer to share THEIR screen. Unlike the two
                // location items above this one does NOT pop back to
                // the chat: the request is sent on the call itself
                // (application/sylk-screen-sharing) and both the
                // pending state and the accept/decline outcome are
                // rendered by VideoBox over the video, so there is
                // nothing to navigate to.
                if (typeof this.props.requestScreenShare === 'function') {
                    this.props.requestScreenShare();
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
            case 'showMediaInfo':
                // Surface the shared MediaInfoPanel diagnostic modal.
                // Owned by the parent (AudioCallBox / VideoBox) since
                // the panel needs direct access to the active sylkrtc
                // `call` and the per-call mediaStuck flag — same shape
                // as the existing "i" pill / round info button each
                // parent renders inline.
                if (typeof this.props.showMediaInfo === 'function') {
                    this.props.showMediaInfo();
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
            // Guard against a missing/invalid startTime. During a media-loss
            // reconnect the fresh call's callsState.startTime isn't seeded
            // yet, so this.state.startTime is null — and `new Date() - null`
            // evaluates to the current epoch in ms, i.e. a ~56000-year
            // "duration" that then renders as a giant call timer AND a bogus
            // "Call ended after …" final duration (finalDuration captures
            // this.duration at termination). Skip the tick until we have a
            // real start time; render falls through to "Reconnecting call…".
            if (!this.state.startTime) {
                this.duration = null;
                if (this.props.show) this.forceUpdate();
                return;
            }
            const duration = moment.duration(new Date() - this.state.startTime);
            // Was comparing the previous tick's STRING ("00:00", null,
            // etc.) against 3600 — always false, so we'd never switch
            // to the hh:mm:ss layout after an hour. Compare the
            // current duration's seconds value instead.
            if (duration.asSeconds() >= 3600) {
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
                callDetail = this.duration;
            } else {
                if (this.state.reconnectingCall) {
                    callDetail = 'Media lost. Reconnecting...';
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
                    // The setInterval that updates this.duration hasn't
                    // fired yet (it ticks once per second AFTER established).
                    // Compute a one-shot duration from startTime so the
                    // status line shows "00:00" instantly on call answer
                    // instead of the placeholder "Media established".
                    if (this.state.startTime) {
                        const d = moment.duration(new Date() - this.state.startTime);
                        callDetail = d.asSeconds() >= 3600
                            ? d.format('hh:mm:ss', {trim: false})
                            : d.format('mm:ss', {trim: false});
                    } else {
                        callDetail = '00:00';
                    }
                } else if (this.state.callState) {
                    callDetail = toTitleCase(this.state.callState);
                } else if (!this.state.call) {
                    // No live call object. This branch is reached in
                    // two distinct situations:
                    //   1. Initial dial — the user pressed call, the
                    //      sylkrtc Call hasn't been constructed yet.
                    //      Show "Starting call..." so the user knows
                    //      something is happening.
                    //   2. Post-hangup — the remote (e.g. Blink) hung
                    //      up before media established. The parent has
                    //      already cleared props.call, but the overlay
                    //      stays on screen for a few seconds for the
                    //      "call ended" transition. In that window we
                    //      DO know who the call was with (remoteUri /
                    //      remoteDisplayName are still in state from
                    //      when the call was alive) and we shouldn't
                    //      revert to the generic "Starting call..."
                    //      string — it makes the user think a NEW
                    //      call is being placed.
                    //
                    //  this.finalDuration => established then ended.
                    //  this.state.terminatedReason => SIP-side reason
                    //      preserved across the call→null transition.
                    if (this.finalDuration) {
                        callDetail = 'Call ended after ' + this.finalDuration;
                    } else if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else if (this.props.pushAcceptInProgress) {
                        // Cold-start push accept: we're in the
                        // _openPushAcceptGate window waiting for the
                        // sylkrtc Call to arrive via WSS. The
                        // displayName-based "Calling X…" branch below
                        // reads as an outbound dial; surface the
                        // incoming-accept semantics instead so the
                        // user knows their tap on the push notification
                        // is being honoured.
                        callDetail = 'Accepting call…';
                    } else if (displayName) {
                        // Outbound dial whose Call object hasn't
                        // materialised yet, but the parent has already
                        // told us who we're dialling. Surface the
                        // peer rather than the generic "Starting call".
                        callDetail = 'Calling ' + displayName + '…';
                    } else {
                        callDetail = 'Starting call...';
                    }
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

            // System-notification takeover of the status line. While a
            // NotificationCenter message is active (app.js mirrors it
            // into navbarSystemMessage and threads it here through
            // Call → AudioCallBox / VideoBox), show it on this second
            // line INSTEAD of the duration/state text — the exact
            // same treatment the main-screen NavigationBar gives its
            // subtitle line. When the message auto-dismisses the prop
            // goes back to null and the next render restores the
            // duration/state. The black bottom snackbar is suppressed
            // on /call by NotificationCenter's useNavbar prop.
            if (this.props.systemMessage) {
                callDetail = this.props.systemMessage;
            }

            // Title shown above the callDetail line. Always prefer the
            // peer's display name if known — even when media is null
            // (call just terminated, or hasn't established yet). The
            // old behaviour reverted to the generic "Audio call" the
            // moment the call object was cleared, which made a
            // post-hangup ended-call overlay show "Audio call" instead
            // of who the call was with for the 5-second termination
            // window. displayName is computed above from state.remoteUri
            // / state.remoteDisplayName, both of which survive the
            // call→null transition (they're merged in via
            // componentWillReceiveProps from nextProps.remote*).
            let mediaLabel = displayName || 'Audio call';
            
			const { width, height } = Dimensions.get('window');
	
			const topInset = this.state.insets.top || 0;
			const bottomInset = this.state.insets.bottom || 0;
			const rightInset = this.state.insets.right || 0;
			const leftInset = this.state.insets.left || 0;

			let myVideoTitle = this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror';
			let myUsageTitle = this.state.showUsage ? 'Hide bandwidth' : 'Show bandwidth';
			let myAspectRatio = this.state.aspectRatio == 'cover' ? 'Contain': 'Cover';
			myAspectRatio = 'Toggle aspect ratio';
			
			// Unified Sylk-blue background matching the main app navbar.
			// Kept slightly translucent (alpha 0.92) so a hint of the
			// underlying video / audio screen still bleeds through —
			// CallOverlay sits ON TOP of the call's media surface and
			// fully-opaque would feel detached. The Sylk blue is the
			// brand-spec Pantone Process Uncoated DS 211-3U =
			// #5476A5 (see DarkModeManager SYLK_BLUE_DEEP).
			let appBarContainer = {
				backgroundColor: 'rgba(67, 98, 148, 0.92)',
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
					// How far LEFT of the parent's content origin the
					// inner Appbar ends up after the negative margin
					// below. leftInsetOrigin parents (VideoBox) get
					// pulled an extra leftInset to the left, so the
					// bar starts at device x = -leftInset.
					const bledLeft = this.props.leftInsetOrigin ? leftInset : 0;
					appBarContainer.marginLeft = -(paperPad + bledLeft);  // leftInsetOrigin: parent's left edge is at screen-x=leftInset (SafeAreaView, e.g. in-call VideoBox), so add -leftInset to reach x=0. Edge-to-edge parents (audio) / already-bled parents (LocalMedia) pass falsy and get just -paperPad.
					// The bar starts at device x = -bledLeft, so to
					// reach the physical RIGHT edge (device x = width)
					// the box must be `width + bledLeft` wide. The old
					// `width - rightInset` stopped one right-inset short
					// of the edge — that's the gap reported on the iOS
					// video call in landscape (the notch-side inset
					// showed as a dark strip to the right of the navbar).
					appBarContainer.width = this.props.parentBledLeft ? (width + bledLeft) : (width - leftInset - rightInset);
					if (this.props.parentBledLeft) {
						// 4 = Paper's own styles.appbar
						// paddingHorizontal, which the style we pass
						// here would otherwise clobber — restate it so
						// nothing changes by accident.
						//
						// LEFT: deliberately NOT + leftInset. The bar's
						// background bleeds leftInset past the parent
						// origin, and padding the content back in by
						// the same amount visibly pushed the back arrow
						// inward (reported as "back button shifted
						// right by the iOS left inset"). The arrow
						// stays flush with the bar's own left edge.
						appBarContainer.paddingLeft = 4;
						// RIGHT: the bar now runs to the physical right
						// edge, so keep the kebab out of the notch /
						// nav-bar strip.
						appBarContainer.paddingRight = 4 + rightInset;
					}
				}
			} else {
				if (Platform.Version < 34) {
					appBarContainer.marginTop = 0;
				}
				// Android landscape: same problem as iOS — Paper's
				// Appbar.Header wraps the inner Appbar in a View that
				// applies paddingHorizontal: Math.max(left, right)
				// from the safe-area insets, and CallOverlay sits
				// inside the app-level SafeAreaView so its natural
				// origin is at device x=leftInset. Without
				// compensation the navbar starts at x=leftInset
				// (visible empty strip on the left) — even though
				// the video container behind it now stretches
				// edge-to-edge.
				if (this.state.isLandscape) {
					const paperPad = Math.max(leftInset, rightInset);
					// Same geometry as the iOS branch above — see the
					// comment there for why width has to grow by
					// bledLeft instead of shrinking by rightInset.
					const bledLeft = this.props.leftInsetOrigin ? leftInset : 0;
					appBarContainer.marginLeft = -(paperPad + bledLeft);  // leftInsetOrigin: parent's left edge is at screen-x=leftInset (SafeAreaView, e.g. in-call VideoBox), so add -leftInset to reach x=0. Edge-to-edge parents (audio) / already-bled parents (LocalMedia) pass falsy and get just -paperPad.
					appBarContainer.width = this.props.parentBledLeft ? (width + bledLeft) : (width - leftInset - rightInset);
					if (this.props.parentBledLeft) {
						// Left stays at Paper's default 4 (no
						// + leftInset) — see the iOS branch above.
						appBarContainer.paddingLeft = 4;
						appBarContainer.paddingRight = 4 + rightInset;
					}
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

                {/* Quick-access Swap video button — sits directly LEFT
                    of the kebab menu and performs the same action as
                    the kebab's "Swap video" row (handleMenu('swapVideo')
                    → this.props.swapVideo(), which flips the PIP
                    thumbnail and the full-screen video). Same gate as
                    that menu row: p2p VIDEO call, established. Icon
                    matches the menu row's camera-switch glyph so the
                    two surfaces read as the same action. When shown, it
                    takes over the 50 dp left separation the kebab
                    anchor otherwise carries (see the anchor style
                    below) so the pair sits snug without a dead gap
                    between them. */}
                {this.state.media === 'video'
                        && this.state.callState == "established"
                        && typeof this.props.swapVideo === 'function' ? (
                    <View style={{ marginLeft: 50 }}>
                        {this.props.remotePeerSharing ? (
                            /* Viewer: remote-pointer toggle in the navbar. */
                            <Appbar.Action
                                key={'co-pointer-' + _overlayRemountKey}
                                color={this.props.pointerMode ? '#4CAF50' : 'white'}
                                icon={this.props.pointerMode ? 'hand-back-right' : 'gesture-tap'}
                                accessibilityLabel="Remote pointer"
                                onPress={() => { if (typeof this.props.togglePointerMode === 'function') this.props.togglePointerMode(); }}
                            />
                        ) : this.props.screenSharing ? (
                            /* Sharer: stop screen share in the navbar. */
                            <Appbar.Action
                                key={'co-stopshare-' + _overlayRemountKey}
                                color="#E53935"
                                icon="monitor-off"
                                accessibilityLabel="Stop screen share"
                                onPress={() => { if (typeof this.props.stopScreenShare === 'function') this.props.stopScreenShare(); }}
                            />
                        ) : (
                            <Appbar.Action
                                key={'co-swap-' + _overlayRemountKey}
                                color="white"
                                icon="camera-switch"
                                accessibilityLabel="Swap video"
                                onPress={() => this.handleMenu('swapVideo')}
                            />
                        )}
                    </View>
                ) : null}

                <Menu theme={getMenuTheme().menuTheme}
                    visible={this.state.menuVisible}
                    onDismiss={() => this.setState({menuVisible: false})}  // was a toggle: a dismiss while already-closed flipped it back open, so the kebab needed several taps to land open
                    contentStyle={styles.roundedMenu}
                    anchor={
                    /* marginLeft 50 separates the kebab from the title
                       block — but when the quick-access Swap button is
                       rendered (video + established) the separation
                       moves onto THAT button's wrapper instead, so the
                       kebab sits flush next to it. */
                    <View style={{ marginLeft: (this.state.media === 'video'
                            && this.state.callState == "established"
                            && typeof this.props.swapVideo === 'function') ? 0 : 50 }}>
                        <Appbar.Action
                            key={'co-menu-' + _overlayRemountKey}
                            ref={this.menuRef}
                            color="white"
                            icon="menu"
                            onPress={() => { console.log('[menu] call-screen kebab clicked; menuVisible', this.state.menuVisible, '->', !this.state.menuVisible); this.setState({menuVisible: !this.state.menuVisible}); }}
                        />
                        </View>
                    }
                >
					{this.state.media === 'video' && this.state.callState == "established" && (
					<>
                    <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('myVideo')} icon="video" title={myVideoTitle} disabled={this.props.remotePeerSharing} />
                    <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('aspectRatio')} icon="video" title={myAspectRatio} />
                    <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('swapVideo')} icon="camera-switch" title={'Swap video'} disabled={this.props.remotePeerSharing} />
                    <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleUsage')} icon="network" title={myUsageTitle} disabled={this.props.remotePeerSharing} />
                    {/* Switch to the audio call layout without dropping
                        video — the call keeps its video tracks; only the
                        on-screen component changes. */}
                    {typeof this.props.switchCallView === 'function' && (
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('switchView')} icon="phone" title={'Switch to audio view'} disabled={this.props.remotePeerSharing} />
                    )}
					<Divider />
					</>
                    )}

					{/* Audio layout shown over a call that actually carries
						video (the user picked "Switch to audio view"). Offer
						the way back to the video layout. callHasVideo is
						false on a genuine audio-only call, so this stays
						hidden there. */}
					{this.state.media !== 'video'
						&& this.props.callHasVideo
						&& this.state.callState == "established"
						&& typeof this.props.switchCallView === 'function' && (
						<Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('switchView')} icon="video" title={'Switch to video view'} disabled={this.props.remotePeerSharing} />
					)}
			
					<Menu theme={getMenuTheme().menuTheme}
						visible={this.state.audioMenuVisible}
						onDismiss={() => this.setState({audioMenuVisible: false})}
						contentStyle={styles.roundedMenu}
						anchor={
							<Menu.Item theme={getMenuTheme().menuTheme}
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
								<Menu.Item theme={getMenuTheme().menuTheme}
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
						<Menu.Item theme={getMenuTheme().menuTheme}
							onPress={() => this.handleMenu('dtmf')}
							icon="dialpad"
							title="Dialpad..."
						/>
					)}

					{/* Media info — opens the shared MediaInfoPanel
						diagnostic modal owned by the parent
						(AudioCallBox / VideoBox). Same destination as
						the inline round "i" pill each parent renders
						near the speedometer; surfacing it in the
						kebab makes the diagnostic reachable without
						having to find the small pill on a busy call
						surface. Shown for both audio and video calls
						whenever the parent wires up showMediaInfo. */}
					{typeof this.props.showMediaInfo === 'function' && this.state.callState == "established" && (
						<Menu.Item theme={getMenuTheme().menuTheme}
							onPress={() => this.handleMenu('showMediaInfo')}
							icon="information-outline"
							title="Media info..."
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
					  || typeof this.props.requestLocationFromCall === 'function'
					  || typeof this.props.requestScreenShare === 'function') && (
						<>
							<Divider />
							{typeof this.props.goBackFunc === 'function' ? (
								<Menu.Item theme={getMenuTheme().menuTheme}
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
								  || typeof this.props.requestLocationFromCall === 'function'
								  || typeof this.props.requestScreenShare === 'function') ? (
								<Divider />
							) : null}
							{typeof this.props.shareLocationFromCall === 'function' ? (
								<Menu.Item theme={getMenuTheme().menuTheme}
									onPress={() => this.handleMenu('shareLocation')}
									icon="map-marker"
									title="Share location..."
								/>
							) : null}
							{typeof this.props.requestLocationFromCall === 'function' ? (
								<Menu.Item theme={getMenuTheme().menuTheme}
									onPress={() => this.handleMenu('requestLocation')}
									icon="map-marker-question"
									title="Request location"
								/>
							) : null}
							{/* Ask the peer to share their screen. Sits next
								to "Request location" because it is the same
								kind of action — a request the far side must
								accept — rather than up in the video block,
								which is all local view controls.

								Also capability-gated: VideoBox passes
								requestScreenShare as undefined unless the peer
								advertised screen-sharing support at call setup
								(components/CallCapabilities.js), so this item
								never appears against an older client that
								would silently ignore the request.

								Video only, and only once the call is up:
								the share is delivered by replacing the track
								on the existing video sender, so there has to
								be one. Hidden while EITHER side is already
								sharing — the peer's screen is already on
								screen in the first case, and in the second
								our own capture owns the sender, so asking
								them to share too has no meaning. Disabled
								(not hidden) while a request is in flight, so
								the menu doesn't reflow under the user's
								finger and the label can report the state. */}
							{this.state.media === 'video'
							  && this.state.callState == "established"
							  && typeof this.props.requestScreenShare === 'function'
							  && !this.props.remotePeerSharing
							  && !this.props.screenSharing ? (
								<Menu.Item theme={getMenuTheme().menuTheme}
									onPress={() => this.handleMenu('requestScreen')}
									icon="monitor-share"
									title={this.props.screenRequestPending
										? 'Requesting screen\u2026'
										: 'Request screen'}
									disabled={!!this.props.screenRequestPending}
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
                    <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('hangup')} icon="phone-hangup" title="Hangup"/>

                </Menu>

				</Appbar.Header>
			);
        }
        // Wrap the Appbar with a slim Sylk logo + "Sylk Mobile"
        // brand strip above it — same shape as the main
        // NavigationBar. Sits BELOW the OS status bar (no negative
        // marginTop), and we neutralise the Appbar's own
        // marginTop:-topInset below so the Appbar doesn't pull up
        // behind the strip. Hidden in landscape to reclaim vertical
        // pixels on the call surface.
        if (!header) return null;
        if (this.state.isLandscape) return header;
        // In-call brand strip disabled — same decision as the main
        // NavigationBar (_showBrandStrip = false there): the strip is
        // decorative and eats vertical space on the call surface, and
        // with the main-screen strip gone it read as a stray "Blink"
        // band appearing only during calls. Returning the bare header
        // here matches the landscape path above, so the Appbar keeps
        // its own marginTop/inset handling exactly as before the
        // strip existed. Flip to true to restore the logo strip.
        const _showCallBrandStrip = false;
        if (!_showCallBrandStrip) return header;
        const _stripLeftInset = this.state.insets.left || 0;
        // In-call brand strip is intentionally pinned to the DARK
        // (Night) palette regardless of the active theme. The call
        // surface itself (audio/video) is dark, so a white Day-theme
        // strip across the top reads as a jarring bright band above
        // the call. We keep the literals here in sync with
        // NIGHT_THEME.brandStripBackground / brandStripText in
        // DarkModeManager.js — if you re-skin Night mode, mirror the
        // change here. Other dimensions (height 34 / 22×22 logo / 14px
        // text) still match the main NavigationBar strip so the in-
        // call chrome has the same shape as the rest of the app.
        const _CALL_STRIP_BG   = '#121212';
        const _CALL_STRIP_TEXT = '#FFFFFF';
        const _stripStyle = {
            backgroundColor: _CALL_STRIP_BG,
            height: 34,
            paddingLeft: 12,
            paddingRight: 12,
            flexDirection: 'row',
            alignItems: 'center',
            // No negative marginTop — the strip must sit UNDER the
            // OS status bar, not overlap it.
            width: Dimensions.get('window').width,
            zIndex: 1000,
            elevation: 10,
        };
        return (
            <Fragment>
                <View style={_stripStyle}>
                    <Image source={_blinkLogo} style={{ width: 22, height: 22, marginRight: 8, marginLeft: _stripLeftInset }} />
                    <Text style={{ color: _CALL_STRIP_TEXT, fontSize: 14, fontWeight: '400' }}>Blink</Text>
                </View>
                {React.cloneElement(header, {
                    // statusBarHeight={0} suppresses Paper's internal
                    // safe-area-top padding which would otherwise
                    // leave a topInset-tall empty band between the
                    // brand strip and the Appbar's actual content.
                    // The brand strip already lives in that region,
                    // so the Appbar needs no further offset.
                    style: [header.props.style, { marginTop: 0 }],
                    statusBarHeight: 0,
                })}
            </Fragment>
        );
    }
}

CallOverlay.propTypes = {
    show: PropTypes.bool.isRequired,
    systemMessage: PropTypes.string,
    remoteUri: PropTypes.string,
    localMedia: PropTypes.object,
    remoteDisplayName: PropTypes.string,
    pushAcceptInProgress: PropTypes.bool,
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
    // Ask the peer to share their screen (video calls only). Wired by
    // VideoBox, and only when the peer advertised screen-sharing
    // support; absent on AudioCallBox and against older peers, which
    // hides the menu item entirely (every item in that group is gated
    // on `typeof prop === 'function'`, so undefined is the off switch).
    // screenRequestPending greys it out while a request is in flight.
    requestScreenShare: PropTypes.func,
    screenRequestPending: PropTypes.bool,
    // True while WE are sharing our screen / the PEER is sharing
    // theirs. Both hide the "Request screen" item.
    screenSharing: PropTypes.bool,
    remotePeerSharing: PropTypes.bool,
    // Optional: opens the DTMF dialpad modal owned by AudioCallBox.
    // When omitted (e.g. on video calls or while the modal is being
    // wired up by another caller), the menu item is hidden.
    showDtmfFunc: PropTypes.func,
    showMediaInfo: PropTypes.func,
    // Switch between the audio and video layouts for the same call
    // without renegotiating media. callHasVideo gates the audio-view
    // "Switch to video view" item (true only when the call actually
    // carries video).
    switchCallView: PropTypes.func,
    callHasVideo: PropTypes.bool,
};

export default CallOverlay;
