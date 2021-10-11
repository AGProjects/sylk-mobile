import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Surface, IconButton} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import { openComposer } from 'react-native-email-link';
import Share from 'react-native-share';

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

        openComposer({
            subject,
            body: emailMessage
        })
        this.props.close();
    }

    handleShareButton(event) {
        let options= {
            title: 'Share via',
            subject: 'Share Sylk message',
            message: this.state.message.text,
            url: this.state.message.local_url ? 'file://' + this.state.message.local_url : this.state.message.url
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
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    message: PropTypes.object
};

export default ShareMessageModal;

