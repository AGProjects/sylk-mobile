import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity, FlatList } from 'react-native';
import Autocomplete from 'react-native-autocomplete-input';

import { Portal, Dialog, Button, Text, TextInput, Surface, Chip} from 'react-native-paper';
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
            participants: [],
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
        let uri = nextProps.targetUri.split('@')[0];

        this.setState({myInvitedParties: nextProps.myInvitedParties,
                      selectedContact: nextProps.selectedContact,
                      participants: nextProps.participants || []
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
            let uri = `${targetUri.replace(/[\s\@()]/g, '')}@${config.defaultConferenceDomain}`;
            uri = uri.split('@')[0];

            if (this.state.selectedContact && this.state.selectedContact.participants) {
                participants = this.state.selectedContact.participants;
            } else if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(uri)) {
                participants = this.state.myInvitedParties[uri];
            }

            participants.forEach((item) => {
                item = item.trim().toLowerCase();
                if (item.length === 0) {
                    return;
                }

                const username = item.split('@')[0];

                if (username.length === 0) {
                    return;
                }

                const domain = item.split('@')[1];

                if (item === this.props.accountId) {
                    return;
                }

                if (item.indexOf('@') === -1) {
                    sanitizedParticipants.push(item);
                } else {
                    if (domain === this.props.defaultDomain) {
                        sanitizedParticipants.push(username);
                    } else {
                        sanitizedParticipants.push(item);
                    }
                }
            });
        }

        this.setState({targetUri: targetUri,
                       searching: false,
                       roomUrl:  targetUri ? config.publicUrl + '/conference/' + targetUri: '',
                       participants: sanitizedParticipants
                       });
    }

    joinAudio(event) {
        event.preventDefault();
        if (!this.state.targetUri) {
            return;
        }
        const uri = `${this.state.targetUri.replace(/[\s\@()]/g, '')}@${config.defaultConferenceDomain}`;
        const participants = [];

        if (this.state.participants) {
            this.state.participants.forEach((item) => {
                item = item.trim().toLowerCase().replace(' ', '');
                if (item.length > 1) {
                    if (item.indexOf('@') === -1) {
                        item = `${item}@${this.props.defaultDomain}`;
                    }
                    participants.push(item);
                }
            });
        }

        this.props.handleConferenceCall(uri.toLowerCase(), {audio: true, video: false, participants: participants});
    }

    joinVideo(event) {
        event.preventDefault();
        const uri = `${this.state.targetUri.replace(/[\s\@()]/g, '')}@${config.defaultConferenceDomain}`;
        const participants = [];

        if (this.state.participants) {
            this.state.participants.forEach((item) => {
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

    removeParticipant(uri) {
        let participants = this.state.participants;
        let idx = participants.indexOf(uri);
        if (idx > -1) {
            //console.log('Remove', uri, 'from', participants);
            participants.splice(idx, 1);
            this.setState({participants: participants});
        }
    }

    updateParticipants(contact) {
        let participants = this.state.participants;
        let els = participants;
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
        const validUri = this.state.targetUri.length > 0 && this.state.targetUri.indexOf('@') === -1;

        let data = [];
        if (this.state.participants) {
            this.state.participants.forEach((p) => {
                data.push({key: p.trim()});
                });
        }

        return (
            <Portal style={styles.container}>
                <DialogType visible={this.props.show} onDismiss={this.onHide}>
                    <Surface >
                        <Dialog.Title style={styles.title}>Join conference</Dialog.Title>
                        <View style={styles.roomContainer}>
                        {!this.state.selectedContact ?
                        <TextInput
                            style={styles.room}
                            mode="flat"
                            autoCapitalize="none"
                            label="Enter the room you wish to join"
                            placeholder="room"
                            onChangeText={(text) => {this.handleConferenceTargetChange(text);}}
                            name="uri"
                            required
                            defaultValue={this.state.targetUri}
                        />
                        :
                        <Text style={styles.title}>
                             {this.state.targetUri}
                        </Text>
                        }

                        </View>

                        <View style={styles.roomDescriptionContainer}>
                        {this.state.participants.length > 0 ?
                        <View>
                        <View>
                              <Text style={styles.roomDescription}>Invited participants:</Text>
                        </View>

                        <View style={styles.chipsContainer}>
                              <FlatList style={styles.chips}
                                horizontal={true}
                                data={data}
                                renderItem={({item}) => <Chip style={styles.chip}
                                                         textStyle={styles.chipTextStyle}
                                                         icon="account"
                                                         onClose={() => this.removeParticipant(item.key)}>
                                                         {item.key}
                                                         </Chip>
                                            }
                              />
                        </View>
                        </View>
                        : null}

                        <Text style={styles.roomDescription}>
                             Others can be invited once the conference starts
                        </Text>
                        </View>

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            disabled={!this.state.targetUri}
                            style={styles.button}
                            onPress={this.joinAudio}
                            icon="speaker"
                        >Audio</Button>
                        <Button
                            mode="contained"
                            disabled={!this.state.targetUri}
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
