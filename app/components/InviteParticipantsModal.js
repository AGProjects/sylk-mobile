import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_InviteParticipantsModal.scss';

class InviteParticipantsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        let difference = this.props.previousParticipants.filter(x => !this.props.currentParticipants.includes(x));

        console.log('this.props.previousParticipants', this.props.previousParticipants);
        console.log('this.props.currentParticipants', this.props.currentParticipants);

        this.state = {
            participants: difference.toString(),
            previousParticipants: this.props.previousParticipants,
            currentParticipants: this.props.currentParticipants
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        let difference = nextProps.previousParticipants.filter(x => !nextProps.currentParticipants.includes(x));
        this.setState({
            participants: difference.toString(),
            previousParticipants: nextProps.previousParticipants,
            currentParticipants: nextProps.currentParticipants
        });

        console.log('this.props.previousParticipants', this.props.previousParticipants);
        console.log('this.props.currentParticipants', this.props.currentParticipants);
    }


    invite(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${config.defaultDomain}`;
                }
                uris.push(item);
            });
        }
        if (uris) {
            this.props.inviteParticipants(uris);
            this.setState({participants: null});
        }
        this.props.close();
    }

    onInputChange(value) {
        this.setState({participants: value});
    }

    render() {

        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title>Invite participants</Dialog.Title>
                        <Text>Enter participants to invite</Text>
                        <TextInput
                            mode="flat"
                            name="people"
                            label="People"
                            onChangeText={this.onInputChange}
                            value={this.state.participants}
                            placeholder="bob,carol,alice@sip2sip.info"
                            required
                            autoCapitalize="none"
                        />
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.invite}
                            icon="email">Invite
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

InviteParticipantsModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    inviteParticipants: PropTypes.func,
    currentParticipants: PropTypes.array,
    previousParticipants: PropTypes.array,
    room: PropTypes.string
};

export default InviteParticipantsModal;
