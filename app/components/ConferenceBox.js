'use strict';

import React, {useState, Component, Fragment} from 'react';
import { Clipboard, Platform, TouchableOpacity, Dimensions, SafeAreaView, ScrollView, FlatList, TouchableHighlight, Switch} from 'react-native';
import PropTypes from 'prop-types';
import * as sylkrtc from 'react-native-sylkrtc';
import classNames from 'classnames';
import debug from 'react-native-debug';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Appbar, Portal, Modal, Surface, Paragraph, Text } from 'react-native-paper';
import { View, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView} from 'react-native';
import { GiftedChat, Bubble, MessageText, Send, MessageImage } from 'react-native-gifted-chat'
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import VideoPlayer from 'react-native-video-player';
import Immersive from 'react-native-immersive';
import { getStatusBarHeight } from 'react-native-status-bar-height';

import { useEffect, useRef } from 'react';

import uuid from 'react-native-uuid';

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
import ConferenceAudioParticipantList from './ConferenceAudioParticipantList';
import ConferenceAudioParticipant from './ConferenceAudioParticipant';
import {renderBubble } from './ContactsListBox';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import KeyboardSpacer from 'react-native-keyboard-spacer';

import xss from 'xss';
import * as RNFS from 'react-native-fs';
import RNBackgroundDownloader from '@kesha-antonov/react-native-background-downloader'

import md5 from "react-native-md5";
import FileViewer from 'react-native-file-viewer';
import _ from 'lodash'; import { produce } from "immer"
import moment from 'moment';
import {StatusBar} from 'react-native';

import styles from '../assets/styles/ConferenceCall';

const DEBUG = debug('blinkrtc:ConferenceBox');
//debug.enable('*');

const MAX_POINTS = 30;

function appendBits(bits) {
    let i = -1;
    const byteUnits = 'kMGTPEZY';
    do {
        bits = bits / 1000;
        i++;
    } while (bits > 1000);

    return `${Math.max(bits, 0.1).toFixed(bits < 100 ? 1 : 0)} ${byteUnits[i]}bits/s`;
};

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

function useLogChanges(label, value) {
  const prevValue = usePrevious(value);
  useEffect(() => {
    if (prevValue !== undefined && JSON.stringify(prevValue) !== JSON.stringify(value)) {
      console.log(`--- ${label} changed ---`);
      console.log('previous:', prevValue);
      console.log('current:', value);
    }
  }, [value]);
}

const conferenceHeaderHeight = 60;

  const availableAudioDevicesIconsMap = {
	BUILTIN_EARPIECE: 'phone',
	WIRED_HEADSET: 'headphones',
	BLUETOOTH_SCO: 'bluetooth-audio',
	BUILTIN_SPEAKER: 'volume-high',
  };


class ConferenceBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        
        this.prevValues = {};

        this.downloadRequests = {};

        this.packetLoss = new Map();

        this.latency = new Map();

        this.mediaLost = new Map();

        this.sampleInterval = 1;

        this.typingTimer = null;
        
        this.myself = null;

        let renderMessages = [];
        this.participantStats = {};
        if (this.props.remoteUri in this.props.messages) {
            renderMessages = this.props.messages[this.props.remoteUri];
        }

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
            myVideoCorner: 'bottomRight',
            enableMyVideo: true,
            offset          : 0,
            statistics: [],
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
		    insets: this.props.insets,
		    publicUrl: this.props.publicUrl
        };

        const friendlyName = this.state.remoteUri ? this.state.remoteUri.split('@')[0] : '';
        //if (window.location.origin.startsWith('file://')) {
            this.conferenceUrl = `${this.state.publicUrl}/conference/${friendlyName}`;
        //} else {
        //    this.conferenceUrl = `${window.location.origin}/conference/${friendlyName}`;
        //}

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
        //console.log('Initial call duration', duration);

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

	componentDidUpdate(prevProps, prevState) {
	     if (this.state.insets != prevState.insets) {
			//console.log(' --- CB insets did change', this.state.insets);
			let { width, height } = Dimensions.get('window');
			//console.log('width', width);
			//console.log('height', height);
	     }

	     if (this.state.isLandscape != prevState.isLandscape) {
			let { width, height } = Dimensions.get('window');
			//console.log('width', width);
			//console.log('height', height);
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

        this.fullScreenTimer();

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
        //this.props.call.statistics.on('stats', this.statistics);
    }
    
    get fullScreen() {
		return !this.state.callOverlayVisible;
	}
        
    get conferenceStarted() {
		return this.state.participants.length > 0;
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
        //this.props.call.statistics.removeListener('stats', this.statistics);
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
        
        if ('enableMyVideo' in nextProps) {
            this.setState({enableMyVideo: nextProps.enableMyVideo});
        }

        this.setState({terminated: nextProps.terminated,
                       remoteUri: nextProps.remoteUri,
                       renderMessages: GiftedChat.append(this.state.renderMessages, renderMessages),
                       isLandscape: nextProps.isLandscape,
                       messages: nextProps.messages,
                       offset: nextProps.offset,
                       activeDownloads: nextProps.activeDownloads,
                       accountId: !this.state.accountId && nextProps.call ? this.props.call.account.id : this.state.accountId,
                       selectedContacts: nextProps.selectedContacts,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   publicUrl: nextProps.publicUrl
                       });

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
        let dir = RNFS.DocumentDirectoryPath + '/' + this.state.accountId + '/conference/' + this.state.remoteUri + '/files';
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
        const { size } = await ReactNativeBlobUtil.fs.stat(stats_filename);

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
        //console.log('--- List shared files');

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
            }).begin((tinfo) => {
	            if (tinfo.expectedBytes) {
                    this.updateFileMessage(metadata.transfer_id, 0);
                    console.log(metadata.name, 'will download', expectedBytes, 'bytes');
                }
            }).progress((pdata) => {
				if (pdata && pdata.bytesDownloaded && pdata.bytesTotal) {
					const percent = pdata.bytesDownloaded/pdata.bytesTotal * 100;
					const progress = Math.ceil(percent);
					file_transfer.progress = progress;
                    this.updateFileMessage(metadata.transfer_id, progress);
				}
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

     onParticipantJoined(p) {
        //console.log(p.identity.uri, 'joined the conference');
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
        this.fullScreenTimer();
    }

	async getConnectionStats() {
		try {
			// --- Initialize all maps if they don’t exist
			this.audioBytesReceived = this.audioBytesReceived || new Map();
			this.videoBytesReceived = this.videoBytesReceived || new Map();
			this.audioBandwidth = this.audioBandwidth || new Map();
			this.videoBandwidth = this.videoBandwidth || new Map();
			this.audioPacketLoss = this.audioPacketLoss || new Map();
			this.videoPacketLoss = this.videoPacketLoss || new Map();
			this.packetLoss = this.packetLoss || new Map();
			this.latency = this.latency || new Map();
			this.mediaLost = this.mediaLost || new Map();
	
			if (this.state.participants.length === 0) {
				// console.log("No participants, resetting bandwidth");
				this.bandwidthDownload = 0;
				this.bandwidthUpload = 0;
				this.videoBandwidth.set('total', 0);
				this.audioBandwidth.set('total', 0);
				return;
			}
	
			const participants = this.state.participants.concat(this.props.call);
			// console.log("Participants to process:", participants.length);
	
			for (const p of participants) {
				if (!p._pc) {
					// console.log("Skipping participant with no peer connection:", p.id || p);
					continue;
				}
	
				const identity = p.identity ? p.identity.uri : 'myself';
				// console.log("Processing participant:", identity);
	
				// Ensure per-participant map entries
				if (!this.audioBytesReceived.has(p.id)) this.audioBytesReceived.set(p.id, 0);
				if (!this.videoBytesReceived.has(p.id)) this.videoBytesReceived.set(p.id, 0);
				if (!this.audioBandwidth.has(p.id)) this.audioBandwidth.set(p.id, 0);
				if (!this.videoBandwidth.has(p.id)) this.videoBandwidth.set(p.id, 0);
				if (!this.latency.has(p.id)) this.latency.set(p.id, 0);
				if (!this.audioPacketLoss.has(p.id)) this.audioPacketLoss.set(p.id, 0);
				if (!this.videoPacketLoss.has(p.id)) this.videoPacketLoss.set(p.id, 0);
				if (!this.packetLoss.has(p.id)) this.packetLoss.set(p.id, 0);
	
				try {
					const stats = await p._pc.getStats();
					// console.log("Stats received for", identity, stats.size);
	
					let audioPackets = 0,
						videoPackets = 0,
						audioPacketsLost = 0,
						videoPacketsLost = 0;
	
					let totalPackets = 0,
						totalPacketsLost = 0;
	
					let totalAudioBandwidth = 0,
						totalVideoBandwidth = 0,
						bandwidthUpload = 0;
	
					stats.forEach(report => {
						try {
							const kind = report.kind; // "audio" or "video"
	
							// --- Inbound media (received from remote)
							if (report.type === "inbound-rtp" && identity !== 'myself') {
								const { bytesReceived, packetsReceived, packetsLost } = report;
								if (bytesReceived !== undefined) {
									const lastBytes = kind === 'audio'
										? this.audioBytesReceived.get(p.id)
										: this.videoBytesReceived.get(p.id);
									const diff = bytesReceived - lastBytes;
									const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
									if (kind === 'audio') {
										totalAudioBandwidth += speed;
										this.audioBandwidth.set(p.id, speed);
										this.audioBytesReceived.set(p.id, bytesReceived);
									} else if (kind === 'video') {
										totalVideoBandwidth += speed;
										this.videoBandwidth.set(p.id, speed);
										this.videoBytesReceived.set(p.id, bytesReceived);
									}
									// console.log(`[${identity}] ${kind} inbound speed: ${speed} kbps`);
								}
	
								if (packetsReceived !== undefined && packetsLost !== undefined) {
									totalPackets += packetsReceived;
									totalPacketsLost += packetsLost;
									if (kind === 'audio') {
										audioPackets += packetsReceived;
										audioPacketsLost += packetsLost;
									} else if (kind === 'video') {
										videoPackets += packetsReceived;
										videoPacketsLost += packetsLost;
									}
									// console.log(`[${identity}] ${kind} inbound packets received: ${packetsReceived}, lost: ${packetsLost}`);
								}
							}
	
							// --- Outbound media (sent by us)
							if (report.type === "outbound-rtp" && identity === 'myself') {
								const { bytesSent, packetsSent } = report;
								if (bytesSent !== undefined) {
									const lastBytes = kind === 'audio'
										? this.audioBytesReceived.get(p.id)
										: this.videoBytesReceived.get(p.id);
									const diff = bytesSent - lastBytes;
									const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
									bandwidthUpload += speed;
									if (kind === 'audio') this.audioBandwidth.set(p.id, speed);
									else if (kind === 'video') this.videoBandwidth.set(p.id, speed);
									if (kind === 'audio') this.audioBytesReceived.set(p.id, bytesSent);
									else this.videoBytesReceived.set(p.id, bytesSent);
									// console.log(`[${identity}] ${kind} outbound speed: ${speed} kbps`);
								}
	
								if (packetsSent !== undefined) {
									totalPackets += packetsSent;
									// console.log(`[${identity}] ${kind} outbound packets sent: ${packetsSent}`);
								}
							}
	
							// --- Latency / RTT
							if ((report.type === "remote-inbound-rtp" || report.type === "transport") && report.roundTripTime !== undefined) {
								const delay = report.roundTripTime * 1000; // ms
								this.latency.set(p.id, Math.ceil(delay));
								// console.log(`[${identity}] RTT from ${report.type}: ${delay.toFixed(2)} ms`);
							}
	
							if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime !== undefined) {
								const delay = report.currentRoundTripTime * 1000;
								this.latency.set(p.id, Math.ceil(delay));
								// console.log(`[${identity}] RTT from candidate-pair: ${delay.toFixed(2)} ms`);
							}
	
						} catch (err) {
							console.warn("Error processing report", report.type, err);
						}
					});
	
					// --- Compute packet loss %
					const audioPacketLoss = audioPackets > 0 ? Math.floor(audioPacketsLost / audioPackets * 100) : 100;
					const videoPacketLoss = videoPackets > 0 ? Math.floor(videoPacketsLost / videoPackets * 100) : 100;
					const totalPacketLoss = totalPackets > 0 ? Math.floor(totalPacketsLost / totalPackets * 100) : 100;
	
					this.audioPacketLoss.set(p.id, audioPacketLoss);
					this.videoPacketLoss.set(p.id, videoPacketLoss);
					this.packetLoss.set(p.id, totalPacketLoss);
	
					// --- Update totals
					this.bandwidthDownload = totalAudioBandwidth + totalVideoBandwidth;
					this.bandwidthUpload = bandwidthUpload;
					this.videoBandwidth.set('total', totalVideoBandwidth);
					this.audioBandwidth.set('total', totalAudioBandwidth);
	
					// console.log(`[${identity}] audio loss: ${audioPacketLoss}%, video loss: ${videoPacketLoss}%, total loss: ${totalPacketLoss}%`);
					// console.log(`[${identity}] audio bandwidth: ${totalAudioBandwidth} kbps, video bandwidth: ${totalVideoBandwidth} kbps`);
					// console.log(`[${identity}] latency: ${this.latency.get(p.id)} ms`);
	
				} catch (err) {
					console.error("Error getting stats for participant", identity, err);
				}
			}
		} catch (err) {
			console.error("Error in getConnectionStats", err);
		}
	}

    onParticipantLeft(p) {
        console.log(p.identity.uri, 'left the conference');
        const participants = this.state.participants.slice();

        this.latency.delete(p.id);
        this.packetLoss.delete(p.id);
        this.mediaLost.delete(p.id);
        
        //console.log(this.participantStats);
        
		if (this.participantStats[p.id]) {
			delete this.participantStats[p.id];
		}

        const idx = participants.indexOf(p);
        if (idx !== -1) {
            participants.splice(idx, 1);
            this.setState({
                participants: participants
            });
        }
        
        p.detach(true);
        // this.changeResolution();

        setTimeout(() => {
			this.exitFullScreenIfAlone();
		}, 100);

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

    handleShareOverlayEntered() {
        this.setState({shareOverlayVisible: true});
    }

    handleShareOverlayExited() {
        this.setState({shareOverlayVisible: false});
    }

    toggleMyVideo() {
        this.setState({enableMyVideo: !this.state.enableMyVideo});    
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

	toggleAudioDevice() {
		console.log('toggleAudioDevice');
	
		const devices = this.props.availableAudioDevices;
		const current = this.props.selectedAudioDevice;
	
		if (!devices || devices.length === 0) return;
	
		// Find current index
		const currentIndex = devices.indexOf(current);
	
		// Compute next index (wrap around)
		const nextIndex = (currentIndex + 1) % devices.length;
	
		// Select next device
		const nextDevice = devices[nextIndex];
	
		console.log('Switching audio device to:', nextDevice);
		this.props.selectAudioDevice(nextDevice);
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

    fullScreenTimer() {
        if (this.props.audioOnly) {
            return;
        }

		clearTimeout(this.overlayTimer);

        if (this.state.participants.length > 0 && !this.state.chatView) {
            this.overlayTimer = setTimeout(() => {
                if (!this.state.chatView) {
					this.setState({callOverlayVisible: false});
					StatusBar.setHidden(true, 'fade');   // hide
					if (Platform.OS === 'android') {
						Immersive.on();
						this.props.enableFullScreen();
					}
				}
            }, 15000);
        }
    }

    toggleFullScreen() {
		//console.log(' --toggleFullScreen');
		if (this.state.callOverlayVisible && !this.state.chatView && !this.props.audioOnly && this.conferenceStarted) {			
			this.setState({callOverlayVisible: !this.state.callOverlayVisible});
			StatusBar.setHidden(true, 'fade');   // hide
			if (Platform.OS === 'android') {
				Immersive.on();
				this.props.enableFullScreen();
			}
			
			this.fullScreenTimer();
		} else {
			this.setState({callOverlayVisible: true});
			StatusBar.setHidden(false, 'fade');   // hide
			if (Platform.OS === 'android') {
				Immersive.off();
				this.props.disableFullScreen();

			}
		}
    }

    exitFullScreenIfAlone() {
        if (this.state.participants.length > 0) {
            console.log('Still not alone');
			return;
        } 

		clearTimeout(this.overlayTimer);

		this.setState({callOverlayVisible: true});
		StatusBar.setHidden(false, 'fade');
		if (Platform.OS === 'android') {
			Immersive.off();
			this.props.disableFullScreen();
		}
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
    
    get amIspeaker() {
		return this.state.activeSpeakers.some(speaker => {
			return speaker.identity && speaker.identity._uri === this.state.accountId;
		});
	}

    get showMyself() {
        if (this.state.chatView && !this.props.audioOnly) {
			return true;
        }

		if (this.state.participants.length == 3) {
			return false;
		}
		
		if (this.amIspeaker) {
			return false;		
		}
		
		if (!this.state.enableMyVideo) {
			return false;
		}
				
		if (this.state.showDrawer) {
			return false;
		}
		        
        return !this.state.videoMuted && !this.state.chatView;
    }
    
	getVideoLayout() {
		const count = Math.min(this.state.participants.length, 4); // max 4 participants
		const isLandscape = this.state.isLandscape;
	
		let container = {};
		let item = {};
	
		switch (count) {
			case 1:
				container = { flexDirection: 'column', flexWrap: 'nowrap', justifyContent: 'center', alignItems: 'center' };
				item = { width: '100%', height: '100%' };
				break;
			case 2:
				if (isLandscape) {
					// 2 participants → 2 columns
					container = { flexDirection: 'row', flexWrap: 'nowrap' };
					item = { width: '50%', height: '100%' };
				} else {
					// 2 participants → 2 rows
					container = { flexDirection: 'column', flexWrap: 'nowrap' };
					item = { width: '100%', height: '50%' };
				}
				break;
			case 3:
			case 4:
			default:
				// Always 2x2 grid
				container = { flexDirection: 'row', flexWrap: 'wrap' };
				item = { width: '50%', height: '50%' };
				break;
		}
	
		return { container, item };
	}

	renderAudioDeviceButtons() {
	  return null; 
	  const { availableAudioDevices, selectedAudioDevice, call } = this.state;
	  
	  if (!this.state.callOverlayVisible) {
		 return null;
	  }
	
	  if (!call || call.state !== 'established') {
		 return null;
	  }
	 
	  if (this.props.useInCallManger) {
		 return null;
	  }

      if (!availableAudioDevices) {
		  return null;
      }
	  
	  return (
		<View style={styles.audioDeviceContainer}>
		  {availableAudioDevices.map((device) => {
			const icon = availableAudioDevicesIconsMap[device];
			if (!icon) return null;
	
			const isSelected = device === selectedAudioDevice;
	
		return (
		  <View
			key={device}
			style={[
			  styles.audioDeviceButtonContainer,
			  isSelected && styles.audioDeviceSelected
			]}
		  >
			<TouchableHighlight>
			  <IconButton
				size={25}
				style={styles.audioDeviceWhiteButton}
				icon={icon}
				onPress={() => this.props.selectAudioDevice(device)}
			  />
			</TouchableHighlight>
			  </View>
			);
		  })}
		</View>
	  );
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

        const muteButtonIcon = this.state.audioMuted ? 'microphone-off' : 'microphone';
        const muteVideoButtonIcon = this.state.videoMuted ? 'video-off' : 'video';
        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;
        
        let unselectItem = {id: 'none', publisherId: null, identity: {uri: 'none', displayName: 'No speaker'}};

        // populate speaker selection list only with participants that have video
        let speakerSelectionParticipants = [];
        this.state.participants.forEach((p) => {
            if (p.streams && p.streams.length > 0) {
//                if (p.streams[0].getVideoTracks().length > 0) {
  //                  let track = p.streams[0].getVideoTracks()[0];
                    speakerSelectionParticipants.push(p);
//                }
            }
        });

        //console.log('Number of possible speakers with video enabled', speakerSelectionParticipants.length);

        let myself = {id: this.props.call.id, publisherId: this.props.call.id, identity: this.props.call.localIdentity};

        speakerSelectionParticipants.push(myself);
        speakerSelectionParticipants.push(unselectItem);

        //console.log('----speakerSelectionParticipants', speakerSelectionParticipants);
        const floatingButtons = [];

        /*
        if (!this.state.showDrawer && speakerSelectionParticipants.length > 3 && this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="selects">
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
        
        */
        
        if (this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="chat">
                <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={this.state.videoEnabled ? 25 : 25}
                    style={buttonClass}
                    title="Chat"
                    onPress={this.toggleChat}
                    icon={!this.state.chatView ? "chat" : "chat-remove"} // toggle icon
                    key="toggleChat"
                />
                </TouchableHighlight>
              </View>
            );

        if (this.props.useInCallManger) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key='recon'>
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
        } else {

            floatingButtons.push(
              <View style={styles.buttonContainer} key="audioDevice">
                <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Device"
                    onPress={this.toggleAudioDevice}
                    icon={availableAudioDevicesIconsMap[this.state.selectedAudioDevice]} // toggle icon
                    key="toggleAudioDevice"
                />
                </TouchableHighlight>
              </View>
            );
            
        }

       }

     if (!this.state.videoEnabled ) {
       floatingButtons.push(
          <View style={styles.hangupButtonAudioContainer} key="leave">
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

        floatingButtons.push(
              <View style={styles.buttonContainer} key="Mute">
                  <TouchableHighlight style={styles.roundshape}>
            <IconButton
                size={this.state.videoEnabled ? 25 : 25}
                style={buttonClass}
                title="Mute/unmute audio"
                onPress={this.muteAudio}
                icon={muteButtonIcon}
                key="muteAudioButton"
            />
                </TouchableHighlight>
              </View>
        );

       if (this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key="mutev">
                <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Mute/unmute video"
                    onPress={this.muteVideo}
                    icon={muteVideoButtonIcon}
                    key="muteVideoButton"
                />
                </TouchableHighlight>
              </View>
            );
        }

        if (this.state.videoEnabled) {
            floatingButtons.push(
              <View style={styles.buttonContainer} key='toggleCamerag'>
                  <TouchableHighlight style={styles.roundshape}>
                <IconButton
                    size={25}
                    style={buttonClass}
                    title="Toggle camera"
                    onPress={this.toggleCamera}
                    icon='camera-switch'
                    key="toggleVideo"
                />
                </TouchableHighlight>
              </View>
            );
        }

     if (this.state.videoEnabled) {
       floatingButtons.push(
          <View style={styles.hangupButtonVideoContainer} key='leavec'>
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

        if (this.props.isLandscape && !this.props.audioOnly) {
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

        let callUrl = callUrl = this.state.publicUrl + "/call/" + this.state.accountId;
        const friendlyName = this.state.remoteUri ? this.state.remoteUri.split('@')[0] : '';
        const conferenceUrl = `${this.state.publicUrl}/conference/${friendlyName}`;

        //console.log(this.state.publicUrl);
        let container = styles.container;

		let { width, height } = Dimensions.get('window');

		let mediaContainer = this.state.isLandscape ? styles.audioContainerLandscape : styles.audioContainer;
		let conferenceContainer = this.state.isLandscape ? styles.conferenceContainerLandscape : styles.conferenceContainer;
		let chatContainer = this.state.isLandscape ? styles.chatContainerLandscape : styles.chatContainer;
		let conferenceHeader = styles.conferenceHeader;

		const topInset = this.state.insets?.top || 0;
		const bottomInset = this.state.insets?.bottom || 0;
		const leftInset = this.state.insets?.left || 0;
		const rightInset = this.state.insets?.right || 0;
		let debugBorderWidth = 0;
		
		if (this.props.audioOnly) {
			chatContainer = this.state.isLandscape ? styles.chatContainerLandscapeAudio : styles.chatContainerPortraitAudio;
		}

        if (this.props.audioOnly) {
            sessionButtons = [];
            buttons.additional = [];

            this.state.participants.forEach((p) => {
                _contact = this.foundContacts.get(p.identity._uri);
                _identity = {uri: p.identity._uri.indexOf('@guest') > -1 ? 'From the web': p.identity._uri,
                             key: p.identity._uri,
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
                
                //console.log('Push', p.id);
                //console.log(this.latency);
                //console.log(this.packetLoss);

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
                    />
                );
            });
            
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
                />
            );

			//console.log('topInset', topInset);
			//console.log('bottomInset', bottomInset);

			const marginRight = this.state.isLandscape && Platform.OS === 'android' ? 48 : 0;
			const marginBottom = this.state.isLandscape && Platform.OS === 'android' ? -48 : 0;

			let audioHeight = this.state.renderMessages.length < 6 ? 300 : 240; 
			audioHeight = this.state.keyboardVisible ? 150 : audioHeight;
			const marginTop = Platform.OS === 'ios' ? topInset : 0;
			
			debugBorderWidth = 0;

			container = {
				flex: 1,
				flexDirection: 'column',
	            borderWidth: debugBorderWidth,
			    borderColor: 'white',
 		    };

  		    conferenceHeader = {
			  height: conferenceHeaderHeight,
	          borderWidth: debugBorderWidth,
			  borderColor: 'yellow'
		    };

            if (Platform.OS === 'ios' ) { 
                if (this.state.isLandscape) {
					conferenceHeader.width = width - rightInset - leftInset;
					//container.width = width - topInset;
                }
            }

			conferenceContainer = {
			  flex: 1,
			  flexDirection: this.state.isLandscape ? 'row' : 'column',
			  alignContent: this.state.isLandscape ? 'flex-end' : 'flex-start',
			  justifyContent: this.state.isLandscape ? 'flex-start' : 'flex-start',
	          borderWidth: debugBorderWidth,
			  borderColor: 'blue'
			};
						
		    mediaContainer = {
			  width: this.state.isLandscape ? '50%' : '100%',
			  height: this.state.isLandscape ? '100%' : audioHeight,
	          borderWidth: debugBorderWidth,
			  borderColor: 'green'
			};
			
			chatContainer = {
			  flex: this.state.isLandscape ? 0 : 1,
			  borderColor: 'gray',
			  width: this.state.isLandscape ? '50%' : '100%',
	          borderWidth: debugBorderWidth,
			  borderColor: 'gray'
			};
			
			const insets = this.state.insets;

			if (debugBorderWidth) {
				const values = {
				  topInset,
				  bottomInset,
				  leftInset,
				  rightInset,
				  container,
				  conferenceHeader,
				  buttonsContainer,
				  conferenceContainer,
				  mediaContainer,
				  chatContainer,
				  insets				  
				};

				const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
			
				Object.entries(values).forEach(([key, value]) => {
				  const prev = this.prevValues[key];
				   const paddedKey = key.padStart(maxKeyLength, ' '); // right
				  if (JSON.stringify(prev) !== JSON.stringify(value)) {
					console.log(paddedKey, value);
				  }
				});
	
				this.prevValues = values;
			}

			return (
			   <View 
			        key={this.state.isLandscape ? 'landscape' : 'portrait'}
			        style={container}>

				<ShareConferenceLinkModal
					notificationCenter={this.props.notificationCenter}
					show={this.state.showInviteModal && !this.state.reconnectingCall}
					close={this.toggleInviteModal}
					conferenceUrl={conferenceUrl}
				/>

				<View style={conferenceHeader}>
					<ConferenceHeader
					    visible={true}
					    height={conferenceHeader.height}
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
						info={this.state.info}
						goBackFunc={this.props.goBackFunc}
						toggleInviteModal={this.toggleInviteModal}
						inviteToConferenceFunc={this.props.inviteToConferenceFunc}
						callState={this.props.callState}
						toggleAudioParticipantsFunc={this.toggleAudioParticipants}
						toggleChatFunc={this.toggleChat}
						hangUpFunc={this.hangup}
						audioView={this.state.audioView}
						chatView={this.state.chatView}
						toggleDrawer={this.toggleDrawer}
						enableMyVideo={this.state.enableMyVideo}
						toggleMyVideo={this.toggleMyVideo}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						insets = {this.state.insets}
						useInCallManger = {this.props.useInCallManger}
					/>
				</View>

				<View style={[styles.buttonsContainer]}>
					{sessionButtons}
				</View>

				<View style={conferenceContainer}>
					{this.props.isLandscape ? null : this.renderAudioDeviceButtons()}

					<View style={mediaContainer}>
                    { true && (
						<ConferenceAudioParticipantList >
							{audioParticipants}
						</ConferenceAudioParticipantList>
					) }
					</View>

				{Platform.OS === 'android'?	
					<KeyboardAvoidingView
					  key={this.state.isLandscape ? 'landscape' : 'portrait'} // re-layout when rotate or keyboard changes
					  style={chatContainer}
					  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
					  keyboardVerticalOffset={conferenceHeaderHeight + topInset} // adjust if you have a header
					>
					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
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
				   </KeyboardAvoidingView>
				 :

				 <View style={chatContainer}>
					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
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
				 } 

				</View>
			</View>
			);
        }

		const participants = [];
		const drawerParticipants = [];

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
		    /*
			videos.push(
			</View>
				// Parent wrapper
				<View style={{ flex: 1 }}>
					<RTCView
						key="self"
						objectFit="cover"
						style={{ flex: 1 }}
						ref="largeVideo"
						poster="assets/images/transparent-1px.png"
						streamURL={this.state.largeVideoStream ? this.state.largeVideoStream.toURL() : null}
					/>
				</View>
			);
			*/

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
								isLandscape={this.state.isLandscape}
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
			    //console.log('====='); 
				let vtrack;
				if (this.state.participants.length == 3) {
					//console.log('Added video of myself');
					videos.push(
						<ConferenceParticipantSelf
						  key="myself2"
						  visible={true}
						  stream={this.props.call.getLocalStreams()[0]}
						  identity={this.props.call.localIdentity}
						  audioMuted={this.state.audioMuted}
						  isLandscape={this.state.isLandscape}
						  generatedVideoTrack={this.props.generatedVideoTrack}
						  big={true}
						/>
					);
				}

				this.state.participants.forEach((p, idx) => {
					status = '';
					if (this.mediaLost.has(p.id) && this.mediaLost.get(p.id)) {
						status = 'Muted';
						//console.log(p.identity.uri, 'media lost');
					} else if (this.packetLoss.has(p.id) && this.packetLoss.get(p.id) > 3) {
						if (this.packetLoss.get(p.id) === 100) {
							status = 'No media';
							console.log(p.identity.uri, 'has no media');
						} else {
							status = this.packetLoss.get(p.id) + '% loss';
							//console.log(p.identity.uri, 'has packet loss', status);
						}
					} else if (this.latency.has(p.id) && this.latency.get(p.id) > 100) {
						status = this.latency.get(p.id) + ' ms';
					}

					if (p.streams && p.streams.length > 0) {
						if (p.streams[0].getVideoTracks().length > 0) {
							vtrack = p.streams[0].getVideoTracks()[0];
							//console.log(vtrack);
							if (vtrack.muted) {
								//console.log(p.identity.uri, 'has video explicitly muted');
								//return;
							}
						}
					}
					//console.log(p.identity.uri, 'video added');
					videos.push(
						<ConferenceMatrixParticipant
							key = {p.id}
							participant = {p}
							pauseVideo={(idx >= 4)}
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
								isLandscape={this.state.isLandscape}
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
	
			const currentParticipants = this.state.participants.map((p) => {return p.identity.uri})
			const alreadyInvitedParticipants = this.invitedParticipants ? Array.from(this.invitedParticipants.keys()) : [];		
		}

		if (this.state.callOverlayVisible) {
			buttons.bottom = floatingButtons;
			buttons.additional = [];
		}

		let corners = {
			  topLeft: { top: 0, left: 0 },
			  topRight: { top: 0, right: 0 },
			  bottomRight: { bottom: 0, right: 0 },
			  bottomLeft: { bottom: 0, left: 0},
			  id: 'init'
		};

		let buttonsContainer = this.state.isLandscape ? styles.buttonsContainerLandscape : styles.buttonsContainer;
		mediaContainer = this.state.isLandscape? styles.videoContainerLandscape : styles.videoContainer;
        
		const marginRight = this.state.isLandscape ? rightInset : 0;
		const marginBottom = this.state.isLandscape  ? -rightInset : 0;

		let audioHeight = this.state.renderMessages.length < 6 ? 300 : 240; 
		audioHeight = this.state.keyboardVisible ? 150 : audioHeight;

		const statusBarHeight = getStatusBarHeight(); 

		let navigationBarHeight = 0;

		if (Platform.OS === 'android') {
            navigationBarHeight = bottomInset;
        }

        const videoGridContainer = styles.videoGridContainer;

		debugBorderWidth = 0;

		container = {
			flex: 1,
			flexDirection: 'column',
			borderWidth: debugBorderWidth,
			borderColor: 'red',
		};

		conferenceHeader = {
		  height: conferenceHeaderHeight,
		  borderWidth: debugBorderWidth,
		  borderColor: 'white'		  
		};

		buttonsContainer = {
			position: 'absolute',
			top: conferenceHeader.height,
			height: conferenceHeaderHeight,
			left: 0,
			right: 0,
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 1000,
			borderWidth: debugBorderWidth,
			borderColor: 'pink'
		};

		conferenceContainer = {
		  flex: 1,
		  flexDirection: this.state.isLandscape ? 'row' : 'column',
		  alignContent: this.state.isLandscape ? 'flex-end' : 'flex-start',
		  justifyContent: this.state.isLandscape ? 'flex-start' : 'flex-start',
		  marginTop: this.fullscreen ? -topInset: 0,
		  borderColor: 'blue',
		  borderWidth: debugBorderWidth,
		  marginBottom: 0,
//		  height: this.fullScreen ? height + bottomInset + topInset: height,
		  position: 'relative'
		};
					
		let videoWidth = this.state.chatView ? '50%' : '100%' ;

		mediaContainer = {
		  position: 'absolute',
		  resizeMode: 'cover',
		  height:  '100%',
		  width: '100%',
		  borderWidth: debugBorderWidth,
		  borderColor: 'white',
		};	
					
		let top = 0;
	    //console.log('width', width);
	    //console.log('height', height);
	    
		chatContainer = {
			...(this.state.isLandscape ? {} : {flex: 1}),
		  borderWidth: 0,
		  borderColor: 'gray',
		  width: '100%',
		};
	    
        if (Platform.OS === 'ios') {
		    if (this.state.isLandscape) {
		        if (this.fullScreen) {
				    corners = {
						  topLeft: { top: 0, left: 0 },
						  topRight: { top: 0, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'ios-landscape'
					};

					container = {
						width: this.fullScreen ? width: width,
						height: height,
						marginLeft: -rightInset,
						marginBottom: marginBottom,
						borderWidth: debugBorderWidth,
						borderColor: 'blue'
					};

		        } else {
				    corners = {
						  topLeft: { top: conferenceHeader.height, left: 0 },
						  topRight: { top: conferenceHeader.height, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'ios-landscape'
						};

					container = {
						width: width - rightInset,
						height: height,
						marginBottom: marginBottom,
						borderWidth: debugBorderWidth,
						borderColor: 'blue'
					};

					conferenceContainer = {
					  flexDirection: 'row',
					  alignContent: 'flex-start',
					  justifyContent: 'flex-start',
					  height: height - conferenceHeader.height,
					  width: width - rightInset,
					  borderColor: 'green',
					  borderWidth: debugBorderWidth,
					};

					mediaContainer = {
					  width: this.state.isLandscape ? videoWidth : '100%',
					  height: height - topInset + 30,
					  borderColor: 'red',
					  borderWidth: debugBorderWidth,
					};
				}

			} else {
				  corners = {
					  topLeft: { top: this.fullScreen ? 0 : conferenceHeader.height + buttonsContainer.height, left: 0 },
					  topRight: { top: this.fullScreen ? 0: conferenceHeader.height + buttonsContainer.height, right: 0 },
					  bottomRight: { bottom: 0, right: 0 },
					  bottomLeft: { bottom: 0, left: 0},
					  id: 'ios-portrait'
				  };

				container = {
				  ...(this.fullScreen ? {} : {flex: 1}),  // adds flex:1 only if fullScreen
				  top: 0,
				  left: 0,
				  flexDirection: 'column',
				  //marginTop: this.fullScreen ? 0: -topInset,
				  width: width,
				  height: this.fullScreen ? height: '100%',
				  marginBottom: marginBottom,
				  borderWidth: debugBorderWidth,
				  borderColor: 'green',
				};
  
				mediaContainer = {
				  position: 'absolute',
				  resizeMode: 'cover',
				  height: this.fullScreen ? height: '100%',
				  width: width,
				  borderWidth: debugBorderWidth, 
				  borderColor: 'white'
				};		
			}
		} else {
		    // android
		    if (this.state.isLandscape) {
				const aRightInset = Platform.Version < 34 ? rightInset + bottomInset : rightInset;
		        if (this.fullScreen) {
		             const aRightInset = Platform.Version < 34 ? 0 : rightInset;
		             console.log('aRightInset', aRightInset);
					 corners = {
						  topLeft: { top: 0, left: aRightInset },
						  topRight: { top: 0, right: -aRightInset },
						  bottomRight: { bottom: 0, right: -aRightInset },
						  bottomLeft: { bottom: 0, left: aRightInset},
						  id: 'android-landscape-fs'
					};
		
				} else {
				    corners = {
						  topLeft: { top: conferenceHeader.height, left: aRightInset },
						  topRight: { top: conferenceHeader.height, right: -aRightInset },
						  bottomRight: { bottom: 0, right: -aRightInset},
						  bottomLeft: { bottom: 0, left: aRightInset},
						  id: 'android-landscape'
					};
				}

			} else {
			      // android portrait
		          if (!this.fullScreen) {
					  corners = {
						  topLeft: { top: conferenceHeader.height + buttonsContainer.height, left: 0 },
						  topRight: { top: conferenceHeader.height + buttonsContainer.height, right: 0 },
						  bottomRight: { bottom: 0, right: 0 },
						  bottomLeft: { bottom: 0, left: 0},
						  id: 'android-portrait'
					  };
				  }
			}
		}
		
		if (this.state.chatView) {
			mediaContainer.height = 0;
		}
				
		let corner = {
		  ...corners[this.state.myVideoCorner],
		};

        if (this.state.chatView) {
			 corner = corners['topLeft'];
		}
					
        const gridLayoutContainer = this.getVideoLayout().container;
        const videoObjectsCount = videos.length;
        const myselfContainer = {
				  position: 'absolute',
				  top: 0,
				  left: 0,
				  right: 0,
				  bottom: 0,
				  zIndex: 1000,
				  pointerEvents: 'box-none'
				};


		if (debugBorderWidth) {
			const values = {
			  corners,
			  navigationBarHeight,
			  statusBarHeight,
			  topInset,
			  bottomInset,
			  leftInset,
			  rightInset,
			  container,
			  conferenceHeader,
			  buttonsContainer,
			  conferenceContainer,
			  mediaContainer,
			  myselfContainer,
			  videoGridContainer,
			  gridLayoutContainer
			};

			const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
		
			Object.entries(values).forEach(([key, value]) => {
			  const prev = this.prevValues[key];
			   const paddedKey = key.padStart(maxKeyLength, ' '); // right
			  if (JSON.stringify(prev) !== JSON.stringify(value)) {
				console.log(paddedKey, value);
			  }
			});

			this.prevValues = values;
		}

		if (debugBorderWidth) {
			videos = [];
			//buttons.bottom = [];
		}
		
		//console.log('activeSpeakers', this.state.activeSpeakers);
		
        return (
			<View 
			      key={this.state.isLandscape ? 'landscape' : 'portrait'}
			      style={container}>

                <ShareConferenceLinkModal
                    notificationCenter={this.props.notificationCenter}
                    show={this.state.showInviteModal && !this.state.reconnectingCall}
                    close={this.toggleInviteModal}
                    conferenceUrl={conferenceUrl}
                />
                    
 				{!this.fullScreen || this.state.chatView ?

				<View style={conferenceHeader}>
					<ConferenceHeader
					    visible={true}
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
						info={this.state.info}
						goBackFunc={this.props.goBackFunc}
						toggleInviteModal={this.toggleInviteModal}
						inviteToConferenceFunc={this.props.inviteToConferenceFunc}
						callState={this.props.callState}
						toggleAudioParticipantsFunc={this.toggleAudioParticipants}
						toggleChatFunc={this.toggleChat}
						hangUpFunc={this.hangup}
						audioView={this.state.audioView}
						chatView={this.state.chatView}
						toggleDrawer={this.toggleDrawer}
						enableMyVideo={this.state.enableMyVideo}
						toggleMyVideo={this.toggleMyVideo}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						insets = {this.state.insets}
						useInCallManger = {this.props.useInCallManger}
					/>
				</View>

				: null}

				{!this.fullScreen && !this.props.isLandscape && !this.state.showDrawer ?
				<View style={buttonsContainer}>
					{buttons.bottom}
					<View style={styles.buttonsContainer}>
					{this.renderAudioDeviceButtons()}
					</View>
				</View>
				: null}

				<View style={conferenceContainer}>
				   {!this.state.keyboardVisible && !this.state.chatView?  // videos show up here 
					<TouchableWithoutFeedback onPress={this.toggleFullScreen}>
						<View style={[mediaContainer]}>
							<View style={[videoGridContainer, gridLayoutContainer]}>
								{videos.slice(0, 4).map((video, index) => (
									<View key={index} style={this.getVideoLayout().item}>
										{video}
									</View>
								))}
							</View>
						</View>
					</TouchableWithoutFeedback>
					: null}

				{this.state.chatView && Platform.OS === 'android'?	
					<KeyboardAvoidingView
					  key={this.state.isLandscape ? 'landscape' : 'portrait'} // re-layout when rotate or keyboard changes
					  style={chatContainer}
					  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
					  keyboardVerticalOffset={conferenceHeaderHeight + topInset} // adjust if you have a header
					>

					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
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
				   </KeyboardAvoidingView>
				:

				<View style={styles.carouselContainer}>
					<ConferenceCarousel align={'right'}>
						{participants}
					</ConferenceCarousel>
				</View>
				}

				{this.state.chatView && Platform.OS === 'ios' ?
					<GiftedChat
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
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
				:
				<View style={styles.carouselContainer}>
					<ConferenceCarousel align={'right'}>
						{participants}
					</ConferenceCarousel>
				</View>
				}

			</View>
			  <View
				style={myselfContainer}
			  >
				<View
				  style={{
					position: 'absolute',
					width: 120,
					height: 160,
					...corner,
				  }}
				>
				  <TouchableOpacity
					style={{ flex: 1 }}
					onPress={() => {
					  const cornerOrder = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
					  const currentIndex = cornerOrder.indexOf(this.state.myVideoCorner);
					  const nextIndex = (currentIndex + 1) % cornerOrder.length;
					  this.setState({ myVideoCorner: cornerOrder[nextIndex] });
					}}
				  >
					<ConferenceParticipantSelf
					  key="myself2"
					  visible={this.showMyself}
					  stream={this.props.call.getLocalStreams()[0]}
					  identity={this.props.call.localIdentity}
					  audioMuted={this.state.audioMuted}
					  isLandscape={this.state.isLandscape}
					  generatedVideoTrack={this.props.generatedVideoTrack}
					/>
				  </TouchableOpacity>
				</View>

			  </View>

			<ConferenceDrawer
				show={this.state.showDrawer && !this.state.reconnectingCall}
				close={this.toggleDrawer}
				isLandscape={this.state.isLandscape}
				title="Room configuration"
			>
				<View style={this.state.isLandscape ? [{maxHeight: Dimensions.get('window').height - conferenceHeaderHeight}, styles.landscapeDrawer] : styles.container}>
					<View style={{flex: this.state.isLandscape ? 1 : 2}}>
						<ConferenceDrawerSpeakerSelectionWrapper
							selectSpeaker={this.startSpeakerSelection}
							activeSpeakers={this.state.activeSpeakers}
							closeDrawer={this.toggleDrawer}
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
    sendConferenceMessage   : PropTypes.func,
    useInCallManger         : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
    publicUrl               : PropTypes.string,
    insets                  : PropTypes.object,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func

};

export default ConferenceBox;
