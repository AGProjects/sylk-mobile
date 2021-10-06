'use strict';

import React, {useState, Component, Fragment} from 'react';
import { View, Platform, TouchableWithoutFeedback, Dimensions, SafeAreaView, ScrollView, FlatList, TouchableHighlight, Keyboard } from 'react-native';
import PropTypes from 'prop-types';
import * as sylkrtc from 'react-native-sylkrtc';
import classNames from 'classnames';
import debug from 'react-native-debug';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Appbar, Portal, Modal, Surface, Paragraph, Text } from 'react-native-paper';
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
import { GiftedChat, Bubble, MessageText  } from 'react-native-gifted-chat'
import xss from 'xss';
import CustomChatActions from './ChatActions';
import * as RNFS from 'react-native-fs';
import styles from '../assets/styles/blink/_ConferenceBox.scss';
import RNBackgroundDownloader from 'react-native-background-downloader';


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

        this.downloadRequests = {};


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

        let renderMessages = [];

        if (this.props.remoteUri in this.props.messages) {
            renderMessages = this.props.messages[this.props.remoteUri];
        }

        if (this.props.call) {
            let giftedChatMessage;
            let direction;
            this.props.call.messages.forEach((sylkMessage) => {
                if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                    return;
                }

                if (sylkMessage.type === 'status') {
                    return;
                }

                if (!this.seenMessages.has(sylkMessage._id)) {
                    this.seenMessages.set(sylkMessage._id, true);

                    const existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                    if (existingMessages.length > 0) {
                        return;
                    }

                    direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                    if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                        direction = 'outgoing';
                    }

                    giftedChatMessage = utils.sylkToRenderMessage(sylkMessage, null, direction);

                    renderMessages.push(giftedChatMessage);
                    this.props.saveMessage(this.props.remoteUri, giftedChatMessage);
                }
            });
        }

        const videoEnabled = this.props.call && this.props.call.getLocalStreams()[0].getVideoTracks().length > 0;

        this.state = {
            callOverlayVisible: true,
            remoteUri: this.props.remoteUri,
            call: this.props.call,
            accountId: this.props.call ? this.props.call.account.id : null,
            renderMessages: GiftedChat.append(renderMessages, []),
            ended: false,
            keyboardVisible: false,
            videoEnabled: videoEnabled,
            audioMuted: this.props.muted,
            videoMuted: !this.props.inFocus,
            videoMutedbyUser: false,
            messages: this.props.messages,
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
            chatView: !videoEnabled,
            audioView: !videoEnabled,
            isLandscape: this.props.isLandscape,
            selectedContacts: this.props.selectedContacts
        };

        const friendlyName = this.state.remoteUri.split('@')[0];
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
        // TODO preserve this list between route changes

        props.initialParticipants.forEach((uri) => {
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.lookupContact(uri);
        });

        this.participantsTimer = setInterval(() => {
             this.updateParticipantsStatus();
        }, this.sampleInterval * 1000);

        setTimeout(() => {
            this.listSharedFiles();
        }, 1000);
    }

    messageExists(giftedChatMessage, sylkMessage) {
       if (sylkMessage._id === giftedChatMessage._id) {
           return true;
       }

       let gs_timestamp = giftedChatMessage.createdAt;
       let sylk_timestamp = sylkMessage.timestamp;

       gs_timestamp.setMilliseconds(0);
       sylk_timestamp.setMilliseconds(0);

       if (gs_timestamp.toString() === sylk_timestamp.toString() && giftedChatMessage.text === sylkMessage.content) {
           return true;
       }

       return false;
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

        if (nextProps.remoteUri in nextProps.messages) {
            let renderMessages = nextProps.messages[nextProps.remoteUri];
            let direction;

            if (nextProps.call) {
                let giftedChatMessage;
                nextProps.call.messages.forEach((sylkMessage) => {
                    if (sylkMessage.type === 'status') {
                        return;
                    }

                    if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                        return;
                    }

                    if (!this.seenMessages.has(sylkMessage._id)) {
                        this.seenMessages.set(sylkMessage._id, true);

                        const existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                        if (existingMessages.length > 0) {
                            return;
                        }

                        direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                        if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                            direction = 'outgoing';
                        }

                        giftedChatMessage = utils.sylkToRenderMessage(sylkMessage, null, direction);

                        renderMessages.push(giftedChatMessage);
                        this.props.saveMessage(this.props.remoteUri, giftedChatMessage);
                    }
                });
            }
            this.setState({renderMessages: GiftedChat.append(renderMessages, [])});
        }

        this.setState({terminated: nextProps.terminated,
                       remoteUri: nextProps.remoteUri,
                       isLandscape: nextProps.isLandscape,
                       messages: nextProps.messages,
                       accountId: !this.state.accountId && nextProps.call ? this.props.call.account.id : this.state.accountId,
                       selectedContacts: nextProps.selectedContacts});
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

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} onSend={this.onSendFromUser} onSendWithFile={this.uploadFile}/>
    )

    onSendFromUser() {
        console.log('On send from user...');
    }

    uploadBegin(response) {
      var jobId = response.jobId;
      console.log('UPLOAD HAS BEGUN! JobId: ' + jobId);
    };

    uploadProgress(response) {
      var percentage = Math.floor((response.totalBytesSent/response.totalBytesExpectedToSend) * 100);
      console.log('UPLOAD IS ' + percentage + '% DONE!');
    };

    transferComplete(evt) {
      console.log("The transfer is complete.", evt);
    }

    transferFailed(evt) {
      console.log("An error occurred while transferring the file.", evt);
    }

    transferCanceled(evt) {
      console.log("The transfer has been canceled by the user.");
    }

    filePath(filename) {
        let dir = RNFS.DocumentDirectoryPath + '/conference/' + this.state.remoteUri + '/files';
        let path;
        RNFS.mkdir(dir);
        path = dir + '/' + filename.toLowerCase();
        return path;
    }

    addUploadFileMessage(file) {
        let id = this.state.remoteUri + '_' + file.name;
        let image;
        if (file.name.toLowerCase().endsWith('.png')) {
            image = file.uri;
        } else if (file.name.toLowerCase().endsWith('.jpg')) {
            image = file.uri;
        } else if (file.name.toLowerCase().endsWith('.jpeg')) {
            image = file.uri;
        } else if (file.name.toLowerCase().endsWith('.gif')) {
            image = file.uri;
        }

        if (image) {
            var localPath = this.filePath(file.name);
            RNFS.copyFile(file.uri, localPath).then((success) => {
                console.log('Cache file to app', localPath);
                image = 'file://' + localPath;
            }).catch((err) => {
                console.log('Error writing to file', localPath, err.message);
            });
        }

        const giftedChatMessage = {
            _id: id,
            createdAt: new Date(),
            text: 'Uploading...',
            url: file.url,
            local_url: file.uri,
            received: false,
            sent: false,
            progress: 0,
            direction: 'outgoing',
            pending: true,
            image: image,
            user: {}
        };

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        return id;
    }

    renderMessageText(props) {
      const {
        currentMessage,
      } = props;
      const { text: currText } = currentMessage;
      let status = !currentMessage.received ? currentMessage.progress + '%' : 'Uploaded successfully';
      return (
        <View>
             <MessageText {...props}
                  currentMessage={{
                    ...currentMessage,
                    text: currText.replace('Uploading...', status).trim(),
                  }}/>

        </View>
      );
    };

    renderMessageBubble (props) {
        let rightColor = '#0084ff';
        let leftColor = '#f0f0f0';

        if (props.currentMessage.failed) {
            rightColor = 'red';
        } else {
            if (props.currentMessage.pinned) {
                rightColor = '#2ecc71';
                leftColor = '#2ecc71';
            }
        }

        return (
          <Bubble
            {...props}
            wrapperStyle={{
              right: {
                backgroundColor: rightColor
              },
              left: {
                backgroundColor: leftColor
              }
            }}
          />
        )
    }

    updateFileUploadMessage(id, progress) {
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                 msg.progress = progress;
                 if (progress === 100 && !msg.sent) {
                     msg.sent = true;
                     msg.received = true;
                     msg.text = 'Uploaded successfully';
                     msg.progress = null;
                     this.props.saveMessage(this.state.remoteUri, msg);
                 }
             }
             newRenderMessages.push(msg);
        });

        this.setState({renderMessages: GiftedChat.append(newRenderMessages, [])});
    }

    failedFileUploadMessage(id) {
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                 msg.sent = true;
                 msg.received = true;
                 msg.text = 'Upload failed';
                 msg.progress = null;
             }
             newRenderMessages.push(msg);
             this.props.saveMessage(this.state.remoteUri, msg);
        });

        this.setState({renderMessages: GiftedChat.append(newRenderMessages, [])});
    }

    async uploadFile(file) {
        let fileData = {
            name: file.name,
            type: file.type,
            size: file.size,
            uri: file.uri
        };

        let url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + this.props.call.id + '/' + file.name;

        console.log('Uploading', file.type, 'file', file.uri, 'to', url);

        if (file.size > 1024 * 1024 * 40) {
            this.postChatSystemMessage(file.name + 'is too big', false);
            return;
        }

        RNFS.readFile(file.uri, 'base64').then(res => {
            let idx = this.addUploadFileMessage(file);
            var oReq = new XMLHttpRequest();
            oReq.addEventListener("load", this.transferComplete);
            oReq.addEventListener("error", this.transferFailed);
            oReq.addEventListener("abort", this.transferCanceled);
            oReq.open('POST', url);
            const formData = new FormData();
            formData.append(res);
            oReq.send(formData);
            file.url = url;
            if (oReq.upload) {
                oReq.upload.onprogress = ({ total, loaded }) => {
                    const uploadProgress = Math.ceil(loaded / total * 100);
                    this.updateFileUploadMessage(idx, uploadProgress);
                };
            }
        })
        .catch(err => {
            console.log(err.message, err.code);

        });
    }

    listSharedFiles() {
        let sharedFiles = this.state.sharedFiles;
        let url;
        let i = 0;
        let image;
        this.state.sharedFiles.forEach((file)=>{
            if (file.session !== this.props.call.id) {
                //console.log(file);
                image = null;
                url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + file.session + '/' + file.filename;
                sharedFiles[i] = file;
                file.msg_id = this.state.remoteUri + '_' + file.filename;
                const existingMessages = this.state.renderMessages.filter(msg => msg._id === file.msg_id);
                if (existingMessages.length > 0) {
                    console.log('File exists', file.msg_id );
                    return;
                }

                const direction = file.uploader.uri === this.props.account.id ? 'outgoing' : 'incoming';

                if (file.filename.toLowerCase().endsWith('.png')) {
                    image = url;
                } else if (file.filename.toLowerCase().endsWith('.jpg')) {
                    image = url;
                } else if (file.filename.toLowerCase().endsWith('.jpeg')) {
                    image = url;
                } else if (file.filename.toLowerCase().endsWith('.gif')) {
                    image = url;
                }

                let text = image ? 'Image' : file.filename.toLowerCase();
                let size = file.filesize + + " B";
                if (file.filesize > 1024 * 1024) {
                    size = Math.ceil(file.filesize/1024/1024) + " MB";
                } else if (file.filesize < 1024 * 1024) {
                    size = Math.ceil(file.filesize/1024) + " KB";
                }
                text = text + " (" + size + ")";

                //let localFilePath = RNBackgroundDownloader.directories.documents + "/" + file.filename.toLowerCase();
                var localFilePath = this.filePath(file.filename);

                var fileExists = false;

                RNFS.exists(localFilePath).then(res => {
                    if (res) {
                        console.log(file.filename, 'already exists');
                        if (image) {
                            image = 'file://'+localFilePath;
                        }
                        const giftedChatMessage = {
                              _id: file.msg_id,
                              createdAt: new Date(),
                              text: text,
                              url: url,
                              image: image,
                              received: true,
                              sent: direction === 'incoming' ? false : true,
                              user: direction === 'incoming' ? {_id: file.uploader.uri, name: file.uploader.displayName} : {}
                            };
                        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
                        this.props.saveMessage(this.state.remoteUri, giftedChatMessage);

                    } else {
                        this.downloadRequests[file.msg_id] = RNBackgroundDownloader.download({
                            id: file.msg_id,
                            url: url,
                            destination: localFilePath
                        }).begin((expectedBytes) => {
                            console.log(localFilePath, `Going to download ${expectedBytes} bytes!`);
                        }).progress((percent) => {
                            console.log(localFilePath, `Downloaded: ${percent * 100}%`);
                        }).done(() => {
                            console.log(localFilePath, 'download done');
                            if (image) {
                                image = 'file://' + localFilePath;
                            }
                            const giftedChatMessage = {
                                  _id: file.msg_id,
                                  createdAt: new Date(),
                                  text: text,
                                  url: url,
                                  image: image,
                                  received: true,
                                  sent: direction === 'incoming' ? false : true,
                                  user: direction === 'incoming' ? {_id: file.uploader.uri, name: file.uploader.displayName} : {}
                                };
                            //console.log(giftedChatMessage);

                            this.props.saveMessage(this.state.remoteUri, giftedChatMessage);
                            this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});

                        }).error((error) => {
                            console.log(localFilePath, 'download error:', error);
                        });

                    }

                });

            }
            i = i + 1;
        });

        this.setState({sharedFiles: sharedFiles});
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
                    this.postChatSystemMessage(_uri + ' did not answer', false);
                } else {
                    p.status = p.status + '.';
                }
            }

        });

        this.forceUpdate();
    }

    postChatSystemMessage(text, save=true) {
        var now = new Date();
        var hours = now.getHours();
        var mins = now.getMinutes();
        var secs = now.getSeconds();
        var ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        mins = mins < 10 ? '0' + mins : mins;
        secs = secs < 10 ? '0' + secs : secs;
        text = text + ' at ' + hours + ":" + mins + ':' + secs + ' ' + ampm;

        const giftedChatMessage = {
              _id: uuid.v4(),
              createdAt: now,
              text: text,
              system: true,
            };

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        if (save) {
            this.props.saveMessage(this.state.remoteUri, giftedChatMessage);
        }
    }

    componentDidMount() {
        for (let p of this.state.participants) {
            p.on('stateChanged', this.onParticipantStateChanged);
            p.attach();
        }

        this.keyboardDidShowListener = Keyboard.addListener(
              'keyboardDidShow',
              this._keyboardDidShow
            );
        this.keyboardDidHideListener = Keyboard.addListener(
              'keyboardDidHide',
              this._keyboardDidHide
            );

        this.props.call.on('participantJoined', this.onParticipantJoined);
        this.props.call.on('participantLeft', this.onParticipantLeft);
        this.props.call.on('roomConfigured', this.onConfigureRoom);
        this.props.call.on('fileSharing', this.onFileSharing);
        this.props.call.on('composingIndication', this.composingIndicationReceived);
        this.props.call.on('message', this.messageReceived);

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
                if (p.identity._uri.search('guest.') === -1 && p.identity._uri !== this.props.call.localIdentity._uri) {
                    // used for history item
                    this.props.saveParticipant(this.props.call.id, this.state.remoteUri, p.identity._uri);
                    this.lookupContact(p.identity._uri, p.identity._displayName);
                }
            });
            // this.changeResolution();
        }

        if (this.state.videoMuted) {
            this._muteVideo();
        }

        //let msg = "Others can join the conference using a web browser at " + this.conferenceUrl;
        //this.postChatSystemMessage(msg, false);

        if (this.state.selectedContacts) {
            this.inviteParticipants(this.state.selectedContacts);
        }
    }

    componentWillUnmount() {
        clearTimeout(this.overlayTimer);
        clearTimeout(this.participantsTimer);
        this.uploads.forEach((upload) => {
            this.props.notificationCenter().removeNotification(upload[1]);
            upload[0].abort();
        })
        this.keyboardDidShowListener.remove();
        this.keyboardDidHideListener.remove();
    }

    _keyboardDidShow() {
       this.setState({keyboardVisible: true});
    }

    _keyboardDidHide() {
        this.setState({keyboardVisible: false});
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
        //console.log('Conference got message', sylkMessage);

        if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
            return;
        }

        const existingMessages = this.state.renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
        if (existingMessages.length > 0) {
            return;
        }

        if (sylkMessage.direction === 'incoming' && sylkMessage.sender.uri === this.state.accountId) {
            sylkMessage.direction = 'outgoing';
        }

        const giftedChatMessage = utils.sylkToRenderMessage(sylkMessage);
        if (sylkMessage.type === 'status') {
            return;
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        this.props.saveMessage(this.state.remoteUri, giftedChatMessage);
    }

    onSendMessage(messages) {
        if (!this.props.call) {
            return;
        }

        console.log('onSendMessage', messages);
        messages.forEach((message) => {
            this.props.call.sendMessage(message.text, 'text/plain')
            message.direction = 'outgoing';
            this.props.saveMessage(this.state.remoteUri, message);
        });
        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
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
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', uri);
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
        console.log(p.identity.uri, 'joined the conference');
        if (p.identity._uri.search('guest.') === -1) {
            if (p.identity._uri !== this.props.call.localIdentity._uri) {
                // used for history item
                this.props.saveParticipant(this.props.call.id, this.state.remoteUri, p.identity._uri);
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
        this.armOverlayTimer();
    }

    onParticipantLeft(p) {
        console.log(p.identity.uri, 'left the conference');
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
        this.armOverlayTimer();

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
        this.listSharedFiles();
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

        this.toggleDrawer();

        this.props.call.configureRoom(newActiveSpeakers.map((element) => element.publisherId), (error) => {
            if (error) {
                // This causes a state update, hence the drawer lists update
                this.logEvent.error('set speakers failed', [], this.localIdentity);
            }
        });
    }

    toggleSpeakerSelection() {
        this.setState({showSpeakerSelection: !this.state.showSpeakerSelection});
    }

    startSpeakerSelection(number) {
        this.selectSpeaker = number;
        this.toggleSpeakerSelection();
    }

    preventOverlay(event) {
        // Stop the overlay when we are the thumbnail bar
        event.stopPropagation();
    }

    muteAudio(event) {
        event.preventDefault();
        if (this.state.audioMuted) {
            //this.postChatSystemMessage('Audio un-muted');
            this.props.toggleMute(this.props.call.id, false);
        } else {
            //this.postChatSystemMessage('Audio muted');
            this.props.toggleMute(this.props.call.id, true);
        }
     }

    toggleChat(event) {
        event.preventDefault();
        if (this.state.videoEnabled) {
            this.props.goBackFunc();
        } else {
            if (this.state.chatView && !this.state.audioView) {
                this.setState({audioView: !this.state.audioView});
            }

            this.setState({chatView: !this.state.chatView});
        }
    }

    toggleAudioParticipants(event) {
        event.preventDefault();
        if (this.state.audioView && !this.state.chatView) {
            this.setState({chatView: !this.state.chatView});
        }
        this.setState({audioView: !this.state.audioView});
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
        this.setState({callOverlayVisible: true});

        if (this.state.participants.length > 0) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = setTimeout(() => {
                this.setState({callOverlayVisible: false});
            }, 5000);
        }
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

            this.postChatSystemMessage(uri + ' was invited', false);
            this.invitedParticipants.set(uri, {timestamp: Date.now(), status: 'Invited'})
            this.props.saveParticipant(this.props.call.id, this.state.remoteUri, uri);
            this.lookupContact(uri);
        });

        this.props.finishInvite();
        this.forceUpdate()
    }

    render() {
        if (this.props.call === null) {
            return (<View></View>);
        }

        //console.log('---- Conference box', this.state.renderMessages.length);

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


        const buttons = {};

        const muteButtonIcons = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcons = this.state.videoMuted ? 'video-off' : 'video';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        // populate speaker selection list only with participants that have video
        let speakerSelectionParticipants = [];
        this.state.participants.forEach((p) => {
            if (p.streams && p.streams.length > 0) {
                if (p.streams[0].getVideoTracks().length > 0) {
                    let track = p.streams[0].getVideoTracks()[0];
                    speakerSelectionParticipants.push(p);
                }
            }
        });

        //console.log('Number of possible speakers with video enabled', speakerSelectionParticipants.length);

        let myself = {id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity};
        let unselectItem = {id: 'none', publisherId: null, identity: {uri: 'none', displayName: 'No speaker'}};

        speakerSelectionParticipants.push(myself);
        speakerSelectionParticipants.push(unselectItem);

        //console.log('----speakerSelectionParticipants', speakerSelectionParticipants);
        const floatingButtons = [];
        if (!this.state.showDrawer && speakerSelectionParticipants.length > 2 && this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Select speaker"
                    onPress={this.toggleDrawer}
                    icon="account-tie"
                    key="select-speaker"
                />
                </TouchableHighlight>
              </View>
            );
        }

            if (!this.state.isTablet && !this.state.isLandscape) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    title="Chat"
                    onPress={this.toggleChat}
                    icon="chat"
                    key="toggleChat"
                />
                </TouchableHighlight>
              </View>
            );
           }

           if (!this.state.videoEnabled && !this.state.isLandscape) {
               floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    title="Chat"
                    onPress={this.toggleAudioParticipants}
                    icon="account-multiple"
                    key="toggleChat"
                />
                </TouchableHighlight>
              </View>
            );
            }

           if (this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Mute/unmute video"
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcons}
                    key="muteButton"
                />
                </TouchableHighlight>
              </View>
            );
        }
        floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Mute/unmute audio"
                onPress={this.muteAudio}
                icon={muteButtonIcons}
                key="muteAudioButton"
            />
                </TouchableHighlight>
              </View>
        );

        if (this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Toggle camera"
                    onPress={this.toggleCamera}
                    icon='video-switch'
                    key="toggleVideo"
                />
                </TouchableHighlight>
              </View>
            );

        }

        if (!this.state.reconnectingCall) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'volume-off'}
                    onPress={this.props.toggleSpeakerPhone}
                    key="speakerPhoneButton"
                />
                </TouchableHighlight>
              </View>
            )
        }

        floatingButtons.push(
          <View style={styles.buttonContainer}>
              <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Share"
                onPress={this.props.inviteToConferenceFunc}
                icon="account-plus"
                key="invite"
            />
            </TouchableHighlight>
          </View>
        );

        floatingButtons.push(
          <View style={styles.buttonContainer}>
              <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Share"
                onPress={this.toggleInviteModal}
                icon="share"
                key="share"
            />
            </TouchableHighlight>
          </View>
        );

        if (this.props.isLandscape) {
            buttons.additional = floatingButtons;
        } else {
            buttons.additional = [];
        }

        buttons.additional.push(
          <View style={styles.buttonContainer}>
          <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                disabled={true}
                title="space"
                key="spacer"
            />
            </TouchableHighlight>
          </View>
        );

        buttons.additional.push(
          <View style={styles.buttonContainer}>
          <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={[buttonClass, styles.hangupButton]}
                title="Leave conference"
                onPress={this.hangup}
                icon="phone-hangup"
                key="hangupButton"
            />
            </TouchableHighlight>
          </View>
        );

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
                    } else {
                        status = this.packetLoss.get(p.id) + '% loss';
                    }
                } else if (this.latency.has(p.id) && this.latency.get(p.id) > 150) {
                    status = this.latency.get(p.id) + ' ms';
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

            const conferenceContainer = this.state.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
            const audioContainer = this.state.isLandscape ? styles.audioContainerLandscape : styles.audioContainerPortrait;
            let chatContainer = this.state.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;
            if (this.props.audioOnly) {
                chatContainer = this.state.isLandscape ? styles.chatContainerLandscapeAudio : styles.chatContainerPortraitAudio;
            }

         let renderMessages = this.state.renderMessages;
         renderMessages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);

            return (
                <View style={styles.container} >
                    <View style={conferenceContainer}>
                        {!this.state.keyboardVisible && !this.props.isLandscape ?
                        <View style={styles.buttonsContainer}>
                            {floatingButtons}
                        </View>
                        : null}
                        <ConferenceHeader
                            show={true}
                            call={this.state.call}
                            callContact={this.props.callContact}
                            isTablet={this.props.isTablet}
                            isLandscape={this.state.isLandscape}
                            remoteUri={this.state.remoteUri}
                            participants={this.state.participants.length}
                            reconnectingCall={this.state.reconnectingCall}
                            buttons={buttons}
                            audioOnly={this.props.audioOnly}
                            terminated={this.state.terminated}
                            info={this.getInfo()}
                            goBackFunc={this.props.goBackFunc}
                            toggleInviteModal={this.toggleInviteModal}
                            inviteToConferenceFunc={this.props.inviteToConferenceFunc}
                            callState={this.props.callState}
                        />

                        {!this.state.keyboardVisible && (this.state.audioView || this.state.isLandscape) ?
                        <View style={audioContainer}>
                            <ConferenceAudioParticipantList >
                                {audioParticipants}
                            </ConferenceAudioParticipantList>
                        </View>
                        : null}

                            {this.state.chatView || this.state.isLandscape ?
                            <View style={chatContainer}>
                                <GiftedChat
                                  messages={renderMessages}
                                  renderActions={this.renderCustomActions}
                                  onSend={this.onSendMessage}
                                  renderBubble={this.renderMessageBubble}
                                  renderMessageText={this.renderMessageText}
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
                        alreadyInvitedParticipants={alreadyInvitedParticipants}
                        currentParticipants={this.state.participants.map((p) => {return p.identity.uri})}
                        close={this.toggleInviteModal}
                        room={this.state.remoteUri}
                        defaultDomain = {this.props.defaultDomain}
                        accountId = {this.props.call.localIdentity._uri}
                        notificationCenter = {this.props.notificationCenter}
                        lookupContacts = {this.props.lookupContacts}
                    />

                <ConferenceDrawer
                    show={this.state.showDrawer && !this.state.reconnectingCall}
                    close={this.toggleDrawer}
                    isLandscape={this.state.isLandscape}
                    title="Conference room configuration"
                    >
                    <View style={this.state.isLandscape ? [{maxHeight: Dimensions.get('window').height - 160}, styles.landscapeDrawer] : styles.portraitDrawer}>
                        <View style={{flex: this.state.isLandscape ? 1 : 2}}>
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
                    isLandscape={this.state.isLandscape}
                    showBackdrop={false}
                    title={`Select speaker ${this.selectSpeaker}`}
                    >
                    <ConferenceDrawerSpeakerSelection
                        participants={speakerSelectionParticipants}
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
                        status = this.latency.get(p.id) + ' ms';
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
                let vtrack;
                this.state.participants.forEach((p, idx) => {
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
                        status = this.latency.get(p.id) + ' ms';
                    }

                    if (p.streams && p.streams.length > 0) {
                        if (p.streams[0].getVideoTracks().length > 0) {
                            vtrack = p.streams[0].getVideoTracks()[0];
                            if (vtrack.muted) {
                                //console.log('Skip muted video of', p.identity.uri);
                                return;
                            }
                        }
                    }

                    // console.log('Added video of', p.identity.uri);
                    videos.push(
                        <ConferenceMatrixParticipant
                            key = {p.id}
                            participant = {p}
                            large = {this.state.participants.length <= 1}
                            pauseVideo={(idx >= 4) || (idx >= 2 && this.props.isTablet === false)}
                            isLandscape={this.state.isLandscape}
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

        const currentParticipants = this.state.participants.map((p) => {return p.identity.uri})
        const alreadyInvitedParticipants = this.invitedParticipants ? Array.from(this.invitedParticipants.keys()) : [];

        const conferenceContainer = this.state.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
        const chatContainer = this.state.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;

        if (!this.state.isLandscape && this.state.callOverlayVisible) {
            buttons.bottom = floatingButtons;
        }

        return (
            <View style={styles.container}>
                    <View style={conferenceContainer}>
                    {this.state.callOverlayVisible ?
                    <ConferenceHeader
                        remoteUri={this.state.remoteUri}
                        callContact={this.props.callContact}
                        isTablet={this.props.isTablet}
                        isLandscape={this.state.isLandscape}
                        call={this.state.call}
                        participants={this.state.participants.length}
                        reconnectingCall={this.state.reconnectingCall}
                        buttons={buttons}
                        audioOnly={this.props.audioOnly}
                        terminated={this.state.terminated}
                        info={this.getInfo()}
                        goBackFunc={this.props.goBackFunc}
                        toggleInviteModal={this.toggleInviteModal}
                        inviteToConferenceFunc={this.props.inviteToConferenceFunc}
                        callState={this.props.callState}
                    />
                    : null}

                    {this.state.chatView || false?
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

                    <TouchableWithoutFeedback onPress={this.showOverlay}>
                        <View style={[styles.videosContainer, this.state.isLandscape ? styles.landscapeVideosContainer: null]}>
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
                    room={this.state.remoteUri}
                    defaultDomain = {this.props.defaultDomain}
                    notificationCenter = {this.props.notificationCenter}
                    lookupContacts = {this.props.lookupContacts}
                />
                <ConferenceDrawer
                    show={this.state.showDrawer && !this.state.reconnectingCall}
                    close={this.toggleDrawer}
                    isLandscape={this.state.isLandscape}
                    title="Conference room configuration"
                >
                    <View style={this.state.isLandscape ? [{maxHeight: Dimensions.get('window').height - 60}, styles.landscapeDrawer] : styles.container}>
                        <View style={{flex: this.state.isLandscape ? 1 : 2}}>
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
                    isLandscape={this.state.isLandscape}
                    showBackdrop={false}
                    title={`Select speaker ${this.selectSpeaker}`}
                >
                    <ConferenceDrawerSpeakerSelection
                        participants={speakerSelectionParticipants}
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
    goBackFunc          : PropTypes.func,
    inviteToConferenceFunc: PropTypes.func,
    selectedContacts    : PropTypes.array,
    callState           : PropTypes.object,
    callContact         : PropTypes.object,
    finishInvite        : PropTypes.func,
    account             : PropTypes.object,
    messages            : PropTypes.object,
    getMessages         : PropTypes.func,
    fileSharingUrl      : PropTypes.string
};

export default ConferenceBox;
