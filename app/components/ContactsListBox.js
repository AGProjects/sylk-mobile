import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, Platform, PermissionsAndroid, Switch, StyleSheet, TextInput, TouchableOpacity, BackHandler, TouchableHighlight} from 'react-native';
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
import VideoPlayer from 'react-native-video-player';
import { IconButton} from 'react-native-paper';
import ImageViewer from 'react-native-image-zoom-viewer';
import path from 'react-native-path';
import KeyboardSpacer from 'react-native-keyboard-spacer';
import { Keyboard } from 'react-native';

import moment from 'moment';
import momenttz from 'moment-timezone';
import Video from 'react-native-video';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-camera-roll/camera-roll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import AudioRecord from 'react-native-audio-record';
import FastImage from 'react-native-fast-image';

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
        this.default_placeholder = 'Type a message...'

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
            sortBy: this.props.sortBy,
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
            keys: this.props.keys,
            playing: false,
            texting: false,
            cameraAsset: null,
            photoMsg: null,
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
			messagesMetadata: this.props.messagesMetadata,
			mediaLabels: {},
			text: '',
        }

        this.ended = false;
        this.outgoingPendMessages = {};
        this.prevValues = {};

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
        }

        //if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
        //};

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
                    this.props.confirmRead(uri, 'contact_list_refresh');
                    if (this.state.renderMessages.length > 0 && renderMessages.length > 0) {
                        let last_message_ts = this.state.renderMessages[0].createdAt;
                        if (renderMessages[0].createdAt > last_message_ts) {
                            this.setState({scrollToBottom: true});
                        }
                    }
                }
            }
            
            /*
            if (nextProps.myContacts && nextProps.selectedContact && nextProps.selectedContact != this.state.selectedContact) { 
                const messagesMetadata = nextProps.myContacts[nextProps.selectedContact.uri].messagesMetadata
                console.log('-- Refresh metadata');
                //console.log(Object.keys(nextProps));
                console.log(JSON.stringify(messagesMetadata, null, 2));
				this.setState({
					messagesMetadata: { ...messagesMetadata }
				}, () => {
					// This runs AFTER messagesMetadata is updated
					this.setState({ mediaLabels: this.mediaLabels });
				});
    
            }
            */

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
                       messagesMetadata: nextProps.messagesMetadata
                       }, () => {
					// This runs AFTER messagesMetadata is updated
					this.setState({ mediaLabels: this.mediaLabels });
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

        let msg = await this.props.file2GiftedChat(asset);
        //console.log('asset', asset);

        let assetType = 'file';
        if (msg.video) {
            assetType = 'movie';
        } else if (msg.image) {
            assetType = 'photo';
        }

        this.outgoingPendMessages[msg.metadata.transfer_id] = msg;
        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, [msg]),
                        cameraAsset: asset,
                        photoMsg: msg,
                        //placeholder: 'Send ' + assetType + ' of ' + utils.beautySize(msg.metadata.filesize)
						placeholder: 'Photo note...'
                        });
    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} 
         recordAudio={this.props.recordAudio} 
         texting={this.state.texting || this.state.replyingTo} 
         sendingImage={this.state.photoMsg !==null} 
         selectedContact={this.state.selectedContact}/>
    )

    chatInputChanged(text) {
       this.setState({texting: (text.length > 0), text: text})
    }

    resetContact() {
        this.outgoingPendMessages = {};
        this.setState({
            texting: false,
            cameraAsset: null,
            photoMsg: null,
            placeholder: this.default_placeholder
        });
    }

	renderBubble(props) {
	  const { currentMessage, messages } = props;
	
	  // Minimal change: adjust top corners only
	  const bubbleRadius = 16;
	
	  let leftColor = 'green';
	  let rightColor = '#fff';
	
	  if (currentMessage.failed) {
		rightColor = 'red';
		leftColor = 'red';
	  } else if (currentMessage.pinned) {
		rightColor = '#2ecc71';
		leftColor = '#2ecc71';
	  }
	
	  // Find original message if this is a reply
	  let originalMessage = null;
	  if (currentMessage.replyId && messages) {
		originalMessage = messages.find(m => m._id === currentMessage.replyId);
	  }
	
	  const MIN_BUBBLE_WIDTH = 120;
	  const MAX_BUBBLE_WIDTH = '80%';
	
	  const measuredWidth = this.state.bubbleWidths[currentMessage._id] || 0;
	  const bubbleWidth = Math.max(measuredWidth, MIN_BUBBLE_WIDTH);
	
	const previewWrapperStyle = {
	  borderTopLeftRadius: bubbleRadius,
	  borderTopRightRadius: bubbleRadius,
	};
	
	  const replyPreviewContainer =
		currentMessage.direction == 'incoming'
		  ? styles.replyPreviewContainerIncoming
		  : styles.replyPreviewContainerOutgoing;
	
	  const hasPreview = !!originalMessage; // for top corner radius
	
	  // Reply Preview UI
	  const replyPreview = originalMessage ? (
		<TouchableOpacity
		  activeOpacity={0.7}
		  onPress={() => {
			if (this.chatListRef && originalMessage._id) {
			  this.scrollToMessage(originalMessage._id);
			}
		  }}
		>
		  <View
			style={[
			  replyPreviewContainer,
			  {
				alignSelf:
				  currentMessage.direction === 'incoming'
					? 'flex-start'
					: 'flex-end',
				minWidth: MIN_BUBBLE_WIDTH,
				maxWidth: MAX_BUBBLE_WIDTH,
				width: bubbleWidth,
				...previewWrapperStyle, // <-- add bottom corner rounding
			  },
			]}
		  >
			<View style={styles.replyLine} />
	
			{originalMessage.image ? (
			  <Image
				source={{ uri: originalMessage.image }}
				style={{
				  width: '85%',
				  height: 100,
				}}
				resizeMode="cover"
			  />
			) : (
			  <Text
				style={styles.replyPreviewText}
				numberOfLines={3}
				ellipsizeMode="tail"
			  >
				{originalMessage.text}
			  </Text>
			)}
		  </View>
		</TouchableOpacity>
	  ) : null;
	
	  if (
		currentMessage.direction == 'incoming' &&
		currentMessage.metadata &&
		currentMessage.metadata.filename &&
		currentMessage.metadata.filename.endsWith('.asc')
	  ) {
		//return null;
	  }
	
	  const leftWrapper = {
		backgroundColor: leftColor,
		borderTopLeftRadius: hasPreview ? 0 : bubbleRadius,
		borderTopRightRadius: hasPreview ? 0 : bubbleRadius,
	  };
	  const rightWrapper = {
		backgroundColor: rightColor,
		borderTopLeftRadius: hasPreview ? 0 : bubbleRadius,
		borderTopRightRadius: hasPreview ? 0 : bubbleRadius,
	  };
	
	  return (
		<View style={{ flex: 1, alignSelf: 'stretch', borderColor: 'green', borderWidth: 0 }}>
		  {replyPreview}
		  {currentMessage.image ? (
			<Bubble
			  {...props}
			  wrapperStyle={{
				left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 },
				right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 },
			  }}
			  textProps={{ style: { color: props.position === 'left' ? '#000' : '#000' } }}
			  textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
			  renderCustomView={() => (
				<View
				  onLayout={(e) => this.handleBubbleLayout(currentMessage._id, e)}
				  style={{ position: 'absolute', width: '100%', height: '100%' }}
				/>
			  )}
			/>
		  ) : currentMessage.video ? (
			<Bubble
			  {...props}
			  wrapperStyle={{
				left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 },
				right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 },
			  }}
			  textProps={{ style: { color: props.position === 'left' ? '#fff' : '#fff' } }}
			  textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
			  renderCustomView={() => (
				<View
				  onLayout={(e) => this.handleBubbleLayout(currentMessage._id, e)}
				  style={{ position: 'absolute', width: '100%', height: '100%' }}
				/>
			  )}
			/>
		  ) : currentMessage.audio ? (
			<Bubble
			  {...props}
			  wrapperStyle={{
				left: { ...leftWrapper, backgroundColor: 'transparent' },
				right: { ...rightWrapper, backgroundColor: 'transparent' },
			  }}
			  textProps={{ style: { color: props.position === 'left' ? '#fff' : '#fff' } }}
			  textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
			  renderCustomView={() => (
				<View
				  onLayout={(e) => this.handleBubbleLayout(currentMessage._id, e)}
				  style={{ position: 'absolute', width: '100%', height: '100%' }}
				/>
			  )}
			/>
		  ) : (
			<Bubble
			  {...props}
			  wrapperStyle={{
				left: { ...leftWrapper },
				right: { ...rightWrapper },
			  }}
			  textProps={{ style: { color: props.position === 'left' ? '#fff' : '#000' } }}
			  textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
			  renderCustomView={() => (
				<View
				  onLayout={(e) => this.handleBubbleLayout(currentMessage._id, e)}
				  style={{ position: 'absolute', width: '100%', height: '100%' }}
				/>
			  )}
			/>
		  )}
		</View>
	  );
	}


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
	
			  {/* Vertical Green Line */}
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
				  right: 22,
				  zIndex: 10,
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

        message.metadata.playing = true;
        this.updateMessageMetadata(message.metadata);
        
		const path = message.audio.startsWith('file://') ? message.audio : 'file://' + message.audio;

        try {
			const msg = await audioRecorderPlayer.startPlayer(path);
			console.log(msg);
			this.setState({playing: true, placeholder: 'Playing audio message'});
	
			audioRecorderPlayer.addPlayBackListener((e) => {
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
        } catch (e) {
			console.log('Error', e);
        }
    };

    async stopPlaying(message) {
        //console.log('Audio playback ended', message.audio);
        this.setState({playing: false, placeholder: this.default_placeholder});
        message.metadata.playing = false;
        this.updateMessageMetadata(message.metadata);
		const msg = await audioRecorderPlayer.stopPlayer();
    }

renderSend = (props) => {
  let chatActionContainer = styles.chatActionContainer;

  if (this.state.cameraAsset) {
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
          <TouchableOpacity onPress={this.deleteCameraAsset}>
            <Icon
              style={chatActionContainer}
              type="font-awesome"
              name="delete"
              size={20}
              color='red'
            />
          </TouchableOpacity>
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
            <TouchableOpacity onPress={this._launchCamera}>
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
            <TouchableOpacity onPress={this._launchImageLibrary} onLongPress={this._pickDocument}>
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
        //console.log('Load earlier messages...');
        this.setState({scrollToBottom: false, isLoadingEarlier: true});
        this.props.loadEarlierMessages();
    }

    sendEditedMessage(message, text) {
        const newId = uuid.v4();
    
        if (message.contentType === 'application/sylk-file-transfer') {
			const transferId = message._id;
			let metadataContent;
			if (transferId in this.state.mediaLabels) {
				metadataContent = this.state.messagesMetadata[message._id];
				console.log('old metadataContent', metadataContent);
				if (metadataContent.metadataId) {
					this.props.deleteMessage(metadataContent.metadataId, this.state.selectedContact.uri);
				}
			}
			
			let messagesMetadata = this.state.messagesMetadata;
			
			//console.log('old message', message );

			metadataContent = {transferId: transferId, label:text, metadataId: newId};
			let metadataMessage = {_id: newId,
								   key: newId,
								   createdAt: new Date(),
								   metadata: metadataContent,
								   text: JSON.stringify(metadataContent),
								   };

			messagesMetadata[transferId] = metadataContent;
			console.log('new metadataContent', metadataContent);
			this.setState({
				messagesMetadata: { ...messagesMetadata }
			}, () => {
				// This runs AFTER messagesMetadata is updated
				this.setState({ mediaLabels: this.mediaLabels });
			});
			this.props.sendMessage(this.state.selectedContact.uri, metadataMessage, 'application/sylk-message-metadata');
        } else {
			message._id = newId;
			message.key = newId;
			message.text = text;
			this.props.deleteMessage(message._id, this.state.selectedContact.uri);
			this.props.sendMessage(this.state.selectedContact.uri, message);
        }
    }
    
    onSendMessage(messages) {
		const uri = this.state.selectedContact.uri;
		
		if (this.state.photoMsg) {
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

        if (!this.state.photoMsg) {
			return;
        }


        const uri = this.state.selectedContact.uri;
        const text = this.state.text.trim();
        const photoMsg = this.state.photoMsg;

		this.setState({ text: '' });
		this.textInputRef.clear?.();  // works for plain TextInput
		this.textInputRef.blur?.();   // dismiss keyboard

        this.setState({cameraAsset: null, 
                       photoMsg: null,
                       text: '',
                       texting: false,
                       placeholder: this.default_placeholder});
                       
        console.log('sendPhoto with label', text || 'Photo');

		if (text) {
			const transfer_id = photoMsg.metadata.transfer_id;
			const mId = uuid.v4();
			const metadataContent = {transferId: transfer_id, label: text, metadataId: mId};
			const metadataMessage = {_id: mId,
									 key: mId,
									 createdAt: new Date(),
									 metadata: metadataContent,
									 text: JSON.stringify(metadataContent),
									};
			//console.log('metadataMessage', metadataMessage);

			let messagesMetadata = this.state.messagesMetadata;
			messagesMetadata[transfer_id] = metadataContent;
			this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			this.setState({scrollToBottom: true,
						   messagesMetadata: messagesMetadata}
						   );
		}

        this.transferFile(this.state.photoMsg);
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
        console.log('deleteCameraAsset');
        if (this.state.photoMsg && this.state.photoMsg.metadata.transfer_id in this.outgoingPendMessages) {
            delete this.outgoingPendMessages[this.state.photoMsg.metadata.transfer_id]
        }

        // When cancelling or discarding an asset
        if (this.state.cameraAsset) {
			const fileUri = this.state.cameraAsset.uri.replace('file://', ''); // remove scheme
			  RNFS.unlink(fileUri)
			  .then(() => console.log('Temp file deleted'))
			  .catch(err => console.log('Error deleting temp file', err));
		  }

		this.setState(prevState => ({
		  renderMessages: prevState.renderMessages.filter(
			m => m._id !== prevState.photoMsg._id
		  ),
		  placeholder: this.default_placeholder,
		  photoMsg: null,
		  cameraAsset: null,
		  text: ''
		}));

		this.textInputRef.clear?.();  // works for plain TextInput
		this.textInputRef.blur?.();   // dismiss keyboard
    }

    async _pickDocument() {
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

    renderMessageImageOld =(props) => {
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

    renderMessageImage = (props: any) => {
        // https://github.com/FaridSafi/react-native-gifted-chat/issues/1950
        const images = [
          {
            url: props.currentMessage.image
          }
        ];

/*
          <TouchableOpacity
            onPress={() => console.log('single press')}
            onLongPress={() =>  console.log('longpress')}
            style={{ backgroundColor: "transparent" }}
          >
          </TouchableOpacity>

*/

        return (
            <FastImage
              style={{
                  width: '100%',
                  height: Dimensions.get('window').width,
                  marginBottom: -5
              }}

              source={{
                // @ts-ignore
                uri: props.currentMessage.image,
                priority: FastImage.priority.normal
              }}
              resizeMode={FastImage.resizeMode.cover}
            />
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
       console.log("The transfer has been canceled by the user.");
       this.postChatSystemMessage('Upload has canceled')
    }

    async transferFile(msg) {
        msg.metadata.preview = false;
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
        if (message.metadata && message.metadata.filename) {
            //console.log('File metadata', message.metadata.filename);
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
                    this.props.downloadFunc(currentMessage.metadata, true);
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

        if (message.audio || message.video) {
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

	replyMessage = (message) => {
	  this.setState({ replyingTo: message }, () => {
		// Wait one tick so the input is mounted before focusing
		setTimeout(() => this.textInputRef?.focus() , 100);
	  });
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
		? `Audio message (${audioDurations[currentMessage._id]}s)`
		: 'Audio message';
	
	  const isIncoming = currentMessage.direction === 'incoming';
	  const labelPadding =  isIncoming ? {paddingLeft: 10} : {paddingLeft: 0};

	  return (
		<View
		  style={[
			styles.audioContainer,
			{ flexDirection: 'row', alignItems: 'center' },
		  ]}
		>
		  {/* Icon on left for incoming, right for outgoing */}
		  {isIncoming && (
			<TouchableHighlight style={styles.roundshape}>
			  <IconButton
				size={28}
				onPress={() =>
				  currentMessage.metadata.playing
					? this.stopPlaying(currentMessage)
					: this.startPlaying(currentMessage)
				}
				style={styles.playAudioButton}
				icon={currentMessage.metadata.playing ? 'pause' : 'play'}
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
			<TouchableHighlight style={styles.roundshape}>
			  <IconButton
				size={28}
				onPress={() =>
				  currentMessage.metadata.playing
					? this.stopPlaying(currentMessage)
					: this.startPlaying(currentMessage)
				}
				style={styles.playAudioButton}
				icon={currentMessage.metadata.playing ? 'pause' : 'play'}
			  />
			</TouchableHighlight>
		  )}
		</View>
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
        const extraStyles = currentMessage.replyId ? {minWidth: 120} : {};

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
            return (
                <View style={[styles.photoMenuContainer, extraStyles]}>
                    <IconButton
                        style={styles.photoMenu}
                        size={20}
                        icon="menu"
                    />

                    <View style={styles.photoMenuText}>
                    <MessageText
                        {...props}
                        customTextStyle={styles.messageText}
                    />
                    </View>

                </View>
            );
        } else if (currentMessage.audio) {
            return (
                <View style={[styles.photoMenuContainer, extraStyles]}>
                    <IconButton
                        style={styles.photoMenu}
                        size={20}
                        icon="menu"
                    />
                </View>
            );
        } else if (currentMessage.image) {
            return (
                <View style={[styles.photoMenuContainer, extraStyles]}>
                    <IconButton
                        style={styles.photoMenu}
                        size={20}
                        icon="menu"
                    />

					  <View style={styles.photoMenuText}>
						<MessageText
						  {...labelProps}
						  customTextStyle={styles.messageText} // keeps your original styling
						/>
					  </View>

                </View>
            );
        } else {
            return (
                <View style={[styles.messageTextContainer, extraStyles]}>
                    <MessageText
                        {...props}
                        customTextStyle={styles.messageText}
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
			<View style={{ alignItems: 'flex-end' }}> 
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
			</View>
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

	get replyMessages() {
	  if (!this.state.messagesMetadata) return {};
	
	  return Object.fromEntries(
		Object.entries(this.state.messagesMetadata)
		  .filter(([, value]) => value.replyId)      // keep only those with replyId
		  .map(([key, value]) => [key, value.replyId]) // return key -> replyId
	  );
	}

	get mediaLabels() {
	  const data = this.state.messagesMetadata;  // ✅ correct property name
	  if (!data) return {};
	
	  return Object.fromEntries(
		Object.entries(data)
		  .map(([key, value]) => [key, value.label])
		  .filter(([, label]) => label !== undefined && label !== null)
	  );
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

    render() {
        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let messages = this.state.renderMessages;
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
		  //console.log(m._id, m.direction, m.text, m.replyId);
		
		  if (m._id in this.state.messagesMetadata) {
			// mutate the object directly
			m.replyId = this.state.messagesMetadata[m._id].replyId;
		  } else {
			m.replyId = null;
		  }
		});

        messages.forEach((m) => {
		  //console.log(m._id, m.direction, m.text, m.replyId);
        });

        let i = 1;
        let logText = '\n'; // initialize empty string

        for (const m of messages.slice().reverse()) {
		  //console.log(i, m._id, m.direction, m.text, m.replyId);
		  logText += `${i} ${m._id} ${m.direction} ${m.text} ${m.replyId || ''}\n`;
		  i = i + 1;
		}

        let addSpacer = false;
		if (Platform.OS === 'android') {
		  const androidVersion = Platform.Version;
		  if (androidVersion >= 34) {
			  addSpacer = true;
		  }
		}

		let filteredMessages = messages;
		
		// Filter messages that contain the search string (case-insensitive)
		if (this.state.searchMessages && this.state.searchString && this.state.searchString.length > 1) {
		  filteredMessages = messages.filter(msg => 
			msg.text && msg.text.toLowerCase().includes(this.state.searchString.toLowerCase())
		  );
		}
  
        // debug
        let debug = false;
        
        //debug = true;
       
        const messagesMetadata = this.state.messagesMetadata; 
        const replyMessages = this.replyMessages;
        const mediaLabels = this.state.mediaLabels;
          
		if (debug) {
			const values = {
				messagesMetadata,
				replyMessages,
				mediaLabels
			};
		
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
                <GiftedChat innerRef={this.chatListRef}
                  messages={filteredMessages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onMessagePress}
                  renderInputToolbar={chatInputClass}
				  renderBubble={(props) => this.renderBubble({ ...props, messages: filteredMessages })}
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
                  loadEarlier={showLoadEarlier}
                  isLoadingEarlier={this.state.isLoadingEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                  isTyping={this.state.isTyping}
                  keyboardShouldPersistTaps={"handled"}
                  keyboardDismissMode={"interactive"}
				  text={this.state.text}
                  onInputTextChanged={text => this.chatInputChanged(text)}
                  renderFooter={() => <View style={{ height: this.state.replyingTo ? footerHeightReply: footerHeight }} />}
                />

                {addSpacer ? <KeyboardSpacer /> : null }

              </View>
              : (items.length === 1) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
                  messages={filteredMessages}
                  renderInputToolbar={() => { return null }}
				  renderBubble={(props) => this.renderBubble({ ...props, messages: filteredMessages })}
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
    downloadFunc    : PropTypes.func,
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
    messagesMetadata: PropTypes.object
};


export default ContactsListBox;
