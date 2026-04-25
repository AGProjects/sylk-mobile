import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';

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
            // side — 0 disables the gate, 500 / 2000 are the user-
            // visible stops. The accepter's first GPS fix is the
            // "starting point" they're hiding from the requester.
            excludeOriginRadiusMeters: 0,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Reset the slider to "Off" each time the modal re-opens so a
        // previous prompt's choice doesn't carry over to the next
        // request.
        if (nextProps.show && !this.state.show) {
            this.setState({show: true, excludeOriginRadiusMeters: 0});
        } else {
            this.setState({show: nextProps.show});
        }
    }

    setRadiusStop(meters) {
        this.setState({excludeOriginRadiusMeters: meters});
    }

    onAccept() {
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

                                    {/* Consolidated disclosure — mirrors the
                                        sender-side ShareLocationModal so the
                                        two ends read consistently:
                                        end-to-end encryption note first,
                                        then the auto-stop / retention
                                        wording for this request. */}
                                    <Text style={[styles.body, { marginTop: 12, fontSize: 12, opacity: 0.75 }]}>
                                        {'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. Sharing can be stopped at any time by clicking on the location icon. The sharing will automatically stop'
                                            + (expiry ? ` ${expiry}` : '')
                                            + ', and all data will be removed from both devices after meeting.'}
                                    </Text>

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
    show:       PropTypes.bool,
    close:      PropTypes.func.isRequired,
    onAccept:   PropTypes.func,
    onDecline:  PropTypes.func,
    fromUri:    PropTypes.string,
    expiresAt:  PropTypes.number,  // ms epoch
};

export default MeetingRequestModal;
