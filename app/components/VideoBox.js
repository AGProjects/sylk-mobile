import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import { IconButton } from 'react-native-paper';
import { View, Dimensions } from 'react-native';
import { RTCView } from 'react-native-webrtc';

import CallOverlay from './CallOverlay';
import EscalateConferenceModal from './EscalateConferenceModal';

import styles from '../assets/styles/blink/_VideoBox.scss';

const DEBUG = debug('blinkrtc:Video');
debug.enable('*');

class VideoBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            callOverlayVisible: true,
            audioMuted: false,
            videoMuted: false,
            localVideoShow: false,
            remoteVideoShow: false,
            remoteSharesScreen: false,
            showEscalateConferenceModal: false,
            localStream: null,
            remoteStream: null
        };

        this.overlayTimer = null;
        this.localVideo = React.createRef();
        this.remoteVideo = React.createRef();
    }

    callStateChanged(oldState, newState, data) {
        DEBUG(`Call state changed ${oldState} -> ${newState}`);
        if (newState === 'established') {
            this.forceUpdate();
        }
    }

    componentDidMount() {

        console.log('localStreams', this.props.call.getLocalStreams());
        console.log('remoteStreams', this.props.call.getRemoteStreams());

        this.setState({localStream: this.props.call.getLocalStreams()[0], localVideoShow: true, remoteStream: this.props.call.getRemoteStreams()[0], remoteVideoShow: true});

        this.props.call.on('stateChanged', this.callStateChanged);

        // sylkrtc.utils.attachMediaStream(, this.localVideo.current, {disableContextMenu: true});
        // let promise =  this.localVideo.current.play()
        // if (promise !== undefined) {
        //     promise.then(_ => {
        //         this.setState({localVideoShow: true});    // eslint-disable-line react/no-did-mount-set-state
        //         // Autoplay started!
        //     }).catch(error => {
        //         // Autoplay was prevented.
        //         // Show a "Play" button so that user can start playback.
        //     });
        // } else {
        //     this.localVideo.current.addEventListener('playing', () => {
        //         this.setState({});    // eslint-disable-line react/no-did-mount-set-state
        //     });
        // }

        // this.remoteVideo.current.addEventListener('playing', this.handleRemoteVideoPlaying);
        // sylkrtc.utils.attachMediaStream(this.props.call.getRemoteStreams()[0], this.remoteVideo.current, {disableContextMenu: true});
    }

    componentWillUnmount() {
        // clearTimeout(this.overlayTimer);
        // this.remoteVideo.current.removeEventListener('playing', this.handleRemoteVideoPlaying);
        // this.exitFullscreen();
    }

    handleFullscreen(event) {
        event.preventDefault();
        // this.toggleFullscreen();
    }

    handleRemoteVideoPlaying() {
        this.setState({remoteVideoShow: true});
        // this.remoteVideo.current.onresize = (event) => {
        //     this.handleRemoteResize(event)
        // };
        // this.armOverlayTimer();
    }

    handleRemoteResize(event, target) {
        //DEBUG("%o", event);
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({remoteSharesScreen: true});
        } else {
            this.setState({remoteSharesScreen: false});
        }
    }

    muteAudio(event) {
        event.preventDefault();
        const localStream = this.state.localStream;
        if (localStream.getAudioTracks().length > 0) {
            const track = localStream.getAudioTracks()[0];
            if(this.state.audioMuted) {
                DEBUG('Unmute microphone');
                track.enabled = true;
                this.setState({audioMuted: false});
            } else {
                DEBUG('Mute microphone');
                track.enabled = false;
                this.setState({audioMuted: true});
            }
        }
    }

    muteVideo(event) {
        event.preventDefault();
        const localStream = this.state.localStream;
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if(this.state.videoMuted) {
                DEBUG('Unmute camera');
                track.enabled = true;
                this.setState({videoMuted: false});
            } else {
                DEBUG('Mute camera');
                track.enabled = false;
                this.setState({videoMuted: true});
            }
        }
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall();
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    armOverlayTimer() {
        clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(() => {
            this.setState({callOverlayVisible: false});
        }, 4000);
    }

    showCallOverlay() {
        if (this.state.remoteVideoShow) {
            this.setState({callOverlayVisible: true});
            this.armOverlayTimer();
        }
    }

    toggleEscalateConferenceModal() {
        this.setState({
            callOverlayVisible          : false,
            showEscalateConferenceModal : !this.state.showEscalateConferenceModal
        });
    }

    render() {
        if (this.props.call == null) {
            return (<View></View>);
        }

        const localVideoClasses = classNames({
            'video-thumbnail' : true,
            'mirror'          : !this.props.call.sharingScreen && !this.props.generatedVideoTrack,
            'hidden'          : !this.state.localVideoShow,
            'animated'        : true,
            'fadeIn'          : this.state.localVideoShow || this.state.videoMuted,
            'fadeOut'         : this.state.videoMuted,
            'fit'             : this.props.call.sharingScreen
        });

        const remoteVideoClasses = classNames({
            'poster'        : !this.state.remoteVideoShow,
            'animated'      : true,
            'fadeIn'        : this.state.remoteVideoShow,
            'large'         : true,
            'fit'           : this.state.remoteSharesScreen
        });

        let callButtons;
        let watermark;

        if (this.state.callOverlayVisible) {
            // const screenSharingButtonIcons = classNames({
            //     'fa'                    : true,
            //     'fa-clone'              : true,
            //     'fa-flip-horizontal'    : true,
            //     'text-warning'          : this.props.call.sharingScreen
            // });

            // const fullScreenButtonIcons = classNames({
            //     'fa'            : true,
            //     'fa-expand'     : !this.isFullScreen(),
            //     'fa-compress'   : this.isFullScreen()
            // });

            // const commonButtonClasses = classNames({
            //     'btn'           : true,
            //     'btn-round'     : true,
            //     'btn-default'   : true
            // });
            const buttons = [];

            // buttons.push(<Button key="shareScreen" type="button" title="Share screen" className={commonButtonClasses} onPress={this.props.shareScreen}><i className={screenSharingButtonIcons}></i></button>);
            // if (this.isFullscreenSupported()) {
            //     buttons.push(<button key="fsButton" type="button" className={commonButtonClasses} onPress={this.handleFullscreen}> <i className={fullScreenButtonIcons}></i> </button>);
            // }
            // buttons.push(<br key="break" />);

            // callButtons = (
            //     // <CSSTransition
            //     //     key="buttons"
            //     //     classNames="videobuttons"
            //     //     timeout={{ enter: 300, exit: 300}}
            //     // >

            //     // </CSSTransition>
            // );
        } else {
            // watermark = (
            //     <CSSTransition
            //         key="watermark"
            //         classNames="watermark"
            //         timeout={{enter: 600, exit: 300}}
            //     >
            //         <View className="watermark"></View>
            //     </CSSTransition>
            // );
        }

        let {height, width} = Dimensions.get('window');
        let videoStyle = {
            height,
            width
        };

        console.log('local media stream in videobox', this.state);

        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcons = this.state.videoMuted ? 'video-off' : 'video';


        return (
            <View style={styles.container}>
                {/*onMouseMove={this.showCallOverlay}*/}
                <CallOverlay
                    show = {this.state.callOverlayVisible}
                    remoteIdentity = {this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri}
                    call = {this.props.call}
                />
                {/* <TransitionGroup> */}
                    {/* {watermark} */}
                {/* </TransitionGroup> */}
                {this.state.remoteVideoShow ?
                    <View style={[styles.container, styles.remoteVideoContainer]}>
                        <RTCView id="remoteVideo" style={[styles.video, videoStyle]} poster="assets/images/transparent-1px.png" ref={this.remoteVideo} streamURL={this.state.remoteStream ? this.state.remoteStream.toURL() : null} />
                    </View>
                : null }
                { this.state.localVideoShow ?
                    <View style={[styles.container, styles.localVideoContainer]}>
                        <RTCView style={[styles.video, styles.localVideo]} id="localVideo" ref={this.localVideo} streamURL={this.state.localStream ? this.state.localStream.toURL() : null} mirror={true} />
                    </View>
                : null }
                <View style={styles.buttonContainer}>
                    <IconButton style={styles.button} key="escalateButton" onPress={this.toggleEscalateConferenceModal} icon="account-plus" />
                    <IconButton style={styles.button} key="muteVideo" onPress={this.muteAudio} icon={muteButtonIcons} />
                    <IconButton style={styles.button} key="muteAudio" onPress={this.muteVideo} icon={muteVideoButtonIcons} />
                    <IconButton style={[styles.button, styles.hangupButton]} key="hangupButton" onPress={this.hangupCall} icon="phone-hangup" />
                </View>
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.props.call}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
            </View>
        );
    }
}

VideoBox.propTypes = {
    call                    : PropTypes.object,
    localMedia              : PropTypes.object,
    hangupCall              : PropTypes.func,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool
};

export default VideoBox;
