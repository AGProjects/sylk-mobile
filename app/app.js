// copyright AG Projects 2020-2025

import React, { Component, Fragment } from 'react';
import { Alert, View, SafeAreaView, ImageBackground, AppState, Linking, Platform, StyleSheet, Vibration, PermissionsAndroid} from 'react-native';
import { DeviceEventEmitter, BackHandler } from 'react-native';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
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
import PushNotification , {Importance} from "react-native-push-notification";
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
//import config from './config';
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

//debug.enable('sylkrtc*');
  
//import { registerForegroundListener } from '../firebase-messaging';

// import {
//   Agent,
//   AutoAcceptCredential,
//   AutoAcceptProof,
//   BasicMessageEventTypes,
//   ConnectionEventTypes,
//   ConnectionInvitationMessage,
//   ConnectionRecord,
//   ConnectionStateChangedEvent,
//   ConsoleLogger,
//   CredentialEventTypes,
//   CredentialRecord,
//   CredentialState,
//   CredentialStateChangedEvent,
//   HttpOutboundTransport,
//   WsOutboundTransport,
//   InitConfig,
//   LogLevel,
// } from '@aries-framework/core';

// import { AgentEventTypes } from "@aries-framework/core/build/agent/Events";
// import {agentDependencies} from '@aries-framework/react-native';

// Ignore all SQLite warnings
LogBox.ignoreLogs([
  'SQLite',
  'Possible unhandled promise rejection',
  'RNFB_SILENCE'
]);

var randomString = require('random-string');

const RNFS = require('react-native-fs');
const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

const logger = new Logger("App");

function logDevices(label, devices) {
  if (!devices || devices.length === 0) {
    console.log(`-- ${label}: (none)`);
    return;
  }

  console.log(`-- ${label}:`);
  devices.forEach(d => {
    if (d) {
      console.log(`  id: ${d.id}, name: ${d.name}, type: ${d.type}`);
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

const ONE_SECOND_IN_MS = 1000;

const VIBRATION_PATTERN = [
    1 * ONE_SECOND_IN_MS,
    1 * ONE_SECOND_IN_MS,
    4 * ONE_SECOND_IN_MS
  ];


let bundleId = `${getBundleId()}`;
const deviceId = getUniqueId();

const version = '1.0.0';
const MAX_LOG_LINES = 500;

if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    //bundleId = 'com.agprojects.sylk-ios.dev';
}

const unreadCounterTypes = new Set([
  'text/html',
  'text/plain',
  'application/sylk-file-transfer'
]);


const mainStyle = StyleSheet.create({

 MainContainer: {
   flex: 1,
   justifyContent: 'center',
   alignItems: 'center',
   margin: 0
 }
});

function _parseSQLDate(key, value) {
    return new Date(value);
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
    console.log('Error fixing directory structure:', error);
  }
}

		
// Only override once
if (!console.log.__isWrapped) {
  const originalLog = console.log;

/// if (Platform.OS === 'ios') {
//   // mute all logs on iOS
//   console.log = () => {};
//  } else {
    const LOG_PREFIX = `[${Platform.OS}]`;
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

        this._initialState = {
            appState: null,
            configurationUrl: 'https://download.ag-projects.com/Sylk/Mobile/config.json',
		    wsUrl: 'wss://webrtc-gateway.sipthor.net:9999/webrtcgateway/ws',
            defaultDomain: 'sylk.link',
            sylkDomain: 'sylk.link',
            publicUrl: 'https://webrtc.sipthor.net',
            defaultConferenceDomain: 'videoconference.sip2sip.info',
            enrollmentUrl: 'https://blink.sipthor.net/enrollment-sylk-mobile.phtml',
            iceServers: [{"urls":"stun:stun.sipthor.net:3478"}],
            serverSettingsUrl: 'https://mdns.sipthor.net/sip_settings.phtml',
            fileTransferUrl: 'https://webrtc-gateway.sipthor.net:9999/webrtcgateway/filetransfer',
            fileSharingUrl: 'https://webrtc-gateway.sipthor.net:9999/webrtcgateway/filesharing',
            configurationJson: null,
			testNumbers:[{uri: '4444@sylk.link', name: 'Test microphone'}, {uri: '3333@sylk.link', name: 'Test video'}],    
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
            autoanswerUris: [],
            blockedUris: [],
            missedCalls: [],
            initialUrl: null,
            reconnectingCall: false,
            muted: false,
            participantsToInvite: [],
            myInvitedParties: {},
            myContacts: {},
            showLogsModal: false,
            logs: '',
            proximityEnabled: true,
            messages: {},
            selectedContact: null,
            callsState: {},
            keys: null,
            showImportPrivateKeyModal: false,
            privateKey: null,
            privateKeyImportStatus: '',
            privateKeyImportSuccess: false,
            inviteContacts: false,
            shareToContacts: false,
            shareContent: [],
            selectedContacts: [],
            pinned: false,
            callContact: null,
            messageLimit: 100,
            messageZoomFactor: 1,
            messageStart: 0,
            contactsLoaded: false,
            replicateContacts: {},
            updateContactUris: {},
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
            firstSyncDone: false,
            keysNotFound: false,
            showLogo: true,
            historyFilter: null,
            showExportPrivateKeyModal: false,
            showRestoreKeyModal: false,
            showQRCodeScanner: false,
            navigationItems: {today: false,
                              yesterday: false,
                              conference: false},
            myuuid: null,
            deletedContacts: {},
            isTexting: false,
            filteredMessageIds: [],
            contentTypes: {},
            dnd: false,
            rejectAnonymous: false,
            chatSounds: true,
            rejectNonContacts: false,
            headsetIsPlugged: false,
            sortBy: 'timestamp',
            transferedFiles: {},
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
            waitForCommunicationsDevicesChanged: false,
            connectivity: null,
            proximityNear: false,
            respawnSync: false,
            SylkServerDiscovery: false,
            SylkServerDiscoveryResult: null,
            testConnection: null
        };

        this.buildId = "20250923";

        utils.timestampedLog('Init app with id', this.buildId);

        this.timeoutIncomingTimer = null;

		this.handledCalls = new Set();

        this.downloadRequests = {};
        this.uploadRequests = {};
        this.decryptRequests = {};
        this.cancelDecryptRequests = {};

        this.pendingNewSQLMessages = [];
        this.newSyncMessagesCount = 0;
        this.syncStartTimestamp = null;

        this.syncRequested = false;
        this.mustSendPublicKey = false;
        this.conferenceEndedTimer = null;
        this.unsubscribeNetInfo = null;

        this.syncTimer = null;
        this.lastSyncedMessageId = null;
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
        this.sql_contacts_keys = [];

        this._onFinishedPlayingSubscription = null
        this._onFinishedLoadingSubscription = null
        this._onFinishedLoadingFileSubscription = null
        this._onFinishedLoadingURLSubscription = null

        this.cancelRingtoneTimer = null;
    
        this.sync_pending_items = [];
        this.signup = {};
        this.last_signup = null;
        this.keyboardDidShowListener = null;

        this.state = Object.assign({}, this._initialState);

        this.myParticipants = {};
        this.mySyncJournal = {};
        
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
        this.initialChatContact = null;
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

        storage.get('signup').then((signup) => {
            if (signup) {
                this.signup = signup;
            }
        });

        storage.get('last_signup').then((last_signup) => {
            if (last_signup) {
                this.last_signup = last_signup;
            }
        });

        storage.get('mySyncJournal').then((mySyncJournal) => {
            if (mySyncJournal) {
                this.mySyncJournal = mySyncJournal;
            }
        });

        storage.get('lastSyncedMessageId').then((lastSyncedMessageId) => {
            if (lastSyncedMessageId) {
                this.lastSyncedMessageId = lastSyncedMessageId;
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

        this.loadPeople();

        for (let scheme of URL_SCHEMES) {
            DeepLinking.addScheme(scheme);
        }

        this.sqlTableVersions = {'messages': 13,
                                 'contacts': 7,
                                 'keys': 3,
                                 'accounts': 6
                                 }

        this.updateTableQueries = {'messages': {1: [],
                                                2: [{query: 'delete from messages', params: []}],
                                                3: [{query: 'alter table messages add column unix_timestamp INTEGER default 0', params: []}],
                                                4: [{query: 'alter table messages add column account TEXT', params: []}],
                                                5: [{query: 'update messages set account = from_uri where direction = ?' , params: ['outgoing']}, {query: 'update messages set account = to_uri where direction = ?', params: ['incoming']}],
                                                6: [{query: 'alter table messages add column sender TEXT' , params: []}],
                                                7: [{query: 'alter table messages add column image TEXT' , params: []}, {query: 'alter table messages add column local_url TEXT' , params: []}],
                                                8: [{query: 'alter table messages add column metadata TEXT' , params: []}],
                                                9: [{query: 'alter table messages add column state TEXT' , params: []}],
                                                10: [{query: 'alter table messages add column related_msg_id TEXT' , params: []}, {query: 'alter table messages add column related_action TEXT' , params: []}],
                                                11: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
                                                12: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
                                                13: [{query: 'delete from messages where content_type = ?', params: ['application/sylk-message-metadata']}],
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
                                                7: [{query: 'alter table contacts add column email TEXT', params: []}]
                                                },
                                   'keys': {2: [{query: 'alter table keys add column last_sync_id TEXT', params: []}],
                                            3: [{query: 'alter table keys add column my_uuid TEXT', params: []}]
                                            },
                                   'accounts': {3: [{query: 'alter table accounts add column dnd TEXT', params: []}],
												4: [{query: 'alter table accounts add column reject_anonymous TEXT', params: []}],
												5: [{query: 'alter table accounts add column reject_non_contacts TEXT', params: []}],
												6: [{query: 'alter table accounts add column chat_sounds TEXT', params: []}]
                                               }
                                   };

        this.db = null;
        this.initSQL();

        if (Platform.OS === 'android') {
			this.checkInstaller();

			this.boundWiredHeadsetDetect = this._wiredHeadsetDetect.bind(this);
			DeviceEventEmitter.addListener('WiredHeadset', this.boundWiredHeadsetDetect);
        }
        		
		DarkModeManager.addListener((isDark) => {
		    this.onDarkModeChanged(isDark); // optional callback
		});

     }

	async purgeSharedFiles() {
	 for (const file of this.sharedAndroidFiles) {
		try {
			if (await RNFS.exists(file.filePath)) {
				await RNFS.unlink(file.filePath);
				console.log('Deleted', file.filePath);
			}
		} catch (err) {
			console.warn('Error purgeSharedFiles file', err);
		}
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

	    //console.log('---fetchSharedItemsiOS');
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
		      console.log(file);
		  });

 		    console.log('Share', sharedFiles.length, 'items');
			this.setState({shareToContacts: true,
						   shareContent: sharedFiles,
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
		//console.log("→ Switched to Wi-Fi");
	  }
	
	  onMobile() {
		// Your custom logic when switching to mobile data
		//console.log("→ Switched to Mobile Data");
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
		  console.log('Already asked the user to allow bypass DND')
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

	async lookupSylkServer(domain, checkOnly = false) {
	    console.log(' --- lookupSylkServer', domain, checkOnly);
		if (domain == this.state.sylkDomain) {
		    //return;
		}

	  this.setState({SylkServerDiscovery: true, SylkServerDiscoveryResult: null, SylkServerStatus: ''});

	  const url = `https://dns.google/resolve?name=_sylkserver.${domain}&type=TXT`;
	  console.log('check url', url);

	  try {
		const res = await this.fetchWithTimeout(url, {}, 5000); // 5-second timeout
		const data = await res.json();
		const answers = data.Answer?.map(a => a.data) || [];
		const configurationUrl = Array.isArray(answers) && answers.length === 1 ? answers[0] : null;
		console.log('DNS response', configurationUrl);
		
		if (!configurationUrl) {
			this.setState({SylkServerDiscoveryResult: 'noDNSrecord', 
			               SylkServerDiscovery: false, 
			               SylkServerStatus: 'No DNS TXT record'}
			               );
			console.log('no configurationUrl');
			return;
		}
	
		if (checkOnly) {
			this.setState({ serverIsValid: configurationUrl != null });
			await this.downloadSylkConfiguration(domain, configurationUrl, checkOnly);
		} else if (configurationUrl) {
			console.log('Sylkserver configuration URL', configurationUrl);
			this.setState({ configurationUrl: configurationUrl});
			await this.downloadSylkConfiguration(domain, configurationUrl);
		}
	  } catch (err) {
		this.setState({SylkServerDiscovery: false, SylkServerStatus: 'No DNS TXT record', SylkServerDiscoveryResult: 'noDNSrecord'});
		if (err.name === 'AbortError') {
		  console.warn('Fetch timed out');
		} else {
		  console.error('Fetch failed', err);
		}
	  }
	}
	
	resetSylkServerStatus() {
		this.setState({SylkServerDiscoveryResult: '', SylkServerDiscovery: false, SylkServerStatus: ''});
	}

	async downloadSylkConfiguration(domain, url, checkOnly = false) {
	  this.setState({configurationJson: null});

	  try {
		const response = await this.fetchWithTimeout(url, {}, 5000); // 5-second timeout

		if (!response.ok) {
		  this.setState({SylkServerDiscoveryResult: 'noJson', SylkServerDiscovery: false});
		  console.log("Failed to download JSON: " + response.status);
		  return;
		}

		const json = await response.json();
		if (!json || !json.wsServer) {
			  this.setState({SylkServerDiscoveryResult: 'noWsServer', SylkServerDiscovery: false});
			  return;
		}
		
		json.sylkDomain = domain;
		json.configurationUrl = url;

		const jsonString = JSON.stringify(json);
		
		if (checkOnly) {
			let wsUrl = json.wsServer;
			this.setState({configurationJson: jsonString});
			this.testConnectionToSylkServer(wsUrl);
			return;
		}

		this.initConfiguration(jsonString, "url");
	
		await AsyncStorage.setItem("configuration", jsonString);
	
		return json;  // return it if you want to use it
	  } catch (error) {
		this.setState({SylkServerDiscovery: false});
		console.error("downloadSylkConfiguration error:", error);
		return null;
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
        console.log('Keep existing PGP key');
    }

    async savePrivateKey(keys) {
        let keyStatus = this.state.keyStatus;
        let myContacts = this.state.myContacts;

        keyStatus.existsLocal = true;

        this.setState({keys: {private: keys.private,
                              public: keys.public,
                              showImportPrivateKeyModal: false,
                              keyStatus: keyStatus
                              }});

        if (this.state.account) {
            this.requestSyncConversations();

            let accountId = this.state.account.id;

            if (accountId in myContacts) {
            } else {
                myContacts[accountId] = this.newContact(accountId);
            }

            myContacts[accountId].publicKey = keys.public;
            this.saveSylkContact(accountId, myContacts[accountId], 'PGP key generated');

            setTimeout(() => {
                this.sendPublicKey();
            }, 100);

        } else {
            console.log('Send 1st public key later');
            this.mustSendPublicKey = true;
        }

        let current_datetime = new Date();
        const unixTime = Math.floor(current_datetime / 1000);
        const my_uuid = uuid.v4();
        let params = [this.state.accountId, keys.private, keys.public, unixTime, my_uuid];
        await this.ExecuteQuery("INSERT INTO keys (account, private_key, public_key, timestamp, my_uuid) VALUES (?, ?, ?, ?, ?)", params).then((result) => {
            //console.log('SQL inserted private key');
			this._notificationCenter.postSystemNotification('Private key updated');
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') > -1) {
                this.updateKeySql(keys);
            } else {
                console.log('Save keys SQL error:', error);
            }
        });

        params = [this.state.accountId];
        await this.ExecuteQuery("update messages set encrypted = 1 where encrypted = 3 and account = ?", params).then((result) => {
            //console.log(result.rowsAffected, 'messages updated for decryption later');
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

            if (!this.state.firstSyncDone) {
               console.log('Skip saving last sync id until first sync is done');
               return
            }
        }

        let params = [id, this.state.accountId];
        await this.ExecuteQuery("update keys set last_sync_id = ? where account = ?", params).then((result) => {
            console.log('Saved last message sync id', id);
            this.setState({lastSyncId: id});
        }).catch((error) => {
            console.log('Save last sync id SQL error:', error);
        });
    }

    async updateKeySql(keys) {
        let current_datetime = new Date();
        const unixTime = Math.floor(current_datetime / 1000);
        let params = [keys.private, keys.public, unixTime, this.state.accountId];

        await this.ExecuteQuery("update keys set private_key = ?, public_key = ?, timestamp = ? where account = ?", params).then((result) => {
            console.log('SQL updated private key');
			this._notificationCenter.postSystemNotification('Private key updated');
        }).catch((error) => {
            console.log('SQL update keys error:', error);
        });
    }

    async updateMyUUID() {
        const my_uuid = uuid.v4();
        let params = [my_uuid, this.state.accountId];

        await this.ExecuteQuery("update keys set my_uuid = ? where account = ?", params).then((result) => {
            utils.timestampedLog('My device UUID was updated', my_uuid);
            this.setState({myuuid: my_uuid});

        }).catch((error) => {
            console.log('SQL update uuid error:', error);
        });
    }

    async loadMyKeys() {
        utils.timestampedLog('Loading PGP keys...');
        let keys = {};
        let lastSyncId;
        let myContacts = this.state.myContacts;

        let keyStatus = this.state.keyStatus;

        this.ExecuteQuery("SELECT * FROM keys where account = ?",[this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                //console.log('My local public key:', item.public_key);
                //console.log('Key status:', keyStatus);

                keys.public = item.public_key;
                if (item.public_key) {
                    keyStatus.existsLocal = true;
                    if ('existsOnServer' in keyStatus) {
                        if (keyStatus.serverPublicKey !== item.public_key) {
                            utils.timestampedLog('showImportPrivateKeyModal 1');
                            this.setState({showImportPrivateKeyModal: true, keyDifferentOnServer: true})
                        } else {
                            //utils.timestampedLog('Local and server PGP keys are the same');
                            this.setState({showImportPrivateKeyModal: false});
                        }
                    } else {
                        console.log('PGP key was not yet checked on server');
                    }
                } else {
                    keyStatus.existsLocal = false;
                }

                let my_uuid = item.my_uuid;

                if (!my_uuid) {
                    this.updateMyUUID();
                } else {
                    //utils.timestampedLog('My device UUID', my_uuid);
                    this.setState({myuuid: my_uuid});
                }

                keys.private = item.private_key;
                utils.timestampedLog('Loaded PGP private key');
                if (this.state.accountId in myContacts) {
                    if (myContacts[this.state.accountId].publicKey !== item.public_key) {
                        myContacts[this.state.accountId].publicKey = item.public_key;
                        this.updateSylkContact(this.state.accountId, myContacts[this.state.accountId], 'my_public_key');
                    }
                }

                if (!item.last_sync_id && this.lastSyncedMessageId) {
                    this.setState({keys: keys});
                    this.saveLastSyncId(this.lastSyncedMessageId);
                    console.log('Migrated last sync id to SQL database');
                    storage.remove('lastSyncedMessageId');
                    lastSyncId = this.lastSyncedMessageId;
                } else {
                    lastSyncId = item.last_sync_id
                    //utils.timestampedLog('Loaded last sync id', lastSyncId);
                    this.setState({keys: keys, lastSyncId: lastSyncId});
					setTimeout(() => {this.checkPendingActions()}, 0);
                }

                if (this.state.registrationState === 'registered') {
                    this.requestSyncConversations(lastSyncId);
                }

            } else {
                //console.log('SQL has no keys');
                keyStatus.existsLocal = false;
                if (this.state.account) {
                    this.generateKeysIfNecessary(this.state.account);
                } else {
                    console.log('Wait for account become active...');
                }
            }

            this.setState({contactsLoaded: true, keyStatus: keyStatus});
            this.getDownloadTasks();
        });
    }

    async getDownloadTasks() {
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

    resetStorage() {
        return;
        console.log('Reset storage');
        this.ExecuteQuery('delete from contacts');
        this.ExecuteQuery('delete from messages');
        this.saveLastSyncId(null);
    }

    async toggleDnd () {
        console.log('Toggle DND to', !this.state.dnd);
        if (!this.state.dnd) {
            this._notificationCenter.postSystemNotification('Do not disturb with new calls');
        } else {
            this._notificationCenter.postSystemNotification('I am available for new calls');
        }

        this.setState({dnd: !this.state.dnd})
        //this._sendPushToken(this.state.account, !this.state.dnd);
        //this.state.account.register();
        
        const dnd = (!this.state.dnd) ? '1': '0';
		let params = [dnd, this.state.account.id];
		await this.ExecuteQuery("update accounts set dnd = ? where account = ?", params).then((result) => {
			console.log('SQL update dnd for account OK');
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
        if (this.state.chatSounds) {
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
        console.log('toggle search contacts', !this.state.searchContacts);
        this.setState({searchContacts: !this.state.searchContacts});
    }

    async loadInitialDnd() {
		let query = "SELECT * FROM accounts where account = ?";
		await this.ExecuteQuery(query, [this.state.accountId]).then((results) => {
			const rows = results.rows;
			if (rows.length === 1) {
				const data = rows.item(0);
				const new_state = {rejectAnonymous: data.reject_anonymous == "1",
				                  dnd: data.dnd == "1",
				                  chatSounds: data.chat_sounds == "1",
				                  rejectNonContacts: data.reject_non_contacts == "1"};
				this.setState(new_state)
			};
		}).catch((error) => {
			console.log('SQL error:', error);
		});
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

    async loadSylkContacts() {
        if (this.state.contactsLoaded) {
            return;
        }


        if (!this.state.accountId) {
            return;
        }

		this.loadMyKeys();


        console.log('Loading Sylk contacts...');
		this.loadInitialDnd();

        let chatContacts = await this.getChatContacts();

        let myContacts = {};
        let blockedUris = [];
        let favoriteUris = [];
        let autoanswerUris = [];
        let missedCalls = [];
        let myInvitedParties = {};
        let localTime;
        let email;
        let contact;
        let timestamp;

        this.loadAddressBook();

        if (this.state.accountId in this.signup) {
            email = this.signup[this.state.accountId];
            this.setState({email: email});
        }

        if (!this.last_signup) {
            storage.set('last_signup', this.state.accountId);
            if (this.state.accountId in this.signup) {
            } else {
                this.signup[this.state.accountId] = '';
                storage.set('signup', this.signup);
            }
        }

        this.setState({defaultDomain: this.state.accountId.split('@')[1]});
        
        this.ExecuteQuery("SELECT * FROM contacts where account = ? order by timestamp desc",[this.state.accountId]).then((results) => {
            let rows = results.rows;
            let idx;
            let formatted_date;
            let updated;
            //console.log(rows.length, 'SQL rows');
            if (rows.length > 0) {
                for (let i = 0; i < rows.length; i++) {
                    var item = rows.item(i);
                    updated = null;

                    if (!item.uri) {
                        continue;
                    }

                    contact = this.newContact(item.uri, item.name, {src: 'init'});
                    if (!contact) {
                        continue;
                    }
                    this.sql_contacts_keys.push(item.uri);

                    timestamp = new Date(item.timestamp * 1000);
                    if (timestamp > new Date()) {
                        timestamp = new Date();
                        updated = 'timestamp';
                    }

                    myContacts[item.uri] = contact;
                    myContacts[item.uri].organization = item.organization;
                    myContacts[item.uri].email = item.email;
                    myContacts[item.uri].photo = item.photo;
                    myContacts[item.uri].publicKey = item.public_key;
                    myContacts[item.uri].direction = item.direction;
                    myContacts[item.uri].tags = item.tags ? item.tags.split(',') : [];
                    myContacts[item.uri].participants = item.participants ? item.participants.split(',') : [];
                    myContacts[item.uri].unread = item.unread_messages ? item.unread_messages.split(',') : [];
                    myContacts[item.uri].timestamp = timestamp;
                    myContacts[item.uri].lastCallId = item.last_call_id;
                    myContacts[item.uri].lastCallMedia = item.last_call_media ? item.last_call_media.split(',') : [];
                    myContacts[item.uri].lastCallDuration = item.last_call_duration;
                    myContacts[item.uri].messagesMetadata = {}
                    myContacts[item.uri].lastMessageId = item.last_message_id === '' ? null : item.last_message_id;
                    myContacts[item.uri].lastMessage = item.last_message === '' ? null : item.last_message;

                    let ab_contacts = this.lookupContacts(item.uri);
                    if (ab_contacts.length > 0) {
                        if (!myContacts[item.uri].name || myContacts[item.uri].name === '') {
                            console.log('Update display name', myContacts[item.uri].name, 'of', item.uri, 'to', ab_contacts[0].name);
                            myContacts[item.uri].name = ab_contacts[0].name;
                            updated = 'name';
                        }

                        myContacts[item.uri].label = ab_contacts[0].label;
                        if (myContacts[item.uri].tags.indexOf('contact') === -1) {
                            myContacts[item.uri].tags.push('contact');
                            updated = 'tags';
                        }
                    }

                    if (myContacts[item.uri].lastMessageId || myContacts[item.uri].publicKey) {
                        if (myContacts[item.uri].tags.indexOf('chat') === -1) {
                            myContacts[item.uri].tags.push('chat');
                            updated = 'tags';
                        }
                    }

                    if (!myContacts[item.uri].photo) {
                        var name_idx = myContacts[item.uri].name.trim().toLowerCase();
                        if (name_idx in this.state.avatarPhotos) {
                            myContacts[item.uri].photo = this.state.avatarPhotos[name_idx];
                            updated = 'photo';
                        } else if (item.uri in this.state.avatarPhotos) {
                            myContacts[item.uri].photo = this.state.avatarPhotos[item.uri];
                            updated = 'photo';
                        }
                    }

                    if (!myContacts[item.uri].email) {
                        var name_idx = myContacts[item.uri].name.trim().toLowerCase();
                        if (name_idx in this.state.avatarEmails) {
                            myContacts[item.uri].email = this.state.avatarEmails[name_idx];
                            updated = 'email';
                        }
                    }

                    if (myContacts[item.uri].tags.indexOf('missed') > -1) {
                        missedCalls.push(item.last_call_id);
                        if (myContacts[item.uri].unread.indexOf(item.last_call_id) === -1) {
                            myContacts[item.uri].unread.push(item.last_call_id);
                        }
                    } else {
                        idx = myContacts[item.uri].unread.indexOf(item.last_call_id);
                        if (idx > -1) {
                            myContacts[item.uri].unread.splice(idx, 1);
                        }
                    }

                    if (item.uri === this.state.accountId) {
                        this.setState({displayName: item.name, organization: item.organization});
                        if (email && !item.email) {
                            item.email = email;
                        } else {
                            this.setState({email: item.email});
                        }
                    }

                    formatted_date = myContacts[item.uri].timestamp.getFullYear() + "-" + utils.appendLeadingZeroes(myContacts[item.uri].timestamp.getMonth() + 1) + "-" + utils.appendLeadingZeroes(myContacts[item.uri].timestamp.getDate()) + " " + utils.appendLeadingZeroes(myContacts[item.uri].timestamp.getHours()) + ":" + utils.appendLeadingZeroes(myContacts[item.uri].timestamp.getMinutes()) + ":" + utils.appendLeadingZeroes(myContacts[item.uri].timestamp.getSeconds());
                    //console.log('Loaded contact', item.uri, item.tags);

                    if(item.participants) {
                        myInvitedParties[item.uri.split('@')[0]] = myContacts[item.uri].participants;
                    }

                    if (myContacts[item.uri].tags.indexOf('blocked') > -1) {
                        blockedUris.push(item.uri);
                    }

                    if (myContacts[item.uri].tags.indexOf('favorite') > -1) {
                        favoriteUris.push(item.uri);
                    }

                    if (myContacts[item.uri].tags.indexOf('autoanswer') > -1) {
                        autoanswerUris.push(item.uri);
                    }

                    if (updated) {
                        this.saveSylkContact(item.uri, myContacts[item.uri], 'update contact at init because of ' + updated);
                    }

                    //console.log('Load contact', item.uri, '-', item.name);
                }

                storage.get('cachedHistory').then((history) => {
                    if (history) {
                        //this.cachedHistory = history;
                        history.forEach((item) => {
                            //console.log(item);
                            if (item.remoteParty in myContacts) {
                            } else {
                                myContacts[item.remoteParty] = this.newContact(item.remoteParty, item.remoteParty, {src: 'cachedHistory'});
                            }

                            if (item.timezone && item.timezone !== undefined) {
                                localTime = momenttz.tz(item.startTime, item.timezone).toDate();
                                if (localTime > myContacts[item.remoteParty].timestamp) {
                                    myContacts[item.remoteParty].timestamp = localTime;
                                }
                            }

                            myContacts[item.remoteParty].name = item.displayName;
                            myContacts[item.remoteParty].direction = item.direction === 'received' ? 'incoming' : 'outgoing';
                            myContacts[item.remoteParty].lastCallId = item.sessionId;
                            myContacts[item.remoteParty].lastCallDuration = item.duration;
                            myContacts[item.remoteParty].lastCallMedia = item.media;
                            myContacts[item.remoteParty].conference = item.conference;
                            myContacts[item.remoteParty].tags.push('history');

                            this.saveSylkContact(item.remoteParty, this.state.myContacts[item.remoteParty], 'init');

                        });
                        console.log('Migrated', history.length, 'server history entries');
                        storage.remove('cachedHistory');
                    }
                });

                storage.get('history').then((history) => {
                    if (history) {
                        console.log('Loaded', history.length, 'local history entries');
                        history.forEach((item) => {
                            if (item.remoteParty in myContacts) {
                            } else {
                                myContacts[item.remoteParty] = this.newContact(item.remoteParty, item.remoteParty, {src: 'history'});
                            }

                            if (item.timezone && item.timezone !== undefined) {
                                localTime = momenttz.tz(item.startTime, item.timezone).toDate();
                                if (localTime > myContacts[item.remoteParty].timestamp) {
                                    myContacts[item.remoteParty].timestamp = localTime;
                                }
                            }

                            myContacts[item.remoteParty].name = item.displayName;
                            myContacts[item.remoteParty].direction = item.direction === 'received' ? 'incoming' : 'outgoing';
                            myContacts[item.remoteParty].lastCallId = item.sessionId;
                            myContacts[item.remoteParty].lastCallDuration = item.duration;
                            myContacts[item.remoteParty].lastCallMedia = item.media;
                            myContacts[item.remoteParty].conference = item.conference;
                            myContacts[item.remoteParty].tags.push('history');

                            this.saveSylkContact(item.remoteParty, this.state.myContacts[item.remoteParty], 'init');
                        });
                        console.log('Migrated', history.length, 'local history entries');
                        storage.remove('history');
                    }
                });

                 Object.keys(chatContacts).forEach((key) => {
                      if (!myContacts.hasOwnProperty(key)) {
							myContacts[key] = this.newContact(key, key, {src: 'chatContacts'});
							try {
								timestamp = JSON.parse(chatContacts[key], _parseSQLDate);
								myContacts[key].timestamp = timestamp;
								console.log('Add missing contact', key, timestamp);
								this.saveSylkContact(key, myContacts[key], 'chat');
							} catch (error) {
								console.log('Failed to create chat contact');
							}
                      }
                });
                
                utils.timestampedLog('Loaded', rows.length, 'contacts for account', this.state.accountId);
                //console.log(' --- pending incomingMessage', this.state.incomingMessage);
                Object.keys(this.state.incomingMessage).forEach((key) => {
                    const msg = this.state.incomingMessage[key];
					if (key in myContacts) {
					    console.log('Increment unread count for', key);
						myContacts[key].unread.push(msg._id);
						
						//UnreadModule.setUnreadForContact(key, myContacts[key].unread.length);
						
						myContacts[key].timestamp = msg.createdAt;
						myContacts[key].lastMessageId = msg._id;
                    }
				});

                this.setState({myContacts: myContacts,
                               missedCalls: missedCalls,
                               favoriteUris: favoriteUris,
                               autoanswerUris: autoanswerUris,
                               myInvitedParties: myInvitedParties,
                               blockedUris: blockedUris});

				this.getStorageUsage(this.state.accountId);

            } else {
                if (Object.keys(this.state.myContacts).length > 0) {
                    Object.keys(this.state.myContacts).forEach((key) => {
                        this.saveSylkContact(key, this.state.myContacts[key], 'init');
                    });
                    storage.set('contactStorage', 'sql');
                    storage.remove('myContacts');
                }
            }

            this.refreshNavigationItems();

            setTimeout(() => {
                this.fetchSharedItemsAndroid('start_up');
				this.fetchSharedItemsiOS();
                if (this.initialChatContact) {
                    //console.log('Starting chat with', this.initialChatContact);
                    if (this.initialChatContact in this.state.myContacts) {
                        this.selectContact(this.state.myContacts[this.initialChatContact]);
                    } else {
                        this.initialChatContact = null;
                    }
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
	     if (this.state.selectedContact != prevState.selectedContact) {
	         if (this.state.selectedContact) {
				 if (Platform.OS === 'android') {
					 SylkBridge.setActiveChat(this.state.selectedContact.uri);
					 UnreadModule.resetUnreadForContact(this.state.selectedContact.uri);
				 } else {
					 NativeModules.SharedDataModule.setActiveChat(this.state.selectedContact.uri); 
				 }
	
				 this.getMessages(this.state.selectedContact.uri, {origin: 'componentDidUpdate'});
			 }
	     }

		 if (prevState.orientation !== this.state.orientation) {
			 this.setState({searchContacts: this.state.orientation == 'portrait'});
		 }
		 
		 if (prevState.userSelectedDevice !== this.state.userSelectedDevice && this.state.userSelectedDevice) {
			 //console.log('userSelectedDevice changed', prevState.userSelectedDevice, '->', this.state.userSelectedDevice);
			 this.setState({userSelectedDevice: null, waitForCommunicationsDevicesChanged: true});
			 if ( !this.useInCallManger) {
				 setTimeout(() => {this.setState({waitForCommunicationsDevicesChanged: false});
												AudioRouteModule.getEvent();
												}, 2000);
				 AudioRouteModule.setActiveDevice(this.state.userSelectedDevice);
			 }
		 }	 

		if (this.state.proximityEnabled && prevState.proximityNear !== this.state.proximityNear) {
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

		 if (prevState.myContacts !== this.state.myContacts ) {
			this.updateTotalUread(this.state.myContacts);
 		 }

		 if (prevState.selectedDevice !== this.state.selectedDevice ) {
		     //console.log('selectedDevice changed', prevState.selectedDevice ,  '->' , this.state.selectedDevice);
			 this.setState({selectedAudioDevice: this.state.selectedDevice? this.state.selectedDevice.type: null});
		 }	 

		 if (prevState.audioOutputs !== this.state.audioOutputs) {
			const outputNames = this.state.audioOutputs.map(d => d.type);  // extract names only
			this.setState({ availableAudioDevices: outputNames });
		 }

		 if (prevState.wsUrl !== this.state.wsUrl && this.state.wsUrl) {
		     this.connectToSylkServer(true);
			 if (this.state.accountVerified && this.state.accountId) {
                this.handleRegistration(this.state.accountId, this.state.password);
             }
		 }
	}

    get useInCallManger() {
		if (Platform.OS == 'android' && Platform.Version < 31) {
		    return true;
		}

		return false;
	}

    addTestContacts() {
        let myContacts = this.state.myContacts;
        //console.log('addTestContacts');

        let test_numbers = this.state.testNumbers;

        test_numbers.forEach((item) => {
            if (Object.keys(myContacts).indexOf(item.uri) === -1) {
                myContacts[item.uri] = this.newContact(item.uri, item.name, {src: 'init'});
                myContacts[item.uri].tags.push('test');
                this.saveSylkContact(item.uri, myContacts[item.uri], 'init uri');
            } else {
                if (myContacts[item.uri].tags.indexOf('test') === -1) {
                    myContacts[item.uri].tags.push('test');
                    this.saveSylkContact(item.uri, myContacts[item.uri], 'init tags');
                }

                if (!myContacts[item.uri].name) {
                    myContacts[item.uri].name = item.name;
                    this.saveSylkContact(item.uri, myContacts[item.uri], 'init name');
                }
            }
        });
    }

    loadPeople() {
        let myContacts = {};
        let blockedUris = [];
        let favoriteUris = [];
        let autoanswerUris = [];
        let displayName = null;

        storage.get('contactStorage').then((contactStorage) => {
            if (contactStorage !== 'sql') {
                storage.get('myContacts').then((myContacts) => {
                    let myContactsObjects = {};
                    if (myContacts) {
                        Object.keys(myContacts).forEach((key) => {

                            if (!Array.isArray(myContacts[key]['unread'])) {
                                myContacts[key]['unread'] = [];
                            }

                            if(typeof(myContacts[key]) == 'string') {
                                console.log('Convert display name object');
                                myContactsObjects[key] = {'name': myContacts[key]}
                            } else {
                                myContactsObjects[key] = myContacts[key];
                            }

                        });
                        myContacts = myContactsObjects;
                    } else {
                        myContacts = {};
                    }

                    this.setState({myContacts: myContacts});

                    storage.get('favoriteUris').then((favoriteUris) => {
                        favoriteUris = favoriteUris.filter(item => item !== null);
                        console.log('My favorites:', favoriteUris);
                        this.setState({favoriteUris: favoriteUris});
                        storage.remove('favoriteUris');

                    }).catch((error) => {
                        //console.log('get favoriteUris error:', error);
                        let uris = Object.keys(myContacts);
                        uris.forEach((uri) => {
                            if (myContacts[uri].favorite) {
                                favoriteUris.push(uri);
                            }
                        });

                        this.setState({favoriteUris: favoriteUris});
                    });

                    storage.get('blockedUris').then((blockedUris) => {
                        blockedUris = blockedUris.filter(item => item !== null);
                        this.setState({blockedUris: blockedUris});
                        storage.remove('blockedUris');

                    }).catch((error) => {
                        //console.log('get blockedUris error:', error);
                        let uris = Object.keys(myContacts);
                        uris.forEach((uri) => {
                            if (myContacts[uri].blocked) {
                                blockedUris.push(uri);
                            }
                        });

                        this.setState({blockedUris: blockedUris});
                    });

                }).catch((error) => {
                    console.log('get myContacts error:', error);
                });

            }
        });
    }

    async initSQL() {
        const database_name = "sylk.db";
        const database_version = "1.0";
        const database_displayname = "Sylk Database";
        const database_size = 200000;

        await SQLite.openDatabase(database_name, database_version, database_displayname, database_size).then((DB) => {
            this.db = DB;
            //console.log('SQL database', database_name, 'opened');
            this.resetStorage();
            //this.dropTables();
            this.createTables();
        }).catch((error) => {
            console.log('SQL database error:', error);
        });
    }

    dropTables() {
        console.log('Drop SQL tables...')
        this.ExecuteQuery("DROP TABLE if exists 'chat_uris';");
        this.ExecuteQuery("DROP TABLE if exists 'recipients';");
        this.ExecuteQuery("DROP TABLE 'messages';");
        this.ExecuteQuery("DROP TABLE 'versions';");
        this.ExecuteQuery("DROP TABLE 'accounts';");
    }

    createTables() {
        console.log('Create SQL tables...')
        let create_versions_table = "CREATE TABLE IF NOT EXISTS 'versions' ( \
                                    'id' INTEGER PRIMARY KEY AUTOINCREMENT, \
                                    'table' TEXT UNIQUE, \
                                    'version' INTEGER NOT NULL );\
                                    ";

        this.ExecuteQuery(create_versions_table).then((success) => {
            //console.log('SQL version table created');
        }).catch((error) => {
            console.log(create_versions_table);
            console.log('SQL version table creation error:', error);
        });

        let create_table_messages = "CREATE TABLE IF NOT EXISTS 'messages' ( \
                                    'msg_id' TEXT, \
                                    'timestamp' TEXT, \
                                    'account' TEXT, \
                                    'unix_timestamp' INTEGER default 0, \
                                    'sender' TEXT, \
                                    'content' BLOB, \
                                    'content_type' TEXT, \
                                    'metadata' TEXT, \
                                    'from_uri' TEXT, \
                                    'to_uri' TEXT, \
                                    'sent' INTEGER, \
                                    'sent_timestamp' TEXT, \
                                    'received' INTEGER, \
                                    'received_timestamp' TEXT, \
                                    'expire_interval' INTEGER, \
                                    'deleted' INTEGER, \
                                    'pinned' INTEGER, \
                                    'pending' INTEGER, \
                                    'system' INTEGER, \
                                    'url' TEXT, \
                                    'related_msg_id', TEXT, \
                                    'related_action', TEXT, \
                                    'local_url' TEXT, \
                                    'image' TEXT, \
                                    'encrypted' INTEGER default 0, \
                                    'direction' TEXT, \
                                    'state' TEXT, \
                                    PRIMARY KEY (account, msg_id)) \
                                    ";

        this.ExecuteQuery(create_table_messages).then((success) => {
            //console.log('SQL messages table OK');
        }).catch((error) => {
            console.log(create_table_messages);
            console.log('SQL messages table creation error:', error);
        });

        let create_table_contacts = "CREATE TABLE IF NOT EXISTS 'contacts' ( \
                                    'uri' TEXT, \
                                    'account' TEXT, \
                                    'name' TEXT, \
                                    'organization' TEXT, \
                                    'tags' TEXT, \
                                    'photo' BLOB, \
                                    'email' TEXT, \
                                    'participants' TEXT, \
                                    'public_key' TEXT, \
                                    'timestamp' INTEGER, \
                                    'direction' TEXT, \
                                    'last_message' TEXT, \
                                    'last_message_id' TEXT, \
                                    'unread_messages' TEXT, \
                                    'last_call_media' TEXT, \
                                    'last_call_duration' INTEGER default 0, \
                                    'last_call_id' TEXT, \
                                    'conference' INTEGER default 0, \
                                    PRIMARY KEY (account, uri)) \
                                    ";

        this.ExecuteQuery(create_table_contacts).then((success) => {
            //console.log('SQL contacts table OK');
        }).catch((error) => {
            console.log(create_table_contacts);
            console.log('SQL messages table creation error:', error);
        });

        let create_table_keys = "CREATE TABLE IF NOT EXISTS 'keys' ( \
                                    'account' TEXT PRIMARY KEY, \
                                    'private_key' TEXT, \
                                    'checksum' TEXT, \
                                    'public_key' TEXT, \
                                    'last_sync_id' TEXT, \
                                    'timestamp' INTEGER, \
                                    'my_uuid' TEXT) \
                                    ";

        this.ExecuteQuery(create_table_keys).then((success) => {
            //console.log('SQL keys table OK');
        }).catch((error) => {
            console.log(create_table_keys);
            console.log('SQL keys table creation error:', error);
        });

		let create_table_accounts = `
		  CREATE TABLE IF NOT EXISTS 'accounts' (
			'account' TEXT PRIMARY KEY,
			'password' TEXT,
			'active' TEXT,
			'dnd' TEXT,
			'reject_anonymous' TEXT,
			'reject_non_contacts' TEXT,
			'chat_sounds' TEXT
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

        this.upgradeSQLTables();
    }

    upgradeSQLTables() {
        //console.log('Upgrade SQL tables')
        let query;
        let update_queries;
        let update_sub_queries;
        let version_numbers;

        /*
        this.ExecuteQuery("ALTER TABLE 'messages' add column received_timestamp TEXT after received");
        this.ExecuteQuery("ALTER TABLE 'messages' add column sent_timestamp TEXT after sent");
        */

       //query = "update versions set version = \"4\" where \"table\" = 'messages'";
       // this.ExecuteQuery(query);


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
                        update_queries = this.updateTableQueries[key];
                        version_numbers = Object.keys(update_queries);
                        version_numbers.sort(function(a, b){return a-b});
                        version_numbers.forEach((version) => {
                            if (version <= currentVersions[key]) {
                                return;
                            }
                            update_sub_queries = update_queries[version];
                            update_sub_queries.forEach((query_objects) => {

                                console.log('Run SQL query for table', key, 'version', version, ':', query_objects.query);
                                this.ExecuteQuery(query_objects.query, query_objects.params);
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

        }).catch((error) => {
            console.log('SQL error:', error);
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
        //console.log('-- Execute SQL query:', sql);
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

    async requestReadContactsPermission() {
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
          }
        } catch (err) {
          console.warn(err)
        }
      }

    async loadAddressBook() {
        console.log('Load system address book');
        Contacts.checkPermission((err, permission) => {
            //console.log('Current contacts permissions is', permission);

            if (err) throw err;

            // Contacts.PERMISSION_AUTHORIZED || Contacts.PERMISSION_UNDEFINED || Contacts.PERMISSION_DENIED
            if (permission === 'authorized') {
                this.getABContacts();
                return;
            }

            if (Platform.OS === 'android') {
               this.requestReadContactsPermission();
            } else {
               Contacts.requestPermission((err, permission) => {
               });
            }
        })
    }

    getABContacts() {
      Contacts.getAll((err, contacts) => {
           if (err) throw err;
            // contacts returned in Array
            let contact_cards = [];
            let name;
            let contact;
            let photo;
            let avatarPhotos = {};
            let avatarEmails = {};

            let seen_uris = new Map();

            var arrayLength = contacts.length;
            for (var i = 0; i < arrayLength; i++) {
                photo = null;
                contact = contacts[i];
                if (contact['givenName'] && contact['familyName']) {
                    name = contact['givenName'] + ' ' + contact['familyName'];
                } else if (contact['givenName']) {
                    name = contact['givenName'];
                } else if (contact['familyName']) {
                    name = contact['familyName'];
                } else if (contact['company']) {
                    name = contact['company'];
                } else {
                    continue;
                }

                if (contact.hasThumbnail) {
                    photo = contact.thumbnailPath;
                } else {
                    photo = null;
                }

                //console.log(name);
                contact['phoneNumbers'].forEach(function (number, index) {
                    let number_stripped = number['number'].replace(/\s|\-|\(|\)/g, '');
                    if (number_stripped) {
                        if (!seen_uris.has(number_stripped)) {
                            //console.log('   ---->    ', number['label'], number_stripped);
                            var contact_card = {id: uuid.v4(),
                                                name: name.trim(),
                                                uri: number_stripped,
                                                type: 'contact',
                                                photo: photo,
                                                label: number['label'],
                                                tags: ['contact']};
                            if (photo) {
                                var name_idx = name.trim().toLowerCase();
                                avatarPhotos[name_idx] = photo;
                            }
                            contact_cards.push(contact_card);
                            //console.log('Added AB contact', name, number_stripped);
                            seen_uris.set(number_stripped, true);
                        }
                    }
                });

                contact['emailAddresses'].forEach(function (email, index) {
                    let email_stripped =  email['email'].replace(/\s|\(|\)/g, '');
                    if (!seen_uris.has(email_stripped)) {
                        //console.log(name, email['label'], email_stripped);
                        var contact_card = {id: uuid.v4(),
                                            name: name.trim(),
                                            uri: email_stripped,
                                            type: 'contact',
                                            photo: photo,
                                            label: email['label'],
                                            tags: ['contact']
                                            };
                        var name_idx = name.trim().toLowerCase();
                        if (photo) {
                            avatarPhotos[email_stripped] = photo;
                        }
                        contact_cards.push(contact_card);
                        seen_uris.set(email_stripped, true);
                    }
                });
            }

          this.setState({contacts: contact_cards, avatarPhotos: avatarPhotos, avatarEmails: avatarEmails});
          console.log('Loaded', contact_cards.length, 'addressbook entries');
          //console.log(avatarPhotos);
      })
    }

    get _notificationCenter() {
        // getter to lazy-load the NotificationCenter ref
        if (!this.__notificationCenter) {
            this.__notificationCenter = this.refs.notificationCenter;
        }
        return this.__notificationCenter;
    }

    _detectOrientation() {
        //console.log('_detectOrientation', this.state.Width_Layout, this.state.Height_Layout);
        let H = this.state.Height_Layout + this.state.keyboardHeight;
        if(this.state.Width_Layout > H && this.state.orientation !== 'landscape') {
            this.setState({orientation: 'landscape'});
        } else {
            this.setState({orientation: 'portrait'});
        }
     }
     

    changeRoute(route, reason) {
        //console.log('Route', route, 'with reason', reason);
        utils.timestampedLog('Change route', this.currentRoute, '->', route, 'with reason:', reason);
        let messages = this.state.messages;

		if (route === '/ready' || route === '/login') {
		    if (this.currentRoute == '/call' && reason == 'start_up') {
		       console.log('Remain in /call until we receive it');
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
                this.getMessages(this.state.selectedContact.uri, {origin: '/ready'});
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
        return !!this.state.forwardContent || (this.state.shareContent && this.state.shareContent.length > 0);
    }

    initConfiguration(configurationJson, origin=null) {
		console.log('--- initConfiguration', configurationJson, origin);
		try {
			configuration = JSON.parse(configurationJson);
			let server = configuration.wsServer;
			server = server.replace(/^wss:\/\//, 'https://');

			if (server.endsWith("/ws")) {
				server = server.slice(0, -3);
			}
    
			this.setState({
						   configurationUrl: configuration.configurationUrl,
			               sylkDomain: configuration.sylkDomain,
			               testNumbers: Array.isArray(configuration.testNumbers) ? configuration.testNumbers: [],
			               defaultDomain: configuration.defaultDomain,
			               serverSettingsUrl: configuration.serverSettingsUrl,
			               enrollmentUrl: configuration.enrollmentUrl,
			               wsUrl: configuration.wsServer,
			               iceServers: configuration.iceServers,
			               fileSharingUrl: server + '/filesharing',
			               fileTransferUrl: server + '/filetransfer',
			               callHistoryUrl: configuration.serverCallHistoryUrl,
			               serverIsValid: true,
			               SylkServerDiscovery: false
			               });

            if (configuration.defaultConferenceDomain) {
				this.setState({defaultConferenceDomain: configuration.defaultConferenceDomain});
			}

        } catch (e) {
			console.log('initConfiguration error', e);
        }
    }
    
    async getLastCallEvent() {
		  if (Platform.OS !== 'android') return;
		
		  DeviceEventEmitter.addListener('IncomingCallAction', (event) => { this.callEventHandler(event); } );
		
		  try {
			const event = await CallEventModule.getLastCallEvent();
		
			if (event && event.callUUID) {
			  this.callEventHandler(event);
			} else {
			  console.log('CallEventModule has no pending event');
			}
		  } catch (e) {
			console.warn('Failed to pull pending call event', e);
		  }
		}

	callEventHandler(event) {
		if (!event || !event.callUUID) {
			console.warn('Received invalid event', event);
			return;
		}

		if (this.handledCalls.has(event.callUUID)) {
			console.log('Duplicate event ignored for callUUID:', event.callUUID);
			return;
		}

		console.log('IncomingCallAction callUUID:', event);
	
		this.handledCalls.add(event.callUUID);
		this.phoneWasLocked = event.phoneLocked;
	
		const media = { audio: true, video: event.action === 'ACTION_ACCEPT_VIDEO' };
	
		if (
			event.action === 'ACTION_ACCEPT_AUDIO' ||
			event.action === 'ACTION_ACCEPT_VIDEO' ||
			event.action === 'ACTION_ACCEPT'
		) {
			this.setState({targetUri: event.fromUri});
		
			this.callKeepAcceptCall(event.callUUID, media);
		} else if (event.action === 'REJECT') {
			this.callKeepRejectCall(event.callUUID);
		}
	
		setTimeout(() => this.handledCalls.delete(event.callUUID), 5 * 60 * 1000);

	}

    async componentDidMount() {
        utils.timestampedLog('-- App did mount');
        this._loaded = true;
        
		const configuration = await AsyncStorage.getItem("configuration");
		if (configuration) {
			this.initConfiguration(configuration, "storage");
        } else {
            console.log('No stored configuration found');
        }

		this.lookupSylkServer(this.state.sylkDomain);

        storage.get('account').then((account) => {
            if (account && account.verified) {
                utils.timestampedLog('Account is verified, sign in');
                this.setState({accountVerified: account.verified});
                this.handleRegistration(account.accountId, account.password);
                this.loadSylkContacts();
				this.changeRoute('/ready', 'start_up');
            } else {
				this.changeRoute('/login', 'start_up');
			}
        });

        storage.get('keys').then((keys) => {
            if (keys) {
                const public_key = keys.public.replace(/\r/g,'');
                const private_key = keys.private.replace(/\r/g, '').trim();

                keys.public = public_key;
                keys.private = private_key;
                this.setState({keys: keys});
                console.log("Loaded PGP public key");
            }

        }).catch((err) => {
            console.log("PGP keys loading error:", err);
        });

            
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
        
        this.getTransferedFiles();
        
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
			  
			  this.selectChatContact(event.fromUri);
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

        getPhoneNumber().then(myPhoneNumber => {
            console.log('myPhoneNumber', myPhoneNumber);
            this.setState({myPhoneNumber: myPhoneNumber});
        });

 		this.listenForPushNotifications();
        this.checkVersion();    
        this.getAudioState();
        this.startWatchingNetwork();
        this.proximityListener = Proximity.addListener(this.handleProximity);

	}
	
	audioManagerStart() {
		if (this.useInCallManger) {
		    InCallManager.start({media: 'audio'});
			return;
	    }

		logDevices("Inputs", this.state.audioInputs);
		logDevices("Outputs", this.state.audioOutputs);
		logDevices("Selected device", [this.state.selectedDevice]); // wrap single object in array
          
        console.log('selectedDevice', this.state.selectedDevice);
		AudioRouteModule.start(this.state.selectedDevice);	
    }

	audioManagerStop() {
		if (this.useInCallManger) {
		    InCallManager.stop();
		    return;
	    }

		AudioRouteModule.stop();
    }

	async selectAudioDevice(deviceType) {
		//console.log('User selectAudioDevice', deviceType);

		if (deviceType == this.state.selectedAudioDevice) {
		    return;
		}

		if (this.state.waitForCommunicationsDevicesChanged) {
			console.log('waitForCommunicationsDevicesChanged...');
			return;
		}
		
		const selectedDevice = this.state.audioOutputs.find(device => device.type === deviceType);

		this.setState({ userSelectedDevice: selectedDevice, 
		                selectedAudioDevice: null });
		                
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
	    if (this.useInCallManger) {
			return;
	    }
	
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
					({ selected, inputs, outputs, mode }) => {
					const audioInputs = (inputs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
					const audioOutputs = (outputs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
					const selectedDevice = selected || {};

					this.setState({
						waitForCommunicationsDevicesChanged: false,
					});

					// Usage:
					if (!devicesEqual(audioInputs, this.state.audioInputs)) {
					  logDevices("Inputs changed", audioInputs);
						this.setState({
							audioInputs: audioInputs,
						});
					}
	
					if (!devicesEqual(audioOutputs, this.state.audioOutputs)) {
						logDevices("Outputs changed", audioInputs);
						this.setState({
							audioOutputs: audioOutputs,
						});
					}

					if (!selectedDeviceEqual(selectedDevice, this.state.selectedDevice)) {
						logDevices("Selected device changed", [selectedDevice]); // wrap single object in array
						// Update state
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
		console.log('App installed from another source:', installer);
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
		  console.log('FCM in-app foreground event:', remoteMessage.data.event);

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
        if (Platform.OS === 'android') {
            getAppstoreAppMetadata("com.agprojects.sylk") //put any apps packageId here
              .then(metadata => {
                console.log("Sylk app version on playstore",
                  metadata.version,
                  "published on",
                  metadata.currentVersionReleaseDate
                );
                this.setState({appStoreVersion: metadata});
              })
              .catch(err => {
                console.log("error occurred checking app store version", err);
              });
              return;
        } else {
            getAppstoreAppMetadata("1489960733") //put any apps id here
            .then(appVersion => {
                console.log("Sylk app version on appstore", appVersion.version, "published on", appVersion.currentVersionReleaseDate);
                this.setState({appStoreVersion: appVersion});
            })
            .catch(err => {
                console.log("Error fetching app store version occurred", err);
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
        console.log("FCM in-app event", event, 'in app state', this.state.appState);

        const from = notification['from_uri'];
        const to = notification['to_uri'];

        if (event === 'incoming_conference_request') {
			const callUUID = notification['session-id'];
			const outgoingMedia = {audio: true, video: notification['media-type'] === 'video'};
			const mediaType = notification['media-type'] || 'audio';
			const account = notification['account'];
			const displayName = notification['from_display_name'];

            //utils.timestampedLog('FCM in-app event: incoming conference', callUUID);
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
            this.cancelIncomingCall(callUUID);
        } else if (event === 'message') {        
			console.log('FCM in-app event: message', from);
  
			if (this.state.appState != 'active') {
				console.log(Platform.OS, 'Save pending message to AsyncStorage');
				AsyncStorage.setItem(`incomingMessage`, JSON.stringify(notification));
			} else {
				this.incomingMessageFromPush( notification['message_id'], from, notification['content'], notification['content_type']);
			}
        }
    }

    notifyIncomingMessage(message) {
        const from = message.sender.uri;
		if (this.state.blockedUris.indexOf(from) > -1) { 
			utils.timestampedLog('Reject message from blocked URI', from);
			return;
		}

        const userInfo = {'from_uri': from,
                          'to_uri': this.state.accountId,       
                          'event': 'message',
                          'id': message.id
                          };
               
        console.log('notifyIncomingMessage', from);

        if (!this.state.selectedContact) {
			if (Platform.OS === 'ios') {
				this.sendLocalNotification('New message', 'From ' + from, userInfo);
			} else {
				this._notificationCenter.postSystemNotification('New message from ' + from);
            }
        } else {
			if (this.state.selectedContact.uri !== from) {
				if (Platform.OS === 'ios') {
					this.sendLocalNotification('New message', 'From ' + from, userInfo);
				} else {
					this._notificationCenter.postSystemNotification('New message from ' + from);
				}
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
		console.log('iOS remote notification', eventType);
	
		if (eventType !== 'message') {
			return;
		}

		const content = data.content;
		const from = data.from_uri;
		const to = data.to_uri;

		const now = Date.now();
		this.outgoingNotifications[from] = { timestamp: now };
	
		console.log('Received push', eventType, 'from', from, 'to', to);
			
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
					this.sendLocalNotification('New message', 'From ' + from, data);
				} else {
	                console.log('Nothing to do');
   				}
	        } else {
				this.sendLocalNotification('New message', 'From ' + from, data);
	        }
		}
    };

	sendLocalNotification(title, body, userInfo) {
		console.log('sendLocalNotification');
	
		const from = userInfo.from_uri;
		if (!from) {
			return;
		}
	
		const now = Date.now();
		const THROTTLE_MS = 30 * 1000; // 60 seconds
		
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
	
		// Deliver local notification
		PushNotificationIOS.presentLocalNotification({
			alertTitle: title,
			alertBody: body,
			userInfo: userInfo,
			soundName: ''
		});
	}

    onLocalNotification(notification) {
		const notification_data = notification.getData(); 
		const data = notification_data.data ? notification_data.data : notification_data;
        console.log('onLocalNotification');

  	    const eventType = data.event;

		console.log('iOS local notification', eventType);
	
		if (eventType === 'message') {
			const from = data.from_uri;
	
			if (!this.state.selectedContact) {
				this.updateTotalUread(this.state.myContacts);
			}
	
			this.selectChatContact(from);
		}
    }
  
    selectChatContact(uri) {
        console.log('selectChatContact', uri);
        if (uri in this.state.myContacts) {
			this.selectContact(this.state.myContacts[uri]);
        } else {
            console.log('set initialChatContact', uri);
            this.initialChatContact = uri;
        }
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

    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    _onPushkitRegistered(token) {
        utils.timestampedLog(Platform.OS, 'VoIP push token', token, 'registered');
        this.pushkittoken = token;
    }

    _onPushRegistered(token) {
        utils.timestampedLog(Platform.OS, 'normal push token', token, 'registered');
        this.pushtoken = token;
    }

    _sendPushToken(account, silent=false) {
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
        account.setDeviceToken(token, Platform.OS, deviceId, silent, bundleId);
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

        var yesterdayStart = new Date();
        yesterdayStart.setDate(yesterdayStart.getDate() - 2);
        yesterdayStart.setHours(0,0,0,0);

        let today = false;
        let yesterday = false;
        let conference = false;

        let navigationItems = this.state.navigationItems;
		const keys = Object.keys(this.state.myContacts);

		for (const key of keys) {
		  const contact = this.state.myContacts[key];

		  if (!contact) {
		      continue; // skip this iteration
		  }

		  // Check conference flag
		  if (contact.tags.indexOf('conference') > -1 || contact.conference) {
			conference = true;
		  }

		  if (contact.timestamp > todayStart) {
			  today = true;
		  }

		  if (contact.timestamp > yesterdayStart && contact.timestamp < todayStart) {
		      yesterday = true;
		  }
		}

        navigationItems = {today: today, yesterday: yesterday, conference: conference};
        this.setState({navigationItems: navigationItems});
     }

    _handleAndroidBlur = nextBlur => {
        //utils.timestampedLog('----- APP out of focus');
        this.setState({inFocus: false});
    }

    _handleAppStateChange = nextAppState => {
        utils.timestampedLog('--- APP state changed', this.state.appState, '->', nextAppState);
        
        const oldState = this.state.appState;

        this.setState({appState: nextAppState});
        
        if (nextAppState === 'active') {
            this.respawnConnection(nextAppState);

            this.fetchSharedItemsAndroid('app_active');
            this.fetchSharedItemsiOS();
            this.checkPendingActions();

            if (Platform.OS === 'ios') {
				setTimeout(() => {
					if (this.state.selectedContact) {
						this.confirmRead(this.state.selectedContact.uri);
					}
				}, 100);
            }
        } else {
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
            this.handleRegistration(this.state.accountId, this.state.password);
        }
    }

    closeConnection(reason='unmount') {
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
        this._notificationCenter.removeNotification();
    }

    createChatContact(uri) {      
		if (uri.indexOf('@') === -1) {
			uri = uri + '@' + this.state.defaultDomain;
		}
  
		let myContacts = this.state.myContacts;
		if (uri in myContacts) {
			this.setState({selectedContact: myContacts[uri]});
		} else {
		    const contact = this.newContact(uri, uri, {src: 'chat'});
		    myContacts[uri] = contact;
			this.setState({myContacts: myContacts});
			this.saveSylkContact(uri, contact, 'chat');
		}
	}

    selectContact(contact, origin='') {
        //console.log('selectContact', contact);
        if (contact !== this.state.selectedContact) {
            this.setState({pinned: false});
        }

		this.setState({selectedContact: contact});
        this.initialChatContact = null;
    }

    connectionStateChanged(oldState, newState) {
        console.log('--- connectionStateChanged', newState);
        if (this.unmounted) {
            //console.log('App is not yet mounted');
            return;
        }

        const connection = this.getConnection();

        if (oldState) {
            //utils.timestampedLog('Web socket', connection, 'state changed:', oldState, '->' , newState);
        }

        switch (newState) {
            case 'closed':
                this.syncRequested = false;
                if (this.state.connection) {
                    //utils.timestampedLog('Web socket was terminated');
                    this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
                    this._notificationCenter.postSystemNotification('Connection lost');
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

    showRegisterFailure(reason) {
        const connection = this.getConnection();

        utils.timestampedLog('Registration error: ' + reason, 'on web socket', connection);
        this.setState({
            registrationState: 'failed',
            status      : {
                msg   : 'Sign In failed: ' + reason,
                level : 'danger'
            }
        });

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
            console.log('Registration state changed:', oldState, '->', newState, 'on web socket', connection);
        }

        if (!this.state.account) {
            utils.timestampedLog('Account', this.state.accountId, 'is disabled');
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
                let myContacts = this.state.myContacts;
                myContacts[this.state.account.id] = this.newContact(this.state.account.id, this.state.displayName, {src: 'enrollment'});
                myContacts[this.state.account.id].email = this.state.email;
                this.saveSylkContact(this.state.account.id, myContacts[this.state.account.id], 'enrollment');
            }

            if (this.mustSendPublicKey) {
                this.sendPublicKey();
            }

            storage.set('account', {
                accountId: this.state.account.id,
                password: this.state.password,
                verified: true
            });
            
            this.saveSqlAccount(this.state.account.id, 1);

            if (!this.state.accountVerified) {
                this.loadSylkContacts();
            }

            this.setState({accountVerified: true,
                           enrollment: false,
                           registrationKeepalive: true,
                           registrationState: 'registered'
                           });

            this.updateLoading(null, 'registered');

            this.requestSyncConversations(this.state.lastSyncId);
            //this.requestSyncConversations('30386388-6fb2-444a-83bd-747d054787ef');

            this.replayJournal();

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
    
    async getStorageUsage(accountId) {
        console.log('Getting storage usage...');
        
        await this.purgeFiles();
        
		const sizes = await utils.getRemotePartySizes(accountId);
        const psizes = JSON.stringify(sizes, null, 2);

		//console.log('Sorted remote_party sizes:', psizes);

        const updatedContacts = { ...this.state.myContacts };

		// Create a quick lookup map for better performance
		try {
		const sizeMap = {};
		sizes.forEach(item => {
		  sizeMap[item.remote_party] = {
			size: item.size,
			prettySize: item.prettySize
		  };
		});
		
		Object.keys(updatedContacts).forEach(key => {
		  const contact = updatedContacts[key];
		  const info = sizeMap[key] || { size: 0, prettySize: "" };
		  updatedContacts[key] = {
			...contact,
			storage: info.size,
			prettyStorage: info.prettySize
		  };
		});
		} catch (e) {
		console.log('getStorageUsage error:', e)
		}
		
		this.setState({
			storageUsage: sizes,
			myContacts: updatedContacts,
		  });
    }

	updateStorageForContact(contactKey, removedSize = 0, addedSize = 0) {
		console.log('Updating storage for', contactKey, 'Removed:', removedSize, 'Added:', addedSize);
	
		// Clone current state to avoid direct mutation
		const updatedContacts = { ...this.state.myContacts };
		const updatedStorageUsage = [...this.state.storageUsage];
	
		try {
			if (updatedContacts[contactKey]) {
				const prevSize = updatedContacts[contactKey].storage || 0;
				const newSize = Math.max(prevSize - removedSize + addedSize, 0);
	
				updatedContacts[contactKey] = {
					...updatedContacts[contactKey],
					storage: newSize,
					prettyStorage: newSize > 0 ? utils.formatBytes(newSize) : "0 B",
				};
			} else if (addedSize > 0) {
				// If the contact didn't exist but we added size, create it
				updatedContacts[contactKey] = {
					storage: addedSize,
					prettyStorage: utils.formatBytes(addedSize),
				};
			}
	
			const idx = updatedStorageUsage.findIndex(item => item.remote_party === contactKey);
			const netChange = addedSize - removedSize;
	
			if (idx >= 0) {
				const prevSize = updatedStorageUsage[idx].size || 0;
				const newSize = prevSize + netChange;
				updatedStorageUsage[idx] = {
					...updatedStorageUsage[idx],
					size: newSize,
					prettySize: utils.formatBytes(newSize),
				};
			} else if (netChange !== 0) {
				updatedStorageUsage.push({
					remote_party: contactKey,
					size: netChange,
					prettySize: utils.formatBytes(netChange),
				});
			}
	
			const allIdx = updatedStorageUsage.findIndex(item => item.remote_party === 'all');
			if (allIdx >= 0) {
				const prevAll = updatedStorageUsage[allIdx].size || 0;
				const newAll = prevAll + netChange;
				updatedStorageUsage[allIdx] = {
					...updatedStorageUsage[allIdx],
					size: newAll,
					prettySize: utils.formatBytes(newAll),
				};
			}
	
			updatedStorageUsage.sort((a, b) => b.size - a.size);
	
			this.setState({
				myContacts: updatedContacts,
				storageUsage: updatedStorageUsage,
			}, () => {
				const updatedContactStorage = updatedContacts[contactKey]?.prettyStorage || "0 B";
				const allStorage = updatedContacts['all']?.prettyStorage 
					|| updatedStorageUsage.find(item => item.remote_party === 'all')?.prettySize 
					|| "0 B";
	
				console.log(`Final storage for ${contactKey}: ${updatedContactStorage}`);
				console.log(`Final storage for all: ${allStorage}`);
			});
	
		} catch (e) {
			console.error('Error updating storage:', e);
		}
	}
    
    async saveSqlAccount(account, active) {
        let params = [active, account];

		await this.ExecuteQuery("INSERT INTO accounts (active, account) VALUES (?, ?)", params).then((result) => {
            //console.log('SQL insert account OK');
        }).catch((error) => {
			this.updateSqlAccount(account, active);
		});
    }

    async updateSqlAccount(account, active) {
        let params = [active, account];
		await this.ExecuteQuery("update accounts set active = ? where account = ?", params).then((result) => {
			//console.log('SQL update account OK');
		}).catch((error) => {
			console.log('SQL error:', error);
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

        if (from in this.state.myContacts) {
            contact = this.state.myContacts[from];
        } else {
            let contacts = this.lookupContacts(from);
            if (contacts.length > 0) {
                contact = this.newContact(from, contacts[0].name);
            }
        }

        if (!contact) {
            contact = this.newContact(from, displayName);
        }

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
            Vibration.vibrate(VIBRATION_PATTERN, true);
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
        Vibration.vibrate(VIBRATION_PATTERN, true);
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
		if (this.state.proximityEnabled) {
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
                        this.requestSyncConversations(this.state.lastSyncId);
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

        /*
        utils.timestampedLog('---currentCall:', newCurrentCall);
        utils.timestampedLog('---incomingCall:', newincomingCall);
        */

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
                
                if (reason.indexOf('DTLS alert') > -1) {
					reason = "TLS media failure";
                }

                if (direction === 'outgoing' && !(uri in this.state.myContacts)) {
					this.addHistoryEntry(uri, callUUID);
				}

                utils.timestampedLog(callUUID, direction, 'terminated reason', data.reason, '->', reason);
                this._notificationCenter.postSystemNotification('Call ended:', {body: reason});
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

                    if (reason.indexOf('Payment required') > -1) {
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
        let call = this.state.currentCall || this.state.incomingCall;
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
        let myContacts = this.stata.myContacts;
        
		if (Object.keys(myContacts).indexOf(uri) > -1)  {
			let contact = myContacts[uri];
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
        console.log('Enrollment for new account', account);
        this.signup[account.id] = account.email;
        storage.set('signup', this.signup);
        storage.set('last_signup', account.id);
		this.signIn = true;
		this.changeRoute('/ready', 'enrollment');
        this.setState({displayName: account.displayName, enrollment: true, email: account.email});
        this.handleRegistration(account.id, account.password);
    }

    handleSignIn(accountId, password) {
        console.log('handleSignIn');
        storage.set('account', {
            accountId: accountId,
            password: password
        });

        this.signOut = false;
        this.signIn = true;

        this.handleRegistration(accountId, password);
    }

    handleRegistration(accountId, password) {
        //console.log('---- handleRegistration', accountId, 'verified =', this.state.accountVerified);

        this.setState({
            accountId : accountId,
            password  : password,
        });
    
        if (!this.state.wsUrl) {
			console.log('Wait for web socket server address...');
			return;
        }

        if (this.state.account !== null && this.state.registrationState === 'registered' ) {
            //console.log('already registered');
            return;
        }

        if (this.state.connection === null) {
			this.connectToSylkServer();

        } else {
            if (this.state.connection.state === 'ready' && this.state.registrationState !== 'registered') {
                utils.timestampedLog('Web socket', Object.id(this.state.connection), 'handle registration for', accountId);
                this.processRegistration(accountId, password);
            } else if (this.state.connection.state !== 'ready') {
                //console.log('connection is not ready');
                if (this._notificationCenter) {
                    //this._notificationCenter.postSystemNotification('Waiting for Internet connection');
                }
                if (this.currentRoute === '/login' && this.state.accountVerified) {
                    this.changeRoute('/ready', 'start_up');
                }
            }
        }
    }

    connectToSylkServer(close=false) {    
        if (close && this.state.connection !== null) {
			console.log('Disconnecting existing connection');   
            this.state.connection.close();
        }

		console.log('Connecting to', this.state.wsUrl);   
		let connection = sylkrtc.createConnection({server: this.state.wsUrl});
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
				this.state.testConnection.removeListener('stateChanged', this.testConnectionStateChanged);
				this.state.testConnection.close();
			    this.setState({SylkServerDiscoveryResult: newState, testConnection: null, SylkServerDiscovery: false, SylkServerStatus: 'Server connection failed'});
                break;
            case 'ready':
				this.state.testConnection.removeListener('stateChanged', this.testConnectionStateChanged);
				this.state.testConnection.close();
			    this.setState({SylkServerDiscoveryResult: newState, testConnection: null, SylkServerDiscovery: false, SylkServerStatus: 'Server connection successful'});
                break;
            case 'disconnected':
				this.state.testConnection.removeListener('stateChanged', this.testConnectionStateChanged);
				this.state.testConnection.close();
			    this.setState({SylkServerDiscoveryResult: newState, testConnection: null, SylkServerDiscovery: false, SylkServerStatus: 'Server connection failed'});
                break;
            default:
                break;
        }
    }
    
    processRegistration(accountId, password, displayName) {
        if (!displayName) {
            displayName = this.state.displayName;
        }

        utils.timestampedLog('Process registration for', accountId, '(', displayName, ')');

        if (!this.state.connection) {
            console.log('No connection');
            return;
        }

        if (this.state.account && this.state.connection) {
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
            //console.log('Account already exists for connection');
            return;
        }

        if (this.state.accountVerified) {
            this.registrationFailureTimer  = setTimeout(() => {
                    this.showRegisterFailure('Register timeout');
                    this.processRegistration(accountId, password);
            }, 10000);
        }

        console.log('Adding account for connection...', this.state.connection.state);

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingConference);
                account.on('registrationStateChanged', this.registrationStateChanged);
                account.on('incomingCall', this.incomingCallFromWebSocket);
                account.on('incomingMessage', this.incomingMessageFromWebSocket);
                account.on('syncConversations', this.syncConversations);
                account.on('readConversation', this.readConversation);
                account.on('removeConversation', this.removeConversation);
                account.on('removeMessage', this.removeMessage);
                account.on('outgoingMessage', this.outgoingMessage);
                account.on('messageStateChanged', this.messageStateChanged);
                account.on('missedCall', this.missedCall);
                account.on('conferenceInvite', this.conferenceInviteFromWebSocket);
                //utils.timestampedLog('Web socket account', account.id, 'is ready, registering...');

                this._sendPushToken(account);

                this.setState({account: account});

                this.generateKeysIfNecessary(account);

                account.register();

            } else {
                //console.log('Adding account failed');
                this.showRegisterFailure(408);
            }
        });
    }

    generateKeysIfNecessary(account) {
        let keyStatus = this.state.keyStatus;
        console.log('PGP key generation...');

        if ('existsOnServer' in keyStatus) {
            //console.log('PGP key server was already queried');
            // server was queried

            if (keyStatus.existsOnServer) {
                if (keyStatus.existsLocal) {
                    // key exists in both places
                    if (this.state.keys && keyStatus.serverPublicKey !== this.state.keys.public) {
                        utils.timestampedLog('Local and server PGP keys are different');
                        this.setState({keyDifferentOnServer: true});
                        utils.timestampedLog('showImportPrivateKeyModal 6');
                        setTimeout(() => {
                            this.showImportPrivateKeyModal();
                        }, 10);
                    } else {
                        utils.timestampedLog('Local and server PGP keys are the same');
                    }
                } else {
                    console.log('My local PGP key does not exist', keyStatus);
                    setTimeout(() => {
                        this.showImportPrivateKeyModal();
                    }, 10);
                }
            } else {
                if (!keyStatus.existsLocal) {
                    //console.log('We have no PGP key here nor on server');
                    this.generateKeys();
                } else {
                    //console.log('My PGP key exists local but not on server');
                }
            }
        } else {
            account.checkIfKeyExists((serverKey) => {
                keyStatus.serverPublicKey = serverKey;

                if (serverKey) {
                    utils.timestampedLog('PGP key exists on server');

                    //utils.timestampedLog('My server public key:', serverKey);
                    //console.log('Keys status:', keyStatus.keys);

                    keyStatus.existsOnServer = true;
                    //console.log('PGP public key on server', serverKey);
                    if (this.state.keys) {
                        if (this.state.keys && this.state.keys.public !== serverKey) {
                            utils.timestampedLog('showImportPrivateKeyModal 2');
                            //this.setState({showImportPrivateKeyModal: true, keyDifferentOnServer: true})
                            //console.log(this.state.keys.public);
                            console.log('Server key:', serverKey);
                            
                        } else {
                            utils.timestampedLog('Local and server PGP keys are the same');
                            keyStatus.existsLocal = true;
                        }
                        this.setState({keyStatus: keyStatus});

                    } else {
                        //console.log('My PGP keys have not yet been loaded');
                        if (!this.state.contactsLoaded) {
                            //console.log('Wait for PGP key until contacts are loaded');
                        } else {
                            //console.log('We have no local PGP key');
                            setTimeout(() => {
                                this.showImportPrivateKeyModal();
                            }, 10);
                        }
                    }
                } else {
                    keyStatus.existsOnServer = false;
                    this.setState({keyStatus: keyStatus});
                    console.log('PGP key does not exist on server');
                    if (this.state.contactsLoaded) {
                        if (this.state.keys && this.state.keys.private) {
                            console.log('My PGP public key sent to server');
                            this.sendPublicKey(this.state.accountId);
                        } else {
                            this.generateKeys();
                        }
                    } else {
                        console.log('Wait for PGP key until contacts are loaded');
                    }
                }
            });
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
        this.setState({showConferenceModal: false});
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

    async callKeepStartConference(targetUri, options={audio: true, video: true, participants: []}) {
        if (!targetUri) {
            return;
        }

        //console.log('callKeepStartConference', options);

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

        this.respawnConnection();
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, conference: true, callUUID: callUUID});
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
        utils.timestampedLog('New outgoing conference to room', targetUri);
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
        
        utils.timestampedLog('Callkeep accept call', callUUID);
        if (this.unmounted) {
			console.log('Wait until the app mounts');
			return;        
        }
        
        this.changeRoute('/call', 'accept_call');
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
            reason === 'outgoing_connection_failed'
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

        if (!this.state.keys && Object.keys(this.state.myContacts).length === 0) {
            this.addTestContacts();
        }
    }

    async showImportPrivateKeyModal(force=false) {
        let keyStatus = this.state.keyStatus;
        if (force) {
            utils.timestampedLog('showImportPrivateKeyModal 3');
            this.setState({showImportPrivateKeyModal: true});
        } else {
            if ('existsOnServer' in keyStatus) {
                if ('existsLocal' in keyStatus) {
                    if (!keyStatus.existsLocal) {
                        utils.timestampedLog('showImportPrivateKeyModal 4');
                        this.setState({showImportPrivateKeyModal: true});
                    } else {
                        console.log('PGP key exists locally');
                    }
                } else {
                    console.log('PGP key was not checked locally');
                }
            } else {
                console.log('PGP key was not checked on server');
            }
        }
    }

    async hideExportPrivateKeyModal() {
        this.setState({privateKey: null,
 	    showExportPrivateKeyModal: false});
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
        console.log('toggleSpeakerPhone');
    
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
        let call = this.state.currentCall || this.state.incomingCall;
        if (call) {
            RNCallKeep.toggleAudioRouteSpeaker(call.id, true);
        }
    }

    speakerphoneOff() {
        utils.timestampedLog('Speakerphone Off');
        InCallManager.chooseAudioRoute('EARPIECE');

        this.setState({speakerPhoneEnabled: false});
        InCallManager.setForceSpeakerphoneOn(false);

        let call = this.state.currentCall || this.state.incomingCall;
        if (call) {
            RNCallKeep.toggleAudioRouteSpeaker(call.id, false);
        }
    }

    toggleCallMeMaybeModal() {
        this.setState({showCallMeMaybeModal: !this.state.showCallMeMaybeModal});
    }

    toggleQRCodeScanner() {
        //utils.timestampedLog('Toggle QR code scanner');
        this.setState({showQRCodeScanner: !this.state.showQRCodeScanner});
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
        const displayName = notificationContent['from_display_name'];
        const outgoingMedia = {audio: true, video: notificationContent['media-type'] === 'video'};
        const mediaType = notificationContent['media-type'] || 'audio';

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
            this.handleRegistration(this.state.accountId, this.state.password);
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

        utils.timestampedLog('Incoming conference invite from', from, displayName, 'to room', to, outgoingMedia);

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
                this.fetchSharedItemsAndroid('Linking');
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
            if (!(from in this.state.myContacts)) {
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
		console.log('Incoming message from push', id, 'from', from, contentType);
		
		const is_encrypted = content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') > -1;

		const messages = this.state.messages;
        if (from in this.state.messages) {
			const exists = messages[from].some(m => m._id === id);
			if (exists) {
			    //console.log('Message is already loaded', id);
				return;
			}
        } else {
			const myContacts = this.state.myContacts;
			if (from in myContacts) {
				if (myContacts[from].unread.indexOf(id) > -1) {
					console.log('Message is already loaded in unread', id);
					return;
				}
			}
        }

		const decryptedContent = is_encrypted
			? await OpenPGP.decrypt(content, this.state.keys.private)
			: content;
			
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

        this.backToForeground();

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

        if (!this.state.firstSyncDone) {
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

        this.mustSendPublicKey = false;

        if (uri === this.state.accountId) {
            return;
        }

        if (this.state.keyDifferentOnServer && !force) {
            return;
        }

        // Send outgoing messages
        if (this.state.account && this.state.keys && this.state.keys.public) {
            console.log('Send my PGP public key to', uri);
            this.state.account.sendMessage(uri, this.state.keys.public, 'text/pgp-public-key');
        }
    }

    sendPublicKeyToUri(uri) {
        // Send outgoing messages
        if (this.state.account && this.state.keys && this.state.keys.public) {
            console.log('Send my PGP public key to', uri);
            this.state.account.sendMessage(uri, this.state.keys.public, 'text/pgp-public-key');
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
                console.log('SQL error:', error);
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

    async saveSylkContact(uri, contact, origin=null) {
        console.log('saveSylkContact', uri, 'by', origin);

        if (!uri) {
            return;
        }

        if (!contact) {
            contact = this.newContact(uri);
        } else {
            contact = this.sanitizeContact(uri, contact, 'saveSylkContact');
        }

        if (!contact) {
            return;
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
        if (selectedContact && selectedContact.uri === uri) {
            this.setState({selectedContact: contact});
        }

        if (this.sql_contacts_keys.indexOf(uri) > -1) {
            this.updateSylkContact(uri, contact, origin);
            return;
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
			UnreadModule.setUnreadForContact(uri, unreadCount);
		}

        /*
        if (origin === 'saveIncomingMessage' && this.state.selectedContact && this.state.selectedContact.uri === uri) {
            unread_messages = '';
            console.log('Do not update unread messages for', uri);
        }
        */

        let conference = contact.conference ? 1: 0;
        let media = contact.lastCallMedia.toString();
        let participants = contact.participants.toString();
        let unixTime = Math.floor(contact.timestamp / 1000);

        let params = [this.state.accountId, contact.email, contact.photo, unixTime, uri, contact.name || '', contact.organization || '', unread_messages || '', tags.toString() || '', participants || '', contact.publicKey || '', contact.direction, media, conference, contact.lastCallId, contact.lastCallDuration];
        await this.ExecuteQuery("INSERT INTO contacts (account, email, photo, timestamp, uri, name, organization, unread_messages, tags, participants, public_key, direction, last_call_media, conference, last_call_id, last_call_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            if (result.rowsAffected === 1) {
                console.log('SQL inserted contact', contact.uri, 'by', origin);
				if (origin == 'editContact') {
					this.replicateContact(contact);
				}

				if (origin == 'chat') {
					this.replicateContact(contact);
					this.selectContact(contact);
				}
            }

            this.sql_contacts_keys.push(uri);
            let myContacts = this.state.myContacts;

            if (uri !== this.state.accountId) {
                myContacts[uri] = contact;
                let favorite = myContacts[uri].tags.indexOf('favorite') > -1 ? true: false;
                let blocked = myContacts[uri].tags.indexOf('blocked') > -1 ? true: false;

                this.updateFavorite(uri, favorite);
                this.updateBlocked(uri, blocked);

            } else {
                this.setState({email: contact.email, displayName: contact.name})
                if (myContacts[uri].tags.indexOf('chat') > -1 || myContacts[uri].tags.indexOf('history') > -1) {
                    myContacts[uri] = contact;
                }
            }

			this.setState(prev => ({
			  myContacts: {
				...prev.myContacts,
				[uri]: {
				  ...prev.myContacts[uri],
				  ...contact   // or simply contact if replacing entire object
				}
			  }
			}));

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') > -1) {
                //console.log('SQL insert contact failed, try update', uri);
                this.updateSylkContact(uri, contact, origin);
            } else {
                //console.log('SQL insert contact', uri, 'error:', error);
                //console.log('Existing keys during insert:', this.sql_contacts_keys);
            }
        });
    }

    async updateSylkContact(uri, contact, origin=null) {
        console.log('updateSylkContact', uri, 'origin', origin);
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
        let params = [contact.photo, contact.email, contact.lastMessage, contact.lastMessageId, unixTime, contact.name || '', contact.organization || '', unread_messages || '', contact.publicKey || '', tags, participants, contact.direction, media, conference, contact.lastCallId, contact.lastCallDuration, contact.uri, this.state.accountId];

        await this.ExecuteQuery("UPDATE contacts set photo = ?, email = ?, last_message = ?, last_message_id = ?, timestamp = ?, name = ?, organization = ?, unread_messages = ?, public_key = ?, tags = ? , participants = ?, direction = ?, last_call_media = ?, conference = ?, last_call_id = ?, last_call_duration = ? where uri = ? and account = ?", params).then((result) => {
            if (result.rowsAffected === 1) {
                console.log('SQL updated contact', contact.uri, 'by', origin);
                if (origin == 'editContact') {
					this.replicateContact(contact);
                }
            }

            let myContacts = this.state.myContacts;

            if (uri !== this.state.accountId) {
                myContacts[uri] = contact;
                let favorite = myContacts[uri].tags.indexOf('favorite') > -1 ? true: false;
                let blocked = myContacts[uri].tags.indexOf('blocked') > -1 ? true: false;
                this.updateFavorite(uri, favorite);
                this.updateBlocked(uri, blocked);

				this.setState(prev => ({
				  myContacts: {
					...prev.myContacts,
					[uri]: {
					  ...prev.myContacts[uri],
					  ...contact   // or simply contact if replacing entire object
					}
				  }
				}));

            } else {
                this.setState({email: contact.email, displayName: contact.name})
            }

        }).catch((error) => {
            console.log('SQL update contact', uri, 'error:', error);
        });
    }

    async deleteSylkContact(uri) {
       if (uri === this.state.accountId) {
           await this.ExecuteQuery("UPDATE contacts set direction = null, last_message = null, last_message_id = null, unread_messages = '' where account = ? and uri = ?", [uri, uri]).then((result) => {
                console.log('SQL update my own contact');
                let myContacts = this.state.myContacts;
                if (uri in myContacts) {
                    delete myContacts[uri];
                    this.setState({myContacts: myContacts});
                }
            }).catch((error) => {
                console.log('Delete update mysql SQL error:', error);
            });
       } else {
           await this.ExecuteQuery("DELETE from contacts where uri = ? and account = ?", [uri, this.state.accountId]).then((result) => {
                if (result.rowsAffected > 0) {
                    console.log('SQL deleted contact', uri);
                }
                let myInvitedParties = this.state.myInvitedParties;

                if (uri in myInvitedParties) {
                    delete myInvitedParties[uri];
                    this.setState({myInvitedParties: myInvitedParties});
                }

                let idx = this.sql_contacts_keys.indexOf(uri);
                if (idx > -1) {
                     this.sql_contacts_keys.splice(idx, 1);
                }
                //console.log('new keys after delete', this.sql_contacts_keys);

                let myContacts = this.state.myContacts;
                if (uri in myContacts) {
                    delete myContacts[uri];
                    this.setState({myContacts: myContacts});
                }
            }).catch((error) => {
                console.log('Delete contact SQL error:', error);
            });
        }
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
        if (this.state.lastSyncId) {
            this.requestSyncConversations(this.state.lastSyncId);
        }
    }

    requestSyncConversations(lastId=null, options={}) {
        if (!this.state.account) {
            return;
        }

        if (!this.state.keys) {
            //console.log('Wait for sync until we have keys')
            return;
        }

        if (this.startedByPush) {
            //console.log('Wait for sync until incoming call ends')
            return;
        }

        if (this.syncRequested) {
            //console.log('Sync already requested')
            return;
        }

        this.syncRequested = true;
        utils.timestampedLog('Request sync from', lastId);

        this.state.account.syncConversations(lastId, options);
    }

    async savePublicKey(uri, key) {
        //console.log('savePublicKey');
        if (uri === this.state.accountId) {
            return;
        }

        if (this.state.rejectNonContacts && !(uri in this.state.myContacts)) {
            console.log('Skip key from non local contact');
			return;
        }

        if (!key) {
            console.log('Missing key');
            return;
        }

        key = key.replace(/\r/g, '').trim();

        if (!key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
            console.log('Cannot find the start of PGP public key');
            return;
        }

        if (!key.endsWith("-----END PGP PUBLIC KEY BLOCK-----")) {
            console.log('Cannot find the end of PGP public key');
            return;
        }

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            //console.log(myContacts[uri]);
            //
        } else {
            myContacts[uri] = {};
            //console.log('Init contact')
        }

        if (myContacts[uri].publicKey === key) {
            //console.log('Public key of', uri, 'did not change');
            return;
        }

        utils.timestampedLog('Public key of', uri, 'saved');

        this.saveSystemMessage(uri, 'Public key received', 'incoming');

        myContacts[uri].publicKey = key;

        this.saveSylkContact(uri, myContacts[uri], 'savePublicKey');
        this.sendPublicKeyToUri(uri);
    }

    async savePublicKeySync(uri, key) {
        console.log('Sync public key from', uri);
        if (!key) {
            console.log('Missing key');
            return;
        }

        key = key.replace(/\r/g, '').trim();

        if (!key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
            console.log('Cannot find the start of PGP public key');
            return;
        }

        if (!key.endsWith("-----END PGP PUBLIC KEY BLOCK-----")) {
            console.log('Cannot find the end of PGP public key');
            return;
        }

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            //
        } else {
            myContacts[uri] = {};
        }

        if (myContacts[uri].publicKey === key) {
            console.log('Public key of', uri, 'did not change');
            return;
        }

        console.log('Public key of', uri, 'saved');

        myContacts[uri].publicKey = key;
        this.saveSylkContact(uri, myContacts[uri], 'savePublicKeySync');
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

        console.log('--- sendMessage', uri, contentType);
        //console.log(message);

        let renderMessages = this.state.messages;
        if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
            if (Object.keys(renderMessages).indexOf(uri) === -1) {
                renderMessages[uri] = [];
            }
        }

        let public_keys;

        if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey && this.state.keys) {
            public_keys = this.state.keys.public + "\n" + this.state.myContacts[uri].publicKey;
        }

        message.contentType = contentType;
        message.content = message.text
        message.content_type = contentType;
		let selectedContact = this.state.selectedContact;
		let myContacts = this.state.myContacts;
		
		if (contentType === 'application/sylk-message-metadata') {
			this.handleMessageMetadata(uri, message.content);
			this.saveOutgoingMessage(uri, message, 0, contentType);
			this._sendMessage(uri, message.text, message._id, contentType, message.createdAt);
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

        if (message.contentType !== 'application/sylk-file-transfer' && message.contentType !== 'text/pgp-public-key' && public_keys && this.state.keys) {
            await OpenPGP.encrypt(message.text, public_keys).then((encryptedMessage) => {
                utils.timestampedLog('-----  Outgoing message', message._id, 'encrypted', 'to', uri);
                this.saveOutgoingMessage(uri, message, 1);
                this._sendMessage(uri, encryptedMessage, message._id, message.contentType, message.createdAt);
            }).catch((error) => {
                console.log('Failed to encrypt message:', error);
                let error_message = error.message.startsWith('stringResponse') ? error.message.slice(43, error.message.length - 1): error.message;
                this.renderSystemMessage(uri, error_message, 'outgoing');
                this.saveOutgoingMessage(uri, message, 0);
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
            renderMessages[uri].push(message);
            selectedContact.lastMessage = this.buildLastMessage(message)
            selectedContact.timestamp = message.createdAt;
            selectedContact.direction = 'outgoing';
            selectedContact.lastCallDuration = null;

            this.setState({messages: renderMessages,
                           selectedContact: selectedContact});
        }
    }

    canSend() {
        if (!this.state.account) {
            //console.log('Wait for account...');
            return false;
        }

        if (!this.state.connection) {
            //console.log('Wait for Internet connection...');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            //console.log('Wait for Internet connection...');
            return;
        }

        if (this.signOut) {
            return;
        }

        return true;
    }

		async resizeBeforeUpload(localUrl, size=600) {
		  //console.log('Image to resize', localUrl); 
		  try {
			const resized = await ImageResizer.createResizedImage(
			  localUrl,          // image URI
			  size,               // width
			  size,               // height
			  'JPEG',            // format
			  100,                // quality
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

    async uploadFile(file_transfer) {
        if (!this.state.fileTransferUrl) {
			console.log('No fileTransferUrl');
            return;
        }

		function removeWsFromPath(url) {
			return url.replace(/(\/webrtcgateway)\/ws(\/)/, '$1$2');
		}

        console.log('uploadFile', file_transfer.transfer_id);
		console.log('file', JSON.stringify(file_transfer, null, 2));

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

        if (utils.isFileEncryptable(file_transfer) && !encryptedFileExist) {

            this.updateFileTransferBubble(file_transfer, 'Encrypting file...');
			let public_keys = '';
	
			if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey) {
				public_keys = this.state.myContacts[uri].publicKey;
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

			} else {
				console.log('No public key available for', uri, 'encryption skipped');
			}
       }

	   this.updateTransferProgress(file_transfer.transfer_id, 0, 'upload');
	   	   
	   //console.log('upload final file', JSON.stringify(file_transfer, null, 2));

       utils.timestampedLog('--- Uploading file', local_url, 'to', remote_url);
       
       
	   let task = RNBlobUtil.fetch('POST', remote_url, {
		  'Content-Type': file_transfer.filetype,
		}, RNBlobUtil.wrap(local_url));

        this.uploadRequests[file_transfer.transfer_id] = task;

        task.uploadProgress((written, total) => {
		  const progress = Math.floor((written / total) * 100);
		  console.log('uploadProgress', progress, uri);   
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
			console.log('File uploaded:', local_url);
			this.deleteTransferProgress(file_transfer.transfer_id);
	        this.updateFileTransferBubble(file_transfer);
            delete this.uploadRequests[file_transfer.transfer_id]
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
	
	updateFileMetadata(metadata, items={}) {
	    if ('playing' in items) {
	        if (!items.playing) {
				this.updateFileTransferSql(metadata);	
			}
			metadata.playing = items.playing;
			this.updateFileTransferBubble(metadata);
		}
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
            console.log('SQL insert conference message', message._id, from_uri, to_uri, message.direction);
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

    async saveOutgoingMessage(uri, message, encrypted=0, content_type="text/plain") {
		//console.log('saveOutgoingMessage', message._id, content_type);

        // sent -> null
        // pending -> 1
        // received -> null
        // failed -> null

        if (content_type !== 'application/sylk-file-transfer' && content_type !== 'application/sylk-message-metadata') {
            this.saveOutgoingChatUri(uri, message);
        }

        let ts =  message.createdAt;

        let unix_timestamp = Math.floor(ts / 1000);
        let params = [this.state.accountId, message._id, JSON.stringify(ts), unix_timestamp, message.text, content_type, JSON.stringify(message.metadata), this.state.accountId, uri, "outgoing", "1", encrypted];
        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('saveOutgoingMessage SQL error:', error);
            }
        });
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

        utils.timestampedLog('Message', id, 'state changed to', state);
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

    messageStateChangedSync(obj) {
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
        }

        this.ExecuteQuery(query, [state, id]).then((results) => {
            //console.log('SQL update OK');
        }).catch((error) => {
            console.log('messageStateChangedSync SQL error:', error);
        });
    }

    async deleteMessage(id, uri, remote=true, after=false) {
        //utils.timestampedLog('Message', id, 'is deleted');
        console.log('deleteMessage', id, 'remote', remote);
		this.deleteRenderMessage(id, uri);

        let query;

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
        
        //console.log('messages to remove', message_ids);

        for (let j = 0; j < message_ids.length; j++) {
            var _id = message_ids[j];
            this.deleteFilesForMessage(_id, uri);
			this.deleteRenderMessage(_id, uri);
            // TODO delete replyIds as well
            if (remote) {
               this.addJournal(_id, 'removeMessage', {uri: uri});
               //console.log('add journal 1');
            }
        }
    }

    async refetchMessagesForContact(contact, days=30) {
        if (!contact) {
            return;
        }
        let uri =  contact.uri;
        this.syncRequested = false;
        console.log('refetchMessages with', uri, 'since', days, 'days ago');
        var since = moment().subtract(days, 'days');
        this.setState({nextSyncUriFilter: uri});
        let options = {since: since};
        this.requestSyncConversations(null, options);
    }

    async refetchMessages(days=30) {
        let timestamp = new Date();
        let params;
        let unix_timestamp = Math.floor(timestamp / 1000);
        unix_timestamp = unix_timestamp - days * 24 * 3600;
        params = [this.state.accountId, unix_timestamp];
        this.syncRequested = false;

        this.ExecuteQuery("select * from messages where account = ? and unix_timestamp < ? order by unix_timestamp desc limit 1", params).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                this.ExecuteQuery("delete from messages where account = ? and unix_timestamp > ?", params).then((results) => {
                    //console.log('SQL deleted', results.rowsAffected, 'messages');
                    this._notificationCenter.postSystemNotification(results.rowsAffected + ' messages removed');
                    console.log('Sync conversations since', item.msg_id, new Date(item.unix_timestamp * 1000));
                    this.setState({saveLastSyncId: item.msg_id});
                    setTimeout(() => {
                        this.requestSyncConversations(item.msg_id);
                    }, 100);
                });

            }
        }).catch((error) => {
            console.log('SQL error:', error);
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
                        console.log('Removing', dir_path);
                        RNFS.unlink(dir_path).then((success) => {
                            console.log('Removed directory', dir_path);
                            // TODO: update storage usage:
                            this.updateStorageForContact(remote_party, file_transfer.filesize, 0);                              
                        }).catch((err) => {
                            if (err.message.indexOf('File does not exist') === -1) {
                                console.log('Error deleting directory', dir_path, err.message);
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
				this.remove_sync_pending_item(id);
            }
        }).catch((error) => {
			this.remove_sync_pending_item(id);
            console.log('deleteMessageSync SQL error:', error);
        });

    }

    async expireMessage(id, duration=300) {
        utils.timestampedLog('Expire message', id, 'in', duration, 'seconds after read');
        // TODO expire message
    }

	async deleteRenderMessage(id, uri) {
		const { messages, myContacts } = this.state;
	
		// If uri has no messages, do nothing
		if (!(uri in messages)) {
			return;
		}
	
		const existingMessages = messages[uri];
	
		// Filter without mutating original array
		const newRenderedMessages = existingMessages.filter(m => m._id !== id);
	
		// If nothing changed → exit early
		if (newRenderedMessages.length === existingMessages.length) {
			return;
		}
	
		// Create NEW messages object (immutability)
		const newMessages = {
			...messages,
			[uri]: newRenderedMessages,
		};
	
		// Update myContacts immutably
		let newMyContacts = { ...myContacts };
	
		if (uri in myContacts) {
			const oldContact = myContacts[uri];
	
			const isDeletedLastMessage =
				existingMessages.length > 0 &&
				existingMessages[0]._id === id;
	
			const updatedContact = {
				...oldContact,
				totalMessages: oldContact.totalMessages - 1,
				lastMessage: isDeletedLastMessage ? null : oldContact.lastMessage,
				lastMessageId: isDeletedLastMessage ? null : oldContact.lastMessageId,
			};
	
			newMyContacts = {
				...newMyContacts,
				[uri]: updatedContact,
			};
		}
	
		// Set NEW references → memoized components rerender
		//console.log('deleteRenderMessage', id);
		this.setState({
			messages: newMessages,
			myContacts: newMyContacts,
		});
	}

	async deleteRenderMessageSync(id, uri) {
		const existingList = this.state.messages[uri] ?? [];
	
		// Build new array without mutating the original
		const newRenderedMessages = existingList.filter(m => m._id !== id);
	
		// If nothing changed, leave state untouched
		if (newRenderedMessages.length === existingList.length) {
			this.remove_sync_pending_item(id);
			return;
		}
	
		// Create a NEW messages object for memoization to detect changes
		this.setState(prev => ({
			messages: {
				...prev.messages,
				[uri]: newRenderedMessages
			}
		}));
	
		this.remove_sync_pending_item(id);
	}

    async sendPendingMessage(uri, text, id, contentType, timestamp) {
        utils.timestampedLog('Outgoing pending message', id);
        if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey && this.state.keys.public) {
            let public_keys = this.state.myContacts[uri].publicKey + "\n" + this.state.keys.public;
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
        //console.log('sendPendingMessages');

        if (this.signOut) {
           return;
        }

        let content;
        let metadata;
        //await this.ExecuteQuery("SELECT * from messages where pending = 1 and content_type like 'text/%' and from_uri = ?", [this.state.accountId]).then((results) => {
        await this.ExecuteQuery("SELECT * from messages where pending = 1 and from_uri = ?", [this.state.accountId]).then((results) => {
            let rows = results.rows;
            for (let i = 0; i < rows.length; i++) {
                if (this.signOut) {
                   return;
                }
                
                var item = rows.item(i);
                console.log('sendPendingMessages item', item);
                 
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
	
	  console.log('updateRenderMessageState', id, state);
	
	  query = "SELECT * from messages where msg_id = ? and account = ?";
	
	  try {
		const results = await this.ExecuteQuery(query, [id, this.state.accountId]);
		const rows = results.rows;
		if (rows.length !== 1) return;
	
		const item = rows.item(0);
		uri = item.direction === 'outgoing' ? item.to_uri : item.from_uri;
	
		if (!(uri in this.state.messages)) return;
	
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
		console.log('Changed message count:', changedCount);

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
        //console.log('saveOutgoingChatUri', uri);
        let query;
        let content = message.text;

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            //
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        this.lookupPublicKey(myContacts[uri]);

        myContacts[uri].unread = [];
        if (myContacts[uri].totalMessages) {
            myContacts[uri].totalMessages = myContacts[uri].totalMessages + 1;
        }

        if (content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
            myContacts[uri].lastMessage = this.buildLastMessage(message);
            myContacts[uri].lastMessageId = message.id;
        }

        if (myContacts[uri].tags.indexOf('chat') === -1) {
            myContacts[uri].tags.push('chat');
        }

        myContacts[uri].lastCallDuration = null;
        myContacts[uri].timestamp = new Date();
        myContacts[uri].direction = 'outgoing';
        this.setState({myContacts: myContacts});
        this.saveSylkContact(uri, myContacts[uri], 'saveOutgoingChatUri');
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
        //console.log('Add journal entry:', action, id);
        this.mySyncJournal[uuid.v4()] = {id: id, action: action, data: data};
        this.replayJournal();
     }

     async replayJournal() {
        if (!this.state.account) {
            utils.timestampedLog('Sync journal later when going online...');
            return;
        }

        if (this.signOut) {
            return;
        }

        let op;
        let executed_ops = [];

        Object.keys(this.mySyncJournal).forEach((key) => {
            if (!this.canSend()) {
                return;
            }

            op = this.mySyncJournal[key];
            //utils.timestampedLog('Sync journal', op.action, op.id);
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
            delete this.mySyncJournal[key];
        });

        storage.set('mySyncJournal', this.mySyncJournal);
        this.sendPendingMessages();
     }

     async confirmRead(uri, source) {
        //console.log('confirmRead', uri, source);

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

        //console.log('Confirm read messages for', uri);
        let displayed = [];

        await this.ExecuteQuery("SELECT * FROM messages where from_uri = '" + uri + "' and received = 1 and encrypted not in (1) and system is NULL and to_uri = ?", [this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length > 0) {
               //console.log('We must confirm read of', rows.length, 'messages');
            } else {
               //console.log('No messages to confirm read');
            }

            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                if (item.encrypted === 3) {
                    console.log('Message could not be decrypted', item.msg_id, item.content_type);
                    this.sendDispositionNotification(item, 'error', true);
                } else {
					this.sendDispositionNotification(item, 'displayed', true);
                }
            }

        }).catch((error) => {
            console.log('SQL error:', error);
        });

        this.resetUnreadCount(uri);
    }

    async resetUnreadCount(uri) {
        //console.log('--- resetUnreadCount', uri);
        let myContacts = this.state.myContacts;
        let missedCalls = this.state.missedCalls;
        let idx;
        let changes = false;

        if (!(uri in myContacts)) {
            return;
        }

        if (myContacts[uri].unread.length > 0) {
            myContacts[uri].unread = [];
            myContacts[uri].unread.forEach((id) => {
                idx = missedCalls.indexOf(id);
                if (idx > -1) {
                    missedCalls.splice(idx, 1);
                }
            });
            changes = true;
        }

        if (myContacts[uri].lastCallId) {
            idx = missedCalls.indexOf(myContacts[uri].lastCallId);
            if (idx > -1) {
                missedCalls.splice(idx, 1);
            }
        }

        idx = myContacts[uri].tags.indexOf('missed');
        if (idx > -1) {
            myContacts[uri].tags.splice(idx, 1);
            changes = true;
        }

        if (changes) {
            this.saveSylkContact(uri, myContacts[uri], 'resetUnreadCount');
            this.addJournal(uri, 'readConversation');
        }

        this.setState({missedCalls: missedCalls});
    }

	async sendDispositionNotification(message, state='displayed', save=false) {
        let contentType = message.content_type || message.contentType;
        //utils.timestampedLog('sendDispositionNotification', id, state, uri);

        if (contentType == 'application/sylk-message-metadata') {
			return;
        }

        let id = message.msg_id || message.id || message.transfer_id || message._id;
        let uri =  message.sender ? message.sender.uri : message.from_uri;
        let timestamp = message.timestamp;
        
        if (uri in this.state.myContacts) {
			const tags = this.state.myContacts[uri].tags;
			if (tags.indexOf('noread') > -1) {
				if (save) {
					let received = (state === 'delivered') ? 1 : 2;
					let query = "UPDATE messages set received = ? where msg_id = ? and account = ?";
					this.ExecuteQuery(query, [received, id, this.state.accountId]).then((results) => {
						utils.timestampedLog('received', received, id, message.content_type, 'saved');
					}).catch((error) => {
						utils.timestampedLog('sendDispositionNotification', id, uri, 'save error:', error.message);
					});
				} else {
					//utils.timestampedLog('sendDispositionNotification', id, state, uri, 'skipped');
				}
				return;
			}
        }

        
        if (message.metadata && message.metadata.sender) {
			uri = message.metadata.sender.uri;
			timestamp = message.metadata.timestamp;
        }

        if (!this.canSend()) {
            //console.log('IMDN for', id, state, 'will be sent later');
            return false;
        }

        let result = await new Promise((resolve, reject) => {
            this.state.account.sendDispositionNotification(uri, id, timestamp, state, (error) => {
                if (!error) {
                    if (save) {
                        let received = (state === 'delivered') ? 1 : 2;
                        let query = "UPDATE messages set received = ? where msg_id = ? and account = ?";
                        this.ExecuteQuery(query, [received, id, this.state.accountId]).then((results) => {
                            //utils.timestampedLog('IMDN for', id, message.content_type, 'saved');
                        }).catch((error) => {
                            utils.timestampedLog('IMDN for', id, uri, 'save error:', error.message);
                        });
                    }
                    resolve(true);
                } else {
                    utils.timestampedLog('IMDN for', id, uri, state, 'sent failed:', error);
                    resolve(false);
                }
            });
        });

        return result;
    }

    loadEarlierMessages() {
        if (!this.state.selectedContact) {
            return;
        }

        let myContacts = this.state.myContacts;
        let uri = this.state.selectedContact.uri;

        if (!(uri in myContacts)) {
            this.setState({totalMessageExceeded: true});
			return;
        }

        let limit = this.state.messageLimit * this.state.messageZoomFactor;

        if (myContacts[uri].totalMessages < limit) {
            this.setState({totalMessageExceeded: true});
			console.log('No more messages for', uri);
            return;
        }

        let messageZoomFactor = this.state.messageZoomFactor;
        messageZoomFactor = messageZoomFactor + 1;
        this.setState({messageZoomFactor: messageZoomFactor, totalMessageExceeded: false});

        setTimeout(() => {
            this.getMessages(this.state.selectedContact.uri, {origin: 'loadEarlier'});
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
        
 		if (file_transfer.transfer_id in this.downloadRequests) {
        	console.log('downloadFile already in progress', file_transfer.transfer_id);
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

        //console.log('autoDownloadFile', file_transfer.filename, 'from', file_transfer.sender.uri);

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

    async downloadFile(file_transfer, force=false) {
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

        console.log('Made directory', dir_path);

        let file_path = dir_path + "/" + file_transfer.filename;
        let tmp_file_path = file_path + '.tmp';

        if (id in this.downloadRequests) {
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

        console.log('Adding request id', id, file_transfer.url);
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
						this.getMessages(this.state.callContact.uri, {origin: 'downloadfile'});
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
		console.log('---');
		console.log(this.decryptRequests);
		
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
                    this._notificationCenter.postSystemNotification(status, {body: uri});
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

            if (updateContact) {
                let myContacts = this.state.myContacts;
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

                if (message.timestamp > myContacts[uri].timestamp) {
                    myContacts[uri].lastMessage = this.buildLastMessage(message);
                    myContacts[uri].lastMessageId = message.id;
                    myContacts[uri].timestamp = message.timestamp;
                    this.saveSylkContact(uri, myContacts[uri], 'decryptMessage');
                    this.setState({myContacts: myContacts});
                }
            }

            if (uri in messages) {
                if (message.content_type === 'text/html') {
                    content = utils.html2text(content);
                } else if (message.content_type === 'text/plain') {
                    content = content;
                } else if (message.content_type.indexOf('image/') > -1) {
                    message.image = `data:${message.content_type};base64,${btoa(content)}`
                }

                msg = utils.sql2GiftedChat(message, content);
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
                error_message = error_message + ', the sender must resent the message';
            }

            if (message.from_uri !== this.state.accountId) {
                console.log('Broken', message.direction, message.from_uri);
                msg = utils.sql2GiftedChat(message, error_message);
                msg.received = 0;
                msg.encrypted = 3;
                render_messages.push(msg);
                messages[uri] = render_messages;
            this.setState({message: messages});
            }
        });
    }

    lookupPublicKey(contact) {
        //console.log('lookupPublicKey', contact);

        if (contact.uri.indexOf('@guest') > -1) {
            return;
        }

        if (contact.uri.indexOf('anonymous') > -1) {
            return;
        }

        if (contact.tags.indexOf('test') > -1) {
            return;
        }

        if (!contact.conference && this.state.connection) {
            this.state.connection.lookupPublicKey(contact.uri);
        }
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

    async getMessages(uri, filter={pinned: false, category: null, text:null, contentType: null}) {
        console.log('Get messages', filter);

        let pinned=filter && 'pinned' in filter ? filter['pinned'] : false;
        let category=filter && 'category' in filter ? filter['category'] : null;
        
        let has_filter = pinned || category;

        let messages = this.state.messages;
        let myContacts = this.state.myContacts;
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

        if (Object.keys(myContacts).indexOf(uri) === -1) {
            this.setState({messages: {}});
            return;
        }

        //console.log('Get messages with', uri, 'with zoom factor', this.state.messageZoomFactor);

        let limit = this.state.messageLimit * this.state.messageZoomFactor;

        query = "SELECT count(*) as rows FROM messages where account = ? and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?))";
        if (pinned) {
            query = query + ' and pinned = 1';
        }

        if (category && category !== 'text') {
            query = query + " and metadata != ''";
        }

        let params = [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId];

        await this.ExecuteQuery(query, params).then((results) => {
            rows = results.rows;
            total = rows.item(0).rows;
            //console.log('Got', total, 'messages with', uri, 'from database', );
        }).catch((error) => {
            console.log('SQL error:', error);
        });

        if (uri in myContacts) {
            myContacts[uri].totalMessages = total;
        }

        query = "SELECT * FROM messages where account = ? and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?))";
//        query = "SELECT * FROM messages where account = ? and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?) or (from_uri =? and to_uri = ?)) ";
        if (pinned) {
            query = query + ' and pinned = 1';
        }

        if (category && category !== 'text') {
            query = query + " and metadata != ''";
        }

        query = query + ' order by unix_timestamp desc limit ?, ?';
        params = [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId, this.state.messageStart, limit];    

		await this.ExecuteQuery(query, params).then(async (results) => {
            //console.log('SQL get messages, rows =', results.rows.length);
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

            for (let i = 0; i < rows.length; i++) {
                try {
					var item = rows.item(i);
	
					content = item.content;
					if (!content) {
						content = 'Empty message...';
					}
	
					last_direction = item.direction;
	
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
	
					const is_encrypted = content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') > -1;
					enc = parseInt(item.encrypted);
										
					if (item.msg_id !== '095c5a66-0817-489b-a4ab-3412a004e46f') {
						//continue;
					}
					
					if (is_encrypted && enc !== 3) {
						myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
						if (item.encrypted === null) {
							item.encrypted = 1;
						}
	
						/*
						 encrypted:
						 1 = unencrypted
						 2 = decrypted
						 3 = failed to decrypt message
						*/
	
						if (uri in decryptingMessages) {
						} else {
							decryptingMessages[orig_uri] = [];
						}
						decryptingMessages[orig_uri].push(item.msg_id);
						messages_to_decrypt.push(item);
					} else {
						if (enc === 3) {
							content = 'Encrypted message';
						} else if (item.content_type === 'text/html') {
							content = utils.html2text(content);
						} else if (item.content_type === 'text/plain') {
							content = content;
						} else if (item.content_type === 'application/sylk-file-transfer') {
							content = content;
						} else if (item.content_type.indexOf('image/') > -1) {
							item.image = `data:${item.content_type};base64,${btoa(content)}`
						} else if (item.content_type === 'application/sylk-contact-update') {
							myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
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
						
							const messageId = metadataContent.messageId;
							const value = metadataContent.value;
						
							if (!messageId) {
								console.log("Metadata without messageId:", metadataContent);
								continue;
							}
						
							metadataContent.author = item.from_uri;
							metadataContent.action = metadataContent.action;
						
							//console.log("Loaded metadata from SQL:", metadataContent);
						
							// Ensure array exists for this messageId
							if (!Array.isArray(messagesMetadata[messageId])) {
								messagesMetadata[messageId] = [];
							}
									
							// Ensure the container exists
							if (!messagesMetadata[messageId]) {
								messagesMetadata[messageId] = [];
							}
							
							const metaArray = messagesMetadata[messageId];
							const action = metadataContent.action;
							//console.log("Loaded metadata from SQL:", action, messageId, value);
							
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
										// New has timestamp, old doesn't → overwrite
										metaArray[existingIndex] = metadataContent;
										updateOriginal = true;
									} else if (newTimestamp && oldTimestamp) {
										// Both have timestamps → overwrite only if new is later
										if (newTimestamp > oldTimestamp) {
											metaArray[existingIndex] = metadataContent;
											updateOriginal = true;
										}
									}
									// If new has no timestamp and old has → keep old
									// If neither has timestamp → overwrite (optional, or keep old)
								}
							} else {
								// No existing metadata for this action → append
								metaArray.push(metadataContent);
								updateOriginal = true;
							}

							if (updateOriginal) {
								const existingMsg = messages[orig_uri].find(m => m._id === msg._id);
								
								// Apply associated metadata to the message
								if (existingMsg && messagesMetadata[msg._id]) {
									for (const meta of messagesMetadata[msg._id]) {
										existingMsg[meta.action] = meta.value;
									}
								}
							}


							foundMetadata = true;
							continue;

						} else {
							console.log('Unknown message', item.msg_id, 'type', item.content_type);
							myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
							//this.deleteMessage(item.msg_id, item.to_uri);
							continue;
						}
	
						last_content = content;
						msg = await utils.sql2GiftedChat(item, content, filter);
						//console.log(msg, msg);
						
						// Prevent crash when msg is null
						if (!msg) {
							myContacts[orig_uri].totalMessages -= 1;
							continue;
						}

						if (msg.metadata?.filename) {
							this.checkFileTransfer(msg);
							//console.log('SQL metadata',  JSON.stringify(msg.metadata, null, 2));
						}
	
						if (!msg) {
							myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
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
						
						messages[orig_uri].push(msg);
						
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
	
							this.autoDownloadFile(msg.metadata);
						}
						
					}
					} catch (e) {
						console.log('SQL row error', e, item);
					}
				}
	
				Object.keys(this.state.incomingMessage).forEach((key) => {
					const msg = this.state.incomingMessage[key];
					if (key in messages) {
						// Check if the message already exists
						const exists = messages[key].some(m => m._id === msg._id);
						if (!exists) {
							console.log('Added synthetic message from push');
							messages[key].push(msg);
						}
					}
				});
	
				this.setState({filteredMessageIds: filteredMessageIds, contentTypes: contentTypes});
				console.log('Loaded messages for', uri, messages[orig_uri].length);
	
				last_messages = messages[orig_uri];
				last_messages.reverse();
				if (last_messages.length > 0) {
					last_messages.forEach((last_item) => {
						last_message = this.buildLastMessage(last_item);
						last_message_id = last_item.id;
						return;
					});
				}
	
				if (orig_uri in myContacts && !has_filter) {
					if (last_message && last_message != myContacts[orig_uri].lastMessage && last_message !== 'Public key received') {
						myContacts[orig_uri].lastMessage = last_message;
						myContacts[orig_uri].lastMessageId = last_message_id;
						this.saveSylkContact(uri, myContacts[orig_uri], 'getMessages');
					}
					myContacts[orig_uri].messagesMetadata = {...messagesMetadata};
					this.setState({myContacts: myContacts});
				}
	
				this.setState({messages: messages,
							   messagesMetadata: messagesMetadata,
					           decryptingMessages: decryptingMessages
				});

				let i = 1;
				messages_to_decrypt.forEach((item) => {
					var updateContact = messages_to_decrypt.length === i;
					this.decryptMessage(item, updateContact);
					i = i + 1;
				});

        }).catch((error) => {
            console.log('getMessages SQL error:', error);
        });
    }

    async getTransferedFiles(uri, filter) {
        //console.log('-- Get files for', uri, filter={});
        
        if (this.unmounted) {
			return;
        }

        if (!uri) {
			return;
        }

		let transferedFiles = this.state.transferedFiles;
		let metadata;
		let message_ids = {'audios': [], 'videos': [], 'photos': [], 'others': []};
		let found = 0;

        let query = "SELECT * FROM messages where account = ? and metadata != '' and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?)) ";
        let params = [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId];

        let { incoming = true, outgoing = true, period = null, periodType = 'after' } = filter || {};

		incoming = filter?.incoming || incoming;
		outgoing = filter?.incoming || incoming;
		period = filter?.period || period;
		periodType = filter?.periodType || periodType;
		
        await this.ExecuteQuery(query, params).then((results) => {
            let rows = results.rows;
            //console.log('Got', rows.length);
            for (let i = 0; i < rows.length; i++) {
               try {
				   var item = rows.item(i);
				   timestamp = new Date(JSON.parse(item.timestamp, _parseSQLDate));
				   	
				   if (period) {
					   if (periodType == 'before') {
							if (timestamp > period) {
							   continue;
							}
						} else {
							if (timestamp < period) {
							   continue;
							}
						}
				   }
	
				   if (!incoming && item.direction === 'incoming') {
					   continue;
				   }
	
				   if (!outgoing && item.direction === 'outgoing') {
					   continue;
				   }
	
                   metadata = JSON.parse(item.metadata);
                   if (!metadata.local_url) {
					   continue;
                   }

				   const filename = metadata.local_url.split('/').pop();
				   
				   if (metadata.filetype.toLowerCase().startsWith('image/')) {
					   message_ids['photos'].push(item.msg_id);
				   } else if (metadata.filetype.toLowerCase().startsWith('audio/')) {
					   message_ids['audios'].push(item.msg_id);
				   } else if (metadata.filetype.toLowerCase().startsWith('video/')) {
					   message_ids['videos'].push(item.msg_id);
				   } else {
					   message_ids['others'].push(item.msg_id);
				   }
				   found = found + 1;
	
               } catch (e) {
                   console.log('getTransferedFiles row error:', e);
                   continue;
               }
            }

			transferedFiles[uri] = message_ids;
			this.setState({transferedFiles: transferedFiles});

        }).catch((error) => {
            console.log('----getTransferedFiles SQL error:', error);
        });   
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

    async deleteMessages(uri, remote=false, filter={}) {
        console.log('Delete messages for', uri, 'remote', remote, 'filter', filter);

        let messages = this.state.messages;
        let myContacts = this.state.myContacts;
        let timestamp;
        let purgeMessages = [];
        let deleteAll = remote && filter.deleteContact && !filter.simulate
       
        if (filter.wipe) {
			this.wipe_device();
			return;
        }
       
        if (filter.incoming && filter.outgoing && !filter.period) {
			deleteAll = true;
        }

        let orig_uri = uri;

		if (uri.indexOf('@') === -1 && utils.isPhoneNumber(uri)) {
			uri = uri + '@' + this.state.defaultDomain;
		}
		
		if (deleteAll) {
			console.log('Delete all messages exchanged with', uri);
			if (uri.indexOf('@guest.') === -1) {
				this.addJournal(orig_uri, 'removeConversation');
			}

			let dir = RNFS.DocumentDirectoryPath + '/conference/' + uri + '/files';
			RNFS.unlink(dir).then((success) => {
				console.log('Removed folder', dir);
			}).catch((err) => {
				console.log('Error deleting folder', dir, err.message);
			});

			if (orig_uri in messages) {
				delete messages[orig_uri];
				this.setState({messages: messages});
			}
			
			if (!filter.deleteContact && orig_uri in myContacts) {
				myContacts[orig_uri].totalMessages = 0;
				myContacts[orig_uri].lastMessage = null;
				myContacts[orig_uri].lastMessageId = null;
				this.setState({myContacts: myContacts});
			}
		}

		if (filter.deleteContact) {
			this.removeContact(orig_uri);
		}

        let query = "SELECT * FROM messages where account = ? and ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?)) ";
        await this.ExecuteQuery(query, [this.state.accountId, this.state.accountId, uri, uri, this.state.accountId]).then((results) => {
            let rows = results.rows;
            let metadata;
            console.log(rows.length, 'messages found');
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
					       //console.log('skip file transfer');
						   continue;
					   }
				   } catch (e) {
					   // is not a file transfer
				   }
			   }

			  if (filter.period) {
                   if (filter.periodType == 'before') {
						if (timestamp > filter.period) {
						   // skip for deletion
						   continue;
						}
					} else {
						if (timestamp < filter.period) {
						   continue;
						}
					}
               }
               
               if (!filter.incoming && item.direction == 'incoming') {
				   continue;  
               }

               if (!filter.outgoing && item.direction == 'outgoing') {
				   continue;  
               }

			   purgeMessages.push(item.msg_id);
            }
            
            if (!filter.simulate && purgeMessages.length > 20) {
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
				this._notificationCenter.postSystemNotification('All messages removed');
			}

        }).catch((error) => {
            console.log('delete messages error:', error);
        });
    }

    async wipe_device() {
		this.deleteAllContacts(this.state.accountId);
		let exists = false;

		// Remove the saved account

        storage.remove('last_signup');
        storage.remove('signup');
		storage.remove('myParticipants');
		storage.remove('account');
		storage.remove('devices');

		console.log('--- Wiping device --- ');

		let dir = RNFS.DocumentDirectoryPath + '/conference';
		exists = await RNFS.exists(dir);

		if (exists) {
			RNFS.unlink(dir).then((success) => {
			}).catch((err) => {
				console.log('Error deleting conference folder', dir, err.message);
			});
		}

		dir = RNFS.DocumentDirectoryPath + '/' + this.state.accountId;
		exists = await RNFS.exists(dir);
		if (exists) {
			RNFS.unlink(dir).then((success) => {
			}).catch((err) => {
				console.log('Error deleting home folder', dir, err.message);
			});
		}

		query = "DELETE FROM messages where (account = ? and to_uri = ? and direction = 'incoming') or (account = ? and from_uri = ? and direction = 'outgoing')";
		params = [this.state.accountId, this.state.accountId, this.state.accountId, this.state.accountId];

        await this.ExecuteQuery(query, params).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'messages');
            }
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });

		this.setState({messages: {}});
		this.saveLastSyncId(null);

		if (Platform.OS === 'android') {
		  BackHandler.exitApp();
		}
	}

    async deleteAllContacts(account) {
        let query = 'delete from contacts where account = ?';
        this.setState({myContacts: {}});
        await this.ExecuteQuery(query, [account]).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'contacts');
            }
            this.deleteKeys(account);
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async deleteKeys(account) {
        let query = 'delete from keys where account = ?';
        this.setState({keys: null});
        await this.ExecuteQuery(query, [account]).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'keys');
            }
            setTimeout(() => {
                this.logout();
            }, 1000);
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    playMessageSound(direction='incoming') {
        console.log('---- playMessageSound', direction);

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

    async removeMessage(message, uri=null) {
        //console.log('removeMessage');

        if (uri === null) {
            uri = message.sender.uri;
        }

        if (uri === this.state.accountId) {
            uri = message.receiver;
        }

        await this.deleteMessage(message.id, uri, false).then((result) => {
            //console.log('Message', message.id, 'to', uri, 'is removed');
        }).catch((error) => {
            //console.log('Failed to remove message', message.id, 'to', uri);
            return;
        });

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) === -1) {
            return;
        }

        let existingMessages = renderMessages[uri];
        let newMessages = [];

        existingMessages.forEach((msg) => {
            if (msg._id === message.id) {
                return;
            }
            newMessages.push(msg);
        });

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            if (myContacts[uri].totalMessages) {
                myContacts[uri].totalMessages = myContacts[uri].totalMessages - 1;
            }

            let idx = myContacts[uri].unread.indexOf(message.id);

            if (idx > -1) {
                myContacts[uri].unread.splice(idx, 1);
            }

            if (myContacts[uri].lastMessageId === message.id) {
                myContacts[uri].lastMessage = null;
                myContacts[uri].lastMessageId = null;
            }
        }

        renderMessages[uri] = newMessages;
        this.setState({messages: renderMessages, myContacts: myContacts});
    }

    async removeConversation(obj) {
        let uri = obj;
        console.log('removeConversation', uri);

        let renderMessages = this.state.messages;

        await this.deleteMessages(uri, false).then((result) => {
            utils.timestampedLog('Conversation with', uri, 'was removed');
        }).catch((error) => {
            console.log('Failed to delete conversation with', uri);
        });
    }

    removeConversationSync(obj) {
        let uri = obj.content;
        console.log('Sync remove conversation with', uri, 'before', obj.timestamp);

        let query;

        let unix_timestamp = Math.floor(obj.timestamp / 1000);

        query = "DELETE FROM messages where (from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?) and (unix_timestamp < ? or unix_timestamp = 0)";

        this.ExecuteQuery(query, [this.state.accountId, uri, uri, this.state.accountId, unix_timestamp]).then((result) => {
             if (result.rowsAffected > 0) {
                 console.log('SQL deleted', result.rowsAffected, 'messages with', uri, 'before', obj.timestamp);
             }
        }).catch((error) => {
            console.log('SQL delete conversation sync error:', error);
        });

        let myContacts = this.state.myContacts;
        if (uri in myContacts && myContacts[uri].timestamp < obj.timestamp) {
            this.deleteSylkContact(uri);
        }
    }

    async readConversation(uri) {
        console.log('readConversation', uri);
        this.resetUnreadCount(uri)
    }

    removeContact(uri) {
        console.log('removeContact', uri);
        let myContacts = this.state.myContacts;
        
        this.deleteSylkContact(uri);

        if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
            this.setState({selectedContact: null});
        }

        let renderMessages = this.state.messages;
        if (uri in renderMessages) {
            delete renderMessages[uri];
            this.setState({messages: renderMessages});
        }
    }

    async add_sync_pending_item(item) {
        //console.log('add_sync_pending_item', item);
        if (this.sync_pending_items.indexOf(item) > -1) {
            return;
        }

        this.sync_pending_items.push(item);
        if (this.sync_pending_items.length == 1) {
            //console.log('Sync started ---');
            this.setState({syncConversations: true});

            if (this.syncTimer === null) {
                this.syncTimer = setTimeout(() => {
                    this.resetSyncTimer();
                }, 1000 * 60 * 2);
            }
        }
    }

    resetSyncTimer() {
        if (this.sync_pending_items.length > 0) {
            //console.log('Sync ended by timer ---', this.sync_pending_items.length, 'items left to be processed');
            this.sync_pending_items = [];
            //console.log('Pending tasks:', this.sync_pending_items);
            this.afterSyncTasks();
        }
    }

    async remove_sync_pending_item(item) {
        //console.log('remove_sync_pending_item', item);
        let idx = this.sync_pending_items.indexOf(item);
        if (idx > -1) {
            this.sync_pending_items.splice(idx, 1);
        }


        if (this.sync_pending_items.length == 0 && this.state.syncConversations) {
            if (this.syncTimer !== null) {
                clearTimeout(this.syncTimer);
                this.syncTimer = null;
            }

            this.afterSyncTasks();
        } else {
			//console.log('remove_sync_pending_items remaining:', this.sync_pending_items.length);
			//console.log(JSON.stringify(this.sync_pending_items, null, 2));
        }
    }

    async afterSyncTasks() {
        //console.log('afterSyncTasks');

        this.insertPendingMessages();

        if (this.newSyncMessagesCount) {
            utils.timestampedLog('Synced', this.newSyncMessagesCount, 'messages from server');
            this.newSyncMessagesCount = 0;
        }

        this.setState({syncConversations: false, nextSyncUriFilter: null});
        this.sync_pending_items = [];
        let myContacts = this.state.myContacts;
        let updateContactUris = this.state.updateContactUris;
        let replicateContacts = this.state.replicateContacts;
        let deletedContacts = this.state.deletedContacts;

        //console.log('updateContactUris:', Object.keys(updateContactUris).toString());
        //console.log('replicateContacts:', Object.keys(replicateContacts).toString());
        //console.log('deletedContacts:', Object.keys(deletedContacts).toString());
        let uris = Object.keys(replicateContacts).concat(Object.keys(updateContactUris));
        uris = [... new Set(uris)];

        //console.log('Update contacts:', uris.toString());

        // sync changed myContacts with SQL database
        let created;
        let old_tags;
        uris.forEach((uri) => {
            if (uri in myContacts) {
                created = false;
            } else {
                if (uri in deletedContacts) {
                    return
                }
                myContacts[uri] = this.newContact(uri);
                created = true;
            }

            if (uri in replicateContacts) {
                myContacts[uri].name = replicateContacts[uri].name;
                myContacts[uri].email = replicateContacts[uri].email;
                myContacts[uri].organization = replicateContacts[uri].organization;

                old_tags = myContacts[uri].tags;
                myContacts[uri].tags = replicateContacts[uri].tags;
                myContacts[uri].participants = replicateContacts[uri].participants;

                if (myContacts[uri].timestamp > replicateContacts[uri].timestamp) {
                    if (old_tags.indexOf('missed') > -1 && replicateContacts[uri].tags.indexOf('missed') === -1) {
                        myContacts[uri].tags.push('missed');
                    }
                }

                if (old_tags.indexOf('chat') > -1 && replicateContacts[uri].tags.indexOf('chat') === -1) {
                    myContacts[uri].tags.push('chat');
                }

                if (old_tags.indexOf('calls') > -1 && replicateContacts[uri].tags.indexOf('calls') === -1) {
                    myContacts[uri].tags.push('calls');
                }

                if (replicateContacts[uri].timestamp > myContacts[uri].timestamp || created) {
                    myContacts[uri].timestamp = replicateContacts[uri].timestamp;

                    if (uri === this.state.accountId) {
                        let name = replicateContacts[uri].name || '';
                        let organization = replicateContacts[uri].organization || '';
                        this.setState({displayName: name, organization: organization, email: myContacts[uri].email});
                    }
                }
            }

            if (uri in updateContactUris && updateContactUris[uri] > myContacts[uri].timestamp) {
                myContacts[uri].timestamp = updateContactUris[uri];
            }

            this.saveSylkContact(uri, myContacts[uri], 'journal');

        });

        let purgeMessages = this.state.purgeMessages;
        purgeMessages.forEach((id) => {
            this.deleteMessage(id, this.state.accountId);
        });

        Object.keys(deletedContacts).forEach((uri) => {
            this.removeConversationSync(deletedContacts[uri])
        });

        this.setState({purgeMessages:[],
                       syncConversations: false,
                       firstSyncDone: true,
                       updateContactUris: {},
                       replicateContacts: {},
                       deletedContacts: {}});

        if (this.syncStartTimestamp) {
            let diff = (Date.now() - this.syncStartTimestamp)/ 1000;
            this.syncStartTimestamp = null;
            //console.log('Sync ended after', diff, 'seconds');
        }

        setTimeout(() => {
            if (this.state.selectedContact) {
                this.getMessages(this.state.selectedContact.uri, {origin: 'journal'});
            }
            this.addTestContacts();
            this.refreshNavigationItems();
            this.updateServerHistory('syncConversations')
        }, 100);

		if (this.state.respawnSync) {
			console.log('Continue sync');
			setTimeout(() => {
				this.requestSyncConversations(this.state.lastSyncId);
			}, 1000);
		}
    }

    async syncConversations(messages) {       
        if (this.sync_pending_items.length > 0) {
            console.log('Sync already in progress', this.sync_pending_items.length, 'pending items left from last sync');
            return;
        }

        if (this.signOut || this.currentRoute === '/logout') {
            return;
        }

        if (this.currentRoute === '/login') {
            return;
        }

        this.syncStartTimestamp = new Date();

        let myContacts = this.state.myContacts;
        let renderMessages = { ...this.state.messages };  
        if (messages.length > 0) {
            utils.timestampedLog('Sync', messages.length, 'message events from server');
            console.log('Sync', messages.length, 'message events from server');
            //this._notificationCenter.postSystemNotification('Syncing messages with the server');
            this.add_sync_pending_item('sync_in_progress');
        } else {
            this.setState({firstSyncDone: true, respawnSync: false});
            utils.timestampedLog('No new messages on server');
            //this._notificationCenter.postSystemNotification('No new messages');
            setTimeout(() => {
                this.addTestContacts();
                this.refreshNavigationItems();
                this.updateServerHistory('syncConversations')
            }, 500);
        }

        let i = 0;
        let idx;
        let uri;
        let last_id;
        let content;
        let contact;
        let existingMessages;
        let formatted_date;
        let newMessages = [];
        let lastMessages = {};
        let updateContactUris = {};
        let deletedContacts = {};
        let last_timestamp;
        let stats = {state: 0,
                     remove: 0,
                     incoming: 0,
                     outgoing: 0,
                     delete: 0,
                     read: 0}
                     
        let j = 0;

        let gMsg;
        let purgeMessages = this.state.purgeMessages;
        let direction;

		for (const message of messages) {
            if (this.signOut) {
                break;
            }

            last_timestamp = message.timestamp;
            i = i + 1;
            uri = null;

            if (message.contentType === 'application/sylk-message-remove') {
                uri = message.content.contact;
            } else if (message.contentType === 'application/sylk-conversation-remove') {
                uri = message.content;
            } else if (message.contentType === 'application/sylk-conversation-read' ) {
                uri = message.content;
            } else if (message.contentType === 'message/imdn') {
            } else {
                if (message.sender.uri === this.state.account.id) {
                    uri = message.receiver;
                } else {
                    uri = message.sender.uri;
                }
            }

            if (this.state.nextSyncUriFilter && this.state.nextSyncUriFilter !== uri) {
                //console.log('Skip journal entry not belonging to', this.state.nextSyncUriFilter);
                continue;
            }

            direction = message.sender.uri === this.state.account.id ? 'outgoing': 'incoming';
            
			//console.log('Process journal', i, 'of', messages.length, message.id, direction, message.contentType, uri);

            let d = new Date(2019);

            if (message.timestamp < d) {
                //console.log('Skip broken journal with broken date', message.id);
                purgeMessages.push(message.id);
                continue;
            }

            if (!message.content) {
                //console.log('Skip broken journal with empty body', message.id);
                purgeMessages.push(message.id);
                continue;
            }

//            if (message.contentType !== 'application/sylk-conversation-remove' && message.contentType !== 'application/sylk-message-remove' && uri && Object.keys(myContacts).indexOf(uri) === -1) {
            if (unreadCounterTypes.has(message.contentType) && Object.keys(myContacts).indexOf(uri) === -1) {

                if (uri.indexOf('@') > -1 && !utils.isEmailAddress(uri)) {
                    //console.log('Skip bad uri', uri);
                    continue;
                }
                myContacts[uri] = this.newContact(uri, uri, {'src': 'journal ' + direction});
                myContacts[uri].timestamp = message.timestamp;
            }

            //console.log('Sync', message.timestamp, message.contentType, uri);

            if (message.contentType === 'application/sylk-message-remove') {
                this.add_sync_pending_item(message.id);
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

                if (uri in myContacts) {
                    let idx = myContacts[uri].unread.indexOf(message.id);

                    if (idx > -1) {
                        myContacts[uri].unread.splice(idx, 1);
                    }

                    if (myContacts[uri].lastMessageId === message.id) {
                        myContacts[uri].lastMessage = null;
                        myContacts[uri].lastMessageId = null;
                    }
                }

                if (uri in lastMessages && lastMessages[uri] === message.id) {
                    delete lastMessages[uri];
                }

                stats.delete = stats.delete + 1;

            } else if (message.contentType === 'application/sylk-conversation-remove') {

                if (uri in myContacts && message.timestamp > myContacts[uri].timestamp) {
                    delete myContacts[uri];
                }

                if (uri in updateContactUris) {
                    delete updateContactUris[uri];
                }

                if (uri in lastMessages) {
                    delete lastMessages[uri];
                }

                if (uri in renderMessages) {
                    delete renderMessages[uri];
                }

                deletedContacts[uri] = message;

                stats.remove = stats.remove + 1;

            } else if (message.contentType === 'application/sylk-conversation-read') {
                updateContactUris[uri] = last_timestamp;
                myContacts[uri].unread = [];
                stats.read = stats.read + 1;

            } else if (message.contentType === 'message/imdn') {
                this.messageStateChangedSync({messageId: message.id, state: message.state});
                stats.state = stats.state + 1;

            } else {
                this.add_sync_pending_item(message.id);

                if (message.sender.uri === this.state.account.id) {
					 if (message.contentType === 'application/sylk-message-metadata') {
					 } else {
						if (message.contentType !== 'application/sylk-contact-update') {
							if (myContacts[uri].tags.indexOf('blocked') > -1) {
								continue;
							}
	
							if (myContacts[uri].tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
								myContacts[uri].tags.push('chat');
							}

							lastMessages[uri] = message.id;
	
							if (message.timestamp > myContacts[uri].timestamp) {
								updateContactUris[uri] = message.timestamp;
								myContacts[uri].timestamp = message.timestamp;
							}
						}
                     }

                    stats.outgoing = stats.outgoing + 1;
                    this.outgoingMessageFromJournal(message, {idx: i, total: messages.length});
                    j = j + 1;

                } else {
					 if (message.contentType === 'application/sylk-message-metadata') {
					} else {

						if (myContacts[uri].tags.indexOf('blocked') > -1) {
							continue;
						}
	
						if (message.timestamp > myContacts[uri].timestamp) {
							updateContactUris[uri] = message.timestamp;
							myContacts[uri].timestamp = message.timestamp;
						}
	
						if (message.contentType === 'application/sylk-file-transfer') {
							gMsg = utils.sylk2GiftedChat(message, '', 'incoming');
							myContacts[uri].lastMessage  = this.buildLastMessage(gMsg);
							myContacts[uri].lastMessageId = message.id;
							myContacts[uri].lastCallDuration = null;
							myContacts[uri].direction = 'incoming';
						}
	
						if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
							this.mustPlayIncomingSoundAfterSync = true;
						}
						if (myContacts[uri].tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
							myContacts[uri].tags.push('chat');
						}
	
						lastMessages[uri] = message.id;
	
						if (message.dispositionNotification.indexOf('display') > -1) {
							if (unreadCounterTypes.has(message.contentType)) {
								//console.log('Increment unread count for', uri);
								myContacts[uri].unread.push(message.id);
							}
						}
					}

                    stats.incoming = stats.incoming + 1;
                    this.incomingMessageFromJournal(message, {idx: i, total: messages.length});
                    j = j + 1;
                }
            }

            last_id = message.id;

            if (i > 50) {
                this.setState({respawnSync: true});
				break;
            } else {
				this.setState({respawnSync: false});
            }
        };

        this.setState({messages: {...renderMessages},
                       updateContactUris: updateContactUris,
                       deletedContacts: deletedContacts,
                       purgeMessages: purgeMessages,
                       myContacts: {...myContacts}
                       });

        this.remove_sync_pending_item('sync_in_progress');

        Object.keys(lastMessages).forEach((uri) => {
            //console.log('Last messages update:' , lastMessages);
            //console.log('Update last message for', uri);
            // TODO update lastMessage content for each contact
        });

        if (last_id) {
            this.saveLastSyncId(last_id, true);
        }
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
        console.log('Incoming message from web socket', message.id, message.contentType, 'from', message.sender.uri);
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
                this.sendDispositionNotification(message, 'error', true);
                this.saveSystemMessage(message.sender.uri, 'Cannot decrypt message, no private key', 'incoming');
            } else {
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    utils.timestampedLog('Incoming message', message.id, 'decrypted');
                    this.handleIncomingMessage(message, decryptedBody);
                }).catch((error) => {
                    console.log('Failed to decrypt message', message.id, error);
                    this.saveSystemMessage(message.sender.uri, 'Received message encrypted with wrong key', 'incoming');
                    this.sendDispositionNotification(message, 'error', true);
                    this.sendPublicKeyToUri(message.sender.uri);
                });
            }
        } else {
            //console.log('Incoming message is not encrypted');
            this.handleIncomingMessage(message);
        }
    }

    handleIncomingMessage(message, decryptedBody=null) {
        console.log(Platform.OS, 'handleIncomingMessage', message.sender.uri, message.contentType, 'app state', this.state.appState);
        this.saveIncomingMessage(message, decryptedBody);

        let content = decryptedBody || message.content;

        if (!this.state.selectedContact || this.state.selectedContact.uri !== message.sender.uri) {
            if (this.state.appState === 'foreground') {
				if (Platform.OS === 'android') {
					this.postAndroidMessageNotification(message.sender.uri, content);
                }
            }
        }
        
		if (message.contentType === 'application/sylk-message-metadata') {
			this.handleMessageMetadata(message.sender.uri, content);
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
	
			const selectedContact = {
				...this.state.selectedContact,
				lastMessage: this.buildLastMessage(gMsg),
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

	handleMessageMetadata(uri, content) {
	    console.log('handleMessageMetadata', uri, content);
        if (!this.state.selectedContact || this.state.selectedContact.uri != uri) {
            console.log('Skip handleMessageMetadata');
			return;
        }

	    let metadataContent;
		try {
			metadataContent = JSON.parse(content);
		} catch (error) {
			console.log('handleMessageMetadata cannot parse payload', error);
			return
		}

		metadataContent.author = uri;

		// Determine messageId
		const mId = metadataContent.messageId;
		console.log("handle metadata message", metadataContent);

		if (!mId) {
			return;
		}	

		// If contact is NOT selected, do nothing (state will rebuild from SQL later)
		if (!this.state.selectedContact || this.state.selectedContact.uri !== uri) {
			console.log("No selected contact or wrong contact — skipping live metadata update.");
			return;
		}

		this.setState(prev => {
			const selectedUri = prev.selectedContact?.uri;
			if (!selectedUri) return null; // still no contact? do nothing

			const oldMetaByUri =
				prev.myContacts?.[selectedUri]?.messagesMetadata ||
				prev.messagesMetadata?.[selectedUri] ||
				{};

			const oldArray =
				oldMetaByUri[mId] && Array.isArray(oldMetaByUri[mId])
					? oldMetaByUri[mId]
					: [];

			// If previous metadata exists AND the previous one was not authored by this sender, skip
			const lastEntry = oldArray.length ? oldArray[oldArray.length - 1] : null;

			let mustUpdate = true;

			if (lastEntry && lastEntry.author !== metadataContent.author) {
				console.log("Ignoring metadata: previous author mismatch");
				mustUpdate = false;
			}

			if (!mustUpdate) return null;

			// Remove previous entries with same action
			const filtered = oldArray.filter(
				ev => ev.action !== metadataContent.action
			);

			// Add new entry
			const newArray = [...filtered, metadataContent];

			console.log("Updated metadata:", {mId, newArray});

			// Rebuild URI-level metadata object
			const newMetaByUri = {
				...oldMetaByUri,
				[mId]: newArray
			};

			// Update structures
			const newMyContacts = {
				...prev.myContacts,
				[selectedUri]: {
					...prev.myContacts[selectedUri],
					messagesMetadata: newMetaByUri
				}
			};

			const newMessagesMetadata = {
				...prev.messagesMetadata,
				[selectedUri]: newMetaByUri
			};

			return {
				myContacts: newMyContacts,
				messagesMetadata: newMessagesMetadata
			};
		});
	}

    buildLastMessage(message, content=null) {
        let new_content = '';
        let filename = 'File';
        //console.log('buildLastMessage', message.contentType);

        if (message.contentType === 'application/sylk-file-transfer') {
            new_content = utils.beautyFileNameForBubble(message.metadata, true);
        } else {
            new_content = content || message.content || message.text;
        }

        let c = new_content.substring(0, 100);
        return c;
    }

    async incomingMessageFromJournal(message, info={}) {
        //console.log('incomingMessageFromJournal', message.id, message.contentType, info);
        // Handle incoming messages

		if (this.state.blockedUris.indexOf(message.sender.uri) > -1) { 
            this.remove_sync_pending_item(message.id);
			utils.timestampedLog('Reject message from blocked URI', from);
			return;
		}

        if (message.content.indexOf('?OTRv3') > -1) {
            this.remove_sync_pending_item(message.id);
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            this.remove_sync_pending_item(message.id);
            this.savePublicKeySync(message.sender.uri, message.content);
            return;
        }

        if (message.contentType === 'text/pgp-public-key-imported') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        if (message.contentType === 'text/pgp-private-key') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        const is_encrypted =  message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        info.is_encrypted = is_encrypted;
		this.saveincomingMessageFromJournal(message, info);
    }

    async outgoingMessage(message) {
        console.log('Outgoing message', message.contentType, message.id, 'to', message.receiver, 'state', message.state);

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

        const is_encrypted = message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                utils.timestampedLog('Outgoing message', message.id, 'decrypted');

                content = decryptedBody;
                if (message.contentType === 'application/sylk-contact-update') {
                    this.handleReplicateContact(content);
                } else {

                    this.saveOutgoingMessageSql(message, content, 1);

                    let myContacts = this.state.myContacts;
                    let uri = message.receiver;

                    if (uri in myContacts) {
                        //
                    } else {
                        myContacts[uri] = this.newContact(uri);
                    }

                    if (message.timestamp > myContacts[uri].timestamp) {
                        myContacts[uri].timestamp = message.timestamp;
                    }

                    let gMsg = utils.sylk2GiftedChat(message, content, 'outgoing');

                    if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                        myContacts[uri].lastMessage = this.buildLastMessage(gMsg);
                        myContacts[uri].lastMessageId = message.id;

                        if (this.state.selectedContact) {
                            let selectedContact = this.state.selectedContact;
                            selectedContact.lastMessage = myContacts[uri].lastMessage;
                            selectedContact.timestamp = message.timestamp;
                            selectedContact.direction = 'outgoing';
                            selectedContact.lastCallDuration = null;
                            this.setState({selectedContact: selectedContact});
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

                    this.setState({myContacts: myContacts});
                    this.saveSylkContact(uri, myContacts[uri], 'outgoingMessage');
                }

            }).catch((error) => {
                console.log('Failed to decrypt my own message in outgoingMessage:', error);
                return;
            });
        } else {
            if (message.contentType === 'application/sylk-contact-update') {
                this.handleReplicateContact(content);
            } else {

                this.saveOutgoingMessageSql(message);

                let myContacts = this.state.myContacts;
                let uri = message.receiver;

                if (uri in myContacts) {
                    //
                } else {
                    myContacts[uri] = this.newContact(uri);
                }

                if (message.timestamp > myContacts[uri].timestamp) {
                    myContacts[uri].timestamp = message.timestamp;
                }

                if (message.contentType === 'text/html') {
                    content = utils.html2text(content);
                } else if (message.contentType.indexOf('image/') > -1) {
                    content = 'Photo';
                }

                gMsg = utils.sylk2GiftedChat(message, content, 'outgoing')

                if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                    myContacts[uri].lastMessage = this.buildLastMessage(gMsg);
                    myContacts[uri].lastMessageId =  message.id;
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

                this.saveSylkContact(uri, myContacts[uri], 'outgoingMessage');
            }
        }
    }

    async outgoingMessageFromJournal(message, info={}) {
        //console.log('outgoingMessageFromJournal', message.id, message.contentType , 'to', message.receiver, info);

        if (message.content.indexOf('?OTRv3') > -1) {
            this.remove_sync_pending_item(message.id);
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        if (message.contentType === 'message/imdn') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        if (message.contentType === 'text/pgp-private-key') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        const is_encrypted = message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            if (message.contentType === 'application/sylk-contact-update') {
                // to do get last sylk-contact-update after sync                
				this.remove_sync_pending_item(message.id);
                /*
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    console.log('Sync outgoing message', message.id, message.contentType, 'decrypted to', message.receiver);
                    this.handleReplicateContactSync(decryptedBody, message.id, message.timestamp);
                    this.remove_sync_pending_item(message.id);
                }).catch((error) => {
                    console.log('Failed to decrypt my own message in sync:', error.message);
                    this.remove_sync_pending_item(message.id);
                    return;
                });
                */
            } else {
				info.is_encrypted = true;
                this.saveOutgoingMessageSqlBatch(message, info);
                this.remove_sync_pending_item(message.id);
            }

        } else {
            if (message.contentType === 'application/sylk-contact-update') {
                //this.handleReplicateContactSync(content, message.id, message.timestamp);
                this.remove_sync_pending_item(message.id);
            } else {
				info.is_encrypted = false;
                this.saveOutgoingMessageSqlBatch(message, info);
            }
        }
    }

    saveOutgoingMessageSql(message, decryptedBody=null, is_encrypted=false) {
        console.log('saveOutgoingMessageSql', message.contentType);

        let pending = 0;
        let sent = null;
        let received = null;
        let encrypted = 0;
        let content = decryptedBody || message.content;
        let metadata;
        let related_msg_id;
        let relation_action;

		if (item.content_type == 'application/sylk-message-metadata') {
			related_msg_id = metadataContent.messageId;
			relation_action = metadataContent.action;
		}

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
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(ts), unix_timestamp, content, message.contentType, message.metadata, message.sender.uri, message.receiver, "outgoing", pending, sent, received, related_msg_id, relation_action];
        this.ExecuteQuery("INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, sent, received, related_msg_id, relation_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            console.log('SQL inserted outgoing', message.contentType, 'message to', message.receiver, 'encrypted =', encrypted);
            this.remove_sync_pending_item(message.id);

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
            this.remove_sync_pending_item(message.id);
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

				let metadata = JSON.parse(item.metadata);
				if (file_transfer.consumed) {
					if (metadata.consumed) {
					    console.log('Existing SQL metadata.consumed', metadata.consumed);
					    if (file_transfer.consumed > metadata.consumed) {
							file_transfer_sql.consumed = file_transfer.consumed;
							this.sendConsumedMessage(file_transfer_sql);
						}
					} else {
					    console.log('no previous SQL metadata.consumed');
						file_transfer_sql.consumed = file_transfer.consumed;
						this.sendConsumedMessage(file_transfer_sql);
					}
				}

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
					this.updateFileTransferBubble(file_transfer);
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

        let unix_timestamp = Math.floor(message.timestamp / 1000);
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, message.metadata, message.sender.uri, message.receiver, "outgoing", pending, sent, received, message.state];
        this.pendingNewSQLMessages.push(params);

        if (this.pendingNewSQLMessages.length > 24) {
            this.insertPendingMessages();
        }

        this.remove_sync_pending_item(message.id);
    }

    async insertPendingMessages() {
		//console.log('insertPendingMessages');
        if (this.pendingNewSQLMessages.length > 0) {
            console.log('insertPendingMessages', this.pendingNewSQLMessages.length, 'new messages');
        } else {
			//console.log('insertPendingMessages has no data');
			return;
        }

        let query = "INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, pending, sent, received, state) VALUES "


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
        let account = null;
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

            this.ExecuteQuery(query, all_values).then((result) => {
                utils.timestampedLog('Saved', pendingNewSQLMessages.length, 'new messages');
                //this._notificationCenter.postSystemNotification('Saved ' + pendingNewSQLMessages.length + ' new messages');

                this.newSyncMessagesCount = this.newSyncMessagesCount + pendingNewSQLMessages.length;
                // todo process file transfers

                pendingNewSQLMessages.forEach((values) => {
                    id = values[2];
                    if (values[6] === 'application/sylk-file-transfer') {
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

            }).catch((error) => {
                //console.log('SQL error inserting bulk messages:', error.message);

                pendingNewSQLMessages.forEach((values) => {
                    this.ExecuteQuery(query, values).then((result) => {
                        this.newSyncMessagesCount = this.newSyncMessagesCount + 1;
                    }).catch((error) => {
                       id = values[2];
                        if (error.message.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') > -1) {
                            // todo update file transfer status
                            if (values[6] === 'application/sylk-file-transfer') {
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
                            } else {
								if (error.message.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') === -1) {
									console.log('SQL error inserting each message:', error.message);
									console.log('query', query);
									console.log('values', values);
								}
                            }

                        } else {
                            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                                console.log('insertPendingMessages SQL error', id, error.message);
                            }
                        }
                    });
                });
            });
        }
    }

    async saveSystemMessage(uri, content, direction, missed=false, system=1) {
        let timestamp = new Date();
        let unix_timestamp = Math.floor(timestamp / 1000);
        let id = uuid.v4();
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

		//console.log('updateFileTransferBubble', metadata.filename, metadata.playing);
	
		const id = metadata.transfer_id;
	
		let renderMessages = this.state.messages;
		let existingMessages = renderMessages[this.state.selectedContact.uri];
	
		if (!existingMessages) {
			return;
		}
	
		let newMessages = existingMessages.map((msg) => {
			if (msg._id !== id) {
				// unchanged message → keep original reference
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
			newMsg.playing = newMsg.metadata.playing;
	
			// handle media previews
			const isAsc = metadata.local_url?.endsWith('.asc');
	
			if (metadata.local_url && !isAsc) {
	
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
	
			//console.log('updated fileTransferBubble', newMsg._id, newMsg.metadata.local_url, newMsg.image);
	
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
        let myContacts = this.state.myContacts;

        if (Object.keys(myContacts).indexOf(uri) === -1 && utils.isPhoneNumber(uri) && uri.indexOf('@') > -1) {
            uri = uri.split('@')[0];
        }

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) > - 1) {
            let msg;

            msg = {
                _id: uuid.v4(),
                text: utils.html2text(content),
                createdAt: timestamp || new Date(),
                direction: direction || 'outgoing',
                sent: true,
                system: system,
                pending: false,
                failed: false,
                user: direction == 'incoming' ? {_id: uri, name: uri} : {}
                }

            renderMessages[uri].push(msg);
            this.setState({renderMessages: renderMessages});
        }
    }

    async saveIncomingMessage(message, decryptedBody=null) {
        console.log('saveIncomingMessage', message.id, 'from', message.sender.uri)
        let myContacts = this.state.myContacts;
        let uri = message.sender.uri;
        if (uri in myContacts) {
            //
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        if (myContacts[uri].tags.indexOf('blocked') > -1) {
            return;
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

		if (message.contentType === 'application/sylk-message-metadata') {
			let metadataContent;
			try {
				metadataContent = JSON.parse(message.content);
				related_action = metadataContent.action;
				related_value = metadataContent.value;
				related_msg_id = metadataContent.messageId;
			} catch (error) {
				console.log('saveIncomingMessage cannot parse payload', error);
			}
			
			console.log('saveIncomingMessage', related_action, related_msg_id, related_value);
			if (related_action == 'consumed') {
				let params = [this.state.accountId, related_action, related_msg_id];
				await this.ExecuteQuery("delete from messages where account = ? and related_action = ? and related_msg_id = ?", params).then((result) => {
					console.log(result.rowsAffected, 'consumed message deleted');
				}).catch((error) => {
					if (error.message.indexOf('UNIQUE constraint failed') === -1) {
						console.log('saveIncomingMessage SQL error:', error);
					}
				});
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
            }
        }

        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, metadata, message.sender.uri, this.state.account.id, "incoming", received, related_action, related_msg_id];
        await this.ExecuteQuery("INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, metadata, from_uri, to_uri, direction, received, related_action, related_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {

			console.log('saveIncomingMessage SQL OK');

            if (!myContacts[uri].name && message.sender.displayName) {
                myContacts[uri].name = message.sender.displayName;
            }

            if (message.timestamp > myContacts[uri].timestamp) {
                myContacts[uri].timestamp = message.timestamp;
            }

			if (unreadCounterTypes.has(message.contentType)) {
				//console.log('Increment unread count for', uri);
				myContacts[uri].unread.push(message.id);
				//console.log('unread messages:', myContacts[uri].unread);
            }

            myContacts[uri].direction = 'incoming';
            myContacts[uri].lastCallDuration = null;
            if (myContacts[uri].tags.indexOf('chat') === -1) {
                myContacts[uri].tags.push('chat');
            }

            if (myContacts[uri].totalMessages) {
                myContacts[uri].totalMessages = myContacts[uri].totalMessages + 1;
            }

            if (message.contentType === 'text/html') {
                content = utils.html2text(content);
            } else if (message.contentType.indexOf('image/') > -1) {
                content = 'Photo';
            } else if (message.contentType === 'application/sylk-file-transfer') {
                try {
                    this.autoDownloadFile(file_transfer);
                } catch (e) {
                    console.log("Error decoding incoming file transfer json sql: ", e);
                }
            }

            if (this.state.selectedContact && this.state.selectedContact.uri === uri) {
                this.confirmRead(uri, 'incoming_message');
            }

            this.saveSylkContact(uri, myContacts[uri], 'saveIncomingMessage');

			this.requestDndPermission();

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
        let unix_timestamp = Math.floor(message.timestamp / 1000);
        let metadata = message.contentType === 'application/sylk-file-transfer' ? message.content : '';
        //console.log('Sync metadata', message.id, message.contentType, metadata, typeof(message.content));
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, metadata, message.sender.uri, this.state.account.id, "incoming", pending, sent, received, message.state];
        //console.log('params', params);

        this.pendingNewSQLMessages.push(params);
        this.remove_sync_pending_item(message.id);

        if (this.pendingNewSQLMessages.length > 24) {
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

    deleteContact(uri) {
        console.log('deleteContact', uri);
        uri = uri.trim().toLowerCase();

        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        //this.deleteSylkContact(uri);

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            this.deleteMessages(uri);
        }
    }

    deletePublicKey(uri) {
        uri = uri.trim().toLowerCase();

        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            myContacts[uri].publicKey = null;
            console.log('Public key of', uri, 'deleted');
            this.saveSylkContact(uri, myContacts[uri], 'deletePublicKey');
        }
    }

    newContact(uri, name=null, data={}) {
        //console.log('Create new contact', uri, name, data.src);
        let current_datetime = new Date();

        if (data.src !== 'init') {
            uri = uri.trim().toLowerCase();
        }

		const els = uri.split('@');
        const username = els[0];
		const isNumber = utils.isPhoneNumber(username);
		const displayName = name || data.name || username;

        let contact = { id: uuid.v4(),
                          uri: uri,
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
                          timestamp: current_datetime
                          }

        contact = this.sanitizeContact(uri, contact, data);
        return contact;
    }

    newSyntheticContact(uri, name=null, data={}) {
        //console.log('Create new syntetic contact', uri, data);

        let contact = { id: uuid.v4(),
                          uri: uri.trim().toLowerCase(),
                          name: name || data.name || '',
                          organization: data.organization || '',
                          unread: [],
                          tags: ['synthetic'],
                          lastCallMedia: [],
                          participants: [],
                          timestamp: new Date()
                          }
        return contact;
    }

    updateTotalUread(myContacts=null) {
        let total_unread = 0;
        myContacts = myContacts || this.state.myContacts;
        const keys = Object.keys(this.state.myContacts);
		for (const key of keys) {
		    const contact = this.state.myContacts[key];
		    if (!contact) {
				continue;
		    }
            total_unread = total_unread + contact.unread.length;
		}

      console.log('Total unread messages', total_unread);

       if (Platform.OS === 'ios') {
           PushNotification.setApplicationIconBadgeNumber(total_unread);
       } else {
            ShortcutBadge.setCount(total_unread);
            //PushNotification.setApplicationIconBadgeNumber(total_unread)
       }
    }

    saveContact(contactObject) {
	 console.log('saveContact', contactObject);
    
     let uri = contactObject.uri;
     let displayName = contactObject.displayName;
     let organization = contactObject.organization;
     let email = contactObject.email;
     let tags = contactObject.tags || [];

        let contact;

        if (uri.indexOf('@') === -1 && !utils.isPhoneNumber(uri)) {
            uri = uri + '@' + this.state.defaultDomain;
        }

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            contact = myContacts[uri];
        } else {
            contact = this.newContact(uri);
            if (!contact) {
                return;
            }
        }

        contact.organization = organization;
        contact.name = displayName;
        contact.uri = uri;
        contact.email = email;
        contact.timestamp = new Date();
        contact.tags = tags;

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

        this.saveSylkContact(uri, contact, 'editContact');

        if (uri === this.state.accountId) {
            this.setState({displayName: displayName, email: email});
            this.signup[this.state.accountId] = email;
            storage.set('signup', this.signup);
            if (this.state.account && displayName !== this.state.account.displayName) {
                this.processRegistration(this.state.accountId, this.state.password, displayName);
            }
        }
    }

    async replicateContact(contact) {
        console.log('Replicate contact', contact.uri);

        if (!this.state.keys) {
            console.log('Cannot replicate contact without a private key');
            return;
        }

        let id = uuid.v4();
        let content;
        let contentType = 'application/sylk-contact-update';
        let new_contact = {}

        new_contact.uri = contact.uri;
        new_contact.name = contact.name;
        new_contact.email = contact.email;
        new_contact.organization = contact.organization;
        new_contact.timestamp = Math.floor(contact.timestamp / 1000);
        new_contact.tags = contact.tags;
        new_contact.participants = contact.participants;

        content = JSON.stringify(new_contact);

        //this.saveOutgoingRawMessage(id, this.state.accountId, this.state.accountId, content, contentType);

        await OpenPGP.encrypt(content, this.state.keys.public).then((encryptedMessage) => {
            this._sendMessage(this.state.accountId, encryptedMessage, id, contentType, contact.timestamp);
        }).catch((error) => {
            console.log('Failed to encrypt contact:', error);
        });
    }

    handleReplicateContact(json_contact) {

        let contact;
        let new_contact;

        try {
            contact = JSON.parse(json_contact);
        } catch (e) {
            console.log("Failed to parse contact json: ", e);
            return;
        }

        if (contact.uri === null) {
            return;
        }

        if (contact.uri === this.state.accountId) {
            this.setState({displayName: contact.name, organization: contact.organization, email: contact.email});
            this.signup[this.state.accountId] = contact.email;
            storage.set('signup', this.signup);
        }

        let uri = contact.uri;
        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
            new_contact = myContacts[uri];
            //
        } else {
            new_contact = this.newContact(uri, contact.name);
            if (!new_contact) {
                return;
            }
        }

        new_contact.uri = uri;
        new_contact.name = contact.name;
        new_contact.email = contact.email;
        new_contact.organization = contact.organization;
        new_contact.timestamp = new Date(contact.timestamp * 1000);
        new_contact.tags = contact.tags;
        new_contact.participants = contact.participants;

        this.saveSylkContact(uri, new_contact, 'handleReplicateContact');
    }

    async handleReplicateContactSync(json_contact, id, msg_timestamp) {
        let purgeMessages = this.state.purgeMessages;

        let contact;
        try {
            contact = JSON.parse(json_contact);
        } catch (e) {
            console.log("Failed to parse contact json: ", e);
            return;
        }

        let timestamp = msg_timestamp;

        let uri = contact.uri;

        if (contact.uri === this.state.accountId) {
            this.setState({displayName: contact.name, organization: contact.organization, email: contact.email});
            this.signup[this.state.accountId] = contact.email;
            storage.set('signup', this.signup);
        }

        if (contact.timestamp) {
            timestamp = new Date(contact.timestamp * 1000);
        }

        let replicateContacts = this.state.replicateContacts;

        if (uri in replicateContacts) {
            if (timestamp < replicateContacts[uri].timestamp) {
                purgeMessages.push(id);
                this.setState({purgeMessages: purgeMessages});
                //console.log('Sync replicate contact skipped because is too old', timestamp, uri);
                return;
            } else {
                purgeMessages.push(replicateContacts[uri].msg_id);
                this.setState({purgeMessages: purgeMessages});
                //console.log('Sync replicate contact is newer', timestamp, 'than', replicateContacts[uri].timestamp, 'remove previous one', replicateContacts[uri].msg_id);
            }
            //
        } else {
            let new_contact = this.newContact(uri, contact.name);
            if (!new_contact) {
                this.remove_sync_pending_item(id);
                purgeMessages.push(id);
                this.setState({purgeMessages: purgeMessages});
                return;
            }
            replicateContacts[uri] = new_contact;
        }

        console.log('Sync replicate contact', uri);

        replicateContacts[uri].uri = uri;
        replicateContacts[uri].msg_id = id;
        replicateContacts[uri].name = contact.name;
        replicateContacts[uri].email = contact.email;
        replicateContacts[uri].timestamp = timestamp;
        replicateContacts[uri].organization = contact.organization;
        replicateContacts[uri].tags = contact.tags;
        replicateContacts[uri].participants = contact.participants;

        //console.log('Adding replicated contact', replicateContacts[uri]);

        this.setState({replicateContacts: replicateContacts});
        this.remove_sync_pending_item(id);
    }

    sanitizeContact(uri, contact, data={}) {
        //console.log('sanitizeContact', uri, contact);

        let idx;

        if (!uri || uri === '') {
            return null;
        }

        if (data.src !== 'init') {
            uri = uri.trim().toLowerCase();
        }

        let domain;
        let els = uri.split('@');
        let username = els[0];

        let isNumber = utils.isPhoneNumber(username);

        let uuidPattern = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/gi;
        let isUUID = uri.match(uuidPattern);

        if (!isUUID && !isNumber && !utils.isEmailAddress(uri) && username !== '*') {
            console.log('Sanitize check failed for uri:', uri);
            return null;
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
            contact.timestamp = new Date();
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

    toggleFavorite(uri) {
        //console.log('toggleFavorite', uri);
        let favoriteUris = this.state.favoriteUris;
        let myContacts = this.state.myContacts;
        let selectedContact;
        let favorite;

        if (uri in myContacts) {
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        idx = myContacts[uri].tags.indexOf('favorite');
        if (idx > -1) {
            myContacts[uri].tags.splice(idx, 1);
            favorite = false;
        } else {
            myContacts[uri].tags.push('favorite');
            favorite = true;
        }

        myContacts[uri].timestamp = new Date();

        this.saveSylkContact(uri, myContacts[uri], 'toggleFavorite');

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

    toggleAutoanswer(uri) {
        console.log('toggleAutoanswer', uri);
        let autoanswerUris = this.state.autoanswerUris;
        let myContacts = this.state.myContacts;
        let selectedContact;
        let autoanswer;

        if (uri in myContacts) {
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        idx = myContacts[uri].tags.indexOf('autoanswer');
        if (idx > -1) {
            myContacts[uri].tags.splice(idx, 1);
            autoanswer = false;
        } else {
            myContacts[uri].tags.push('autoanswer');
            autoanswer = true;
        }

        myContacts[uri].timestamp = new Date();

        this.saveSylkContact(uri, myContacts[uri], 'toggleAutoanswer');

        let idx = autoanswerUris.indexOf(uri);
        if (idx === -1 && autoanswer) {
            autoanswerUris.push(uri);
            console.log(uri, 'is favorite');
        } else if (idx > -1 && !autoanswer) {
            autoanswerUris.splice(idx, 1);
            console.log(uri, 'is not autoanswer');
        }

        this.setState({autoanswerUris: autoanswerUris});        
    }

    toggleBlocked(uri) {
        let blockedUris = this.state.blockedUris;
        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        let blocked;

        idx = myContacts[uri].tags.indexOf('blocked');
        if (idx > -1) {
            myContacts[uri].tags.splice(idx, 1);
            blocked = false;
        } else {
            myContacts[uri].tags.push('blocked');
            blocked = true;
        }

        myContacts[uri].timestamp = new Date();
        this.saveSylkContact(uri, myContacts[uri], 'toggleBlocked');

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

    forwardMessage(message, uri) {
        console.log('forwardMessage', uri, message);
        // this will show the main interface to select one or more contacts
        
        this.setState({shareToContacts: true,
                       forwardContent: message,
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
    
     fetchSharedItemsAndroid(source) {
        console.log('Fetch shared items', source);
        ReceiveSharingIntent.getReceivedFiles(files => {
            // files returns as JSON Array example
            //[{ filePath: null, text: null, weblink: null, mimeType: null, contentUri: null, fileName: null, extension: null }]
                if (files.length > 0) {
                    this.sharedAndroidFiles = files;
                    console.log('Android share', files.length, 'items');

                    this.setState({shareToContacts: true,
                                   shareContent: files,
                                   selectedContact: null});

                    let item = files[0];
                    let what = 'Share text with contacts';

                    if (item.weblink) {
                        what = 'Share web link with contacts';
                    }

                    if (item.filePath) {
                        what = 'Share file with contacts';
                    }

                    this._notificationCenter.postSystemNotification(what);
                } else {
                    //console.log('Nothing to share');
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

        let shareContent = this.state.shareContent;
        let selectedContacts = this.state.selectedContacts;
        let message = this.state.forwardContent;

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
        let contentType = 'text/plain';

        let msg = {
            text: content,
            createdAt: new Date(),
            direction: 'outgoing',
            user: {}
            }

        if (this.state.forwardContent) {
            console.log('Forwarding content...');
            msg.text = message.text;

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
                if (msg.metadata && msg.metadata.receiver) {
                    msg.metadata.receiver.uri = uri;
                    msg.metadata.transfer_id = id;
                }
                await this.sendMessage(uri, msg, contentType);
            }

        } else {
            console.log('Sharing content...');

            if (shareContent.length === 0) {
                return;
            }

            if (selectedContacts.length === 0) {
                this._notificationCenter.postSystemNotification('Sharing canceled');
                return;
            }

            let item;
            let basename;
            let localPath;
            let dirname;
            let file_transfer;

            while (j < shareContent.length) {
                item = shareContent[j];
                j++;

                //console.log('Sharing item', item);

                if (item.subject) {
                    content = content + '\n\n' + item.subject;
                }

                if (item.text) {
                    content = content + '\n\n' + item.text;
                }

                if (item.weblink) {
                    content = content + '\n\n' + item.weblink;
                }

                if (item.filePath) {
                    contentType = 'application/sylk-file-transfer';
                    file_transfer = { 'path': item.filePath,
                                      'filename': item.fileName,
                                      'filetype' : item.mimeType,
                                      'sender': {'uri': this.state.accountId},
                                      'receiver': {'uri': null},
                                      'direction': 'outgoing'
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

    setFullScreen(state) {
        //console.log('fullScreen', state);
		this.setState({fullScreen: state});
    }

    endShareContent() {
        console.log('endShareContent');
        let newSelectedContact = this.state.sourceContact;

        if (this.state.selectedContacts.length === 1 && ! newSelectedContact) {
            let uri = this.state.selectedContacts[0];
            if (uri in this.state.myContacts) {
                newSelectedContact = this.state.myContacts[uri];
            }
        }

        //console.log('Switch to contact', newSelectedContact);
        this.setState({shareContent: [],
                       selectedContacts: [],
                       selectedContact: newSelectedContact,
                       forwardContent: null,
                       sourceContact: null,
                       shareToContacts: false});

        if (Platform.OS === "android") {
            //ReceiveSharingIntent.clearReceivedFiles();
        }
    }

    filterHistory(filter) {
        //console.log('Filter history', filter);
        this.setState({historyFilter: filter});
    }

    saveConference(room, participants, displayName=null) {
        let uri = room;
        console.log('Save conference', room, 'with display name', displayName, 'and participants', participants);

        let myContacts = this.state.myContacts;

        if (uri in myContacts) {
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        myContacts[uri].timestamp = new Date();
        myContacts[uri].name = displayName;

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

        myContacts[uri].participants = new_participants;
        this.saveSylkContact(uri, myContacts[uri], 'saveConference');
    }

    addHistoryEntry(uri, callUUID, direction='outgoing', participants=[]) {
        let myContacts = this.state.myContacts;
        
        if (this.state.rejectNonContacts && direction == 'incoming') {
            if (!(uri in this.state.myContacts)) {
				console.log('skip history entry from unknown address', uri);                
				return;
            }
        }

        //console.log('addHistoryEntry', uri);

        if (uri.indexOf('@') === -1) {
            uri = uri + '@videoconference.' + this.state.defaultDomain;
        }

        if (uri in myContacts) {
        } else {
            myContacts[uri] = this.newContact(uri);
        }

        myContacts[uri].conference = true;
        myContacts[uri].timestamp = new Date();
        myContacts[uri].lastCallId = callUUID;
        myContacts[uri].direction = direction;
        this.saveSylkContact(uri, myContacts[uri], 'addHistoryEntry');
    }

    updateHistoryEntry(uri, callUUID, duration) {
        if (uri.indexOf('@') === -1) {
            uri = uri + '@videoconference.' + this.state.defaultDomain;
        }

        let myContacts = this.state.myContacts;
        if (uri in myContacts && myContacts[uri].lastCallId === callUUID) {
            console.log('updateHistoryEntry', uri, callUUID, duration);
            myContacts[uri].timestamp = new Date();
            myContacts[uri].lastCallDuration = duration;
            myContacts[uri].lastCallId = callUUID;
			if (myContacts[uri].tags.indexOf('calls') === -1) {
				myContacts[uri].tags.push('calls');
			}
            this.saveSylkContact(uri, myContacts[uri], 'updateHistoryEntry');
        }
    }

    render() {
        let footerBox = <View style={styles.footer}><FooterBox /></View>;

		let extraStyles = {paddingBottom: 0};
        
        if (Platform.OS === 'android') {
            /*
			Android 11	30
			Android 12	31-32
			Android 13	33
			Android 14	34
            */

            if (!this.state.keyboardVisible && Platform.Version >= 34) {
				extraStyles = {paddingBottom: 48};
			}
        }

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
        }

        let loadingLabel = this.state.loading;
        if (this.state.syncConversations) {
            //loadingLabel = 'Sync conversations';

        } else if (this.state.reconnectingCall) {
            loadingLabel = 'Reconnecting call...';
        } else if (this.signOut) {
            loadingLabel = 'Signing out...';
        }

        return (
            <PaperProvider theme={theme}>
                <Router history={history} ref="router">
                    <ImageBackground source={backgroundImage} style={{width: '100%', height: '100%'}}>
                                <View style={mainStyle.MainContainer} onLayout={(event) => this.setState({
                                                                        Width_Layout : event.nativeEvent.layout.width,
                                                                        Height_Layout : event.nativeEvent.layout.height
                                                                        }, ()=> this._detectOrientation())}>
                        <SafeAreaView style={[styles.root, extraStyles]} edges={this.state.fullScreen ? [] : ['top', 'bottom']}>
                            { Platform.OS === 'android' ?
                            <IncomingCallModal
                                contact={this.state.incomingContact}
                                media={this.state.incomingMedia}
                                CallUUID={this.state.incomingCallUUID}
                                onAccept={this.callKeepAcceptCall}
                                onReject={this.callKeepRejectCall}
                                onHide={this.dismissCall}
                                orientation={this.state.orientation}
                                isTablet={this.state.isTablet}
                                playIncomingRingtone = {this.playIncomingRingtone}
                            />
                            : null}

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
                            show={loadingLabel ? true : false}
                            orientation={this.state.orientation}
                            isTablet={this.state.isTablet}
                            />

                            <Switch>
                                <Route exact path="/" component={this.main} />
                                <Route exact path="/login" component={this.login} />
                                <Route exact path="/logout" component={this.logout} />
                                <Route exact path="/ready" component={this.ready} />
                                <Route exact path="/call" component={this.call} />
                                <Route exact path="/conference" component={this.conference} />
                                <Route exact path="/preview" component={this.preview} />
                                <Route component={this.notFound} />
                            </Switch>

                            <NotificationCenter ref="notificationCenter" />

                        </SafeAreaView>
                        </View>
                    </ImageBackground>
                </Router>
            </PaperProvider>
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
        let myContacts = this.state.myContacts;
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

			if (this.state.rejectNonContacts && item.direction == 'incoming') {
				if (!(uri in this.state.myContacts) && !item.duration) {
					//console.log('Skip server history entry from unknown address', uri);                
					//return;
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

            if (!(uri in myContacts)) {
				return;
            }

			contact = myContacts[uri];

            if (item.timestamp > myContacts[uri].timestamp) {
                myContacts[uri].timestamp = item.timestamp;
                must_save = true;

            } else {
                if (myContacts[uri].lastCallId === item.sessionId) {
                    return;
                } else {
                    must_save = true;
                }
            }

            tags = myContacts[uri].tags;

            if (tags.indexOf('missed') > - 1) {
                tags.push('missed');
                //console.log('Increment unread count for', uri);
                myContacts[uri].unread.push(item.sessionId);
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

            if (item.displayName && !myContacts[uri].name) {
                myContacts[uri].name = item.displayName;
                must_save = true;
            }

            myContacts[uri].direction = item.direction;
            myContacts[uri].lastCallId = item.sessionId;
            myContacts[uri].lastCallDuration = item.duration;
            myContacts[uri].lastCallMedia = item.media;
            myContacts[uri].conference = item.conference;

            if (tags !== myContacts[uri].tags) {
                must_save = true;
            }

            myContacts[uri].tags = tags;
            i = i + 1;

            if (must_save) {
                this.saveSylkContact(uri, this.state.myContacts[uri], 'saveHistory');
            }
         });

         this.setState({missedCalls: missedCalls});
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
        let call = this.state.currentCall || this.state.incomingCall;

        if (this.state.selectedContact) {
            const uri = this.state.selectedContact.uri;
            if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey) {
                publicKey = this.state.myContacts[uri].publicKey;
            }
        } else {
            publicKey = this.state.keys ? this.state.keys.public: null;
        }
        
        const messagesMetadata = (this.state.selectedContact && this.state.selectedContact.uri in this.state.myContacts) ? this.state.myContacts[this.state.selectedContact.uri].messagesMetadata : {};
        
        return (
            <Fragment>
               { !this.state.fullScreen ?
                <NavigationBar
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
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
                    connection = {this.state.connection}
                    registrationState = {this.state.registrationState}
                    orientation = {this.state.orientation}
                    isTablet = {this.state.isTablet}
                    displayName = {this.state.displayName}
                    myDisplayName = {this.state.displayName}
                    myPhoneNumber = {this.state.myPhoneNumber}
                    organization = {this.state.organization}
                    selectedContact = {this.state.selectedContact}
                    messages = {this.state.messages}
                    exportKey = {this.exportPrivateKey}
                    publicKey = {publicKey}
                    deleteMessages = {this.deleteMessages}
                    deleteFiles = {this.deleteFiles}
                    toggleFavorite = {this.toggleFavorite}
                    toggleAutoanswer = {this.toggleAutoanswer}
                    toggleBlocked = {this.toggleBlocked}
                    saveConference={this.saveConference}
                    defaultDomain = {this.state.defaultDomain}
                    favoriteUris = {this.state.favoriteUris}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    saveContact = {this.saveContact}
                    deleteContact = {this.deleteContact}
                    removeContact = {this.removeContact}
                    sendPublicKey = {this.sendPublicKeyToUri}
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
                    refetchMessages = {this.refetchMessagesForContact}
                    blockedUris = {this.state.blockedUris}
                    myuuid={this.state.myuuid}
                    filteredMessageIds = {this.state.filteredMessageIds}
                    resumeTransfers = {this.resumeTransfers}
                    contentTypes = {this.state.contentTypes}
                    canSend = {this.canSend}
                    sharingAction = {this.sharingAction}
                    toggleDnd = {this.toggleDnd}
                    toggleRejectAnonymous = {this.toggleRejectAnonymous}
                    rejectAnonymous = {this.state.rejectAnonymous}
                    toggleChatSounds = {this.toggleChatSounds}
                    chatSounds = {this.state.chatSounds}
                    toggleRejectNonContacts = {this.toggleRejectNonContacts}
                    rejectNonContacts = {this.state.rejectNonContacts}
                    dnd = {this.state.dnd}
                    buildId = {this.buildId}
                    getTransferedFiles = {this.getTransferedFiles}
                    transferedFiles = {this.state.transferedFiles}
                    toggleSearchMessages = {this.toggleSearchMessages}
                    toggleSearchContacts = {this.toggleSearchContacts}
                    searchMessages = {this.state.searchMessages}
                    searchContacts = {this.state.searchContacts}
                    searchString = {this.state.searchString}
                    isLandscape = {this.state.orientation === 'landscape'}
                    serverSettingsUrl = {this.state.serverSettingsUrl}
                    publicUrl = {this.state.publicUrl}
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
                    missedTargetUri = {this.state.missedTargetUri}
                    orientation = {this.state.orientation}
                    contacts = {this.state.contacts}
                    isTablet = {this.state.isTablet}
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
                    saveContact = {this.saveContact}
                    myContacts = {this.state.myContacts}
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
                    downloadFile = {this.downloadFile}
                    uploadFile = {this.uploadFile}
                    decryptFunc = {this.decryptFile}
                    isTexting = {this.state.isTexting}
                    keyboardVisible = {this.state.keyboardVisible}
                    contentTypes = {this.state.contentTypes}
                    canSend = {this.canSend}
                    forwardMessageFunc = {this.forwardMessage}
                    sourceContact = {this.state.sourceContact}
                    requestCameraPermission = {this.requestCameraPermission}
                    requestDndPermission = {this.requestDndPermission}
                    requestMicPermission = {this.requestMicPermission}
                    requestStoragePermission = {this.requestStoragePermission}
                    postSystemNotification = {this.postSystemNotification}
                    sortBy = {this.state.sortBy}
                    toggleSearchMessages = {this.toggleSearchMessages}
                    searchMessages = {this.state.searchMessages}
                    searchContacts = {this.state.searchContacts}
                    defaultConferenceDomain = {this.state.defaultConferenceDomain}
                    dark = {this.state.dark}
                    messagesMetadata = {messagesMetadata}
                    file2GiftedChat = {this.file2GiftedChat}
					contactStartShare = {this.contactStartShare}
					contactStopShare = {this.contactStopShare}
					contactIsSharing ={this.state.contactIsSharing}
					fullScreen = {this.state.fullScreen}
					setFullScreen = {this.setFullScreen}
					transferProgress = {this.state.transferProgress}
					sendDispositionNotification = {this.sendDispositionNotification}
					totalMessageExceeded = {this.state.totalMessageExceeded}
					createChatContact = {this.createChatContact}
					selectAudioDevice = {this.selectAudioDevice}
					updateFileMetadata = {this.updateFileMetadata}
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
        let call = this.state.currentCall || this.state.incomingCall;
        let callState;

        if (call && call.id in this.state.callsState) {
            callState = this.state.callsState[call.id];
        }

        if (this.state.targetUri in this.state.myContacts && !this.state.callContact) {
            let callContact = this.state.myContacts[this.state.targetUri];
            this.setState({callContact: callContact});
        }
        
        const videoMuted = this.state.incomingCall && Platform.OS === 'ios';

        return (
            <Call
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                call = {call}
                callContact = {this.state.callContact}
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
                contacts = {this.state.contacts}
                intercomDtmfTone = {this.intercomDtmfTone}
                orientation = {this.state.orientation}
                isTablet = {this.state.isTablet}
                reconnectingCall = {this.state.reconnectingCall}
                muted = {this.state.muted}
                myContacts = {this.state.myContacts}
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

        let call = this.state.currentCall || this.state.incomingCall;
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
                myContacts = {this.state.myContacts}
                lookupContacts={this.lookupContacts}
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

    lookupContacts(text) {
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
        let registerBox;
        let statusBox;
        this.signOut = false;

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

    logout() {
        console.log('Logout');
        this.signOut = true;
        this.signIn = false;

        this.syncRequested = false;
        this.callKeeper.setAvailable(false);
        this.sql_contacts_keys = [];

        storage.set('account', {accountId: this.state.accountId,
                                password: this.state.password,
                                verified: false
                                });

		this.saveSqlAccount(this.state.accountId, 0);

        this.setState({loading: null,
                       keyStatus: {},
                       contactsLoaded: false,
                       registrationState: null,
                       registrationKeepalive: false,
                       keyDifferentOnServer: false,
                       status: null,
                       keys: null,
                       lastSyncId: null,
                       accountVerified: false,
                       myContacts: {},
                       purgeMessages: [],
                       updateContactUris: {},
                       replicateContacts: {},
                       deletedContacts: {}
                       });

        this.changeRoute('/login', 'user logout');

        if (!this.signOut && this.state.registrationState !== null && this.state.connection && this.state.connection.state === 'ready') {
            // remove token from server
            console.log('Remove push token');
            this.state.account.setDeviceToken('None', Platform.OS, deviceId, this.state.dnd, bundleId);
            console.log('Unregister');
            this.state.account.register();
            return;
        } else if (this.signOut && this.state.connection && this.state.account) {
            console.log('Unregister');
            this.state.account.unregister();
        }

        if (this.state.connection && this.state.account) {
            console.log('Remove account');
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    logger.debug(error);
                }
            });
        }

        this.setState({account: null,
                       displayName: '',
                       email: ''
                       });

        this.signOut = false;
        return null;
    }

    main() {
        return null;
    }
}

export default Sylk;
