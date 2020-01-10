import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Modal, Portal, Text, Button, Surface, TextInput, Title } from 'react-native-paper';

import config from '../config';

class InviteParticipantsModal extends Component {
    constructor(props) {
        super(props);
        this.invitees = React.createRef();

        this.invite = this.invite.bind(this);
    }

    invite(event) {
        event.preventDefault();
        const uris = [];
        this.invitees.current.value.split(',').forEach((item) => {
            item = item.trim();
            if (item.indexOf('@') === -1) {
                item = `${item}@${config.defaultDomain}`;
            }
            uris.push(item);
        });
        if (uris && this.props.call) {
            this.props.call.inviteParticipants(uris);
        }
        this.props.close();
    }

    render() {
        return (
            <Portal>
                <Modal visible={this.props.show} onDismiss={this.props.close}>
                    <Surface>
                        <Title id="cmodal-title-sm">Invite Online Users</Title>

                        <Text className="lead">Enter the users you wish to invite</Text>
                        <TextInput label="Users" id="inputTarget" ref={this.invitees} className="form-control" placeholder="alice@sip2sip.info,bob,carol" required autoCapitalize="none" />
                        <Button type="submit" className="btn btn-success" onSubmit={this.invite} icon="email">Invite</Button>
                    </Surface>
                </Modal>
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
