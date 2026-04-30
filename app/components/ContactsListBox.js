import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Modal, Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, Platform, PermissionsAndroid, Switch, StyleSheet, TextInput, TouchableOpacity, BackHandler, TouchableHighlight, KeyboardAvoidingView} from 'react-native';
import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble, MessageText, Send, InputToolbar, MessageImage, Time, Composer, Day, Message} from 'react-native-gifted-chat'
// Deep import — needed so the menu IconButton inside a custom bubble
// renderer can hand the same `context` object back to onLongMessagePress
// that GiftedChat's built-in long-press path supplies. Without this the
// menu button can't call `context.actionSheet().showActionSheetWithOptions(...)`.
import { GiftedChatContext } from 'react-native-gifted-chat/lib/GiftedChatContext';
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
import UserIcon from './UserIcon';
import { CustomMessageText } from './CustomMessageText';
import RenderHTML from 'react-native-render-html';

import * as Progress from 'react-native-progress';

import ChatBubble from './ChatBubble';
import LocationBubble from './LocationBubble';
import ThumbnailGrid from './ThumbnailGrid';
import AudioProgressSlider from './AudioProgressSlider';

import moment from 'moment';
import momenttz from 'moment-timezone';
import Video from 'react-native-video';
import VideoPlayer from 'react-native-video-player';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-camera-roll/camera-roll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import AudioRecord from 'react-native-audio-record';
import FastImage from 'react-native-fast-image';
import { ActivityIndicator, Animated, Alert } from 'react-native';
import dayjs from 'dayjs';

import styles from '../assets/styles/ContactsListBox';
import Share from 'react-native-share';

function linkifyHtml(html) {
  if (!html) return html;

  const urlRegex = /(https?:\/\/[^\s<]+)/g;

  return html.replace(urlRegex, (url) => {
    return `<a href="${url}">${url}</a>`;
  });
}


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

const navButton = {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: "rgba(0,0,0,0.4)",
  justifyContent: "center",
  alignItems: "center",
};

const audioRecorderPlayer = new AudioRecorderPlayer();

  // Helper to format bytes
  const formatFileSize = (bytes) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };


class ContactsListBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.chatListRef = React.createRef();
        this.flatListRef = null;
        this.default_placeholder = 'Type a message...';
		this.previousAudioMode = null;
                
        this.state = {
            accountId: this.props.account ? this.props.account.id : null,
            password: this.props.password,
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            orderBy: this.props.orderBy,
            sortOrder: this.props.sortOrder,
            isLandscape: this.props.isLandscape,
            contacts: this.props.contacts,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory,
            selectedContact: this.props.selectedContact,
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
            filter: this.props.contactsFilter,
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
			mediaRotations: {},
			text: '',
			fullSize: false,
			expandedImage: null,
			fullScreen: this.props.fullScreen,
			visibleMessageIds: [], 
			renderedMessageIds: new Set(),
			imageLoadingState: {},
			rotation: 0,
			gettingSharedAsset: this.props.gettingSharedAsset,
			videoLoadingState: {},
			transferProgress: this.props.transferProgress,
		    showVideoModal: false,
		    modalVideoUri: null,
		    videoMetaCache: {},
		    totalMessageExceeded: false,
		    videoPaused: true,
			focusedMessages: null,  // array of currently rendered messages in focus mode
			prevMessages: [],        // older messages before the focused message
			nextMessages: [],        // newer messages after the focused message
			focusedMessageId: null,  // the message ID currently in focus
			loadedMinIndex: null,      // lowest index loaded in focusedMessages
		    loadedMaxIndex: null,      // highest index loaded in focusedMessages
		    playRecording: this.props.playRecording,
		    audioRecordingStatus: {},
		    callHistoryUrl: this.props.callHistoryUrl,
		    isAudioRecording: this.props.isAudioRecording,
		    recordingFile: this.props.recordingFile,
		    insets: this.props.insets,
		    composerHeight: 48,
		    replyContainerHeight: 0,
		    appState: this.props.appState,
		    allContacts: this.props.allContacts,
		    groupOfImage: {}, // in what groups does an image appear
		    imageGroups: {}, // in which group is an image present
		    selectedImages: [],
		    selectedImagesSearch: [],
		    thumbnailGridSize: {},
		    sharingAssets: [],
            sharingMessages: [],
            showScrollSideButtons: false,
            actionSheetDisplayed: false,
            // iOS-only audio player state. AVAudioPlayer (used by
            // react-native-audio-recorder-player on iOS) silently fails to
            // decode some MP3 variants — VBR Sony hardware-recorder output
            // in particular accepts the prepare/play step but never emits a
            // frame. AVPlayer (via react-native-video in audioOnly mode)
            // handles them. On iOS we bypass audioRecorderPlayer entirely
            // and drive playback through a hidden <Video> component fed by
            // this state. Android continues to use audioRecorderPlayer.
            iosAudio: {
                path: null,
                message: null,
                paused: true,
                duration: 0,    // seconds, set on onLoad
                hasSeeked: false,
            },
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

        if ('messagesMetadata' in nextProps) {
			 this.setState({messagesMetadata: nextProps.messagesMetadata});
        }
        
        if ('composerHeight' in nextProps) {
			 this.setState({composerHeight: nextProps.composerHeight});
	    }

        if ('replyContainerHeight' in nextProps) {
			 this.setState({replyContainerHeight: nextProps.replyContainerHeight});
			 console.log('replyContainerHeight', replyContainerHeight);
	    }

		if (nextProps.selectedContact !== this.state.selectedContact) {
		    if (!nextProps.selectedContact && nextProps.selectedContact) {
				console.log('Selected contact changed to', nextProps.selectedContact.uri);
            }
            if (!nextProps.selectedContact) { 
				this.resetContact()
            }
            this.setState({selectedContact: nextProps.selectedContact});

            if (nextProps.selectedContact) {
               this.setState({scrollToBottom: true});
            } else {
                this.setState({renderMessages: []});
            }
        };
        
        // load only messages that have changed
		if (nextProps.selectedContact) {
		  const uri = nextProps.selectedContact.uri;

		  if (uri in nextProps.messages) {
			const oldMessages = this.state.renderMessages || [];

		    let newMessages = [...nextProps.messages[uri]] || [];
			// Sort newest → oldest. Coerce createdAt to a numeric ms
			// value before comparing — the incoming-websocket path used
			// to hand us createdAt as an ISO string while the outgoing
			// path uses a Date. Comparing Date < string under JS numeric
			// rules yields false on both sides, the comparator returns
			// 0 for every pair involving the mixed-type bubble, and the
			// reply silently lands above the user's just-sent message.
			// The sylk2GiftedChat fix already normalises new bubbles to
			// Date, but this guard keeps any stray string-shaped row
			// from reintroducing the bug.
			const _ts = (v) => {
				if (v == null) return 0;
				if (v instanceof Date) return v.getTime();
				if (typeof v === 'number') return v;
				const t = new Date(v).getTime();
				return isNaN(t) ? 0 : t;
			};
			newMessages = newMessages.sort(function (a, b) {
			  const ta = _ts(a.createdAt);
			  const tb = _ts(b.createdAt);
			  if (ta < tb) return 1;
			  if (ta > tb) return -1;
			  if (a.msg_id < b.msg_id) return 1;
			  if (a.msg_id > b.msg_id) return -1;
			  return 0;
			});

			// === INITIAL LOAD ===
			if (oldMessages.length === 0 && newMessages.length > 0) {
			  this.exitFocusMode();

			  this.setState({
				renderMessages: newMessages,
				scrollToBottom: true,
			  });
		
			  this.props.confirmRead(uri, "initial_load");
			  return;
			}

			// Quick check for different length or IDs
			const sameLength = oldMessages.length === newMessages.length;
			const idsEqual = sameLength && oldMessages.every((m, i) => m._id === newMessages[i]._id);
		
			const equalNullish = (a, b) =>
			  (a == null && b == null) ? true : a === b;
			
			const fields = [
			  "pending",
			  "sent",
			  "received",
			  "failed",
			  "pinned",
			  "text",
			  "image",
			  "video",
			  "audio",
			  "playing",
			  "consumed",
			  "position"
			];
			
			// Detect individual changes
			const changedIds = [];

			if (idsEqual) {
			  for (let i = 0; i < newMessages.length; i++) {
				const a = oldMessages[i];
				const b = newMessages[i];
				// For live-location bubbles, `text` and `metadata` are
				// locally synthesized in componentDidUpdate from
				// messagesMetadata (see tickMarker logic below). The
				// parent's state.messages[uri] still holds the bubble
				// stamped by _injectLocationBubble with the ORIGINAL
				// (placeholder) tick's timestamp, and never updates —
				// follow-up ticks flow through messagesMetadata instead.
				// If we treated `text` as a change here, every prop
				// update that re-emits messages[uri] would revert the
				// bubble's text to the placeholder and the map would
				// visibly flicker between "Locating…" and the real
				// position on every tick.
				const isLocBubble = a
					&& a.contentType === 'application/sylk-live-location';
				for (const f of fields) {
				  if (isLocBubble && (f === 'text')) continue;
				  if (!equalNullish(a[f], b[f])) {
					changedIds.push(a._id);
					break; // no need to check other fields
				  }
				}
			  }
			}
	
			// === MERGE / UPDATE ===
			if (!idsEqual || changedIds.length > 0) {
			  //console.log("Changed message IDs:", changedIds);
				if (changedIds.length > 0) {
					  //console.log("Changed messages:");
					  changedIds.forEach(id => {
						const idx = oldMessages.findIndex(m => m._id === id);
						const oldMsg = oldMessages[idx];
						const newMsg = newMessages[idx];

						const diff = {};

						fields.forEach(key => {
						  if (oldMsg[key] !== newMsg[key]) {
							diff[key] = {
							  from: oldMsg[key],
							  to: newMsg[key]
							};
						  }
						});

						//console.log(` MSG ID ${id}:`, diff);
					  });
				}

			  // Merge shallowly to preserve refs.
			  // For live-location bubbles we ALWAYS preserve the
			  // locally-synthesized `text` and `metadata` fields coming
			  // from oldMessages — the parent's bubble in state.messages[uri]
			  // stays at the original placeholder-tick text forever, but
			  // componentDidUpdate bumps them on every new tick via the
			  // locationData getter. Without this preservation the next
			  // prop update (e.g. a contact-timestamp bump or SQL save)
			  // would revert the bubble to the stale placeholder and the
			  // LocationBubble would flicker between "Locating…" and the
			  // real coords on every tick.
			  const merged = newMessages.map((m, i) => {
				if (idsEqual && !changedIds.includes(m._id)) {
				  return oldMessages[i];
				}
				if (m && m.contentType === 'application/sylk-live-location') {
				  const old = idsEqual
					? oldMessages[i]
					: oldMessages.find(o => o && o._id === m._id);
				  if (old
					  && old.contentType === 'application/sylk-live-location') {
					return {
					  ...m,
					  text: old.text,
					  metadata: old.metadata,
					};
				  }
				}
				return m;
			  });

			  try {
				// intentionally no-op — merge diagnostic logs removed once
				// the live-location bubble merge behaviour stabilised.
			  } catch (e) { /* noop */ }

			  this.setState({
				renderMessages: merged
			  });
		
			  //this.props.confirmRead(uri, "new_messages");
			}
		  }
		} else if (!nextProps.selectedContact) {
		      //console.log('No selected contact anymore')
			  this.setState({
				renderMessages: [],
				filteredMessages: []
			  });
		}

        //console.log('Update contacts', nextProps.selectedContact);

        if (nextProps.myInvitedParties !== this.state.myInvitedParties) {
            this.setState({myInvitedParties: nextProps.myInvitedParties});
        }

        if (nextProps.contacts !== this.state.contacts) {
            this.setState({contacts: nextProps.contacts});
        }
        
        if (nextProps.orderBy !== this.state.orderBy) {
            this.setState({orderBy: nextProps.orderBy});
        }

        if (nextProps.sortOrder !== this.state.sortOrder) {
            this.setState({sortOrder: nextProps.sortOrder});
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

        if ('messagesCategoryFilter' in nextProps) { 
			if (nextProps.messagesCategoryFilter !== this.state.messagesCategoryFilter && nextProps.selectedContact) {
				this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: this.state.pinned});
			}
        }

        if (nextProps.pinned !== this.state.pinned && nextProps.selectedContact) {
            this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: nextProps.pinned});
        }

        if (nextProps.hasOwnProperty('keyboardVisible')) {
            this.setState({keyboardVisible: nextProps.keyboardVisible});
        }
        
        if ('gettingSharedAsset' in nextProps) {
            this.setState({gettingSharedAsset: nextProps.gettingSharedAsset});
        }

		if ('playRecording' in nextProps) {
			this.setState({playRecording: nextProps.playRecording});
		}

		if ('audioRecordingStatus' in nextProps) {
			this.setState({audioRecordingStatus: nextProps.audioRecordingStatus});
		}
 
        this.setState({isLandscape: nextProps.isLandscape,
                       isTablet: nextProps.isTablet,
                       chat: nextProps.chat,
                       fontScale: nextProps.fontScale,
                       filter: nextProps.contactsFilter,
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
                       fullScreen: nextProps.fullScreen,
					   transferProgress: nextProps.transferProgress,
					   totalMessageExceeded: nextProps.totalMessageExceeded,
					   playRecording: nextProps.playRecording,
					   callHistoryUrl: nextProps.callHistoryUrl,
					   isAudioRecording: nextProps.isAudioRecording,
					   recordingFile: nextProps.recordingFile,
					   insets: nextProps.insets,
					   appState: nextProps.appState,
					   allContacts: nextProps.allContacts
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
		// Prevent kicking off duplicate loads for the same message — both
		// renderMessageAudio and renderTime ask for the duration, and they
		// can run many times before the async callback resolves.
		if (!this._audioDurationsInFlight) this._audioDurationsInFlight = new Set();
		if (this._audioDurationsInFlight.has(messageId)) return;
		if (this.state.audioDurations && messageId in this.state.audioDurations) return;
		this._audioDurationsInFlight.add(messageId);

		const Sound = require('react-native-sound'); // import dynamically
		// Cache the failure too so we don't keep re-trying on every
		// render. iOS's react-native-sound rejects some MP3 variants
		// (OSStatus 1685348671 / 'djio' — header-size parsing) that
		// AVAudioPlayer plays just fine, so a failure here must NOT
		// affect playback. We just store 0 so getAudioDuration returns
		// it as "no duration label", and let startAudioPlayer drive
		// playback independently.
		const sound = new Sound(filePath, '', (error) => {
		  if (error) {
			// Log compactly — the full native stack trace was noise.
			console.log('Audio duration probe failed for', messageId,
			    'code=', error && error.code,
			    'msg=', error && error.message);
			this._audioDurationsInFlight.delete(messageId);
			this.setState((prevState) => ({
			  audioDurations: {
				...prevState.audioDurations,
				[messageId]: 0, // 0 → durationLabel falls back to "Recording"
			  },
			}));
			try { sound.release && sound.release(); } catch (e) { /* ignore */ }
			return;
		  }
		  let duration = Math.floor(sound.getDuration());
		  this._audioDurationsInFlight.delete(messageId);
		  this.setState((prevState) => ({
			audioDurations: {
			  ...prevState.audioDurations,
			  [messageId]: duration,
			},
		  }));
		  try { sound.release && sound.release(); } catch (e) { /* ignore */ }
		});
	  };
  
    async aquireFromCamera() {
        console.log('aquireFromCamera');
		this.setState({gettingSharedAsset: true, renderMessages:[]}); 
		this._aquireFromCamera();
		setTimeout(() => {
			this.setState({gettingSharedAsset: false}); 
		}, 45000); // delay in ms (1000 = 1 second)
    }

    async _aquireFromCamera() {
		const cameraAllowed = await this.props.requestCameraPermission();

		if (cameraAllowed) {
			let options = {maxWidth: 4000,
							maxHeight: 4000,
							mediaType: 'mixed',
							quality: 0.8,
							cameraType: 'front',
							saveToPhotos: true,
							formatAsMp4: true
						   }

			this.props.contactStartShare();
		
			launchCamera(options, (result) => {
				// Detect cancel
				if (result.didCancel) {
					console.log("User cancelled camera");
					this.setState({gettingSharedAsset: false}); 
					return;
				}
					
				// Detect errors
				if (result.errorCode) {
					console.log("Camera error:", result.errorMessage);
					this.setState({gettingSharedAsset: false}); 
					return;
				}
	
				// Proceed normally
				if (result.assets && result.assets.length > 0) {
					this.assetSharingCallback(result.assets);
				}
			});
		}
	}

    async launchImageLibrary() {
		this._launchImageLibrary();
		this.setState({gettingSharedAsset: true});
		setTimeout(() => {
			this.setState({gettingSharedAsset: false}); 
		}, 45000);
	}

	async _launchImageLibrary() {
        let options = { maxWidth: 4000,
                        maxHeight: 4000,
                        mediaType: 'mixed',
                        selectionLimit: 10,
                        formatAsMp4: true
                       }

		this.props.contactStartShare()
        await launchImageLibrary(options, this.libraryCallback);
    }

    async libraryCallback(result) {
		this.setState({fullSize: false, gettingSharedAsset: false});

		if (result.errorCode) {
			console.log("Picker error:", result.errorMessage);
			this.props.contactShareError?.(result.errorCode);
			this.setState({gettingSharedAsset: false}); 
			return;
		}
	
		if (!result.assets || result.assets.length === 0) {
			console.log("No assets returned");
			this.setState({gettingSharedAsset: false});
			return;
		}

		this.assetSharingCallback(result.assets);
    }

    async assetSharingCallback(assets) {
        console.log('assetSharingCallback', assets.length);
		this.setState({scrollToBottom: true, gettingSharedAsset: false});
		this.scrollToBottom();
		
        if (!assets || assets.length === 0) {
            return;
        }
        
        let messages = [];
        let msg;
        let assetType = 'file';

        for (const asset of assets) {
			asset.preview = true;
			msg = await this.props.file2GiftedChat(asset);
			messages.push(msg);
			if (msg.video) {
				assetType = 'movie';
			} else if (msg.image) {
				assetType = 'photo';
			} else if (msg.audio) {
				assetType = 'audio';
			}

			console.log('Build temporary', assetType, 'message', msg._id);
        }

        this.setState({ sharingAssets: assets,
                        sharingMessages: messages,
                        renderMessages: GiftedChat.append(messages, []),
						fullSize: false,
                        //placeholder: 'Send ' + assetType + ' of ' + utils.beautySize(msg.metadata.filesize)
						placeholder: 'Add a note, or just click Send...'
                        });
    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props}
         recordAudio={this.props.recordAudio}
         isAudioRecording={this.state.isAudioRecording}
         recordingFile={this.state.recordingFile}
         texting={this.state.texting || this.state.replyingTo}
         sendingImage={this.state.sharingMessages.length > 0}
         deleteSharingAssets={this.deleteSharingAssets}
         selectedContact={this.state.selectedContact}/>
    )

    chatInputChanged(text) {
       this.setState({texting: (text.length > 0), text: text})
    }

    resetContact() {
		this.stopAudioPlayer();

        this.setState({
            texting: false,
            sharingAssets: [],
            sharingMessages: [],
            placeholder: this.default_placeholder
        });
    }

	renderBubbleWithMessages = (props) => {
	  return this.renderBubble({ ...props, messages: this.state.filteredMessages });
	};

	renderBubble(props) {
	  return (
		<ChatBubble
		  {...props}  
		  currentMessage={props.currentMessage}
		  messages={props.messages}
		  previousMessage={props.previousMessage}
		  nextMessage={props.nextMessage}
		  position={props.position}
		  mediaLabels={this.state.mediaLabels}
	      replyMessages = {this.state.replyMessages}
		  bubbleWidths={this.state.bubbleWidths}
		  videoMetaCache={this.state.videoMetaCache}
		  imageLoadingState={this.state.imageLoadingState}
		  handleBubbleLayout={this.handleBubbleLayout}
		  scrollToMessage={this.goToMessage}
		  transferProgress={this.state.transferProgress}
		  visibleMessageIds={this.state.visibleMessageIds}
		  renderMessageImage={this.renderMessageImage}
		  renderMessageVideo={this.renderMessageVideo}
		  renderMessageAudio={this.renderMessageAudio}
		  renderMessageText={this.renderMessageText}
		  focusedMessageId={this.state.focusedMessageId}
		  imageGroups={this.state.imageGroups}
		  groupOfImage={this.state.groupOfImage}
		  thumbnailGridSize={this.state.thumbnailGridSize}
		  fullSize={this.state.fullSize}
		  sortOrder={this.state.orderBy}
		  styles={styles}
		/>
	  );
	}

   exitFullScreen() {
		this.props.setFullScreen(false);
		this.setState({ expandedImage: null});
   }
	
	onImagePress = (message) => {
	  const { expandedImage } = this.state;
	  console.log('onImagePress', 'fullScreen', this.state.fullScreen);

	  if (expandedImage) {
		this.saveRotation(expandedImage._id, this.state.rotation);
		this.exitFullScreen();
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
	  let inputToolbarExtraStyles = {
      paddingBottom: 0,
      borderTopWidth: 0,
    };
        	  
	  if (this.state.keyboardVisible && Platform.OS === 'android' && Platform.Version >= 34) {
		  const bottomInset = this.state.insets?.bottom || 0;
		  //inputToolbarExtraStyles.marginBottom = -bottomInset;
	  }
	
	  return (
		<InputToolbar
		  {...props}
		  containerStyle={[styles.inputToolbar, inputToolbarExtraStyles]} // full width
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
	
	  const LINE_HEIGHT = 20;
      const MAX_LINES = 5;
      const VERTICAL_PADDING = Platform.OS === 'ios' ? 24 : 20;

	  return (
		<View style={{ flex: 1}}>
	
		  {/* Full-width Reply Preview */}
		  {replyingTo && (
			<View 
			onLayout={this.onReplyContainerLayout}
			style={[styles.replyPreviewContainer, 
			
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
			onLayout={this.onComposerLayout}
			style={{
			  justifyContent: 'center',
			  alignSelf: 'stretch', // make it fill horizontally
			}}
		  >
			<TextInput
			  ref={(r) => (this.textInputRef = r)}
			  editable={!this.state.isAudioRecording && !this.state.recordingFile}
			  style={{
				fontSize: 16,
				borderWidth: 0,
				paddingVertical: Platform.OS === 'ios' ? 12 : 10,
				paddingHorizontal: 8,
				lineHeight: 20,
				minHeight: 36,
				maxHeight: 20 * 5 + (Platform.OS === 'ios' ? 24 : 20),
				textAlignVertical: 'center',
				color: '#000',
			  }}
			  placeholder={replyingTo ? 'Reply with...' : this.state.placeholder}
			  placeholderTextColor="#999"
			  multiline
			  scrollEnabled
			  onChangeText={composerProps.onTextChanged}
			  value={composerProps.text}
			  // 'center' instead of 'top' so the placeholder/text sits
			  // on the same baseline as the Delete and Send icons in
			  // the input toolbar (the row uses alignItems: 'center').
			  textAlignVertical="center"
			/>
		  </View>
		</View>
	  );
	};

	onReplyContainerLayout = (e) => {
	  const { height } = e.nativeEvent.layout;
	
	  if (height !== this.state.onReplyContainerLayout) {
		this.setState({ replyContainerHeight: height });
	  }
	};

	onComposerLayout = (e) => {
	  const { height } = e.nativeEvent.layout;
	
	  if (height !== this.state.composerHeight) {
		this.setState({ composerHeight: height });
	  }
	};

	renderSend = (props) => {
	  let chatActionContainer = styles.chatActionContainer;
	  
	  let disableAttachments = this.state.selectedContact.tags.indexOf('test') > -1;
	  
	  if (this.state.sharingAssets.length > 0) {
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
			  <TouchableOpacity onPress={this.sharePendingFiles}>
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
	  } else if (this.state.recordingFile) {
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
			  <TouchableOpacity onPress={this.props.sendAudioFile}>
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

		if (this.state.playing) {	
		  return <View />;
		}
	
		let showButtons = !this.state.texting && !this.state.replyingTo && !this.state.isAudioRecording && !this.state.recordingFile;
		
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
			  {showButtons && !disableAttachments && (
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
	
			  {showButtons && !disableAttachments && (
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

              {!this.state.isAudioRecording && (
			  <Icon
				type="font-awesome"
				name="send"
				style={styles.chatSendArrow}
				size={20}
				color='gray'
			  />
			  )}
			  
			</View>
		  </Send>
		);
	  }
	};

    async handleShare(message, email=false) {
        //console.log('-- handleShare\n', JSON.stringify(message, null, 2));
        let what = 'Message';

        console.log('handleShare', message._id);
		// For a group leader bubble: share the user's selection if any,
		// otherwise share the whole group. Single (non-leader) messages
		// fall through to the regular single-message share below.
		let targetIds = null;
		if (message._id in this.state.imageGroups) {
			const sel = this.state.selectedImages || [];
			targetIds = sel.length > 0
				? sel
				: (this.state.imageGroups[message._id] || []);
		}

		if (targetIds && targetIds.length > 0) {
			console.log(' -- handleShare', targetIds);

			what = 'Share images';
			let urls = [];
	
			for (let msg of this.state.filteredMessages) {
				if (!targetIds.includes(msg._id)) continue;
	
				if (msg.metadata && msg.metadata.local_url) {
					let filePath = msg.metadata.local_url;
	
					if (Platform.OS === 'android') {
						try {
							const filename = msg.metadata.filename || `file-${Date.now()}`;
							const destPath = `${RNFS.CachesDirectoryPath}/${filename}`;
							await RNFS.copyFile(filePath, destPath);
							filePath = `file://${destPath}`;
						} catch (err) {
							console.log('Error copying file:', err);
							continue;
						}
					}
	
					urls.push(filePath);
				}
			}
	
			if (urls.length === 0) {
				console.log('No files to share');
				return;
			} else {
				console.log('Sharing urls', urls);
			}
	
			const options = {
				title: what,
				urls: urls,
			};
	
			try {
				await Share.open(options);
			} catch (error) {
				console.log('Error sharing multiple', error);
			}
	
			return;
		}

		let options = {
			title: 'Share Message',
			subject: 'Sylk shared message',
			message: message.text
		};    

        if (message.metadata && message.metadata.filename) {
            console.log('Sharing file');
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

	async startAudioPlayer(message) {
		const id = message._id;

		// Send IMDN "displayed" FIRST — before any other work — the moment
		// the recipient presses Play. Doing this before stopAudioPlayer() and
		// audioRecorderPlayer.startPlayer() ensures the network notification
		// is queued in the JS event loop ahead of any blocking native calls
		// the player might do, so the sender sees "displayed" immediately
		// rather than after playback finishes.
		if (message.direction === 'incoming' && this.props.markAudioMessageDisplayedFunc) {
			try {
				this.props.markAudioMessageDisplayedFunc(message);
			} catch (e) {
				console.log('markAudioMessageDisplayedFunc error', e);
			}
		}

		// Already playing THIS exact message — no-op. Use the synchronous
		// instance ref `currentAudioMessage` (set in the playback listener,
		// cleared by stopAudioPlayer) instead of `state.audioRecordingStatus`,
		// which lags by one async setState round and used to bail on every
		// tap-to-replay (especially after the synchronous audioRecordingStatus
		// seed lower in this function set transfer_id pre-emptively, so the
		// state.transfer_id always matched id on subsequent taps and the
		// function returned before reaching audioRecorderPlayer.startPlayer).
		if (this.currentAudioMessage && this.currentAudioMessage._id === id) {
			return;
		}

		this.stopAudioPlayer();

		this.props.startAudioPlayerFunc();

		// Seed audioRecordingStatus synchronously so the bubble's `isCurrent`
		// check (audioRecordingStatus.metadata.transfer_id === currentMessage
		// .metadata.transfer_id) is true the moment `currentMessage.playing`
		// flips to true. Without this, the first render after the first
		// playback tick still has audioRecordingStatus={} (transfer_id
		// undefined) → isCurrent=false → isPlaying gets force-cleared → the
		// bubble's icon stays as "play" until a later React commit picks up
		// the listener's setState. That's the "play -> pause flips after a
		// while" lag we see in metro.log: msg.playing=true with
		// status.tid=undefined on the first render.
		this.setState({
			audioRecordingStatus: {
				metadata: message.metadata,
				duration: '00:00',
				position: message.metadata?.position || 0,
			},
		});

		// iOS playback engine fork. AVAudioPlayer (used by
		// audioRecorderPlayer on iOS) accepts but doesn't decode certain
		// MP3 variants (notably VBR Sony recorder output). AVPlayer via
		// react-native-video handles those reliably. On iOS we set
		// iosAudio state, render a hidden <Video audioOnly>, and let its
		// onLoad/onProgress/onEnd callbacks drive the same updates the
		// addPlayBackListener path produces on Android.
		//
		// TEMPORARILY DISABLED — re-testing with audioRecorderPlayer for
		// well-formed files (e.g. transcoded m4a). The <Video> path
		// played audio but the play↔pause icon and slider didn't update,
		// so we need to rework state propagation before re-enabling.
		// Flip USE_IOS_VIDEO_AUDIO_PLAYER to true to restore the AVPlayer
		// path for AVAudioPlayer-incompatible MP3s.
		const USE_IOS_VIDEO_AUDIO_PLAYER = false;
		if (USE_IOS_VIDEO_AUDIO_PLAYER && Platform.OS === 'ios') {
			const iosPath = message.audio.startsWith('file://')
				? message.audio
				: 'file://' + message.audio;
			this.currentAudioMessage = message;
			this.currentAudioDurationMs = 0;
			this.setState({
				iosAudio: {
					path: iosPath,
					message: message,
					paused: false,
					duration: 0,
					hasSeeked: false,
				},
			});
			return;
		}

		const path = message.audio.startsWith('file://') ? message.audio : 'file://' + message.audio;

		try {
		    /*
			if (Platform.OS === 'android') {
			    this.previousAudioMode = await AudioRouteModule.getAudioMode();
			    console.log('Previous audio mode', this.previousAudioMode);
			    await AudioRouteModule.setAudioMode(0); // MODE_NORMAL
			}
			*/

			await audioRecorderPlayer.startPlayer(path);

			// Silence-on-resume seek. If the user scrubbed the slider
			// to a non-zero position before pressing Play, we want
			// playback to begin AT that position — not at 0 with the
			// first ~500 ms audible before the listener's first tick
			// gets to issue seekToPlayer(). Pause immediately after
			// startPlayer so the player loads but doesn't emit audio,
			// and let the listener resume after the seek lands.
			const savedPct = message.metadata && message.metadata.position;
			const needsSeek = typeof savedPct === 'number' && savedPct > 0 && savedPct < 100;
			if (needsSeek) {
				try {
					await audioRecorderPlayer.pausePlayer();
				} catch (e) {
					console.log('[startAudioPlayer] pause-for-seek failed', e && e.message);
				}
			}

			// Silent-failure watchdog. iOS AVAudioPlayer accepts some
			// MP3 variants (e.g. VBR Sony recorder output) at the
			// prepare/play step but never emits decoded frames or
			// listener ticks. Without this guard the bubble locks at
			// "playing" with no audio and no way for the user to
			// retap (the early-return guard above sees
			// currentAudioMessage as set). If no tick has fired
			// within `noTickGraceMs`, declare the playback failed,
			// stop the player, restore state, and surface a system
			// message so the user knows what happened.
			const noTickGraceMs = 2000;
			this._anyTickReceived = false;
			if (this._noTickTimer) clearTimeout(this._noTickTimer);
			this._noTickTimer = setTimeout(() => {
				if (this._anyTickReceived) return;
				if (!this.currentAudioMessage || this.currentAudioMessage._id !== id) return;
				console.log('[startAudioPlayer] no tick within',
				    noTickGraceMs, 'ms — silent decoder failure');
				try { audioRecorderPlayer.stopPlayer(); } catch (e) { /* ignore */ }
				try { audioRecorderPlayer.removePlayBackListener(); } catch (e) { /* ignore */ }
				this.props.stopAudioPlayerFunc && this.props.stopAudioPlayerFunc();
				this.setState({audioRecordingStatus: {}});
				this.currentAudioMessage = null;
				this.currentAudioDurationMs = 0;
				const watchdogTitle = "Could not play audio";
				const watchdogBody = "The player started without errors but produced no sound — the file format may not be supported. Open the message menu and share it to another app.";
				Alert.alert(watchdogTitle, watchdogBody, [{ text: 'OK', style: 'default' }]);
				this.postChatSystemMessage(watchdogTitle + ' — ' + watchdogBody);
			}, noTickGraceMs);

			// Heuristic state for detecting "playback actually finished" even
			// when the underlying player gets stuck a few hundred ms before
			// the reported duration (observed on Android: currentPosition
			// caps out at ~3780 of 3840 and never fires the final tick).
			let hasSeeked = false;
			// After the seek is issued, the underlying player can briefly
			// report currentPosition=0 (or anything below the target) for one
			// or two ticks while it catches up. We swallow those ticks so the
			// slider doesn't jump backward to 0 and then forward again — the
			// resume should look like a continuous forward motion only.
			let seekTargetMs = 0;
			let seekSettled = false;
			let playStartWall = Date.now();
			let lastCurrent = 0;
			let lastTickWall = Date.now();
			this.currentAudioDurationMs = 0;
			this.currentAudioMessage = message;

			audioRecorderPlayer.addPlayBackListener((e) => {
				if (!e.duration || e.duration <= 0) return;
				// Disarm the silent-decoder watchdog the moment we get
				// a meaningful tick — file is decoding fine.
				this._anyTickReceived = true;

				const current = Math.floor(e.currentPosition);
				const duration = Math.floor(e.duration);
				this.currentAudioDurationMs = duration;

				if (!message.metadata.position || message.metadata.position === 100) {
					message.metadata.position = 0;
				}

				if (!message.metadata.consumed) {
					message.metadata.consumed = 0;
				}

				this.props.updateFileTransferMetadata(message.metadata, 'playing', true);

				if (!hasSeeked) {
					const seekPosition = (message.metadata.position / 100) * duration;
					console.log('Seek to', seekPosition, 'of total', e.duration);
					audioRecorderPlayer.seekToPlayer(seekPosition);
					hasSeeked = true;
					seekTargetMs = Math.floor(seekPosition);
					seekSettled = seekTargetMs <= 0;
					// If we paused immediately after startPlayer (because
					// savedPct > 0), resume now that the seek has been
					// issued — the user hears playback only from the
					// requested position, not from 0.
					if (needsSeek) {
						try {
							audioRecorderPlayer.resumePlayer();
						} catch (e2) {
							console.log('[startAudioPlayer] resume-after-seek failed', e2 && e2.message);
						}
					}
					// Pre-publish the resume position to the slider so it
					// stays where the user paused/seeked to instead of
					// snapping back to 0 while the player settles.
					const seekPct = duration > 0
						? Math.max(0, Math.min(100, Math.floor((seekPosition / duration) * 100)))
						: 0;
					this.setState({
						audioRecordingStatus: {
						  metadata: message.metadata,
						  duration: audioRecorderPlayer.mmssss(duration),
						  position: seekPct,
						},
					});
					// Reset the wall-clock baseline using how much of the
					// clip is still expected to play, so the elapsed-time
					// finish heuristic doesn't fire too early when resuming.
					const remainingMs = Math.max(0, duration - seekPosition);
					playStartWall = Date.now() - (duration - remainingMs);
					lastCurrent = Math.floor(seekPosition);
					lastTickWall = Date.now();
					return;
				}

				// Swallow ticks that arrive before the player has actually
				// jumped to the seek target — they would briefly drag the
				// slider backwards. Once we see a tick at/after the target
				// (with a small tolerance) we mark seek as settled and let
				// updates flow through normally.
				if (!seekSettled) {
					if (current + 100 >= seekTargetMs) {
						seekSettled = true;
					} else {
						return;
					}
				}

				let percentage = Math.floor((current / duration) * 100); // Integer between 0 and 100

				// Track tick advancement for the "stuck near end" heuristic.
				const now = Date.now();
				if (current > lastCurrent) {
					lastCurrent = current;
					lastTickWall = now;
				}

				const elapsedWall = now - playStartWall;
				const remainingMs = duration - current;

				// Multiple ways to declare "finished":
				//   1. Player got within 300ms of the end (original check).
				//   2. Percentage clamped to >=99% (original check).
				//   3. Wall-clock time since start exceeds duration + 250ms
				//      grace (handles players that stop ticking before 100%).
				//   4. We've been within 500ms of the end for >750ms with no
				//      further position advancement (stuck-near-end guard).
				const isFinished =
					remainingMs <= 300 ||
					percentage >= 99 ||
					elapsedWall >= duration + 250 ||
					(remainingMs <= 500 && (now - lastTickWall) > 750 && percentage >= 90);

				if (isFinished) {
					// Playback finished
					percentage = 100;
					this.setState(
					  {
						audioRecordingStatus: {
						  metadata: message.metadata,
						  duration: audioRecorderPlayer.mmssss(duration),
						  position: percentage,
						},
					  },
					  () => {
						// This runs after setState is finished
						this.stopAudioPlayer();
					  }
					);
				} else {
					this.setState({
						audioRecordingStatus: {
						  metadata: message.metadata,
						  duration: audioRecorderPlayer.mmssss(duration),
						  position: percentage,
						}});
				}
			});

		} catch (e) {
			console.log('[startAudioPlayer] error', 'msg=', e && e.message,
			    'code=', e && e.code, 'domain=', e && e.domain);
			// Player failed to load this file. Roll back the in-flight
			// audioRecordingStatus seed so the bubble doesn't think it's
			// playing — and so the next tap isn't blocked by the
			// "already playing" guard above.
			this.props.stopAudioPlayerFunc && this.props.stopAudioPlayerFunc();
			this.setState({audioRecordingStatus: {}});
			this.currentAudioMessage = null;
			this.currentAudioDurationMs = 0;
			// Surface to the user via a native Alert (guaranteed
			// visible) plus a chat system note for the record.
			const errTitle = "Could not play audio";
			const errBody = (e && e.message) || 'Unknown error from audio player';
			Alert.alert(errTitle, errBody, [{ text: 'OK', style: 'default' }]);
			this.postChatSystemMessage(errTitle + ' — ' + errBody);
		}
	}

	pauseAudioForScrub(message) {
		// Called the moment the user touches the slider. If this audio is
		// currently playing, pause it so it doesn't keep advancing under the
		// drag — the user has to press Play again to resume from the new
		// position.
		const status = this.state.audioRecordingStatus;
		const isCurrent =
			status && status.metadata && status.metadata.transfer_id === message.metadata.transfer_id;
		if (isCurrent) {
			this.stopAudioPlayer();
		}
	}

	async seekAudioMessage(message, percentage) {
		// Called on slider release. percentage is 0..100. We always just
		// persist the new position — playback was paused on touch start, so
		// the user must press Play to resume from the new position. The
		// existing seek-on-start logic in startAudioPlayer will jump to
		// metadata.position when Play is pressed.
		const pct = Math.max(0, Math.min(100, Math.round(percentage)));
		message.metadata.position = pct;
		this.props.updateFileTransferMetadata(message.metadata, 'position', pct);
	}
	
    async stopAudioPlayer() {
		//console.log('stopAudioPlayer', this.state.audioRecordingStatus);

		// On Android the player is audioRecorderPlayer. On iOS we drive
		// the hidden <Video audioOnly> via state — calling stopPlayer
		// there is a no-op (and removePlayBackListener too), but we
		// always tear down both so a stale handle from a previous
		// platform/session can't keep emitting.
		try { audioRecorderPlayer.stopPlayer(); } catch (e) { /* ignore */ }
		try { audioRecorderPlayer.removePlayBackListener(); } catch (e) { /* ignore */ }

		/*
		if (Platform.OS === 'android') {
			if (this.previousAudioMode !== null) {
			    console.log('Reset aduio mode', this.previousAudioMode);
				await AudioRouteModule.setAudioMode(previousMode);
			}
		}
		*/

		this.props.stopAudioPlayerFunc();

		if ('position' in this.state.audioRecordingStatus) {
			let metadata = this.state.audioRecordingStatus.metadata;
			this.props.updateFileTransferMetadata(metadata, 'position', this.state.audioRecordingStatus.position);
			if (this.state.audioRecordingStatus.position != 100) {
                setTimeout(() => {
                    this.props.updateFileTransferMetadata(metadata, 'playing', false);
                }, 100);
			}
		}

		this.setState({
			audioRecordingStatus: {},
			// Tear down the iOS Video component too, so AVPlayer
			// releases the asset.
			iosAudio: {
				path: null,
				message: null,
				paused: true,
				duration: 0,
				hasSeeked: false,
			},
		});
		this.currentAudioDurationMs = 0;
		this.currentAudioMessage = null;
	}

	// ---------- iOS-only audio playback handlers ----------
	// These mirror the Android addPlayBackListener tick logic but are
	// driven by react-native-video's onLoad / onProgress / onEnd /
	// onError on a hidden <Video audioOnly>. They share the same
	// state surface (audioRecordingStatus, currentAudioMessage,
	// updateFileTransferMetadata 'playing'/'position') so the bubble
	// UI is platform-agnostic.

	_onIOSAudioLoad = ({ duration }) => {
		const ios = this.state.iosAudio;
		if (!ios || !ios.message) return;
		const message = ios.message;
		const durationMs = Math.floor((duration || 0) * 1000);
		this.currentAudioDurationMs = durationMs;
		// Mirror the "playing=true" metadata flip that the Android
		// listener's first tick produces.
		this.props.updateFileTransferMetadata(message.metadata, 'playing', true);
		// Seed audioRecordingStatus with mm:ss duration + saved position.
		const savedPct = message.metadata?.position || 0;
		this.setState((prev) => ({
			iosAudio: { ...prev.iosAudio, duration: duration || 0 },
			audioRecordingStatus: {
				metadata: message.metadata,
				duration: audioRecorderPlayer.mmssss(durationMs),
				position: savedPct,
			},
		}));
		// If we have a saved scrub position, ask the Video to seek.
		if (!ios.hasSeeked && savedPct > 0 && savedPct < 100 && this._iosAudioRef) {
			const seekSec = (savedPct / 100) * (duration || 0);
			try { this._iosAudioRef.seek(seekSec); } catch (e) { /* ignore */ }
		}
		// Mark hasSeeked even if savedPct is 0/100 so we don't keep
		// re-seeking on every onLoad (some Video versions re-fire it
		// after seek).
		this.setState((prev) => ({
			iosAudio: { ...prev.iosAudio, hasSeeked: true },
		}));
	};

	_onIOSAudioProgress = ({ currentTime, playableDuration }) => {
		const ios = this.state.iosAudio;
		if (!ios || !ios.message || !ios.duration) return;
		const durationMs = Math.floor(ios.duration * 1000);
		const currentMs = Math.floor((currentTime || 0) * 1000);
		const percentage = Math.floor((currentMs / durationMs) * 100);
		// Mirror the Android tick's audioRecordingStatus update so the
		// slider advances and the bubble's isCurrent stays true.
		this.setState({
			audioRecordingStatus: {
				metadata: ios.message.metadata,
				duration: audioRecorderPlayer.mmssss(durationMs),
				position: Math.max(0, Math.min(100, percentage)),
			},
		});
	};

	_onIOSAudioEnd = () => {
		const ios = this.state.iosAudio;
		if (ios && ios.message) {
			// Pin the slider at 100% on the final state update so the
			// bubble shows the audio as completed before stopAudioPlayer
			// clears state.
			this.setState({
				audioRecordingStatus: {
					metadata: ios.message.metadata,
					duration: audioRecorderPlayer.mmssss(this.currentAudioDurationMs),
					position: 100,
				},
			}, () => {
				this.stopAudioPlayer();
			});
		} else {
			this.stopAudioPlayer();
		}
	};

	_onIOSAudioError = (error) => {
		console.log('[iosAudio] onError', JSON.stringify(error));
		// Translate AVFoundation's terse codes into something users can
		// act on. The most common one we see for Sony VBR recordings is
		// AVErrorOperationNotSupportedForAsset (-11849) with a "This
		// media may be damaged" failure reason — the file is fine, iOS
		// just can't decode it. Suggest the workaround: share/save the
		// file and open it in an app that can (Files, VLC, etc.).
		const inner = (error && error.error) || {};
		const code = inner.code;
		const reason = inner.localizedFailureReason || '';
		let title, body;
		if (code === -11849 || /damaged/i.test(reason)) {
			title = "Can't play this audio on iOS";
			body = "Apple's built-in decoder doesn't support this MP3 variant (often the case for hardware recorders). The file is fine — open the message menu and share it to Files, VLC, or another audio app.";
		} else if (code === -11800 || code === -11828) {
			title = "Can't open this audio";
			body = "iOS couldn't open this audio file. It may be corrupted, or in a format Apple doesn't support. Open the message menu and share it to another app.";
		} else {
			title = "Could not play audio";
			body = inner.localizedDescription || (code != null ? 'iOS error ' + code : 'unknown error');
		}
		// Surface via a native Alert (guaranteed visible) AND as a
		// chat system message (visible after dismissing the alert,
		// useful as a record). The chat one used to be the only path
		// but was being stomped by the next componentWillReceiveProps
		// sync that rebuilt renderMessages from props, so the user
		// saw nothing.
		Alert.alert(title, body, [{ text: 'OK', style: 'default' }]);
		this.postChatSystemMessage(title + ' — ' + body);
		this.stopAudioPlayer();
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

    renderContactItem(object) {
        let item = object.item || object;

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
        this.setState({scrollToBottom: false, 
                      isLoadingEarlier: true});

        let filter = {category: this.props.messagesCategoryFilter, pinned: this.props.pinned};
        //console.log('filter', filter);
        if (!this.state.isLoadingEarlier) {
			this.props.loadEarlierMessages(filter);
        }
    }

    sendEditedMessage(message, text) {
        console.log('sendEditedMessage', message._id);
        if (!this.state.selectedContact) {
			return;
        } 

        const uri = this.state.selectedContact.uri;
        const timestamp = new Date();

        let messageId;
		let mId;

        let metadataContent;
        let metadataMessage;

		const selectedIds = this.state.selectedImages;
		
		let editedMessages = [message._id];

		if (message._id in this.state.imageGroups && selectedIds && selectedIds.length > 0) {  
			console.log('Edit label of selectedIds', selectedIds);
			editedMessages = selectedIds;
		}

        if (message.contentType === 'application/sylk-file-transfer') {
			for (let _eId of editedMessages) {
				messageId = uuid.v4();
				mId = uuid.v4();
	
				metadataContent = {messageId: _eId, 
									 metadataId: messageId, 
									 action: 'label',
									 value: text, 
									 timestamp: timestamp,
									 uri: uri
									 };
		
				metadataMessage = {_id: messageId,
								   key: messageId,
								   createdAt: timestamp,
								   metadata: metadataContent,
								   text: JSON.stringify(metadataContent),
								   };
	
				//console.log('Will send metadata for _eId', metadataMessage);
			    //this.setState({selectedImages: []});
	
				this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			}
        } else {
			messageId = uuid.v4();
			const replyMeta = this.getMetadataByActionForMessage(message._id, 'reply');
			if (replyMeta) {
				 console.log('replyMeta', replyMeta);
				 this.props.deleteMessage(replyMeta.metadataId, this.state.selectedContact.uri);
	
				 metadataContent = {messageId: messageId, 
								    metadataId: mId,
								    action: 'reply',
								    value: replyMeta.value,
								    timestamp: timestamp,
								    uri: uri
								    };
	
				 metadataMessage = {_id: mId,
								   key: mId,
								   createdAt: timestamp,        
								   metadata: metadataContent,
								   text: JSON.stringify(metadataContent),
								   };
	
				this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			}

			this.props.deleteMessage(message._id, this.state.selectedContact.uri);

			message._id = messageId;
			message.key = messageId;
			message.text = text;

			this.props.sendMessage(this.state.selectedContact.uri, message);
        }
    }
    
    onSendMessage(messages) {
		const uri = this.state.selectedContact.uri;
		if (this.state.sharingMessages.length > 0) {
			this.sharePendingFiles()
			return;
		} else {
		    console.log('onSendMessage');
		}

		const timestamp = new Date();
        messages.forEach((message) => {
            if (this.state.replyingTo) {
				const mId = uuid.v4();
				const metadataContent = {messageId: message._id, 
				                         metadataId: mId,
				                         action: 'reply',
				                         value: this.state.replyingTo._id,
				                         timestamp: timestamp,
				                         uri: uri
				                         };

				const metadataMessage = {_id: mId,
										 key: mId,
										 createdAt: timestamp,        
										 metadata: metadataContent,
										 text: JSON.stringify(metadataContent),
										};

				this.scrollToBottom();
                this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			}
			message.encrypted = this.state.selectedContact && this.state.selectedContact.publicKey ? 2 : 0;
            this.props.sendMessage(uri, message);
        });
        
        this.setState({replyingTo: null, renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    sharePendingFiles() {
        console.log('sharePendingFiles');

        if (!this.state.selectedContact) {
			return;
        }

        if (this.state.sharingMessages.length == 0) {
            console.log('No sharingMessages to send');
			return;
        }

		const uri = this.state.selectedContact.uri;
		const text = this.state.text.trim();
		const sharingMessages = this.state.sharingMessages;
		const timestamp = new Date();

		this.setState({ text: '' });
		this.textInputRef.clear?.();  // works for plain TextInput
		this.textInputRef.blur?.();   // dismiss keyboard

		this.setState({sharingAssets: [], 
					   sharingMessages: [],
					   text: '',
					   texting: false,
					   placeholder: this.default_placeholder});
					   
		console.log('sharePendingFiles with label', text || 'Photo');

		for (const message of this.state.sharingMessages) {
			if (text) {
				const transfer_id = message.metadata.transfer_id;
				const mId = uuid.v4();
				const metadataContent = {messageId: transfer_id, 
										 metadataId: mId,
										 action: 'label', 
										 value: text, 
										 timestamp: timestamp,
										 uri: uri
										 };

				const metadataMessage = {_id: mId,
										 key: mId,
										 createdAt: timestamp,
										 metadata: metadataContent,
										 text: JSON.stringify(metadataContent),
										};
	
				console.log('metadataMessage', metadataMessage);
	
				this.props.sendMessage(uri, metadataMessage, 'application/sylk-message-metadata');
			}

			this.uploadFile(message);
		}
		this.setState({scrollToBottom: true});
    }

	saveRotation(id, rotation) {

		const message = this.state.renderMessages.find(m => m._id === id);
		
		if (!message) {
			console.log('Message id not found', id);
			return;
		}
		
		const uri = message.direction == 'outgoing' ? message.metadata?.receiver?.uri : message.metadata?.sender?.uri;

		if (!uri) {
			console.log('Message uri not found', id);
			return;
		}
				
		if (message.rotation == rotation) {
		    //console.log('Rotation is the same',  message._id);
			return;
		}

		console.log('saveRotation', id, rotation);

		const mId = uuid.v4();
		const timestamp = new Date();

		const metadataContent = {messageId: message._id, 
							     metadataId: mId, 
							     action: 'rotation',
							     value: rotation,
							     timestamp: timestamp,
							     uri: uri
							     };

		const metadataMessage = {_id: mId,
								 key: mId,
								 createdAt: timestamp,
								 metadata: metadataContent,
								 text: JSON.stringify(metadataContent),
								};
								
		let mediaRotations = this.state.mediaRotations;
		mediaRotations[message._id] = rotation;
        this.setState({mediaRotations: {...mediaRotations}});
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
        
        if (!this.state.callHistoryUrl) {
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
            `${this.state.callHistoryUrl}?action=get_history&realm=${this.state.accountId.split('@')[1]}`,
            this.state.accountId.split('@')[0],
            this.state.password
        );

        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                console.log('Error getting call history from server', data.error_message, this.state.callHistoryUrl);
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

    deleteSharingAssets() {
        console.log('deleteSharingAssets');
		this.setState({gettingSharedAsset: false}); 

        for (const asset of this.state.sharingAssets) {
			const fileUri = asset.uri.replace('file://', ''); // remove scheme
			RNFS.unlink(fileUri)
			  .then(() => console.log('Temporary file deleted', fileUri))
			  .catch(err => console.log('Error deleting temporary file', err));
		}
		
		let renderMessages = this.state.messages[this.state.selectedContact.uri];

		this.setState(prevState => ({
		  placeholder: this.default_placeholder,
		  sharingMessages: [],
		  sharingAssets: [],
		  renderMessages: {...renderMessages},
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

	  if (this.state.orderBy === 'size') {
		  return null;
	  }

	  // Load duration if not already loaded
	  if (currentMessage.audio && !audioDurations[currentMessage._id]) {
		this.getAudioDuration(currentMessage.audio, currentMessage._id);
	  }

	  // Format raw seconds as "1h 6m 40s" / "23m 14s" / "45s" so a 1394s clip
	  // reads as "Recording of 23m 14s" instead of "Recording of 1394s".
	  const formatAudioDuration = (totalSeconds) => {
		const s = Math.max(0, Math.floor(totalSeconds || 0));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		const parts = [];
		if (h > 0) parts.push(`${h}h`);
		if (h > 0 || m > 0) parts.push(`${m}m`);
		parts.push(`${sec}s`);
		return parts.join(' ');
	  };
	  const rawDuration = audioDurations[currentMessage._id];
	  const durationLabel = rawDuration
		? `Recording of ${formatAudioDuration(rawDuration)}`
		: 'Recording';

	  const isIncoming = currentMessage.direction === 'incoming';
	  const labelPadding =  isIncoming ? {paddingLeft: 10} : {paddingLeft: 0};

  	  const status = this.state.audioRecordingStatus;
      let isPlaying = currentMessage.playing;
	  const isCurrent = status?.metadata?.transfer_id === currentMessage.metadata.transfer_id;

	  let position = currentMessage.position || 0;
	  // Reflect live playback position on the bubble that is currently playing.
	  if (isCurrent && typeof status?.position === 'number') {
		  position = status.position;
	  }

	  if (!isCurrent || currentMessage.position == 100) {
		  isPlaying = false;
	  }

	  // Compute a slider width that fits within the audio bubble while
	  // leaving room for the play/pause button and the same side margins
	  // GiftedChat applies to other bubbles (avatar gutter, bubble padding,
	  // play button ~48, slider side gap, end margin).
	  const windowWidth = Dimensions.get('window').width;
	  const sliderWidth = Math.max(160, Math.min(windowWidth - 200, 520));

	  //console.log('current audio message', currentMessage.metadata);

	  const playButton = (
		<TouchableHighlight
		  // Claim the responder for the entire play-button area (including
		  // padding around the IconButton). Without an onPress on this
		  // wrapper, taps that land in the padding fall through to the
		  // parent Bubble's onPress and open the contextual menu.
		  onPress={() =>
			isPlaying
			  ? this.stopAudioPlayer()
			  : this.startAudioPlayer(currentMessage)
		  }
		  underlayColor="transparent"
		  style={[
			styles.roundshape,
			isIncoming ? {marginLeft: 10} : {marginRight: 10},
			{marginTop: 0},
		  ]}>
		  <IconButton
			size={28}
			onPress={() =>
			  isPlaying
				? this.stopAudioPlayer()
				: this.startAudioPlayer(currentMessage)
			}
			style={styles.playAudioButton}
			icon={isPlaying ? 'pause' : 'play'}
		  />
		</TouchableHighlight>
	  );

	  return (
		<View
		  style={[
			styles.audioContainer,
			{
			  flexDirection: 'row',
			  alignItems: 'center',
			  justifyContent: isIncoming ? 'flex-start' : 'flex-end',
			  paddingVertical: 6,
			},
		  ]}
		>
		  {isIncoming && playButton}

		  <View style={{ flexDirection: 'column', alignItems: isIncoming ? 'flex-start' : 'flex-end', justifyContent: 'center', flex: 1, paddingLeft: isIncoming ? 18 : 8, paddingRight: isIncoming ? 8 : 18 }}>
			<Text
			  style={[
				styles.audioLabel,
				{ marginBottom: 2, marginTop: 0, alignSelf: isIncoming ? 'flex-start' : 'flex-end' },
				labelPadding,
			  ]}
			  numberOfLines={1}
			>
			  {durationLabel}
			</Text>
			<AudioProgressSlider
			  progress={position}
			  width={sliderWidth}
			  height={4}
			  knobWidth={6}
			  knobHeight={20}
			  color={"orange"}
			  unfilledColor="rgba(255,255,255,0.4)"
			  knobColor={"orange"}
			  onSeekStart={() => this.pauseAudioForScrub(currentMessage)}
			  onSeek={(pct) => this.seekAudioMessage(currentMessage, pct)}
			/>
		  </View>

		  {!isIncoming && playButton}
		</View>
	  );
	};

	thumbnailSelectionChanged(newSelected, item) {
	  console.log('thumbnailSelectionChanged');
	  this.setState((prevState) => {
		const exists = prevState.selectedImages.includes(item.id);
	
		let updated;
		if (exists) {
		  updated = prevState.selectedImages.filter(id => id !== item.id);
		} else {
		  updated = [...prevState.selectedImages, item.id];
		}
	
		return { selectedImages: updated };
	  });
	}

	searchThumbnailSelectionChanged(newSelected, item) {
	  console.log('searchThumbnailSelectionChanged');
	  this.setState((prevState) => {
		const exists = prevState.selectedImagesSearch.includes(item.id);
	
		let updated;
		if (exists) {
		  updated = prevState.selectedImagesSearch.filter(id => id !== item.id);
		} else {
		  updated = [...prevState.selectedImagesSearch, item.id];
		}
	
		return { selectedImagesSearch: updated };
	  });
	}

	onRotateImage(rotations) {
	  console.log('onRotateImage', rotations);
	  Object.keys(rotations).forEach(id => {	
		this.saveRotation(id, rotations[id]);
	  });
	}

	renderMessageImage = ({ currentMessage, orderBy }) => {
	  if (this.state.orderBy === 'size') {
		  return null;
	  }

	  if (!currentMessage?.image) return null;
	
	  const id = currentMessage._id;
	  //console.log('renderMessageImage', id);
	  const uri = currentMessage.image;
	
	  const isVisible = this.state.visibleMessageIds.includes(id);
	  const wasRendered = this.state.renderedMessageIds.has(id);
	  let isLoading = this.state.imageLoadingState[id];

	  isLoading = false;
	  
	  let showGrid = false;

	  // Skip offscreen images
	  if (false && !isVisible && !wasRendered) {
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
	
	  let rotation = currentMessage.metadata.rotation || 0;
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
	  
	let subsequentMessages = [];
	let imageGroup;
	if (id in this.state.imageGroups) {
		imageGroup = this.state.groupOfImage[id];
		const imageIds = this.state.imageGroups[imageGroup];
		
		subsequentMessages = this.state.renderMessages.filter(msg =>
		  imageIds.includes(msg._id)
		);
	}
	
	// add next image if is an image
	let numColumns = 1;

	if (subsequentMessages.length > 1) {
	    if (subsequentMessages.length < 5) {
			numColumns = 2;
	    } else {
			numColumns = 3;
	    } 
	}
	
	if (id in this.state.thumbnailGridSize) {
		numColumns = this.state.thumbnailGridSize[id];
	}

	const gridImages = subsequentMessages
		  .filter(m => !!m.image)   // only messages that contain images
		  .map(msg => ({
			id: String(msg._id),
			uri: msg.image,
			size: msg.metadata.filesize,
			timestamp: msg.metadata.timestamp,
			rotation: msg.metadata.rotation || this.state.mediaRotations[msg._id] || 0,
			title: msg.text || '',
		  }));
		  
	showGrid = subsequentMessages.length > 1;

	if (showGrid) {
		// Upload preview phase: the bubbles carry metadata.preview === true
		// while the user is staging images to send. Selection checkmarks
		// are meaningless there (you can't multi-select pre-send), so the
		// checkbox overlay is suppressed. After send, selection comes back
		// for the regular grouped-image affordances.
		const isPreview = !!currentMessage.metadata?.preview;
		return (
		  <ThumbnailGrid
			images={gridImages.reverse()}
			isLandscape={this.state.isLandscape}
			onRotateImage={this.onRotateImage}
			numColumns={numColumns}
			showTimestamp={false}
			selectMode={!isPreview}
			onSelectionChange = {this.thumbnailSelectionChanged}
			onLongPress={(item) => console.log('long', item)}
			renderThumb={({item, index, size}) => (
			  <View style={{flex:1}}>
				<Image source={{uri:item.uri}} style={{width:size, height:size, borderRadius:6}} />
			  </View>
			)}
		  />
		);
	}

	return (
		<TouchableOpacity
		  activeOpacity={0.8}
		  onPress={() => this.onImagePress(currentMessage)}
		  style={{
			width: '100%',
			justifyContent: 'center',
			alignItems: 'center',
			marginBottom: -5
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
				opacity: isLoading ? 0.9 : 1,
				transform: [{ rotate: `${rotation}deg` }]
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
	    //console.log('uploadFile msg', msg);
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

    // Input-toolbar replacement used when the active account has no local
    // private key. Sending requires a key, so the composer is swapped for
    // this read-only banner pointing users to the menu path where they can
    // restore or generate one. Styled in the same warning red as the
    // ReadyBox banner so the two read as one signal.
    noKeyInputToolbar () {
        return (
            <View
                accessibilityRole="alert"
                style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: '#c62828',
                    borderTopWidth: 1,
                    borderTopColor: '#8e0000',
                }}
            >
                <Text style={{color: 'white', fontWeight: 'bold', fontSize: 13, marginBottom: 2}}>
                    Cannot send messages
                </Text>
                <Text style={{color: 'white', fontSize: 12}}>
                    No private key on this device. Go to Menu {'>'} My private key to restore or generate one.
                </Text>
            </View>
        );
    }

    onMessagePress(context, message) {
        if (message.metadata && message.metadata.preview) {
			return;
        }

        //console.log('onMessagePress');

        // Body taps now perform the natural action for the bubble type
        // (download / decrypt / open / play). The contextual action sheet
        // is reachable only through the bubble's kebab IconButton — the
        // wide-area "tap anywhere -> menu" behavior was confusing because
        // it competed with the body-tap default action and made it easy
        // to open the menu by accident while trying to start playback or
        // open a file.

        if (message.metadata && message.metadata.filename) {
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

            RNFS.exists(file_transfer.local_url).then((exists) => {
                if (exists) {
                    if (file_transfer.local_url.endsWith('.asc')) {
                        if (file_transfer.error) {
                            // Decryption failed previously — body tap retries
                            // the decrypt rather than opening the menu (the
                            // kebab can be used to delete / inspect instead).
                            this.props.decryptFunc(message.metadata);
                        } else {
                            this.props.decryptFunc(message.metadata);
                        }
                    } else {
                        // Decrypted file ready: open it (audio plays via
                        // startAudioPlayer, others via FileViewer).
                        this.openFile(message);
                    }
                } else {
                    if (file_transfer.path) {
                        // Local upload still in flight — body tap is a
                        // no-op; the kebab gives access to cancel/delete.
                        return;
                    } else {
                        this.props.downloadFile(message.metadata, true);
                    }
                }
            });
        }
        // Plain-text messages: body tap does nothing. Long-press still
        // opens the contextual menu through GiftedChat's onLongPress, and
        // the kebab is the explicit one-touch path for media bubbles.
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
            this.startAudioPlayer(message);
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
    
    get hideItem() {
		return this.state.orderBy === 'size';
    }

    onLongMessagePress(context, currentMessage) {
		Keyboard.dismiss();
		this.setState({actionSheetDisplayed: true});

        if (!currentMessage.metadata) {
            currentMessage.metadata = {};
        }

        // Live-location messages are a different beast from text/file
        // messages: they carry no user-authored body, their content updates
        // in place (each tick rewrites the bubble), and they expire on a
        // schedule. Reply/Pin/Forward/Share/Email all assume a static,
        // shareable payload, which a tick-by-tick location stream doesn't
        // have — forwarding a single tick would mislead the recipient,
        // sharing via Email would leak a URL that stops updating, etc.
        // Gate those actions so only the universally-safe ones (Copy,
        // Delete, Info, …) show up on the sheet.
        const isLiveLocation =
            currentMessage.contentType === 'application/sylk-live-location';

        // An incoming "Until we meet" meeting-request bubble: an incoming
        // live-location bubble whose metadata carries meeting_request:true.
        // We show an "Accept meeting request" option only if the request
        // hasn't already been accepted on this device and hasn't expired —
        // the predicate is supplied by app.js as a prop.
        const mdForMeeting = currentMessage.metadata || {};
        const meetingReqId =
            (isLiveLocation
                && currentMessage.direction === 'incoming'
                && mdForMeeting.meeting_request === true)
            ? (mdForMeeting.messageId || currentMessage._id)
            : null;
        const meetingExpiresAt = meetingReqId
            ? (typeof mdForMeeting.expires === 'number'
                ? mdForMeeting.expires
                : (mdForMeeting.expires ? Date.parse(mdForMeeting.expires) : null))
            : null;
        const meetingFromUri = meetingReqId
            ? (mdForMeeting.author
                || (currentMessage.user && currentMessage.user._id)
                || this.state.targetUri)
            : null;
        const canAcceptMeeting = !!meetingReqId
            && typeof this.props.isMeetingRequestAcceptable === 'function'
            && this.props.isMeetingRequestAcceptable(meetingReqId, meetingExpiresAt);
        if (isLiveLocation) {
            console.log('[meeting] kebab: location bubble long-press',
                'isIncoming=', currentMessage.direction === 'incoming',
                'meeting_request=', mdForMeeting.meeting_request === true,
                'meetingReqId=', meetingReqId,
                'meetingExpiresAt=', meetingExpiresAt,
                'hasPredicate=', typeof this.props.isMeetingRequestAcceptable === 'function',
                'canAcceptMeeting=', canAcceptMeeting);
        }

        let icons = [];
        //console.log('---- currentMessage', currentMessage);
        if (currentMessage && currentMessage.text) {

            let options = []

            // Surface this at the top of the sheet: if the user dismissed
            // the modal, tapping the bubble's kebab is now their only way
            // back into the acceptance flow.
            if (canAcceptMeeting) {
                options.push('Accept meeting request');
                icons.push(<Icon name="handshake" size={20} />);
            }

            //if (currentMessage.direction == 'incoming' && !this.hideItem) {
            if (!this.hideItem && !isLiveLocation) {
				options.push('Reply');
				icons.push(<Icon name="arrow-left" size={20} />);
			}

			// Pause / Resume — only meaningful for OUR OWN live share
			// (we can't pause / resume a peer's stream) and only when
			// the share hasn't expired and isn't a one-shot. The
			// active/paused/stopped distinction comes from
			// getLocationShareState (consults navBar.locationTimers
			// in app.js's bridge):
			//   • active  → show "Pause"
			//   • paused  → show "Resume"
			//   • stopped → show "Resume" too (the "deleted by mistake"
			//               case the user asked for — bridge falls
			//               back to startLocationSharing with
			//               resumeOriginMetadataId set so the existing
			//               bubble keeps updating).
			const _liveMd = mdForMeeting; // already pulled above
			const _isOurShare = currentMessage.direction === 'outgoing';
			const _isOneShot = _liveMd.one_shot === true;
			let _expiresMs = null;
			if (_liveMd.expires) {
				const v = typeof _liveMd.expires === 'number'
					? _liveMd.expires
					: Date.parse(_liveMd.expires);
				if (Number.isFinite(v)) _expiresMs = v;
			}
			const _isExpired = _expiresMs != null && _expiresMs <= Date.now();
			const _shareOriginId = _liveMd.messageId || currentMessage._id;
			const _shareUri = this.state.targetUri;
			let _shareState = 'stopped';
			if (typeof this.props.getLocationShareState === 'function') {
				try {
					_shareState = this.props.getLocationShareState(_shareUri, _shareOriginId);
				} catch (e) { /* default to 'stopped' */ }
			}
			if (isLiveLocation
					&& _isOurShare
					&& !_isOneShot
					&& !_isExpired) {
				console.log('[location] kebab: pause/resume eligible',
					'uri=', _shareUri,
					'bubble=', currentMessage._id,
					'shareOriginId=', _shareOriginId,
					'shareState=', _shareState,
					'expiresMs=', _expiresMs,
					'remainingMs=', _expiresMs != null ? _expiresMs - Date.now() : '(no expires)');
				if (_shareState === 'active') {
					options.push('Pause');
					icons.push(<Icon name="pause" size={20} />);
				} else {
					// 'paused' OR 'stopped' — Resume covers both.
					options.push('Resume');
					icons.push(<Icon name="play" size={20} />);
				}
			} else if (isLiveLocation && _isOurShare) {
				console.log('[location] kebab: pause/resume hidden',
					'uri=', _shareUri,
					'bubble=', currentMessage._id,
					'isOneShot=', _isOneShot,
					'isExpired=', _isExpired,
					'expiresMs=', _expiresMs);
			}

			// Edit is meaningless for live-location bubbles — their body is
			// auto-generated (a tick timestamp), not user-authored text.
			if (this.isMessageEditable(currentMessage) && !isLiveLocation) {
				options.push('Edit');
				icons.push(<Icon name="file-document-edit" size={20} />);
			}
			
			if (currentMessage.image) {
			    if (!(currentMessage._id in this.state.imageGroups)) {  
                    options.push('Preview')
                    icons.push(<Icon name="image" size={20} />);
                }
			}

            if (currentMessage.metadata && !currentMessage.metadata.error) {
                if (currentMessage.metadata && currentMessage.metadata.local_url) {
					if (!(currentMessage._id in this.state.imageGroups)) {  
						options.push('Open')
						icons.push(<Icon name="folder-open" size={20} />);
                    }
                //
                } else {
                    options.push('Copy');
                    icons.push(<Icon name="content-copy" size={20} />);
                }
            }

			if (currentMessage.image) {
				if (!(currentMessage._id in this.state.imageGroups)) {
					options.push('Delete');
					icons.push(<Icon name="delete" size={20} />);
				} else {
					// Group leader: Delete is always reachable. With a
					// thumbnail selection it targets just the selected
					// images; without one it targets every image in the
					// group. The label communicates which.
					const groupSize = (this.state.imageGroups[currentMessage._id] || []).length;
					const selCount = this.state.selectedImages.length;
					if (selCount > 0) {
						options.push(`Delete selected (${selCount})`);
					} else {
						options.push(`Delete all (${groupSize} images)`);
					}
					icons.push(<Icon name="delete" size={20} />);
				}
			} else {
				options.push('Delete');
				icons.push(<Icon name="delete" size={20} />);
			}

            let showResend = currentMessage.metadata && currentMessage.metadata.error;
            showResend = true;

            if (this.state.targetUri.indexOf('@videoconference') === -1) {
                if (currentMessage.direction === 'outgoing') {
                    if (showResend && !this.hideItem && !isLiveLocation) {
                        options.push('Resend')
                        icons.push(<Icon name="send" size={20} />);
                    }
                }
            }

            if (!isLiveLocation) {
                if (currentMessage.pinned) {
                    options.push('Unpin');
                    icons.push(<Icon name="pin-off" size={20} />);
                } else {
                    if (!currentMessage.metadata.error) {
                        options.push('Pin');
                        icons.push(<Icon name="pin" size={20} />);
                    }
                }
            }

            if (!currentMessage.metadata.error && !this.hideItem && !isLiveLocation) {
				if (currentMessage.image) {
					if (!(currentMessage._id in this.state.imageGroups)) {
						options.push('Forward');
						icons.push(<Icon name="arrow-right" size={20} />);
						options.push('Share');
						icons.push(<Icon name="share" size={20} />);

					} else {
						// Group leader: same fallback as Delete — with a
						// selection, target just the selected; without
						// one, target the whole group. Labels communicate
						// the count so the user knows what they're about
						// to send / share.
						const groupSize = (this.state.imageGroups[currentMessage._id] || []).length;
						const selCount = this.state.selectedImages.length;
						const fwdLabel = selCount > 0
							? `Forward selected (${selCount})`
							: `Forward all (${groupSize} images)`;
						const shareLabel = selCount > 0
							? `Share selected (${selCount})`
							: `Share all (${groupSize} images)`;
						options.push(fwdLabel);
						icons.push(<Icon name="arrow-right" size={20} />);
						options.push(shareLabel);
						icons.push(<Icon name="share" size={20} />);
					}
				} else {
					options.push('Forward');
					icons.push(<Icon name="arrow-right" size={20} />);
					options.push('Share');
					icons.push(<Icon name="share" size={20} />);
				}
            }
            if  (currentMessage && currentMessage.metadata && !this.hideItem && !isLiveLocation) {
				//console.log('mesage metadata:', currentMessage.metadata);
				if (currentMessage.metadata.filename) {

					if (!currentMessage.metadata.local_url) {
						options.push('Download');
						icons.push(<Icon name="cloud-download" size={20} />);
					} else {
						//options.push('Download again');
						//icons.push(<Icon name="cloud-download" size={20} />);

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
                if (action === 'Cancel') {
                    this.setState({actionSheetDisplayed: false});
                } else if (action === 'Accept meeting request') {
                    // Re-enter the acceptance flow from outside the modal.
                    // app.js owns the guards (already-accepted / expired /
                    // NavigationBar-not-ready) so we just forward the args.
                    console.log('[meeting] kebab: Accept meeting request tapped',
                        'fromUri=', meetingFromUri,
                        'requestId=', meetingReqId,
                        'expiresAt=', meetingExpiresAt,
                        'hasHandler=', typeof this.props.acceptMeetingRequest === 'function');
                    this.setState({actionSheetDisplayed: false});
                    if (typeof this.props.acceptMeetingRequest === 'function') {
                        this.props.acceptMeetingRequest({
                            fromUri: meetingFromUri,
                            requestId: meetingReqId,
                            expiresAt: meetingExpiresAt,
                        });
                    } else {
                        console.warn('[meeting] kebab: acceptMeetingRequest prop missing!');
                    }
                } else if (action === 'Copy') {
                    // Location bubbles carry a stringified JSON metadata blob
                    // in `text` (action/messageId/value/expires/…). Copying
                    // that to the clipboard is useless — what the user wants
                    // is the actual coordinates, pasteable into Maps, a
                    // message, or a note. Fall through to the raw text for
                    // every other bubble type.
                    const meta = currentMessage && currentMessage.metadata;
                    const val = meta && meta.value;
                    if (isLiveLocation
                        && val
                        && typeof val.latitude === 'number'
                        && typeof val.longitude === 'number') {
                        Clipboard.setString(`${val.latitude}, ${val.longitude}`);
                    } else {
                        Clipboard.setString(currentMessage.text);
                    }
                } else if (action === 'Delete'
                           || action.startsWith('Delete selected')
                           || action.startsWith('Delete all')) {
                    let messagesToDelete = [currentMessage._id];
					if (currentMessage._id in this.state.imageGroups) {
						// "Delete selected (N)" → selectedImages
						// "Delete all (N images)" → every member of the group
						messagesToDelete = this.state.selectedImages.length > 0
							? this.state.selectedImages
							: (this.state.imageGroups[currentMessage._id] || []);
					}
                    // Only outgoing messages can be deleted for the remote party.
                    // Incoming messages live on the sender's device and we have no
                    // authority to remove them — so hide the "Also delete for X"
                    // toggle unless every selected message is outgoing.
                    const allMsgs = this.state.renderMessages || [];
                    const msgsById = new Map(allMsgs.map(m => [m._id, m]));
                    const canDeleteRemote = messagesToDelete.every((id) => {
                        const m = msgsById.get(id);
                        return m && m.direction === 'outgoing';
                    });
                    this.setState({
                        messagesToDelete: messagesToDelete,
                        canDeleteRemote: canDeleteRemote,
                        showDeleteMessageModal: true,
                    });
                } else if (action === 'Pause') {
                    if (typeof this.props.pauseLocationShare === 'function') {
                        const md = currentMessage.metadata || {};
                        const originId = md.messageId || currentMessage._id;
                        this.props.pauseLocationShare(this.state.targetUri, originId);
                    }
                } else if (action === 'Resume') {
                    if (typeof this.props.resumeLocationShare === 'function') {
                        const md = currentMessage.metadata || {};
                        const originId = md.messageId || currentMessage._id;
                        // Hand the bubble's metadata to app.js so the
                        // bridge can fall back to startLocationSharing
                        // with the right durationMs / kind when the
                        // share has been fully stopped (e.g. deleted
                        // by mistake) rather than just paused.
                        this.props.resumeLocationShare(this.state.targetUri, originId, md);
                    }
                } else if (action === 'Pin') {
                    this.props.pinMessage(currentMessage._id);
                } else if (action === 'Unpin') {
                    this.props.unpinMessage(currentMessage._id);
                } else if (action === 'Info') {
                    this.setState({message: currentMessage, showMessageModal: true});
                } else if (action === 'Edit') {
                    this.setState({message: currentMessage, showEditMessageModal: true});
                } else if (action === 'Preview') {
                    this.onImagePress(currentMessage);
                } else if (action.startsWith('Share')) {
                    this.handleShare(currentMessage);
                } else if (action.startsWith('Email')) {
                    this.handleShare(currentMessage, true);
                } else if (action.startsWith('Forward')) {
                    let messagesToForward = [currentMessage];
					if (currentMessage._id in this.state.imageGroups) {
						// "Forward selected (N)" → only selected.
						// "Forward all (N images)" → every member.
						const targetIds = this.state.selectedImages.length > 0
							? this.state.selectedImages
							: (this.state.imageGroups[currentMessage._id] || []);
						messagesToForward = this.state.renderMessages.filter(
						  msg => targetIds.includes(msg._id)
						);
					}
                    this.props.forwardMessagesFunc(messagesToForward, this.state.targetUri);
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
        if (message.failed) {
            return false;
        }
        
        if (this.hideItem) {
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
			this.props.uploadFile(message.metadata, true);
		} else {
			this.props.downloadFile(message.metadata, true, true);
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

	getMetadataByActionForMessage(messageId, action) {
		const mm = this.state.messagesMetadata;
		if (!mm) return null;
	
		const arr = mm[messageId];
		if (!Array.isArray(arr)) return null;
	
		return arr.find(e => e.action === action) || null;
	}

	getMetadataByAction(action, field = 'value') {
		const mm = this.state.messagesMetadata;
		if (!mm) return {};
	
		const result = {};
	
		Object.entries(mm).forEach(([msgId, arr]) => {
			if (!Array.isArray(arr)) return;
	
			// Find the last entry matching the action
			const last = [...arr].reverse().find(e => e.action === action);
			if (last && last[field] !== undefined) {
				result[msgId] = last[field];
			}
		});
	
		return result;
	}

	get replyMessages() {
		return this.getMetadataByAction('reply');
	}
	
	get mediaLabels() {
		return this.getMetadataByAction('label');
	}

	get mediaRotations() {
		return this.getMetadataByAction('rotation');
	}

	// Latest live-location metadata keyed by the origin tick's _id. Unlike
	// the other getters (which return a single value per message), this one
	// returns the full metadataContent object because the LocationBubble
	// needs `value`, `expires`, `timestamp` and `author` together.
	get locationData() {
		const mm = this.state.messagesMetadata;
		if (!mm) return {};
		const result = {};
		Object.entries(mm).forEach(([msgId, arr]) => {
			if (!Array.isArray(arr)) return;
			// Pick the newest 'location' entry for this message that
			// ALSO carries usable coordinates. Legacy data can have a
			// null-coord origin row in the array; without the coord
			// filter the previous "first match in reversed array"
			// pattern returned that origin (null lat/lng), hiding the
			// map even when valid trail entries existed. We score by
			// metadataContent.timestamp (preferring inner value.timestamp
			// when present, since that's the GPS-fix time) and keep the
			// best.
			let best = null;
			let bestTs = -Infinity;
			for (const e of arr) {
				if (!e || e.action !== 'location') continue;
				const v = e.value;
				if (!v
						|| typeof v.latitude !== 'number'
						|| typeof v.longitude !== 'number') {
					continue;
				}
				const tsRaw = (v.timestamp != null) ? v.timestamp : e.timestamp;
				const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
				if (ts > bestTs) {
					best = e;
					bestTs = ts;
				}
			}
			if (best) result[msgId] = best;
		});
		return result;
	}

	componentDidUpdate(prevProps, prevState) {
      if (prevState.renderMessages !== this.state.renderMessages) {
	      //console.log('renderMessages did change', this.state.renderMessages.length);
      }

      if (prevState.actionSheetDisplayed !== this.state.actionSheetDisplayed) {
	      console.log('actionSheetDisplayed did change', this.state.actionSheetDisplayed);
      }

      if (prevState.totalMessageExceeded !== this.state.totalMessageExceeded) {
	      console.log('totalMessageExceeded did change', this.state.totalMessageExceeded);
      }

      if (prevState.isLoadingEarlier !== this.state.isLoadingEarlier) {
	      console.log('----- isLoadingEarlier did change', this.state.isLoadingEarlier);
      }

      if (prevState.messages !== this.state.messages) {
		  const length = this.state.messages?.[this.state.selectedContact?.uri]?.length ?? 0;
		  //console.log('messages did change', length);
      }

      if (prevState.thumbnailGridSize !== this.state.thumbnailGridSize) {
		console.log('thumbnailGridSize did change', this.state.thumbnailGridSize);
		
		this.setState((prev) => {
		  const gridMap = prev.thumbnailGridSize || {};
	
		  const updatedMessages = prev.renderMessages.map((msg) => {
			const newGridSize = gridMap[msg._id];
	
			// Only update if changed (prevents useless re-renders)
			if (msg.gridSize === newGridSize) {
			  return msg;
			}
	
			return {
			  ...msg,
			  gridSize: newGridSize,
			};
		  });
	
		  return {
			renderMessages: updatedMessages,
		  };
		});
      }
	               
	               
      if (prevState.appState !== this.state.appState) {
          if (this.state.appState !== 'active') {
			  this.exitFullScreen();
		  }
      }
	  
      if (prevState.messagesCategoryFilter !== this.state.messagesCategoryFilter) {
		  this.setState({selectedImages: []});
	      console.log('messagesCategoryFilter changed', this.state.messagesCategoryFilter);
      }

      if (prevState.sortOrder !== this.state.sortOrder) {
	      console.log('sortOrder changed', this.state.sortOrder);
      }
	               
      if (prevState.selectedImages !== this.state.selectedImages) {
	      console.log('selectedImages changed', this.state.selectedImages);
      }

      if (prevState.selectedImagesSearch !== this.state.selectedImagesSearch) {
	      console.log('selectedImagesSearch changed', this.state.selectedImagesSearch);
      }

      if (prevState.isAudioRecording !== this.state.isAudioRecording) {
          if (this.state.isAudioRecording) {
			  this.setState({placeholder: 'Recording audio...'});
		  } else if (this.state.recordingFile) {
			  this.setState({placeholder: 'Delete or send...'});
		  } else {
			  this.setState({placeholder: this.default_placeholder});
		  }
	  }

      if (prevState.recordingFile !== this.state.recordingFile) {
          if (this.state.recordingFile) {
			  this.setState({placeholder: 'Delete or send...'});
		  } else {
			  this.setState({placeholder: this.default_placeholder});
		  }
	  }

      if (prevState.scrollToBottom !== this.state.scrollToBottom) {
	        //console.log('Scroll to bottom changed', this.state.scrollToBottom);
      }
            
	  if (prevState.orderBy !== this.state.orderBy) {
	        console.log('orderBy changed', this.state.orderBy);
      }


      if (prevState.playRecording !== this.state.playRecording) {
			//console.log('Parent playRecording', prevState.playRecording, this.state.playRecording);
	        if (this.state.playRecording === false) {
				this.stopAudioPlayer();
			}
      }

	  if (prevState.transferProgress !== this.state.transferProgress) {
		//console.log('transferProgress changed', this.state.transferProgress);
	
	    /*
		// Iterate over updated transfers
		Object.keys(this.state.transferProgress).forEach(id => {
		  const { progress, stage } = this.state.transferProgress[id];
	
		  const exists = this.state.renderMessages.some(m => m._id === id);
	
		  console.log(
			'updateTransferProgress →',
			id,
			progress,
			stage,
			'existsInMessages:', exists
		  );
		});
		*/
	  }

		if (prevState.mediaRotations !== this.state.mediaRotations) {
			//console.log('new mediaRotations', this.state.mediaRotations);
		}
		
		if (prevState.mediaLabels !== this.state.mediaLabels) {
			//console.log('new mediaLabels', this.state.mediaLabels);
		}

		if (prevState.replyMessages !== this.state.replyMessages) {
			//console.log('new replyMessages', JSON.stringify(this.state.replyMessages, null, 2));
		}

		if (prevState.renderMessages !== this.state.renderMessages) {
			//console.log("==== renderMessages changed ====", this.state.renderMessages.length);
			this.setState({isLoadingEarlier: false});

		    /*
			console.log('mediaRotations', this.state.mediaRotations);
			console.log('mediaLabels', this.state.mediaLabels);
			console.log('replyMessages', this.state.replyMessages);
			*/
			
			this.getImageGroups();
		}

		if (prevState.audioRecordingStatus !== this.state.audioRecordingStatus) {
			//console.log("old", prevState.audioRecordingStatus);
			//console.log("new", this.state.audioRecordingStatus);
			if (this.state.audioRecordingStatus.position) {
				let metadata = this.state.audioRecordingStatus.metadata;
				this.props.updateFileTransferMetadata(metadata, 'position', this.state.audioRecordingStatus.position);
			}
		}
		
		if (prevState.messagesMetadata !== this.state.messagesMetadata) {
			/*
			console.log("==== CL messagesMetadata changed ==== ");
			console.log("old", JSON.stringify(prevState.messagesMetadata, null, 2));
			console.log("new", JSON.stringify(this.state.messagesMetadata, null, 2));
			*/

			const mediaLabels = this.mediaLabels;
			//console.log('CL mediaLabels:', mediaLabels);
			const mediaRotations = this.mediaRotations;
			const replyMessages = this.replyMessages;
			const locationData = this.locationData;

			const updatedMessages = this.state.renderMessages.map(msg => {
				const id = msg.messageId || msg._id;

				const newLabel = mediaLabels[id];
				const newRotation = mediaRotations[id];
				const newReplyId = replyMessages[id];

				// Live location: when this message is a rendered location
				// bubble and a newer tick landed, bump `text` (a field
				// ChatBubble's memo comparator watches) and refresh the
				// embedded metadata so the LocationBubble renders the
				// new coords. We also bump `createdAt` to the new tick's
				// timestamp so the bubble's footer time (HH:MM under the
				// bubble) reflects the latest update — users expect the
				// shown time to read "now-ish", not the origin time
				// from when the share started. `_id` stays anchored to
				// the origin so subsequent merges and metadata lookups
				// keep finding the same row.
				const newLocation = msg.contentType === 'application/sylk-live-location'
					? locationData?.[msg._id]
					: null;

				if (newLocation) {
					// Include peerCoords in the tickMarker signature. Without
					// this, _propagatePeerCoordsForSession stamps peerCoords
					// onto an existing location entry WITHOUT changing its
					// timestamp — so tickMarker stays identical, `msg.text`
					// never bumps, and GiftedChat's ChatBubble memo comparator
					// (which watches `text`) short-circuits the re-render.
					// Result: peerCoords land in state but the second pin
					// never shows on either side. Appending a short peer
					// signature forces `text` to change whenever the peer
					// pin becomes available (or moves), which cascades a
					// proper re-render into LocationBubble.
					const basePart = newLocation.timestamp
						? String(new Date(newLocation.timestamp).getTime())
						: String(Date.now());
					const pc = newLocation.peerCoords;
					const peerPart = pc
							&& typeof pc.latitude === 'number'
							&& typeof pc.longitude === 'number'
						? '|' + pc.latitude.toFixed(4) + ',' + pc.longitude.toFixed(4)
						: '';
					const tickMarker = basePart + peerPart;
					// Preserve origin-only fields when overlaying an
					// update tick's content. `meeting_request: true`
					// (and the destination chosen for the meet-up)
					// only appear on the ORIGIN tick — update ticks
					// don't restamp them. Without this carry-forward
					// the kebab's "Accept meeting request" option
					// disappears the moment the first update tick
					// lands on the receiver (the gate reads
					// currentMessage.metadata.meeting_request), even
					// though the request is still perfectly acceptable.
					const origin = msg.metadata || {};
					const stickyFromOrigin = {};
					if (origin.meeting_request === true) {
						stickyFromOrigin.meeting_request = true;
					}
					if (origin.destination
							&& !newLocation.destination) {
						stickyFromOrigin.destination = origin.destination;
					}
					const mergedMetadata = Object.keys(stickyFromOrigin).length > 0
						? {...newLocation, ...stickyFromOrigin}
						: newLocation;
					const textChanged = tickMarker !== msg.text;
					const metaChanged = mergedMetadata !== msg.metadata;
					// Pull a Date out of the new tick — prefer the tick's
					// own value.timestamp (when the GPS fix was taken),
					// fall back to the metadataContent timestamp, then
					// to "now" if neither is present.
					const tickInner = newLocation && newLocation.value
						? newLocation.value.timestamp
						: null;
					const tickOuter = newLocation && newLocation.timestamp
						? newLocation.timestamp : null;
					const newCreatedAt = tickInner
						? new Date(tickInner)
						: (tickOuter ? new Date(tickOuter) : new Date());
					const _existingCreatedMs = msg.createdAt
						? new Date(msg.createdAt).getTime()
						: 0;
					const _newCreatedMs = newCreatedAt.getTime();
					const createdAtChanged = _newCreatedMs > _existingCreatedMs;
					if (textChanged || metaChanged || createdAtChanged) {
						return {
							...msg,
							text: tickMarker,
							metadata: mergedMetadata,
							createdAt: createdAtChanged ? newCreatedAt : msg.createdAt,
						};
					}
				}

				// Only update if something actually changed
				if (
					newLabel ||
					newRotation !== undefined ||
					newReplyId !== undefined
				) {

					return {
						...msg,
						text: newLabel || msg.text,
						rotation: newRotation !== undefined ? newRotation : msg.value,
						replyId: newReplyId !== undefined ? newReplyId : msg.value
					};
				}

				//console.log(`→ No change for message ${id}`);
				return msg;
			});
		
			//console.log("update renderMessages after messagesMetadata changed");
			
			this.setState({
				mediaLabels,
				mediaRotations,
				replyMessages,
				renderMessages: updatedMessages,
			});
		}

	   if (prevState.sharingMessages != this.state.sharingMessages) {
		  // Handle sharing asset mode
		  if (this.state.sharingMessages) {
			  filteredMessages = [];
		  } else {
			  filteredMessages = this.state.filteredMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
		  }

		  this.setState({
			filteredMessages: filteredMessages 
		  });
	   }

	   if (prevState.searchString !== this.state.searchString || prevState.renderMessages != this.state.renderMessages || prevState.orderBy != this.state.orderBy) {	   
	       
			let filteredMessages = this.state.renderMessages;
	
			const mediaLabels = this.mediaLabels;
			const mediaRotations = this.mediaRotations;
		
		    if (this.state.orderBy === 'size') { 
		        //console.log('skip non files');
				filteredMessages = filteredMessages.filter(
				  message => message.metadata && message.metadata.filename
				);
			}

		    //console.log('filteredMessages type:', typeof filteredMessages);
		    try {
			filteredMessages = filteredMessages.map(msg => {
				const id = msg.messageId || msg._id;
				return {
					...msg,
					text: mediaLabels[id] || msg.text,
					rotation: mediaRotations[id] ?? msg.rotation
				};
			});
			
			} catch (e) {
			    console.log('filteredMessages error', e);
				return;
			}
		    
			// Add reply metadata
		    filteredMessages = filteredMessages.map(m => ({
			...m,
			  replyId: this.state.messagesMetadata?.[m._id]?.replyId ?? null,
		     }));
		     
		    //todo

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
		  this.setState({
			filteredMessages,
		  });
	  
      }
	}

	replyMessage = (message) => {
	  this.setState({ replyingTo: message }, () => {
		// Wait one tick so the input is mounted before focusing
		setTimeout(() => this.textInputRef?.focus() , 100);
	  });
	};

	renderMessageVideo = ({ currentMessage, orderBy }) => {
	  if (!currentMessage?.video) return null;
		  if (this.state.orderBy === 'size') {
			  return null;
		  }
	
	  const id = currentMessage._id;
	  const uri = currentMessage.video;
	  const videoMetaCache = this.state.videoMetaCache || {};
	  let thumbnail = currentMessage.thumbnail || currentMessage.thumbnail?.thumbnail || videoMetaCache[id]?.thumbnail;
	  const isLoading = !!this.state.videoLoadingState?.[id];
	  
	  //console.log('renderMessageVideo', currentMessage.video, currentMessage.thumbnail);

      if (thumbnail && thumbnail.indexOf('file://') === -1 && Platform.OS === 'android') {
		  thumbnail = 'file://' + thumbnail;
      }
	
		if (!thumbnail && !(id in this.state.videoMetaCache)) {
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
				  console.log(`Thumbnail ready for video ${id}:`, path);
				  this.props.updateFileTransferMetadata(currentMessage.metadata, 'thumbnail', path);
				})
				.catch(err => {
				  //console.log('Thumbnail generation failed:', err);
				  this.setState(prev => {
					const { [id]: _, ...rest } = prev.videoMetaCache;
					return { videoMetaCache: rest };
				  });
				});
			} else {
			  createThumbnail({
					url: uri,
					timeStamp: 1000, // first second of video
			  }).then(({ path, width, height }) => {
				  this.setState((prev) => ({
						videoMetaCache: {
						  ...prev.videoMetaCache,
						  [id]: { thumbnail: path, width, height },
						},
				  }));
				  console.log(`Thumbnail ready for video ${id}:`, path);
				  this.props.updateFileTransferMetadata(currentMessage.metadata, 'thumbnail', path);
				  // TODO cache thumbnail
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
		  {false && isLoading && (
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

	toggleGridSize = (id) => {
	  this.setState((prevState) => {
		let values = [1, 2, 3];
	
		const prevGrid = prevState.thumbnailGridSize || {};
		const images = this.state.imageGroups[id];
		let default_val = 1;
		if (images.length > 1) {
			if (images.length < 5) {
				default_val = 2;
				values = [1, 2];
			} else {
				default_val = 3;
				values = [1, 2, 3];
			} 
		}

		//console.log('toggleGridSize', id, this.state.imageGroups[id]);
	
		const currentValue = prevGrid[id] ?? default_val;
		const currentIndex = values.indexOf(currentValue);
	
		const nextIndex = (currentIndex + 1) % values.length;
	
		return {
		  thumbnailGridSize: {
			...prevGrid,
			[id]: values[nextIndex],
		  },
		};
	  });
	};

    renderMessageText(props) {
        const { currentMessage } = props;

        // Live location: dedicated bubble. Latest coords come from
        // messagesMetadata (tick N); fallback to the embedded metadata
        // that was carried on the origin message itself.
        if (currentMessage.contentType === 'application/sylk-live-location') {
            const latest = this.locationData?.[currentMessage._id]
                || currentMessage.metadata;
            return (
                <LocationBubble
                    currentMessage={currentMessage}
                    metadata={latest}
                    onLongPress={this.onLongMessagePress}
                    ownerName={this.props.myDisplayName}
                    peerName={this.props.selectedContact
                        && (this.props.selectedContact.name
                            || this.props.selectedContact.uri)}
                />
            );
        }

        let extraStyles = currentMessage.replyId ? {minWidth: 120} : {};
        // todo

        if (currentMessage.metadata && currentMessage.metadata.transfer_id) {
			extraStyles.minWidth = 250; 
        }

        let isTransfering = false;

		const isIncoming = currentMessage.direction === 'incoming';

	    let progressData = this.state.transferProgress[currentMessage._id] ?? null;
	    //console.log('-- progressData', progressData);
	    let progress = progressData ? progressData.progress / 100 : null;
	    isTransfering = progressData && progressData.progress < 100;
	    
	    if (!isIncoming && !currentMessage.pending) {
			// Original intent: hide upload progress on already-sent outgoing
			// messages. But on a multi-device account, the SAME outgoing
			// message can later be DOWNLOADED on the user's other device
			// (you upload from Desktop -> the file-transfer message
			// replicates to the Razr as still-outgoing -> you tap Download
			// on the Razr to fetch the encrypted blob). In that case the
			// stage is 'download' or 'decrypt', not 'upload'/'encrypt' --
			// keep isTransfering true so the progress bar, stage label, and
			// cancel button render.
			const downloadStage = progressData && (progressData.stage === 'download' || progressData.stage === 'decrypt');
			if (!downloadStage) {
				isTransfering = false;
			}
	    }

/*
		if (progressData) {
			console.log('currentMessage.pending', currentMessage.pending);
			console.log('currentMessage.sent', currentMessage.sent);
			console.log('isTransfering', isTransfering);
	    }
*/
	    let stage = progressData && progressData.stage;
	    if (stage) {
	        // Use the same label at every progress value — "Decrypting…" /
	        // "Downloading…" etc. The indeterminate progress bar (driven by
	        // `isStarting` below) is enough motion at 0% to show the
	        // request is alive without needing a separate "Starting…" label.
	        stage = stage.charAt(0).toUpperCase() + stage.substr(1).toLowerCase() + 'ing...';
	    }
	    const isStarting = !!(progressData && progressData.progress === 0);
	    
	    let mediaLabel = currentMessage.text;
	    if ( currentMessage.metadata?.label ) {
		    mediaLabel = currentMessage.metadata?.label;
	    } else if (this.state.mediaLabels[currentMessage._id]) {
	        mediaLabel = this.state.mediaLabels[currentMessage._id];
	    }
        // Create a temporary props object with overridden text
        if (currentMessage.metadata?.filesize && currentMessage.metadata.preview) {
			mediaLabel = mediaLabel + " of " + formatFileSize(currentMessage.metadata?.filesize);
        }
        
        //mediaLabel = mediaLabel + " " + currentMessage._id;
        
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
					justifyContent: 'space-between', // distribute items evenly,  
					paddingHorizontal: 8}, styles.photoMenuContainer, extraStyles]}>

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
						onPress={() => this.deleteSharingAssets()}
					  />				  
						</View>
					); 
				} else {
					return (
					<View style={[{flexDirection: 'row', alignItems: 'flex-start', borderWidth: 0, borderColor: 'red',
					justifyContent: 'space-between', // distribute items evenly
					paddingHorizontal: 0}, styles.photoMenuContainer, extraStyles]}>

						<GiftedChatContext.Consumer>
						  {(chatContext) => (
							<IconButton
								style={styles.photoMenu}
								size={20}
								icon="menu"
								iconColor={!isIncoming ? "black": "white"}
								onPress={() => this.onLongMessagePress(chatContext, currentMessage)}
							/>
						  )}
						</GiftedChatContext.Consumer>
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
						  {/* This middle section: label + video progress bar inline */}
						  <View
							style={{
							  flex: 1,
							  flexDirection: 'row',
							  alignItems: 'flex-start',
							  justifyContent: 'space-between',
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
								marginTop: 6,
							  }}
							>
							  {mediaLabel}
							</Text>

							{isTransfering && (
					        <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
							  <Progress.Bar
								progress={progress}
								indeterminate={isStarting}
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
								{isStarting ? '…' : Math.round(progress * 100) + '%'}
							  </Text>
							  </View>
							)}

							{!isTransfering?
							<IconButton
							  icon="fullscreen"
							  size={24}
							  onPress={() => this.openVideoModal(currentMessage.video)}
							  style={{ padding: 0, margin: 0 }}
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
				<View style={[{flexDirection: 'row', alignItems: 'flex-start', borderWidth: 0, borderColor: 'red',
				justifyContent: 'space-between', // distribute items evenly
				paddingHorizontal: 0}, styles.photoMenuContainer, extraStyles]}>

					<GiftedChatContext.Consumer>
					  {(chatContext) => (
						<IconButton
							style={styles.audio}
							size={20}
							icon="menu"
							iconColor='white'
							onPress={() => this.onLongMessagePress(chatContext, currentMessage)}
						/>
					  )}
					</GiftedChatContext.Consumer>

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
					  {/* This middle section: label + video progress bar inline */}
					  <View
						style={{
						  flex: 1,
						  flexDirection: 'row',
						  alignItems: 'flex-start',
						  justifyContent: 'space-between',
						}}
					  >
						{/* Label text on the left */}
						<Text
						  style={{
							color: 'white',
							fontSize: 14,
							flexShrink: 1,
							textAlignVertical: 'center',
							includeFontPadding: false,
							marginTop: 6,
						  }}
						>
						  {mediaLabel}
						</Text>

						{isTransfering && (
						<View style={{ marginTop: 8, alignItems: 'flex-start' }}>
						  <Progress.Bar
							progress={progress}
							indeterminate={isStarting}
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
							{isStarting ? '…' : Math.round(progress * 100) + '%'}
						  </Text>
						  </View>

						)}

						{isTransfering?
						<IconButton
						  icon="cancel"
						  size={24}
						  onPress={() => this.cancelTransfer(currentMessage)}
						  style={{ }}
						  iconColor={'white'}
						/>
						: null}
							
					   </View>
					  </View>
				</View>
			); 

        } else if (currentMessage.image) {
            const fontColor = !isIncoming ? "black": "white";

            if (currentMessage.metadata.preview) {
				return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
						justifyContent: 'flex-start',
						paddingHorizontal: 10,
						paddingTop: 12}, styles.photoMenuContainer, extraStyles]}>


					<View style={{flexDirection: 'row', alignItems: 'center',  borderWidth: 0, borderColor: 'red'}}>

					{ Platform.OS === "android" ?
					   <Checkbox
						 color="white"
						 uncheckedColor="white"
						 status={this.state.fullSize ? 'checked' : 'unchecked'}
						 onPress={() => {this.setState(prev => ({ fullSize: !prev.fullSize }));
						 }}
						/>
					:

					<View
					  style={{
						borderWidth: this.state.fullSize ? 0.5 : 2,
						borderColor: 'white',
						borderRadius: 2,
						padding: 0,
						transform: [{ scale: 0.5 }]
					  }}
					>
						<Checkbox
						  color="white"
						  uncheckedColor="white"
						  status={this.state.fullSize ? 'checked' : 'unchecked'}
						  onPress={() => {this.setState(prev => ({ fullSize: !prev.fullSize }));
						 }}
						/>
					 </View>
					 }
					  <Text style={[styles.checkboxLabel, {marginTop: 0, color: 'white'}]}>
					    {(() => {
					        // When uploading a batch of images the user sees one
					        // preview bubble per image. Pre-fix, the "Full size of …"
					        // label only reflected the size of the bubble it lived
					        // on (typically the last one), making it look like the
					        // whole upload was tiny. Sum filesizes across all
					        // sharingMessages when there's more than one so the
					        // label reflects the entire payload the user is about
					        // to send.
					        const sm = this.state.sharingMessages || [];
					        if (sm.length > 1) {
					            const total = sm.reduce(
					                (s, m) => s + ((m.metadata && m.metadata.filesize) || 0),
					                0
					            );
					            return total > 0
					                ? `Full size of ${formatFileSize(total)} (${sm.length} images)`
					                : `Full size (${sm.length} images)`;
					        }
					        return currentMessage.metadata?.filesize
					            ? 'Full size of ' + formatFileSize(currentMessage.metadata.filesize)
					            : 'Full size';
					    })()}
					  </Text>
					  </View>

					{/* Delete button has moved to the left side of the input
					    toolbar (see CustomActions / ChatActions.js) so the
					    preview bubble holds only the Full-size toggle. */}

					</View>
				);
			} else {
				return (
				<View style={[{flexDirection: 'row', alignItems: 'center',
				justifyContent: 'space-between', // distribute items evenly
				paddingHorizontal: 0}, styles.photoMenuContainer, extraStyles]}>

					<GiftedChatContext.Consumer>
					  {(chatContext) => (
						<IconButton
							style={styles.photoMenu}
							size={20}
							icon="menu"
							iconColor={!isIncoming ? "black": "white"}
							onPress={() => this.onLongMessagePress(chatContext, currentMessage)}
						/>
					  )}
					</GiftedChatContext.Consumer>
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
					  {/* This middle section: label + image progress bar inline */}
					  <View
						style={{
						  flex: 1,
						  flexDirection: 'row',
						  alignItems: 'flex-start',
						  justifyContent: 'space-between',
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
							marginTop: 8,
						  }}
						>
						  {mediaLabel}
						</Text>					

						{isTransfering && (
						<View style={{ marginTop: 8, alignItems: 'flex-start' }}>

						  <Progress.Bar
							progress={progress}
							indeterminate={isStarting}
							width={60}         // smaller width for inline look
							height={6}
							borderRadius={3}
							borderWidth={0}
							color={isTransfering ? "#007AFF" : "orange"}
							unfilledColor="#e0e0e0"
							style={{ marginRight: 12 }}  // small gap from label
						  />
						  <Text
							style={{
							  fontSize: 12,
							  color: 'orange',
							  marginTop: 2,
							  marginLeft: 2,
							}}
						  >
							{isStarting ? '…' : Math.round(progress * 100) + '%'}
						  </Text>
						  </View>
						)}

                        { !isTransfering && currentMessage._id in this.state.imageGroups ?
							<View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
							<IconButton
							  icon="grid"
							  size={18}
							  onPress={() => this.toggleGridSize(currentMessage._id)}
							  style={{ padding: 0, margin: 0 }}
							  iconColor={fontColor}
							/>
	
						  </View>
						: null
						}

						{!isTransfering && !(currentMessage._id in this.state.imageGroups) ?
						<IconButton
						  icon="fullscreen"
						  size={18}
						  onPress={() => this.onImagePress(currentMessage)}
						  style={{ padding: 0, margin: 0 }}
						  iconColor={fontColor}
						/>
						: 
						null}
						
						{isTransfering ?
						<IconButton
						  icon="cancel"
						  size={18}
						  onPress={() => this.cancelTransfer(currentMessage)}
						  style={{ }}
						  iconColor={fontColor}
						/>
						: null
						}    

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
								indeterminate={isStarting}
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
								{isStarting ? '…' : Math.round(progress * 100) + '%'}
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
						
						  /* Not downloading — explicit "Press to download"
						     affordance. Pre-fix the bubble showed a bare
						     download icon with no label, which made it
						     unclear that the user had to act before
						     anything would happen (especially for large
						     files where auto-download is skipped). */
						  currentMessage.metadata.local_url == null && (
							<View
							  style={{
								marginTop: 6,
								flexDirection: 'row',
								justifyContent: 'flex-end',
								alignItems: 'center',
							  }}
							>
							  <Text
								style={{
								  color: '#666',
								  fontSize: 13,
								  marginRight: 4,
								}}
							  >
								Press to download
							  </Text>
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

			if (currentMessage.html) {


			    let html = linkifyHtml(utils.cleanHtml(currentMessage.html));
				// remove background + color styles
				html = html.replace(/background-color:[^;"]+;?/gi, '');
				html = html.replace(/color:[^;"]+;?/gi, '');

			    let w = 300;

			    if (currentMessage._id in this.state.bubbleWidths) {
			        w = this.state.bubbleWidths[currentMessage._id];
					//console.log('w', w);
			    }
			   
			    const isIncoming = currentMessage.direction === 'incoming';
			   
				return (
                <View style={[styles.messageTextContainer, extraStyles, { flexDirection: 'row', alignItems: 'center', marginLeft: 10, marginRight: 10}]}>

				  <RenderHTML
					source={{ html: html }}
					contentWidth={w}
					  tagsStyles={{
						span: {
						  color: isIncoming ? '#FFFFFF' : '#000000',
						  backgroundColor: 'transparent',
						},
						p: {
						  color: isIncoming ? '#FFFFFF' : '#000000',
						},
						a: {
						  color: isIncoming ? '#FFFFFF' : '#1DA1F2',
						  textDecorationLine: 'underline',
						}
					  }}
					ignoredDomTags={[
					  'html',
					  'head',
					  'body',
					  'title',
					  'svg',
					  'meta',
					  'link',
					  'style',
					  'script',
					  'iframe',
					  'object',
					  'embed',
					  'noscript'
					]}

					renderersProps={{
					    a: {
							onPress: (event, href) => {
							  let url = href;
				
							  if (!url.startsWith('http')) {
							    url = 'https://' + url;
							  }
				
							  Linking.openURL(url);
							}
						  }
					}}
          		  />
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

				  {/* MessageText with clickable, styled links */}
				  <CustomMessageText
					{...props}
					{...labelProps}
					customTextStyle={styles.messageText}
					linkStyle={styles.linkText}
					enableUrlPreview={false} // disables default auto-link open
				  />

                </View>
            );
  		}
    };

	renderDay = (props) => {
	  const { currentMessage } = props;
	
	  // Don't render the day if the message is hidden
	  if (this.state.orderBy === 'size') return null;
	
	  // Otherwise, render the default day
	  return <Day {...props} />;
	};

	renderTime = (props) => {
	  const { currentMessage, position } = props;

	  if (currentMessage.metadata?.preview) return null;
	 
	  const isIncoming = currentMessage.direction === 'incoming';
	  const isMedia = currentMessage.video || currentMessage.audio;
	  const textColor = currentMessage.audio || isIncoming ? 'white' : 'black';
	  let hasFileSize = !!currentMessage.metadata?.filesize;
	  // In normal chat, suppress per-photo filesize for any image that
	  // belongs to a group (the group leader's id is a key in
	  // imageGroups; non-leader members of the same group only appear
	  // in groupOfImage). Sizes were noisy in the timeline view — they
	  // belong on the grid media screen, where filesize is the whole
	  // point. Show them there (orderBy === 'size'), hide elsewhere.
	  if (this.state.orderBy !== 'size') {
	      if (currentMessage._id in this.state.imageGroups) {
	          hasFileSize = false;
	      }
	      if (this.state.groupOfImage && currentMessage._id in this.state.groupOfImage) {
	          hasFileSize = false;
	      }
	  }
	
	  const timeString = currentMessage.createdAt
		? dayjs(currentMessage.createdAt).format('h:mm A')
		: '';

	  // Build duration string for audio messages (e.g. "0:42")
	  let durationString = '';
	  if (currentMessage.audio) {
		const secs = this.state.audioDurations?.[currentMessage._id];
		if (typeof secs === 'number' && secs > 0) {
		  const m = Math.floor(secs / 60);
		  const s = Math.floor(secs % 60);
		  durationString = `${m}:${s < 10 ? '0' : ''}${s}`;
		} else {
		  // Kick off the duration load if it hasn't been loaded yet, so the
		  // footer updates without requiring the user to press play first.
		  this.getAudioDuration(currentMessage.audio, currentMessage._id);
		}
	  }

	  // Compose footer parts in order, then join with separators
	  const parts = [];
	  if (isIncoming) {
		parts.push(timeString);
		if (hasFileSize) parts.push(formatFileSize(currentMessage.metadata.filesize));
		if (durationString) parts.push(durationString);
	  } else {
		if (durationString) parts.push(durationString);
		if (hasFileSize) parts.push(formatFileSize(currentMessage.metadata.filesize));
		parts.push(timeString);
	  }
	  let text = parts.filter(Boolean).join('  •  ');

	  let consumed = currentMessage.consumed || 0;
	  const showProgress = !isIncoming && consumed > 0;
	
	  return (
		<View
		  style={{
			flexDirection: 'row',
			alignItems: 'center',
			marginLeft: 10,
			marginRight: 10,
			marginBottom: 5,
		  }}
		>
		  {/* Progress bar on the LEFT */}
		  {showProgress && (
			<View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
			  <UserIcon size={15} identity={this.state.selectedContact}/>
			  <Progress.Bar
				progress={consumed/100}
				width={60}
				height={6}
				borderRadius={3}
				borderWidth={0}
				color="#007AFF"
				unfilledColor="#e0e0e0"
				style={{ marginLeft: 8}}
			  />
			</View>
		  )}
	
		  {/* Time text */}
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
	  console.log('Play modalVideoUri', uri);
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

renderScrollingControls = () => (
  <View
    style={{
      position: "absolute",
      right: 10,
      bottom: 80,
      alignItems: "center",
      gap: 6,
      zIndex: 999,
    }}
  >

	<TouchableOpacity
	  onPress={() => this.scrollToTop()}
	  style={navButton}
	>
	  <Icon name="format-vertical-align-top" size={22} color="white" />
	</TouchableOpacity>
	
	<TouchableOpacity
	  onPress={() => this.scrollToBottom()}
	  style={navButton}
	>
	  <Icon name="format-vertical-align-bottom" size={22} color="white" />
	</TouchableOpacity>

  </View>
);
			
renderFocusedMessagesControls = () => (
  <View
    style={{
      position: "absolute",
      right: 10,
      bottom: 160,
      alignItems: "center",
      gap: 6,
      zIndex: 999,
    }}
  >

	<TouchableOpacity
	  onPress={() => this.loadPrevious()}
	  style={navButton}
	>
	  <Icon name="arrow-up" size={22} color="white" />
	</TouchableOpacity>
	
	<TouchableOpacity
	  onPress={() => this.loadPrevious()}
	  style={navButton}
	>
	  <Icon name="arrow-down" size={22} color="white" />
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

	scrollToTop = () => {
	  if (this.flatListRef) {
		try {
			this.flatListRef.scrollToEnd({ animated: true });

		} catch (e) {
		  console.warn('scrollToTop failed:', e);
		}
	  }
	};

	onScroll = (event) => {
	  const offsetY = event.nativeEvent.contentOffset.y;
	  //console.log('onScroll offsetY', offsetY);
	
	  // adjust threshold as needed
	  this.setState({
		showScrollSideButtons: offsetY > 300,
	  });
	};

	scrollToBottom() {
	  //console.log('scrollToBottom called');
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

    get showImageGrid() {		
		if (this.state.messagesCategoryFilter == 'image') {
			return true;
		}
		return false;
	}

    get showChat() {
		if (this.state.expandedImage) {
			return false;
		}    
		
		if (this.state.inviteContacts) {
			return false;
		}    
		
		if (this.state.messagesCategoryFilter == 'image') {
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

    get showReadonlyChat() {
		if (this.state.messagesCategoryFilter == 'image') {
			return false;
		}
		
		if (this.state.expandedImage) {
			return false;
		}
		
        return true;
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
  
  async deleteImages(selectedImages) {
		console.log('deleteImages', selectedImages);
		if (!this.state.selectedContact) {
			return;
		}

		for (const id of selectedImages) {
		  console.log('delete image id', id);
		  this.props.deleteMessage(id, this.state.selectedContact.uri);
		}
    }
  
	getImageGroups() {
	  if (this.state.messagesCategoryFilter) {
	      return;
	  }
	
	  let messages = this.state.renderMessages;
	  if (this.state.sharingMessages.length > 0) {
		  messages = this.state.sharingMessages;
	  }
	  
	  const groups = {};
	  const byImage = {};
	
	  const FIVE_MIN = 5 * 60 * 1000;
	
	  let currentGroup = null;
	  let lastImageTime = null;
	  let lastImageId = null;
	
		const seen = new Set();
		messages = messages.filter(msg => {
		  if (seen.has(msg._id)) return false;
		  seen.add(msg._id);
		  return true;
		});

	messages = [...messages].sort(
	  (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
	);

	  for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const isImage = !!msg.image;
	
		if (isImage) {
		  const currentTime = new Date(msg.createdAt).getTime();

		/*
		  if (lastImageTime) {
			const diff = currentTime - lastImageTime;
		
			console.log('---');
			console.log('prev:', lastImageId, new Date(lastImageTime).toISOString());
			console.log('curr:', msg._id, new Date(currentTime).toISOString());
			console.log('diff (min):', msg._id, diff / 60000);
		  }
		  */

			const hasLabel = !!this.state.mediaLabels?.[msg._id];
			
			const shouldStartNewGroup =
			  !currentGroup ||
			  !lastImageTime ||
			  currentTime - lastImageTime > FIVE_MIN ||
			  (hasLabel && msg._id !== currentGroup); // ⬅️ NEW RULE
    
	
		  if (shouldStartNewGroup) {
			currentGroup = msg._id;
			groups[currentGroup] = [];
			//console.log('Start group', currentGroup, msg.createdAt);
		  }
	
		  groups[currentGroup].push(msg._id);
		  byImage[msg._id] = currentGroup;
	
		  lastImageTime = currentTime;
		  lastImageId = msg._id;
		} else {
		  currentGroup = null;
		  lastImageTime = null;
		  lastImageId = null;
		}
	  }
	
	  // ✅ PRUNE groups with only 1 image
	  const prunedGroups = {};
	  const prunedByImage = {};
	
	  Object.keys(groups).forEach(groupId => {
		const imgs = groups[groupId];
	
		if (imgs.length > 1) {
		  prunedGroups[groupId] = imgs;
	
		  imgs.forEach(imgId => {
			prunedByImage[imgId] = groupId;
		  });
		}
	  });
	
	  this.setState({
		groupOfImage: prunedByImage,
		imageGroups: prunedGroups
	  });
	}


    render() {
        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let contacts = this.state.allContacts;
        //console.log('----');
                
        //console.log('--- Render contacts', this.state.isLoadingEarlier);
        //console.log('--- CL selectedContact', this.state.selectedContact?.messagesMetadata);

       let chatInputClass = this.customInputToolbar;

        // No local private key → messages can't be encrypted/sent, so the
        // composer is replaced with a static warning banner pointing to
        // Menu > My private key. This check takes priority over the other
        // overrides below so the user sees the "why" instead of a blank
        // row. `state.keys` is null when no key is loaded; any truthy
        // object means we have at least the public key locally.
        const hasPrivateKey = !!(this.state.keys && this.state.keys.private);

        if (!hasPrivateKey) {
            chatInputClass = this.noKeyInputToolbar;
        } else if (this.state.selectedContact) {
           if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
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

            if (this.state.accountId === elem.uri && elem.tags.length === 0) {
                //return;
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
            //console.log('item', item.uri, item.tags);

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

        var recentStart = new Date();
        recentStart.setDate(todayStart.getDate() - 3);
        recentStart.setHours(0,0,0,0);

        items.forEach((item) => {
            const fromDomain = '@' + item.uri.split('@')[1];

            if (item.uri === 'anonymous@anonymous.invalid' && this.state.filter !== 'blocked') {
                return;
            }

            if (this.state.periodFilter === 'recent') {
                if(item.timestamp < recentStart ) {
                    return;
                }
            }

            if (this.state.inviteContacts && item.uri.indexOf('@videoconference.') > -1) {
                return;
            }

            if (item.uri.indexOf('@videoconference.') > -1 && this.state.filter == 'calls') {
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

        if (this.state.orderBy == 'size') {
            if (this.state.sortOrder == 'desc') {
                items.sort((a, b) => (a.storage < b.storage) ? 1 : -1)
            } else {
                items.sort((a, b) => (a.storage > b.storage) ? 1 : -1)
            }
        } else {
            const sortOrder = this.state.sortOrder;
        
			items.sort(function(a, b) {
			  var aHasTimestamp = !!a.timestamp;
			  var bHasTimestamp = !!b.timestamp;
			
			  // Case 1: both have timestamps -> newest first
			  if (aHasTimestamp && bHasTimestamp) {
				if (sortOrder == 'desc') {
					return new Date(b.timestamp) - new Date(a.timestamp);
				} else {
					return new Date(a.timestamp) - new Date(b.timestamp);
				}
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

        //console.log(this.state.orderBy);

        if (items.length === 1) {
            items[0].showActions = true;
        }

        items.forEach((item) => {
            item.showActions = false;
            //console.log(item.timestamp, item.uri, item.name);
        });

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
        const replyMessages = this.state.replyMessages;
        const mediaLabels = this.state.mediaLabels;
        const mediaRotations = this.state.mediaRotations;
        const shareToContacts = this.state.shareToContacts;
        const transferProgress = this.state.transferProgress;
        const renderMessages = this.state.renderMessages;
        const searchMessages = this.state.searchMessages;
        const searchString = this.state.searchString;
        const gettingSharedAsset = this.state.gettingSharedAsset;
        const showChat = this.showChat;
        const orderBy = this.state.orderBy;
	    const groupOfImage = this.state.groupOfImage;
	    const imageGroups = this.state.imageGroups;

		if (debug) {
			const values = {
// 			mediaRotations,
 			mediaLabels,
//			messagesMetadata,
//			groupOfImage,
			imageGroups,
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

        // normal messages from database
        let messages = this.state.filteredMessages;
        
        if (this.state.gettingSharedAsset) {
            // we are acquiring files to share
            messages = [];
        } else if (this.state.sharingMessages.length > 0) {
            // we have files to share
			messages = this.state.sharingMessages;
        }
        
        if (this.state.orderBy === 'size') {
			messages = messages.filter(
			  msg => msg.metadata && msg.metadata.filename // or whatever condition you have
			);

			  messages = messages
				// Keep only messages that have metadata and filename
				.filter(msg => msg.metadata && msg.metadata.filename)
				// Sort by filesize according to sortOrder
				.sort((a, b) => {
				  const sizeA = a.metadata.filesize || 0;
				  const sizeB = b.metadata.filesize || 0;
			
				  return this.state.sortOrder === 'desc'
					? sizeB - sizeA // largest first
					: sizeA - sizeB; // smallest first
				});
		}

        //console.log('this.state.selectedContact', this.state.selectedContact);
        let chatMessages = this.state.focusedMessages || messages;
        // remove duplicate messages no mater what
        chatMessages = chatMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
        let loadEarlier = !this.state.totalMessageExceeded && !this.state.gettingSharedAsset && this.state.sharingAssets.length == 0 && messages.length > 0;
        //console.log('chatMessages', chatMessages);
        //console.log(JSON.stringify(chatMessages, null, 2));
        
        if (this.state.isAudioRecording || this.state.recordingFile) {
			chatMessages = [];
			loadEarlier = false;
        }
        
        //console.log('chatContainer', chatContainer);
        const topInset = this.state.insets?.top || 0;
		const bottomInset = this.state.insets?.bottom || 0;
		const leftInset = this.state.insets?.left || 0;
		const rightInset = this.state.insets?.right || 0;

        const images = chatMessages
		  .filter(m => !!m.image)   // only messages that contain images
		  .map(msg => ({
			id: String(msg._id),
			uri: msg.image,
			title: msg.text || '',
			size: msg.metadata.filesize,
			timestamp: msg.metadata.timestamp,
			rotation: msg.metadata.rotation,
		  }));
		  
			
		if (this.state.orderBy === 'timestamp') {
			if (this.state.sortOrder == 'desc') {
                images.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1)
            } else {
                images.sort((a, b) => (a.timestamp > b.timestamp) ? 1 : -1)
            }
		}

		const navigatorBarHeight = 60;
		
		const visibleMessages = chatMessages.filter(msg => {
		      // skipped duplicate grouped images
			  // if not an image → always show
			  if (!msg.image) return true;
			
			  const groupId = this.state.groupOfImage[msg._id];
			
			  // not grouped → show
			  if (!groupId) return true;
			
			  // show only first image of group
			  return this.state.imageGroups[groupId][0] === msg._id;
			});
			
		//console.log('visibleMessages', visibleMessages.length);
		//console.log('chatMessages', chatMessages.length);
		  		  
		const KeyboardWrapper = Platform.OS === 'ios'
			  ? View
			  : KeyboardAvoidingView;
	
        return (
            <SafeAreaView style={[container, {borderColor: 'white', borderWidth: 0}]}>
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
                extraData={items}
                renderItem={this.renderContactItem}
                listKey={item => item.id}
                /*
                  Key must change whenever numColumns changes, otherwise
                  FlatList throws "Changing numColumns on the fly is not
                  supported". `columns` depends on both orientation AND
                  isTablet (which now flips on fold/unfold via
                  _detectOrientation's minSide rule), so key on the
                  computed column count directly — it's the only value
                  that really matters to FlatList here.

                  We also fold rounded window width/height into the key so
                  that a pure density change (e.g. Razr cover display
                  toggling between Android's "Default View" and "Full
                  Screen" modes — same orientation, same columns, but
                  different density/window dims) still remounts the list
                  and its Paper <Text>/<Card> children. Without this, the
                  native TextView's cached line-metrics carried the pre-
                  transition density, leaving contact-row fonts visually
                  oversized on the cover display.
                */
                key={this.props.orientation + '-c' + columns
                    + '-' + Math.round(Dimensions.get('window').width)
                    + 'x' + Math.round(Dimensions.get('window').height)}
                loadEarlier={false}
             />
             }

				{this.state.gettingSharedAsset && (
				  <View
					style={{
					  position: 'absolute',   // overlay on top
					  top: 0,
					  left: 0,
					  right: 0,
					  bottom: 0,
					  justifyContent: 'center',
					  alignItems: 'center',
					  backgroundColor: 'rgba(0,0,0,0.6)', // optional semi-transparent dim
					}}
				  >
					<Text style={{ color: 'white', fontSize: 20, marginBottom: 30 }}>Processing content...</Text>
					<ActivityIndicator size="large" color="#999" />
				  </View>
				)}
  
             {this.showImageGrid ?
				  <ThumbnailGrid
					images={images}
					isLandscape={this.state.isLandscape}
					numColumns={3}
					showTimestamp={true}
					showSize={true}
					enableDelete={true}
					deleteImages={this.deleteImages}
					onRotateImage={this.onRotateImage}
					onSelectionChange = {this.searchThumbnailSelectionChanged}
					onLongPress={(item) => console.log('long', item)}
					renderThumb={({item, index, size}) => (
					  <View style={{flex:1}}>
						<Image source={{uri:item.uri}} style={{width:size, height:size, borderRadius:6}} />
					  </View>
					)}
				  />
			  : null}

             {this.showChat ?
             <View style={[chatContainer, borderClass]}>
				<KeyboardWrapper
					  key={this.state.isLandscape ? 'landscape' : 'portrait'}
					  style={[chatContainer, {marginBottom: Platform.OS === 'ios' ? this.state.composerHeight - bottomInset + this.state.replyContainerHeight: 0}]}

					  {...(Platform.OS === 'android'
						? {
							behavior: 'height',
							keyboardVerticalOffset: navigatorBarHeight + topInset,
						  }
						: {})}
					>

                <GiftedChat 
				  listViewProps={{
					ref: (ref) => { this.flatListRef = ref; },
					onViewableItemsChanged: this.onViewableItemsChanged,
				    onScroll: this.onScroll,
				    scrollEventThrottle: 16,
					viewabilityConfig: this.viewabilityConfig,
				  }}
				  
				  bottomOffset={Platform.OS === 'ios' ? bottomInset : 0}
                  innerRef={this.chatListRef}
                  messages={visibleMessages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onMessagePress}
                  renderInputToolbar={chatInputClass}
                  renderMessage={(props) => {
                      // Image-attach preview: collapse gifted-chat's
                      // built-in avatar gutter (renderAvatar={null}
                      // makes Avatar return null) and zero out the
                      // hard-coded marginLeft/marginRight on Message's
                      // inner row so the bubble truly reaches both
                      // screen edges.
                      const isPreview = props.currentMessage?.metadata?.preview === true;
                      if (!isPreview) {
                          return <Message {...props} />;
                      }
                      const previewRowStyle = { marginLeft: 0, marginRight: 0 };
                      return (
                          <Message
                              {...props}
                              renderAvatar={null}
                              containerStyle={{
                                  left: previewRowStyle,
                                  right: previewRowStyle
                              }}
                          />
                      );
                  }}
                  renderBubble={this.renderBubbleWithMessages}
                  renderMessageText={this.renderMessageText}
				  renderMessageImage={(props) =>
					this.renderMessageImage({ ...props, orderBy: this.state.orderBy })
				  }
				  renderMessageVideo={(props) =>
					this.renderMessageVideo({ ...props, orderBy: this.state.orderBy })
				  }
                  renderMessageAudio={this.renderMessageAudio}
                  //shouldUpdateMessage={this.shouldUpdateMessage}
                  renderTime={this.renderTime}
                  renderDay={this.renderDay}
                  placeholder={this.state.placeholder}
                  lockStyle={styles.lock}
                  renderSend={this.renderSend}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  maxInputLength={16000}
                  tickStyle={{ color: 'green' }}
                  renderTicks={this.state.orderBy === 'size' ? null : undefined}
                  infiniteScroll={false}
                  loadEarlier={loadEarlier}
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

			   </KeyboardWrapper>

				{ (this.state.focusedMessages && !this.state.actionSheetDisplayed) ? this.renderFocusedMessagesControls(): null}
				{((this.state.showScrollSideButtons || this.state.focusedMessages) && !this.state.actionSheetDisplayed)? this.renderScrollingControls(): null}

                {addSpacer ? <KeyboardSpacer /> : null }

              </View>

              : (items.length === 1 && this.showReadonlyChat) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
				  listViewProps={{
					ref: (ref) => { this.flatListRef = ref; },
					onViewableItemsChanged: this.onViewableItemsChanged,
					viewabilityConfig: this.viewabilityConfig,
				  }}
                  messages={chatMessages}
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
                  timeTextStyle={{ left: { color: 'white' }, right: { color: 'black' } }}
                  infiniteScroll
                  loadEarlier={!this.state.totalMessageExceeded && this.state.selectedContact !== null}
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

				{/* Close button — explicit "go back" affordance. Uses the
				    raw vector-icons Icon (not paper's IconButton) so the
				    glyph renders reliably without the IconButton's
				    internal padding/touch-area that could otherwise nest
				    badly inside the TouchableOpacity. */}
				<TouchableOpacity
				  onPress={() => this.onImagePress(null)}
				  hitSlop={{top: 20, left: 20, right: 20, bottom: 20}}
				  style={{
					position: "absolute",
					top: 40,
					left: 30,
					backgroundColor: "rgba(0,0,0,0.6)",
					width: 56,
					height: 56,
					borderRadius: 28,
					alignItems: "center",
					justifyContent: "center",
					zIndex: 100,
					elevation: 100,
				  }}
				>
				  <Icon name="close" size={36} color="white" />
				</TouchableOpacity>
			  </Modal>
			)}

            {/* iOS audio playback engine. Hidden zero-size Video in
                audio-only mode that plays through AVPlayer (more permissive
                than AVAudioPlayer / audioRecorderPlayer's CoreAudio path,
                so VBR Sony recorder MP3s actually decode). Mounted only
                when iosAudio.path is set; unmount on stop releases the
                asset. Android continues to use audioRecorderPlayer and
                does not render this. */}
            {Platform.OS === 'ios' && this.state.iosAudio && this.state.iosAudio.path ? (
                <Video
                    ref={(r) => { this._iosAudioRef = r; }}
                    source={{ uri: this.state.iosAudio.path }}
                    audioOnly={true}
                    paused={this.state.iosAudio.paused}
                    ignoreSilentSwitch="ignore"
                    playInBackground={false}
                    onLoad={this._onIOSAudioLoad}
                    onProgress={this._onIOSAudioProgress}
                    onEnd={this._onIOSAudioEnd}
                    onError={this._onIOSAudioError}
                    progressUpdateInterval={250}
                    style={{ width: 0, height: 0, position: 'absolute' }}
                />
            ) : null}

            <DeleteMessageModal
                show={this.state.showDeleteMessageModal}
                close={this.closeDeleteMessageModal}
                contact={this.state.selectedContact}
                deleteMessageFunc={this.props.deleteMessage}
                messages={this.state.messagesToDelete}
                canDeleteRemote={this.state.canDeleteRemote}
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
    callHistoryUrl: PropTypes.string,
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
    contactsFilter  : PropTypes.string,
    periodFilter    : PropTypes.string,
    defaultDomain   : PropTypes.string,
    allContacts      : PropTypes.array,
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
    forwardMessagesFunc: PropTypes.func,
    messagesCategoryFilter: PropTypes.string,
    startCall: PropTypes.func,
    sourceContact: PropTypes.object,
    requestCameraPermission: PropTypes.func,
    requestMicPermission: PropTypes.func,
    requestStoragePermissions: PropTypes.func,
    file2GiftedChat: PropTypes.func,
    postSystemNotification: PropTypes.func,
    orderBy: PropTypes.string,
    sortOrder: PropTypes.string,
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
    totalMessageExceeded: PropTypes.bool,
    gettingSharedAsset: PropTypes.bool,
	startAudioPlayerFunc: PropTypes.func,
	stopAudioPlayerFunc: PropTypes.func,
	markAudioMessageDisplayedFunc: PropTypes.func,
	playRecording: PropTypes.bool,
	updateFileTransferMetadata: PropTypes.func,
	isAudioRecording: PropTypes.bool,
	recordingFile: PropTypes.string,
	sendAudioFile: PropTypes.func,
	insets: PropTypes.object,
	appState: PropTypes.string
};


export default ContactsListBox;
