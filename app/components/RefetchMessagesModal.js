import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { Text, Button, Surface, TextInput } from 'react-native-paper';

// Share the Modal + dimmed-overlay + rounded Surface shell with
// DeleteHistoryModal / EditContactModal / ShareLocationModal so every
// dialog in the app reads as the same rounded-corner card on a dimmed
// backdrop.
import containerStyles from '../assets/styles/ContainerStyles';

// Quick-pick presets shown as a row of chips above the numeric field.
// Tapping one fills the input; the user can still type an arbitrary
// number of days. "All" maps to a deliberately large day count so
// app.js resetStorage() takes its full-message-reset branch (days > 365)
// — which now clears ONLY messages, never contacts.
const ALL_DAYS = 99999;
const PRESETS = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1y', days: 365 },
    { label: 'All', days: ALL_DAYS },
];

const styles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'column',
        alignItems: 'center',
    },
    body: {
        padding: 10,
        fontSize: 16,
        textAlign: 'center',
    },
    presetRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 4,
        marginBottom: 4,
    },
    presetButton: {
        margin: 4,
    },
    inputWrap: {
        marginHorizontal: 24,
        marginTop: 8,
    },
    input: {
        backgroundColor: 'transparent',
    },
    hint: {
        fontSize: 12,
        color: '#666',
        textAlign: 'center',
        marginTop: 6,
        marginHorizontal: 20,
    },
    error: {
        fontSize: 12,
        color: 'red',
        textAlign: 'center',
        marginTop: 6,
    },
    button: {
        margin: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 10,
        marginTop: 8,
    },
});

class RefetchMessagesModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            show: this.props.show,
            // Default to a one-month window — the common "I'm missing
            // recent messages on a fresh device" case.
            daysText: '30',
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.show !== this.props.show) {
            const update = { show: nextProps.show };
            // Reset the field to the default each time the modal opens so a
            // previous session's value doesn't linger.
            if (nextProps.show && !this.props.show) {
                update.daysText = '30';
            }
            this.setState(update);
        }
    }

    setPreset(days) {
        this.setState({ daysText: String(days) });
    }

    onChangeDays(text) {
        // Digits only — strip anything else so the parsed value is always a
        // clean positive integer.
        const cleaned = (text || '').replace(/[^0-9]/g, '');
        this.setState({ daysText: cleaned });
    }

    parsedDays() {
        const n = parseInt(this.state.daysText, 10);
        if (isNaN(n) || n <= 0) return null;
        return n;
    }

    apply() {
        const days = this.parsedDays();
        if (days == null) return;

        // refetchMessages(days, uri) lives in app.js. It:
        //   1. resetStorage(days) — deletes locally stored MESSAGES (newer
        //      than `days` ago, or all of them when days > 365) for this
        //      account, never touching contacts, and nulls the sync-cursor id
        //      while PRESERVING the per-account last_sync_timestamp.
        //   2. requestSyncConversations(null, { since: days ago }) — re-pulls
        //      the journal from the server for that window, overwriting the
        //      local store with the authoritative server copy.
        // Passing the selected contact's uri (when one is open) only scopes
        // the in-sync "new message" highlight; the storage reset itself is
        // account-wide.
        this.props.refetchMessages(days, this.props.selectedContact?.uri);
        this.props.close();
    }

    render() {
        const days = this.parsedDays();
        const invalid = days == null;

        const shell = (inner) => (
            <Modal
                style={containerStyles.container}
                // Coerce to boolean — RN's Modal renders when `visible` is
                // undefined, so without `!!` it can pop up on cold start.
                visible={!!this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.props.close}
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <TouchableWithoutFeedback onPress={this.props.close}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={containerStyles.modalSurface}>
                                    {inner}
                                </ThemedModalSurface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );

        return shell(
            <>
                <View style={styles.titleContainer}>
                    <Text style={containerStyles.title}>Refetch messages</Text>
                </View>

                <Text style={styles.body}>
                    Select how many days to go back. Messages in that window are
                    re-downloaded from the server, replacing what's stored on
                    this device.
                </Text>

                <View style={styles.presetRow}>
                    {PRESETS.map(p => (
                        <Button
                            key={p.label}
                            mode={String(p.days) === this.state.daysText ? 'contained' : 'outlined'}
                            compact
                            uppercase={false}
                            style={styles.presetButton}
                            onPress={() => this.setPreset(p.days)}
                        >
                            {p.label}
                        </Button>
                    ))}
                </View>

                <View style={styles.inputWrap}>
                    <TextInput
                        mode="outlined"
                        label="Days to go back"
                        keyboardType="number-pad"
                        value={this.state.daysText}
                        onChangeText={this.onChangeDays}
                        style={styles.input}
                        maxLength={5}
                    />
                </View>

                {invalid ? (
                    <Text style={styles.error}>Enter a number of days greater than 0.</Text>
                ) : (
                    <Text style={styles.hint}>
                        {days >= ALL_DAYS
                            ? 'Re-downloads all messages. Contacts are kept.'
                            : `Re-downloads the last ${days} day${days === 1 ? '' : 's'}. Contacts are kept.`}
                    </Text>
                )}

                <View style={styles.buttonRow}>
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.props.close}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        style={styles.button}
                        onPress={this.apply}
                        disabled={invalid}
                        icon="cloud-download"
                        accessibilityLabel="Apply"
                    >
                        Apply
                    </Button>
                </View>
            </>
        );
    }
}

RefetchMessagesModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    refetchMessages: PropTypes.func.isRequired,
    selectedContact: PropTypes.object,
};

export default RefetchMessagesModal;
