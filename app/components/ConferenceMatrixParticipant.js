
import React, { Component } from 'react';
import PropTypes from 'prop-types';
// const hark              = require('hark');
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { Title, Badge, Text } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { RTCView } from 'react-native-webrtc';
import { View } from 'react-native';

//import styles from '../assets/styles/ConferenceMatrixParticipant';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },

  portraitContainer: {
    flexBasis: '50%',
    height: '50%',
  },

  landscapeContainer: {
    flexBasis: '50%',
    width: '50%',
  },

  soloContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  videoContainer: {
    height: '100%',
    width: '100%',
  },

  video: {
    height: '100%',
    width: '100%',
  },

  controlsTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'row',
    maxHeight: 50,
    minHeight: 50,
    paddingLeft: 20,
  },

  badge: {
    backgroundColor: '#5cb85c',
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '500',
  },

  controls: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'flex-end',
    flexDirection: 'row',
    maxHeight: 114,
    minHeight: 114,
    paddingLeft: 20,
  },
  lead: {
    color: '#fff',
    marginBottom: 10,
    marginLeft: 120,
  },
  status: {
    color: '#fff',
    fontSize: 8,
    marginBottom: 16,
    marginLeft: 5,
  },
});


class ConferenceMatrixParticipant extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            hasVideo: false,
            sharesScreen: false,
            audioMuted: false,
            stream: null,
            status: this.props.status
        }
        this.speechEvents = null;

        this.videoElement = React.createRef();

        if (!props.isLocal) {
            props.participant.on('stateChanged', this.onParticipantStateChanged);
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {

        if (nextProps.hasOwnProperty('status')) {
            this.setState({status: nextProps.status});
        }

        if (nextProps.hasOwnProperty('stream')) {
            this.setState({stream: nextProps.stream});
        }

        if (nextProps.hasOwnProperty('hasVideo')) {
            this.setState({hasVideo: nextProps.hasVideo});
        }

        if (nextProps.hasOwnProperty('audioMuted')) {
            this.setState({audioMuted: nextProps.audioMuted});
        }
    }

    componentDidMount() {
        this.maybeAttachStream();
        if (!this.props.pauseVideo && this.props.participant.videoPaused) {
            this.props.participant.resumeVideo();
        }

        // this.videoElement.current.oncontextmenu = (e) => {
        //     // disable right click for video elements
        //     e.preventDefault();
        // };
        // this.videoElement.current.onresize = (event) => {
        //     this.handleResize(event);
        // };
    }

    componentWillUnmount() {
        if (!this.props.isLocal) {
            this.props.participant.removeListener('stateChanged', this.onParticipantStateChanged);
        }
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    onParticipantStateChanged(oldState, newState) {
        console.log('onParticipantStateChanged', newState);
        if (newState === 'established') {
            this.maybeAttachStream();
        }
    }

    handleResize(event) {
        // console.log(event.srcElement.videoWidth);
        const resolutions = ['1280x720', '960x540', '640x480', '640x360', '480x270', '320x180'];
        if (this.state.hasVideo) {
            const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
            if (resolutions.indexOf(videoResolution) === -1) {
                this.setState({sharesScreen: true});
            } else {
                this.setState({sharesScreen: false});
            }
        }
    }

    maybeAttachStream() {
        const streams = this.props.participant.streams;
        //console.log('maybeAttachStream', streams);

        if (streams.length > 0) {
            this.setState({stream: streams[0], 
                          hasVideo: streams[0].getVideoTracks().length > 0});

            // const options = {
            //     interval: 150,
            //     play: false
            // };
            // this.speechEvents = hark(streams[0], options);
            // this.speechEvents.on('speaking', () => {
            //     this.setState({active: true});
            // });
            // this.speechEvents.on('stopped_speaking', () => {
            //     this.setState({active: false});
            // });
        }
    }

    render() {
        // const classes = classNames({
        //     'poster' : !this.state.hasVideo,
        //     'fit'    : this.state.sharesScreen
        // });
        // const remoteVideoClasses = classNames({
        //     'remote-video'      : true,
        //     'large'             : this.props.large,
        //     'conference-active' : this.state.active
        // });

        //console.log('Participant', this.props.participant.identity.uri, 'status', this.state.status);

        const participantInfo = (
            <LinearGradient start={{x: 0, y: .55}}  end={{x: 0, y: 1}} colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, .5)']} style={styles.controls}>
                <Title style={styles.lead}>{this.props.participant.identity.displayName || this.props.participant.identity.uri}</Title>
                <Text style={styles.status}>{this.state.status}</Text>
            </LinearGradient>
        );

        let activeIcon;

        if (this.props.isLocal) {
            activeIcon = (
                <View style={styles.controlsTop}>
                    <Badge style={styles.badge}>Speaker</Badge>
                </View>
            );
        }

        const remoteStreamUrl = this.state.stream ? this.state.stream.toURL() : null
        //console.log('remoteStreamUrl', remoteStreamUrl);
        return (
			<View style={[{ flex: 1, width: '100%', height: '100%'}]}>
				{activeIcon}
				{participantInfo}
				<View style={styles.videoContainer}>
					<RTCView
						objectFit='cover'
						style={styles.video}
						poster="assets/images/transparent-1px.png"
						ref={this.videoElement}
						streamURL={remoteStreamUrl}
					/>
				</View>
			</View>
        );
    }
}

ConferenceMatrixParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    isLocal: PropTypes.bool,
    status: PropTypes.string,
    audioMuted: PropTypes.bool
};

export default ConferenceMatrixParticipant;
