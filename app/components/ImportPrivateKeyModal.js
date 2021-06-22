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
            status: this.props.status,
            success: this.props.success
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       password: nextProps.password,
                       status: nextProps.status,
                       success: nextProps.success
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
    }
}


ImportPrivateKeyModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    saveFunc           : PropTypes.func.isRequired,
    status             : PropTypes.string,
    success            : PropTypes.bool
};

export default ImportPrivateKeyModal;
