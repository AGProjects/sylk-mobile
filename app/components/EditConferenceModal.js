import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_InviteParticipantsModal.scss';

class EditConferenceModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        let users = this.props.invitedParties ? this.props.invitedParties.toString(): null;
        this.state = {
            users: users
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.invitedParties) {
            this.setState({users: nextProps.invitedParties.toString()});
        }
    }

    saveParticipants(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.users) {
            this.state.users.split(',').forEach((item) => {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${config.defaultDomain}`;
                }
                uris.push(item);
            });
        }

        if (uris) {
            this.props.saveInvitedParties(uris);
            this.setState({users: null});
        }
        this.props.close();
    }

    onInputChange(value) {
        this.setState({users: value});
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title>{this.props.room} conference participants </Dialog.Title>
                        <TextInput
                            mode="flat"
                            name="users"
                            label="Accounts"
                            onChangeText={this.onInputChange}
                            value={this.state.users}
                            placeholder="Enter accounts separated by commas"
                            required
                            autoCapitalize="none"
                        />

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.saveParticipants}
                            icon="email">Save
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EditConferenceModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    saveInvitedParties: PropTypes.func,
    invitedParties: PropTypes.array,
    room: PropTypes.string
};

export default EditConferenceModal;
