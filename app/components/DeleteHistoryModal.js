import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform } from 'react-native';
import UserIcon from './UserIcon';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, RadioButton, Checkbox, Switch } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_DeleteHistoryModal.scss';


class DeleteHistoryModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.displayName,
            show: this.props.show,
            uri: this.props.uri,
            username: this.props.uri && this.props.uri ? this.props.uri.split('@')[0] : null,
            period: "0",
            remoteDelete: false,
            deleteContact: false,
            confirm: false,
            hasMessages: this.props.hasMessages,
            filteredMessageIds: this.props.filteredMessageIds
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       displayName: nextProps.displayName,
                       username: nextProps.uri && nextProps.uri ? nextProps.uri.split('@')[0] : null,
                       uri: nextProps.uri,
                       deleteContact: nextProps.deleteContact,
                       confirm: nextProps.confirm,
                       hasMessages: nextProps.hasMessages,
                       filteredMessageIds: nextProps.filteredMessageIds
                       });
    }

    deleteMessages(event) {
        event.preventDefault();
        if (this.state.confirm) {
            this.setState({confirm: false, remoteDelete: false, deleteContact:false});
            this.props.deleteMessages(this.state.uri, this.state.remoteDelete);
            if (this.state.deleteContact) {
                this.props.deleteContactFunc(this.state.uri);
            }
            this.props.close();
        } else {
            this.setState({confirm: true});
        }
    }

    toggleDeleteContact() {
        this.setState({deleteContact: !this.state.deleteContact});
    }

    setPeriod(value) {
        this.setState({period: value});
    }

    toggleRemoteDelete() {
        this.setState({remoteDelete: !this.state.remoteDelete})
    }

    render() {
        let identity = {uri: this.state.uri, displayName: this.state.displayName};
        let canDeleteRemote = this.state.uri && this.state.uri.indexOf('@videoconference') === -1;
        let canDeleteByTime = false;

        let deleteLabel = this.state.confirm ? 'Confirm': 'Delete';
        let remote_label = (this.state.displayName && this.state.displayName !== this.state.uri) ? this.state.displayName : this.state.username;

        let what = 'all messages';

        if (this.state.filteredMessageIds.length > 0) {
            what = this.state.filteredMessageIds.length + ' selected messages';
        }

        if (this.state.hasMessages || !this.state.uri) {
            return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            <View style={styles.titleContainer}>
                            { this.state.uri ?
                                <UserIcon style={styles.avatar} identity={identity}/>
                            : null}
                            </View>

                            <View style={styles.titleContainer}>
                               <Dialog.Title style={styles.title}>{this.state.uri ? 'Delete messages' : 'Wipe device'} </Dialog.Title>
                           </View>

                        </View>
                            { this.state.uri ?
                        <View>
                             <Text style={styles.body}>
                                 Are you sure you want to delete {what} exchanged with {remote_label}?
                             </Text>
                        </View>
                             :
                             <Text style={styles.body}>
                               Delete all messages from this device.
                               {"\n"}{"\n"}
                               Messages will remain on the server.
                             </Text>
                            }

                         { canDeleteByTime ?

                        <View style={styles.checkBoxGroupRow}>
                            <RadioButton.Group onValueChange={newValue => this.setPeriod(newValue)} value={this.state.period}>
                              <View style={styles.checkButton}>
                                <Text>Last hour</Text>
                                <RadioButton value="1" />
                              </View>
                              <View style={styles.checkButton}>
                                <Text>Last day</Text>
                                <RadioButton value="24" />
                              </View>
                              <View style={styles.checkButton}>
                                <Text>   All</Text>
                                <RadioButton value="0" />
                              </View>
                            </RadioButton.Group>
                        </View>
                        : null}

                            {this.state.uri ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.remoteDelete} onValueChange={(value) => this.toggleRemoteDelete()}/>
                               :
                                <Checkbox status={this.state.remoteDelete ? 'checked' : 'unchecked'} onPress={() => {this.toggleRemoteDelete()}}/>
                                }
                             <Text> Also delete for {remote_label}</Text>
                                </View>
                            : null
                            }

                            {this.state.uri && this.state.filteredMessageIds.length === 0 ?

                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteContact} onValueChange={(value) => this.toggleDeleteContact()}/>
                               :
                                <Checkbox status={this.state.deleteContact ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteContact()}}/>
                                }
                              <Text> Delete contact</Text>
                                </View>
                            : null}

                        <View style={styles.buttonRow}>

                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.deleteMessages}
                            icon="delete"
                            accessibilityLabel="Delete messages"
                            > {deleteLabel}
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
        } else {
        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            <View style={styles.titleContainer}>
                            { this.state.uri ?
                                <UserIcon style={styles.avatar} identity={identity}/>
                            : null}
                            </View>

                            <View style={styles.titleContainer}>
                               <Dialog.Title style={styles.title}>Delete contact</Dialog.Title>
                           </View>

                        </View>
                        <View>
                             <Text style={styles.body}>
                                 Are you sure you want to delete all message?
                             </Text>
                        </View>

                        <View style={styles.buttonRow}>

                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.deleteMessages}
                            icon="delete"
                            accessibilityLabel="Delete"
                            > {deleteLabel}
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );

        }
    }
}


DeleteHistoryModal.propTypes = {
    show               : PropTypes.bool,
    close              : PropTypes.func.isRequired,
    uri                : PropTypes.string,
    displayName        : PropTypes.string,
    deleteMessages     : PropTypes.func,
    deleteContactFunc  : PropTypes.func,
    hasMessages        : PropTypes.bool,
    filteredMessageIds : PropTypes.array
};

export default DeleteHistoryModal;
