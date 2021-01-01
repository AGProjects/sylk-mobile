import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, ScrollView, TouchableOpacity, Clipboard} from 'react-native';
import { Dialog, Portal, Text, Button, Paragraph } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_LogsModal.scss';


class ShowLogsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.scroll = null;

        this.state = {
            logs: this.props.logs,
            show: this.props.show,
            textInputText: ''
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({show: nextProps.show,
                       logs: nextProps.logs});

        if (this.scroll) {
            this.scroll.scrollToEnd();
        }
    }

    copyToClipboard = async () => {
        await Clipboard.setString(this.state.logs);
    }

    componentDidMount() {
        setTimeout(() => {
            if (this.scroll) {
                this.scroll.scrollToEnd();
            }
        }, 500);
    }

    render() {
        const containerClass = this.props.orientation === 'landscape' ? styles.scrollViewLandscape : styles.scrollViewPortrait;

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <View style={styles.container}>
                        <Text style={styles.title}>Sylk logs</Text>
                            <ScrollView style={containerClass} ref={(scroll) => {this.scroll = scroll;}}>
                                <TouchableOpacity onPress={() => this.copyToClipboard()}>
                                    <Text style={styles.body}>{this.state.logs}</Text>
                                </TouchableOpacity>
                            </ScrollView>

                        <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.copyToClipboard}
                            accessibilityLabel="Copy"
                            >Copy
                        </Button>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.props.refresh}
                            accessibilityLabel="Refresh"
                            >Refresh
                        </Button>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.props.purgeLogs}
                            accessibilityLabel="Purge"
                            color="red"
                            >Purge
                        </Button>
                        </View>
                    </View>
                </DialogType>
            </Portal>
        );
    }
}

ShowLogsModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    purgeLogs          : PropTypes.func.isRequired,
    refresh            : PropTypes.func.isRequired,
    orientation        : PropTypes.string,
    logs               : PropTypes.string
};

export default ShowLogsModal;
