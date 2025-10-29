import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, StyleSheet, Modal, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { Button, TextInput, Text } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

class EditMessageModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            changedText: props.message ? props.message.text : '',
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.message && nextProps.message !== this.props.message) {
            this.setState({ changedText: nextProps.message.text });
        }
    }

    changeText(text) {
        this.setState({ changedText: text });
    }

    saveMessage() {
        this.props.sendEditedMessage(this.props.message, this.state.changedText);
        this.props.close();
    }

    render() {
        const { show, close } = this.props;
        if (!show) return null;

        return (
            <Modal
                visible={show}
                transparent={true}
                animationType="slide"
                onRequestClose={close}
            >
                <KeyboardAvoidingView
                    style={containerStyles.overlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
                >
                        <View style={containerStyles.modal}>
                            <Text style={styles.title}>Edit Message</Text>
                            <TextInput
                                style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
                                multiline={true}
                                scrollEnabled={true}
                                value={this.state.changedText}
                                onChangeText={this.changeText}
                                mode="outlined"
                            />
                            <View style={styles.buttonRow}>
                                <Button
                                    mode="contained"
                                    style={styles.button}
                                    onPress={close}
                                    icon="cancel"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    mode="contained"
                                    style={styles.button}
                                    onPress={this.saveMessage.bind(this)}
                                    icon="content-save"
                                >
                                    Save
                                </Button>
                            </View>
                        </View>
                </KeyboardAvoidingView>
            </Modal>
        );
    }
}

EditMessageModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    sendEditedMessage: PropTypes.func.isRequired,
    message: PropTypes.object,
};

export default EditMessageModal;

