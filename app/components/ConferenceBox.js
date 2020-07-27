'use strict';

import React, {Component, Fragment} from 'react';
import { View, Platform, TouchableWithoutFeedback } from 'react-native';
import PropTypes from 'prop-types';
import * as sylkrtc from 'react-native-sylkrtc';
import classNames from 'classnames';
import debug from 'react-native-debug';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Appbar, Portal, Modal, Surface, Paragraph } from 'react-native-paper';

import config from '../config';
import utils from '../utils';
//import AudioPlayer from './AudioPlayer';
import ConferenceDrawer from './ConferenceDrawer';
import ConferenceDrawerLog from './ConferenceDrawerLog';
// import ConferenceDrawerFiles from './ConferenceDrawerFiles';
import ConferenceDrawerParticipant from './ConferenceDrawerParticipant';
import ConferenceDrawerParticipantList from './ConferenceDrawerParticipantList';
import ConferenceDrawerSpeakerSelection from './ConferenceDrawerSpeakerSelection';
import ConferenceHeader from './ConferenceHeader';
import ConferenceCarousel from './ConferenceCarousel';
import ConferenceParticipant from './ConferenceParticipant';
import ConferenceMatrixParticipant from './ConferenceMatrixParticipant';
import ConferenceParticipantSelf from './ConferenceParticipantSelf';
import InviteParticipantsModal from './InviteParticipantsModal';

import styles from '../assets/styles/blink/_ConferenceBox.scss';

const DEBUG = debug('blinkrtc:ConferenceBox');
debug.enable('*');

class ConferenceBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            callOverlayVisible: true,
            audioMuted: false,
            videoMuted: false,
            participants: props.call.participants.slice(),
            showInviteModal: false,
            showDrawer: false,
            showFiles: false,
            shareOverlayVisible: false,
            activeSpeakers: props.call.activeParticipants.slice(),
            selfDisplayedLarge: false,
            eventLog: [],
            sharedFiles: props.call.sharedFiles.slice(),
            largeVideoStream: null
        };

        const friendlyName = this.props.remoteUri.split('@')[0];
        //if (window.location.origin.startsWith('file://')) {
            this.callUrl = `${config.publicUrl}/conference/${friendlyName}`;
        //} else {
        //    this.callUrl = `${window.location.origin}/conference/${friendlyName}`;
        //}

        const emailMessage  = `You can join me in the conference using a Web browser at ${this.callUrl} ` +
                             'or by using the freely available Sylk WebRTC client app at http://sylkserver.com';
        const subject       = 'Join me, maybe?';

        this.emailLink = `mailto:?subject=${encodeURI(subject)}&body=${encodeURI(emailMessage)}`;

        this.overlayTimer = null;
        this.logEvent = {};
        this.haveVideo = false;
        this.uploads = [];

        [
            'error',
            'warning',
            'info',
            'debug'
        ].forEach((level) => {
            this.logEvent[level] = (
                (action, messages, originator) => {
                    const log = this.state.eventLog.slice();
                    log.unshift({originator, originator, level: level, action: action, messages: messages});
                    this.setState({eventLog: log});
                }
            );
        });
    }

    componentDidMount() {
        for (let p of this.state.participants) {
            p.on('stateChanged', this.onParticipantStateChanged);
            p.attach();
        }
        this.props.call.on('participantJoined', this.onParticipantJoined);
        this.props.call.on('participantLeft', this.onParticipantLeft);
        this.props.call.on('roomConfigured', this.onConfigureRoom);
        this.props.call.on('fileSharing', this.onFileSharing);

        this.armOverlayTimer();

        // attach to ourselves first if there are no other participants
        if (this.state.participants.length === 0) {
            setTimeout(() => {
                const item = {
                    stream: this.props.call.getLocalStreams()[0],
                    identity: this.props.call.localIdentity
                };
                this.selectVideo(item);
            });
        } else {
            this.state.participants.forEach((p) => {
                if (p.identity._uri.search('guest.') === -1) {
                    // used for history item
                    this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], p.identity._uri);
                }
            });
            // this.changeResolution();
        }

        if (this.props.call.getLocalStreams()[0].getVideoTracks().length !== 0) {
            this.haveVideo = true;
        }
    }

    componentWillUnmount() {
        clearTimeout(this.overlayTimer);
        this.uploads.forEach((upload) => {
            this.props.notificationCenter().removeNotification(upload[1]);
            upload[0].abort();
        })
    }

    onParticipantJoined(p) {
        DEBUG(`Participant joined: ${p.identity}`);
        if (p.identity._uri.search('guest.') === -1) {
            // used for history item
            this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], p.identity._uri);
        }
        // this.refs.audioPlayerParticipantJoined.play();
        p.on('stateChanged', this.onParticipantStateChanged);
        p.attach();
        this.setState({
            participants: this.state.participants.concat([p])
        });
        // this.changeResolution();
    }

    onParticipantLeft(p) {
        DEBUG(`Participant left: ${p.identity}`);
        // this.refs.audioPlayerParticipantLeft.play();
        const participants = this.state.participants.slice();
        const idx = participants.indexOf(p);
        if (idx !== -1) {
            participants.splice(idx, 1);
            this.setState({
                participants: participants
            });
        }
        p.detach(true);
        // this.changeResolution();
    }

    onParticipantStateChanged(oldState, newState) {
        if (newState === 'established' || newState === null) {
            this.maybeSwitchLargeVideo();
        }
    }

    onConfigureRoom(config) {
        const newState = {};
        newState.activeSpeakers = config.activeParticipants;
        this.setState(newState);

        if (config.activeParticipants.length === 0) {
            this.logEvent.info('set speakers to', ['Nobody'], config.originator);
        } else {
            const speakers = config.activeParticipants.map((p) => {return p.identity.displayName || p.identity.uri});
            this.logEvent.info('set speakers to', speakers, config.originator);
        }
        this.maybeSwitchLargeVideo();
    }

    onFileSharing(files) {
        let stateFiles = this.state.sharedFiles;
        stateFiles = stateFiles.concat(files);
        this.setState({sharedFiles: stateFiles});
        files.forEach((file)=>{
            if (file.session !== this.props.call.id) {
                this.props.notificationCenter().postFileShared(file, this.showFiles);
            }
        })
    }

    onVideoSelected(item) {
        const participants = this.state.participants.slice();
        const idx = participants.indexOf(item);
        participants.splice(idx, 1);
        participants.unshift(item);
        if (item.videoPaused) {
            item.resumeVideo();
        }
        this.setState({
            participants: participants
        });
    }

    changeResolution() {
        let stream = this.props.call.getLocalStreams()[0];
        if (this.state.participants.length < 2) {
            this.props.call.scaleLocalTrack(stream, 1.5);
        } else if (this.state.participants.length < 5) {
            this.props.call.scaleLocalTrack(stream, 2);
        } else {
            this.props.call.scaleLocalTrack(stream, 1);
        }
    }

    selectVideo(item) {
        DEBUG('Switching video to: %o', item);
        if (item.stream) {
            this.setState({selfDisplayedLarge: true, largeVideoStream: item.stream});
        }
    }

    maybeSwitchLargeVideo() {
        // Switch the large video to another source, maybe.
        if (this.state.participants.length === 0 && !this.state.selfDisplayedLarge) {
            // none of the participants are eligible, show ourselves
            const item = {
                stream: this.props.call.getLocalStreams()[0],
                identity: this.props.call.localIdentity
            };
            this.selectVideo(item);
        } else if (this.state.selfDisplayedLarge) {
            this.setState({selfDisplayedLarge: false});
        }
    }

    handleClipboardButton() {
        utils.copyToClipboard(this.callUrl);
        this.props.notificationCenter().postSystemNotification('Join me, maybe?', {body: 'Link copied to the clipboard'});
        this.setState({shareOverlayVisible: false});
    }

    handleEmailButton(event) {
        // if (navigator.userAgent.indexOf('Chrome') > 0) {
        //     let emailWindow = window.open(this.emailLink, '_blank');
        //     setTimeout(() => {
        //         emailWindow.close();
        //     }, 500);
        // } else {
        //     window.open(this.emailLink, '_self');
        // }
        this.setState({shareOverlayVisible: false});
    }

    handleShareOverlayEntered() {
        this.setState({shareOverlayVisible: true});
    }

    handleShareOverlayExited() {
        this.setState({shareOverlayVisible: false});
    }

    handleActiveSpeakerSelected(participant, secondVideo=false) {      // eslint-disable-line space-infix-ops
        let newActiveSpeakers = this.state.activeSpeakers.slice();
        if (secondVideo) {
            if (participant.id !== 'none') {
                if (newActiveSpeakers.length >= 1) {
                    newActiveSpeakers[1] = participant;
                } else {
                    newActiveSpeakers[0] = participant;
                }
            } else {
                newActiveSpeakers.splice(1,1);
            }
        } else {
            if (participant.id !== 'none') {
                newActiveSpeakers[0] = participant;
            } else {
                newActiveSpeakers.shift();
            }
        }
        this.props.call.configureRoom(newActiveSpeakers.map((element) => element.publisherId), (error) => {
            if (error) {
                // This causes a state update, hence the drawer lists update
                this.logEvent.error('set speakers failed', [], this.localIdentity);
            }
        });
    }

    handleDrop(files) {
        DEBUG('Dropped file %o', files);
        this.uploadFiles(files);
    };

    handleFiles(e) {
        DEBUG('Selected files %o', e.target.files);
        this.uploadFiles(e.target.files);
        event.target.value = '';
    }

    uploadFiles(files) {
        for (var key in files) {
            // is the item a File?
            if (files.hasOwnProperty(key) && files[key] instanceof File) {
                let uploadRequest;
                let complete = false;
                const filename = files[key].name
                let progressNotification = this.props.notificationCenter().postFileUploadProgress(
                    filename,
                    (notification) => {
                        if (!complete) {
                            uploadRequest.abort();
                            this.uploads.splice(this.uploads.indexOf(uploadRequest), 1);
                        }
                    }
                );
                uploadRequest = superagent
                .post(`${config.fileSharingUrl}/${this.props.remoteUri}/${this.props.call.id}/${filename}`)
                .send(files[key])
                .on('progress', (e) => {
                    this.props.notificationCenter().editFileUploadNotification(e.percent, progressNotification);
                })
                .end((err, response) => {
                    complete = true;
                    this.props.notificationCenter().removeFileUploadNotification(progressNotification);
                    if (err) {
                        this.props.notificationCenter().postFileUploadFailed(filename);
                    }
                    this.uploads.splice(this.uploads.indexOf(uploadRequest), 1);
                });
                this.uploads.push([uploadRequest, progressNotification]);
            }
        }
    }

    downloadFile(filename) {
        // const a = document.createElement('a');
        // a.href = `${config.fileSharingUrl}/${this.props.remoteUri}/${this.props.call.id}/${filename}`;
        // a.target = '_blank';
        // a.download = filename;
        // const clickEvent = document.createEvent('MouseEvent');
        // clickEvent.initMouseEvent('click', true, true, window, 0,
        //     clickEvent.screenX, clickEvent.screenY, clickEvent.clientX, clickEvent.clientY,
        //     clickEvent.ctrlKey, clickEvent.altKey, clickEvent.shiftKey, clickEvent.metaKey,
        //     0, null);
        // a.dispatchEvent(clickEvent);
    }

    preventOverlay(event) {
        // Stop the overlay when we are the thumbnail bar
        event.stopPropagation();
    }

    muteAudio(event) {
        event.preventDefault();
        const localStream = this.props.call.getLocalStreams()[0];
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

    toggleCamera(event) {
        event.preventDefault();
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            track._switchCamera();
        }
    }

    muteVideo(event) {
        event.preventDefault();
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if (this.state.videoMuted) {
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

    hangup(event) {
        event.preventDefault();
        for (let participant of this.state.participants) {
            participant.detach();
        }
        this.props.hangup();
    }

    armOverlayTimer() {
        clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(() => {
            this.setState({callOverlayVisible: false});
        }, 4000);
    }

    showOverlay() {
        // if (!this.state.shareOverlayVisible && !this.state.showDrawer && !this.state.showFiles) {
        // if (!this.state.callOverlayVisible) {
                this.setState({callOverlayVisible: !this.state.callOverlayVisible});
        // }
        // this.armOverlayTimer();
        // }
    }

    toggleInviteModal() {
        this.setState({showInviteModal: !this.state.showInviteModal});
    }

    toggleDrawer() {
        this.setState({callOverlayVisible: true, showDrawer: !this.state.showDrawer, showFiles: false});
        clearTimeout(this.overlayTimer);
    }

    toggleFiles() {
        this.setState({callOverlayVisible: true, showFiles: !this.state.showFiles, showDrawer: false});
        clearTimeout(this.overlayTimer);
    }

    showFiles() {
        this.setState({callOverlayVisible: true, showFiles: true, showDrawer: false});
        clearTimeout(this.overlayTimer);
    }

    inviteParticipants(uris) {
        console.log('Invite participants', uris);
        this.props.saveInvitedParties(this.props.call.id, this.props.remoteUri.split('@')[0], uris);
        this.props.call.inviteParticipants(uris);
    }

    render() {
        if (this.props.call === null) {
            return (<View></View>);
        }

        let watermark;

        const largeVideoClasses = classNames({
            'animated'      : true,
            'fadeIn'        : true,
            'large'         : true,
            'mirror'        : !this.props.call.sharingScreen && !this.props.generatedVideoTrack,
            'fit'           : this.props.call.sharingScreen
        });

        let matrixClasses = classNames({
            'matrix'        : true
        });

        const containerClasses = classNames({
            'video-container': true,
            'conference': true,
            'drawer-visible': this.state.showDrawer || this.state.showFiles
        });

        const remoteUri = this.props.remoteUri.split('@')[0];

        // const shareOverlay = (
        //     <Portal>
        //         <Modal>
        //             <Surface>
        //                 <Paragraph>
        //                     Invite other online users of this service, share <strong><a href={this.callUrl} target="_blank" rel="noopener noreferrer">this link</a></strong> with others or email, so they can easily join this conference.
        //                 </Paragraph>
        //                 <View className="text-center">
        //                     <View className="btn-group">
        //                         <IconButton
        //                             size={30}
        //                             onPress={this.toggleInviteModal}
        //                             icon="account-plus"
        //                         />
        //                         <IconButton className="btn btn-primary" onPress={this.handleClipboardButton} icon="copy" />
        //                         <IconButton className="btn btn-primary" onPress={this.handleEmailButton} alt="Send email" icon="email" />
        //                     </View>
        //                 </View>
        //             </Surface>
        //         </Modal>
        //     </Portal>
        // );

        const buttons = {};

        // const commonButtonTopClasses = classNames({
        //     'btn'           : true,
        //     'btn-link'      : true
        // });

        // const fullScreenButtonIcons = classNames({
        //     'fa'            : true,
        //     'fa-2x'         : true,
        //     'fa-expand'     : !this.isFullScreen(),
        //     'fa-compress'   : this.isFullScreen()
        // });

        const topButtons = [];

        // if (!this.state.showFiles) {
        //     if (this.state.sharedFiles.length !== 0) {
        //         topButtons.push(
        //             <Badge badgeContent={this.state.sharedFiles.length} color="primary" classes={{badge: this.props.classes.badge}}>
        //                 <button key="fbButton" type="button" title="Open Drawer" className={commonButtonTopClasses} onPress={this.toggleFiles}> <i className="fa fa-files-o fa-2x"></i> </button>
        //             </Badge>
        //         );
        //     }
        // }

        if (!this.state.showDrawer) {
            topButtons.push(<Appbar.Action key="sbButton" title="Open Drawer" onPress={this.toggleDrawer} icon="menu" />);
        }

        buttons.top = {right: topButtons};

        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcons = this.state.videoMuted ? 'video-off' : 'video';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        const bottomButtons = [];
        bottomButtons.push(
            <IconButton
                size={30}
                style={buttonClass}
                title="Share link to this conference"
                icon="account-plus"
                onPress={this.toggleInviteModal}
                key="shareButton"
            />
        );
        if (this.haveVideo) {
            bottomButtons.push(
                <IconButton
                    size={30}
                    style={buttonClass}
                    title="Mute/unmute video"
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcons}
                    key="muteButton"
                />
            );
        }
        bottomButtons.push(
            <IconButton
                size={30}
                style={buttonClass}
                title="Mute/unmute audio"
                onPress={this.muteAudio}
                icon={muteButtonIcons}
                key="muteAudioButton"
            />
        );
        if (this.haveVideo) {
            bottomButtons.push(
                <IconButton
                    size={30}
                    style={buttonClass}
                    title="Toggle camera"
                    onPress={this.toggleCamera}
                    icon='video-switch'
                    key="toggleButton"
                />
            );
        }
        bottomButtons.push(
            <IconButton
                size={30}
                style={buttonClass}
                icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                onPress={this.props.toggleSpeakerPhone}
                key="speakerPhoneButton"
            />
        )
        // bottomButtons.push(
        //     <View key="shareFiles">
        //         <IconButton size={30} style={buttonClass} title="Share files" component="span" disableRipple={true} icon="upload"/>
        //     </View>
        // );

        bottomButtons.push(
            <IconButton
                size={30}
                style={[buttonClass, styles.hangupButton]}
                title="Leave conference"
                onPress={this.hangup}
                icon="phone-hangup"
                key="hangupButton"
            />
        );
        buttons.bottom = bottomButtons;

        const participants = [];

        if (this.state.participants.length > 0) {
            if (this.state.activeSpeakers.findIndex((element) => {return element.id === this.props.call.id}) === -1) {
                participants.push(
                    <ConferenceParticipantSelf
                        key="myself2"
                        stream={this.props.call.getLocalStreams()[0]}
                        identity={this.props.call.localIdentity}
                        audioMuted={this.state.audioMuted}
                        generatedVideoTrack={this.props.generatedVideoTrack}
                    />
                );
            }
        }

        const drawerParticipants = [];
        drawerParticipants.push(
            <ConferenceDrawerParticipant
                key="myself1"
                participant={{identity: this.props.call.localIdentity}}
                isLocal={true}
            />
        );

        let videos = [];
        if (this.state.participants.length === 0) {
            videos.push(
                <RTCView objectFit="cover" style={styles.wholePageVideo} ref="largeVideo" poster="assets/images/transparent-1px.png" streamURL={this.state.largeVideoStream ? this.state.largeVideoStream.toURL() : null} />
            );
        } else {
            const activeSpeakers = this.state.activeSpeakers;
            const activeSpeakersCount = activeSpeakers.length;

            if (activeSpeakersCount > 0) {
                activeSpeakers.forEach((p) => {
                    videos.push(
                        <ConferenceMatrixParticipant
                            key={p.id}
                            participant={p}
                            large={activeSpeakers.length <= 1}
                            isLocal={p.id === this.props.call.id}
                        />
                    );
                });

                this.state.participants.forEach((p) => {
                    if (this.state.activeSpeakers.indexOf(p) === -1) {
                        participants.push(
                            <ConferenceParticipant
                                key={p.id}
                                participant={p}
                                selected={() => {}}
                                pauseVideo={true}
                                display={false}
                            />
                        );
                    }

                    drawerParticipants.push(
                        <ConferenceDrawerParticipant
                            key={p.id}
                            participant={p}
                        />
                    );
                });
            } else {

                this.state.participants.forEach((p, idx) => {
                    videos.push(
                        <ConferenceMatrixParticipant
                            key = {p.id}
                            participant = {p}
                            large = {this.state.participants.length <= 1}
                            pauseVideo={(idx >= 4) || (idx >= 2 && this.props.isTablet === false)}
                            isLandscape={this.props.isLandscape}
                            isTablet={this.props.isTablet}
                            useTwoRows={this.state.participants.length > 2}
                        />
                    );
                    if (idx >= 4 || idx >= 2 && this.props.isTablet === false) {
                        participants.push(
                            <ConferenceParticipant
                                key={p.id}
                                participant={p}
                                selected={this.onVideoSelected}
                                pauseVideo={true}
                                display={true}
                            />
                        );
                    }
                    drawerParticipants.push(
                        <ConferenceDrawerParticipant
                            key={p.id}
                            participant={p}
                        />
                    );
                });
            }
        }

        // let filesDrawerContent = (
        //     <ConferenceDrawerFiles
        //         sharedFiles={this.state.sharedFiles}
        //         downloadFile={this.downloadFile}
        //     />
        // );

        return (
            <View style={styles.container}>
                <View style={styles.conferenceContainer}>
                    <ConferenceHeader
                        show={this.state.callOverlayVisible}
                        remoteUri={remoteUri}
                        participants={this.state.participants}
                        buttons={buttons}
                    />
                    <TouchableWithoutFeedback onPress={this.showOverlay}>
                        <View style={[styles.videosContainer, this.props.isLandscape ? styles.landscapeVideosContainer: null]}>
                            {videos}
                        </View>
                    </TouchableWithoutFeedback>
                    <View style={styles.carouselContainer}>
                        <ConferenceCarousel align={'right'}>
                            {participants}
                        </ConferenceCarousel>
                    </View>
                </View>

                <InviteParticipantsModal
                    show={this.state.showInviteModal}
                    inviteParticipants={this.inviteParticipants}
                    previousParticipants={this.props.previousParticipants}
                    close={this.toggleInviteModal}
                    room={this.props.remoteUri.split('@')[0]}
                />

                <ConferenceDrawer
                    show={this.state.showDrawer}
                    close={this.toggleDrawer}
                >
                    <ConferenceDrawerSpeakerSelection
                        participants={this.state.participants.concat([{id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity}])}
                        selected={this.handleActiveSpeakerSelected}
                        activeSpeakers={this.state.activeSpeakers}
                    />
                    <ConferenceDrawerParticipantList>
                        {drawerParticipants}
                    </ConferenceDrawerParticipantList>
                    <ConferenceDrawerLog log={this.state.eventLog} />
                </ConferenceDrawer>
            </View>
        );
    }
}

ConferenceBox.propTypes = {
    notificationCenter  : PropTypes.func.isRequired,
    call                : PropTypes.object,
    connection          : PropTypes.object,
    hangup              : PropTypes.func,
    saveParticipant     : PropTypes.func,
    saveInvitedParties  : PropTypes.func,
    previousParticipants: PropTypes.array,
    remoteUri           : PropTypes.string,
    generatedVideoTrack : PropTypes.bool,
    toggleSpeakerPhone  : PropTypes.func,
    speakerPhoneEnabled : PropTypes.bool,
    isLandscape         : PropTypes.bool,
    isTablet            : PropTypes.bool
};

export default ConferenceBox;
