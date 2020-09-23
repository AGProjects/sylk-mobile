import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EditDisplayNameModal.scss';


class EditDisplayNameModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.displayName,
            show: this.props.show
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show});
    }

    saveDisplayName(event) {
        event.preventDefault();
        this.props.saveDisplayName(this.state.displayName);
        if (!this.props.myself) {
            this.props.close();
        } else if (this.props.displayName) {
            this.props.close();
        }
    }

    onInputChange(value) {
        this.setState({displayName: value});
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>{this.props.uri}</Dialog.Title>
                        {this.props.myself ?
                         <Text style={styles.body}>
                             Please set your name seen by others when you call them
                        </Text>
                        : null}
                       <TextInput
                            mode="flat"
                            name="display_name"
                            label="Display name"
                            onChangeText={this.onInputChange}
                            defaultValue={this.state.displayName}
                            required
                            autoCapitalize="none"
                        />
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={!this.state.displayName}
                            onPress={this.saveDisplayName}
                            icon="content-save"
                            accessibilityLabel="Save display name"
                            >Save
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


EditDisplayNameModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    displayName        : PropTypes.string,
    uri                : PropTypes.string,
    myself             : PropTypes.bool,
    saveDisplayName    : PropTypes.func
};

export default EditDisplayNameModal;
