import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, DataTable } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import utils from '../utils';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_MessageInfoModal.scss';


class MessageInfoModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: this.props.show,
            message: this.props.message
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({message: nextProps.message,
                       show: nextProps.show});
    }

    render() {
        if (!this.state.message) {
            return (null);
        }

        let status = this.state.message.direction === 'outgoing' ? 'Message is on the way' : 'Message was received';
        let encryption = 'Not encrypted';

        if (this.state.message.encrypted == 2) {
            encryption = 'Encrypted';
        }

        if (this.state.message.failed) {
            status = 'Message could not be delivered';
        } else if (this.state.message.received) {
            status = 'Message was read';
        } else if (this.state.message.sent) {
            status = 'Message was delivered, but not read';
        } else if (this.state.message.pending) {
            status = 'Message is not yet sent';
        }

        let title = this.state.message ? this.state.message.user._id : null;
        let filename;
        let what = 'message';
        if (this.state.message.local_url) {
            let path = this.state.message.local_url.split('/');
            filename = path[path.length-1];
            what = 'file';
        }

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                    {title ?
                    <Dialog.Title style={styles.title}>{title}</Dialog.Title>
                    : null}
                     <DataTable>
                        <DataTable.Row>
                          <DataTable.Cell>{this.state.message.createdAt.toString()}</DataTable.Cell>
                        </DataTable.Row>
                        {!this.state.message.local_url ?
                        <DataTable.Row>
                          <DataTable.Cell>{encryption}</DataTable.Cell>
                        </DataTable.Row>
                        : null}
                        <DataTable.Row>
                          <DataTable.Cell>{utils.titleCase(this.state.message.direction)} {what}</DataTable.Cell>
                        </DataTable.Row>
                        { this.state.message.local_url ?
                        <DataTable.Row>
                          <DataTable.Cell>{filename}</DataTable.Cell>
                        </DataTable.Row>
                        : null}

                      </DataTable>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}


MessageInfoModal.propTypes = {
    show    : PropTypes.bool,
    close   : PropTypes.func.isRequired,
    message : PropTypes.object
};

export default MessageInfoModal;
