import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    Platform,
    Text,
    Modal,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    StyleSheet,
} from 'react-native';
import { Button, Surface } from 'react-native-paper';

// Share the same Modal + Surface shell the other dialogs use, so the
// rounded-corner card and dimmed backdrop match EditContactModal and
// DeleteHistoryModal.
import containerStyles from '../assets/styles/ContainerStyles';

const styles = StyleSheet.create({
    title: {
        padding: 0,
        fontSize: 24,
        textAlign: 'center',
    },
    body: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 6,
        fontSize: 16,
        textAlign: 'center',
    },
    bullet: {
        paddingHorizontal: 28,
        paddingVertical: 2,
        fontSize: 14,
        textAlign: 'left',
    },
    warning: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
        fontSize: 14,
        textAlign: 'center',
        color: '#a00',
    },
    button: {
        margin: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 20,
    },
});

/**
 * Two-step destructive confirmation dialog for locally deleting the
 * currently active account. First tap on the destructive button arms
 * the confirm state and re-labels the button "Confirm delete"; second
 * tap fires `onConfirm`. Cancel is always available.
 */
class DeleteAccountModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = { confirm: false };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Reset the arm-state whenever the modal opens so we never start
        // already-armed.
        if (nextProps.show && !this.props.show) {
            this.setState({ confirm: false });
        }
    }

    handleDelete() {
        if (this.state.confirm) {
            this.setState({ confirm: false });
            this.props.onConfirm();
            this.props.close();
            return;
        }
        this.setState({ confirm: true });
    }

    handleCancel() {
        this.setState({ confirm: false });
        this.props.close();
    }

    render() {
        if (!this.props.show) return null;

        const label = this.state.confirm ? 'Confirm delete' : 'Delete account';
        const accountId = this.props.accountId || '';

        return (
            <Modal
                style={containerStyles.container}
                visible={this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.handleCancel}
            >
                <TouchableWithoutFeedback onPress={this.handleCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <Text style={[containerStyles.title, styles.title]}>
                                        Delete account
                                    </Text>

                                    <Text style={styles.body}>
                                        You are about to permanently remove{'\n'}
                                        <Text style={{ fontWeight: 'bold' }}>{accountId}</Text>{'\n'}
                                        from this device.
                                    </Text>

                                    <Text style={styles.bullet}>• Your messages on this device will be deleted.</Text>
                                    <Text style={styles.bullet}>• Your local contacts for this account will be deleted.</Text>
                                    <Text style={styles.bullet}>• Your PGP private key on this device will be deleted.</Text>
                                    <Text style={styles.bullet}>• Cached files for this account will be deleted.</Text>

                                    <Text style={styles.warning}>
                                        This cannot be undone. Messages stored on the server are not
                                        affected and will re-sync if you sign in again.
                                    </Text>

                                    <View style={styles.buttonRow}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.handleCancel}
                                            accessibilityLabel="Cancel"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={[styles.button, { backgroundColor: '#c62828' }]}
                                            icon="delete"
                                            onPress={this.handleDelete}
                                            accessibilityLabel={label}
                                        >
                                            {label}
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

DeleteAccountModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    onConfirm: PropTypes.func.isRequired,
    accountId: PropTypes.string,
};

export default DeleteAccountModal;
