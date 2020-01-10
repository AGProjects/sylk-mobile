import React, { Component } from 'react';
import { View, Linking } from 'react-native';
import PropTypes from 'prop-types';
import { Modal, Title, Surface, Portal, IconButton, Text } from 'react-native-paper';
import autoBind from 'auto-bind';

import utils from '../utils';
import styles from '../assets/styles/blink/_CallMeMaybeModal.scss';

class CallMeMaybeModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        const sipUri = this.props.callUrl.split('/').slice(-1)[0];    // hack!
        const emailMessage = `You can call me using a Web browser at ${this.props.callUrl} or a SIP client at ${sipUri} ` +
                             'or by using the freely available Sylk WebRTC client app at http://sylkserver.com';
        const subject = 'Call me, maybe?';

        this.emailLink = `mailto:?subject=${encodeURI(subject)}&body=${encodeURI(emailMessage)}`;
    }

    handleClipboardButton(event) {
        utils.copyToClipboard(this.props.callUrl);
        this.props.notificationCenter().postSystemNotification('Call me, maybe?', {body: 'URL copied to the clipboard'});
        this.props.close();
    }

    handleEmailButton(event) {
        Linking.canOpenURL(this.emailLink)
            .then((supported) => {
                if (!supported) {
                } else {
                    return Linking.openURL(url);
                }
            })
            .catch((err) => {
                this.props.notificationCenter().postSystemNotification('Call me, maybe?', {body: 'Unable to open email app'});
            });

        this.props.close();
    }

    render() {

        return (
            <Portal>
                <Modal visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Title>Call me, maybe?</Title>
                        <Text>
                            Share {this.props.callUrl} with others so they can easily call you. You can copy it to the clipboard or send it via email.
                        </Text>
                        <View>
                            <View>
                                <IconButton onPress={this.handleClipboardButton} icon="content-copy"/>
                                <IconButton className="btn btn-lg btn-primary" onPress={this.handleEmailButton} icon="email" />
                            </View>
                        </View>
                    </Surface>
                </Modal>
            </Portal>
        );
    }
}

CallMeMaybeModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    callUrl            : PropTypes.string.isRequired,
    notificationCenter : PropTypes.func.isRequired
};

export default CallMeMaybeModal;
