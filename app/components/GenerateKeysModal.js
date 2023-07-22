import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import styles from '../assets/styles/blink/_GenerateKeysModal.scss';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;


class GenerateKeysModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            show: this.props.show
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show
                       });

    }

    generateKeys(event) {
        event.preventDefault();
        this.props.generateKeysFunc();
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>Generate private key</Dialog.Title>
                         <Text style={styles.body}>
                            You should generate a new private key in case you lost one of your devices.
                        </Text>
                         <Text style={styles.body}>
                            Once you generate a new key, new messages cannot be read on
                            other devices until the new key is exported.
                        </Text>
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={this.disableButton}
                            onPress={this.props.generateKeysFunc}
                            icon="content-save"
                            accessibilityLabel="Generate keys"
                            >Generate
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


GenerateKeysModal.propTypes = {
    show               : PropTypes.bool,
    close              : PropTypes.func.isRequired,
    generateKeysFunc   : PropTypes.func.isRequired
};

export default GenerateKeysModal;
