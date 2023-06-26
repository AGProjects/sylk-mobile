import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import styles from '../assets/styles/blink/_ExportPrivateKeyModal.scss';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;


class ExportPrivateKeyModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            password: this.props.password,
            show: this.props.show,
            sent: this.props.sent,
            status: ''
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       password: nextProps.password,
                       status: nextProps.status || '',
                       publicKeyHash: nextProps.publicKeyHash,
                       sent: nextProps.password === this.state.password
                       });

    }

    save(event) {
        event.preventDefault();
        this.props.saveFunc(this.state.password);
        this.setState({sent: true,
                       status: 'Enter same pincode on the other devices'});
    }

    get disableButton() {
        if (!this.state.password || this.state.password.length < 6) {
            return true;
        }

        if (this.state.sent) {
            return true;
        }

        return false;
    }

    onInputChange(value) {
        this.setState({password: value});
    }

    render() {

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>Export private key</Dialog.Title>
                         <Text style={styles.body}>
                             To replicate messages on multiple devices
                             you need the same private key on all of them.
                        </Text>

                        <Text style={styles.body}>
                             Enter this code when prompted on your other device:
                        </Text>

                        <Text style={styles.pincode}>
                             {this.state.password}
                        </Text>

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={this.disableButton}
                            onPress={this.save}
                            icon="content-save"
                            accessibilityLabel="Export private key"
                            >Export
                        </Button>
                        </View>
                        <View style={styles.buttonRow}>
                         <Text style={styles.status}>
                             {this.state.status}
                        </Text>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


ExportPrivateKeyModal.propTypes = {
    show               : PropTypes.bool,
    close              : PropTypes.func.isRequired,
    password           : PropTypes.string,
    saveFunc           : PropTypes.func.isRequired,
    publicKeyHash      : PropTypes.string
};

export default ExportPrivateKeyModal;
