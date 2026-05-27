import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { FlatList, View, Platform, StyleSheet, TouchableHighlight, TouchableOpacity, Dimensions, Animated, Easing, DeviceEventEmitter, NativeModules, AppState} from 'react-native';
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
import { IconButton, Title, Button, Colors, Text, ActivityIndicator, Switch, Checkbox } from 'react-native-paper';
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

import { red } from '../colors';
import DarkModeManager from '../DarkModeManager';

import ConferenceModal from './ConferenceModal';
import ContactsListBox from './ContactsListBox';

import FooterBox from './FooterBox';
import URIInput from './URIInput';
import { DTMFPad } from './DTMFModal';
import utils from '../utils';
import {Keyboard} from 'react-native';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';
import AudioWaveform from './AudioWaveform';
import VuMeter from './VuMeter';
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


class ReadyBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.recordingStopTimer = null;

        // Drives the pulsing opacity on the chat-header "Share location"
        // pin when the current contact has an active live share. Matches
        // the NavBar indicator's breathe pattern (700ms sine-in-out,
        // 1.0 → 0.35) so the two feel like the same signal — except only
        // one of them is visible at a time (the NavBar one hides while
        // we're inside the chat; see NavigationBar render).
        this._locationSharePulse = new Animated.Value(1);
        this._locationSharePulseLoop = null;

        this.state = {
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : '',
            sticky: false,
            contactsFilter: null,
            messagesCategoryFilter: null,
            historyPeriodFilter: null,
            participants: null,
            chat: (this.props.selectedContact !== null) && (this.props.call !== null),
            isTyping: this.props.isTyping,
            navigationItems: this.props.navigationItems,
            keys: this.props.keys,
			searchMessages: this.props.searchMessages,
			searchContacts: this.props.searchContacts,
			searchString: '',
			recordingDuration: 0,
			// Per-100ms peak amplitude for the in-progress / just-
			// finished mic recording. Single channel (l) — voice
			// memos only have the user's mic, no remote side. Gets
			// attached to the outgoing file_transfer's metadata so
			// the recipient's bubble draws the same waveform we
			// preview here.
			recordingPeaks: [],
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

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (this.props.selectedContact) {
            this.setState({targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : '', chat: false});
        }

        if (!this.props.inviteContacts && nextProps.inviteContacts) {
            this.handleSearch('');
            this.setState({chat: false});
        }

        if (this.props.selectedContact !== nextProps.selectedContact && nextProps.selectedContact) {
            this.setState({chat: !this.chatDisabledForUri(nextProps.selectedContact.uri)});
            this.setState({playRecording: false});
        }

        if (this.props.selectedContact !== nextProps.selectedContact ) {
            this.setState({gettingSharedAsset: false});
        }

        if (nextProps.selectedContact !== this.props.selectedContact) {
           this.resetContact()
           this.setState({'messagesCategoryFilter': null});
           // Reset the Recents/main nav bar to the start when leaving the
           // contacts-list view. Each visible FlatList now owns its own
           // ref (navigationRefMain / Filter / Category / Sort); we
           // target the main one because that's the bar that shows when
           // !selectedContact. Still guard against an empty list to
           // avoid the FlatList "item length 0 but minimum is 1"
           // invariant when navigationItems hasn't been populated yet.
           if (this.navigationRefMain
               && !this.props.selectedContact
               && this.navigationItems
               && this.navigationItems.length > 0) {
               try {
                   this.navigationRefMain.scrollToIndex({animated: true, index: 0});
               } catch (e) {}
           }
           if (this.props.selectedContact && this.props.pinned) {
               this.props.togglePinned(this.props.selectedContact.uri);
           }
        }

        if (!nextProps.historyFilter && this.props.historyFilter) {
            this.filterHistory(null);
        }

        if (nextProps.missedCalls.length === 0 && this.state.contactsFilter === 'missed') {
            this.setState({'contactsFilter': null});
        }

        if (nextProps.blockedUris.length === 0 && this.state.contactsFilter === 'blocked') {
            this.setState({'contactsFilter': null});
        }

        if (nextProps.favoriteUris.length === 0 && this.state.contactsFilter === 'favorite') {
            this.setState({'contactsFilter': null});
        }

        if (this.props.allContacts.length === 0 && nextProps.allContacts && nextProps.allContacts.length > 0) {
            this.bounceNavigation();
        }
                
        if (nextProps.searchString) {
            this.setState({'searchString': nextProps.searchString});
        }
        
        if ('playRecording' in nextProps) {
            console.log('playRecording', extProps.playRecording);
            this.setState({playRecording: nextProps.playRecording});
        }
        
        if ('recordingDuration' in nextProps) {
            this.setState({recordingDuration: nextProps.recordingDuration});
        }

        // When the user exits contact-search mode (the search bar is
        // collapsing), snap the source toggle back to 'sylk' AND close
        // the AB dialpad. Without this the next time they open search
        // they'd land on whatever they last picked — usually 'ab' with
        // the dialpad expanded — which surprised people who expected
        // the default Sylk view to come back. Reset early so the
        // setState below doesn't race with stale toggles.
        const exitedContactSearch =
            this.state.searchContacts && !nextProps.searchContacts;

        this.setState({
                        searchMessages: nextProps.searchMessages,
                        searchContacts: nextProps.searchContacts,
                        isTyping: nextProps.isTyping,
                        navigationItems: nextProps.navigationItems,
                        keys: nextProps.keys,
                        ...(exitedContactSearch
                            ? { contactSource: 'sylk', showAbDialpad: false }
                            : {})
                        });
    }

    getTargetUri(uri) {
        return utils.normalizeUri(uri, this.props.defaultDomain);
    }

    async componentDidMount() {
        this.ended = false;
        // Kick off the pulse immediately if we landed here already sharing
        // (e.g. user switched chats, or app reloaded mid-share). All the
        // "start/stop on change" logic lives in componentDidUpdate; this
        // covers the initial-render case.
        if (this._isSharingCurrentContact(this.props)) {
            this._startLocationSharePulse();
        }

        // Stop voice-message recording / preview playback whenever a call
        // is about to start (incoming OR outgoing) so audio doesn't
        // contend with the ringtone or the call itself.
        this.callStartingListener = DeviceEventEmitter.addListener(
            'SylkCallStarting',
            (payload) => {
                try {
                    if (this.state.recording) {
                        this.stopRecording();
                    }
                    if (this.state.playRecording || this.state.previewRecording) {
                        try { audioRecorderPlayer.stopPlayer(); } catch (_e) {}
                        try { audioRecorderPlayer.removePlayBackListener(); } catch (_e) {}
                        this.setState({ playRecording: false, previewRecording: false });
                    }
                } catch (e) { /* swallow — never block call handling */ }
            }
        );

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
    }

    componentWillUnmount() {
        this.ended = true;
        this._stopLocationSharePulse();
        this._clearNoPrivateKeyWarningTimer();
        if (this.callStartingListener) {
            this.callStartingListener.remove();
            this.callStartingListener = null;
        }
        if (this._appStateSub) {
            // RN 0.65+: addEventListener returns a subscription with
            // .remove(); the older AppState.removeEventListener API
            // is gone. Guard for both shapes anyway.
            if (typeof this._appStateSub.remove === 'function') {
                this._appStateSub.remove();
            }
            this._appStateSub = null;
        }
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

        // Modal is up, or we have a key, or we don't yet know: banner is
        // definitely not allowed. Clear any pending timer and hide.
        if (modalVisible || !noLocalKey) {
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

	  if (prevState.searchMessages !== this.state.searchMessages && !this.state.searchMessages) {
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
      
      
      if (prevState.searchContacts !== this.state.searchContacts && this.state.searchContacts) {
		  this.setState({messagesCategoryFilter: null, historyPeriodFilter: null});
		  this.props.filterHistoryFunc(null);
      }

      if (this.state.messagesCategoryFilter !== prevState.messagesCategoryFilter) {
		  console.log('messagesCategoryFilter did change', this.state.messagesCategoryFilter);
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
        if (this.state.searchContacts) {
			this.props.toggleSearchContacts()
		}
      }
    }

    filterHistory(filter) {
       if (this.ended) {
            return;
       }

       //console.log('filterHistory', filter);

       if (this.props.selectedContact) {
           if (!filter && this.props.pinned) {
               this.props.togglePinned(this.props.selectedContact.uri);
           }

           if (filter === 'pinned') {
               this.props.togglePinned(this.props.selectedContact.uri);
               return;
           }

           if (filter === this.state.messagesCategoryFilter) {
               this.setState({'messagesCategoryFilter': null});
           } else {
               this.setState({'messagesCategoryFilter': filter});
           }
           return;
       }

       this.props.filterHistoryFunc(filter);

       if (!filter) {
           if (!this.state.historyPeriodFilter) {
               /*
               let orderBy;
               if (this.state.orderBy == 'timestamp') {
				   this.props.postSystemNotification('Sort by used storage');
				   orderBy = 'storage';
               } else {
				   this.props.postSystemNotification('Sort by last message');
				   orderBy = 'timestamp';
               }
			   this.setState({'orderBy': orderBy});
			   */
           }
           this.setState({historyPeriodFilter: null, contactsFilter: null});
       } else if (filter === 'recent') {
           filter = this.state.historyPeriodFilter === filter ? null : filter;
           this.setState({'historyPeriodFilter': filter});
       } else {
           if (filter == this.state.contactsFilter) {
			   this.setState({contactsFilter: null});
           } else {
			   this.setState({'contactsFilter': filter});
           }
       }

       this.handleSearch('');
       
    }

    chatDisabledForUri(uri) {
        if (uri.indexOf('@videoconference') > -1) {
            return true;
        }

        if (uri.indexOf('@guest') > -1) {
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

        if (this.state.recording) {
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

        if (!this.state.searchMessages && !this.state.searchContacts) {
			return false;
        }

		if (this.state.messagesCategoryFilter == 'image') {
			return false;
		}

        if (this.props.selectedContact) {
            if (!this.state.searchMessages) {
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
		   return this.state.searchMessages || this.state.messagesCategoryFilter || this.state.orderBy == 'size';
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
		   return this.state.searchContacts;
	   }
   }

    get showConferenceButton() {
        if (this.props.selectedContact) {
            return false;
        }

        if (this.state.recording || this.state.previewRecording) {
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
        if (this.props.call || this.state.recording || this.state.playRecording || this.state.previewRecording || this.state.recordingFile || this.props.shareToContacts) {
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

        if (!this.state.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioDeleteButton() {
        if (!this.state.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioStopButton() {
        return this.state.playRecording;
    }

    get showAudioRecordButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        if (this.props.call) {
            return false;
        }

	    if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
            return false;
        }

	    if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@guest') > -1) {
            return false;
        }

        // Audio-only conference rooms (@conference, distinct from
        // @videoconference which is matched above) don't accept inbound
        // file transfers, so a recorded voice memo can't be delivered.
        // Hide the mic instead of rendering it greyed-out — the user
        // shouldn't see an affordance for an action that has no path
        // to actually completing.
        if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@conference') > -1) {
            return false;
        }

        // `test`-tagged contacts are local-only stubs used for QA /
        // first-run scaffolding; file transfers (and therefore voice
        // memo delivery) are disabled for them. Same rationale as the
        // conference-room block above: hide the mic rather than show
        // a permanently-disabled button.
        if (this.props.selectedContact
                && Array.isArray(this.props.selectedContact.tags)
                && this.props.selectedContact.tags.indexOf('test') > -1) {
            return false;
        }

        if (this.props.selectedContact) {
			const els = this.props.selectedContact.uri.split('@');
			const username = els[0];
			const isNumber = utils.isPhoneNumber(username);

			if (isNumber && (username.startsWith('0') || username.startsWith('+'))) {
				return false;
			}
		}


        if (this.state.recordingFile) {
            return false;
        }

        if (this.state.playRecording) {
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

        if (this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
            return false;
        }

        if (this.props.selectedContact.uri.indexOf('@guest') > -1) {
            return false;
        }

        const els = this.props.selectedContact.uri.split('@');
        const username = els[0];
        const isNumber = utils.isPhoneNumber(username);
        if (isNumber && (username.startsWith('0') || username.startsWith('+'))) {
            return false;
        }

        // PGP key required — same rule as NavigationBar's menu item.
        if (!this.props.selectedContact.publicKey) {
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
        if (this.state.recording) {
            return false;
        }
        if (this.state.previewRecording) {
            return false;
        }
        if (this.state.recordingFile) {
            return false;
        }
        if (this.state.playRecording) {
            return false;
        }

        return true;
    }

    get showButtonsBar() {
        if (this.props.fullScreen) {
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

        if (this.props.keyboardVisible && this.props.selectedContact) {
            return false;
        }        

        if (this.state.orderBy === 'size' && this.props.selectedContact) {
            return false;
        }        


        if (this.state.searchMessages) {
            return false;
        }        

        if (this.props.showQRCodeScanner) {
            return false;
        }

        if (this.props.isTablet) {
            return true;
        }

        if (this.props.call) {
            return false;
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
        // Every Phonebook selection invokes loadAddressBook. On the
        // app.js side it short-circuits when permission is granted
        // AND contacts have already been fetched; otherwise it
        // re-prompts the user. So the first tap shows the OS prompt,
        // and subsequent taps either no-op (granted, loaded) or
        // re-prompt (still denied). We deliberately don't ask at app
        // start any more — only on explicit Phonebook intent.
        if (source === 'ab' && typeof this.props.loadAddressBook === 'function') {
            this.props.loadAddressBook();
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
    // pill gone we lazily kick loadAddressBook the first time the
    // user signals search intent — either by tapping the search
    // field (URIInput.onSearchFocus, the preferred trigger so the
    // OS permission dialog appears the moment they "click search")
    // or as a safety net when they actually start typing
    // (handleSearch, in case some platform skips the click event).
    // This preserves the "only on explicit user intent" stance for
    // the OS contacts-permission prompt: we don't ask just for
    // opening the app. loadAddressBook is idempotent on the host
    // side — already-granted + already-loaded is a no-op, and not-
    // yet-granted re-prompts the OS once.
    kickUnifiedSearchAddressBookLoad() {
        if (this._unifiedSearchAbLoadKicked) return;
        if (this.state.searchMessages) return;
        if (this.props.shareToContacts) return;
        if (this.props.inviteContacts) return;
        if (typeof this.props.loadAddressBook !== 'function') return;

        this._unifiedSearchAbLoadKicked = true;
        try {
            this.props.loadAddressBook();
        } catch (e) {
            // Swallow — the Sylk side of the merged result renders
            // immediately regardless, and a failure here just means
            // the AB pile stays empty for this search.
            console.log('unified search loadAddressBook failed', e && e.message);
        }
    }

    handleSearch(inputText, contact) {
        if (inputText && inputText.length > 0) {
            this.kickUnifiedSearchAddressBookLoad();
        }

        if (this.state.searchMessages) {
            if (!inputText) {
                // Empty input in search-messages mode = the user
                // tapped the clear icon (the × inside the Searchbar)
                // OR cleared the field manually. Either way we
                // close the search bar via toggleSearchMessages,
                // which is also where the open/close log line fires.
                console.log('[search] messages search cleared');
                this.props.toggleSearchMessages();
                this.setState({searchString: ''});
            } else {
                console.log('[search] messages query change',
                    'len=' + inputText.length);
                this.setState({searchString: inputText});
            }
            return;
        }

        //console.log('handleSearch contact =', contact);

        if ((this.props.inviteContacts || this.props.shareToContacts) && contact) {
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

        this.props.selectContact(contact);
        this.setState({targetUri: new_value});
    }

    handleTargetSelect() {
        console.log('---handleTargetSelect');
        
        if (this.state.searchMessages) {
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
        console.log('handleChat');
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
        console.log('--- handleConferenceCall options', options);
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
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        if (this.state.recording) {
            return true;
        }

        if (this.state.recordingFile) {
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
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1) {
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

        if (this.state.recording) {
            return true;
        }

        if (this.state.recordingFile) {
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

		const path = this.state.recordingFile.startsWith('file://')
		  ? this.state.recordingFile
		  : 'file://' + this.state.recordingFile;
  
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
        if (!this.state.previewRecording) {
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
            {key: 'audio',    title: 'Audio',     icon: 'microphone'},
            {key: 'image',    title: 'Image',     icon: 'image'},
            {key: 'video',    title: 'Video',     icon: 'video'},
            {key: 'location', title: 'Locations', icon: 'map-marker'},
            {key: 'other',    title: 'Other',     icon: 'file'},
        ];
        for (const c of candidates) {
            const has = showAll
                || (counts && counts[c.key] > 0)
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
        const inTextFilter = cat === 'text';
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
        if (!inLocationFilter) {
            items.push({key: 'orderByTime', title: 'Sort: by time', icon: 'clock-outline', enabled: this.state.orderBy === 'timestamp', selected: false});
            if (!inTextFilter) {
                items.push({key: 'orderBySize', title: 'Sort: by size', icon: 'harddisk', enabled: this.state.orderBy === 'size', selected: false});
            }
        }
        items.push({key: 'orderAscending',  title: 'Order: ascending',  icon: 'arrow-up',   enabled: this.state.sortOrder === 'asc',  selected: false});
        items.push({key: 'orderDescending', title: 'Order: descending', icon: 'arrow-down', enabled: this.state.sortOrder === 'desc', selected: false});
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
        let conferenceEnabled = Object.keys(this.props.myInvitedParties).length > 0 || this.state.navigationItems['conference'];
        if (this.props.inviteContacts) {
            conferenceEnabled = false;
        }

        if (this.state.recordingFile) {
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

        return [
              {key: 'recent', title: 'Recent', enabled: this.state.navigationItems['recent'], selected: this.state.historyPeriodFilter === 'recent'},
              {key: 'calls', title: 'Calls', enabled: true, selected: this.state.contactsFilter === 'calls'},
              {key: 'favorite', title: 'Favorites', enabled: this.props.favoriteUris.length > 0, selected: this.state.contactsFilter === 'favorite'},
              {key: 'autoanswer', title: 'Caregivers', enabled: this.props.hasAutoAnswerContacts, selected: this.state.contactsFilter === 'autoanswer'},
              {key: 'tel', title: 'Tel', enabled: hasTelContacts, selected: this.state.contactsFilter === 'tel'},
              {key: 'missed', title: 'Missed', enabled: this.props.missedCalls.length > 0, selected: this.state.contactsFilter === 'missed'},
              {key: 'blocked', title: 'Blocked', enabled: this.props.blockedUris.length > 0, selected: this.state.contactsFilter === 'blocked'},
              {key: 'conference', title: 'Conference', enabled: conferenceEnabled, selected: this.state.contactsFilter === 'conference'},
              {key: 'test', title: 'Test', enabled: !this.props.shareToContacts && !this.props.inviteContacts, selected: this.state.contactsFilter === 'test'},
              ];
    }

    get sortOrderItems() {
        return [
              {key: null, title: 'Order:', enabled: true, selected: false},
              {key: 'orderByTime', title: 'Time', enabled: true, selected: this.state.orderBy === 'timestamp'},
              {key: 'orderBySize', title: 'Size', enabled: true, selected: this.state.orderBy === 'size'},
              {key: 'divider1', title: '', enabled: true, selected: false},
              {key: 'orderAscending', title: '↑ Asc', enabled: true, selected: this.state.sortOrder === 'asc'},
              {key: 'orderDescending', title: '↓ Desc', enabled: true, selected: this.state.sortOrder === 'desc'},
              ];
    }

    renderNavigationItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let icon = object.item.icon;

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
                        console.log('[sort] orderBy: timestamp -> size (filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                            console.log('[sort] orderBy: timestamp -> size (filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                        console.log('[sort] orderBy: size -> timestamp (filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                            console.log('[sort] orderBy: size -> timestamp (filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                        console.log('[sort] sortOrder: asc -> desc (orderBy=' + this.state.orderBy + ', filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                            console.log('[sort] sortOrder: asc -> desc (orderBy=' + this.state.orderBy + ', filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                        console.log('[sort] sortOrder: desc -> asc (orderBy=' + this.state.orderBy + ', filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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
                            console.log('[sort] sortOrder: desc -> asc (orderBy=' + this.state.orderBy + ', filter=' + (this.state.messagesCategoryFilter || 'none') + ')');
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

        return (<Button key={_bbRemountKey} compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }

    renderOrderItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let buttonStyle = object.item.selected ? styles.navigationButtonSelected : styles.navigationButton;
        // Same selection-aware label style as renderNavigationItem
        // above (see explanatory comment there).
        const _theme = DarkModeManager.getTheme();
        const _navItemLabelStyle = {
            color: object.item.selected ? '#FFFFFF' : _theme.textPrimary,
            fontWeight: 'normal',
            fontSize: 12,
        };

        if (key === "orderByTime") {
            return (<Button compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.setState({orderBy: 'timestamp'})}}>{title}</Button>);
        }

        if (key === "orderBySize") {
            return (<Button compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.setState({orderBy: 'size'})}}>{title}</Button>);
        }

        if (key === "orderAscending") {
            return (<Button compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.setState({sortOrder: 'asc'})}}>{title}</Button>);
        }

        if (key === "orderDescending") {
            return (<Button compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.setState({sortOrder: 'desc'})}}>{title}</Button>);
        }

        return (<Button compact style={buttonStyle} labelStyle={_navItemLabelStyle} contentStyle={{ paddingVertical: 0, minHeight: 0 }} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }
    
    toggleQRCodeScanner(event) {
        //console.log('Scan QR code...');
        this.props.toggleQRCodeScannerFunc();
    }

    QRCodeRead(e) {
        //console.log('QR code object:', e);
        console.log('QR code data:', e.data);
        this.props.toggleQRCodeScannerFunc();

        let data = e.data;
        const sipUri = utils.parseSylkCallUrl(data);
        if (sipUri) {
            console.log('QR code call URL parsed to SIP URI:', sipUri);
            data = sipUri;
        }

        this.handleSearch(data);
    }

    get showContactsList() {
        if (this.state.recording) {
             //return false;
        }

        if (this.state.recordingFile) {
             //return false;
        }
        
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

    async recordAudio() {
        const micAllowed = await this.props.requestMicPermission('recordAudio');

        if (!micAllowed) {
            console.log('Mic not allowed');
            return;
        }

        if (!this.state.recording) {
            if (this.state.recordingFile) {
                this.deleteAudio();
            } else {
                this.onStartRecord();
            }
        } else {
            this.onStopRecord();
        }
    }

    recordAudio(event) {
        event.preventDefault();
        Keyboard.dismiss();
        this.props.recordAudio();
    }

    async sendAudioFile() {
        if (this.state.recordingFile) {
            this.setState({audioSendFinished: true});
            setTimeout(() => {
                this.setState({audioSendFinished: false});
            }, 10);
            let msg = await this.props.file2GiftedChat(this.state.recordingFile);
            // Attach the per-100ms mic peaks captured during
            // recording so the recipient's bubble draws the same
            // waveform we previewed locally. Single-channel — the
            // mic is the only signal — so peaks.r stays empty;
            // AudioWaveform handles the empty side gracefully.
            const peaks = this.state.recordingPeaks;
            if (msg && msg.metadata
                    && peaks && Array.isArray(peaks) && peaks.length > 0) {
                msg.metadata.peaks = { l: peaks, r: [] };
            }
            this.transferFile(msg);
            this.setState({recordingFile: null, recordingDuration: 0, recordingPeaks: []});
        }
    }

    async transferFile(msg) {
        msg.metadata.preview = false;
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
        // Ship peaks as a sylk-message-metadata follow-up so the
        // recipient's bubble can draw the waveform. SylkServer's
        // file-transfer broadcast strips custom fields like `peaks`,
        // so without this side-channel the recipient's waveform
        // renders as a flat baseline. See app.js: sendPeaksMessage.
        if (msg.metadata && msg.metadata.peaks
                && typeof this.props.sendPeaksMessage === 'function') {
            this.props.sendPeaksMessage(
                msg.metadata.receiver.uri,
                msg.metadata.transfer_id,
                msg.metadata.peaks
            );
        }
    }

    deleteAudioAction(event) {
        //console.log('deleteAudioAction');
        event.preventDefault();
        this.onStopPlay();
        this.deleteAudio();
    }

    async recordAudio() {
        //console.log('Start recording by user...');

        const micAllowed = await this.props.requestMicPermission('recordAudio');

        // Re-probe the cached permission flag now that the user has
        // either granted or denied at the OS prompt. Without this the
        // mic button would stay visible until the next foreground
        // transition for a user who just tapped Deny — they'd see a
        // tappable button that silently does nothing.
        this._refreshMicPermission();

        if (!micAllowed) {
            return;
        }

        if (!this.state.recording) {
            if (this.state.recordingFile) {
                this.deleteAudio();
            } else {
                this.onStartRecord();
            }
        } else {
            this.onStopRecord();
        }
    }

    deleteAudio() {
        this.setState({recordingFile: null,
					   recordingDuration: 0,
                       recording: false,
                       previewRecording: false,
                       recordingPeaks: []});

        if (this.props.selectedContact) {
			this.props.getMessages(this.props.selectedContact.uri);
		}
    }

	stopRecordingTimer() {
		//console.log('Ready box: stopRecordingTimer');
		if (this.recordingStopTimer !== null) {
		    clearTimeout(this.recordingStopTimer);
			this.recordingStopTimer = null;
		}
	}
        
    async onStartRecord () {
        // NB: we used to call SoundLevel.start() here to drive the
        // VuMeter, but on iOS react-native-sound-level and
        // react-native-audio-recorder-player both create AVAudioRecorder
        // instances on the shared AVAudioSession, and iOS refuses to
        // start a second one — startRecorder() below then fails with
        // "Error occured during initiating recorder" while Android (which
        // uses separate AudioRecord vs MediaRecorder backends) happily
        // runs both. The recorder already emits the same dBFS level via
        // addRecordBackListener's currentMetering, so we drive the
        // VuMeter from that single source instead and keep the mic
        // exclusive to the recorder.

        try {
            // Compressed AAC (M4A) recording — voice memos used to
            // ship as 16 kHz mono 16-bit PCM WAV (~32 KB/s = ~1.9 MB
            // per minute). Compressed AAC at ~32 kbps is ~4 KB/s
            // (~240 KB per minute) — an 8× reduction with no audible
            // quality loss for speech, and the file is playable
            // everywhere natively (AVFoundation on iOS, MediaPlayer
            // on Android, every browser, every desktop player).
            //
            // The recorder is shared with the playback path
            // (audioRecorderPlayer is the same module-level instance)
            // — that's fine because record and play never overlap in
            // time: we record, stop, then optionally play back from
            // the saved file.
            //
            // Path: cache dir + sylk-audio-recording.m4a. We pass an
            // explicit path so the file always ends in .m4a — Android's
            // default ends in .mp4 which file2GiftedChat would route
            // through the isVideo branch (msg.video = filepath) instead
            // of msg.audio = filepath, breaking bubble rendering and
            // playback. iOS already defaults to .m4a but we set it
            // explicitly there too for symmetry.
            // IMPORTANT: prefix with file:// on iOS. react-native-audio-
            // recorder-player's setAudioFileURL() only treats a string as
            // a literal file path when it starts with file://, http://, or
            // https:// — anything else is fed through
            // cachesDirectory.appendingPathComponent(), which percent-
            // encodes the slashes in an already-absolute path and yields
            // a non-existent URL like
            // file:///.../Caches/%2Fvar%2Fmobile%2F.../sylk-audio-
            // recording.m4a. AVAudioRecorder.prepareToRecord() then
            // returns false (the smoking gun in the metro log was
            // "prepareToRecord returned false"). Android's
            // implementation is path-agnostic so we add the prefix on
            // iOS only to keep the existing Android-side behavior
            // untouched.
            const rawRecordingPath = `${RNFS.CachesDirectoryPath}/sylk-audio-recording.m4a`;
            const recordingPath = Platform.OS === 'ios'
                ? `file://${rawRecordingPath}`
                : rawRecordingPath;
            const audioSet = {
                // iOS — AAC in an .m4a container at 16 kHz mono.
                AVFormatIDKeyIOS: AVEncodingOption.aac,
                AVSampleRateKeyIOS: 16000,
                AVNumberOfChannelsKeyIOS: 1,
                AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.medium,
                AVEncoderBitRateKeyIOS: 32000,
                // Android — AAC in an MP4 container at 16 kHz mono.
                AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
                AudioSourceAndroid: AudioSourceAndroidType.MIC,
                OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
                AudioSamplingRateAndroid: 16000,
                AudioChannelsAndroid: 1,
                AudioEncodingBitRateAndroid: 32000,
            };

            // Reset per-recording peak accumulator. Same shape /
            // granularity Android's SylkCallRecorder uses (per-100ms
            // 0..255 peak per channel) so the receiver's bubble
            // renders the waveform with no special handling for
            // "regular voice memo" vs "call recording". Driven by
            // currentMetering (dBFS) from addRecordBackListener —
            // metering ticks roughly every 100 ms with the loudest
            // sample seen since the previous tick, mapped to 0..255
            // so it slots straight into the existing peaks pipeline.
            this._micPeaks = [];

            // ---- pre-flight diagnostics ----
            // The native iOS module throws a static "Error occured
            // during initiating recorder" string for *any* failure
            // inside [recorder prepareToRecord] or AVAudioSession
            // setup, which makes the JS-side message useless on its
            // own. Log the things that most often go wrong on iOS so
            // the metro log tells us which one it is:
            //   - mic permission (DENIED/BLOCKED/UNAVAILABLE all
            //     present at native layer as a prepareToRecord
            //     failure, not a permission error)
            //   - cache path exists & is writable (a stale directory
            //     or a path the sandbox can't open also surfaces as a
            //     prepareToRecord failure)
            //   - whether any previous recording is still on disk at
            //     the same path (some iOS versions refuse to
            //     overwrite a locked file).
            try {
                if (Platform.OS === 'ios') {
                    const micPerm = await checkPermission(RNP_PERMISSIONS.IOS.MICROPHONE);
                    console.log('[recorder] iOS mic permission =', micPerm,
                        '(granted=', micPerm === RNP_RESULTS.GRANTED, ')');
                } else if (Platform.OS === 'android') {
                    const micPerm = await checkPermission(RNP_PERMISSIONS.ANDROID.RECORD_AUDIO);
                    console.log('[recorder] android mic permission =', micPerm);
                }
            } catch (permErr) {
                console.log('[recorder] permission check threw', permErr && permErr.message);
            }
            try {
                const cacheDir = RNFS.CachesDirectoryPath;
                const dirExists = await RNFS.exists(cacheDir);
                // RNFS uses native filesystem paths (no scheme), so the
                // pre-flight checks run against rawRecordingPath, not
                // the file://-prefixed `recordingPath` we hand to the
                // recorder.
                const fileExists = await RNFS.exists(rawRecordingPath);
                let fileStat = null;
                if (fileExists) {
                    try { fileStat = await RNFS.stat(rawRecordingPath); } catch (_e) {}
                }
                console.log('[recorder] cacheDir =', cacheDir,
                    'exists=', dirExists,
                    'targetExists=', fileExists,
                    'targetSize=', fileStat && fileStat.size,
                    'targetMTime=', fileStat && fileStat.mtime);
                // If a leftover file is sitting at the target path,
                // remove it before we try to start — that's a known
                // trigger on iOS where AVAudioRecorder.prepareToRecord
                // returns NO if the file is locked by something else
                // (e.g. an unreleased AVAudioPlayer from a prior
                // playback) and the native module surfaces that as
                // "Error occured during initiating recorder".
                if (fileExists) {
                    try {
                        await RNFS.unlink(rawRecordingPath);
                        console.log('[recorder] removed stale recording at target path');
                    } catch (unlinkErr) {
                        console.log('[recorder] failed to remove stale recording:',
                            unlinkErr && unlinkErr.message);
                    }
                }
            } catch (fsErr) {
                console.log('[recorder] fs pre-flight threw', fsErr && fsErr.message);
            }

            // iOS only: ask SylkAudioRouteModule to release the
            // shared AVAudioSession before the recorder lib tries to
            // claim it. See ios/sylk/AudioRouteModule.m
            // prepareForRecording for the full rationale — the short
            // version is that the session is held in PlayAndRecord +
            // VoiceChat at app init for VOIP, which engages voice-
            // processing IO and causes AVAudioRecorder.record() to
            // return NO (the exact failure we were hitting). This
            // helper deactivates the session with
            // NotifyOthersOnDeactivation so the recorder lib's own
            // setCategory(mode:.default) + setActive(true) actually
            // takes the input route. We restore in onStopRecord.
            if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.prepareForRecording) {
                try {
                    await SylkAudioRouteModule.prepareForRecording();
                    console.log('[recorder] prepareForRecording ok');
                } catch (prepErr) {
                    // Non-fatal — if the native helper is missing or
                    // fails, we still try to start the recorder. The
                    // worst case is the same failure we had before.
                    console.log('[recorder] prepareForRecording failed (continuing):',
                        prepErr && prepErr.message);
                }
            }

            console.log('[recorder] startRecorder ->', recordingPath, 'platform=', Platform.OS);
            const startResult = await audioRecorderPlayer.startRecorder(recordingPath, audioSet, true);
            console.log('[recorder] startRecorder ok, native path =', startResult);
            audioRecorderPlayer.addRecordBackListener((e) => {
                // currentMetering is in dBFS (typically -160..0) on
                // iOS / Android. Treat -50 dB as the noise floor so
                // ambient room tone doesn't clip the bottom of the
                // waveform; anything quieter folds to 0. Loudest
                // possible (0 dB) maps to 255.
                const db = (typeof e.currentMetering === 'number')
                    ? e.currentMetering
                    : -160;
                const NOISE_FLOOR_DB = -50;
                const norm = Math.max(0, Math.min(1, (db - NOISE_FLOOR_DB) / -NOISE_FLOOR_DB));
                this._micPeaks.push(Math.round(norm * 255));
                // Drive the live VuMeter from the same metering tick.
                // Previously this came from SoundLevel.onNewFrame, but
                // that conflicted with the recorder on iOS (see note in
                // onStartRecord above). `norm` is already 0..1 with the
                // same -50 dB noise floor, so it slots straight in.
                // Also surface the elapsed duration the recorder reports
                // (currentPosition is ms since record() returned true on
                // iOS / since prepareRecorder on Android, ticking ~every
                // 100 ms) so the live counter under the VuMeter stays in
                // lockstep with what's actually being written to disk.
                const elapsed = (typeof e.currentPosition === 'number')
                    ? Math.max(0, Math.floor(e.currentPosition))
                    : 0;
                this.setState({ level: norm, recordingElapsedMs: elapsed });
            });

			this.setState({recording: true, recordingElapsedMs: 0});

			// 30s auto-stop timer removed per user request — the user
			// stays in the recording screen as long as they want and
			// stops the recording explicitly via the stop button.
			// Previously this fired onStopRecord() after 30 seconds
			// which capped voice messages and surprised users
			// composing longer notes.

			this.props.vibrate();

        } catch (e) {
            // The native iOS module throws a hard-coded
            // "Error occured during initiating recorder" string for
            // *every* AVAudioSession / AVAudioRecorder failure, so
            // e.message alone tells us nothing. Dump everything React
            // Native's NSError->JS bridge gives us — code, domain,
            // userInfo, nativeStackIOS, and the JS-side stack — so
            // the metro log actually tells us which underlying
            // failure (busy session, missing entitlement, locked
            // file, sandbox path, hardware route change) we're
            // looking at.
            try {
                console.log('[recorder] startRecorder FAILED');
                console.log('[recorder]   message =', e && e.message);
                console.log('[recorder]   code    =', e && e.code);
                console.log('[recorder]   domain  =', e && e.domain);
                console.log('[recorder]   name    =', e && e.name);
                if (e && e.userInfo) {
                    try { console.log('[recorder]   userInfo =', JSON.stringify(e.userInfo)); }
                    catch (_je) { console.log('[recorder]   userInfo (raw) =', e.userInfo); }
                }
                if (e && e.nativeStackIOS) {
                    console.log('[recorder]   nativeStackIOS =', e.nativeStackIOS);
                }
                if (e && e.nativeStackAndroid) {
                    console.log('[recorder]   nativeStackAndroid =', e.nativeStackAndroid);
                }
                if (e && e.stack) {
                    console.log('[recorder]   js stack =', e.stack);
                }
                // Last resort — enumerate own props in case the
                // module is returning something exotic.
                try {
                    const keys = e ? Object.getOwnPropertyNames(e) : [];
                    if (keys.length) {
                        const dump = {};
                        keys.forEach((k) => { try { dump[k] = e[k]; } catch (_ke) {} });
                        console.log('[recorder]   full =', JSON.stringify(dump));
                    }
                } catch (_de) {}
            } catch (logErr) {
                console.log('[recorder] (failure logging itself threw)', logErr && logErr.message);
            }
            // Failure path: we already called prepareForRecording (which
            // deactivated the VoIP session) but startRecorder threw, so
            // onStopRecord will never run and the session would stay
            // deactivated. Restore it here so a subsequent call comes up
            // in VoIP mode normally.
            if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterRecording) {
                try {
                    await SylkAudioRouteModule.restoreAfterRecording();
                    console.log('[recorder] restoreAfterRecording ok (after failure)');
                } catch (restErr) {
                    console.log('[recorder] restoreAfterRecording failed (after failure):',
                        restErr && restErr.message);
                }
            }
        }
    };

    stopRecording() {
        //console.log('Stop recording by user...');
        this.onStopRecord();
    }

    async onStopRecord () {
        // Stop the recording-duration ticker immediately so the
        // header doesn't keep counting while stopRecorder() resolves.
        // We deliberately do NOT setState({recording:false}) here —
        // that would cause an intermediate render where neither
        // `recording` nor `recordingFile` is set, which the chat
        // (ContactsListBox: chatMessages = [] when either is set) would
        // misread as "no recording in progress" and momentarily flash
        // the previous chat history into view before the next setState
        // hides it again. Instead we do one combined setState below
        // that flips recording=false AND recordingFile=result in the
        // same render pass — no flash.
        this.stopRecordingTimer();
        let result = null;
        try {
            result = await audioRecorderPlayer.stopRecorder();
            // stopRecorder returns audioFileURL.absoluteString on iOS,
            // which is file://-prefixed. Strip the scheme so the value
            // stored in state.recordingFile matches Android (bare path)
            // and the rest of the app's downstream consumers
            // (file2GiftedChat, audio bubble playback, the
            // file://-prefix check at line ~1381) don't have to second-
            // guess the format. We always know the path is a local
            // file because we constructed it from RNFS.CachesDirectoryPath
            // in onStartRecord.
            if (typeof result === 'string' && result.startsWith('file://')) {
                result = result.substring('file://'.length);
            }
        } catch (e) {
            console.log('stopRecorder error', e && e.message);
        }
        try { audioRecorderPlayer.removeRecordBackListener(); } catch (_e) {}
        const finalPeaks = (this._micPeaks || []).slice();
        this._micPeaks = null;
        // Single combined setState — flips recording=false AND
        // installs the recordingFile + peaks in the same render so
        // ContactsListBox's "hide chat while recordingFile is set"
        // gate stays true the whole way through. See the no-flash
        // note at the top of this method. `level: 0` is folded into
        // the same setState (instead of being a separate call after
        // audioRecorded) so the VuMeter resets without forcing the
        // extra render the no-flash comment warns about. SoundLevel.stop()
        // is no longer needed — see the note in onStartRecord for why
        // SoundLevel was dropped entirely.
        this.setState({
            recording: false,
            recordingFile: result,
            recordingPeaks: finalPeaks,
            level: 0,
            // Clear the live counter so the meter+counter pair start
            // clean on the next recording. recordingDuration (set by
            // audioRecorded after Sound() reads the finished file) is
            // a separate value used by the preview UI, so we don't
            // touch it here.
            recordingElapsedMs: 0,
        });
        this.audioRecorded(result);
        // Paired with prepareForRecording in onStartRecord — restore
        // PlayAndRecord + VoiceChat so the next call comes up cleanly.
        // No-op on Android, and safe to call even if prepareForRecording
        // failed (the native side no-ops without a saved snapshot).
        if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterRecording) {
            try {
                await SylkAudioRouteModule.restoreAfterRecording();
                console.log('[recorder] restoreAfterRecording ok');
            } catch (restErr) {
                console.log('[recorder] restoreAfterRecording failed:',
                    restErr && restErr.message);
            }
        }
    };

    resetContact() {
        this.stopRecordingTimer()
        this.setState({
            recording: false,
            recordingFile: null,
            recordingDuration: 0,
            recordingPeaks: [],
            audioSendFinished: false,
            searchString: ''
        });
    }

    async audioRecorded(file) {
        if (file) {
            console.log('Audio recording ready to send', file);
            try {
				const sound = new Sound(file, '', (error) => {
				  if (error) {
					console.log('Failed to load the audio', error);
					return;
				  }
				  const duration = Math.floor(sound.getDuration());
				  this.setState({recordingDuration: duration});
			    });
			} catch (e) {
				console.log('error', e);
			}
			// Note: recording=false / recordingFile=file are already
			// set in the combined setState at the end of onStopRecord
			// — no duplicate setState here, since that would force an
			// extra render and we want the transition to be a single
			// atomic render to avoid flashing the chat history.
        }
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

        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS             : styles.greenButton;
        let blueButtonClass          = Platform.OS === 'ios' ? styles.blueButtoniOS              : styles.blueButton;
        let redButtonClass           = Platform.OS === 'ios' ? styles.redButtoniOS               : styles.redButton;
        // Purple dot = "Share location" — visually distinct from the green
        // call buttons and the blue record/file-transfer buttons so the new
        // action doesn't get mistaken for a call or a file share.
        let purpleButtonClass        = Platform.OS === 'ios' ? styles.purpleButtoniOS            : styles.purpleButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS     : styles.disabledGreenButton;
        let disabledBlueButtonClass  = Platform.OS === 'ios' ? styles.disabledBlueButtoniOS      : styles.disabledBlueButton;
        let recordIcon               = this.state.recording ? 'pause' : 'microphone';
        let activityTitle            = this.state.recording ? "Recording audio" : "Audio recording ready";
        
        const sharedContent = this.props.sharedContent || [];
        
		const hasImages = sharedContent.some(
		  file => typeof file.mimeType === 'string' && file.mimeType.startsWith('image/')
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
                    {this.showCategoryBar ?
                        // Two-section bar.
                        //   Left  (flex: 1)  — filter chips. Hosted in a horizontal
                        //     FlatList so they scroll if the list outgrows the
                        //     available width (the Locations addition pushed us
                        //     over on narrow phones; future filters will keep
                        //     adding to this row, so a scrollable container is
                        //     a sustainable shape).
                        //   Splitter         — a 1 px vertical hairline marking the
                        //     boundary between filters and sort toggles, so the
                        //     two groups read as visually distinct.
                        //   Right (auto)     — sort toggles. Rendered inline (not
                        //     in a FlatList, since the count is fixed and known)
                        //     and pinned to the right edge of the bar so they
                        //     never scroll out of view. The user can always see
                        //     and tap the active sort.
                        // The selectedContact branch uses this layout; the
                        // contacts-list branch falls back to the historical
                        // single FlatList rendering of `categoryItems`.
                        this.props.selectedContact ?
                        // Contacts-list "order type" / sort row used to
                        // render here (the second branch of the
                        // selectedContact ternary). It has been hidden
                        // per user request to reduce the chrome stacked
                        // above the list — search alone is enough for
                        // navigating the unified Sylk + Phonebook
                        // corpus. The selected-contact branch (filter
                        // chips + sort toggles for the chat view) is
                        // still rendered. JSX for the hidden branch is
                        // preserved further down (gated by `false`)
                        // so the categoryItems pill code path can be
                        // re-enabled quickly if we change our mind.
                        <View style={[navigationContainer, { flexDirection: 'row', alignItems: 'center' }]}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <FlatList
                                    contentContainerStyle={styles.navigationButtonGroup}
                                    horizontal={true}
                                    showsHorizontalScrollIndicator={false}
                                    ref={(ref) => { this.navigationRefFilter = ref; }}
                                    onScrollToIndexFailed={info => {
                                        const wait = new Promise(resolve => setTimeout(resolve, 10));
                                        wait.then(() => {
                                            if (!this.props.selectedContact
                                                && this.navigationRefFilter
                                                && this.categoryFilterItems
                                                && info.index < this.categoryFilterItems.length) {
                                                try {
                                                    this.navigationRefFilter.scrollToIndex({ index: info.index, animated: false });
                                                } catch (e) {}
                                            }
                                        });
                                    }}
                                    data={this.categoryFilterItems}
                                    extraData={this.state}
                                    keyExtractor={(item, index) => item.key}
                                    renderItem={this.renderNavigationItem}
                                />
                            </View>
                            {/* Splitter between the two button
                                groups. The bar's left half is the
                                FILTER chips (which message type to
                                show), the right half is the SORT
                                toggles (how to order them). The
                                hairline divider used to read like
                                an accidental seam — bumping it to a
                                solid 1 px line at 45 % opacity with
                                more breathing room makes the two
                                regions clearly distinct without
                                taking real estate. The slight
                                inset (marginVertical: 4) keeps the
                                line visually shorter than the full
                                bar height so it reads as a
                                separator, not a column edge. */}
                            <View style={{
                                width: 1,
                                alignSelf: 'stretch',
                                marginVertical: 4,
                                marginHorizontal: 8,
                                backgroundColor: 'rgba(0,0,0,0.45)',
                            }} />
                            {/* Right group ("Sort"). A subtle
                                background tint behind the cluster
                                gives the row a second visual cue
                                (icon-only on the left, soft-tinted
                                on the right) so the user can tell
                                "the things on the right are
                                different in purpose from the things
                                on the left" at a glance even before
                                reading the icons. */}
                            <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                borderRadius: 6,
                                paddingHorizontal: 2,
                            }}>
                                {this.categorySortItems.map((item, index) => (
                                    this.renderNavigationItem({ item, index })
                                ))}
                            </View>
                        </View>
                        :
                        // Hidden per user request — the contacts-list
                        // view no longer renders the source pills +
                        // order/sort toggles row above the list. JSX
                        // for the row is preserved (wrapped in a
                        // `false && (...)` guard) so the layout can
                        // be re-enabled quickly if we change our
                        // mind. The chat-view branch (above) still
                        // shows its filter + sort bar; that's where
                        // ordering is meaningful.
                        false && (
                        <View style={[navigationContainer, { flexDirection: 'row', alignItems: 'center' }]}>
                            {/* LEFT side of the Contacts-list nav row:
                                Sylk / AddressBook source pills. Drive
                                ContactsListBox's search corpus via
                                state.contactSource.

                                The main interface now unifies the
                                Sylk + Phonebook search into a single
                                list (matching the invite-to-conference
                                behaviour), so the source picker is
                                hidden across all modes — share is
                                still Sylk-only and invite still merges
                                both, but the user no longer has to
                                pick a corpus before searching. The
                                JSX is kept (gated by `false`) so the
                                pill code path can be re-enabled
                                quickly if we change our mind. */}
                            {false && !this.props.shareToContacts && !this.props.inviteContacts ? (
                                <View style={[readyBoxPillStyles.pillGroup, readyBoxPillStyles.pillGroupLeading]}>
                                    {/* Stacked icon-button + caption layout
                                        mirroring the sort-order chips on the
                                        same row: an outer TouchableOpacity
                                        sized in column mode, a coloured
                                        circular button containing only the
                                        icon, and a small caption Text underneath
                                        (OUTSIDE the coloured chip). Reads as
                                        "tab-bar icon + label" rather than
                                        "pill with text inside it". */}
                                    <TouchableOpacity
                                        onPress={() => this.handleContactSourceChange('sylk')}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: this.state.contactSource !== 'ab' }}
                                        accessibilityLabel={
                                            this.state.contactSource !== 'ab'
                                                ? 'Searching Sylk contacts'
                                                : 'Switch to Sylk contacts'
                                        }
                                        style={readyBoxPillStyles.pillCol}
                                    >
                                        <View
                                            style={[
                                                readyBoxPillStyles.pill,
                                                this.state.contactSource !== 'ab'
                                                    ? readyBoxPillStyles.pillSylkActive
                                                    : readyBoxPillStyles.pillInactive,
                                            ]}
                                        >
                                            <MaterialCommunityIcon
                                                name="account-circle"
                                                size={20}
                                                color={this.state.contactSource !== 'ab' ? '#ffffff' : '#2980b9'}
                                            />
                                        </View>
                                        <Text
                                            style={[readyBoxPillStyles.pillCaption, { color: _readyBoxTheme.textPrimary }]}
                                            numberOfLines={1}
                                        >
                                            SIP
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={() => this.handleContactSourceChange('ab')}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: this.state.contactSource === 'ab' }}
                                        accessibilityLabel={
                                            this.state.contactSource === 'ab'
                                                ? 'Searching device contacts'
                                                : 'Switch to device contacts'
                                        }
                                        style={readyBoxPillStyles.pillCol}
                                    >
                                        <View
                                            style={[
                                                readyBoxPillStyles.pill,
                                                this.state.contactSource === 'ab'
                                                    ? readyBoxPillStyles.pillAbActive
                                                    : readyBoxPillStyles.pillInactive,
                                            ]}
                                        >
                                            {/* iOS: card-account-phone (matches
                                                iOS Contacts card-with-phone
                                                look). Android: contacts (the
                                                Material glyph used by Google
                                                Contacts). */}
                                            <MaterialCommunityIcon
                                                name={Platform.OS === 'ios'
                                                    ? 'card-account-phone'
                                                    : 'contacts'}
                                                size={20}
                                                color={this.state.contactSource === 'ab' ? '#ffffff' : '#27ae60'}
                                            />
                                        </View>
                                        <Text
                                            style={[readyBoxPillStyles.pillCaption, { color: _readyBoxTheme.textPrimary }]}
                                            numberOfLines={1}
                                        >
                                            Phonebook
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}
                            {/* RIGHT side of the Contacts-list nav row:
                                Sort / Order toggles. The wrapper takes the
                                remaining flex space, and the FlatList's
                                contentContainerStyle is overridden to
                                justifyContent: 'flex-end' so the toggles
                                hug the right edge instead of left-aligning
                                next to the pill group. categoryItems
                                returns [] when there are fewer than 10
                                contacts, in which case the FlatList renders
                                empty and the pills sit alone on the left.

                                Hidden in invite-to-conference mode — the
                                user is focused on picking participants,
                                not on filtering / sorting the corpus, and
                                the toggle pills + search bar above provide
                                the only affordances that are meaningful
                                in that workflow. */}
                            {!this.props.inviteContacts ? (
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <FlatList contentContainerStyle={[styles.navigationButtonGroup, { justifyContent: 'flex-end', flexGrow: 1 }]}
                                        horizontal={true}
                                        showsHorizontalScrollIndicator={false}
                                        ref={(ref) => { this.navigationRefCategory = ref; }}
                                        onScrollToIndexFailed={info => {
                                            const wait = new Promise(resolve => setTimeout(resolve, 10));
                                            wait.then(() => {
                                                if (!this.props.selectedContact
                                                    && this.navigationRefCategory
                                                    && this.categoryItems
                                                    && info.index < this.categoryItems.length) {
                                                    try {
                                                        this.navigationRefCategory.scrollToIndex({ index: info.index, animated: false });
                                                    } catch (e) {}
                                                }
                                            });
                                        }}
                                        data={this.categoryItems}
                                        extraData={this.state}
                                        keyExtractor={(item, index) => item.key}
                                        renderItem={this.renderNavigationItem}
                                    />
                                </View>
                            ) : null}
                        </View>
                        )
                    : null}

                    {false ?
                    <View style={navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRefSort = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.props.selectedContact
                                      && this.navigationRefSort
                                      && this.sortOrderItems
                                      && info.index < this.sortOrderItems.length) {
                                      try {
                                          this.navigationRefSort.scrollToIndex({ index: info.index, animated: false });
                                      } catch (e) {}
                                  }
                                });
                              }}
                            data={this.sortOrderItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderOrderItem}
                        />
                    </View>
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
                        <View style={URIContainerClass}>
                            {/* URIInput stretches edge-to-edge inside
                                URIContainerClass. The dialpad toggle
                                that used to sit OUTSIDE the bar (in a
                                flex-row wrapper next to it) is now an
                                overlay INSIDE the Searchbar, rendered
                                by URIInput via the showDialpad /
                                onDialpadPress / isDialpadActive props.
                                Removing the outer flex row was what
                                let the search field reclaim that
                                ~44 px column for typing. */}
                            <URIInput
                                defaultValue={this.state.searchMessages ? this.state.searchString : this.state.targetUri}
                                onChange={this.handleSearch}
                                onSelect={this.handleTargetSelect}
                                shareToContacts={this.props.shareToContacts}
                                inviteContacts={this.props.inviteContacts}
                                searchMessages={this.state.searchMessages}
                                contactSource={this.state.contactSource}
                                /* Tapping the search field kicks the
                                   address-book load (and the OS
                                   contacts-permission prompt on first
                                   use) so the unified Sylk + Phonebook
                                   search has the AB pile ready by the
                                   time the user starts typing. The
                                   helper short-circuits in share /
                                   invite / search-messages modes
                                   where the pile is not used. */
                                onSearchFocus={this.kickUnifiedSearchAddressBookLoad}
                                /* Folded + search-contacts: the
                                   navbar is hidden (see NavigationBar
                                   render gate) so URIInput becomes
                                   the only place to surface the
                                   "exit search" affordance. Wire the
                                   close-X to the existing
                                   toggleSearchContacts handler the
                                   navbar normally uses. */
                                onCloseSearch={
                                    (this.props.isFolded
                                        && this.state.searchContacts
                                        && typeof this.props.toggleSearchContacts === 'function')
                                        ? this.props.toggleSearchContacts
                                        : undefined
                                }
                                // Dialpad toggle — rendered as an
                                // overlay flush against the right
                                // edge of the Searchbar. The × clear
                                // icon sits immediately to its left.
                                // Previously gated on AB-source mode;
                                // the source picker is now hidden and
                                // the main interface runs a unified
                                // Sylk + Phonebook search, so the
                                // dialpad is offered any time the
                                // user is in normal contact-search
                                // mode (i.e. not in share / invite /
                                // message-search workflows). The
                                // backspace that used to live inside
                                // the search bar moved into the
                                // dialpad's 4th column (DTMFPad
                                // extraColumn prop, top-to-bottom:
                                // backspace, -, _).
                                showDialpad={
                                    !this.props.shareToContacts
                                    && !this.props.inviteContacts
                                    && !this.state.searchMessages
                                }
                                isDialpadActive={this.state.showAbDialpad}
                                onDialpadPress={this.toggleAbDialpad}
                                //autoFocus={this.state.searchMessages}
                                autoFocus={false}
                                dark={this.props.dark}
                            />
                            {this.state.showAbDialpad
                              && !this.props.shareToContacts
                              && !this.props.inviteContacts
                              && !this.state.searchMessages ? (
                                <View style={readyBoxDialpadStyles.dialpadWrap}>
                                    {/* Full-size keys here (no
                                        `compact`) so the pad reads
                                        like a real phone keypad —
                                        the compact preset shrunk the
                                        keys to ~78% which felt
                                        cramped for actual number
                                        entry. `extraColumn` adds a
                                        4th column (backspace, -, _,
                                        blank) tailored to SIP
                                        user-part entry: backspace
                                        deletes the last character
                                        from the search field (via
                                        onBackspace), while - and _
                                        are reported through onDigit
                                        like the rest of the keypad. */}
                                    <DTMFPad
                                        onDigit={this.handleAbDialpadDigit}
                                        extraColumn={true}
                                        onBackspace={this.handleAbDialpadBackspace}
                                        // 4th-column × clear key
                                        // (row 4 of the extra
                                        // column) — wipes the
                                        // search field via the same
                                        // path the search bar's own
                                        // × overlay uses.
                                        onClear={() => this.handleSearch('')}
                                    />
                                </View>
                            ) : null}
                        </View>
                        : null}

                           {/* Inline Back-to-call button removed: now rendered
                               as a floating overlay near the bottom of the
                               render output so it doesn't shift the chat
                               layout (and therefore the keyboard offset)
                               every time a call starts/ends. See the
                               floating-back-to-call block at the end of
                               render(). */}

                        {this.showButtonsBar ?
							<View style={uriGroupClass}>

                            {this.props.isFolded ?
                            // On foldables, hide the whole call/action
                            // button row (audio, video, mic, delete, share,
                            // etc.) when on the cover display. The Back-to-
                            // call branch above still runs when a call is in
                            // progress, so nothing important is lost.
                            null
                            :

                            <View style={[buttonGroupClass, {borderWidth: 0, borderColor: 'white'}]}>
                                  {!this.props.selectedContact && !this.props.shareToContacts && !this.props.inviteContacts?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                        style={this.chatButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                        size={32}
                                        disabled={this.chatButtonDisabled}
                                        onPress={this.handleChat}
                                        icon="chat"
                                    />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showCallButtons ? 
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.callButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.callButtonDisabled}
                                            onPress={this.handleAudioCall}
                                            icon="phone"
                                        />
                                    </TouchableHighlight>
                                  </View>

                                  : null }

                                  {this.showCallButtons?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.videoButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.videoButtonDisabled}
                                            onPress={this.handleVideoCall}
                                            icon="video"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {/* Recording-preview Play button moved
                                      into the recording panel itself,
                                      next to the slider/wave. The
                                      action-bar position is hidden to
                                      avoid duplication. */}
                                  {false && this.state.recordingFile?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={greenButtonClass}
                                            size={32}
                                            onPress={this.state.previewRecording ? this.pausePreviewAudio : this.previewAudio }
                                            icon={this.state.previewRecording ? "pause" : "play"}
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }


                                  {this.showAudioRecordButton?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                        style={blueButtonClass}
                                        size={32}
                                        onPress={this.recordAudio}
                                        icon={recordIcon}
                                    />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {/* "Share location" button — sits AFTER the
                                      Record-audio button so the three comm
                                      actions (Audio call, Video call, Record
                                      audio) stay grouped, with the location
                                      share as a distinct category on the
                                      right. Purple fill further separates it
                                      visually from the green call buttons and
                                      the blue record button. Delegates to the
                                      same NavigationBar toggle that the kebab
                                      menu's "Share location..." item uses
                                      (via the startLocationShare prop, wired
                                      in app.js). Gated on the contact having
                                      a PGP public key, because location
                                      metadata ships encrypted with no
                                      plaintext fallback. */}
                                  {this.showLocationShareButton?
                                  <View style={styles.buttonContainer}>
                                      {/* While a share is live for the
                                          currently-selected chat, swap the
                                          purple pin for a red pulsing
                                          map-marker-radius. That makes the
                                          in-chat indicator unmistakable
                                          (matching the NavBar one the user
                                          sees from other screens) and lets
                                          the tap drop them into the
                                          Stop-sharing dialog via the same
                                          pin handler. The Animated.View
                                          wraps the button so the pulse
                                          applies to the whole circle, not
                                          just the glyph. */}
                                      <TouchableHighlight style={styles.roundshape}>
                                        <Animated.View style={this._isSharingCurrentContact(this.props) ? { opacity: this._locationSharePulse } : null}>
                                            <IconButton
                                                style={this._isSharingCurrentContact(this.props) ? [purpleButtonClass, { backgroundColor: 'rgba(220, 53, 69, 0.95)' }] : purpleButtonClass}
                                                size={32}
                                                // Paper v5 renamed the glyph-tint
                                                // prop from `color` → `iconColor`;
                                                // `color` is silently ignored, which
                                                // is why the pin was still rendering
                                                // in the default dark theme tint.
                                                iconColor="white"
                                                onPress={this.handleShareLocation}
                                                icon={this._isSharingCurrentContact(this.props) ? "map-marker-radius" : "map-marker"}
                                                accessibilityLabel={this._isSharingCurrentContact(this.props) ? "Location sharing active — tap to stop" : "Share location"}
                                            />
                                        </Animated.View>
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showAudioDeleteButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={this.deleteAudio}
                                            icon="cancel"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showAudioStopButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={() => {this.stopAudioPlayer()}}
                                            icon="pause"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  
                                  { this.props.shareToContacts ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={this.cancelShareContent}
                                            icon="cancel"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null}

                                  {this.showConferenceButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.conferenceButtonDisabled ? disabledBlueButtonClass : blueButtonClass}
                                            disabled={this.conferenceButtonDisabled}
                                            size={32}
                                            onPress={this.showConferenceModal}
                                            icon="account-group"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {/* Invite-mode action pair. Visible only
                                      when the contacts list is acting as a
                                      participant picker for an ongoing
                                      conference (inviteContacts=true).
                                      Replaces the "Start conference"
                                      account-group button (gated off above
                                      via showConferenceButton) — the user
                                      already has a conference, they want
                                      to add people to it, not start a new
                                      one. Two distinct buttons so the
                                      operation is symmetric and obvious:

                                        • Cancel (red) — calls finishInvite
                                          which clears inviteContacts +
                                          selectedContacts in app.js and
                                          drops the contacts list back to
                                          normal mode WITHOUT sending any
                                          invites.

                                        • Invite (green) — calls goBackFunc
                                          (= goBackToCall in app.js). That
                                          navigates back into the
                                          ConferenceBox, whose componentDid-
                                          Mount-equivalent path then auto-
                                          calls inviteParticipants(
                                              this.state.selectedContacts)
                                          (see ConferenceBox ~line 391).
                                          Disabled until at least one
                                          contact is selected so an empty
                                          tap doesn't fall back into the
                                          conference with nothing to do.
                                      */}
                                  {/* Invite-mode Cancel / Invite buttons used to
                                      live HERE in the top action strip. They
                                      were relocated to the right side of the
                                      search bar (see the URIContainerClass
                                      block lower in this file) so the action
                                      pair sits adjacent to the picker input —
                                      one row, one focus area, no jump-up-then-
                                      look-back-down for the user. */}

                                  {this.showAudioSendButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={blueButtonClass}
                                            disabled={!this.state.recordingFile}
                                            size={32}
                                            onPress={this.sendAudioFile}
                                            icon="share"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  { this.props.shareToContacts ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={!this.props.shareToContacts ? disabledBlueButtonClass : blueButtonClass}
                                            size={32}
                                            onPress={this.shareContent}
                                            icon="share"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  { this.showQRCodeButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            onPress={this.toggleQRCodeScanner}
                                            style={styles.qrCodeButton}
                                            disabled={!this.showQRCodeButton}
                                            size={32}
                                            icon="qrcode"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null}
                            </View>
                            }

                        </View>
                        : null}

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

					  { (this.props.shareToContacts && hasImages) ?
					  <View style={{borderColor: 'white', 
					        borderWidth: 0.25, 
					        flexDirection: 'row',
							justifyContent: 'center',
							padding: 5,
							alignItems: 'center'}}>
								{Platform.OS === 'ios' ? (
								  <Switch
									value={!this.props.resizeContent}
									onValueChange={() => this.props.toggleResizeContent()}
								  />
								) : (
								  <Checkbox
									status={!this.props.resizeContent ? 'checked' : 'unchecked'}
									onPress={() => this.props.toggleResizeContent()}
								  />
								)}

							<Text style={styles.resize}>Full size</Text>
					  </View>
					  :  null}


                    { this.state.recording  ?
                        <View style={styles.recordingContainer}>
                            <View style={{borderBottom: 30}}>
                                <Title style={styles.activityTitle}>{activityTitle}</Title>
                            </View>
                            {/* Live VU meter — same widget the in-call
                                AudioCallBox uses for the live mic
                                level. Replaces the old vertical green
                                bar. Fixed 280 px width so it centres
                                cleanly via alignSelf — percentage
                                widths inside flex column parents
                                were rendering off-centre. */}
                            <View style={{ marginTop: 16, alignSelf: 'center' }}>
                                <VuMeter
                                    level={this.state.level || 0}
                                    label="Recording"
                                    width={280}
                                />
                                {/* Live elapsed-time counter, driven by
                                    audioRecorderPlayer's currentPosition
                                    (see addRecordBackListener in
                                    onStartRecord). monospace + tabular
                                    numerals so the digits don't jitter
                                    horizontally as they tick. Same 280 px
                                    width as the VuMeter so the two read
                                    as a single unit. */}
                                <Text style={{
                                    marginTop: 8,
                                    width: 280,
                                    textAlign: 'center',
                                    fontVariant: ['tabular-nums'],
                                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                    fontSize: 18,
                                    color: red[500],
                                }}>
                                    {(() => {
                                        const ms = this.state.recordingElapsedMs || 0;
                                        const totalSec = Math.floor(ms / 1000);
                                        const m = Math.floor(totalSec / 60);
                                        const s = totalSec % 60;
                                        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                                    })()}
                                </Text>
                            </View>
                        </View>
                    : null
                    }

                    { this.state.recordingFile  ?
                        <View style={styles.recordingContainer}>
                            <Title style={styles.activityTitle}>{activityTitle}</Title>
                            {(() => {
                                // Mirror the chat bubble's outgoing audio
                                // bubble layout exactly: a white rounded
                                // pill with the duration label on top,
                                // the single-channel waveform, and the
                                // slider stacked underneath, with the
                                // play button anchored on the right.
                                // What the user sees here is the same
                                // thing the recipient sees once the
                                // file lands in the chat.
                                //
                                // We render this whenever recordingFile
                                // is set — regardless of whether peaks
                                // have landed yet — so there's no flash
                                // while peaks finish snapshotting.
                                // AudioWaveform handles an empty peaks
                                // array by rendering a flat dim baseline
                                // so the layout doesn't flinch.
                                const dur = this.state.currentDurationSec || 0;
                                const pos = this.state.currentPositionSec || 0;
                                const progress = (this.state.previewRecording && dur > 0)
                                    ? Math.max(0, Math.min(100, (pos / dur) * 100))
                                    : 0;
                                const isPlaying = this.state.previewRecording;
                                const sliderWidth = 240;
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
                                const durationLabel = this.state.recordingDuration
                                    ? `Recording of ${formatAudioDuration(this.state.recordingDuration)}`
                                    : 'Recording';
                                // Bubble palette mirrors the outgoing
                                // GiftedChat audio bubble exactly: no
                                // fill (transparent), 0.5px white border,
                                // 16px radius, white text/slider/waveform.
                                // See ChatBubble.js's audio branch
                                // (currentMessage.audio) — same wrapper
                                // styling, just transposed onto a plain
                                // View since this preview lives outside
                                // the GiftedChat row.
                                return (
                                    <View style={{
                                        alignSelf: 'center',
                                        marginTop: 4,
                                        backgroundColor: 'transparent',
                                        borderRadius: 16,
                                        borderWidth: 0.5,
                                        borderColor: 'white',
                                        paddingVertical: 8,
                                        paddingHorizontal: 12,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                    }}>
                                        <View style={{
                                            flexDirection: 'column',
                                            alignItems: 'flex-end',
                                            justifyContent: 'center',
                                            paddingRight: 8,
                                        }}>
                                            <Text style={{
                                                marginBottom: 2,
                                                marginTop: 0,
                                                alignSelf: 'flex-end',
                                                fontSize: 13,
                                                color: '#fff',
                                            }} numberOfLines={1}>
                                                {durationLabel}
                                            </Text>
                                            <AudioWaveform
                                                peaks={{ l: this.state.recordingPeaks || [], r: [] }}
                                                progress={progress}
                                                width={sliderWidth}
                                                height={28}
                                                barCount={60}
                                                channel="l"
                                                playedColor="orange"
                                                unplayedColor="rgba(255,255,255,0.35)"
                                            />
                                            <AudioProgressSlider
                                                progress={progress}
                                                width={sliderWidth}
                                                height={4}
                                                knobWidth={6}
                                                knobHeight={20}
                                                color={"#ffffff"}
                                                unfilledColor="rgba(255,255,255,0.3)"
                                                knobColor={"#ffffff"}
                                                onSeekStart={() => {
                                                    if (this.state.previewRecording) {
                                                        try { audioRecorderPlayer.pausePlayer(); } catch (_e) {}
                                                    }
                                                }}
                                                onSeek={(pct) => {
                                                    if (dur > 0) {
                                                        const ms = (pct / 100) * dur;
                                                        try {
                                                            audioRecorderPlayer.seekToPlayer(ms);
                                                            if (this.state.previewRecording) {
                                                                audioRecorderPlayer.resumePlayer();
                                                            }
                                                        } catch (_e) {}
                                                    }
                                                }}
                                            />
                                        </View>
                                        {/* Play/pause button — same shape
                                            and palette as the bubble's
                                            playButton in
                                            ContactsListBox.renderMessageAudio
                                            (TouchableHighlight wrapper at
                                            48×48 with 24 radius hosting
                                            an IconButton with the blue
                                            `playAudioButton` style). */}
                                        <TouchableHighlight
                                            onPress={isPlaying ? this.pausePreviewAudio : this.previewAudio}
                                            underlayColor="transparent"
                                            style={[
                                                {
                                                    height: 48,
                                                    width: 48,
                                                    justifyContent: 'center',
                                                    borderRadius: 24,
                                                    alignSelf: 'flex-end',
                                                    marginLeft: 0,
                                                },
                                            ]}>
                                            <IconButton
                                                size={28}
                                                onPress={isPlaying ? this.pausePreviewAudio : this.previewAudio}
                                                style={{
                                                    backgroundColor: 'rgba(69, 114, 166, 1)',
                                                    marginLeft: 0,
                                                    marginRight: 0,
                                                }}
                                                iconColor="white"
                                                icon={isPlaying ? 'pause' : 'play'}
                                            />
                                        </TouchableHighlight>
                                    </View>
                                );
                            })()}
                        </View>

                    : null
                    }

                    {this.showContactsList ?
                    <View style={[historyContainer, borderClass]}>

                   {/* App-DND status pill. Persistent reminder that the
                       in-app bell is on and incoming calls are being
                       delivered silently. Tapping toggles DND off via
                       the same toggleDnd action the navbar bell uses,
                       so the user can clear it without scrolling up
                       to the header. Scope: contacts-list view only,
                       i.e. no contact currently selected — once the
                       user opens a chat, the chat header / message
                       column take over and the pill would otherwise
                       hover above the conversation, which isn't its
                       job. Also hidden in invite / share / QR /
                       message-search flows where the contacts list
                       is repurposed and the pill would crowd the
                       modal-style UI. */}
                   {this.props.appDnd
                       && !this.props.selectedContact
                       && !this.props.shareToContacts
                       && !this.props.inviteContacts
                       && !this.state.searchMessages
                       && !this.props.showQRCodeScanner ? (
                       <TouchableOpacity
                           activeOpacity={0.8}
                           onPress={() => {
                               if (typeof this.props.toggleDnd === 'function') {
                                   this.props.toggleDnd();
                               }
                           }}
                           style={readyBoxDndPillStyles.pill}
                       >
                           <MaterialCommunityIcon
                               name="bell-off-outline"
                               size={18}
                               color="#7a1d1d"
                               style={readyBoxDndPillStyles.pillIcon}
                           />
                           <View style={readyBoxDndPillStyles.pillTextWrap}>
                               <Text style={readyBoxDndPillStyles.pillTitle}>
                                   Do Not Disturb is on
                               </Text>
                               <Text style={readyBoxDndPillStyles.pillBody}>
                                   Incoming calls arrive silently. Tap to turn off.
                               </Text>
                           </View>
                       </TouchableOpacity>
                   ) : null}

                   {/* "Phonebook access is off" banner. Rendered above
                       the contacts list whenever the user has the
                       Phonebook source pill selected but the OS has
                       refused to surface its permission prompt (denied
                       once on iOS, or "don't ask again" on Android).
                       The bar explains why the list is empty and gives
                       a one-tap path to the OS Sylk preferences page —
                       same react-native-permissions openSettings()
                       helper the main-menu "App Settings" item uses.
                       Hidden in share/invite/message-search workflows
                       where the source toggle isn't visible to the
                       user anyway. */}
                   {this.state.contactSource === 'ab'
                       && this.props.abPermissionDenied
                       && !this.props.shareToContacts
                       && !this.props.inviteContacts
                       && !this.state.searchMessages ? (
                       <View style={readyBoxPermissionBannerStyles.banner}>
                           <MaterialCommunityIcon
                               name="account-cancel-outline"
                               size={22}
                               color="#b06000"
                               style={readyBoxPermissionBannerStyles.bannerIcon}
                           />
                           <View style={readyBoxPermissionBannerStyles.bannerTextWrap}>
                               <Text style={readyBoxPermissionBannerStyles.bannerTitle}>
                                   Phonebook access is off
                               </Text>
                               <Text style={readyBoxPermissionBannerStyles.bannerBody}>
                                   Open Settings to let Sylk read your contacts.
                               </Text>
                           </View>
                           <Button
                               mode="contained"
                               compact={true}
                               onPress={() => {
                                   if (typeof this.props.openAppSettings === 'function') {
                                       this.props.openAppSettings();
                                   }
                               }}
                               style={readyBoxPermissionBannerStyles.bannerButton}
                               labelStyle={readyBoxPermissionBannerStyles.bannerButtonLabel}
                           >
                               Open Settings
                           </Button>
                       </View>
                   ) : null}

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
                   <View style={URIContainerClass}>
                       {/* Cancel / Invite live INSIDE the URIInput as
                           absolute overlays (handled inside URIInput
                           itself, alongside the existing clear-× and
                           dialpad overlays). We just pass the action
                           callbacks and the enabled flag — URIInput
                           draws them when inviteContacts is true and
                           positions them at the right edge of the
                           search bar, with the existing clear-×
                           shifted further left to clear them.

                           Dialpad in invite mode: only when the user
                           has flipped the source to AddressBook AND
                           we're not in a share workflow (the share
                           path doesn't support PSTN-style entry).
                           Lets the inviter dial a phone number into
                           the search bar to add a phone-only entry
                           to the conference. */}
                       <URIInput
                           defaultValue={this.state.searchMessages ? this.state.searchString : this.state.targetUri}
                           onChange={this.handleSearch}
                           onSelect={this.handleTargetSelect}
                           shareToContacts={this.props.shareToContacts}
                           inviteContacts={this.props.inviteContacts}
                           searchMessages={this.state.searchMessages}
                           contactSource={this.state.contactSource}
                           // Dialpad is unconditionally available in
                           // invite mode (no source toggle is shown in
                           // this flow — the picker merges Sylk +
                           // Phonebook into one list, so the pad is
                           // just "type a number to add". Still hidden
                           // in share/search-messages modes, AND while
                           // the soft keyboard is up: the user is
                           // typing into the search field, the dialpad
                           // would compete for the same screen space.
                           showDialpad={
                               this.props.inviteContacts
                               && !this.props.shareToContacts
                               && !this.state.searchMessages
                               && !this.props.keyboardVisible
                           }
                           isDialpadActive={this.state.showAbDialpad}
                           onDialpadPress={this.toggleAbDialpad}
                           autoFocus={false}
                           dark={this.props.dark}
                           inviteEnabled={!!(this.props.selectedContacts && this.props.selectedContacts.length > 0)}
                           onInvitePress={this.props.goBackFunc}
                           onCancelInvitePress={this.props.finishInvite}
                       />
                       {/* Dialpad expansion under the relocated
                           invite-mode search bar. Same showAbDialpad
                           state, but here it's the invite picker's
                           pad, not the AB-browse pad — gated on
                           inviteContacts so it never doubles up with
                           the upper-bar pad when the user toggles
                           between modes. Also folded away while the
                           soft keyboard is up (the on-screen pad and
                           the system keyboard can't reasonably share
                           the bottom of the screen). */}
                       {this.props.inviteContacts
                         && this.state.showAbDialpad
                         && !this.props.shareToContacts
                         && !this.state.searchMessages
                         && !this.props.keyboardVisible ? (
                           <View style={readyBoxDialpadStyles.dialpadWrap}>
                               <DTMFPad
                                   onDigit={this.handleAbDialpadDigit}
                                   extraColumn={true}
                                   onBackspace={this.handleAbDialpadBackspace}
                               />
                           </View>
                       ) : null}
                   </View>
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
						sendMessage = {this.props.sendMessage}
						reSendMessage = {this.props.reSendMessage}
						deleteMessages = {this.props.deleteMessages}
						expireMessage = {this.props.expireMessage}
						deleteMessage = {this.props.deleteMessage}
						deleteFiles = {this.props.deleteFiles}
						getMessages = {this.props.getMessages}
						pinMessage = {this.props.pinMessage}
						unpinMessage = {this.props.unpinMessage}
						confirmRead = {this.props.confirmRead}
						inviteContacts = {this.props.inviteContacts}
						shareToContacts = {this.props.shareToContacts}
						selectedContacts = {this.props.selectedContacts}
						toggleFavorite={this.props.toggleFavorite}
						toggleAutoanswer={this.props.toggleAutoanswer}
						toggleBlocked={this.props.toggleBlocked}
						togglePinned = {this.props.togglePinned}
						pinned = {this.props.pinned}
						loadEarlierMessages = {this.props.loadEarlierMessages}
						newContactFunc = {this.props.newContactFunc}
						messageZoomFactor = {this.props.messageZoomFactor}
						isTyping = {this.state.isTyping}
						call = {this.props.call}
						keys = {this.state.keys}
						downloadFile = {this.props.downloadFile}
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
						searchMessages = {this.state.searchMessages}
						searchString = {this.state.searchString}
						recordAudio = {this.recordAudio}
						defaultConferenceDomain = {this.props.defaultConferenceDomain}
						dark = {this.props.dark}
						messagesMetadata = {this.props.messagesMetadata}
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
						playRecording = {this.state.playRecording}
						updateFileTransferMetadata = {this.props.updateFileTransferMetadata}
						isAudioRecording = {this.state.recording}
						recordingFile = {this.state.recordingFile}
						sendAudioFile = {this.sendAudioFile}
						insets = {this.props.insets}
						appState = {this.props.appState}
					/>
					}

                    </View>
                    : null
                    }

                    {this.showNavigationBar && !this.props.selectedContact ?
                    // Keying the wrapper on isFolded + orientation + window
                    // dims forces the Recents-bar FlatList (and all its Paper
                    // <Button>s, which cache their measured frame at the
                    // density they were first mounted under) to remount when
                    // the device folds/unfolds or Android toggles Default /
                    // Full Screen on the cover display. extraData={this.state}
                    // alone was insufficient because neither data nor state
                    // changed reference on a pure prop change.
                    <View
                        key={'recents-' + (this.props.isFolded ? 'f' : 'u')
                            + '-' + (this.props.orientation || '?')
                            + '-' + Math.round(width) + 'x' + Math.round(height)}
                        // Override the shared bar height — the recents
                        // bar at the BOTTOM of the contacts list
                        // hosts plain IconButtons (no caption stack
                        // underneath) so it can sit much tighter
                        // than the top sort/category bar. 34dp wraps
                        // the IconButton's ~32dp footprint with a
                        // hairline gap top/bottom. We also zero out
                        // navigationContainer's inherited
                        // `minHeight: 50` and `paddingBottom` here —
                        // those were leaving a phantom bottom margin
                        // that pushed the icons up against the top
                        // edge.
                        style={[navigationContainer, { height: 34, minHeight: 0, paddingBottom: 0 }]}
                    >
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRefMain = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.props.selectedContact
                                      && this.navigationRefMain
                                      && this.navigationItems
                                      && info.index < this.navigationItems.length) {
                                      try {
                                          this.navigationRefMain.scrollToIndex({ index: info.index, animated: false });
                                      } catch (e) {}
                                  }
                                });
                              }}
                            data={this.navigationItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
                    </View>
                    : null}


                    {this.props.isTablet && 0?
                    <View style={styles.footer}>
                        <FooterBox />
                    </View>
                        : null}

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
    loadAddressBook: PropTypes.func,
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

// Local stylesheet for the Sylk / AddressBook source pills that sit on
// the right-hand side of the contacts-list Sort/Order navigation row.
// Kept here next to the JSX it styles instead of in the global Ready
// Box stylesheet so the pill visuals are easy to find and tweak.
const readyBoxPillStyles = StyleSheet.create({
    pillGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 6,
    },
    // Variant applied when the pill group sits on the LEFT edge of
    // the nav row (Contacts-list view, where Sylk/Phonebook moved to
    // the left of the search bar and Sort/Order moved to the right).
    // Drops the marginLeft that made sense when the pills were
    // tucked next to a flex:1 wrapper on the right, and adds a small
    // marginRight so the right-side Sort/Order cluster has a bit of
    // breathing room.
    pillGroupLeading: {
        marginLeft: 0,
        marginRight: 6,
    },
    // Outer TouchableOpacity wrapper for each source button. Sized
    // and shaped like the sort-order chips so the whole row reads as
    // one ribbon of equally-weighted toggles. The label-under-button
    // layout is delegated to this column: icon chip on top, caption
    // text below, both centered horizontally.
    pillCol: {
        alignItems: 'center',
        justifyContent: 'center',
        // Tight horizontal gutter between the two pills (and between
        // this column and the sort chips immediately to its left) so
        // the right-side cluster eats less of the row. The sort-icon
        // FlatList sits in a flex:1 wrapper, so widening this column
        // also implicitly shifts those icons leftward — exactly what
        // we want when "Phonebook" needs more horizontal room than
        // "Sylk".
        marginHorizontal: 2,
        // 60 px is the smallest width that fits "Phonebook" at the
        // 9 pt 600-weight caption style without truncation, while
        // keeping the icon chip vertically centered. The Sylk
        // column gets the same width so the two read as a balanced
        // pair (its shorter label just floats centered).
        width: 60,
    },
    // The visible coloured chip — circular, just big enough to hold
    // a 20 px icon plus a hint of padding. Background carries the
    // active/inactive state; the caption beneath stays the same
    // neutral white regardless of which pill is selected (matches
    // the sort chips).
    pill: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pillSylkActive: {
        backgroundColor: '#2980b9',
        borderColor: '#2980b9',
    },
    pillAbActive: {
        backgroundColor: '#27ae60',
        borderColor: '#27ae60',
    },
    pillInactive: {
        backgroundColor: 'transparent',
        borderColor: '#cfd8dc',
    },
    // Caption is plain text below the chip — same styling shape as
    // the sort-order labels (`Time` / `Size` / `Asc` / `Desc`): tiny
    // text, centered, snug to the chip above. fontWeight pinned to
    // numeric '400' (Regular) — on Android the string 'normal' /
    // '600' can drift to Roboto Medium under Paper's inherited
    // defaults; the numeric value resolves more reliably to the
    // intended Roboto Regular cut. textTransform:none guards
    // against any uppercase parent.
    pillCaption: {
        fontSize: 9,
        fontWeight: '400',
        textTransform: 'none',
        color: '#ffffff',
        // Pull the caption right up under the chip — the previous
        // +2 left a visible gap, the user wants the chip + label to
        // read as a single stacked element.
        marginTop: -2,
        textAlign: 'center',
        backgroundColor: 'transparent',
    },
});

// Layout for the dialpad icon + inline DTMFPad attached to the
// AddressBook search row. Kept separate from the pill stylesheet so
// the two surfaces evolve independently.
const readyBoxDialpadStyles = StyleSheet.create({
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    searchInputWrap: {
        flex: 1,
    },
    iconButton: {
        marginLeft: 4,
        marginRight: 0,
        // The IconButton ships a built-in margin we don't want here;
        // padding zero keeps the icon flush with the search bar's
        // right edge and matches the height the bar settled on.
        margin: 0,
    },
    iconButtonActive: {
        backgroundColor: '#27ae60',
    },
    dialpadWrap: {
        marginTop: 6,
        paddingVertical: 4,
        // A faint divider/background separates the dialpad from the
        // contact list immediately below it, so the keypad doesn't
        // feel like it's floating over rows.
        backgroundColor: 'rgba(0,0,0,0.03)',
        borderRadius: 12,
    },
    dialpadActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingRight: 12,
        paddingTop: 4,
    },
    dialpadBackspace: {
        // White-tinted backspace control sitting on a translucent
        // dark backdrop so it reads against the soft panel below.
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderRadius: 18,
        margin: 0,
    },
});

// Inline banner shown above the contacts list when the user is on the
// Phonebook source pill but the OS contacts permission was denied (or
// is stuck in "don't ask again"). Visually a soft amber strip so it
// reads as informational, not alarming — paired with a small filled
// button on the right that opens the OS Sylk preferences page via
// react-native-permissions's openSettings() helper.
// DND-on pill rendered above the contacts list whenever
// state.accountSetting.privacy.dnd is true. Colour palette is a
// dusty pink/red (background #fde8e8, border #f3b8b8, text #7a1d1d)
// to make it visually distinct from the orange phonebook-permission
// banner directly below it — the two are otherwise structurally
// identical (row layout, leading icon, title+body text). The pill
// itself is a TouchableOpacity so the whole strip is tappable to
// flip DND back off without scrolling up to the navbar bell.
const readyBoxDndPillStyles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: '#fde8e8',
        borderColor: '#f3b8b8',
        borderWidth: 1,
        borderRadius: 20,
    },
    pillIcon: {
        marginRight: 8,
    },
    pillTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    pillTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#7a1d1d',
    },
    pillBody: {
        fontSize: 12,
        color: '#7a1d1d',
        marginTop: 1,
    },
});

const readyBoxPermissionBannerStyles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: '#fff4e0',
        borderColor: '#f1c789',
        borderWidth: 1,
        borderRadius: 8,
    },
    bannerIcon: {
        marginRight: 8,
    },
    bannerTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    bannerTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#5a3700',
    },
    bannerBody: {
        fontSize: 12,
        color: '#5a3700',
        marginTop: 1,
    },
    bannerButton: {
        marginLeft: 10,
        backgroundColor: '#b06000',
    },
    bannerButtonLabel: {
        fontSize: 12,
        color: '#ffffff',
        marginVertical: 4,
        marginHorizontal: 8,
    },
});


export default ReadyBox;
