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
            success: this.props.success,
            keyDifferentOnServer: this.props.keyDifferentOnServer
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       password: nextProps.password,
                       privateKey: nextProps.privateKey,
                       status: nextProps.status,
                       confirm: nextProps.confirm,
                       success: nextProps.success,
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
            this.props.generateKeysFunc();
            this.props.close();
        } else {
            this.setState({confirm: true});
        }
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
                            <Dialog.Title style={styles.title}>{'Import private key'}</Dialog.Title>
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
                                >Import
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
            let title = this.state.keyDifferentOnServer ? 'Another device?' : 'First device?';
            let generate_key_title = this.state.confirm ? 'Confirm' : 'Generate key';
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
                            <Dialog.Title style={styles.title}>{title}</Dialog.Title>
                             <Text style={styles.body}>
                                 To decrypt messages, you need a private key from another device. On another device go to  menu option 'Export private key'.
                            </Text>
                             { !this.state.keyDifferentOnServer ?
                             <Text style={styles.body}>
                                 If this is the first device, just generate a key by pressing the button bellow.
                            </Text>
                                 :
                             <Text style={styles.body}>
                                 If you chose to generate a key, previous messages cannot be read on newer devices.
                            </Text>

                                 }
                            <View style={styles.buttonRow}>
                            <Button
                                mode="contained"
                                style={styles.button}
                                onPress={this.generateKeys}
                                icon="content-save"
                                accessibilityLabel="Generate key"
                                >{generate_key_title}
                            </Button>
                            </View>
                        </Surface>
                    </DialogType>
                </Portal>
            );
        }
    }
}


ImportPrivateKeyModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    privateKey         : PropTypes.string,
    saveFunc           : PropTypes.func.isRequired,
    generateKeysFunc   : PropTypes.func.isRequired,
    status             : PropTypes.string,
    keyDifferentOnServer : PropTypes.bool,
    success            : PropTypes.bool
};

export default ImportPrivateKeyModal;
