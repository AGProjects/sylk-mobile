import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import UserIcon from './UserIcon';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, RadioButton, Checkbox } from 'react-native-paper';
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
            period: "0",
            remoteDelete: false
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show, displayName: nextProps.displayName, uri: nextProps.uri});
    }

    deleteMessages(event) {
        event.preventDefault();
        this.props.deleteMessages(this.state.uri, this.state.period, this.state.remoteDelete);
        this.props.close();
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

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            <View style={styles.titleContainer}>
                                <UserIcon style={styles.avatar} identity={identity}/>
                            </View>

                            <View style={styles.titleContainer}>
                               <Dialog.Title style={styles.title}>Delete messages</Dialog.Title>
                           </View>

                        </View>
                         <Text style={styles.body}>
                             Confirm the deletion of messages exchanged with {this.state.uri}
                         </Text>
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
                                <Text>Last week</Text>
                                <RadioButton value="168" />
                              </View>

                              <View style={styles.checkButton}>
                                <Text>All</Text>
                                <RadioButton value="0" />
                              </View>
                            </RadioButton.Group>
                        </View>

                        {canDeleteRemote ?
                            <View style={styles.checkBoxRow}>
                              <Text>Delete from remote party too</Text>

                                <Checkbox
                                  status={this.state.remoteDelete ? 'checked' : 'unchecked'}
                                  onPress={() => {this.toggleRemoteDelete()}}
                                  />
                                </View>
                        : null}

                        <View style={styles.buttonRow}>

                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.deleteMessages}
                            icon="delete"
                            accessibilityLabel="Delete messages"
                            >Delete
                        </Button>
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


DeleteHistoryModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    uri                : PropTypes.string,
    displayName        : PropTypes.string,
    deleteMessages     : PropTypes.func
};

export default DeleteHistoryModal;
