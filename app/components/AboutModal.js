import React from 'react';
import { Text } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Portal, Surface, Title } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_AboutModal.scss';

const AboutModal = (props) => {
    return (
        <Portal>
            <DialogType visible={props.show} onDismiss={props.close}>
                <Surface style={styles.container}>
                    <Dialog.Title style={styles.title}>About Sylk</Dialog.Title>
                    <Text style={styles.body}>Sylk is the WebRTC client companion for SylkServer</Text>
                    <Text style={styles.body}>http://sylkserver.com</Text>
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
