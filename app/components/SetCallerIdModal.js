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
import { Button, Surface, TextInput, ActivityIndicator } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import { validateCallerId, isPlaceholderCallerId } from '../accountInfo';

const styles = StyleSheet.create({
    title: {
        padding: 0,
        fontSize: 22,
        textAlign: 'center',
    },
    body: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 6,
        fontSize: 14,
        textAlign: 'center',
        color: '#444',
    },
    hint: {
        paddingHorizontal: 20,
        paddingTop: 2,
        paddingBottom: 8,
        fontSize: 11,
        color: '#777',
        textAlign: 'center',
    },
    inputWrap: {
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 4,
    },
    error: {
        paddingHorizontal: 22,
        paddingTop: 2,
        fontSize: 12,
        color: '#b22',
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingTop: 6,
        paddingBottom: 12,
    },
    button: {
        marginHorizontal: 6,
    },
});

/**
 * Modal that prompts the user to enter their mobile number, which the
 * SIP proxy will use as the PSTN Caller-Id (rpid) on outgoing PSTN
 * calls. Opened from the pre-flight gate inside callKeepStartCall when
 * the server's pstn.caller_id is missing.
 *
 *   • Android: attempts a one-shot SIM read on mount (via the
 *     readDevicePhoneNumber prop) and pre-fills the field. The user
 *     can still edit / clear.
 *   • iOS:    field starts empty (Apple doesn't expose the SIM
 *     number to apps).
 *
 *   On Save:
 *     1. setServerCallerId(value)  → POST to sylk_settings.phtml
 *        action=set_caller_id (writes the SIP account's rpid).
 *     2. setMyAccountPhoneNumber(value) → local accountSetting.account
 *        .myPhoneNumber cache (used by other PSTN paths).
 *     3. close()
 *
 *   On Cancel: the modal dismisses without changes; the gate that
 *   opened it has already aborted the outgoing call.
 */
class SetCallerIdModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            value: '',
            error: null,
            saving: false,
            simLookupAttempted: false,
        };
    }

    componentDidUpdate(prevProps) {
        if (this.props.show && !prevProps.show) {
            // Pre-fill priority (server is source of truth):
            //   1. props.serverCallerId — the SIP account's current
            //      rpid as reported by sylk_settings.phtml. When the
            //      modal is opened because rpid is empty this is ''
            //      and we fall through. When the modal is opened
            //      from a "change my caller-Id" UI later, this will
            //      be the current value.
            //   2. Android SIM auto-detect (READ_PHONE_NUMBERS).
            //   3. Empty — user types from scratch.
            //
            // The locally-cached accountSetting.account.myPhoneNumber
            // is NOT consulted as a pre-fill: the server's rpid is
            // authoritative for "what gets presented as Caller-Id".
            // Treat the "+19999999999" / "0019999999999" sentinel as
            // unset — the SIP proxy uses it as a placeholder meaning
            // "no Caller-Id configured". Pre-filling that value would
            // leave the user editing a fake number; instead we drop
            // straight to the empty-field path (SIM auto-detect on
            // Android, otherwise type-from-scratch). isPlaceholderCallerId
            // handles both wire shapes (00- and +-prefixed).
            const rawServerCallerId = (this.props.serverCallerId || '').trim();
            const serverCallerId = isPlaceholderCallerId(rawServerCallerId)
                ? '' : rawServerCallerId;
            console.log('[set-caller-id] modal opening',
                JSON.stringify({
                    serverCallerId:    serverCallerId,
                    placeholderDetected: rawServerCallerId !== '' && serverCallerId === '',
                    platform:          Platform.OS,
                    willAutoDetectSim: !serverCallerId
                                       && Platform.OS === 'android'
                                       && typeof this.props.readDevicePhoneNumber === 'function',
                })
            );
            this.setState({
                value: serverCallerId,
                error: null,
                saving: false,
                simLookupAttempted: false,
            });
            if (!serverCallerId
                && Platform.OS === 'android'
                && typeof this.props.readDevicePhoneNumber === 'function') {
                this.setState({ simLookupAttempted: true });
                this.props.readDevicePhoneNumber()
                    .then((num) => {
                        if (num && (this.state.value || '') === '') {
                            this.setState({ value: num });
                        }
                    })
                    .catch(() => { /* helper logs; ignore */ });
            }
        }
    }

    handleCancel() {
        this.setState({ value: '', error: null, saving: false });
        this.props.close();
    }

    async handleSave() {
        const trimmed = (this.state.value || '').trim();
        // Empty value is NOT useful here — the whole point of this
        // modal is to capture a number — so we treat empty as an
        // error rather than allowing a clear.
        if (!trimmed) {
            this.setState({ error: 'Please enter your mobile number.' });
            return;
        }
        const err = validateCallerId(trimmed);
        if (err) {
            this.setState({ error: err });
            return;
        }

        this.setState({ saving: true, error: null });

        // 1. Server-side rpid. Throws on auth / validation / SOAP
        //    error — we surface the message inline and let the user
        //    fix and retry.
        try {
            if (typeof this.props.setServerCallerId === 'function') {
                await this.props.setServerCallerId(trimmed);
            }
        } catch (e) {
            this.setState({
                saving: false,
                error: (e && e.message) || 'Could not save to server',
            });
            return;
        }

        // 2. Local cache — mirror into accountSetting.account
        //    .myPhoneNumber so other PSTN paths (caller-Id pre-flight
        //    on the next call, payment receipts, etc.) see the new
        //    value without waiting on the next snapshot refresh.
        try {
            if (typeof this.props.setMyAccountPhoneNumber === 'function') {
                this.props.setMyAccountPhoneNumber(trimmed);
            }
        } catch (e) {
            console.log('[set-caller-id] local cache write failed:', e && e.message);
        }

        this.setState({ saving: false });
        this.props.close();
    }

    render() {
        if (!this.props.show) return null;

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
                                        Set your mobile number
                                    </Text>
                                    <Text style={styles.body}>
                                        Required before placing PSTN calls — used as your caller Id by the SIP proxy.
                                    </Text>
                                    <View style={styles.inputWrap}>
                                        <TextInput
                                            mode="flat"
                                            label="Mobile number"
                                            keyboardType="phone-pad"
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            autoComplete="off"
                                            importantForAutofill="no"
                                            textContentType="telephoneNumber"
                                            value={this.state.value}
                                            onChangeText={(t) => this.setState({
                                                value: t,
                                                error: null,
                                            })}
                                            editable={!this.state.saving}
                                        />
                                    </View>
                                    {this.state.error ? (
                                        <Text style={styles.error}>{this.state.error}</Text>
                                    ) : (
                                        <Text style={styles.hint}>
                                            International format. + or 00 prefix, 7–15 digits.
                                        </Text>
                                    )}
                                    <View style={styles.buttonRow}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.handleCancel}
                                            disabled={this.state.saving}
                                        >
                                            Cancel
                                        </Button>
                                        {this.state.saving ? (
                                            <View style={[styles.button, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }]}>
                                                <ActivityIndicator size="small" />
                                                <Text style={{ marginLeft: 8 }}>Saving…</Text>
                                            </View>
                                        ) : (
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                onPress={this.handleSave}
                                                icon="content-save"
                                            >
                                                Save
                                            </Button>
                                        )}
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

SetCallerIdModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    // Server-side write: POST sylk_settings.phtml action=set_caller_id.
    setServerCallerId: PropTypes.func,
    // Local cache write: accountSetting.account.myPhoneNumber.
    setMyAccountPhoneNumber: PropTypes.func,
    // Android SIM auto-fill helper (returns '' on iOS or denial).
    readDevicePhoneNumber: PropTypes.func,
    // Current server-side Caller-Id (pstn.caller_id / rpid). Used
    // as the pre-fill when the modal opens — server is the source
    // of truth. Empty for the common "first time setup" case.
    serverCallerId: PropTypes.string,
};

export default SetCallerIdModal;
