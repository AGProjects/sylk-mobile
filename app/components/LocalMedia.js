import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Dimensions, TouchableHighlight } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Button, Text} from 'react-native-paper';

import CallOverlay from './CallOverlay';
import styles from '../assets/styles/LocalMediaStyles';


class LocalMedia extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.localVideo = React.createRef();

		const localMedia = this.props.localMedia;
        const mediaType = localMedia.getVideoTracks().length > 0 ? 'video' : 'audio';


        this.state = {
            localMedia: localMedia,
            mediaType: mediaType,
            historyEntry: this.props.historyEntry,
            participants: this.props.participants,
            reconnectingCall: this.props.reconnectingCall,
            terminatedReason: this.props.terminatedReason,
            orientation: this.props.orientation,
            mirror: true,
		    availableAudioDevices: this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice

        };
    }

    componentDidMount() {
        this.props.mediaPlaying();
    }

            
    //getDerivedStateFromProps(nextProps, state)
    UNSAFE_componentWillReceiveProps(nextProps) {
/*
        if (nextProps.localMedia && nextProps.localMedia !== this.state.localMedia) {
            this.props.mediaPlaying();
        }
*/
        this.setState({historyEntry: nextProps.historyEntry,
                      participants: nextProps.participants,
                      reconnectingCall: nextProps.reconnectingCall,
                      orientation: nextProps.orientation,
                      mirror: nextProps.mirror,
                      terminatedReason: nextProps.terminatedReason,
					  availableAudioDevices: nextProps.availableAudioDevices,
					  selectedAudioDevice: nextProps.selectedAudioDevice
                      });
    }

    toggleCamera(event) {
        event.preventDefault();
        const localMedia = this.state.localMedia;
        if (localMedia.getVideoTracks().length > 0) {
            const track = localMedia.getVideoTracks()[0];
            track._switchCamera();
            this.setState({mirror: !this.state.mirror});
        }
    }

    saveConference(event) {
        event.preventDefault();
        this.props.saveConference();
    }

    showSaveDialog() {
        if (!this.props.showSaveDialog) {
            return false;
        }

        return this.props.showSaveDialog();
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_hangup_conference_confirmed');
    }

    render() {
        let {height, width} = Dimensions.get('window');
        let videoStyle = {height, width};

        const streamUrl = this.props.localMedia ? this.props.localMedia.toURL() : null;
        const buttonSize = this.props.isTablet ? 40 : 34;
        const buttonContainerClass = this.props.isTablet ? styles.tabletButtonContainer : styles.buttonContainer;

        let displayName = this.props.remoteDisplayName;

        if (this.props.remoteUri.indexOf('@videoconference') > -1) {
			const room = this.props.remoteUri.split('@')[0];        
			displayName = 'Room ' + room;
        }

        const participants = this.state.participants ? this.state.participants.toString().replace(/,/g, ', '): '';

        return (
            <Fragment>
                <CallOverlay
                    show = {true}
                    remoteUri = {this.props.remoteUri}
                    remoteDisplayName = {displayName}
                    call = {this.props.call}
                    terminatedReason = {this.state.terminatedReason}
                    localMedia = {this.props.localMedia}
                    connection = {this.props.connection}
                    reconnectingCall = {this.state.reconnectingCall}
                    media = {this.props.media}
                    goBackFunc = {this.props.goBackFunc}
                    isLandscape = {this.state.orientation === 'landscape'}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.state.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
                />

                {this.showSaveDialog() ?
                    <View style={styles.buttonContainer}>
						<Text style={styles.title}>Save conference maybe?</Text>
						<Text style={styles.subtitle}>Would you like to save participants {participants} for having another conference later?</Text>
						<Text style={styles.description}>You can find later it in your Favorites. </Text>
	
						<View style={styles.buttonRow}>
	
						<Button
							mode="contained"
							style={styles.savebutton}
							onPress={this.saveConference}
							icon="content-save"
						>Save</Button>
	
						<Button
							mode="contained"
							style={styles.backbutton}
							onPress={this.hangupCall}
							icon=""
						> Back</Button>
						</View>
                    </View>
                :

                <View style={buttonContainerClass}>
			    { this.state.mediaType == 'video' ?
                        <TouchableHighlight style={styles.roundshape}>
						<IconButton
							size={buttonSize}
							style={styles.savebutton}
							title="Toggle camera"
							onPress={this.toggleCamera}
							icon='camera-switch'
							key="toggleVideo"
						/>
                        </TouchableHighlight>
                        : null}
                        

                        <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={buttonSize}
                            style={styles.hangupbutton}
                            icon="phone-hangup"
                            onPress={this.hangupCall}
                        />
                        </TouchableHighlight>
                </View>
                }

                <View style={styles.container}>
                    <RTCView objectFit="cover"
                             style={[styles.video, videoStyle]}
                             id="localVideo"
                             ref={this.localVideo}
                             streamURL={streamUrl}
                             mirror={this.state.mirror}
                             />
                </View>
            </Fragment>
        );
    }
}

LocalMedia.propTypes = {
    call                : PropTypes.object,
    remoteUri           : PropTypes.string,
    remoteDisplayName   : PropTypes.string,
    localMedia          : PropTypes.object.isRequired,
    mediaPlaying        : PropTypes.func.isRequired,
    hangupCall          : PropTypes.func,
    showSaveDialog      : PropTypes.func,
    saveConference      : PropTypes.func,
    reconnectingCall    : PropTypes.bool,
    connection          : PropTypes.object,
    participants        : PropTypes.array,
    media               : PropTypes.string,
    showLogs            : PropTypes.func,
    goBackFunc          : PropTypes.func,
    terminatedReason    : PropTypes.string,
    orientation         : PropTypes.string,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice: PropTypes.func,
    useInCallManger: PropTypes.bool

};


export default LocalMedia;
