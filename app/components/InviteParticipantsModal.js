import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput, IconButton} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import { openComposer } from 'react-native-email-link';
import Share from 'react-native-share';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_InviteParticipantsModal.scss';
import utils from '../utils';


class InviteParticipantsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        const sanitizedParticipants = [];
        let participants = [];

        if (this.props.previousParticipants && this.props.currentParticipants && this.props.alreadyInvitedParticipants) {
            participants = this.props.previousParticipants.filter(x => !this.props.currentParticipants.includes(x));
            participants = participants.filter(x => !this.props.alreadyInvitedParticipants.includes(x) && x !== this.props.accountId);
        }

        participants.forEach((item) => {
            item = item.trim().toLowerCase();

            if (item.indexOf('@') === -1) {
                sanitizedParticipants.push(item);
            } else {
                const domain = item.split('@')[1];
                if (domain === this.props.defaultDomain) {
                    sanitizedParticipants.push(item.split('@')[0]);
                } else {
                    sanitizedParticipants.push(item);
                }
            }
        });

        this.state = {
            participants: sanitizedParticipants.toString().replace(/,/g, ", "),
            previousParticipants: this.props.previousParticipants,
            currentParticipants: this.props.currentParticipants,
            roomUrl: config.publicUrl + '/conference/' + this.props.room
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        let difference = nextProps.previousParticipants.filter(x => !nextProps.currentParticipants.includes(x));
        difference = difference.filter(x => !nextProps.alreadyInvitedParticipants.includes(x) && x !== this.props.accountId);
        this.setState({
            participants: difference.toString(),
            alreadyInvitedParticipants: nextProps.alreadyInvitedParticipants,
            previousParticipants: nextProps.previousParticipants,
            currentParticipants: nextProps.currentParticipants
        });
    }

    handleClipboardButton(event) {
        utils.copyToClipboard(this.state.roomUrl);
        this.props.notificationCenter().postSystemNotification('Join conference', {body: 'Conference address copied to clipboard'});
        this.props.close();
    }

    handleEmailButton(event) {
        const emailMessage = 'You can join the conference using a Web browser at ' + this.state.roomUrl +
                              ' or by using Sylk client app from https://sylkserver.com';
        const subject = 'Join conference, maybe?';

        openComposer({
            subject,
            body: emailMessage
        })
        this.props.close();
    }

    handleShareButton(event) {
        const subject = 'Join conference, maybe?';
        const message = 'You can join the conference using a Web browser at ' + this.state.roomUrl +
                        ' or by using Sylk client app from https://sylkserver.com';

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

    invite(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }
                uris.push(item);
            });
        }
        if (uris) {
            this.props.inviteParticipants(uris);
            this.setState({participants: null});
        }
        this.props.close();
    }

    onInputChange(value) {
        this.setState({participants: value});
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title>Invite to conference</Dialog.Title>
                        <TextInput
                            mode="flat"
                            name="people"
                            label="People"
                            onChangeText={this.onInputChange}
                            defaultValue={this.state.participants}
                            placeholder="Enter accounts separated by ,"
                            required
                            autoCapitalize="none"
                        />
                        <View style={styles.buttonRow}>

                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.invite}
                            icon="email">Invite
                        </Button>
                        </View>

                        <Text style={styles.body}>
                             Or share the conference link:
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

InviteParticipantsModal.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    inviteParticipants: PropTypes.func,
    currentParticipants: PropTypes.array,
    previousParticipants: PropTypes.array,
    alreadyInvitedParticipants: PropTypes.array,
    room: PropTypes.string,
    defaultDomain: PropTypes.string,
    accountId: PropTypes.string
};

export default InviteParticipantsModal;
