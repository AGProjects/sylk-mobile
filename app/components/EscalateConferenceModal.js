import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import { Portal, Dialog, Paragraph, TextInput, Surface, Button } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EscalateConferenceModal.scss';

import config from '../config';

class EscalateConferenceModal extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            users: null
        }
    }

    escalate(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.users) {
            for (let item of this.state.users.split(',')) {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${config.defaultDomain}`;
                }
                uris.push(item);
            };
        }
        uris.push(this.props.call.remoteIdentity.uri);
        this.props.escalateToConference(uris);
    }

    onInputChange(value) {
        this.setState({users: value});
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title>Move to conference</Dialog.Title>
                        <Paragraph>Please enter the account(s) you wish to add to this call. After pressing Move, all parties will be invited to join a conference.</Paragraph>
                        <View>
                            <TextInput
                                mode="flat"
                                label="Users"
                                id="inputTarget"
                                onChangeText={this.onInputChange}
                                placeholder="alice@sip2sip.info,bob,carol"
                                required
                                autoCapitalize="none"
                            />
                            <Button style={styles.button} onPress={this.escalate} icon="send">Move</Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EscalateConferenceModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    call: PropTypes.object,
    escalateToConference: PropTypes.func
};

export default EscalateConferenceModal;
