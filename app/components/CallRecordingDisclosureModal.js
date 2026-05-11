import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, ScrollView, KeyboardAvoidingView, Platform, Linking, StyleSheet } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Call-recording disclaimer modal. Mirrors the Location privacy
// disclosure flow so the look-and-feel is consistent across the app:
//
//   • Default mode (consent gate, before the user has opted in):
//     "Cancel" + "I agree" buttons. Caller persists the
//     acknowledgement only after onContinue fires; tapping Cancel
//     leaves the underlying preference toggle OFF.
//   • showOptOut mode (Preferences viewer, after the user has
//     opted in): "Close" + "Opt out" buttons. onOptOut clears the
//     flag AND flips the auto-record preference back to OFF so the
//     user's withdrawal is unambiguous.
//
// The body summarises the EU one-party-/all-party-consent split so
// the user gets a usable heads-up without having to leave the app.
// A live link to recordinglaw.com is rendered at the bottom for the
// definitive country-by-country reference.
//
// Component is purely presentational — `show` controls visibility,
// `onContinue` / `onCancel` / `onOptOut` close the loop. Persistence
// of the acknowledgement flag lives in the caller (PreferencesModal +
// callRecordingDisclosure.js) so the same modal can be reused for
// both the consent gate and the viewer.
class CallRecordingDisclosureModal extends Component {
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
        // `inline` mode: render as an absolute-fill View overlay
        // instead of an OS Modal. Required when this disclosure is
        // opened from inside another Modal (e.g. PreferencesModal) —
        // iOS only presents one Modal at a time per presentation
        // context, so a sibling Modal would silently fail to appear
        // until the parent Modal closed. The plain View overlay
        // layers on top of the parent Modal's Surface within the same
        // RN view tree, with no presentation-context limitation.
        if (!this.state.show) return null;
        const body = (
            <View style={containerStyles.overlay}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                    >
                        <Surface style={[containerStyles.modalSurface, { padding: 6 }]}>
                            {/* Title — override the shared
                                containerStyles.title (24pt, 14pt
                                padding) with a tighter version so
                                the modal doesn't dominate the
                                screen. Headline weight and centred
                                alignment kept. */}
                            <Text style={{
                                paddingHorizontal: 6,
                                paddingTop: 4,
                                paddingBottom: 2,
                                fontSize: 19,
                                fontWeight: '600',
                                textAlign: 'center',
                            }}>
                                Call recording can have consequences
                            </Text>

                            {/* Soft-cap the body height so the
                                disclosure stays usable on small phones
                                without spilling under the action
                                buttons. nestedScrollEnabled lets the
                                inner ScrollView grab the vertical-drag
                                gesture out of any surrounding wrappers
                                on Android. keyboardShouldPersistTaps
                                keeps the Linking-handled URL tappable
                                even if a keyboard is up. */}
                            <ScrollView
                                style={{ maxHeight: 360, paddingHorizontal: 4 }}
                                nestedScrollEnabled={true}
                                showsVerticalScrollIndicator={true}
                                keyboardShouldPersistTaps="handled"
                            >
                                {/* One-party-consent block. */}
                                <Text style={[styles.body, { marginTop: 2, fontSize: 15, fontWeight: 'bold' }]}>
                                    One-Party Consent Countries
                                </Text>
                                <Text style={[styles.body, { marginTop: 1, fontSize: 14, lineHeight: 18 }]}>
                                    In these countries, a participant in a conversation may
                                    record it without notifying or obtaining consent from the
                                    other parties, at least under the criminal wiretapping
                                    statute. GDPR obligations still apply separately.
                                </Text>
                                <Text style={[styles.body, { marginTop: 1, fontSize: 14, fontStyle: 'italic' }]}>
                                    Belgium, Netherlands, Italy, Poland, Spain, Sweden, Denmark,
                                    Finland, Ireland, Czech Republic, Romania, Latvia.
                                </Text>

                                {/* All-party-consent block. */}
                                <Text style={[styles.body, { marginTop: 6, fontSize: 15, fontWeight: 'bold' }]}>
                                    All-Party Consent Countries
                                </Text>
                                <Text style={[styles.body, { marginTop: 1, fontSize: 14, lineHeight: 18 }]}>
                                    In these countries, recording without the consent of all
                                    parties can carry criminal penalties, even for participants
                                    in the conversation.
                                </Text>
                                <Text style={[styles.body, { marginTop: 1, fontSize: 14, fontStyle: 'italic' }]}>
                                    Germany, France, Austria, Greece, Portugal, Switzerland,
                                    Cyprus.
                                </Text>

                                {/* Bottom-line warning, called out
                                    visually so it's the last thing the
                                    user reads before tapping a button. */}
                                <Text style={[styles.body, { marginTop: 6, fontSize: 15, fontWeight: 'bold' }]}>
                                    Check your local laws before recording calls.
                                </Text>

                                {/* Footer hint whose wording matches the
                                    button choice the user is about to
                                    make — same pattern the location
                                    disclosure uses. */}
                                <Text style={[styles.body, { marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 15 }]}>
                                    {this.props.showOptOut
                                        ? 'You have already agreed. Tap Opt out below to withdraw your consent; automatic call recording will be turned off and the disclaimer will reappear next time you enable it.'
                                        : 'Tapping "I agree" enables automatic call recording for new calls on this device. You can opt out from Preferences at any time.'}
                                </Text>

                                {/* Tappable link to the definitive
                                    country-by-country reference. Styled
                                    like a link (underline + accent
                                    colour) and routed through Linking
                                    so it opens in the system browser. */}
                                <Text
                                    style={[
                                        styles.body,
                                        {
                                            marginTop: 2,
                                            fontSize: 12,
                                            color: '#1976d2',
                                            textDecorationLine: 'underline',
                                        },
                                    ]}
                                    onPress={() => {
                                        Linking.openURL(
                                            'https://www.recordinglaw.com/world-laws/world-recording-laws/eu-recording-laws/'
                                        ).catch(() => {});
                                    }}
                                    accessibilityRole="link"
                                    accessibilityLabel="Open EU recording laws reference in browser"
                                >
                                    EU recording laws reference
                                </Text>
                            </ScrollView>

                            {/* Two button layouts:
                                  • Default (consent flow): "Cancel"
                                    (outlined, no-op) + "I agree"
                                    (contained, triggers onContinue
                                    which the caller turns into "set
                                    flag + flip preference ON").
                                  • showOptOut (viewer mode): "Close"
                                    (outlined, no-op) + "Opt out"
                                    (contained, clears the flag AND
                                    flips the preference OFF).
                                contentStyle/labelStyle compacts the
                                Paper Buttons to ~28px height with
                                12pt labels — same pill shape
                                EditContactModal / PreferencesModal
                                use, so the action row doesn't tower
                                over the body text. */}
                            <View style={[styles.buttonRow, { marginBottom: 4, marginTop: 6 }]}>
                                {this.props.showOptOut ? (
                                    <>
                                        <Button
                                            mode="outlined"
                                            compact
                                            style={[styles.button, { marginHorizontal: 4 }]}
                                            contentStyle={{ height: 30 }}
                                            labelStyle={{ fontSize: 12, marginVertical: 0 }}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Close call recording disclaimer"
                                        >
                                            Close
                                        </Button>
                                        <Button
                                            mode="contained"
                                            compact
                                            style={[styles.button, { marginHorizontal: 4 }]}
                                            contentStyle={{ height: 30 }}
                                            labelStyle={{ fontSize: 12, marginVertical: 0 }}
                                            onPress={this.onOptOut}
                                            icon="record-circle-outline"
                                            accessibilityLabel="Opt out — disable automatic call recording"
                                        >
                                            Opt out
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            mode="outlined"
                                            compact
                                            style={[styles.button, { marginHorizontal: 4 }]}
                                            contentStyle={{ height: 30 }}
                                            labelStyle={{ fontSize: 12, marginVertical: 0 }}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Decline call recording"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            compact
                                            style={[styles.button, { marginHorizontal: 4 }]}
                                            contentStyle={{ height: 30 }}
                                            labelStyle={{ fontSize: 12, marginVertical: 0 }}
                                            onPress={this.onContinue}
                                            icon="record-rec"
                                            accessibilityLabel="I agree and enable automatic call recording"
                                        >
                                            I agree
                                        </Button>
                                    </>
                                )}
                            </View>
                        </Surface>
                    </KeyboardAvoidingView>
                </View>
        );

        if (this.props.inline) {
            // Top-level absolute fill on top of whatever parent View
            // we're rendered inside. zIndex/elevation guarantee we sit
            // above the Preferences Surface on both iOS and Android.
            return (
                <View
                    style={[
                        StyleSheet.absoluteFillObject,
                        { zIndex: 1000, elevation: 1000 },
                    ]}
                    pointerEvents="box-none"
                >
                    {body}
                </View>
            );
        }

        return (
            <Modal
                style={containerStyles.container}
                visible={true}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                {body}
            </Modal>
        );
    }
}

CallRecordingDisclosureModal.propTypes = {
    show       : PropTypes.bool,
    onContinue : PropTypes.func.isRequired,
    onCancel   : PropTypes.func.isRequired,
    // Viewer mode (after the user has already agreed): swap "I agree"
    // for "Opt out" and route to onOptOut instead of onContinue.
    showOptOut : PropTypes.bool,
    onOptOut   : PropTypes.func,
    // Inline mode: render as a plain absolute-fill View overlay
    // instead of a Modal. Use when opened from inside another Modal
    // (iOS won't present nested Modals).
    inline     : PropTypes.bool,
};

export default CallRecordingDisclosureModal;
