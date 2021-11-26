import React, {Component, Fragment} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
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
            if (!this.props.participant.videoPaused) {
                this.props.participant.pauseVideo();
            }
            this.setState({stream: streams[0]});
        }
    }

    render() {
        let identity = this.props.identity;
        let rightStyle = styles.right ;

        if (this.props.status === 'Muted') {
            rightStyle = styles.rightOrange;
        } else if (this.props.status && this.props.status.indexOf('kbit') > -1) {
            rightStyle = styles.rightGreen;
        }

        let media = '';
        let mediaStyle = styles.mediaGood;
        if (this.props.loss && this.props.loss > 7) {
            media = this.props.loss > 50 ? 'Audio lost' : this.props.loss + '% packet loss';
            mediaStyle = styles.mediaBad;
        } else if (this.props.latency) {
            if (this.props.latency < 300) {
                media = this.props.latency + ' ms delay';
            } else if (this.props.latency && this.props.latency >= 300 && this.props.latency < 600) {
                media = this.props.latency + ' ms delay';
                mediaStyle = styles.mediaMedium;
            } else if (this.props.latency && this.props.latency >= 600) {
                media = this.props.latency + ' ms big delay';
                mediaStyle = styles.mediaBad;
            }
        } else {
            media = 'Waiting for audio...';
            mediaStyle = styles.mediaBad;
        }

        return (
            <List.Item
            style={styles.card}
                title={identity.displayName||identity.uri}
                key={identity.uri}
                titleStyle={styles.displayName}
                description={identity.uri}
                descriptionStyle={styles.uri}
                left={props => <View style={styles.userIconContainer}>
                                  <UserIcon small={true} identity={identity}/>
                               </View>
                      }
                right={props =>
                           <View style={styles.userButtonsContainer}>
                              {this.props.extraButtons && this.props.extraButtons.length > 0 ? this.props.extraButtons :
                                <View style={styles.mediaContainer}>
                                  <Text style={mediaStyle}>{media}</Text>
                                  <Text style={rightStyle}>{this.props.status}</Text>
                                </View>
                              }
                              <RTCView streamURL={this.state.stream ? this.state.stream.toURL() : null }/>
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
    supportsVideo: PropTypes.bool,
    status: PropTypes.string,
    loss: PropTypes.number,
    latency: PropTypes.number,
    extraButtons: PropTypes.array

};


export default ConferenceAudioParticipant;
