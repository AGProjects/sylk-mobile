import React from 'react';
import { Text, Linking, Platform } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Portal, Surface, Title } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_AboutModal.scss';

function handleLink(event) {
    Linking.openURL('https://ag-projects.com');
}

function handleUpdate() {
    if (Platform.OS === 'android') {
        Linking.openURL('https://play.google.com/store/apps/details?id=com.agprojects.sylk');
    } else {
        Linking.openURL('https://apps.apple.com/us/app/id1489960733');
    }
}

const AboutModal = (props) => {
    return (
        <Portal>
            <DialogType visible={props.show} onDismiss={props.close}>
                <Surface style={styles.container}>
                    <Dialog.Title style={styles.title}>About Sylk</Dialog.Title>
                    <Text style={styles.body}>Sylk is part of Sylk Suite, a set of real-time
                    communications applications using IETF SIP protocol and WebRTC specifications</Text>
                    <Text style={styles.version}>Version {props.currentVersion}</Text>
                    { props.appStoreVersion && props.appStoreVersion.version > props.currentVersion ?
                        <Text onPress={() => handleUpdate()} style={styles.link}>Update Sylk...</Text>
                    :
                        <Text onPress={() => handleUpdate()} style={styles.link}>Check App Store for update...</Text>
                    }
                    <Text style={styles.love}>For family, friends and customers, with love.</Text>
                    <Text onPress={() => handleLink()} style={styles.link}>Copyright &copy; AG Projects</Text>
                </Surface>
            </DialogType>
        </Portal>
    );
}

AboutModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    currentVersion: PropTypes.string,
    appStoreVersion: PropTypes.object
};

export default AboutModal;
