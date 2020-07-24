import React from 'react';
import PropTypes from 'prop-types';
import UserIcon from './UserIcon';
import { Headline, IconButton, Title, Portal, Modal, Surface } from 'react-native-paper';
import { View } from 'react-native';

import styles from '../assets/styles/blink/_IncomingCallModal.scss';

function findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }


const IncomingCallModal = (props) => {

    if (props.call == null) {
        return false;
    }

    const answerAudioOnly = () => {
        props.onAccept(props.call.id, {audio: true, video: false});
    }

    const answer = () => {
        props.onAccept(props.call.id, {audio: true, video: true});
    };

    const reject = () => {
        props.onReject(props.call.id);
    };

    let answerButtons = [];

    answerButtons.push(
        <IconButton style={styles.button} id="audio"  size={40} onPress={answerAudioOnly} icon="phone" />
    );

    let callType = 'audio';
    if (props.call.mediaTypes.video) {
        callType = 'video';
        /*
        answerButtons.push(
            <IconButton id="accept" style={styles.button}  size={34} onPress={answer} autoFocus icon="video" />
        );
        */
    }

    answerButtons.push(
        <IconButton id="decline" style={styles.rejectButton}  size={40} onPress={reject} icon="phone-hangup" />
    );

    let remoteUri = props.call.remoteIdentity.uri;
    let remoteDisplayName = props.call.remoteIdentity.displayName || props.call.remoteIdentity.uri;

    let username = remoteUri.split('@')[0];
    let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

    if (isPhoneNumber) {
        var contact_obj = findObjectByKey(props.contacts, 'remoteParty', username);
    } else {
        var contact_obj = findObjectByKey(props.contacts, 'remoteParty', remoteUri);
    }

    if (contact_obj) {
        remoteDisplayName = contact_obj.displayName;
        if (isPhoneNumber) {
            remoteUri = username;
        }
    } else {
        if (isPhoneNumber) {
            remoteUri = username;
            remoteDisplayName = username;
        }
    }

    let remoteIdentity = {uri: remoteUri,
                          displayName: remoteDisplayName};

    return (
        <Portal>
            <Modal visible={props.show} dismissable={false}>
                <Surface style={styles.container}>
                    <UserIcon style={styles.userIcon} large={true} identity={remoteIdentity} />
                    <Title style={styles.remoteCaller}>{remoteDisplayName}</Title>
                    <Headline style={styles.remoteMedia}>is calling with {callType}</Headline>
                    <View style={styles.buttonContainer}>
                        {answerButtons}
                    </View>
                </Surface>
            </Modal>
        </Portal>
    );
}

IncomingCallModal.propTypes = {
    call     : PropTypes.object,
    onAccept : PropTypes.func.isRequired,
    onReject : PropTypes.func.isRequired,
    compact  : PropTypes.bool,
    show     : PropTypes.bool,
    contacts : PropTypes.array
};


export default IncomingCallModal;
