import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Modal, Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, Platform, PermissionsAndroid, Switch, StyleSheet, TextInput, TouchableOpacity, BackHandler, TouchableHighlight} from 'react-native';
import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble, MessageText, Send, InputToolbar, MessageImage, Time, Composer} from 'react-native-gifted-chat'
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
import { IconButton, Checkbox} from 'react-native-paper';
import ImageViewer from 'react-native-image-zoom-viewer';
import path from 'react-native-path';
import KeyboardSpacer from 'react-native-keyboard-spacer';
import { Keyboard } from 'react-native';
import { StatusBar } from 'react-native';
import { createThumbnail } from "react-native-create-thumbnail";
import { createThumbnailSafe } from '../thumbnailService';

import * as Progress from 'react-native-progress';

import ChatBubble from './ChatBubble'

import moment from 'moment';
import momenttz from 'moment-timezone';
import Video from 'react-native-video';
import VideoPlayer from 'react-native-video-player';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-camera-roll/camera-roll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import AudioRecord from 'react-native-audio-record';
import FastImage from 'react-native-fast-image';
import { ActivityIndicator, Animated } from 'react-native';
import dayjs from 'dayjs';

import styles from '../assets/styles/ContactsListBox';
import Share from 'react-native-share';


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

const getAudioDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    const sound = new Sound(filePath, '', (error) => {
      if (error) {
        console.log('Failed to load the audio', error);
        return resolve(0);
      }
      resolve(sound.getDuration()); // duration in seconds
    });
  });
};

const audioRecorderPlayer = new AudioRecorderPlayer();

class ContactsListBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.chatListRef = React.createRef();
        this.flatListRef = null;
        this.default_placeholder = 'Type a message...'
                
        this.state = {
            accountId: this.props.account ? this.props.account.id : null,
            password: this.props.password,
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            sortBy: this.props.sortBy,
            isLandscape: this.props.isLandscape,
            contacts: this.props.contacts,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory,
            selectedContact: this.props.selectedContact,
            myContacts: this.props.myContacts,
            messages: this.props.messages,
            renderMessages: [],
            filteredMessages: [],
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
            keys: this.props.keys,
            playing: false,
            texting: false,
            sharingAsset: null,
            sharingAssetMessage: null,
            placeholder: this.default_placeholder,
            audioSendFinished: false,
            messagesCategoryFilter: this.props.messagesCategoryFilter,
            isTexting: this.props.isTexting,
            sourceContact: this.props.sourceContact,
            audioDurations: {},
            searchMessages: this.props.searchMessages,
            searchString: this.props.searchString,
            replyingTo: null,
            keyboardVisible: false,
            bubbleWidths: {},
            dark: this.props.dark,
			messagesMetadata: this.props.messagesMetadata || {},
			mediaLabels: {},
			mediaRotations: {},
			text: '',
			fullSize: false,
			expandedImage: null,
			fullScreen: this.props.fullScreen,
			visibleMessageIds: [], 
			renderedMessageIds: new Set(),
			imageLoadingState: {},
			rotation: 0,
			gettingSharedAsset: false,
			videoLoadingState: {},
			transferProgress: this.props.transferProgress,
		    showVideoModal: false,
		    modalVideoUri: null,
		    videoMetaCache: {},
		    videoPlayingState: {},
		    audioPlayingState: {},
		    totalMessageExceeded: false,
		    videoPaused: true,
			focusedMessages: null,  // array of currently rendered messages in focus mode
			prevMessages: [],        // older messages before the focused message
			nextMessages: [],        // newer messages after the focused message
			focusedMessageId: null,  // the message ID currently in focus
			loadedMinIndex: null,      // lowest index loaded in focusedMessages
		    loadedMaxIndex: null,      // highest index loaded in focusedMessages
        }

        this.ended = false;
        this.prevValues = {};
        this.viewabilityConfig = { itemVisiblePercentThreshold: 20 };
        this.imageSizeCache = {};
		this.currentOffset = 0;

        BackHandler.addEventListener('hardwareBackPress', this.backPressed);
    }

    componentDidMount() {
        this.keyboardDidShowListener = Keyboard.addListener(
              'keyboardDidShow',
              this._keyboardDidShow
            );
        this.keyboardDidHideListener = Keyboard.addListener(
              'keyboardDidHide',
              this._keyboardDidHide
            );

        this.ended = false;
    }

    componentWillUnmount() {
        this.keyboardDidShowListener.remove();
        this.keyboardDidHideListener.remove();

        this.ended = true;
    }

	  handleBubbleLayout = (id, event) => {
		const width = event.nativeEvent.layout.width;
		this.setState(prev => ({
		  bubbleWidths: { ...prev.bubbleWidths, [id]: width },
		}));
	  };
  
    backPressed() {
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }
        
        //console.log('Update contacts', nextProps.selectedContact);

        if (nextProps.myInvitedParties !== this.state.myInvitedParties) {
            this.setState({myInvitedParties: nextProps.myInvitedParties});
        }

        if (nextProps.contacts !== this.state.contacts) {
            this.setState({contacts: nextProps.contacts});
        }

        if (nextProps.sortBy !== this.state.sortBy) {
            this.setState({sortBy: nextProps.sortBy});
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

        if (nextProps.hasOwnProperty('keyboardVisible')) {
            this.setState({keyboardVisible: nextProps.keyboardVisible});
        }

        //if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
        //};

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
        
        // load only messages that have changed
		if (nextProps.selectedContact) {
		  const uri = nextProps.selectedContact.uri;

		  if (uri in nextProps.messages) {
			let newMessages = nextProps.messages[uri] || [];
			const oldMessages = this.state.renderMessages || [];
		
			// Sort newest → oldest
			newMessages = newMessages.sort(function (a, b) {
			  if (a.createdAt < b.createdAt) return 1;
			  if (a.createdAt > b.createdAt) return -1;
			  if (a.createdAt === b.createdAt) {
				if (a.msg_id < b.msg_id) return 1;
				if (a.msg_id > b.msg_id) return -1;
			  }
			  return 0;
			});
			
			// Quick check for different length or IDs
			const sameLength = oldMessages.length === newMessages.length;
			const idsEqual =
			  sameLength && oldMessages.every((m, i) => m._id === newMessages[i]._id);
		
			this.setState({isLoadingEarlier: false});
		
			// Detect individual changes
			const changedIds = [];
			if (idsEqual) {
			  for (let i = 0; i < newMessages.length; i++) {
				const a = oldMessages[i];
				const b = newMessages[i];
				if (
				  a.pending !== b.pending ||
				  a.sent !== b.sent ||
				  a.received !== b.received ||
				  a.failed !== b.failed ||
				  a.pinned !== b.pinned ||
				  a.text !== b.text ||
				  a.image !== b.image ||
				  a.video !== b.video ||
				  a.audio !== b.audio
				) {
				  changedIds.push(a._id);
				}
			  }
			}

			// === INITIAL LOAD ===
			if (oldMessages.length === 0 && newMessages.length > 0) {
			  console.log("Rendering initial messages");
			  this.exitFocusMode();
	
			  this.setState({
				renderMessages: newMessages,
				scrollToBottom: true,
			  });
		
			  this.props.confirmRead(uri, "initial_load");
			  return;
			}

			// === MERGE / UPDATE ===
			if (!idsEqual || changedIds.length > 0) {
			  //console.log("Changed message IDs:", changedIds);
		
			  // Merge shallowly to preserve refs
			  const merged = newMessages.map((m, i) =>
				idsEqual && !changedIds.includes(m._id) ? oldMessages[i] : m
			  );

			  console.log('must update renderMessages');
			  this.setState({
				renderMessages: merged
			  });
		
			  this.props.confirmRead(uri, "new_messages");
			}
		  }
		} else if (!nextProps.selectedContact) {
		      //console.log('no selected contact anymore')
			  this.setState({
				renderMessages: [],
				filteredMessages: []
			  });
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
                       messagesCategoryFilter: nextProps.messagesCategoryFilter,
                       targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : nextProps.targetUri,
                       keys: nextProps.keys,
                       sourceContact: nextProps.sourceContact,
                       isTexting: nextProps.isTexting,
                       showDeleteMessageModal: nextProps.showDeleteMessageModal,
                       selectMode: nextProps.shareToContacts || nextProps.inviteContacts,
                       searchMessages: nextProps.searchMessages,
                       searchString: nextProps.searchString,
                       dark: nextProps.dark,
                       messagesMetadata: nextProps.messagesMetadata || {},
                       fullScreen: nextProps.fullScreen,
					   transferProgress: nextProps.transferProgress,
					   totalMessageExceeded: nextProps.totalMessageExceeded
					});

        if (nextProps.isTyping) {
            setTimeout(() => {
                this.setState({isTyping: false});
            }, 3000);
        }
    }

    _keyboardDidShow(e) {
       this.setState({keyboardVisible: true, keyboardHeight: e.endCoordinates.height});
    }

    _keyboardDidHide() {
        this.setState({keyboardVisible: false, keyboardHeight: 0, replyingTo: null});
        this.textInputRef?.blur();
    }

	  getAudioDuration = (filePath, messageId) => {
		const Sound = require('react-native-sound'); // import dynamically
		const sound = new Sound(filePath, '', (error) => {
		  if (error) {
			console.log('Failed to load the audio', error);
			return;
		  }
		  let duration = Math.floor(sound.getDuration());
		  this.setState((prevState) => ({
			audioDurations: {
			  ...prevState.audioDurations,
			  [messageId]: duration,
			},
		  }));
		});
	  };
  
    async aquireFromCamera() {
        console.log('aquireFromCamera');
		this.setState({gettingSharedAsset: true}); 

		setTimeout(() => {
			this._aquireFromCamera();
		}, 100); // delay in ms (1000 = 1 second)

    }

    async _aquireFromCamera() {
		const cameraAllowed = await this.props.requestCameraPermission();
		if (cameraAllowed) {
			let options = {maxWidth: 2000,
							maxHeight: 2000,
							mediaType: 'mixed',
							quality:0.8,
							cameraType: 'front',
							formatAsMp4: true
						   }

			this.props.contactStartShare();
			launchCamera(options, this.assetSharingCallback);
		}
	}

    async launchImageLibrary() {
	    console.log('launchImageLibrary');
        this.setState({gettingSharedAsset: true});
		setTimeout(() => {
			this._launchImageLibrary();
		}, 200); // delay in ms (1000 = 1 second)
	}

	async _launchImageLibrary() {
        let options = {maxWidth: 2000,
                        maxHeight: 2000,
                        mediaType: 'mixed',
                        formatAsMp4: true
                       }

		this.props.contactStartShare()
        await launchImageLibrary(options, this.libraryCallback);
    }

    async libraryCallback(result) {
		this.setState({fullSize: false, gettingSharedAsset: false});

        if (!result.assets || result.assets.length === 0) {
            return;
        }

        result.assets.forEach((asset) => {
            this.assetSharingCallback({assets: [asset]});
        });
    }

    async assetSharingCallback(result) {
        console.log('assetSharingCallback');
		this.setState({scrollToBottom: true, gettingSharedAsset: false});

        if (!result.assets || result.assets.length === 0) {
            return;
        }
        
        let asset = result.assets[0];
        asset.preview = true;
        
        let msg = await this.props.file2GiftedChat(asset);

        let assetType = 'file';
        if (msg.video) {
            assetType = 'movie';
        } else if (msg.image) {
            assetType = 'photo';
        }

        console.log(msg);

        this.setState({ sharingAsset: asset,
                        sharingAssetMessage: msg,
                        renderMessages: GiftedChat.append(this.state.renderMessages, [msg]),
						fullSize: false,
                        //placeholder: 'Send ' + assetType + ' of ' + utils.beautySize(msg.metadata.filesize)
						placeholder: 'Add a note...'
                        });
    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} 
         recordAudio={this.props.recordAudio} 
         texting={this.state.texting || this.state.replyingTo} 
         sendingImage={this.state.sharingAssetMessage !==null} 
         selectedContact={this.state.selectedContact}/>
    )

    chatInputChanged(text) {
       this.setState({texting: (text.length > 0), text: text})
    }

    resetContact() {
        this.setState({
            texting: false,
            sharingAsset: null,
            sharingAssetMessage: null,
            placeholder: this.default_placeholder
        });
    }


	renderBubbleWithMessages = (props) => {
	  return this.renderBubble({ ...props, messages: this.state.filteredMessages });
	};


	renderBubble(props) {
	  return (
		<ChatBubble
		  props={props}
		  messages={this.state.renderMessages}
		  bubbleWidths={this.state.bubbleWidths}
		  videoMetaCache={this.state.videoMetaCache}
		  visibleMessageIds={this.state.visibleMessageIds}
		  videoPlayingState={this.state.videoPlayingState}
		  audioPlayingState={this.state.audioPlayingState}
		  handleBubbleLayout={this.handleBubbleLayout.bind(this)}
		  scrollToMessage={this.goToMessage.bind(this)}
		  transferProgress={this.state.transferProgress}
		  focusedMessageId={this.state.focusedMessageId}
		  fullSize={this.state.fullSize}
		  styles={styles}
		  playing={this.state.playing}
		  renderMessageImage={this.renderMessageImage}
		  renderMessageVideo={this.renderMessageVideo}
		  renderMessageAudio={this.renderMessageAudio}
		  renderMessageText={this.renderMessageText}
		/>
	  );
	}
	
	onImagePress = (message) => {
	  const { expandedImage } = this.state;
	  console.log('onImagePress', 'fullScreen', this.state.fullScreen);

	  if (expandedImage) {
		this.props.setFullScreen(false);
		this.saveRotation(expandedImage);
		this.setState({ expandedImage: null});
		
	  } else {
	    let rotation = 0;
		this.props.setFullScreen(true);
		if (message._id in this.state.mediaRotations) {
			rotation = this.state.mediaRotations[message._id];
		}
		this.setState({ expandedImage: message, rotation: rotation});
	  }
	};

	// Custom Input Toolbar
	customInputToolbar = (props) => {
	  const { replyingTo } = this.state;
	
	  return (
		<InputToolbar
		  {...props}
		  containerStyle={styles.inputToolbar} // full width
		  renderActions={!replyingTo ? this.renderCustomActions : null} // left buttons
		  renderComposer={(composerProps) => this.renderComposer(composerProps, replyingTo)}
		/>
	  );
	};

	renderComposer = (composerProps, replyingTo) => {
	  if (!this.state.selectedContact) {
		  return;
	  }
	  
	  function capitalizeFirstLetter(str) {
		if (!str) return "";
		return str[0].toUpperCase() + str.slice(1);
	  }
	
	  let name = this.state.selectedContact.uri;
	  if (this.state.selectedContact.name) {
		name = this.state.selectedContact.name;
	  } else {
		name = capitalizeFirstLetter(name.split('@')[0]);
	  }
	
	  return (
		<View style={{ flex: 1}}>
	
		  {/* Full-width Reply Preview */}
		  {replyingTo && (
			<View style={[styles.replyPreviewContainer, 
			    {
				  borderWidth: 0,
				  marginBottom: 5,           // spacing below
				  marginTop: 5,              // optional spacing above
				  paddingVertical: 6,        // inner vertical padding
				  paddingHorizontal: 8,      // optional horizontal padding
				  position: 'relative',
				  borderBottomWidth: 1,
				  borderBottomColor: '#ccc',
				  borderRadius: 8,           // optional rounded corners
				  backgroundColor: '#f9f9f9' // optional background for better visual separation
				},
			]}>
	
			  {/* Vertical orange Line */}
			  <View style={styles.replyLine} />
	
			  {/* Thumbnail for image replies */}
			  {replyingTo.image && (
				<Image
				  source={{ uri: replyingTo.image }}
				  style={{
					width: 40,
					height: 40,
					borderRadius: 4,
					marginRight: 6,
				  }}
				  resizeMode="cover"
				/>
			  )}
	
			  {/* Username + Text (only if not an image reply) */}
			  {!replyingTo.image && (
				<View style={{ flex: 1 }}>
				  <Text
					style={styles.replyText}
					numberOfLines={2}
					ellipsizeMode="tail"
				  >
					{replyingTo.text}
				  </Text>
				</View>
			  )}
	
			  {/* Close Button: positioned top-right */}
			  <TouchableOpacity
				onPress={() => {
				  this.setState({ replyingTo: null });
				  Keyboard.dismiss();
				  composerProps.onTextChanged(""); // clear input
				  this.textInputRef?.blur();
				}}
				style={{
				  position: 'absolute',
				  top: 5,
				  right: 15,
				  zIndex: 10,
				  transform: [{ translateX: 35 }] 
				}}
				activeOpacity={0.9}
			  >
				<View style={styles.closeButtonCircle}>
				  <Icon name="close" size={22} color="#fff" />
				</View>
			  </TouchableOpacity>
	
			</View>
		  )}
	
		  {/* Real TextInput */}
		  <View
			style={{
			  justifyContent: 'center',
			  alignSelf: 'stretch', // make it fill horizontally
			}}
		  >
			<TextInput
			  ref={(r) => (this.textInputRef = r)}
			  style={{
				fontSize: 16,
				borderWidth: 0,
				borderColor: 'red',
				paddingVertical: Platform.OS === 'ios' ? 12 : 10,
				paddingHorizontal: 8,
				lineHeight: 20,
				minHeight: 36,
				maxHeight: 100,
				textAlignVertical: 'center',
				color: '#000',
			  }}
			  placeholder={replyingTo ? 'Reply with...' : this.state.placeholder}
			  placeholderTextColor="#999"
			  multiline
			  onChangeText={composerProps.onTextChanged}
			  value={composerProps.text}
			/>
		  </View>
		</View>
	  );
	};

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

    async handleShare(message, email=false) {
        //console.log('-- handleShare\n', JSON.stringify(message, null, 2));
        let what = 'Message';
		let options = {
			title: 'Share Message',
			subject: 'Sylk shared message',
			message: message.text
		};    

        if (message.metadata && message.metadata.filename) {
            console.log('is a file');
            const { local_url, filename, filetype } = message.metadata;
            what = 'File';
			let newFilename = filename;
			let newLocalUrl = local_url;
	
			if (newFilename.endsWith('.asc')) {
				newFilename = filename.slice(0, -4); // remove last 4 characters
			}

			const now = new Date();
			const pad = (num) => String(num).padStart(2, '0');
			const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
			const ext = newFilename.substring(newFilename.lastIndexOf('.'));

			if (message.image) {
				what = 'Photo';
				newFilename = `${timestamp}-Image${ext}`;
			} else if (utils.isAudio(newFilename)) {
				what = 'Audio message';
				newFilename = `${timestamp}-AudioMessage${ext}`;
			} else if (utils.isVideo(newFilename)) {
				what = 'Video';
				newFilename = `${timestamp}-Video${ext}`;
			}

			if (Platform.OS === 'android') {
				try {
					const destPath = `${RNFS.CachesDirectoryPath}/${newFilename}`;
					await RNFS.copyFile(local_url, destPath);
					newLocalUrl = `file://${destPath}`;
					//const res = await RNFS.readFile(newLocalUrl, 'base64');
					//newLocalUrl = `data:${message.metadata.filetype};base64,${res}`;
				} catch (err) {
					console.log('Error reading file:', err);
					this.props.postSystemNotification('Error reading file: ' + err.message);
					return;
				}
			}

			options = {
				title: 'Share via',
				subject: newFilename ? what + ' ' +newFilename: 'Message',
				url: newLocalUrl,
				type: filetype,
				filename: newFilename
			};
		} else {
            console.log('is a message');
		}

		console.log('-- options\n', JSON.stringify(options, null, 2));
		
		if (email) {
			const subject = encodeURIComponent(options.subject);
			const body = encodeURIComponent(options.message || options.subject);
			const mailtoUrl = `mailto:?subject=${subject}&body=${message.text}`;
			
			Linking.openURL(mailtoUrl).catch((err) => {
			  console.error('Error opening mail app', err);
			});

		} else {		  
			Share.open(options)
				.then((res) => {
					console.log('Sharing finished');
				})
				.catch((error) => {
					console.log('Error sharing data', error);
					if (error.message.indexOf("did not share") === -1) {
						this.props.postSystemNotification('Error sharing data: ' + error.message);
				}   
			});
		}
    }

    async startPlaying(message) {
        if (this.state.playing) {
            console.log('Already playing');
            return;
        }

		this.getAudioDuration(message.audio, message._id);

		const path = message.audio.startsWith('file://') ? message.audio : 'file://' + message.audio;

        try {
			const msg = await audioRecorderPlayer.startPlayer(path);
			this.setState(prev => ({
				audioPlayingState: {
				  ...prev.audioPlayingState,
				  [message._id]: true,
				  placeholder: 'Playing audio message'
				}
			  }));
	
			audioRecorderPlayer.addPlayBackListener((e) => {
				if (e.duration === e.currentPosition) {
					   this.setState(prev => ({
						audioPlayingState: {
						  ...prev.audioPlayingState,
						  [id]: false,
						},
						placeholder: this.default_placeholder
					  }));
					//console.log('Audio playback ended', message.audio);
				}
				this.setState({
					currentPositionSec: e.currentPosition,
					currentDurationSec: e.duration,
					playTime: audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
					duration: audioRecorderPlayer.mmssss(Math.floor(e.duration)),
				});
			});
        } catch (e) {
			console.log('startPlaying error', e);
        }
    };
	
    async stopPlaying(message) {
        //console.log('Audio playback ended', message.audio);
		   this.setState(prev => ({
			audioPlayingState: {
			  ...prev.audioPlayingState,
			  [message._id]: false,
			},
			placeholder: this.default_placeholder
		  }));
		const msg = await audioRecorderPlayer.stopPlayer();
    }

renderSend = (props) => {
  let chatActionContainer = styles.chatActionContainer;

  if (this.state.sharingAsset) {
    return (
      <Send
        {...props}
        containerStyle={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 0,
        }}
      >

        <View style={styles.chatRightActionsContainer}>
          <TouchableOpacity onPress={this.sendPhoto}>
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
      return <View />;
    }

    let showButtons = !this.state.texting && !this.state.replyingTo;
    
    return (
      <Send
        {...props}
        containerStyle={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 0,
        }}
      >
        <View style={styles.chatRightActionsContainer}>
          {showButtons && (
            <TouchableOpacity onPress={this.aquireFromCamera}>
              <Icon
                style={chatActionContainer}
                type="font-awesome"
                name="camera"
                size={20}
                color='gray'
              />
            </TouchableOpacity>
          )}

          {showButtons && (
            <TouchableOpacity onPress={this.launchImageLibrary} onLongPress={this._pickDocument}>
              <Icon
                style={chatActionContainer}
                type="font-awesome"
                name="paperclip"
                size={20}
                color='gray'
              />
            </TouchableOpacity>
          )}

          <Icon
            type="font-awesome"
            name="send"
            style={styles.chatSendArrow}
            size={20}
            color='gray'
          />
        </View>
      </Send>
    );
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
            darkMode={this.state.dark}
            contact={item}
            selectedContact={this.state.selectedContact}
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
            selectMode={this.state.selectMode}
            accountId = {this.state.accountId}
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
        console.log('Load earlier messages...');
        this.setState({scrollToBottom: false, isLoadingEarlier: true});
        this.props.loadEarlierMessages();
    }

    sendEditedMessage(message, text) {
        const mId = uuid.v4();
    
        if (message.contentType === 'application/sylk-file-transfer') {
			let messagesMetadata = this.state.messagesMetadata;

			const transferId = message._id;
			let metadataContent;
			let rotation = 0;

			if (transferId in this.state.mediaLabels) {
				metadataContent = this.state.messagesMetadata[message._id];
				//console.log('old metadataContent', metadataContent);
				rotation = metadataContent.rotation || 0;
				delete messagesMetadata[transferId];
				if (metadataContent.metadataId) {
					this.props.deleteMessage(metadataContent.metadataId, this.state.selectedContact.uri);
				}
			}

			metadataContent = {transferId: transferId, label:text, metadataId: mId, rotation: rotation};
			
			//console.log('old message', message );

			let metadataMessage = {_id: mId,
								   key: mId,
								   createdAt: new Date(),
								   metadata: metadataContent,
								   text: JSON.stringify(metadataContent),
								   };

			messagesMetadata[transferId] = metadataContent;
			//console.log('editMessage metadataContent', metadataContent);
			this.setState({
				messagesMetadata: { ...messagesMetadata }
			});
			this.props.sendMessage(this.state.selectedContact.uri, metadataMessage, 'application/sylk-message-metadata');
        } else {
        
			this.props.deleteMessage(message._id, this.state.selectedContact.uri);

			message._id = mId;
			message.key = mId;
			message.text = text;

			this.props.sendMessage(this.state.selectedContact.uri, message);
        }
    }
    
    onSendMessage(messages) {
		const uri = this.state.selectedContact.uri;
		
		if (this.state.sharingAssetMessage) {
			this.sendPhoto()
			return;
		}

        messages.forEach((message) => {
            //console.log('this.state.replyingTo', this.state.replyingTo);
            if (this.state.replyingTo) {
				const metadataContent = {messageId: message._id, replyId:  this.state.replyingTo._id};
				const mId = uuid.v4();
				const metadataMessage = {_id: mId,
										 key: mId,
										 createdAt: new Date(),
										 metadata: metadataContent,
										 text: JSON.stringify(metadataContent),
										};

                let messagesMetadata = this.state.messagesMetadata;
				messagesMetadata[message._id] = metadataContent;
				this.setState({scrollToBottom: true, messagesMetadata: messagesMetadata});
                this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			}
			message.encrypted = this.state.selectedContact && this.state.selectedContact.publicKey ? 2 : 0;
            this.props.sendMessage(uri, message);
        });
        
        this.setState({replyingTo: null, renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    sendPhoto() {
        // TODO: send photo description if present
        if (!this.state.selectedContact) {
			return;
        }

        if (!this.state.sharingAssetMessage) {
			return;
        }

		try {
			const uri = this.state.selectedContact.uri;
			const text = this.state.text.trim();
			const sharingAssetMessage = this.state.sharingAssetMessage;
	
			this.setState({ text: '' });
			this.textInputRef.clear?.();  // works for plain TextInput
			this.textInputRef.blur?.();   // dismiss keyboard
	
			this.setState({sharingAsset: null, 
						   sharingAssetMessage: null,
						   text: '',
						   texting: false,
						   placeholder: this.default_placeholder});
						   
			console.log('sendPhoto with label', text || 'Photo');
	
			if (text) {
				const transfer_id = sharingAssetMessage.metadata.transfer_id;
				const mId = uuid.v4();
				const metadataContent = {transferId: transfer_id, label: text, metadataId: mId};
				const metadataMessage = {_id: mId,
										 key: mId,
										 createdAt: new Date(),
										 metadata: metadataContent,
										 text: JSON.stringify(metadataContent),
										};
	
				console.log('metadataMessage', metadataMessage);
	
				let messagesMetadata = this.state.messagesMetadata;
				messagesMetadata[transfer_id] = metadataContent;
				console.log('sendPhoto metadataContent', metadataContent);
	
				this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
				this.setState({scrollToBottom: true,
							   messagesMetadata: messagesMetadata}
							   );
			}
		} catch (e) {
			console.log('error', e);
		}

        this.uploadFile(this.state.sharingAssetMessage);
    }

	saveRotation(message) {
	    let metadataContent;
		console.log('rotation', this.state.rotation, message._id);
		const uri = this.state.selectedContact.uri;

		setTimeout(() => this.scrollToMessage(message._id) , 100);
		
		if (!uri) {
			return;
		}
		
		if (!message) {
			return;
		}

		const transferId = message.metadata.transfer_id;
		let messagesMetadata = this.state.messagesMetadata;
		
		const mId = uuid.v4();
		if (message._id in messagesMetadata) {
			metadataContent = messagesMetadata[message._id];
			console.log('old metadataContent', metadataContent);

			if (metadataContent.rotation === this.state.rotation) {
			    console.log('No rotation changes');
				return;
			}

			delete messagesMetadata[message._id];
			// remove old metadata message
			this.props.deleteMessage(metadataContent.metadataId, uri);

			metadataContent.rotation = this.state.rotation;
			metadataContent.metadataId = mId;

		} else {
		    if (this.state.rotation == 0) {
			    console.log('No rotation changes');
				return;
		    }
			metadataContent = {transferId: transferId, 
			                   label: 'Photo ', 
			                   metadataId: mId, 
			                   rotation: this.state.rotation};
		}
		
		const metadataMessage = {_id: mId,
								 key: mId,
								 createdAt: new Date(),
								 metadata: metadataContent,
								 text: JSON.stringify(metadataContent),
								};

		messagesMetadata[transferId] = metadataContent;
		console.log('saveRotation metadataContent', metadataContent);

		this.setState({
			messagesMetadata: { ...messagesMetadata }
		});

		this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
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

    deleteSharingAsset() {
        console.log('deleteSharingAsset');
		this.setState({gettingSharedAsset: false}); 

        if (!this.state.sharingAsset) {
			return;
        }

		const fileUri = this.state.sharingAsset.uri.replace('file://', ''); // remove scheme
		  RNFS.unlink(fileUri)
		  .then(() => console.log('Temp file deleted'))
		  .catch(err => console.log('Error deleting temp file', err));

		this.setState(prevState => ({
		  placeholder: this.default_placeholder,
		  sharingAssetMessage: null,
		  sharingAsset: null,
		  text: ''
		}));
		
		this.props.contactStopShare();

		this.textInputRef.clear?.();  // works for plain TextInput
		this.textInputRef.blur?.();   // dismiss keyboard
    }

    async _pickDocument() {
         console.log('_pickDocument');
        const storageAllowed = await this.props.requestStoragePermission();

        if (!storageAllowed) {
            return;
        }

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

            let msg = await this.props.file2GiftedChat(fileUri);
            this.uploadFile(msg);

          } catch (err) {
            if (DocumentPicker.isCancel(err)) {
              console.log('User cancelled file picker');
            } else {
              console.log('DocumentPicker err => ', err);
              throw err;
            }
        }
    };

	renderMessageAudio = (props) => {
	  const { currentMessage } = props;
	  const { audioDurations } = this.state;
	
	  // Load duration if not already loaded
	  if (currentMessage.audio && !audioDurations[currentMessage._id]) {
		// this.getAudioDuration(currentMessage.audio, currentMessage._id);
	  }
	
	  // Get duration string
	  const durationLabel = audioDurations[currentMessage._id]
		? `Recording of ${audioDurations[currentMessage._id]}s`
		: 'Recording';
	
	  const isIncoming = currentMessage.direction === 'incoming';
	  const labelPadding =  isIncoming ? {paddingLeft: 10} : {paddingLeft: 0};

      const isPlaying = this.state.audioPlayingState[currentMessage._id];

	  return (
		<View
		  style={[
			styles.audioContainer,
			{ flexDirection: 'row', alignItems: 'center', justifyContent: !isIncoming ? 'flex-end' : 'flex-start'},
		  ]}
		>
		  {/* Icon on left for incoming, right for outgoing */}
		  {isIncoming && (
			<TouchableHighlight style={[styles.roundshape, {marginLeft: 10, marginTop: 10}]}>
			  <IconButton
				size={28}
				onPress={() =>
				  isPlaying
					? this.stopPlaying(currentMessage)
					: this.startPlaying(currentMessage)
				}
				style={styles.playAudioButton}
				icon={isPlaying? 'pause' : 'play'}
			  />
			</TouchableHighlight>
		  )}
	
		  {/* Text grows naturally */}
		  <Text
			style={[
			  styles.audioLabel,
			  { marginHorizontal: 8, flexShrink: 1},
			  labelPadding
			  , // prevents overflow
			]}
		  >
			{durationLabel}
		  </Text>
	
		  {!isIncoming && (
			<TouchableHighlight style={[styles.roundshape, {marginRight: 10, marginTop: 10}]}>
			  <IconButton
				size={28}
				onPress={() =>
				  isPlaying
					? this.stopPlaying(currentMessage)
					: this.startPlaying(currentMessage)
				}
				style={[styles.playAudioButton]}
				icon={isPlaying ? 'pause' : 'play'}
			  />
			</TouchableHighlight>
		  )}
		</View>
	  );
	};
	
	
	
	renderMessageImage = (props) => {
	  const { currentMessage } = props;
	  if (!currentMessage?.image) return null;
	
	  const id = currentMessage._id;
	  const uri = currentMessage.image;

	
	  const isVisible = this.state.visibleMessageIds.includes(id);
	  const wasRendered = this.state.renderedMessageIds.has(id);
	  const isLoading = this.state.imageLoadingState[id];

	  // Skip offscreen images
	  if (!isVisible && !wasRendered) {
		return (
		  <View
			style={{
			  width: '100%',
			  height: Dimensions.get('window').width,
			  backgroundColor: '#eee',
			  justifyContent: 'center',
			  alignItems: 'center',
			}}
		  >
			<ActivityIndicator size="small" color="#999" />
		  </View>
		);
	  }
	
	  let rotation = 0;
	  if (id in this.state.mediaRotations) {
		rotation = this.state.mediaRotations[id];
	  }
	
	  const isVerticalRotation = rotation === 90 || rotation === 270;
	  const windowWidth = Dimensions.get('window').width;
	  	
	  // 🧠 Try to get cached size
	  let imageAspectRatio = 1;
	  if (this.imageSizeCache[uri]) {
		imageAspectRatio = this.imageSizeCache[uri].aspectRatio;
	  } else {
		// First time seeing this image
		  Image.getSize(
			uri,
			(width, height) => {
			  const aspectRatio =
				width > 0 && height > 0 ? width / height : 1; // ✅ ensure finite ratio
			  this.imageSizeCache[uri] = { width, height, aspectRatio };
			  this.forceUpdate?.(); // re-render
			},
			(error) => {
			  //console.warn("Image.getSize error:", error);
			  this.imageSizeCache[uri] = { width: 1, height: 1, aspectRatio: 1 }; // ✅ fallback cache
			}
		  );
	  
	  }
	
	  const displayAspect = isVerticalRotation ? 1 / imageAspectRatio : imageAspectRatio;
	
	const safeRatio =
	  imageAspectRatio && isFinite(imageAspectRatio) ? imageAspectRatio : 1;
		
	  return (
		<TouchableOpacity
		  activeOpacity={0.8}
		  onPress={() => this.onImagePress(currentMessage)}
		  style={{
			width: '100%',
			justifyContent: 'center',
			alignItems: 'center',
			marginBottom: -5,
		  }}
		>
		  {isLoading && (
			<View
			  style={{
				position: 'absolute',
				zIndex: 2,
				top: 0,
				bottom: 0,
				left: 0,
				right: 0,
				justifyContent: 'center',
				alignItems: 'center',
			  }}
			>
			  <ActivityIndicator size="large" color="#aaa" />
			</View>
		  )}
	
		  <View
			style={{
			  width: '100%',
			  aspectRatio: safeRatio,
			  justifyContent: 'center',
			  alignItems: 'center',
			  overflow: 'hidden',
			  backgroundColor: '#000', // avoids white edges during rotation
			}}
		  >
			<FastImage
			  style={{
				width: '100%',
				height: '100%',
				opacity: isLoading ? 0.5 : 1,
				transform: [{ rotate: `${rotation}deg` }],
			  }}
			  source={{
				uri,
				priority: FastImage.priority.normal,
			  }}
			  resizeMode={FastImage.resizeMode.contain}
			  onLoadStart={() => this.handleImageLoadStart(id)}
			  onLoadEnd={() => this.handleImageLoadEnd(id)}
			/>
		  </View>
		</TouchableOpacity>
	  );
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
		this.props.contactStopShare();
       console.log("The transfer has been canceled by the user.");
       this.postChatSystemMessage('Upload has canceled')
    }

    async uploadFile(msg) {
		this.props.contactStopShare();
        msg.metadata.preview = false;
	    msg.metadata.fullSize = this.state.fullSize;
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
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
        if (message.metadata && message.metadata.preview) {
			return;
        }
        
        console.log('onMessagePress');
    
        if (message.metadata && message.metadata.filename) {
            //console.log('File metadata', message.metadata.filename);
            let file_transfer = message.metadata;
            if (!file_transfer.local_url) {
				if (!file_transfer.path) {
					console.log('File not yet downloaded');
					this.props.downloadFile(message.metadata, true);
					return;
				} else {
					console.log('File not yet uploaded', message.metadata);
					this.uploadFile(message);
				}
                return;
            }
            
            if (!file_transfer.local_url) {
				return;
            }

            RNFS.exists(file_transfer.local_url).then((exists) => {
                if (exists) {
                    if (file_transfer.local_url.endsWith('.asc')) {
                        if (file_transfer.error) {
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
                        this.props.downloadFile(message.metadata, true);
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
            this.startPlaying(message);
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
        
        let icons = [];
        //console.log('---- currentMessage', currentMessage);
        if (currentMessage && currentMessage.text) {

            let options = []
            if (currentMessage.direction == 'incoming') {
				options.push('Reply');
				icons.push(<Icon name="arrow-left" size={20} />);
			}

			if (this.isMessageEditable(currentMessage)) {
				options.push('Edit');
				icons.push(<Icon name="file-document-edit" size={20} />);
			}

            if (currentMessage.metadata && !currentMessage.metadata.error) {
                if (currentMessage.metadata && currentMessage.metadata.local_url) {
                    options.push('Open')
                    icons.push(<Icon name="folder-open" size={20} />);
                //
                } else {
                    options.push('Copy');
                    icons.push(<Icon name="content-copy" size={20} />);
                }
            }

			options.push('Delete');
			icons.push(<Icon name="delete" size={20} />);

            let showResend = currentMessage.metadata && currentMessage.metadata.error;

            if (this.state.targetUri.indexOf('@videoconference') === -1) {
                if (currentMessage.direction === 'outgoing') {
                    if (showResend) {
                        options.push('Resend')
                        icons.push(<Icon name="send" size={20} />);
                    }
                }
            }

            if (currentMessage.pinned) {
                options.push('Unpin');
                icons.push(<Icon name="pin-off" size={20} />);
            } else {
                if (!currentMessage.metadata.error) {
                    options.push('Pin');
                    icons.push(<Icon name="pin" size={20} />);
                }
            }

            if (!currentMessage.metadata.error) {
                options.push('Forward');
                icons.push(<Icon name="arrow-right" size={20} />);
            }

            if (!currentMessage.metadata.error) {
                options.push('Share');
                icons.push(<Icon name="share" size={20} />);
            }
            
            if  (currentMessage && currentMessage.metadata) {
				//console.log('mesage metadata:', currentMessage.metadata);
				if (currentMessage.metadata.filename) {

					    if (!currentMessage.metadata.local_url) {					
							options.push('Download');
							icons.push(<Icon name="cloud-download" size={20} />);
						} else {
						options.push('Download again');
						icons.push(<Icon name="cloud-download" size={20} />);
						/*
						if (currentMessage.metadata.local_url && currentMessage.metadata.local_url.endsWith('.asc')) {
							options.push('Decrypt');
							icons.push(<Icon name="table-key" size={20} />);
						}*/

						}
				} else {
					options.push('Email');
					icons.push(<Icon name="email" size={20} />);
				}
            }

            options.push('Cancel');
            icons.push(<Icon name="cancel" size={20} />);

            let l = options.length - 1;
            

            context.actionSheet().showActionSheetWithOptions({options, l, l, icons, textStyle: styles.actionSheetText}, (buttonIndex) => {
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
                    this.handleShare(currentMessage);
                } else if (action.startsWith('Email')) {
                    this.handleShare(currentMessage, true);
                } else if (action.startsWith('Forward')) {
                    this.props.forwardMessageFunc(currentMessage, this.state.targetUri);
                } else if (action.startsWith('Reply')) {
                    this.replyMessage(currentMessage);
                } else if (action === 'Resend') {
                    this.props.reSendMessage(currentMessage, this.state.targetUri);
                } else if (action === 'Save') {
                    this.savePicture(currentMessage.local_url);
                } else if (action.startsWith('Download')) {
                    console.log('Starting download...');
                    this.props.downloadFile(currentMessage.metadata, true);
                } else if (action.startsWith('Decrypt')) {
                    console.log('Starting decryption...');
					this.props.decryptFunc(currentMessage.metadata, true);
                } else if (action === 'Open') {
                    FileViewer.open(currentMessage.metadata.local_url, { showOpenWithDialog: true })
                    .then(() => {
                        // success
                    })
                    .catch(error => {
                        console.log('Failed to open', currentMessage, error.message);
                        this.props.postSystemNotification(error.message);
                    });
                }
            });
        }
    };

    isMessageEditable(message) {
        if (message.direction === 'incoming') {
            return false;
        }

        if (message.failed) {
            return false;
        }

        return true;
    }

    closeDeleteMessageModal() {
        this.setState({showDeleteMessageModal: false});
    }

	downloadFile(message) {
		this.props.downloadFile(message.metadata, true);
    }

    cancelTransfer(message) {
		if (message.direction === 'outgoing' ) {
			this.props.uploadFile(message.metadata);
		} else {
			this.props.downloadFile(message.metadata, true);
		}
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

	componentDidUpdate(prevProps, prevState) {

      if (prevState.scrollToBottom !== this.state.scrollToBottom) {
	        console.log('Scroll to bottom changed', this.state.scrollToBottom);
      }
      
      //console.log('this.state.scrollToBottom', this.state.scrollToBottom);

	  // Auto-pause any videos that went offscreen
	   if (prevState.messagesMetadata !== this.state.messagesMetadata) {
	        //console.log('Must update metadata');
			const mediaRotations = this.mediaRotations;
			const mediaLabels = this.mediaLabels;
			this.setState({ mediaLabels: mediaLabels, mediaRotations: mediaRotations });
	   }
	   
	   if (prevState.sharingAssetMessage != this.state.sharingAssetMessage) {
		  // Handle sharing asset mode
		  if (this.state.sharingAssetMessage) {
			  filteredMessages = [];
		  } else {
			  filteredMessages = this.state.filteredMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
		  }

		  this.setState({
			filteredMessages: filteredMessages 
		  });
	   }

	   if (prevState.searchString !== this.state.searchString || prevState.renderMessages != this.state.renderMessages) {
		  let filteredMessages = this.state.renderMessages;
	
			// Add reply metadata
		    filteredMessages = filteredMessages.map(m => ({
			...m,
			  replyId: this.state.messagesMetadata?.[m._id]?.replyId ?? null,
		     }));

		  // Apply search & media filters
		  if (this.state.searchString && this.state.searchString.length > 1) {
			const searchLower = this.state.searchString.toLowerCase();
	
			const textMatches = filteredMessages.filter(
			  msg => msg.text && msg.text.toLowerCase().includes(searchLower)
			);
	
			const matchingMediaIds = Object.keys(this.state.mediaLabels || {}).filter(id =>
			  (this.state.mediaLabels[id] || "").toLowerCase().includes(searchLower)
			);
	
			const mediaMatches = filteredMessages.filter(msg =>
			  matchingMediaIds.includes(msg._id)
			);
	
			filteredMessages = [
			  ...textMatches,
			  ...mediaMatches.filter(m => !textMatches.some(tm => tm._id === m._id)),
			];
		  }
		
		if (this.state.renderMessages.length > 0 && filteredMessages.length > 0) {
			let last_message_ts = this.state.renderMessages[0].createdAt;
			if (filteredMessages[0].createdAt > last_message_ts) {
				this.setState({scrollToBottom: true});
			}
		}
		
		  //console.log('must update filteredMessages');
		  this.setState({
			filteredMessages
		  });
	  
      }

	  if (prevState.transferProgress !== this.state.transferProgress) {
		const oldTP = prevState.transferProgress;
		const newTP = this.state.transferProgress;
	
		//console.log("🔄 transferProgress updated");
	
		Object.keys(newTP).forEach(id => {
		  const oldVal = oldTP[id];
		  const newVal = newTP[id];
	
		  if (!oldVal) {
			//console.log("🆕 New transfer entry:", id, newVal);
		  } else if (oldVal.progress !== newVal.progress) {
			//console.log("⬆️ Progress changed:", id, oldVal.progress, "→", newVal.progress);
		  }
		});
	
		Object.keys(oldTP).forEach(id => {
		  if (!newTP[id]) {
			//console.log("❌ Transfer removed:", id);
		  }
		});
	  }
	}

	replyMessage = (message) => {
	  this.setState({ replyingTo: message }, () => {
		// Wait one tick so the input is mounted before focusing
		setTimeout(() => this.textInputRef?.focus() , 100);
	  });
	};


renderMessageVideo = (props) => {
  const { currentMessage } = props;
  if (!currentMessage?.video) return null;

  const id = currentMessage._id;
  const uri = currentMessage.video;
  const videoMetaCache = this.state.videoMetaCache || {};
  const thumbnail = videoMetaCache[id]?.thumbnail;
  const isLoading = !!this.state.videoLoadingState?.[id];


	if (!this.state.videoMetaCache[id]) {
	  const existingCache = this.state.videoMetaCache; // for clarity
	
	  // Prevent duplicate async calls for same id
	  this.state.videoMetaCache[id] = { loading: true }; 

		 if (Platform.OS === 'android') {
		  createThumbnailSafe({ url: uri, timeMs: 1000 })
			.then(path => {
			  this.setState(prev => ({
				videoMetaCache: {
				  ...prev.videoMetaCache,
				  [id]: { thumbnail: path, width: 512, height: 512 }, // you can adjust width/height if needed
				},
			  }));
			  //console.log(`Thumbnail ready for video ${id}:`, path);
			})
			.catch(err => {
			  console.log('Thumbnail generation failed:', err);
			  this.setState(prev => {
				const { [id]: _, ...rest } = prev.videoMetaCache;
				return { videoMetaCache: rest };
			  });
			});
		} else {
		  createThumbnail({
				url: uri,
				timeStamp: 1000, // first second of video
		  })
				.then(({ path, width, height }) => {
				  this.setState((prev) => ({
						videoMetaCache: {
						  ...prev.videoMetaCache,
						  [id]: { thumbnail: path, width, height },
						},
				  }));
				  //console.log(`Thumbnail ready for video ${id}:`, path);
				})
				.catch((err) => {
				  console.log('Thumbnail generation failed:', err);
				  this.setState((prev) => {
						const { [id]: _, ...rest } = prev.videoMetaCache;
						return { videoMetaCache: rest };
				  });
				});
		}

	}
               
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => this.openVideoModal(uri)}
      style={{
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: -5,
      }}
    >
      {isLoading && (
        <View
          style={{
            position: 'absolute',
            zIndex: 2,
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ActivityIndicator size="large" color="#aaa" />
        </View>
      )}

      <View
        style={{
          width: '100%',
          aspectRatio: 16 / 9,
          backgroundColor: '#000',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Thumbnail if available, else black surface */}
        {thumbnail ? (
          <Image
            source={{ uri: thumbnail }}
            style={{
              width: '100%',
              height: '100%',
              resizeMode: 'cover',
            }}
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#000',
            }}
          />
        )}

        {/* Play button overlay */}
        <View
          style={{
            position: 'absolute',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
            borderRadius: 40,
            width: 80,
            height: 80,
          }}
        >
          <IconButton
            icon="play"
            size={66}
            iconColor="#fff"
            onPress={() => this.openVideoModal(uri)}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
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
        let extraStyles = currentMessage.replyId ? {minWidth: 120} : {};
        if (currentMessage.metadata && currentMessage.metadata.transfer_id) {
			extraStyles.minWidth = 250; 
        }

        let isTransfering = false;

		const isIncoming = currentMessage.direction === 'incoming';

	    let progressData = this.state.transferProgress[currentMessage._id];
	    //console.log('-- progressData', progressData);
	    let progress = progressData ? progressData.progress / 100 : null;
	    isTransfering = progressData && progressData.progress < 100;
	    let stage = progressData && progressData.stage;
	    if (stage) {
	        stage = stage.charAt(0).toUpperCase() + stage.substr(1).toLowerCase() + 'ing...';
	    }
	    
	    	  
        let mediaLabel = this.state.mediaLabels[currentMessage._id] || currentMessage.text ;
        // Create a temporary props object with overridden text
        
		const labelProps = {
		  ...props,
		  currentMessage: {
			...currentMessage,
			text: mediaLabel // only override the text
		  }
		};
		
        if (currentMessage.video) {
            const fontColor = !isIncoming ? "black": "white";

			if (currentMessage.metadata.preview) {
				return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
					justifyContent: 'space-between', // distribute items evenly
					paddingHorizontal: 8}, styles.photoMenuContainer, extraStyles]}>
	
						<IconButton
							style={styles.photoMenu}
							size={20}
							icon="menu"
						/>
					  <View
						style={[
						  styles.photoMenuText,
						  {
							flex: 1,
							paddingHorizontal: 6,
							justifyContent: 'center',
							borderColor: 'red',
							borderWidth: 0
						  },
						]}
					  >
						<Text
						  style={{
							color: '#000',
							fontSize: 14,
							flexShrink: 1,
							textAlignVertical: 'center',
							includeFontPadding: false,
							marginBottom: 6
						  }}
						  numberOfLines={1}
						  ellipsizeMode="tail"
						>
						  {mediaLabel}
						</Text>
		
					  </View>
	
					  <IconButton
						style={styles.deleteButton}
						type="font-awesome"
						size={20}
						icon="delete"
						iconColor='red'
						onPress={() => this.deleteSharingAsset()}
					  />				  
						</View>
					); 
				} else {
					return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
					justifyContent: 'space-between', // distribute items evenly
					paddingHorizontal: 0}, styles.photoMenuContainer, extraStyles]}>
	
						<IconButton
							style={styles.photoMenu}
							size={20}
							icon="menu"
							iconColor={!isIncoming ? "black": "white"}
						/>
					  <View
						style={[
						  styles.photoMenuText,
						  {
							flex: 1,
							justifyContent: 'center',
							borderColor: 'red',
							borderWidth: 0
						  },
						]}
					  >
						  {/* This middle section: label + progress bar inline */}
						  <View
							style={{
							  flex: 1,
							  flexDirection: 'row',
							  alignItems: 'center',
							  justifyContent: 'space-between',
							  paddingHorizontal: 0,
							  borderColor: 'red',
							  borderWidth: 0
							}}
						  >

							{/* Label text on the left */}
							<Text
							  style={{
								color: fontColor,
								fontSize: 14,
								flexShrink: 1,
								textAlignVertical: 'center',
								includeFontPadding: false,
								marginBottom: 6,
							  }}
							  numberOfLines={1}
							  ellipsizeMode="tail"
							>
							  {mediaLabel}
							</Text>

							{isTransfering && (

					        <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
							  <Progress.Bar
								progress={progress}
								width={60}         // smaller width for inline look
								height={6}
								borderRadius={3}
								borderWidth={0}
								color={isTransfering ? "#007AFF" : "orange"}
								unfilledColor="#e0e0e0"
								style={{ marginRight: 12 }} 
							  />

							  <Text
								style={{
								  fontSize: 12,
								  color: 'orange',
								  marginTop: 2,
								  marginLeft: 2,
								}}
							  >
								{Math.round(progress * 100)}%
							  </Text>
							  </View>
							  
							)}
							
							{!isTransfering?
							<IconButton
							  icon="fullscreen"
							  size={24}
							  onPress={() => this.openVideoModal(currentMessage.video)}
							  style={{ }}
							  iconColor={fontColor}
							/>
							: 
							<IconButton
							  icon="cancel"
							  size={24}
							  onPress={() => this.cancelTransfer(currentMessage)}
							  style={{ }}
							  iconColor={fontColor}
							/>
							}    
						   </View>
						  </View>
					</View>
					); 
			
				}
        } else if (currentMessage.audio) {
            return (
                <View style={[styles.audioMenuContainer, extraStyles]}>
                    <IconButton
                        style={styles.audio}
                        size={20}
                        icon="menu"
                        iconColor='white'
                    />

				  <View style={styles.audioMenuText}>
					<MessageText
					  {...labelProps}
					  customTextStyle={styles.messageText} // keeps your original styling
					/>
				  </View>

                </View>
            );
        } else if (currentMessage.image) {
            const fontColor = !isIncoming ? "black": "white";

            if (currentMessage.metadata.preview) {
				return (
                <View style={[{flexDirection: 'row', alignItems: 'center',
					justifyContent: 'space-between', // distribute items evenly
					paddingHorizontal: 8}, styles.photoMenuContainer, extraStyles]}>

				<View style={{flexDirection: 'row', alignItems: 'center'}}>

                { Platform.OS === "android" ?
					<Checkbox
					  status={this.state.fullSize ? 'checked' : 'unchecked'}
					  onPress={() => {console.log('setfulsize', !this.state.fullSize); this.setState({ fullSize: !this.state.fullSize })}}
					/>
                :
                
				<View
				  style={{
					borderWidth: this.state.fullSize ? 0 : 2,
					borderColor: '#007AFF',
					borderRadius: 2,
					padding: 0,
					transform: [{ scale: 0.6 }]
				  }}
				>
					<Checkbox
					  status={this.state.fullSize ? 'checked' : 'unchecked'}
					  onPress={() => this.setState({ fullSize: !this.state.fullSize })}
	
					/>
				 </View> 
				 }
				  <Text style={styles.checkboxLabel}>Full size</Text>
				  </View>
      
				  <IconButton
					style={styles.deleteButton}
					type="font-awesome"
					size={20}
					icon="delete"
				    iconColor='red'
					onPress={() => this.deleteSharingAsset()}
				  />

                </View>
            ); 
            } else {
				return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
					justifyContent: 'space-between', // distribute items evenly
					paddingHorizontal: 8}, styles.photoMenuContainer, extraStyles]}>
	
						<IconButton
							style={styles.photoMenu}
							size={20}
							icon="menu"
							iconColor={!isIncoming ? "black": "white"}
						/>
					  <View
						style={[
						  styles.photoMenuText,
						  {
							flex: 1,
							paddingHorizontal: 6,
							justifyContent: 'center',
							borderColor: 'red',
							borderWidth: 0
						  },
						]}
					  >
						  {/* This middle section: label + progress bar inline */}
						  <View
							style={{
							  flex: 1,
							  flexDirection: 'row',
							  alignItems: 'center',
							  justifyContent: 'space-between',
							  paddingHorizontal: 6,
							}}
						  >
							{/* Label text on the left */}
							<Text
							  style={{
								color: fontColor,
								fontSize: 14,
								flexShrink: 1,
								textAlignVertical: 'center',
								includeFontPadding: false,
								marginBottom: 7,
							  }}
							  numberOfLines={1}
							  ellipsizeMode="tail"
							>
							  {mediaLabel}
							</Text>					

							{isTransfering && (
							  <Progress.Bar
								progress={progress}
								width={60}         // smaller width for inline look
								height={6}
								borderRadius={3}
								borderWidth={0}
								color={isTransfering ? "#007AFF" : "orange"}
								unfilledColor="#e0e0e0"
								style={{ marginRight: 12 }}  // small gap from label
							  />
							)}
						  </View>
					  </View>
					</View>
					); 			
            }
        } else {
            if (currentMessage.metadata && currentMessage.metadata.filename) {
				//console.log(currentMessage.metadata, 'failed:', currentMessage.failed);
				return (
				  <View
					style={[
					  styles.messageTextContainer,
					  extraStyles,
					  {
						flexDirection: 'row',
						alignItems: 'flex-start',
						marginLeft: 10,
					  },
					]}
				  >
					  <Icon
						type="font-awesome"
						name="file"
						style={styles.chatSendArrow}
						size={40}
						color="gray"
					  />
				
					{/* Main content (text + progress) */}
					<View style={{ flex: 1, flexDirection: 'column' }}>
					  {/* Message text */}
					  <MessageText
						{...props}
						{...labelProps}
						customTextStyle={styles.messageText}
					  />
	
						{isTransfering ? (
						  <View
							style={{
							  marginTop: 6,
							  flexDirection: 'row',
							  alignItems: 'center',
							  justifyContent: 'space-between',
							}}
						  >
							{/* LEFT SIDE: Progress info */}
							<View style={{ flexDirection: 'column', flexShrink: 1 }}>
							  <Text
								style={{
								  color: '#000',
								  fontSize: 14,
								  flexShrink: 1,
								  textAlignVertical: 'center',
								  includeFontPadding: false,
								  marginBottom: 7,
								}}
							  >
								{isTransfering ? stage : ''}
							  </Text>
						
							  <Progress.Bar
								progress={progress}
								width={120}
								height={6}
								borderRadius={3}
								borderWidth={0}
								color={isTransfering ? "#007AFF" : "orange"}
								unfilledColor="#e0e0e0"
							  />
						
							  <Text
								style={{
								  fontSize: 12,
								  color: 'orange',
								  marginTop: 2,
								}}
							  >
								{Math.round(progress * 100)}%
							  </Text>
							</View>
						
							{/* RIGHT SIDE: Cancel Button */}
							<IconButton
							  icon="cancel"
							  size={24}
							  onPress={() => this.cancelTransfer(currentMessage)}
							  style={{ marginLeft: 12 }}
							/>
						  </View>
						
						) : (
						
						  /* Not downloading */
						  currentMessage.metadata.local_url == null && (
							<View
							  style={{
								marginTop: 6,
								flexDirection: 'row',
								justifyContent: 'flex-end',
								alignItems: 'center',
							  }}
							>
							  <IconButton
								icon="download"
								size={24}
								onPress={() => this.downloadFile(currentMessage)}
							  />
							</View>
						  )
						)}

					</View>
				  </View>
				);
			}

            return (
                <View style={[styles.messageTextContainer, extraStyles, { flexDirection: 'row', alignItems: 'center', marginLeft: 10}]}>
                     {currentMessage.metadata && currentMessage.metadata.filename ?
					 <Icon
					  type="font-awesome"
					  name="file"
					  style={styles.chatSendArrow}
					  size={40}
					  color='gray'
					/>
					: null}

                    <MessageText
                        {...props}
                         {...labelProps}
                        customTextStyle={styles.messageText}
                    />

                </View>
            );
  		}
    };

	renderTime = (props) => {
	  const { currentMessage, position } = props;
	  	
	  if (currentMessage.metadata?.preview) return null;
	
	  const isIncoming = currentMessage.direction === 'incoming';
	  const isMedia = currentMessage.video || currentMessage.audio;
	  const textColor = currentMessage.audio || isIncoming? 'white': 'black';
	  const hasFileSize = !!currentMessage.metadata?.filesize;
	
	  // Helper to format bytes
	  const formatFileSize = (bytes) => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	  };
	
	  // Format timestamp text 
	  const timeString = currentMessage.createdAt ? dayjs(currentMessage.createdAt).format('h:mm A'): '';
	  
	  let text = hasFileSize ? `${formatFileSize(currentMessage.metadata.filesize)}  •  ${timeString}`: timeString;
		if (currentMessage.direction === 'incoming') {
			text = hasFileSize ? `${timeString} • ${formatFileSize(currentMessage.metadata.filesize)}` : timeString;
		}
	
	  return (
		<View style={{ alignItems: position === 'right' ? 'flex-end' : 'flex-start', marginLeft: 10, marginRight:10, marginBottom:5 }}>
		  <Text
			style={[
			  props.timeTextStyle?.[position],
			  {
				color: textColor,
				fontSize: 11,
				opacity: 0.85,
			  },
			]}
		  >
			{text}
		  </Text>
		</View>
	  );
	};

	openVideoModal = (uri) => {	
	  // Open fullscreen modal
	  this.setState({
		showVideoModal: true,
		modalVideoUri: uri,
		videoPaused: false
	  });
	};
	
	closeVideoModal = () => {
	  this.setState({ 
		showVideoModal: false, 
		modalVideoUri: null, 
		videoPaused: true });
	};

onScroll = (e) => {
  this.currentOffset = e.nativeEvent.contentOffset.y;
  // Debug current scroll offset continuously
  // console.log("onScroll → offset:", this.currentOffset);
};

loadPrevious = (count = 10) => {
  const { loadedMaxIndex, renderMessages: all, focusedMessages } = this.state;

  if (loadedMaxIndex >= all.length - 1) {
    console.log("[loadPrevious] No previous messages left.");
    return;
  }

  const newMax = Math.min(all.length - 1, loadedMaxIndex + count);
  const batch = all.slice(loadedMaxIndex + 1, newMax + 1);

  this.setState({
    focusedMessages: [...focusedMessages, ...batch],
    loadedMaxIndex: newMax,
  });

  console.log(`[loadPrevious] added ${batch.length} messages; new max index ${newMax}`);
};

loadNext = (count = 10) => {
  const { loadedMinIndex, renderMessages: all, focusedMessages } = this.state;

  if (loadedMinIndex === 0) {
    console.log("[loadNext] No next messages left.");
    return;
  }

  const newMin = Math.max(0, loadedMinIndex - count);
  const batch = all.slice(newMin, loadedMinIndex);

  this.setState({
    focusedMessages: [...batch, ...focusedMessages],
    loadedMinIndex: newMin,
  });

  console.log(`[loadNext] added ${batch.length} messages; new min index ${newMin}`);
};



renderFloatingControls = () => (
  <View
    style={{
      position: "absolute",
      right: 10,
      bottom: 100,
      alignItems: "center",
      gap: 6,
      zIndex: 999,
    }}
  >

    {/* LOAD PREVIOUS */}
    <TouchableOpacity
      onPress={() => this.loadPrevious()}
      style={{
        borderRadius: 20,
        paddingVertical: 4,
        paddingHorizontal: 8,
        marginBottom: 4,
        backgroundColor: "rgba(0,0,0,0.4)",
      }}
    >
      <Text style={{ color: "white", fontSize: 18 }}>▲</Text>
    </TouchableOpacity>

    {/* LOAD NEXT */}
    <TouchableOpacity
      onPress={() => this.loadNext()}
      style={{
        borderRadius: 20,
        paddingVertical: 4,
        paddingHorizontal: 8,
        marginBottom: 4,
        backgroundColor: "rgba(0,0,0,0.4)",
      }}
    >
      <Text style={{ color: "white", fontSize: 18 }}>▼</Text>
    </TouchableOpacity>

    {/* SCROLL TO BOTTOM (your original) */}
    <TouchableOpacity
      onPress={() => this.scrollToBottom()}
      style={{
        borderRadius: 20,
        padding: 6,
        backgroundColor: "rgba(0,0,0,0.5)",
      }}
    >
      <Text style={{ color: "white", fontSize: 18 }}>∨</Text>
    </TouchableOpacity>
  </View>
);


exitFocusMode = () => {
  this.setState({
    focusedMessages: null,
    prevMessages: [],
    nextMessages: [],
    focusedMessageId: null,
  });
};

goToMessage = (targetId) => {
  const all = this.state.renderMessages;
  const index = all.findIndex(m => m._id === targetId);

  if (index === -1) {
    console.warn("goToMessage: Message not found:", targetId);
    return;
  }

  // preload 10 before and after
  const minIndex = Math.max(0, index - 10);
  const maxIndex = Math.min(all.length - 1, index + 10);

  const subset = all.slice(minIndex, maxIndex + 1);

  this.setState({
    focusedMessages: subset,
    focusedMessageId: targetId,
    loadedMinIndex: minIndex,
    loadedMaxIndex: maxIndex,
  });

	setTimeout(() => this.scrollToMessage(targetId), 10);
};


scrollToMessage(id) {
  console.log('scrollToMessage', id);

  const messagesArray = this.state.focusedMessages || this.state.filteredMessages;
  
  if (!Array.isArray(messagesArray)) {
    console.warn('No messages array for contact', contactUri);
    return;
  }

  const index = messagesArray.findIndex(m => m._id === id);
  if (index === -1) {
    console.warn(`Message ${id} not found`);
    return;
  }

  // GiftedChat’s FlatList is inverted
  const invertedIndex = messagesArray.length - 1 - index;

  if (this.flatListRef?.scrollToIndex) {
    try {
      this.flatListRef.scrollToIndex({
        index: invertedIndex,
        animated: true,
        viewPosition: 0.1, // scroll near the top of the screen
      });
    } catch (e) {
      console.warn('scrollToIndex failed:', e);
    }
  } else {
    console.warn('FlatList ref not found');
  }
}

	get replyMessages() {
	  if (!this.state.messagesMetadata) return {};
	
	  return Object.fromEntries(
		Object.entries(this.state.messagesMetadata)
		  .filter(([, value]) => value.replyId)      // keep only those with replyId
		  .map(([key, value]) => [key, value.replyId]) // return key -> replyId
	  );
	}

	get mediaLabels() {
	  const data = this.state.messagesMetadata;
	  if (!data) return {};
	
	  return Object.fromEntries(
		Object.entries(data)
		  .map(([key, value]) => [key, value.label])
		  .filter(([, label]) => label !== undefined && label !== null)
	  );
	}

	get mediaRotations() {
	  const data = this.state.messagesMetadata;
	  if (!data) return {};
	
	  return Object.fromEntries(
		Object.entries(data)
		  .map(([key, value]) => [key, value.rotation])
		  .filter(([, rotation]) => rotation !== undefined && rotation !== null)
	  );
	}
	
	scrollToBottom() {
	  console.log('scrollToBottom called');
	  this.exitFocusMode();	  
	  if (this.flatListRef?.scrollToOffset) {
		try {
		  this.flatListRef.scrollToOffset({ offset: 0, animated: true });
		} catch (e) {
		  console.warn('scrollToBottom failed:', e);
		}
	  } else {
		console.warn('scrollToBottom FlatList ref not found');
	  }
	}

    get showChat() {
		if (this.state.expandedImage) {
			return false;
		}    

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

  onViewableItemsChanged = ({ viewableItems }: { viewableItems: any[] }) => {
    const visibleIds = viewableItems.map(v => v.item._id);
    this.setState(prev => {
      const updatedRendered = new Set(prev.renderedMessageIds);
      visibleIds.forEach(id => updatedRendered.add(id));
      return { visibleMessageIds: visibleIds, renderedMessageIds: updatedRendered };
    });
  };

  handleImageLoadStart = (id: string) => {
    this.setState(prev => ({
      imageLoadingState: { ...prev.imageLoadingState, [id]: true },
    }));
  };
  
    handleImageLoadEnd = (id: string) => {
    this.setState(prev => ({
      imageLoadingState: { ...prev.imageLoadingState, [id]: false },
    }));
  };
    
  rotateImage() {
    const newRotation = (this.state.rotation  + 90) % 360; 
    this.setState({rotation: newRotation});
  };
  
    render() {
        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let contacts = [];
        //console.log('----');
                
        //console.log('--- Render contacts with filter', this.state.filter);
        //console.log('--- Render contacts', this.state.selectedContact);
        //console.log(this.state.renderMessages);

		Object.keys(this.state.myContacts).forEach((uri) => {
			contacts.push(this.state.myContacts[uri]);
		});

        let chatInputClass = this.customInputToolbar;

        if (this.state.selectedContact) {

           if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }
           if (this.state.selectedContact.tags.indexOf('test') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }

           if (this.state.searchMessages) {
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
            if (this.state.selectedContact && this.state.selectedContact.uri == this.state.targetUri) {
            } else {
				items = items.concat(this.searchedContact(this.state.targetUri, this.state.selectedContact));
            }
        }

        if (this.state.filter && this.state.targetUri) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
        }

        const known = [];
        items = items.filter((elem) => {
            if (this.state.shareToContacts && elem.tags.indexOf('test') > -1) {
                return;
            }

            if (this.state.shareToContacts && elem.uri.indexOf('videoconference') > -1) {
                return;
            }

            if (this.state.sourceContact && this.state.sourceContact.uri === elem.uri) {
                return;
            }

            if (this.state.inviteContacts && elem.tags.indexOf('conference') > -1 ) {
                return;
            }

            if (this.state.shareToContacts && elem.uri === this.state.accountId) {
                return;
            }

            if (this.state.accountId === elem.uri && elem.tags.length === 0) {
                return;
            }

            if (this.state.shareToContacts && elem.uri.indexOf('@') === -1) {
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

        if (this.state.sortBy == 'storage') {
            items.sort((a, b) => (a.storage < b.storage) ? 1 : -1)
        } else {
			items.sort(function(a, b) {
			  var aHasTimestamp = !!a.timestamp;
			  var bHasTimestamp = !!b.timestamp;
			
			  // Case 1: both have timestamps -> newest first
			  if (aHasTimestamp && bHasTimestamp) {
				return new Date(b.timestamp) - new Date(a.timestamp);
			  }
			
			  // Case 2: only one has timestamp -> that one comes first
			  if (aHasTimestamp && !bHasTimestamp) return -1;
			  if (!aHasTimestamp && bHasTimestamp) return 1;
			
			  // Case 3: neither has timestamp -> sort alphabetically by name
			  var aName = (a.name || "").toLowerCase();
			  var bName = (b.name || "").toLowerCase();
			  return aName.localeCompare(bName);
			});
        }
        
        //console.log(this.state.sortBy);

        if (items.length === 1) {
            items[0].showActions = true;
        }

        /*
		console.log('Contacts ----');

        items.forEach((item) => {
            item.showActions = false;
            console.log(item.timestamp, item.uri, item.name);
        });
        */

        let columns = 1;

        if (this.state.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        const contactsContainer = this.props.orientation === 'landscape' ? styles.contactsLandscapeContainer : styles.contactsPortraitContainer;
        const borderClass = (this.state.filteredMessages.length > 0 && !this.state.chat) ? styles.chatBorder : null;
        
        let addSpacer = false;
		if (Platform.OS === 'android') {
		  const androidVersion = Platform.Version;
		  if (androidVersion >= 34) {
			  addSpacer = true;
		  }
		}
      
        // debug
        let debug = false;
        
        //debug = true;
       
        const messagesMetadata = this.state.messagesMetadata; 
        const replyMessages = this.replyMessages;
        const mediaLabels = this.state.mediaLabels;
        const mediaRotations = this.state.mediaRotations;
        const shareToContacts = this.state.shareToContacts;
        const transferProgress = this.state.transferProgress;
        const renderMessages = this.state.renderMessages;
        const searchMessages = this.state.searchMessages
        const searchString = this.state.searchString
        const showChat = this.showChat;
        
          
		if (debug) {
			const values = {
			shareToContacts,
//				messagesMetadata,
				renderMessages,
				messages,
//				mediaRotations,
//				renderMessages,
				searchString,
				showChat
			};
		
			//console.log(transferProgress);
			const maxKeyLength = Math.max(...Object.keys(values).map(k => k.length));
		
			Object.entries(values).forEach(([key, value]) => {
				const prev = this.prevValues[key];
				const paddedKey = key.padStart(maxKeyLength, ' '); // right-align key
				if (JSON.stringify(prev) !== JSON.stringify(value)) {
					console.log('DEBUG', Platform.OS, paddedKey, JSON.stringify(value, null, 2));
				}
			});
		
			this.prevValues = values;
		}
		
		const footerHeightReply = Platform.OS === 'android' ? 60: 0;
		const footerHeight = Platform.OS === 'android' ? 10: 0;

        this.state.sharingAssetMessage
        let messages = this.state.gettingSharedAsset ? [] : this.state.filteredMessages;
        if (this.state.sharingAssetMessage) {
			messages = [this.state.sharingAssetMessage];
        }

        //console.log('this.state.selectedContact', this.state.selectedContact);
        return (
            <SafeAreaView style={container}>
              {this.state.selectedContact ?
              
              (null)  // this.renderItem(items[0])
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
                <GiftedChat 
				  listViewProps={{
					ref: (ref) => { this.flatListRef = ref; }, // 👈 capture the FlatList ref here
					onViewableItemsChanged: this.onViewableItemsChanged,
					viewabilityConfig: this.viewabilityConfig,
				  }}
                  innerRef={this.chatListRef}
                  messages={this.state.focusedMessages || messages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onMessagePress}
                  renderInputToolbar={chatInputClass}
                  renderBubble={this.renderBubbleWithMessages}
                  renderMessageText={this.renderMessageText}
                  renderMessageImage={this.renderMessageImage}
                  renderMessageAudio={this.renderMessageAudio}
                  renderMessageVideo={this.renderMessageVideo}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  renderTime={this.renderTime}
                  placeholder={this.state.placeholder}
                  lockStyle={styles.lock}
                  renderSend={this.renderSend}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  maxInputLength={16000}
                  tickStyle={{ color: 'green' }}
                  infiniteScroll
                  loadEarlier={!this.state.totalMessageExceeded}
                  isLoadingEarlier={this.state.isLoadingEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                  isTyping={this.state.isTyping}
                  keyboardShouldPersistTaps={"handled"}
                  keyboardDismissMode={"interactive"}
				  text={this.state.text}
                  onInputTextChanged={text => this.chatInputChanged(text)}
					isScrollToBottomVisible={() => {
					  return true;
					}}
				  scrollToBottomComponent={() => (
					<TouchableOpacity
					  onPress={() => this.scrollToBottom()}
					  style={{
						borderRadius: 20,
						padding: 6,
						marginBottom: 6,
						marginRight: 2,
					  }}
					>
					  <Text style={{ color: 'white', fontSize: 20 }}>∨</Text>
					</TouchableOpacity>
				  )}
                  renderFooter={() => <View style={{ height: this.state.replyingTo ? footerHeightReply: footerHeight }} />}
                />

				{this.state.focusedMessages ?
				this.renderFloatingControls():
				null}

                {addSpacer ? <KeyboardSpacer /> : null }

              </View>

              : (items.length === 1 && !this.state.expandedImage) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
                  messages={this.state.renderMessages}
                  renderInputToolbar={() => { return null }}
                  renderBubble={this.renderBubbleWithMessages}
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
                  loadEarlier={!this.state.totalMessageExceeded}
                  onLoadEarlier={this.loadEarlierMessages}
                />
              </View>
              : null
              }

			<Modal
			  visible={this.state.showVideoModal}
			  animationType="slide"
			  transparent={false}
			  onRequestClose={this.closeVideoModal}
			>
			  <TouchableOpacity
				onPress={this.closeVideoModal}
				style={{
				  position: "absolute",
				  top: 40,
				  right: 20,
				  zIndex: 2,
				  backgroundColor: "rgba(0,0,0,0.5)",
				  borderRadius: 20,
				  padding: 6,
				}}
			  >
				<Text style={{ color: "white", fontSize: 16 }}>✕</Text>
			  </TouchableOpacity>
		
   		      {this.state.modalVideoUri && (
			  <Video
				source={{ uri: this.state.modalVideoUri }}
				style={{ flex: 1, backgroundColor: 'black' }}
				controls={true}
				resizeMode="contain"
				paused={this.state.videoPaused}
				onEnd={() => this.setState({ videoPaused: true })}
			  />
			)}

			</Modal>
			
			{this.state.expandedImage && (
			  <Modal
				visible={true}
				transparent={true}
				onRequestClose={() => this.onImagePress(null)}
			  >
				<ImageViewer
				  imageUrls={[{ url: this.state.expandedImage.image }]}
				  enableSwipeDown
				  onSwipeDown={() => this.onImagePress(null)}
				  onClick={() => this.onImagePress(null)}
				  backgroundColor="black"
				  renderIndicator={() => null}
				  saveToLocalByLongPress={false}
				  renderImage={(props) => (
					<View
					  style={{
						alignItems: "center",
						justifyContent: "center",
					  }}
					>
					  <Image
						{...props}
						style={[
						  props.style,
						  { transform: [{ rotate: `${this.state.rotation}deg` }] },
						]}
					  />
					</View>
				  )}
				/>
			
				<TouchableOpacity
				  onPress={this.rotateImage}
				  style={{
					position: "absolute",
					bottom: 40,
					right: 30,
					backgroundColor: "rgba(0,0,0,0.6)",
					padding: 12,
					borderRadius: 50,
				  }}
				>
				  <IconButton
						type="font-awesome"
						size={40}
						icon="rotate-left"
						iconColor="white"
					  />
				</TouchableOpacity>
			  </Modal>
			)}
			

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
                mediaLabels={this.mediaLabels}
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
    keys            : PropTypes.object,
    downloadFile    : PropTypes.func,
    uploadFile : PropTypes.func,
    decryptFunc     : PropTypes.func,
    forwardMessageFunc: PropTypes.func,
    messagesCategoryFilter: PropTypes.string,
    startCall: PropTypes.func,
    sourceContact:   PropTypes.object,
    requestCameraPermission: PropTypes.func,
    requestMicPermission: PropTypes.func,
    requestStoragePermissions: PropTypes.func,
    file2GiftedChat: PropTypes.func,
    postSystemNotification: PropTypes.func,
    sortBy: PropTypes.string,
    toggleSearchMessages: PropTypes.func,
    searchMessages: PropTypes.bool,
    searchString: PropTypes.string,
    recordAudio: PropTypes.func,
    dark: PropTypes.bool,
    messagesMetadata: PropTypes.object,
    contactStartShare: PropTypes.func,
    contactStopShare: PropTypes.func,
    setFullScreen: PropTypes.func,
    fullScreen: PropTypes.bool,
    transferProgress: PropTypes.object,
    totalMessageExceeded: PropTypes.bool
};


export default ContactsListBox;
