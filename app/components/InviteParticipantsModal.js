import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, TouchableOpacity } from 'react-native';
import { Dialog, Portal, Text, Button, Surface, TextInput, IconButton} from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import { openComposer } from 'react-native-email-link';
import Share from 'react-native-share';
import Autocomplete from 'react-native-autocomplete-input';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import utils from '../utils';

import styles from '../assets/styles/blink/_ConferenceModal.scss';

class InviteParticipantsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        const sanitizedParticipants = [];
        let participants = [];

        participants = this.props.previousParticipants.filter(x => !this.props.currentParticipants.includes(x));
        participants = participants.filter(x => !this.props.alreadyInvitedParticipants.includes(x) && x !== this.props.accountId);

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
            roomUrl: config.publicUrl + '/conference/' + this.props.room,
            filteredContacts: [],
            searching: false
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        let difference = nextProps.previousParticipants.filter(x => !nextProps.currentParticipants.includes(x));
        difference = difference.filter(x => !nextProps.alreadyInvitedParticipants.includes(x) && x !== this.props.accountId);
        this.setState({
            alreadyInvitedParticipants: nextProps.alreadyInvitedParticipants,
            previousParticipants: nextProps.previousParticipants,
            currentParticipants: nextProps.currentParticipants,
            roomUrl: config.publicUrl + '/conference/' + nextProps.room
        });
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

    invite(event) {
        event.preventDefault();
        const uris = [];
        if (this.state.participants) {
            this.state.participants.split(',').forEach((item) => {
                item = item.trim().toLowerCase();
                if (item.length > 1) {
                    if (item.indexOf('@') === -1) {
                        item = `${item}@${this.props.defaultDomain}`;
                    } else {
                        const domain = item.split('@')[1];
                        const username = item.split('@')[0];
                        if (username.length === 0) {
                            return;
                        }
                    }
                    uris.push(item);
                }
            });
        }

        if (uris) {
            this.props.inviteParticipants(uris);
            this.setState({participants: ''});
        }

        this.props.close();
    }

    isValidUri(uri) {
        if (uri === this.props.accountId) {
            return false;
        }

        let username = uri.split('@')[0];
        let domain = uri.split('@')[1];

        if (username.match(/^(\+?)([\-|\d]+)$/) && !domain) {
            return false;
        }

        if (domain) {
            if (domain.indexOf('yahoo') > -1) {
                return false;
            }

            if (domain.indexOf('icloud') > -1) {
                return false;
            }

            if (domain.indexOf('gmail') > -1) {
                return false;
            }
        }

        return true;
    }

    searchContacts(text) {
        const search_text = text;
        let filteredContacts = [];
        let searching = false;

        if (!text.startsWith(this.state.participants)) {
            this.setState({participants: text,
                           filteredContacts: [],
                           searching: false});
            return;
        }

        if (text.indexOf(',') > -1) {
            const text_els = text.split(',');
            text = text_els[text_els.length - 1].trim()
        }

        if (text.length > 1) {
            filteredContacts = this.props.lookupContacts(text);
            let already_added = this.state.participants.replace(/\s+,\s+/g, ",").split(',');
            filteredContacts = filteredContacts.filter(x => !already_added.includes(x.uri) && this.isValidUri(x.uri));

            if (filteredContacts.length > 0) {
               searching = true;
            }
        }

        this.setState({filteredContacts: filteredContacts.slice(0, 6),
                       participants: search_text,
                       searching: searching
                       });
    }

    updateParticipants(contact) {
        let participants = this.state.participants.replace(/\s+,\s+/g, ",");
        let els = participants.split(',');
        if (els.length === 1) {
            participants = contact.uri;
        } else {
            els.pop(-1);
            els.push(contact.uri);
            participants = els.toString(',');
        }

        this.setState({participants: participants.replace(/,/g, ", "),
                       filteredContacts: [],
                       searching: false});
    }

    render() {
        const showAutocomplete = false;
        return (
            <Portal style={styles.container}>
                <DialogType visible={this.props.show} onDismiss={this.props.close}>
                    <Surface>
                        <Dialog.Title style={styles.title}>Share web link</Dialog.Title>
                        {showAutocomplete ?
                        <View>
                        <Autocomplete
                          containerStyle={styles.autocompleteContainer}
                          autoCapitalize="none"
                          autoCorrect={false}
                          data={this.state.filteredContacts}
                          defaultValue={this.state.participants}
                          keyExtractor={(item, i) => i.toString()}
                          onChangeText={(text) => this.searchContacts(text)}
                          placeholder="Enter Sylk accounts separated by ,"
                          renderItem={({item}) => (
                                        <TouchableOpacity
                                              onPress={() => {this.updateParticipants(item);}}>
                                              <Text style={styles.autocompleteSearchBoxTextItem}>
                                                  {item.displayName ? item.displayName + ' ('+ item.uri + ')' : item.uri}
                                              </Text>
                                        </TouchableOpacity>
                                        )}
                        />
                        </View>
                        : null}

                        <View style={styles.buttonRowInvite}>
                        {showAutocomplete ?
                        <Button color={!this.state.participants ? "lightgray": null}
                            mode="contained"
                            style={styles.button}
                            onPress={this.invite}
                            disabled={this.state.searching}
                            >Select participants
                        </Button>
                        : null}
                        </View>

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

InviteParticipantsModal.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    inviteParticipants: PropTypes.func,
    currentParticipants: PropTypes.array,
    previousParticipants: PropTypes.array,
    alreadyInvitedParticipants: PropTypes.array,
    room: PropTypes.string,
    defaultDomain: PropTypes.string,
    accountId: PropTypes.string,
    lookupContacts: PropTypes.func
};

export default InviteParticipantsModal;
