import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Dialog, Portal, Text, Button, Surface, TextInput } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_InviteParticipantsModal.scss';

class InviteParticipantsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            users: null
        }
    }

    invite(event) {
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
        if (uris && this.props.call) {
            this.props.call.inviteParticipants(uris);
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
                        <Dialog.Title>Invite Online Users</Dialog.Title>

                        <Text>Enter the users you wish to invite</Text>
                        <TextInput
                            mode="flat"
                            name="users"
                            label="Users"
                            onChangeText={this.onInputChange}
                            value={this.state.users}
                            placeholder="alice@sip2sip.info,bob,carol"
                            required
                            autoCapitalize="none"
                        />
                        <Button mode="contained" onPress={this.invite} icon="email">Invite</Button>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

InviteParticipantsModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    call: PropTypes.object
};

export default InviteParticipantsModal;
