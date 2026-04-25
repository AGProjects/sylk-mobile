// copyright AG Projects 2020-2026

import React, { Component, Fragment } from 'react';
import { Alert, View, Dimensions, SafeAreaView, ImageBackground, AppState, Linking, Platform, StyleSheet, Vibration, PermissionsAndroid, Image, PixelRatio} from 'react-native';
import { DeviceEventEmitter, BackHandler } from 'react-native';
import { Provider as PaperProvider, DefaultTheme, ActivityIndicator, Modal, Title} from 'react-native-paper';
import { registerGlobals } from 'react-native-webrtc';
import { Router, Route, Link, Switch } from 'react-router-native';
import history from './history';
import Logger from "../Logger";
import autoBind from 'auto-bind';
import messaging from '@react-native-firebase/messaging';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import RNMinimize from 'react-native-minimize';
import { NativeEventEmitter, NativeModules } from 'react-native';
import PushNotificationIOS from "@react-native-community/push-notification-ios";
import PushNotification, {Importance} from "react-native-push-notification";
import VoipPushNotification from 'react-native-voip-push-notification';
import { getApp } from '@react-native-firebase/app';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Proximity from 'react-native-proximity';

import { Appearance } from 'react-native';
import ImageResizer from 'react-native-image-resizer';
import ReactNativeBlobUtil from 'react-native-blob-util';
import debug from 'react-native-debug';

import uuid from 'react-native-uuid';
import { getUniqueId, getBundleId, isTablet, getPhoneNumber} from 'react-native-device-info';
import RNDrawOverlay from 'react-native-draw-overlay';
import Contacts from 'react-native-contacts';
import BackgroundTimer from 'react-native-background-timer';
import DeepLinking from 'react-native-deep-linking';
import base64 from 'react-native-base64';
import SoundPlayer from 'react-native-sound-player';
import OpenPGP from "react-native-fast-openpgp";
import ShortcutBadge from 'react-native-shortcut-badge';
import { getAppstoreAppMetadata } from "react-native-appstore-version-checker";
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
import {Keyboard} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNBackgroundDownloader from '@kesha-antonov/react-native-background-downloader'
import {check, request, PERMISSIONS, RESULTS, openSettings} from 'react-native-permissions';
import {decode as atob, encode as btoa} from 'base-64';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import mime from 'react-native-mime-types';
import { StatusBar } from 'react-native';
import { LogBox } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaProvider, SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { getModel, getBrand } from 'react-native-device-info';


registerGlobals();

import * as sylkrtc from 'react-native-sylkrtc';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep, { CONSTANTS as CK_CONSTANTS } from 'react-native-callkeep';
import RegisterBox from './components/RegisterBox';
import ReadyBox from './components/ReadyBox';
import Call from './components/Call';
import Conference from './components/Conference';
import FooterBox from './components/FooterBox';
import StatusBox from './components/StatusBox';
import ImportPrivateKeyModal from './components/ImportPrivateKeyModal';
import RestoreKeyModal from './components/RestoreKeyModal';
import MeetingRequestModal from './components/MeetingRequestModal';
import IncomingCallModal from './components/IncomingCallModal';
import LogsModal from './components/LogsModal';
import NotificationCenter from './components/NotificationCenter';
import LoadingScreen from './components/LoadingScreen';
import NavigationBar from './components/NavigationBar';
import Preview from './components/Preview';
import CallManager from './CallManager';
import SQLite from 'react-native-sqlite-storage';
//SQLite.DEBUG(true);console.log('content', content);
SQLite.enablePromise(true);

import xtype from 'xtypejs';
import xss from 'xss';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import momenttz from 'moment-timezone';
import utils from './utils';
import storage from './storage';
import fileType from 'react-native-file-type';
import path from 'react-native-path';

import DarkModeManager from './DarkModeManager';
const { ScreenLockModule } = NativeModules;
const { SharedDataModule } = NativeModules;
const { AndroidSettings } = NativeModules;
const { AudioRouteModule } = NativeModules;
const { UnreadModule } = NativeModules;
const { SylkBridge } = NativeModules;
const { CallEventModule } = NativeModules;
const IdleTimerModule = Platform.OS === 'ios' ? NativeModules.IdleTimerModule : null;

let platform = Platform.OS;

if (Platform.Version) {
    platform = `${platform} ${Platform.Version}`
}

if (Platform.OS === 'android') {
  const androidVersion = DeviceInfo.getSystemVersion(); // e.g. "12", "13", "15"
  platform = `Android ${androidVersion}`;
} else if (Platform.OS === 'ios') {
  platform = `iOS ${Platform.Version}`;
}

const USER_AGENT = `Sylk (${getBrand()} ${getModel()} on ${platform})`;
//const USER_AGENT_LOG = `${getBrand()} ${getModel()} ${platform}`;
const USER_AGENT_LOG = `${getModel()} ${platform}`;
  
const ANDROID_PERMISSIONS = Object.values(
  PermissionsAndroid.PERMISSIONS
);

export async function getGrantedPermissions() {
  if (Platform.OS !== 'android') {
    return [];
  }

  const grantedPermissions = [];

  for (const permission of ANDROID_PERMISSIONS) {
    try {
      const isGranted = await PermissionsAndroid.check(permission);
      if (isGranted) {
        grantedPermissions.push(permission);
      }
    } catch (err) {
      console.warn(`Error checking permission ${permission}`, err);
    }
  }

  return grantedPermissions;
}

const stripAndroidPrefix = (permission) =>
  permission.replace('android.permission.', '');
  
async function logPermissions() {
  const granted = await getGrantedPermissions();
  const cleaned = granted.map(stripAndroidPrefix);

  utils.timestampedLog('Granted permissions:', cleaned);
}

//debug.enable('sylkrtc*');
  
//import { registerForegroundListener } from '../firebase-messaging';

// Ignore all SQLite warnings
LogBox.ignoreLogs([
  'SQLite',
  'Possible unhandled promise rejection',
  'RNFB_SILENCE',
  // @react-native-community/geolocation occasionally emits a late
  // `geolocationDidChange` after clearWatch has already torn down the
  // JS-side subscription (native CLLocationManager fix was already in
  // flight). Harmless — the next watch cycle re-subscribes — but fires
  // repeatedly when a share is stopped mid-fix. Suppress so logs stay
  // readable during location-sharing sessions.
  'Sending `geolocationDidChange`',
]);

var randomString = require('random-string');

const RNFS = require('react-native-fs');
const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

const logger = new Logger("App");

function logDevices(label, devices) {
  if (!devices || devices.length === 0) {
    console.log(`-- audio device ${label}: (none)`);
    return;
  }

  console.log(`-- ${label}:`);
  devices.forEach(d => {
    if (d) {
      console.log(`  audio device: ${d.id}, name: ${d.name}, type: ${d.type}`);
    }
  });
}

function checkIosPermissions() {
    return new Promise(resolve => PushNotificationIOS.checkPermissions(resolve));
}

const KeyOptions = {
  cipher: "aes256",
  hash: "sha512",
  RSABits: 4096,
}

const max_transfer_size = 40 * 1000 * 1000;

const incomingCallLabel = 'Incoming call...';

const theme = {
    ...DefaultTheme,
    dark: true,
    roundness: 2,
    colors: {
        ...DefaultTheme.colors,
       primary: '#337ab7',
    //   accent: '#f1c40f',
    },
};

const URL_SCHEMES = [
  'sylk://',
];

const VIBRATION_PATTERN = [0, 1000, 4000];

let bundleId = `${getBundleId()}`;

const version = '1.0.0';
const MAX_LOG_LINES = 500;

let deviceId = getUniqueId();

if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    //bundleId = 'com.agprojects.sylk-ios.dev';
}

const unreadCounterTypes = new Set([
  'text/html',
  'text/plain',
  'application/sylk-file-transfer'
]);

const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
	chunks.push(array.slice(i, i + size));
  }
  return chunks;
};
	
const getSafeTimestamp = (message) =>
  new Date(message.timestamp)
    .toISOString()
    .replace(/[:]/g, '-')
    .replace('T', '_')
    .split('.')[0];

const mainStyle = StyleSheet.create({

 MainContainer: {
   flex: 1,
   justifyContent: 'center',
   alignItems: 'center',
 }
});

function _parseSQLDate(key, value) {
    return new Date(value);
}

function validateBase64Image(uri) {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      () => resolve(true),
      () => resolve(false)
    );
  });
}

(function() {
    if ( typeof Object.id == "undefined" ) {
        var id = 0;
        Object.id = function(o) {
            if ( o && typeof o.__uniqueid == "undefined" ) {
                Object.defineProperty(o, "__uniqueid", {
                    value: ++id,
                    enumerable: false,
                    // This could go either way, depending on your
                    // interpretation of what an "id" is
                    writable: false
                });
            }

            return o ? o.__uniqueid : null;
        };
    }
})();

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
	console.log('User pressed an action in the background', detail.pressAction);
  }
});
		
async function fixDirectoryStructure(suffix = 'sufix') {
  const basePath = `${RNFS.DocumentDirectoryPath}/${suffix}`;

  try {
    // Read all entries under the suffix folder
    const entries = await RNFS.readDir(basePath);

    for (const user1Entry of entries) {
      if (!user1Entry.isDirectory()) continue;
      const user1Path = user1Entry.path;

      const user2Entries = await RNFS.readDir(user1Path);

      for (const user2Entry of user2Entries) {
        if (!user2Entry.isDirectory()) continue;
        const user2Path = user2Entry.path;

        const uuidEntries = await RNFS.readDir(user2Path);

        for (const uuidEntry of uuidEntries) {
          if (!uuidEntry.isDirectory()) continue;

          const currentFolder = uuidEntry.path;
          const uuidName = path.basename(currentFolder);

          const targetFolder = path.join(user1Path, uuidName);

          // Ensure parent exists
          const targetParentExists = await RNFS.exists(user1Path);
          if (!targetParentExists) {
            await RNFS.mkdir(user1Path);
          }

          // Move UUID folder (with all files/folders inside)
          await RNFS.moveFile(currentFolder, targetFolder);
          console.log(`Moved ${currentFolder} -> ${targetFolder}`);
        }
      }
    }
  } catch (error) {
    //console.log('Error fixing directory structure:', error);
  }
}

function guessExtension(mime) {
  if (!mime) return '';
  return '.' + mime.split('/')[1];
}

function unwrapMessage(msg: any) {
    // If the message is wrapped in _j (Reanimated / proxy object), return that
    if (msg && typeof msg === "object" && "_j" in msg) {
        return msg._j;
    }
    return msg;
}


// Only override once
if (!console.log.__isWrapped) {
  const originalLog = console.log;

/// if (Platform.OS === 'ios') {
//   // mute all logs on iOS
//   console.log = () => {};
//  } else {
    const LOG_PREFIX = `[${USER_AGENT_LOG}]`;
    console.log = function(...args) {
      originalLog(LOG_PREFIX, ...args);
    };
//  }

  
  console.log.__isWrapped = true; // mark as wrapped
}


class Sylk extends Component {
    constructor() {
        super();
        autoBind(this)
        this._loaded = false;
        let isFocus = Platform.OS === 'ios';
        this.startTimestamp = new Date();
        this.phoneWasLocked = false;
        this._insets = {"bottom": 0, "left": 0, "right": 0, "top": 0};

        this.notificationCenterRef = React.createRef();
        // Used so deleteMessage can call into NavigationBar to cancel an
        // active location-sharing timer when the user deletes the live
        // location bubble (origin tick).
        this.navigationBarRef = React.createRef();
        this.cdu_counter = 1;
        this.lastServerJournalId = null;
        this.pushTokenSent = false;

        // "Until we meet" (meeting_request) handshake state. Kept off React
        // state so additions don't trigger renders on every metadata tick;
        // only the presented modal + pending-by-uri queue are in state.
        //
        // handledMeetingRequestIds — request _ids we've already presented
        //   (or auto-handled) so the modal never pops twice for the same
        //   request. Hydrated from AsyncStorage on mount; persisted there
        //   on every change so the guarantee survives restart.
        //
        // pendingMeetingRequests   — {uri: {requestId, expiresAt, fromUri}}
        //   request arrived while that uri's chat wasn't open. When the
        //   user opens that chat, we drain the entry into the modal.
        //
        // handledAcceptanceIds     — request _ids for which we've already
        //   rendered the "peer accepted" system note on the requester side.
        //   Dedupes across retries / per-tick re-entries of the handler.
        this.handledMeetingRequestIds = new Set();
        this.pendingMeetingRequests = {};
        this.handledAcceptanceIds = new Set();
        // Set of _ids of location-sharing origin ticks we sent with
        // meeting_request:true. Used to recognise incoming acceptance
        // ticks (metadata.in_reply_to === one of these _ids) and render
        // the one-time "peer accepted" system message. Hydrated from
        // AsyncStorage on mount.
        this.myOutgoingMeetingRequestIds = new Set();
        // Set of incoming meeting request _ids that we have ACCEPTED on
        // this device. Mirror of myOutgoingMeetingRequestIds for the
        // accepter side: used by _injectLocationBubble to suppress the
        // duplicate outgoing bubble we would otherwise draw for our own
        // reply tick (whose in_reply_to points back at the request we
        // already rendered as an incoming bubble). Peer coords end up
        // merged into the incoming bubble via the peerCoords pipeline.
        this.acceptedMeetingRequestIds = new Set();

        // Set of peer URIs this device has successfully met with in at
        // least one past "Until we meet" session (i.e. proximity-met
        // has fired with them before). Used by _maybeFireProximityMeet
        // to pick the initiator greeting variant:
        //   • first time   → "Nice to meet you!"
        //   • met already  → "Nice to meet you again!"
        // Persisted alongside the other handshake state so it survives
        // app restarts and re-installs of the same account.
        this.metPeerUris = new Set();

        // Sessions for which we've already emitted the
        // "Location sharing stopped at HH:MM" system note (either from
        // local proximity detection OR from a peer's meeting_end signal
        // carrying reason='proximity'). Both sides of a meeting run
        // proximity detection independently AND emit a meeting_end
        // signal back to each other — without dedup, every session
        // would log the stop note twice on each device. In-memory only:
        // a session id only matters inside the brief window between
        // first emission and the session being wiped.
        this._proximityNotedSessionIds = new Set();

        // Per-session distance band for the [meet] narrative logger.
        // We only print a distance line when it crosses a band boundary
        // (km → hundreds → tens → <= threshold), never on every tick.
        // Map<sessionId, bandName>.
        this._meetLastDistanceBand = {};

        // Pending wipe timers keyed by sessionId (the original request
        // _id). When the clock reaches expires_at we wipe the session's
        // messages from both SQL and live state on this device. A map so
        // we can de-duplicate scheduling if the same session is observed
        // twice (e.g. once on incoming request, once on outgoing echo).
        this.meetingSessionWipeTimers = {};

        // Pairing state for "Until we meet" sessions, keyed by sessionId
        // (= the original request envelope _id). Populated lazily as
        // location ticks flow through handleMessageMetadata:
        //   {
        //     requesterUri, requesterOriginId, requesterCoords,
        //     accepterUri,  accepterOriginId,  accepterCoords
        //   }
        // The "Coords" fields hold the latest {latitude, longitude,
        // accuracy, timestamp} for that side. When both sides are present
        // we cross-inject peerCoords into each bubble's location metadata
        // so LocationBubble can render two markers on the same map. Kept
        // off React state (GC is handled at session wipe) because it's
        // written on every tick and we don't want renders for that.
        this.meetingSessions = {};

		this.deviceId = getUniqueId();
		this.contactIndex = {};
		this.contactsIndexes = {};
		this.lastLookupKey = null;
		// URIs to which we've already pushed our PGP public key during
		// this app run. Same-domain peers never need a push (their server
		// lookup will return the key if it exists); cross-domain peers
		// need it once and only once per process lifetime.
		this.sentPublicKeyUris = new Set();
		this.wiping = false;
		this.configurations = {};

        this._initialState = {
            appState: null,
            configurationUrl: 'https://download.ag-projects.com/Sylk/Mobile/config.json',
		    wsUrl: 'wss://webrtc-gateway.sipthor.net:9999/webrtcgateway/ws',
		    testConnectionUrl: null,
            defaultDomain: 'sylk.link',
            sylkDomain: 'sylk.link',
            publicUrl: 'https://webrtc.sipthor.net',
            defaultConferenceDomain: 'videoconference.sip2sip.info',
            enrollmentUrl: 'https://blink.sipthor.net/enrollment-sylk-mobile.phtml',
            iceServers: [{"urls":"stun:stun.sipthor.net:3478"}],
            serverSettingsUrl: 'https://mdns.sipthor.net/sip_settings.phtml',
            fileTransferUrl: 'https://webrtc-gateway.sipthor.net:9999/webrtcgateway/filetransfer',
            fileSharingUrl: 'https://webrtc-gateway.sipthor.net:9999/webrtcgateway/filesharing',
			// No hard-coded default test numbers. Test numbers are populated
			// from the per-server sylk-config.json (configuration.testNumbers)
			// via downloadSylkConfiguration(). If a server publishes none,
			// none are created.
			testNumbers: [],

			passwordRecoveryUrl: 'https://mdns.sipthor.net/sip_login_reminder.phtml',
			deleteAccountUrl: 'http://delete.sylk.link',
            configurationJson: null,
            serverIsValid: true,
            terminatedReason: null,
            inFocus: true,
            accountId: '',
            password: '',
            displayName: '',
            fontScale: 1,
            email: '',
            organization: '',
            account: null,
            keyStatus: {},
            lastSyncId: null,
            accountVerified: false,
            registrationState: null,
            registrationKeepalive: false,
            incomingCall: null,
            currentCall: null,
            connection: null,
            showScreenSharingModal: false,
            status: null,
            targetUri: '',
            missedTargetUri: '',
            loading: null,
            syncConversations: false,
            localMedia: null,
            generatedVideoTrack: false,
            contacts: [],
            devices: {},
            speakerPhoneEnabled: null,
            orientation : 'portrait',
            keyboardVisible: false,
            Height_Layout : '',
            Width_Layout : '',
            outgoingCallUUID: null,
            incomingCallUUID: null,
            incomingContact: null,
            keyboardHeight: 0,
            hardware: '',
            phoneNumber: '',
            isTablet: isTablet(),
            refreshHistory: false,
            refreshFavorites: false,
            myPhoneNumber: '',
            favoriteUris: [],
            blockedUris: [],
            missedCalls: [],
            initialUrl: null,
            reconnectingCall: false,
            muted: false,
            participantsToInvite: [],
            myInvitedParties: {},
            showLogsModal: false,
            logs: '',
            proximityEnabled: true,
            messages: {},
            selectedContact: null,
            // Mirror of NavigationBar's activeLocationShares map
            // ({ [uri]: expiresAtMs }). Kept here so ReadyBox can pulse
            // its chat-header "Share location" button while a share is
            // running for the currently selected contact, and so
            // NavigationBar can gate its own indicator when the user is
            // already inside that chat. NavigationBar pushes updates via
            // the `onActiveSharesChanged` callback.
            activeLocationShares: {},
            callsState: {},
            keys: null,
            showImportPrivateKeyModal: false,
            privateKey: null,
            privateKeyImportStatus: '',
            privateKeyImportSuccess: false,
            inviteContacts: false,
            shareToContacts: false,
            sharedContent: [],
            forwardContent: [],
            selectedContacts: [],
            pinned: false,
            callContact: null,
            messageLimit: 100,
            messageZoomFactor: 1,
            messageStart: 0,
            contactsLoaded: false,
            updateContacts: {},
            blockedContacts: {},
            decryptingMessages: {},
            purgeMessages: [],
            showCallMeMaybeModal: false,
            enrollment: false,
            contacts: [],
            isTyping: false,
            avatarPhotos: {},
            avatarEmails: {},
            showConferenceModal: false,
            keyDifferentOnServer: false,
            serverPublicKey: null,
            generatingKey: false,
            appStoreVersion: null,
            keysNotFound: false,
            showLogo: true,
            historyFilter: null,
            showExportPrivateKeyModal: false,
            showRestoreKeyModal: false,
            showQRCodeScanner: false,
            navigationItems: {today: false, recent: false, conference: false},
            myuuid: null,
            isTexting: false,
            filteredMessageIds: [],
            contentTypes: {},
            dnd: false,
            rejectAnonymous: false,
            chatSounds: true,
            readReceipts: true,
            rejectNonContacts: false,
            headsetIsPlugged: false,
            sortBy: 'timestamp',
            transferedFiles: {},
            transferedFilesSizes: {},
            searchMessages: false,
            searchContacts: false,
            dark: false,
            fullScreen: false,
            transferProgress: {},
            incomingMessage: {},
            totalMessageExceeded: false,
            availableAudioDevices: [],
            selectedAudioDevice: null,
            userSelectedDevice: null,
            userChangedAudioDevice: false,
            // True when the device is folded far enough that the earpiece is
            // physically unusable (e.g. Motorola Razr past ~85° hinge). Reported
            // from the native AudioRouteModule. Used to hide BUILTIN_EARPIECE
            // from the audio device menu and auto-flip the selection to speaker.
            // Start as null rather than false so `_detectOrientation` can
            // distinguish "confirmed unfolded" from "sensor hasn't fired yet"
            // and fall back to a safer layout rule while waiting for the
            // first native reading. See _detectOrientation for why this
            // matters on the Razr cover display.
            isFolded: null,
            waitForCommunicationsDevicesChanged: false,
            connectivity: null,
            proximityNear: false,
            SylkServerDiscovery: false,
            SylkServerDiscoveryResult: null,
            testConnection: null,
            insets: {"bottom": 0, "left": 0, "right": 0, "top": 0},
            addresBookLoaded: false,
            fullscreen: false,
            storageUsage: [],
            syncPercentage: 100,
            refetchMessagesForUri: null,
            devMode: false,
            resizeContent: false,
            autoAnswerMode: false,
            hasAutoAnswerContacts: false,
            allContacts: [],
            accounts: {},
            serversAccounts: {},
			verifiedAccounts: {},
            remoteConferenceRoom: null,
            remoteConferenceDomain: null,
			conferenceConnection: null,
			hasHeadset: false
        };

        this.buildId = "2026022201";

        utils.timestampedLog('Init app with id', this.buildId);
        utils.timestampedLog('USER_AGENT', USER_AGENT);

        this.timeoutIncomingTimer = null;

		this.handledCalls = new Set();
		this.messagesConfirmedRead = new Set();

        this.downloadRequests = {};
        this.uploadRequests = {};
        this.decryptRequests = {};
        this.cancelDecryptRequests = {};
        this.uploadedFiles = new Set();

        this.pendingNewSQLMessages = [];
        this.syncStartTimestamp = null;

        this.syncRequested = false;
        this.mustSendPublicKey = false;
        this.conferenceEndedTimer = null;
        this.unsubscribeNetInfo = null;

        this.syncTimer = null;
        this.outgoingMedia = null;
        this.participantsToInvite = [];
        this.signOut = false;
        this.signIn = false;
        this.currentRoute = null;
        this.pushtoken = null;
        this.pushkittoken = null;
        this.intercomDtmfTone = null;
        this.registrationFailureTimer = null;
        this.startedByPush = false;
        this.heartbeats = 0;

        this._onFinishedPlayingSubscription = null
        this._onFinishedLoadingSubscription = null
        this._onFinishedLoadingFileSubscription = null
        this._onFinishedLoadingURLSubscription = null

        this.cancelRingtoneTimer = null;
    
        this.keyboardDidShowListener = null;

        this.state = Object.assign({}, this._initialState);

        // Extra UI state added directly to this.state (rather than
        // _initialState) because the logout path resets state back to
        // _initialState — a live meeting-request modal is UI-only and
        // should not survive a logout anyway.
        this.state.meetingRequestModal = {
            show: false,
            fromUri: null,
            requestId: null,
            expiresAt: null,
        };

        this.myParticipants = {};
        this.outgoingJournalEntries = {};
        
        this.outgoingNotifications = {};

        this._historyConferenceParticipants = new Map(); // for saving to local history

        this._terminatedCalls = new Map();

        this.__notificationCenter = null;

        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.goToReadyTimer = null;
        this.incoming_sound_ts = null;
        this.outgoing_sound_ts = null;
        this.initialChatUri = null;
        this.mustPlayIncomingSoundAfterSync = false;
        this.ringbackActive = false;
        this.sharedAndroidFiles = [];
        this.localiOSPushSubscriber = null;
        this.remoteiOSPushSubscriber = null;
        this.cancelledUploads = {};

        this.callKeeper = new CallManager(RNCallKeep,
                                                this.showAlertPanel,
                                                this.acceptCall,
                                                this.rejectCall,
                                                this.hangupCall,
                                                this.timeoutCall,
                                                this.callKeepStartConference,
                                                this.startCallFromCallKeeper,
                                                this.toggleMute,
                                                this.getConnection,
                                                this.addHistoryEntry,
                                                this.changeRoute,
                                                this.respawnConnection,
                                                this.isUnmounted
                                                );

        if (InCallManager.recordPermission !== 'granted') {
            /*
            console.log('InCallManager request record permission');
            InCallManager.requestRecordPermission()
            .then((requestedRecordPermissionResult) => {
                console.log("InCallManager.requestRecordPermission() requestedRecordPermissionResult: ", requestedRecordPermissionResult);
            })
            .catch((err) => {
                console.log("InCallManager.requestRecordPermission() catch: ", err);
            });
            */
        } else {
            //console.log('InCallManager recordPermission', InCallManager.recordPermission);
        }

        storage.initialize();

        // Load camera/mic preferences
        storage.get('devices').then((devices) => {
            if (devices) {
                this.setState({devices: devices});
            }
        });

        storage.get('myParticipants').then((myParticipants) => {
            if (myParticipants) {
                this.myParticipants = myParticipants;
                //console.log('My participants', this.myParticipants);
            }
        });
        
        storage.remove('last_signup');
        storage.remove('signup');
        storage.remove('account');        

        storage.get('outgoingJournalEntries').then((outgoingJournalEntries) => {
            if (outgoingJournalEntries) {
                this.outgoingJournalEntries = outgoingJournalEntries;
            }
        });

        storage.get('devMode').then((devMode) => {
            if (devMode) {
                console.log('Developer mode enabled');
                this.devMode = true;
            }
        });

        storage.get('autoAnswerMode').then((autoAnswerMode) => {
            if (autoAnswerMode) {
                this.setState({autoAnswerMode: true});
            }
        });

        storage.get('proximityEnabled').then((proximityEnabled) => {
            this.setState({proximityEnabled: proximityEnabled});
        });

        if (this.state.proximityEnabled) {
            console.log('Proximity sensor enabled');
        } else {
            console.log('Proximity sensor disabled');
        }

        for (let scheme of URL_SCHEMES) {
            DeepLinking.addScheme(scheme);
        }

        this.sqlTableVersions = {'messages': 16,
                                 'contacts': 12,
                                 'accounts': 17
                                 }
                                   
        this.db = null;

        if (Platform.OS === 'android') {
			this.checkInstaller();

			this.boundWiredHeadsetDetect = this._wiredHeadsetDetect.bind(this);
			DeviceEventEmitter.addListener('WiredHeadset', this.boundWiredHeadsetDetect);

			DeviceEventEmitter.addListener('ShareIntentReceived',
				payload => {
					this.handleAndroidShare(payload)
				  // route to contacts, parse link, etc
				}
			  );
        }
        		
		DarkModeManager.addListener((isDark) => {
		    this.onDarkModeChanged(isDark); // optional callback
		});

     }

	 async purgeSharedFiles() {
		 for (const file of this.sharedAndroidFiles) {
		    console.log('purgeSharedFiles', file);
			try {
				if (await RNFS.exists(file.filePath)) {
					await RNFS.unlink(file.filePath);
					console.log('Deleted', file.filePath);
				}
			} catch (err) {
				//console.warn('Error purgeSharedFiles file', file, err);
			}
		}

        if (Platform.OS === "android") {
            ReceiveSharingIntent.clearReceivedFiles();
        }
	
	  if (Platform.OS === 'ios') {
		  try {
			const result = await SharedDataModule.purgeAppGroupContainer();
			//console.log('[JS] App Group container purged:', result);
		  } catch (err) {
			console.error('[JS] Failed to purge App Group container:', err);
		  }
	  }

	}

	async fetchSharedItemsiOS() {
		if (Platform.OS !== 'ios') {
			return;
		} 

	    console.log('---fetchSharedItemsiOS');
	    //this.purgeSharedFiles();

		  // 1. Get the App Group container path
		  const appGroupPath = await SharedDataModule.appGroupContainerPath();
		  
		  const sharedFiles = await this.getSharedFiles();
		  if (sharedFiles.length === 0) {
			  //console.log('No shared files');
			  return;
		  }

		  //console.log('Shared container:', appGroupPath);
		  sharedFiles.forEach((file) => {
		      file.filePath = file.path; 
		      file.fileName = file.name;
		      file.mimeType = mime.lookup(file.name); 
		      //console.log(file);
		  });

 		    console.log('Share', sharedFiles.length, 'items');

			this.setState({shareToContacts: true,
						   sharedContent: sharedFiles,
						   selectedContact: null});

			let what = 'Share text with contacts';
			let item = files[0];
			if (item.weblink) {
				what = 'Share web link with contacts';
			}

			if (item.path) {
				what = 'Share file with contacts';
			}
			

			this._notificationCenter.postSystemNotification(what);
		  
	  }
  
	  startWatchingNetwork() {
		// Avoid duplicate listeners
		if (this.unsubscribeNetInfo) return;
	
		this.unsubscribeNetInfo = NetInfo.addEventListener((state) => {
		  const isWifi = state.type === "wifi";
		  const isMobile = state.type === "cellular";
	
		  //console.log("Network changed:", state.type, "connected:", state.isConnected);
	
		  if (isWifi) {
	         this.setState({connectivity: 'wifi'});

			//console.log("Connected via Wi-Fi");
			this.onWifi();
		  } else if (isMobile) {
			//console.log("Connected via Mobile Data");
			this.setState({connectivity: 'mobile'});
			this.onMobile();
		  }
		});
	  }
	  
	 stopWatchingNetwork() {
		if (this.unsubscribeNetInfo) {
		  this.unsubscribeNetInfo();
		  this.unsubscribeNetInfo = null;
		}
	  }
	
	  async getCurrentNetwork() {
		const state = await NetInfo.fetch();
		return {
		  isConnected: state.isConnected,
		  isWifi: state.type === "wifi",
		  isMobile: state.type === "cellular",
		  type: state.type,
		  details: state.details,
		};
	  }
	
	  onWifi() {
		// Your custom logic when switching to Wi-Fi
		//console.log("-> Switched to Wi-Fi");
	  }
	
	  onMobile() {
		// Your custom logic when switching to mobile data
		//console.log("-> Switched to Mobile Data");
	  }

  
	async getSharedFiles() {
	  try {
		const appGroupPath = await SharedDataModule.appGroupContainerPath();
	
		// List all files in the App Group container
		const files = await RNFS.readDir(appGroupPath);
	
		// Filter files that start with 'share-'
		const shareFiles = files.filter(file => file.name.startsWith('share-'));
	
		return shareFiles;
	  } catch (err) {
		console.error('[JS] Error listing App Group files:', err);
		return [];
	  }
	}
	
	  onDarkModeChanged(isDark) {
		console.log('Dark mode is now', isDark);
		this.setState({dark: isDark});
		// You can update your class state or trigger a re-render in your app
	  }

    _wiredHeadsetDetect(data) {
        console.log('-- Wired headset:', data);
        // {'isPlugged': boolean, 'hasMic': boolean, 'deviceName': string }
        this.setState({'headsetIsPlugged': data.isPlugged});
        if (data.isPlugged) {
           this.speakerphoneOff();
        }
    }

    async requestNotificationsPermission() {
        //console.log('requestNotificationsPermission');
        if (Platform.OS !== 'android') {
            return;
        }
       await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    }

	async  displayJoinNotification() {
	  await notifee.requestPermission();
	
	  await notifee.displayNotification({
		title: 'Join Conference',
		body: 'Tap to join',
		android: {
		  channelId: 'calls',
		  importance: AndroidImportance.HIGH,
		  pressAction: {
			id: 'default',
		  },
		},
		ios: {
		  categoryId: 'call',
		},
	  });
	}
	
    async requestPhonePermission () {
        if (Platform.OS !== 'android') {
            return;
        }

        let granted_POST_NOTIFICATIONS = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');

        let granted = await PermissionsAndroid.request('android.permission.READ_PHONE_NUMBERS');

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.log("Phone permission denied");
            return false;
        }

        return true;
    }

	async requestDndPermission() {
        if (Platform.OS !== 'android') {
            return;
        }

	  const hasAccess = await AndroidSettings.hasDndAccess();

	  if (!hasAccess) {
		const asked = await AsyncStorage.getItem("askedDndPermission");
		if (asked === "true") {
		  //console.log('Already asked the user to allow bypass DND')
		  return; // user already went to the Modes access screen
		}

		Alert.alert(
		  "Allow Priority Notifications",
		  "To receive messages or calls during Do Not Disturb / Bedtime mode, Sylk needs permission.",
		  [
			{ text: "Cancel", style: "cancel" },
			{ text: "Open Settings", onPress: () => AndroidSettings.openDndAccessSettings() }
		  ]
		);
	  } else {
	   console.log('Already allow bypass DND')
	  }
	  await AsyncStorage.setItem("askedDndPermission", "true");	

	}

    async requestStoragePermission() {
        if (Platform.OS !== 'android') {
            return;
        }

        const granted = await PermissionsAndroid.request(
			PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
			{
			  title: 'Storage Permission Required',
			  message: 'App needs access to your storage to share files',
			  buttonNeutral: 'Ask Me Later',
			  buttonNegative: 'Cancel',
			  buttonPositive: 'OK',
			}
		);

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.log("Storage permission denied");
            return false;
        }
        return true;
    }

	async fetchWithTimeout(url, options = {}, timeout = 5000) {
	  const controller = new AbortController();
	  const id = setTimeout(() => controller.abort(), timeout);
	
	  try {
	    console.log('fetchWithTimeout', url);
		const response = await fetch(url, {
		  ...options,
		  signal: controller.signal,
		  headers: {
				'Cache-Control': 'no-cache',
				'Pragma': 'no-cache',
			},
		});
		return response;
	  } finally {
		clearTimeout(id);
	  }
	}

   toggleAutoAnswerMode() {
		// Enable babysitter mode
		if (Platform.OS !== 'ios') {
			return;
		}
		
		if (!this.state.autoAnswerMode) {
	        storage.set('autoAnswerMode', 1);
	        console.log('Enable auto-answer mode');
			//this._notificationCenter.postSystemNotification("For unattended monitoring, enable Guided Access in Settings");
		} else {
			storage.remove('autoAnswerMode');
	        console.log('Disable auto-answer mode');
		}

		IdleTimerModule.setIdleTimerDisabled(!this.state.autoAnswerMode);
        this.setState({autoAnswerMode: !this.state.autoAnswerMode});   
	}
	
	toggleDevMode() {
        if (!this.state.devMode) {
	        storage.set('devMode', 1);
			console.log('Developer mode enabled');
	    } else {
			storage.remove('devMode');
			console.log('Developer mode disabled');
	    }

		this.setState({devMode: !this.state.devMode});
	}

	toggleResizeContent() {
		this.setState({resizeContent: !this.state.resizeContent});
	}

	async lookupSylkServer(domain, checkOnly = false, force = false) {
		console.log(' --- lookupSylkServer', domain, 'checkOnly', checkOnly, 'force', force);
	
		if (domain == this.state.sylkDomain && checkOnly) {
			// Optionally skip
			console.log('No new domain chosen');
			return;
		}

		const configurationsString = await AsyncStorage.getItem("configurations");
		this.configurations = configurationsString ? JSON.parse(configurationsString) : {};

		let closeConnection = domain != this.state.sylkDomain;

		if (closeConnection) {
			// Fix C: domain is actually changing. Drop any stale account/registration
			// state from the previous domain BEFORE we tear down the old connection,
			// otherwise leftover this.state.account / registrationState from the
			// previous server can bleed into the new one.
			console.log('LO - [lookupSylkServer] domain change -> clearing account/registrationState');
			this.setState({
				account: null,
				registrationState: null,
				registrationKeepalive: false
			});

			if (this.state.connection !== null) {
				console.log('Disconnecting existing connection');
				this.state.connection.close();
			}
		}

		this.setState({SylkServerDiscovery: true, 
		               SylkServerDiscoveryResult: null, 
		               SylkServerStatus: ''
		               });
	
		const fallbackUrl = `https://mdns.sipthor.net/dnslookup.php?name=_sylkserver.${domain}&type=TXT`;
		const primaryUrl = `https://dns.google/resolve?name=_sylkserver.${domain}&type=TXT`;
	
		const fetchDns = async (url) => {
			const res = await this.fetchWithTimeout(url, {}, 3000);
			return await res.json();
		};
	
		let data;
		let triedFallback = false;
	
		try {
			console.log('Checking primary URL', primaryUrl);
			data = await fetchDns(primaryUrl);
		} catch (err) {
			console.log('Primary fetch timed out, trying fallback...');
			triedFallback = true;
			try {
				data = await fetchDns(fallbackUrl);
			} catch (fallbackErr) {
				console.log('Fallback fetch also failed', fallbackErr);

				this.setState({
					SylkServerDiscovery: false,
					SylkServerStatus: 'No DNS TXT record',
					SylkServerDiscoveryResult: 'noDNSrecord'
				});

			    await this.initWithCachedDomain(domain);
				return;
			}
		}
	
	    //console.log('data', data);
		const answers = data.Answer?.map(a => a.data.replace(/^"|"$/g, '')) || [];
		const configurationUrl = Array.isArray(answers) && answers.length === 1 ? answers[0] : null;
		console.log('DNS response', configurationUrl);
	
		if (!configurationUrl) {
			this.setState({
				SylkServerDiscovery: false,
				SylkServerDiscoveryResult: 'noDNSrecord',
				SylkServerStatus: 'No DNS TXT record'
			});
			console.log('no configurationUrl');
			return;
		}
	
		if (checkOnly) {
			this.setState({ serverIsValid: configurationUrl != null });
			await this.downloadSylkConfiguration(domain, configurationUrl, checkOnly);
		} else if (configurationUrl) {
			console.log('Sylkserver configuration URL', configurationUrl);
			this.setState({ configurationUrl: configurationUrl });
			await this.downloadSylkConfiguration(domain, configurationUrl, false, closeConnection, force);
		}
	}

    async initWithCachedDomain(domain, closeConnection) {
		console.log('initWithCachedDomain', domain);

		if (!(domain in this.configurations)) {
			console.log('Domain configuration is not yet cached', domain);
			return;
		}

		const configuration = this.configurations[domain];

		if (configuration) {
			console.log('Cached configuration found');
			const configurationString = JSON.stringify(configuration);
			const res = await this.initConfiguration(configurationString, "cache");

			if (res) {
				Object.keys(json).forEach((key) => {
					//utils.timestampedLog('Cached config', key, json[key]);
				});

				// Fix B: do NOT create a connection here. initConfiguration above
				// will setState({ wsUrl }), and componentDidUpdate's cdu-wsUrl
				// branch is now the single owner of connection creation.
				console.log('LO - [initWithCachedDomain] delegating connect to cdu-wsUrl');

				this.setState({
					SylkServerDiscovery: false,
					SylkServerDiscoveryResult: 'ready'
				});

				return true;						
			}
		}
	}

	resetSylkServerStatus() {
		this.setState({SylkServerDiscoveryResult: '', SylkServerDiscovery: false, SylkServerStatus: ''});
	}

	async downloadSylkConfiguration(domain, url, checkOnly = false, closeConnection = false, force = false) {
	
	  console.log("downloadSylkConfiguration:", domain, 'force', force);
	  console.log('Configurations cache', Object.keys(this.configurations));

	  this.setState({configurationJson: null});

	  try {
		const response = await this.fetchWithTimeout(url, {}, 3000);

		if (!response.ok) {
		  this.setState({SylkServerDiscoveryResult: 'noJson', 
		                 SylkServerDiscovery: false,  
		                 SylkServerStatus: 'No config for ' + domain});

		  console.log("Failed to download JSON: " + response.status);

		  if (force) {
		    await this.initWithCachedDomain(domain);
		  }

		  return;
		}

		const json = await response.json();
		if (!json || !json.wsServer) {
		    this.setState({SylkServerDiscoveryResult: 'noWsServer', 
			                SylkServerDiscovery: false,
			                SylkServerStatus: 'No server available'
			                });

			if (force) {
			    await this.initWithCachedDomain(domain);
			}
			return;
		}
		
		json.sylkDomain = domain;
		json.configurationUrl = url;
		const jsonString = JSON.stringify(json);
		
		if (checkOnly) {
			let wsUrl = json.wsServer;
			this.setState({configurationJson: jsonString, testConnectionUrl: wsUrl});
			this.testConnectionToSylkServer(wsUrl);
			return;
		}
		
		const res = await this.initConfiguration(jsonString, "url");
		if (res) {
			Object.keys(json).forEach((key) => {
				//utils.timestampedLog('Config', key, json[key]);
			});
			
			if (closeConnection) {
			    // Fix B: initConfiguration above will setState({ wsUrl }), and
			    // componentDidUpdate's cdu-wsUrl branch is now the single owner of
			    // (re)connecting to the new Sylk server.
			    console.log('LO - [downloadSylkConfiguration] delegating connect to cdu-wsUrl');
			}

			await AsyncStorage.setItem("configuration", jsonString);

            if (this.state.accountId) {
				setTimeout(() => {
					this.createTestNumbers();
				}, 100);
			}

			this.configurations[domain] = json;
			let configurationsString = JSON.stringify(this.configurations);
			await AsyncStorage.setItem("configurations", configurationsString);
		}
	
		return json;
	  } catch (error) {
		  this.setState({SylkServerDiscovery: false, SylkServerStatus: 'DNS configuration unavailable'});
		  console.log("downloadSylkConfiguration error:", error);
		  if (force) {
		    await this.initWithCachedDomain(domain);
		  }

		  return;
	  }
	}

    async requestCameraPermission() {
        //console.log('Request camera permission');

        if (Platform.OS === 'ios') {
            check(PERMISSIONS.IOS.CAMERA).then((result) => {
                switch (result) {
                  case RESULTS.UNAVAILABLE:
                    console.log('Camera feature is not available (on this device / in this context)');
                    break;
                  case RESULTS.DENIED:
                    console.log('Camera permission has not been requested / is denied but requestable');
                    this._notificationCenter.postSystemNotification("Access to camera is denied. Go to Settings -> Sylk to enable access.");
                    break;
                  case RESULTS.LIMITED:
                    console.log('Camera permission is limited: some actions are possible');
                    break;
                  case RESULTS.GRANTED:
                    //console.log('Camera permission is granted');
                    break;
                  case RESULTS.BLOCKED:
                    this._notificationCenter.postSystemNotification("Access to camera is denied. Go to Settings -> Sylk to enable access.");
                    console.log('Camera permission is denied and not requestable anymore');
                    break;
                }
          }).catch((error) => {
          });
          return true;
        }

        if (Platform.OS === 'android') {
            try {
                let granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.CAMERA,
                    {
                    title: "Camera permission",
                    message:
                      "Sylk needs access to your camera " +
                      "for video calls",
                    buttonNeutral: "Ask Me Later",
                    buttonNegative: "Cancel",
                    buttonPositive: "OK"
                    }
                );

                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    console.log("Camera permission denied");
                    return false;
                }

                return true;
            } catch (err) {
                console.warn(err);
                return false;
            }
        }
    }

    async requestDisplayOverOtherAppsPermission () {
        if (Platform.OS !== 'android') {
            return;
        }

        RNDrawOverlay.checkForDisplayOverOtherAppsPermission()
             .then(res => {
                //utils.timestampedLog("Display over other apps was granted");
                 // res will be true if permission was granted
             })
             .catch(e => {
                utils.timestampedLog("Display over other apps was declined");
                setTimeout(() => {
                    this.openAppSettings("Advanced / Allow display over other apps must be allowed");
                }, 2000);
             // permission was declined
             });

        return;
    }

    async requestMicPermission(requestedBy) {
        //console.log('Request mic permission by', requestedBy);

        if (Platform.OS === 'ios') {
            check(PERMISSIONS.IOS.MICROPHONE).then((result) => {
                switch (result) {
                  case RESULTS.UNAVAILABLE:
                    console.log('Mic feature is not available (on this device / in this context)');
                    break;
                  case RESULTS.DENIED:
                    console.log('Mic permission has not been requested / is denied but requestable');
                    this._notificationCenter.postSystemNotification("Access to microphone is denied. Go to Settings -> Sylk to enable access.");
                    break;
                  case RESULTS.LIMITED:
                    console.log('Mic permission is limited: some actions are possible');
                    break;
                  case RESULTS.GRANTED:
                    //console.log('Mic permission is granted');
                    break;
                  case RESULTS.BLOCKED:
                    this._notificationCenter.postSystemNotification("Microphone permission. Go to Settings -> Sylk to enable access.");
                    console.log('Mic permission is denied and not requestable anymore');
                    break;
                }
          }).catch((error) => {
          });

          return true;
        }

        if (Platform.OS === 'android') {
            try {

                const granted = await PermissionsAndroid.request(
                  PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                  {
                    title: "Microphone permission",
                    message:
                      "Sylk needs access to your microphone " +
                      "for audio calls.",
                    buttonNeutral: "Ask Me Later",
                    buttonNegative: "Cancel",
                    buttonPositive: "OK"
                  }
                );

                const granted_bluetooth = await PermissionsAndroid.request(
                  PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
                  {
                    title: "BLUETOOTH audio permission",
                    message:
                      "Sylk may need access to BLUETOOTH devices " +
                      "for audio calls.",
                    buttonNeutral: "Ask Me Later",
                    buttonNegative: "Cancel",
                    buttonPositive: "OK"
                  }
                );

                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    this._notificationCenter.postSystemNotification("Microphone permission denied");
                    return false;
                }

                return true;

            } catch (err) {
                console.warn(err);
                return false;
            }
        }
    };

    useExistingKeys() {
        console.log('Use this device PGP key');
        this.sendPublicKey(this.state.accountId, true);
    }

    async savePrivateKey(keys) {
        let keyStatus = this.state.keyStatus;

		await this.waitForContactsLoaded();

        keyStatus.existsLocal = true;
        
        this.setState({keys: {private: keys.private, public: keys.public},
					   showImportPrivateKeyModal: false,
					   keyStatus: {...keyStatus} 
                    });

        if (this.state.account) {

            let accountId = this.state.account.id;
            let existingContacts = this.lookupContacts(accountId);

			existingContacts.forEach(contact => {
				contact.publicKey = keys.public;
				this.saveSylkContact(accountId, contact, 'PGP key generated');
            });

            setTimeout(() => {
                this.sendPublicKey();
            }, 100);

        } else {
            console.log('Send 1st public key later');
            this.mustSendPublicKey = true;
        }

		this.updateKeySql(keys);

        // On fresh enrollment the order is: registration completes BEFORE keys
        // exist locally, so requestSyncConversations() fires once and bails with
        // "Wait for sync until we have keys", and nothing retries it. That means
        // afterFirstSync() never runs -> no test numbers, no "Account activated"
        // welcome message. Now that keys exist, retry the deferred first sync
        // if the account is already registered and we have not yet synced.
        if (this.state.account
                && this.state.registrationState === 'registered'
                && !this.state.lastSyncId
                && !this.state.syncConversations
                && !this.syncRequested) {
            console.log('LO - keys ready after registration, retrying deferred first sync');
            this.requestSyncConversations(null);
        }

        params = [this.state.accountId];
        await this.ExecuteQuery("update messages set encrypted = 1 where encrypted = 3 and account = ?", params).then((result) => {
            console.log(result.rowsAffected, 'messages updated for decryption later');

        }).catch((error) => {
            console.log('SQL keys update error:', error);
        });
    }

	async getConnectionType() {
	  const state = await NetInfo.fetch();
	
	  if (!state.isConnected) return "none";
	
	  if (state.type === "wifi") return "wifi";
	  if (state.type === "cellular") return "cellular";
	
	  return "unknown";
	}

    async saveLastSyncId(id, force=false) {
        if (!force) {
            if (!this.state.keys || !this.state.keys.private) {
               console.log('Skip saving last sync id until we have a private key');
               return
            }
        }

		let timestamp = new Date();
        let params = [id, JSON.stringify(timestamp), this.state.accountId];

        await this.ExecuteQuery("update accounts set last_sync_id = ?, last_sync_timestamp = ?  where account = ?", params).then((result) => {
            this.setState({lastSyncId: id});
        }).catch((error) => {
            console.log('Save last sync id SQL error:', error);
        });
    }

    async updateKeySql(keys) {
        let params = [keys.private, keys.public, this.state.accountId];

        await this.ExecuteQuery("update accounts set private_key = ?, public_key = ? where account = ?", params).then((result) => {
            console.log('SQL updated account private key');
			this._notificationCenter.postSystemNotification('Private key updated');
        }).catch((error) => {
            console.log('SQL update account error:', error);
        });
    }

	async checkFirstSync() {
		try {
			const firstSync = await AsyncStorage.getItem("firstSync");
			if (firstSync === "1") {
				this.setState({ firstSync: true });
				console.log('Is still first time sync', firstSync);
			} else {
				this.setState({ firstSync: false });
				//console.log('Is not first time sync', firstSync);
			}
		} catch (error) {
			console.error("Error reading firstSync", error);
		}
	}

    async getDownloadTasks() {
        //console.log('-- getDownloadTasks');
        let lostTasks = await RNBackgroundDownloader.checkForExistingDownloads();
        if (lostTasks.length > 0) {
            console.log('Download lost tasks', lostTasks);
        }

        for (let task of lostTasks) {
            console.log(task); 
            if (task.url && task.destination) {
                console.log(`Download task ${task.id} was found:`, task.url);
                task.progress((percent) => {
                    console.log(task.url, `Downloaded: ${percent * 100}%`);
                }).done(() => {
                    this.saveDownloadTask(id, task.url, task.destination);
                }).error((error) => {
                    console.log(task.url, 'download error:', error);
                });
            } else {
                console.log('Removing broken download', task.id);
                task.stop() 
             }
        }
    }

    async generateKeys() {
        console.log('Generating PGP keys...');

        const Options = {
          comment: 'Sylk key',
          email: this.state.accountId,
          name: this.state.displayName || this.state.accountId,
          keyOptions: KeyOptions
        }

        utils.timestampedLog('Generating PGP keys...');
        this.setState({loading: 'Generating private key...', generatingKey: true});

        await OpenPGP.generate(Options).then((keys) => {
            const public_key = keys.publicKey.replace(/\r/g, '').trim();
            const private_key = keys.privateKey.replace(/\r/g, '').trim();
            keys.public = public_key;
            keys.private = private_key;
            utils.timestampedLog("PGP keypair generated");
            this.setState({loading: null, generatingKey: false});
            this.setState({showImportPrivateKeyModal: false});

            this.savePrivateKey(keys);

            this.showCallMeModal();

        }).catch((error) => {
            console.log("PGP keys generation error:", error);
        });
    }

    async resetStorage(days) {
        console.log('Reset storage');

        if (days > 365) {
		    await this.ExecuteQuery('delete from contacts where account = ?', [this.state.accountId]).then((result) => {
                if (result.rowsAffected > 0) {
                    console.log(result.rowsAffected, 'contacts deleted');
                }
			}).catch((error) => {
				console.log('SQL resetStorage error:', error);
			});

		    await this.ExecuteQuery('delete from messages where account = ?', [this.state.accountId]).then((result) => {
                if (result.rowsAffected > 0) {
                    console.log(result.rowsAffected, 'messages deleted');
                }
			}).catch((error) => {
				console.log('SQL resetStorage error:', error);
			});

			this.setState({allContacts: [], messages: {}});
        } else  {
			const msAgo = days * 24 * 60 * 60 * 1000;
			const unix_timestamp = Math.floor((Date.now() - msAgo) / 1000);
		    await this.ExecuteQuery('delete from messages where account = ? and unix_timestamp > ?', [this.state.accountId, unix_timestamp]).then((result) => {
                if (result.rowsAffected > 0) {
                    console.log(result.rowsAffected, 'messages deleted');
                }
			}).catch((error) => {
				console.log('SQL resetStorage error:', error);
			});
        }
 
        this.saveLastSyncId(null);
    }

    async toggleDnd () {
        console.log('Toggle DND to', !this.state.dnd);

        if (!this.state.dnd) {
            this._notificationCenter.postSystemNotification('Do not disturb with new calls');
        } else {
            this._notificationCenter.postSystemNotification('I am available for new calls');
        }
        
        const dnd = (!this.state.dnd) ? '1': '0';
		let params = [dnd, this.state.account.id];

		this.setState({dnd: !this.state.dnd})

		await this.ExecuteQuery("update accounts set dnd = ? where account = ?", params).then((result) => {
			console.log('SQL update dnd for account:', dnd);
		}).catch((error) => {
			console.log('SQL update dnd error:', error);
		});
    }

    async toggleRejectAnonymous () {
        //console.log('Toggle reject anonymous to', !this.state.rejectAnonymous);
        if (this.state.rejectAnonymous) {
            this._notificationCenter.postSystemNotification('Allow anonymous callers');
        } else {
            this._notificationCenter.postSystemNotification('Reject anonymous callers');
        }

        this.setState({rejectAnonymous: !this.state.rejectAnonymous})
        
        const rejectAnonymous = (!this.state.rejectAnonymous) ? '1': '0';
		let params = [rejectAnonymous, this.state.account.id];
		await this.ExecuteQuery("update accounts set reject_anonymous = ? where account = ?", params).then((result) => {
			console.log('SQL update reject anonymous for account OK');
		}).catch((error) => {
			console.log('SQL update reject anonymous error:', error);
		});
    }

    async toggleChatSounds () {
        if (!this.state.chatSounds) {
            this._notificationCenter.postSystemNotification('Play chat sounds');
        } else {
            this._notificationCenter.postSystemNotification('No chat sounds');
        }

        this.setState({chatSounds: !this.state.chatSounds})

        const chatSounds = (!this.state.chatSounds) ? '1': '0';
		let params = [chatSounds, this.state.account.id];
		await this.ExecuteQuery("update accounts set chat_sounds = ? where account = ?", params).then((result) => {
			console.log('SQL update chatSounds for account OK', chatSounds);
		}).catch((error) => {
			console.log('SQL update chatSounds error:', error);
		});
    }

    async toggleReadReceipts () {
        // Toggle whether this account sends "displayed" IMDN read receipts
        // for incoming messages. When OFF, the local "received" state still
        // gets advanced (so the UI knows the message has been read on this
        // device) but the network notification to the sender is suppressed.
        if (this.state.readReceipts) {
            this._notificationCenter.postSystemNotification('Read receipts off');
        } else {
            this._notificationCenter.postSystemNotification('Read receipts on');
        }

        this.setState({readReceipts: !this.state.readReceipts});

        const readReceipts = (!this.state.readReceipts) ? '1' : '0';
        let params = [readReceipts, this.state.account.id];
        await this.ExecuteQuery("update accounts set read_receipts = ? where account = ?", params).then((result) => {
            console.log('SQL update readReceipts for account OK', readReceipts);
        }).catch((error) => {
            console.log('SQL update readReceipts error:', error);
        });
    }

    async toggleRejectNonContacts () {
        //console.log('Toggle reject anonymous to', !this.state.rejectAnonymous);
        if (this.state.rejectNonContacts) {
            this._notificationCenter.postSystemNotification('Allow all callers');
        } else {
            this._notificationCenter.postSystemNotification('Reject callers not in my contact list');
        }

        this.setState({rejectNonContacts: !this.state.rejectNonContacts})
        
        const rejectNonContacts = (!this.state.rejectNonContacts) ? '1': '0';
		let params = [rejectNonContacts, this.state.account.id];
		await this.ExecuteQuery("update accounts set reject_non_contacts = ? where account = ?", params).then((result) => {
			console.log('SQL update reject non contacts for account OK');
		}).catch((error) => {
			console.log('SQL update reject non contacts error:', error);
		});
    }

    async toggleSearchMessages () {
        //console.log('toggle search messages');
        this.setState({searchMessages: !this.state.searchMessages});
    }

    async toggleSearchContacts () {
        //console.log(' -- toggle search contacts', !this.state.searchContacts);
        this.setState({searchContacts: !this.state.searchContacts});
    }

	async getChatContacts() {
		  try {
			const results = await this.ExecuteQuery(
			  "SELECT from_uri, MAX(timestamp) as last_timestamp FROM messages WHERE to_uri = ? GROUP BY from_uri",
			  [this.state.accountId]
			);
		
			const contacts = {}; // from_uri -> last_timestamp
			const rows = results.rows;
		
			for (let i = 0; i < rows.length; i++) {
			  const item = rows.item(i);
			  contacts[item.from_uri] = item.last_timestamp;
			}
		
			return contacts;
		  } catch (error) {
			console.error('Failed to get recent contacts:', error);
			return {};
		  }
		};

    async requestContactsPermission() {
        console.log('Request contacts permission...');
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
            {
              title: 'Sylk contacts',
              message: 'Sylk will ask for permission to read your contacts',
              buttonPositive: "Next"
            }
          )

          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
               console.log("You can now read your contacts")
               this.getABContacts();

          } else {
               console.log("Read contacts permission denied")
			   this.setState({addresBookLoaded: true });

          }
        } catch (err) {
          console.warn(err)
        }
      }

	async loadAddressBook() {		
		  const permission = await new Promise((resolve, reject) => {
			Contacts.checkPermission((err, permission) => {
			  if (err) return reject(err);
			  resolve(permission);
			});
		  });
		
		  //console.log('AB Contacts permission:', permission);
		
		  if (permission === 'authorized') {
			await this.getABContacts();
			return;
		  }
		
		  if (Platform.OS === 'android') {
			await this.requestContactsPermission(); // make this return a Promise too
		  } else {
			await new Promise((resolve, reject) => {
			  Contacts.requestPermission((err, permission) => {
				if (err) return reject(err);
				resolve(permission);
			  });
			});
		  }
		}
		
	// Make getABContacts return a Promise so we can await it
	async getABContacts() {
		  //console.log('getABContacts');
		
		  const contacts = await new Promise((resolve, reject) => {
			Contacts.getAll((err, contacts) => {
			  if (err) return reject(err);
			  resolve(contacts);
			});
		  });
		
		  console.log('getABContacts returned', contacts.length, 'contacts');
		
		  let contact_cards = [];
		  let avatarPhotos = {};
		  let avatarEmails = {};
		  let seen_uris = new Map();
		
		  for (let contact of contacts) {
			let name = contact.givenName && contact.familyName
			  ? `${contact.givenName} ${contact.familyName}`
			  : contact.givenName || contact.familyName || contact.company;
		
			if (!name) continue;
		
			let photo = contact.hasThumbnail ? contact.thumbnailPath : null;
		
			contact.phoneNumbers.forEach(number => {
			  let number_stripped = number.number.replace(/\s|\-|\(|\)/g, '');
			  if (number_stripped && !seen_uris.has(number_stripped)) {
				contact_cards.push({
				  id: uuid.v4(),
				  name: name.trim(),
				  uri: number_stripped,
				  type: 'contact',
				  photo,
				  label: number.label,
				  tags: ['contact'],
				});
				if (photo) avatarPhotos[name.trim().toLowerCase()] = photo;
				seen_uris.set(number_stripped, true);
			  }
			});
		
			contact.emailAddresses.forEach(email => {
			  let email_stripped = email.email.replace(/\s|\(|\)/g, '');
			  if (email_stripped && !seen_uris.has(email_stripped)) {
				contact_cards.push({
				  id: uuid.v4(),
				  name: name.trim(),
				  uri: email_stripped,
				  type: 'contact',
				  photo,
				  label: email.label,
				  tags: ['contact'],
				});
				if (photo) avatarPhotos[email_stripped] = photo;
				seen_uris.set(email_stripped, true);
			  }
			});
		  }
		
		  this.setState({ contacts: contact_cards, avatarPhotos, avatarEmails });
		  this.setState({addresBookLoaded: true });
	}

    async loadSylkContacts(origin) {
        if (this.state.contactsLoaded) {
            return;
        }

        if (!this.state.accountId) {
            console.error('loadSylkContacts cannot load without accountId');
            return;
        }

        console.log('LO - loading Sylk contacts...');

        await this.loadAddressBook();
        
        let blockedUris = [];
        let favoriteUris = [];
        let missedCalls = [];
        let myInvitedParties = {};
        let localTime;
        let email;
        let contact;
        let timestamp;
        let allContacts = [];
        let displayName;
        let uniqueUris = {};

        this.setState({defaultDomain: this.state.accountId.split('@')[1]});
        
        console.log('Loading Sylk contacts....');
        
        this.ExecuteQuery("SELECT * FROM contacts where account = ? order by timestamp desc",[this.state.accountId]).then((results) => {
            let rows = results.rows;
            let idx;
            let formatted_date;
            let updated;
            //console.log(rows.length, 'SQL contacts rows');

            if (rows.length > 0) {
                for (let i = 0; i < rows.length; i++) {
                    var item = rows.item(i);
                    updated = null;

                    if (!item.uri) {
                        continue;
                    }

                    contact = this.newContact(item.uri, item.name, {sqlItem: item});

                    if (!contact) {
                        continue;
                    }

                    let ab_contacts = this.lookupABContacts(contact.uri);

                    if (ab_contacts.length > 0) {
                        if (!contact.name || contact.name === '') {
                            console.log('Update display name', contact.name, 'of', contact.uri, 'to', ab_contacts[0].name);
                            contact.name = ab_contacts[0].name;
                            updated = 'name';
                        }
                    }

                    if (contact.lastMessageId || contact.publicKey) {
                        if (contact.tags.indexOf('chat') === -1) {
                            contact.tags.push('chat');
                            updated = 'tags';
                        }
                    }

                    if (!contact.photo) {
                        var name_idx = contact.name.trim().toLowerCase();
                        if (name_idx in this.state.avatarPhotos) {
                            contact.photo = this.state.avatarPhotos[name_idx];
                            updated = 'photo';
                        } else if (contact.uri in this.state.avatarPhotos) {
                            contact.photo = this.state.avatarPhotos[contact.uri];
                            updated = 'photo';
                        }
                    }

                    if (!contact.email) {
                        var name_idx = contact.name.trim().toLowerCase();
                        if (name_idx in this.state.avatarEmails) {
                            contact.email = this.state.avatarEmails[name_idx];
                            updated = 'email';
                        }
                    }

                    if (contact.tags.indexOf('missed') > -1) {
                        missedCalls.push(contact.last_call_id);
                        if (contact.unread.indexOf(contact.last_call_id) === -1) {
                            contact.unread.push(contact.last_call_id);
                        }
                    } else {
                        idx = contact.unread.indexOf(contact.last_call_id);
                        if (idx > -1) {
                            contact.unread.splice(idx, 1);
                        }
                    }

                    if (contact.uri === this.state.accountId) {
                        displayName = (contact.name && contact.name !== 'Myself') ? contact.name : '';
                    
                        this.setState({displayName: displayName, organization: contact.organization});
                        
                        if (email && !contact.email) {
                            contact.email = email;
                        } else {
                            this.setState({email: contact.email});
                        }
                    }

                    formatted_date = contact.timestamp.getFullYear() + "-" + utils.appendLeadingZeroes(contact.timestamp.getMonth() + 1) + "-" + utils.appendLeadingZeroes(contact.timestamp.getDate()) + " " + utils.appendLeadingZeroes(contact.timestamp.getHours()) + ":" + utils.appendLeadingZeroes(contact.timestamp.getMinutes()) + ":" + utils.appendLeadingZeroes(contact.timestamp.getSeconds());

                    if(contact.participants) {
                        myInvitedParties[contact.uri.split('@')[0]] = contact.participants;
                    }

                    if (contact.tags.indexOf('blocked') > -1) {
                        blockedUris.push(contact.uri);
                    }

                    if (contact.tags.indexOf('favorite') > -1) {
                        favoriteUris.push(contact.uri);
                    }

                    if (updated) {
                        this.saveSylkContact(contact.uri, contact, 'AddressBook');
                    }
                    
					if (contact.uri in uniqueUris) {
					   uniqueUris[contact.uri].push(contact.id);
					} else {
						uniqueUris[contact.uri] = [contact.id]
					}
					
                    allContacts.push(contact);

					//console.log(' -- Loaded contact', contact.id, contact.uri);

                    //console.log('Load contact', contact.uri, contact.tags, contact.properties);
                }

                utils.timestampedLog('SQL loaded', rows.length, 'contacts for account', this.state.accountId);
                //console.log(' --- pending incomingMessage', this.state.incomingMessage);
                Object.keys(this.state.incomingMessage).forEach((key) => {
                    const msg = this.state.incomingMessage[key];
                    if (msg) {
						const existingContacts = this.lookupContacts(key);
	
						existingContacts.forEach(contact => {
							if (!Array.isArray(contact.unread)) {
								contact.unread = [];
							}
							// prevent duplicate unread ids
							if (!contact.unread.includes(msg._id)) {
								contact.unread.push(msg._id);
							}
						
							contact.timestamp = msg.createdAt;
							contact.lastMessageId = msg._id;
						});
					}

				});
				
				const idsToPurge = Object.values(uniqueUris)
				  .filter(ids => ids.length > 1)
				  .flatMap(ids => ids.slice(1));
				
				//console.log(idsToPurge);

				const purgeSet = new Set(idsToPurge);
				
				const filteredContacts = allContacts.filter(
				  contact => !purgeSet.has(contact.id)
				);

				const duplicateContacts = allContacts.filter(
				  contact => purgeSet.has(contact.id)
				);
				
			    for (const contact of duplicateContacts) {		
					 console.log(' -- Duplicate contact', contact.id, contact.uri);
			    }

				this.deleteDuplicateContacts(purgeSet);
				
                this.setState({allContacts: filteredContacts,
                               missedCalls: missedCalls,
                               favoriteUris: favoriteUris,
                               myInvitedParties: myInvitedParties,
                               blockedUris: blockedUris
                               });
            }

			this.setState({contactsLoaded: true});

            this.refreshNavigationItems();

            setTimeout(() => {
                this.fetchSharedItemsAndroidAtStart();
				this.fetchSharedItemsiOS();
                if (this.initialChatUri) {
                    //console.log('Starting chat with', this.initialChatUri);
                    const chatContact = this.lookupContact(this.initialChatUri, true, true);
					this.initialChatUri = null;
                }
            }, 100);

            setTimeout(() => {
                //this.getMessages();
            }, 500);
        });

    }


	async checkFileTransfer(file_transfer) {
        //console.log('checkFileTransfer', file_transfer.metadata.transfer_id);
        if (file_transfer.metadata.local_url) {
          const exists = await RNFS.exists(file_transfer.metadata.local_url);
          if (!exists && !file_transfer.metadata.error) {
              //console.log('FT local url does not exist', file_transfer.metadata.local_url);
              //console.log('FT error', file_transfer.metadata.error);  
              this.autoDownloadFile(file_transfer.metadata);
          }
        }
    }

	componentDidUpdate(prevProps, prevState) {
	     if (this.wiping) {
			 return;
	     }

	     if (this.state.accountId != prevState.accountId) {
		     console.log(this.cdu_counter, 'LO - CDU --- accountId changed', prevState.accountId, '->', this.state.accountId);
			 this.cdu_counter = this.cdu_counter + 1;
			 this.loadAccount();
		 }

	     if (this.state.account != prevState.account) {
			 console.log(this.cdu_counter, 'CDU --- account did change', this.state.account?.id);
			 this.cdu_counter = this.cdu_counter + 1;
			 if (this.state.account && this.state.accountVerified) {
//				 this.requestSyncConversations(this.state.lastSyncId);
//				 this.replayJournal();
			 }
	     }

	     if (this.state.messageZoomFactor != prevState.messageZoomFactor) {
		      console.log('messageZoomFactor has changed', this.state.messageZoomFactor);
	     }

	     if (this.state.keys != prevState.keys) {
		      //console.log('keys have changed', this.state.keys);
		 }

	     if (this.state.accountVerified != prevState.accountVerified) {
			 console.log(this.cdu_counter, 'CDU --- accountVerified did change', this.state.accountVerified);
			 this.cdu_counter = this.cdu_counter + 1;
	     }

	     if (this.state.keyStatus !== prevState.keyStatus) {
			 console.log(this.cdu_counter, 'CDU --- keyStatus changed', 'local', this.state.keyStatus.existsLocal, 'remote', this.state.keyStatus.existsOnServer);
			 this.cdu_counter = this.cdu_counter + 1;
			 this.generateKeysIfNecessary();
	     }
		     
	     if (this.state.callContact != prevState.callContact) {
		      //console.log('callContact has changed', this.state.callContact);
	     }
	     
	     if (this.state.allContacts !== prevState.allContacts) {
			 //console.log('-- allContacts has changed', this.state.allContacts.length);
			 for (const contact of this.state.allContacts) {		
			     //console.log(contact.id, contact.uri);
			 }
			 
			 this.buildContactIndex();
			 this.anyContactHasAutoAnswer(); 
			 this.updateTotalUnread();
 		 }

	     if (this.state.syncConversations != prevState.syncConversations) {
			 console.log(this.cdu_counter, 'CDU --- syncConversations did change', this.state.syncConversations);
			 this.cdu_counter = this.cdu_counter + 1;
	     }

	     if (this.state.hasAutoAnswerContacts != prevState.hasAutoAnswerContacts) {
			 console.log(' --- hasAutoAnswerContacts did change', this.state.hasAutoAnswerContacts);
			 if (!this.state.hasAutoAnswerContacts && this.state.autoAnswerMode) {
				 this.toggleAutoAnswerMode();
			 }
	     }

	     if (this.state.lastSyncId != prevState.lastSyncId) {
			 console.log(' --- lastSyncId did change', this.state.lastSyncId);
	     }

	     if (this.state.resizeContent != prevState.resizeContent) {
			 console.log(' --- resizeContent did change', this.state.resizeContent);
	     }

	     if (this.state.refetchMessagesForUri != prevState.refetchMessagesForUri) {
			 console.log(' --- refetchMessagesForUri did change', this.state.refetchMessagesForUri);
	     }

	     if (this.state.insets != prevState.insets) {
			 //console.log(' --- insets did change', this.state.insets);
	     }

	     if (this.state.fullscreen != prevState.fullscreen) {
			 //console.log(' --- fullscreen did change', this.state.fullscreen);
	     }
	
	     if (this.state.registrationState != prevState.registrationState) {
			 //console.log(this.cdu_counter, 'CDU --- registrationState did change', this.state.registrationState);
	     }

	     if (this.state.addresBookLoaded != prevState.addresBookLoaded) {
		     console.log(this.cdu_counter, 'CDU --- AddresBook loaded');
			 this.cdu_counter = this.cdu_counter + 1;
		 }

	     if (this.state.storageUsage != prevState.storageUsage) {
		     //console.log(this.cdu_counter, 'CDU --- Storage usage calculated', this.state.storageUsage);
			 this.cdu_counter = this.cdu_counter + 1;
		 }

	     if (this.state.contactsLoaded != prevState.contactsLoaded) {
			 console.log(this.cdu_counter, 'CDU --- Contacts loaded');
			 this.cdu_counter = this.cdu_counter + 1;
			 this.addChatContacts();
			 this.getDownloadTasks();
			 this.getStorageUsage();
	     }

		 if (!utils.deepEqual(this.state.keyStatus, prevState.keyStatus)) {
			 console.log(this.cdu_counter, 'CDU --- keyStatus changed', this.state.keyStatus);
			 this.cdu_counter = this.cdu_counter + 1;
		 }
		
	     if (this.state.selectedContact != prevState.selectedContact) {
	         if (this.state.selectedContact) {
	             const uri = this.state.selectedContact.uri;
	             
	             if (this.state.searchContacts) {
					 this.setState({searchContacts: false});
	             }

	             if (prevState.selectedContact && prevState.selectedContact.uri == uri) {
					 //console.log('selectedContact is the same', this.state.selectedContact?.id);
	                 // no change
	             } else {
					 console.log('selectedContact changed', this.state.selectedContact.uri, this.state.selectedContact.timestamp);
					 
					 this.setState({messageZoomFactor: 1});

	                 //this.getStorageUsage(uri);

					setTimeout(() => {
					 if (Platform.OS === 'android') {
						 SylkBridge.setActiveChat(uri);
						 UnreadModule.resetUnreadForContact(uri);
					 } else {
						 NativeModules.SharedDataModule.setActiveChat(uri); 
					 }

					 this.messagesConfirmedRead.clear();
					 this.getMessages(this.state.selectedContact, {origin: 'selectedContact changed',});
					}, 100);

				 }
			 }
	     }

		 if (prevState.orientation !== this.state.orientation) {
			 //this.setState({searchContacts: this.state.orientation == 'portrait'});
		 }
		 
		 if (prevState.userSelectedDevice !== this.state.userSelectedDevice && this.state.userSelectedDevice) {
			 //console.log('userSelectedDevice changed', prevState.userSelectedDevice, '->', this.state.userSelectedDevice);
			 this.setState({userSelectedDevice: null, waitForCommunicationsDevicesChanged: true});
			 if ( !this.useInCallManger) {
				 setTimeout(() => {this.setState({waitForCommunicationsDevicesChanged: false});
												AudioRouteModule.getEvent();
												}, 2000);
				 AudioRouteModule.setActiveDevice(this.state.userSelectedDevice);
			 } else {
				 // On Android < 31 (InCallManager path) there is no native event that
				 // confirms the route change and resets waitForCommunicationsDevicesChanged.
				 // Reset it immediately so subsequent selections are not blocked.
				 this.setState({waitForCommunicationsDevicesChanged: false});
			 }
		 }

		if (this.state.proximityEnabled && !this.state.hasHeadset && !this.state.isFolded && prevState.proximityNear !== this.state.proximityNear && this.activeCall) {
			if (this.state.proximityNear) {
				if (this.useInCallManger) {
					this.speakerphoneOff();
				} else {
					this.selectAudioDevice('BUILTIN_EARPIECE');
				}
			} else {
				if (this.useInCallManger) {
				   this.speakerphoneOn();
				} else {
					this.selectAudioDevice('BUILTIN_SPEAKER');
				}
			}
         }

		 if (prevState.selectedDevice !== this.state.selectedDevice ) {
		     //console.log('selectedDevice changed', prevState.selectedDevice ,  '->' , this.state.selectedDevice);
			 this.setState({selectedAudioDevice: this.state.selectedDevice? this.state.selectedDevice.type: null});
		 }	 

		 // When the hinge sensor transitions between null/false/true, the
		 // tablet layout decision in _detectOrientation depends on that
		 // new value. Re-run detection so isTablet updates immediately
		 // rather than waiting for the next Dimensions.change event (which
		 // may not fire on a fold/unfold that doesn't change window size).
		 if (prevState.isFolded !== this.state.isFolded) {
			 this._detectOrientation();
		 }

		 if (prevState.audioOutputs !== this.state.audioOutputs ||
			 prevState.userChangedAudioDevice !== this.state.userChangedAudioDevice ||
			 prevState.isFolded !== this.state.isFolded) {
			const outputs = this.state.audioOutputs || [];
			const types = outputs.map(d => d.type);

			// Match iOS behaviour: when a headset (BT, wired, or USB) is plugged in,
			// hide the Earpiece from the selection menu — the OS may not allow
			// routing back to it once a headset is connected.
			//
			// On Android we add a "sticky initial" twist: if the call started with
			// Earpiece as the selected device and the user has not yet changed the
			// selection, keep Earpiece visible so the UI reflects the active route.
			// As soon as the user picks a different device (via selectAudioDevice),
			// userChangedAudioDevice flips to true and Earpiece drops off the list.
			//
			// The flag is also reset here whenever no headset is present, so the
			// "sticky initial" grace period reapplies if the headset is unplugged
			// and plugged back in mid-call.
			//
			// We also hide the Earpiece whenever the native module reports the
			// device is folded (Razr-style flip closed past ~85° hinge). In that
			// state the earpiece is physically under the shell and the OS silently
			// forces the speaker regardless of what setCommunicationDevice() asks.
			const hasBT    = types.includes('BLUETOOTH_SCO');
			const hasWired = types.includes('WIRED_HEADSET');
			const hasUsb   = types.includes('USB_HEADSET');
			const hasHeadsetDevice = hasBT || hasWired || hasUsb;

			if (!hasHeadsetDevice && this.state.userChangedAudioDevice) {
				this.setState({ userChangedAudioDevice: false });
			}

			let filteredTypes = types;
			if (Platform.OS === 'android') {
				const hideForHeadset = hasHeadsetDevice && this.state.userChangedAudioDevice;
				const hideForFold    = this.state.isFolded;
				if (hideForHeadset || hideForFold) {
					filteredTypes = types.filter(t => t !== 'BUILTIN_EARPIECE');
				}
			}

			this.setState({ availableAudioDevices: filteredTypes });
		 }

		 // Auto-flip audio route to Speaker when the device folds closed during
		 // a call while Earpiece was the selected route (or nothing was explicitly
		 // selected — on Razr, getCommunicationDevice() returns null once folded).
		 // This keeps the UI in sync with the hardware behaviour: speaker is the
		 // only usable output in that posture, so we show it as selected.
		 // Guarded by `this.activeCall` so that folding the phone while idle
		 // doesn't touch audio routing.
		 if (Platform.OS === 'android' &&
		     prevState.isFolded !== this.state.isFolded &&
		     this.state.isFolded === true &&
		     this.activeCall) {
			const cur = this.state.selectedAudioDevice;
			if (!cur || cur === 'BUILTIN_EARPIECE') {
				console.log('[AudioDevices] Device folded during call; auto-flipping route to BUILTIN_SPEAKER');
				try {
					this.selectAudioDevice('BUILTIN_SPEAKER');
				} catch (e) {
					console.log('[AudioDevices] selectAudioDevice(SPEAKER) on fold failed:', e);
				}
			}
		 }

		 if (prevState.wsUrl !== this.state.wsUrl && this.state.wsUrl) {
		     console.log('[cdu-wsUrl] wsUrl changed', prevState.wsUrl, '->', this.state.wsUrl,
				' -> connectToSylkServer(true)');
		     this.connectToSylkServer(true, 'cdu-wsUrl');

			 if (this.state.accountVerified && this.state.accountId) {
                this.handleRegistration(this.state.accountId, this.state.password, 'wsUrl');
             }
		 }
	}

    async addChatContacts() {
		let chatContacts = await this.getChatContacts();

		Object.keys(chatContacts).forEach((key) => {
		      let chatContact = this.lookupContact(key);
			  if (!chatContact) {
					chatContact = this.newContact(key, key, {src: 'chatContacts'});
					try {
						timestamp = JSON.parse(chatContacts[key], _parseSQLDate);
						chatContact.timestamp = timestamp;
						this.saveSylkContact(key, chatContact, 'chat');
					} catch (error) {
						console.log('Failed to create chat contact');
					}
			  } else {
			      //console.log('chatContact exists', chatContact.id);
			  }
		});
	}

	async anyContactHasAutoAnswer() {
	  const hasAutoAnswer = this.state.allContacts.some(contact => {
		const hasAutoAnswerProperty =
		  contact?.localProperties?.autoanswer === true;
	
		return hasAutoAnswerProperty;
	  });
	
	  this.setState({ hasAutoAnswerContacts: hasAutoAnswer });
	}

    get useInCallManger() {
		if (Platform.OS == 'android' && Platform.Version < 31) {
		    return true;
		}

		return false;
	}

    createTestNumbers() {
        console.log('createTestNumbers');
        let test_numbers = this.state.testNumbers;

        test_numbers.forEach((item) => {
            let existingContact = this.lookupContact(item.uri);
            
            if (!existingContact) {
                existingContact = this.newContact(item.uri, item.name, {src: 'init'});
                existingContact.tags.push('test');
                existingContact.timestamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);;
                this.saveSylkContact(item.uri, existingContact, 'init uri');
            } else {
                if (existingContact.tags.indexOf('test') === -1) {
                    existingContact.tags.push('test');
                    this.saveSylkContact(item.uri, existingContact, 'init tags');
                }

                if (!existingContact.name) {
                    existingContact.name = item.name;
                    this.saveSylkContact(item.uri, existingContact, 'init name');
                }
                //console.log('Test contact exists', existingContact.id, item.uri);
            }
        });
    }

    async afterFirstSync() {
		await this.waitForContactsLoaded();

		this.createTestNumbers();

		let msg = {
		    _id: this.deviceId,
			key: this.deviceId,
			text: 'Account activated on ' + USER_AGENT,
			createdAt: new Date(),
			direction: 'outgoing',
			user: {}
		};

		this.sendMessage(this.state.accountId, msg, 'text/plain');
    }

    async initSQL() {
        const database_name = "sylk.db";
        const database_version = "1.0";
        const database_displayname = "Sylk Database";
        const database_size = 200000;

        await SQLite.openDatabase(database_name, database_version, database_displayname, database_size).then((DB) => {
            this.db = DB;
            console.log('SQL database', database_name, 'opened');
            //this.resetStorage();
            //this.dropTables();
        }).catch((error) => {
            console.log('SQL database error:', error);
        });

		await this.showTables();
		await this.createTables();

    }

    dropTables() {
        console.log('Drop SQL tables...')
        this.ExecuteQuery("DROP TABLE if exists chat_uris");
        this.ExecuteQuery("DROP TABLE if exists recipients");
        this.ExecuteQuery("drop table if exists contacts_v9");
        //this.ExecuteQuery("DROP TABLE 'messages';");
        //this.ExecuteQuery("DROP TABLE 'versions';");
        //this.ExecuteQuery("DROP TABLE 'accounts';");
    }

    async showTables() {
	    // console.log('showTables');
		const result = await this.ExecuteQuery(
		  `SELECT name FROM sqlite_master 
		   WHERE type='table' 
		   AND name NOT LIKE 'sqlite_%'
		   ORDER BY name;`
		);
				
		for (let i = 0; i < result.rows.length; i++) {
		  //utils.timestampedLog("SQL table:", result.rows.item(i).name);
		}
	}
    
    async createTables() {
        //console.log(' -- Create SQL tables...')
        let create_versions_table = `CREATE TABLE IF NOT EXISTS versions (
                                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                                     "table" TEXT UNIQUE,
                                     version INTEGER NOT NULL)
                                    `;

        this.ExecuteQuery(create_versions_table).then((success) => {
            //console.log('SQL version table created');
        }).catch((error) => {
            console.log(create_versions_table);
            console.log('SQL version table creation error:', error);
        });

        let create_table_messages = `CREATE TABLE IF NOT EXISTS messages ( 
                                     account TEXT NOT NULL, 
                                     msg_id TEXT NOT NULL, 
                                     timestamp TEXT, 
                                     unix_timestamp INTEGER default 0, 
                                     sender TEXT, 
                                     content BLOB, 
                                     content_type TEXT, 
                                     metadata TEXT, 
                                     from_uri TEXT, 
                                     to_uri TEXT, 
                                     sent INTEGER, 
                                     sent_timestamp TEXT, 
                                     received INTEGER, 
                                     received_timestamp TEXT, 
                                     expire_interval INTEGER,
                                     expire INTEGER default 0,
                                     deleted INTEGER,
                                     pinned INTEGER, 
                                     pending INTEGER, 
                                     system INTEGER, 
                                     url TEXT, 
                                     related_msg_id TEXT, 
                                     related_action TEXT, 
                                     local_url TEXT, 
                                     image TEXT, 
                                     encrypted INTEGER default 0, 
                                     direction TEXT, 
                                     state TEXT, 
                                     disposition_notification TEXT, 
                                     PRIMARY KEY (account, msg_id)) 
                                    `;

        this.ExecuteQuery(create_table_messages).then((success) => {
            //console.log('SQL messages table OK');
        }).catch((error) => {
            console.log(create_table_messages);
            console.log('SQL messages table creation error:', error);
        });

		const idx_messages_account_time = 'CREATE INDEX IF NOT EXISTS idx_messages_account_time ON messages(account, unix_timestamp DESC)';

        this.ExecuteQuery(idx_messages_account_time).then((success) => {
            //console.log('SQL idx_messages_account_time OK');
        }).catch((error) => {
            console.log(idx_messages_account_time);
            console.log('SQL messages idx creation error:', error);
        });

        let create_table_contacts = `CREATE TABLE IF NOT EXISTS contacts ( 
                                     account TEXT NOT NULL, 
                                     contact_id TEXT NOT NULL,
                                     remote_id TEXT NOT NULL default '', 
                                     uri TEXT, 
                                     uris TEXT, 
                                     name TEXT, 
                                     organization TEXT, 
                                     tags TEXT, 
                                     photo BLOB, 
                                     email TEXT, 
                                     participants TEXT, 
                                     public_key TEXT, 
                                     timestamp INTEGER, 
                                     direction TEXT, 
                                     last_message TEXT, 
                                     last_message_id TEXT, 
                                     unread_messages TEXT, 
                                     last_call_media TEXT, 
                                     last_call_duration INTEGER default 0, 
                                     last_call_id TEXT, 
                                     properties TEXT, 
                                     local_properties TEXT, 
                                     remote_properties TEXT, 
                                     conference INTEGER default 0, 
                                     PRIMARY KEY (account, contact_id))
                                    `;

        this.ExecuteQuery(create_table_contacts).then((success) => {
           //console.log('SQL contacts table OK');
        }).catch((error) => {
            console.log(create_table_contacts);
            console.log('SQL messages table creation error:', error);
        });

		let create_table_accounts = `
		  CREATE TABLE IF NOT EXISTS accounts (
			account TEXT PRIMARY KEY,
			password TEXT,
			email TEXT,
			active TEXT NULL default '0',
			verified TEXT NULL default '0',
			dnd TEXT,
			reject_anonymous TEXT,
			reject_non_contacts TEXT,
			chat_sounds TEXT,
			read_receipts TEXT,
			private_key TEXT,
			public_key TEXT,
			last_sync_id TEXT,
			last_sync_timestamp TEXT NOT NULL default '',
			server TEXT,
			last_active_timestamp TEXT NOT NULL default ''
		  )
		`;

        this.ExecuteQuery(create_table_accounts).then((success) => {
            //console.log('SQL accounts table OK');
        }).catch((error) => {
            console.log(create_table_accounts);
            console.log('SQL accounts table creation error:', error);
        });

		/*
		// purge
			try {  
				let q = `DELETE FROM messages WHERE content_type LIKE 'application/sylk-message%'`;
				this.ExecuteQuery(q).then((result) => {
					 console.log('purged metadata rows', result.rowsAffected);
				   
				}).catch((error) => {
				});
			} catch (e) {
			console.log('delete error:', e);
			}
		*/

		formatCreateTable = (sql) => {
		  if (!sql) return '';
		
		  // Normalize spaces
		  sql = sql.replace(/\s+/g, ' ').trim();
		
		  // Extract table name
		  const tableMatch = sql.match(/CREATE TABLE\s+['"`]?(\w+)['"`]?\s*\(/i);
		  const tableName = tableMatch ? tableMatch[1] : 'unknown';
		
		  // Extract column section
		  const columnsPart = sql.substring(
			sql.indexOf('(') + 1,
			sql.lastIndexOf(')')
		  );
		
		  // Split by commas (safe here since no nested commas in your schema)
		  const columns = columnsPart.split(',').map(col => col.trim());
		
		  // Rebuild nicely formatted SQL
		  const formatted = `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n);`;
		
		  return formatted;
		};
		
        let showShemas = false;
        if (showShemas) { 
			const tableNames = Object.keys(this.sqlTableVersions);
			for (const tableName of tableNames) {
				try {
				  const result = await this.ExecuteQuery(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name=?;",
					[tableName] // replace with your table name
				  );
				
				  if (result.rows.length > 0) {
					console.log("Schema:");
					const rawSql = result.rows.item(0).sql;
					const prettySql = formatCreateTable(rawSql);
					console.log(prettySql);
				  } else {
					console.log("Table not found");
				  }
				
				} catch (err) {
				  console.log("Error reading schema:", err);
				}
			}
		}

        await this.upgradeSQLTables();
        // Crash-safe cleanup: purge any rows whose `expire` timestamp has
        // passed while the app was killed. Runs once at startup, after
        // migrations so the column definitely exists. Cheap thanks to the
        // partial index on `expire > 0`.
        this.purgeExpiredMessages();
    }

    // AppStore GPS Review — deletes GPS/location rows whose retention window
    // has elapsed. Enforces the user-facing retention promise ("max 7 days"
    // for timed shares; session-scoped for meetups) at every startup.
    //
    // Delete messages whose `expire` (unix seconds) is in the past. Written
    // as fire-and-forget: failures just log — the next session will retry.
    //
    // `expire` is populated for time-sensitive rows like live-location
    // origins; everything else defaults to 0 and is ignored by the WHERE.
    // This is the force-kill backstop: the in-memory BackgroundTimer that
    // drives the normal end-of-dialog wipe dies with the process, so
    // without this, a crash mid-session would leave stale location rows on
    // disk until the user manually cleared the conversation.
    async purgeExpiredMessages() {
        try {
            const nowSec = Math.floor(Date.now() / 1000);
            const result = await this.ExecuteQuery(
                'delete from messages where expire > 0 and expire < ?',
                [nowSec]
            );
            const rows = result && result.rowsAffected;
            if (rows) {
                console.log('[expire] purged', rows, 'expired messages at startup');
            }
        } catch (error) {
            console.log('[expire] purge failed:',
                error && error.message ? error.message : error);
        }
    }

    async upgradeSQLTables() {
        let query;
        let update_queries;
        let update_sub_queries;
        let version_numbers;

        let updateSQLTables = {'messages': {1: [],
                                                2: [{query: 'delete from messages', params: []}],
                                                3: [{query: 'alter table messages add column unix_timestamp INTEGER default 0', params: []}],
                                                4: [{query: 'alter table messages add column account TEXT', params: []}],
                                                5: [{query: 'update messages set account = from_uri where direction = ?', params: ['outgoing']}, {query: 'update messages set account = to_uri where direction = ?', params: ['incoming']}],
                                                6: [{query: 'alter table messages add column sender TEXT', params: []}],
                                                7: [{query: 'alter table messages add column image TEXT', params: []}, {query: 'alter table messages add column local_url TEXT', params: []}],
                                                8: [{query: 'alter table messages add column metadata TEXT', params: []}],
                                                9: [{query: 'alter table messages add column state TEXT', params: []}],
                                                10: [{query: 'alter table messages add column related_msg_id TEXT', params: []}, {query: 'alter table messages add column related_action TEXT', params: []}],
                                                11: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
                                                12: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
                                                13: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
                                                14: [{query: 'alter table messages add column disposition_notification', params: []}],
                                                15: [{query: 'CREATE INDEX IF NOT EXISTS idx_messages_account_time ON messages(account, unix_timestamp DESC)', params: []}],
                                                // v16: crash-safe cleanup for time-sensitive rows.
                                                //   `expire` is a unix timestamp (seconds). When > 0,
                                                //   the row is eligible for purge once `now() > expire`.
                                                //   Current writer: location origin rows (both outgoing
                                                //   and incoming) — carries the share's expires_at so a
                                                //   force-kill doesn't leak the session past its end.
                                                //   Any future time-limited message kind can reuse the
                                                //   same column; 0/NULL means "keep forever".
                                                //   The accompanying partial index keeps the purge scan
                                                //   cheap as the column grows.
                                                16: [{query: 'alter table messages add column expire INTEGER default 0', params: []},
                                                     {query: 'CREATE INDEX IF NOT EXISTS idx_messages_expire ON messages(expire) WHERE expire > 0', params: []}],
                                                },
                                   'contacts': {2: [{query: 'alter table contacts add column participants TEXT', params: []}],
                                                3: [{query: 'alter table contacts add column direction TEXT', params: []},
                                                    {query: 'alter table contacts add column last_call_media TEXT', params: []},
                                                    {query: 'alter table contacts add column last_call_duration INTEGER default 0', params: []},
                                                    {query: 'alter table contacts add column last_call_id TEXT', params: []},
                                                    {query: 'alter table contacts add column conference INTEGER default 0', params: []}],
                                                4: [{query: 'CREATE TABLE contacts2 as SELECT uri, account, name, organization, tags, participants, public_key, timestamp, direction, last_message, last_message_id, unread_messages, last_call_media, last_call_duration, last_call_id, conference from contacts', params: []},
                                                    {query: 'CREATE TABLE contacts3 (uri TEXT, account TEXT, name TEXT, organization TEXT, tags TEXT, participants TEXT, public_key TEXT, timestamp INTEGER, direction TEXT, last_message TEXT, last_message_id TEXT, unread_messages TEXT, last_call_media TEXT, last_call_duration INTEGER default 0, last_call_id TEXT, conference INTEGER default 0,  PRIMARY KEY (account, uri))', params: []},
                                                    {query: 'drop table contacts', params: []},
                                                    {query: 'drop table contacts2', params: []},
                                                    {query: 'ALTER TABLE contacts3 RENAME TO contacts', params: []}
                                                    ],
                                                5: [{query: 'alter table contacts add column email TEXT', params: []}],
                                                6: [{query: 'alter table contacts add column photo BLOB', params: []}],
                                                7: [{query: 'alter table contacts add column email TEXT', params: []}],
                                                8: [{query: 'alter table contacts add column properties TEXT', params: []}],
                                                9: [{query: 'alter table contacts add column local_properties TEXT', params: []}],
                                                10:[{query: 'alter table contacts add column contact_id TEXT', params: []}, 
                                                    {query: 'alter table contacts add column uris TEXT', params: []}, 
                                                    {query: 'update contacts set contact_id = lower(hex(randomblob(16)))', params: []},
													{query: 'CREATE TABLE contacts_ng (account TEXT NOT NULL, contact_id TEXT NOT NULL, uri TEXT, uris TEXT, name TEXT, organization TEXT, tags TEXT, photo BLOB, email TEXT, participants TEXT, public_key TEXT, timestamp INTEGER, direction TEXT, last_message TEXT, last_message_id TEXT, unread_messages TEXT, last_call_media TEXT, last_call_duration INTEGER default 0, last_call_id TEXT, properties TEXT, local_properties TEXT, conference INTEGER default 0, PRIMARY KEY (account, contact_id))', params: []},
													{query: 'INSERT INTO contacts_ng (contact_id, uri, uris, account, name, organization, tags, photo, email, participants, public_key, timestamp, direction, last_message, last_message_id, unread_messages, last_call_media, last_call_duration, last_call_id, properties, local_properties, conference) select contact_id, uri, uris, account, name, organization, tags, photo, email, participants, public_key, timestamp, direction, last_message, last_message_id, unread_messages, last_call_media, last_call_duration, last_call_id, properties, local_properties, conference from contacts', params: []},
                                                    {query: 'alter table contacts RENAME TO contacts_v9', params: []},
                                                    {query: 'alter table contacts_ng RENAME TO contacts', params: []},
                                                    ],
                                                11: [{query: 'drop table if exists contacts_v9', params: []}],
                                                12: [{query: 'alter table contacts add remote_id TEXT', params: []},
													 {query: 'alter table contacts add remote_properties TEXT', params: []}
                                                    ],
                                                },
                                   'accounts': {3: [{query: 'alter table accounts add column dnd TEXT', params: []}],
												4: [{query: 'alter table accounts add column reject_anonymous TEXT', params: []}],
												5: [{query: 'alter table accounts add column reject_non_contacts TEXT', params: []}],
												6: [{query: 'alter table accounts add column chat_sounds TEXT', params: []}],
												7: [{query: 'alter table accounts add column private_key TEXT', params: []}],
												8: [{query: 'alter table accounts add column public_key TEXT', params: []}],
												9: [{query: 'alter table accounts add column last_sync_id TEXT', params: []}],
												10: [{query: 'alter table accounts add column last_sync_timestamp TEXT', params: []}],
												11: [{query: 'update accounts set private_key = k.private_key, public_key = k.public_key, last_sync_id = k.last_sync_id FROM keys k WHERE accounts.account = k.account', params: []}],
												12: [{query: 'drop table if exists keys', params: []}],
												13: [{query: 'alter table accounts add column server TEXT', params: []}],
												14: [{query: 'alter table accounts add column last_active_timestamp TEXT  NOT NULL default ""', params: []}],
												15: [{query: 'alter table accounts add column email TEXT  NOT NULL default ""', params: []}],
												16: [{query: 'alter table accounts add column verified TEXT  NOT NULL default "0"', params: []}],
												17: [{query: 'alter table accounts add column read_receipts TEXT', params: []}],
                                               }
                                   };

        /*
        this.ExecuteQuery("ALTER TABLE 'messages' add column received_timestamp TEXT after received");
        this.ExecuteQuery("ALTER TABLE 'messages' add column sent_timestamp TEXT after sent");
        */

        /*
        query = "update versions set version = \"13\" where \"table\" = 'messages'";
        this.ExecuteQuery(query);
        */

        query = "SELECT * FROM versions";
        let currentVersions = {};

        this.ExecuteQuery(query,[]).then((results) => {
            let rows = results.rows;
            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                currentVersions[item.table] = item.version;
                //console.log('Table', item.table, 'version', item.version);
            }

            for (const [key, value] of Object.entries(this.sqlTableVersions)) {
                if (currentVersions[key] == null) {
                    query = "INSERT INTO versions ('table', 'version') values ('" + key + "', '" + this.sqlTableVersions[key] + "')";
                    //console.log(query);
                    this.ExecuteQuery(query);
                } else {
                    //console.log('Table', key, 'has version', value);
                    if (this.sqlTableVersions[key] > currentVersions[key]) {
                        console.log('SQL Table', key, 'must have version', value, 'and it has', currentVersions[key]);
                        //console.log('update_queries', updateSQLTables);
                        update_queries = updateSQLTables[key];
                        if (!update_queries) {
							console.log('upgradeSQLTables updateSQLTables is empty', key);
							return;
                        }
                        version_numbers = Object.keys(update_queries);
                        version_numbers.sort(function(a, b){return a-b});
                        version_numbers.forEach((version) => {
                            // Both sides MUST be compared numerically.
                            // currentVersions[key] comes from the SQL TEXT
                            // column as a string, and Object.keys() gives
                            // string keys. A naive `version <= current`
                            // does lexicographic compare, which silently
                            // skips legitimate migrations whenever the
                            // version numbers cross a digit-count boundary
                            // (e.g. '17' < '9' lexicographically), which
                            // is exactly why the read_receipts migration
                            // didn't run on some installs.
                            if (Number(version) <= Number(currentVersions[key])) {
                                return;
                            }
                            update_sub_queries = update_queries[version];
                            update_sub_queries.forEach((query_objects) => {
                                console.log('Run SQL query for table', key, 'version', version, ':', query_objects.query);
 
                                this.ExecuteQuery(query_objects.query, query_objects.params).then((results) => {
								}).catch((error) => {
									console.log('upgradeSQLTables error:', error);
								});
                                
                            });
                        });

                        query = "update versions set version = " + this.sqlTableVersions[key] + " where \"table\" = '" + key + "';";
                        //console.log(query);
                        this.ExecuteQuery(query);

                    } else {
                        //console.log('No upgrade required for SQL table', key, this.sqlTableVersions[key]);
                    }
                }
            }

            // Schema sanity / self-heal pass.
            //
            // The version-table-driven migration path has historically not
            // been bulletproof on this codebase: some installs end up with
            // versions row at the new number but the underlying ALTER TABLE
            // never executed (e.g. lexicographic compare quirks, errors that
            // were swallowed, hand-edited DBs). Rather than relying on the
            // version row to be authoritative, run a small set of idempotent
            // "make sure this column exists" statements at every startup.
            // SQLite throws on duplicate column add, so we catch and ignore
            // — the sole failure mode that matters here is "column already
            // exists", which is exactly the success state.
            this.ensureColumn('accounts', 'read_receipts', 'TEXT');

        }).catch((error) => {
            console.log('upgradeSQLTables error:', error);
        });

    }

    // Idempotent column-add helper: if the column exists, the ALTER fails
    // with "duplicate column name" and we silently ignore. If it doesn't
    // exist (because a migration was skipped for any reason), this is what
    // actually creates it.
    ensureColumn = (table, column, type) => {
        const sql = `alter table ${table} add column ${column} ${type}`;
        this.ExecuteQuery(sql).then(() => {
            console.log('ensureColumn: added missing column', table + '.' + column);
        }).catch((error) => {
            const msg = (error && error.message) ? error.message.toLowerCase() : '';
            if (msg.indexOf('duplicate column') > -1 || msg.indexOf('already exists') > -1) {
                // Column is present — the desired state. No-op.
                return;
            }
            console.log('ensureColumn error for', table + '.' + column, ':', error.message);
        });
    }

    /*
    * Execute sql queries
    *
    * @param sql
    * @param params
    *
    * @returns {resolve} results
    */

    ExecuteQuery = (sql, params = []) => new Promise((resolve, reject) => {
        //console.log('-- Execute SQL query:', sql, params);

        if (!sql) {
            return;
        }

        this.db.transaction((trans) => {
          trans.executeSql(sql, params, (trans, results) => {
            resolve(results);
          },
            (error) => {
              reject(error);
            });
        });
      });

	get _notificationCenter() {
	  return this.notificationCenterRef.current;
	}

    _detectOrientation(dims) {
        //console.log('_detectOrientation', this.state.Width_Layout, this.state.Height_Layout);
		// Prefer explicit dims (e.g. passed by the Dimensions change listener)
		// so we react immediately to a real window change, then fall back to
		// the most recent onLayout dimensions, then Dimensions.get(). This
		// ordering is important on foldables where the window re-measures
		// before the layout tree is re-laid out.
		let width  = (dims && dims.width)  || this.state.Width_Layout  || Dimensions.get('window').width;
		let height = (dims && dims.height) || this.state.Height_Layout || Dimensions.get('window').height;

		// Base orientation from the raw window dimensions. Folded-state
		// override is applied just below.
		let newOrientation = width > height ? 'landscape' : 'portrait';

		// Force portrait when folded. On the Razr cover display the window
		// can report width > height (e.g. in Android's "full view" mode, or
		// when the user physically rotates the phone holding the cover
		// display). Landscape-specific layout — 2-column contacts list,
		// stretched bottom bar, tablet-feel proportions — is not useful on
		// a ~4" cover screen and the user reported the folded UI looked
		// tablet-ish because of it. Treat the cover display as phone-
		// portrait regardless of raw w/h.
		if (this.state.isFolded === true) {
			newOrientation = 'portrait';
		}

		// Recompute "isTablet" using the hinge sensor as the primary signal,
		// and the current window's short side as a fallback when the sensor
		// has not yet reported.
		//
		// Historical context: originally we used only a minSide >= 450dp
		// threshold (450 sits below the Razr inner-display short side of
		// ~475dp and above the nominal cover-display short side of ~420dp).
		// That rule is brittle because the Razr cover display can be toggled
		// by Android into a "full view" mode that extends the window into
		// the camera-cutout area and pushes minSide above 450. That lie
		// caused two visible bugs: the call-buttons bar (a tablet-only
		// feature) showing up on the folded cover display, and an endless
		// layout oscillation each time the user tapped Android's full/normal
		// toggle — every crossing of the 450 boundary re-rendered NavBar +
		// ReadyBox with a different shape, which Android treated as a
		// reason to bounce the window mode back.
		//
		// The hinge sensor (isFolded), when available, is the authoritative
		// signal: folded means cover display → always phone-sized;
		// unfolded means inner display → tablet iff its short side is big
		// enough. We only fall back to minSide >= 450 when isFolded hasn't
		// been observed yet (initial render before the first native
		// hinge-sensor event arrives).
		const minSide = Math.min(width, height);
		let effectiveIsTablet;
		if (this.state.isFolded === true) {
			// Confirmed folded → cover display → always phone.
			effectiveIsTablet = false;
		} else if (this.state.isFolded === false) {
			// Confirmed unfolded → inner display → tablet iff the short
			// side is big enough to fit tablet layout.
			effectiveIsTablet = minSide >= 450;
		} else {
			// isFolded is null → sensor hasn't reported yet (brief window
			// at app start before the first AudioRouteModule event).
			// Default to phone layout during this window: it's the safer
			// choice on the Razr cover display, which can briefly report
			// minSide ≥ 450 in Android's "full view" mode. The sensor
			// arrives within a few hundred ms and will re-trigger this
			// path to flip into tablet mode if we're actually unfolded.
			effectiveIsTablet = false;
		}

		// Diagnostic (disabled — re-enable to debug fold/font issues):
		// also logs the current display density/fontScale. Was used to
		// confirm that PixelRatio changes across fold events on the
		// Razr 60 Ultra, which justified the key-based remount of
		// Paper Text/IconButton in NavigationBar/ReadyBox.
		// let _pxR = 0, _fScale = 0, _scrW = 0, _scrH = 0;
		// try { _pxR = PixelRatio.get(); } catch (e) {}
		// try { _fScale = PixelRatio.getFontScale(); } catch (e) {}
		// try {
		// 	const s = Dimensions.get('screen');
		// 	_scrW = s.width; _scrH = s.height;
		// } catch (e) {}
		// console.log('[FoldUI] _detectOrientation layout=', Math.round(width), 'x', Math.round(height),
		// 			'minSide=', Math.round(minSide),
		// 			'effectiveIsTablet=', effectiveIsTablet,
		// 			'stateIsTablet=', this.state.isTablet,
		// 			'orientation=', newOrientation,
		// 			'pixelRatio=', _pxR,
		// 			'fontScale=', _fScale,
		// 			'screen=', Math.round(_scrW), 'x', Math.round(_scrH));

		const updates = {};
		if (this.state.orientation !== newOrientation) updates.orientation = newOrientation;
		if (this.state.isTablet    !== effectiveIsTablet) updates.isTablet    = effectiveIsTablet;

		if (Object.keys(updates).length > 0) {
			// console.log('[FoldUI] _detectOrientation applying updates=', updates);
			this.setState(updates, () => this.forceUpdate());
		}
    }

    changeRoute(route, reason) {
        console.log('LO - Route', route, 'with reason', reason);
        utils.timestampedLog('Route', this.currentRoute, '->', route, ':', reason);
        let messages = this.state.messages;

		if (route === '/ready' || route === '/login') {
		    if (this.currentRoute == '/call' && reason == 'start_up') {
		        console.log('Remain in /call until we receive it');
				return;
		    }

		    if (this.currentRoute == '/conference' && reason == 'start_up') {
		        console.log('Remain in /conference until we receive it');
				return;
		    }

			this.setState({contactIsSharing: false, totalMessageExceeded: false});
			if (Platform.OS === 'android') {
				SylkBridge.setActiveChat(null);
			} else {
				NativeModules.SharedDataModule.setActiveChat(null); 
			}
		}

        if (this.currentRoute === route) {
            if (route === '/ready') {
                if (this.state.selectedContact) {
                    if (this.state.callContact) {
                        if (this.state.callContact.uri !== this.state.selectedContact.uri && this.state.selectedContact.uri in messages) {
                            delete messages[this.state.selectedContact.uri];
                        }
                    } else {
                        if (this.state.selectedContact.uri in messages) {
                            delete messages[this.state.selectedContact.uri];
                        }
                    }
                    this.setState({
                                messages: messages,
                                selectedContact: null,
                                searchMessages: false,
                                targetUri: ''
                                });
                } else {
                    this.setState({
                                messages: {},
                                messageZoomFactor: 1,
                                searchMessages: false
                                });
                    this.endShareContent();
                }
            }
            return;
        } else {
            if (route === '/ready' && this.state.selectedContact) {
                this.getMessages(this.state.selectedContact, {origin: '/ready'});
            }
        }

        if (route === '/conference') {
           this.backToForeground();
           this.setState({inviteContacts: false});
        }

        if (route === '/call') {
           this.backToForeground();
        }

        if (route === '/ready' && reason !== 'back to home') {
            Vibration.cancel();

            if (reason === 'conference_really_ended' && this.callKeeper.countCalls) {
                utils.timestampedLog('Change route cancelled because we still have calls');
                return;
            }

            if (this.state.currentCall && reason === 'outgoing_connection_failed' && this.state.currentCall.direction === 'outgoing') {
                let target_uri = this.state.currentCall.remoteIdentity.uri.toLowerCase();
                let options = {audio: true, video: true, participants: []}
                let streams = this.state.currentCall.getLocalStreams();
                if (streams.length > 0) {
                    let tracks = streams[0].getVideoTracks();
                    let mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';
                    if (mediaType === 'audio') {
                        options.video = false;
                    }
                }

                this.setState({reconnectingCall: true});
                console.log('Reconnecting call to', target_uri, 'with options', options);

                setTimeout(() => {
                    if (target_uri.indexOf('@videoconference') > -1) {
                        this.callKeepStartConference(target_uri, options);
                    } else {
                        this.callKeepStartCall(target_uri, options);
                    }
                }, 5000);

                this.setState({
                            outgoingCallUUID: null,
                            currentCall: null,
                            selectedContacts: [],
                            reconnectingCall: true,
                            muted: false
                            });
           } else {
                if (this.state.callContact && this.state.callContact.uri in messages) {
                    delete messages[this.state.callContact.uri];
                }

                this.setState({
                            outgoingCallUUID: null,
                            currentCall: null,
                            callContact: null,
                            messages: {},
                            selectedContact: null,
                            inviteContacts: false,
                            //shareToContacts: false,
                            selectedContacts: [],
                            sourceContact: null,
                            incomingCall: (reason === 'accept_new_call' || reason === 'user_hangup_call') ? this.state.incomingCall: null,
                            reconnectingCall: false,
                            muted: false
                            });
            }

            if (this.currentRoute === '/call' || this.currentRoute === '/conference') {
                if (reason !== 'user_hangup_call') {
                    this.stopRingback();
                    this.audioManagerStop();
                }

                this.closeLocalMedia();

                if (reason === 'accept_new_call') {
                    if (this.state.incomingCall) {
                        // then answer the new call if any
                        let hasVideo = (this.state.incomingCall && this.state.incomingCall.mediaTypes && this.state.incomingCall.mediaTypes.video) ? true : false;
                        this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
                    }
                } else if (reason === 'escalate_to_conference') {
                    let conf_uri = [];
                    conf_uri.push(this.state.accountId.split('@')[0]);
                    this.participantsToInvite.forEach((p) => {
                        conf_uri.push(p.split('@')[0]);
                    });
                    conf_uri.sort();

                    let uri = conf_uri.toString().toLowerCase().replace(/,/g,'-') + '@' + this.state.defaultConferenceDomain;

                    const options = {audio: this.outgoingMedia ? this.outgoingMedia.audio: true,
                                     video: this.outgoingMedia ? this.outgoingMedia.video: true,
                                     participants: this.participantsToInvite,
                                     skipHistory: true}
                    this.participantsToInvite = [];
                    this.callKeepStartConference(uri, options);
                } else {
                    if (this.state.account && this._loaded) {
                        setTimeout(() => {
                            this.updateServerHistory('/ready')
                        }, 1500);
                    }
                }
            }

            if (reason === 'registered') {
                setTimeout(() => {
                    this.updateServerHistory(reason)
                }, 1500);
            }

            if (reason === 'user_hangup_call') {
				this.audioManagerStop();
                setTimeout(() => {
					if (this.phoneWasLocked) {
						console.log('Send to background because phone was locked');
						this.phoneWasLocked = false;
						RNMinimize.minimizeApp();
					}
                }, 3000);
			}

            if (reason === 'no_more_calls') {
				this.audioManagerStop();
                this.updateServerHistory(reason);
                this.updateLoading(null, 'incoming_call');

				if (this.phoneWasLocked) {
					console.log('Send to background because phone was locked');
					this.phoneWasLocked = false;
					RNMinimize.minimizeApp();                
				}
                this.setState({incomingCallUUID: null, terminatedReason: null});
            }
        }

        this.currentRoute = route;
        history.push(route);

    }

	componentWillUnmount() {
		utils.timestampedLog('App will unmount');
		
		if (Platform.OS === 'android') {
			SylkBridge.setActiveChat(null);
		}
				
		if (this.appStateSubscription) {
			this.appStateSubscription.remove();
			this.appStateSubscription = null;
		}

		if (this._dimensionsSub) {
			// RN 0.65+ returns an EmitterSubscription with .remove()
			if (typeof this._dimensionsSub.remove === 'function') {
				this._dimensionsSub.remove();
			}
			this._dimensionsSub = null;
		}
	
		if (this._onFinishedPlayingSubscription) {
			this._onFinishedPlayingSubscription.remove();
			this._onFinishedPlayingSubscription = null;
		}
	
		if (this._onFinishedLoadingSubscription) {
			this._onFinishedLoadingSubscription.remove();
			this._onFinishedLoadingSubscription = null;
		}
	
		if (this._onFinishedLoadingURLSubscription) {
			this._onFinishedLoadingURLSubscription.remove();
			this._onFinishedLoadingURLSubscription = null;
		}
	
		if (this._onFinishedLoadingFileSubscription) {
			this._onFinishedLoadingFileSubscription.remove();
			this._onFinishedLoadingFileSubscription = null;
		}
	
		if (this.callKeeper) {
			this.callKeeper.destroy();
			this.callKeeper = null;
		}
	
		// --- Firebase foreground listener ---
		if (this.messageListener) this.messageListener(); // unsubscribe function
	
		// --- iOS VoIP ---
		if (Platform.OS === 'ios') {
			VoipPushNotification.removeEventListener('register', this._boundOnPushkitRegistered);
			VoipPushNotification.removeEventListener('notification', this._onNotificationReceivedBackground,);
			VoipPushNotification.removeEventListener('localNotification', this._onLocalNotificationReceivedBackground,);
			if (this._onLocalNotification) {
				PushNotificationIOS.removeEventListener('localNotification', this._onLocalNotification);
			}
			if (this._onRemoteNotification) {
				PushNotificationIOS.removeEventListener('notification', this._onRemoteNotification);
			}    
		}
	  
		this.closeConnection();
		this._loaded = false;

		if (this.proximityListener) {
		    this.proximityListener.remove();
		}
	}

	handleProximity = ({ proximity }) => {
        if (!this.state.proximityEnabled) {
            return;
        }

        if (this.state.headsetIsPlugged) {
            utils.timestampedLog('Proximity disabled when headset is plugged');
            return;
        }

		if (this.state.selectedAudioDevice == 'BLUETOOTH_SCO') {
            utils.timestampedLog('Proximity disabled when BT is plugged');
            return;
		}

		// When the phone is folded (Razr-style flip closed), the earpiece is
		// physically under the shell and only the speaker is usable. Proximity
		// routing to earpiece would silence the call, so ignore proximity
		// events while folded.
		if (this.state.isFolded) {
            utils.timestampedLog('Proximity disabled when device is folded');
            return;
		}

        //utils.timestampedLog('proximityNear changed:', proximity);
		this.setState({ proximityNear: proximity});
	};
  
    get unmounted() {
        return !this._loaded;
    }

    isUnmounted() {
        return this.unmounted;
    }

    backPressed() {
        console.log('Back button pressed in route', this.currentRoute);

        if (this.state.incomingCallUUID) {
            this.hideInternalAlertPanel('backPressed');
            return;
        }

        if (this.state.showQRCodeScanner) {
            this.toggleQRCodeScanner();
            return;
        }

        if (this.currentRoute === '/call' || this.currentRoute === '/conference') {
            this.goBackToHome();
        } else if (this.currentRoute === '/ready') {
            if (this.state.selectedContact) {
                this.goBackToHome();
            } else if (this.state.historyFilter) {
                this.filterHistory(null);
            } else if (this.sharingAction) {
                this.endShareContent();
            } else {
                BackHandler.exitApp();
            }
        }

        return true;
    }

    get sharingAction() {
        return (
		  (this.state.forwardContent?.length > 0) ||
		  (this.state.sharedContent?.length > 0)
		);
    }

    async initConfiguration(configurationJson, origin=null) {
		console.log('--- initConfiguration', origin);
		//console.log('--- initConfiguration', configurationJson, origin);
		try {
			configuration = await JSON.parse(configurationJson);

			if (!configuration.wsServer) {
				console.log('initConfiguration missing wsServer');
				return false;
			}

			if (!configuration.defaultDomain) {
				console.log('initConfiguration missing defaultDomain');
				return false;
			}

			if (!configuration.iceServers) {
				console.log('initConfiguration missing iceServers');
				return false;
			}

			let server = configuration.wsServer;
			server = server.replace(/^wss:\/\//, 'https://');

			if (server.endsWith("/ws")) {
				server = server.slice(0, -3);
			}
   
            let callHistoryUrl = configuration.serverCallHistoryUrl;

            if (configuration.useServerCallHistory === false) {
				callHistoryUrl = null;
            }
    
            const publicUrl = configuration.publicUrl ? configuration.publicUrl : 'https://' + configuration.sylkDomain;

            const testNumbers = Array.isArray(configuration.testNumbers) ? configuration.testNumbers: [];

			this.setState({
			               defaultDomain: configuration.defaultDomain,
			               enrollmentUrl: configuration.enrollmentUrl,
			               wsUrl: configuration.wsServer,
			               iceServers: configuration.iceServers,
			               fileSharingUrl: server + '/filesharing',
			               fileTransferUrl: server + '/filetransfer',
			               serverSettingsUrl: configuration.serverSettingsUrl,
			               passwordRecoveryUrl: configuration.passwordRecoveryUrl,
			               deleteAccountUrl: configuration.deleteAccountUrl,
			               callHistoryUrl: callHistoryUrl,
			               testNumbers: testNumbers,
						   configurationUrl: configuration.configurationUrl,
			               sylkDomain: configuration.sylkDomain,
			               publicUrl: publicUrl,
			               serverIsValid: true,
			               SylkServerDiscovery: false,
			               SylkServerDiscoveryResult: 'ready'
			               });

            if (configuration.defaultConferenceDomain) {
				this.setState({defaultConferenceDomain: configuration.defaultConferenceDomain});
			}

			return true;

        } catch (e) {
			console.log('initConfiguration error', e);
			return false;
        }
        
    }
    
    async getLastCallEvent() {
		  if (Platform.OS !== 'android') return;
		
		  DeviceEventEmitter.addListener('IncomingCallAction', (event) => { this.callEventHandler(event); } );

		  CallEventModule.markRNready();
		  // markRNready should emit pending events too

		  try {
			const event = await CallEventModule.getLastCallEvent();
		
			if (event && event.callUUID) {
			  this.callEventHandler(event);
			} else {
			  //console.log('CallEventModule has no pending event');
			}
		  } catch (e) {
			console.warn('Failed to pull pending call event', e);
		  }
		}

	callEventHandler(payload) {
		if (!payload || !payload.callUUID) {
			console.warn('Received invalid payload', payload);
			return;
		}

		if (this.handledCalls.has(payload.callUUID)) {
			//console.log('Duplicate payload ignored for callUUID:', payload.callUUID);
			return;
		}

		console.log('IncomingCallAction callUUID:', payload);

	    this.backToForeground();
		this.handledCalls.add(payload.callUUID);
		this.phoneWasLocked = payload.phoneLocked;
		if (payload.action === 'ACTION_ACCEPT_VIDEO') {
			console.log('accept video');		
		} else {
			console.log('payload.action', payload.action);
		}
	
		const options = { audio: true, 
		                  video: payload.action === 'ACTION_ACCEPT_VIDEO', 
		                  event: payload.event,
		                  toUri: payload.toUri,
		                  fromUri: payload.fromUri
		                  };

		if (
			payload.action === 'ACTION_ACCEPT_AUDIO' ||
			payload.action === 'ACTION_ACCEPT_VIDEO' ||
			payload.action === 'ACTION_ACCEPT'
		) {
			this.callKeepAcceptCall(payload.callUUID, options);
		} else if (payload.action === 'REJECT') {
			this.callKeepRejectCall(payload.callUUID);
		}
	
		setTimeout(() => this.handledCalls.delete(payload.callUUID), 5 * 60 * 1000);
	}

    async componentDidMount() {
		await this.initSQL();
        utils.timestampedLog('------- App did mount');

        this._loaded = true;

		// Pull "Until we meet" persisted markers so the modal doesn't
		// re-pop for a request the user has already acted on in a
		// previous session.
		await this._hydrateMeetingHandshakeState();

		const configuration = await AsyncStorage.getItem("configuration");

		if (configuration) {
			await this.initConfiguration(configuration, "storage");
        } else {
            console.log('No stored configuration found');
        }

		this.lookupSylkServer(this.state.sylkDomain);

		this.loadAccounts(true);
           
		this.setState({dark: DarkModeManager.isDark()});

		if (Platform.OS === 'ios') {
			//console.log('--- Added iOS push listeners');
	
			// save references to handler functions for cleanup
			this._onLocalNotification = this.onLocalNotification.bind(this);
			this._onRemoteNotification = this.onRemoteNotification.bind(this);
	
			PushNotificationIOS.addEventListener('localNotification', this._onLocalNotification);
			PushNotificationIOS.addEventListener('notification', this._onRemoteNotification);
	
			// initial notification if app launched from push
			const initialNotification = await PushNotificationIOS.getInitialNotification();
			if (initialNotification) {
				this.onRemoteNotification(initialNotification);
			}
		}
        
		if (Platform.OS === 'android') {
		    this.getLastCallEvent();
			// =======================
			// BUBBLE TAP listener
			// =======================

            const eventEmitter = new NativeEventEmitter(NativeModules.DeviceEventManagerModule);
			this.notificationTapListener = eventEmitter.addListener('notificationTapped', (event) => {
			  if (!event || !event.fromUri) {
				console.warn('notificationTapped missing data:', event);
				return;
			  }
			
			  console.log('User tapped notification bubble for', event.fromUri);
			  /*
			  console.log('Message ID:', event.id);
			  console.log('Message content:', event.content);
			  console.log('Message contentType:', event.contentType);
			  */
			  
			  this.incomingMessageFromPush(event.id, event.fromUri, event.content, event.contentType);
			});

		   const screenLockEventEmitter = new NativeEventEmitter(ScreenLockModule);
	
			screenLockEventEmitter.addListener('onScreenLock', () => {
				 // console.log('minimize app');
				 RNMinimize.minimizeApp(); // only runs on actual screen lock
			});
	
			screenLockEventEmitter.addListener('onScreenUnlock', () => {
			  console.log('Phone unlocked');
			}); 
		}
				
        DeviceInfo.getFontScale().then((fontScale) => {
            this.setState({fontScale: fontScale});
        });

        this.keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', this._keyboardDidShow);
        this.keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', this._keyboardDidHide);

        BackHandler.addEventListener('hardwareBackPress', this.backPressed);
        // Start a timer that runs once after X milliseconds
        BackgroundTimer.runBackgroundTimer(() => {
            // this will be executed once after 10 seconds
            // even when app is the the background
            this.heartbeat();
        }, 5000);

        try {
            await RNCallKeep.supportConnectionService();
            utils.timestampedLog('Connection service is enabled');
        } catch(err) {
            utils.timestampedLog(err);
        }

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
        this._boundOnPushRegistered = this._onPushRegistered.bind(this);

        this._detectOrientation();

        // Safeguard: onLayout of MainContainer fires on fold/unfold in most
        // cases, but on some Android foldables the window reconfiguration
        // lands before the layout tree is re-measured. Subscribing to
        // Dimensions "change" guarantees we re-evaluate isTablet/orientation
        // whenever the window size actually changes.
        this._dimensionsSub = Dimensions.addEventListener('change', ({ window }) => {
            // console.log('[FoldUI] Dimensions change window=', Math.round(window.width), 'x', Math.round(window.height));
            this._detectOrientation({ width: window.width, height: window.height });
        });

        getPhoneNumber().then(myPhoneNumber => {
            console.log('myPhoneNumber', myPhoneNumber);
            this.setState({myPhoneNumber: myPhoneNumber});
        });

 		this.listenForPushNotifications();
        setTimeout(() => this.checkVersion(), 10000);
        this.getAudioState();
        this.startWatchingNetwork();
        this.proximityListener = Proximity.addListener(this.handleProximity);
        
        //logPermissions();
	}
	
	audioManagerStart() {
		// Reset the "user has picked a device" flag at the start of every call so
		// the Earpiece-hide filter (componentDidUpdate) uses the sticky-initial
		// behaviour: Earpiece stays visible if it's the starting device, and only
		// disappears once the user actively switches away while a headset is present.
		this.setState({ userChangedAudioDevice: false });

		if (this.useInCallManger) {
		    InCallManager.start({media: 'audio'});
			// AudioRouteModule is not used for routing on Android < 31, but we still
			// call getEvent() to enumerate available devices and populate the UI menu.
			AudioRouteModule.getEvent();
			// On Android < 31 getCommunicationDevice() is unavailable so the native event
			// never reports a selected device. Infer the initial active device from what
			// is already connected: InCallManager auto-routes BT > wired > earpiece.
			const currentOutputs = this.state.audioOutputs || [];
			const btDevice     = currentOutputs.find(d => d.type === 'BLUETOOTH_SCO');
			const wiredDevice  = currentOutputs.find(d => d.type === 'WIRED_HEADSET');
			const hasHeadset = (btDevice || wiredDevice) ? true : false;
			const earpieceDevice = currentOutputs.find(d => d.type === 'BUILTIN_EARPIECE');
			const initialDevice = btDevice || wiredDevice || earpieceDevice
				|| { type: 'BUILTIN_EARPIECE', name: 'Earpiece', id: '' };
			console.log('[audioManagerStart] initial audio device:', initialDevice.type);
			this.setState({
				selectedAudioDevice: initialDevice.type,
				selectedDevice: initialDevice,
				hasHeadset: hasHeadset,
				speakerPhoneEnabled: false,
			});
			// Poll for device changes (BT/wired headset plug-in mid-call) every 3 seconds.
			// This is a JS-level fallback; the Java receiver (ACTION_CONNECTION_STATE_CHANGED)
			// handles it natively after a rebuild but polling ensures it works immediately.
			this._audioDevicePollInterval = setInterval(() => {
				AudioRouteModule.getEvent();
			}, 3000);
			return;
	    }

		logDevices("Inputs", this.state.audioInputs);
		console.log('this.state.audioInputs', this.state.audioInputs);
		logDevices("Outputs", this.state.audioOutputs);
		logDevices("Selected device", [this.state.selectedDevice]); // wrap single object in array
          
        console.log('selectedDevice', this.state.selectedDevice);
		AudioRouteModule.start(this.state.selectedDevice);	
    }

	audioManagerStop() {
		if (this.useInCallManger) {
		    InCallManager.stop();
			if (this._audioDevicePollInterval) { clearInterval(this._audioDevicePollInterval); this._audioDevicePollInterval = null; }
		    return;
	    }

		AudioRouteModule.stop();
    }

	async selectAudioDevice(deviceType) {
		console.log('[selectAudioDevice] requested:', deviceType, '| selectedAudioDevice:', this.state.selectedAudioDevice, '| useInCallManger:', this.useInCallManger, '| audioOutputs:', JSON.stringify(this.state.audioOutputs));

		if (deviceType == this.state.selectedAudioDevice) {
			console.log('[selectAudioDevice] same device, no-op');
		    return;
		}

		if (this.state.waitForCommunicationsDevicesChanged) {
			console.log('[selectAudioDevice] blocked: waitForCommunicationsDevicesChanged');
			return;
		}

		const selectedDevice = this.state.audioOutputs.find(device => device.type === deviceType);
		console.log('[selectAudioDevice] resolved device object:', JSON.stringify(selectedDevice));

		// Record that the user actively changed the audio device. Combined with
		// the headset-presence check in componentDidUpdate, this hides Earpiece
		// from the device menu after the first user switch while a headset is
		// plugged in. The initial selection (before any user change) is left
		// visible so the UI reflects the route the call started on.
		this.setState({ userSelectedDevice: selectedDevice,
		                selectedAudioDevice: null,
		                userChangedAudioDevice: true });

		// On Android 12+ (API 31+) we use AudioRouteModule instead of InCallManager.
		// Motorola (and similar OEMs) locks audio routing at the Telecom framework level,
		// which AudioManager.setCommunicationDevice() cannot override. We must use
		// RNCallKeep.setAudioRoute() to tell Telecom which route to use, so the HAL
		// honours AudioRouteModule's setCommunicationDevice() call.
		//
		//   SPEAKER      → ROUTE_SPEAKER    (Telecom speaker lock; breaks AudioManager lock)
		//   EARPIECE     → ROUTE_EARPIECE   (restore earpiece via Telecom)
		//   BLUETOOTH_*  → ROUTE_BLUETOOTH  (let Telecom know BT is desired, not speaker/earpiece)
		//   WIRED_*      → no Telecom call  (AudioRouteModule handles these fine)
		if (!this.useInCallManger) {
			// Android 12+: AudioRouteModule + RNCallKeep Telecom routing
			const call = this.activeCall;
			if (call) {
				if (deviceType === 'BUILTIN_SPEAKER') {
					RNCallKeep.setAudioRoute(call.id, 'Speaker');
				} else if (deviceType === 'BUILTIN_EARPIECE') {
					RNCallKeep.setAudioRoute(call.id, 'Earpiece');
				} else if (deviceType === 'BLUETOOTH_SCO' || deviceType === 'BLUETOOTH_A2DP') {
					RNCallKeep.setAudioRoute(call.id, 'Bluetooth');
				}
			}
		} else {
			// Android < 31: InCallManager handles the audio session; RNCallKeep.setAudioRoute
			// updates the Telecom route so it doesn't override InCallManager's choice.
			// Both calls are needed: InCallManager manages SCO/speaker at AudioManager level,
			// RNCallKeep ensures Telecom's route is consistent (otherwise switching away from
			// BT leaves Telecom on ROUTE_BLUETOOTH and audio stays in the headset).
			console.log('[selectAudioDevice] InCallManager path for:', deviceType);
			const call = this.activeCall;
			if (deviceType === 'BUILTIN_SPEAKER') {
				if (call) RNCallKeep.setAudioRoute(call.id, 'Speaker');
				InCallManager.chooseAudioRoute('SPEAKER_PHONE');
				InCallManager.setForceSpeakerphoneOn(true);
			} else if (deviceType === 'BUILTIN_EARPIECE') {
				if (call) RNCallKeep.setAudioRoute(call.id, 'Earpiece');
				InCallManager.chooseAudioRoute('EARPIECE');
				InCallManager.setForceSpeakerphoneOn(false);
			} else if (deviceType === 'BLUETOOTH_SCO') {
				if (call) RNCallKeep.setAudioRoute(call.id, 'Bluetooth');
				InCallManager.chooseAudioRoute('BLUETOOTH');
				InCallManager.setForceSpeakerphoneOn(false);
			} else if (deviceType === 'WIRED_HEADSET') {
				if (call) RNCallKeep.setAudioRoute(call.id, 'Headset');
				InCallManager.chooseAudioRoute('WIRED_HEADSET');
				InCallManager.setForceSpeakerphoneOn(false);
			} else {
				console.log('[selectAudioDevice] InCallManager: no route mapping for:', deviceType);
			}
			// On Android < 31 there is no native event that updates selectedAudioDevice,
			// so set it directly here to keep the checkmark in the menu up to date.
			const selectedDevice = this.state.audioOutputs.find(d => d.type === deviceType);
			this.setState({
				speakerPhoneEnabled: deviceType === 'BUILTIN_SPEAKER',
				selectedAudioDevice: deviceType,
				selectedDevice: selectedDevice || null,
			});
		}

		return;

//		InCallManager.chooseAudioRoute(device);
		if (deviceType == 'SPEAKER_PHONE') {
           this.speakerphoneOn();
        } else {
           this.speakerphoneOff();
        }

		// Set Android audio routing
		//AudioRouteModule.setAudioRoute(this.state.selectedAudioDevice);
	}
	
	async getAudioState() {
		// Register the device-change listener unconditionally.
		// On Android < 31 (InCallManager path), AudioRouteModule is still initialised
		// and can enumerate devices via AudioManager.getDevices() (API 23+).
		// The listener keeps the audio device menu populated on all Android versions.
	
		function devicesEqual(a, b) {
		  // Treat null/undefined as empty arrays
		  a = a || [];
		  b = b || [];
		
		  if (a.length !== b.length) return false;
		
		  for (let i = 0; i < a.length; i++) {
			const aItem = a[i] || {};
			const bItem = b[i] || {};
		
			if ((aItem.id || '') !== (bItem.id || '') ||
				(aItem.type || '') !== (bItem.type || '') ||
				(aItem.name || '') !== (bItem.name || '')) {
			  return false;
			}
		  }
		
		  return true;
		}

		function selectedDeviceEqual(a, b) {
		  if (!a && !b) return true;       // both null/undefined
		  if (!a || !b) return false;      // one is null
		  return a.id === b.id && a.type === b.type && a.name === b.name;
		}

		try {
			// Subscribe to native events
			const audioEmitter = new NativeEventEmitter(AudioRouteModule);
			this.audioRouteListener = audioEmitter.addListener('CommunicationsDevicesChanged',
					({ selected, inputs, outputs, mode, folded }) => {
					const audioInputs = (inputs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
					const audioOutputs = (outputs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
					const selectedDevice = selected || {};
					const isFoldedEvt = !!folded;

					// [AudioDiag] one-line summary of every native event.
					// Fires on each CommunicationsDevicesChanged — including the 3s poll and
					// any fold/unfold that triggers an output-list or getCommunicationDevice()
					// change. Grep logcat for "[AudioDiag]" while folding/unfolding a Razr to
					// see whether outputs or the selected route change.
					const selTypeDiag = (selectedDevice && selectedDevice.type) ? selectedDevice.type : 'NONE';
					const selNameDiag = (selectedDevice && selectedDevice.name) ? selectedDevice.name : '-';
					const outTypesDiag = audioOutputs.map(d => d.type).join(',') || 'EMPTY';
					const inTypesDiag  = audioInputs.map(d => d.type).join(',')  || 'EMPTY';
					console.log('[AudioDiag][JS] evt',
						'mode=' + (mode || 'n/a'),
						'selected=' + selTypeDiag + '(' + selNameDiag + ')',
						'outputs=[' + outTypesDiag + ']',
						'inputs=[' + inTypesDiag + ']',
						'folded=' + isFoldedEvt,
						'activeCall=' + (this.activeCall ? this.activeCall.id : 'none'));

					this.setState({
						waitForCommunicationsDevicesChanged: false,
					});

					// Track fold state in React so componentDidUpdate can react
					// (hide Earpiece, auto-flip UI selection to Speaker). Only
					// setState when the value actually changes, to avoid extra renders.
					if (isFoldedEvt !== this.state.isFolded) {
						this.setState({ isFolded: isFoldedEvt });
					}

					if (!devicesEqual(audioInputs, this.state.audioInputs)) {
					    logDevices("Audio inputs changed", audioInputs);
						this.setState({
							audioInputs: audioInputs,
						});
					}

					if (!devicesEqual(audioOutputs, this.state.audioOutputs)) {
						logDevices("Audio outputs changed", audioOutputs);
						this.setState({
							audioOutputs: audioOutputs,
						});

						// On Android < 31 (InCallManager path), getCommunicationDevice() is
						// unavailable so the native event never reports which device is selected.
						// Sync the UI with what InCallManager actually routes to:
						//   - BT or wired present + currently on earpiece → switch to headset
						//     (InCallManager auto-routes to headsets when connected)
						//   - BT/wired gone + currently selected was that headset → fall back to earpiece
						if (this.useInCallManger) {
							const newTypes = audioOutputs.map(d => d.type);
							const hasBT    = newTypes.includes('BLUETOOTH_SCO');
							const hasWired = newTypes.includes('WIRED_HEADSET');
							const cur      = this.state.selectedAudioDevice;
							this.setState({hasHeadset: hasBT || hasWired});

							if (hasBT && cur !== 'BLUETOOTH_SCO' && cur !== 'BUILTIN_SPEAKER') {
								const btDevice = audioOutputs.find(d => d.type === 'BLUETOOTH_SCO');
								console.log('[AudioDevices] BT available, updating selected to BLUETOOTH_SCO');
								this.setState({ selectedAudioDevice: 'BLUETOOTH_SCO', selectedDevice: btDevice || null });
							} else if (!hasBT && hasWired && cur !== 'WIRED_HEADSET' && cur !== 'BUILTIN_SPEAKER') {
								const wiredDevice = audioOutputs.find(d => d.type === 'WIRED_HEADSET');
								console.log('[AudioDevices] Wired available, updating selected to WIRED_HEADSET');
								this.setState({ selectedAudioDevice: 'WIRED_HEADSET', selectedDevice: wiredDevice || null });
							} else if (!hasBT && !hasWired && (cur === 'BLUETOOTH_SCO' || cur === 'WIRED_HEADSET')) {
								const earpiece = audioOutputs.find(d => d.type === 'BUILTIN_EARPIECE');
								console.log('[AudioDevices] Headset gone, falling back to BUILTIN_EARPIECE');
								this.setState({
									selectedAudioDevice: 'BUILTIN_EARPIECE',
									selectedDevice: earpiece || { type: 'BUILTIN_EARPIECE', name: 'Earpiece', id: '' },
									speakerPhoneEnabled: false,
								});
							}
						}
					}

					// On Android < 31 getCommunicationDevice() is unavailable so the native
					// event always sends an empty selected object. Ignore it to avoid
					// clearing the selectedDevice state that was set directly in selectAudioDevice.
					if (selectedDevice.type && !selectedDeviceEqual(selectedDevice, this.state.selectedDevice)) {
						logDevices("Selected audio device changed", [selectedDevice]); // wrap single object in array
						this.setState({
							selectedDevice: selectedDevice
						});
						// console.log('Audio mode:', mode );
					}
				}
			);
	
			AudioRouteModule.getEvent();

		} catch (e) {
			console.log('Audio device status error', e);
		}
	}

	async checkInstaller() {
	  const installer = await DeviceInfo.getInstallerPackageName(); 
	  // Returns a string like "com.android.vending" for Play Store
	  console.log('Installer package:', installer);
	
	  if (installer === 'com.android.vending') {
		console.log('App was installed from Play Store');
		return 'playstore';
	  } else if (installer === null) {
		console.log('App was sideloaded or unknown source');
		return 'sideloaded';
	  } else {
		//console.log('App installed from another source:', installer);
		return 'other';
	  }
	}

	async registerPushToken() {
	  if (Platform.OS !== 'ios') return;
	
	  try {
		const { APNSTokenModule } = NativeModules; // make sure this matches the Objective-C module name
		if (!APNSTokenModule) {
		  console.log('APNSTokenModule not found in NativeModules');
		  return;
		}
	
		const apnsEmitter = new NativeEventEmitter(APNSTokenModule);
	
		apnsEmitter.addListener('apnsToken', token => {
		  console.log('APNs token received:', token);
		  this._onPushRegistered(token);
		  // Send this token to your server
		});
		
		  // Ask native to emit cached token if any
		  if (APNSTokenModule.emitCachedAPNSToken) {
			APNSTokenModule.emitCachedAPNSToken();
		  }
	
	  } catch (e) {
		console.log('Error getting iOS token:', e);
	  }
	}

  listenForPushNotifications = async () => {
    utils.timestampedLog('Listen for push notifications');

    if (!this.state.appState) this.setState({ appState: 'active' });

    // --- Handle initial deep link ---
    try {
      const url = await Linking.getInitialURL();
      if (url) this.eventFromUrl(url);
    } catch (err) {
      console.log('Error getting initial URL:', err.message);
    }

    Linking.addEventListener('url', this.updateLinkingURL);

    // --- Request permissions ---
    if (Platform.OS === 'ios') {
        await this.registerPushToken();
    } else {
        await messaging().requestPermission();
    }

    if (Platform.OS === 'android') {
		// --- Get FCM token using modular API ---
		const app = getApp(); // default app
		const fcmToken = await messaging(app).getToken();
		if (fcmToken) this._onPushRegistered(fcmToken);


		// --- Foreground messages ---
		this.messageListener = messaging(app).onMessage(async remoteMessage => {
		  //console.log('FCM in-app foreground event:', remoteMessage.data.event);

		  if (Platform.OS === 'ios') {
		      PushNotificationIOS.presentLocalNotification({
			      alertTitle: remoteMessage.notification?.title,
			      alertBody: remoteMessage.notification?.body,
			      userInfo: remoteMessage.data,
			  });
		  } else {
		      const msg = normalizeMessage(remoteMessage);
			  this.handleFirebasePush(msg);
		  }
		});
		
		// --- Background messages ---
		messaging(app).setBackgroundMessageHandler(async remoteMessage => {
		  //console.log('FCM in-app background event:', remoteMessage.data?.event);
		  const msg = normalizeMessage(remoteMessage);
		  this.handleFirebasePush(msg);
		});

		// Killed / app launched from notification
		const initialNotification = await messaging(app).getInitialNotification();
		if (initialNotification) {
		  console.log('FCM in-app initial message:', initialNotification);
		  const msg = normalizeMessage(initialNotification);
		  this.handleFirebasePush(msg);
		}

		const normalizeMessage = (remoteMessage) => {
		  // RemoteMessage may have .data or .notification
		  if (!remoteMessage) return null;
		  const data = remoteMessage.data || {};
		  const notification = remoteMessage.notification || {};
		  return { ...data, notification };
		};

		messaging(app).onNotificationOpenedApp(remoteMessage => {
		  const msg = normalizeMessage(remoteMessage);
		  this.handleFirebasePush(msg);
		});
    }

    // --- iOS VoIP ---
    if (Platform.OS === 'ios') {
	  utils.timestampedLog('Register VoIP token...');
      this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
      VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
      VoipPushNotification.registerVoipToken();

      this._onNotificationReceivedBackground = this._onNotificationReceivedBackground.bind(this);
      this._onLocalNotificationReceivedBackground = this._onLocalNotificationReceivedBackground.bind(this);

      VoipPushNotification.addEventListener('notification',this._onNotificationReceivedBackground, );
      VoipPushNotification.addEventListener('localNotification',this._onLocalNotificationReceivedBackground,);
    }
    
    // --- DeviceEventEmitter ---
    this.boundWiredHeadsetDetect = this._wiredHeadsetDetect.bind(this);

    DeviceEventEmitter.addListener('WiredHeadset', this.boundWiredHeadsetDetect);

    // --- AppState listener ---
    this.appStateSubscription = AppState.addEventListener('change', this._handleAppStateChange);
  };

    _keyboardDidShow(e) {
       this.setState({keyboardVisible: true, keyboardHeight: e.endCoordinates.height});
    }

    _keyboardDidHide() {
        this.setState({keyboardVisible: false, keyboardHeight: 0});
    }

    async checkVersion() {
        const withTimeout = (promise, ms) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
        ]);

        if (Platform.OS === 'android') {
            withTimeout(getAppstoreAppMetadata("com.agprojects.sylk"), 10000)
              .then(metadata => {
                console.log("Sylk app version on playstore",
                  metadata.version,
                  "published on",
                  metadata.currentVersionReleaseDate
                );
                this.setState({appStoreVersion: metadata});
              })
              .catch(err => {
                console.log("error occurred checking app store version", err.message || err);
              });
              return;
        } else {
            withTimeout(getAppstoreAppMetadata("1489960733"), 10000)
            .then(appVersion => {
                console.log("Sylk app version on appstore", appVersion.version, "published on", appVersion.currentVersionReleaseDate);
                this.setState({appStoreVersion: appVersion});
            })
            .catch(err => {
                console.log("Error fetching app store version occurred", err.message || err);
            });
        }
    }

    handleiOSNotification(notification) {
        // when user touches the system notification and app launches...
        console.log("Handle iOS push notification:", notification);
    }

    // Example: handle incoming call
    handleIncomingCall(payload) {
        console.log('FCM app incoming call from push at start:', payload);
        // Your logic: open call screen, update state, etc.
        let data = payload.data;
        let event = data.event;
        let action = payload.accept;

        const callUUID = data['session-id'];
		const mediaType = data['media-type'] || 'audio';
        const displayName = data['from_display_name'];
        const from = data['from_uri'];
        const to = data['to_uri'];

        /*
        if (event === 'incoming_conference_request') {
			this.incomingConference(callUUID, to, from, displayName, media);
        } else if (event === 'incoming_session') {
			this.incomingCallFromPush(callUUID, from, displayName, mediaType);
        }
        */
    }

    postAndroidMessageNotification(uri, content) {
        //https://www.npmjs.com/package/react-native-push-notification
        console.log('postAndroidMessageNotification', content);

        PushNotification.localNotification({
          /* Android Only Properties */
          channelId: "sylk-messages", // (required) channelId, if the channel doesn't exist, notification will not trigger.
          showWhen: true, // (optional) default: true
          autoCancel: true, // (optional) default: true
          largeIcon: "ic_launcher", // (optional) default: "ic_launcher". Use "" for no large icon.
          largeIconUrl: "https://icanblink.com/apple-touch-icon-180x180.png", // (optional) default: undefined
          smallIcon: "", // (optional) default: "ic_notification" with fallback for "ic_launcher". Use "" for default small icon.
          bigText: content, // (optional) default: "message" prop
          subText: "New message", // (optional) default: none
          //bigPictureUrl: "https://www.example.tld/picture.jpg", // (optional) default: undefined
          bigLargeIcon: "ic_launcher", // (optional) default: undefined
          color: "red", // (optional) default: system default
          vibrate: true, // (optional) default: true
          vibration: 100, // vibration length in milliseconds, ignored if vibrate=false, default: 1000
          priority: "high", // (optional) set notification priority, default: high
          ignoreInForeground: true, // (optional) if true, the notification will not be visible when the app is in the foreground (useful for parity with how iOS notifications appear). should be used in combine with `com.dieam.reactnativepushnotification.notification_foreground` setting
          onlyAlertOnce: true, // (optional) alert will open only once with sound and notify, default: false
          invokeApp: true, // (optional) This enable click on actions to bring back the application to foreground or stay in background, default: true
          /* iOS and Android properties */
          id: 0, // (optional) Valid unique 32 bit integer specified as string. default: Autogenerated Unique ID
          title: uri, // (optional)
          message: content, // (required)
          //picture: "https://www.example.tld/picture.jpg", // (optional) Display an picture with the notification, alias of `bigPictureUrl` for Android. default: undefined
          userInfo: {}, // (optional) default: {} (using null throws a JSON value '<null>' error)
          playSound: false, // (optional) default: true
          soundName: "default", // (optional) Sound to play when the notification is shown. Value of 'default' plays the default sound. It can be set to a custom sound such as 'android.resource://com.xyz/raw/my_sound'. It will look for the 'my_sound' audio file in 'res/raw' directory and play it. default: 'default' (default sound is played)
          number: 10, // (optional) Valid 32 bit integer specified as string. default: none (Cannot be zero)
          repeatType: "day", // (optional) Repeating interval. Check 'Repeating Notifications' section for more info.
        });
    }

    handleFirebasePushInteraction(notification) {
        let data = notification;
        let event = data.event;
        console.log("handleFirebasePushInteraction", event, data, 'in route', this.currentRoute);

        const callUUID = data['session-id'];
        const media = {audio: true, video: data['media-type'] === 'video'};

        if (event === 'incoming_conference_request') {
            if (notification.action === 'Accept') {
                this.callKeepAcceptCall(callUUID);
            } else if (notification.action === 'Reject') {
                this.callKeepRejectCall(callUUID);
            } else if (notification.action === 'Dismiss') {
                this.dismissCall(callUUID);
            }
        } else if (event === 'incoming_session') {
            if (notification.action === 'Accept') {
                this.callKeepAcceptCall(callUUID, media);
            } else if (notification.action === 'Video') {
                this.callKeepAcceptCall(callUUID, media);
            } else if (notification.action === 'Audio') {
                media.video = false;
                this.callKeepAcceptCall(callUUID, media);
            } else if (notification.action === 'Reject') {
                this.callKeepRejectCall(callUUID);
            } else if (notification.action === 'Dismiss') {
                this.dismissCall(callUUID);
            }
        } else if (event === 'message') {
            console.log('FCM message', data);
            this.selectChatContact(data['to_uri']);
        }
    }

    async handleFirebasePush(notification) {
        let event = notification.event;
        //console.log("FCM in-app event", event, 'in app state', this.state.appState);

        const from = notification['from_uri'];
        const to = notification['to_uri'];

        if (event === 'incoming_conference_request') {
			const callUUID = notification['session-id'];
			const outgoingMedia = {audio: true, video: notification['media-type'] === 'video'};
			const mediaType = notification['media-type'] || 'audio';
			const account = notification['account'];
			const displayName = notification['from_display_name'];

            utils.timestampedLog('FCM in-app event: incoming conference', callUUID);
            if (!from || !to) {
                console.log('Missing from or to');
                return;
            }
            if (account !== this.state.accountId) {
                console.log('Not for my account');
                return
            }
            this.incomingConference(callUUID, to, from, displayName, outgoingMedia, 'push');
        } else if (event === 'incoming_session') {
			const callUUID = notification['session-id'];
			const displayName = notification['from_display_name'];
			const outgoingMedia = {audio: true, video: notification['media-type'] === 'video'};
			const mediaType = notification['media-type'] || 'audio';
            utils.timestampedLog('FCM in-app event: incoming call', callUUID);
            if (!from) {
                console.log('Missing from');
                return;
            }
            if (to !== this.state.accountId) {
                console.log('Not for my account');
                return
            }
            this.incomingCallFromPush(callUUID, from, displayName, mediaType);
        } else if (event === 'cancel') {
            utils.timestampedLog('FCM in-app event: cancel call', callUUID);
            this.cancelIncomingCall(callUUID);
        } else if (event === 'message') {        
			console.log('FCM in-app event: message', from);
  
			if (this.state.appState != 'active') {
				console.log(Platform.OS, 'Save pending message to AsyncStorage');
				AsyncStorage.setItem(`incomingMessage`, JSON.stringify(notification));
			} else {
				this.incomingMessageFromPush(notification['message_id'], from, notification['content'], notification['content_type']);
			}
        }
    }

    notifyIncomingMessage(message) {
        // when app is active, message was received from websocket
        const from = message.sender.uri;

		if (this.state.blockedUris.indexOf(from) > -1) { 
			utils.timestampedLog('Reject message from blocked URI', from);
			return;
		}
		
		const contact = this.lookupContact(from);
		const display_name = contact.name || from;

        const userInfo = {'data': 
							  {
								  'event': 'message',
								  'from_uri': from,
								  'display_name': contact.name || from,
								  'to_uri': this.state.accountId,       
								  'message_id': message.id,
								  'origin': 'reactNative'
							  }
                         };
               
        //console.log('notifyIncomingMessage', from);

        if (!this.state.selectedContact) {
			if (Platform.OS === 'ios') {
				this.sendLocalNotification('New message', 'From ' + display_name, userInfo);
			} else {
				//this._notificationCenter.postSystemNotification('New message from ' + display_name);
            }

        } else {
			if (this.state.selectedContact.uri !== from) {
				if (Platform.OS === 'ios') {
					this.sendLocalNotification('New message', 'From ' + display_name, userInfo);
				} else {
					//this._notificationCenter.postSystemNotification('New message from ' + display_name);
				}
			} else {
				this.playMessageSound('incoming');
			}
        }

        if (this.state.currentCall && this.state.currentCall.remoteIdentity.uri === from) {
            this.vibrate();
            if (this.currentRoute !== '/ready') {
                this.goBackToHomeFromCall();
            }
            return;
        }
    }

    onRemoteNotification(notification) {
		const data = notification._data?.data;

		if (!data) {
			console.log('No data found in notification');
			return;
		}

		const eventType = data.event;
	
		if (eventType !== 'message') {
			console.log('Unsupported remote notification', eventType);
			return;
		}

		const content = data.content;
		const from = data.from_uri;
		const to = data.to_uri;
		
		// lookupContact(from) returns null when we have no contact record
		// for the sender (e.g. a stranger pushing their PGP public key in
		// the new cross-domain handshake — no contact exists yet on first
		// receive). The original `contact.name || from` was always meant
		// to fall back to the URI, but it was dereferencing before guarding.
		const contact = this.lookupContact(from);
		const displayName = (contact && contact.name) || from;
		data.display_name = displayName;

		console.log('Remote notification message', displayName);

		console.log('Received push message', 'from', displayName, 'to', to);
			
        if (this.state.appState != 'active') {
			try {
				console.log(Platform.OS, 'Save pending message to AsyncStorage');
				AsyncStorage.setItem(`incomingMessage`, JSON.stringify(data));
			} catch (e) {
				console.log('Error handling iOS notification', e);
			}
		} else {
		    if (this.state.selectedContact) {
		        if (this.state.selectedContact.uri != from) {
					this.sendLocalNotification('New message', 'From ' + displayName, data);
				} else {
	                console.log('Nothing to do');
   				}
	        } else {
				this.sendLocalNotification('New message', 'From ' + displayName, data);
	        }
		}
    };

	sendLocalNotification(title, body, userInfo) {
		console.log('sendLocalNotification', userInfo);
	
		const from = userInfo.from_uri;

		if (!from) {
			return;
		}
	
		const now = Date.now();
		const THROTTLE_MS = 60 * 1000; // 60 seconds

		const last = this.outgoingNotifications[from];
	
		// Check throttle
		if (last && (now - last.timestamp < THROTTLE_MS)) {
			console.log(
				`[sendLocalNotification] Throttled notifications for ${from}. ` +
				`Last was ${Math.round((now - last.timestamp)/1000)}s ago.`
			);
			return; // Skip
		}
	
		// Update timestamp for this sender
		this.outgoingNotifications[from] = { timestamp: now };

		console.log(
			`[sendLocalNotification] Delivering notification for ${from}, ` +
			`next throttle window ${THROTTLE_MS}ms`
		);

		// Wrap the payload in a {data: ...} envelope so it matches the remote
		// push shape expected by AppDelegate.m -> willPresentNotification
		// (which reads userInfo[@"data"]). Without this, the native handler
		// sees an empty dict, returns "Missing event", and suppresses the banner.
		const wrappedUserInfo = userInfo && userInfo.data ? userInfo : { data: userInfo };

		// Use addNotificationRequest (UNUserNotifications framework). The older
		// presentLocalNotification uses UILocalNotification, which Apple removed
		// in iOS 17 — on iOS 17+ it silently no-ops. addNotificationRequest is
		// the modern replacement and is what triggers willPresentNotification
		// when the app is foregrounded.
		const inner = (wrappedUserInfo && wrappedUserInfo.data) || {};
		const reqId = inner.message_id
			? `msg-${inner.message_id}`
			: `msg-${from}-${now}`;

		PushNotificationIOS.addNotificationRequest({
			id: reqId,
			title: title,
			body: body,
			sound: 'default',
			userInfo: wrappedUserInfo,
		});
	}

    updateTotalUread() {
       let total_unread = 0;

	   for (const contact of this.state.allContacts) {		
            total_unread = total_unread + contact.unread.length;
       };

       console.log('Total unread messages', total_unread)

       if (Platform.OS === 'ios') {
           PushNotification.setApplicationIconBadgeNumber(total_unread);
       } else {
            ShortcutBadge.setCount(total_unread);
       }
    }
    
    onLocalNotification(notification) {
        // when touch push notification in iOS
		const notification_data = notification.getData();
		const data = notification_data.data ? notification_data.data : notification_data;
        console.log('onLocalNotification', data);

  	    const eventType = data.event;

		if (eventType === 'message') {
			const from = data.from_uri;

			if (!this.state.selectedContact) {
				this.updateTotalUread();
			}

			this.selectChatContact(from);
		} else if (eventType === 'location_stopped') {
			// User tapped the "Live location stopped" banner. iOS brings
			// the app forward first; from here we'd like to hand them
			// off to Sylk's Settings pane so they can flip Location to
			// Always. iOS doesn't expose an App Store-safe URL to deep
			// link into a specific permission row — `app-settings:` only
			// lands on the app's permissions list — so we show a short
			// guidance Alert first ("tap Location → Always"), then open
			// Settings on OK. Otherwise a user unfamiliar with the iOS
			// Settings layout can easily get lost among the 5-6 rows.
			const from = data.from_uri;
			if (from) {
				// Route to the chat first — they'll want to see the
				// system note that explains the stop.
				this.selectChatContact(from);
			}
			try {
				Alert.alert(
					'Enable background location',
					"On the next screen, tap \u2018Location\u2019, then choose \u2018Always\u2019.\n\nThis lets Sylk keep sharing your live location with your contact when Sylk is in the background.",
					[
						{text: 'Cancel', style: 'cancel'},
						{text: 'Open Settings', onPress: () => {
							try { Linking.openURL('app-settings:'); }
							catch (e) { console.log('could not open Settings', e && e.message); }
						}},
					],
					{cancelable: true}
				);
			} catch (e) {
				// Alert failed — fall back to opening Settings directly.
				try { Linking.openURL('app-settings:'); }
				catch (ee) { console.log('onLocalNotification: could not open Settings', ee && ee.message); }
			}
		}
    }
  
    selectChatContact(uri) {
        console.log('-- selectChatContact', uri);
        const chatContact = this.lookupContact(uri, true, true);
		this.selectContact(chatContact);
		this.initialChatUri = uri;
    }

    cancelIncomingCall(callUUID) {
        if (this.unmounted) {
            return;
        }

        this.hideInternalAlertPanel('cancel');

        utils.timestampedLog('Push notification: cancel call', callUUID);

        let call = this.callKeeper._calls.get(callUUID);
        if (!call) {
            if (!this.callKeeper._cancelledCalls.has(callUUID)) {
                utils.timestampedLog('Cancel incoming call that did not arrive on web socket', callUUID);
                this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
				this.resetStartedByPush('cancelIncomingCall')
				if (this.currentRoute) {
					this.changeRoute('/ready', 'incoming_call_cancelled');
					this._notificationCenter.postSystemNotification('Incoming call was cancelled');
				}

                this.updateLoading(null, 'cancel_incoming_call');
            }
            return;
        } else {
			if (this.callKeeper._acceptedCalls.has(callUUID)) {
                utils.timestampedLog('Call was already accepted', callUUID);
				return;
			}
        }

        if (call.state === 'incoming') {
            utils.timestampedLog('Cancel incoming call that was not yet accepted', callUUID);
            this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
            if (this.startedByPush) {
                if (this.currentRoute) {
                    this.changeRoute('/ready', 'incoming_call_cancelled');
                }
            }
        }
    }

    _wiredHeadsetDetect(data) {
        //console.log('Wired headset:', data);
        // {'isPlugged': boolean, 'hasMic': boolean, 'deviceName': string }
        this.setState({'headsetIsPlugged': data.isPlugged});
        if (data.isPlugged) {
           this.speakerphoneOff();
        }
    }

    _onPushkitRegistered(token) {
        utils.timestampedLog(Platform.OS, 'VoIP push token', token, 'registered');
        this.pushkittoken = token;
    }

    _onPushRegistered(token) {
        utils.timestampedLog(Platform.OS, 'normal push token', token, 'registered');
        this.pushtoken = token;
    }

    _sendPushToken() {
		if (this.pushTokenSent) {
			return;
		}
        if (!this.pushtoken) {
			utils.timestampedLog('Error: no push token available');
            return;
        }

        let token = null;

        if (Platform.OS === 'ios') {
            token = `${this.pushkittoken}-${this.pushtoken}`;
        } else if (Platform.OS === 'android') {
            token = this.pushtoken;
        }

        utils.timestampedLog('Push token', token, 'for app', bundleId, 'sent');
        this.state.account.setDeviceToken(token, Platform.OS, this.deviceId, false, bundleId);
        this.pushTokenSent = true;
    }

    _handleAndroidFocus = nextFocus => {
        //utils.timestampedLog('----- Android APP in focus');
        PushNotification.cancelAllLocalNotifications();

        this.setState({inFocus: true});
        this.refreshNavigationItems();
        this.respawnConnection();
     }

    refreshNavigationItems() {
        var todayStart = new Date();
        todayStart.setHours(0,0,0,0);

        var recentStart = new Date();
        recentStart.setDate(recentStart.getDate() - 2);
        recentStart.setHours(0,0,0,0);

        let today = false;
        let recent = false;
        let conference = false;

        let navigationItems = this.state.navigationItems;

		for (const contact of this.state.allContacts) {		
		  // Check conference flag
		  if (contact.tags.indexOf('conference') > -1 || contact.conference) {
			conference = true;
		  }

		  if (contact.timestamp > todayStart) {
			  today = true;
		  }

		  if (contact.timestamp > recentStart) {
		      recent = true;
		  }
		}

        navigationItems = {today: today, recent: recent, conference: conference};
        this.setState({navigationItems: navigationItems});
     }

    _handleAndroidBlur = nextBlur => {
        //utils.timestampedLog('----- APP out of focus');
        this.setState({inFocus: false});
    }

    _handleAppStateChange = nextAppState => {
        //utils.timestampedLog('--- APP state changed', this.state.appState, '->', nextAppState);

        const oldState = this.state.appState;

        this.setState({appState: nextAppState});

        if (nextAppState === 'active') {
            this.respawnConnection(nextAppState);
            if (Platform.OS === 'ios') {
				IdleTimerModule.setIdleTimerDisabled(this.state.autoAnswerMode);
            }

            //this.fetchSharedItemsAndroidAtStart('app_active');
            this.fetchSharedItemsiOS();
            this.checkPendingActions();

            // Restore the active chat when app returns to foreground while
            // still viewing a contact's chat screen. Without this the native
            // `currentChat` pref stays null and incoming FCM messages for the
            // currently viewed chat would wrongly increment the badge.
            if (Platform.OS === 'android' && this.state.selectedContact) {
                const uri = this.state.selectedContact.uri;
                SylkBridge.setActiveChat(uri);
                UnreadModule.resetUnreadForContact(uri);
                this.confirmRead(uri, 'app_foreground');
            }

        } else {
            if (Platform.OS === 'ios') {
				IdleTimerModule.setIdleTimerDisabled(false);
            }

            if (oldState == 'active') {
                //this.endShareContent();
                this.setFullScreen(false);
				this.purgeSharedFiles();
				if (Platform.OS === 'android') {
					SylkBridge.setActiveChat(null);
				}
			}
        }
    }

    respawnConnection(state) {
        if (!this.state.connection) {
            utils.timestampedLog('Web socket does not exist');
        } else if (!this.state.connection.state) {
            utils.timestampedLog('Web socket is waiting for connection...');
        } else {
            /*
            if (this.state.connection.state !== 'ready' && this.state.connection.state !== 'connecting') {
                utils.timestampedLog('Web socket', Object.id(this.state.connection), 'reconnecting because', this.state.connection.state);
                this.state.connection.reconnect();
                utils.timestampedLog('Web socket', Object.id(this.state.connection), 'new state is', this.state.connection.state);
            }
            */
        }

        if (this.state.account) {
            if (!this.state.connection) {
                utils.timestampedLog('Active account without connection removed');
                this.setState({account: null});
            }
        } else {
            //utils.timestampedLog('No active account');
        }

        if (this.state.accountId && (!this.state.connection || !this.state.account) && this.state.accountVerified) {
            this.handleRegistration(this.state.accountId, this.state.password, 'respawnConnection');
        }
    }

    closeConnection(reason='unmount') {
        utils.timestampedLog('Web socket closeConnection:', reason);
        
        if (!this.state.connection) {
            return;
        }

        if (!this.state.account && this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
            this.state.connection.close();
            utils.timestampedLog('Web socket', Object.id(this.state.connection), 'will close');
            this.setState({connection: null, account: null});
        } else if (this.state.connection && this.state.account) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);

            this.state.account.removeListener('outgoingCall', this.outgoingCall);
            this.state.account.removeListener('conferenceCall', this.outgoingConference);
            this.state.account.removeListener('incomingCall', this.incomingCallFromWebSocket);
            this.state.account.removeListener('missedCall', this.missedCall);
            this.state.account.removeListener('conferenceInvite', this.conferenceInviteFromWebSocket);

			console.log('LO - Remove connection account');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    if (error) {
                        utils.timestampedLog('Failed to remove account:', error);
                    } else {
                        //utils.timestampedLog('Account removed');
                    }

                    if (this.state.connection) {
                        utils.timestampedLog('Web socket', Object.id(this.state.connection), 'will close');
                        this.state.connection.close();
                    }

                    this.setState({connection: null, account: null});
                }
            );
        } else {
            this.setState({connection: null, account: null});
        }
    }

    startCallFromCallKeeper(data) {
        utils.timestampedLog('Starting call from OS...');
        let callUUID = data.callUUID || uuid.v4();
        let is_conf = data.handle.search('videoconference.') === -1 ? false: true;

        this.backToForeground();

        if (is_conf) {
            this.callKeepStartConference(data.handle, {audio: true, video: data.video || true, callUUID: callUUID});
        } else {
            this.callKeepStartCall(data.handle, {audio: true, video: data.video, callUUID: callUUID});
        }

        if (this._notificationCenter) {
			this._notificationCenter.removeNotification();
        }
    }

    async createChatContact(uri) {
        console.log('createChatContact', uri);

		if (uri.indexOf('@') === -1) {
			uri = uri + '@' + this.state.defaultDomain;
		}

		let chatContact = this.lookupContact(uri, true, true);
		console.log('chatContact', chatContact);
		this.setState({selectedContact: chatContact});

		// If this contact has no cached public key, fetch it now so E2EE
		// is ready by the time the user sends their first message.
		if (chatContact && chatContact.uri
				&& chatContact.uri !== this.state.accountId
				&& !chatContact.publicKey) {
			this.lookupPublicKey(chatContact);
		}

		// Same deferred "drain pending meeting request" pass as selectContact.
		if (chatContact && chatContact.uri && this.pendingMeetingRequests[chatContact.uri]) {
			setTimeout(() => this._presentMeetingRequestForUri(chatContact.uri), 0);
		}
	}

    selectContact(contact, origin='') {
        //console.log('selectContact', contact);
        if (contact !== this.state.selectedContact) {
            this.setState({pinned: false});
        }

		this.setState({selectedContact: contact});
        this.initialChatUri = null;

		// If we don't have the contact's public key cached yet, trigger
		// a server-side lookup as soon as the chat view opens — this
		// gives E2EE the best chance of being available by the time the
		// user starts typing, instead of waiting for the first send.
		if (contact && contact.uri
				&& contact.uri !== this.state.accountId
				&& !contact.publicKey) {
			this.lookupPublicKey(contact);
		}

		// Drain any queued "Until we meet" request for this chat now that
		// the user has actually opened it. Deferred so setState above has
		// propagated — _presentMeetingRequestForUri marks the request
		// handled before showing, so an immediate re-call is safe.
		if (contact && contact.uri && this.pendingMeetingRequests[contact.uri]) {
			setTimeout(() => this._presentMeetingRequestForUri(contact.uri), 0);
		}
    }

    connectionStateChanged(oldState, newState) {
        console.log('--- connectionStateChanged', newState);
        if (this.unmounted) {
            console.log('App is not yet mounted');
            return;
        }

        const connection = this.getConnection();

        if (oldState) {
            utils.timestampedLog('Web socket', connection, 'state changed:', oldState, '->' , newState);
        }

        switch (newState) {
            case 'closed':
                this.syncRequested = false;
                if (this.state.connection) {
                    //utils.timestampedLog('Web socket was terminated');
                    this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
                    //this._notificationCenter.postSystemNotification('Connection lost');
                }
                //this.setState({connection: null, account: null});
                this.setState({account: null});
                break;
            case 'ready':
                this._notificationCenter.removeNotification();
                this.updateLoading(null, 'ready');
                if (this.state.accountVerified || this.signIn) {
                    this.processRegistration(this.state.accountId, this.state.password);
                    this.callKeeper.setAvailable(true);
                } else {
                    console.log('We do not have accountVerified yet nor sign in', this.state.accountVerified, this.signIn);
                }

				if (this.state.appState == 'active' && this.state.selectedContact) {
					this.confirmRead(this.state.selectedContact.uri, 'ready');
				}
                break;
            case 'disconnected':
                this.syncRequested = false;
                if (this.registrationFailureTimer) {
                    clearTimeout(this.registrationFailureTimer);
                    this.registrationFailureTimer = null;
                }
                if (this.state.currentCall && this.state.currentCall.direction === 'outgoing') {
                    this.hangupCall(this.state.currentCall.id, 'outgoing_connection_failed');
                }

                if (this.state.incomingCall) {
                    this.hangupCall(this.state.incomingCall.id, 'connection_failed');
                }

                this.setState({
                    registrationState: 'failed',
                    generatedVideoTrack: false,
                    });

                if (this.currentRoute === '/login' && this.state.registrationKeepalive) {
                    this.changeRoute('/ready', 'websocket disconnected');
                }

                break;
            default:
                if (this.state.registrationKeepalive && !this.state.accountVerified) {
                    //this.updateLoading('Connecting...', 'connection');
                }
                break;
        }
    }

    notificationCenter() {
        return this._notificationCenter;
    }

    showRegisterFailure(reason=null) {
        const connection = this.getConnection();

		if (typeof reason === 'string' && reason.includes('Wrong')) {
            // Auth failure: clear this.signIn so a subsequent connection
            // 'ready' event (e.g. websocket reconnect while the user is still
            // on the failed-login screen) doesn't silently re-fire
            // processRegistration with the same bad credentials via the
            // `if (accountVerified || signIn)` guard in connectionStateChanged.
            console.log('LO - showRegisterFailure: auth failure, clearing this.signIn');
            this.signIn = false;

            if (this.state.connection) {
				console.log('LO - Remove connection account');
				this.state.connection.removeAccount(this.state.account,
					(error) => {
						this.setState({registrationState: null, registrationKeepalive: false});
					}
				);
				this.setState({account: null});
            }
        }

        utils.timestampedLog('Registration error: ' + reason, 'on web socket', connection);
        this.setState({
            registrationState: 'failed',
            status      : {
                msg   : 'Sign In failed: ' + reason,
                level : 'danger'
            }
        });

		//this._notificationCenter.postSystemNotification(reason);

        this.updateLoading(null, 'show_register_failure');

        if (this.startedByPush) {
            // TODO: hangup incoming call
        }

        if (this.currentRoute === '/login' && this.state.accountVerified) {
            this.changeRoute('/ready', 'register failure');
        }
    }

    registrationStateChanged(oldState, newState, data) {
        //console.log('registrationStateChanged', oldState, newState);
        if (this.unmounted) {
            return;
        }

        const connection = this.getConnection();

        if (oldState) {
            utils.timestampedLog('Registration state changed:', oldState, '->', newState, 'on web socket', connection);
        }

        if (!this.state.account) {
            utils.timestampedLog('No account active yet');
            this.updateLoading(null, 'account_disabled');
            return;
        }

        if (newState === 'failed') {
            let reason = data.reason;

            if (reason.indexOf('904') > -1) {
                // Sofia SIP: WAT
                reason = 'Wrong account or password';
            } else if (reason === 408) {
                reason = 'Timeout';
            }

            this.showRegisterFailure(reason);

            if (this.state.registrationKeepalive) {
                if (this.state.connection !== null && this.state.connection.state === 'ready') {
                    utils.timestampedLog('Retry to register...');
                    this.state.account.register();
                }
            } else {
                // add a timer to retry register after awhile
                if (reason >= 500 || reason === 408) {
                    utils.timestampedLog('Retry to register after 5 seconds delay...');
                    setTimeout(this.state.account.register(), 5000);
                } else {
                    if (this.registrationFailureTimer) {
                        utils.timestampedLog('Cancel registration timer');
                        clearTimeout(this.registrationFailureTimer);
                        this.registrationFailureTimer = null;
                    }
                }
            }

            if (this.currentRoute === '/login' && this.state.accountVerified)  {
                this.changeRoute('/ready', 'register failed');
            }

        } else if (newState === 'registered') {
			
			this.requestSyncConversations(this.state.lastSyncId);
  		    this.replayJournal();

            if (this.registrationFailureTimer) {
                clearTimeout(this.registrationFailureTimer);
                this.registrationFailureTimer = null;
            }

            /*
            setTimeout(() => {
                this.updateServerHistory()
            }, 1000);
            */

            if (this.state.enrollment) {
                let myContact = this.lookupContact(this.state.account.id);
                if (!myContact) {
					myContact = this.newContact(this.state.account.id, this.state.displayName, {src: 'enrollment'});
					myContact.email = this.state.email;
					this.saveSylkContact(this.state.account.id, myContact, 'enrollment');
                }
            }

            if (this.mustSendPublicKey) {
                this.sendPublicKey();
            }
            
            this.setState({accountVerified: true,
                           enrollment: false,
                           registrationKeepalive: true,
                           registrationState: 'registered'
                           });

            this.saveSqlAccount(this.state.account.id, 1, this.state.password);

            this.updateLoading(null, 'registered');

			setTimeout(() => {
				this.requestNotificationsPermission();
			}, 40000);

            //if (this.currentRoute === '/login' && (!this.startedByPush || Platform.OS === 'ios'))  {
            // TODO if the call does not arrive, we never get back to ready
            if (this.currentRoute === '/login' && !this.signOut) {
                this.changeRoute('/ready', 'registered');
            }
            return;
        } else {
            this.setState({status: null, registrationState: newState });
        }
    }
    
    async checkFileTransferDirectory(uri, dirs) {
        return;
		let query;
        for (const id of dirs) {
            query = "SELECT * from messages where msg_id = ? and account = ?";
			await this.ExecuteQuery(query,[id, this.state.accountId]).then((results) => {
				let rows = results.rows;
				if (rows == 0) {
					console.log('File transfer', id, 'does not exist');
				} else {
					console.log('File transfer', id, 'does     exist');
				
				}
			}).catch((error) => {
			});
        }
    }

	async getStorageUsage(uri) {
		console.log('getStorageUsage', uri);
	
		const sizes = await utils.getRemotePartySizes(this.state.accountId, uri);
		
		await this.purgeFiles(uri);
			
		try {
			// Build lookup map
			const sizeMap = {};
			sizes.forEach(item => {
			    if (uri && item.dirs) {
					this.checkFileTransferDirectory(uri, item.dirs);
			    }
				sizeMap[item.remote_party] = {
					size: item.size,
					prettySize: item.prettySize
				};
			});
	
			this.setState(prevState => {
	
				let updatedContacts;
	
				if (uri) {
					// Update only the requested URI
					const info = sizeMap[uri] || { size: 0, prettySize: "" };
	
					updatedContacts = prevState.allContacts.map(contact => {
						if (contact.uri !== uri) return contact;
	
						return {
							...contact,
							storage: info.size,
							prettyStorage: info.prettySize
						};
					});
	
				} else {
					// Update all contacts (original behavior)
					updatedContacts = prevState.allContacts.map(contact => {
						const info = sizeMap[contact.uri] || { size: 0, prettySize: "" };
	
						return {
							...contact,
							storage: info.size,
							prettyStorage: info.prettySize
						};
					});
				}
	
				return {
					storageUsage: uri ? prevState.storageUsage : sizes,
					allContacts: updatedContacts
				};
			});
	
		} catch (e) {
			console.log('getStorageUsage error:', e);
		}
	}

	updateStorageForContact(uri, removedSize = 0, addedSize = 0) {
		console.log('Updating storage for', uri, 'Removed:', removedSize, 'Added:', addedSize);
	
		const netChange = addedSize - removedSize;
	
		try {
			this.setState(prevState => {
	
				// ---- 1️⃣ Update allContacts (ARRAY) ----
				let contactFound = false;
	
				const updatedContacts = prevState.allContacts.map(contact => {
					if (contact.uri !== uri) {
						return contact;
					}
	
					contactFound = true;
	
					const prevSize = contact.storage || 0;
					const newSize = Math.max(prevSize + netChange, 0);
	
					return {
						...contact,
						storage: newSize,
						prettyStorage: newSize > 0
							? utils.formatBytes(newSize)
							: "0 B"
					};
				});
	
				// If contact does not exist but we added size
				let finalContacts = updatedContacts;
	
				if (!contactFound && addedSize > 0) {
					finalContacts = [
						...updatedContacts,
						{
							uri,
							storage: addedSize,
							prettyStorage: utils.formatBytes(addedSize)
						}
					];
				}
	
				// ---- 2️⃣ Update storageUsage ----
				const updatedStorageUsage = [...prevState.storageUsage];
				const idx = updatedStorageUsage.findIndex(
					item => item.remote_party === uri
				);
	
				if (idx >= 0) {
					const prevSize = updatedStorageUsage[idx].size || 0;
					const newSize = Math.max(prevSize + netChange, 0);
	
					updatedStorageUsage[idx] = {
						...updatedStorageUsage[idx],
						size: newSize,
						prettySize: utils.formatBytes(newSize),
					};
				} else if (netChange !== 0) {
					updatedStorageUsage.push({
						remote_party: uri,
						size: netChange,
						prettySize: utils.formatBytes(netChange),
					});
				}
	
				// ---- 3️⃣ Update "all" total ----
				const allIdx = updatedStorageUsage.findIndex(
					item => item.remote_party === 'all'
				);
	
				if (allIdx >= 0) {
					const prevAll = updatedStorageUsage[allIdx].size || 0;
					const newAll = Math.max(prevAll + netChange, 0);
	
					updatedStorageUsage[allIdx] = {
						...updatedStorageUsage[allIdx],
						size: newAll,
						prettySize: utils.formatBytes(newAll),
					};
				}
	
				updatedStorageUsage.sort((a, b) => b.size - a.size);
	
				return {
					allContacts: finalContacts,
					storageUsage: updatedStorageUsage
				};
	
			}, () => {
				const contact = this.state.allContacts.find(c => c.uri === uri);
				const updatedContactStorage = contact?.prettyStorage || "0 B";
	
				const allStorage =
					this.state.storageUsage.find(item => item.remote_party === 'all')?.prettySize
					|| "0 B";
	
				console.log(`Final storage for ${uri}: ${updatedContactStorage}`);
				console.log(`Final storage for all: ${allStorage}`);
			});
	
		} catch (e) {
			console.error('Error updating storage:', e);
		}
	}

    async loadAccounts(init=false) {
        console.log(' --- loadAccounts (init=', init, ')');

		// NOTE: the `verified` SQL column is deprecated and no longer read
		// or written. Auto-login is now gated on `active == 1` alone: the
		// only code path that sets active=1 is the 'registered' handler in
		// registrationStateChanged, so active=1 already implies a prior
		// successful registration.
		let query = "SELECT * FROM accounts order by last_active_timestamp DESC";
		let accounts = {};
		let serversAccounts = {};

		// Cleanup queries: only run if stale rows actually exist to avoid
		// taking the SQLite write lock on every startup.
		const staleCheck = await this.ExecuteQuery(
			"SELECT count(*) as n FROM accounts WHERE account like 'sip:%' OR account = ''", []
		);

		if (staleCheck.rows.item(0).n > 0) {
			await this.ExecuteQuery("delete from accounts where account like 'sip:%'", []);
			await this.ExecuteQuery("delete from accounts where account = ''", []);
		}

        let init_active_account = false;
        let account;
        let password;

		await this.ExecuteQuery(query, []).then((results) => {
			let rows = results.rows;
			for (let i = 0; i < rows.length; i++) {
				var item = rows.item(i);
				accounts[item.account] = item.server;
				console.log('[loadAccounts] row #', i,
					'account=', item.account,
					'server=', item.server,
					'active=', item.active,
					'passwordLen=', (item.password ? String(item.password).length : 0),
					'last_active_timestamp=', item.last_active_timestamp);

				if (item.active == "1" || item.active == 1) {
					init_active_account = true;
					if (this.state.accountId != item.account && !this.signOut) {
						console.log('LO - Auto login', item.account);
						if (!item.password || String(item.password).length === 0) {
							console.log('LO - Auto login BUG: stored password is empty for', item.account);
						}
						this.setState({accountVerified: true, accountId: item.account});
						account = item.account;
						password = item.password;
						this.changeRoute('/ready', 'start_up');
						setTimeout(() => {this.handleRegistration(account, password, 'loadAccounts');}, 10);
					}
				}

				if (item.server && !(item.server in serversAccounts)) {
				    // only add the most recent one
					serversAccounts[item.server] = {account: item.account, password: item.password};
				}
			}

			if (!init_active_account) {
			    // go to login screen
			    console.log('No active account, yet');
				this.changeRoute('/login', 'start_up');
			} else {
			    if (!this.signOut) {
					this.loadSylkContacts('loadAccounts');
				}
			}

			this.setState({accounts: accounts, serversAccounts: serversAccounts});

		}).catch((error) => {
			console.log('SQL loadAccounts error:', error);
		});
    }

    async loadAccount() {
		 if (!this.state.accountId) {
            console.log('Cannot load account without accountId');
            return;
		 }

		 if (this.signOut) {
            console.log('Cannot load account if signOut');
            return;
		 }

        console.log('LO - Loading active account', this.state.accountId);

        let keyStatus = this.state.keyStatus;

		let query = "SELECT * FROM accounts where account = ?";

		await this.ExecuteQuery(query, [this.state.accountId]).then((results) => {
			const rows = results.rows;
			if (rows.length === 1) {
				const data = rows.item(0);
				let keys = {};

                keys.public = data.public_key;
				keys.private = data.private_key;

                if (keys.public && keys.private) {
					utils.timestampedLog('PGP private keys loaded from account');
                    keyStatus.existsLocal = true;
                } else {
                    keyStatus.existsLocal = false;
					console.log('PGP private keys not saved for account');
                }
                
				this.setState({rejectAnonymous: data.reject_anonymous == "1",
				               dnd: data.dnd == "1",
				               keys: keys,
				               lastSyncId: data.last_sync_id,
				               chatSounds: data.chat_sounds == "1",
				               // Default ON for read receipts: existing accounts
				               // pre-migration return null here, and we want
				               // them to keep behaving as they did (sending
				               // 'displayed' IMDN) unless the user explicitly
				               // turns the setting off.
				               readReceipts: data.read_receipts == null
				                   ? true
				                   : data.read_receipts != "0",
				               keyStatus: {...keyStatus},
				               rejectNonContacts: data.reject_non_contacts == "1"}
				               );

				setTimeout(() => {this.checkPendingActions()}, 10);

			} else {
				console.log('No account found in database');
			}

		}).catch((error) => {
			console.log('SQL loadAccount error:', error);
		});
    }
    
    async saveSqlAccount(account, active, password) {
		let timestamp = new Date();

        // NOTE: password should never be empty by the time we get here;
        // if it is, that is a bug in the caller (don't hide it by returning).
        if ((active == 1 || active == "1") && (!password || String(password).length === 0)) {
            console.log('LO - saveSqlAccount BUG: empty password for active=1 account', account,
                '(persisting active flag anyway)');
        }

        // `verified` column intentionally not written — deprecated, see note on loadAccounts.
        let params = [active, account, password, this.state.sylkDomain, JSON.stringify(timestamp)];
        let query = "INSERT INTO accounts (active, account, password, server, last_active_timestamp) VALUES (?, ?, ?, ?, ?)"

        if (active == 0 || active == "0") {
			await this.ExecuteQuery("update accounts set active = 0", []);
            params = [active, account, this.state.sylkDomain];
            query = "INSERT INTO accounts (active, account, server) VALUES (?, ?, ?)"
        }

		await this.ExecuteQuery(query, params).then((result) => {
            console.log('LO - SQL inserted account', account, 'for server', this.state.sylkDomain);
            this.loadAccount();
			this.loadAccounts();
        }).catch((error) => {
			this.updateSqlAccount(account, active, password);
		});
    }

    async updateSqlAccount(account, active, password) {
		let timestamp = new Date();
        // `verified` column intentionally not written — deprecated, see note on loadAccounts.
        let params = [active, password, JSON.stringify(timestamp), this.state.sylkDomain, account];
        let query = "update accounts set active = ?, password = ?, last_active_timestamp = ?, server = ? where account = ?"

        if (active == 0 || active == "0") {
            params = [active, this.state.sylkDomain, account];
            query = "update accounts set active = ?, server = ? where account = ?"
        }

		await this.ExecuteQuery(query, params).then((result) => {
			console.log('LO - SQL updated account', account, active, 'for server', this.state.sylkDomain);
			if (result.rowsAffected) {
				this.loadAccounts();
			}
		}).catch((error) => {
			console.log('SQL updateSqlAccount error:', error);
		});
    }
        
    async showAlertPanel(data, source) {
        if (Platform.OS === 'android') {
            const phoneAllowed = await this.requestPhonePermission();
            if (!phoneAllowed) {
                this._notificationCenter.postSystemNotification('Phone permission denied');
                this.changeRoute('/ready', 'phone_permission_denied');
                return;
            }
            console.log('Alert panel is now handled by FCM notification');
            return;
        }

        console.log('Show alert panel requested by', source);

        if (this.callKeeper._cancelledCalls.has(data.callUUID)) {
            console.log('Show internal alert panel cancelled');
            return;
        }

        if (this.callKeeper._terminatedCalls.has(data.callUUID)) {
            console.log('Show internal alert panel cancelled');
            return;
        }

        if (this.callKeeper._acceptedCalls.has(data.callUUID)) {
            console.log('Show internal alert panel cancelled');
            return;
        }

        if (this.callKeeper._rejectedCalls.has(data.callUUID)) {
            console.log('Show internal alert panel cancelled');
            return;
        }
        
        let contact;
        let media = {audio: true, video: false};
        let callId;
        let from;
        let displayName;

        if ('from_display_name' in data && 'from_uri' in data) {
            // Firebase notification
            from = data.from_uri;
            displayName = data.from_display_name;
            callId = data['session-id'];
            if (data['media-type'] === 'video') {
                media.video = true;
            }
        } else if (data.hasOwnProperty('_remoteIdentity')) {
            // Sylk call object
            from = data.remoteIdentity.uri;
            displayName = data.remoteIdentity.displayName;
            callId = data.id;
            if (data.mediaTypes && data.mediaTypes.video) {
                media.video = true;
            }
        } else {
            console.log('Missing contact data for Alert panel');
            return;
        }

        if (displayName === "<null>") {
            displayName = from;
        }

        if (this.state.dnd && this.state.favoriteUris.indexOf(from) === -1) {
            console.log('Do not disturb is enabled');
            this._notificationCenter.postSystemNotification('Missed call from ' + from);
            return;
        }
        
        contact = this.lookupContact(from, true, true);

        if (!callId) {
            console.log('Missing callId for Alert panel');
            return;
        }

		this.audioManagerStart();

        this.setState({incomingCallUUID: callId,
                       incomingContact: contact,
                       incomingMedia: media
                       });
    }
    
    playIncomingRingtone(callUUID, force=false) {
        if (!this.callKeeper.selfManaged) {
            console.log('playIncomingRingtone skip because we are not self managed....');
            return;
        }

        if (this.callKeeper._cancelledCalls.has(callUUID)) {
            console.log('playIncomingRingtone cancelled for', callUUID);
            return;
        }

        if (this.cancelRingtoneTimer) {
            clearTimeout(this.cancelRingtoneTimer);
            this.cancelRingtoneTimer = null;
        } else {
            console.log('Play local ringtone and vibrate');
            //Vibration.vibrate(VIBRATION_PATTERN, true);
            InCallManager.startRingtone('_BUNDLE_');
        }

        this.cancelRingtoneTimer = setTimeout(() => {
            console.log('Cancel ringtones by timer')
            this.stopRingtones();
        }, 45000);
    }

    stopRingtones() {
        if (this.cancelRingtoneTimer) {
            clearTimeout(this.cancelRingtoneTimer);
            this.cancelRingtoneTimer = null;
        }
        InCallManager.stopRingtone();
        Vibration.cancel();
    }

    hideInternalAlertPanel(by=null) {
        //console.log('hideInternalAlertPanel by', by);
        this.stopRingtones();
        this.setState({incomingContact: null,
                       incomingMedia: null});
    }

    vibrate() {
        console.log('Vibrate...');
        Vibration.vibrate(100);
        //Vibration.vibrate(VIBRATION_PATTERN, true);
        
        setTimeout(() => {
             Vibration.cancel();
        }, 1000);
    }


    heartbeat() {
        if (this.unmounted) {
            return;
        }

        this.heartbeats = this.heartbeats + 1;

        if (this.heartbeats % 40 == 0) {
            this.trimLogs();
        }

        if (this.state.connection) {
            //console.log('Check calls in', this.state.appState, 'with connection', Object.id(this.state.connection), this.state.connection.state);
        } else {
            //console.log('Check calls in', this.state.appState, 'with no connection');
        }

        let callState;
        if (this.state.currentCall && this.state.incomingCall && this.state.incomingCall === this.state.currentCall) {
            //utils.timestampedLog('We have an incoming call:', this.state.currentCall ? (this.state.currentCall.id + ' ' + this.state.currentCall.state): 'None');
            callState = this.state.currentCall.state;
        } else if (this.state.incomingCall) {
            //utils.timestampedLog('We have an incoming call:', this.state.incomingCall ? (this.state.incomingCall.id + ' ' + this.state.incomingCall.state): 'None');
            callState = this.state.incomingCall.state;
        } else if (this.state.currentCall) {
            //utils.timestampedLog('We have an outgoing call:', this.state.currentCall ? (this.state.currentCall.id + ' ' + this.state.currentCall.state): 'None');
            callState = this.state.currentCall.state;
        } else if (this.state.outgoingCallUUID) {
            //utils.timestampedLog('We have a pending outgoing call:', this.state.outgoingCallUUID);
        } else {
            //utils.timestampedLog('We have no calls');
            if (this.state.appState === 'background' && this.state.connection && this.state.connection.state === 'ready') {
                //this.closeConnection('background with no calls');
            }
        }

        this.callKeeper.heartbeat();
    }

    startRingback() {
        if (this.ringbackActive) {
            return
        }
        utils.timestampedLog('Start ringback');
        this.ringbackActive = true;
        InCallManager.startRingback('_BUNDLE_');
    }

    stopRingback() {
        utils.timestampedLog('Stop ringback');
        this.ringbackActive = false;
        InCallManager.stopRingback();
    }

    resetGoToReadyTimer() {
        if (this.goToReadyTimer !== null) {
            clearTimeout(this.goToReadyTimer);
            this.goToReadyTimer = null;
        }
    }

    goToReadyNowAndCancelTimer() {
        if (this.goToReadyTimer !== null) {
            clearTimeout(this.goToReadyTimer);
            this.goToReadyTimer = null;
            this.changeRoute('/ready', 'cancel_timer_incoming_call');
        }
    }

    isConference(call) {
        const _call = call || this.state.currentCall;
        if (_call && _call.hasOwnProperty('_participants')) {
            return true;
        }

        return false;
    }

	setProximityChosenDevice() {
		if (this.state.proximityEnabled && !this.state.hasHeadset && !this.state.isFolded) {
			if (this.state.proximityNear) {
				console.log('proximity set BUILTIN_EARPIECE')
				if (this.useInCallManger) {
					this.speakerphoneOff();
				} else {
					this.selectAudioDevice('BUILTIN_EARPIECE');
				}
			} else {
				console.log('proximity set BUILTIN_SPEAKER')
				if (this.useInCallManger) {
				   this.speakerphoneOn();
				} else {
					this.selectAudioDevice('BUILTIN_SPEAKER');
				}
			}
		}
	}

    callStateChanged(oldState, newState, data) {
        if (this.unmounted) {
            return;
        }

        // outgoing accepted: null -> progress -> accepted -> established -> terminated
        // outgoing accepted: null -> progress -> established -> accepted -> terminated (with early media)
        // incoming accepted: null -> incoming -> accepted -> established -> terminated
        // 2nd incoming call is automatically rejected by sylkrtc library
        
        /*
        utils.timestampedLog('---currentCall start:', this.state.currentCall);
        utils.timestampedLog('---incomingCall start:', this.state.incomingCall);
        */

        let call = this.callKeeper._calls.get(data.id);

        if (!call) {
            utils.timestampedLog("callStateChanged error: call", data.id, 'not found in callkeep manager');
            return;
        }

        let callUUID = call.id;
        const connection = this.getConnection();
        utils.timestampedLog('Sylkrtc call', callUUID, 'state change:', oldState, '->', newState);

        /*
        if (newState === 'established' || newState === 'accepted') {
            // restore the correct UI state if it has transitioned illegally to /ready state
            if (call.hasOwnProperty('_participants')) {
                this.changeRoute('/conference', 'correct call state');
            } else {
                this.changeRoute('/call', 'correct call state');
            }
        }
        */

        let newCurrentCall;
        let newincomingCall;
        let direction = call.direction;
        let hasVideo = false;
        let mediaType = 'audio';
        let tracks;
        let readyDelay = 5000;

        if (this.state.incomingCall && this.state.currentCall) {

			if (this.state.searchContacts) {
				this.setState({searchContacts: false});
			}

            if (newState === 'terminated') {
                if (this.state.incomingCall == this.state.currentCall) {
                    newCurrentCall = null;
                    newincomingCall = null;
                }

                if (this.state.incomingCall.id === call.id) {
                    if (oldState === 'incoming') {
                        //utils.timestampedLog('Call state changed:', 'incoming call must be cancelled');
                        this.hideInternalAlertPanel(newState);
                    }

                    if (oldState === 'established' || oldState === 'accepted') {
                        //utils.timestampedLog('Call state changed:', 'incoming call ended');
                        this.hideInternalAlertPanel(newState);
                    }
                    // new call must be cancelled
                    newincomingCall = null;
                    newCurrentCall = this.state.currentCall;
                }

                if (this.state.currentCall != this.state.incomingCall && this.state.currentCall.id === call.id) {
                    if (oldState === 'established' || newState === 'accepted') {
                        //utils.timestampedLog('Call state changed:', 'outgoing call must be hangup');
                        // old call must be closed
                    }
                    newCurrentCall = null;
                    newincomingCall = this.state.incomingCall;
                }
                                
            } else if (newState === 'accepted') {
                if (this.state.incomingCall === this.state.currentCall) {
                    newCurrentCall = this.state.incomingCall;
                    newincomingCall = this.state.incomingCall;
                } else {
                    newCurrentCall = this.state.currentCall;
                }
            } else if (newState === 'established') {
                if (this.state.incomingCall === this.state.currentCall) {
                    //utils.timestampedLog("Incoming call media started");
                    newCurrentCall = this.state.incomingCall;
                    newincomingCall = this.state.incomingCall;
                } else {
                    //utils.timestampedLog("Outgoing call media started");
                    newCurrentCall = this.state.currentCall;
                }

            } else {
                //utils.timestampedLog('Call state changed:', 'We have two calls in unclear state');
            }
        } else if (this.state.incomingCall) {
            //this.backToForeground();
            //utils.timestampedLog('Call state changed: We have one incoming call');
            newincomingCall = this.state.incomingCall;
            newCurrentCall = this.state.incomingCall;

            if (this.state.incomingCall.id === call.id) {
                if (newState === 'terminated') {
                    if (this.startedByPush) {
                        this.resetStartedByPush('terminated')
                    }

                    utils.timestampedLog("Incoming call was cancelled");
                    this.hideInternalAlertPanel(newState);
                    newincomingCall = null;
                    newCurrentCall = null;
                    readyDelay = 10;
                    
                    this.setState({incomingCall: null});

                } else if (newState === 'accepted') {
                    utils.timestampedLog("Incoming call was accepted");
                    this.hideInternalAlertPanel(newState);
                } else if (newState === 'established') {
                    utils.timestampedLog("Incoming call media started");
                    this.hideInternalAlertPanel(newState);
                }
            }

        } else if (this.state.currentCall) {
            utils.timestampedLog('Call state changed', newState);
            newCurrentCall = newState === 'terminated' ? null : call;
            newincomingCall = null;
            if (newState !== 'terminated') {
                this.setState({reconnectingCall: false});
            }
        } else {
            newincomingCall = null;
            newCurrentCall = null;
        }

        //utils.timestampedLog('---currentCall:', newCurrentCall);
        //utils.timestampedLog('---incomingCall:', newincomingCall);

        let callsState;
        let show_payment_message = false;
        

        switch (newState) {
            case 'progress':

                //this.callKeeper.setCurrentCallActive(callUUID);
                //this.backToForeground();

                this.resetGoToReadyTimer();

                tracks = call.getLocalStreams()[0].getVideoTracks();
                mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';

                if (!this.isConference(call)) {
                    if (mediaType === 'video') {
                        this.speakerphoneOn();
                    } else {
                        this.speakerphoneOff();
                    }
                } else {
                    this.speakerphoneOn();
                }

                break;

            case 'ringing':
                this.setProximityChosenDevice();
                this.startRingback();
                break;

            case 'proceeding':
                utils.timestampedLog(callUUID, 'Proceeding', data.code);
                if (data.code === 110) {
                    utils.timestampedLog(callUUID, 'Push sent to remote party devices');
                }

                this.setProximityChosenDevice();
                this.startRingback();
                break;
            case 'early-media':
                //this.callKeeper.setCurrentCallActive(callUUID);
                //this.backToForeground();
                this.stopRingback();
                this.audioManagerStart();
                this.setProximityChosenDevice();
                break;
            case 'established':
                this.setProximityChosenDevice();

                callsState = this.state.callsState;
                callsState[callUUID] = {startTime: new Date()};
                this.setState({callsState: callsState});
				//InCallManager.start({media: 'audio'});
                this.audioManagerStart();

                this.callKeeper.setCurrentCallActive(callUUID);

                //this.backToForeground();
                this.resetGoToReadyTimer();

                tracks = call.getLocalStreams()[0].getVideoTracks();
                mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';

                if (direction === 'outgoing') {
                    this.stopRingback();
                    if (this.state.speakerPhoneEnabled) {
                        this.speakerphoneOn();
                    } else {
                        this.speakerphoneOff();
                    }
                } else {
                    if (mediaType === 'video') {
                        this.speakerphoneOn();
                    } else {
                        this.speakerphoneOff();
                    }
                }

                break;
            case 'accepted':
                callsState = this.state.callsState;
                callsState[callUUID] = {startTime: new Date()};
                this.setState({callsState: callsState});

                if (direction === 'incoming') {
                    this.callKeeper.setCurrentCallActive(callUUID);
                    if (this.timeoutIncomingTimer) {
                        clearTimeout(this.timeoutIncomingTimer);
                        this.timeoutIncomingTimer = null;
                    }
                }

                if (callUUID === this.state.incomingCallUUID) {
                    this.updateLoading(null, 'incoming_call');
                }

                this.setState({incomingCallUUID: null});

                //this.backToForeground();
                this.resetGoToReadyTimer();

                if (direction === 'outgoing') {
                    this.stopRingback();
                }
                break;

            case 'terminated':
                let uri = call.remoteIdentity.uri.toLowerCase();
                let startTime;
                if (callUUID in this.state.callsState) {
                    callsState = this.state.callsState;
                    startTime = callsState[callUUID].startTime;
                    delete callsState[callUUID];
                    this.setState({callsState: callsState});
                }

                if (callUUID === this.state.incomingCallUUID) {
                    this.setState({incomingCallUUID: null, incomingContact: null});
                    this.updateLoading(null, 'incoming_call');
                }

                this._terminatedCalls.set(callUUID, true);

                if (direction === 'incoming' && this.timeoutIncomingTimer) {
                    clearTimeout(this.timeoutIncomingTimer);
                    this.timeoutIncomingTimer = null;
                }

				if (direction === 'outgoing' && Platform.OS === 'android') {
					SylkBridge.setActiveCall(null);
				}

                if (this.state.incomingCall && this.state.incomingCall.id === call.id) {
                    newincomingCall = null;
                }

                if (this.state.currentCall && this.state.currentCall.id === call.id) {
                    newCurrentCall = null;
                }

	            if (this.state.searchContacts) {
				    this.setState({searchContacts: false});
	            }

                let callSuccesfull = false;
                let reason = data.reason;
                let play_busy_tone = !this.isConference(call);
                let CALLKEEP_REASON;
                let missed = false;
                let cancelled = false;
                let server_failure = false;

                CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;

                if (!reason || reason.match(/200/)) {
                    if (oldState === 'progress') {
                        reason = 'Call timeout';
                    } else if (oldState === 'incoming' || oldState === 'proceeding') {
                        reason = 'Call cancelled';
                        missed = true;
                        play_busy_tone = false;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                    } else {
                        reason = 'Hangup';
                        callSuccesfull = true;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    }
                } else if (reason.match(/402/)) {
                    reason = 'Payment required';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/403/)) {
                    reason = 'Call forbidden';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/404/)) {
                    reason = 'User not found';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/408/)) {
                    reason = 'No answer';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/482/)) {
                    reason = 'Loop detected';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/480/)) {
                    reason = 'Not online';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/486/)) {
                    reason = 'Busy';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                    play_busy_tone = false;
                    cancelled = true;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/4\d\d/)) {
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/DNS/)) {
                    reason = 'Domain not found';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                    server_failure = true;
                    // this does not pass Janus, so the SIP Proxy does not save the CDR
                } else if (reason.match(/603/)) {
                    reason = 'Server rejected call';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                } else if (reason.match(/[5|6]\d\d/)) {
                    reason = 'Server failure: ' + reason;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                    server_failure = true;
                } else if (reason.match(/904/)) {
                    // Sofia SIP: What is this!?
                    reason = 'Wrong account or password';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else {
                    server_failure = true;
                }
                
                if (typeof reason === 'string' && reason.indexOf('DTLS alert') > -1) {
					reason = "TLS media failure";
                }

				this.addHistoryEntry(uri, callUUID, direction);

                utils.timestampedLog(callUUID, direction, 'terminated reason', data.reason, '->', reason);
                
                //this._notificationCenter.postSystemNotification('Call ended:', {body: reason});
                
                if (play_busy_tone) {
                    utils.timestampedLog('Play busy tone');
                    InCallManager.stop({busytone: '_BUNDLE_'});
                } else {
                    this.audioManagerStop();
                }

                this.stopRingback();

                let msg;
                let current_datetime = new Date();
                let formatted_date = utils.appendLeadingZeroes(current_datetime.getHours()) + ":" + utils.appendLeadingZeroes(current_datetime.getMinutes()) + ":" + utils.appendLeadingZeroes(current_datetime.getSeconds());
                let diff = 0;
                if (startTime) {
                    let duration = moment.duration(new Date() - startTime);
                    diff = Math.floor((new Date() - startTime) / 1000);

                    if (diff > 3600) {
                        duration = duration.format('hh:mm:ss', {trim: false});
                    } else {
                        duration = duration.format('mm:ss', {trim: false});
                    }

                    msg = formatted_date + " - " + direction +" " + mediaType + " call ended after " + duration;
                    this.saveSystemMessage(uri, msg, direction, missed);
                    reason = "Call ended after " + duration;
                } else {
                    msg = formatted_date + " - " + direction +" " + mediaType + " call ended (" + reason + ")";
                    this.saveSystemMessage(uri, msg, direction, missed);

                    if (typeof reason === 'string' && reason.indexOf('Payment required') > -1) {
                        show_payment_message = true;
                        setTimeout(() => {
							msg = "See https://sip2sip.info/help for how to call PSTN numbers";
							this.saveSystemMessage(uri, msg, 'incoming', missed, false);
                        }, 2000);
                    }
                }
                
                if (this.currentRoute !== '/call') {
                    this._notificationCenter.postSystemNotification(reason);
                } else {
                    this.setState({terminatedReason: reason});
                }

                this.updateHistoryEntry(call.remoteIdentity.uri.toLowerCase(), callUUID, diff);
                //this.addCallsTag(call.remoteIdentity.uri.toLowerCase());

                this.callKeeper.endCall(callUUID, CALLKEEP_REASON);

                if (play_busy_tone && oldState !== 'established' && direction === 'outgoing') {
                    //this._notificationCenter.postSystemNotification('Call ended:', {body: reason});
                }
                
                this.requestDisplayOverOtherAppsPermission();
                        
                break;
            default:
                break;
        }

        /*
        utils.timestampedLog('---currentCall end:', newCurrentCall);
        utils.timestampedLog('---incomingCall end:', newincomingCall);
        */

        this.setState({
            currentCall: newCurrentCall,
            incomingCall: newincomingCall
        });

		if (!this.state.currentCall && !this.state.incomingCall) {
			if (!this.state.reconnectingCall) {
				if (this.currentRoute !== '/ready') {
					utils.timestampedLog('Will go to ready in', readyDelay/1000, 'seconds (terminated)', callUUID);
					this.goToReadyTimer = setTimeout(() => {
						this.changeRoute('/ready', 'no_more_calls');
					}, readyDelay);
				}
			}
		}

        if (this.state.currentCall) {
            //console.log('Current:', this.state.currentCall.id);
        }
        if (this.state.incomingCall) {
            //console.log('Incoming:', this.state.incomingCall.id);
        }
    }

    finishInviteToConference() {
        this.setState({inviteContacts: false, selectedContacts: []});
    }

    goBackToCall() {
        let call = this.activeCall;
        if (call) {
            if (call.hasOwnProperty('_participants')) {
                this.changeRoute('/conference', 'back to call');
            } else {
                this.changeRoute('/call', 'back to call');
            }
        } else {
            console.log('No call to go back to');
        }
    }

    addCallsTag(uri) {
		let contacts = this.lookupContacts(uri);
		for (const contact of contacts) {
			if (contact.tags.indexOf('calls') === -1) {
				contact.tags.push('calls');
				this.saveSylkContact(uri, contact, 'calls');
			}
        }
	}

    goBackToHome() {
       this.changeRoute('/ready', 'back to home');
    }

    goBackToHomeFromCall() {
        this.changeRoute('/ready', 'back to home');
        if (this.state.callContact) {
            this.setState({selectedContact: this.state.callContact});
        }
    }

    goBackToHomeFromConference() {
        this.changeRoute('/ready', 'back to home');
        if (this.state.callContact) {
            this.setState({selectedContact: this.state.callContact});
        }
    }

    inviteToConference() {
        console.log('Invite contacts to conference...');
        this.goBackToHome();
        setTimeout(() => {
            this.setState({inviteContacts: true, selectedContacts: []});
        }, 100);
    }

    handleEnrollment(account) {
        console.log('LO - Enrollment for new account', account);

		// Enrollment is a fresh sign-in on a (possibly new) server. If the user
		// had previously signed out (on the previous domain), this.signOut is
		// still true and will poison processRegistration and loadAccount. Mirror
		// handleSignIn and clear it here so the enrolled account actually registers.
		this.signOut = false;
		this.signIn = true;

		this.changeRoute('/ready', 'enrollment');

        this.setState({displayName: account.displayName, 
                       enrollment: true, 
                       email: account.email});

        this.handleRegistration(account.id, account.password, 'handleEnrollment');
    }

    async handleSignIn(accountId, password) {
        console.log('LO - [signin] handleSignIn called with accountId=', accountId);
        const c = this.state.connection;
        console.log('LO - [signin] state snapshot: sylkDomain=', this.state.sylkDomain,
            'wsUrl=', this.state.wsUrl,
            'connection=', c ? ('obj#' + Object.id(c) + ' state=' + c.state) : 'null',
            'account=', this.state.account ? ('id=' + this.state.account.id) : 'null',
            'registrationState=', this.state.registrationState,
            'accountVerified=', this.state.accountVerified,
            'this.signOut(before)=', this.signOut,
            'this.signIn(before)=', this.signIn);

        this.signOut = false;
        this.signIn = true;

        this.handleRegistration(accountId, password, 'handleSignIn');
    }

    handleRegistration(accountId, password, origin) {
        const c = this.state.connection;
        console.log('LO - [signin] handleRegistration accountId=', accountId,
            'accountVerified=', this.state.accountVerified,
            'origin=', origin,
            '| wsUrl=', this.state.wsUrl,
            '| connection=', c ? ('obj#' + Object.id(c) + ' state=' + c.state + ' accounts=' + JSON.stringify([...(c._accounts?.keys?.() || [])])) : 'null',
            '| account=', this.state.account ? this.state.account.id : 'null',
            '| registrationState=', this.state.registrationState);

        this.setState({accountId: accountId, password: password});

        if (!this.state.wsUrl) {
			console.log('LO - [signin] bail: no wsUrl yet');
			return;
        }

        if (this.state.account !== null && this.state.registrationState === 'registered' ) {
            console.log('LO - [signin] bail: already registered with account', this.state.account.id);
            return;
        }

        if (this.state.connection === null) {
			console.log('LO - [signin] path A: connection is null, connectToSylkServer()');
			this.connectToSylkServer(false, 'handleRegistration-pathA');
        } else if (this.state.connection.state != 'ready') {
			let _accounts = Object.keys(this.state.connection._accounts);
			console.log('LO - [signin] path B: connection not ready (state=', this.state.connection.state,
				'), existing accounts on connection=', _accounts);
			if (_accounts.indexOf(accountId) === -1) {
                console.log('LO - [signin] path B.1: processRegistration on non-ready connection');
                this.processRegistration(accountId, password);
			} else {
				console.log('LO - [signin] path B.2: account already present on non-ready connection, forcing reconnect');
				this.connectToSylkServer(true, 'handleRegistration-pathB2');
			}

        } else {
            console.log('LO - [signin] path C: connection.state=', this.state.connection.state,
                'registrationState=', this.state.registrationState);
            if (this.state.connection.state === 'ready' && this.state.registrationState !== 'registered') {
                utils.timestampedLog('Web socket', Object.id(this.state.connection), 'handle registration for', accountId);
                console.log('LO - [signin] path C.1: ready + not-registered -> processRegistration over SAME connection');
                this.processRegistration(accountId, password);
            } else if (this.state.connection.state !== 'ready') {
                console.log('LO - [signin] path C.2: connection is not ready');
                if (this._notificationCenter) {
                    //this._notificationCenter.postSystemNotification('Waiting for Internet connection');
                }

                if (this.currentRoute === '/login' && this.state.accountVerified) {
                    this.changeRoute('/ready', 'start_up');
                } else {
                    console.log('Cannot go to ready because account was not verified');
                }
            }
        }
    }

    connectToSylkServer(close=false, caller='unknown') {
		const prev = this.state.connection;
		console.log('[connect] connectToSylkServer caller=', caller,
			'close=', close,
			'wsUrl=', this.state.wsUrl,
			'prevConnection=', prev ? ('obj#' + Object.id(prev) + ' state=' + prev.state + ' wsUri=' + prev._wsUri) : 'null');

        if (close && this.state.connection !== null) {
			console.log('[connect] caller=', caller, 'closing prev connection obj#', Object.id(this.state.connection));
            this.state.connection.close();
        }

		let connection = sylkrtc.createConnection({server: this.state.wsUrl});
		console.log('[connect] caller=', caller, 'createConnection -> obj#', Object.id(connection), 'wsUrl=', this.state.wsUrl);

		utils.timestampedLog('Web socket', Object.id(connection), 'was opened');
		connection.on('stateChanged', this.connectionStateChanged);
		connection.on('publicKey', this.publicKeyReceived);
		this.setState({connection: connection});
	}

    testConnectionToSylkServer(wsUrl) {    
        try {
			console.log('Testing connecting to', wsUrl);   
			let testConnection = sylkrtc.createConnection({server: wsUrl});
			utils.timestampedLog('Web socket', Object.id(testConnection), 'was opened');
			this.setState({testConnection: testConnection});
			testConnection.on('stateChanged', this.testConnectionStateChanged);
		} catch (e) {
			console.log('Error testing Web socket connection', e);
			this.setState({SylkServerDiscoveryResult: 'error'});
			this.setState({SylkServerDiscovery: false});
			return;
		}
	}

    testConnectionStateChanged(oldState, newState) {
        console.log('--- testConnectionStateChanged', newState);
        switch (newState) {
            case 'closed':
				this.state.testConnection.close();
				this.state.testConnection.removeListener('stateChanged', this.testConnectionStateChanged);
			    this.setState({SylkServerDiscoveryResult: newState, 
			                   testConnection: null, SylkServerDiscovery: 
			                   false, SylkServerStatus: 'Server connection failed:' + this.state.testConnectionUrl});
                break;
            case 'ready':

			    this.setState({SylkServerDiscoveryResult: newState, 
			                   testConnection: null, 
			                   SylkServerDiscovery: false, 
			                   SylkServerStatus: 'Server connection successful'});
                break;
            case 'disconnected':
				this.state.testConnection.close();
				this.state.testConnection.removeListener('stateChanged', this.testConnectionStateChanged);
			    this.setState({SylkServerDiscoveryResult: newState, 
			                   testConnection: null, 
			                   SylkServerDiscovery: false, 
			                   SylkServerStatus: 'Server connection failed ' + this.state.testConnectionUrl});
                break;
            default:
                break;
        }
    }
    
    processRegistration(accountId, password, displayName) {
		console.log('LO - processRegistration');

        if (!accountId) {
			return;
        }

        // Block ghost re-registration triggered by a late timer or a
        // connectionStateChanged('ready') event that fires after logout.
        // signOut is a legitimate gate here; empty password, by contrast, is
        // treated as a caller bug and is logged but NOT hidden.
        if (this.signOut) {
            console.log('LO - processRegistration bail: signOut is true');
            return;
        }

        if (!password || String(password).length === 0) {
            console.log('LO - processRegistration BUG: empty password for', accountId,
                '(proceeding anyway so the bug surfaces)');
        }

        if (!displayName) {
            displayName = this.state.displayName;
        }

        utils.timestampedLog('Process registration for', accountId, '(', displayName, ')');

        if (!this.state.connection) {
            console.log('No connection');
            return;
        }

        if (this.state.account && this.state.connection) {
			console.log('LO - Remove connection account');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    this.setState({registrationState: null, registrationKeepalive: false});
                }
            );
        }

        const options = {
            account: accountId,
            password: password,
            displayName: displayName || ''
        };

        if (this.state.connection._accounts.has(options.account)) {
            console.log('Account already exists for connection');
            return;
        }

        if (this.state.accountVerified) {
            // Always clear any previously-armed timer before setting a new one,
            // otherwise boot sequences that call processRegistration twice
            // orphan the first timer (unreachable via this.registrationFailureTimer)
            // and it fires ~10s later as a ghost re-registration.
            if (this.registrationFailureTimer) {
                clearTimeout(this.registrationFailureTimer);
                this.registrationFailureTimer = null;
            }
            this.registrationFailureTimer  = setTimeout(() => {
                this.registrationFailureTimer = null;
                if (this.signOut) {
                    console.log('LO - registrationFailureTimer: signOut=true, skipping');
                    return;
                }
                if (!this.state.accountId || !this.state.password) {
                    console.log('LO - registrationFailureTimer: no accountId/password, skipping');
                    return;
                }
                this.showRegisterFailure('Register timeout');
                this.processRegistration(accountId, password);
            }, 10000);
        }

        console.log('LO - Adding connection account', options.account);

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingConference);
                account.on('registrationStateChanged', this.registrationStateChanged);
                account.on('incomingCall', this.incomingCallFromWebSocket);
                account.on('incomingMessage', this.incomingMessageFromWebSocket);
                account.on('syncConversations', this.syncConversations);
                account.on('readConversation', this.readConversation); // used for my own devices
                account.on('removeConversation', this.removeConversation);
                account.on('removeMessage', this.removeMessage);
                account.on('outgoingMessage', this.outgoingMessage);
                account.on('messageStateChanged', this.messageStateChanged);
                account.on('missedCall', this.missedCall);
                account.on('conferenceInvite', this.conferenceInviteFromWebSocket);
                //utils.timestampedLog('Web socket account', account.id, 'is ready, registering...');

                this.setState({account: account});
				this._sendPushToken();

                account.register();

				account.checkIfKeyExists((serverKey) => {
					let keyStatus = this.state.keyStatus;
					keyStatus.existsOnServer = false;

					if (serverKey) {
						keyStatus.serverPublicKey = serverKey;
						keyStatus.existsOnServer = true;
					}

					this.setState({keyStatus: {...keyStatus}});
				});

            } else {
                console.log('Adding account failed');
                this.showRegisterFailure(408);
            }
        });
    }

    async generateKeysIfNecessary() {

        if (!this.state.accountId) {
			return;
        }

        let keyStatus = this.state.keyStatus;

        console.log('LO - PGP keys generation if necessary');
        
        if ('existsOnServer' in keyStatus) {
            if (keyStatus.existsOnServer) {
                if (keyStatus.existsLocal) {
                    // key exists in both places
                    if (this.state.keys.public !== keyStatus.serverPublicKey) {
                        utils.timestampedLog('PGP keys are different');
                        this.setState({keyDifferentOnServer: true, showImportPrivateKeyModal: true});
                    }
                } else {
                    console.log('PGP key does not exist local');
					this.setState({showImportPrivateKeyModal: true});
                }
            } else {
                if (!keyStatus.existsLocal) {
                    console.log('PGP key does not exists local nor on server');
                    this.generateKeys();
                } else {
                    console.log('PGP key exists local but not on server');
                }
            }
        } else {
			console.log('PGP key not yet checked on server');
        }
    }

    setDevice(device) {
        const oldDevices = Object.assign({}, this.state.devices);

        if (device.kind === 'videoinput') {
            oldDevices['camera'] = device;
        } else if (device.kind === 'audioinput') {
            oldDevices['mic'] = device;
        }

        this.setState({devices: oldDevices});
        storage.set('devices', oldDevices);
        sylkrtc.utils.closeMediaStream(this.state.localMedia);
        this.getLocalMedia();
    }

    getLocalMedia(mediaConstraints={audio: true, video: true}, nextRoute=null) {    // eslint-disable-line space-infix-ops
        let callType = mediaConstraints.video ? 'video': 'audio';

        utils.timestampedLog('Get local media for', callType, 'call');
        const constraints = Object.assign({}, mediaConstraints);

        if (constraints.video === true) {
            if ((nextRoute === '/conference')) {
                constraints.video = {
                    'width': {
                        'ideal': 640
                    },
                    'height': {
                        'ideal': 480
                    }
                };

            // TODO: remove this, workaround so at least safari works when joining a video conference
            } else if (nextRoute === '/conference' && isSafari) {
                constraints.video = false;
            } else {
                // ask for 720p video
                constraints.video = {
                    'width': {
                        'ideal': 640
                    },
                    'height': {
                        'ideal': 480
                    }
                };
            }
        }

        logger.debug('getLocalMedia(), (modified) mediaConstraints=%o', constraints);

        navigator.mediaDevices.enumerateDevices()
        .then((devices) => {
            devices.forEach((device) => {
                //console.log(device);
                if ('video' in constraints && 'camera' in this.state.devices) {
                    if (constraints.video && constraints.video !== false && (device.deviceId === this.state.devices.camera.deviceId || device.label === this.state.devices.camera.label)) {
                        constraints.video.deviceId = {
                            exact: device.deviceId
                        };
                    }
                }
                if ('mic' in this.state.devices) {
                    if (device.deviceId === this.state.devices.mic.deviceId || device.label === this.state.devices.mic.Label) {
                        // constraints.audio = {
                        //     deviceId: {
                        //         exact: device.deviceId
                        //     }
                        // };
                    }
                }
            });
        })
        .catch((error) => {
            utils.timestampedLog('Error: device enumeration failed:', error);
        })
        .then(() => {
            return navigator.mediaDevices.getUserMedia(constraints)
        })
        .then((localStream) => {
            clearTimeout(this.loadScreenTimer);
            //utils.timestampedLog('Local media acquired');
            this.setState({localMedia: localStream});
            if (nextRoute !== null) {
                this.setState({loading: null});
                setTimeout(() => this.changeRoute(nextRoute, 'media_ready'), 0);
                if (nextRoute === '/conference') {
                    //this.playMessageSound();
                }
            }
        })
        .catch((error) => {
            utils.timestampedLog('Access to local media failed, trying audio only', error);
            navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            })
            .then((localStream) => {
                clearTimeout(this.loadScreenTimer);

                if (nextRoute !== null) {
                    this.changeRoute(nextRoute, 'local media aquired');
                }
            })
            .catch((error) => {
                utils.timestampedLog('Access to local media failed:', error);
                clearTimeout(this.loadScreenTimer);
                this._notificationCenter.postSystemNotification("Can't access camera or microphone");
                this.updateLoading(null, 'get_media');
                this.changeRoute('/ready', 'local media failure');
            });
        });
    }

    getConnection() {
        return this.state.connection ? Object.id(this.state.connection): null;
    }

    showConferenceModal() {
        Keyboard.dismiss();
        this.setState({showConferenceModal: true});
    }

    hideConferenceModal() {
        this.setState({showConferenceModal: false, remoteConferenceRoom: null, remoteConferenceDomain: null});
    }

    updateSelection(uri) {
         //console.log('updateSelection', uri);
         let selectedContacts = this.state.selectedContacts;
         //console.log('selectedContacts', selectedContacts);

         let idx = selectedContacts.indexOf(uri);

         if (idx === -1) {
             selectedContacts.push(uri);
         } else {
             selectedContacts.splice(idx, 1);
         }

         this.setState({selectedContacts: selectedContacts});
    }

    async callKeepStartConference(targetUri, options={audio: true, video: true, participants: []}, domain=null) {
        if (!targetUri) {
            return;
        }

        console.log('callKeepStartConference', options);

        this.changeRoute('/conference');

        this.backToForeground();

        this.resetGoToReadyTimer();

        let callUUID = options.callUUID || uuid.v4();

        let participants = options.participants || null;
        if (!options.skipHistory) {
            this.addHistoryEntry(targetUri, callUUID);
        }

        let participantsToInvite = [];

        if (participants) {
            participants.forEach((participant_uri) => {
                if (participant_uri === this.state.accountId) {
                    return;
                }
                participantsToInvite.push(participant_uri);
            });
        }

        this.outgoingMedia = options;

        this.setState({targetUri: targetUri,
                       outgoingCallUUID: callUUID,
                       reconnectingCall: false,
                       callContact: this.state.selectedContact,
                       participantsToInvite: participantsToInvite
                       });

        const media = options.video ? 'video' : 'audio';

        if (participantsToInvite) {
            utils.timestampedLog('Will start conference', callUUID, 'to', targetUri, 'with', participantsToInvite);
        } else {
            utils.timestampedLog('Will start conference', callUUID, 'to', targetUri);
        }

        const micAllowed = await this.requestMicPermission('callKeepStartConference');
        if (!micAllowed) {
            this._notificationCenter.postSystemNotification('Microphone permission denied');
            this.changeRoute('/ready');
            return;
        }

        if (options.video) {
            const cameraAllowed = await this.requestCameraPermission();
            if (!cameraAllowed) {
                options.video = false;
            }
        }

        //this.respawnConnection();
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, conference: true, domain: domain, callUUID: callUUID});
    }

    openAppSettings(subject) {
        Alert.alert(
         'Open Sylk App Permissions?',
         subject || '',
         [
            {text: 'Cancel', onPress: () => console.log('Cancel dialog'), style: 'cancel'},
            {text: 'OK', onPress: () =>  openSettings()},
         ],
         { cancelable: true }
         );
    }

    openDrawSettings() {
        Alert.alert(
         'Incoming calls alert panel',
         'To show the alert panel for incoming calls, Sylk must be allowed to come in front of other apps.',
         [
            {text: 'Cancel', onPress: () => console.log('Cancel dialog'), style: 'cancel'},
            {text: 'OK', onPress: () => this.askForDrawPermission ()},
         ],
         { cancelable: true }
         );
    }

    askForDrawPermission() {
           RNDrawOverlay.askForDisplayOverOtherAppsPermission()
             .then(res => {
                //utils.timestampedLog("Display over other apps was granted");
                 // res will be true if permission was granted
             })
             .catch(e => {
                //utils.timestampedLog("Display over other apps was declined");
             // permission was declined
             });
    }

    async callKeepStartCall(targetUri, options) {
        console.log('callKeepStartCall', options);


        this.resetGoToReadyTimer();
        targetUri = targetUri.trim().toLowerCase();
        let callUUID = options.callUUID || uuid.v4();

        if (targetUri.indexOf('@') === -1 && !options.conference) {
            targetUri = targetUri + '@' + this.state.defaultDomain;
        }

        this.setState({targetUri: targetUri,
                       callContact: this.state.selectedContact,
                       outgoingCallUUID: callUUID,
                       reconnectingCall: false,
                       loading: null
                       });

        if (options.conference) {
            this.changeRoute('/conference');
        } else {
            this.changeRoute('/call');
        }

        if (Platform.OS === 'android') {
            const phoneAllowed = await this.requestPhonePermission();
            if (!phoneAllowed) {
                this._notificationCenter.postSystemNotification('Phone permission denied');
                this.changeRoute('/ready', 'phone_permission_denied');

                setTimeout(() => {
                    this.openAppSettings('Phone permission must be allowed');
                }, 2000);

                return;
            }
        }

        const micAllowed = await this.requestMicPermission('callKeepStartCall');

        if (!micAllowed) {
            this._notificationCenter.postSystemNotification('Microphone permission denied');
            this.setState({loading: null});
            this.changeRoute('/ready', 'mic_permission_denied');
            setTimeout(() => {
                this.openAppSettings('Microphone permission must be allowed');
            }, 2000);
            return;
        }

        if (options.video) {
            const cameraAllowed = await this.requestCameraPermission();
            if (!cameraAllowed) {
                options.video = false;
            }
        }

        utils.timestampedLog('User will start call', callUUID, 'to', targetUri);
        this.respawnConnection();

        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, callUUID: callUUID});

        setTimeout(() => {
            if (this.state.currentCall && this.state.currentCall.id === callUUID && this.state.currentCall.state === 'progress') {
                this.hangupCall(callUUID, 'timeout');
            }
        }, 60000);
    }

    startCallWhenReady(targetUri, options) {
        //console.log('startCallWhenReady', options);
        this.resetGoToReadyTimer();
        this.backToForeground();

        if (options.conference) {
            this.startConference(targetUri, options);
        } else {
            this.startCall(targetUri, options);
        }
    }

    startCall(targetUri, options) {
		this.timeoutIncomingTimer = setTimeout(() => {
		this.audioManagerStart();
        }, 100);

        this.getLocalMedia(Object.assign({audio: true, video: options.video}, options), '/call');
    }

    startConference(targetUri, options={audio: true, video: true, participants: []}) {
        utils.timestampedLog('New outgoing conference to room', targetUri, options);
        this.backToForeground();
        this.setState({targetUri: targetUri});
		if (Platform.OS === 'ios') {
		   console.log('wake up app');
		   Linking.openURL('sylk://wakeup');
		   if (this.state.appState === 'background') {
				this.displayJoinNotification();
			}
		}

        this.getLocalMedia({audio: options.audio, video: options.video}, '/conference');
        this.getMessages(targetUri, {origin: 'startConference'});
    }

    timeoutCall(callUUID, uri) {
        utils.timestampedLog('Timeout answering call', callUUID);
        this.addHistoryEntry(uri, callUUID, direction='incoming');
        this.forceUpdate();
    }

    closeLocalMedia() {
        if (this.state.localMedia != null) {
            utils.timestampedLog('Close local media');
            sylkrtc.utils.closeMediaStream(this.state.localMedia);
            this.setState({localMedia: null});
            utils.timestampedLog('Local media closed');
        }
    }

    async callKeepAcceptCall(callUUID, options={}) {
        // called from user interaction with Old alert panel
        // options used to be media to accept audio only but native panels do not have this feature
        
        this.hideInternalAlertPanel('accept');
        
        utils.timestampedLog('Callkeep accept call', callUUID, options);
        if (this.unmounted) {
			console.log('Wait until the app mounts');
			return;        
        }
        
        if (options.event === "incoming_conference_request") {
            if (options.toUri) {
				this.setState({targetUri: options.toUri});
				const outgoingMedia = {audio: options.audio, video:  options.video}
				this.incomingConference(callUUID, options.toUri, options.fromUri, options.fromUri, outgoingMedia, 'push');
			}
			this.changeRoute('/conference', 'accept_call');
        } else {
            if (options.fromUri) {
				this.setState({targetUri: options.fromUri});
			}
			this.changeRoute('/call', 'accept_call');
        }
        
        this.backToForeground();

        if (Platform.OS === 'android') {
            const phoneAllowed = await this.requestPhonePermission();
            if (!phoneAllowed) {
                this._notificationCenter.postSystemNotification('Phone permission denied');
                this.changeRoute('/ready', 'phone_permission_denied');
                return;
            }
        }

        const micAllowed = await this.requestMicPermission('callKeepAcceptCall');
        if (!micAllowed) {
            this.setState({loading: null});
            this.changeRoute('/ready', 'mic_permission_denied');
            return;
        }

        if (options.video) {
            const cameraAllowed = await this.requestCameraPermission();
            if (!cameraAllowed) {
                options.video = false;
            }
        }

        this.callKeeper.acceptCall(callUUID, options);
        this.updateLoading(incomingCallLabel, 'incoming_call');
        this.setState({loading: null});

        if (this.timeoutIncomingTimer) {
            clearTimeout(this.timeoutIncomingTimer);
            this.timeoutIncomingTimer = null;
        }

        this.timeoutIncomingTimer = setTimeout(() => {
            this.updateLoading(null, 'incoming_call_timeout');
        }, 45000);
        // TODO this timer must be cancelled if call arrives -adi
    }

    callKeepRejectCall(callUUID) {
        // called from user interaction with Old alert panel
        utils.timestampedLog('CallKeep will reject call', callUUID);
        this.hideInternalAlertPanel('reject');
        this.callKeeper.rejectCall(callUUID);
    }

    dismissCall(callUUID) {
        // called from user interaction with Old alert panel
        this.hideInternalAlertPanel('dismiss');
    }

    acceptCall(callUUID, options={}) {
        utils.timestampedLog('User accepted call', callUUID, options);
        this.hideInternalAlertPanel('accept');
        this.backToForeground();
        this.resetGoToReadyTimer();
        this.updateLoading(null, 'accept_call');

        if (this.state.currentCall) {
            utils.timestampedLog('Will hangup current call first');
            this.hangupCall(this.state.currentCall.id, 'accept_new_call');
            // call will continue after transition to /ready
        } else {
            //utils.timestampedLog('Will get local media now');
            let hasVideo = (this.state.incomingCall && this.state.incomingCall.mediaTypes && this.state.incomingCall.mediaTypes.video) ? true : false;
            if ('video' in options) {
                hasVideo = hasVideo && options.video;
            }
            this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
        }
    }

    rejectCall(callUUID) {
        // called by Call Keep when user rejects call
        utils.timestampedLog('User rejected call', callUUID);
        this.hideInternalAlertPanel('reject');

        if (!this.state.currentCall) {
            this.changeRoute('/ready', 'rejected');
        }

        if (this.state.incomingCall && this.state.incomingCall.id === callUUID) {
            utils.timestampedLog('Sylkrtc terminate call', callUUID, 'in', this.state.incomingCall.state, 'state');
            this.state.incomingCall.terminate();
        }
    }

    hangupCall(callUUID, reason) {
        utils.timestampedLog('Call', callUUID, 'hangup with reason:', reason);
        this.setState({loading: null});
        this.disableFullScreen();

        let call = this.callKeeper._calls.get(callUUID);
        let direction = null;
        let targetUri = null;

        if (call) {
            let direction = call.direction;
            utils.timestampedLog('Sylkrtc terminate call', callUUID, 'in', call.state, 'state');
            call.terminate();
            this.vibrate();
        } else {
            //utils.timestampedLog('Sylkrtc call object is missing');
        }

        if (this.busyToneInterval) {
            clearInterval(this.busyToneInterval);
            this.busyToneInterval = null;
        }

        if (reason === 'user_cancel_call' ||
            reason === 'user_hangup_call' ||
            reason === 'answer_failed' ||
            reason === 'callkeep_hangup_call' ||
            reason === 'accept_new_call' ||
            reason === 'stop_preview' ||
            reason === 'escalate_to_conference' ||
            reason === 'user_hangup_conference_confirmed' ||
            reason === 'timeout' ||
            reason === 'local_media_timeout' ||
            reason === 'outgoing_connection_failed' ||
            reason === 'user_hangup_local_media'
            ) {
            
            this.setState({inviteContacts: false});
            this.changeRoute('/ready', reason);
            if (reason === 'user_hangup_conference_confirmed') {
                if (this.conferenceEndedTimer) {
                    console.log('Clear timer conferenceEndedTimer');
                    clearTimeout(this.conferenceEndedTimer);
                    this.conferenceEndedTimer = null;
                }
            }
            if (reason === 'local_media_timeout') {
                this._notificationCenter.postSystemNotification('Cannot get local media');
            }
            this.audioManagerStop();
        } else if (reason === 'user_hangup_conference') {
            this.audioManagerStop();
            if (!this.conferenceEndedTimer ) {
                utils.timestampedLog('Save conference maybe?');
                this.conferenceEndedTimer = setTimeout(() => {
                    this.changeRoute('/ready', 'conference_really_ended');
                }, 15000);
            }
        } else if (reason === 'user_cancelled_conference') {
            this.audioManagerStop();
            if (!this.conferenceEndedTimer ) {
                utils.timestampedLog('Save conference maybe?');
                this.conferenceEndedTimer = setTimeout(() => {
                     this.changeRoute('/ready', 'conference_really_ended');
                }, 15000);
            }
        } else if (reason === 'cancelled_call') {
            this.audioManagerStop();
            utils.timestampedLog('Will go to ready in 6 seconds (cancel)');
            this.setState({terminatedReason: 'Call cancelled'});

            setTimeout(() => {
                 this.changeRoute('/ready', reason);
            }, 6000);
        } else {
            utils.timestampedLog('Will go to ready in 6 seconds (hangup)');
            setTimeout(() => {
                 this.changeRoute('/ready', reason);
            }, 6000);
        }
    }

    callKeepSendDtmf(digits) {
        utils.timestampedLog('Send DTMF', digits);
        if (this.state.currentCall) {
            this.callKeeper.sendDTMF(this.state.currentCall.id, digits);
        }
    }

    toggleProximity() {
        storage.set('proximityEnabled', !this.state.proximityEnabled);

        if (!this.state.proximityEnabled) {
            utils.timestampedLog('Proximity sensor enabled');
        } else {
            utils.timestampedLog('Proximity sensor disabled');
        }
        this.setState({proximityEnabled: !this.state.proximityEnabled});
    }

    toggleMute(callUUID, muted) {
        if (this.state.muted != muted) {
            utils.timestampedLog('Toggle mute for call', callUUID, ':', muted);
            this.callKeeper.setMutedCall(callUUID, muted);
            this.setState({muted: muted});
        }
    }

    async hideImportPrivateKeyModal() {
        this.setState({privateKey: null,
                       privateKeyImportStatus: '',
                       privateKeyImportSuccess: false,
                       showImportPrivateKeyModal: false});

        if (!this.state.keys && this.state.allContacts.length === 0) {
            this.addTestContacts();
        }
    }

    async showImportPrivateKeyModal(force=false) {
		this.setState({showImportPrivateKeyModal: true});
    }

    async hideExportPrivateKeyModal() {
        console.log('hideExportPrivateKeyModal')
        this.setState({privateKey: null, showExportPrivateKeyModal: false});
    }

    async showExportPrivateKeyModal() {
        this.setState({showExportPrivateKeyModal: true});
    }

    async showRestoreKeyModal() {
        console.log('showRestoreKeyModal');
        this.setState({showRestoreKeyModal: true});
    }

    async hideRestoreKeyModal() {
        this.setState({showRestoreKeyModal: false});
    }

    togglePinned() {
        console.log('togglePinned', this.state.selectedContact);
        if (this.state.selectedContact) {
            //this.getMessages(this.state.selectedContact.uri, {pinned: !this.state.pinned});
            this.setState({pinned: !this.state.pinned});
        }
    }

    toggleSpeakerPhone() {
        console.log('app toggleSpeakerPhone');
    
        if (this.state.speakerPhoneEnabled) {
            this.speakerphoneOff();
        } else {
            this.speakerphoneOn();
        }
    }

    speakerphoneOn() {
        utils.timestampedLog('Speakerphone On');
        if (this.state.headsetIsPlugged) {
            utils.timestampedLog('Speakerphone disabled if headset is on');
            return;
        }

        InCallManager.chooseAudioRoute('SPEAKER_PHONE');

        this.setState({speakerPhoneEnabled: true});
        InCallManager.setForceSpeakerphoneOn(true);
        let call = this.activeCall;
        if (call) {
            if (this.useInCallManger) {
                RNCallKeep.toggleAudioRouteSpeaker(call.id, true);
            } else {
                RNCallKeep.setAudioRoute(call.id, 'Speaker');
            }
        }
    }

    speakerphoneOff() {
        utils.timestampedLog('Speakerphone Off');
        InCallManager.chooseAudioRoute('EARPIECE');

        this.setState({speakerPhoneEnabled: false});
        InCallManager.setForceSpeakerphoneOn(false);

        let call = this.activeCall;
        if (call) {
            if (this.useInCallManger) {
                RNCallKeep.toggleAudioRouteSpeaker(call.id, false);
            } else if (this.state.speakerPhoneEnabled) {
                // On Android 12+ only undo a Telecom speaker lock we explicitly set.
                // Calling this unconditionally at call start overrides BT auto-routing.
                RNCallKeep.setAudioRoute(call.id, 'Earpiece');
            }
        }
    }

    toggleCallMeMaybeModal() {
        this.setState({showCallMeMaybeModal: !this.state.showCallMeMaybeModal});
    }

    toggleQRCodeScanner() {
        utils.timestampedLog('Toggle QR code scanner');
        this.setState({showQRCodeScanner: !this.state.showQRCodeScanner});
        if (!this.state.searchContacts) {
			this.toggleSearchContacts()
		}
    }

    startGuestConference(targetUri) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: true, video: true});
    }

    outgoingCall(call) {
        // called by sylkrtc.js when an outgoing call starts
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        this.callKeeper.startOutgoingCall(call);
        this.updateLoading(null, 'outgoing_call');
		if (Platform.OS === 'android' && call.remoteIdentity.uri == this.state.accountId) {
		    console.log('save to native'); 
			SylkBridge.setActiveCall(call.remoteIdentity.uri);
		}
    }

    outgoingConference(call) {
        // called by sylrtc.js when an outgoing conference starts
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        this.callKeeper.startOutgoingCall(call);
        this.updateLoading(null, 'outgoing_call');
    }

    _onLocalNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        console.log('_onLocalNotificationReceivedBackground', notificationContent);
    }

    _onNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        console.log('_onNotificationReceivedBackground', notificationContent);

        const event = notificationContent['event'];
        const callUUID = notificationContent['session-id'];
        const to = notificationContent['to_uri'];
        const from = notificationContent['from_uri'];
        let displayName = notificationContent['from_display_name'];
        const outgoingMedia = {audio: true, video: notificationContent['media-type'] === 'video'};
        const mediaType = notificationContent['media-type'] || 'audio';
        
        const contact = this.lookupContact(from);
 
        if (contact) {
			displayName = contact.name;
        }

          /*
           * Local Notification Payload
           *
           * - `alertBody` : The message displayed in the notification alert.
           * - `alertAction` : The "action" displayed beneath an actionable notification. Defaults to "view";
           * - `soundName` : The sound played when the notification is fired (optional).
           * - `category`  : The category of this notification, required for actionable notifications (optional).
           * - `userInfo`  : An optional object containing additional notification data.
           */

        if (event === 'incoming_session') {
            utils.timestampedLog('Push notification: incoming call', callUUID);
            this.startedByPush = true;
            this.incomingCallFromPush(callUUID, from, displayName, mediaType);

        } else if (event === 'incoming_conference_request') {
            utils.timestampedLog('Push notification: incoming conference', callUUID);
            this.startedByPush = true;
            this.incomingConference(callUUID, to, from, displayName, outgoingMedia, 'push');

        } else if (event === 'cancel') {
            utils.timestampedLog('Push notification: cancel call', callUUID);
            VoipPushNotification.presentLocalNotification({alertBody:'Call cancelled'});
            this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
            this.resetStartedByPush('cancel');
        } else if (event === 'message') {
            utils.timestampedLog('Push for messages received');
            VoipPushNotification.presentLocalNotification({alertBody:'Messages received'});
        }

        /*
        if (notificationContent['event'] === 'incoming_session') {
            VoipPushNotification.presentLocalNotification({
                alertBody:'Incoming ' + notificationContent['media-type'] + ' call from ' + notificationContent['from_display_name']
            });
        }
        */

        if (VoipPushNotification.wakeupByPush) {
            utils.timestampedLog('We wake up by push notification');
            VoipPushNotification.wakeupByPush = false;
            VoipPushNotification.onVoipNotificationCompleted(callUUID);
        }
    }

    backToForeground() {
        console.log('backToForeground...');
        if (this.callKeeper) {
			this.callKeeper.backToForeground();
		}

        if (this.state.accountId && this.state.accountVerified) {
            this.handleRegistration(this.state.accountId, this.state.password, 'backToForeground');
        }

        PushNotification.popInitialNotification((notification) => {
            if (notification) {
                console.log('Initial push notification', notification);
            }
        });
    }

    incomingConference(callUUID, to, from, displayName, outgoingMedia={audio: true, video: true}, origin) {
        if (this.unmounted) {
            return;
        }

        utils.timestampedLog('Incoming conference invite to room', to);

        if (this.state.account && from === this.state.account.id) {
            utils.timestampedLog('Reject conference call from myself', callUUID);
            this.callKeeper.rejectCall(callUUID);
            return;
        }

        if (this.autoRejectIncomingCall(callUUID, from, to)) {
            console.log('autoRejectIncomingCall');
            return;
        }

        let incomingContact = this.newContact(from, displayName);

        //this.setState({incomingCallUUID: callUUID, incomingContact: incomingContact});
        this.callKeeper.handleConference(callUUID, to, from, displayName, outgoingMedia, origin);
    }

    escalateToConference(participants) {
        let outgoingMedia = {audio: true, video: true};
        let mediaType = 'video';
        let call;
        this.setState({selectedContacts: []});

        if (this.state.currentCall) {
            call = this.state.currentCall;
        } else if (this.state.incomingCall) {
            call = this.state.currentCall;
        } else {
            console.log('No call to escalate');
            return
        }

        const localStreams = call.getLocalStreams();
        if (localStreams.length > 0) {
            const localStream = call.getLocalStreams()[0];
            if (localStream.getVideoTracks().length == 0) {
                outgoingMedia.video = false;
                mediaType = 'audio';
            }
        }

        this.outgoingMedia = outgoingMedia;
        this.participantsToInvite = participants;

        console.log('Escalate', mediaType, 'call', call.id, 'to conference with', participants.toString());
        this.hangupCall(call.id, 'escalate_to_conference');
    }

    conferenceInviteFromWebSocket(data) {
        // comes from web socket
        utils.timestampedLog('Conference invite from websocket', data.id, 'from', data.originator, 'for room', data.room);
        if (this.isConference()) {
            return;
        }            
        const media = {audio: true, video: true}
		this.incomingConference(data.id, data.room, data.originator.uri, data.originator.displayName, media, 'websocket');
    }

    updateLinkingURL = (event) => {
        // this handles the use case where the app is running in the background and is activated by the listener...
        //console.log('Updated Linking url', event.url);
        this.eventFromUrl(event.url);
        DeepLinking.evaluateUrl(event.url);
    }

    eventFromUrl(url) {
        console.log('Event from url', url);
        url = decodeURI(url);

        try {
            let direction;
            let event;
            let callUUID;
            let from;
            let to;
            let displayName;
            let mediaType = 'audio';
            let remoteSylkDomain = null;

            var url_parts = url.split("/");
            let scheme = url_parts[0];
            //console.log(url_parts);

            if (scheme === 'com.agprojects.sylk:') {
                event = 'shared_content';

            } else if (scheme === 'sylk:') {
                //sylk://conference/incoming/callUUID/from/to/media - when Android is asleep
                //sylk://call/outgoing/callUUID/to/displayName - from system dialer/history
                //sylk://call/incoming/callUUID/from/to/displayName/media - when Android is asleep
                //sylk://call/cancel//callUUID - when Android is asleep
                //sylk://message/incoming/from
                
                const conferenceObject = utils.parseSylkConferenceUrl(url);
                console.log('conferenceObject', conferenceObject);
                if (conferenceObject) {
                    event = 'conference';
                    to = conferenceObject.conferenceRoom;
                    remoteSylkDomain = conferenceObject.sylkDomain;
                    
                } else {
					event       = url_parts[2];
					direction   = url_parts[3];
					callUUID    = url_parts[4];
					from        = url_parts[5];
					to          = url_parts[6];
					displayName = url_parts[7];
					mediaType   = url_parts[8] || 'audio';
	
					if (event !== 'cancel' && from && from.search('@videoconference.') > -1) {
						event = 'conference';
						to = from;
					}
	
					this.setState({targetUri: from});
                }

            } else if (scheme === 'https:') {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link

                // This URLs are used to request SSI credentials:
                // must be updated inside:
                //  * ReadyBox as well
                //  * android/app/src/main/AndroidManifest.xml
                //  * ios/sylk/sylk.entitlements

                direction = 'outgoing';
                event = url_parts[3];

                if (!event) {
                    return;
                }

                to = url_parts[4];

                if (!to) {
                    return;
                }

                callUUID = uuid.v4();

                if (to.indexOf('@') === -1 && event === 'conference') {
                    to = url_parts[4] + '@' + this.state.defaultConferenceDomain;
                } else if (to.indexOf('@') === -1 && event === 'call') {
                    to = url_parts[4] + '@' + this.state.defaultDomain;
                }
                this.setState({targetUri: to});
            }

            if (event === 'conference') {
                utils.timestampedLog('Conference from external URL:', url);
                this.startedByPush = true;

                if (direction === 'outgoing' && to) {
                    utils.timestampedLog('Outgoing conference to', to);
                    this.backToForeground();
                    this.callKeepStartConference(to, {audio: true, video: true, callUUID: callUUID});
                } else if (direction === 'incoming' && from) {
                    utils.timestampedLog('Incoming conference from', from);
                    // allow app to wake up
                    this.backToForeground();
                    const media = {audio: true, video: mediaType === 'video'}
                    this.incomingConference(callUUID, to, from, displayName, media, 'url');
                } else {
                    // allow app to wake up
                    this.backToForeground();
                    let remoteRoom = to;
                    if (remoteSylkDomain && remoteSylkDomain != this.state.sylkDomain) {
						remoteRoom = to + "@" + remoteSylkDomain;
                    }
                    utils.timestampedLog('Outgoing conference to', remoteRoom);
					this.setState({remoteConferenceRoom: remoteRoom, remoteConferenceDomain: remoteSylkDomain});
                    this.showConferenceModal();
                }
            } else if (event === 'wakeup') {
                console.log('wakeup from Linking');
            } else if (event === 'call') {
                this.startedByPush = true;
                if (direction === 'outgoing') {
                    utils.timestampedLog('Call from external URL:', url);
                    utils.timestampedLog('Outgoing call to', from);
                    this.backToForeground();
                    this.callKeepStartCall(from, {audio: true, video: false, notification: callUUID});
                } else if (direction === 'incoming') {
                    utils.timestampedLog('Call from external URL:', url);
                    utils.timestampedLog('Incoming', mediaType, 'call from', from);
                    this.incomingCallFromPush(callUUID, from, displayName, mediaType, true);
                } else if (direction === 'cancel') {
                    this.cancelIncomingCall(callUUID);
                }
            } else if (event === 'shared_content') {
                console.log('Media Link: ', url_parts[2]);
                //this.fetchSharedItemsAndroidAtStart('Linking');
            } else if (event === 'message') {
				 from = url_parts[4];
                 this.selectChatContact(from);
            } else {
                 utils.timestampedLog('Error: Invalid external URL event', event);
            }
        } catch (err) {
            utils.timestampedLog('Error parsing URL', url, ":", err);
        }
    }

    autoRejectIncomingCall(callUUID, from, to) {
        //utils.timestampedLog('Check auto reject call from', from);
        if (this.state.blockedUris) {
            //console.log('blockedUris', this.state.blockedUris);
            if (this.state.blockedUris.indexOf(from) > -1) { 
                utils.timestampedLog('Reject call', callUUID, 'from blocked URI', from);
                this.callKeeper.rejectCall(callUUID);
                this._notificationCenter.postSystemNotification('Call rejected', {body: `from ${from}`});
                return true;
            }

			const fromDomain = '@' + from.split('@')[1]
			if (this.state.blockedUris && this.state.blockedUris.indexOf(fromDomain) > -1) {
				utils.timestampedLog('Reject call', callUUID, 'from blocked domain', fromDomain);
				this.callKeeper.rejectCall(callUUID);
				this._notificationCenter.postSystemNotification('Call rejected', {body: `from domain ${fromDomain}`});
				return true;
			}
        }
        
        if (this.state.rejectNonContacts) {
            const contact = this.lookupContact(from);
            if (!contact) {
				utils.timestampedLog('Reject call', callUUID, 'from caller not in contacts list');
				this.callKeeper.rejectCall(callUUID);
 				return true;
           }
        }

        if (this.state.rejectAnonymous) {
			if (from.indexOf('@guest') > -1) {
				utils.timestampedLog('Reject call', callUUID, 'from anonymous caller');
				this.callKeeper.rejectCall(callUUID);
				return true;
			}
	
			if (from.indexOf('anonymous') > -1) {
				utils.timestampedLog('Reject call', callUUID, 'from anonymous caller');
				this.callKeeper.rejectCall(callUUID);
				return true;
			}
        }
        
        if (this.state.currentCall && this.state.incomingCall && this.state.currentCall === this.state.incomingCall && this.state.incomingCall.id !== callUUID) {
            utils.timestampedLog('Reject second incoming call');
            this.callKeeper.rejectCall(callUUID);
        }

        if (this.state.account && from === this.state.account.id && this.state.currentCall && this.state.currentCall.remoteIdentity.uri === from) {
            utils.timestampedLog('Reject call to myself', callUUID);
            this.callKeeper.rejectCall(callUUID);
            return true;
        }

        if (this._terminatedCalls.has(callUUID)) {
            utils.timestampedLog('Reject call already terminated', callUUID);
            this.cancelIncomingCall(callUUID);
            return true;
        }

        if (this.isConference()) {
            utils.timestampedLog('Reject call while in a conference', callUUID);
            if (to !== this.state.targetUri) {
                this._notificationCenter.postSystemNotification('Missed call from', {body: from});
            }
            this.callKeeper.rejectCall(callUUID);
            return true;
        }

        if (this.state.currentCall && this.state.currentCall.state === 'progress' && this.state.currentCall.remoteIdentity.uri !== from) {
            utils.timestampedLog('Reject call while outgoing in progress', callUUID);
            this.callKeeper.rejectCall(callUUID);
            this._notificationCenter.postSystemNotification('Missed call from', {body: from});
            return true;
        }

        return false;
    }

	async checkPendingActions() {
	  //console.log('Check pending actions in AsyncStorage');

	  const keys = await AsyncStorage.getAllKeys();
	
	  for (const key of keys) {
	    //console.log('FCM key', key);

		if (key.startsWith('incomingMessage')) {
			const pendingJson = await AsyncStorage.getItem(key);
			if (!pendingJson) {
			    console.log('No pending json');
				continue;
			}

			const payload = JSON.parse(pendingJson);
			this.incomingMessageFromPush(payload.message_id, payload.from_uri, payload.content, payload.content_type);			
			await AsyncStorage.removeItem(key);          
 		}
 
		if (key.startsWith('incomingCall:')) {
		  try {
			const pendingJson = await AsyncStorage.getItem(key);
			if (!pendingJson) continue;
	
			const payload = JSON.parse(pendingJson);
			console.log('--- Pending incoming call:', payload);
	
			const callUUID = key.replace('incomingCall:', '');
	
			if (payload.data.event === "incoming_conference_request") {
			  const media = {
				audio: true,
				video: payload.data["media-type"] === 'video'
			  };

			  this.incomingConference(
				callUUID,
				payload.data.to_uri,
				payload.data.from_uri,
				payload.data.from_display_name, // fixed small typo here too
				media,
				'push'
			  );
			}
	
			await AsyncStorage.removeItem(key);
		  } catch (e) {
			console.error(`Error processing ${key}`, e);
		  }
		}
	  }
	}
	
	async incomingMessageFromPush(id, from, content, contentType) {
		if (id === this.deviceId) {
			return;
		}

		if (this.uploadedFiles.has(id)) {
			return;
		}

		console.log('-- Incoming message from push', id, 'from', from, contentType);
		
		const is_encrypted = content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') > -1;

		const messages = this.state.messages;
        if (from in this.state.messages) {
			const exists = messages[from].some(m => m._id === id);
			if (exists) {
			    //console.log('Message is already loaded', id);
				return;
			}
        } else {
			await this.waitForContactsLoaded();
			const contact = this.lookupContact(from);
			if (contact) {
				if (contact.unread.indexOf(id) > -1) {
					//console.log('Message is already loaded in unread', id);
					return;
				}
			}
        }

		const decryptedContent = is_encrypted
			? await OpenPGP.decrypt(content, this.state.keys.private)
			: content;
			
		if (!this.isMessageAllowed(contentType, msg.decryptedContent)) {
			return;
		}

		const sylkMsg = {
			id: id,
			sender: {uri: from, 
			         displayName: from},
			receiver: this.state.accountId,
			contentType: contentType,
			content: decryptedContent,
			timestamp: new Date()
		};
		
		//console.log('sylkMsg', sylkMsg);
	    const msg = utils.sylk2GiftedChat(sylkMsg);
		console.log('Added push message:', id, from);
		
		this.setState((prevState) => ({
			incomingMessage: {
				...prevState.incomingMessage,
				[from]: msg
			}
		}));

        // TODO this can steal the focus, it should happen only if the app was started by push interaction
        if (id !== this.deviceId) {
			//this.selectChatContact(from);
		}

		if (msg.metadata && msg.metadata.filename) {
			setTimeout(() => {
				this.autoDownloadFile(msg.metadata);
			}, 10);
		}
	}

    autoAcceptIncomingCall(callUUID, from) {
        // TODO: handle ping pong where we call each other back
        if (this.state.currentCall &&
            this.state.currentCall.direction === 'outgoing' &&
            this.state.currentCall.remoteIdentity.uri === from) {

                this.hangupCall(this.state.currentCall.id, 'accept_new_call');
                this.setState({currentCall: null});

                console.log('Auto accept incoming call from same address I am calling', callUUID);
                return true;
        }
        return false;
    }

    async incomingCallFromPush(callUUID, from, displayName, mediaType, force) {
        utils.timestampedLog('Handle incoming PUSH call', callUUID, 'from', from, '(', displayName, ')');

        if (this.unmounted) {
            return;
        }

        if (this.autoRejectIncomingCall(callUUID, from)) {
            return;
        }

        if (this.autoAcceptIncomingCall(callUUID, from)) {
            return;
        }

        if (this.state.dnd && this.state.favoriteUris.indexOf(from) === -1) {
            console.log('Do not disturb is enabled');
			if (Platform.OS === 'android') {
				this.postAndroidMessageNotification(from, 'missed call');
			}
            return;
        }

        if (Platform.OS === 'android') {
			const phoneAllowed = await this.requestPhonePermission();
			if (!phoneAllowed) {
				console.log('PhonePermission not allowed');
				return;
			}
        }

        //this.backToForeground();

        this.goToReadyNowAndCancelTimer();

        this.setState({targetUri: from});

        // we use native alert panel starting with 2025-10-21
        let skipNativePanel = true;

        /*
        if (!this.callKeeper._calls.get(callUUID) || (this.state.currentCall && this.state.currentCall.direction === 'outgoing')) {
            //this._notificationCenter.postSystemNotification('Incoming call', {body: `from ${from}`});
            if (Platform.OS === 'android' && this.state.appState === 'foreground') {
                skipNativePanel = true;
            }
        }
        */

        this.callKeeper.incomingCallFromPush(callUUID, from, displayName, mediaType, force, skipNativePanel);
    }

    async incomingCallFromWebSocket(call, mediaTypes) {
        if (this.unmounted) {
            return;
        }

        if (this.timeoutIncomingTimer) {
            //console.log('Clear incoming timer');
            clearTimeout(this.timeoutIncomingTimer);
            this.timeoutIncomingTimer = null;
        }

        if (Platform.OS === 'android') {
            const phoneAllowed = await this.requestPhonePermission();
            if (!phoneAllowed) {
                this._notificationCenter.postSystemNotification('Phone permission denied');
                this.changeRoute('/ready', 'phone_permission_denied');
                return;
            }
        }

		//this._notificationCenter.postSystemNotification("Incoming call...");

        this.callKeeper.addWebsocketCall(call);
        const callUUID = call.id;
        const from = call.remoteIdentity.uri;
        
		//this._notificationCenter.postSystemNotification("Incoming call from "+ from);

        //this.playIncomingRingtone(callUUID);

        utils.timestampedLog('Handle incoming web socket call', callUUID, 'from', from, 'on connection', Object.id(this.state.connection));

        // because of limitation in Sofia stack, we cannot have more then two calls at a time
        // we can have one outgoing call and one incoming call but not two incoming calls
        // we cannot have two incoming calls, second one is automatically rejected by sylkrtc.js

        if (this.autoRejectIncomingCall(callUUID, from)) {
            console.log('autoRejectIncomingCall')
            return;
        }

        if (this.state.dnd && this.state.favoriteUris.indexOf(from) === -1) {
            console.log('Do not disturb')
            return;
        }

        let autoAccept = this.autoAcceptIncomingCall(callUUID, from);
		const pendingJson = await AsyncStorage.getItem(`pendingAction:${callUUID}`);
		if (pendingJson) {
		    const { payload, choice } = JSON.parse(pendingJson);
		    console.log('choice', choice);
		    if (choice === 'accept_audio') {
				if ('video' in mediaTypes) {
				  delete mediaTypes.video;
				}
			    console.log('We must accept audio call', callUUID);
			    autoAccept = true;
		    } else if (choice === 'accept_video') {
			    console.log('We must accept video call', callUUID);
			    autoAccept = true;
		    }
		}

	    await AsyncStorage.removeItem(`pendingAction:${callUUID}`);
		await AsyncStorage.removeItem(`incomingCall:${callUUID}`);

        this.goToReadyNowAndCancelTimer();

        call.mediaTypes = mediaTypes;

        call.on('stateChanged', this.callStateChanged);

        this.setState({incomingCall: call});

        let skipNativePanel = false;

        if (autoAccept) {
			this.changeRoute('/call', 'accept_call');
		} else {
			if (Platform.OS === 'android' && this.callKeeper.selfManaged) {
				this.showAlertPanel(call, 'websocket_call');
				skipNativePanel = true;
			}
		}
        this.callKeeper.incomingCallFromWebSocket(call, autoAccept, skipNativePanel);
    }

    missedCall(data) {
        utils.timestampedLog('Missed call from ' + data.originator.uri, '(', data.originator.displayName, ')');

        /*
        let msg;
        let current_datetime = new Date();
        let formatted_date = utils.appendLeadingZeroes(current_datetime.getHours()) + ":" + utils.appendLeadingZeroes(current_datetime.getMinutes()) + ":" + utils.appendLeadingZeroes(current_datetime.getSeconds());
        msg = formatted_date + " - missed call";
        this.saveSystemMessage(data.originator.uri.toLowerCase(), msg, 'incoming', true);
        */

        if (!this.state.currentCall) {
            let from = data.originator.displayName ||  data.originator.uri;
            this._notificationCenter.postSystemNotification('Missed call', {body: `from ${from}`});
            if (Platform.OS === 'ios') {
                VoipPushNotification.presentLocalNotification({alertBody:'Missed call from ' + from});
            }
        }

        this.updateServerHistory('missedCall')
    }

    updateServerHistory(from) {
        //console.log('updateServerHistory by', from);
        //this.contactsCount();

        if (this.state.serverHistoryUpdatedBy === 'registered' && from === 'syncConversations') {
            // Avoid double query at start
            return;
        }

        if (this.state.serverHistoryUpdatedBy === 'syncConversations' && from === 'registered') {
            // Avoid double query at start
            return;
        }

        this.setState({serverHistoryUpdatedBy: from})

        if (!this.state.contactsLoaded) {
            return;
        }

        if (this.currentRoute === '/ready') {
            this.setState({refreshHistory: !this.state.refreshHistory});
        }
    }

    startPreview() {
        this.getLocalMedia({audio: true, video: true}, '/preview');
    }

    sendPublicKey(puri, force=false) {
        let random_uri = uuid.v4() + '@' + this.state.defaultDomain;
        let uri =  puri || random_uri;
		console.log('[pubkey-send] sendPublicKey called for', uri, 'force=', force);

        this.mustSendPublicKey = false;

        if (this.state.keyDifferentOnServer && !force) {
 			console.log('[pubkey-send] skipped: keyDifferentOnServer && !force, uri=', uri);
            return;
        }

        this._dispatchPublicKeySend(uri, 'sendPublicKey');
    }

    sendPublicKeyToUri(uri) {
        console.log('[pubkey-send] sendPublicKeyToUri called for', uri);
        this._dispatchPublicKeySend(uri, 'sendPublicKeyToUri');
    }

    // Shared send path for both sendPublicKey and sendPublicKeyToUri so
    // we get identical instrumentation on every outbound public-key
    // message. Logs precondition failures (no account / no key / not
    // ready), the size of the key being sent, the SDK message id (or
    // lack thereof), and final delivery state via the sendMessage error
    // callback and the returned message's stateChanged events. This is
    // what makes "the log says we sent it but it never arrived"
    // debuggable — without it we can't tell ready-state drops from
    // server rejects from silent SDK failures.
    _dispatchPublicKeySend(uri, origin) {
        if (!this.state.account) {
            console.log('[pubkey-send]', origin, 'aborted for', uri, '- no account');
            return;
        }
        if (!this.state.keys || !this.state.keys.public) {
            console.log('[pubkey-send]', origin, 'aborted for', uri, '- no local public key');
            return;
        }
        if (!this.canSend()) {
            console.log('[pubkey-send]', origin, 'aborted for', uri,
                '- canSend()=false, connection.state=',
                this.state.connection ? this.state.connection.state : 'no-connection');
            return;
        }

        const keyLen = this.state.keys.public.length;
        const startsOk = this.state.keys.public.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----');
        const endsOk   = this.state.keys.public.trim().endsWith('-----END PGP PUBLIC KEY BLOCK-----');
        console.log('[pubkey-send]', origin, '-> dispatch to', uri,
            'keyLen=', keyLen, 'startsOk=', startsOk, 'endsOk=', endsOk);

        let message;
        try {
            message = this.state.account.sendMessage(
                uri,
                this.state.keys.public,
                'text/pgp-public-key',
                undefined,
                (error) => {
                    if (error) {
                        console.log('[pubkey-send]', origin, 'FAILED to', uri,
                            '- error:', error.toString());
                    } else {
                        console.log('[pubkey-send]', origin, 'ACK from server for', uri);
                    }
                }
            );
        } catch (e) {
            console.log('[pubkey-send]', origin, 'THREW for', uri, '- exception:', e && e.toString());
            return;
        }

        if (!message) {
            console.log('[pubkey-send]', origin, 'sendMessage returned no message object for', uri);
            return;
        }

        console.log('[pubkey-send]', origin, 'queued msgId=', message.id, 'state=', message.state, 'to', uri);

        if (typeof message.on === 'function') {
            message.on('stateChanged', (oldState, newState) => {
                console.log('[pubkey-send]', origin, 'msgId=', message.id,
                    'state', oldState, '->', newState, 'to', uri);
            });
        }
    }

    async saveOutgoingRawMessage(id, from_uri, to_uri, content, contentType) {
        let timestamp = new Date();
        let params;
        let unix_timestamp = Math.floor(timestamp / 1000);
        params = [this.state.accountId, id, JSON.stringify(timestamp), unix_timestamp, content, contentType, from_uri, to_uri, "outgoing", "1"];
        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            //console.log('SQL insert message OK');
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL saveOutgoingRawMessage error:', error);
            }
        });
    }

    showCallMeModal() {
        this.setState({showCallMeMaybeModal: true});
        setTimeout(() => {
            this.hideCallMeModal();
        }, 20000);
    }

    hideCallMeModal() {
        this.setState({showCallMeMaybeModal: false});
    }

	waitForContactsLoaded() {
		if (this.state.contactsLoaded) {
			return Promise.resolve();
		}
	
		return new Promise(resolve => {
			const check = () => {
				//console.log('Waiting for contactsLoaded...');

				if (this.state.contactsLoaded) {
					resolve();
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}

    async saveSylkContact(uri, contact, origin=null) {
        await this.waitForContactsLoaded();
    
        console.log('saveSylkContact', contact?.id, uri, contact?.timestamp, 'by', origin);

        if (!uri) {
            console.error('No uri given');
            return;
        }

        if (!contact) {
            contact = this.newContact(uri);
        } else {
            contact = this.sanitizeContact(uri, contact);
        }

        if (!contact) {
            console.error('No contact was be created');
            return;
        }

        // ---------------------------------------------------------------
        // Public key safeguard + change logging.
        //
        // A public key should NEVER be silently cleared. It should only
        // be nullable via the explicit, user-confirmed deletePublicKey
        // flow (triggered from EditContactModal). Every other save path
        // (editContact, replicate, import-from-address-book, chat, merge,
        // lookup) may carry a contact object whose publicKey field was
        // dropped by accident — in that case preserve the existing key
        // we already have in memory.
        //
        // We also log whenever the key actually changes, so that any
        // future "key disappeared" report has a clear audit trail.
        try {
            const normalize = (k) => (k ? k.replace(/\r/g, '').trim() : '');
            const incomingKey = normalize(contact.publicKey);
            const existing = this.contactIndex ? this.contactIndex[uri] : null;
            const existingKey = normalize(existing && existing.publicKey);

            if (!incomingKey && existingKey && origin !== 'deletePublicKey') {
                console.warn('[SYLK] saveSylkContact: preserving existing public key for',
                    uri, '(origin=', origin, ') — incoming contact had no key');
                contact.publicKey = existing.publicKey;
            } else if (incomingKey && existingKey && incomingKey !== existingKey) {
                console.log('[SYLK] saveSylkContact: public key CHANGED for',
                    uri, '(origin=', origin, ')');
            } else if (incomingKey && !existingKey) {
                console.log('[SYLK] saveSylkContact: public key SET for',
                    uri, '(origin=', origin, ')');
            } else if (!incomingKey && existingKey && origin === 'deletePublicKey') {
                console.log('[SYLK] saveSylkContact: public key CLEARED for',
                    uri, '(origin=deletePublicKey)');
            }
        } catch (e) {
            console.warn('[SYLK] saveSylkContact: public-key safeguard failed', e && e.message);
        }

		let tags = [...new Set(contact.tags.map(t => t.trim().toLowerCase()))];
		
		if (tags.includes('history')) {
			tags = tags.filter(t => t !== 'history');
			if (!tags.includes('calls')) {
				tags.push('calls');
			}
		}
	
		if (tags.includes('blocked')) {
			const remove = ['favorite', 'bypassdnd', 'muted'];
			tags = tags.filter(t => !remove.includes(t));
		}
		
		contact.tags = tags;
		
	    let selectedContact = this.state.selectedContact;

        if (selectedContact && selectedContact.id === contact.id) {
			this.setState({selectedContact: contact});
        }

		let unreadCount = contact?.unread?.length;

		if (typeof unreadCount !== "number" || isNaN(unreadCount)) {
		    unreadCount = 0;
		}

        let unread_messages = '';

		if (unreadCount > 0) {
			unread_messages = contact.unread.toString();
		}

		if (Platform.OS === 'android') {
			// When the app is not in the foreground the native FCM service is
			// the source of truth for the unread counter. Writing from JS here
			// would overwrite increments performed by FCM (the app would show
			// 0 after FCM had just set it to N).
			if (this.state.appState === 'active') {
				const activeUri = this.state.selectedContact ? this.state.selectedContact.uri : null;
				console.log('[SYLK] saveSylkContact -> setUnreadForContact', uri, unreadCount,
					'selectedContact =', activeUri);
				UnreadModule.setUnreadForContact(uri, unreadCount);
			} else {
				console.log('[SYLK] saveSylkContact: skipping setUnreadForContact (appState =',
					this.state.appState, ') FCM owns the counter');
			}
		}

        let conference = contact.conference ? 1: 0;
        let media = contact.lastCallMedia.toString();
        let participants = contact.participants.toString();
        let uris = contact.uris? contact.uris.toString() : '';
        let unixTime = Math.floor(contact.timestamp / 1000);
        let photo = contact?.photo || '';
        let properties = contact.properties ? JSON.stringify(contact.properties) : '';
        let localProperties = contact.localProperties ? JSON.stringify(contact.localProperties) : '';

        let params = [
			  contact.id,
			  contact.remote_id || '',
			  this.state.accountId,
			  uri,
			  uris,
			  contact.email || '',
			  contact.photo || '',
			  unixTime,
			  contact.name || '',
			  contact.organization || '',
		      unread_messages,
			  contact.tags.toString(),
			  participants,
			  contact.publicKey || '',
			  contact.direction || '',
			  media || '',
			  conference || 0,
			  contact.lastCallId || '',
			  contact.lastCallDuration || 0,
			  properties,
			  localProperties
			];

        await this.ExecuteQuery("INSERT INTO contacts (contact_id, remote_id, account, uri, uris, email, photo, timestamp, name, organization, unread_messages, tags, participants, public_key, direction, last_call_media, conference, last_call_id, last_call_duration, properties, local_properties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            if (result.rowsAffected === 1) {
                console.log('SQL inserted contact', contact.id, uri, 'by', origin);

				if (origin == 'editContact') {
					this.replicateContact(contact);
				}

				if (origin == 'chat') {
					this.replicateContact(contact);
				}
            } else {
                console.error('Contact was not inserted', contact);
            }

			this.setState(prevState => ({
			  allContacts: [...prevState.allContacts, contact]
			}));

            if (uri === this.state.accountId) {
                this.setState({email: contact.email, displayName: contact.name})
            }

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') > -1) {
                //console.log('SQL insert contact failed, try update', uri, contact.timestamp);
                this.updateSylkContact(contact, origin);
            } else {
                console.error('SQL insert contact', uri, 'error:', error);
            }
        });
    }

    async updateSylkContact(contact, origin=null) {
		const uri = contact.uri;
    
        //console.log('updateSylkContact', contact?.timestamp, contact.id, 'origin', origin);

        let unixTime = Math.floor(contact.timestamp / 1000);
        let unread_messages = contact.unread.toString();
        let media = contact.lastCallMedia.toString();
        
        let tags = Array.isArray(contact.tags)
		  ? [...contact.tags]                     // copy array
		  : contact.tags.split(',').map(t => t.trim().toLowerCase()); // handle string case
		
		if (tags.includes('blocked')) {
		  tags = tags.filter(t => t !== 'bypassdnd');
		  tags = tags.filter(t => t !== 'muted');
		  tags = tags.filter(t => t !== 'favorite');
		}
		
		tags = tags.join(', ');
        let conference = contact.conference ? 1: 0;
        let participants = contact.participants.toString();
        let uris = contact.uris ? contact.uris.toString() : '';
        let properties = contact.properties ? JSON.stringify(contact.properties) : {};
        let localProperties = contact.localProperties ? JSON.stringify(contact.localProperties) : {};

        let params = [contact.uri, uris, contact.photo, contact.email, contact.lastMessage, contact.lastMessageId, unixTime, contact.name || '', contact.organization || '', unread_messages || '', contact.publicKey || '', tags, participants, contact.direction, media, conference, contact.lastCallId, contact.lastCallDuration, properties, localProperties, contact.id, this.state.accountId];

        await this.ExecuteQuery("UPDATE contacts set uri = ?, uris = ?, photo = ?, email = ?, last_message = ?, last_message_id = ?, timestamp = ?, name = ?, organization = ?, unread_messages = ?, public_key = ?, tags = ?, participants = ?, direction = ?, last_call_media = ?, conference = ?, last_call_id = ?, last_call_duration = ?, properties = ?, local_properties = ? where contact_id = ? and account = ?", params).then((result) => {
            if (result.rowsAffected === 1) {
				console.log('SQL updated contact', contact.id, uri, 'by', origin);

				this.setState(prevState => {
					const updatedContacts = prevState.allContacts.map(c =>
						c.id === contact.id ? { ...c, ...contact } : c
					);
					return { allContacts: updatedContacts };
				});
    
                if (origin == 'editContact') {
					this.replicateContact(contact);
                }

				if (uri !== this.state.accountId) {
					let favorite = contact.tags.indexOf('favorite') > -1 ? true: false;
					let blocked = contact.tags.indexOf('blocked') > -1 ? true: false;
	
					this.updateFavorite(uri, favorite);
					this.updateBlocked(uri, blocked);
	
				} else {
					this.setState({email: contact.email, displayName: contact.name})
				}
            }

        }).catch((error) => {
            console.log('SQL update contact error:', error);
        });
    }

    deleteDuplicateContacts(ids) {
       for (const id of ids) {
		   this.ExecuteQuery("DELETE from contacts where contact_id = ? and account = ?", [id, this.state.accountId]).then((result) => {
				if (result.rowsAffected > 0) {
					console.log('SQL deleted contact', id);
				}
	
			}).catch((error) => {
				console.log('Delete contact SQL error:', error);
			});
		}
    }

    async deleteSylkContact(contact) {
		await this.ExecuteQuery('delete from contacts where account = ? and contact_id = ?', [this.state.accountId, contact.id]).then((result) => {
			if (result.rowsAffected > 0) {
				console.log(result.rowsAffected, 'contacts deleted');
				this.removeContactInState(contact);
				if (this.state.selectedContact?.id == contact.id) {
				   this.setState({selectedContact: null});
				}

			}
		}).catch((error) => {
			console.log('SQL deleteSylkContact error:', error);
		});
    }

    async exportPrivateKey(password, email) {
        if (!this.state.account) {
            console.log('No account');
            return;
        }

        if (!this.state.keys || !this.state.keys.private) {
            return;
        }

        if (email) {
			const public_key = this.state.keys.public.replace(/\r/g, '').trim();
			const private_key = this.state.keys.private.replace(/\r/g, '').trim();
			const keyPair = public_key + '\n' + private_key;
			await OpenPGP.encryptSymmetric(keyPair, password, KeyOptions).then((encryptedBuffer) => {
				utils.timestampedLog('Sending encrypted private key');
				encryptedBuffer = encryptedBuffer;
				const body = btoa(encryptedBuffer);
				const s = 'Sylk Private Key for ' + this.state.accountId;
                const subject = encodeURIComponent(s);
   			    const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

				this.setState({showExportPrivateKeyModal: false});

				Linking.openURL(mailtoUrl).catch((err) => {
				  console.error('Error opening mail app', err);
				});


			}).catch((error) => {
				console.log('Error encrypting private key:', error);
			});
				
			return;
		}

        this.sendPublicKey();

        password = password.trim();
        const public_key = this.state.keys.public.replace(/\r/g, '').trim();
        await OpenPGP.encryptSymmetric(this.state.keys.private, password, KeyOptions).then((encryptedBuffer) => {
            utils.timestampedLog('Sending encrypted private key');
            encryptedBuffer = public_key + "\n" + encryptedBuffer;
            this.state.account.sendMessage(this.state.account.id, encryptedBuffer, 'text/pgp-private-key');
        }).catch((error) => {
            console.log('Error encrypting private key:', error);
        });
    }

    handleRemotePrivateKey(keyPair) {
        let regexp;
        let match;
        let public_key;

        regexp = /(-----BEGIN PGP PUBLIC KEY BLOCK-----[^]*-----END PGP PUBLIC KEY BLOCK-----)/ig;
        match = keyPair.match(regexp);

        if (match && match.length === 1) {
            public_key = match[0];
        }

        //console.log('Remote public_key', public_key);
        //console.log('Local public_key', this.state.keys.public);

        if (public_key && this.state.keys && this.state.keys.public === public_key) {
            console.log('Private key is the same as on server');
            this.setState({showImportPrivateKeyModal: false});
            this._notificationCenter.postSystemNotification('Private key is the same');
            this.sendPublicKey(null, true);
            return;
        }

        utils.timestampedLog('showImportPrivateKeyModal 5');
        this.setState({showImportPrivateKeyModal: true,
                       privateKey: keyPair});
    }

    async restorePrivateKey(keyPair) {
        utils.timestampedLog('Save encrypted private key');
        this.processPrivateKey(keyPair);
    }

    async decryptPrivateKey(password) {
        utils.timestampedLog('Save encrypted private key');
        password = password.trim();

        let regexp;
        let match;
        let keyPair;

        let public_key;
        let encrypted_key;

        regexp = /(-----BEGIN PGP PUBLIC KEY BLOCK-----[^]*-----END PGP PUBLIC KEY BLOCK-----)/ig;
        match = this.state.privateKey.match(regexp);
        if (match && match.length === 1) {
            public_key = match[0];
        }

        if (public_key) {
            if (this.state.keys && this.state.keys.public === public_key) {
                this.setState({privateKeyImportStatus: 'Private key is the same',
                               privateKeyImportSuccess: true,
                               keyDifferentOnServer: false});
                return;
            }

            regexp = /(-----BEGIN PGP MESSAGE-----[^]*-----END PGP MESSAGE-----)/ig;
            match = this.state.privateKey.match(regexp);
            if (match && match.length === 1) {
                encrypted_key = match[0];
            }

            if (encrypted_key) {
                await OpenPGP.decryptSymmetric(encrypted_key, password).then((privateKey) => {
                    utils.timestampedLog('Decrypted PGP private pair');
                    this.setState({keyDifferentOnServer: false})
                    keyPair = public_key + "\n" + privateKey;
                    this.processPrivateKey(keyPair);
                }).catch((error) => {
                    this.setState({privateKeyImportStatus: 'No key received'});
                    console.log('Error decrypting PGP private key:', error);
                    return
                });
            } else {
                this.setState({privateKeyImportStatus: 'No encrypted key found'});
                console.log('Error parsing PGP private key:', error);
                return
            }
        } else {
            await OpenPGP.decryptSymmetric(this.state.privateKey, password).then((keyPair) => {
                utils.timestampedLog('Decrypted PGP private pair');
                this.setState({keyDifferentOnServer: false})
                this.processPrivateKey(keyPair);
            }).catch((error) => {
                this.setState({privateKeyImportStatus: 'No key received'});
                console.log('Error decrypting PGP private key:', error);
                return
            });
        }
    }

    async processPrivateKey(keyPair) {
        utils.timestampedLog('Process key');
        keyPair = keyPair.replace(/\r/g, '').trim();

        let public_key;
        let private_key;
        let status;
        let keys = this.state.keys || {};

        let regexp;
        let match;

        regexp = /(-----BEGIN PGP PUBLIC KEY BLOCK-----[^]*-----END PGP PUBLIC KEY BLOCK-----)/ig;
        match = keyPair.match(regexp);
        if (match && match.length === 1) {
            public_key = match[0];
        }

        regexp = /(-----BEGIN PGP PRIVATE KEY BLOCK-----[^]*-----END PGP PRIVATE KEY BLOCK-----)/ig;
        match = keyPair.match(regexp);
        if (match && match.length === 1) {
            private_key = match[0];
        }

        if (public_key && private_key) {
            let new_keys = {private: private_key, public: public_key}
            this.savePrivateKey(new_keys);
            status = 'Private key copied successfully';

            if (this.state.account) {
                this.state.account.sendMessage(this.state.accountId, 'Private key imported on another device', 'text/pgp-public-key-imported');
            }

            this.setState({privateKeyImportStatus: status,
                           privateKeyImportSuccess: true});


        } else {
            this.setState({privateKeyImportStatus: 'Incorrect password!',
                           privateKeyImportSuccess: false});
        }
    }

    resetStartedByPush(from) {
        this.startedByPush = false;
    }

    async savePublicKey(uri, key) {
        console.log('[pubkey-recv] savePublicKey enter uri=', uri,
            'keyLen=', key ? key.length : 0,
            'rejectNonContacts=', !!this.state.rejectNonContacts);
        if (uri === this.state.accountId) {
            console.log('[pubkey-recv] savePublicKey skip: uri matches own accountId', uri);
            return;
        }

        if (this.state.rejectNonContacts) {
            const contact = this.lookupContact(uri);
            if (!contact) {
				console.log('[pubkey-recv] savePublicKey skip: rejectNonContacts and no local contact for', uri);
				return;
			}
        }

        if (!key) {
            console.log('[pubkey-recv] savePublicKey skip: missing key for', uri);
            return;
        }

        key = key.replace(/\r/g, '').trim();

        if (!key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
            console.log('[pubkey-recv] savePublicKey skip: bad PGP header for', uri);
            return;
        }

        if (!key.endsWith("-----END PGP PUBLIC KEY BLOCK-----")) {
            console.log('[pubkey-recv] savePublicKey skip: bad PGP footer for', uri);
            return;
        }

		let contacts = this.lookupContacts(uri);
		// Receiving someone's PGP public key is itself a strong "we're
		// about to talk" signal — strong enough that the contact book
		// should learn about them now. Without this, the cross-domain
		// handshake fails asymmetrically and silently for first-contact:
		// Alice's chat-open pushes her key to Bob, Bob has no contact
		// for Alice yet, lookupContacts returns [], the for-loop below
		// is a no-op, and Alice never gets a reply with Bob's key.
		// Autocreating here closes that hole. rejectNonContacts already
		// short-circuited above, so an opted-out user still wins.
		if (contacts.length === 0) {
			console.log('[pubkey-recv] savePublicKey autocreating contact for unknown sender', uri);
			this.lookupContact(uri, true, true);
			contacts = this.lookupContacts(uri);
		}
		console.log('[pubkey-recv] savePublicKey resolved', contacts.length, 'contact(s) for', uri);
		for (const contact of contacts) {
		    // Normalize the stored key the same way we normalized the
		    // incoming one. Without this, any difference in line endings
		    // (\r vs \n) or trailing whitespace in older SQL rows makes
		    // the compare fail on every incoming key — and we'd spam
		    // the chat with "Public key received" and the log with
		    // "Public key of <uri> saved" on every connection even
		    // though the key hasn't actually changed.
		    const stored = contact.publicKey
		        ? contact.publicKey.replace(/\r/g, '').trim()
		        : '';
		    if (stored !== key) {
				contact.publicKey = key;
				utils.timestampedLog('Public key of', uri, 'saved');
				console.log('[pubkey-recv] savePublicKey STORED new/updated key for', uri,
					'storedLen=', stored.length, 'newLen=', key.length);
				this.saveSylkContact(uri, contact, 'savePublicKey');
				// Reply with our own public key only for cross-domain
				// peers, and only once per app run. Same-domain peers
				// can already retrieve our key via lookupPublicKey on
				// their own server, so an automatic reply would be
				// redundant chatter on the message bus.
				const myDomain = this.state.accountId
					? this.state.accountId.split('@')[1]
					: null;
				const peerDomain = uri.split('@')[1];
				if (myDomain && peerDomain && peerDomain !== myDomain
						&& !this.sentPublicKeyUris.has(uri)) {
					this.sendPublicKeyToUri(uri);
					this.sentPublicKeyUris.add(uri);
				}
				this.saveSystemMessage(uri, 'Public key received', 'incoming');
		    } else {
				console.log('[pubkey-recv] savePublicKey unchanged: stored key equals incoming for', uri);
		    }
		}
    }

    async savePublicKeySync(uri, key) {
        console.log('[pubkey-recv] savePublicKeySync enter uri=', uri,
            'keyLen=', key ? key.length : 0);
        if (!key) {
            console.log('[pubkey-recv] savePublicKeySync skip: missing key for', uri);
            return;
        }

        key = key.replace(/\r/g, '').trim();

        if (!key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
            console.log('[pubkey-recv] savePublicKeySync skip: bad PGP header for', uri);
            return;
        }

        if (!key.endsWith("-----END PGP PUBLIC KEY BLOCK-----")) {
            console.log('[pubkey-recv] savePublicKeySync skip: bad PGP footer for', uri);
            return;
        }

		let contacts = this.lookupContacts(uri);
		// Same autocreate as savePublicKey — the journal-replay path
		// catches keys that were queued server-side while we were
		// offline, and those equally need a contact record to land on.
		// See savePublicKey for the full rationale.
		if (contacts.length === 0) {
			console.log('[pubkey-recv] savePublicKeySync autocreating contact for unknown sender', uri);
			this.lookupContact(uri, true, true);
			contacts = this.lookupContacts(uri);
		}
		console.log('[pubkey-recv] savePublicKeySync resolved', contacts.length, 'contact(s) for', uri);
		for (const contact of contacts) {
		    // Same normalization guard as savePublicKey — see comment
		    // there for why a raw compare spams false positives.
		    const stored = contact.publicKey
		        ? contact.publicKey.replace(/\r/g, '').trim()
		        : '';
		    if (stored !== key) {
				contact.publicKey = key;
				utils.timestampedLog('Public key of', uri, 'saved');
				console.log('[pubkey-recv] savePublicKeySync STORED new/updated key for', uri,
					'storedLen=', stored.length, 'newLen=', key.length);
				this.saveSylkContact(uri, contact, 'savePublicKeySync');
		    } else {
				console.log('[pubkey-recv] savePublicKeySync unchanged: stored key equals incoming for', uri);
		    }
		}
    }

    sendConferenceMessage(message) {
        if (!this.state.currentCall) {
            return;
        }

        if (!this.isConference(this.state.currentCall)) {
            return;
        }

        this.state.currentCall.sendMessage(message.text, 'text/plain');
        message.direction = 'outgoing';
        message.sent = true;
        message.received = true;
        this.saveConferenceMessage(this.state.currentCall.remoteIdentity.uri, message);
    }

    _sendMessage(uri, text, id, contentType, timestamp) {
        // Send outgoing messages
        if (!this.canSend()) {
            return;
        }

        //console.log('Send', contentType, 'message', id, 'to', uri);
        let message = this.state.account.sendMessage(uri, text, contentType, {id: id, timestamp: timestamp}, (error) => {
            if (error) {
                console.log('Message', id, 'sending error:', error);
                this.outgoingMessageStateChanged(id, 'failed');
                let status = error.toString();
                if (status.indexOf('DNS lookup error') > -1) {
                    status = 'Domain not found';
                    this.renderSystemMessage(uri, status, 'incoming');
                }
            }
        });
        
        if (contentType != 'text/plain') {
			//console.log('sentMessage', message);
        }
        //message.on('stateChanged', (oldState, newState) => {this.outgoingMessageStateChanged(message.id, oldState, newState)})
    }

    async sendMessage(uri, message, contentType='text/plain') {
        message.pending = true;
        message.sent = false;
        message.received = false;
        message.direction = 'outgoing';

		await this.waitForContactsLoaded();

        console.log('--- sendMessage', uri, message._id, contentType);
        //console.log(message);
        
        if (!message._id) {
		    console.log('--- sendMessage failed for missing id');
 			return;
        }

        let renderMessages = this.state.messages;
        if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
            if (Object.keys(renderMessages).indexOf(uri) === -1) {
                renderMessages[uri] = [];
            }
        }

        let public_keys;
        let contact = this.lookupContact(uri);
        //console.log('contact', contact);
        if (contact && contact.publicKey && this.state.keys) {
            public_keys = this.state.keys.public + "\n" + contact.publicKey;
        }

        message.contentType = contentType;
        message.content = message.text
        message.content_type = contentType;

		let selectedContact = this.state.selectedContact;
		
		if (contentType === 'application/sylk-message-metadata') {
			if (message.metadata.action != 'consumed' && message.metadata.action != 'autoanswer') {
			    this.handleMessageMetadata(uri, message.content);
			}

			// Bump the contact's "last activity" on the ORIGIN tick of a
			// location share so the conversation floats to the top of the
			// contacts list, same as when you send a normal message.
			// Follow-up ticks (metadataId set) intentionally skip this to
			// avoid thrashing saveSylkContact every 60s.
			// buildLastMessage already returns null for action === 'location',
			// so contact.lastMessage won't get overwritten by the JSON blob.
			if (message.metadata
				&& message.metadata.action === 'location'
				&& !message.metadata.metadataId) {
				console.log('[location] sendMessage: bumping contact timestamp for origin tick', uri);
				this.saveOutgoingChatUri(uri, message);
				if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
					const bumped = {
						...this.state.selectedContact,
						timestamp: message.createdAt,
						direction: 'outgoing',
						lastCallDuration: null,
					};
					this.setState({selectedContact: bumped});
				}
			}

			// Encrypt location metadata the same way regular text messages are
			// encrypted. Other metadata actions (consumed, autoanswer, label,
			// reply, rotation, etc.) continue shipping as plaintext.
			const isLocationMetadata = message.metadata && message.metadata.action === 'location';
			if (isLocationMetadata && public_keys && this.state.keys && !this.state.keyDifferentOnServer) {
				await OpenPGP.encrypt(message.text, public_keys).then((encryptedMessage) => {
					utils.timestampedLog('----- Outgoing location metadata', message._id, 'encrypted', 'to', uri);
					if (message.metadata.action != 'consumed' && message.metadata.action != 'autoanswer') {
						this.saveOutgoingMessage(uri, message, 1, contentType);
					}
					this._sendMessage(uri, encryptedMessage, message._id, contentType, message.createdAt);
				}).catch((error) => {
					console.log('Failed to encrypt location metadata:', error);
					let error_message = error.message.startsWith('stringResponse') ? error.message.slice(43, error.message.length - 1) : error.message;
					this.renderSystemMessage(uri, error_message, 'outgoing');
					if (message.metadata.action != 'consumed' && message.metadata.action != 'autoanswer') {
						this.saveOutgoingMessage(uri, message, 0, contentType);
					}
					this._sendMessage(uri, message.text, message._id, contentType, message.createdAt);
				});
			} else {
				if (message.metadata.action != 'consumed' && message.metadata.action != 'autoanswer') {
					this.saveOutgoingMessage(uri, message, 0, contentType);
				}
				this._sendMessage(uri, message.text, message._id, contentType, message.createdAt);
			}
			return;
		}
		
        if (contentType === 'application/sylk-file-transfer') {
			if (!this.state.fileTransferUrl) {
				console.log('No fileTransferUrl');
				return;
			}

            let file_transfer = message.metadata;
            if (!file_transfer.path) {
                console.log('Error: missing local path for file transfer');
                return;
            }

            const localPath = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + file_transfer.receiver.uri + "/" + file_transfer.transfer_id + "/" + file_transfer.filename;
            if (file_transfer.path !== localPath) {
                // the file may have already been copied
                const dirname = path.dirname(localPath);

                try {
                    await RNFS.mkdir(dirname);
                } catch (e) {
                    console.log('Error making directory', dirname, ':', e);
                    this.renderSystemMessage(uri, e.message);
                    return;
                }

                try {
                    await RNFS.copyFile(file_transfer.path, localPath);
                } catch (e) {
                    if (e.message.indexOf('No such file') > -1) {
						this.renderSystemMessage(uri, 'Original file not available anymore');
                    } else {                
						this.renderSystemMessage(uri, e.message);
                    } 
                    console.log('Error copying file from', file_transfer.path, 'to', localPath, ':', e);
                    this.deleteMessage(file_transfer.transfer_id, uri, false);
                    return;
                }
            }

            file_transfer.local_url = localPath;
            file_transfer.url = this.state.fileTransferUrl + '/' + file_transfer.sender.uri + '/' + file_transfer.receiver.uri + '/' + file_transfer.transfer_id + '/' + file_transfer.filename;
            message.metadata = file_transfer;
            this.uploadFile(message.metadata);
        }        

        if (message.contentType !== 'application/sylk-file-transfer' && message.contentType !== 'text/pgp-public-key' && public_keys && this.state.keys && !this.state.keyDifferentOnServer) {
            await OpenPGP.encrypt(message.text, public_keys).then((encryptedMessage) => {
                utils.timestampedLog('-----  Outgoing message', message._id, 'encrypted', 'to', uri);
                this.saveOutgoingMessage(uri, message, 1, contentType);
                this._sendMessage(uri, encryptedMessage, message._id, message.contentType, message.createdAt);
            }).catch((error) => {
                console.log('Failed to encrypt message:', error);
                let error_message = error.message.startsWith('stringResponse') ? error.message.slice(43, error.message.length - 1): error.message;
                this.renderSystemMessage(uri, error_message, 'outgoing');
                this.saveOutgoingMessage(uri, message, 0, contentType);
                //this.outgoingMessageStateChanged(message._id, 'failed');
                this._sendMessage(uri, message.text, message._id, message.contentType, message.createdAt);
            });
        } else {
            this.saveOutgoingMessage(uri, message, 0, message.contentType);
            if (message.contentType !== 'application/sylk-file-transfer' ) {
                utils.timestampedLog('Outgoing non-encrypted message', message._id, 'to', uri);
                this._sendMessage(uri, message.text, message._id, message.contentType, message.createdAt);
            }
        }

        if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
            //console.log('Added render message', message._id, message.contentType);
            // Use functional setState to avoid stale-closure races. Another
            // in-flight sendMessage (or _injectLocationBubble) may have replaced
            // state.messages while this call was awaiting PGP encrypt — pushing
            // onto the captured `renderMessages` reference and writing it back
            // would clobber the intervening update (e.g. a live-location bubble).
            this.setState(prev => {
                const prevList = (prev.messages && prev.messages[uri]) || [];
                const newMessages = {
                    ...prev.messages,
                    [uri]: [...prevList, message],
                };
                let nextSelected = prev.selectedContact;
                if (nextSelected && nextSelected.uri === uri) {
                    nextSelected = {
                        ...nextSelected,
                        timestamp: message.createdAt,
                        direction: 'outgoing',
                        lastCallDuration: null,
                    };
                    if (message.contentType?.startsWith('text/')) {
                        const _lm = this.buildLastMessage(message);
                        if (_lm != null) nextSelected.lastMessage = _lm;
                    }
                }
                return { messages: newMessages, selectedContact: nextSelected };
            });
        }
    }

    canSend() {
        if (!this.state.account) {
            //console.log('Wait for account...');
            return false;
        }

        if (!this.state.connection) {
            console.log('Wait for connection...');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            //console.log('Wait for wss connection ready...');
            return;
        }

        if (this.signOut) {
            console.log('Wait because we signed out');
            return;
        }

        return true;
    }

		async resizeBeforeUpload(localUrl, size=1200) {
		  //console.log('Image to resize', localUrl); 
		  try {
			const resized = await ImageResizer.createResizedImage(
			  localUrl,          // image URI
			  size,               // width
			  size,               // height
			  'JPEG',            // format
			  85,                // quality
			  0,                 // rotation
			  undefined,         // outputPath
			  false,             // keepMeta (false = strip EXIF)
			  { onlyScaleDown: true } // don't upscale smaller images
			);
		
			//console.log('Image resized:', resized);
			return resized;  // new file path to upload
		  } catch (err) {
			console.error('Image resize failed:', err);
			return null;
		  }
		}

    async uploadFile(file_transfer, cancel=false) {
        if (!this.state.fileTransferUrl) {
			console.log('No fileTransferUrl');
            return;
        }

		function removeWsFromPath(url) {
			return url.replace(/(\/webrtcgateway)\/ws(\/)/, '$1$2');
		}

        console.log('uploadFile', file_transfer.transfer_id);
		//console.log('-- file', JSON.stringify(file_transfer, null, 2));

        let encrypted_file;
        let outputFile;
        let local_url = file_transfer.local_url;
        let remote_url = file_transfer.url.replace(/^wss:\/\//, 'https://');

        remote_url = removeWsFromPath(remote_url);
        let uri = file_transfer.receiver.uri;
        
        //console.log('this.cancelledUploads', this.cancelledUploads);

        if (file_transfer.transfer_id in this.cancelledUploads) {
		   console.log("File transfer already cancelled", file_transfer.transfer_id);
		   return;
        }

		if (file_transfer.transfer_id in this.uploadRequests) {
		
		    if (cancel) {
				console.log("File transfer cancel request", file_transfer.transfer_id);
	
				const cancel_url = this.state.fileTransferUrl + '/cancel/' + file_transfer.transfer_id;
				// simple GET request
	
				this.cancelledUploads[file_transfer.transfer_id] = true;
				this.deleteTransferProgress(file_transfer.transfer_id);
				this.deleteMessage(file_transfer.transfer_id, uri, false);
	
				const task = this.uploadRequests[file_transfer.transfer_id];
				task.cancel();
	
				fetch(cancel_url)
					  .then(res => {
					console.log("File transfer cancelled", file_transfer.transfer_id);
					}
				  )
				  .catch(error => console.error('File transfer cancel error:', error, file_transfer.transfer_id));
	
				delete this.uploadRequests[file_transfer.transfer_id];
			}

		    console.log("File transfer already in progress", file_transfer.transfer_id);
			return;
		}

		this.updateFileTransferBubble(file_transfer);

        if (utils.isImage(file_transfer.filename, file_transfer.filetype)) {
            // scale down local_url file to 600px width
            if (!file_transfer.fullSize) {
				const resized = await this.resizeBeforeUpload(local_url, 600);
				if (resized) {
					try {
						file_transfer.filesize = resized.size;
						file_transfer.filetype = 'image/jpg';
						file_transfer.url = file_transfer.url.replace(/\.[^/.]+$/, '.jpg');
						file_transfer.path = resized.path;
						local_url = resized.path;
						//console.log('resized.path', resized.path);
						//console.log('New transfer', file_transfer);
					} catch (e) {
						console.log('error resize', e);
					}
				}
            }
        }
        
        if (!file_transfer.filetype) {
            file_transfer.filetype = 'application/octet-stream';
            try {
                let type = await fileType(file_transfer.local_url);
                file_transfer.filetype = type ? type.mime : 'application/octet-stream';
            } catch (e) {
                console.log('Error getting mime type', e.message);
            }
        }

        if (!this.canSend()) {
            return;
        }

        if (!local_url && file_transfer.transfer_id) {
            this.deleteMessage(file_transfer.transfer_id, uri);
            return;
        }

        try {
            const exists = await RNFS.exists(local_url);
        } catch (e) {
            console.log(local_url, 'does not exist');
            return;
        }

		encrypted_file = local_url + '.asc';
		let encryptedFileExist = false;

        try {
            encryptedFileExist = await RNFS.exists(local_url);
        } catch (e) {
            console.log(local_url, 'does not exist');
        }
        
        const contact = this.lookupContact(uri);

        if (utils.isFileEncryptable(file_transfer) && !encryptedFileExist && contact && contact.publicKey) {

            this.updateFileTransferBubble(file_transfer, 'Encrypting file...');
			let public_keys = contact.publicKey;
			console.log('Public key available for', uri);

			if (this.state.keys && this.state.keys.public) {
				public_keys = public_keys + "\n" + this.state.keys.public;
				console.log('Public key available for myself');
			}

			try {					
				this.updateTransferProgress(file_transfer.transfer_id, 5, 'encrypt');
				await OpenPGP.encryptFile(local_url, encrypted_file, public_keys, null, {fileName: file_transfer.filename});
				utils.timestampedLog('Outgoing file', file_transfer.transfer_id, 'encrypted', 'keys length', public_keys.length);
				//this.updateFileTransferBubble(file_transfer, 'Calculating checksum...');
				let base64_content = await RNFS.readFile(encrypted_file, 'base64');
				let checksum = utils.getPGPCheckSum(base64_content);

				const lines = base64_content.match(/.{1,60}/g) ?? [];
				let content = "";

				lines.forEach((line) => {
					content = content + line + "\n";
				});

				content = "-----BEGIN PGP MESSAGE-----\n\n"+content+"="+checksum+"\n-----END PGP MESSAGE-----\n";
				await RNFS.writeFile(encrypted_file, content, 'utf8');
				//this.updateFileTransferBubble(file_transfer, 'File encrypted');
				file_transfer.filetype = file_transfer.filetype;
				local_url = local_url + ".asc";
				remote_url = remote_url + '.asc';
				this.updateTransferProgress(file_transfer.transfer_id, 100, 'encrypt');
			} catch (error) {
				console.log('Failed to encrypt file:', error)
				file_transfer.error = 'Cannot encrypt file';
				this.outgoingMessageStateChanged(file_transfer.transfer_id, 'failed');
				let error_message = error.message.startsWith('intResponse') ? error.message.slice(40, error.message.length - 1): error.message;
				this.deleteTransferProgress(file_transfer.transfer_id);

				return;
				//this.renderSystemMessage(uri, error_message, 'outgoing');
			} finally {
				//this.updateFileTransferBubble(file_transfer);
			}

       }

	   this.updateTransferProgress(file_transfer.transfer_id, 0, 'upload');
	   	   
	   //console.log('upload final file', JSON.stringify(file_transfer, null, 2));

       utils.timestampedLog('--- Uploading file', file_transfer.transfer_id, remote_url);
       
       
	   let task = RNBlobUtil.fetch('POST', remote_url, {
		  'Content-Type': file_transfer.filetype,
		}, RNBlobUtil.wrap(local_url));

        this.uploadRequests[file_transfer.transfer_id] = task;
        this.uploadedFiles.add(file_transfer.transfer_id);

        task.uploadProgress((written, total) => {
		  const progress = Math.floor((written / total) * 100);
		  //console.log('File transfer', file_transfer.transfer_id, 'upload progress', progress);   
		  if (file_transfer.transfer_id in this.cancelledUploads) {
		      console.log('Upload was cancelled');
			  this.deleteMessage(file_transfer.transfer_id, uri, false);
			  this.deleteTransferProgress(file_transfer.transfer_id);
              delete this.uploadRequests[file_transfer.transfer_id]
		      delete this.cancelledUploads[file_transfer.transfer_id];
			  return;
		  }
		  //console.log('Upload progress', progress);
		  this.updateTransferProgress(file_transfer.transfer_id, progress, 'upload');
		})
		.then((res) => {
			console.log('File uploaded:', file_transfer.transfer_id, local_url);
			this.deleteTransferProgress(file_transfer.transfer_id);
	        this.updateFileTransferBubble(file_transfer);
            delete this.uploadRequests[file_transfer.transfer_id];
		})
		.cancel((err) => {
			console.log('Upload was cancelled', err);
			delete this.uploadRequests[file_transfer.transfer_id];
		})
		.catch((err) => {
            delete this.uploadRequests[file_transfer.transfer_id]
			this.deleteTransferProgress(file_transfer.transfer_id);
		    if (file_transfer.transfer_id in this.cancelledUploads) {
				console.log('Upload was cancelled');
				this.deleteMessage(file_transfer.transfer_id, uri, false);
			    //delete this.cancelledUploads[file_transfer.transfer_id];
			    return;
		    } else {
				console.log('Upload error', err);
				this.outgoingMessageStateChanged(file_transfer.transfer_id, 'failed');
				this.updateFileTransferBubble(file_transfer);
			    return;
            }
		});
	}
	
    async reSendMessage(message, uri) {
        await this.deleteMessage(message._id, uri).then((result) => {
            message._id = uuid.v4();
            this.sendMessage(uri, message);
        }).catch((error) => {
            console.log('Failed to delete old messages');
        });
    }

	deleteTransferProgress(id) {
		const dp = { ...this.state.transferProgress };
		if (id in dp) {
		    //console.log('deleteTransferProgress', id);
			delete dp[id] ;
			this.setState({ transferProgress: dp });
		}
	}

	updateTransferProgress(id, progress, stage) {
		const dp = { ...this.state.transferProgress };
		dp[id] = {stage: stage, progress: progress};
		this.setState({ transferProgress: dp });
	}

    async saveConferenceMessage(room, message) {
        let messages = this.state.messages;
        let ts = message.createdAt;

        let unix_timestamp = Math.floor(ts / 1000);
        let contentType = message.metadata && message.metadata.filename ? "application/sylk-file-transfer" : "text/plain";
        if (!message.direction) {
            message.direction = message.received ? 'incoming' : 'outgoing';
        }

        let from_uri = message.direction === 'incoming' ? room : this.state.accountId;
        let to_uri = message.direction === 'incoming' ? this.state.accountId : room;
        let system = message.system ? '1' : null;
        let sender = !system ? message.user._id : null;

        var content = message.text;
        var params = [this.state.accountId, system, JSON.stringify(message.metadata), message.image, sender, message.local_url, message.url, message._id, JSON.stringify(ts), unix_timestamp, content, contentType, from_uri, to_uri, message.direction, 0, message.sent ? 1: 0, message.received ? 1: 0];
        await this.ExecuteQuery("INSERT INTO messages (account, system, metadata, image, sender, local_url, url, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending, sent, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            //console.log('SQL insert conference message', message._id, from_uri, to_uri, message.direction);
            if (room in messages) {
                messages[room].push(message);
            } else {
                messages[room] = [message];
            }
            this.setState({messages: messages});
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('saveConferenceMessage SQL error:', error.message);
            }
        });
    }

    async updateConferenceMessage(room, message, update=false) {
        //console.log('Update conference message', message._id, 'for room', room);
        let messages = this.state.messages;
        let sent = message.sent ? 1 : 0;
        let received = message.received ? 1 : 0;

        var params = [JSON.stringify(message.metadata), message.text, 0, sent, received, message._id];
        await this.ExecuteQuery("update messages set metadata = ?, content = ?, pending = ?, sent = ?, received = ? where msg_id = ?", params).then((result) => {
            //console.log('SQL update conference message', message._id);
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('updateConferenceMessage SQL error:', error.message);
            }
        });

        let renderMessages = messages[room];
        let newRenderMessages = [];
        if (renderMessages) {
            renderMessages.forEach((msg) => {
                 if (msg._id === message._id) {
                     msg.image = message.image;
                     msg.video = message.video;
                     msg.text = message.text;
                     msg.metadata = message.metadata;
                     msg.pending = message.pending;
                     msg.failed = message.failed;
                     msg.sent = message.sent;
                     msg.received = message.received;
                 }
                 newRenderMessages.push(msg);
            });
            messages[room] = newRenderMessages;
            this.setState({messages: messages});
        }
    }

    async deleteConferenceMessage(room, message) {
        //console.log('Delete conference message', message._id);
        let messages = this.state.messages;

        var params = [message._id];
        await this.ExecuteQuery("delete from messages where msg_id = ?", params).then((result) => {
            let renderMessages = messages[room];
            let newRenderMessages = [];
            renderMessages.forEach((msg) => {
                 if (msg._id !== message._id) {
                     newRenderMessages.push(msg);
                 }
            });
            messages[room] = newRenderMessages;
            this.setState({messages: messages});
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('deleteConferenceMessage SQL error:', error);
            }
        });
    }

    // AppStore GPS Review — persists outgoing GPS/location records to SQL.
    // Stamps the `expire` column so purgeExpiredMessages() can enforce the
    // retention policy ("destroyed after meetup" for meeting shares, 7 days
    // for fixed-duration shares and location announcements).
    async saveOutgoingMessage(uri, message, encrypted=0, content_type="text/plain") {
		console.log('saveOutgoingMessage', message._id, content_type);

        // sent -> null
        // pending -> 1
        // received -> null
        // failed -> null

        if (content_type !== 'application/sylk-message-metadata') {
            this.saveOutgoingChatUri(uri, message);
        }

        try {
			let related_msg_id = null;
			let related_action = null;

			if (content_type == 'application/sylk-message-metadata') {
				related_msg_id = message.metadata.messageId;
				related_action = message.metadata.action;
			}

			let ts =  message.createdAt;
			let unix_timestamp = Math.floor(ts / 1000);

			// Live-location sharing: one SQL row per sharing session, content
			// blob holds the latest tick. Origin ticks (metadataId == null)
			// INSERT normally; follow-up ticks UPDATE the origin row in place
			// so the last known position survives a reload — crucial because
			// this runs regardless of encryption (encrypted flag in [0,1]) so
			// non-PGP sharing persists too.
			if (content_type === 'application/sylk-message-metadata'
				&& message.metadata
				&& message.metadata.action === 'location') {
				if (message.metadata.metadataId) {
					const originMsgId = message.metadata.messageId;
					const content = message.text; // JSON blob with latest coords
					const metadataJson = JSON.stringify(message.metadata);
					this.ExecuteQuery(
						"update messages set content = ?, metadata = ?, unix_timestamp = ?, timestamp = ? where msg_id = ? and account = ?",
						[content, metadataJson, unix_timestamp, JSON.stringify(ts), originMsgId, this.state.accountId]
					).then((result) => {
						const rows = result && result.rowsAffected;
						if (!rows) {
							console.log('[location] origin row missing for', originMsgId,
								'— update tick will not persist until origin is saved');
						}
					}).catch((error) => {
						console.log('[location] UPDATE SQL error:', error && error.message ? error.message : error);
					});
					return;
				}
				console.log('[location] INSERT SQL origin row (saveOutgoingMessage)', message._id,
					'targets messageId=', message.metadata.messageId);
			}

			// Time-sensitive rows stamp an `expire` unix-seconds so
			// purgeExpiredMessages() can clean up after a crash/force-kill.
			// Non-expiring rows use 0, which the purge WHERE skips.
			//
			// Retention policy for location shares:
			//   • "Until we meet" (meeting_request / in_reply_to) — stays
			//     until the handshake wipes both sides at session end.
			//     `expire` tracks the session's own expires_at so a force
			//     kill still cleans it up.
			//   • Plain timed share (2h / 4h / 8h / 24h) — the session end
			//     is only an upper bound on tick delivery. Per product
			//     decision the last-known position lingers on both devices
			//     for UP TO 7 DAYS after sending, then is purged. We stamp
			//     `expire = now + 7d` for these; the announcement text
			//     (locationAnnouncement:true) follows the same rule so the
			//     explanatory preamble disappears alongside the coords.
			let expire = 0;
			const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
			const nowSecForExpire = Math.floor(Date.now() / 1000);
			const isLocationMeta = content_type === 'application/sylk-message-metadata'
				&& message.metadata
				&& message.metadata.action === 'location';
			const isLocationAnnouncement = message.metadata
				&& message.metadata.locationAnnouncement === true;
			const isMeetupShare = isLocationMeta
				&& (message.metadata.meeting_request === true
					|| !!message.metadata.in_reply_to);
			if (isLocationMeta) {
				if (isMeetupShare) {
					// Keep existing behaviour — session-end wipe.
					if (message.metadata.expires) {
						const expMs = new Date(message.metadata.expires).getTime();
						if (expMs > 0) expire = Math.floor(expMs / 1000);
					}
				} else {
					// Plain timed share: live for at most 7 days from now.
					expire = nowSecForExpire + SEVEN_DAYS_SEC;
				}
			} else if (isLocationAnnouncement) {
				// Announcement only ever goes out for non-meetup shares
				// (NavigationBar.startLocationSharing gates it on
				// kind !== 'meetingRequest' / 'meetingAccept'), so it
				// always uses the 7-day retention window.
				expire = nowSecForExpire + SEVEN_DAYS_SEC;
			}

			let params = [this.state.accountId, message._id, JSON.stringify(ts), unix_timestamp, message.text, content_type, JSON.stringify(message.metadata), this.state.accountId, uri, "outgoing", "1", encrypted, related_msg_id, related_action, expire];
			await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, encrypted, related_msg_id, related_action, expire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {

			}).catch((error) => {
				if (error.message.indexOf('UNIQUE constraint failed') === -1) {
					console.log('saveOutgoingMessage SQL error:', error);
				}
			});
		} catch (e) {
			console.log('saveOutgoingMessage error', e);
		}
    }

    async outgoingMessageStateChanged(id, state) {
        let query;

        // mark message status
        // state can be failed or accepted

        utils.timestampedLog('Outgoing message', id, 'state is', state);

        if (state === 'accepted') {
            // pending 1 -> 0
            query = "UPDATE messages set pending = 0 where msg_id = ?";
        } else if (state === 'failed') {
            // pending -> 0
            // sent -> 1
            // received -> 0
            if (this.canSend()) {
                // message has failed while giving it to the server, it will not be resent
                // we should never end up here, unless the connection was down
                // in which case we should not have attempted yet to send the message, so is a very narrow window to end up be here
                query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = ?";
            }
        }

        //console.log(query);
        if (query) {
            await this.ExecuteQuery(query, [id]).then((results) => {
                this.updateRenderMessageState(id, state);
                // console.log('SQL update OK');
            }).catch((error) => {
                console.log('outgoingMessageStateChanged, SQL error:', error);
            });
        }
    }

    async saveDownloadTask(id, url, local_url) {
        //console.log('saveDownloadTask', url, local_url);
        let query = "SELECT * from messages where msg_id = ? and account = ?";
        await this.ExecuteQuery(query,[id, this.state.accountId]).then((results) => {
            let rows = results.rows;
            let file_transfer = {};
            if (rows.length === 1) {
                var item = rows.item(0);
                let metadata = item.metadata || item.content;
                try {
                    file_transfer = JSON.parse(metadata);
                } catch (e) {
                    console.log('Error decoding json in saveDownloadTask', metadata);
                    return;
                }

                let uri = file_transfer.sender.uri === this.state.accountId ? file_transfer.receiver.uri : file_transfer.sender.uri;
                file_transfer.local_url = local_url;
                file_transfer.paused = false;

                this.ExecuteQuery("UPDATE messages set metadata = ? where msg_id = ?", [JSON.stringify(file_transfer), id]).then((results) => {
                    //console.log('File transfer updated', id);
                    if (local_url.endsWith('.asc')) {
                        try {
                            this.decryptFile(file_transfer);
                        } catch (e) {
                            console.log('Failed to decrypt file', e.message)
                        }
                    } else {
                        this.updateFileTransferBubble(file_transfer);
                    }
                }).catch((error) => {
                    console.log('saveDownloadTask update SQL error:', error);
                });
            }

        }).catch((error) => {
            console.log('saveDownloadTask select SQL error:', error);
        });
    }

    async messageStateChanged(id, state, data) {
        // valid API states: pending -> accepted -> delivered -> displayed
        // error, failed or forbidden
        // valid UI render states: pending, read, received

        let reason = data.reason;
        let code = data.code;
        let failed = state === 'failed';

        if (failed && code) {
            if (code > 500 || code === 408) {
                utils.timestampedLog('Message', id, 'failed on server:', reason, code);
            }
        }

        //utils.timestampedLog('Message', id, 'IMDN state changed to', state);
        let query;

        const failed_states = ['failed', 'error', 'forbidden'];

        if (state == 'accepted') {
            query = "UPDATE messages set pending = 0, state = ? where msg_id = ?";
        } else if (state == 'delivered') {
            query = "UPDATE messages set pending = 0, sent = 1, state = ? where msg_id = ?";
        } else if (state == 'displayed') {
            query = "UPDATE messages set received = 1, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else if (failed_states.indexOf(state) > -1) {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else {
            console.log('Invalid message state', id, state);
            return;
        }

        await this.ExecuteQuery(query, [state, id]).then((results) => {
            this.updateRenderMessageState(id, state);
            // console.log('SQL update OK');
        }).catch((error) => {
            console.log('messageStateChanged SQL error:', error);
        });
    }

    async fileTransferStateChanged(id, state, file_transfer) {
        let failed = state === 'failed';

        utils.timestampedLog('File transfer', id, 'is', state);
        let query;

        const failed_states = ['failed', 'error', 'forbidden'];

        if (state == 'accepted') {
            query = "UPDATE messages set metadata = ?, pending = 0, state = ? where msg_id = ?";
        } else if (state == 'delivered') {
            query = "UPDATE messages set metadata = ?, pending = 0, sent = 1, state = ? where msg_id = ?";
        } else if (state == 'displayed') {
            query = "UPDATE messages set metadata = ?, received = 1, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else if (failed_states.indexOf(state) > -1) {
            file_transfer.failed = true;
            query = "UPDATE messages set metadata = ?, received = 0, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else {
            console.log('Invalid file transfer state', id, state);
            return;
        }
        
        //console.log(query);

        await this.ExecuteQuery(query, [JSON.stringify(file_transfer), state, id]).then((results) => {
            this.updateFileTransferBubble(file_transfer);
        }).catch((error) => {
            console.log('fileTransferStateChanged SQL error:', error);
        });
    }

    async messageStateChangedSync(obj) {
        //console.log('messageStateChangedSync', obj);
        // valid API states: pending -> accepted -> delivered -> displayed
        // error, failed or forbidden
        // valid UI render states: pending, read, received

        let id = obj.messageId;
        let state = obj.state;

        //console.log('Sync message', id, 'state', state);

        let query;

        const failed_states = ['failed', 'error', 'forbidden'];

        if (state == 'accepted') {
            query = "UPDATE messages set pending = 0, state = ? where msg_id = ?";
        } else if (state == 'delivered') {
            query = "UPDATE messages set pending = 0, sent = 1, state = ? where msg_id = ?";
        } else if (state == 'displayed') {
            query = "UPDATE messages set received = 1, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else if (failed_states.indexOf(state) > -1) {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0, state = ? where msg_id = ?";
        } else {
            console.log('Invalid message state:', state);
			return;
        }

        await this.ExecuteQuery(query, [state, id]).then((results) => {
            //console.log('messageStateChangedSync SQL update OK', state);
			this.updateRenderMessageState(id, state);

        }).catch((error) => {
            console.log('messageStateChangedSync SQL error:', error);
        });
    }

    async deleteRawMessage(rowid) {
		console.log('Deleting broken row id', rowid);
		await this.ExecuteQuery("DELETE FROM messages WHERE rowid = ?", [rowid]);
	}

    // AppStore GPS Review — deletes a single message row from SQL, including
    // the live-location origin row. Removing the origin bubble is the
    // user-facing "stop & erase" control for an ongoing GPS share: this
    // method also tears down the in-memory share timer so no further GPS
    // ticks are written back to disk after the row is gone.
    async deleteMessage(id, uri, remote=true, after=false) {
        //utils.timestampedLog('Message', id, 'is deleted');
        console.log('deleteMessage', id, 'remote', remote);
        let query;

        if (!id) {
			return;
        }

		// If the message being deleted is the live-location bubble (origin
		// tick) for a still-active sharing session, cancel the timer in
		// NavigationBar so we stop firing updates that would otherwise
		// re-create the row we just deleted on the next tick. Pass `id`
		// as deletedId so the session-cleanup block inside
		// stopLocationSharing can skip a redundant delete for the bubble
		// we're already handling, and still propagate deleteMessage with
		// remote=true for the OTHER leg so both devices converge on the
		// same "only system notes remain" end state.
		try {
			const msgList = (this.state.messages && this.state.messages[uri]) || [];
			const target = msgList.find(m => m._id === id);
			if (target && target.contentType === 'application/sylk-live-location') {
				const navBar = this.navigationBarRef && this.navigationBarRef.current;
				if (navBar && typeof navBar.stopLocationSharing === 'function') {
					console.log('[location] deleteMessage: stopping active sharing for', uri,
						'because origin bubble', id, 'was deleted');
					navBar.stopLocationSharing(uri, {
						reason: 'deleted',
						deletedId: id,
					});
				}
			}
		} catch (e) {
			console.log('[location] deleteMessage stop-sharing check failed', e);
		}

		this.deleteRenderMessage(id, uri);


        let message_ids = [id];
        if (after) {
            let rows;
            let sql_message;
            let unix_timestamp;
            let day;

            query = "SELECT * FROM messages where account = ? and msg_id = ?";
            await this.ExecuteQuery(query, [this.state.accountId, id]).then((results) => {
                rows = results.rows;
                if (rows.length === 1) {
                    sql_message = rows.item(0);
                    unix_timestamp = sql_message.unix_timestamp;
                    day = new Date(unix_timestamp * 1000).toISOString().slice(0,10);
                    day = '%'+ day+ '%';
                };

            }).catch((error) => {
                console.log('deleteMessage SQL error:', error);
            });

            if (unix_timestamp) {
                query = "SELECT * FROM messages where account = ? and ((to_uri = ? and direction = 'outgoing') or (from_uri = ? and direction = 'incoming')) and unix_timestamp >= ? and timestamp like ? order by unix_timestamp asc";
                await this.ExecuteQuery(query, [this.state.accountId, uri, uri, unix_timestamp, day]).then((results) => {
                    rows = results.rows;
                    for (let i = 0; i < rows.length; i++) {
                        var item = rows.item(i);
                        //console.log('Found message', item.msg_id)
                        message_ids.push(item.msg_id);
                    }

                }).catch((error) => {
                    console.log('SQL error:', error);
                });
            }
        }
        
        console.log('messages to remove', message_ids);

        for (let j = 0; j < message_ids.length; j++) {
            var _id = message_ids[j];
            this.deleteFilesForMessage(_id, uri);
            this.deleteMetadataForMessage(_id);
			this.deleteRenderMessage(_id, uri);

            // TODO delete replyIds as well
            if (remote) {
               this.addJournal(_id, 'removeMessage', {uri: uri});
               //console.log('add journal 1');
            }
        }
    }

    async deleteMetadataForMessage(id) {
        //console.log('deleteMetadataForMessage', id);
		query = "delete FROM messages where account = ? and related_msg_id = ?";
		const params = [this.state.accountId, id];
		await this.ExecuteQuery(query, params).then((results) => {
		    if (results.rowsAffected) {
				console.log('Deleted', results.rowsAffected, 'metadata entries for', id);
			}
		}).catch((error) => {
			console.log('deleteMetadataForMessage SQL error:', error);
		});
    }

    deleteFilesForMessage(id, uri) {
        let query = "SELECT * from messages where msg_id = ? and account = ?";
        this.ExecuteQuery(query,[id, this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                query = "DELETE from messages where msg_id = ?";
                this.ExecuteQuery(query, [id]).then((results) => {
                    this.deleteRenderMessage(id, uri);
                    //console.log('SQL deleted', results.rowsAffected, 'messages');
                }).catch((error) => {
                    console.log('deleteFilesForMessage SQL error:', error);
                });

                if (item.metadata) {
                    let file_transfer = JSON.parse(item.metadata);
                    if (file_transfer.receiver && file_transfer.sender) {
                        let remote_party = file_transfer.sender.uri === this.state.accountId ? file_transfer.receiver.uri : file_transfer.sender.uri;
                        let dir_path = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + remote_party + "/" + id + "/";
                        //console.log('Removing', dir_path);
                        RNFS.unlink(dir_path).then((success) => {
                            console.log('Removed directory', dir_path);
                            // TODO: update storage usage:
                            this.updateStorageForContact(remote_party, file_transfer.filesize, 0);                              
                        }).catch((err) => {
                            if (err.message.indexOf('File does not exist') === -1) {
                                //console.log('Error deleting directory', dir_path, err.message);
                            }
                        });
                    }
                }
            }

        }).catch((error) => {
            console.log('deleteFilesForMessage SQL error:', error);
        });
    }

    async deleteMessageSync(id, uri) {
        //console.log('Sync message', id, 'is deleted');
        let query;
        this.deleteFilesForMessage(id, uri);
        query = "DELETE from messages where msg_id = ?";
        this.ExecuteQuery(query, [id]).then((results) => {
            //console.log('deleteMessageSync rows', results.rowsAffected);
            if (results.rowsAffected > 0) {
				this.deleteRenderMessageSync(id, uri);
            } else {
				
            }
			this.deleteMetadataForMessage(id);
        }).catch((error) => {
			
            console.log('deleteMessageSync SQL error:', error);
        });

    }

    async expireMessage(id, duration=300) {
        utils.timestampedLog('Expire message', id, 'in', duration, 'seconds after read');
        // TODO expire message
    }

	async deleteRenderMessage(id, uri) {
		const { messages } = this.state;
	
		// If uri has no messages, do nothing
		if (!(uri in messages)) {
			return;
		}
	
		const existingMessages = messages[uri];
	
		// Filter without mutating original array
		const newRenderedMessages = existingMessages.filter(m => m._id !== id);
	
		// If nothing changed -> exit early
		if (newRenderedMessages.length === existingMessages.length) {
			return;
		}
	
		// Create NEW messages object (immutability)
		const newMessages = {
			...messages,
			[uri]: newRenderedMessages,
		};
	
		// Set NEW references -> memoized components rerender
		//console.log('deleteRenderMessage', id);
		this.setState({
			messages: newMessages,
		});
	}

	async deleteRenderMessageSync(id, uri) {
		const existingList = this.state.messages[uri] ?? [];
	
		// Build new array without mutating the original
		const newRenderedMessages = existingList.filter(m => m._id !== id);
	
		// If nothing changed, leave state untouched
		if (newRenderedMessages.length === existingList.length) {
			
			return;
		}
	
		// Create a NEW messages object for memoization to detect changes
		this.setState(prev => ({
			messages: {
				...prev.messages,
				[uri]: newRenderedMessages
			}
		}));
	}

    async sendPendingMessage(uri, text, id, contentType, timestamp) {
        utils.timestampedLog('Outgoing pending message', id);
        if (!id) {
			return;
        }

        let contact = this.lookupContact(uri);

        if (contact && contact.publicKey && this.state.keys.public) {
            let public_keys = contact.publicKey + "\n" + this.state.keys.public;
            await OpenPGP.encrypt(text, public_keys).then((encryptedMessage) => {
                utils.timestampedLog('Outgoing message', id, 'encrypted');
                this._sendMessage(uri, encryptedMessage, id, contentType, timestamp);
            }).catch((error) => {
                let error_message = error.message.startsWith('stringResponse') ? error.message.slice(42, error.message.length - 1): error.message;
                this.renderSystemMessage(uri, error_message, 'outgoing');
                this._sendMessage(uri, text, id, contentType, timestamp);
                //console.log('Failed to encrypt message:', error);
                //this.outgoingMessageStateChanged(id, 'failed');
                //this.saveSystemMessage(uri, 'Failed to encrypt message', 'outgoing');
            });
        } else {
            //console.log('Outgoing non-encrypted message to', uri);
            this._sendMessage(uri, text, id, contentType, timestamp);
        }
    }

    async sendPendingMessages() {
        console.log('sendPendingMessages');

        if (this.signOut) {
           return;
        }

        let content;
        let metadata;
        //await this.ExecuteQuery("SELECT * from messages where pending = 1 and content_type like 'text/%' and from_uri = ?", [this.state.accountId]).then((results) => {
        await this.ExecuteQuery("SELECT rowid, * from messages where pending = 1 and from_uri = ?", [this.state.accountId]).then((results) => {
            let rows = results.rows;
            for (let i = 0; i < rows.length; i++) {
                if (this.signOut) {
                   return;
                }
                
                var item = rows.item(i);
                //console.log('sendPendingMessages item', item);

                if (!item.msg_id) {
                    console.log('Skip broken item without msg_id', item.rowid);
					this.deleteRawMessage(item.rowid);
                    continue;
                }
                 
                if (!item.to_uri) {
                    console.log('Skip broken item without to_uri');
					this.deleteMessage(item.msg_id, item.to_uri);
                    continue;
                }


                if (item.to_uri.indexOf('@conference.') > -1) {
                    //console.log('Skip outgoing conference conference messages');
                    continue;
                }

                if (item.to_uri.indexOf('@videoconference') > -1) {
                    //console.log('Skip outgoing videoconference conference messages');
                    continue;
                }

                let timestamp = new Date(item.unix_timestamp * 1000);
                console.log('Pending outgoing message', item.msg_id, item.content_type, item.to_uri);
                if (item.content_type === 'application/sylk-file-transfer') {
                    try {
                        metadata = JSON.parse(item.metadata);
                        if (metadata) {
                            this.uploadFile(metadata);
                        } else {
                            this.deleteMessage(item.msg_id, item.msg_id.to_uri);
                        }

                    } catch (e) {
                        console.log("Error decoding outgoing file transfer json sql: ", e);
                        this.deleteMessage(item.msg_id, item.to_uri);
                    }
                } else {
                    this.sendPendingMessage(item.to_uri, item.content, item.msg_id, item.content_type, timestamp);
                }
            }

        }).catch((error) => {
            console.log('sendPendingMessages SQL error:', error);
        });

        await this.ExecuteQuery("SELECT * FROM messages where direction = 'incoming' and system is null and received = 0 and from_uri = ?", [this.state.accountId]).then((results) => {
            //console.log('SQL get messages OK');

            let rows = results.rows;
            let imdn_msg;
            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                let timestamp = JSON.parse(item.timestamp, _parseSQLDate);
                imdn_msg = {id: item.msg_id, timestamp: timestamp, from_uri: item.from_uri}
                this.sendDispositionNotification(imdn_msg, 'delivered', true);
            }

        }).catch((error) => {
            console.log('sendPendingMessages SQL error:', error);
        });
    }

	async updateRenderMessageState(id, state, url) {
	
	  if (!this.state.selectedContact) {
		  return;
	  }

	  let query;
	  let uri;
	  let hasChanges = false;
	
	  query = "SELECT * from messages where msg_id = ? and account = ?";
	
	  try {
		const results = await this.ExecuteQuery(query, [id, this.state.accountId]);
		const rows = results.rows;
		if (rows.length !== 1) return;
	
		const item = rows.item(0);

		if (item.content_type === 'application/sylk-message-metadata') return;

		uri = item.direction === 'outgoing' ? item.to_uri : item.from_uri;
	
		if (!(uri in this.state.messages)) return;

 	    //console.log('updateRenderMessageState', id, state);
	
		// Create a shallow clone of the messages object (immutable update)
		const prevMessages = this.state.messages;
		const updatedMessagesForUri = prevMessages[uri].map((m) => {
		  if (m._id !== id) return m; // keep same reference if unchanged
		  
		  // clone the message that needs to change
		  const updated = { ...m };
		  if (url && updated.metadata) {
			updated.metadata = { ...updated.metadata, url };
		  }
		  	
		  switch (state) {
			case 'accepted':
			  Object.assign(updated, { pending: false, failed: false });
			  hasChanges = true;
			  break;
	
			case 'delivered':
			  Object.assign(updated, { sent: true, pending: false, failed: false });
			  hasChanges = true;
			  break;
	
			case 'displayed':
			  if (
				this.state.selectedContact &&
				this.state.selectedContact.uri === uri &&
				!updated.received
			  ) {
				this.playMessageSound('outgoing');
			  }
			  Object.assign(updated, {
				received: true,
				sent: true,
				pending: false,
				failed: false,
			  });
			  hasChanges = true;
			  break;
	
			case 'failed':
			  Object.assign(updated, {
				received: false,
				sent: false,
				pending: false,
				failed: true,
			  });
			  hasChanges = true;
			  break;

			case 'error':
			  Object.assign(updated, {
				pending: false,
				failed: true,
			  });
			  hasChanges = true;
			  break;
	
			case 'pinned':
			  updated.pinned = true;
			  hasChanges = true;
			  break;
	
			case 'unpinned':
			  updated.pinned = false;
			  hasChanges = true;
			  break;
		  }

		  return updated;
		});
	
		const changedCount = updatedMessagesForUri.filter((m, i) => m !== prevMessages[uri][i]).length;
		//console.log('Changed message count:', changedCount);

		if (hasChanges) {
		  this.setState((prev) => ({
			messages: {
			  ...prev.messages,
			  [uri]: updatedMessagesForUri,
			},
		  }));
	
		  if (state === 'failed') {
			// this.renderSystemMessage(uri, 'Message delivery failed', 'incoming');
		  }
		}
	  } catch (error) {
		console.log('SQL query:', query);
		console.log('SQL error:', error);
	  }
	}
	
    get contactMessages() {
          if (this.state.selectedContact && this.state.selectedContact.uri in this.state.messages) {
			  return this.state.messages[this.state.selectedContact.uri];
          }
          return [];
    }

    async saveOutgoingChatUri(uri, message) {
        let query;
        let content = message.text;

        console.log('saveOutgoingChatUri', uri);
        let contact = this.lookupContact(uri, true);

        if (contact.uri !== this.state.accountId) {
			this.lookupPublicKey(contact);
		}

        contact.unread = [];
        if (contact.totalMessages) {
            contact.totalMessages = contact.totalMessages + 1;
        }

        if (content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
            const _lm = this.buildLastMessage(message);
            if (_lm != null) {
                contact.lastMessage = _lm;
                contact.lastMessageId = message.id;
            }
        }

        if (contact.tags.indexOf('chat') === -1) {
            contact.tags.push('chat');
        }

        contact.lastCallDuration = null;
        contact.timestamp = new Date();
        contact.direction = 'outgoing';
        this.saveSylkContact(uri, contact, 'saveOutgoingChat');
    }

     pinMessage(id) {
        let query;
        query = "UPDATE messages set pinned = 1 where msg_id = ?";
        //console.log(query);
        this.ExecuteQuery(query, [id]).then((results) => {
            console.log('Message', id, 'pinned');
            this.updateRenderMessageState(id, 'pinned')
            this.addJournal(id, 'pinMessage');

        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
     }

     unpinMessage(id) {
        let query;
        query = "UPDATE messages set pinned = 0 where msg_id = ?";
        //console.log(query);
        this.ExecuteQuery(query, [id]).then((results) => {
            this.updateRenderMessageState(id, 'unpinned')
            this.addJournal(id, 'unPinMessage');
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
     }

     async addJournal(id, action, data={}) {
        if (!id) {
			return;
        }
        console.log('Add journal entry:', action, id);
        this.outgoingJournalEntries[uuid.v4()] = {id: id, action: action, data: data};
        this.replayJournal();
     }

     async replayJournal() {
        console.log('-- replayJournal');

        if (!this.state.account) {
            utils.timestampedLog('replayJournal later when going online...');
            return;
        }

        if (this.signOut) {
            utils.timestampedLog('replayJournal skipped if signOut');
            return;
        }

		if (!this.canSend()) {
			utils.timestampedLog('replayJournal cannot send now');
			return;
		}

        let op;
        let executed_ops = [];

        Object.keys(this.outgoingJournalEntries).forEach((key) => {
            op = this.outgoingJournalEntries[key];
            utils.timestampedLog('Sync journal', op.action, op.id);
            if (op.action === 'removeConversation') {
                this.state.account.removeConversation(op.id, (error) => {
                    // TODO: add period and delete remote flags
                    if (error) {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });

            } else if (op.action === 'readConversation') {
                this.state.account.markConversationRead(op.id, (error) => {
                    if (error) {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });

            } else if (op.action === 'removeMessage') {
                this.state.account.removeMessage({id: op.id, receiver: op.data.uri}, (error) => {
                    if (error) {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });
            }

            if (this.canSend()) {
                executed_ops.push(key);
            }
        });

        executed_ops.forEach((key) => {
            delete this.outgoingJournalEntries[key];
        });

        storage.set('outgoingJournalEntries', this.outgoingJournalEntries);
        this.sendPendingMessages();
     }

     async confirmRead(uri, source) {
        if (this.state.appState === 'background') {
            return;
        }

        if (uri.indexOf('@') === -1) {
            return;
        }

        if (uri.indexOf('@conference.') > -1) {
            return;
        }

        if (uri.indexOf('@videoconference.') > -1) {
            return;
        }

        if (uri in this.state.decryptingMessages && this.state.decryptingMessages[uri].length > 0) {
            return;
        }

        //console.log('confirmRead', uri, source);
        let displayed = [];
        let params = [uri, this.state.accountId, this.state.accountId];
    
        await this.ExecuteQuery("SELECT * FROM messages where from_uri = ? and received = 1 and encrypted not in (1) and system is NULL and to_uri = ? and account = ? ", params).then((results) => {
            let rows = results.rows;
            if (rows.length > 0) {
               //console.log('Confirm read for', rows.length, 'new messages');
            } else {
               //console.log('No messages to confirm read');
               return;
            }

            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                if (!this.messagesConfirmedRead.has(item.msg_id)) {
					//console.log('item.msg_id', item.msg_id, item.encrypted);

					// Audio messages are only marked "displayed" once the
					// recipient actually presses Play on them. Skip here so
					// the SQL row stays at received=1; ContactsListBox will
					// invoke markAudioMessageDisplayed() on play.
					let isAudioMessage = false;
					if (item.metadata) {
						try {
							const parsed = JSON.parse(item.metadata);
							const filetype = parsed && parsed.filetype;
							const filename = parsed && parsed.filename;
							if (utils.isAudio(filename, filetype)) {
								isAudioMessage = true;
							}
						} catch (e) {
							// Non-JSON metadata is fine — fall through.
						}
					}
					if (isAudioMessage) {
						continue;
					}

					this.messagesConfirmedRead.add(item.msg_id);
					const dispositionNotification = item.disposition_notification ? item.disposition_notification.split(",") : [];
					//console.log('dispositionNotification', dispositionNotification);
					if (dispositionNotification.indexOf('display') === -1) {
						item.save_only = true;
					} else {
						item.save_only = false;
					}

					if (item.encrypted === 3) {
						console.log('Message could not be decrypted', item.msg_id, item.content_type);
						this.sendDispositionNotification(item, 'error', true);
					} else {
						this.sendDispositionNotification(item, 'displayed', true);
					}
				}
            }

        }).catch((error) => {
            console.log('SQL error:', error);
        });

        this.resetUnreadCount(uri);
    }

    async resetUnreadCount(uri) {
        //console.log('--- resetUnreadCount', uri);
        let missedCalls = this.state.missedCalls;
        let idx;
        let changes = false;

		// Clear iOS throttle so next message from this contact alerts immediately
		if (this.outgoingNotifications && this.outgoingNotifications[uri]) {
			delete this.outgoingNotifications[uri];
		}

		let contacts = this.lookupContacts(uri);

		if (contacts.length === 0) {
			return;
		}

		for (const contact of contacts) {
			if (contact.unread.length > 0) {
				contact.unread = [];
				contact.unread.forEach((id) => {
					idx = missedCalls.indexOf(id);
					if (idx > -1) {
						missedCalls.splice(idx, 1);
					}
				});
				changes = true;
			}
	
			if (contact.lastCallId) {
				idx = missedCalls.indexOf(contact.lastCallId);
				if (idx > -1) {
					missedCalls.splice(idx, 1);
				}
			}
	
			idx = contact.tags.indexOf('missed');
			if (idx > -1) {
				contact.tags.splice(idx, 1);
				changes = true;
			}
	
			if (changes) {
				this.saveSylkContact(uri, contact, 'resetUnreadCount');
			}
        }

        this.setState({missedCalls: missedCalls});
    }

	async sendDispositionNotification(message, state='displayed', save=false) {
        let contentType = message.content_type || message.contentType;

        let id = message.msg_id || message.id || message.transfer_id || message._id;
        let uri =  message.sender ? message.sender.uri : message.from_uri;
        let timestamp = message.timestamp;

        if (contentType == 'application/sylk-message-metadata' || message.save_only) {
			let query = "UPDATE messages set received = 2 where msg_id = ? and account = ?";
			this.ExecuteQuery(query, [id, this.state.accountId]).then((results) => {
				utils.timestampedLog('IMDN', id, state, uri, 'SQL saved only');
			}).catch((error) => {
				utils.timestampedLog('IMDN', id, state, uri, 'error:', error.message);
			});

			//utils.timestampedLog('IMDN', id, state, uri, 'skipped for metadata');
			return;
        }

	    console.log('sendDispositionNotification', id, state);

        // Account-wide read-receipts opt-out. When the user has switched
        // "Read receipts" off in their account modal, suppress 'displayed'
        // IMDN notifications across the board (per-contact 'noread' tag is
        // handled below, but this is the global switch). 'delivered' still
        // goes through — it confirms receipt, not that the user has read.
        if (state === 'displayed' && this.state.readReceipts === false) {
            if (save) {
                let query = "UPDATE messages set received = 2 where msg_id = ? and account = ?";
                this.ExecuteQuery(query, [id, this.state.accountId]).then(() => {
                    utils.timestampedLog('IMDN', id, state, uri, 'read receipts off — saved locally only');
                }).catch((error) => {
                    utils.timestampedLog('IMDN', id, state, uri, 'error:', error.message);
                });
            }
            return false;
        }

        let contact = this.lookupContact(uri);
        
        if (contact) {
			const tags = contact.tags;
			//console.log('tags', tags);
			if (tags.indexOf('noread') > -1) {
			    // don't send read receipts, just mark message locally
				if (save) {
					let received = (state === 'delivered') ? 1 : 2;
					let query = "UPDATE messages set received = ? where msg_id = ? and account = ?";
					this.ExecuteQuery(query, [received, id, this.state.accountId]).then((results) => {
						utils.timestampedLog('IMDN', id, state, uri, 'saved');
					}).catch((error) => {
						utils.timestampedLog('IMDN', id, state, uri, 'error:', error.message);
					});
				} else {
					//utils.timestampedLog('IMDN', id, state, uri, 'skipped');
				}
				return;
			}
        }
        
        if (message.metadata && message.metadata.sender) {
			uri = message.metadata.sender.uri;
			timestamp = message.metadata.timestamp;
        }

        if (!this.canSend()) {
			utils.timestampedLog('IMDN', id, state, uri, 'will be sent later');
            return false;
        }

        let result = await new Promise((resolve, reject) => {
            this.state.account.sendDispositionNotification(uri, id, timestamp, state, (error) => {
                if (!error) {
                    if (save) {
                        let received = (state === 'delivered') ? 1 : 2;
                        let params = [received, id, this.state.accountId];                       
                        let query = "UPDATE messages set received = ? where msg_id = ? and account = ?";
                        this.ExecuteQuery(query, params).then((result) => {
							if (result.rowsAffected) {
								//utils.timestampedLog('IMDN', id, state, uri, 'saved');
							}
                        }).catch((error) => {
							console.log('IMDN', id, state, uri, 'error:', error.message);
                        });
                    }
                    resolve(true);
                } else {
					console.log('IMDN', id, state, uri, 'error:', error);
                    resolve(false);
                }
            });
        });

        return result;
    }

    // Sends IMDN "displayed" for a single audio message. Triggered from the
    // chat UI when the recipient first presses Play, so audio receipts are
    // delayed until actual playback (rather than chat-open like other types).
    //
    // We fire sendDispositionNotification synchronously (no awaited SQL
    // pre-fetch) so the network notification is dispatched at the instant
    // Play is pressed. SQL state is updated inside sendDispositionNotification's
    // success callback. Dedupe via this.messagesConfirmedRead avoids duplicate
    // sends if Play is pressed multiple times.
    markAudioMessageDisplayed(message) {
        if (!message || !message.metadata) {
            return;
        }
        const id = message.metadata.transfer_id || message._id;
        if (!id) {
            return;
        }
        if (this.messagesConfirmedRead && this.messagesConfirmedRead.has(id)) {
            return;
        }
        if (this.messagesConfirmedRead) {
            this.messagesConfirmedRead.add(id);
        }

        // Synthesize the shape sendDispositionNotification expects.
        // sendDispositionNotification reads:
        //   - msg_id / id / transfer_id / _id (we provide all)
        //   - sender.uri or from_uri (we provide both via metadata)
        //   - timestamp
        //   - content_type (must NOT be 'application/sylk-message-metadata')
        //   - save_only (we set false so it actually transmits)
        const item = {
            msg_id: id,
            timestamp: message.metadata.timestamp || message.timestamp,
            from_uri: message.metadata.sender ? message.metadata.sender.uri : null,
            metadata: message.metadata,
            content_type: message.contentType || message.content_type,
            disposition_notification: 'display',
            save_only: false,
        };

        // Fire-and-forget — do not await. We want the network call to leave
        // the device immediately; the SQL update inside the success callback
        // is fine to land later.
        try {
            this.sendDispositionNotification(item, 'displayed', true);
        } catch (e) {
            console.log('markAudioMessageDisplayed error', e);
        }
    }

    async loadEarlierMessages(filter) {
        console.log('loadEarlierMessages', filter);
        if (!this.state.selectedContact) {
            return;
        }

        let limit = this.state.messageLimit * this.state.messageZoomFactor;

        if (this.state.selectedContact.totalMessages < limit) {
            this.setState({totalMessageExceeded: true});
			console.log('No more messages for', uri);
            return;
        }

        let messageZoomFactor = this.state.messageZoomFactor;
        messageZoomFactor = messageZoomFactor + 1;
        this.setState({messageZoomFactor: messageZoomFactor, 
                       totalMessageExceeded: false});

        setTimeout(() => {
            this.getMessages(this.state.selectedContact, {category: filter?.category, origin: 'loadEarlier'});
        }, 10);
    }

    resumeTransfers() {
        if (!this.state.selectedContact) {
            return;
        }

        let messages = this.state.messages[this.state.selectedContact.uri]
        messages.forEach((msg) => {
            if (msg.metadata && msg.metadata.paused) {
                console.log('Resume transfer', msg.metadata.transfer_id);
                this.downloadFile(msg.metadata)
            }
        });
    }

    async autoDownloadFile(file_transfer) {
        if (this.state.connectivity == 'mobile' && file_transfer.filesize > 20 * 1000 * 1000) {
        	console.log('autoDownloadFile large file transfer skipped on mobile', file_transfer.transfer_id);
 			return;
        }
  
 		if (this.uploadedFiles.has(file_transfer.transfer_id)) {
        	//console.log('we have uploaded this file, skip autodownload');
			return;
		}
        
 		if (file_transfer.transfer_id in this.downloadRequests) {
        	console.log('downloadFile already in progress', file_transfer.transfer_id);
			return;
		}

 		if (this.state.syncConversations) {
        	console.log('sync in progress');
			return;
		}
    
        let uri = file_transfer.sender.uri === this.state.accountId ? file_transfer.receiver.uri : file_transfer.sender.uri;
        if (file_transfer.local_url) {
            const exists = await RNFS.exists(file_transfer.local_url);
            if (exists) {
                try {
                    const { size } = await ReactNativeBlobUtil.fs.stat(file_transfer.local_url);
                    if (size === 0) {
                        this.deleteMessage(file_transfer.transfer_id, uri);
                    } else {
                        //console.log('File exists local', file_transfer.transfer_id, 'size', size);
						return;
                    }
                } catch (e) {
                    console.log('autoDownloadFile error stat file:', e.message);
                }
            }
        }

        console.log('autoDownloadFile', file_transfer.transfer_id, file_transfer.filename, 'from', file_transfer.sender.uri);

        let difference;
        let now = new Date();
        let until = new Date(file_transfer.until);

        if (now.getTime() > until.getTime()) {
            console.log('File transfer', file_transfer.transfer_id, file_transfer.filename, 'is expired');
            this.deleteMessage(file_transfer.transfer_id, uri, false);
            return;
        }

        if (file_transfer.paused) {
            console.log('File transfer', file_transfer.transfer_id, file_transfer.filename, 'is paused');
            return;
        }

        if (file_transfer.failed) {
            console.log('File transfer', file_transfer.transfer_id, file_transfer.filename, 'is failed:', file_transfer.error);
            return;
        }

        if (file_transfer.timestamp) {
			let ft_ts = new Date(file_transfer.timestamp);
			difference = now.getTime() - ft_ts.getTime();
			let days = Math.ceil(difference / (1000 * 3600 * 24));
	
			if (days < 10) {
				if (utils.isImage(file_transfer.filename, file_transfer.filetype)) {
					this.downloadFile(file_transfer);
				} else {
					if (file_transfer.filesize < max_transfer_size) {
						this.downloadFile(file_transfer);
					} else {
						console.log('--- File transfer', file_transfer.transfer_id, file_transfer.filename, 'is large:', file_transfer);
					}
				}
			} else {
				//console.log('File transfer', file_transfer.transfer_id, 'is', days, 'days old');
			}
        } else {
			this.downloadFile(file_transfer);
        }
    }
    
    async purgeFiles() {
		fixDirectoryStructure(this.state.accountId);
	}

    async downloadFile(file_transfer, force=false, cancel=false) {
        const res = await RNFS.getFSInfo();
        console.log('Download file', file_transfer.url, file_transfer.filesize, force);
        console.log('Available space', Math.ceil(res.freeSpace/1024/1024), 'MB');

        if (res.freeSpace < file_transfer.filesize) {
            this._notificationCenter.postSystemNotification('Not enough free space');
            return;
        }

        let id = file_transfer.transfer_id;
        this.updateTransferProgress(file_transfer.transfer_id, 0, 'download');

        let remote_party = file_transfer.sender.uri === this.state.accountId ? file_transfer.receiver.uri : file_transfer.sender.uri;
        let dir_path = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + remote_party + "/" + id + "/";
        let encrypted = file_transfer.url.endsWith('.asc') ? 1 : 0;

        if (force) {
            this.updateRenderMessageState(id, 'displayed');

            try {
                await RNFS.unlink(dir_path);
                utils.timestampedLog('File transfer directory deleted', dir_path);
                console.log('Deleted', dir_path);
            } catch (err) {
                //console.log('Error removing directory', err.message);
            };

            file_transfer.local_url = null;
            file_transfer.image = null;
            file_transfer.audio = null;
            file_transfer.video = null;
            file_transfer.received = false;
            file_transfer.failed = false;
            file_transfer.error = null;

            if (file_transfer.url.endsWith('.asc') && !file_transfer.filename.endsWith('.asc')) {
                file_transfer.filename = file_transfer.filename + ('.asc');
            }

            this.updateFileTransferSql(file_transfer, encrypted, true);
        }

        await RNFS.mkdir(dir_path);

        //console.log('Made directory', dir_path);

        let file_path = dir_path + "/" + file_transfer.filename;
        let tmp_file_path = file_path + '.tmp';

        if (id in this.downloadRequests && cancel) {
            this.downloadRequests[id].stop();
            console.log('File transfer was in progress, stopped it now', id);
            file_transfer.paused = true;
            file_transfer.error = null;

            this.updateFileTransferSql(file_transfer, encrypted);
			this.deleteTransferProgress(file_transfer.transfer_id);

            delete this.downloadRequests[id];
            return;
        }

        // add a timer to cancel the download
        //console.log('To local storage:', tmp_file_path);

        file_transfer.paused = false;

        try {
            await RNFS.unlink(file_path);
        } catch (err) {
        };

        // console.log('Adding file transfer request id', id, file_transfer.url);
        //this.updateFileTransferBubble(file_transfer, 'Downloading, press to cancel');
        let filesize;
        this.downloadRequests[id] = RNBackgroundDownloader.download({
            id: id,
            url: file_transfer.url,
            destination: tmp_file_path,
        }).begin((tinfo) => {
             if (tinfo.expectedBytes) {
				 console.log('File', file_transfer.filename, 'has', tinfo.expectedBytes, 'bytes');
             }
        }).progress((pdata) => {
            if (pdata && pdata.bytesDownloaded && pdata.bytesTotal) {
				const percent = pdata.bytesDownloaded/pdata.bytesTotal * 100;
				const progress = Math.ceil(percent);
				if (file_transfer.transfer_id in this.downloadRequests) {
					this.updateTransferProgress(file_transfer.transfer_id, progress, 'download');
				}
            }
        }).done(() => {
			ReactNativeBlobUtil.fs.stat(tmp_file_path).then(stat => {
			    filesize = stat.size;
				console.log('Downloaded file', file_transfer.filename, 'has', filesize, 'bytes');
				delete this.downloadRequests[id];

				file_transfer.error = null;
				this.updateFileTransferSql(file_transfer, encrypted);

				this.deleteTransferProgress(file_transfer.transfer_id);

				//this.updateFileTransferBubble(file_transfer);

				RNFS.moveFile(tmp_file_path, file_path).then((success) => {
					this.saveDownloadTask(id, file_transfer.url, file_path);
					if (this.state.callContact) {
						this.getMessages(this.state.callContact, {origin: 'downloadfile'});
					}
				})
				.catch((err) => {
					console.log("Error moving temp file: " + err.message);
					console.log("Source: ", tmp_file_path);
					console.log("Destination: ", file_path);
					file_transfer.local_url = null;
					this.fileTransferStateChanged(id, 'failed', file_transfer);
				});

			}).catch(err => {
				console.log('Getting file size error:', err);
			});

        }).error((error) => {
            console.log('File', file_transfer.filename, 'download failed:', error);
            file_transfer.error = utils.getErrorMessage(error);
            
            if (error && error.error == "not found" ) {
				this.deleteMessage(file_transfer.transfer_id, file_transfer.sender.uri, false);
            }

            if (error && error.errorCode == 404 ) {
				this.deleteMessage(file_transfer.transfer_id, file_transfer.sender.uri, false);
            }
            
			this.deleteTransferProgress(file_transfer.transfer_id);
			this.renderSystemMessage(file_transfer.filename, error, 'incoming');
            this.fileTransferStateChanged(id, 'failed', file_transfer);
            delete this.downloadRequests[id];
            if (error === 'not found') {
                setTimeout(() => {
                    this.deleteMessage(id, remote_party);
                }, 2000);
            }
        });
    }

    /**
     * Stream and decrypt a large PGP .asc file safely
     * @param {string} inputPath - Path to the large .asc file
     * @param {string} outputPath - Path for the decrypted file
     * @param {string} privateKey - Your PGP private key
     */

    async decryptInChunks(file_transfer, outputPath, privateKey) {
        const CHUNK_SIZE = 1024 * 1024; // 1 MB
        let position = 0;
        let insidePGP = false;
        const inputPath = file_transfer.local_url;
        const tempBase64Path = inputPath + '.bin'; // temporary base64 file
        let buffer = [];
        const FLUSH_THRESHOLD = 256 * 1024; // Flush to disk every 64KB of data
        
        // Ensure temp file starts empty
        await RNFS.writeFile(tempBase64Path, '', 'base64');

        let leftover = '';
        let bufferSize = 0;
        
        let id = file_transfer.hash;

		// Track last printed percentage
		let lastPercentPrinted = 0;
		
		// Function to log progress
		function logProgress(transferredBytes, totalBytes) {
		  const percent = Math.floor((transferredBytes / totalBytes) * 100);
		
		  // Only print when crossing a 10% boundary
		  if (percent - lastPercentPrinted >= 10) {
			// Round down to nearest 10%
			const roundedPercent = percent - (percent % 10);
			//console.log(`Progress: ${roundedPercent}%`);
			lastPercentPrinted = roundedPercent;
			return roundedPercent;
		  } else {
			return;

		  }
		}

        const delay = ms => new Promise(res => setTimeout(res, ms));
        while (true) {
			if (id in this.cancelDecryptRequests) {
			    console.log('Abort decryption for', file_transfer.filename);
				delete this.decryptRequests[id];
				delete this.cancelDecryptRequests[id];

				file_transfer.error = 'decryption aborted';
				file_transfer.failed = true;
				
				utils.timestampedLog(file_transfer.error);

				this.updateFileTransferSql(file_transfer, 3);            

				this.deleteTransferProgress(file_transfer.transfer_id);

				//try { await RNFS.unlink(tempBase64Path); } catch (e) { /* ignore */ }
				return;
			} else {
			    if (position == 0) {
    			    this.decryptRequests[id] = file_transfer;
    			}
			}
			
            await delay(10); // This value is in milliseconds

 		    const perc = logProgress(position, file_transfer.filesize);
            if (perc) {
				this.updateTransferProgress(file_transfer.transfer_id, perc, 'decrypt');
 			}
  
            const chunk = await RNFS.read(inputPath, CHUNK_SIZE, position, 'utf8');
            if (!chunk || chunk.length === 0) break;

            position += chunk.length;

            const combined = leftover + chunk;
            // Process the chunk line by line
            const lines = combined.split(/\r?\n/);

            leftover = lines.pop();

            for (let line of lines) {
                if (!insidePGP && line === '-----BEGIN PGP MESSAGE-----') { insidePGP = true; continue; }
                if (!insidePGP) continue;
                if (line === '-----END PGP MESSAGE-----') { insidePGP = false; break; }

                // Skip PGP headers and empty lines
                if (line === '' || line.startsWith('Version') || line.startsWith('Comment') ||
                    line.startsWith('MessageID') || line.startsWith('Hash') || line.startsWith('Charset') ||
                    line.startsWith('=')) {
                    continue;
                }

                buffer.push(line);
                bufferSize += line.length;

                // If buffer gets large, flush to disk
                if (bufferSize >= FLUSH_THRESHOLD) {
                    await RNFS.appendFile(tempBase64Path, buffer.join(''), 'base64');
                    buffer = [];
                    bufferSize = 0;
                }
            }
        }

        // After the loop, process any remaining leftover line
        if (leftover && insidePGP) {
            if (leftover === '' || leftover.startsWith('Version') || leftover.startsWith('Comment') ||
                leftover.startsWith('MessageID') || leftover.startsWith('Hash') || leftover.startsWith('Charset') ||
                leftover.startsWith('=')) {
            } else {
                buffer.push(leftover);
            }
        }
        if (buffer.length > 0) {
            await RNFS.appendFile(tempBase64Path, buffer.join(), 'base64');
        }

        // Decrypt the tempBase64Path file to outputPath
        try {
			delete this.decryptRequests[id];

            //console.log('PGP Base64 extraction complete. Decrypting now...', file_transfer.filename);
            await OpenPGP.decryptFile(tempBase64Path, outputPath, privateKey, null);
            file_transfer.local_url = outputPath;
            file_transfer.filename = file_transfer.filename.slice(0, -4);

            try { await RNFS.unlink(tempBase64Path); } catch (e) { /* ignore */ }
            try { await RNFS.unlink(inputPath); } catch (e) { /* optional cleanup */ }
            this.updateFileTransferSql(file_transfer, 2);
            console.log('Decryption complete:', file_transfer.filename);

        } catch(error) {
            let error_message = error.message;

            if (error.message.indexOf('incorrect key') > -1) {
                error_message = 'Incorrect encryption key';
            }

            if (error.message.indexOf('session key failed') > -1) {
                error_message = 'Incorrect encryption key';
            }

			delete this.decryptRequests[id];

            console.log(error_message);
            file_transfer.error = 'failed: ' + error_message;
            file_transfer.failed = true;

			this.deleteTransferProgress(file_transfer.transfer_id);

            utils.timestampedLog(file_transfer.error);
            this.updateFileTransferSql(file_transfer, 3);            
            try { await RNFS.unlink(tempBase64Path); } catch (e) { /* ignore */ }
        }
    }

    async decryptFile(file_transfer, force=false) {
        console.log('Decrypting file', file_transfer.filename);

        if (!this.state.keys.private) {
            return;
        }

        let content;
        let lines = [];
        let base64_content = '';
        let file_path = file_transfer.local_url;
        let file_path_binary = file_path + '.bin';
        let file_path_decrypted = file_path.slice(0, -4);
        let uri = this.state.accountId === file_transfer.receiver.uri ? file_transfer.sender.uri : file_transfer.receiver.uri;

        let exists = await RNFS.exists(file_path_decrypted);

        if (exists) {
            console.log('File', file_transfer.filename.slice(0, -4), 'is already decrypted');
        }

        exists = await RNFS.exists(file_path);

        if (!exists) {
            this.updateFileTransferSql(file_transfer, 3);
            return;
        } else {
            try {
                const { size } = await ReactNativeBlobUtil.fs.stat(file_path);
                if (size !== file_transfer.filesize) {
                    //file_transfer.error = 'Wrong file size';
                    //this.updateFileTransferSql(file_transfer, 3);
                    this.renderSystemMessage(uri, 'Wrong file size ' + size + ', on server is ' + file_transfer.filesize, 'outgoing', new Date());
                    //return;
                }
            } catch (e) {
                consolo.log('Error stat file:', e.message);
                file_transfer.error = 'Cannot stat local file';
                this.updateFileTransferSql(file_transfer, 3);
                return;
            }
        }

        if (force) {
    		await this.updateFileTransferSql(file_transfer, 1, true);
		}

		//this.updateFileTransferBubble(file_transfer, 'Decrypting ' + file_transfer.filename + ', press to cancel...');
		//console.log('---');
		//console.log(this.decryptRequests);
		
		if (file_transfer.hash in this.decryptRequests) {
		    console.log('Already being decrypted...');
			this.cancelDecryptRequests[file_transfer.hash] = file_transfer;
		} else {
			await this.decryptInChunks(file_transfer, file_path_decrypted, this.state.keys.private);
		}
    }

    async decryptMessage(message, updateContact=false) {
        // encrypted
        // 0 not encrypted
        // null not encrypted
        // 1 encrypted content
        // 2 decrypted content
        // 3 failed to decrypt

        if (!this.state.keys.private) {
            return;
        }

		await this.waitForContactsLoaded();

        let id = message.msg_id;
        let decryptingMessages = this.state.decryptingMessages;

        let msg;
        let pending_messages = [];
        let idx;
        let uri = message.direction === 'incoming' ? message.from_uri : message.to_uri;
        let messages = this.state.messages;
        let render_messages = messages[uri];
        
        //console.log('decryptMessage', id);

        await OpenPGP.decrypt(message.content, this.state.keys.private).then((content) => {
            utils.timestampedLog('Message', id, 'decrypted');
            if (uri in decryptingMessages) {
                pending_messages = decryptingMessages[uri];
                idx = pending_messages.indexOf(id);
                if (pending_messages.length > 10) {
                    let status = 'Decrypting ' + pending_messages.length + ' messages with';
                    //this._notificationCenter.postSystemNotification(status, {body: uri});
                } else if (pending_messages.length === 10) {
                    //let status = 'All messages decrypted';
                    //this._notificationCenter.postSystemNotification(status);
                }
                if (idx > -1) {
                    pending_messages.splice(idx, 1);
                    decryptingMessages[uri] = pending_messages;
                    this.setState({decryptingMessages: decryptingMessages});
                }
            }

			let contact = this.lookupContact(uri);

            if (updateContact && contact) {
                //console.log('Update contact after decryption', uri);

                if (this.mustPlayIncomingSoundAfterSync) {
                    if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
                        this.playMessageSound('incoming');
                        // don't play message if inside the same chat
                    } else {
                        this.playMessageSound('incoming');
                    }
                    this.mustPlayIncomingSoundAfterSync = false;
                }

                if (message.timestamp > contact.timestamp) {
					const _lm = this.buildLastMessage(message);
					if (_lm != null) {
						if (message.contentType?.startsWith('text/')) {
							selectedContact.lastMessage = _lm;
						}
						contact.lastMessage = _lm;
						contact.lastMessageId = message.id;
					}
                    contact.timestamp = message.timestamp;
                    this.saveSylkContact(uri, contact, 'decryptMessage');
                }
            }

            if (uri in messages) {
                if (message.content_type === 'text/html') {
                    content = utils.cleanHtml(content);
                } else if (message.content_type === 'text/plain') {
                    content = content;
                } else if (message.content_type.indexOf('image/') > -1) {
					const imageUri = `data:${message.content_type};base64,${content}`;
					const isValid = validateBase64Image(imageUri);
					if (isValid) {
						message.image = imageUri;
					} else {
						content = 'Broken image';
					}
                }

                msg = utils.sql2GiftedChat(message, content);
                msg = unwrapMessage(msg);

                render_messages.push(msg);
                messages[uri] = render_messages;
                if (pending_messages.length === 0) {
                    if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
                        this.confirmRead(uri, 'decryptMessage');
                    }
                    this.setState({message: messages});
                }
            }

            let params = [content, id, this.state.accountId];
            this.ExecuteQuery("update messages set encrypted = 2, content = ? where msg_id = ? and account = ?", params).then((result) => {
                if (this.state.selectedContact && this.state.selectedContact.uri === uri && pending_messages.length === 0) {
                    this.confirmRead(uri, 'sql saved read');
                }
            }).catch((error) => {
                console.log('SQL message update error:', error);
            });

        }).catch((error) => {
            console.log('Error decrypting message', id, error.message);
            let params = [id, this.state.accountId];
            this.ExecuteQuery("update messages set encrypted = 3 where msg_id = ? and account = ?", params).then((result) => {

            }).catch((error) => {
                console.log('SQL message update error:', error);
            });


            let error_message = error.message;
            if (error.message.indexOf('incorrect key') > -1) {
                error_message ='Invalid encryption key, sender must resend the message';
            }

            if (message.from_uri !== this.state.accountId) {
                console.log('Broken', message.direction, message.from_uri);
                msg = utils.sql2GiftedChat(message, error_message);
				msg = unwrapMessage(msg);
                msg.received = 0;
                msg.failed = 1;
                msg.encrypted = 3;
                render_messages.push(msg);
                messages[uri] = render_messages;
                this.setState({message: messages});
            }
        });
    }

    lookupPublicKey(contact) {
        console.log('lookupPublicKey', contact.uri);
        
        if (this.lastLookupKey == contact.uri) {
			return;
        }        

        if (contact.uri.indexOf('@guest') > -1) {
            return;
        }

        if (contact.uri.indexOf('anonymous@') > -1) {
            return;
        }

        if (contact.tags.indexOf('test') > -1) {
            return;
        }

        if (!this.state.connection) {
            return;
        }

		this.state.connection.lookupPublicKey(contact.uri);
		this.lastLookupKey = contact.uri;

		// Push our own PGP public key to cross-domain contacts only.
		// Same-domain peers don't need it: a server-side lookupPublicKey
		// is authoritative on our own domain, so if their key exists the
		// lookup returns it, and if it doesn't exist there's nothing for
		// us to do. Cross-domain peers can't be looked up that way, so
		// we hand them ours directly. Done at most once per app run per
		// URI to avoid re-sending on every chat re-open.
		const myDomain = this.state.accountId
			? this.state.accountId.split('@')[1]
			: null;
		const peerDomain = contact.uri.split('@')[1];
		if (myDomain && peerDomain && peerDomain !== myDomain
				&& !this.sentPublicKeyUris.has(contact.uri)) {
			this.sendPublicKeyToUri(contact.uri);
			this.sentPublicKeyUris.add(contact.uri);
		}
    }

    isMessageAllowed(content_type, content) { 
		if (content_type === 'text/plain' && content.indexOf('File transfer available at') > -1 && content.indexOf('/webrtcgateway/filetransfer/') > -1) {
			return false;
		}
		return true;
	}

	getAllContactUris(contact) {
		return [...new Set([
			contact.uri,
			...(Array.isArray(contact.uris) ? contact.uris : [])
		].filter(Boolean))];
	}

    async contactsCount() {
        let query = "SELECT count(*) as rows FROM contacts where account = ?";
        let rows;
        let total;

        await this.ExecuteQuery(query, [this.state.accountId]).then((results) => {
            rows = results.rows;
            total = rows.item(0).rows;
            console.log(total, 'total contacts');
        }).catch((error) => {
            console.log('SQL error:', error);
        });
    }

    async getMessages(obj, filter={pinned: false, category: null, text:null, contentType: null}) {

        let uri = obj.id ? obj.uri : obj;
        let contact = obj;
        await this.waitForContactsLoaded();
        
        if (!obj.id) {
            contact = this.lookupContact(uri, true);
        } 
               
        console.log('-- Get messages', uri, filter, 'zoom', this.state.messageZoomFactor);
        let pinned = filter && 'pinned' in filter ? filter['pinned'] : false;
        let category = filter && 'category' in filter ? filter['category'] : null;
        
        let has_filter = pinned || category;

        let messages = this.state.messages;

        let msg;
        let query;
        let rows = 0;
        let total = 0;
        let last_messages = [];
        let orig_uri;
        let localpath;
        let filteredMessageIds = [];
		let messagesMetadata = {};
		let fixed_local_url;

        if (!uri) {
            query = "SELECT count(*) as rows FROM messages where account = ? and ((from_uri = ? and direction = 'outgoing') or (to_uri = ? and direction = 'incoming'))";
            await this.ExecuteQuery(query, [this.state.accountId, this.state.accountId, this.state.accountId]).then((results) => {
                rows = results.rows;
                total = rows.item(0).rows;
                console.log(total, 'total messages');
            }).catch((error) => {
                console.log('SQL error:', error);
            });
            return;
        }

        orig_uri = uri;

        let limit = this.state.messageLimit * this.state.messageZoomFactor;
        let uris = this.getAllContactUris(contact);
        const placeholders = uris.map(() => '?').join(', ');

        console.log('Get messages with', contact.id, uris.join(', '), 'with zoom factor', this.state.messageZoomFactor);
        
        query = `
		SELECT count(*) as rows FROM messages WHERE account = ? AND 
		((from_uri = ? AND to_uri IN (${placeholders})) OR (from_uri IN (${placeholders}) AND to_uri = ?))`;

        if (pinned) {
            query = query + ' and pinned = 1';
        }

        if (category && category !== 'text') {
            query = query + " and metadata != ''";
        }

		params = [
			this.state.accountId,
			this.state.accountId,
			...uris,
			...uris,
			this.state.accountId
		];

        await this.ExecuteQuery(query, params).then((results) => {
            rows = results.rows;
            total = rows.item(0).rows;
            console.log('Total', total, 'messages exhanged with', uris.join(', '));
        }).catch((error) => {
            console.log('SQL error:', error);
        });
        
		contact.totalMessages = total;

        query = `SELECT rowid, * FROM messages WHERE account = ? AND 
        ((from_uri = ? AND to_uri IN (${placeholders})) OR (from_uri IN (${placeholders}) AND to_uri = ?))`;

        if (pinned) {
            query = query + ' and pinned = 1';
        }

        if (category && category !== 'text') {
            query = query + " and metadata != ''";
        }

        query = query + ' order by unix_timestamp desc limit ?, ?';
		params = [
			this.state.accountId,
			this.state.accountId,
			...uris,
			...uris,
			this.state.accountId,
			this.state.messageStart, 
			limit
		];

		await this.ExecuteQuery(query, params).then(async (results) => {
            console.log('SQL get messages, rows =', results.rows.length);
            let rows = results.rows;
            messages[orig_uri] = [];
            let content;
            let ts;
            let last_message;
            let last_message_id;
            let last_direction;
            let messages_to_decrypt = [];
            let decryptingMessages = {};
            let msg;
            let enc;
            let file_path;
            let file_transfer;
            let contentTypes = {};
            let foundMetadata = false;
            let metadataTimstamps = {};
			let metadataContent;
			let oldMetadataContent;
			let mId;
			let related_msg_id;
			let related_action;
			let updateOriginal = false;

            let last_content = null;

			let now = new Date();
            let ft_ts;
			let ft_difference;
			let ft_days;

            for (let i = 0; i < rows.length; i++) {
                try {
					var item = rows.item(i);

	                if (!item.msg_id) {
						console.log('Skip broken item without msg_id', item.rowid);
						//this.deleteRawMessage(item.rowid);
						continue;
					}
	
					content = item.content;
					if (!content) {
						content = 'Empty message...';
					}

					let timestamp;
					last_message = null;
					last_message_id = null;
	
					let unix_timestamp;
	
					if (item.unix_timestamp === 0) {
						timestamp = JSON.parse(item.timestamp, _parseSQLDate);
						unix_timestamp = Math.floor(timestamp / 1000);
						item.unix_timestamp = unix_timestamp;
						this.ExecuteQuery('update messages set unix_timestamp = ? where msg_id = ?', [unix_timestamp, item.msg_id]);
					} else {
						timestamp = new Date(item.unix_timestamp * 1000);
					}
	
					const broken_envelope = content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') === -1;
					
					if (broken_envelope) {
					    console.log('Message PGP envelope is broken', item.msg_id);
					    enc = 3;
					    item.encrypted = 3;
					} else {
						enc = parseInt(item.encrypted);
					}

					const is_encrypted = content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') > -1;

					//console.log(" - SQL message:", timestamp, item.content_type, item.direction, content.substring(0, 200));
					
					if (!this.isMessageAllowed(item.content_type, content)) {
						continue;
					}
													
					if (is_encrypted && enc !== 3) {
						contact.totalMessages = contact.totalMessages - 1;
						if (item.encrypted === null) {
							item.encrypted = 1;
						}
	
						/*
						 encrypted:
						 1 = unencrypted
						 2 = decrypted
						 3 = failed to decrypt message
						*/
	
						if (!(uri in decryptingMessages)) {
							decryptingMessages[orig_uri] = [];
						}
						try {
							decryptingMessages[orig_uri].push(item.msg_id);
							messages_to_decrypt.push(item);
						} catch (e) {
						    console.log('Error adding decryptingMessages', e);
						}
					} else {
						if (enc === 3 || broken_envelope) {
						    if (item.content_type.indexOf('image/') > -1) {
								content = 'Broken image';
							} else {
								content = 'Broken message';
							}
							console.log(content, item.msg_id);
						} else if (item.content_type === 'text/html') {
							content = utils.cleanHtml(content);
							//console.log('message HTML', item.msg_id, item.content_type);

						} else if (item.content_type === 'text/plain') {
							content = content;
							if (content.indexOf('call') === -1) {
								//console.log(timestamp, enc, item.msg_id, 'message content', content, );
							}
						} else if (item.content_type === 'application/sylk-file-transfer') {
							content = content;
						} else if (item.content_type.indexOf('image/') > -1) {
							const imageUri = `data:${item.content_type};base64,${content}`;
							const isValid = await validateBase64Image(imageUri);
							if (isValid) {
								item.image = imageUri;
							} else {
								content = 'Broken image';
							}
						} else if (item.content_type === 'application/sylk-contact-update') {
							contact.totalMessages = contact.totalMessages - 1;
							console.log('Remove update contact message', item.id);
							this.ExecuteQuery('delete from messages where msg_id = ?', [item.msg_id]);
							continue;
						} else if (item.content_type === 'text/pgp-public-key-imported') {
							continue;
						} else if (item.content_type === 'application/sylk-message-metadata') {
						
							const uri = orig_uri;
							let metadataContent;
							try {
								metadataContent = JSON.parse(item.content);
							} catch (err) {
								console.log("Cannot parse metadata message:", item.content, item);
								continue;
							}

							//console.log("Loaded metadata from SQL:", item.msg_id, metadataContent.action, metadataContent.value, 'for msg', item.related_msg_id, item.related_action);

							const value = metadataContent.value;
							metadataContent.author = item.from_uri;

							// Live-location origin row: this row is the "last
							// known position" blob for a sharing session (see
							// saveOutgoingMessageSqlBatch / saveIncomingMessage,
							// where follow-up ticks UPDATE the origin's content
							// in place). Synthesize a bubble so reopening the
							// conversation restores the map.
							// Detection: the row's msg_id matches metadataContent.messageId
							// (both equal the origin tick's envelope id).
							//
							// Peer-coords recovery: `content` column holds the
							// last tick's raw payload (own coords only). The
							// `metadata` column is independently stamped by
							// _persistPeerCoordsToSql with the paired {peerCoords,
							// distanceMeters} fields — those don't ride on the
							// tick stream so they'd otherwise be lost on chat
							// re-entry. Merge them onto metadataContent here so
							// the restored bubble shows BOTH pins and the
							// distance strip, matching what the user saw before
							// switching chats.
							if (metadataContent.action === 'location'
								&& item.msg_id === metadataContent.messageId
								&& typeof item.metadata === 'string'
								&& item.metadata.length > 0) {
								try {
									const storedMeta = JSON.parse(item.metadata);
									if (storedMeta && typeof storedMeta === 'object') {
										if (storedMeta.peerCoords
												&& typeof storedMeta.peerCoords.latitude === 'number'
												&& typeof storedMeta.peerCoords.longitude === 'number') {
											metadataContent.peerCoords = storedMeta.peerCoords;
										}
										if (typeof storedMeta.distanceMeters === 'number') {
											metadataContent.distanceMeters = storedMeta.distanceMeters;
										}
									}
								} catch (e) {
									// Non-JSON / legacy row — fall through with
									// just the own-coords bubble. Peer pin will
									// re-appear on the next tick + propagate.
								}
							}
							if (metadataContent.action === 'location'
								&& item.msg_id === metadataContent.messageId) {
								const direction = item.direction
									|| (item.from_uri === this.state.accountId ? 'outgoing' : 'incoming');

								// Apply the same meeting-session dedup as
								// _injectLocationBubble so SQL restore after a
								// reconnect / chat-reopen doesn't resurrect the
								// acceptance-leg bubble that the live path
								// already skipped.
								//
								// Requester side: an INCOMING reply whose
								// in_reply_to is one of our outgoing meeting
								// request ids.
								// Accepter side: an OUTGOING reply whose
								// in_reply_to is a request we explicitly
								// accepted.
								const inReplyTo = metadataContent.in_reply_to;
								if (inReplyTo) {
									if (direction === 'incoming'
										&& this.myOutgoingMeetingRequestIds
										&& this.myOutgoingMeetingRequestIds.has(inReplyTo)) {
										console.log('[location] SQL restore: skip — incoming reply to our own request',
											'msg_id=', item.msg_id, 'in_reply_to=', inReplyTo);
										continue;
									}
									if (direction === 'outgoing'
										&& this.acceptedMeetingRequestIds
										&& this.acceptedMeetingRequestIds.has(inReplyTo)) {
										console.log('[location] SQL restore: skip — outgoing reply to a request we accepted',
											'msg_id=', item.msg_id, 'in_reply_to=', inReplyTo);
										continue;
									}
								}

								const createdAt = metadataContent.timestamp
									? new Date(metadataContent.timestamp)
									: new Date(item.unix_timestamp * 1000);
								const locBubble = {
									_id: item.msg_id,
									key: item.msg_id,
									createdAt: createdAt,
									contentType: 'application/sylk-live-location',
									metadata: metadataContent,
									text: String(createdAt.getTime()),
									direction: direction,
									user: direction === 'incoming'
										? { _id: item.from_uri, name: item.from_uri }
										: {},
								};
								if (orig_uri in messages
									&& !messages[orig_uri].some(m => m._id === locBubble._id)) {
									console.log('[location] Restoring live-location bubble from SQL',
										item.msg_id, 'direction=', direction);
									messages[orig_uri].push(locBubble);
								}
							}

							const messageId = metadataContent.messageId;
						    if (messageId) {
								// Ensure array exists for this messageId
								if (!Array.isArray(messagesMetadata[messageId])) {
									messagesMetadata[messageId] = [];
								}
										
								// Ensure the container exists
								if (messageId && !messagesMetadata[messageId]) {
									messagesMetadata[messageId] = [];
								}
								
								const metaArray = messagesMetadata[messageId];
								const action = metadataContent.action;
								//console.log("---- Loaded metadata from SQL:", item.msg_id, action, value, 'for message', messageId);
								//console.log('---- messagesMetadata', metadataContent);
								
								/*
								const existingTargetMsg = messages[orig_uri].find(m => m._id === messageId);
								if (!existingTargetMsg) {
									console.log('Original message', messageId, 'does not exist', item.from_uri);
									//console.log(messages[orig_uri]);
									//this.deleteMessage(item.msg_id, item.from_uri);
									//continue;
								}
								*/
								
								// Find an existing metadata object with the same action
								let existingIndex = metaArray.findIndex(item => item.action === action);
								updateOriginal = false;
								
								if (existingIndex >= 0) {
									const existingItem = metaArray[existingIndex];
								
									if (action === 'consumed') {
										// Only overwrite consumed if the new value is higher
										if (metadataContent.value > (existingItem.value || 0)) {
											metaArray[existingIndex] = metadataContent;
											updateOriginal = true;
										}
									} else {
										// For other actions (rotation, label, reply)
										const oldTimestamp = existingItem.timestamp;
										const newTimestamp = metadataContent.timestamp;
								
										if (newTimestamp && !oldTimestamp) {
											// New has timestamp, old doesn't -> overwrite
											metaArray[existingIndex] = metadataContent;
											updateOriginal = true;
										} else if (newTimestamp && oldTimestamp) {
											// Both have timestamps -> overwrite only if new is later
											if (newTimestamp > oldTimestamp) {
												metaArray[existingIndex] = metadataContent;
												updateOriginal = true;
											} else {
												this.deleteMessage(item.msg_id, item.to_uri);
											}
										}
										// If new has no timestamp and old has -> keep old
										// If neither has timestamp -> overwrite (optional, or keep old)
									}
								} else {
									// No existing metadata for this action -> append
									metaArray.push(metadataContent);
									updateOriginal = true;
								}
	
								if (updateOriginal && orig_uri in messages) {
									const targetId = metadataContent.messageId;
									const existingMsg = messages[orig_uri].find(m => m._id === targetId);
								
									if (existingMsg && messagesMetadata[targetId]) {
										for (const meta of messagesMetadata[targetId]) {
											existingMsg[meta.action] = meta.value;
										}
									}
								}
							}
							
							//console.log('Final meta array', metaArray);

							foundMetadata = true;
							continue;

						} else {
							console.log('Unknown message', item.msg_id, 'type', item.content_type);
							contact.totalMessages = contact.totalMessages - 1;
							//this.deleteMessage(item.msg_id, item.to_uri);
							continue;
						}
						
						if (last_content == content && last_direction == item.direction) {
							contact.totalMessages -= 1;
							continue;
						}

						last_direction = item.direction;
						last_content = content;

						msg = await utils.sql2GiftedChat(item, content, filter);
						
						//console.log('--- SQL msg content', msg._id, msg.contentType, msg.html, msg.text);
						
						// Prevent crash when msg is null
						if (!msg) {
							contact.totalMessages -= 1;
							continue;
						}

						if (msg.metadata?.filename) {
							this.checkFileTransfer(msg);
							//console.log('SQL metadata',  JSON.stringify(msg.metadata, null, 2));
						}
	
						if (!msg) {
							contact.totalMessages = contact.totalMessages - 1;
							continue;
						}
		
						if (msg.audio) {
							contentTypes['audio'] = true;
						} else if (msg.image) {
							contentTypes['image'] = true;
						} else if (msg.video) {
							contentTypes['video'] = true;
						} else {
							contentTypes['text'] = true;
						}
	
						if (msg.pinned) {
							contentTypes['pinned'] = true;
						}
						
						if (orig_uri in messages) {
							messages[orig_uri].push(msg);
						}
					    
					    //console.log("---- Loaded message from SQL:", msg._id);
						
						if (pinned || category) {
							filteredMessageIds.push(msg._id);
						}
	
						if (msg.metadata && msg.metadata.filename) {
						    //console.log(msg.metadata.filename);
							if (msg.metadata.paused) {
								contentTypes['paused'] = true;
							}
		
							if (msg.metadata.failed) {
								contentTypes['failed'] = true;
							}
							
							ft_ts = new Date(msg.metadata.timestamp);
							ft_difference = now.getTime() - ft_ts.getTime();
							ft_days = Math.ceil(ft_difference / (1000 * 3600 * 24));

							if (ft_days < 10 && !msg.metadata.local_url) {
								this.autoDownloadFile(msg.metadata);
							}
						}
						
					}
				} catch (e) {
					try {
						console.log('SQL row error',
							'rowid=', item && item.rowid,
							'msg_id=', item && item.msg_id,
							'content_type=', item && item.content_type,
							'direction=', item && item.direction,
							'error=', e && e.message ? e.message : e);
					} catch (logErr) {
						console.log('SQL row error (and log failed)', e);
					}
					// skip this one row, keep loading the rest
					continue;
				}
			}

			Object.keys(this.state.incomingMessage).forEach((key) => {
				const msg = this.state.incomingMessage[key];
				if (key in messages) {
					// Check if the message already exists
					const exists = messages[key].some(m => m._id === msg._id);
					if (!exists) {
					    if (msg.contentType !== 'application/sylk-file-transfer') {
					    	if (this.isMessageAllowed(msg.content_type, msg.content)) {
								console.log('Added synthetic message from push', key, msg);
								messages[key].push(msg);
							}
						}
					}
				}
			});

			this.setState({filteredMessageIds: filteredMessageIds, contentTypes: contentTypes});

			// Guard against `messages[orig_uri]` being undefined — can
			// happen when the SQL result set had no rows for this
			// contact (e.g. all of them were purged by the `expire`
			// sweep, or it's a freshly-created contact with no history
			// yet). Previously this threw
			//   "Cannot read property 'reverse' of undefined"
			// and aborted the whole getMessages() resolution.
			last_messages = messages[orig_uri] || [];
			last_messages.reverse();
			let last_message_ts;
			if (last_messages.length > 0) {
				last_messages.forEach((last_item) => {
					try {
						const ct = last_item && last_item.contentType;
						const txt = (last_item && typeof last_item.text === 'string') ? last_item.text : '';
						if (ct && typeof ct === 'string' && ct.startsWith('text/') &&
							txt.indexOf(' call ended ') === -1 &&
							txt.indexOf('Public key received') === -1) {
							const _lm = this.buildLastMessage(last_item);
							if (_lm != null) {
								last_message = _lm;
							}
						}
						last_message_id = last_item && last_item._id;
						//console.log('new last_message_id', last_message_id);
						last_message_ts = last_item && last_item.createdAt;
					} catch (e) {
						console.log('last_messages row error', e, last_item && last_item._id);
					}
				});
			}

			if (contact && !has_filter && last_message && last_message !== 'Public key received') {
				if (contact.timestamp !== last_message_ts) {
					if ((!contact.timestamp && last_message_ts) || (contact.timestamp && last_message_ts && contact.timestamp < last_message_ts)) {
						console.log('contact.timestamp', contact.timestamp, 'is older than message ts', last_message_ts);
						contact.timestamp = last_message_ts;
						contact.lastMessageId = last_message_id;
						contact.lastMessage = last_message;
						this.saveSylkContact(uri, contact, 'getMessages');
						this.addJournal(uri, 'readConversation');
						contact.messagesMetadata = {...messagesMetadata};
						this.updateContactInState(contact);
					}
				}
			}

			let i = 1;
			messages_to_decrypt.forEach((item) => {
				var updateContact = messages_to_decrypt.length === i;
				this.decryptMessage(item, updateContact);
				i = i + 1;
			});

			console.log('Loaded', (messages[orig_uri] || []).length, 'messages exchanged with', uri);
			this.setState({messages: messages,
						   messagesMetadata: messagesMetadata,
						   decryptingMessages: decryptingMessages
			});

        }).catch((error) => {
            console.log('getMessages SQL error:', error);
        });
    }

    async getTransferedFiles(uri, filter) {
        if (this.unmounted) {
			return;
        }

        if (!uri) {
			return;
        }

        console.log('-- Get files for', uri, filter);
        
		let metadata;
		let transferedFiles = {'audios': [], 'videos': [], 'photos': [], 'others': []};
		let transferedFilesSizes = {'audios': 0, 'videos': 0, 'photos': 0, 'others': 0};
		let transferedFolderSizes = {'audios': 0, 'videos': 0, 'photos': 0, 'others': 0};
		
		let found = 0;

        let query = "SELECT * FROM messages where account = ? and metadata != '' and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?)) ";
        let params = [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId];

        let { incoming = true, outgoing = true, period = null, periodType = 'after' } = filter || {};

		incoming = filter?.incoming || incoming;
		outgoing = filter?.outgoing || outgoing;
		period = filter?.period || period;
		periodType = filter?.periodType || periodType;
		
		const results = await this.ExecuteQuery(query, params);
		
		let rows = results.rows;
		console.log('Got', rows.length);
		for (let i = 0; i < rows.length; i++) {
		   try {
			   var item = rows.item(i);
			   timestamp = new Date(JSON.parse(item.timestamp, _parseSQLDate));
				
			   if (period) {
				   if (periodType == 'before') {
						if (timestamp > period) {
						   //console.log('Skip newer'); 
						   continue;
						}
					} else {
						if (timestamp < period) {
						   //console.log('Skip older');
						   continue;
						}
					}
			   }

			   console.log('FT', item.msg_id, timestamp, item.direction);

			   if (!incoming && item.direction === 'incoming') {
				   //console.log('skip incoming');
				   continue;
			   }

			   if (!outgoing && item.direction === 'outgoing') {
				   //console.log('skip outgoing');
				   continue;
			   }

			   metadata = JSON.parse(item.metadata);
			   if (!('local_url' in metadata)) {
				   continue;
			   }

			   const filename = metadata.local_url.split('/').pop();
			   const filesize = metadata.filesize || metadata.size;
			   const parts = metadata.local_url.split('/').filter(Boolean);
			   const folderName = '/' + parts.slice(0, -1).join('/') + '/';
			   const folderPath = Platform.OS === "android" ? 'file://' + folderName : folderName;
				
			   let folderSize = filesize;

			   try {
				   folderSize = await utils.getFolderSize(folderPath);
			   } catch (e) {
				   console.log('Error getting folder size', folderPath, e);
				   folderSize = 0;
			   }
			   
			   if (utils.beautySize(filesize) != utils.beautySize(folderSize)) {
				   console.log('FT file and folder sizes differ', filename, utils.beautySize(filesize), utils.beautySize(folderSize));
				   console.log(' -- FT Folder', folderPath);
				   
				   if (!filename.endsWith('.asc')) {
				       const fileExists = await RNFS.exists(metadata.local_url);
				       const encFilename = metadata.local_url + ".asc"; 
				       const encryptedFileExists = await RNFS.exists(encFilename);
				       if (encryptedFileExists && fileExists) {
						   console.log('Delete encrypted file', encFilename);
						   try { await RNFS.unlink(encFilename); } catch (e) { /* optional cleanup */ }
				       }
				   }
				   
                   // scan what files take space: 
				   await utils.getFolderSize(folderPath, true);
			   }
			   
			   // Note: itemSize must be `let` — the branch below reassigns it
			   // when the on-disk folder is missing (already deleted). Using
			   // `const` here threw: TypeError: "itemSize" is read-only.
			   let itemSize = folderSize > filesize ? folderSize : filesize;

			   if (folderSize == 0) {
				   itemSize = 0;
			   }
			   
			   if (metadata.filetype.toLowerCase().startsWith('image/')) {
				   transferedFiles['photos'].push(item.msg_id);
				   if (filesize) {
					   transferedFilesSizes['photos'] = transferedFilesSizes['photos'] + itemSize;
					   transferedFolderSizes['photos'] = transferedFolderSizes['photos'] + folderSize;
				   }
			   } else if (metadata.filetype.toLowerCase().startsWith('audio/')) {
				   transferedFiles['audios'].push(item.msg_id);
				   if (filesize) {
					   transferedFilesSizes['audios'] = transferedFilesSizes['audios'] + itemSize;
					   transferedFolderSizes['audios'] = transferedFolderSizes['audios'] + folderSize;
				   }
			   } else if (metadata.filetype.toLowerCase().startsWith('video/')) {
				   transferedFiles['videos'].push(item.msg_id);
				   if (filesize) {
					   transferedFilesSizes['videos'] = transferedFilesSizes['videos'] + itemSize;
					   transferedFolderSizes['videos'] = transferedFolderSizes['videos'] + folderSize;
				   }
			   } else {
				   transferedFiles['others'].push(item.msg_id);
				   if (filesize) {
					   transferedFilesSizes['others'] = transferedFilesSizes['others'] + itemSize;
					   transferedFolderSizes['others'] = transferedFolderSizes['others'] + folderSize;
				   }
			   }

			   found = found + 1;

		   } catch (e) {
			   console.log('getTransferedFiles row error:', e);
			   continue;
		   }
		}
		
		console.log('transferedFilesSizes', transferedFilesSizes);
		console.log('transferedFolderSizes', transferedFolderSizes);
		
		let tf = 0;
		let td = 0;
		let nf = 0;

		for (const key of Object.keys(transferedFiles)) {
			const fs = utils.beautySize(transferedFilesSizes[key]);
			td = td + transferedFolderSizes[key];
			tf = tf + transferedFilesSizes[key];
			nf = nf + transferedFiles[key].length;
			if (transferedFiles[key].length) {
				console.log('Total FT', key, transferedFiles[key].length, fs);
			}
		}

		console.log(nf, 'total FT file and folders sizes', utils.beautySize(tf), utils.beautySize(td));
		this.setState({transferedFiles: transferedFiles, transferedFilesSizes: transferedFilesSizes});
    }
    
    async deleteFiles(uri, ids=[], remote=false, filter={}) {
        console.log('Delete files for', uri, ids, filter);
        let metadata;
        let message_ids = [];
  	    var todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        
        let query = "SELECT * FROM messages where account = ? and metadata != '' and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?)) ";       
        await this.ExecuteQuery(query, [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId]).then((results) => {
            let rows = results.rows;
            //console.log(rows.length, 'transfers found');
            for (let i = 0; i < rows.length; i++) {
               var item = rows.item(i);
               if (ids.indexOf(item.msg_id) === -1) {
                   continue;
               }

			   //console.log('Delete file transfer id', item.msg_id);
			   this.deleteMessage(item.msg_id, uri, remote);
            }

        }).catch((error) => {
            console.log('deleteFiles SQL error:', error);
        });
    }

    // AppStore GPS Review — bulk-delete messages for a conversation. When
    // the user clears a contact's history, any stored GPS/location rows
    // (origin ticks, announcements) are removed from SQL along with the
    // rest of the conversation.
    async deleteMessages(uri, remote=false, filter={}) {
        let messages = {...this.state.messages};
        let timestamp;
        let purgeMessages = [];
        let deleteAll = filter.deleteContact && !filter.simulate
        let uris = [uri];
        let query;

        if (filter.selectedContact) {
			uris = this.getAllContactUris(filter.selectedContact);
        }

        console.log('Delete messages for', uris, 'remote', remote);
       
        if (filter.wipe) {
			this.wipe_device();
			return;
        }
       
        if (filter.incoming && filter.outgoing && !filter.period && !filter.simulate) {
			deleteAll = true;
        }

		for (const uri of uris) {
			let orig_uri = uri;
	
			if (uri.indexOf('@') === -1 && utils.isPhoneNumber(uri)) {
				uri = uri + '@' + this.state.defaultDomain;
			}
			
			if (deleteAll) {
				console.log('Delete all messages exchanged with', uri);
				if (uri.indexOf('@guest.') === -1 && uri.indexOf('@videoconference.') === -1 && remote) {
					this.addJournal(orig_uri, 'removeConversation');
				}
	
				let dir = RNFS.DocumentDirectoryPath + '/conference/' + uri + '/files';
				RNFS.unlink(dir).then((success) => {
					console.log('Removed folder', dir);
				}).catch((err) => {
					///console.log('Error deleting folder', dir, err.message);
				});

				let contact_path = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + uri;
				RNFS.unlink(contact_path).then((success) => {
					console.log('Removed folder', contact_path);
				}).catch((err) => {
					///console.log('Error deleting folder', dir, err.message);
				});
	
				if (orig_uri in messages) {
					delete messages[orig_uri];
					this.setState({messages: {...messages}});
				}
			}
		}
		
		if (filter.deleteContact) {
			this.removeContact(filter.selectedContact);
		}

		let params = [
			this.state.accountId,
			this.state.accountId,
			...uris,
			...uris,
			this.state.accountId
		];

        const placeholders = uris.map(() => '?').join(', ');

        if (deleteAll) {
			query = `Delete FROM messages WHERE account = ? AND 
			((from_uri = ? AND to_uri IN (${placeholders})) OR (from_uri IN (${placeholders}) AND to_uri = ?))`;

			await this.ExecuteQuery(query, params).then((result) => {
				if (result.rowsAffected) {
					console.log('SQL deleted', result.rowsAffected, 'messages');
				}
			}).catch((error) => {
				console.log('SQL deleteMessagesSQL error:', error);
			});
			
			return;
        }

        
        query = `SELECT * FROM messages WHERE account = ? AND 
        ((from_uri = ? AND to_uri IN (${placeholders})) OR (from_uri IN (${placeholders}) AND to_uri = ?))`;

        await this.ExecuteQuery(query, params).then((results) => {
            let rows = results.rows;
            let metadata;

			console.log(rows.length || 'No', 'messages found');

            for (let i = 0; i < rows.length; i++) {
               var item = rows.item(i);
               try {
                   timestamp = new Date(JSON.parse(item.timestamp, _parseSQLDate));
	   		   } catch (error) {
				   console.log('parse timestamp error:', error);
				   continue;
			   }
               
               if (!filter.deleteContact) {
 				   try {
                       metadata = JSON.parse(item.metadata);
					   if (metadata.local_url) {
					       console.log('skip file transfer because deleteContact is false');
						   continue;
					   }
				   } catch (e) {
					   // is not a file transfer
				   }
			   }

			   if (filter.period) {
                   if (filter.periodType == 'before') {
						if (timestamp > filter.period) {
						   console.log('skip file transfer because timestamp >', filter.period);
						   continue;
						}
					} else {
						if (timestamp < filter.period) {
						   console.log('skip file transfer because timestamp <', filter.period);
						   continue;
						}
					}
                }
               
                if (!filter.deleteContact && !filter.incoming && item.direction == 'incoming') {
				   console.log('skip incoming message becuse filter.incoming', filter.incoming);
				   continue;  
                }

                if (!filter.deleteContact && !filter.outgoing && item.direction == 'outgoing') {
				   console.log('skip outgoing message becuse filter.outgoing', filter.outgoing);
				   continue;  
                }

			    purgeMessages.push(item.msg_id);
            }
            
            if (!filter.simulate && purgeMessages.length > 10) {
                // the UI may go nuts if too many updates in chat component
				this.setState({selectedContact: null});
			}

			for (const item of purgeMessages) {
				if (!filter.simulate) {	
					this.deleteMessage(item, uri, remote);
				}
			}

			const remaining = rows.length - purgeMessages.length;
	
	        if (remaining && purgeMessages.length) {		
				this._notificationCenter.postSystemNotification(purgeMessages.length + ' messages removed, ' + remaining + ' left on device');
			} else if (remaining) {
				this._notificationCenter.postSystemNotification('No messages removed, ' + remaining + ' left on device');
			} else if (purgeMessages.length) {
				//this._notificationCenter.postSystemNotification('All messages removed');
				this.setState({selectedContact: null});
			}

        }).catch((error) => {
            console.log('delete messages error:', error);
        });
    }

    /**
     * Delete all local data belonging to the currently active account and
     * sign out. Does NOT touch unrelated accounts stored on the same device
     * nor app-wide AsyncStorage; scope is strictly this account.
     *
     * Order of operations matters:
     *   1. Capture accountId before any state mutation (logout() clears it).
     *   2. Unregister from the SIP server while we still have a live
     *      registration, so the server-side contact goes away cleanly.
     *   3. removeAccount() from the WebSocket connection so sylkrtc stops
     *      routing events for it.
     *   4. Delete the per-account rows from SQL (messages, contacts,
     *      accounts). The DELETE queries in deleteMessagesSQL /
     *      deleteContactsSQL / deleteAccountsSQL already filter by
     *      this.state.accountId, so they are inherently per-account.
     *   5. Remove the per-account folder on disk (journal, keys, cache).
     *   6. resetState() + changeRoute('/login') to drop the user back on the
     *      sign-in screen. We reuse resetState() instead of logout() because
     *      logout() would call saveSqlAccount(accountId, 0) which would
     *      re-INSERT the row we just deleted.
     */
    async deleteAccount() {
        const accountId = this.state.accountId;
        if (!accountId) {
            console.log('LO - [deleteAccount] bail: no active accountId');
            return;
        }

        console.log('LO - [deleteAccount] BEGIN for', accountId);
        this.signOut = true;

        // Cancel any pending registration timer so it cannot fire a
        // ghost-register against the account we are about to delete.
        if (this.registrationFailureTimer) {
            console.log('LO - [deleteAccount] clearing registrationFailureTimer');
            clearTimeout(this.registrationFailureTimer);
            this.registrationFailureTimer = null;
        }

        // 1. Unregister from server (best-effort — ignore errors).
        if (this.state.account && this.state.connection
                && this.state.connection.state === 'ready'
                && this.state.registrationState === 'registered') {
            try {
                console.log('LO - [deleteAccount] unregister()');
                this.state.account.unregister();
            } catch (e) {
                console.log('LO - [deleteAccount] unregister error:', e && e.message);
            }
        }

        // 2. Remove the account from the live connection.
        if (this.state.connection && this.state.account) {
            try {
                console.log('LO - [deleteAccount] connection.removeAccount()');
                this.state.connection.removeAccount(this.state.account, (error) => {
                    if (error) {
                        console.log('LO - [deleteAccount] removeAccount error:', error);
                    } else {
                        console.log('LO - [deleteAccount] removeAccount: OK');
                    }
                });
            } catch (e) {
                console.log('LO - [deleteAccount] removeAccount threw:', e && e.message);
            }
        }

        // 3. Per-account SQL deletes (filtered by this.state.accountId).
        await this.deleteMessagesSQL();
        await this.deleteContactsSQL();
        await this.deleteAccountsSQL();

        // 4. Per-account folder on disk (journals, keys, cached files).
        const accountDir = RNFS.DocumentDirectoryPath + '/' + accountId;
        try {
            await RNFS.unlink(accountDir);
            console.log('LO - [deleteAccount] removed folder', accountDir);
        } catch (err) {
            // Folder may not exist on a never-synced account; not fatal.
            console.log('LO - [deleteAccount] folder unlink skipped for',
                accountDir, ':', err && err.message);
        }

        // 5. Purge this account from the in-memory mirror maps BEFORE any
        //    state change that could cause RegisterForm to mount. resetState
        //    deliberately preserves these so a normal logout can pre-fill the
        //    form for a quick re-sign-in, but after a delete the stale cache
        //    would re-populate the sign-in field with the email we just
        //    purged. We do this synchronously (one setState, pre-route)
        //    because loadAccounts issues its own changeRoute('/login') BEFORE
        //    its setState({serversAccounts}) flushes, which would otherwise
        //    mount RegisterForm with stale props.
        const purgedServersAccounts = {...(this.state.serversAccounts || {})};
        const purgedAccounts = {...(this.state.accounts || {})};
        for (const domain of Object.keys(purgedServersAccounts)) {
            if (purgedServersAccounts[domain] && purgedServersAccounts[domain].account === accountId) {
                delete purgedServersAccounts[domain];
            }
        }
        delete purgedAccounts[accountId];

        this.setState({
            account: null,
            displayName: '',
            email: '',
            serversAccounts: purgedServersAccounts,
            accounts: purgedAccounts,
        });

        // 6. Reuse the standard logout-time state reset, then go to login.
        //    Using resetState (not logout) because logout() re-INSERTS the
        //    accounts row via saveSqlAccount(accountId, 0).
        this.resetState();

        this.changeRoute('/login', 'account deleted');

        console.log('LO - [deleteAccount] END for', accountId);
    }

    async wipe_device() {
		console.log('--- Wiping device --- ');
		this.wiping = true;

		// Remove the saved account
		
		const storage_keys = ['autoAnswerMode', 
		                      'devMode',
		                      'account',
		                      'proximityEnabled',
		                      'devices',
		                      'outgoingJournalEntries',
		                      'myParticipants',
		                      'accountId'
		                      ];

		for (const key of storage_keys) {
		    storage.remove(key);
		}

		const async_storage_keys = await AsyncStorage.getAllKeys();
		
		for (const key of async_storage_keys) {
			AsyncStorage.removeItem(key);
		}

		let dir = RNFS.DocumentDirectoryPath + '/conference';

		RNFS.unlink(dir).then((success) => {
			console.log('Deleted folder', dir)
		}).catch((err) => {
			//console.log('Error deleting conference folder', dir, err.message);
		});

		dir = RNFS.DocumentDirectoryPath + '/' + this.state.accountId;

		RNFS.unlink(dir).then((success) => {
		    console.log('Deleted folder', dir)
		}).catch((err) => {
			//console.log('Error deleting home folder', dir, err.message);
		});

		await this.deleteMessagesSQL();

		await this.deleteContactsSQL();

		await this.deleteAccountsSQL();

		this.resetState();

		setTimeout(() => {
			this.wiping = false;
			this.changeRoute('/login', 'user logout');
		}, 100);

		if (Platform.OS === 'android') {
	        //BackHandler.exitApp();
		}
	}

    async deleteMessagesSQL() {
		query = "DELETE FROM messages where (account = ? and to_uri = ? and direction = 'incoming') or (account = ? and from_uri = ? and direction = 'outgoing')";
		params = [this.state.accountId, this.state.accountId, this.state.accountId, this.state.accountId];

        await this.ExecuteQuery(query, params).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'messages');
            }
        }).catch((error) => {
            console.log('SQL deleteMessagesSQL error:', error);
        });
    }

    async deleteContactsSQL() {
        let query = 'delete from contacts where account = ?';
        this.setState({allContacts: []});
        await this.ExecuteQuery(query, [this.state.accountId]).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'contacts');
            }
        }).catch((error) => {
            console.log('SQL deleteContacts error:', error);
        });
    }

    async deleteAccountsSQL() {
        let query = 'delete from accounts where account = ?';
        await this.ExecuteQuery(query, [this.state.accountId]).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'accounts');
            }
        }).catch((error) => {
            console.log('SQL deleteAccounts error:', error);
        });
    }

    playMessageSound(direction='incoming') {
        //console.log('--- playMessageSound', direction);

        if (!this.state.chatSounds) {
			console.log('---- playMessageSound disabled');
            return;
        }

        let must_play_sound = true;

        if (this.state.dnd) {
            return;
        }

        if (this.state.appState === 'background') {
            return;
        }

        if (direction === 'outgoing') {
        }

        if (direction === 'incoming') {
            if (this.incoming_sound_ts) {
                let diff = (Date.now() - this.incoming_sound_ts)/ 1000;
                if (diff < 10) {
                    must_play_sound = false;
                }
            }
        } else {
            if (this.outgoing_sound_ts) {
                let diff = (Date.now() - this.outgoing_sound_ts)/ 1000;
                if (diff < 10) {
                    must_play_sound = false;
                }
            }
        }

        if (!must_play_sound) {
            console.log('Play incoming sound skipped');
            return;
        }

        try {
          //SoundPlayer.playSoundFile('message_received', 'wav');
          if (direction === 'incoming') {
            this.incoming_sound_ts = Date.now();
            SoundPlayer.playSoundFile('beluga_in', 'wav');
          } else {
            this.outgoing_sound_ts = Date.now();
            SoundPlayer.playSoundFile('beluga_out', 'wav');
          }
        } catch (e) {
          console.log('Error playing', direction,' sound:', e);
        }
    }

	// AppStore GPS Review — removes a message record (and its SQL row),
	// including live-location bubbles. If the removed row is the origin of
	// an active GPS share, the associated share is stopped so no further
	// location data is written or transmitted after removal.
	async removeMessage(message, uri = null) {

		if (!uri) {
			uri = message.sender.uri;
		}

		if (uri === this.state.accountId) {
			uri = message.receiver;
		}

		// If the message being deleted is one we're currently replying to
		// with a live location share (i.e. this side accepted a meeting
		// request with in_reply_to pointing at message.id), tear that
		// share down. The requester just deleted their request — there's
		// nothing left to reply to, and continuing to emit ticks would
		// orphan them on the peer's device. The NavigationBar owns the
		// timer map, so we route through its ref. stopSharesRepliesTo()
		// also drops a system note in the chat timeline so the user has
		// a visible record of why the share ended.
		try {
			const navBar = this.navigationBarRef && this.navigationBarRef.current;
			if (navBar && typeof navBar.stopSharesRepliesTo === 'function') {
				navBar.stopSharesRepliesTo(message.id);
			}
		} catch (e) {
			console.log('[location] removeMessage: stopSharesRepliesTo failed',
				e && e.message ? e.message : e);
		}

		try {
			await this.deleteMessage(message.id, uri, false);
		} catch (error) {
			return;
		}
	
		this.setState(prevState => {
	
			// ---- Update messages ----
			if (!prevState.messages[uri]) {
				return null;
			}
	
			const updatedMessages = {
				...prevState.messages,
				[uri]: prevState.messages[uri].filter(
					msg => msg._id !== message.id
				)
			};
	
			// ---- Find matching contacts SAFELY from prevState ----
			const matchedIds = new Set(
				prevState.allContacts
					.filter(contact =>
						this.getAllContactUris(contact).includes(uri)
					)
					.map(c => c.id)
			);
	
			if (!matchedIds.size) {
				return { messages: updatedMessages };
			}
	
			// ---- Update contacts immutably ----
			const updatedContacts = prevState.allContacts.map(contact => {
	
				if (!matchedIds.has(contact.id)) {
					return contact;
				}
	
				const updatedUnread = (contact.unread || []).filter(
					id => id !== message.id
				);
	
				const isLastMessage = contact.lastMessageId === message.id;
	
				return {
					...contact,
					totalMessages: Math.max(
						(contact.totalMessages || 0) - 1,
						0
					),
					unread: updatedUnread,
					lastMessage: isLastMessage ? null : contact.lastMessage,
					lastMessageId: isLastMessage ? null : contact.lastMessageId
				};
			});
	
			return {
				messages: updatedMessages,
				allContacts: updatedContacts
			};
		});
	}

    async removeConversation(obj) {
        // TODO we must also implement outgoing removeConversation if we delete contact
        let uri = obj;
        console.log('removeConversation', uri);

        let renderMessages = this.state.messages;
        const contact = this.lookupContact(uri);

        let filter = {outgoing: true, 
                      incoming: true, 
                      deleteContact: true,
                      selectedContact: contact
                      };

        await this.deleteMessages(uri, false, filter).then((result) => {
            utils.timestampedLog('Conversation with', uri, 'was removed');
        }).catch((error) => {
            console.log('Failed to delete conversation with', uri);
        });
    }

    async readConversation(uri) {
        console.log('readConversation', uri);
        // meant for another device of mine, don't resend IMDNs?
        this.resetUnreadCount(uri);
    }

    async removeContact(contact) {
        console.log('removeContact', contact.id);

		let uris = this.getAllContactUris(contact);
		let updated = false;

        let renderMessages = {...this.state.messages};

        for (const uri of uris) {
			if (uri in renderMessages) {
				delete renderMessages[uri];
				updated = true;
			}
        }

        if (updated) {
			this.setState({messages: renderMessages});
		}

        this.deleteSylkContact(contact);
    }

	  async writeJournal(messages, journalDirectory) {
		const CHUNK_SIZE = 500;
		const chunks = chunkArray(messages, CHUNK_SIZE);
	
		for (const chunk of chunks) {
		  const lastMsg = chunk[chunk.length - 1];
		  const safeTimestamp = getSafeTimestamp(lastMsg);
		  const journalFile = `${journalDirectory}/${safeTimestamp}-${lastMsg.id}.json`;
	
		  await RNFS.writeFile(
			journalFile,
			JSON.stringify(chunk),
			'utf8'
		  );
		  console.log('Wrote journal', path.basename(journalFile));
		}
	  }

    async refetchMessages(days=30, uri) {
		console.log('-- refetchMessages since', days, 'days ago');
		await this.resetStorage(days);
        this.syncRequested = false;
        var since = moment().subtract(days, 'days');
        let options = {since: since};
        this.requestSyncConversations(null, options, uri);
    }

    requestSyncConversations(lastId=null, options={}, uri) {
        utils.timestampedLog('Request sync from', lastId, options);
        if (!this.state.account) {
            console.log('Wait for sync until we have account');
            return;
        }

        if (!this.state.keys) {
            console.log('Wait for sync until we have keys');
            return;
        }

        if (this.startedByPush) {
            //console.log('Wait for sync until incoming call ends')
            //return;
        }

        if (this.syncRequested) {
            console.log('Sync already requested')
            return;
        }

        if (this.state.syncConversations) {
            console.log('Sync already in progress');
            return;
        }

        this.syncRequested = true;

        if (uri) {
			this.setState({refetchMessagesForUri: uri});
        }

        this.state.account.syncConversations(lastId, options);
    }

    async syncConversations(messages) {       
        console.log(' -- syncConversations, lastSyncId =', this.state.lastSyncId);

        if (this.signOut || this.currentRoute === '/logout') {
            console.log('Sync cancelled at logout');
			this.setState({refetchMessagesForUri: null});
            return;
        }

        if (this.currentRoute === '/login') {
            console.log('Sync cancelled at login');
			this.setState({refetchMessagesForUri: null});
            return;
        }

		await this.waitForContactsLoaded();
		let finishedFirstSync = false;
        
        this.syncStartTimestamp = new Date();

        this.setState({syncConversations: true});                       
		
		console.log('syncConversations', messages.length, 'messages on server');
		let label = 'No new messages on server';

		const realContentTypes = ['text/plain', 'text/html', 'application/sylk-file-transfer'];		
		const realMessages = messages.filter(
			msg => realContentTypes.includes(msg.contentType) && 
			       msg.state === 'received' && 
			       msg.dispositionState !== 'displayed' &&
			       !msg.content.startsWith('?OTRv') &&
			       msg.dispositionNotification.indexOf('display') !== -1
		);

		if (realMessages.length == 1) {
			label = 'One new message on server';
			if (!this.state.selectedContact) {
				//this._notificationCenter.postSystemNotification(label);
			}
			this.setState({syncPercentage: 0});
		} else if (realMessages.length > 1) {
			label = messages.length + ' new messages on server';
			if (!this.state.selectedContact) {
				//this._notificationCenter.postSystemNotification(label);
			}
			this.setState({syncPercentage: 0});
		}

		const journalDirectory = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/journal";
	    const journalDirectoryExists = await RNFS.exists(journalDirectory);

		if (!journalDirectoryExists) {
			try {
				await RNFS.mkdir(journalDirectory);
				console.log('Made journal directory', journalDirectory);
			} catch (e) {
				console.log('Error making directory', journalDirectory, ':', e);
			}
		} else {
			//console.log('Journal directory exists', journalDirectory);			
		}

		let  firstMessage = messages.length > 0 ? messages[0] : undefined;
		let  lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;

		if (lastMessage) {
			//console.log('firstMessage', firstMessage.timestamp);
			//console.log('lastMessage', lastMessage.timestamp);

		  if (!this.state.lastSyncId) {
			try {
			  const excludedContentTypes = [
				'application/sylk-message-remove',
				'application/sylk-conversation-remove',
				'application/sylk-conversation-read',
				'message/imdn'
			  ];
		
			  const filteredMessages = messages.filter(
				msg => !excludedContentTypes.includes(msg.contentType)
			  );
		
			  console.log('syncConversations', filteredMessages.length, 'filtered messages');
			  await this.writeJournal(filteredMessages, journalDirectory);
			} catch (e) {
			  console.log('Error writing journal files:', e);
			}
		
			this.setState({syncConversations: false});
			this.lastServerJournalId = lastMessage.id;
			this.syncRequested = false;
			this.requestSyncConversations(lastMessage.id);
			return;
		
		  } else {
			try {
			  await this.writeJournal(messages, journalDirectory);
			} catch (e) {
			  console.log('Error writing journal files:', e);
			}
		  }
		}
		
		// all server journals were now cached locally
				
		if (!lastMessage && !this.state.lastSyncId) {
			console.log('First sync done');
			finishedFirstSync = true;
			if (this.lastServerJournalId ) {
				this.saveLastSyncId(this.lastServerJournalId, true);
			}
						
			setTimeout(() => {
				this.afterFirstSync();
			}, 100);
		} else {
		    if (lastMessage) {		
				this.saveLastSyncId(lastMessage.id, true);
			}
		}

		const cachedJournals = await RNFS.readDir(journalDirectory);
		cachedJournals.sort();
		if (cachedJournals.length == 0) {
			this.setState({syncConversations: false});                       
		}
		
		let i = 0;
		if (cachedJournals.length == 0) {
			//console.log('No cached journals found');		
			this.setState({syncPercentage: 100});
		} else {
			this.setState({syncPercentage: 0});
		}

		for (const journalFile of cachedJournals) {
			const jFile = journalFile.path;
			i = i + 1;

			try {
				const syncPercentage = Math.round((i / cachedJournals.length) * 100);
				this.setState({syncPercentage: syncPercentage});
				const journalJson = await RNFS.readFile(jFile, 'utf8');
				const _journalMessages = await JSON.parse(journalJson);
		        lastMessage = _journalMessages.length > 0 ? _journalMessages[_journalMessages.length - 1] : undefined;
				utils.timestampedLog('Journal found:', path.basename(jFile), i, 'out of', cachedJournals.length);
				await this._syncConversations(_journalMessages, path.basename(jFile), finishedFirstSync);
				await RNFS.unlink(jFile);
				utils.timestampedLog('Journal processed:', path.basename(jFile), i, 'out of', cachedJournals.length);
				let jlabel = "Journal applied";
				if (cachedJournals.length > 1 && !this.state.selectedContact) {
					jlabel = 'Apply ' + i +  ' out of ' + cachedJournals.length + ' journals';
					this._notificationCenter.postSystemNotification(jlabel);
				}
				if (lastMessage && this.state.lastSyncId) {
					this.saveLastSyncId(lastMessage, true);
				}
			} catch (e) {
				utils.timestampedLog('Error applying journal file', path.basename(jFile), ':', e);
				//this._notificationCenter.postSystemNotification('Journal error ' + e);
				try {
					await RNFS.unlink(jFile);
				} catch (e) {
					console.log('Error deleting journal file', jFile, ':', e);
				}
			}
		}

        if (this.syncStartTimestamp) {
            let diff = (Date.now() - this.syncStartTimestamp)/ 1000;
            this.syncStartTimestamp = null;
            utils.timestampedLog('Sync ended after', diff, 'seconds');
			this.setState({syncConversations: false, syncPercentage: 100, refetchMessagesForUri: null});  
        }

		setTimeout(() => {
			this.refreshNavigationItems();
			this.updateServerHistory('syncConversations')
		}, 500);

	}

    async _syncConversations(messages, file, firstSync=false) {
        console.log(' -- syncConversations handler for', file, 'with', messages.length, 'messages');

        let renderMessages = { ...this.state.messages };
 
        if (messages.length > 0) {
            utils.timestampedLog('Sync', messages.length, 'message events from server');
            //this._notificationCenter.postSystemNotification('Syncing messages with the server');
        } else {
            utils.timestampedLog('No new messages on server to sync');
            return;
        }

        let i = 0;
        let idx;
        let uri;
        let last_id;
        let content;
        let contact;
        let contacts;
        let existingMessages;
        let formatted_date;
        let newMessages = [];
        let lastMessages = {};
        let updateContacts = {};
        let createdContacts = {};
        let last_timestamp;
        let stats = {state: 0,
                     remove: 0,
                     incoming: 0,
                     outgoing: 0,
                     delete: 0,
                     read: 0
                     }
        let j = 0;
        let messageTimestamp;
        let contactTime;

        const modifiedContactsMap = new Map();

        let gMsg;
		let purgeMessages = [...this.state.purgeMessages];
        let direction;
        
		for (const message of messages) {
            i = i + 1;
            uri = null;

            try {
				messageTimestamp = new Date(message.timestamp).getTime();
			} catch (e) {
				console.log('cannot convert messageTimestamp', message.timestamp, e);
				continue;
			}

			try {
				if (message.contentType === 'application/sylk-message-remove') {
					uri = message.content.contact;
				} else if (message.contentType === 'application/sylk-conversation-remove') {
					uri = message.content;
				} else if (message.contentType === 'application/sylk-conversation-read' ) {
					uri = message.content;
				} else {
					if (message.sender.uri === this.state.account.id) {
						uri = message.receiver;
					} else {
						uri = message.sender.uri;
					}
				}
	
				direction = message.sender.uri === this.state.account.id ? 'outgoing': 'incoming';
				
			    //console.log('Process journal', i, 'of', messages.length, message.id, direction, message.contentType, uri);
				
				if (this.state.refetchMessagesForUri) {
					if (direction == 'incoming' && uri != this.state.refetchMessagesForUri) {
						console.log('Skip incoming message for uri', uri);
						continue;
					}
					if (direction == 'outgoing' && uri != this.state.refetchMessagesForUri) {
						console.log('Skip outgoing message for uri', uri);
						continue;
					}
				}
	
				let d = new Date(2019);
	
				if (messageTimestamp < d) {
					console.log('Skip broken journal message with broken date', message.id);
					purgeMessages.push(message.id);
					continue;
				}
	
				if (!message.content) {
					console.log('Skip broken journal message with empty body', message.id);
					purgeMessages.push(message.id);
					continue;
				}

				if (!uri) {
					console.log('Skip broken journal message with unknown uri');
					//purgeMessages.push(message.id);
					continue;
				}
	
				const matchedContacts = this.lookupContacts(uri);
				// clone array + clone each contact object

				const contacts = matchedContacts.map(contact => ({
					...contact,
					unread: [...(contact.unread || [])],
					tags: [...(contact.tags || [])]
				}));

				if (contacts.length === 0 && message.contentType !== 'application/sylk-conversation-remove') {
					if (uri.indexOf('@') > -1 && !utils.isEmailAddress(uri)) {
						//console.log('Skip bad uri', uri);
						continue;
					}
	 
	                if (uri in createdContacts) {
					    contact = createdContacts[uri];
						contacts.push(contact);
	                } else {
						contact = this.newContact(uri, uri, {'src': 'journal ' + direction});
						createdContacts[uri] = contact
	                }

					contact.timestamp = messageTimestamp;
					updateContacts[contact.id] = contact;
				}
				
				for (const contact of contacts) {
					//console.log('Matched contact for journal entry: ', contact.id, contact.uri);
				}
	
				for (const contact of contacts) {
					if (contact.tags.indexOf('blocked') > -1) {
					    console.log('Skip blocked contact', contact.id);
						continue;
					}
				}

				//console.log('Sync message', message.timestamp, 'for', uri, message);
	
				if (message.contentType === 'application/sylk-message-remove') {
					this.deleteMessageSync(message.id, uri);
	
					if (uri in renderMessages) {
						existingMessages = renderMessages[uri];
						newMessages = [];
	
						existingMessages.forEach((msg) => {
							if (msg._id === message.id) {
								return;
							}
							newMessages.push(msg);
						});
						renderMessages[uri] = newMessages;
					}
	
					for (const contact of contacts) {
						contact.unread = contact.unread.filter(
							id => id !== message.id
						);
	
						if (contact.lastMessageId === message.id) {
							contact.lastMessage = null;
							contact.lastMessageId = null;
						}
					}
	
					if (uri in lastMessages && lastMessages[uri] === message.id) {
						delete lastMessages[uri];
					}
	
					stats.delete = stats.delete + 1;
	
				} else if (message.contentType === 'application/sylk-conversation-remove') {
	
					for (const contact of contacts) {
						if (messageTimestamp > contact.timestamp) {
						    this.removeConversation(contact.uri); 

							if (contact.uri in lastMessages) {
								delete lastMessages[contact.uri];
							}
			
							if (contact.uri in renderMessages) {
								delete renderMessages[contact.uri];
							}
						} else {
							// contact has messages after remove request
						}
					}

					stats.remove = stats.remove + 1;
	
				} else if (message.contentType === 'application/sylk-conversation-read') {
					for (const contact of contacts) {
						contact.unread = [];
						updateContacts[contact.id] = contact;
						stats.read = stats.read + 1;
					}
		
				} else if (message.contentType === 'message/imdn') {
					await this.messageStateChangedSync({messageId: message.content?.message_id, state: message.content?.state});
					stats.state = stats.state + 1;

				} else {
					//console.log('Outgoing', message.contentType);
					if (message.sender.uri === this.state.account.id) {
						 if (message.contentType === 'application/sylk-message-metadata') {
						     // Drop location-sharing metadata from journal replay —
						     // they are ephemeral live-only payloads; re-injecting
						     // them on startup creates duplicate bubbles.
						     if (this._isLocationJournalPayload(message)) {
						         stats.outgoing = stats.outgoing + 1;
						         j = j + 1;
						         continue;
						     }
						     this.handleMessageMetadata(this.state.account.id, message.content);
						 } else {
							for (const contact of contacts) {
								if (contact.tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
									contact.tags.push('chat');
								}

								if (messageTimestamp > contact.timestamp) {
									contact.timestamp = messageTimestamp;
									updateContacts[contact.id] = contact;
								}
							}
							lastMessages[uri] = message.id;
						}
	
						stats.outgoing = stats.outgoing + 1;
						await this.outgoingMessageFromJournal(message, {idx: i, total: messages.length});
						j = j + 1;
	
					} else {
					    //console.log('Incoming', message.contentType);
						if (message.contentType !== 'application/sylk-message-metadata') {
							for (const contact of contacts) {
								if (contact.tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
									contact.tags.push('chat');
								}

								if (messageTimestamp > contact.timestamp) {
									contact.timestamp = messageTimestamp;
									contact.direction = 'incoming';
									updateContacts[contact.id] = contact;
								}
							}
		
							if (message.contentType === 'application/sylk-file-transfer') {
								gMsg = utils.sylk2GiftedChat(message, '', 'incoming');
								const lastMessage = this.buildLastMessage(gMsg);
								if (lastMessage != null) {
									for (const contact of contacts) {
										if (messageTimestamp > contact.timestamp) {
											contact.lastMessage  = lastMessage;
											contact.lastMessageId = message.id;
										}
									}
								}
							}
		
							if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
								this.mustPlayIncomingSoundAfterSync = true;
							}
		
							lastMessages[uri] = message.id;
		
							if (message.dispositionNotification.indexOf('display') > -1) {
								if (unreadCounterTypes.has(message.contentType)) {
									for (const contact of contacts) {
										// Only treat user as "in chat" if app is in foreground.
										const isActiveChat =
											this.state.appState === 'active' &&
											this.state.selectedContact &&
											this.state.selectedContact.id === contact.id;
										if (!isActiveChat) {
											contact.unread.push(message.id);
											console.log('[SYLK] Increment unread (journal) for', uri,
												'new length =', contact.unread.length,
												'appState =', this.state.appState);
										} else {
											console.log('[SYLK] Skipping unread increment (journal): user is in chat with', uri);
										}
									}
								}
							}
						} else {
							 if (message.contentType === 'application/sylk-message-metadata') {
								 //console.log('Incoming metadata', message.content);
						     }
						}
	
						stats.incoming = stats.incoming + 1;
						await this.incomingMessageFromJournal(message, {idx: i, total: messages.length});
						j = j + 1;
					}
				}

				for (const c of contacts) {
					modifiedContactsMap.set(c.id, c);
				}

			} catch (e) {
				utils.timestampedLog(
					'sync processing failed', message && message.id,
					'error:', e && e.message,
				);
			}	
        };

		this.setState(prevState => {
			const existingIds = new Set(prevState.allContacts.map(c => c.id));
		
			const updated = prevState.allContacts.map(contact =>
				modifiedContactsMap.has(contact.id)
					? modifiedContactsMap.get(contact.id)
					: contact
			);
		
			// Add new contacts created during sync
			for (const contact of modifiedContactsMap.values()) {
				if (!existingIds.has(contact.id)) {
					updated.push(contact);
				}
			}
		
			return {
				allContacts: updated,
				messages: { ...renderMessages },
				updateContacts,
				purgeMessages
			};
		}, () => {
		   this.afterSyncTasks();
		});
    }

    async afterSyncTasks() {
        //console.log('-- afterSyncTasks');

        await this.insertPendingMessages();

        let updateContacts = Object.values(this.state.updateContacts);

       // console.log('updateContacts:', Object.keys(updateContacts).toString());
        let uris = Object.keys(updateContacts);
        uris = [... new Set(uris)];

        //console.log('Update contacts with uris:', uris.toString());

        let created;
        let old_tags;

		const processedContacts = new Set();

		updateContacts.forEach((contact) => {
			if (!processedContacts.has(contact.id)) {
				processedContacts.add(contact.id);
				console.log('Must update contact', contact.id, contact.uri, contact.timestamp);
				this.saveSylkContact(contact.uri, contact, 'journal');
			}
		});

		let purgeMessages = [...this.state.purgeMessages];

        purgeMessages.forEach((id) => {
            this.deleteMessage(id, this.state.accountId);
        });

        this.setState({purgeMessages:[],
                       syncConversations: false,
                       updateContacts: {}
                       });

        setTimeout(() => {
            if (this.state.selectedContact) {
                this.getMessages(this.state.selectedContact, {origin: 'journal'});
            }
        }, 100);
    }

    async publicKeyReceived(message) {
        if (message.publicKey) {
            this.savePublicKey(message.uri, message.publicKey.trim());
        } else {
            console.log('No public key available on server for', message.uri);
            if (message.uri === this.state.accountId) {
                this.sendPublicKey();
            }
        }
    }

    async incomingMessageFromWebSocket(message) {
        console.log('-- Incoming message from web socket', message.id, message.contentType, 'from', message.sender.uri);
        // Handle incoming messages

		if (this.state.blockedUris.indexOf(message.sender.uri) > -1) { 
			utils.timestampedLog('Reject message from blocked URI', from);
			return;
		}

        this.saveLastSyncId(message.id);

        if (message.content.indexOf('?OTRv3') > -1) {
            return;
        }

        if (message.contentType === 'application/sylk-contact-update') {
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            console.log('[pubkey-recv] websocket arrival from', message.sender.uri,
                'msgId=', message.id,
                'contentLen=', message.content ? message.content.length : 0);
            this.savePublicKey(message.sender.uri, message.content);
            return;
        }

        if (message.contentType === 'text/pgp-private-key' && message.sender.uri === this.state.account.id) {
            console.log('Received PGP private key from another device');
            this.handleRemotePrivateKey(message.content);
            return;
        }

        const is_encrypted =  message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;

        if (is_encrypted) {
            if (!this.state.keys || !this.state.keys.private) {
                console.log('Missing private key, cannot decrypt message');
                if (message.dispositionNotification) {
					this.sendDispositionNotification(message, 'error', true);
                }
                this.saveSystemMessage(message.sender.uri, 'Cannot decrypt message, no private key', 'incoming');
            } else {
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    utils.timestampedLog('Incoming message', message.id, 'decrypted');
                    this.handleIncomingMessage(message, decryptedBody);
                }).catch((error) => {
                    console.log('Failed to decrypt message', message.id, error);
                    this.saveSystemMessage(message.sender.uri, 'Received message encrypted with wrong key', 'incoming');
					if (message.dispositionNotification) {
						this.sendDispositionNotification(message, 'error', true);
                    }
                    this.sendPublicKeyToUri(message.sender.uri);
                });
            }
        } else {
            console.log('Incoming message is not encrypted', message.id);
            this.handleIncomingMessage(message);
        }
    }

    handleIncomingMessage(message, decryptedBody=null) {
        console.log('handleIncomingMessage', message.sender.uri, message.contentType, 'app state', this.state.appState);
        this.saveIncomingMessage(message, decryptedBody);

        let content = decryptedBody || message.content;

        if (!this.isMessageAllowed(message.contentType, content)) {
			return;
		}

        // -----------------------------------------------------------------
        // Classify metadata messages before firing any notifications.
        //
        // Location sharing is transported as `application/sylk-message-metadata`.
        // Without special-casing, two things go wrong:
        //   1. The Android notification body is the raw JSON blob (ugly).
        //   2. Every 60s tick produces a new notification (spammy).
        //
        // So we:
        //   - Show a friendly notification ONLY on the origin tick (no
        //     metadataId yet) — "📍 Live location from <name>".
        //   - Silently swallow follow-up ticks (metadataId set) so the
        //     receiver isn't nagged every minute while sharing is active.
        // -----------------------------------------------------------------
        const isMetadata = message.contentType === 'application/sylk-message-metadata';
        let isLocationOriginTick = false;
        let isLocationFollowup = false;
        let friendlyNotifBody = null;

        if (isMetadata) {
            try {
                const parsed = JSON.parse(content);
                if (parsed && parsed.action === 'location') {
                    if (parsed.metadataId) {
                        isLocationFollowup = true;
                    } else {
                        isLocationOriginTick = true;
                        const contact = this.lookupContact(message.sender.uri);
                        const displayName = (contact && contact.name) || message.sender.uri;
                        friendlyNotifBody = `\uD83D\uDCCD Live location from ${displayName}`;
                    }
                }
            } catch (e) {
                // non-JSON metadata — treat as a generic metadata message
            }
        }

        // Don't post any OS-level notification for a location follow-up tick.
        if (isLocationFollowup) {
            //console.log('[location] handleIncomingMessage: suppressing notification for follow-up tick');
            this.handleMessageMetadata(message.sender.uri, content, message.sender.uri);
            return;
        }

        if (!this.state.selectedContact || this.state.selectedContact.uri !== message.sender.uri) {
            if (this.state.appState === 'foreground') {
				if (Platform.OS === 'android') {
					// For a location origin tick, swap the raw JSON for the
					// friendly body so the system notification reads well.
					const notifBody = isLocationOriginTick ? friendlyNotifBody : content;
					this.postAndroidMessageNotification(message.sender.uri, notifBody);
                }
            }
        }

		if (isMetadata) {
			// Fire an iOS local notification for the origin location share
			// (mirrors what notifyIncomingMessage does for plain messages, which
			// we skip below for metadata to avoid duplicate UI entries).
			if (isLocationOriginTick && Platform.OS === 'ios') {
				const contact = this.lookupContact(message.sender.uri);
				const displayName = (contact && contact.name) || message.sender.uri;
				const userInfo = {'data': {
					'event': 'message',
					'from_uri': message.sender.uri,
					'display_name': displayName,
					'to_uri': this.state.accountId,
					'message_id': message.id,
					'origin': 'reactNative',
				}};
				if (!this.state.selectedContact ||
					this.state.selectedContact.uri !== message.sender.uri) {
					this.sendLocalNotification('Live location', 'From ' + displayName, userInfo);
				}
			}
			this.handleMessageMetadata(message.sender.uri, content, message.sender.uri);
			return;
		}

        this.notifyIncomingMessage(message);
		const uri = message.sender.uri;

		if (this.state.selectedContact && uri === this.state.selectedContact.uri) {
			let renderMessages = { ...this.state.messages };
			const existingList = renderMessages[uri] || [];
			const gMsg = utils.sylk2GiftedChat(message, decryptedBody, 'incoming');
	
			// Create NEW array instead of mutating push()
			if (!existingList.some(obj => obj._id === message.id)) {
				renderMessages[uri] = [...existingList, gMsg];
			}
	
			let _lmSelected = null;
			if (gMsg.contentType?.startsWith('text/')) {
				_lmSelected = this.buildLastMessage(gMsg);
			}
			const selectedContact = {
			  ...this.state.selectedContact,
			  ...(_lmSelected != null ? { lastMessage: _lmSelected } : {}),
			  timestamp: message.timestamp,
			  direction: 'incoming',
			  lastCallDuration: null,
			};
	
			this.setState({ 
				selectedContact,
				messages: renderMessages
			});
		}
    }

	// Is the journal payload a location-sharing UPDATE tick (or meeting_end)
	// that can be safely dropped on journal replay?
	//
	// Policy (per product decision after the "target was offline when I
	// started sharing" bug):
	//   • ORIGIN ticks (action='location', no metadataId) — KEEP. Needed so
	//     receivers who came online after the live event still see the share
	//     bubble and, for meeting requests, the accept modal. Includes plain
	//     timed-share origins, meeting-request origins (meeting_request:true)
	//     and acceptance origins (in_reply_to set).
	//   • UPDATE ticks (action='location', metadataId set) — DROP. The origin
	//     row already carries the last-known position (live handling UPDATEs
	//     the origin's content in place), so replaying follow-ups would waste
	//     work and, worse, fail a rowid UPDATE if the origin was also dropped.
	//   • meeting_end — DROP. The "wipe now" signal is only meaningful live;
	//     the `expire` column + purgeExpiredMessages() handles the SQL side.
	//   • Encrypted blobs we can't introspect (contentOverride missing) —
	//     DROP, same as before: we can't tell origin from update, so the
	//     conservative move is to skip. Callers that want origin ticks
	//     through MUST pre-decrypt and pass the plaintext via contentOverride.
	_isLocationJournalPayload(message, contentOverride) {
		if (!message || message.contentType !== 'application/sylk-message-metadata') {
			return false;
		}
		const content = contentOverride != null ? contentOverride : message.content;
		if (typeof content !== 'string') return false;
		// Caller couldn't provide a decrypted body → we have no way to tell
		// origin from update. Drop (existing conservative default).
		if (content.startsWith('-----BEGIN PGP')) return true;
		try {
			const parsed = JSON.parse(content);
			if (!parsed || typeof parsed !== 'object') return false;
			const action = parsed.action;
			if (action === 'meeting_end') return true;
			if (action === 'location') {
				// Follow-up tick → safe to drop; origin row carries the
				// last position already.
				if (parsed.metadataId) return true;
				// Origin tick (meeting request, acceptance, or plain timed
				// share) → pass through so SQL gets the row and the modal
				// can be queued.
				return false;
			}
		} catch (e) {
			// Unparseable — not recognisable as structured metadata; let
			// the existing pipeline handle (it will silently skip via the
			// guards in handleMessageMetadata / saveOutgoingMessageSqlBatch).
		}
		return false;
	}

	handleMessageMetadata(uri, content, author) {
		let metadataContent;

		// During startup / journal replay the caller sometimes hands us the
		// raw server payload for an encrypted sylk-message-metadata. JSON.parse
		// on a PGP envelope (starts with "-----BEGIN PGP MESSAGE-----") blows
		// up with "Unexpected character in number: -" and spams the console.
		// Skip silently — the decrypted version is handled through
		// handleIncomingMessage / outgoingMessage paths separately.
		if (typeof content !== 'string'
				|| content.startsWith('-----BEGIN PGP')) {
			return;
		}

		try {
			metadataContent = JSON.parse(content);
		} catch (error) {
			console.log('handleMessageMetadata cannot parse payload', error);
			return;
		}

	    //console.log('-- handleMessageMetadata', metadataContent.action);
	
		if (metadataContent.action === 'autoanswer') {
			if (
				metadataContent.value &&
				metadataContent.device &&
				metadataContent.device !== this.deviceId
			) {
				const contact = this.lookupContact(metadataContent.uri);
				if (contact?.localProperties?.autoanswer) {
					console.log('Disable autoanswer on my device', this.deviceId);
					this.toggleAutoAnswer(contact, false);
				}
			}
			return;
		}

		// Peer ended their side of an "Until we meet" session (user tap,
		// message deleted, permission lost). Route straight to NavigationBar
		// so it can walk its locationTimers map and stop any share that was
		// part of this session. Ignore our own outgoing echoes — the local
		// stop already torn everything down before we emitted the signal.
		if (metadataContent.action === 'meeting_end') {
			if (!author) {
				// Outgoing echo of our own signal — no-op.
				return;
			}
			const sessionId = metadataContent.meeting_session_id
				|| metadataContent.messageId;
			// reason is propagated from _maybeFireProximityMeet so the peer's
			// system-note wording matches ours. Undefined when the signal was
			// user-initiated — stopSharesForMeetingSession falls back to
			// 'peer-stopped' in that case.
			const remoteReason = metadataContent.reason;
			this._reportMeetingEnded(sessionId, remoteReason || 'peer-stopped');
			// When the peer ended because of proximity-met, route through
			// the shared "Meeting succeeded" helper. The helper's internal
			// _proximityNotedSessionIds dedup coexists with the local-
			// proximity path in _maybeFireProximityMeet: whichever fires
			// first for a given session emits the message (if this device
			// is the initiator), later callers are no-ops. No system note
			// is written — the chat message itself records the meetup,
			// with its own timestamp providing the "at HH:MM" marker.
			if (remoteReason === 'proximity' && sessionId) {
				this._sendMeetingSucceededIfInitiator(sessionId, author);
			}
			try {
				const navBar = this.navigationBarRef && this.navigationBarRef.current;
				if (navBar && typeof navBar.stopSharesForMeetingSession === 'function' && sessionId) {
					navBar.stopSharesForMeetingSession(sessionId, {reason: remoteReason});
				}
			} catch (e) {
				console.log('[location] stopSharesForMeetingSession failed',
					e && e.message ? e.message : e);
			}
			return;
		}
	
		// `metadataContent.uri` is filled in by the sender with the
		// *recipient's* URI. On an outgoing local echo the recipient is
		// indeed our conversation key, so honoring it is fine. But on an
		// incoming message it is *our own* URI — using it would compare
		// our account id against `selectedContact.uri` (the remote party)
		// and the gate below would always reject. So only honour the
		// metadata-side uri when this call is an outgoing echo (no
		// `author` arg). On incoming, keep the sender's uri we were
		// passed in.
		if (!author) {
			uri = metadataContent.uri || uri;
		}

		// Meeting-request handshake hooks ("Until we meet"). Run BEFORE the
		// selectedContact gate below, because:
		//   • an incoming meeting_request may arrive while the user is
		//     looking at a different chat — we still need to queue it so
		//     the modal fires when they open it;
		//   • the outgoing local echo of our own meeting request needs to
		//     record the origin _id into myOutgoingMeetingRequestIds so we
		//     can later recognise an incoming acceptance tick;
		//   • an incoming acceptance tick (metadata.in_reply_to pointing
		//     at one of our requests) needs to persist a "peer accepted"
		//     system note even if we're not currently in that chat.
		//   • coord pairing (this.meetingSessions) wants every tick, even
		//     when the user is viewing a different chat — that way the
		//     bubble already knows the peer's position the moment they
		//     re-open the chat and the next tick lands.
		let preGatePair = null;
		if (metadataContent.action === 'location') {
			if (!author && metadataContent.meeting_request === true && metadataContent.messageId) {
				// Outgoing echo of our own meeting request — remember the _id
				// and schedule the end-of-session wipe for this device.
				const expiresMs = this._parseExpiresToMs(metadataContent.expires);
				this._noteOutgoingMeetingRequest(metadataContent.messageId, expiresMs, uri);
			}
			if (author && metadataContent.meeting_request === true) {
				this._noteIncomingMeetingRequest(author, metadataContent);
			}
			if (author && metadataContent.in_reply_to) {
				this._noteIncomingAcceptanceTick(author, metadataContent);
			}
			preGatePair = this._updateMeetingSessionCoords(metadataContent, uri);
		}

		if (!this.state.selectedContact || this.state.selectedContact.uri !== uri) {
			if (metadataContent.action === 'location') {
				console.log('[location] handleMessageMetadata: skipping live update — selectedContact is',
					this.state.selectedContact ? this.state.selectedContact.uri : '(none)',
					'but metadata is for', uri,
					'(author=', author || '(local)', ', metadata.uri=', metadataContent.uri, ')');
			}
			return;
		}

		metadataContent.author = author || this.state.accountId;

		const mId = metadataContent.messageId;
		if (!mId) return;

		// Live location: the first tick of a sharing session needs a visible
		// bubble injected into the rendered messages list. Subsequent ticks
		// reuse the same bubble — they only update `messagesMetadata[mId]`
		// via the generic setState below, which ContactsListBox watches.
		let meetingPair = null;
		if (metadataContent.action === 'location') {
			this._injectLocationBubble(uri, metadataContent, mId);
			// The coord-pair classification happened above the gate so
			// background ticks still populate this.meetingSessions. We
			// reuse that result here to decide whether we need to run
			// the state-mutating peer-coords propagation (which is only
			// meaningful for the currently selected contact).
			meetingPair = preGatePair;
		}

		this.updateMetadataFromRemote(
			mId,
			metadataContent.action,
			metadataContent.value
		);
	
		this.setState(prev => {
			const contactIndex = prev.allContacts.findIndex(c => c.uri === uri);
			if (contactIndex === -1) {
				if (metadataContent.action === 'location') {
					console.log('[location] handleMessageMetadata setState: contact not found',
						'uri=', uri);
				}
				return null;
			}

			const oldContact = prev.allContacts[contactIndex];

			// There are TWO sources of prior metadata in the tree, and they
			// can drift apart:
			//   • prev.messagesMetadata[mId]                 — top-level
			//   • prev.allContacts[i].messagesMetadata[mId]  — contact-level mirror
			// Drift happens because _propagatePeerCoordsForSession (and other
			// in-between setStates) write peerCoords / distanceMeters ONTO the
			// top-level entry, while contact-level updates may lag by one
			// commit. If we rebuild the contact mirror from its own stale
			// copy AND then return it as the top-level too (line below), we
			// downgrade every OTHER mId in the top-level to its pre-drift
			// version — which is exactly the "iOS map reverts to Locating..."
			// regression when the Android accepter's placeholder tick lands
			// on the requester: the placeholder's setState for mId=acceptId
			// stomps the real-coords entry for mId=requestId carried only on
			// the top-level branch. Fix: merge top-level on top of contact
			// so the freshest per-mId data wins as the shared base.
			const prevTopMeta = prev.messagesMetadata || {};
			const prevContactMeta = oldContact.messagesMetadata || {};
			const mergedPriorMeta = {...prevContactMeta, ...prevTopMeta};

			const oldMetaByMessage = mergedPriorMeta[mId] || [];

			const previousForAction = oldMetaByMessage.find(
				ev => ev.action === metadataContent.action
			);

			// Local author wins
			if (
				previousForAction &&
				previousForAction.author === prev.accountId &&
				metadataContent.author !== prev.accountId
			) {
				console.log(
					"Ignoring metadata: local author wins for action",
					metadataContent.action
				);
				return null;
			}

			const filtered = oldMetaByMessage.filter(
				ev => ev.action !== metadataContent.action
			);

			// Live-location ticks carry only the freshly-reported coords.
			// Two derived fields live only on the client — they're stamped
			// onto the previous 'location' entry by
			// _propagatePeerCoordsForSession AFTER the tick lands:
			//   • peerCoords      — the other participant's coords
			//   • distanceMeters  — haversine(self, peer)
			// The filter+append pattern above would drop them on every new
			// tick, wiping the second pin between propagation cycles (the
			// "Android shows one pin" regression). Carry them forward.
			//
			// Defensive guard: an out-of-order placeholder tick (no
			// lat/lng — emitted once at session origin before GPS lock)
			// must never downgrade a real-coords entry that already
			// committed. Without this guard the map bubble reverts to
			// the "Acquiring location" spinner on the receiving side
			// (the iOS regression observed after the remote ACCEPT reply
			// placed the accepter's placeholder tick through this path).
			let augmentedEntry = metadataContent;
			if (metadataContent.action === 'location') {
				const prior = previousForAction;
				const newHasCoords = metadataContent.value
					&& typeof metadataContent.value.latitude === 'number'
					&& typeof metadataContent.value.longitude === 'number';
				const priorHasCoords = prior
					&& prior.value
					&& typeof prior.value.latitude === 'number'
					&& typeof prior.value.longitude === 'number';

				if (prior && priorHasCoords && !newHasCoords) {
					console.log('[location] handleMessageMetadata setState: ignoring placeholder tick (real coords already present)',
						'mId=', mId);
					return null;
				}

				if (prior
					&& (prior.peerCoords || prior.distanceMeters != null)
					&& !metadataContent.peerCoords
					&& metadataContent.distanceMeters == null) {
					augmentedEntry = {
						...metadataContent,
						peerCoords: prior.peerCoords,
						distanceMeters: prior.distanceMeters,
					};
				}
			}

			const newArray = [...filtered, augmentedEntry];

			// Use the merged base (top-level preferred) as the source of
			// truth so OTHER mIds — e.g. the requester's origin bubble when
			// we're processing the accepter's placeholder tick — retain
			// their freshest peerCoords / real-coords entries. Basing the
			// merge on oldContact.messagesMetadata alone would quietly roll
			// those back whenever the contact mirror lagged.
			const newMessagesMetadataForUri = {
				...mergedPriorMeta,
				[mId]: newArray
			};


			const updatedContact = {
				...oldContact,
				messagesMetadata: newMessagesMetadataForUri
			};
				
			const newAllContacts = [...prev.allContacts];
			newAllContacts[contactIndex] = updatedContact;
			
			let selectedContact = this.state.selectedContact;

			if (this.state.selectedContact.id && updatedContact.id && this.state.selectedContact.id == updatedContact.id) {
				selectedContact = updatedContact;
			}
	
			return {
				allContacts: newAllContacts,
				selectedContact: selectedContact,
				messagesMetadata: newMessagesMetadataForUri
			};
		});

		// After the per-tick metadata update has landed, cross-inject the
		// peer's latest coords (+ computed distance) into both sides'
		// location entries for this meeting session. Runs on the next
		// tick so the setState above has finished applying. Harmless no-op
		// when the tick isn't part of a meeting session.
		if (meetingPair && meetingPair.sessionId) {
			setTimeout(() => {
				this._propagatePeerCoordsForSession(meetingPair.sessionId, uri);
			}, 0);
		}
	}

	// "Until we meet" handshake helpers. All state-mutating operations
	// persist to AsyncStorage so the "show once" and "already accepted"
	// guarantees survive app restarts. Markers are pruned at the same
	// time the session messages are wiped (on expiration).

	async _hydrateMeetingHandshakeState() {
		try {
			const raws = await AsyncStorage.multiGet([
				'meetingRequests.handled',
				'meetingRequests.mine',
				'meetingRequests.acceptancesHandled',
				'meetingRequests.accepted',
				'meetingRequests.metPeers',
			]);
			const byKey = Object.fromEntries(raws);
			const parse = (s) => { try { return new Set(JSON.parse(s || '[]')); } catch (e) { return new Set(); } };
			this.handledMeetingRequestIds    = parse(byKey['meetingRequests.handled']);
			this.myOutgoingMeetingRequestIds = parse(byKey['meetingRequests.mine']);
			this.handledAcceptanceIds        = parse(byKey['meetingRequests.acceptancesHandled']);
			this.acceptedMeetingRequestIds   = parse(byKey['meetingRequests.accepted']);
			this.metPeerUris                 = parse(byKey['meetingRequests.metPeers']);
		} catch (e) {
			console.log('_hydrateMeetingHandshakeState failed', e);
		}
	}

	async _persistMeetingHandshakeState() {
		try {
			await AsyncStorage.multiSet([
				['meetingRequests.handled', JSON.stringify([...this.handledMeetingRequestIds])],
				['meetingRequests.mine', JSON.stringify([...this.myOutgoingMeetingRequestIds])],
				['meetingRequests.acceptancesHandled', JSON.stringify([...this.handledAcceptanceIds])],
				['meetingRequests.accepted', JSON.stringify([...this.acceptedMeetingRequestIds])],
				['meetingRequests.metPeers', JSON.stringify([...(this.metPeerUris || [])])],
			]);
		} catch (e) {
			console.log('_persistMeetingHandshakeState failed', e);
		}
	}

	_parseExpiresToMs(v) {
		if (typeof v === 'number') return v;
		if (typeof v === 'string') {
			const t = new Date(v).getTime();
			return isNaN(t) ? null : t;
		}
		return null;
	}

	// --- Human-readable [meet] narrative logger --------------------------
	// These emit a compact lifecycle trail, one line per event. Designed to
	// be readable at a glance without scrolling through per-tick noise.
	//
	//   [meet] INVITATION SENT → <peer> — session <id8> expires <hh:mm>
	//   [meet] INVITATION RECEIVED ← <peer> — session <id8> expires <hh:mm>
	//   [meet] ACCEPTED ← <peer> — session <id8>
	//   [meet] PEER ACCEPTED — session <id8> (both sides sharing)
	//   [meet] Distance: ~<N> <unit> — session <id8>  (band change only)
	//   [meet] Proximity dwell started — <N> m — session <id8>
	//   [meet] PROXIMITY MET — session <id8>
	//   [meet] SESSION ENDED — reason=<why> session <id8>
	_meetShortId(id) {
		if (!id) return '????????';
		const s = String(id);
		return s.length > 8 ? s.slice(0, 8) : s;
	}

	_meetFormatExpires(expiresAt) {
		if (typeof expiresAt !== 'number' || !isFinite(expiresAt)) return '(no-expiry)';
		try {
			const d = new Date(expiresAt);
			const hh = String(d.getHours()).padStart(2, '0');
			const mm = String(d.getMinutes()).padStart(2, '0');
			return hh + ':' + mm;
		} catch (e) {
			return '(invalid)';
		}
	}

	_meetDistanceBand(meters) {
		if (meters == null || !isFinite(meters)) return 'unknown';
		if (meters <= 10)   return 'proximity';     // meeting threshold
		if (meters <= 100)  return 'tens';          // 11–100 m
		if (meters <= 1000) return 'hundreds';      // 101 m – 1 km
		if (meters <= 10000) return 'km';           // 1–10 km
		return 'far';                                // > 10 km
	}

	_meetFormatDistance(meters) {
		if (meters == null || !isFinite(meters)) return '?';
		if (meters < 1000) return Math.round(meters) + ' m';
		return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
	}

	// High-level narrative meeting-lifecycle events. These are routed
	// through utils.timestampedLog so they land in the persisted user-
	// facing log file (exposed in the app's logs UI), not just the dev
	// console. Low-level `[meet] propagate …` diagnostics remain on
	// plain console.log (they're too noisy for the user log).
	_reportMeetingInvitationSent(requestId, peerUri, expiresAt) {
		utils.timestampedLog('[meet] INVITATION SENT →', peerUri,
			'— session', this._meetShortId(requestId),
			'expires', this._meetFormatExpires(expiresAt));
	}

	_reportMeetingInvitationReceived(requestId, fromUri, expiresAt) {
		utils.timestampedLog('[meet] INVITATION RECEIVED ←', fromUri,
			'— session', this._meetShortId(requestId),
			'expires', this._meetFormatExpires(expiresAt));
	}

	_reportMeetingAccepted(requestId, fromUri) {
		utils.timestampedLog('[meet] ACCEPTED ←', fromUri,
			'— session', this._meetShortId(requestId));
	}

	_reportPeerAccepted(requestId, fromUri) {
		utils.timestampedLog('[meet] PEER ACCEPTED — session', this._meetShortId(requestId),
			'peer=', fromUri, '(both sides sharing)');
	}

	_reportMeetingDistance(sessionId, meters) {
		if (meters == null || !isFinite(meters)) return;
		const band = this._meetDistanceBand(meters);
		const prev = this._meetLastDistanceBand[sessionId];
		if (prev === band) return;
		this._meetLastDistanceBand[sessionId] = band;
		utils.timestampedLog('[meet] Distance: ~' + this._meetFormatDistance(meters),
			'— session', this._meetShortId(sessionId),
			'(band', prev ? prev + '→' + band : band, ')');
	}

	_reportProximityDwellStarted(sessionId, meters) {
		utils.timestampedLog('[meet] Proximity dwell started —',
			this._meetFormatDistance(meters),
			'— session', this._meetShortId(sessionId));
	}

	_reportProximityMet(sessionId, meters) {
		utils.timestampedLog('[meet] PROXIMITY MET — session', this._meetShortId(sessionId),
			'distance=', this._meetFormatDistance(meters));
	}

	_reportMeetingEnded(sessionId, reason) {
		utils.timestampedLog('[meet] SESSION ENDED — reason=' + (reason || 'unknown'),
			'session', this._meetShortId(sessionId));
		delete this._meetLastDistanceBand[sessionId];
	}

	_noteOutgoingMeetingRequest(requestId, expiresAt, peerUri) {
		if (!requestId) return;
		const firstTimeSeen = !this.myOutgoingMeetingRequestIds.has(requestId);
		if (firstTimeSeen) {
			this.myOutgoingMeetingRequestIds.add(requestId);
			this._persistMeetingHandshakeState();
			this._reportMeetingInvitationSent(requestId, peerUri, expiresAt);
		}
		// Sender-side wipe: triggers on our device at expiresAt regardless
		// of whether the accepter ever joins. Uses this.state.accountId as
		// the conversation URI only if peerUri is missing — in normal flow
		// peerUri is the remote contact's uri.
		if (typeof expiresAt === 'number' && expiresAt > Date.now()) {
			this._scheduleMeetingSessionWipe(requestId, peerUri, expiresAt);
		}
	}

	_noteIncomingMeetingRequest(fromUri, metadataContent) {
		const requestId = metadataContent.messageId;
		if (!requestId) return;
		const expiresAt = this._parseExpiresToMs(metadataContent.expires);
		// Even if the user has already dismissed / accepted this request,
		// we still want the wipe timer — the messages are the same and
		// should disappear at session end regardless of user action.
		if (typeof expiresAt === 'number' && expiresAt > Date.now()) {
			this._scheduleMeetingSessionWipe(requestId, fromUri, expiresAt);
		}
		if (this.handledMeetingRequestIds.has(requestId)) return;
		if (expiresAt == null || Date.now() >= expiresAt) {
			// Silently swallow already-expired requests — no modal, no note.
			this.handledMeetingRequestIds.add(requestId);
			this._persistMeetingHandshakeState();
			return;
		}
		this.pendingMeetingRequests[fromUri] = {requestId, expiresAt, fromUri};
		this._reportMeetingInvitationReceived(requestId, fromUri, expiresAt);
		// If we're already looking at this chat, pop the modal now.
		if (this.state.selectedContact && this.state.selectedContact.uri === fromUri) {
			this._presentMeetingRequestForUri(fromUri);
		}
	}

	// Arm a one-shot BackgroundTimer for session expiry. Idempotent —
	// repeat calls for the same sessionId are no-ops, so it's safe to
	// invoke from both the outgoing-echo path and the incoming-request
	// path on the same device (won't happen in practice but cheap to
	// guard).
	_scheduleMeetingSessionWipe(sessionId, uri, expiresAt) {
		if (!sessionId) return;
		if (this.meetingSessionWipeTimers[sessionId]) return;
		const delay = Math.max(0, expiresAt - Date.now());
		// BackgroundTimer.setTimeout fires on a real alarm on Android and
		// is reliable in foreground on iOS. If the app is killed before
		// the timer fires, the next boot's hydrate path could replay the
		// wipe — but we keep the scheme simple: if the user kills the
		// app, cleanup happens on the NEXT interaction with that chat
		// after expires_at (see the defensive check at the top of the
		// wipe method itself). Good enough for a privacy feature where
		// "eventually" is acceptable.
		const id = BackgroundTimer.setTimeout(() => {
			delete this.meetingSessionWipeTimers[sessionId];
			this._wipeMeetingSession(sessionId, uri, 'expired');
		}, delay);
		this.meetingSessionWipeTimers[sessionId] = id;
		console.log('[meeting] scheduled wipe for session', sessionId,
			'uri=', uri, 'in', Math.round(delay / 1000), 's');
	}

	// Tear down every persisted trace of this session on THIS device.
	// Callable from the scheduled timer or from a defensive check on
	// session open (e.g. re-entering a chat whose session already
	// expired while the app was killed).
	//
	// What we delete:
	//   • the message whose msg_id === sessionId (the request origin)
	//   • every message whose msg_text content JSON references this
	//     sessionId (metadataContent.messageId / metadataId / in_reply_to)
	//
	// What we keep:
	//   • everything with system=1 (the saveSystemMessage rows — those
	//     are the "started sharing", "peer accepted", "sharing expired"
	//     breadcrumbs per product decision).
	async _wipeMeetingSession(sessionId, uri, reason) {
		if (!sessionId) return;
		this._reportMeetingEnded(sessionId, reason);

		// 1. If a live share is still running on this device for this uri
		//    AND its origin/accept points at this session, stop it first.
		try {
			const navBar = this.navigationBarRef && this.navigationBarRef.current;
			if (navBar && typeof navBar.stopLocationSharing === 'function' && uri) {
				navBar.stopLocationSharing(uri, {silent: true, reason: 'expired'});
			}
		} catch (e) {
			console.log('[meeting] wipe: stop share failed', e);
		}

		// 2. SQL wipe. LIKE on the `metadata` column is what we rely on
		//    for encrypted rows (the `content` column holds PGP ciphertext
		//    when encrypted=1, so it won't contain the sessionId). The
		//    `metadata` column is always stored as plaintext JSON for
		//    location rows (see saveIncomingMessage / saveOutgoingMessage
		//    — both write JSON.stringify(metadataContent) there). We also
		//    search `content` as a belt-and-braces for non-encrypted
		//    rows. Session id is a UUID so false positives are
		//    vanishingly unlikely.
		try {
			const contentType = 'application/sylk-message-metadata';
			const likePattern = '%' + sessionId + '%';
			await this.ExecuteQuery(
				'delete from messages where (system is null or system = 0) and content_type = ? and (msg_id = ? or content like ? or metadata like ?)',
				[contentType, sessionId, likePattern, likePattern]
			);
		} catch (e) {
			console.log('[meeting] wipe SQL failed', e && e.message ? e.message : e);
		}

		// 3. In-memory state. Drop the bubble(s) from state.messages[uri]
		//    and the per-session metadata accumulator. Keeping system
		//    messages intact is implicit — they're keyed by their own
		//    msg_ids, not by the session id.
		if (uri) {
			this.setState(prev => {
				const prevList = (prev.messages && prev.messages[uri]) || null;
				const next = {};
				let changed = false;

				if (prevList) {
					const filtered = prevList.filter(m => {
						if (!m) return true;
						if (m._id === sessionId) return false;
						const md = m.metadata;
						if (!md) return true;
						if (md.messageId === sessionId) return false;
						if (md.metadataId === sessionId) return false;
						if (md.in_reply_to === sessionId) return false;
						return true;
					});
					if (filtered.length !== prevList.length) {
						next.messages = {...prev.messages, [uri]: filtered};
						changed = true;
					}
				}

				// Strip session-keyed metadata from allContacts entries so
				// a re-entry to the chat doesn't re-inject a stale bubble.
				if (prev.allContacts) {
					const idx = prev.allContacts.findIndex(c => c.uri === uri);
					if (idx !== -1) {
						const c = prev.allContacts[idx];
						if (c.messagesMetadata && c.messagesMetadata[sessionId]) {
							const newMeta = {...c.messagesMetadata};
							delete newMeta[sessionId];
							const newContact = {...c, messagesMetadata: newMeta};
							const newContacts = [...prev.allContacts];
							newContacts[idx] = newContact;
							next.allContacts = newContacts;
							if (prev.selectedContact && prev.selectedContact.uri === uri) {
								next.selectedContact = newContact;
							}
							next.messagesMetadata = newMeta;
							changed = true;
						}
					}
				}

				return changed ? next : null;
			});
		}

		// 4. Clean up the handshake markers for this session. We keep
		//    them in persistent storage for completeness (so a re-sync
		//    from server history can't replay a handled request), but
		//    prune the in-memory sets to let GC reclaim them over time.
		// (We intentionally DO NOT remove from handledMeetingRequestIds
		//  / handledAcceptanceIds — those markers guard against ever
		//  re-prompting for an already-consumed session, even if the
		//  server re-delivers the message later. They're small.)
		if (this.meetingSessions && this.meetingSessions[sessionId]) {
			delete this.meetingSessions[sessionId];
		}
	}

	_presentMeetingRequestForUri(uri) {
		const entry = this.pendingMeetingRequests[uri];
		if (!entry) return;
		if (this.handledMeetingRequestIds.has(entry.requestId)) {
			delete this.pendingMeetingRequests[uri];
			return;
		}
		if (Date.now() >= entry.expiresAt) {
			this.handledMeetingRequestIds.add(entry.requestId);
			this._persistMeetingHandshakeState();
			delete this.pendingMeetingRequests[uri];
			return;
		}
		// Mark handled BEFORE showing so there's no window where a
		// re-entry (second tick, chat-reopen, hot reload) can pop the
		// modal a second time. This is the "show once" guarantee.
		this.handledMeetingRequestIds.add(entry.requestId);
		this._persistMeetingHandshakeState();
		console.log('[meeting] presenting modal for', uri, 'request', entry.requestId,
			'(2s delay)');
		// Small delay so the modal doesn't slam in over whatever screen
		// animation is in progress (chat opening, nav transition, etc.).
		// Gives the user a moment to orient before the dialog appears.
		const entryCopy = {
			fromUri: entry.fromUri,
			requestId: entry.requestId,
			expiresAt: entry.expiresAt,
		};
		delete this.pendingMeetingRequests[uri];
		setTimeout(() => {
			// Defensive: the request could have expired during the delay,
			// or the session could have been cleaned up (remote cancel).
			if (Date.now() >= entryCopy.expiresAt) {
				console.log('[meeting] delayed modal: request expired during delay, skipping',
					entryCopy.requestId);
				return;
			}
			this.setState({meetingRequestModal: {
				show: true,
				fromUri: entryCopy.fromUri,
				requestId: entryCopy.requestId,
				expiresAt: entryCopy.expiresAt,
			}});
		}, 2000);
	}

	_closeMeetingRequestModal() {
		this.setState({meetingRequestModal: {
			show: false, fromUri: null, requestId: null, expiresAt: null,
		}});
	}

	// Accepts a meeting request. By default it reads fromUri / requestId /
	// expiresAt out of the modal state (the modal path), but can also be
	// called with an explicit {fromUri, requestId, expiresAt} payload from
	// non-modal entry points — e.g. the kebab menu on the incoming
	// meeting-request bubble after the modal has already been dismissed.
	_acceptMeetingRequest(args) {
		const src = args || this.state.meetingRequestModal;
		const fromUri    = src && src.fromUri;
		const requestId  = src && src.requestId;
		const expiresAt  = src && src.expiresAt;
		if (!fromUri || !requestId) return;
		// Guard against late/duplicate accepts: if the request already
		// expired, or if we've already accepted it, do nothing.
		if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
			console.log('[meeting] accept: request expired, ignoring', 'id=', requestId);
			return;
		}
		if (this.acceptedMeetingRequestIds && this.acceptedMeetingRequestIds.has(requestId)) {
			console.log('[meeting] accept: already accepted, ignoring', 'id=', requestId);
			return;
		}
		const navBar = this.navigationBarRef && this.navigationBarRef.current;
		if (!navBar || typeof navBar.startMeetingAcceptance !== 'function') {
			console.log('[meeting] accept: NavigationBar not available');
			return;
		}
		this._reportMeetingAccepted(requestId, fromUri);
		// Remember that we accepted this incoming request so the outgoing
		// reply tick we are about to send doesn't get its own bubble in
		// _injectLocationBubble — it gets merged into the existing
		// incoming request bubble as peerCoords instead.
		if (!this.acceptedMeetingRequestIds.has(requestId)) {
			this.acceptedMeetingRequestIds.add(requestId);
			this._persistMeetingHandshakeState();
		}
		navBar.startMeetingAcceptance(fromUri, {
			requestId: requestId,
			expiresAt: expiresAt,
			periodLabel: 'until we meet',
		});
	}

	// Predicate exposed as a prop so UI below (kebab menu) can decide whether
	// to surface the "Accept meeting request" option. Treats expired requests
	// as "not acceptable" too.
	isMeetingRequestAcceptable(requestId, expiresAt) {
		if (!requestId) return false;
		if (this.acceptedMeetingRequestIds && this.acceptedMeetingRequestIds.has(requestId)) {
			return false;
		}
		if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
			return false;
		}
		return true;
	}

	// Decline is silent — no message goes back to the requester. We've
	// already marked the request handled at _presentMeetingRequestForUri
	// time, so there's nothing else to do beyond letting the modal close.
	_declineMeetingRequest() { /* no-op */ }

	// Has this meeting session progressed past the acceptance handshake?
	// Exposed as a prop to NavigationBar so stopLocationSharing can
	// pick the right vocabulary for its system notes: before acceptance
	// we call the thing a "Meeting request" (it's still a request, the
	// peer hasn't responded yet); after acceptance it's just a "Meeting"
	// because the label of "request" stops making sense — both sides
	// are actively sharing.
	//
	// Accepted on either side counts:
	//   • this device was the accepter → acceptedMeetingRequestIds has it
	//   • this device was the requester → handledAcceptanceIds has it
	//     once we've seen the peer's first reply tick
	isMeetingSessionAccepted(sessionId) {
		if (!sessionId) return false;
		if (this.acceptedMeetingRequestIds
			&& this.acceptedMeetingRequestIds.has(sessionId)) {
			return true;
		}
		if (this.handledAcceptanceIds
			&& this.handledAcceptanceIds.has(sessionId)) {
			return true;
		}
		return false;
	}

	_noteIncomingAcceptanceTick(fromUri, metadataContent) {
		const refId = metadataContent.in_reply_to;
		if (!refId) return;
		if (!this.myOutgoingMeetingRequestIds.has(refId)) return;
		if (this.handledAcceptanceIds.has(refId)) return;
		this.handledAcceptanceIds.add(refId);
		this._persistMeetingHandshakeState();
		this._reportPeerAccepted(refId, fromUri);
		// No system note here. The accepter now sends a real text message
		// ("I want to meet with you, too!") on acceptance, which arrives
		// just ahead of the first reply tick and serves as the handshake
		// marker on both sides. A "Meeting request accepted" system note
		// would be redundant next to that text.
	}

	// Per-tick pair update for meeting sessions. Determines which session
	// this tick belongs to (if any) and which side of it it came from,
	// then stores the latest coords on the matching side. Returns
	// {sessionId, side, peerUri} if the tick was paired, else null.
	//
	// Tick → (sessionId, side) classification:
	//   • in_reply_to present               → session=in_reply_to, side='accepter'
	//   • meeting_request:true + messageId  → session=messageId,   side='requester' (origin)
	//   • messageId in myOutgoingMeetingRequestIds → session=messageId, side='requester'
	//     (continuation tick of our own request; follow-up ticks don't
	//     restamp meeting_request:true.)
	//   • messageId matches a known session's requesterOriginId
	//     or accepterOriginId                → matching session + side
	//     (covers continuation ticks once we've already seen the origin.)
	_updateMeetingSessionCoords(metadataContent, conversationUri) {
		if (!metadataContent || metadataContent.action !== 'location') return null;
		const mid = metadataContent.messageId;
		if (!mid) return null;

		let sessionId = null;
		let side = null;

		if (metadataContent.in_reply_to) {
			sessionId = metadataContent.in_reply_to;
			side = 'accepter';
		} else if (metadataContent.meeting_request === true) {
			sessionId = mid;
			side = 'requester';
		} else if (this.myOutgoingMeetingRequestIds.has(mid)) {
			sessionId = mid;
			side = 'requester';
		} else {
			// Fallback: continuation tick for a session we've already
			// classified. Look it up by known origin ids.
			for (const [sid, s] of Object.entries(this.meetingSessions)) {
				if (!s) continue;
				if (s.requesterOriginId === mid) { sessionId = sid; side = 'requester'; break; }
				if (s.accepterOriginId  === mid) { sessionId = sid; side = 'accepter';  break; }
			}
		}

		if (!sessionId || !side) return null;

		const s = this.meetingSessions[sessionId] || {};
		// Record origin ids and conversation uri for each side the first
		// time we see them. conversationUri is the "other party" from this
		// device's perspective — it's the right key for state.messages.
		if (side === 'requester') {
			if (!s.requesterOriginId) s.requesterOriginId = mid;
			if (!s.requesterUri && conversationUri) s.requesterUri = conversationUri;
		} else {
			if (!s.accepterOriginId) s.accepterOriginId = mid;
			if (!s.accepterUri && conversationUri) s.accepterUri = conversationUri;
		}

		const v = metadataContent.value;
		if (v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
			const coords = {
				latitude: v.latitude,
				longitude: v.longitude,
				accuracy: typeof v.accuracy === 'number' ? v.accuracy : null,
				timestamp: metadataContent.timestamp || Date.now(),
			};
			if (side === 'requester') s.requesterCoords = coords;
			else                      s.accepterCoords  = coords;
		}
		this.meetingSessions[sessionId] = s;
		return {sessionId, side, peerUri: conversationUri, session: s};
	}

	// Persist the pair state (peerCoords + distanceMeters) into the
	// `metadata` column of a given origin row, so the two-pin view survives
	// an app restart. The synthesis block in getMessages() reads the full
	// metadata blob and carries every field through to the rendered bubble,
	// so stamping these onto the origin row is enough — no schema change
	// needed.
	//
	// Cleanup is handled by _wipeMeetingSession (step 2, SQL DELETE of rows
	// referencing sessionId) — we never need to strip peerCoords on their
	// own, because the whole row goes when the session ends.
	//
	// Race note: follow-up tick UPDATEs also overwrite this column, and
	// could land after our stamp if the network is slow. Worst case is one
	// missing tick's worth of peerCoords; the next tick's propagation
	// re-stamps. Acceptable for a 60-second tick cadence, and the end-of-
	// dialog delete makes it moot anyway.
	_persistPeerCoordsToSql(originMsgId, updatedMetadataEntry) {
		if (!originMsgId || !updatedMetadataEntry) return;
		let metadataJson;
		try {
			metadataJson = JSON.stringify(updatedMetadataEntry);
		} catch (e) {
			console.log('[meeting] persist peerCoords: stringify failed', e);
			return;
		}
		this.ExecuteQuery(
			"update messages set metadata = ? where msg_id = ? and account = ?",
			[metadataJson, originMsgId, this.state.accountId]
		).then((result) => {
			const rows = result && result.rowsAffected;
			console.log('[meeting] persisted peerCoords msg_id=', originMsgId,
				'rowsAffected=', rows);
		}).catch((error) => {
			console.log('[meeting] persist peerCoords SQL error:',
				error && error.message ? error.message : error);
		});
	}

	// Compute great-circle distance between two coord pairs, in metres.
	// Haversine — plenty accurate for "are we in the same coffee shop"
	// scale distances and cheap enough to call on every tick.
	_haversineMeters(a, b) {
		if (!a || !b) return null;
		if (typeof a.latitude !== 'number' || typeof a.longitude !== 'number') return null;
		if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number') return null;
		const R = 6371000;
		const toRad = (d) => (d * Math.PI) / 180;
		const dLat = toRad(b.latitude - a.latitude);
		const dLng = toRad(b.longitude - a.longitude);
		const lat1 = toRad(a.latitude);
		const lat2 = toRad(b.latitude);
		const h = Math.sin(dLat / 2) ** 2
			+ Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
		const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
		return R * c;
	}

	// Patch peerCoords (+ distance) into the latest 'location' metadata
	// entry of each bubble that belongs to this session, so LocationBubble
	// can read them off metadata.peerCoords / metadata.distanceMeters on
	// its next render.
	//
	// We update both this.state.messagesMetadata (flat map used by
	// ContactsListBox's locationData getter) and the mirrored copy inside
	// allContacts[uri].messagesMetadata — the tick setState above keeps
	// these in sync, so we do too.
	_propagatePeerCoordsForSession(sessionId, conversationUri) {
		const s = this.meetingSessions[sessionId];
		if (!s) return;
		const {requesterOriginId, requesterCoords, accepterOriginId, accepterCoords} = s;
		// Need at least one coord pair and both origin ids for the current
		// conversation to make a difference. If only one origin is known
		// on this device (e.g. the remote side's accept bubble hasn't
		// arrived yet) we still stamp peerCoords on whatever we have.
		if (!requesterCoords && !accepterCoords) return;

		const distance = this._haversineMeters(requesterCoords, accepterCoords);
		this._reportMeetingDistance(sessionId, distance);

		// Proximity auto-end. If the two participants have been within
		// MEETING_PROXIMITY_METERS of each other for MEETING_PROXIMITY_DWELL_MS
		// continuously, treat the meetup as completed: notify the user
		// locally, relay a meeting_end signal to the peer, stop this side's
		// share, and wipe the session. Gated by a once-per-session flag so
		// a stream of "near" ticks doesn't replay the alert. Called here
		// (and not in _updateMeetingSessionCoords) because we need both
		// coords populated, which is the same precondition this routine
		// already enforces above.
		this._maybeFireProximityMeet(sessionId, conversationUri, distance);

		this.setState(prev => {
			if (!prev || !prev.allContacts) return null;
			const idx = prev.allContacts.findIndex(c => c.uri === conversationUri);
			if (idx === -1) {
				console.log('[meet] propagate: contact NOT FOUND for uri=', conversationUri,
					'— session', this._meetShortId(sessionId));
				return null;
			}
			const oldContact = prev.allContacts[idx];
			// Same drift trap as handleMessageMetadata's setState: basing
			// newMm solely on oldContact.messagesMetadata and then writing
			// it back to the top level quietly rolls OTHER mIds back to
			// whatever the contact mirror last had. Merge top-level on top
			// so the freshest per-mId entries survive — peerCoords that
			// were stamped by a prior run of this same routine live at the
			// top level and would be lost otherwise.
			const prevTopMeta = prev.messagesMetadata || {};
			const prevContactMeta = oldContact.messagesMetadata || {};
			const prevMm = {...prevContactMeta, ...prevTopMeta};
			const newMm = {...prevMm};
			let changed = false;

			console.log('[meet] propagate START — session', this._meetShortId(sessionId),
				'reqOrigin=', this._meetShortId(requesterOriginId),
				'accOrigin=', this._meetShortId(accepterOriginId),
				'haveReqCoords=', !!requesterCoords,
				'haveAccCoords=', !!accepterCoords,
				'topHasReq=', !!prevTopMeta[requesterOriginId],
				'topHasAcc=', !!prevTopMeta[accepterOriginId],
				'mirrorHasReq=', !!prevContactMeta[requesterOriginId],
				'mirrorHasAcc=', !!prevContactMeta[accepterOriginId]);

			const applyPeer = (originId, peerCoords, label) => {
				if (!originId) {
					console.log('[meet] propagate', label, 'skip — no originId');
					return;
				}
				// No peer yet (one side hasn't been seen on this device) —
				// don't overwrite an absent peerCoords with explicit null.
				// Leaves the bubble showing a single pin until pairing
				// completes, which is the correct visual.
				if (!peerCoords) {
					console.log('[meet] propagate', label, 'skip — no peerCoords for',
						this._meetShortId(originId));
					return;
				}
				const arr = prevMm[originId];
				if (!Array.isArray(arr) || arr.length === 0) {
					console.log('[meet] propagate', label, 'skip — empty metadata array for',
						this._meetShortId(originId),
						'(arrType=', typeof arr, 'len=', Array.isArray(arr) ? arr.length : '?)');
					return;
				}
				// Find the most recent 'location' entry (may not be last).
				let realIdx = -1;
				for (let i = arr.length - 1; i >= 0; i--) {
					if (arr[i] && arr[i].action === 'location') { realIdx = i; break; }
				}
				if (realIdx < 0) {
					console.log('[meet] propagate', label, 'skip — no location entry in array for',
						this._meetShortId(originId));
					return;
				}
				const existing = arr[realIdx];
				// Cheap equality check — skip setState if nothing changed.
				const same = existing.peerCoords
					&& existing.peerCoords.latitude === peerCoords.latitude
					&& existing.peerCoords.longitude === peerCoords.longitude
					&& existing.distanceMeters === distance;
				if (same) return;
				const updated = {
					...existing,
					peerCoords,
					distanceMeters: distance,
				};
				const newArr = [...arr];
				newArr[realIdx] = updated;
				newMm[originId] = newArr;
				changed = true;
				// Persist to SQL on the same path — the origin row for this
				// side exists on this device regardless of direction (both
				// saveOutgoingMessage and saveIncomingMessage INSERT one on
				// origin tick). Scheduling the UPDATE outside setState so
				// the state commit isn't blocked on SQL; the helper is
				// fire-and-forget and logs its own errors.
				this._persistPeerCoordsToSql(originId, updated);
			};

			applyPeer(requesterOriginId, accepterCoords, 'req←acc');
			applyPeer(accepterOriginId, requesterCoords, 'acc←req');

			if (!changed) {
				console.log('[meet] propagate END — no changes for session',
					this._meetShortId(sessionId));
				return null;
			}
			console.log('[meet] propagate END — stamped for session',
				this._meetShortId(sessionId));

			const updatedContact = {...oldContact, messagesMetadata: newMm};
			const newContacts = [...prev.allContacts];
			newContacts[idx] = updatedContact;

			const next = {
				allContacts: newContacts,
				messagesMetadata: newMm,
			};
			if (prev.selectedContact && prev.selectedContact.uri === conversationUri) {
				next.selectedContact = updatedContact;
			}
			return next;
		});
	}

	// Proximity gate for "Until we meet" auto-end. Called on every tick
	// after peerCoords are paired. Three possible outcomes per call:
	//
	//   • distance > threshold → reset dwell ("they drifted apart")
	//   • distance ≤ threshold but dwell not reached → remember when the
	//     near phase started and bail (waiting for sustained proximity)
	//   • distance ≤ threshold for ≥ dwell window → FIRE: notify user,
	//     relay meeting_end to peer, stop this side's share, wipe session.
	//
	// The once-per-session `proximityFired` flag guards against double-
	// firing before the session is torn down (the wipe is async — a tick
	// in flight could re-enter this block before meetingSessions[sid]
	// is deleted).
	//
	// Threshold / dwell tuning notes:
	//   • 10 m is "arm's length / same table" with consumer GPS. Tight
	//     enough to mean "they're actually at the same spot," at the
	//     cost of tolerating less GPS jitter — a single bad fix can
	//     push the reported distance past 10 m even when the phones
	//     are side by side. The dwell debounce below absorbs that.
	//   • 60 s dwell prevents a one-tick GPS glitch from killing an active
	//     session while the users are actually still walking toward each
	//     other. At the default 60 s tick cadence that's roughly "two
	//     ticks in a row both near" — reasonable signal / noise ratio.
	_maybeFireProximityMeet(sessionId, conversationUri, distance) {
		if (distance == null) return;
		const s = this.meetingSessions[sessionId];
		if (!s) return;
		if (s.proximityFired) return;

		// 10 m is "arm's length / same table / same doorway" — i.e. the
		// two phones are really at the same spot, not just nearby. This
		// is tighter than the "same block" 50 m earlier drafts used; the
		// downside is we're now squarely inside consumer-GPS noise (5–15 m
		// CEP is typical outdoors, worse indoors), so a single noisy fix
		// can bounce above the threshold. DWELL_MS + accuracy-aware gating
		// below absorb that — we require the sustained-near state, not a
		// single tick, AND we refuse to trust fixes whose reported
		// accuracy is too coarse to resolve proximity at 10 m.
		//
		// 15 s dwell is a deliberately-short debounce: at a 1-tick-every-
		// few-seconds cadence that's roughly 2–3 sustained near ticks
		// before we fire. Earlier drafts used 60 s, which felt unresponsive
		// when two people were clearly together at 2–3 m apart — by the
		// time they pulled out the phone to check, they'd been staring at
		// "distance: 3 m" for a minute.
		//
		// No accuracy gate on the meetup-confirmed fire (see comment on
		// the distance check below). Indoors / weak-GPS environments
		// report coarse accuracy (±50–150 m via cell+wifi positioning)
		// even when phones are side-by-side; gating on accuracy prevents
		// the meeting from ever auto-ending in that common case. Trust
		// the reported distance; DWELL_MS debounces single-tick glitches.
		// THRESHOLD_M raised from 10 m to 20 m after indoor testing: two
		// phones in the same room, with the peer physically within arm's
		// reach, consistently reported ~14 m apart because consumer GPS
		// accuracy indoors is ~20 m (reported by both iOS and Android as
		// `accuracy: 20` in the logs). A 10 m cutoff meant the meetup-
		// confirmed fire never triggered for in-building meetings. 20 m
		// matches that observed indoor accuracy floor while still being
		// tight enough that "within the same building" is the scale at
		// which we consider the meeting complete.
		const THRESHOLD_M = 20;
		const ALERT_THRESHOLD_M = 250;
		const DWELL_MS = 15 * 1000;

		// First-proximity heads-up — fire BEFORE the strict accuracy
		// gate and BEFORE effDistance-based dwell logic. Rationale: the
		// "You are close to each other" push is a low-stakes hint with
		// no permanent side-effects (no chat message, no session teardown),
		// so we'd rather err on the side of "tell the user they might be
		// nearby" than "stay silent because one device briefly reported a
		// coarse fix". Using the RAW reported distance here — no accuracy
		// adjustment — so the alert still fires when one device has a
		// coarse fix.
		//
		// ALERT_THRESHOLD_M (20 m) is intentionally roomier than
		// THRESHOLD_M (10 m): "close to each other" should trigger as the
		// phones approach, not only once they're already at the meetup
		// point. 20 m is about "in the same shop / around the corner" —
		// the right scale for a heads-up. The meetup-confirmed fire below
		// keeps the tighter 10 m threshold with the accuracy-aware gate.
		//
		// Once-per-session via s.proximityAlertSent; a subsequent
		// near→far→near bounce won't retrigger. Session teardown wipes
		// the object so a future meeting starts with a fresh flag.
		if (!s.proximityAlertSent && distance < ALERT_THRESHOLD_M) {
			s.proximityAlertSent = true;
			console.log('[meeting] proximity alert fired for session',
				sessionId, 'distance=', Math.round(distance), 'm',
				'(threshold', ALERT_THRESHOLD_M, 'm)');
			this._showProximityAlertNotification(conversationUri);
		}

		// MEETUP-CONFIRMED fire. Uses the raw reported distance — no
		// accuracy gate, no effDistance inflation. If both devices are
		// reporting they're within THRESHOLD_M of each other, treat that
		// as "they met" regardless of whether GPS claims ±5 m or ±150 m
		// precision. The indoor / weak-GPS case is the motivating one:
		// accuracy there is routinely ±50–150 m even when phones are
		// physically touching, and an accuracy-gated fire would never
		// trigger. DWELL_MS below still debounces single-tick glitches.
		// accA/accB are retained purely for logging — they no longer
		// affect the decision.
		const accA = s.requesterCoords && typeof s.requesterCoords.accuracy === 'number'
			? s.requesterCoords.accuracy : null;
		const accB = s.accepterCoords && typeof s.accepterCoords.accuracy === 'number'
			? s.accepterCoords.accuracy : null;

		if (distance > THRESHOLD_M) {
			if (s.nearSince) {
				console.log('[meeting] proximity dwell reset for session',
					sessionId, 'distance=', Math.round(distance), 'm',
					'accA=', accA == null ? '(none)' : Math.round(accA) + ' m',
					'accB=', accB == null ? '(none)' : Math.round(accB) + ' m');
			}
			s.nearSince = null;
			return;
		}

		const now = Date.now();
		if (!s.nearSince) {
			s.nearSince = now;
			this._reportProximityDwellStarted(sessionId, distance);
			return;
		}

		const dwelled = now - s.nearSince;
		if (dwelled < DWELL_MS) {
			return;
		}

		// Fire: flip the flag first so any re-entry bails immediately.
		s.proximityFired = true;
		this._reportProximityMet(sessionId, distance);

		// Local notification on this device — "You met!". Shown whether the
		// app is foreground or background; when foreground the OS still
		// raises it as a banner (see sendLocalNotification for the
		// established iOS pattern).
		this._showMeetingProximityNotification(conversationUri, distance);

		// Emit the initiator-only "Meeting succeeded" real chat message for
		// this session. The helper is idempotent across paths — same call
		// happens on meeting_end reason='proximity' reception — so whichever
		// device/path reaches here first wins and the other is deduped. No
		// system note: the chat message carries its own timestamp, which is
		// all the "met at HH:MM" marker we need on both sides.
		this._sendMeetingSucceededIfInitiator(sessionId, conversationUri);

		// Relay meeting_end to the peer BEFORE local wipe, while the
		// NavigationBar timer entry (which carries meetingSessionId) still
		// exists. _wipeMeetingSession calls stopLocationSharing with
		// reason='expired', which is in peerRelayReasons and therefore
		// suppresses the relay — so we fire it explicitly here. The peer
		// will independently hit their own proximity threshold too, but the
		// explicit signal is a belt-and-braces in case one device's GPS is
		// laggy or dropped a tick.
		try {
			const navBar = this.navigationBarRef && this.navigationBarRef.current;
			if (navBar && typeof navBar.sendMeetingEndSignal === 'function' && conversationUri) {
				// reason:'proximity' tells the peer this end was triggered by
				// the proximity-met threshold (not user-initiated / expired /
				// deleted). The peer's meeting_end handler forwards this
				// reason to stopSharesForMeetingSession → stopLocationSharing
				// so the note they emit ("Location sharing stopped at HH:MM")
				// matches the one we just logged locally.
				navBar.sendMeetingEndSignal(conversationUri, sessionId, {reason: 'proximity'});
			}
		} catch (e) {
			console.log('[meeting] proximity sendMeetingEndSignal failed', e);
		}

		// Full session teardown: stops the local timer, wipes SQL rows,
		// strips in-memory state, deletes meetingSessions[sid].
		this._wipeMeetingSession(sessionId, conversationUri, 'proximity');
	}

	// Emit the "Meeting succeeded" chat message when a meeting-session
	// ends via proximity. Called from two independent paths:
	//   • _maybeFireProximityMeet — our own proximity dwell just fired.
	//   • handleMessageMetadata meeting_end with reason='proximity' —
	//     the peer's proximity dwell fired and they signalled us.
	//
	// Both devices may reach one or both of these paths for the same
	// session (each hits its own proximity threshold independently, AND
	// each receives the peer's meeting_end signal). We want a single
	// message per session, so the helper is guarded by
	// _proximityNotedSessionIds — first caller claims the session, later
	// callers are no-ops. Only the initiator (the party whose session id
	// is in myOutgoingMeetingRequestIds) actually sends; the accepter
	// stays silent because they'll receive the initiator's message as a
	// normal incoming chat.
	//
	// Text is intentionally bare ("Meeting succeeded"): the message's
	// own createdAt timestamp supplies the "at HH:MM" display that the
	// transcript already renders next to every bubble. No accompanying
	// system note — the real message is the record of the meetup.
	_sendMeetingSucceededIfInitiator(sessionId, conversationUri) {
		if (!sessionId || !conversationUri) return;
		try {
			if (!this._proximityNotedSessionIds) this._proximityNotedSessionIds = new Set();
			if (this._proximityNotedSessionIds.has(sessionId)) {
				console.log('[meeting] Meeting-succeeded: already emitted for session',
					sessionId, '— skipping dup');
				return;
			}
			// Determine initiator directly from myOutgoingMeetingRequestIds
			// (persisted across restarts). Using this rather than the live
			// meetingSessions[sid] entry means the gate still works after
			// a local proximity fire has already wiped the session, which
			// is the usual case on the peer-signal path.
			const isInitiator = !!(this.myOutgoingMeetingRequestIds
				&& this.myOutgoingMeetingRequestIds.has(sessionId));
			const myOutgoingSize = this.myOutgoingMeetingRequestIds
				? this.myOutgoingMeetingRequestIds.size : 0;
			// Diagnostic trace: if the user reports "no Meeting succeeded
			// message", this log tells us whether the gate failed because
			// we weren't the initiator, because sessionId was missing, or
			// because sendMessage wasn't wired.
			console.log('[meeting] Meeting-succeeded gate:',
				'isInitiator=', isInitiator,
				'session=', sessionId,
				'myOutgoing.size=', myOutgoingSize,
				'conversationUri=', conversationUri);
			if (!isInitiator) return;
			if (typeof this.sendMessage !== 'function') return;
			// Claim the session BEFORE dispatching sendMessage so a
			// simultaneous call on the other path can't race past the
			// dedup check.
			this._proximityNotedSessionIds.add(sessionId);
			const msgId = uuid.v4();
			const now = new Date();
			const message = {
				_id: msgId,
				key: msgId,
				createdAt: now,
				text: 'Meeting succeeded',
				// GiftedChat requires a user field on every outgoing message.
				user: {},
			};
			console.log('[meeting] Meeting-succeeded: initiator sending to',
				conversationUri, 'session=', sessionId, 'messageId=', msgId);
			this.sendMessage(conversationUri, message);
			// Persist "we've met this peer" — not used for text variation
			// anymore (the message is invariant) but retained so a future
			// feature can key off met-before state without another round
			// of migration.
			if (!this.metPeerUris) this.metPeerUris = new Set();
			if (!this.metPeerUris.has(conversationUri)) {
				this.metPeerUris.add(conversationUri);
				if (typeof this._persistMeetingHandshakeState === 'function') {
					this._persistMeetingHandshakeState();
				}
			}
		} catch (e) {
			console.log('[meeting] Meeting-succeeded emit failed',
				e && e.message ? e.message : e);
		}
	}

	// Cross-platform local notification fired the FIRST time the two
	// phones enter the meeting radius for a session. Unlike
	// _showMeetingProximityNotification (which fires after the dwell
	// completes and a meet is "confirmed"), this one is an early
	// heads-up: "the other party is near, look up". Body is invariant
	// — we don't include distance because a noisy 8m reading here is
	// misleading given consumer-GPS scatter; the fact that we crossed
	// the 10m threshold at all is the signal.
	//
	// Same channel/userInfo conventions as the "met" push; event flag
	// distinguishes them for the notification tap-handler.
	_showProximityAlertNotification(uri) {
		let title = uri;
		try {
			const contact = uri ? this.lookupContact(uri) : null;
			if (contact && contact.name) {
				title = contact.name;
			}
		} catch (e) {
			console.log('[meeting] proximity alert: contact lookup failed',
				e && e.message ? e.message : e);
		}
		const body = 'You are close to each other';
		try {
			if (Platform.OS === 'ios') {
				// Use addNotificationRequest (UNUserNotifications). The older
				// presentLocalNotification wraps UILocalNotification which Apple
				// removed in iOS 17 — on iOS 17+ it silently no-ops, so the JS
				// log line "proximity alert fired" is written but no banner is
				// ever delivered. The data envelope mirrors sendLocalNotification
				// so AppDelegate's willPresentNotification handler can read
				// userInfo["data"]["event"] and show the banner in foreground.
				const inner = {from_uri: uri, event: 'meeting_proximity_near'};
				PushNotificationIOS.addNotificationRequest({
					id: `meeting-near-${uri}-${Date.now()}`,
					title: title,
					body: body,
					sound: 'default',
					userInfo: { data: inner },
				});
			} else {
				PushNotification.localNotification({
					channelId: 'sylk-messages',
					title,
					message: body,
					bigText: body,
					subText: 'Until we meet',
					autoCancel: true,
					playSound: true,
					soundName: 'default',
					priority: 'high',
					vibrate: true,
					userInfo: {from_uri: uri, event: 'meeting_proximity_near'},
				});
			}
		} catch (e) {
			console.log('[meeting] proximity alert notification failed',
				e && e.message ? e.message : e);
		}
	}

	// Cross-platform local notification for the proximity-met event.
	// iOS path mirrors the existing sendLocalNotification wrapper;
	// Android path mirrors postAndroidMessageNotification's use of the
	// "sylk-messages" channel so we inherit the already-registered
	// channel config (vibration, importance, icon) instead of minting
	// a new one just for this. Both paths are fire-and-forget — a failed
	// notification must not block the session teardown.
	_showMeetingProximityNotification(uri, distance) {
		// Title = peer's display name (falls back to uri if no cached
		// contact yet) so the banner reads like a message from them,
		// e.g. "Alice — Nice to meet you!". Body matches the initiator's
		// in-chat greeting so push + bubble are consistent.
		let title = uri;
		try {
			const contact = uri ? this.lookupContact(uri) : null;
			if (contact && contact.name) {
				title = contact.name;
			}
		} catch (e) {
			// lookupContact is safe, but keep the fallback explicit —
			// if anything goes sideways we still ship a usable banner.
			console.log('[meeting] proximity notification: contact lookup failed',
				e && e.message ? e.message : e);
		}
		const body = 'Nice to meet you!';
		try {
			if (Platform.OS === 'ios') {
				// Same iOS 17+ fix as _showProximityAlertNotification: the
				// legacy presentLocalNotification (UILocalNotification) is a
				// silent no-op on iOS 17+. Use addNotificationRequest with
				// the {data: ...} envelope so AppDelegate's willPresent
				// handler renders the banner in foreground.
				const inner = {from_uri: uri, event: 'meeting_proximity_met'};
				PushNotificationIOS.addNotificationRequest({
					id: `meeting-met-${uri}-${Date.now()}`,
					title: title,
					body: body,
					sound: 'default',
					userInfo: { data: inner },
				});
			} else {
				PushNotification.localNotification({
					channelId: 'sylk-messages',
					title,
					message: body,
					bigText: body,
					subText: 'Until we meet',
					autoCancel: true,
					playSound: true,
					soundName: 'default',
					priority: 'high',
					vibrate: true,
					userInfo: {from_uri: uri, event: 'meeting_proximity_met'},
				});
			}
		} catch (e) {
			console.log('[meeting] proximity notification failed',
				e && e.message ? e.message : e);
		}
	}

	// Inject a rendered bubble for the first tick of a live-location sharing
	// session. `mId` is the envelope _id of the origin tick; it's also the
	// messagesMetadata key that subsequent update ticks refresh. Update ticks
	// set metadataId to this same id; they don't add another bubble, they
	// just update the existing one via ContactsListBox's metadata watcher.
	_injectLocationBubble(uri, metadataContent, mId) {
		// Only mirror in the rendered messages list for the currently
		// selected contact; state.messages[uri] is only populated for the
		// open conversation.
		if (!this.state.selectedContact || this.state.selectedContact.uri !== uri) {
			console.log('[location] _injectLocationBubble: not in this conversation, skip',
				'selected=', this.state.selectedContact ? this.state.selectedContact.uri : '(none)',
				'tick uri=', uri);
			return;
		}

		// Meeting-request acceptance flow: the accepter's origin tick carries
		// `in_reply_to` pointing at our (the requester's) original request
		// message _id. On the requester's device we already have a bubble for
		// that _id; the peer's coords are merged into it by
		// _propagatePeerCoordsForSession (peerCoords + distanceMeters on the
		// existing metadata entry). Injecting a second bubble keyed by the
		// accepter's own messageId creates the duplicate the user reported.
		//
		// Gate on three conditions so we only suppress the spurious second
		// bubble on the requester side, not legitimate origin bubbles
		// elsewhere:
		//   1. `in_reply_to` is set (this is a reply tick),
		//   2. the tick is incoming (author != our own accountId),
		//   3. `in_reply_to` references one of our outstanding outgoing
		//      meeting request ids — i.e. a bubble we definitely own on
		//      this device.
		if (metadataContent.in_reply_to
			&& metadataContent.author
			&& metadataContent.author !== this.state.accountId
			&& this.myOutgoingMeetingRequestIds
			&& this.myOutgoingMeetingRequestIds.has(metadataContent.in_reply_to)) {
			console.log('[location] _injectLocationBubble: skip — incoming reply to our own request',
				'mId=', mId, 'in_reply_to=', metadataContent.in_reply_to);
			return;
		}

		// Symmetric guard for the ACCEPTER side. After we accept an incoming
		// meeting request, our own outgoing reply tick carries
		// `in_reply_to` pointing at that request _id. The request already
		// has an incoming bubble in this conversation; injecting a second
		// outgoing bubble for our reply would duplicate. Skip it, and let
		// peerCoords merge our coords onto the existing incoming bubble.
		//
		// Gate on: (1) tick is outgoing (author === our accountId),
		// (2) it carries in_reply_to, (3) the referenced request id is
		// one we explicitly accepted on this device.
		if (metadataContent.in_reply_to
			&& metadataContent.author
			&& metadataContent.author === this.state.accountId
			&& this.acceptedMeetingRequestIds
			&& this.acceptedMeetingRequestIds.has(metadataContent.in_reply_to)) {
			console.log('[location] _injectLocationBubble: skip — outgoing reply to a request we accepted',
				'mId=', mId, 'in_reply_to=', metadataContent.in_reply_to);
			return;
		}

		// metadataId == null is the convention for "origin tick, new session".
		// Anything else is a follow-up and the bubble already exists.
		const isOrigin = metadataContent.metadataId == null;
		if (!isOrigin) {
			return;
		}

		const existingList = this.state.messages[uri] || [];
		if (existingList.some(m => m._id === mId)) {
			console.log('[location] _injectLocationBubble: bubble already in list, skip', mId);
			return;
		}

		const direction = metadataContent.author === this.state.accountId
			? 'outgoing'
			: 'incoming';

		const createdAt = metadataContent.timestamp
			? new Date(metadataContent.timestamp)
			: new Date();

		const bubble = {
			_id: mId,
			key: mId,
			createdAt: createdAt,
			// Distinct from 'application/sylk-message-metadata' so the
			// metadata filter in updateRenderMessageState doesn't drop this,
			// and so ContactsListBox.renderMessageText can branch on it.
			contentType: 'application/sylk-live-location',
			metadata: metadataContent,
			// Text is bumped on every subsequent tick (by ContactsListBox)
			// so ChatBubble's memoization detects content changes.
			text: String(createdAt.getTime()),
			direction: direction,
			user: direction === 'incoming'
				? { _id: uri, name: uri }
				: {},
		};

		this.setState(prev => {
			const prevList = prev.messages[uri] || [];
			// Race guard — another setState may have appended it already.
			if (prevList.some(m => m._id === mId)) {
				console.log('[location] _injectLocationBubble: race — already in list', mId);
				return null;
			}
			console.log('[location] _injectLocationBubble: INJECTING bubble',
				'_id=', mId, 'direction=', direction, 'into uri=', uri,
				'(prev count', prevList.length, '→', prevList.length + 1, ')');
			return {
				messages: {
					...prev.messages,
					[uri]: [...prevList, bubble],
				},
			};
		});
	}

    buildLastMessage(message, content=null) {
        // Location sharing shouldn't overwrite the Contacts-list preview
        // because it isn't a typed message — both the auto-generated
        // "I am sharing the location…" announcement (tagged via
        // metadata.locationAnnouncement in NavigationBar.startLocationSharing)
        // and any stray location metadata ticks that slip through here
        // should leave the previous last message untouched. Returning null
        // tells every caller to skip the assignment; existing callers that
        // don't null-check have been updated alongside this change.
        if (message) {
            const md = message.metadata;
            if (md && (md.locationAnnouncement === true || md.action === 'location')) {
                return null;
            }
            if (message.contentType === 'application/sylk-live-location'
                || message.contentType === 'application/sylk-message-metadata') {
                return null;
            }
        }

        let last_content = content || message.content || message.text;
        let filename = 'File';

        // Meeting / live-location lifecycle system notes are informational
        // only and should NOT pollute the Contacts list preview. These are
        // inserted via saveSystemMessage() from NavigationBar.stopLocationSharing
        // ("Meeting expired", "Meeting request cancelled" / "Meeting cancelled",
        // "Meeting cancelled by remote party", "Meeting stopped by remote party")
        // and from the
        // 📍-prefixed live-location lifecycle notes ("📍 Live location
        // sharing expired at ...", "📍 Stopped sharing live location...",
        // "📍 The other party stopped location sharing at ..."). Returning
        // null here suppresses the update on every caller that goes through
        // buildLastMessage (getMessages loop, decryptMessage live-update,
        // saveOutgoingChatUri, journal sync, etc.).
        //
        // Two vocabularies are in play for the meeting lifecycle:
        //   • Pre-acceptance  — "Meeting request …" (cancelled, accepted, etc.)
        //   • Post-acceptance — "Meeting …" (cancelled / stopped / cancelled
        //                       by remote party / stopped by remote party)
        //     The word "request" is dropped once the peer has accepted
        //     because at that point both sides are actively sharing —
        //     see stopLocationSharing() in NavigationBar.
        //
        // NOTE: the success case ("Meeting succeeded") goes through as a
        // REAL outgoing chat message from the initiator — not a system
        // note — so it intentionally DOES update the contacts-list preview
        // like any other message. Hence the explicit exclusion for it
        // below (`(?!succeeded\\b)` after the non-request branch).
        if (typeof last_content === 'string'
                && /^(?:Meeting (?:request\b|expired\b|cancelled\b|stopped\b)|📍 |You met\b)/.test(last_content)) {
            return null;
        }

        //console.log('buildLastMessage', message.contentType, message.text);

        if (message.contentType === 'application/sylk-file-transfer') {
            last_content = utils.beautyFileNameForBubble(message.metadata, true);
        } else if (message.contentType == "text/html") {
			last_content = utils.html2text(last_content);
        }

        if (last_content == null) {
            return null;
        }

        let c = last_content.substring(0, 100);
        return c;
    }

    async incomingMessageFromJournal(message, info={}) {
        //console.log('incomingMessageFromJournal', message.id, message.contentType, info);
        // Handle incoming messages

		// Location/meeting metadata is encrypted. The journal gate
		// (_isLocationJournalPayload) needs plaintext to tell an origin tick
		// (keep) from an update tick (drop). Decrypt inline so we can route
		// origin ticks (including meeting requests) to SQL and to the modal
		// queue; without this, receivers who came online AFTER the sender
		// started sharing never saw the bubble or the accept modal.
		if (!info?.decryptedBody
				&& message.contentType === 'application/sylk-message-metadata'
				&& typeof message.content === 'string'
				&& message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1
				&& message.content.indexOf('-----END PGP MESSAGE-----') > -1
				&& this.state.keys && this.state.keys.private) {
			try {
				const decrypted = await OpenPGP.decrypt(message.content, this.state.keys.private);
				info.decryptedBody = decrypted;
				info.is_encrypted = true;
			} catch (e) {
				console.log('[journal] failed to decrypt metadata', message.id,
					e && e.message ? e.message : e);
				// Fall through — the gate will drop an un-introspectable PGP blob.
			}
		}

		// Ephemeral live-only metadata (location ticks, meeting handshakes)
		// should never be replayed from the journal — if we didn't catch it
		// live, we don't want it later. Drop before any SQL / handler work.
		if (this._isLocationJournalPayload(message, info?.decryptedBody)) {
			return;
		}

		// Origin tick of a meeting request survived the gate above. Queue it
		// so the modal pops when the user opens that chat (or immediately if
		// they're already looking at it). The 2s delay is applied inside
		// _presentMeetingRequestForUri.
		//
		// ALSO seed this.meetingSessions so that subsequent live update ticks
		// from the requester (which arrive with no `in_reply_to` and no
		// `meeting_request: true` — they're just bare location ticks carrying
		// `mid === requesterOriginId`) can be classified via the fallback
		// branch in _updateMeetingSessionCoords (`s.requesterOriginId === mid`).
		// Without this seed, the accepter side sees only its own pin and no
		// distance, because peer-coord propagation has no session to stamp.
		if (message.contentType === 'application/sylk-message-metadata'
				&& typeof info?.decryptedBody === 'string') {
			try {
				const parsed = JSON.parse(info.decryptedBody);
				if (parsed && parsed.action === 'location'
						&& parsed.meeting_request === true
						&& !parsed.metadataId) {
					console.log('[meeting] journal: queuing incoming meeting-request origin',
						'id=', parsed.messageId, 'from=', message.sender.uri);
					this._noteIncomingMeetingRequest(message.sender.uri, parsed);
					// Seed the session with requesterOriginId + (if the origin
					// carried a fix) requesterCoords. Re-using the live-path
					// routine keeps the classification rules in one place.
					try {
						this._updateMeetingSessionCoords(parsed, message.sender.uri);
					} catch (e) {
						console.log('[meeting] journal: seed session coords failed', e);
					}
				}
			} catch (e) {
				// already guarded above; nothing to do
			}
		}

		if (this.state.blockedUris.indexOf(message.sender.uri) > -1) {

			utils.timestampedLog('Reject message from blocked URI', from);
			return;
		}

        if (message.content.indexOf('?OTRv3') > -1) {           
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            console.log('[pubkey-recv] journal arrival from', message.sender.uri,
                'msgId=', message.id,
                'contentLen=', message.content ? message.content.length : 0);
            this.savePublicKeySync(message.sender.uri, message.content);
            return;
        }

        if (message.contentType === 'text/pgp-public-key-imported') {
            return;
        }

        if (message.contentType === 'text/pgp-private-key') {            
            return;
        }

        const is_encrypted =  message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        info.is_encrypted = is_encrypted;
		await this.saveincomingMessageFromJournal(message, info);
    }

    async outgoingMessage(message) {
        console.log('Outgoing message', message.contentType, message.id, 'to', message.receiver, 'state', message.state);

		await this.waitForContactsLoaded();

        this.saveLastSyncId(message.id);
        let gMsg;

        if (message.content.indexOf('?OTRv3') > -1) {
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            return;
        }

        if (message.contentType === 'application/sylk-file-transfer') {
			this.outgoingMessageStateChanged(message.id, message.state);
			//console.log('file transfer', JSON.stringify(message, null, 2));
        }

        if (message.sender.uri.indexOf('@conference') > -1) {
            return;
        }

        if (message.sender.uri.indexOf('@videoconference') > -1) {
            return;
        }
        
        if (message.contentType === 'text/pgp-public-key-imported') {
            this.hideExportPrivateKeyModal();
            this.hideImportPrivateKeyModal();
            return;
        }

        if (message.contentType === 'message/imdn') {
            return;
        }

        if (message.contentType === 'text/pgp-private-key' && message.sender.uri === this.state.account.id) {
            console.log('Received my own PGP private key');
            this.handleRemotePrivateKey(message.content);
            return;
        }

		let uri = message.receiver;
		const contacts = this.lookupContacts(uri);
		//console.log('Matched contacts', contacts.length);

        const is_encrypted = message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                utils.timestampedLog('Outgoing message', message.id, 'decrypted', decryptedBody.length, 'bytes');

                content = decryptedBody;
                if (message.contentType === 'application/sylk-contact-update') {
                    this.handleReplicateContact(content);
                } else {

                    this.saveOutgoingMessageSql(message, content, 1);

					for (const contact of contacts) {
						if (message.timestamp > contact.timestamp) {
							contact.timestamp = message.timestamp;
						}
					}

                    let gMsg = utils.sylk2GiftedChat(message, content, 'outgoing');

                    if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                        let lastMessage = this.buildLastMessage(gMsg);

						for (const contact of contacts) {
						    if (message.contentType?.startsWith('text/') && lastMessage != null) {
								contact.lastMessage = lastMessage;
							}
							contact.lastMessageId = message.id;
							this.saveSylkContact(uri, contact, 'outgoingMessage');
						}

                        if (this.state.selectedContact) {
                            let selectedContact = this.state.selectedContact;
						    if (message.contentType?.startsWith('text/') && lastMessage != null) {
								selectedContact.lastMessage = lastMessage;
                            }
                            selectedContact.timestamp = message.timestamp;
                            selectedContact.direction = 'outgoing';
                            this.setState({selectedContact: {...selectedContact}});
                        }

                        let renderMessages = this.state.messages;
                        if (Object.keys(renderMessages).indexOf(uri) > -1) {
                            if (!renderMessages[uri].some((obj) => obj._id === message.id)) {
                                renderMessages[uri].push(gMsg);
                                //console.log('Added render message', message.id, message.contentType);
                                this.setState({renderMessages: renderMessages});
                            } else {
                                return;
                            }
                        }
                    }
                }

            }).catch((error) => {
                console.log('Failed to decrypt my own message in outgoingMessage:', error);
                return;
            });
        } else {
			if (message.contentType === 'application/sylk-message-metadata') {
				// Live state update (populates messagesMetadata / injects
				// location bubble). Previously this was the ONLY thing done for
				// unencrypted metadata sends, which meant nothing ever hit SQL
				// and the data was lost on reload. Persist the row too so
				// metadata (labels, replies, rotations, location, …) survives
				// app restarts regardless of PGP usage.
				this.handleMessageMetadata(this.state.accountId, content);
				this.saveOutgoingMessageSql(message);
			} else if (message.contentType === 'application/sylk-contact-update') {
                this.handleReplicateContact(content);
            } else {

                this.saveOutgoingMessageSql(message);

				for (const contact of contacts) {
                    contact.timestamp = message.timestamp;
				}

                if (message.contentType === 'text/html') {
                    content = utils.cleanHtml(content);
                } else if (message.contentType.indexOf('image/') > -1) {
                    content = 'Photo';
                }

                gMsg = utils.sylk2GiftedChat(message, content, 'outgoing')

                if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
					const _lm = this.buildLastMessage(gMsg);
					for (const contact of contacts) {
						if (gMsg.contentType?.startsWith('text/') && _lm != null) {
							contact.lastMessage = _lm;
						}
						contact.lastMessageId =  message.id;
                    }
                }

                let renderMessages = this.state.messages;
                //console.log(renderMessages);
                if (Object.keys(renderMessages).indexOf(uri) > -1) {
                    if (!renderMessages[uri].some((obj) => obj._id === message.id)) {
                        renderMessages[uri].push(gMsg);
                        //console.log('Added render message', message.id, message.contentType);
                        this.setState({renderMessages: renderMessages});
                    } else {
                        return;
                    }
                }

				this.saveSylkContact(uri, contact, 'outgoingMessage');
            }
        }
    }

    async outgoingMessageFromJournal(message, info={}) {
        //console.log('outgoingMessageFromJournal', message.id, message.contentType , 'to', message.receiver, info);

		// Same ephemeral-metadata drop as the incoming side. Replaying our
		// own location/meeting ticks from the journal would duplicate
		// bubbles and re-INSERT origin rows that live handling already wrote.
		if (this._isLocationJournalPayload(message, info?.decryptedBody)) {
			return;
		}

        if (message.content.indexOf('?OTRv3') > -1) {

            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            
            return;
        }

        if (message.contentType === 'message/imdn') {
            
            return;
        }

        if (message.contentType === 'text/pgp-private-key') {
            
            return;
        }

        const is_encrypted = message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            if (message.contentType === 'application/sylk-contact-update') {
                // to do get last sylk-contact-update after sync                
				
                /*
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    console.log('Sync outgoing message', message.id, message.contentType, 'decrypted to', message.receiver);
                    this.handleReplicateContactSync(decryptedBody, message.id, message.timestamp);
                    
                }).catch((error) => {
                    console.log('Failed to decrypt my own message in sync:', error.message);
                    
                    return;
                });
                */
            } else {
				info.is_encrypted = true;
                this.saveOutgoingMessageSqlBatch(message, info);
                
            }

        } else {
            if (message.contentType === 'application/sylk-contact-update') {
                //this.handleReplicateContactSync(content, message.id, message.timestamp);

				// TODO handle outgoing metadata                
            } else {
				info.is_encrypted = false;
                await this.saveOutgoingMessageSqlBatch(message, info);
            }
        }
    }

    async saveOutgoingMessageSql(message, decryptedBody=null, is_encrypted=false) {

        let pending = 0;
        let sent = null;
        let received = null;
        let encrypted = 0;
        let content = decryptedBody || message.content;
        let metadata;
        let related_msg_id;
        let related_action;

		// NB: two bugs in the previous version — property is `contentType`
		// (camel), not `content_type`, and `metadataContent` was never parsed,
		// so this branch never actually fired. Parse explicitly and branch off
		// the camelCase field here.
		if (message.contentType === 'application/sylk-message-metadata') {
			let metadataContent;
			try {
				metadataContent = JSON.parse(content);
			} catch (error) {
				console.log('saveOutgoingMessageSql cannot parse metadata payload', error);
				return;
			}

			related_action = metadataContent.action;
			related_msg_id = metadataContent.messageId;

			if (related_action === 'autoanswer') {
				console.log('saveOutgoingMessageSql skipped saving', message.contentType);
				return;
			}

			// Location sharing: one SQL row per sharing session.
			// - metadataId == null  → origin tick: INSERT normally below.
			//   (The envelope msg_id == metadataContent.messageId by construction
			//    in NavigationBar.sendLocationMetadata.)
			// - metadataId != null  → follow-up tick: UPDATE the origin row's
			//   content blob in place so the last position is restored on reload.
			if (related_action === 'location') {
				if (metadataContent.metadataId) {
					const originMsgId = metadataContent.messageId;
					const tsMs = typeof message.timestamp === 'number'
						? message.timestamp
						: new Date(message.timestamp).getTime();
					const unix_ts = Math.floor(tsMs / 1000);
					this.ExecuteQuery(
						"update messages set content = ?, unix_timestamp = ?, timestamp = ? where msg_id = ? and account = ?",
						[content, unix_ts, JSON.stringify(message.timestamp), originMsgId, this.state.accountId]
					).then((result) => {
						const rows = result && result.rowsAffected;
						if (!rows) {
							console.log('[location] origin row missing for', originMsgId,
								'— update tick will not persist until origin is saved');
						}
					}).catch((error) => {
						console.log('[location] UPDATE SQL error:', error && error.message ? error.message : error);
					});
					return;
				}
			}
		}

        console.log('saveOutgoingMessageSql', message.contentType);

        if (message.contentType === 'application/sylk-file-transfer') {
             message.metadata = content;
             try {
                 metadata = JSON.parse(message.metadata);
             } catch (e) {
                 console.log('saveOutgoingMessageSql error parsing json', message.metadata);
             }

        } else {
            message.metadata = '';
        }

        if (decryptedBody !== null) {
            encrypted = 2;
        } else if (is_encrypted) {
            encrypted = 1;
        }

        const failed_states = ['failed', 'error', 'forbidden'];

        if (message.state == 'pending') {
            pending = 1;
        } else if (message.state == 'accepted') {
            pending = 0;
        } else if (message.state == 'delivered') {
            sent = 1;
        } else if (message.state == 'displayed') {
            received = 1;
            sent = 1;
        } else if (failed_states.indexOf(message.state) > -1) {
            sent = 1;
            received = 0;
        } else {
            console.log('Invalid state for message', message.id, message.state);
            return;
        }

        let ts = message.timestamp;

        //console.log('--- metadata', metadata);

        let unix_timestamp = Math.floor(ts / 1000);
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(ts), unix_timestamp, content, message.contentType, message.metadata, message.sender.uri, message.receiver, "outgoing", pending, sent, received, related_msg_id, related_action];
        this.ExecuteQuery("INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, sent, received, related_msg_id, related_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            console.log('SQL inserted outgoing', message.contentType, 'message to', message.receiver, 'encrypted =', encrypted);

            if (message.contentType === 'application/sylk-file-transfer') {
                this.updateFileTransferBubble(metadata);
                this.autoDownloadFile(metadata);
            }

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('saveOutgoingMessageSql SQL error:', error);
            } else {
                if (message.contentType === 'application/sylk-file-transfer') {
                    this.updateFileTransferMessageSql(message.id, content, pending, sent, received, message.state);
                }
            }
            
        });
    }

    sendConsumedMessage(file_transfer) {
        if (file_transfer.sender.uri === this.state.accountId) {
			return;
        }

        console.log('sendConsumedMessage');
		const mId = uuid.v4();
		const timestamp = new Date();
        try {
			const metadataContent = {messageId: file_transfer.transfer_id, 
									 metadataId: mId,
									 value: file_transfer.consumed, 
									 timestamp: timestamp,
									 action: 'consumed'};

			const metadataMessage = {_id: mId,
									 key: mId,
									 createdAt: timestamp,
									 metadata: metadataContent,
									 text: JSON.stringify(metadataContent),
									};
	
			this.sendMessage(file_transfer.sender.uri, metadataMessage, 'application/sylk-message-metadata');
		} catch (e) {
			console.log('sendConsumedMessage error', e);
		}
    }

    async updateFileTransferSql(file_transfer, encrypted=0, reset=false) {
		let file_transfer_sql = file_transfer;
        let query = "SELECT * from messages where msg_id = ? and account = ?";
        await this.ExecuteQuery(query, [file_transfer.transfer_id, this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                if (reset) {
                    file_transfer.error = '';
                } else {
					if (encrypted === 3 && !file_transfer.error) {
						file_transfer.error = 'decryption failed';
					}
                }
                var item = rows.item(0);
                let received = reset ? file_transfer.received : item.received;

                if (item.received != 2 && !reset && this.state.selectedContact && this.state.selectedContact.uri === file_transfer.sender.uri) {
                    if (encrypted === 2 || encrypted === 0) {
						this.sendDispositionNotification(item, 'displayed', true);
                    } else if (encrypted === 3) {
                        this.sendDispositionNotification(file_transfer, 'error', true);
                    }
                }
                
                let params = [JSON.stringify(file_transfer_sql), encrypted, file_transfer.transfer_id, this.state.accountId];
                query = "update messages set metadata = ?, encrypted = ? where msg_id = ? and account = ?"
                this.ExecuteQuery(query, params).then((results) => {
                    //console.log('updateFileTransferSql SQL OK');
					//this.updateFileTransferBubble(file_transfer);
                }).catch((error) => {
                    console.log('updateFileTransferSql SQL error:', error);
                });
            }

        }).catch((error) => {
            console.log('updateFileTransferSql SQL error:', error);
        });
    }

    async updateFileTransferMessageSql(id, content, pending, sent, received, state) {
        //console.log('updateFileTransferMessageSql');
        let query = "SELECT * from messages where msg_id = ? and account = ? ";
        await this.ExecuteQuery(query, [id, this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                var new_metadata = JSON.parse(content);
                let old_metadata = JSON.parse(item.metadata);
                new_metadata.local_url = old_metadata.local_url;
                utils.timestampedLog('File transfer', new_metadata.transfer_id, 'available at', new_metadata.url);
                let params = [content, JSON.stringify(new_metadata), pending, sent, received, id]
                query = "update messages set content = ?, metadata = ?, pending = ?, sent = ?, received = ? where msg_id = ?"
                this.ExecuteQuery(query, params).then((results) => {
                    //console.log('SQL updated file transfer', id, 'received =', received);
                    this.autoDownloadFile(new_metadata);
                    // to do, skip query done below
                    this.updateRenderMessageState(id, state, new_metadata.url);
                }).catch((error) => {
                    console.log('updateFileTransferMessage SQL error:', error);
                });
            }

        }).catch((error) => {
            console.log('updateFileTransferMessage SQL error:', error);
        });
    }
	
    updateFileTransferMetadata(metadata, attribute, value) {
        let id = metadata.transfer_id;
       // console.log('-- updateFileTransferMetadata', id, attribute, value);

		metadata[attribute] = value;
		let update = false;

		if (attribute == 'playing') {
		    if (value === false) {
				update = true;
		    }
		}

		if (attribute == 'position') {
			if (metadata.sender.uri != this.state.accountId) {
				// Only notify the remote party at four checkpoints: 25%, 50%,
				// 75%, 100% (max 4 sends per audio). Everything in between is
				// kept local. The threshold rolls forward only — we never
				// regress consumed on rewinds/scrubs.
				const pct = Math.min(100, Math.max(0, Math.round(value)));
				let threshold = 0;
				if (pct >= 100) threshold = 100;
				else if (pct >= 75) threshold = 75;
				else if (pct >= 50) threshold = 50;
				else if (pct >= 25) threshold = 25;

				const previous = metadata.consumed || 0;
				if (threshold > 0 && threshold > previous) {
					metadata.consumed = threshold;
					this.sendConsumedMessage(metadata);
					update = true;
				}
			}

			if (value == 100) {
			    if (metadata.playing) {
					update = true;
			    }
				//metadata.playing = false;
			}

		} else if (attribute == 'thumbnail') {
		   const thumbnail_filename = value.split('/').pop();
		   console.log('Update thumbnail', value, metadata.thumbnail);
		   update = true;
		}

		this.updateFileTransferBubble(metadata);
		
		if (update) {
			const newMetadata = JSON.stringify(metadata);
			let params = [newMetadata, id];
			query = "update messages set metadata = ? where msg_id = ?";
			this.ExecuteQuery(query, params).then((results) => {
				//console.log('updateFileTransferMetadata OK', newMetadata);
			}).catch((error) => {
				console.log('updateFileTransferMetadata SQL error:', error);
			});
		}
    }

    async updateMetadataFromRemote(id, attribute, value) {
        console.log('-- updateMetadataFromRemote', id, attribute, value);
        // Live-location ticks are persisted by saveIncomingMessage's UPSERT
        // — there is nothing more for this generic helper to do, and parsing
        // the metadata column unconditionally below was crashing on origin
        // rows that had been INSERTed with metadata=''. Bail out early.
        if (attribute !== 'consumed') {
            return;
        }
        let query = "SELECT * from messages where msg_id = ? and account = ? ";
        await this.ExecuteQuery(query, [id, this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                let metadata;
                try {
                    metadata = JSON.parse(item.metadata);
                } catch (e) {
                    console.log('updateMetadataFromRemote: metadata column is not valid JSON for', id, '— skipping');
                    return;
                }

				if (attribute == 'consumed') {
				    if (!metadata.consumed || value > metadata.consumed) {
						metadata.consumed = value;
					}
                } else {
					return;
                }

                const newMetadata = JSON.stringify(metadata);
                console.log('new metadata', newMetadata);

                let params = [newMetadata, id];
                query = "update messages set metadata = ? where msg_id = ?";
                this.ExecuteQuery(query, params).then((results) => {
					this.updateFileTransferBubble(metadata);
                    console.log('updateMetadataFromRemote OK', metadata.action, metadata.value);
                }).catch((error) => {
                    console.log('updateMetadataFromRemote SQL error:', error);
                });
            }

        }).catch((error) => {
            console.log('updateMetadataFromRemote SQL error:', error);
        });
    }

    // AppStore GPS Review — batch-writes outgoing messages to SQL on journal
    // replay. Non-meetup GPS/location rows are stamped with `expire = now +
    // 7d` so purgeExpiredMessages() can enforce the retention promise; the
    // meetup "destroyed after meetup" policy is enforced in-memory by the
    // session wipe, not by this writer.
    async saveOutgoingMessageSqlBatch(message, info={}) {
        //console.log('saveOutgoingMessageSqlBatch', message.id, message.contentType, info);

        let pending = 0;
        let sent = 0;
        let received = null;
        let failed = 0;
        let encrypted = 0;
        let content = info?.decryptedBody ?? message.content;
        let is_encrypted = info?.is_encrypted ?? false;

        if (message.contentType === 'application/sylk-file-transfer') {
             message.metadata = content;
        } else {
            message.metadata = '';
        }

		if (message.contentType == 'application/sylk-message-metadata') {
			let metadataContent;

			// Same guard as handleMessageMetadata: during journal replay the
			// content may still be a PGP envelope we haven't been able to
			// decrypt. JSON.parse on "-----BEGIN PGP MESSAGE-----" yields
			// "Unexpected character in number: -" and spams the console on
			// every startup. Silent skip.
			if (typeof content !== 'string'
					|| content.startsWith('-----BEGIN PGP')) {
				return;
			}

			try {
				metadataContent = JSON.parse(content);
			} catch (error) {
				console.log('handleMessageMetadata cannot parse payload', error);
				return;
			}

			if (metadataContent.action == 'autoanswer') {
			    //console.log('saveOutgoingMessageSqlBatch skipped');
				return;
			}

			// Location sharing: one SQL row per sharing session.
			// - metadataId == null  → origin tick: INSERT normally below
			//   (the envelope's msg_id == metadataContent.messageId by construction).
			// - metadataId != null  → follow-up tick: UPDATE the origin row's
			//   content blob in place so the last position is restored on reload.
			if (metadataContent.action === 'location') {
				if (metadataContent.metadataId) {
					const originMsgId = metadataContent.messageId;
					const tsMs = typeof message.timestamp === 'number'
						? message.timestamp
						: new Date(message.timestamp).getTime();
					const unix_ts = Math.floor(tsMs / 1000);
					// Flush any not-yet-written origin row so UPDATE can find it
					// when an update tick races the 50-row batch window.
					await this.insertPendingMessages();
					this.ExecuteQuery(
						"update messages set content = ?, unix_timestamp = ?, timestamp = ? where msg_id = ? and account = ?",
						[content, unix_ts, JSON.stringify(message.timestamp), originMsgId, this.state.accountId]
					).then((result) => {
						const rows = result && result.rowsAffected;
						if (!rows) {
							console.log('[location] origin row missing for', originMsgId,
								'— update tick will not persist until origin is saved');
						}
					}).catch((error) => {
						console.log('[location] UPDATE SQL error:', error && error.message ? error.message : error);
					});
					return;
				}
			}
		}

        if (info?.decryptedBody) {
            encrypted = 2;
        } else if (is_encrypted) {
            encrypted = 1;
        }

        if (message.state == 'pending') {
            pending = 1;
        } else if (message.state == 'delivered') {
            sent = 1;
        } else if (message.state == 'displayed') {
            received = 1;
            sent = 1;
        } else if (message.state == 'failed') {
            sent = 1;
            received = 0;
            failed = 1;
        } else if (message.state == 'error') {
            sent = 1;
            received = 0;
            failed = 1;
        } else if (message.state == 'forbidden') {
            sent = 1;
            received = 0;
        }

        let disposition_notification = '';
		const ts = typeof message.timestamp === 'number' ? message.timestamp: new Date(message.timestamp).getTime();
		const unix_timestamp = Math.floor(ts / 1000);
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, message.metadata, message.sender.uri, message.receiver, "outgoing", pending, sent, received, message.state, disposition_notification];
        this.pendingNewSQLMessages.push(params);

        if (this.pendingNewSQLMessages.length > 49) {
            await this.insertPendingMessages();
        }        
    }

    async insertPendingMessages() {
        if (this.pendingNewSQLMessages.length > 0) {
            //console.log('insertPendingMessages', this.pendingNewSQLMessages.length, 'new messages');
        } else {
			//console.log('insertPendingMessages has no data');
			return;
        }
		const singleQuery = `
		INSERT INTO messages (
		  account, encrypted, msg_id, timestamp, unix_timestamp,
		  content, content_type, metadata, from_uri, to_uri,
		  direction, pending, sent, received, state, disposition_notification
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

        let query = "INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, sent, received, state, disposition_notification) VALUES ";

        let pendingNewSQLMessages = this.pendingNewSQLMessages;
        this.pendingNewSQLMessages = [];
		
        let all_values = [];
        let n = 0;
        let i = 1;

        let pending = 0;
        let sent = null;
        let received = null;
        let state = null;
        let content = null;
        let metadata = null;
        let id = null;
        let account = '';

        const failed_states = ['failed', 'error', 'forbidden'];

        if (pendingNewSQLMessages.length > 0) {
            pendingNewSQLMessages.forEach((values) => {
                Array.prototype.push.apply(all_values, values);
                query = query + "(";
                n = 0;
                while (n < values.length ) {
                  query = query + "?"
                  if (n < values.length - 1) {
                      query = query + ",";
                  }
                  n = n + 1;
                }
                query = query + ")";
                if (pendingNewSQLMessages.length > i) {
                  query = query + ", ";
                }
                i = i + 1;
            });

            await this.ExecuteQuery(query, all_values).then((result) => {
                //console.log('Saved', pendingNewSQLMessages.length, 'new messages');
                //this._notificationCenter.postSystemNotification('Saved ' + pendingNewSQLMessages.length + ' new messages');
                // todo process file transfers

                pendingNewSQLMessages.forEach((values) => {
                    id = values[2];
                    if (values[6] === 'application/sylk-file-transfer' && pendingNewSQLMessages.length < 20) {
                        content = values[5];
                        state = values[14];
                        if (state == 'pending') {
                            pending = 1;
                        } else if (state == 'accepted') {
                            pending = 0;
                        } else if (state == 'delivered') {
                            sent = 1;
                        } else if (state == 'received') {
                            received = 1;
                        } else if (state == 'displayed') {
                            received = 1;
                            sent = 1;
                        } else if (failed_states.indexOf(state) > -1) {
                            sent = 1;
                            received = 0;
                        }
                        this.updateFileTransferMessageSql(id, content, pending, sent, received, state);
                    }
                });

			}).catch(async (error) => {
				// Suppress both PRIMARY KEY and UNIQUE-index collisions —
				// those simply mean "we already have this message in local
				// SQL" (typical after a send: the sender inserts locally,
				// then sync later re-delivers the same msg_id from the
				// server and we try to insert it again). Everything else
				// is an actual SQL problem worth logging.
				const isDupBulk = error.message.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') !== -1
					|| error.message.indexOf('UNIQUE constraint failed') !== -1;
				if (!isDupBulk) {
					console.log('-- SQL error inserting bulk messages:', error.message);
                }

				for (let index = 0; index < pendingNewSQLMessages.length; index++) {
					const values = pendingNewSQLMessages[index];

					try {
						await this.ExecuteQuery(singleQuery, values);
					} catch (err) {
						const isDupRow = err.message.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') !== -1
							|| err.message.indexOf('UNIQUE constraint failed') !== -1;
					    if (!isDupRow) {
							console.error('Bad message data at index', index, {
								error: err.message, values
							});
						}
					}
				}
            });
        }
    }

    async saveSystemMessage(uri, content, direction, missed=false, system=1) {
        let timestamp = new Date();
        let unix_timestamp = Math.floor(timestamp / 1000);
        let id = uuid.v4();

		if (uri.indexOf('@guest.') > -1) {
			uri = "anonymous@anonymous.invalid";
		}
		
		console.log('saveSystemMessage', uri, content);

        let params = [this.state.accountId, id, JSON.stringify(timestamp), unix_timestamp, content, 'text/plain', direction === 'incoming' ? uri : this.state.account.id, direction === 'outgoing' ? uri : this.state.account.id, 0, system, direction];

        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, pending, system, direction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            this.renderSystemMessage(uri, content, direction, timestamp, system);

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('saveSystemMessage SQL error:', error);
            }
        });
    }

    updateFileTransferBubble(metadata, text = null) {
		if (!this.state.selectedContact) {
			return;
		}

		const id = metadata.transfer_id;

		//console.log(' -- updateFileTransferBubble', id);
	
		let renderMessages = this.state.messages;
		let existingMessages = renderMessages[this.state.selectedContact.uri];
	
		if (!existingMessages) {
			return;
		}
	
		let newMessages = existingMessages.map((msg) => {
			if (msg._id !== id) {
				// unchanged message‚ keep original reference
				return msg;
			}
	
			// *** CREATE NEW MESSAGE OBJECT ***
			let newMsg = { ...msg };
	
			// update text
			newMsg.text = text || utils.beautyFileNameForBubble(metadata);
	
			if (metadata.error) {
				newMsg.text += ' - ' + utils.getErrorMessage(metadata.error);
				newMsg.failed = true;
			} else {
				newMsg.failed = false;
			}
	
			// copy metadata immutably
			newMsg.metadata = { ...metadata };
	
			// reset media fields
			newMsg.image = null;
			newMsg.video = null;
			newMsg.audio = null;
			newMsg.consumed = newMsg.metadata.consumed || 0;
			newMsg.position = newMsg.metadata.position || 0;
			newMsg.playing = newMsg.metadata.playing || false;
			newMsg.thumbnail = newMsg.metadata.thumbnail;

			//console.log('updateFileTransferBubble newMsg.playing', newMsg.playing);
			//console.log('updateFileTransferBubble newMsg.consumed', newMsg.consumed);
	
			// handle media previews
			const isEncrypted = metadata.local_url?.endsWith('.asc');
	
			if (metadata.local_url && !isEncrypted) {
				const localPath = Platform.OS === "android"
					? 'file://' + metadata.local_url
					: metadata.local_url;
	
				if (utils.isImage(metadata.filename, metadata.filetype)) {
					if (metadata.b64) {
						newMsg.image = `data:${metadata.filetype};base64,${metadata.b64}`;
					} else {
						newMsg.image = localPath;
					}
				} else if (utils.isAudio(metadata.filename)) {
					newMsg.audio = localPath;
				} else if (utils.isVideo(metadata.filename, metadata.filetype)) {
					newMsg.video = localPath;
				}
			}
	
			return newMsg;
		});
	
		// update message list immutably
		renderMessages = {
			...renderMessages,
			[this.state.selectedContact.uri]: newMessages,
		};
	
		this.setState({ messages: renderMessages });
	}

    async renderSystemMessage(uri, content, direction, timestamp, system=true) {

        if (utils.isPhoneNumber(uri) && uri.indexOf('@') > -1) {
            uri = uri.split('@')[0];
        }

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) > - 1) {
            let msg;

            msg = {
                _id: uuid.v4(),
                text: utils.cleanHtml(content),
                createdAt: timestamp || new Date(),
                direction: direction || 'outgoing',
                sent: true,
                system: system,
                pending: false,
                failed: false,
                user: direction == 'incoming' ? {_id: uri, name: uri} : {}
                }

            renderMessages[uri].push(msg);
            // Note: the state key is `messages`, not `renderMessages` — the
            // local var was named renderMessages for readability. Writing to
            // the wrong key silently dropped every live system-note render
            // (the SQL INSERT still persisted, so it only surfaced after a
            // reload). Push under the real key so the chat updates live.
            this.setState({messages: renderMessages});
        }
    }

    // AppStore GPS Review — persists incoming GPS/location records to SQL.
    // Non-meetup location payloads are stamped with `expire = now + 7d` so
    // received GPS data is auto-purged after the retention window; meetup
    // shares inherit the origin's session expiry and are wiped on meet-end.
    async saveIncomingMessage(message, decryptedBody=null) {
        console.log('-- saveIncomingMessage', message.id, 'from', message.sender.uri)
        let uri = message.sender.uri;
        let contact;

		let contacts = this.lookupContacts(uri);

		for (const contact of contacts) {
			if (contact.tags.indexOf('blocked') > -1) {
				return;
			}
		}
		
		if (contacts.length === 0) {
		    contact = this.newContact(uri);
		    contacts.push(contact);
		}

        let incomingMessage = this.state.incomingMessage;

        if (uri in incomingMessage) {
			delete incomingMessage[uri];
			this.setState({incomingMessage: incomingMessage});
        }

        var content = decryptedBody || message.content;
        let received = 1;
        let unix_timestamp = Math.floor(message.timestamp / 1000);
        let encrypted = decryptedBody === null ? 0 : 2;
        let metadata = message.contentType === 'application/sylk-file-transfer' ? message.content : '';
        let file_transfer = {};
        let related_action;
        let related_msg_id;
        let related_value;
        // Time-sensitive rows (currently only live-location origins) stamp
        // an unix-seconds `expire` so purgeExpiredMessages() can sweep them
        // up after a crash/force-kill. Defaults to 0 (= "keep forever").
        let expire = 0;

		if (message.contentType === 'application/sylk-message-metadata') {
			let metadataContent;
			try {
				// Parse the DECRYPTED body — `message.content` is still the
				// PGP ciphertext at this point when the message was E2EE'd,
				// and that blob starts with "-----BEGIN PGP MESSAGE-----",
				// which JSON.parse chokes on with "Unexpected character in
				// number: -" because it tries to read the leading `-` as
				// the start of a negative number. `content` was already
				// computed above as (decryptedBody || message.content), so
				// it's the right source for both encrypted and plaintext.
				metadataContent = JSON.parse(content);
				related_action = metadataContent.action;
				related_value = metadataContent.value;
				related_msg_id = metadataContent.messageId;
				//console.log('saveIncomingMessage', related_action, related_msg_id, related_value);
				this.updateMetadataFromRemote(related_msg_id, related_action, related_value);
			} catch (error) {
				console.log('saveIncomingMessage cannot parse payload', error);
				return;
			}

			if (related_action == 'consumed') {
				let params = [this.state.accountId, related_action, related_msg_id];
				await this.ExecuteQuery("delete from messages where account = ? and related_action = ? and related_msg_id = ?", params).then((result) => {
					//console.log(result.rowsAffected, 'consumed message deleted');
				}).catch((error) => {
					if (error.message.indexOf('UNIQUE constraint failed') === -1) {
						console.log('saveIncomingMessage SQL error:', error);
					}
				});
			}

			// meeting_end is a pure signal — NavigationBar has already been
			// dispatched to (handleMessageMetadata runs first). No bubble,
			// no history row: return before the INSERT below so we don't
			// clutter the messages table with transient control messages.
			if (related_action === 'meeting_end') {
				return;
			}

			// Location sharing: mirror the outgoing UPSERT model. Origin ticks
			// (metadataId == null) INSERT normally; follow-up ticks UPDATE the
			// origin row so reload sees the latest position.
			//
			// IMPORTANT: we MUST persist the metadata blob into the `metadata`
			// column on both INSERT and UPDATE. Other code paths
			// (updateMetadataFromRemote, getMessages re-hydration, etc.) read
			// that column with JSON.parse and will throw "Unexpected end of
			// input" if it's left empty.
			if (related_action === 'location') {
				const metadataJson = JSON.stringify(metadataContent);
				if (metadataContent.metadataId) {
					const originMsgId = metadataContent.messageId;
					const tsMs = typeof message.timestamp === 'number'
						? message.timestamp
						: new Date(message.timestamp).getTime();
					const unix_ts = Math.floor(tsMs / 1000);
					await this.ExecuteQuery(
						"update messages set content = ?, metadata = ?, unix_timestamp = ?, timestamp = ? where msg_id = ? and account = ?",
						[content, metadataJson, unix_ts, JSON.stringify(message.timestamp), originMsgId, this.state.accountId]
					).then((result) => {
						const rows = result && result.rowsAffected;
					}).catch((error) => {
						console.log('[location] UPDATE SQL error:', error && error.message ? error.message : error);
					});
					return;
				}
				// Origin tick: stash the JSON blob in the metadata column so
				// the INSERT below carries it through (instead of '').
				metadata = metadataJson;
				// Retention policy — mirrors saveOutgoingMessage so both
				// devices purge on the same schedule:
				//   • Meetup share (meeting_request or in_reply_to):
				//     `expire` = session's expires_at (wipes at meetup end).
				//   • Plain timed share: `expire` = now + 7 days. The live
				//     window is only an upper bound; after that, the last
				//     known position should linger for up to a week and
				//     then be purged.
				const isIncomingMeetup = metadataContent.meeting_request === true
					|| !!metadataContent.in_reply_to;
				const SEVEN_DAYS_SEC_IN = 7 * 24 * 60 * 60;
				if (isIncomingMeetup) {
					if (metadataContent.expires) {
						const expMs = new Date(metadataContent.expires).getTime();
						if (expMs > 0) {
							expire = Math.floor(expMs / 1000);
						}
					}
				} else {
					expire = Math.floor(Date.now() / 1000) + SEVEN_DAYS_SEC_IN;
				}
				console.log('[location] INSERT SQL origin row (incoming)', message.id,
					'targets messageId=', metadataContent.messageId,
					'expire=', expire, 'meetup=', isIncomingMeetup);
			}
		}

        if (message.contentType === 'application/sylk-file-transfer') {
            try {
                file_transfer = JSON.parse(metadata);
                if (file_transfer.url.endsWith('.asc')) {
                    encrypted = 1;
                }
            } catch (e) {
                console.log("Error decoding incoming file transfer json sql: ", e);
                return;
            }
        }

		let disposition_notification = message.dispositionNotification ? message.dispositionNotification.join(",") : '';
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, metadata, message.sender.uri, this.state.account.id, "incoming", received, related_action, related_msg_id, disposition_notification, expire];

        await this.ExecuteQuery("INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, received, related_action, related_msg_id, disposition_notification, expire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
			//console.log('saveIncomingMessage SQL OK');

			for (const contact of contacts) {
				if (!contact.name && message.sender.displayName) {
					contact.name = message.sender.displayName;
				}

				if (message.timestamp > contact.timestamp) {
					contact.timestamp = message.timestamp;
				}

				if (unreadCounterTypes.has(message.contentType)) {
					// Only treat the user as "in chat" if the app is actually in
					// the foreground. When the app is backgrounded, selectedContact
					// still holds its last value but the user is not actually
					// viewing anything, so we must count the message as unread.
					const isActiveChat =
						this.state.appState === 'active' &&
						this.state.selectedContact &&
						this.state.selectedContact.id === contact.id;
					if (!isActiveChat) {
						contact.unread.push(message.id);
						console.log('[SYLK] Increment unread (saveIncomingMessage) for', uri,
							'new length =', contact.unread.length,
							'appState =', this.state.appState);
					} else {
						console.log('[SYLK] Skipping unread increment: user is in chat with', uri);
					}
				}

				contact.direction = 'incoming';
				contact.lastCallDuration = null;

				if (contact.tags.indexOf('chat') === -1) {
					contact.tags.push('chat');
				}

				if (contact.totalMessages) {
					contact.totalMessages = contact.totalMessages + 1;
				}
            }

            if (message.contentType === 'text/html') {
                content = utils.cleanHtml(content);
            } else if (message.contentType.indexOf('image/') > -1) {
                content = 'Photo';
            } else if (message.contentType === 'application/sylk-file-transfer') {
                try {
                    this.autoDownloadFile(file_transfer);
                } catch (e) {
                    console.log("Error decoding incoming file transfer json sql: ", e);
                }
            }

			if (message.contentType !== 'application/sylk-message-metadata') {
				for (const contact of contacts) {
					this.saveSylkContact(uri, contact, 'saveIncomingMessage');

					if (this.state.selectedContact && this.state.selectedContact.id === contact.id) {
						this.confirmRead(uri, 'incoming_message');
					}
				}
				this.requestDndPermission();
            }

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('saveIncomingMessage SQL error:', error);
            }
        });
    }

    async saveincomingMessageFromJournal(message, info={}) {
        //console.log('saveincomingMessageFromJournal', message.id, message.contentType, info);
        let content = info?.decryptedBody ?? message.content;
        let is_encrypted = info?.is_encrypted ?? false;

        let encrypted = 0;

        if (info?.decryptedBody) {
            encrypted = 2;
        } else if (is_encrypted) {
            encrypted = 1;
        }

        let received = 0;
        let imdn_msg;

        
        let incomingMessage = this.state.incomingMessage;
        if (message.sender.uri in incomingMessage) {
			delete incomingMessage[message.sender.uri];
			this.setState({incomingMessage: incomingMessage});
        }
        
        //console.log('message.dispositionNotification', message.dispositionNotification);
        // displayed, delivered or 

        if (message.dispositionNotification.indexOf('display') === -1) {
            //console.log('Incoming message', message.id, 'was already read');
            received = 2;
        } else {
            if (message.dispositionNotification.indexOf('positive-delivery') > -1) {
                imdn_msg = {id: message.id, timestamp: message.timestamp, from_uri: message.sender.uri, content_type: message.contentType}
                let result = await this.sendDispositionNotification(imdn_msg, 'delivered');
                //console.log('IMDN promise', result);
                if (result) {
                    received = 1;
                }
            } else {
                received = 1;
            }
        }

        let pending
        let sent;
		const ts = typeof message.timestamp === 'number' ? message.timestamp: new Date(message.timestamp).getTime();
		const unix_timestamp = Math.floor(ts / 1000);
        let metadata = message.contentType === 'application/sylk-file-transfer' ? message.content : '';
        let disposition_notification = message.dispositionNotification ? message.dispositionNotification.join(",") : '';

        //console.log('Sync metadata', message.id, message.contentType, metadata, typeof(message.content));

        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, metadata, message.sender.uri, this.state.account.id, "incoming", pending, sent, received, message.state, disposition_notification];

        this.pendingNewSQLMessages.push(params);
        
        if (this.pendingNewSQLMessages.length > 49) {
            this.insertPendingMessages()
        }
    }

    saveParticipant(callUUID, room, uri) {
        if (this._historyConferenceParticipants.has(callUUID)) {
            let old_participants = this._historyConferenceParticipants.get(callUUID);
            if (old_participants.indexOf(uri) === -1) {
                old_participants.push(uri);
            }

        } else {
            let new_participants = [uri];
            this._historyConferenceParticipants.set(callUUID, new_participants);
        }

        if (!this.myParticipants) {
            this.myParticipants = new Object();
        }

        if (this.myParticipants.hasOwnProperty(room)) {
            let old_uris = this.myParticipants[room];
            if (old_uris.indexOf(uri) === -1 && uri !== this.state.account.id && (uri + '@' + this.state.defaultDomain) !== this.state.account.id) {
                this.myParticipants[room].push(uri);
            }

        } else {
            let new_uris = [];
            if (uri !== this.state.account.id && (uri + '@' + this.state.defaultDomain) !== this.state.account.id) {
                new_uris.push(uri);
            }

            if (new_uris) {
                this.myParticipants[room] = new_uris;
            }
        }

        storage.set('myParticipants', this.myParticipants);
    }

    deletePublicKey(uri) {
        uri = uri.trim().toLowerCase();

        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        let contacts = this.lookupContacts(uri);

		for (const contact of contacts) {
            contact.publicKey = null;
            console.log('Public key of', uri, 'deleted');
            this.saveSylkContact(uri, contact, 'deletePublicKey');
        }

        // Reset handshake state so a debug-driven delete actually
        // re-runs the full flow on the next chat-open. Without this,
        // the once-per-app-run gate in lookupPublicKey/savePublicKey
        // would silently swallow the re-handshake and make the delete
        // button useless for the very thing it's there to test.
        this.sentPublicKeyUris.delete(uri);
        if (this.lastLookupKey === uri) {
            this.lastLookupKey = null;
        }
    }

    lookupABContacts(text) {
        // lookup AdressBook Contacts
        let contacts = [];

        const addressbook_contacts = this.state.contacts.filter(contact => this.matchContact(contact, text));
        addressbook_contacts.forEach((c) => {
            const existing_contacts = contacts.filter(contact => this.matchContact(contact, c.uri.toLowerCase(), false));
            if (existing_contacts.length === 0) {
                contacts.push(c);
            }
        });
        return contacts;
    }

	removeContactInState = (removedContact) => {
		this.setState(prevState => ({
			allContacts: prevState.allContacts.filter(
				contact => contact.id !== removedContact.id
			)
		}));
	};

	updateContactInState(updatedContact) {
		this.setState(prevState => ({
			allContacts: prevState.allContacts.map(contact =>
				contact.id === updatedContact.id
					? { ...contact, ...updatedContact }
					: contact
			)
		}));
	}

	buildContactIndex = () => {
	  const singleIndex = {};
	  const multiIndex = {};
	
	  this.contactIndex = {};
	  this.contactsIndexes = {};
  
	  Object.values(this.state.allContacts).forEach(contact => {
		const keys = [
		  contact.uri,
		  contact.id,
		  ...(Array.isArray(contact.uris) ? contact.uris : [])
		].filter(Boolean); // removes undefined/null keys
	
		keys.forEach(key => {
		  // Single lookup index (last one wins if duplicate)
		  singleIndex[key] = contact;
	
		  // Multi lookup index
		  if (!multiIndex[key]) {
			multiIndex[key] = [];
		  }
		  multiIndex[key].push(contact);
		});
	  });
	
	  // Lookup exactly one contact
	  this.contactIndex = singleIndex;
	
	  // Lookup multiple contacts
	  this.contactsIndexes = multiIndex;
	};

	lookupContact = (uriString, create = false, save = false) => {
	  // returns only one contact
	  const match = this.contactIndex?.[uriString] || null;

	  if (match) {
		  return match;
	  } 

	  if (create) {
	      console.log('No contact matches', uriString);
	      console.log('--- Existing contacts:');
	      const allContacts = this.state.allContacts;
		  for (const contact of allContacts) {
		      console.log(contact.id, contact.uri);
		  }
	      
	      const newContact = this.newContact(uriString);
	
		  if (save) {
			  this.saveSylkContact(uriString, newContact, 'lookup');
	      }
	      
	      return newContact;
	  }	  
	  
	  return null;

	};

	lookupContacts = (uriString) => {
	  // returns array of matches
	  return this.contactsIndexes?.[uriString] || [];
	};

    newContact(uri, name=null, data={}) {
        //console.log('Create new in memory contact', uri, name, data.src);
        let current_datetime = new Date();

        if (data.src !== 'init') {
            uri = uri.trim().toLowerCase();
        }
        
		const els = uri.split('@');
        const username = els[0];
		const isNumber = utils.isPhoneNumber(username);

		// Derive a friendly name from the URI username when no name was provided.
		// For non-numeric usernames: replace '.', '_', '-' separators with spaces
		// and title-case each word (e.g. 'john.doe' -> 'John Doe', 'alice_smith' -> 'Alice Smith').
		// Phone numbers are left untouched so their formatting is preserved.
		let derivedName = username;
		if (!isNumber && username) {
			derivedName = username
				.replace(/[._-]+/g, ' ')
				.trim()
				.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
			if (!derivedName) {
				derivedName = username;
			}
		}
		const displayName = name || data.name || derivedName;

        let contact = {   id: data?.id || uuid.v4(),
                          uri: uri,
                          uris: [],
                          name: displayName,
                          organization: data.organization || '',
                          email: '',
                          storage: 0,
                          unread: [],
                          tags: [],
                          prettyStorage: null,
                          lastCallMedia: [],
                          participants: [],
                          messagesMetadata: {},
                          timestamp: current_datetime,
                          properties: {}
                      }

        if (data.sqlItem) {
            const item = data.sqlItem;

			contact.timestamp = item.timestamp ? new Date(item.timestamp * 1000) : current_datetime;
			contact.organization = item.organization;
			contact.email = item.email;
			contact.id = item.contact_id;
			contact.photo = item.photo;
			contact.publicKey = item.public_key;
			contact.direction = item.direction;
			contact.tags = item.tags ? item.tags.split(',').map(tag => tag.trim()) : [];
			contact.participants = item.participants ? item.participants.split(',') : [];
			contact.unread = item.unread_messages ? item.unread_messages.split(',') : [];
			contact.lastCallId = item.last_call_id;
			contact.lastCallMedia = item.last_call_media ? item.last_call_media.split(',') : [];
			contact.lastCallDuration = item.last_call_duration;
			contact.messagesMetadata = {}
			contact.lastMessageId = item.last_message_id === '' ? null : item.last_message_id;
			contact.lastMessage = item.last_message === '' ? null : item.last_message;
			contact.messagesMetadata = {}

			let properties = {}

			if (item.properties) {
				try {
					properties = JSON.parse(item.properties);
				} catch (e) {
					console.log('Error decoding json contact properties', item.properties);
				}
			}

			contact.properties = properties;

			let localProperties = {autoanswer: false}

			if (item.local_properties) {
				try {
					localProperties = JSON.parse(item.local_properties);
				} catch (e) {
					console.log('Error decoding json contact properties', item.local_properties);
				}
			}

			if (item.local_properties) {
			  try {
				const _localProperties = JSON.parse(item.local_properties);
			
				localProperties = {
				  ...localProperties,      // keep existing defaults
				  ..._localProperties      // overwrite only provided keys
				};
			
			  } catch (e) {
				console.log('Error decoding json contact properties', item.local_properties);
			  }
			}

			contact.localProperties = localProperties;
        }

        contact = this.sanitizeContact(uri, contact);
        return contact;
    }

    newSyntheticContact(uri, name=null, data={}) {
        //console.log('Create new syntetic contact', uri, data);
		let contact = this.newContact(uri, name || data?.name);
		if (contact) {
			contact.organization = data?.organization || '';
			contact.tags = ['synthetic'];
        }
        return contact;
    }

	updateTotalUnread() {
		let total_unread = 0;
		const perContact = {};

		const contacts = this.state.allContacts || [];

		for (const contact of contacts) {
			if (!contact || !Array.isArray(contact.unread)) {
				continue;
			}
			if (contact.unread.length > 0) {
				perContact[contact.uri] = contact.unread.length;
			}
			total_unread += contact.unread.length;
		}

		console.log('[SYLK] updateTotalUnread: total =', total_unread, 'perContact =', perContact);

       if (Platform.OS === 'ios') {
           PushNotification.setApplicationIconBadgeNumber(total_unread);
       } else {
            ShortcutBadge.setCount(total_unread);
            //PushNotification.setApplicationIconBadgeNumber(total_unread)
       }
    }

    saveContactByUser(contactObject, originalContact) {
		console.log('saveContactByUser by user', contactObject);

		let uri = contactObject.uri;
		let action = originalContact ? 'editContact' : 'addContact';
		let contact;
				 		
        if (uri.indexOf('@') === -1 && !utils.isPhoneNumber(uri)) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        if (originalContact) {
            // update old contact
			contact = {...originalContact};
		} else {
			contact = this.newContact(uri);
		}

        contact.uri = uri;
        contact.name = contactObject.displayName;
        contact.organization = contactObject.organization;
        contact.email = contactObject.email;
        contact.timestamp = new Date();
        contact.tags = contactObject.tags || [];

        contact = this.sanitizeContact(uri, contact);

        if (!contact) {
            this._notificationCenter.postSystemNotification('Invalid contact ' + uri);
            return;
        }

        if (!contact.photo) {
            var name_idx = contact.name.trim().toLowerCase();
            if (name_idx in this.state.avatarPhotos) {
                contact.photo = this.state.avatarPhotos[name_idx];
            }
        }

        this.saveSylkContact(uri, contact, action);
    }

    async replicateContact(contact) {
		return;
    }

    handleReplicateContact(json_contact) {
		return;
    }

    async handleReplicateContactSync(json_contact, id, msg_timestamp) {
		return;
    }

    sanitizeContact(uri, contact) {
        //console.log('sanitizeContact', uri, contact);

        let idx;

        if (!uri || uri === '') {
            return null;
        }

        if (!contact.id) {
			contact.id = uuid.v4();
        } 

		uri = uri.trim().toLowerCase();

        // Recognize https://<host>[:<port>]/call/<sip-uri> and extract the SIP URI
        const callUriMatch = utils.parseSylkCallUrl(uri);
        if (callUriMatch) {
            console.log('Parsed call URL', uri, '->', callUriMatch);
            uri = callUriMatch.toLowerCase();
        }

        let domain;
        let els = uri.split('@');
        let username = els[0];
        let conferenceObject = null;

        let isNumber = utils.isPhoneNumber(username);

        if (uri.indexOf('@') === -1 && !utils.isPhoneNumber(uri)) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        let uuidPattern = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/gi;
        let isUUID = uri.match(uuidPattern);

        if (!isUUID && !isNumber && !utils.isEmailAddress(uri) && username !== '*') {
            console.log('Sanitize check failed for uri:', uri);
            conferenceObject = utils.parseSylkConferenceUrl(uri);
            if (!conferenceObject) {
				return null;
            } else {
				console.log('conferenceObject', conferenceObject);
            }
        }

        contact.uri = uri;

        if (!contact.conference) {
            contact.conference = false;
        }

        if (!contact.tags) {
            contact.tags = [];
        }

        contact.tags = [... new Set(contact.tags)];

        if (contact.direction === 'received'){
            contact.direction = 'incoming';
        } else if (contact.direction === 'placed') {
            contact.direction = 'outgoing';
        }

        if (xtype(contact.timestamp) !== 'date') {
            try {
				contact.timestamp = new Date(contact.timestamp);
			} catch (e) {
				contact.timestamp = new Date();
			}
        }

        if (!contact.participants) {
            contact.participants = [];
        }

        contact.participants = [... new Set(contact.participants)];

        if (!contact.unread) {
            contact.unread = [];
        }

        contact.unread = [... new Set(contact.unread)];

        if (!contact.lastCallMedia) {
            contact.lastCallMedia = [];
        }

        contact.lastCallMedia = [... new Set(contact.lastCallMedia)];

        return contact;
    }

    updateFavorite(uri, favorite) {
        if (favorite === null) {
            return;
        }

        let favoriteUris = this.state.favoriteUris;
        let idx;

        idx = favoriteUris.indexOf(uri);
        if (favorite && idx === -1) {
            favoriteUris.push(uri);
            this.setState({favoriteUris: favoriteUris, refreshFavorites: !this.state.refreshFavorites});
        } else if (!favorite && idx > -1) {
            favoriteUris.splice(idx, 1);
            this.setState({favoriteUris: favoriteUris, refreshFavorites: !this.state.refreshFavorites});
        } else {
            return;
        }

    }

    toggleFavorite(contact) {
        //console.log('toggleFavorite', contact.id);
        let favoriteUris = this.state.favoriteUris;
        let favorite;
        let uri = contact.uri;

        idx = contact.tags.indexOf('favorite');
        if (idx > -1) {
            contact.tags.splice(idx, 1);
            favorite = false;
        } else {
            contact.tags.push('favorite');
            favorite = true;
        }

        contact.timestamp = new Date();

        this.saveSylkContact(uri, contact, 'toggleFavorite');

        let idx = favoriteUris.indexOf(uri);
        if (idx === -1 && favorite) {
            favoriteUris.push(uri);
            console.log(uri, 'is favorite');
        } else if (idx > -1 && !favorite) {
            favoriteUris.splice(idx, 1);
            console.log(uri, 'is not favorite');
        }

        this.setState({favoriteUris: favoriteUris});
    }

    toggleAutoAnswer(contact, replicate=true) {
        //console.log('-- ToggleAutoAnswer', contact.id);
		contact.localProperties.autoanswer = !contact.localProperties.autoanswer;
		const autoanswer = contact.localProperties.autoanswer;

        idx = contact.tags.indexOf('autoanswer');
        if (idx > -1) {
            if (!autoanswer) {
				contact.tags.splice(idx, 1);
            }
        } else {
            if (autoanswer) {
				contact.tags.push('autoanswer');
			}
        }
        
        this.saveSylkContact(contact.uri, contact, 'toggleAutoAnswer');

		if (autoanswer && replicate) {
			const mId = uuid.v4();
			const timestamp = new Date();
			
			const metadataContent = {
									 action: 'autoanswer',
									 value: autoanswer,
									 timestamp: timestamp,
									 uri: contact.uri,
									 device: this.deviceId
									 };
		
			const metadataMessage = {_id: mId,
								   key: mId,
								   createdAt: timestamp,
								   metadata: metadataContent,
								   text: JSON.stringify(metadataContent),
								   };
	
			this.sendMessage(this.state.accountId, metadataMessage, 'application/sylk-message-metadata');
		}
    }

    toggleBlocked(contact) {
        let blockedUris = this.state.blockedUris;
        let blocked = false;
        let uri = contact.uri;

        idx = contact.tags.indexOf('blocked');
        if (idx > -1) {
            contact.tags.splice(idx, 1);
            blocked = false;
        } else {
            contact.tags.push('blocked');
            blocked = true;
        }

        contact.timestamp = new Date();

        this.saveSylkContact(uri, contact, 'toggleBlocked');

        let idx = blockedUris.indexOf(uri);
        if (idx === -1 && blocked) {
            blockedUris.push(uri);
        } else if (idx > -1 && !blocked) {
            blockedUris.splice(idx, 1);
        }

        this.setState({blockedUris: blockedUris, selectedContact: null});
    }

    updateBlocked(uri, blocked) {
        if (blocked === null) {
            return;
        }

        let blockedUris = this.state.blockedUris;
        let idx;

        idx = blockedUris.indexOf(uri);
        if (blocked && idx === -1) {
            blockedUris.push(uri);
            this.setState({blockedUris: blockedUris});
        } else if (!blocked && idx > -1) {
            blockedUris.splice(idx, 1);
            this.setState({blockedUris: blockedUris});
        } else {
            return;
        }
    }

    appendInvitedParties(room, uris) {
        //console.log('Save invited parties', uris, 'for room', room);
        let myInvitedParties = this.state.myInvitedParties;

        let current_uris = myInvitedParties.hasOwnProperty(room) ? myInvitedParties[room] : [];
        uris.forEach((uri) => {
            let idx = current_uris.indexOf(uri);
            if (idx === -1) {
                if (uri.indexOf('@') === -1) {
                    uri =  uri + '@' + this.state.defaultDomain;
                }

                if (uri !== this.state.account.id) {
                    current_uris.push(uri);
                    //console.log('Added', uri, 'to room', room);
                }
            }
        });

        this.saveConference(room, uris);
    }

    forwardMessages(messages, uri) {
        console.log('forwardMessages', messages.length, 'messages from', uri);
        // this will show the main interface to select one or more contacts
        
        this.setState({shareToContacts: true,
                       forwardContent: messages || [],
                       selectedContact: null,
                       sourceContact: this.state.selectedContact});
    }

    async file2GiftedChat(fileObject) {
        var id = uuid.v4();
        let uri = this.state.selectedContact.uri;

        let filepath = fileObject.uri ? fileObject.uri : fileObject;
        let basename = fileObject.fileName || filepath.split('\\').pop().split('/').pop();

        basename = basename.replace(/\s|:/g, '_');

        let file_transfer = { 'path': filepath,
                              'filename': basename,
                              'sender': {'uri': this.state.account.id},
                              'receiver': {'uri': uri},
                              'transfer_id': id,
                              'direction': 'outgoing'
                              };


        if (filepath.startsWith('content://')) {
            // on android we must copy this file early
            const localPath = RNFS.DocumentDirectoryPath + "/" + this.state.account.id + "/" + uri + "/" + id + "/" + basename;
            const dirname = path.dirname(localPath);
            await RNFS.mkdir(dirname);
            console.log('Copy', filepath, localPath);
            await RNFS.copyFile(filepath, localPath);
            filepath = localPath;
            file_transfer.local_url = localPath;
        }

        let stats_filename = filepath.startsWith('file://') ? filepath.substr(7, filepath.length - 1) : filepath;
        const { size } = await ReactNativeBlobUtil.fs.stat(stats_filename);
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

        if (utils.isImage(basename, file_transfer.filetype)) {
            msg.image = filepath;
        } else if (utils.isAudio(basename)) {
            msg.audio = filepath;
        } else if (utils.isVideo(basename) || file_transfer.duration) {
            msg.video = filepath;
        }

        return msg;
    }

    contactStartShare() {
		 this.setState({contactIsSharing: true});    
    }

    contactStopShare() {
		 this.setState({contactIsSharing: false});    
    }

	async handleAndroidShare(payload) {

      if (this.state.shareToContacts) {
		  return;
      }

	  console.log('--handleAndroidShare', payload);
	
	  let files = [];
	
	  // Multiple files (SEND_MULTIPLE)
	  if (Array.isArray(payload.items) && payload.items.length > 0) {
		for (const item of payload.items) {
		  const resolved = await this.resolveSharedFile(item);
		  if (resolved) {
			files.push({
			  kind: 'file',
			  ...resolved,
			});
		  }
		}
	  }
	  // Web link / plain text
	  else if (payload.type === 'text/plain' && payload.text) {
		files.push({
		  kind: 'link',
		  filePath: null,
		  weblink: payload.text,
		  mimeType: payload.type,
		  text: payload.subject || null,
		});
	  }
	  // Single file
	  else if (payload.uri) {
		const resolved = await this.resolveSharedFile(payload);
		if (resolved) {
		  files.push({
			kind: 'file',
			...resolved,
		  });
		}
	  }
	  // Unknown
	  else {
		console.log('Unknown Android share payload', payload);
		return;
	  }
	
	  console.log('Derived share(s)', files);
	
	  if (files.length === 0) return;
	
	  this.sharedAndroidFiles = files;
	  this.setState({
		shareToContacts: true,
		sharedContent: files,
		selectedContact: null,
	  });
	}
	
	async resolveSharedFile({ uri, type }) {
	  if (!uri) return null;
	
	  try {
		const ext = guessExtension(type);
		const fileName = `shared_${Date.now()}${ext}`;
		const destPath = `${RNFS.CachesDirectoryPath}/${fileName}`;
	
		await RNFS.copyFile(uri, destPath);
	
		return {
		  contentUri: uri,
		  filePath: destPath,
		  fileName,
		  mimeType: type,
		};
	  } catch (e) {
		console.log('resolveSharedFile error', e);
		return null;
	  }
	}

    fetchSharedItemsAndroidAtStart() {
        //console.log('fetchSharedItemsAndroidAtStart');
        
        ReceiveSharingIntent.getReceivedFiles(files => {
            // files returns as JSON Array example
            //[{ filePath: null, text: null, weblink: null, mimeType: null, contentUri: null, fileName: null, extension: null }]
                if (files.length > 0) {
                    this.sharedAndroidFiles = files;
                    console.log('Android share', files.length, 'items');

                    this.setState({shareToContacts: true,
                                   sharedContent: files,
                                   selectedContact: null});

                    let item = files[0];
                    
                    let what = 'Share text with contacts';

                    if (item.weblink) {
                        what = 'Share web link with contacts';
                    }

                    if (item.filePath) {
                        what = 'Share file with contacts';
                    }
                    
                    console.log(what);

                    //this._notificationCenter.postSystemNotification(what);
                } else {
                    console.log('Nothing to share');
                }
            }, (error) => {
                //console.log('Error receiving sharing intent', error.message);
            },
            'com.agprojects.sylk'
        );
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async shareContent() {
        console.log('-- shareContent');
        let selectedContacts = this.state.selectedContacts || [];
        let forwardContent = this.state.forwardContent || [];
        let sharedContent = this.state.sharedContent || [];
        
        console.log('forwardContent', forwardContent.length);
        console.log('sharedContent', sharedContent.length);

        this.endShareContent();

        let waitCounter = 0;
        let waitInterval = 30;

        while (waitCounter < waitInterval) {
            if (!this.state.contactsLoaded) {
                console.log('Wait until contacts are loaded');
                await this._sleep(1000);
            } else {
                break;
            }

            waitCounter++;
        }

        let id;
        let i = 0;
        let j = 0;
        let uri;
        let content = '';
        let contentType;

        let msg = {
            text: content,
            createdAt: new Date(),
            direction: 'outgoing',
            user: {}
        }
            
        if (forwardContent.length > 0) {
		    for (const message of forwardContent) {
                contentType = message.contentType;

				msg = {
					createdAt: new Date(),
					direction: 'outgoing',
					user: {},
					text: message.text
				}
	
				if (message.metadata && message.metadata.filename) {
					contentType = 'application/sylk-file-transfer';
					msg.metadata = message.metadata;
					msg.metadata.sender.uri = this.state.accountId;
					msg.metadata.path = msg.metadata.local_url;
					msg.metadata.receiver.uri = null;
					msg.metadata.error = null;
					msg.metadata.local_url = null;
					msg.metadata.url = null;
					msg.metadata.paused = false;
					msg.metadata.failed = false;
					msg.metadata.until = null;
					if (message.metadata.filename.endsWith('.asc')) {
						msg.metadata.filename = message.metadata.filename.slice(0, -4);
					}
				}
	
				i = 0;

				while (i < selectedContacts.length) {
					uri = selectedContacts[i];
					i++;
	
					id = uuid.v4();
					msg._id = id;
					msg.key = id;

					console.log('Forwarding message', message._id, contentType, 'to', uri);

					if (msg.metadata && msg.metadata.receiver) {
						msg.metadata.receiver.uri = uri;
						msg.metadata.transfer_id = id;
					}
					//console.log(' ---- msg', msg);
					this.sendMessage(uri, msg, contentType);
				}
			}

        } else {
            if (sharedContent.length === 0) {
                console.log('No sharing content...');
                return;
            }

            if (selectedContacts.length === 0) {
                console.log('No selected contacts...');
                this._notificationCenter.postSystemNotification('Sharing canceled');
                return;
            }

            console.log('Sharing content...', sharedContent.length, 'items to', selectedContacts.length, 'contacts');

            let item;
            let basename;
            let localPath;
            let dirname;
            let file_transfer;

            while (j < sharedContent.length) {
                item = sharedContent[j];
                j++;

                //console.log('Sharing item', item);
				contentType = 'text/plain';

                if (item.subject) {
                    content = content + '\n\n' + item.subject;
                }

                if (item.text) {
                    content = content + '\n\n' + item.text;
                }

                if (item.weblink) {
                    // android only
                    content = content + '\n\n' + item.weblink;
                }

                if (item.filePath) {
                    if (item.fileName.endsWith('.weblink')) {
                        // ios only
						const link = await RNFS.readFile(item.filePath, 'utf8');
						content = content ? content + '\n\n' + link.trim() : link.trim();
						console.log('Sharing web link:', content);

                    } else {
						contentType = 'application/sylk-file-transfer';
						file_transfer = { 'path': item.filePath,
										  'filename': item.fileName,
										  'filetype' : item.mimeType,
										  'sender': {'uri': this.state.accountId},
										  'receiver': {'uri': null},
										  'direction': 'outgoing',
										  'fullSize': !this.state.resizeContent
										  };

						msg.metadata = file_transfer;

						if (utils.isImage(item.fileName, file_transfer.filetype)) {
							msg.image = Platform.OS === "android" ? 'file://'+ item.filePath : item.filePath;
						} else if (utils.isAudio(item.fileName)) {
							msg.audio = Platform.OS === "android" ? 'file://'+ item.filePath : item.filePath;
						} else if (utils.isVideo(item.fileName)) {
							msg.video = Platform.OS === "android" ? 'file://'+ item.filePath : item.filePath;
						}
	
						if (content.length > 0) {
							content = content + ' + ' + utils.beautyFileNameForBubble(file_transfer);
						} else {
							content = utils.beautyFileNameForBubble(file_transfer);
						}
					}
                }

                content = content.trim();
                msg.text = content;

                i = 0;
                while (i < selectedContacts.length) {
                    uri = selectedContacts[i];
                    i++;

                    id = uuid.v4();
                    msg._id = id;
                    msg.key = id;

                    if (msg.metadata && msg.metadata.receiver) {
                        msg.metadata.receiver.uri = uri;
                        msg.metadata.transfer_id = id;

                        if (Platform.OS === 'ios') {
                            basename = file_transfer.path.split('\\').pop().split('/').pop();
                            localPath = RNFS.DocumentDirectoryPath + "/" + this.state.accountId + "/" + uri + "/" + id + "/" + basename;
                            dirname = path.dirname(localPath);
                            await RNFS.mkdir(dirname);
                            console.log('Copy', file_transfer.path, localPath);
                            await RNFS.copyFile(file_transfer.path, localPath);
                            file_transfer.path = localPath;
                        }

                        try {
                            const { size } = await ReactNativeBlobUtil.fs.stat(file_transfer.path);
                            file_transfer.size = size;
                        } catch (e) {
                            console.log('Error stat file', file_transfer.path, e.message);
                            this._notificationCenter.postSystemNotification('Cannot access file', file_transfer.path);
                            continue;
                        }
                    }
                    await this.sendMessage(uri, msg, contentType);
                }
            }
        }
    }

	areInsetsEqual = (a, b) => {
	  if (!a || !b) return false;
	  return (
		a.top === b.top &&
		a.bottom === b.bottom &&
		a.left === b.left &&
		a.right === b.right
	  );
	};

    setFullScreen(state) {
        //console.log('fullScreen', state);
		this.setState({fullScreen: state});
    }

    endShareContent() {
        console.log('--endShareContent');
        let newSelectedContact = this.state.sourceContact;

        if (this.state.selectedContacts.length === 1 && !newSelectedContact) {
            let uri = this.state.selectedContacts[0];
            let contact = this.lookupContact(uri);
            if (contact) {
                newSelectedContact = contact;
            }
        }

        //console.log('Switch to contact', newSelectedContact);
        this.setState({sharedContent: [],
                       selectedContacts: [],
                       forwardContent: [],
                       selectedContact: newSelectedContact,
                       sourceContact: null,
                       shareToContacts: false});

    }

    filterHistory(filter) {
        //console.log('Filter history', filter);
        this.setState({historyFilter: filter});
    }

    saveConference(room, participants, displayName=null) {
        let uri = room;
        console.log('Save conference', room, 'with display name', displayName, 'and participants', participants);

        let contact = this.lookupContact(uri, true);

        contact.timestamp = new Date();
        contact.name = displayName;

        let new_participants = [];
        participants.forEach((uri) => {
            if (uri.indexOf('@') === -1) {
                uri =  uri + '@' + this.state.defaultDomain;
            }
            if (uri !== this.state.account.id) {
                new_participants.push(uri);
                console.log('Added', uri, 'to room', room);
            }
        });

        contact.participants = new_participants;
        this.saveSylkContact(uri, contact, 'saveConference');
    }

    addHistoryEntry(uri, callUUID, direction='outgoing', participants=[]) {
		
		console.log('addHistoryEntry', uri, callUUID, direction);

        //console.log('addHistoryEntry', uri);
        
        if (uri.indexOf('@') === -1) {
            uri = uri + '@videoconference.' + this.state.defaultDomain;
        }

		if (uri.indexOf('@guest.') > -1) {
			uri = "anonymous@anonymous.invalid";
		}

        if (this.state.rejectAnonymous && uri.indexOf('anonymous@') > -1) {
			console.log('skip history entry from anonymous address', uri);                
			return;
		}

        if (this.state.rejectNonContacts && direction == 'incoming') {
            if (contacts.length == 0) {
				console.log('skip history entry from unknown address', uri);                
				return;
            }
        }

		let contacts = this.lookupContacts(uri);
        //console.log('Found contacts', contacts);
        
		if (contacts.length === 0) {
			let newContact = this.newContact(uri);
			contacts = [newContact];
		}

		for (const contact of contacts) {
			contact.conference = participants.length > 1;
			contact.timestamp = new Date();
			contact.lastCallId = callUUID;
			contact.direction = direction;
			contact.lastMessage = direction + ' call';
			this.saveSylkContact(uri, contact, 'addHistoryEntry');
        }
    }

    updateHistoryEntry(uri, callUUID, duration) {
        if (uri.indexOf('@') === -1) {
            uri = uri + '@videoconference.' + this.state.defaultDomain;
        }

		let contacts = this.lookupContacts(uri);
		for (const contact of contacts) {
			if (contact.lastCallId === callUUID) {
				console.log('updateHistoryEntry', uri, callUUID, duration);
				contact.timestamp = new Date();
				contact.lastCallDuration = duration;
				contact.lastCallId = callUUID;
				if (contact.tags.indexOf('calls') === -1) {
					contact.tags.push('calls');
				}
				this.saveSylkContact(uri, contact, 'updateHistoryEntry');
			}
        }
    }

	// Accept any inset change — including to/from all-zero values. This is
	// important on foldables (e.g. Motorola Razr) where the cover display can
	// legitimately report all-zero insets after a fold, but the inner display
	// had non-zero values (notch / hole-punch / nav-bar). The previous
	// `(insets.top > 0 || ...)` guard rejected the cover-display update and
	// left stale insets cached, causing visible empty space between the
	// NavBar and the rest of the content on the cover screen.
	areInsetsValid = (insets) =>
	  insets &&
	  (
	  insets.top != this._insets.top ||
	  insets.right != this._insets.right ||
	  insets.bottom != this._insets.bottom ||
	  insets.left != this._insets.left
	  )
	  ;

	onInsetsChange = (insets) => {

	  if (this.areInsetsValid(insets)) {
		//console.log('Insets:', insets, '(was', this._insets, ')');
		this._insets = { ...insets };
		// _insets is an instance field, not state, so mutating it doesn't
		// trigger a re-render on its own. Stash the values in state as well
		// so that components relying on `extraStyles.marginTop = this._insets.top`
		// in render() re-compute with the new values on fold/unfold.
		//
		// Defer setState to a microtask: this callback fires from inside the
		// SafeAreaInsetsContext.Consumer child function, i.e. during render.
		// Calling setState synchronously there is a React anti-pattern that
		// can trigger "Cannot update during an existing state transition"
		// warnings and extra render work. The queued update still runs on
		// the next tick, well before the user sees the frame.
		const stateInsets = this.state && this.state.insets;
		if (
		  !stateInsets ||
		  insets.top !== stateInsets.top ||
		  insets.right !== stateInsets.right ||
		  insets.bottom !== stateInsets.bottom ||
		  insets.left !== stateInsets.left
		) {
		  setTimeout(() => {
		    this.setState({ insets: { ...insets } });
		  }, 0);
		}
	  }
	};

    get isLandscape() {
        return this.state.orientation === 'landscape';
    }
    
    enableFullScreen() {
		this.setState({fullscreen: true});
    }

    disableFullScreen() {
		this.setState({fullscreen: false});
    }

    toggleFullScreen() {
        if (this.state.fullscreen) {
			this.disableFullScreen();
        } else {
            this.enableFullScreen();
        }
    }

    render() {
        let footerBox = <View style={styles.footer}><FooterBox /></View>;

		let extraStyles = {paddingBottom: 0};
		let extraStyles2 = {};

		extraStyles.borderWidth = 0;
		extraStyles.borderColor = 'green';
        
		let { width, height } = Dimensions.get('window');

        if (Platform.OS === 'android') {
            /*
			Android 11	30
			Android 12	31-32
			Android 13	33
			Android 14	34
            */

            if (this.state.keyboardVisible && Platform.Version >= 34) {
				//extraStyles = {paddingBottom: this.state.insets.top};
			}

            if (Platform.Version >= 34) {
				// On foldables (Razr-style) in folded mode, Android often
				// reports a sizeable bottom inset on the cover display —
				// especially in its "Full Screen" / "Full View" mode where
				// the nav bar is hidden but a cutout/gesture region still
				// claims space. Applying that as marginBottom leaves the
				// dark-linen app background visible below the Recents bar
				// (what the user sees as "empty gray space"). In folded
				// mode we zero the inset margins so the content extends
				// fully to the screen edges. The small gesture strip at
				// the bottom of the cover display still works — Android
				// draws its hint on top of our content — and the Recents
				// bar remains visually anchored at the screen bottom.
				if (this.state.fullscreen || this.state.isFolded) {
					extraStyles.marginTop = 0;
				} else {
					extraStyles.marginTop = this._insets.top;
				}

				if (this.isLandscape) {
				    if (this.state.fullscreen || this.state.isFolded) {
				    } else {
						extraStyles.marginRight = this._insets.right;
						extraStyles.marginLeft = this._insets.left;
					}
				} else {
					if (this.state.fullscreen) {
						extraStyles.height = height + this._insets.bottom + this._insets.top;
					} else if (this.state.isFolded) {
						// folded cover display — no bottom margin, let
						// the app fill the whole cover screen.
					} else {
						extraStyles.marginBottom = this._insets.bottom;
					}
				}
            }
        }
        
        //console.log('extraStyles', extraStyles, this._insets);

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
        }

        let loadingLabel = this.state.loading;
        if (this.state.syncConversations) {
            //loadingLabel = 'Sync conversations';

        } else if (this.state.reconnectingCall) {
            loadingLabel = 'Reconnecting call...';
        } else if (this.signOut) {
            //loadingLabel = 'Signing out...';
        }

return (
  <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <PaperProvider theme={theme}>
      <Router history={history}>
        <ImageBackground
          source={backgroundImage}
          style={{ width: '100%', height: '100%' }}
        >
          <View
            style={[mainStyle.MainContainer, extraStyles]}
            onLayout={(event) =>
              this.setState(
                {
                  Width_Layout: event.nativeEvent.layout.width,
                  Height_Layout: event.nativeEvent.layout.height,
                },
                () => this._detectOrientation()
              )
            }
          >
            <SafeAreaInsetsContext.Consumer>
              {(insets) => {
				this.onInsetsChange(insets);
                return (
                  <SafeAreaView
                    style={[
                      styles.root,
                      extraStyles2
                    ]}
					// IMPORTANT (foldable + Android 15 edge-to-edge):
					// On Android SDK >= 34 the outer <View style={[MainContainer,
					// extraStyles]}> already applies marginTop/marginBottom/
					// marginLeft/marginRight from this._insets, so letting
					// SafeAreaView ALSO pad by top/bottom/right produced DOUBLE
					// inset spacing. On the Razr 60 Ultra in folded fullscreen the
					// bottom inset ended up counted twice, yielding an ~150px gray
					// gap below the Recents bar.
					// We therefore disable SafeAreaView's auto-padding on Android
					// (single source of truth = extraStyles) and keep the normal
					// top/bottom/right behavior on iOS where no manual margins are
					// applied.
					edges={Platform.OS === 'android' ? [] : ['top', 'bottom', 'right']}
                  >

				{this.state.syncConversations && !this.state.lastSyncId && (
					<View
					  pointerEvents="auto"
					  style={{
						position: 'absolute',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						justifyContent: 'center',
						alignItems: 'center',
						backgroundColor: 'rgba(0,0,0,0.2)', // optional dim
						zIndex: 9999,
						elevation: 9999, // Android
					  }}
						>
						<ActivityIndicator animating={true} size={'large'} color={"#D32F2F"} />
						<Title style={{ color: '#fff', textAlign: 'center'}}>Sync messages from server...</Title>
					</View>
					)
					}
			    
                    {Platform.OS === 'android' && (
                      <IncomingCallModal
                        contact={this.state.incomingContact}
                        media={this.state.incomingMedia}
                        CallUUID={this.state.incomingCallUUID}
                        onAccept={this.callKeepAcceptCall}
                        onReject={this.callKeepRejectCall}
                        onHide={this.dismissCall}
                        orientation={this.state.orientation}
                        isTablet={this.state.isTablet}
                        playIncomingRingtone={this.playIncomingRingtone}
                      />
                    )}

                    <LogsModal
                      logs={this.state.logs}
                      show={this.state.showLogsModal}
                      refresh={this.showLogs}
                      close={this.hideLogsModal}
                      purgeLogs={this.purgeLogs}
                      orientation={this.state.orientation}
                    />

                    <LoadingScreen
                      text={loadingLabel}
                      show={!!loadingLabel}
                      orientation={this.state.orientation}
                      isTablet={this.state.isTablet}
                    />

                    {/* Routes */}
                    <Switch>
                      {[
                        { path: '/', component: this.main, exact: true },
                        { path: '/login', component: this.login, exact: true },
                        { path: '/logout', component: this.logout, exact: true },
                        { path: '/ready', component: this.ready, exact: true },
                        { path: '/call', component: this.call, exact: true },
                        { path: '/conference', component: this.conference, exact: true },
                        { path: '/preview', component: this.preview, exact: true },
                      ].map((route) => (
                        <Route
                          key={route.path}
                          exact={route.exact}
                          path={route.path}
                          render={(props) => (
                            <route.component {...props} insets={insets} />
                          )}
                        />
                      ))}
                      <Route
                        render={(props) => (
                          <this.notFound {...props} insets={insets} />
                        )}
                      />
                    </Switch>

                    <NotificationCenter ref={this.notificationCenterRef} />
                  </SafeAreaView>
                );
              }}
            </SafeAreaInsetsContext.Consumer>
          </View>
        </ImageBackground>
      </Router>
    </PaperProvider>
  </SafeAreaProvider>
);

    }

    notFound(match) {

        const status = {
            title   : '404',
            message : 'Oops, the page your looking for can\'t found',
            level   : 'danger',
            width   : 'large'
        }
        return (
            <StatusBox
                {...status}
            />
        );
    }

    saveHistory(history) {
        let missedCalls = this.state.missedCalls;

        let localTime;
        let tags = [];
        let uri;
        let i = 0;
        let idx;
        let contact;
        let must_save = false;

        history.forEach((item) => {
            uri = item.uri;
            //console.log('saveHistory', uri);

            must_save = false;
            if (this.state.blockedUris.indexOf(uri) > -1) {
                return;
            }

			let contact = this.lookupContact(uri);

			if (this.state.rejectNonContacts && item.direction == 'incoming') {
				if (!contact && !item.duration) {
					//console.log('Skip server history entry from unknown address', uri);                
					return;
				}
			}

			if (this.state.rejectAnonymous && item.direction == 'incoming') {
				if (uri.indexOf('@guest') > -1) {
					return;
				}
		
				if (uri.indexOf('anonymous') > -1) {
					return;
				}
			}

            if (!contact) {
				return;
            }

            if (item.timestamp > contact.timestamp) {
                contact.timestamp = item.timestamp;
                must_save = true;

            } else {
                if (contact.lastCallId === item.sessionId) {
                    return;
                } else {
                    must_save = true;
                }
            }

            tags = contact.tags;

            if (tags.indexOf('missed') > - 1) {
                tags.push('missed');
                //console.log('Increment unread count for', uri);
                contact.unread.push(item.sessionId);
                if (missedCalls.indexOf(item.sessionId) === -1) {
                    missedCalls.push(item.sessionId);
                    must_save = true;
                }
            } else {
                idx = tags.indexOf('missed');
                if (idx > -1) {
                    tags.splice(idx, 1);
                }
            }
            
            if (tags.indexOf('calls') === -1) {
				tags.push('calls');
            }

            if (item.displayName && !contact.name) {
                contact.name = item.displayName;
                must_save = true;
            }

            contact.direction = item.direction;
            contact.lastCallId = item.sessionId;
            contact.lastCallDuration = item.duration;
            contact.lastCallMedia = item.media;
            contact.conference = item.conference;

            if (tags !== contact.tags) {
                must_save = true;
            }

            contact.tags = tags;
            i = i + 1;

            if (must_save) {
                this.saveSylkContact(uri, contact, 'saveHistory');
            }
         });

         this.setState({missedCalls: missedCalls});
    }

    get activeCall() {
       return this.state.currentCall || this.state.incomingCall;
    }

    hideLogsModal() {
       this.setState({showLogsModal: false});
    }

    purgeLogs() {
        RNFS.unlink(logfile)
          .then(() => {
            utils.timestampedLog('Log file initialized');
            this.showLogs();
          })
          // `unlink` will throw an error, if the item to unlink does not exist
          .catch((err) => {
            console.log(err.message);
          });
    }

    showLogs() {
       this.setState({showLogsModal: true});
       RNFS.readFile(logfile, 'utf8').then((content) => {
           console.log('Read', content.length, 'bytes from', logfile);
           const lastlines = content.split('\n').slice(-MAX_LOG_LINES).join('\n');
           this.setState({logs: lastlines});
       });
    }

    trimLogs() {
       RNFS.readFile(logfile, 'utf8').then((content) => {
           const lines = content.split('\n');
           //console.log('Read', lines.length, 'lines and', content.length, 'bytes from', logfile);
           if (lines.length > (MAX_LOG_LINES + 50) || content.length > 100000) {
               const text = lines.slice(-MAX_LOG_LINES).join('\n');
               RNFS.writeFile(logfile, text + '\r\n', 'utf8')
                   .then((success) => {
                   //console.log('Trimmed logs to', MAX_LOG_LINES, 'lines and', text.length, 'bytes');
               })
               .catch((err) => {
                   console.log(err.message);
               });
           }
       });
    }

    ready() {
        let publicKey;
        let call = this.activeCall;

        if (this.state.selectedContact) {
            const uri = this.state.selectedContact.uri;
            if (this.state.selectedContact.publicKey) {
                publicKey = this.state.selectedContact.publicKey;
            } else {
                if (this.state.selectedContact.uri == this.state.accountId) {
					publicKey = this.state.keys ? this.state.keys.public: null;
                }
            }
        } else {
            publicKey = this.state.keys ? this.state.keys.public: null;
        }
        
        const messagesMetadata = this.state.selectedContact ? this.state.messagesMetadata : {};
        
        return (
            <Fragment>
               { !this.state.fullScreen ?
                <NavigationBar
                    ref = {this.navigationBarRef}
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
                    sylkDomain = {this.state.sylkDomain}
                    accountId = {this.state.accountId}
                    email = {this.state.email}
                    logout = {this.logout}
                    contactsLoaded = {this.state.contactsLoaded}
                    inCall = {(this.state.incomingCall || this.state.currentCall) ? true: false}
                    toggleSpeakerPhone = {this.toggleSpeakerPhone}
                    toggleProximity = {this.toggleProximity}
                    proximity = {this.state.proximityEnabled}
                    preview = {this.startPreview}
                    showLogs = {this.showLogs}
                    goBackFunc = {this.goBackToHome}
                    goBackToCallFunc = {this.goBackToCall}
                    connection = {this.state.connection}
                    registrationState = {this.state.registrationState}
                    orientation = {this.state.orientation}
                    isTablet = {this.state.isTablet}
                    isFolded = {this.state.isFolded}
                    displayName = {this.state.displayName}
                    myDisplayName = {this.state.displayName}
                    myPhoneNumber = {this.state.myPhoneNumber}
                    organization = {this.state.organization}
                    selectedContact = {this.state.selectedContact}
                    allContacts = {this.state.allContacts}
                    messages = {this.state.messages}
                    exportKey = {this.exportPrivateKey}
                    publicKey = {publicKey}
                    deleteMessages = {this.deleteMessages}
                    deleteMessage = {this.deleteMessage}
                    deleteFiles = {this.deleteFiles}
                    toggleFavorite = {this.toggleFavorite}
                    toggleAutoAnswer = {this.toggleAutoAnswer}
                    toggleBlocked = {this.toggleBlocked}
                    saveConference={this.saveConference}
                    defaultDomain = {this.state.defaultDomain}
                    favoriteUris = {this.state.favoriteUris}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    saveContactByUser = {this.saveContactByUser}
                    sendPublicKey = {this.sendPublicKeyToUri}
                    sendMessage = {this.sendMessage}
                    saveSystemMessage = {this.saveSystemMessage}
                    sendLocalNotification = {this.sendLocalNotification}
                    deletePublicKey = {this.deletePublicKey}
                    showImportModal = {this.showImportPrivateKeyModal}
                    syncConversations = {this.state.syncConversations}
                    showCallMeMaybeModal = {this.state.showCallMeMaybeModal}
                    toggleCallMeMaybeModal = {this.toggleCallMeMaybeModal}
                    showConferenceModalFunc = {this.showConferenceModal}
                    appStoreVersion = {this.state.appStoreVersion}
                    checkVersionFunc = {this.checkVersion}
                    showExportPrivateKeyModal = {this.state.showExportPrivateKeyModal}
                    showExportPrivateKeyModalFunc = {this.showExportPrivateKeyModal}
                    hideExportPrivateKeyModalFunc = {this.hideExportPrivateKeyModal}
                    showRestoreKeyModal = {this.state.showRestoreKeyModal}
                    showRestoreKeyModalFunc = {this.showRestoreKeyModal}
                    generateKeysFunc={this.generateKeys}
                    refetchMessages = {this.refetchMessages}
                    blockedUris = {this.state.blockedUris}
                    myuuid={this.state.myuuid}
                    filteredMessageIds = {this.state.filteredMessageIds}
                    resumeTransfers = {this.resumeTransfers}
                    contentTypes = {this.state.contentTypes}
                    canSend = {this.canSend}
                    sharingAction = {this.sharingAction}
                    toggleDnd = {this.toggleDnd}
                    dnd = {this.state.dnd}
                    toggleRejectAnonymous = {this.toggleRejectAnonymous}
                    rejectAnonymous = {this.state.rejectAnonymous}
                    toggleChatSounds = {this.toggleChatSounds}
                    chatSounds = {this.state.chatSounds}
                    toggleReadReceipts = {this.toggleReadReceipts}
                    readReceipts = {this.state.readReceipts}
                    toggleRejectNonContacts = {this.toggleRejectNonContacts}
                    rejectNonContacts = {this.state.rejectNonContacts}
                    buildId = {this.buildId}
                    getTransferedFiles = {this.getTransferedFiles}
                    transferedFiles = {this.state.transferedFiles}
                    transferedFilesSizes = {this.state.transferedFilesSizes}
                    toggleSearchMessages = {this.toggleSearchMessages}
                    toggleSearchContacts = {this.toggleSearchContacts}
                    searchMessages = {this.state.searchMessages}
                    searchContacts = {this.state.searchContacts}
                    searchString = {this.state.searchString}
                    isLandscape = {this.state.orientation === 'landscape'}
                    serverSettingsUrl = {this.state.serverSettingsUrl}
                    publicUrl = {this.state.publicUrl}
					insets = {this._insets}
					call = {this.state.currentCall || this.state.incomingCall}
					storageUsage = {this.state.storageUsage}
					syncPercentage = {this.state.syncPercentage}
					toggleDevMode = {this.toggleDevMode}
					devMode = {this.state.devMode}
					toggleAutoAnswerMode = {this.toggleAutoAnswerMode}
 					autoAnswerMode = {this.state.autoAnswerMode}
 					hasAutoAnswerContacts = {this.state.hasAutoAnswerContacts}
 					deleteAccountUrl = {this.state.deleteAccountUrl}
                    // Destructive: wipes the active account's messages /
                    // contacts / keys / files from the device and returns
                    // the user to /login. The confirmation dialog lives
                    // inside NavigationBar (DeleteAccountModal).
                    deleteAccount = {this.deleteAccount}
                    showQRCodeScanner = {this.state.showQRCodeScanner}
                    toggleQRCodeScannerFunc = {this.toggleQRCodeScanner}
                    // Fires every time NavigationBar's internal
                    // activeLocationShares map changes. We mirror it into
                    // app.js state so ReadyBox can render its own pulsing
                    // indicator on the chat-header "Share location"
                    // button when the current chat is actively sharing.
                    onActiveSharesChanged = {(shares) => this.setState({activeLocationShares: shares || {}})}
                    // Predicate used by NavigationBar.stopLocationSharing
                    // to pick "Meeting" vs "Meeting request" wording on
                    // the end-of-session system note. Once the handshake
                    // has completed (either side accepted), the word
                    // "request" stops applying and we drop it.
                    isMeetingSessionAccepted = {this.isMeetingSessionAccepted.bind(this)}
                />
                : null}

                <ReadyBox
                    account = {this.state.account}
                    password = {this.state.password}
                    callHistoryUrl = {this.state.callHistoryUrl}
                    fontScale = {this.state.fontScale}
                    inCall = {(this.state.incomingCall || this.state.currentCall) ? true: false}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    startLocationShare = {() => {
                        // ReadyBox's chat-header map-marker "pin" button
                        // delegates here. NavigationBar owns the share
                        // state (activeLocationShares) and handles the
                        // actual start/stop flow. We route through the
                        // `pinLocation` event rather than the kebab
                        // menu's `shareLocation`: when a share is
                        // already active for the current contact the
                        // pin opens the ActiveLocationSharesModal
                        // scoped to that chat (so the user has a
                        // visible Stop button they can tap on purpose)
                        // instead of silently killing the share.
                        const navBar = this.navigationBarRef && this.navigationBarRef.current;
                        if (navBar && typeof navBar.handleMenu === 'function') {
                            navBar.handleMenu('pinLocation');
                        }
                    }}
                    missedTargetUri = {this.state.missedTargetUri}
                    // Mirrored from NavigationBar via onActiveSharesChanged
                    // so the chat-header pin knows when it should pulse.
                    activeLocationShares = {this.state.activeLocationShares}
                    orientation = {this.state.orientation}
                    allContacts = {this.state.allContacts}
                    isTablet = {this.state.isTablet}
                    isFolded = {this.state.isFolded}
                    isLandscape = {this.state.orientation === 'landscape'}
                    refreshHistory = {this.state.refreshHistory}
                    refreshFavorites = {this.state.refreshFavorites}
                    saveHistory = {this.saveHistory}
                    myDisplayName = {this.state.displayName}
                    myPhoneNumber = {this.state.myPhoneNumber}
                    saveConference = {this.saveConference}
                    myInvitedParties = {this.state.myInvitedParties}
                    toggleFavorite = {this.toggleFavorite}
                    toggleBlocked = {this.toggleBlocked}
                    favoriteUris = {this.state.favoriteUris}
                    missedCalls = {this.state.missedCalls}
                    blockedUris = {this.state.blockedUris}
                    defaultDomain = {this.state.defaultDomain}
                    lookupContacts = {this.lookupContacts}
                    confirmRead = {this.confirmRead}
                    selectedContact = {this.state.selectedContact}
                    call = {this.state.incomingCall || this.state.currentCall}
                    goBackFunc = {this.goBackToCall}
                    messages = {this.state.messages}
                    deleteMessages = {this.deleteMessages}
                    sendMessage = {this.sendMessage}
                    expireMessage = {this.expireMessage}
                    reSendMessage = {this.reSendMessage}
                    deleteMessage = {this.deleteMessage}
                    getMessages = {this.getMessages}
                    pinMessage = {this.pinMessage}
                    unpinMessage = {this.unpinMessage}
                    selectContact = {this.selectContact}
                    inviteContacts = {this.state.inviteContacts}
                    shareToContacts = {this.state.shareToContacts}
                    selectedContacts = {this.state.selectedContacts}
                    updateSelection = {this.updateSelection}
                    togglePinned = {this.togglePinned}
                    pinned = {this.state.pinned}
                    loadEarlierMessages = {this.loadEarlierMessages}
                    newContactFunc = {this.newSyntheticContact}
                    messageZoomFactor = {this.state.messageZoomFactor.toString()}
                    isTyping = {this.state.isTyping}
                    navigationItems = {this.state.navigationItems}
                    showConferenceModal = {this.state.showConferenceModal}
                    hideConferenceModalFunc = {this.hideConferenceModal}
                    showConferenceModalFunc = {this.showConferenceModal}
                    shareContent = {this.shareContent}
                    cancelShareContent = {this.endShareContent}
                    filterHistoryFunc = {this.filterHistory}
                    historyFilter = {this.state.historyFilter}
                    inviteToConferenceFunc = {this.inviteToConference}
                    showQRCodeScanner = {this.state.showQRCodeScanner}
                    toggleQRCodeScannerFunc = {this.toggleQRCodeScanner}
                    keys = {this.state.keys}
                    keyStatus = {this.state.keyStatus}
                    showImportPrivateKeyModal = {this.state.showImportPrivateKeyModal}
                    downloadFile = {this.downloadFile}
                    uploadFile = {this.uploadFile}
                    decryptFunc = {this.decryptFile}
                    isTexting = {this.state.isTexting}
                    keyboardVisible = {this.state.keyboardVisible}
                    contentTypes = {this.state.contentTypes}
                    canSend = {this.canSend}
                    forwardMessagesFunc = {this.forwardMessages}
                    sourceContact = {this.state.sourceContact}
                    requestCameraPermission = {this.requestCameraPermission}
                    requestDndPermission = {this.requestDndPermission}
                    requestMicPermission = {this.requestMicPermission}
                    requestStoragePermission = {this.requestStoragePermission}
                    postSystemNotification = {this.postSystemNotification}
                    sortBy = {this.state.sortBy}
                    toggleSearchMessages = {this.toggleSearchMessages}
                    toggleSearchContacts = {this.toggleSearchContacts}
                    searchMessages = {this.state.searchMessages}
                    searchContacts = {this.state.searchContacts}
                    defaultConferenceDomain = {this.state.defaultConferenceDomain}
                    dark = {this.state.dark}
                    messagesMetadata = {messagesMetadata}
                    file2GiftedChat = {this.file2GiftedChat}
					contactStartShare = {this.contactStartShare}
					contactStopShare = {this.contactStopShare}
					contactIsSharing ={this.state.contactIsSharing}
					acceptMeetingRequest = {this._acceptMeetingRequest}
					isMeetingRequestAcceptable = {this.isMeetingRequestAcceptable}
					fullScreen = {this.state.fullScreen}
					setFullScreen = {this.setFullScreen}
					transferProgress = {this.state.transferProgress}
					totalMessageExceeded = {this.state.totalMessageExceeded}
					createChatContact = {this.createChatContact}
					selectAudioDevice = {this.selectAudioDevice}
					updateFileTransferMetadata = {this.updateFileTransferMetadata}
					markAudioMessageDisplayed = {this.markAudioMessageDisplayed}
					insets = {this._insets}
					vibrate = {this.vibrate}
					storageUsage = {this.state.storageUsage}
					toggleResizeContent = {this.toggleResizeContent}
					resizeContent = {this.state.resizeContent}
					sharedContent = {this.state.sharedContent}
					autoAnswerMode = {this.state.autoAnswerMode}
 					hasAutoAnswerContacts = {this.state.hasAutoAnswerContacts}
 					appState = {this.state.appState}
 					remoteConferenceRoom = {this.state.remoteConferenceRoom}
 					remoteConferenceDomain = {this.state.remoteConferenceDomain}
                />

                <ImportPrivateKeyModal
                    show={this.state.showImportPrivateKeyModal}
                    close={this.hideImportPrivateKeyModal}
                    saveFunc={this.decryptPrivateKey}
                    generateKeysFunc={this.generateKeys}
                    useExistingKeysFunc={this.useExistingKeys}
                    privateKey={this.state.privateKey}
                    keyDifferentOnServer={this.state.keyDifferentOnServer}
                    keyExistsOnServer={this.state.keyStatus.existsOnServer}
                    keyStatus={this.state.keyStatus}
                    status={this.state.privateKeyImportStatus}
                    success={this.state.privateKeyImportSuccess}
                />

                <RestoreKeyModal
                    show={this.state.showRestoreKeyModal}
                    close={this.hideRestoreKeyModal}
                    saveFunc={this.restorePrivateKey}
                />

                <MeetingRequestModal
                    show={this.state.meetingRequestModal.show}
                    fromUri={this.state.meetingRequestModal.fromUri}
                    expiresAt={this.state.meetingRequestModal.expiresAt}
                    onAccept={() => this._acceptMeetingRequest()}
                    onDecline={() => this._declineMeetingRequest()}
                    close={() => this._closeMeetingRequestModal()}
                />
            </Fragment>
        );
    }

    preview() {
        return (
            <Fragment>
                <Preview
                    localMedia = {this.state.localMedia}
                    hangupCall = {this.hangupCall}
                    setDevice = {this.setDevice}
                    selectedavailableAudioDevices = {this.state.devices}
                />
            </Fragment>
        );
    }


    call() {
        let call = this.activeCall;
        let callState;

        if (call && call.id in this.state.callsState) {
            callState = this.state.callsState[call.id];
        }

        if (this.state.targetUri && !this.state.callContact) {
            let callContact = this.lookupContact(this.state.targetUri);
            if (callContact) {
				this.setState({callContact: callContact});
            }
        }
        
        const videoMuted = this.state.incomingCall && Platform.OS === 'ios';

        return (
            <Call
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                callContact = {this.state.callContact}
                call = {call}
                callState = {callState}
                connection = {this.state.connection}
                registrationState = {this.state.registrationState}
                localMedia = {this.state.localMedia}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.hangupCall}
                showLogs = {this.showLogs}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                callKeepSendDtmf = {this.callKeepSendDtmf}
                toggleMute = {this.toggleMute}
                callKeepStartCall = {this.callKeepStartCall}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                speakerphoneOn = {this.speakerphoneOn}
                speakerphoneOff = {this.speakerphoneOff}
                callUUID = {this.state.outgoingCallUUID}
                ABContacts = {this.state.contacts}
                intercomDtmfTone = {this.intercomDtmfTone}
				isLandscape = {this.state.orientation === 'landscape'}
                isTablet = {this.state.isTablet}
                isFolded = {this.state.isFolded}
                reconnectingCall = {this.state.reconnectingCall}
                muted = {this.state.muted}
                goBackFunc={this.goBackToHomeFromCall}
                messages = {this.state.messages}
                sendMessage={this.sendMessage}
                reSendMessage={this.reSendMessage}
                expireMessage = {this.expireMessage}
                deleteMessage = {this.deleteMessage}
                getMessages = {this.getMessages}
                pinMessage = {this.pinMessage}
                unpinMessage = {this.unpinMessage}
                confirmRead = {this.confirmRead}
                inviteToConferenceFunc={this.inviteToConference}
                finishInvite={this.finishInviteToConference}
                selectedContact={this.state.selectedContact}
                selectedContacts={this.state.selectedContacts}
                postSystemNotification = {this.postSystemNotification}
                terminatedReason = {this.state.terminatedReason}
                videoMuted = {videoMuted}
				startRingback = {this.startRingback}
				stopRingback = {this.stopRingback}
				useInCallManger = {this.useInCallManger}
				availableAudioDevices = {this.state.availableAudioDevices}
				selectedAudioDevice = {this.state.selectedAudioDevice}
				selectAudioDevice = {this.selectAudioDevice}
				iceServers = {this.state.iceServers}
				insets = {this._insets}
				enableFullScreen = {this.enableFullScreen}
				disableFullScreen = {this.disableFullScreen}
            />
        )
    }

    postSystemNotification(msg) {
        if (!this._notificationCenter) {
            return;
        }

        this._notificationCenter.postSystemNotification(msg);
    }

    conference() {
        let _previousParticipants = new Set();

        let call = this.activeCall;
        let callState;

        if (call && call.id in this.state.callsState) {
            callState = this.state.callsState[call.id];
        }

        /*
        if (this.myParticipants) {
            let room = this.state.targetUri.split('@')[0];
            if (this.myParticipants.hasOwnProperty(room)) {
                let uris = this.myParticipants[room];
                if (uris) {
                    uris.forEach((uri) => {
                        if (uri.search(this.state.defaultDomain) > -1) {
                            let user = uri.split('@')[0];
                            _previousParticipants.add(user);
                        } else {
                            _previousParticipants.add(uri);
                        }
                    });
                }
            }
        }
        */

        if (this.state.myInvitedParties) {
            if (this.state.myInvitedParties.hasOwnProperty(this.state.targetUri)) {
                let uris = this.state.myInvitedParties[this.state.targetUri];
                if (uris) {
                    uris.forEach((uri) => {
                        _previousParticipants.add(uri);
                    });
                }
            }
        }

        let previousParticipants = Array.from(_previousParticipants);

        return (
            <Conference
                notificationCenter = {this.notificationCenter}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                callContact = {this.state.callContact}
                allContacts = {this.state.allContacts}
                lookupContact = {this.lookupContact}
                connection = {this.state.connection}
                registrationState = {this.state.registrationState}
                currentCall = {this.state.currentCall}
                saveParticipant = {this.saveParticipant}
                saveConferenceMessage = {this.saveConferenceMessage}
                updateConferenceMessage = {this.updateConferenceMessage}
                deleteConferenceMessage = {this.deleteConferenceMessage}
                myInvitedParties = {this.state.myInvitedParties}
                saveConference = {this.appendInvitedParties}
                previousParticipants = {previousParticipants}
                participantsToInvite = {this.state.participantsToInvite}
                hangupCall = {this.hangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                toggleMute = {this.toggleMute}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                callUUID = {this.state.outgoingCallUUID}
                proposedMedia = {this.outgoingMedia}
                isLandscape = {this.state.orientation === 'landscape'}
                isTablet = {this.state.isTablet}
                muted = {this.state.muted}
                defaultDomain = {this.state.defaultDomain}
                fileSharingUrl = {this.state.fileSharingUrl}
                startedByPush = {this.startedByPush}
                inFocus = {this.state.inFocus}
                reconnectingCall = {this.state.reconnectingCall}
                toggleFavorite = {this.toggleFavorite}
                favoriteUris = {this.state.favoriteUris}
                goBackFunc={this.goBackToHomeFromConference}
                inviteToConferenceFunc={this.inviteToConference}
                selectedContacts={this.state.selectedContacts}
                callState={callState}
                messages = {this.state.messages}
                getMessages = {this.getMessages}
                finishInvite={this.finishInviteToConference}
                sendConferenceMessage={this.sendConferenceMessage}
				useInCallManger = {this.useInCallManger}
				availableAudioDevices = {this.state.availableAudioDevices}
				selectedAudioDevice = {this.state.selectedAudioDevice}
				selectAudioDevice = {this.selectAudioDevice}
				startRingback = {this.startRingback}
				stopRingback = {this.stopRingback}
				publicUrl = {this.state.publicUrl}
				iceServers = {this.state.iceServers}
				insets = {this._insets}
				enableFullScreen = {this.enableFullScreen}
				disableFullScreen = {this.disableFullScreen}
				sylkDomain = {this.state.sylkDomain}
            />
        )
    }

    matchContact(contact, filter='', matchDisplayName=true) {
        if (contact.uri.toLowerCase().startsWith(filter.toLowerCase())) {
            return true;
        }

        if (matchDisplayName && contact.name && contact.name.toLowerCase().indexOf(filter.toLowerCase()) > -1) {
            return true;
        }

        return false;
    }

    updateLoading(state, by='') {
        if (by === 'incoming_call_timeout') {
            console.log('Incoming call timeout');
        } else if (this.state.loading === incomingCallLabel && by !== 'incoming_call' && this.state.incomingCallUUID) {
            console.log('Skip updateLoading because we wait for a call', this.state.loading);
            return;
        } else if (by === 'incoming_call' && this.state.loading && this.state.loading !== incomingCallLabel) {
            console.log('Skip updateLoading by incoming_call', this.state.loading);
            return;
        }

        //console.log('updateLoading', this.state.loading, '->', state, 'by', by);
        this.setState({loading: state});
    }

    conferenceByUri(urlParameters) {
        const targetUri = utils.normalizeUri(urlParameters.targetUri, this.state.defaultConferenceDomain);
        const idx = targetUri.indexOf('@');
        const uri = {};
        const pattern = /^[A-Za-z0-9\-\_]+$/g;
        uri.user = targetUri.substring(0, idx);

        // check if the uri.user is valid
        if (!pattern.test(uri.user)) {
            const status = {
                title   : 'Invalid conference',
                message : `Oops, the conference ID is invalid: ${targetUri}`,
                level   : 'danger',
                width   : 'large'
            }
            return (
                <StatusBox
                    {...status}
                />
            );
        }

        return (
            <ConferenceByUriBox
                notificationCenter = {this.notificationCenter}
                handler = {this.handleConferenceByUri}
                targetUri = {targetUri}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                currentCall = {this.state.currentCall}
                hangupCall = {this.hangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
            />
        );
    }

    login() {
        //console.log('LO - login');

        let registerBox;
        let statusBox;
        //this.signOut = false;

        if (this.state.status !== null) {
            statusBox = (
                <StatusBox
                    message={this.state.status.msg}
                    level={this.state.status.level}
                />
            );
        }

        if (this.state.registrationState !== 'registered') {
            registerBox = (
                <RegisterBox
                    enrollmentUrl = {this.state.enrollmentUrl}
                    serverSettingsUrl = {this.state.serverSettingsUrl}
                    passwordRecoveryUrl = {this.state.passwordRecoveryUrl}
                    wsUrl = {this.state.wsUrl}
                    defaultDomain = {this.state.defaultDomain}
                    sylkDomain = {this.state.sylkDomain}
                    registrationInProgress = {this.state.registrationState !== null && this.state.registrationState !== 'failed'}
                    handleSignIn = {this.handleSignIn}
                    handleEnrollment = {this.handleEnrollment}
                    connected={this.state.connection && this.state.connection.state !== 'ready' ? false : true}
                    showLogo={true}
                    orientation = {this.state.orientation}
                    isTablet = {this.state.isTablet}
                    myPhoneNumber= {this.state.myPhoneNumber}
                    serverIsValid = {this.state.serverIsValid}
                    lookupSylkServer = {this.lookupSylkServer}
                    SylkServerDiscovery = {this.state.SylkServerDiscovery}
                    SylkServerDiscoveryResult = {this.state.SylkServerDiscoveryResult}
                    SylkServerStatus={this.state.SylkServerStatus}
                    resetSylkServerStatus={this.resetSylkServerStatus}
                    showQRCodeScanner = {this.state.showQRCodeScanner}
                    toggleQRCodeScannerFunc = {this.toggleQRCodeScanner}
                    requestCameraPermission = {this.requestCameraPermission}
                    configurations = {this.configurations}
                    accounts = {this.state.accounts}
                    serversAccounts = {this.state.serversAccounts}
                    connection = {this.state.connection}
                />
            );
        }

        return (
            <Fragment>
                {registerBox}
                {statusBox}
            </Fragment>
        );
    }


    _snapshotLogoutState(tag) {
        // Compact snapshot of the pieces of state that matter to the
        // logout/relogin flow. Grep for "LO - [logout]" to follow the
        // whole sequence end-to-end.
        const c = this.state.connection;
        const a = this.state.account;
        console.log('LO - [logout]', tag,
            '| accountId=', JSON.stringify(this.state.accountId),
            '| password=', this.state.password ? '(set,len=' + this.state.password.length + ')' : '(empty)',
            '| registrationState=', this.state.registrationState,
            '| accountVerified=', this.state.accountVerified,
            '| sylkDomain=', this.state.sylkDomain,
            '| wsUrl=', this.state.wsUrl,
            '| connection=', c ? ('obj#' + Object.id(c) + ' state=' + c.state) : 'null',
            '| account=', a ? ('obj id=' + a.id) : 'null',
            '| this.signOut=', this.signOut,
            '| this.signIn=', this.signIn,
            '| serversAccounts keys=', Object.keys(this.state.serversAccounts || {})
        );
    }

    resetState() {
        console.log('LO - [logout] resetState BEGIN');
        this._snapshotLogoutState('before resetState');

        // Instance flags that are reset along with account state.
        this.signOut = true;
        this.signIn = false;

        this.pushTokenSent = false;
        this.syncRequested = false;
        this.callKeeper.setAvailable(false);
        this.contactIndex = {};
        this.contactsIndexes = {};
        this.cdu_counter = 1;

        // Kill any pending registration-failure / retry timer so it cannot
        // fire ~10s later and ghost-re-register the account we just logged
        // out of.
        if (this.registrationFailureTimer) {
            console.log('LO - [logout] clearing registrationFailureTimer');
            clearTimeout(this.registrationFailureTimer);
            this.registrationFailureTimer = null;
        }

        // NOTE on what is CLEARED here vs PRESERVED:
        //   Cleared (account-specific): accountId, password, registrationState,
        //     accountVerified, registrationKeepalive, keys, keyStatus,
        //     keyDifferentOnServer, lastSyncId, status, loading, allContacts,
        //     purgeMessages, updateContacts, contactsLoaded.
        //   Preserved (server/app-level, kept so the user can re-sign in over
        //     the same websocket without re-discovering the server):
        //     connection, wsUrl, sylkDomain, configurationJson, configurations
        //     cache, accounts, serversAccounts, verifiedAccounts, all UI/
        //     device state.
        this.setState({loading: null,
					   accountId: '',
					   password: '',
                       contactsLoaded: false,
                       registrationState: null,
                       accountVerified: false,
                       registrationKeepalive: false,
                       keyDifferentOnServer: false,
                       status: null,
                       keys: null,
                       keyStatus: {},
                       lastSyncId: null,
                       accountVerified: false,
                       allContacts: [],
                       purgeMessages: [],
                       updateContacts: {},
                       });

        console.log('LO - [logout] resetState END (setState queued, this.state not yet flushed)');
        this._snapshotLogoutState('after resetState (pre-flush)');
    }

    logout() {
        console.log('LO - [logout] ======== logout() called ========');
        this._snapshotLogoutState('logout() entry');

        // Capture accountId BEFORE resetState clears it, because the call
        // below uses it to mark the SQL row inactive. Today this happens
        // to work because setState is async, but relying on that is fragile
        // — we log the snapshot explicitly so the order is visible.
        const accountIdBeforeReset = this.state.accountId;
        console.log('LO - [logout] captured accountIdBeforeReset=', JSON.stringify(accountIdBeforeReset));

        this.resetState();

		console.log('LO - [logout] calling saveSqlAccount with this.state.accountId=',
			JSON.stringify(this.state.accountId),
			'(note: setState from resetState may or may not have flushed yet)');
		this.saveSqlAccount(this.state.accountId, 0);

        this.changeRoute('/login', 'user logout');

        console.log('LO - [logout] branch selection: !this.signOut=', !this.signOut,
            'registrationState=', this.state.registrationState,
            'connection.state=', this.state.connection && this.state.connection.state);

        if (!this.signOut && this.state.registrationState !== null && this.state.connection && this.state.connection.state === 'ready') {
            // NOTE: this branch is effectively dead code today because
            // resetState() above always sets this.signOut=true. Kept and
            // logged so we can see that during repro.
            console.log('LO - [logout] branch A: remove push token + re-register to unregister');
            this.state.account.setDeviceToken('None', Platform.OS, this.deviceId, this.state.dnd, bundleId);
            console.log('LO - [logout] branch A: calling account.register()');
            this.state.account.register();
            return;
        } else if (this.signOut && this.state.connection && this.state.account) {
            console.log('LO - [logout] branch B: calling account.unregister()');
            this.state.account.unregister();
        } else {
            console.log('LO - [logout] no unregister branch matched (signOut=', this.signOut,
                'connection=', !!this.state.connection, 'account=', !!this.state.account, ')');
        }

        if (this.state.connection && this.state.account) {
			console.log('LO - [logout] connection.removeAccount() for account id=', this.state.account.id,
				'signOut=', this.signOut);
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    console.log('LO - [logout] removeAccount callback: ERROR', error);
                    logger.debug(error);
                } else {
                    console.log('LO - [logout] removeAccount callback: OK');
                }
            });
        } else {
            console.log('LO - [logout] skipped removeAccount (connection=', !!this.state.connection,
                'account=', !!this.state.account, ')');
        }

        this.setState({account: null,
                       displayName: '',
                       email: ''
                       });

        console.log('LO - [logout] connection deliberately PRESERVED; form should pre-fill from serversAccounts[', this.state.sylkDomain, ']');
        this._snapshotLogoutState('logout() exit (pre-flush)');
        console.log('LO - [logout] ======== logout() returning ========');

        //this.signOut = false;
    }

    main() {
        return null;
    }
}

export default Sylk;
