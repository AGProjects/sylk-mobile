import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import utils from '../utils';
import * as RNFS from 'react-native-fs';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EditMessageModal.scss';


class EditMessageModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: this.props.show,
            message: this.props.message,
            changedText: this.props.message ? this.props.message.text : ''
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({message: nextProps.message,
                       show: nextProps.show});
        if (nextProps.message && nextProps.message !== this.state.message) {
            this.setState({changedText: nextProps.message.text});
        }
    }

    changeText(text) {
        this.setState({changedText: text});
    }

    saveMessage() {
        this.props.sendEditedMessage(this.state.message, this.state.changedText);
        this.props.close();
    }

    render() {
        if (!this.state.message) {
            return (null);
        }

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                    <Dialog.Title style={styles.title}>Edit Message</Dialog.Title>
                      <TextInput
                        style={styles.input}
                        onChangeText={(text) => {this.changeText(text)}}
                        value={this.state.changedText}
                      />

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.props.close}
                            icon="cancel">Cancel
                        </Button>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.saveMessage}
                            icon="content-save">Save
                        </Button>
                        </View>

                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


EditMessageModal.propTypes = {
    show    : PropTypes.bool,
    close   : PropTypes.func.isRequired,
    sendEditedMessage: PropTypes.func.isRequired,
    message : PropTypes.object
};

export default EditMessageModal;
