import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Title, Portal, Modal, Paragraph, TextInput, Surface, Button } from 'react-native-paper';

import styles from '../assets/styles/blink/_EscalateConferenceModal.scss';

import config from '../config';

class EscalateConferenceModal extends React.Component {
    constructor(props) {
        super(props);
        this.invitees = React.createRef();

        this.escalate = this.escalate.bind(this);
    }

    escalate(event) {
        event.preventDefault();
        const uris = [];
        for (let item of this.invitees.current.value.split(',')) {
            item = item.trim();
            if (item.indexOf('@') === -1) {
                item = `${item}@${config.defaultDomain}`;
            }
            uris.push(item);
        };
        uris.push(this.props.call.remoteIdentity.uri);
        this.props.escalateToConference(uris);
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
                                mode="outlined"
                                label="Users"
                                id="inputTarget"
                                ref={this.invitees}
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
