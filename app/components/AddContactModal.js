import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_AddContactModal.scss';


class AddContactModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.displayName,
            show: this.props.show,
            uri: null,
            displayName: null
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       displayName: nextProps.displayName,
                       uri: nextProps.uri,
                       organization: nextProps.organization
                       });
    }

    save(event) {
        event.preventDefault();
        this.props.saveContact(this.state.uri, this.state.displayName, this.state.organization);
        this.props.close();
    }

    onUriChange(value) {
        value = value.replace(/\s|\(|\)/g, '').toLowerCase();
        this.setState({uri: value});
    }

    onDisplayChange(value) {
        this.setState({displayName: value});
    }

    onOrganizationChange(value) {
        this.setState({organization: value});
    }

    render() {
        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>

                    <Dialog.Title style={styles.title}>Add contact</Dialog.Title>
                        <TextInput
                            mode="flat"
                            name="uri"
                            label="Enter user@domain"
                            onChangeText={this.onUriChange}
                            value={this.state.uri}
                            required
                            autoCapitalize="none"
                        />
                        <Text style={styles.domain}>
                             The domain is optional, it defaults to @{this.props.defaultDomain}
                        </Text>

                        <TextInput
                            mode="flat"
                            name="display_name"
                            label="Display name"
                            onChangeText={this.onDisplayChange}
                            required
                            autoCapitalize="words"
                        />

                       <TextInput
                            mode="flat"
                            name="organization"
                            label="Organization"
                            onChangeText={this.onOrganizationChange}
                            autoCapitalize="words"
                        />

                        <View style={styles.buttonRow}>
                        {!this.state.uri ?
                        <Button
                            mode="flat"
                            style={styles.button}
                            icon="content-save"
                            accessibilityLabel="Save"
                            >Save
                        </Button>
                        :
                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={!this.state.uri}
                            onPress={this.save}
                            icon="content-save"
                            accessibilityLabel="Save"
                            >Save
                        </Button>
                        }

                        </View>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


AddContactModal.propTypes = {
    show       : PropTypes.bool,
    close      : PropTypes.func.isRequired,
    saveContact: PropTypes.func,
    defaultDomain: PropTypes.string
};

export default AddContactModal;
