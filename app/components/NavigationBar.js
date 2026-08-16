import React, { Component, Fragment } from 'react';
import { Alert, Animated, AppState, Easing, Linking, Image, Platform, PermissionsAndroid, View , TouchableHighlight, Dimensions, ActivityIndicator} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button, ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import getMenuTheme from '../menuTheme';
import Icon from  '@react-native-vector-icons/material-design-icons';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Keyboard } from 'react-native';
import uuid from 'react-native-uuid';
import utils from '../utils';

// BackgroundTimer + Geolocation are no longer imported here (Stage 4b-6): the
// only remaining use — releasing OS timer/GPS handles on unmount — moved to the
// app-hosted engine (this._locationEngine.releaseTimerHandles()).

// The Android location foreground-service bridge is owned by the location
// engine (LocationSharingManager) now (Stage 4b); NavigationBar had a dead
// copy of the module handle that was never called, so it was removed.

// =====================================================================
// DEBUG: location simulator (single menu entry).
//
// A single "Start simulator" / "Stop simulator" item appears in the
// chat-header kebab, inside the Location section (above its divider),
// while a share is active for the selected contact AND the "Location
// simulator" preference (Preferences → Location) is on. Tapping it
// replaces the real GPS source with a synthetic walker chosen by the
// ACTIVE share's mode:
//   • "Until I return"        → 10-tick out-and-back that trips the
//                               return auto-stop gate
//   • meet-up (request/accept) → convergence walker toward the meet
//                               destination
//   • share-by-interval/fixed → outward random walk that meanders
//                               until stopped
// One-shot shares (no trail) are excluded. The walkers themselves and
// their SIM_* / RANDOM_WALK_* tuning constants live in
// LocationSimulator.js; the preference is threaded through as a live
// getter so toggling it takes effect without a rebuild.
// =====================================================================

const blinkLogo = require('../assets/images/blink-white-big.png');

import NavigationBarModals from './NavigationBarModals';
import {openSettings, check, request, PERMISSIONS, RESULTS} from 'react-native-permissions';
import SylkAppbarContent from './SylkAppbarContent';
import DarkModeManager from '../DarkModeManager';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from '../gravatar';
import * as Progress from 'react-native-progress';
// `storage` (AsyncStorage wrapper) was previously used here to
// persist live-share state under a single global key. That state
// has moved to the per-account `accounts.app_state` SQL column,
// reached via the readAppStateNamespace / writeAppStateNamespace
// props passed in from app.js. The storage import is intentionally
// gone so we don't accidentally re-introduce a global key here.
import {
    readAcknowledged as readLocationDisclosure,
    setAcknowledged as setLocationDisclosure,
    clearAcknowledged as clearLocationDisclosure,
} from './locationDisclosure';

// In-flight share state used to live in AsyncStorage under a single
// global key (`activeLocationShares.v1`). It now lives per-account
// in the SQL `accounts.app_state` column, reached via the
// readAppStateNamespace / writeAppStateNamespace props on this
// component. The legacy AsyncStorage key is wiped at app boot
// (app.js _wipeLegacyAppStateAsyncStorage). See _persistActiveShares /
// _loadAndResumeActiveShares for the read-write pair that keeps
// in-flight shares alive across app restarts (graceful or hard kill).

import styles from '../assets/styles/NavigationBar';
// LocationSimulator + LocationSharingManager are app-owned now (Stage 4b-5);
// NavigationBar borrows the engine via this.props.app._locationEngine and no
// longer constructs either, so their imports were removed.
import { LocationSharingContext } from './LocationSharingContext';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.refetchMessagesForDays = 0;

        // Location tick cadence and "Until I return" thresholds now live on
        // the app (this.app.LOCATION_REPEAT_MS / UNTIL_RETURN_*), which the
        // engine reads directly (Stage 4b). NavigationBar no longer holds them.

        // Map<uri, { intervalId, expiresAt }>  — tracks an active
        // "share location" timer per contact so the user can run
        // several shares in parallel and we can cancel them cleanly.
        //
        // OWNERSHIP: this registry is owned by the LocationSharingManager engine
        // (this._locationEngine.outgoingLocationSessions), which the app exposes
        // here by reference via the outgoingLocationSessionsRef prop. NavigationBar
        // only BORROWS it for read-only pulse/menu checks — it does not own or
        // mutate the list; all mutations happen in the engine. The engine creates
        // the object once and never reassigns it, so this borrowed reference stays
        // valid for the component's whole life. Fallback to a fresh object only if
        // the prop is somehow absent (defensive; the app always passes it).
        this.outgoingLocationSessions = (props && props.outgoingLocationSessionsRef) || {};

        // Map<uri, {durationMs, periodLabel, opts, registeredAt}>
        //   — share-start intents that were deferred because the
        //   OS-level location permission wasn't sufficient at tap-
        //   time. Populated from the early-return paths inside
        //   startLocationSharing (blocked / denied / Settings-bound
        //   dialogs) and drained by _onAppStateChange when the app
        //   foregrounds. The intent is: once the user has tapped
        //   "Accept" / "Meet up" / "Confirm" we treat that as
        //   commitment — they shouldn't have to tap a second time
        //   after granting permission in Settings. The drain re-
        //   probes the OS permission and auto-resumes the share if
        //   it's now sufficient.
        //
        // Cleared:
        //   • on successful auto-resume (drain),
        //   • when an explicit start via startLocationSharing succeeds
        //     for the same uri (so a manual retry doesn't queue a
        //     parallel automatic one),
        //   • when stopLocationSharing is invoked for the uri (user
        //     explicitly cancelled the pending share),
        //   • when a meeting-accept's underlying request expires,
        //   • on componentWillUnmount.
        //
        // OWNERSHIP: this map now lives on the app (this.app._pendingPermission
        // Shares); the engine reads/writes it there (Stage 3a). NavigationBar
        // no longer holds it.

        this.state = {
            showPublicKey: false,
            menuVisible: false,
            keyMenuVisible: false,
            storageMenuVisible: false,
            settingsMenuVisible: false,
            showDeleteFileTransfers: false,
            showEditContactModal: false,
            showPreferencesModal: false,
            showExportDataModal: false,
            showRefetchMessagesModal: false,
            // Live measurement of the Appbar.Header height (set by
            // its onLayout below). Plumbed down to ReadyBox →
            // ContactsListBox → KeyboardAvoidingView's
            // keyboardVerticalOffset so the offset always matches the
            // actual chrome above the chat instead of guessing 60dp.
            // null until the first layout pass; consumers fall back
            // to 60 in the meantime.
            appBarMeasuredHeight: null,
            // Opened from the EditContactModal "Delete account" link when
            // myself=true. Confirms & then calls props.deleteAccount() to
            // wipe this account from the device and sign out.
            showDeleteAccountModal: false,
            // Confirmation dialog opened from the menu "Sign out" item.
            // When more than one stored account is available it also
            // offers to switch to one of them; otherwise it just acts
            // as a logout confirmation. See SwitchAccountModal.
            showSwitchAccountModal: false,
			showGenerateKeysModal: false,
			showExportPrivateKeyModal: false,
            privateKeyPassword: null,
			backupKey: false,
			deleteContact: false,
			showShareLocationModal: false,
			// Target contact + its live session types for the OPEN share picker,
			// captured at modal-open time (showShareLocationModal) and refreshed
			// by _onLocationSessionsChanged while open. The modal reads liveTypes
			// from here so a selectedContact that flickers null mid-render can't
			// drop the disabled-options state.
			shareModalUri: null,
			shareLiveTypes: null,
			// OS location grant level for the open share picker, probed in
			// showShareLocationModal and refreshed on app-foreground via
			// refreshShareLocationPermissionLevel. Passed to
			// ShareLocationModal as `permissionLevel` so it can restrict the
			// picker to "Once" under a foreground-only ("While Using") grant.
			// null = unknown → don't gate (also the meet-me entry paths,
			// which open the modal without probing permission).
			shareLocationPermissionLevel: null,
			// Optional user-location preview shown on the destination
			// preview map inside ShareLocationModal — kicked off as a
			// fire-and-forget getCurrentCoordinates() call when the
			// modal opens (see showShareLocationModal). The picked
			// privacy radius is rendered as a circle around this
			// point so the user can see how big the hidden zone will
			// be relative to the destination. Cleared on
			// hideShareLocationModal so a stale fix doesn't leak
			// into the next open with a different destination.
			previewUserLocation: null,
			// Mirror of accounts.app_state.location.disclaimerSuppressed
			// for the currently signed-in account. When true, the
			// share-location modal hides its data-usage disclaimer
			// paragraph and the "Do not show this again" checkbox.
			// Hydrated by _hydrateDisclaimerSuppression() once
			// props.accountId is bound and re-loaded on account-switch.
			// Persisted via _suppressShareLocationDisclaimer() the
			// moment the user confirms a share with the box ticked,
			// and cleared by the privacy-policy opt-out path so the
			// legal text re-appears the moment the contract is
			// revoked.
			shareDisclaimerSuppressed: false,
			// Pre-filled destination for the next share session.
			// Populated by `meetMeAt(uri, coords)` (called from a
			// chat-bubble's "Meet me there..." kebab on a Google
			// Maps link). The duration picker opens with the
			// meet-up flow auto-selected and `onShareLocationConfirmed`
			// consumes this state to stamp `destination` onto every
			// outgoing tick. Cleared when the modal closes (confirm
			// or cancel) so the next casual Share location tap
			// doesn't accidentally inherit yesterday's destination.
			pendingShareDestination: null,
			// Google Play "Prominent Disclosure" gate. Set to a {resolve}
			// promise resolver while the LocationPrivacyDisclosureModal is
			// up; cleared back to null when the user taps Continue or
			// Cancel. _ensureLocationDisclosureAcknowledged below awaits
			// the resolver so the share / permission flow blocks until
			// the user has decided.
			locationDisclosurePending: null,
			// Mirrors the per-account AsyncStorage key
			// 'locationDisclosureAcknowledged.v2.<accountId>' (see
			// locationDisclosure.js) in component state so render()
			// can branch synchronously on the consent state. Read once
			// at mount; updated by the share-flow's onContinue, the
			// viewer's onOptOut, and the viewer's onContinue (when
			// invoked from the not-yet-agreed branch). Also re-read in
			// componentDidUpdate when props.accountId changes, so
			// switching SIP identities doesn't carry stale consent
			// state across accounts. This is what keeps the
			// "Location privacy policy..." menu item visible
			// regardless of contact / chat state once the user has
			// consented — they should always be able to revisit /
			// withdraw.
			locationDisclosureAcknowledged: false,
			// Map<uri, expiresAtMs> — mirrors `this.outgoingLocationSessions` in
			// state so the menu can re-render when a share starts or stops.
			// Controls the new ActiveLocationSharesModal that lists every
			// active share and lets the user stop one or all of them from
			// a single place. Opened by tapping the pulsing map-marker
			// indicator in the NavBar (see render below).
			showActiveSharesModal: false,
			// Optional URI to scope the ActiveLocationSharesModal to a
			// single peer. Set by the ReadyBox chat-header "pin" button
			// so opening it from within a chat shows only that chat's
			// share; the NavBar indicator leaves it null so the modal
			// lists every active share. Cleared on close.
			activeSharesFilterUri: null,
			showExportPrivateKeyModal: this.props.showExportPrivateKeyModal,
			showCallMeMaybeModal: this.props.showCallMeMaybeModal,
			// Warmup phase tracking — surfaced in the Appbar subtitle so
			// the user gets continuous feedback during the (sometimes
			// multi-second) window between tapping Accept/Dial and the
			// call reaching 'established'. Each field tracks one signal:
			//   • _warmupCallState — sylkrtc Call.state ('incoming',
			//     'progress', 'accepted', 'established', 'terminated').
			//     Updated from a stateChanged listener attached in
			//     _attachCallWarmup; falls back to props.call.state on
			//     mount.
			//   • _warmupIceConn / _warmupGather / _warmupConn — sampled
			//     off call._pc on a 500 ms interval while warming. Stops
			//     once 'established' or when there's no call.
			// All four start null so render() can detect a fresh state.
			_warmupCallState: null,
			_warmupIceConn: null,
			_warmupGather: null,
			_warmupConn: null,
        }

        this.menuRef = React.createRef();

        // Drives the pulsing opacity of the NavBar "active location
        // shares" indicator. We keep the animation primitive (not
        // useNativeDriver: true because we're animating opacity on a
        // View that hosts Paper's IconButton; native driver is fine
        // here and keeps the loop cheap). The loop is started when
        // the first share becomes active and stopped when the last
        // share is torn down (see componentDidUpdate).
        this._activeSharePulse = new Animated.Value(1);
        this._activeSharePulseLoop = null;

        // DEBUG: meet-up convergence simulator (gated on
        // ENABLE_MEET_SIMULATION). Owns its own _simStates map and the
        // walker timers; it reaches the live session through these
        // injected accessors so it has no direct coupling to component
        // internals beyond the location-session entry it walks. Gated
        // here too — when disabled, start() is a no-op and the simulator
        // never installs a simulatedPosition, so the tick path falls
        // straight through effectiveCoordinatesForSession().
        // Location-sharing engine. As of Stage 4b-5 the engine is HOSTED BY THE
        // APP; NavigationBar BORROWS that single instance so its ~50 delegating
        // stubs (see the "Location engine delegating stubs" section below) keep
        // working, and registers itself as the engine's VIEW (engine.ui = this)
        // so the engine can reflect UI — the share/preview modal, the pulse —
        // via its guarded _ui* helpers. The view registration is cleared in
        // componentWillUnmount. (The simulator + engine.sim wiring are set on
        // the app side.)
        this._locationEngine = this.props.app && this.props.app._locationEngine;
        if (this._locationEngine) {
            this._locationEngine.navbar = this;
        }
    }

    _startActiveSharePulse() {
        if (this._activeSharePulseLoop) return;
        try {
            const _s = Object.keys(this._activeShares() || {});
            const _t = Object.keys(this.outgoingLocationSessions || {});
            //utils.timestampedLog('[location] pulse START | activeLocationShares=', JSON.stringify(_s), '| timers=', JSON.stringify(_t), '| callActive=', !!this.props.callActive);
        } catch (e) { /* diagnostic only */ }
        // Two-phase opacity ramp: full -> dim -> full, each phase
        // 700ms so the marker visibly breathes without being
        // distracting. Easing.inOut(sine) keeps the transition soft.
        this._activeSharePulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(this._activeSharePulse, {
                    toValue: 0.35,
                    duration: 700,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
                Animated.timing(this._activeSharePulse, {
                    toValue: 1,
                    duration: 700,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
            ])
        );
        this._activeSharePulseLoop.start();
    }

    _stopActiveSharePulse() {
        try {
            const _s = Object.keys(this._activeShares() || {});
            const _t = Object.keys(this.outgoingLocationSessions || {});
            //utils.timestampedLog('[location] pulse STOP | activeLocationShares=', JSON.stringify(_s), '| timers=', JSON.stringify(_t), '| wasRunning=', !!this._activeSharePulseLoop);
        } catch (e) { /* diagnostic only */ }
        if (this._activeSharePulseLoop) {
            this._activeSharePulseLoop.stop();
            this._activeSharePulseLoop = null;
        }
        // Reset to full opacity in case the indicator briefly stays
        // mounted during the next render cycle.
        this._activeSharePulse.setValue(1);
    }

    // ---- Call warmup tracking -------------------------------------------
    //
    // The Appbar subtitle normally shows the account URI / organization
    // line. While a call is warming up we hijack it to surface the
    // current phase ("Acquiring mic…", "Gathering candidates…",
    // "Collecting ICE candidates…", …) so the user isn't left staring at a
    // static label for the multi-second window between
    // accept/dial and 'established'.
    //
    // Three independent signals are stitched together:
    //   1. sylkrtc Call.state — from a 'stateChanged' listener on
    //      this.props.call. Updates instantly on SIP-level transitions.
    //   2. local media — from props.localMedia (set by app.js after
    //      getUserMedia resolves). No listener needed; React re-renders
    //      when the prop changes.
    //   3. RTCPeerConnection (call._pc) iceGatheringState /
    //      iceConnectionState / connectionState — polled on a 500 ms
    //      interval. The native bridge doesn't fan out these events
    //      to JS in a stable way, so polling is the portable option.
    //
    // _attachCallWarmup wires up (1) and (3) for a given Call. It is
    // safe to call repeatedly with the same call (idempotent via the
    // _warmupAttachedCall identity check). _detachCallWarmup tears the
    // listener + interval down. componentDidMount / componentDidUpdate
    // / componentWillUnmount orchestrate which call is attached.
    _attachCallWarmup(call) {
        if (!call || this._warmupAttachedCall === call) {
            return;
        }
        // Replace any previously-attached call before binding the new one
        // so we never end up with stale listeners across an outgoing→
        // incoming swap inside the same NavBar mount.
        this._detachCallWarmup();
        this._warmupAttachedCall = call;
        // Seed initial state synchronously so the very first render
        // after attach already reflects whatever the call object knew.
        const initialState = call.state || null;
        this.setState({
            _warmupCallState: initialState,
            _warmupIceConn: null,
            _warmupGather: null,
            _warmupConn: null,
        });
        try {
            this._warmupStateListener = (oldS, newS /*, data*/) => {
                if (this._unmounted) return;
                this.setState({ _warmupCallState: newS });
                if (newS === 'established' || newS === 'terminated') {
                    // Stop polling — once established the subtitle
                    // falls back to its normal contact URI and the
                    // poll loop has no UI to drive.
                    this._stopWarmupPoll();
                }
            };
            call.on('stateChanged', this._warmupStateListener);
        } catch (e) { /* call may already be torn down — non-fatal */ }
        // Start polling _pc state. Even if _pc isn't there yet (sylkrtc
        // sometimes lazy-creates it after the first INVITE), the poll
        // re-checks every tick.
        this._startWarmupPoll();
    }

    _detachCallWarmup() {
        const call = this._warmupAttachedCall;
        if (call && this._warmupStateListener) {
            try { call.removeListener('stateChanged', this._warmupStateListener); }
            catch (e) { /* noop */ }
        }
        this._warmupStateListener = null;
        this._warmupAttachedCall = null;
        this._stopWarmupPoll();
        // Clear the rendered warmup so a fresh call's first render
        // doesn't briefly inherit the previous call's substate.
        if (this.state._warmupCallState
                || this.state._warmupIceConn
                || this.state._warmupGather
                || this.state._warmupConn) {
            this.setState({
                _warmupCallState: null,
                _warmupIceConn: null,
                _warmupGather: null,
                _warmupConn: null,
            });
        }
    }

    _startWarmupPoll() {
        if (this._warmupPollTimer) return;
        const POLL_MS = 500;
        const tick = () => {
            if (this._unmounted) return;
            const call = this._warmupAttachedCall;
            const pc = call && call._pc;
            if (!pc) return;
            // Only call setState when something actually changed —
            // every NavBar re-render walks a fair amount of JSX and
            // we don't need to pay that cost twice a second when
            // nothing moved.
            const ice = pc.iceConnectionState || null;
            const gather = pc.iceGatheringState || null;
            const conn = pc.connectionState || null;
            if (ice !== this.state._warmupIceConn
                    || gather !== this.state._warmupGather
                    || conn !== this.state._warmupConn) {
                this.setState({
                    _warmupIceConn: ice,
                    _warmupGather: gather,
                    _warmupConn: conn,
                });
            }
            // Once the PC reports a stable end-state, the poller can
            // stop on its own — the SIP-level 'established' transition
            // would do the same, but on cross-network calls the PC
            // sometimes flips to 'connected' a beat before sylkrtc
            // raises the state change.
            if (ice === 'connected' || ice === 'completed'
                    || conn === 'connected') {
                this._stopWarmupPoll();
            }
        };
        // Fire once immediately so the subtitle picks up the initial
        // PC values rather than waiting POLL_MS for the first read.
        tick();
        this._warmupPollTimer = setInterval(tick, POLL_MS);
    }

    _stopWarmupPoll() {
        if (this._warmupPollTimer) {
            clearInterval(this._warmupPollTimer);
            this._warmupPollTimer = null;
        }
    }

    // Build the human-readable subtitle for the current warmup phase.
    // Returns null when nothing should be overridden (no call, or the
    // call has reached 'established' / 'terminated'). The branches are
    // ordered so the MOST informative signal wins: PC connected /
    // gathered states trump pure SIP states, and the local-media
    // acquisition gate beats both early on.
    _warmupSubtitle() {
        const call = this.props.call;
        if (!call) return null;
        // Prefer the LIVE call state for terminal states. The cached
        // _warmupCallState can be stale (e.g. frozen at 'incoming' if the
        // 'terminated' stateChanged didn't reach our listener after a push
        // reject), and `_warmupCallState || call.state` would let that stale
        // value mask a real 'terminated'/'established' — leaving a "Collecting
        // ICE candidates…" label up long after the call ended.
        const _liveState = call.state;
        const cs = (_liveState === 'terminated' || _liveState === 'established')
            ? _liveState
            : (this.state._warmupCallState || _liveState);
        if (!cs || cs === 'established' || cs === 'terminated') {
            return null;
        }
        // No live peer connection means no ICE work is in progress. The poller
        // freezes its last sample when _pc goes away (closed on reject/
        // terminate), so ignore those stale ICE/gather/conn values rather than
        // showing a phantom "Collecting ICE candidates…".
        const _pcLive = !!call._pc;
        // Local media not yet acquired — for an outgoing call this is
        // the first thing the user is waiting on; for an incoming call
        // it gates between tapping Accept and the answer SDP firing.
        if (!this.props.localMedia
                && (cs === 'progress' || cs === null
                    || cs === 'incoming' || cs === 'accepted')) {
            // 'incoming' shouldn't normally surface (the alert panel
            // is up), but cover it for completeness.
            if (cs !== 'incoming') {
                return 'Acquiring mic…';
            }
        }
        const ice = _pcLive ? this.state._warmupIceConn : null;
        const gather = _pcLive ? this.state._warmupGather : null;
        const conn = _pcLive ? this.state._warmupConn : null;
        // PC reports a failure — surface it rather than the optimistic
        // SIP state.
        if (ice === 'failed' || conn === 'failed') {
            return 'Connection failed';
        }
        if (ice === 'checking' || conn === 'connecting') {
            return 'Collecting ICE candidates…';
        }
        if (gather === 'gathering') {
            return 'Gathering candidates…';
        }
        // Fall back to the SIP-level state when we haven't seen any PC
        // signal yet. 'progress' = remote is ringing, 'accepted' = SDP
        // exchanged, 'incoming' = ringing locally.
        if (cs === 'progress') return 'Ringing…';
        if (cs === 'accepted') return 'Establishing media…';
        if (cs === 'incoming') return 'Incoming call…';
        return null;
    }

    componentDidMount() {
        // If NavigationBar mounts while a call is already in progress
        // (e.g. user tapped the chat icon mid-call, which routes to
        // /ready and remounts this component), componentDidUpdate's
        // false→true transition never fires for `inCall` — we missed
        // the edge. Same for active location shares present at mount
        // time. Kick the pulse loop here so the indicator actually
        // breathes from the first frame, not just from the next state
        // change.
        const sharesAtMount = Object.keys(this.getActiveSharesForModal()).length;
        this._lastPulseShareCount = sharesAtMount;
        if (this.props.callActive || sharesAtMount > 0) {
            this._startActiveSharePulse();
        }

        // Read the location-disclosure acknowledgement flag from
        // AsyncStorage so the kebab can decide whether to keep the
        // "Location privacy policy..." item visible. Once consented,
        // the item persists across all chats / contact states for
        // THIS account until the user explicitly opts out via the
        // viewer modal. The flag is now scoped per SIP identity (see
        // locationDisclosure.js) so a second account on the same
        // device doesn't inherit the first one's consent. Android
        // only — the disclosure UX is a Google Play requirement;
        // iOS uses the App Store / CoreLocation usage-string model
        // and never shows the in-app modal.
        if (Platform.OS === 'android') {
            readLocationDisclosure(this.props.accountId)
                .then((acknowledged) => {
                    if (acknowledged === true) {
                        this.setState({locationDisclosureAcknowledged: true});
                    }
                })
                .catch(() => { /* read failure is non-fatal — defaults to false */ });
        }

        // AppState listener — re-arm the pulse loop whenever the app
        // comes back to the foreground while a share is still
        // active. iOS pauses native-driver Animated.loop animations
        // when the process is suspended and DOES NOT auto-resume
        // them when the app foregrounds. Without this, the
        // Animated.Value freezes at whatever opacity it had when
        // the app went into background and the indicator looks
        // permanently dimmed/static even though the share is still
        // running. Stop+start gives us a fresh native loop.
        this._appStateSub = AppState.addEventListener('change', this._onAppStateChange);

        // Resume any share sessions that were in flight when the
        // app was last killed / quit / force-stopped. We can ONLY
        // do this once the account is registered with the SIP
        // server — until then sendMessage just queues into the
        // void and the first wave of resumed ticks would land
        // nowhere. If the account happens to already be
        // registered at mount time (hot reload, fast cold-start),
        // run immediately; otherwise componentDidUpdate watches
        // for the registrationState transition and fires once.
        // _didResumeShares is the once-per-process guard.
        if (this.props.registrationState === 'registered'
                && !this._didResumeShares) {
            this._didResumeShares = true;
            // Resume/persist logic is app-owned now (Stage 4b-2).
            if (this.props.app) this.props.app._loadAndResumeActiveShares();
        }

        // If we mount with a call already in flight (NavBar gets re-
        // mounted from /ready while a call is mid-warmup, or fast-
        // refresh during dev) bind the warmup listeners immediately
        // so the subtitle reflects the current phase from frame 1.
        if (this.props.call) {
            this._attachCallWarmup(this.props.call);
        }
    }

    componentWillUnmount() {
        // Component-lifetime cleanup ONLY. We don't go through
        // stopLocationSharing here — that path is reserved for
        // user-initiated stops, expiry, and remote teardown signals.
        // A swipe-kill / route change / hot reload is none of
        // those: per product contract, sharing only stops on
        // explicit UI actions or natural expiration. Calling
        // stopLocationSharing here would also wipe the persisted
        // resume snapshot (we'd lose the entries that
        // _loadAndResumeActiveShares needs on the next boot) AND
        // surface "Stopped sharing" system notes that misrepresent
        // a process death as the user's choice.
        //
        // Just release the live timers / watchers so they don't
        // leak after the component is gone, and leave
        // activeLocationShares / AsyncStorage state intact for the
        // next mount to inherit.
        //
        // NOTE: outgoingLocationSessions is now the app-owned registry (borrowed by
        // reference), so it survives this unmount. We therefore DELETE each
        // entry after releasing its OS handles — otherwise the app registry
        // would retain entries with dead handles, and the resume path
        // (startLocationSharing's `outgoingLocationSessions[uri]` guard) would skip
        // re-arming on the next mount. The AsyncStorage resume snapshot,
        // written on start/mutation, is the source that re-arms — it is NOT
        // touched here.
        this._unmounted = true;
        // Deregister as the engine's VIEW so the app-hosted engine stops
        // reflecting UI into this dying component (its guarded _ui* helpers
        // no-op once ui is null). Only clear if we're still the current view —
        // a fast remount may have already pointed the engine at a new NavBar.
        if (this._locationEngine && this._locationEngine.navbar === this) {
            this._locationEngine.navbar = null;
        }
        // Tear down the call-warmup listener + poll interval so they
        // don't keep firing into a setState on an unmounted component.
        this._detachCallWarmup();
        // Release the live OS handles for every armed share and drop the
        // entries. This is engine lifecycle, owned by the app-hosted engine now
        // (Stage 4b-6) — so NavigationBar no longer imports BackgroundTimer /
        // Geolocation. Behaviour is unchanged: release on unmount, re-arm from
        // the AsyncStorage snapshot on the next mount.
        if (this._locationEngine && typeof this._locationEngine.releaseTimerHandles === 'function') {
            this._locationEngine.releaseTimerHandles();
        }
        // Stop any simulator timers too (they'd otherwise keep firing synthetic
        // ticks into the engine while this view is gone). The simulator is
        // app-owned now (Stage 4b-3).
        if (this.props.app && this.props.app._simulator) {
            this.props.app._simulator.stopAll();
        }
        // Kill the pulse animation so it doesn't tick against a stale
        // Animated.Value after unmount.
        this._stopActiveSharePulse();
        if (this._appStateSub && typeof this._appStateSub.remove === 'function') {
            this._appStateSub.remove();
            this._appStateSub = null;
        }
        // Parked permission-retry intents now live on the app
        // (this.app._pendingPermissionShares), so they survive this unmount and
        // the next foreground drain re-arms them — no NavBar-side clear needed.
    }

    _onAppStateChange(state) {
        if (state !== 'active') return;
        const sharesCount = Object.keys(this.getActiveSharesForModal()).length;
        if (sharesCount > 0 || this.props.callActive) {
            this._stopActiveSharePulse();
            this._startActiveSharePulse();
        }
        // Auto-resume any share whose start was deferred because the
        // user didn't have sufficient location permission at tap-time.
        // The user has just returned to the app — likely from Settings
        // where they granted "Allow always" — so re-probe and try
        // again. This makes the meeting-accept flow forgiving: tap
        // Accept once, grant permission whenever, and the share
        // starts on its own.
        try {
            this._locationEngine._drainPendingPermissionShares();
        } catch (e) { /* drain is best-effort */ }
    }

    // Persistence + boot-resume of location shares are app-owned now
    // (this.app._persistActiveShares / this.app._loadAndResumeActiveShares,
    // Stage 4b-2). The engine persists on timer mutations; NavigationBar just
    // triggers the app resume on the registrationState->registered edge above.
    
    get hasFiles() {
		const contact = this.props.selectedContact?.uri;
		const msgs = this.props.messages[contact] || [];
		return msgs.some(m => m.contentType === "application/sylk-file-transfer");
	}
    
    get hasMessages() {
		const contact = this.props.selectedContact?.uri;
		const msgs = this.props.messages[contact] || [];
		return msgs.some(m => m.contentType !== "application/sylk-file-transfer");
	}

	componentDidUpdate(prevProps, prevState) {
	    if (this.state.menuVisible != prevState.menuVisible && this.state.menuVisible) {
		    Keyboard.dismiss();
		}

		// (Removed) fold-transition reset of appBarMeasuredHeight.
		// In combination with the Appbar.Header remount key it was
		// supposed to force a fresh onLayout after fold/unfold, but
		// the pair caused the contacts list to slide under the navbar
		// in non-folded mode without actually rescaling the cover
		// display. Both have been reverted; the original "smaller
		// navbar after unfold" symptom from task #23 needs a
		// different approach if it returns.

		// Track call identity changes so the warmup listener / poll
		// interval follow the right Call object. Three relevant cases:
		//   1. call appeared (null -> Call)   → attach
		//   2. call swapped (CallA -> CallB)  → detach A, attach B
		//   3. call cleared (Call -> null)    → detach
		// Identity is checked by object reference rather than by id;
		// sylkrtc keeps the same JS object across state transitions, so
		// re-attaching every render would be a leak risk. The
		// idempotency guard inside _attachCallWarmup is a safety net,
		// not the primary mechanism.
		if (prevProps.call !== this.props.call) {
			if (this.props.call) {
				this._attachCallWarmup(this.props.call);
			} else {
				this._detachCallWarmup();
			}
		}

		// accountId changed (sign-out → sign-in with a different SIP
		// identity, or first registration after launch when the
		// initial mount happened with empty props.accountId). The
		// disclosure flag is per-account so we re-read it for the
		// new identity instead of carrying stale state from the
		// previous one. Android-only for the same reason as the
		// initial componentDidMount read.
		if (Platform.OS === 'android'
				&& this.props.accountId !== prevProps.accountId) {
			readLocationDisclosure(this.props.accountId)
				.then((acknowledged) => {
					this.setState({locationDisclosureAcknowledged: acknowledged === true});
				})
				.catch(() => {
					this.setState({locationDisclosureAcknowledged: false});
				});
		}

		// Tick cadence is now read live from the app (this.app.LOCATION_REPEAT_MS,
		// a getter over accountSetting.location.tickIntervalSec), so there's no
		// NavBar-side value to keep in sync on a preference change (Stage 4b).

		// Account just finished registering with the SIP server.
		// This is our cue to resume any in-flight share sessions
		// that were saved to AsyncStorage before the previous
		// process died. Guarded by _didResumeShares so the resume
		// runs at most once per app lifetime, even if the account
		// flaps registered → unregistered → registered.
		if (!this._didResumeShares
				&& this.props.registrationState === 'registered'
				&& prevProps.registrationState !== 'registered') {
			this._didResumeShares = true;
			// Resume/persist logic is app-owned now (Stage 4b-2).
			if (this.props.app) this.props.app._loadAndResumeActiveShares();
			// Hydrate the per-account share-location disclaimer
			// suppression flag in the same window — by definition
			// accountId is bound now, and reading the flag here
			// avoids a separate registration hook for what's
			// otherwise a tiny piece of state. Idempotent so a
			// future re-fire would be safe even though the gate
			// above prevents it.
			this._locationEngine._hydrateDisclaimerSuppression();
		}

		// Re-hydrate when accountId itself changes (account-switch on
		// the same device, even if registrationState didn't transition
		// through 'unregistered'). Without this, signing out as A and
		// back in as B on the same process would keep B looking at
		// A's suppression state.
		if (prevProps.accountId !== this.props.accountId) {
			this._locationEngine._hydrateDisclaimerSuppression();
		}

		// Self-heal drift between activeLocationShares (React state that drives
		// the chat-header + NavBar pulse) and the real timer registry: any share
		// not backed by a live timer AND not mid-startup is pruned. The logic
		// lives on the engine. When it prunes it calls app.setState, which
		// triggers another cDU — so bail out this frame to let the count-based
		// pulse toggle below run against the corrected map (running it now with
		// the stale count would keep the pulse alive for one extra frame).
		if (this._locationEngine && this._locationEngine.reconcileActiveShares()) {
			return;
		}

		// Drive the pulsing marker indicator: start the loop on the
		// first active share OR the start of an in-progress call,
		// stop it when both signals go quiet. We share the same
		// Animated.Value across both indicators so a simultaneous
		// call+share breath in unison rather than fighting each other.
		// Counted off both the share map (size > 0) and inCall so a
		// transition in EITHER direction triggers the right side
		// effect.
		// Count MERGED shares (local broadcaster + mirrored sibling shares) so
		// the pulse starts/stops for ANY active location sharing, including on a
		// secondary device that only mirrors a share. getActiveSharesForModal()
		// reflects the current merged truth; we track the previous count on the
		// instance since it depends on props (the mirror) as well as state.
		const currCount = Object.keys(this.getActiveSharesForModal()).length;
		const prevCount = (typeof this._lastPulseShareCount === 'number')
			? this._lastPulseShareCount
			: 0;
		this._lastPulseShareCount = currCount;
		// Gate on callActive (established) rather than inCall, matching
		// the icon's visibility — otherwise the pulse loop runs while
		// the call is still ringing even though the icon is hidden.
		const prevActive = prevCount > 0 || !!prevProps.callActive;
		const currActive = currCount > 0 || !!this.props.callActive;
		if (!prevActive && currActive) {
			this._startActiveSharePulse();
		} else if (prevActive && !currActive) {
			this._stopActiveSharePulse();
			// If the modal was open when the last share ended, close
			// it too so the user isn't left staring at an empty list.
			if (this.state.showActiveSharesModal) {
				this.setState({showActiveSharesModal: false});
			}
		} else if (currActive
				&& prevProps.selectedContact !== this.props.selectedContact) {
			// selectedContact changed while a share is active. The
			// NavBar pin's render gate hides it when we're sitting
			// inside the (single) sharing chat and shows it on every
			// other screen. When that visibility flips on, the
			// Animated.View remounts onto an Animated.Value whose
			// native-side loop may have been silently torn down by
			// the previous unmount. Re-arming with a clean
			// stop+start re-binds the native driver to the new view
			// so the pin actually breathes again.
			this._stopActiveSharePulse();
			this._startActiveSharePulse();
		}

		// (Stage 3b) The active-shares map is app-owned now — the engine writes
		// it via this.app.setState, so app.js already has the current map and
		// propagates it to ReadyBox directly. No NavBar->app bubble needed.

		// let state = JSON.stringify(this.state, null, 2);
		//console.log('NB state', state);
		
		let keys = Object.keys(this.state);
		for (const key of keys) {		
			if (this.state[key] != prevState[key]) {
			    //console.log('Navigation bar', key, 'has changed:', this.state[key]);
			}
		}
	}

    handleMenu(event) {
        switch (event) {
            case 'about':
                this.toggleAboutModal();
                break;
            case 'donate':
                // Opens the shared PaymentInfoModal with the
                // 'donate' template ("Blink is free software…").
                // The same modal renders the 'credit' template
                // when opened from the 'Payment required' PSTN
                // branch in app.callStateChanged.
                if (typeof this.props.togglePaymentInfoModal === 'function') {
                    this.props.togglePaymentInfoModal('donate');
                }
                break;
            case 'callMeMaybe':
                this.props.toggleCallMeMaybeModal();
                break;
            case 'toggleDnd':
                // Mirror of the bell-icon tap in the navbar header.
                // Routes to the same toggleDnd handler in app.js that
                // flips state.accountSetting.privacy.dnd. Closing the
                // menu is handled by Menu.Item's default onPress
                // wrapper just like the other items in this switch.
                if (typeof this.props.toggleDnd === 'function') {
                    this.props.toggleDnd();
                }
                break;
            case 'scanQr':
                this.props.toggleQRCodeScannerFunc();
                break;
            case 'backupContacts':
                if (typeof this.props.backupContacts === 'function') {
                    this.props.backupContacts();
                }
                break;
            case 'backupMessages':
                if (typeof this.props.backupMessages === 'function') {
                    this.props.backupMessages();
                }
                break;
            case 'restoreMessages':
                if (typeof this.props.openRestoreMessages === 'function') {
                    this.props.openRestoreMessages();
                }
                break;
            case 'importContacts':
                if (typeof this.props.openImportContacts === 'function') {
                    this.props.openImportContacts();
                }
                break;
            case 'shareConferenceLinkModal':
                this.showConferenceLinkModal();
                break;
            case 'shareLocation':
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    if (_uri && (this._activeShares()[_uri] || this._isShareActiveRemote(_uri))) {
                        // Already sharing to this contact (here OR on another of
                        // our devices) — toggle off. The engine relays the stop
                        // to the broadcasting sibling + the peer when this device
                        // is only mirroring.
                        this._locationEngine.stopLocationSharing(_uri);
                    } else {
                        this._locationEngine.showShareLocationModal();
                    }
                }
                break;
            case 'pauseLocation':
                // Pause the active share for the currently selected
                // contact. Mirrors the bubble-kebab Pause action but
                // saves the user from having to dig into the bubble.
                // No-op if no active entry (race with stopLocationSharing
                // / expiry tear-down) — pauseLocationSharing handles
                // that by returning false.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    const _entry = _uri && this.outgoingLocationSessions && this.outgoingLocationSessions[_uri];
                    if (_entry) {
                        this._locationEngine.pauseLocationSharing(_uri, _entry.originLocationId);
                    }
                }
                break;
            case 'resumeLocation':
                // Resume a previously-paused share for the currently
                // selected contact. resumeLocationSharing returns true
                // on success. If it returns false (entry was wiped while
                // the user was away), we fall through silently — the
                // chat-header menu only shows Resume when an entry
                // exists, so this should be a no-op race in practice.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    const _entry = _uri && this.outgoingLocationSessions && this.outgoingLocationSessions[_uri];
                    if (_entry) {
                        this._locationEngine.resumeLocationSharing(_uri, _entry.originLocationId);
                    }
                }
                break;
            case 'requestLocation':
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    if (_uri) {
                        this._locationEngine.requestPeerLocation(_uri);
                    }
                }
                break;
            case 'viewLocationDisclosure':
                // Viewer for the Prominent Disclosure modal — opens the
                // same panel the share-flow uses, but with different
                // button semantics depending on whether the user has
                // already agreed:
                //
                //   • Already agreed (AsyncStorage flag set):
                //     [Close] [Opt out] — Opt out wipes the
                //     acknowledgement so the next share request will
                //     re-prompt for consent.
                //   • Not yet agreed:
                //     [Not now] [I agree] — same as the share-flow,
                //     so the user can grant consent ahead of their
                //     first share if they want to.
                //
                // The state object carries `showOptOut` flag and an
                // `onOptOut` handler that the modal renders into a
                // dedicated button branch.
                {
                    // Per-account scoping: the agreement state is
                    // tracked per SIP identity (see locationDisclosure.js).
                    // We capture the accountId here so the async
                    // continue/optOut handlers below close over a
                    // stable value even if the user signs out and
                    // back in before they tap a button.
                    const _accountId = this.props.accountId;
                    // Same diagnostic log as the share-flow gate —
                    // emit the current OS permission state alongside
                    // the AsyncStorage agreement state so we can read
                    // both at a glance when the user reports something
                    // unexpected.
                    this._locationEngine.getLocationPermissionStatus()
                        .then((permState) => {
                            console.log('[location] disclosure viewer opened — OS permission state =', permState);
                        })
                        .catch((e) => {
                            console.log('[location] disclosure viewer opened — getLocationPermissionStatus failed',
                                e && e.message ? e.message : e);
                        });
                    readLocationDisclosure(_accountId).then((acknowledged) => {
                        const showOptOut = acknowledged === true;
                        console.log('[location] disclosure viewer — agreement state =',
                            showOptOut ? 'agreed' : 'not agreed', 'account=', _accountId);
                        this.setState({
                            locationDisclosurePending: {
                                showOptOut,
                                onContinue: async () => {
                                    // Only reachable from the
                                    // not-yet-agreed branch; persist
                                    // consent the same way the
                                    // share-flow does and mirror in
                                    // component state so the kebab
                                    // updates immediately. Only emit
                                    // the APPLOG accept line when we
                                    // actually flipped the flag —
                                    // hitting "Continue" on the
                                    // already-agreed variant is a
                                    // no-op we don't need in the
                                    // log timeline.
                                    if (!showOptOut) {
                                        await setLocationDisclosure(_accountId);
                                        utils.timestampedLog(
                                            '[location] user accepted privacy policy via viewer — disclosure flag set for',
                                            _accountId);
                                    }
                                    this.setState({
                                        locationDisclosurePending: null,
                                        locationDisclosureAcknowledged: true,
                                    });
                                },
                                onCancel: () => {
                                    this.setState({locationDisclosurePending: null});
                                },
                                onOptOut: async () => {
                                    await clearLocationDisclosure(_accountId);
                                    // Clear the share-location disclaimer
                                    // suppression too — the user just
                                    // revoked the underlying privacy-
                                    // policy consent, so the disclaimer
                                    // text MUST reappear on the next
                                    // share. (The suppression was a
                                    // convenience flag layered on top of
                                    // the agreed-to policy; without that
                                    // policy in place, the legal copy
                                    // belongs back on screen.)
                                    try { await this._locationEngine._clearShareLocationDisclaimerSuppression(); }
                                    catch (e) { /* persistence failure is non-fatal */ }
                                    utils.timestampedLog(
                                        '[location] user opted out of privacy policy via viewer — disclosure flag cleared for',
                                        _accountId);
                                    this.setState({
                                        locationDisclosurePending: null,
                                        locationDisclosureAcknowledged: false,
                                    });
                                },
                            },
                        });
                    });
                }
                break;
            case 'simulateToggle':
                // DEBUG: single location-simulator toggle. Driven by the
                // "Location simulator" preference. Starts the walker that
                // matches the ACTIVE share's mode, or stops whichever is
                // running:
                //   • untilIReturn                → round-trip (auto-stops
                //     on return via the gate)
                //   • meetingRequest / meetingAccept → meet-up convergence
                //   • fixed (share-by-interval)   → outward random walk
                //     (runs until stopped)
                {
                    // Start/Stop applies to EVERY active location session, not
                    // just the selected contact: if more than one share is
                    // live, the simulator starts (or stops) for all of them.
                    if (this.isAnySimulating()) {
                        this.stopAllSimulations();
                    } else {
                        this.startSimulatorForAllSessions();
                    }
                    // Re-render so the menu item swaps title.
                    this.setState({menuVisible: false});
                }
                break;
            case 'pinLocation':
                // Entry point used by the ReadyBox chat-header map-marker
                // "pin" button. A contact can now have up to two STARTABLE
                // session types live at once — a meet ("Until we meet") and a
                // plain timed share. Three-way decision:
                //   • BOTH types already live → nothing more to start, so open
                //     the ActiveLocationSharesModal scoped to this chat (today's
                //     behaviour) to review / stop the live sessions.
                //   • Otherwise → open the start-share picker. The picker reads
                //     the live types (via getStartableLiveTypes, wired through
                //     NavigationBarModals) and disables the options that are
                //     already live, so the user can only start what's startable.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    const _types = (_uri && this._locationEngine
                        && typeof this._locationEngine.getStartableLiveTypes === 'function')
                        ? this._locationEngine.getStartableLiveTypes(_uri)
                        : { meet: false, share: false };
                    if (_uri && _types.meet && _types.share) {
                        // Both startable types live — open the scoped active list.
                        this.setState({
                            showActiveSharesModal: true,
                            activeSharesFilterUri: _uri,
                        });
                    } else {
                        // At least one type still startable — open the picker with
                        // the live options disabled. Pass the uri + freshly-computed
                        // types captured HERE (tap time, selection valid) so the
                        // modal doesn't depend on a selectedContact that can flicker
                        // null during later re-renders.
                        this._locationEngine.showShareLocationModal(_uri, _types);
                    }
                }
                break;
            case 'locationSessions':
                // Contact-menu entry point: open the ActiveLocationSharesModal
                // scoped to the selected contact so the user can review every
                // live location session (meet + share) and stop the ones they
                // own. Mirrors the scoped-open the pin uses when all slots full.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    // Dump the live session list to the log for diagnostics when
                    // the user opens the sessions modal from the contact menu.
                    try { this._dumpActiveShareSessions(); } catch (e) { /* noop */ }
                    this.setState({
                        menuVisible: false,
                        showActiveSharesModal: true,
                        activeSharesFilterUri: _uri || null,
                    });
                }
                break;
            case 'displayName':
                this.toggleEditContactModal();
                break;
            case 'preferences':
                this.setState({ showPreferencesModal: true });
                break;
            case 'exportData':
                this.setState({ showExportDataModal: true });
                break;
            case 'openRefetchMessages':
                // Close the storage submenu and open the day-picker modal.
                // The actual refetch fires from the modal's Apply button via
                // props.refetchMessages (see the legacy 'refetchMessages'
                // case below for the direct, menu-driven path that's still
                // gated behind refetchMessagesForDays != 0).
                this.setState({ storageMenuVisible: false, showRefetchMessagesModal: true });
                break;
            case 'speakerphone':
                this.props.toggleSpeakerPhone();
                break;
            case 'proximity':
                this.props.toggleProximity();
                break;
            case 'anonymous':
                this.props.toggleRejectAnonymous();
                break;
            case 'logOut':
                // Was: immediately call props.logout(). The destructive
                // session-end action now goes through a confirmation
                // dialog that, when other accounts are stored locally,
                // also offers to switch directly to one of them. The
                // dialog calls back into props.logout() / props.switchAccount
                // depending on what the user picks.
                this.setState({ showSwitchAccountModal: true });
                break;
            case 'logs':
                this.props.showLogs();
                break;
            case 'refetchMessages':
                this.props.refetchMessages(this.refetchMessagesForDays, this.props.selectedContact?.uri);
                break;
            case 'preview':
                this.props.preview();
                break;
            case 'audio':
                this.audioCall();
                break;
            case 'video':
                this.videoCall();
                break;
            case 'resumeTransfers':
                this.resumeTransfers();
                break;
            case 'conference':
                this.conferenceCall();
                break;
            case 'conferenceCallNow':
                this.conferenceCallNow();
                break;
            case 'toggleAutoAnswerMode':
                this.props.toggleAutoAnswerMode();
                break;
            case 'appSettings':
                openSettings();
                break;
            case 'addContact':
                this.toggleAddContactModal();
                break;
            case 'editContact':
                if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
                    this.setState({showEditConferenceModal: true});
                } else {
                    this.setState({showEditContactModal: true});
                }
                break;
            case 'searchMessages':
                this.props.toggleSearchMessages();
                break;
            case 'deleteMessages':
                this.setState({showDeleteHistoryModal: true, deleteContact: false});
                break;
            case 'deleteContact':
                // Stage 1: move the contact straight to the Deleted folder — no
                // confirm here. The Deleted folder is the undo; the single, real
                // confirmation is the permanent delete done from inside it. This
                // routes through deleteMessages' delete-contact intercept, which
                // soft-deletes (sets deleted_timestamp + hides messages).
                if (this.props.selectedContact && this.props.selectedContact.uri) {
                    this.props.deleteMessages(this.props.selectedContact.uri, false, {
                        deleteContact: true,
                        selectedContact: this.props.selectedContact,
                    });
                }
                break;
            case 'deleteFileTransfers':
                this.setState({showDeleteFileTransfers: true});
                break;
            case 'generatePrivateKey':
                this.setState({showGenerateKeysModal: true});
                break;
            case 'toggleFavorite':
                this.props.toggleFavorite(this.props.selectedContact);
                break;
            case 'toggleAutoAnswer':
                this.props.toggleAutoAnswer(this.props.selectedContact);
                break;
            // [AUTO-DIALER — DEVELOPER TOOL] Running -> stop it outright.
            // Not running -> open the settings dialog, which starts the loop
            // via props.startAutoDialer once media / timers are chosen.
            case 'toggleAutoDialer':
                if (this.props.autoDialerUri
                        && this.props.selectedContact
                        && this.props.autoDialerUri === this.props.selectedContact.uri) {
                    this.props.toggleAutoDialer(this.props.selectedContact);
                } else {
                    this.setState({showAutoDialerModal: true});
                }
                break;
            case 'toggleCaregiver':
                this.props.toggleCaregiver(this.props.selectedContact);
                break;
            case 'toggleBlocked':
                this.props.toggleBlocked(this.props.selectedContact);
                break;
            case 'sendPublicKey':
                this.props.sendPublicKey(this.props.selectedContact.uri);
                break;
            case 'exportPrivateKey':
                if (this.props.publicKey) {
                    this.showExportPrivateKeyModal();
                } else {
                    this.props.showImportModal(true);
                }
                break;
            case 'backupPrivateKey':
                if (this.props.publicKey) {
					this.setState({backupKey: true});
                    this.showExportPrivateKeyModal();
                }
                break;
            case 'restorePrivateKey':
				this.props.showRestoreKeyModalFunc(true);
                break;
            case 'showPublicKey':
                this.setState({showEditContactModal: !this.state.showEditContactModal, showPublicKey: true});
                break;
            case 'checkUpdate':
                if (Platform.OS === 'android') {
                    Linking.openURL('https://play.google.com/store/apps/details?id=com.agprojects.sylk');
                } else {
                    Linking.openURL('https://apps.apple.com/us/app/id1489960733');
                }
                break;
            case 'settings':
                Linking.openURL(this.props.serverSettingsUrl);
                break;
            default:
                break;
        }

        this.setState({menuVisible: false, keyMenuVisible: false, storageMenuVisible: false, settingsMenuVisible: false});
    }

    toggleAboutModal() {
        this.setState({showAboutModal: !this.state.showAboutModal});
    }

    handleDonateFromAbout() {
        // Donate button lives inside the About modal. Close About first,
        // then open the shared PaymentInfoModal ('donate' template). The
        // two are sequenced because presenting a second RN Modal while the
        // first is still dismissing can drop the new one on iOS.
        this.setState({showAboutModal: false}, () => {
            if (typeof this.props.togglePaymentInfoModal === 'function') {
                setTimeout(() => this.props.togglePaymentInfoModal('donate'), 300);
            }
        });
    }

    showConferenceLinkModal() {
        this.setState({showConferenceLinkModal: true});
    }

    hideConferenceLinkModal() {
        this.setState({showConferenceLinkModal: false});
    }

    // Re-probe the OS location grant and update the level the open share
    // picker reads. Passed to ShareLocationModal as onRefreshPermissionLevel
    // and fired when the app returns to the foreground while the modal is
    // open, so granting "Always" in Settings unlocks the timed options
    // in place. No-op'd against a closed picker to avoid stray setState.
    async refreshShareLocationPermissionLevel() {
        if (!this.state.showShareLocationModal) { return; }
        try {
            const level = await this._locationEngine.getLocationPermissionStatus();
            this.setState({ shareLocationPermissionLevel: level });
        } catch (e) {
            /* best-effort — leave the prior level in place */
        }
    }

    // Share-state derivation lives on the engine; these are thin view accessors.
    _shareSessions() {
        return this._locationEngine ? this._locationEngine._shareSessions() : {};
    }

    _activeShares() {
        return this._locationEngine ? this._locationEngine._activeShares() : {};
    }

    _isShareActiveRemote(uri) {
        return this._locationEngine ? this._locationEngine._isShareActiveRemote(uri) : false;
    }

    // Consumed by render/pulse counts and (getActiveSharesRowsForModal) by
    // NavigationBarModals via nav={this}. Both delegate to the engine.
    getActiveSharesForModal() {
        return this._locationEngine ? this._locationEngine.getActiveSharesForModal() : {};
    }

    getActiveSharesRowsForModal() {
        return this._locationEngine ? this._locationEngine.getActiveSharesRowsForModal() : [];
    }

    _dumpActiveShareSessions() {
        if (this._locationEngine) this._locationEngine._dumpActiveShareSessions();
    }






    // Google Play "Prominent Disclosure" gate.
    //
    // Required by the Permissions and APIs that Access Sensitive
    // Information policy: before any data collection that uses a
    // sensitive permission (location is the headliner), the user must
    // see an in-app disclosure that names the data, says how it's
    // used, and says how / where it's shared. The disclosure must
    // appear BEFORE the OS permission dialog and must not be combined
    // with unrelated UI (T&Cs, login, marketing).
    //
    // Implementation:
    //   • Persists a single AsyncStorage flag once the user taps
    //     Continue. Subsequent shares skip the modal and go straight
    //     to permission probe / tick emission. Versioned key so we
    //     can re-prompt if disclosure text materially changes.
    //   • Returns true when the user has acknowledged (now or
    //     previously) — caller proceeds. Returns false when the user
    //     declined — caller aborts cleanly without asking for
    //     permission and without collecting any location data.
    //   • Internally awaits a Promise that's resolved by the modal's
    //     onContinue / onCancel handlers in render(), so any number
    //     of concurrent share attempts queue up against the same
    //     decision (the resolver lives on `this.state` and is
    //     overwritten if a second share fires while the first is
    //     still showing — last-write-wins is fine, the modal is the
    //     same one either way).
    // Share-menu gate (genuine two-way conversation with `uri`); the scan lives
    // on the engine.
    _hasBidirectionalChat(uri) {
        return this._locationEngine ? this._locationEngine._hasBidirectionalChat(uri) : false;
    }

















    // ===== DEBUG: meet-up convergence simulator =====
    //
    // The walker logic lives in LocationSimulator.js; these thin wrappers
    // preserve the public method names used by handleMenu and render(). The
    // simulator is app-owned now (Stage 4b-3), so they delegate to
    // this.props.app._simulator (guarded — it's always wired via the app prop).
    _sim() {
        return (this.props.app && this.props.app._simulator) || null;
    }

    simulateConvergence(uri, opts = {}) {
        const s = this._sim(); if (s) s.start(uri, opts);
    }

    // DEBUG: "Share Until I Return" round-trip walker (gated on
    // ENABLE_UNTIL_RETURN_SIMULATION). Shares the same _simStates map /
    // stop / isSimulating plumbing as the meet-up sim above.
    simulateRoundTrip(uri, opts = {}) {
        const s = this._sim(); if (s) s.startUntilReturn(uri, opts);
    }

    // DEBUG: "normal track" random-walk walker — meanders until stopped.
    // Used for plain live / fixed-duration shares, which have no
    // auto-stop gate to exercise. Same gating / plumbing as above.
    simulateRandomWalk(uri, opts = {}) {
        const s = this._sim(); if (s) s.startRandomWalk(uri, opts);
    }

    stopSimulation(uri) {
        const s = this._sim(); if (s) s.stop(uri);
    }

    isSimulating(uri) {
        const s = this._sim(); return s ? s.isSimulating(uri) : false;
    }

    // Every active outgoing location session, across all contacts. The
    // registry is app-owned and keyed by uri (borrowed by reference), so a
    // second live share for another contact appears here too.
    _activeSimSessionUris() {
        return Object.keys(this.outgoingLocationSessions || {});
    }

    // True when at least one active session is currently being simulated —
    // used to drive the single Start/Stop toggle for the whole set.
    isAnySimulating() {
        const s = this._sim();
        if (!s) return false;
        return this._activeSimSessionUris().some((uri) => s.isSimulating(uri));
    }

    // Start the walker that matches one session's kind: round-trip for
    // "Until I return", convergence for a meet-up, outward random walk for a
    // plain / fixed share.
    _startSimulatorForUri(uri) {
        const entry = this.outgoingLocationSessions && this.outgoingLocationSessions[uri];
        const kind = entry && entry.kind;
        if (kind === 'untilIReturn') {
            this.simulateRoundTrip(uri);
        } else if (kind === 'meetingRequest' || kind === 'meetingAccept') {
            this.simulateConvergence(uri);
        } else {
            this.simulateRandomWalk(uri);
        }
    }

    // Start the simulator for EVERY active session (not just the selected
    // contact). Sessions already running are skipped so a partial state
    // converges to "all running".
    startSimulatorForAllSessions() {
        this._activeSimSessionUris().forEach((uri) => {
            if (!this.isSimulating(uri)) this._startSimulatorForUri(uri);
        });
    }

    // Stop the simulator for every active session.
    stopAllSimulations() {
        const s = this._sim();
        if (s && typeof s.stopAll === 'function') { s.stopAll(); return; }
        this._activeSimSessionUris().forEach((uri) => this.stopSimulation(uri));
    }
















    audioCall() {
        let uri = this.props.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: false});
    }

    videoCall() {
        let uri = this.props.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: true});
    }

    resumeTransfers() {
        this.props.resumeTransfers();
    }

    get myself() {
        return !!(this.props.selectedContact
            && String(this.props.selectedContact.uri || '').trim().toLowerCase()
               === String(this.props.accountId || '').trim().toLowerCase());
    }

    conferenceCall() {
        this.props.showConferenceModalFunc();
    }

    // DJB2 hash of an input string → 9-digit zero-padded string. Identical
    // shape and modulus to VideoBox._hashUsernamesToRoom / AudioCallBox so
    // a Conference-call menu start lands in the SAME numeric room URI as
    // the in-call "escalate to conference" handshake would for the same
    // (local, peer) pair.
    _hashUsernamesToRoom(input) {
        let h = 5381;
        for (let i = 0; i < input.length; i++) {
            h = ((h << 5) + h + input.charCodeAt(i)) | 0;
        }
        const positive = (h >>> 0);
        const mod = positive % 1000000000;
        return mod.toString().padStart(9, '0');
    }

    // Chat-header kebab "Conference call" item for a non-conference contact.
    //
    // Derives a deterministic conference-room URI from (my username, peer
    // username) — same DJB2-of-sorted-lowercased-usernames recipe as the
    // in-call escalation handshake — so the resulting room is stable for
    // this (local, peer) pair across invocations and identical to what
    // both sides would compute via the avatar-panel "Escalate to
    // conference" flow. Then starts an outgoing VIDEO conference to that
    // room with the remote party as the auto-invitee, so the peer gets
    // pulled in without the originator having to type their URI into the
    // invite field.
    conferenceCallNow() {
        const selected = this.props.selectedContact;
        if (!selected || !selected.uri) {
            console.log('[conferenceCallNow] no selected contact');
            return;
        }
        const peerUri = selected.uri;
        const myUri = this.props.accountId || '';
        const conferenceDomain = this.props.defaultConferenceDomain || 'videoconference.sip2sip.info';
        const myUser = (myUri && myUri.split('@')[0]) || 'me';
        const peerUser = (peerUri && peerUri.split('@')[0]) || 'peer';
        const parts = [myUser, peerUser].map(s => s.toLowerCase()).sort();
        const room = `${this._hashUsernamesToRoom(parts.join('|'))}@${conferenceDomain}`;

        console.log('[conferenceCallNow] starting video conference room=', room,
            'inviting peer=', peerUri);

        if (typeof this.props.startConference !== 'function') {
            console.log('[conferenceCallNow] startConference prop not wired');
            return;
        }
        this.props.startConference(room, {
            audio: true,
            video: true,
            participants: [peerUri],
        });
    }

    toggleAddContactModal() {
        this.setState({showAddContactModal: !this.state.showAddContactModal});
    }

    closeDeleteHistoryModal() {
        this.setState({showDeleteHistoryModal: false, deleteContact: false});
    }

    closeDeleteFileTransfers() {
        this.setState({showDeleteFileTransfers: false});
    }

    hideGenerateKeysModal() {
        this.setState({showGenerateKeysModal: false});
    }

    hideImportKeysModal() {
        this.setState({showImportKeysModal: false});
    }

    showEditContactModal() {
        this.setState({showEditContactModal: true,
                       showPublicKey: false});
    }

    hideEditContactModal() {
        this.setState({showEditContactModal: false,
                       showPublicKey: false
                       });
    }

    // Open the destructive confirmation dialog. We close the My-Account
    // modal first so the user clearly transitions from "edit" context to
    // "delete" context — otherwise two stacked modals with different
    // primary actions sit on top of each other and the intent is muddied.
    openDeleteAccountModal() {
        this.setState({showEditContactModal: false, showDeleteAccountModal: true});
    }

    closeDeleteAccountModal() {
        this.setState({showDeleteAccountModal: false});
    }

    // Fired by DeleteAccountModal after the user confirms twice. Hands the
    // actual destructive work off to the App via props.deleteAccount —
    // SQL deletes, folder unlink, unregister, resetState, route to /login.
    confirmDeleteAccount() {
        if (typeof this.props.deleteAccount === 'function') {
            this.props.deleteAccount();
        }
        this.setState({showDeleteAccountModal: false});
    }

    handleDnd () {
    }

    saveConference(room, participants, displayName=null) {
        this.props.saveConference(room, participants, displayName);
        this.setState({showEditConferenceModal: false});
    }

    toggleEditContactModal() {
        if (this.state.showEditContactModal) {
            this.hideEditContactModal();
        } else {
            this.showEditContactModal();
        };
    }

    closeEditConferenceModal() {
        this.setState({showEditConferenceModal: false});
    }

    showExportPrivateKeyModal() {
        const password = Math.random().toString().substr(2, 6);
        this.setState({privateKeyPassword: password, showExportPrivateKeyModal: true});
        this.props.showExportPrivateKeyModalFunc()
    }

    hideExportPrivateKeyModal() {
        console.log('hideExportPrivateKeyModal');
        this.setState({backupKey: false, showExportPrivateKeyModal: false});
        this.props.hideExportPrivateKeyModalFunc()
    }

    get showBackToCallButton() {
        if (this.props.shareToContacts) {
			return false;
        }
        
        if (!this.props.isLandscape) {
			return false;
        }

        if (this.props.call) {
            //console.log('this.props.call.state', this.props.call.state);
            if (this.props.call.state !== 'incoming' && this.props.call.state !== 'terminated') {
				return true;
			}
        }

		return false;
    }

    render() {
        // Expose the location-sharing engine to the subtree via context so
        // descendants can use the useLocationSharing() hook instead of
        // prop-drilling. The Provider renders only its child (no extra
        // native view), and the engine instance is stable for the life of
        // this mount, so this wrapper changes neither layout nor render
        // behaviour. The actual UI is built in _renderInner().
        return (
            <LocationSharingContext.Provider value={this._locationEngine}>
                {this._renderInner()}
            </LocationSharingContext.Provider>
        );
    }

    _renderInner() {
        // Folded + search-contacts mode: hide the whole NavigationBar.
        // The cover display has very little vertical room and the
        // search bar (rendered by ReadyBox below) takes over the role
        // of the navbar in this mode — including the close-search
        // affordance, which is now an in-bar X overlay (see the
        // onCloseSearch prop on URIInput). Returning null keeps the
        // measurement / layout path the same on the next fold or
        // search-exit transition.
        if (this.props.isFolded && this.props.searchContacts) {
            return null;
        }

        // DND-themed glyphs in outline style:
        //   • DND off → bell-outline. Reads as "ready to notify"
        //     and matches the weight of the surrounding nav icons.
        //   • DND on  → bell-off-outline. Bell glyph with the
        //     standard diagonal slash, outline style — universal
        //     "notifications muted" cue.
        // (Earlier attempt used 'do-not-disturb', but that name
        // isn't in MaterialCommunityIcons — it rendered as the
        // question-mark fallback glyph.)
        const bellIcon = this.props.dnd ? 'bell-off-outline' : 'bell-outline';

        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;
        // Note: title / subtitle font sizes are intentionally NOT scaled
        // with the bar height. styles.tabletTitle (24) and
        // styles.tabletSubtitle (16) already account for tablet
        // readability; multiplying them again by navIconScale produced
        // visibly oversized text.

        // Diagnostic: log once at startup, then only when the chosen font
        // sizes actually change (fold/unfold transitions). Avoids flooding
        // the log on every re-render.
        const _navTitleFS = titleStyle.fontSize;
        const _navSubtitleFS = subtitleStyle.fontSize;
        const _navIsFolded = !!this.props.isFolded;
        // Diagnostic (disabled — re-enable to debug fold/font issues):
        // if (this._loggedTitleFS !== _navTitleFS
        //     || this._loggedSubtitleFS !== _navSubtitleFS
        //     || this._loggedNavIsFolded !== _navIsFolded) {
        //     console.log('[FoldUI] NavBar font-size',
        //                 this._loggedTitleFS === undefined ? 'init' : 'change',
        //                 'isFolded=', _navIsFolded,
        //                 'isTablet=', this.props.isTablet,
        //                 'titleFontSize=', _navTitleFS,
        //                 'subtitleFontSize=', _navSubtitleFS);
        //     this._loggedTitleFS = _navTitleFS;
        //     this._loggedSubtitleFS = _navSubtitleFS;
        //     this._loggedNavIsFolded = _navIsFolded;
        // }

        let statusIcon = null;
        let statusColor = 'green';
        let tags = [];
        
        statusIcon = 'check-circle';
        let bellStyle = styles.whiteButton;

        if (this.props.connection && this.props.connection.state === 'ready') {
            // WSS is up — distinguish "fully operational" from
            // "connected but auth/register failed". A green bell
            // implies the user is reachable; an orange bell tells
            // them the SIP server is alive but they're not actually
            // registered (e.g. 403 wrong password / domain not
            // served / pending register). Without this split the
            // bell stayed green even on a 403, which misled the
            // user into thinking everything was fine.
            if (this.props.registrationState === 'registered') {
                bellStyle = styles.greenButton;
            } else {
                bellStyle = styles.orangeButton;
            }
        } else if (this.props.connection && this.props.connection.state === 'connecting') {
            bellStyle = styles.whiteButton;
        } else if (this.props.connection && this.props.connection.state === 'disconnected') {
            bellStyle = styles.whiteButton;
        } else if (this.props.connection && this.props.registrationState !== 'registered') {
            bellStyle = styles.redButton;
        } else {
            bellStyle = styles.whiteButton;
        }

        if (!this.props.connection || this.props.connection.state !== 'ready') {
            statusIcon = 'alert-circle';
            statusColor = 'red';
        } else if (this.props.registrationState !== 'registered') {
            statusIcon = 'alert-circle';
            statusColor = 'orange';
        }

        let callUrl = this.props.publicUrl + "/call/" + this.props.accountId;
        let proximityTitle = this.props.proximity ? '✓ Proximity sensor' : 'Proximity sensor';
        let proximityIcon = this.props.proximity ? 'ear-hearing-off' : 'ear-hearing';
        let rejectAnonymousTitle = this.props.rejectAnonymous ? 'Allow anonymous callers' : 'Reject anonymous callers';
        let rejectIcon = this.props.rejectAnonymous ? 'door-closed-lock' : 'door-open';
        let isConference = false;

		const friendlyName = this.props.selectedContact ? this.props.selectedContact.uri.split('@')[0] : '';
		const conferenceUrl = `${this.props.publicUrl}/conference/${friendlyName}`;
		const conferenceRoom = `${friendlyName}`;

        if (this.props.selectedContact) {
            tags = this.props.selectedContact.tags;
            isConference = this.props.selectedContact.conference || tags.indexOf('conference') > -1;
        }

		const isFavorite = this.props.selectedContact && tags && tags.indexOf('favorite') > -1;
				
        let favoriteTitle = isFavorite ? '✓ Favorite' : 'Favorite';
        let favoriteIcon = (this.props.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'flag-minus' : 'flag';
        let autoAnswerTitle = this.props.selectedContact?.localProperties?.autoanswer ? '✓ Auto answer' : 'Auto answer';
        // [AUTO-DIALER — DEVELOPER TOOL] the menu item is gated on
        // this.props.devMode; see the matching block further down.
        let autoDialerRunning = !!(this.props.autoDialerUri
            && this.props.selectedContact
            && this.props.autoDialerUri === this.props.selectedContact.uri);
        let autoDialerTitle = autoDialerRunning ? '✓ Auto-dialer (running)' : 'Auto-dialer';
		let autoAnswerModeTitle = this.props.autoAnswerMode ? 'Turn Off Auto-answer' : 'Auto-answer Mode';
  
        let extraMenu = false;
        let importKeyLabel = this.props.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = this.state.showEditContactModal;

        let showBackButton = this.props.selectedContact || this.props.sharingAction;

        let isAnonymous = this.props.selectedContact && utils.isAnonymous(this.props.selectedContact.uri);
        let isCallableUri = !isConference && !this.props.inCall && !isAnonymous && tags.indexOf('blocked') === -1;

        let blockedTitle = (this.props.selectedContact && tags && tags.indexOf('blocked') > -1) ? 'Unblock' : isAnonymous ? 'Block anonymous callers': 'Block';
        if (isAnonymous && this.props.blockedUris.indexOf('anonymous@anonymous.invalid') > -1) {
            blockedTitle = 'Allow anonymous callers';
        }
        
        let editTitle = isConference ? "Configure..." : "Edit contact...";
        let deleteTitle = isConference ? "Remove conference" : "Delete contact...";
        let searchTitle = this.props.searchMessages ? 'End search': 'Search messages...';
        
        let subtitle = this.props.accountId;

        let organization = this.props.selectedContact ? this.props.selectedContact.organization : this.props.organization;
        let displayName = this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName;

        // Title fallback chain when no contact is selected:
        //   1. selectedContact.name (handled above)
        //   2. props.displayName — the explicitly-set display name
        //      for the active account
        //   3. beautified username portion of accountId — e.g.
        //      'ag@example.com' → 'Ag', 'john.doe@x' → 'John Doe'
        //      (prettifyName handles the casing + separator
        //      conversion identically to the contact-list rendering)
        //   4. 'Myself' as a last-resort label — only happens when we
        //      have neither a display name nor a parseable accountId.
        // "Myself" used to be the immediate fallback whenever
        // displayName was empty, which surfaced the placeholder in the
        // navbar even when the account URI was perfectly usable —
        // that's the regression this chain fixes. ContactsListBox
        // continues to use 'Myself' for the self-row label, which is
        // appropriate in that context.
        let title;
        if (this.props.selectedContact) {
            title = displayName || 'Myself';
        } else if (this.props.displayName) {
            title = this.props.displayName;
        } else if (this.props.accountId && this.props.accountId.indexOf('@') > -1) {
            const _user = this.props.accountId.split('@')[0];
            title = prettifyName(_user) || _user;
        } else {
            title = 'Myself';
        }
        // In-chat search icon: text+magnifier glyph (search MESSAGES),
        // flipping to the universal close icon while the search bar is
        // open. The contacts-list search icon was removed from the
        // navbar — the search field is always visible on the main list.
        let searchMessagesIcon = this.props.searchMessages ? 'close' : 'text-search';

		function capitalizeFirstLetter(str) {
		  if (!str) return ""; // Handle empty string
		  return str[0].toUpperCase() + str.slice(1);
		}

		// Keep in lockstep with ContactCard.prettifyName. The contacts list
		// titles run through this same transform, and if the navbar header
		// doesn't match, selecting a contact produces two different-looking
		// names — the regression the user reported. Replaces `._-`
		// separators with spaces, title-cases each word
		// (e.g. 'john.doe' -> 'John Doe', 'blue_owl' -> 'Blue Owl'), and
		// skips strings that are URIs or phone numbers.
		function prettifyName(str) {
		  if (!str) return "";
		  if (str.indexOf('@') > -1) return capitalizeFirstLetter(str);
		  if (/^[+\d][\d\s()-]*$/.test(str)) return str; // phone — leave as-is
		  const cleaned = str.replace(/[._-]+/g, ' ').trim();
		  if (!cleaned) return capitalizeFirstLetter(str);
		  return cleaned.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
		}

        if (this.props.selectedContact) {
			if (isConference) {
				// Conference rooms with a saved display name (set in
				// EditConferenceModal → app.js saveConference →
				// contacts.name column) should appear in the navbar
				// title too — the contact list and the navbar should
				// agree on what to call the room, otherwise a user
				// who renamed "ag" to "Daily Sync" sees "ag" in the
				// header bar after tapping it from the contacts list.
				// Mirrors the same prefer-name-else-local-part rule
				// used in the non-conference branch below and now
				// in ContactCard's conference branch.
				// If the room has a user-chosen display name, keep it
				// exactly as-is (just trim whitespace) — don't title-case
				// or otherwise rewrite it. prettifyName only fires when
				// we fall back to the URI local part.
				if (this.props.selectedContact.name
						&& this.props.selectedContact.name !== this.props.selectedContact.uri) {
					title = this.props.selectedContact.name.trim();
				} else {
					title = prettifyName(this.props.selectedContact.uri.split('@')[0]);
				}
				subtitle = 'Conference room';
			} else {
				// Match ContactCard: if a display name is set, render it
				// verbatim (trim only — no title-casing). Only fall back
				// to prettifyName when we derive the title from the URI
				// local part.
			    if (this.props.selectedContact.name && this.props.selectedContact.name != this.props.selectedContact.uri) {
					title = this.props.selectedContact.name.trim();
			    } else {
					title = prettifyName(this.props.selectedContact.uri.split('@')[0]);
			    }
				// Phone-number contacts: drop the SIP domain in the
				// navbar subtitle so the user sees '+40xxxx' under
				// the display name instead of '+40xxxx@sylk.link'.
				// Mirrors the same rule applied in the contact tile
				// and the AudioCallBox so all three surfaces present
				// the dialed number consistently. Either signal works
				// — utils.isPhoneNumber catches contacts that predate
				// the 'tel' tag, the tag catches anything we routed
				// through addHistoryEntry.
				const _selUri = this.props.selectedContact.uri;
				const _selTags = this.props.selectedContact.tags;
				const _isTel =
					utils.isPhoneNumber(_selUri) ||
					(Array.isArray(_selTags) && _selTags.indexOf('tel') > -1);
				subtitle = _isTel ? _selUri.split('@')[0] : _selUri;
			}

			if (utils.isAnonymous(this.props.selectedContact.uri)) {
				title = 'Anonymous caller';
			}

		}

        // Warmup-phase subtitle override. _warmupSubtitle returns null
        // unless a call is active and not yet 'established', so the
        // normal subtitle (account URI / org line / 'Conference room')
        // remains in place outside of warmup.
        const _warmupLine = this._warmupSubtitle();
        if (_warmupLine) {
            subtitle = _warmupLine;
        }

        // System-message override — actionless notifications that used
        // to render in the bottom snackbar (posted via
        // NotificationCenter.postSystemNotification and mirrored up
        // through app.js state.navbarSystemMessage). While one is
        // visible it takes over the subtitle line, trumping even the
        // warmup line: these are transient (~5 s) and usually explain
        // WHY something just happened (permission denied, call
        // rejected, …), so they must not be masked.
        const _systemMessage = this.props.systemMessage;
        if (_systemMessage) {
            subtitle = _systemMessage;
        }

        let backButtonTitle = 'Back to call';

        if (this.showBackToCallButton) {
            if (this.props.call.hasOwnProperty('_participants')) {
                backButtonTitle = 'Back to conference';
            } else {
                backButtonTitle = 'Back to call';
            }
        }

		// NavBar height + icon sizing.
		//
		// Height (`_navBarHeight`) is parameterizable so we can pick a
		// comfortable size on tablets (where 60dp looks cramped) and
		// to shrink on the cramped folded cover display.
		// Resolution order:
		//   1) explicit `navBarHeight` prop (caller decides — e.g. a
		//      future "navbar size" preference)
		//   2) folded (Razr cover display): 44 — vertical space is at
		//      a premium and the rest of the folded chrome is already
		//      smaller; the previous 60 made the navbar visibly taller
		//      than its proportion of the cover display, which read as
		//      "navbar didn't follow the fold" to the user.
		//   3) tablet: 90 (roughly 1.5× phone, enough to give icons
		//      and labels room to breathe)
		//   4) phone: 60 (legacy default)
		//
		// IconButton size on tablet is pinned to 32 so the NavBar
		// matches the call-buttons bar in ContactsListBox / ReadyBox
		// (those IconButtons render at size={32}). The 32px target is
		// intentionally independent of the bar height — eyeball
		// matching the on-screen control bar reads better than a pure
		// height-ratio scale, which would have given us ~27dp icons on
		// tablet.
		//
		// The other glyph sizes (logo, avatar, spinner, status icon,
		// title/subtitle) scale linearly with bar height. On phone the
		// scale is 1.0, so all literals match the legacy values
		// exactly. On tablet (90/60 = 1.5) the rest of the bar grows
		// in proportion to the new bar height. On folded (44/60 ≈ 0.73)
		// glyphs shrink in step with the shorter bar so nothing feels
		// disproportionately large against the new height.
		const _navBarHeight = (typeof this.props.navBarHeight === 'number' && this.props.navBarHeight > 0)
		    ? this.props.navBarHeight
		    : (this.props.isFolded ? 44 : (this.props.isTablet ? 90 : 60));
		const navIconScale = _navBarHeight / 60;
		// Pin tablet IconButtons to 32 so they match the call-buttons
		// bar (size={32}) rendered by ReadyBox. Folded/phone keep the
		// historical 18dp.
		const _isTabletBar = this.props.isTablet && !this.props.isFolded;
		const navIconBtnSize  = _isTabletBar ? 32 : 18;
		// Keep spinner / status-icon / logo / avatar proportional to
		// the IconButton size so the whole bar reads as one family.
		const navIconRatio    = navIconBtnSize / 18;
		const navSpinnerSize  = Math.round(26 * navIconRatio);
		const navStatusIconSize = Math.round(20 * navIconRatio);
		const navLogoSize     = Math.round(35 * navIconScale);
		const as = Math.round(40 * navIconScale); //avatar size
		// Kebab (overflow) menu icon — visually heavier than the
		// other navbar glyphs because three vertical dots have
		// less ink than a typical icon at the same size and tend
		// to look small / hard to hit. Bumped ~40% above the
		// regular IconButton size: 26dp on phone, 44dp on tablet.
		const navMenuIconSize = Math.round(navIconBtnSize * 1.4);

		let { width, height } = Dimensions.get('window');

		const topInset = this.props.insets?.top || 0;
		const bottomInset = this.props.insets?.bottom || 0;
		let   leftInset  = this.props.insets?.left  || 0;
		let   rightInset = this.props.insets?.right || 0;

		// On Android, during rotation safe-area-context may deliver one
		// frame with the old (portrait) insets where left/right are 0.
		// That makes the landscape NavBar render edge-to-edge for a frame
		// and its right-side icons end up behind the system nav bar.
		// Fallback strategy, in order of preference:
		//   1) Use the last non-zero landscape left/right we've seen.
		//   2) If we've never seen them, use the top/bottom insets as a
		//      proxy (since status-bar / gesture-bar area from portrait
		//      rotates to the horizontal insets in landscape).
		if (Platform.OS === 'android' && this.props.isLandscape) {
			if (leftInset > 0 || rightInset > 0) {
				this._lastLandscapeLeftInset  = leftInset;
				this._lastLandscapeRightInset = rightInset;
			} else {
				const proxy = Math.max(topInset, bottomInset, 0);
				leftInset  = this._lastLandscapeLeftInset  || proxy;
				rightInset = this._lastLandscapeRightInset || proxy;
			}
		}

        // NavBar layout (CHECKPOINT 2026-04-21, confirmed working on
        // Razr 60 Ultra in portrait and landscape). Key invariants:
        //   1) navBarContainer uses the default column flex direction.
        //      alignItems: 'stretch' (also default) then forces Paper's
        //      internal "root-layer" <View> — which receives no style
        //      from us — to span the full width of this container.
        //   2) The <Appbar.Header> below is wrapped in a
        //      SafeAreaInsetsContext.Provider with zero insets so
        //      Paper's outer wrapper stops applying
        //      paddingHorizontal: Math.max(left, right).
        //   3) appBarContainer sets paddingLeft/Right: 0 to override
        //      Paper's inner styles.appbar.paddingHorizontal = 4, so
        //      children sit flush with the header edges.
        // See /sessions/clever-brave-knuth/NAVBAR_CHECKPOINT_2026-04-21.md
        let navBarContainer = {
                              height: _navBarHeight,
                              };

		// Pull the app-bar background from the active theme. Always
		// Blink-blue across both Day / Night per the user's preference;
		// see DarkModeManager for the exact colour.
		const _theme = DarkModeManager.getTheme();
		// Asymmetric, INSET-FREE padding on the Appbar children:
		//   • LEFT — 15dp when the leading slot is the avatar /
		//     display name (so they don't hug the screen edge now
		//     that the legacy logo has moved to the brand strip).
		//     0dp when the slot is the back arrow — native iOS /
		//     Android convention is for the back chevron to sit
		//     close to the edge, and Paper's Appbar.BackAction has
		//     its own internal padding which gives it the small
		//     amount of optical breathing room it needs.
		//   • RIGHT — 0 flat, so the kebab / overflow menu sits as
		//     close to the edge as Paper's Appbar.Action allows.
		// We deliberately do NOT add leftInset / rightInset here —
		// per the historical fix documented in the comment block
		// below ("Android landscape: we used to add paddingLeft:
		// leftInset…"), the Appbar.Header keeps its horizontal
		// padding inset-free to avoid the empty-gap regression.
		const _appBarLeftPad = showBackButton ? 0 : 15;
		let appBarContainer = {
		                 backgroundColor: _theme.appBarBackground,
                         marginLeft: 0,
                         marginTop: 0,
						 height: _navBarHeight,
						 paddingLeft: _appBarLeftPad,
						 paddingRight: 0,
                 };

        // Android landscape: we used to add paddingLeft: leftInset and
        // paddingRight: rightInset here to keep the trailing icons out
        // from under the system nav bar. After fixing the rest of the
        // layout (SafeAreaInsetsContext.Provider zeroing Paper's outer
        // paddingHorizontal, red filling screen, yellow filling red),
        // those paddings became visible as empty ~43dp / ~48dp gaps
        // between the yellow edges and the logo (left) / hamburger
        // (right). The user wants content flush with the yellow edges,
        // so we no longer apply any horizontal inset padding on the
        // Appbar.Header. If the hamburger ends up clipped behind the
        // system nav bar on some landscape configurations, the proper
        // fix is to apply the inset padding on the parent that owns
        // this NavBar (app.js) or on the outer red container, not on
        // the Appbar contents.
        // (intentionally no Android-landscape padding override)

        // iOS landscape: leave the Appbar edge-to-edge and let its
        // children (logo / back button / title / menu) sit at their
        // natural positions — the logo's own marginLeft (15dp from
        // styles.logo) gives it enough breathing room from the left
        // edge of the bar, matching the rest of the app header.
        //
        // (We previously added paddingLeft: leftInset here to keep the
        // content out of the notch, but that introduced a visible gap
        // between the bar's left edge and the logo.)

		// Remount key used to force unmount/remount of the title Text
		// and the fixed-size IconButtons on fold / major-dimension
		// transitions. Motivation: on the Razr 60 Ultra the cover
		// display has a different density than the inner display, and
		// Paper's Text / IconButton appear to cache their measured
		// frames from the density they were first mounted at. Without
		// a remount, "16dp" from the inner display continued to render
		// at inner-display physical pixel size on the cover display
		// (so fonts looked too big until an unrelated prop change
		// unmounted/remounted the Text). Keying on isFolded +
		// (rounded) window width/height is cheap and remounts only a
		// small sub-tree, leaving Menu/modal state untouched.
		const _navRemountKey = (!!this.props.isFolded ? 'f' : 'u')
			+ '-' + Math.round(width) + 'x' + Math.round(height);

		// Diagnostic: log the NavBar layout numbers once at startup and
		// again only when they change, so we can see exactly what the
		// component is using on landscape/portrait/fold transitions.
		const _layoutKey = [
			Math.round(width), Math.round(height),
			Math.round(leftInset), Math.round(rightInset), Math.round(topInset),
			Math.round(appBarContainer.width || 0),
			Math.round(appBarContainer.marginLeft || 0),
			Math.round(appBarContainer.paddingLeft || 0),
			Math.round(appBarContainer.paddingRight || 0),
			this.props.isLandscape ? 'L' : 'P'
		].join(',');
		// Diagnostic (disabled — re-enable to debug NavBar layout issues):
		// if (this._loggedNavLayoutKey !== _layoutKey) {
		// 	console.log('[FoldUI] NavBar layout',
		// 				this._loggedNavLayoutKey === undefined ? 'init' : 'change',
		// 				'window=', Math.round(width), 'x', Math.round(height),
		// 				'insets L/R/T=', Math.round(leftInset), '/', Math.round(rightInset), '/', Math.round(topInset),
		// 				'bar.width=', Math.round(appBarContainer.width || 0),
		// 				'bar.marginLeft=', Math.round(appBarContainer.marginLeft || 0),
		// 				'bar.paddingL/R=', Math.round(appBarContainer.paddingLeft || 0), '/', Math.round(appBarContainer.paddingRight || 0),
		// 				'landscape=', !!this.props.isLandscape);
		// 	this._loggedNavLayoutKey = _layoutKey;
		// }
        // ─── Brand strip ───────────────────────────────────────────
        // Slim row above the Appbar carrying the Blink logo and
        // "Sylk Mobile" wordmark. It sits OUTSIDE the existing
        // Appbar.Header so adding it didn't disturb any of the
        // hard-won Appbar layout maths above. Both rows live inside
        // a column container; the combined height is reported via
        // onAppBarHeightChange so ContactsListBox's
        // KeyboardAvoidingView still gets the right offset.
        //
        // Padding matches the visual margin of the kebab (Appbar.Action
        // ≈ 15dp internal padding to the screen edge) plus the safe-
        // area insets so on iOS landscape with notch / Dynamic Island
        // the title isn't squashed under the cutout. Without the
        // leftInset addition the wordmark sat hard against the screen
        // edge — that was the "too close to the edge" complaint.
        // Brand strip is hidden in landscape — vertical pixels are
        // scarce in that orientation and the wordmark is decorative,
        // not functional. Setting the effective height to 0 collapses
        // both the rendered row AND the combined-container height /
        // onAppBarHeightChange report so the chat panel's
        // KeyboardAvoidingView offset stays accurate.
        // Also hidden on folded (cover-display) layouts — the cover
        // screen has even less vertical room than landscape phones,
        // and the user reported the strip was eating space above
        // the contacts list there.
        // Brand strip is now hidden on every platform — Android included
        // (previously the strip was an Android-only affordance). Forced
        // off so the vertical space is reclaimed everywhere.
        const _showBrandStrip = false;
        // 26dp: leaves room for an 18dp logo + 13dp wordmark
        // text without feeling like a second header band above
        // the navbar. The previous 34dp felt too thick.
        const _brandStripHeight = _showBrandStrip ? 26 : 0;
        // Edge padding for the brand strip — generous enough that the
        // logo doesn't hug the screen edge but tight enough that it
        // still reads as "row pinned to top-left", not "centered
        // header". 12dp on top of any safe-area inset (notched
        // iPhones, foldables in landscape) keeps the logo at a
        // comfortable optical margin without pushing the wordmark
        // toward the centre of the bar.
        const _brandStripEdgePad = 12;
        const _brandStripStyle = {
            height: _brandStripHeight,
            width: '100%',
            // Brand strip reflects the THEME background (white in Day,
            // dark in Night) — distinct from the Blink-blue navbar
            // below so the top of the app reads as "screen surface
            // with branding strip" rather than a double-decker
            // coloured header. See DarkModeManager DAY_THEME /
            // NIGHT_THEME for the exact colours.
            backgroundColor: _theme.brandStripBackground,
            paddingLeft: _brandStripEdgePad + leftInset,
            paddingRight: _brandStripEdgePad + rightInset,
            flexDirection: 'row',
            alignItems: 'center',
        };
        const _brandLogoStyle = {
            width: 18,
            height: 18,
            marginRight: 6,
        };
        const _brandTitleStyle = {
            color: _theme.brandStripText,
            fontSize: 13,
            // Explicit '400' (Regular) — on Android, fontWeight:
            // 'normal' can still resolve to Roboto Medium when the
            // parent (Paper Text) has its own medium-weight default.
            // Pinning the numeric weight + textTransform:none guards
            // against that and keeps the wordmark visually light.
            fontWeight: '400',
            textTransform: 'none',
            letterSpacing: 0.3,
        };
        // No fixed-height wrapper. The previous implementation wrapped
        // the brand strip + navBarContainer in a parent View with an
        // explicit `height: _navBarHeight + _brandStripHeight`. That
        // worked in isolation, but the Appbar.Header that lives inside
        // navBarContainer has its own intrinsic height contributions
        // from react-native-paper's outer wrapper, which made the
        // wrapper's nominal 94dp height under-count the rendered
        // height. The result was the rest of the ready-view content
        // (search bar, source pills, sort row, chat / contacts list)
        // sliding UP UNDER the navbar by ~34dp because the parent
        // flex flow only reserved 60dp for NavigationBar.
        //
        // Returning a Fragment instead lets the brand strip and the
        // existing navBarContainer participate as DIRECT siblings in
        // the parent's flex flow. Each one contributes its intrinsic
        // height and the parent stacks them with no nested-wrapper
        // mis-measurement — same as the pre-brand-strip layout, just
        // with one extra row at the top.

        return (

			<Fragment>
            {/* Brand strip — Blink logo + "Sylk Mobile" wordmark.
                Themed to match the Appbar so the two rows read as a
                single header block. Hidden in landscape to reclaim
                vertical space (the wordmark is decorative, not
                functional). */}
            {_showBrandStrip ? (
                <View style={_brandStripStyle}>
                    <Image source={blinkLogo} style={_brandLogoStyle} />
                    <Text style={_brandTitleStyle}>Blink</Text>
                </View>
            ) : null}
            <View style={navBarContainer}
			      >
            {/*
              react-native-paper v5's Appbar.Header wraps its content in an
              outer "root-layer" <View> that calls useSafeAreaInsets() and
              applies paddingTop: statusBarHeight ?? top and, critically,
              paddingHorizontal: Math.max(left, right). On Android landscape
              on the Razr, that outer wrapper was eating ~48dp on each side
              and centring our (yellow-bordered) inner Appbar inside the red
              navBarContainer. We already handle insets ourselves, so we
              override the safe-area context for just this subtree with
              zero insets. That zeroes out Paper's paddingTop and
              paddingHorizontal and lets our appBarContainer style (applied
              as restStyle on the inner Appbar) span the full width.
            */}
            <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
            {/* Appbar.Header intentionally has NO remount key. Two
                earlier attempts both produced regressions:
                  • key=_navRemountKey (fold + live window dims) caused
                    spurious remounts on Android dimension flickers,
                    leaving the contacts list overlapping the navbar
                    in non-folded steady-state.
                  • key='appbar-header-' + (isFolded?'f':'u') still
                    produced overlap AND didn't actually rescale the
                    cover display on fold — suggesting the issue is
                    upstream (a parent View not updating its measured
                    width on fold), not Paper's Appbar.Header.
                If you re-introduce a remount key here, also tackle
                the parent layout chain that survives the transition
                or you'll just move the symptom. */}
            <Appbar.Header
                 style={appBarContainer}
                 statusBarHeight={0}
                 /* App bar is always Blink-blue across both themes
                    now, so dark={true} permanently — Paper renders
                    white icon / text glyphs on the dark blue
                    background regardless of which theme is active. */
               dark
                 onLayout={(e) => {
                     // Measure the actual Appbar.Header height so the
                     // chat panel's KeyboardAvoidingView can compute a
                     // correct keyboardVerticalOffset (= topInset +
                     // measured Appbar height) instead of using the
                     // hardcoded 60dp fallback in ContactsListBox.
                     // Reported up to app.js (which owns ReadyBox →
                     // ContactsListBox in the tree) via the
                     // onAppBarHeightChange callback. Add the brand
                     // strip height so the reported value covers the
                     // FULL header block (brand strip + Appbar).
                     const h = Math.round(e.nativeEvent.layout.height) + _brandStripHeight;
                     if (h && h !== this.state.appBarMeasuredHeight) {
                         this.setState({ appBarMeasuredHeight: h });
                         if (typeof this.props.onAppBarHeightChange === 'function') {
                             this.props.onAppBarHeightChange(h);
                         }
                     }
                 }}
                 >
  
                {/* When there's no back button the bar used to render
                    the Blink logo here. The logo now lives in the
                    dedicated brand strip above the Appbar, so we
                    render nothing in this slot when not in back-button
                    mode — keeping it would duplicate the logo and push
                    the avatar / title further off the left edge. */}
                {showBackButton ?
                <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                : null}

				{this.props.selectedContact ?
					<View style={styles.avatarContent}>
						{this.props.selectedContact.photo ||
						!this.props.selectedContact.email ? (
							<UserIcon size={as} identity={this.props.selectedContact}/>
						) : (
							<Gravatar options={{email: this.props.selectedContact.email, parameters: { "size": as, "d": "mm" }, secure: true}} style={[styles.gravatar, {width: as, height: as}]} />
						)}
					</View>
				: null}

                <SylkAppbarContent
                    key={'title-' + _navRemountKey}
                    title={title}
                    subtitle={subtitle}
                    /* App bar background is always Blink-blue (see
                       DarkModeManager's appBarBackground), so force
                       the title to white explicitly. Relying on
                       Paper's `dark` prop for the colour resolution
                       wasn't always reliable here — the title
                       rendered dark on the user's device against the
                       blue bar — so we pin the colour at the call
                       site. */
                    /* Title: bold per user preference (the own-
                       account name and selected-contact name should
                       stand out from the surrounding chrome).
                       Subtitle uses '400' (Regular) so the URI /
                       organisation line reads as secondary text —
                       explicit numeric weight because Android maps
                       'normal' to Medium under Paper's defaults. */
                    titleStyle={[titleStyle, { marginLeft: 0, color: 'white', fontWeight: 'bold' }]}
                    subtitleStyle={[subtitleStyle, { marginLeft: 0, color: 'white', fontWeight: '400' }]}
                />

               { this.props.isTablet && this.props.syncPercentage != 100 ?
				<View style={{ flexDirection: 'column', flexShrink: 1, alignItems: 'center'}}>
				  <Progress.Bar
					progress={this.props.syncPercentage / 100 }
					width={150}         // smaller width for inline look
					height={6}
					borderRadius={3}
					borderWidth={0}
					color={"blue"}
					unfilledColor="white"
					style={{ marginRight: 10, marginTop: 10 }}  // small gap from label
				  />
				  <Text
					style={{
					  fontSize: 12,
					  color: 'orange',
					  marginTop: 2,
					}}
				  >
					Replay journal: {Math.round(this.props.syncPercentage)}%
				  </Text>
				</View>
				   : null }

				{/* "Back to call" / "Back to conference" button removed —
				    the navbar's own back affordances (and the global
				    call-overlay) already surface that action, so this
				    second red button in the title bar was redundant.
				    showBackToCallButton is still computed because other
				    code paths read it; only the visible button here
				    has been dropped. */}

                { false && !this.props.rejectNonContacts && ! this.props.selectedContact?
                <IconButton
                    style={styles.whiteButton}
                    size={navIconBtnSize}
                    disabled={false}
                    onPress={this.props.toggleRejectAnonymous}
                    icon={rejectIcon}
                />
                : null}

                {/* First-sync activity indicator — sits immediately to
                    the LEFT of the search icon while we're waiting for
                    the server to respond to a sync request (set in
                    app.js between requestSyncConversations and the
                    matching server response, with a 15s safety
                    timeout). Sized to match the adjacent IconButton(s)
                    so the toolbar layout doesn't shift when it appears
                    or disappears: react-native-paper's IconButton with
                    size=18 renders a 34x34 container with an 18px
                    icon, so we mirror those exact dimensions here.
                    On Android `size` accepts a number; on iOS only
                    'small' | 'large', so we Platform.select to keep
                    the on-screen footprint equal across both. */}
               {/* Combined DND bell + journal-sync indicator. One slot
                   in the navbar instead of two: the bell renders its
                   normal glyph (bell or bell-off) and, while the first
                   journal sync is in flight, a circular ActivityIndicator
                   rings the outer edge of the bell. No separate spinner
                   icon anymore — when sync finishes the ring fades and
                   the bell remains in place. Tap still toggles DND
                   regardless of sync state.
                   Visibility = (bell-visible) OR firstSyncPending. The
                   bell's normal hide cases (a contact is selected /
                   search active / call active / location-share active)
                   are preserved for THE BELL ITSELF, but the sync ring
                   is informational and should appear whenever a sync
                   is happening, even when the bell would otherwise be
                   hidden. So in those hidden-bell states we still drop
                   the slot — if needed later we can render a tiny
                   "sync-only" pill in another corner. */}
               {(() => {
                   // Bell (DND toggle + first-sync indicator). Was
                   // temporarily hidden behind this kill switch;
                   // revived per user request — flip to false to
                   // hide it again.
                   const _SHOW_BELL = true;
                   if (!_SHOW_BELL) return null;
                   const _activeShares = Object.keys(this._activeShares() || {}).length;
                   const _bellVisible = !this.props.selectedContact
                       && !this.props.searchContacts
                       && !this.props.callActive
                       && _activeShares === 0;
                   if (!_bellVisible) return null;
                   // Spinner diameter has to clear Paper's IconButton
                   // circular footprint, which is roughly
                   // navIconBtnSize + 16 (icon size + 8dp padding on
                   // each side). At only 1.4× the icon size the
                   // spinner landed INSIDE the bell's circle. +20
                   // puts it clearly outside the IconButton ripple
                   // bounds while still keeping the overall slot
                   // tight enough to fit next to the search / kebab
                   // icons.
                   const _ringSize = navIconBtnSize + 20;
                   // Outer container has to be a few px larger than
                   // the spinner so the indicator's stroke doesn't
                   // get clipped by the slot edges.
                   const _box = _ringSize + 4;
                   return (
                       <View
                           key={'bell-' + _navRemountKey}
                           style={{
                               width: _box,
                               height: _box,
                               // Align the bell glyph with the other
                               // right-side navbar icons (e.g. the
                               // search-messages icon shown when a
                               // contact is selected). A plain Paper
                               // IconButton occupies (navIconBtnSize
                               // + 16) plus its default 6dp margin on
                               // each side (styles.whiteButton doesn't
                               // override margin). This slot is _box =
                               // navIconBtnSize + 24 wide (room for
                               // the sync ring) — 4dp wider per side —
                               // so give it 6 - 4 = 2dp side margins
                               // to put the bell's centre exactly
                               // where the search icon's centre sits.
                               // The spinning ring may overflow the
                               // 2dp gap slightly — harmless, it's
                               // pointerEvents:none.
                               marginHorizontal: 2,
                               alignItems: 'center',
                               justifyContent: 'center',
                           }}
                       >
                           {(this.props.firstSyncPending || this.props.journalSyncActive) ? (
                               // Wrapper View takes the absolute layer
                               // and centers the indicator inside it.
                               // PaperActivityIndicator doesn't honour
                               // bare absolute positioning with all
                               // edges set to 0 — its size prop wins
                               // and the result lands at the parent's
                               // top-left. A flex-centred wrapper that
                               // fills the parent puts the spinner
                               // precisely on top of the bell glyph.
                               // pointerEvents="none" so taps fall
                               // through to the IconButton — the user
                               // can still toggle DND mid-sync.
                               <View
                                   key={'bell-sync-' + _navRemountKey}
                                   pointerEvents="none"
                                   style={{
                                       position: 'absolute',
                                       left: 0,
                                       right: 0,
                                       top: 0,
                                       bottom: 0,
                                       alignItems: 'center',
                                       justifyContent: 'center',
                                   }}
                               >
                                   <PaperActivityIndicator
                                       size={_ringSize}
                                       color="#2196F3"
                                       animating={true}
                                   />
                               </View>
                           ) : null}
                           <IconButton
                               style={bellStyle}
                               size={navIconBtnSize}
                               disabled={false}
                               onPress={this.props.toggleDnd}
                               icon={bellIcon}
                           />
                           {/* SIP error-code badge. Rendered at the
                               bottom-left of the bell when the most
                               recent REGISTER attempt failed with a
                               3-digit SIP status code (e.g. 403,
                               401, 408). Cleared by App.js as soon
                               as registrationState becomes
                               'registered' again. pointerEvents=none
                               so taps still reach the bell.

                               408 (Request Timeout) is suppressed
                               here — it's a transient network/proxy
                               timeout that recovers on its own and
                               surfacing it on the bell was adding
                               noise rather than signal. */}
                           {this.props.registerErrorCode && Number(this.props.registerErrorCode) !== 408 ? (
                               <View
                                   pointerEvents="none"
                                   style={{
                                       position: 'absolute',
                                       left: 0,
                                       bottom: -3,
                                       minWidth: 18,
                                       paddingHorizontal: 3,
                                       paddingVertical: 1,
                                       borderRadius: 4,
                                       backgroundColor: '#b22',
                                       alignItems: 'center',
                                       justifyContent: 'center',
                                   }}
                               >
                                   <Text
                                       style={{
                                           color: 'white',
                                           fontSize: 9,
                                           fontWeight: 'bold',
                                           lineHeight: 11,
                                       }}
                                       numberOfLines={1}
                                   >
                                       {this.props.registerErrorCode}
                                   </Text>
                               </View>
                           ) : null}
                       </View>
                   );
               })()}

                {/* Search-messages icon (within the open chat only).
                    Positioned so it sits immediately to the LEFT of
                    the kebab menu. Stays visible during an active call
                    too — the user often wants to look up a previous
                    message while a conference is up.

                    The contacts-list search icon exists only on phone
                    landscape (see below) — everywhere else the search
                    field is always visible on the main list, so there
                    is nothing to toggle from the navbar. */}
                {this.props.selectedContact ?
                    // Hide the "search messages" icon on the cover display —
                    // the NavBar is too cramped to also host a search UI there.
                    (this.props.isFolded ? null :
                    <IconButton
                        key={'search-msg-' + _navRemountKey}
                        style={[styles.whiteButton ]}
                        size={navIconBtnSize}
                        disabled={false}
                        onPress={this.props.toggleSearchMessages}
                        icon={searchMessagesIcon}
                    />)
                : null}

                {/* Contacts-list search icon — PHONE LANDSCAPE ONLY.
                    In that orientation vertical pixels are scarce, so
                    ReadyBox hides the always-visible search field (see
                    ReadyBox#showSearchBar) and this icon takes over:
                    tapping it toggles searchContacts, which brings the
                    search bar back for the duration of the search. The
                    icon flips to the universal close glyph while search
                    is active. Portrait phones, tablets and folded cover
                    displays keep the always-visible field and never
                    show this icon. Hidden in invite-to-conference mode,
                    which pins its own picker search bar to the list. */}
                {(!this.props.selectedContact
                    && !this.props.inviteContacts
                    && this.props.isLandscape
                    && !this.props.isTablet
                    && !this.props.isFolded) ?
                    <IconButton
                        key={'search-contacts-' + _navRemountKey}
                        style={styles.whiteButton}
                        size={navIconBtnSize}
                        disabled={false}
                        onPress={this.props.toggleSearchContacts}
                        icon={this.props.searchContacts ? 'close' : 'magnify'}
                        accessibilityLabel={this.props.searchContacts ? 'Close search' : 'Search contacts'}
                    />
                : null}

               { (!this.props.selectedContact && !this.props.searchContacts && false) ?
                <IconButton
                    style={styles.whiteButton}
                    size={navIconBtnSize}
                    disabled={false}
                    onPress={this.conferenceCall}
                    icon="account-group"
                />
                : null}

 
                {statusColor == 'greenXXX' ?
                    <Icon name={statusIcon} size={navStatusIconSize} color={statusColor} />
                : null }

                {/* Active-location-share indicator. Rendered on every
                    screen (contact list AND individual chat) so the user
                    always has a clear, single-tap way to see and stop
                    ongoing shares. The icon pulses via Animated.Value
                    (_activeSharePulse) so it's visually distinct from
                    the static NavBar buttons — matches the product
                    brief of "a spinner or some activity icon". We tint
                    the circle red because a live location feed is a
                    persistently sensitive action we want the user to
                    notice, not blend in. */}
                {/* Pulsing "Back to call" indicator. Replaces the inline
                    Back-to-call button that used to sit above the chat
                    container in ReadyBox — that approach shifted the
                    chat layout (and therefore the keyboard offset) every
                    time a call started or ended. A small green pulsing
                    phone icon in the NavBar conveys the same "you have a
                    call in progress, tap to return" message without
                    moving any layout. Tap routes back to the call view
                    via the same handler the inline button used. Pulse
                    animation is shared with the location-share indicator
                    via _activeSharePulse so simultaneous call+share
                    breathe in unison.

                    Gated on `callActive` (state === 'established'), not
                    `inCall` (any call lifecycle): we only want to nudge
                    the user back when audio is actually flowing — while
                    the call is still ringing or proceeding the call
                    screen itself is the primary surface and a NavBar
                    pulse there would be noise. */}
                {this.props.callActive ?
                    <Animated.View style={{ opacity: this._activeSharePulse }}>
                        <IconButton
                            key={'back-to-call-' + _navRemountKey}
                            size={navIconBtnSize}
                            iconColor="white"
                            containerColor="rgba(40, 167, 69, 0.95)"
                            icon="phone-in-talk"
                            accessibilityLabel="Call in progress — tap to return"
                            onPress={this.props.goBackToCallFunc}
                        />
                    </Animated.View>
                : null}

                {(() => {
                    // The NavBar indicator is the fallback signal when the
                    // user is NOT already looking at the chat whose share
                    // is running — in that case the ReadyBox "Share
                    // location" button is pulsing instead and a second
                    // pulsing icon in the header would be redundant (and
                    // noisy, since they're inches apart). So:
                    //   • 0 shares       → hide (nothing to indicate)
                    //   • 1 share, with
                    //     the selected
                    //     contact        → hide (ReadyBox is pulsing)
                    //   • 1 share, with
                    //     a DIFFERENT
                    //     contact        → show (user can't see ReadyBox)
                    //   • >1 shares      → always show (manage-many UI)
                    // Merged, mirror-inclusive share list: local broadcaster
                    // shares PLUS shares mirrored from another of our devices.
                    // Using this (not activeLocationShares) means a secondary
                    // device that only mirrors a sibling's share still shows
                    // the pulse and can open the stop panel.
                    const shareMap = this.getActiveSharesForModal();
                    const keys = Object.keys(shareMap);
                    const count = keys.length;
                    if (count === 0) return null;
                    const selectedUri = this.props.selectedContact
                        && this.props.selectedContact.uri;
                    if (count === 1 && selectedUri && keys[0] === selectedUri) {
                        return null;
                    }
                    return (
                        <Animated.View style={{ opacity: this._activeSharePulse }}>
                            <IconButton
                                key={'active-location-' + _navRemountKey}
                                size={navIconBtnSize}
                                iconColor="white"
                                containerColor="rgba(220, 53, 69, 0.95)"
                                icon="map-marker-radius"
                                accessibilityLabel={
                                    count === 1
                                        ? 'Location sharing active — tap to stop'
                                        : `Location sharing active to ${count} contacts — tap to manage`
                                }
                                onPress={() => { this._dumpActiveShareSessions(); this.setState({showActiveSharesModal: true, activeSharesFilterUri: null}); }}
                            />
                        </Animated.View>
                    );
                })()}

                { /* Hide the kebab / overflow menu only while the
                     in-chat messages-search is active. The main
                     (contacts-list) kebab stays visible during
                     contacts search — the search field is always
                     shown there now, so hiding the menu would leave
                     the navbar without its primary actions. */ }
                { !this.props.searchMessages ?
                  (this.props.selectedContact ?
                    <Menu theme={getMenuTheme().menuTheme}
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: false, keyMenuVisible: false, storageMenuVisible: false, settingsMenuVisible: false})}
                        // Round the dropdown surface. Paper defaults the menu
                        // to theme.roundness (which reads rectangular here);
                        // contentStyle is applied last on the menu Surface, so
                        // borderRadius here wins. overflow:hidden clips the
                        // first/last Menu.Item press ripple to the rounded
                        // corners (safe on Android — the elevation shadow is
                        // drawn outside the bounds regardless).
                        contentStyle={styles.roundedMenu}
                        // Push the dropdown down by the device's top
                        // safe-area inset so the topmost items don't
                        // get eclipsed by the camera cutout / notch /
                        // dynamic island. Paper's Menu anchors near
                        // the top of the screen on Android and would
                        // otherwise render right under the camera.
                        style={topInset ? {marginTop: topInset} : null}
                        anchor={
                            <Appbar.Action
                                ref={this.menuRef}
                                color="white"
                                icon="menu"
                                size={navMenuIconSize}
                                style={this.props.isFolded ? {marginLeft: 12} : null}
                                onPress={() => { this.setState({menuVisible: !this.state.menuVisible}); }}
                            />
                        }
                    >

                        { false ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('searchMessages')} icon="search" title={searchTitle}/> : null}

						{ !this.props.searchMessages && !isAnonymous && !(this.props.isFolded && this.props.selectedContact) ?
						<Menu.Item theme={getMenuTheme().menuTheme}
							onPress={() => this.handleMenu('editContact')}
							icon="account"
							title={editTitle}
						/>
						: null}

						{isCallableUri && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
						: null}

                        {isCallableUri ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/> :null}
                        {isCallableUri ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('video')} icon="video" title="Video call"/> :null}

                        {/* ─── AUTO-DIALER — DEVELOPER TOOL ───────────────────
                            Soak-tests calls to this contact in a loop so leaks
                            and ANRs can be hunted from the logs. Media, redial
                            gap and hangup delay are chosen in AutoDialerModal;
                            failed calls fall through to the app's own 5s
                            auto-redial (changeRoute / outgoing_connection_failed).
                            Pressing the hangup button yourself stops the loop.

                            Gated on Developer mode (Preferences → Advanced →
                            Developer). It dials on its own, so it must not sit
                            one tap away from a normal user's contact menu.

                            Grep a run with:  grep '\[autodialer\]' release.log
                            ──────────────────────────────────────────────── */}
                        {this.props.devMode && isCallableUri && !this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleAutoDialer')} icon="reload" title={autoDialerTitle}/> :null}
                        {isCallableUri ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('conferenceCallNow')} icon="account-group" title="Conference call"/> :null}
                        {tags.indexOf('blocked') === -1 && this.props.canSend() && !this.props.inCall && isConference ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {tags.indexOf('blocked') === -1 && !this.props.inCall && isConference ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('shareConferenceLinkModal')} icon="share-variant" title="Share link..."/> :null}

                        {/* Location group — Share / Request items only.
                            Bracketed by Dividers ABOVE and BELOW when
                            visible. Gated on contact-state predicates
                            (key present, bidirectional chat, not blocked,
                            etc.). The Location privacy policy entry used
                            to live alongside these but moved to the
                            general (no-contact-selected) kebab; it's a
                            device-wide setting and doesn't need to live
                            inside every per-contact menu. */}
                        {(() => {
                            const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                            // "sharing" drives the Share↔Stop menu label. Treat a
                            // share active on another of our devices (mirrored
                            // here) as sharing too, so a secondary device can end it.
                            const sharing = !!(_uri && (this._activeShares()[_uri] || this._isShareActiveRemote(_uri)));
                            const hasContactKey = !!(
                                this.props.selectedContact &&
                                this.props.selectedContact.publicKey
                            );
                            const bidir = this._hasBidirectionalChat(_uri);
                            // Self chat: sharing my own location to my own
                            // account is allowed. It's exempt from the
                            // bidirectional-chat requirement (a self chat is
                            // structurally never bidirectional — every self
                            // message is `outgoing`) and, unlike the other
                            // per-contact menu items, `myself` does NOT hide
                            // the location-share entry. Mirrors the same
                            // self-exemption in ReadyBox.showLocationShareButton
                            // that surfaces the button under the navbar. The
                            // "Until we meet" option is hidden for self in the
                            // modal itself (a meet-up with yourself is moot).
                            const isSelf = this.myself;
                            const contactOk =
                                tags.indexOf('blocked') === -1
                                && !isConference
                                && !isAnonymous
                                && (isSelf || !this.myself)
                                && this.props.canSend
                                && this.props.canSend();
                            const shareItemsVisible = contactOk
                                && (sharing || hasContactKey)
                                && (sharing || bidir || isSelf);
                            if (!shareItemsVisible) return null;
                            // While a share is active for this contact,
                            // expose Pause / Resume directly on the chat
                            // header alongside Stop. Without this the
                            // user has to dig into the bubble's kebab to
                            // pause — easy to miss, and inconsistent
                            // with how Stop is one-tap from here. State
                            // comes straight off the in-memory entry
                            // (this.outgoingLocationSessions[uri].paused) so the
                            // menu reflects what the share is ACTUALLY
                            // doing, not what activeLocationShares
                            // (which only tracks expiresAt) would
                            // imply.
                            const _liveEntry = sharing
                                && this.outgoingLocationSessions
                                && this.outgoingLocationSessions[_uri];
                            const _isPaused = !!(_liveEntry && _liveEntry.paused);
                            return (
                                <React.Fragment>
                                    <Divider />
                                    {!sharing ? (
                                        <Menu.Item theme={getMenuTheme().menuTheme}
                                            onPress={() => this.handleMenu('shareLocation')}
                                            icon="map-marker"
                                            title="Share location..."
                                        />
                                    ) : (
                                        <React.Fragment>
                                            {/* Pause / Resume sit ABOVE
                                                Stop so the destructive
                                                action is the last one
                                                in the group — same
                                                ordering convention as
                                                "Edit / … / Delete" on
                                                other contextual menus. */}
                                            {_isPaused ? (
                                                <Menu.Item theme={getMenuTheme().menuTheme}
                                                    onPress={() => this.handleMenu('resumeLocation')}
                                                    icon="play"
                                                    title="Resume sharing"
                                                />
                                            ) : (
                                                <Menu.Item theme={getMenuTheme().menuTheme}
                                                    onPress={() => this.handleMenu('pauseLocation')}
                                                    icon="pause"
                                                    title="Pause sharing"
                                                />
                                            )}
                                            <Menu.Item theme={getMenuTheme().menuTheme}
                                                onPress={() => this.handleMenu('shareLocation')}
                                                icon="map-marker-off"
                                                title="Stop sharing location"
                                            />
                                        </React.Fragment>
                                    )}
                                    {/* Request location is only useful
                                        when there's no live share in
                                        flight — once we're already
                                        sharing, the peer has our
                                        position; asking for theirs
                                        instead is a separate flow. */}
                                    {!sharing && bidir ? (
                                        <Menu.Item theme={getMenuTheme().menuTheme}
                                            onPress={() => this.handleMenu('requestLocation')}
                                            icon="map-marker-question"
                                            title="Request location"
                                        />
                                    ) : null}
                                    {/* DEBUG: one location-simulator entry.
                                        Starts the walker that matches the
                                        ACTIVE share's mode — round-trip for
                                        "Until I return", convergence for a
                                        meet-up, or an outward track walk for
                                        a share-by-interval / fixed share —
                                        and toggles to stop. Driven by the
                                        "Location simulator" preference
                                        (Preferences → Location); one-shot
                                        shares (no trail) are excluded. The
                                        contact-eligibility gating is already
                                        applied by shareItemsVisible above. */}
                                    {sharing
                                            && this.props.locationSimulatorEnabled
                                            && _liveEntry
                                            && (_liveEntry.kind === 'untilIReturn'
                                                || _liveEntry.kind === 'fixed'
                                                || _liveEntry.kind === 'meetingRequest'
                                                || _liveEntry.kind === 'meetingAccept')
                                        ? (
                                            <Menu.Item theme={getMenuTheme().menuTheme}
                                                onPress={() => this.handleMenu('simulateToggle')}
                                                icon={this.isAnySimulating() ? 'stop' : 'play'}
                                                title={this.isAnySimulating() ? 'Stop simulator' : 'Start simulator'}
                                            />
                                        ) : null}
                                </React.Fragment>
                            );
                        })()}

                        {/* Location sessions — opens the ActiveLocationSharesModal
                            scoped to this contact so the user can review every
                            live location session (meet + share) and stop the ones
                            they own. Shown whenever at least one location session
                            is live for this contact (locally or mirrored from
                            another device), independent of the Share/Stop items
                            above (which only cover the plain outgoing share). */}
                        {(() => {
                            const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                            if (!_uri) return null;
                            const _types = (this._locationEngine
                                && typeof this._locationEngine.getStartableLiveTypes === 'function')
                                ? this._locationEngine.getStartableLiveTypes(_uri)
                                : { meet: false, share: false };
                            const _hasLive = _types.meet || _types.share || this._isShareActiveRemote(_uri);
                            if (!_hasLive) return null;
                            return (
                                <Menu.Item theme={getMenuTheme().menuTheme}
                                    onPress={() => this.handleMenu('locationSessions')}
                                    icon="map-marker-multiple"
                                    title="Location sessions..."
                                />
                            );
                        })()}
                        {!(this.props.isFolded && this.props.selectedContact) ? <Divider /> : null}

                        { !this.props.searchMessages && this.hasMessages && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme}
                            onPress={() => this.handleMenu('deleteMessages')}
                            icon="delete"
                            title="Delete messages..."
                        />
                        : null
                        }

                        {!this.props.searchMessages && this.hasFiles && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('deleteFileTransfers')} icon="delete" title="Delete files..."/>
                        : null
                        }

                        { !this.props.searchMessages && this.hasFiles && !this.props.inCall && 'paused' in this.props.contentTypes ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('resumeTransfers')} icon="delete" title="Resume transfers"/>
                        : null
                        }

						{!isConference && !this.props.searchMessages && this.props.publicKey && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
                        : null}

                        { (this.refetchMessagesForDays != 0) ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

                        {!isConference && !this.props.searchMessages && this.props.publicKey && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

                        {!isConference && !this.props.searchMessages && this.hasMessages && tags.indexOf('test') === -1 && !isConference && !this.myself && !isAnonymous && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}

                        {!this.myself && !this.props.searchMessages && !isAnonymous && tags.indexOf('blocked') === -1 && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}

                        {!isAnonymous && !isConference && !this.myself && !this.props.searchMessages && tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1 && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Divider />
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleAutoAnswer')} title={autoAnswerTitle}/>
                        : null}

                        {/* Caregiver — no longer offered here. It is a
                            favorite-only attribute and is now edited as a
                            dedicated group toggle inside EditContactModal
                            (see the Caregiver PlatformToggle there). The
                            kebab only carries the favorite/auto-answer
                            quick toggles now. */}

                        {!this.props.inCall && !isFavorite && !this.myself && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
                        : null}

                        {!this.props.inCall && !isFavorite && !this.myself && !isAnonymous && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('deleteContact')} icon="delete" title={deleteTitle}/>
                        : null}

                        {/* Anonymous / guest pseudo-contact: deleting it is
                            pointless (the next anonymous call recreates the
                            collapsed anonymous@anonymous.invalid row), so the
                            Delete item is hidden above and we offer blocking
                            instead. This toggles privacy.rejectAnonymous, which
                            BOTH the JS incoming-call path (autoRejectIncomingCall)
                            and the native FCM push service honour — so anonymous
                            callers are rejected even when the app is backgrounded.
                            (blockedUris can't cover this: it matches the raw
                            per-call <uuid>@guest URI, not the collapsed contact.) */}
                        {isAnonymous && !this.props.inCall && !this.props.searchMessages && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('anonymous')} icon="block-helper" title={this.props.rejectAnonymous ? 'Allow anonymous callers' : 'Block anonymous callers'}/>
                        : null}

                    </Menu>
                :
                    <Menu theme={getMenuTheme().menuTheme}
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: false})}
                        contentStyle={styles.roundedMenu}
                        // See the marginTop comment on the contact-
                        // mode menu above — same camera-cutout fix.
                        style={topInset ? {marginTop: topInset} : null}
                        anchor={
                            // No kebab in the Deleted / Graveyard views — those
                            // offer their own per-contact actions (Restore /
                            // Proceed / Revive / Eject), not the main menu.
                            (this.props.activeContactsFilter === 'deleted' || this.props.activeContactsFilter === 'graveyard')
                            ? <View />
                            : <Appbar.Action
                                ref={this.menuRef}
                                color="white"
                                icon="menu"
                                size={navMenuIconSize}
                                style={this.props.isFolded ? {marginLeft: 12} : null}
                                onPress={() => { this.setState({menuVisible: !this.state.menuVisible}); }}
                            />
                        }
                    >
                        {/* Add contact / Join conference — promoted to the
                            top of the main menu as the two most-used
                            actions. Add contact stays available while a
                            call is active (purely local address-book UI);
                            both keep the folded-layout guard. */}
                        {!(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                         : null }

                        {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}

                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }

                        {/* DND toggle removed from the kebab menu — the
                            bell glyph in the navbar header remains the
                            single entry point for flipping Do Not
                            Disturb. */}

                        {!this.props.inCall ?
                        <Divider />
                         : null }

                        {(false && !this.props.inCall) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('scanQr')} icon="qr-code" title="Scan QR code..." />
                         : null }


                        {!this.props.inCall && false ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}
                        {!this.props.inCall ?
                        <Divider />
                        : null}

                        { (this.refetchMessagesForDays != 0 && !this.props.inCall) ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

                        {!this.props.inCall ?
						<Divider />
                        : null}

                        {extraMenu ?
                        <View>

                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        </View>
                        : null}
                        {/* (Proximity sensor moved into Preferences →
                            it's a per-account behaviour preference,
                            not a frequent-use action that belongs in
                            the main menu. The toggle is reachable
                            from "Preferences..." below.) */}


                        {!this.props.inCall ?
                        <Divider />
                         : null }

                      {(!this.props.syncConversations && !this.props.inCall && Platform.OS === "ios" && this.props.hasAutoAnswerContacts) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('toggleAutoAnswerMode')} icon="wrench" title={autoAnswerModeTitle} />
                        : null}


                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu theme={getMenuTheme().menuTheme}
                        visible={this.state.keyMenuVisible}
                        onDismiss={() => this.setState({keyMenuVisible: false})}
                        contentStyle={styles.roundedMenu}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested key submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item theme={getMenuTheme().menuTheme}
								title="Private key..."
								icon="key"
								onPress={() => this.setState({keyMenuVisible: true})}
							/>
						}
                    >

                        {this.props.canSend() && !this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('exportPrivateKey')} icon="send" title={importKeyLabel} />:null}
                        {this.props.canSend() && !this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('backupPrivateKey')} icon="send" title={'Backup private key...'} />:null}
                        {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('restorePrivateKey')} icon="key" title="Restore private key..."/> :null}
                        {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('generatePrivateKey')} icon="key" title="Generate private key..."/> :null}
                        {(!this.props.inCall) ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}

                        {this.props.publicKey ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

					</Menu>
                     : null}

                       {/* My Storage — nested submenu grouping the
                           on-device storage / migration actions (export,
                           contact backup, contact restore). Mirrors the
                           "My private key..." submenu above; placed right
                           after it. Uses storageMenuVisible state. */}
                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu theme={getMenuTheme().menuTheme}
                        visible={this.state.storageMenuVisible}
                        onDismiss={() => this.setState({storageMenuVisible: false})}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested storage submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item theme={getMenuTheme().menuTheme}
								title="Storage..."
								icon="folder"
								onPress={() => this.setState({storageMenuVisible: true})}
							/>
						}
                    >

                       {/* Export data — starts the on-device LAN HTTPS
                           server so a browser on the same Wi-Fi can pull
                           this phone's messages / contacts / files (for
                           phone-to-phone migration or computer backup). */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('exportData')} icon="export" title="Export data..."/> : null}

                       {/* Backup contacts — one-tap local snapshot of this
                           account's contacts, written to the same per-account
                           folder as the weekly auto-backup. On-device only.
                           Grouped with Restore contacts below. */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('backupContacts')} icon="content-save" title="Backup contacts..."/> : null}

                       {/* Restore contacts — add-only restore from a local
                           backup snapshot. Lists backups with their count of
                           contacts missing locally; importing creates those
                           locally and on the server (no updates / deletes). */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('importContacts')} icon="account-multiple-plus" title="Restore contacts..."/> : null}

                       {/* Delimiter after the grouped contacts backup /
                           restore actions. */}
                       {!this.props.inCall ? <Divider /> : null}

                       {/* Backup messages — full local message-store dump for
                           this account, written as plaintext JSON to the
                           per-account messages/history folder. On-device only. */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('backupMessages')} icon="message-lock" title="Backup messages..."/> : null}

                       {/* Restore messages — opens a modal listing message
                           backups; each is loaded on demand to show how many
                           messages are new vs current storage, then add-only
                           restored (missing rows only). */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('restoreMessages')} icon="message-arrow-left" title="Restore messages..."/> : null}

                       {/* Refetch messages — opens a modal to pick how many
                           days to go back, then re-downloads the journal for
                           that window from the server and overwrites the local
                           message store (app.js refetchMessages → resetStorage
                           + requestSyncConversations). On-device + server. */}
                       {!this.props.inCall ? <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('openRefetchMessages')} icon="cloud-download" title="Refetch messages..."/> : null}

						</Menu>
                     : null}

                       {/* Settings — nested submenu grouping the
                           account / preferences / permissions actions.
                           Mirrors the "My private key..." and
                           "My Storage..." submenus above. Uses
                           settingsMenuVisible state. The individual
                           items keep their original render guards. */}
                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu theme={getMenuTheme().menuTheme}
                        visible={this.state.settingsMenuVisible}
                        onDismiss={() => this.setState({settingsMenuVisible: false})}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested settings submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item theme={getMenuTheme().menuTheme}
								title="Settings..."
								icon="cog-outline"
								onPress={() => this.setState({settingsMenuVisible: true})}
							/>
						}
                    >

                       {/* My account — was a top-level item; moved into
                           Settings. Keeps its original guards. */}
                       {!this.props.syncConversations && !this.props.inCall ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}

                       {/* Preferences modal — opens a sheet of
                           per-account toggles (encryption mode, video
                           codec, etc.). Pure UI; no overlap with an
                           active call. */}
                       <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('preferences')} icon="cog-outline" title="Preferences..." />

                        {/* Permissions — deep-links to the OS settings
                            screen for Blink. Useful mid-call when the
                            user realises camera/mic/location wasn't
                            granted. */}
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('appSettings')} icon="policy-alert" title="Permissions"/>

						</Menu>
                     : null}

                        {/* Location privacy policy — Android only. The
                            in-app Prominent Disclosure is a Google Play
                            requirement; iOS uses CoreLocation's usage-
                            string flow at the OS level and the panel
                            doesn't apply there. Lives in the general
                            (no-contact-selected) kebab because it's a
                            per-account setting; the modal renders the
                            review-and-opt-out variant ([Close]/[Opt
                            out]) when the flag is set. The accept
                            variant ([Not now]/[I agree]) is now
                            reached only via the share-flow gate when
                            the user actually tries to share, so we
                            hide the menu item until consent is on
                            file — there's nothing to review or
                            withdraw before that. */}
                        {false && Platform.OS === 'android' && this.state.locationDisclosureAcknowledged && !this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('viewLocationDisclosure')} icon="shield-account" title="Location privacy policy..."/>
                         : null }

                        {/* Help… — opens the in-app log viewer / support
                            request modal. Available in every context
                            (with or without a selected contact, folded
                            or not), since the user can need help at any
                            point — including from inside an open chat. */}
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('logs')} icon="lifebuoy" title="Logs…" />

                        {/* Donate moved out of this menu — it now lives
                            as a button inside the About Blink modal,
                            which opens the same PaymentInfoModal
                            ('donate' template) after closing itself. */}

                        {/* About Blink — purely informational (version,
                            build id, dev-mode toggle). No call overlap
                            so we keep it visible. */}
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('about')} icon="information" title="About Blink"/>
                        {/* Divider above Sign out — sets the destructive
                            session-end action visually apart from the
                            settings/info entries above. */}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Divider /> : null}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item theme={getMenuTheme().menuTheme} onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
                    </Menu>
                    )
                  : null }

                <NavigationBarModals
                    nav={this}
                    callUrl={callUrl}
                    showEditModal={showEditModal}
                    conferenceUrl={conferenceUrl}
                    conferenceRoom={conferenceRoom}
                />

            </Appbar.Header>
            </SafeAreaInsetsContext.Provider>
		</View>
		</Fragment>
        );
    }
}

NavigationBar.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    // Actionless system message (from NotificationCenter via app.js).
    // Rendered on the 2nd navbar line in place of the account URI
    // while visible; null when no message is up.
    systemMessage      : PropTypes.string,
    logout             : PropTypes.func.isRequired,
    // (accountId, password) => void. Logs the current account out
    // and signs back in as the supplied one. Used by SwitchAccountModal
    // to pivot to another locally-stored account without going through
    // the LoginForm round-trip.
    switchAccount      : PropTypes.func,
    // Per-account password lookup populated by app.js#loadAccounts.
    // Drives the "Switch to…" options inside SwitchAccountModal.
    accountPasswords   : PropTypes.object,
    preview            : PropTypes.func.isRequired,
    toggleSpeakerPhone : PropTypes.func.isRequired,
    toggleProximity    : PropTypes.func.isRequired,
    showLogs           : PropTypes.func.isRequired,
    inCall             : PropTypes.bool,
    contactsLoaded     : PropTypes.bool,
    proximity          : PropTypes.bool,
    displayName        : PropTypes.string,
    myDisplayName      : PropTypes.string,
    myPhoneNumber      : PropTypes.string,
    email              : PropTypes.string,
    organization       : PropTypes.string,
    account            : PropTypes.object,
    accountId          : PropTypes.string,
    connection         : PropTypes.object,
    orientation        : PropTypes.string,
    isTablet           : PropTypes.bool,
    // Optional override for the NavBar height. When unset, defaults are:
    //   • folded cover display → 60
    //   • tablet               → 90
    //   • phone                → 60
    // IconButton sizes scale automatically with the chosen height
    // (tablet pins IconButtons to 32 to match the ContactsList call
    // bar; phone keeps the historical 18dp).
    navBarHeight       : PropTypes.number,
    selectedContact    : PropTypes.object,
    allContacts        : PropTypes.array,
    goBackFunc         : PropTypes.func,
    goBackToCallFunc   : PropTypes.func,
    exportKey          : PropTypes.func,
    publicKeyHash      : PropTypes.string,
    publicKey          : PropTypes.string,
    deleteMessages     : PropTypes.func,
    deleteFiles        : PropTypes.func,
    toggleBlocked      : PropTypes.func,
    toggleFavorite     : PropTypes.func,
    toggleAutoAnswer   : PropTypes.func,
    toggleAutoDialer   : PropTypes.func,   // [AUTO-DIALER — DEVELOPER TOOL]
    startAutoDialer    : PropTypes.func,   // [AUTO-DIALER — DEVELOPER TOOL]
    autoDialerUri      : PropTypes.string, // [AUTO-DIALER — DEVELOPER TOOL]
    autoDialerRedialSeconds : PropTypes.number,
    autoDialerHangupSeconds : PropTypes.number,
    autoDialerAudio    : PropTypes.bool,
    autoDialerVideo    : PropTypes.bool,
    toggleCaregiver    : PropTypes.func,
    saveConference     : PropTypes.func,
    defaultDomain      : PropTypes.string,
    defaultConferenceDomain : PropTypes.string,
    favoriteUris       : PropTypes.array,
    startCall          : PropTypes.func,
    startConference    : PropTypes.func,
    saveContactByUser        : PropTypes.func,
    contactHasStoredMessages : PropTypes.func,
    addContact         : PropTypes.func,
    deletePublicKey    : PropTypes.func,
    sendPublicKey      : PropTypes.func,
    sendMessage        : PropTypes.func,
    messages           : PropTypes.object,
    showImportModal    : PropTypes.func,
    syncConversations   : PropTypes.bool,
    journalSyncActive   : PropTypes.bool,
    showCallMeMaybeModal: PropTypes.bool,
    toggleCallMeMaybeModal : PropTypes.func,
    showConferenceModalFunc : PropTypes.func,
    refetchMessages: PropTypes.func,
    showExportPrivateKeyModal: PropTypes.bool,
    showExportPrivateKeyModalFunc: PropTypes.func,
    hideExportPrivateKeyModalFunc: PropTypes.func,
    showRestoreKeyModal: PropTypes.bool,
    showRestoreKeyModalFunc: PropTypes.func,
    blockedUris: PropTypes.array,
    myuuid: PropTypes.string,
    resumeTransfers: PropTypes.func,
    generateKeysFunc: PropTypes.func,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func,
    sharingAction: PropTypes.bool,
    dnd: PropTypes.bool,
    toggleDnd: PropTypes.func,
    buildId: PropTypes.string,
    getTransferedFiles: PropTypes.func,
    transferedFiles: PropTypes.object,
    transferedFilesSizes: PropTypes.object,
    rejectAnonymous: PropTypes.bool,
    toggleRejectAnonymous: PropTypes.func,
    toggleChatSounds: PropTypes.func,
    chatSounds: PropTypes.bool,
    readReceipts: PropTypes.bool,
    toggleReadReceipts: PropTypes.func,
    rejectNonContacts: PropTypes.bool,
    toggleRejectNonContacts: PropTypes.func,
    toggleSearchMessages: PropTypes.func,
    toggleSearchContacts: PropTypes.func,
    searchMessages: PropTypes.bool,
    searchContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    isLandscape: PropTypes.bool,
    publicUrl: PropTypes.string,
    serverSettingsUrl: PropTypes.string,
	deleteAccountUrl: PropTypes.string,
	deleteAccount: PropTypes.func,
	insets: PropTypes.object,
	call: PropTypes.object,
	storageUsage: PropTypes.array,
	syncPercentage: PropTypes.number,
	toggleDevMode: PropTypes.func,
	devMode: PropTypes.bool,
	toggleAutoAnswerMode: PropTypes.func,
	autoAnswerMode: PropTypes.bool,
	hasAutoAnswerContacts: PropTypes.bool,
	showQRCodeScanner: PropTypes.bool,
	toggleQRCodeScannerFunc: PropTypes.func,
	sylkDomain: PropTypes.string,
};

export default NavigationBar;
