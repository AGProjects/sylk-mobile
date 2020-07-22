import React, { Component } from 'react';
import { View } from   'react-native';
import PropTypes from 'prop-types';
//const hark              = require('hark');
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { RTCView } from 'react-native-webrtc';
import { Surface } from 'react-native-paper';

import styles from '../assets/styles/blink/_ConferenceParticipantSelf.scss';

class ConferenceParticipantSelf extends Component {
    constructor(props) {
        super(props);
        this.state = {
            active: false,
            hasVideo: false,
            sharesScreen: false,
        }
        // this.speechEvents = null;
    }

    componentDidMount() {
        // factor it out to a function to avoid lint warning about calling setState here
        this.attachSpeechEvents();
        // this.refs.videoElement.onresize = (event) => {
        //     this.handleResize(event)
        // };
    }

    handleResize(event) {
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({sharesScreen: true});
        } else {
            this.setState({sharesScreen: false});
        }
    }

    componentWillUnmount() {
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    attachSpeechEvents() {
        this.setState({hasVideo: this.props.stream.getVideoTracks().length > 0});

        // const options = {
        //     interval: 150,
        //     play: false
        // };
        // this.speechEvents = hark(this.props.stream, options);
        // this.speechEvents.on('speaking', () => {
        //     this.setState({active: true});
        // });
        // this.speechEvents.on('stopped_speaking', () => {
        //     this.setState({active: false});
        // });
    }

    render() {
        if (this.props.stream == null) {
            return false;
        }

        // const tooltip = (
        //     <Tooltip id="t-myself">{this.props.identity.displayName || this.props.identity.uri}</Tooltip>
        // );

        let muteIcon
        if (this.props.audioMuted) {
            muteIcon = (
                <View style={styles.muteIcon}>
                    <Icon name="microphone-off" size={30} color="#fff" style={styles.icon}/>
                </View>
            );
        }

        return (
            <Surface style={styles.container}>
                {muteIcon}
                <RTCView objectFit="cover" style={styles.video} ref="videoElement" poster="assets/images/transparent-1px.png" streamURL={this.props.stream ? this.props.stream.toURL() : null} mirror={true}/>
            </Surface>
        );
    }
}

ConferenceParticipantSelf.propTypes = {
    stream: PropTypes.object.isRequired,
    identity: PropTypes.object.isRequired,
    audioMuted: PropTypes.bool.isRequired,
    generatedVideoTrack: PropTypes.bool
};


export default ConferenceParticipantSelf;
