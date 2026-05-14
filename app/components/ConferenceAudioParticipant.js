import React, {Component, Fragment} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import UserIcon from './UserIcon';
import VuMeter from './VuMeter';
import { List, Text } from 'react-native-paper';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  card: {
    height: 60,
    borderWidth: 0,
    borderColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  displayName: {
    fontSize: 16,
    color: 'white',
  },

  uri: {
    fontSize: 14,
    color: 'white',
  },

  media: {
    fontSize: 12,
    color: 'white',
    paddingBottom: 6,
    textAlign: 'right',
  },

  mediaMedium: {
    fontSize: 12,
    color: 'orange',
    paddingBottom: 6,
    textAlign: 'right',
  },

  mediaBad: {
    fontSize: 12,
    color: 'red',
    paddingBottom: 6,
    textAlign: 'right',
  },

  mediaGood: {
    fontSize: 12,
    color: 'green',
    paddingBottom: 6,
    textAlign: 'right',
  },

  right: {
    fontSize: 12,
    color: 'white',
    textAlign: 'right',
  },

  rightOrange: {
    fontSize: 12,
    color: 'orange',
    textAlign: 'right',
  },

  rightGreen: {
    fontSize: 12,
    color: 'yellow',
    textAlign: 'right',
  },

  userIconContainer: {
    paddingRight: 0,
    paddingLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',    
  },

  userButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'white'
  },

  mediaContainer: {
    flexDirection: 'column',
    borderWidth: 0,
    borderColor: 'white'
  },

  // Container for the per-participant VU meter row, rendered as a
  // sibling below the participant's List.Item card. Tight vertical
  // padding so the meter hugs the row above without inflating each
  // attendee's overall row height by much. Horizontal padding lines
  // the meter up with the title/description text on the left, so a
  // tall conference list reads as a clean column of "name above,
  // bar below".
  vuRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    marginTop: -4,
  },
});


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
            media = this.props.loss > 50 ? 'Audio lost' : this.props.loss + '% loss';
            mediaStyle = this.props.loss > 25 ? styles.mediaBad : styles.mediaMedium;
        } else if (this.props.latency) {
            // "ms" alone is enough on a status chip — the value
            // is unambiguous as a millisecond RTT. The "delay"
            // suffix was redundant and took up tile real estate
            // next to the number.
			media = this.props.latency + ' ms';
            if (this.props.latency < 250) {
            } else if (this.props.latency && this.props.latency >= 300 && this.props.latency < 600) {
                mediaStyle = styles.mediaMedium;
            } else if (this.props.latency && this.props.latency >= 600) {
                mediaStyle = styles.mediaBad;
            }
        } else {
            media = 'Waiting for audio...';
        }
        
        //console.log(mediaStyle);

        // Show a per-participant VU meter when an audioLevel was
        // supplied by ConferenceBox. The level (0..1) is sampled at
        // ~5 Hz from WebRTC's getStats() on each participant's PC
        // (remote = inbound-rtp audioLevel; local mic = media-source
        // audioLevel) and forwarded down here as a plain number prop
        // — the meter component itself stays pure-render. We gate
        // on `audioLevel !== undefined` so callers that don't pass
        // the prop (e.g. invited-not-yet-joined rows with no PC
        // yet) suppress the meter entirely rather than rendering
        // a permanently-dark bar that would imply the participant
        // is connected-but-silent.
        const hasLevel = typeof this.props.audioLevel === 'number';

        return (
            <View style={{justifyContent: 'center', alignItems: 'stretch' }}>
            <List.Item
                style={styles.card}
                title={identity.displayName||identity.uri}
                titleStyle={styles.displayName}
                description={identity.uri}
                descriptionStyle={styles.uri}
                left={props => <View style={styles.userIconContainer}>
                                  <UserIcon size={40} identity={identity}/>
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
            {hasLevel ? (
                <View style={styles.vuRow}>
                    <VuMeter
                        level={this.props.audioLevel}
                        width="100%"
                        cellHeight={5}
                    />
                </View>
            ) : null}
            </View>
        );
    }
}

ConferenceAudioParticipant.propTypes = {
    identity: PropTypes.object.isRequired,
    participant: PropTypes.object,
    isLocal: PropTypes.bool,
    status: PropTypes.string,
    loss: PropTypes.number,
    latency: PropTypes.number,
    codec: PropTypes.string,
    // Audio signal level (0..1) for the per-participant VU meter.
    // Optional — when omitted the meter row is suppressed (used
    // for invited-but-not-yet-joined attendees that have no peer
    // connection to sample from).
    audioLevel: PropTypes.number,
    extraButtons: PropTypes.array
};


export default ConferenceAudioParticipant;
