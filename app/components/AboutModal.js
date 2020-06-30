import React from 'react';
import { Text, Linking } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Portal, Surface, Title } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_AboutModal.scss';

function handleLink(event) {
    Linking.openURL('https://sylkserver.com');
}


const AboutModal = (props) => {
    return (
        <Portal>
            <DialogType visible={props.show} onDismiss={props.close}>
                <Surface style={styles.container}>
                    <Dialog.Title style={styles.title}>About Sylk</Dialog.Title>
                    <Text style={styles.body}>Sylk is the client part of Sylk Suite, a set of
                    applications for real-time communications using SIP and WebRTC protocols.</Text>
                    <Text onPress={() => handleLink()} style={styles.body}>https://sylkserver.com</Text>
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
