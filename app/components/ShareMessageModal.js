import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Surface, IconButton} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import { openComposer } from 'react-native-email-link';
import Share from 'react-native-share';
const RNFS = require('react-native-fs');
//var Mailer = require('NativeModules').RNMail;

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import utils from '../utils';
import styles from '../assets/styles/blink/_ConferenceModal.scss';


class ShareMessageModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            message: props.message,
            show: props.show
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({message: nextProps.message,
                       show: nextProps.show
                       });
    }

    handleClipboardButton(event) {
        utils.copyToClipboard(this.state.message.text);
        this.props.close();
    }

    handleEmailButton(event) {
        const emailMessage = this.state.message.text;
        const subject = 'Share Sylk message';

        /*
        let mailMessage = {
            subject: subject,
            body: emailMessage
        };

        if (this.state.message.metadata) {
            local_url = this.state.message.metadata.local_url;
            mailMessage.attachment = {
                path: this.state.message.metadata.local_url,  // The absolute path of the file from which to read data.
                type: this.state.message.metadata.filetype,   // Mime Type: jpg, png, doc, ppt, html, pdf
                name: this.state.message.metadata.filename   // Optional: Custom filename for attachment
              }
        }

        Mailer.mail(mailMessage, (error, event) => {
            if (error) {
              console.log('Error', error);
            }
        });
        */


        openComposer({
            subject,
            body: emailMessage
        })
        this.props.close();
    }

    async handleShareButton(event) {
        let local_url;
        let what =  'message';

        if (this.state.message.metadata) {
            local_url = this.state.message.metadata.local_url;
            if (this.state.message.image) {
                what = 'photo';
                let res = await RNFS.readFile(local_url, 'base64');
                local_url = `data:${this.state.message.metadata.filetype};base64,${res}`;
            } else if (utils.isAudio(this.state.message.metadata.filename)) {
                what = 'Audio message';
                local_url = Platform.OS === 'ios' ? local_url : 'file://' + local_url;
            } else if (this.state.message.metadata.video) {
                what = 'Video';
                local_url = Platform.OS === 'ios' ? local_url : 'file://' + local_url;
            } else {
                local_url = Platform.OS === 'ios' ? local_url : 'file://' + local_url;
            }

        }

        let options= {
            title: 'Share via',
            subject: 'Share ' + what,
            message: this.state.message.text,
            url: local_url
        }

        if (this.state.message.metadata) {
            options.type = this.state.message.metadata.filetype;
        }

        console.log('Sharing data...');

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
                        <Dialog.Title style={styles.title}>Share message</Dialog.Title>
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

ShareMessageModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    message: PropTypes.object
};

export default ShareMessageModal;

