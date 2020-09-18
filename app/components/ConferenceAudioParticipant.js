import React, {Component, Fragment} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import UserIcon from './UserIcon';
import { List, Text } from 'react-native-paper';
import styles from '../assets/styles/blink/_ConferenceAudioParticipant.scss';


class ConferenceAudioParticipant extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            stream: null
        }

        if (!props.isLocal && props.participant) {
            props.participant.on('stateChanged', this.onParticipantStateChanged);
        }
    }

    componentDidMount() {
        this.maybeAttachStream();
    }

    componentWillUnmount() {
        if (!this.props.isLocal && this.props.participant) {
            this.props.participant.removeListener('stateChanged', this.onParticipantStateChanged);
        }
    }

    onParticipantStateChanged(oldState, newState) {
        if (newState === 'established') {
            this.maybeAttachStream();
        }
    }

    maybeAttachStream() {
        if (!this.props.participant) {
            return;
        }

        const streams = this.props.participant.streams;
        if (streams.length > 0) {
            console.log('Attach stream');
            this.props.participant.pauseVideo();
            this.setState({stream: streams[0]});
        }
    }

    render() {
        const tag = this.props.isLocal ? 'Myself' : this.props.status;
        let identity = this.props.identity;

        return (
            <List.Item
            style={styles.card}
                title={identity.displayName||identity.uri}
                titleStyle={styles.displayName}
                description={identity.uri}
                descriptionStyle={styles.uri}
                left={props => <View style={styles.userIconContainer}><UserIcon identity={identity} /></View>}
                right={props => <View>
                                <Text style={styles.right}>{tag}</Text>
                                <RTCView streamURL={this.state.stream ? this.state.stream.toURL() : null}/>
                                </View>
                                }
            />
        );
    }
}

ConferenceAudioParticipant.propTypes = {
    identity: PropTypes.object.isRequired,
    participant: PropTypes.object,
    isLocal: PropTypes.bool,
    status: PropTypes.string
};


export default ConferenceAudioParticipant;
