import React from 'react';
import PropTypes from 'prop-types';
// const hark              = require('hark');
import { View, TouchableWithoutFeedback } from 'react-native';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { IconButton, Surface } from 'react-native-paper';
import { RTCView } from 'react-native-webrtc';
import UserIcon from './UserIcon';

import styles from '../assets/styles/blink/_ConferenceParticipant.scss';

class ConferenceParticipant extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            active: false,
            hasVideo: false,
            overlayVisible: false,
            audioMuted: false,
            stream: null
        }
        this.speechEvents = null;

        this.videoElement = React.createRef();

        props.participant.on('stateChanged', this.onParticipantStateChanged);
    }

    componentDidMount() {
        this.maybeAttachStream();
        // this.videoElement.current.oncontextmenu = (e) => {
        //     // disable right click for video elements
        //     e.preventDefault();
        // };
    }

    componentWillUnmount() {
        //this.videoElement.current.pause();
        this.props.participant.removeListener('stateChanged', this.onParticipantStateChanged);
        if (this.speechEvents !== null) {
            this.speechEvents.stop();
            this.speechEvents = null;
        }
    }

    onParticipantStateChanged(oldState, newState) {
        if (newState === 'established') {
            this.maybeAttachStream();
        }
    }

    onMuteAudioClicked(event) {
        event.preventDefault();
        const streams = this.props.participant.streams;
        if (streams.length > 0 && streams[0].getAudioTracks().length > 0) {
            const track = streams[0].getAudioTracks()[0];
            if(this.state.audioMuted) {
                track.enabled = true;
                this.setState({audioMuted: false});
            } else {
                console.log('Mute audio');
                track.enabled = false;
                this.setState({audioMuted: true});
            }
        }
    }

    maybeAttachStream() {
        const streams = this.props.participant.streams;
        if (streams.length > 0) {
            this.setState({stream: streams[0], hasVideo: streams[0].getVideoTracks().length > 0});
            if (this.props.pauseVideo) {
                this.props.participant.pauseVideo();
            }
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

    showOverlay() {
        this.setState({overlayVisible: true});
    }

    hideOverlay() {
        if (!this.state.audioMuted) {
            this.setState({overlayVisible: false});
        }
    }

    render() {
        // const tooltip = (
        //     <Tooltip id={this.props.participant.id}>{this.props.participant.identity.displayName || this.props.participant.identity.uri}</Tooltip>
        // );

        const classes = classNames({
            'poster' : !this.state.hasVideo,
            'conference-active' : this.state.active
        });

        let muteButton;

        if (this.state.overlayVisible) {
            const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';

            muteButton = (
                <View className="mute">
                    <IconButton icon={muteButtonIcons} onPress={this.onMuteAudioClicked} />
                </View>
            );
        }

        let icon;
        if (this.props.pauseVideo && this.props.display) {
            icon = <TouchableWithoutFeedback onPress={() => this.props.selected(this.props.participant)}><View><UserIcon identity={this.props.participant.identity} carousel /></View></TouchableWithoutFeedback>;
        }

        return (
            <View style={[styles.container, this.props.display === 'false' ? {display: 'none'} : null]}>
                {muteButton}
                {icon}
                {/* <OverlayTrigger placement="top" overlay={tooltip}> */}
                    <Surface style={[styles.videoContainer, this.props.pauseVideo ? {display: 'none'} : null]}>
                        <RTCView objectFit="cover" ref={this.videoElement} streamURL={this.state.stream ? this.state.stream.toURL() : null} poster="assets/images/transparent-1px.png" style={styles.video}/>
                    </Surface>
                {/* </OverlayTrigger> */}
            </View>
        );
    }
}

ConferenceParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    display: PropTypes.bool,
    pauseVideo: PropTypes.bool,
    selected: PropTypes.func,
    status: PropTypes.string
};

export default ConferenceParticipant;
