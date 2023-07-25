import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import styles from '../assets/styles/blink/_PrivateKeyModal.scss';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

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
        this.setState({show: nextProps.show,
                       password: nextProps.password || this.state.password,
                       privateKey: nextProps.privateKey,
                       status: nextProps.status,
                       confirm: nextProps.confirm,
                       success: nextProps.success,
                       keyStatus: nextProps.keyStatus,
                       keyDifferentOnServer: nextProps.keyDifferentOnServer
                       });

        if (nextProps.success) {
            setTimeout(() => {
                this.props.close();
            }, 3000);
        }
    }

    save(event) {
        event.preventDefault();
        this.props.saveFunc(this.state.password);
    }

    generateKeys(event) {
        event.preventDefault();
        if (this.state.confirm) {
            this.setState({password: ''});
            this.props.generateKeysFunc();
            this.props.close();
        } else {
            this.setState({confirm: true});
        }
    }

    useExistingKeys(event) {
        event.preventDefault();
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
        const statusStyle = !this.state.status ? styles.statusFail: styles.status;

        if (this.state.privateKey) {
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
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
                        </Surface>
                    </DialogType>
                </Portal>
            );
        } else {
            if (this.state.keyDifferentOnServer) {
                return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
                            <Dialog.Title style={styles.title}>Another device?</Dialog.Title>
                             <Text style={styles.body}>
                                 You have used messaging on more than one device. To decrypt messages, you need the same private key on all devices.
                            </Text>
                             <Text style={styles.body}>
                                 To use the private key from another device, choose on that device to menu option 'Export private key'.
                            </Text>
                            <View style={styles.buttonRow}>
                            <Button
                                mode="contained"
                                style={styles.button}
                                onPress={this.useExistingKeys}
                                icon="key"
                                accessibilityLabel="keep existing key"
                                >Keep existing key
                            </Button>
                            </View>
                        </Surface>
                    </DialogType>
                </Portal>
                );
            } else {
                return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
                            <Dialog.Title style={styles.title}>Another device?</Dialog.Title>
                             <Text style={styles.body}>
                                 To decrypt messages, you need the same private key on all devices.
                            </Text>
                             <Text style={styles.body}>
                                 To use the private key from another device, choose on that device to menu option 'Export private key'.
                            </Text>

                             <Text style={styles.body}>
                                 In case you lost access to your old devices, you must generate a new key. If you do this, older message cannot be read anymore.
                            </Text>
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
                        </Surface>
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
