// ChatBox.js
// Standalone chat surface extracted from ContactsListBox.
// Mounted by ContactsListBox when a contact is selected; unmounted on back.
// NOTE (phase 1): this is a behavior-preserving extraction. The chat UI and
// its logic now live here as a self-contained component. ContactsListBox
// delegates to <ChatBox> via an early return in render(). A later pass can
// prune the now-unused contacts-list code paths from this file. See
// docs/ChatBox-extraction-plan.md.

import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Modal, Image, Clipboard, Dimensions, SafeAreaView, View, FlatList, Text, Linking, Platform, PermissionsAndroid, Switch, StyleSheet, TextInput, TouchableOpacity, TouchableWithoutFeedback, Pressable, BackHandler, TouchableHighlight, KeyboardAvoidingView, DeviceEventEmitter, Vibration } from 'react-native';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, MessageText, Send, InputToolbar, Day, Message, SystemMessage } from 'react-native-gifted-chat';
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
import DocumentPicker from 'react-native-document-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { IconButton } from 'react-native-paper';
import ImageViewer from 'react-native-image-zoom-viewer';
import KeyboardSpacer from 'react-native-keyboard-spacer';
import { Keyboard } from 'react-native';
import { StatusBar } from 'react-native';
import { createThumbnail } from "react-native-create-thumbnail";
import { createThumbnailSafe } from '../thumbnailService';
import UserIcon from './UserIcon';
import { CustomMessageText } from './CustomMessageText';
import RenderHTML, { HTMLElementModel, HTMLContentModel, defaultHTMLElementModels } from 'react-native-render-html';
import { WebView } from 'react-native-webview';

import * as Progress from 'react-native-progress';

import ChatBubble from './ChatBubble';
import LocationBubble from './LocationBubble';
import DarkModeManager from '../DarkModeManager';
import ThumbnailGrid from './ThumbnailGrid';
import AudioProgressSlider from './AudioProgressSlider';
import AudioWaveform from './AudioWaveform';
import SpectrumPlayback from './SpectrumPlayback';
import AudioTimeScale from './AudioTimeScale';
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
import MessageContextMenu from './MessageContextMenu';
import SwipeReplyRow from './SwipeReplyRow';
// Custom in-app confirmation dialog. Replaces three-button native
// Alert.alert prompts (Cancel/Restore/Proceed, Cancel/Revive/Eject)
// which lay their buttons out horizontally and overflow the right
// margin in portrait. This one stacks the buttons vertically.
import ConfirmActionModal from './ConfirmActionModal';

import momenttz from 'moment-timezone';
import Video from 'react-native-video';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-camera-roll/camera-roll";
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import FastImage from 'react-native-fast-image';
import { ActivityIndicator, Alert } from 'react-native';
import dayjs from 'dayjs';

import styles from '../assets/styles/ContactsListBox';
import Share from 'react-native-share';

// Debug flag for componentDidUpdate's per-change diagnostic logs. These
// fired on every relevant state transition (category/sort/order/selection
// changes, date-filter recomputes, spinner stops). They're useful when
// tracing the chat-filter pipeline but pure noise (and string-building
// cost) in normal use, so they're gated behind this flag. Error logs in
// the same method are intentionally left unconditional.
const CDU_DEBUG = false;

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
    // Form/grouping tags that occasionally appear in incoming HTML
    // messages. react-native-render-html doesn't model these by default
    // and logs a console warning for each one; declaring them as mixed
    // content silences the warning and renders their inner text/children
    // as plain content (same approach as button/slot above).
    fieldset: HTMLElementModel.fromCustomModel({
        tagName: 'fieldset',
        contentModel: HTMLContentModel.mixed,
    }),
    legend: HTMLElementModel.fromCustomModel({
        tagName: 'legend',
        contentModel: HTMLContentModel.mixed,
    }),
};

// Tags we deliberately DROP (and their content) from incoming HTML —
// document scaffolding, scripts, and embeds we never want to render in
// a chat bubble. Shared with the DOM visitor below so it never coerces
// these into a renderable element (which would defeat ignoredDomTags
// and, for script/iframe, render content we intend to discard).
const ignoredHtmlTags = [
  'html', 'head', 'body', 'title', 'svg', 'meta', 'link',
  'style', 'script', 'iframe', 'object', 'embed', 'noscript',
];

// Every tag react-native-render-html already knows how to render —
// its built-in models plus our custom ones plus the dropped set.
// Anything NOT in here is an "unknown" tag that the library would
// console.warn about once (see renderEmptyContent.js).
const handledHtmlTags = new Set([
  ...Object.keys(defaultHTMLElementModels || {}),
  ...Object.keys(customHTMLElementModels),
  ...ignoredHtmlTags,
]);

// Generic catch-all: instead of declaring a customHTMLElementModel for
// every possible tag, rename any UNKNOWN element to <div> as the DOM is
// built. render-html then renders it (preserving its inner text /
// children) and never warns. ignoredDomTags still drops the scaffolding
// tags above because they're excluded from the rename here. This is the
// library-sanctioned way to tamper with the DOM in v6 (domVisitors).
const htmlDomVisitors = {
  onElement: (element) => {
    const name = element && (element.tagName || element.name);
    if (name && !handledHtmlTags.has(String(name).toLowerCase())) {
      element.tagName = 'div';
    }
  },
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


const navButton = {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: "rgba(0,0,0,0.4)",
  justifyContent: "center",
  alignItems: "center",
};

const audioRecorderPlayer = new AudioRecorderPlayer();
// Drive the playback-position callback at ~20 fps (50 ms) instead of
// the library default (~500 ms) so the bubble slider / waveform /
// spectrum needle track the audio instead of lagging up to half a
// second behind it (the "voice stops but the slider keeps going" bug).
try { audioRecorderPlayer.setSubscriptionDuration(0.05); } catch (e) { /* older lib: ignore */ }

  // Helper to format bytes
  const formatFileSize = (bytes) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };


class ChatBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.chatListRef = React.createRef();
        this.flatListRef = null;
        this.default_placeholder = 'Type a message...';

        this.state = {
            // accountId, favoriteUris, blockedUris, orderBy, sortOrder,
            // contacts, myInvitedParties were pure prop-mirrors — read
            // directly from this.props now (accountId == this.props.account?.id).
            isRefreshing: false,
            selectedContact: this.props.selectedContact,
            renderMessages: [],
            filteredMessages: [],
            // Year/Month/Day drill-down filter. Three stacked rows
            // in the calendar bar above the chat:
            //   • Year (always visible while the bar is up)
            //   • Month (appears once a year is picked)
            //   • Day   (appears once a month is picked)
            // Each row narrows the chat further. The narrowest
            // active selection (dateDay > dateMonth > dateYear)
            // determines the actual filter applied to messages.
            // All three reset together on category change; tapping
            // an already-active pill clears it AND everything
            // below.
            dateYear: null,    // e.g. '2024'
            dateMonth: null,   // e.g. '2024-05'  (implies dateYear='2024')
            dateDay: null,     // e.g. '2024-05-12' (implies dateMonth + dateYear)
            availableYears: [],   // [{id, label, sortKey, count}, …]
            availableMonths: [],  // only populated when dateYear is set
            availableDays: [],    // only populated when dateMonth is set
            // Full per-contact day list pulled from SQL via
            // props.getContactDateIndex when the chat opens. Shape:
            // [{day_id: 'YYYY-MM-DD', count}, …] sorted day desc.
            // Used as the SOURCE for the year/month/day pills so
            // the calendar reflects the WHOLE history of the
            // conversation, not just the windowed slice currently
            // in renderMessages. Refreshed whenever the contact
            // changes (CWRP) and after a new message is appended
            // locally (debounced — see _scheduleDateIndexRefresh).
            contactDateIndex: [],
            // True from the moment the user taps a media-type chip
            // (image / video / audio / location / …) until the
            // freshly-fetched messages for that category land in
            // props.messages[uri]. Drives the centred ActivityIndicator
            // overlay below so the chip tap feels acknowledged —
            // without it the previous category's bubbles kept
            // rendering until the SQL fetch returned, which on big
            // histories looked like the chip didn't respond.
            messagesLoading: false,
            message: null,
            scrollToBottom: true,
            messageZoomFactor: this.props.messageZoomFactor,
            isTyping: false,
            isLoadingEarlier: false,
            playing: false,
            texting: false,
            placeholder: this.default_placeholder,
            audioSendFinished: false,
            messagesCategoryFilter: this.props.messagesCategoryFilter,
            audioDurations: {},
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
            // Long-press contextual menu state. When set, the
            // MessageContextMenu overlay (reaction strip + primary
            // action row + secondary bottom sheet) renders for this
            // message. Shape:
            //   { message, options, icons, callback, reactable } | null
            // `options`/`icons`/`callback` are exactly what we used to
            // hand gifted-chat's ActionSheet — the menu just re-presents
            // them; selecting an item calls callback(originalIndex) so
            // the existing per-action logic runs unchanged.
            messageMenu: null,
            keyboardVisible: false,
            // Pixels by which the IME visibly overlaps our window —
            // computed in _keyboardDidShow as max(0, windowBottom -
            // keyboardTop). Used as paddingBottom on the chat
            // container on Android API 34+ where adjustResize and
            // KeyboardSpacer are unreliable. Reset to 0 on hide.
            keyboardOverlap: 0,
            keyboardHeight: 0,
            bubbleWidths: {},
			// messagesMetadata is a pure prop-mirror — read this.props.messagesMetadata.
			mediaLabels: {},
			mediaRotations: {},
			text: '',
			fullSize: false,
			expandedImage: null,
			// Width/height of the currently-expanded single image. Pre-resolved
			// in onImagePress via Image.getSize (with a screen-size fallback)
			// and passed to react-native-image-zoom-viewer's imageUrls so the
			// library skips its internal getSize call — that call fails on
			// iOS 26 for our local-file URIs and would otherwise leave the
			// viewer black. See ThumbnailGrid.js openViewer for the same fix.
			expandedImageSize: null,
			// True when the underlying file is unreadable — either Image.getSize
			// failed or the inner <Image> reported onError. Drives the "File not
			// available" placeholder in the viewer Modal so the user sees a
			// real message instead of black. Reset on each onImagePress.
			expandedImageMissing: false,
			// True from the moment the user taps "Download from server" in
			// the placeholder until the viewer closes (or until a fresh
			// onImagePress resets it). Keeps the button in its spinner
			// state so repeat taps don't spam downloadFile.
			expandedImageDownloading: false,
			visibleMessageIds: [], 
			renderedMessageIds: new Set(),
			imageLoadingState: {},
			// Per-message (keyed by message _id) display aspect ratio,
			// corrected from FastImage's decoded natural size / Image.getSize
			// (both EXIF-orientation aware). Overrides the send-time metadata
			// dimensions, which for older/received images may be the raw
			// sensor size and therefore wrong for rotated photos. Keyed by the
			// STABLE message id (not the file uri, which changes temp→final),
			// and plumbed to ChatBubble as a prop so the memoized bubble
			// re-renders when the corrected ratio arrives — without this the
			// fix only landed after opening the image fullscreen.
			imageAspectRatios: {},
			rotation: 0,
			gettingSharedAsset: this.props.gettingSharedAsset,
			videoLoadingState: {},
		    showVideoModal: false,
		    modalVideoUri: null,
		    videoMetaCache: {},
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
		    composerHeight: 48,
		    replyContainerHeight: 0,
		    // Which contact source the search/list filters against.
		    // 'sylk' = the Sylk contacts in this.props.allContacts,
		    // 'ab'   = the address-book entries in this.props.contacts.
		    // The toggle in the search bar (URIInput) drives this prop.
		    // Custom confirmation dialog (Deleted "Proceed" / Graveyard
		    // "Eject"). Holds {title, message, actions} when open, null
		    // when closed. Replaces the native three-button Alert.alert
		    // that overflowed the right margin in portrait.
		    confirmDialog: null,
		    groupOfImage: {}, // in what groups does an image appear
		    imageGroups: {}, // in which group is an image present
		    selectedImages: [],
		    selectedImagesSearch: [],
		    thumbnailGridSize: {},
		    sharingAssets: [],
            sharingMessages: [],
            showScrollSideButtons: false,
            // Pull-up-to-refresh (server history) spinner state for the
            // inverted chat list's bottom RefreshControl.
            serverHistoryRefreshing: false,
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
            // Trail captured at the moment "Full screen" is tapped, so the
            // fullscreen modal renders the same points the inline bubble was
            // showing even if messagesMetadata is transiently trimmed by an
            // async reload while the modal is open.
            fullScreenLocationTrail: null,
            fullScreenHtml: null,
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
        // Stage 1 verification dump: log the ready contactMessages prop handed down
        // from app.js (app → ReadyBox → ContactsListBox → ChatBox) the moment
        // the chat mounts, before any in-component derivation runs. Summarises
        // the list by content_type so it's easy to cross-check against the
        // app.js "[message] load summary" line for the same contact.
        try {
            const _cv = this.props.contactMessages || [];
            const _byType = {};
            for (const m of _cv) {
                const k = (m && m.contentType) || 'unknown';
                _byType[k] = (_byType[k] || 0) + 1;
            }
            const _fmt = Object.keys(_byType).sort().map(k => `${k}=${_byType[k]}`).join(', ') || '(none)';
            const _uri = this.props.selectedContact && this.props.selectedContact.uri;
            utils.timestampedLog('[contactMessages] ChatBox mount — received', _cv.length,
                'messages for', _uri, '— by contentType:', _fmt);
        } catch (e) {
            console.log('[contactMessages] mount dump failed', e && e.message ? e.message : e);
        }

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

        // The "top Stop button" (SessionButtonsBar) lives up in ReadyBox and
        // has no ref path down to this ChatBox (ReadyBox → ContactsListBox →
        // ChatBox), so it can't call this.stopAudioPlayer() directly. ReadyBox
        // emits SylkStopAudioPlayback when that button is tapped; we listen for
        // it here and tear down the real message player. Without this the top
        // Stop button only cleared the recorder's UI flag and hid itself while
        // the audio kept playing.
        this.stopAudioPlaybackListener = DeviceEventEmitter.addListener(
            'SylkStopAudioPlayback',
            () => {
                try {
                    if (this.currentAudioMessage || (this.state.audioRecordingStatus
                            && 'position' in this.state.audioRecordingStatus)) {
                        utils.timestampedLog('[applog] [audio] [top-stop] received SylkStopAudioPlayback — stopping message playback');
                        this.stopAudioPlayer();
                    } else {
                        utils.timestampedLog('[applog] [audio] [top-stop] received SylkStopAudioPlayback — nothing playing, ignored');
                    }
                } catch (e) { /* swallow — never block the stop request */ }
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
        if (this.stopAudioPlaybackListener) {
            this.stopAudioPlaybackListener.remove();
            this.stopAudioPlaybackListener = null;
        }

        // Tear down the bubble VU ticker so the interval doesn't keep
        // firing setState on an unmounted component.
        if (this._audioBubbleVuInterval) {
            clearInterval(this._audioBubbleVuInterval);
            this._audioBubbleVuInterval = null;
        }

        // Category-filter loading timeout — same hygiene reason.
        if (this._messagesLoadingTimer) {
            clearTimeout(this._messagesLoadingTimer);
            this._messagesLoadingTimer = null;
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
        if (this.state.messageMenu) {
            this.closeMessageMenu();
            return true;
        }
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

    // Migrated off the legacy UNSAFE_componentWillReceiveProps lifecycle.
    // This now runs from componentDidUpdate (see the call near the top of
    // that method). `prevProps` is React's previous-props argument; the
    // local `nextProps` is aliased to the CURRENT props so the body below —
    // originally written against the pre-render `nextProps` — keeps reading
    // naturally. The caller only invokes this when props actually changed,
    // so the unconditional state-mirror at the end of this method can't loop
    // against our own setState calls.
    //
    // Behavioural note: under CWRP this body ran *before* render; under CDU
    // it runs *after*. Its setState calls therefore schedule one extra
    // render pass instead of being folded into the current one. The existing
    // prevState-driven branches in componentDidUpdate pick up those state
    // changes on that follow-up pass, preserving the original
    // "CWRP sets state → render → CDU reacts" ordering. Every branch here is
    // already guarded by a `nextProps.X !== this.state.X` (or `in`/`hasOwn`)
    // check, so the derived-state writes settle in one extra pass rather
    // than looping.
    _syncStateFromProps(prevProps) {
        const nextProps = this.props;
        if (this.ended) {
            return;
        }

        // [audio-debug] CWRP props.messages-changed log — DISABLED.
        // Re-enable to confirm whether App.setState({messages}) is
        // reaching ContactsListBox during playback (frozen-bubble
        // diagnosis).

        // NOTE: composerHeight / replyContainerHeight are NOT props —
        // they are local state seeded from literals (48 / 0) and updated
        // from measured layout heights (onComposerLayout /
        // onReplyContainerLayout). The old sync blocks here read
        // nextProps.composerHeight / nextProps.replyContainerHeight,
        // which are never passed, so they were dead no-ops (and would
        // have stomped the measured value if a prop ever appeared).
        // Removed.

		if (nextProps.selectedContact !== this.state.selectedContact) {
		    // Reset the per-transfer viewport guard so re-opening a chat retries
		    // download/decrypt of visible attachments (e.g. ones that couldn't
		    // decrypt before a key was imported).
		    this._fileViewKicked = new Set();
		    if (!nextProps.selectedContact && nextProps.selectedContact) {
				console.log('Selected contact changed to', nextProps.selectedContact.uri);
            }
            if (!nextProps.selectedContact) {
				this.resetContact()
            }
            this.setState({selectedContact: nextProps.selectedContact});

            if (nextProps.selectedContact) {
               this.setState({scrollToBottom: true});
               // Load the full-history date index for this contact
               // so the calendar bar pills reflect every day the
               // conversation has messages — independent of the
               // windowed slice that getMessages loads into
               // renderMessages. Fire-and-forget; the setState
               // happens when the SQL resolves.
               this._loadContactDateIndex(nextProps.selectedContact);
            } else {
                this.setState({renderMessages: [], contactDateIndex: []});
            }
            // Always drop any in-flight category-filter overlay when
            // the contact changes — the loading flag was set for the
            // previous contact's fetch, and the new contact's
            // messages have their own arrival path. Leaving it set
            // would strand the dim layer over the new conversation
            // until something else cleared it. Cancel the timeout
            // fallback too so it can't fire stale against the new
            // contact.
            if (this._messagesLoadingTimer) {
                clearTimeout(this._messagesLoadingTimer);
                this._messagesLoadingTimer = null;
            }
            if (this.state.messagesLoading) {
                console.log('[messagesLoading] false — contact changed');
                this.setState({messagesLoading: false});
            }
        };
        
        // load only messages that have changed
		if (nextProps.selectedContact) {
		  const uri = nextProps.selectedContact.uri;

		  // New model: the rendered list is the app-built `contactMessages`
		  // for the selected contact (was nextProps.messages[uri]). app.js
		  // keeps it current through every add/update/delete path, so ChatBox
		  // no longer reads the legacy per-uri map. The change-detection /
		  // merge below still runs to preserve unchanged bubble refs.
		  if (Array.isArray(nextProps.contactMessages)) {
			const oldMessages = this.state.renderMessages || [];

			// contactMessages already arrives newest → oldest (DESC) from
			// app.js _buildContactMessages, with the same _id/msg_id tie-break
			// the old inline sort used — so we consume it as-is. No re-sort.
		    let newMessages = [...nextProps.contactMessages];

			// === INITIAL LOAD ===
			if (oldMessages.length === 0 && newMessages.length > 0) {
			  this.exitFocusMode();

			  // Stage 2: boot the chat from the ready `contactMessages` prop
			  // (built + DESC-sorted by app.js getMessages) when it's present,
			  // instead of the locally re-sorted messages[uri] copy. This is
			  // the first consumer of the new object. componentDidUpdate still
			  // derives filteredMessages (media labels / reply ids / search /
			  // sort) from renderMessages — we're only swapping the SOURCE of
			  // the first renderMessages to the app-provided list. Falls back
			  // to the legacy merged list if the prop hasn't arrived yet.
			  const _initial = (Array.isArray(nextProps.contactMessages)
			          && nextProps.contactMessages.length > 0)
			      ? nextProps.contactMessages
			      : newMessages;
			  console.log('[contactMessages] initial load —',
			      _initial === newMessages ? 'legacy messages[uri]' : 'contactMessages prop',
			      '(' + _initial.length + ' messages) for', uri);

			  // Seed filteredMessages too. On initial load there is no
			  // active category/search/date filter, so the rendered list
			  // equals renderMessages — and the componentDidUpdate
			  // pipeline only *re-derives* filteredMessages when a filter
			  // state actually changes, which doesn't happen on a plain
			  // chat open. Without seeding it here the list stayed empty
			  // (renderMessages populated, filteredMessages=[]), so the
			  // chat rendered blank even though messages had loaded. If a
			  // filter IS active the pipeline recomputes on the next pass.
			  this.setState({
				renderMessages: _initial,
				filteredMessages: _initial,
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
			  "position",
			  // Flipped true when the server-history sync enriches a
			  // call system message with trace params. Watching it here
			  // makes the metadata-only change propagate into
			  // renderMessages so the bubble becomes tappable/underlined.
			  "traceReady"
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

        // myInvitedParties, contacts, orderBy, sortOrder, favoriteUris,
        // blockedUris and accountId (account.id) were pure prop-mirrors —
        // their sync blocks were removed; the component reads them straight
        // from this.props now, so there's nothing to sync here.


        if (nextProps.messageZoomFactor !== this.state.messageZoomFactor) {
            this.setState({scrollToBottom: false, messageZoomFactor: nextProps.messageZoomFactor});
        }

        // Search-bar closed (user tapped X). Reset the whole
        // search/filter environment so the chat returns to its
        // default state — no pills, no category, no date narrow,
        // no loading overlay, default window of recent messages
        // restored on the next CWRP getMessages. Triggered on the
        // searchMessages prop transitioning from true → false.
        // ReadyBox's own CDU already clears messagesCategoryFilter
        // in this case, but the date-filter state lives in
        // ContactsListBox so it's our responsibility to wipe.
        if ('searchMessages' in nextProps
                && prevProps.searchMessages
                && !nextProps.searchMessages) {
            console.log('[search] bar closed — resetting date filter + pills');
            this.setState({
                dateYear: null,
                dateMonth: null,
                dateDay: null,
                availableYears: [],
                availableMonths: [],
                availableDays: [],
                messagesLoading: false,
            });
            if (this._messagesLoadingTimer) {
                clearTimeout(this._messagesLoadingTimer);
                this._messagesLoadingTimer = null;
            }
        }

        if ('messagesCategoryFilter' in nextProps) {
			if (nextProps.messagesCategoryFilter !== this.state.messagesCategoryFilter && nextProps.selectedContact) {
				// Block back-to-back filter taps: while the previous
				// getMessages is still resolving, ignore further chip
				// taps. Without this guard a fast tap on (image →
				// video) would fire two SQL slices whose completions
				// race — the user could see image bubbles briefly
				// after picking Video, or vice versa. The overlay
				// already tells the user "work is in progress"; this
				// just makes the input match what the overlay
				// promises (one fetch at a time).
				if (this.state.messagesLoading) {
					console.log('[messagesLoading] filter change ignored, previous fetch still in flight:', nextProps.messagesCategoryFilter);
					return;
				}
				// "Go to chat on this day" carve-out. The grid's
				// chat-icon button does its own coordinated state
				// update (clears category at the parent AND sets
				// dateYear/Month/Day locally AND fires
				// _refetchForDateSelection with explicit range).
				// We must NOT take the normal "category changed,
				// wipe the date filter + refetch default window"
				// path here — that would erase the very pills the
				// user just navigated to. Flag is one-shot:
				// consume it and refresh the date index against
				// the new (null) category, then bail out before
				// the resets below.
				if (this._suppressNextCategoryReset) {
					this._suppressNextCategoryReset = false;
					console.log('[goToDay] category-change CWRP suppressed — preserving date filter');
					this._loadContactDateIndex(
						nextProps.selectedContact,
						nextProps.messagesCategoryFilter,
						nextProps.pinned);
					return;
				}
				// Immediately blank the chat surface and raise the
				// loading overlay so the user can see that the new
				// category is being fetched. Without this the
				// previous category's bubbles stayed on-screen
				// until getMessages resolved (can be several
				// hundred ms on large histories), making the chip
				// feel unresponsive and the eventual swap appear
				// out of nowhere.
				//
				// Also reset the date-period filter and any
				// selected tag — date tags ("May 2026", "Week 21")
				// are scoped to the previous category's results
				// and don't carry meaning across a media-type
				// switch (per UX spec: reset when media type or
				// period changes). availableYears / Months / Days
				// will refill from the new category's messages
				// once they land.
				this.setState({
					renderMessages: [],
					messagesLoading: true,
					dateYear: null,
					dateMonth: null,
					dateDay: null,
					availableYears: [],
					availableMonths: [],
					availableDays: [],
				});
				// Refresh the per-contact date index against the
				// new category so the calendar pills re-derive
				// from the right slice (e.g. only days that have
				// images when the user picks the Image chip).
				this._loadContactDateIndex(
					nextProps.selectedContact,
					nextProps.messagesCategoryFilter);
				console.log('[messagesLoading] true — fetching category:', nextProps.messagesCategoryFilter);
				// Hard timeout fallback. Two cases the CDU-based
				// clear (watching renderMessages flip from [] to
				// non-empty) misses:
				//   • Category with zero results — renderMessages
				//     stays [] forever.
				//   • SQL slice fails or the parent never re-emits
				//     messages for this uri.
				// Clear the overlay after a generous ceiling so the
				// UI can't get stuck. Stored on `this` so a follow-
				// up filter change (or contact change) can cancel
				// the previous timer before queueing a new one.
				if (this._messagesLoadingTimer) {
					clearTimeout(this._messagesLoadingTimer);
				}
				this._messagesLoadingTimer = setTimeout(() => {
					this._messagesLoadingTimer = null;
					if (this.state.messagesLoading) {
						console.log('[messagesLoading] false — timeout fallback (no data within 5s)');
						this.setState({messagesLoading: false});
					}
				}, 5000);
				this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: this.props.pinned});
			}
        }

        if (nextProps.pinned !== prevProps.pinned && nextProps.selectedContact) {
            // Pinned is a cumulative modifier (stacks on the
            // active category). Toggling it changes the universe
            // of messages, so wipe any date-filter state the user
            // had selected against the previous universe — same
            // reset the category-change branch does. Then refresh
            // the per-contact date index against the new flag so
            // pills line up with the new visible set.
            console.log('[pinned] toggled to', !!nextProps.pinned,
                '— resetting date filter + refreshing date index');
            this.setState({
                renderMessages: [],
                messagesLoading: true,
                dateYear: null,
                dateMonth: null,
                dateDay: null,
                availableYears: [],
                availableMonths: [],
                availableDays: [],
            });
            this._loadContactDateIndex(
                nextProps.selectedContact,
                nextProps.messagesCategoryFilter,
                nextProps.pinned);
            this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: nextProps.pinned});
        }

        if (nextProps.hasOwnProperty('keyboardVisible')) {
            this.setState({keyboardVisible: nextProps.keyboardVisible});
        }
        
        if ('gettingSharedAsset' in nextProps) {
            this.setState({gettingSharedAsset: nextProps.gettingSharedAsset});
        }

		if ('audioRecordingStatus' in nextProps) {
			this.setState({audioRecordingStatus: nextProps.audioRecordingStatus});
		}
 
        // isLandscape / isTablet are pure prop-mirrors (orientation +
        // device class are owned by the parent) — read this.props.* directly.
        // The ~30 props formerly mirrored here are now read directly from
        // this.props at the use sites (pure pass-throughs). Only the
        // seeded-then-locally-mutated values stay in state and keep syncing:
        //   • isTyping               — reset to false by the typing timer below
        //   • messagesCategoryFilter — cleared by the date-nav handler (8613)
        //   • showDeleteMessageModal — toggled by the delete open/close handlers
        // Derived reads (filter=contactsFilter, targetUri, selectMode,
        // graveyardContacts||[], contactSource||'sylk') are computed inline
        // from props at their use sites now.
        this.setState({isTyping: nextProps.isTyping,
                       messagesCategoryFilter: nextProps.messagesCategoryFilter,
                       showDeleteMessageModal: nextProps.showDeleteMessageModal,
                       })

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
        // NOTE: do NOT clear replyingTo here. Dismissing the soft keyboard is
        // not a "cancel reply" gesture — it fires whenever the keyboard goes
        // away for ANY reason, including when we call Keyboard.dismiss()
        // ourselves to open the in-app emoji picker (toggleEmojiPicker). Wiping
        // replyingTo on keyboard-hide was dropping the reply context the moment
        // the picker opened, so the emoji went out as a standalone message with
        // no reply metadata. Reply is cancelled explicitly via the preview's X
        // button and cleared on send (onSendMessage); keyboard hide leaves it
        // intact (WhatsApp/Telegram behaviour).
        this.setState({
            keyboardVisible: false,
            keyboardHeight: 0,
            keyboardOverlap: 0,
        });
        this.textInputRef?.blur();
    }

	  getAudioDuration = (filePath, messageId, message = null) => {
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
		  // Keep the precise (float) length — the duration label floors it
		  // for display, and AudioTimeScale needs the exact value so its
		  // markers line up with the slider/waveform.
		  let duration = sound.getDuration();
		  this._audioDurationsInFlight.delete(messageId);
		  // Persist the freshly-probed duration into the message metadata +
		  // DB so it's never recomputed: updateFileTransferMetadata writes
		  // the DB (survives reload) AND rebuilds the bubble in-place via
		  // updateFileTransferBubble (immediate re-render — the row picks up
		  // metadata.duration without waiting for a contact reload). Use the
		  // message object passed from renderMessageAudio so the transfer_id/
		  // sender/receiver are the real ones the updater looks up by.
		  try {
			const _md = message && message.metadata;
			if (_md && _md.transfer_id
				&& !(typeof _md.duration === 'number' && _md.duration > 0)
				&& typeof this.props.updateFileTransferMetadata === 'function') {
			  this.props.updateFileTransferMetadata(_md, 'duration', duration);
			}
		  } catch (e) { console.log('[audio] persist duration failed', e && e.message); }
		  this.setState((prevState) => {
			const audioDurations = {
			  ...prevState.audioDurations,
			  [messageId]: duration,
			};
			// The duration resolves async AFTER the bubble first rendered.
			// GiftedChat's FlatList rows are PureComponents keyed by the
			// message item, so a plain audioDurations state change does NOT
			// re-render the already-cached audio row — it keeps showing the
			// "Recording" fallback and no time scale. Clone the affected
			// message in renderMessages (fresh ref) so the FlatList row
			// invalidates and re-runs renderMessageAudio, which then reads
			// the now-available duration. Same trick as onAudioBubbleScrubChange.
			const oldRender = prevState.renderMessages || [];
			let touched = false;
			const renderMessages = oldRender.map((m) => {
			  if (!m || m._id !== messageId) return m;
			  touched = true;
			  // Fresh refs (top-level + metadata) so the FlatList row
			  // invalidates, and stamp the duration onto the metadata so
			  // later renders read it directly and never re-probe.
			  return { ...m, metadata: { ...(m.metadata || {}), duration } };
			});
			return touched ? { audioDurations, renderMessages } : { audioDurations };
		  });
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
		// Keep the "Processing content..." overlay up — assetSharingCallback
		// below runs file2GiftedChat per asset (thumbnailing / copying), which
		// takes a few seconds. Clearing the flag here left that window with no
		// feedback. The error / empty / cancel branches clear it explicitly.
		this.setState({fullSize: false, gettingSharedAsset: true});

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

    // Generate a poster thumbnail for a video uri, mirroring the platform
    // split renderMessageVideo uses (createThumbnailSafe on Android,
    // createThumbnail on iOS). Returns a path or null on failure.
    async _generateVideoThumbnail(uri) {
        try {
            if (Platform.OS === 'android') {
                return await createThumbnailSafe({ url: uri, timeMs: 1000 });
            }
            const { path } = await createThumbnail({ url: uri, timeStamp: 1000 });
            return path;
        } catch (e) {
            console.log('Thumbnail generation failed (preview):', e);
            return null;
        }
    }

    async assetSharingCallback(assets) {
        console.log('assetSharingCallback', assets.length);
		// Show the overlay while we build the preview messages — the
		// file2GiftedChat loop below is the slow part the user was waiting
		// on with no feedback. Cleared in the final setState (and the
		// empty-guard return just below).
		this.setState({scrollToBottom: true, gettingSharedAsset: true});
		this.scrollToBottom();

        if (!assets || assets.length === 0) {
            this.setState({gettingSharedAsset: false});
            return;
        }

        let messages = [];
        let msg;
        let assetType = 'file';
        const thumbCacheAdditions = {};

        for (const asset of assets) {
			asset.preview = true;
			msg = await this.props.file2GiftedChat(asset);
			if (msg.video) {
				assetType = 'movie';
				// Build the thumbnail NOW, before the preview is shown, so the
				// video bubble renders complete in a single step. Previously
				// renderMessageVideo generated it lazily on first render — that
				// async pass is what made the asset look like it needed a
				// second tap to reach the preview. The "Processing content..."
				// overlay covers this extra moment.
				if (!msg.thumbnail) {
					const thumb = await this._generateVideoThumbnail(msg.video);
					if (thumb) {
						msg.thumbnail = thumb;
						if (msg.metadata) { msg.metadata.thumbnail = thumb; }
						thumbCacheAdditions[msg._id] = { thumbnail: thumb, width: 512, height: 512 };
					}
				}
			} else if (msg.image) {
				assetType = 'photo';
			} else if (msg.audio) {
				assetType = 'audio';
			}
			messages.push(msg);

			console.log('Build temporary', assetType, 'message', msg._id);
        }

        this.setState(prev => ({ sharingAssets: assets,
                        sharingMessages: messages,
                        renderMessages: GiftedChat.append(messages, []),
						fullSize: false,
						gettingSharedAsset: false,
						// Seed the thumbnail cache so renderMessageVideo finds the
						// thumbnail immediately and skips its lazy-generation path.
						videoMetaCache: { ...prev.videoMetaCache, ...thumbCacheAdditions },
                        //placeholder: 'Send ' + assetType + ' of ' + utils.beautySize(msg.metadata.filesize)
						placeholder: 'Add a note, or just click Send...'
                        }));
    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props}
         recordAudio={this.props.recordAudio}
         isAudioRecording={this.props.isAudioRecording}
         recordingFile={this.props.recordingFile}
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
        // The composer smiley is unambiguously a "compose/append" affordance,
        // never a "react" one. Any pending reaction target left over from a
        // previously-abandoned ReactionBar "+" open (openReactionPicker) must
        // be dropped here — otherwise the next emoji selection would route
        // through the reaction branch of handleEmojiSelected (quickReact),
        // firing the emoji as its own message and discarding the composer's
        // reply context (replyingTo). See handleEmojiSelected.
        this._pendingReactionTarget = null;

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
        // Closing the picker abandons any in-flight reaction "+" selection,
        // so drop the stashed target too. Leaving it set would let a later
        // composer-driven emoji pick get hijacked into quickReact (losing the
        // reply context). The reaction path itself clears the target *before*
        // it ever reaches here (handleEmojiSelected), so this is safe.
        this._pendingReactionTarget = null;
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

	renderFullSizeToggle = (currentMessage) => {
	  const sm = this.state.sharingMessages || [];
	  const _noun = (list) => {
	    const hasVid = list.some(m => m.video);
	    const hasImg = list.some(m => m.image);
	    if (hasVid && !hasImg) return 'videos';
	    if (hasVid && hasImg) return 'items';
	    return 'images';
	  };
	  let label;
	  if (sm.length > 1) {
	    const total = sm.reduce((acc, m) => acc + ((m.metadata && m.metadata.filesize) || 0), 0);
	    const noun = _noun(sm);
	    label = total > 0
	      ? `Full size of ${formatFileSize(total)} (${sm.length} ${noun})`
	      : `Full size (${sm.length} ${noun})`;
	  } else {
	    label = currentMessage.metadata?.filesize
	      ? 'Full size of ' + formatFileSize(currentMessage.metadata.filesize)
	      : 'Full size';
	  }
	  return (
	    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
	      <Switch
	        value={!!this.state.fullSize}
	        onValueChange={() => this.setState(prev => ({ fullSize: !prev.fullSize }))}
	        trackColor={{ false: '#767577', true: '#34C759' }}
	        thumbColor={'#ffffff'}
	        ios_backgroundColor="#767577"
	        style={Platform.OS === 'ios' ? { transform: [{ scale: 0.8 }] } : {}}
	      />
	      <Text style={[styles.checkboxLabel, { marginTop: 0, marginLeft: 6, color: 'white' }]}>
	        {label}
	      </Text>
	    </View>
	  );
	};

	renderBubbleWithMessages = (props) => {
	  return this.renderBubble({ ...props, messages: this.state.filteredMessages });
	};

	renderBubble(props) {
	  const message = props.currentMessage;
	  const bubble = (
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
		  imageAspectRatios={this.state.imageAspectRatios}
		  handleBubbleLayout={this.handleBubbleLayout}
		  scrollToMessage={this.goToMessage}
		  transferProgress={this.props.transferProgress}
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
		  sortOrder={this.props.orderBy}
		  styles={styles}
		/>
	  );
	  // Swipe-to-reply is applied one level up, around the whole message
	  // ROW (see renderMessageRow), not here. Wrapping an individual
	  // bubble fought each bubble type's own width/alignment (text was
	  // fine, but image bubbles overflowed the left edge). The Message
	  // component already aligns every bubble type correctly, so we wrap
	  // that instead and leave the bubble untouched.
	  return bubble;
	}

	// Wrap each gifted-chat message ROW in a lightweight swipe-to-reply
	// gesture (SwipeReplyRow = Gesture.Pan + GestureDetector). Unlike
	// react-native-gesture-handler's <Swipeable>, it renders no action
	// panes and animates nothing until a row is actually being dragged, so
	// it doesn't bog down the chat. Wrapping the ROW (not the bubble) keeps
	// gifted-chat's per-type alignment intact and preserves vertical
	// scrolling and bubble tap / long-press. Skipped in read-only chats and
	// for system messages.
	renderMessageRow(messageNode, message) {
	  const canReply = !!(message && message._id)
	      && !this._chatIsReadOnly()
	      && message.system !== true;
	  if (!canReply) {
	      return messageNode;
	  }
	  return (
	      <SwipeReplyRow
	          onReply={() => this.replyMessage(message)}
	          onHaptic={() => { try { Vibration.vibrate(10); } catch (e) { /* optional */ } }}
	      >
	          {messageNode}
	      </SwipeReplyRow>
	  );
	}

   exitFullScreen() {
		this.props.setFullScreen(false);
		this.setState({
			expandedImage: null,
			expandedImageSize: null,
			expandedImageMissing: false,
			expandedImageDownloading: false,
		});
   }
	
	onImagePress = (message) => {
	  const { expandedImage } = this.state;
	  console.log('onImagePress', 'fullScreen', this.props.fullScreen);

	  if (expandedImage) {
		this.saveRotation(expandedImage._id, this.state.rotation);
		this.exitFullScreen();
	  } else {
	    let rotation = 0;
		this.props.setFullScreen(true);
		if (message._id in this.state.mediaRotations) {
			rotation = this.state.mediaRotations[message._id];
		}
		// Pre-resolve dimensions so react-native-image-zoom-viewer doesn't
		// have to call Image.getSize itself — that call fails on iOS 26 for
		// the bare absolute local-file paths we use, leaving the viewer
		// black. We supply a screen-size fallback so the image always
		// renders even when getSize never resolves; the renderImage
		// callback below then detects onError to swap in a friendly
		// "file not available" placeholder instead of a black void.
		const win = Dimensions.get('window');
		const fallbackSize = {width: win.width, height: win.height};
		this.setState({
			expandedImage: message,
			rotation: rotation,
			expandedImageSize: null,
			expandedImageMissing: false,
			expandedImageDownloading: false,
		});

		// On iOS, msg.image is a bare /var/mobile/... path (utils.sylk2GiftedChat
		// drops the file:// prefix on iOS). Image.getSize needs a real URL
		// scheme, so prepend file:// before asking.
		const rawUri = message.image;
		const probeUri = (Platform.OS === 'ios' && rawUri && rawUri.startsWith('/'))
			? 'file://' + rawUri
			: rawUri;

		// Captured for the missing-file log so the per-message identifiers
		// are visible without re-reading state from the failure path.
		const _logMsgId = message && message._id;
		const _logTransferId = message && message.metadata && message.metadata.transfer_id;

		let settled = false;
		const finish = (dims, missing, reason) => {
			if (settled) return;
			settled = true;
			if (missing) {
				console.log('[image-viewer] missing file',
					'reason=', reason,
					'msgId=', _logMsgId,
					'transferId=', _logTransferId || '(none)',
					'uri=', rawUri);
			}
			this.setState({expandedImageSize: dims, expandedImageMissing: !!missing});
		};
		// Important: timeout falls back to screen dims WITHOUT marking
		// missing. Slow native callbacks (seen under load on iOS 26)
		// don't mean the file is gone. The real "missing" signal comes
		// from getSize's fail callback or <Image>'s onError below.
		const timer = setTimeout(() => finish(fallbackSize, false), 2000);
		try {
			Image.getSize(
				probeUri,
				(w, h) => { clearTimeout(timer); finish({width: w, height: h}, false); },
				(err) => {
					clearTimeout(timer);
					finish(fallbackSize, true,
						'getSize failed: ' + (err && (err.message || String(err))));
				},
			);
		} catch (e) {
			clearTimeout(timer);
			finish(fallbackSize, true, 'getSize threw: ' + (e && e.message));
		}
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
		  const bottomInset = this.props.insets?.bottom || 0;
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
	      this.props.isAudioRecording ||
	      !!this.props.recordingFile);

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
					{replyingTo.contentType === 'text/html' ? utils.html2text(replyingTo.html || replyingTo.text) : replyingTo.text}
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
				  right: 8,
				  zIndex: 10,
				}}
				hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
			{(this.props.isAudioRecording || !!this.props.recordingFile) ? null : (
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
			  editable={!this.props.isAudioRecording && !this.props.recordingFile}
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
	  
	  // Attachments (camera + paperclip) are now shown for every
	  // contact, including 'test'-tagged ones. (Previously the 'test'
	  // tag hid them.)
	  let disableAttachments = false;
	  
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
	  } else if (this.props.isAudioRecording) {
		// A recording is actively in progress. Surface an explicit
		// STOP button in the right slot so the user always has an
		// unambiguous way to end the take. Tapping it forwards to
		// this.props.recordAudio, which (when state.recording is true)
		// toggles to onStopRecord in ReadyBox — the same handler the
		// left pause control uses. Previously this branch fell through
		// to the idle case where every button was hidden, leaving a
		// recording that couldn't be stopped from the composer.
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
			  <TouchableOpacity onPress={this.props.recordAudio}>
				<Icon
				  type="font-awesome"
				  name="stop"
				  style={styles.chatSendArrow}
				  size={22}
				  color="red"
				/>
			  </TouchableOpacity>
			</View>
		  </Send>
		);
	  } else if (this.props.recordingFile) {
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

		let showButtons = !this.state.texting && !this.state.replyingTo && !this.props.isAudioRecording && !this.props.recordingFile;

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
		// Hide AND disable the voice-message mic while a call or
		// conference is active. this.props.call is set by app.js
		// (incomingCall || currentCall, 1-to-1 or conference) and
		// flows down via ReadyBox; it's null when idle. Recording a
		// voice message would contend with the live call's microphone
		// capture, so the record affordance must not be offered during
		// a call. Not rendering the TouchableOpacity removes the tap
		// target entirely (hidden + disabled in one).
		const callActive = !!this.props.call;
		// canRecordAudio mirrors ReadyBox.showAudioRecordButton — the
		// same per-contact / permission gate the header Record-audio
		// button uses. When recording isn't allowed for the selected
		// contact (conference room, anonymous, phone number, test stub,
		// denied mic permission) the input-bar mic must stay hidden too,
		// so the composer doesn't offer an action that can't complete.
		// Defaults to true when the prop isn't supplied so existing
		// callers that don't pass it keep the prior behaviour.
		const recordingAllowed = this.props.canRecordAudio !== false;
		const showMic = recordingAllowed && !showSendArrow && !this.props.isAudioRecording && !this.props.recordingFile && !callActive;
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
			utils.timestampedLog('[applog] [audio] [start] enter', _kind,
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

		// Route playback to the AudioRecorder player card (it owns the
		// waveform/spectrum/slider/seek plumbing) instead of playing in-bubble.
		// ReadyBox listens for SylkPlayMessageAudio and drives the recorder,
		// which renders while the chat list is hidden — so GiftedChat's FlatList
		// is unmounted during playback and can't reconcile per tick. This is
		// what makes stop instant and the levels/spectrum animate smoothly (the
		// in-bubble path re-rendered the whole message list ~10x/sec and starved
		// the JS thread, so a stop tap sat queued for ~10s).
		try {
			const md = message.metadata || {};
			DeviceEventEmitter.emit('SylkPlayMessageAudio', {
				path: message.audio,
				tid: md.transfer_id,
				title: md.call_recording === true ? 'Call recording' : 'Voice message',
				createdAt: message.createdAt || null,
				peaks: md.peaks || { l: [], r: [] },
				spectrum: md.spectrum || null,
				durationSec: (typeof md.duration === 'number' && md.duration > 0)
					? md.duration
					: (this.state.audioDurations && this.state.audioDurations[message._id]) || 0,
				position: md.position || 0,
			});
			utils.timestampedLog('[applog] [audio] [start] routed to recorder player',
				'tid=', md.transfer_id);
		} catch (e) {
			console.log('[startAudioPlayer] route-to-recorder failed', e && e.message);
		}
		return;

		// Already playing THIS exact message — no-op. Use the synchronous
		// instance ref `currentAudioMessage` (set in the playback listener,
		// cleared by stopAudioPlayer) instead of `state.audioRecordingStatus`,
		// which lags by one async setState round and used to bail on every
		// tap-to-replay (especially after the synchronous audioRecordingStatus
		// seed lower in this function set transfer_id pre-emptively, so the
		// state.transfer_id always matched id on subsequent taps and the
		// function returned before reaching audioRecorderPlayer.startPlayer).
		if (this.currentAudioMessage && this.currentAudioMessage._id === id) {
			try {
				utils.timestampedLog('[applog] [audio] [start] no-op — already playing this message',
					'_id=', id);
			} catch (_e) {}
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
			// One-shot: mark the bubble 'playing' exactly once (not on every
			// tick). updateFileTransferMetadata rebuilds the whole message
			// list, so calling it ~20x/sec starved the UI thread and the
			// play/pause tap got queued behind the churn — by the time it
			// ran, playback had ended and the toggle re-STARTED it. Once is
			// enough; the bubble stays 'playing' until stop.
			let playingMarked = false;
			// Throttle the per-tick slider setState so the row re-renders at
			// ~10 fps instead of the 50 ms tick rate — smooth enough, and
			// keeps the touch handler responsive.
			let lastUiWall = 0;
			// Stall watchdog — track the player's REAL position so we can
			// tell "audio finished" / "audio wedged" from the wall clock
			// (which keeps marching regardless). Updated whenever
			// e.currentPosition advances.
			let lastPlayerPos = -1;
			let lastPlayerAdvanceWall = Date.now();
			this.currentAudioDurationMs = 0;
			this.currentAudioMessage = message;

			audioRecorderPlayer.addPlayBackListener((e) => {
				if (!e.duration || e.duration <= 0) return;
				// Disarm the silent-decoder watchdog the moment we get
				// a meaningful tick — file is decoding fine.
				this._anyTickReceived = true;

				const duration = Math.floor(e.duration);
				this.currentAudioDurationMs = duration;
				// Android's MediaPlayer.getCurrentPosition() (e.currentPosition)
				// advances at roughly fileSampleRate/outputSampleRate for
				// low-rate AAC — our 16 kHz voice notes tick at ~0.36x real
				// time (≈16000/44100), so the slider/waveform/spectrum used
				// to crawl to ~25-30% and freeze while the audio (which plays
				// at normal speed) finished. getDuration() IS correct, so we
				// derive the playback position from the wall clock instead.
				// playStartWall is rebased right after the initial seek below,
				// so this honours a resume-from-saved-position too.
				const current = Math.max(0, Math.min(duration, Date.now() - playStartWall));

				if (!message.metadata.position || message.metadata.position === 100) {
					message.metadata.position = 0;
				}

				if (!message.metadata.consumed) {
					message.metadata.consumed = 0;
				}

				if (!playingMarked) {
					playingMarked = true;
					this.props.updateFileTransferMetadata(message.metadata, 'playing', true);
				}

				if (!hasSeeked) {
					const seekPosition = (message.metadata.position / 100) * duration;
					console.log('Seek to', (seekPosition / 1000).toFixed(1) + 's',
					    'of', (duration / 1000).toFixed(1) + 's');
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
				// Track the player's REAL position to detect end / stall.
				const _playerPos = Math.floor(e.currentPosition);
				if (_playerPos > lastPlayerPos + 10) {
					lastPlayerPos = _playerPos;
					lastPlayerAdvanceWall = now;
				}
				const stalledMs = now - lastPlayerAdvanceWall;

				// Decide "ended":
				//   - playerCompleted: the player fired its completion event
				//     (the authoritative true end) — good files finish here.
				//   - endStall: the wall clock has reached the end AND the
				//     player position has stopped advancing — the audio is
				//     done but no completion event arrived. Short grace.
				//   - midStall: the player position has been frozen for a long
				//     time mid-clip — the audio is wedged (e.g. an incoming
				//     file played before it finished downloading). Abort so
				//     the bubble doesn't hang on the pause icon.
				// The pure wall-clock finish was removed: the wall clock is
				// decoupled from the real audio, so on its own it truncated
				// stalled clips and masked the wedge.
				const playerCompleted = (e.isFinished === true);
				const nearEnd = current >= (duration - 60);
				const endStall = nearEnd && stalledMs > 600;
				const midStall = stalledMs > 3000;
				const isFinished = playerCompleted || endStall || midStall;

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
				} else if ((now - lastUiWall) >= 100) {
					// Throttled to ~10 fps so the FlatList row isn't rebuilt
					// on every 50 ms tick (keeps the play/pause tap snappy).
					lastUiWall = now;
					// Refresh ONLY the playing bubble's row (fresh top-level +
					// metadata refs) so its FlatList row cache invalidates and
					// re-renders — the play/pause icon, VU levels, spectrum and
					// slider all read from this row + audioRecordingStatus. We
					// do this locally in ChatBox state instead of calling
					// updateFileTransferMetadata (which rebuilds the ENTIRE list
					// in the parent and cascades a full re-render back down — the
					// per-tick version of that saturated the JS thread and made
					// the stop tap take ~10 s). Cloning one row out of the list
					// is ~1 shallow map/tick and re-renders a single bubble. Same
					// trick onAudioBubbleScrubChange uses for the scrub needle.
					const _tid = message.metadata && message.metadata.transfer_id;
					const _oldRender = this.state.renderMessages || [];
					let _touched = false;
					const _newRender = _oldRender.map((m) => {
						if (!m || !m.metadata || m.metadata.transfer_id !== _tid) return m;
						_touched = true;
						return {
							...m,
							position: percentage,
							playing: true,
							metadata: { ...m.metadata, position: percentage, playing: true },
						};
					});
					const _upd = {
						audioRecordingStatus: {
						  metadata: message.metadata,
						  duration: audioRecorderPlayer.mmssss(duration),
						  position: percentage,
						  positionMs: current,
						  durationMs: duration,
						},
					};
					if (_touched) _upd.renderMessages = _newRender;
					this.setState(_upd);
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
		// Drive the live drag highlight for ALL audio bubbles, not just
		// call recordings — voice memos were excluded here, so their
		// waveform/spectrum only updated from `position` after release
		// and lagged the slider needle by a couple of seeks.
		if (!md) return;
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
	
    // Single entry point for the bubble's play/pause button. The button
    // has TWO onPress handlers (the TouchableHighlight wrapper, which
    // claims taps in the padding, and the inner IconButton), so one tap
    // fires it twice in quick succession. Toggling on the render-time
    // `isPlaying` closure meant the first fire stopped playback and the
    // second — after the re-render flipped isPlaying to false — RESTARTED
    // it, so pause never stuck. We instead decide from the live
    // currentAudioMessage ref and debounce duplicate fires within one tap.
    toggleAudioPlayback(message) {
		const now = Date.now();
		const debounced = !!(this._audioToggleAt && (now - this._audioToggleAt) < 350);
		const playingThis = this.currentAudioMessage
			&& message && message._id
			&& this.currentAudioMessage._id === message._id;
		// Diagnostic: log EVERY tap on the bubble play/pause button before any
		// decision. The button wires the same handler to both the outer
		// TouchableHighlight and the inner IconButton, so a single physical tap
		// fires this twice; the `debounced` flag tells them apart. Chasing
		// "the stop button in the bubble doesn't react" starts here — if there
		// is no [toggle] line at all, the tap never reached JS; if there is one
		// but action=none it was debounced; if action=stop we entered stop.
		try {
			utils.timestampedLog('[applog] [audio] [toggle] tap',
				'_id=', message && message._id,
				'tid=', message && message.metadata && message.metadata.transfer_id,
				'playingThis=', !!playingThis,
				'debounced=', debounced,
				'sinceLastTapMs=', this._audioToggleAt ? (now - this._audioToggleAt) : null,
				'currentAudioMessage=', this.currentAudioMessage && this.currentAudioMessage._id,
				'action=', debounced ? 'none(debounced)' : (playingThis ? 'stop' : 'start'));
		} catch (_e) {}
		if (debounced) {
			return;   // swallow the duplicate fire from the second handler
		}
		this._audioToggleAt = now;
		if (playingThis) {
			this.stopAudioPlayer();
		} else {
			this.startAudioPlayer(message);
		}
    }

    async stopAudioPlayer() {
		// Support-log line for playback stop. Greppable as [applog]
		// ... [audio] stop ...; pairs with the [audio] start line so a
		// playback session shows up as a clean start/stop pair in the
		// support log.
		let _stMd = {};
		try {
			_stMd = (this.state.audioRecordingStatus && this.state.audioRecordingStatus.metadata) || {};
			const _msg = this.currentAudioMessage || {};
			const _kind = (_stMd.call_recording === true) ? 'call_recording' : 'voice_msg';
			utils.timestampedLog('[applog] [audio] [stop] enter', _kind,
				'_id=', _msg._id,
				'tid=', _stMd.transfer_id,
				'hadCurrent=', !!this.currentAudioMessage,
				'pos=', this.state.audioRecordingStatus && this.state.audioRecordingStatus.position);
		} catch (_e) {}

		// On Android the player is audioRecorderPlayer. On iOS we drive
		// the hidden <Video audioOnly> via state — calling stopPlayer
		// there is a no-op (and removePlayBackListener too), but we
		// always tear down both so a stale handle from a previous
		// platform/session can't keep emitting.
		//
		// Diagnostic: log the native stopPlayer()/removePlayBackListener()
		// outcome explicitly. If the bubble/top Stop button "does not react",
		// this tells us whether the native call itself threw or returned a
		// rejected promise (the tap reached here but the player refused to
		// stop) vs. never getting here at all (no [stop] enter line).
		try {
			const _r = audioRecorderPlayer.stopPlayer();
			// stopPlayer is async on this lib — surface a late rejection too.
			if (_r && typeof _r.then === 'function') {
				_r.then(() => {}).catch((err) => {
					try { utils.timestampedLog('[applog] [audio] [stop] stopPlayer() rejected',
						err && err.message); } catch (_e2) {}
				});
			}
		} catch (e) {
			try { utils.timestampedLog('[applog] [audio] [stop] stopPlayer() threw',
				e && e.message); } catch (_e2) {}
		}
		try { audioRecorderPlayer.removePlayBackListener(); } catch (e) {
			try { utils.timestampedLog('[applog] [audio] [stop] removePlayBackListener() threw',
				e && e.message); } catch (_e2) {}
		}
		// Tear down the bubble VU ticker and zero the meters — the
		// instant playback ends, the bars collapse cleanly.
		this._stopAudioBubbleVuTicker();

		this.props.stopAudioPlayerFunc();

		if ('position' in this.state.audioRecordingStatus) {
			let metadata = this.state.audioRecordingStatus.metadata;
			this.props.updateFileTransferMetadata(metadata, 'position', this.state.audioRecordingStatus.position);
			// ALWAYS clear the playing flag so the bubble flips back to the
			// play icon. The old code only cleared it when position != 100
			// and relied on the render deriving "not playing" from
			// position==100 — but a stalled/wedged finish also sets
			// position=100, and that left the bubble stuck on the pause icon
			// ("UI still playing"). Set it explicitly and immediately.
			this.props.updateFileTransferMetadata(metadata, 'playing', false);
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
		try {
			utils.timestampedLog('[applog] [audio] [stop] done — player torn down, state cleared',
				'tid=', _stMd && _stMd.transfer_id);
		} catch (_e) {}
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


    // Deleted folder: Restore (revive) or Proceed (kill on XCAP → Graveyard).
    // The "all messages will be deleted" warning only shows when the contact
    // still has stored (hidden) messages — i.e. it was locally deleted. If it
    // was remotely purged (messages already gone) we just show the buttons.

    closeConfirmDialog() {
        this.setState({ confirmDialog: null });
    }

    // Graveyard (tombstones): Revive (bring back) or Eject (the ultimate step —
    // physically delete the contact row from SQL, irreversible).





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

        // Reset the composer-active state after a send. GiftedChat clears
        // its own internal text on send, but our `texting` flag (and the
        // mirrored `text`) only update via onInputTextChanged — which
        // fires on the post-send clear on iOS but NOT reliably on Android.
        // Left stale-true, `texting` keeps showButtons false, so the
        // camera/attachment buttons stay hidden and the send arrow stays
        // up even though the composer is now empty (the symptom was an
        // Android-only "no camera/attachment in the chat I just messaged
        // in"). Clearing it here keeps the WhatsApp-style send/mic swap
        // correct on both platforms.
        this.setState({replyingTo: null, texting: false, text: '', renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
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


    deleteSharingAssets() {
        console.log('deleteSharingAssets');
		this.setState({gettingSharedAsset: false}); 

        for (const asset of this.state.sharingAssets) {
			const fileUri = asset.uri.replace('file://', ''); // remove scheme
			RNFS.unlink(fileUri)
			  .then(() => console.log('Temporary file deleted', fileUri))
			  .catch(err => console.log('Error deleting temporary file', err));
		}
		
		// New model: restore from the app-built contactMessages prop
		// (was this.state.messages[selectedContact.uri]).
		let renderMessages = this.props.contactMessages;

		this.setState(prevState => ({
		  placeholder: this.default_placeholder,
		  sharingMessages: [],
		  sharingAssets: [],
		  // Restore the contact's message list. Must stay an ARRAY — an
		  // object spread ({...arr}) turns it into {0:…,1:…}, after which
		  // the render path's messages.filter(...) throws and takes down
		  // the whole tree.
		  renderMessages: Array.isArray(renderMessages) ? [...renderMessages] : [],
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

	  if (this.props.orderBy === 'size') {
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
	  // Caption tint matching SpectrumBarsView's axis text (0.7 alpha) so
	  // the "Levels" caption under the waveform uses the same font/colour
	  // as the spectrum's "Spectrum"/"kHz" captions.
	  const audioCaption          = _audioTheme.isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.7)';

	  // Prefer the duration saved in the metadata at record time — it's
	  // available on the FIRST render, so the duration label + seconds
	  // scale show immediately instead of after the async probe. Older
	  // messages (and recipients, where the field is stripped by the
	  // server) have no metadata.duration, so we still probe with
	  // react-native-sound and fall back to that value.
	  const metaDuration = (currentMessage.metadata
		  && typeof currentMessage.metadata.duration === 'number'
		  && currentMessage.metadata.duration > 0)
		  ? currentMessage.metadata.duration
		  : null;

	  // Load duration if not already loaded (skip when metadata has it).
	  if (currentMessage.audio && !metaDuration && !audioDurations[currentMessage._id]) {
		this.getAudioDuration(currentMessage.audio, currentMessage._id, currentMessage);
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
	  const rawDuration = metaDuration || audioDurations[currentMessage._id];
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

	  // Compute a slider width that targets the audio bubble's MAX
	  // allowed width (GiftedChat caps bubbles at ~80% of the row),
	  // not its current measured width.
	  //
	  // Why not the measured width: the audio bubble is content-sized
	  // by the gifted-chat Bubble wrapper — i.e., the wrapper grows
	  // to fit its children. If we set sliderWidth from the CURRENT
	  // measured bubble width, the bubble can never get any larger
	  // than it is now: the children stay the same width → the
	  // bubble stays the same width → next render produces the same
	  // children. The result is a small, never-growing audio bubble
	  // hugging its content rather than extending out to the row's
	  // right margin like other bubbles do.
	  //
	  // Instead, size the slider against the bubble's TARGET width —
	  // ~80% of the row, minus a rough avatar-gutter/margin allowance
	  // (~50px) minus the bubble's internal play-button + paddings
	  // budget (~94px = 48 button + 10 margin + 36 column padding
	  // [18+18 symmetric]). The bubble will then naturally grow to
	  // fill its ~80% maxWidth allowance just like a long text bubble
	  // does. The Math.min against 520 keeps very wide screens
	  // (tablets, foldables) from turning the recording into a runway.
	  //
	  // Lower clamp of 120 keeps the slider usable on small/zoomed
	  // displays — Screen zoom on Samsung can shrink the logical
	  // window width significantly, and 120px is still a touchable
	  // scrub target.
	  //
	  // IMPORTANT: the 94 here MUST match the audio wrapper-width
	  // formula in ChatBubble.js (search for _audioWrapperWidth). Both
	  // sides need to agree on the playButton + margin + padding
	  // budget or the bubble background will mismatch its content.
	  const windowWidth = Dimensions.get('window').width;
	  const targetBubbleWidth = (windowWidth - 50) * 0.8;   // ~80% of row, sans avatar gutter
	  const sliderBudget = targetBubbleWidth - 94;          // playButton(48) + margin(10) + column padding(36)
	  const sliderWidth = Math.round(Math.max(120, Math.min(sliderBudget, 520)));

	  //console.log('current audio message', currentMessage.metadata);

	  const playButton = (
		<TouchableHighlight
		  // Claim the responder for the entire play-button area (including
		  // padding around the IconButton). Without an onPress on this
		  // wrapper, taps that land in the padding fall through to the
		  // parent Bubble's onPress and open the contextual menu.
		  onPress={() => this.toggleAudioPlayback(currentMessage)}
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
			onPress={() => this.toggleAudioPlayback(currentMessage)}
			style={styles.playAudioButton}
			icon={isPlaying ? 'pause' : 'play'}
		  />
		</TouchableHighlight>
	  );

	  // Compact audio bubble: just a play button + duration label. Playback
	  // (waveform, spectrum, slider, seek) now happens in the standalone
	  // recorder player card, so the bubble no longer renders any graphs.
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

		  <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 10 }}>
			<Text
			  numberOfLines={1}
			  style={{ color: audioFgColor, fontSize: 14, textAlign: isIncoming ? 'left' : 'right' }}
			>
			  {durationLabel}
			</Text>
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


	onRotateImage(rotations) {
	  console.log('onRotateImage', rotations);
	  Object.keys(rotations).forEach(id => {	
		this.saveRotation(id, rotations[id]);
	  });
	}

	renderMessageImage = ({ currentMessage, orderBy }) => {
	  if (this.props.orderBy === 'size') {
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
      
	  const _md = currentMessage.metadata || {};
	  const _stateAR = this.state.imageAspectRatios && this.state.imageAspectRatios[id];
	  if (_stateAR && isFinite(_stateAR) && _stateAR > 0) {
	      // AUTHORITATIVE: the real decoded display aspect (EXIF-corrected),
	      // recorded by FastImage.onLoad / Image.getSize below. Wins over the
	      // send-time metadata, which for older/received rotated photos holds
	      // the raw sensor dimensions and yields the wrong (landscape) shape.
	      imageAspectRatio = _stateAR;
	  } else if (this.imageSizeCache[uri]) {
	      imageAspectRatio = this.imageSizeCache[uri].aspectRatio;
	  } else if (_md.width > 0 && _md.height > 0) {
	      // Dimensions captured at send time and shipped in the
	      // file-transfer metadata (so both sender and receiver have them).
	      // Use them so the FIRST render already hugs the image instead of
	      // flashing the square 1:1 default. onLoad still corrects later if
	      // these are ever missing or wrong.
	      imageAspectRatio = _md.width / _md.height;
	      this.imageSizeCache[uri] = {
	          width: _md.width,
	          height: _md.height,
	          aspectRatio: imageAspectRatio,
	      };
	  } else {
		  // First time seeing this image
		  Image.getSize(
			uri,
			(width, height) => {
			  const aspectRatio =
				width > 0 && height > 0 ? width / height : 1; // ✅ ensure finite ratio
			  this.imageSizeCache[uri] = { width, height, aspectRatio };
			  // Persist by stable message id so the memoized bubble re-renders
			  // and the value survives the temp→final uri swap.
			  this.recordImageAspect(id, aspectRatio);
			  // Backfill metadata dimensions if they were missing/wrong.
			  this.maybePersistImageDimensions(currentMessage, aspectRatio);
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
			// Surface the file-transfer id on each grid item so the
			// viewer can log it (alongside the URI) when an underlying
			// file fails to open — invaluable for tracing which
			// historical transfer actually has a broken path on disk.
			transferId: msg.metadata && msg.metadata.transfer_id,
			// Message direction + resolved per-photo delivery state,
			// surfaced so the grid can draw a status badge in the
			// bottom-right of each tile when the group is expanded.
			// Ticks are a sender-side receipt, so the badge only
			// renders for outgoing photos. The state token mirrors
			// the same flag → glyph semantics the bubble's renderTicks
			// uses (received flag = ✓✓ displayed, sent flag = ✓ sent,
			// pending = 🕓; none/server-accepted = no badge).
			direction: msg.direction,
			state: (msg.failed || (msg.metadata && msg.metadata.error))
				? 'failed'
				: msg.received ? 'displayed'
				: msg.sent ? 'sent'
				: msg.pending ? 'pending'
				: 'accepted',
			// Full file-transfer metadata. Carries url + transfer_id +
			// sender/receiver — everything downloadFile() needs to
			// re-fetch the original from the server when the local
			// copy is gone (stale container path, image-picker temp
			// cleaned up by iOS, etc.). The "Download from server"
			// button in ThumbnailGrid's missing-file placeholder
			// hands this object straight to props.downloadFile.
			metadata: msg.metadata,
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
			isLandscape={this.props.isLandscape}
			onRotateImage={this.onRotateImage}
			numColumns={numColumns}
			showTimestamp={false}
			// Group bubble: each tile shows its own delivery state
			// (✓ / ✓✓ / 🕓) in the bottom-right corner, and the
			// selection checkbox is moved out of the way to the
			// bottom-left so the two never overlap.
			showStateBadge={!isPreview}
			checkboxCorner="bottom-left"
			// Size the grid to ≈78% of the screen so it matches a single
			// image bubble. flex:1 / width:'100%' don't work here: the
			// bubble shrinks to the grid's content (circular sizing), so
			// the grid collapsed to ~50%. An explicit pixel width forces
			// the grid — and therefore the bubble — to the intended width.
			containerStyle={{
			    width: Math.round(
			        (this.props.isLandscape
			            ? Dimensions.get('window').height
			            : Dimensions.get('window').width) * 0.78
			    ),
			}}
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
			// Wire the viewer's "Download from server" affordance to
			// the existing file-transfer pipeline. ThumbnailGrid only
			// calls this when its missing-file placeholder is showing,
			// i.e. the local file is genuinely gone — handing the
			// item's full metadata (url + transfer_id + sender +
			// receiver) to downloadFile re-fetches the original from
			// the SylkServer-hosted location. force=true bypasses
			// downloadFile's already-on-disk guard since by definition
			// the on-disk check just failed for this tile.
			onRequestDownload={(item) => {
			  if (item && item.metadata && this.props.downloadFile) {
				console.log('[image-viewer] manual download',
				  'msgId=', item.id, 'transferId=', item.transferId);
				this.props.downloadFile(item.metadata, true);
			  }
			}}
			// Viewport-driven auto-download for tiles scrolled into view (not
			// downloaded yet). Uses autoDownloadFile in viewport mode, which
			// still honours the size cap — large files stay tap-to-download.
			onAutoDownload={(item) => {
			  if (item && item.metadata && this.props.autoDownloadFile) {
				this.props.autoDownloadFile(item.metadata, {viewport: true});
			  }
			}}
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
			  // NOTE: deliberately NO `aspectRatio` here. When this wrapper
			  // owned the aspectRatio AND the FastImage below used
			  // height:'100%', the image's height resolved against the
			  // wrapper's height, which itself was derived from aspectRatio —
			  // a two-level dependency Yoga doesn't resolve on the FIRST
			  // layout pass. The wrapper came out short, and overflow:'hidden'
			  // clipped the image so it rendered small and letterboxed with
			  // white bars left/right. It only corrected after a forced
			  // re-layout (opening fullscreen and returning). Letting the
			  // wrapper size to its child (the FastImage, which now carries
			  // the aspectRatio) makes height flow bottom-up and the first
			  // render is already correct.
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
				// Derive height from the image's own aspectRatio instead of
				// height:'100%'. Percentage WIDTH resolves against the parent's
				// known (bubble) width — fine on the first pass. Percentage
				// HEIGHT used to resolve against the wrapper's aspectRatio-
				// derived height, which Yoga didn't compute until a second
				// layout pass, leaving the image collapsed and letterboxed on
				// first render. With the wrapper no longer imposing an
				// aspectRatio, the FastImage sizes itself here and the wrapper
				// grows to match.
				aspectRatio: safeRatio,
				opacity: isLoading ? 0.9 : 1,
				transform: [{ rotate: `${rotation}deg` }]
			  }}
			  source={{
				uri,
				priority: FastImage.priority.normal,
			  }}
			  resizeMode={FastImage.resizeMode.contain}
			  onLoadStart={() => this.handleImageLoadStart(id)}
			  // FastImage knows the image's real pixel dimensions once it
			  // loads. Use them to set the bubble's aspectRatio — Image.getSize
			  // (used above as the initial guess) is unreliable for local
			  // files on Android and falls back to 1:1 (square), which
			  // letterboxes a wide image with white bands above/below. Taking
			  // the natural size here makes the bubble hug the image. Guard
			  // with a small epsilon so we only re-render when the ratio
			  // actually changes (no forceUpdate loop).
			  onLoad={(e) => {
				const ne = e && e.nativeEvent;
				const w = ne && ne.width;
				const h = ne && ne.height;
				if (w > 0 && h > 0) {
					const ar = w / h;
					this.imageSizeCache[uri] = { width: w, height: h, aspectRatio: ar };
					// Persist by stable message id; recordImageAspect only
					// setState's when the ratio actually changed (epsilon
					// guarded), so this won't loop on repeat onLoads.
					this.recordImageAspect(id, ar);
					// Write the corrected dimensions back to metadata + DB so
					// future loads read the right shape (no first-paint flash).
					this.maybePersistImageDimensions(currentMessage, ar);
				}
			  }}
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




    async uploadFile(msg) {
		this.props.contactStopShare();
        msg.metadata.preview = false;
	    msg.metadata.fullSize = this.state.fullSize;
	    //console.log('uploadFile msg', msg);
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
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
        // Only read-only for "no private key" once keys have actually loaded
        // (kept in lockstep with the chatInputClass picker). state.keys is null
        // while loading — e.g. opening from a push — so don't flag read-only yet.
        const keysLoaded = !!this.props.keys;
        const hasPrivateKey = !!(this.props.keys && this.props.keys.private);
        if (keysLoaded && !hasPrivateKey) return true;
        if (this.state.selectedContact) {
            if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) return true;
            if (this.props.searchMessages) return true;
            if (this._selectedContactIsTel()) return true;
            return false;
        }
        if (!this.props.chat) return true;
        return false;
    }

    /** True when the selected contact is a phone-number (PSTN/tel) URI.
     *  A PSTN number can't receive chat messages, so the composer is
     *  hidden — but the message LIST (call recordings + call-duration
     *  system messages) must still render. Shared by the chatInputClass
     *  picker, _chatIsReadOnly and showChat so they stay in lockstep. */
    _selectedContactIsTel() {
        const c = this.state.selectedContact;
        if (!c || !c.uri) return false;
        const local = String(c.uri).split('@')[0];
        return /^(\+|0)\d+$/.test(local);
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

        // One press opens the contextual menu (reaction strip + actions)
        // for both text AND image bubbles. `isPlainText` is true for any
        // message without an attachment filename — i.e. regular text and
        // inline images (image bubbles carry no metadata.filename). File
        // types (PDFs, audio, video, generic attachments) are NOT covered
        // here: they keep their natural tap-to-open / play behaviour and
        // reach the menu via long-press / the kebab icon. Full screen for
        // an image is reached via the FS icon or the menu's "Full screen"
        // action, not a plain body tap.
        // Call system messages: a body tap opens the CDRTool SIP-trace
        // page for that call in the browser. The per-call params live
        // under metadata.trace ({callid,fromtag,totag,proxyIP}); app.js
        // builds the URL and Linking.openURL's it via openCallTrace.
        // Checked before the plain-text→menu fallback below so the tap
        // performs the trace action rather than opening the action sheet.
        if (message.metadata && message.metadata.trace
                && message.metadata.trace.callid) {
            if (typeof this.props.openCallTrace === 'function') {
                this.props.openCallTrace(message.metadata.trace);
            } else {
                console.log('[trace] openCallTrace prop missing — cannot open trace');
            }
            return;
        }

        const hasImage = !!message.image;
        const isPlainText = !(message.metadata && message.metadata.filename);

        if (isPlainText || hasImage) {
            this.onLongMessagePress(null, message);
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
				if (file_transfer.url) {
					// Already on the server — download it. This covers OUTGOING
					// files sent from ANOTHER device: their metadata still carries
					// the original sender's `path`, which doesn't exist on this
					// device, so the old `!path ? download : upload` logic tried
					// to re-upload a non-existent file (nothing happened). A
					// server `url` means it's fetchable; pull it, then it decrypts.
					console.log('File on server — downloading', message.metadata && message.metadata.transfer_id);
					this.props.downloadFile(message.metadata, true);
				} else if (file_transfer.path) {
					console.log('File not yet uploaded', message.metadata);
					this.uploadFile(message);
				} else {
					console.log('File not yet downloaded');
					this.props.downloadFile(message.metadata, true);
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
		return this.props.orderBy === 'size';
    }

    onLongMessagePress(context, currentMessage) {
		Keyboard.dismiss();
		// NOTE: do NOT setState({actionSheetDisplayed}) here — openMessageMenu
		// sets it together with messageMenu in a single setState, so a tap
		// only triggers ONE re-render instead of two. (The old extra
		// setState plus a now-removed location-parse diagnostic that ran
		// regex on the body of every tapped message were adding latency to
		// "tap → menu opens".)

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
                || (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri))
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

            // Conference room threads don't support per-message Reply, Pin, or
            // Edit caption — there's no 1:1 reply target, no server-side pin for
            // room chat, and shared-file bubbles aren't editable. Exclude those
            // actions from the contextual sheet for conference conversations.
            const _isConferenceThread = !!((this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri)
                && (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri).indexOf('@videoconference') > -1);

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

            // Reply is hidden for failed messages — there's nothing to
            // reply to yet (the message never made it out); the useful
            // action there is Resend, which is surfaced instead.
            const _replyFailed = !!currentMessage.failed
                || !!(currentMessage.metadata && currentMessage.metadata.error);
            //if (currentMessage.direction == 'incoming' && !this.hideItem) {
            if (!this.hideItem && !isLiveLocation && !_replyFailed && !_isConferenceThread) {
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
			const _shareUri = (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri);
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
			// For image / video bubbles the editable text is the caption,
			// not a message body, so label it "Edit caption" to make that
			// clear (handled together with 'Edit' in the callback below).
			if (this.isMessageEditable(currentMessage) && !isLiveLocation && !_isConferenceThread) {
				const _editLabel = (currentMessage.image || currentMessage.video)
					? 'Edit caption'
					: 'Edit';
				options.push(_editLabel);
				icons.push(<Icon name="file-document-edit" size={20} />);
			}
			
			if (currentMessage.image) {
			    if (!(currentMessage._id in this.state.imageGroups)) {
                    options.push('Full screen')
                    icons.push(<Icon name="fullscreen" size={20} />);
                }
			}

            if (currentMessage.html) {
                options.push('Full screen');
                icons.push(<Icon name="fullscreen" size={20} />);
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

            // Resend is for OUTGOING messages only — you can't resend what
            // you received. On the receiver, a file you already downloaded
            // gets "Download again" instead (see the file-transfer block
            // below); a not-yet-downloaded one gets "Download". Still excluded:
            // conference rooms (no per-message resend) and live-location.
            const canResend =
                (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri).indexOf('@videoconference') === -1
                && !this.hideItem
                && !isLiveLocation
                && currentMessage.direction === 'outgoing';
            if (canResend) {
                options.push('Resend');
                icons.push(<Icon name="send" size={20} />);
            }

            // Pin / Unpin is now also offered for live-location
            // bubbles. Pinning the bubble of a long share is a
            // common ask — "I want to come back to that trip later"
            // — and the existing pin path doesn't care about the
            // payload type. The metadata.error guard still applies
            // (don't pin a failed bubble).
            if (currentMessage.pinned) {
                // Still allow Unpin so a previously-pinned bubble can be undone,
                // but never offer Pin in a conference thread.
                options.push('Unpin');
                icons.push(<Icon name="pin-off" size={20} />);
            } else if (!_isConferenceThread) {
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
					} else if (currentMessage.direction !== 'outgoing') {
						// Already downloaded a RECEIVED file — offer a re-download
						// (e.g. the local copy was removed externally, or the user
						// wants a fresh fetch). The menu handler routes any
						// 'Download…' label through downloadFile(). Not shown for
						// our own outgoing files, where local_url is the source.
						options.push('Download again');
						icons.push(<Icon name="cloud-download" size={20} />);
					}
				} else {
					options.push('Email');
					icons.push(<Icon name="email" size={20} />);
				}
            }

            options.push('Cancel');
            icons.push(<Icon name="cancel" size={20} />);

            // Selection handler — identical body to the old
            // ActionSheet callback. The new MessageContextMenu calls
            // this with the chosen option's index, so every branch
            // below keeps working verbatim.
            const _menuCallback = (buttonIndex) => {
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
                    } else if (currentMessage.contentType === 'text/html'
                               || currentMessage.html) {
                        // HTML bubbles: copy the rendered text, not the raw
                        // markup. html2text strips tags so the clipboard holds
                        // what the user actually sees in the thread.
                        Clipboard.setString(
                            utils.html2text(currentMessage.html || currentMessage.text)
                        );
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
                    //
                    // Conferences have no per-participant delete RPC — the
                    // gateway broadcasts each message to every attendee
                    // independently and there's no "rescind" verb in the
                    // sylkrtc videoroom signalling. Force canDeleteRemote
                    // to false when the chat thread is a conference room
                    // so the "Also delete those sent for X" checkbox is
                    // hidden entirely. Same `@videoconference` URI test
                    // DeleteHistoryModal (line 338) and DeleteFileTransfers
                    // (line 298) use, so the three delete surfaces stay
                    // consistent.
                    const _isConferenceThread = (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri)
                        && (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri).includes('@videoconference');
                    const allMsgs = this.state.renderMessages || [];
                    const msgsById = new Map(allMsgs.map(m => [m._id, m]));
                    const canDeleteRemote = !_isConferenceThread
                        && messagesToDelete.every((id) => {
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
                        this.props.pauseLocationShare((this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri), originId);
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
                        this.props.resumeLocationShare((this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri), originId, md);
                    }
                } else if (action === 'Pin') {
                    this.props.pinMessage(currentMessage._id);
                } else if (action === 'Unpin') {
                    this.props.unpinMessage(currentMessage._id);
                } else if (action === 'Info') {
                    this.setState({message: currentMessage, showMessageModal: true});
                } else if (action === 'Edit' || action === 'Edit caption') {
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
                        this.props.meetMeAt((this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri), _link);
                    }
                } else if (action === 'Full screen') {
                    if (currentMessage.html) {
                        this.setState({actionSheetDisplayed: false});
                        if (typeof this.props.setFullScreen === 'function') {
                            this.props.setFullScreen(true);
                        }
                        this.setState({fullScreenHtml: currentMessage});
                        return;
                    }
                    if (currentMessage.image) {
                        // Image bubble → open the zoomable full-screen
                        // image viewer (same path as the FS icon and the
                        // old "Preview" action). Single-press no longer
                        // opens it, so this menu action is how you get
                        // there from a body tap.
                        this.setState({actionSheetDisplayed: false});
                        this.onImagePress(currentMessage);
                        return;
                    }
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
                    // Capture the current trail (see onOpenFullScreen note) so
                    // the fullscreen modal isn't subject to the async-reload
                    // trim that drops the trail to a single point.
                    this.setState({
                        fullScreenLocation: currentMessage,
                        fullScreenLocationTrail: this._buildLocationTrailFromMetadata(currentMessage._id),
                    });
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
                    this.props.forwardMessagesFunc(messagesToForward, (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri));
                } else if (action.startsWith('Reply')) {
                    this.replyMessage(currentMessage);
                } else if (action === 'Resend') {
                    this.props.reSendMessage(currentMessage, (this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri));
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
            };

            this.openMessageMenu(currentMessage, options, icons, _menuCallback);
        }
    };

    // Decide whether the redesigned context menu should show the
    // reaction strip for this message, then stash everything the
    // overlay needs in state. Mirrors onMessagePress's reactability
    // predicate (text or image bubble, not a file, chat not read-only,
    // not a live-location stream) so the strip only appears where a
    // reaction can actually be sent.
    openMessageMenu(currentMessage, options, icons, callback) {
        console.log('[reaction-menu] open',
            'id=', currentMessage && currentMessage._id,
            'contentType=', (currentMessage && currentMessage.contentType) || '(none)',
            'direction=', (currentMessage && currentMessage.direction) || '(none)',
            'state={',
            'pending=', !!(currentMessage && currentMessage.pending),
            'sent=', !!(currentMessage && currentMessage.sent),
            'delivered(received)=', !!(currentMessage && currentMessage.received),
            'read(displayed)=', !!(currentMessage && currentMessage.displayed),
            'failed=', !!(currentMessage && currentMessage.failed),
            '}',
            'options=[', (options || []).join(' | '), ']');
        const isLiveLocation =
            currentMessage.contentType === 'application/sylk-live-location';
        // A failed send can't carry a reaction (the message itself
        // never made it out), so suppress the emoji strip for it.
        const failed = !!currentMessage.failed
            || !!(currentMessage.metadata && currentMessage.metadata.error);
        // Reactions are offered on every message type now — text,
        // image, file, audio, video — because the long-press reaction
        // strip is the unified reaction entry point that replaced the
        // old single-tap floating bar. Only live-location bubbles stay
        // excluded: their body is a constantly-updating tick, so a
        // reaction reply pinned to it would be misleading. Read-only
        // chats still suppress the strip (can't send → can't react),
        // and failed messages do too.
        const reactable = !isLiveLocation && !this._chatIsReadOnly() && !failed;

        // For video bubbles, hand the menu the cached thumbnail so its
        // echo can show the video's poster frame instead of nothing.
        // Same source order renderMessageVideo uses: the message's own
        // thumbnail first, then the videoMetaCache entry; normalise an
        // object-shaped thumbnail to its string and file://-prefix on
        // Android so <Image> can load a local path.
        let previewImage = null;
        if (currentMessage.video) {
            const id = currentMessage._id;
            const cache = this.state.videoMetaCache || {};
            let thumb = currentMessage.thumbnail
                || (cache[id] && cache[id].thumbnail);
            if (thumb && typeof thumb === 'object') {
                thumb = thumb.thumbnail;
            }
            if (thumb && typeof thumb === 'string') {
                if (Platform.OS === 'android' && thumb.indexOf('file://') === -1) {
                    thumb = 'file://' + thumb;
                }
                previewImage = thumb;
            }
        }

        // (`failed` computed above — drives Resend/Delete promotion in
        // the menu's floating row and suppresses the reaction strip.)
        this.setState({
            actionSheetDisplayed: true,
            messageMenu: {
                message: currentMessage, options, icons, callback,
                reactable, previewImage, failed,
            },
        });
    }

    // Tear down the overlay. Routes through here from every dismissal
    // path (scrim tap, action chosen, reaction sent) so actionSheetDisplayed
    // is always cleared in lockstep with the menu.
    closeMessageMenu = () => {
        this.setState({ messageMenu: null, actionSheetDisplayed: false });
    };

    // An action button was tapped. Run the original callback with the
    // option's index, then close. Mirrors the old ActionSheet contract
    // (callback then auto-dismiss).
    onMessageMenuSelect = (index) => {
        const menu = this.state.messageMenu;
        this.closeMessageMenu();
        if (menu && typeof menu.callback === 'function') {
            menu.callback(index);
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

        // Call system messages: always re-render so the convergence
        // enrich (metadata.trace arriving from the server-history sync)
        // flips the bubble to its tappable + underlined state without a
        // chat reload. Same rationale as audio above — prev/next can
        // already point at the same ref here, so a field diff misses it.
        if (cmAny && (cmAny.traceReady
                || (cmAny.metadata && cmAny.metadata.trace && cmAny.metadata.trace.callid))) {
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

        // Grouped-image selection changed. The grouped-head bubble
        // owns the ThumbnailGrid whose corner checkmarks read from
        // state.selectedImages, and ChatBubble's own memo comparator
        // already detects this and asks for a re-render. But this
        // gifted-chat Message-level hook sits ABOVE the ChatBubble
        // memo — its fallback `return false` short-circuits the
        // whole chain, so the per-bubble memo never even runs and
        // the ThumbnailGrid keeps its stale selectedIds prop.
        // Without this trigger, tapping a tile toggles
        // state.selectedImages correctly but the corner checkmark
        // never appears (regression introduced alongside the
        // reactionTarget gate above).
        //
        // Mirror the reactionTarget transition pattern: when
        // selection changes, force a single pass over visible
        // bubbles and let the per-bubble ChatBubble memo decide
        // which one(s) actually re-render. _previousSelectedImages
        // is refreshed in componentDidUpdate (alongside
        // _previousReactionTargetId) so this hook sees the
        // pre-commit reference here.
        // `_previousSelectedImages` is undefined until componentDidUpdate
        // runs for the first time (CDU doesn't fire after the initial
        // mount), so guard against that here to avoid a one-time
        // spurious full re-render right after first paint.
        const prevSel = this._previousSelectedImages;
        const currSel = this.state.selectedImages;
        if (prevSel !== undefined && prevSel !== currSel) {
            return true;
        }

        // Image-group membership changed. When a newly-sent image joins
        // an existing group, computeImageGroups does setState({imageGroups})
        // but the group LEADER's message object in renderMessages doesn't
        // change — so without a trigger here gifted-chat's Message skips
        // the leader and its ThumbnailGrid keeps showing the old N tiles
        // until the chat is navigated away from and back. Same pattern as
        // selectedImages above: force a single pass on the transition and
        // let ChatBubble's own memo (which now compares group membership)
        // decide which leader actually re-renders. _previousImageGroups is
        // refreshed in componentDidUpdate alongside _previousSelectedImages.
        const prevGroups = this._previousImageGroups;
        const currGroups = this.state.imageGroups;
        if (prevGroups !== undefined && prevGroups !== currGroups) {
            return true;
        }

        return false;
    }

    toggleShareMessageModal() {
        this.setState({showShareMessageModal: !this.state.showShareMessageModal});
    }

	getMetadataByActionForMessage(messageId, action) {
		// Prefer the app-derived lookup maps (messagesMetadataById /
		// messagesMetadataByOriginalId) — a direct id lookup, no array walk.
		// Returns a synthetic {action, value} entry to match the legacy shape.
		const _byId = this.props.messagesMetadataById;
		const _byOrig = this.props.messagesMetadataByOriginalId;
		if (_byId || _byOrig) {
			const lk = (_byId && _byId[messageId]) || (_byOrig && _byOrig[messageId]);
			return (lk && lk[action] !== undefined) ? { action, value: lk[action] } : null;
		}

		// Legacy fallback (maps not provided): scan messagesMetadata.
		const mm = this.props.messagesMetadata;
		if (!mm) return null;
		const arr = mm[messageId];
		if (!Array.isArray(arr)) return null;
		return arr.find(e => e.action === action) || null;
	}

	getMetadataByAction(action, field = 'value') {
		// Prefer the app-derived lookup maps: project them to the {id: value}
		// shape the callers (mediaLabels/mediaRotations/replyMessages) expect.
		const _byId = this.props.messagesMetadataById;
		const _byOrig = this.props.messagesMetadataByOriginalId;
		if (_byId || _byOrig) {
			const result = {};
			for (const k in (_byId || {})) {
				const v = _byId[k];
				if (v && v[action] !== undefined) result[k] = v[action];
			}
			for (const k in (_byOrig || {})) {
				const v = _byOrig[k];
				if (v && v[action] !== undefined && result[k] === undefined) result[k] = v[action];
			}
			return result;
		}

		// Legacy fallback (maps not provided): scan messagesMetadata.
		const mm = this.props.messagesMetadata;
		if (!mm) return {};
		const result = {};
		Object.entries(mm).forEach(([msgId, arr]) => {
			if (!Array.isArray(arr)) return;
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
		const mm = this.props.messagesMetadata;
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

	// Build the ordered, coord-valid GPS trail for a location share from
	// messagesMetadata[msgId]. Same derivation the inline bubble and the
	// fullscreen modal use — extracted so the fullscreen-open handlers can
	// CAPTURE the trail at the moment the user taps "Full screen". The
	// fullscreen modal then renders the captured trail instead of
	// re-reading messagesMetadata at modal-render time, which can be
	// transiently trimmed by the async category/secondary-query reload
	// (the bug where the inline bubble showed all 41 points but the
	// fullscreen view dropped to 1).
	_buildLocationTrailFromMetadata(msgId) {
		const raw = (this.props.messagesMetadata
			&& this.props.messagesMetadata[msgId]) || [];
		const out = [];
		for (const e of raw) {
			if (!e || e.action !== 'location') continue;
			const v = e.value;
			if (!v
					|| typeof v.latitude !== 'number'
					|| typeof v.longitude !== 'number') continue;
			const tsRaw = (v.timestamp != null) ? v.timestamp : e.timestamp;
			const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
			out.push({ latitude: v.latitude, longitude: v.longitude, timestamp: ts });
		}
		out.sort((a, b) => a.timestamp - b.timestamp);
		return out;
	}

	componentDidUpdate(prevProps, prevState) {
      // Props-derived state sync, migrated from the old
      // UNSAFE_componentWillReceiveProps. Run it only when the incoming
      // props actually changed: componentDidUpdate also fires after our own
      // setState calls, where prevProps === this.props (same reference). The
      // sync ends with an unconditional state-mirror setState, so skipping
      // the state-only passes is what stops it re-triggering itself in a
      // loop. The prevState-driven branches further down react to whatever
      // state the sync schedules on the following pass.
      if (prevProps !== this.props) {
          this._syncStateFromProps(prevProps);
      }

      // If the user tapped "Download from server" on the missing-file
      // placeholder and the chat layer subsequently refreshed the
      // expanded message with a fresh local_url, drop the missing/
      // downloading flags so the viewer re-attempts the load against
      // the new URI without requiring a close+reopen.
      const prevExp = prevState.expandedImage;
      const curExp = this.state.expandedImage;
      if (prevExp && curExp && prevExp._id === curExp._id
          && prevExp.image !== curExp.image
          && (this.state.expandedImageMissing || this.state.expandedImageDownloading)) {
          this.setState({
              expandedImageMissing: false,
              expandedImageDownloading: false,
              expandedImageSize: null,
          });
      }

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

      // Track the previous selectedImages array reference so the
      // next shouldUpdateMessage cycle can detect that the grouped-
      // image selection changed (see the matching prevSel/currSel
      // check there). Refreshed AFTER the render that committed the
      // new selection so the next prop diff catches it as "this
      // pass differs from the previous pass".
      this._previousSelectedImages = this.state.selectedImages;

      // Same idea for imageGroups: track the previous reference so the
      // next shouldUpdateMessage cycle can detect a group membership
      // change (new image joined a group) and force the leader bubble to
      // re-render its ThumbnailGrid with the added tile.
      this._previousImageGroups = this.state.imageGroups;

      // Scroll each calendar-bar row to keep the active pill in
      // view whenever its selection transitions. Fires for both
      // tap-a-pill paths (selectDateYear / Month / Day in the bar)
      // AND remote selection (in-chat "Go to date" pill, which
      // sets all three at once). Without this hook, picking a
      // tag that sits off-screen would leave it invisible.
      const _scrollRow = (ref, tags, id) => {
          if (!ref || !ref.current || !ref.current.scrollToIndex) return;
          if (!id || !tags) return;
          const _idx = tags.findIndex(t => t && t.id === id);
          if (_idx < 0) return;
          try {
              ref.current.scrollToIndex({
                  index: _idx,
                  animated: true,
                  viewPosition: 0.5,
              });
          } catch (e) { /* swallow — best effort */ }
      };
      if (prevState.dateYear !== this.state.dateYear) {
          _scrollRow(this._yearListRef, this.state.availableYears, this.state.dateYear);
      }
      if (prevState.dateMonth !== this.state.dateMonth) {
          _scrollRow(this._monthListRef, this.state.availableMonths, this.state.dateMonth);
      }
      if (prevState.dateDay !== this.state.dateDay) {
          _scrollRow(this._dayListRef, this.state.availableDays, this.state.dateDay);
      }

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

          // Spinner-stop signal. The CWRP path raises messagesLoading
          // to true and blanks renderMessages when the user taps a
          // media-type chip. The freshly-fetched messages land via
          // the parent's setState({messages: {...}}) → CWRP merge
          // path → setState({renderMessages: newMessages}). That's
          // the moment to drop the overlay: a prop-reference check
          // in CWRP was unreliable because the parent occasionally
          // re-emits messages without changing the per-uri array
          // reference (status flips, decrypt completions, etc.),
          // so the prev/next compare missed the actual swap. Watching
          // renderMessages state is the canonical "I have new
          // bubbles to render" signal and fires exactly once per
          // fetch.
          if (this.state.messagesLoading
                  && (this.state.renderMessages || []).length > 0) {
              CDU_DEBUG && console.log('[messagesLoading] false — renderMessages populated:',
                  this.state.renderMessages.length, 'bubbles');
              if (this._messagesLoadingTimer) {
                  clearTimeout(this._messagesLoadingTimer);
                  this._messagesLoadingTimer = null;
              }
              this.setState({messagesLoading: false});
          }
      }

      if (prevState.actionSheetDisplayed !== this.state.actionSheetDisplayed) {
	      CDU_DEBUG && console.log('actionSheetDisplayed did change', this.state.actionSheetDisplayed);
      }

      if (prevProps.totalMessageExceeded !== this.props.totalMessageExceeded) {
	      CDU_DEBUG && console.log('totalMessageExceeded did change', this.props.totalMessageExceeded);
      }

      if (prevState.isLoadingEarlier !== this.state.isLoadingEarlier) {
	      CDU_DEBUG && console.log('----- isLoadingEarlier did change', this.state.isLoadingEarlier);
      }


      if (prevState.thumbnailGridSize !== this.state.thumbnailGridSize) {
		CDU_DEBUG && console.log('thumbnailGridSize did change', this.state.thumbnailGridSize);
		
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
	               
	               
      if (prevProps.appState !== this.props.appState) {
          if (this.props.appState !== 'active') {
			  this.exitFullScreen();
		  }
      }
	  
      if (prevState.messagesCategoryFilter !== this.state.messagesCategoryFilter) {
		  this.setState({selectedImages: []});
	      CDU_DEBUG && console.log('messagesCategoryFilter changed', this.state.messagesCategoryFilter);
      }

      if (prevProps.sortOrder !== this.props.sortOrder) {
	      CDU_DEBUG && console.log('sortOrder changed', this.props.sortOrder);
      }
	               
      if (prevState.selectedImages !== this.state.selectedImages) {
	      CDU_DEBUG && console.log('selectedImages changed', this.state.selectedImages);
      }

      if (prevState.selectedImagesSearch !== this.state.selectedImagesSearch) {
	      CDU_DEBUG && console.log('selectedImagesSearch changed', this.state.selectedImagesSearch);
      }

      if (prevProps.isAudioRecording !== this.props.isAudioRecording) {
          if (this.props.isAudioRecording) {
			  this.setState({placeholder: 'Recording audio...'});
		  } else if (this.props.recordingFile) {
			  this.setState({placeholder: 'Delete or send...'});
		  } else {
			  this.setState({placeholder: this.default_placeholder});
		  }
	  }

      if (prevProps.recordingFile !== this.props.recordingFile) {
          if (this.props.recordingFile) {
			  this.setState({placeholder: 'Delete or send...'});
		  } else {
			  this.setState({placeholder: this.default_placeholder});
		  }
	  }

      if (prevState.scrollToBottom !== this.state.scrollToBottom) {
	        //console.log('Scroll to bottom changed', this.state.scrollToBottom);
      }
            
	  if (prevProps.orderBy !== this.props.orderBy) {
	        CDU_DEBUG && console.log('orderBy changed', this.props.orderBy);
      }


      if (prevProps.playRecording !== this.props.playRecording) {
			//console.log('Parent playRecording', prevProps.playRecording, this.props.playRecording);
	        if (this.props.playRecording === false) {
				// Only stop if a message is actually playing. Our own
				// stopAudioPlayer() calls stopAudioPlayerFunc() → the recorder
				// `playRecording` flag flips false → round-trips back here as a
				// prop change, which used to fire a SECOND, redundant
				// stopAudioPlayer() (the `[stop] voice_msg _id=undefined` echo
				// in the logs). Each stop does 2 full updateFileTransferMetadata
				// list rebuilds, so the echo doubled the UI-thread churn and
				// made the stop tap feel unresponsive. Guard on currentAudioMessage
				// so this only stops when there's genuinely something playing
				// (e.g. an external playRecording=false with no prior JS stop).
				if (this.currentAudioMessage) {
					this.stopAudioPlayer();
				}
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
	          || prevProps.transferProgress !== this.props.transferProgress)) {
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

	  if (prevProps.transferProgress !== this.props.transferProgress) {
		//console.log('transferProgress changed', this.props.transferProgress);
	
	    /*
		// Iterate over updated transfers
		Object.keys(this.props.transferProgress).forEach(id => {
		  const { progress, stage } = this.props.transferProgress[id];
	
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
			// PERF / responsiveness: do NOT persist position while a message is
			// actively playing. The playback listener bumps audioRecordingStatus
			// ~10x/sec; updateFileTransferMetadata rebuilds the ENTIRE message
			// list in the parent and cascades a full re-render back down, so
			// doing it per tick saturated the JS thread and a stop tap sat
			// queued for ~10s ("press stop, stops 10s later"). The live slider
			// reads position straight from audioRecordingStatus state (see
			// renderAudio: isCurrent → status.position), so persisting each tick
			// buys nothing visually. The final position is persisted once by
			// stopAudioPlayer() (and on slider release by seekAudioMessage), so
			// only persist here when nothing is actively playing.
			if (this.state.audioRecordingStatus.position && !this.currentAudioMessage) {
				let metadata = this.state.audioRecordingStatus.metadata;
				this.props.updateFileTransferMetadata(metadata, 'position', this.state.audioRecordingStatus.position);
			}
		}
		
		if (prevProps.messagesMetadata !== this.props.messagesMetadata) {
			/*
			console.log("==== CL messagesMetadata changed ==== ");
			console.log("old", JSON.stringify(prevProps.messagesMetadata, null, 2));
			console.log("new", JSON.stringify(this.props.messagesMetadata, null, 2));
			*/

			const mediaLabels = this.mediaLabels;
			//console.log('CL mediaLabels:', mediaLabels);
			const mediaRotations = this.mediaRotations;
			const replyMessages = this.replyMessages;
			const locationData = this.locationData;

			const prevRender = this.state.renderMessages;
			const updatedMessages = prevRender.map(msg => {
				// Live location: when this message is a rendered location
				// bubble and a newer tick landed, bump `text` (a field
				// ChatBubble's memo comparator watches) and refresh the
				// embedded metadata so the LocationBubble renders the
				// new coords. `createdAt` is intentionally LEFT UNTOUCHED
				// so the bubble keeps the original timestamp from when the
				// share started. The chat is sorted by `createdAt`, so
				// bumping it on each tick would re-sort the live-location
				// bubble to the bottom of the conversation on every update.
				// `_id` stays anchored to the origin so subsequent merges
				// and metadata lookups keep finding the same row.
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
					// NOTE: `createdAt` is deliberately NOT recomputed from
					// the tick here. The bubble must keep its original
					// timestamp (set at injection) so it stays in place in
					// the createdAt-sorted message list. The latest tick's
					// time still lives in the metadata for map rendering.
					if (textChanged || metaChanged) {
						return {
							...msg,
							text: tickMarker,
							metadata: mergedMetadata,
						};
					}
				}

				// Label / rotation / reply overlay moved to app.js
				// (_overlayMessage → contactMessages, plus the
				// messagesMetadataById/ByOriginalId lookup maps). This block
				// now only synthesizes live-location tick text (above);
				// everything else passes through unchanged.
				return msg;
			});
		
			//console.log("update renderMessages after messagesMetadata changed");
			
			// Only swap renderMessages (which re-triggers the filter
			// pipeline below) when the .map actually produced a new row.
			// The map preserves the original ref for unchanged messages,
			// so a ref-equality scan tells us whether anything moved; an
			// unchanged metadata update therefore no longer forces a full
			// re-filter. The label/rotation/reply maps are cheap derived
			// state that don't feed the pipeline, so they're always set.
			const renderChanged = updatedMessages.some((m, i) => m !== prevRender[i]);
			this.setState({
				mediaLabels,
				mediaRotations,
				replyMessages,
				...(renderChanged ? { renderMessages: updatedMessages } : {}),
			});
		}

	   if (prevState.sharingMessages != this.state.sharingMessages) {
		  // Handle sharing asset mode. NB: declare with `let` — this block
		  // runs before the pipeline's own `let filteredMessages` below, so
		  // without a local binding these assignments leaked to an implicit
		  // global (a ReferenceError under the file's ES-module strict mode).
		  let filteredMessages;
		  if (this.state.sharingMessages) {
			  filteredMessages = [];
		  } else {
			  filteredMessages = this.state.filteredMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
		  }

		  this.setState({
			filteredMessages: filteredMessages
		  });
	   }

	   if (prevProps.searchString !== this.props.searchString || prevState.renderMessages != this.state.renderMessages || prevProps.orderBy != this.props.orderBy || prevState.messagesCategoryFilter !== this.state.messagesCategoryFilter || prevProps.sortOrder !== this.props.sortOrder || prevState.dateYear !== this.state.dateYear || prevState.dateMonth !== this.state.dateMonth || prevState.dateDay !== this.state.dateDay || prevProps.searchMessages !== this.props.searchMessages || prevState.contactDateIndex !== this.state.contactDateIndex) {

			let filteredMessages = this.state.renderMessages;

		    if (this.props.orderBy === 'size') {
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

			// Links subset of Text. The SQL slice + sql2GiftedChat
			// have already narrowed to text-shaped rows (file-
			// transfer dropped); now keep only those whose body
			// contains something that looks like a URL. Matches
			//   - http:// / https:// followed by any non-whitespace
			//   - bare www.<something> (very common in chat)
			//   - common TLDs after a dot for unscheme'd domains
			//     (e.g. "anthropic.com/news") — kept intentionally
			//     conservative (\b<tld>\b) to avoid flagging "v1.2"
			//     or "file.txt" as a link.
			// Tested against text/plain and text/html bodies; the
			// regex is run against (message.text || message.html)
			// so HTML messages whose .text is the rendered plain
			// version still match because the URL survives the
			// flattening (linkifyHtml above leaves the raw href
			// text in place).
			if (_catFilter === 'links') {
				// Shared URL test (see utils.containsUrl) so a
				// regex tweak applies to both the runtime filter
				// AND the INSERT-time has_link classification.
				filteredMessages = filteredMessages.filter(message => {
				    if (!message) return false;
				    return utils.containsUrl(message.text, message.html);
				});
			}

			// === Year/Month/Day drill-down pipeline ===
			//
			// PILL SOURCE: state.contactDateIndex — the full per-
			// contact day list pulled from SQL once per chat open.
			// It carries every day the conversation has messages,
			// not just the windowed slice currently in
			// renderMessages, so the year pills can read "2019"
			// even when the user only just opened the chat and
			// hasn't paginated that far back. Search/category
			// state does NOT narrow the pill source (encrypted
			// message bodies can't be LIKE-matched in SQL, and we
			// don't want pills to only reflect the in-memory
			// window) — search and category narrow the displayed
			// chat AFTER a date is picked, which is the practical
			// equivalent for the user.
			//
			// NARROW SOURCE: filteredMessages from the loaded
			// window. When a date is picked and the target day
			// isn't in renderMessages yet, the narrow trivially
			// resolves to an empty chat — the user has signalled
			// "fetch this date", which is a follow-up to wire to
			// app.js getMessages with a date-window filter. For
			// now the narrow shows whichever matching rows are
			// already loaded.
			if (_catFilter || this.state.dateYear || this.state.dateMonth
					|| this.state.dateDay || this.props.searchMessages
					|| this.props.pinned) {
				const _yearSel  = this.state.dateYear;
				const _monthSel = this.state.dateMonth;

				// Pill source: always the SQL contactDateIndex now
				// that v18 added has_link. getContactDateIndex
				// passes category through and the 'links' branch
				// gates on `category='text' AND has_link=1`, so
				// the persisted column produces honest counts for
				// every category without needing the in-memory
				// fallback the previous codepath used as a
				// stopgap.
				const _index = this.state.contactDateIndex || [];

				// Build the three pill rows from the date index.
				// Each row groups + sums counts at its
				// granularity.
				const _yearAgg  = new Map();
				const _monthAgg = new Map();
				const _dayAgg   = new Map();
				for (const e of _index) {
					if (!e || !e.day_id || e.day_id.length < 10) continue;
					const yId = e.day_id.substring(0, 4);
					const mId = e.day_id.substring(0, 7);
					const dId = e.day_id;
					const cnt = e.count || 0;

					// Year row: every year contributes.
					const yEntry = _yearAgg.get(yId);
					if (yEntry) yEntry.count += cnt;
					else _yearAgg.set(yId, { id: yId, label: yId,
						sortKey: parseInt(yId, 10) * 10000, count: cnt });

					// Month row: only when a year is selected and
					// this day falls inside it.
					if (_yearSel && yId === _yearSel) {
						const mEntry = _monthAgg.get(mId);
						if (mEntry) mEntry.count += cnt;
						else {
							const _mNum = parseInt(mId.substring(5, 7), 10);
							const _mShort = new Date(parseInt(yId, 10), _mNum - 1, 1)
								.toLocaleString('default', { month: 'short' });
							_monthAgg.set(mId, { id: mId,
								label: `${_mShort} ${yId}`,
								sortKey: parseInt(yId, 10) * 100 + _mNum,
								count: cnt });
						}
					}

					// Day row: only when a month is selected and
					// this day falls inside it.
					if (_monthSel && mId === _monthSel) {
						const dEntry = _dayAgg.get(dId);
						if (dEntry) dEntry.count += cnt;
						else {
							const _dNum = parseInt(dId.substring(8, 10), 10);
							const _mNum = parseInt(dId.substring(5, 7), 10);
							const _mShort = new Date(parseInt(yId, 10), _mNum - 1, 1)
								.toLocaleString('default', { month: 'short' });
							_dayAgg.set(dId, { id: dId,
								label: `${_dNum} ${_mShort}`,
								sortKey: new Date(yId, _mNum - 1, _dNum).getTime(),
								count: cnt });
						}
					}
				}
				const _sortDesc = (a, b) => b.sortKey - a.sortKey;
				const nextYears  = Array.from(_yearAgg.values()).sort(_sortDesc);
				const nextMonths = _yearSel ? Array.from(_monthAgg.values()).sort(_sortDesc) : [];
				const nextDays   = _monthSel ? Array.from(_dayAgg.values()).sort(_sortDesc) : [];

				// Stability check (id + count) so identical
				// recomputations don't fire setState and recurse.
				const _join = (arr) => arr.map(t => `${t.id}:${t.count}`).join('|');
				const _prevY = _join(this.state.availableYears  || []);
				const _prevM = _join(this.state.availableMonths || []);
				const _prevD = _join(this.state.availableDays   || []);
				const _nextY = _join(nextYears);
				const _nextM = _join(nextMonths);
				const _nextD = _join(nextDays);
				if (_prevY !== _nextY || _prevM !== _nextM || _prevD !== _nextD) {
					CDU_DEBUG && console.log('[dateFilter] indexDays=', _index.length,
						'years=', nextYears.length,
						'months=', nextMonths.length,
						'days=', nextDays.length);
					this.setState({
						availableYears:  nextYears,
						availableMonths: nextMonths,
						availableDays:   nextDays,
					});
				}

				// Narrow filteredMessages to the most specific
				// selection. The narrow is derived from each
				// message's local-timezone tags (utils.getMessage-
				// DateTags), same as the SQL index uses
				// strftime('localtime') — so the bucket boundaries
				// match between the index and the in-memory pass.
				const _activeNarrow = this.state.dateDay
					? { period: 'day',   id: this.state.dateDay }
					: this.state.dateMonth
						? { period: 'month', id: this.state.dateMonth }
						: this.state.dateYear
							? { period: 'year',  id: this.state.dateYear }
							: null;
				if (_activeNarrow) {
					const _before = filteredMessages.length;
					// Memoize date tags across passes. The message objects
					// are rebuilt every pipeline run (the maps below allocate
					// new rows), so caching on the object wouldn't survive;
					// key on the normalized timestamp instead. getMessageDateTags
					// reparses a Date + builds tag objects, so this avoids that
					// work for every message on every relevant state change.
					const _tagCache = this._dateTagCache || (this._dateTagCache = new Map());
					filteredMessages = filteredMessages.filter(m => {
						if (!m) return false;
						const _k = m.createdAt instanceof Date ? m.createdAt.getTime() : m.createdAt;
						let t = _tagCache.get(_k);
						if (t === undefined) {
							t = utils.getMessageDateTags(m.createdAt);
							// Bound growth over very long sessions; clearing is
							// cheap and hot entries just rebuild on next pass.
							if (_tagCache.size > 5000) _tagCache.clear();
							_tagCache.set(_k, t);
						}
						return !!(t && t[_activeNarrow.period]
							&& t[_activeNarrow.period].id === _activeNarrow.id);
					});
					// If the SQL pill said "category=image, day=X
					// has N rows" but the in-memory narrow lands
					// fewer (or zero) results, the gap is one of:
					//   • renderMessages window doesn't cover that
					//     day yet (load earlier or pick a fetch
					//     range — TODO date-range getMessages)
					//   • SQL category='image' includes rows whose
					//     local_url is missing / never downloaded,
					//     so they don't render in the image grid
					//     (grid filters on m.image which is only
					//     set when local_url resolves to disk)
					CDU_DEBUG && console.log('[dateNarrow]', _activeNarrow.period, '=',
						_activeNarrow.id,
						'window=', _before,
						'matched=', filteredMessages.length,
						'category=', _catFilter || 'none');
				}
			}

		    // Overlay (media label / rotation / reply) is now baked into
		    // contactMessages by app.js (_overlayMessage), so filteredMessages
		    // already carries the overlaid fields via renderMessages. The
		    // per-run pipeline overlay map was removed (replies/labels are also
		    // looked up directly via messagesMetadataById/ByOriginalId).

		    //todo

		  // Apply search & media filters. Set-based membership keeps this
		  // O(n): the previous `matchingMediaIds.includes(...)` (inside a
		  // filter) and `textMatches.some(...)` (inside another filter) were
		  // each O(n) per element — O(n^2) overall on large windows.
		  if (this.props.searchString && this.props.searchString.length > 1) {
			const searchLower = this.props.searchString.toLowerCase();

			const textMatches = filteredMessages.filter(
			  msg => msg.text && msg.text.toLowerCase().includes(searchLower)
			);
			const textMatchIds = new Set(textMatches.map(m => m._id));

			const matchingMediaIds = new Set(
			  Object.keys(this.state.mediaLabels || {}).filter(id =>
				(this.state.mediaLabels[id] || "").toLowerCase().includes(searchLower)
			  )
			);

			// media-only matches: in the media set but not already a text hit
			const mediaMatches = filteredMessages.filter(msg =>
			  matchingMediaIds.has(msg._id) && !textMatchIds.has(msg._id)
			);

			filteredMessages = [...textMatches, ...mediaMatches];
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
		  // Skip the sort when the list is already in the requested order.
		  // contactMessages (→ renderMessages → filteredMessages) arrives DESC
		  // from app.js _buildContactMessages, and the size/location/links/date
		  // filters preserve order — so for the default 'desc' with no active
		  // search the array is already correct and the O(n log n) sort + array
		  // copy are pure waste. We still sort for 'asc' (needs the flip) and
		  // whenever search ran (it reorders into [textMatches, ...mediaMatches]).
		  const _searchActive = !!(this.props.searchString && this.props.searchString.length > 1);
		  if (this.props.sortOrder === 'asc' || _searchActive) {
		    const _ts = (v) => {
		      if (v == null) return 0;
		      if (v instanceof Date) return v.getTime();
		      if (typeof v === 'number') return v;
		      const t = new Date(v).getTime();
		      return isNaN(t) ? 0 : t;
		    };
		    const _orderMul = this.props.sortOrder === 'asc' ? 1 : -1;
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
		  }

		if (this.state.renderMessages.length > 0 && filteredMessages.length > 0) {
			let last_message_ts = this.state.renderMessages[0].createdAt;
			if (filteredMessages[0].createdAt > last_message_ts) {
				this.setState({scrollToBottom: true});
			}
		}
		  // The pipeline rebuilds row objects every run, so a deep "did the
		  // result change" check isn't cheap; but the common empty→empty case
		  // (triggers firing while the chat has no matches) is worth skipping
		  // outright so it doesn't push an identical empty array and a wasted
		  // render pass.
		  const _prevFiltered = this.state.filteredMessages;
		  if (!(filteredMessages.length === 0
				&& _prevFiltered && _prevFiltered.length === 0)) {
			  this.setState({
				filteredMessages,
			  });
		  }
	  
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
		  if (this.props.orderBy === 'size') {
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
				  // 'contain' so the whole frame fits inside the 16:9 box
				  // (letterboxed on the black surface) instead of cropping
				  // the top/bottom of portrait clips.
				  resizeMode: 'contain',
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



	toggleGridSize = (id) => {
	  this.setState((prevState) => {
		let values = [1, 2, 3];
	
		const prevGrid = prevState.thumbnailGridSize || {};
		// Guard: the group id can be stale (e.g. the leader bubble was
		// deleted / re-created by a resend), leaving imageGroups[id]
		// undefined — reading .length off it crashed the render.
		const images = this.state.imageGroups[id] || [];
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
            const _rawTrail = (this.props.messagesMetadata
                && this.props.messagesMetadata[currentMessage._id]) || [];
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
                        // Capture the trail the inline bubble is showing RIGHT
                        // NOW so the fullscreen modal renders the same points
                        // even if messagesMetadata is transiently trimmed by an
                        // async reload after we open. `trail` here is the
                        // already-built inline trail (full 41-point set).
                        this.setState({
                            fullScreenLocation: currentMessage,
                            fullScreenLocationTrail: trail,
                        });
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

	    let progressData = this.props.transferProgress[currentMessage._id] ?? null;
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
            // Same Day-mode fix as the image branch below: direction-only
            // colours rendered white-on-white on an incoming bubble in
            // Day mode (theme.bubbleIncoming = '#FFFFFF'), hiding the
            // menu / fullscreen / cancel icons. Use the theme's bubble
            // text colours so contrast holds in both modes.
            const _vidTheme = DarkModeManager.getTheme();
            const fontColor = isIncoming
                ? _vidTheme.bubbleIncomingText
                : _vidTheme.bubbleOutgoingText;

			if (currentMessage.metadata.preview) {
				// Same layout as the image preview below — just the
				// "Full size of …" toggle, on a bar with some height.
				return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
						justifyContent: 'flex-start',
						paddingHorizontal: 10,
						paddingTop: 12,
						minHeight: 56}, styles.photoMenuContainer, extraStyles]}>

					{this.renderFullSizeToggle(currentMessage)}

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
								iconColor={fontColor}
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
							  numberOfLines={1}
							  ellipsizeMode="tail"
							  style={{
								color: fontColor,
								fontSize: 14,
								flexShrink: 1,
								textAlignVertical: 'center',
								includeFontPadding: false,
								marginTop: 6,
							  }}
							>
							  {isTransfering ? '' : mediaLabel}
							</Text>

							{isTransfering && (
					        <View style={{ marginTop: 8, alignItems: 'flex-start', width: 140 }}>
							  <Progress.Bar
								progress={progress}
								indeterminate={isStarting}
								width={120}        // longer bar for visibility
								height={7}
								borderRadius={4}
								borderWidth={0}
								color={isTransfering ? "#007AFF" : "orange"}
								unfilledColor="#e0e0e0"
								style={{ marginRight: 12 }}
							  />

							  <Text
								numberOfLines={1}
								style={{
								  fontSize: 12,
								  color: 'orange',
								  marginTop: 2,
								  marginLeft: 2,
								  width: 138,
								}}
							  >
								{(stage ? stage + ' ' : '') + (isStarting ? '…' : Math.round(progress * 100) + '%')}
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
            // The image-bubble footer hosts the kebab/menu, grid, and
            // fullscreen IconButtons over the bubble's background.
            // Pre-fix this picked colours by direction only — black
            // when outgoing, white when incoming — which worked in
            // Night mode (incoming bubble = green, outgoing = white)
            // but broke in Day mode: the incoming bubble is white
            // (theme.bubbleIncoming = '#FFFFFF'), so white-on-white
            // made the entire icon row invisible. Pull the contrasting
            // colour from the active theme's bubble-text keys
            // (bubbleIncomingText / bubbleOutgoingText) instead so the
            // icons stay readable on either bubble in either mode.
            const _imgTheme = DarkModeManager.getTheme();
            const fontColor = isIncoming
                ? _imgTheme.bubbleIncomingText
                : _imgTheme.bubbleOutgoingText;

            if (currentMessage.metadata.preview) {
				return (
					<View style={[{flexDirection: 'row', alignItems: 'center',
						justifyContent: 'flex-start',
						paddingHorizontal: 10,
						paddingTop: 12,
						minHeight: 56}, styles.photoMenuContainer, extraStyles]}>


					{this.renderFullSizeToggle(currentMessage)}

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
							iconColor={fontColor}
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

				    const isWideHtml = /<table|<tr|<td|<th/i.test(html);

			   
				return (
                <View style={[styles.messageTextContainer, extraStyles, { flexDirection: 'row', alignItems: 'center', marginLeft: 10, marginRight: 10}]}>

				  <RenderHTML
					source={{ html: html }}
					contentWidth={w}
					customHTMLElementModels={customHTMLElementModels}
					domVisitors={htmlDomVisitors}
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
					ignoredDomTags={ignoredHtmlTags}

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
				  {isWideHtml && (
                    <TouchableOpacity
                      onPress={() => {
                          if (typeof this.props.setFullScreen === 'function') this.props.setFullScreen(true);
                          this.setState({ fullScreenHtml: currentMessage, actionSheetDisplayed: false });
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 14, padding: 3 }}>
                      <Icon name="fullscreen" size={20} color="#fff" />
                    </TouchableOpacity>
                  )}
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
                        this.props.meetMeAt((this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri), _link);
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
                    {/* flexWrap:'wrap' added to match CustomMessageText's
                        row container. Without it, the outer wrapper here
                        can prevent the inner ParsedText from wrapping on
                        Samsung devices with large Font size / Bold font /
                        Screen zoom turned on, and the message renders as
                        a single clipped line. */}
                    <View style={[styles.messageTextContainer, extraStyles, { flexDirection: 'row', alignItems: 'center', marginLeft: 10, flexWrap: 'wrap'}]}>
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
	  if (this.props.orderBy === 'size') return null;

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

	  // Go-to-date pill: when the user is searching by text inside a
	  // non-grid view (text / links / audio / location / other —
	  // anything but the image and video ThumbnailGrids, which don't
	  // route through renderDay anyway), turn each between-messages
	  // day header into a tappable button. Tapping it clears the
	  // search query (same path as the Searchbar's × — see
	  // ReadyBox.clearMessageSearch), dismisses the keyboard, and
	  // jumps the chat to that day by setting dateYear / dateMonth /
	  // dateDay together. Visual treatment differs from the
	  // read-only label above (Sylk-blue fill, calendar-arrow icon,
	  // explicit "Go to …" wording) so the affordance is obvious.
	  //
	  // Suppressed when ANY calendar date pill is already
	  // selected (year, month, or day). Once the user has
	  // narrowed via the drill-down, the chat is already pinned
	  // — a "Go to date X" button reads as redundant noise, and
	  // the selected pill above already tells them which date.
	  const _searchActive = !!(this.props.searchString
	      && this.props.searchString.length > 0);
	  const _inGrid = this.showImageGrid || this.showVideoGrid;
	  const _hasActiveTag = !!(this.state.dateYear
	      || this.state.dateMonth
	      || this.state.dateDay);
	  if (_searchActive && !_inGrid && !_hasActiveTag) {
	      const _tags = utils.getMessageDateTags(currentMessage && currentMessage.createdAt);
	      const _dayTag = _tags && _tags.day;
	      if (_dayTag) {
	          // Derive the implicit year/month so the
	          // breadcrumb in the calendar bar lights up the
	          // full path (Year + Month + Day) after the tap.
	          const _yId = _dayTag.id.substring(0, 4);
	          const _mId = _dayTag.id.substring(0, 7);
	          return (
	              <View style={{
	                  alignItems: 'center',
	                  marginTop: 5,
	                  marginBottom: 10,
	              }}>
	                  <TouchableOpacity
	                      activeOpacity={0.8}
	                      onPress={() => {
	                          try { Keyboard.dismiss(); } catch (e) {}
	                          if (typeof this.props.clearMessageSearch === 'function') {
	                              this.props.clearMessageSearch();
	                          }
	                          this.setState({
	                              dateYear: _yId,
	                              dateMonth: _mId,
	                              dateDay: _dayTag.id,
	                          });
	                      }}
	                      style={{
	                          flexDirection: 'row',
	                          alignItems: 'center',
	                          backgroundColor: '#436294', // Sylk-blue
	                          paddingHorizontal: 12,
	                          paddingVertical: 5,
	                          borderRadius: 14,
	                      }}
	                  >
	                      <Icon name="calendar-arrow-right" size={14} color="#FFFFFF" />
	                      <Text style={{
	                          color: '#FFFFFF',
	                          fontSize: 12,
	                          fontWeight: '600',
	                          marginLeft: 6,
	                      }}>
	                          Go to {_dayTag.label}
	                      </Text>
	                  </TouchableOpacity>
	              </View>
	          );
	      }
	  }

	  // Calendar pill active → hide GiftedChat's between-messages
	  // date label entirely. The bar above already shows what
	  // period the chat is pinned to (Year + Month + Day pills
	  // highlighted), and on Day-selection in particular every
	  // bubble shares the same date — the in-line "May 15, 2025"
	  // separator becomes pure noise. Hide it for Year and Month
	  // selections too since the calendar bar is doing the job
	  // and the date label adds chrome to a view the user has
	  // already narrowed.
	  if (_hasActiveTag) {
	      return null;
	  }

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
	  // Call system messages carry metadata.trace ({callid,fromtag,
	  // totag,proxyIP}); make those tappable to open the CDRTool
	  // SIP-trace page (gifted-chat's SystemMessage has no onPress of
	  // its own, so we wrap it). Non-call system messages render as
	  // before — plain, non-interactive centered text.
	  const _smTrace = props.currentMessage
	      && props.currentMessage.metadata
	      && props.currentMessage.metadata.trace;
	  const _smHasTrace = !!(_smTrace && _smTrace.callid);
	  // QoS link — opens the server-side qos summary modal (metadata.qos).
	  const _smQos = props.currentMessage
	      && props.currentMessage.metadata
	      && props.currentMessage.metadata.qos;
	  const _smHasQos = !!(_smQos && _smQos.callid && typeof this.props.openQosSummary === 'function');
	  const _smTextStyle = {
	      color: _smIsDark ? '#FFFFFF' : '#444444',
	      fontSize: 12,
	      fontWeight: '400',
	      textAlign: 'center',
	  };
	  // Plain (non-call) system note: centered muted text, as before.
	  if (!_smHasTrace && !_smHasQos) {
	      return (
	          <SystemMessage
	              {...props}
	              wrapperStyle={_smWrapperStyle}
	              textStyle={_smTextStyle}
	          />
	      );
	  }
	  // Call message with a trace: render custom so that ONLY the word
	  // "call" is an underlined blue link that opens the SIP trace —
	  // the rest of the line (timestamp, duration, etc.) stays plain.
	  // Tapping the call opens the QoS panel (which itself links to the full
	  // SIP trace). When no QoS summary is available (e.g. no qos-server
	  // configured), fall back to opening the SIP trace directly.
	  const _openCall = () => {
	      if (_smHasQos && typeof this.props.openQosSummary === 'function') {
	          this.props.openQosSummary(_smQos);
	      } else if (typeof this.props.openCallTrace === 'function') {
	          this.props.openCallTrace(_smTrace);
	      } else {
	          console.log('[qos] no openQosSummary/openCallTrace prop — cannot open');
	      }
	  };
	  const _smText = (props.currentMessage && props.currentMessage.text) || '';
	  const _smMatch = /call/i.exec(_smText);
	  const _smLinkStyle = { color: '#2f80c8', textDecorationLine: 'underline' };
	  if (!_smMatch) {
	      // No "call" word to highlight — make the whole line tappable.
	      return (
	          <View style={_smWrapperStyle}>
	              <Text style={[_smTextStyle, _smLinkStyle]} onPress={_openCall} suppressHighlighting={true}>
	                  {_smText}
	              </Text>
	          </View>
	      );
	  }
	  const _smBefore = _smText.slice(0, _smMatch.index);
	  const _smWord = _smText.slice(_smMatch.index, _smMatch.index + _smMatch[0].length);
	  const _smAfter = _smText.slice(_smMatch.index + _smMatch[0].length);
	  return (
	      <View style={_smWrapperStyle}>
	          <Text style={_smTextStyle}>
	              {_smBefore}
	              <Text style={_smLinkStyle} onPress={_openCall} suppressHighlighting={true}>
	                  {_smWord}
	              </Text>
	              {_smAfter}
	          </Text>
	      </View>
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
	    const trail = this.props.messagesMetadata
	      && this.props.messagesMetadata[currentMessage._id];
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
	  if (this.props.orderBy !== 'size') {
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

// Fetch the contact's full-history date index from SQL via the
// app.js prop callback. Idempotent: each call replaces the
// previous result; no debounce here because the call sites
// (selectedContact change + post-send / post-receive append)
// are already coarse-grained. Swallows errors silently so a
// hiccup in the SQL layer can't take down the chat UI; the
// calendar bar just shows whatever the most recent successful
// load returned.
_loadContactDateIndex = async (contact, category, pinned) => {
    if (!contact || typeof this.props.getContactDateIndex !== 'function') {
        return;
    }
    const _catForLoad = (category !== undefined)
        ? category
        : this.state.messagesCategoryFilter;
    const _pinnedForLoad = (pinned !== undefined)
        ? !!pinned
        : !!this.props.pinned;
    try {
        const index = await this.props.getContactDateIndex(
            contact, _catForLoad, { pinned: _pinnedForLoad });
        if (this.ended) return;
        // Race guard: bail if the contact, category, OR pinned
        // mode has shifted since we kicked the load off. A fast
        // tap on (Pinned on → Pinned off) would otherwise let an
        // older "pinned-only" result win.
        const _cur = this.state.selectedContact;
        if (_cur && contact && _cur.uri !== contact.uri) return;
        if (_catForLoad !== this.state.messagesCategoryFilter) return;
        if (_pinnedForLoad !== !!this.props.pinned) return;
        this.setState({contactDateIndex: Array.isArray(index) ? index : []});
    } catch (e) {
        console.log('[dateIndex] load failed:', e && e.message);
    }
};

// Compute a unix-seconds range from a year/month/day selection.
// Both ends inclusive in LOCAL time so it lines up with the SQL
// date index (strftime('localtime')) and the in-memory tag
// pipeline (utils.getMessageDateTags uses local).
//   • dayId set    → 00:00:00 → 23:59:59 of that day
//   • monthId set  → 1st 00:00 → last-day 23:59:59 of that month
//   • yearId set   → Jan 1 00:00 → Dec 31 23:59:59 of that year
//   • all null     → empty range (no filter)
_dateFilterRange = ({yearId, monthId, dayId}) => {
    if (dayId) {
        const [y, m, d] = dayId.split('-').map(Number);
        const a = new Date(y, m - 1, d, 0, 0, 0).getTime() / 1000;
        const b = new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000;
        return { dateFrom: Math.floor(a), dateTo: Math.floor(b) };
    }
    if (monthId) {
        const [y, m] = monthId.split('-').map(Number);
        const a = new Date(y, m - 1, 1, 0, 0, 0).getTime() / 1000;
        // Last day = day 0 of next month
        const b = new Date(y, m, 0, 23, 59, 59).getTime() / 1000;
        return { dateFrom: Math.floor(a), dateTo: Math.floor(b) };
    }
    if (yearId) {
        const y = Number(yearId);
        const a = new Date(y, 0, 1, 0, 0, 0).getTime() / 1000;
        const b = new Date(y, 11, 31, 23, 59, 59).getTime() / 1000;
        return { dateFrom: Math.floor(a), dateTo: Math.floor(b) };
    }
    return {};  // no date filter active
};

// Drive a getMessages refetch with the current category + the
// passed date selection. Called from selectDateYear / Month / Day
// on both select and deselect. The state setState for the
// dateYear/Month/Day happens in the caller — this helper just
// takes the post-state-change values so it doesn't have to wait
// for setState to commit.
_refetchForDateSelection = ({yearId, monthId, dayId}, opts) => {
    const contact = this.state.selectedContact;
    if (!contact || typeof this.props.getMessages !== 'function') return;
    const range = this._dateFilterRange({yearId, monthId, dayId});
    const hasRange = range.dateFrom != null;
    // Allow the caller to override category / pinned without
    // waiting for the matching setState to commit. The async
    // gap was the bug behind "go to chat on this day" silently
    // refetching with the OLD category (image / video) — the
    // user landed on the date but stayed inside the grid view
    // because category had visually-but-not-yet-actually been
    // cleared. Explicit override at the call site sidesteps
    // setState's batching.
    const _cat = (opts && 'category' in opts)
        ? opts.category
        : this.state.messagesCategoryFilter;
    const _pinned = (opts && 'pinned' in opts)
        ? opts.pinned
        : this.props.pinned;
    console.log('[dateFetch] refetch',
        hasRange ? `range=${new Date(range.dateFrom * 1000).toISOString().slice(0,10)}..${new Date(range.dateTo * 1000).toISOString().slice(0,10)}` : 'no range (full window)',
        'category=', _cat || 'none',
        'pinned=', !!_pinned);
    this.setState({renderMessages: [], messagesLoading: true});
    if (this._messagesLoadingTimer) {
        clearTimeout(this._messagesLoadingTimer);
    }
    this._messagesLoadingTimer = setTimeout(() => {
        this._messagesLoadingTimer = null;
        if (this.state.messagesLoading) {
            this.setState({messagesLoading: false});
        }
    }, 5000);
    this.props.getMessages(contact.uri, {
        category: _cat,
        pinned: _pinned,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
    });
};

// Per-tile "go to chat on this day" handler. Triggered by the
// small chat icon overlay on each image/video grid tile. The
// goal is the same as picking the day pill in the calendar bar
// PLUS dropping out of the media-type filter so the user lands
// in the regular chat view, narrowed to that picture's day.
// Useful workflow: browse photo gallery → spot something
// interesting → "what were we talking about that day?"
_goToChatOnDayOfItem = (item) => {
    if (!item) return;
    const ts = item.createdAt || item.timestamp;
    const tags = utils.getMessageDateTags(ts);
    const _dayTag = tags && tags.day;
    if (!_dayTag) {
        console.log('[goToDay] no day tag derivable from item', item.id);
        return;
    }
    const _yId = _dayTag.id.substring(0, 4);
    const _mId = _dayTag.id.substring(0, 7);
    console.log('[goToDay] navigating to day', _dayTag.id, 'from grid tile', item.id);
    // Suppress the next category-change CWRP branch. The
    // clearMessageCategoryFilter call below makes the parent
    // (ReadyBox) emit a fresh messagesCategoryFilter=null prop,
    // and our CWRP normally treats that as "user picked a new
    // category, wipe the date filter and re-load fresh". For
    // this code path we WANT to keep dateYear/Month/Day set —
    // they're the whole point of the navigation. The flag is
    // consumed (and cleared) inside the CWRP branch on the very
    // next pass.
    this._suppressNextCategoryReset = true;
    if (typeof this.props.clearMessageCategoryFilter === 'function') {
        this.props.clearMessageCategoryFilter();
    }
    this.setState({
        // Mirror the impending prop change so the chat-view
        // gate flips immediately (showChat reads
        // this.state.messagesCategoryFilter).
        messagesCategoryFilter: null,
        dateYear: _yId,
        dateMonth: _mId,
        dateDay: _dayTag.id,
    });
    this._refetchForDateSelection(
        {yearId: _yId, monthId: _mId, dayId: _dayTag.id},
        {category: null});
};

// Year/Month/Day drill-down handlers.
//
// Selection rules:
//   • Picking a year clears month and day (the lower rows
//     repopulate against the new parent context).
//   • Picking a month sets/keeps the implied year and clears day.
//   • Picking a day sets/keeps the implied year+month.
//
// Deselection rules (tap the same pill again):
//   • Clears that level AND every level below it. Re-tap year →
//     wipe month + day too. Re-tap month → wipe day. Re-tap day
//     → wipe just day.
selectDateYear = (yearId) => {
    if (this.state.dateYear === yearId) {
        console.log('[dateSel] year DESELECTED', yearId,
            '(also clearing month + day, refetching default window)');
        this.setState({dateYear: null, dateMonth: null, dateDay: null});
        this._refetchForDateSelection({yearId: null, monthId: null, dayId: null});
        return;
    }
    const _yr = (this.state.availableYears || []).find(t => t && t.id === yearId);
    console.log('[dateSel] year SELECTED', yearId,
        '(SQL pill count:', _yr ? _yr.count : '?', ')',
        'category=', this.state.messagesCategoryFilter || 'none');
    this.setState({dateYear: yearId, dateMonth: null, dateDay: null});
    this._refetchForDateSelection({yearId, monthId: null, dayId: null});
};

selectDateMonth = (monthId) => {
    const _yearId = (monthId && monthId.length >= 4)
        ? monthId.substring(0, 4)
        : null;
    if (this.state.dateMonth === monthId) {
        console.log('[dateSel] month DESELECTED', monthId,
            '(refetching the parent year range)');
        this.setState({dateMonth: null, dateDay: null});
        // Falls back to whatever year is still selected (or no
        // range if year was already cleared).
        this._refetchForDateSelection({
            yearId: this.state.dateYear,
            monthId: null,
            dayId: null,
        });
        return;
    }
    const _m = (this.state.availableMonths || []).find(t => t && t.id === monthId);
    console.log('[dateSel] month SELECTED', monthId,
        '(SQL pill count:', _m ? _m.count : '?', ')',
        'category=', this.state.messagesCategoryFilter || 'none');
    this.setState({dateYear: _yearId, dateMonth: monthId, dateDay: null});
    this._refetchForDateSelection({yearId: _yearId, monthId, dayId: null});
};

selectDateDay = (dayId) => {
    const _yearId  = (dayId && dayId.length >= 4)  ? dayId.substring(0, 4)  : null;
    const _monthId = (dayId && dayId.length >= 7)  ? dayId.substring(0, 7)  : null;
    if (this.state.dateDay === dayId) {
        console.log('[dateSel] day DESELECTED', dayId,
            '(refetching the parent month range)');
        this.setState({dateDay: null});
        this._refetchForDateSelection({
            yearId: this.state.dateYear,
            monthId: this.state.dateMonth,
            dayId: null,
        });
        return;
    }
    const _d = (this.state.availableDays || []).find(t => t && t.id === dayId);
    console.log('[dateSel] day SELECTED', dayId,
        '(SQL pill count:', _d ? _d.count : '?', ')',
        'category=', this.state.messagesCategoryFilter || 'none');
    this.setState({dateYear: _yearId, dateMonth: _monthId, dateDay: dayId});
    this._refetchForDateSelection({yearId: _yearId, monthId: _monthId, dayId});
};

// Date-period filter bar. Renders only when a media-type filter
// is active (the chips have nothing to do otherwise — the
// mixed-timeline view doesn't surface this functionality). Two
// stacked rows:
//   • D / W / M / Y chips (icon + label, same visual language as
//     the bottom navbar's category chips).
//   • Horizontal scroller of available tags for the active
//     period. Each tag pill carries the human-readable label
//     ("May 2026", "Week 21, 2026", …). The scroller only renders
//     when a period is selected — the chips alone keep the bar
//     small when the user hasn't picked one yet.
renderDatePeriodBar = () => {
    // Render when ANY of:
    //   • a media-type category is active
    //   • any date filter is set (year/month/day)
    //   • the message search bar is open
    //   • pinned mode is active (cumulative modifier — when the
    //     user has narrowed to pinned messages the calendar bar
    //     helps them browse those by date too)
    const _searchBarOpen = !!this.props.searchMessages;
    const _pinnedOn = !!this.props.pinned;
    const _anyDate = !!(this.state.dateYear
        || this.state.dateMonth
        || this.state.dateDay);
    if (!this.state.messagesCategoryFilter
            && !_anyDate
            && !_searchBarOpen
            && !_pinnedOn) {
        return null;
    }
    const theme = DarkModeManager.getTheme();
    const _bg = theme.surface;
    const _fg = theme.textPrimary;
    const _activeBg = '#436294';   // Sylk-blue
    const _activeFg = '#FFFFFF';

    const years  = this.state.availableYears  || [];
    const months = this.state.availableMonths || [];
    const days   = this.state.availableDays   || [];
    const yearSel  = this.state.dateYear;
    const monthSel = this.state.dateMonth;
    const daySel   = this.state.dateDay;

    // Tiny helper: format a count for the pill suffix. We show
    // the count for ANY positive value (including 1) — the
    // previous "hide for 1" rule had the user reading "May 2026"
    // as zero rather than one. Compact thousands ("1.2k") keep
    // the labels short on dense years.
    const _fmtCount = (n) => {
        if (!n || n <= 0) return '';
        if (n < 1000) return ` (${n})`;
        const k = (n / 1000).toFixed(n < 10000 ? 1 : 0);
        return ` (${k}k)`;
    };

    // A row factory: title + ref + tags + selected id + onPress.
    // Shared between Year / Month / Day so the visual treatment
    // stays consistent.
    const _renderRow = (title, tags, selectedId, onTagPress, listRef, emptyText) => {
        if (!tags || tags.length === 0) {
            // For Year (always visible) we surface an empty state;
            // for Month/Day we just don't render the row at all
            // (handled by the parent conditional below).
            return (
                <View style={{paddingHorizontal: 12, paddingVertical: 4}}>
                    <Text style={{fontSize: 11, color: _fg, opacity: 0.6}}>
                        {emptyText}
                    </Text>
                </View>
            );
        }
        return (
            <View style={{paddingVertical: 2}}>
                <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10}}>
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 10, fontWeight: '600',
                            color: _fg, opacity: 0.55,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            marginRight: 8,
                            // Wider than the longest label ('Month'
                            // at uppercase bold + 0.5 letter spacing
                            // overflowed 42px). numberOfLines={1}
                            // is the belt-and-braces guard against
                            // future longer titles.
                            width: 56,
                        }}>{title}</Text>
                    <FlatList
                        // Title-keyed so each row remounts when its
                        // parent selection changes — resets the
                        // scroll offset so the new tag list starts
                        // visible at the leftmost (newest) entry.
                        key={`row-${title}-${selectedId || 'none'}`}
                        ref={ref => { if (listRef) listRef.current = ref; }}
                        onScrollToIndexFailed={(info) => {
                            const _w = new Promise(r => setTimeout(r, 100));
                            _w.then(() => {
                                const r = listRef && listRef.current;
                                if (r && r.scrollToIndex) {
                                    try { r.scrollToIndex({index: info.index, animated: true, viewPosition: 0.5}); }
                                    catch (e) {}
                                }
                            });
                        }}
                        horizontal
                        data={tags}
                        keyExtractor={t => String(t.id)}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{paddingRight: 8}}
                        style={{flex: 1}}
                        renderItem={({item}) => {
                            const isSel = selectedId === item.id;
                            return (
                                <TouchableOpacity
                                    onPress={() => onTagPress(item.id)}
                                    style={{
                                        marginRight: 6,
                                        paddingHorizontal: 10,
                                        paddingVertical: 4,
                                        borderRadius: 12,
                                        backgroundColor: isSel ? _activeBg : 'rgba(0,0,0,0.05)',
                                        borderWidth: isSel ? 0 : 0.5,
                                        borderColor: 'rgba(0,0,0,0.15)',
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 12,
                                        color: isSel ? _activeFg : _fg,
                                    }}>{item.label}{_fmtCount(item.count)}</Text>
                                </TouchableOpacity>
                            );
                        }}
                    />
                </View>
            </View>
        );
    };

    // Per-row refs live on `this` so the CDU scroll-to-selected
    // hook can address them by name when a selection changes.
    this._yearListRef  = this._yearListRef  || { current: null };
    this._monthListRef = this._monthListRef || { current: null };
    this._dayListRef   = this._dayListRef   || { current: null };

    return (
        <View style={{
            backgroundColor: _bg,
            zIndex: 10,
            elevation: 2,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.divider || 'rgba(0,0,0,0.15)',
            paddingVertical: 4,
        }}>
            {/* Year row — always rendered when the bar is up. */}
            {_renderRow('Year', years, yearSel,
                (id) => this.selectDateYear(id),
                this._yearListRef,
                'No dates yet.')}

            {/* Month row — visible once a year is selected. */}
            {yearSel ? _renderRow('Month', months, monthSel,
                (id) => this.selectDateMonth(id),
                this._monthListRef,
                'No months in this year.') : null}

            {/* Day row — visible once a month is selected. */}
            {monthSel ? _renderRow('Day', days, daySel,
                (id) => this.selectDateDay(id),
                this._dayListRef,
                'No days in this month.') : null}
        </View>
    );
};

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

	// Pull-up-to-refresh handler — intentionally a no-op. Swiping up at
	// the bottom of the chat no longer fetches server history.
	_onChatPullRefresh = () => {
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

		if (this.props.inviteContacts) {
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

           if (utils.isAnonymous(this.state.selectedContact.uri)) {
               return false;
           }
       }

       // Phone-number (tel) contacts previously returned false here,
       // which hid the ENTIRE chat — including call recordings and the
       // call-duration system messages. Messaging a PSTN number isn't
       // possible, but the message LIST must still render; only the
       // composer is suppressed (see the chatInputClass picker and
       // _chatIsReadOnly, which swap in noChatInputToolbar for tel
       // contacts). So showChat no longer gates on isPhoneNumber.

       if (this.props.selectedContact) {
           return true;
       }

       return false;
    }

	get isAnonymous() {
	   if (!this.state.selectedContact || !this.state.selectedContact.uri) {
           return false;
       }

	   return utils.isAnonymous(this.state.selectedContact.uri);
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

    // Viewport-driven file/image work: only DOWNLOAD/DECRYPT the attachments
    // that are actually on screen, and trigger the rest as they scroll in.
    // Text messages are decrypted eagerly (small); attachments are not, so we
    // never download/decrypt 100 off-screen images on chat open. Guard once per
    // transfer so a bubble lingering in view doesn't re-fire.
    if (!this._fileViewKicked) this._fileViewKicked = new Set();
    for (const v of viewableItems) {
      const m = v && v.item;
      const meta = m && m.metadata;
      if (!meta || !meta.filename) continue;
      const key = meta.transfer_id || m._id;
      if (this._fileViewKicked.has(key)) continue;
      const lu = meta.local_url || '';
      if (lu && lu.endsWith('.asc')) {
        // On disk but still encrypted → decrypt now that it's visible.
        this._fileViewKicked.add(key);
        if (this.props.decryptFunc) this.props.decryptFunc(meta);
      } else if (!lu && meta.url) {
        // Visible but not downloaded → fetch it. Being in the viewport is an
        // explicit "show me this", so autoDownloadFile runs in viewport mode:
        // it bypasses the passive prefs / sync-in-progress gates but STILL
        // honours the size cap (large files aren't auto-fetched on mobile — the
        // user taps those). downloadFile decrypts after download for .asc.
        this._fileViewKicked.add(key);
        if (this.props.autoDownloadFile) this.props.autoDownloadFile(meta, {viewport: true});
      }
    }

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

  // Record the EXIF-corrected display aspect ratio for a message (keyed by
  // stable message id) so the bubble reshapes to hug the image. Only
  // setState's when the ratio actually changed (epsilon-guarded) to avoid a
  // render loop, since onLoad can fire repeatedly. This is what makes the
  // correction reach the MEMOIZED ChatBubble — imageAspectRatios is plumbed
  // as a prop and watched by the bubble's comparator, so old/received images
  // whose metadata holds the wrong (sensor) dimensions now self-correct on
  // load instead of only after opening fullscreen.
  recordImageAspect = (id, aspectRatio) => {
    if (!id || !(aspectRatio > 0) || !isFinite(aspectRatio)) return;
    const existing = this.state.imageAspectRatios && this.state.imageAspectRatios[id];
    if (existing && Math.abs(existing - aspectRatio) <= 0.01) return; // no meaningful change
    this.setState(prev => ({
      imageAspectRatios: { ...prev.imageAspectRatios, [id]: aspectRatio },
    }));
  };

  // When a decoded image turns out to have a different display aspect than
  // what its stored file-transfer metadata claims (older/received rotated
  // photos saved the raw SENSOR size), write the EXIF-corrected dimensions
  // back to the metadata + DB. The in-session state correction
  // (recordImageAspect) reshapes the bubble immediately; THIS makes the fix
  // permanent so the next load reads the right shape from metadata and there
  // is no first-paint flash. Runs at most once per message per session and
  // only when there's a real discrepancy, so it doesn't spam SQL writes.
  maybePersistImageDimensions = (currentMessage, decodedAR) => {
    try {
      const md = currentMessage && currentMessage.metadata;
      if (!md || !md.transfer_id) return;          // only persisted transfers
      if (md.preview) return;                       // not pre-send previews
      if (!(decodedAR > 0) || !isFinite(decodedAR)) return;
      if (typeof this.props.updateFileTransferMetadata !== 'function') return;

      const metaAR = (md.width > 0 && md.height > 0) ? (md.width / md.height) : null;
      if (metaAR && Math.abs(metaAR - decodedAR) <= 0.02) return; // metadata already correct

      const mid = currentMessage._id;
      this.__persistedDims = this.__persistedDims || {};
      if (this.__persistedDims[mid]) return;        // already handled this session
      this.__persistedDims[mid] = true;

      // Re-probe with Image.getSize so we persist the FULL display dimensions
      // (orientation applied), not FastImage's possibly-downsampled decode
      // size — metadata width/height are also used to show resolution.
      const uri = currentMessage.image;
      const probeUri = (Platform.OS === 'android' && uri && uri.startsWith('/'))
        ? 'file://' + uri
        : uri;
      Image.getSize(
        probeUri,
        (w, h) => {
          if (w > 0 && h > 0) {
            /* console.log('[img-meta] persisting corrected dims',
              'id=', String(mid).slice(0, 8), 'dims=', w + 'x' + h,
              'wasMeta=', md.width + 'x' + md.height); */
            this.props.updateFileTransferMetadata(md, 'dimensions', { width: w, height: h });
          }
        },
        (err) => {
          // Leave __persistedDims set so we don't hammer a broken path; the
          // in-session state correction still keeps the bubble shaped right.
          console.log('[img-meta] persist getSize failed',
            'id=', String(mid).slice(0, 8), 'err=', err && (err.message || String(err)));
        }
      );
    } catch (e) {
      // best-effort; never let persistence break rendering
    }
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

  
	getImageGroups() {
	  if (this.state.messagesCategoryFilter) {
	      return;
	  }
	
	  // Guard against a teardown race: during unmount / fast-refresh a final
	  // render can run after state has been partially cleared, leaving these
	  // momentarily undefined and crashing the .filter below.
	  let messages = Array.isArray(this.state.renderMessages) ? this.state.renderMessages : [];
	  if ((this.state.sharingMessages || []).length > 0) {
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


    // DIAGNOSTIC: log the image-grid calendar (year → count) and a per-tile
    // file list with on-disk presence, so we can tell why tiles show Download:
    // file genuinely absent (onDisk=false) vs present-but-no-thumbnail
    // (thumb=false, onDisk=true). Logged once per (contact, image-count).
    async _logImageGridDiag(images) {
        try {
            const sel = this.props.selectedContact && this.props.selectedContact.uri;
            const sig = (sel || '') + ':' + images.length;
            if (this._imgDiagSig === sig) return;
            this._imgDiagSig = sig;

            const byYear = {};
            images.forEach(it => {
                let y = '?';
                try { y = new Date(it.createdAt || it.timestamp).getFullYear(); } catch (e) {}
                byYear[y] = (byYear[y] || 0) + 1;
            });
            const cal = Object.keys(byYear).sort().reverse().map(y => `${y} (${byYear[y]})`).join('  ');
            //console.log('[img-grid] contact=' + sel + ' images=' + images.length + ' calendar: ' + cal);

            let present = 0, missing = 0, noThumb = 0;
            for (const it of images) {
                const lu = it.metadata && it.metadata.local_url;
                const hasThumb = !!it.uri;
                if (!hasThumb) noThumb++;
                let onDisk = false;
                if (lu) { try { onDisk = await RNFS.exists(lu); } catch (e) {} }
                if (onDisk) present++; else missing++;
                /*
                console.log('[img-grid] tile id=' + it.transferId
                    + ' file=' + (it.metadata && it.metadata.filename)
                    + ' thumb=' + hasThumb
                    + ' onDisk=' + onDisk
                    + ' err=' + ((it.metadata && it.metadata.error) || '-')
                    + ' local_url=' + (lu || '(none)'));
                */
            }
            //console.log('[img-grid] summary present=' + present + ' missing=' + missing + ' noThumbnail=' + noThumb + ' of ' + images.length);
        } catch (e) {
            console.log('[img-grid] diag error', e && e.message);
        }
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
            !this.props.shareToContacts && !this.props.inviteContacts;
        const contactSource = allowSourceToggle
            ? ((this.props.contactSource || 'sylk') || 'sylk')
            : 'sylk';
        let contacts =
            contactSource === 'ab'
                ? []
                : (this.props.contactsFilter === 'graveyard'
                    ? ((this.props.graveyardContacts || []) || []) // permanent tombstones, loaded separately
                    : this.props.allContacts);
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
        // state.keys is null *while keys are still loading* (e.g. when the app
        // is opened from a push, before loadAccount has hydrated them) AND when
        // there genuinely is no key. Only treat it as "no private key" once the
        // keys object has actually loaded — otherwise we flash a false
        // "Cannot send messages" banner during the load.
        const keysLoaded = !!this.props.keys;
        const hasPrivateKey = !!(this.props.keys && this.props.keys.private);

        if (keysLoaded && !hasPrivateKey) {
            chatInputClass = this.noKeyInputToolbar;
        } else if (this.state.selectedContact) {
           if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }

           if (this.props.searchMessages) {
               chatInputClass = this.noChatInputToolbar;
           }

           // Tel (PSTN) contact — can't receive chat messages, so hide
           // the composer while keeping the message list (call
           // recordings + call-duration system messages) visible.
           if (this._selectedContactIsTel()) {
               chatInputClass = this.noChatInputToolbar;
           }

        } else if (!this.props.chat) {
             chatInputClass = this.noChatInputToolbar;
        }

        // While the audio recorder is "armed" (input selector + Start shown,
        // but capture not yet started) hide the whole input bar — the bottom
        // recording controls should only appear once audio is actually
        // recording. Highest-priority override so it wins over the branches
        // above.
        if (this.props.audioArmed) {
            chatInputClass = this.noChatInputToolbar;
        }

        // MEMOIZED DERIVATION. The filter/dedup/sort pipeline below is
        // O(all contacts) and does NOT depend on the current selection. Cache
        // it keyed on the inputs that DO affect it, so a selection toggle
        // (which only flips the per-row `selected` flag, re-applied just after
        // this block) doesn't re-run the whole pipeline — that was the ~3s
        // per-checkbox lag on a large contact list in debug builds.

        let columns = 1;

        if (this.props.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        const contactsContainer = this.props.orientation === 'landscape' ? styles.contactsLandscapeContainer : styles.contactsPortraitContainer;
        const borderClass = (this.state.filteredMessages.length > 0 && !this.props.chat) ? styles.chatBorder : null;
        
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
            if (androidVersion >= 34 || this.props.isTablet || wideCanvas) {
                useManualOverlap = true;
            }
            // Per-render diagnostic — uncomment to debug which
            // keyboard-handling branch a given device hits.
            // const _logKey = `${androidVersion}|${this.props.isTablet}|${_shortSide}|${useManualOverlap}`;
            // if (this._lastKbFixLog !== _logKey) {
            //     this._lastKbFixLog = _logKey;
            //     console.log('[keyboardFix] android API=', androidVersion,
            //         'isTablet=', this.props.isTablet,
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
       
        const messagesMetadata = this.props.messagesMetadata; 
        const replyMessages = this.state.replyMessages;
        const mediaLabels = this.state.mediaLabels;
        const mediaRotations = this.state.mediaRotations;
        const shareToContacts = this.props.shareToContacts;
        const transferProgress = this.props.transferProgress;
        const renderMessages = this.state.renderMessages;
        const searchMessages = this.props.searchMessages;
        const searchString = this.props.searchString;
        const gettingSharedAsset = this.state.gettingSharedAsset;
        const showChat = this.showChat;
        const orderBy = this.props.orderBy;
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
        if (this.props.orderBy === 'size'
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

				  return this.props.sortOrder === 'desc'
					? sizeB - sizeA // largest first
					: sizeA - sizeB; // smallest first
				});
		}

        //console.log('this.state.selectedContact', this.state.selectedContact);
        let chatMessages = this.state.focusedMessages || messages;
        // remove duplicate messages no mater what
        chatMessages = chatMessages.filter((v,i,a)=>a.findIndex(v2=>['_id'].every(k=>v2[k] ===v[k]))===i);
        let loadEarlier = !this.isAnonymous && !this.props.totalMessageExceeded && !this.state.gettingSharedAsset && this.state.sharingAssets.length == 0 && messages.length > 0;
        //console.log('chatMessages', chatMessages);
        //console.log(JSON.stringify(chatMessages, null, 2));

        if (this.props.isAudioRecording || this.props.recordingFile) {
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

        // Calendar filter active (any year/month/day selected) →
        // the chat is pinned to exactly the messages inside that
        // period; "Load earlier" would either pull in rows outside
        // the period (which the date filter then drops, making the
        // button look broken) or duplicate the existing slice. The
        // user can widen the window via the calendar bar instead.
        if (this.state.dateYear || this.state.dateMonth || this.state.dateDay) {
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
        let topInset = this.props.insets?.top || 0;
        if (Platform.OS === 'android' && (!topInset || topInset === 0)) {
            const sbh = StatusBar.currentHeight;
            if (typeof sbh === 'number' && sbh > 0) {
                topInset = sbh;
            }
        }
		const bottomInset = this.props.insets?.bottom || 0;
		const leftInset = this.props.insets?.left || 0;
		const rightInset = this.props.insets?.right || 0;

        // Image-grid input. Mirrors the video-grid's dual-clause
        // filter (downloaded + undownloaded file-transfer rows that
        // classify as image). Pre-fix this only included rows where
        // m.image was populated — i.e. files that had completed
        // download. Image-category rows whose file hasn't been
        // downloaded yet still live in renderMessages (SQL
        // category='image' is honest about history), but the old
        // filter dropped them, so the user saw 0 tiles for a day
        // the date pill counted as 3.
        //
        // Now every image-category row produces a tile. Already-
        // downloaded rows render their bitmap; undownloaded rows
        // get a placeholder + cloud-download icon (ThumbnailGrid
        // handles the overlay via showPlayIcon + item.downloaded).
        // Tapping an undownloaded tile fires downloadFile, same
        // path the video grid uses.
        const images = chatMessages
		  .filter(m => {
		      if (!m) return false;
		      if (m.image) return true;
		      // Undownloaded image file-transfer row: classify by
		      // filename + filetype (matching utils.isImage's
		      // precedence in sql2GiftedChat so the persisted
		      // category='image' stamp lines up).
		      if (!m.metadata || !m.metadata.filename) return false;
		      const fname = m.metadata.filename;
		      const ftype = m.metadata.filetype;
		      if (utils.isAudio(fname, ftype)) return false;
		      if (utils.isVideo(fname, ftype)) return false;
		      return utils.isImage(fname, ftype);
		  })
		  .map(msg => ({
			id: String(msg._id),
			// uri drives the FastImage tile. For undownloaded rows
			// it's empty; the ThumbnailGrid renders a grey tile +
			// download icon in that case.
			uri: msg.image || '',
			title: msg.text || '',
			size: msg.metadata && msg.metadata.filesize,
			timestamp: msg.metadata && msg.metadata.timestamp,
			// Surface the bubble's createdAt so the per-tile
			// "go to chat on this day" button can derive a
			// dateDay tag without going back to renderMessages.
			createdAt: msg.createdAt,
			rotation: msg.metadata && msg.metadata.rotation,
			// downloaded flag drives the download-icon overlay in
			// ThumbnailGrid (same field the video grid uses).
			downloaded: !!msg.image,
			// In-flight info for the per-tile progress spinner. Only
			// surfaced when the image is NOT already present: once the
			// bitmap exists (msg.image set, openable full-screen) the tile
			// is downloaded, so a leftover/stuck transferProgress entry
			// (e.g. a prior download that 404'd and never cleared) must NOT
			// keep painting a "0%" spinner over a good image.
			stage: msg.image
			    ? null
			    : (this.props.transferProgress
			        && this.props.transferProgress[msg._id]
			        && this.props.transferProgress[msg._id].stage),
			progress: msg.image
			    ? null
			    : (this.props.transferProgress
			        && this.props.transferProgress[msg._id]
			        && this.props.transferProgress[msg._id].progress),
			// Surface transferId + full metadata so the viewer's
			// missing-file placeholder can both log a useful identifier
			// AND offer the "Download from server" button (which needs
			// metadata.url + transfer_id + sender/receiver). Mirrors
			// the gridImages shape used by the inline grouped-image
			// bubble in the chat view.
			transferId: msg.metadata && msg.metadata.transfer_id,
			metadata: msg.metadata,
		  }));

		// DIAGNOSTIC (console): calendar + per-tile file presence for this contact.
		this._logImageGridDiag(images);

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
		const _transferProgress = this.props.transferProgress || {};
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
		      // Mirror the image-grid mapping: surface the bubble's
		      // createdAt so _goToChatOnDayOfItem can derive a day tag
		      // even when msg.metadata.timestamp is missing (older
		      // file-transfer rows persisted before metadata.timestamp
		      // was populated). Without this fallback the chat-bubble
		      // overlay silently no-ops for those tiles.
		      createdAt: msg.createdAt,
		      rotation: msg.metadata && msg.metadata.rotation,
		      // Raw file-transfer metadata so the grid's
		      // onItemPress can call downloadFile on
		      // undownloaded tiles. The blob carries transfer_id,
		      // url, sender, receiver, hash, etc.
		      metadata: msg.metadata,
		      downloaded: !!msg.video,
		      // As with the image grid: suppress a stale/stuck in-flight
		      // spinner once the video file is present (downloaded).
		      progress: msg.video ? null : (tp ? tp.progress : null),
		      stage: msg.video ? null : (tp ? tp.stage : null),
		    };
		  });

		if (this.props.orderBy === 'timestamp') {
			if (this.props.sortOrder == 'desc') {
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
		    const _collapsed = chatMessages.filter(msg => {
		      // skipped duplicate grouped images
			  // if not an image → always show
			  if (!msg.image) return true;

			  const groupId = this.state.groupOfImage[msg._id];

			  // not grouped → show
			  if (!groupId) return true;

			  // show only first image of group. Guard a stale group id
			  // (the group's members can be deleted/re-created — e.g. by
			  // a resend — leaving groupOfImage pointing at a group that
			  // no longer exists); show the message rather than crash.
			  const _group = this.state.imageGroups[groupId];
			  if (!_group || _group.length === 0) return true;
			  return _group[0] === msg._id;
			});

			// Bake the INHERITED group delivery-state onto each image-group
			// leader. The leader bubble stands in for the whole batch, and
			// its ticks must track the LAST member of the group (the
			// least-progressed photo). But the members are collapsed out
			// above, so when a member's IMDN state flips (e.g. the last
			// photo goes sent → displayed) the leader's OWN flags don't
			// change and its memoized bubble never re-renders. Attach the
			// last member's flags here (on a fresh copy) plus a signature
			// the ChatBubble memo comparator watches, so the leader
			// re-renders and renderTicks reads the up-to-date group state.
			let _byId = null;
			return _collapsed.map(msg => {
			    if (!msg.image) return msg;
			    if (!(msg._id in this.state.imageGroups)) return msg;
			    const _gids = this.state.imageGroups[msg._id] || [];
			    if (_gids.length === 0) return msg;
			    if (!_byId) { _byId = new Map(chatMessages.map(m => [m._id, m])); }
			    const _last = _byId.get(_gids[_gids.length - 1]);
			    if (!_last) return msg;
			    const _s = !!_last.sent, _r = !!_last.received, _p = !!_last.pending;
			    return {
			        ...msg,
			        _groupSent: _s,
			        _groupReceived: _r,
			        _groupPending: _p,
			        _groupTickSig: (_p ? 'p' : '') + (_s ? 's' : '') + (_r ? 'r' : ''),
			    };
			});
		})();
			
		//console.log('visibleMessages', visibleMessages.length);
		//console.log('chatMessages', chatMessages.length);

		// Debug: dump the last 10 bubbles as a vertical stack in the
		// same order they appear on the phone (top = oldest, bottom =
		// newest), outgoing indented to the right to mirror the bubble
		// alignment. visibleMessages is newest-first, so we take the
		// first 10 and reverse. Guarded by a signature so it logs only
		// when the last-10 set actually changes (new/deleted message,
		// contact switch) instead of on every render.
		// Off by default — console.log over Metro is slow, and this runs
		// in render(). Flip to true only when actively debugging ordering.
		const _DEBUG_BUBBLE_STACK = 0;
		try {
			if (_DEBUG_BUBBLE_STACK) {
			const _lastVisible = visibleMessages.slice(0, _DEBUG_BUBBLE_STACK);
			const _sig = _lastVisible.map(m => m._id).join(',');
			if (this._lastStackSig !== _sig) {
				this._lastStackSig = _sig;
				const _rows = _lastVisible.slice().reverse();
				// HH:MM:SS from a Date / ISO / ms createdAt.
				const _hms = (v) => {
					const d = v instanceof Date ? v : new Date(v);
					if (isNaN(d.getTime())) return '--:--:--';
					const p = (n) => String(n).padStart(2, '0');
					return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
				};
				// Media category for file-transfer bubbles. Uses the
				// GiftedChat media fields first, then the metadata
				// mime/filename, falling back to 'file' / 'text'.
				const _cat = (m) => {
					if (m.image) return 'image';
					if (m.video) return 'video';
					if (m.audio) return 'audio';
					const md = m.metadata || {};
					if (md.filename || md.filetype) {
						const ft = (md.filetype || '').toLowerCase();
						const fn = (md.filename || '').toLowerCase();
						if (ft.indexOf('image') === 0 || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/.test(fn)) return 'image';
						if (ft.indexOf('video') === 0 || /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/.test(fn)) return 'video';
						if (ft.indexOf('audio') === 0 || /\.(mp3|wav|ogg|m4a|aac|opus|amr|flac)$/.test(fn)) return 'audio';
						return 'file';
					}
					return 'text';
				};
				console.log('[bubble-stack] last ' + _rows.length + ' messages (top=oldest, bottom=newest):');
				_rows.forEach((m) => {
					const out = m.direction === 'outgoing';
					//console.log(m.metadata);
					let body = m.text
						|| (m.image ? '[image]'
							: m.video ? '[video]'
							: m.audio ? '[audio]'
							: (m.metadata && m.metadata.filename)
								? '[file] ' + m.metadata.filename
								: '');
					body = String(body).replace(/\s+/g, ' ').slice(0, 50);
					// Same failed definition the menu uses: the bubble's
					// own `failed` flag OR a file-transfer metadata.error.
					// Failed → FAILED, otherwise OK.
					const _failed = m.failed || (m.metadata && m.metadata.error);
					// Status flags. For outgoing bubbles show the full delivery
					// state so a spurious "displayed" (received) on an un-sent
					// message is visible: pending / sent / received / displayed.
					let flags;
					if (_failed) {
						flags = 'FAILED';
					} else if (out) {
						// Single resolved status for an outgoing message, in the
						// progression pending → sent → received → displayed
						// (highest reached wins). NB: the stored boolean flags
						// are offset from these names —
						//   received flag (double check) = displayed (read)
						//   sent flag    (single check) = received (delivered)
						//   pending                      = pending (sending)
						//   none set                     = sent (server accepted)
						flags = m.received ? 'displayed'
							: m.sent ? 'received'
							: m.pending ? 'pending'
							: 'sent';
					} else {
						flags = 'OK';
					}
					const cat = _cat(m);
					const catTag = cat !== 'text' ? ' (' + cat + ')' : '';
					// Reply indicator — detect via the SAME source the bubble
					// renders from: messagesMetadata's 'reply' entry. The
					// top-level `replyId` field is clobbered to null by the
					// pipeline, so checking it misses real replies.
					const _replyMeta = this.getMetadataByActionForMessage(m._id, 'reply');
					const replyTag = _replyMeta ? ' [reply→' + JSON.stringify(_replyMeta.value) + ']' : '';
					const line = _hms(m.createdAt) + ' '
						+ (out ? 'OUT' : 'IN ') + ' [' + flags + ']' + catTag + replyTag
						+ ' ' + body + '  id=' + m._id;
					console.log('[bubble-stack] ' + (out ? '                         ' : '') + line);

					// Expand image groups: the visible row is only the group
					// leader (the others are collapsed into its ThumbnailGrid),
					// so list every member by looking it up in renderMessages.
					if (m._id in this.state.imageGroups) {
						const _gids = this.state.imageGroups[m._id] || [];
						const _all = this.state.renderMessages || [];
						console.log('[bubble-stack] ' + (out ? '                         ' : '')
							+ '  └ image group of ' + _gids.length + ':');
						_gids.forEach((gid, gi) => {
							const gm = _all.find(x => x && x._id === gid);
							let gbody;
							if (!gm) {
								gbody = '(not in renderMessages)';
							} else {
								gbody = (gm.metadata && gm.metadata.filename)
									? gm.metadata.filename
									: (gm.image ? '[image]' : (gm.text || ''));
							}
							const gst = gm
								? (gm.received ? 'displayed' : gm.sent ? 'received' : gm.pending ? 'pending' : 'sent')
								: '?';
							console.log('[bubble-stack] ' + (out ? '                         ' : '')
								+ '      ' + (gi + 1) + '/' + _gids.length
								+ ' [' + gst + '] ' + String(gbody).replace(/\s+/g, ' ').slice(0, 40)
								+ '  id=' + gid);
						});
					}
				});
				// Reply-only summary: messages whose metadata carries a 'reply'.
				const _withReply = _rows.filter(m => m && this.getMetadataByActionForMessage(m._id, 'reply'));
				console.log('[bubble-stack] with reply (' + _withReply.length + '): '
					+ _withReply.map(m => {
						const rm = this.getMetadataByActionForMessage(m._id, 'reply');
						return m._id + '→' + JSON.stringify(rm && rm.value);
					}).join(', '));
				// Also dump the contact-row preview — the lastTs + lastMessage
				// that render on the 2nd line of the contact in the list — so we
				// can compare what the row shows against the actual bubble stack.
				const _sc = this.state.selectedContact;
				if (_sc) {
					console.log('[bubble-stack] contact-row preview:'
						+ ' lastTs=' + (_sc.timestamp instanceof Date ? _sc.timestamp.toISOString() : _sc.timestamp)
						+ ' lastMessage=' + JSON.stringify(_sc.lastMessage)
						+ ' lastMessageId=' + _sc.lastMessageId);
				}
			}
			}
		} catch (e) {
			console.log('[bubble-stack] failed', e && e.message);
		}
		  		  
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

				{/* Media-type filter loading overlay. Set true the moment
				    the user taps a media-type chip in the search bar
				    (componentWillReceiveProps detects the messages-
				    CategoryFilter change), cleared as soon as the parent
				    delivers the freshly-fetched messages for this uri.
				    Same centred ActivityIndicator + dim treatment as the
				    gettingSharedAsset overlay above so the two share a
				    visual language. */}
				{this.state.messagesLoading && (
				  <View
					style={{
					  position: 'absolute',
					  top: 0,
					  left: 0,
					  right: 0,
					  bottom: 0,
					  justifyContent: 'center',
					  alignItems: 'center',
					  backgroundColor: 'rgba(0,0,0,0.4)',
					}}
				  >
					<ActivityIndicator size="large" color="#fff" />
				  </View>
				)}
  
             {/* Column count for both media grids. Phone portrait
                 reads cramped at 3 (~120dp tiles on a 360dp screen
                 once gutters bite), so drop to 2; widen to 3
                 whenever there's more horizontal room — tablet or
                 phone-landscape. */}
             {this.showImageGrid ?
				  // The image grid is a flex:1 ThumbnailGrid which
				  // otherwise eats the whole screen — leaving no
				  // room for the date-period bar above it. Wrap in
				  // a column View so the bar sits at the top
				  // (natural height) and the grid takes the rest.
				  // Same pattern as the chat-view branch below.
				  <View style={{flex: 1}}>
				    {this.renderDatePeriodBar()}
				    <View style={{flex: 1}}>
				      <ThumbnailGrid
					images={images}
					isLandscape={this.props.isLandscape}
					numColumns={(this.props.isTablet || this.props.isLandscape) ? 3 : 2}
					showTimestamp={true}
					showSize={true}
					// History gallery: auto-download each tile as it scrolls
					// into view. ignoreAge bypasses autoDownloadFile's 10-day
					// recency cutoff (this grid shows the WHOLE media history,
					// old images included). Its network-preference, mobile and
					// size limits still apply, so a disabled Wi-Fi/Mobile
					// auto-download toggle or an over-cap file is still skipped.
					onAutoDownload={(item) => {
					  if (item && item.metadata && this.props.autoDownloadFile) {
						this.props.autoDownloadFile(item.metadata, {ignoreAge: true});
					  }
					}}
					// Same wiring as the inline grouped-image bubble in
					// the chat view: when the viewer's missing-file
					// placeholder fires, hand the item's full metadata
					// to the app's existing downloadFile pipeline so
					// the user can re-fetch the original from SylkServer
					// without leaving the gallery. force=true bypasses
					// downloadFile's on-disk guard (which has, by
					// definition, just failed for this tile).
					onRequestDownload={(item) => {
					  if (item && item.metadata && this.props.downloadFile) {
						console.log('[image-viewer] manual download (gallery)',
						  'msgId=', item.id,
						  'transferId=', item.transferId || '(none)',
						  'url=', item.metadata.url);
						this.props.downloadFile(item.metadata, true);
					  }
					}}
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
					// Tap routing for undownloaded tiles only.
					// ThumbnailGrid sees showPlayIcon=false and
					// routes downloaded image taps to its built-in
					// openViewer; this callback only fires when the
					// row hasn't been downloaded yet, in which case
					// we kick off downloadFile. Once the file
					// lands, `m.image` populates and the next render's
					// `downloaded: !!msg.image` flag flips the
					// overlay off and routes the next tap into the
					// viewer.
					onItemPress={(item) => {
					  if (!item) return;
					  if (item.metadata && this.props.downloadFile) {
					    console.log('ImageGrid: download tap for', item.id);
					    this.props.downloadFile(item.metadata, true);
					  }
					}}
					// Image grid: no play icon on downloaded tiles (the
					// bitmap is the affordance). ThumbnailGrid still
					// renders the cloud-download overlay on
					// undownloaded tiles and the spinner+percentage
					// during in-flight downloads — those two states
					// are driven by item.downloaded / item.stage
					// independently of showPlayIcon. Video grid still
					// passes showPlayIcon=true for the play triangle
					// on downloaded videos.
					showPlayIcon={false}
					// "Go to chat on this day" — appears as a small
					// chat-bubble icon overlay on each tile. Tap
					// drops out of the image grid, lands the user in
					// the chat narrowed to the picture's day. Lets
					// the user browse "what was being said when this
					// photo was sent" without losing the photo's
					// place in the gallery.
					onGoToDay={(item) => this._goToChatOnDayOfItem(item)}
					onLongPress={(item) => console.log('long', item)}
					renderThumb={({item, index, size}) => (
					  <View style={{flex:1}}>
						<Image source={{uri:item.uri}} style={{width:size, height:size, borderRadius:6}} />
					  </View>
					)}
				      />
				    </View>
				  </View>
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
                  {/* Date-period bar above the video grid — same
                      wrap pattern as the image grid above. The
                      pre-existing flex:1 wrapper already gave the
                      grid its own scrolling area, so inserting the
                      bar here just sits at the top of that column
                      without further plumbing. */}
                  {this.renderDatePeriodBar()}
                  <View style={{flex: 1}}>
                  <ThumbnailGrid
                    images={videos}
                    isLandscape={this.props.isLandscape}
                    numColumns={(this.props.isTablet || this.props.isLandscape) ? 3 : 2}
                    showTimestamp={true}
                    showSize={true}
                    // History gallery: auto-download tiles as they scroll into
                    // view. ignoreAge bypasses the 10-day recency cutoff (old
                    // media included); the network-preference, mobile and size
                    // limits still apply, so large videos over the mobile cap
                    // stay tap-to-download.
                    onAutoDownload={(item) => {
                      if (item && item.metadata && this.props.autoDownloadFile) {
                        this.props.autoDownloadFile(item.metadata, {ignoreAge: true});
                      }
                    }}
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
                    // "Go to chat on this day" — same affordance the
                    // image grid wires up at line ~9624. Each tile
                    // renders a small chat-bubble icon overlay; tap
                    // drops out of the video grid into the chat
                    // narrowed to that video's day. _goToChatOnDayOfItem
                    // is content-agnostic — it reads item.createdAt /
                    // item.timestamp, derives the day tag via
                    // utils.getMessageDateTags, and re-fetches with
                    // dateYear/Month/Day set — so the image-grid
                    // handler works as-is for video tiles.
                    onGoToDay={(item) => this._goToChatOnDayOfItem(item)}
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
                key={(this.props.isLandscape ? 'l' : 'p')
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
                {/* Date-period filter bar — D/W/M/Y chips + inline
                    horizontal scroller of available tags. Renders
                    above the chat (above the KeyboardWrapper that
                    holds the message list) only while a media-type
                    filter is active. See renderDatePeriodBar for
                    the gating + visual treatment; tapPath:
                    Year/Month/Day pill taps → selectDateYear /
                    selectDateMonth / selectDateDay → CDU pipeline
                    narrows filteredMessages. */}
                {this.renderDatePeriodBar()}
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
					  key={(this.props.isLandscape ? 'l' : 'p')
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
				    // Pull-up-to-refresh at the bottom of the (inverted)
				    // chat: the RefreshControl sits at the newest-message
				    // end, so pulling up past the last message fires
				    // onRefresh → force a server history fetch. Reliable
				    // on Android, where stretch over-scroll reports no
				    // negative scroll offset.
				    refreshing: this.state.serverHistoryRefreshing,
				    onRefresh: this._onChatPullRefresh,
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
                          return this.renderMessageRow(
                              <Message {...props} />,
                              props.currentMessage
                          );
                      }
                      const previewRowStyle = { marginLeft: 0, marginRight: 0 };
                      return this.renderMessageRow(
                          (
                              <Message
                                  {...props}
                                  renderAvatar={null}
                                  containerStyle={{
                                      left: previewRowStyle,
                                      right: previewRowStyle
                                  }}
                              />
                          ),
                          props.currentMessage
                      );
                  }}
                  renderBubble={this.renderBubbleWithMessages}
                  renderMessageText={this.renderMessageText}
				  renderMessageImage={(props) =>
					this.renderMessageImage({ ...props, orderBy: this.props.orderBy })
				  }
				  renderMessageVideo={(props) =>
					this.renderMessageVideo({ ...props, orderBy: this.props.orderBy })
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
                    if (this.props.orderBy === 'size') return null;
                    // Collapsed image-group leader: a single bubble
                    // stands in for a batch of photos sent together.
                    // Its ticks must reflect the LAST member of the
                    // group (the least-progressed of the batch — the
                    // photos are sent in order, so the final one is
                    // the laggard), NOT the leader's own delivery
                    // flags. Otherwise the bubble can show ✓✓
                    // "displayed" while the trailing photos in the
                    // same group are still only ✓ "sent". Look the
                    // last member up in renderMessages and read its
                    // flags for the tick computation below.
                    let _tickMsg = currentMessage;
                    if (currentMessage && currentMessage._groupTickSig !== undefined) {
                        // Leader copy from the visibleMessages map already
                        // carries the inherited (last-member) flags — and the
                        // memo comparator watches _groupTickSig so this bubble
                        // re-renders when they change. Use them directly.
                        _tickMsg = {
                            sent: currentMessage._groupSent,
                            received: currentMessage._groupReceived,
                            pending: currentMessage._groupPending,
                        };
                    } else if (currentMessage && currentMessage._id in this.state.imageGroups) {
                        // Fallback (e.g. search-results GiftedChat, which does
                        // not pass through the visibleMessages map): look the
                        // last member up live in renderMessages.
                        const _gids = this.state.imageGroups[currentMessage._id] || [];
                        if (_gids.length) {
                            const _lastId = _gids[_gids.length - 1];
                            const _all = this.state.renderMessages || [];
                            const _lastMsg = _all.find(x => x && x._id === _lastId);
                            if (_lastMsg) _tickMsg = _lastMsg;
                        }
                    }
                    // Otherwise replicate the default GiftedChat
                    // tick rendering — ✓ for sent, ✓✓ for
                    // received, 🕓 while pending. Done inline because
                    // returning `undefined` from a renderTicks
                    // function suppresses the default; we only get
                    // the default when the prop itself is undefined,
                    // and we can't conditionally undef a JSX prop.
                    const _ticks = [];
                    if (_tickMsg && _tickMsg.sent) {
                        _ticks.push(
                            <Text key="t-sent" style={{fontSize: 10, color: 'green'}}>✓</Text>
                        );
                    }
                    if (_tickMsg && _tickMsg.received) {
                        _ticks.push(
                            <Text key="t-recv" style={{fontSize: 10, color: 'green'}}>✓</Text>
                        );
                    }
                    if (_tickMsg && _tickMsg.pending) {
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
                {/* Date-period filter bar — same purpose as in the
                    main chat branch above. The readonly chat is the
                    fallback render path when showChat returns false
                    but a single contact item is selected (e.g. some
                    filter states route here), so the bar lives in
                    both branches to be safe. */}
                {this.renderDatePeriodBar()}
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
                  loadEarlier={!this.props.totalMessageExceeded && this.state.selectedContact !== null}
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
			      /* iOS-only — without this, RN's Modal defaults to
			         supportedOrientations: ['portrait'], which forces the
			         underlying app to portrait while the modal is presented.
			         Include both landscape variants so the modal inherits
			         whichever orientation the user is in. */
			      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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
			  /* iOS-only — without this, RN's Modal defaults to
			     supportedOrientations: ['portrait'], which forces the
			     underlying app to portrait while the modal is presented.
			     Include both landscape variants so the modal inherits
			     whichever orientation the user is in. */
			  supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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
			
			{this.state.expandedImage && (() => {
			  // Build the imageUrls entry with width/height baked in so
			  // react-native-image-zoom-viewer doesn't fall back to its
			  // own Image.getSize call. See onImagePress for the iOS 26
			  // black-screen rationale.
			  const _rawImageUri = this.state.expandedImage.image;
			  const _viewerUri = (Platform.OS === 'ios' && _rawImageUri && _rawImageUri.startsWith('/'))
				? 'file://' + _rawImageUri
				: _rawImageUri;
			  const _win = Dimensions.get('window');
			  const _dims = this.state.expandedImageSize || {width: _win.width, height: _win.height};
			  return (
			  <Modal
				visible={true}
				transparent={true}
				onRequestClose={() => this.onImagePress(null)}
				/* iOS-only — without this, RN's Modal defaults to
				   supportedOrientations: ['portrait'], which forces the
				   underlying app to portrait while the modal is presented.
				   Include both landscape variants so the modal inherits
				   whichever orientation the user is in. */
				supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
			  >
				<ImageViewer
				  imageUrls={[{ url: _viewerUri, width: _dims.width, height: _dims.height }]}
				  enableSwipeDown
				  onSwipeDown={() => this.onImagePress(null)}
				  onClick={() => this.onImagePress(null)}
				  backgroundColor="black"
				  renderIndicator={() => null}
				  saveToLocalByLongPress={false}
				  renderImage={(props) => {
					// If we already know the file is gone (Image.getSize
					// failed in onImagePress, or a previous render's
					// <Image> reported onError), short-circuit to the
					// placeholder so the user doesn't stare at black.
					if (this.state.expandedImageMissing) {
					  const _msg = this.state.expandedImage;
					  // Offer "Download from server" when we have a
					  // server URL on the message AND a downloadFile
					  // pipeline wired in via props. Outgoing messages
					  // that were never uploaded won't have metadata.url;
					  // we skip the button in that case rather than
					  // present a dead control.
					  const _canDl = _msg
						&& _msg.metadata
						&& _msg.metadata.url
						&& typeof this.props.downloadFile === 'function';
					  const _isDownloading = this.state.expandedImageDownloading;
					  return (
						<View style={{
						  width: _win.width,
						  height: _win.height,
						  alignItems: 'center',
						  justifyContent: 'center',
						  padding: 24,
						}}>
						  <Icon name="image-broken-variant" size={64} color="#888" />
						  <Text style={{color: '#bbb', marginTop: 12, fontSize: 16, textAlign: 'center'}}>
							File not available
						  </Text>
						  <Text style={{color: '#777', marginTop: 6, fontSize: 12, textAlign: 'center'}}>
							The image file is missing or could not be opened.
						  </Text>
						  {_canDl && (
							<TouchableOpacity
							  disabled={_isDownloading}
							  onPress={() => {
								console.log('[image-viewer] manual download',
								  'msgId=', _msg._id,
								  'transferId=', (_msg.metadata && _msg.metadata.transfer_id) || '(none)',
								  'url=', _msg.metadata.url);
								this.setState({expandedImageDownloading: true});
								try { this.props.downloadFile(_msg.metadata, true); }
								catch (e) { console.log('downloadFile threw', e && e.message); }
							  }}
							  style={{
								marginTop: 20,
								flexDirection: 'row',
								alignItems: 'center',
								backgroundColor: _isDownloading ? '#555' : '#2196F3',
								paddingHorizontal: 18,
								paddingVertical: 10,
								borderRadius: 22,
							  }}
							>
							  {_isDownloading
								? <ActivityIndicator size="small" color="#fff" />
								: <Icon name="cloud-download" size={20} color="#fff" />}
							  <Text style={{color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 8}}>
								{_isDownloading ? 'Downloading…' : 'Download from server'}
							  </Text>
							</TouchableOpacity>
						  )}
						</View>
					  );
					}
					return (
					<View
					  style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
					  }}
					>
					  <Image
						{...props}
						// contain (not the RN default 'cover') so the whole
						// image is shown letterboxed inside its box rather
						// than centre-cropped. Without this, when the viewer
						// box ends up screen-shaped — which happens whenever
						// Image.getSize times out / fails on iOS 26 and we
						// fall back to screen dimensions (see onImagePress) —
						// the real image is cover-cropped to fill the screen
						// and, at base scale, can't be panned to its edges.
						// Mirrors the same fix already in ThumbnailGrid.
						resizeMode="contain"
						onError={(e) => {
						  const _msg = this.state.expandedImage;
						  console.log('[image-viewer] missing file (Image onError)',
							'msgId=', _msg && _msg._id,
							'transferId=', (_msg && _msg.metadata && _msg.metadata.transfer_id) || '(none)',
							'uri=', _msg && _msg.image,
							'err=', e && e.nativeEvent && e.nativeEvent.error);
						  this.setState({expandedImageMissing: true});
						}}
						style={[
						  props.style,
						  { transform: [{ rotate: `${this.state.rotation}deg` }] },
						]}
					  />
					</View>
					);
				  }}
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
			  );
			})()}

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
			{this.state.fullScreenHtml && (() => {
    const _m = this.state.fullScreenHtml;
    const _close = () => {
        if (typeof this.props.setFullScreen === 'function') this.props.setFullScreen(false);
        this.setState({fullScreenHtml: null});
    };
    const _doc = '<!DOCTYPE html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<style>body{margin:0;padding:12px;font:16px -apple-system,system-ui,sans-serif;color:#111;-webkit-text-size-adjust:100%;word-wrap:break-word}'
        + 'table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px;vertical-align:top}'
        + 'img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body>'
        + utils.cleanHtml(_m.html || '')
        + '</body></html>';
    return (
        <Modal visible transparent={false} animationType="slide" onRequestClose={_close}>
            <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 8, backgroundColor: '#fff' }}>
                    <TouchableOpacity onPress={_close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                        <Icon name="close" size={28} color="#333" />
                    </TouchableOpacity>
                </View>
                <WebView
                    originWhitelist={['*']}
                    source={{ html: _doc }}
                    style={{ flex: 1 }}
                    scalesPageToFit={false}
                    showsHorizontalScrollIndicator={true}
                />
            </SafeAreaView>
        </Modal>
    );
})()}

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
				const _rawTrail = (this.props.messagesMetadata
					&& this.props.messagesMetadata[_msg._id]) || [];
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

				// Prefer the trail CAPTURED at the moment the user tapped
				// "Full screen" (fullScreenLocationTrail) over what we can
				// re-derive from messagesMetadata right now: an async
				// category/secondary-query reload can transiently trim
				// messagesMetadata[msgId] down to the single origin tick,
				// which is exactly what made the fullscreen map drop from 41
				// points to 1 while the inline bubble still showed all 41.
				// Use whichever is longer so a later backfill (live share
				// growing the trail) still wins when it overtakes the capture.
				const _capturedTrail = Array.isArray(this.state.fullScreenLocationTrail)
					? this.state.fullScreenLocationTrail
					: [];
				const _effTrail = (_capturedTrail.length > _trail.length)
					? _capturedTrail
					: _trail;

				// ---- Diagnostic: location-track availability on full-screen open.
				// "After loading the journal not all location tracks load" — the
				// suspected cause is that some of the share's tick rows
				// (application/sylk-message-metadata) are still queued for PGP
				// decryption when the journal finishes loading, so they haven't
				// landed in messagesMetadata[msgId] yet. A still-encrypted tick
				// never reaches this array (it's parsed only AFTER decrypt), so
				// the only way to see the gap from here is to count what's
				// present vs. what's readable, and flag any entry that DID make
				// it into the array but can't be projected (no value / bad
				// coords / un-parsed blob = legacy or not-yet-decrypted data).
				// Logged once per open so metro.log shows, at the moment the user
				// opens the track, whether the whole path is available.
				try {
					let _locationTicks = 0;
					let _droppedNoValue = 0;
					let _droppedBadCoords = 0;
					let _looksEncrypted = 0;
					for (const e of _rawTrail) {
						if (!e || e.action !== 'location') continue;
						_locationTicks++;
						const v = e.value;
						const _encFlag = (e.encrypted === 1 || e.encrypted === true
							|| (typeof v === 'string' && v.indexOf('-----BEGIN PGP MESSAGE-----') > -1));
						if (!v) {
							_droppedNoValue++;
							if (_encFlag || typeof e.value === 'string') _looksEncrypted++;
							continue;
						}
						if (typeof v.latitude !== 'number' || typeof v.longitude !== 'number') {
							_droppedBadCoords++;
							if (_encFlag || typeof v === 'string') _looksEncrypted++;
						}
					}
					const _allAvailable = (_droppedNoValue === 0 && _droppedBadCoords === 0);
					const _f = _effTrail[0];
					const _l = _effTrail[_effTrail.length - 1];
					utils.timestampedLog(
						'[location] [fullscreen] open track',
						'bubble=' + _msg._id,
						'rawEntries=' + _rawTrail.length,
						'locationTicks=' + _locationTicks,
						'derivedPoints=' + _trail.length,
						'capturedPoints=' + _capturedTrail.length,
						'usingPoints=' + _effTrail.length,
						'validPoints=' + _effTrail.length,
						'droppedNoValue=' + _droppedNoValue,
						'droppedBadCoords=' + _droppedBadCoords,
						'looksStillEncrypted=' + _looksEncrypted,
						'allMessagesAvailable=' + _allAvailable,
						'first=' + (_f
							? _f.latitude.toFixed(5) + ',' + _f.longitude.toFixed(5)
								+ '@' + new Date(_f.timestamp).toISOString()
							: 'none'),
						'last=' + (_l
							? _l.latitude.toFixed(5) + ',' + _l.longitude.toFixed(5)
								+ '@' + new Date(_l.timestamp).toISOString()
							: 'none'));
				} catch (_logErr) {
					console.log('[location] [fullscreen] trail-availability log failed', _logErr);
				}

				const _exit = () => {
					if (typeof this.props.setFullScreen === 'function') {
						this.props.setFullScreen(false);
					}
					this.setState({fullScreenLocation: null, fullScreenLocationTrail: null});
				};
				return (
					<Modal
						visible={true}
						transparent={false}
						animationType="fade"
						onRequestClose={_exit}
						/* iOS-only — without this, RN's Modal defaults to
						   supportedOrientations: ['portrait'], which forces the
						   underlying app to portrait while the modal is presented.
						   Include both landscape variants so the modal inherits
						   whichever orientation the user is in. */
						supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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
								trail={_effTrail}
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

            <MessageContextMenu
                visible={!!this.state.messageMenu}
                message={this.state.messageMenu && this.state.messageMenu.message}
                options={(this.state.messageMenu && this.state.messageMenu.options) || []}
                icons={(this.state.messageMenu && this.state.messageMenu.icons) || []}
                reactable={!!(this.state.messageMenu && this.state.messageMenu.reactable)}
                previewImage={this.state.messageMenu && this.state.messageMenu.previewImage}
                failed={!!(this.state.messageMenu && this.state.messageMenu.failed)}
                reactions={this.state.recentReactions}
                isDark={DarkModeManager.getTheme().isDark}
                onSelect={this.onMessageMenuSelect}
                onDismiss={this.closeMessageMenu}
                onReact={(emoji) => {
                    const target = this.state.messageMenu && this.state.messageMenu.message;
                    this.closeMessageMenu();
                    if (target) {
                        this.quickReact(target, emoji);
                    }
                }}
                onPickerOpen={() => {
                    const target = this.state.messageMenu && this.state.messageMenu.message;
                    this.closeMessageMenu();
                    if (target) {
                        this.openReactionPicker(target);
                    }
                }}
            />

            {/* Custom confirmation dialog for the Deleted ("Proceed")
                and Graveyard ("Eject") contact actions. Buttons are
                stacked vertically so the panel never overflows the
                right margin in portrait (the old native three-button
                Alert.alert did). */}
            <ConfirmActionModal
                visible={!!this.state.confirmDialog}
                title={this.state.confirmDialog ? this.state.confirmDialog.title : ''}
                message={this.state.confirmDialog ? this.state.confirmDialog.message : ''}
                actions={this.state.confirmDialog ? this.state.confirmDialog.actions : []}
                onDismiss={this.closeConfirmDialog}
            />

            </SafeAreaView>
        );
    }
}

ChatBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
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
    myDisplayName   : PropTypes.string,
    myInvitedParties: PropTypes.object,
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
    inviteContacts  : PropTypes.bool,
    shareToContacts   : PropTypes.bool,
    selectedContacts: PropTypes.array,
    toggleBlocked   : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    messageZoomFactor: PropTypes.string,
    fontScale       : PropTypes.number,
    call            : PropTypes.object,
    keys            : PropTypes.object,
    downloadFile    : PropTypes.func,
    uploadFile : PropTypes.func,
    decryptFunc     : PropTypes.func,
    forwardMessagesFunc: PropTypes.func,
    messagesCategoryFilter: PropTypes.string,
    sourceContact: PropTypes.object,
    requestCameraPermission: PropTypes.func,
    file2GiftedChat: PropTypes.func,
    postSystemNotification: PropTypes.func,
    orderBy: PropTypes.string,
    sortOrder: PropTypes.string,
    searchMessages: PropTypes.bool,
    searchString: PropTypes.string,
    recordAudio: PropTypes.func,
    canRecordAudio: PropTypes.bool,
    dark: PropTypes.bool,
    messagesMetadata: PropTypes.object,
    contactStartShare: PropTypes.func,
    contactStopShare: PropTypes.func,
    setFullScreen: PropTypes.func,
    fullScreen: PropTypes.bool,
    transferProgress: PropTypes.object,
    gettingSharedAsset: PropTypes.bool,
	startAudioPlayerFunc: PropTypes.func,
	stopAudioPlayerFunc: PropTypes.func,
	markAudioMessageDisplayedFunc: PropTypes.func,
	playRecording: PropTypes.bool,
	updateFileTransferMetadata: PropTypes.func,
	isAudioRecording: PropTypes.bool,
	audioArmed: PropTypes.bool,
	recordingFile: PropTypes.string,
	sendAudioFile: PropTypes.func,
	insets: PropTypes.object,
	appState: PropTypes.string
};


export default ChatBox;
