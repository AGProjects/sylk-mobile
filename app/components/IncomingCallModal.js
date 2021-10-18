import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import UserIcon from './UserIcon';
import { Headline, IconButton, Title, Portal, Modal, Surface, Text } from 'react-native-paper';
import { Platform, View } from 'react-native';
import Logo from './Logo';

import styles from '../assets/styles/blink/_IncomingCallModal.scss';

class IncomingCallModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.mounted = false;
        this.state = {
            contact: this.props.contact,
            media: this.props.media,
            CallUUID: this.props.CallUUID
        };
    }

    answerAudioOnly() {
        this.props.onAccept(this.state.CallUUID, {audio: true, video: false});
    }

    answer() {
        this.props.onAccept(this.state.CallUUID, {audio: true, video: true});
    };

    reject() {
        this.props.onReject(this.state.CallUUID);
    };

    onHide() {
        this.props.onHide(this.state.CallUUID);
    }

    get show() {
        return this.state.CallUUID !== null;
    }

    componentDidMount() {
        this.mounted = true;
        if (this.state.CallUUID) {
            console.log('Alert panel mounted', this.state.CallUUID);
            this.props.playIncomingRingtone(this.state.CallUUID);
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.CallUUID && this.state.CallUUID !== nextProps.CallUUID) {
            console.log('Alert panel updated', nextProps.CallUUID);
            this.props.playIncomingRingtone(nextProps.CallUUID);
        }
        this.setState({contact: nextProps.contact,
                       media: nextProps.media,
                       CallUUID: nextProps.CallUUID});
    }

    render() {
        let answerButtons = [];

        if (!this.state.contact) {
            return null;
        }

        if (!this.state.CallUUID) {
            return null;
        }

        //console.log('Render Alert Panel', this.state.CallUUID, 'show =', this.state.show);
        //console.log('Render Alert Panel call', this.state.CallUUID);

        answerButtons.push(
            <IconButton key="audio" style={styles.button} id="audio"  size={40} onPress={this.answerAudioOnly} icon="phone" />
        );

        let callType = 'audio';
        if (this.state.media && this.state.media.video) {
            callType = 'video';
            answerButtons.push(
                <IconButton id="accept" style={styles.button}  size={40} onPress={this.answer} autoFocus icon="video" />
            );
        }

        answerButtons.push(
            <IconButton key="decline" id="decline" style={styles.rejectButton}  size={40} onPress={this.reject} icon="phone-hangup" />
        );

        answerButtons.push(
            <IconButton key="dissmiss" id="dismiss" style={styles.dismissButton}  size={40} onPress={this.onHide} icon="bell-off-outline" />
        );

        let remoteIdentity = {uri: this.state.contact.uri,
                              displayName: this.state.contact.name,
                              photo: this.state.contact.photo
                              };

        return (
            <Portal>
                <Modal visible={this.show} onDismiss={this.onHide}>
                    <Surface style={styles.container}>
                        <UserIcon style={styles.userIcon} large={true} identity={remoteIdentity} />

                        <Title style={styles.remoteDisplayName}>{remoteIdentity.displayName}</Title>

                        {remoteIdentity.displayName !== remoteIdentity.uri ?
                        <Title style={styles.remoteUri}>{remoteIdentity.uri}</Title>
                        : null}

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
    contact     : PropTypes.object,
    CallUUID    : PropTypes.string,
    media       : PropTypes.object,
    onAccept    : PropTypes.func.isRequired,
    onReject    : PropTypes.func.isRequired,
    onHide      : PropTypes.func.isRequired,
    compact     : PropTypes.bool,
    orientation : PropTypes.string,
    isTablet    : PropTypes.bool,
    playIncomingRingtone: PropTypes.func
};


export default IncomingCallModal;
