import React, { Component } from 'react';
import getAppPaperTheme, { getModalColors } from '../paperTheme';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, StyleSheet, Modal, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { ThemeProvider, Button, TextInput, Text, IconButton } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

class EditMessageModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {changedText: props.message ? props.message.text : '', selection: undefined};
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.message && nextProps.message !== this.props.message) {
            let text = nextProps.message ? nextProps.message.text : '';

			if (nextProps.message && nextProps.message._id in nextProps.mediaLabels) {
				text = nextProps.mediaLabels[nextProps.message._id];
			}
            this.setState({ changedText: text });
        }
    }

    changeText(text) {
        this.setState({ changedText: text });
    }

    // Clear the whole field via the top-right "x". Reset selection to
    // the start so the (now empty) caret is well-defined.
    clearText() {
        this.setState({ changedText: '', selection: { start: 0, end: 0 } });
    }

    // Place the caret at the END of the existing text when the field
    // receives focus (the modal auto-focuses on open), so editing
    // continues from where the message left off instead of selecting
    // all / parking the caret at the start. We force the selection to
    // the end, then release it a tick later so the user is free to move
    // the caret anywhere afterwards.
    focusEnd() {
        const end = (this.state.changedText || '').length;
        this.setState({ selection: { start: end, end: end } });
        setTimeout(() => {
            this.setState({ selection: undefined });
        }, 80);
    }

    saveMessage() {
        this.props.sendEditedMessage(this.props.message, this.state.changedText);
        this.props.close();
    }


    render() {
	    //console.log('mediaLabels', this.props.mediaLabels);
        const { show, close } = this.props;
        if (!show) return null;

        return (
            <ThemeProvider theme={getAppPaperTheme()}>
<Modal
                visible={show}
                transparent={true}
                animationType="slide"
                onRequestClose={close}
                /* iOS-only — without this, RN's Modal defaults to
                   supportedOrientations: ['portrait'], which forces the
                   underlying app to portrait while the modal is presented.
                   Include both landscape variants so the modal inherits
                   whichever orientation the user is in. */
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <KeyboardAvoidingView
                    style={containerStyles.overlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
                >
                        <View style={[containerStyles.modal, { backgroundColor: getModalColors().surface }]}>
                            <Text style={styles.title}>
                                {this.props.message
                                    && (this.props.message.image || this.props.message.video)
                                    ? 'Edit caption'
                                    : 'Edit message'}
                            </Text>
                            <View>
                                <TextInput
                                    style={[styles.input, { height: 120, textAlignVertical: 'top', backgroundColor: getModalColors().isDark ? '#2c2c2c' : '#ffffff' }]}
                                    multiline={true}
                                    scrollEnabled={true}
                                    autoFocus={true}
                                    selection={this.state.selection}
                                    onFocus={this.focusEnd}
                                    value={this.state.changedText}
                                    onChangeText={this.changeText}
                                    mode="outlined"
                                />
                                {!!this.state.changedText && (
                                    <IconButton
                                        icon="close"
                                        size={18}
                                        onPress={this.clearText}
                                        accessibilityLabel="Clear text"
                                        style={{
                                            position: 'absolute',
                                            top: 2,
                                            right: 2,
                                            margin: 0,
                                        }}
                                    />
                                )}
                            </View>
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
</ThemeProvider>
        );
    }
}

EditMessageModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    sendEditedMessage: PropTypes.func.isRequired,
    message: PropTypes.object,
    mediaLabels: PropTypes.object
};

export default EditMessageModal;

