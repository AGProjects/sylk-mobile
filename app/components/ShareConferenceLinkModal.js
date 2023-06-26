import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, TouchableOpacity } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput, IconButton} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import { openComposer } from 'react-native-email-link';
import Share from 'react-native-share';
const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import utils from '../utils';
import config from '../config';

import styles from '../assets/styles/blink/_ConferenceModal.scss';


class ShareConferenceLinkModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            roomUrl: config.publicUrl + '/conference/' + this.props.room.split('@')[0]
        }
    }

    handleClipboardButton(event) {
        utils.copyToClipboard(this.state.roomUrl);
        this.props.notificationCenter().postSystemNotification('Conference', {body: 'address copied to clipboard'});
        this.props.close();
    }

    handleEmailButton(event) {
        const emailMessage = 'You can join my conference at ' + this.state.roomUrl;
        const subject = 'Join conference, maybe?';

        openComposer({
            subject,
            body: emailMessage
        })

        this.props.close();
    }

    handleShareButton(event) {
        const subject = 'Join conference, maybe?';
        const message = 'You can join my conference at ' + this.state.roomUrl;

        let options= {
            subject: subject,
            message: message
        }

        Share.open(options)
            .then((res) => {
                this.props.close();
            })
            .catch((err) => {
                this.props.close();
            });
    }

    render() {
        return (
            <Portal style={styles.container}>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface>
                        <Dialog.Title style={styles.title}>Share web link</Dialog.Title>
                        <Text style={styles.shareText}>
                            {this.state.roomUrl}
                        </Text>

                        <Text style={styles.shareText}>
                            Select an external application to share the conference web link:
                        </Text>

                        <View style={styles.iconContainer}>
                            <IconButton
                                size={30}
                                onPress={this.handleClipboardButton}
                                icon="content-copy"
                            />
                            <IconButton
                                size={30}
                                onPress={this.handleEmailButton}
                                icon="email"
                            />
                            <IconButton
                                size={30}
                                onPress={this.handleShareButton}
                                icon="share-variant"
                            />
                        </View>


                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

ShareConferenceLinkModal.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    room: PropTypes.string
};

export default ShareConferenceLinkModal;
