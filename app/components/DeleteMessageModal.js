import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform } from 'react-native';
import UserIcon from './UserIcon';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, RadioButton, Checkbox, Switch } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

class DeleteMessageModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        // Default remoteDelete to whatever the parent says is allowed. If
        // canDeleteRemote is false (selection contains an incoming message)
        // the toggle stays hidden and we force the value to false so the
        // delete-for-remote path is never taken.
        const canDeleteRemote = this.props.canDeleteRemote !== false;

        this.state = {
            uri: this.props.contact ? this.props.contact.uri : null,
            username: this.props.contact && this.props.contact.uri ? this.props.contact.uri.split('@')[0] : null,
            displayName: this.props.contact ? this.props.contact.name : null,
            contact: this.props.contact,
            show: this.props.show,
            remoteDelete: canDeleteRemote,
            afterDelete: false,
            confirm: false,
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        const canDeleteRemote = nextProps.canDeleteRemote !== false;
        this.setState({show: nextProps.show,
                       uri: nextProps.contact ? nextProps.contact.uri : null,
                       username: nextProps.contact && nextProps.contact.uri ? nextProps.contact.uri.split('@')[0] : null,
                       displayName: nextProps.contact ? nextProps.contact.name : null,
                       confirm: nextProps.confirm,
                       contact: nextProps.contact,
                       // Reset the toggle to match what's allowed each time
                       // a new selection opens the modal.
                       remoteDelete: canDeleteRemote,
                       });
    }

    deleteMessage(event) {
        if (this.state.confirm || true) {
            // Guard: never pass remoteDelete=true when the parent said the
            // selection isn't eligible (e.g. any incoming message included).
            const allowRemote = this.props.canDeleteRemote !== false;
            const remoteDelete = allowRemote && this.state.remoteDelete;
            this.setState({confirm: false, remoteDelete: allowRemote, afterDelete: false});
            for (const id of this.props.messages) {
				this.props.deleteMessageFunc(id, this.state.uri, remoteDelete, this.state.afterDelete);
		    }
            this.props.close();
        } else {
            this.setState({confirm: true});
        }
    }

    toggleRemoteDelete() {
        this.setState({remoteDelete: !this.state.remoteDelete})
    }

    toggleAfterDelete() {
        this.setState({afterDelete: !this.state.afterDelete})
    }

    render() {
        let identity = {uri: this.state.uri, displayName: this.state.displayName};
        let deleteLabel = this.state.confirm || true ? 'Confirm': 'Delete';
        let remote_label = (this.state.displayName && this.state.displayName !== this.state.uri) ? this.state.displayName : this.state.username;
        
        // Driven by the parent: false when the selection contains any
        // incoming message (can't instruct the remote device to delete
        // messages it originated). Defaults to true for back-compat.
        let canDeleteRemote = this.props.canDeleteRemote !== false;

        return (
        <Portal>
            <DialogType visible={this.state.show} onDismiss={this.props.close}>
                <Surface style={styles.container}>
                    <View style={styles.titleContainer}>
                        <View style={styles.titleContainer}>
                        <UserIcon style={styles.avatar} identity={identity}/>
                        </View>

                        <View style={styles.titleContainer}>
                           <Dialog.Title style={styles.title}>{'Delete messages'} </Dialog.Title>
                       </View>

                    </View>
                         <Text style={styles.body}>
                             Are you sure you want to delete {this.props.messages?.length} {this.props.messages?.length == 1 ? 'message' : 'messages'}?
                         </Text>
                        <View style={styles.checkBoxRow}>
                          {Platform.OS === 'ios' && canDeleteRemote ?
                           <Switch value={this.state.remoteDelete} onValueChange={(value) => this.toggleRemoteDelete()}/>
                           : null
                           }
                            {Platform.OS === 'android' && canDeleteRemote ?
                            <Checkbox status={this.state.remoteDelete ? 'checked' : 'unchecked'} onPress={() => {this.toggleRemoteDelete()}}/>
                            : null
                            }

                            {canDeleteRemote ?
                            <Text> Also delete those sent for {remote_label}</Text>
                            : null}

                            </View>

                        <View style={styles.checkBoxRow}>
                          {Platform.OS === 'ios' ?
                           <Switch value={this.state.afterDelete} onValueChange={(value) => this.toggleAfterDelete()}/>
                           : null
                           }

                            {Platform.OS === 'android' ?
                            <Checkbox status={this.state.afterDelete ? 'checked' : 'unchecked'} onPress={() => {this.toggleAfterDelete()}}/>
                            : null
                            }
                            
                            <Text> Delete conversation for this day</Text>

                            </View>

                    <View style={styles.buttonRow}>

                    <Button
                        mode="contained"
                        style={styles.button}
                        onPress={this.deleteMessage}
                        icon="delete"
                        accessibilityLabel="Delete message"
                        > {deleteLabel}
                    </Button>
                    </View>
                </Surface>
            </DialogType>
        </Portal>
    );
    }
}

DeleteMessageModal.propTypes = {
    show               : PropTypes.bool,
    close              : PropTypes.func.isRequired,
    contact            : PropTypes.object,
    deleteMessageFunc  : PropTypes.func,
    messages           : PropTypes.array,
    canDeleteRemote    : PropTypes.bool,
};

export default DeleteMessageModal;
