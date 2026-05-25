import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Text, Dimensions, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, Platform, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Button, Text as PaperText } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import CallOverlay from './CallOverlay';
import styles from '../assets/styles/LocalMediaStyles';
import * as utils from '../utils';
import DarkModeManager from '../DarkModeManager';


class LocalMedia extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.localVideo = React.createRef();

		const localMedia = this.props.localMedia;
        // mediaType reflects the USER'S intent (audio button vs
        // video button) rather than what tracks are physically on
        // the local stream. The conference now always negotiates a
        // video track regardless of which start button the user
        // pressed (see callKeepStartConference in app.js — camera
        // permission requested unconditionally so a later in-call
        // flip is one track.enabled away). So
        // localMedia.getVideoTracks().length > 0 is now ALWAYS
        // true for conferences and stops being a useful signal.
        // props.media is 'audio' / 'video' from Conference.js (see
        // ~line 410, computed off proposedMedia.video) and carries
        // the intent. An Audio button start should NOT show the
        // big local-preview RTCView underneath while we wait for
        // the conference to establish — that surface is just the
        // user staring at their own camera which they explicitly
        // didn't ask to share.
        const mediaType = this.props.media === 'video' ? 'video' : 'audio';

        // Derive the initial camera facing from the actual track so
        // the picker label and the bar icon don't start out of phase
        // with the device's real camera.
        let initialFacing = 'front';
        let initialVideoMuted = false;
        if (mediaType === 'video') {
            const track = localMedia.getVideoTracks()[0];
            try {
                const settings = (track && track.getSettings) ? track.getSettings() : null;
                if (settings && settings.facingMode === 'environment') {
                    initialFacing = 'back';
                }
            } catch (e) {
                // getSettings unsupported — keep the 'front' default.
            }
            // Pick up an already-disabled track (e.g. the user came back
            // to the preview after muting) so the bar shows the X.
            if (track && track.enabled === false) {
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
			videoPickerVisible: false,
			audioDevicePickerVisible: false,
			// 6-second auto-start countdown for outgoing video calls.
			// Mirrors the AudioCallBox shape (interval ticks, paused
			// while camera/device pickers are open, resumes from the
			// frozen value) but the absolute duration is shorter —
			// long enough for the user to tap "stop" or switch
			// cameras, short enough to avoid making the pre-call
			// screen feel like it's stuck waiting.
			autoStartCountdown: 0,
			// Initial total seconds of the countdown — drives the
			// progress-bar cell count (one cell per second). Stays 0
			// while no timer is in flight so the bar renders empty.
			autoStartTotal: 0
        };

        this._autoStartTimer = null;
        this._autoStartTickInterval = null;
    }

    componentDidMount() {
        this.props.mediaPlaying();
        // disableAutoStart suppresses the 6-second countdown that auto-
        // fires confirmStartCall(). Used by the mid-call upgrade flow
        // (Call.js routes here for the +video preview): the user is
        // already in a call and shouldn't see a count-down timer telling
        // them the camera is about to go on the wire — they should tap
        // Start explicitly, or back out.
        if (this.props.awaitingUserCallStart && this.props.confirmStartCall && !this.props.disableAutoStart) {
            this._startAutoStartTimer();
        }
    }

    componentDidUpdate(prevProps, prevState) {
        const enteredAwaiting = !prevProps.awaitingUserCallStart && this.props.awaitingUserCallStart;
        const leftAwaiting = prevProps.awaitingUserCallStart && !this.props.awaitingUserCallStart;
        if (enteredAwaiting && this.props.confirmStartCall && !this.props.disableAutoStart) {
            this._startAutoStartTimer();
        }
        if (leftAwaiting) {
            this._cancelAutoStartTimer();
        }

        // Pause the auto-start countdown while the user is interacting
        // with a picker (camera-change panel or audio device list). The
        // timer resumes from the remaining seconds the moment the picker
        // closes — without this, picking a camera would burn through 2-3
        // seconds of the countdown and the call could auto-fire before
        // the user finishes their selection.
        if (this.props.awaitingUserCallStart) {
            const wasOpen = prevState.videoPickerVisible || prevState.audioDevicePickerVisible;
            const isOpen = this.state.videoPickerVisible || this.state.audioDevicePickerVisible;
            if (!wasOpen && isOpen) {
                this._pauseAutoStartTimer();
            } else if (wasOpen && !isOpen) {
                this._resumeAutoStartTimer();
            }
        }
    }

    componentWillUnmount() {
        this._cancelAutoStartTimer();
    }

    /** Auto-start countdown for outgoing video calls. Default 6 s,
     *  override via `seconds` so we can resume from a paused state.
     *  Slightly longer than the audio timer (4 s) since the user is
     *  more likely to want to fiddle with camera / mute first, but
     *  short enough that the pre-call screen doesn't feel stalled. */
    _startAutoStartTimer(seconds = 6) {
        this._cancelAutoStartTimer();
        const startSeconds = Math.max(1, seconds);
        // Track the INITIAL total seconds the countdown was armed with
        // so the progress-bar render below can draw exactly one cell
        // per second of the actual duration. Without this the cell
        // count was hardcoded and drifted out of sync whenever
        // `seconds` changed (e.g. the 9→6 default change).
        this.setState({
            autoStartCountdown: startSeconds,
            autoStartTotal:     startSeconds,
            autoStartPaused:    false,
        });
        this._autoStartTickInterval = setInterval(() => {
            this.setState((s) => ({
                autoStartCountdown: Math.max(0, (s.autoStartCountdown || 0) - 1)
            }));
        }, 1000);
        this._autoStartTimer = setTimeout(() => {
            this._cancelAutoStartTimer();
            if (this.props.confirmStartCall && this.props.awaitingUserCallStart) {
                this.props.confirmStartCall();
            }
        }, startSeconds * 1000);
    }

    _cancelAutoStartTimer() {
        if (this._autoStartTimer) {
            clearTimeout(this._autoStartTimer);
            this._autoStartTimer = null;
        }
        if (this._autoStartTickInterval) {
            clearInterval(this._autoStartTickInterval);
            this._autoStartTickInterval = null;
        }
        if (this.state && this.state.autoStartCountdown !== 0) {
            this.setState({ autoStartCountdown: 0 });
        }
    }

    /** Stop the timer but keep `autoStartCountdown` in state so the
     *  resume can pick up from where we left off. Called when the user
     *  opens a picker (camera / audio device). Sets `autoStartPaused`
     *  so the progress bar can recolour to signal "frozen". */
    _pauseAutoStartTimer() {
        if (this._autoStartTimer) {
            clearTimeout(this._autoStartTimer);
            this._autoStartTimer = null;
        }
        if (this._autoStartTickInterval) {
            clearInterval(this._autoStartTickInterval);
            this._autoStartTickInterval = null;
        }
        // autoStartCountdown left in state so the bar / label freeze at
        // the current value while the picker is open.
        this.setState({ autoStartPaused: true });
    }

    /** Resume from the paused countdown value. No-op if 0 (already
     *  fired) or the user has navigated away from awaiting. */
    _resumeAutoStartTimer() {
        if (!this.props.awaitingUserCallStart) return;
        // Honour disableAutoStart here too — the mid-call upgrade flow
        // never wants the timer to start, including the path where the
        // user opened then closed a camera/audio picker.
        if (this.props.disableAutoStart) return;
        const remaining = (this.state && this.state.autoStartCountdown) || 0;
        if (remaining <= 0) {
            // Picker stayed open past the deadline — fire the call now.
            if (this.props.confirmStartCall) this.props.confirmStartCall();
            return;
        }
        this._startAutoStartTimer(remaining);
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
        // Stable `video` glyph on the call-bar button — see the
        // matching note in VideoBox.js. Picker rows below still
        // use camera-front / camera-rear icons so the per-option
        // distinction is preserved exactly where it matters.
        const mainIcon = 'video';

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
            ...(muted ? [{
                // Symmetric "Start video" entry while muted —
                // gives the user an explicit re-enable affordance
                // rather than relying on the implicit
                // "tap-any-camera-to-unmute" pattern. See the
                // matching change in VideoBox.js for context.
                key: 'unmute',
                icon: 'video',
                label: 'Start video',
                onPress: () => this.toggleVideoMute()
            }] : [{
                key: 'mute',
                icon: 'video-off',
                // Renamed "Mute Camera" → "Stop video" (consistent
                // with the other surfaces). Tap → toggleVideoMute
                // toggles the local track off.
                label: 'Stop video',
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
                                videoPickerVisible: !this.state.videoPickerVisible,
                                // Mutual exclusion: opening one picker
                                // collapses the other so they can't both
                                // float over the preview at once.
                                audioDevicePickerVisible: false,
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
                            {/* `close` is the regular-weight X
                                glyph; the previous `close-thick`
                                drew a heavier stroke that competed
                                with the underlying camera icon. */}
                            <Icon
                                name="close"
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
        // Cancel the auto-start countdown so it doesn't race the
        // hangup and fire confirmStartCall on a doomed call.
        this._cancelAutoStartTimer();
        this.props.hangupCall('user_hangup_local_media');
    }

    /**
     * WhatsApp-style floating audio-device picker. Renders the currently
     * selected output as a single button; tapping it reveals the other
     * available devices stacked above. Hidden when there's only one device
     * to choose from (so plain phones without a headset don't show a
     * pointless picker).
     */
    renderAudioDevicePicker(buttonSize, buttonStyle) {
        const devices = this.state.availableAudioDevices || [];
        if (devices.length <= 1) {
            return null;
        }
        const selected = this.state.selectedAudioDevice;
        const selectedIcon = utils.availableAudioDevicesIconsMap[selected] || 'phone-in-talk';
        const otherDevices = devices.filter(d => d !== selected);

        return (
            // No marginLeft — pickers should sit flush against the video
            // picker, matching the VideoBox in-call bar where the camera
            // and audio device buttons cluster together with the hangup
            // button on its own to the right (marginLeft: 30 lives on
            // the hangup wrapper).
            <View style={{position: 'relative'}}>
                {this.state.audioDevicePickerVisible && otherDevices.length > 0 && (
                    <View style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                        marginBottom: 4,
                        zIndex: 100,
                        elevation: 10,
                    }}>
                        {otherDevices.map(device => (
                            <TouchableHighlight key={device} style={[styles.roundshape, {marginBottom: 21}]}>
                                <IconButton
                                    size={buttonSize}
                                    style={buttonStyle}
                                    icon={utils.availableAudioDevicesIconsMap[device] || 'phone-in-talk'}
                                    onPress={() => {
                                        if (this.props.selectAudioDevice) {
                                            this.props.selectAudioDevice(device);
                                        }
                                        this.setState({audioDevicePickerVisible: false});
                                    }}
                                />
                            </TouchableHighlight>
                        ))}
                    </View>
                )}
                <TouchableHighlight style={styles.roundshape}>
                    <IconButton
                        size={buttonSize}
                        style={buttonStyle}
                        icon={selectedIcon}
                        onPress={() => this.setState({
                            audioDevicePickerVisible: !this.state.audioDevicePickerVisible,
                            // Mutual exclusion: opening this picker
                            // collapses the camera picker.
                            videoPickerVisible: false,
                        })}
                    />
                </TouchableHighlight>
            </View>
        );
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

                    {/* Same backdrop for the audio-device picker. */}
                    {this.state.audioDevicePickerVisible && (
                        <TouchableWithoutFeedback
                            onPress={() => this.setState({audioDevicePickerVisible: false})}
                        >
                            <View style={StyleSheet.absoluteFillObject} />
                        </TouchableWithoutFeedback>
                    )}

                    {this.props.awaitingUserCallStart && this.props.confirmStartCall ? (
                        // Outgoing-video pre-call layout: camera picker +
                        // speaker (audio device) picker on a centered row at
                        // the top, with the contained "Start video call"
                        // button below. Same anchor as the regular bar
                        // (buttonContainerClass), but vertical instead of a
                        // single horizontal row, and shifted up 50 px so the
                        // floating picker popups don't get clipped by the
                        // screen edge.
                        //
                        // A small X icon in the top-right corner aborts the
                        // call before it goes out — same effect as the red
                        // hangup IconButton in the non-awaiting layout, but
                        // visually unobtrusive so it doesn't compete with
                        // the primary Start action.
                        <Fragment>
                            {/* X close icon — hidden per user request.
                                The bottom-bar hangup IconButton already
                                provides the cancel action. Wrapped in
                                `false &&` so it can be re-enabled later
                                with a one-line change. */}
                            {false && (
                                <View style={{
                                    position: 'absolute',
                                    top: 56 + 20,
                                    left: 8,
                                    zIndex: 2100,
                                    elevation: 31,
                                }}>
                                    <TouchableHighlight style={[styles.roundshape, {borderRadius: 24}]}>
                                        <IconButton
                                            size={28}
                                            style={{backgroundColor: 'rgba(0,0,0,0.45)', margin: 0}}
                                            iconColor="#ffffff"
                                            color="#ffffff"
                                            icon="close"
                                            onPress={this.hangupCall}
                                        />
                                    </TouchableHighlight>
                                </View>
                            )}

                            {/* Start video call + sliding reverse-progress
                                bar — absolutely positioned ABOVE the device
                                picker bar. Auto-fires in 6 s if the user
                                doesn't tap X / hangup. The button label
                                shows the remaining seconds. Same layout as
                                AudioCallBox.

                                Folded (cover-display) override: bottom:310
                                puts the button above the screen on the
                                Razr cover display. Drop it to ~110 so it
                                sits just above the camera/audio-device
                                picker bar at the bottom of the cover
                                display, leaving room for the picker row
                                + safe-area below.

                                Non-folded: bottom:150 puts the Start
                                button right above the camera / audio-
                                device picker bar (which itself sits
                                near the bottom edge), so the action
                                clusters with the other controls rather
                                than floating high near the preview. */}
                            <View style={{
                                position: 'absolute',
                                // bottom:190 (non-folded) leaves a
                                // comfortable gap above the camera /
                                // audio-device picker bar.
                                bottom: this.props.isFolded ? 130 : 190,
                                left: 0,
                                right: 0,
                                alignItems: 'center',
                                zIndex: 2000,
                                elevation: 30,
                            }}>
                                <View>
                                    {/* "Start now" Button hidden per user request — only the countdown bar below remains, so the call auto-starts when the timer expires. */}
                                    {/* Countdown progress bar — hidden
                                        entirely when the auto-start
                                        timer is suppressed (the mid-call
                                        upgrade flow). Without this
                                        guard, the row of dim
                                        translucent cells still draws
                                        and can read as "a timer is
                                        present" even though the count
                                        is stuck at 0. */}
                                    {!this.props.disableAutoStart ? (
                                    <View style={{
                                        flexDirection: 'row',
                                        marginTop: 10,
                                        height: 6,
                                        alignSelf: 'stretch',
                                        justifyContent: 'space-between',
                                    }}>
                                        {/* One cell per second of the
                                            armed countdown total. Driven
                                            by state.autoStartTotal so the
                                            bar always has the exact same
                                            cell count as the seconds the
                                            timer was started with — the
                                            previous hardcoded 9 left an
                                            empty 3-cell tail when the
                                            default dropped from 9 s to
                                            6 s. */}
                                        {[...Array(this.state.autoStartTotal || 0)].map((_, i) => (
                                            <View
                                                key={'autostart-cell-' + i}
                                                style={{
                                                    flex: 1,
                                                    marginHorizontal: 1,
                                                    borderRadius: 2,
                                                    // Paused → white filled cells (frozen).
                                                    // Running → green filled cells (active
                                                    // countdown). Empty → dim translucent.
                                                    backgroundColor: i < (this.state.autoStartCountdown || 0)
                                                        ? (this.state.autoStartPaused
                                                            ? 'rgba(255,255,255,0.85)'
                                                            : 'rgba(0,200,90,0.9)')
                                                        : 'rgba(255,255,255,0.20)',
                                                }}
                                            />
                                        ))}
                                    </View>
                                    ) : null}
                                </View>
                            </View>

                            {/* Camera + audio device pickers and hangup
                                IconButton on the standard bottom bar,
                                same height as during the active call so
                                the controls don't visually jump after
                                tapping Start. */}
                            <View style={[
                                    buttonContainerClass,
                                    // Bottom value pulled from the
                                    // stylesheet (50 dp) without the
                                    // bottomInset addition — the
                                    // audio call's portrait bar
                                    // doesn't add bottomInset either,
                                    // so adding it here made
                                    // LocalMedia's bar sit visibly
                                    // higher on iOS (bottomInset ≈ 34
                                    // for the home indicator). Drop
                                    // the +bottomInset so both bars
                                    // pin at the same 50 dp from the
                                    // screen edge.
                                    { bottom: buttonContainerClass.bottom, flexDirection: 'row', zIndex: 2000, elevation: 30 },
                                  ]}>
                                {this.state.mediaType == 'video'
                                    ? this.renderVideoPicker(buttonSize, previewButtonClass)
                                    : null}
                                {this.renderAudioDevicePicker(buttonSize, previewButtonClass)}
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
                    ) : (
                        // Normal pre-call / in-progress bar: pickers + the
                        // red hangup IconButton, all on a single horizontal
                        // row. Bottom value matches the countdown branch
                        // above (and the active-call ConferenceBox audio
                        // bar) at `buttonContainerClass.bottom` flat —
                        // adding `+ bottomInset` here previously pushed
                        // this intermediate-screen bar visibly higher
                        // than the post-connect bar on iOS (the home-
                        // indicator inset is ~34 dp and the
                        // ConferenceBox audio bar doesn't add it), so
                        // the speaker / hangup icons appeared to jump
                        // downward the moment the call connected.
                        <View style={[
                                buttonContainerClass,
                                { bottom: buttonContainerClass.bottom, flexDirection: 'row', zIndex: 2000, elevation: 30 },
                              ]}>
                            {this.state.mediaType == 'video'
                                ? this.renderVideoPicker(buttonSize, previewButtonClass)
                                : null}
                            {this.renderAudioDevicePicker(buttonSize, previewButtonClass)}
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
                    )}
                </Fragment>
                }

                <View style={styles.container}>
                    {/* Local preview only renders when the user
                        chose Video at the start (mediaType derived
                        from props.media). For an Audio button
                        start, the camera track IS being acquired
                        for wire-level negotiation, but showing it
                        as a fullscreen preview here surprises the
                        user — they pressed Audio. Drop in a plain
                        dark backdrop instead; the bottom bar
                        still carries the audio-device picker +
                        hangup, which is the only useful chrome
                        on this transitional screen. */}
                    {this.state.mediaType === 'video' ? (
                        <RTCView objectFit="cover"
                                 style={[styles.video, videoStyle]}
                                 id="localVideo"
                                 ref={this.localVideo}
                                 streamURL={streamUrl}
                                 mirror={this.state.mirror}
                                 />
                    ) : (
                        // Audio-only pre-call backdrop. Used to be a
                        // flat near-black (#111) which made the
                        // "calling out" screen feel black on the new
                        // Day-mode light linen background. We pin
                        // a theme.background tone in light mode so
                        // the linen reads through naturally; Night
                        // keeps the existing dark surface.
                        <View style={[
                            styles.video,
                            videoStyle,
                            {
                                backgroundColor: DarkModeManager.getTheme().isDark
                                    ? '#111'
                                    : DarkModeManager.getTheme().background,
                            },
                        ]} />
                    )}
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
    // Suppress the 6-second auto-start countdown. Used by the mid-call
    // audio→video upgrade flow (Call.js routes here for the preview):
    // the user already initiated the call, so a count-down is wrong —
    // tap Start to opt in, or back out.
    disableAutoStart    : PropTypes.bool,
    terminatedReason    : PropTypes.string,
    isLandscape         : PropTypes.bool,
    isTablet            : PropTypes.bool,
    isFolded            : PropTypes.bool,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice   : PropTypes.func,
    useInCallManger     : PropTypes.bool,
	insets              : PropTypes.object,
    // Outgoing-video-call gate: when true, the SIP call has NOT been
    // placed yet and the user must tap the green Call button to commit.
    awaitingUserCallStart : PropTypes.bool,
    confirmStartCall      : PropTypes.func,
};


export default LocalMedia;
