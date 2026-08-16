import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Receiver-side prompt for an incoming "Please share your screen"
// request. Mirrors ConferenceRequestModal / LocationRequestModal in
// shape so the three in-call handshakes read consistently to the user
// — a small Accept / Reject panel that auto-dismisses after the
// request's `expires` window (60 s by convention; the timer is owned
// by app.js, not the modal).
//
// Accept → app.js sends `request_accept` back over the in-call
//          application/sylk-screen-sharing channel and hands the
//          mounted VideoBox a "start sharing now" event, which runs
//          the ordinary selectScreenShare() path (OS consent dialog
//          included — accepting here does NOT bypass the system
//          screen-capture prompt).
// Reject → app.js sends `request_reject` so the requester's kebab can
//          drop out of "Requesting screen…" immediately instead of
//          waiting out the 60 s expiry.
class ScreenShareRequestModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = { show: props.show };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({ show: nextProps.show });
    }

    onAccept() {
        if (typeof this.props.onAccept === 'function') {
            this.props.onAccept();
        }
        this.props.close();
    }

    onCancel() {
        if (typeof this.props.onDecline === 'function') {
            this.props.onDecline();
        }
        this.props.close();
    }

    render() {
        const from = this.props.fromName || this.props.fromUri || 'your contact';

        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
                /* iOS-only — without this, RN's Modal defaults to
                   supportedOrientations: ['portrait'], which forces
                   the app's orientation to portrait whenever this
                   panel appears (the underlying landscape call view
                   snaps to portrait until dismissed). Include both
                   landscape variants so the panel inherits whichever
                   landscape the user is currently in. */
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>Share your screen</Text>

                                    <Text style={styles.body}>
                                        {from} would like to see your screen.
                                    </Text>

                                    <Text style={[styles.body, { marginTop: 12, fontSize: 12, opacity: 0.75 }]}>
                                        {'If you accept, your device will ask you to confirm screen '
                                            + 'recording, and everything on your screen — including '
                                            + 'notifications and other apps — becomes visible to '
                                            + 'them until you stop sharing.'}
                                    </Text>

                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Reject screen sharing request"
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onAccept}
                                            icon="monitor-share"
                                            accessibilityLabel="Accept screen sharing request"
                                        >
                                            Accept
                                        </Button>
                                    </View>
                                </ThemedModalSurface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

ScreenShareRequestModal.propTypes = {
    show:      PropTypes.bool,
    close:     PropTypes.func.isRequired,
    onAccept:  PropTypes.func,
    onDecline: PropTypes.func,
    fromUri:   PropTypes.string,
    fromName:  PropTypes.string,
};

export default ScreenShareRequestModal;
