import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    ScrollView,
    TouchableOpacity,
    Clipboard,
    Modal,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal / DeleteHistoryModal /
// DeleteFileTransfers / AboutModal so every dialog has the same
// rounded-corner card on a dimmed backdrop. Dropped the old Paper
// Dialog/Portal wrapper (which also had a stealthy Platform reference
// that was never imported — a crash waiting to happen on first open).
import containerStyles from '../assets/styles/ContainerStyles';

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
            <Modal
                style={containerStyles.container}
                visible={!!this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.props.close}
            >
                <TouchableWithoutFeedback onPress={this.props.close}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when taps land inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <View style={styles.container}>
                                        <Text style={containerStyles.title}>Sylk logs</Text>
                                        {/* The inner ScrollView is what the
                                            log body scrolls inside — keeping
                                            its ref so auto-scroll-to-end
                                            still works. `keyboardShouldPersistTaps`
                                            lets the user tap-to-copy while
                                            any keyboard is up. */}
                                        <ScrollView
                                            style={containerClass}
                                            ref={(scroll) => {this.scroll = scroll;}}
                                            keyboardShouldPersistTaps="handled"
                                        >
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
                                            >
                                                Copy
                                            </Button>
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                onPress={this.props.refresh}
                                                accessibilityLabel="Refresh"
                                            >
                                                Refresh
                                            </Button>
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                onPress={this.props.purgeLogs}
                                                accessibilityLabel="Purge"
                                                color="red"
                                            >
                                                Purge
                                            </Button>
                                        </View>
                                    </View>
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
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
