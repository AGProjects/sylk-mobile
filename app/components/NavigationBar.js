import React, { Component } from 'react';
import { Alert, Animated, AppState, Easing, Linking, Image, NativeModules, Platform, PermissionsAndroid, View , TouchableHighlight, Dimensions, ActivityIndicator} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button, ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Keyboard } from 'react-native';
import BackgroundTimer from 'react-native-background-timer';
import uuid from 'react-native-uuid';

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

// Native bridge to Sylk's Android foreground service that keeps the
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
import DeleteAccountModal from './DeleteAccountModal';
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
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
import * as Progress from 'react-native-progress';
import * as storage from '../storage';

// Persisted snapshot of locationTimers, keyed under this AsyncStorage
// entry. Versioned so a future schema change can re-key without
// confusing older builds. See _persistActiveShares /
// _loadAndResumeActiveShares for the read-write pair that keeps
// in-flight shares alive across app restarts (graceful or hard kill).
const ACTIVE_SHARES_STORAGE_KEY = 'activeLocationShares.v1';

import styles from '../assets/styles/NavigationBar';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.refetchMessagesForDays = 30;

        // Re-send the live location every 60 seconds until the expiration
        // time chosen by the user is reached.
        this.LOCATION_REPEAT_MS = 60 * 1000;

        // Map<uri, { intervalId, expiresAt }>  — tracks an active
        // "share location" timer per contact so the user can run
        // several shares in parallel and we can cancel them cleanly.
        this.locationTimers = {};

        this.state = {
            showPublicKey: false,
            menuVisible: false,
            keyMenuVisible: false,
            showDeleteFileTransfers: false,
            showEditContactModal: false,
            // Opened from the EditContactModal "Delete account" link when
            // myself=true. Confirms & then calls props.deleteAccount() to
            // wipe this account from the device and sign out.
            showDeleteAccountModal: false,
			showGenerateKeysModal: false,
			showExportPrivateKeyModal: false,
            privateKeyPassword: null,
			backupKey: false,
			deleteContact: false,
			showShareLocationModal: false,
			// Google Play "Prominent Disclosure" gate. Set to a {resolve}
			// promise resolver while the LocationPrivacyDisclosureModal is
			// up; cleared back to null when the user taps Continue or
			// Cancel. _ensureLocationDisclosureAcknowledged below awaits
			// the resolver so the share / permission flow blocks until
			// the user has decided.
			locationDisclosurePending: null,
			// Mirrors AsyncStorage 'locationDisclosureAcknowledged.v2'
			// in component state so render() can branch synchronously
			// on the consent state. Read once at mount; updated by the
			// share-flow's onContinue, the viewer's onOptOut, and the
			// viewer's onContinue (when invoked from the not-yet-
			// agreed branch). This is what keeps the "Location
			// privacy policy..." menu item visible regardless of
			// contact / chat state once the user has consented —
			// they should always be able to revisit / withdraw.
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
			showCallMeMaybeModal: this.props.showCallMeMaybeModal
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
        // the item persists across all chats / contact states until
        // the user explicitly opts out via the viewer modal. Android
        // only — the disclosure UX is a Google Play requirement;
        // iOS uses the App Store / CoreLocation usage-string model
        // and never shows the in-app modal.
        if (Platform.OS === 'android') {
            storage.get('locationDisclosureAcknowledged.v2')
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
    }

    _onAppStateChange(state) {
        if (state !== 'active') return;
        const sharesCount = Object.keys(this.state.activeLocationShares || {}).length;
        if (sharesCount > 0 || this.props.callActive) {
            this._stopActiveSharePulse();
            this._startActiveSharePulse();
        }
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
    _persistActiveShares() {
        try {
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
                };
            }
            storage.set(ACTIVE_SHARES_STORAGE_KEY, map).catch((e) => {
                console.log('[location] _persistActiveShares write failed',
                    e && e.message ? e.message : e);
            });
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
            map = await storage.get(ACTIVE_SHARES_STORAGE_KEY);
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
                    });
            } catch (err) {
                console.log('[location] resume failed for', uri,
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
                    const KEY = 'locationDisclosureAcknowledged.v2';
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
                    storage.get(KEY).catch(() => null).then((acknowledged) => {
                        const showOptOut = acknowledged === true;
                        console.log('[location] disclosure viewer — agreement state =',
                            showOptOut ? 'agreed' : 'not agreed');
                        this.setState({
                            locationDisclosurePending: {
                                showOptOut,
                                onContinue: async () => {
                                    // Only reachable from the
                                    // not-yet-agreed branch; persist
                                    // consent the same way the
                                    // share-flow does and mirror in
                                    // component state so the kebab
                                    // updates immediately.
                                    if (!showOptOut) {
                                        try { await storage.set(KEY, true); }
                                        catch (e) { /* noop */ }
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
                                    try { await storage.remove(KEY); }
                                    catch (e) { /* noop */ }
                                    console.log('[location] user opted out — disclosure flag cleared');
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
                this.props.logout();
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
            console.log('[location] showShareLocationModal: disclosure declined — not opening picker');
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
            console.log('[location] showShareLocationModal: OS permission not granted — picker stays closed');
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
                    ? "Open Settings → Sylk → Location to allow location access."
                    : "Open Settings to allow Sylk to access your location.",
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        // Step 3: open the duration picker.
        this.setState({showShareLocationModal: true});
    }

    hideShareLocationModal() {
        this.setState({showShareLocationModal: false});
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
            // text/* (text + html), image/*, sylk-file-transfer,
            // and sylk-live-location all count. Past location
            // shares evidence an active relationship just as
            // strongly as any other exchanged message.
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
        // server never sees the data at all). Bumping the key makes
        // any user who acknowledged v1 re-see the corrected wording.
        const KEY = 'locationDisclosureAcknowledged.v2';
        try {
            const acknowledged = await storage.get(KEY);
            if (acknowledged === true) {
                return true;
            }
        } catch (e) {
            // Read failure → fall through to show the modal. Better to
            // double-disclose than to silently skip the requirement.
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
                        try { await storage.set(KEY, true); }
                        catch (e) { /* persistence failure is non-fatal */ }
                        this.setState({
                            locationDisclosurePending: null,
                            locationDisclosureAcknowledged: true,
                        });
                        resolve(true);
                    },
                    onCancel: () => {
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
                        message: 'Sylk needs access to your location so it can be shared with your contact.',
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
        // and the kebab's "Accept meeting request" option vanished.
        // Stamping on every tick keeps the persisted content
        // self-describing without further machinery. Receiver-side
        // handlers (`_noteIncomingMeetingRequest`, etc.) are already
        // idempotent on the requestId, so re-firing them on each
        // update tick is a no-op.
        if (extras.meetingRequest) {
            metadataContent.meeting_request = true;
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
        console.log(`[location] tick ${role} → ${uri} ${lat},${lng}${acc} (_id=${mId})`);
        // Record the just-reported coords on the timer entry so
        // _shouldSendUpdateTick's stationary gate can compare future
        // ticks against this baseline. Only meaningful when this is
        // a real coord (placeholder origin ticks land here too with
        // null lat/lng — those shouldn't poison the baseline).
        const liveEntry = this.locationTimers && this.locationTimers[uri];
        if (liveEntry
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            liveEntry.lastReportedCoords = {
                latitude: coords.latitude,
                longitude: coords.longitude,
            };
        }
        // Fire the destination-arrival heads-up if this tick's coords
        // landed within DEST_ARRIVAL_THRESHOLD_M of the shared meeting
        // destination. Once-per-session, gated on the entry flag.
        this._maybeFireDestinationArrival(uri, coords);
        return mId;
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
                `[meet] ARRIVED at meeting point (${Math.round(dist)} m from destination) — ${uri}`
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
        // Stationary gate. If we already shipped a real-coords tick
        // for this session and the new fix is within 10 m of the
        // last reported one, swallow the tick: it doesn't carry new
        // information for the receiver, just adds a chat-bubble
        // refresh and burns network. 10 m is well inside consumer-GPS
        // noise, so a stationary phone reporting drift gets filtered;
        // a real walk of 10 m is a meaningful step that gets through.
        // Placeholder ticks (null lat/lng) are gated separately by
        // the privacy-radius branch below and don't update
        // lastReportedCoords, so they don't poison this comparison.
        const STILL_THRESHOLD_M = 10;
        if (entry.lastReportedCoords
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            const moved = this._haversineMeters(entry.lastReportedCoords, coords);
            if (Number.isFinite(moved) && moved < STILL_THRESHOLD_M) {
                return false;
            }
        }
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
                    `[meet] privacy radius active for ${uri} — your starting point will be hidden until you move ${radiusLabel} away`
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
                    `[meet] privacy radius cleared for ${uri} (${Math.round(meters)} m from origin) — your live location is now being shared`
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
    // Sylk-specific agent and only call this from the debug
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
                'User-Agent': 'Sylk-Mobile/meet-sim (https://sylk.com)',
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
        console.log('[location] paused share for', uri,
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
        console.log('[location] resumed share for', uri,
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
            console.log('[location] getLocationShareState',
                'uri=', uri,
                'asked-origin=', originMetadataId,
                '→ stopped (no entry)',
                'allTimerKeys=', this.locationTimers ? Object.keys(this.locationTimers) : '(none)');
            return 'stopped';
        }
        if (originMetadataId && entry.originMetadataId !== originMetadataId) {
            console.log('[location] getLocationShareState',
                'uri=', uri,
                'asked-origin=', originMetadataId,
                'entry-origin=', entry.originMetadataId,
                '→ stopped (origin mismatch)');
            return 'stopped';
        }
        const result = entry.paused ? 'paused' : 'active';
        console.log('[location] getLocationShareState',
            'uri=', uri,
            'asked-origin=', originMetadataId,
            'entry-origin=', entry.originMetadataId,
            '→', result);
        return result;
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
                console.log('[location] stopSharesRepliesTo: stopping share with', uri,
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
            console.log('[location] sendMeetingEndSignal: sendMessage prop not wired');
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
            console.log('[location] sent meeting_end signal to', uri,
                'session=', sessionId);
        } catch (e) {
            console.log('[location] sendMeetingEndSignal failed',
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
                console.log('[location] stopSharesForMeetingSession: stopping share with', uri,
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
            console.log('[location] startLocationSharing: ignoring duplicate — share already active or in-flight for', uri);
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
                console.log('[location] startLocationSharing: disclosure declined for', uri);
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
            rollbackOptimistic();
            Alert.alert(
                'Location access blocked',
                Platform.OS === 'ios'
                    ? "Sylk can't access your location. Open Settings → Sylk → Location and choose 'Always' to share your live location, including in the background."
                    : "Sylk can't access your location. Open Settings to enable it.",
                [
                    {text: 'Cancel', style: 'cancel'},
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
            // swipes Sylk into the background. Be explicit about the
            // consequence and offer a one-tap path to upgrade.
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    "Background sharing needs 'Always'",
                    "Sylk has 'While Using' location access. The share will pause when you move Sylk to the background.\n\nOpen Settings → Sylk → Location and pick 'Always' to keep sharing in the background.",
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve(false); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve(false)}
                );
            });
            if (!proceed) {
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
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    'Background sharing needs "Allow all the time"',
                    'Sylk has location access only while the app is in use. Your share will pause when you switch away from Sylk.\n\nOpen Settings → Permissions → Location and pick "Allow all the time" to keep sharing in the background.',
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve(false); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve(false)}
                );
            });
            if (!proceed) {
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
            rollbackOptimistic();
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Sylk → Location to allow location access. Pick 'Always' for background sharing."
                    : 'Sylk needs location access to share your live location with your contact. Open Settings to enable it.',
                [
                    {text: 'Cancel', style: 'cancel'},
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
        if (hadActiveShareForUri) {
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
                // _shouldSendUpdateTick captures this fix as the
                // session's `originPoint` when the privacy radius is
                // enabled and returns `false` — so the receiver stays
                // on "Locating…" until the user moves past the
                // 1 km perimeter. When the radius is OFF this just
                // returns true and the tick goes out as before.
                if (!this._shouldSendUpdateTick(uri, effective)) {
                    return;
                }
                this.sendLocationMetadata(
                    uri, effective, expiresIso, originMetadataId, tickExtras
                );
            }).catch((err) => {
                console.log('[location] initial getCurrentCoordinates failed',
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
                                return;
                            }
                            this.sendLocationMetadata(uri, coords, expiresIso, originMetadataId, tickExtras);
                        },
                        (error) => {
                            const msg = error && error.message ? error.message : String(error);
                            const code = error && error.code;
                            console.log('[location] iOS watchPosition error', msg, 'code=', code);
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
                                        `\uD83D\uDCCD Live location sharing stopped at ${stoppedAt} (location permission denied). Enable 'Always' location access for Sylk in Settings to share in the background.`,
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
                                            "Tap to open Sylk's Settings and enable 'Always' access.",
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
                    console.log('[location] iOS watchPosition failed to start',
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

    onShareLocationConfirmed({durationMs, periodLabel, kind, excludeOriginRadiusMeters}) {
        const uri = this.props.selectedContact && this.props.selectedContact.uri;
        if (!uri) {
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
            console.log('[location] shareLocationOnce: sendMessage prop not wired');
            return;
        }
        // Prominent Disclosure (Google Play). Same gate as
        // startLocationSharing — must precede the OS permission
        // dialog and any data collection. Declining cleanly aborts.
        const acknowledged = await this._ensureLocationDisclosureAcknowledged();
        if (!acknowledged) {
            console.log('[location] shareLocationOnce: disclosure declined for', uri);
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
                    ? "Open Settings → Sylk → Location to allow location access."
                    : 'Sylk needs location access to share your location with your contact. Open Settings to enable it.',
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
            console.log('[location] shareLocationOnce failed',
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
            console.log('[location] requestPeerLocation: sendMessage prop not wired');
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
            // request until they happen to open Sylk. The companion
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
            console.log('[location] requestPeerLocation failed',
                e && e.message ? e.message : e);
        }
    }

    // Public entry point used by app.js when the local user taps "Accept"
    // on an incoming meeting request. Starts a location share whose ticks
    // carry in_reply_to pointing at the original request, with the same
    // expiresAt the requester chose so both sides tear down in sync.
    startMeetingAcceptance(uri, {requestId, expiresAt, periodLabel, excludeOriginRadiusMeters, destination}) {
        if (!uri || !requestId || typeof expiresAt !== 'number') {
            console.log('[location] startMeetingAcceptance: missing required args',
                uri, requestId, expiresAt);
            return;
        }
        const now = Date.now();
        const durationMs = Math.max(0, expiresAt - now);
        if (durationMs === 0) {
            console.log('[location] startMeetingAcceptance: request already expired', requestId);
            return;
        }
        this.startLocationSharing(
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
        const bellIcon = this.props.dnd ? 'bell-off' : 'bell';

        if (this.state.menuVisible && !this.props.appStoreVersion) {
            //this.props.checkVersionFunc()
        }
        
        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;

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
		let autoAnswerModeTitle = this.props.autoAnswerMode ? 'Turn Off Auto-answer' : 'Auto-answer Mode';
  
        let extraMenu = false;
        let importKeyLabel = this.props.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = this.state.showEditContactModal;

        let showBackButton = this.props.selectedContact || this.props.sharingAction;

        let hasUpdate = this.props.appStoreVersion && this.props.appStoreVersion.version > VersionNumber.appVersion;
        let updateTitle = hasUpdate ? 'Update Sylk...' : 'Check for updates...';

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

        let title = displayName || 'Myself';
        let searchIcon = (this.props.searchMessages || this.props.searchContacts) ? "close" : "magnify";

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
				title = prettifyName(this.props.selectedContact.uri.split('@')[0]);
				subtitle = 'Conference room';
			} else {
				// Match ContactCard's two-step: pick the name (or username
				// fallback when name == uri / missing), then run it through
				// prettifyName so the navbar title matches the list row.
				let raw;
			    if (this.props.selectedContact.name && this.props.selectedContact.name != this.props.selectedContact.uri) {
					raw = this.props.selectedContact.name;
			    } else {
					raw = this.props.selectedContact.uri.split('@')[0];
			    }
				title = prettifyName(raw);
				subtitle = this.props.selectedContact.uri;
			}

			if (this.props.selectedContact.uri.indexOf('@guest.') > -1) {
				title = 'Anonymous caller';
			}

		}

        let backButtonTitle = 'Back to call';

        if (this.showBackToCallButton) {
            if (this.props.call.hasOwnProperty('_participants')) {
                backButtonTitle = 'Back to conference';
            } else {
                backButtonTitle = 'Back to call';
            }
        }

		const as = 40; //avatar size		

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
                              height: 60,
                              };

		let appBarContainer = {
		                 backgroundColor: 'black',
                         marginLeft: 0,
                         marginTop: 0,
						 height: 60,
						 // Override Paper's inner Appbar built-in
						 // paddingHorizontal: 4 so children align flush
						 // with the header edges.
						 paddingLeft: 0,
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
        return (

			<View style={navBarContainer}
			      /* Diagnostic (disabled — re-enable to debug NavBar layout):
			      onLayout={(e) => {
			          const { x, y, width: w, height: h } = e.nativeEvent.layout;
			          console.log('[FoldUI] NavBar outer onLayout x=', Math.round(x),
			                      'y=', Math.round(y),
			                      'w=', Math.round(w),
			                      'h=', Math.round(h));
			      }}
			      */
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
            <Appbar.Header style={appBarContainer}
                 statusBarHeight={0}
               dark
                 /* Diagnostic (disabled — re-enable to debug NavBar layout):
                 onLayout={(e) => {
                     const { x, y, width: w, height: h } = e.nativeEvent.layout;
                     console.log('[FoldUI] NavBar Appbar onLayout x=', Math.round(x),
                                 'y=', Math.round(y),
                                 'w=', Math.round(w),
                                 'h=', Math.round(h));
                 }}
                 */
                 >
  
                {showBackButton ?
                <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                : <Image source={blinkLogo} style={styles.logo}/>}

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
                    titleStyle={[titleStyle, { marginLeft: 0 }]}
                    subtitleStyle={[subtitleStyle, { marginLeft: 0 }]}
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

 				{ this.showBackToCallButton ?
						<Button
							mode="contained"
						    labelStyle={{ fontSize: 14 }}
						    style={styles.backButton}
							onPress={this.props.goBackToCallFunc}
							accessibilityLabel={backButtonTitle}
							>{backButtonTitle}
						</Button>
                : null}

                { false && !this.props.rejectNonContacts && ! this.props.selectedContact?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
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
                {this.props.firstSyncPending ?
                    <View
                        key={'syncing-' + _navRemountKey}
                        // marginRight: 10 mirrors the bell's marginLeft: 10
                        // so the spinner→search gap matches the search→bell
                        // gap exactly.
                        style={{width: 40, height: 40, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent'}}
                    >
                        {/* Use Paper's ActivityIndicator (not RN's) so iOS
                            renders the same circular Material spinner as
                            Android instead of UIKit's eight-spoke
                            asterisk. Paper accepts a numeric size on
                            both platforms, so we can use one value.
                            Diameter is bumped above the adjacent 18px
                            icon glyphs because a hollow circular spinner
                            reads visually smaller than a solid glyph at
                            the same pixel size. The parent View (40x40,
                            alignItems/justifyContent center) handles
                            centering. */}
                        <PaperActivityIndicator
                            size={26}
                            color="#2196F3"
                            animating={true}
                        />
                    </View>
                : null}

                {/* Search icon (search messages within the open chat, OR
                    search contacts on the list view). Hidden while a call
                    is active so the navbar stays uncluttered for the
                    pulsing "Back to call" indicator — the user is in a
                    transient mid-call mode and search is a low-priority
                    affordance there. Same pattern as the existing
                    cover-display hide for the search-messages variant. */}
                {this.props.inCall ? null :
                 this.props.selectedContact ?
                    // Hide the "search messages" icon on the cover display —
                    // the NavBar is too cramped to also host a search UI there.
                    (this.props.isFolded ? null :
                    <IconButton
                        key={'search-msg-' + _navRemountKey}
                        style={[styles.whiteButton ]}
                        size={18}
                        disabled={false}
                        onPress={this.props.toggleSearchMessages}
                        icon={searchIcon}
                    />)
                :
				<IconButton
                    key={'search-contacts-' + _navRemountKey}
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleSearchContacts}
                    icon={searchIcon}
                />

                }

               { (!this.props.selectedContact && !this.props.searchContacts && false) ?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.conferenceCall}
                    icon="account-group"
                />
                : null}

               {/* Hide the DND bell while the pulsing active-location
                   indicator is showing in this same NavBar slot area.
                   In the no-selected-contact view both icons sit next to
                   each other and the pulse needs to be the dominant
                   signal — an equally-sized static bell right beside it
                   dilutes the urgency of "you are broadcasting live
                   location". The pulse's visibility logic mirrors the
                   IIFE below: shown whenever there's at least one active
                   share AND we're not already in the chat for that
                   single share (when there's no selectedContact, the
                   "same chat" case is impossible, so count>0 suffices
                   for this branch). */}
               {/* Hide the DND bell during an active call too — same
                   reasoning as the location-share branch above: the
                   pulsing back-to-call icon needs to be the dominant
                   signal in this slot. A static bell right next to it
                   would dilute the "tap me to return" urgency and
                   add navbar clutter while audio is flowing. */}
               { (!this.props.selectedContact && !this.props.searchContacts
                  && !this.props.callActive
                  && Object.keys(this.state.activeLocationShares || {}).length === 0) ?
                <IconButton
                    key={'bell-' + _navRemountKey}
                    style={[bellStyle, {marginLeft: 10}]}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleDnd}
                    icon={bellIcon}
                />
                : null}

 
                {statusColor == 'greenXXX' ?
                    <Icon name={statusIcon} size={20} color={statusColor} />
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
                            size={18}
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
                                size={18}
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

                { this.props.selectedContact ?
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

                        {/* Location group — bracketed by Dividers ABOVE
                            and BELOW so all three location-related
                            entries (Share, Request, Policy) read as a
                            single grouped section in the kebab. Both
                            Dividers always render because the policy
                            item itself always renders. Share / Request
                            items above the policy entry are still
                            gated on contact-state predicates (key
                            present, bidirectional chat, not blocked,
                            etc.); when those predicates fail the
                            section collapses to just the policy entry
                            sitting between the same two Dividers. */}
                        {(() => {
                            const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                            const sharing = !!(_uri && this.state.activeLocationShares[_uri]);
                            const hasContactKey = !!(
                                this.props.selectedContact &&
                                this.props.selectedContact.publicKey
                            );
                            const bidir = this._hasBidirectionalChat(_uri);
                            // Same gating predicates that previously
                            // returned null for the whole section — now
                            // gate ONLY the share / request items.
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
                            // Policy item visibility:
                            //   • Android only — the in-app Prominent
                            //     Disclosure is a Google Play
                            //     requirement; iOS uses CoreLocation's
                            //     usage-string flow at the OS level
                            //     and the panel doesn't apply there.
                            //   • shareItemsVisible  → show (the user can
                            //     tap Share / Request right above and
                            //     should be able to read the policy or
                            //     opt out alongside it)
                            //   • locationDisclosureAcknowledged → show
                            //     (the user has previously consented;
                            //     keep the entry available everywhere
                            //     so they can revisit / opt out at any
                            //     time)
                            //   • neither → hide. A user who has never
                            //     consented and is in a chat where
                            //     sharing isn't surfaced has no use
                            //     for the policy entry on its own.
                            const policyItemVisible = Platform.OS === 'android'
                                && (shareItemsVisible
                                    || this.state.locationDisclosureAcknowledged);
                            // If neither share/request nor policy
                            // would render, the whole location section
                            // collapses (no orphaned dividers).
                            if (!shareItemsVisible && !policyItemVisible) return null;
                            return (
                                <React.Fragment>
                                    <Divider />
                                    {shareItemsVisible ? (
                                        <React.Fragment>
                                            <Menu.Item
                                                onPress={() => this.handleMenu('shareLocation')}
                                                icon={sharing ? "map-marker-off" : "map-marker"}
                                                title={sharing ? "Stop sharing location" : "Share location..."}
                                            />
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
                                        </React.Fragment>
                                    ) : null}
                                    {/* Policy item — visible when share
                                        items are shown above OR when the
                                        user has previously opted in
                                        (state.locationDisclosureAcknowledged).
                                        Modal adapts to current consent
                                        state: [Not now]/[I agree] before
                                        agreement, [Close]/[Opt out] after. */}
                                    {policyItemVisible ? (
                                        <Menu.Item
                                            onPress={() => this.handleMenu('viewLocationDisclosure')}
                                            icon="shield-account"
                                            title="Location privacy policy..."
                                        />
                                    ) : null}
                                    <Divider />
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

						{!isConference && !this.props.searchMessages && this.props.publicKey ?
                        <Divider />
                        : null}

                        { this.props.devMode ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/>: null}

                        {!isConference && !this.props.searchMessages && this.props.publicKey && !(this.props.isFolded && this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

                        {!isConference && !this.props.searchMessages && this.hasMessages && tags.indexOf('test') === -1 && !isConference && !this.myself && !isAnonymous?
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}
 
                        {!this.myself && !this.props.searchMessages && !isAnonymous && tags.indexOf('blocked') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}

                        {!isAnonymous && !isConference && !this.myself && !this.props.searchMessages && tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1 && !this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Divider />
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoAnswer')} title={autoAnswerTitle}/>
                        : null}

                        {!this.props.inCall && tags.indexOf('test') === -1 && !isFavorite?
                        <Divider />
                        : null}

                        {!this.props.inCall && !isFavorite?
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
                            <Appbar.Action
                                ref={this.menuRef}
                                color="white"
                                icon="menu"
                                style={this.props.isFolded ? {marginLeft: 12} : null}
                                onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                            />
                        }
                    >
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }

                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('scanQr')} icon="qr-code" title="Scan QR code..." />
                         : null }

                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
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

                        {false ? <Menu.Item onPress={() => this.handleMenu('checkUpdate')} icon="update" title={updateTitle} /> :null}
                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        </View>
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('proximity')} icon={proximityIcon} title={proximityTitle} />


                        {!this.props.inCall ?
                        <Divider />
                         : null }

                       {!this.props.syncConversations && !this.props.inCall && !(this.props.isFolded && !this.props.selectedContact)  ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}
 
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

                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('appSettings')} icon="policy-alert" title="Permissions"/>
                         : null }

                        {!(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="file" title="Logs" />
                        : null}

                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk"/> : null}
                        {!this.props.inCall && !(this.props.isFolded && !this.props.selectedContact) ?
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
                    </Menu>
                    }

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    appStoreVersion={this.props.appStoreVersion}
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
					chatSounds={this.props.chatSounds}
 				    toggleChatSounds={this.props.toggleChatSounds}
					readReceipts={this.props.readReceipts}
 				    toggleReadReceipts={this.props.toggleReadReceipts}
 				    storageUsage={this.props.storageUsage}
 				    deleteAccountUrl={this.props.deleteAccountUrl}
 				    openDeleteAccount={this.openDeleteAccountModal}
                />

                <DeleteAccountModal
                    show={this.state.showDeleteAccountModal}
                    close={this.closeDeleteAccountModal}
                    onConfirm={this.confirmDeleteAccount}
                    accountId={this.props.accountId}
                />

                { this.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    close={this.closeEditConferenceModal}
                    room={this.props.selectedContact ? this.props.selectedContact.uri.split('@')[0]: ''}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName}
                    participants={this.props.selectedContact ? this.props.selectedContact.participants : []}
                    selectedContact={this.props.selectedContact}
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
                />

                <ShareLocationModal
                    show={this.state.showShareLocationModal}
                    close={this.hideShareLocationModal}
                    onConfirm={this.onShareLocationConfirmed}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : null}
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
        );
    }
}

NavigationBar.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    logout             : PropTypes.func.isRequired,
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
    appStoreVersion : PropTypes.object,
    checkVersionFunc: PropTypes.func,
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
