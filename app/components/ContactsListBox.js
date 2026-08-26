import React, { Component} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { Dimensions, SafeAreaView, FlatList, BackHandler } from 'react-native';
import ContactCard from './ContactCard';
import ChatBox from './ChatBox';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';


// with adjustResize on Android and used to cover the input bar).
// Custom in-app confirmation dialog. Replaces three-button native
// Alert.alert prompts (Cancel/Restore/Proceed, Cancel/Revive/Eject)
// which lay their buttons out horizontally and overflow the right
// margin in portrait. This one stacks the buttons vertically.
import ConfirmActionModal from './ConfirmActionModal';

import momenttz from 'moment-timezone';

import styles from '../assets/styles/ContactsListBox';



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




  // Helper to format bytes


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
            // Year/Month/Day drill-down filter. Three stacked rows
            //   • Year (always visible while the bar is up)
            //   • Month (appears once a year is picked)
            //   • Day   (appears once a month is picked)
            // Each row narrows the chat further. The narrowest
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
            chat: this.props.chat,
            pinned: false,
            message: null,
            inviteContacts: this.props.inviteContacts,
            shareToContacts: this.props.shareToContacts,
            selectMode: this.props.shareToContacts || this.props.inviteContacts || this.props.contactSelectMode,
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
            // All other bubbles dim to opacity 0.35 (see
            //   shape: <currentMessage> | null
            reactionTarget: null,
            // common-first; the bar is a horizontal ScrollView so the
            // tail of the list scrolls off-screen and is reachable by
            // a swipe — the "+" button on the right still opens the
            // later become an LRU persisted to prefs; static for v1.
            recentReactions: [
                '❤️','👍','😂','😮','😢','🙏',
                '🔥','👏','😍','😎','🤔','😴',
                '🥳','🤯','💯','✅','❌','🙌',
                '🤝','👀','😅','🤣','💪','🎉',
            ],
            emojiPickerVisible: false,
            // action row + secondary bottom sheet) renders for this
            // message. Shape:
            //   { message, options, icons, callback, reactable } | null
            // `options`/`icons`/`callback` are exactly what we used to
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
            dark: this.props.dark,
			messagesMetadata: this.props.messagesMetadata,
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
		    // walk smoothed) — swap to real per-100ms peaks pulled from
		    // message.metadata.peaks once that pipeline lands.
		    audioBubbleVu: { local: 0, remote: 0 },
		    // While the user is dragging the slider on a call-recording
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
		    graveyardContacts: this.props.graveyardContacts || [],
		    // Which contact source the search/list filters against.
		    // 'sylk' = the Sylk contacts in this.state.allContacts,
		    // 'ab'   = the address-book entries in this.state.contacts.
		    // The toggle in the search bar (URIInput) drives this prop.
		    contactSource: this.props.contactSource || 'sylk',
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
            serverHistoryRefreshing: false,
            actionSheetDisplayed: false,
            // the close button or via Android back. Lifted onto the
            // parent app's setFullScreen() so the surrounding navbar /
            // status chrome also collapses, matching the image viewer.
            fullScreenLocation: null,
            // Trail captured at the moment "Full screen" is tapped, so the
            // async reload while the modal is open.
            fullScreenLocationTrail: null,
            fullScreenHtml: null,
            // iOS-only audio player state. AVAudioPlayer (used by
            // react-native-audio-recorder-player on iOS) silently fails to
            // decode some MP3 variants — VBR Sony hardware-recorder output
            // in particular accepts the prepare/play step but never emits a
            // frame. AVPlayer (via react-native-video in audioOnly mode)
            // and drive playback through a hidden <Video> component fed by
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
        // Chat-only listeners (keyboard overlap, stop-audio-on-call) moved
        // to ChatBox along with the messaging surface. The contacts list
        // doesn't need them.
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
    }

  
    backPressed() {
        // are handled inside ChatBox now. The contacts list has no overlay
        // to intercept, so let the default back behaviour proceed.
        return false;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        // [audio-debug] CWRP props.messages-changed log — DISABLED.
        // Re-enable to confirm whether App.setState({messages}) is
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
               // conversation has messages — independent of the
               // windowed slice that getMessages loads into
               // happens when the SQL resolves.
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

		  if (uri in nextProps.messages) {
			const oldMessages = this.state.renderMessages || [];

		    let newMessages = [...nextProps.messages[uri]] || [];
			// Sort newest → oldest. Coerce createdAt to a numeric ms
			// value before comparing — the incoming-websocket path used
			// to hand us createdAt as an ISO string while the outgoing
			// path uses a Date. Comparing Date < string under JS numeric
			// rules yields false on both sides, the comparator returns
			// reply silently lands above the user's just-sent message.
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
			  "position",
			  // Flipped true when the server-history sync enriches a
			  // call system message with trace params. Watching it here
			  // makes the metadata-only change propagate into
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
				// If we treated `text` as a change here, every prop
				// update that re-emits messages[uri] would revert the
				// visibly flicker between "Locating…" and the real
				const isLocBubble = a
					&& a.contentType === 'application/sylk-location-sharing';
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
			  // locationData getter. Without this preservation the next
			  // prop update (e.g. a contact-timestamp bump or SQL save)
			  const merged = newMessages.map((m, i) => {
				// FROZEN MEET SUMMARY: when a meet ends, the bubble's metadata
				// flips to the summary (meetOutcome + each party's START coords).
				// Adopt the NEW bubble on that transition — overriding BOTH the
				// "unchanged → keep old" shortcut and the live-location metadata
				// preservation below, which would otherwise keep the stale live
				// (final-coords) metadata and show the final points on success.
				if (m && m.contentType === 'application/sylk-location-sharing'
						&& m.metadata && m.metadata.meetOutcome) {
				  const _oldF = idsEqual ? oldMessages[i] : oldMessages.find(o => o && o._id === m._id);
				  const _oldOutcome = _oldF && _oldF.metadata && _oldF.metadata.meetOutcome;
				  if (m.metadata.meetOutcome !== _oldOutcome) {
					return m;
				  }
				}
				if (idsEqual && !changedIds.includes(m._id)) {
				  return oldMessages[i];
				}
				if (m && m.contentType === 'application/sylk-location-sharing') {
				  const old = idsEqual
					? oldMessages[i]
					: oldMessages.find(o => o && o._id === m._id);
				  if (old
					  && old.contentType === 'application/sylk-location-sharing') {
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
                && this.state.searchMessages
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
					return;
				}
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
				console.log('[messagesLoading] true — fetching category:', nextProps.messagesCategoryFilter);
				// Hard timeout fallback. Two cases the CDU-based
				// non-empty) misses:
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
				this.props.getMessages(nextProps.selectedContact.uri, {category: nextProps.messagesCategoryFilter, pinned: this.state.pinned});
			}
        }

        if (nextProps.pinned !== this.state.pinned && nextProps.selectedContact) {
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
                       selectMode: nextProps.shareToContacts || nextProps.inviteContacts || nextProps.contactSelectMode,
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
					   graveyardContacts: nextProps.graveyardContacts || [],
					   contactSource: nextProps.contactSource || 'sylk'
					});

        if (nextProps.isTyping) {
            setTimeout(() => {
                this.setState({isTyping: false});
            }, 3000);
        }
    }



  





    // Generate a poster thumbnail for a video uri, mirroring the platform
    // createThumbnail on iOS). Returns a path or null on failure.




    //
    // (instance, not state — no need to trigger a re-render just to




    resetContact() {
        this.setState({
            texting: false,
            sharingAssets: [],
            sharingMessages: [],
            placeholder: this.default_placeholder
        });
    }




	// react-native-gesture-handler's <Swipeable>, it renders no action
	// panes and animates nothing until a row is actually being dragged, so
	// for system messages.

	

	// Custom Input Toolbar











	

	// driven by react-native-video's onLoad / onProgress / onEnd /
	// onError on a hidden <Video audioOnly>. They share the same
	// state surface (audioRecordingStatus, currentAudioMessage,
	// UI is platform-agnostic.





    setTargetUri(uri, contact) {
        //console.log('Set target uri uri in history list', uri);
        // In the Deleted folder / Graveyard a tap must NOT open the chat —
        // it offers the lifecycle actions instead.
        if (this.state.filter === 'deleted') {
            this.showDeletedContactOptions(contact);
            return;
        }
        if (this.state.filter === 'graveyard') {
            this.showGraveyardContactOptions(contact);
            return;
        }
        this.props.setTargetUri(uri, contact);
    }

    // Deleted folder: Restore (revive) or Proceed (kill on XCAP → Graveyard).
    // The "all messages will be deleted" warning only shows when the contact
    // still has stored (hidden) messages — i.e. it was locally deleted. If it
    // was remotely purged (messages already gone) we just show the buttons.
    async showDeletedContactOptions(contact) {
        if (!contact) return;
        const name = (contact.name && contact.name.trim()) || contact.uri;
        let hasMsgs = false;
        if (typeof this.props.contactHasStoredMessages === 'function') {
            try { hasMsgs = await this.props.contactHasStoredMessages(contact.uri); } catch (e) {}
        }
        const body = hasMsgs
            ? name + '\n\nProceeding permanently deletes this contact and ALL its messages, and removes it from the server.'
            : name;
        // Custom dialog (vertically stacked buttons) instead of a native
        // three-button Alert.alert — the latter overflows the right
        // margin in portrait.
        this.setState({
            confirmDialog: {
                title: 'Delete contact?',
                message: body,
                actions: [
                    { label: 'Restore', onPress: () => { this.closeConfirmDialog(); if (this.props.reviveContact) this.props.reviveContact(contact); } },
                    { label: 'Block', onPress: () => { this.closeConfirmDialog(); if (this.props.blockDeletedContact) this.props.blockDeletedContact(contact); } },
                    { label: 'Send to graveyard', destructive: true, onPress: () => { this.closeConfirmDialog(); if (this.props.hardDeleteContacts) this.props.hardDeleteContacts([contact.uri]); } },
                    { label: 'Cancel', cancel: true, onPress: () => this.closeConfirmDialog() },
                ],
            },
        });
    }

    closeConfirmDialog() {
        this.setState({ confirmDialog: null });
    }

    // Graveyard (tombstones): Revive (bring back) or Eject (the ultimate step —
    // physically delete the contact row from SQL, irreversible).
    showGraveyardContactOptions(contact) {
        if (!contact) return;
        const name = (contact.name && contact.name.trim()) || contact.uri;
        // Custom dialog (vertically stacked buttons) instead of a native
        // three-button Alert.alert — the latter overflows the right
        // margin in portrait (Cancel / Revive / Eject don't fit on one
        // row, so "Eject" gets clipped off the right edge).
        this.setState({
            confirmDialog: {
                title: 'Graveyard contact',
                message: name + '\n\nEject permanently removes the contact record from this device. This cannot be undone.',
                actions: [
                    { label: 'Revive', onPress: () => { this.closeConfirmDialog(); if (this.props.reviveContact) this.props.reviveContact(contact); } },
                    { label: 'Eject', destructive: true, onPress: () => { this.closeConfirmDialog(); if (this.props.ejectContact) this.props.ejectContact(contact); } },
                    { label: 'Cancel', cancel: true, onPress: () => this.closeConfirmDialog() },
                ],
            },
        });
    }



    renderContactItem(object) {
        let item = object.item || object;

        return(
            <ContactCard
            darkMode={this.state.dark}
            contact={item}
            selectedContact={this.state.selectedContact}
            setTargetUri={this.setTargetUri}
            searchMode={!this.state.searchMessages
                && !!this.state.targetUri
                && this.state.targetUri.length > 0}
            forceUriSubtitle={this.state.filter === 'deleted'
                || this.state.filter === 'graveyard'}
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
            onLongPress={() => { if (this.props.onLongPressContact) this.props.onLongPressContact(item); }}
            accountId = {this.state.accountId}
            activeLocationShares={this.props.activeLocationShares}
            incomingLocationShareUris={this.props.incomingLocationShareUris}
            />);
    }





    



    searchedContact(uri, contact=null) {
        if (uri.indexOf(' ') > -1) {
            return [];
        }

        // The synthetic "exact match" row must carry the full SIP URI the
        // search term resolves to (username@defaultDomain when the user
        // typed a bare username), matching how it will actually be
        // dialled/messaged. normalizeUri keeps an explicitly-typed domain
        // (e.g. alice@other.com) untouched and only appends the default
        // domain when none was given.
        const fullUri = utils.normalizeUri(uri.toLowerCase(), this.props.defaultDomain);

        const item = this.props.newContactFunc(fullUri, null, {src: 'search_contact'});

        if (!item) {
            return [];
        }

        if (contact) {
            item.name = contact.name;
            item.photo = contact.photo;
        }
        // Mark the synthetic top row as a NEW (not-yet-saved) address when the
        // typed URI matches no existing saved contact, so the card badges it
        // "New" (vs the OS/phone-book badge for address-book entries).
        const _u = (fullUri || '').toLowerCase();
        const _found = (this.state.allContacts || []).some(c => c
            && ((c.uri && c.uri.toLowerCase() === _u)
                || (Array.isArray(c.uris) && c.uris.some(x => (x || '').toLowerCase() === _u))));
        item.searchNew = !_found;
        item.src = 'search_contact';
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

                    // Idempotent: only convert while still a string. Re-running
                    // momenttz.tz() on an already-converted Date stringifies it to
                    // a non-ISO value and triggers moment's deprecation warning.
                    if (elem.timezone !== undefined && typeof elem.startTime === 'string') {
                        localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                        elem.startTime = localTime;
                        elem.timestamp = localTime;
                        if (typeof elem.stopTime === 'string') {
                            elem.stopTime = momenttz.tz(elem.stopTime, elem.timezone).toDate();
                        }
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

        // Phone-number match: ignore the leading '+' and any '@domain' so a
        // query like "3491" finds "+34918034800". Only kicks in when the query
        // is digit-ish (digits, optional leading +).
        const f = (filter || '').trim();
        if (f && /^\+?\d+$/.test(f)) {
            const qDigits = f.replace(/\D/g, '');
            const uriDigits = (contact.uri || '').split('@')[0].replace(/\D/g, '');
            if (qDigits && uriDigits.startsWith(qDigits)) {
                return true;
            }

            // "Replace 0 with" expansion. When the query starts with a
            // SINGLE leading 0 (a nationally-formatted number, e.g.
            // "023") and the Preferences → Phone numbers "Replace 0
            // with" rule is set, treat that value as the country code
            // and ALSO match the international forms of the same
            // number. The stored preference may be either "31" or
            // "0031" — normalize to the bare country code first.
            // Example: pref 31 (or 0031), query "023" additionally
            // matches contacts starting with "+3123…", "003123…" and
            // "3123…" (uriDigits strips '+', so the cc+rest comparison
            // covers both the +… and bare-cc storage forms; the
            // 00cc+rest comparison covers the 00-prefixed form).
            if (qDigits.length > 1 && qDigits[0] === '0' && qDigits[1] !== '0') {
                const _rules = this.props.pstnRules;
                const _pref = (_rules && typeof _rules.replaceLeadingZero === 'string')
                    ? _rules.replaceLeadingZero
                    : '';
                const cc = _pref.replace(/\D/g, '').replace(/^0+/, '');
                if (cc) {
                    const rest = qDigits.substring(1);
                    if (uriDigits.startsWith(cc + rest)
                        || uriDigits.startsWith('00' + cc + rest)) {
                        return true;
                    }
                }
            }

            // Reverse direction: the query is internationally formatted
            // (+3123… / 003123… / 3123…) and the contact is stored
            // nationally (023…). Strip the query down to cc-less
            // national form and try the 0-prefixed match.
            if (qDigits.length > 1) {
                const _rules2 = this.props.pstnRules;
                const _pref2 = (_rules2 && typeof _rules2.replaceLeadingZero === 'string')
                    ? _rules2.replaceLeadingZero
                    : '';
                const cc2 = _pref2.replace(/\D/g, '').replace(/^0+/, '');
                if (cc2) {
                    let nationalRest = null;
                    if (qDigits.startsWith('00' + cc2)) {
                        nationalRest = qDigits.substring(2 + cc2.length);
                    } else if (qDigits.startsWith(cc2)) {
                        nationalRest = qDigits.substring(cc2.length);
                    }
                    if (nationalRest && uriDigits.startsWith('0' + nationalRest)) {
                        return true;
                    }
                }
            }
        }

        if (!this.state.selectedContact && contact.conference && contact.metadata && filter.length > 2 && contact.metadata.indexOf(filter) > -1) {
            return true;
        }

        return false;
    }



    // Input-toolbar replacement used when the active account has no local
    // this read-only banner pointing users to the menu path where they can
    // restore or generate one. Styled in the same warning red as the
    // ReadyBox banner so the two read as one signal.

    // "Open" action, and the explicit pressFileBubble fallback below. Any
    // file_transfer whose filename matches one of these patterns is a
    // support log capture and should reopen in LogsModal, not FileViewer.



    


    // Decide whether the redesigned context menu should show the
    // reaction strip for this message, then stash everything the
    // not a live-location stream) so the strip only appears where a
    // reaction can actually be sent.

    // Tear down the overlay. Routes through here from every dismissal
    // is always cleared in lockstep with the menu.

    // An action button was tapped. Run the original callback with the
    // (callback then auto-dismiss).











	


	// the other getters (which return a single value per message), this one
	// needs `value`, `expires`, `timestamp` and `author` together.

	// Build the ordered, coord-valid GPS trail for a location share from
	// fullscreen modal use — extracted so the fullscreen-open handlers can
	// CAPTURE the trail at the moment the user taps "Full screen". The
	// fullscreen modal then renders the captured trail instead of
	// transiently trimmed by the async category/secondary-query reload
	// fullscreen view dropped to 1).



	// → Send. We:
	//      handles encryption, the metadata send, and the actual message


	// outside-tap on the bar's transparent backdrop and by other
	// code paths that need to drop reaction-mode without sending.







	// Theme-aware chat system message. Same pill treatment as
	// the date separator above — a darker translucent fill in
	// Day mode (so the white text reads against the light linen)
	// and a lighter translucent fill in Night mode (so the same
	// white text floats against the dark linen). Without this
	// system-message text disappeared on the new light Day-mode
	// background.


	




			

// Fetch the contact's full-history date index from SQL via the
// app.js prop callback. Idempotent: each call replaces the
// previous result; no debounce here because the call sites
// (selectedContact change + post-send / post-receive append)
// are already coarse-grained. Swallows errors silently so a
// hiccup in the SQL layer can't take down the chat UI; the
// load returned.

// Compute a unix-seconds range from a year/month/day selection.
// Both ends inclusive in LOCAL time so it lines up with the SQL
// date index (strftime('localtime')) and the in-memory tag
// pipeline (utils.getMessageDateTags uses local).
//   • dayId set    → 00:00:00 → 23:59:59 of that day
//   • monthId set  → 1st 00:00 → last-day 23:59:59 of that month
//   • yearId set   → Jan 1 00:00 → Dec 31 23:59:59 of that year
//   • all null     → empty range (no filter)

// Drive a getMessages refetch with the current category + the
// on both select and deselect. The state setState for the
// takes the post-state-change values so it doesn't have to wait
// for setState to commit.

// Per-tile "go to chat on this day" handler. Triggered by the
// small chat icon overlay on each image/video grid tile. The
// PLUS dropping out of the media-type filter so the user lands
// in the regular chat view, narrowed to that picture's day.
// Useful workflow: browse photo gallery → spot something
// interesting → "what were we talking about that day?"

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






	// Pull-up-to-refresh handler — intentionally a no-op. Swiping up at
	// the bottom of the chat no longer fetches server history.



    // Mirror of showImageGrid for video. The per-contact Video
    // tapping a tile opens the existing full-screen video Modal
    // via openVideoModal.






    
  
  // Bulk Share for the media grids. Resolves each selected msg
  // id to its on-disk decrypted file via metadata.local_url, makes
  // Android-friendly copies in the cache dir (Share targets can't
  // read arbitrary app sandbox paths on Android), and hands the
  // resulting urls list to react-native-share. Same shape as the
  // existing handleShare (single-message / image-group share)
  // uses, just driven off the grid's selection set instead of an
  // image-group leader id.

  


    // DIAGNOSTIC: log the image-grid calendar (year → count) and a per-tile
    // file list with on-disk presence, so we can tell why tiles show Download:
    // file genuinely absent (onDisk=false) vs present-but-no-thumbnail
    // (thumb=false, onDisk=true). Logged once per (contact, image-count).

    render() {
        // Chat is now a standalone component (ChatBox), extracted from this
        // file. When a contact is selected we mount <ChatBox> here; when the
        // parent clears selectedContact (back), ChatBox unmounts and the
        // contacts list below renders again. ChatBox receives the same props
        // this component does, so it initialises its chat state identically to
        // the old inline path. See docs/ChatBox-extraction-plan.md.
        if (this.props.selectedContact) {
            return <ChatBox {...this.props} />;
        }

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
                : (this.state.filter === 'graveyard'
                    ? (this.state.graveyardContacts || []) // permanent tombstones, loaded separately
                    : this.state.allContacts);
        //console.log('----');

        //console.log('--- Render contacts', this.state.isLoadingEarlier);

        // MEMOIZED DERIVATION. The filter/dedup/sort pipeline below is
        // O(all contacts) and does NOT depend on the current selection. Cache
        // it keyed on the inputs that DO affect it, so a selection toggle
        // (which only flips the per-row `selected` flag, re-applied just after
        // this block) doesn't re-run the whole pipeline — that was the ~3s
        // per-checkbox lag on a large contact list in debug builds.
        const _memoKey = [contacts, contactSource, this.state.filter, this.state.targetUri,
            this.state.periodFilter, this.state.shareToContacts, this.state.inviteContacts,
            this.state.sourceContact, this.state.blockedUris, this.state.orderBy,
            this.state.sortOrder, this.state.accountId, this.state.selectedContact];
        const _memoHit = this._itemsMemoKey
            && this._itemsMemoKey.length === _memoKey.length
            && this._itemsMemoKey.every((v, i) => v === _memoKey[i]);
        if (_memoHit) {
            items = this._itemsMemo;
        } else {
        if (!this.state.selectedContact && this.state.filter === 'graveyard') {
            // Graveyard: permanently-deleted tombstones (deleted=1), loaded
            // separately into graveyardContacts. Everything in the source list
            // is a tombstone, so just match against any active search text.
            items = contacts.filter(contact => contact
                && this.matchContact(contact, this.state.targetUri));
        } else if (!this.state.selectedContact && this.state.filter === 'deleted') {
            // Deleted folder: any contact marked for deletion — storage_purged
            // set (local delete / removeConversation) OR deleted_timestamp set
            // (incl. legacy rows and XCAP-delete intent). From here the user
            // revives it or kills it on XCAP. Permanent tombstones (deleted=1)
            // are never loaded, so they can't appear here.
            items = contacts.filter(contact => contact
                && (contact.storagePurged || contact.deletedTimestamp)
                && this.matchContact(contact, this.state.targetUri));
        } else if (!this.state.selectedContact && this.state.filter) {
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
            // Contacts marked for deletion (storage_purged OR deleted_timestamp)
            // live only in the Deleted view (and, once killed on XCAP, the
            if (elem && (elem.storagePurged || elem.deletedTimestamp)
                && this.state.filter !== 'deleted' && this.state.filter !== 'graveyard') {
                return;
            }

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

        // "Recent" shows the 7 most recently-active contacts (by
        // timestamp), capped at 7 — a fixed-size window rather than the
        // old 3-day cutoff (which could be empty on quiet weeks or huge
        // after a busy one). Precompute the set of qualifying URIs here so
        // the per-item filter below is a cheap membership test.
        const RECENT_CAP = 7;
        let recentUriSet = null;
        if (this.state.periodFilter === 'recent') {
            recentUriSet = new Set(
                items
                    .filter(it => it && it.timestamp)
                    .slice()
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, RECENT_CAP)
                    .map(it => it.uri)
            );
        }

        items.forEach((item) => {
            const fromDomain = '@' + item.uri.split('@')[1];

            // NOTE: the anonymous@anonymous.invalid row used to be hidden from
            // every view except 'blocked'. That meant accepted/missed calls
            // from guest callers (which collapse into this one canonical
            // contact) silently vanished from the Calls list. It now flows
            // through the normal filters like any other contact, so the
            // single collapsed "Anonymous" entry is visible in Calls/Contacts.
            // Conference-invite mode still excludes it below (it has no inbox
            // to invite), and blocked-tagging still routes it to the Blocked
            // view as usual.

            if (this.state.periodFilter === 'recent') {
                if (!recentUriSet || !recentUriSet.has(item.uri)) {
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
                if (utils.isAnonymous(_itemUri)) return;
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

        // ── Calls-category diagnostics ──────────────────────────────────
        // One-line snapshot of why the Calls tab is (or isn't) populated:
        // how many source contacts carry a lastCallTimestamp / 'calls' tag,
        // how many are conference rooms (excluded from Calls), and how many
        // actually made it into the rendered list. Plus a small sample of
        // the URIs that have a lastCallTimestamp so a fresh-start run shows
        // whether saveHistory's stamps reached the in-memory rows.
        if (this.state.filter === 'calls') {
            try {
                const src = this.state.allContacts || [];
                const withTs = src.filter(c => c && c.lastCallTimestamp != null);
                const withTag = src.filter(c => c && Array.isArray(c.tags) && c.tags.indexOf('calls') > -1);
                const confWithTs = withTs.filter(c => (c.uri || '').indexOf('@videoconference.') > -1);
                console.log('[calls-diag] source=' + src.length
                    + ' withLastCallTs=' + withTs.length
                    + ' withCallsTag=' + withTag.length
                    + ' confWithTs=' + confWithTs.length
                    + ' shown=' + filteredItems.length
                    + ' targetUri=' + (this.state.targetUri || '(none)'));
                const sample = withTs.slice(0, 8).map(c => (c.uri || '?')
                    + '#ts=' + (c.lastCallTimestamp instanceof Date
                        ? c.lastCallTimestamp.toISOString()
                        : c.lastCallTimestamp)
                    + (Array.isArray(c.tags) && c.tags.indexOf('calls') > -1 ? '' : ' [no calls tag]'));
                console.log('[calls-diag] withLastCallTs sample: ' + (sample.join(', ') || '(none)'));
            } catch (e) { console.log('[calls-diag] error', e && e.message); }
        }

        // Contact-search mode: when the user is actively searching the
        // contact list (a search query is present and we're not in the
        // message-search workflow), results are sorted alphabetically by
        // name (A→Z), honouring the asc/desc chip, rather than by message
        // timestamp. Searching is a "find this person" task, so a stable
        // alphabetical order is far more useful than recency — and it
        // unifies Sylk + Phonebook hits, which otherwise interleave
        // unpredictably because Phonebook entries carry no timestamp.
        // Always A→Z here regardless of the global asc/desc chip (which
        // defaults to 'desc' for the recency view): a search is a lookup,
        // and the user asked for alphabetical results.
        const _contactSearchActive =
            !this.state.searchMessages
            && !!this.state.targetUri
            && this.state.targetUri.length > 0;

        if (_contactSearchActive) {
            items.sort(function(a, b) {
                var aName = (a.name || a.uri || "").toLowerCase();
                var bName = (b.name || b.uri || "").toLowerCase();
                return aName.localeCompare(bName);
            });

            // Exception to the A→Z order: the exact thing the user typed,
            // resolved to a full SIP URI (username@defaultDomain for a bare
            // username), is ALWAYS the first result — the "call/chat exactly
            // what I typed" affordance. If that same URI also appears
            // elsewhere in the results (a real matching contact), keep only
            // the pinned top row and drop the duplicate.
            const _exactUri = utils.normalizeUri(
                (this.state.targetUri || '').toLowerCase(),
                this.props.defaultDomain
            );
            const _exactItem = items.find(it => it && it.uri === _exactUri);
            if (_exactItem) {
                items = [_exactItem].concat(
                    items.filter(it => it && it.uri !== _exactUri)
                );
            }

            // Saved Sylk contacts (a real contact_id present in allContacts) sort
            // ABOVE phonebook / synthetic results. Stable partition keeps the A→Z
            // order within each group.
            const _savedIds = new Set((this.state.allContacts || [])
                .map(c => c && c.id).filter(Boolean));
            const _isSaved = (it) => !!(it && it.id && _savedIds.has(it.id));

            // De-duplicate: if a URI is already part of a saved Sylk contact,
            // it must NOT also appear as a separate OS-phonebook / synthetic
            // result (e.g. +40721253846 saved as "Jane Doe Mobile"
            // shouldn't also list a bare phone "Jane Doe"). Build the
            // set of every URI owned by a saved contact (across all of its
            // addresses), normalized so +number and +number@domain collapse
            // together, then drop any UNSAVED row whose URI is in that set.
            const _normU = (u) => {
                try { return utils.normalizeUri((u || '').toLowerCase(), this.props.defaultDomain); }
                catch (e) { return (u || '').toLowerCase(); }
            };
            const _savedUriSet = new Set();
            (this.state.allContacts || []).forEach((c) => {
                if (!c) return;
                if (c.uri) _savedUriSet.add(_normU(c.uri));
                if (Array.isArray(c.uris)) {
                    c.uris.forEach((u) => {
                        const _uu = (u && (u.uri || u)) || '';
                        if (_uu) _savedUriSet.add(_normU(_uu));
                    });
                }
            });
            items = items.filter((it) => {
                if (!it) return false;
                if (_isSaved(it)) return true;            // keep the real saved row
                return !_savedUriSet.has(_normU(it.uri));  // drop unsaved dup of a saved URI
            });

            items = items.filter(_isSaved).concat(items.filter(it => !_isSaved(it)));
        } else if (this.state.orderBy == 'size') {
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
        // Dump the search results (one per line) when a search is active:
        // contact_id is shown only when the row is a real saved contact,
        // otherwise '-' (a synthetic typed / phonebook result).
        if (this.state.targetUri) {
            const _all = this.state.allContacts || [];
			/*
				utils.timestampedLog('[contact] [search] "' + this.state.targetUri + '" → ' + items.length + ' result(s)');
			*/
            items.forEach((it) => {
                if (!it) return;
                const _found = _all.some(c => c && c.id === it.id);
                // Honour the display convention: phone-number URIs collapse
                // to the bare +number (no @domain). The domain is still kept
                // in storage for routing/dedup, but the log mirrors what the
                // user actually sees on the tile.
                let _u = it.uri || '';
                try { if (_u && utils.isPhoneNumber(_u)) _u = _u.split('@')[0]; } catch (e) {}
                /*
                utils.timestampedLog('[contact] [search] "' + this.state.targetUri + '"'
                    + ', contact_id=' + (_found ? it.id : '-')
                    + ', uri=' + _u
                    + ', DN=' + JSON.stringify(it.name || ''));
                    */
            });
        }
        this._itemsMemo = items;
        this._itemsMemoKey = _memoKey;
        }
        // Re-apply the per-row selection flag on every render (cheap). Because
        // selection toggles hit the memo above, the heavy pipeline is skipped
        // and only this O(visible) marking runs — making the checkbox instant.
        {
            const _selSet = new Set(this.state.selectedContacts || []);
            const _keeperId = this.props.mergeKeeperId;
            // Only highlight the merge winner while actually in multi-select mode.
            const _selecting = !!this.props.contactSelectMode;
            items.forEach((it) => {
                if (!it) return;
                it.selected = _selSet.has(it.uri);
                // Flag the merge winner (keeper) so its tile is highlighted —
                // only during multi-select; the colour vanishes otherwise.
                it.mergeWinner = !!(_selecting && _keeperId && it.id === _keeperId);
            });
        }

        let columns = 1;

        if (this.state.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;

        // FlatList recycles rows and only re-renders them when extraData
        // changes. The active-location-share pin in each ContactCard is driven
        // by props.activeLocationShares (not part of the row item), so fold a
        // STRING signature of the shared-with URIs into extraData (compared by
        // value → only changes when the set actually changes) alongside the
        // selection signature. Preserves the O(visible-rows) recycling.
        const _shareSig = this.props.activeLocationShares
            ? Object.keys(this.props.activeLocationShares).sort().join(',')
            : '';
        const _inShareSig = this.props.incomingLocationShareUris
            ? Object.keys(this.props.incomingLocationShareUris).sort().join(',')
            : '';
        const _selSig = (this.state.selectedContacts || []).join(',');
        const _listExtraData = _selSig + '|' + _shareSig + '|' + _inShareSig;
        return (
            <SafeAreaView style={[container, {borderColor: 'white', borderWidth: 0}]}>
              {this.state.selectedContact ?
              
              (null)  // this.renderItem(items[0])
             :
              <FlatList
                horizontal={false}
                numColumns={columns}
                onRefresh={this.getServerHistory}
                refreshing={this.state.isRefreshing}
                data={items}
                /* extraData was pinned to `items` which is a fresh array
                   every render — FlatList treated every parent re-render
                   as "everything changed" and re-ran renderItem on every
                   row. Switch to selectedContacts so the list only
                   re-renders rows when selection changes; combined with
                   the now-immutable updateSelection in app.js, this
                   makes per-tap selection in the conference-invite
                   contact list O(visible rows) instead of O(all rows). */
                extraData={_listExtraData}
                renderItem={this.renderContactItem}
                /* listKey is the prop for NESTED VirtualizedLists. The
                   prop FlatList itself uses is keyExtractor, and without
                   it FlatList falls back to index-based keys — which,
                   combined with the reverse() + sort() this render
                   performs on every pass, churns key→row identity every
                   selection and forces a full unmount/remount of every
                   visible row. ~2 s per tap on a non-trivial contact
                   list. Wiring it to item.id (every contact has one)
                   restores row recycling. */
                keyExtractor={(item) => String(item.id)}
                /* Without this, RN's default 'never' policy makes the
                   first tap on a contact row only dismiss the search
                   keyboard — the touchable's onPress doesn't fire
                   until the second tap. 'handled' lets row taps (which
                   ARE handled by the touchable inside renderContactItem)
                   pass through immediately while still dismissing the
                   keyboard on taps that land in empty space. */
                keyboardShouldPersistTaps="handled"
                /* In select mode the floating Delete/Cancel buttons sit over
                   the bottom-right; pad the list so the last rows (and their
                   checkboxes) can scroll clear of them. */
                contentContainerStyle={this.state.selectMode ? {paddingBottom: 96} : null}
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

ContactsListBox.propTypes = {
    account         : PropTypes.object,
    // PSTN dialing rules (server replacePlus merged with the local
    // "Replace 0 with" preference) — used by matchContact to expand
    // phone-number searches to their international / national forms.
    pstnRules       : PropTypes.object,
    password        : PropTypes.string.isRequired,
    callHistoryUrl: PropTypes.string,
    targetUri       : PropTypes.string,
    selectedContact : PropTypes.object,
    contacts        : PropTypes.array,
    contactSource   : PropTypes.oneOf(['sylk', 'ab']),
    chat            : PropTypes.bool,
    orientation     : PropTypes.string,
    setTargetUri    : PropTypes.func,
    isTablet        : PropTypes.bool,
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    saveHistory     : PropTypes.func,
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
    inviteContacts  : PropTypes.bool,
    shareToContacts   : PropTypes.bool,
    selectedContacts: PropTypes.array,
    activeLocationShares: PropTypes.object,
    incomingLocationShareUris: PropTypes.object,
    toggleBlocked   : PropTypes.func,
    newContactFunc  : PropTypes.func,
    messageZoomFactor: PropTypes.string,
    fontScale       : PropTypes.number,
    call            : PropTypes.object,
    keys            : PropTypes.object,
    messagesCategoryFilter: PropTypes.string,
    sourceContact: PropTypes.object,
    orderBy: PropTypes.string,
    sortOrder: PropTypes.string,
    searchMessages: PropTypes.bool,
    searchString: PropTypes.string,
    dark: PropTypes.bool,
    messagesMetadata: PropTypes.object,
    fullScreen: PropTypes.bool,
    transferProgress: PropTypes.object,
    gettingSharedAsset: PropTypes.bool,
	playRecording: PropTypes.bool,
	isAudioRecording: PropTypes.bool,
	recordingFile: PropTypes.string,
	insets: PropTypes.object,
	appState: PropTypes.string
};


export default ContactsListBox;
