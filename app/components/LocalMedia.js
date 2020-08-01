import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Dimensions } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { IconButton } from 'react-native-paper';

import CallOverlay from './CallOverlay';
import styles from '../assets/styles/blink/_LocalMedia.scss';


class LocalMedia extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.localVideo = React.createRef();

    }

    componentDidMount() {
        this.props.mediaPlaying();
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('stop_preview');
    }

    render() {
        let {height, width} = Dimensions.get('window');
        let videoStyle = {
            height,
            width
        };

        const streamUrl = this.props.localMedia ? this.props.localMedia.toURL() : null;
        const buttonSize = this.props.isTablet ? 40 : 34;
        const buttonContainerClass = this.props.isTablet ? styles.tabletButtonContainer : styles.buttonContainer;

        return (
            <Fragment>
                <CallOverlay
                    show = {true}
                    remoteUri={this.props.remoteUri}
                    remoteDisplayName={this.props.remoteDisplayName}
                    call = {this.props.call}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                />
                <View style={buttonContainerClass}>
                    <IconButton style={styles.button} key="hangupButton" onPress={this.hangupCall} icon="phone-hangup" size={buttonSize} />
                </View>

                <View style={styles.container}>
                    <RTCView objectFit="cover"
                             style={[styles.video, videoStyle]}
                             id="localVideo"
                             ref={this.localVideo}
                             streamURL={streamUrl}
                             mirror={true}
                             />
                </View>
            </Fragment>
        );
    }
}

LocalMedia.propTypes = {
    call                : PropTypes.object,
    hangupCall          : PropTypes.func,
    localMedia          : PropTypes.object.isRequired,
    remoteUri           : PropTypes.string,
    remoteDisplayName   : PropTypes.string,
    mediaPlaying        : PropTypes.func.isRequired,
    generatedVideoTrack : PropTypes.bool,
    connection          : PropTypes.object,
    accountId           : PropTypes.string,
    orientation         : PropTypes.string,
    isTablet            : PropTypes.bool
};


export default LocalMedia;
