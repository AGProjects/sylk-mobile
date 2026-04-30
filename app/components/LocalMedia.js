import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Text, Dimensions, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, Platform, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Button, Text as PaperText } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import CallOverlay from './CallOverlay';
import styles from '../assets/styles/LocalMediaStyles';


class LocalMedia extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.localVideo = React.createRef();

		const localMedia = this.props.localMedia;
        const mediaType = localMedia.getVideoTracks().length > 0 ? 'video' : 'audio';

        // Derive the initial camera facing from the actual track so
        // the picker label and the bar icon don't start out of phase
        // with the device's real camera.
        let initialFacing = 'front';
        let initialVideoMuted = false;
        if (mediaType === 'video') {
            const track = localMedia.getVideoTracks()[0];
            try {
                const settings = track.getSettings ? track.getSettings() : null;
                if (settings && settings.facingMode === 'environment') {
                    initialFacing = 'back';
                }
            } catch (e) {
                // getSettings unsupported — keep the 'front' default.
            }
            // Pick up an already-disabled track (e.g. the user came back
            // to the preview after muting) so the bar shows the X.
            if (track.enabled === false) {
                initialVideoMuted = true;
            }
        }

        this.state = {
            localMedia: localMedia,
            mediaType: mediaType,
            historyEntry: this.props.historyEntry,
            participants: this.props.participants,
            reconnectingCall: this.props.reconnectingCall,
            terminatedReason: this.props.terminatedReason,
            orientation: this.props.orientation,
            mirror: initialFacing === 'front',
		    availableAudioDevices: this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets,
			isLandscape: this.props.isLandscape,
			cameraFacing: initialFacing,
			videoMuted: initialVideoMuted,
			videoPickerVisible: false
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
                      // mirror is now driven by cameraFacing; ignore the
                      // legacy prop so we don't fight ourselves.
                      terminatedReason: nextProps.terminatedReason,
					  availableAudioDevices: nextProps.availableAudioDevices,
					  selectedAudioDevice: nextProps.selectedAudioDevice,
					  insets: nextProps.insets,
					  isLandscape: nextProps.isLandscape
                      });
    }

    toggleCamera() {
        const localMedia = this.state.localMedia;
        if (localMedia.getVideoTracks().length > 0) {
            const track = localMedia.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: this.state.cameraFacing === 'front' ? 'back' : 'front'
            });
        }
    }

    selectCamera(facing) {
        // If video is currently muted, picking a camera should also
        // unmute it — that's the only way out of the muted state from
        // the picker (the Unmute row is hidden when muted).
        if (this.state.videoMuted) {
            this.toggleVideoMute();
        }
        if (facing === this.state.cameraFacing) return;
        const localMedia = this.state.localMedia;
        if (localMedia && localMedia.getVideoTracks().length > 0) {
            const track = localMedia.getVideoTracks()[0];
            track._switchCamera();
            this.setState({
                mirror: !this.state.mirror,
                cameraFacing: facing
            });
        }
    }

    toggleVideoMute() {
        const localMedia = this.state.localMedia;
        if (localMedia && localMedia.getVideoTracks().length > 0) {
            const track = localMedia.getVideoTracks()[0];
            if (this.state.videoMuted) {
                track.enabled = true;
                this.setState({videoMuted: false});
            } else {
                track.enabled = false;
                this.setState({videoMuted: true});
            }
        }
    }

    renderVideoPicker(buttonSize, buttonClass) {
        const facing = this.state.cameraFacing || 'front';
        const muted = this.state.videoMuted;
        // Bar icon reflects the active camera. Muted state shows a
        // big red X overlay so the user knows both *which* camera is
        // active *and* that it's muted.
        const mainIcon = facing === 'front' ? 'camera-front' : 'camera-rear';

        // Camera options. When not muted, drop the active camera so the
        // user only sees what they can switch *to*. When muted, show
        // both — tapping either unmutes (and switches if needed) via
        // selectCamera.
        const cameraOptions = [
            {
                key: 'front',
                icon: 'camera-front',
                label: 'Front Camera',
                facing: 'front'
            },
            {
                key: 'back',
                icon: 'camera-rear',
                label: 'Back Camera',
                facing: 'back'
            }
        ]
            .filter(opt => muted || opt.facing !== facing)
            .map(opt => ({
                key: opt.key,
                icon: opt.icon,
                label: opt.label,
                onPress: () => this.selectCamera(opt.facing)
            }));

        // Pre-call picker: just camera options + mute. Hide Myself,
        // Swap Video and Aspect Ratio only make sense once there is a
        // remote video / a PIP thumbnail.
        const items = [
            ...cameraOptions,
            ...(muted ? [] : [{
                key: 'mute',
                icon: 'video-off',
                label: 'Mute Camera',
                onPress: () => this.toggleVideoMute()
            }])
        ];

        // Same sizing as the in-call picker so the two screens look
        // consistent.
        const rowIconSize = buttonSize + 14;
        const rowFontSize = 18;
        const itemRowHeight = rowIconSize + 18;
        const iconColumnPadLeft = Math.max(10 - (rowIconSize - buttonSize) / 2, 0);
        const longestLabelChars = 13;
        const panelWidth = iconColumnPadLeft
            + rowIconSize
            + 14
            + Math.ceil(longestLabelChars * rowFontSize * 0.6)
            + 12;

        return (
            <View style={{position: 'relative', marginHorizontal: 8, justifyContent: 'center', alignItems: 'center'}}>
                {this.state.videoPickerVisible && (
                    <View style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        width: panelWidth,
                        marginBottom: 8,
                        zIndex: 100,
                        elevation: 10,
                        backgroundColor: 'rgba(34,34,34,0.92)',
                        borderRadius: 8,
                        paddingVertical: 4
                    }}>
                        {items.map(item => (
                            <TouchableOpacity
                                key={item.key}
                                onPress={() => {
                                    this.setState({videoPickerVisible: false});
                                    setTimeout(() => item.onPress(), 50);
                                }}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    height: itemRowHeight,
                                    paddingLeft: iconColumnPadLeft,
                                    paddingRight: 12,
                                    backgroundColor: 'transparent'
                                }}
                            >
                                <Icon name={item.icon} size={rowIconSize} color="white" />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        color: 'white',
                                        marginLeft: 14,
                                        fontSize: rowFontSize
                                    }}
                                >
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
                <View style={{position: 'relative'}}>
                    <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={buttonSize}
                            style={[buttonClass]}
                            icon={mainIcon}
                            onPress={() => this.setState({
                                videoPickerVisible: !this.state.videoPickerVisible
                            })}
                        />
                    </TouchableHighlight>
                    {muted && (
                        <View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}
                        >
                            <Icon
                                name="close-thick"
                                size={buttonSize + 14}
                                color="#D32F2F"
                            />
                        </View>
                    )}
                </View>
            </View>
        );
    }

    saveConference() {
        this.props.saveConference();
    }

    showSaveDialog() {
        if (!this.props.showSaveDialog) {
            return false;
        }

        return this.props.showSaveDialog();
    }

    hangupCall() {
        this.props.hangupCall('user_hangup_local_media');
    }

    render() {
        let displayName = this.props.remoteDisplayName;
        if (this.props.remoteUri.indexOf('@videoconference') > -1) {
			const room = this.props.remoteUri.split('@')[0];
			displayName = 'Room ' + room;
        }

        let {height, width} = Dimensions.get('window');
        let videoStyle = {height, width};

        const streamUrl = this.props.localMedia ? this.props.localMedia.toURL() : null;
        const buttonSize = this.props.isTablet ? 40 : 34;

        let buttonContainerClass = this.props.isTablet ? styles.tabletButtonContainer : styles.buttonContainer;
		const bottomInset = this.state.insets?.bottom || 0;

        const participants = this.state.participants ? this.state.participants.toString().replace(/,/g, ', '): '';

        // Match the in-call bar look so the white-button style is
        // consistent between the preview and the established call.
        const previewButtonClass = Platform.OS === 'ios'
            ? {paddingTop: 0, backgroundColor: 'rgba(249, 249, 249, 0.7)', margin: 10}
            : {paddingTop: 1, backgroundColor: 'rgba(249, 249, 249, 0.7)', margin: 10};

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
                    hangupCall = {this.hangupCall}
                    isLandscape = {this.state.isLandscape}
					availableAudioDevices = {this.state.availableAudioDevices}
					selectedAudioDevice = {this.state.selectedAudioDevice}
					selectAudioDevice = {this.props.selectAudioDevice}
					useInCallManger = {this.props.useInCallManger}
					insets = {this.state.insets}
                />

                {this.showSaveDialog() ?
                    <View style={styles.buttonContainer}>
						<PaperText style={styles.title}>Save conference maybe?</PaperText>
						<PaperText style={styles.subtitle}>Would you like to save participants {participants} for having another conference later?</PaperText>
						<PaperText style={styles.description}>You can find later it in your Favorites. </PaperText>

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
                <Fragment>
                    {/* Fullscreen invisible backdrop that dismisses the
                        floating video picker when the user taps anywhere
                        outside the panel. */}
                    {this.state.videoPickerVisible && (
                        <TouchableWithoutFeedback
                            onPress={() => this.setState({videoPickerVisible: false})}
                        >
                            <View style={StyleSheet.absoluteFillObject} />
                        </TouchableWithoutFeedback>
                    )}

                    <View style={[
                            buttonContainerClass,
                            { bottom: buttonContainerClass.bottom + bottomInset, flexDirection: 'row', zIndex: 2000, elevation: 30 },
                          ]}>

                        {this.state.mediaType == 'video'
                            ? this.renderVideoPicker(buttonSize, previewButtonClass)
                            : null}

                        <View style={{marginLeft: 30}}>
                            <TouchableHighlight style={styles.roundshape}>
                                <IconButton
                                    size={buttonSize}
                                    style={styles.hangupbutton}
                                    icon="phone-hangup"
                                    onPress={this.hangupCall}
                                />
                            </TouchableHighlight>
                        </View>
                    </View>
                </Fragment>
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
    localMedia          : PropTypes.object,
    mediaPlaying        : PropTypes.func,
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
    isLandscape         : PropTypes.bool,
    isTablet            : PropTypes.bool,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice   : PropTypes.func,
    useInCallManger     : PropTypes.bool,
	insets              : PropTypes.object
};


export default LocalMedia;
