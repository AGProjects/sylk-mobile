import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';

import { Portal, Dialog, Button, Text, TextInput, Surface, Chip } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_ConferenceModal.scss';

class ConferenceModal extends Component {
    constructor(props) {
        super(props);

        this.state = {
            targetUri: props.targetUri ? props.targetUri.split('@')[0] : '',
            myInvitedParties: props.myInvitedParties,
            selectedContact: props.selectedContact,
            participants: null
        };

        this.handleConferenceTargetChange = this.handleConferenceTargetChange.bind(this);
        this.onHide = this.onHide.bind(this);
        this.joinAudio = this.joinAudio.bind(this);
        this.joinVideo = this.joinVideo.bind(this);
    }

    componentDidMount() {
        this.handleConferenceTargetChange(this.state.targetUri);
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        let uri = '';
        if (nextProps.targetUri) {
            uri = nextProps.targetUri.split('@')[0];
        }

        this.setState({targetUri: uri,
                      myInvitedParties: nextProps.myInvitedParties,
                      selectedContact: nextProps.selectedContact,
                      participants: nextProps.participants
                      });
        this.handleConferenceTargetChange(uri);
    }

    handleConferenceTargetChange(value) {
        let targetUri = value;
        let participants = '';
        let sanitizedParticipants = [];
        let username;
        let domain;

        if (targetUri) {
            let uri = `${targetUri.replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
            uri = uri.split('@')[0];
            if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(uri)) {
                participants = this.props.myInvitedParties[uri].toString();
            } else if (this.state.selectedContact && this.state.selectedContact.participants) {
                participants = this.state.selectedContact.participants.toString();
            }

            if (participants) {
                participants.split(',').forEach((item) => {
                    item = item.trim().toLowerCase();

                    if (item === this.props.accountId) {
                        return;
                    }

                    if (item.indexOf('@') === -1) {
                        item = `${item}@${this.props.defaultDomain}`;
                    }

                    username = item.split('@')[0];
                    domain = item.split('@')[1];

                    if (username && username !== ',') {
                        if (domain === this.props.defaultDomain) {
                            sanitizedParticipants.push(username);
                        } else {
                            sanitizedParticipants.push(item);
                        }
                    }
                });
            }
        }

        if (targetUri) {
            this.setState({targetUri: targetUri});
        }

        if (sanitizedParticipants.length > 0) {
            this.setState({participants: sanitizedParticipants.toString()});
        }
    }

    joinAudio(event) {
        event.preventDefault();
        const uri = `${this.state.targetUri.replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
        const participants = [];

        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim().toLowerCase().replace(' ', '');
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }
                participants.push(item);
            });
        }

        this.props.handleConferenceCall(uri.toLowerCase(), {audio: true, video: false, participants: participants});
    }

    joinVideo(event) {
        event.preventDefault();
        const uri = `${this.state.targetUri.replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
        const participants = [];

        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim().toLowerCase().replace(' ', '');
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }
                participants.push(item);
            });
        }

        this.props.handleConferenceCall(uri.toLowerCase(), {audio: true, video: true, participants: participants});
    }

    onHide() {
        this.props.handleConferenceCall(null);
    }

    render() {
        const validUri = this.state.targetUri.length > 0 && this.state.targetUri.indexOf('@') === -1;

        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.onHide}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>Join Conference</Dialog.Title>
                        <TextInput
                            style={styles.body}
                            mode="flat"
                            autoCapitalize="none"
                            label="Enter the room you wish to join"
                            placeholder="Conference room"
                            onChangeText={(text) => {this.handleConferenceTargetChange(text);}}
                            name="uri"
                            required
                            defaultValue={this.state.targetUri}
                        />
                        <TextInput
                            style={styles.body}
                            mode="flat"
                            autoCapitalize="none"
                            name="users"
                            label="Invite people"
                            onChangeText={(value) => {this.setState({participants: value});}}
                            value={this.state.participants}
                            placeholder="Enter accounts separated by ,"
                        />
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.joinAudio}
                            disabled={!validUri}
                            icon="speaker"
                        >Audio</Button>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.joinVideo}
                            disabled={!validUri}
                            icon="video"
                        >Video</Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

ConferenceModal.propTypes = {
    show: PropTypes.bool.isRequired,
    handleConferenceCall: PropTypes.func.isRequired,
    myInvitedParties: PropTypes.object,
    accountId: PropTypes.string,
    selectedContact: PropTypes.object,
    targetUri: PropTypes.string.isRequired,
    defaultDomain: PropTypes.string
};

export default ConferenceModal;
