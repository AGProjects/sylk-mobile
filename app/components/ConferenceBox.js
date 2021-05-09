'use strict';

import React, {useState, Component, Fragment} from 'react';
import { View, Platform, TouchableWithoutFeedback, Dimensions, SafeAreaView, ScrollView, FlatList } from 'react-native';
import PropTypes from 'prop-types';
import * as sylkrtc from 'react-native-sylkrtc';
import classNames from 'classnames';
import debug from 'react-native-debug';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Appbar, Portal, Modal, Surface, Paragraph } from 'react-native-paper';
import uuid from 'react-native-uuid';
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
import { GiftedChat } from 'react-native-gifted-chat'
import xss from 'xss';

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

        this.audioBytesReceived = new Map();
        this.audioBandwidth = new Map();

        this.bandwidthDownload = 0;
        this.bandwidthUpload = 0;

        this.videoBytesReceived = new Map();
        this.videoBandwidth = new Map();

        this.audioPacketLoss = new Map();
        this.videoPacketLoss = new Map();
        this.packetLoss = new Map();

        this.latency = new Map();

        this.mediaLost = new Map();

        this.sampleInterval = 5;

        this.seenMessages = new Map();

        let messages = [];
        props.messages.reverse().forEach((m) => {
            if (!this.seenMessages.has(m._id)) {
                messages.push(m);
                this.seenMessages.set(m.id, true);
            }
        });

        messages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);

        if (this.props.call) {
            let giftedChatMessage;
            this.props.call.messages.reverse().forEach((sylkMessage) => {
                giftedChatMessage = utils.sylkToRenderMessage(sylkMessage);
                messages.push(giftedChatMessage);
            });
        }

        this.state = {
            callOverlayVisible: true,
            call: this.props.call,
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
            terminated: this.props.terminated,
            messages: messages,
            chatView: false
        };

        const friendlyName = this.props.remoteUri.split('@')[0];
        //if (window.location.origin.startsWith('file://')) {
            this.conferenceUrl = `${config.publicUrl}/conference/${friendlyName}`;
        //} else {
        //    this.conferenceUrl = `${window.location.origin}/conference/${friendlyName}`;
        //}

        const emailMessage  = `You can join me in the conference using a Web browser at ${this.conferenceUrl} ` +
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
        }, this.sampleInterval * 1000);

    }

    getInfo() {
        let info;
        if (this.bandwidthDownload > 0 && this.bandwidthUpload > 0) {
            info = '⇣' + this.bandwidthDownload + ' ⇡' + this.bandwidthUpload;
        } else if (this.bandwidthDownload > 0) {
            info = '⇣' + this.bandwidthDownload ;
        } else if (this.bandwidthUpload > 0) {
            info = '⇡' + this.bandwidthUpload;
        }

        if (info) {
            return info + ' Mbit/s';
        }

        return info;
    }

    updateParticipantsStatus() {
        let participants_uris = [];

        this.state.participants.forEach((p) => {
            participants_uris.push(p.identity._uri);
        });

        this.getConnectionStats();

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
            if (!p) {
                return;
            }
            interval = Math.floor((Date.now() - p.timestamp) / 1000);

            if (interval >= 60) {
                this.invitedParticipants.delete(_uri);
                this.forceUpdate();
            }

            if (p.status.indexOf('Invited') > -1 && interval > 5) {
                p.status = 'Wait .';
            }

            if (p.status.indexOf('.') > -1) {
                if (interval > 45) {
                    p.status = 'No answer';
                    this.postChatSystemMessage(_uri + ' did not answer');
                } else {
                    p.status = p.status + '.';
                }
            }

        });

        this.forceUpdate();
    }

    postChatSystemMessage(text, timestamp=true) {
        if (timestamp) {
            var now = new Date();
            var hours = now.getHours();
            var mins = now.getMinutes();
            var secs = now.getSeconds();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            mins = mins < 10 ? '0' + mins : mins;
            secs = secs < 10 ? '0' + secs : secs;
            text = text + ' at ' + hours + ":" + mins + ':' + secs + ' ' + ampm;
        }

        const giftedChatMessage = {
              _id: uuid.v4(),
              createdAt: now,
              text: text,
              system: true,
            };
        this.setState({messages: GiftedChat.append(this.state.messages, [giftedChatMessage])});
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
        this.props.call.on('composingIndication', this.composingIndicationReceived);
        this.props.call.on('message', this.messageReceived);

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
            this._muteVideo();
        }

        //let msg = "Others can join the conference using a web browser at " + this.conferenceUrl;
        //this.postChatSystemMessage(msg, false);
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

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            this.setState({call: nextProps.call});
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

    composingIndicationReceived(data) {
        utils.timestampedLog('isComposing received');
    }

    messageReceived(sylkMessage) {
        if (sylkMessage.content.indexOf('has joined the room') > -1) {
            return;
        }

        if (sylkMessage.content.indexOf('has left the room after') > -1) {
            return;
        }

        const giftedChatMessage = utils.sylkToRenderMessage(sylkMessage);
        this.setState({messages: GiftedChat.append(this.state.messages, [giftedChatMessage])});
        this.props.saveMessage(this.props.remoteUri.split('@')[0], giftedChatMessage);
    }

    onSendMessage(messages) {
        if (!this.props.call) {
            return;
        }
        messages.forEach((message) => {
            this.props.call.sendMessage(message.text, 'text/plain')
            this.props.saveMessage(this.props.remoteUri.split('@')[0], message);

        });
        this.setState({messages: GiftedChat.append(this.state.messages, messages)});
    }

    lookupContact(uri, displayName) {
        let photo;
        let username =  uri.split('@')[0];

        if (this.props.myContacts.hasOwnProperty(uri) && this.props.myContacts[uri].name) {
            displayName = this.props.myContacts[uri].name;
        } else if (this.props.contacts) {
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

    getConnectionStats() {
         let audioPackets = 0;
         let videoPackets = 0;
         let delay = 0;

         let audioPacketsLost = 0;
         let videoPacketsLost = 0;

         let audioPacketLoss = 0;
         let videoPacketLoss = 0;

         let totalPackets = 0;
         let totalPacketsLost = 0;
         let totalPacketLoss = 0;

         let totalAudioBandwidth = 0;
         let totalVideoBandwidth = 0;
         let totalSpeed = 0;

         let bandwidthUpload = 0;

         let mediaType;

         if (this.state.participants.length === 0) {
             this.bandwidthDownload = 0;
             this.videoBandwidth.set('total', 0);
             this.audioBandwidth.set('total', 0);
         }

         let participants = this.state.participants.concat(this.props.call);

         participants.forEach((p) => {
             if (!p._pc) {
                 return;
             }

             let identity;
             if (p.identity) {
                 identity = p.identity.uri;
             } else {
                 identity = 'myself';
             }

             p._pc.getStats(null).then(stats => {
                 audioPackets = 0;
                 videoPackets = 0;

                 audioPacketsLost = 0;
                 videoPacketsLost = 0;

                 audioPacketLoss = 0;
                 videoPacketLoss = 0;

                 stats.forEach(report => {
                     if (report.type === "ssrc") {

                         report.values.forEach(object => { if (object.mediaType) {
                                 mediaType = object.mediaType;
                             }
                         });

                         report.values.forEach(object => {
                             if (object.bytesReceived && identity !== 'myself') {
                                 const bytesReceived = Math.floor(object.bytesReceived);
                                 if (mediaType === 'audio') {
                                     if (this.audioBytesReceived.has(p.id)) {
                                         const lastBytes = this.audioBytesReceived.get(p.id);
                                         const diff = bytesReceived - lastBytes;
                                         const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                         totalAudioBandwidth = totalAudioBandwidth + speed;
                                         totalSpeed = totalSpeed + speed;
                                         //console.log(identity, 'audio bandwidth', speed, 'kbit/s from', identity);
                                         this.audioBandwidth.set(p.id, speed);
                                     }
                                     this.audioBytesReceived.set(p.id, bytesReceived);
                                 } else if (mediaType === 'video') {
                                     if (this.videoBytesReceived.has(p.id)) {
                                         const lastBytes = this.videoBytesReceived.get(p.id);
                                         const diff = bytesReceived - lastBytes;
                                         const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                         totalVideoBandwidth = totalVideoBandwidth + speed;
                                         totalSpeed = totalSpeed + speed;
                                         //console.log(identity, 'video bandwidth', speed, 'kbit/s from', identity);
                                         this.videoBandwidth.set(p.id, speed);
                                     }
                                     this.videoBytesReceived.set(p.id, bytesReceived);
                                 }
                             } else if (object.bytesSent && identity === 'myself') {
                                 const bytesSent = Math.floor(object.bytesSent);
                                 if (mediaType === 'audio') {
                                     if (this.audioBytesReceived.has(p.id)) {
                                         const lastBytes = this.audioBytesReceived.get(p.id);
                                         const diff = bytesSent - lastBytes;
                                         const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                         bandwidthUpload = bandwidthUpload + speed;
                                         //console.log(identity, 'audio bandwidth', speed, 'kbit/s from', identity);
                                         this.audioBandwidth.set(p.id, speed);
                                     }
                                     this.audioBytesReceived.set(p.id, bytesSent);
                                 } else if (mediaType === 'video') {
                                     if (this.videoBytesReceived.has(p.id)) {
                                         const lastBytes = this.videoBytesReceived.get(p.id);
                                         const diff = bytesSent - lastBytes;
                                         const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                         bandwidthUpload = bandwidthUpload + speed;
                                         //console.log(identity, 'video bandwidth', speed, 'kbit/s from', identity);
                                         this.videoBandwidth.set(p.id, speed);
                                     }
                                     this.videoBytesReceived.set(p.id, bytesSent);
                                 }
                             } else if (object.totalAudioEnergy) {
                                 //console.log('Total audio energy', object.totalAudioEnergy, 'from', identity);
                             } else if (object.audioOutputLevel) {
                                 //console.log('Output level', object.audioOutputLevel, 'from', identity);
                                 this.mediaLost.set(p.id, Math.floor(object.audioOutputLevel) < 5 ? true : false);
                             } else if (object.audioInputLevel) {
                                 //console.log('Input level', object.audioInputLevel, 'from', identity);
                                 this.mediaLost.set(p.id, Math.floor(object.audioInputLevel) < 5 ? true : false);
                             } else if (object.packetsLost) {
                                 totalPackets = totalPackets + Math.floor(object.packetsLost);
                                 totalPacketsLost = totalPacketsLost + Math.floor(object.packetsLost);

                                 if (mediaType === 'audio') {
                                     audioPackets = audioPackets + Math.floor(object.packetsLost);
                                     audioPacketsLost =  audioPacketsLost + Math.floor(object.packetsLost);
                                 } else if (mediaType === 'video') {
                                     videoPackets = videoPackets + Math.floor(object.packetsLost);
                                     videoPacketsLost = videoPacketsLost + Math.floor(object.packetsLost);
                                 }
                                 if (object.packetsLost > 0) {
                                     //console.log(identity, mediaType, 'packetsLost', object.packetsLost);
                                 }
                             } else if (object.packetsReceived && identity !== 'myself') {
                                 totalPackets =  totalPackets + Math.floor(object.packetsReceived);

                                 if (mediaType === 'audio') {
                                     audioPackets = audioPackets + Math.floor(object.packetsReceived);
                                 } else if (mediaType === 'video') {
                                     videoPackets = videoPackets + Math.floor(object.packetsReceived);
                                 }
                                 //console.log(identity, mediaType, 'packetsReceived', object.packetsReceived);
                             } else if (object.packetsSent && identity === 'myself') {
                                 totalPackets =  totalPackets + Math.floor(object.packetsSent);

                                 if (mediaType === 'audio') {
                                     audioPackets = audioPackets + Math.floor(object.packetsSent);
                                 } else if (mediaType === 'video') {
                                     videoPackets = videoPackets + Math.floor(object.packetsSent);
                                 }
                                 //console.log(identity, mediaType, 'packetsSent', object.packetsSent);
                             } else if (object.googCurrentDelayMs && identity !== 'myself') {
                                 delay = object.googCurrentDelayMs;
                                 //console.log('mediaType', mediaType, 'identity', identity, 'delay', delay);
                                 this.latency.set(p.id, Math.ceil(delay));
                             //console.log(object);
                             }

                             if (identity === 'myself') {
                                 //console.log(object);
                             }
                     });

                     if (videoPackets > 0) {
                         videoPacketLoss = Math.floor(videoPacketsLost / videoPackets * 100);
                     } else {
                         videoPacketLoss = 100;
                     }

                     if (audioPackets > 0) {
                         audioPacketLoss = Math.floor(audioPacketsLost / audioPackets * 100);
                     } else {
                         audioPacketLoss = 100;
                     }

                     if (totalPackets > 0) {
                         totalPacketLoss = Math.floor(totalPacketsLost / totalPackets * 100);
                     } else {
                         totalPacketLoss = 100;
                     }

                     this.audioPacketLoss.set(p.id, audioPacketLoss);
                     this.videoPacketLoss.set(p.id, videoPacketLoss);
                     this.packetLoss.set(p.id, totalPacketLoss);
                 }});

                 //console.log(identity, p.id, 'audio loss', audioPacketLoss, '%, video loss', videoPacketLoss, '%, total loss', totalPacketLoss, '%');

                 const bandwidthDownload = totalVideoBandwidth + totalAudioBandwidth;
                 this.bandwidthDownload = Math.ceil(bandwidthDownload / 1000 * 100) / 100;

                 this.bandwidthUpload = Math.ceil(bandwidthUpload / 1000 * 100) / 100;

                 this.videoBandwidth.set('total', totalVideoBandwidth);
                 this.audioBandwidth.set('total', totalAudioBandwidth);

                 //console.log('audio bandwidth', totalAudioBandwidth);
                 //console.log('video bandwidth', totalVideoBandwidth);
                 //console.log('total bandwidth', this.bandwidthDownload);
                 //console.log('this.latency', this.latency);
             });
        });
     };

     onParticipantJoined(p) {
        console.log('----joined the conference');

        if (p.identity._uri.search('guest.') === -1) {
            if (p.identity._uri !== this.props.call.localIdentity._uri) {
                // used for history item
                this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], p.identity._uri);
            }
            const dn = p.identity._uri + ' joined';
            this.postChatSystemMessage(dn);
        } else {
            this.postChatSystemMessage('An anonymous guest joined');
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
        //console.log(p.identity.uri, 'left the conference');
        const participants = this.state.participants.slice();

        this.audioBandwidth.delete(p.id);
        this.videoBandwidth.delete(p.id);

        this.latency.delete(p.id);

        this.audioBytesReceived.delete(p.id);
        this.videoBytesReceived.delete(p.id);

        this.audioPacketLoss.delete(p.id);
        this.videoPacketLoss.delete(p.id);

        this.packetLoss.delete(p.id);
        this.mediaLost.delete(p.id);

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

        this.postChatSystemMessage(p.identity.uri + ' left');
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
        utils.copyToClipboard(this.conferenceUrl);
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
        if (this.state.audioMuted) {
            this.postChatSystemMessage('Audio un-muted');
        } else {
            this.postChatSystemMessage('Audio muted');
        }

        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
     }

    toggleChat(event) {
        event.preventDefault();
        this.setState({chatView: !this.state.chatView});
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
                console.log('Mute camera');
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
                console.log('Resume camera');
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

            this.postChatSystemMessage(uri + ' invited');
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.props.saveParticipant(this.props.call.id, this.props.remoteUri.split('@')[0], uri);
            this.lookupContact(uri);
        });

        this.forceUpdate()
    }

    render() {
        //console.log('Conference box this.state.reconnectingCall', this.state.reconnectingCall);
        let participantsCount = this.state.participants.length + 1;

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
        //                     Invite other online users of this service, share <strong><a href={this.conferenceUrl} target="_blank" rel="noopener noreferrer">this link</a></strong> with others or email, so they can easily join this conference.
        //                 </Paragraph>
        //                 <View className="text-center">
        //                     <View className="btn-group">
        //                         <IconButton
        //                             size={25}
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

        const floatingButtons = [];
        if (!this.state.reconnectingCall) {
            floatingButtons.push(
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Share link to this conference"
                    icon="account-plus"
                    onPress={this.toggleInviteModal}
                    key="shareButton"
                />
            );
        }
        if (this.haveVideo) {
            floatingButtons.push(
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Mute/unmute video"
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcons}
                    key="muteButton"
                />
            );
        }
        floatingButtons.push(
            <IconButton
                size={25}
                style={buttonClass}
                title="Mute/unmute audio"
                onPress={this.muteAudio}
                icon={muteButtonIcons}
                key="muteAudioButton"
            />
        );

        if (this.haveVideo) {
            floatingButtons.push(
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Toggle camera"
                    onPress={this.toggleCamera}
                    icon='video-switch'
                    key="toggleVideo"
                />
            );
            floatingButtons.push(
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Chat"
                    onPress={this.toggleChat}
                    icon='wechat'
                    key="toggleChat"
                />
            );
        }

        if (!this.state.reconnectingCall) {
            floatingButtons.push(
                <IconButton
                    size={25}
                    style={buttonClass}
                    icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                    onPress={this.props.toggleSpeakerPhone}
                    key="speakerPhoneButton"
                />
            )
            // floatingButtons.push(
            //     <View key="shareFiles">
            //         <IconButton size={25} style={buttonClass} title="Share files" component="span" disableRipple={true} icon="upload"/>
            //     </View>
            // );
        }

        floatingButtons.push(
            <IconButton
                size={25}
                style={[buttonClass, styles.hangupButton]}
                title="Leave conference"
                onPress={this.hangup}
                icon="phone-hangup"
                key="hangupButton"
            />
        );
        buttons.bottom = floatingButtons;

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
                    supportsVideo={this.state.call ? this.state.call.supportsVideo: false}
                />
            );

            this.state.participants.forEach((p) => {
                _contact = this.foundContacts.get(p.identity._uri);
                _identity = {uri: p.identity._uri.indexOf('@guest') > -1 ? 'From the web': p.identity._uri,
                             displayName: (_contact && _contact.displayName != p.identity._displayName) ? _contact.displayName : p.identity._displayName,
                             photo: _contact ? _contact.photo: null
                            };

                participants_uris.push(p.identity._uri);

                let status;
                if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
                    status = 'Muted';
                } else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
                    if (this.packetLoss.get(p.id) === 100) {
                        status = 'No media';
                        participantsCount = participantsCount - 1;
                    } else {
                        status = this.packetLoss.get(p.id) + '% loss';
                    }
                } else if (this.latency.has(p.id) && this.latency.get(p.id) > 150) {
                    status = this.latency.get(p.id) + ' ms delay';
                }

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={p.id}
                        participant={p}
                        identity={_identity}
                        isLocal={false}
                        status={status}
                        supportsVideo={this.state.call ? this.state.call.supportsVideo: false}
                    />
                );
            });

            const invitedParties = Array.from(this.invitedParticipants.keys());
            let alreadyInvitedParticipants = []
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

                if (p.status != 'No answer') {
                    alreadyInvitedParticipants.push(_uri)
                }

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={_uri}
                        identity={_identity}
                        isLocal={false}
                        status={p.status}
                        supportsVideo={this.state.call ? this.state.call.supportsVideo: false}
                    />
                );
            });


            const conferenceContainer = this.props.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
            const audioContainer = this.props.isLandscape ? styles.audioContainerLandscape : styles.audioContainer;
            const chatContainer = this.props.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;

            return (
                <View style={styles.container} >
                    <View style={conferenceContainer}>
                        <ConferenceHeader
                            show={true}
                            call={this.state.call}
                            isTablet={this.props.isTablet}
                            remoteUri={remoteUri}
                            participants={participantsCount}
                            reconnectingCall={this.state.reconnectingCall}
                            buttons={buttons}
                            audioOnly={this.props.audioOnly}
                            terminated={this.state.terminated}
                            info={this.getInfo()}
                            goBackFunc={this.props.goBackFunc}
                        />

                        <View style={audioContainer}>
                            <ConferenceAudioParticipantList >
                                {audioParticipants}
                            </ConferenceAudioParticipantList>
                        </View>

                         <View style={chatContainer}>
                            <GiftedChat
                              messages={this.state.messages}
                              onSend={this.onSendMessage}
                              alwaysShowSend={true}
                              scrollToBottom
                              inverted={true}
                              timeTextStyle={{ left: { color: 'red' }, right: { color: 'yellow' } }}
                              infiniteScroll
                            />
                          </View>

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
                        lookupContacts = {this.props.lookupContacts}
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
        let status = '';

        if (this.state.participants.length === 0) {
            videos.push(
                <RTCView key="self" objectFit="cover" style={styles.wholePageVideo} ref="largeVideo" poster="assets/images/transparent-1px.png" streamURL={this.state.largeVideoStream ? this.state.largeVideoStream.toURL() : null} />
            );
        } else {
            const activeSpeakers = this.state.activeSpeakers;
            const activeSpeakersCount = activeSpeakers.length;

            if (activeSpeakersCount > 0) {
                activeSpeakers.forEach((p) => {
                    status = '';
                    if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
                        status = 'Muted';
                    } else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
                        if (this.packetLoss.get(p.id) === 100) {
                            status = 'No media';
                            return;
                        } else {
                            status = this.packetLoss.get(p.id) + '% loss';
                        }

                    } else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
                        status = this.latency.get(p.id) + ' ms delay';
                    }

                    if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
                        status = 'Muted';
                    } else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
                        if (this.packetLoss.get(p.id) === 100) {
                            status = 'No media';
                            return;
                        } else {
                            status = this.packetLoss.get(p.id) + '% loss';
                        }
                    }

                    videos.push(
                        <ConferenceMatrixParticipant
                            key={p.id}
                            participant={p}
                            large={activeSpeakers.length <= 1}
                            isLocal={p.id === this.props.call.id}
                            status={status}
                        />
                    );
                });

                this.state.participants.forEach((p) => {
                    status = '';
                    if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
                        status = 'Muted';
                    } else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
                        if (this.packetLoss.get(p.id) === 100) {
                            status = 'No media';
                            participantsCount = participantsCount - 1;
                            return;
                        } else {
                            status = this.packetLoss.get(p.id) + '% loss';
                        }
                    } else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
                        status = this.latency.get(p.id) + ' ms delay';
                    }

                    if (this.state.activeSpeakers.indexOf(p) === -1) {
                        participants.push(
                            <ConferenceParticipant
                                key={p.id}
                                participant={p}
                                selected={() => {}}
                                pauseVideo={true}
                                display={false}
                                status={status}
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
                    status = '';
                    if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
                        status = 'Muted';
                    } else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
                        if (this.packetLoss.get(p.id) === 100) {
                            status = 'No media';
                            participantsCount = participantsCount - 1;
                            return;
                        } else {
                            status = this.packetLoss.get(p.id) + '% loss';
                        }
                    } else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
                        status = this.latency.get(p.id) + ' ms';
                    }

                    videos.push(
                        <ConferenceMatrixParticipant
                            key = {p.id}
                            participant = {p}
                            large = {this.state.participants.length <= 1}
                            pauseVideo={(idx >= 4) || (idx >= 2 && this.props.isTablet === false)}
                            isLandscape={this.props.isLandscape}
                            isTablet={this.props.isTablet}
                            useTwoRows={this.state.participants.length > 2}
                            status={status}
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
                                status={status}
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

        const conferenceContainer = this.props.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
        const audioContainer = this.props.isLandscape ? styles.audioContainerLandscape : styles.audioContainer;
        const chatContainer = this.props.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;

        return (
            <View style={styles.container}>
                <View style={conferenceContainer}>
                    <ConferenceHeader
                        show={this.state.callOverlayVisible}
                        remoteUri={remoteUri}
                        isTablet={this.props.isTablet}
                        call={this.state.call}
                        participants={participantsCount}
                        reconnectingCall={this.state.reconnectingCall}
                        buttons={buttons}
                        audioOnly={this.props.audioOnly}
                        terminated={this.state.terminated}
                        info={this.getInfo()}
                        goBackFunc={this.props.goBackFunc}
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

                    {this.state.chatView ?
                         <View style={chatContainer}>
                            <GiftedChat
                              messages={this.state.messages}
                              onSend={this.onSendMessage}
                              alwaysShowSend={true}
                              scrollToBottom
                              inverted={true}
                              timeTextStyle={{ left: { color: 'red' }, right: { color: 'yellow' } }}
                              infiniteScroll
                            />
                          </View>
                    : null}

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
                    lookupContacts = {this.props.lookupContacts}
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
    saveMessage         : PropTypes.func,
    messages            : PropTypes.array,
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
    initialParticipants : PropTypes.array,
    terminated          : PropTypes.bool,
    myContacts          : PropTypes.object,
    lookupContacts      : PropTypes.func,
    goBackFunc          : PropTypes.func
};

export default ConferenceBox;
