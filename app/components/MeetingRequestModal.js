import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, TouchableOpacity, Dimensions } from 'react-native';
import { Text, Button, Surface, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';
// StaticMap is the slippy-map tile renderer used by LocationBubble and
// the sender-side ShareLocationModal. Reused here so the receiver can
// see WHERE they're being invited before they accept — same green pin,
// same projection, same tile cache.
// pickZoomToFitPoints lets the modal seed its initial zoom from the
// destination/user-pin bounding box so once the receiver's GPS fix
// lands, the map auto-zooms out to frame both points instead of
// leaving the user pin offscreen at street-level zoom.
import { StaticMap, pickZoomToFitPoints } from './LocationBubble';

// Tiny local helpers — same pattern as ShareLocationModal so the two
// previews behave consistently. Initials extraction matches
// LocationBubble's internal helper (first character of local-part,
// uppercased; '?' fallback for missing names).
function initialsFromName(name) {
    if (!name || typeof name !== 'string') return '?';
    const trimmed = name.trim();
    if (!trimmed) return '?';
    const localPart = trimmed.split('@')[0];
    if (!localPart) return '?';
    return localPart.charAt(0).toUpperCase();
}

// Zoom bounds and default for the destination preview map. Match
// ShareLocationModal so both ends feel consistent.
const PREVIEW_MIN_ZOOM = 3;
const PREVIEW_MAX_ZOOM = 18;
const PREVIEW_DEFAULT_ZOOM = 15;

// Receiver-side prompt for an incoming "Until we meet" location share.
// Shown exactly once per request _id (the caller persists a "handled"
// marker so we don't reprompt after dismissal or across restarts).
//
// Accept → the caller starts a reverse location share whose ticks carry
// in_reply_to = this request's _id and the same expires_at, so both
// devices tear the session down in sync.
// Cancel → silent: no message is sent back to the requester.
class MeetingRequestModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // Privacy radius (metres). Same semantics as the sender
            // side — 0 disables the gate, 500 / 2000 / 4000 / 8000
            // are the user-visible stops. Seeded from the device-
            // preference last-used value so the user doesn't have
            // to reselect it on every accept.
            excludeOriginRadiusMeters: Number(props.defaultPrivacyRadiusMeters) || 0,
            // Zoom level for the destination preview map. null
            // means "auto-fit" — let pickZoomToFitPoints frame
            // every visible point (destination + user pin once it
            // lands). The +/- buttons set this to a numeric value,
            // switching to manual zoom; reset to null on each
            // modal reopen.
            previewZoom: null,
            // "Do not show this again" — same checkbox the sender
            // modal has, persisted to the same per-account flag in
            // app_state.location.disclaimerSuppressed (so a single
            // tick on either modal hides the disclaimer on both).
            // Defaults to CHECKED so a one-tap Accept also opts the
            // user out of seeing the paragraph next time.
            dontShowDisclaimerAgain: true,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Reset the slider to "Off" each time the modal re-opens so a
        // previous prompt's choice doesn't carry over to the next
        // request.
        if (nextProps.show && !this.state.show) {
            this.setState({
                show: true,
                excludeOriginRadiusMeters: Number(nextProps.defaultPrivacyRadiusMeters) || 0,
                // null = auto-fit. The +/- buttons switch to
                // manual zoom; reset on each modal reopen so a
                // previous prompt's choice doesn't carry over.
                previewZoom: null,
                // Fresh open → checkbox CHECKED by default. Same
                // rationale as the sender modal: most users will
                // press Accept in one tap, suppress the disclaimer
                // for next time, and never see the paragraph again.
                dontShowDisclaimerAgain: true,
            });
        } else {
            this.setState({show: nextProps.show});
        }
    }

    setRadiusStop(meters) {
        this.setState({excludeOriginRadiusMeters: meters});
    }

    // Bump the preview map's zoom level by `delta` (+1 / -1), clamped
    // to the slippy-tile range our provider serves. When `previewZoom`
    // is null (auto-fit mode), seed it from the auto-fit value
    // computed at render time so the first +/- tap reads as "step
    // in/out from THIS view" rather than snap to a fixed default.
    _adjustPreviewZoom(delta, autoFitZoom) {
        const base = (typeof this.state.previewZoom === 'number')
            ? this.state.previewZoom
            : (typeof autoFitZoom === 'number'
                ? autoFitZoom
                : PREVIEW_DEFAULT_ZOOM);
        const next = Math.max(
            PREVIEW_MIN_ZOOM,
            Math.min(PREVIEW_MAX_ZOOM, base + delta)
        );
        if (next === this.state.previewZoom) return;
        this.setState({previewZoom: next});
    }

    onAccept() {
        // "Do not show this again" — fire the suppression callback
        // BEFORE we close the modal so the parent persists the flag
        // synchronously. Same per-account flag the sender modal
        // toggles, so a single tick from either side hides the
        // disclaimer everywhere.
        console.log(
            '[location] meeting-modal accept: dontShowDisclaimerAgain=',
            this.state.dontShowDisclaimerAgain,
            'onSuppressDisclaimer=', typeof this.props.onSuppressDisclaimer
        );
        if (this.state.dontShowDisclaimerAgain
                && typeof this.props.onSuppressDisclaimer === 'function') {
            try { this.props.onSuppressDisclaimer(); }
            catch (e) {
                console.log('[location] meeting-modal accept: onSuppressDisclaimer threw',
                    e && e.message ? e.message : e);
            }
        }
        // Persist the chosen privacy radius as the new default for
        // next time. Fires for every Accept regardless of value, so
        // a user who deliberately turned the radius off doesn't get
        // it auto-re-enabled on the next accept.
        if (typeof this.props.onPersistPrivacyRadius === 'function') {
            try { this.props.onPersistPrivacyRadius(Number(this.state.excludeOriginRadiusMeters) || 0); }
            catch (e) { /* persistence is best-effort */ }
        }
        if (typeof this.props.onAccept === 'function') {
            // Forward the chosen radius to the parent so it can flow
            // into NavigationBar.startLocationSharing through the same
            // path the sender modal uses.
            this.props.onAccept({
                excludeOriginRadiusMeters: Number(this.state.excludeOriginRadiusMeters) || 0,
            });
        }
        this.props.close();
    }

    onCancel() {
        if (typeof this.props.onDecline === 'function') {
            this.props.onDecline();
        }
        this.props.close();
    }

    // Format the expiration timestamp for humans. Shows "today at 18:45"
    // when the expiry is later today, and "tomorrow at 02:15" otherwise.
    // We intentionally keep this dumb — the actual enforcement is the
    // ms timestamp, not the string.
    formatExpiry() {
        const ts = this.props.expiresAt;
        if (typeof ts !== 'number') return '';
        const d = new Date(ts);
        const now = new Date();
        const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const sameDay = d.toDateString() === now.toDateString();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const isTomorrow = d.toDateString() === tomorrow.toDateString();
        if (sameDay) return `today at ${hm}`;
        if (isTomorrow) return `tomorrow at ${hm}`;
        return `${d.toLocaleDateString()} at ${hm}`;
    }

    render() {
        const from = this.props.fromUri || 'your contact';
        const expiry = this.formatExpiry();

        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>Location sharing request</Text>

                                    <Text style={styles.body}>
                                        Would you like to share location with {from} until you meet?
                                    </Text>

                                    {/* Destination preview map. Rendered
                                        when the requester included a
                                        meeting destination on their
                                        meeting_request tick (every
                                        "Meet me there..." flow does;
                                        legacy / no-destination requests
                                        skip this block). The receiver
                                        sees a green pin at the
                                        destination + coords overlaid at
                                        the bottom + zoom +/- buttons,
                                        same vocabulary as the sender's
                                        ShareLocationModal preview so
                                        both ends read consistently. */}
                                    {(() => {
                                        const dest = this.props.destination;
                                        if (!dest
                                                || typeof dest.latitude !== 'number'
                                                || typeof dest.longitude !== 'number') {
                                            return null;
                                        }
                                        const PREVIEW_W = Math.max(
                                            240,
                                            Dimensions.get('window').width - 42
                                        );
                                        const PREVIEW_H = 200;
                                        // Auto-fit zoom from the
                                        // destination + user-pin
                                        // bounding box so the map
                                        // re-frames automatically
                                        // when the GPS fix lands.
                                        // Falls back to default
                                        // street-level zoom while the
                                        // bbox has only one point.
                                        const userLoc = this.props.userLocation;
                                        const _fitPoints = [
                                            {latitude: dest.latitude, longitude: dest.longitude},
                                        ];
                                        if (userLoc
                                                && typeof userLoc.latitude === 'number'
                                                && typeof userLoc.longitude === 'number') {
                                            _fitPoints.push({
                                                latitude: userLoc.latitude,
                                                longitude: userLoc.longitude,
                                            });
                                        }
                                        const _autoFitZoom = _fitPoints.length > 1
                                            ? pickZoomToFitPoints(_fitPoints, 40, PREVIEW_W, PREVIEW_H)
                                            : PREVIEW_DEFAULT_ZOOM;
                                        // null override → use auto-fit;
                                        // numeric override wins after
                                        // the user taps +/-.
                                        const zoom = (typeof this.state.previewZoom === 'number')
                                            ? this.state.previewZoom
                                            : _autoFitZoom;
                                        const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
                                        const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
                                        // Initials for the receiver's
                                        // own pin. Same helper the
                                        // sender modal uses, so '?'
                                        // only appears when
                                        // myDisplayName isn't passed.
                                        const _ownerInitials = initialsFromName(this.props.myDisplayName);
                                        return (
                                            <View style={{
                                                marginTop: 8,
                                                marginBottom: 4,
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
                                                    /* Receiver's own
                                                       location pin —
                                                       fetched in app.js's
                                                       _presentMeetingRequestForUri
                                                       and forwarded as
                                                       props.userLocation.
                                                       Absent until the
                                                       GPS fix lands,
                                                       then renders
                                                       alongside the
                                                       destination pin. */
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
                                                       circle around the
                                                       receiver's
                                                       position when the
                                                       slider is non-zero.
                                                       Skipped when slider
                                                       is "Off" or the
                                                       user fix hasn't
                                                       landed yet. */
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
                                                {/* Zoom + (top-right). */}
                                                <TouchableOpacity
                                                    onPress={() => this._adjustPreviewZoom(+1, _autoFitZoom)}
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
                                                {/* Zoom - (just below the +). */}
                                                <TouchableOpacity
                                                    onPress={() => this._adjustPreviewZoom(-1, _autoFitZoom)}
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
                                                {/* Coordinates strip overlay. */}
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
                                                            + dest.longitude.toFixed(5)}
                                                    </Text>
                                                </View>
                                            </View>
                                        );
                                    })()}

                                    {/* Consolidated disclosure + "Do not show
                                        this again" checkbox — same visual
                                        treatment as the sender-side
                                        ShareLocationModal: rounded-border
                                        container, smaller font, centered
                                        checkbox row tucked tight against
                                        the paragraph. The whole block is
                                        hidden when the user previously
                                        confirmed with the box ticked
                                        (props.disclaimerSuppressed) — that
                                        flag is shared with the sender
                                        modal so a single tick on either
                                        side hides the disclaimer
                                        everywhere. Both reset when the
                                        user opts out of the privacy
                                        policy. */}
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
                                                {'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. Sharing can be stopped at any time by clicking on the location icon. The sharing will automatically stop'
                                                    + (expiry ? ` ${expiry}` : '')
                                                    + ', and all data will be removed from both devices after meeting.'}
                                            </Text>

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

                                    {/* Policy notice — only when the user
                                        has not yet agreed to Sylk's
                                        location privacy policy. Tells them
                                        accepting will pop the policy modal
                                        first; consent is required for the
                                        meet session to proceed. */}
                                    {this.props.policyAcknowledged ? null : (
                                        <Text style={[styles.body, { marginTop: 8, fontSize: 12, opacity: 0.85, fontStyle: 'italic' }]}>
                                            {'When you tap Accept, you will be asked to review and agree to Sylk\'s location privacy policy before any data is sent.'}
                                        </Text>
                                    )}

                                    {/* Privacy-radius slider — same widget
                                        as the sender modal. Lets the
                                        accepter hide their own starting
                                        point (often home) for the first
                                        500 m / 2 km of the journey. The
                                        chosen value is forwarded through
                                        onAccept so app.js can pass it
                                        into NavigationBar's acceptance
                                        path. */}
                                    <PrivacyRadiusSlider
                                        value={this.state.excludeOriginRadiusMeters}
                                        onChange={this.setRadiusStop}
                                        title="Hide my starting location until I move:"
                                    />

                                    {/* Extra bottom padding so Cancel/Accept
                                        don't sit flush against the Surface's
                                        rounded bottom edge. Inline rather than
                                        in _DeleteMessageModal.scss because
                                        that stylesheet is shared with other
                                        dialogs whose layouts we don't want
                                        to disturb. */}
                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Cancel location sharing request"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onAccept}
                                            icon="map-marker"
                                            accessibilityLabel="Accept location sharing request"
                                        >
                                            Accept
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

MeetingRequestModal.propTypes = {
    show:                PropTypes.bool,
    close:               PropTypes.func.isRequired,
    onAccept:            PropTypes.func,
    onDecline:           PropTypes.func,
    fromUri:             PropTypes.string,
    expiresAt:           PropTypes.number,  // ms epoch
    // True when the user has previously agreed to Sylk's location
    // privacy policy. When false, the modal renders an inline note
    // telling them the policy modal will appear before any data is
    // sent. The actual policy gate runs inside startLocationSharing
    // (which the meeting acceptance flow calls).
    policyAcknowledged:  PropTypes.bool,
    // Meeting destination (lat/lng) the requester proposed. When
    // present, a small map preview is rendered at the top of the
    // modal so the receiver can see WHERE they're being invited
    // before tapping Accept. Optional — legacy meeting requests
    // without a destination simply omit the preview block.
    destination:         PropTypes.shape({
        latitude:  PropTypes.number,
        longitude: PropTypes.number,
    }),
    // True when the user previously confirmed/accepted with "Do not
    // show this again" ticked. Hides both the disclaimer text and
    // the checkbox itself. Same per-account flag the sender modal
    // toggles, so a single tick on either side hides the disclaimer
    // everywhere until the user opts out of the privacy policy.
    disclaimerSuppressed: PropTypes.bool,
    // Called by onAccept() when the user pressed Accept with the
    // checkbox ticked. The parent persists the suppression flag in
    // app_state.location.disclaimerSuppressed.
    onSuppressDisclaimer: PropTypes.func,
    // Receiver's own location for the preview map. Fetched as a
    // fire-and-forget getCurrentCoordinates() in app.js's
    // _presentMeetingRequestForUri — null while the fix is in flight.
    // Drives the user pin AND the privacy-radius circle (when the
    // slider is non-zero).
    userLocation:        PropTypes.shape({
        latitude:  PropTypes.number,
        longitude: PropTypes.number,
    }),
    // Local user's display name. First letter is used as the
    // receiver's avatar pin label. Falls back to '?' when missing —
    // same convention LocationBubble and ShareLocationModal use.
    myDisplayName:       PropTypes.string,
    // Last-used privacy radius from device preferences. Seeds the
    // slider's initial value when the modal opens; the modal calls
    // onPersistPrivacyRadius on Accept with the user's final
    // choice so the same value comes back next time.
    defaultPrivacyRadiusMeters: PropTypes.number,
    onPersistPrivacyRadius:     PropTypes.func,
};

export default MeetingRequestModal;
