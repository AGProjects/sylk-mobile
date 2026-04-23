import React, { Component } from 'react';
import { Alert, Animated, Easing, Linking, Image, NativeModules, Platform, PermissionsAndroid, View , TouchableHighlight, Dimensions} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button } from 'react-native-paper';
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

const blinkLogo = require('../assets/images/blink-white-big.png');

import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import EditConferenceModal from './EditConferenceModal';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import GenerateKeysModal from './GenerateKeysModal';
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import DeleteHistoryModal from './DeleteHistoryModal';
import DeleteFileTransfers from './DeleteFileTransfers';
import VersionNumber from 'react-native-version-number';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import ShareLocationModal from './ShareLocationModal';
import ActiveLocationSharesModal from './ActiveLocationSharesModal';
import {openSettings, check, request, PERMISSIONS, RESULTS} from 'react-native-permissions';
import SylkAppbarContent from './SylkAppbarContent';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
import * as Progress from 'react-native-progress';

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
			showGenerateKeysModal: false,
			showExportPrivateKeyModal: false,
            privateKeyPassword: null,
			backupKey: false,
			deleteContact: false,
			showShareLocationModal: false,
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

    componentWillUnmount() {
        // Stop any running location-sharing timers so we don't leak
        // background work past the component's lifetime. Set `_unmounted`
        // first so stopLocationSharing skips its setState call.
        this._unmounted = true;
        Object.keys(this.locationTimers).forEach((uri) => {
            this.stopLocationSharing(uri, {silent: true, reason: 'unmount'});
        });
        // Kill the pulse animation so it doesn't tick against a stale
        // Animated.Value after unmount.
        this._stopActiveSharePulse();
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

		// Drive the pulsing marker indicator: start the loop on the
		// first active share, stop it when the last one ends. We key
		// off the count (not the map identity) so internal updates —
		// e.g. renewing an expiresAtMs — don't restart the animation.
		const prevCount = Object.keys(prevState.activeLocationShares || {}).length;
		const currCount = Object.keys(this.state.activeLocationShares || {}).length;
		if (prevCount === 0 && currCount > 0) {
			this._startActiveSharePulse();
		} else if (prevCount > 0 && currCount === 0) {
			this._stopActiveSharePulse();
			// If the modal was open when the last share ended, close
			// it too so the user isn't left staring at an empty list.
			if (this.state.showActiveSharesModal) {
				this.setState({showActiveSharesModal: false});
			}
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

    showShareLocationModal() {
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
                        // Safety timeout: if iOS never delivers a change
                        // (e.g. status stayed NotDetermined because the
                        // user dismissed the dialog without choosing),
                        // don't hang the sharing flow forever.
                        setTimeout(() => settle(true), 10000);
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

        // "Until we meet" handshake fields. Only stamped on the origin tick
        // of a meeting request (meeting_request:true) or on every tick of
        // an acceptance stream (in_reply_to → original request _id). See
        // ShareLocationModal.DURATION_OPTIONS and the acceptance flow in
        // app.js for how these propagate.
        if (extras.meetingRequest && !originMetadataId) {
            metadataContent.meeting_request = true;
        }
        if (extras.inReplyTo) {
            metadataContent.in_reply_to = extras.inReplyTo;
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
        return mId;
    }

    // Send one location metadata update. Fetches a fresh fix every time
    // so each tick carries the user's current position. Returns the _id
    // of the tick that was sent (so the first call can record the origin).
    async sendLocationUpdate(uri, expiresAt, originMetadataId = null, extras = {}) {
        try {
            const coords = await this.getCurrentCoordinates();
            return this.sendLocationMetadata(uri, coords, expiresAt, originMetadataId, extras);
        } catch (err) {
            console.log('sendLocationUpdate: failed to read location', err && err.message ? err.message : err);
            return null;
        }
    }

    // opts.silent — suppress the in-chat system note (used by
    //   componentWillUnmount and by the self-call inside startLocationSharing
    //   that replaces an existing share before posting its own "started" note).
    // opts.reason — 'user' | 'expired' | 'deleted' | 'replaced' | 'unmount'.
    //   Shapes the system-note body. Defaults to 'user'.
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
            let note;
            if (wasMeeting) {
                switch (reason) {
                    case 'expired':
                        // Timer ran its course — we take this as "the
                        // meeting happened" rather than a cancellation.
                        note = 'Meeting completed';
                        break;
                    case 'deleted':
                        // We (the local user) cancelled the session.
                        note = 'Meeting request cancelled';
                        break;
                    case 'requester-deleted':
                        // The remote party deleted a leg of the session —
                        // tag it so the user can tell local vs remote cancels
                        // apart in the transcript.
                        note = 'Meeting request cancelled by remote';
                        break;
                    case 'peer-stopped':
                    default:
                        // Either side tapped Stop — orderly end.
                        note = 'Meeting request stopped';
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
        const kind = opts.kind || 'fixed';
        const inReplyTo = opts.inReplyTo || null;
        const tickExtras = {
            meetingRequest: kind === 'meetingRequest',
            inReplyTo,
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
            if (!proceed) return;
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
            if (!proceed) return;
        }

        const hasPermission = await this.ensureLocationPermission();
        if (!hasPermission) {
            console.log('Location permission denied; cannot share location');
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
        // we're about to emit a fresh "started sharing" note below.
        this.stopLocationSharing(uri, {silent: true, reason: 'replaced'});

        // 1st message: a plain-text announcement of the share. Tagged via
        // metadata.locationAnnouncement so buildLastMessage can keep the
        // Contacts-list preview from being overwritten by this auto-text.
        //
        // Sent for plain timed shares AND for meetingRequest because
        // server-side push notifications only fire on text/plain traffic
        // — metadata-only payloads (sendLocationUpdate's origin tick,
        // meeting_request handshake) don't wake a backgrounded peer, so
        // without this pinger the accepter never sees the
        // MeetingRequestModal until they manually open the app.
        //
        // Skipped for meetingAccept: the requester is already awake
        // (they initiated the handshake and their app is foregrounded
        // on the acceptance modal), so no push is needed, and a
        // chat-visible line here would just be duplicate noise next to
        // the local "Meeting request accepted" system note.
        if (this.props.sendMessage && kind !== 'meetingAccept') {
            let announcementText;
            if (kind === 'meetingRequest') {
                announcementText = 'I want to meet up with you';
            } else {
                announcementText = `I am sharing the location with you for ${periodLabel}`;
            }
            const textId = uuid.v4();
            const textTs = new Date();
            const textMessage = {
                _id: textId,
                key: textId,
                createdAt: textTs,
                text: announcementText,
                metadata: {locationAnnouncement: true},
                // GiftedChat requires a `user` field on every message.
                user: {},
            };
            this.props.sendMessage(uri, textMessage);
        }

        // 2nd message (origin tick, metadataId: null) — the first metadata
        // message carrying coordinates + expiration. Its _id becomes the
        // anchor every subsequent tick points back to. For "Until we meet"
        // the origin tick carries meeting_request:true; for acceptance
        // every tick carries in_reply_to pointing at the original request.
        const originMetadataId = await this.sendLocationUpdate(uri, expiresIso, null, tickExtras);

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
                // `now` because we just sent the origin tick above — no need
                // to emit another one the instant watchPosition fires.
                lastSentMs: now,
            };
            this.locationTimers[uri] = entry;

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
                            current.lastSentMs = nowMs;
                            const c = position && position.coords ? position.coords : {};
                            const coords = {
                                latitude: c.latitude,
                                longitude: c.longitude,
                                accuracy: c.accuracy,
                                timestamp: position.timestamp,
                            };
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

            this.locationTimers[uri] = {intervalId, expiresAt, originMetadataId, inReplyTo, meetingSessionId};
        }

        // Reflect in React state so the menu renders "Stop sharing location".
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
        if (originMetadataId
            && typeof this.props.saveSystemMessage === 'function') {
            // Meeting sessions ("Until we meet") get their own vocabulary
            // — the pair started/stopped/cancelled/completed reads more
            // naturally than "sharing live location". Plain timed shares
            // keep the more literal wording with the period label.
            const isMeeting = kind === 'meetingRequest' || kind === 'meetingAccept';
            let note;
            if (isMeeting) {
                // Differentiate the two legs of the handshake:
                //   • requester: "Meeting request started"
                //   • accepter:  "Meeting request accepted"
                note = kind === 'meetingAccept'
                    ? 'Meeting request accepted'
                    : 'Meeting request started';
            } else {
                // Wall-clock time the share began — same HH:MM format
                // as the stop note so the two bracket the sharing
                // window visibly.
                const startedAt = new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                });
                const label = periodLabel ? ` for ${periodLabel}` : '';
                note = `\uD83D\uDCCD Started sharing location at ${startedAt}${label}`;
            }
            this.props.saveSystemMessage(uri, note, 'outgoing');
        }
    }

    onShareLocationConfirmed({durationMs, periodLabel, kind}) {
        const uri = this.props.selectedContact && this.props.selectedContact.uri;
        if (!uri) {
            return;
        }
        this.startLocationSharing(uri, durationMs, periodLabel, {kind});
    }

    // Public entry point used by app.js when the local user taps "Accept"
    // on an incoming meeting request. Starts a location share whose ticks
    // carry in_reply_to pointing at the original request, with the same
    // expiresAt the requester chose so both sides tear down in sync.
    startMeetingAcceptance(uri, {requestId, expiresAt, periodLabel}) {
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
            {kind: 'meetingAccept', inReplyTo: requestId, expiresAt}
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

        if (this.props.selectedContact) {
			if (isConference) {
				title = capitalizeFirstLetter(this.props.selectedContact.uri.split('@')[0]);
				subtitle = 'Conference room';
			} else {
			    if (this.props.selectedContact.name && this.props.selectedContact.name != this.props.selectedContact.uri) {
					title = this.props.selectedContact.name;
			    } else {
					title = capitalizeFirstLetter(this.props.selectedContact.uri.split('@')[0]);
			    }
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

                {this.props.selectedContact ?
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
               { (!this.props.selectedContact && !this.props.searchContacts
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

                        {tags.indexOf('blocked') === -1 && !isConference && !isAnonymous && !this.myself && this.props.canSend && this.props.canSend() ?
                        (() => {
                            const _uri = this.props.selectedContact && this.props.selectedContact.uri;
                            const sharing = !!(_uri && this.state.activeLocationShares[_uri]);
                            // Gate on the contact's PGP public key. Location
                            // metadata ships encrypted (see app.js
                            // sendMessage location-metadata branch) and there
                            // is no plaintext fallback — if we don't have the
                            // contact's key the share would land as
                            // unreadable ciphertext on the peer. When a
                            // share is already in flight we keep the menu
                            // item visible so the user can still stop it,
                            // even if the key has been removed in the
                            // meantime.
                            const hasContactKey = !!(
                                this.props.selectedContact &&
                                this.props.selectedContact.publicKey
                            );
                            if (!sharing && !hasContactKey) return null;
                            return (
                                <Menu.Item
                                    onPress={() => this.handleMenu('shareLocation')}
                                    icon={sharing ? "map-marker-off" : "map-marker"}
                                    title={sharing ? "Stop sharing location" : "Share location..."}
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
                        {(this.props.devMode && !this.props.inCall) ? <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}

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
 				    storageUsage={this.props.storageUsage}
 				    deleteAccountUrl={this.props.deleteAccountUrl}
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
