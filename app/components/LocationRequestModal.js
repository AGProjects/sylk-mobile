import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Receiver-side prompt for an incoming "please share your current
// location" request. Fires once per request _id (the caller persists
// a "handled" marker so we don't reprompt after dismissal).
//
// Yes  → caller fires NavBar.shareLocationOnce(uri), shipping a single
//        location bubble back to the requester.
// No   → silent: no message is sent back, same convention as the
//        meeting-request decline.
class LocationRequestModal extends Component {
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
        const from = this.props.fromUri || 'your contact';

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
                                    <Text style={containerStyles.title}>Location request</Text>

                                    <Text style={styles.body}>
                                        {from} is requesting your current location.
                                    </Text>

                                    {/* End-to-end encryption note —
                                        same wording cadence as the
                                        sender-side modals so the
                                        prompts read consistently. */}
                                    <Text style={[styles.body, { marginTop: 12, fontSize: 12, opacity: 0.75 }]}>
                                        {'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. '
                                            + 'A single GPS fix will be sent and not updated afterwards. '
                                            + 'The location data can be deleted from both devices.'}
                                    </Text>

                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Cancel location request"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onAccept}
                                            icon="map-marker"
                                            accessibilityLabel="Send my current location"
                                        >
                                            Share once
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

LocationRequestModal.propTypes = {
    show:       PropTypes.bool,
    close:      PropTypes.func.isRequired,
    onAccept:   PropTypes.func,
    onDecline:  PropTypes.func,
    fromUri:    PropTypes.string,
};

export default LocationRequestModal;
