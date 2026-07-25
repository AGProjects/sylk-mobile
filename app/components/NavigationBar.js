import React, { Component, Fragment } from 'react';
import { Alert, Animated, AppState, Easing, Linking, Image, NativeModules, Platform, PermissionsAndroid, View , TouchableHighlight, Dimensions, ActivityIndicator} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button, ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import Icon from  '@react-native-vector-icons/material-design-icons';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Keyboard } from 'react-native';
import BackgroundTimer from 'react-native-background-timer';
import uuid from 'react-native-uuid';
import utils from '../utils';

// Geolocation is an optional native dependency. Guard the require so that
// the app still boots if the pod/AAR hasn't been installed yet — callers
// will get a graceful failure instead of a red-box on launch.
let Geolocation = null;
try {
    // eslint-disable-next-line global-require
    Geolocation = require('@react-native-community/geolocation').default
               || require('@react-native-community/geolocation');
} catch (e) {
    console.log('@react-native-community/geolocation not installed:', e && e.message);
}

// Native bridge to Blink's Android foreground service that keeps the
// process promoted while a location share is active. Declared at module
// scope so we don't hit NativeModules in a hot path. Guarded so iOS and
// dev-time stripped builds don't explode if the module isn't registered.
const LocationForegroundServiceModule =
    Platform.OS === 'android'
        ? (NativeModules && NativeModules.LocationForegroundServiceModule) || null
        : null;

// =====================================================================
// DEBUG: meet-up convergence simulator.
//
// When ENABLE_MEET_SIMULATION is true, an extra "Simulate convergence" /
// "Stop simulation" entry appears in the chat-header kebab menu while a
// meet share is active for the selected contact. Tapping it replaces the
// real GPS source with a synthetic walker that steps toward a
// convergence target every SIM_STEP_INTERVAL_MS, advancing
// SIM_STEP_METERS each tick. The target is the peer's last known
// coordinate (resolved through props.getPeerCoordsForActiveShare); if
// the peer hasn't shipped any coords yet, we fall back to ~500 m due
// north of our own start so the user still sees motion. Both devices
// running the simulator concurrently converge as their respective
// targets keep updating to the latest peer fix.
//
// Production builds: flip ENABLE_MEET_SIMULATION to false. The const is
// a single off-switch — the menu item disappears, simulateConvergence
// no-ops, and no synthetic ticks are emitted. The methods stay defined
// so accidental call sites still compile.
//
// SIM_TICKS_TO_CONVERGE controls how fast the simulated walker reaches
// the destination: at sim activation, step size is computed as
// (initial distance to destination) / SIM_TICKS_TO_CONVERGE so each
// side arrives in exactly that many ticks regardless of how far away
// it started. SIM_STEP_METERS is the fallback step used only when no
// destination is known yet (the per-side per-tick "I'm not sure where
// I'm going" walk that synthesises a target on the fly).
//
// SIM_STEP_INTERVAL_MS sets the wall-clock gap between successive
// synthetic ticks. 10 s gives the chat enough breathing room for
// each new bubble update to land as a distinct visual event
// (instead of a burst of rapid-fire updates that read as network
// retries). With the default 5 ticks-to-converge, the full meet-up
// cycle lands in ~50 s — long enough to watch the pins march, short
// enough that no one loses patience in a test session.
// =====================================================================
// ENABLE_MEET_SIMULATION and the SIM_* walker constants now live in
// LocationSimulator.js (imported above), the single source of truth.

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
import LocationSimulator, { ENABLE_MEET_SIMULATION } from './LocationSimulator';
import LocationSharingManager from './LocationSharingManager';
import { LocationSharingContext } from './LocationSharingContext';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.refetchMessagesForDays = 0;

        // Re-send the live location every N seconds until the expiration
        // time chosen by the user is reached. Default 60 s, overridable
        // per-account via the Preferences modal. Stored in
        // accounts.settings as seconds; multiplied ×1000 here for
        // setInterval. Initialised from the constructor-time props if
        // present so resumed shares inherit the user's chosen cadence
        // on app boot; subsequent changes flow through componentDidUpdate.
        this.LOCATION_REPEAT_MS = (props && typeof props.locationTickIntervalSec === 'number'
                && props.locationTickIntervalSec > 0)
            ? props.locationTickIntervalSec * 1000
            : 60 * 1000;

        // "Until I return" auto-stop thresholds. A caregiver share starts
        // by recording the user's position and arming a state machine:
        //   • departure — wait until the user has moved more than
        //     UNTIL_RETURN_DEPARTURE_M from the recorded origin. The
        //     first tick is by definition AT the origin, so without the
        //     departure gate the share would self-stop immediately
        //     ("you're already home").
        //   • return — once departed, the moment a tick lands within
        //     UNTIL_RETURN_RETURN_M of the origin we treat it as
        //     "the user is back" and stop the share. Same threshold for
        //     symmetry; a slightly looser return ring would just mean
        //     the share lingers slightly longer than necessary, while a
        //     tighter ring risks missing the return when GPS noise
        //     pushes the fix a few metres outside the boundary.
        // Both values are in metres.
        this.UNTIL_RETURN_DEPARTURE_M = 100;
        this.UNTIL_RETURN_RETURN_M   = 100;

        // Map<uri, { intervalId, expiresAt }>  — tracks an active
        // "share location" timer per contact so the user can run
        // several shares in parallel and we can cancel them cleanly.
        this.locationTimers = {};

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
        this._pendingPermissionShares = {};

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
			// Map<uri, expiresAtMs> — mirrors `this.locationTimers` in
			// state so the menu can re-render when a share starts or stops.
			activeLocationShares: {},
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
        // Location-sharing engine. All the start/stop/pause/resume/tick/
        // permission logic lives in LocationSharingManager; the methods on
        // this component are thin stubs that delegate to it (see the
        // "Location engine delegating stubs" section below). The engine
        // reaches component-owned state (locationTimers, the activeShares
        // mirror, props, setState, the pulse animation) through its `host`
        // reference — this is the seam a hook/context can later replace.
        this._locationEngine = new LocationSharingManager(this);

        this._simulator = new LocationSimulator({
            enabled: ENABLE_MEET_SIMULATION,
            geolocation: Geolocation,
            getEntry: (uri) => this.locationTimers && this.locationTimers[uri],
            shouldSendUpdateTick: (uri, coords) => this._shouldSendUpdateTick(uri, coords),
            sendLocationMetadata: (uri, coords, expiresAtISO, originMetadataId, extras) =>
                this.sendLocationMetadata(uri, coords, expiresAtISO, originMetadataId, extras),
        });
        // The engine's tick path consults the simulator for synthetic
        // coordinates (no-op when ENABLE_MEET_SIMULATION is false).
        this._locationEngine.sim = this._simulator;
    }

    _startActiveSharePulse() {
        if (this._activeSharePulseLoop) return;
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
        const sharesAtMount = Object.keys(this.state.activeLocationShares || {}).length;
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
            this._loadAndResumeActiveShares();
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
        // leak after the component is gone, and leave locationTimers
        // / activeLocationShares / AsyncStorage state intact for the
        // next mount to inherit.
        this._unmounted = true;
        // Tear down the call-warmup listener + poll interval so they
        // don't keep firing into a setState on an unmounted component.
        this._detachCallWarmup();
        const uris = Object.keys(this.locationTimers || {});
        for (const uri of uris) {
            const entry = this.locationTimers[uri];
            if (!entry) continue;
            try {
                if (entry.intervalId != null) {
                    BackgroundTimer.clearInterval(entry.intervalId);
                }
            } catch (e) { /* noop */ }
            try {
                if (entry.watchId != null
                        && Geolocation
                        && typeof Geolocation.clearWatch === 'function') {
                    Geolocation.clearWatch(entry.watchId);
                }
            } catch (e) { /* noop */ }
            try {
                if (entry.expiryTimeoutId != null) {
                    BackgroundTimer.clearTimeout(entry.expiryTimeoutId);
                }
            } catch (e) { /* noop */ }
        }
        // Stop any simulator timers too (they'd otherwise fire on a
        // dead component on the next interval and try to setState).
        if (this._simulator) {
            this._simulator.stopAll();
        }
        // Kill the pulse animation so it doesn't tick against a stale
        // Animated.Value after unmount.
        this._stopActiveSharePulse();
        if (this._appStateSub && typeof this._appStateSub.remove === 'function') {
            this._appStateSub.remove();
            this._appStateSub = null;
        }
        // Drop any parked permission-retry intents — without
        // _onAppStateChange they can never drain anyway, and a
        // remount (hot reload) would inherit them as zombies.
        this._pendingPermissionShares = {};
    }

    _onAppStateChange(state) {
        if (state !== 'active') return;
        const sharesCount = Object.keys(this.state.activeLocationShares || {}).length;
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
            this._drainPendingPermissionShares();
        } catch (e) { /* drain is best-effort */ }
    }

    // Persist a compact snapshot of in-flight location shares to
    // AsyncStorage. Called on every locationTimers mutation (entry
    // create + entry delete) so the saved blob is always at most
    // one tick behind reality. The snapshot only includes the
    // fields _loadAndResumeActiveShares needs to re-arm the share
    // (uri, kind, expiresAt, periodLabel, originMetadataId,
    // meetingSessionId, inReplyTo, excludeOriginRadiusMeters,
    // destination). Live runtime state (intervalId, watchId,
    // BackgroundTimer ids, lastReportedCoords, simulator state, …)
    // is intentionally excluded — it'd be meaningless after a
    // process restart.
    //
    // Fire-and-forget: AsyncStorage writes are async but we don't
    // gate any UI behaviour on completion, and the next start/stop
    // will rewrite the blob anyway.
    async _persistActiveShares() {
        // Per-account persistence to accounts.app_state.location.shares.
        // Replaces the previous single global AsyncStorage key
        // (activeLocationShares.v1) which leaked share state across
        // identities on multi-account devices — a second account
        // signing in on the same device would inherit and try to
        // resume the first account's shares. The accounts table is
        // PK'd on the account URI so this is naturally per-account.
        try {
            const accountId = this.props.accountId;
            if (!accountId) return;
            const read = this.props.readAppStateNamespace;
            const write = this.props.writeAppStateNamespace;
            if (typeof read !== 'function' || typeof write !== 'function') return;
            const map = {};
            const now = Date.now();
            const uris = Object.keys(this.locationTimers || {});
            for (const uri of uris) {
                const entry = this.locationTimers[uri];
                if (!entry) continue;
                if (typeof entry.expiresAt === 'number'
                        && entry.expiresAt <= now) {
                    continue; // expired — skip
                }
                map[uri] = {
                    uri,
                    kind: entry.kind || 'fixed',
                    expiresAt: entry.expiresAt,
                    periodLabel: entry.periodLabel || null,
                    meetingSessionId: entry.meetingSessionId || null,
                    inReplyTo: entry.inReplyTo || null,
                    excludeOriginRadiusMeters:
                        Number(entry.excludeOriginRadiusMeters) || 0,
                    destination: (entry.tickExtras
                        && entry.tickExtras.destination) || null,
                    originMetadataId: entry.originMetadataId || null,
                    // "Until I return" state machine snapshot.
                    // Persisted so a kill-restart while the user is
                    // out doesn't reset the departed flag back to
                    // false — that would suppress the auto-stop on
                    // their next return. Both fields are null/false
                    // for non-untilIReturn shares and harmless to
                    // serialize.
                    untilReturnOrigin: entry.untilReturnOrigin || null,
                    untilReturnDeparted: !!entry.untilReturnDeparted,
                    // Paused flag persistence — without this, a paused
                    // share would silently un-pause across an app
                    // backgrounding / process kill (the resume path
                    // re-arms via startLocationSharing with paused=false
                    // and the user would see ticks resume on their own,
                    // contradicting what they explicitly asked for in
                    // the bubble's contextual menu). Field-reported
                    // bug: user paused a share, app went to background,
                    // ticks resumed automatically on the next foreground.
                    paused: !!entry.paused,
                };
            }
            // Read-modify-write: preserve any other location.* keys
            // (e.g. meetingRequests) the caller doesn't own, then
            // replace shares.
            const location = await read(accountId, 'location');
            location.shares = map;
            await write(accountId, 'location', location);
        } catch (e) {
            console.log('[location] _persistActiveShares failed',
                e && e.message ? e.message : e);
        }
    }

    // Boot-time hydrate: read the persisted snapshot, drop entries
    // whose expiresAt has lapsed during the offline window, and
    // re-arm whatever's left via startLocationSharing with two
    // resume-only opts:
    //   • resumeOriginMetadataId — reuses the saved bubble id so
    //     the receiver keeps seeing the SAME bubble updated in
    //     place rather than a fresh one spawning beside it.
    //   • suppressAnnouncement — skips the "I want to meet up" /
    //     "I am sharing for X hours" / "Started sharing at HH:MM"
    //     chat-visible messages so a restart doesn't litter the
    //     conversation with duplicates of the original
    //     announcement.
    //
    // Best-effort: messages that fail to ship while the SIP
    // connection is still establishing land on the floor; the next
    // tick (≤ LOCATION_REPEAT_MS later) will retry.
    async _loadAndResumeActiveShares() {
        // Boot-time concurrency guard. The resume scan is triggered by the
        // registrationState=registered transition, which is also the
        // moment the SIP server starts firing the journal sync at us.
        // A typical boot processes ~500 messages through the SQLite
        // bridge in a tight burst; if we ALSO fire location ticks,
        // outgoing-state UPDATEs, and getCurrentCoordinates timers in
        // the same JS event-loop window, the React Native batched
        // bridge can drop a params slot ("Malformed calls from JS:
        // field sizes are different") and the app crashes.
        //
        // Two mitigations stacked here:
        //   1. Wait for the sync wave to drain before starting any
        //      shares. The sync usually finishes in 3-6s on a bulky
        //      account; 8s gives comfortable headroom.
        //   2. Stagger per-share starts so a user with multiple
        //      simultaneous shares doesn't fire every tick + every
        //      getCurrentCoordinates in the same tick of the loop.
        const BOOT_RESUME_DELAY_MS = 8000;
        const PER_SHARE_STAGGER_MS = 1500;
        await new Promise((resolve) => setTimeout(resolve, BOOT_RESUME_DELAY_MS));
        // Bail if the component was unmounted while we were waiting.
        if (this._unmounted) return;

        let map = null;
        try {
            // Per-account read from accounts.app_state.location.shares.
            // The accounts table's PK on the account URI guarantees
            // we only ever resume shares belonging to the currently
            // signed-in identity — a second account on the same
            // device won't pick up the first account's shares.
            const accountId = this.props.accountId;
            const read = this.props.readAppStateNamespace;
            if (!accountId || typeof read !== 'function') {
                console.log('[location] resume scan: skipped (accountId or readAppStateNamespace missing)');
                return;
            }
            const location = await read(accountId, 'location');
            map = (location && location.shares && typeof location.shares === 'object')
                ? location.shares : null;
        } catch (e) {
            console.log('[location] _loadAndResumeActiveShares read failed',
                e && e.message ? e.message : e);
            return;
        }
        const candidateUris = (map && typeof map === 'object')
            ? Object.keys(map) : [];
        console.log('[location] resume scan: persisted entries =',
            candidateUris.length,
            candidateUris.length > 0 ? '(' + candidateUris.join(', ') + ')' : '');
        if (!map || typeof map !== 'object') return;
        const uris = candidateUris;
        if (uris.length === 0) return;
        const now = Date.now();
        const utils = require('../utils');
        let _staggerIndex = 0;
        for (const uri of uris) {
            const e = map[uri];
            if (!e || !e.uri) continue;
            const expiresAt = typeof e.expiresAt === 'number'
                ? e.expiresAt : null;
            if (expiresAt == null || expiresAt <= now) continue;
            // Inter-share stagger: spread the resume work across
            // PER_SHARE_STAGGER_MS-spaced ticks so 3 shares don't hit
            // the bridge at the same instant.
            if (_staggerIndex > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, PER_SHARE_STAGGER_MS));
                if (this._unmounted) return;
            }
            _staggerIndex += 1;
            const remainingMs = expiresAt - now;
            try {
                utils.timestampedLog(
                    `[location] resuming share with ${uri}`
                    + ` — kind=${e.kind || 'fixed'}`
                    + ` (${Math.round(remainingMs / 60000)} min remaining)`
                );
            } catch (err) { /* noop */ }
            try {
                this.startLocationSharing(uri, remainingMs,
                    e.periodLabel || '',
                    {
                        kind: e.kind || 'fixed',
                        inReplyTo: e.inReplyTo || null,
                        expiresAt: expiresAt,
                        excludeOriginRadiusMeters:
                            Number(e.excludeOriginRadiusMeters) || 0,
                        destination: e.destination || undefined,
                        resumeOriginMetadataId: e.originMetadataId || null,
                        suppressAnnouncement: true,
                        // Carry the "Until I return" state machine
                        // snapshot through the resume so we don't
                        // re-arm the gate from scratch when the user
                        // is mid-trip. startLocationSharing reads
                        // these on the entry it builds via
                        // resumeUntilReturnOrigin / resumeUntilReturnDeparted.
                        resumeUntilReturnOrigin: e.untilReturnOrigin || null,
                        resumeUntilReturnDeparted: !!e.untilReturnDeparted,
                        // Re-apply the paused flag if the share was
                        // paused at persist time. Without this, the
                        // resumed share would start ticking again on
                        // its own — the very behaviour the user
                        // explicitly asked to suppress when they
                        // tapped Pause. The pause-gate at the top of
                        // sendLocationUpdate (around line ~1505) is
                        // what actually swallows the would-be ticks;
                        // we just need the flag to be set on the new
                        // entry before the FIRST tick fires, which is
                        // why startLocationSharing reads
                        // `resumePaused` immediately after building
                        // the entry rather than later.
                        resumePaused: !!e.paused,
                    });
            } catch (err) {
                utils.timestampedLog('[location] resume failed for', uri,
                    err && err.message ? err.message : err);
            }
        }
    }
    
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

		// Live-pick up the user-chosen heartbeat cadence from
		// PreferencesModal. Re-running through `setLocationRepeatMs`
		// keeps the gating throttle (`if (nowMs - lastSentMs <
		// this.LOCATION_REPEAT_MS)`) accurate the very next tick.
		// Already-running setInterval timers keep their original
		// schedule until they next fire — at which point the throttle
		// gate enforces the new cadence — so the worst-case delay
		// before the change takes effect is one OLD tick interval.
		// Acceptable for a setting the user changes infrequently.
		if (typeof this.props.locationTickIntervalSec === 'number'
				&& this.props.locationTickIntervalSec !== prevProps.locationTickIntervalSec
				&& this.props.locationTickIntervalSec > 0) {
			const newMs = this.props.locationTickIntervalSec * 1000;
			utils.timestampedLog('[location] preferences: tick interval changed',
				prevProps.locationTickIntervalSec, '→',
				this.props.locationTickIntervalSec, 'sec (', newMs, 'ms)');
			this.LOCATION_REPEAT_MS = newMs;
		}

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
			this._loadAndResumeActiveShares();
			// Hydrate the per-account share-location disclaimer
			// suppression flag in the same window — by definition
			// accountId is bound now, and reading the flag here
			// avoids a separate registration hook for what's
			// otherwise a tiny piece of state. Idempotent so a
			// future re-fire would be safe even though the gate
			// above prevents it.
			this._hydrateDisclaimerSuppression();
		}

		// Re-hydrate when accountId itself changes (account-switch on
		// the same device, even if registrationState didn't transition
		// through 'unregistered'). Without this, signing out as A and
		// back in as B on the same process would keep B looking at
		// A's suppression state.
		if (prevProps.accountId !== this.props.accountId) {
			this._hydrateDisclaimerSuppression();
		}

		// Self-heal drift between activeLocationShares (React state that
		// drives the chat-header + NavBar pulse) and locationTimers (the
		// instance ref that holds the real intervalId / watchId / expiry
		// timer). locationTimers is the source of truth: if there's no
		// entry there, no tick is firing and no share is actually active.
		// Previously these two could drift whenever a cleanup setState
		// was pre-empted by a concurrent setState that spread a stale
		// snapshot of activeLocationShares (e.g. a meeting_end arriving
		// while an optimistic start-share write was still in flight, or
		// a deleteMessage teardown racing with stopLocationSharing's
		// re-entry guard). The result was a pin that kept pulsing after
		// the share had truly ended — even after the user deleted the
		// origin bubble. We reconcile here on every commit: any uri in
		// activeLocationShares that isn't backed by a timer AND isn't
		// currently mid-startup (guarded by _startingShares, which spans
		// the full startLocationSharing async chain) is dropped. This
		// makes the pulse state eventually-consistent with the actual
		// share state regardless of which cleanup path missed.
		const sharesMap = this.state.activeLocationShares || {};
		const sharesUris = Object.keys(sharesMap);
		if (sharesUris.length > 0) {
			let reconciled = null;
			const staleUris = [];
			sharesUris.forEach((uri) => {
				const hasTimer = !!this.locationTimers[uri];
				const starting = !!(this._startingShares && this._startingShares.has(uri));
				if (!hasTimer && !starting) {
					if (!reconciled) reconciled = {...sharesMap};
					delete reconciled[uri];
					staleUris.push(uri);
				}
			});
			if (reconciled) {
				console.log('[location] NB cDU reconcile: dropping stale activeLocationShares',
					staleUris);
				this.setState({activeLocationShares: reconciled});
				// Bail out — the subsequent setState triggers another cDU
				// where the count-based pulse toggle below will run with
				// the corrected map. Doing the toggle here with the stale
				// currCount would falsely keep the pulse running for one
				// extra frame.
				return;
			}
		}

		// Drive the pulsing marker indicator: start the loop on the
		// first active share OR the start of an in-progress call,
		// stop it when both signals go quiet. We share the same
		// Animated.Value across both indicators so a simultaneous
		// call+share breath in unison rather than fighting each other.
		// Counted off both the share map (size > 0) and inCall so a
		// transition in EITHER direction triggers the right side
		// effect.
		const prevCount = Object.keys(prevState.activeLocationShares || {}).length;
		const currCount = Object.keys(this.state.activeLocationShares || {}).length;
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

		// Bubble the active-shares map up so app.js (and from there,
		// ReadyBox) can render its own in-chat pulse. We only fire on
		// actual changes to the map identity — setState above already
		// spreads a fresh object each time it mutates — so this is a
		// cheap referential equality check, not a deep diff.
		if (prevState.activeLocationShares !== this.state.activeLocationShares
			&& typeof this.props.onActiveSharesChanged === 'function') {
			try {
				this.props.onActiveSharesChanged(this.state.activeLocationShares);
			} catch (e) {
				console.log('[location] onActiveSharesChanged failed',
					e && e.message ? e.message : e);
			}
		}

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
                    if (_uri && this.state.activeLocationShares[_uri]) {
                        // Already sharing to this contact — toggle off.
                        this.stopLocationSharing(_uri);
                    } else {
                        this.showShareLocationModal();
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
                    const _entry = _uri && this.locationTimers && this.locationTimers[_uri];
                    if (_entry) {
                        this.pauseLocationSharing(_uri, _entry.originMetadataId);
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
                    const _entry = _uri && this.locationTimers && this.locationTimers[_uri];
                    if (_entry) {
                        this.resumeLocationSharing(_uri, _entry.originMetadataId);
                    }
                }
                break;
            case 'requestLocation':
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    if (_uri) {
                        this.requestPeerLocation(_uri);
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
                    this.getLocationPermissionStatus()
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
                                    try { await this._clearShareLocationDisclaimerSuppression(); }
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
            case 'simulateMeet':
                // DEBUG: see ENABLE_MEET_SIMULATION at top of file.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    if (!_uri) break;
                    if (this.isSimulating(_uri)) {
                        this.stopSimulation(_uri);
                    } else {
                        this.simulateConvergence(_uri);
                    }
                    // Re-render so the menu item swaps title.
                    this.setState({menuVisible: false});
                }
                break;
            case 'pinLocation':
                // Entry point used by the ReadyBox chat-header map-marker
                // "pin" button. Behaves like 'shareLocation' when we're
                // NOT yet sharing (opens the duration picker), but when a
                // share is already active with the current contact we
                // open the ActiveLocationSharesModal scoped to that URI
                // instead of silently stopping — gives the user a
                // visible confirmation step before the share ends.
                {
                    const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                    if (_uri && this.state.activeLocationShares[_uri]) {
                        this.setState({
                            showActiveSharesModal: true,
                            activeSharesFilterUri: _uri,
                        });
                    } else {
                        this.showShareLocationModal();
                    }
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

    // ===== Location engine: delegating stubs =====
    // The implementations live in LocationSharingManager (this._locationEngine).
    // These stubs preserve the public method names used by render(),
    // handleMenu, the lifecycle hooks, and app.js (via the navBar ref).
    showShareLocationModal(...args) { return this._locationEngine.showShareLocationModal(...args); }
    _fetchPreviewLocation(...args) { return this._locationEngine._fetchPreviewLocation(...args); }
    hideShareLocationModal(...args) { return this._locationEngine.hideShareLocationModal(...args); }
    meetMeAt(...args) { return this._locationEngine.meetMeAt(...args); }
    _meetMeAtRunGates(...args) { return this._locationEngine._meetMeAtRunGates(...args); }
    getLocationPermissionStatus(...args) { return this._locationEngine.getLocationPermissionStatus(...args); }
    _ensureLocationDisclosureAcknowledged(...args) { return this._locationEngine._ensureLocationDisclosureAcknowledged(...args); }
    ensureLocationPermission(...args) { return this._locationEngine.ensureLocationPermission(...args); }
    _hydrateDisclaimerSuppression(...args) { return this._locationEngine._hydrateDisclaimerSuppression(...args); }
    _suppressShareLocationDisclaimer(...args) { return this._locationEngine._suppressShareLocationDisclaimer(...args); }
    _clearShareLocationDisclaimerSuppression(...args) { return this._locationEngine._clearShareLocationDisclaimerSuppression(...args); }
    _armPermissionRetry(...args) { return this._locationEngine._armPermissionRetry(...args); }
    _cancelPendingPermissionShare(...args) { return this._locationEngine._cancelPendingPermissionShare(...args); }
    _drainPendingPermissionShares(...args) { return this._locationEngine._drainPendingPermissionShares(...args); }
    getCurrentCoordinates(...args) { return this._locationEngine.getCurrentCoordinates(...args); }
    _logFixProvenance(...args) { return this._locationEngine._logFixProvenance(...args); }
    sendLocationMetadata(...args) { return this._locationEngine.sendLocationMetadata(...args); }
    _evaluateUntilReturnGate(...args) { return this._locationEngine._evaluateUntilReturnGate(...args); }
    _maybeFireDestinationArrival(...args) { return this._locationEngine._maybeFireDestinationArrival(...args); }
    sendLocationUpdate(...args) { return this._locationEngine.sendLocationUpdate(...args); }
    _shouldSendUpdateTick(...args) { return this._locationEngine._shouldSendUpdateTick(...args); }
    setMeetingDestination(...args) { return this._locationEngine.setMeetingDestination(...args); }
    pauseLocationSharing(...args) { return this._locationEngine.pauseLocationSharing(...args); }
    resumeLocationSharing(...args) { return this._locationEngine.resumeLocationSharing(...args); }
    getLocationShareState(...args) { return this._locationEngine.getLocationShareState(...args); }
    _shouldLogShareStateProbe(...args) { return this._locationEngine._shouldLogShareStateProbe(...args); }
    stopAllSharesForLogout(...args) { return this._locationEngine.stopAllSharesForLogout(...args); }
    stopLocationSharing(...args) { return this._locationEngine.stopLocationSharing(...args); }
    stopSharesRepliesTo(...args) { return this._locationEngine.stopSharesRepliesTo(...args); }
    sendMeetingEndSignal(...args) { return this._locationEngine.sendMeetingEndSignal(...args); }
    stopSharesForMeetingSession(...args) { return this._locationEngine.stopSharesForMeetingSession(...args); }
    startLocationSharing(...args) { return this._locationEngine.startLocationSharing(...args); }
    onShareLocationConfirmed(...args) { return this._locationEngine.onShareLocationConfirmed(...args); }
    shareLocationOnce(...args) { return this._locationEngine.shareLocationOnce(...args); }
    requestPeerLocation(...args) { return this._locationEngine.requestPeerLocation(...args); }
    startMeetingAcceptance(...args) { return this._locationEngine.startMeetingAcceptance(...args); }
    // ===== end location engine stubs =====






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
    // Returns true when the loaded message slice for `uri` contains at
    // least one substantive interaction in BOTH directions. Used to
    // gate the kebab's location-share / location-request items so we
    // only surface them on chats that have actually been used.
    //
    // What counts:
    //   • text/plain, text/html (user-typed messages)
    //   • image/* attachments
    //   • application/sylk-file-transfer
    //   • application/sylk-live-location — historical location
    //     bubbles count too. If the two parties have exchanged a
    //     location share at any point in the past, that's by
    //     itself evidence of an active relationship; the share-
    //     location entry should remain surfaced even when the
    //     chat's text history is otherwise empty (e.g. cleared,
    //     or the SQL slice is dominated by location-trail rows
    //     pushing text out of the loaded window).
    // Excluded as noise:
    //   • system === true (system notes)
    //   • application/sylk-message-metadata (location ticks,
    //     meeting handshakes, label/rotation/reply markers — these
    //     ride along with bubbles, the bubble itself counts above)
    //   • application/sylk-contact-update
    //   • message/imdn (delivery receipts)
    //   • text/pgp-* (key exchange)
    _hasBidirectionalChat(uri) {
        if (!uri) return false;
        const msgs = (this.props.messages && this.props.messages[uri]) || [];
        if (!Array.isArray(msgs) || msgs.length === 0) return false;
        let hasOut = false;
        let hasIn = false;
        for (const m of msgs) {
            if (!m) continue;
            if (m.system === true) continue;
            const ct = m.contentType;
            if (typeof ct !== 'string') continue;
            if (ct === 'application/sylk-message-metadata') continue;
            if (ct === 'application/sylk-contact-update') continue;
            if (ct === 'message/imdn') continue;
            if (ct.indexOf('pgp') !== -1) continue;
            // Live-location bubbles are accepted as proof of a real
            // relationship in BOTH directions, regardless of which side
            // sent them. Field complaint: a contact who shared their
            // location with the user (60 ticks of "until I return")
            // but had never exchanged a text message would otherwise
            // have the location share button vanish once the share
            // ended — a chat that's clearly real reads as "no
            // qualifying messages" because the bidi gate refuses to
            // flip on a single direction. Treating any live-location
            // bubble as bidi makes the gate match user expectation.
            if (ct === 'application/sylk-live-location') {
                hasOut = true;
                hasIn = true;
                return true;
            }
            // text/* (text + html), image/*, sylk-file-transfer all
            // count as their actual direction.
            const dir = m.direction;
            if (dir === 'outgoing') hasOut = true;
            else if (dir === 'incoming') hasIn = true;
            if (hasOut && hasIn) return true;
        }
        return false;
    }

















    // ===== DEBUG: meet-up convergence simulator =====
    //
    // The walker logic now lives in LocationSimulator.js; these thin
    // wrappers preserve the public method names used by handleMenu and
    // render(). this._simulator is built in the constructor with the
    // accessors it needs (getEntry / shouldSendUpdateTick /
    // sendLocationMetadata) and is gated on ENABLE_MEET_SIMULATION.
    simulateConvergence(uri, opts = {}) {
        this._simulator.start(uri, opts);
    }

    stopSimulation(uri) {
        this._simulator.stop(uri);
    }

    isSimulating(uri) {
        return this._simulator.isSimulating(uri);
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
				title = 'Unknown caller';
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
                   const _activeShares = Object.keys(this.state.activeLocationShares || {}).length;
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
                    const shareMap = this.state.activeLocationShares || {};
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
                                onPress={() => this.setState({showActiveSharesModal: true, activeSharesFilterUri: null})}
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
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible, keyMenuVisible: false, storageMenuVisible: false, settingsMenuVisible: false})}
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
                                onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                            />
                        }
                    >

                        { false ? <Menu.Item onPress={() => this.handleMenu('searchMessages')} icon="search" title={searchTitle}/> : null}

						{ !this.props.searchMessages && !isAnonymous && !(this.props.isFolded && this.props.selectedContact) ?
						<Menu.Item
							onPress={() => this.handleMenu('editContact')}
							icon="account"
							title={editTitle}
						/>
						: null}

						{isCallableUri && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
						: null}

                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/> :null}
                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('video')} icon="video" title="Video call"/> :null}
                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('conferenceCallNow')} icon="account-group" title="Conference call"/> :null}
                        {tags.indexOf('blocked') === -1 && this.props.canSend() && !this.props.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {tags.indexOf('blocked') === -1 && !this.props.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('shareConferenceLinkModal')} icon="share-variant" title="Share link..."/> :null}

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
                            const sharing = !!(_uri && this.state.activeLocationShares[_uri]);
                            const hasContactKey = !!(
                                this.props.selectedContact &&
                                this.props.selectedContact.publicKey
                            );
                            const bidir = this._hasBidirectionalChat(_uri);
                            const contactOk =
                                tags.indexOf('blocked') === -1
                                && !isConference
                                && !isAnonymous
                                && !this.myself
                                && this.props.canSend
                                && this.props.canSend();
                            const shareItemsVisible = contactOk
                                && (sharing || hasContactKey)
                                && (sharing || bidir);
                            if (!shareItemsVisible) return null;
                            // While a share is active for this contact,
                            // expose Pause / Resume directly on the chat
                            // header alongside Stop. Without this the
                            // user has to dig into the bubble's kebab to
                            // pause — easy to miss, and inconsistent
                            // with how Stop is one-tap from here. State
                            // comes straight off the in-memory entry
                            // (this.locationTimers[uri].paused) so the
                            // menu reflects what the share is ACTUALLY
                            // doing, not what activeLocationShares
                            // (which only tracks expiresAt) would
                            // imply.
                            const _liveEntry = sharing
                                && this.locationTimers
                                && this.locationTimers[_uri];
                            const _isPaused = !!(_liveEntry && _liveEntry.paused);
                            return (
                                <React.Fragment>
                                    <Divider />
                                    {!sharing ? (
                                        <Menu.Item
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
                                                <Menu.Item
                                                    onPress={() => this.handleMenu('resumeLocation')}
                                                    icon="play"
                                                    title="Resume sharing"
                                                />
                                            ) : (
                                                <Menu.Item
                                                    onPress={() => this.handleMenu('pauseLocation')}
                                                    icon="pause"
                                                    title="Pause sharing"
                                                />
                                            )}
                                            <Menu.Item
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
                                        <Menu.Item
                                            onPress={() => this.handleMenu('requestLocation')}
                                            icon="map-marker-question"
                                            title="Request location..."
                                        />
                                    ) : null}
                                    {!(this.props.isFolded && this.props.selectedContact) ? <Divider /> : null}
                                </React.Fragment>
                            );
                        })()}

                        {/* DEBUG: meet-up convergence simulator. Single
                            off-switch via ENABLE_MEET_SIMULATION at the
                            top of this file — flip to false to remove
                            this entry from production builds entirely.
                            Only visible while a share for the selected
                            contact is active. */}
                        {ENABLE_MEET_SIMULATION
                                && tags.indexOf('blocked') === -1
                                && !isConference
                                && !isAnonymous
                                && !this.myself
                                && this.props.canSend
                                && this.props.canSend()
                            ? (() => {
                                const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                                const sharing = !!(_uri && this.state.activeLocationShares[_uri]);
                                if (!sharing) return null;
                                const simming = this.isSimulating(_uri);
                                return (
                                    <Menu.Item
                                        onPress={() => this.handleMenu('simulateMeet')}
                                        icon={simming ? "stop" : "play"}
                                        title={simming ? "Stop simulation" : "Simulate convergence"}
                                    />
                                );
                            })()
                            : null}

                        { !this.props.searchMessages && this.hasMessages && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item
                            onPress={() => this.handleMenu('deleteMessages')}
                            icon="delete"
                            title="Delete messages..."
                        />
                        : null
                        }

                        {!this.props.searchMessages && this.hasFiles && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('deleteFileTransfers')} icon="delete" title="Delete files..."/>
                        : null
                        }

                        { !this.props.searchMessages && this.hasFiles && !this.props.inCall && 'paused' in this.props.contentTypes ?
                        <Menu.Item onPress={() => this.handleMenu('resumeTransfers')} icon="delete" title="Resume transfers"/>
                        : null
                        }

						{!isConference && !this.props.searchMessages && this.props.publicKey && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
                        : null}

                        { (this.refetchMessagesForDays != 0) ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

                        {!isConference && !this.props.searchMessages && this.props.publicKey && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

                        {!isConference && !this.props.searchMessages && this.hasMessages && tags.indexOf('test') === -1 && !isConference && !this.myself && !isAnonymous && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}

                        {!this.myself && !this.props.searchMessages && !isAnonymous && tags.indexOf('blocked') === -1 && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}

                        {!isAnonymous && !isConference && !this.myself && !this.props.searchMessages && tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1 && !this.props.inCall && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Divider />
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoAnswer')} title={autoAnswerTitle}/>
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

                        {!this.props.inCall && !isFavorite && !this.myself && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('deleteContact')} icon="delete" title={deleteTitle}/>
                        : null}

                    </Menu>
                :
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
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
                                onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                            />
                        }
                    >
                        {/* Add contact / Join conference — promoted to the
                            top of the main menu as the two most-used
                            actions. Add contact stays available while a
                            call is active (purely local address-book UI);
                            both keep the folded-layout guard. */}
                        {!(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                         : null }

                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}

                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }

                        {/* DND toggle removed from the kebab menu — the
                            bell glyph in the navbar header remains the
                            single entry point for flipping Do Not
                            Disturb. */}

                        {!this.props.inCall ?
                        <Divider />
                         : null }

                        {(false && !this.props.inCall) ?
                        <Menu.Item onPress={() => this.handleMenu('scanQr')} icon="qr-code" title="Scan QR code..." />
                         : null }


                        {!this.props.inCall && false ? <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}
                        {!this.props.inCall ?
                        <Divider />
                        : null}

                        { (this.refetchMessagesForDays != 0 && !this.props.inCall) ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

                        {!this.props.inCall ?
						<Divider />
                        : null}

                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
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
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoAnswerMode')} icon="wrench" title={autoAnswerModeTitle} />
                        : null}


                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu
                        visible={this.state.keyMenuVisible}
                        onDismiss={() => this.setState({keyMenuVisible: !this.state.keyMenuVisible})}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested key submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item
								title="Private key..."
								icon="key"
								onPress={() => this.setState({keyMenuVisible: true})}
							/>
						}
                    >

                        {this.props.canSend() && !this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('exportPrivateKey')} icon="send" title={importKeyLabel} />:null}
                        {this.props.canSend() && !this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('backupPrivateKey')} icon="send" title={'Backup private key...'} />:null}
                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('restorePrivateKey')} icon="key" title="Restore private key..."/> :null}
                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('generatePrivateKey')} icon="key" title="Generate private key..."/> :null}
                        {(!this.props.inCall) ? <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}

                        {this.props.publicKey ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

					</Menu>
                     : null}

                       {/* My Storage — nested submenu grouping the
                           on-device storage / migration actions (export,
                           contact backup, contact restore). Mirrors the
                           "My private key..." submenu above; placed right
                           after it. Uses storageMenuVisible state. */}
                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu
                        visible={this.state.storageMenuVisible}
                        onDismiss={() => this.setState({storageMenuVisible: !this.state.storageMenuVisible})}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested storage submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item
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
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('exportData')} icon="export" title="Export data..."/> : null}

                       {/* Backup contacts — one-tap local snapshot of this
                           account's contacts, written to the same per-account
                           folder as the weekly auto-backup. On-device only.
                           Grouped with Restore contacts below. */}
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('backupContacts')} icon="content-save" title="Backup contacts..."/> : null}

                       {/* Restore contacts — add-only restore from a local
                           backup snapshot. Lists backups with their count of
                           contacts missing locally; importing creates those
                           locally and on the server (no updates / deletes). */}
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('importContacts')} icon="account-multiple-plus" title="Restore contacts..."/> : null}

                       {/* Delimiter after the grouped contacts backup /
                           restore actions. */}
                       {!this.props.inCall ? <Divider /> : null}

                       {/* Backup messages — full local message-store dump for
                           this account, written as plaintext JSON to the
                           per-account messages/history folder. On-device only. */}
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('backupMessages')} icon="message-lock" title="Backup messages..."/> : null}

                       {/* Restore messages — opens a modal listing message
                           backups; each is loaded on demand to show how many
                           messages are new vs current storage, then add-only
                           restored (missing rows only). */}
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('restoreMessages')} icon="message-arrow-left" title="Restore messages..."/> : null}

                       {/* Refetch messages — opens a modal to pick how many
                           days to go back, then re-downloads the journal for
                           that window from the server and overwrites the local
                           message store (app.js refetchMessages → resetStorage
                           + requestSyncConversations). On-device + server. */}
                       {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('openRefetchMessages')} icon="cloud-download" title="Refetch messages..."/> : null}

						</Menu>
                     : null}

                       {/* Settings — nested submenu grouping the
                           account / preferences / permissions actions.
                           Mirrors the "My private key..." and
                           "My Storage..." submenus above. Uses
                           settingsMenuVisible state. The individual
                           items keep their original render guards. */}
                     {!(this.props.isFolded && !this.props.selectedContact) ?
                     <Menu
                        visible={this.state.settingsMenuVisible}
                        onDismiss={() => this.setState({settingsMenuVisible: !this.state.settingsMenuVisible})}
                        // Same camera-cutout offset as the parent
                        // menu — keeps the nested settings submenu from
                        // peeking out under the notch.
                        style={topInset ? {marginTop: topInset} : null}
						anchor={
							<Menu.Item
								title="Settings..."
								icon="cog-outline"
								onPress={() => this.setState({settingsMenuVisible: true})}
							/>
						}
                    >

                       {/* My account — was a top-level item; moved into
                           Settings. Keeps its original guards. */}
                       {!this.props.syncConversations && !this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}

                       {/* Preferences modal — opens a sheet of
                           per-account toggles (encryption mode, video
                           codec, etc.). Pure UI; no overlap with an
                           active call. */}
                       <Menu.Item onPress={() => this.handleMenu('preferences')} icon="cog-outline" title="Preferences..." />

                        {/* Permissions — deep-links to the OS settings
                            screen for Blink. Useful mid-call when the
                            user realises camera/mic/location wasn't
                            granted. */}
                        <Menu.Item onPress={() => this.handleMenu('appSettings')} icon="policy-alert" title="Permissions"/>

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
                        {Platform.OS === 'android' && this.state.locationDisclosureAcknowledged && !this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('viewLocationDisclosure')} icon="shield-account" title="Location privacy policy..."/>
                         : null }

                        {/* Help… — opens the in-app log viewer / support
                            request modal. Available in every context
                            (with or without a selected contact, folded
                            or not), since the user can need help at any
                            point — including from inside an open chat. */}
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="lifebuoy" title="Logs…" />

                        {/* Donate moved out of this menu — it now lives
                            as a button inside the About Blink modal,
                            which opens the same PaymentInfoModal
                            ('donate' template) after closing itself. */}

                        {/* About Blink — purely informational (version,
                            build id, dev-mode toggle). No call overlap
                            so we keep it visible. */}
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Blink"/>
                        {/* Divider above Sign out — sets the destructive
                            session-end action visually apart from the
                            settings/info entries above. */}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Divider /> : null}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
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
