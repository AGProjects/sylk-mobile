import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import { Title, Portal, Modal, Paragraph, TextInput, Surface, Button } from 'react-native-paper';

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
                <Modal visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Title>Move to conference</Title>
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
                </Modal>
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
