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
            show: this.props.show,
            confirm: false,
            confirm_again: false
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       confirm: nextProps.confirm,
                       confirm_again: nextProps.confirm_again
                       });
    }

    generateKeys(event) {
         event.preventDefault();
         if (this.state.confirm_again) {
            this.setState({confirm: false});
			this.props.generateKeysFunc();
            this.props.close();
        } else if (this.state.confirm) {
           this.setState({confirm_again: true}); 
        } else {
            this.setState({confirm: true});
        } 
    }

    render() {
		let label = 'Generate';

        if (this.state.confirm) {
			label = 'Confirm';
        }

        if (this.state.confirm_again) {
			label = 'Confirm again';
        } 

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>Change private key</Dialog.Title>
                         <Text style={styles.body}>
                            You should change your private key only if one of your devices was lost.
                        </Text>
                         <Text style={styles.body}>
                            Once you generate a new key, previous messages encrypted with the old key cannot be read on new devices.                            
                        </Text>
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
							style={[styles.button, label.indexOf('Confirm') > -1 && { backgroundColor: 'red' }]}
                            disabled={this.disableButton}
                            onPress={this.generateKeys}
                            icon="content-save"
                            accessibilityLabel="Generate keys"
                            >{label}
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
