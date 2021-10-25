import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, DataTable } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import utils from '../utils';
import * as RNFS from 'react-native-fs';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_MessageInfoModal.scss';


class MessageInfoModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: this.props.show,
            message: this.props.message,
            fileExists: false
        }

        if (this.props.message && this.props.message.local_url) {
            RNFS.exists(this.props.message.local_url).then(res => {
                this.setState({fileExists: res});
                console.log('File exists', res);
            });
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({message: nextProps.message,
                       fileExists: nextProps.fileExists,
                       show: nextProps.show});

        if (nextProps.message && nextProps.message.local_url) {
            RNFS.exists(nextProps.message.local_url).then(res => {
                this.setState({fileExists: res});
                console.log('File exists', res);
            });
        }
    }

    render() {
        if (!this.state.message) {
            return (null);
        }

        //console.log('this.state.message', this.state.message.local_url);

        let status = this.state.message.direction === 'outgoing' ? 'Message is on the way' : 'Message was received';
        let encryption = 'Not encrypted';

        if (this.state.message.encrypted > 0) {
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
        if (this.state.message.url) {
            let path = this.state.message.url.split('/');
            filename = path[path.length-1];
            what = 'file';
        }

        let fileExists = this.state.fileExists ? 'File is saved' : 'File was not saved';

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
                        {!this.state.message.url ?
                        <DataTable.Row>
                          <DataTable.Cell>{encryption}</DataTable.Cell>
                        </DataTable.Row>
                        : null}
                        <DataTable.Row>
                          <DataTable.Cell>{utils.titleCase(this.state.message.direction)} {what}</DataTable.Cell>
                        </DataTable.Row>
                        { this.state.message.url ?
                        <DataTable.Row>
                          <DataTable.Cell>{filename}</DataTable.Cell>
                        </DataTable.Row>
                        : null}
                        { this.state.message.url ?
                        <DataTable.Row>
                          <DataTable.Cell>{fileExists}</DataTable.Cell>
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
