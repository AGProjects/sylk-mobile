import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, ScrollView, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Google Play "Prominent Disclosure" — required before we collect or
// transmit a user's precise location. Per the Permissions and APIs
// that access Sensitive Information policy, this disclosure MUST:
//
//   • be presented inside the app (not only in the listing description
//     or privacy policy) — this is that screen.
//   • appear in the normal usage flow, not buried in a settings menu
//     — caller fires it the very first time the user attempts to
//     start a location share.
//   • describe what data is being accessed (precise GPS location),
//     how it's used (sent to the contact picked by the user), and
//     how/where it's shared (peer-to-peer, end-to-end encrypted) —
//     spelled out in the body text below.
//   • appear BEFORE the system permission dialog — caller awaits this
//     modal's confirmation, then proceeds to the OS prompt.
//   • not be combined with unrelated disclosures (e.g. T&Cs, login,
//     marketing) — this modal is single-purpose.
//
// The "Not now" path is intentionally given equal weight: the user
// must be able to decline without granting any permission. After they
// dismiss without continuing, no permission is requested and no
// location is read.
//
// AsyncStorage gating lives in the caller (NavigationBar). This
// component is purely presentational — `show` controls visibility,
// `onContinue` / `onCancel` close the loop. The caller persists the
// "user has seen this" flag only after onContinue fires so a single
// glance + dismissal doesn't accidentally suppress future showings.
class LocationPrivacyDisclosureModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show});
    }

    onContinue() {
        if (typeof this.props.onContinue === 'function') {
            this.props.onContinue();
        }
    }

    onCancel() {
        if (typeof this.props.onCancel === 'function') {
            this.props.onCancel();
        }
    }

    onOptOut() {
        if (typeof this.props.onOptOut === 'function') {
            this.props.onOptOut();
        }
    }

    render() {
        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                {/* No outer TouchableWithoutFeedback for tap-to-dismiss
                    — the previous nested-TouchableWithoutFeedback layout
                    swallowed every vertical-drag gesture before the
                    inner ScrollView could see it, so the user couldn't
                    scroll the disclosure body at all. The user can
                    still close the modal explicitly via the buttons or
                    the device back button (onRequestClose handles
                    Android back). For a Prominent Disclosure that's
                    actually preferable: implicit dismissal-by-tap-
                    outside isn't a reliable consent signal anyway. */}
                <View style={containerStyles.overlay}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                    >
                            <Surface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>
                                        Location privacy policy
                                    </Text>

                                    {/* The body is wrapped in a ScrollView with
                                        a soft height cap so the disclosure
                                        stays usable on small phones — Pixel 4a
                                        / iPhone SE — without spilling under
                                        the action buttons.
                                        nestedScrollEnabled lets the inner
                                        ScrollView grab the vertical-drag
                                        gesture out of the surrounding
                                        TouchableWithoutFeedback wrappers on
                                        Android (which would otherwise eat
                                        the move event before the scroll
                                        handler could see it).
                                        keyboardShouldPersistTaps='handled'
                                        keeps tapping on the inline link
                                        below working without first having
                                        to dismiss any keyboard.
                                        showsVerticalScrollIndicator gives
                                        the user a visual cue that there's
                                        more content below the cut. */}
                                    <ScrollView
                                        style={{ maxHeight: 360 }}
                                        nestedScrollEnabled={true}
                                        showsVerticalScrollIndicator={true}
                                        keyboardShouldPersistTaps="handled"
                                    >
                                        {/* WHAT — name the data being collected. */}
                                        <Text style={[styles.body, { marginTop: 8 }]}>
                                            Sylk reads your device's precise GPS location only when you
                                            tap "Share location" or accept a "Meet me" request from a
                                            contact. No location data is collected at any other time.
                                        </Text>

                                        {/* HOW IT'S USED + WHO IT'S SHARED WITH —
                                            single contact, end-to-end encrypted,
                                            server stores ciphertext only and
                                            purges on expiry. */}
                                        <Text style={[styles.body, { marginTop: 12 }]}>
                                            Your location is sent only to the contact you select for that
                                            specific share. It is encrypted end-to-end between your device
                                            and theirs. Sylk's server retains the encrypted message in
                                            your account journal so the recipient can receive it after a
                                            reconnect, but the server cannot decrypt it; the journal entry
                                            is automatically purged once the share's expiration date is
                                            reached or the user deletes the message.
                                        </Text>

                                        {/* BACKGROUND USE — Google requires this
                                            be called out explicitly when an app
                                            requests ACCESS_BACKGROUND_LOCATION
                                            (we do, on Android, to keep ticks
                                            flowing while Sylk is off-screen). */}
                                        <Text style={[styles.body, { marginTop: 12 }]}>
                                            While a sharing session is active, Sylk continues to send
                                            location updates to your chosen contact even when the app is
                                            in the background, so the user can use other applications
                                            than Sylk during this time. Sharing stops automatically when the
                                            session ends or when you tap the location icon to stop it.
                                        </Text>

                                        {/* RETENTION — single paragraph covering
                                            on-device + on-server purge schedules,
                                            plus the 7-day default-expiry fallback. */}
                                        <Text style={[styles.body, { marginTop: 12 }]}>
                                            On your device, location data is removed when a "Meet me"
                                            session ends, and kept for at most 7 days for timed shares
                                            before automatic deletion. On Sylk's server, the encrypted
                                            journal entry is automatically purged once the share's
                                            expiration date is reached — the server never holds an
                                            unexpired share past its own deadline, and never holds it in
                                            a form Sylk can read. If no expiration date is given, a
                                            7-day expiration is enforced.
                                        </Text>

                                        {/* Footer line whose wording matches the
                                            button choice the user is about to
                                            make:
                                              • Default (consent / viewer-not-
                                                yet-agreed): explains that "I
                                                agree" leads into the Android
                                                permission dialog, plus a
                                                pointer to the full policy.
                                              • Viewer-after-agreement
                                                (showOptOut): tells the user
                                                they've already agreed and
                                                directs them to the Opt out
                                                button below if they want to
                                                withdraw. */}
                                        <Text style={[styles.body, { marginTop: 12, fontSize: 11, opacity: 0.7 }]}>
                                            {this.props.showOptOut
                                                ? 'You have already agreed. Tap Opt out below to withdraw your consent; the policy will reappear before your next share.'
                                                : 'Tapping "I agree" will ask Android for permission to access your device location. Full details are in Sylk\'s Privacy Policy.'}
                                        </Text>
                                        {/* Direct, tappable pointer to the
                                            sip2sip server's full privacy
                                            policy — separate from the local-
                                            client policy line above so the
                                            user can act on it (Linking opens
                                            the system browser). Styled like
                                            a link (underline + accent colour)
                                            so it reads as something
                                            interactive rather than another
                                            footnote. */}
                                        <Text
                                            style={[
                                                styles.body,
                                                {
                                                    marginTop: 6,
                                                    fontSize: 11,
                                                    color: '#1976d2',
                                                    textDecorationLine: 'underline',
                                                },
                                            ]}
                                            onPress={() => {
                                                Linking.openURL('https://sip2sip.info/privacy/').catch(() => {});
                                            }}
                                            accessibilityRole="link"
                                            accessibilityLabel="Open Sylk server privacy policy in browser"
                                        >
                                            Server privacy policy
                                        </Text>
                                    </ScrollView>

                                    {/* Two button layouts:
                                          • Default (consent flow OR viewer
                                            without prior agreement): "Not now"
                                            (outlined, decline) + "I agree"
                                            (contained, accept). "Not now" must
                                            be a real escape — declining must
                                            NOT advance to the OS permission
                                            prompt or start any data
                                            collection.
                                          • showOptOut (viewer + the user has
                                            already agreed): "Close" (outlined,
                                            no-op dismiss) + "Opt out"
                                            (contained, clears the agreement
                                            flag so the next share request
                                            re-prompts). */}
                                    <View style={[styles.buttonRow, { marginBottom: 16, marginTop: 12 }]}>
                                        {this.props.showOptOut ? (
                                            <>
                                                <Button
                                                    mode="outlined"
                                                    style={styles.button}
                                                    onPress={this.onCancel}
                                                    accessibilityLabel="Close privacy policy"
                                                >
                                                    Close
                                                </Button>
                                                <Button
                                                    mode="contained"
                                                    style={styles.button}
                                                    onPress={this.onOptOut}
                                                    icon="shield-off"
                                                    accessibilityLabel="Opt out — clear location sharing agreement"
                                                >
                                                    Opt out
                                                </Button>
                                            </>
                                        ) : (
                                            <>
                                                <Button
                                                    mode="outlined"
                                                    style={styles.button}
                                                    onPress={this.onCancel}
                                                    accessibilityLabel="Decline location sharing"
                                                >
                                                    Not now
                                                </Button>
                                                <Button
                                                    mode="contained"
                                                    style={styles.button}
                                                    onPress={this.onContinue}
                                                    icon="map-marker"
                                                    accessibilityLabel="I agree and grant location permission"
                                                >
                                                    I agree
                                                </Button>
                                            </>
                                        )}
                                    </View>
                            </Surface>
                    </KeyboardAvoidingView>
                </View>
            </Modal>
        );
    }
}

LocationPrivacyDisclosureModal.propTypes = {
    show        : PropTypes.bool,
    onContinue  : PropTypes.func.isRequired,
    onCancel    : PropTypes.func.isRequired,
    // Viewer-mode-after-agreement only: when true, the action button
    // becomes "Opt out" and routes to onOptOut instead of onContinue.
    showOptOut  : PropTypes.bool,
    onOptOut    : PropTypes.func,
};

export default LocationPrivacyDisclosureModal;
