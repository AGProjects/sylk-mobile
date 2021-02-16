// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_InviteParticipantsModal.scss';


class EditConferenceModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        let participants = [];
        if (this.props.invitedParties && this.props.invitedParties.length > 0) {
            participants = this.props.invitedParties;
        } else if (this.props.selectedContact && this.props.selectedContact.participants) {
            participants = this.props.selectedContact.participants;
        }

        this.state = {
            participants: this.sanitizedParticipants(participants),
            selectedContact: this.props.selectedContact,
            invitedParties: this.props.invitedParties
        }
    }

    sanitizedParticipants(participants) {
        sanitizedParticipants = [];
        participants.forEach((item) => {
            item = item.trim().toLowerCase();

            if (item === this.props.accountId) {
                return;
            }

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

        return sanitizedParticipants.toString().replace(/,/g, ", ");
    }


    UNSAFE_componentWillReceiveProps(nextProps) {
        let participants = [];
        if (nextProps.invitedParties && nextProps.invitedParties.length > 0) {
            participants = nextProps.invitedParties;
        } else if (nextProps.selectedContact && nextProps.selectedContact.participants) {
            participants = nextProps.selectedContact.participants;
        }

        this.setState({
            participants: this.sanitizedParticipants(participants),
            selectedContact: nextProps.selectedContact,
            invitedParties: nextProps.invitedParties
        });
    }

    enableFavoritesButton() {
        let show_button = false;
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim();

                if (!item) {
                    return;
                }
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }

                if (this.props.favoriteUris.indexOf(item) === -1) {
                    show_button = true;
                }
            });
        }

        return show_button;
    }

    saveConference(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }

                if (item === this.props.accountId) {
                    return;
                }

                let username = item.split('@')[0];
                if (username && username !== ',') {
                    uris.push(item);
                }
            });
        }

        if (uris) {
            this.props.saveInvitedParties(uris);
            this.setState({participants: null});
        }
        this.props.close();
    }

    saveParticipants(event) {
        event.preventDefault();
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim();
                if (item.indexOf('@') === -1) {
                    item = `${item}@${this.props.defaultDomain}`;
                }

                if (this.props.favoriteUris.indexOf(item) === -1) {
                    this.props.setFavoriteUri(item);
                } else {
                    console.log('Uri is already favorite', item)

                }

            });
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
                        <Dialog.Title style={styles.title}>{this.props.room}</Dialog.Title>
                          <Dialog.Content>
                            <Paragraph>People you wish to invite when you join the room:</Paragraph>
                          </Dialog.Content>
                        <TextInput
                            mode="flat"
                            name="participants"
                            label="People"
                            onChangeText={this.onInputChange}
                            value={this.state.participants}
                            placeholder="Enter accounts separated by ,"
                            required
                            autoCapitalize="none"
                        />

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.saveConference}
                            icon="content-save">Save
                        </Button>
                        {this.enableFavoritesButton() ?
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.saveParticipants}
                            icon="content-save">Favorites
                        </Button>
                        : null}
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EditConferenceModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    saveInvitedParties : PropTypes.func,
    setFavoriteUri     : PropTypes.func,
    invitedParties     : PropTypes.array,
    room               : PropTypes.string,
    selectedContact    : PropTypes.object,
    defaultDomain      : PropTypes.string,
    accountId          : PropTypes.string,
    favoriteUris   : PropTypes.array
};

export default EditConferenceModal;
