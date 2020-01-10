
import React, { Component } from 'react';
import PropTypes from 'prop-types';
// const hark              = require('hark');
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { Paragraph } from 'react-native-paper';
import { RTCView } from 'react-native-webrtc';
import { View } from 'react-native';

import styles from '../assets/styles/blink/_ConferenceMatrixParticipant.scss';

class ConferenceMatrixParticipant extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            active: false,
            hasVideo: false,
            sharesScreen: false,
            audioMuted: false,
            stream: null
        }
        this.speechEvents = null;

        this.videoElement = React.createRef();

        if (!props.isLocal) {
            props.participant.on('stateChanged', this.onParticipantStateChanged);
        }

    }

    componentDidMount() {
        this.maybeAttachStream();
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
        console.log(this.props.participant);
        if (streams.length > 0) {
            this.setState({stream: streams[0], hasVideo: streams[0].getVideoTracks().length > 0});
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

        const participantInfo = (
            <View className="controls">
                <Paragraph className="lead">{this.props.participant.identity.displayName || this.props.participant.identity.uri}</Paragraph>
            </View>
        );

        let activeIcon;

        if (this.props.isLocal) {
            activeIcon = (
                <View className="controls-top">
                    <Paragraph className="lead">Speaker</Paragraph>
                </View>
            );
        }

        console.log(this.state.stream);

        return (
            <View style={styles.container}>
                {activeIcon}
                {/* {participantInfo} */}
                <View className="video" style={styles.videoContainer}>
                    <RTCView style={this.props.large ? styles.videoLarge : styles.video} poster="assets/images/transparent-1px.png" ref={this.videoElement} streamURL={this.state.stream ? this.state.stream.toURL() : null} />
                </View>
            </View>
        );
    }
}

ConferenceMatrixParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    large: PropTypes.bool,
    isLocal: PropTypes.bool
};

export default ConferenceMatrixParticipant;
