import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, PermissionsAndroid, Switch, TouchableOpacity, BackHandler, TouchableHighlight} from 'react-native';
import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble, MessageText, Send, InputToolbar, MessageImage, Time} from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import MessageInfoModal from './MessageInfoModal';
import EditMessageModal from './EditMessageModal';
import ShareMessageModal from './ShareMessageModal';
import DeleteMessageModal from './DeleteMessageModal';
import CustomChatActions from './ChatActions';
import FileViewer from 'react-native-file-viewer';
import OpenPGP from "react-native-fast-openpgp";
import DocumentPicker from 'react-native-document-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import VideoPlayer from 'react-native-video-player';
import RNFetchBlob from "rn-fetch-blob";
import { IconButton} from 'react-native-paper';
import ImageViewer from 'react-native-image-zoom-viewer';
import fileType from 'react-native-file-type';
import path from 'react-native-path';

import Sound from 'react-native-sound';
import SoundPlayer from 'react-native-sound-player';

import moment from 'moment';
import momenttz from 'moment-timezone';
import Video from 'react-native-video';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-community/cameraroll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';

import styles from '../assets/styles/blink/_ContactsListBox.scss';

String.prototype.toDate = function(format)
{
  var normalized      = this.replace(/[^a-zA-Z0-9]/g, '-');
  var normalizedFormat= format.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-');
  var formatItems     = normalizedFormat.split('-');
  var dateItems       = normalized.split('-');

  var monthIndex  = formatItems.indexOf("mm");
  var dayIndex    = formatItems.indexOf("dd");
  var yearIndex   = formatItems.indexOf("yyyy");
  var hourIndex     = formatItems.indexOf("hh");
  var minutesIndex  = formatItems.indexOf("ii");
  var secondsIndex  = formatItems.indexOf("ss");

  var today = new Date();

  var year  = yearIndex>-1  ? dateItems[yearIndex]    : today.getFullYear();
  var month = monthIndex>-1 ? dateItems[monthIndex]-1 : today.getMonth()-1;
  var day   = dayIndex>-1   ? dateItems[dayIndex]     : today.getDate();

  var hour    = hourIndex>-1      ? dateItems[hourIndex]    : today.getHours();
  var minute  = minutesIndex>-1   ? dateItems[minutesIndex] : today.getMinutes();
  var second  = secondsIndex>-1   ? dateItems[secondsIndex] : today.getSeconds();

  return new Date(year,month,day,hour,minute,second);
};

const audioRecorderPlayer = new AudioRecorderPlayer();

// Note: copy and paste all styles in App.js from my repository
function  renderBubble (props) {
        let leftColor = 'green';
        let rightColor = '#fff';

        if (props.currentMessage.failed) {
            rightColor = 'red';
            leftColor = 'red';
        } else {
            if (props.currentMessage.pinned) {
                rightColor = '#2ecc71';
                leftColor = '#2ecc71';
            }
        }

        if (props.currentMessage.image) {
            return (
              <Bubble
                {...props}
                wrapperStyle={{
                  right: {
                    backgroundColor: '#fff',
                    alignSelf: 'stretch',
                    marginLeft: 0
                  },
                  left: {
                    backgroundColor: '#fff',
                    alignSelf: 'stretch',
                    marginRight: 0
                  }
                }}
                textProps={{
                    style: {
                      color: props.position === 'left' ? '#000' : '#000',
                    },
                  }}
                  textStyle={{
                    left: {
                      color: '#fff',
                    },
                    right: {
                      color: '#000',
                    },
                  }}
              />
            )
        } else if (props.currentMessage.video) {
            return (
              <Bubble
                {...props}
                wrapperStyle={{
                  right: {
                    backgroundColor: '#000',
                    alignSelf: 'stretch',
                    marginLeft: 0
                  },
                  left: {
                    backgroundColor: '#000',
                    alignSelf: 'stretch',
                    marginRight: 0
                  }
                 }}

                 textProps={{
                    style: {
                      color: props.position === 'left' ? '#fff' : '#fff',
                    },
                  }}
                  textStyle={{
                    left: {
                      color: '#000',
                    },
                    right: {
                      color: '#000',
                    },
                  }}
              />
            )
        } else if (props.currentMessage.audio) {
            return (
              <Bubble
                {...props}
                wrapperStyle={{
                  right: {
                    backgroundColor: 'transparent',
                  },
                  left: {
                    backgroundColor: 'transparent',
                  }
                 }}

                 textProps={{
                    style: {
                      color: props.position === 'left' ? '#fff' : '#fff',
                    },
                  }}
                  textStyle={{
                    left: {
                      color: '#000',
                    },
                    right: {
                      color: '#000',
                    },
                  }}
              />
            )
        } else {
            return (
              <Bubble
                {...props}
                 wrapperStyle={{
                    left: {
                      backgroundColor: leftColor,
                    },
                    right: {
                      backgroundColor: rightColor,
                    },
                  }}
                  textProps={{
                    style: {
                      color: props.position === 'left' ? '#fff' : '#000',
                    },
                  }}
                  textStyle={{
                    left: {
                      color: '#fff',
                    },
                    right: {
                      color: '#000',
                    },
                  }}

                style={styles.bubbleContainer}
              />
            )
        }
    }


class ContactsListBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.chatListRef = React.createRef();
        this.default_placeholder = 'Enter message...'

        let renderMessages = [];
        if (this.props.selectedContact) {
            let uri = this.props.selectedContact.uri;
            if (uri in this.props.messages) {
                renderMessages = this.props.messages[uri];
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
            }
        }

        this.state = {
            accountId: this.props.account ? this.props.account.id : null,
            password: this.props.password,
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            isLandscape: this.props.isLandscape,
            contacts: this.props.contacts,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory,
            selectedContact: this.props.selectedContact,
            myContacts: this.props.myContacts,
            messages: this.props.messages,
            renderMessages: GiftedChat.append(renderMessages, []),
            chat: this.props.chat,
            pinned: false,
            message: null,
            inviteContacts: this.props.inviteContacts,
            shareToContacts: this.props.shareToContacts,
            selectMode: this.props.shareToContacts || this.props.inviteContacts,
            selectedContacts: this.props.selectedContacts,
            pinned: this.props.pinned,
            filter: this.props.filter,
            periodFilter: this.props.periodFilter,
            scrollToBottom: true,
            messageZoomFactor: this.props.messageZoomFactor,
            isTyping: false,
            isLoadingEarlier: false,
            fontScale: this.props.fontScale,
            call: this.props.call,
            isTablet: this.props.isTablet,
            ssiCredentials: this.props.ssiCredentials,
            ssiConnections: this.props.ssiConnections,
            keys: this.props.keys,
            recording: false,
            playing: false,
            texting: false,
            audioRecording: null,
            cameraAsset: null,
            placeholder: this.default_placeholder,
            audioSendFinished: false,
            messagesCategoryFilter: this.props.messagesCategoryFilter,
            isTexting: this.props.isTexting,
            showDeleteMessageModal: false
        }

        this.ended = false;
        this.recordingTimer = null;
        this.outgoingPendMessages = {};
        BackHandler.addEventListener('hardwareBackPress', this.backPressed);
        this.listenforSoundNotifications()
    }

    componentDidMount() {
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
        this.stopRecordingTimer()
    }

    backPressed() {
       this.stopRecordingTimer()
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (nextProps.myInvitedParties !== this.state.myInvitedParties) {
            this.setState({myInvitedParties: nextProps.myInvitedParties});
        }

        if (nextProps.contacts !== this.state.contacts) {
            this.setState({contacts: nextProps.contacts});
        }

        if (nextProps.favoriteUris !== this.state.favoriteUris) {
            this.setState({favoriteUris: nextProps.favoriteUris});
        }

        if (nextProps.blockedUris !== this.state.blockedUris) {
            this.setState({blockedUris: nextProps.blockedUris});
        }

        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({accountId: nextProps.account.id});
        }

        if (nextProps.refreshHistory !== this.state.refreshHistory) {
            this.setState({refreshHistory: nextProps.refreshHistory});
            this.getServerHistory();
        }

        if (nextProps.messageZoomFactor !== this.state.messageZoomFactor) {
            this.setState({scrollToBottom: false, messageZoomFactor: nextProps.messageZoomFactor});
        }

        if (nextProps.messagesCategoryFilter !== this.state.messagesCategoryFilter && nextProps.selectedContact) {
            this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: this.state.pinned});
        }

        if (nextProps.pinned !== this.state.pinned && nextProps.selectedContact) {
            this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: nextProps.pinned});
        }

        if (nextProps.selectedContact !== this.state.selectedContact) {
            //console.log('Selected contact changed to', nextProps.selectedContact);
            this.resetContact()
            this.setState({selectedContact: nextProps.selectedContact});
            if (nextProps.selectedContact) {
               this.setState({scrollToBottom: true});
               if (Object.keys(this.state.messages).indexOf(nextProps.selectedContact.uri) === -1 && nextProps.selectedContact) {
                   this.props.getMessages(nextProps.selectedContact.uri);
               }
            } else {
                this.setState({renderMessages: []});
            }
        };

        if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
        };

        if (nextProps.selectedContact) {
            let renderMessages = [];
            let uri = nextProps.selectedContact.uri;

            if (uri in nextProps.messages) {
                renderMessages = nextProps.messages[uri];
                // remove duplicate messages no mater what
                renderMessages = renderMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
                if (this.state.renderMessages.length < renderMessages.length) {
                    //console.log('Number of messages changed', this.state.renderMessages.length, '->', renderMessages.length);
                    this.setState({isLoadingEarlier: false});
                    this.props.confirmRead(uri);
                    if (this.state.renderMessages.length > 0 && renderMessages.length > 0) {
                        let last_message_ts = this.state.renderMessages[0].createdAt;
                        if (renderMessages[0].createdAt > last_message_ts) {
                            this.setState({scrollToBottom: true});
                        }
                    }
                }
            }

            let delete_ids = [];
            Object.keys(this.outgoingPendMessages).forEach((_id) => {
                if (renderMessages.some((obj) => obj._id === _id)) {
                    //console.log('Remove pending message id', _id);
                    delete_ids.push(_id);
                    // message exists
                } else {
                    if (this.state.renderMessages.some((obj) => obj._id === _id)) {
                        //console.log('Pending message id', _id, 'already exists');
                    } else {
                        //console.log('Adding pending message id', _id);
                        renderMessages.push(this.outgoingPendMessages[_id]);
                    }
                }
            });

            delete_ids.forEach((_id) => {
                delete this.outgoingPendMessages[_id];
            });

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

            this.setState({renderMessages: GiftedChat.append(renderMessages, [])});
            if (!this.state.scrollToBottom && renderMessages.length > 0) {
                //console.log('Scroll to first message');
                //this.scrollToMessage(0);
            }
        }

        this.setState({isLandscape: nextProps.isLandscape,
                       isTablet: nextProps.isTablet,
                       chat: nextProps.chat,
                       fontScale: nextProps.fontScale,
                       filter: nextProps.filter,
                       call: nextProps.call,
                       password: nextProps.password,
                       messages: nextProps.messages,
                       inviteContacts: nextProps.inviteContacts,
                       shareToContacts: nextProps.shareToContacts,
                       selectedContacts: nextProps.selectedContacts,
                       pinned: nextProps.pinned,
                       isTyping: nextProps.isTyping,
                       periodFilter: nextProps.periodFilter,
                       ssiCredentials: nextProps.ssiCredentials,
                       ssiConnections: nextProps.ssiConnections,
                       messagesCategoryFilter: nextProps.messagesCategoryFilter,
                       targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : nextProps.targetUri,
                       keys: nextProps.keys,
                       isTexting: nextProps.isTexting,
                       showDeleteMessageModal: nextProps.showDeleteMessageModal,
                       selectMode: nextProps.shareToContacts || nextProps.inviteContacts
                       });

        if (nextProps.isTyping) {
            setTimeout(() => {
                this.setState({isTyping: false});
            }, 3000);
        }
    }

    listenforSoundNotifications() {
     // Subscribe to event(s) you want when component mounted
        this._onFinishedPlayingSubscription = SoundPlayer.addEventListener('FinishedPlaying', ({ success }) => {
          //console.log('finished playing', success)
          this.setState({playing: false, placeholder: this.default_placeholder});
        })
        this._onFinishedLoadingSubscription = SoundPlayer.addEventListener('FinishedLoading', ({ success }) => {
          //console.log('finished loading', success)
        })
        this._onFinishedLoadingFileSubscription = SoundPlayer.addEventListener('FinishedLoadingFile', ({ success, name, type }) => {
          //console.log('finished loading file', success, name, type)
        })
        this._onFinishedLoadingURLSubscription = SoundPlayer.addEventListener('FinishedLoadingURL', ({ success, url }) => {
          //console.log('finished loading url', success, url)
        })
    }

    async _launchCamera() {
        let options = {maxWidth: 2000,
                        maxHeight: 2000,
                        mediaType: 'mixed',
                        quality:0.8,
                        cameraType: 'front',
                        formatAsMp4: true
                       }
        const cameraAllowed = await this.props.requestCameraPermission();
        if (cameraAllowed) {
            await launchCamera(options, this.cameraCallback);
        }
    }

    async _launchImageLibrary() {
        let options = {maxWidth: 2000,
                        maxHeight: 2000,
                        mediaType: 'mixed',
                        formatAsMp4: true
                       }
        await launchImageLibrary(options, this.libraryCallback);
    }

    async libraryCallback(result) {
        if (!result.assets || result.assets.length === 0) {
            return;
        }

        result.assets.forEach((asset) => {
            this.cameraCallback({assets: [asset]});
        });
    }

    async cameraCallback(result) {
        if (!result.assets || result.assets.length === 0) {
            return;
        }

        this.setState({scrollToBottom: true});

        let asset = result.assets[0];
        asset.preview = true;

        let msg = await this.file2GiftedChat(asset);

        let assetType = 'file';
        if (msg.video) {
            assetType = 'movie';
        } else if (msg.image) {
            assetType = 'photo';
        }

        this.outgoingPendMessages[msg.metadata.transfer_id] = msg;
        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg]),
                        cameraAsset: msg,
                        placeholder: 'Send ' + assetType + ' of ' + utils.beautySize(msg.metadata.filesize)
                        });
    }

    renderMessageImage =(props) => {
    /*
        return(
          <TouchableOpacity onPress={() => this.onMessagePress(context, props.currentMessage)}>
            <Image
              source={{ uri: props.currentMessage.image }}
              style = {{
              width: '98%',
              height: Dimensions.get('window').width,
              resizeMode: 'cover'
            }}
            />
          </TouchableOpacity>
        );
*/
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

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} audioRecorded={this.audioRecorded} stopPlaying={this.stopPlaying} onRecording={this.onRecording} texting={this.state.texting} audioSendFinished={this.state.audioSendFinished} playing={this.state.playing} sendingImage={this.state.cameraAsset !==null} selectedContact={this.state.selectedContact}/>
    )

    customInputToolbar = props => {
      return (
        <InputToolbar
          {...props}
          renderComposer={() => {this.renderComposer}}
          containerStyle={styles.chatInsideRightActionsContainer}
        />
      );
    };

    chatInputChanged(text) {
       this.setState({texting: (text.length > 0)})
    }

    resetContact() {
        this.stopRecordingTimer()
        this.outgoingPendMessages = {};
        this.setState({
            recording: false,
            texting: false,
            audioRecording: null,
            cameraAsset: null,
            placeholder: this.default_placeholder,
            audioSendFinished: false
        });
    }

    renderComposer(props) {
        return(
          <Composer
          {...props}
          onTextChanged={(text) => this.setState({ composerText: text })}
          text={this.state.composerText}
          multiline={true}
          placeholderTextColor={'red'}
          ></Composer>
        )
      }

    onRecording(state) {
        this.setState({recording: state});
        if (state) {
            this.startRecordingTimer();
        } else {
            this.stopRecordingTimer()
        }
    }

    startRecordingTimer() {
        let i = 0;
        this.setState({placeholder: 'Recording audio'});
        this.recordingTimer = setInterval(() => {
            i = i + 1
            this.setState({placeholder: 'Recording audio ' + i + 's'});
        }, 1000);
    }

    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            this.setState({placeholder: this.default_placeholder});
        }
    }

    updateMessageMetadata(metadata) {
        let renderMessages = this.state.renderMessages;
        let newRenderMessages = [];
        renderMessages.forEach((message) => {
            if (metadata.transfer_id === message._id) {
                message.metadata = metadata;
            }
            newRenderMessages.push(message);
        });

        this.setState({renderMessages: GiftedChat.append(newRenderMessages, [])});
    }

    async startPlaying(message) {
        if (this.state.playing || this.state.recording) {
            console.log('Already playing or recording');
            return;
        }

        this.setState({playing: true, placeholder: 'Playing audio message'});
        message.metadata.playing = true;
        this.updateMessageMetadata(message.metadata);

        if (Platform.OS === "android") {
            const msg = await audioRecorderPlayer.startPlayer(message.audio);
            console.log('Audio playback started', message.audio);
            audioRecorderPlayer.addPlayBackListener((e) => {
                //console.log('duration', e.duration, e.currentPosition);
                if (e.duration === e.currentPosition) {
                    this.setState({playing: false, placeholder: this.default_placeholder});
                    //console.log('Audio playback ended', message.audio);
                    message.metadata.playing = false;
                    this.updateMessageMetadata(message.metadata);
                }
                this.setState({
                    currentPositionSec: e.currentPosition,
                    currentDurationSec: e.duration,
                    playTime: audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
                    duration: audioRecorderPlayer.mmssss(Math.floor(e.duration)),
                });
            });
        } else {
            /*
            console.log('startPlaying', file);

            this.sound = new Sound(file, '', error => {
                if (error) {
                    console.log('failed to load the file', file, error);
                }
            });
            return;
            */
            try {
                SoundPlayer.playUrl('file://'+message.audio);
                this.setState({playing: true, placeholder: 'Playing audio message'});
            } catch (e) {
                console.log(`cannot play the sound file`, e)
            }

            try {
                  const info = await SoundPlayer.getInfo() // Also, you need to await this because it is async
                  console.log('Sound info', info) // {duration: 12.416, currentTime: 7.691}
                } catch (e) {
                  console.log('There is no song playing', e)
            }
        }
    };

    async stopPlaying(message) {
        console.log('Audio playback ended', message.audio);
        this.setState({playing: false, placeholder: this.default_placeholder});
        message.metadata.playing = false;
        this.updateMessageMetadata(message.metadata);
        if (Platform.OS === "android") {
            const msg = await audioRecorderPlayer.stopPlayer();
        } else {
            SoundPlayer.stop();
        }
    }

    async audioRecorded(file) {
        const placeholder = file ? 'Delete or send audio...' : this.default_placeholder;
        if (file) {
            console.log('Audio recording ready to send', file);
        } else {
            console.log('Audio recording removed');
        }
        this.setState({recording: false, placeholder: placeholder, audioRecording: file});
    }

    renderSend = (props) => {
        let chatRightActionsContainer = Platform.OS === 'ios' ? styles.chatRightActionsContaineriOS : styles.chatRightActionsContainer;
        if (this.state.recording) {
            return (
                  <View style={styles.chatSendContainer}>
                  </View>
            );
        } else {
            if (this.state.cameraAsset) {
                return (
                    <Send {...props}>
                      <View style={styles.chatSendContainer}>
                      <TouchableOpacity onPress={this.deleteCameraAsset}>
                        <Icon
                          style={chatRightActionsContainer}
                          type="font-awesome"
                          name="delete"
                          size={20}
                          color='red'
                        />
                     </TouchableOpacity>
                      <TouchableOpacity onPress={this.sendCameraAsset}>
                        <Icon
                          type="font-awesome"
                          name="send"
                          style={styles.chatSendArrow}
                          size={20}
                          color='gray'
                        />
                        </TouchableOpacity>
                      </View>
                    </Send>
            );

            } else if (this.state.audioRecording) {
            return (
                <Send {...props}>
                  <View style={styles.chatSendContainer}>
                  <TouchableOpacity onPress={this.sendAudioFile}>
                    <Icon
                      type="font-awesome"
                      name="send"
                      style={styles.chatSendArrow}
                      size={20}
                      color='gray'
                    />
                    </TouchableOpacity>
                  </View>
                </Send>
            );
            } else {

            if (this.state.playing || (this.state.selectedContact && this.state.selectedContact.tags.indexOf('test') > -1)) {
                return <View></View>;
            } else {
                return (
                    <Send {...props}>
                      <View style={styles.chatSendContainer}>
                        {this.state.texting ?
                        null
                        :
                      <TouchableOpacity onPress={this._launchCamera}>
                        <Icon
                          style={chatRightActionsContainer}
                          type="font-awesome"
                          name="camera"
                          size={20}
                          color='gray'
                        />
                        </TouchableOpacity>
                        }
                        {this.state.texting ?
                        null
                        :
                      <TouchableOpacity onPress={this._launchImageLibrary} onLongPress={this._pickDocument}>
                        <Icon
                          style={chatRightActionsContainer}
                          type="font-awesome"
                          name="paperclip"
                          size={20}
                          color='gray'
                        />
                        </TouchableOpacity>
                        }
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
                }
            }
        }
    };

    setTargetUri(uri, contact) {
        //console.log('Set target uri uri in history list', uri);
        this.props.setTargetUri(uri, contact);
    }

    setFavoriteUri(uri) {
        return this.props.setFavoriteUri(uri);
    }

    setBlockedUri(uri) {
        return this.props.setBlockedUri(uri);
    }

    renderItem(object) {
        let item = object.item || object;
        let invitedParties = [];
        let uri = item.uri;
        let myDisplayName;

        let username = uri.split('@')[0];

        if (this.state.myContacts && this.state.myContacts.hasOwnProperty(uri)) {
            myDisplayName = this.state.myContacts[uri].name;
        }

        if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(username)) {
            invitedParties = this.state.myInvitedParties[username];
        }

        if (myDisplayName) {
            if (item.name === item.uri || item.name !== myDisplayName) {
                item.name = myDisplayName;
            }
        }

        return(
            <ContactCard
            contact={item}
            setTargetUri={this.setTargetUri}
            chat={this.state.chat}
            fontScale={this.state.fontScale}
            orientation={this.props.orientation}
            isTablet={this.state.isTablet}
            isLandscape={this.state.isLandscape}
            contacts={this.state.contacts}
            defaultDomain={this.props.defaultDomain}
            accountId={this.state.accountId}
            favoriteUris={this.state.favoriteUris}
            messages={this.state.renderMessages}
            pinned={this.state.pinned}
            unread={item.unread}
            toggleBlocked={this.props.toggleBlocked}
            sendPublicKey={this.props.sendPublicKey}
            selectMode={this.state.selectMode}
            />);
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    closeMessageModal() {
        this.setState({showMessageModal: false, message: null});
    }

    closeEditMessageModal() {
        this.setState({showEditMessageModal: false, message: null});
    }

    loadEarlierMessages() {
        //console.log('Load earlier messages...');
        this.setState({scrollToBottom: false, isLoadingEarlier: true});
        this.props.loadEarlierMessages();
    }

    sendEditedMessage(message, text) {
        if (!this.state.selectedContact.uri) {
           return;
        }

        if (message.text === text) {
            return;
        }

        this.props.deleteMessage(message._id, this.state.selectedContact.uri);

        message._id = uuid.v4();
        message.key = message._id;
        message.text = text;

        this.props.sendMessage(this.state.selectedContact.uri, message);
    }

    onSendMessage(messages) {
        let uri;
        if (!this.state.selectedContact) {
            if (this.state.targetUri && this.state.chat) {
                 let contacts = this.searchedContact(this.state.targetUri);
                 if (contacts.length !== 1) {
                     return;
                }
                 uri = contacts[0].uri;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.uri;
        }

        messages.forEach((message) => {
            /*
              sent: true,
              // Mark the message as received, using two tick
              received: true,
              // Mark the message as pending with a clock loader
              pending: true,
            */
            message.encrypted = this.state.selectedContact && this.state.selectedContact.publicKey ? 2 : 0;
            this.props.sendMessage(uri, message);
        });

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    searchedContact(uri, contact=null) {
        if (uri.indexOf(' ') > -1) {
            return [];
        }

        const item = this.props.newContactFunc(uri.toLowerCase(), null, {src: 'search_contact'});
        if (!item) {
            return [];
        }

        if (contact) {
            item.name = contact.name;
            item.photo = contact.photo;
        }
        return [item];
    }

    getServerHistory() {
        if (!this.state.accountId) {
            return;
        }

        if (this.ended || !this.state.accountId || this.state.isRefreshing) {
            return;
        }

        //console.log('Get server history...');

        this.setState({isRefreshing: true});

        let history = [];
        let localTime;

        let getServerCallHistory = new DigestAuthRequest(
            'GET',
            `${this.props.config.serverCallHistoryUrl}?action=get_history&realm=${this.state.accountId.split('@')[1]}`,
            this.state.accountId.split('@')[0],
            this.state.password
        );

        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                console.log('Error getting call history from server', data.error_message);
                return;
            }

            if (data.received) {
                data.received.map(elem => {elem.direction = 'incoming'; return elem});
                history = history.concat(data.received);
            }

            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'outgoing'; return elem});
                history = history.concat(data.placed);
            }

            history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

            if (history) {
                const known = [];
                history = history.filter((elem) => {
                    elem.conference = false;
                    elem.id = uuid.v4();

                    if (!elem.tags) {
                        elem.tags = [];
                    }

                    if (elem.remoteParty.indexOf('@conference.') > -1) {
                        return null;
                    }

                    elem.uri = elem.remoteParty.toLowerCase();

                    let uri_els = elem.uri.split('@');
                    let username = uri_els[0];
                    let domain;
                    if (uri_els.length > 1) {
                        domain = uri_els[1];
                    }

                    if (elem.uri.indexOf('@guest.') > -1) {
                        if (!elem.displayName) {
                            elem.uri = 'guest@' + elem.uri.split('@')[1];
                        } else {
                            elem.uri = elem.displayName.toLowerCase().replace(/\s|\-|\(|\)/g, '') + '@' + elem.uri.split('@')[1];
                        }
                    }

                    if (utils.isPhoneNumber(elem.uri)) {
                        username = username.replace(/\s|\-|\(|\)/g, '');
                        username = username.replace(/^00/, "+");
                        elem.uri = username;
                    }

                    if (known.indexOf(elem.uri) > -1) {
                        return null;
                    }

                    known.push(elem.uri);

                    if (elem.displayName) {
                        elem.name = elem.displayName;
                    } else {
                        elem.name = elem.uri;
                    }

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
                        elem.conference = true;
                        elem.media = ['audio', 'video', 'chat'];
                    }

                    if (elem.uri === this.state.accountId) {
                        elem.name = this.props.myDisplayName || 'Myself';
                    }

                    if (!elem.media || !Array.isArray(elem.media)) {
                        elem.media = ['audio'];
                    }

                    if (elem.timezone !== undefined) {
                        localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                        elem.startTime = localTime;
                        elem.timestamp = localTime;
                        localTime = momenttz.tz(elem.stopTime, elem.timezone).toDate();
                        elem.stopTime = localTime;
                    }

                    if (elem.direction === 'incoming' && elem.duration === 0) {
                        elem.tags.push('missed');
                    }

                    return elem;
                });

                this.props.saveHistory(history);
                if (this.ended) {
                    return;
                }
                this.setState({isRefreshing: false});
            }
        }, (errorCode) => {
            console.log('Error getting call history from server', errorCode);
        });

        this.setState({isRefreshing: false});
    }

    deleteCameraAsset() {
        if (this.state.cameraAsset && this.state.cameraAsset.metadata.transfer_id in this.outgoingPendMessages) {
            delete this.outgoingPendMessages[this.state.cameraAsset.metadata.transfer_id]
        }
        this.setState({cameraAsset: null, placeholder: this.default_placeholder});
        this.props.getMessages(this.state.selectedContact.uri);
    }

    sendCameraAsset() {
        this.transferFile(this.state.cameraAsset);
        this.setState({cameraAsset: null, placeholder: this.default_placeholder});
    }

    async sendAudioFile() {
        if (this.state.audioRecording) {
            this.setState({audioSendFinished: true, placeholder: this.default_placeholder});
            setTimeout(() => {
                this.setState({audioSendFinished: false});
            }, 10);
            let msg = await this.file2GiftedChat(this.state.audioRecording);
            this.transferFile(msg);
            this.setState({audioRecording: null});
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

            let msg = await this.file2GiftedChat(fileUri);
            this.transferFile(msg);

          } catch (err) {
            if (DocumentPicker.isCancel(err)) {
              console.log('User cancelled file picker');
            } else {
              console.log('DocumentPicker err => ', err);
              throw err;
            }
          }
    };

    postChatSystemMessage(text, imagePath=null) {
        var id = uuid.v4();
        let giftedChatMessage;

        if (imagePath) {
            giftedChatMessage = {
                  _id: id,
                  key: id,
                  createdAt: new Date(),
                  text: text,
                  image: 'file://' + imagePath,
                  user: {}
                };
        } else {
            giftedChatMessage = {
                  _id: id,
                  key: id,
                  createdAt: new Date(),
                  text: text,
                  system: true,
                };
        }

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [giftedChatMessage])});
    }

    transferComplete(evt) {
        console.log("Upload has finished", evt);
        this.postChatSystemMessage('Upload has finished');
    }

    transferFailed(evt) {
       console.log("An error occurred while transferring the file.", evt);
       this.postChatSystemMessage('Upload failed')
    }

    transferCanceled(evt) {
       console.log("The transfer has been canceled by the user.");
       this.postChatSystemMessage('Upload has canceled')
    }

    async transferFile(msg) {
        msg.metadata.preview = false;
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
    }

    async file2GiftedChat(fileObject) {
        var id = uuid.v4();
        let uri;
        if (!this.state.selectedContact) {
            if (this.state.targetUri && this.state.chat) {
                 let contacts = this.searchedContact(this.state.targetUri);
                 if (contacts.length !== 1) {
                     return;
                }
                 uri = contacts[0].uri;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.uri;
        }

        let filepath = fileObject.uri ? fileObject.uri : fileObject;
        let basename = fileObject.fileName || filepath.split('\\').pop().split('/').pop();

        basename = basename.replace(/\s|:/g, '_');

        let file_transfer = { 'path': filepath,
                              'filename': basename,
                              'sender': {'uri': this.state.accountId},
                              'receiver': {'uri': uri},
                              'transfer_id': id,
                              'direction': 'outgoing'
                              };

        if (filepath.startsWith('content://')) {
            // on android we must copy this file early
            const localPath = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + uri + "/" + id + "/" + basename;
            const dirname = path.dirname(localPath);
            await RNFS.mkdir(dirname);
            console.log('Copy', filepath, localPath);
            await RNFS.copyFile(filepath, localPath);
            filepath = localPath;
            file_transfer.local_url = localPath;
        }

        let stats_filename = filepath.startsWith('file://') ? filepath.substr(7, filepath.length - 1) : filepath;
        const { size } = await RNFetchBlob.fs.stat(stats_filename);
        file_transfer.filesize = fileObject.fileSize || size;

        if (fileObject.preview) {
            file_transfer.preview = fileObject.preview;
        }

        if (fileObject.duration) {
            file_transfer.duration = fileObject.duration;
        }

        if (fileObject.fileType) {
            file_transfer.filetype = fileObject.fileType;
        } else {
            try {
                let mime = await fileType(filepath);
                if (mime.mime) {
                    file_transfer.filetype = mime.mime;
                }
            } catch (e) {
                console.log('Error getting mime type', e.message);
            }
        }

        let text = utils.beautyFileNameForBubble(file_transfer);

        let msg = {
            _id: id,
            key: id,
            text: text,
            metadata: file_transfer,
            createdAt: new Date(),
            direction: 'outgoing',
            user: {}
            }

        if (utils.isImage(basename)) {
            msg.image = filepath;
        } else if (utils.isAudio(basename)) {
            msg.audio = filepath;
        } else if (utils.isVideo(basename) || file_transfer.duration) {
            msg.video = filepath;
        }

        return msg;
    }

    matchContact(contact, filter='', tags=[]) {
        if (!contact) {
            return false;
        }

        if (tags.indexOf('conference') > -1 && contact.conference) {
            return true;
        }

        if (tags.length > 0 && !tags.some(item => contact.tags.includes(item))) {
            return false;
        }

        if (contact.name && contact.name.toLowerCase().indexOf(filter.toLowerCase()) > -1) {
            return true;
        }

        if (contact.uri.toLowerCase().startsWith(filter.toLowerCase())) {
            return true;
        }

        if (!this.state.selectedContact && contact.conference && contact.metadata && filter.length > 2 && contact.metadata.indexOf(filter) > -1) {
            return true;
        }

        return false;
    }

    noChatInputToolbar () {
        return null;
    }

    onMessagePress(context, message) {
        if (message.metadata && message.metadata.filename) {
            //console.log('File metadata', message.metadata);
            let file_transfer = message.metadata;
            if (!file_transfer.local_url) {
                if (!file_transfer.path) {
                    // this was a local created upload, don't download as the file has not yet been uploaded
                    this.props.downloadFunc(message.metadata, true);
                }
                return;
            }

            RNFS.exists(file_transfer.local_url).then((exists) => {
                if (exists) {
                    if (file_transfer.local_url.endsWith('.asc')) {
                        if (file_transfer.error === 'decryption failed') {
                            this.onLongMessagePress(context, message);
                        } else {
                            this.props.decryptFunc(message.metadata);
                        }
                    } else {
                        this.onLongMessagePress(context, message);
                        //this.openFile(message)
                    }
                } else {
                    if (file_transfer.path) {
                        // this was a local created upload, don't download as the file has not yet been uploaded
                        this.onLongMessagePress(context, message);
                    } else {
                        this.props.downloadFunc(message.metadata, true);
                    }
                }
            });
        } else {
            this.onLongMessagePress(context, message);
        }
    }

    openFile(message) {
        let file_transfer = message.metadata;
        let file_path = file_transfer.local_url;
        if (!file_path) {
            console.log('Cannot open empty path');
            return;
        }

        if (file_path.endsWith('.asc')) {
            file_path = file_path.slice(0, -4);
            console.log('Open decrypted file', file_path)
        } else {
            console.log('Open file', file_path)
        }

        if (utils.isAudio(file_transfer.filename)) {
//            this.startPlaying(file_path);
            return;
        }

        RNFS.exists(file_path).then((exists) => {
            if (exists) {
                FileViewer.open(file_path, { showOpenWithDialog: true })
                .then(() => {
                    // success
                })
                .catch(error => {
                    // error
                });
            } else {
                console.log(file_path, 'does not exist');
                return;
            }
        });
    }

    onLongMessagePress(context, currentMessage) {
        if (!currentMessage.metadata) {
            currentMessage.metadata = {};
        }
        //console.log('currentMessage metadata', currentMessage.metadata);
        if (currentMessage && currentMessage.text) {
            let isSsiMessage = this.state.selectedContact && this.state.selectedContact.tags.indexOf('ssi') > -1;
            let options = []
            if (currentMessage.metadata && !currentMessage.metadata.error) {
                if (!isSsiMessage && this.isMessageEditable(currentMessage)) {
                    options.push('Edit');
                }
                if (currentMessage.metadata && currentMessage.metadata.local_url) {
                    options.push('Open')
                //
                } else {
                    options.push('Copy');
                }
            }

            if (!isSsiMessage) {
                options.push('Delete');
            }

            let showResend = currentMessage.failed;
            if (currentMessage.metadata && currentMessage.metadata.error === 'decryption failed') {
                showResend = false;
            }

            if (this.state.targetUri.indexOf('@videoconference') === -1) {
                if (currentMessage.direction === 'outgoing') {
                    if (showResend) {
                        options.push('Resend')
                    }
                }
            }

            if (currentMessage.pinned) {
                options.push('Unpin');
            } else {
                if (!isSsiMessage && !currentMessage.metadata.error) {
                    options.push('Pin');
                }
            }

            //options.push('Info');
            if (!isSsiMessage && !currentMessage.metadata.error) {
                options.push('Forward');
            }

            if (!isSsiMessage && !currentMessage.metadata.error) {
                options.push('Share');
            }

            if (currentMessage.local_url) {
                if (utils.isImage(currentMessage.local_url)) {
                    options.push('Save');
                }
                options.push('Open');
            }

            if (currentMessage.metadata && currentMessage.metadata.filename) {
                if (!currentMessage.metadata.filename.local_url || currentMessage.metadata.filename.error === 'decryption failed') {
                    if (currentMessage.metadata.direction !== 'outgoing') {
                        options.push('Download again');
                    }
                } else {
                    options.push('Download');
                }
            }

            options.push('Cancel');

            let l = options.length - 1;

            context.actionSheet().showActionSheetWithOptions({options, l}, (buttonIndex) => {
                let action = options[buttonIndex];
                if (action === 'Copy') {
                    Clipboard.setString(currentMessage.text);
                } else if (action === 'Delete') {
                    this.setState({showDeleteMessageModal: true, currentMessage: currentMessage});
                } else if (action === 'Pin') {
                    this.props.pinMessage(currentMessage._id);
                } else if (action === 'Unpin') {
                    this.props.unpinMessage(currentMessage._id);
                } else if (action === 'Info') {
                    this.setState({message: currentMessage, showMessageModal: true});
                } else if (action === 'Edit') {
                    this.setState({message: currentMessage, showEditMessageModal: true});
                } else if (action.startsWith('Share')) {
                    this.setState({message: currentMessage, showShareMessageModal: true});
                } else if (action.startsWith('Forward')) {
                    this.props.forwardMessageFunc(currentMessage, this.state.targetUri);
                } else if (action === 'Resend') {
                    this.props.reSendMessage(currentMessage, this.state.targetUri);
                } else if (action === 'Save') {
                    this.savePicture(currentMessage.local_url);
                } else if (action.startsWith('Download')) {
                    console.log('Starting download...');
                    this.props.downloadFunc(currentMessage.metadata, true);
                } else if (action === 'Open') {
                    FileViewer.open(currentMessage.metadata.local_url, { showOpenWithDialog: true })
                    .then(() => {
                        // success
                    })
                    .catch(error => {
                        console.log('Failed to open', currentMessage, error.message);
                    });
                }
            });
        }
    };

    isMessageEditable(message) {
        if (message.direction === 'incoming') {
            return false;
        }

        if (message.image || message.audio || message.video) {
            return false;
        }

        if (message.metadata && message.metadata.filename) {
            return false;
        }

        return true;
    }

    closeDeleteMessageModal() {
        this.setState({showDeleteMessageModal: false});
    }

    async hasAndroidPermission() {
      const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

      const hasPermission = await PermissionsAndroid.check(permission);
      if (hasPermission) {
            return true;
      }

      const status = await PermissionsAndroid.request(permission);
      return status === 'granted';
    }

    async savePicture(file) {
        if (Platform.OS === "android" && !(await this.hasAndroidPermission())) {
           return;
        }

        file = 'file://' + file;

        console.log('Save to camera roll', file);
        CameraRoll.save(file);
    };

    shouldUpdateMessage(props, nextProps) {
        return true;
    }

    toggleShareMessageModal() {
        this.setState({showShareMessageModal: !this.state.showShareMessageModal});
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

    renderMessageAudio(props){
        const { currentMessage } = props;
        let playAudioButtonStyle = Platform.OS === 'ios' ? styles.playAudioButtoniOS : styles.playAudioButton;

        if (currentMessage.metadata.playing === true) {
            return (
                <View style={styles.audioContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                    <IconButton
                        size={32}
                        onPress={() => this.stopPlaying(currentMessage)}
                        style={playAudioButtonStyle}
                        icon="pause"
                    />
                </TouchableHighlight>
            </View>
            );
        } else {
            return (
                <View style={styles.audioContainer}>
                  <TouchableHighlight style={styles.roundshape}>
                    <IconButton
                        size={32}
                        onPress={() => this.startPlaying(currentMessage)}
                        style={playAudioButtonStyle}
                        icon="play"
                    />
                </TouchableHighlight>
            </View>
            );
        }
    };

    videoError() {
        console.log('Video streaming error');
    }

    onBuffer() {
        console.log('Video buffer error');
    }

    // https://github.com/FaridSafi/react-native-gifted-chat/issues/571
    // add view after bubble

    renderMessageText(props) {
        const { currentMessage } = props;
        if (currentMessage.video || currentMessage.image || currentMessage.audio) {
            return (
                <View>
                    <MessageText
                        {...props}
                        customTextStyle={{fontSize: 9}}
                    />

                </View>
            );
        } else {
            return (
                <View>
                    <MessageText
                        {...props}
                        customTextStyle={{fontSize: 14}}
                    />

                </View>
            );
  		}
    };

    renderTime = (props) => {
        const { currentMessage } = props;

        if (currentMessage.metadata && currentMessage.metadata.preview) {
            return null;
        }

        if (currentMessage.video) {
            return (
              <Time
              {...props}
                timeTextStyle={{
                  left: {
                    color: 'white',
                  },
                  right: {
                    color: 'white',
                  }
                }}
              />
            )
        } else if (currentMessage.audio) {
            return (
              <Time
              {...props}
                timeTextStyle={{
                  left: {
                    color: 'white',
                  },
                  right: {
                    color: 'white',
                  }
                }}
              />
            )
        } else {
            return (
              <Time
              {...props}
                timeTextStyle={{
                  left: {
                    color: 'black',
                  },
                  right: {
                    color: 'black',
                  }
                }}
              />
            )
        }
      }

    scrollToMessage(id) {
        //console.log('scrollToMessage', id);
        //https://github.com/FaridSafi/react-native-gifted-chat/issues/938
        this.chatListRef.current?._messageContainerRef?.current?.scrollToIndex({
            animated: true,
            index: id
          });
    }

    get showChat() {
       if (this.state.selectedContact) {
           if (this.state.selectedContact.tags && this.state.selectedContact.tags.indexOf('blocked') > -1) {
               return false;
           }

           if (this.state.selectedContact.uri.indexOf('@guest.') > -1) {
               return false;
           }

           if (this.state.selectedContact.uri.indexOf('anonymous@') > -1) {
               return false;
           }
       }

       let username = this.state.targetUri ? this.state.targetUri.split('@')[0] : null;
       let isPhoneNumber = username ? username.match(/^(\+|0)(\d+)$/) : false;

       if (isPhoneNumber) {
           return false;
       }

       if (this.props.selectedContact) {
           return true;
       }

       return false;
    }

    ssi2GiftedChat(from_uri, content, timestamp) {
        let id = uuid.v4();

        let msg;

        msg = {
            _id: id,
            key: id,
            text: content,
            createdAt: timestamp,
            direction: 'incoming',
            sent: false,
            received: true,
            pending: false,
            system: false,
            failed: false,
            user: {_id: from_uri, name: from_uri}
            }
        return msg;
    }

    getSsiContacts() {
        //console.log('Get SSI contacts');
        let contacts = [];
        if (this.state.ssiCredentials) {
            this.state.ssiCredentials.forEach((item) => {
                let contact = this.props.newContactFunc(item.id, 'Credential');
                contact.ssiCredential = item;
                contact.credential = new Object();

                const schemaId = item.metadata.data['_internal/indyCredential'].schemaId;

                if (schemaId === 'EwAf16U6ZphXsZq6E5qmPz:2:Bloqzone_IDIN_ver5:5.0') {
                    contact.schemaId = schemaId;

                    item.credentialAttributes.forEach((attribute) => {
                        contact.credential[attribute.name] = attribute.value;
                        if (attribute.value.length > 0) {
                            if (attribute.name === 'legalName') {
                                contact.name = attribute.value;
                            } else if (attribute.name === 'acceptDateTime') {
                                contact.timestamp = attribute.value.toDate("dd-mm-yy hh:ii:ss");
                            } else if (attribute.name === 'createdAt') {
                                contact.timestamp = attribute.value;
                            } else if (attribute.name === 'emailAddress') {
                                contact.email = attribute.value;
                            }
                        }
                    });
                }

                if (contact.credential.initials) {
                    contact.name = contact.credential.initials;
                }

                if (contact.credential.legalName) {
                    contact.name = contact.name  + ' ' + contact.credential.legalName;
                }

                if (contact.credential.dob) {
                    contact.name = contact.name  + ' (' + contact.credential.dob + ')';
                }

                if (contact.credential.birthDate) {
                    contact.name = contact.name  + ' (' + contact.credential.birthDate + ')';
                }

                if (contact.credential.acceptDateTime && item.state === 'done') {
                    contact.lastMessage = 'Credential issued at ' + contact.credential.acceptDateTime + ' (' + item.state + ')';
                }

                contact.tags.push('ssi');
                contact.tags.push('ssi-credential');
                contact.tags.push('readonly');
                contacts.push(contact);
            });
        }

        if (this.state.ssiConnections) {
            this.state.ssiConnections.forEach((item) => {
                //console.log('Contacts SSI connection', item);
                let uri = item.id;
                let contact = this.props.newContactFunc(uri, item.theirLabel);
                contact.credential = new Object();

                contact.timestamp = item.createdAt;

                contact.lastMessage = 'Connection is ' + item.state;
                contact.tags.push('ssi');
                contact.tags.push('ssi-connection');
                contact.ssiConnection = item;
                contacts.push(contact);
            });
        }

        return contacts;
    }

    render() {
        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let ssiContacts = [];
        let messages = this.state.renderMessages;
        let contacts = [];
        //console.log('----');

        //console.log('--- Render contacts with filter', this.state.filter);
        //console.log('--- Render contacts', this.state.selectedContact);
        //console.log(this.state.renderMessages);

        if (this.state.filter === 'ssi') {
            contacts = this.getSsiContacts();
        } else {
            Object.keys(this.state.myContacts).forEach((uri) => {
                contacts.push(this.state.myContacts[uri]);
            });
        }

        //console.log(contacts);

        let chatInputClass = this.customInputToolbar;

        if (this.state.selectedContact) {
           if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }
           if (this.state.selectedContact.tags.indexOf('test') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }

        } else if (!this.state.chat) {
            chatInputClass = this.noChatInputToolbar;
        }

        if (!this.state.selectedContact && this.state.filter) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri, [this.state.filter]));
        } else {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
            searchExtraItems = searchExtraItems.concat(this.state.contacts);

            if (this.state.targetUri && this.state.targetUri.length > 2 && !this.state.selectedContact && !this.state.inviteContacts) {
                matchedContacts = searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri));
            } else if (this.state.selectedContact && this.state.selectedContact.type === 'contact') {
                matchedContacts.push(this.state.selectedContact);
            } else if (this.state.selectedContact) {
                items = [this.state.selectedContact];
            }

            items = items.concat(matchedContacts);
        }

        if (this.state.targetUri) {
            items = items.concat(this.searchedContact(this.state.targetUri, this.state.selectedContact));
        }

        if (this.state.filter && this.state.targetUri) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
        }


        const known = [];
        items = items.filter((elem) => {
            //console.log(elem.uri);
            if (this.state.shareToContacts && elem.tags.indexOf('test') > -1) {
                //console.log('Remove', elem.uri, 'test');
                return;
            }

            if (this.state.inviteContacts && elem.tags.indexOf('conference') > -1 ) {
                //console.log('Remove', elem.uri, 'conf');
                return;
            }

            if (this.state.shareToContacts && elem.uri === this.state.accountId) {
                //console.log('Remove', elem.uri, 'myself');
                return;
            }

            if (this.state.accountId === elem.uri && elem.tags.length === 0) {
                //console.log('Remove', elem.uri, 'no tags');
                return;
            }

            if (this.state.shareToContacts && elem.uri.indexOf('@') === -1) {
                //console.log('Remove', elem.uri, 'no @');
                return;
            }

            if (known.indexOf(elem.uri) <= -1) {
                known.push(elem.uri);
                return elem;
            }
        });

        items.forEach((item) => {
            item.showActions = false;

            if (item.uri.indexOf('@videoconference.') === -1) {
                item.conference = false;
            } else {
                item.conference = true;
            }

            if (this.state.selectedContacts && this.state.selectedContacts.indexOf(item.uri) > -1) {
                item.selected = true;
            } else {
                item.selected = false;
            }

        });

        let filteredItems = [];
        items.reverse();
        var todayStart = new Date();
        todayStart.setHours(0,0,0,0);

        var yesterdayStart = new Date();
        yesterdayStart.setDate(todayStart.getDate() - 2);
        yesterdayStart.setHours(0,0,0,0);

        items.forEach((item) => {
            const fromDomain = '@' + item.uri.split('@')[1];

            if (this.state.periodFilter === 'today') {
                if(item.timestamp < todayStart) {
                    return;
                }
            }

            if (item.uri === 'anonymous@anonymous.invalid' && this.state.filter !== 'blocked') {
                return;
            }

            if (this.state.periodFilter === 'yesterday') {
                if(item.timestamp < yesterdayStart || item.timestamp > todayStart) {
                    return;
                }
            }

            if (this.state.inviteContacts && item.uri.indexOf('@videoconference.') > -1) {
                return;
            }

            if (item.uri === this.state.accountId && !item.direction) {
                return;
            }

            if (this.state.filter && item.tags.indexOf(this.state.filter) > -1) {
                filteredItems.push(item);
            } else if (this.state.blockedUris.indexOf(item.uri) === -1 && this.state.blockedUris.indexOf(fromDomain) === -1) {
                filteredItems.push(item);
            }

            //console.log(item.uri, item.tags);

        });

        items = filteredItems;
        items.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1)

        if (items.length === 1) {
            items[0].showActions = true;
            if (items[0].tags.indexOf('ssi-credential') > -1) {
                let content = '';
                let m;

                chatInputClass = this.noChatInputToolbar;

                items[0].ssiCredential.credentialAttributes.forEach((attribute) => {
                    content = content + attribute.name + ": " + attribute.value + '\n';
                });

                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI credential body' , items[0].timestamp);
                m.system = true;
                messages.push(m);

                content = '';
                content = content + 'Id: ' + items[0].ssiCredential.id;
                content = content + '\nState: ' + items[0].ssiCredential.state;
                content = content + '\nSchema Id:' + items[0].schemaId;

                let issuer = this.state.ssiConnections.filter(x => x.id === items[0].ssiCredential.connectionId);

                if (issuer.length === 1) {
                    content = content + '\nIssuer: ' + issuer[0].theirLabel;
                } else {
                    content = content + '\nIssuer: : ' + items[0].ssiCredential.connectionId;
                }

                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI credential details' , items[0].timestamp);
                m.system = true;
                messages.push(m);
            }

            if (items[0].tags.indexOf('ssi-connection') > -1) {
                let content = '';
                let m;

                m = this.ssi2GiftedChat(items[0].uri, 'SSI messages' , items[0].timestamp);
                m.system = true;
                messages.push(m);

                chatInputClass = this.noChatInputToolbar;

                content = 'Role: ' + items[0].ssiConnection.role;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'State: ' + items[0].ssiConnection.state;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'Multiple use: ' + items[0].ssiConnection.multiUseInvitation;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                if (items[0].ssiConnection.mediatorId) {
                    content = 'Mediator: ' + items[0].ssiConnection.mediatorId;
                    m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                    messages.push(m);
                }

                content = 'Id: ' + items[0].ssiConnection.id;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'Did: ' + items[0].ssiConnection.did;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'From: ' + items[0].ssiConnection.theirLabel;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI connection details' , items[0].timestamp);
                m.system = true;
                messages.push(m);
            }
        }

        let columns = 1;

        if (this.state.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        const contactsContainer = this.props.orientation === 'landscape' ? styles.contactsLandscapeContainer : styles.contactsPortraitContainer;
        const borderClass = (messages.length > 0 && !this.state.chat) ? styles.chatBorder : null;

        let pinned_messages = [];
        if (this.state.pinned) {
            messages.forEach((m) => {
                if (m.pinned) {
                    pinned_messages.push(m);
                }
            });
            messages = pinned_messages;
            if (pinned_messages.length === 0) {
                let msg = {
                    _id: uuid.v4(),
                    text: 'No pinned messages found. Touch individual messages to pin them.',
                    system: true
                }
                pinned_messages.push(msg);
            }
        }

        let showLoadEarlier = (this.state.myContacts && this.state.selectedContact && this.state.selectedContact.uri in this.state.myContacts && this.state.myContacts[this.state.selectedContact.uri].totalMessages && this.state.myContacts[this.state.selectedContact.uri].totalMessages > messages.length) ? true: false;

        messages.forEach((m) => {
        });

        return (
            <SafeAreaView style={container}>
              {items.length === 1 ?
              (this.renderItem(items[0]))
             :
              <FlatList
                horizontal={false}
                numColumns={columns}
                onRefresh={this.getServerHistory}
                onLongPress={this.onLongMessagePress}
                refreshing={this.state.isRefreshing}
                data={items}
                renderItem={this.renderItem}
                listKey={item => item.id}
                key={this.props.orientation}
                loadEarlier
             />
             }

             {this.showChat && !this.state.inviteContacts?
             <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
                  messages={messages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onMessagePress}
                  renderInputToolbar={chatInputClass}
                  renderBubble={renderBubble}
                  renderMessageText={this.renderMessageText}
                  renderMessageImage={this.renderMessageImage}
                  renderMessageAudio={this.renderMessageAudio}
                  renderMessageVideo={this.renderMessageVideo}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  renderActions={this.renderCustomActions}
                  renderTime={this.renderTime}
                  placeholder={this.state.placeholder}
                  lockStyle={styles.lock}
                  renderSend={this.renderSend}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  maxInputLength={16000}
                  tickStyle={{ color: 'green' }}
                  infiniteScroll
                  loadEarlier={showLoadEarlier}
                  isLoadingEarlier={this.state.isLoadingEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                  isTyping={this.state.isTyping}
                  onInputTextChanged={text => this.chatInputChanged(text)}
                />
              </View>
              : (items.length === 1) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
                  messages={messages}
                  renderInputToolbar={() => { return null }}
                  renderBubble={renderBubble}
                  renderMessageText={this.renderMessageText}
                  renderMessageImage={this.renderMessageImage}
                  renderMessageAudio={this.renderMessageAudio}
                  renderMessageVideo={this.renderMessageVideo}
                  onSend={this.onSendMessage}
                  lockStyle={styles.lock}
                  onLongPress={this.onLongMessagePress}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  onPress={this.onMessagePress}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  timeTextStyle={{ left: { color: 'red' }, right: { color: 'black' } }}
                  infiniteScroll
                  loadEarlier={showLoadEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                />
              </View>
              : null
              }

            <DeleteMessageModal
                show={this.state.showDeleteMessageModal}
                close={this.closeDeleteMessageModal}
                contact={this.state.selectedContact}
                deleteMessage={this.props.deleteMessage}
                message={this.state.currentMessage}
            />

            <MessageInfoModal
                show={this.state.showMessageModal}
                message={this.state.message}
                close={this.closeMessageModal}
            />

            <EditMessageModal
                show={this.state.showEditMessageModal}
                message={this.state.message}
                close={this.closeEditMessageModal}
                sendEditedMessage={this.sendEditedMessage}
            />

            <ShareMessageModal
                show={this.state.showShareMessageModal}
                message={this.state.message}
                close={this.toggleShareMessageModal}
            />

            </SafeAreaView>
        );
    }
}

ContactsListBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    config          : PropTypes.object.isRequired,
    targetUri       : PropTypes.string,
    selectedContact : PropTypes.object,
    contacts        : PropTypes.array,
    chat            : PropTypes.bool,
    orientation     : PropTypes.string,
    setTargetUri    : PropTypes.func,
    isTablet        : PropTypes.bool,
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    saveHistory     : PropTypes.func,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    saveConference  : PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    filter          : PropTypes.string,
    periodFilter    : PropTypes.string,
    defaultDomain   : PropTypes.string,
    saveContact     : PropTypes.func,
    myContacts      : PropTypes.object,
    messages        : PropTypes.object,
    getMessages     : PropTypes.func,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    deleteMessage   : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    deleteMessages   : PropTypes.func,
    sendPublicKey   : PropTypes.func,
    inviteContacts  : PropTypes.bool,
    shareToContacts   : PropTypes.bool,
    selectedContacts: PropTypes.array,
    toggleBlocked   : PropTypes.func,
    togglePinned    : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    messageZoomFactor: PropTypes.string,
    isTyping        : PropTypes.bool,
    fontScale       : PropTypes.number,
    call            : PropTypes.object,
    ssiCredentials  : PropTypes.array,
    ssiConnections  : PropTypes.array,
    keys            : PropTypes.object,
    downloadFunc    : PropTypes.func,
    decryptFunc     : PropTypes.func,
    forwardMessageFunc: PropTypes.func,
    messagesCategoryFilter: PropTypes.string,
    requestCameraPermission: PropTypes.func
};


export default ContactsListBox;
exports.renderBubble = renderBubble;
