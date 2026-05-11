import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, TouchableOpacity, Dimensions } from 'react-native';
import { Text, Button, Surface, RadioButton, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';
// StaticMap is the slippy-map tile renderer used by LocationBubble.
// Reused here in meet-mode to draw the destination preview once the
// URL has resolved to coords. Lives in LocationBubble.js so the
// projection / tile cache / pin code stays in one place.
// pickZoomToFitPoints lets us seed the preview's initial zoom from
// the user-pin/destination bounding box so when both points land
// the map auto-zooms out instead of leaving the user pin offscreen
// at street-level zoom.
import { StaticMap, pickZoomToFitPoints } from './LocationBubble';

// Quick haversine-distance helper — matches the algorithm used in
// NavigationBar's _haversineMeters but kept local so the modal
// doesn't have to import a class method via a long path.
function haversineMeters(a, b) {
    if (!a || !b
            || typeof a.latitude !== 'number'
            || typeof a.longitude !== 'number'
            || typeof b.latitude !== 'number'
            || typeof b.longitude !== 'number') {
        return null;
    }
    const R = 6371008;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);
    return 2 * R * Math.asin(Math.sqrt(x));
}

// Format metres for display: "120 m" / "1.2 km" / "12 km".
function formatDistance(m) {
    if (m == null || !Number.isFinite(m)) return null;
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m / 1000)} km`;
}

// Extract the first letter of a name as initials. Falls back to '?'
// when the name is missing — same convention LocationBubble uses
// internally so the avatar visual stays consistent across maps.
function initialsFromName(name) {
    if (!name || typeof name !== 'string') return '?';
    const trimmed = name.trim();
    if (!trimmed) return '?';
    // Strip @domain on URIs like alice@example.com → "alice"
    const localPart = trimmed.split('@')[0];
    if (!localPart) return '?';
    return localPart.charAt(0).toUpperCase();
}

// Zoom bounds for the preview map. Mirrors the LocationBubble values
// so the preview's zoom feel matches the in-bubble map. CartoDB /
// OSM mirror serves up to 18 reliably; below 3 the world wraps and
// the preview becomes useless context.
const PREVIEW_MIN_ZOOM = 3;
const PREVIEW_MAX_ZOOM = 18;
const PREVIEW_DEFAULT_ZOOM = 15;

// Match EditContactModal's look (Modal + Surface with borderRadius: 10)
// so the dialog corners are subtly rounded instead of the pronounced
// curve Paper's <Dialog> uses. `modalSurface` lives in ContainerStyles.
import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Duration options presented to the user.
//   value         — duration in milliseconds (acts as the maximum cap;
//                   the share can stop earlier on its own — see
//                   'untilIReturn' below).
//   label         — what the user sees in the radio list
//   periodLabel   — what appears in the outgoing "I am sharing the
//                   location with you …" text
//   kind          — 'meetingRequest' stamps meeting_request:true on the
//                   origin tick and means "until we meet";
//                   'untilIReturn' is an auto-stop share that lapses
//                   when the user returns to their starting point
//                   (NavigationBar watches for departure-then-return);
//                   'once' is a single GPS fix; 'fixed' is a plain timed
//                   share with no handshake semantics.
//
// "Until we meet" caps at 4h so the share can't run forever if the two
// parties never actually meet — per product decision, sharing must
// eventually expire on its own, and 4h is the window we expect for a
// realistic "meet up" intent.
//
// "Until I return" caps at 8h. The intent is "I'm popping out, share
// my location with you until I'm home again" — the auto-stop kicks in
// as soon as we detect the user has come back to within
// UNTIL_RETURN_RETURN_THRESHOLD_M of where they started, but only
// after they've actually left (otherwise the share would self-stop
// the moment it began, since the first GPS fix is "at" the origin).
// 8h is a generous-but-finite ceiling for a typical "out for the day"
// excursion; if the user never returns, the share lapses on its own.
// Originally caregiver-only, now exposed to all contacts because the
// "I'll let you know I'm home" intent isn't specific to a caregiver
// relationship — anyone running an errand might want it.
const DURATION_OPTIONS = [
    // Starts immediately, runs up to 8h, auto-stops when the user
    // returns to where they started (after first moving >100m away).
    // NavigationBar implements the state machine; this entry just
    // selects that code path.
    {value: 8 * 60 * 60 * 1000,    label: 'Until I return', periodLabel: 'until I return', kind: 'untilIReturn'},
    {value: 4 * 60 * 60 * 1000,    label: 'Until we meet', periodLabel: 'until we meet', kind: 'meetingRequest'},
    // One-shot: a single GPS fix is acquired and a single location
    // message ships. No timer, no follow-up ticks, no live-update
    // semantics. Receiver renders a static "Shared location" bubble.
    {value: 0,                     label: 'Once',     periodLabel: 'now',      kind: 'once'},
    {value: 4 * 60 * 60 * 1000,    label: '4 hours',  periodLabel: '4 hours',  kind: 'fixed'},
    {value: 8 * 60 * 60 * 1000,    label: '8 hours',  periodLabel: '8 hours',  kind: 'fixed'},
    {value: 24 * 60 * 60 * 1000,   label: '24 hours', periodLabel: '24 hours', kind: 'fixed'},
];


class ShareLocationModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // Index into DURATION_OPTIONS chosen on open. Defaults to
            // ShareLocationModal.defaultIndexFor(props) so caregiver
            // contacts open with "Until I return" pre-selected and
            // everybody else opens with "Once" — the same low-commitment
            // default we had before the caregiver feature landed. We
            // can't key off `value` to find the default because
            // multiple options share the same durationMs (4h / 8h)
            // but differ in `kind`.
            selectedIndex: ShareLocationModal.defaultIndexFor(props),
            // Privacy radius (metres). Only meaningful for the
            // "Until we meet" path. 0 disables the gate; non-zero values
            // tell NavigationBar to swallow every outgoing location tick
            // whose coordinates are within `excludeOriginRadiusMeters`
            // of the user's first GPS fix. Ticks resume the moment the
            // user moves past the radius. Seeded from
            // props.defaultPrivacyRadiusMeters (a device preference
            // recorded the last time the user confirmed a share with
            // a chosen radius), so a user who has settled on e.g.
            // 500 m doesn't have to reselect on every share.
            excludeOriginRadiusMeters: Number(props.defaultPrivacyRadiusMeters) || 0,
            // Zoom level for the meet-mode destination preview map.
            // null means "auto-fit" — let StaticMap's
            // pickZoomToFitPoints pick a zoom that frames every
            // visible point (destination + user pin once it lands +
            // privacy circle once selected). The +/- buttons set
            // this to a numeric value, switching from auto-fit to
            // manual zoom; from then on the user is in control until
            // the modal closes (we reset to null on reopen).
            // Without this, the map stayed at street-level (15) even
            // after the user pin landed kilometres away, leaving the
            // pin offscreen.
            meetPreviewZoom: null,
            // "Do not show this again" checkbox below the disclaimer.
            // Defaults to CHECKED so the common-case user (who
            // already understands the data-handling story after
            // seeing it once) can press Confirm in one tap and
            // never see the paragraph again. Untick it to keep the
            // disclaimer visible on future shares. Persists ONLY if
            // the user actually presses Confirm — Cancelling out of
            // the modal should not suppress future disclaimers,
            // since the user's intent wasn't to share. Suppression
            // is sticky across share sessions until the user opts
            // out of the privacy policy, which clears the flag in
            // app_state.
            dontShowDisclaimerAgain: true,
        };
    }

    // Static helper so the constructor and CWRP both pick the same
    // default. Caregivers default to "Until I return"; non-caregivers
    // keep the historical "Once" default (lowest-commitment for a
    // day-to-day "send my current location" share).
    static defaultIndexFor(props) {
        // "Meet me there..." flow: the caller staged a destination and
        // wants the meet-up duration pre-selected so the user just has
        // to tap Start. Takes priority over caregiver and once defaults
        // because the destination ONLY carries semantic weight in the
        // meet-up flow — overriding here keeps the user from having to
        // un-pick a default before picking the right thing.
        if (props && props.presetKind) {
            const idx = DURATION_OPTIONS.findIndex(o => o.kind === props.presetKind);
            if (idx >= 0) return idx;
        }
        if (props && props.isCaregiver) {
            const idx = DURATION_OPTIONS.findIndex(o => o.kind === 'untilIReturn');
            if (idx >= 0) return idx;
        }
        return DURATION_OPTIONS.findIndex(o => o.kind === 'once');
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // When the modal is re-opened, reset to the default selection
        // for the (possibly updated) caregiver state of the contact.
        if (nextProps.show && !this.state.show) {
            this.setState({
                show: true,
                selectedIndex: ShareLocationModal.defaultIndexFor(nextProps),
                // Seed from the device-pref default. If the user
                // hasn't picked one yet, this is 0 (the historical
                // "Off" default).
                excludeOriginRadiusMeters: Number(nextProps.defaultPrivacyRadiusMeters) || 0,
                // Fresh open → reset to auto-fit. Without this, a
                // user who zoomed in/out on a previous meet-up would
                // inherit that zoom on the next "Meet me there..."
                // flow even though the destination is somewhere else
                // entirely. null = let StaticMap auto-fit the
                // user-pin/destination bounding box.
                meetPreviewZoom: null,
                // Fresh open → checkbox CHECKED by default. Same
                // rationale as the constructor — most users will press
                // Confirm in one tap, suppress the disclaimer for next
                // time, and never see this paragraph again. Untick it
                // to keep the disclaimer visible on future shares.
                dontShowDisclaimerAgain: true,
            });
        } else {
            this.setState({show: nextProps.show});
        }
    }

    // Bump the preview map's zoom by `delta` (+1 or -1), clamped to
    // the slippy-tile range our provider serves. When zoom is null
    // (auto-fit mode), seed it from the same pickZoomToFitPoints
    // formula StaticMap uses internally so the first +/- tap reads
    // as "step in/out from THIS view" rather than "snap to 15 +
    // delta". Reaching either end is silent — buttons render with
    // reduced opacity at the cap.
    _adjustMeetPreviewZoom(delta, autoFitZoom) {
        const base = (typeof this.state.meetPreviewZoom === 'number')
            ? this.state.meetPreviewZoom
            : (typeof autoFitZoom === 'number'
                ? autoFitZoom
                : PREVIEW_DEFAULT_ZOOM);
        const next = Math.max(
            PREVIEW_MIN_ZOOM,
            Math.min(PREVIEW_MAX_ZOOM, base + delta)
        );
        if (next === this.state.meetPreviewZoom) return;
        this.setState({meetPreviewZoom: next});
    }

    onConfirm() {
        const option = DURATION_OPTIONS[this.state.selectedIndex] || DURATION_OPTIONS[0];
        // Privacy radius only applies to the meeting-handshake path; for
        // any plain timed share we ship 0 regardless of the slider
        // state so the option can't accidentally bleed across semantic
        // kinds (the slider is only rendered when the meetingRequest
        // option is selected anyway, but defensive belt).
        const excludeOriginRadiusMeters = option.kind === 'meetingRequest'
            ? Number(this.state.excludeOriginRadiusMeters) || 0
            : 0;
        // "Do not show this again" — fire the suppression callback
        // BEFORE we close the modal so the parent can persist the flag
        // synchronously. We only do this on Confirm (not on Cancel /
        // tap-outside) because suppression should follow user intent
        // to share, not user intent to back out. NavigationBar reads
        // app_state.location.disclaimerSuppressed before deciding
        // whether to render the disclaimer block on the next open.
        console.log(
            '[location] modal-confirm: dontShowDisclaimerAgain=',
            this.state.dontShowDisclaimerAgain,
            'onSuppressDisclaimer=', typeof this.props.onSuppressDisclaimer
        );
        if (this.state.dontShowDisclaimerAgain
                && typeof this.props.onSuppressDisclaimer === 'function') {
            try { this.props.onSuppressDisclaimer(); }
            catch (e) {
                console.log('[location] modal-confirm: onSuppressDisclaimer threw',
                    e && e.message ? e.message : e);
            }
        }
        // Persist the chosen privacy radius as the new default for
        // next time. Fires for every Confirm — including 0 ("Off")
        // — so a user who deliberately turns the radius off doesn't
        // get it auto-re-enabled on the next share.
        if (option.kind === 'meetingRequest'
                && typeof this.props.onPersistPrivacyRadius === 'function') {
            try { this.props.onPersistPrivacyRadius(excludeOriginRadiusMeters); }
            catch (e) { /* persistence is best-effort */ }
        }
        // Let the parent drive the side-effects (sending messages, starting
        // the periodic timer, etc.). We just report the chosen option —
        // including `kind` so the caller knows whether to stamp
        // meeting_request:true on the origin tick.
        this.props.onConfirm({
            durationMs: option.value,
            periodLabel: option.periodLabel,
            kind: option.kind,
            excludeOriginRadiusMeters,
        });
        this.props.close();
    }

    setRadiusStop(meters) {
        this.setState({excludeOriginRadiusMeters: meters});
    }

    onCancel() {
        this.props.close();
    }

    render() {
        // Confirm-button gates. Three conditions can disable
        // Confirm in meet-mode:
        //
        //   1. Destination not resolved yet — happens for the brief
        //      window between tapping a Maps link and the URL
        //      resolution landing. Without this gate the user can
        //      tap Confirm and the share starts with no destination,
        //      which silently downgrades to a plain timed share.
        //
        //   2. User location not resolved yet — `userLocation` arrives
        //      asynchronously after the GPS fix. Requiring it before
        //      Confirm guarantees the privacy-zone overlap check
        //      below has the data it needs to be meaningful, AND
        //      makes the confirm gesture honest: the user can SEE
        //      the destination relative to their position before
        //      they commit.
        //
        //   3. Privacy zone covers the destination — when the user's
        //      chosen radius is greater than (or equal to) their
        //      actual distance to the destination, the privacy
        //      circle entirely engulfs the meeting point.
        //      Confirming would fire "you arrived at the
        //      destination" the moment the first real-coord tick
        //      lands. Surface a small inline note so the user
        //      knows why.
        //
        // Outside meet-mode (regular timed share, no destination) all
        // three gates are skipped: there's no destination to compare
        // against and no user pin to wait for.
        const _selectedOption = DURATION_OPTIONS[this.state.selectedIndex];
        const _isMeetingKind = _selectedOption
            && _selectedOption.kind === 'meetingRequest';
        const _radius = Number(this.state.excludeOriginRadiusMeters) || 0;
        const _userLoc = this.props.userLocation;
        const _userLocResolved = !!(_userLoc
            && typeof _userLoc.latitude === 'number'
            && typeof _userLoc.longitude === 'number');
        const _dest = this.props.meetDestination;
        const _destResolved = !!(_dest
            && typeof _dest.latitude === 'number'
            && typeof _dest.longitude === 'number');
        let _privacyOverlapsDestination = false;
        if (_isMeetingKind
                && _radius > 0
                && _userLocResolved
                && _destResolved) {
            const _d = haversineMeters(_userLoc, _dest);
            if (Number.isFinite(_d) && _d <= _radius) {
                _privacyOverlapsDestination = true;
            }
        }
        const _meetModeMissingLocations = this.props.meetMode
            && (!_userLocResolved || !_destResolved);
        const _confirmDisabled = _meetModeMissingLocations
            || _privacyOverlapsDestination;
        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                {/* Tap outside to dismiss, same as EditContactModal.
                    In meet-mode the overlay's horizontal padding is
                    trimmed to 6 px so the destination preview map can
                    extend close to the screen edges. Outside meet-mode
                    we keep the shared overlay's 16 px on every side
                    so the dialog visual matches the rest of the app's
                    modals. We inline the styles (rather than
                    [base, override]) because RN's StyleSheet merge of
                    a `padding` shorthand and a `padding{Side}` longhand
                    is ambiguous on some RN versions — the shorthand
                    sometimes wins, sometimes the longhand does.
                    Spelling out the four `padding{Top,Right,Bottom,
                    Left}` props guarantees the horizontal trim takes
                    effect regardless of merge order. */}
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={{
                        flex: 1,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        justifyContent: 'center',
                        paddingTop: 16,
                        paddingBottom: 16,
                        paddingLeft: this.props.meetMode ? 6 : 16,
                        paddingRight: this.props.meetMode ? 6 : 16,
                    }}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when the tap is inside the card.
                                In meet-mode we want the Surface to span
                                the full overlay width so the destination
                                preview map below fills it edge-to-edge.
                                `alignSelf: 'stretch'` does that without
                                fighting KAV — no explicit numeric width
                                to clash with the keyboard-avoiding
                                container's own layout (which is what
                                broke when we tried `width: ...` directly).
                                Outside meet-mode we keep the historical
                                content-sized behaviour so the radio
                                picker doesn't look stretched-out and
                                airy. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={[
                                    containerStyles.modalSurface,
                                    this.props.meetMode ? {alignSelf: 'stretch'} : null,
                                ]}>
                                    <Text style={containerStyles.title}>Share location</Text>

                                    {/* "with <peer>" subtitle is only shown
                                        OUTSIDE meet-mode. Meet-mode folds the
                                        peer URI into the description text
                                        underneath the map ("Share your live
                                        location with <peer> until both of you
                                        arrive at the destination above."), so
                                        rendering it here too would just
                                        duplicate the same string two lines
                                        apart. Tighter padding than the shared
                                        styles.body (10 px all around) so the
                                        dialog feels compact — the prompt, the
                                        radio list and the note below sit
                                        closer together. */}
                                    {!this.props.meetMode ? (
                                        <Text style={[styles.body, { paddingTop: 4, paddingBottom: 2 }]}>
                                            with {this.props.uri || this.props.displayName || 'this contact'}
                                        </Text>
                                    ) : null}

                                    {/* Simple-share mode preview: render a
                                        small map centered on the user's own
                                        position so the user can confirm what
                                        they're about to start sharing. No
                                        destination pin, no privacy circle —
                                        privacy radius only applies to meet
                                        sessions. Same StaticMap + zoom-control
                                        machinery as the meet-mode preview
                                        above. Hidden until the GPS fix lands
                                        so we don't render a degenerate
                                        "centered on lat=0,lng=0" map; falls
                                        back to a compact "Acquiring location…"
                                        banner in the meantime. */}
                                    {!this.props.meetMode ? (() => {
                                        const userLoc = this.props.userLocation;
                                        const hasUserLoc = userLoc
                                            && typeof userLoc.latitude === 'number'
                                            && typeof userLoc.longitude === 'number';
                                        // Width budget mirrors the meet
                                        // preview but accounts for the
                                        // wider 16 px overlay padding used
                                        // outside meet-mode: window.width −
                                        // (16 + 16 + 5 + 5) = − 42.
                                        const PREVIEW_W = Math.max(
                                            240,
                                            Dimensions.get('window').width - 42
                                        );
                                        const PREVIEW_H = 180;
                                        if (!hasUserLoc) {
                                            return (
                                                <View style={{
                                                    marginTop: 4,
                                                    marginBottom: 8,
                                                    paddingVertical: 8,
                                                    paddingHorizontal: 12,
                                                    backgroundColor: 'rgba(25,118,210,0.08)',
                                                    borderRadius: 8,
                                                    alignSelf: 'center',
                                                    width: PREVIEW_W,
                                                }}>
                                                    <Text style={{
                                                        fontSize: 12,
                                                        color: '#333',
                                                        textAlign: 'center',
                                                    }} numberOfLines={1}>
                                                        Acquiring your location…
                                                    </Text>
                                                </View>
                                            );
                                        }
                                        // Single-pin auto-fit: with one
                                        // point pickZoomToFitPoints isn't
                                        // meaningful, so fall back to the
                                        // default street-level zoom. The
                                        // user can +/- from there.
                                        const _autoFitZoom = PREVIEW_DEFAULT_ZOOM;
                                        const zoom = (typeof this.state.meetPreviewZoom === 'number')
                                            ? this.state.meetPreviewZoom
                                            : _autoFitZoom;
                                        const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
                                        const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
                                        const _ownerInitials = initialsFromName(this.props.myDisplayName);
                                        return (
                                            <View style={{
                                                marginTop: 4,
                                                marginBottom: 8,
                                                width: PREVIEW_W,
                                                height: PREVIEW_H,
                                                borderRadius: 8,
                                                overflow: 'hidden',
                                                backgroundColor: '#e5e5e5',
                                                alignSelf: 'center',
                                            }}>
                                                <StaticMap
                                                    /* No destinationLat/Lng:
                                                       StaticMap centers on
                                                       latitude/longitude when
                                                       the destination pair
                                                       is missing. */
                                                    latitude={userLoc.latitude}
                                                    longitude={userLoc.longitude}
                                                    ownerInitials={_ownerInitials}
                                                    mapWidth={PREVIEW_W}
                                                    mapHeight={PREVIEW_H}
                                                    zoom={zoom}
                                                />

                                                <TouchableOpacity
                                                    onPress={() => this._adjustMeetPreviewZoom(+1, _autoFitZoom)}
                                                    disabled={!canZoomIn}
                                                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                    accessibilityLabel="Zoom in"
                                                    style={{
                                                        position: 'absolute',
                                                        top: 6,
                                                        right: 6,
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 16,
                                                        backgroundColor: 'rgba(255,255,255,0.92)',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        opacity: canZoomIn ? 1 : 0.4,
                                                        shadowColor: '#000',
                                                        shadowOpacity: 0.2,
                                                        shadowRadius: 2,
                                                        shadowOffset: {width: 0, height: 1},
                                                        elevation: 3,
                                                    }}
                                                >
                                                    <Icon name="plus" size={20} color="#222" />
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                    onPress={() => this._adjustMeetPreviewZoom(-1, _autoFitZoom)}
                                                    disabled={!canZoomOut}
                                                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                    accessibilityLabel="Zoom out"
                                                    style={{
                                                        position: 'absolute',
                                                        top: 44,
                                                        right: 6,
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 16,
                                                        backgroundColor: 'rgba(255,255,255,0.92)',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        opacity: canZoomOut ? 1 : 0.4,
                                                        shadowColor: '#000',
                                                        shadowOpacity: 0.2,
                                                        shadowRadius: 2,
                                                        shadowOffset: {width: 0, height: 1},
                                                        elevation: 3,
                                                    }}
                                                >
                                                    <Icon name="minus" size={20} color="#222" />
                                                </TouchableOpacity>

                                                {/* Coords overlay strip — same
                                                    styling as the meet preview
                                                    so the two views share a
                                                    visual vocabulary. */}
                                                <View
                                                    pointerEvents="none"
                                                    style={{
                                                        position: 'absolute',
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        paddingVertical: 4,
                                                        paddingHorizontal: 10,
                                                        backgroundColor: 'rgba(0,0,0,0.55)',
                                                    }}
                                                >
                                                    <Text
                                                        style={{
                                                            fontSize: 11,
                                                            color: '#fff',
                                                            textAlign: 'center',
                                                        }}
                                                        numberOfLines={1}
                                                    >
                                                        {userLoc.latitude.toFixed(5)
                                                            + ', '
                                                            + userLoc.longitude.toFixed(5)}
                                                    </Text>
                                                </View>
                                            </View>
                                        );
                                    })() : null}

                                    {/* "Meet me there..." mode: render a
                                        destination-preview banner BEFORE the
                                        duration options so the user can
                                        confirm the location they're meeting
                                        at. The banner reads either:
                                          • "Resolving destination…" while a
                                            shortened URL is being expanded
                                          • "Meeting at lat,lng" once coords
                                            are known
                                          • "Couldn't read the map link" on
                                            resolve failure (the user can
                                            still cancel and pick a different
                                            link to long-press)
                                        Banner is only rendered when meetMode
                                        is true (set by NavigationBar.meetMeAt). */}
                                    {this.props.meetMode ? (() => {
                                        // Three render states:
                                        //   • Resolved (destination has
                                        //     lat/lng) — full-width map tile
                                        //     centred on the destination
                                        //     with the green map-marker
                                        //     pin, +/- zoom buttons in the
                                        //     right-edge gutter, and the
                                        //     coords overlaid in a semi-
                                        //     transparent strip along the
                                        //     bottom of the map. The
                                        //     section header / "Meeting
                                        //     destination" label is
                                        //     deliberately omitted so every
                                        //     pixel of vertical space goes
                                        //     to the map itself.
                                        //   • Failed (status === 'failed') —
                                        //     compact error banner so the
                                        //     user knows to cancel and try
                                        //     another link.
                                        //   • Resolving (default) — same
                                        //     banner shape as the failed
                                        //     case but with a "Resolving
                                        //     destination…" message; switches
                                        //     to the map tile in place when
                                        //     resolution lands.
                                        const dest = this.props.meetDestination;
                                        const hasCoords = dest
                                            && typeof dest.latitude === 'number'
                                            && typeof dest.longitude === 'number';
                                        if (hasCoords) {
                                            // Width: fill the modal panel
                                            // edge-to-edge. The overlay's
                                            // horizontal padding is locally
                                            // reduced to 6 px each side and
                                            // the modalSurface has padding 5
                                            // — so the usable inner width is
                                            // window.width − (6 + 6 + 5 + 5)
                                            // = window.width − 22. The
                                            // wrapper has overflow: 'hidden'
                                            // on a borderRadius, so sub-
                                            // pixel rounding can't bleed
                                            // past the clip. Floor at 240
                                            // keeps things sane on unusually
                                            // small viewports.
                                            const PREVIEW_W = Math.max(
                                                240,
                                                Dimensions.get('window').width - 22
                                            );
                                            // Height: 240 px gives enough
                                            // map area to read street
                                            // context without crowding the
                                            // duration picker beneath. Tuned
                                            // by eye on a 380 px Android
                                            // viewport — roughly square-ish
                                            // aspect on phone, slightly
                                            // wider than tall so the pin
                                            // and surrounding streets read
                                            // at a glance.
                                            const PREVIEW_H = 240;
                                            // Compute the auto-fit
                                            // zoom externally so we
                                            // can both pass it as the
                                            // map's zoom prop AND use
                                            // it to seed the +/-
                                            // buttons (so the first
                                            // tap reads as "from
                                            // here", not "snap to 15").
                                            const userLoc = this.props.userLocation;
                                            const _fitPoints = [];
                                            _fitPoints.push({
                                                latitude: dest.latitude,
                                                longitude: dest.longitude,
                                            });
                                            if (userLoc
                                                    && typeof userLoc.latitude === 'number'
                                                    && typeof userLoc.longitude === 'number') {
                                                _fitPoints.push({
                                                    latitude: userLoc.latitude,
                                                    longitude: userLoc.longitude,
                                                });
                                            }
                                            const _autoFitZoom = _fitPoints.length > 1
                                                ? pickZoomToFitPoints(
                                                    _fitPoints, 40, PREVIEW_W, PREVIEW_H,
                                                )
                                                : PREVIEW_DEFAULT_ZOOM;
                                            // The effective zoom we
                                            // pass to StaticMap. null
                                            // override means "use
                                            // auto-fit"; a numeric
                                            // override wins after the
                                            // user taps +/-.
                                            const zoom = (typeof this.state.meetPreviewZoom === 'number')
                                                ? this.state.meetPreviewZoom
                                                : _autoFitZoom;
                                            const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
                                            const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
                                            // Distance from user to
                                            // destination, formatted
                                            // for the gray label
                                            // below the coords.
                                            // null when the user
                                            // location hasn't landed
                                            // yet — caller hides the
                                            // distance segment in
                                            // that case.
                                            const _userToDestM = haversineMeters(userLoc, dest);
                                            const _distLabel = formatDistance(_userToDestM);
                                            // Initials for the user's
                                            // own pin. Falls back to
                                            // '?' when myDisplayName
                                            // isn't passed (shouldn't
                                            // happen in practice — see
                                            // NavigationBar's
                                            // myDisplayName prop
                                            // wiring).
                                            const _ownerInitials = initialsFromName(this.props.myDisplayName);
                                            return (
                                                <View style={{
                                                    marginTop: 4,
                                                    marginBottom: 8,
                                                    width: PREVIEW_W,
                                                    height: PREVIEW_H,
                                                    borderRadius: 8,
                                                    overflow: 'hidden',
                                                    backgroundColor: '#e5e5e5',
                                                    alignSelf: 'center',
                                                }}>
                                                    <StaticMap
                                                        destinationLatitude={dest.latitude}
                                                        destinationLongitude={dest.longitude}
                                                        /* User's current
                                                           location pin. Comes
                                                           from a
                                                           getCurrentCoordinates
                                                           fetch kicked off in
                                                           NavigationBar.show
                                                           ShareLocationModal —
                                                           absent until the GPS
                                                           fix lands, then
                                                           appears on the map
                                                           alongside the
                                                           destination. */
                                                        latitude={
                                                            this.props.userLocation
                                                                && typeof this.props.userLocation.latitude === 'number'
                                                                ? this.props.userLocation.latitude
                                                                : undefined
                                                        }
                                                        longitude={
                                                            this.props.userLocation
                                                                && typeof this.props.userLocation.longitude === 'number'
                                                                ? this.props.userLocation.longitude
                                                                : undefined
                                                        }
                                                        /* Privacy-radius
                                                           circle. Centered on
                                                           the user's current
                                                           position with the
                                                           radius the slider
                                                           currently reads.
                                                           Skipped when slider
                                                           is at "Off" (0) or
                                                           the user location
                                                           hasn't landed yet. */
                                                        circleCenterLatitude={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                && typeof this.props.userLocation.latitude === 'number'
                                                                ? this.props.userLocation.latitude
                                                                : undefined
                                                        }
                                                        circleCenterLongitude={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                && typeof this.props.userLocation.longitude === 'number'
                                                                ? this.props.userLocation.longitude
                                                                : undefined
                                                        }
                                                        circleRadiusMeters={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                ? Number(this.state.excludeOriginRadiusMeters)
                                                                : undefined
                                                        }
                                                        ownerInitials={_ownerInitials}
                                                        mapWidth={PREVIEW_W}
                                                        mapHeight={PREVIEW_H}
                                                        zoom={zoom}
                                                    />

                                                    {/* Zoom + button (top-right corner). */}
                                                    <TouchableOpacity
                                                        onPress={() => this._adjustMeetPreviewZoom(+1, _autoFitZoom)}
                                                        disabled={!canZoomIn}
                                                        hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                        accessibilityLabel="Zoom in"
                                                        style={{
                                                            position: 'absolute',
                                                            top: 6,
                                                            right: 6,
                                                            width: 32,
                                                            height: 32,
                                                            borderRadius: 16,
                                                            backgroundColor: 'rgba(255,255,255,0.92)',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            opacity: canZoomIn ? 1 : 0.4,
                                                            // Subtle shadow so the buttons
                                                            // lift off the map tiles. Same
                                                            // shadow vocabulary the
                                                            // LocationBubble pins use.
                                                            shadowColor: '#000',
                                                            shadowOpacity: 0.2,
                                                            shadowRadius: 2,
                                                            shadowOffset: {width: 0, height: 1},
                                                            elevation: 3,
                                                        }}
                                                    >
                                                        <Icon name="plus" size={20} color="#222" />
                                                    </TouchableOpacity>

                                                    {/* Zoom - button (just below the +).
                                                        Stacked vertically on the right edge
                                                        so they read as one control group;
                                                        spacing matches LocationBubble's
                                                        zoom-button layout where the user
                                                        already knows the pattern. */}
                                                    <TouchableOpacity
                                                        onPress={() => this._adjustMeetPreviewZoom(-1, _autoFitZoom)}
                                                        disabled={!canZoomOut}
                                                        hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                        accessibilityLabel="Zoom out"
                                                        style={{
                                                            position: 'absolute',
                                                            top: 44, // 6 + 32 + 6 gap
                                                            right: 6,
                                                            width: 32,
                                                            height: 32,
                                                            borderRadius: 16,
                                                            backgroundColor: 'rgba(255,255,255,0.92)',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            opacity: canZoomOut ? 1 : 0.4,
                                                            shadowColor: '#000',
                                                            shadowOpacity: 0.2,
                                                            shadowRadius: 2,
                                                            shadowOffset: {width: 0, height: 1},
                                                            elevation: 3,
                                                        }}
                                                    >
                                                        <Icon name="minus" size={20} color="#222" />
                                                    </TouchableOpacity>

                                                    {/* Coordinates overlay strip along the
                                                        bottom of the map. Semi-transparent
                                                        dark background with white text so
                                                        the coords stay legible regardless of
                                                        what's under them (city, water,
                                                        countryside — slippy tiles vary
                                                        wildly in luminance). pointerEvents:
                                                        'none' so the strip never intercepts
                                                        a future tap-to-pan gesture. */}
                                                    <View
                                                        pointerEvents="none"
                                                        style={{
                                                            position: 'absolute',
                                                            left: 0,
                                                            right: 0,
                                                            bottom: 0,
                                                            paddingVertical: 4,
                                                            paddingHorizontal: 10,
                                                            backgroundColor: 'rgba(0,0,0,0.55)',
                                                        }}
                                                    >
                                                        <Text
                                                            style={{
                                                                fontSize: 11,
                                                                color: '#fff',
                                                                textAlign: 'center',
                                                            }}
                                                            numberOfLines={1}
                                                        >
                                                            {dest.latitude.toFixed(5)
                                                                + ', '
                                                                + dest.longitude.toFixed(5)
                                                                + (_distLabel
                                                                    ? '  •  ' + _distLabel + ' away'
                                                                    : '')}
                                                        </Text>
                                                    </View>
                                                </View>
                                            );
                                        }
                                        // No coords yet — fall back to the
                                        // compact text banner. Kept short so
                                        // the user notices the resolving /
                                        // failed state without losing room
                                        // for the duration picker below.
                                        return (
                                            <View style={{
                                                marginTop: 4,
                                                marginBottom: 6,
                                                paddingVertical: 8,
                                                paddingHorizontal: 12,
                                                backgroundColor: 'rgba(25,118,210,0.08)',
                                                borderRadius: 8,
                                            }}>
                                                <Text style={{
                                                    fontSize: 12,
                                                    color: '#333',
                                                }} numberOfLines={2}>
                                                    {this.props.meetDestinationStatus === 'failed'
                                                        ? "Couldn't read the map link — cancel and try another"
                                                        : 'Resolving destination…'}
                                                </Text>
                                            </View>
                                        );
                                    })() : null}

                                    {/* Two-column layout. Left column: the
                                        meeting-handshake option ("Until we
                                        meet") followed by an "or" divider
                                        line so the two intents (meetup vs
                                        timed) read as alternatives rather
                                        than a flat list. Right column: the
                                        plain timed shares stacked vertically.
                                        A single RadioButton.Group wraps both
                                        columns so selection is mutually
                                        exclusive across them.

                                        RadioButton.Android is forced on both
                                        platforms so unchecked buttons render
                                        as a clearly visible empty circle
                                        outline — the default <RadioButton>
                                        picks the iOS checkmark style on iOS,
                                        which is invisible when unselected.
                                        uncheckedColor bumps contrast so the
                                        ring stands out against the Surface
                                        background. */}
                                    {/* Meet-me-there mode collapses the
                                        whole duration picker — there's only
                                        one valid choice (the meet-up
                                        handshake) and showing the alternate
                                        options would invite the user to pick
                                        something incompatible with the
                                        destination they just chose. We rely
                                        on `presetKind` to keep selectedIndex
                                        pointed at the meetingRequest entry,
                                        and the description below is the only
                                        copy that needs to render — the
                                        previous "Until we meet" header was
                                        redundant with the description
                                        underneath. The peer URI is folded
                                        into the description so there's only
                                        one line of text under the map and
                                        every other pixel is the map itself. */}
                                    {this.props.meetMode ? (
                                        <View style={{
                                            paddingVertical: 6,
                                            paddingHorizontal: 12,
                                        }}>
                                            <Text style={{
                                                fontSize: 12,
                                                opacity: 0.8,
                                                textAlign: 'center',
                                            }}>
                                                Share your live location with{' '}
                                                <Text style={{fontWeight: 'bold'}}>
                                                    {this.props.uri || this.props.displayName || 'this contact'}
                                                </Text>
                                                {' '}until both of you arrive at the destination above.
                                            </Text>
                                        </View>
                                    ) : (
                                    <RadioButton.Group
                                        onValueChange={(value) => this.setState({selectedIndex: parseInt(value, 10)})}
                                        value={String(this.state.selectedIndex)}
                                    >
                                        <View style={{ flexDirection: 'row' }}>
                                            <View style={{ flex: 1 }}>
                                                {/* "Until I return" sits at the top of the
                                                    left column. Originally caregiver-only —
                                                    now shown for every contact because the
                                                    "I'll be back home in a bit" intent
                                                    isn't specific to a caregiver
                                                    relationship. For caregiver contacts the
                                                    static defaultIndexFor() helper still
                                                    pre-selects this row, so the open-modal
                                                    behaviour is unchanged for them. */}
                                                {DURATION_OPTIONS.map((opt, idx) => (
                                                    opt.kind === 'untilIReturn' ? (
                                                        <View key={idx} style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                                            <RadioButton.Android
                                                                value={String(idx)}
                                                                uncheckedColor="#666"
                                                            />
                                                            <Text>{opt.label}</Text>
                                                        </View>
                                                    ) : null
                                                ))}
                                                {/* "Until we meet" is the meet-up handshake — a
                                                    peer-to-peer "let's converge on the same point"
                                                    intent. For a caregiver contact that's the wrong
                                                    semantic: the caregiver isn't trying to meet up,
                                                    they're keeping watch over a trip. Hide it
                                                    entirely so the modal stays focused on the
                                                    "Until I return" / fixed-interval shapes that
                                                    actually fit the relationship. */}
                                                {!this.props.isCaregiver
                                                    ? DURATION_OPTIONS.map((opt, idx) => (
                                                        opt.kind === 'meetingRequest' ? (
                                                            /* Override the shared
                                                               checkBoxRow's 10px
                                                               bottom margin so the
                                                               option sits snug at
                                                               the top of its column. */
                                                            <View key={idx} style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                                                <RadioButton.Android
                                                                    value={String(idx)}
                                                                    uncheckedColor="#666"
                                                                />
                                                                <Text>{opt.label}</Text>
                                                            </View>
                                                        ) : null
                                                    ))
                                                    : null}
                                                {/* "or select an interval"
                                                    separator: just the text,
                                                    no horizontal rules — the
                                                    descriptive label stands on
                                                    its own and keeps the
                                                    divider visually quiet
                                                    inside the narrow column. */}
                                                <View style={{
                                                    alignItems: 'center',
                                                    marginTop: 6,
                                                    marginBottom: 2,
                                                    paddingHorizontal: 8,
                                                }}>
                                                    <Text style={{
                                                        fontSize: 12,
                                                        opacity: 0.7,
                                                    }}>or select an interval</Text>
                                                </View>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                {DURATION_OPTIONS.map((opt, idx) => (
                                                    (opt.kind === 'once' || opt.kind === 'fixed') ? (
                                                        <View key={idx} style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                                            <RadioButton.Android
                                                                value={String(idx)}
                                                                uncheckedColor="#666"
                                                            />
                                                            <Text>{opt.label}</Text>
                                                        </View>
                                                    ) : null
                                                ))}
                                            </View>
                                        </View>
                                    </RadioButton.Group>
                                    )}

                                    {/* Privacy-radius slider — only shown
                                        when the "Until we meet" handshake is
                                        selected. For plain timed shares
                                        (2h / 4h / 8h / 24h) the user already
                                        knows they're broadcasting their
                                        location for the full window, so a
                                        "hide my origin" control would just
                                        be confusing; the meetup case is the
                                        one where the starting point is
                                        commonly home and the user wants to
                                        surface the journey, not the origin. */}
                                    {DURATION_OPTIONS[this.state.selectedIndex]
                                        && DURATION_OPTIONS[this.state.selectedIndex].kind === 'meetingRequest'
                                        ? (
                                        <PrivacyRadiusSlider
                                            value={this.state.excludeOriginRadiusMeters}
                                            onChange={this.setRadiusStop}
                                            title="Don’t share my location until I move away from my starting point:"
                                        />
                                    ) : null}

                                    {/* Single consolidated disclosure. Three
                                        original disclaimers (PGP, stop-at-any-
                                        time, retention) are joined into one
                                        paragraph so the dialog reads like a
                                        single reassurance instead of a stacked
                                        checklist. The retention clause swaps
                                        between the meetup wipe-on-end promise
                                        and the 7-day fixed-share policy based
                                        on which radio option is selected.
                                        Hidden when props.disclaimerSuppressed
                                        is true (the user previously confirmed
                                        with "Do not show this again"
                                        ticked). The suppression is sticky
                                        across share sessions and gets cleared
                                        when the user opts out of the privacy
                                        policy, so the legal text DOES come
                                        back the moment that contract is
                                        revoked. */}
                                    {/* Disclaimer + "Do not show this again"
                                        checkbox grouped inside one rounded-
                                        border container so the user reads
                                        them as a single unit ("here's what
                                        happens to your data, and you can
                                        opt out of seeing this again"). The
                                        whole block is hidden when the user
                                        previously confirmed with the box
                                        ticked — that flag is sticky across
                                        share sessions until they opt out of
                                        the privacy policy. */}
                                    {!this.props.disclaimerSuppressed ? (
                                        <View style={{
                                            marginTop: 6,
                                            marginBottom: 6,
                                            paddingVertical: 6,
                                            paddingHorizontal: 4,
                                            borderRadius: 8,
                                            borderWidth: 1,
                                            borderColor: 'rgba(0,0,0,0.15)',
                                        }}>
                                            <Text style={[styles.body, { paddingTop: 2, paddingBottom: 0, paddingHorizontal: 4, fontSize: 10, opacity: 0.75 }]}>
                                                {(() => {
                                                    const sel = DURATION_OPTIONS[this.state.selectedIndex];
                                                    const head = 'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. ';
                                                    if (sel && sel.kind === 'meetingRequest') {
                                                        return head
                                                            + 'Sharing can be stopped at any time by clicking on the location icon. '
                                                            + 'Location data will be destroyed on both devices after meetup.';
                                                    }
                                                    if (sel && sel.kind === 'untilIReturn') {
                                                        return head
                                                            + 'Sharing starts immediately and stops automatically when you return to where you started, '
                                                            + 'or after 8 hours — whichever comes first. '
                                                            + 'You can also stop it at any time by clicking on the location icon.';
                                                    }
                                                    if (sel && sel.kind === 'once') {
                                                        return head
                                                            + 'A single GPS fix is sent and not updated afterwards. '
                                                            + 'The location data can be deleted from both devices.';
                                                    }
                                                    return head
                                                        + 'Sharing can be stopped at any time by clicking on the location icon. '
                                                        + 'Only the last learned GPS position is stored in the devices for maximum 7 days. '
                                                        + 'The location data can be deleted from both devices.';
                                                })()}
                                            </Text>

                                            {/* "Do not show this again" —
                                                tapping anywhere on the row
                                                toggles the box. Centered
                                                horizontally and using a
                                                smaller font so it reads as
                                                a secondary control rather
                                                than competing with Confirm.
                                                The suppression is only
                                                persisted on Confirm — see
                                                onConfirm() — so cancelling
                                                out of the modal leaves the
                                                previous setting unchanged. */}
                                            <TouchableWithoutFeedback
                                                onPress={() => this.setState({
                                                    dontShowDisclaimerAgain: !this.state.dontShowDisclaimerAgain,
                                                })}
                                            >
                                                <View style={{
                                                    flexDirection: 'row',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    alignSelf: 'center',
                                                    marginTop: -8,
                                                }}>
                                                    <Checkbox
                                                        status={this.state.dontShowDisclaimerAgain ? 'checked' : 'unchecked'}
                                                        onPress={() => this.setState({
                                                            dontShowDisclaimerAgain: !this.state.dontShowDisclaimerAgain,
                                                        })}
                                                    />
                                                    <Text style={{
                                                        fontSize: 10,
                                                        marginLeft: 2,
                                                        opacity: 0.7,
                                                        textAlign: 'center',
                                                    }}>
                                                        Do not show this again
                                                    </Text>
                                                </View>
                                            </TouchableWithoutFeedback>
                                        </View>
                                    ) : null}

                                    {/* Inline warning — explains WHY the
                                        Confirm button is disabled.
                                        Three reasons in priority order:
                                        privacy-zone overlap (most
                                        actionable — pick a smaller
                                        radius), user location not
                                        resolved yet, destination not
                                        resolved yet. The destination
                                        case is unusual because the
                                        Resolving banner above the map
                                        already covers it; we still
                                        emit a hint here for symmetry
                                        and so the user knows what
                                        Confirm is waiting on. */}
                                    {_privacyOverlapsDestination ? (
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            color: '#C0392B',
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Your privacy zone covers the destination — pick a smaller radius or a different destination.
                                        </Text>
                                    ) : (this.props.meetMode && !_userLocResolved) ? (
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            opacity: 0.7,
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Waiting for your current location…
                                        </Text>
                                    ) : (this.props.meetMode && !_destResolved) ? (
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            opacity: 0.7,
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Waiting for the destination to resolve…
                                        </Text>
                                    ) : null}

                                    {/* Extra bottom padding so the Confirm /
                                        Cancel buttons don't sit flush against
                                        the modal's rounded bottom edge.
                                        Inline rather than in _DeleteMessageModal.scss
                                        because that stylesheet is shared with
                                        other dialogs (Delete message, etc.)
                                        whose layouts we don't want to disturb. */}
                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Cancel"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onConfirm}
                                            icon="map-marker"
                                            disabled={_confirmDisabled}
                                            accessibilityLabel="Confirm sharing location"
                                        >
                                            Confirm
                                        </Button>
                                    </View>
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

ShareLocationModal.propTypes = {
    show        : PropTypes.bool,
    close       : PropTypes.func.isRequired,
    onConfirm   : PropTypes.func.isRequired,
    uri         : PropTypes.string,
    displayName : PropTypes.string,
    // True when the selected contact carries the 'caregiver' tag /
    // localProperties.caregiver flag. Surfaces the auto-stopping
    // "Until I return" option in the modal and pre-selects it.
    isCaregiver : PropTypes.bool,
    // Pre-select the share kind (matches DURATION_OPTIONS[].kind).
    // Used by the Meet me there flow to land on 'meetingRequest'.
    presetKind  : PropTypes.string,
    // Meet me there mode: when true, hides all alternate duration
    // options (the meetingRequest entry is implicit) and renders a
    // destination-preview banner at the top.
    meetMode             : PropTypes.bool,
    meetDestination      : PropTypes.shape({
        latitude: PropTypes.number,
        longitude: PropTypes.number,
    }),
    // 'resolving' | 'resolved' | 'failed' — drives the banner copy
    // when meetDestination is null (no coords yet) or set.
    meetDestinationStatus: PropTypes.string,
    // True when the user previously confirmed with "Do not show this
    // again" ticked. Hides both the disclaimer text and the
    // checkbox itself. Sticky across share sessions until the user
    // opts out of the privacy policy.
    disclaimerSuppressed : PropTypes.bool,
    // Called by onConfirm() when the user pressed Confirm with the
    // checkbox ticked. The parent persists the suppression flag in
    // app_state.location.disclaimerSuppressed.
    onSuppressDisclaimer : PropTypes.func,
    // User's current location for the preview map. Fetched as a
    // fire-and-forget getCurrentCoordinates() in NavigationBar's
    // showShareLocationModal — null while the fix is in flight.
    // Drives the user pin AND the privacy-radius circle (when the
    // slider is non-zero).
    userLocation         : PropTypes.shape({
        latitude:  PropTypes.number,
        longitude: PropTypes.number,
    }),
    // Local user's display name. First letter is used as the red
    // avatar pin's label on the preview map. Falls back to '?'
    // when missing — same convention LocationBubble uses.
    myDisplayName        : PropTypes.string,
    // Last-used privacy radius from device preferences. Seeds the
    // slider's initial value when the modal opens; the modal calls
    // onPersistPrivacyRadius on Confirm with the user's final
    // choice so the same value comes back next time.
    defaultPrivacyRadiusMeters: PropTypes.number,
    onPersistPrivacyRadius    : PropTypes.func,
};

export default ShareLocationModal;
