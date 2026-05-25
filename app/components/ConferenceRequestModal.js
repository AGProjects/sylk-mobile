import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Receiver-side prompt for an incoming "Escalate this call to a
// conference" request. Mirrors LocationRequestModal in shape so the
// two handshakes read consistently to the user — a small Accept /
// Reject panel that auto-dismisses after the metadata's `expires`
// window (60 s by convention; the timer is owned by app.js, not the
// modal).
//
// Accept → app.js echoes the same conference_request metadata back
//          with its own uri as `requester` (the contract the peer
//          listens for) and immediately tears down the current 1-1
//          call so it can dial the agreed conference room.
// Reject → silent: no message is sent back, same convention as the
//          meeting-request / location-request decline paths.
class ConferenceRequestModal extends Component {
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
                                    <Text style={containerStyles.title}>Move call to conference</Text>

                                    <Text style={styles.body}>
                                        {from} would like to escalate this call to a conference and invite other people.
                                    </Text>

                                    <Text style={[styles.body, { marginTop: 12, fontSize: 12, opacity: 0.75 }]}>
                                        {'If you accept, the current call will end and both parties will '
                                            + 'automatically join the same conference room. From there you can '
                                            + 'invite additional participants.'}
                                    </Text>

                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Reject conference request"
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onAccept}
                                            icon="account-multiple-plus"
                                            accessibilityLabel="Accept conference request"
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

ConferenceRequestModal.propTypes = {
    show:      PropTypes.bool,
    close:     PropTypes.func.isRequired,
    onAccept:  PropTypes.func,
    onDecline: PropTypes.func,
    fromUri:   PropTypes.string,
};

export default ConferenceRequestModal;
