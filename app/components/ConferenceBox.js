'use strict';

import React, {useState, Component, Fragment} from 'react';
import { Clipboard, View, Platform, TouchableWithoutFeedback, TouchableOpacity, Dimensions, SafeAreaView, ScrollView, FlatList, TouchableHighlight, Keyboard, Switch, Animated, PanResponder} from 'react-native';
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
import { GiftedChat, Bubble, MessageText, Send, MessageImage } from 'react-native-gifted-chat'
import {renderBubble } from './ContactsListBox';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import RNFetchBlob from "rn-fetch-blob";
import VideoPlayer from 'react-native-video-player';

import xss from 'xss';
import * as RNFS from 'react-native-fs';
import styles from '../assets/styles/blink/_ConferenceBox.scss';
import RNBackgroundDownloader from 'react-native-background-downloader';
import md5 from "react-native-md5";
import FileViewer from 'react-native-file-viewer';
import _ from 'lodash'; import { produce } from "immer"
import moment from 'moment';
import {StatusBar} from 'react-native';


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

        this.sliderTimeout = null;

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

        this.sampleInterval = 1;

        this.typingTimer = null;

        let renderMessages = [];

        if (this.props.remoteUri in this.props.messages) {
            renderMessages = this.props.messages[this.props.remoteUri];
        }

        this.audioViewMinHeight = 170;

        let duration = 0;

        if (this.props.call) {
            let giftedChatMessage;
            let direction;
            duration = Math.floor((new Date() - this.props.callState.startTime) / 1000);

            this.props.call.messages.forEach((sylkMessage) => {
                if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                    return;
                }

                if (sylkMessage.type === 'status') {
                    return;
                }

                const existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                if (existingMessages.length > 0) {
                    return;
                }

                direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                    direction = 'outgoing';
                }

                giftedChatMessage = utils.sylk2GiftedChat(sylkMessage, null, direction);

                renderMessages.push(giftedChatMessage);
                this.saveConferenceMessage(this.props.remoteUri, giftedChatMessage);
            });
        }

        const videoEnabled = this.props.call && this.props.call.getLocalStreams()[0].getVideoTracks().length > 0;

        let bottomHeight = Dimensions.get('window').height * 50/100;
        //console.log('bottomHeight', bottomHeight);

        let participants = [];
        if (props.call) {
            props.call.participants.forEach((p) => {
                if (!p.timestamp) {
                    p.timestamp = Date.now();
                }
            });
            participants = props.call.participants.slice();
        }

        this.state = {
            callOverlayVisible: true,
            remoteUri: this.props.remoteUri,
            call: this.props.call,
            accountId: this.props.call ? this.props.call.account.id : null,
            renderMessages: renderMessages,
            ended: false,
            duration: duration,
            isTyping: false,
            keyboardVisible: false,
            videoEnabled: videoEnabled,
            audioMuted: this.props.muted,
            videoMuted: !this.props.inFocus,
            videoMutedbyUser: false,
            messages: this.props.messages,
            participants: participants,
            showInviteModal: false,
            showDrawer: false,
            keyboardHeight: 0,
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
            selectedContacts: this.props.selectedContacts,
            activeDownloads: {},
            offset          : 0,
            topHeight       : Dimensions.get('window').height - bottomHeight,
            bottomHeight    : duration > 10 && this.props.conferenceSliderPosition ? this.props.conferenceSliderPosition : bottomHeight, // min height for bottom pane header,
            deviceHeight    : Dimensions.get('window').height,
            isDividerClicked: false,
            pan             : new Animated.ValueXY()
        };


        this._panResponder = PanResponder.create({
            onMoveShouldSetResponderCapture: () => true,
            onMoveShouldSetPanResponderCapture: () => true,

            // Initially, set the Y position offset when touch start
            onPanResponderGrant: (e, gestureState) => {
                this.setState({
                    offset: e.nativeEvent.pageY,
                    isDividerClicked: true
                })

                this.sliderTimeout = setTimeout(() => {
                    this.setState({
                        isDividerClicked: false
                    })
                }, 2000);
            },

            // When we drag the divider, set the bottomHeight (component state) again.
            onPanResponderMove: (e, gestureState) => {
                //let b = gestureState.moveY > (this.state.deviceHeight - 40) ? 40 : this.state.deviceHeight - gestureState.moveY - 40;
                const maxH = Dimensions.get('window').height - this.audioViewMinHeight - 110;

                let b = Math.floor(this.state.deviceHeight - gestureState.moveY);
                if (b > maxH) {
                    b = maxH;
                }

                var d = this.state.bottomHeight - b;
                if (d < 0) {
                    d = -d;
                }

                if (d >= 30) {
                    this.setState({
                        bottomHeight    : b,
                        offset: e.nativeEvent.pageY,
                        isDividerClicked: true
                    })

                    if (this.sliderTimeout) {
                        clearTimeout(this.sliderTimeout);
                        this.sliderTimeout = null;
                    }

                    this.sliderTimeout = setTimeout(() => {
                        console.log('Turn slider off');
                        this.setState({
                            isDividerClicked: false
                        })
                        this.sliderTimeout = null;
                    }, 2000);

                    this.props.saveSliderFunc(b);
                }
            },

            onPanResponderRelease: (e, gestureState) => {
                // Do something here for the touch end event
                this.setState({
                    offset: e.nativeEvent.pageY,
                })
            }
        });

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

        console.log('Initial call duration', duration);

        props.initialParticipants.forEach((uri) => {
            const existing_participants = participants.filter(p => p.identity._uri === uri);
            if (existing_participants.length === 0) {
                this.invitedParticipants.set(uri, {timestamp: Date.now(), status: duration < 10 ? 'Invited' : 'No answer'})
                this.lookupContact(uri);
            }
        });

        this.participantsTimer = setInterval(() => {
             this.updateParticipantsStatus();
        }, this.sampleInterval * 1000);

        this.props.getMessages(this.state.remoteUri.split('@')[0]);

        setTimeout(() => {
            this.listSharedFiles();
        }, 1000);
    }

    get chatViewHeight() {
        const wh = Dimensions.get('window').height;
        const kh = this.state.keyboardHeight;
        const sh = (Platform.OS === 'android') ? StatusBar.currentHeight : 0;
        //console.log('window height', Math.floor(wh));
        //console.log('keyboa height', Math.floor(kh));
        //console.log('status height', Math.floor(sh));

        let ah = Platform.OS === 'android' ? wh - kh - sh - 30: wh - 50;
        //console.log('Available height', Math.floor(ah));
        return ah;
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

        if (nextProps.hasOwnProperty('isDividerClicked')) {
            this.setState({isDividerClicked: nextProps.isDividerClicked});
        }

        if (nextProps.hasOwnProperty('keyboardVisible')) {
            this.setState({keyboardVisible: nextProps.keyboardVisible});
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

        let renderMessages = [];
        if (nextProps.remoteUri in nextProps.messages) {
            nextProps.messages[nextProps.remoteUri].forEach((message) => {
                const existingMessages = this.state.renderMessages.filter(msg => msg._id === message._id);
                if (existingMessages.length > 0) {
                    return;
                }
                renderMessages.push(message);
            });

            if (nextProps.call) {
                this.setState({sharedFiles: nextProps.call.sharedFiles.slice()});

                let giftedChatMessage;
                let existingMessages;
                let previousMessages;

                nextProps.call.messages.forEach((sylkMessage) => {
                    if (sylkMessage.type === 'status') {
                        return;
                    }

                    if (sylkMessage.sender.uri.indexOf('@conference.') && sylkMessage.content.indexOf('Welcome!') > -1) {
                        return;
                    }

                    existingMessages = renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                    if (existingMessages.length > 0) {
                        return;
                    }

                    existingMessages = this.state.renderMessages.filter(msg => this.messageExists(msg, sylkMessage));
                    if (existingMessages.length > 0) {
                        return;
                    }

                    let direction = sylkMessage.state === 'received' ? 'incoming': 'outgoing';

                    if (direction === 'incoming' && sylkMessage.sender.uri === this.props.account.id) {
                        direction = 'outgoing';
                    }

                    giftedChatMessage = utils.sylk2GiftedChat(sylkMessage, null, direction);
                    renderMessages.push(giftedChatMessage);
                    this.saveConferenceMessage(this.props.remoteUri, giftedChatMessage);
                });
            }
        }

        if (nextProps.bottomHeight) {
            this.setState({
                       topHeight       : nextProps.keyboardVisible === false ? nextProps.topHeight : 0, // min height for top pane heade
                       bottomHeight    : nextProps.bottomHeight, // min height for bottom pane header,
                       });
        }

        this.setState({terminated: nextProps.terminated,
                       remoteUri: nextProps.remoteUri,
                       renderMessages: GiftedChat.append(this.state.renderMessages, renderMessages),
                       isLandscape: nextProps.isLandscape,
                       messages: nextProps.messages,
                       offset: nextProps.offset,
                       activeDownloads: nextProps.activeDownloads,
                       accountId: !this.state.accountId && nextProps.call ? this.props.call.account.id : this.state.accountId,
                       selectedContacts: nextProps.selectedContacts});

    }

    getInfo() {
        let info;
        let bandwidthDownload = this.bandwidthDownload;
        let bandwidthUpload = this.bandwidthUpload;
        let unit = 'Kbit/s';

        if (this.bandwidthDownload > 0 && this.bandwidthUpload > 0) {
            if (this.bandwidthDownload > 1100 || this.bandwidthUpload > 1100) {
                bandwidthDownload = Math.ceil(this.bandwidthDownload / 1000 * 100) / 100;
                bandwidthUpload = Math.ceil(this.bandwidthUpload / 1000 * 100) / 100;
                unit = 'Mbit/s';
            }
            info = '⇣' + bandwidthDownload + ' ⇡' + bandwidthUpload + ' ' + unit;
        }

        return info;
    }

    saveConferenceMessage(uri, message) {
        this.props.saveConferenceMessage(uri, message);
    }

    updateConferenceMessage(uri, message) {
        this.props.updateConferenceMessage(uri, message);
    }

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
        console.log("Upload has finished", evt);
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

    tsize(fsize) {
        let size = fsize + + " B";
        if (fsize > 1024 * 1024) {
            size = Math.ceil(fsize/1024/1024) + " MB";
        } else if (fsize < 1024 * 1024) {
            size = Math.ceil(fsize/1024) + " KB";
        }
        return size;
    }

    toggleDownload(metadata) {
        //console.log('toggleDownload', metadata);
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === metadata.transfer_id) {
                 //console.log('Found message', msg.metadata);
                 if (msg.metadata.progress === null) {
                     msg.metadata.progress = 0;
                     msg.metadata.failed = false;
                     //console.log('Start metadata', msg.metadata);
                     this.downloadFile(metadata);
                 } else {
                     //console.log('Stop metadata', msg.metadata);
                     this.stopDownloadFile(metadata);
                     msg.metadata.progress = null;
                 }
                 this.updateConferenceMessage(this.props.remoteUri, msg);
             }
        });
    }

    async _launchCamera() {
        let options = {saveToPhotos: true,
                       mediaType: 'photo',
                       maxWidth: 2000,
                       cameraType: 'front'
                       }
        await launchCamera(options, this.cameraCallback);
    }

    async _launchImageLibrary() {
        let options = {};
        await launchImageLibrary(options, this.cameraCallback);
    }

    cameraCallback (result) {
        if (result.assets) {
            this.uploadFile(result.assets[0]);
        }
    }

    async _pickDocument() {
          try {
            const result = await DocumentPicker.pick({
              type: [DocumentPicker.types.allFiles],
              copyTo: 'documentDirectory',
              mode: 'import',
              allowMultiSelection: false,
            });

            const fileUri = result[0].fileCopyUri;
            if (!fileUri) {
              console.log('File URI is undefined or null');
              return;
            }

            console.log('Send file', fileUri);

            this.uploadfile(fileUri);

          } catch (err) {
            if (DocumentPicker.isCancel(err)) {
              console.log('User cancelled file picker');
            } else {
              console.log('DocumentPicker err => ', err);
              throw err;
            }
          }
    };

    renderSend = (props) => {
        let chatRightActionsContainer = Platform.OS === 'ios' ? styles.chatRightActionsContaineriOS : styles.chatRightActionsContainer;
        return (
            <Send {...props}>
              <View style={styles.chatSendContainer}>
              <TouchableOpacity onPress={this._launchCamera} onLongPress={this._launchImageLibrary}>
                <Icon
                  style={chatRightActionsContainer}
                  type="font-awesome"
                  name="camera"
                  size={20}
                  color='gray'
                />
                </TouchableOpacity>
                  <TouchableOpacity onPress={this._launchImageLibrary} onLongPress={this.pickDocument}>
                    <Icon
                      style={chatRightActionsContainer}
                      type="font-awesome"
                      name="paperclip"
                      size={20}
                      color='gray'
                    />
                    </TouchableOpacity>
                <Icon
                  type="font-awesome"
                  name="send"
                  style={styles.chatSendArrow}
                  size={20}
                  color={'gray'}
                />
              </View>
            </Send>
        );
    };

    renderMessageImage =(props) => {
        return (
          <MessageImage
            {...props}
            imageStyle={{
              width: '98%',
              height: Dimensions.get('window').width,
              resizeMode: 'cover'
            }}
          />
    )
    }

    renderMessageVideo(props){
        const { currentMessage } = props;

        return (
        <View style={styles.videoContainer}>
            <VideoPlayer
                video={{ uri: currentMessage.video}}
                autoplay={false}
                pauseOnPress={true}
                showDuration={true}
                controlsTimeout={2}
                fullScreenOnLongPress={true}
                customStyles={styles.videoPlayer}
            />
        </View>
        );
    };

    renderCustomView(props) {
        const {currentMessage} = props;
        const { text: currText } = currentMessage;

        if (!currentMessage.metadata) {
            return null;
        }

        let status = '';
        let label = 'Uploading...';

        let showSwitch = currentMessage.download || (currentMessage.url && (currentMessage.metadata.progress || !currentMessage.metadata.progress !== 100) && !currentMessage.local_url && !utils.isImage(currentMessage.metadata.name)) ;
        let switchOn = (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) ? true : false;

        if (currentMessage.direction === 'incoming') {
            label = 'Downloading...';
            if (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) {
                status = currentMessage.label + ' - ' + currentMessage.metadata.progress + '%';
            } else {
                if (!utils.isImage(currentMessage.metadata.name)) {
                    status = 'Swipe to download \n' + currentMessage.label;
                } else {
                    status = currentMessage.label;
                }
            }
        } else {
            if (!currentMessage.local_url && currentMessage.metadata.progress === null) {
                switchOn = false;
            }

            if (currentMessage.metadata.progress || currentMessage.metadata.progress === 0) {
                status = currentMessage.label + ' - ' + currentMessage.metadata.progress + '%';
            } else {
                status = currentMessage.label;
            }
        }

        if (currentMessage.url && !currentMessage.local_url) {
            //console.log('--- Render message', currentMessage.metadata.name, currentMessage.metadata.progress);
        }

        if (!utils.isImage(currentMessage.metadata.name) && !currentMessage.local_url) {
            //console.log('Show switch', currentMessage._id, currentMessage.metadata.name, switchOn, currentMessage.metadata.progress);
        }
        //console.log('text =', currentMessage.text, 'label =', label, 'status =', status);

        let progress = 'Download';

        if (currentMessage.metadata.progress !== null) {
            progress = currentMessage.metadata.progress + ' %';
        }
        if (showSwitch) {
            return (
                <View style={styles.downloadContainer}>
                    <Text style={styles.uploadProgress}>{progress}</Text>
                    <View style={styles.switch}>
                    <Switch value={switchOn} onValueChange={(value) => this.toggleDownload(currentMessage.metadata)}/>
                    </View>
                </View>
               );

        } else {
            return null;
        }
    };

    failedFileUploadMessage(id) {
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                 msg.sent = true;
                 msg.received = false;
                 msg.failed = true;
                 msg.metadata.progress = null;
                 msg.metadata.started = false;
             }
             newRenderMessages.push(msg);
             this.updateConferenceMessage(this.state.remoteUri, msg);
        });
    }

    async uploadFile(fileObject) {
        console.log('Uploading file', fileObject);

        var id =  md5.hex_md5(this.state.remoteUri + '_' + basename);
        let filepath = fileObject.uri ? fileObject.uri : fileObject;
        const basename = filepath.split('\\').pop().split('/').pop();
        let stats_filename = filepath.startsWith('file://') ? filepath.substr(7, filepath.length - 1) : filepath;
        const { size } = await RNFetchBlob.fs.stat(stats_filename);

        let file_transfer = { 'path': filepath,
                              'filename': basename,
                              'filesize': fileObject.fileSize || size,
                              'sender': {'uri': this.state.accountId},
                              'receiver': {'uri': this.state.remoteUri},
                              'transfer_id': id,
                              'direction': 'outgoing'
                              };

        if (fileObject.filetype) {
            file_transfer.filetype = fileObject.filetype;
        }

        let text = utils.beautyFileNameForBubble(file_transfer);

        let msg = {
            _id: id,
            key: id,
            text: text,
            metadata: file_transfer,
            received: false,
            sent: false,
            pending: true,
            createdAt: new Date(),
            direction: 'outgoing',
            user: {}
            }

        if (utils.isImage(basename)) {
            msg.image = filepath;
        } else if (utils.isAudio(basename)) {
            msg.audio = filepath;
        } else if (utils.isVideo(basename)) {
            msg.video = filepath;
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg])});

        file_transfer.url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + this.props.call.id + '/' + basename;
        file_transfer.transfer_id = id;
        let localPath = this.filePath(basename);
        await RNFS.copyFile(file_transfer.path, localPath);
        //console.log('Copy file to', localPath);
        file_transfer.local_url = localPath;
        file_transfer.progress = 0;
        msg.metadata = file_transfer;

        RNFS.readFile(localPath, 'base64').then(res => {
            this.saveConferenceMessage(this.state.remoteUri, msg);
            this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg])});

            var oReq = new XMLHttpRequest();
            oReq.addEventListener("load", this.transferComplete);
            oReq.addEventListener("error", this.transferFailed);
            oReq.addEventListener("abort", this.transferCanceled);
            oReq.open('POST', file_transfer.url);
            const formData = new FormData();
            formData.append(res);

            oReq.send(formData);
            if (oReq.upload) {
                oReq.upload.onprogress = ({ total, loaded }) => {
                    const progress = Math.ceil(loaded / total * 100);
                    this.updateFileMessage(id, progress);
                };
            }
        })
        .catch(err => {
            console.log('Failed to upload file', err.message, err.code);
        });
    }

    updateFileMessage(id, progress, failed=false) {
    //make a change togglePlay(msgidx) {

        //console.log('Update file progress', id, progress);
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        let nextState;
        renderMessages.forEach((msg) => {
             if (msg._id === id) {
                //console.log('Update file transfer for msg', msg);
                 if (failed) {
                     msg.failed = true;
                     msg.sent = true;
                     msg.pending = false;
                     msg.received = false;
                     msg.metadata.progress = null;
                     this.postChatSystemMessage('Download failed', false);
                     this.updateConferenceMessage(this.state.remoteUri, msg);
                 }

                 msg.metadata.progress = progress;

                 if (progress !== null) {
                     msg.failed = false;
                     msg.received = null;
                 }

                 if (progress === 100 && (!msg.sent || !msg.received)) {
                     msg.failed = false;
                     msg.pending = false;
                     msg.sent = msg.direction === 'outgoing' ? true : false;
                     msg.received = true;
                     msg.text = utils.beautyFileNameForBubble(msg.metadata);
                     console.log(msg.metadata.filename, msg.direction === 'outgoing' ? 'Upload completed' : 'Download completed');
                     //console.log('Update metadata', msg.metadata);
                     this.updateConferenceMessage(this.state.remoteUri, msg);
                 }
             }
             newRenderMessages.push(msg);
        });

        this.setState({renderMessages: GiftedChat.append(newRenderMessages, [])});
    }

    purgeSharedFiles() {
        this.state.renderMessages.forEach((msg) => {
            if (msg.url) {
                if (!msg.image && !msg.local_url) {
                    const parts = msg.url.split('/');
                    const filename = parts[parts.length - 1];
                    let existingFiles = this.state.sharedFiles.filter(file => md5.hex_md5(this.state.remoteUri + '_' + filename) === msg._id);
                    if (existingFiles.length === 0) {
                        this.props.deleteConferenceMessage(this.state.remoteUri, msg);
                    }
                }
            }
        });
    }

    async listSharedFiles() {
        console.log('--- List shared files');

        let messages = this.state.renderMessages;
        let new_messages = [];
        let found = false;
        let exists = false;

        for (const file of this.state.sharedFiles) {
            if (file.session === this.props.call.id) {
                // skip my own files
                continue;
            }

            let metadata = {};
            let text;
            let url;
            let msg;
            found = false;
            exists = false;

            metadata.transfer_id = md5.hex_md5(this.state.remoteUri + '_' + file.filename);

            for (const msg of messages) {
                if (msg._id === metadata.transfer_id) {
                    found = true;
                    metadata = msg.metadata;
                    console.log('File transfer', metadata.filename, 'already exists');
                    msg.text = utils.beautyFileNameForBubble(metadata);
                    exists = await RNFS.exists(metadata.local_url);
                    if (exists) {
                        console.log('Local file', metadata.filename, 'already exists');
                        metadata.received = true;
                        if (utils.isImage(metadata.filename)) {
                            msg.image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        } else if (utils.isAudio(metadata.filename)) {
                            msg.audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        } else if (utils.isVideo(metadata.filename)) {
                            msg.video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                        }
                     } else {
                         metadata.received = false;
                         msg.image = null;
                         msg.audio = null;
                         msg.video = null;
                     }
                     console.log('Updated message', msg);
                     new_messages.push(msg);
                }
            }

            if (found) {
                 this.setState({renderMessages: GiftedChat.append(new_messages, [])});
                 console.log('Update list and return');
                 return;
            }

            metadata.filesize = file.filesize;
            metadata.filename = file.filename;
            metadata.sender = {uri: file.uploader.uri};
            metadata.receiver = {uri: this.state.remoteUri};
            metadata.session = file.session;
            metadata.url = this.props.fileSharingUrl + '/' + this.state.remoteUri + '/' + metadata.session + '/' + metadata.name;
            metadata.direction = metadata.sender.uri === this.props.account.id ? 'outgoing' : 'incoming';
            metadata.local_url = this.filePath(metadata.filename);

            console.log('--- Shared file:', metadata);

            text = utils.beautyFileNameForBubble(metadata);

            msg = {
                  _id: metadata.transfer_id,
                  key: metadata.transfer_id,
                  createdAt: new Date(),
                  text: text,
                  url: url,
                  metadata: metadata,
                  received: false,
                  failed: false,
                  sent: false,
                  user: metadata.direction === 'incoming' ? {_id: metadata.sender.uri, name: metadata.sender.displayName || metadata.sender.uri} : {}
                };

            exists = await RNFS.exists(metadata.local_url);
            if (exists) {
                console.log('Local file new', metadata.local_url, 'already exists');
                metadata.received = true;

                if (utils.isImage(metadata.filename)) {
                    msg.image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (utils.isAudio(metadata.filename)) {
                    msg.audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (utils.isVideo(metadata.filename)) {
                    msg.video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                }

            } else {
                metadata.progress = 0;
                if (isImage) {
                    this.downloadFile(metadata);
                }
            }
            this.saveConferenceMessage(this.state.remoteUri, msg);
            console.log('Adding message for file transfer', msg);
            this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg])});
        }

        setTimeout(() => {
            this.purgeSharedFiles();
        }, 1000);
    }

    async stopDownloadFile(metadata) {
        let renderMessages = this.state.renderMessages;
        renderMessages.forEach((msg) => {
             if (msg._id === metadata.transfer_id) {
                 msg.metadata.progress = null;
                 this.updateConferenceMessage(this.state.remoteUri, msg);
             }
        });

        if (metadata.transfer_id in this.downloadRequests) {
            console.log('Stop download', metadata.url);
            let task = this.downloadRequests[metadata.transfer_id];
            task.stop();
            delete this.downloadRequests[metadata.transfer_id];
        }
    }

    async downloadFile(metadata) {
        //console.log('downloadFile', metadata);
        let lostTasks = await RNBackgroundDownloader.checkForExistingDownloads();

        /*
        TODO: server needs support for this resume

        if (metadata.transfer_id in this.downloadRequests) {
            let task = this.downloadRequests[metadata.transfer_id];
            console.log('Resume download', metadata.url);
            task.resume();
            return;
        }
        */

        const existingTask = lostTasks.filter(task => task.id === metadata.transfer_id);

        if (existingTask.length === 1) {
            var task = existingTask[0];
            console.log('Found existing download task', task);
            task.progress((percent) => {
                const progress = Math.ceil(percent * 100);
                this.updateFileMessage(metadata.transfer_id, progress);
            }).begin((expectedBytes) => {
                this.updateFileMessage(metadata.transfer_id, 0);
            }).done(() => {
                this.updateFileMessage(metadata.transfer_id, 100);
            }).error((error) => {
                this.updateFileMessage(metadata.transfer_id, 0, error);
                console.log(task.url, 'download error:', error);
            });
        } else {
            console.log('Start new download:', metadata.url);
            this.updateFileMessage(metadata.transfer_id, 0);
            this.downloadRequests[metadata.transfer_id] = RNBackgroundDownloader.download({
                id: metadata.transfer_id,
                url: metadata.url,
                destination: metadata.local_url
            }).begin((expectedBytes) => {
                this.updateFileMessage(metadata.transfer_id, 0);
                console.log(metadata.name, 'will download', expectedBytes, 'bytes');
            }).progress((percent) => {
                const progress = Math.ceil(percent * 100);
                this.updateFileMessage(metadata.transfer_id, progress);
            }).done(() => {
                this.updateFileMessage(metadata.transfer_id, 100);
                delete this.downloadRequests[metadata.transfer_id];
            }).error((error) => {
                console.log(metadata.name, 'download error:', error);
                this.updateFileMessage(metadata.transfer_id, 0, error);
                delete this.downloadRequests[metadata.transfer_id];
            });
        }
    }

    onLongMessagePress(context, currentMessage) {
        if (currentMessage && currentMessage.text) {
            let options = []
            options.push('Copy');
            if (currentMessage.local_url) {
                options.push('Open');
            }
            options.push('Cancel');

            //console.log('currentMessage', currentMessage);
            let l = options.length - 1;

            context.actionSheet().showActionSheetWithOptions({options, l}, (buttonIndex) => {
                let action = options[buttonIndex];
                if (action === 'Copy') {
                    Clipboard.setString(currentMessage.text);
                } else if (action === 'Open') {
                    FileViewer.open(currentMessage.local_url, { showOpenWithDialog: true })
                    .then(() => {
                        // success
                    })
                    .catch(error => {
                        // error
                    });
                }
            });
        }
    };

    removeInvitedParticipant(uri) {
        if (this.invitedParticipants.has(uri) > 0) {
            this.invitedParticipants.delete(uri);
            this.forceUpdate();
        }
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
            if (p.status == 'No answer' && interval >= 15) {
                //this.invitedParticipants.delete(_uri);
                //console.log('Update status', _uri, p.status);
                p.status = 'reinvite';
                interval = 0;
            }

            if (p.status.indexOf('Invited') > -1 && interval > 5) {
                //console.log('Update status', _uri, p.status);
                p.status = 'Wait .';
            }

            if (p.status.indexOf('.') > -1) {
                if (interval > 10) {
                    //console.log('Update status', _uri, p.status);
                    p.status = 'No answer';
                    this.postChatSystemMessage(_uri + ' did not answer', false);
                } else {
                    //console.log('Update status', _uri, p.status);
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

        var id = uuid.v4();

        const giftedChatMessage = {
              _id: uuid.v4(),
              key: id,
              createdAt: now,
              text: text,
              system: true,
            };

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        if (save) {
            this.saveConferenceMessage(this.state.remoteUri, giftedChatMessage);
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

    _keyboardDidShow(e) {
       this.setState({keyboardVisible: true, keyboardHeight: e.endCoordinates.height});
    }

    _keyboardDidHide() {
        this.setState({keyboardVisible: false, keyboardHeight: 0});
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
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }

        this.setState({isTyping: true});

        this.typingTimer = setTimeout(() => {
            this.setState({isTyping: false});
            this.typingTimer = null;
        }, 5000);
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

        const giftedChatMessage = utils.sylk2GiftedChat(sylkMessage);
        if (sylkMessage.type === 'status') {
            return;
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
        this.saveConferenceMessage(this.state.remoteUri, giftedChatMessage);
    }

    onSendMessage(messages) {
        if (!this.props.call) {
            return;
        }
        messages.forEach((message) => {
            this.props.sendConferenceMessage(message);
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
                 this.bandwidthDownload = bandwidthDownload;
                 this.bandwidthUpload = bandwidthUpload;

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
            this.postChatSystemMessage(dn, false);
        } else {
            this.postChatSystemMessage('An anonymous guest joined', false);
        }

        this.lookupContact(p.identity._uri, p.identity._displayName);
        if (this.invitedParticipants.has(p.identity._uri)) {
            this.invitedParticipants.delete(p.identity._uri);
        }
        // this.refs.audioPlayerParticipantJoined.play();
        p.on('stateChanged', this.onParticipantStateChanged);
        p.attach();
        p.timestamp = Date.now();
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

        this.postChatSystemMessage(p.identity.uri + ' left', false);
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
        //event.preventDefault();
        if (!this.state.videoEnabled) {
            if (this.state.chatView && !this.state.audioView) {
                this.setState({audioView: !this.state.audioView});
            }
        }
        this.setState({chatView: !this.state.chatView});
    }

    toggleAudioParticipants(event) {
        //event.preventDefault();
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
        //event.preventDefault();
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

    inviteParticipants(uris=[]) {
        if (uris.length === 0) {
            return;
        }
        //console.log('inviteParticipants', uris);
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
        let renderMessages = this.state.renderMessages;
        //renderMessages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);

        renderMessages = renderMessages.sort(function(a, b) {
          if (a.createdAt < b.createdAt) {
            return 1; //nameA comes first
          }

          if (a.createdAt > b.createdAt) {
              return -1; // nameB comes first
          }

          if (a.createdAt === b.createdAt) {
              if (a.msg_id < b.msg_id) {
                return 1; //nameA comes first
              }
              if (a.msg_id > b.msg_id) {
                  return -1; // nameB comes first
              }
          }

          return 0;  // names must be equal
        });

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
        const conferenceContainer = this.state.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
        let chatContainer = this.state.isLandscape ? styles.chatContainerLandscape : styles.chatContainerPortrait;
        if (this.props.audioOnly) {
            chatContainer = this.state.isLandscape ? styles.chatContainerLandscapeAudio : styles.chatContainerPortraitAudio;
        }

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

     if (this.state.videoEnabled && this.state.isLandscape) {
       floatingButtons.push(
          <View style={styles.hangupButtonVideoContainerLandscape}>
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
       }

        if (!this.state.chatView && !this.state.showDrawer && speakerSelectionParticipants.length > 2 && this.state.videoEnabled) {
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

        if (this.state.videoEnabled) {
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

     if (!this.state.videoEnabled ) {
       floatingButtons.push(
          <View style={styles.hangupButtonAudioContainer}>
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
       }

       if (!this.state.videoEnabled && !this.state.isLandscape) {
            /*
               floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    title="Audio"
                    onPress={this.toggleAudioParticipants}
                    icon="account-multiple"
                    key="toggleAudio"
                />
                </TouchableHighlight>
              </View>
            );
            */
        }

       if (this.state.videoEnabled && !this.state.chatView) {
            floatingButtons.push(
              <View style={styles.buttonContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Mute/unmute video"
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcons}
                    key="muteVideoButton"
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

        if (this.state.videoEnabled && !this.state.chatView) {
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

     if (this.state.videoEnabled && !this.state.isLandscape) {
       floatingButtons.push(
          <View style={styles.hangupButtonVideoContainer}>
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
       }

        /*
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
        */

        /*
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
        */

        if (this.props.isLandscape && !this.state.chatView && !this.props.audioOnly) {
            buttons.additional = floatingButtons;
        } else {
            buttons.additional = [];
        }

        /*
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
        */

        /*
        floatingButtons.push(
          <View style={styles.buttonContainer}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                title="spacer"
                key="spacer"
            />
          </View>
        );
        */

        const audioParticipants = [];
        let _contact;
        let _identity;
        let participants_uris = [];

        let sessionButtons = floatingButtons;

        let inviteParticipantsModal = (
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
                    );

        if (this.props.audioOnly) {
            sessionButtons = [];
            buttons.additional = [];

            this.state.participants.forEach((p) => {
                _contact = this.foundContacts.get(p.identity._uri);
                _identity = {uri: p.identity._uri.indexOf('@guest') > -1 ? 'From the web': p.identity._uri,
                             displayName: (_contact && _contact.displayName != p.identity._displayName) ? _contact.displayName : p.identity._displayName,
                             photo: _contact ? _contact.photo: null
                            };

                participants_uris.push(p.identity._uri);

                let status = '';
                let duration = 0;

                if (p.timestamp) {
                    duration = Math.floor(new Date() - p.timestamp) / 1000;
                    if (duration > 3600) {
                        status = moment.duration(new Date() - p.timestamp).format('hh:mm:ss', {trim: false});
                    } else {
                        status = moment.duration(new Date() - p.timestamp).format('mm:ss', {trim: false});
                    }
                }

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={p.id}
                        participant={p}
                        identity={_identity}
                        latency={this.latency.has(p.id) ? this.latency.get(p.id) : null}
                        loss={this.packetLoss.has(p.id) && duration > 10 ? this.packetLoss.get(p.id) : 0}
                        timestamp={p.timestamp}
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

                //console.log('p.status', p.status);

                let extraButtons = [];
                let invite_uris = [];
                invite_uris.push(_uri);

                if (p.status === 'reinvite') {
                    extraButtons.push(
                      <View style={styles.buttonContainer}>
                        <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={25}
                            style={buttonClass}
                            icon={'delete'}
                            onPress={() => this.removeInvitedParticipant(_uri)}
                        />
                        </TouchableHighlight>
                      </View>
                    );
                    extraButtons.push(
                      <View style={styles.buttonContainer}>
                        <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={25}
                            style={buttonClass}
                            icon={'phone'}
                            onPress={() => this.inviteParticipants(invite_uris)}
                        />
                        </TouchableHighlight>
                      </View>
                    );
                }

                audioParticipants.push(
                    <ConferenceAudioParticipant
                        key={_uri}
                        identity={_identity}
                        isLocal={false}
                        status={p.status}
                        extraButtons={extraButtons}
                        supportsVideo={this.state.call ? this.state.call.supportsVideo: false}
                    />
                );
            });

            const audioContainer = this.state.isLandscape ? styles.audioContainerLandscape : styles.audioContainerPortrait;

            audioParticipants.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1)
            _contact = this.foundContacts.get(this.props.call.localIdentity._uri);
            _identity = {uri: this.props.call.localIdentity._uri,
                         displayName: _contact.displayName,
                         photo: _contact.photo
                        };

            participants_uris.push(this.props.call.localIdentity._uri);

            audioParticipants.splice(0, 0,
                <ConferenceAudioParticipant
                    key="myself"
                    participant={null}
                    identity={_identity}
                    isLocal={true}
                    timestamp={Date.now()}
                    extraButtons={floatingButtons}
                    supportsVideo={this.state.call ? this.state.call.supportsVideo: false}
                />
            );

            if (this.state.isLandscape) {
                return (
                <View style={styles.container} >
                    {inviteParticipantsModal}

                    <View style={conferenceContainer}>
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
                        toggleAudioParticipantsFunc={this.toggleAudioParticipants}
                        toggleChatFunc={this.toggleChat}
                        hangUpFunc={this.hangup}
                        audioView={this.state.audioView}
                        chatView={this.state.chatView}
                    />

                        <View style={styles.buttonsContainer}>
                            {sessionButtons}
                        </View>

                        <View style={audioContainer}>
                            <ConferenceAudioParticipantList >
                                {audioParticipants}
                            </ConferenceAudioParticipantList>
                        </View>

                        <View style={chatContainer}>
                            <GiftedChat
                              messages={renderMessages}
                              isTyping={this.state.isTyping}
                              onLongPress={this.onLongMessagePress}
                              onSend={this.onSendMessage}
                              renderCustomView={this.renderCustomView}
                              renderSend={this.renderSend}
                              renderBubble={renderBubble}
                              renderMessageImage={this.renderMessageImage}
                              renderMessageVideo={this.renderMessageVideo}
                              shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
                              alwaysShowSend={true}
                              scrollToBottom
                              lockStyle={styles.lock}
                              inverted={true}
                              timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
                              infiniteScroll
                            />
                        </View>
                    </View>
                </View>
                );

            } else {
                return (
                <View style={styles.container} >
                    {inviteParticipantsModal}

                    <View style={conferenceContainer}>
                        {!this.state.keyboardVisible && !this.props.isLandscape ?
                        <View style={styles.buttonsContainer}>
                            {sessionButtons}
                        </View>
                        : null}

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
                            toggleAudioParticipantsFunc={this.toggleAudioParticipants}
                            toggleChatFunc={this.toggleChat}
                            hangUpFunc={this.hangup}
                            audioView={this.state.audioView}
                            chatView={this.state.chatView}
                        />

                        {!this.state.keyboardVisible ?
                        <Animated.View style = {[{minHeight: this.audioViewMinHeight, flex: 1}, {height: this.state.topHeight}]}>
                            <ConferenceAudioParticipantList >
                                {audioParticipants}
                            </ConferenceAudioParticipantList>
                        </Animated.View>
                        : null}

                        {/* Divider */}
                        <View style={[styles.slider]}{...this._panResponder.panHandlers} >
                            <View style={[styles.dotsContainer, this.state.isDividerClicked ? {backgroundColor: 'white'} : {backgroundColor: 'rgba(52, 52, 52, 0.5)'}]}>
                                <IconButton style={Platform.OS === 'ios' ? styles.dotsiOS : styles.dots}
                                    size={30} title="spacer" key="spacer_one" icon="dots-horizontal"
                                />

                                <IconButton style={Platform.OS === 'ios' ? styles.dotsiOS : styles.dots}
                                    size={30} title="spacer" key="spacer_two" icon="dots-horizontal"
                                />
                           </View>
                       </View>

                        {/* Bottom View */}
                        <Animated.View style={[{minHeight: 150}, {height: this.state.keyboardVisible ? this.chatViewHeight: this.state.bottomHeight}]}>
                            {!this.state.isDividerClicked ?
                            <GiftedChat
                              messages={renderMessages}
                              isTyping={this.state.isTyping}
                              onLongPress={this.onLongMessagePress}
                              renderCustomView={this.renderCustomView}
                              onSend={this.onSendMessage}
                              renderSend={this.renderSend}
                              renderBubble={renderBubble}
                              renderMessageImage={this.renderMessageImage}
                              renderMessageVideo={this.renderMessageVideo}
                              shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
                              alwaysShowSend={true}
                              lockStyle={styles.lock}
                              scrollToBottom
                              inverted={true}
                              timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
                              infiniteScroll
                            />
                            : null}

                        </Animated.View>
                    </View>
                 </View>
                );
            }
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

        if (this.state.callOverlayVisible) {
            buttons.bottom = floatingButtons;
            buttons.additional = [];
        }

        return (
            <View style={styles.container}>
                {inviteParticipantsModal}

                <View style={conferenceContainer}>
                    {this.state.callOverlayVisible || this.state.chatView ?
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
                        toggleAudioParticipantsFunc={this.toggleAudioParticipants}
                        toggleChatFunc={this.toggleChat}
                        hangUpFunc={this.hangup}
                        audioView={this.state.audioView}
                        chatView={this.state.chatView}
                    />
                    : null}

                    <TouchableWithoutFeedback onPress={this.showOverlay}>
                        <View style={[styles.videosContainer, this.state.isLandscape ? styles.landscapeVideosContainer: null]}>
                            {videos}
                        </View>
                    </TouchableWithoutFeedback>

                    {this.state.chatView ?
                    <View style={chatContainer}>
                        <GiftedChat
                          messages={renderMessages}
                          isTyping={this.state.isTyping}
                          renderCustomView={this.renderCustomView}
                          onLongPress={this.onLongMessagePress}
                          onSend={this.onSendMessage}
                          renderBubble={renderBubble}
                          renderMessageImage={this.renderMessageImage}
                          renderMessageVideo={this.renderMessageVideo}
                          renderSend={this.renderSend}
                          shouldUpdateMessage={(props, nextProps) => { return (!_.isEqual(props.currentMessage, nextProps.currentMessage)); }}
                          scrollToBottom
                          inverted={true}
                          timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
                          infiniteScroll
                        />
                    </View>
                    :
                    <View style={styles.carouselContainer}>
                        <ConferenceCarousel align={'right'}>
                            {participants}
                        </ConferenceCarousel>
                    </View>
                    }

                </View>

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
    saveConferenceMessage: PropTypes.func,
    updateConferenceMessage : PropTypes.func,
    deleteConferenceMessage : PropTypes.func,
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
    fileSharingUrl      : PropTypes.string,
    sendConferenceMessage: PropTypes.func,
    conferenceSliderPosition: PropTypes.number,
    saveSliderFunc: PropTypes.func
};

export default ConferenceBox;
