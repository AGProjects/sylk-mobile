import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, Subheading } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EditContactModal.scss';
import utils from '../utils';


class EditContactModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.displayName,
            organization: this.props.organization,
            show: this.props.show,
            myself: this.props.myself,
            uri: this.props.uri,
            confirm: false
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       displayName: nextProps.displayName,
                       uri: nextProps.uri,
                       myself: nextProps.myself,
                       organization: nextProps.organization
                       });
    }

    saveContact(event) {
        event.preventDefault();
        this.props.saveContact(this.state.displayName, this.state.organization);
        this.setState({confirm: false});
        this.props.close();
    }

    deleteContact(event) {
        event.preventDefault();

        if (!this.state.confirm) {
            this.setState({confirm: true});
            return;
        }

        this.setState({confirm: false});
        this.props.deleteContact(this.state.uri);
        this.props.close();
    }

    deletePublicKey(event) {
        event.preventDefault();

        if (!this.state.confirm) {
            this.setState({confirm: true});
            return;
        }

        this.setState({confirm: false});
        this.props.deletePublicKey(this.state.uri);
        this.props.close();
    }

    handleClipboardButton(event) {
        event.preventDefault();
        console.log('Key copied to clipboard')
        utils.copyToClipboard(this.props.publicKey);
        this.props.close();
    }

    onInputChange(value) {
        this.setState({displayName: value});
    }

    onOrganizationChange(value) {
        this.setState({organization: value});
    }

    render() {
        if (this.props.publicKey) {
            let title = this.props.displayName || this.props.uri
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
                            <Dialog.Title style={styles.title}>{title}</Dialog.Title>
                             <Text style={styles.body}>
                                 PGP Public Key
                            </Text>
                            <Text style={styles.key}>
                              {this.props.publicKey}
                            </Text>
                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={this.state.confirm}
                            onPress={this.handleClipboardButton}
                            icon="content-copy"
                            accessibilityLabel="Copy"
                            >Copy
                        </Button>

                        <Button
                            mode="contained"
                            disabled={this.state.myself}
                            style={styles.button}
                            onPress={this.deletePublicKey}
                            icon="delete"
                            accessibilityLabel="Delete"
                            >{this.state.confirm ? 'Confirm delete': 'Delete'}
                        </Button>
                        </View>
                        </Surface>
                    </DialogType>
                </Portal>
            );
        }

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <Dialog.Title style={styles.title}>{this.props.uri}</Dialog.Title>
                        {this.props.myself ?
                         <Text style={styles.body}>
                             My display name seen by others:
                        </Text>
                        : null}
                       <TextInput
                            mode="flat"
                            name="display_name"
                            label="Display name"
                            onChangeText={this.onInputChange}
                            defaultValue={(this.state.displayName !== this.props.uri) ? this.state.displayName : ''}
                            required
                            autoCapitalize="words"
                        />

                       <TextInput
                            mode="flat"
                            name="organization"
                            label="Organization"
                            onChangeText={this.onOrganizationChange}
                            defaultValue={this.state.organization}
                            required
                            autoCapitalize="words"
                        />

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={this.state.confirm}
                            onPress={this.saveContact}
                            icon="content-save"
                            accessibilityLabel="Save contact details"
                            >Save
                        </Button>

                        { !this.state.myself ?
                        <Button
                            mode="contained"
                            disabled={this.state.myself}
                            style={styles.button}
                            onPress={this.deleteContact}
                            icon="content-save"
                            accessibilityLabel="Delete"
                            >{this.state.confirm ? 'Confirm delete': 'Delete'}
                        </Button>
                        : null}
                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


EditContactModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    uri                : PropTypes.string,
    displayName        : PropTypes.string,
    organization       : PropTypes.string,
    publicKey          : PropTypes.string,
    myself             : PropTypes.bool,
    saveContact        : PropTypes.func,
    deleteContact      : PropTypes.func,
    deletePublicKey    : PropTypes.func
};

export default EditContactModal;
