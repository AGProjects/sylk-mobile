import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Platform, View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import styles from '../assets/styles/blink/_PrivateKeyModal.scss';
import utils from '../utils';

// Use the keyboard-aware dialog on BOTH platforms. The import flow has a
// numeric pincode field auto-focused on mount, so the OS keyboard pops
// straight up and pushes the bottom of the dialog (where "Import key"
// lives) below the keyboard line. KeyBoardAwareDialog wraps the body in a
// KeyboardSpacer that gives us correct lift on iOS AND Android — the
// underlying react-native-keyboard-spacer hooks the right
// keyboardWillShow / keyboardDidShow events per-platform internally.
//
// Previously this module did `Platform.OS === 'ios' ? … : Dialog` while
// also failing to import `Platform`, so on Android it silently fell back
// to the raw paper Dialog (no keyboard handling) and on iOS the
// `Platform` reference would have ReferenceError'd at module init had
// any path actually evaluated it. Both bugs are gone now.
const DialogType = KeyboardAwareDialog;

class ImportPrivateKeyModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            password: this.props.password,
            show: this.props.show,
            privateKey: this.props.privateKey,
            status: this.props.status,
            confirm: false,
            keyStatus: this.props.keyStatus,
            success: this.props.success,
            keyDifferentOnServer: this.props.keyDifferentOnServer
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // `confirm` is LOCAL two-tap state (Generate key → Confirm), not a prop —
        // app.js has never passed one. Copying `nextProps.confirm` in here wrote
        // `undefined` over it on EVERY parent re-render, and the parent re-renders
        // constantly (key checks, contact updates, registration state). So the
        // first tap set confirm=true, the next incidental re-render silently reset
        // the button to "Generate key", and the second tap only ever re-armed it:
        // the user could tap forever and never generate a key. Same for `password`
        // (also not a prop). Both stay local.
        this.setState({show: nextProps.show,
                       privateKey: nextProps.privateKey,
                       status: nextProps.status,
                       success: nextProps.success,
                       keyStatus: nextProps.keyStatus,
                       keyDifferentOnServer: nextProps.keyDifferentOnServer
                       });

        // A fresh open starts unarmed — a stale confirm from a previous showing
        // must never turn the first tap of a new dialog into a destructive one.
        if (nextProps.show && !this.props.show) {
            this.setState({confirm: false});
        }

        if (nextProps.success) {
            setTimeout(() => {
                this.props.close();
            }, 3000);
        }
    }

    save(event) {
        this.props.saveFunc(this.state.password);
    }

    generateKeys(event) {
        // Log both taps. Whether the user reached the second one is otherwise
        // invisible in a release log — the whole "I press Generate and nothing
        // happens" report (the confirm-state clobber) was undiagnosable because
        // this control was silent.
        if (this.state.confirm) {
            utils.timestampedLog('[pgp] [modal] Generate key CONFIRMED — generating');
            this.setState({password: ''});
            this.props.close();
            this.props.generateKeysFunc();
        } else {
            utils.timestampedLog('[pgp] [modal] Generate key armed — waiting for Confirm tap');
            this.setState({confirm: true});
        }
    }

    useExistingKeys(event) {
        event.preventDefault();
        utils.timestampedLog('[pgp] [modal] Use this device key tapped');
        this.setState({password: ''});
        this.props.useExistingKeysFunc();
        this.props.close();
    }

    get disableButton() {
        if (!this.state.password || this.state.password.length < 6) {
            return true;
        }

        if (this.state.success) {
            return true;
        }

        return false;
    }

    onInputChange(value) {
        this.setState({password: value});
    }

    render() {
        const statusStyle = this.state.success ? styles.status : styles.statusFailed;

        // Which of the three faces is on screen. Logged once per opening so a
        // report of "the modal is stuck" says WHICH dialog, and therefore which
        // buttons the user actually had.
        if (this.state.show) {
            const _branch = this.state.privateKey ? 'import-pincode'
                : this.state.keyDifferentOnServer ? 'key-differs-on-server (only "Use this device key")'
                : 'no-local-key (offers "Generate key")';
            if (this._loggedBranch !== _branch) {
                this._loggedBranch = _branch;
                utils.timestampedLog('[pgp] [modal] showing: ' + _branch);
            }
        } else if (this._loggedBranch) {
            this._loggedBranch = null;
        }

        if (this.state.privateKey) {
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <View style={styles.container}>
                            <Dialog.Title style={styles.title}>Import private key</Dialog.Title>
                             <Text style={styles.body}>
                                 {'Enter the pincode shown on the sending device to import your private key:'}
                            </Text>
                            <TextInput
                                style={styles.input}
                                mode="flat"
                                autoFocus={true}
                                keyboardType="number-pad"
                                maxLength={6}
                                name="password"
                                label="Enter pincode"
                                onSubmitEditing={()=>{
                                    if (this.state.password.length === 6) {
                                        this.props.saveFunc(this.state.password);
                                    }
                                }}
                                onChangeText={this.onInputChange}
                                required
                                defaultValue={this.state.password}
                                autoCapitalize="none"
                            />
                            <View style={styles.buttonRow}>
                            {!this.state.status ?
                            <Button
                                mode="contained"
                                style={styles.button}
                                disabled={this.disableButton}
                                onPress={this.save}
                                icon="content-save"
                                accessibilityLabel="Import private key"
                                >Import key
                            </Button>
                            :
                             <Text style={statusStyle}>
                                 {this.state.status}
                            </Text>
                            }
                            </View>
                        </View>
                    </DialogType>
                </Portal>
            );
        } else {
            if (this.state.keyDifferentOnServer) {
                return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <View style={styles.container}>
                            <Dialog.Title style={styles.title}>Another Blink device?</Dialog.Title>
                             <Text style={styles.body}>
                                 You have used Blink on multiple devices. To decrypt your messages, you need the same private key on all devices.
                            </Text>
                             <Text style={styles.body}>
                                 To use the private key from another device, on that device chose the menu option 'Export private key'.
                            </Text>
                            <View style={styles.buttonRow}>
                            <Button
                                mode="contained"
                                style={styles.button}
                                onPress={this.useExistingKeys}
                                icon="key"
                                accessibilityLabel="keep existing key"
                                >Use this device key
                            </Button>
                            </View>
                        </View>
                    </DialogType>
                </Portal>
                );
            } else {
                return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <View style={styles.container}>
                            <Dialog.Title style={styles.title}>Another Blink device?</Dialog.Title>
                             <Text style={styles.body}>
                                 To decrypt messages, you need the same private key on all devices.
                            </Text>
                             <Text style={styles.body}>
                                 To use the private key from another device, go on that device to menu option 'Export private key'.
                            </Text>

                             <Text style={styles.body}>
                                 In case you lost access to your old devices, you must generate a new key or restore it from a previous backup. If you generate a new key, older message cannot be read anymore.
                            </Text>
                            {/* The button is a two-tap control: the first tap arms
                                it, the second generates. Say so — the label
                                flipping from "Generate key" to "Confirm" with no
                                explanation reads as "nothing happened". */}
                            {this.state.confirm ?
                             <Text style={styles.body}>
                                 Tap Confirm to generate a new key. Messages encrypted with your old key will stay unreadable.
                            </Text>
                            : null}
                            <View style={styles.buttonRow}>
                            <Button
                                mode="contained"
                                style={styles.button}
                                onPress={this.generateKeys}
                                icon="content-save"
                                accessibilityLabel="Generate key"
                                >{this.state.confirm ? 'Confirm' : 'Generate key'}
                            </Button>
                            </View>
                        </View>
                    </DialogType>
                </Portal>
            );
            }
        }
    }
}


ImportPrivateKeyModal.propTypes = {
    show                : PropTypes.bool,
    close               : PropTypes.func.isRequired,
    privateKey          : PropTypes.string,
    saveFunc            : PropTypes.func.isRequired,
    generateKeysFunc    : PropTypes.func.isRequired,
    useExistingKeysFunc : PropTypes.func.isRequired,
    status              : PropTypes.string,
    keyDifferentOnServer: PropTypes.bool,
    keyExistsOnServer   : PropTypes.bool,
    keyStatus           : PropTypes.object,
    success             : PropTypes.bool
};

export default ImportPrivateKeyModal;
