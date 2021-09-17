import React from 'react';
import { Text, Linking } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Portal, Surface, Title } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import VersionNumber from 'react-native-version-number';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_AboutModal.scss';

function handleLink(event) {
    Linking.openURL('https://ag-projects.com');
}

const AboutModal = (props) => {
    return (
        <Portal>
            <DialogType visible={props.show} onDismiss={props.close}>
                <Surface style={styles.container}>
                    <Dialog.Title style={styles.title}>About Sylk</Dialog.Title>
                    <Text style={styles.body}>Sylk is part of Sylk Suite, a set of real-time
                    communications applications using IETF SIP protocol and WebRTC specifications</Text>

                    <Text style={styles.version}> Version {VersionNumber.appVersion}</Text>
                    <Text onPress={() => handleLink()} style={styles.link}>Copyright &copy; AG Projects</Text>
                </Surface>
            </DialogType>
        </Portal>
    );
}

AboutModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired
};

export default AboutModal;
