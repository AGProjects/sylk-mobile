import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Portal, Modal, Title, Button, Text, TextInput, Surface } from 'react-native-paper';

import config from '../config';
import styles from '../assets/styles/blink/_ConferenceModal.scss';

class ConferenceModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            conferenceTargetUri: props.targetUri.split('@')[0],
            managed: false
        };
        this.handleConferenceTargetChange = this.handleConferenceTargetChange.bind(this);
        this.onHide = this.onHide.bind(this);
        this.join = this.join.bind(this);
    }

    componentWillReceiveProps(nextProps) {
        this.setState({conferenceTargetUri: nextProps.targetUri.split('@')[0]});
    }

    handleConferenceTargetChange(value) {
        this.setState({conferenceTargetUri: value});
    }

    join(event) {
        event.preventDefault();
        const uri = `${this.state.conferenceTargetUri.replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
        this.props.handleConferenceCall(uri.toLowerCase(), this.state.managed);
    }

    onHide() {
        this.props.handleConferenceCall(null);
    }

    render() {
        const validUri = this.state.conferenceTargetUri.length > 0 && this.state.conferenceTargetUri.indexOf('@') === -1;

        return (
            <Portal>
                <Modal visible={this.props.show} onDismiss={this.onHide}>
                    <Surface style={styles.container}>
                        <Title style={styles.title}>Join Conference</Title>
                        <Text style={styles.body}>Enter the room you wish to join</Text>
                        <TextInput
                            mode="outlined"
                            autoCapitalize="none"
                            label="Conference Room"
                            placeholder="Conference Room"
                            onChangeText={this.handleConferenceTargetChange}
                            required
                            value={this.state.conferenceTargetUri}
                        />
                        <Button
                            mode="contained"
                            onPress={this.join}
                            disabled={!validUri}
                            icon="video"
                        >
                            Join
                        </Button>
                    </Surface>
                </Modal>
            </Portal>
        );
    }
}

ConferenceModal.propTypes = {
    show: PropTypes.bool.isRequired,
    handleConferenceCall: PropTypes.func.isRequired,
    targetUri: PropTypes.string.isRequired
};

export default ConferenceModal;
