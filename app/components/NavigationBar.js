import React, { Component, Fragment } from 'react';
import { Alert, Animated, AppState, Easing, Linking, Image, NativeModules, Platform, PermissionsAndroid, View , TouchableHighlight, Dimensions, ActivityIndicator} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button, ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
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
const ENABLE_MEET_SIMULATION = false;
const SIM_STEP_INTERVAL_MS = 10000;
const SIM_STEP_METERS = 50;
const SIM_TICKS_TO_CONVERGE = 5;

const blinkLogo = require('../assets/images/blink-white-big.png');

import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import EditConferenceModal from './EditConferenceModal';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import PreferencesModal from './PreferencesModal';
import WebViewURLResolver from './WebViewURLResolver';
import DeleteAccountModal from './DeleteAccountModal';
import SwitchAccountModal from './SwitchAccountModal';
import GenerateKeysModal from './GenerateKeysModal';
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import DeleteHistoryModal from './DeleteHistoryModal';
import DeleteFileTransfers from './DeleteFileTransfers';
import VersionNumber from 'react-native-version-number';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import ShareLocationModal from './ShareLocationModal';
import LocationPrivacyDisclosureModal from './LocationPrivacyDisclosureModal';
import ActiveLocationSharesModal from './ActiveLocationSharesModal';
import {openSettings, check, request, PERMISSIONS, RESULTS} from 'react-native-permissions';
import SylkAppbarContent from './SylkAppbarContent';
import DarkModeManager from '../DarkModeManager';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
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
} from '../locationDisclosure';

// In-flight share state used to live in AsyncStorage under a single
// global key (`activeLocationShares.v1`). It now lives per-account
// in the SQL `accounts.app_state` column, reached via the
// readAppStateNamespace / writeAppStateNamespace props on this
// component. The legacy AsyncStorage key is wiped at app boot
// (app.js _wipeLegacyAppStateAsyncStorage). See _persistActiveShares /
// _loadAndResumeActiveShares for the read-write pair that keeps
// in-flight shares alive across app restarts (graceful or hard kill).

import styles from '../assets/styles/NavigationBar';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.refetchMessagesForDays = 30;

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
            showDeleteFileTransfers: false,
            showEditContactModal: false,
            showPreferencesModal: false,
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
			// Headless WebView URL resolver state. When set to
			// a string, a hidden <WebViewURLResolver/> is mounted
			// in render() to expand `webViewResolveUrl` to its
			// JS-driven destination. Used as a fallback when
			// `utils.resolveShortLocationUrl`'s plain HTTP fetch
			// can't follow Google's Firebase Dynamic Link redirect
			// for `maps.app.goo.gl/<id>` URLs (the destination is
			// computed at runtime by JS that never runs in our
			// fetch). When the WebView captures the first
			// navigation, `webViewResolveCallback` fires with the
			// final URL string and the slot is cleared.
			webViewResolveUrl: null,
			webViewResolveCallback: null,
			webViewResolveError: null,
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
    // "Connecting peer…", …) so the user isn't left staring at a
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
        const cs = this.state._warmupCallState || call.state;
        if (!cs || cs === 'established' || cs === 'terminated') {
            return null;
        }
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
        const ice = this.state._warmupIceConn;
        const gather = this.state._warmupGather;
        const conn = this.state._warmupConn;
        // PC reports a failure — surface it rather than the optimistic
        // SIP state.
        if (ice === 'failed' || conn === 'failed') {
            return 'Connection failed';
        }
        if (ice === 'checking' || conn === 'connecting') {
            return 'Connecting peer…';
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
        if (this._simStates) {
            for (const uri of Object.keys(this._simStates)) {
                const sim = this._simStates[uri];
                if (sim && sim.timerId) {
                    try { clearInterval(sim.timerId); } catch (e) { /* noop */ }
                }
            }
            this._simStates = {};
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

		// Fold-state transition: clear the cached appBarMeasuredHeight
		// so the next onLayout on the freshly-mounted Appbar.Header
		// (we already remount it via key={'appbar-header-' +
		// _navRemountKey}) reports the new height to the parent.
		// Without this clear, the height the parent uses for the
		// chat panel's keyboardVerticalOffset would stay frozen at
		// whatever was measured on the cover display, which made the
		// inner-display layout look "smaller than normal" after
		// unfolding.
		if (prevProps.isFolded !== this.props.isFolded) {
			if (this.state.appBarMeasuredHeight !== null) {
				this.setState({ appBarMeasuredHeight: null });
			}
		}

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
                this.setState({showDeleteHistoryModal: true, deleteContact: true});
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

        this.setState({menuVisible: false, keyMenuVisible: false});
    }

    toggleAboutModal() {
        this.setState({showAboutModal: !this.state.showAboutModal});
    }

    showConferenceLinkModal() {
        this.setState({showConferenceLinkModal: true});
    }

    hideConferenceLinkModal() {
        this.setState({showConferenceLinkModal: false});
    }

    async showShareLocationModal() {
        // Step 1: Google Play "Prominent Disclosure" gate. Fires the
        // FIRST time the user taps Share location at any entry point
        // (chat-header pin, kebab, etc.) BEFORE any other UI. The
        // AsyncStorage flag set on Continue collapses subsequent
        // taps straight through.
        const acknowledged = await this._ensureLocationDisclosureAcknowledged();
        if (!acknowledged) {
            utils.timestampedLog('[location] showShareLocationModal: disclosure declined — not opening picker');
            return;
        }

        // Step 2: OS permission. Run this BEFORE the duration picker
        // so the user knows whether location is even available before
        // bothering to pick how long to share for. The probe + request
        // chain is the same one startLocationSharing uses; calling it
        // up-front means:
        //   • A user who's never granted permission sees the Android
        //     dialog right after I agree, where they expect it.
        //   • A user who has previously denied (blocked) sees the
        //     "Open Settings" alert immediately rather than
        //     pick-a-duration → confirm → wait → finally see the
        //     blocked notice.
        //   • A user who already granted just falls through to the
        //     picker without any visible delay.
        // The duration picker only opens if permission is actually
        // granted; otherwise we abort silently and let the alert
        // (or the user's next attempt after fixing Settings) drive.
        let hasPermission = false;
        try {
            hasPermission = await this.ensureLocationPermission();
        } catch (e) {
            hasPermission = false;
        }
        if (!hasPermission) {
            utils.timestampedLog('[location] showShareLocationModal: OS permission not granted — picker stays closed');
            // Show a one-tap-to-Settings alert so the user has a
            // recovery path. Mirrors the alert wording from
            // shareLocationOnce / startLocationSharing.
            const openSettingsFn = () => {
                try {
                    if (Platform.OS === 'ios') {
                        Linking.openURL('app-settings:');
                    } else {
                        try { openSettings(); }
                        catch (e) { Linking.openSettings && Linking.openSettings(); }
                    }
                } catch (e) { /* noop */ }
            };
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access."
                    : "Open Settings to allow Blink to access your location.",
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        // Re-hydrate the disclaimer-suppressed flag from app_state
        // right before opening. The flag is also hydrated on
        // registrationState transitions and accountId changes, but
        // there's a window (e.g. first share after a cold launch
        // before registration completes, OR a Maps-link tap that
        // opens the modal optimistically) where the React state
        // mirror lags the persisted value. Reading from SQL each
        // open guarantees the disclaimer block is hidden whenever
        // the user has previously confirmed with the box ticked.
        // Cost: one SQL SELECT, ~2 ms — well below the picker's
        // open-perception threshold.
        try { await this._hydrateDisclaimerSuppression(); }
        catch (e) { /* best-effort — fall through with stale value */ }

        // Step 3: open the duration picker.
        this.setState({showShareLocationModal: true});

        // Fire a getCurrentCoordinates fetch in the background so the
        // preview map inside ShareLocationModal can show the user's
        // current position alongside the destination.
        this._fetchPreviewLocation();
    }

    // Fire-and-forget GPS fetch to populate `state.previewUserLocation`.
    // Called from BOTH share-modal-open paths: showShareLocationModal()
    // (button-tap entry) AND meetMeAt() (chat-link entry which opens
    // the modal via direct setState). Without this both-paths wiring
    // a "Meet me there..." flow opens the modal but never gets a
    // user pin because the GPS fetch fires only on the button-tap
    // path.
    _fetchPreviewLocation() {
        // Reset the previous fix immediately so a stale one from an
        // earlier modal-open doesn't render briefly while the new
        // one is in flight.
        this.setState({previewUserLocation: null});
        try {
            utils.timestampedLog('[location] preview: requesting current location for share modal');
            this.getCurrentCoordinates().then((coords) => {
                if (this._unmounted) {
                    utils.timestampedLog('[location] preview: GPS fix landed but component unmounted — discarding');
                    return;
                }
                if (!coords
                        || typeof coords.latitude !== 'number'
                        || typeof coords.longitude !== 'number') {
                    utils.timestampedLog('[location] preview: GPS fix returned invalid coords',
                        JSON.stringify(coords));
                    return;
                }
                // Defensive: if the modal was already closed before the
                // fix landed, don't write stale state.
                if (!this.state.showShareLocationModal) {
                    utils.timestampedLog(
                        '[location] preview: GPS fix landed but modal already closed — discarding'
                    );
                    return;
                }
                utils.timestampedLog(
                    '[location] preview: current location acquired —',
                    coords.latitude.toFixed(5) + ',' + coords.longitude.toFixed(5),
                    typeof coords.accuracy === 'number'
                        ? `±${Math.round(coords.accuracy)}m`
                        : ''
                );
                this.setState({previewUserLocation: {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                }});
            }).catch((err) => {
                utils.timestampedLog(
                    '[location] preview: getCurrentCoordinates failed —',
                    err && err.message ? err.message : err,
                    'code=', err && err.code
                );
            });
        } catch (e) {
            utils.timestampedLog(
                '[location] preview: getCurrentCoordinates threw synchronously —',
                e && e.message ? e.message : e
            );
        }
    }

    hideShareLocationModal() {
        // Always clear the pending destination + URL + status on
        // close. Confirm and cancel both route here.
        // onShareLocationConfirmed reads pendingShareDestination
        // (and re-tries pendingShareDestinationUrl as a last-ditch
        // synchronous resolve) BEFORE this fires, so confirmed
        // shares still get the destination.
        this.setState({
            showShareLocationModal: false,
            pendingShareDestination: null,
            pendingShareDestinationUrl: null,
            pendingShareDestinationStatus: null,
            // Drop the preview pin so a stale fix doesn't render
            // briefly the next time the modal opens with a different
            // destination — showShareLocationModal will rearm a fresh
            // getCurrentCoordinates fetch.
            previewUserLocation: null,
        });
    }

    // Bridge from ContactsListBox's "Meet me there..." kebab / inline
    // icon on a Google-Maps-link text bubble. Stages the destination
    // and opens the share-location duration picker. The user picks the
    // meet-up duration; on confirm `onShareLocationConfirmed` reads
    // pendingShareDestination and stamps it onto every emitted tick.
    //
    // Accepts the descriptor returned by `utils.extractLocationLink`:
    //   {type: 'direct', coords: {latitude, longitude}}
    //     Stage immediately and open the panel.
    //   {type: 'short', url}
    //     Open the panel immediately, then resolve the short URL in
    //     the BACKGROUND. The panel doesn't have to wait on the
    //     network round-trip. If the user confirms before resolution
    //     completes, onShareLocationConfirmed does a final synchronous
    //     resolve as a fallback (also reads
    //     pendingShareDestinationUrl).
    async meetMeAt(uri, link) {
        if (!uri || !link) {
            console.log('[location] meetMeAt: missing uri or link', uri, link);
            return;
        }
        // Backwards compat: an older ContactsListBox build called
        // meetMeAt(uri, coords) directly. Detect the bare-coords
        // shape and wrap it as a direct link descriptor.
        if (link && typeof link.latitude === 'number'
                && typeof link.longitude === 'number') {
            link = {type: 'direct', coords: link};
        }
        if (link.type === 'direct') {
            utils.timestampedLog('[location] meetMeAt: direct destination',
                link.coords.latitude.toFixed(5), ',', link.coords.longitude.toFixed(5),
                'for', uri);
            // Open panel synchronously via state — see the short-URL
            // branch below for why we don't go through
            // showShareLocationModal here either. The permission /
            // disclosure gates run as a background task and only kick
            // in when the user actually confirms the share.
            this.setState({
                pendingShareDestination: {
                    latitude: link.coords.latitude,
                    longitude: link.coords.longitude,
                },
                pendingShareDestinationUrl: null,
                pendingShareDestinationStatus: 'resolved',
                showShareLocationModal: true,
            });
            // Same fire-and-forget GPS fetch the button-tap entry
            // path runs (see showShareLocationModal). Without this
            // the "Meet me there..." flow opens the modal but the
            // user pin never appears — meetMeAt bypasses
            // showShareLocationModal() entirely (we open the panel
            // optimistically rather than awaiting permission /
            // disclosure gates).
            this._fetchPreviewLocation();
            // Refresh the disclaimer-suppression mirror from
            // app_state. Fire-and-forget — the modal already
            // rendered above; when this resolves it'll setState and
            // the modal re-renders without the disclaimer block.
            this._hydrateDisclaimerSuppression();
            this._meetMeAtRunGates(uri);
            return;
        }
        if (link.type === 'short') {
            utils.timestampedLog('[location] meetMeAt: short URL — opening panel + resolving in parallel',
                link.url, 'for', uri);
            // Open the panel SYNCHRONOUSLY by flipping
            // showShareLocationModal in the same setState. Going
            // through this.showShareLocationModal() awaits async
            // disclosure + permission gates BEFORE rendering the
            // panel, which the user reported as a noticeable delay
            // — the meet-me-there flow already has a clear user
            // intent (they tapped a button on a maps link) so we
            // can show the panel optimistically and let the gates
            // run in the background. If a gate fails it closes the
            // panel and surfaces an alert (see _meetMeAtRunGates).
            this.setState({
                pendingShareDestination: null,
                pendingShareDestinationUrl: link.url,
                pendingShareDestinationStatus: 'resolving',
                showShareLocationModal: true,
            });
            // Fire the GPS fetch in parallel with the URL resolve so
            // the user pin / privacy-radius circle appear as soon as
            // both have landed. Same wiring as the direct-coords
            // branch above — see the comment there.
            this._fetchPreviewLocation();
            // Same fire-and-forget rehydrate as the direct-coords
            // path. The modal opens optimistically with stale state;
            // this re-syncs from SQL and a re-render will hide the
            // disclaimer block within a frame or two.
            this._hydrateDisclaimerSuppression();
            // Three things now happen in parallel: the panel
            // renders (already triggered by setState), the URL
            // resolves over the network, and the permission gates
            // run. Each writes back via setState as it completes.
            this._meetMeAtRunGates(uri);
            const _kickedOffFor = link.url;
            const _isStale = () => this.state.pendingShareDestinationUrl !== _kickedOffFor;
            // Two-stage resolve: cheap HTTP fetch first (works for
            // `maps.google.com/?q=lat,lng` style canonical URLs and
            // for short URLs that redirect via HTTP). If that
            // doesn't yield coords AND the URL is on a known
            // JS-driven shortener (Firebase Dynamic Link), fall back
            // to a headless WebView load to capture the JS-computed
            // destination URL and re-parse.
            utils.resolveShortLocationUrl(link.url)
                .then((coords) => {
                    if (_isStale()) return;
                    if (coords) {
                        utils.timestampedLog('[location] meetMeAt: short URL resolved (HTTP) →',
                            coords.latitude.toFixed(5), ',', coords.longitude.toFixed(5));
                        this.setState({
                            pendingShareDestination: coords,
                            pendingShareDestinationStatus: 'resolved',
                        });
                        return;
                    }
                    // Plain fetch failed. Try WebView for the
                    // FDL / shortener URLs we know need JS.
                    utils.timestampedLog('[location] meetMeAt: HTTP resolve had no coords — falling back to WebView for',
                        link.url);
                    return this._resolveViaWebView(link.url)
                        .then((finalUrl) => {
                            if (_isStale()) return;
                            utils.timestampedLog('[location] meetMeAt: WebView captured finalUrl=',
                                finalUrl);
                            const fromUrl = utils.parseSharedLocationUrl(finalUrl);
                            if (fromUrl) {
                                this.setState({
                                    pendingShareDestination: fromUrl,
                                    pendingShareDestinationStatus: 'resolved',
                                });
                                return;
                            }
                            // No inline coords. Last-resort fallback:
                            // many "share place by name" URLs carry
                            // an address in `?q=` (e.g.
                            // `maps.google.com/?q=Atic+Millennium,...`)
                            // — geocode that via Nominatim. The
                            // resolve chain doesn't fail until even
                            // the geocode comes back empty.
                            const _addr = utils.extractQueryAddress(finalUrl);
                            if (_addr) {
                                utils.timestampedLog('[location] meetMeAt: no inline coords — geocoding address',
                                    JSON.stringify(_addr));
                                return utils.geocodeAddress(_addr).then((coords) => {
                                    if (_isStale()) return;
                                    if (coords) {
                                        utils.timestampedLog('[location] meetMeAt: geocode resolved →',
                                            coords.latitude.toFixed(5), ',', coords.longitude.toFixed(5));
                                        this.setState({
                                            pendingShareDestination: coords,
                                            pendingShareDestinationStatus: 'resolved',
                                        });
                                    } else {
                                        utils.timestampedLog('[location] meetMeAt: geocode had no match for',
                                            JSON.stringify(_addr));
                                        this.setState({pendingShareDestinationStatus: 'failed'});
                                    }
                                });
                            }
                            utils.timestampedLog('[location] meetMeAt: WebView finalUrl had no parseable coords + no q= address —',
                                finalUrl);
                            this.setState({pendingShareDestinationStatus: 'failed'});
                        });
                })
                .catch((err) => {
                    if (_isStale()) return;
                    utils.timestampedLog('[location] meetMeAt: resolve chain failed',
                        err && err.message ? err.message : err);
                    this.setState({pendingShareDestinationStatus: 'failed'});
                });
            return;
        }
        console.log('[location] meetMeAt: unknown link type', link);
    }

    // Headless WebView URL resolver. Returns a Promise that resolves
    // to the FIRST destination URL the page navigates to (typically
    // the canonical Google Maps URL with @lat,lng baked in), OR
    // rejects on timeout / error. Used by meetMeAt as a fallback
    // when `utils.resolveShortLocationUrl`'s plain HTTP fetch
    // returns no coords. Only one resolution can be in flight at a
    // time — the second concurrent caller is rejected immediately.
    _resolveViaWebView(shortUrl) {
        return new Promise((resolve, reject) => {
            if (this.state.webViewResolveUrl) {
                reject(new Error('webview resolver busy'));
                return;
            }
            const callback = (finalUrl, err) => {
                this.setState({
                    webViewResolveUrl: null,
                    webViewResolveCallback: null,
                    webViewResolveError: null,
                });
                if (err) reject(err);
                else resolve(finalUrl);
            };
            this.setState({
                webViewResolveUrl: shortUrl,
                webViewResolveCallback: callback,
                webViewResolveError: null,
            });
        });
    }

    // Run the permission / disclosure gates as a fire-and-forget
    // background task. If a gate fails, close the meet-me-there
    // panel and surface the same alert showShareLocationModal would
    // show. If they pass, no-op — the panel is already open and the
    // user proceeds normally.
    async _meetMeAtRunGates(uri) {
        try {
            const acknowledged = await this._ensureLocationDisclosureAcknowledged();
            if (!acknowledged) {
                utils.timestampedLog('[location] meetMeAt: disclosure declined — closing panel');
                this.hideShareLocationModal();
                return;
            }
            let hasPermission = false;
            try {
                hasPermission = await this.ensureLocationPermission();
            } catch (e) {
                hasPermission = false;
            }
            if (!hasPermission) {
                utils.timestampedLog('[location] meetMeAt: OS permission missing — closing panel');
                this.hideShareLocationModal();
                const openSettingsFn = () => {
                    try {
                        if (Platform.OS === 'ios') {
                            Linking.openURL('app-settings:');
                        } else {
                            try { openSettings(); }
                            catch (e) { Linking.openSettings && Linking.openSettings(); }
                        }
                    } catch (e) { /* noop */ }
                };
                Alert.alert(
                    'Location permission required',
                    Platform.OS === 'ios'
                        ? "Open Settings → Blink → Location to allow location access."
                        : "Open Settings to allow Blink to access your location.",
                    [
                        {text: 'Cancel', style: 'cancel'},
                        {text: 'Open Settings', onPress: openSettingsFn},
                    ],
                    {cancelable: true}
                );
            }
        } catch (e) {
            utils.timestampedLog('[location] meetMeAt: gate evaluation failed',
                e && e.message ? e.message : e);
        }
    }

    // Check the **precise** current location-permission state without
    // triggering any native prompt. Used by the "Share location" flow to
    // decide upfront whether the share will survive a swipe to background.
    // Returns one of:
    //   'always'       — granted for background use (our happy path)
    //   'whenInUse'    — granted for foreground only; share will die on background
    //   'blocked'      — user tapped "Don't Allow" previously; Settings is the
    //                    only recovery path (native prompt won't re-appear)
    //   'undetermined' — never asked; a subsequent request() will prompt
    //   'unavailable'  — device has no location services
    async getLocationPermissionStatus() {
        if (Platform.OS === 'ios') {
            try {
                // Probe Always first — that's the capability that matters
                // for background sharing. If it's granted we're done.
                const alwaysStatus = await check(PERMISSIONS.IOS.LOCATION_ALWAYS);
                if (alwaysStatus === RESULTS.GRANTED || alwaysStatus === RESULTS.LIMITED) {
                    return 'always';
                }
                if (alwaysStatus === RESULTS.BLOCKED) {
                    return 'blocked';
                }
                // alwaysStatus === DENIED means "not yet prompted for
                // Always" OR "WhenInUse granted but no Always upgrade yet"
                // — the WhenInUse check disambiguates.
                const whenStatus = await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
                if (whenStatus === RESULTS.GRANTED || whenStatus === RESULTS.LIMITED) {
                    return 'whenInUse';
                }
                if (whenStatus === RESULTS.BLOCKED) {
                    return 'blocked';
                }
                // Both probes came back UNAVAILABLE: the permission handler
                // pods (RNPermissions/LocationAlways, /LocationWhenInUse) are
                // almost certainly not installed in the current Podfile. The
                // device itself still has working location services, so we
                // must NOT surface "Location unavailable" to the user. Treat
                // it as 'undetermined' so startLocationSharing falls through
                // to the RNCGeolocation path, which asks iOS directly via
                // requestAuthorization. Real device-has-no-location is so
                // rare on iPhones that we'd rather risk a no-op prompt than
                // block a working feature on a Podfile oversight.
                if (alwaysStatus === RESULTS.UNAVAILABLE
                    && whenStatus === RESULTS.UNAVAILABLE) {
                    console.log('[location] react-native-permissions Location '
                        + 'subspecs not installed — skipping upfront probe');
                    return 'undetermined';
                }
                if (whenStatus === RESULTS.UNAVAILABLE) {
                    return 'unavailable';
                }
                return 'undetermined';
            } catch (e) {
                console.log('[location] getLocationPermissionStatus iOS failed',
                    e && e.message ? e.message : e);
                return 'undetermined';
            }
        }
        if (Platform.OS === 'android') {
            try {
                const fine = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
                if (fine === RESULTS.BLOCKED) return 'blocked';
                if (fine === RESULTS.UNAVAILABLE) return 'unavailable';
                if (fine !== RESULTS.GRANTED && fine !== RESULTS.LIMITED) {
                    return 'undetermined';
                }

                // Fine location is granted; now disambiguate foreground-only
                // vs "all the time". On API 29+ ACCESS_BACKGROUND_LOCATION
                // is a separate permission that the user can only enable
                // via Settings on API 30+. Without it CLLocationManager's
                // counterpart on Android (FusedLocationProviderClient /
                // LocationManager) stops delivering updates the moment the
                // process is throttled into the background — even if our
                // foreground service is running. On older devices (API <29)
                // there's no background permission concept; granting fine
                // location is implicitly "always".
                if (Platform.Version == null || Platform.Version < 29) {
                    return 'always';
                }
                const bg = await check(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
                if (bg === RESULTS.GRANTED) return 'always';
                if (bg === RESULTS.BLOCKED) return 'foregroundOnly';
                // Not yet asked, or the subspec isn't installed — treat as
                // foreground-only so the caller can nudge the user toward
                // the background upgrade before starting a share.
                return 'foregroundOnly';
            } catch (e) {
                return 'undetermined';
            }
        }
        return 'unavailable';
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

    async _ensureLocationDisclosureAcknowledged() {
        // The Prominent Disclosure modal is required by Google Play's
        // Permissions and APIs that Access Sensitive Information
        // policy — it's an Android-store thing, not iOS. On iOS the
        // App Store has its own usage-string + system-level
        // disclosure model (NSLocationAlways/WhenInUseUsageDescription
        // is shown by CoreLocation directly), and an additional in-
        // app modal would be redundant and out of place. Short-circuit
        // here so the share-flow on iOS proceeds straight to the OS
        // permission probe.
        if (Platform.OS !== 'android') {
            return true;
        }

        // v1 → v2: disclosure body materially corrected to state that
        // Sylk's server DOES retain the encrypted journal entry until
        // the share's expiry (the v1 wording incorrectly implied the
        // server never sees the data at all). Bumping the key made
        // any user who acknowledged v1 re-see the corrected wording.
        // The v2 key is now further scoped per SIP account in
        // locationDisclosure.js so a second identity on the same
        // device starts fresh.
        const _accountId = this.props.accountId;
        const acknowledged = await readLocationDisclosure(_accountId);
        if (acknowledged === true) {
            return true;
        }
        // Diagnostic: log the OS-level location permission state right
        // before showing the disclosure panel, so we can correlate
        // user reports ("the OS dialog didn't fire after I agree")
        // with the permission state at the time. Best-effort — we
        // don't block the modal on the probe.
        try {
            const permState = await this.getLocationPermissionStatus();
            console.log('[location] disclosure shown — OS permission state =', permState);
        } catch (e) {
            console.log('[location] disclosure shown — getLocationPermissionStatus failed',
                e && e.message ? e.message : e);
        }
        return new Promise((resolve) => {
            this.setState({
                locationDisclosurePending: {
                    onContinue: async () => {
                        await setLocationDisclosure(_accountId);
                        utils.timestampedLog(
                            '[location] user accepted privacy policy via share-flow gate — disclosure flag set for',
                            _accountId);
                        this.setState({
                            locationDisclosurePending: null,
                            locationDisclosureAcknowledged: true,
                        });
                        resolve(true);
                    },
                    onCancel: () => {
                        utils.timestampedLog(
                            '[location] user cancelled privacy policy at share-flow gate — share aborted for',
                            _accountId);
                        this.setState({locationDisclosurePending: null});
                        resolve(false);
                    },
                },
            });
        });
    }

    async ensureLocationPermission() {
        // Android: runtime permission prompt for ACCESS_FINE_LOCATION.
        // Note: ACCESS_BACKGROUND_LOCATION is NOT requested here. On API
        // 30+ the OS refuses to show a runtime dialog for it; the user
        // must flip "Allow all the time" inside Settings. We handle that
        // path separately in startLocationSharing's 'foregroundOnly'
        // branch (explainer Alert → openSettings).
        if (Platform.OS === 'android') {
            try {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    {
                        title: 'Share location',
                        message: 'Blink needs access to your location so it can be shared with your contact.',
                        buttonPositive: 'OK',
                    }
                );
                return granted === PermissionsAndroid.RESULTS.GRANTED;
            } catch (err) {
                console.log('Location permission request failed', err);
                return false;
            }
        }

        // iOS: configure the geolocation module to ask for *Always*
        // authorization and turn on background location updates before
        // the session starts. Without "Always" + UIBackgroundModes=location
        // iOS kills location updates the moment the app is suspended,
        // and our sharing would silently stop.
        if (Platform.OS === 'ios' && Geolocation) {
            try {
                if (typeof Geolocation.setConfiguration === 'function') {
                    Geolocation.setConfiguration({
                        authorizationLevel: 'always',
                        enableBackgroundLocationUpdates: true,
                    });
                }
                if (typeof Geolocation.requestAuthorization === 'function') {
                    // The library's iOS requestAuthorization fires the
                    // SUCCESS callback when the user grants Always or
                    // WhenInUse, and the ERROR callback when the user
                    // denies or has previously denied in Settings. We
                    // faithfully translate those into the Promise result
                    // so startLocationSharing can prompt the user to open
                    // Settings instead of silently starting a share that
                    // can't post.
                    const granted = await new Promise((resolve) => {
                        let settled = false;
                        const settle = (value) => {
                            if (settled) return;
                            settled = true;
                            resolve(value);
                        };
                        try {
                            const maybePromise = Geolocation.requestAuthorization(
                                () => settle(true),
                                () => settle(false)
                            );
                            if (maybePromise && typeof maybePromise.then === 'function') {
                                maybePromise
                                    .then(() => settle(true))
                                    .catch(() => settle(false));
                            }
                        } catch (e) {
                            // Older library builds reject callback form —
                            // optimistically proceed; watchPosition's own
                            // error handler is our safety net.
                            settle(true);
                        }
                        // Safety timeout. Used to optimistically settle
                        // to TRUE if iOS never delivered a change — the
                        // theory was "don't hang the sharing flow if
                        // the dialog never produced an event". In
                        // practice that path landed users in a silent
                        // bug: on a fresh install, if the system
                        // permission dialog was suppressed for any
                        // reason (dismissed during our RN-Modal close
                        // animation, queued behind another alert,
                        // user backgrounded the app before answering),
                        // requestAuthorization's callback never fires,
                        // we returned TRUE, the share started with no
                        // permission, and getCurrentCoordinates
                        // silently failed — so the user saw a
                        // "started sharing" UI with no actual location
                        // ever shipping.
                        //
                        // Now: on timeout we RE-PROBE the OS-level
                        // permission and decide based on what's
                        // actually granted. If the dialog landed but
                        // the callback got lost, the probe sees
                        // 'always' / 'whenInUse' and we still return
                        // true. If nothing was granted, we return
                        // false so startLocationSharing can surface
                        // the "Location permission required" Alert
                        // instead of a no-coord share.
                        setTimeout(async () => {
                            if (settled) return;
                            try {
                                const probe = await this.getLocationPermissionStatus();
                                settle(probe === 'always' || probe === 'whenInUse');
                            } catch (e) {
                                settle(false);
                            }
                        }, 10000);
                    });
                    return granted;
                }
            } catch (e) {
                console.log('iOS location configuration failed', e && e.message ? e.message : e);
            }
            return true;
        }

        return true;
    }

    // ===== Share-location disclaimer suppression =====
    //
    // Reads / writes the per-account
    // `app_state.location.disclaimerSuppressed` flag and mirrors it
    // into React state so the share-location modal can render with
    // the disclaimer hidden when appropriate.

    // Hydrate the in-memory mirror from the persisted app_state row.
    // Idempotent — safe to call on every registrationState transition
    // and on every modal open. No-op when accountId or the read
    // accessor isn't available yet.
    _hydrateDisclaimerSuppression = async () => {
        try {
            const accountId = this.props.accountId;
            const read = this.props.readAppStateNamespace;
            if (!accountId || typeof read !== 'function') {
                //utils.timestampedLog(
                //    '[location] hydrate-disclaimer: skipped — accountId=', accountId,
                //    'read=', typeof read
                //);
                return;
            }
            const location = await read(accountId, 'location');
            const suppressed = !!(location && location.disclaimerSuppressed);
            //utils.timestampedLog(
            //    '[location] hydrate-disclaimer: accountId=', accountId,
            //    'location=', JSON.stringify(location),
            //    '→ suppressed=', suppressed
            //);
            if (this.state.shareDisclaimerSuppressed !== suppressed) {
                this.setState({shareDisclaimerSuppressed: suppressed});
            }
        } catch (e) {
            utils.timestampedLog('[location] _hydrateDisclaimerSuppression failed',
                e && e.message ? e.message : e);
        }
    }

    // Persist `disclaimerSuppressed: true` for the currently signed-in
    // account. Called from the share-location modal's onConfirm path
    // when the user pressed Confirm with "Do not show this again"
    // ticked. We update the in-memory mirror synchronously so the
    // next modal open already sees the suppressed state, even if the
    // SQL UPDATE is still in the debounce window.
    _suppressShareLocationDisclaimer = async () => {
        utils.timestampedLog(
            '[location] suppress-disclaimer: invoked'
        );
        try {
            const accountId = this.props.accountId;
            const read = this.props.readAppStateNamespace;
            const write = this.props.writeAppStateNamespace;
            if (!accountId
                    || typeof read !== 'function'
                    || typeof write !== 'function') {
                utils.timestampedLog(
                    '[location] suppress-disclaimer: skipped — accountId=', accountId,
                    'read=', typeof read, 'write=', typeof write
                );
                return;
            }
            const location = await read(accountId, 'location');
            utils.timestampedLog(
                '[location] suppress-disclaimer: read existing location=', JSON.stringify(location)
            );
            location.disclaimerSuppressed = true;
            await write(accountId, 'location', location);
            utils.timestampedLog(
                '[location] suppress-disclaimer: write completed for', accountId,
                'new location=', JSON.stringify(location)
            );
            this.setState({shareDisclaimerSuppressed: true});
        } catch (e) {
            utils.timestampedLog('[location] _suppressShareLocationDisclaimer failed',
                e && e.message ? e.message : e);
        }
    }

    // Clear the persisted suppression flag. Called from the privacy-
    // policy opt-out path so the legal text re-appears the moment the
    // user revokes their disclosure consent — the suppression is a
    // convenience flag that depends on the user having agreed to the
    // policy in the first place.
    _clearShareLocationDisclaimerSuppression = async () => {
        try {
            const accountId = this.props.accountId;
            const read = this.props.readAppStateNamespace;
            const write = this.props.writeAppStateNamespace;
            if (!accountId
                    || typeof read !== 'function'
                    || typeof write !== 'function') return;
            const location = await read(accountId, 'location');
            if (location.disclaimerSuppressed) {
                delete location.disclaimerSuppressed;
                await write(accountId, 'location', location);
            }
            this.setState({shareDisclaimerSuppressed: false});
        } catch (e) {
            console.log('[location] _clearShareLocationDisclaimerSuppression failed',
                e && e.message ? e.message : e);
        }
    }

    // Park a share-start intent that was blocked on missing OS-level
    // location permission. The user has already tapped Accept / Meet
    // up / Confirm once — re-prompting them after they grant the
    // permission in Settings is a UX failure ("I just said yes, why
    // are you asking again?"). Storing the intent here lets
    // _drainPendingPermissionShares (called from _onAppStateChange)
    // re-run the share automatically the next time the app
    // foregrounds with sufficient permission.
    //
    // Idempotent: a second arming for the same uri replaces the
    // first. The optimistic activeLocationShares pulse and the
    // announcement message are NOT rolled back when arming, so
    // visible UI keeps its "share is starting" feel while the user
    // is in Settings — the auto-resume flips it to a real share once
    // permission lands.
    _armPermissionRetry(uri, durationMs, periodLabel, opts) {
        if (!this._pendingPermissionShares) {
            this._pendingPermissionShares = {};
        }
        // Deep-clone opts so a later mutation by the caller (e.g.
        // tickExtras buildup) can't change the parked intent.
        const safeOpts = {};
        for (const k of Object.keys(opts || {})) {
            safeOpts[k] = opts[k];
        }
        // Strip the resume marker so a future drain doesn't see this
        // entry as an already-resumed one and skip arming on its
        // own permission fail.
        delete safeOpts._resumedAfterPermission;
        this._pendingPermissionShares[uri] = {
            uri,
            durationMs,
            periodLabel,
            opts: safeOpts,
            registeredAt: Date.now(),
            // Honour the original meet-request expiry so we don't
            // fire a retry for a request that has aged out while
            // the user was in Settings. opts.expiresAt is set on
            // meetingAccept (mirrors the requester's expiresAt) and
            // unset for plain timed shares.
            expiresAt: typeof (opts && opts.expiresAt) === 'number'
                ? opts.expiresAt : null,
        };
        utils.timestampedLog(
            '[location] permission-retry armed for', uri,
            '— share will resume automatically when permission is granted'
        );
    }

    // Explicit user-cancellation of a parked share intent. Called
    // from the Cancel button on the permission alerts when the user
    // chose to NOT proceed at all. Cleans up the parked entry AND
    // calls the supplied rollback to wind back the optimistic UI
    // (pulsing icon, announcement bubble) so the chat doesn't sit
    // there pretending a share is starting that the user already
    // told us to forget.
    _cancelPendingPermissionShare(uri, rollbackFn) {
        if (this._pendingPermissionShares
                && this._pendingPermissionShares[uri]) {
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog(
                '[location] permission-retry cancelled by user for', uri
            );
        }
        if (typeof rollbackFn === 'function') {
            try { rollbackFn(); }
            catch (e) { /* rollback is best-effort */ }
        }
    }

    // AppState foreground hook drains this. Re-probe the OS-level
    // permission; for each parked entry, retry startLocationSharing
    // if permission is now sufficient. The retry sets
    // _resumedAfterPermission:true so the inner permission-deferral
    // paths know not to re-arm a fresh entry on the (rare) case the
    // probe was a false positive.
    async _drainPendingPermissionShares() {
        if (!this._pendingPermissionShares) return;
        const uris = Object.keys(this._pendingPermissionShares);
        if (uris.length === 0) return;
        let probe = 'denied';
        try {
            probe = await this.getLocationPermissionStatus();
        } catch (e) { /* probe failures fall through as 'denied' */ }
        const sufficient =
            probe === 'always'
            || probe === 'whenInUse'
            || probe === 'foregroundOnly';
        utils.timestampedLog(
            '[location] permission-retry drain — probe=', probe,
            'sufficient=', sufficient,
            'pending=', uris.length
        );
        if (!sufficient) {
            // Leave entries in place — the user may still be on the
            // way to Settings. Next foreground will probe again.
            return;
        }
        for (const uri of uris) {
            const pending = this._pendingPermissionShares[uri];
            if (!pending) continue;
            // Drop expired meet-accept retries — pointless to start
            // a share whose request has aged out.
            if (typeof pending.expiresAt === 'number'
                    && pending.expiresAt <= Date.now()) {
                utils.timestampedLog(
                    '[location] permission-retry: dropping expired pending for', uri
                );
                delete this._pendingPermissionShares[uri];
                continue;
            }
            // Defensive: someone may have started a share for this
            // uri via a different path while we were waiting. Don't
            // double-start.
            if (this.locationTimers[uri]) {
                delete this._pendingPermissionShares[uri];
                continue;
            }
            // Remove BEFORE starting — startLocationSharing's own
            // permission-deferral path could re-arm if something
            // unexpected (a fresh "blocked" state) happens; clearing
            // first means a single drain pass attempts at most one
            // start per uri. _resumedAfterPermission tells the
            // function to NOT call _armPermissionRetry again, which
            // would otherwise loop.
            const params = pending;
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog(
                '[location] permission-retry: permission now', probe,
                '— resuming share for', uri
            );
            try {
                await this.startLocationSharing(
                    uri,
                    params.durationMs,
                    params.periodLabel,
                    {
                        ...params.opts,
                        _resumedAfterPermission: true,
                        // The original call already shipped the
                        // "I want to meet up" / "I want to meet with
                        // you, too!" / "I am sharing the location for
                        // X hours" announcement before bouncing on
                        // permission. Suppress it on the resume so we
                        // don't post the same line twice.
                        suppressAnnouncement: true,
                    }
                );
            } catch (e) {
                utils.timestampedLog(
                    '[location] permission-retry: resume threw',
                    e && e.message ? e.message : e
                );
            }
        }
    }

    getCurrentCoordinates() {
        // Returns a Promise that resolves to {latitude, longitude, accuracy}
        // or rejects if the geolocation library is missing / the OS denies
        // access / the fix times out.
        return new Promise((resolve, reject) => {
            if (!Geolocation || typeof Geolocation.getCurrentPosition !== 'function') {
                reject(new Error('Geolocation module not available'));
                return;
            }
            Geolocation.getCurrentPosition(
                (position) => {
                    const c = position && position.coords ? position.coords : {};
                    resolve({
                        latitude: c.latitude,
                        longitude: c.longitude,
                        accuracy: c.accuracy,
                        timestamp: position.timestamp,
                    });
                },
                (error) => reject(error),
                {enableHighAccuracy: false, timeout: 15000, maximumAge: 10000}
            );
        });
    }

    // Build and send a single "location" metadata message for the given
    // contact URI with the supplied coordinate + expiration timestamp.
    // `originMetadataId` is null for the very first tick of a session
    // (that first tick becomes the "origin" message the receiver renders).
    // Every subsequent tick carries metadataId = origin's _id so the
    // receiver can find the bubble to update in place.
    sendLocationMetadata(uri, coords, expiresAt, originMetadataId = null, extras = {}) {
        if (!this.props.sendMessage) {
            console.log('sendLocationMetadata: sendMessage prop is not wired');
            return null;
        }

        // Hard guard: never emit a tick without usable coordinates.
        // The receiver — and our own SQL row — would otherwise hold a
        // placeholder "Locating…" record that overwrites any earlier
        // good fix on UPDATE-in-place sessions, and on chat reload
        // there'd be nothing to render. With this guard the only
        // location ticks that ever reach the wire have a real lat/lng,
        // so the SQL row always retains the LAST KNOWN good position
        // even after a brief GPS dropout.
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            console.log('[location] sendLocationMetadata: dropping tick — coords missing for', uri);
            return null;
        }

        // Pause gate: when the entry is flagged paused, swallow the
        // tick. We keep the watchPosition / setInterval armed (so
        // Resume can fire an immediate tick without a re-arm dance),
        // but no metadata leaves the device until the user resumes.
        const _pausedEntry = this.locationTimers && this.locationTimers[uri];
        if (_pausedEntry && _pausedEntry.paused) {
            return null;
        }

        // Atomic origin promotion. Two paths can race to be "the first
        // tick" of a session: the initial getCurrentCoordinates().then()
        // callback in startLocationSharing AND the first
        // watchPosition / setInterval fire (which may complete before
        // the awaited GPS read). Both pass originMetadataId=null
        // because the entry's origin id isn't set yet. Without
        // coordination they'd each send an origin tick and the receiver
        // would render two bubbles. Resolve here:
        //   • If the entry already has an originMetadataId, this tick
        //     is implicitly a follow-up — point it at that origin.
        //   • Otherwise the tick we're about to send IS the origin;
        //     stamp the entry below (after we've generated mId).
        const entryAtSend = this.locationTimers && this.locationTimers[uri];
        let promoteToOrigin = false;
        if (originMetadataId == null) {
            if (entryAtSend && entryAtSend.originMetadataId) {
                originMetadataId = entryAtSend.originMetadataId;
            } else {
                promoteToOrigin = true;
            }
        }

        const mId = uuid.v4();
        const timestamp = new Date();

        // `messageId` is the _id of the **rendered location bubble** this
        // metadata refers to — same semantics as reply/label/rotation. For the
        // very first tick of a session the bubble is *this* message itself
        // (origin and target), so messageId = own envelope _id. For every
        // subsequent tick, messageId points back at the origin tick so the
        // receiver's messagesMetadata store keeps updating the same key and
        // the already-rendered bubble refreshes in place.
        const targetId = originMetadataId || mId;

        const metadataContent = {
            action: 'location',
            // Which bubble to update (origin's _id). Same on every tick of
            // the session — that's how the rendering layer finds the bubble.
            messageId: targetId,
            // null on the first tick; pointer to the origin tick afterwards.
            // Used by the receiver to tell "new sharing session just started"
            // apart from "another update of an existing session."
            metadataId: originMetadataId,
            value: coords,          // {latitude, longitude, accuracy, timestamp}
            expires: expiresAt,     // ISO string of expiration
            timestamp: timestamp,
            uri: uri,
        };

        // "Until we meet" handshake fields, stamped on every outgoing
        // tick of a meeting request (meeting_request:true) and every
        // tick of an acceptance stream (in_reply_to → original request
        // _id). See ShareLocationModal.DURATION_OPTIONS and the
        // acceptance flow in app.js for how these propagate.
        //
        // NOTE: `meeting_request:true` used to be stamped only on the
        // origin tick (`!originMetadataId`). That broke restore-from-
        // SQL on the receiver: every follow-up tick UPDATEs the origin
        // row's `content` column in place (saveOutgoingMessageSql
        // location-update branch in app.js), so the persisted content
        // was the LATEST tick — which didn't carry the flag. On chat
        // reopen the bubble's metadata had `meeting_request === undefined`
        // and the kebab's "Show meeting request..." option vanished.
        // Stamping on every tick keeps the persisted content
        // self-describing without further machinery. Receiver-side
        // handlers (`_noteIncomingMeetingRequest`, etc.) are already
        // idempotent on the requestId, so re-firing them on each
        // update tick is a no-op.
        if (extras.meetingRequest) {
            metadataContent.meeting_request = true;
        }
        // Privacy-deferred origin tick: the inviter chose a privacy
        // radius and is still inside it, so the value coords above are
        // the DESTINATION (not the inviter's actual position). Stamp
        // this flag on the wire so the receiver-side rendering can
        // suppress the inviter pin and show only the destination.
        // Cleared on the first real-coord tick that flows after the
        // user crosses the perimeter. The radius is also stamped so
        // the inviter's bubble can render the "Move <radius>…" hint
        // overlay along the bottom of the map without LocationBubble
        // having to look up the timer entry.
        if (extras.privacyDeferred) {
            metadataContent.privacyDeferred = true;
            const _entry = this.locationTimers && this.locationTimers[uri];
            const r = _entry && Number(_entry.excludeOriginRadiusMeters);
            if (r && r > 0) {
                metadataContent.privacyDeferredRadiusMeters = r;
            }
        }
        if (extras.inReplyTo) {
            metadataContent.in_reply_to = extras.inReplyTo;
        }
        // Optional shared meeting destination, encoded as
        // {latitude, longitude}. Today only set by the convergence
        // simulator (debug; see ENABLE_MEET_SIMULATION) so both
        // devices can walk toward the same point. Future use case is
        // a real "pick where to meet on a map" UI for the inviting
        // party — receiver's map view can render the same pin on both
        // ends. Sender stamps it once it knows the destination; the
        // field is harmless to ignore for clients that don't render
        // it.
        if (extras.destination
                && typeof extras.destination.latitude === 'number'
                && typeof extras.destination.longitude === 'number') {
            metadataContent.destination = {
                latitude: extras.destination.latitude,
                longitude: extras.destination.longitude,
            };
        }
        // One-shot flag — set by shareLocationOnce. Tells the receiver
        // this is a static location share, not a live one: no
        // follow-up ticks will arrive and the bubble should drop the
        // live-share UI affordances (no "expires in", no peer-distance
        // label, etc.).
        if (extras.oneShot) {
            metadataContent.one_shot = true;
        }

        const metadataMessage = {
            _id: mId,
            key: mId,
            createdAt: timestamp,
            metadata: metadataContent,
            text: JSON.stringify(metadataContent),
            // Outgoing messages carry an empty `user` object — GiftedChat
            // warns "user is missing" otherwise (see app/utils.js:192).
            user: {},
        };

        this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');

        // First valid-coords send wins the origin slot for this session.
        // Stamp the entry so concurrent first-fixes (initial GPS-fix
        // resolve vs. first watch / interval callback) can read it and
        // send themselves as updates instead of spawning another origin
        // bubble. Mirrors meetingSessionId for meet-request sessions —
        // the requester's origin _id is the canonical session key.
        if (promoteToOrigin && entryAtSend) {
            entryAtSend.originMetadataId = mId;
            if (entryAtSend.kind === 'meetingRequest' && !entryAtSend.meetingSessionId) {
                entryAtSend.meetingSessionId = mId;
            }
            // Mirror to the persisted snapshot so a kill-and-resume
            // doesn't pick up an older / null id.
            try { this._persistActiveShares(); } catch (e) { /* noop */ }
        }

        // Per-tick breadcrumb. Emitted *after* the send so it's proof the
        // send path ran (not just that we got a fix). Kept terse — one
        // line per tick every LOCATION_REPEAT_MS so background sessions
        // leave a clear trail in Metro / Xcode / adb logcat.
        const role = originMetadataId ? 'update' : 'origin';
        const lat = coords && typeof coords.latitude === 'number'
            ? coords.latitude.toFixed(5) : '?';
        const lng = coords && typeof coords.longitude === 'number'
            ? coords.longitude.toFixed(5) : '?';
        const acc = coords && typeof coords.accuracy === 'number'
            ? ` ±${Math.round(coords.accuracy)}m` : '';
        // Distance-from-origin breadcrumb. The receiver can't compute this on
        // its own (origin is captured per-share on the sender), so we stamp it
        // here. Useful for "I see 17 ticks but didn't move much" — comparing
        // each tick's distFromOrigin tells the recipient at a glance whether
        // the sender was actually progressing or jittering near home. Falls
        // back to '?' if we don't have an origin yet (very first origin tick,
        // or this isn't an "until I return" share).
        const liveEntry = this.locationTimers && this.locationTimers[uri];
        let distFromOriginStr = '';
        if (liveEntry
                && liveEntry.untilReturnOrigin
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            const o = liveEntry.untilReturnOrigin;
            if (typeof o.latitude === 'number' && typeof o.longitude === 'number') {
                const d = this._haversineMeters(o, coords);
                if (Number.isFinite(d)) {
                    distFromOriginStr = ` distFromOrigin=${Math.round(d)}m`;
                }
            }
        }
        // Promoted from console.log → timestampedLog so it lands in the
        // on-device log file (Show logs / "Support needed…"). The previous
        // build only had this on the dev console, so a "17 ticks but stuck"
        // report from a phone in the field had no per-tick evidence to
        // correlate with — just an aggregate counter.
        utils.timestampedLog(
            `[location] tick ${role} → ${uri} ${lat},${lng}${acc} (_id=${mId})${distFromOriginStr}`
        );
        // Record the just-reported coords on the timer entry so
        // _shouldSendUpdateTick's stationary gate can compare future
        // ticks against this baseline. Only meaningful when this is
        // a real coord (placeholder origin ticks land here too with
        // null lat/lng — those shouldn't poison the baseline).
        // Stamp lastReportedAt alongside the coords so the stationary
        // gate's heartbeat override has a reliable "last actually
        // shipped" timestamp; using lastSentMs would conflate "tick
        // attempted" with "tick that left the device" (a gated tick
        // updates lastSentMs but not lastReportedCoords/At).
        // (`liveEntry` was already resolved above for the
        // distFromOrigin breadcrumb — reuse it.)
        if (liveEntry
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            liveEntry.lastReportedCoords = {
                latitude: coords.latitude,
                longitude: coords.longitude,
            };
            liveEntry.lastReportedAt = Date.now();
        }
        // Fire the destination-arrival heads-up if this tick's coords
        // landed within DEST_ARRIVAL_THRESHOLD_M of the shared meeting
        // destination. Once-per-session, gated on the entry flag.
        this._maybeFireDestinationArrival(uri, coords);
        // "Until I return" auto-stop. Runs after every successful
        // tick so the cadence matches the heartbeat (~1/min). Owns
        // its own state machine on the timer entry — see
        // _evaluateUntilReturnGate for the departure→return logic.
        this._evaluateUntilReturnGate(uri, coords);
        return mId;
    }

    // State machine for the caregiver-only "Until I return" share. The
    // share starts immediately, the first valid tick records the
    // origin, and the share auto-stops the moment a later tick reports
    // a position within UNTIL_RETURN_RETURN_M of that origin — but ONLY
    // after the user has previously moved more than
    // UNTIL_RETURN_DEPARTURE_M away (the "departed" flag). Without the
    // departed gate the share would terminate on its very first
    // GPS-confirming tick, since the first tick is by definition at
    // the origin.
    //
    // No-op for any kind other than 'untilIReturn'; the regular
    // expires-at timer handles the 8h fallback ceiling for the
    // never-returns case (set in startLocationSharing via durationMs).
    //
    // Idempotent: if the tick is missing valid coords, or the entry
    // disappeared between scheduling and now, we just bail.
    _evaluateUntilReturnGate(uri, coords) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry || entry.kind !== 'untilIReturn') return;
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            return;
        }
        // First valid tick: record the origin and the initial phase.
        // We DON'T evaluate the gate on the same tick that captures
        // the origin — origin↔current distance is 0 by construction
        // and the departed flag is still false, so the gate would do
        // nothing anyway, but starting the math on the next tick keeps
        // the state machine easier to reason about.
        if (!entry.untilReturnOrigin) {
            entry.untilReturnOrigin = {
                latitude: coords.latitude,
                longitude: coords.longitude,
            };
            entry.untilReturnDeparted = false;
            try {
                utils.timestampedLog(
                    `[location] [untilIReturn] origin captured for ${uri} → `
                    + `${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)} `
                    + `— share will auto-stop when you return after moving ≥${this.UNTIL_RETURN_DEPARTURE_M} m away`
                );
            } catch (e) { /* noop */ }
            return;
        }
        const distance = this._haversineMeters(entry.untilReturnOrigin, {
            latitude: coords.latitude,
            longitude: coords.longitude,
        });
        if (!Number.isFinite(distance)) return;
        if (!entry.untilReturnDeparted) {
            // Phase 1: waiting for the user to physically leave the
            // origin neighbourhood. Until they do, every tick stays
            // "near home" and we don't terminate the share.
            if (distance > this.UNTIL_RETURN_DEPARTURE_M) {
                entry.untilReturnDeparted = true;
                try {
                    utils.timestampedLog(
                        `[location] [untilIReturn] departure detected for ${uri} `
                        + `(${Math.round(distance)} m from origin) — now watching for return`
                    );
                } catch (e) { /* noop */ }
            }
            return;
        }
        // Phase 2: user has departed. As soon as we see a tick that
        // lands them back inside the return ring, terminate the
        // share. stopLocationSharing handles the system note, persisted
        // state, foreground service teardown, etc.; we just signal
        // the reason so future log-grep / analytics can tell why
        // this share ended.
        if (distance <= this.UNTIL_RETURN_RETURN_M) {
            try {
                utils.timestampedLog(
                    `[location] [untilIReturn] return detected for ${uri} `
                    + `(${Math.round(distance)} m from origin) — stopping share`
                );
            } catch (e) { /* noop */ }
            this.stopLocationSharing(uri, {reason: 'returned'});
        }
    }

    // ===== Destination arrival heads-up =====
    //
    // Fired on the first outgoing tick whose coords are within
    // DEST_ARRIVAL_THRESHOLD_M of the shared meeting destination
    // (the green pin). Independent of proximity-met: that one waits
    // for both phones to be near each other, this one watches a
    // single party reach the chosen meeting point — useful when
    // one party arrives early so the still-walking party knows
    // their friend is already there.
    //
    // Behaviour on the ARRIVING device:
    //   • Single line in the user-visible log.
    //   • Chat message to the peer ("<MyName> arrived at the meeting
    //     point") with metadata.meetingArrival = true. Flows through
    //     the standard PGP text path.
    // No local push to ourselves — we ARE at the meeting point, we
    // know. The peer's app.js detects the incoming meetingArrival
    // text on its side and fires the heads-up push there (see
    // handleIncomingMessage). That way only the still-walking
    // side gets a banner.
    //
    // Once-per-session via entry.destinationArrivalFired.
    _maybeFireDestinationArrival(uri, coords) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry) return;
        if (entry.destinationArrivalFired) return;
        // Privacy-deferred origin tick: the value coords passed in are
        // the destination itself (we ship them as a stand-in while the
        // inviter is hiding their position inside the privacy radius).
        // Don't treat this as "arrived" — there's no real position
        // data yet. The flag clears when the inviter crosses the
        // perimeter and a real coord update flows; arrival detection
        // resumes from that point onward.
        if (entry.privacyDeferred) return;
        const dest = entry.tickExtras && entry.tickExtras.destination;
        if (!dest) return;
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            // Placeholder origin tick (null lat/lng) — wait for real
            // coords.
            return;
        }
        const dist = this._haversineMeters(coords, dest);
        if (!Number.isFinite(dist)) return;
        const DEST_ARRIVAL_THRESHOLD_M = 30;
        if (dist > DEST_ARRIVAL_THRESHOLD_M) return;

        entry.destinationArrivalFired = true;

        const myDisplayName = this.props.myDisplayName || 'I';

        // 1. Visible log line on this device.
        try {
            const utils = require('../utils');
            utils.timestampedLog(
                `[location] [meet] ARRIVED at meeting point (${Math.round(dist)} m from destination) — ${uri}`
            );
        } catch (e) { /* noop */ }

        // 2. Chat message to the peer. The peer's handleIncomingMessage
        //    sees metadata.meetingArrival on this and fires the
        //    arrival push on THEIR side (and suppresses the default
        //    "New message" banner so we don't double-buzz).
        if (typeof this.props.sendMessage === 'function') {
            try {
                const msgId = uuid.v4();
                const announceText = `${myDisplayName} arrived at the meeting point`;
                const textMessage = {
                    _id: msgId,
                    key: msgId,
                    createdAt: new Date(),
                    text: announceText,
                    metadata: {meetingArrival: true},
                    user: {},
                };
                this.props.sendMessage(uri, textMessage);
            } catch (e) {
                console.log('[location] arrival announcement send failed',
                    e && e.message ? e.message : e);
            }
        }
    }

    // Send one location metadata update. Fetches a fresh fix every time
    // so each tick carries the user's current position. Returns the _id
    // of the tick that was sent (so the first call can record the origin).
    //
    // When `excludeOriginRadius` is enabled on the session, this method
    // honours the privacy gate via `_shouldSendUpdateTick`: the very
    // first fresh fix is captured as the session's origin point and
    // swallowed (returns null), and any subsequent fix that's still
    // within 1 km of that origin is also swallowed. Ticks resume the
    // moment the user has moved past the radius.
    async sendLocationUpdate(uri, expiresAt, originMetadataId = null, extras = {}) {
        try {
            // Race fence: see the long comment on
            // entry.awaitingSimulatedPosition in startLocationSharing.
            // While the accepter's synthetic-position setup is still
            // in flight (Nominatim land-check), skip the tick rather
            // than ship a real-GPS one that would mistakenly pair
            // both phones at ~1 m and trip proximity-met.
            const entryNow = this.locationTimers && this.locationTimers[uri];
            if (entryNow
                    && entryNow.awaitingSimulatedPosition
                    && !entryNow.simulatedPosition) {
                return null;
            }
            const realCoords = await this.getCurrentCoordinates();
            // Synthetic-position override (debug; see
            // ENABLE_MEET_SIMULATION). When an entry.simulatedPosition
            // is armed, that's what we report; real GPS is ignored
            // for this session.
            const coords = this._effectiveCoordinatesForSession(uri, realCoords);
            if (!this._shouldSendUpdateTick(uri, coords)) {
                // Privacy radius is hiding the tick from the wire —
                // refresh the LOCAL bubble's owner pin so the user
                // sees themselves move on their own map.
                const _curEntry = this.locationTimers && this.locationTimers[uri];
                if (_curEntry && _curEntry.privacyDeferred
                        && _curEntry.privacyDeferredBubbleMid
                        && typeof this.props.setLocalOwnerCoordsForBubble === 'function') {
                    this.props.setLocalOwnerCoordsForBubble(
                        uri,
                        _curEntry.privacyDeferredBubbleMid,
                        coords,
                        Number(_curEntry.excludeOriginRadiusMeters) || 0
                    );
                }
                return null;
            }
            return this.sendLocationMetadata(uri, coords, expiresAt, originMetadataId, extras);
        } catch (err) {
            console.log('sendLocationUpdate: failed to read location', err && err.message ? err.message : err);
            return null;
        }
    }

    // Privacy-radius gate consulted by every tick-emission path
    // (initial-fix, iOS watchPosition, Android sendLocationUpdate).
    //
    // Behaviour:
    //   - If the session for `uri` doesn't have a positive
    //     `excludeOriginRadiusMeters`, returns true unconditionally
    //     (no gate).
    //   - On the first call with valid coords, captures them as
    //     `originPoint` and returns false (silently swallows the tick).
    //     This is the "first location" the user told us to exclude.
    //   - On subsequent calls, computes the haversine distance from
    //     the captured origin and returns false while it's below the
    //     configured radius (500 m / 2 km — set by the modal slider).
    //   - Once the user crosses the radius, flips
    //     `originRadiusCleared` (one-time flag) so we log it exactly
    //     once and return true thereafter.
    //
    // Coordinates that aren't usable numbers (e.g. the placeholder tick's
    // null lat/lng) are treated as "not yet" — the gate doesn't capture
    // them as the origin point and continues to suppress ticks.
    _shouldSendUpdateTick(uri, coords) {
        const entry = this.locationTimers[uri];
        // Caller already verified the timer entry exists, but defend
        // against late-arriving callbacks racing tear-down.
        if (!entry) {
            return true;
        }
        // Stationary gate has been REMOVED in favour of a per-minute
        // heartbeat tick. The previous "if you haven't moved 10 m,
        // skip the tick" filter saved bandwidth but had two costs the
        // user pushed back on:
        //   1. The sender's app log went silent — no proof the share
        //      was still alive while the phone sat on a desk.
        //   2. The receiver's bubble timestamp + tick counter froze
        //      at the origin tick and never advanced for the entire
        //      X-hour window.
        // Both are now addressed by always emitting a tick at the
        // throttle cadence (LOCATION_REPEAT_MS = 60 s), regardless of
        // movement. A 4 h share at 60 s cadence is ~240 metadata
        // messages — at ~500 bytes encrypted, that's ~120 KB total,
        // which is well within budget for an active chat. The
        // privacy-radius branch below still applies normally so the
        // "Until we meet" 1 km exclusion still hides the user's
        // starting point.
        // The lastReportedCoords / lastReportedAt fields are still
        // stamped by sendLocationMetadata so future tuning (e.g. a
        // user-toggleable "low bandwidth" mode that re-enables the
        // gate) has the data to work with.
        const radiusMeters = Number(entry.excludeOriginRadiusMeters) || 0;
        if (radiusMeters <= 0) {
            return true;
        }
        const lat = coords && typeof coords.latitude === 'number' ? coords.latitude : null;
        const lng = coords && typeof coords.longitude === 'number' ? coords.longitude : null;
        if (lat == null || lng == null) {
            // Placeholder / no-fix coords. Don't capture as origin and
            // don't emit a tick — wait for a real fix.
            return false;
        }
        if (!entry.originPoint) {
            entry.originPoint = {latitude: lat, longitude: lng};
            const radiusLabel = radiusMeters >= 1000
                ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
                : `${Math.round(radiusMeters)} m`;
            const utils = require('../utils');
            try {
                utils.timestampedLog(
                    `[location] [meet] privacy radius active for ${uri} — your starting point will be hidden until you move ${radiusLabel} away`
                );
            } catch (e) {
                console.log('[location] origin point captured for', uri,
                    'lat=', lat.toFixed(5), 'lng=', lng.toFixed(5),
                    `(privacy radius ${radiusLabel} active)`);
            }
            return false;
        }
        const meters = this._haversineMeters(entry.originPoint, {latitude: lat, longitude: lng});
        if (meters < radiusMeters) {
            // Inside the privacy circle — swallow.
            return false;
        }
        if (!entry.originRadiusCleared) {
            entry.originRadiusCleared = true;
            const utils = require('../utils');
            try {
                utils.timestampedLog(
                    `[location] [meet] privacy radius cleared for ${uri} (${Math.round(meters)} m from origin) — your live location is now being shared`
                );
            } catch (e) {
                console.log('[location] privacy radius cleared for', uri,
                    'distance=', Math.round(meters), 'm');
            }
        }
        return true;
    }

    // Great-circle distance in metres between two {latitude, longitude}
    // points. Returns Infinity if either input is missing a numeric
    // coordinate so the caller treats it as "outside the radius" rather
    // than silently passing the gate. Mean Earth radius (6 371 008 m)
    // is accurate to better than ~0.5 % anywhere on the surface, which
    // is well below our 1 km radius granularity.
    _haversineMeters(a, b) {
        const lat1 = a && typeof a.latitude === 'number' ? a.latitude : null;
        const lon1 = a && typeof a.longitude === 'number' ? a.longitude : null;
        const lat2 = b && typeof b.latitude === 'number' ? b.latitude : null;
        const lon2 = b && typeof b.longitude === 'number' ? b.longitude : null;
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
            return Infinity;
        }
        const R = 6371008;
        const toRad = (deg) => deg * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const sLat1 = Math.sin(dLat / 2);
        const sLon1 = Math.sin(dLon / 2);
        const h = sLat1 * sLat1
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLon1 * sLon1;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    // ===== DEBUG: synthetic-position override =====
    //
    // Returns the coordinates that should ride on this session's next
    // outgoing tick. When ENABLE_MEET_SIMULATION is on AND the entry
    // has a simulatedPosition installed (today: accepter side gets one
    // on share start, set 10 km from real GPS), real GPS is bypassed
    // and the synthetic position is reported instead. The simulator
    // mutates entry.simulatedPosition as it walks toward the
    // destination, so all natural tick paths (initial fix, iOS
    // watchPosition, Android interval) and the simulator's own emits
    // see the same moving point.
    //
    // When the entry doesn't have a simulatedPosition the real GPS
    // fix passed in is returned untouched — production builds with
    // ENABLE_MEET_SIMULATION=false fall straight through this helper.
    _effectiveCoordinatesForSession(uri, realCoords) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (entry && entry.simulatedPosition) {
            return {
                latitude: entry.simulatedPosition.latitude,
                longitude: entry.simulatedPosition.longitude,
                accuracy: typeof entry.simulatedPosition.accuracy === 'number'
                    ? entry.simulatedPosition.accuracy : 5,
                timestamp: Date.now(),
            };
        }
        return realCoords;
    }

    // ===== DEBUG: meet-up convergence simulator =====
    //
    // Public entry. Spins up a per-uri walker that steps toward the
    // shared meeting destination stored on entry.tickExtras.destination
    // (set by the requester when they pick a 4 km random offset from
    // their first real GPS fix, then propagated to the accepter via
    // the metadata.destination field on outgoing ticks and the
    // acceptance opts plumbing in app.js). Both devices walk to the
    // same fixed point so they converge at it deterministically.
    //
    // Each tick advances SIM_STEP_METERS toward the destination every
    // SIM_STEP_INTERVAL_MS and emits through sendLocationMetadata
    // exactly like a real GPS fix would, including running through
    // the privacy-radius gate (_shouldSendUpdateTick). Idempotent: a
    // second call replaces any in-flight sim for the same uri.
    //
    // Bootstraps the start coord from the most recent real GPS fix so
    // the first synthetic tick lands on a plausible position. If GPS
    // is unavailable we fall back to a fixed default (Amsterdam city
    // centre) so the simulator still works in environments without a
    // location service (CI, simulator, etc.).
    //
    // If no destination is known yet (accepter hasn't received one,
    // or requester somehow skipped the auto-pick), we synthesise a
    // 4 km random offset from the start coord and stamp it onto
    // tickExtras.destination so subsequent outgoing ticks broadcast
    // it. That guarantees a usable target without blocking on the
    // peer.

    // Pick a coordinate `kilometers` km away from `start` in a random
    // bearing. Approximate spherical math — good enough for testing
    // (the simulator just needs *some* fixed-but-shareable target).
    // 1° latitude ≈ 111 km; longitude scales with cos(latitude).
    _pickMeetingDestinationKm(start, kilometers) {
        if (!start
                || typeof start.latitude !== 'number'
                || typeof start.longitude !== 'number'
                || !Number.isFinite(kilometers)
                || kilometers <= 0) {
            return null;
        }
        const bearing = Math.random() * 2 * Math.PI;
        const dLat = (kilometers / 111) * Math.cos(bearing);
        const cosLat = Math.cos(start.latitude * Math.PI / 180) || 1;
        const dLng = (kilometers / (111 * cosLat)) * Math.sin(bearing);
        return {
            latitude: start.latitude + dLat,
            longitude: start.longitude + dLng,
        };
    }

    // Reverse-geocode `coord` against OpenStreetMap's Nominatim and
    // decide whether the point is on land. Used by the simulator's
    // destination picker so a random 4 km bearing doesn't drop the
    // meet-up point in the middle of the North Sea (or any other
    // body of water). Free public service — usage is rate-limited at
    // 1 req/s and asks for a descriptive User-Agent. We send a
    // Blink-specific agent and only call this from the debug
    // simulator path (gated on ENABLE_MEET_SIMULATION) so the
    // request load stays comfortably inside the policy.
    //
    // Returns true on land, false on water, throws on network /
    // parse error so the caller can decide to accept the candidate
    // anyway rather than block on a flaky network.
    async _isPointOnLand(coord) {
        if (!coord
                || typeof coord.latitude !== 'number'
                || typeof coord.longitude !== 'number') {
            return true; // Be permissive on malformed input.
        }
        const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2'
            + `&lat=${coord.latitude.toFixed(6)}`
            + `&lon=${coord.longitude.toFixed(6)}`
            + '&zoom=10&addressdetails=1';
        const resp = await fetch(url, {
            headers: {
                // Nominatim's usage policy requires a descriptive
                // User-Agent identifying the application.
                'User-Agent': 'Blink-Mobile/meet-sim (https://sylk.com)',
                'Accept': 'application/json',
            },
        });
        if (!resp.ok) {
            throw new Error('nominatim status ' + resp.status);
        }
        const data = await resp.json();
        // Water-body indicators in the Nominatim payload:
        //   • address.water is set (lake, reservoir, etc.).
        //   • address has no country (open ocean — Nominatim returns
        //     just an empty/minimal address for sea points).
        //   • class === 'natural' AND type ∈ {water, bay, strait,
        //     coastline, beach, reef}.
        //   • class === 'waterway' (rivers, canals, streams).
        // Anything else we treat as land.
        const cls = data && data.class;
        const typ = data && data.type;
        const addr = (data && data.address) || {};
        if (addr.water) return false;
        if (cls === 'waterway') return false;
        if (cls === 'natural'
                && /^(water|bay|strait|coastline|beach|reef|sea|ocean)$/i.test(typ || '')) {
            return false;
        }
        if (!addr.country && !addr.country_code
                && !addr.state && !addr.city
                && !addr.town && !addr.village
                && !addr.hamlet && !addr.county
                && !addr.suburb && !addr.neighbourhood) {
            // No administrative region at all — almost certainly
            // open water.
            return false;
        }
        return true;
    }

    // Async wrapper around _pickMeetingDestinationKm: keeps re-rolling
    // the random bearing until Nominatim agrees the candidate is on
    // land or until `retries` attempts have been spent. Network or
    // parse errors short-circuit and accept the current candidate
    // (don't block the simulator on a flaky link). When all retries
    // come back as water we fall through to a final pick — the
    // simulator must produce *some* destination, even if it's wet,
    // so the test session still progresses.
    async _pickMeetingDestinationKmOnLand(start, kilometers, retries = 5) {
        for (let i = 0; i < retries; i++) {
            const candidate = this._pickMeetingDestinationKm(start, kilometers);
            if (!candidate) return null;
            let onLand;
            try {
                onLand = await this._isPointOnLand(candidate);
            } catch (e) {
                // Network/parse hiccup — accept this candidate so we
                // don't stall the meeting sim. Real product use would
                // either back off and retry, or skip the check.
                console.log('[sim] land-check failed; accepting candidate as-is',
                    e && e.message ? e.message : e);
                return candidate;
            }
            if (onLand) return candidate;
            try {
                const utils = require('../utils');
                utils.timestampedLog(
                    `[sim] candidate at ${candidate.latitude.toFixed(5)},${candidate.longitude.toFixed(5)} is in water — re-rolling (attempt ${i + 1}/${retries})`
                );
            } catch (e) { /* noop */ }
            // Light spacing to be polite to Nominatim's 1 req/s policy.
            await new Promise((r) => setTimeout(r, 1100));
        }
        // Exhausted — return whatever the next plain pick gives us.
        return this._pickMeetingDestinationKm(start, kilometers);
    }

    simulateConvergence(uri, opts = {}) {
        if (!ENABLE_MEET_SIMULATION) return;
        if (!uri) return;
        const entry = this.locationTimers[uri];
        if (!entry) {
            console.log('[sim] simulateConvergence: no active share for', uri);
            return;
        }
        const stepMeters = (opts && opts.stepMeters) || SIM_STEP_METERS;
        const intervalMs = (opts && opts.intervalMs) || SIM_STEP_INTERVAL_MS;

        if (!this._simStates) this._simStates = {};

        const startTimer = () => {
            // Stop any previous sim for this uri.
            const prev = this._simStates[uri];
            if (prev && prev.timerId) {
                clearInterval(prev.timerId);
            }
            // Compute the per-step distance so this side reaches the
            // destination in exactly SIM_TICKS_TO_CONVERGE ticks
            // (default 5). Each side computes independently from its
            // own starting point, so the requester (~4 km away) and
            // the accepter (~10 km away from the synthetic seed) both
            // arrive at the same time even though their distances
            // differ. If the destination isn't known yet we fall back
            // to SIM_STEP_METERS — the in-tick synthesised target
            // path will recompute when a real one shows up.
            let perStepMeters = stepMeters;
            const destNow0 = entry.tickExtras && entry.tickExtras.destination;
            const startCoord0 = entry.simulatedPosition;
            if (destNow0 && startCoord0) {
                const initDist = this._haversineMeters(startCoord0, destNow0);
                if (Number.isFinite(initDist) && initDist > 0) {
                    perStepMeters = Math.max(initDist / SIM_TICKS_TO_CONVERGE, 1);
                }
            }
            this._simStates[uri] = {
                stepMeters: perStepMeters,
                intervalMs,
                timerId: setInterval(() => {
                    this._tickSimulation(uri);
                }, intervalMs),
            };
            try {
                const utils = require('../utils');
                const startCoord = entry.simulatedPosition;
                if (startCoord) {
                    const startLat = startCoord.latitude.toFixed(5);
                    const startLng = startCoord.longitude.toFixed(5);
                    const startUrl = `https://maps.google.com/?q=${startLat},${startLng}`;
                    utils.timestampedLog(
                        `[sim] START checkpoint for ${uri} → ${startLat},${startLng} (${startUrl})`
                        + ` step=${perStepMeters.toFixed(0)} m every ${intervalMs / 1000}s`
                        + ` (target ${SIM_TICKS_TO_CONVERGE} ticks ≈ ${(SIM_TICKS_TO_CONVERGE * intervalMs / 1000).toFixed(0)}s)`
                    );
                    const destNow = entry.tickExtras && entry.tickExtras.destination;
                    if (destNow) {
                        const dLat = destNow.latitude.toFixed(5);
                        const dLng = destNow.longitude.toFixed(5);
                        const distKm = (this._haversineMeters(startCoord, destNow) / 1000).toFixed(2);
                        const dUrl = `https://maps.google.com/?q=${dLat},${dLng}`;
                        utils.timestampedLog(
                            `[sim] DESTINATION for ${uri} → ${dLat},${dLng} (${dUrl}) distance from start=${distKm} km`
                        );
                    } else {
                        utils.timestampedLog(
                            `[sim] DESTINATION for ${uri} → not yet known; tick fallback will synthesise one on first step`
                        );
                    }
                }
            } catch (e) { /* noop */ }
            // Fire one tick right away so the user sees motion without
            // waiting a full interval for the first synthetic position.
            this._tickSimulation(uri);
        };

        // entry.simulatedPosition is the canonical synthetic position
        // for this session. The accepter side already has one armed
        // at share start (real GPS + 10 km random offset, set inside
        // startLocationSharing's first-fix callback), so we just kick
        // off the timer and walk it. The requester side hasn't been
        // seeded yet — fetch real GPS once, install it, then start.
        if (entry.simulatedPosition) {
            startTimer();
            return;
        }

        const seed = (coord) => {
            const e = this.locationTimers[uri];
            if (!e) return;
            e.simulatedPosition = {
                latitude: coord.latitude,
                longitude: coord.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
            startTimer();
        };

        if (Geolocation && typeof Geolocation.getCurrentPosition === 'function') {
            Geolocation.getCurrentPosition(
                (pos) => {
                    const c = pos && pos.coords ? pos.coords : {};
                    if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
                        seed({latitude: c.latitude, longitude: c.longitude});
                    } else {
                        seed({latitude: 52.379189, longitude: 4.899431});
                    }
                },
                () => seed({latitude: 52.379189, longitude: 4.899431}),
                {timeout: 3000, maximumAge: 60000, enableHighAccuracy: false}
            );
        } else {
            seed({latitude: 52.379189, longitude: 4.899431});
        }
    }

    // Internal — fired every SIM_STEP_INTERVAL_MS while a sim is
    // active. Walks entry.simulatedPosition (the single source of
    // truth for the synthetic walker) one step toward the shared
    // destination, snaps when within a step of the target, then emits
    // a tick through the regular sendLocationMetadata pipeline.
    _tickSimulation(uri) {
        const sim = this._simStates && this._simStates[uri];
        if (!sim) return;
        const entry = this.locationTimers[uri];
        // Share was torn down (user stopped, expiration, peer cancelled).
        // Auto-stop the simulator so a stale interval doesn't keep
        // firing and burning a sendMessage every couple of seconds.
        if (!entry || !entry.simulatedPosition) {
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }

        // Resolve target from the shared destination on tickExtras.
        // Both sides walk to the same point so they converge there.
        let target = entry.tickExtras && entry.tickExtras.destination;
        if (!target
                || typeof target.latitude !== 'number'
                || typeof target.longitude !== 'number') {
            // No destination known on this side yet — synthesise a
            // 4 km random offset from our current position and stamp
            // it onto tickExtras so subsequent outgoing ticks
            // broadcast it.
            target = this._pickMeetingDestinationKm(entry.simulatedPosition, 4);
            if (!target) return;
            if (entry.tickExtras) {
                entry.tickExtras.destination = target;
            }
            try {
                const utils = require('../utils');
                utils.timestampedLog(
                    `[sim] no shared destination yet — synthesised ${target.latitude.toFixed(5)},${target.longitude.toFixed(5)} (~4 km from current position)`
                );
            } catch (e) { /* noop */ }
        }

        const dist = this._haversineMeters(entry.simulatedPosition, target);
        // Did this step land on (or past) the target? If so, snap to
        // exact destination coords and remember to tear the timer
        // down after this final tick goes out — there's nothing more
        // to simulate, and emitting the same coords every interval
        // is just chat noise (and wasted battery on the watching
        // device). The very last tick still ships so the receiver
        // sees the snap and the arrival-push gate has its trigger
        // moment.
        const arrivedThisStep = !Number.isFinite(dist) || dist <= sim.stepMeters;
        if (arrivedThisStep) {
            entry.simulatedPosition = {
                latitude: target.latitude,
                longitude: target.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
        } else {
            const ratio = sim.stepMeters / dist;
            entry.simulatedPosition = {
                latitude: entry.simulatedPosition.latitude
                    + (target.latitude - entry.simulatedPosition.latitude) * ratio,
                longitude: entry.simulatedPosition.longitude
                    + (target.longitude - entry.simulatedPosition.longitude) * ratio,
                accuracy: 5,
                timestamp: Date.now(),
            };
        }

        // Emit through the same gate the real-GPS path uses so the
        // privacy-radius logic still applies during simulated walks.
        if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
            const tickExtras = {
                meetingRequest: false,
                inReplyTo: entry.inReplyTo,
                destination: entry.tickExtras && entry.tickExtras.destination,
            };
            this.sendLocationMetadata(
                uri,
                {...entry.simulatedPosition},
                new Date(entry.expiresAt).toISOString(),
                entry.originMetadataId,
                tickExtras
            );
        }

        if (arrivedThisStep) {
            // Walker reached the destination — kill the timer so the
            // simulator stops emitting redundant "still at dest" ticks.
            // sendLocationMetadata above already fired the arrival
            // push via _maybeFireDestinationArrival; the proximity-
            // met logic on app.js's side will end the session
            // shortly once the peer's arrival lands too.
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            try {
                const utils = require('../utils');
                utils.timestampedLog(
                    `[sim] convergence reached destination — stopping walker for ${uri}`
                );
            } catch (e) { /* noop */ }
        }
    }

    stopSimulation(uri) {
        if (!this._simStates || !this._simStates[uri]) return;
        if (this._simStates[uri].timerId) {
            clearInterval(this._simStates[uri].timerId);
        }
        delete this._simStates[uri];
        try {
            const utils = require('../utils');
            utils.timestampedLog(`[sim] convergence stopped for ${uri}`);
        } catch (e) { /* noop */ }
    }

    isSimulating(uri) {
        return !!(this._simStates && this._simStates[uri]);
    }

    // Public: stamp a shared meeting destination onto an active
    // share's tickExtras so subsequent outgoing ticks carry it AND
    // the simulator (if/when started) walks toward it. Called by
    // app.js when an incoming meeting tick carries
    // metadata.destination (typically the requester's broadcast
    // landing on the accepter side, but symmetric — either side can
    // publish). Keeps the first destination it sees; later updates
    // are ignored to avoid mid-session flips.
    setMeetingDestination(uri, destination) {
        if (!uri || !destination
                || typeof destination.latitude !== 'number'
                || typeof destination.longitude !== 'number') {
            return;
        }
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry || !entry.tickExtras) return;
        if (entry.tickExtras.destination) return;
        entry.tickExtras.destination = {
            latitude: destination.latitude,
            longitude: destination.longitude,
        };
        try {
            const utils = require('../utils');
            utils.timestampedLog(
                `[sim] received shared meeting destination at ${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)} for ${uri}`
            );
        } catch (e) { /* noop */ }
    }

    // opts.silent — suppress the in-chat system note (used by
    //   componentWillUnmount and by the self-call inside startLocationSharing
    //   that replaces an existing share before posting its own "started" note).
    // opts.reason — 'user' | 'expired' | 'deleted' | 'replaced' | 'unmount'.
    //   Shapes the system-note body. Defaults to 'user'.
    // Pause an active location share. Lightweight (no clearWatch /
    // clearInterval) — we just flip a flag the tick-emission paths
    // consult before sending. The session timer entry stays alive so
    // the user can Resume without re-announcing or restarting from
    // scratch. Pause does NOT extend the share's expiry: real-world
    // time keeps ticking, and if the user resumes after expiresAt the
    // share will tear itself down on the next expiry check.
    //
    // No-op when:
    //   • there's no entry for this uri (already stopped); the
    //     contextual menu's Resume option will instead route to a
    //     fresh startLocationSharing on the bubble's metadata.
    //   • originMetadataId was supplied AND doesn't match the entry's
    //     origin: the user long-pressed an OLD bubble whose share has
    //     already been replaced by a newer one.
    pauseLocationSharing(uri, originMetadataId) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry) return false;
        if (originMetadataId && entry.originMetadataId !== originMetadataId) return false;
        if (entry.paused) return true;
        entry.paused = true;
        try { this._persistActiveShares(); } catch (e) { /* noop */ }
        // Stop the NavBar icon's breathing animation when no shares
        // are actively ticking. Pause means no metadata is leaving the
        // device, and the pulse is meant to communicate "the device is
        // sending updates" — keeping it on while nothing's flowing
        // would be misleading. Only stop if every share is paused
        // (multi-share users may have paused one but the other is
        // still ticking) AND there's no active call (the pulse also
        // signals the in-call icon).
        try {
            const _anyUnpaused = Object.values(this.locationTimers || {})
                .some(e => e && !e.paused);
            if (!_anyUnpaused && !this.props.callActive) {
                this._stopActiveSharePulse();
            }
        } catch (e) { /* noop */ }
        // Force a re-render so any UI gated on pause state (the
        // chat-header Pause/Resume Menu.Item we added earlier) flips
        // to its new label/icon.
        this.forceUpdate();
        utils.timestampedLog('[location] paused share for', uri,
            'origin=', entry.originMetadataId);
        return true;
    }

    // Unpause a previously paused share. If no entry exists (the share
    // was fully stopped — e.g. user deleted a bubble by mistake and
    // wants to keep going), the caller should fall back to a fresh
    // startLocationSharing with resumeOriginMetadataId set so the
    // existing bubble keeps updating instead of a new one being
    // spawned. Returns false in that case so app.js's bridge knows to
    // take the start path.
    resumeLocationSharing(uri, originMetadataId) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry) return false;
        if (originMetadataId && entry.originMetadataId !== originMetadataId) return false;
        if (!entry.paused) return true;
        if (Date.now() >= entry.expiresAt) {
            // Expired while paused — clean up and tell the caller
            // there's nothing to resume.
            this.stopLocationSharing(uri, {reason: 'expired'});
            return false;
        }
        entry.paused = false;
        // Force an immediate fix so the receiver sees the position
        // jump from "frozen during pause" to "back to live" without
        // waiting for the LOCATION_REPEAT_MS window to roll around.
        try {
            this.sendLocationUpdate(
                uri,
                new Date(entry.expiresAt).toISOString(),
                entry.originMetadataId,
                entry.tickExtras || {}
            );
        } catch (e) { /* noop — next periodic tick will catch up */ }
        try { this._persistActiveShares(); } catch (e) { /* noop */ }
        // Re-arm the NavBar pulse — ticks are flowing again so the
        // breathing animation should communicate that. Symmetric to
        // the stop in pauseLocationSharing.
        try { this._startActiveSharePulse(); } catch (e) { /* noop */ }
        // Force a re-render so the chat-header Menu.Item flips back
        // from "Resume sharing" to "Pause sharing".
        this.forceUpdate();
        utils.timestampedLog('[location] resumed share for', uri,
            'origin=', entry.originMetadataId);
        return true;
    }

    // Read the live state of a share for menu / UI purposes:
    //   'active'   — entry exists, not paused
    //   'paused'   — entry exists, paused
    //   'stopped'  — no entry (share was torn down)
    getLocationShareState(uri, originMetadataId) {
        const entry = this.locationTimers && this.locationTimers[uri];
        if (!entry) {
            // Diagnostic: a kebab/render path expected an active
            // share but didn't find one. Throttle so a tight render
            // loop doesn't flood the log — once per uri+origin per
            // 5 seconds is plenty for repro.
            if (this._shouldLogShareStateProbe(uri, originMetadataId, 'stopped-no-entry')) {
                console.log('[location] getLocationShareState',
                    'uri=', uri,
                    'asked-origin=', originMetadataId,
                    '→ stopped (no entry)',
                    'allTimerKeys=', this.locationTimers ? Object.keys(this.locationTimers) : '(none)');
            }
            return 'stopped';
        }
        if (originMetadataId && entry.originMetadataId !== originMetadataId) {
            if (this._shouldLogShareStateProbe(uri, originMetadataId, 'origin-mismatch')) {
                console.log('[location] getLocationShareState',
                    'uri=', uri,
                    'asked-origin=', originMetadataId,
                    'entry-origin=', entry.originMetadataId,
                    '→ stopped (origin mismatch)');
            }
            return 'stopped';
        }
        // active / paused are the common steady-state results — no log.
        // Each meet bubble's render fires this probe, and the chat
        // re-renders many times per second under normal app activity
        // (typing, scrolling, peer ticks landing). The previous
        // unconditional log produced ~50 lines/sec just from one
        // active share, drowning out useful diagnostics.
        return entry.paused ? 'paused' : 'active';
    }

    // Throttle for the diagnostic getLocationShareState log. Same
    // (uri, originMetadataId, reason) won't log more than once per
    // 5 s. Cheap in-memory map keyed by composite — bounded by the
    // number of unique meet bubbles in the chat × the number of
    // distinct failure reasons (currently 2). No cleanup needed for
    // the lifetime of the component.
    _shouldLogShareStateProbe(uri, originMetadataId, reason) {
        if (!this._shareStateLogStamps) this._shareStateLogStamps = {};
        const key = `${uri}|${originMetadataId || ''}|${reason}`;
        const now = Date.now();
        const last = this._shareStateLogStamps[key] || 0;
        if (now - last < 5000) return false;
        this._shareStateLogStamps[key] = now;
        return true;
    }

    // Public entry point used by app.js logout(). Stops every in-flight
    // share for THIS account and drops any deferred-permission intents.
    // Called BEFORE the SIP connection is torn down so the meeting_end
    // signals can still reach peers — a peer with a reciprocal "Until
    // we meet" share will tear down its own side as a result.
    //
    // We pass `silent: true` so the chat doesn't gain a flurry of
    // "Stopped sharing at HH:MM" system notes the user wouldn't see
    // anyway (they're on the login screen). Reason 'logout' is NOT in
    // peerRelayReasons inside stopLocationSharing, so the peer signal
    // DOES go out — peer notification is the whole point.
    stopAllSharesForLogout() {
        const uris = Object.keys(this.locationTimers || {});
        for (const uri of uris) {
            try {
                this.stopLocationSharing(uri, {silent: true, reason: 'logout'});
            } catch (e) { /* best effort */ }
        }
        // Drop any parked permission-retry intents. _onAppStateChange's
        // drain would otherwise try to start them again the next time
        // the app foregrounds — under whatever account is signed in
        // at that point, which is exactly the cross-account leak we're
        // trying to prevent here.
        this._pendingPermissionShares = {};
        // Defensive: ensure the pulse animation isn't left running
        // against an empty share map. _stopActiveSharePulse is a no-op
        // when no animation is armed.
        try { this._stopActiveSharePulse(); } catch (e) { /* noop */ }
    }

    stopLocationSharing(uri, opts = {}) {
        const {silent = false, reason = 'user'} = opts;

        // Reentry guard. Our own deleteMessage call near the end of
        // this function re-enters stopLocationSharing (via app.js's
        // deleteMessage → navBar.stopLocationSharing({reason:'deleted'})
        // path, because the meeting_request we're deleting is itself a
        // live-location bubble). Without this guard the recursive call
        // would emit a second, duplicate system note — the outer call
        // has already scheduled the state cleanup and the "stopped
        // sharing" note, and re-entering here would see activeShares
        // still populated (setState is async) and fire another one.
        if (!this._pendingStops) this._pendingStops = new Set();
        if (this._pendingStops.has(uri)) return;
        this._pendingStops.add(uri);

        // If a permission-deferred share intent is parked for this
        // peer, drop it. stopLocationSharing means the user wants
        // sharing to stop — we shouldn't auto-resume a parked intent
        // on next foreground after that.
        if (this._pendingPermissionShares
                && this._pendingPermissionShares[uri]) {
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog(
                '[location] permission-retry dropped — stopLocationSharing called for', uri,
                'reason=', reason
            );
        }

        const wasActive = !!this.locationTimers[uri]
            || this.state.activeLocationShares[uri] !== undefined;

        const entry = this.locationTimers[uri];

        // If this share is one half of an "Until we meet" handshake AND the
        // stop was initiated locally (user tap, local delete, permission
        // revoked), tell the peer so they can tear down their reciprocal
        // share. We skip reasons that are already in response to a peer
        // event ('peer-stopped', 'requester-deleted'), a scheduled tear-
        // down that the peer's own timer will also hit ('expired'), an
        // internal silent restart ('replaced'), or app shutdown ('unmount',
        // where the websocket is on its way down anyway).
        const peerRelayReasons = new Set([
            'expired',
            'replaced',
            'peer-stopped',
            'requester-deleted',
            'unmount',
        ]);
        if (entry
            && entry.meetingSessionId
            && !peerRelayReasons.has(reason)) {
            this.sendMeetingEndSignal(uri, entry.meetingSessionId);
        }

        if (entry) {
            // Android path: a repeating BackgroundTimer interval.
            if (entry.intervalId != null) {
                BackgroundTimer.clearInterval(entry.intervalId);
            }
            // iOS path: CLLocationManager watcher + expiry fallback timer.
            // Releasing the watcher lets iOS let the app sleep again —
            // leaving it armed would keep us running in background
            // indefinitely.
            if (entry.watchId != null
                && Geolocation
                && typeof Geolocation.clearWatch === 'function') {
                try { Geolocation.clearWatch(entry.watchId); }
                catch (e) { /* noop */ }
            }
            if (entry.expiryTimeoutId != null) {
                try { BackgroundTimer.clearTimeout(entry.expiryTimeoutId); }
                catch (e) { /* noop */ }
            }
        }
        delete this.locationTimers[uri];
        // Only rewrite the persisted snapshot when the share is
        // ending for a USER / SESSION reason — not when the React
        // component is being torn down by process death. On
        // Android, swipe-up-to-kill DOES fire componentWillUnmount
        // (it loops over every active share calling
        // stopLocationSharing({reason:'unmount'}) ); persisting
        // here would wipe the snapshot to an empty map and the
        // resume-on-restart path would find nothing to bring back.
        // The "unmount" branch keeps locationTimers clean for the
        // brief window before the JS engine itself shuts down, but
        // leaves AsyncStorage intact so _loadAndResumeActiveShares
        // sees the still-live entries when the user reopens the app.
        if (reason !== 'unmount') {
            this._persistActiveShares();
            // Force the underlying app_state SQL UPDATE through
            // immediately, bypassing the 250 ms debounce. Without
            // this, a user who stops a share and immediately kills
            // the app would relaunch with the just-cleared entry
            // still on disk — and _loadAndResumeActiveShares would
            // bring the share back to life.  _persistActiveShares
            // is async (read-modify-write) so we let the flush land
            // on the next microtask. Best-effort, no await needed
            // by the caller.
            try {
                if (typeof this.props.forceFlushAppState === 'function'
                        && this.props.accountId) {
                    Promise.resolve()
                        .then(() => this.props.forceFlushAppState(this.props.accountId))
                        .catch(() => { /* persistence is best-effort */ });
                }
            } catch (e) { /* noop */ }
        }

        // Android: release the foreground-service promotion, but ONLY when
        // there are no other active shares (a user may be sharing with
        // several contacts at once; stopping one shouldn't kill all of
        // them). We key off `locationTimers` after the delete above —
        // if it's empty, no other share is running.
        if (Platform.OS === 'android'
            && LocationForegroundServiceModule
            && typeof LocationForegroundServiceModule.stopService === 'function'
            && Object.keys(this.locationTimers).length === 0) {
            try {
                LocationForegroundServiceModule.stopService();
            } catch (e) {
                console.log('[location] LocationForegroundService.stopService failed',
                    e && e.message ? e.message : e);
            }
        }

        // Mirror the change in React state so the menu item re-renders as
        // "Share location..." again. Guard the setState so we don't
        // schedule work after unmount (componentWillUnmount also calls us).
        if (this._unmounted) return;
        if (this.state.activeLocationShares[uri] !== undefined) {
            const next = {...this.state.activeLocationShares};
            delete next[uri];
            this.setState({activeLocationShares: next});
        }

        // Drop a system note into the chat timeline so the user has a
        // visible record that sharing ended. Persisted via saveSystemMessage
        // (SQL INSERT with system=1) so it survives a reload. Skipped when
        // we weren't actually sharing (idempotent callers) or when the
        // caller explicitly asked for silence.
        if (!silent && wasActive && typeof this.props.saveSystemMessage === 'function') {
            // Wall-clock time the stop happened, e.g. "14:23" or "2:23 PM".
            // Chosen over toLocaleTimeString()'s default so we don't surface
            // seconds for a timeline marker — HH:MM is enough to anchor the
            // event and keeps the note short.
            const stoppedAt = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            // Was this share part of an "Until we meet" meeting session?
            // The wording switches on that: meeting sessions get their own
            // started / stopped / cancelled / completed vocabulary, plain
            // timed shares keep the more literal "sharing" wording.
            const wasMeeting = !!(entry && entry.meetingSessionId);
            // Has the peer accepted yet? Drives the vocabulary of the
            // system note: before acceptance the session is still a
            // "Meeting request" (the peer hasn't responded); once either
            // side has accepted, it's just a "Meeting" — the "request"
            // qualifier no longer fits because both sides are actively
            // sharing. The 'requester-deleted' and 'peer-stopped' paths
            // can only fire when the peer was actively sharing (they
            // imply the handshake completed), so we treat those as
            // post-acceptance unconditionally.
            const sessionId = entry && entry.meetingSessionId;
            const meetingAccepted = !!(
                typeof this.props.isMeetingSessionAccepted === 'function'
                && this.props.isMeetingSessionAccepted(sessionId)
            );
            const postAcceptance = meetingAccepted
                || reason === 'requester-deleted'
                || reason === 'peer-stopped';
            let note;
            if (wasMeeting) {
                switch (reason) {
                    case 'expired':
                        // Timer ran its course without a proximity-met
                        // event firing. If proximity HAD fired, the
                        // session was torn down via _wipeMeetingSession
                        // → stopLocationSharing({silent:true, reason:'expired'}),
                        // which skips this note entirely. So reaching
                        // this branch non-silently means: the two parties
                        // never actually met within the window.
                        note = 'Meeting expired';
                        break;
                    case 'deleted':
                        // We (the local user) cancelled the session.
                        note = postAcceptance
                            ? 'Meeting cancelled'
                            : 'Meeting request cancelled';
                        break;
                    case 'requester-deleted':
                        // The remote party deleted a leg of the session.
                        // Always post-acceptance — only the accepter's
                        // stopLocationSharing gets this reason, and the
                        // accepter by definition has accepted.
                        note = 'Meeting cancelled by remote party';
                        break;
                    case 'peer-stopped':
                        // Peer tapped Stop — orderly end, after both
                        // parties were actively sharing. Always
                        // post-acceptance.
                        note = 'Meeting stopped by remote party';
                        break;
                    default:
                        // Local user tapped Stop (no explicit reason
                        // supplied — the pin modal's stopShare calls us
                        // with no opts). An orderly, locally-initiated
                        // end. Post-acceptance → "Meeting stopped";
                        // before acceptance we would have hit 'deleted'
                        // via the origin-bubble delete path, not this
                        // default, so the wording here is safe.
                        note = 'Meeting stopped';
                        break;
                }
            } else {
                switch (reason) {
                    case 'expired':
                        note = `\uD83D\uDCCD Live location sharing expired at ${stoppedAt}`;
                        break;
                    case 'returned':
                        // "Until I return" auto-stop \u2014 the user came
                        // back inside the return ring. Distinct copy
                        // so the caregiver who's looking at the chat
                        // can tell the share ended because the user
                        // got home, not because they hit Stop or it
                        // timed out.
                        note = `\uD83D\uDCCD Live location sharing stopped at ${stoppedAt} (returned to starting point)`;
                        break;
                    case 'deleted':
                        note = `\uD83D\uDCCD Stopped sharing live location at ${stoppedAt} (message deleted)`;
                        break;
                    case 'requester-deleted':
                        note = `\uD83D\uDCCD Stopped sharing live location at ${stoppedAt} (the request was deleted by the other party)`;
                        break;
                    case 'peer-stopped':
                        note = `\uD83D\uDCCD The other party stopped location sharing at ${stoppedAt}`;
                        break;
                    default:
                        note = `\uD83D\uDCCD You stopped sharing live location at ${stoppedAt}`;
                }
            }
            this.props.saveSystemMessage(uri, note, 'outgoing');
        }

        // Wipe the meeting-session messages from both sides so the only
        // thing left in the transcript after a cancel is the local system
        // notes we just emitted. Two distinct _ids are in play:
        //   • meetingSessionId — the requester's origin tick (the
        //     "meeting_request" bubble). The requester owns it; the
        //     accepter has a received copy of the same _id.
        //   • originMetadataId — the local device's OWN origin tick. On
        //     the requester side this equals meetingSessionId. On the
        //     accepter side it's a separate message (their reply bubble
        //     with in_reply_to pointing at the request).
        //
        // Goal: both legs removed on BOTH devices regardless of who
        // initiated the cancel. For every leg in the session we call
        // deleteMessage(legId, uri, remote=true) — the remote=true flag
        // journals a removeMessage event to the peer, so their copy of
        // that leg is wiped too. Skip the specific id that was already
        // deleted by the caller (passed through as opts.deletedId) so we
        // don't fire a redundant delete on it.
        //
        // The _pendingStops guard at the top of this function short-
        // circuits the recursive re-entry that app.js.deleteMessage
        // triggers via its live-location detection (it calls
        // stopLocationSharing on any sylk-live-location bubble delete),
        // so calling deleteMessage from inside this block is safe.
        const cleanupReasons = new Set([
            'user',             // default when the user taps Stop
            'deleted',          // user long-pressed the bubble to delete
            'peer-stopped',     // meeting_end signal from peer
            'requester-deleted', // peer remote-deleted a leg
        ]);
        if (entry
            && entry.meetingSessionId
            && cleanupReasons.has(reason)
            && typeof this.props.deleteMessage === 'function') {
            const deletedId = opts.deletedId || null;

            const propagateDelete = (legId) => {
                if (!legId) return;
                // The leg that triggered this stop is already being
                // deleted by whoever called us (app.js.deleteMessage for
                // reason='deleted'; app.js.removeMessage for reason=
                // 'requester-deleted'). Re-deleting the same id would
                // journal a duplicate removeMessage event to the peer.
                if (legId === deletedId) return;
                try {
                    this.props.deleteMessage(legId, uri, true);
                } catch (e) {
                    console.log('[location] propagateDelete failed', legId,
                        e && e.message ? e.message : e);
                }
            };

            propagateDelete(entry.meetingSessionId);
            // Only fire for originMetadataId when it's a DISTINCT id
            // from meetingSessionId — on the requester side they're the
            // same bubble and we already handled it above.
            if (entry.originMetadataId
                && entry.originMetadataId !== entry.meetingSessionId) {
                propagateDelete(entry.originMetadataId);
            }
        }

        this._pendingStops.delete(uri);
    }

    // Find every active share whose tick stream was started as a reply
    // to `deletedRequestId` (i.e. stored with `inReplyTo === deletedRequestId`
    // in the timer entry) and stop them. Used when an incoming
    // removeMessage event fires for the request we were replying to —
    // the requester has deleted their original message, so there's
    // nothing to reply to anymore. reason='requester-deleted' so
    // stopLocationSharing emits a distinct system note in the chat
    // timeline. Returns the list of URIs that were stopped.
    stopSharesRepliesTo(deletedRequestId) {
        if (!deletedRequestId) return [];
        const stopped = [];
        // Copy the keys up front — stopLocationSharing mutates
        // this.locationTimers and we don't want to skip entries mid-iter.
        Object.keys(this.locationTimers).forEach((uri) => {
            const entry = this.locationTimers[uri];
            if (entry && entry.inReplyTo === deletedRequestId) {
                utils.timestampedLog('[location] stopSharesRepliesTo: stopping share with', uri,
                    'because its original request', deletedRequestId, 'was deleted by the peer');
                stopped.push(uri);
                // Pass deletedId so the cleanup block skips propagating
                // a redundant delete for the request that was already
                // removed by the peer's remote_delete. The OTHER leg
                // (originMetadataId — our own reply) still gets wiped
                // with remote=true so the peer's copy is gone too.
                this.stopLocationSharing(uri, {
                    reason: 'requester-deleted',
                    deletedId: deletedRequestId,
                });
            }
        });
        return stopped;
    }

    // Emit a small metadata message telling the peer to end their side of
    // a "Until we meet" session. Triggered from stopLocationSharing when
    // the user cancels a meeting share (either side). Carries the shared
    // meeting_session_id — the requester's origin tick _id — which both
    // clients stamped on their locationTimers entry when the share began.
    //
    // Fire-and-forget: if the send fails (no connection, etc.) the peer
    // share will simply run to its natural expiry. We don't block the
    // local teardown waiting for confirmation.
    sendMeetingEndSignal(uri, sessionId, opts = {}) {
        if (!uri || !sessionId) return;
        if (!this.props.sendMessage) {
            utils.timestampedLog('[location] sendMeetingEndSignal: sendMessage prop not wired');
            return;
        }
        const mId = uuid.v4();
        const timestamp = new Date();
        const body = {
            action: 'meeting_end',
            // messageId is the bubble the signal refers to. Existing
            // receivers (updateMetadataFromRemote) key off this — pointing
            // it at the session id keeps lookups consistent with how
            // location ticks have always worked.
            messageId: sessionId,
            meeting_session_id: sessionId,
            timestamp,
            uri,
        };
        // Optional reason (e.g. 'proximity') so the peer can emit a matching
        // system note on their side. Left off entirely for legacy /
        // user-initiated stops — absence is equivalent to 'peer-stopped'.
        if (opts.reason) {
            body.reason = opts.reason;
        }
        const msg = {
            _id: mId,
            key: mId,
            createdAt: timestamp,
            metadata: body,
            text: JSON.stringify(body),
            // GiftedChat/outgoing plumbing requires a `user` field.
            user: {},
        };
        try {
            this.props.sendMessage(uri, msg, 'application/sylk-message-metadata');
            utils.timestampedLog('[location] sent meeting_end signal to', uri,
                'session=', sessionId);
        } catch (e) {
            utils.timestampedLog('[location] sendMeetingEndSignal failed',
                e && e.message ? e.message : e);
        }
    }

    // Peer told us they ended a meeting session. Walk our timers and stop
    // any share whose meetingSessionId matches — reason='peer-stopped' so
    // the chat system-note copy makes it clear who ended it. Returns the
    // list of URIs that were stopped (mainly for logging / tests).
    stopSharesForMeetingSession(sessionId, opts = {}) {
        if (!sessionId) return [];
        const stopped = [];
        // Remote reason propagated from the peer's meeting_end signal
        // (currently: 'proximity'). For 'proximity' we tear down SILENTLY
        // — the caller in app.js (handleMessageMetadata meeting_end path)
        // is responsible for emitting the "Location sharing stopped at
        // HH:MM" note, dedeuped against the local-proximity emission via
        // _proximityNotedSessionIds. Emitting here too would double the
        // note on the receiving side whenever both devices fire proximity
        // around the same time.
        const remoteReason = opts.reason;
        const isProximity = remoteReason === 'proximity';
        Object.keys(this.locationTimers).forEach((uri) => {
            const entry = this.locationTimers[uri];
            if (entry && entry.meetingSessionId === sessionId) {
                utils.timestampedLog('[location] stopSharesForMeetingSession: stopping share with', uri,
                    'because peer ended meeting session', sessionId,
                    'remoteReason=', remoteReason || '(none)');
                stopped.push(uri);
                if (isProximity) {
                    // Silent — system note is the app.js side's concern.
                    this.stopLocationSharing(uri, {silent: true, reason: 'peer-stopped'});
                } else {
                    this.stopLocationSharing(uri, {reason: 'peer-stopped'});
                }
            }
        });
        return stopped;
    }

    // Kick off a location-sharing session for `uri` lasting `durationMs`
    // milliseconds. Sends the first metadata message immediately, then one
    // more every 60 seconds until the expiration timestamp is reached.
    //
    // opts.kind       — 'fixed' (plain timed share) or 'meetingRequest' ("Until
    //                   we meet" — origin tick carries meeting_request:true).
    // opts.inReplyTo  — when accepting a peer's meeting request, the original
    //                   request message _id. Every tick carries it so the
    //                   peer's client can merge coords into their request
    //                   bubble instead of rendering a new one.
    // opts.expiresAt  — explicit expiration timestamp (ms). When present,
    //                   overrides `now + durationMs`. Used by the acceptance
    //                   flow so accepter and requester share the same
    //                   expires_at, guaranteeing synchronized cleanup.
    async startLocationSharing(uri, durationMs, periodLabel, opts = {}) {
        if (!uri) {
            return;
        }
        // Synchronous re-entry guard. Two failure modes to block:
        //
        //   (a) An active share already exists for this peer. The chat
        //       should never host two concurrent sharing sessions — a
        //       second tap must be a no-op, not a silent replacement and
        //       not a second parallel session.
        //
        //   (b) A previous call to this function is still awaiting its
        //       permission-prompt / alert chain. The permission checks
        //       below are all async; a rapid double-tap on the "Meet up"
        //       button previously let both calls clear the await barrier
        //       before either wrote to locationTimers, producing two
        //       origin ticks to the same peer (and two modals on the
        //       accepter side). The in-flight Set catches that race
        //       window synchronously at the top of the function.
        //
        // Both tests run before the first await so JS's single-threaded
        // event loop guarantees the second caller sees the first caller's
        // guard.
        if (!this._startingShares) {
            this._startingShares = new Set();
        }
        if (this._startingShares.has(uri) || this.locationTimers[uri]) {
            utils.timestampedLog('[location] startLocationSharing: ignoring duplicate — share already active or in-flight for', uri);
            return;
        }
        this._startingShares.add(uri);
      try {
        // Prominent Disclosure (Google Play). Must come BEFORE any
        // permission probe / OS dialog. The user can decline here
        // without anything happening — no permission asked, no
        // location read. After acknowledgement (now or previously)
        // we fall through to the existing permission flow.
        // Resume path skips the disclosure: by definition, this is a
        // share the user already started + acknowledged in a previous
        // session, and the OS-level permission is presumed to still
        // be granted. Re-prompting on every restart would just be
        // noise.
        if (!opts.resumeOriginMetadataId) {
            const acknowledged = await this._ensureLocationDisclosureAcknowledged();
            if (!acknowledged) {
                utils.timestampedLog('[location] startLocationSharing: disclosure declined for', uri);
                this._startingShares.delete(uri);
                return;
            }
        }
        const kind = opts.kind || 'fixed';
        const inReplyTo = opts.inReplyTo || null;
        // Privacy radius — distance in metres. When > 0, every
        // outgoing tick is gated by `_shouldSendUpdateTick` against
        // the first real GPS fix we recorded for this session. The
        // first fix is captured silently (no tick sent) and stored on
        // the timer entry as `originPoint`; thereafter any tick whose
        // haversine distance to that origin point is below the radius
        // is dropped on the floor, so the receiver keeps seeing the
        // "Locating…" placeholder bubble until the user has physically
        // moved past the perimeter. Only honoured for the meeting-
        // handshake kinds (the modal already enforces this client-
        // side, but we re-coerce here in case a future caller forgets).
        // Negative or non-numeric inputs collapse to 0 (off).
        const rawRadius = Number(opts.excludeOriginRadiusMeters);
        const excludeOriginRadiusMeters =
            (kind === 'meetingRequest' || kind === 'meetingAccept')
                && Number.isFinite(rawRadius) && rawRadius > 0
                ? rawRadius
                : 0;
        // Shared meeting destination. For the simulator we may set
        // this lazily (after the first real GPS fix) — initial value
        // is whatever the caller supplied (e.g. an accepter receiving
        // a destination embedded in the meeting_request the requester
        // already broadcast). The value lives on the locationTimers
        // entry so any path that emits a tick can stamp it; tickExtras
        // is rebuilt at each send site (see _buildTickExtras below).
        const initialDestination = (opts.destination
                && typeof opts.destination.latitude === 'number'
                && typeof opts.destination.longitude === 'number')
            ? {latitude: opts.destination.latitude, longitude: opts.destination.longitude}
            : null;
        const tickExtras = {
            meetingRequest: kind === 'meetingRequest',
            inReplyTo,
            destination: initialDestination,
        };
        // Shared identifier both sides use to refer to the same "Until we
        // meet" session. For the requester it's the _id of their origin
        // tick (carries meeting_request:true). For the accepter it's the
        // inReplyTo they were started with — which equals the requester's
        // origin _id. That symmetry means either side can emit / receive
        // a `meeting_end` signal carrying this id and the peer can find
        // the matching locationTimers entry to tear down. For plain timed
        // shares we leave it null — they don't have a reciprocal share
        // to stop on the peer side.
        // (Computed post-hoc for meetingRequest below, once originMetadataId
        // is known.)
        let meetingSessionId = null;
        if (kind === 'meetingAccept' && inReplyTo) {
            meetingSessionId = inReplyTo;
        }

        // === IMMEDIATE USER FEEDBACK (pre-permission) ===
        //
        // The user tapped "Meet up"/"Confirm". Until we know otherwise
        // we treat that as commitment and surface evidence of the tap
        // synchronously, before any await — because the permission
        // chain below, OS prompts, and first-GPS-fix can each add
        // perceptible latency.
        //
        // Two bits of feedback fire here:
        //
        //   1. Optimistic activeLocationShares entry. NavigationBar's
        //      share/pin indicator reads this map; flipping the entry
        //      now makes the icon start pulsing on the same frame as
        //      the tap. If permission is later denied/blocked/cancelled
        //      we roll it back in the finally path (see
        //      rollbackOptimistic() below).
        //
        //   2. Announcement text message ("I want to meet up with you",
        //      etc.). Previously this was sent AFTER the permission
        //      chain — meaning on an unlucky path the user waited 10 s
        //      before their own outgoing invitation appeared in chat.
        //      Sending it now gives the sender immediate proof that
        //      the invitation went out; the bubble (origin tick) can
        //      still take a moment to follow.
        //
        // Computing an interim expiresAt here duplicates the math
        // later at ~line 1250; the later computation overrides this
        // one once we know the share is definitely starting.
        const optimisticNow = Date.now();
        const optimisticExpiresAt = (typeof opts.expiresAt === 'number'
                                     && opts.expiresAt > optimisticNow)
            ? opts.expiresAt
            : optimisticNow + durationMs;
        const hadActiveShareForUri = this.state.activeLocationShares[uri] !== undefined;
        if (!hadActiveShareForUri) {
            this.setState({
                activeLocationShares: {
                    ...this.state.activeLocationShares,
                    [uri]: optimisticExpiresAt,
                },
            });
        }

        // Announcement text — build and ship NOW. Keep the id so we
        // can surgically delete the message if the permission chain
        // ultimately fails and we abandon this share attempt.
        // suppressAnnouncement is used by the resume-on-restart path
        // (_loadAndResumeActiveShares) — the original announcement
        // already landed in the chat the first time the share
        // started, so re-emitting it on resume would just spam the
        // conversation with duplicate "I want to meet up" / "I am
        // sharing for X hours" messages.
        let announcementMessageId = null;
        if (this.props.sendMessage && !opts.suppressAnnouncement) {
            let announcementText;
            if (kind === 'meetingRequest') {
                announcementText = 'I want to meet up with you';
            } else if (kind === 'meetingAccept') {
                announcementText = 'I want to meet with you, too!';
            } else if (kind === 'untilIReturn') {
                // Distinct copy from the "for X hours" form so the
                // caregiver immediately understands the share will
                // self-stop on return rather than running for the
                // full ceiling. The 8h ceiling is mentioned in the
                // modal's disclosure text and on the bubble; we keep
                // the announcement short.
                announcementText = 'I am sharing the location with you until I return';
            } else {
                announcementText = `I am sharing the location with you for ${periodLabel}`;
            }
            announcementMessageId = uuid.v4();
            const textTs = new Date();
            const textMessage = {
                _id: announcementMessageId,
                key: announcementMessageId,
                createdAt: textTs,
                text: announcementText,
                metadata: {locationAnnouncement: true},
                // GiftedChat requires a `user` field on every message.
                user: {},
            };
            this.props.sendMessage(uri, textMessage);
        }

        // Single place to unwind the optimistic UI state + invitation
        // message if the permission chain denies us. Must be safe to
        // call multiple times — several early-return branches below
        // all funnel through this.
        const rollbackOptimistic = () => {
            if (!hadActiveShareForUri
                && this.state.activeLocationShares[uri] !== undefined
                && !this.locationTimers[uri]) {
                const next = {...this.state.activeLocationShares};
                delete next[uri];
                this.setState({activeLocationShares: next});
            }
            if (announcementMessageId
                && typeof this.props.deleteMessage === 'function') {
                try {
                    // Local-only removal (third arg true) — no peer
                    // echo needed because we want to undo a UI message
                    // that never should have shipped, not record a
                    // deletion of a real-message history.
                    this.props.deleteMessage(announcementMessageId, uri, true);
                } catch (e) {
                    console.log('[location] rollback deleteMessage failed',
                        e && e.message ? e.message : e);
                }
                announcementMessageId = null;
            }
        };

        // Upfront capability probe. We want to *tell the user* — before we
        // fire a single tick — whether their current OS-level permission
        // can sustain a background share. The native prompt for 'Always'
        // only appears once in an app's lifetime; after that, iOS silently
        // ignores requestAlwaysAuthorization and the only path back is
        // Settings. So we explicitly branch on the precise state.
        const permState = await this.getLocationPermissionStatus();
        const openSettingsFn = () => {
            try {
                if (Platform.OS === 'ios') {
                    // Deep link straight into Sylk's pane in Settings.app.
                    Linking.openURL('app-settings:');
                } else {
                    try { openSettings(); }
                    catch (e) { Linking.openSettings && Linking.openSettings(); }
                }
            } catch (e) { /* noop */ }
        };

        if (permState === 'blocked') {
            // The user has previously tapped "Don't Allow" (iOS) or "Don't
            // ask again" (Android). Any request() call is a no-op — only
            // Settings can flip this back.
            //
            // Arm the auto-resume FIRST so the optimistic UI (pulsing
            // share icon, "I want to meet up with you" announcement
            // text) can stay in place — it's a more honest UX than
            // tearing it down and forcing a second tap. The drain
            // inside _onAppStateChange will resume the share once the
            // app foregrounds with sufficient permission. Don't re-arm
            // when this run IS the resume — would loop.
            if (!opts._resumedAfterPermission) {
                this._armPermissionRetry(uri, durationMs, periodLabel, opts);
            } else {
                // Resume run found permission still blocked — give up
                // and roll back so the user isn't stuck with phantom UI.
                rollbackOptimistic();
            }
            Alert.alert(
                'Location access blocked',
                Platform.OS === 'ios'
                    ? "Blink can't access your location.\n\nOpen Settings → Blink → Location and choose 'Always'. The share will start automatically once you do."
                    : "Blink can't access your location.\n\nOpen Settings → Permissions → Location and choose 'Allow all the time'. The share will start automatically once you do.",
                [
                    {
                        text: 'Cancel',
                        style: 'cancel',
                        onPress: () => {
                            // User explicitly chose to NOT proceed —
                            // drop the parked intent and roll the
                            // optimistic UI back so the chat doesn't
                            // sit there pretending a share is starting.
                            this._cancelPendingPermissionShare(uri, rollbackOptimistic);
                        },
                    },
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        if (permState === 'unavailable') {
            rollbackOptimistic();
            Alert.alert(
                'Location unavailable',
                'Location services are not available on this device.',
                [{text: 'OK', style: 'cancel'}]
            );
            return;
        }

        if (Platform.OS === 'ios' && permState === 'whenInUse') {
            // User granted "While Using" but not "Always". Foreground
            // sharing works; the share WILL stop the moment the user
            // swipes Blink into the background. Be explicit about the
            // consequence and offer a one-tap path to upgrade.
            //
            // Three buttons map to three outcomes:
            //   • Cancel        — user changed their mind, abort.
            //   • Start anyway  — keep "While Using", continue, share
            //                     pauses on bg. No retry needed.
            //   • Open Settings — user wants to upgrade to Always; we
            //                     park the intent and auto-resume on
            //                     foreground after they grant.
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    "Background sharing needs 'Always'",
                    "Blink has 'While Using' location access. The share will pause when you move Blink to the background.\n\nOpen Settings → Blink → Location and pick 'Always' — the share will start automatically once you do.",
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel')},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve('settings'); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve('cancel')}
                );
            });
            if (proceed === 'settings') {
                // Park the intent and exit. The auto-resume drain will
                // re-run startLocationSharing once permission upgrades
                // to 'always' and the app foregrounds.
                if (!opts._resumedAfterPermission) {
                    this._armPermissionRetry(uri, durationMs, periodLabel, opts);
                } else {
                    rollbackOptimistic();
                }
                return;
            }
            if (proceed !== 'start') {
                rollbackOptimistic();
                return;
            }
            // Fall through to the normal start path — ensureLocationPermission
            // below will re-confirm the OS-level permission and start ticks.
        }

        if (Platform.OS === 'android' && permState === 'foregroundOnly') {
            // Android analogue of iOS 'whenInUse': fine location is granted
            // but ACCESS_BACKGROUND_LOCATION is not. Our foreground service
            // keeps the process alive, but API 30+ still won't deliver
            // location callbacks if the background-location permission is
            // missing. Make the user aware and offer the Settings deep-link
            // (API 30+ has no runtime dialog for this — Settings is the
            // only path).
            //
            // Same three-way outcome as the iOS whenInUse branch above —
            // see that block's comment for the auto-resume rationale.
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    'Background sharing needs "Allow all the time"',
                    'Blink has location access only while the app is in use. Your share will pause when you switch away from Blink.\n\nOpen Settings → Permissions → Location and pick "Allow all the time" — the share will start automatically once you do.',
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel')},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve('settings'); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve('cancel')}
                );
            });
            if (proceed === 'settings') {
                if (!opts._resumedAfterPermission) {
                    this._armPermissionRetry(uri, durationMs, periodLabel, opts);
                } else {
                    rollbackOptimistic();
                }
                return;
            }
            if (proceed !== 'start') {
                rollbackOptimistic();
                return;
            }
        }

        // Fast-path around ensureLocationPermission when we already know
        // from the upfront probe that the OS-level permission is granted.
        //
        // Why this matters: on iOS, Geolocation.requestAuthorization()
        // only fires its success callback via CLLocationManagerDelegate's
        // didChangeAuthorization — and that delegate ONLY fires on actual
        // authorization *changes*. If the user has already granted Always
        // (or WhenInUse), calling requestAuthorization is a no-op at the
        // CoreLocation layer: no change → no delegate callback → the
        // Promise wrapping it in ensureLocationPermission sits unresolved
        // until its 10 000 ms `setTimeout(settle(true), 10000)` safety
        // net fires. That ten-second stall is exactly the delay users
        // see between tapping "Meet up"/"Confirm" and their placeholder
        // bubble rendering — nothing after this await runs, including
        // the origin tick that draws the bubble on both sides.
        //
        // We still need setConfiguration to run (it flips the library's
        // authorizationLevel and enables background updates), but that
        // call is synchronous, so we do it inline here and skip the
        // hanging requestAuthorization.
        let hasPermission;
        const iosAlreadyGranted = Platform.OS === 'ios'
            && (permState === 'always' || permState === 'whenInUse');
        const androidAlreadyGranted = Platform.OS === 'android'
            && (permState === 'always' || permState === 'foregroundOnly');
        if (iosAlreadyGranted) {
            try {
                if (Geolocation && typeof Geolocation.setConfiguration === 'function') {
                    Geolocation.setConfiguration({
                        authorizationLevel: 'always',
                        enableBackgroundLocationUpdates: true,
                    });
                }
            } catch (e) { /* noop */ }
            hasPermission = true;
        } else if (androidAlreadyGranted) {
            // On Android PermissionsAndroid.request() for an already-granted
            // permission resolves quickly, but there's no need to incur the
            // round-trip at all — skip straight to tick emission.
            hasPermission = true;
        } else {
            hasPermission = await this.ensureLocationPermission();
        }
        if (!hasPermission) {
            console.log('Location permission denied; cannot share location');
            // Park the intent rather than tearing down the optimistic
            // UI immediately — the user has already tapped Accept /
            // Meet up / Confirm once and re-prompting them after
            // they grant the permission in Settings is a UX failure.
            // _drainPendingPermissionShares will pick this up the
            // next time the app foregrounds with sufficient permission.
            // Skip arming during a resume run (would loop) and roll
            // back instead so the phantom UI doesn't persist.
            if (!opts._resumedAfterPermission) {
                this._armPermissionRetry(uri, durationMs, periodLabel, opts);
            } else {
                rollbackOptimistic();
            }
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access. Pick 'Always' for background sharing — the share will start automatically once you do."
                    : "Blink needs location access to share your live location.\n\nOpen Settings → Permissions → Location and choose 'Allow all the time' — the share will start automatically once you do.",
                [
                    {
                        text: 'Cancel',
                        style: 'cancel',
                        onPress: () => {
                            // User explicitly aborted — drop the parked
                            // intent and unwind the optimistic UI.
                            this._cancelPendingPermissionShare(uri, rollbackOptimistic);
                        },
                    },
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        const now = Date.now();
        // Acceptance mode inherits expires_at from the original request so
        // both devices tear down in sync. Otherwise compute from duration.
        const expiresAt = (typeof opts.expiresAt === 'number' && opts.expiresAt > now)
            ? opts.expiresAt
            : now + durationMs;
        // durationMs was the caller's request, but once expiresAt is clamped
        // the effective duration is what timers below use.
        const effectiveDurationMs = Math.max(0, expiresAt - now);
        const expiresIso = new Date(expiresAt).toISOString();

        // If there's already an active share for this uri, replace it with
        // the new one (new duration supersedes the old one). Silent because
        // we're about to emit a fresh "started sharing" note below. Skip
        // this entirely when the pre-permission re-entry guard noticed no
        // existing share (hadActiveShareForUri === false) — the
        // stopLocationSharing() call is a no-op in that case but also
        // happens to race with the optimistic activeLocationShares entry
        // we set above, so we don't want to even think about touching
        // state we're mid-way through populating.
        //
        // Auto-resume case: when this run was kicked by
        // _drainPendingPermissionShares, hadActiveShareForUri is true
        // (the optimistic activeLocationShares entry from the original
        // call is still in place — we never rolled it back) but
        // locationTimers[uri] is empty (no real share was ever started).
        // Calling stopLocationSharing here would tear down the optimistic
        // UI we explicitly preserved across the permission round-trip,
        // including its "I want to meet up" announcement and the pulsing
        // share icon. Require a REAL active share (locationTimers entry)
        // before triggering replacement.
        if (hadActiveShareForUri && this.locationTimers[uri]) {
            this.stopLocationSharing(uri, {silent: true, reason: 'replaced'});
        }

        // NOTE: the plain-text announcement that used to live here was
        // moved to the top of this function (pre-permission block) so
        // the invitation shows up in the chat the moment the user taps
        // Confirm, not after the permission / OS-prompt round-trip. See
        // rollbackOptimistic() above for how we undo it if permission
        // is ultimately denied.

        // Origin tick — the first metadata message carrying coordinates
        // + expiration. Its _id becomes the anchor every subsequent
        // tick points back to. For "Until we meet" the origin tick
        // carries meeting_request:true; for acceptance every tick
        // carries in_reply_to pointing at the original request.
        //
        // We DON'T send a placeholder up-front. Earlier we shipped a
        // null-coords "Locating…" tick synchronously to give the user
        // immediate feedback; that produced a wire / SQL row with no
        // useful data, and on chat reload the bubble fell back to
        // "Locating…" with no map. The wait-for-first-fix path is
        // backed instead by the memory-only "📍 Location will be shared
        // as soon as it is acquired…" system message (see
        // shareLocationOnce / kicker callers) so the sender still sees
        // immediate feedback. The first valid-coords send (initial
        // getCurrentCoordinates() resolve OR first watchPosition /
        // setInterval fire — whichever wins) becomes the origin via
        // the atomic origin-promotion check inside sendLocationMetadata.
        //
        // Resume path: we already know the saved origin id from a
        // previous run. Reuse it so subsequent ticks UPDATE the
        // existing bubble instead of spawning a fresh one.
        let originMetadataId = null;
        if (opts.resumeOriginMetadataId) {
            originMetadataId = opts.resumeOriginMetadataId;
        }

        // Kick off the real GPS fetch in the background. When the fix
        // lands we emit a tick that the atomic origin-promotion in
        // sendLocationMetadata routes correctly: as the origin if no
        // origin has been recorded yet (fresh share), or as an update
        // if a watchPosition fire already claimed the origin slot, or
        // an explicit update on the resume path. We don't await this —
        // startLocationSharing's watch / interval arming below must
        // run synchronously so the tear-down path (timers, session
        // state) is consistent regardless of how long the first fix
        // takes.
        {
            this.getCurrentCoordinates().then(async (coords) => {
                // Session may have been stopped between placeholder send
                // and GPS resolve (user hit Stop, or meeting handshake
                // tore it down). Nothing to update in that case — the
                // placeholder bubble was already removed or is about to
                // be, and sending an update tick would re-inject it.
                if (!this.locationTimers[uri]) {
                    return;
                }
                // DEBUG: meet-up convergence simulator. The requester
                // picks the destination (4 km random offset) lazily
                // on the first real GPS fix; the accepter has a
                // *synthetic starting position* installed (real GPS
                // + 10 km random offset) so the two phones aren't
                // sitting on top of each other when the meet starts.
                // Both candidates are validated against Nominatim so
                // we don't randomly pick a point in the middle of a
                // sea / ocean / lake / river — re-rolling the bearing
                // up to 5 times if we land in water. Both fields
                // ride on tickExtras / entry from this point onward
                // and every emission path reads through them.
                if (ENABLE_MEET_SIMULATION
                        && kind === 'meetingRequest'
                        && !tickExtras.destination) {
                    const dest = await this._pickMeetingDestinationKmOnLand(coords, 4);
                    if (dest) {
                        tickExtras.destination = dest;
                        try {
                            const utils = require('../utils');
                            utils.timestampedLog(
                                `[sim] picked random meeting destination at ${dest.latitude.toFixed(5)},${dest.longitude.toFixed(5)} (~4 km from start, on land)`
                            );
                        } catch (e) { /* noop */ }
                    }
                }
                // Accepter side, simulation mode: replace real GPS
                // with a synthetic position 10 km away from where we
                // actually are, so we have visible distance to the
                // destination even when both phones are sitting on
                // the same desk. Stored on entry.simulatedPosition;
                // every other tick path consults it via
                // _effectiveCoordinatesForSession.
                const entryNow = this.locationTimers[uri];
                if (ENABLE_MEET_SIMULATION
                        && kind === 'meetingAccept'
                        && entryNow
                        && !entryNow.simulatedPosition) {
                    const synthetic = await this._pickMeetingDestinationKmOnLand(coords, 10);
                    if (synthetic) {
                        // Re-fetch entry — the await opened a window
                        // for the share to be torn down underneath us.
                        const entryAfter = this.locationTimers[uri];
                        if (entryAfter && !entryAfter.simulatedPosition) {
                            entryAfter.simulatedPosition = {
                                latitude: synthetic.latitude,
                                longitude: synthetic.longitude,
                                accuracy: 5,
                                timestamp: Date.now(),
                            };
                            // Drop the race fence — subsequent
                            // watchPosition / interval fires will
                            // pick up the synthetic position via
                            // _effectiveCoordinatesForSession.
                            entryAfter.awaitingSimulatedPosition = false;
                            try {
                                const utils = require('../utils');
                                const u = `https://maps.google.com/?q=${synthetic.latitude.toFixed(5)},${synthetic.longitude.toFixed(5)}`;
                                utils.timestampedLog(
                                    `[sim] accepter synthetic position armed for ${uri} → ${synthetic.latitude.toFixed(5)},${synthetic.longitude.toFixed(5)} (${u}) — ~10 km from real GPS, on land`
                                );
                            } catch (e) { /* noop */ }
                        }
                    } else {
                        // Pick failed entirely (rare — _pickMeeting…
                        // OnLand falls back to a plain pick on
                        // exhausted retries). Drop the fence anyway
                        // so the share can keep running on real GPS;
                        // staying gated forever would be worse than
                        // a degraded test setup.
                        const entryAfter = this.locationTimers[uri];
                        if (entryAfter) {
                            entryAfter.awaitingSimulatedPosition = false;
                        }
                    }
                }
                // Re-check the timer entry — both awaits above could
                // have spanned a tear-down window.
                if (!this.locationTimers[uri]) {
                    return;
                }
                // From here on, the first update tick reports the
                // synthetic position when simulation is in play.
                // Otherwise it reports the real GPS fix as before.
                const effective = this._effectiveCoordinatesForSession(uri, coords);
                // Privacy-radius gate. _shouldSendUpdateTick captures
                // the originPoint baseline as a side-effect on the
                // first valid coord, then returns false until the user
                // has moved past the perimeter.
                if (!this._shouldSendUpdateTick(uri, effective)) {
                    // Meeting-request shares need to bootstrap the
                    // handshake even while the inviter's position is
                    // hidden. Ship a "privacy-deferred" origin tick:
                    // value coords are the destination (the only point
                    // we're willing to disclose) but stamped with
                    // privacyDeferred:true so neither end renders the
                    // inviter pin. The peer renders a map showing only
                    // the destination + meeting_request signal +
                    // Accept modal. The inviter's actual position
                    // stays private until they cross the perimeter,
                    // at which point a real coord update flows and
                    // the bubble adds the inviter pin to both ends.
                    const liveEntryRef0 = this.locationTimers && this.locationTimers[uri];
                    const dest = tickExtras && tickExtras.destination;
                    // Both sides of the meet handshake can opt into a
                    // privacy radius — the inviter (kind=meetingRequest)
                    // hides their starting position with the slider in
                    // ShareLocationModal, the accepter (kind=meetingAccept)
                    // hides theirs via the same slider in
                    // MeetingRequestModal. Either side, when inside its
                    // own privacy radius at share start, ships ONE
                    // privacy-deferred tick so the peer can render the
                    // bubble + Accept modal (inviter side) or so the
                    // inviter knows the meeting is on (accepter side)
                    // without disclosing the deferred party's actual
                    // position. Real coords flow once the user crosses
                    // their own perimeter.
                    if ((kind === 'meetingRequest' || kind === 'meetingAccept')
                            && dest
                            && typeof dest.latitude === 'number'
                            && typeof dest.longitude === 'number'
                            && liveEntryRef0
                            && !liveEntryRef0.privacyDeferredOriginSent) {
                        liveEntryRef0.privacyDeferredOriginSent = true;
                        liveEntryRef0.privacyDeferred = true;
                        let _deferredMid = null;
                        try {
                            // sendLocationMetadata stamps
                            // metadata.privacyDeferred + the radius
                            // (read from the timer entry's
                            // excludeOriginRadiusMeters) — no
                            // separate system note here. The
                            // "Move <radius> from here…" hint is
                            // rendered as a bottom strip overlay on
                            // the map bubble itself (LocationBubble's
                            // privacy-deferred branch), keeping the
                            // chat timeline clean.
                            _deferredMid = this.sendLocationMetadata(
                                uri,
                                {latitude: dest.latitude, longitude: dest.longitude},
                                expiresIso,
                                originMetadataId,
                                {...tickExtras, privacyDeferred: true}
                            );
                        } catch (e) {
                            console.log('[location] privacy-deferred origin send failed',
                                e && e.message ? e.message : e);
                        }
                        // Stamp the inviter's REAL coords as a
                        // local-only field on the just-injected
                        // bubble's metadata. The wire payload above
                        // shipped the destination as `value` (so the
                        // peer can't see where the inviter is), but
                        // on the inviter's OWN device we want the
                        // bubble to show their actual position +
                        // privacy circle + distance to destination.
                        // The localOwnerCoords field stays on the
                        // device — never re-serialised, never sent.
                        // Save it on the entry too so subsequent
                        // throttled GPS fixes (still inside the
                        // privacy radius) can refresh it.
                        // Pick the bubble id that the local user's
                        // privacy-deferred coords should attach to:
                        //   • REQUESTER (kind=meetingRequest): the
                        //     ORIGIN tick's mId — that's this
                        //     device's outgoing meeting bubble.
                        //     Prefer entry.originMetadataId because
                        //     sendLocationMetadata may have just
                        //     promoted the new mid to origin (fresh
                        //     share) OR may have routed the tick as
                        //     an UPDATE pointing at a previously
                        //     promoted origin (resumed share — auto-
                        //     resume after Metro reload sets
                        //     originMetadataId on the entry from the
                        //     persisted snapshot, so the deferred
                        //     send becomes an "update" tick whose
                        //     own mId is NOT the bubble id). Only
                        //     fall back to _deferredMid if the entry
                        //     somehow doesn't have an origin id yet.
                        //   • ACCEPTER (kind=meetingAccept): the
                        //     INVITATION's id (= tickExtras.inReplyTo).
                        //     The accepter's reply tick gets suppressed
                        //     from creating its own bubble (the
                        //     in_reply_to dedup in _injectLocationBubble),
                        //     so all rendering happens on the incoming
                        //     request bubble whose _id IS the request
                        //     id.
                        const _isAccepter = (kind === 'meetingAccept');
                        const _midForStamp = _isAccepter
                            ? (tickExtras && tickExtras.inReplyTo)
                            : ((liveEntryRef0 && liveEntryRef0.originMetadataId)
                                || _deferredMid);
                        const _radiusForStamp = Number(liveEntryRef0.excludeOriginRadiusMeters) || 0;
                        utils.timestampedLog(
                            '[location] privacy-deferred origin: stamping localOwnerCoords',
                            'kind=', kind,
                            'mid=', _midForStamp,
                            'radius=', _radiusForStamp,
                            'effective=', effective
                                ? `${effective.latitude},${effective.longitude}` : 'null',
                            'callbackType=', typeof this.props.setLocalOwnerCoordsForBubble
                        );
                        if (_midForStamp
                                && typeof this.props.setLocalOwnerCoordsForBubble === 'function') {
                            // Run twice — once immediately, once after a
                            // tick — because handleMessageMetadata's
                            // bubble injection runs in a microtask after
                            // sendMessage. setState is idempotent so the
                            // second write is cheap when the first
                            // already succeeded.
                            this.props.setLocalOwnerCoordsForBubble(
                                uri, _midForStamp, effective, _radiusForStamp
                            );
                            setTimeout(() => {
                                if (typeof this.props.setLocalOwnerCoordsForBubble === 'function') {
                                    this.props.setLocalOwnerCoordsForBubble(
                                        uri, _midForStamp, effective, _radiusForStamp
                                    );
                                }
                            }, 250);
                        }
                        liveEntryRef0.privacyDeferredBubbleMid = _midForStamp;
                    }
                    return;
                }
                // First non-deferred tick: clear the privacyDeferred
                // marker on the entry. Subsequent ticks (and the
                // wire) will now carry the inviter's real coords.
                const liveEntryRef = this.locationTimers && this.locationTimers[uri];
                if (liveEntryRef && liveEntryRef.privacyDeferred) {
                    liveEntryRef.privacyDeferred = false;
                }
                // Heartbeat the very first tick too. The 60 s
                // watchPosition / interval paths each have their own
                // tickAttempts increment + log, but the initial
                // getCurrentCoordinates().then() bypasses both — without
                // this bump, attempt counters start at 0 for the first
                // minute even though a tick is going out. Bump here so
                // the user sees "attempt=1" in the log line that pairs
                // with the bubble's "↻ 1" counter the moment the share
                // starts.
                const _initEntry = this.locationTimers && this.locationTimers[uri];
                if (_initEntry) {
                    _initEntry.tickAttempts = (_initEntry.tickAttempts || 0) + 1;
                    try {
                        utils.timestampedLog(
                            `[location] heartbeat → ${uri} attempt=${_initEntry.tickAttempts} kind=${_initEntry.kind || 'fixed'} (initial fix)`
                        );
                    } catch (e) { /* noop */ }
                }
                this.sendLocationMetadata(
                    uri, effective, expiresIso, originMetadataId, tickExtras
                );
            }).catch((err) => {
                utils.timestampedLog('[location] initial getCurrentCoordinates failed',
                    err && err.message ? err.message : err);
            });
        }

        // For the requester side the session id is the origin tick's _id
        // (the same id the accepter will echo back in in_reply_to).
        if (kind === 'meetingRequest' && originMetadataId) {
            meetingSessionId = originMetadataId;
        }

        if (Platform.OS === 'ios') {
            // iOS background path: CADisplayLink-driven JS timers (setInterval,
            // BackgroundTimer.setInterval) pause the moment the app is
            // suspended — they are **not** real wall-clock timers in
            // background. The only reliable way to keep emitting ticks while
            // the app is in background is to ride CLLocationManager's own
            // streaming callbacks. When UIBackgroundModes contains "location"
            // and we've enabled allowsBackgroundLocationUpdates (done in
            // ensureLocationPermission), watchPosition → startUpdatingLocation
            // keeps firing the success callback while we're backgrounded.
            //
            // We still throttle to LOCATION_REPEAT_MS in JS so we don't flood
            // the channel; CLLocationManager will fire the callback much more
            // often than once a minute even with a sane distanceFilter.
            const entry = {
                watchId: null,
                expiryTimeoutId: null,
                expiresAt,
                originMetadataId,
                // Remember the request _id we're replying to (if any) so
                // an incoming "remove message" for that _id can surgically
                // cancel just this share via stopSharesRepliesTo().
                inReplyTo,
                // Shared "Until we meet" session id (requester's origin _id).
                // Used by stopLocationSharing to signal the peer, and by
                // stopSharesForMeetingSession to react to the peer's signal.
                meetingSessionId,
                // Last wall-clock ms we actually emitted a tick. Seeded with
                // 0 so the very first watchPosition callback passes the
                // LOCATION_REPEAT_MS throttle and emits a real-coords update
                // immediately. The origin tick we just sent carried
                // placeholder coords (see placeholderCoords above) — the
                // receiver's bubble is stuck on "Locating…" until we ship
                // one with real lat/lng, so we want that to happen at the
                // first opportunity, not 60 s from now.
                lastSentMs: 0,
                // Privacy-radius state. `excludeOriginRadiusMeters` is
                // fixed at session start (from the modal slider — 0
                // means disabled, 500 / 2000 are the user-visible
                // stops); `originPoint` is captured on the first valid
                // GPS fix by _shouldSendUpdateTick; `originRadiusCleared`
                // flips exactly once when the user crosses the
                // perimeter so the "now sharing" log fires once instead
                // of on every subsequent tick.
                excludeOriginRadiusMeters,
                originPoint: null,
                originRadiusCleared: false,
                // Reference to the same tickExtras object the iOS
                // watchPosition closure captured. Mutating
                // entry.tickExtras.destination here flows through to
                // every subsequent tick automatically — used by the
                // simulator to publish a destination after the first
                // real GPS fix without re-arming the watch.
                tickExtras,
                // Race fence (debug): when the accepter's share
                // starts in simulation mode the synthetic 10 km
                // position is set up asynchronously inside the first
                // getCurrentCoordinates().then() callback (because it
                // awaits Nominatim land-checks). The iOS watchPosition
                // callback below — and the equivalent Android
                // interval — can fire before that async work
                // completes; without a fence they'd ship a real-GPS
                // tick first, the receiver pairs both phones at ~1 m,
                // and proximity-met fires erroneously. Setting this
                // flag synchronously here gates every tick path until
                // the async setup clears it. Set only when we
                // actually need it; production builds with
                // ENABLE_MEET_SIMULATION=false leave it false and
                // skip the gate entirely.
                awaitingSimulatedPosition:
                    ENABLE_MEET_SIMULATION && kind === 'meetingAccept',
                // Persisted to AsyncStorage on every mutation so a
                // killed app can re-arm this entry on next boot —
                // see _persistActiveShares / _loadAndResumeActiveShares.
                // periodLabel is only used at restart-time to pass
                // through to the resumed startLocationSharing call;
                // we don't ship a fresh announcement message on resume.
                kind,
                periodLabel,
                // "Until I return" state machine — see
                // _evaluateUntilReturnGate. On a fresh start both
                // fields are reset (origin captured by the first
                // valid tick; departed flips when the user moves
                // beyond the threshold). On a kill-restart resume
                // we restore whatever was persisted so the gate
                // doesn't lose its "I've already left" memory.
                untilReturnOrigin: opts.resumeUntilReturnOrigin || null,
                untilReturnDeparted: !!opts.resumeUntilReturnDeparted,
                // Carry over the persisted paused state so a kill-
                // restart or AsyncStorage-resume of a paused share
                // doesn't silently start emitting ticks again. Set
                // BEFORE the initial tick is dispatched below so the
                // pause-gate at the top of sendLocationUpdate
                // (around line 1505) catches and swallows it. Default
                // false for fresh shares.
                paused: !!opts.resumePaused,
            };
            this.locationTimers[uri] = entry;
            this._persistActiveShares();

            if (Geolocation && typeof Geolocation.watchPosition === 'function') {
                try {
                    const watchId = Geolocation.watchPosition(
                        (position) => {
                            // Session may have been torn down between the
                            // CLLocationManager callback being queued and us
                            // running — ignore late-arriving fixes. The
                            // entry being deleted is the canonical "stopped"
                            // signal; we don't check watchId here because
                            // the very first fix can arrive before the
                            // `entry.watchId = watchId` assignment below.
                            const current = this.locationTimers[uri];
                            if (!current) {
                                return;
                            }
                            if (Date.now() >= expiresAt) {
                                this.stopLocationSharing(uri, {reason: 'expired'});
                                return;
                            }
                            const nowMs = Date.now();
                            if (nowMs - current.lastSentMs < this.LOCATION_REPEAT_MS) {
                                return;
                            }
                            // Race fence: the accepter's synthetic
                            // 10 km position is armed asynchronously
                            // (inside the initial getCurrentCoordinates
                            // .then(); awaits Nominatim). The iOS
                            // watch can fire before that completes —
                            // skip the tick until the synthetic is
                            // actually in place, otherwise we'd leak
                            // real GPS as the first reported coord
                            // and the proximity-met logic would
                            // mistake the two phones (sitting on the
                            // same desk) for "you've arrived".
                            if (current.awaitingSimulatedPosition && !current.simulatedPosition) {
                                return;
                            }
                            current.lastSentMs = nowMs;
                            // Per-minute heartbeat log. Fires here —
                            // AFTER the LOCATION_REPEAT_MS throttle but
                            // BEFORE the privacy-radius / send path —
                            // so the user always sees an "I'm alive"
                            // line in the app log every minute, even
                            // when the actual tick gets swallowed
                            // (privacy radius, peer not yet paired,
                            // GPS dropout). entry.tickAttempts is the
                            // sender-side counter that increments
                            // every minute regardless of send outcome
                            // — surfaces in the bubble's footer next
                            // to the timestamp.
                            current.tickAttempts = (current.tickAttempts || 0) + 1;
                            try {
                                utils.timestampedLog(
                                    `[location] heartbeat → ${uri} attempt=${current.tickAttempts} kind=${current.kind || 'fixed'}`
                                );
                            } catch (e) { /* noop */ }
                            const c = position && position.coords ? position.coords : {};
                            const realCoords = {
                                latitude: c.latitude,
                                longitude: c.longitude,
                                accuracy: c.accuracy,
                                timestamp: position.timestamp,
                            };
                            // Honour any synthetic position that's
                            // armed for this session. Today the
                            // accepter side gets one installed on
                            // share start (10 km from real GPS) and
                            // the simulator walks it from there. When
                            // simulation is off this returns realCoords
                            // unchanged.
                            const coords = this._effectiveCoordinatesForSession(uri, realCoords);
                            // Privacy radius gate. When the user opted
                            // in to "Exclude my current location (1km)"
                            // and the fresh fix is still inside the
                            // 1 km circle around the session's origin
                            // point, swallow the tick. The throttle
                            // bump above still ran so we won't busy-
                            // loop on every CLLocationManager callback;
                            // we just no-op the actual emission until
                            // the user moves out of the radius.
                            if (!this._shouldSendUpdateTick(uri, coords)) {
                                // Privacy radius is hiding the tick
                                // from the wire — but on the SENDER's
                                // own device we still want the
                                // bubble to track real movement so
                                // the user sees themselves on the
                                // map. Stamp the latest coords as
                                // local-only metadata. No-op when
                                // not in a privacy-deferred meet
                                // session (entry.privacyDeferred
                                // false / mid missing).
                                const _curEntry = this.locationTimers
                                    && this.locationTimers[uri];
                                if (_curEntry && _curEntry.privacyDeferred
                                        && _curEntry.privacyDeferredBubbleMid
                                        && typeof this.props.setLocalOwnerCoordsForBubble === 'function') {
                                    this.props.setLocalOwnerCoordsForBubble(
                                        uri,
                                        _curEntry.privacyDeferredBubbleMid,
                                        coords
                                    );
                                }
                                return;
                            }
                            this.sendLocationMetadata(uri, coords, expiresIso, originMetadataId, tickExtras);
                        },
                        (error) => {
                            const msg = error && error.message ? error.message : String(error);
                            const code = error && error.code;
                            utils.timestampedLog('[location] iOS watchPosition error', msg, 'code=', code);
                            // code 1 == PERMISSION_DENIED (library constant RNCPositionErrorDenied).
                            // Leaving the share "running" after permission was pulled would
                            // leave a stale timer + menu entry with no ticks going out; tear
                            // it down and post a system note so the user knows why.
                            if (code === 1) {
                                const stoppedAt = new Date().toLocaleTimeString([], {
                                    hour: '2-digit', minute: '2-digit',
                                });
                                // Stop silently so the default "You stopped sharing" note
                                // doesn't fire — we want a more specific permission note.
                                this.stopLocationSharing(uri, {silent: true, reason: 'denied'});
                                if (typeof this.props.saveSystemMessage === 'function') {
                                    this.props.saveSystemMessage(
                                        uri,
                                        `\uD83D\uDCCD Live location sharing stopped at ${stoppedAt} (location permission denied). Enable 'Always' location access for Blink in Settings to share in the background.`,
                                        'outgoing'
                                    );
                                }
                                // Critical: a system note inside the chat only helps when
                                // the app is foregrounded. The denial typically fires the
                                // moment the user swipes Sylk into the background, so we
                                // also fire a local iOS notification. PushNotificationIOS
                                // presents this as a banner / lock-screen alert regardless
                                // of foreground state, which is the only way the user sees
                                // "your share stopped" while Sylk isn't on screen.
                                if (Platform.OS === 'ios'
                                    && typeof this.props.sendLocalNotification === 'function') {
                                    try {
                                        this.props.sendLocalNotification(
                                            'Live location stopped',
                                            // Kept short — banners truncate anything
                                            // longer on a locked screen. The 'open
                                            // Settings' action lives on the tap-handler
                                            // (onLocalNotification → location_stopped).
                                            "Tap to open Blink's Settings and enable 'Always' access.",
                                            {
                                                // from_uri drives sendLocalNotification's
                                                // throttle bucket; using the contact uri
                                                // keeps this notification from colliding
                                                // with arbitrary message notifications.
                                                from_uri: uri,
                                                event: 'location_stopped',
                                                reason: 'denied',
                                            }
                                        );
                                    } catch (e) {
                                        console.log('[location] sendLocalNotification failed',
                                            e && e.message ? e.message : e);
                                    }
                                }
                            }
                        },
                        {
                            enableHighAccuracy: false,
                            // Fire every time the user moves; throttling is in JS.
                            distanceFilter: 0,
                            // useSignificantChanges would let the OS wake us
                            // less often but at the cost of minute-ish
                            // latency — we want the 60s cadence we promised
                            // the receiver, so stick with standard updates.
                            useSignificantChanges: false,
                        }
                    );
                    entry.watchId = watchId;
                } catch (e) {
                    utils.timestampedLog('[location] iOS watchPosition failed to start',
                        e && e.message ? e.message : e);
                }
            }

            // Fallback for a stationary user: CLLocationManager only fires
            // callbacks when the OS thinks something has changed. If the
            // phone stays perfectly still for the whole sharing window we
            // could miss the expiry check above. Arm a single
            // BackgroundTimer.setTimeout at the full duration so we always
            // tear down even if no fixes ever arrive. (setTimeout — unlike
            // setInterval — still fires once the app returns to foreground,
            // and will fire on schedule while backgrounded because
            // react-native-background-timer uses a real iOS timer here.)
            try {
                entry.expiryTimeoutId = BackgroundTimer.setTimeout(() => {
                    this.stopLocationSharing(uri, {reason: 'expired'});
                }, effectiveDurationMs);
            } catch (e) { /* noop */ }
        } else {
            // Android path. We rely on two things running together:
            //
            //   (a) LocationForegroundService — a native Kotlin service
            //       with foregroundServiceType="location" that pins the
            //       process in the foreground-service tier, keeps the
            //       JS engine alive past the usual background throttle,
            //       and (crucially on API 29+) is the only supported
            //       vehicle for location callbacks to keep flowing while
            //       the app isn't on screen.
            //
            //   (b) BackgroundTimer.setInterval — react-native-background-timer
            //       schedules a real wall-clock alarm on Android, so our
            //       60s tick keeps firing as long as the foreground
            //       service is alive.
            //
            // We start the service FIRST so that the very first post-origin
            // tick (60s in) is already protected, not just the ones after.
            if (LocationForegroundServiceModule
                && typeof LocationForegroundServiceModule.startService === 'function') {
                try {
                    LocationForegroundServiceModule.startService();
                } catch (e) {
                    console.log('[location] LocationForegroundService.startService failed',
                        e && e.message ? e.message : e);
                }
            }

            const intervalId = BackgroundTimer.setInterval(() => {
                if (Date.now() >= expiresAt) {
                    this.stopLocationSharing(uri, {reason: 'expired'});
                    return;
                }
                // Per-minute heartbeat log. Fires at the start of
                // every interval tick BEFORE sendLocationUpdate
                // (which can swallow the tick on a privacy-radius
                // gate or GPS read failure). Mirrors the iOS path
                // above so app logs show a uniform "I'm alive" line
                // every minute regardless of platform.
                const _entryNow = this.locationTimers && this.locationTimers[uri];
                if (_entryNow) {
                    _entryNow.tickAttempts = (_entryNow.tickAttempts || 0) + 1;
                    try {
                        utils.timestampedLog(
                            `[location] heartbeat → ${uri} attempt=${_entryNow.tickAttempts} kind=${_entryNow.kind || 'fixed'}`
                        );
                    } catch (e) { /* noop */ }
                }
                // Subsequent ticks carry metadataId = origin's _id so the
                // receiver updates the existing bubble in place rather than
                // rendering a new one.
                this.sendLocationUpdate(uri, expiresIso, originMetadataId, tickExtras);
            }, this.LOCATION_REPEAT_MS);

            this.locationTimers[uri] = {
                intervalId,
                expiresAt,
                originMetadataId,
                inReplyTo,
                meetingSessionId,
                // Privacy-radius state — same shape as the iOS entry so
                // _shouldSendUpdateTick / sendLocationUpdate work the
                // same way on either platform. See the iOS branch above
                // for what each field does.
                excludeOriginRadiusMeters,
                originPoint: null,
                originRadiusCleared: false,
                // Same tickExtras object the BackgroundTimer interval
                // captures via closure — mutation here propagates.
                tickExtras,
                // Same race fence as the iOS branch above — see the
                // long comment there for what this gates and why.
                awaitingSimulatedPosition:
                    ENABLE_MEET_SIMULATION && kind === 'meetingAccept',
                // Same persistence-resume metadata as the iOS branch.
                kind,
                periodLabel,
                // "Until I return" state machine — see the iOS
                // branch above for the rationale on each field.
                untilReturnOrigin: opts.resumeUntilReturnOrigin || null,
                untilReturnDeparted: !!opts.resumeUntilReturnDeparted,
                // Persisted-pause restoration. Same intent as the iOS
                // branch above: when the user paused a share and the
                // app then went through a foreground/background cycle
                // (or a process restart), the in-memory entry was
                // re-armed without the paused flag and ticks resumed
                // on their own. Reading `opts.resumePaused` here keeps
                // the pause sticky.
                paused: !!opts.resumePaused,
            };
            this._persistActiveShares();
        }

        // Reflect the final (authoritative) expiresAt in React state.
        // The pre-permission block up top seeded activeLocationShares with
        // an optimistic expiresAt so the NavigationBar icon could start
        // pulsing at tap time; that value was computed ~milliseconds
        // earlier and is off by a tiny amount. Overwrite it now with the
        // canonical one so countdown UI and stop-timer math agree.
        this.setState({
            activeLocationShares: {
                ...this.state.activeLocationShares,
                [uri]: expiresAt,
            },
        });

        // System note persisted in SQL (saveSystemMessage INSERTs with
        // system=1, then renders it live). Only emitted if the origin tick
        // actually went out — otherwise a permission/network failure would
        // leave the user with a false "started" record on disk.
        //
        // Meeting-kind shares (meetingRequest / meetingAccept) DON'T get
        // a system note anymore: we already ship a chat-visible text
        // message on both legs of the handshake ("I want to meet up with
        // you" from the requester, "I want to meet with you, too!" from
        // the accepter — see the pre-permission announcement block up
        // top). The old "Meeting request started" / "Meeting request
        // accepted" system lines duplicated the same information one row
        // above the real text. Plain timed shares keep the "started
        // sharing at HH:MM" note — that one isn't redundant because
        // plain shares have no comparable chat-visible text marker.
        // Skip the "Started sharing location at HH:MM" note on
        // resume — the original note already lives in the chat;
        // re-emitting it on every restart would litter the
        // conversation.
        const isMeeting = kind === 'meetingRequest' || kind === 'meetingAccept';
        if (originMetadataId
            && !isMeeting
            && !opts.suppressAnnouncement
            && typeof this.props.saveSystemMessage === 'function') {
            // Wall-clock time the share began — same HH:MM format as the
            // stop note so the two bracket the sharing window visibly.
            const startedAt = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            const label = periodLabel ? ` for ${periodLabel}` : '';
            const note = `\uD83D\uDCCD Started sharing location at ${startedAt}${label}`;
            this.props.saveSystemMessage(uri, note, 'outgoing');
        }
      } finally {
        // Paired with the this._startingShares.add(uri) at function
        // entry. Always release the in-flight flag so a later (legitimate)
        // call to start a new share — after this one has either fully
        // set up or been torn down — isn't blocked by a lingering guard.
        if (this._startingShares) {
          this._startingShares.delete(uri);
        }
      }
    }

    async onShareLocationConfirmed({durationMs, periodLabel, kind, excludeOriginRadiusMeters}) {
        const uri = this.props.selectedContact && this.props.selectedContact.uri;
        if (!uri) {
            return;
        }
        // "Meet me there..." path: the user invoked the share flow
        // from a chat-bubble kebab/inline on a Google-Maps-link text
        // message, and a destination is staged on state (or being
        // resolved in the background). If the user confirmed BEFORE
        // background resolution completed and we still have only the
        // shortened URL, do a last-ditch synchronous resolve here so
        // the user doesn't lose the destination because they were
        // quick on the trigger. Failure surfaces an Alert rather than
        // silently shipping a meet-up with no destination.
        let destination = this.state.pendingShareDestination;
        const pendingUrl = this.state.pendingShareDestinationUrl;
        if (!destination && pendingUrl) {
            utils.timestampedLog('[location] meetMeAt: confirm beat resolve — last-chance sync resolve for',
                pendingUrl);
            try {
                destination = await utils.resolveShortLocationUrl(pendingUrl);
            } catch (e) {
                destination = null;
            }
            if (!destination) {
                utils.timestampedLog('[location] meetMeAt: last-chance resolve failed for', pendingUrl);
                Alert.alert(
                    'Couldn\'t read the map link',
                    'The shared link couldn\'t be expanded into coordinates. Open it in Maps and re-share the resulting full link.',
                    [{text: 'OK'}]
                );
                return;
            }
        }
        if (destination
                && typeof destination.latitude === 'number'
                && typeof destination.longitude === 'number') {
            const _kind = 'meetingRequest';
            utils.timestampedLog('[location] meetMeAt: confirmed —',
                'destination=', destination.latitude.toFixed(5), ',', destination.longitude.toFixed(5),
                'overriding kind from', kind, '→', _kind);
            this.startLocationSharing(uri, durationMs, periodLabel, {
                kind: _kind,
                excludeOriginRadiusMeters,
                destination,
            });
            return;
        }
        if (kind === 'once') {
            this.shareLocationOnce(uri);
            return;
        }
        this.startLocationSharing(uri, durationMs, periodLabel, {kind, excludeOriginRadiusMeters});
    }

    // One-shot location share — acquire a single GPS fix and ship a
    // single sylk-message-metadata tick with action='location' and
    // one_shot:true. No timer, no follow-up ticks, no peerCoords
    // pairing, no destination, no proximity logic. Receiver renders
    // a static "Shared location" bubble (LocationBubble keys off
    // metadata.one_shot to drop the live-share affordances).
    //
    // Permission errors fall through to the same Alert prompts the
    // live-share path uses — there's no value in inventing a
    // separate copy for the one-shot path.
    // opts.inReplyTo — when this one-shot is answering a peer's
    //   `location_request` (action='location_request' / messageId=<reqId>),
    //   pass that reqId here. The outgoing tick stamps in_reply_to so
    //   the peer can dedupe and any of OUR sibling devices on the same
    //   account see the replicated tick and mirror "this request is
    //   answered" — closing their LocationRequestModal automatically
    //   (see app.js _noteSiblingAnsweredLocationRequest).
    async shareLocationOnce(uri, opts = {}) {
        if (!uri) return;
        if (!this.props.sendMessage) {
            utils.timestampedLog('[location] shareLocationOnce: sendMessage prop not wired');
            return;
        }
        // Prominent Disclosure (Google Play). Same gate as
        // startLocationSharing — must precede the OS permission
        // dialog and any data collection. Declining cleanly aborts.
        const acknowledged = await this._ensureLocationDisclosureAcknowledged();
        if (!acknowledged) {
            utils.timestampedLog('[location] shareLocationOnce: disclosure declined for', uri);
            return;
        }
        let hasPermission;
        try {
            hasPermission = await this.ensureLocationPermission();
        } catch (e) {
            hasPermission = false;
        }
        if (!hasPermission) {
            // Same "Open Settings" deep-link the live-share alert
            // uses (see startLocationSharing's openSettingsFn). On
            // iOS we hop into the app's own pane via the
            // app-settings: scheme; on Android react-native-permissions
            // exposes openSettings() which lands directly on the
            // app's Permissions screen — same destination as the
            // "Permissions" item in the global kebab menu.
            const openSettingsFn = () => {
                try {
                    if (Platform.OS === 'ios') {
                        Linking.openURL('app-settings:');
                    } else {
                        try { openSettings(); }
                        catch (e) { Linking.openSettings && Linking.openSettings(); }
                    }
                } catch (e) { /* noop */ }
            };
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access."
                    : 'Blink needs location access to share your location with your contact. Open Settings to enable it.',
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }
        // Memory-only "we're working on it" note. GPS cold-start can
        // take 5–15 s, and without any visible feedback the user
        // wonders whether the tap registered. Use renderSystemMessage
        // (no SQL INSERT, no replication) so the note disappears on
        // the next chat reload and doesn't clutter restored history.
        if (typeof this.props.renderSystemMessage === 'function') {
            try {
                this.props.renderSystemMessage(
                    uri,
                    '📍 Location will be shared as soon as it is acquired…',
                    'outgoing',
                    new Date(),
                    true
                );
            } catch (e) { /* noop */ }
        }
        try {
            const coords = await this.getCurrentCoordinates();
            // 24 h expires_at is generous — a one-shot location is
            // useful for a long time after it's sent (you might be
            // showing it to someone the next morning), and the
            // bubble's expiry-aware UI is suppressed for one_shot
            // anyway. The expires field still gates the SQL row's
            // 7-day cleanup, so we don't end up with stale forever
            // rows.
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const extras = {oneShot: true};
            if (opts && opts.inReplyTo) {
                extras.inReplyTo = opts.inReplyTo;
            }
            this.sendLocationMetadata(uri, coords, expiresAt, null, extras);
            if (typeof this.props.saveSystemMessage === 'function') {
                const at = new Date().toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                });
                this.props.saveSystemMessage(uri,
                    `📍 Shared current location at ${at}`,
                    'outgoing');
            }
        } catch (err) {
            utils.timestampedLog('[location] shareLocationOnce failed',
                err && err.message ? err.message : err);
        }
    }

    // Send a "please share your current location" request to the peer.
    // Symmetric to the meet-up handshake: we ship a single
    // sylk-message-metadata with action='location_request' (no coords
    // — we're asking, not sharing). The receiver's app.js detects the
    // action and pops a small Yes/No modal; on Yes the peer fires
    // shareLocationOnce back our way.
    //
    // No timer, no follow-up ticks, no expiry-driven cleanup — the
    // request expires on its own (24 h is generous: long enough for
    // the user to be away from the phone for most of a day before
    // they'd reasonably want a fresh ask), and the receiver's
    // pendingLocationRequests entry is silently dropped past expiry.
    requestPeerLocation(uri) {
        if (!uri) return;
        if (!this.props.sendMessage) {
            utils.timestampedLog('[location] requestPeerLocation: sendMessage prop not wired');
            return;
        }
        try {
            const reqId = uuid.v4();
            const now = new Date();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            // Announcement text — a plain `text/plain` chat message
            // sent alongside the metadata payload. Routes through the
            // server's standard push pipeline, which is what wakes a
            // sleeping iPhone / Android. Without it the metadata
            // message lands silently when the receiver's app is in
            // background or terminated, and they never see the
            // request until they happen to open Blink. The companion
            // metadata still drives the modal — this text is just
            // the wake-up.
            try {
                const announceId = uuid.v4();
                const announceText = 'Could you share your current location, please?';
                this.props.sendMessage(uri, {
                    _id: announceId,
                    key: announceId,
                    createdAt: now,
                    text: announceText,
                    metadata: {locationRequestAnnouncement: true},
                    user: {},
                });
            } catch (e) {
                console.log('[location] requestPeerLocation announcement send failed',
                    e && e.message ? e.message : e);
            }

            const metadataContent = {
                action: 'location_request',
                messageId: reqId,
                timestamp: now,
                uri: uri,
                expires: expiresAt,
            };
            const metadataMessage = {
                _id: reqId,
                key: reqId,
                createdAt: now,
                metadata: metadataContent,
                text: JSON.stringify(metadataContent),
                user: {},
            };
            this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
            // No "Requested current location at HH:MM" system note —
            // the polite announcement text we shipped above ("Could
            // you share your current location, please?") already
            // serves as the chat-visible breadcrumb. A redundant
            // system line right next to it just clutters the
            // conversation.
        } catch (e) {
            utils.timestampedLog('[location] requestPeerLocation failed',
                e && e.message ? e.message : e);
        }
    }

    // Public entry point used by app.js when the local user taps "Accept"
    // on an incoming meeting request. Starts a location share whose ticks
    // carry in_reply_to pointing at the original request, with the same
    // expiresAt the requester chose so both sides tear down in sync.
    //
    // Returns a Promise that resolves to true if a share actually started
    // (locationTimers entry now exists for `uri`), false otherwise. The
    // caller in app.js (_acceptMeetingRequest) uses this to roll back the
    // optimistic acceptedMeetingRequestIds marker when the share never
    // started — e.g. user denied / blocked the permission prompt, or
    // declined the prominent disclosure. Without this rollback the user
    // gets stuck: the marker keeps "Accept" disabled forever even though
    // they may have just granted permission and now want to retry.
    async startMeetingAcceptance(uri, {requestId, expiresAt, periodLabel, excludeOriginRadiusMeters, destination}) {
        if (!uri || !requestId || typeof expiresAt !== 'number') {
            utils.timestampedLog('[location] startMeetingAcceptance: missing required args',
                uri, requestId, expiresAt);
            return false;
        }
        const now = Date.now();
        const durationMs = Math.max(0, expiresAt - now);
        if (durationMs === 0) {
            utils.timestampedLog('[location] startMeetingAcceptance: request already expired', requestId);
            return false;
        }
        await this.startLocationSharing(
            uri,
            durationMs,
            periodLabel || 'until we meet',
            {
                kind: 'meetingAccept',
                inReplyTo: requestId,
                expiresAt,
                // Mirror the requester-side privacy radius: the
                // accepter's "starting point" is the location they
                // were at when they tapped Accept, and the slider on
                // MeetingRequestModal lets them hide that exactly the
                // same way the sender modal does.
                excludeOriginRadiusMeters,
                // Shared meeting destination — accepter inherits
                // whatever the requester broadcast (today: simulator
                // pick; tomorrow: user map-picker). Stamped on every
                // outgoing tick so the view layer / future map UI on
                // the requester's side gets a reciprocal echo.
                destination,
            }
        );
        // Canonical "share started" indicator: locationTimers[uri] is
        // populated only on the success path inside startLocationSharing
        // (after permission probe + disclosure both clear). Any early-
        // return path in there (denied / blocked / disclosure-declined /
        // iOS-whenInUse-cancel / Android-foregroundOnly-cancel) leaves
        // locationTimers untouched, so this read tells us whether to
        // honour the "we accepted" state in app.js or roll it back.
        return !!(this.locationTimers && this.locationTimers[uri]);
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
        return this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId;
    }

    conferenceCall() {
        this.props.showConferenceModalFunc();
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
            bellStyle = styles.greenButton;
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
        let caregiverTitle = this.props.selectedContact?.localProperties?.caregiver ? '✓ Caregiver' : 'Caregiver';
		let autoAnswerModeTitle = this.props.autoAnswerMode ? 'Turn Off Auto-answer' : 'Auto-answer Mode';
  
        let extraMenu = false;
        let importKeyLabel = this.props.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = this.state.showEditContactModal;

        let showBackButton = this.props.selectedContact || this.props.sharingAction;

        let isAnonymous = this.props.selectedContact && (this.props.selectedContact.uri.indexOf('@guest.') > -1 || this.props.selectedContact.uri.indexOf('anonymous@') > -1);
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
        // Two distinct icons for the two search modes — the contacts
        // list uses an account+magnifier glyph (search through PEOPLE),
        // and the in-chat search uses a text+magnifier glyph (search
        // MESSAGES). Both flip to the universal close icon while the
        // search bar is open. Previously a single 'magnify' icon was
        // used for both, which read as ambiguous in the navbar.
        let searchContactsIcon = this.props.searchContacts ? 'close' : 'account-search';
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

			if (this.props.selectedContact.uri.indexOf('@guest.') > -1) {
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
		// comfortable size on tablets (where 60dp looks cramped).
		// Resolution order:
		//   1) explicit `navBarHeight` prop (caller decides — e.g. a
		//      future "navbar size" preference)
		//   2) folded (Razr cover display): always 60 — vertical space
		//      is at a premium and the existing layout is tuned for it
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
		// in proportion to the new bar height.
		const _navBarHeight = (typeof this.props.navBarHeight === 'number' && this.props.navBarHeight > 0)
		    ? this.props.navBarHeight
		    : (this.props.isFolded ? 60 : (this.props.isTablet ? 90 : 60));
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
        const _showBrandStrip = !this.props.isLandscape;
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
            <Appbar.Header
                 /* Force-remount on fold / size transitions. Paper's
                    Appbar.Header (and the IconButtons / Text inside it)
                    cache their measured layout at the density of the
                    first mount. On the Razr 60 Ultra, unfolding from
                    the cover display (where Appbar last measured
                    itself at folded density / dimensions) doesn't
                    re-measure automatically — the inner-display
                    onLayout sometimes fires once with the new height,
                    but the cached frames for nested IconButton /
                    Text children stick around. Re-keying on
                    _navRemountKey (already used to remount the title
                    and icons below) forces the whole Appbar.Header
                    subtree to re-mount, which clears the cache and
                    lets the new fold-state geometry take effect. */
                 key={'appbar-header-' + _navRemountKey}
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
                               marginRight: 10,
                               alignItems: 'center',
                               justifyContent: 'center',
                           }}
                       >
                           {this.props.firstSyncPending ? (
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
                       </View>
                   );
               })()}

                {/* Search icon (search messages within the open chat, OR
                    search contacts on the list view). Positioned so it
                    sits immediately to the LEFT of the kebab menu, with
                    the DND bell on its own left in the contacts-list
                    view. Stays visible during an active call too —
                    the user often wants to find a contact or look up
                    a previous message while a conference is up.

                    Hidden entirely while the conference-invite picker
                    is up (inviteContacts === true): the picker has its
                    own pinned search bar — Blink/AB toggle + dialpad —
                    and the navbar's search icon would only collide
                    with it. */}
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
                :
                this.props.inviteContacts ? null :
				<IconButton
                    key={'search-contacts-' + _navRemountKey}
                    style={styles.whiteButton}
                    size={navIconBtnSize}
                    disabled={false}
                    onPress={this.props.toggleSearchContacts}
                    icon={searchContactsIcon}
                />
                }

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

                { /* Hide the kebab / overflow menu while a search
                     mode is active in the main interface — the user
                     wants the navbar trimmed down to just the search
                     controls until search is dismissed. Applies to
                     both contacts-search and messages-search; either
                     flag being set suppresses the kebab. */ }
                { (!this.props.searchContacts && !this.props.searchMessages) ?
                  (this.props.selectedContact ?
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible, keyMenuVisible: false})}
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

                        { this.props.devMode ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/>: null}

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

                        {/* Caregiver — gated on the same conditions as
                            Auto-answer above (favorite contact, not a
                            conference / anonymous / blocked / test row,
                            outside of a call or active message search).
                            Sits immediately below Auto-answer so the
                            two favorite-only attributes group together
                            visually, and toggleFavorite scrubs the tag
                            on un-favorite, so the option only ever
                            renders when the underlying state can
                            actually carry it. */}
                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleCaregiver')} title={caregiverTitle}/>
                        : null}

                        {!this.props.inCall && tags.indexOf('test') === -1 && !isFavorite && !(this.props.isFolded && this.props.selectedContact) ?
                        <Divider />
                        : null}

                        {!this.props.inCall && !isFavorite && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('deleteContact')} icon="delete" title={deleteTitle}/>
                        : null}

                        {/* Help… — same entry that lives in the
                            no-contact kebab below, mirrored here so
                            it is also reachable from the per-contact
                            kebab. This is the only kebab the user
                            can open while a call is active (during
                            a call selectedContact is set to the
                            remote party, so the no-contact branch
                            never renders), and previously there was
                            no path to the in-app log viewer / support
                            request modal mid-call. Always shown,
                            matching the "available in every context"
                            intent stated on the sibling item. The
                            folded layout has its own truncation
                            rules elsewhere in this menu; Help is
                            small and self-contained so we leave it
                            unconditional. */}
                        <Divider />
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="lifebuoy" title="Help…" />

                    </Menu>
                :
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                        // See the marginTop comment on the contact-
                        // mode menu above — same camera-cutout fix.
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
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }

                        {/* Quick DND toggle. Same action as the bell
                            glyph in the navbar header — added to the
                            kebab menu so the user can flip it without
                            having to reach the top-right icon on
                            larger devices. Icon mirrors the current
                            state (bell-off-outline when DND is on,
                            bell-outline when off) so the menu line
                            also functions as a status indicator. */}
                        {!this.props.inCall ?
                        <Menu.Item
                            onPress={() => this.handleMenu('toggleDnd')}
                            icon={this.props.dnd ? 'bell-off-outline' : 'bell-outline'}
                            title={this.props.dnd ? 'Turn off Do Not Disturb' : 'Turn on Do Not Disturb'}
                        />
                         : null }

                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('scanQr')} icon="qr-code" title="Scan QR code..." />
                         : null }

                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {/* Add contact stays available while a call is
                            active. The contact-add modal is purely
                            local UI / address-book bookkeeping — no
                            media or signalling overlap with the call.
                            We still respect the folded layout guard
                            (no-contact-selected on a folded device
                            doesn't have room for the modal). */}
                        {!(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                         : null }

                        {!this.props.inCall && false ? <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}
                        {!this.props.inCall ?
                        <Divider />
                        : null}

                        { (this.props.devMode && this.refetchMessagesForDays) ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

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

                       {!this.props.syncConversations && !this.props.inCall && !(this.props.isFolded && !this.props.selectedContact)  ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}

                       {/* Preferences modal — opens a sheet of
                           per-account toggles (encryption mode, video
                           codec, etc.). Pure UI; no overlap with an
                           active call. Stays available so the user
                           can adjust e.g. proximity sensor mid-call. */}
                       <Menu.Item onPress={() => this.handleMenu('preferences')} icon="cog-outline" title="Preferences..." />
 
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
								title="My private key..."
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

                        {/* Permissions — deep-links to the OS settings
                            screen for Blink. Useful mid-call when the
                            user realises camera/mic/location wasn't
                            granted. We keep the folded-layout guard,
                            but drop the inCall gate. */}
                        {!(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('appSettings')} icon="policy-alert" title="Permissions"/>
                         : null }

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
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="lifebuoy" title="Help…" />

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

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    buildId={this.props.buildId}
                    toggleDevMode={this.props.toggleDevMode}
                    devMode={this.props.devMode}
                />

                <CallMeMaybeModal
                    show={this.props.showCallMeMaybeModal}
                    close={this.props.toggleCallMeMaybeModal}
                    callUrl={callUrl}
                    notificationCenter={this.props.notificationCenter}
                />

                <DeleteHistoryModal
                    show={this.state.showDeleteHistoryModal}
                    close={this.closeDeleteHistoryModal}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    defaultDomain={this.props.defaultDomain}
                    hasMessages={this.hasMessages}
                    deleteMessages={this.props.deleteMessages}
                    filteredMessageIds={this.props.filteredMessageIds}
                    selectedContact={this.props.selectedContact}
                    deleteContact={this.state.deleteContact}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                />

                <DeleteFileTransfers
                    show={this.state.showDeleteFileTransfers}
                    close={this.closeDeleteFileTransfers}
                    selectedContact={this.props.selectedContact}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    deleteFilesFunc={this.props.deleteFiles}
                    transferedFiles={this.props.transferedFiles}
                    transferedFilesSizes={this.props.transferedFilesSizes}
                    getTransferedFiles={this.props.getTransferedFiles}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                />

                <AddContactModal
                    show={this.state.showAddContactModal}
                    close={this.toggleAddContactModal}
                    saveContactByUser={this.props.saveContactByUser}
                    defaultDomain={this.props.defaultDomain}
                />

                <EditContactModal
                    show={showEditModal}
                    close={this.hideEditContactModal}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : this.props.accountId}
                    defaultDomain={this.props.defaultDomain}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName}
                    selectedContact={this.props.selectedContact}
                    organization={this.props.organization}
                    email={this.props.selectedContact ? this.props.selectedContact.email : this.props.email}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                    saveContactByUser={this.props.saveContactByUser}
                    deletePublicKey={this.props.deletePublicKey}
                    publicKey={this.state.showPublicKey ? this.props.publicKey: null}
                    myuuid={this.props.myuuid}
 				    rejectNonContacts={this.props.rejectNonContacts}
 				    toggleRejectNonContacts={this.props.toggleRejectNonContacts}
					rejectAnonymous={this.props.rejectAnonymous}
 				    toggleRejectAnonymous={this.props.toggleRejectAnonymous}
					/* chatSounds / toggleChatSounds moved to PreferencesModal. */
					readReceipts={this.props.readReceipts}
 				    toggleReadReceipts={this.props.toggleReadReceipts}
 				    storageUsage={this.props.storageUsage}
 				    deleteAccountUrl={this.props.deleteAccountUrl}
 				    openDeleteAccount={this.openDeleteAccountModal}
 				    preferredVideoCodec={this.props.preferredVideoCodec}
 				    setPreferredVideoCodec={this.props.setPreferredVideoCodec}
 				    preferredAudioCodec={this.props.preferredAudioCodec}
 				    enableAudioRecording={this.props.enableAudioRecording}
 				    encryptionMode={this.props.encryptionMode}
                />

                <DeleteAccountModal
                    show={this.state.showDeleteAccountModal}
                    close={this.closeDeleteAccountModal}
                    onConfirm={this.confirmDeleteAccount}
                    accountId={this.props.accountId}
                />

                {/* Sign-out confirmation. When more than one local
                    account/password pair is stored, the modal also
                    surfaces a per-account "Switch" action which is
                    functionally equivalent to signing out and signing
                    back in via LoginForm with the other identity —
                    props.switchAccount on app.js wires that exact
                    behaviour. */}
                <SwitchAccountModal
                    show={this.state.showSwitchAccountModal}
                    close={() => this.setState({ showSwitchAccountModal: false })}
                    onLogout={this.props.logout}
                    onSwitch={this.props.switchAccount}
                    accountId={this.props.accountId}
                    accountPasswords={this.props.accountPasswords}
                />

                {/* Headless WebView URL resolver — used as a
                    fallback by meetMeAt when the plain HTTP
                    resolveShortLocationUrl can't expand a
                    JS-redirect URL like maps.app.goo.gl/<id>.
                    Mounts only while a resolution is in flight (state
                    flips webViewResolveUrl to non-null), unmounts
                    when the callback fires. The WebViewURLResolver
                    component renders a 0x0 off-screen wrapper so it
                    has no visual or layout effect. */}
                <WebViewURLResolver
                    url={this.state.webViewResolveUrl}
                    onResolved={(finalUrl) => {
                        const cb = this.state.webViewResolveCallback;
                        if (cb) cb(finalUrl, null);
                    }}
                    onError={(err) => {
                        const cb = this.state.webViewResolveCallback;
                        if (cb) cb(null, err);
                    }}
                    /* 15 s timeout. Most resolutions complete within
                       1–3 s when the URL has inline coords. The
                       address-only flow (Google geocoding the
                       sender-supplied place name into lat/lng) needs
                       the page to actually load + JS to run + a
                       follow-up navigation to land — that can take
                       5–10 s on a slow network. 15 s gives a comfy
                       budget without leaving a stuck spinner forever
                       if Google's JS hangs. */
                    timeoutMs={15 * 1000}
                />

                <PreferencesModal
                    show={this.state.showPreferencesModal}
                    close={() => this.setState({ showPreferencesModal: false })}
                    accountId={this.props.accountId}
                    preferredVideoCodec={this.props.preferredVideoCodec}
                    setPreferredVideoCodec={this.props.setPreferredVideoCodec}
                    videoProfile={this.props.videoProfile}
                    setVideoProfile={this.props.setVideoProfile}
                    preferredAudioCodec={this.props.preferredAudioCodec}
                    setPreferredAudioCodec={this.props.setPreferredAudioCodec}
                    enableAudioRecording={this.props.enableAudioRecording}
                    setEnableAudioRecording={this.props.setEnableAudioRecording}
                    chatSounds={this.props.chatSounds}
                    toggleChatSounds={this.props.toggleChatSounds}
                    encryptionMode={this.props.encryptionMode}
                    setEncryptionMode={this.props.setEncryptionMode}
                    dtmfMode={this.props.dtmfMode}
                    setDtmfMode={this.props.setDtmfMode}
                    proximity={this.props.proximity}
                    toggleProximity={this.props.toggleProximity}
                    locationTickIntervalSec={this.props.locationTickIntervalSec}
                    setLocationTickIntervalSec={this.props.setLocationTickIntervalSec}
                    locationProximityMeters={this.props.locationProximityMeters}
                    setLocationProximityMeters={this.props.setLocationProximityMeters}
                    locationPrivacyRadiusMeters={this.props.locationPrivacyRadiusMeters}
                    setLocationPrivacyRadiusMeters={this.props.setLocationPrivacyRadiusMeters}
                    themeMode={this.props.themeMode}
                    setThemeMode={this.props.setThemeMode}
                />

                { this.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    close={this.closeEditConferenceModal}
                    room={this.props.selectedContact ? this.props.selectedContact.uri.split('@')[0]: ''}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName}
                    // Modal reads this as `invitedParties` (its prop
                    // name) — rename here so the existing list of
                    // saved invitees pre-populates the chip row when
                    // re-opening Configure conference on an existing
                    // room. Without this rename the modal only got
                    // `selectedContact.participants` as a fallback,
                    // which works for already-saved rooms but not for
                    // freshly created ones where the caller wants to
                    // hand over an in-memory list.
                    invitedParties={this.props.selectedContact ? this.props.selectedContact.participants : []}
                    selectedContact={this.props.selectedContact}
                    // allContacts feeds the new pill-picker inside the
                    // modal — the user now selects Blink contacts from
                    // a multi-select list rather than typing addresses
                    // free-form, so the modal needs the full contact
                    // roster to filter and display.
                    allContacts={this.props.allContacts}
                    toggleFavorite={this.props.toggleFavorite}
                    saveConference={this.saveConference}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.props.accountId}
                    favoriteUris={this.props.favoriteUris}
                />
                : null}

                <ShareConferenceLinkModal
                    show={this.state.showConferenceLinkModal}
                    notificationCenter={this.props.notificationCenter}
                    close={this.hideConferenceLinkModal}
                    conferenceUrl={conferenceUrl}
                    conferenceRoom={conferenceRoom}
                    sylkDomain={this.props.sylkDomain}
                    conferenceSettings={this.props.conferenceSettings}
                />

                <ShareLocationModal
                    show={this.state.showShareLocationModal}
                    close={this.hideShareLocationModal}
                    onConfirm={this.onShareLocationConfirmed}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : null}
                    /* Disclaimer suppression. The flag is hydrated on
                       registration (see _hydrateDisclaimerSuppression)
                       and persisted by _suppressShareLocationDisclaimer
                       when the user confirms with the checkbox ticked.
                       It's cleared by the privacy-policy opt-out path
                       so the legal text re-appears the moment the user
                       revokes their disclosure consent. */
                    disclaimerSuppressed={this.state.shareDisclaimerSuppressed}
                    onSuppressDisclaimer={this._suppressShareLocationDisclaimer}
                    /* When the share-flow was opened from a chat-bubble's
                       "Meet me there..." kebab on a Google-Maps-link
                       text, pre-select the meet-up option so the user
                       can confirm in one tap. The destination itself
                       lives on this.state.pendingShareDestination and
                       is consumed by onShareLocationConfirmed.
                       meetMode is true whenever EITHER the destination
                       is staged OR a short URL is mid-resolve — the
                       banner shows "Resolving destination…" until
                       coords arrive. */
                    presetKind={
                        (this.state.pendingShareDestination
                            || this.state.pendingShareDestinationUrl)
                        ? 'meetingRequest' : null
                    }
                    meetMode={!!(this.state.pendingShareDestination
                        || this.state.pendingShareDestinationUrl)}
                    meetDestination={this.state.pendingShareDestination}
                    meetDestinationStatus={this.state.pendingShareDestinationStatus}
                    /* Live user location for the preview map. Fetched
                       in showShareLocationModal as a fire-and-forget
                       getCurrentCoordinates() and updated on the
                       state when it lands. The modal forwards it to
                       StaticMap so the user can see where they are
                       relative to the destination, and (when the
                       privacy slider is non-zero) the circle showing
                       how far they need to move before their position
                       starts shipping over the wire. */
                    userLocation={this.state.previewUserLocation}
                    /* Local user's display name — drives the
                       initials on the red avatar pin so it shows
                       the user's first letter rather than '?'. */
                    myDisplayName={this.props.myDisplayName}
                    /* Last-used privacy radius — seeds the slider's
                       initial value when the modal opens, and the
                       modal's onConfirm path calls
                       onPersistPrivacyRadius with whatever the user
                       finally picks so the same value shows up the
                       next time the modal opens. */
                    defaultPrivacyRadiusMeters={
                        Number(this.props.locationPrivacyRadiusMeters) || 0
                    }
                    onPersistPrivacyRadius={this.props.setLocationPrivacyRadiusMeters}
                    /* Caregiver flag drives modal defaults: caregivers
                       open with "Until I return" pre-selected and have
                       "Until we meet" hidden (caregivers don't meet
                       up, they keep watch over a trip). The "Until I
                       return" OPTION itself is no longer caregiver-
                       gated — every contact sees it, but caregivers
                       still get it as the default. We check both the
                       localProperties mirror and the tags list so a
                       contact with only one of them set (e.g. legacy
                       tag-only data, or a half-applied multi-device
                       sync) still gets the default — same defensive
                       read pattern toggleAutoAnswer relies on. */
                    isCaregiver={!!(this.props.selectedContact
                        && ((this.props.selectedContact.localProperties
                                && this.props.selectedContact.localProperties.caregiver)
                            || (Array.isArray(this.props.selectedContact.tags)
                                && this.props.selectedContact.tags.indexOf('caregiver') > -1)))}
                />

                {/* Google Play Prominent Disclosure. Shown the first time
                    the user starts ANY location share (one-shot, timed,
                    or "Meet me"); subsequent shares skip it via the
                    AsyncStorage flag the modal sets on Continue. The
                    {locationDisclosurePending} state object holds the
                    Promise resolvers that
                    _ensureLocationDisclosureAcknowledged is awaiting,
                    so tapping Continue / Cancel here unblocks the
                    pending share/permission flow. */}
                <LocationPrivacyDisclosureModal
                    show={!!this.state.locationDisclosurePending}
                    showOptOut={!!(this.state.locationDisclosurePending
                        && this.state.locationDisclosurePending.showOptOut)}
                    onContinue={() => {
                        const pending = this.state.locationDisclosurePending;
                        if (pending && typeof pending.onContinue === 'function') {
                            pending.onContinue();
                        }
                    }}
                    onCancel={() => {
                        const pending = this.state.locationDisclosurePending;
                        if (pending && typeof pending.onCancel === 'function') {
                            pending.onCancel();
                        }
                    }}
                    onOptOut={() => {
                        const pending = this.state.locationDisclosurePending;
                        if (pending && typeof pending.onOptOut === 'function') {
                            pending.onOptOut();
                        }
                    }}
                />

                {/* Global "manage active location shares" sheet — opened
                    from the pulsing map-marker indicator in the NavBar.
                    stopShare/stopAll route through stopLocationSharing
                    so the timers, foreground service, state mirror and
                    system-note insertion all stay in sync with every
                    other stop path. */}
                <ActiveLocationSharesModal
                    show={this.state.showActiveSharesModal}
                    close={() => this.setState({showActiveSharesModal: false, activeSharesFilterUri: null})}
                    activeShares={this.state.activeLocationShares}
                    allContacts={this.props.allContacts}
                    // When set, the modal renders only the current
                    // chat's share (ReadyBox pin entry point). null from
                    // the NavBar indicator so it lists every share.
                    filterUri={this.state.activeSharesFilterUri}
                    stopShare={(uri) => {
                        this.stopLocationSharing(uri);
                        // If that was the only share, the effect from
                        // componentDidUpdate (currCount → 0) will close
                        // the modal automatically. Otherwise we leave it
                        // open so the user can stop the next one.
                    }}
                    stopAll={() => {
                        Object.keys(this.state.activeLocationShares || {})
                            .forEach((uri) => this.stopLocationSharing(uri));
                    }}
                    /* Pause / Resume bridges. The modal calls these
                       per-row (multi-share) or as the second primary
                       button (single-share). Each routes through the
                       same pauseLocationSharing / resumeLocationSharing
                       methods the bubble kebab and chat-header menu
                       use, so all three entry points stay in sync.
                       getShareState returns 'active' | 'paused' |
                       'stopped' off this.locationTimers[uri].paused so
                       the modal can label the toggle without mirroring
                       state. We pass originMetadataId from the entry
                       so the multi-share guard inside pause/resume
                       (which protects against pausing the wrong
                       session if a stale row id is used) doesn't trip
                       — the entry knows its own origin. */
                    pauseShare={(uri) => {
                        const _entry = this.locationTimers && this.locationTimers[uri];
                        if (_entry) this.pauseLocationSharing(uri, _entry.originMetadataId);
                    }}
                    resumeShare={(uri) => {
                        const _entry = this.locationTimers && this.locationTimers[uri];
                        if (_entry) this.resumeLocationSharing(uri, _entry.originMetadataId);
                    }}
                    getShareState={(uri) => {
                        const _entry = this.locationTimers && this.locationTimers[uri];
                        return this.getLocationShareState(uri, _entry && _entry.originMetadataId);
                    }}
                />
                
				<ExportPrivateKeyModal
					show={this.props.showExportPrivateKeyModal}
					password={this.state.privateKeyPassword}
					close={this.hideExportPrivateKeyModal}
					exportFunc={this.props.exportKey|| (() => {})}
					publicKeyHash={this.props.publicKeyHash}
					publicKey={this.props.publicKey}
					backup={this.state.backupKey}
				/>

                <GenerateKeysModal
                    show={this.state.showGenerateKeysModal}
                    close={this.hideGenerateKeysModal}
                    generateKeysFunc={this.props.generateKeysFunc}
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
    favoriteUris       : PropTypes.array,
    startCall          : PropTypes.func,
    startConference    : PropTypes.func,
    saveContactByUser        : PropTypes.func,
    addContact         : PropTypes.func,
    deletePublicKey    : PropTypes.func,
    sendPublicKey      : PropTypes.func,
    sendMessage        : PropTypes.func,
    messages           : PropTypes.object,
    showImportModal    : PropTypes.func,
    syncConversations   : PropTypes.bool,
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
