import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import Autocomplete from 'react-native-autocomplete-input';

import { Portal, Dialog, Button, Text, TextInput, Surface } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import config from '../config';
import styles from '../assets/styles/blink/_ConferenceModal.scss';

class ConferenceModal extends Component {
    constructor(props) {
        super(props);

        let targetUri = props.targetUri ? props.targetUri.split('@')[0] : '';

        this.state = {
            targetUri: targetUri,
            myInvitedParties: props.myInvitedParties,
            selectedContact: props.selectedContact,
            participants: '',
            filteredContacts: [],
            searching: false,
            roomUrl: config.publicUrl + '/conference/' + targetUri
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
        let participants = [];
        let sanitizedParticipants = [];
        let username;
        let domain;

        if (targetUri) {
            let uri = `${targetUri.replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
            uri = uri.split('@')[0];

            if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(uri)) {
                participants = this.state.myInvitedParties[uri];
            } else if (this.state.selectedContact && this.state.selectedContact.participants) {
                participants = this.state.selectedContact.participants;
            }

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

        }

        this.setState({targetUri: targetUri,
                       searching: false,
                       roomUrl:  targetUri ? config.publicUrl + '/conference/' + targetUri: '',
                       participants: sanitizedParticipants.toString().replace(/,/g, ", ")
                       });
    }

    joinAudio(event) {
        event.preventDefault();
        if (!this.state.targetUri) {
            return;
        }
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
            filteredContacts = filteredContacts.filter(x => !already_added.includes(x.remoteParty) && this.isValidUri(x.remoteParty));

            if (filteredContacts.length > 0) {
               searching = true;
            }
        }

        this.setState({filteredContacts: filteredContacts.slice(0, 6),
                       participants: search_text,
                       searching: searching
                       });
    }

    isPhoneNumber(uri) {
        let username = uri.split('@')[0];
        let domain = uri.split('@')[1];
        if (username.match(/^(\+|0)(\d+)$/) && !domain) {
            return true;
        }

        return false;
    }

    updateParticipants(contact) {
        let participants = this.state.participants.replace(/\s+,\s+/g, ",");
        let els = participants.split(',');
        if (els.length === 1) {
            participants = contact.remoteParty;
        } else {
            els.pop(-1);
            els.push(contact.remoteParty);
            participants = els.toString(',');
        }

        this.setState({participants: participants.replace(/,/g, ", "),
                       filteredContacts: [],
                       searching: false});
    }

    //https://reactnativecode.com/react-native-autocomplete-text-input/

    /*
                        <View style={styles.roomUrlContainer}>
                        <Text style={styles.roomUrl}>
                             {this.state.roomUrl}
                        </Text>
                        </View>

    */

    render() {
        const validUri = this.state.targetUri.length > 0 && this.state.targetUri.indexOf('@') === -1;

        return (
            <Portal style={styles.container}>
                <DialogType visible={this.props.show} onDismiss={this.onHide}>
                    <Surface >
                        <Dialog.Title style={styles.title}>Join Conference</Dialog.Title>

                        <Text  style={styles.inviteTitle}>Invite people</Text>
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
                                                  {item.displayName ? item.displayName + ' ('+ item.remoteParty + ')' : item.remoteParty}
                                              </Text>
                                        </TouchableOpacity>
                                        )}
                        />
                        </View>
                        <View style={styles.roomContainer}>
                        <TextInput
                            style={styles.room}
                            mode="flat"
                            autoCapitalize="none"
                            label="Enter the room you wish to join"
                            placeholder="Conference room"
                            onChangeText={(text) => {this.handleConferenceTargetChange(text);}}
                            name="uri"
                            required
                            defaultValue={this.state.targetUri}
                        />
                        </View>

                        <View style={styles.roomDescriptionContainer}>
                        <Text style={styles.roomDescription}>
                             Others can join
                             later using a Web browser
                        </Text>
                        </View>


                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.joinAudio}
                            icon="speaker"
                        >Audio</Button>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.joinVideo}
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
    defaultDomain: PropTypes.string,
    lookupContacts: PropTypes.func
};

export default ConferenceModal;
