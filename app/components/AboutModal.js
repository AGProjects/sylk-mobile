import React from 'react';
import { Text } from 'react-native';
import PropTypes from 'prop-types';
import { Modal, Portal, Surface, Title } from 'react-native-paper';

import styles from '../assets/styles/blink/_AboutModal.scss';

const AboutModal = (props) => {
    return (
        <Portal>
            <Modal visible={props.show} onDismiss={props.close}>
                <Surface style={styles.container}>
                    <Title style={styles.title}>About Sylk</Title>
                    <Text style={styles.body}>Sylk is the WebRTC client companion for SylkServer</Text>
                    <Text style={styles.body}>http://sylkserver.com</Text>
                </Surface>
            </Modal>
        </Portal>
    );
}

AboutModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired
};

export default AboutModal;
