// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import UserIcon from './UserIcon';
import { Headline, IconButton, Title, Portal, Modal, Surface } from 'react-native-paper';
import { Platform, View } from 'react-native';

import styles from '../assets/styles/blink/_IncomingCallModal.scss';

function findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }


class IncomingCallModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
    }

    answerAudioOnly() {
        this.props.onAccept(this.props.call.id, {audio: true, video: false});
    }

    answer() {
        this.props.onAccept(this.props.call.id, {audio: true, video: true});
    };

    reject() {
        this.props.onReject(this.props.call.id);
    };

    render() {
        let answerButtons = [];

        if (!this.props.call) {
            return null;
        }

        answerButtons.push(
            <IconButton key="audio" style={styles.button} id="audio"  size={40} onPress={this.answerAudioOnly} icon="phone" />
        );

        let callType = 'audio';
        if (this.props.call.mediaTypes.video) {
            callType = 'video';
            /*
            answerButtons.push(
                <IconButton id="accept" style={styles.button}  size={34} onPress={this.answer} autoFocus icon="video" />
            );
            */
        }

        answerButtons.push(
            <IconButton key="decline" id="decline" style={styles.rejectButton}  size={40} onPress={this.reject} icon="phone-hangup" />
        );

        let remoteUri = this.props.call.remoteIdentity.uri;
        let remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;

        let username = remoteUri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            var contact_obj = findObjectByKey(this.props.contacts, 'remoteParty', username);
        } else {
            var contact_obj = findObjectByKey(this.props.contacts, 'remoteParty', remoteUri);
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
                <Modal visible={this.props.show} dismissable={false}>
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
