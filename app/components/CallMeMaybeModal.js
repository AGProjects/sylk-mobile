import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Title, Surface, Portal, IconButton, Text } from 'react-native-paper';
import autoBind from 'auto-bind';
import { openComposer } from 'react-native-email-link';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import Share from 'react-native-share';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import utils from '../utils';
import styles from '../assets/styles/blink/_CallMeMaybeModal.scss';

class CallMeMaybeModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
    }

    handleClipboardButton(event) {
        utils.copyToClipboard(this.props.callUrl);
        this.props.notificationCenter().postSystemNotification('Call me', {body: 'Web address copied to the clipboard'});
        this.props.close();
    }

    handleEmailButton(event) {

        const sipUri = this.props.callUrl.split('/').slice(-1)[0];    // hack!
        const emailMessage = `You can call me using a Web browser at ${this.props.callUrl} or a SIP client at ${sipUri} ` +
                             'or by using the freely available Sylk client app from http://sylkserver.com';
        const subject = 'Call me, maybe?';

        openComposer({
            subject,
            body: emailMessage
        })

        // Linking.canOpenURL(this.emailLink)
        //     .then((supported) => {
        //         if (!supported) {
        //         } else {
        //             return Linking.openURL(url);
        //         }
        //     })
        //     .catch((err) => {
        //         this.props.notificationCenter().postSystemNotification('Call me', {body: 'Unable to open email app'});
        //     });

        this.props.close();
    }

    handleShareButton(event) {

        const sipUri = this.props.callUrl.split('/').slice(-1)[0];    // hack!

        let options= {
            subject: 'Call me, maybe?',
            message: `You can call me using a Web browser at ${this.props.callUrl} or a SIP client at ${sipUri} or by using the freely available Sylk WebRTC client app at http://sylkserver.com`
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
        const sipUri = this.props.callUrl.split('/').slice(-1)[0];

        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>Call me, maybe?</Dialog.Title>
                        <Text style={styles.body}>
                            Others can call you with SIP at:
                        </Text>
                        <Text style={styles.address}>
                         {sipUri}
                        </Text>
                        <Text style={styles.body}>
                            or with a Web browser at:
                        </Text>
                        <Text style={styles.address}>
                            {this.props.callUrl}
                        </Text>
                        <Text style={styles.body}>
                             Share this address with others:
                        </Text>
                        <View style={styles.iconContainer}>
                            <IconButton
                                size={34}
                                onPress={this.handleClipboardButton}
                                icon="content-copy"
                            />
                            <IconButton
                                size={34}
                                onPress={this.handleEmailButton}
                                icon="email"
                            />
                            <IconButton
                                size={34}
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

CallMeMaybeModal.propTypes = {
    show               : PropTypes.bool,
    close              : PropTypes.func.isRequired,
    callUrl            : PropTypes.string.isRequired,
    notificationCenter : PropTypes.func.isRequired
};

export default CallMeMaybeModal;
