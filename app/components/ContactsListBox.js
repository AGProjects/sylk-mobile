import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Modal, Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, Platform, PermissionsAndroid, Switch, StyleSheet, TextInput, TouchableOpacity, TouchableWithoutFeedback, Pressable, BackHandler, TouchableHighlight, KeyboardAvoidingView, DeviceEventEmitter} from 'react-native';
import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble, MessageText, Send, InputToolbar, MessageImage, Time, Composer, Day, Message, SystemMessage} from 'react-native-gifted-chat'
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
import RenderHTML, { HTMLElementModel, HTMLContentModel } from 'react-native-render-html';

import * as Progress from 'react-native-progress';

import ChatBubble from './ChatBubble';
import LocationBubble from './LocationBubble';
import DarkModeManager from '../DarkModeManager';
import ThumbnailGrid from './ThumbnailGrid';
import AudioProgressSlider from './AudioProgressSlider';
import VuMeter from './VuMeter';
import AudioWaveform from './AudioWaveform';
// In-app emoji picker. Used in renderComposer below — tapping the
// smiley button dismisses the system IME and opens this picker, so we
// never trigger the system emoji panel (which doesn't compose well
// with adjustResize on Android and used to cover the input bar).
import EmojiPicker from './EmojiPicker';
// Quick-reaction bar: floats over the chat when the user single-taps
// a bubble. Tapping a pill routes through the existing reply pipeline
// (replyMessage + onSendMessage), so a reaction is just a reply whose
// body is the emoji — no new wire format.
import ReactionBar from './ReactionBar';

import moment from 'moment';
import momenttz from 'moment-timezone';
import Video from 'react-native-video';
import VideoPlayer from 'react-native-video-player';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-camera-roll/camera-roll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import FastImage from 'react-native-fast-image';
import { ActivityIndicator, Animated, Alert } from 'react-native';
import dayjs from 'dayjs';

import styles from '../assets/styles/ContactsListBox';
import Share from 'react-native-share';

// Teach react-native-render-html about non-standard / Web-Components tags
// (<button>, <slot>, …) so it stops warning each time an incoming HTML
// message contains one. We treat them as mixed content (can hold both
// inline text and block children) — this is the most permissive model
// and makes the inner content still render as plain text rather than
// being silently dropped (which is what ignoredDomTags=[…] would do).
const customHTMLElementModels = {
    button: HTMLElementModel.fromCustomModel({
        tagName: 'button',
        contentModel: HTMLContentModel.mixed,
    }),
    slot: HTMLElementModel.fromCustomModel({
        tagName: 'slot',
        contentModel: HTMLContentModel.mixed,
    }),
};

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
            // Quick-reaction bar state. When non-null, the floating
            // ReactionBar is mounted and its emoji taps route to
            // quickReact(reactionTarget, emoji) which seeds replyingTo
            // and immediately fires onSendMessage with the emoji.
            // All other bubbles dim to opacity 0.35 (see
            // ChatBubble.isDimmedByReplyTarget) so the target pops.
            //   shape: <currentMessage> | null
            reactionTarget: null,
            // Emoji set shown in the quick-reaction bar. Ordered most-
            // common-first; the bar is a horizontal ScrollView so the
            // tail of the list scrolls off-screen and is reachable by
            // a swipe — the "+" button on the right still opens the
            // full EmojiPicker for anything not in this set. Could
            // later become an LRU persisted to prefs; static for v1.
            recentReactions: [
                '❤️','👍','😂','😮','😢','🙏',
                '🔥','👏','😍','😎','🤔','😴',
                '🥳','🤯','💯','✅','❌','🙌',
                '🤝','👀','😅','🤣','💪','🎉',
            ],
            // Whether the in-app EmojiPicker is currently displayed.
            // Driven by the smiley button in renderComposer.
            emojiPickerVisible: false,
            keyboardVisible: false,
            // Pixels by which the IME visibly overlaps our window —
            // computed in _keyboardDidShow as max(0, windowBottom -
            // keyboardTop). Used as paddingBottom on the chat
            // container on Android API 34+ where adjustResize and
            // KeyboardSpacer are unreliable. Reset to 0 on hide.
            keyboardOverlap: 0,
            keyboardHeight: 0,
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
		    // Media-grid bulk-delete state. Each grid (image,
		    // video) tracks its own selection so switching the
		    // filter chip doesn't carry checkmarks across, but the
		    // confirmation modal is shared — pendingDeleteIds /
		    // pendingDeleteKind capture the snapshot the modal
		    // operates on, populated when the action-bar Delete is
		    // tapped, cleared on Cancel or after a confirmed
		    // delete. remoteDeleteMedia mirrors the "also delete
		    // remotely" toggle the existing Delete-files modal
		    // has.
		    imageGridSelected: [],
		    videoGridSelected: [],
		    showDeleteMediaModal: false,
		    pendingDeleteIds: [],
		    pendingDeleteKind: 'video', // 'image' | 'video'
		    remoteDeleteMedia: false,
			focusedMessages: null,  // array of currently rendered messages in focus mode
			prevMessages: [],        // older messages before the focused message
			nextMessages: [],        // newer messages after the focused message
			focusedMessageId: null,  // the message ID currently in focus
			loadedMinIndex: null,      // lowest index loaded in focusedMessages
		    loadedMaxIndex: null,      // highest index loaded in focusedMessages
		    playRecording: this.props.playRecording,
		    audioRecordingStatus: {},
		    // Pseudo-VU levels for the call-recording bubble while it's
		    // playing back. Driven by _audioBubbleVuInterval at ~10 Hz;
		    // see _startAudioBubbleVuTicker. Currently synthetic (random
		    // walk smoothed) — swap to real per-100ms peaks pulled from
		    // message.metadata.peaks once that pipeline lands.
		    audioBubbleVu: { local: 0, remote: 0 },
		    // While the user is dragging the slider on a call-recording
		    // bubble we mirror the live drag percentage here so the
		    // two waveforms (Remote / Local) re-render with their
		    // played/unplayed boundary tracking the slider needle in
		    // real time. Without this they'd stay frozen at the
		    // pre-drag position until release. Cleared in
		    // seekAudioMessage and on left-edge auto-commit.
		    // Shape: { transferId, pct } | null
		    audioBubbleScrub: null,
		    callHistoryUrl: this.props.callHistoryUrl,
		    isAudioRecording: this.props.isAudioRecording,
		    recordingFile: this.props.recordingFile,
		    insets: this.props.insets,
		    composerHeight: 48,
		    replyContainerHeight: 0,
		    appState: this.props.appState,
		    allContacts: this.props.allContacts,
		    // Which contact source the search/list filters against.
		    // 'sylk' = the Sylk contacts in this.state.allContacts,
		    // 'ab'   = the address-book entries in this.state.contacts.
		    // The toggle in the search bar (URIInput) drives this prop.
		    contactSource: this.props.contactSource || 'sylk',
		    groupOfImage: {}, // in what groups does an image appear
		    imageGroups: {}, // in which group is an image present
		    selectedImages: [],
		    selectedImagesSearch: [],
		    thumbnailGridSize: {},
		    sharingAssets: [],
            sharingMessages: [],
            showScrollSideButtons: false,
            actionSheetDisplayed: false,
            // Location-bubble fullscreen viewer. When set to a message
            // object, a modal renders the same LocationBubble at full
            // window size, hiding the chat list behind it. Mirrors the
            // expandedImage / ImageViewer modal pattern below — enter
            // via the bubble's kebab → "Full screen", exit by tapping
            // the close button or via Android back. Lifted onto the
            // parent app's setFullScreen() so the surrounding navbar /
            // status chrome also collapses, matching the image viewer.
            fullScreenLocation: null,
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

        // Stop any in-progress recording playback whenever a call is
        // about to start (incoming OR outgoing) so audio doesn't contend
        // with the ringtone or the call itself.
        this.callStartingListener = DeviceEventEmitter.addListener(
            'SylkCallStarting',
            (payload) => {
                try {
                    if (this.currentAudioMessage || (this.state.audioRecordingStatus
                            && 'position' in this.state.audioRecordingStatus)) {
                        utils.timestampedLog('[applog] [audio] stopping playback because a call is starting',
                            payload && payload.direction);
                        this.stopAudioPlayer();
                    }
                } catch (e) { /* swallow — never block call handling */ }
            }
        );

        this.ended = false;
    }

    componentWillUnmount() {
        this.keyboardDidShowListener.remove();
        this.keyboardDidHideListener.remove();
        if (this.callStartingListener) {
            this.callStartingListener.remove();
            this.callStartingListener = null;
        }

        // Tear down the bubble VU ticker so the interval doesn't keep
        // firing setState on an unmounted component.
        if (this._audioBubbleVuInterval) {
            clearInterval(this._audioBubbleVuInterval);
            this._audioBubbleVuInterval = null;
        }

        this.ended = true;
    }

	  handleBubbleLayout = (id, event) => {
		const width = event.nativeEvent.layout.width;
		this.setState(prev => ({
		  bubbleWidths: { ...prev.bubbleWidths, [id]: width },
		}));
	  };
  
    backPressed() {
        // Intercept the Android hardware back button when one of our
        // in-app overlays is up — the user expects "back" to close the
        // overlay, not navigate out of the chat. Returning true tells
        // BackHandler we've handled the event; returning falsy lets
        // the default navigation behaviour proceed.
        //
        // Order matters: EmojiPicker checked first because it can
        // sit on top of the reaction bar (the "+" overflow path opens
        // the picker AFTER closing the bar). If a future flow ever
        // has both open simultaneously, closing the picker first is
        // the right user model.
        if (this.state.emojiPickerVisible) {
            this.closeEmojiPicker();
            // Also clear any pending reaction target so a stale "+"
            // open doesn't route the next emoji selection to a
            // target the user has visually dismissed.
            this._pendingReactionTarget = null;
            return true;
        }
        if (this.state.reactionTarget) {
            this.dismissReactionBar();
            return true;
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        // [audio-debug] CWRP props.messages-changed log — DISABLED.
        // Re-enable to confirm whether App.setState({messages}) is
        // reaching ContactsListBox during playback (frozen-bubble
        // diagnosis).

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
					   allContacts: nextProps.allContacts,
					   contactSource: nextProps.contactSource || 'sylk'
					});

        if (nextProps.isTyping) {
            setTimeout(() => {
                this.setState({isTyping: false});
            }, 3000);
        }
    }

    _keyboardDidShow(e) {
        // Compute the actual visible overlap between the IME's KEY
        // surface and our window. Two candidates:
        //
        //   rawOverlap = windowBottom - keyboardTop  (winH - screenY)
        //   rawHeight  = e.endCoordinates.height     (the keyboard's own height)
        //
        // On a normal cover-display layout these match. On the Razr
        // inner display in edge-to-edge mode the window extends down
        // through the gesture-nav bar, so `winH - screenY` is larger
        // than the keyboard's actual height by the gesture-bar
        // height (~48dp on this device — what produced the previous
        // "hovering up by 20px" / "hovering up by ~48px" reports).
        // Safe-area's bottom inset reports 0 in edge-to-edge mode so
        // we can't subtract it directly; instead we clamp overlap to
        // the keyboard's own height — we never need to compensate
        // for more than the keyboard itself is.
        //
        //   overlap = min(rawOverlap, rawHeight)
        //
        // When adjustResize fully shrunk the window rawOverlap is 0
        // (keyboardTop ≥ windowBottom) and the clamp is a no-op.
        const winH = Dimensions.get('window').height;
        const screenY = e && e.endCoordinates && typeof e.endCoordinates.screenY === 'number'
            ? e.endCoordinates.screenY
            : null;
        const rawHeight = e && e.endCoordinates ? Math.round(e.endCoordinates.height) : 0;
        const rawOverlap = (screenY !== null && winH > screenY)
            ? Math.round(winH - screenY)
            : 0;
        const overlap = Math.max(0, Math.min(rawOverlap, rawHeight));
        // Per-show diagnostic — uncomment to debug overlap math.
        // console.log('[keyboardFix] keyboardDidShow',
        //     'rawHeight=', rawHeight,
        //     'screenY=', screenY,
        //     'windowHeight=', Math.round(winH),
        //     'rawOverlap=', rawOverlap,
        //     '→ overlap=', overlap);
        this.setState({
            keyboardVisible: true,
            keyboardHeight: rawHeight,
            keyboardOverlap: overlap,
        });
    }

    _keyboardDidHide() {
        this.setState({
            keyboardVisible: false,
            keyboardHeight: 0,
            keyboardOverlap: 0,
            replyingTo: null,
        });
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

    // --- In-app emoji picker integration ---
    //
    // The composer text + onTextChanged callback only exist inside the
    // GiftedChat-supplied `composerProps`, which is passed to
    // renderComposer on each render. We stash the latest pair on `this`
    // (instance, not state — no need to trigger a re-render just to
    // remember a callback) so handleEmojiSelected can append to the
    // current text and push it back into GiftedChat.
    _composerText = '';
    _composerOnTextChanged = null;

    toggleEmojiPicker = () => {
        // Toggle behavior: while the picker is up, tapping the
        // (now-keyboard-icon) button closes the picker AND brings up
        // the system keyboard, since the affordance reads as "switch
        // back to typing". Just flipping the state would only collapse
        // the picker — we explicitly focus the TextInput so the IME
        // re-opens. When opening the picker we dismiss the keyboard
        // first so the two surfaces don't briefly fight for the same
        // vertical real estate on Android.
        if (this.state.emojiPickerVisible) {
            this.setState({ emojiPickerVisible: false }, () => {
                if (this.textInputRef && typeof this.textInputRef.focus === 'function') {
                    this.textInputRef.focus();
                }
            });
        } else {
            Keyboard.dismiss();
            this.setState({ emojiPickerVisible: true });
        }
    };

    closeEmojiPicker = () => {
        if (this.state.emojiPickerVisible) {
            this.setState({ emojiPickerVisible: false });
        }
    };

    handleEmojiSelected = (emoji) => {
        // ReactionBar "+" path: the picker was opened by
        // openReactionPicker() with a stashed target. Send the chosen
        // emoji as a reply to that target and close the picker — a
        // reaction is one-shot, unlike composer-append which stays
        // open for multi-pick.
        if (this._pendingReactionTarget) {
            const target = this._pendingReactionTarget;
            this._pendingReactionTarget = null;
            this.setState({ emojiPickerVisible: false });
            this.quickReact(target, emoji);
            return;
        }

        // Append to the current composer text. Picker stays open
        // (we don't call closeEmojiPicker here) so the user can pick
        // several emoji in a row without re-opening.
        if (typeof this._composerOnTextChanged === 'function') {
            const next = (this._composerText || '') + emoji;
            this._composerText = next;
            this._composerOnTextChanged(next);
        }
    };

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
		  replyTargetId={(this.state.reactionTarget && this.state.reactionTarget._id)
		      || (this.state.replyingTo && this.state.replyingTo._id)
		      || null}
		  // When the reaction bar is open (or composer is in reply
		  // mode), dim every bubble EXCEPT the target. Computed
		  // here so the prop is plain-boolean and easy for the
		  // memo comparator to watch.
		  isDimmedByReplyTarget={!!(
		      (this.state.reactionTarget || this.state.replyingTo)
		      && (
		          (this.state.reactionTarget && this.state.reactionTarget._id)
		              !== (props.currentMessage && props.currentMessage._id)
		          && (this.state.replyingTo && this.state.replyingTo._id)
		              !== (props.currentMessage && props.currentMessage._id)
		      )
		  )}
		  imageGroups={this.state.imageGroups}
		  groupOfImage={this.state.groupOfImage}
		  thumbnailGridSize={this.state.thumbnailGridSize}
		  // Plumb selectedImages into the bubble so the memo comparator
		  // in ChatBubble can detect grouped-image selection changes.
		  // Without this, renderMessageImage (a stable method ref) was
		  // re-evaluated only when one of the comparator's tracked
		  // props changed, so the ThumbnailGrid stayed mounted with a
		  // stale selectedIds prop and the checkbox tick never updated
		  // — even though state.selectedImages was changing correctly.
		  selectedImages={this.state.selectedImages}
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

	  // Whether the LEFT actions slot has anything to show. Only the
	  // image-preview delete and the mid-recording pause/delete need
	  // a left button; the idle "empty composer" case has nothing
	  // there now (mic moved to the right). When this is false we
	  // pass renderActions={null} so GiftedChat's InputToolbar
	  // collapses the left slot entirely — otherwise it reserves a
	  // ~44px gutter even for an empty View, which leaves blank
	  // space to the left of the smiley.
	  const hasLeftAction =
	    !replyingTo &&
	    (this.state.sharingMessages.length > 0 ||
	      this.state.isAudioRecording ||
	      !!this.state.recordingFile);

	  return (
		<InputToolbar
		  {...props}
		  containerStyle={[styles.inputToolbar, inputToolbarExtraStyles]} // full width
		  renderActions={hasLeftAction ? this.renderCustomActions : null} // left buttons
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
	
		  {/* Smiley button + Real TextInput.
		      Flex row layout: smiley sits flush on the LEFT of the
		      text field (WhatsApp / Telegram pattern — the emoji
		      affordance reads as a left-side input mode toggle, with
		      the right side reserved for send / mic). TextInput keeps
		      its original styling (just adds flex: 1) so wrapping /
		      multiline behavior is unchanged. */}
		  {/* Stash the latest text + onChange callback on `this` so
		      handleEmojiSelected can push appended text back into
		      GiftedChat from outside this render closure. Re-runs
		      every render, which is what we want — it always points
		      at the most recent composerProps. */}
		  {(() => { this._composerText = composerProps.text; this._composerOnTextChanged = composerProps.onTextChanged; return null; })()}
		  <View
			onLayout={this.onComposerLayout}
			style={{
			  flexDirection: 'row',
			  alignItems: 'center',
			  alignSelf: 'stretch',
			}}
		  >
			{/* Smiley button — toggles the in-app EmojiPicker on/off.
			    The icon switches to a "keyboard" glyph while the
			    picker is open so the affordance reads as "go back to
			    typing", matching what tapping it will do. Disabled
			    while audio recording / image preview to match the
			    TextInput's `editable` state.

			    height: 44 matches `chatLeftActionsContainer` (the
			    style used for the left-actions slot) so the smiley's
			    box is the same vertical extent as the TextInput's
			    iOS-padded row. Without an explicit height the icon's
			    intrinsic 36px box was shorter than the TextInput's
			    44px on iOS — alignItems:'center' on the row centers
			    each child individually, so the icon ended up
			    visually lower than the right-side mic/send (which
			    sit at the toolbar's true baseline). With matched
			    heights, both halves of the composer share the same
			    box and align cleanly on iOS and Android. */}
			{/* Smiley is hidden entirely during audio recording or
			    while the recording-preview is on screen — there's
			    nothing to type into during those phases (composer is
			    `editable={false}`) and the picker would just take up
			    the whole sheet under a non-functional toggle. The
			    earlier render kept the icon disabled+dimmed; users
			    read that as a broken control rather than a contextual
			    hide, so collapse it to null in those states. */}
			{(this.state.isAudioRecording || !!this.state.recordingFile) ? null : (
			<TouchableOpacity
			  onPress={this.toggleEmojiPicker}
			  style={{
				width: 40,
				height: 44,
				justifyContent: 'center',
				alignItems: 'center',
			  }}
			  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
			>
			  <Icon
			    name={this.state.emojiPickerVisible ? 'keyboard-outline' : 'emoticon-happy-outline'}
			    size={24}
			    color="#666"
			  />
			</TouchableOpacity>
			)}
			<TextInput
			  ref={(r) => (this.textInputRef = r)}
			  editable={!this.state.isAudioRecording && !this.state.recordingFile}
			  style={{
				flex: 1,
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
			  // Tapping the field means the user wants to type — bring
			  // up the keyboard, hide the emoji picker. Without this
			  // the keyboard would open ON TOP of the still-visible
			  // picker and they'd briefly stack.
			  onFocus={this.closeEmojiPicker}
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

		// WhatsApp-style send/mic swap:
		//  * Composer has text (or replying)  → render the send arrow.
		//    The send arrow is the GiftedChat <Send> child, so tapping
		//    it dispatches the same onSend pipeline as before.
		//  * Composer is empty (idle)         → render a microphone in
		//    the same slot. Tapping it kicks off audio recording via
		//    this.props.recordAudio (the same handler the old left
		//    button used). NOT wrapped in <Send> because we don't
		//    want a stray tap to send an empty message — the mic is
		//    its own action.
		// Active recording + recordingFile cases are handled by the
		// earlier branches at the top of renderSend.
		const showSendArrow = this.state.texting || !!this.state.replyingTo;
		const showMic = !showSendArrow && !this.state.isAudioRecording && !this.state.recordingFile;
		const sendColor = this.state.texting ? '#2196F3' : 'gray';

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
					// Reverted to the original `camera` glyph. This
					// chat-composer button captures a SNAPSHOT for
					// the message (still photo), not a video clip,
					// so the stills-camera icon matches the action.
					// Earlier swaps to `camera-outline` and
					// `video-outline` were attempts to address the
					// "+ in the lens" concern, but that concern
					// only applied to the `video-plus` glyph
					// elsewhere (AudioCallBox add-video button) —
					// the plain `camera` here renders without the
					// reticle dot at 20 px and was the right icon
					// all along.
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

			  {showSendArrow && (
				<Icon
				  type="font-awesome"
				  name="send"
				  style={styles.chatSendArrow}
				  size={20}
				  color={sendColor}
				/>
			  )}

			  {showMic && (
				<TouchableOpacity onPress={this.props.recordAudio}>
				  <Icon
					type="font-awesome"
					name="microphone"
					style={styles.chatSendArrow}
					size={22}
					color="green"
				  />
				</TouchableOpacity>
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
			subject: 'Blink shared message',
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

	/** Start the synthetic VU-meter ticker that drives the call-recording
	 *  bubble's stereo meter pair while a clip is playing. Runs at 10 Hz
	 *  and writes a smoothed random walk into `audioBubbleVu`. The
	 *  bubble subscribes to that state via render().
	 *
	 *  This is deliberately synthetic for now — `react-native-audio-
	 *  recorder-player` doesn't expose playback amplitude. To turn it
	 *  into a *real* VU meter, have SylkCallRecorder.java track per-
	 *  100ms peak per channel during writerLoop, ship the resulting
	 *  pair of arrays in message.metadata.peaks, and replace the random
	 *  draw below with `peaks.local[idx]` / `peaks.remote[idx]` where
	 *  idx is derived from the current playback position. The smoothing
	 *  envelope can stay either way — softens any granularity. */
	_startAudioBubbleVuTicker() {
		if (this._audioBubbleVuInterval) return;
		this._audioBubbleVuInterval = setInterval(() => {
			if (this.ended) return;
			// Speech-like envelope: bias each channel below 0.5, with
			// occasional bursts. Conversation alternation handled by a
			// slow-moving balance term that biases one side at a time
			// (so visually it feels like turn-taking rather than both
			// parties shouting simultaneously).
			const t = Date.now() / 1000;
			const balance = Math.sin(t * 0.45);              // -1..+1 over ~14s
			const drawL = Math.random() * (balance > 0 ? 0.35 : 0.85);
			const drawR = Math.random() * (balance > 0 ? 0.85 : 0.35);
			const prev = this.state.audioBubbleVu || { local: 0, remote: 0 };
			// Same fast-attack / slow-release smoothing the live call
			// meter uses — feels consistent across the two surfaces.
			const smooth = (s, raw) => raw > s ? raw : (s * 0.75 + raw * 0.25);
			const next = {
				local : smooth(prev.local,  drawL),
				remote: smooth(prev.remote, drawR),
			};
			if (Math.abs(next.local - prev.local) > 0.01
			 || Math.abs(next.remote - prev.remote) > 0.01) {
				this.setState({ audioBubbleVu: next });
			}
		}, 100);
	}

	/** Stop the synthetic VU ticker and zero the levels so the bubble
	 *  meters collapse the moment playback ends. Idempotent. */
	_stopAudioBubbleVuTicker() {
		if (this._audioBubbleVuInterval) {
			clearInterval(this._audioBubbleVuInterval);
			this._audioBubbleVuInterval = null;
		}
		const prev = this.state.audioBubbleVu;
		if (prev && (prev.local !== 0 || prev.remote !== 0)) {
			this.setState({ audioBubbleVu: { local: 0, remote: 0 } });
		}
	}

	async startAudioPlayer(message) {
		const id = message._id;

		// Support-log line for playback start. Greppable as [applog]
		// ... [audio] start ...; useful when chasing "I tapped play
		// but nothing happened" reports.
		try {
			const _md = (message && message.metadata) || {};
			const _kind = _md.call_recording === true ? 'call_recording' : 'voice_msg';
			utils.timestampedLog('[audio] start', _kind,
				'_id=', message._id,
				'tid=', _md.transfer_id,
				'audio=', message.audio,
				'direction=', message.direction);
		} catch (_e) {}

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

		// Kick off the bubble VU-meter ticker only for call recordings
		// that DON'T have real peaks shipped with them. When peaks are
		// present the meter is driven directly from the playback
		// listener (positionMs → peaks index) so a synthetic ticker
		// would just be wasted setState churn.
		const _md = message.metadata || {};
		const _hasPeaks = _md.peaks
		    && Array.isArray(_md.peaks.l)
		    && Array.isArray(_md.peaks.r)
		    && _md.peaks.l.length > 0;
		if (_md.call_recording === true && !_hasPeaks) {
			this._startAudioBubbleVuTicker();
		}

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
						  positionMs: Math.floor(seekPosition),
						  durationMs: duration,
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
						  // positionMs lets the bubble VU meter index
						  // peaks at native 100ms granularity instead
						  // of being quantised to whole-percent jumps.
						  positionMs: current,
						  durationMs: duration,
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
						  positionMs: current,
						  durationMs: duration,
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
		// Mirror onto message.position too so the slider's progress prop
		// (which the bubble reads via currentMessage.position) reflects
		// the released-to value on the very next render — without this
		// the slider visually snaps back to the pre-drag position for
		// one frame while updateFileTransferMetadata's parent setState
		// propagates.
		message.position = pct;
		this.props.updateFileTransferMetadata(message.metadata, 'position', pct);
		// Drag committed — clear the scrub state so the waveforms fall
		// back to reading currentMessage.position (which is now pct).
		if (this.state.audioBubbleScrub) {
			this.setState({ audioBubbleScrub: null });
		}
	}

	/** Called by AudioProgressSlider via onSeekChange every move event
	 *  while the user is dragging. Mirrors the live drag percentage
	 *  into audioBubbleScrub so the bubble's two waveforms re-render
	 *  with their played/unplayed boundary tracking the slider needle
	 *  in real time. Skipped for non-call-recording bubbles.
	 *
	 *  We ALSO mutate the target message's `position` field and rebuild
	 *  the renderMessages array with a fresh reference for that one
	 *  message — and a fresh array reference overall. This is what
	 *  actually drives the bubble re-render: GiftedChat's MessageContainer
	 *  is a PureComponent and the underlying FlatList only flushes its
	 *  cached row elements when the message item it caches changes
	 *  identity. extraData on listViewProps isn't enough on its own
	 *  here. Mutating .position is fine because it's not persisted
	 *  until seekAudioMessage runs on release.
	 */
	onAudioBubbleScrubChange(message, percentage) {
		const md = message && message.metadata;
		if (!md || md.call_recording !== true) return;
		const tid = md.transfer_id;
		if (!tid) return;
		const pct = Math.max(0, Math.min(100, Math.round(percentage)));
		const prev = this.state.audioBubbleScrub;
		if (prev && prev.transferId === tid && prev.pct === pct) return;
		// Clone the target message in renderMessages with fresh refs
		// (top-level + .metadata) so FlatList's row cache invalidates
		// for THIS bubble specifically; other rows keep their refs and
		// don't re-render.
		const oldRender = this.state.renderMessages || [];
		let touched = false;
		const newRender = oldRender.map((m) => {
			if (!m || !m.metadata || m.metadata.transfer_id !== tid) return m;
			touched = true;
			return {
				...m,
				position: pct,
				metadata: { ...m.metadata, position: pct },
			};
		});
		const stateUpdate = { audioBubbleScrub: { transferId: tid, pct } };
		if (touched) stateUpdate.renderMessages = newRender;
		this.setState(stateUpdate);
	}
	
    async stopAudioPlayer() {
		// Support-log line for playback stop. Greppable as [applog]
		// ... [audio] stop ...; pairs with the [audio] start line so a
		// playback session shows up as a clean start/stop pair in the
		// support log.
		try {
			const _stMd = (this.state.audioRecordingStatus && this.state.audioRecordingStatus.metadata) || {};
			const _msg = this.currentAudioMessage || {};
			const _kind = (_stMd.call_recording === true) ? 'call_recording' : 'voice_msg';
			utils.timestampedLog('[audio] stop', _kind,
				'_id=', _msg._id,
				'tid=', _stMd.transfer_id,
				'pos=', this.state.audioRecordingStatus && this.state.audioRecordingStatus.position);
		} catch (_e) {}

		// On Android the player is audioRecorderPlayer. On iOS we drive
		// the hidden <Video audioOnly> via state — calling stopPlayer
		// there is a no-op (and removePlayBackListener too), but we
		// always tear down both so a stale handle from a previous
		// platform/session can't keep emitting.
		try { audioRecorderPlayer.stopPlayer(); } catch (e) { /* ignore */ }
		try { audioRecorderPlayer.removePlayBackListener(); } catch (e) { /* ignore */ }
		// Tear down the bubble VU ticker and zero the meters — the
		// instant playback ends, the bars collapse cleanly.
		this._stopAudioBubbleVuTicker();

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
            defaultConferenceDomain={this.props.defaultConferenceDomain}
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
		// Close the emoji picker on send. Otherwise the picker stays
		// open after the message disappears from the composer, which
		// looks weird (the user is "done" with this message but the
		// picker is still occupying the bottom of the chat).
		if (this.state.emojiPickerVisible) {
			this.setState({ emojiPickerVisible: false });
		}
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
        // DECOMMISSIONED. Server call history is no longer fetched
        // standalone — it arrives as the call_history field of the
        // sylk_settings.phtml snapshot inside App.refreshAccountInfo
        // (with a 60s retry on failure). This method is kept as a
        // stub so callers (pull-to-refresh, the
        // refreshHistory-prop-change effect) compile, and it
        // delegates to App.refreshAccountInfo so the user-visible
        // "pull to reload" gesture still does something useful.
        this.setState({ isRefreshing: false });
        if (typeof this.props.refreshAccountInfo === 'function') {
            this.props.refreshAccountInfo().catch(() => {});
        }
        return;

        // Legacy DigestAuthRequest path retained below for reference.
        // The early return above prevents any of it from executing.
        // eslint-disable-next-line no-unreachable
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

	  // Theme-aware palette for the audio bubble's inner content. The
	  // bubble wrapper itself (ChatBubble.js) is transparent in Night
	  // mode and white in Day mode; the label + slider colors below
	  // flip in lock-step so the controls stay readable on whichever
	  // surface the wrapper exposes.
	  const _audioTheme = DarkModeManager.getTheme();
	  const audioFgColor          = _audioTheme.isDark ? '#FFFFFF' : '#111B21';
	  const audioSliderColor      = _audioTheme.isDark ? '#ffffff' : '#4572A6';
	  const audioSliderUnfilled   = _audioTheme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(69,114,166,0.25)';
	  const audioSliderKnob       = _audioTheme.isDark ? '#ffffff' : '#4572A6';
	  // Caption tint for the "Remote" / "Local" sub-labels under each
	  // waveform strip. AudioWaveform's default is a 55%-alpha white
	  // (only legible on dark surfaces), so we override with a low-alpha
	  // dark grey in Day mode to keep that "secondary caption" feel
	  // against the white bubble.
	  const audioWaveformLabel    = _audioTheme.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(17,27,33,0.55)';

	  // Load duration if not already loaded
	  if (currentMessage.audio && !audioDurations[currentMessage._id]) {
		this.getAudioDuration(currentMessage.audio, currentMessage._id);
	  }

	  // [audio-debug] Render-time snapshot — DISABLED. Re-enable when
	  // diagnosing playback UI issues (play↔pause toggle stuck, slider
	  // not advancing, isCurrent mismatch). Logs kind, transfer_id,
	  // audio path, msg.playing, status.tid + status.pos, isCurrent.

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

	  // Bubble VU meter source. When the recording's metadata carries
	  // real per-100ms peaks (computed by SylkCallRecorder during the
	  // writer loop and shipped via file_transfer.peaks), the meter is
	  // a pure function of playback position — so it can stay visible
	  // and track scrubs in real time even while paused. Without peaks
	  // we fall back to the synthetic ticker (only active during
	  // actual playback, since there's no position-→-level mapping).
	  let bubbleVu = { local: 0, remote: 0 };
	  const peaksMeta = currentMessage.metadata && currentMessage.metadata.peaks;
	  const haveRealPeaks = peaksMeta
	      && Array.isArray(peaksMeta.l)
	      && Array.isArray(peaksMeta.r)
	      && peaksMeta.l.length > 0;
	  if (haveRealPeaks) {
	      // Position priority: live playback tick > saved %.
	      // Always exact-index lookup — the meter shows the actual
	      // amplitude at the current position, both during playback
	      // (10 Hz from positionMs) and at rest (saved percent). Pause
	      // = stopped at saved position, so the bars freeze at exactly
	      // peaks[idx] for that position. No windowing — the user
	      // wants the value at the index, not a regional max.
	      const lenL = peaksMeta.l.length;
	      const lenR = peaksMeta.r.length;
	      let frac = 0;
	      if (isCurrent
	              && isPlaying
	              && typeof status?.positionMs === 'number'
	              && typeof status?.durationMs === 'number'
	              && status.durationMs > 0) {
	          frac = status.positionMs / status.durationMs;
	      } else {
	          frac = (position || 0) / 100;
	      }
	      if (frac < 0) frac = 0;
	      if (frac > 1) frac = 1;
	      const idxL = Math.min(lenL - 1, Math.floor(frac * lenL));
	      const idxR = Math.min(lenR - 1, Math.floor(frac * lenR));
	      bubbleVu = {
	          local : (peaksMeta.l[idxL] || 0) / 255,
	          remote: (peaksMeta.r[idxR] || 0) / 255,
	      };
	  } else if (isCurrent && isPlaying) {
	      // No peaks → synthetic ticker drives the bars.
	      bubbleVu = this.state.audioBubbleVu || bubbleVu;
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
			// Pin the play button to the bottom of the bubble row so
			// it sits at the same vertical level as the slider (the
			// last element in the label/waveforms/slider column).
			// Without this, the row's alignItems: 'center' would
			// vertically centre the button against the whole stack
			// and the button would float well above the slider it
			// controls.
			{ marginTop: 0, alignSelf: 'flex-end' },
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
				{ marginBottom: 2, marginTop: 0, alignSelf: isIncoming ? 'flex-start' : 'flex-end', color: audioFgColor },
				labelPadding,
			  ]}
			  numberOfLines={1}
			>
			  {durationLabel}
			</Text>
			{/* Two separate amplitude waveforms — Remote on top, Local
			    underneath — each rendered as bars-from-baseline so
			    the user can read each side of the conversation
			    independently. VU meters live on the in-call screen
			    only; in the bubble we let the static peaks tell the
			    story instead. If metadata.peaks is missing, each
			    AudioWaveform draws a flat dim baseline so you can
			    tell it's the data that's missing (not the layout).
			    progress prefers the live scrub value when this bubble
			    is being dragged so the waveforms' played/unplayed
			    boundary tracks the slider needle in real time. */}
			{(() => {
			    const md = currentMessage.metadata;
			    if (!md) return null;
			    // Render the waveforms whenever the message carries
			    // peaks data, regardless of whether it was tagged as
			    // a call_recording. This means a forwarded recording
			    // (which has the call_recording flag stripped on the
			    // sender's side so it ships as a regular file
			    // transfer) still draws the same Remote/Local waves
			    // on the recipient's bubble — they see the same
			    // audio shape the original sender sees.
			    const hasL = md.peaks
			        && Array.isArray(md.peaks.l)
			        && md.peaks.l.length > 0;
			    const hasR = md.peaks
			        && Array.isArray(md.peaks.r)
			        && md.peaks.r.length > 0;
			    if (!hasL && !hasR) return null;
			    const sc = this.state.audioBubbleScrub;
			    const isScrubbingThis = !!(sc && sc.transferId === md.transfer_id);
			    const wfProgress = isScrubbingThis ? sc.pct : position;
			    // Voice-memo case: only the local mic was captured
			    // (peaks.r is empty), so render a single channel
			    // without the "Local" label — it's not a multi-leg
			    // call where the label adds meaning.
			    const stereo = hasL && hasR;
			    return (
			        <React.Fragment>
			            {hasR ? (
			                <AudioWaveform
			                    peaks={md.peaks}
			                    progress={wfProgress}
			                    width={sliderWidth}
			                    height={28}
			                    barCount={60}
			                    channel="r"
			                    label={stereo ? 'Remote' : null}
			                    labelColor={audioWaveformLabel}
			                    playedColor="#3498db"
			                    unplayedColor="rgba(52, 152, 219, 0.25)"
			                />
			            ) : null}
			            {hasL ? (
			                <AudioWaveform
			                    peaks={md.peaks}
			                    progress={wfProgress}
			                    width={sliderWidth}
			                    height={28}
			                    barCount={60}
			                    channel="l"
			                    label={stereo ? 'Local' : null}
			                    labelColor={audioWaveformLabel}
			                    playedColor="#2ecc71"
			                    unplayedColor="rgba(46, 204, 113, 0.25)"
			                />
			            ) : null}
			        </React.Fragment>
			    );
			})()}
			{/* Slider sits at the bottom of the bubble — under the
			    waveform and the two VU meters — so the visual stack
			    reads top-down as: label → recording shape → live
			    levels → playback control. Same width/edge alignment
			    as the elements above, so the column stays flush. */}
			<AudioProgressSlider
			  progress={position}
			  width={sliderWidth}
			  height={4}
			  knobWidth={6}
			  knobHeight={20}
			  color={audioSliderColor}
			  unfilledColor={audioSliderUnfilled}
			  knobColor={audioSliderKnob}
			  onSeekStart={() => this.pauseAudioForScrub(currentMessage)}
			  onSeek={(pct) => this.seekAudioMessage(currentMessage, pct)}
			  onSeekChange={(pct) => this.onAudioBubbleScrubChange(currentMessage, pct)}
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
			// ThumbnailGrid enters controlled-selection mode whenever
			// onSelectionChange is provided — `selectedIds` then becomes
			// the single source of truth (see isControlled in
			// ThumbnailGrid.js). Without this prop, `selected` inside
			// the grid is permanently [], so every tap recomputes
			// newSelected from an empty array and the parent only ever
			// receives a single-item selection. Wire both props so the
			// grid sees the current selection and multi-select works.
			selectedIds={this.state.selectedImages}
			onSelectionChange = {this.thumbnailSelectionChanged}
			// In the grouped-images bubble the primary action on a
			// tile is "view the photo full-screen", not "add to
			// selection". tapAlwaysOpens=true suppresses
			// ThumbnailGrid's photo-picker shortcut (where tapping a
			// tile while anything is selected toggles selection),
			// and we omit onItemPress so taps fall through to the
			// built-in openViewer (zoom viewer). The corner checkbox
			// remains the only path into multi-select — same
			// thumbnailSelectionChanged handler it wired before. The
			// media-gallery grid keeps the photo-picker behaviour
			// because it doesn't pass tapAlwaysOpens.
			tapAlwaysOpens={true}
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
		  // Tap on the image body opens the quick-reaction bar
		  // (same gesture as text bubbles). The dedicated
		  // "fullscreen" IconButton in the bubble footer remains
		  // the explicit path to view the image full size —
		  // see the IconButton with icon="fullscreen" below,
		  // which still routes to onImagePress directly.
		  onPress={() => this.onMessagePress(null, currentMessage)}
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
			  // Transparent so the bubble's own backgroundColor
			  // (green for incoming, white for outgoing) shows in
			  // the letterbox area when the image's aspect ratio
			  // doesn't fill the bubble's content width. Previously
			  // this was '#000' "to avoid white edges during
			  // rotation", which produced black bars extending
			  // left/right of every image bubble in the chat —
			  // very noticeable on portrait images in a wider
			  // bubble. If rotation-edge artefacts come back, we
			  // can switch this to a rotation-aware background
			  // (only solid during active rotation gesture).
			  backgroundColor: 'transparent',
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

    /** Mirrors the read-only branches in the chatInputClass picker
     *  below (~ line 7261). Used to gate UI affordances that only
     *  make sense when the user can actually post — currently the
     *  floating ReactionBar (tapping a message bubble must NOT
     *  surface an emoji picker when there's no input toolbar to
     *  send the reaction through). Returns true when any of:
     *    • no local private key is loaded (encryption gate),
     *    • we have a selected contact AND
     *        - it's a videoconference room (the room's chat lives
     *          in ConferenceBox; from the contacts side it's a
     *          read-only history view),
     *        - search-messages mode is active,
     *    • there is no selected contact and the chat panel is not
     *      open at all.
     *  Keep this in lockstep with the chatInputClass picker below;
     *  any new "read-only" condition added there should also be
     *  added here. */
    _chatIsReadOnly() {
        const hasPrivateKey = !!(this.state.keys && this.state.keys.private);
        if (!hasPrivateKey) return true;
        if (this.state.selectedContact) {
            if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) return true;
            if (this.state.searchMessages) return true;
            return false;
        }
        if (!this.state.chat) return true;
        return false;
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

    // Support-log detection helper — used by the body-tap, the long-press
    // "Open" action, and the explicit pressFileBubble fallback below. Any
    // file_transfer whose filename matches one of these patterns is a
    // support log capture and should reopen in LogsModal, not FileViewer.
    _isSupportLogTransfer = (file_transfer) => {
        if (!file_transfer || !file_transfer.filename) return false;
        const fn = file_transfer.filename.replace(/\.asc$/, '');
        // Optional `-<username>` suffix added in the share path so support
        // can identify whose logs without opening the file. The username
        // slug is restricted to [a-zA-Z0-9._-] (sanitized at write time).
        return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-sylk-logs(-[\w.-]+)?\.txt$/.test(fn) // current YYYY-MM-DD_HH-MM-SS[-username]
            || /^\d{8}-\d{6}-sylk-logs(-[\w.-]+)?\.txt$/.test(fn)                         // legacy YYYYMMDD-HHMMSS[-username]
            || /^sylk-logs-[\w.\-:]+\.txt$/i.test(fn)
            || /^sylk-logs\.txt$/i.test(fn)
            || /sylk[_-]?logs?/i.test(fn);
    }

    _routeSupportLogTap = (file_transfer) => {
        // True if we routed to the LogsModal; false if the caller should
        // fall back to its normal behaviour.
        if (!this._isSupportLogTransfer(file_transfer)) return false;
        if (typeof this.props.openLogAttachment !== 'function') return false;
        let _path = file_transfer.local_url || '';
        // Strip a trailing .asc only if a sibling decrypted file exists —
        // we can't read PGP-armored bytes as plain text. If the file is
        // still encrypted with no decrypted twin, fall through and let
        // the normal flow trigger decryption first; the next tap will
        // reach this routing.
        if (_path.endsWith('.asc')) return false;
        if (!_path) return false;
        const _ownerUri = file_transfer.sender && file_transfer.sender.uri;
        console.log('[support-share] routing support-log tap to LogsModal',
            'filename=', file_transfer.filename,
            'path=', _path,
            'ownerUri=', _ownerUri);
        this.props.openLogAttachment(_path, _ownerUri);
        return true;
    }

    onMessagePress(context, message) {
        if (message.metadata && message.metadata.preview) {
			return;
        }

        //console.log('onMessagePress');

        // If the reaction bar is already open, a bubble tap dismisses
        // it. Same affordance as tapping outside a popup. To react to
        // a different message, the user dismisses (tap) and taps
        // again — keeps the interaction model simple and predictable.
        if (this.state.reactionTarget) {
            this.dismissReactionBar();
            return;
        }

        // Mirror the OS keyboard's "tap outside dismisses" behaviour
        // for the in-app EmojiPicker. RN's `keyboardShouldPersistTaps`
        // only handles the system IME; the picker is a regular View
        // and stays open unless we close it ourselves. Closing on
        // any bubble tap covers the common case; scrollBeginDrag
        // (wired in listViewProps) covers the swipe-to-scroll case.
        if (this.state.emojiPickerVisible) {
            this.closeEmojiPicker();
        }

        // Quick-reaction gestures. Apply to text bubbles AND image
        // bubbles — for images the dedicated "fullscreen" IconButton
        // is the explicit path to open the image full size, so the
        // bubble's body tap is free to react. Other file types
        // (PDFs, audio, generic attachments) keep their tap-to-open
        // behaviour so taps stay snappy on media.
        //
        //   • Double-tap → quickReact with the default emoji
        //     (recentReactions[0]). The first tap stamps _lastTap*; the
        //     second tap inside 320 ms detects double and fires.
        //   • Single tap → open the floating ReactionBar after a 320 ms
        //     delay (so a follow-up tap can still promote to double).
        //
        // The full contextual menu remains on long-press (untouched).
        const hasImage = !!message.image;
        const isPlainText = !(message.metadata && message.metadata.filename);
        const isReactable = isPlainText || hasImage;
        if (isReactable) {
            const now = Date.now();
            const isDouble = this._lastTapId === message._id
                && (now - (this._lastTapAt || 0)) < 320;
            this._lastTapAt = now;
            this._lastTapId = message._id;

            if (isDouble) {
                this._lastTapAt = 0;
                this._lastTapId = null;
                const defaultEmoji = (this.state.recentReactions
                    && this.state.recentReactions[0]) || '❤️';
                this.quickReact(message, defaultEmoji);
                return;
            }

            // Skip the floating ReactionBar entirely when the chat
            // is read-only. Same predicate (`_chatIsReadOnly`)
            // governs whether the bottom input toolbar is replaced
            // with the inert `noChatInputToolbar` / `noKeyInputToolbar`
            // variant a few hundred lines below, so the two surfaces
            // stay in lockstep: if the user can't send a message
            // they can't add a reaction either, and surfacing the
            // emoji bar implied an action that would silently fail.
            // Cases this catches:
            //   • no private key loaded (encryption gate)
            //   • viewing a videoconference room's chat history
            //     outside of an active conference (read-only — the
            //     real conference chat is in ConferenceBox)
            //   • searchMessages mode
            //   • no chat panel is open at all
            if (this._chatIsReadOnly()) {
                return;
            }

            // Defer the bar so the second half of a double-tap pre-empts
            // it. If by the time this fires the tap was promoted to a
            // double or the user tapped a different bubble, do nothing.
            setTimeout(() => {
                if (this._lastTapId === message._id
                    && this._lastTapAt
                    && Date.now() - this._lastTapAt >= 290) {
                    this.setState({ reactionTarget: message });
                }
            }, 320);
            return;
        }

        // Body taps now perform the natural action for the bubble type
        // (download / decrypt / open / play). The contextual action sheet
        // is reachable only through the bubble's kebab IconButton — the
        // wide-area "tap anywhere -> menu" behavior was confusing because
        // it competed with the body-tap default action and made it easy
        // to open the menu by accident while trying to start playback or
        // open a file.

        if (message.metadata && message.metadata.filename) {
            let file_transfer = message.metadata;
            // Earliest-possible support-log shortcut: if the filename
            // matches our YYYY-MM-DD_HH-MM-SS-sylk-logs.txt (or legacy
            // YYYYMMDD-HHMMSS / sylk-logs-*) pattern AND the local file is already
            // decrypted on disk, skip the rest of the open/decrypt
            // dance and route straight into the LogsModal. Only the
            // sender side hits this on first tap (their local copy is
            // plaintext); the receiver side hits it on the SECOND tap
            // (after decryption strips the .asc from local_url).
            if (this._routeSupportLogTap(file_transfer)) {
                return;
            }
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

        // Recognise our own support-log attachment filenames and reopen
        // the LogsModal pointing at the file's contents instead of
        // handing off to the OS file viewer. That way the user gets the
        // same filter pills, font controls and tag scanner they have
        // on the live log, but on a snapshot file. Strip a trailing
        // .asc on the bare filename too — encrypted attachments live
        // on disk as <name>.asc until the bubble decryption renames
        // them.
        //
        // Multiple patterns are accepted so logs sent by older app
        // versions still open inline:
        //   - YYYY-MM-DD_HH-MM-SS-sylk-logs[-<username>].txt (current format,
        //     username appended so support can identify the requester)
        //   - YYYYMMDD-HHMMSS-sylk-logs.txt     (previous format, still in chats)
        //   - sylk-logs-<ISO timestamp>.txt     (e.g. sylk-logs-2026-05-04T16-40-52-177Z.txt — pre-rename)
        //   - sylk-logs-*.txt / sylk-logs.txt   (catch-all for any other sylk-logs* variant)
        // Order matters only for clarity; any one matching is enough.
        const _filename = (file_transfer.filename || '').replace(/\.asc$/, '');
        const _supportLogPatterns = [
            /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-sylk-logs(-[\w.-]+)?\.txt$/, // YYYY-MM-DD_HH-MM-SS-sylk-logs[-username].txt (current)
            /^\d{8}-\d{6}-sylk-logs(-[\w.-]+)?\.txt$/,    // YYYYMMDD-HHMMSS-sylk-logs[-username].txt (legacy)
            /^sylk-logs-[\w.\-:]+\.txt$/i,     // legacy ISO-timestamp variant
            /^sylk-logs\.txt$/i,               // bare fallback name
            /sylk[_-]?logs?/i,                 // catch-all: any filename containing "sylk-logs", "sylk_logs", "sylklog", etc.
        ];
        const isSupportLog = _supportLogPatterns.some((re) => re.test(_filename));
        console.log('[support-share] openFile detection',
            'filename=', file_transfer.filename,
            '_filename=', _filename,
            'isSupportLog=', isSupportLog,
            'hasOpenLogAttachment=', typeof this.props.openLogAttachment === 'function');
        if (isSupportLog && typeof this.props.openLogAttachment === 'function') {
            // The "log owner" — whose device produced these logs — is
            // the file_transfer's sender. Pass it along so the modal
            // can show it as the subtitle. For an outgoing bubble
            // (user shared their own logs to support), this is the
            // user's own URI; for an incoming bubble (e.g. support
            // viewing a user's logs), it's the peer's URI.
            const ownerUri = file_transfer.sender && file_transfer.sender.uri;
            this.props.openLogAttachment(file_path, ownerUri);
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

        // Diagnostic dump for the "Meet me there..." parser. Logs
        // (a) the bubble's contentType so we know which branch the
        // long-press will take, (b) a 200-char snippet of the body
        // (text first, falling back to html), (c) the result of
        // parseSharedLocationUrl on that body. The most common reason
        // "Meet me there..." doesn't appear on a Google-Maps-link
        // message is that the body uses a URL shape we don't
        // recognise yet (e.g. shortened maps.app.goo.gl, or an
        // unusual query-param order). The snippet + parse result
        // gives us everything we need to extend the regex set in one
        // round-trip. APPLOG'd so it lands in the on-device log file
        // (Show logs / "Support needed…") rather than the dev console.
        try {
            const _bodyForParse = currentMessage.text || currentMessage.html || '';
            const _snippet = String(_bodyForParse).slice(0, 200);
            const _parsed = utils.parseSharedLocationUrl(_bodyForParse);
            // Also probe the broader extractLocationLink so we can
            // see when the short-URL recogniser kicks in even though
            // parseSharedLocationUrl returned null.
            const _link = utils.extractLocationLink(_bodyForParse);
            const _linkDesc = _link
                ? (_link.type === 'direct'
                    ? ('direct ' + _link.coords.latitude.toFixed(5) + ',' + _link.coords.longitude.toFixed(5))
                    : ('short ' + _link.url))
                : 'null';
            /*
            utils.timestampedLog('[location] long-press diag —',
                'contentType=', currentMessage.contentType || '(none)',
                'parseResult=', _parsed
                    ? (_parsed.latitude.toFixed(5) + ',' + _parsed.longitude.toFixed(5))
                    : 'null',
                'extractLink=', _linkDesc,
                'canSend=', this.props.canSend && this.props.canSend(),
                'body[0..200]=', JSON.stringify(_snippet));
                */
        } catch (e) {
            console.log('[location] long-press diag failed',
                e && e.message ? e.message : e);
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
        // We show a "Show meeting request..." option only if the request
        // hasn't already been accepted on this device and hasn't expired —
        // the predicate is supplied by app.js as a prop. Tapping the
        // option re-opens the full Accept modal (destination preview +
        // privacy slider + disclosure) rather than accepting immediately;
        // the trailing ellipsis hints that further input is required.
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
                options.push('Show meeting request...');
                icons.push(<Icon name="handshake" size={20} />);
            }

            // "Meet me there..." — surfaces only on text-message bubbles
            // whose body contains a parseable Google Maps link (or geo:
            // URI). Tapping it opens ShareLocationModal pre-tuned to
            // the meet-up flow with the parsed coordinates as the
            // shared destination, so once the peer accepts, the meet
            // bubble shows all three pins (own / peer / destination).
            // Same code path the meet-up simulator uses, just driven
            // by an explicit user-supplied destination instead of an
            // ad-hoc midpoint.
            //
            // Gated on:
            //   • not a live-location bubble (those have their own
            //     destination semantics already)
            //   • currentMessage.text contains a parseable URL — falls
            //     out cleanly when the body is a regular chat message
            //     with no map link (parseSharedLocationUrl returns null)
            //   • the contact is share-able (hasn't been blocked etc.)
            //     — leverages the same canSend gate as Reply so we
            //     don't offer an action that can't fire.
            // extractLocationLink returns either {type: 'direct',
            // coords} or {type: 'short', url} (or null). Surface "Meet
            // me there..." for both — for a shortened URL we'll fetch
            // and resolve on tap (see the action handler below). This
            // keeps the menu reactive (no async work in render) while
            // still working for `maps.app.goo.gl/<id>` links that need
            // a network round-trip to expand.
            const _meetLink = !isLiveLocation
                ? utils.extractLocationLink(currentMessage.text || currentMessage.html || '')
                : null;
            if (_meetLink
                    && this.props.canSend
                    && this.props.canSend()) {
                options.push('Meet me there...');
                icons.push(<Icon name="map-marker-account" size={20} />);
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

            // Live-location bubbles get a "Share location" entry that
            // mirrors the inline share-variant icon under the slider:
            // it pops the system Share sheet with a 📍 pin at the
            // bubble's latest known coords. The inline icon already
            // covers "share whichever scrubbed point I'm looking at",
            // but a kebab entry is the standard way to discover the
            // action without first scrolling/exploring the slider —
            // matches "Copy / Delete / Cancel" muscle memory for any
            // other message type.
            if (isLiveLocation) {
                const _v = currentMessage.metadata && currentMessage.metadata.value;
                if (_v
                        && typeof _v.latitude === 'number'
                        && typeof _v.longitude === 'number') {
                    options.push('Share location');
                    icons.push(<Icon name="share-variant" size={20} />);
                }

                // Full screen viewer. Mirrors the image bubble's
                // "open expanded" affordance: hides the rest of the
                // chat list and renders the same map at window size
                // so the user can read street-level detail. Available
                // on every live-location bubble — same gate as
                // Share location (must have valid coords; the modal
                // would otherwise show "Locating…").
                if (_v
                        && typeof _v.latitude === 'number'
                        && typeof _v.longitude === 'number') {
                    options.push('Full screen');
                    icons.push(<Icon name="fullscreen" size={20} />);
                }
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

            // Pin / Unpin is now also offered for live-location
            // bubbles. Pinning the bubble of a long share is a
            // common ask — "I want to come back to that trip later"
            // — and the existing pin path doesn't care about the
            // payload type. The metadata.error guard still applies
            // (don't pin a failed bubble).
            if (currentMessage.pinned) {
                options.push('Unpin');
                icons.push(<Icon name="pin-off" size={20} />);
            } else {
                if (!currentMessage.metadata || !currentMessage.metadata.error) {
                    options.push('Pin');
                    icons.push(<Icon name="pin" size={20} />);
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
                } else if (action === 'Show meeting request...') {
                    // Open the FULL Accept modal (destination preview,
                    // privacy slider, disclosure, "Do not show this
                    // again" checkbox) rather than accepting the
                    // request directly. The modal's own Accept button
                    // routes through `acceptMeetingRequest` with the
                    // user's chosen privacy radius. Without this
                    // re-direction, kebab acceptance would skip the
                    // slider entirely and the user would have no way
                    // to pick a privacy radius after dismissing the
                    // initial auto-popped modal.
                    console.log('[meeting] kebab: Show meeting request tapped — opening modal',
                        'fromUri=', meetingFromUri,
                        'requestId=', meetingReqId,
                        'expiresAt=', meetingExpiresAt,
                        'hasPromptHandler=', typeof this.props.promptMeetingRequest === 'function',
                        'hasAcceptHandler=', typeof this.props.acceptMeetingRequest === 'function');
                    this.setState({actionSheetDisplayed: false});
                    if (typeof this.props.promptMeetingRequest === 'function') {
                        this.props.promptMeetingRequest({
                            fromUri: meetingFromUri,
                            requestId: meetingReqId,
                            expiresAt: meetingExpiresAt,
                        });
                    } else if (typeof this.props.acceptMeetingRequest === 'function') {
                        // Fallback for older app.js builds that don't
                        // expose promptMeetingRequest. Accept directly
                        // with no slider — same behaviour as before
                        // the modal-route change.
                        this.props.acceptMeetingRequest({
                            fromUri: meetingFromUri,
                            requestId: meetingReqId,
                            expiresAt: meetingExpiresAt,
                        });
                    } else {
                        console.warn('[meeting] kebab: no acceptance handler wired');
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
                } else if (action === 'Share location') {
                    // Mirror of the inline share-variant icon under
                    // the trail slider: open the system Share sheet
                    // with a 📍 + Google Maps URL pointing at the
                    // bubble's latest known coords. Listed BEFORE the
                    // action.startsWith('Share') prefix match below so
                    // it takes priority — otherwise the file/media
                    // share path (handleShare) would swallow it.
                    //
                    // Uses the existing react-native-share import
                    // (`Share.open({...})`) rather than the core
                    // react-native `Share.share` so we don't shadow
                    // the file/image share path that already uses it
                    // — same library handles both surfaces.
                    const _md = currentMessage.metadata || {};
                    const _v = _md.value || {};
                    const _lat = _v.latitude;
                    const _lng = _v.longitude;
                    if (typeof _lat === 'number' && typeof _lng === 'number') {
                        const _ts = _v.timestamp || _md.timestamp || null;
                        let _when = '';
                        if (_ts) {
                            try {
                                _when = new Date(_ts).toLocaleString();
                            } catch (e) {
                                _when = new Date(_ts).toISOString();
                            }
                        }
                        const _url = `https://maps.google.com/?q=${_lat},${_lng}`;
                        const _msg = _when
                            ? `📍 Position on ${_when}\n${_url}`
                            : `📍 Position\n${_url}`;
                        Share.open({
                            title: 'Share location',
                            message: _msg,
                        }).catch((err) => {
                            const m = err && err.message ? err.message : '';
                            // react-native-share rejects with this when
                            // the user dismisses the sheet — not a
                            // failure, just noise.
                            if (m.indexOf('did not share') === -1) {
                                console.log('[location] kebab share failed', m || err);
                            }
                        });
                    } else {
                        console.log('[location] kebab share: no coords on bubble',
                            currentMessage._id);
                    }
                } else if (action === 'Meet me there...') {
                    // Hand the LINK descriptor (not yet-resolved coords)
                    // to NavigationBar.meetMeAt — it opens the share
                    // panel immediately and resolves any short URL in
                    // the background while the user is picking a
                    // duration. Avoids an awkward "tap → silence →
                    // panel pops" gap on slow networks.
                    const _link = utils.extractLocationLink(
                        currentMessage.text || currentMessage.html || '');
                    this.setState({actionSheetDisplayed: false});
                    if (!_link || typeof this.props.meetMeAt !== 'function') {
                        console.log('[location] kebab: Meet me there — no link or no handler',
                            'hasLink=', !!_link,
                            'hasHandler=', typeof this.props.meetMeAt === 'function');
                    } else {
                        utils.timestampedLog('[location] kebab: Meet me there →',
                            _link.type, _link.type === 'direct'
                                ? (_link.coords.latitude.toFixed(5) + ',' + _link.coords.longitude.toFixed(5))
                                : _link.url);
                        this.props.meetMeAt(this.state.targetUri, _link);
                    }
                } else if (action === 'Full screen') {
                    // Open the location bubble in a full-screen modal.
                    // Mirrors the image-bubble fullscreen pattern below
                    // (expandedImage + ImageViewer modal): we hide the
                    // surrounding chrome via the parent app's
                    // setFullScreen() and stash the message id so the
                    // modal at the bottom of render() materialises a
                    // maximised LocationBubble for it. Exit re-enables
                    // chrome and clears the state. Logged so a future
                    // "stuck in fullscreen" report has a breadcrumb.
                    console.log('[location] kebab: Full screen tapped',
                        'bubble=', currentMessage._id);
                    this.setState({actionSheetDisplayed: false});
                    if (typeof this.props.setFullScreen === 'function') {
                        this.props.setFullScreen(true);
                    }
                    this.setState({fullScreenLocation: currentMessage});
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
                    // Support-log shortcut: same filename detection as
                    // openFile() above, applied to the long-press
                    // contextual-menu "Open" action so that path also
                    // routes into the LogsModal instead of the OS file
                    // picker.
                    const _meta = currentMessage.metadata || {};
                    const _filename = (_meta.filename || '').replace(/\.asc$/, '');
                    const _isSupportLog =
                        /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-sylk-logs(-[\w.-]+)?\.txt$/.test(_filename)
                        || /^\d{8}-\d{6}-sylk-logs(-[\w.-]+)?\.txt$/.test(_filename)
                        || /^sylk-logs-[\w.\-:]+\.txt$/i.test(_filename)
                        || /^sylk-logs\.txt$/i.test(_filename)
                        || /sylk[_-]?logs?[_-]/i.test(_filename);
                    if (_isSupportLog && typeof this.props.openLogAttachment === 'function') {
                        let _path = _meta.local_url || '';
                        if (_path.endsWith('.asc')) _path = _path.slice(0, -4);
                        const _ownerUri = _meta.sender && _meta.sender.uri;
                        this.props.openLogAttachment(_path, _ownerUri);
                        return;
                    }
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
        // Live-location bubbles are lazy-rendered: renderMessageText
        // returns a lightweight placeholder until the bubble's _id has
        // been recorded in the sticky renderedMessageIds set (which
        // gets the id added the first time onViewableItemsChanged
        // sees it). gifted-chat's Message.shouldComponentUpdate only
        // watches currentMessage fields, so the placeholder → real
        // map swap needs an explicit trigger here.
        // We detect the FIRST-TIME-SEEN transition (false → true) on
        // renderedMessageIds rather than every visibleMessageIds flip
        // — once a bubble has been seen it stays seen, and the render
        // output stops changing, so there's no point in spending a
        // re-render every time the user scrolls it back into view.
        // renderedMessageIds is a Set; we forward it as a prop on
        // GiftedChat so both `props` and `nextProps` carry the
        // current-and-prior reference for .has() comparison.
        const cm = (nextProps && nextProps.currentMessage) || (props && props.currentMessage);
        if (cm && cm.contentType === 'application/sylk-live-location') {
            const id = cm._id;
            const prevSeen = !!(props && props.renderedMessageIds
                && props.renderedMessageIds.has
                && props.renderedMessageIds.has(id));
            const nextSeen = !!(nextProps && nextProps.renderedMessageIds
                && nextProps.renderedMessageIds.has
                && nextProps.renderedMessageIds.has(id));
            if (prevSeen !== nextSeen) {
                return true;
            }
        }

        // Audio bubbles: always re-render. Playback state
        // (playing/position/consumed) flips every tick on the
        // currently-playing bubble, but gifted-chat's `props` and
        // `nextProps` here can both already point at the same new
        // message reference by the time this hook runs — meaning
        // any prev/next field comparison evaluates to "no change"
        // and the play↔pause icon stays frozen. Returning true
        // unconditionally forces gifted-chat's Message to re-render
        // on every parent update; the cost is small (audio bubbles
        // are rare in a chat) and React's reconciliation skips
        // any DOM/native diff if the resulting JSX is identical.
        const cmAny = (nextProps && nextProps.currentMessage) || (props && props.currentMessage);
        if (cmAny && cmAny.audio) {
            return true;
        }

        // Reply mapping landed (or changed) for this message. The
        // componentDidUpdate handler that reacts to messagesMetadata
        // changes stamps `replyId` onto the message in renderMessages
        // when a reply metadata-message arrives. gifted-chat's
        // Message.shouldComponentUpdate doesn't watch replyId, so
        // without this hook the bubble that was just sent as a
        // reaction (quickReact) re-renders WITHOUT the reply preview
        // — it draws as a plain-text bubble misaligned to one side
        // until the chat is reloaded, at which point the freshly
        // mounted bubble sees replyId in its initial props and
        // takes the with-preview branch. Forcing a re-render the
        // moment replyId appears (or changes) keeps the in-flight
        // reaction glued under its parent immediately.
        const prevMsg = props && props.currentMessage;
        const nextMsg = nextProps && nextProps.currentMessage;
        if (prevMsg && nextMsg && prevMsg.replyId !== nextMsg.replyId) {
            return true;
        }

        // Video bubbles: re-render when the thumbnail for this id
        // newly lands in state.videoMetaCache. renderMessageVideo
        // generates the thumbnail on first render of a downloaded
        // video, then commits the path via setState({video-
        // MetaCache:…}). The currentMessage object handed to
        // gifted-chat doesn't change (the path is stashed in this
        // component's state, not on the message), so without this
        // hook the bubble stays on the placeholder thumb until the
        // user navigates away from the chat and back — at which
        // point the bubble remounts and reads videoMetaCache from
        // scratch. Detect the prev=no-thumbnail → next=has-thumbnail
        // transition for this specific message id and force a
        // single re-render. videoMetaCache is forwarded as a prop
        // on GiftedChat (see the messages={…} call site below) so
        // both props and nextProps carry it.
        if (nextMsg && nextMsg.video) {
            const vid = nextMsg._id;
            const prevCache = (props && props.videoMetaCache) || {};
            const nextCache = (nextProps && nextProps.videoMetaCache) || {};
            const prevThumb = prevCache[vid] && prevCache[vid].thumbnail;
            const nextThumb = nextCache[vid] && nextCache[vid].thumbnail;
            if (prevThumb !== nextThumb) {
                return true;
            }
        }

        // Reply-targeting mode flipped — every visible bubble has to
        // re-render so its opacity (isDimmedByReplyTarget) and orange
        // outline can update. Detected by comparing the current
        // target id against `_previousReactionTargetId`, which
        // componentDidUpdate refreshes after every
        // reactionTarget / replyingTo state commit. Returning true
        // for ALL bubbles on transition is a deliberate full pass —
        // bounded by visible-row count (~20), and individual
        // ChatBubble memos still skip bubbles whose dim/highlight
        // flags didn't actually change.
        const currentTargetId = (this.state.reactionTarget && this.state.reactionTarget._id)
            || (this.state.replyingTo && this.state.replyingTo._id)
            || null;
        const previousTargetId = this._previousReactionTargetId || null;
        if (currentTargetId !== previousTargetId) {
            return true;
        }

        return false;
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
      // Notify the parent app whenever the reaction bar opens or
      // closes. app.js uses this to hide the top NavigationBar
      // (call buttons + menu) while the reaction overlay is up —
      // the dimmed chat reads better when the brightly-lit nav
      // above isn't competing for attention. Done here (rather
      // than inside each setState that touches reactionTarget)
      // so every transition path — single-tap open, send-and-
      // clear, picker open, outside-tap dismiss, hardware back,
      // navbar back via selectedContact change — funnels through
      // one place.
      if (prevState.reactionTarget !== this.state.reactionTarget) {
          if (typeof this.props.setChatReactionMode === 'function') {
              this.props.setChatReactionMode(!!this.state.reactionTarget);
          }
          // (Previously scrolled the targeted bubble to a position
          // just above the floating ReactionBar so users would see
          // it as the anchor. That worked but felt like animation
          // theatre; replaced with the more direct "hide everything
          // else" approach in the visibleMessages filter below —
          // when reactionTarget is set the messages list is
          // collapsed to ONLY that message, so there's nothing to
          // dim or scroll past. No further action needed here on
          // the reactionTarget transition.)
      }

      // Dismiss the reaction bar whenever the chat we're showing
      // changes — that catches both "user pressed back on the top
      // NavigationBar" (selectedContact → null) and "user opened a
      // different conversation" (selectedContact → other). The
      // hardware back button is wired separately in
      // backPressed(); this hook is the equivalent for any
      // navigation-style transition.
      const prevSelectedId = prevState.selectedContact && prevState.selectedContact.uri;
      const nextSelectedId = this.state.selectedContact && this.state.selectedContact.uri;
      if (prevSelectedId !== nextSelectedId && this.state.reactionTarget) {
          this.setState({ reactionTarget: null });
      }

      // Track the previously-highlighted reply target so the next
      // shouldUpdateMessage cycle can redraw it (to drop the orange
      // outline) even when state.reactionTarget / state.replyingTo
      // has already become null. Refresh AFTER the render that
      // committed the highlight, so the new value reflects what
      // the user currently sees on screen.
      this._previousReactionTargetId =
          (this.state.reactionTarget && this.state.reactionTarget._id)
          || (this.state.replyingTo && this.state.replyingTo._id)
          || null;

      // External scroll trigger. App.js bumps `chatScrollTrigger`
      // when an outgoing event (e.g. user just confirmed a Meet me
      // there share) wants the chat view to scroll to the latest
      // bubble, regardless of the user's current scroll offset.
      // We compare against prevProps so a re-render with the same
      // counter doesn't re-fire the scroll.
      if (typeof this.props.chatScrollTrigger === 'number'
              && this.props.chatScrollTrigger !== prevProps.chatScrollTrigger) {
          // Defer one tick so the new bubble has actually been
          // committed to the FlatList before we ask it to scroll.
          setTimeout(() => {
              try { this.scrollToBottom && this.scrollToBottom(); }
              catch (e) { /* silent — scroll is best-effort */ }
          }, 0);
      }

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

	  // Grid-mode thumbnail generation. renderMessageVideo only
	  // generates a thumbnail when the video BUBBLE renders — that
	  // happens in the normal chat view but NOT when we've swapped
	  // the chat for the video grid (showVideoGrid hides showChat /
	  // showReadonlyChat). So a download finishing while the user
	  // is on the grid would leave the tile black forever: the
	  // bubble never runs, videoMetaCache never gets the entry,
	  // shouldUpdateMessage's thumbnail hook never fires.
	  //
	  // Fix: when renderMessages or transferProgress changes AND
	  // we're showing the video grid, scan for video messages that
	  // are now downloaded (msg.video populated) but lack both an
	  // inline thumbnail AND a videoMetaCache entry. Kick off the
	  // same createThumbnail pipeline renderMessageVideo uses; the
	  // resulting setState populates videoMetaCache and the grid
	  // tile picks up the preview on the next render.
	  if (this.showVideoGrid
	      && (prevState.renderMessages !== this.state.renderMessages
	          || prevState.transferProgress !== this.state.transferProgress)) {
	    try {
	      const _cache = this.state.videoMetaCache || {};
	      const _msgs = this.state.renderMessages || [];
	      for (const msg of _msgs) {
	        if (!msg || !msg.video) continue;
	        const id = msg._id;
	        if (msg.thumbnail) continue;
	        if (id in _cache) continue; // already generating or done
	        // Mark as in-flight before kicking off the async work so a
	        // second CDU pass during the same tick doesn't double-fire.
	        // Direct mutation matches the pattern in renderMessageVideo.
	        this.state.videoMetaCache[id] = { loading: true };
	        const uri = msg.video;
	        const onOk = (path, w, h) => {
	          this.setState(prev => ({
	            videoMetaCache: {
	              ...prev.videoMetaCache,
	              [id]: { thumbnail: path, width: w || 512, height: h || 512 },
	            },
	          }));
	          if (typeof this.props.updateFileTransferMetadata === 'function') {
	            this.props.updateFileTransferMetadata(msg.metadata, 'thumbnail', path);
	          }
	        };
	        const onErr = (err) => {
	          // Drop the in-flight marker so a later retry has a
	          // chance. Don't log noisily — videos with unusual
	          // codecs can fail thumbnail extraction without it
	          // being a real bug.
	          this.setState(prev => {
	            const { [id]: _, ...rest } = prev.videoMetaCache;
	            return { videoMetaCache: rest };
	          });
	        };
	        if (Platform.OS === 'android') {
	          createThumbnailSafe({ url: uri, timeMs: 1000 })
	            .then(path => onOk(path, 512, 512))
	            .catch(onErr);
	        } else {
	          createThumbnail({ url: uri, timeStamp: 1000 })
	            .then(({ path, width, height }) => onOk(path, width, height))
	            .catch(onErr);
	        }
	      }
	    } catch (e) {
	      console.log('grid-thumb scan failed:', e && e.message);
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
					// the kebab's "Show meeting request..." option
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
					// Bump `metadata` to a fresh reference when stamping
					// replyId so gifted-chat's Message.shouldComponentUpdate
					// (which watches `next.metadata != current.metadata`)
					// fires unconditionally. Our shouldUpdateMessage hook
					// already detects replyId changes, but this belt-and-
					// suspenders trigger guarantees the bubble repaints into
					// its "with reply preview" branch the instant the
					// metadata lands — without it, a freshly-sent reaction
					// emoji bubble can hold its plain-bubble layout until
					// the chat is reopened, even though replyId is stamped.
					const replyMetaBump = newReplyId !== undefined
						? { ...(msg.metadata || {}), _replyStamp: newReplyId }
						: msg.metadata;

					return {
						...msg,
						text: newLabel || msg.text,
						rotation: newRotation !== undefined ? newRotation : msg.value,
						replyId: newReplyId !== undefined ? newReplyId : msg.value,
						metadata: replyMetaBump,
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

	   if (prevState.searchString !== this.state.searchString || prevState.renderMessages != this.state.renderMessages || prevState.orderBy != this.state.orderBy || prevState.messagesCategoryFilter !== this.state.messagesCategoryFilter || prevState.sortOrder !== this.state.sortOrder) {

			let filteredMessages = this.state.renderMessages;

			const mediaLabels = this.mediaLabels;
			const mediaRotations = this.mediaRotations;

		    if (this.state.orderBy === 'size') {
		        // "Sort by size" is the file-grid path: it strips
		        // everything that doesn't have a filesize so the grid
		        // (used by the dedicated media surfaces) only renders
		        // file-transfer rows. That filter wipes out location
		        // bubbles though — they're metadata messages with no
		        // filename — so when the user is explicitly filtered
		        // to Locations we must keep them visible regardless
		        // of the sort axis. The size toggle becomes a visual
		        // affordance only in that case (locations keep their
		        // chronological order, since "size" isn't meaningful
		        // for a tick stream); the filter intent — "show me my
		        // location bubbles" — wins.
		        if (this.state.messagesCategoryFilter !== 'location') {
					filteredMessages = filteredMessages.filter(
					  message => message.metadata && message.metadata.filename
					);
				}
			}

			// Category-aware visibility for live-location bubbles.
			// Two complementary cases keep the chat surface honest:
			//
			//   • Locations filter active → keep ONLY location bubbles.
			//     The SQL slice is already location-only, but the
			//     merge / journal paths can reintroduce non-location
			//     messages (system notes, announcements, the
			//     locationAnnouncement text bubble we emit at share
			//     start). A targeted JS filter pins the chat strictly
			//     to "show me my location messages, nothing else".
			//
			//   • A different category filter active (image / video /
			//     audio / other / text / pinned) → EXCLUDE location
			//     bubbles. Locations otherwise leak into those views
			//     because they're metadata-bearing rows that pass the
			//     generic SQL gate (e.g. user picks Video and sees
			//     their location bubbles intermixed with video rows).
			//     Locations are explicitly opt-in: they're only
			//     visible under the Locations filter or with no
			//     filter active.
			//
			// Null (no filter) is the chat-default: every message
			// type renders, including locations — that's the
			// natural mixed timeline the user sees on chat open.
			const _catFilter = this.state.messagesCategoryFilter;
			if (_catFilter === 'location') {
				filteredMessages = filteredMessages.filter(
				  message => message
				    && message.contentType === 'application/sylk-live-location'
				);
			} else if (_catFilter) {
				filteredMessages = filteredMessages.filter(
				  message => !message
				    || message.contentType !== 'application/sylk-live-location'
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

		  // Apply asc/desc sort. The merge in CWRP already ships
		  // renderMessages in DESC order (newest at index 0), which under
		  // GiftedChat's `inverted={true}` renders newest at the bottom —
		  // the historical "default chat" order, equivalent to the
		  // 'desc' sortOrder. Toggling 'asc' flips the array so the
		  // inverted list places newest at the TOP and oldest at the
		  // bottom. The chat list previously ignored sortOrder entirely;
		  // this change is what makes the up-arrow / down-arrow icons
		  // affect the timeline (and crucially the new Locations
		  // filter, which prompted the bug report — without sortOrder
		  // applied, location bubbles never reordered no matter how
		  // many times the toggle was tapped).
		  // Tie-break on _id so messages sharing a millisecond
		  // (e.g. a fresh outgoing message and its local echo) keep a
		  // stable order across re-renders.
		  const _ts = (v) => {
		    if (v == null) return 0;
		    if (v instanceof Date) return v.getTime();
		    if (typeof v === 'number') return v;
		    const t = new Date(v).getTime();
		    return isNaN(t) ? 0 : t;
		  };
		  const _orderMul = this.state.sortOrder === 'asc' ? 1 : -1;
		  filteredMessages = [...filteredMessages].sort((a, b) => {
		    const ta = _ts(a.createdAt);
		    const tb = _ts(b.createdAt);
		    if (ta !== tb) return (ta - tb) * _orderMul;
		    const ia = String(a._id || '');
		    const ib = String(b._id || '');
		    if (ia < ib) return -1 * _orderMul;
		    if (ia > ib) return  1 * _orderMul;
		    return 0;
		  });

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

	// One-tap reaction: send `emoji` as a reply to `target`. Mirrors what
	// the user does manually after long-press → Reply → typing the emoji
	// → Send. We:
	//   1. Set replyingTo so onSendMessage emits the reply-metadata.
	//   2. After the setState commits, hand a GiftedChat-shape message
	//      ({_id, text, createdAt}) to onSendMessage. That existing path
	//      handles encryption, the metadata send, and the actual message
	//      send, and then resets replyingTo: null itself (see line ~2430).
	// Also closes the floating ReactionBar.
	quickReact = (target, emoji) => {
	  if (!target || !emoji) return;
	  if (!this.state.selectedContact || !this.state.selectedContact.uri) return;
	  this.setState({ replyingTo: target, reactionTarget: null }, () => {
		const id = uuid.v4();
		this.onSendMessage([{
		  _id: id,
		  key: id,
		  text: emoji,
		  createdAt: new Date(),
		  // Empty user object so gifted-chat's MessageContainer can
		  // compute position correctly. Its line is
		  //   position: item.user._id === user._id ? 'right' : 'left'
		  // and the chat-level `user` prop defaults to {} (we don't
		  // pass it). Without item.user set here, accessing
		  // item.user._id throws and the bubble ends up left-aligned
		  // (treated as incoming) even though the reaction is
		  // outgoing — so the parent preview shows on the right but
		  // the emoji bubble is misaligned on the left. Mirroring
		  // gifted-chat's own _onSend wrapping behaviour here puts
		  // the reaction on the same alignment path as normal
		  // outgoing replies.
		  user: {},
		  // Sender-side flag picked up by buildLastMessage in app.js so
		  // a one-tap reaction doesn't overwrite the contacts-list
		  // preview with the emoji — the user's previously-typed
		  // message stays visible. The flag rides in `metadata`, which
		  // is local-only for text/plain bodies (it isn't shipped to
		  // the receiver) and is persisted to SQL as JSON, so it
		  // survives an app restart and keeps doing its job when the
		  // contacts list is rebuilt from getMessages.
		  metadata: { isReaction: true },
		}]);
	  });
	};

	// Opens the existing EmojiPicker in "react" mode for the given
	// target. handleEmojiSelected detects this mode via
	// `_pendingReactionTarget` and routes the chosen emoji through
	// quickReact rather than appending to the composer text.
	openReactionPicker = (target) => {
	  this._pendingReactionTarget = target;
	  this.setState({ reactionTarget: null, emojiPickerVisible: true });
	};

	// Common dismiss path for the floating reaction bar — used by
	// outside-tap on the bar's transparent backdrop and by other
	// code paths that need to drop reaction-mode without sending.
	dismissReactionBar = () => {
	  this.setState({ reactionTarget: null });
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
            // Lazy render: opening a chat with many historical maps
            // would otherwise mount one LocationBubble per share —
            // each kicking off a 3x3 tile-grid fetch (FastImage),
            // SVG polyline overlay and pin layout — for ticks the
            // user can't see yet. Gate the heavy bubble on the
            // viewability state already maintained for images:
            //   • visibleMessageIds — currently in the FlatList
            //     viewport (refreshed by onViewableItemsChanged).
            //   • renderedMessageIds — sticky once-seen set so a
            //     bubble that has scrolled off-screen stays mounted
            //     and we don't tear down + rebuild the map (which
            //     would re-fetch every tile and reset the user's
            //     zoom / scrub state).
            // Until either is true, render a same-sized placeholder
            // so the list doesn't reflow when the real bubble drops
            // in. The placeholder dimensions match the inline map
            // footprint (DEFAULT_MAP_WIDTH x DEFAULT_MAP_HEIGHT in
            // LocationBubble.js, 300 x 200).
            const _bubbleId = currentMessage._id;
            const _bubbleVisible = this.state.visibleMessageIds
                && this.state.visibleMessageIds.includes(_bubbleId);
            const _bubbleSeen = this.state.renderedMessageIds
                && this.state.renderedMessageIds.has(_bubbleId);
            if (!_bubbleVisible && !_bubbleSeen) {
                return (
                    <View
                        style={{
                            width: 300,
                            height: 200,
                            backgroundColor: '#e6e6e6',
                            borderRadius: 12,
                            margin: 6,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <ActivityIndicator size="small" color="#999" />
                    </View>
                );
            }
            const _latestRaw = this.locationData?.[currentMessage._id]
                || currentMessage.metadata;
            // Merge in local-only owner coords (set by app.js's
            // _setLocalOwnerCoordsForBubble for privacy-deferred
            // outgoing meet bubbles). Lives outside state.messages
            // so it survives the SQL-driven rebuild that fires on
            // chat-navigation. Without this merge, the bubble would
            // show value=destination on re-entry and read "<1m to
            // meeting point" because myCoords would haversine to 0.
            const _localOwn = this.props.localOwnerCoordsByMid
                && this.props.localOwnerCoordsByMid[currentMessage._id];
            let latest = (_localOwn
                    && typeof _localOwn.latitude === 'number'
                    && typeof _localOwn.longitude === 'number')
                ? {
                    ..._latestRaw,
                    localOwnerCoords: {
                        latitude: _localOwn.latitude,
                        longitude: _localOwn.longitude,
                    },
                    // Carry the local user's chosen privacy radius
                    // alongside the coords so LocationBubble can
                    // render the dashed ring around the local pin —
                    // for both INCOMING bubbles (accepter's view of
                    // the request bubble) and OUTGOING bubbles
                    // (requester's own meet bubble). The wire's
                    // privacyDeferredRadiusMeters is the OTHER
                    // party's radius in the incoming case, so we
                    // use a separate `localOwnerRadiusMeters`
                    // sourced only from this device's stamp.
                    localOwnerRadiusMeters:
                        (typeof _localOwn.radiusMeters === 'number'
                            && _localOwn.radiusMeters > 0)
                            ? _localOwn.radiusMeters : null,
                }
                : _latestRaw;
            // Multi-device mirror: when THIS device is a mirror (not
            // the broadcaster) AND the visible bubble is the OTHER
            // SIDE's accepter origin for a session WE initiated, the
            // bubble's natural rendering is "from peer's POV" — its
            // value=peer coords, peerCoords=us — which on A2 prints
            // colors swapped vs A1's view (red=peer instead of red=
            // us). Swap value↔peerCoords + flip the rendered
            // direction so the same bubble reads identically on
            // every device of ours: red=us, blue=peer, distance label
            // computed from us → peer. Only fires when a remote
            // share is active for this peer (otherwise we ARE the
            // broadcaster and the bubble's local origin renders
            // correctly without inversion). `activeRemoteSharesByUri`
            // is populated by app.js's mirror feed; absent / role!=
            // 'requester' → no inversion.
            const _peerUriForBubble = this.props.selectedContact
                && this.props.selectedContact.uri;
            const _remoteShare = (this.props.activeRemoteSharesByUri
                && _peerUriForBubble)
                ? this.props.activeRemoteSharesByUri[_peerUriForBubble]
                : null;
            const _viewerIsMirrorRequester = !!(_remoteShare
                && _remoteShare.role === 'requester'
                && currentMessage.direction === 'incoming'
                && latest && latest.in_reply_to);
            // `currentMessage` is const-bound from destructured props,
            // so we use a separate `_msgForBubble` reference for the
            // (potentially flipped) message handed to LocationBubble.
            // Original currentMessage stays untouched for any code
            // outside this if-branch.
            let _msgForBubble = currentMessage;
            if (_viewerIsMirrorRequester) {
                // Swap value (peer's coords) with peerCoords (our
                // coords as stamped by the mirror feed). LocationBubble
                // reads `value` for the "owner" pin and `peerCoords`
                // for the "peer" pin; after swap, owner=us, peer=peer.
                const _ourCoords = latest.peerCoords;
                const _peerCoords = latest.value;
                if (_ourCoords
                        && typeof _ourCoords.latitude === 'number'
                        && typeof _ourCoords.longitude === 'number') {
                    latest = {
                        ...latest,
                        value: _ourCoords,
                        peerCoords: _peerCoords,
                    };
                    // Flip rendered direction so the color/label code
                    // in LocationBubble (`isIncoming`) treats this as
                    // an outgoing-style bubble: red=ownerName (us),
                    // blue=peerName (peer). The underlying message in
                    // state.messages is untouched — only the props
                    // passed into LocationBubble are flipped.
                    _msgForBubble = {
                        ...currentMessage,
                        direction: 'outgoing',
                    };
                }
            }
            // Trail: the full ordered list of valid GPS fixes for this
            // share. Each tick lives as its own entry in
            // messagesMetadata[origin_id] (kept that way intentionally
            // — the runtime filter+append path was changed earlier in
            // this work to preserve the trail). We extract just the
            // {latitude, longitude, timestamp} triple, drop placeholder
            // / numeric-NaN entries, and sort ascending by tick time so
            // the polyline can be drawn oldest → newest (A → … → end).
            // Hand it down to LocationBubble; an empty / single-entry
            // trail is harmless — StaticMap falls back to a single pin.
            const _rawTrail = (this.state.messagesMetadata
                && this.state.messagesMetadata[currentMessage._id]) || [];
            const trail = [];
            for (const e of _rawTrail) {
                if (!e || e.action !== 'location') continue;
                const v = e.value;
                if (!v
                        || typeof v.latitude !== 'number'
                        || typeof v.longitude !== 'number') continue;
                const tsRaw = (v.timestamp != null) ? v.timestamp : e.timestamp;
                const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
                trail.push({
                    latitude: v.latitude,
                    longitude: v.longitude,
                    timestamp: ts,
                });
            }
            trail.sort((a, b) => a.timestamp - b.timestamp);
            // Render-time diagnostic for the "no path drawn" report.
            // Throttled by (bubbleId, rawTicks, validPoints) so we
            // don't spam metro.log on every memoised re-render of
            // the same state. Field signal: rawTicks vs validPoints
            // tells us whether ticks made it into messagesMetadata,
            // and whether they had real coords. validPoints < 2 →
            // StaticMap's hasTrail=false → no polyline drawn (by
            // design); validPoints >= 2 but still no polyline →
            // bug in StaticMap's render path.
            const _trailLogKey = currentMessage._id + ':'
                + _rawTrail.length + ':' + trail.length;
            if (this._lastTrailLogKey !== _trailLogKey) {
                this._lastTrailLogKey = _trailLogKey;
                const _first = trail[0];
                const _last = trail[trail.length - 1];
                /*
                console.log('[location] render trail',
                    'bubble=' + currentMessage._id,
                    'rawTicks=' + _rawTrail.length,
                    'validPoints=' + trail.length,
                    'first=' + (_first
                        ? _first.latitude.toFixed(5) + ',' + _first.longitude.toFixed(5)
                        : 'none'),
                    'last=' + (_last
                        ? _last.latitude.toFixed(5) + ',' + _last.longitude.toFixed(5)
                        : 'none'));
                        */
            }
            return (
                <LocationBubble
                    currentMessage={_msgForBubble}
                    metadata={latest}
                    trail={trail}
                    onLongPress={this.onLongMessagePress}
                    /* Inline fullscreen toggle handler — wired into
                       the new arrow-expand button below the Focus
                       button on inline maps. Same effect as the
                       kebab "Full screen" action: hide app chrome
                       via setFullScreen(true), then materialise the
                       fullscreen LocationBubble modal at the bottom
                       of render() by setting fullScreenLocation. */
                    onOpenFullScreen={() => {
                        if (typeof this.props.setFullScreen === 'function') {
                            this.props.setFullScreen(true);
                        }
                        this.setState({fullScreenLocation: currentMessage});
                    }}
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
			// The audio bubble's outer wrapper (ChatBubble.js) is
			// transparent in Night mode and white in Day mode, so the
			// kebab icon, the "Call recording" / "Audio" label, and
			// the cancel-transfer icon all need to flip alongside it.
			// White on transparent → white on dark surface (Night, fine);
			// white on white surface (Day) would make them invisible.
			const _audioTextTheme = DarkModeManager.getTheme();
			const _audioTextFg = _audioTextTheme.isDark ? 'white' : '#111B21';
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
							iconColor={_audioTextFg}
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
							color: _audioTextFg,
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
						  iconColor={_audioTextFg}
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
					customHTMLElementModels={customHTMLElementModels}
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
  
            // Wrap the file-icon + filename Text in a TouchableOpacity
            // explicitly. ParsedText (inside CustomMessageText) absorbs
            // taps on the text node on some platforms — the parent
            // GiftedChat onPress doesn't fire when the user taps
            // directly on the filename, only when they tap the
            // surrounding bubble margin. Routing through this
            // TouchableOpacity guarantees onMessagePress runs no
            // matter where inside the bubble content the user taps.
            // onLongPress forwards to the existing contextual menu.
            const _isFileBubble = !!(currentMessage.metadata && currentMessage.metadata.filename);

            // "Meet me there..." button rendered INSIDE the bubble,
            // beneath the message body. Same gating as the kebab
            // option:
            //   • text-bubble (no file/audio/video bubbles)
            //   • body resolves to a maps link via extractLocationLink
            //   • canSend is true and meetMeAt prop is wired
            // Tap dispatches the link descriptor to NavigationBar,
            // which opens the share panel immediately and resolves
            // shortened URLs in the background. Sized to be obviously
            // tappable — matches the "primary action" weight of the
            // text body itself rather than competing with the
            // timestamp footer.
            let _meetButton = null;
            if (!_isFileBubble
                    && currentMessage.text
                    && this.props.canSend
                    && this.props.canSend()) {
                const _link = utils.extractLocationLink(currentMessage.text || '');
                if (_link && typeof this.props.meetMeAt === 'function') {
                    const _onMeetPress = () => {
                        utils.timestampedLog('[location] inline button: Meet me there →',
                            _link.type, _link.type === 'direct'
                                ? (_link.coords.latitude.toFixed(5) + ',' + _link.coords.longitude.toFixed(5))
                                : _link.url);
                        this.props.meetMeAt(this.state.targetUri, _link);
                    };
                    // Match the share-location button in ReadyBox
                    // (purpleButton style: rgba(142,68,173,0.9)) so
                    // the visual language across "this is the
                    // location share entry-point" surfaces stays
                    // consistent. Same purple regardless of bubble
                    // direction — reads cleanly on both white
                    // (outgoing) and green (incoming) backgrounds and
                    // tells the user "this opens the share flow".
                    const _btnBg = 'rgba(142,68,173,0.9)';
                    const _btnFg = 'white';
                    _meetButton = (
                        <View style={{
                            flexDirection: 'row',
                            paddingHorizontal: 10,
                            paddingTop: 4,
                            paddingBottom: 6,
                        }}>
                            <TouchableOpacity
                                onPress={_onMeetPress}
                                accessibilityLabel="Meet me at the shared location"
                                hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    backgroundColor: _btnBg,
                                    borderRadius: 14,
                                    paddingHorizontal: 12,
                                    paddingVertical: 6,
                                }}
                            >
                                <Icon
                                    name="map-marker-account"
                                    size={16}
                                    color={_btnFg}
                                    style={{marginRight: 6}}
                                />
                                <Text style={{
                                    color: _btnFg,
                                    fontSize: 13,
                                    fontWeight: '600',
                                }}>
                                    Meet me there...
                                </Text>
                            </TouchableOpacity>
                        </View>
                    );
                }
            }

            const _innerContent = (
                <View>
                    <View style={[styles.messageTextContainer, extraStyles, { flexDirection: 'row', alignItems: 'center', marginLeft: 10}]}>
                         {_isFileBubble ?
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
                    {_meetButton}
                </View>
            );
            if (_isFileBubble) {
                return (
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => this.onMessagePress(null, currentMessage)}
                        onLongPress={() => this.onLongMessagePress(null, currentMessage)}
                    >
                        {_innerContent}
                    </TouchableOpacity>
                );
            }
            return _innerContent;
  		}
    };

	renderDay = (props) => {
	  const { currentMessage } = props;

	  // Don't render the day if the message is hidden
	  if (this.state.orderBy === 'size') return null;

	  // Theme-aware date separator. GiftedChat's default Day
	  // component renders the date in Color.defaultColor (mid-grey)
	  // with a transparent backdrop — that worked against the dark
	  // linen but reads poorly on the new light linen Day-mode
	  // background. We wrap each separator in a small contrast
	  // pill: dark-translucent fill + white text in Day, and a
	  // light-translucent fill + dark text in Night — same shape
	  // either way, just channel-flipped so the date pops off
	  // whichever linen pattern is behind it.
	  const _dayTheme = DarkModeManager.getTheme();
	  const _dayWrapperStyle = {
	      backgroundColor: _dayTheme.isDark
	          ? 'rgba(255,255,255,0.15)'
	          : 'rgba(0,0,0,0.45)',
	      paddingHorizontal: 10,
	      paddingVertical: 3,
	      borderRadius: 10,
	  };
	  const _dayTextStyle = {
	      color: '#FFFFFF',
	      fontSize: 12,
	      fontWeight: '600',
	  };
	  return <Day {...props} wrapperStyle={_dayWrapperStyle} textStyle={_dayTextStyle} />;
	};

	// Theme-aware chat system message. Same pill treatment as
	// the date separator above — a darker translucent fill in
	// Day mode (so the white text reads against the light linen)
	// and a lighter translucent fill in Night mode (so the same
	// white text floats against the dark linen). Without this
	// override, GiftedChat's default mid-grey "Color.defaultColor"
	// system-message text disappeared on the new light Day-mode
	// background.
	renderSystemMessage = (props) => {
	  const _smTheme = DarkModeManager.getTheme();
	  const _smIsDark = _smTheme.isDark;
	  // System messages render WITHOUT a pill — plain text, centered,
	  // sitting directly on the chat background. Per user request:
	  //   • Day mode → dark grey font on the light linen.
	  //   • Night mode → white font on the dark linen.
	  // The day-separator pill (see renderDay above) is unaffected;
	  // only the system-message bubble is removed.
	  const _smWrapperStyle = {
	      backgroundColor: 'transparent',
	      paddingHorizontal: 10,
	      paddingVertical: 4,
	      alignSelf: 'center',
	      maxWidth: '85%',
	  };
	  const _smTextStyle = {
	      color: _smIsDark ? '#FFFFFF' : '#444444',
	      fontSize: 12,
	      fontWeight: '400',
	      textAlign: 'center',
	  };
	  return (
	      <SystemMessage
	          {...props}
	          wrapperStyle={_smWrapperStyle}
	          textStyle={_smTextStyle}
	      />
	  );
	};

	renderTime = (props) => {
	  const { currentMessage, position } = props;

	  if (currentMessage.metadata?.preview) return null;

	  const isIncoming = currentMessage.direction === 'incoming';
	  const isMedia = currentMessage.video || currentMessage.audio;
	  // Footer colour (time + filesize + duration). Pulled from the
	  // active theme so it reads correctly against whichever bubble
	  // colour ChatBubble paints:
	  //   Night theme: incoming bubble = green → footer = white;
	  //                outgoing bubble = white → footer = black.
	  //   Day theme:  incoming bubble = white  → footer = #667781;
	  //               outgoing bubble = light blue → footer = #667781.
	  // Audio bubbles keep light footer text in Night (their wrapper
	  // is transparent over the dark chat backdrop) and switch to
	  // muted grey in Day. Without this lookup the incoming-side
	  // footer painted white-on-white in Day — that was the "still
	  // white" complaint.
	  const _themeForTime = DarkModeManager.getTheme();
	  let textColor;
	  if (_themeForTime.isDark) {
	      textColor = (currentMessage.audio || isIncoming) ? 'white' : 'black';
	  } else {
	      textColor = '#667781';
	  }
	  let textOpacity = 0.85;
	  // Reply-target dim mode: this bubble is one of the non-target
	  // bubbles (every bubble except the one the reaction bar is
	  // pointed at). The bubble body + bottom-container already
	  // paint a dark dim overlay over the bubble, but the timestamp
	  // text colour is set here per direction and stays bright
	  // white/black even on the dimmed surface. Drop it to a muted
	  // light grey so it fades into the dim instead of standing out.
	  const _dimTargetId = (this.state.reactionTarget && this.state.reactionTarget._id)
	      || (this.state.replyingTo && this.state.replyingTo._id)
	      || null;
	  if (_dimTargetId && currentMessage._id !== _dimTargetId) {
	      textColor = 'rgba(255,255,255,0.4)';
	      textOpacity = 1;
	  }
	  let hasFileSize = !!currentMessage.metadata?.filesize;

	  // Live-location bubbles: count the number of valid coordinate
	  // ticks we have in messagesMetadata for this session so the user
	  // can see how many updates have flowed (sent on outgoing, received
	  // on incoming) at a glance. Hidden on one-shot shares since there's
	  // always exactly one tick — the count would be noise. The label is
	  // appended to the LEFT of the timestamp regardless of direction
	  // (i.e. it sits at the bottom-left of the bubble's footer), in
	  // line with the requested "left of timestamp" placement.
	  //
	  // Floor of 1: if a live-location BUBBLE is on screen, at least one
	  // tick has been recorded — _injectLocationBubble only fires on a
	  // valid-coords origin tick, and that same tick is what populates
	  // the messagesMetadata trail. There's a sub-render-cycle window
	  // where _injectLocationBubble's setState has committed (so the
	  // bubble renders) but our local-state mirror of messagesMetadata
	  // hasn't yet synced via componentWillReceiveProps. Falling back to
	  // 1 means the user sees "↻ 1" the moment the share starts instead
	  // of an unlabelled bubble for a frame.
	  let liveTickLabel = '';
	  if (currentMessage.contentType === 'application/sylk-live-location'
	      && !currentMessage.metadata?.one_shot) {
	    let validTicks = 1;
	    const trail = this.state.messagesMetadata
	      && this.state.messagesMetadata[currentMessage._id];
	    if (Array.isArray(trail) && trail.length > 0) {
	      let count = 0;
	      for (const e of trail) {
	        if (!e || e.action !== 'location') continue;
	        const v = e.value;
	        if (!v
	            || typeof v.latitude !== 'number'
	            || typeof v.longitude !== 'number') continue;
	        count += 1;
	      }
	      if (count > validTicks) validTicks = count;
	    }
	    // Compact glyph + count so the footer stays narrow even when
	    // a long-running share has accumulated dozens of ticks.
	    // U+21BB (clockwise reload) is widely supported on both
	    // platforms' default fonts and reads as "updates" without
	    // needing a separate icon node.
	    liveTickLabel = `↻ ${validTicks}`;
	  }
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

	  // Compose footer parts in order, then join with separators.
	  // Live-location tick count is always pushed first so it sits to
	  // the left of the timestamp regardless of bubble direction —
	  // matches the requested "left bottom of the bubble" placement.
	  const parts = [];
	  if (isIncoming) {
		if (liveTickLabel) parts.push(liveTickLabel);
		parts.push(timeString);
		if (hasFileSize) parts.push(formatFileSize(currentMessage.metadata.filesize));
		if (durationString) parts.push(durationString);
	  } else {
		if (liveTickLabel) parts.push(liveTickLabel);
		if (durationString) parts.push(durationString);
		if (hasFileSize) parts.push(formatFileSize(currentMessage.metadata.filesize));
		parts.push(timeString);
	  }
	  let text = parts.filter(Boolean).join('  •  ');

	  let consumed = currentMessage.consumed || 0;
	  const showProgress = !isIncoming && consumed > 0;

	  // The encryption lock is no longer rendered here; it's anchored
	  // absolutely in the bubble's bottom corner opposite the timestamp
	  // (see ChatBubble.js customView). That gives a real corner pin —
	  // a flex sibling here couldn't reach the corner because GiftedChat's
	  // bottomContainer is content-sized.
	  //
	  // The "Meet me there..." text button now lives in ChatBubble's
	  // customView too — same corner-anchored treatment as the lock,
	  // so it sits OPPOSITE the timestamp regardless of bubble
	  // direction. See ChatBubble.js for the rendering.

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
				opacity: textOpacity,
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

    // Mirror of showImageGrid for video. The per-contact Video
    // filter swaps the chat list for a grid of video thumbnails;
    // tapping a tile opens the existing full-screen video Modal
    // via openVideoModal.
    get showVideoGrid() {
		if (this.state.messagesCategoryFilter == 'video') {
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

		if (this.state.messagesCategoryFilter == 'video') {
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

		if (this.state.messagesCategoryFilter == 'video') {
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
  
  // Bulk Share for the media grids. Resolves each selected msg
  // id to its on-disk decrypted file via metadata.local_url, makes
  // Android-friendly copies in the cache dir (Share targets can't
  // read arbitrary app sandbox paths on Android), and hands the
  // resulting urls list to react-native-share. Same shape as the
  // existing handleShare (single-message / image-group share)
  // uses, just driven off the grid's selection set instead of an
  // image-group leader id.
  async shareSelectedMedia(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const urls = [];
    // renderMessages is the unfiltered timeline; metadata.local_url
    // is populated by sylk2GiftedChat once a transfer has been
    // downloaded. Tiles for not-yet-downloaded files have no
    // playable url and are silently skipped (the user can still
    // tap them in the grid to trigger a download, then re-share).
    const _msgs = this.state.renderMessages || [];
    for (const msg of _msgs) {
      if (!ids.includes(msg._id)) continue;
      if (!msg || !msg.metadata || !msg.metadata.local_url) continue;
      let filePath = msg.metadata.local_url;
      if (Platform.OS === 'android') {
        try {
          const filename = msg.metadata.filename || `file-${Date.now()}`;
          const destPath = `${RNFS.CachesDirectoryPath}/${filename}`;
          await RNFS.copyFile(filePath, destPath);
          filePath = `file://${destPath}`;
        } catch (err) {
          console.log('shareSelectedMedia: copy failed for', msg._id, err && err.message);
          continue;
        }
      } else if (!filePath.startsWith('file://')) {
        // iOS Share.open is happier with explicit file:// scheme;
        // most decrypted local_url paths come back without it.
        filePath = 'file://' + filePath;
      }
      urls.push(filePath);
    }

    if (urls.length === 0) {
      console.log('shareSelectedMedia: no shareable urls (selection had no downloaded files)');
      return;
    }

    try {
      await Share.open({ title: 'Share', urls });
    } catch (err) {
      // user dismissing the share sheet shows up as a thrown
      // error; ignore unless it's actually informative.
      if (err && err.message && err.message !== 'User did not share') {
        console.log('shareSelectedMedia: Share.open error', err.message);
      }
    }
  }

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
	  let lastSenderKey = null;

		const seen = new Set();
		messages = messages.filter(msg => {
		  if (seen.has(msg._id)) return false;
		  seen.add(msg._id);
		  return true;
		});

	messages = [...messages].sort(
	  (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
	);

	  // Build a stable sender identity for each message so we never merge
	  // photos from different people into one group. `direction` alone is
	  // not enough — in a group chat every incoming participant shares
	  // direction='incoming', so we'd still glue A's and B's photos
	  // together. Combining direction with user._id (set on incoming rows
	  // to the remote party's URI) disambiguates that case, and for
	  // outgoing rows direction is enough on its own.
	  const senderKeyFor = (m) => {
	    const dir = m.direction || '';
	    const uid = (m.user && m.user._id) || '';
	    return dir + '|' + uid;
	  };

	  for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const isImage = !!msg.image;

		if (isImage) {
		  const currentTime = new Date(msg.createdAt).getTime();
		  const currentSenderKey = senderKeyFor(msg);

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
			  currentSenderKey !== lastSenderKey || // ⬅️ different sender → new group
			  (hasLabel && msg._id !== currentGroup); // ⬅️ labeled image starts its own group


		  if (shouldStartNewGroup) {
			currentGroup = msg._id;
			groups[currentGroup] = [];
			//console.log('Start group', currentGroup, msg.createdAt);
		  }

		  groups[currentGroup].push(msg._id);
		  byImage[msg._id] = currentGroup;

		  lastImageTime = currentTime;
		  lastImageId = msg._id;
		  lastSenderKey = currentSenderKey;
		} else {
		  currentGroup = null;
		  lastImageTime = null;
		  lastImageId = null;
		  lastSenderKey = null;
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
        // Source toggle (Sylk-only / AB-only) lives in the search bar
        // and arrives here as a prop mirrored into state. When the user
        // picks 'ab' we drop the Sylk list (state.allContacts) entirely
        // and let the address-book set (state.contacts, populated at app
        // start by getABContacts) become the search corpus. Modes that
        // bypass the toggle UI (share, invite) still see only Sylk
        // contacts so we don't change their behavior.
        const allowSourceToggle =
            !this.state.shareToContacts && !this.state.inviteContacts;
        const contactSource = allowSourceToggle
            ? (this.state.contactSource || 'sylk')
            : 'sylk';
        let contacts =
            contactSource === 'ab'
                ? []
                : this.state.allContacts;
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

            // The address-book pile is mixed into searchExtraItems in
            // three cases:
            //   • the user has explicitly flipped the source toggle
            //     to 'ab' (normal contacts-list browse path — the
            //     toggle UI is currently hidden in the main interface
            //     but the code path is preserved), OR
            //   • we're in invite-to-conference mode, which merges
            //     Blink + Phonebook into a single picker list (no
            //     source toggle is shown for that workflow — the
            //     user gets every reachable contact in one place), OR
            //   • we're in the default Sylk view with an active
            //     search (>2 chars). The main interface no longer
            //     exposes a Sylk/Phonebook source picker — the search
            //     unifies both sources so the user sees any matching
            //     contact regardless of which corpus it lives in.
            //     The default (no search) view still shows only Sylk
            //     contacts, matching what the user expects when
            //     browsing rather than searching.
            // Share-to-contacts stays Blink-only as before.
            //
            // In invite mode the AB pile is filtered down to PHONE
            // entries only — getABContacts() mints both a phone-number
            // entry and an email entry per AB contact, but a conference
            // invite cannot be dialled to an email address, so
            // email-only entries would just be junk in the picker.
            // The filter keys on the explicit 'phone' / 'email' tag
            // that getABContacts attaches (rather than URI-shape
            // sniffing, which misclassified phones whose URIs happen
            // to contain '@' — e.g. WhatsApp-augmented contacts).
            // Outside invite mode (the normal AB browse or the
            // unified main-interface search) we still show both,
            // since the user might be looking up an email to start
            // a chat.
            const unifiedSylkSearch =
                !this.state.shareToContacts
                && !this.state.inviteContacts
                && contactSource !== 'ab'
                && !!this.state.targetUri
                && this.state.targetUri.length > 2;
            if (Array.isArray(this.state.contacts)
                && (contactSource === 'ab' || this.state.inviteContacts || unifiedSylkSearch)) {
                if (this.state.inviteContacts) {
                    searchExtraItems = searchExtraItems.concat(
                        this.state.contacts.filter(c => {
                            if (!c) return false;
                            // Prefer the explicit tag when present —
                            // post-upgrade AB entries carry it. For
                            // older cached entries (loaded before the
                            // getABContacts change shipped) fall back
                            // to URI-shape sniffing so the filter
                            // doesn't drop them as untagged.
                            if (Array.isArray(c.tags)) {
                                if (c.tags.indexOf('phone') !== -1) return true;
                                if (c.tags.indexOf('email') !== -1) return false;
                            }
                            return !!c.uri && c.uri.indexOf('@') === -1;
                        })
                    );
                } else {
                    searchExtraItems = searchExtraItems.concat(this.state.contacts);
                }
            }

            if (contactSource === 'ab'
                && !this.state.selectedContact
                && !this.state.inviteContacts) {
                // AB mode: show every address-book entry, optionally
                // narrowed by the search term. Drop the >2-char gate
                // that the merged-mode path used — the user is now
                // explicitly browsing the address book and expects to
                // see entries even with an empty query.
                matchedContacts = this.state.targetUri
                    ? searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri))
                    : searchExtraItems;
            } else if (this.state.inviteContacts && !this.state.selectedContact) {
                // Invite mode: merge Sylk + Phonebook into the picker.
                // Show the full Phonebook (no >2-char gate) so the
                // user can browse and tap to select even with the
                // search field empty.
                matchedContacts = this.state.targetUri
                    ? searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri))
                    : searchExtraItems;
            } else if (this.state.targetUri && this.state.targetUri.length > 2 && !this.state.selectedContact && !this.state.inviteContacts) {
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

            // Conference-invite mode eligibility rules.
            //   • self          — can't invite yourself
            //   • guest /
            //     anonymous     — no inbox to invite
            //   • blocked       — user opted them out
            //   • test          — QA / developer fixture rows
            //
            // Phone-number entries (leading '+', bare URIs without
            // '@', or AB entries tagged 'phone' / 'tel') USED to be
            // excluded here because the previous conference focus
            // couldn't dial out to a PSTN number. The current
            // implementation can — the focus's SIP bridge handles
            // dial-out — so phone-number entries are now valid
            // invitees and the filter no longer drops them.
            //
            // (Caregiver auto-answer rows are still allowed —
            // they're regular Sylk contacts and a caregiver may
            // be a valid invitee. Cross-domain rows are ALSO
            // allowed — any legitimate SIP URI in another domain
            // is a valid conference invitee.)
            if (this.state.inviteContacts) {
                const _itemUri = (item.uri || '').toLowerCase();
                const _accId = (this.state.accountId || '').toLowerCase();
                if (_itemUri === _accId) return;
                if (_itemUri.indexOf('@guest.') > -1) return;
                if (_itemUri.indexOf('anonymous@') > -1) return;
                if (Array.isArray(item.tags)) {
                    if (item.tags.indexOf('blocked') > -1) return;
                    if (item.tags.indexOf('test') > -1) return;
                }
            }

            if (item.uri.indexOf('@videoconference.') > -1 && this.state.filter == 'calls') {
                return;
            }

            // The "calls" category bar filter changed in v13 from a
            // tag-based check (item.tags includes 'calls') to a
            // column-based one (item.lastCallTimestamp not null). The
            // tag check missed rows that were never tagged — rejected
            // on connect, fast-cancelled, network failures — even
            // though the user clearly placed/received the call.
            // last_call_timestamp is stamped by updateHistoryEntry on
            // every call end (fan-out across all rows matching the
            // URI), so it's the authoritative "this contact has call
            // activity" signal. This is a STRICT filter: rows without
            // a last_call_timestamp are dropped from the Calls view
            // (no fallthrough to the not-blocked branch).
            if (this.state.filter === 'calls') {
                if (item.lastCallTimestamp != null) {
                    filteredItems.push(item);
                }
            } else if (this.state.filter && item.tags.indexOf(this.state.filter) > -1) {
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
			
			  // Case 3: neither has timestamp -> sort alphabetically by
			  // name, honouring the current sortOrder. Phonebook
			  // entries (AB contacts) hit this branch because they
			  // carry no timestamp at all, so respecting sortOrder
			  // here is what makes the asc/desc chip actually flip the
			  // phonebook A→Z vs Z→A. Previously the comparator
			  // ignored sortOrder for this case, which is the
			  // "order doesn't work on PB contacts" bug.
			  var aName = (a.name || "").toLowerCase();
			  var bName = (b.name || "").toLowerCase();
			  var _cmp = aName.localeCompare(bName);
			  return sortOrder === 'desc' ? -_cmp : _cmp;
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
        
        // Decide which keyboard-handling strategy is active.
        //
        //  * useManualOverlap: Android API 34+, OR a wide-canvas
        //                     foldable / tablet (isTablet=true OR
        //                     short-side ≥ 600dp). On these devices
        //                     adjustResize is unreliable and both
        //                     KeyboardAvoidingView (offset is
        //                     hardcoded against the wrong chrome
        //                     height) and KeyboardSpacer (over-
        //                     compensates by ~bottomInset) misbehave.
        //                     We instead compute the actual visible
        //                     overlap from the keyboard event in
        //                     _keyboardDidShow and apply it as
        //                     paddingBottom on the chat container —
        //                     self-correcting against whatever
        //                     adjustResize already did.
        //
        //  * KAV path (else): legacy Android phone on API < 34 with
        //                     adjustResize working as designed —
        //                     keep the original KeyboardAvoidingView
        //                     wrap with offset = 60+topInset, which
        //                     was working before.
        //
        //  NOTE: an earlier attempt extended the manual-overlap
        //  branch to every Android version on the theory that the
        //  no-op-when-adjustResize-works property made it strictly
        //  safer. In practice, on Android 11 phones where
        //  adjustResize was working, the keyboard event still
        //  reported a non-zero rawOverlap (likely because of stale
        //  Dimensions or screen-vs-window coordinate skew) and the
        //  extra padding lifted the input bar far above the
        //  keyboard. Sticking with the original gate.
        let useManualOverlap = false;
        let wideCanvas = false;
        if (Platform.OS === 'android') {
            const androidVersion = Platform.Version;
            const _w = Dimensions.get('window').width;
            const _h = Dimensions.get('window').height;
            const _shortSide = Math.min(_w, _h);
            wideCanvas = _shortSide >= 600;
            if (androidVersion >= 34 || this.state.isTablet || wideCanvas) {
                useManualOverlap = true;
            }
            // Per-render diagnostic — uncomment to debug which
            // keyboard-handling branch a given device hits.
            // const _logKey = `${androidVersion}|${this.state.isTablet}|${_shortSide}|${useManualOverlap}`;
            // if (this._lastKbFixLog !== _logKey) {
            //     this._lastKbFixLog = _logKey;
            //     console.log('[keyboardFix] android API=', androidVersion,
            //         'isTablet=', this.state.isTablet,
            //         'shortSide=', _shortSide,
            //         'wideCanvas=', wideCanvas,
            //         '→ useManualOverlap=', useManualOverlap);
            // }
        }
        // KeyboardSpacer is now off by default — the manual-overlap
        // path has replaced its role on every Android version where
        // it would have been useful. Kept addSpacer as a flag for the
        // single render-time check below so the JSX diff is small.
        const addSpacer = false;
      
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
        
        // "By size" sort path. Two distinct concerns:
        //   1. The grid surfaces (file/media browse) want a files-only
        //      view sorted by storage usage — that's why this branch
        //      both filters down to messages with a filename and sorts
        //      by filesize.
        //   2. The Locations filter has no notion of "size" (a tick
        //      stream isn't a stored asset), so applying this branch
        //      while category === 'location' would empty the chat —
        //      the user reported exactly this. The size icon is also
        //      hidden from the bottom bar in that case (see
        //      categorySortItems' enabled gate), so this guard is
        //      defensive — even if a stale orderBy='size' bleeds
        //      through, the location-filtered list still shows its
        //      bubbles in chronological order.
        if (this.state.orderBy === 'size'
                && this.state.messagesCategoryFilter !== 'location') {
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

        // While the floating ReactionBar is open the chat is
        // collapsed to a single message (see the visibleMessages
        // IIFE below). The "Load earlier messages" button has no
        // role in that mode — there's nothing to scroll above
        // and tapping it would fire a backfill request the user
        // can't see the result of anyway. Suppressing it keeps
        // the reaction UI to exactly two elements on screen: the
        // targeted bubble + the emoji bar. Falls back to the
        // normal `loadEarlier` value when the bar closes.
        if (this.state.reactionTarget) {
            loadEarlier = false;
        }
        
        //console.log('chatContainer', chatContainer);
        // safe-area-context occasionally reports topInset as 0 on
        // Android 11 (edge-to-edge / status-bar quirk seen on at least
        // one S62 Pro and similar Android 11 builds), which leaves the
        // KeyboardAvoidingView's keyboardVerticalOffset short by the
        // status-bar height — symptom: input bar peeks ~28-30px below
        // the keyboard top. Fall back to Android's native
        // StatusBar.currentHeight (in DP) when safe-area returns 0.
        // iOS doesn't expose StatusBar.currentHeight; on iOS we trust
        // safe-area unconditionally (it's reliable there).
        let topInset = this.state.insets?.top || 0;
        if (Platform.OS === 'android' && (!topInset || topInset === 0)) {
            const sbh = StatusBar.currentHeight;
            if (typeof sbh === 'number' && sbh > 0) {
                topInset = sbh;
            }
        }
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

		// Video-grid input. Same shape as `images` so ThumbnailGrid
		// can be reused. `uri` here is the THUMBNAIL path (not the
		// video itself), so each tile renders a still preview;
		// `videoUri` carries the real video file path for the
		// onItemPress handler to hand to openVideoModal.
		//
		// Two filter passes:
		//   • Downloaded videos: msg.video populated by
		//     sylk2GiftedChat once metadata.local_url exists AND
		//     the filename matches utils.isVideo.
		//   • Undownloaded fallback: file-transfer rows whose
		//     metadata classifies as video under the SAME
		//     precedence sylk2GiftedChat uses (image > audio >
		//     video) — otherwise shared extensions (.ogg lives in
		//     both audio and video tables) leak audio Call
		//     recordings into the video grid.
		//
		// Thumbnail resolution mirrors renderMessageVideo: prefer
		// currentMessage.thumbnail, fall back to videoMetaCache.
		// Tiles without a thumbnail yet appear as black tiles with
		// the play overlay; once the cache fills in (via the
		// shouldUpdateMessage thumbnail hook), they pick up the
		// real thumbnail on next render.
		const _videoMetaCache = this.state.videoMetaCache || {};
		const _transferProgress = this.state.transferProgress || {};
		const videos = chatMessages
		  .filter(m => {
		    if (m && m.video) return true;
		    if (!m || !m.metadata || !m.metadata.filename) return false;
		    const fname = m.metadata.filename;
		    const ftype = m.metadata.filetype;
		    if (utils.isImage(fname, ftype)) return false;
		    if (utils.isAudio(fname, ftype)) return false;
		    return utils.isVideo(fname, ftype);
		  })
		  .map(msg => {
		    const cacheEntry = _videoMetaCache[msg._id];
		    let thumb = msg.thumbnail
		      || (msg.thumbnail && msg.thumbnail.thumbnail)
		      || (cacheEntry && cacheEntry.thumbnail)
		      || null;
		    if (thumb && Platform.OS === 'android' && thumb.indexOf('file://') === -1) {
		      thumb = 'file://' + thumb;
		    }
		    // In-flight transfer state per tile. updateTransfer-
		    // Progress in app.js writes { progress, stage } here
		    // ('download' → 'decrypt' → cleared on success), so
		    // we can pipe it straight into ThumbnailGrid's
		    // overlay logic. Undefined when nothing's in flight
		    // for this id.
		    const tp = _transferProgress[msg._id];
		    return {
		      id: String(msg._id),
		      uri: thumb,
		      videoUri: msg.video,
		      title: msg.text || (msg.metadata && msg.metadata.filename) || '',
		      size: msg.metadata && msg.metadata.filesize,
		      timestamp: msg.metadata && msg.metadata.timestamp,
		      rotation: msg.metadata && msg.metadata.rotation,
		      // Raw file-transfer metadata so the grid's
		      // onItemPress can call downloadFile on
		      // undownloaded tiles. The blob carries transfer_id,
		      // url, sender, receiver, hash, etc.
		      metadata: msg.metadata,
		      downloaded: !!msg.video,
		      progress: tp ? tp.progress : null,
		      stage: tp ? tp.stage : null,
		    };
		  });

		if (this.state.orderBy === 'timestamp') {
			if (this.state.sortOrder == 'desc') {
                images.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1);
                videos.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1);
            } else {
                images.sort((a, b) => (a.timestamp > b.timestamp) ? 1 : -1);
                videos.sort((a, b) => (a.timestamp > b.timestamp) ? 1 : -1);
            }
		}

		// Hardcoded approximation of the NavigationBar's rendered
		// height. Fed into KeyboardAvoidingView's
		// keyboardVerticalOffset on Android phones (isTablet=false),
		// The chrome above the chat panel = topInset (system status
		// bar, from safe-area) + Appbar.Header height (Paper).
		// Appbar.Header's intrinsic height varies across Android ROMs
		// — 56dp on most, but ~88dp on some Android 11 builds with
		// extra system padding — which is what made the hardcoded
		// `60` here under-shoot on those devices (input bar peeked
		// ~30px below the keyboard top). NavigationBar measures the
		// Appbar.Header with onLayout, reports the height up to app.js,
		// which plumbs it down here as `appBarHeight`. We fall back
		// to 60 for the first render pass before the measurement
		// arrives.
		const navigatorBarHeight = (typeof this.props.appBarHeight === 'number'
		                              && this.props.appBarHeight > 0)
		    ? this.props.appBarHeight
		    : 60;
		
		const visibleMessages = (() => {
		    // While the floating ReactionBar is open, collapse the
		    // entire chat view to just the targeted message. Dimming
		    // the rest of the conversation turned out to confuse
		    // users — they couldn't tell they had caused the dim
		    // and assumed the chat had broken or entered some
		    // unknown mode. Hiding the rest of the list entirely
		    // removes any ambiguity: the user sees ONE message,
		    // the emoji bar below it, and nothing else. Closing the
		    // bar (setting reactionTarget back to null) restores the
		    // full list naturally on the next render. GiftedChat is
		    // happy with a single-message array — no virtualisation
		    // or layout fallout, and the existing image-group
		    // dedup below isn't relevant for a one-element list.
		    if (this.state.reactionTarget) {
		        const targetId = this.state.reactionTarget._id;
		        const single = chatMessages.filter(m => m._id === targetId);
		        if (single.length > 0) return single;
		        // Fallback: target rebuilt with a different _id
		        // between the tap and this render. Bail to the full
		        // list rather than render an empty chat — better
		        // visual than a black hole.
		    }
		    return chatMessages.filter(msg => {
		      // skipped duplicate grouped images
			  // if not an image → always show
			  if (!msg.image) return true;

			  const groupId = this.state.groupOfImage[msg._id];

			  // not grouped → show
			  if (!groupId) return true;

			  // show only first image of group
			  return this.state.imageGroups[groupId][0] === msg._id;
			});
		})();
			
		//console.log('visibleMessages', visibleMessages.length);
		//console.log('chatMessages', chatMessages.length);
		  		  
		// Pick the keyboard-handling strategy by device class:
		//
		//  * iOS:        plain View. GiftedChat's own bottomOffset
		//                prop plus the wrapper's marginBottom
		//                (composerHeight - bottomInset + replyHeight)
		//                handles the IME on iOS.
		//
		//  * Android phone (API < 34, !isTablet): KeyboardAvoidingView
		//                with behavior='height' and the historical
		//                offset of `navigatorBarHeight + topInset`.
		//
		//  * Android API 34+ / tablet / wide canvas: plain View, with
		//                paddingBottom = keyboardOverlap on the chat
		//                container (see useManualOverlap above).
		const _isLegacyPhone = Platform.OS === 'android' && !useManualOverlap;
		const KeyboardWrapper = _isLegacyPhone ? KeyboardAvoidingView : View;
	
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
                /* Without this, RN's default 'never' policy makes the
                   first tap on a contact row only dismiss the search
                   keyboard — the touchable's onPress doesn't fire
                   until the second tap. 'handled' lets row taps (which
                   ARE handled by the touchable inside renderContactItem)
                   pass through immediately while still dismissing the
                   keyboard on taps that land in empty space. */
                keyboardShouldPersistTaps="handled"
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
  
             {/* Column count for both media grids. Phone portrait
                 reads cramped at 3 (~120dp tiles on a 360dp screen
                 once gutters bite), so drop to 2; widen to 3
                 whenever there's more horizontal room — tablet or
                 phone-landscape. */}
             {this.showImageGrid ?
				  <ThumbnailGrid
					images={images}
					isLandscape={this.state.isLandscape}
					numColumns={(this.state.isTablet || this.state.isLandscape) ? 3 : 2}
					showTimestamp={true}
					showSize={true}
					// Same selection + confirm-delete flow as the
					// video grid below. Top-left checkbox per
					// tile, action-bar Delete that opens the
					// shared confirmation modal with a snapshot of
					// the selected ids. confirmBeforeDelete keeps
					// the optimistic in-grid remove from firing
					// before the user confirms.
					selectMode={true}
					checkboxCorner="top-left"
					enableDelete={true}
					confirmBeforeDelete={true}
					enableShare={true}
					shareImages={(ids) => this.shareSelectedMedia(ids)}
					selectedIds={this.state.imageGridSelected}
					onSelectionChange={(ids) => this.setState({imageGridSelected: ids})}
					deleteImages={(ids) => {
					    if (!ids || ids.length === 0) return;
					    this.setState({
					        pendingDeleteIds: ids,
					        pendingDeleteKind: 'image',
					        showDeleteMediaModal: true,
					        remoteDeleteMedia: false,
					    });
					}}
					onRotateImage={this.onRotateImage}
					onLongPress={(item) => console.log('long', item)}
					renderThumb={({item, index, size}) => (
					  <View style={{flex:1}}>
						<Image source={{uri:item.uri}} style={{width:size, height:size, borderRadius:6}} />
					  </View>
					)}
				  />
			  : null}

             {/* Video grid view (Video filter chip active). Same
                 component as the image grid, plus three video-
                 specific knobs:
                   • onItemPress: routes the tap to openVideoModal
                     using the per-item videoUri (the real video
                     file, not the thumbnail used for the tile).
                   • showPlayIcon: overlays a centered play
                     triangle on every tile so it reads as a video,
                     not a still image.
                   • emptyText: "No videos" instead of "No images"
                     when the grid is empty.

                 Pagination: the SQL slice for category-filtered
                 queries is bumped to 10000 file-transfer rows
                 (see app.js getMessages FILTERED_LIMIT), narrowed
                 by content_type='application/sylk-file-transfer'.
                 Even on chats with thousands of texts that's only
                 the file transfers — the decrypt cost stays low
                 since text rows don't reach the slice. No "Load
                 earlier" affordance is needed; the grid sees the
                 contact's entire media history in one fetch. */}
             {this.showVideoGrid ?
                 <View style={{flex: 1}}>
                  <ThumbnailGrid
                    images={videos}
                    isLandscape={this.state.isLandscape}
                    numColumns={(this.state.isTablet || this.state.isLandscape) ? 3 : 2}
                    showTimestamp={true}
                    showSize={true}
                    // Top-left selection box per tile, with the
                    // action-bar Delete button gated on any
                    // selection. Tapping Delete opens our local
                    // confirmation modal instead of optimistically
                    // wiping tiles — confirmBeforeDelete tells the
                    // grid to skip its own internal "remove
                    // immediately" optimism.
                    selectMode={true}
                    checkboxCorner="top-left"
                    enableDelete={true}
                    confirmBeforeDelete={true}
                    enableShare={true}
                    shareImages={(ids) => this.shareSelectedMedia(ids)}
                    selectedIds={this.state.videoGridSelected}
                    onSelectionChange={(ids) => this.setState({videoGridSelected: ids})}
                    deleteImages={(ids) => {
                        // Snapshot the selection and pop the
                        // shared confirmation modal. The actual
                        // delete fires only after the user
                        // confirms — cancelling keeps the tiles
                        // and the per-grid selection intact.
                        if (!ids || ids.length === 0) return;
                        this.setState({
                            pendingDeleteIds: ids,
                            pendingDeleteKind: 'video',
                            showDeleteMediaModal: true,
                            remoteDeleteMedia: false,
                        });
                    }}
                    showPlayIcon={true}
                    emptyText="No videos"
                    onItemPress={(item) => {
                        if (!item) return;
                        if (item.videoUri) {
                            // Already downloaded → play.
                            this.openVideoModal(item.videoUri);
                        } else if (item.metadata && this.props.downloadFile) {
                            // Not on disk yet → kick off download.
                            // force=true matches the chat bubble's
                            // manual-download button (line ~4378),
                            // so the user gets the same behaviour:
                            // immediate fetch, progress bar in the
                            // bubble, and once the file lands +
                            // thumbnail generates, the auto-refresh
                            // hook in shouldUpdateMessage re-renders
                            // this tile with the real preview and
                            // play icon.
                            console.log('VideoGrid: download tap for', item.id);
                            this.props.downloadFile(item.metadata, true);
                        }
                    }}
                    onLongPress={(item) => console.log('long video', item && item.id)}
                  />
                 </View>
			  : null}

             {this.showChat ?
             <View
                // Key on the rounded window dims so the chat root
                // remounts on every fold / posture change. Razr cover
                // (480×410) and inner (408×997) both report as
                // `portrait` after the folded-state override in
                // app.js so a key based on `isLandscape` alone
                // wouldn't change between them — including the dims
                // means each canvas gets its own component identity
                // and Paper / GiftedChat children re-run their
                // measurement / layout passes against the new size.
                key={(this.state.isLandscape ? 'l' : 'p')
                    + '-' + Math.round(Dimensions.get('window').width)
                    + 'x' + Math.round(Dimensions.get('window').height)}
                style={[
                    chatContainer,
                    borderClass,
                    // On the manual-overlap branch we shift the chat
                    // content up by the actual visible keyboard
                    // overlap. This is self-correcting: when
                    // adjustResize fully shrunk the window
                    // keyboardOverlap is 0 and this is a no-op; when
                    // edge-to-edge / a foldable ROM didn't shrink
                    // fully the overlap matches the residual gap and
                    // the input bar lands flush above the keyboard.
                    useManualOverlap ? {paddingBottom: this.state.keyboardOverlap || 0} : null,
                ]}>
				<KeyboardWrapper
					  // Key folds (heh) the rounded window dims into
					  // the wrapper's identity. On the Razr both
					  // displays render as `portrait` (the folded-
					  // state override in app.js#_detectOrientation
					  // forces it on cover; the inner is naturally
					  // portrait), so a key that only changed on
					  // `isLandscape` left the wrapper mounted across
					  // a fold transition and the subtree's cached
					  // measurements drove the layout. Including the
					  // window dims in the key forces a remount when
					  // the canvas actually changes — the chat panel
					  // re-runs its flex math against the new
					  // dimensions.
					  key={(this.state.isLandscape ? 'l' : 'p')
					      + '-' + Math.round(Dimensions.get('window').width)
					      + 'x' + Math.round(Dimensions.get('window').height)}
					  style={[chatContainer, {marginBottom: Platform.OS === 'ios' ? this.state.composerHeight - bottomInset + this.state.replyContainerHeight: 0}]}

					  {...(_isLegacyPhone
						? {
							behavior: 'height',
							keyboardVerticalOffset: navigatorBarHeight + topInset,
						  }
						: {})}
					>

                {/* Pressable wrapper so a tap on the chat's empty
                    area (gaps between bubbles, padding above the
                    first bubble, anywhere the chat list isn't
                    actively scrolling and no child Touchable
                    captured the press) dismisses the reaction bar.
                    Pressable's onPress fires only when no child
                    responder claimed the tap — bubble taps are
                    captured by their own TouchableOpacity inside
                    gifted-chat, so those don't reach this handler.
                    Bubble dismissal is handled inside onMessagePress
                    itself (early-return when reactionTarget is set).
                    flex: 1 so the Pressable fills the keyboard
                    wrapper's space; without it, the chat would
                    collapse to its content size. */}
                <Pressable
                    style={{ flex: 1 }}
                    onPress={() => {
                        if (this.state.reactionTarget) {
                            this.dismissReactionBar();
                        }
                    }}
                    android_ripple={null}
                >
                <GiftedChat
				  listViewProps={{
					ref: (ref) => { this.flatListRef = ref; },
					onViewableItemsChanged: this.onViewableItemsChanged,
				    onScroll: this.onScroll,
				    scrollEventThrottle: 16,
					viewabilityConfig: this.viewabilityConfig,
				    // Forwards to the underlying FlatList. Lets us
				    // force item re-renders for parent-state changes
				    // that aren't reflected in the messages array —
				    // specifically the live scrub state that drives
				    // the call-recording bubble's waveforms during a
				    // drag. Without this, FlatList sees data===data
				    // and skips re-rendering the items, so the
				    // waveforms stay frozen at the pre-drag position.
				    extraData: this.state.audioBubbleScrub,
				    // Dismiss the in-app EmojiPicker when the user
				    // starts scrolling the chat — mirror of the OS
				    // keyboard's behaviour. Paired with the explicit
				    // closeEmojiPicker call at the top of
				    // onMessagePress for bubble-tap dismissal.
				    onScrollBeginDrag: () => {
				        if (this.state.emojiPickerVisible) {
				            this.closeEmojiPicker();
				        }
				    },
				  }}
				  
				  bottomOffset={Platform.OS === 'ios' ? bottomInset : 0}
                  innerRef={this.chatListRef}
                  messages={visibleMessages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onMessagePress}
                  renderInputToolbar={chatInputClass}
                  // When reactionTarget is set, GiftedChat renders
                  // the ReactionBar BELOW the message list and
                  // ABOVE the input toolbar (chat-footer slot).
                  // The message list shrinks by the bar's height
                  // so the tapped target — which is often the
                  // most recent message at the bottom — gets
                  // pushed up into view above the bar. No
                  // measurement / anchoring required.
                  renderChatFooter={() => (
                      this.state.reactionTarget
                          ? (
                              <ReactionBar
                                  visible={true}
                                  emojis={this.state.recentReactions}
                                  onSelect={(emoji) =>
                                      this.quickReact(this.state.reactionTarget, emoji)
                                  }
                                  onPickerOpen={() =>
                                      this.openReactionPicker(this.state.reactionTarget)
                                  }
                              />
                          )
                          : null
                  )}
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
                  // shouldUpdateMessage runs alongside Message's
                  // built-in shouldComponentUpdate; ours adds a
                  // re-render trigger for live-location bubbles the
                  // first time they enter the viewport, so the
                  // lazy-load placeholder in renderMessageText can
                  // swap to the real LocationBubble exactly once.
                  // renderedMessageIds is the sticky once-seen Set
                  // (only grows), forwarded down to Message via
                  // GiftedChat's restProps so the comparator above
                  // can do .has(id) on prev vs next props. Using the
                  // sticky set instead of the volatile
                  // visibleMessageIds means we don't burn a re-render
                  // every time the user scrolls a known-rendered
                  // bubble back into view.
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  renderedMessageIds={this.state.renderedMessageIds}
                  // Forwarded to gifted-chat's Message wrapper via
                  // restProps so shouldUpdateMessage can detect the
                  // "video thumbnail just landed in cache" transition
                  // and re-render that specific bubble. See the
                  // video-thumbnail branch in shouldUpdateMessage.
                  videoMetaCache={this.state.videoMetaCache}
                  renderTime={this.renderTime}
                  renderDay={this.renderDay}
                  renderSystemMessage={this.renderSystemMessage}
                  placeholder={this.state.placeholder}
                  lockStyle={styles.lock}
                  renderSend={this.renderSend}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  maxInputLength={16000}
                  tickStyle={{ color: 'green' }}
                  renderTicks={(currentMessage) => {
                    // Ticks (✓ sent / ✓✓ received-displayed / 🕓 pending)
                    // are a sender-side delivery indicator — they only
                    // make sense on OUTGOING bubbles, where they tell
                    // the local user that their own message was sent,
                    // delivered, or read. On INCOMING (remote) bubbles
                    // a tick would mis-read as "the remote user marked
                    // your incoming message as read", which is non-
                    // sensical. In Day theme the issue was especially
                    // visible: ticks rendered onto the white incoming
                    // bubble in plain green, making remote messages
                    // look like they carried read/displayed receipts.
                    // gifted-chat calls renderTicks for both sides
                    // when the prop is set (the default-tick logic
                    // that gates by user._id is bypassed entirely
                    // when a custom renderTicks is supplied), so we
                    // gate by direction explicitly here.
                    if (currentMessage
                            && currentMessage.direction === 'incoming') {
                        return null;
                    }
                    // Live-location bubbles: the IMDN ✓✓ only ever
                    // reflects the ORIGIN tick's delivery state, not
                    // any of the heartbeats that follow. Once the
                    // first tick is delivered the indicator freezes
                    // there forever — it stops conveying anything
                    // useful and reads (incorrectly) like every
                    // update has been confirmed. Hide ticks on
                    // these bubbles entirely; the user gets the
                    // "is it working?" signal from the live map
                    // updates themselves. Same logic also covers
                    // meet-mode bubbles since they share the same
                    // contentType.
                    if (currentMessage
                            && currentMessage.contentType === 'application/sylk-live-location') {
                        return null;
                    }
                    // Existing 'size' sort behaviour: hide ticks
                    // across the board so the size column has more
                    // room.
                    if (this.state.orderBy === 'size') return null;
                    // Otherwise replicate the default GiftedChat
                    // tick rendering — ✓ for sent, ✓✓ for
                    // received, 🕓 while pending. Done inline because
                    // returning `undefined` from a renderTicks
                    // function suppresses the default; we only get
                    // the default when the prop itself is undefined,
                    // and we can't conditionally undef a JSX prop.
                    const _ticks = [];
                    if (currentMessage && currentMessage.sent) {
                        _ticks.push(
                            <Text key="t-sent" style={{fontSize: 10, color: 'green'}}>✓</Text>
                        );
                    }
                    if (currentMessage && currentMessage.received) {
                        _ticks.push(
                            <Text key="t-recv" style={{fontSize: 10, color: 'green'}}>✓</Text>
                        );
                    }
                    if (currentMessage && currentMessage.pending) {
                        _ticks.push(
                            <Text key="t-pend" style={{fontSize: 10, color: 'green'}}>🕓</Text>
                        );
                    }
                    if (_ticks.length === 0) return null;
                    return <View style={{flexDirection: 'row', marginRight: 4}}>{_ticks}</View>;
                  }}
                  infiniteScroll={false}
                  loadEarlier={loadEarlier}
                  isLoadingEarlier={this.state.isLoadingEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                  isTyping={this.state.isTyping}
                  keyboardShouldPersistTaps={"handled"}
                  keyboardDismissMode={"interactive"}
				  text={this.state.text}
				  
                  onInputTextChanged={text => this.chatInputChanged(text)}
                  /* Theme-aware bubble time stamps (same lookup as
                     the search-results GiftedChat below). Without
                     this the left stamp defaults to white and
                     vanishes against the Day-mode white incoming
                     bubble. */
                  timeTextStyle={{
                      left:  { color: DarkModeManager.getTheme().isDark ? 'white' : '#667781' },
                      right: { color: '#667781' },
                  }}
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
                </Pressable>

			   </KeyboardWrapper>

				{ (this.state.focusedMessages && !this.state.actionSheetDisplayed) ? this.renderFocusedMessagesControls(): null}
				{((this.state.showScrollSideButtons || this.state.focusedMessages) && !this.state.actionSheetDisplayed)? this.renderScrollingControls(): null}

                {addSpacer ? <KeyboardSpacer /> : null }

                {/* In-app emoji picker. Rendered as a Modal, so its
                    physical position in the tree doesn't matter — it
                    overlays the whole screen when visible. Closing the
                    picker (backdrop tap, Done button, hardware back) is
                    routed through closeEmojiPicker. */}
                <EmojiPicker
                    visible={this.state.emojiPickerVisible}
                    onSelect={this.handleEmojiSelected}
                />

                {/* No overlay dim layer here — dimming is done per-
                    bubble via the `isDimmedByReplyTarget` prop on
                    ChatBubble (opacity 0.35 on non-target bubbles).
                    See renderBubble below. The quick-reaction bar
                    that goes with the dim is now rendered INLINE
                    via GiftedChat's renderChatFooter prop (see the
                    main GiftedChat instance below) — it sits
                    directly above the input toolbar and the
                    message list shrinks to make room. */}

              </View>

              : (items.length === 1 && this.showReadonlyChat) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat innerRef={this.chatListRef}
				  listViewProps={{
					ref: (ref) => { this.flatListRef = ref; },
					onViewableItemsChanged: this.onViewableItemsChanged,
					viewabilityConfig: this.viewabilityConfig,
				    extraData: this.state.audioBubbleScrub,
				  }}
                  messages={chatMessages}
                  renderInputToolbar={() => { return null }}
                  renderBubble={this.renderBubbleWithMessages}
                  renderMessageText={this.renderMessageText}
                  renderMessageImage={this.renderMessageImage}
                  renderMessageAudio={this.renderMessageAudio}
                  renderMessageVideo={this.renderMessageVideo}
                  renderDay={this.renderDay}
                  renderSystemMessage={this.renderSystemMessage}
                  onSend={this.onSendMessage}
                  lockStyle={styles.lock}
                  onLongPress={this.onLongMessagePress}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  // Forwarded into Message via GiftedChat's
                  // restProps so shouldUpdateMessage can detect the
                  // first-time-seen flip for live-location bubbles
                  // (lazy-load gate in renderMessageText). Sticky
                  // set: re-renders happen exactly once per bubble.
                  renderedMessageIds={this.state.renderedMessageIds}
                  // Same purpose for the just-arrived-thumbnail case
                  // on video bubbles — see the matching prop on the
                  // main GiftedChat above.
                  videoMetaCache={this.state.videoMetaCache}
                  onPress={this.onMessagePress}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  /* Bubble time-stamp colour. Pull from the active
                     theme so the left (incoming) stamp stays
                     readable against whichever bubble colour
                     ChatBubble paints — white-on-white was the bug
                     in Day mode, where the incoming bubble flipped
                     from green to white but this style stayed
                     hard-coded to 'white'. The right (outgoing)
                     stamp is dark in both themes because the
                     outgoing bubble is light in both. */
                  timeTextStyle={{
                      left:  { color: DarkModeManager.getTheme().isDark ? 'white' : '#667781' },
                      right: { color: '#667781' },
                  }}
                  infiniteScroll
                  loadEarlier={!this.state.totalMessageExceeded && this.state.selectedContact !== null}
                  onLoadEarlier={this.loadEarlierMessages}
                />
              </View>
              : null
              }

			{/* Media-grid bulk-delete confirmation modal — shared
			    between the image and video grids. The triggering
			    grid stamps state.pendingDeleteKind ('image' or
			    'video') so the labels read naturally without
			    needing a separate modal per type. Routes to
			    app.js#deleteFiles, the same SQL+remote pipeline
			    the NavigationBar "Delete files" modal uses, just
			    with explicit ids instead of type/period filters.
			    "Also delete remotely" stays opt-in. */}
			{(() => {
			  const kind = this.state.pendingDeleteKind || 'video';
			  const ids = this.state.pendingDeleteIds || [];
			  const count = ids.length;
			  const singular = kind === 'image' ? 'image' : 'video';
			  const plural   = kind === 'image' ? 'images' : 'videos';
			  const noun = count === 1 ? singular : plural;
			  const closeModal = () => this.setState({
			      showDeleteMediaModal: false,
			      pendingDeleteIds: [],
			      remoteDeleteMedia: false,
			  });
			  return (
			    <Modal
			      visible={!!this.state.showDeleteMediaModal}
			      transparent
			      animationType="fade"
			      onRequestClose={closeModal}
			    >
			      <TouchableWithoutFeedback onPress={closeModal}>
			        <View style={{
			          flex: 1,
			          backgroundColor: 'rgba(0,0,0,0.5)',
			          justifyContent: 'center',
			          alignItems: 'center',
			          paddingHorizontal: 24,
			        }}>
			          <TouchableWithoutFeedback onPress={() => {}}>
			            <View style={{
			              backgroundColor: '#fff',
			              borderRadius: 12,
			              padding: 20,
			              width: '100%',
			              maxWidth: 420,
			            }}>
			              <Text style={{fontSize: 18, fontWeight: '600', marginBottom: 12, textAlign: 'center'}}>
			                Delete {count} {noun}?
			              </Text>
			              <Text style={{fontSize: 14, color: '#555', marginBottom: 16, textAlign: 'center'}}>
			                The selected {plural} will be removed from this chat on this device.
			              </Text>
			              {this.state.selectedContact
			                  && !(this.state.selectedContact.uri || '').includes('@videoconference') ? (
			                <TouchableOpacity
			                  onPress={() => this.setState({remoteDeleteMedia: !this.state.remoteDeleteMedia})}
			                  style={{
			                    flexDirection: 'row',
			                    alignItems: 'center',
			                    paddingVertical: 8,
			                    marginBottom: 12,
			                  }}
			                >
			                  <View style={{
			                    width: 22,
			                    height: 22,
			                    borderRadius: 4,
			                    borderWidth: 1.5,
			                    borderColor: this.state.remoteDeleteMedia ? '#1976d2' : '#999',
			                    backgroundColor: this.state.remoteDeleteMedia ? '#1976d2' : 'transparent',
			                    marginRight: 10,
			                    alignItems: 'center',
			                    justifyContent: 'center',
			                  }}>
			                    {this.state.remoteDeleteMedia && <Text style={{color: '#fff', fontWeight: 'bold'}}>✓</Text>}
			                  </View>
			                  <Text style={{fontSize: 14, color: '#333'}}>Also delete remotely</Text>
			                </TouchableOpacity>
			              ) : null}
			              <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
			                <TouchableOpacity
			                  onPress={closeModal}
			                  style={{paddingVertical: 10, paddingHorizontal: 16, marginRight: 8}}
			                >
			                  <Text style={{fontSize: 15, color: '#1976d2'}}>Cancel</Text>
			                </TouchableOpacity>
			                <TouchableOpacity
			                  onPress={() => {
			                    const uri = this.state.selectedContact && this.state.selectedContact.uri;
			                    if (uri && ids.length > 0 && typeof this.props.deleteFiles === 'function') {
			                        this.props.deleteFiles(uri, ids, this.state.remoteDeleteMedia, {});
			                    }
			                    // Clear both per-grid selections
			                    // and the shared modal state in one
			                    // setState — guarantees the action
			                    // bar on the active grid hides via
			                    // the controlled-selection path,
			                    // regardless of which grid the
			                    // delete came from.
			                    this.setState({
			                        showDeleteMediaModal: false,
			                        pendingDeleteIds: [],
			                        imageGridSelected: kind === 'image' ? [] : this.state.imageGridSelected,
			                        videoGridSelected: kind === 'video' ? [] : this.state.videoGridSelected,
			                        remoteDeleteMedia: false,
			                    });
			                  }}
			                  style={{
			                    paddingVertical: 10,
			                    paddingHorizontal: 18,
			                    backgroundColor: '#d32f2f',
			                    borderRadius: 6,
			                  }}
			                >
			                  <Text style={{fontSize: 15, color: '#fff', fontWeight: '600'}}>Delete</Text>
			                </TouchableOpacity>
			              </View>
			            </View>
			          </TouchableWithoutFeedback>
			        </View>
			      </TouchableWithoutFeedback>
			    </Modal>
			  );
			})()}

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

			{/* Location-bubble fullscreen viewer. Mirrors the image
			    viewer above: a transparent Modal holds a maximised
			    LocationBubble (the same component the chat list
			    renders inline, with a fullScreen prop that switches
			    its map dimensions to ~window size). The chat list
			    itself isn't unmounted — when the modal closes the
			    bubble's place in the scroll position is unchanged.
			    Android back button hits onRequestClose, which routes
			    through the same exit path as tapping the close
			    icon. */}
			{this.state.fullScreenLocation && (() => {
				const _msg = this.state.fullScreenLocation;
				const _latestRaw = this.locationData?.[_msg._id] || _msg.metadata;
				// Same local-only owner-coords merge as the inline
				// renderMessageText path. Without this, opening the
				// fullscreen view of a privacy-deferred bubble after
				// chat-navigation would lose the inviter pin / circle.
				const _localOwn = this.props.localOwnerCoordsByMid
					&& this.props.localOwnerCoordsByMid[_msg._id];
				const _latest = (_localOwn
						&& typeof _localOwn.latitude === 'number'
						&& typeof _localOwn.longitude === 'number')
					? {
						..._latestRaw,
						localOwnerCoords: {
							latitude: _localOwn.latitude,
							longitude: _localOwn.longitude,
						},
						localOwnerRadiusMeters:
							(typeof _localOwn.radiusMeters === 'number'
								&& _localOwn.radiusMeters > 0)
								? _localOwn.radiusMeters : null,
					}
					: _latestRaw;
				// Trail: same derivation as renderMessageText so the
				// fullscreen view shows the same set of points (and
				// the same scrubber slider state) as the inline
				// bubble. For meet sessions LocationBubble suppresses
				// trail/slider via the isMeetSession flag inside it.
				const _rawTrail = (this.state.messagesMetadata
					&& this.state.messagesMetadata[_msg._id]) || [];
				const _trail = [];
				for (const e of _rawTrail) {
					if (!e || e.action !== 'location') continue;
					const v = e.value;
					if (!v
							|| typeof v.latitude !== 'number'
							|| typeof v.longitude !== 'number') continue;
					const tsRaw = (v.timestamp != null) ? v.timestamp : e.timestamp;
					const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
					_trail.push({
						latitude: v.latitude,
						longitude: v.longitude,
						timestamp: ts,
					});
				}
				_trail.sort((a, b) => a.timestamp - b.timestamp);
				const _exit = () => {
					if (typeof this.props.setFullScreen === 'function') {
						this.props.setFullScreen(false);
					}
					this.setState({fullScreenLocation: null});
				};
				return (
					<Modal
						visible={true}
						transparent={false}
						animationType="fade"
						onRequestClose={_exit}
					>
						<View
							style={{
								flex: 1,
								backgroundColor: '#000',
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							<LocationBubble
								currentMessage={_msg}
								metadata={_latest}
								trail={_trail}
								onLongPress={() => {}}
								ownerName={this.props.myDisplayName}
								peerName={this.props.selectedContact
									&& (this.props.selectedContact.name
										|| this.props.selectedContact.uri)}
								fullScreen={true}
							/>
							{/* Close button — same visual language as
							    the image-viewer modal so the affordance
							    reads identically across full-screen
							    surfaces. zIndex/elevation lifted above
							    the bubble's own absolutely-positioned
							    map controls so a tap lands here, not on
							    a zoom/pan button beneath. */}
							<TouchableOpacity
								onPress={_exit}
								hitSlop={{top: 20, left: 20, right: 20, bottom: 20}}
								style={{
									position: 'absolute',
									// Top-left, slightly lower than the
									// image-viewer convention (top:40) so
									// it clears the device notch / status
									// bar without dropping into the centre
									// of the screen. The user accepted the
									// minor visual brush against the map's
									// top-left current-location button at
									// this height — they explicitly chose
									// "top-left, just lower" over the
									// no-overlap bottom position.
									// Drops BELOW the map's primary
									// controls row (Focus + zoom+
									// both at top:16, 60×60 ending
									// at y=76) with extra clearance
									// so it reads as a separate
									// secondary action well below
									// the primary controls.
									top: 140,
									left: 30,
									backgroundColor: 'rgba(0,0,0,0.6)',
									width: 56,
									height: 56,
									borderRadius: 28,
									alignItems: 'center',
									justifyContent: 'center',
									zIndex: 100,
									elevation: 100,
								}}
							>
								<Icon name="close" size={36} color="white" />
							</TouchableOpacity>
						</View>
					</Modal>
				);
			})()}

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
    appBarHeight    : PropTypes.number,
    contactSource   : PropTypes.oneOf(['sylk', 'ab']),
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
