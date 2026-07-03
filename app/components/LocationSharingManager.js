// LocationSharingManager.js
//
// The live-location-sharing engine, extracted wholesale from
// NavigationBar.js. Owns the imperative machinery for caregiver / meet-up
// location shares: starting and stopping sessions, the per-tick GPS →
// metadata pipeline, the OS-permission and Google-Play "prominent
// disclosure" gates, "until I return" / destination-arrival auto-stop,
// pause/resume, peer-location requests, and meeting-session teardown.
//
// State lives on the host (NavigationBar) — locationTimers, the
// activeLocationShares mirror, the pending-permission-share map, the
// repeat-interval / until-return thresholds — and is reached through the
// injected `host` reference (this.host.locationTimers, this.host.props,
// this.host.setState, this.host.forceUpdate, the pulse-animation helpers,
// and the SQL persistence pair _persistActiveShares /
// _loadAndResumeActiveShares which remain on the component). The debug
// convergence simulator is reached through `this.sim`. This `host` seam is
// the single coupling point; a future React hook/context can supply the
// same surface in place of the class instance.
//
// NavigationBar keeps one-line delegating stubs for every public method
// here so render(), handleMenu, the lifecycle hooks, and app.js (via the
// navBar ref) call sites are unchanged.

import autoBind from 'auto-bind';
import { Alert, AppState, Linking, Platform, PermissionsAndroid, NativeModules } from 'react-native';
import BackgroundTimer from 'react-native-background-timer';
import uuid from 'react-native-uuid';
import utils from '../utils';
import { openSettings, check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import {
    readAcknowledged as readLocationDisclosure,
    setAcknowledged as setLocationDisclosure,
    clearAcknowledged as clearLocationDisclosure,
} from './locationDisclosure';
import { haversineMeters, dummyOriginPoint, pickMeetingDestinationKmOnLand } from './geoUtils';
import { ENABLE_MEET_SIMULATION } from './LocationSimulator';

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
// process promoted while a location share is active. Guarded so iOS and
// dev-time stripped builds don't explode if the module isn't registered.
const LocationForegroundServiceModule =
    Platform.OS === 'android'
        ? (NativeModules && NativeModules.LocationForegroundServiceModule) || null
        : null;

export default class LocationSharingManager {
    constructor(host) {
        // The NavigationBar instance. The engine reads/writes its
        // location state and props through this reference.
        this.host = host;
        // The LocationSimulator instance; assigned by NavigationBar right
        // after construction (the engine and simulator reference each
        // other, so the wiring is completed post-construction).
        this.sim = null;
        // Bind prototype methods so bare references passed to timers /
        // native callbacks keep the right `this` (mirrors the component's
        // autoBind). Arrow class-property methods are already bound.
        autoBind(this);
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
        this.host.setState({showShareLocationModal: true});

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
        this.host.setState({previewUserLocation: null});
        try {
            utils.timestampedLog('[location] preview: requesting current location for share modal');
            this.getCurrentCoordinates().then((coords) => {
                if (this.host._unmounted) {
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
                if (!this.host.state.showShareLocationModal) {
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
                this.host.setState({previewUserLocation: {
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
        this.host.setState({
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
            this.host.setState({
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
            this.host.setState({
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
            const _isStale = () => this.host.state.pendingShareDestinationUrl !== _kickedOffFor;
            // Resolve via HTTP only. utils.resolveShortLocationUrl already
            // (a) follows HTTP redirects (response.url) for
            // `maps.app.goo.gl/<id>` and `maps.google.com/?q=lat,lng` style
            // URLs, and (b) scans the returned HTML body for embedded coords.
            // The previous headless-WebView fallback (for the residual
            // pure-JS-redirect case) was removed: instantiating
            // react-native-webview spins up Chromium's process-global
            // NetworkChangeNotifier, which issues a synchronous
            // ConnectivityManager.getNetworkInfo() on the UI thread on every
            // network-capabilities change — a main-thread freeze tripwire when
            // the platform connectivity service stalls (ANR 2026-06-09). When
            // HTTP resolve yields no coords we now go straight to the
            // address-geocode fallback on the original URL.
            utils.resolveShortLocationUrl(link.url)
                .then((coords) => {
                    if (_isStale()) return;
                    if (coords) {
                        utils.timestampedLog('[location] meetMeAt: short URL resolved (HTTP) →',
                            coords.latitude.toFixed(5), ',', coords.longitude.toFixed(5));
                        this.host.setState({
                            pendingShareDestination: coords,
                            pendingShareDestinationStatus: 'resolved',
                        });
                        return;
                    }
                    // No inline coords from the HTTP resolve. Last-resort
                    // fallback: many "share place by name" URLs carry an
                    // address in `?q=` (e.g.
                    // `maps.google.com/?q=Atic+Millennium,...`) — geocode that
                    // via Nominatim. Run it against the original link URL.
                    const _addr = utils.extractQueryAddress(link.url);
                    if (_addr) {
                        utils.timestampedLog('[location] meetMeAt: HTTP resolve had no coords — geocoding ?q= address',
                            JSON.stringify(_addr));
                        return utils.geocodeAddress(_addr).then((coords2) => {
                            if (_isStale()) return;
                            if (coords2) {
                                utils.timestampedLog('[location] meetMeAt: geocode resolved →',
                                    coords2.latitude.toFixed(5), ',', coords2.longitude.toFixed(5));
                                this.host.setState({
                                    pendingShareDestination: coords2,
                                    pendingShareDestinationStatus: 'resolved',
                                });
                            } else {
                                utils.timestampedLog('[location] meetMeAt: geocode had no match for',
                                    JSON.stringify(_addr));
                                this.host.setState({pendingShareDestinationStatus: 'failed'});
                            }
                        });
                    }
                    utils.timestampedLog('[location] meetMeAt: HTTP resolve had no coords + no q= address —',
                        link.url);
                    this.host.setState({pendingShareDestinationStatus: 'failed'});
                })
                .catch((err) => {
                    if (_isStale()) return;
                    utils.timestampedLog('[location] meetMeAt: resolve chain failed',
                        err && err.message ? err.message : err);
                    this.host.setState({pendingShareDestinationStatus: 'failed'});
                });
            return;
        }
        console.log('[location] meetMeAt: unknown link type', link);
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
        const _accountId = this.host.props.accountId;
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
            this.host.setState({
                locationDisclosurePending: {
                    onContinue: async () => {
                        await setLocationDisclosure(_accountId);
                        utils.timestampedLog(
                            '[location] user accepted privacy policy via share-flow gate — disclosure flag set for',
                            _accountId);
                        this.host.setState({
                            locationDisclosurePending: null,
                            locationDisclosureAcknowledged: true,
                        });
                        resolve(true);
                    },
                    onCancel: () => {
                        utils.timestampedLog(
                            '[location] user cancelled privacy policy at share-flow gate — share aborted for',
                            _accountId);
                        this.host.setState({locationDisclosurePending: null});
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
            const accountId = this.host.props.accountId;
            const read = this.host.props.readAppStateNamespace;
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
            if (this.host.state.shareDisclaimerSuppressed !== suppressed) {
                this.host.setState({shareDisclaimerSuppressed: suppressed});
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
            const accountId = this.host.props.accountId;
            const read = this.host.props.readAppStateNamespace;
            const write = this.host.props.writeAppStateNamespace;
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
            this.host.setState({shareDisclaimerSuppressed: true});
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
            const accountId = this.host.props.accountId;
            const read = this.host.props.readAppStateNamespace;
            const write = this.host.props.writeAppStateNamespace;
            if (!accountId
                    || typeof read !== 'function'
                    || typeof write !== 'function') return;
            const location = await read(accountId, 'location');
            if (location.disclaimerSuppressed) {
                delete location.disclaimerSuppressed;
                await write(accountId, 'location', location);
            }
            this.host.setState({shareDisclaimerSuppressed: false});
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
        if (!this.host._pendingPermissionShares) {
            this.host._pendingPermissionShares = {};
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
        this.host._pendingPermissionShares[uri] = {
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
        if (this.host._pendingPermissionShares
                && this.host._pendingPermissionShares[uri]) {
            delete this.host._pendingPermissionShares[uri];
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
        if (!this.host._pendingPermissionShares) return;
        const uris = Object.keys(this.host._pendingPermissionShares);
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
            const pending = this.host._pendingPermissionShares[uri];
            if (!pending) continue;
            // Drop expired meet-accept retries — pointless to start
            // a share whose request has aged out.
            if (typeof pending.expiresAt === 'number'
                    && pending.expiresAt <= Date.now()) {
                utils.timestampedLog(
                    '[location] permission-retry: dropping expired pending for', uri
                );
                delete this.host._pendingPermissionShares[uri];
                continue;
            }
            // Defensive: someone may have started a share for this
            // uri via a different path while we were waiting. Don't
            // double-start.
            if (this.host.locationTimers[uri]) {
                delete this.host._pendingPermissionShares[uri];
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
            delete this.host._pendingPermissionShares[uri];
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
                    this._logFixProvenance('getCurrentPosition', null, position);
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

    // Log the PROVENANCE of a raw geolocation fix so we can tell whether
    // a stalled track is a real GPS fix that isn't moving, a coarse
    // wifi/cell fix that can't see movement, or a mock/fake location.
    //
    // @react-native-community/geolocation does NOT expose the Android
    // provider string ("gps"/"network"/"fused") — that would need a
    // native module change. But the raw position object carries several
    // fields we normally discard that, together, fingerprint the source:
    //   • mocked / isFromMockProvider — a fake-GPS app or dev-options
    //     "set location" is feeding a fixed coordinate (Android only).
    //   • accuracy — GPS/fused-with-GNSS is typically <= ~20 m; a pure
    //     wifi/cell fix is coarser (~50-2000 m).
    //   • altitude / altitudeAccuracy — real GNSS reports an altitude;
    //     network/wifi fixes usually report null / 0.
    //   • speed / heading — populated by GNSS while moving; null or -1
    //     on network fixes and on a stationary device.
    // The inferred label is a heuristic, not ground truth — the raw
    // fields next to it are what to actually read.
    _logFixProvenance(tag, uri, position) {
        try {
            const c = (position && position.coords) ? position.coords : {};
            const mocked = (position && position.mocked)
                || c.mocked || c.isFromMockProvider || false;
            const acc = (typeof c.accuracy === 'number') ? c.accuracy : null;
            const alt = (typeof c.altitude === 'number') ? c.altitude : null;
            const altAcc = (typeof c.altitudeAccuracy === 'number') ? c.altitudeAccuracy : null;
            const speed = (typeof c.speed === 'number') ? c.speed : null;
            const heading = (typeof c.heading === 'number') ? c.heading : null;
            // Heuristic source label.
            let source;
            if (mocked) {
                source = 'MOCK';
            } else if (alt != null && (acc == null || acc <= 25)) {
                // Has altitude + tight accuracy -> satellite-backed.
                source = 'gps/fused-gnss';
            } else if (acc != null && acc > 50) {
                source = 'network/wifi-coarse';
            } else if (alt == null) {
                // No altitude but okay accuracy -> likely fused/network.
                source = 'network/fused-no-altitude';
            } else {
                source = 'unknown';
            }
            const age = (position && typeof position.timestamp === 'number')
                ? (Date.now() - position.timestamp) : null;
            utils.timestampedLog(
                `[location] [fix-source] ${tag} <- ${uri || '?'}`,
                'source=' + source,
                'mocked=' + (mocked ? 'YES' : 'no'),
                'accuracy=' + (acc != null ? acc.toFixed(1) + 'm' : '?'),
                'altitude=' + (alt != null ? alt.toFixed(1) + 'm' : 'null'),
                'altAccuracy=' + (altAcc != null ? altAcc.toFixed(1) + 'm' : 'null'),
                'speed=' + (speed != null ? speed.toFixed(2) + 'm/s' : 'null'),
                'heading=' + (heading != null ? heading.toFixed(0) : 'null'),
                'fixAgeMs=' + (age != null ? age : '?'),
                'lat=' + (typeof c.latitude === 'number' ? c.latitude.toFixed(6) : '?'),
                'lng=' + (typeof c.longitude === 'number' ? c.longitude.toFixed(6) : '?')
            );
        } catch (e) { /* logging must never throw */ }
    }

    // Build and send a single "location" metadata message for the given
    // contact URI with the supplied coordinate + expiration timestamp.
    // `originMetadataId` is null for the very first tick of a session
    // (that first tick becomes the "origin" message the receiver renders).
    // Every subsequent tick carries metadataId = origin's _id so the
    // receiver can find the bubble to update in place.
    sendLocationMetadata(uri, coords, expiresAt, originMetadataId = null, extras = {}) {
        if (!this.host.props.sendMessage) {
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
        const _pausedEntry = this.host.locationTimers && this.host.locationTimers[uri];
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
        const entryAtSend = this.host.locationTimers && this.host.locationTimers[uri];
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
            const _entry = this.host.locationTimers && this.host.locationTimers[uri];
            const r = _entry && Number(_entry.excludeOriginRadiusMeters);
            if (r && r > 0) {
                metadataContent.privacyDeferredRadiusMeters = r;
            }
        }
        // Dummy-origin tick: a privacy-radius meet invite with NO shared
        // destination has no real point it's willing to disclose, so the
        // `value` coords above are a throwaway point generated a few km
        // from the inviter's actual position (see startLocationSharing).
        // The flag tells the receiver this point is fake — render no pin
        // for it (the privacyDeferred path already suppresses the inviter
        // pin; this is belt-and-suspenders and lets the bubble pick a
        // sane empty-map centre). The dummy exists ONLY so the origin
        // bubble persists with valid coords: that keeps the origin/update
        // chain intact so the inviter's REAL position renders the moment
        // they cross the perimeter (the first real tick overwrites the
        // dummy in place). Cleared on that first real-coord tick.
        if (extras.dummy) {
            metadataContent.dummy = true;
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

        this.host.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');

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
            try { this.host._persistActiveShares(); } catch (e) { /* noop */ }
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
        const liveEntry = this.host.locationTimers && this.host.locationTimers[uri];
        let distFromOriginStr = '';
        if (liveEntry
                && liveEntry.untilReturnOrigin
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            const o = liveEntry.untilReturnOrigin;
            if (typeof o.latitude === 'number' && typeof o.longitude === 'number') {
                const d = haversineMeters(o, coords);
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
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
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
                    + `— share will auto-stop when you return after moving ≥${this.host.UNTIL_RETURN_DEPARTURE_M} m away`
                );
            } catch (e) { /* noop */ }
            return;
        }
        const distance = haversineMeters(entry.untilReturnOrigin, {
            latitude: coords.latitude,
            longitude: coords.longitude,
        });
        if (!Number.isFinite(distance)) return;
        if (!entry.untilReturnDeparted) {
            // Phase 1: waiting for the user to physically leave the
            // origin neighbourhood. Until they do, every tick stays
            // "near home" and we don't terminate the share.
            if (distance > this.host.UNTIL_RETURN_DEPARTURE_M) {
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
        if (distance <= this.host.UNTIL_RETURN_RETURN_M) {
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
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
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
        const dist = haversineMeters(coords, dest);
        if (!Number.isFinite(dist)) return;
        const DEST_ARRIVAL_THRESHOLD_M = 30;
        if (dist > DEST_ARRIVAL_THRESHOLD_M) return;

        entry.destinationArrivalFired = true;

        const myDisplayName = this.host.props.myDisplayName || 'I';

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
        if (typeof this.host.props.sendMessage === 'function') {
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
                this.host.props.sendMessage(uri, textMessage);
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
            const entryNow = this.host.locationTimers && this.host.locationTimers[uri];
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
            const coords = this.sim.effectiveCoordinatesForSession(uri, realCoords);
            if (!this._shouldSendUpdateTick(uri, coords)) {
                // Privacy radius is hiding the tick from the wire —
                // refresh the LOCAL bubble's owner pin so the user
                // sees themselves move on their own map.
                const _curEntry = this.host.locationTimers && this.host.locationTimers[uri];
                if (_curEntry && _curEntry.privacyDeferred
                        && _curEntry.privacyDeferredBubbleMid
                        && typeof this.host.props.setLocalOwnerCoordsForBubble === 'function') {
                    this.host.props.setLocalOwnerCoordsForBubble(
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
        const entry = this.host.locationTimers[uri];
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
        const meters = haversineMeters(entry.originPoint, {latitude: lat, longitude: lng});
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
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
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
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
        if (!entry) return false;
        if (originMetadataId && entry.originMetadataId !== originMetadataId) return false;
        if (entry.paused) return true;
        entry.paused = true;
        try { this.host._persistActiveShares(); } catch (e) { /* noop */ }
        // Stop the NavBar icon's breathing animation when no shares
        // are actively ticking. Pause means no metadata is leaving the
        // device, and the pulse is meant to communicate "the device is
        // sending updates" — keeping it on while nothing's flowing
        // would be misleading. Only stop if every share is paused
        // (multi-share users may have paused one but the other is
        // still ticking) AND there's no active call (the pulse also
        // signals the in-call icon).
        try {
            const _anyUnpaused = Object.values(this.host.locationTimers || {})
                .some(e => e && !e.paused);
            if (!_anyUnpaused && !this.host.props.callActive) {
                this.host._stopActiveSharePulse();
            }
        } catch (e) { /* noop */ }
        // Force a re-render so any UI gated on pause state (the
        // chat-header Pause/Resume Menu.Item we added earlier) flips
        // to its new label/icon.
        this.host.forceUpdate();
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
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
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
        try { this.host._persistActiveShares(); } catch (e) { /* noop */ }
        // Re-arm the NavBar pulse — ticks are flowing again so the
        // breathing animation should communicate that. Symmetric to
        // the stop in pauseLocationSharing.
        try { this.host._startActiveSharePulse(); } catch (e) { /* noop */ }
        // Force a re-render so the chat-header Menu.Item flips back
        // from "Resume sharing" to "Pause sharing".
        this.host.forceUpdate();
        utils.timestampedLog('[location] resumed share for', uri,
            'origin=', entry.originMetadataId);
        return true;
    }

    // Read the live state of a share for menu / UI purposes:
    //   'active'   — entry exists, not paused
    //   'paused'   — entry exists, paused
    //   'stopped'  — no entry (share was torn down)
    getLocationShareState(uri, originMetadataId) {
        const entry = this.host.locationTimers && this.host.locationTimers[uri];
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
                    'allTimerKeys=', this.host.locationTimers ? Object.keys(this.host.locationTimers) : '(none)');
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
        if (!this.host._shareStateLogStamps) this.host._shareStateLogStamps = {};
        const key = `${uri}|${originMetadataId || ''}|${reason}`;
        const now = Date.now();
        const last = this.host._shareStateLogStamps[key] || 0;
        if (now - last < 5000) return false;
        this.host._shareStateLogStamps[key] = now;
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
        const uris = Object.keys(this.host.locationTimers || {});
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
        this.host._pendingPermissionShares = {};
        // Defensive: ensure the pulse animation isn't left running
        // against an empty share map. _stopActiveSharePulse is a no-op
        // when no animation is armed.
        try { this.host._stopActiveSharePulse(); } catch (e) { /* noop */ }
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
        if (!this.host._pendingStops) this.host._pendingStops = new Set();
        if (this.host._pendingStops.has(uri)) return;
        this.host._pendingStops.add(uri);

        // If a permission-deferred share intent is parked for this
        // peer, drop it. stopLocationSharing means the user wants
        // sharing to stop — we shouldn't auto-resume a parked intent
        // on next foreground after that.
        if (this.host._pendingPermissionShares
                && this.host._pendingPermissionShares[uri]) {
            delete this.host._pendingPermissionShares[uri];
            utils.timestampedLog(
                '[location] permission-retry dropped — stopLocationSharing called for', uri,
                'reason=', reason
            );
        }

        const wasActive = !!this.host.locationTimers[uri]
            || this.host.state.activeLocationShares[uri] !== undefined;

        const entry = this.host.locationTimers[uri];

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
        delete this.host.locationTimers[uri];
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
            this.host._persistActiveShares();
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
                if (typeof this.host.props.forceFlushAppState === 'function'
                        && this.host.props.accountId) {
                    Promise.resolve()
                        .then(() => this.host.props.forceFlushAppState(this.host.props.accountId))
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
            && Object.keys(this.host.locationTimers).length === 0) {
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
        if (this.host._unmounted) return;
        if (this.host.state.activeLocationShares[uri] !== undefined) {
            const next = {...this.host.state.activeLocationShares};
            delete next[uri];
            this.host.setState({activeLocationShares: next});
        }

        // Drop a system note into the chat timeline so the user has a
        // visible record that sharing ended. Persisted via saveSystemMessage
        // (SQL INSERT with system=1) so it survives a reload. Skipped when
        // we weren't actually sharing (idempotent callers) or when the
        // caller explicitly asked for silence.
        if (!silent && wasActive && typeof this.host.props.saveSystemMessage === 'function') {
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
                typeof this.host.props.isMeetingSessionAccepted === 'function'
                && this.host.props.isMeetingSessionAccepted(sessionId)
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
            this.host.props.saveSystemMessage(uri, note, 'outgoing');
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
            && typeof this.host.props.deleteMessage === 'function') {
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
                    this.host.props.deleteMessage(legId, uri, true);
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

        this.host._pendingStops.delete(uri);
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
        // this.host.locationTimers and we don't want to skip entries mid-iter.
        Object.keys(this.host.locationTimers).forEach((uri) => {
            const entry = this.host.locationTimers[uri];
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
        if (!this.host.props.sendMessage) {
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
            this.host.props.sendMessage(uri, msg, 'application/sylk-message-metadata');
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
        Object.keys(this.host.locationTimers).forEach((uri) => {
            const entry = this.host.locationTimers[uri];
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
        if (!this.host._startingShares) {
            this.host._startingShares = new Set();
        }
        if (this.host._startingShares.has(uri) || this.host.locationTimers[uri]) {
            utils.timestampedLog('[location] startLocationSharing: ignoring duplicate — share already active or in-flight for', uri);
            return;
        }
        this.host._startingShares.add(uri);
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
                this.host._startingShares.delete(uri);
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
        const hadActiveShareForUri = this.host.state.activeLocationShares[uri] !== undefined;
        if (!hadActiveShareForUri) {
            this.host.setState({
                activeLocationShares: {
                    ...this.host.state.activeLocationShares,
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
        if (this.host.props.sendMessage && !opts.suppressAnnouncement) {
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
            this.host.props.sendMessage(uri, textMessage);
        }

        // Single place to unwind the optimistic UI state + invitation
        // message if the permission chain denies us. Must be safe to
        // call multiple times — several early-return branches below
        // all funnel through this.
        const rollbackOptimistic = () => {
            if (!hadActiveShareForUri
                && this.host.state.activeLocationShares[uri] !== undefined
                && !this.host.locationTimers[uri]) {
                const next = {...this.host.state.activeLocationShares};
                delete next[uri];
                this.host.setState({activeLocationShares: next});
            }
            if (announcementMessageId
                && typeof this.host.props.deleteMessage === 'function') {
                try {
                    // Local-only removal (third arg true) — no peer
                    // echo needed because we want to undo a UI message
                    // that never should have shipped, not record a
                    // deletion of a real-message history.
                    this.host.props.deleteMessage(announcementMessageId, uri, true);
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
        if (hadActiveShareForUri && this.host.locationTimers[uri]) {
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
                if (!this.host.locationTimers[uri]) {
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
                    const dest = await pickMeetingDestinationKmOnLand(coords, 4);
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
                const entryNow = this.host.locationTimers[uri];
                if (ENABLE_MEET_SIMULATION
                        && kind === 'meetingAccept'
                        && entryNow
                        && !entryNow.simulatedPosition) {
                    const synthetic = await pickMeetingDestinationKmOnLand(coords, 10);
                    if (synthetic) {
                        // Re-fetch entry — the await opened a window
                        // for the share to be torn down underneath us.
                        const entryAfter = this.host.locationTimers[uri];
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
                        const entryAfter = this.host.locationTimers[uri];
                        if (entryAfter) {
                            entryAfter.awaitingSimulatedPosition = false;
                        }
                    }
                }
                // Re-check the timer entry — both awaits above could
                // have spanned a tear-down window.
                if (!this.host.locationTimers[uri]) {
                    return;
                }
                // From here on, the first update tick reports the
                // synthetic position when simulation is in play.
                // Otherwise it reports the real GPS fix as before.
                const effective = this.sim.effectiveCoordinatesForSession(uri, coords);
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
                    const liveEntryRef0 = this.host.locationTimers && this.host.locationTimers[uri];
                    const dest = tickExtras && tickExtras.destination;
                    const _hasDest = !!(dest
                            && typeof dest.latitude === 'number'
                            && typeof dest.longitude === 'number');
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
                    //
                    // The destination is no longer required for the INVITER.
                    // When the inviter sets a privacy radius but picks no
                    // meeting point (the common "Meet up" case — the modal
                    // never collects a destination), we still ship a
                    // bootstrap tick so the receiver's accept modal appears.
                    // With a destination it ships as the value stand-in
                    // (existing behaviour); without one we ship a DUMMY
                    // stand-in: a throwaway point a few km from the
                    // inviter's real position (see _dummyOriginPoint below),
                    // flagged dummy:true so neither end renders a pin for
                    // it. The dummy's whole purpose is to give the origin
                    // bubble VALID coords so it persists in SQL on both
                    // devices — which keeps the origin/update chain intact,
                    // so the moment the inviter crosses the perimeter their
                    // first REAL tick overwrites the dummy in place and the
                    // live position renders (the rendezvous converges).
                    //
                    // The ACCEPTER path is deliberately UNCHANGED: it still
                    // requires a destination to fire here, exactly as before,
                    // so this fix touches only the inviter's no-destination
                    // case (the reported bug).
                    if ((kind === 'meetingRequest'
                                || (kind === 'meetingAccept' && _hasDest))
                            && liveEntryRef0
                            && !liveEntryRef0.privacyDeferredOriginSent) {
                        liveEntryRef0.privacyDeferredOriginSent = true;
                        liveEntryRef0.privacyDeferred = true;
                        // Resume guard for the DUMMY case. On an app-restart
                        // / resume the origin bubble already exists on both
                        // devices — carrying either the original dummy or, if
                        // the inviter had already crossed their perimeter, a
                        // real position — and its id is restored here via
                        // opts.resumeOriginMetadataId. Minting + sending a
                        // FRESH dummy now would be doubly wrong: it would
                        // jitter the empty map to a new random spot on every
                        // restart, and it could overwrite a real position that
                        // was already revealed before the restart. So for the
                        // dummy case we skip the (re)send on resume entirely
                        // and let the restored origin stand. The localOwner-
                        // Coords stamp below still runs (so the inviter keeps
                        // seeing their own pin), and real ticks resume in place
                        // the moment they're past the perimeter. The
                        // destination case is deterministic, so it keeps its
                        // existing resume behaviour.
                        const _skipDummyOnResume = !_hasDest
                            && !!opts.resumeOriginMetadataId;
                        // Stand-in coords for the origin bubble. Real
                        // destination if the share has one; otherwise a
                        // dummy point ~4–7 km from the inviter's actual
                        // position at a random bearing. The offset is large
                        // enough that the dummy never doubles as a usable
                        // approximation of where the inviter is, and the
                        // dummy:true flag means it's never rendered or
                        // paired as a real position anyway. Not generated at
                        // all when we're skipping the send on resume.
                        const _standIn = _hasDest
                            ? {latitude: dest.latitude, longitude: dest.longitude}
                            : (_skipDummyOnResume ? null : dummyOriginPoint(effective));
                        let _deferredMid = null;
                        try {
                            if (_skipDummyOnResume) {
                                utils.timestampedLog(
                                    '[location] privacy invite: skipping dummy origin re-send on resume —',
                                    uri, 'origin=', originMetadataId
                                );
                            } else {
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
                                    _standIn,
                                    expiresIso,
                                    originMetadataId,
                                    {...tickExtras, privacyDeferred: true, dummy: !_hasDest}
                                );
                            }
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
                            'callbackType=', typeof this.host.props.setLocalOwnerCoordsForBubble
                        );
                        if (_midForStamp
                                && typeof this.host.props.setLocalOwnerCoordsForBubble === 'function') {
                            // Run twice — once immediately, once after a
                            // tick — because handleMessageMetadata's
                            // bubble injection runs in a microtask after
                            // sendMessage. setState is idempotent so the
                            // second write is cheap when the first
                            // already succeeded.
                            this.host.props.setLocalOwnerCoordsForBubble(
                                uri, _midForStamp, effective, _radiusForStamp
                            );
                            setTimeout(() => {
                                if (typeof this.host.props.setLocalOwnerCoordsForBubble === 'function') {
                                    this.host.props.setLocalOwnerCoordsForBubble(
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
                const liveEntryRef = this.host.locationTimers && this.host.locationTimers[uri];
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
                const _initEntry = this.host.locationTimers && this.host.locationTimers[uri];
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
            this.host.locationTimers[uri] = entry;
            this.host._persistActiveShares();

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
                            const current = this.host.locationTimers[uri];
                            if (!current) {
                                return;
                            }
                            if (Date.now() >= expiresAt) {
                                this.stopLocationSharing(uri, {reason: 'expired'});
                                return;
                            }
                            const nowMs = Date.now();
                            if (nowMs - current.lastSentMs < this.host.LOCATION_REPEAT_MS) {
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
                            this._logFixProvenance('watchPosition', uri, position);
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
                            const coords = this.sim.effectiveCoordinatesForSession(uri, realCoords);
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
                                const _curEntry = this.host.locationTimers
                                    && this.host.locationTimers[uri];
                                if (_curEntry && _curEntry.privacyDeferred
                                        && _curEntry.privacyDeferredBubbleMid
                                        && typeof this.host.props.setLocalOwnerCoordsForBubble === 'function') {
                                    this.host.props.setLocalOwnerCoordsForBubble(
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
                                if (typeof this.host.props.saveSystemMessage === 'function') {
                                    this.host.props.saveSystemMessage(
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
                                    && typeof this.host.props.sendLocalNotification === 'function') {
                                    try {
                                        this.host.props.sendLocalNotification(
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
                const _entryNow = this.host.locationTimers && this.host.locationTimers[uri];
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
            }, this.host.LOCATION_REPEAT_MS);

            this.host.locationTimers[uri] = {
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
            this.host._persistActiveShares();
        }

        // Reflect the final (authoritative) expiresAt in React state.
        // The pre-permission block up top seeded activeLocationShares with
        // an optimistic expiresAt so the NavigationBar icon could start
        // pulsing at tap time; that value was computed ~milliseconds
        // earlier and is off by a tiny amount. Overwrite it now with the
        // canonical one so countdown UI and stop-timer math agree.
        this.host.setState({
            activeLocationShares: {
                ...this.host.state.activeLocationShares,
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
            && typeof this.host.props.saveSystemMessage === 'function') {
            // Wall-clock time the share began — same HH:MM format as the
            // stop note so the two bracket the sharing window visibly.
            const startedAt = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            const label = periodLabel ? ` for ${periodLabel}` : '';
            const note = `\uD83D\uDCCD Started sharing location at ${startedAt}${label}`;
            this.host.props.saveSystemMessage(uri, note, 'outgoing');
        }
      } finally {
        // Paired with the this.host._startingShares.add(uri) at function
        // entry. Always release the in-flight flag so a later (legitimate)
        // call to start a new share — after this one has either fully
        // set up or been torn down — isn't blocked by a lingering guard.
        if (this.host._startingShares) {
          this.host._startingShares.delete(uri);
        }
      }
    }

    async onShareLocationConfirmed({durationMs, periodLabel, kind, excludeOriginRadiusMeters}) {
        const uri = this.host.props.selectedContact && this.host.props.selectedContact.uri;
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
        let destination = this.host.state.pendingShareDestination;
        const pendingUrl = this.host.state.pendingShareDestinationUrl;
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
        if (!this.host.props.sendMessage) {
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
        if (typeof this.host.props.renderSystemMessage === 'function') {
            try {
                this.host.props.renderSystemMessage(
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
            if (typeof this.host.props.saveSystemMessage === 'function') {
                const at = new Date().toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                });
                this.host.props.saveSystemMessage(uri,
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
        if (!this.host.props.sendMessage) {
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
                this.host.props.sendMessage(uri, {
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
            this.host.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
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
        return !!(this.host.locationTimers && this.host.locationTimers[uri]);
    }}
