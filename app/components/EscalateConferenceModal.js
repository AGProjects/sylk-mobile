import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import { Portal, Dialog, Paragraph, TextInput, Surface, Button } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EscalateConferenceModal.scss';


class EscalateConferenceModal extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            users: props.selectedContacts ? props.selectedContacts.toString() : ''
        }
    }

    escalateToConference(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.users) {
            for (let item of this.state.users.split(',')) {
                item = item.trim();
                uris.push(item);
            };
        }

        if (uris.indexOf(this.props.call.remoteIdentity.uri) === -1) {
            uris.push(this.props.call.remoteIdentity.uri);
        }
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
                        <Dialog.Title>Move call to conference</Dialog.Title>
                        <Paragraph>Enter the accounts you wish to invite separated by commas</Paragraph>
                        <View>
                            <TextInput
                                mode="flat"
                                label="Accounts"
                                id="inputTarget"
                                onChangeText={this.onInputChange}
                                required
                                autoCapitalize="none"
                                value={this.state.users}
                            />
                            <View style={styles.buttonRow}>
                            <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.escalateToConference}
                            icon="video"
                            >Start conference</Button>
                            </View>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EscalateConferenceModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    call: PropTypes.object,
    selectedContacts: PropTypes.array,
    escalateToConference: PropTypes.func
};

export default EscalateConferenceModal;
