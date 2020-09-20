'use strict';

import React, {Component, Fragment} from 'react';
import { View, Platform, TouchableWithoutFeedback, Dimensions, SafeAreaView, ScrollView, FlatList } from 'react-native';
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
import ConferenceDrawerSpeakerSelectionWrapper from './ConferenceDrawerSpeakerSelectionWrapper';
import ConferenceHeader from './ConferenceHeader';
import ConferenceCarousel from './ConferenceCarousel';
import ConferenceParticipant from './ConferenceParticipant';
import ConferenceMatrixParticipant from './ConferenceMatrixParticipant';
import ConferenceParticipantSelf from './ConferenceParticipantSelf';
import InviteParticipantsModal from './InviteParticipantsModal';
import ConferenceAudioParticipantList from './ConferenceAudioParticipantList';
import ConferenceAudioParticipant from './ConferenceAudioParticipant';

import styles from '../assets/styles/blink/_ConferenceBox.scss';

const DEBUG = debug('blinkrtc:ConferenceBox');
debug.enable('*');


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

class ConferenceBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            callOverlayVisible: true,
            ended: false,
            audioMuted: this.props.muted,
            videoMuted: !this.props.inFocus,
            videoMutedbyUser: false,
            participants: props.call.participants.slice(),
            showInviteModal: false,
            showDrawer: false,
            showFiles: false,
            shareOverlayVisible: false,
            showSpeakerSelection: false,
            activeSpeakers: props.call.activeParticipants.slice(),
            selfDisplayedLarge: false,
            eventLog: [],
            sharedFiles: props.call.sharedFiles.slice(),
            largeVideoStream: null,
            previousParticipants: this.props.previousParticipants,
            inFocus:  this.props.inFocus,
            reconnectingCall: this.props.reconnectingCall,
            terminated: this.props.terminated
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
        this.selectSpeaker = 1;
        this.foundContacts = new Map();
        if (this.props.call) {
            this.lookupContact(this.props.call.localIdentity._uri, this.props.call.localIdentity._displayName);
        }

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

        this.invitedParticipants = new Map();

        props.initialParticipants.forEach((uri) => {
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.lookupContact(uri);
        });

        this.participantsTimer = setInterval(() => {
             this.updateParticipantsStatus();
        }, 5000);

    }

    updateParticipantsStatus() {
        let participants_uris = [];

        this.state.participants.forEach((p) => {
            participants_uris.push(p.identity._uri);
        });

        const invitedParties = Array.from(this.invitedParticipants.keys());
        //console.log('Invited participants', invitedParties);
        //console.log('Current participants', participants_uris);

        let p;
        let interval;
        invitedParties.forEach((_uri) => {
            if (participants_uris.indexOf(_uri) > 0) {
                this.invitedParticipants.delete(_uri);
            }

            p = this.invitedParticipants.get(_uri);
            interval = Math.floor((Date.now() - p.timestamp) / 1000);
            //console.log(_uri, 'was invited', interval, 'seconds ago');

            if (interval >= 60) {
                this.invitedParticipants.delete(_uri);
                this.forceUpdate();
            }

            if (p.status.indexOf('Invited') > -1 && interval > 5) {
                p.status = '..';
            }

            if (p.status.indexOf('.') > -1) {
                if (interval > 45) {
                    p.status = 'No answer';
                } else {
                    p.status = p.status + '..';
                }
                this.forceUpdate();
            }
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

        if (this.state.participants.length > 1) {
            this.armOverlayTimer();
        }

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
                if (p.identity._uri.search('guest.') === -1 && p.identity._uri !== this.props.call.localIdentity._uri) {
                    // used for history item
                    this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], p.identity._uri);
                    this.lookupContact(p.identity._uri, p.identity._displayName);
                }
            });
            // this.changeResolution();
        }

        if (this.props.call.getLocalStreams()[0].getVideoTracks().length !== 0) {
            this.haveVideo = true;
        }

        if (this.state.videoMuted) {
            console.log('Started video muted');
            this._muteVideo();
        } else {
            console.log('Started video active');
        }
    }

    componentWillUnmount() {
        clearTimeout(this.overlayTimer);
        clearTimeout(this.participantsTimer);
        this.uploads.forEach((upload) => {
            this.props.notificationCenter().removeNotification(upload[1]);
            upload[0].abort();
        })
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.inFocus !== this.state.inFocus) {
            if (nextProps.inFocus) {
                if (!this.state.videoMutedbyUser) {
                    this._resumeVideo();
                }
            } else {
                this._muteVideo();
            }
            this.setState({inFocus: nextProps.inFocus});
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        this.setState({terminated: nextProps.terminated});
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    lookupContact(uri, displayName) {
        let photo;
        let username =  uri.split('@')[0];

        if (this.props.contacts) {
            let username = uri.split('@')[0];
            let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

            if (isPhoneNumber) {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', uri);
            }

            if (contact_obj) {
                displayName = contact_obj.displayName;
                photo = contact_obj.photo;
                if (isPhoneNumber) {
                    uri = username;
                }
            } else {
                if (isPhoneNumber) {
                    uri = username;
                    displayName = toTitleCase(username);
                }
            }
        }

        const c = {photo: photo, displayName: displayName || toTitleCase(username)};
        this.foundContacts.set(uri, c)
    }

    onParticipantJoined(p) {
        DEBUG(`Participant joined: ${p.identity}`);
        if (p.identity._uri.search('guest.') === -1 && p.identity._uri !== this.props.call.localIdentity._uri) {
            // used for history item
            this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], p.identity._uri);
        }

        this.lookupContact(p.identity._uri, p.identity._displayName);
        if (this.invitedParticipants.has(p.identity._uri)) {
            this.invitedParticipants.delete(p.identity._uri);
        }
        // this.refs.audioPlayerParticipantJoined.play();
        p.on('stateChanged', this.onParticipantStateChanged);
        p.attach();
        this.setState({
            participants: this.state.participants.concat([p])
        });
        // this.changeResolution();
        if (this.state.participants.length > 1) {
            this.armOverlayTimer();
        } else {
            this.setState({callOverlayVisible: true});
        }
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
        if (this.state.participants.length > 1) {
            this.armOverlayTimer();
        } else {
            this.setState({callOverlayVisible: true});
        }
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

    toggleSpeakerSelection() {
        this.setState({showSpeakerSelection: !this.state.showSpeakerSelection});
    }

    startSpeakerSelection(number) {
        this.selectSpeaker = number;
        this.toggleSpeakerSelection();
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
        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
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
        if (this.state.videoMuted) {
            this._resumeVideo();
            this.setState({videoMutedbyUser: false});
        } else {
            this.setState({videoMutedbyUser: true});
            this._muteVideo();
        }
    }

    _muteVideo() {
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if (!this.state.videoMuted) {
                DEBUG('Mute camera');
                track.enabled = false;
                this.setState({videoMuted: true});
            }
        }
    }

    _resumeVideo() {
        const localStream = this.props.call.getLocalStreams()[0];
        if (localStream && localStream.getVideoTracks().length > 0) {
            const track = localStream.getVideoTracks()[0];
            if (this.state.videoMuted) {
                DEBUG('Resume camera');
                track.enabled = true;
                this.setState({videoMuted: false});
            }
        }
    }

    hangup(event) {
        event.preventDefault();
        for (let participant of this.state.participants) {
            participant.detach();
        }
        this.props.hangup('user_hangup_conference');
    }

    armOverlayTimer() {
        if (this.props.audioOnly) {
            return;
        }

        clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(() => {
            this.setState({callOverlayVisible: false});
        }, 4000);
    }

    showOverlay() {
        if (this.props.audioOnly) {
            return;
        }
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
        this.setState({callOverlayVisible: true, showDrawer: !this.state.showDrawer, showFiles: false, showSpeakerSelection: false});
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
        this.props.call.inviteParticipants(uris);
        uris.forEach((uri) => {
            uri = uri.replace(/ /g, '');
            if (this.props.call.localIdentity._uri === uri) {
                return;
            }
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], uri);
            this.lookupContact(uri);
        });

        this.forceUpdate()
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
        if (!this.state.reconnectingCall) {
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
        }
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

        if (!this.state.reconnectingCall) {
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
        }

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

        const audioParticipants = [];
        let _contact;
        let _identity;
        let participants_uris = [];

        if (this.props.audioOnly) {
            _contact = this.foundContacts.get(this.props.call.localIdentity._uri);
            _identity = {uri: this.props.call.localIdentity._uri,
                         displayName: _contact.displayName,
                         photo: _contact.photo
                        };

            participants_uris.push(this.props.call.localIdentity._uri);

            audioParticipants.push(
                <ConferenceAudioParticipant
                    key="myself"
                    participant={null}
                    identity={_identity}
                    isLocal={true}
                />
            );

            this.state.participants.forEach((p) => {
                _contact = this.foundContacts.get(p.identity._uri);
                _identity = {uri: p.identity._uri.indexOf('@guest') > -1 ? 'From the web': p.identity._uri,
                             displayName: (_contact && _contact.displayName != p.identity._displayName) ? _contact.displayName : p.identity._displayName,
                             photo: _contact ? _contact.photo: null
                            };

                participants_uris.push(p.identity._uri);

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={p.id}
                        participant={p}
                        identity={_identity}
                        isLocal={false}
                    />
                );
            });

            const invitedParties = Array.from(this.invitedParticipants.keys());
            let p;
            invitedParties.forEach((_uri) => {
                if (participants_uris.indexOf(_uri) > 0) {
                    return;
                }

                p = this.invitedParticipants.get(_uri);
                _contact = this.foundContacts.get(_uri);
                _identity = {uri: _uri,
                             displayName: (_contact && _contact.displayName ) ? _contact.displayName : _uri,
                             photo: _contact ? _contact.photo: null
                            };

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={_uri}
                        identity={_identity}
                        isLocal={false}
                        status={p.status}
                    />
                );
            });

            const alreadyInvitedParticipants = this.invitedParticipants ? Array.from(this.invitedParticipants.keys()) : [];

            return (
                <View style={styles.container}>
                    <View style={styles.conferenceContainer}>
                        <ConferenceHeader
                            show={true}
                            remoteUri={remoteUri}
                            participants={this.state.participants}
                            reconnectingCall={this.state.reconnectingCall}
                            buttons={buttons}
                            audioOnly={this.props.audioOnly}
                        />
                    </View>

                    <View style={styles.audioContainer}>
                        <ConferenceAudioParticipantList >
                            {audioParticipants}
                        </ConferenceAudioParticipantList>
                    </View>

                    <InviteParticipantsModal
                        show={this.state.showInviteModal && !this.state.reconnectingCall}
                        inviteParticipants={this.inviteParticipants}
                        previousParticipants={this.state.previousParticipants}
                        alreadyInvitedParticipants={alreadyInvitedParticipants}
                        currentParticipants={this.state.participants.map((p) => {return p.identity.uri})}
                        close={this.toggleInviteModal}
                        room={this.props.remoteUri.split('@')[0]}
                        defaultDomain = {this.props.defaultDomain}
                        accountId = {this.props.call.localIdentity._uri}
                        notificationCenter = {this.props.notificationCenter}
                    />
                <ConferenceDrawer
                    show={this.state.showDrawer && !this.state.reconnectingCall}
                    close={this.toggleDrawer}
                    isLandscape={this.props.isLandscape}
                    title="Conference data"
                >
                    <View style={this.props.isLandscape ? [{maxHeight: Dimensions.get('window').height - 60}, styles.landscapeDrawer] : styles.container}>
                        <View style={{flex: this.props.isLandscape ? 1 : 2}}>
                            <ConferenceDrawerSpeakerSelectionWrapper
                                selectSpeaker={this.startSpeakerSelection}
                                activeSpeakers={this.state.activeSpeakers}
                            />
                            <ConferenceDrawerParticipantList style={styles.container}>
                                {drawerParticipants}
                            </ConferenceDrawerParticipantList>
                        </View>
                    </View>
                </ConferenceDrawer>
                <ConferenceDrawer
                    show={this.state.showSpeakerSelection}
                    close={this.toggleSpeakerSelection}
                    isLandscape={this.props.isLandscape}
                    showBackdrop={false}
                    title={`Select speaker ${this.selectSpeaker}`}
                >
                    <ConferenceDrawerSpeakerSelection
                        participants={this.state.participants.concat([{id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity}])}
                        selected={this.handleActiveSpeakerSelected}
                        activeSpeakers={this.state.activeSpeakers}
                        selectSpeaker={this.selectSpeaker}
                        key = {this.state.activeSpeakers}
                    />
                </ConferenceDrawer>

                </View>
            );
        }

        const participants = [];
        const drawerParticipants = [];

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
                <RTCView key="self" objectFit="cover" style={styles.wholePageVideo} ref="largeVideo" poster="assets/images/transparent-1px.png" streamURL={this.state.largeVideoStream ? this.state.largeVideoStream.toURL() : null} />
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
                            pauseVideo={this.props.audioOnly}
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

        const currentParticipants = this.state.participants.map((p) => {return p.identity.uri})
        const alreadyInvitedParticipants = this.invitedParticipants ? Array.from(this.invitedParticipants.keys()) : [];

        return (
            <View style={styles.container}>
                <View style={styles.conferenceContainer}>
                    <ConferenceHeader
                        show={this.state.callOverlayVisible}
                        remoteUri={remoteUri}
                        participants={this.state.participants}
                        reconnectingCall={this.state.reconnectingCall}
                        buttons={buttons}
                        audioOnly={this.props.audioOnly}
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
                    show={this.state.showInviteModal && !this.state.reconnectingCall}
                    inviteParticipants={this.inviteParticipants}
                    previousParticipants={this.state.previousParticipants}
                    currentParticipants={currentParticipants}
                    alreadyInvitedParticipants={alreadyInvitedParticipants}
                    close={this.toggleInviteModal}
                    room={this.props.remoteUri.split('@')[0]}
                    defaultDomain = {this.props.defaultDomain}
                    notificationCenter = {this.props.notificationCenter}
                />
                <ConferenceDrawer
                    show={this.state.showDrawer && !this.state.reconnectingCall}
                    close={this.toggleDrawer}
                    isLandscape={this.props.isLandscape}
                    title="Conference data"
                >
                    <View style={this.props.isLandscape ? [{maxHeight: Dimensions.get('window').height - 60}, styles.landscapeDrawer] : styles.container}>
                        <View style={{flex: this.props.isLandscape ? 1 : 2}}>
                            <ConferenceDrawerSpeakerSelectionWrapper
                                selectSpeaker={this.startSpeakerSelection}
                                activeSpeakers={this.state.activeSpeakers}
                            />
                            <ConferenceDrawerParticipantList style={styles.container}>
                                {drawerParticipants}
                            </ConferenceDrawerParticipantList>
                        </View>
                    </View>
                </ConferenceDrawer>
                <ConferenceDrawer
                    show={this.state.showSpeakerSelection}
                    close={this.toggleSpeakerSelection}
                    isLandscape={this.props.isLandscape}
                    showBackdrop={false}
                    title={`Select speaker ${this.selectSpeaker}`}
                >
                    <ConferenceDrawerSpeakerSelection
                        participants={this.state.participants.concat([{id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity}])}
                        selected={this.handleActiveSpeakerSelected}
                        activeSpeakers={this.state.activeSpeakers}
                        selectSpeaker={this.selectSpeaker}
                        key = {this.state.activeSpeakers}
                    />
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
    previousParticipants: PropTypes.array,
    remoteUri           : PropTypes.string,
    generatedVideoTrack : PropTypes.bool,
    toggleMute          : PropTypes.func,
    toggleSpeakerPhone  : PropTypes.func,
    speakerPhoneEnabled : PropTypes.bool,
    isLandscape         : PropTypes.bool,
    isTablet            : PropTypes.bool,
    muted               : PropTypes.bool,
    defaultDomain       : PropTypes.string,
    inFocus             : PropTypes.bool,
    reconnectingCall    : PropTypes.bool,
    audioOnly           : PropTypes.bool,
    contacts            : PropTypes.array,
    initialParticipants : PropTypes.array
};

export default ConferenceBox;
