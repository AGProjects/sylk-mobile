import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { FlatList, View, Platform, StyleSheet, TouchableHighlight, TouchableOpacity, Dimensions, Animated, Easing, DeviceEventEmitter, NativeModules, AppState, Alert, BackHandler} from 'react-native';
// SylkAudioRouteModule's prepareForRecording / restoreAfterRecording
// helpers — see the native side in ios/sylk/AudioRouteModule.m for
// rationale. On iOS this module configures AVAudioSession for VOIP
// (PlayAndRecord + VoiceChat) at app init, which engages voice-
// processing IO and makes AVAudioRecorder.record() return NO — the
// underlying cause of the "Error occured during initiating recorder"
// rejection. We bracket startRecorder/stopRecorder with these calls
// so the voice-processing IO is released for the recording and
// restored afterwards.
const { AudioRouteModule: SylkAudioRouteModule } = NativeModules;
import { IconButton, Title, Button, Colors, Text, ActivityIndicator, Switch, Checkbox, Menu } from 'react-native-paper';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
// react-native-sound-level was previously used to drive the recording
// VuMeter, but it conflicted with audioRecorderPlayer on iOS (both open
// AVAudioRecorder on the same AVAudioSession and iOS rejects the
// second one with "Error occured during initiating recorder"). The
// recorder's own addRecordBackListener callback already provides
// currentMetering in dBFS, so the VuMeter is driven from that instead
// and this import is no longer needed.
import { check as checkPermission, PERMISSIONS as RNP_PERMISSIONS, RESULTS as RNP_RESULTS } from 'react-native-permissions';

import { red } from '../assets/styles/colors';
import DarkModeManager from '../DarkModeManager';

import ConferenceModal from './ConferenceModal';
import ContactsListBox from './ContactsListBox';
import AudioRecorder from './AudioRecorder';

import SessionButtonsBar from './SessionButtonsBar';
import ContactsListBanners from './ContactsListBanners';
import ContactsCategoryBar from './ContactsCategoryBar';
import ChatFilterSortBar from './ChatFilterSortBar';
import ContactSelectFab from './ContactSelectFab';
import SearchBar from './SearchBar';
import {
    isVideoConferenceUri,
    isAnonymousUri,
    canReceiveVoiceMemo,
    canShareLocationWith,
} from './ContactCapabilities';
import { planFilterHistory } from './contactsFilterMachine';
import { planPropsReconcile } from './propsReconciler';
// Custom in-app confirmation dialog — replaces native Alert.alert for
// the bulk Delete (Deleted/Graveyard) confirmations, which overflow the
// right margin in portrait.
import ConfirmActionModal from './ConfirmActionModal';
import utils from '../utils';
import {Keyboard} from 'react-native';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';
import AudioWaveform from './AudioWaveform';
import VuMeter from './VuMeter';
import MicSpectrumBars from './MicSpectrumBars';
import SpectrumPlayback from './SpectrumPlayback';
import SpectrumRecorder from './SpectrumRecorder';
import AudioProgressSlider from './AudioProgressSlider';

import uuid from 'react-native-uuid';
import fileType from 'react-native-file-type';
import AudioRecorderPlayer, {
    AudioEncoderAndroidType,
    AudioSourceAndroidType,
    AVEncodingOption,
    AVEncoderAudioQualityIOSType,
    OutputFormatAndroidType,
} from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';

import styles from '../assets/styles/ReadyBox';
import containerStyles from '../assets/styles/ContainerStyles';

const audioRecorderPlayer = new AudioRecorderPlayer();
// Match the 50 ms (~20 fps) metering/playback cadence used elsewhere
// (AudioRecorder.js, ChatBox.js) so peaks and the slider stay in sync
// with the audio instead of updating only ~twice a second.
try { audioRecorderPlayer.setSubscriptionDuration(0.05); } catch (e) { /* older lib: ignore */ }

// Per-platform action-button style classes. These depend only on Platform.OS
// (fixed for the life of the process) and the static `styles` stylesheet, so
// they're computed once at module load rather than rebuilt on every render.
const greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS         : styles.greenButton;
const blueButtonClass          = Platform.OS === 'ios' ? styles.blueButtoniOS          : styles.blueButton;
const redButtonClass           = Platform.OS === 'ios' ? styles.redButtoniOS           : styles.redButton;
// Purple dot = "Share location" — visually distinct from the green call
// buttons and the blue record/file-transfer buttons so the new action doesn't
// get mistaken for a call or a file share.
const purpleButtonClass        = Platform.OS === 'ios' ? styles.purpleButtoniOS        : styles.purpleButton;
const disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS : styles.disabledGreenButton;
const disabledBlueButtonClass  = Platform.OS === 'ios' ? styles.disabledBlueButtoniOS  : styles.disabledBlueButton;


class ReadyBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.audioRecorderRef = React.createRef();


        // Drives the pulsing opacity on the chat-header "Share location"
        // pin when the current contact has an active live share. Matches
        // the NavBar indicator's breathe pattern (700ms sine-in-out,
        // 1.0 → 0.35) so the two feel like the same signal — except only
        // one of them is visible at a time (the NavBar one hides while
        // we're inside the chat; see NavigationBar render).
        this._locationSharePulse = new Animated.Value(1);
        this._locationSharePulseLoop = null;

        this.state = {
            recorderState: { recording: false, recordArmed: false, previewRecording: false, playRecording: false, recordingFile: null, msgPlaybackActive: false },
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : '',
            sticky: false,
            // Custom bulk-delete confirmation dialog (Deleted "Delete
            // permanently" / Graveyard "Delete forever"). Holds
            // {title, message, actions} when open, null when closed.
            confirmDialog: null,
            contactsFilter: null,
            messagesCategoryFilter: null,
            historyPeriodFilter: null,
            participants: null,
            // Drop the `&& props.call !== null` clause from the
            // original initial-state expression. That clause forced
            // chat=false on every cold-start where the app wasn't
            // already in a call — even when App.constructor had pre-
            // seeded selectedContact from a sylk://message launch
            // intent (via SylkBridge.consumeLaunchMessageUri). The
            // first paint then rendered the contacts list and only
            // flipped to chat mode after the props reconciler (_reconcileProps)
            // fired with the next prop update, producing the
            // "contacts list briefly visible under the spinner"
            // symptom on a notification cold-start tap. selectedContact
            // alone is the right signal: ReadyBox is in chat mode iff
            // the App has a contact selected, regardless of any
            // concurrent call.
            chat: this.props.selectedContact !== null,
            // isTyping / navigationItems / keys / searchMessages / searchContacts
            // are read directly from props (they were pure prop-mirrors); only
            // searchString is genuine local state.
			searchString: '',
			recordingDuration: 0,
			// Per-100ms peak amplitude for the in-progress / just-
			// finished mic recording. Single channel (l) — voice
			// memos only have the user's mic, no remote side. Gets
			// attached to the outgoing file_transfer's metadata so
			// the recipient's bubble draws the same waveform we
			// preview here.
			recordingPeaks: [],
			// Recorded spectrogram (spectrumCodec metadata) for the
			// in-progress / just-finished take, animated on preview +
			// shipped with the message so playback shows the spectrum.
			recordingSpectrum: null,
			sortOrder: 'desc',
			orderBy: 'timestamp',
			showOrderBar: false,
			playRecording: false,
			level: 0,
			// Elapsed recording time in ms, displayed under the VuMeter
			// during recording. Sourced from
			// audioRecorderPlayer.addRecordBackListener's
			// `currentPosition` field (ticks ~every 100 ms) so the
			// displayed value is in lockstep with what the recorder
			// itself has captured — using a separate setInterval would
			// drift relative to the actual file duration.
			recordingElapsedMs: 0,
			// Active microphone for the current voice-message recording.
			// Set in onStartRecord from the engaged device and shown under the
			// live mic spectrum. null when not recording.
			recordingInputDevice: null,
			// Pre-record "armed" screen: the user has tapped record and is
			// choosing an input device, but capture hasn't started yet.
			recordArmed: false,
			// Selectable input devices for the armed screen ({type,name,id,icon}).
			recordInputs: [],
			// The input device chosen on the armed screen (engaged at Start).
			selectedRecordInput: null,
			// Whether the input-device picker menu is open.
			recordInputMenuVisible: false,
			// True between tapping Start and capture actually beginning. The
			// armed screen stays mounted (so the chat doesn't flash back) and
			// shows a "Starting…" spinner while the input route engages.
			recordStarting: false,
			// Gated by a timer so the red "no private key" banner doesn't
			// flash on the main screen behind the ImportPrivateKeyModal the
			// moment keyStatus arrives. It only flips true after the modal
			// has been closed AND a short grace period has passed, giving
			// the modal time to animate out. See componentDidUpdate for the
			// transitions that arm/disarm this.
			showNoPrivateKeyWarning: false,
			// Toggle that lets the user pick which contact source to
			// search across in the Contacts List: 'sylk' = the Sylk
			// account contacts loaded from the server / local DB,
			// 'ab' = the system address-book entries loaded once at
			// app start. Defaults to 'sylk' so behavior matches what
			// users saw before this toggle existed (Sylk-only).
			contactSource: 'sylk',
			// AddressBook-only: dialpad attached to the right of the
			// search bar. Tapping the dialpad icon toggles this; when
			// true an inline DTMFPad is rendered below the search bar
			// and each key press appends a digit to the search field.
			showAbDialpad: false,
			// Cached microphone-permission state, refreshed on mount
			// and on AppState foreground transitions. Three values:
			//   null  — not yet checked (initial render); leave the
			//           mic button visible so we don't flash it out
			//           for the common already-granted case.
			//   true  — recording is allowed; mic button stays.
			//   false — recording is NOT allowed (denied / blocked /
			//           unavailable); showAudioRecordButton hides
			//           the button so the user can't tap into an
			//           opaque prepareToRecord failure or a
			//           re-prompt loop.
			// We don't trigger a permission PROMPT here — only a
			// read. The prompt still fires lazily on actual record
			// intent via requestMicPermission. This way a user who
			// granted mic access ages ago doesn't get re-asked just
			// for opening a chat.
			micPermissionGranted: null,
        };

        this.ended = false;
        this._noPrivateKeyWarningTimer = null;
        // Grace period between "modal closed / existsLocal still false"
        // and showing the banner. Matches the modal's fade-out roughly so
        // the banner reveals cleanly after the dialog finishes hiding.
        this._noPrivateKeyWarningDelay = 600;
    }

    // Props-edge reconciliation, called from componentDidUpdate (guarded so it
    // runs only when props actually changed — see the call site). This replaces
    // the former UNSAFE_componentWillReceiveProps: `prevProps` is the previous
    // props and `this.props` is the current ("next") props. Decision logic lives
    // in the pure planPropsReconcile machine; this is a thin executor over the
    // ordered ops it returns. See propsReconciler.js for the full transition
    // table.
    //
    // Timing note: because this now runs in componentDidUpdate rather than
    // before render, the setState ops apply in a follow-up render (React batches
    // them) instead of the same render. Empty setState patches are skipped so
    // they don't schedule a redundant render.
    _reconcileProps(prevProps) {
        if (this.ended) {
            return;
        }

        const props = this.props;
        const ctx = {
            hasPrevSelectedContact: !!prevProps.selectedContact,
            hasNextSelectedContact: !!props.selectedContact,
            selectedContactChanged: props.selectedContact !== prevProps.selectedContact,
            prevSelectedContactUri: prevProps.selectedContact ? prevProps.selectedContact.uri : null,
            prevInviteContacts: prevProps.inviteContacts,
            nextInviteContacts: props.inviteContacts,
            prevPinned: prevProps.pinned,
            prevHistoryFilter: prevProps.historyFilter,
            nextHistoryFilter: props.historyFilter,
            prevGotoDeletedSignal: prevProps.gotoDeletedSignal,
            nextGotoDeletedSignal: props.gotoDeletedSignal,
            prevAllContactsLength: prevProps.allContacts.length,
            nextAllContactsLength: props.allContacts ? props.allContacts.length : 0,
            nextSearchContacts: props.searchContacts,
            nextSearchString: props.searchString,
            nextMissedCallsLen: props.missedCalls.length,
            nextBlockedUrisLen: props.blockedUris.length,
            nextFavoriteUrisLen: props.favoriteUris.length,
            nextHasDeletedContacts: (props.allContacts || []).some(
                c => c && (c.storagePurged || c.deletedTimestamp)),
            nextGraveyardCount: props.graveyardCount,
            nextStateFilterTagPresent: (props.allContacts || []).some(
                c => Array.isArray(c && c.tags) && c.tags.indexOf(this.state.contactsFilter) > -1),
            hasLoadGraveyardFn: typeof props.loadGraveyardContacts === 'function',
            stateContactsFilter: this.state.contactsFilter,
            // "Was search open before this update?" — the previous props value
            // (the state mirror that used to hold this is gone post-Phase-2).
            stateSearchContacts: prevProps.searchContacts,
            nextChatEnabled: props.selectedContact
                ? !this.chatDisabledForUri(props.selectedContact.uri)
                : undefined,
            navItemsLength: (this.navigationItems && this.navigationItems.length) || 0,
            pickedContactWhileSearching: !!this._pickedContactWhileSearching,
        };

        const ops = planPropsReconcile(ctx);
        for (const item of ops) {
            switch (item.op) {
                case 'setState':
                    if (item.patch && Object.keys(item.patch).length > 0) {
                        this.setState(item.patch);
                    }
                    break;
                case 'handleSearch':
                    this.handleSearch(item.arg);
                    break;
                case 'resetContact':
                    this.resetContact();
                    break;
                case 'togglePinned':
                    this.props.togglePinned(item.uri);
                    break;
                case 'filterHistory':
                    this.filterHistory(item.arg);
                    break;
                case 'scrollMainNavToStart':
                    if (this.navigationRefMain) {
                        try {
                            this.navigationRefMain.scrollToIndex({ animated: true, index: 0 });
                        } catch (e) {}
                    }
                    break;
                case 'loadGraveyardContacts':
                    if (typeof this.props.loadGraveyardContacts === 'function') {
                        this.props.loadGraveyardContacts();
                    }
                    break;
                case 'bounceNavigation':
                    this.bounceNavigation();
                    break;
                case 'consumePickFlag':
                    this._pickedContactWhileSearching = false;
                    break;
                case 'selectContact':
                    try { this.props.selectContact && this.props.selectContact(item.arg); } catch (e) {}
                    break;
                default:
                    break;
            }
        }
    }

    getTargetUri(uri) {
        return utils.normalizeUri(uri, this.props.defaultDomain);
    }

    async componentDidMount() {
        this.ended = false;

        // Android hardware back: when the user is inside the Deleted (or its
        // Graveyard sub-view) contact filter, "back" should drop the filter
        // and return to All rather than leaving the screen. Registered here;
        // ContactsListBox's own back handler runs first (it's mounted later)
        // and only consumes the event for its overlays, so when no overlay is
        // up this listener gets the press.
        this._backHandlerSub = BackHandler.addEventListener('hardwareBackPress', this.backPressed);
        // Kick off the pulse immediately if we landed here already sharing
        // (e.g. user switched chats, or app reloaded mid-share). All the
        // "start/stop on change" logic lives in componentDidUpdate; this
        // covers the initial-render case.
        if (this._isSharingCurrentContact(this.props)) {
            this._startLocationSharePulse();
        }


        // Populate the cached mic-permission state so
        // showAudioRecordButton can hide the mic when recording isn't
        // possible. Re-checked on every foreground transition because
        // the user can flip the permission in the OS Settings app
        // while Sylk is backgrounded and we want the bar to reflect
        // the new state the next time they look at it.
        this._refreshMicPermission();
        this._appStateSub = AppState.addEventListener('change', (next) => {
            if (next === 'active') {
                this._refreshMicPermission();
            }
        });

        // Chat message audio playback is routed to the AudioRecorder player
        // (it owns the whole waveform/spectrum/slider/seek plumbing). ChatBox
        // emits SylkPlayMessageAudio when a voice-message bubble is tapped;
        // we forward it to the recorder, which renders its player card while
        // the chat list is hidden (showContactsList gates on msgPlaybackActive)
        // — so GiftedChat's FlatList is unmounted and can't churn per tick.
        this._playMsgAudioSub = DeviceEventEmitter.addListener(
            'SylkPlayMessageAudio',
            (info) => {
                try {
                    const r = this.audioRecorderRef.current;
                    if (r) r.playMessageAudio(info);
                } catch (e) { /* never block */ }
            }
        );
        // Stop request (top Stop button, call starting, etc.) also tears down
        // the recorder's message playback.
        this._stopMsgAudioSub = DeviceEventEmitter.addListener(
            'SylkStopAudioPlayback',
            () => {
                try {
                    const r = this.audioRecorderRef.current;
                    if (r && r.state && r.state.msgPlayback) r.stopMessageAudio();
                } catch (e) { /* never block */ }
            }
        );
    }

    // Android back inside the Deleted / Graveyard contact view → exit the
    // filter back to All (remove filtering) and consume the event. Any other
    // state falls through (returns falsy) so the default back behaviour and
    // ContactsListBox's overlay handling are unaffected.
    backPressed = () => {
        if (this.ended) {
            return false;
        }
        if (!this.props.selectedContact
                && (this.state.contactsFilter === 'deleted' || this.state.contactsFilter === 'graveyard')) {
            this.filterHistory('all');
            return true;
        }
        return false;
    }

    componentWillUnmount() {
        this.ended = true;
        if (this._backHandlerSub) {
            this._backHandlerSub.remove();
            this._backHandlerSub = null;
        }
        this._stopLocationSharePulse();
        this._clearNoPrivateKeyWarningTimer();
        if (this._appStateSub) {
            // RN 0.65+: addEventListener returns a subscription with
            // .remove(); the older AppState.removeEventListener API
            // is gone. Guard for both shapes anyway.
            if (typeof this._appStateSub.remove === 'function') {
                this._appStateSub.remove();
            }
            this._appStateSub = null;
        }
        if (this._playMsgAudioSub) { this._playMsgAudioSub.remove(); this._playMsgAudioSub = null; }
        if (this._stopMsgAudioSub) { this._stopMsgAudioSub.remove(); this._stopMsgAudioSub = null; }
    }

    // Read-only permission probe — does NOT trigger the OS prompt.
    // Drives state.micPermissionGranted, which showAudioRecordButton
    // consults to hide the mic when recording isn't possible. The
    // actual prompt still fires on first record intent via
    // this.props.requestMicPermission (see recordAudio at line ~2284),
    // so the user is only asked once they've expressed intent.
    async _refreshMicPermission() {
        if (this.ended) return;
        try {
            const perm = Platform.OS === 'ios'
                ? RNP_PERMISSIONS.IOS.MICROPHONE
                : (Platform.OS === 'android' ? RNP_PERMISSIONS.ANDROID.RECORD_AUDIO : null);
            if (!perm) return;
            const result = await checkPermission(perm);
            if (this.ended) return;
            // GRANTED + LIMITED both allow recording (LIMITED is an
            // iOS-only partial-access result, but recording is fine
            // under it). Everything else — DENIED, BLOCKED,
            // UNAVAILABLE — means recording can't proceed, so hide.
            const granted = (result === RNP_RESULTS.GRANTED || result === RNP_RESULTS.LIMITED);
            if (this.state.micPermissionGranted !== granted) {
                this.setState({ micPermissionGranted: granted });
            }
        } catch (e) {
            // checkPermission throwing is rare but possible on some
            // OS versions / permission denials. Don't lock the user
            // out of the mic because of an introspection failure —
            // leave the cached value alone (null on first run keeps
            // the button visible; an existing true/false stays).
            console.log('[mic-perm] check failed', e && e.message);
        }
    }

    _clearNoPrivateKeyWarningTimer() {
        if (this._noPrivateKeyWarningTimer) {
            clearTimeout(this._noPrivateKeyWarningTimer);
            this._noPrivateKeyWarningTimer = null;
        }
    }

    // Manage the "no private key" banner visibility in response to prop
    // changes. Called from componentDidUpdate. The banner must never be
    // visible while the ImportPrivateKeyModal is shown (they'd stack) and
    // must never appear on the very first render — the user has to be
    // given a chance to see/act on the modal first. After the modal
    // closes, we start a short timer; if keyStatus.existsLocal is still
    // false when the timer fires, we reveal the banner.
    _syncNoPrivateKeyWarning() {
        if (this.ended) return;

        const keyStatus = this.props.keyStatus || {};
        const modalVisible = !!this.props.showImportPrivateKeyModal;
        const noLocalKey = keyStatus.existsLocal === false;

        // Modal is up, the initial contact import is still running, we have a
        // key, or we don't yet know: banner is definitely not allowed. Clear
        // any pending timer and hide. (During contact sync the import-key modal
        // is deferred, so showing a "no private key" banner would be premature.)
        if (modalVisible || this.props.contactsSyncing || !noLocalKey) {
            this._clearNoPrivateKeyWarningTimer();
            if (this.state.showNoPrivateKeyWarning) {
                this.setState({ showNoPrivateKeyWarning: false });
            }
            return;
        }

        // Conditions to show the banner are met (modal hidden, no local
        // key). If it's already visible we're done. Otherwise arm the
        // grace-period timer once.
        if (this.state.showNoPrivateKeyWarning) return;
        if (this._noPrivateKeyWarningTimer) return;

        this._noPrivateKeyWarningTimer = setTimeout(() => {
            this._noPrivateKeyWarningTimer = null;
            // Re-check conditions at fire-time — the modal may have
            // re-opened or a key may have arrived while we waited.
            const ks = this.props.keyStatus || {};
            if (this.ended) return;
            if (this.props.showImportPrivateKeyModal) return;
            if (ks.existsLocal !== false) return;
            this.setState({ showNoPrivateKeyWarning: true });
        }, this._noPrivateKeyWarningDelay);
    }

    _isSharingCurrentContact(props) {
        const shares = (props && props.activeLocationShares) || {};
        const uri = props && props.selectedContact && props.selectedContact.uri;
        return !!(uri && shares[uri]);
    }

    _startLocationSharePulse() {
        if (this._locationSharePulseLoop) return;
        this._locationSharePulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(this._locationSharePulse, {
                    toValue: 0.35,
                    duration: 700,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
                Animated.timing(this._locationSharePulse, {
                    toValue: 1,
                    duration: 700,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
            ])
        );
        this._locationSharePulseLoop.start();
    }

    _stopLocationSharePulse() {
        if (this._locationSharePulseLoop) {
            this._locationSharePulseLoop.stop();
            this._locationSharePulseLoop = null;
        }
        this._locationSharePulse.setValue(1);
    }
    
	componentDidUpdate(prevProps, prevState) {
	  // Props-edge reconciliation (formerly UNSAFE_componentWillReceiveProps).
	  // Guard: componentDidUpdate fires after EVERY update, including our own
	  // setState; React keeps the same `props` object reference across
	  // state-only updates, so `prevProps !== this.props` runs this only when
	  // the parent actually re-rendered with new props — matching when cWRP
	  // used to fire. Runs first so its state resets/side effects precede the
	  // rest of this method.
	  if (prevProps !== this.props) {
	      this._reconcileProps(prevProps);
	  }

	  // Surface the active contacts filter to the parent (so the navbar can
	  // hide its kebab in the Deleted / Graveyard views).
	  if (prevState.contactsFilter !== this.state.contactsFilter
	      && typeof this.props.onContactsFilterChange === 'function') {
	      this.props.onContactsFilterChange(this.state.contactsFilter);
	  }

	  // Pulse the chat-header pin whenever the currently-selected contact
	  // has an active live-location share. Two triggers matter here:
	  //   (a) the user starts/stops a share (activeLocationShares map
	  //       identity changes — NavigationBar spreads a new object on
	  //       every mutation so a referential compare is enough);
	  //   (b) the user switches chats — the same share that shouldn't
	  //       pulse for contact A should pulse for contact B if B is
	  //       the one they're sharing with.
	  const wasSharing = this._isSharingCurrentContact(prevProps);
	  const isSharing = this._isSharingCurrentContact(this.props);
	  if (!wasSharing && isSharing) {
	      this._startLocationSharePulse();
	  } else if (wasSharing && !isSharing) {
	      this._stopLocationSharePulse();
	  }

	  // Arm/disarm the "no private key" banner whenever the relevant
	  // props change. This covers: modal closing (arm timer), modal
	  // re-opening (cancel + hide), and keyStatus.existsLocal going
	  // true (cancel + hide).
	  const prevModal = !!prevProps.showImportPrivateKeyModal;
	  const nowModal = !!this.props.showImportPrivateKeyModal;
	  const prevExistsLocal = (prevProps.keyStatus || {}).existsLocal;
	  const nowExistsLocal = (this.props.keyStatus || {}).existsLocal;
	  if (prevModal !== nowModal || prevExistsLocal !== nowExistsLocal) {
	      this._syncNoPrivateKeyWarning();
	  }

	  if (prevProps.searchMessages !== this.props.searchMessages && !this.props.searchMessages) {
            this.setState({sortOrder: 'desc',
                           orderBy: 'timestamp',
                           messagesCategoryFilter: null
                           });
      }

      // When the soft keyboard comes up while the in-bar dialpad is
      // open, close the dialpad and don't auto-restore it on dismiss.
      // The dialpad icon stays visible (it just toggles back to its
      // inactive style); the user reopens the pad by tapping it
      // again. This avoids the surprise of "I typed in the search,
      // dismissed the keyboard, and the keypad came back from
      // nowhere" — the keypad is now strictly toggle-on-tap.
      if (!prevProps.keyboardVisible && this.props.keyboardVisible && this.state.showAbDialpad) {
          this.setState({ showAbDialpad: false });
      }

		let keys = Object.keys(this.state);
		for (const key of keys) {		
			if (this.state[key] != prevState[key]) {
			    //console.log(' --- RB', key, 'has changed:', this.state[key]);
			}
		}
      
      
      if (prevProps.searchContacts !== this.props.searchContacts && this.props.searchContacts) {
		  this.setState({messagesCategoryFilter: null, historyPeriodFilter: null});
		  this.props.filterHistoryFunc(null);
      }

      if (this.state.messagesCategoryFilter !== prevState.messagesCategoryFilter) {
      }

      if (this.state.historyFilter !== prevState.historyFilter) {
		  if (this.state.historyFilter == 'calls' || this.state.historyFilter == 'conference') {
			  this.setState({historyPeriodFilter: 'recent'});
		  }

		  if (this.state.historyFilter == 'favorite' || this.state.historyFilter == 'test') {
			  this.setState({historyPeriodFilter: null});
		  }
      }

      if (prevState.orderBy !== this.state.orderBy) {
            if (this.state.orderBy == 'size') {
                this.setState({'sortOrder': 'desc'});
            }

            if (this.state.orderBy == 'timestamp') {
                this.setState({'sortOrder': 'desc'});
            }
      }

      if (prevState.selectedContact !== this.state.selectedContact && !prevState.selectedContact) {
        if (this.props.searchContacts) {
			this.props.toggleSearchContacts()
		}
      }
    }

    filterHistory(filter) {
       if (this.ended) {
            return;
       }

       // Decision logic lives in the pure planFilterHistory machine; here we
       // just supply the current context and execute the ordered ops it
       // returns. See contactsFilterMachine.js for the full transition table.
       const selectedContact = this.props.selectedContact;
       const ops = planFilterHistory(filter, {
           hasSelectedContact: !!selectedContact,
           pinned: this.props.pinned,
           messagesCategoryFilter: this.state.messagesCategoryFilter,
           historyPeriodFilter: this.state.historyPeriodFilter,
           contactsFilter: this.state.contactsFilter,
           hasDeletedContacts: (this.props.allContacts || []).some(
               c => c && (c.storagePurged || c.deletedTimestamp)),
           hasGraveyardContacts: (this.props.graveyardCount || 0) > 0,
       });

       for (const item of ops) {
           switch (item.op) {
               case 'togglePinned':
                   this.props.togglePinned(selectedContact.uri);
                   break;
               case 'filterHistoryFunc':
                   this.props.filterHistoryFunc(item.arg);
                   break;
               case 'loadGraveyardContacts':
                   if (typeof this.props.loadGraveyardContacts === 'function') {
                       this.props.loadGraveyardContacts();
                   }
                   break;
               case 'setState':
                   this.setState(item.patch);
                   break;
               case 'handleSearch':
                   this.handleSearch(item.arg);
                   break;
               default:
                   break;
           }
       }
    }

    chatDisabledForUri(uri) {
        if (isVideoConferenceUri(uri)) {
            return true;
        }

        if (isAnonymousUri(uri)) {
            return true;
        }

        if (uri.indexOf('3333@') > -1) {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            //return true;
        }

        return false;
    }

    get showNavigationBar() {
        if (this.props.keyboardVisible) {
            return;
        }

        if (this.props.selectedContact) {
            //return false;
        }

        if (this.state.recorderState.recording) {
            //return false;
        }

        return true;
    }

    get showSearchBar() {
        // Invite-to-conference and share-to-contacts modes put the
        // contacts list into select-mode, and the user needs the
        // Searchbar to filter the list down to who they want to
        // pick. URIInput already renders the right placeholder
        // ("Select contacts to invite...") in these modes — the
        // gate just needs to let it through. Without this, the
        // user lands on a long unfiltered list with no way to
        // narrow it, which is the bug the user reported.
        if (this.props.inviteContacts || this.props.shareToContacts) {
            return true;
        }

        if (!this.props.searchMessages && !this.props.searchContacts) {
			return false;
        }

		if (this.state.messagesCategoryFilter == 'image') {
			return false;
		}

        if (this.props.selectedContact) {
            if (!this.props.searchMessages) {
				return false;
            }
        }

        if (this.props.showQRCodeScanner) {
            //return false;
        }

        if (this.props.isTablet || (!this.props.isLandscape && this.props.selectedContact)) {
            return true;
        }

        /*
        if (this.props.call && this.props.call.state !== 'incoming' && !this.props.inviteContacts) {
            return false;
        }
        */

        return true;
    }

   get showCategoryBar() {
	   // Folded (cover-display) mode: suppress the filter / sort bar
	   // entirely. The cover screen has very little vertical room and
	   // the bar's content (filter chips, sort toggles, Sylk/AB source
	   // pills) is secondary to the contact list / messages it sits
	   // above. The user can still operate everything from the main
	   // display when needed.
	   if (this.props.isFolded) {
		   return false;
	   }
	   if (this.props.selectedContact) {
		   return this.props.searchMessages || this.state.messagesCategoryFilter || this.state.orderBy == 'size';
	   } else {
		   // The bar is already gated on the user actively entering
		   // "search contacts" mode, so the only relevant question is
		   // whether searchContacts is on. The previous extra clause
		   // (allContacts.length > 10) hid the Sylk/AddressBook source
		   // toggle whenever the Sylk list happened to be small — but
		   // that's precisely when the AB source matters most, since
		   // the address book is usually orders of magnitude larger
		   // than a handful of Sylk contacts. Keep the bar visible
		   // whenever search mode is active, regardless of contact
		   // count.
		   return this.props.searchContacts;
	   }
   }

    get showConferenceButton() {
        if (this.props.selectedContact) {
            return false;
        }

        if (this.state.recorderState.recording || this.state.recorderState.previewRecording) {
            return false;
        }

        if (this.props.shareToContacts) {
            return false;
        }
        // In invite-participants mode the user is picking contacts
        // to add to an EXISTING conference — they should not see
        // the "Start a new conference" button here. The contacts
        // list shows its own Cancel / Invite action pair (rendered
        // in the same button bar below) instead. Hiding this
        // button also removes the visual collision the user
        // reported ("the same Start conference appears").
        if (this.props.inviteContacts) {
            return false;
        }
        return true;
    }

    get showCallButtons() {
        if (this.props.call || this.state.recorderState.recording || this.state.recorderState.playRecording || this.state.recorderState.previewRecording || this.state.recorderState.recordingFile || this.props.shareToContacts) {
            return false;
        }
        // Anonymous / guest callers are not callable back — the canonical
        // anonymous@anonymous.invalid contact (and the legacy <random>@guest.<host>
        // form) collapses many throwaway peers into one synthetic row with
        // no reachable address, so the audio/video call bar must stay hidden
        // for it.
        if (this.props.selectedContact && isAnonymousUri(this.props.selectedContact.uri)) {
            return false;
        }
        // On foldables, hide the above-chat call buttons (audio + video)
        // when the device is folded onto the cover display. The cover is
        // too narrow to sensibly host call buttons above the chat area,
        // and the user can still initiate a call from the contact row
        // or from within the chat.
        if (this.props.isFolded) {
            return false;
        }
        return true;
    }

    get showAudioSendButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        if (!this.state.recorderState.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioDeleteButton() {
        if (!this.state.recorderState.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioStopButton() {
        return this.state.recorderState.playRecording;
    }

    get showAudioRecordButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        if (this.props.call) {
            return false;
        }

        // Contact-type gating: a voice memo is a file transfer, so it can only
        // be delivered to a real 1:1 peer. canReceiveVoiceMemo rejects video /
        // audio conference rooms, anonymous guests, `test` stubs and PSTN
        // numbers — see ContactCapabilities.js for the per-rule rationale.
        if (!canReceiveVoiceMemo(this.props.selectedContact)) {
            return false;
        }

        if (this.state.recorderState.recordingFile) {
            return false;
        }

        if (this.state.recorderState.playRecording) {
            return false;
        }

        // Cached microphone-permission gate. populated by
        // _refreshMicPermission() on mount, on app foreground, and
        // whenever the selected contact changes. When the OS has
        // denied / blocked / not-yet-granted mic access, recording
        // can't physically happen — the recorder lib's
        // prepareToRecord call would fail — so hide the button
        // entirely rather than letting the user tap it and hit a
        // permission prompt or an opaque "Error occured during
        // initiating recorder" failure. `null` (initial, not yet
        // checked) keeps the button visible so we don't flash it
        // out for the common already-granted case.
        if (this.state.micPermissionGranted === false) {
            return false;
        }

        return true;
    }

    // Visibility gate for the chat-header "Share location" button.
    //
    // Mirrors `showAudioRecordButton`'s shape (not in a call, selected
    // contact is a real 1:1 peer — not a videoconference room, not an
    // anonymous @guest, not a phone number), and adds the PGP gate that
    // NavigationBar already enforces on the kebab menu item: without the
    // contact's public key we can't encrypt the live-location payload, so
    // there's no plaintext fallback and the button must stay hidden.
    //
    // We intentionally do NOT hide this when a share is already active —
    // the user needs a way to STOP. (NavigationBar's handleMenu auto-
    // toggles between start and stop based on activeLocationShares.) The
    // icon stays static because that toggle-state lives in NavigationBar.
    // If we ever want state-aware iconography here we'd need to lift
    // `activeLocationShares` up to app.js.
    // Mirrors NavigationBar._hasBidirectionalChat — true when the
    // loaded message slice for `uri` carries at least one substantive
    // exchange in BOTH directions. text/* + image/* + file-transfer
    // + sylk-live-location (historical share bubbles) all count as
    // evidence of an active relationship. Pure control messages
    // (sylk-message-metadata, contact-update, IMDN, PGP-key) are
    // excluded. See the NavigationBar version for the full rationale.
    _hasBidirectionalChat(uri) {
        if (!uri) return false;
        const msgs = (this.props.messages && this.props.messages[uri]) || [];
        if (!Array.isArray(msgs) || msgs.length === 0) return false;
        let hasOut = false;
        let hasIn = false;
        for (const m of msgs) {
            if (!m) continue;
            if (m.system === true) continue;
            const ct = m.contentType;
            if (typeof ct !== 'string') continue;
            if (ct === 'application/sylk-message-metadata') continue;
            if (ct === 'application/sylk-contact-update') continue;
            if (ct === 'message/imdn') continue;
            if (ct.indexOf('pgp') !== -1) continue;
            // Live-location bubbles count as bidi proof — see the
            // matching block in NavigationBar._hasBidirectionalChat
            // for the rationale (a 60-tick incoming share is clearly
            // a real relationship and the share button should remain
            // available).
            if (ct === 'application/sylk-live-location') {
                hasOut = true;
                hasIn = true;
                return true;
            }
            const dir = m.direction;
            if (dir === 'outgoing') hasOut = true;
            else if (dir === 'incoming') hasIn = true;
            if (hasOut && hasIn) return true;
        }
        return false;
    }

    get showLocationShareButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        // The historical `if (this.props.call) return false` gate is
        // intentionally removed: a user on an active audio/video call
        // who simultaneously navigates into a chat (split-screen, or
        // simply tapping into a different conversation while the call
        // continues in the background) should still be able to share
        // their location. Location sharing has no audio/video
        // resource overlap with the active call — it's just a
        // metadata stream — so there's no technical reason to hide
        // the affordance, and "I'm on the phone, send me your
        // location" is exactly when the user wants it.
        // The other ancillary gates below (recording, audio preview,
        // playback) stay because they DO conflict with the same UI
        // row the share button lives in.

        // Static contact-type gating: real 1:1 peer (not a video conference
        // room, anonymous guest, or PSTN number) that has a PGP public key —
        // location metadata ships encrypted with no plaintext fallback. The
        // dynamic gates (already-sharing / bidirectional chat) follow below.
        if (!canShareLocationWith(this.props.selectedContact)) {
            return false;
        }

        // Bidirectional chat required — same rule as NavigationBar's
        // menu item. Don't surface location sharing on a chat the
        // user has never actually exchanged messages on. EXCEPT when
        // a share is already live for THIS contact: the user needs
        // a Stop affordance regardless of the chat's history (e.g. a
        // share that started before they cleared the chat history).
        const _activeShares = this.props.activeLocationShares || {};
        const _alreadySharing = !!_activeShares[this.props.selectedContact.uri];
        if (!_alreadySharing && !this._hasBidirectionalChat(this.props.selectedContact.uri)) {
            return false;
        }

        // While recording / previewing / playing back an audio note, keep
        // the row uncluttered. The four states cover the full recording
        // lifecycle:
        //   • recording       — mic is live right now
        //   • previewRecording — finished, user hasn't confirmed/cancelled yet
        //   • recordingFile    — captured file exists (review/send state)
        //   • playRecording    — user is listening back to the take
        if (this.state.recorderState.recording) {
            return false;
        }
        if (this.state.recorderState.previewRecording) {
            return false;
        }
        if (this.state.recorderState.recordingFile) {
            return false;
        }
        if (this.state.recorderState.playRecording) {
            return false;
        }

        return true;
    }

    get showButtonsBar() {
        if (this.props.fullScreen) {
            return false;
        }

        // Hide the call/video/conference button bar while a chat voice message
        // is playing in the recorder player card — the card has its own
        // play/pause, Stop and Back controls, so the call bar would just be
        // clutter (and could start a call over the playback).
        if (this.state.recorderState.msgPlaybackActive) {
            return false;
        }

        // Hide the call/video/conference button bar ONLY on the armed screen
        // (input selector + Start). During actual recording the bar must stay
        // visible — it hosts the Stop button, so hiding it would trap the user
        // in a recording they can't end.
        if (this.state.recorderState.recordArmed && !this.state.recorderState.recording) {
            return false;
        }

        // While the chat's quick-reaction bar is up (chatReactionMode
        // toggled by ContactsListBox via setChatReactionMode in
        // app.js), hide the call-button bar so the dimmed chat reads
        // as a focused modal — the brightly-lit call/video/conference
        // row would otherwise compete with the dim above the chat.
        if (this.props.chatReactionMode) {
            return false;
        }

        // Invite mode used to keep the action bar visible because it
        // hosted the Cancel / Invite button pair. Those buttons now
        // live INSIDE the search bar (URIInput renders them as
        // overlays), so the action bar in invite mode would just be
        // an empty padded slab between the navbar and the search bar.
        // Hide it.
        if (this.props.inviteContacts) {
			return false;
        }

        if (this.props.shareToContacts) {
			return true;
        }

        if (this.props.contactIsSharing) {
			return false;
        }

        if (this.state.contactsFilter === 'blocked') {
            return false;
        }

        // Normally the action bar collapses while the keyboard is up in
        // a selected chat to give the message list maximum room. EXCEPT
        // during an active call: tapping into the chat from a live call
        // raises the keyboard on Android (but not iOS), which made the
        // bar — and the Share-location button it hosts — vanish on
        // Android while staying visible on iOS. A user on a call who
        // opens the chat to "send me your location" still needs that
        // affordance, so keep the bar up during a call on both platforms.
        if (this.props.keyboardVisible && this.props.selectedContact && !this.props.call) {
            return false;
        }

        if (this.state.orderBy === 'size' && this.props.selectedContact) {
            return false;
        }        


        if (this.props.searchMessages) {
            return false;
        }        

        if (this.props.showQRCodeScanner) {
            return false;
        }

        // Tablet, contact selected → always show the call-button bar
        // under the navbar. On tablet the contact pane sits side-by-side
        // with the contact list, so a selected contact is a stable
        // "current call target" — the bar belongs there as the primary
        // action affordance for that contact.
        //
        // Tablet WITHOUT a selected contact falls through to the
        // phone-side gates below (target URI required, hidden in
        // landscape, etc.) — that's the case the earlier blanket
        // `if (isTablet) return true` was hiding incorrectly.
        if (this.props.isTablet && this.props.selectedContact) {
            return true;
        }

        if (this.props.call) {
//            return false;
        }

        if (!this.state.targetUri) {

            return false;
        }

        if (this.props.isLandscape) {
            return false;
        }

        /*
        if (this.props.selectedContact) {
            if (this.props.isLandscape && !this.props.isTablet) {
                return false;
            }
            return false;
        }
        */

        return true;
    }

    // Flip the contact-source state used by the in-bar toggle.
    // ContactsListBox reads this via a prop and limits its filter
    // to either Sylk contacts (default) or the address-book entries
    // loaded from the system at app start.
    handleContactSourceChange(source) {
        if (source !== 'sylk' && source !== 'ab') {
            return;
        }
        if (this.state.contactSource === source) {
            return;
        }
        // Every Phonebook selection invokes loadPhoneAddressBook. On the
        // app.js side it short-circuits when permission is granted
        // AND contacts have already been fetched; otherwise it
        // re-prompts the user. So the first tap shows the OS prompt,
        // and subsequent taps either no-op (granted, loaded) or
        // re-prompt (still denied). We deliberately don't ask at app
        // start any more — only on explicit Phonebook intent.
        if (source === 'ab' && typeof this.props.loadPhoneAddressBook === 'function') {
            this.props.loadPhoneAddressBook();
        }
        // Switching away from AB closes the dialpad — it's only
        // meaningful in the AddressBook number-entry mode.
        const next = { contactSource: source };
        if (source !== 'ab' && this.state.showAbDialpad) {
            next.showAbDialpad = false;
        }
        this.setState(next);
    }

    // Toggle the AddressBook dialpad attached to the search bar.
    // Opening the dialpad dismisses the OS soft keyboard — otherwise
    // both surfaces would fight for the bottom of the screen and the
    // dialpad would render under the keyboard. Closing the dialpad
    // doesn't re-summon the keyboard; the user can tap the search
    // input if they want it back.
    toggleAbDialpad() {
        const opening = !this.state.showAbDialpad;
        this.setState({ showAbDialpad: opening }, () => {
            if (opening) {
                Keyboard.dismiss();
            }
        });
    }

    // Each key press from the AB dialpad appends one printable
    // character to the search-bar value via the same handleSearch
    // path the keyboard uses. That way the contact list filters
    // immediately as digits accumulate, and the existing clear-icon
    // wipes the field if the user wants to start over.
    handleAbDialpadDigit(digit) {
        const current = (this.state.targetUri || '');
        this.handleSearch(current + digit);
    }

    // Drop the trailing character from the search bar — the dialpad
    // backspace key. Mistypes happen often when entering a long
    // number on a small keypad, and deleting one digit at a time
    // beats clearing the whole field via the × clear-icon and
    // re-entering everything.
    handleAbDialpadBackspace() {
        const current = (this.state.targetUri || '');
        if (!current.length) {
            return;
        }
        this.handleSearch(current.slice(0, -1));
    }

    // The main-interface search now unifies Sylk + Phonebook.
    // Phonebook entries used to be loaded only when the user
    // explicitly tapped the (now-hidden) Phonebook pill; with the
    // pill gone we lazily kick loadPhoneAddressBook the first time the
    // user signals search intent — either by tapping the search
    // field (URIInput.onSearchFocus, the preferred trigger so the
    // OS permission dialog appears the moment they "click search")
    // or as a safety net when they actually start typing
    // (handleSearch, in case some platform skips the click event).
    // This preserves the "only on explicit user intent" stance for
    // the OS contacts-permission prompt: we don't ask just for
    // opening the app. loadPhoneAddressBook is idempotent on the host
    // side — already-granted + already-loaded is a no-op, and not-
    // yet-granted re-prompts the OS once.
    kickUnifiedSearchAddressBookLoad() {
        if (this._unifiedSearchAbLoadKicked) return;
        if (this.props.searchMessages) return;
        if (this.props.shareToContacts) return;
        if (this.props.inviteContacts) return;
        if (typeof this.props.loadPhoneAddressBook !== 'function') return;

        this._unifiedSearchAbLoadKicked = true;
        try {
            this.props.loadPhoneAddressBook();
        } catch (e) {
            // Swallow — the Sylk side of the merged result renders
            // immediately regardless, and a failure here just means
            // the AB pile stays empty for this search.
            console.log('unified search loadPhoneAddressBook failed', e && e.message);
        }
    }

    // Bridge for children that need to clear the message search
    // query WITHOUT collapsing the surrounding search environment.
    //
    // Important: this does NOT call toggleSearchMessages. Flipping
    // `searchMessages` to false triggers a CDU branch above (the
    // `if (prevProps.searchMessages !== … && !this.props.searchMessages)`
    // block) that resets sortOrder, orderBy AND
    // messagesCategoryFilter to their defaults — which means the
    // ContactsListBox calendar bar (gated on
    // messagesCategoryFilter being set) would disappear together
    // with the category chip's selected state. Use case for this
    // method (the "Go to date" pill rendered between bubbles when
    // a search string is active) explicitly wants the opposite:
    // drop the query, keep the category filter and the calendar
    // bar alive so the date-filter result reads as a narrowing of
    // the existing search environment rather than a full reset.
    //
    // The bar itself stays open with an empty input field. The
    // user can dismiss it normally (× / hardware back) — same way
    // they would have from any other "empty search bar" state.
    clearMessageSearch = () => {
        this.setState({searchString: ''});
    };

    // Programmatic clear of the active media-type chip
    // (Text / Image / Video / Audio / …). Used by children that
    // need to drop out of a category-filtered surface — chief
    // current caller is the per-tile "go to chat on this day"
    // button on grid views, which wants to leave the Image/Video
    // grid and land the user in the full chat. Unlike a chip tap
    // this also wipes the search query so the chat that appears
    // isn't filtered by stale text — the user explicitly asked
    // to see the conversation around a particular date.
    clearMessageCategoryFilter = () => {
        this.setState({
            messagesCategoryFilter: null,
            searchString: '',
        });
    };

    // Long-press a contact → enter select mode. Inside the Deleted view this
    // pre-selects ALL trashed contacts (so "Delete all" is one tap, or deselect
    // a few first); elsewhere it just selects the long-pressed contact.
    handleLongPressContact = (contact) => {
        if (this.state.contactsFilter === 'deleted') {
            const uris = (this.props.allContacts || [])
                .filter(c => c && (c.storagePurged || c.deletedTimestamp)).map(c => c.uri);
            this.props.enterContactSelectModeAll(uris);
        } else if (this.state.contactsFilter === 'graveyard') {
            // Graveyard tombstones live in graveyardContacts (deleted=1), not
            // allContacts. Select them all so Revive-all / Delete-all is one tap.
            const uris = (this.props.graveyardContacts || []).filter(Boolean).map(c => c.uri);
            this.props.enterContactSelectModeAll(uris);
        } else {
            this.props.enterContactSelectMode(contact);
        }
    }

    // Floating-trash handler. Inside the Deleted view it's a HARD delete
    // (server + local) and asks for confirmation; everywhere else it's a SOFT
    // delete (move to the Deleted view), no confirmation.
    closeConfirmDialog = () => {
        this.setState({ confirmDialog: null });
    }

    // Bulk Restore from the contact-select FAB. Graveyard tombstones revive
    // via the graveyard-specific path (they aren't in allContacts); the
    // Deleted folder uses the regular restore.
    handleBulkRestore = () => {
        const uris = (this.props.selectedContacts || []).slice();
        if (this.state.contactsFilter === 'graveyard') {
            this.props.restoreGraveyardContacts(uris);
        } else {
            this.props.restoreContacts(uris);
        }
    }

    // Bulk Merge from the contact-select FAB. Resolves the keeper URI for the
    // confirmation message, then folds all selected contacts into one on
    // confirm. Phone numbers collapse to the bare +number, matching the tile.
    handleBulkMerge = () => {
        const uris = (this.props.selectedContacts || []).slice();
        let _winUri = '';
        try {
            const _keeper = (this.props.allContacts || [])
                .find(c => c && c.id === this.props.mergeKeeperId);
            _winUri = (_keeper && _keeper.uri) || '';
            if (_winUri && utils.isPhoneNumber(_winUri)) {
                _winUri = _winUri.split('@')[0];
            }
        } catch (e) {}
        this.setState({ confirmDialog: {
            title: 'Merge contacts',
            message: 'Merge the ' + uris.length + ' selected contacts into one?\n\n'
                + 'All their addresses are combined into:\n' + (_winUri || 'the highlighted contact') + '\n\n'
                + 'No messages are deleted.',
            actions: [
                { label: 'Merge', onPress: () => {
                    this.closeConfirmDialog();
                    if (this.props.mergeContacts) this.props.mergeContacts(uris);
                    if (this.props.exitContactSelectMode) this.props.exitContactSelectMode();
                } },
                { label: 'Cancel', cancel: true, onPress: () => this.closeConfirmDialog() },
            ],
        } });
    }

    handleContactDelete = () => {
        const uris = (this.props.selectedContacts || []).slice();
        if (!uris.length) return;
        if (this.state.contactsFilter === 'graveyard') {
            // Graveyard delete = EJECT: physically remove the SQL rows. This is
            // the ultimate, irreversible step — warn that it is final and that
            // resurrection is no longer possible.
            // Custom dialog (vertically stacked buttons) instead of a
            // native Alert.alert — the latter overflows the right margin
            // in portrait.
            this.setState({ confirmDialog: {
                title: 'Delete forever',
                message: 'Permanently delete ' + uris.length + ' contact' + (uris.length > 1 ? 's' : '')
                    + ' from this device?\n\nThis is final — once deleted '
                    + (uris.length > 1 ? 'they' : 'it') + ' cannot be revived or recovered.',
                actions: [
                    {label: 'Delete forever', destructive: true, onPress: () => {
                        this.closeConfirmDialog();
                        this.props.ejectContacts(uris);
                        // Leave selection mode so the floating Delete/Restore FABs
                        // hide — they linger otherwise once the list reappears.
                        if (this.props.exitContactSelectMode) {
                            this.props.exitContactSelectMode();
                        }
                        // If this eject empties the Graveyard, drop the category
                        // back to All so the UI returns to the main contacts list
                        // (the Graveyard pill would otherwise leave the user on an
                        // empty view — graveyard is exempt from the auto-reset).
                        const remaining = (this.props.graveyardContacts || [])
                            .filter(c => c && uris.indexOf(c.uri) === -1);
                        if (remaining.length === 0) {
                            this.setState({ contactsFilter: null });
                        }
                    }},
                    {label: 'Cancel', cancel: true, onPress: () => this.closeConfirmDialog()},
                ],
            }});
        } else if (this.state.contactsFilter === 'deleted') {
            this.setState({ confirmDialog: {
                title: 'Delete permanently',
                message: 'Permanently delete ' + uris.length + ' contact' + (uris.length > 1 ? 's' : '')
                    + '? This also removes ' + (uris.length > 1 ? 'them' : 'it') + ' from the server.',
                actions: [
                    {label: 'Delete', destructive: true, onPress: () => { this.closeConfirmDialog(); this.props.hardDeleteContacts(uris); }},
                    {label: 'Cancel', cancel: true, onPress: () => this.closeConfirmDialog()},
                ],
            }});
        } else {
            this.props.softDeleteContacts(uris);
            // Stay in the main list: after a soft delete, drop back to All
            // (contactsFilter null) rather than jumping into the Deleted
            // category. The user asked to remain on the normal contacts view.
            this.setState({ contactsFilter: null });
        }
    }

    handleSearch(inputText, contact) {
        // Note: previously kicked kickUnifiedSearchAddressBookLoad()
        // here as a typing-time safety net, but that turned typing in
        // the search bar into another implicit OS contacts-permission
        // trigger. Permission is now requested ONLY on explicit Search
        // button press — see app.js#toggleSearchContacts.

        if (this.props.searchMessages) {
            if (!inputText) {
                // Empty input in search-messages mode = the user
                // tapped the clear icon (the × inside the Searchbar)
                // OR cleared the field manually. Either way we
                // close the search bar via toggleSearchMessages,
                // which is also where the open/close log line fires.
                this.props.toggleSearchMessages();
                this.setState({searchString: ''});
            } else {
                this.setState({searchString: inputText});
            }
            return;
        }

        //console.log('handleSearch contact =', contact);

        if ((this.props.inviteContacts || this.props.shareToContacts || this.props.contactSelectMode) && contact) {
             const uri = contact.uri;
             this.props.updateSelection(uri);
             return;
        }

        if (this.props.selectedContact === contact) {
            if (this.state.chat) {
                this.setState({chat: false});
            }
            return;
        } else {
            this.setState({chat: false});
        }

        let new_value = inputText;

        if (contact) {
            if (this.state.targetUri === contact.uri) {
                new_value = '';
            }
        } else {
            contact = null;
        }

        if (this.state.targetUri === inputText) {
            new_value = '';
        }

        if (new_value === '') {
            contact = null;
        }

        if (new_value.indexOf(' ') === -1) {
            new_value = new_value.trim().toLowerCase();
        }

        //new_value = new_value.replace(' ','');

        //console.log('--- Select new contact', contact? contact.uri : null);
        //console.log('--- Select new targetUri', new_value);

        // Record that THIS gesture picked a real contact while searching. The
        // selection and the search-bar collapse land in separate render
        // cycles (see _reconcileProps), so a flag is the only
        // reliable way to tell the ×-clear path "don't undo this pick".
        if (contact) {
            this._pickedContactWhileSearching = true;
        }

        this.props.selectContact(contact);
        this.setState({targetUri: new_value});
    }

    handleTargetSelect() {
        
        if (this.props.searchMessages) {
			return;
        }

        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable");
            return;
        }

        let uri = this.state.targetUri.toLowerCase();

        if (uri.indexOf('@videoconference.') > -1) {
            // Saved invitees are stored on the contact's
            // `participants` array (persisted via app.js
            // saveConference) and re-hydrated into the in-memory
            // Quick-start path (entering the room URI in the
            // search bar and tapping enter): join with just the
            // local user. Saved invitees on the conference contact
            // are NOT auto-invited here — only the Join Conference
            // panel (handleConferenceCall) sends invites, and only
            // after the user has seen who's on the list.
            this.props.startConference(uri, {audio: true, video: true, participants: []});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    shareContent() {
        this.props.shareContent();
    }

    cancelShareContent() {
        this.props.cancelShareContent();
    }

    showConferenceModal(event) {
        event.preventDefault();
        this.props.showConferenceModalFunc();
    }


    handleChat(event) {
        event.preventDefault();
 
        let uri = this.state.targetUri.trim().toLowerCase();
	    this.setState({targetUri: ''});

		this.props.createChatContact(uri);
		Keyboard.dismiss();
    }

    handleAudioCall(event) {
        let uri;

        if (this.props.selectedContact) {
            uri = this.props.selectedContact.uri;
        } else {
            event.preventDefault();
            Keyboard.dismiss();
            uri = this.state.targetUri.trim().toLowerCase();
            var uri_parts = uri.split("/");
            if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link
                let event = uri_parts[3];
                uri = uri_parts[4];
                if (event === 'conference') {
                    uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
                }
            }
        }

        if (uri.indexOf('@videoconference.') > -1) {
            // Audio/Video buttons join the room WITHOUT auto-
            // inviting saved participants. The user wants the
            // quick-start buttons to put just themselves in the
            // room — explicit "invite saved people" only happens
            // via the Join Conference panel (handleConferenceCall),
            // where the user can SEE the invitee list before
            // confirming. Previously myInvitedParties[room] was
            // looked up and forwarded as initialParticipants, which
            // silently dispatched invites the user never saw.
            this.props.startConference(uri, {audio: true, video: false, participants: []});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: false});
        }
    }

    handleVideoCall(event) {
        //console.log('handleVideoCall')
        let uri;

        if (this.props.selectedContact) {
            uri = this.props.selectedContact.uri;
        } else {
            event.preventDefault();
            Keyboard.dismiss();
            uri = this.state.targetUri.trim().toLowerCase();
            var uri_parts = uri.split("/");
            if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link
                let event = uri_parts[3];
                uri = uri_parts[4];
                if (event === 'conference') {
                    uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
                }
            }
        }

        if (uri.indexOf('@videoconference.') > -1) {
            // Quick-start Video button — same rule as the Audio
            // button: join with just the local user, no auto-
            // invites of saved participants. The user invokes
            // explicit invites via the Join Conference panel
            // (handleConferenceCall) where the invitee list is
            // visible before confirming.
            this.props.startConference(uri, {audio: true, video: true, participants: []});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    // Chat-header "Share location" button. The heavy lifting (modal, origin
    // tick, watchdog, AsyncStorage handshake bookkeeping) already lives in
    // NavigationBar.handleMenu('shareLocation'), which is both start- and
    // stop-aware. We just delegate, via the `startLocationShare` prop that
    // app.js wires to navigationBarRef.current.handleMenu('shareLocation').
    // Keeping the logic in one place avoids drift between the kebab menu
    // item and this quick-access button.
    handleShareLocation() {
        if (this.props.startLocationShare) {
            this.props.startLocationShare();
        }
    }

    handleConferenceCall(targetUri, options={audio: true, video: true, participants: []}) {
        Keyboard.dismiss();
        this.props.startConference(targetUri, {audio: options.audio, video: options.video, participants: options.participants}, options.domain);
        this.props.hideConferenceModalFunc();
    }

    get chatButtonDisabled() {
        let uri = this.state.targetUri.trim();

        if (!uri) {
            return true;
        }

        // AddressBook source mode: only audio calls are meaningful for
        // raw phone-number entries. Chat would route to a SIP user
        // that probably doesn't exist (the AB number is a PSTN
        // destination, not a Sylk account), so we hide the action by
        // disabling the button while the AB pill is active.
        if (this.state.contactSource === 'ab') {
            return true;
        }

        if (this.props.selectedContact) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        if (this.chatDisabledForUri(uri)) {
            return true;
        }

        return false;
    }

    get callButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || isAnonymousUri(uri)) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        if (this.state.recorderState.recording) {
            return true;
        }

        if (this.state.recorderState.recordingFile) {
            return true;
        }

		const els = uri.split('@');
        const username = els[0];
		const isNumber = utils.isPhoneNumber(username);

        if (isNumber) {
            return false;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        return false;
    }

    get videoButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || isAnonymousUri(uri)) {
            return true;
        }

        // AB mode: phone-number entries can't carry video — disable.
        if (this.state.contactSource === 'ab') {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        if (this.state.recorderState.recording) {
            return true;
        }

        if (this.state.recorderState.recordingFile) {
            return true;
        }

        // Route through utils.isPhoneNumber with the account's
        // configured conference-bridge domain so that conference rooms
        // whose names start with a leading 0 (e.g. `089577@<your-
        // videoconference-domain>`) are NOT treated as PSTN numbers
        // here. The previous inline regex looked only at the local
        // part, which mis-classified those rooms as phone numbers
        // and disabled the Video Call button — making it impossible
        // to start the video room from the selected contact.
        const isPhoneNumber = utils.isPhoneNumber(uri, this.props.defaultConferenceDomain);

        if (isPhoneNumber) {
            return true;
        }

        return this.callButtonDisabled;
    }

    get conferenceButtonDisabled() {
        if (!this.props.canSend()) {
            return true;
        }

        // AB mode: starting a Sylk conference makes no sense for an
        // address-book phone-number entry. Disable.
        if (this.state.contactSource === 'ab') {
            return true;
        }

        let uri = this.state.targetUri.trim();

        if (uri.indexOf(' ') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@videoconference.') > -1) {
            return true;
        }

        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            if (event === 'call') {
                return true;
            }
        }

        return false;
    }

	async startAudioPlayer() {
	    //console.log('-- RB startAudioPlayer');
		this.setState({playRecording: true});
	}

	async stopAudioPlayer() {
		this.setState({playRecording: false});
	}

    async previewAudio () {
		this.setState({previewRecording: true});

		const path = this.state.recorderState.recordingFile.startsWith('file://')
		  ? this.state.recorderState.recordingFile
		  : 'file://' + this.state.recorderState.recordingFile;
  
        try {
			const msg = await audioRecorderPlayer.startPlayer(path);
			this.setState({previewRecording: true});
	
			audioRecorderPlayer.addPlayBackListener((e) => {
				if (e.duration === e.currentPosition) {
					this.setState({previewRecording: false});
				}
	
				this.setState({
				  currentPositionSec: e.currentPosition,
				  currentDurationSec: e.duration,
				  playTime: audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
				  duration: audioRecorderPlayer.mmssss(Math.floor(e.duration)),
				});
			});
        } catch (e) {
			console.log('previewAudio error', e);
        }
    };

    pausePreviewAudio = async () => {
		this.setState({previewRecording: false});
        await audioRecorderPlayer.pausePlayer();
    };

    onStopPlay = async () => {
        if (!this.state.recorderState.previewRecording) {
			return;
        }
        this.setState({previewRecording: false});
        audioRecorderPlayer.stopPlayer();
        audioRecorderPlayer.removePlayBackListener();
    };

    bounceNavigation() {
        return;
        
        if (this.ended) {
            return;
        }

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRefMain && !this.props.selectedContact && this.navigationItems && this.navigationItems.length > 0) {
                try {
                    this.navigationRefMain.scrollToIndex({animated: true, index: Math.floor(this.navigationItems.length / 2)});
                } catch (e) {}
            }
        }, 3000);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRefMain && !this.props.selectedContact && this.navigationItems && this.navigationItems.length > 0) {
                try {
                    this.navigationRefMain.scrollToIndex({animated: true, index: this.navigationItems.length-1});
                } catch (e) {}
            }
        }, 4500);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRefMain && !this.props.selectedContact && this.navigationItems && this.navigationItems.length > 0) {
                try {
                    this.navigationRefMain.scrollToIndex({animated: true, index: 0});
                } catch (e) {}
            }
        }, 6000);
    }

    // Filter half of the chat-bottom bar. These are the content-type
    // chips on the left side: tap one to filter the chat to messages of
    // that kind; tap again to clear. The list grows as we add new
    // categories (most recently Locations), and on narrow phones it
    // overflows the available width — the row that hosts these scrolls
    // horizontally, while the sort toggles stay anchored on the right.
    get categoryFilterItems() {
        const items = [];
        if (!this.props.selectedContact) return items;

        // Mutually-exclusive content-type filters. Picking one
        // narrows the chat to that type only; tapping the active
        // chip again clears the filter. Pinned was here originally
        // but moved to the right group (categorySortItems) — it's
        // a CUMULATIVE modifier, not a content-type filter, so it
        // belongs visually with the sort toggles on the other side
        // of the splitter.
        //
        // Each chip is only pushed when the contact actually has
        // at least one message of that type. categoryCounts is
        // populated by app.js#getMessages (single SQL pass +
        // metadata classification via utils.isImage/isAudio/
        // isVideo). If counts are missing — happens on the very
        // first render after contact selection, before getMessages
        // returns — fall back to ALL chips so the bar never looks
        // empty during the brief loading window. Once counts
        // arrive the chips for zero-count types disappear.
        //
        // Special case for the currently-active filter: keep its
        // chip visible even if the (presumably stale) count says
        // zero, so a user can always see what they're filtering by
        // and tap it again to clear.
        const counts = this.props.selectedContact && this.props.selectedContact.categoryCounts;
        const showAll = !counts;
        const active = this.state.messagesCategoryFilter;
        const candidates = [
            {key: 'text',     title: 'Text',      icon: 'text'},
            // Links subset of Text — same SQL slice (text-only,
            // file-transfer rows are dropped in sql2GiftedChat) plus
            // a JS post-filter that keeps only messages whose body
            // contains a URL. See the linksOnly branch in
            // ContactsListBox's filteredMessages pipeline.
            {key: 'links',    title: 'Links',     icon: 'link-variant'},
            {key: 'audio',    title: 'Audio',     icon: 'microphone'},
            {key: 'image',    title: 'Image',     icon: 'image'},
            {key: 'video',    title: 'Video',     icon: 'video'},
            {key: 'location', title: 'Locations', icon: 'map-marker'},
            {key: 'other',    title: 'Other',     icon: 'file'},
        ];
        for (const c of candidates) {
            // 'links' has no precomputed count (it's a JS-derived
            // subset of text — see candidates table above), so
            // gate it on the text count instead: if the contact
            // has any text bubbles there might be links among
            // them, and the JS filter will show the empty state
            // if not.
            const _countKey = c.key === 'links' ? 'text' : c.key;
            const has = showAll
                || (counts && counts[_countKey] > 0)
                || c.key === active;
            if (!has) continue;
            items.push({
                key: c.key,
                title: c.title,
                icon: c.icon,
                enabled: true,
                selected: active === c.key,
            });
        }
        return items;
    }

    // Sort half of the chat-bottom bar. Each pair is mutually exclusive
    // (only one shown at a time via the `enabled` gate) and tapping the
    // visible button flips to the alternative state. Pinned to the
    // right side of the bar — never scrolls offscreen — so a quick
    // glance at the bar always tells the user what sort is active.
    // Rendered as icons (matching the filter chips) since the labels
    // had already been pushed past the available width by the
    // Locations filter.
    //
    // Sort-axis icons (clock = by time, harddisk = by size) are
    // shown / hidden based on the active category filter:
    //
    //   • Locations active → hide BOTH axis icons. A live-location
    //     tick stream has no meaningful "size", and time is the only
    //     axis available — a single non-toggling icon would be noise.
    //     Asc/desc still flips the chronological direction.
    //
    //   • Text active → hide BY-SIZE, keep BY-TIME. Plain text
    //     messages technically have a byte size but ordering by it
    //     isn't a useful workflow ("show me my longest-character
    //     messages first"); time is the only axis users actually
    //     reach for in a text-only view.
    //
    //   • Anything else (audio / image / video / other / pinned, or
    //     no filter) → both axis icons remain available. These views
    //     are file-based or mixed, where size-sort drives a real
    //     "biggest assets first" use case.
    //
    // The asc/desc pair is always shown — the direction toggle is
    // useful in every category, including text and locations.
    get categorySortItems() {
        const items = [];
        if (!this.props.selectedContact) return items;
        const cat = this.state.messagesCategoryFilter;
        const inLocationFilter = cat === 'location';
        // 'links' is a subset of 'text' — same "byte size isn't a
        // useful axis here" reasoning applies, so it hides the
        // by-size sort icon alongside plain 'text'.
        const inTextFilter = cat === 'text' || cat === 'links';
        // Pin is a CUMULATIVE modifier — it stacks on top of any
        // content-type filter, not a replacement for one. Sits at
        // the start of the right group right after the splitter so
        // the user reads "exclusive content type filters" on the
        // left, then the splitter, then "modifiers / sort options"
        // on the right.
        //
        // Only renders when the contact actually has at least one
        // pinned message — same "hide-if-empty" treatment the
        // content-type chips on the other side of the splitter
        // get. categoryCounts.pinned is populated by app.js#
        // getMessages alongside the other counts. While
        // categoryCounts is still loading (or if getMessages hasn't
        // populated it yet) we fall back to showing the chip so the
        // sort group doesn't briefly snap empty. And if the user
        // already has pinned mode active, keep the chip visible
        // regardless of the count — they need a way to tap it off.
        const pinnedCount = this.props.selectedContact
            && this.props.selectedContact.categoryCounts
            && this.props.selectedContact.categoryCounts.pinned;
        const pinnedActive = !!this.props.pinned;
        const showPinned = pinnedCount === undefined
            || pinnedCount > 0
            || pinnedActive;
        if (showPinned) {
            items.push({key: 'pinned', title: 'Pinned', icon: 'pin', enabled: true, selected: pinnedActive});
        }
        // Sort / order icons (time / size / asc / desc) hidden by
        // user request — bar reads cleaner with only media-type
        // chips. The date-period filter (Day/Week/Month/Year)
        // above the chat now handles "narrow the visible window",
        // and the chips' implicit "newest first" order is enough
        // for browsing. Wrapped in a `false &&` guard rather than
        // deleted so the items can be re-enabled by flipping the
        // gate — the underlying state (orderBy / sortOrder) and
        // their handlers in renderNavigationItem are all still
        // wired up, so flipping the gate is a one-line
        // restoration.
        if (false) {
            if (!inLocationFilter) {
                items.push({key: 'orderByTime', title: 'Sort: by time', icon: 'clock-outline', enabled: this.state.orderBy === 'timestamp', selected: false});
                if (!inTextFilter) {
                    items.push({key: 'orderBySize', title: 'Sort: by size', icon: 'harddisk', enabled: this.state.orderBy === 'size', selected: false});
                }
            }
            items.push({key: 'orderAscending',  title: 'Order: ascending',  icon: 'arrow-up',   enabled: this.state.sortOrder === 'asc',  selected: false});
            items.push({key: 'orderDescending', title: 'Order: descending', icon: 'arrow-down', enabled: this.state.sortOrder === 'desc', selected: false});
        }
        return items;
    }

    // Backward-compatible flat list used by callers that need the
    // whole bar in one collection (no current callers other than this
    // component, but the export is kept so external diagnostics /
    // tests don't break). Equivalent to the previous shape: filters
    // first, sort toggles last.
    get categoryItems() {
        if (this.props.selectedContact) {
            return [...this.categoryFilterItems, ...this.categorySortItems];
        }

        // When the user has flipped the contact-source toggle to
        // AddressBook, hide the time / size SORT buttons (AB entries
        // have no message timestamps or per-contact storage to sort
        // by), but keep the alphabetical ASC / DESC order chips —
        // sorting the phonebook A→Z vs Z→A is genuinely useful.
        // The Sylk / Phonebook source pills continue to render on
        // the left side of this same nav row.
        if (this.state.contactSource === 'ab') {
            return [
                {key: 'orderAscending',  title: '↑ Ascending',  enabled: this.state.sortOrder === 'asc',  selected: false},
                {key: 'orderDescending', title: '↓ Descending', enabled: this.state.sortOrder === 'desc', selected: false},
            ];
        }

        // Hide Sort and Order buttons if the user has fewer than 10
        // contacts. A tiny contact list doesn't benefit from sorting
        // controls — the whole list is visible at a glance — and the
        // buttons just add visual noise on first-run / low-contact
        // accounts. The Sylk / Phonebook source pills are unaffected
        // and continue to render on the same nav row.
        const _contactCount = (this.props.allContacts || []).length;
        if (_contactCount < 10) {
            return [];
        }

        if (this.showCategoryBar) {
            const content_items = [];
            content_items.push({key: 'orderByTime', title: 'Sort by most recent', enabled: this.state.orderBy === 'timestamp', selected: false});
            content_items.push({key: 'orderBySize', title: 'Sort by storage', enabled:  this.state.orderBy === 'size', selected: false});
            content_items.push({key: 'orderAscending', title: '↑ Ascending', enabled: this.state.sortOrder === 'asc', selected: false});
            content_items.push({key: 'orderDescending', title: '↓ Descending', enabled: this.state.sortOrder === 'desc', selected: false});
            return content_items;
        }

        return [];
    }

    get navigationItems() {
        let conferenceEnabled = Object.keys(this.props.myInvitedParties).length > 0 || this.props.navigationItems['conference'];
        if (this.props.inviteContacts) {
            conferenceEnabled = false;
        }

        if (this.state.recorderState.recordingFile) {
			return [
              {key: "previewAudio", title: 'Play', enabled: true, selected: false},
              {key: "deleteAudio", title: 'Delete', enabled: true, selected: false},
              {key: "sendAudio", title: 'Send', enabled: true, selected: false}
              ];
        }

        if (this.props.showQRCodeScanner) {
            return [
              {key: "hideQRCodeScanner", title: 'Cancel', enabled: true, selected: false}
              ];
        }

        // Quick predicate for the Tel pill — enabled only when at least
        // one local contact carries the 'tel' tag (phone numbers
        // imported from address book / auto-tagged by saveContactByUser
        // when the URI's local-part starts with '+'). Computed inline
        // rather than mirrored on app.js's state — the predicate is
        // cheap, only the boolean reaches the pill, and the predicate
        // re-runs every render via the existing `allContacts` flow,
        // so a freshly-saved phone-number contact lights the pill up
        // without any further plumbing.
        const hasTelContacts = (this.props.allContacts || []).some(
            c => Array.isArray(c && c.tags) && c.tags.indexOf('tel') > -1
        );

        // Messages category — display name for the 'chat' tag (contacts the
        // user has messaged). Maps to the server 'Messages' group.
        const hasChatContacts = (this.props.allContacts || []).some(
            c => Array.isArray(c && c.tags)
                && (c.tags.indexOf('messages') > -1 || c.tags.indexOf('chat') > -1)
        );

        // Dynamic group categories: any custom group-tag present on contacts
        // that isn't one of the built-in categories or a non-group flag tag.
        // Each becomes a pill that filters by that tag (group name).
        const BUILTIN = new Set(['chat', 'messages', 'favorite', 'blocked', 'tel',
            'conference', 'test', 'autoanswer', 'calls', 'recent', 'missed']);
        const FLAG = new Set(['bypassdnd', 'muted', 'noread', 'history', 'contact']);
        const customTags = new Set();
        (this.props.allContacts || []).forEach(c => {
            (Array.isArray(c && c.tags) ? c.tags : []).forEach(t => {
                const tag = (t || '').trim();
                if (!tag) return;
                const low = tag.toLowerCase();
                if (BUILTIN.has(low) || FLAG.has(low)) return;
                customTags.add(tag);
            });
        });
        const customGroupItems = [...customTags].sort().map(tag => ({
            key: tag,
            title: tag.charAt(0).toUpperCase() + tag.slice(1),
            enabled: true,
            selected: this.state.contactsFilter === tag,
            // Dynamic group pills opt out of the member counter — the
            // showGroupMemberCounts prefix is reserved for the built-in
            // categories. _withCategoryCounts skips any item flagged here.
            isCustomGroup: true,
        }));

        // Deleted (trash) category — shown ONLY when at least one contact
        // actually matches the deleted criteria (a soft-deleted contact with
        // deleted_timestamp set, or one whose storage was purged). An empty
        // trash hides the pill entirely (renderNavigationItem returns null on
        // enabled:false), so the bar isn't cluttered with a folder that has
        // nothing in it. The pill is force-enabled while the user is already
        // inside the Deleted / Graveyard view so they can still see it
        // (it's the selected chip) and toggle back out. Tapping it lists the
        // trashed contacts; permanent tombstones (deleted=1) are never loaded.
        // Deleting from there is the real (hard) delete.
        const hasDeletedContacts = (this.props.allContacts || []).some(
            c => c && (c.storagePurged || c.deletedTimestamp));
        // Tombstones (deleted=1) live only in the Graveyard, which is reached
        // THROUGH the Deleted pill. So the Deleted pill must also show when the
        // Deleted folder is empty but the Graveyard still has entries —
        // otherwise those tombstones would be unreachable. graveyardCount is a
        // cheap up-front count kept in sync on app.js.
        const hasGraveyardContacts = (this.props.graveyardCount || 0) > 0;
        const _inDeletedMode = this.state.contactsFilter === 'deleted'
            || this.state.contactsFilter === 'graveyard';
        const _deletedItem = {key: 'deleted', title: 'Deleted', enabled: hasDeletedContacts || hasGraveyardContacts || _inDeletedMode, selected: this.state.contactsFilter === 'deleted'};
        // Graveyard chip is hidden when the graveyard is empty — there's
        // nothing to show. It's force-enabled while the user is already
        // inside the Graveyard view so the selected chip stays visible and
        // they can toggle back out.
        const _graveyardItem = {key: 'graveyard', title: 'Graveyard', enabled: hasGraveyardContacts || this.state.contactsFilter === 'graveyard', selected: this.state.contactsFilter === 'graveyard'};
        // "All" is ALWAYS the first pill — tapping it clears any active filter
        // (reset). It is never highlighted: "All" means no criteria, so there's
        // no active selection to indicate (highlighting it implied a filter was
        // applied when in fact nothing is). It only ever shows the active chip
        // styling for real category filters, not for the no-filter default.
        const _allItem = {key: 'all', title: 'All', enabled: true,
            selected: false};

        // "Deleted mode": once the user enters the Deleted folder (or the
        // Graveyard within it), collapse the whole category bar to just
        // All + Deleted + Graveyard. "All" exits back to the normal bar;
        // re-tapping Deleted also toggles back out (filterHistory clears an
        // active filter). Graveyard is ONLY shown here.
        if (this.state.contactsFilter === 'deleted' || this.state.contactsFilter === 'graveyard') {
            // Drop the Deleted chip when the soft-deleted folder is empty —
            // with nothing in it, only the Graveyard is worth showing.
            const _bar = [_allItem];
            if (hasDeletedContacts) _bar.push(_deletedItem);
            _bar.push(_graveyardItem);
            return this._withCategoryCounts(_bar);
        }

        return this._withCategoryCounts([
              _allItem,
              {key: 'recent', title: 'Recent', enabled: this.props.navigationItems['recent'], selected: this.state.historyPeriodFilter === 'recent'},
              {key: 'messages', title: 'Messages', enabled: hasChatContacts, selected: this.state.contactsFilter === 'messages'},
              {key: 'calls', title: 'Calls', enabled: true, selected: this.state.contactsFilter === 'calls'},
              {key: 'favorite', title: 'Favorites', enabled: this.props.favoriteUris.length > 0, selected: this.state.contactsFilter === 'favorite'},
              {key: 'autoanswer', title: 'Caregivers', enabled: this.props.hasAutoAnswerContacts, selected: this.state.contactsFilter === 'autoanswer'},
              {key: 'tel', title: 'Tel', enabled: hasTelContacts, selected: this.state.contactsFilter === 'tel'},
              {key: 'missed', title: 'Missed', enabled: this.props.missedCalls.length > 0, selected: this.state.contactsFilter === 'missed'},
              {key: 'blocked', title: 'Blocked', enabled: this.props.blockedUris.length > 0, selected: this.state.contactsFilter === 'blocked'},
              {key: 'conference', title: 'Conference', enabled: conferenceEnabled, selected: this.state.contactsFilter === 'conference'},
              {key: 'test', title: 'Test', enabled: !this.props.shareToContacts && !this.props.inviteContacts, selected: this.state.contactsFilter === 'test'},
              ...customGroupItems,
              _deletedItem,
              ]);
    }

    // Member count for a category / group pill in the contacts category bar.
    // Returns a number for membership-based categories (All, custom groups,
    // and the prop-backed ones), or null for history-derived categories
    // (Recent / Calls) and any non-category control key, so those render
    // without a counter. Counts exclude soft-deleted / purged contacts
    // (except the Deleted / Graveyard buckets, which count exactly those).
    _categoryCount = (key) => {
        const all = (this.props.allContacts || [])
            .filter(c => c && !c.deletedTimestamp && !c.storagePurged);
        const tagged = (t) => all.filter(c =>
            Array.isArray(c.tags) && c.tags.indexOf(t) > -1).length;
        switch (key) {
            case 'all':        return all.length;
            case 'favorite':   return (this.props.favoriteUris || []).length;
            case 'blocked':    return (this.props.blockedUris || []).length;
            case 'missed':     return (this.props.missedCalls || []).length;
            case 'messages':   return all.filter(c => Array.isArray(c.tags)
                                   && (c.tags.indexOf('messages') > -1 || c.tags.indexOf('chat') > -1)).length;
            case 'tel':        return tagged('tel');
            case 'autoanswer': return tagged('autoanswer');
            case 'conference': return tagged('conference');
            case 'test':       return tagged('test');
            // Deleted badge is context-dependent:
            //   • Main bar → the COMBINED trash total (Deleted + Graveyard),
            //     so a single pill conveys everything that's been removed.
            //   • Inside the Deleted view → ONLY the soft-deleted count, so the
            //     Deleted and Graveyard chips each report their own bucket.
            // (The two sets are disjoint: Deleted reads allContacts, Graveyard
            // is the deleted=1 tombstones in graveyardCount.)
            case 'deleted': {
                const soft = (this.props.allContacts || [])
                    .filter(c => c && (c.storagePurged || c.deletedTimestamp)).length;
                const grave = this.props.graveyardCount || 0;
                const inDeletedMode = this.state.contactsFilter === 'deleted'
                    || this.state.contactsFilter === 'graveyard';
                return inDeletedMode ? soft : (soft + grave);
            }
            case 'graveyard':  return this.props.graveyardCount || 0;
            // History-derived buckets — mirror the ContactsListBox filters so
            // the badge matches what the view actually shows.
            //   recent → the 7 most recently-active contacts (capped at 7)
            //   calls  → has a last_call_timestamp, excluding conference rooms
            //            (videoconference URIs are dropped from the Calls view)
            case 'recent':
                return Math.min(7, all.filter(c => c && c.timestamp).length);
            case 'calls':      return all.filter(c => c
                                   && c.lastCallTimestamp != null
                                   && (c.uri || '').indexOf('@videoconference.') === -1).length;
            default:           return tagged(key); // custom group tag (e.g. Business)
        }
    };

    // Attach a `count` to each category item so renderNavigationItem can
    // prefix the label. No-op (count omitted) when the per-device toggle
    // showGroupMemberCounts is off.
    _withCategoryCounts = (items) => {
        if (!this.props.showGroupMemberCounts) return items;
        return (items || []).map(it =>
            it.isCustomGroup ? it : ({ ...it, count: this._categoryCount(it.key) }));
    };

    renderNavigationItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let icon = object.item.icon;

        // Member counter prefix (e.g. "100 All", "4 Business"). Driven by the
        // per-device showGroupMemberCounts setting via _withCategoryCounts,
        // which only stamps a numeric `count` on real category items.
        if (this.props.showGroupMemberCounts
                && object.item.count != null
                && object.item.count > 0
                && object.item.enabled) {
            title = object.item.count + ' ' + title;
        }

        // Total contacts counter on the "All" pill — always shown
        // (independent of the showGroupMemberCounts toggle, which only
        // governs the per-category counters). Gives an at-a-glance total
        // of the address book, e.g. "64 All".
        if (key === 'all') {
            const _total = this._categoryCount('all');
            if (_total > 0) {
                title = object.item.title + ' ' + _total;
            }
        }

        // Selected chip background — pin to deep Sylk-blue so the
        // active filter pops against the theme-flipped bar bg.
        // The previous white chip + white bar (in Day mode) read as
        // no chip at all; deep blue gives a strong contrast in both
        // Day (blue chip on white) and Night (blue chip on dark).
        let buttonStyle = object.item.selected
            ? [styles.navigationButtonSelected, { backgroundColor: '#436294' }]
            : styles.navigationButton;
        // Mirror the same Sylk-blue chip on the icon-chip surface
        // (the categoryButtonSelected style still drives the
        // selected pill's shape). Inactive chip is transparent so
        // the unselected icon glyph alone carries the affordance.
        let iconStyle = object.item.selected
            ? [styles.categoryButtonSelected, { backgroundColor: '#436294' }]
            : [styles.categoryButton, { backgroundColor: 'transparent' }];
        // Icon stroke colour. Selected → WHITE on the deep-blue
        // chip (high contrast in both themes). Unselected → theme
        // textPrimary so the glyph is BLACK in Day mode and WHITE
        // in Night mode (no more washed-out "gray" icons against
        // the theme-flipped bar background).
        const _navItemIconColor = object.item.selected
            ? '#FFFFFF'
            : DarkModeManager.getTheme().textPrimary;
        // Label colour for category-navbar Buttons. The bar now uses
        // the theme background (white in Day, dark in Night), so the
        // text colour has to flip with the theme too — otherwise the
        // unselected label would be white-on-white in Day mode.
        //   • Unselected → theme.textPrimary (dark in Day, white in
        //     Night) so the label reads against the bar's bg.
        //   • Selected   → deep Sylk-blue regardless of theme. The
        //     selected pill's white bg (from
        //     styles.navigationButtonSelected) means white text would
        //     also vanish; the Sylk-blue colour keeps the active
        //     filter visible without any further pill restyling.
        // fontWeight: 'normal' tones down Paper Button's default
        // 500-weight label.
        const _theme = DarkModeManager.getTheme();
        // Match the main navbar's subtitle (URI line) styling:
        //   fontSize 12, weight 400, white text, no uppercase / wide
        //   letterSpacing. We keep Paper Button's default
        //   marginVertical (9dp) in place — overriding it to 0
        //   broke the label's vertical centring inside the Button
        //   and shifted the text upward, which the user reported.
        //   Paper's built-in margin is what holds the label on the
        //   row's centerline.
        const _navItemLabelStyle = {
            color: object.item.selected ? '#FFFFFF' : _theme.textPrimary,
            fontWeight: '400',
            letterSpacing: 0,
            textTransform: 'none',
            fontSize: 12,
            // Paper Button's default labelStyle has marginVertical:9
            // which adds ~18 px of vertical padding around the
            // label. Dropped to 4 so the bar can be shorter without
            // touching the font size (per user "keep the font but
            // shrink the bar" request).
            marginVertical: 4,
        };

        // Diagnostic: log once at startup, then only when the bottom-bar
        // button font-size / isTablet actually changes (fold/unfold).
        // Paper's Button uses its default label size (~14pt) unless an
        // explicit labelStyle is supplied.
        const _bbFontSize = (buttonStyle && buttonStyle.fontSize) || 'paper-default(~14)';
        const _bbIsTablet = !!this.props.isTablet;
        const _bbIsFolded = !!this.props.isFolded;
        // Diagnostic (disabled — re-enable to debug bottom-bar fold/font issues):
        // if (this._loggedBBFontSize !== _bbFontSize
        //     || this._loggedBBIsTablet !== _bbIsTablet
        //     || this._loggedBBIsFolded !== _bbIsFolded) {
        //     console.log('[FoldUI] BottomBar font-size',
        //                 this._loggedBBFontSize === undefined ? 'init' : 'change',
        //                 'isFolded=', _bbIsFolded,
        //                 'isTablet=', _bbIsTablet,
        //                 'buttonFontSize=', _bbFontSize);
        //     this._loggedBBFontSize = _bbFontSize;
        //     this._loggedBBIsTablet = _bbIsTablet;
        //     this._loggedBBIsFolded = _bbIsFolded;
        // }

        // Remount key so Paper's <Button> / <IconButton> (which cache
        // their measured frame at the density they were first mounted
        // under) re-measure under the current display density after a
        // fold / unfold transition on foldables like the Razr 60 Ultra.
        // Without this, labels rendered at inner-display density stay
        // visually oversized on the cover display until some unrelated
        // prop change forces an unmount.
        //
        // We include rounded window width/height in the key (matching
        // NavigationBar._navRemountKey) because isFolded + orientation
        // alone did not always change when Android toggled the cover
        // display between "Default View" and "Full Screen" modes — both
        // happen inside the same orientation and isFolded value, yet
        // they change the effective density the bar was measured under.
        // Keying on window dimensions forces a remount on every such
        // transition.
        const _bbWin = Dimensions.get('window');
        const _bbRemountKey = 'bb-' + key
            + '-' + (_bbIsFolded ? 'f' : 'u')
            + '-' + (this.props.orientation || '?')
            + '-' + Math.round(_bbWin.width) + 'x' + Math.round(_bbWin.height);

        if (key === "hideQRCodeScanner") {
            return (<Button key={_bbRemountKey} compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.toggleQRCodeScanner()}}>{title}</Button>);
        }

        if (key === "deleteAudio") {
            return (<Button key={_bbRemountKey} compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.deleteAudio()}}>{title}</Button>);
        }

        if (key === "previewAudio") {
            return (<Button key={_bbRemountKey} compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.previewAudio()}}>{title}</Button>);
        }

        if (key === "sendAudio") {
            return (<Button key={_bbRemountKey} compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.sendAudioFile()}}>{title}</Button>);
        }

        // Sort toggles render as IconButtons too — same compact
        // footprint as the category icons next to them, so the
        // bottom bar fits cleanly on narrow phones now that the
        // Locations filter has pushed the row over the previous
        // text-button budget. accessibilityLabel carries the
        // human-readable title (kept on the categoryItems entry
        // for exactly this purpose) so screen readers still get
        // "Sort: by time" / "Order: ascending" rather than the
        // bare icon name.
        // Sort-axis toggles render as a stacked icon+label so the
        // sort dimension is named explicitly underneath the
        // pictogram. The icons alone (clock / harddisk) didn't
        // communicate "by time" / "by size" reliably — users
        // interpreted the harddisk as a storage device, not a sort
        // axis. The little 9 px caption text fixes that without
        // bringing back the wide text-button look the bar abandoned
        // when Locations was added.
        // Inline styles for the stacked sort-axis layout — kept in
        // this function so the only place ReadyBox imports its
        // styles from (../assets/styles/ReadyBox) doesn't need to
        // grow new entries for an experimental UI tweak.
        //
        // The caption is positioned ABSOLUTELY at the bottom of the
        // column, overlaying the lower edge of the IconButton's
        // built-in padding. This way the icon itself is rendered at
        // its natural position (no upward shift) and the label
        // simply sits on top of the otherwise-empty bottom portion
        // of the IconButton's hit area.
        const _sortAxisColStyle = {
            alignItems: 'center',
            justifyContent: 'center',
            // Width must clear the IconButton's circular footprint.
            // Paper renders IconButton at `size + 16` (≈40 for the
            // old 18 px icons, ≈40 for the bumped 24 px icons since
            // padding scales). 44 gives the icon room to breathe
            // and leaves the caption underneath unclipped.
            width: 44,
            // Extra gutter between adjacent category icons so the
            // row doesn't feel cramped. 6 px on each side =
            // 12 px between two neighbouring icons.
            marginHorizontal: 6,
            // Caption is stacked BELOW the icon (not overlaid). The
            // bar has space for the extra ~10 px of vertical room
            // and reads more clearly with the text on its own row
            // rather than lying on top of the icon's padding area.
        };
        const _sortAxisIconStyle = null; // icon keeps its default sizing
        const _sortAxisLabelStyle = {
            textAlign: 'center',
            fontSize: 9,
            // Theme-aware caption colour. The bar's background now
            // follows theme.background (white in Day, dark in
            // Night), so a hardcoded white caption was invisible
            // in Day. textPrimary flips with the theme: dark on
            // white in Day, white on dark in Night.
            color: _theme.textPrimary,
            // Strong negative top margin to claw back Paper
            // IconButton's intrinsic bottom padding — that padding
            // was leaving a visible gap between the icon and the
            // caption, which the user reported as too much air.
            // -8 px pulls the caption flush under the icon stroke
            // so the chip + label read as one stacked element.
            marginTop: -8,
            backgroundColor: 'transparent',
        };
        // Short caption for each filter / sort key so an overlay
        // label can sit under every icon. Keys not in this map
        // render as plain IconButtons (no caption overlay).
        const _captionByKey = {
            // Sort toggles
            orderByTime: 'Time',
            orderBySize: 'Size',
            orderAscending: 'Asc',
            orderDescending: 'Desc',
            // Filter chips — labels picked to fit the 36 px column
            // at 9 px font (~7 chars). "Place" stands in for the
            // longer "Locations" filter title to keep the row
            // visually uniform. "Pin" / "Pinned" both fit; Pin is
            // shorter and matches the icon meaning.
            text:     'Text',
            links:    'Links',
            audio:    'Audio',
            image:    'Image',
            video:    'Video',
            location: 'Place',
            other:    'Files',
            pinned:   'Pin',
        };
        const _captionForKey = _captionByKey[key];
        if (key === "orderByTime") {
            return (
                <TouchableOpacity
                    key={_bbRemountKey}
                    onPress={() => {
                        this.setState({orderBy: 'size'});
                    }}
                    accessibilityLabel={title}
                    style={_sortAxisColStyle}
                >
                    <IconButton
                        icon={icon || 'clock-outline'}
                        size={20}
                        iconColor={_navItemIconColor}
                        style={[iconStyle, _sortAxisIconStyle]}
                        onPress={() => {
                            this.setState({orderBy: 'size'});
                        }}
                    />
                    <Text style={_sortAxisLabelStyle} numberOfLines={1}>Time</Text>
                </TouchableOpacity>
            );
        }

        if (key === "orderBySize") {
            return (
                <TouchableOpacity
                    key={_bbRemountKey}
                    onPress={() => {
                        this.setState({orderBy: 'timestamp'});
                    }}
                    accessibilityLabel={title}
                    style={_sortAxisColStyle}
                >
                    <IconButton
                        icon={icon || 'harddisk'}
                        size={20}
                        iconColor={_navItemIconColor}
                        style={[iconStyle, _sortAxisIconStyle]}
                        onPress={() => {
                            this.setState({orderBy: 'timestamp'});
                        }}
                    />
                    <Text style={_sortAxisLabelStyle} numberOfLines={1}>Size</Text>
                </TouchableOpacity>
            );
        }

        // Asc / Desc icons get the same icon+caption overlay
        // treatment as Time / Size, with the caption sitting in
        // absolute position at the bottom of the column. Without
        // the labels users couldn't reliably tell whether
        // "ascending" meant oldest-first or newest-first; the
        // captions remove the ambiguity at a glance.
        if (key === "orderAscending") {
            return (
                <TouchableOpacity
                    key={_bbRemountKey}
                    onPress={() => {
                        this.setState({sortOrder: 'desc'});
                    }}
                    accessibilityLabel={title}
                    style={_sortAxisColStyle}
                >
                    <IconButton
                        icon={icon || 'arrow-up'}
                        size={20}
                        iconColor={_navItemIconColor}
                        style={[iconStyle, _sortAxisIconStyle]}
                        onPress={() => {
                            this.setState({sortOrder: 'desc'});
                        }}
                    />
                    <Text style={_sortAxisLabelStyle} numberOfLines={1}>Asc</Text>
                </TouchableOpacity>
            );
        }

        if (key === "orderDescending") {
            return (
                <TouchableOpacity
                    key={_bbRemountKey}
                    onPress={() => {
                        this.setState({sortOrder: 'asc'});
                    }}
                    accessibilityLabel={title}
                    style={_sortAxisColStyle}
                >
                    <IconButton
                        icon={icon || 'arrow-down'}
                        size={20}
                        iconColor={_navItemIconColor}
                        style={[iconStyle, _sortAxisIconStyle]}
                        onPress={() => {
                            this.setState({sortOrder: 'asc'});
                        }}
                    />
                    <Text style={_sortAxisLabelStyle} numberOfLines={1}>Desc</Text>
                </TouchableOpacity>
            );
        }

        if (icon) {
            // If we have a short caption registered for this key,
            // wrap the icon in a column with the caption below.
            // Same pattern the sort toggles use — the icon stays
            // at its natural position and the caption sits on its
            // own row, transparent background, ~9 px text. Without
            // a caption the icon renders bare (kept for keys we
            // don't have a short label for, or for one-off icons
            // added without a caption).
            if (_captionForKey) {
                return (
                    <TouchableOpacity
                        key={_bbRemountKey}
                        onPress={() => {this.filterHistory(key)}}
                        accessibilityLabel={title}
                        style={_sortAxisColStyle}
                    >
                        <IconButton
                            icon={icon}
                            size={20}
                            iconColor={_navItemIconColor}
                            style={[iconStyle, _sortAxisIconStyle]}
                            onPress={() => {this.filterHistory(key)}}
                        />
                        <Text style={_sortAxisLabelStyle} numberOfLines={1}>
                            {_captionForKey}
                        </Text>
                    </TouchableOpacity>
                );
            }
            return (<IconButton
                key={_bbRemountKey}
                icon={icon}
                size={20}
                iconColor={_navItemIconColor}
                style={iconStyle}
                accessibilityLabel={title}
                onPress={() => {this.filterHistory(key)}}
            />);
        }

        // The "All" pill has a very short label, so `compact` renders it
        // cramped. Give it extra width + breathing room around it (a min width,
        // wider horizontal padding, and a little outer margin) so it doesn't
        // read as a tiny chip next to the other category pills.
        const _isAllPill = key === 'all';
        return (<Button key={_bbRemountKey} compact
            style={[buttonStyle, _isAllPill ? { marginHorizontal: 4 } : null]}
            labelStyle={_navItemLabelStyle}
            contentStyle={{ paddingVertical: 0, minHeight: 0, paddingHorizontal: _isAllPill ? 8 : undefined }}
            onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }

    toggleQRCodeScanner(event) {
        //console.log('Scan QR code...');
        this.props.toggleQRCodeScannerFunc();
    }

    QRCodeRead(e) {
        //console.log('QR code object:', e);
        this.props.toggleQRCodeScannerFunc();

        let data = e.data;
        const sipUri = utils.parseSylkCallUrl(data);
        if (sipUri) {
            data = sipUri;
        }

        this.handleSearch(data);
    }

    get showContactsList() {
        if (this.state.recorderState.recording) {
             //return false;
        }

        if (this.state.recorderState.recordingFile) {
             //return false;
        }

        // NOTE: message playback does NOT hide the chat. The player renders as
        // a transparent modal that dims the still-mounted chat, so on dismiss
        // the conversation is exactly where the user left it (same scroll
        // position, no remount). Playback runs through the recorder and never
        // touches renderMessages, so the mounted FlatList doesn't churn.
        return true;
    }

    get showQRCodeButton() {
        return false;
        if (!this.props.canSend()) {
            return false;
        }

        if (this.props.shareToContacts) {
            return false;
        }

        let uri = this.state.targetUri.toLowerCase();
        return uri.length === 0 && !this.props.shareToContacts && !this.props.inviteContacts;
    }



    // --- AudioRecorder forwarders -------------------------------------------
    // The recording subsystem now lives in <AudioRecorder/>. These thin
    // forwarders keep ContactsListBox's props and the header audio buttons
    // working by delegating to the child through its ref.
    onRecorderStateChange(s) {
        this.setState({ recorderState: { ...this.state.recorderState, ...s } });
    }

    recordAudio() {
        const r = this.audioRecorderRef.current;
        if (r) r.recordAudio();
    }

    sendAudioFile() {
        const r = this.audioRecorderRef.current;
        if (r) r.sendAudioFile();
    }

    deleteAudio() {
        const r = this.audioRecorderRef.current;
        if (r) r.deleteAudio();
    }

    previewAudio() {
        const r = this.audioRecorderRef.current;
        if (r) r.previewAudio();
    }

    pausePreviewAudio() {
        const r = this.audioRecorderRef.current;
        if (r) r.pausePreviewAudio();
    }

    startAudioPlayer() {
        const r = this.audioRecorderRef.current;
        try { utils.timestampedLog('[applog] [audio] [RB.startAudioPlayer] -> recorder ref',
            'hasRef=', !!r); } catch (_e) {}
        if (r) r.startAudioPlayer();
    }

    // Shared recorder-flag clearer. Called BOTH by ChatBox (via
    // stopAudioPlayerFunc, at the end of its own stopAudioPlayer) and by the
    // top Stop button's handler below. It must NOT emit SylkStopAudioPlayback:
    // ChatBox.stopAudioPlayer() calls this, so emitting here would re-trigger
    // ChatBox's listener → stopAudioPlayer() → this → emit … a feedback storm.
    // It only clears the recorder's `playRecording` UI flag (hides the button).
    stopAudioPlayer() {
        const r = this.audioRecorderRef.current;
        try { utils.timestampedLog('[applog] [audio] [RB.stopAudioPlayer] clear recorder flag',
            'hasRef=', !!r); } catch (_e) {}
        if (r) r.stopAudioPlayer();
    }

    // Dedicated handler for the top Stop button (SessionButtonsBar). ChatBox —
    // which owns the real player — is nested beyond a ref path (ReadyBox →
    // ContactsListBox → ChatBox), so we reach it via DeviceEventEmitter:
    // ChatBox's SylkStopAudioPlayback listener runs its own stopAudioPlayer()
    // and tears down the native audioRecorderPlayer (that path also calls
    // stopAudioPlayer() above to clear the recorder flag). We ALSO clear the
    // recorder flag directly so the button always dismisses even if ChatBox
    // had nothing playing (a previously-stuck flag). This is only wired to the
    // button, never to ChatBox, so there is no emit feedback loop.
    onTopStopAudioPlayer() {
        try { utils.timestampedLog('[applog] [audio] [RB.onTopStopAudioPlayer] top Stop pressed — emit SylkStopAudioPlayback + clear recorder flag'); } catch (_e) {}
        try { DeviceEventEmitter.emit('SylkStopAudioPlayback'); } catch (_e) {}
        const r = this.audioRecorderRef.current;
        if (r) r.stopAudioPlayer();
    }

    resetContact() {
        // Recording/preview reset now lives in the AudioRecorder child.
        const r = this.audioRecorderRef.current;
        if (r) r.reset();
        this.setState({ searchString: '' });
    }

    
    get showBackToCallButton() {
        if (this.props.shareToContacts) {
			return false;
        }

        if (this.props.isLandscape) {
			return false;
        }
        
        if (this.props.call) {
            if (this.props.call.state !== 'incoming' && this.props.call.state !== 'terminated') {
				return true;
			}
        }

		return false;
    
    }

    render() {
    
        let URIContainerClass = styles.portraitUriInputBox;
        let uriGroupClass = styles.portraitUriButtonGroup;
        let titleClass = styles.portraitTitle;
        
        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            uri = uri_parts[4];
            if (event === 'conference') {
                uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
            }
        }

        if (this.props.isTablet) {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTabletTitle : styles.portraitTabletTitle;
        } else {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTitle : styles.portraitTitle;
        }

        if (this.props.isTablet) {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriButtonGroup : styles.portraitTabletUriButtonGroup;
        } else {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeUriButtonGroup : styles.portraitUriButtonGroup;
        }

        if (this.props.isTablet) {
            URIContainerClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriInputBox : styles.portraitTabletUriInputBox;
        } else {
            URIContainerClass = styles.portraitUriInputBox;
        }
        
        URIContainerClass = styles.portraitUriInputBox;

        const historyContainer = this.props.orientation === 'landscape' ? styles.historyLandscapeContainer : styles.historyPortraitContainer;
        const buttonGroupClass = this.props.orientation === 'landscape' ? styles.buttonGroup : styles.buttonGroup;
        const borderClass = this.state.chat ? null : styles.historyBorder;
        let backButtonTitle = 'Back to call';

		let { width, height } = Dimensions.get('window');

		const topInset = this.props.insets?.top || 0;
		const bottomInset = this.props.insets?.bottom || 0;
		const leftInset = this.props.insets?.left || 0;
		const rightInset = this.props.insets?.right || 0;
		
		const marginRight = this.props.isLandscape ? rightInset : 0;

		let containerWidth = width - marginRight;
		let containerHeight = height;
		
		// Recents-bar wrapper. In folded mode the app-level bottom margin
		// is intentionally 0 (so dark_linen doesn't show a gray strip
		// below the bar on the Razr cover display). That would let the
		// Android system/gesture bar draw on top of our buttons, so we
		// pad the bar's wrapper by the bottom inset to lift the buttons
		// above the system overlay. Folded cover display has heavy camera
		// cutouts that already obscure the upper portion, so the bar
		// sitting slightly higher is acceptable.
		// Fixed-height search/sort bar.
		//
		// `minHeight: 44` locks the bar to the standard iOS tap-target
		// height (Material spec is 48; 44 reads as the comfortable
		// shared baseline) so the row never collapses to its content
		// height. Without this, dropping the sort-order chips (e.g.
		// when `this.categorySortItems` is empty for a given view, or
		// when the filter chips list yields nothing visible) would
		// shrink the bar to the contact-source pills' intrinsic
		// height alone, jumping the contacts list up under the
		// search input by ~16-20 px and re-flowing the layout. Pinning
		// minHeight here keeps the bar a fixed slab regardless of
		// what's rendered inside it. `justifyContent: 'center'` keeps
		// whatever IS visible vertically centered in that slab.
		// Pull the active theme. The sort/order bar now follows the
		// theme background colour (white in Day, dark in Night)
		// rather than the fixed Sylk-blue chrome it used to carry —
		// the user wants this row to blend with the surrounding
		// screen surface instead of reading as a second coloured
		// header band beneath the navbar.
		const _readyBoxTheme = DarkModeManager.getTheme();
		let navigationContainer = {borderWidth: 0,
						   borderColor: 'blue',
						   backgroundColor: _readyBoxTheme.background,
						   // Floor (not cap) the bar height. The same
						   // `navigationContainer` style is used by
						   // multiple rows:
						   //   • top sort/category pill bar — pills
						   //     at icon size 20 + 9pt caption ≈ 46dp
						   //   • in-chat media-filter bar — same
						   //     pattern, sometimes with two-line
						   //     chips or a divider+sort cluster
						   //     that needs a bit more room
						   //   • bottom recents bar — has its own
						   //     `height: 38` override at the call
						   //     site so it stays tighter
						   // `minHeight: 50` guarantees the pill row
						   // doesn't collapse under its content, but
						   // lets the in-chat variant grow to fit
						   // when its chip cluster wants more room.
						   minHeight: 50,
						   justifyContent: 'center',
						   paddingBottom: this.props.isFolded ? bottomInset : 0
						   }
	
		let containerExtraStyles = {
//						   width: containerWidth,
//						   marginRight: marginRight,
						   borderWidth: 0,
						   borderColor: 'red'
						   }

        /*
		if (Platform.OS === 'ios') {
			if (this.props.isLandscape) {
				containerExtraStyles.width = containerWidth - rightInset;
				containerExtraStyles.marginBottom = -bottomInset;	
			}
		} else {
			if (this.props.isLandscape) {
				containerExtraStyles.width = containerWidth;
				containerExtraStyles.marginBottom = -rightInset;
			}
		}
		*/
                
        //console.log('this.props.call', this.props.call);
        if (this.showBackToCallButton) {
            if (this.props.call.hasOwnProperty('_participants')) {
                backButtonTitle = this.props.selectedContacts.length > 0 ? 'Invite people' : 'Back to conference';
            } else {
                backButtonTitle = this.props.selectedContacts.length > 0 ? 'Invite people' : 'Back to call';
            }
        }

        // Button color classes are module-level constants (see top of file) —
        // only recordIcon / activityTitle below are state-dependent.
        let recordIcon               = this.state.recorderState.recording ? 'pause' : 'microphone';
        let activityTitle            = this.state.recorderState.recording ? "Recording audio" : "Audio recording ready";
        
        const sharedContent = this.props.sharedContent || [];
        
		const hasImages = sharedContent.some(
		  file => typeof file.mimeType === 'string' && file.mimeType.startsWith('image/')
		);
		// The "Full size" toggle is relevant for anything the upload pipeline
		// can shrink — images AND videos — not just images. Without this, a
		// shared video gave the user no way to control compression.
		const hasCompressible = sharedContent.some(
		  file => typeof file.mimeType === 'string'
		    && (file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/'))
		);

        // The legacy `fileTransfersDisabled` flag — true for contacts
        // tagged `test`, for `@videoconference` URIs, and for
        // `@conference` URIs — used to greying-out the mic button in
        // the call-buttons row. Those four cases are now handled
        // inside showAudioRecordButton (which HIDES the button for
        // each of them) so the disabled-but-visible state is gone.
        // The flag is no longer computed because nothing else read it.

        // Permanent warning when we know the account has no local private
        // key. The ImportPrivateKeyModal offers restore/generate options on
        // first login but users can dismiss it without acting, which leaves
        // them on an effectively useless messaging screen. The banner is
        // state-gated (see _syncNoPrivateKeyWarning) so it only appears
        // after the modal has been dismissed AND a short grace period has
        // passed — never stacked underneath the modal, never flashed at
        // login. Render also hides it while inside a selected chat so the
        // main list is the only surface that shows it.
        const showNoPrivateKeyWarning = (
            this.state.showNoPrivateKeyWarning &&
            this.props.account &&
            !this.props.showImportPrivateKeyModal &&
            !this.props.selectedContact
        );

        return (
            <Fragment>
                <View style={[styles.container, containerExtraStyles]}>
                    {showNoPrivateKeyWarning ?
                    <View
                        accessibilityRole="alert"
                        style={{
                            backgroundColor: '#c62828',
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            borderBottomWidth: 1,
                            borderBottomColor: '#8e0000',
                        }}
                    >
                        <Text style={{color: 'white', fontWeight: 'bold', fontSize: 14, marginBottom: 2}}>
                            No private key on this device
                        </Text>
                        <Text style={{color: 'white', fontSize: 13}}>
                            To use messaging, you need a private key. Go to Menu {'>'} My private key and select an option to restore or generate a private key.
                        </Text>
                    </View>
                    : null}
                    {/* Outer wrapper of the order/category navbar.
                        IMPORTANT: despite the original comment and
                        appearance, this <View> does NOT only wrap the
                        sort-bar — its closing tag is way down at the
                        end of the header+body section (it encloses
                        the search bar, the call-buttons row, the
                        contacts list, etc.). So a fixed `height: 44`
                        here clipped the entire stack to 44dp the
                        moment `showCategoryBar` flipped on, which is
                        why the search bar and contacts list
                        "disappeared" under search-contacts mode.
                        Leave this wrapper unconstrained; the sort
                        bar's own height pinning happens on the
                        inner `navigationContainer` View further down
                        (via `minHeight`). */}
                    <View>
                    {this.showCategoryBar && this.props.selectedContact ?
                        <ChatFilterSortBar
                            visible={true}
                            hasSelectedContact={!!this.props.selectedContact}
                            navigationContainerStyle={navigationContainer}
                            contentContainerStyle={styles.navigationButtonGroup}
                            filterItems={this.categoryFilterItems}
                            sortItems={this.categorySortItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
                        : null}


                        {/* Invite-to-conference and share-to-contacts
                            modes need the search bar BELOW the
                            Cancel/Invite action pair, glued to the
                            top of the ContactsListBox — that's where
                            the user wants to filter the picker list
                            with the action affordances always visible
                            above it. The relocated copy is rendered
                            further down, immediately before the
                            <ContactsListBox> element. Skipping the
                            normal-position render here avoids a
                            duplicate bar. */}
                        {this.showSearchBar && !(this.props.inviteContacts || this.props.shareToContacts) ?
                        <SearchBar
                            containerStyle={URIContainerClass}
                            defaultValue={this.props.searchMessages ? this.state.searchString : this.state.targetUri}
                            onChange={this.handleSearch}
                            onSelect={this.handleTargetSelect}
                            shareToContacts={this.props.shareToContacts}
                            inviteContacts={this.props.inviteContacts}
                            searchMessages={this.props.searchMessages}
                            contactSource={this.state.contactSource}
                            onCloseSearch={
                                (this.props.isFolded
                                    && this.props.searchContacts
                                    && typeof this.props.toggleSearchContacts === 'function')
                                    ? this.props.toggleSearchContacts
                                    : undefined
                            }
                            showDialpad={
                                !this.props.shareToContacts
                                && !this.props.inviteContacts
                                && !this.props.searchMessages
                                && !this.props.showQRCodeScanner
                            }
                            isDialpadActive={this.state.showAbDialpad}
                            onDialpadPress={this.toggleAbDialpad}
                            showQr={
                                !this.props.shareToContacts
                                && !this.props.inviteContacts
                                && !this.props.searchMessages
                            }
                            onQrPress={this.toggleQRCodeScanner}
                            autoFocus={false}
                            dark={this.props.dark}
                            showDialpadExpansion={
                                this.state.showAbDialpad
                                && !this.props.shareToContacts
                                && !this.props.inviteContacts
                                && !this.props.searchMessages
                            }
                            onDialpadDigit={this.handleAbDialpadDigit}
                            onDialpadBackspace={this.handleAbDialpadBackspace}
                            onDialpadClear={() => this.handleSearch('')}
                        />
                        : null}

                           {/* Inline Back-to-call button removed: now rendered
                               as a floating overlay near the bottom of the
                               render output so it doesn't shift the chat
                               layout (and therefore the keyboard offset)
                               every time a call starts/ends. See the
                               floating-back-to-call block at the end of
                               render(). */}

                        <SessionButtonsBar
                            visible={this.showButtonsBar}
                            isFolded={this.props.isFolded}
                            uriGroupClass={uriGroupClass}
                            buttonGroupClass={buttonGroupClass}
                            styles={styles}

                            selectedContact={this.props.selectedContact}
                            shareToContacts={this.props.shareToContacts}
                            inviteContacts={this.props.inviteContacts}

                            greenButtonClass={greenButtonClass}
                            disabledGreenButtonClass={disabledGreenButtonClass}
                            blueButtonClass={blueButtonClass}
                            disabledBlueButtonClass={disabledBlueButtonClass}
                            redButtonClass={redButtonClass}
                            purpleButtonClass={purpleButtonClass}
                            recordIcon={recordIcon}

                            showCallButtons={this.showCallButtons}
                            showAudioRecordButton={this.showAudioRecordButton}
                            showLocationShareButton={this.showLocationShareButton}
                            showAudioDeleteButton={this.showAudioDeleteButton}
                            showAudioStopButton={this.showAudioStopButton}
                            showConferenceButton={this.showConferenceButton}
                            showAudioSendButton={this.showAudioSendButton}
                            showQRCodeButton={this.showQRCodeButton}

                            chatButtonDisabled={this.chatButtonDisabled}
                            callButtonDisabled={this.callButtonDisabled}
                            videoButtonDisabled={this.videoButtonDisabled}
                            conferenceButtonDisabled={this.conferenceButtonDisabled}

                            isSharingCurrentContact={this._isSharingCurrentContact(this.props)}
                            locationSharePulse={this._locationSharePulse}
                            recordingFile={this.state.recorderState.recordingFile}

                            onChat={this.handleChat}
                            onAudioCall={this.handleAudioCall}
                            onVideoCall={this.handleVideoCall}
                            onRecordAudio={this.recordAudio}
                            onShareLocation={this.handleShareLocation}
                            onDeleteAudio={this.deleteAudio}
                            onStopAudioPlayer={this.onTopStopAudioPlayer}
                            onCancelShareContent={this.cancelShareContent}
                            onShowConferenceModal={this.showConferenceModal}
                            onSendAudioFile={this.sendAudioFile}
                            onShareContent={this.shareContent}
                            onToggleQRCodeScanner={this.toggleQRCodeScanner}
                        />

                    </View>

					  {(this.props.autoAnswerMode && !this.props.selectedContact) ?
					  <View style={{borderColor: 'white', 
					        borderWidth: 0.25, 
					        flexDirection: 'row',
							justifyContent: 'center',
							padding: 5,
							alignItems: 'center'}}>
							<Text style={styles.autoAnswer}>Hands-Free Caregiver Calls</Text>
					  </View>
					  :  null}

					  { (this.props.shareToContacts && hasCompressible) ?
					  <View style={{borderColor: 'white', 
					        borderWidth: 0.25, 
					        flexDirection: 'row',
							justifyContent: 'center',
							padding: 5,
							alignItems: 'center'}}>
								<Switch
								  value={!this.props.resizeContent}
								  onValueChange={() => this.props.toggleResizeContent()}
								/>

							<Text style={styles.resize}>Full size</Text>
					  </View>
					  :  null}


                    {/* Voice-message recorder: armed screen, live recording,
                        and preview/send UI. Extracted from ReadyBox. Self-gates
                        on its own state; renders null when idle. */}
                    <AudioRecorder
                        ref={this.audioRecorderRef}
                        selectedContact={this.props.selectedContact}
                        requestMicPermission={this.props.requestMicPermission}
                        refreshMicPermission={this._refreshMicPermission}
                        file2GiftedChat={this.props.file2GiftedChat}
                        sendMessage={this.props.sendMessage}
                        sendPeaksMessage={this.props.sendPeaksMessage}
                        getMessages={this.props.getMessages}
                        vibrate={this.props.vibrate}
                        playRecording={this.props.playRecording}
                        recordingDuration={this.props.recordingDuration}
                        onStateChange={this.onRecorderStateChange}
                    />
                    {this.showContactsList ?
                    <View style={[historyContainer, borderClass]}>

                   <ContactsListBanners
                       selectedContact={this.props.selectedContact}
                       shareToContacts={this.props.shareToContacts}
                       inviteContacts={this.props.inviteContacts}
                       searchMessages={this.props.searchMessages}
                       showQRCodeScanner={this.props.showQRCodeScanner}
                       contactsSyncing={this.props.contactsSyncing}
                       storageUpToDate={this.props.storageUpToDate}
                       appDnd={this.props.appDnd}
                       onToggleDnd={this.props.toggleDnd}
                       contactSource={this.state.contactSource}
                       abPermissionDenied={this.props.abPermissionDenied}
                       onOpenAppSettings={this.props.openAppSettings}
                   />

                   {/* Invite / share search bar — relocated copy.
                       In normal modes the URIInput renders near the
                       top (just under the categories row); in
                       invite-to-conference and share-to-contacts
                       modes the user wants it sitting flush against
                       the contacts list so the action pair above
                       (Cancel / Invite or Cancel / Share) stays put
                       while the picker scrolls. Identical props to
                       the upper render — dialpad-overlay branches
                       are gated off because they only apply to the
                       AddressBook source in non-invite/share modes.
                       Rendered OUTSIDE the QR-scanner branch so the
                       bar still appears above the list (the scanner
                       is a parallel sibling that replaces the list,
                       not a wrapper around it — but invite/share
                       modes never enter the scanner branch since
                       showQRCodeScanner is gated on
                       !inviteContacts / !shareToContacts upstream). */}
                   {this.showSearchBar && (this.props.inviteContacts || this.props.shareToContacts) ?
                   <SearchBar
                       containerStyle={URIContainerClass}
                       defaultValue={this.props.searchMessages ? this.state.searchString : this.state.targetUri}
                       onChange={this.handleSearch}
                       onSelect={this.handleTargetSelect}
                       shareToContacts={this.props.shareToContacts}
                       inviteContacts={this.props.inviteContacts}
                       searchMessages={this.props.searchMessages}
                       contactSource={this.state.contactSource}
                       showDialpad={
                           this.props.inviteContacts
                           && !this.props.shareToContacts
                           && !this.props.searchMessages
                           && !this.props.keyboardVisible
                       }
                       isDialpadActive={this.state.showAbDialpad}
                       onDialpadPress={this.toggleAbDialpad}
                       autoFocus={false}
                       dark={this.props.dark}
                       inviteEnabled={!!(this.props.selectedContacts && this.props.selectedContacts.length > 0)}
                       onInvitePress={this.props.goBackFunc}
                       onCancelInvitePress={this.props.finishInvite}
                       showDialpadExpansion={
                           this.props.inviteContacts
                           && this.state.showAbDialpad
                           && !this.props.shareToContacts
                           && !this.props.searchMessages
                           && !this.props.keyboardVisible
                       }
                       onDialpadDigit={this.handleAbDialpadDigit}
                       onDialpadBackspace={this.handleAbDialpadBackspace}
                   />
                   : null}

                   {this.props.showQRCodeScanner ?
                    <QRCodeScanner
                        onRead={this.QRCodeRead}
                        showMarker={true}
                        flashMode={RNCamera.Constants.FlashMode.off}
                        containerStyle={containerStyles.QRCodeScanner}
                     />
                      :
					<ContactsListBox
						allContacts={this.props.allContacts}
						graveyardContacts={this.props.graveyardContacts}
						reviveContact={this.props.reviveContact}
						blockDeletedContact={this.props.blockDeletedContact}
						ejectContact={this.props.ejectContact}
						hardDeleteContacts={this.props.hardDeleteContacts}
						contactHasStoredMessages={this.props.contactHasStoredMessages}
						contacts={this.props.addressBookContacts}
						targetUri={this.state.targetUri}
						fontScale = {this.props.fontScale}
						orientation={this.props.orientation}
						setTargetUri={this.handleSearch}
						selectedContact={this.props.selectedContact}
						isTablet={this.props.isTablet}
						chat={this.state.chat && !this.props.inviteContacts}
						isLandscape={this.props.isLandscape}
						contactSource={this.state.contactSource}
						/* Measured Appbar.Header height from app.js
						   (sourced from NavigationBar.onLayout) — used
						   inside ContactsListBox as the chrome
						   component of keyboardVerticalOffset. */
						appBarHeight={this.props.appBarHeight}
						account={this.props.account}
						password={this.props.password}
						callHistoryUrl={this.props.callHistoryUrl}
						refreshHistory={this.props.refreshHistory}
						refreshAccountInfo={this.props.refreshAccountInfo}
						refreshFavorites={this.props.refreshFavorites}
						localHistory={this.props.localHistory}
						saveHistory={this.props.saveHistory}
						openCallTrace={this.props.openCallTrace}
						openQosSummary={this.props.openQosSummary}
						fetchServerHistory={this.props.fetchServerHistory}
						myDisplayName={this.props.myDisplayName}
						myPhoneNumber={this.props.myPhoneNumber}
						saveConference={this.props.saveConference}
						myInvitedParties = {this.props.myInvitedParties}
						favoriteUris={this.props.favoriteUris}
						blockedUris={this.props.blockedUris}
						contactsFilter={this.state.contactsFilter}
						periodFilter={this.state.historyPeriodFilter}
						defaultDomain={this.props.defaultDomain}
						allContacts = {this.props.allContacts}
						messages = {this.props.messages}
						contactMessages = {this.props.contactMessages}
						sendMessage = {this.props.sendMessage}
						reSendMessage = {this.props.reSendMessage}
						deleteMessages = {this.props.deleteMessages}
						expireMessage = {this.props.expireMessage}
						deleteMessage = {this.props.deleteMessage}
						deleteFiles = {this.props.deleteFiles}
						getMessages = {this.props.getMessages}
						getContactDateIndex = {this.props.getContactDateIndex}
						pinMessage = {this.props.pinMessage}
						unpinMessage = {this.props.unpinMessage}
						confirmRead = {this.props.confirmRead}
						inviteContacts = {this.props.inviteContacts}
						shareToContacts = {this.props.shareToContacts}
						selectedContacts = {this.props.selectedContacts}
						mergeKeeperId = {this.props.mergeKeeperId}
						contactSelectMode = {this.props.contactSelectMode}
						onLongPressContact = {this.handleLongPressContact}
						toggleFavorite={this.props.toggleFavorite}
						toggleAutoanswer={this.props.toggleAutoanswer}
						toggleBlocked={this.props.toggleBlocked}
						togglePinned = {this.props.togglePinned}
						pinned = {this.props.pinned}
						loadEarlierMessages = {this.props.loadEarlierMessages}
						newContactFunc = {this.props.newContactFunc}
						messageZoomFactor = {this.props.messageZoomFactor}
						isTyping = {this.props.isTyping}
						call = {this.props.call}
						keys = {this.props.keys}
						downloadFile = {this.props.downloadFile}
						autoDownloadFile = {this.props.autoDownloadFile}
						uploadFile = {this.props.uploadFile}
						decryptFunc = {this.props.decryptFunc}
						openLogAttachment = {this.props.openLogAttachment}
						messagesCategoryFilter = {this.state.messagesCategoryFilter}
						isTexting = {this.props.isTexting}
						forwardMessagesFunc = {this.props.forwardMessagesFunc}
						requestCameraPermission = {this.props.requestCameraPermission}
						requestStoragePermissions = {this.props.requestStoragePermissions}
						requestMicPermission = {this.props.requestMicPermission}
						requestStoragePermission = {this.props.requestStoragePermission}
						startCall = {this.props.startCall}
						sourceContact = {this.props.sourceContact}
						file2GiftedChat = {this.props.file2GiftedChat}
						postSystemNotification = {this.props.postSystemNotification}
						orderBy = {this.state.orderBy}
						sortOrder = {this.state.sortOrder}
						toggleSearchMessages = {this.props.toggleSearchMessages}
						searchMessages = {this.props.searchMessages}
						searchString = {this.state.searchString}
						clearMessageSearch = {this.clearMessageSearch}
						clearMessageCategoryFilter = {this.clearMessageCategoryFilter}
						recordAudio = {this.recordAudio}
						/* Same per-contact / per-state gate the header
						   "Record audio" button uses (showAudioRecordButton).
						   The chat input-bar mic must respect it too —
						   otherwise contacts that can't receive a voice memo
						   (conference rooms, anonymous, phone numbers, test
						   stubs, denied mic permission, or an active call)
						   would still expose a tappable mic in the composer. */
						canRecordAudio = {this.showAudioRecordButton}
						defaultConferenceDomain = {this.props.defaultConferenceDomain}
						dark = {this.props.dark}
						messagesMetadata = {this.props.messagesMetadata}
						messagesMetadataById = {this.props.messagesMetadataById}
						messagesMetadataByOriginalId = {this.props.messagesMetadataByOriginalId}
						chatScrollTrigger = {this.props.chatScrollTrigger}
						localOwnerCoordsByMid = {this.props.localOwnerCoordsByMid}
						activeRemoteSharesByUri = {this.props.activeRemoteSharesByUri}
						contactStartShare = {this.props.contactStartShare}
						contactStopShare = {this.props.contactStopShare}
						acceptMeetingRequest = {this.props.acceptMeetingRequest}
						promptMeetingRequest = {this.props.promptMeetingRequest}
						isMeetingRequestAcceptable = {this.props.isMeetingRequestAcceptable}
						pauseLocationShare = {this.props.pauseLocationShare}
						resumeLocationShare = {this.props.resumeLocationShare}
						getLocationShareState = {this.props.getLocationShareState}
						canSend = {this.props.canSend}
						meetMeAt = {this.props.meetMeAt}
						setFullScreen = {this.props.setFullScreen}
						setChatReactionMode = {this.props.setChatReactionMode}
						fullScreen = {this.props.fullScreen}
						transferProgress = {this.props.transferProgress}
						totalMessageExceeded = {this.props.totalMessageExceeded}
						requestDndPermission = {this.props.requestDndPermission}
						gettingSharedAsset = {this.state.gettingSharedAsset}
						startAudioPlayerFunc = {this.startAudioPlayer}
						stopAudioPlayerFunc = {this.stopAudioPlayer}
						markAudioMessageDisplayedFunc = {this.props.markAudioMessageDisplayed}
						playRecording = {this.state.recorderState.playRecording}
						updateFileTransferMetadata = {this.props.updateFileTransferMetadata}
						isAudioRecording = {this.state.recorderState.recording || this.state.recorderState.recordArmed}
						audioArmed = {this.state.recorderState.recordArmed && !this.state.recorderState.recording}
						recordingFile = {this.state.recorderState.recordingFile}
						sendAudioFile = {this.sendAudioFile}
						insets = {this.props.insets}
						appState = {this.props.appState}
					/>
					}

                    <ContactSelectFab
                        visible={this.props.contactSelectMode}
                        selectedCount={(this.props.selectedContacts || []).length}
                        contactsFilter={this.state.contactsFilter}
                        searchContacts={this.props.searchContacts}
                        onCancel={this.props.exitContactSelectMode}
                        onRestore={this.handleBulkRestore}
                        onMerge={this.handleBulkMerge}
                        onDelete={this.handleContactDelete}
                    />

                    </View>
                    : null
                    }

                    <ContactsCategoryBar
                        visible={this.showNavigationBar && !this.props.selectedContact}
                        isFolded={this.props.isFolded}
                        orientation={this.props.orientation}
                        width={width}
                        height={height}
                        contactsFilter={this.state.contactsFilter}
                        navigationContainerStyle={navigationContainer}
                        contentContainerStyle={styles.navigationButtonGroup}
                        data={this.navigationItems}
                        extraData={this.state}
                        keyExtractor={(item, index) => item.key}
                        renderItem={this.renderNavigationItem}
                        onListRef={(ref) => { this.navigationRefMain = ref; }}
                    />



                </View>

                <ConferenceModal
                    show={this.props.showConferenceModal}
                    targetUri={this.props.remoteConferenceRoom || uri}
                    defaultDomain={this.props.remoteConferenceDomain || this.props.defaultDomain}
                    myInvitedParties={this.props.myInvitedParties}
                    selectedContact={this.props.selectedContact}
                    handleConferenceCall={this.handleConferenceCall}
                    accountId={this.props.account ? this.props.account.id: null}
                    lookupContacts={this.props.lookupContacts}
					defaultConferenceDomain = {this.props.defaultConferenceDomain}
                    /* Per-domain conference configuration. The modal
                       reads conferenceSettings.pstnBridge to show the
                       PSTN access-number under the "Allow calling
                       from telephones" toggle when the bridge is
                       defined. Falls through harmlessly when the
                       server doesn't expose a bridge. */
                    conferenceSettings = {this.props.conferenceSettings}
                />

                {/* Bulk-delete confirmation (Deleted "Delete permanently"
                    / Graveyard "Delete forever"). Vertically stacked
                    buttons so the panel never overflows the right margin
                    in portrait. */}
                <ConfirmActionModal
                    visible={!!this.state.confirmDialog}
                    title={this.state.confirmDialog ? this.state.confirmDialog.title : ''}
                    message={this.state.confirmDialog ? this.state.confirmDialog.message : ''}
                    actions={this.state.confirmDialog ? this.state.confirmDialog.actions : []}
                    onDismiss={this.closeConfirmDialog}
                />
            </Fragment>
        );
    }
}

ReadyBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    callHistoryUrl  : PropTypes.string,
    startCall       : PropTypes.func.isRequired,
    startConference : PropTypes.func.isRequired,
    startLocationShare: PropTypes.func,
    // { [uri]: expiresAtMs } — mirrored from NavigationBar. Drives the
    // chat-header pin's pulse + red tint while the current chat is
    // sharing. Optional; treated as empty if not passed.
    activeLocationShares: PropTypes.object,
    orientation     : PropTypes.string,
    // Per-device toggle: prefix each category/group pill with its member count.
    showGroupMemberCounts: PropTypes.bool,
    isTablet        : PropTypes.bool,
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    refreshFavorites: PropTypes.bool,
    saveHistory     : PropTypes.func,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    toggleFavorite  : PropTypes.func,
	toggleAutoanswer: PropTypes.func,
    myInvitedParties: PropTypes.object,
    toggleBlocked   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    defaultDomain   : PropTypes.string,
    // Per-domain conference configuration (codec, pstnBridge,
    // sipBridge). Forwarded to ConferenceModal which surfaces the
    // pstnBridge phone number below the "Allow calling from
    // telephones" toggle when defined.
    conferenceSettings: PropTypes.object,
    selectContact   : PropTypes.func,
    lookupContacts  : PropTypes.func,
    call            : PropTypes.object,
    goBackFunc      : PropTypes.func,
    messages        : PropTypes.object,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    confirmRead     : PropTypes.func,
    deleteMessage   : PropTypes.func,
    // Bulk file deletion — wired down to ContactsListBox so the
    // video-grid selection bar can invoke the same SQL+remote
    // delete path the NavigationBar Delete-files modal uses.
    deleteFiles     : PropTypes.func,
    expireMessage   : PropTypes.func,
    getMessages     : PropTypes.func,
    deleteMessages  : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    inviteContacts  : PropTypes.bool,
    shareToContacts  : PropTypes.bool,
    showQRCodeScanner      : PropTypes.bool,
    selectedContacts: PropTypes.array,
    mergeContacts   : PropTypes.func,
    updateSelection : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    missedCalls     : PropTypes.array,
    messageZoomFactor: PropTypes.string,
    isTyping:      PropTypes.bool,
    navigationItems: PropTypes.object,
    showConferenceModal: PropTypes.bool,
    showConferenceModalFunc: PropTypes.func,
    hideConferenceModalFunc: PropTypes.func,
    shareContent:  PropTypes.func,
    cancelShareContent: PropTypes.func,
    filterHistoryFunc:  PropTypes.func,
    historyFilter: PropTypes.string,
    fontScale: PropTypes.number,
    inviteToConferenceFunc: PropTypes.func,
    // Drops out of the contacts-list invite mode without going
    // back to the conference and without sending any invites.
    // Wired in app.js to finishInviteToConference, which clears
    // inviteContacts + selectedContacts. Used by the Cancel
    // button in the invite-mode action pair above.
    finishInvite: PropTypes.func,
    toggleQRCodeScannerFunc: PropTypes.func,
    allContacts: PropTypes.array,
    // Invoked every time the user taps the Phonebook source pill.
    // Behaviour on the app.js side:
    //   • If permission is already authorized AND contacts have
    //     been fetched → no-op.
    //   • If permission is already authorized BUT contacts haven't
    //     been fetched → run getABContacts.
    //   • If permission is NOT authorized → re-prompt the user.
    // This makes each Phonebook tap re-ask for permission until the
    // user grants it (or hits the OS-level "don't ask again" cap).
    loadPhoneAddressBook: PropTypes.func,
    // True when the OS contacts permission is currently denied (or
    // in the OS-level "don't ask again" state where re-requesting
    // is a silent no-op). Drives the inline "Phonebook access is
    // off — Open Settings" banner rendered above the contacts list
    // while the Phonebook source pill is selected.
    abPermissionDenied: PropTypes.bool,
    // Opens the OS-level Sylk app preferences page so the user can
    // toggle contacts permission on after a denial. Wired by app.js
    // to react-native-permissions's openSettings() helper (the same
    // one the NavigationBar 'appSettings' menu item uses).
    openAppSettings: PropTypes.func,
    // In-app DND state (state.accountSetting.privacy.dnd in app.js).
    // When true, ReadyBox renders a persistent pill above the contacts
    // list so the user always sees that incoming calls will arrive
    // silently. Tapping the pill calls toggleDnd to flip DND off.
    appDnd: PropTypes.bool,
    toggleDnd: PropTypes.func,
    keys            : PropTypes.object,
    keyStatus       : PropTypes.object,
    showImportPrivateKeyModal : PropTypes.bool,
    downloadFile    : PropTypes.func,
    uploadFile: PropTypes.func,
    decryptFunc     : PropTypes.func,
    isTexting       :PropTypes.bool,
    keyboardVisible: PropTypes.bool,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func,
    forwardMessagesFunc: PropTypes.func,
    sourceContact: PropTypes.object,
    requestCameraPermission: PropTypes.func,
    requestStoragePermissions: PropTypes.func,
    requestDndPermission: PropTypes.func,
    requestMicPermission: PropTypes.func,
    postSystemNotification: PropTypes.func,
    toggleSearchMessages: PropTypes.func,
    toggleSearchContacts: PropTypes.func,
    searchMessages: PropTypes.bool,
    searchContacts: PropTypes.bool,
    defaultConferenceDomain: PropTypes.string,
    dark: PropTypes.bool,
    messagesMetadata: PropTypes.object,
    file2GiftedChat : PropTypes.func,
    appBarHeight    : PropTypes.number,
    contactStartShare: PropTypes.func,
    contactStopShare: PropTypes.func,
	contactIsSharing: PropTypes.bool,
    acceptMeetingRequest: PropTypes.func,
    isMeetingRequestAcceptable: PropTypes.func,
    setFullScreen: PropTypes.func,
    fullScreen: PropTypes.bool,
    transferProgress: PropTypes.object,
    totalMessageExceeded: PropTypes.bool,
    createChatContact: PropTypes.func,
	selectAudioDevice: PropTypes.func,
	updateFileTransferMetadata: PropTypes.func,
	insets: PropTypes.object,
	vibrate: PropTypes.func,
	toggleResizeContent: PropTypes.func,
	resizeContent: PropTypes.bool,
	sharedContent: PropTypes.array,
	autoAnswerMode: PropTypes.bool,
	hasAutoAnswerContacts: PropTypes.bool,
	appState: PropTypes.string,
	remoteConferenceRoom: PropTypes.string,
	remoteConferenceDomain: PropTypes.string,
	addressBookContacts: PropTypes.array,
};

export default ReadyBox;
