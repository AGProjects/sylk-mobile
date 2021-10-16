// copyright AG Projects 2020-2021

import React, { Component, Fragment } from 'react';
import { Alert, View, SafeAreaView, ImageBackground, AppState, Linking, Platform, StyleSheet, Vibration, PermissionsAndroid} from 'react-native';
import { DeviceEventEmitter, BackHandler } from 'react-native';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { registerGlobals } from 'react-native-webrtc';
import { Router, Route, Link, Switch } from 'react-router-native';
import history from './history';
import Logger from "../Logger";
import autoBind from 'auto-bind';
import { firebase } from '@react-native-firebase/messaging';
import VoipPushNotification from 'react-native-voip-push-notification';
import uuid from 'react-native-uuid';
import { getUniqueId, getBundleId, isTablet, getPhoneNumber} from 'react-native-device-info';
import RNDrawOverlay from 'react-native-draw-overlay';
import PushNotificationIOS from "@react-native-community/push-notification-ios";
import PushNotification , {Importance} from "react-native-push-notification";
import Contacts from 'react-native-contacts';
import BackgroundTimer from 'react-native-background-timer';
import DeepLinking from 'react-native-deep-linking';
import base64 from 'react-native-base64';
import SoundPlayer from 'react-native-sound-player';
import RNSimpleCrypto from "react-native-simple-crypto";
import OpenPGP from "react-native-fast-openpgp";
import ShortcutBadge from 'react-native-shortcut-badge';
import { getAppstoreAppMetadata } from "react-native-appstore-version-checker";
//import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
import {Keyboard} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNBackgroundDownloader from 'react-native-background-downloader';

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
import IncomingCallModal from './components/IncomingCallModal';
import LogsModal from './components/LogsModal';
import NotificationCenter from './components/NotificationCenter';
import LoadingScreen from './components/LoadingScreen';
import NavigationBar from './components/NavigationBar';
import Preview from './components/Preview';
import CallManager from './CallManager';
import SQLite from 'react-native-sqlite-storage';
//SQLite.DEBUG(true);
SQLite.enablePromise(true);

import xtype from 'xtypejs';
import xss from 'xss';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import momenttz from 'moment-timezone';
import utils from './utils';
import config from './config';
import storage from './storage';
var randomString = require('random-string');

const RNFS = require('react-native-fs');
const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

const logger = new Logger("App");

function checkIosPermissions() {
    return new Promise(resolve => PushNotificationIOS.checkPermissions(resolve));
  }

const KeyOptions = {
  cipher: "aes256",
  compression: "zlib",
  hash: "sha512",
  RSABits: 4096,
  compressionLevel: 5
}


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
const MAX_LOG_LINES = 300;


if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    //bundleId = 'com.agprojects.sylk-ios.dev';
}

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


class Sylk extends Component {
    constructor() {
        super();
        autoBind(this)
        this._loaded = false;
        let isFocus = Platform.OS === 'ios';

        this._initialState = {
            appState: null,
            autoLogin: true,
            inFocus: isFocus,
            accountId: '',
            password: '',
            displayName: '',
            fontScale: 1,
            email: '',
            organization: '',
            account: null,
            lastSyncId: null,
            accountVerified: false,
            registrationState: null,
            registrationKeepalive: false,
            incomingCall: null,
            currentCall: null,
            connection: null,
            showIncomingModal: false,
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
            Height_Layout : '',
            Width_Layout : '',
            outgoingCallUUID: null,
            incomingCallUUID: null,
            hardware: '',
            phoneNumber: '',
            isTablet: isTablet(),
            refreshHistory: false,
            refreshFavorites: false,
            myPhoneNumber: null,
            favoriteUris: [],
            blockedUris: [],
            missedCalls: [],
            initialUrl: null,
            reconnectingCall: false,
            muted: false,
            participantsToInvite: [],
            myInvitedParties: {},
            myContacts: {},
            defaultDomain: config.defaultDomain,
            fileSharingUrl: config.fileSharingUrl,
            declineReason: null,
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
            showExportPrivateKeyModal: false,
            serverQueriedForPublicKey: false,
            navigationItems: {today: false,
                              yesterday: false,
                              conference: false}
        };

        utils.timestampedLog('Init app');

        this.pendingNewSQLMessages = [];
        this.newSyncMessagesCount = 0;
        this.syncStartTimestamp = null;

        this.syncRequested = false;
        this.mustSendPublicKey = false;
        this.conferenceEndedTimer = null;

        this.syncTimer = null;
        this.lastSyncedMessageId = null;
        this.outgoingMedia = null;
        this.participantsToInvite = [];
        this.tokenSent = false;
        this.mustLogout = false;
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

        this.sync_pending_items = [];
        this.signup = {};
        this.last_signup = null;

        this.state = Object.assign({}, this._initialState);

        this.myParticipants = {};
        this.mySyncJournal = {};

        this._historyConferenceParticipants = new Map(); // for saving to local history

        this._terminatedCalls = new Map();

        this.__notificationCenter = null;

        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.goToReadyTimer = null;
        this.msg_sound_played_ts = null;
        this.initialChatContact = null;
        this.serverPublicKey = null;

        storage.initialize();
        this.callKeeper = new CallManager(RNCallKeep,
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
            InCallManager.requestRecordPermission()
            .then((requestedRecordPermissionResult) => {
                //console.log("InCallManager.requestRecordPermission() requestedRecordPermissionResult: ", requestedRecordPermissionResult);
            })
            .catch((err) => {
                //console.log("InCallManager.requestRecordPermission() catch: ", err);
            });
        }

        // Load camera/mic preferences
        storage.get('devices').then((devices) => {
            if (devices) {
                this.setState({devices: devices});
            }
        });

        storage.get('account').then((account) => {
            if (account) {
                this.setState({accountVerified: account.verified});
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
            utils.timestampedLog('Proximity sensor enabled');
        } else {
            utils.timestampedLog('Proximity sensor disabled');
        }

        this.loadPeople();

        for (let scheme of URL_SCHEMES) {
            DeepLinking.addScheme(scheme);
        }

        this.sqlTableVersions = {'messages': 8,
                                 'contacts': 7,
                                 'keys': 2}

        this.updateTableQueries = {'messages': {1: [],
                                                2: [{query: 'delete from messages', params: []}],
                                                3: [{query: 'alter table messages add column unix_timestamp INTEGER default 0', params: []}],
                                                4: [{query: 'alter table messages add column account TEXT', params: []}],
                                                5: [{query: 'update messages set account = from_uri where direction = ?' , params: ['outgoing']}, {query: 'update messages set account = to_uri where direction = ?', params: ['incoming']}],
                                                6: [{query: 'alter table messages add column sender TEXT' , params: []}],
                                                7: [{query: 'alter table messages add column image TEXT' , params: []}, {query: 'alter table messages add column local_url TEXT' , params: []}],
                                                8: [{query: 'alter table messages add column metadata TEXT' , params: []}]
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
                                   'keys': {2: [{query: 'alter table keys add column last_sync_id TEXT', params: []}]}
                                   };

        this.db = null;
        this.initSQL();

    }

    async requestStoragePermission() {
        if (Platform.OS !== 'android') {
            return;
        }

        console.log('Request storage permission');

        try {
          const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
          await PermissionsAndroid.request(permission);
          Promise.resolve();
        } catch (error) {
          Promise.reject(error);
        }
    }

    async requestCameraPermission() {
        if (Platform.OS !== 'android') {
            return;
        }
        //console.log('Request camera permission');

        try {
            const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
                {
                title: "Sylk camera permission",
                message:
                  "Sylk needs access to your camera " +
                  "so you can have video chat.",
                buttonNeutral: "Ask Me Later",
                buttonNegative: "Cancel",
                buttonPositive: "OK"
                }
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                //console.log("You can use the camera");
            } else {
                console.log("Camera permission denied");
            }
        } catch (err) {
            console.warn(err);
        }
    }

    async requestMicPermission() {
        if (Platform.OS !== 'android') {
            return;
        }
        //console.log('Request mic permission');

        try {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              {
                title: "Sylk microphone permission",
                message:
                  "Sylk needs access to your microphone " +
                  "so you can have audio calls.",
                buttonNeutral: "Ask Me Later",
                buttonNegative: "Cancel",
                buttonPositive: "OK"
              }
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                //console.log("You can now use the microphone");
            } else {
                console.log("Microphone permission denied");
            }
        } catch (err) {
            console.warn(err);
        }
    };


    async saveMyKey(keys) {
        this.setState({keys: {private: keys.private,
                              public: keys.public}});

        let myContacts = this.state.myContacts;

        if (this.state.account) {
            this.state.account.syncConversations();
            var uri = uuid.v4() + '@' + this.state.defaultDomain;
            console.log('Send 1st public to', uri);
            this.sendPublicKey(uri);

            let accountId = this.state.account.id;

            if (accountId in myContacts) {
            } else {
                myContacts[accountId] = this.newContact(accountId);
            }

            myContacts[accountId].publicKey = keys.public;
            this.saveSylkContact(accountId, myContacts[accountId], 'PGP key generated');

        } else {
            console.log('Send 1st public key later');
            this.mustSendPublicKey = true;
        }

        let current_datetime = new Date();
        const unixTime = Math.floor(current_datetime / 1000);
        let params = [this.state.accountId, keys.private, keys.public, unixTime];
        await this.ExecuteQuery("INSERT INTO keys (account, private_key, public_key, timestamp) VALUES (?, ?, ?, ?)", params).then((result) => {
            console.log('SQL inserted private key');
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') > -1) {
                this.updateKeySql(keys);
            } else {
                console.log('Save keys SQL error:', error);
            }
        });
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
            console.log('SQL saved last sync id', id);
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
        }).catch((error) => {
            console.log('SQL error:', error);
        });
    }

    loadMyKeys() {
        console.log('Loading PGP keys...');
        let keys = {};
        let lastSyncId;

        this.ExecuteQuery("SELECT * FROM keys where account = ?",[this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                keys.public = item.public_key;
                if (this.serverPublicKey === item.public_key) {
                    this.setState({showImportPrivateKeyModal: false});
                }
                keys.private = item.private_key;
                console.log('Loaded PGP private key for account', this.state.accountId);
                if (!item.last_sync_id && this.lastSyncedMessageId) {
                    this.setState({keys: keys});
                    this.saveLastSyncId(this.lastSyncedMessageId);
                    console.log('Migrated last sync id to SQL database');
                    storage.remove('lastSyncedMessageId');
                    lastSyncId = this.lastSyncedMessageId;
                } else {
                    if (item.last_sync_id) {
                        console.log('Loaded last sync id', item.last_sync_id);
                    }
                    this.setState({keys: keys, lastSyncId: item.last_sync_id});
                    lastSyncId = item.last_sync_id;
                }

                if (this.state.registrationState ==='registered' && !this.syncRequested) {
                    this.syncRequested = true;
                    console.log('Request sync messages from server', lastSyncId);
                    this.state.account.syncConversations(lastSyncId);
                }

            } else {
                if (this.state.account) {
                    this.generateKeysIfNecessary(this.state.account);
                } else {
                    console.log('Wait for account become active...');
                }
            }
        });

        this.setState({contactsLoaded: true});
        this.getDownloadTasks();
    }

    async getDownloadTasks() {
        let lostTasks = await RNBackgroundDownloader.checkForExistingDownloads();
        //console.log('Download lost tasks', lostTasks);
        for (let task of lostTasks) {
            console.log(`Download task ${task.id} was found:`, task.url);
            task.progress((percent) => {
                console.log(task.url, `Downloaded: ${percent * 100}%`);
            }).done(() => {
                this.updateFileDownload(id, task.url, task.destination);
            }).error((error) => {
                console.log(task.url, 'download error:', error);
            });
        }
    }

    async generateKeys() {
        const Options = {
          comment: 'Sylk key',
          email: this.state.accountId,
          name: this.state.displayName || this.state.accountId,
          keyOptions: KeyOptions
        }

        console.log('Generating key pair with options', Options);
        this.setState({loading: 'Generating private key...', generatingKey: true});

        await OpenPGP.generate(Options).then((keys) => {
            const public_key = keys.publicKey.replace(/\r/g, '').trim();
            const private_key = keys.privateKey.replace(/\r/g, '').trim();
            keys.public = public_key;
            keys.private = private_key;
            console.log("PGP keypair generated");
            this.setState({loading: null, generatingKey: false});
            this.setState({showImportPrivateKeyModal: false});
            this.saveMyKey(keys);
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

    loadSylkContacts() {
        console.log('Loading contacts...')
        let myContacts = {};
        let blockedUris = [];
        let favoriteUris = [];
        let missedCalls = [];
        let myInvitedParties = {};
        let localTime;
        let email;
        let contact;
        let timestamp;

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
                    myContacts[item.uri].lastMessageId = item.last_message_id === '' ? null : item.last_message_id;
                    myContacts[item.uri].lastMessage = item.last_message === '' ? null : item.last_message;
                    myContacts[item.uri].timestamp = timestamp;
                    myContacts[item.uri].lastCallId = item.last_call_id;
                    myContacts[item.uri].lastCallMedia = item.last_call_media ? item.last_call_media.split(',') : [];
                    myContacts[item.uri].lastCallDuration = item.last_call_duration;

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

                    if (!myContacts[item.uri].photo) {
                        var name_idx = myContacts[item.uri].name.trim().toLowerCase();
                        if (name_idx in this.state.avatarPhotos) {
                            myContacts[item.uri].photo = this.state.avatarPhotos[name_idx];
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
                    //console.log('Loaded contact', formatted_date, item.uri, item.name);

                    if(item.participants) {
                        myInvitedParties[item.uri.split('@')[0]] = myContacts[item.uri].participants;
                    }

                    if (myContacts[item.uri].tags.indexOf('blocked') > -1) {
                        blockedUris.push(item.uri);
                    }

                    if (myContacts[item.uri].tags.indexOf('favorite') > -1) {
                        favoriteUris.push(item.uri);
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
                                myContacts[item.remoteParty] = this.newContact(item.remoteParty);
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
                                myContacts[item.remoteParty] = this.newContact(item.remoteParty);
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

                this.updateTotalUread(myContacts);

                console.log('Loaded', rows.length, 'contacts for account', this.state.accountId);
                this.setState({myContacts: myContacts,
                               missedCalls: missedCalls,
                               favoriteUris: favoriteUris,
                               myInvitedParties: myInvitedParties,
                               blockedUris: blockedUris});

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
                if (this.initialChatContact) {
                    console.log('Starting chat with', this.initialChatContact);
                    if (this.initialChatContact in this.state.myContacts) {
                        this.selectContact(this.state.myContacts[this.initialChatContact]);
                    }
                    this.initialChatContact = null;
                }
            }, 100);


            setTimeout(() => {
                //this.getMessages();
            }, 500);

            this.loadMyKeys();
        });

    }

    addTestContacts() {
        let myContacts = this.state.myContacts;

        let test_numbers = [
                            {uri: '4444@sylk.link', name: 'Test microphone'},
                            {uri: '3333@sylk.link', name: 'Test video'}
                            ];

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
                        //console.log('My favorites:', favoriteUris);
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
            console.log('SQL database', database_name, 'opened');
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
    }

    createTables() {
        //console.log('Create SQL tables...')
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
                                    'local_url' TEXT, \
                                    'image' TEXT, \
                                    'encrypted' INTEGER default 0, \
                                    'direction' TEXT, \
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
                                    'timestamp' INTEGER ) \
                                    ";

        this.ExecuteQuery(create_table_keys).then((success) => {
            //console.log('SQL keys table OK');
        }).catch((error) => {
            console.log(create_table_keys);
            console.log('SQL keys table creation error:', error);
        });

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
                        console.log('Table', key, 'must have version', value, 'and it has', currentVersions[key]);
                        update_queries = this.updateTableQueries[key];
                        version_numbers = Object.keys(update_queries);
                        version_numbers.sort(function(a, b){return a-b});
                        version_numbers.forEach((version) => {
                            if (version <= currentVersions[key]) {
                                return;
                            }
                            update_sub_queries = update_queries[version];
                            update_sub_queries.forEach((query_objects) => {

                                console.log('Run query for table', key, 'version', version, ':', query_objects.query);
                                this.ExecuteQuery(query_objects.query, query_objects.params);
                            });

                        });

                        query = "update versions set version = " + this.sqlTableVersions[key] + " where \"table\" = '" + key + "';";
                        //console.log(query);
                        this.ExecuteQuery(query);

                    } else {
                        //console.log('No upgrade required for table', key);
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
        this.db.transaction((trans) => {
          trans.executeSql(sql, params, (trans, results) => {
            resolve(results);
          },
            (error) => {
              reject(error);
            });
        });
      });

    async loadDeviceContacts() {
        Contacts.checkPermission((err, permission) => {
            if (permission === Contacts.PERMISSION_UNDEFINED) {
              Contacts.requestPermission((err, requestedContactsPermissionResult) => {
                if (err) {
                    console.log("Contacts.requestPermission()catch: ", err);
                }
                console.log("Contacts.requestPermission() requestPermission: ", requestedContactsPermissionResult);
              })
            }
          })

          Contacts.getAll((err, contacts) => {
            if (err === 'denied'){
                console.log('Access to contacts denied')
            } else {
                // contacts returned in Array
                let contact_cards = [];
                let name;
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
                                avatarPhotos[name_idx] = photo;
                            }

                            if (name_idx in avatarEmails) {
                            } else {
                                avatarEmails[name_idx] = email_stripped;
                            }
                            contact_cards.push(contact_card);
                            seen_uris.set(email_stripped, true);
                        }
                    });
                }

              this.setState({contacts: contact_cards, avatarPhotos: avatarPhotos, avatarEmails: avatarEmails});
              console.log('Loaded', contact_cards.length, 'addressbook entries');
            }
          })
    }

    get _notificationCenter() {
        // getter to lazy-load the NotificationCenter ref
        if (!this.__notificationCenter) {
            this.__notificationCenter = this.refs.notificationCenter;
        }
        return this.__notificationCenter;
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    _detectOrientation() {
        if(this.state.Width_Layout > this.state.Height_Layout && this.state.orientation !== 'landscape') {
            this.setState({orientation: 'landscape'});
        } else {
            this.setState({orientation: 'portrait'});
        }
     }

    changeRoute(route, reason) {
        utils.timestampedLog('Change route', this.currentRoute, '->', route, 'with reason:', reason);
        let messages = this.state.messages;

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
                                targetUri: ''
                                });
                } else {
                    this.setState({
                                messages: {},
                                messageZoomFactor: 1
                                });
                }
            }
            return;
        } else {
            if (route === '/ready' && this.state.selectedContact && Object.keys(this.state.messages).indexOf(this.state.selectedContact.uri) === -1) {
                this.getMessages(this.state.selectedContact.uri);
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

            this.startedByPush = false;
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
                            shareToContacts: false,
                            selectedContacts: [],
                            incomingCall: (reason === 'accept_new_call' || reason === 'user_hangup_call') ? this.state.incomingCall: null,
                            reconnectingCall: false,
                            muted: false
                            });
            }

            if (this.currentRoute === '/call' || this.currentRoute === '/conference') {
                if (reason !== 'user_hangup_call') {
                    this.stopRingback();
                    InCallManager.stop();
                }

                this.closeLocalMedia();

                if (reason === 'accept_new_call') {
                    if (this.state.incomingCall) {
                        // then answer the new call if any
                        let hasVideo = (this.state.incomingCall && this.state.incomingCall.mediaTypes && this.state.incomingCall.mediaTypes.video) ? true : false;
                        this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
                    }
                } else if (reason === 'escalate_to_conference') {
                    const uri = `${utils.generateSillyName()}@${config.defaultConferenceDomain}`;
                    const options = {audio: this.outgoingMedia ? this.outgoingMedia.audio: true,
                                     video: this.outgoingMedia ? this.outgoingMedia.video: true,
                                     participants: this.participantsToInvite,
                                     skipHistory: true}

                    this.callKeepStartConference(uri.toLowerCase(), options);
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

            if (reason === 'no_more_calls') {
                this.updateServerHistory(reason)
            }

            if (reason === 'start_up') {
                storage.get('account').then((account) => {
                    if (account) {
                        this.handleRegistration(account.accountId, account.password);
                    } else {
                        this.changeRoute('/login', 'start up');
                    }
                });
                this.fetchSharedItems();
             }
        }

        this.currentRoute = route;
        history.push(route);

    }

    componentWillUnmount() {
        utils.timestampedLog('App will unmount');
        AppState.removeEventListener('change', this._handleAppStateChange);

        this._onFinishedPlayingSubscription.remove();
        this._onFinishedLoadingSubscription.remove();
        this._onFinishedLoadingURLSubscription.remove();
        this._onFinishedLoadingFileSubscription.remove();

        this.callKeeper.destroy();
        this.closeConnection();
        this._loaded = false;
    }

    get unmounted() {
        return !this._loaded;
    }

    isUnmounted() {
        return this.unmounted;
    }

    backPressed() {
        console.log('Back button pressed in route', this.currentRoute);

        if (this.currentRoute === '/call' || this.currentRoute === '/conference') {
            this.goBackToHome();
            /*
            let call = this.state.currentCall || this.state.incomingCall;
            if (call && call.id) {
                this.hangupCall(call.id, 'user_hangup_call');
            }
            */
        } else if (this.currentRoute === '/ready') {
            if (this.state.selectedContact) {
                this.goBackToHome();
            } else {
                BackHandler.exitApp();
            }
        }

        return true;
    }

    async componentDidMount() {
        utils.timestampedLog('App did mount');
        //this.requestStoragePermission();

        DeviceInfo.getFontScale().then((fontScale) => {
            this.setState({fontScale: fontScale});
        });

        BackHandler.addEventListener('hardwareBackPress', this.backPressed);
        // Start a timer that runs once after X milliseconds
        BackgroundTimer.runBackgroundTimer(() => {
            // this will be executed once after 10 seconds
            // even when app is the the background
            this.heartbeat();
        }, 5000);

        try {
            await RNCallKeep.supportConnectionService ();
            //utils.timestampedLog('Connection service is enabled');
        } catch(err) {
            utils.timestampedLog(err);
        }

        try {
            await RNCallKeep.hasPhoneAccount();
            //utils.timestampedLog('Phone account is enabled');
        } catch(err) {
            utils.timestampedLog(err);
        }

/*
        if (Platform.OS === 'android') {
            RNDrawOverlay.askForDispalayOverOtherAppsPermission()
                 .then(res => {
                   //utils.timestampedLog("Display over other apps was granted");
                     // res will be true if permission was granted
                 })
                 .catch(e => {
                   utils.timestampedLog("Display over other apps was declined");
                     // permission was declined
                 })
        }
*/
        // prime the ref
        //logger.debug('NotificationCenter ref: %o', this._notificationCenter);

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
        this._boundOnPushRegistered = this._onPushRegistered.bind(this);

        this._detectOrientation();

        getPhoneNumber().then(phoneNumber => {
            this.setState({myPhoneNumber: phoneNumber});
            this.loadDeviceContacts();
        });

        this.listenforPushNotifications();
        this.listenforSoundNotifications();
        this._loaded = true;

        this.checkVersion();
    }

    checkVersion() {
        let appId = Platform.OS === 'android' ? "com.agprojects.sylk" : "1489960733";
        if (Platform.OS === 'android') {
            // TODO fix me
            return;
        }

        getAppstoreAppMetadata("1489960733") //put any apps id here
        .then(appVersion => {
            console.log("Sylk app version on appstore", appVersion.version, "published on", appVersion.currentVersionReleaseDate);
            this.setState({appStoreVersion: appVersion});
        })
        .catch(err => {
            console.log("Error fetching app store version occurred", err);
        });
    }

    listenforSoundNotifications() {
     // Subscribe to event(s) you want when component mounted
        this._onFinishedPlayingSubscription = SoundPlayer.addEventListener('FinishedPlaying', ({ success }) => {
          //console.log('finished playing', success)
        })
        this._onFinishedLoadingSubscription = SoundPlayer.addEventListener('FinishedLoading', ({ success }) => {
          //console.log('finished loading', success)
        })
        this._onFinishedLoadingFileSubscription = SoundPlayer.addEventListener('FinishedLoadingFile', ({ success, name, type }) => {
          //console.log('finished loading file', success, name, type)
        })
        this._onFinishedLoadingURLSubscription = SoundPlayer.addEventListener('FinishedLoadingURL', ({ success, url }) => {
          //console.log('finished loading url', success, url)
        })
    }

    registerAndroidNotifications(parent) {

        // Must be outside of any component LifeCycle (such as `componentDidMount`).
        //console.log('registerAndroidNotifications');
        PushNotification.configure({
          // (optional) Called when Token is generated (iOS and Android)
          onRegister: function (token) {
            //console.log("TOKEN:", token);
          },

          // (required) Called when a remote is received or opened, or local notification is opened
          onNotification: function (notification) {

            parent.handleAndroidNotification(notification);

            // process the notification

            // (required) Called when a remote is received or opened, or local notification is opened
            notification.finish(PushNotificationIOS.FetchResult.NoData);
          },

          // (optional) Called when Registered Action is pressed and invokeApp is false, if true onNotification will be called (Android)
          onAction: function (notification) {
            console.log("ACTION:", notification.action);
            console.log("NOTIFICATION:", notification);

            // process the action
          },

          // (optional) Called when the user fails to register for remote notifications. Typically occurs when APNS is having issues, or the device is a simulator. (iOS)
          onRegistrationError: function(err) {
            console.error(err.message, err);
          },
        });

        PushNotification.createChannel(
        {
          channelId: "sylk-messages", // (required)
          channelName: "My Sylk stream", // (required)
          channelDescription: "A channel to receive Sylk Message", // (optional) default: undefined.
          playSound: false, // (optional) default: true
          importance: Importance.HIGH, // (optional) default: Importance.HIGH. Int value of the Android notification importance
          vibrate: true, // (optional) default: true. Creates the default vibration pattern if true.
        },
        (created) => null // (optional) callback returns whether the channel was created, false means it already existed.
      );

        PushNotification.createChannel(
        {
          channelId: "sylk-messages-sound", // (required)
          channelName: "My Sylk stream", // (required)
          channelDescription: "A channel to receive Sylk Message", // (optional) default: undefined.
          playSound: true, // (optional) default: true
          soundName: "default", // (optional) See `soundName` parameter of `localNotification` function
          importance: Importance.HIGH, // (optional) default: Importance.HIGH. Int value of the Android notification importance
          vibrate: true, // (optional) default: true. Creates the default vibration pattern if true.
        },
        (created) => null // (optional) callback returns whether the channel was created, false means it already existed.
      );

        //console.log('Available Sylk channels:');

        PushNotification.getChannels(function (channel_ids) {
          //console.log(channel_ids); // ['channel_id_1']
        });
    }

    handleAndroidNotification(notification) {
        // when user touches the system notification and app launches...
        console.log("Handle Android push notification:", notification);
        let uri = notification.data.from_uri;

        if (!uri) {
            return;
        }

        if (uri in this.state.myContacts) {
            if (!this.state.selectedContact) {
                this.selectContact(this.state.myContacts[uri]);
            }
            this.initialChatContact = null;
        } else {
            this.initialChatContact = uri;
        }
    }

    handleiOSNotification(notification) {
        // when user touches the system notification and app launches...
        console.log("Handle iOS push notification:", notification);
    }

    sendLocalAndroidNotification(uri, content) {
        //https://www.npmjs.com/package/react-native-push-notification
        return;
        console.log('sendLocalAndroidNotification');

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
          bigLargeIconUrl: "https://www.example.tld/bigicon.jpg", // (optional) default: undefined
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

    listenforPushNotifications() {
        if (this.state.appState === null) {
            this.setState({appState: 'active'});
        } else {
            return;
        }

        if (Platform.OS === 'android') {
            Linking.getInitialURL().then((url) => {
                if (url) {
                  utils.timestampedLog('Initial external URL: ' + url);
                  this.eventFromUrl(url);
                }

                if (this.state.accountVerified) {
                    this.changeRoute('/ready', 'start_up');
                } else {
                    this.changeRoute('/login', 'start_up');
                }
            }).catch(err => {
                logger.error({ err }, 'Error getting external URL');
            });

            firebase.messaging().getToken()
            .then(fcmToken => {
                if (fcmToken) {
                    this._onPushRegistered(fcmToken);
                }
            });

            Linking.addEventListener('url', this.updateLinkingURL);

        } else if (Platform.OS === 'ios') {
            if (this.state.accountVerified) {
                this.changeRoute('/ready', 'start_up');
            } else {
                this.changeRoute('/login', 'start_up');
            }

            VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
            VoipPushNotification.registerVoipToken();

            PushNotificationIOS.addEventListener('register', this._boundOnPushRegistered);
            PushNotificationIOS.addEventListener('localNotification', this.onLocalNotification);
            PushNotificationIOS.addEventListener('notification', this.onRemoteNotification);

            //let permissions = await checkIosPermissions();
            //if (!permissions.alert) {
                PushNotificationIOS.requestPermissions();
            //}
        }

        this.boundProximityDetect = this._proximityDetect.bind(this);

        DeviceEventEmitter.addListener('Proximity', this.boundProximityDetect);

        AppState.addEventListener('change', this._handleAppStateChange);

        if (Platform.OS === 'ios') {
            this._boundOnNotificationReceivedBackground = this._onNotificationReceivedBackground.bind(this);
            this._boundOnLocalNotificationReceivedBackground = this._onLocalNotificationReceivedBackground.bind(this);
            VoipPushNotification.addEventListener('notification', this._boundOnNotificationReceivedBackground);
            VoipPushNotification.addEventListener('localNotification', this._boundOnLocalNotificationReceivedBackground);
        } else if (Platform.OS === 'android') {
            this.registerAndroidNotifications(this);

            AppState.addEventListener('focus', this._handleAndroidFocus);
            AppState.addEventListener('blur', this._handleAndroidBlur);

            firebase
                .messaging()
                .requestPermission()
                .then(() => {
                    // User has authorised
                })
                .catch(error => {
                    // User has rejected permissions
                });

            this.messageListener = firebase
                .messaging()
                .onMessage((message: RemoteMessage) => {
                    // this will just wake up the app to receive
                    // the web-socket invite handled by this.incomingCall()
                    let event = message.data.event;
                    const callUUID = message.data['session-id'];
                    const from = message.data['from_uri'];
                    const to = message.data['to_uri'];
                    const displayName = message.data['from_display_name'];
                    const outgoingMedia = {audio: true, video: message.data['media-type'] === 'video'};
                    const mediaType = message.data['media-type'] || 'audio';

                    if (this.unmounted) {
                        return;
                    }

                    if (event === 'incoming_conference_request') {
                        utils.timestampedLog('Push notification: incoming conference', callUUID);
                        if (!from || !to) {
                            return;
                        }
                        this.incomingConference(callUUID, to, from, displayName, outgoingMedia);
                    } else if (event === 'incoming_session') {
                        utils.timestampedLog('Push notification: incoming call', callUUID);
                        if (!from) {
                            return;
                        }
                        this.incomingCallFromPush(callUUID, from, displayName, mediaType);
                    } else if (event === 'cancel') {
                        this.cancelIncomingCall(callUUID);
                    } else if (event === 'message') {
                        if (!from) {
                            return;
                        }
                        console.log('Push notification: new messages on Sylk server from', from);
                    }
                });
        }
    }

    notifyIncomingMessageWhileInACall(from) {
        if (!this.state.selectedContact) {
            return;
        }

        if (this.state.selectedContact.uri !== from) {
            this._notificationCenter.postSystemNotification('New message from ' + from);
            this.vibrate();
            return;
        }

        if (this.state.currentCall && this.state.currentCall.remoteIdentity.uri === from) {
            this.vibrate();
            if (this.currentRoute !== '/ready') {
                this.goBackToHomeFromCall();
            }
            return;
        }
    }

    sendLocalNotificationWithSound (){
        console.log('sendLocalNotificationWithSound');
        //PushNotificationIOS.addNotificationRequest({
        PushNotificationIOS.presentLocalNotification({
          id: 'notificationWithSound',
          title: 'Sample Title',
          subtitle: 'Sample Subtitle',
          body: 'Sample local notification with custom sound',
          sound: 'customSound.wav',
          badge: 1,
        });
    };

    sendNotification (title, subtitle, body) {
        DeviceEventEmitter.emit('remoteNotificationReceived', {
          remote: true,
          aps: {
            alert: {title: title, subtitle: subtitle, body: body},
            sound: 'default',
            category: 'REACT_NATIVE',
            'content-available': 1,
            'mutable-content': 1,
          },
        });
    };

    sendSilentNotification () {
        DeviceEventEmitter.emit('remoteNotificationReceived', {
          remote: true,
          aps: {
            category: 'REACT_NATIVE',
            'content-available': 1,
          },
        });
    };

    onRemoteNotification(notification) {
        const title = notification.getAlert().title;
        const subtitle = notification.getAlert().subtitle;
        const body = notification.getAlert().body;
        const message = notification.getMessage();
        const content_available = notification.getContentAvailable();
        const category = notification.getCategory();
        const badge = notification.getBadgeCount();
        const sound = notification.getSound();
        const isClicked = notification.getData().userInteraction === 1;

        console.log('Got remote notification', title, subtitle, body);
        this.sendLocalNotification(title + ' ' + subtitle, body);
    };

    sendLocalNotification (title, body) {
        PushNotificationIOS.presentLocalNotification({
          alertTitle: title,
          alertBody: body
        });
    };

    onLocalNotification(notification) {
        //console.log('Got local notification', notification);
        this.updateTotalUread();
    };

    cancelIncomingCall(callUUID) {
        if (this.unmounted) {
            return;
        }

        if (this.callKeeper._acceptedCalls.has(callUUID)) {
            return;
        }

        utils.timestampedLog('Push notification: cancel call', callUUID);

        let call = this.callKeeper._calls.get(callUUID);
        if (!call) {
            if (!this.callKeeper._cancelledCalls.has(callUUID)) {
                utils.timestampedLog('Cancel incoming call that did not arrive on web socket', callUUID);
                this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
                this.startedByPush = false;
                if (this.startedByPush) {
                    this.changeRoute('/ready', 'incoming_call_cancelled');
                }
            }
            return;
        }

        if (call.state === 'incoming') {
            utils.timestampedLog('Cancel incoming call that was not yet accepted', callUUID);
            this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
            if (this.startedByPush) {
                this.changeRoute('/ready', 'incoming_call_cancelled');
            }
        }
    }

    _proximityDetect(data) {
        //utils.timestampedLog('Proximity changed, isNear is', data.isNear);
        if (!this.state.proximityEnabled) {
            return;
        }

        if (data.isNear) {
           this.speakerphoneOff();
        } else {
           this.speakerphoneOn();
        }
    }

    startCallWhenReady(targetUri, options) {
        this.resetGoToReadyTimer();

        if (options.conference) {
            this.startConference(targetUri, options);
        } else {
            this.startCall(targetUri, options);
        }
    }
    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    _onPushkitRegistered(token) {
        this.pushkittoken = token;
    }

    _onPushRegistered(token) {
        this.pushtoken = token;
    }

    _sendPushToken(account) {
        if ((this.pushtoken && !this.tokenSent)) {
            let token = null;

            //console.log('_sendPushToken this.pushtoken', this.pushtoken);

            if (Platform.OS === 'ios') {
                token = `${this.pushkittoken}-${this.pushtoken}`;
            } else if (Platform.OS === 'android') {
                token = this.pushtoken;
            }
            utils.timestampedLog('Push token for app', bundleId, 'sent:', token);
            account.setDeviceToken(token, Platform.OS, deviceId, true, bundleId);
            this.tokenSent = true;
        }
    }

    _handleAndroidFocus = nextFocus => {
        //utils.timestampedLog('----- APP in focus');
        if (Platform.OS === 'ios') {
            PushNotificationIOS.cancelLocalNotifications();
        } else {
            PushNotification.cancelAllLocalNotifications();
        }

        this.setState({inFocus: true});
        this.refreshNavigationItems();
        this.fetchSharedItems();

        this.respawnConnection();
     }

     fetchSharedItems() {
        return;

        console.log('fetchSharedItems...');
        ReceiveSharingIntent.getReceivedFiles(files => {
            // files returns as JSON Array example
            //[{ filePath: null, text: null, weblink: null, mimeType: null, contentUri: null, fileName: null, extension: null }]
                console.log(files);
                if (files.length > 0) {
                    console.log('Will share to contacts', files);

                    this.setState({shareToContacts: true, shareContent: files});
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
                    console.log('Nothing to share');
                }
            }, (error) =>{
                console.log(error);
            },
            'ShareMedia' // share url protocol (must be unique to your app, suggest using your apple bundle id)
        );
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
        Object.keys(this.state.myContacts).forEach((key) => {
            if (this.state.myContacts[key].tags.indexOf('conference') > -1 || this.state.myContacts[key].conference) {
                conference = true;
            }

            if (this.state.myContacts[key].timestamp > todayStart) {
                today = true;
            }

            if (this.state.myContacts[key].timestamp > yesterdayStart && this.state.myContacts[key].timestamp < todayStart) {
                yesterday = true;
            }
        });

        navigationItems = {today: today, yesterday: yesterday, conference: conference};
        this.setState({navigationItems: navigationItems});
     }

    _handleAndroidBlur = nextBlur => {
        //utils.timestampedLog('----- APP out of focus');
        this.setState({inFocus: false});
    }

    _handleAppStateChange = nextAppState => {
        //utils.timestampedLog('----- APP state changed', this.state.appState, '->', nextAppState);

        if (nextAppState === this.state.appState) {
            return;
        }

        if (this.callKeeper.countCalls === 0 && !this.state.outgoingCallUUID) {
            /*

            utils.timestampedLog('----- APP state changed', this.state.appState, '->', nextAppState);

            if (this.callKeeper.countCalls) {
                utils.timestampedLog('- APP state changed, we have', this.callKeeper.countCalls, 'calls');
            }

            if (this.callKeeper.countPushCalls) {
                utils.timestampedLog('- APP state changed, we have', this.callKeeper.countPushCalls, 'push calls');
            }

            if (this.startedByPush) {
                utils.timestampedLog('- APP state changed, started by push in', nextAppState, 'state');
            }

            if (this.state.connection) {
                utils.timestampedLog('- APP state changed from', this.state.appState, 'to', nextAppState, 'with connection', Object.id(this.state.connection));
            } else {
                utils.timestampedLog('- APP state changed from', this.state.appState, 'to', nextAppState);
            }
            */

        }

        if (this.state.appState === 'background' && nextAppState === 'active') {
            this.respawnConnection(nextAppState);
        }

        this.setState({appState: nextAppState});
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
            utils.timestampedLog('No active account');
        }

        if (this.state.accountId && (!this.state.connection || !this.state.account)) {
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

    selectContact(contact) {
        if (contact !== this.state.selectedContact) {
            this.setState({pinned: false});
        }
        this.setState({selectedContact: contact});
    }

    connectionStateChanged(oldState, newState) {
        if (this.unmounted) {
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
                    utils.timestampedLog('Web socket was terminated');
                    this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
                    this._notificationCenter.postSystemNotification('Connection lost');
                }
                //this.setState({connection: null, account: null});
                this.setState({account: null});
                break;
            case 'ready':
                this._notificationCenter.removeNotification();
                if (this.state.autoLogin) {
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

                if (this.currentRoute === '/login') {
                    this.changeRoute('/ready', 'websocket disconnected');
                }

                break;
            default:
                if (this.state.registrationKeepalive !== true) {
                    this.setState({loading: 'Connecting...'});
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
            loading     : null,
            registrationState: 'failed',
            status      : {
                msg   : 'Sign In failed: ' + reason,
                level : 'danger'
            }
        });

        if (this.startedByPush) {
            // TODO: hangup incoming call
        }

        if (this.currentRoute === '/login' && this.state.accountVerified) {
            this.changeRoute('/ready', 'register failure');
        }
    }

    registrationStateChanged(oldState, newState, data) {
        if (this.unmounted) {
            return;
        }

        const connection = this.getConnection();

        if (oldState) {
            utils.timestampedLog('Registration state changed:', oldState, '->', newState, 'on web socket', connection);
        }

        if (!this.state.account) {
            utils.timestampedLog('Account', this.state.accountId, 'is disabled');
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

            if (this.state.registrationKeepalive === true) {
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

            if (!this.state.accountVerified) {
                this.loadSylkContacts();
            }

            /*
            setTimeout(() => {
                this.updateServerHistory()
            }, 1000);
            */

            if (this.state.enrollment) {
                let myContacts = this.state.myContacts;
                myContacts[this.state.account.id] = this.newContact(this.state.account.id, this.state.displayName);
                this.saveSylkContact(this.state.account.id, myContacts[this.state.account.id], 'enrollment');
            }

            if (this.mustSendPublicKey) {
                var uri = uuid.v4() + '@' + this.state.defaultDomain;
                console.log('Send 1st public to', uri);
                this.sendPublicKey(uri);
                this.mustSendPublicKey = false;
            }

            storage.set('account', {
                accountId: this.state.account.id,
                password: this.state.password,
                verified: true
            });

            this.setState({loading: null,
                           accountVerified: true,
                           enrollment: false,
                           autoLogin: true,
                           registrationKeepalive: true,
                           registrationState: 'registered'
                           });

            if (this.state.keys && !this.syncRequested) {
                this.syncRequested = true;
                console.log('Request sync messages from server', this.state.lastSyncId);
                this.state.account.syncConversations(this.state.lastSyncId);
            }

            this.replayJournal();

            //if (this.currentRoute === '/login' && (!this.startedByPush || Platform.OS === 'ios'))  {
            // TODO if the call does not arrive, we never get back to ready
            if (this.currentRoute === '/login') {
                this.changeRoute('/ready', 'registered');
            }
            return;
        } else {
            this.setState({status: null, registrationState: newState });
        }

        if (this.mustLogout) {
            this.logout();
        }
    }

    showInternalAlertPanel() {
        this.setState({showIncomingModal: true});
        //Vibration.vibrate(VIBRATION_PATTERN, true);
        setTimeout(() => {
             Vibration.cancel();
        }, 30000);
    }

    vibrate() {
        Vibration.vibrate(VIBRATION_PATTERN, true);
        setTimeout(() => {
             Vibration.cancel();
        }, 1000);
    }

    hideInternalAlertPanel() {
        Vibration.cancel();
        this.setState({showIncomingModal: false});
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

    stopRingback() {
        //utils.timestampedLog('Stop ringback');
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
        utils.timestampedLog('Sylkrtc call', callUUID, 'state change:', oldState, '->', newState, 'on web socket', connection);

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
                        this.hideInternalAlertPanel();
                    }

                    if (oldState === 'established' || oldState === 'accepted') {
                        //utils.timestampedLog('Call state changed:', 'incoming call ended');
                        this.hideInternalAlertPanel();
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
                this.backToForeground();
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
                    this.startedByPush = false;
                    //utils.timestampedLog("Incoming call was cancelled");
                    this.setState({showIncomingModal: false});
                    this.hideInternalAlertPanel();
                    newincomingCall = null;
                    newCurrentCall = null;
                    readyDelay = 10;
                } else if (newState === 'accepted') {
                    //utils.timestampedLog("Incoming call was accepted");
                    this.hideInternalAlertPanel();
                    this.backToForeground();
                } else if (newState === 'established') {
                    //utils.timestampedLog("Incoming call media started");
                    this.hideInternalAlertPanel();
                }
            }

        } else if (this.state.currentCall) {
            //utils.timestampedLog('Call state changed: We have one current call');
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

        switch (newState) {
            case 'progress':
                //this.callKeeper.setCurrentCallActive(callUUID);
                this.backToForeground();

                this.resetGoToReadyTimer();

                tracks = call.getLocalStreams()[0].getVideoTracks();
                mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';

                if (mediaType === 'video') {
                    this.speakerphoneOn();
                } else {
                    this.speakerphoneOff();
                }

                if (!this.isConference(call)){
                    InCallManager.startRingback('_BUNDLE_');
                }

                break;

            case 'early-media':
                //this.callKeeper.setCurrentCallActive(callUUID);
                this.backToForeground();
                this.stopRingback();
                break;
            case 'established':
                callsState = this.state.callsState;
                callsState[callUUID] = {startTime: new Date()};
                this.setState({callsState: callsState});

                this.callKeeper.setCurrentCallActive(callUUID);

                this.backToForeground();
                this.resetGoToReadyTimer();

                tracks = call.getLocalStreams()[0].getVideoTracks();
                mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';

                InCallManager.start({media: mediaType});

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
                }

                this.backToForeground();
                this.resetGoToReadyTimer();

                if (direction === 'outgoing') {
                    this.stopRingback();
                }
                break;

            case 'terminated':
                let startTime;
                if (callUUID in this.state.callsState) {
                    callsState = this.state.callsState;
                    startTime = callsState[callUUID].startTime;
                    delete callsState[callUUID];
                    this.setState({callsState: callsState});
               }

                this._terminatedCalls.set(callUUID, true);
                utils.timestampedLog(callUUID, direction, 'terminated with reason', data.reason);

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

                if (!reason || reason.match(/200/)) {
                    if (oldState === 'progress' && direction === 'outgoing') {
                        reason = 'Cancelled';
                        cancelled = true;
                        play_busy_tone = false;
                    } else if (oldState === 'incoming') {
                        reason = 'Cancelled';
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
                    //reason = 'Forbidden';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/404/)) {
                    reason = 'User not found';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/408/)) {
                    reason = 'Timeout';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/480/)) {
                    reason = 'Is not online';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/486/)) {
                    reason = 'Is busy';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    if (direction === 'outgoing') {
                        play_busy_tone = false;
                    }
                } else if (reason.match(/603/)) {
                    reason = 'Cannot answer now';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    if (direction === 'outgoing') {
                        play_busy_tone = false;
                    }
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                    play_busy_tone = false;
                    cancelled = true;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/5\d\d/)) {
                    reason = 'Server failure: ' + reason;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                    server_failure = true;
                } else if (reason.match(/904/)) {
                    // Sofia SIP: WAT
                    reason = 'Wrong account or password';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else {
                    reason = 'Connection failed';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                    server_failure = true;
                }

                if (play_busy_tone) {
                    this.playBusyTone();
                }

                if (direction === 'outgoing') {
                    this.setState({declineReason: reason});
                }

                this.stopRingback();

                let msg;
                let current_datetime = new Date();
                let formatted_date = utils.appendLeadingZeroes(current_datetime.getHours()) + ":" + utils.appendLeadingZeroes(current_datetime.getMinutes()) + ":" + utils.appendLeadingZeroes(current_datetime.getSeconds());
                let diff = 0;
                if (startTime) {
                    let duration = moment.duration(new Date() - startTime);
                    diff = Math.floor((new Date() - startTime) / 1000);

                    if (duration > 3600) {
                        duration = duration.format('hh:mm:ss', {trim: false});
                    } else {
                        duration = duration.format('mm:ss', {trim: false});
                    }

                    msg = formatted_date + " - " + direction +" " + mediaType + " call ended after " + duration;
                    this.saveSystemMessage(call.remoteIdentity.uri.toLowerCase(), msg, direction, missed);
                } else {
                    msg = formatted_date + " - " + direction +" " + mediaType + " call ended (" + reason + ")";
                    if (!server_failure) {
                        this.saveSystemMessage(call.remoteIdentity.uri.toLowerCase(), msg, direction, missed);
                        if (reason.indexOf('PSTN calls forbidden') > -1) {
                            setTimeout(() => {
                                this.renderPurchasePSTNCredit(call.remoteIdentity.uri.toLowerCase());
                            }, 2000);
                        }
                    }
                }

                this.updateHistoryEntry(call.remoteIdentity.uri.toLowerCase(), callUUID, diff);

                this.callKeeper.endCall(callUUID, CALLKEEP_REASON);

                if (play_busy_tone && oldState !== 'established' && direction === 'outgoing') {
                    this._notificationCenter.postSystemNotification('Call ended:', {body: reason});
                }

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
            this.speakerphoneOn();

            if (!this.state.reconnectingCall) {
                if (this.state.inFocus) {
                    if (this.currentRoute !== '/ready') {
                        utils.timestampedLog('Will go to ready in', readyDelay/1000, 'seconds (terminated)', callUUID);
                        this.goToReadyTimer = setTimeout(() => {
                            this.changeRoute('/ready', 'no_more_calls');
                        }, readyDelay);
                    }
                } else {
                    if (this.currentRoute !== '/conference') {
                        this.changeRoute('/ready', 'no_more_calls');
                    }
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
            //this.getMessages(call.remoteIdentity.uri);
        } else {
            console.log('No call to go back to');
        }
    }

    goBackToHome() {
       this.changeRoute('/ready', 'back to home');
    }

    goBackToHomeFromCall() {
        this.changeRoute('/ready', 'back to home');
        if (this.state.callContact) {
            this.setState({selectedContact: this.state.callContact});
            if (Object.keys(this.state.messages).indexOf(this.state.callContact.uri) === -1) {
                this.getMessages(this.state.callContact.uri);
            }
        }
    }

    goBackToHomeFromConference() {
        this.changeRoute('/ready', 'back to home');
        if (this.state.callContact) {
            this.setState({selectedContact: this.state.callContact});
            if (Object.keys(this.state.messages).indexOf(this.state.callContact.uri) === -1) {
                this.getMessages(this.state.callContact.uri);
            }
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

        this.setState({displayName: account.displayName, enrollment: true, email: account.email});
        this.handleRegistration(account.id, account.password);
    }

    handleRegistration(accountId, password) {
        //console.log('handleRegistration', accountId);

        if (this.state.account !== null && this.state.registrationState === 'registered' ) {
            return;
        }

        this.setState({
            accountId : accountId,
            password  : password,
            loading   : 'Connecting...'
        });

        if (this.state.accountVerified) {
            this.loadSylkContacts();
        }

        if (this.state.connection === null) {
            utils.timestampedLog('Web socket handle registration for', accountId);

            const userAgent = 'Sylk Mobile';

            let connection = sylkrtc.createConnection({server: config.wsServer});
            utils.timestampedLog('Web socket', Object.id(connection), 'was opened');
            connection.on('stateChanged', this.connectionStateChanged);
            connection.on('publicKey', this.publicKeyReceived);
            this.setState({connection: connection});

        } else {
            if (this.state.connection.state === 'ready' && this.state.registrationState !== 'registered') {
                utils.timestampedLog('Web socket', Object.id(this.state.connection), 'handle registration for', accountId);
                this.processRegistration(accountId, password);
            } else if (this.state.connection.state !== 'ready') {
                if (this._notificationCenter) {
                    this._notificationCenter.postSystemNotification('Waiting for Internet connection');
                }
                if (this.currentRoute === '/login' && this.state.accountVerified) {
                    this.changeRoute('/ready', 'start_up');
                }
            }
        }
    }

    processRegistration(accountId, password, displayName) {
        if (!displayName) {
            displayName = this.state.displayName;
        }

        if (!this.state.connection) {
            return;
        }

        utils.timestampedLog('Process registration for', accountId, '(', displayName, ')');
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
            return;
        }

        if (this.state.accountVerified) {
            this.registrationFailureTimer  = setTimeout(() => {
                    this.showRegisterFailure('Register timeout');
                    this.processRegistration(accountId, password);
            }, 10000);
        }

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingConference);
                account.on('registrationStateChanged', this.registrationStateChanged);
                account.on('incomingCall', this.incomingCallFromWebSocket);
                account.on('incomingMessage', this.incomingMessage);
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

                storage.set('account', {
                    accountId: this.state.accountId,
                    password: this.state.password

                });

            } else {
                this.showRegisterFailure(408);
            }
        });
    }

    generateKeysIfNecessary(account) {
        console.log('Check if PGP key exists on server....')

        if (this.serverQueriedForPublicKey) {
            if (this.state.contactsLoaded) {
                if (!this.serverPublicKey) {
                    console.log('We have no PGP keys here or on server');
                    this.generateKeys();
                } else if (!this.state.keys || !this.state.keys.private){
                    console.log('Public PGP key exists on server but we have none');
                    this.setState({showImportPrivateKeyModal: true, keyDifferentOnServer: true});
                }
            } else {
                console.log('Wait for PGP keys until contacts are loaded');
            }
        } else {
            account.checkIfKeyExists((key) => {
                this.serverPublicKey = key;
                this.serverQueriedForPublicKey = true;

                if (key) {
                    if (this.state.keys) {
                        if (this.state.keys && this.state.keys.public !== key) {
                            console.log('Public PGP key exists on server but is different than ours');
                            this.setState({showImportPrivateKeyModal: true, keyDifferentOnServer: true})
                        } else {
                            console.log('Public PGP key exists on server and we have it');
                        }
                    } else {
                        if (!this.state.contactsLoaded) {
                            console.log('Wait for PGP keys until contacts are loaded');
                        } else {
                            this.showImportPrivateKeyModal();
                        }
                    }
                } else {
                    console.log('Public PGP key does not exist on server');
                    if (this.state.contactsLoaded) {
                        this.generateKeys();
                    } else {
                        console.log('Wait for PGP keys until contacts are loaded');
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
                this.changeRoute(nextRoute);
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
                this.setState({
                    loading: null
                });

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

    callKeepStartConference(targetUri, options={audio: true, video: true, participants: []}) {
        if (!targetUri) {
            return;
        }

        this.resetGoToReadyTimer();

        this.requestMicPermission();
        if (options.video) {
            this.requestCameraPermission();
        }

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

        this.setState({outgoingCallUUID: callUUID,
                       reconnectingCall: false,
                       callContact: this.state.selectedContact,
                       participantsToInvite: participantsToInvite
                       });

        const media = options.video ? 'video' : 'audio';

        if (participantsToInvite) {
            utils.timestampedLog('Will start', media, 'conference', callUUID, 'to', targetUri, 'with', participantsToInvite);
        } else {
            utils.timestampedLog('Will start', media, 'conference', callUUID, 'to', targetUri);
        }

        this.respawnConnection();
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, conference: true, callUUID: callUUID});
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

    callKeepStartCall(targetUri, options) {
        this.resetGoToReadyTimer();
        targetUri = targetUri.trim().toLowerCase();

        if (targetUri.indexOf('@') === -1) {
            targetUri = targetUri + '@' + this.state.defaultDomain;
        }

        this.requestMicPermission();
        if (options.video) {
            this.requestCameraPermission();
        }

        let callUUID = options.callUUID || uuid.v4();
        this.setState({outgoingCallUUID: callUUID, reconnectingCall: false});
        utils.timestampedLog('User will start call', callUUID, 'to', targetUri);
        this.respawnConnection();
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, callUUID: callUUID});

        setTimeout(() => {
            if (this.state.currentCall && this.state.currentCall.id === callUUID && this.state.currentCall.state === 'progress') {
                this.hangupCall(callUUID, 'cancelled_call');
            }
        }, 60000);
    }

    startCall(targetUri, options) {
        this.setState({targetUri: targetUri, callContact: this.state.selectedContact});
        this.getLocalMedia(Object.assign({audio: true, video: options.video}, options), '/call');
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
        }
    }

    callKeepAcceptCall(callUUID) {
        // called from user interaction with Old alert panel
        // options used to be media to accept audio only but native panels do not have this feature
        utils.timestampedLog('CallKeep will answer call', callUUID);
        this.callKeeper.acceptCall(callUUID);
        this.hideInternalAlertPanel();
    }

    callKeepRejectCall(callUUID) {
        // called from user interaction with Old alert panel
        utils.timestampedLog('CallKeep will reject call', callUUID);
        this.callKeeper.rejectCall(callUUID);
        this.hideInternalAlertPanel();
    }

    acceptCall(callUUID) {
        utils.timestampedLog('User accepted call', callUUID);
        this.hideInternalAlertPanel();

        this.resetGoToReadyTimer();

        if (this.state.currentCall) {
            utils.timestampedLog('Will hangup current call first');
            this.hangupCall(this.state.currentCall.id, 'accept_new_call');
            // call will continue after transition to /ready
        } else {
            utils.timestampedLog('Will get local media now');
            let hasVideo = (this.state.incomingCall && this.state.incomingCall.mediaTypes && this.state.incomingCall.mediaTypes.video) ? true : false;
            this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
        }
    }

    rejectCall(callUUID) {
        // called by Call Keep when user rejects call
        utils.timestampedLog('User rejected call', callUUID);
        this.hideInternalAlertPanel();

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

        let call = this.callKeeper._calls.get(callUUID);
        let direction = null;
        let targetUri = null;

        if (call) {
            let direction = call.direction;
            utils.timestampedLog('Sylkrtc terminate call', callUUID, 'in', call.state, 'state');
            call.terminate();
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
            reason === 'outgoing_connection_failed'
            ) {
            this.setState({inviteContacts: false});
            this.changeRoute('/ready', reason);
            if (reason === 'user_hangup_conference_confirmed') {
                if (this.conferenceEndedTimer) {
                    console.log('Clear timer conferenceEndedTimer');
                    clearTimeout(this.conferenceEndedTimer);
                    this.conferenceEndedTimer = null;
                } else {
                    console.log('Clear timer conferenceEndedTimer is not needed');
                }
            }
        } else if (reason === 'user_hangup_conference') {
            if (!this.conferenceEndedTimer ) {
                utils.timestampedLog('Save conference maybe?');
                this.conferenceEndedTimer = setTimeout(() => {
                    this.changeRoute('/ready', 'conference_really_ended');
                }, 15000);
            }
        } else if (reason === 'user_cancelled_conference') {
            if (!this.conferenceEndedTimer ) {
                utils.timestampedLog('Save conference maybe?');
                this.conferenceEndedTimer = setTimeout(() => {
                     this.changeRoute('/ready', 'conference_really_ended');
                }, 15000);
            }
        } else {
            utils.timestampedLog('Will go to ready in 6 seconds (hangup)');
            setTimeout(() => {
                 this.changeRoute('/ready', reason);
            }, 6000);
        }
    }

    playBusyTone() {
        //utils.timestampedLog('Play busy tone');
        InCallManager.stop({busytone: '_BUNDLE_'});
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

    async showImportPrivateKeyModal() {
        this.setState({showImportPrivateKeyModal: true});
    }

    async hideExportPrivateKeyModal() {
        this.setState({privateKey: null,
                       showExportPrivateKeyModal: false});
    }

    async showExportPrivateKeyModal() {
        this.setState({showExportPrivateKeyModal: true});
    }

    togglePinned() {
        console.log('togglePinned', this.state.selectedContact);
        if (this.state.selectedContact) {
            this.getMessages(this.state.selectedContact.uri, !this.state.pinned);
            this.setState({pinned: !this.state.pinned});
        }
    }

    toggleSpeakerPhone() {
        if (this.state.speakerPhoneEnabled === true) {
            this.speakerphoneOff();
        } else {
            this.speakerphoneOn();
        }
    }

    toggleCallMeMaybeModal() {
        this.setState({showCallMeMaybeModal: !this.state.showCallMeMaybeModal});
    }

    speakerphoneOn() {
        utils.timestampedLog('Speakerphone On');
        this.setState({speakerPhoneEnabled: true});
        InCallManager.setForceSpeakerphoneOn(true);
    }

    speakerphoneOff() {
        utils.timestampedLog('Speakerphone Off');
        this.setState({speakerPhoneEnabled: false});
        InCallManager.setForceSpeakerphoneOn(false);
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
    }

    outgoingConference(call) {
        // called by sylrtc.js when an outgoing conference starts
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        this.callKeeper.startOutgoingCall(call);
    }

    _onLocalNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        utils.timestampedLog('Handle local iOS PUSH notification: ', notificationContent);
    }

    _onNotificationReceivedBackground(notification) {

        let notificationContent = notification.getData();

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
            this.incomingConference(callUUID, to, from, displayName, outgoingMedia);

        } else if (event === 'cancel') {
            utils.timestampedLog('Push notification: cancel call', callUUID);
            VoipPushNotification.presentLocalNotification({alertBody:'Call cancelled'});
            this.callKeeper.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED);
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
        if (this.state.appState !== 'active') {
            this.callKeeper.backToForeground();
        }

        if (this.state.accountId) {
            this.handleRegistration(this.state.accountId, this.state.password);
        }

        PushNotification.popInitialNotification((notification) => {
            if (notification) {
                console.log('Initial push notification', notification);
            }
        });
    }

    incomingConference(callUUID, to, from, displayName, outgoingMedia={audio: true, video: true}) {
        if (this.unmounted) {
            return;
        }

        const mediaType = outgoingMedia.video ? 'video' : 'audio';

        utils.timestampedLog('Incoming', mediaType, 'conference invite from', from, displayName, 'to room', to);

        if (this.state.account && from === this.state.account.id) {
            utils.timestampedLog('Reject conference call from myself', callUUID);
            this.callKeeper.rejectCall(callUUID);
            return;
        }

        if (this.autoRejectIncomingCall(callUUID, from, to)) {
            return;
        }

        this.setState({incomingCallUUID: callUUID});
        this.callKeeper.handleConference(callUUID, to, from, displayName, mediaType, outgoingMedia);
    }

    startConference(targetUri, options={audio: true, video: true, participants: []}) {
        utils.timestampedLog('New outgoing conference to room', targetUri);
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: options.audio, video: options.video}, '/conference');
        this.getMessages(targetUri);
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
        //this._notificationCenter.postSystemNotification('Expecting conference invite', {body: `from ${data.originator.displayName || data.originator.uri}`});
    }

    updateLinkingURL = (event) => {
        // this handles the use case where the app is running in the background and is activated by the listener...
        //console.log('Updated Linking url', event.url);
        this.eventFromUrl(event.url);
        DeepLinking.evaluateUrl(event.url);
    }

    eventFromUrl(url) {
        url = decodeURI(url);

        try {
            let direction;
            let event;
            let callUUID;
            let from;
            let to;
            let displayName;

            var url_parts = url.split("/");
            let scheme = url_parts[0];
            //console.log(url_parts);

            if (scheme === 'sylk:') {
                //sylk://conference/incoming/callUUID/from/to/media - when Android is asleep
                //sylk://call/outgoing/callUUID/to/displayName - from system dialer/history
                //sylk://call/incoming/callUUID/from/to/displayName - when Android is asleep
                //sylk://call/cancel//callUUID - when Android is asleep

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
                direction = 'outgoing';
                event = url_parts[3];
                to = url_parts[4];
                callUUID = uuid.v4();

                if (to.indexOf('@') === -1 && event === 'conference') {
                    to = url_parts[4] + '@' + config.defaultConferenceDomain;
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
                    this.incomingConference(callUUID, to, from, displayName, media);
                }

            } else if (event === 'call') {
                this.startedByPush = true;
                if (direction === 'outgoing') {
                    utils.timestampedLog('Call from external URL:', url);
                    utils.timestampedLog('Outgoing call to', from);
                    this.backToForeground();
                    this.callKeepStartCall(from, {audio: true, video: false, callUUID: callUUID});
                } else if (direction === 'incoming') {
                    utils.timestampedLog('Call from external URL:', url);
                    utils.timestampedLog('Incoming call from', from);
                    this.backToForeground();
                    this.incomingCallFromPush(callUUID, from, displayName, mediaType, true);
                } else if (direction === 'cancel') {
                    this.cancelIncomingCall(callUUID);
                }


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
            if (this.state.blockedUris.indexOf(from) > -1 || (this.state.blockedUris.indexOf('anonymous@anonymous.invalid') > -1 && (from === 'anonymous@anonymous.invalid' || from.indexOf('@guest.') > -1))) {
                utils.timestampedLog('Reject call', callUUID, 'from blocked URI', from);
                this.callKeeper.rejectCall(callUUID);
                this._notificationCenter.postSystemNotification('Call rejected', {body: `from ${from}`});
                return true;
            }
        }

        const fromDomain = '@' + from.split('@')[1]
        if (this.state.blockedUris && this.state.blockedUris.indexOf(fromDomain) > -1) {
            utils.timestampedLog('Reject call', callUUID, 'from blocked domain', fromDomain);
            this.callKeeper.rejectCall(callUUID);
            this._notificationCenter.postSystemNotification('Call rejected', {body: `from domain ${fromDomain}`});
            return true;
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

    autoAcceptIncomingCall(callUUID, from) {
        // TODO: handle ping pong where we call each other back
        if (this.state.currentCall &&
            this.state.currentCall.direction === 'outgoing' &&
            this.state.currentCall.state === 'progress' &&
            this.state.currentCall.remoteIdentity.uri === from) {

                this.hangupCall(this.state.currentCall.id, 'accept_new_call');
                this.setState({currentCall: null});

                utils.timestampedLog('Auto accept incoming call from same address I am calling', callUUID);
                return true;
        }

        return false;
    }

    incomingCallFromPush(callUUID, from, displayName, mediaType, force) {
        //utils.timestampedLog('Handle incoming PUSH call', callUUID, 'from', from, '(', displayName, ')');

        if (this.unmounted) {
            return;
        }

        if (this.autoRejectIncomingCall(callUUID, from)) {
            return;
        }

        //this.showInternalAlertPanel();

        if (this.autoAcceptIncomingCall(callUUID, from)) {
            return;
        }

        this.goToReadyNowAndCancelTimer();

        this.setState({targetUri: from});

        let skipNativePanel = false;

        if (!this.callKeeper._calls.get(callUUID) || (this.state.currentCall && this.state.currentCall.direction === 'outgoing')) {
            //this._notificationCenter.postSystemNotification('Incoming call', {body: `from ${from}`});
            if (Platform.OS === 'android' && this.state.appState === 'foreground') {
                skipNativePanel = true;
            }
        }

        this.callKeeper.incomingCallFromPush(callUUID, from, displayName, mediaType, force, skipNativePanel);

    }

    incomingCallFromWebSocket(call, mediaTypes) {

        if (this.unmounted) {
            return;
        }

        this.callKeeper.addWebsocketCall(call);

        const callUUID = call.id;
        const from = call.remoteIdentity.uri;

        //utils.timestampedLog('Handle incoming web socket call', callUUID, 'from', from, 'on connection', Object.id(this.state.connection));

        // because of limitation in Sofia stack, we cannot have more then two calls at a time
        // we can have one outgoing call and one incoming call but not two incoming calls
        // we cannot have two incoming calls, second one is automatically rejected by sylkrtc.js

        if (this.autoRejectIncomingCall(callUUID, from)) {
            return;
        }

        this.requestMicPermission();
        if (mediaTypes.video) {
            this.requestCameraPermission();
        }

        const autoAccept = this.autoAcceptIncomingCall(callUUID, from);

        this.goToReadyNowAndCancelTimer();

        call.mediaTypes = mediaTypes;

        call.on('stateChanged', this.callStateChanged);

        this.setState({incomingCall: call});

        let skipNativePanel = false;

        if (this.state.currentCall && this.state.currentCall.direction === 'outgoing') {
            if (Platform.OS === 'android') {
                this.showInternalAlertPanel();
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
        console.log('updateServerHistory by', from);
        //this.contactsCount();

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

    sendPublicKey(uri) {
        if (!uri) {
            console.log('Missing uri, cannot send public key');
        }

        if (uri === this.state.accountId) {
            return;
        }

        // Send outgoing messages
        if (this.state.account && this.state.keys && this.state.keys.public) {
            console.log('Sending public key to', uri);
            this.state.account.sendMessage(uri, this.state.keys.public, 'text/pgp-public-key');
        } else {
            console.log('No public key available');
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
        }, 25000);
    }

    hideCallMeModal() {
        this.setState({showCallMeMaybeModal: false});
    }

    async saveSylkContact(uri, contact, origin=null) {
        if (!contact) {
            contact = this.newContact(uri);
        } else {
            contact = this.sanitizeContact(uri, contact, 'saveSylkContact');
        }

        if (!contact) {
            return;
        }

        console.log('Save Sylk Contact', uri, contact.name, 'by', origin);

        if (this.sql_contacts_keys.indexOf(uri) > -1) {
            this.updateSylkContact(uri, contact, origin);
            return;
        }

        let conference = contact.conference ? 1: 0;
        let tags = contact.tags.toString();
        let media = contact.lastCallMedia.toString();
        let participants = contact.participants.toString();
        let unread_messages = contact.unread.toString();
        let unixTime = Math.floor(contact.timestamp / 1000);

        let params = [this.state.accountId, contact.email, contact.photo, unixTime, uri, contact.name || '', contact.organization || '', unread_messages || '', tags || '', participants || '', contact.publicKey || '', contact.direction, media, conference, contact.lastCallId, contact.lastCallDuration];
        await this.ExecuteQuery("INSERT INTO contacts (account, email, photo, timestamp, uri, name, organization, unread_messages, tags, participants, public_key, direction, last_call_media, conference, last_call_id, last_call_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            if (result.rowsAffected === 1) {
                //console.log('SQL inserted contact', contact.uri, 'by', origin);
            }

            this.sql_contacts_keys.push(uri);
            let myContacts = this.state.myContacts;

            if (uri !== this.state.accountId) {
                myContacts[uri] = contact;
                let favorite = myContacts[uri].tags.indexOf('favorite') > -1 ? true: false;
                let blocked = myContacts[uri].tags.indexOf('blocked') > -1 ? true: false;

                this.updateFavorite(uri, favorite);
                this.updateBlocked(uri, blocked);
                this.setState({myContacts: myContacts});

            } else {
                this.setState({email: contact.email, displayName: contact.name})
                if (myContacts[uri].tags.indexOf('chat') > -1 || myContacts[uri].tags.indexOf('history') > -1) {
                    myContacts[uri] = contact;
                    this.setState({myContacts: myContacts});
                }
            }

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
        //console.log('updateSylkContact', contact);
        let unixTime = Math.floor(contact.timestamp / 1000);
        let unread_messages = contact.unread.toString();
        let media = contact.lastCallMedia.toString();
        let tags = contact.tags.toString();
        let conference = contact.conference ? 1: 0;
        let participants = contact.participants.toString();
        let params = [contact.photo, contact.email, contact.lastMessage, contact.lastMessageId, unixTime, contact.name || '', contact.organization || '', unread_messages || '', contact.publicKey || '', tags, participants, contact.direction, media, conference, contact.lastCallId, contact.lastCallDuration, contact.uri, this.state.accountId];

        await this.ExecuteQuery("UPDATE contacts set photo = ?, email = ?, last_message = ?, last_message_id = ?, timestamp = ?, name = ?, organization = ?, unread_messages = ?, public_key = ?, tags = ? , participants = ?, direction = ?, last_call_media = ?, conference = ?, last_call_id = ?, last_call_duration = ? where uri = ? and account = ?", params).then((result) => {
            if (result.rowsAffected === 1) {
                //console.log('SQL updated contact', contact.uri, 'by', origin);
            }
            let myContacts = this.state.myContacts;

            if (uri !== this.state.accountId) {
                myContacts[uri] = contact;
                let favorite = myContacts[uri].tags.indexOf('favorite') > -1 ? true: false;
                let blocked = myContacts[uri].tags.indexOf('blocked') > -1 ? true: false;

                this.updateFavorite(uri, favorite);
                this.updateBlocked(uri, blocked);
                this.setState({myContacts: myContacts});
            } else {
                this.setState({email: contact.email, displayName: contact.name})
                if (myContacts[uri].tags.indexOf('chat') > -1 || myContacts[uri].tags.indexOf('history') > -1) {
                    myContacts[uri] = contact;
                    this.setState({myContacts: myContacts});
                }
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

    async replicatePrivateKey(password) {
        if (!this.state.account) {
            console.log('No account');
            return;
        }

        if (!this.state.keys || !this.state.keys.private) {
            return;
        }

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

    processRemotePrivateKey(keyPair) {
        let regexp;
        let match;
        let public_key;

        regexp = /(-----BEGIN PGP PUBLIC KEY BLOCK-----[^]*-----END PGP PUBLIC KEY BLOCK-----)/ig;
        match = keyPair.match(regexp);

        if (match && match.length === 1) {
            public_key = match[0];
        }

        if (public_key && this.state.keys && this.state.keys.public === public_key) {
            console.log('Private key is the same');
            return;
        }

        this.setState({showImportPrivateKeyModal: true,
                       privateKey: keyPair});
    }

    async savePrivateKey(password) {
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
                               privateKeyImportSuccess: true});
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
            if (keys.private !== private_key && keys.public !== public_key) {
                let new_keys = {private: private_key, public: public_key}
                this.saveMyKey(new_keys);
                status = 'Private key copied successfully';

                if (this.state.account) {
                    this.state.account.sendMessage(this.state.accountId, 'Private key imported on another device', 'text/pgp-public-key-imported');
                }

                if (this.state.account) {
                    this.state.account.syncConversations();
                }

            } else {
                status = 'Private key is the same';
                console.log(status);
            }

            this.setState({privateKeyImportStatus: status,
                           privateKeyImportSuccess: true});


        } else {
            this.setState({privateKeyImportStatus: 'Incorrect password!',
                           privateKeyImportSuccess: false});
        }
    }

    async savePublicKey(uri, key) {
        if (uri === this.state.accountId) {
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
            //
        } else {
            myContacts[uri] = {};
        }

        if (myContacts[uri].publicKey === key) {
            console.log('Public key of', uri, 'did not change');
            return;
        }

        utils.timestampedLog('Public key of', uri, 'saved');

        this.saveSystemMessage(uri, 'Public key received', 'incoming');

        myContacts[uri].publicKey = key;
        this.saveSylkContact(uri, myContacts[uri], 'savePublicKey');
        this.sendPublicKey(uri);
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
        if (this.state.account) {
            //console.log('Send', contentType, 'message', id, 'to', uri);
            let message = this.state.account.sendMessage(uri, text, contentType, {id: id, timestamp: timestamp}, (error) => {
                if (error) {
                    console.log('Message', id, 'sending error:', error);
                    this.outgoingMessageStateChanged(id, 'failed');
                    let status = error.toString();
                    if (status.indexOf('DNS lookup error') > -1) {
                        status = 'Domain not found';
                    }
                    this.renderSystemMessage(uri, status, 'incoming');
                }
            });
            //console.log(message);
            //message.on('stateChanged', (oldState, newState) => {this.outgoingMessageStateChanged(message.id, oldState, newState)})
        }
    }

    textToGiftedMessage(text) {
        return {
            _id: uuid.v4(),
            text: text,
            createdAt: new Date(),
            received: false,
            direction: 'outgoing',
            user: {}
        };
    }

    async sendMessage(uri, message) {
        message.sent = false;
        message.received = false;
        message.pending = true;

        message.direction = 'outgoing';

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) === -1) {
            renderMessages[uri] = [];
        }

        let public_keys;

        if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey && this.state.keys) {
            public_keys = this.state.keys.public + "\n" + this.state.myContacts[uri].publicKey;
        }

        if (!message.contentType) {
            message.contentType = 'text/plain';
        }

        if (message.contentType !== 'text/pgp-public-key' && public_keys && this.state.keys) {
            await OpenPGP.encrypt(message.text, public_keys).then((encryptedMessage) => {
                this._sendMessage(uri, encryptedMessage, message._id, message.contentType, message.createdAt);
                this.saveOutgoingMessage(uri, message, 1);
            }).catch((error) => {
                this.saveOutgoingMessage(uri, message, 2);
                console.log('Failed to encrypt message:', error);
                this.outgoingMessageStateChanged(message._id, 'failed');
            });

        } else {
            console.log('Outgoing non-encrypted message to', uri);
            this.saveOutgoingMessage(uri, message);
            this._sendMessage(uri, message.text, message._id, message.contentType, message.createdAt);
        }

        renderMessages[uri].push(message);

        if (this.state.selectedContact) {
            let selectedContact = this.state.selectedContact;
            selectedContact.lastMessage = message.text.substring(0, 100);
            selectedContact.timestamp = message.createdAt;
            selectedContact.direction = 'outgoing';
            selectedContact.lastCallDuration = null;
            this.setState({selectedContact: selectedContact, messages: renderMessages});
        } else {
            this.setState({messages: renderMessages});
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

    async saveOutgoingMessage(uri, message, encrypted=0) {
        this.saveOutgoingChatUri(uri, message.text);
        //console.log('saveOutgoingMessage', message.text);
        let ts =  message.createdAt;

        let unix_timestamp = Math.floor(ts / 1000);
        let params = [this.state.accountId, message._id, JSON.stringify(ts), unix_timestamp, message.text, "text/plain", this.state.accountId, uri, "outgoing", "1", encrypted];
        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            //console.log('SQL insert message OK');
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
        });
    }

    async saveConferenceMessage(room, message) {
        console.log('Save conference message', message._id);
        let messages = this.state.messages;
        let ts = message.createdAt;

        let unix_timestamp = Math.floor(ts / 1000);
        let contentType = "text/plain";
        if (!message.direction) {
            message.direction = message.received ? 'incoming' : 'outgoing';
        }

        let from_uri = message.direction === 'incoming' || message.received ? room : this.state.accountId;
        let to_uri = message.direction === 'incoming' || message.received ? this.state.accountId : room;
        let system = message.system ? '1' : null;
        let sender = !system ? message.user._id : null;

        var content = message.text;
        var params = [this.state.accountId, system, JSON.stringify(message.metadata), message.image, sender, message.local_url, message.url, message._id, JSON.stringify(ts), unix_timestamp, content, contentType, from_uri, to_uri, message.direction, 0, message.sent ? 1: 0, message.received ? 1: 0];
        await this.ExecuteQuery("INSERT INTO messages (account, system, metadata, image, sender, local_url, url, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending, sent, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            console.log('SQL insert conference message', message._id);
            if (room in messages) {
            } else {
                messages[room] = [message];
            }
            messages[room].push(message);
            this.setState({messages: messages});
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
        });
    }

    async updateConferenceMessage(room, message, update=false) {
        console.log('Update conference message', message);
        let messages = this.state.messages;
        let sent = message.sent ? 1 : 0;
        let received = message.received ? 1 : 0;

        var params = [JSON.stringify(message.metadata),  message.image, message.local_url, message.text, 0, sent, received, message._id];
        await this.ExecuteQuery("update messages set metadata = ?, image = ?, local_url = ?, content = ?, pending = ?, sent = ?, received = ? where msg_id = ?", params).then((result) => {
            console.log('SQL update conference message', message._id);
            let renderMessages = messages[room];
            let newRenderMessages = [];
            renderMessages.forEach((msg) => {
                 if (msg._id === message._id) {
                     msg.local_url = message.local_url;
                     msg.image = message.image;
                     msg.txt = message.text;
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
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
        });
    }

    sql2GiftedChat(item, content) {
        let image;
        let timestamp = new Date(item.unix_timestamp * 1000);

        //if (item.url || item.image) {
        //console.log('sql2GiftedChat', item.msg_id, item.local_url, item.image);
        //}

        let failed = (item.pending === 0 && item.sent === 0 && item.direction === 'outgoing') ? true: false;
        let received = item.received === 1 ? true : false;
        let sent = item.sent === 1 ? true : false;
        let pending = item.pending === 1 ? true : false;

        let msg;
        let from_uri = item.sender ? item.sender : item.from_uri;

        if (!item.image && item.local_url && utils.isImage(item.local_url)) {
            item.image = item.local_url;
        }

        if (!item.video && item.local_url && utils.isVideo(item.local_url)) {
            //item.video = item.local_url;
        }

        if (!item.audio && item.local_url && utils.isAudio(item.local_url)) {
            //item.audio = item.local_url;
        }

        let metadata = {};

        if (item.metadata) {
            let metadata_obj = JSON.parse(item.metadata);
            Object.assign(metadata, metadata_obj);
        }

        msg = {
            _id: item.msg_id,
            key: item.msg_id,
            image: item.image,
            video: item.video,
            audio: item.audio,
            url: item.url,
            metadata: metadata,
            local_url: item.local_url,
            text: content || item.content || 'Empty message',
            encrypted: item.encrypted,
            createdAt: timestamp,
            sent: sent,
            direction: item.direction,
            received: received,
            pending: pending,
            system: item.system === 1 ? true : false,
            failed: failed,
            pinned: (item.pinned === 1) ? true: false,
            user: item.direction == 'incoming' ? {_id: from_uri, name: from_uri} : {}
            }

        //console.log(msg);
        return msg;
    }

    async outgoingMessageStateChanged(id, state) {
        let query;

        // mark message status
        // state can be failed or accepted

        utils.timestampedLog('Outgoing message', id, 'is', state);

        if (state === 'accepted') {
            query = "UPDATE messages set pending = 0 where msg_id = '" + id + "'";
        } else if (state === 'failed') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        }

        //console.log(query);
        if (query) {
            await this.ExecuteQuery(query).then((results) => {
                this.updateRenderMessage(id, state);
                // console.log('SQL update OK');
            }).catch((error) => {
                console.log('SQL query:', query);
                console.log('SQL error:', error);
            });
        }
    }

    async updateFileDownload(id, url, filePath) {
        let query = "UPDATE messages set local_url = ? where msg_id = ?";
        //console.log(query);
        await this.ExecuteQuery(query[filePath, id]).then((results) => {
            console.log('URL', url, 'was downloaded to', filePath);
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async messageStateChanged(id, state, data) {
        // valid API states: pending -> accepted -> delivered -> displayed,
        // error, failed or forbidden
        // valid UI render states: pending, read, received

        let reason = data.reason;
        let code = data.code;
        let failed = state === 'failed';

        if (failed && code) {
            if (code > 500 || code === 408) {
                utils.timestampedLog('Message', id, 'failed on server:', reason, code);
                return;
            }
        }

        utils.timestampedLog('Message', id, 'is', state);
        let query;

        if (state == 'accepted') {
            query = "UPDATE messages set pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'delivered') {
            query = "UPDATE messages set pending = 0, sent = 1 where msg_id = '" + id + "'";
        } else if (state == 'displayed') {
            query = "UPDATE messages set received = 1, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'received') {
            query = "UPDATE messages set sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (failed) {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'error') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'forbidden') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        }

        //console.log(query);
        await this.ExecuteQuery(query).then((results) => {
            this.updateRenderMessage(id, state, reason, code);
            // console.log('SQL update OK');
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    messageStateChangedSync(obj) {
        // valid API states: pending -> accepted -> delivered -> displayed,
        // error, failed or forbidden
        // valid UI render states: pending, read, received

        let id = obj.messageId;
        let state = obj.state;

        //console.log('Sync message', id, 'state', state);

        let query;

        if (state == 'accepted') {
            query = "UPDATE messages set pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'delivered') {
            query = "UPDATE messages set pending = 0, sent = 1 where msg_id = '" + id + "'";
        } else if (state == 'displayed') {
            query = "UPDATE messages set received = 1, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'received') {
            query = "UPDATE messages set sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'failed') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'error') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        } else if (state == 'forbidden') {
            query = "UPDATE messages set received = 0, sent = 1, pending = 0 where msg_id = '" + id + "'";
        }

        //console.log(query);
        this.ExecuteQuery(query).then((results) => {
            //console.log('SQL update OK');
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async deleteMessage(id, uri, local=true) {
        utils.timestampedLog('Message', id, 'is deleted');
        let query;
        // TODO send request to server
        //console.log(query);
        if (local) {
            this.addJournal(id, 'removeMessage', {uri: uri});
        }
        this.removeFileFromMessage(id, uri);
    }

    async refetchMessages(days=1) {
        let timestamp = new Date();
        let params;
        let unix_timestamp = Math.floor(timestamp / 1000);
        unix_timestamp = unix_timestamp - days * 24 * 3600;
        params = [this.state.accountId, unix_timestamp];

        this.ExecuteQuery("select * from messages where account = ? and unix_timestamp < ? order by unix_timestamp desc limit 1", params).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                this.ExecuteQuery("delete from messages where account = ? and unix_timestamp > ?", params).then((results) => {
                    console.log('SQL deleted', results.rowsAffected, 'messages');
                    this._notificationCenter.postSystemNotification(results.rowsAffected + ' messages removed');
                    console.log('Sync conversations since', item.msg_id, new Date(item.unix_timestamp * 1000));
                    this.setState({saveLastSyncId: item.msg_id});
                    setTimeout(() => {
                        if (this.state.account) {
                            this.state.account.syncConversations(item.msg_id);
                        }
                    }, 100);
                });

            }
        }).catch((error) => {
            console.log('SQL error:', error);
        });
    }

    removeFileFromMessage(id, uri) {
        let query = "SELECT * from messages where msg_id = '" + id + "';";
        this.ExecuteQuery(query,[]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                if (item.local_url) {
                    RNFS.unlink(item.local_url).then((success) => {
                        console.log('Removed file', item.local_url);
                    }).catch((err) => {
                        console.log('Error deleting file', item.local_url, err.message);
                    });
                } else if (item.url) {
                    console.log('No local file available for', item.url);
                }

                query = "DELETE from messages where msg_id = '" + id + "'";
                this.ExecuteQuery(query).then((results) => {
                    this.deleteRenderMessage(id, uri);
                    console.log('SQL deleted', results.rowsAffected, 'messages');
                }).catch((error) => {
                    console.log('SQL query:', query);
                    console.log('SQL error:', error);
                });
            }

        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async deleteMessageSync(id, uri) {
        //console.log('Sync message', id, 'is deleted');
        let query;
        query = "DELETE from messages where msg_id = '" + id + "'";
        this.ExecuteQuery(query).then((results) => {
            this.deleteRenderMessageSync(id, uri);
            // console.log('SQL update OK');
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async expireMessage(id, duration=300) {
        utils.timestampedLog('Expire message', id, 'in', duration, 'seconds after read');
        // TODO expire message
    }

    async deleteRenderMessage(id, uri) {

        let changes = false;
        let renderedMessages = this.state.messages;
        let newRenderedMessages = [];
        let myContacts = this.state.myContacts;
        let existingMessages = [];

        if (uri in this.state.messages) {
            existingMessages = renderedMessages[uri];
            existingMessages.forEach((m) => {
                if (m._id !== id) {
                    newRenderedMessages.push(m);
                } else {
                    changes = true;
                }
            });
        }

        if (changes) {
            renderedMessages[uri] = newRenderedMessages;
            if (uri in myContacts) {
                myContacts[uri].totalMessages = myContacts[uri].totalMessages - 1;
                if (existingMessages.length > 0 && existingMessages[0].id === id) {
                    myContacts[uri].lastMessage = null;
                    myContacts[uri].lastMessageId = null;
                }
            }
            this.setState({messages: renderedMessages, myContacts: myContacts});
        }

    }

    async deleteRenderMessageSync(id, uri) {
        let changes = false;
        let renderedMessages = this.state.messages;
        let newRenderedMessages = [];
        let existingMessages = [];

        if (uri in this.state.messages) {
            existingMessages = renderedMessages[uri];
            existingMessages.forEach((m) => {
                if (m._id !== id) {
                    newRenderedMessages.push(m);
                } else {
                    changes = true;
                }
            });
        }

        if (changes) {
            renderedMessages[uri] = newRenderedMessages;
            this.setState({messages: renderedMessages});
        }

        let idx = 'remove' + id;
        this.remove_sync_pending_item(idx);
    }

    async sendPendingMessage(uri, text, id, contentType, timestamp) {
        utils.timestampedLog('Outgoing pending message', id);
        if (uri in this.state.myContacts && this.state.myContacts[uri].publicKey && this.state.keys.public) {
            let public_keys = this.state.myContacts[uri].publicKey + "\n" + this.state.keys.public;
            await OpenPGP.encrypt(text, public_keys).then((encryptedMessage) => {
                //console.log('Outgoing encrypted message to', uri);
                this._sendMessage(uri, encryptedMessage, id, contentType, timestamp);
            }).catch((error) => {
                console.log('Failed to encrypt message:', error);
                this.outgoingMessageStateChanged(id, 'failed');
                //this.saveSystemMessage(uri, 'Failed to encrypt message', 'outgoing');
            });
        } else {
            //console.log('Outgoing non-encrypted message to', uri);
            this._sendMessage(uri, text, id, contentType, timestamp);
        }
    }

    async sendPendingMessages() {
        if (this.mustLogout) {
           return;
        }
        let content;
        await this.ExecuteQuery("SELECT * from messages where pending = 1 and content_type like 'text/%' and from_uri = ?", [this.state.accountId]).then((results) => {
            let rows = results.rows;
            for (let i = 0; i < rows.length; i++) {
                if (this.mustLogout) {
                   return;
                }

                var item = rows.item(i);
                if (item.to_uri.indexOf('@conference.')) {
                    continue;
                }

                if (item.to_uri.indexOf('@videoconference')) {
                    continue;
                }

                content = item.content;
                let timestamp = new Date(item.unix_timestamp * 1000);
                this.sendPendingMessage(item.to_uri, content, item.msg_id, item.content_type, timestamp);
            }

        }).catch((error) => {
            console.log('SQL error:', error);
        });

        await this.ExecuteQuery("SELECT * FROM messages where direction = 'incoming' and system is null and received = 0 and from_uri = ?", [this.state.accountId]).then((results) => {
            //console.log('SQL get messages OK');

            let rows = results.rows;
            let imdn_msg;
            for (let i = 0; i < rows.length; i++) {
               if (this.mustLogout) {
                   return;
               }
               var item = rows.item(i);
                let timestamp = JSON.parse(item.timestamp, _parseSQLDate);
                imdn_msg = {id: item.msg_id, timestamp: timestamp, from_uri: item.from_uri}
                if (this.sendDispositionNotification(imdn_msg, 'delivered')) {
                    query = "UPDATE messages set received = 1 where msg_id = " + item.msg_id;
                    //console.log(query);
                    this.ExecuteQuery(query).then((results) => {
                    }).catch((error) => {
                        console.log('SQL error:', error);
                    });
                }
            }

        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async updateRenderMessage(id, state, reason=null, code=null) {
        let query;
        let uri;
        let changes = false;

        //console.log('updateRenderMessage', id, state);

        query = "SELECT * from messages where msg_id = '" + id + "';";
        //console.log(query);
        await this.ExecuteQuery(query,[]).then((results) => {
            let rows = results.rows;
            if (rows.length === 1) {
                var item = rows.item(0);
                //console.log(item);
                uri = item.direction === 'outgoing' ? item.to_uri : item.from_uri;
                console.log('Message uri', uri, 'new state', state);
                if (uri in this.state.messages) {
                    let renderedMessages = this.state.messages;

                    renderedMessages[uri].forEach((m) => {
                        if (m._id === id) {
                            if (state === 'accepted') {
                                m.pending = false;
                                changes = true;
                            }

                            if (state === 'delivered') {
                                m.sent = true;
                                m.pending = false;
                                changes = true;
                            }

                            if (state === 'displayed') {
                                m.received = true;
                                m.sent = true;
                                m.pending = false;
                                changes = true;
                            }

                            if (state === 'failed') {
                                m.received = false;
                                m.sent = false;
                                m.pending = false;
                                m.failed = true;
                                changes = true;
                            }

                            if (state === 'pinned') {
                                m.pinned = true;
                                changes = true;
                            }

                            if (state === 'unpinned') {
                                m.pinned = false;
                                changes = true;
                            }
                        }
                    });

                    if (changes) {
                        this.setState({messages: renderedMessages});
                        if (state === 'failed') {
                            reason = 'Message delivery failed: ' + reason;
                            if (code) {
                                reason = reason + '('+ code + ')';
                            }
                            this.renderSystemMessage(uri, reason, 'incoming');
                        }
                    }
                }
            }

        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    async saveOutgoingChatUri(uri, content='') {
        console.log('saveOutgoingChatUri', uri);
        let query;

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
            myContacts[uri].lastMessage = content.substring(0, 100);
        }

        if (myContacts[uri].tags.indexOf('chat') === -1) {
            myContacts[uri].tags.push('chat');
        }

        myContacts[uri].lastMessageId = null;
        myContacts[uri].lastCallDuration = null;
        myContacts[uri].timestamp = new Date();
        myContacts[uri].direction = 'outgoing';
        this.setState({myContacts: myContacts});
        this.saveSylkContact(uri, myContacts[uri], 'saveOutgoingChatUri');
    }

     pinMessage(id) {
        let query;
        query = "UPDATE messages set pinned = 1 where msg_id ='" + id + "'";
        //console.log(query);
        this.ExecuteQuery(query).then((results) => {
            console.log('Message', id, 'pinned');
            this.updateRenderMessage(id, 'pinned')
            this.addJournal(id, 'pinMessage');
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
     }

     unpinMessage(id) {
        let query;
        query = "UPDATE messages set pinned = 0 where msg_id ='" + id + "'";
        //console.log(query);
        this.ExecuteQuery(query).then((results) => {
            this.updateRenderMessage(id, 'unpinned')
            this.addJournal(id, 'unPinMessage');
            console.log('Message', id, 'unpinned');
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

        if (this.mustLogout) {
            return;
        }

        let op;
        let executed_ops = [];

        Object.keys(this.mySyncJournal).forEach((key) => {
            if (this.mustLogout) {
                return;
            }
            executed_ops.push(key);
            op = this.mySyncJournal[key];
            utils.timestampedLog('Sync journal', op.action, op.id);
            if (op.action === 'removeConversation') {
                this.state.account.removeConversation(op.id, (error) => {
                    // TODO: add period and delete remote flags
                    if (!error) {
                        //utils.timestampedLog(op.action, op.id, 'journal operation was completed');
                        executed_ops.push(key);
                    } else {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });

            } else if (op.action === 'readConversation') {
                this.state.account.markConversationRead(op.id, (error) => {
                    if (!error) {
                        //utils.timestampedLog(op.action, op.id, 'journal operation completed');
                        executed_ops.push(key);
                    } else {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });

            } else if (op.action === 'removeMessage') {
                this.state.account.removeMessage({id: op.id, receiver: op.data.uri}, (error) => {
                    if (!error) {
                        //utils.timestampedLog(op.action, op.id, 'journal operation completed');
                        executed_ops.push(key);
                    } else {
                        utils.timestampedLog(op.action, op.id, 'journal operation failed:', error);
                    }
                });
            }
        });

        executed_ops.forEach((key) => {
            delete this.mySyncJournal[key];
        });

        storage.set('mySyncJournal', this.mySyncJournal);
        this.sendPendingMessages();
     }

     async confirmRead(uri){
        if (uri.indexOf('@') === -1) {
            return;
        }

        if (uri.indexOf('@conference.') > -1) {
            return;
        }

        if (uri.indexOf('@videoconference.') > -1) {
            return;
        }

        if (uri in this.state.decryptingMessages) {
            return;
        }

        //console.log('Confirm read messages for', uri);
        let displayed = [];

        await this.ExecuteQuery("SELECT * FROM messages where from_uri = '" + uri + "' and received = 1 and system is NULL and to_uri = ?", [this.state.accountId]).then((results) => {
            let rows = results.rows;
            if (rows.length > 0) {
               //console.log('We must confirm read of', rows.length, 'messages');
            }
            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                if (this.sendDispositionNotification(item)) {
                    displayed.push(item.msg_id);
                }
            }

            if (displayed.length > 0) {
                let sql_ids = '';
                let i = 1;
                displayed.forEach((msg_id) => {
                    sql_ids = sql_ids + "'" + msg_id + "'";
                    if (i < displayed.length) {
                        sql_ids = sql_ids + ', ';
                    }
                    i = i + 1;
                });

                let query = "UPDATE messages set received = 2 where msg_id in (" + sql_ids + ")";
                //console.log(query);
                this.ExecuteQuery(query).then((results) => {
                    //console.log('Sent disposition saved for', displayed.length, 'messages');
                }).catch((error) => {
                    console.log('SQL query:', query);
                    console.log('SQL error:', error);
                });
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
        if (uri in myContacts) {
        } else {
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

        this.updateTotalUread(myContacts);

        if (changes) {
            this.saveSylkContact(uri, myContacts[uri], 'resetUnreadCount');
            this.addJournal(uri, 'readConversation');
        }

        this.setState({missedCalls: missedCalls});
    }

    async sendDispositionNotification(message, state='displayed') {
        if (!this.state.account) {
            return false;
        }

        let query;
        let result = {};
        let id = message.msg_id || message.id;
        this.state.account.sendDispositionNotification(message.from_uri, id, message.timestamp, state,(error) => {
            if (!error) {
                utils.timestampedLog('Message', id, 'was', state, 'now');
                return true;
            } else {
                utils.timestampedLog(state, 'notification for message', id, 'send failed:', error);
                return false;
            }
        });

        return false;
    }

    loadEarlierMessages() {
        if (!this.state.selectedContact) {
            return;
        }

        let myContacts = this.state.myContacts;
        let uri = this.state.selectedContact.uri;
        let limit = this.state.messageLimit * this.state.messageZoomFactor;

        if (myContacts[uri].totalMessages < limit) {
            //console.log('No more messages for', uri);
            return;
        }

        let messageZoomFactor = this.state.messageZoomFactor;
        messageZoomFactor = messageZoomFactor + 1;
        this.setState({messageZoomFactor: messageZoomFactor});

        setTimeout(() => {
            this.getMessages(this.state.selectedContact.uri);
        }, 10);
    }

    async decryptMessage(message, updateContact=false) {
        // encrypted
        // 0 not encrypted
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

        await OpenPGP.decrypt(message.content, this.state.keys.private).then((content) => {
            //console.log('Message', id, message.content_type, 'to', message.to_uri, 'was decrypted');
            let messages = this.state.messages;
            let uri = message.direction === 'incoming' ? message.from_uri : message.to_uri;
            if (uri in decryptingMessages) {
                pending_messages = decryptingMessages[uri];
                idx = pending_messages.indexOf(id);
                if (pending_messages.length > 10) {
                    let status = 'Decrypting ' + pending_messages.length + ' messages with';
                    this._notificationCenter.postSystemNotification(status, {body: uri});
                } else if (pending_messages.length === 10) {
                    let status = 'All messages decrypted';
                    this._notificationCenter.postSystemNotification(status);
                }
                if (idx > -1) {
                    pending_messages.splice(idx, 1);
                    decryptingMessages[uri] = pending_messages;
                    this.setState({decryptingMessages: decryptingMessages});
                }
            }

            if (updateContact) {
                let myContacts = this.state.myContacts;
                console.log('Update contact after decryption', uri);
                if (message.timestamp > myContacts[uri].timestamp) {
                    myContacts[uri].lastMessage = content.substring(0, 100);
                    myContacts[uri].lastMessageId = message.id;
                    myContacts[uri].timestamp = message.timestamp;
                    this.saveSylkContact(uri, myContacts[uri], 'decryptMessage');
                    this.setState({myContacts: myContacts});
                }
            }

            if (uri in messages) {
                let render_messages = messages[uri];
                if (message.content_type === 'text/html') {
                    content = utils.html2text(content);
                } else if (message.content_type === 'text/plain') {
                    content = content;
                } else if (message.content_type.indexOf('image/') > -1) {
                    image = `data:${message.content_type};base64,${btoa(content)}`
                }

                msg = this.sql2GiftedChat(message, content);
                render_messages.push(msg);
                messages[uri] = render_messages;
                if (pending_messages.length === 0) {
                    this.confirmRead(uri);
                    this.setState({message: messages});
                }
            }

            let params = [content, id];
            this.ExecuteQuery("update messages set encrypted = 2, content = ? where msg_id = ?", params).then((result) => {
                //console.log('SQL updated message decrypted', id);
            }).catch((error) => {
                console.log('SQL message update error:', error);
            });

        }).catch((error) => {
            let params = [id];
            //console.log('Failed to decrypt message:', error);
            this.ExecuteQuery("update messages set encrypted = 3 where msg_id = ?", params).then((result) => {
                //console.log('SQL updated message decrypted', id, 'rows affected', result.rowsAffected);
            }).catch((error) => {
                console.log('SQL message update error:', error);
            });
        });
    }

    lookupPublicKey(contact) {

        if (contact.uri.indexOf('@guest') > -1) {
            return;
        }

        if (contact.uri.indexOf('anonymous') > -1) {
            return;
        }

        if (!contact.publicKey && !contact.conference && this.state.connection) {
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

    async getMessages(uri, pinned=false) {
        if (this.state.syncConversations) {
            return;
        }

        let messages = this.state.messages;
        let myContacts = this.state.myContacts;
        let msg;
        let query;
        let rows = 0;
        let total = 0;
        let last_messages = [];
        let orig_uri;

        if (!uri) {
            query = "SELECT count(*) as rows FROM messages where (from_uri = ? and direction = 'outgoing') or (to_uri = ? and direction = 'incoming')";
            await this.ExecuteQuery(query, [this.state.accountId, this.state.accountId]).then((results) => {
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

        if (utils.isPhoneNumber(uri) && uri.indexOf('@') === -1) {
            uri = uri + '@' + this.state.defaultDomain;
        } else {
            this.resetUnreadCount(orig_uri);
            this.lookupPublicKey(myContacts[orig_uri]);
        }

        console.log('Get messages with', uri, 'with zoom factor', this.state.messageZoomFactor);

        let limit = this.state.messageLimit * this.state.messageZoomFactor;

        query = "SELECT count(*) as rows FROM messages where ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?))";
        if (pinned) {
            query = query + ' and pinned = 1';
        }

        await this.ExecuteQuery(query, [this.state.accountId, uri, uri, this.state.accountId]).then((results) => {
            rows = results.rows;
            total = rows.item(0).rows;
            console.log('Got', total, 'messages with', uri, 'from database');
        }).catch((error) => {
            console.log('SQL error:', error);
        });

        if (uri in myContacts) {
            myContacts[uri].totalMessages = total;
        }

        query = "SELECT * FROM messages where ((from_uri = ? and to_uri = ?) or (from_uri = ? and to_uri = ?)) ";
        if (pinned) {
            query = query + ' and pinned = 1';
        }

        query = query + ' order by unix_timestamp desc limit ?, ?';

        await this.ExecuteQuery(query, [this.state.accountId, uri, uri, this.state.accountId, this.state.messageStart, limit]).then((results) => {
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

            for (let i = 0; i < rows.length; i++) {
                var item = rows.item(i);
                if (false) {
                    //console.log('Remove broken message', item);
                    this.ExecuteQuery('delete from messages where msg_id = ?', [item.msg_id]);
                    myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
                    continue;
                }

                content = item.content;
                if (!content && !item.image) {
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
                const is_encrypted =  content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && content.indexOf('-----END PGP MESSAGE-----') > -1;

                if (is_encrypted) {
                    myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
                    if (item.encrypted === null) {
                        item.encrypted = 1;
                    }
                    enc = parseInt(item.encrypted);
                    if (enc && enc !== 3 ) {
                        if (uri in decryptingMessages) {
                        } else {
                            decryptingMessages[orig_uri] = [];
                        }
                        decryptingMessages[orig_uri].push(item.msg_id);
                        messages_to_decrypt.push(item);
                    }
                } else {
                    if (item.content_type === 'text/html') {
                        content = utils.html2text(content);
                    } else if (item.content_type === 'text/plain') {
                        content = content;
                    } else if (item.content_type.indexOf('image/') > -1) {
                        image = `data:${item.content_type};base64,${btoa(content)}`
                    } else if (item.content_type === 'application/sylk-contact-update') {
                        myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
                        console.log('Remove update contact message', item.id);
                        this.ExecuteQuery('delete from messages where msg_id = ?', [item.msg_id]);
                        continue;
                    } else {
                        console.log('Unknown message', item.msg_id, 'type', item.content_type);
                        myContacts[orig_uri].totalMessages = myContacts[orig_uri].totalMessages - 1;
                        continue;
                    }

                    msg = this.sql2GiftedChat(item, content);
                    messages[orig_uri].push(msg);
                }
            }

            console.log('Got', messages[orig_uri].length, 'out of', total, 'messages for', uri);

            last_messages = messages[orig_uri];
            last_messages.reverse();
            if (last_messages.length > 0) {
                last_messages.forEach((last_item) => {
                    if (!last_item.image && !last_item.system && last_item.text) {
                        last_message = last_item.text.substring(0, 100);
                        last_message_id = last_item.id;
                    } else {
                        return;
                    }
                });
            }

            if (orig_uri in myContacts) {
                if (last_message && last_message != myContacts[orig_uri].lastMessage) {
                    myContacts[orig_uri].lastMessage = last_message;
                    myContacts[orig_uri].lastMessageId = last_message_id;
                    this.saveSylkContact(uri, myContacts[orig_uri], 'getMessages');
                    this.setState({myContacts: myContacts});
                }
            }

            this.setState({messages: messages, decryptingMessages: decryptingMessages});

            let i = 1;
            messages_to_decrypt.forEach((item) => {
                var updateContact = messages_to_decrypt.length === i;
                //console.log('To decrypt', messages_to_decrypt.length, 'updateContact =', updateContact);
                this.decryptMessage(item, updateContact);
                i = i + 1;
            });

        }).catch((error) => {
            console.log('SQL error:', error);
        });
    }

    async deleteMessages(uri, local=true) {
        console.log('Delete messages for', uri);
        let myContacts = this.state.myContacts;
        let messages = this.state.messages;
        let query;
        let params;
        let wipe = false;
        let orig_uri = uri;

        if (uri) {
            if (uri.indexOf('@') === -1 && utils.isPhoneNumber(uri)) {
                uri = uri + '@' + this.state.defaultDomain;
            } else {
                if (local) {
                    this.addJournal(orig_uri, 'removeConversation');
                }
            }
        }

        if (uri) {
            let dir = RNFS.DocumentDirectoryPath + '/conference/' + uri + '/files';
            RNFS.unlink(dir).then((success) => {
                console.log('Removed folder', dir);
            }).catch((err) => {
                //console.log('Error deleting folder', dir, err.message);
            });

            query = "DELETE FROM messages where ((from_uri = ? and to_uri = ? and direction = 'incoming') or (from_uri = ? and to_uri = ? and direction = 'outgoing'))";
            params = [uri, this.state.accountId, this.state.accountId, uri];
        } else {
            wipe = true;
            console.log('--- Wiping device --- ');
            let dir = RNFS.DocumentDirectoryPath + '/conference/';
            RNFS.unlink(dir).then((success) => {
                console.log('Removed folder', dir);
            }).catch((err) => {
                console.log('Error deleting folder', dir, err.message);
            });
            query = "DELETE FROM messages where (to_uri = ? and direction = 'incoming') or (from_uri = ? and direction = 'outgoing')";
            params = [this.state.accountId, this.state.accountId];
            uri = this.state.accountId;

            this.setState({messages: {}, myContacts: {}});
            this.saveLastSyncId(null);
        }

        await this.ExecuteQuery(query, params).then((result) => {
            if (result.rowsAffected) {
                console.log('SQL deleted', result.rowsAffected, 'messages');
                this._notificationCenter.postSystemNotification(result.rowsAffected + ' messages removed');
            }

            if (wipe) {
                this.ExecuteQuery('delete from contacts where account = ?', [this.state.accountId]);
                setTimeout(() => {
                    this.logout();
                }, 3000);
            } else {
                if (result.rowsAffected === 0) {
                    this.removeContact(orig_uri);
                } else {
                    if (orig_uri in messages) {
                        delete messages[orig_uri];
                        this.setState({messages: messages});
                    }

                    if (orig_uri in myContacts) {
                        myContacts[orig_uri].totalMessages = 0;
                        myContacts[orig_uri].lastMessage = null;
                        myContacts[orig_uri].lastMessageId = null;
                        this.setState({myContacts: myContacts});
                    }
                }
            }
        }).catch((error) => {
            console.log('SQL query:', query);
            console.log('SQL error:', error);
        });
    }

    playIncomingSound() {
        let must_play_sound = true;

        if (this.msg_sound_played_ts) {
            let diff = (Date.now() - this.msg_sound_played_ts)/ 1000;
            if (diff < 10) {
                must_play_sound = false;
            }
        }

        this.msg_sound_played_ts = Date.now();

        if (must_play_sound) {
            try {
              if (Platform.OS === 'ios') {
                  SoundPlayer.setSpeaker(true);
              }
              SoundPlayer.playSoundFile('message_received', 'wav');
            } catch (e) {
              console.log('Cannot play message_received.wav', e);
            }
        }
    }

    async removeMessage(message, uri=null) {
        if (uri === null) {
            uri = message.sender.uri;
        }

        await this.deleteMessage(message.id, uri, false).then((result) => {
            console.log('Message', message.id, 'to', uri, 'is removed');
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
            if (msg.id === message.id) {
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
        //console.log('removeConversation', uri);

        let renderMessages = this.state.messages;

        await this.deleteMessages(uri, false).then((result) => {
            utils.timestampedLog('Conversation with', uri, 'was removed');
        }).catch((error) => {
            console.log('Failed to delete conversation with', uri);
        });
    }

    removeConversationSync(obj) {
        let uri = obj.content;
        //console.log('Sync remove conversation with', uri, 'before', obj.timestamp);

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

    async readConversation(obj) {
        let uri = obj;
        this.resetUnreadCount(uri)
    }

    removeContact(uri) {
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

    add_sync_pending_item(item) {
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
                }, 1000 * 60);
            }
        }
    }

    resetSyncTimer() {
        if (this.sync_pending_items.length > 0) {
            this.sync_pending_items = [];
            console.log('Sync ended by timer ---');
            //console.log('Pending tasks:', this.sync_pending_items);
            this.afterSyncTasks();
        }
    }
    remove_sync_pending_item(item) {
        //console.log('remove_sync_pending_item', this.sync_pending_items.length);
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
            if (this.sync_pending_items.length > 10 && this.sync_pending_items.length % 10 == 0) {
                //console.log(this.sync_pending_items.length, 'sync items remaining');
            } else if (this.sync_pending_items.length > 0 && this.sync_pending_items.length < 10) {
                //console.log(this.sync_pending_items.length, 'sync items remaining');
            }
        }
    }

    async insertPendingMessages() {
        let query = "INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending, sent, received) VALUES "

        if (this.pendingNewSQLMessages.length > 0) {
            //console.log('Inserting', this.pendingNewSQLMessages.length, 'new messages');
        }

        let pendingNewSQLMessages = this.pendingNewSQLMessages;
        this.pendingNewSQLMessages = [];

        let all_values = [];
        let n = 0;
        let i = 1;

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
                //console.log('SQL inserted', pendingNewSQLMessages.length, 'messages');
                this.newSyncMessagesCount = this.newSyncMessagesCount + pendingNewSQLMessages.length;
            }).catch((error) => {
                console.log('SQL error inserting bulk messages:', error.message);
                console.log('query:', query);
                pendingNewSQLMessages.forEach((values) => {
                    this.ExecuteQuery(query, values).then((result) => {
                        this.newSyncMessagesCount = this.newSyncMessagesCount + 1;
                    }).catch((error) => {
                        if (error.message.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') > -1) {
                            console.log('Duplicate message id', values[2]);
                        } else {
                            console.log('SQL error inserting message', values[2], error.message);
                        }
                    });
                });
            });
        }
    }

    async afterSyncTasks() {
        this.insertPendingMessages();
        if (this.newSyncMessagesCount) {
            console.log('Synced', this.newSyncMessagesCount, 'messages from server');
            this.newSyncMessagesCount = 0;
        }

        this.setState({syncConversations: false});
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
                if (old_tags.indexOf('history') > -1 && replicateContacts[uri].tags.indexOf('history') === -1) {
                    myContacts[uri].tags.push('history');
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

            this.saveSylkContact(uri, myContacts[uri], 'syncEnd');
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
            console.log('Sync ended after', diff, 'seconds');
        }

        setTimeout(() => {
            this.addTestContacts();
            this.refreshNavigationItems();
            this.updateServerHistory('syncConversations')
        }, 2000);
    }

    async syncConversations(messages) {
        if (this.sync_pending_items.length > 0) {
            console.log('Sync already in progress');
            return;
        }

        if (this.mustLogout || this.currentRoute === '/logout') {
            return;
        }

        if (this.currentRoute === '/login') {
            return;
        }

        this.syncStartTimestamp = new Date();

        let myContacts = this.state.myContacts;
        let renderMessages = this.state.messages;
        if (messages.length > 0) {
            console.log('Sync', messages.length, 'events from server');
            //this._notificationCenter.postSystemNotification('Syncing messages with the server');
            this.add_sync_pending_item('sync_in_progress');
        } else {
            this.setState({firstSyncDone: true});
            console.log('Sync ended');
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

        let purgeMessages = this.state.purgeMessages;

        messages.forEach((message) => {
            if (this.mustLogout) {
                return;
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

            if (uri) {
                //console.log('Process journal', i, 'of', messages.length, message.contentType, uri, message.timestamp);
            }

            let d = new Date(2019);

            if (message.timestamp < d) {
                console.log('Skip broken journal with broken date', message.id);
                purgeMessages.push(message.id);
                return;
            }

            if (!message.content) {
                console.log('Skip broken journal with empty body', message.id);
                purgeMessages.push(message.id);
                return;
            }

            if (message.contentType !== 'application/sylk-conversation-remove' && message.contentType !== 'application/sylk-message-remove' && uri && Object.keys(myContacts).indexOf(uri) === -1) {
                if (uri.indexOf('@') > -1 && !utils.isEmailAddress(uri)) {
                    return;
                }

                console.log('Will add a new contact', uri);
                myContacts[uri] = this.newContact(uri);
                myContacts[uri].timestamp = message.timestamp;
                //this.setState({myContacts: myContacts});
            }

            //console.log('Sync', message.timestamp, message.contentType, uri);

            if (message.contentType === 'application/sylk-message-remove') {
                idx = 'remove' + message.id;
                this.add_sync_pending_item(idx);
                this.deleteMessageSync(message.id, uri);

                if (uri in renderMessages) {
                    existingMessages = renderMessages[uri];
                    newMessages = [];

                    existingMessages.forEach((msg) => {
                        if (msg.id === message.id) {
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
                    if (message.contentType !== 'application/sylk-contact-update') {
                        if (myContacts[uri].tags.indexOf('blocked') > -1) {
                            return;
                        }
                        myContacts[uri].lastMessageId = message.id;
                        myContacts[uri].lastMessage = null; // need to be loaded later after decryption
                        myContacts[uri].lastCallDuration = null;
                        myContacts[uri].direction = 'outgoing';
                        if (myContacts[uri].tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
                            myContacts[uri].tags.push('chat');
                        }
                        lastMessages[uri] = message.id;

                        if (message.timestamp > myContacts[uri].timestamp) {
                            updateContactUris[uri] = message.timestamp;
                            myContacts[uri].timestamp = message.timestamp;
                        }
                    }
                    stats.outgoing = stats.outgoing + 1;
                    this.outgoingMessageSync(message);
                } else {
                    if (myContacts[uri].tags.indexOf('blocked') > -1) {
                        return;
                    }
                    if (message.timestamp > myContacts[uri].timestamp) {
                        updateContactUris[uri] = message.timestamp;
                        myContacts[uri].timestamp = message.timestamp;
                    }

                    myContacts[uri].lastMessageId = message.id;
                    myContacts[uri].lastMessage = null; // need to be loaded later after decryption
                    myContacts[uri].lastCallDuration = null;
                    myContacts[uri].direction = 'incoming';
                    if (myContacts[uri].tags.indexOf('chat') === -1 && (message.contentType === 'text/plain' || message.contentType === 'text/html')) {
                        myContacts[uri].tags.push('chat');
                    }

                    lastMessages[uri] = message.id;

                    if (message.dispositionNotification.indexOf('display') > -1) {
                        myContacts[uri].unread.push(message.id);
                    }
                    stats.incoming = stats.incoming + 1;
                    this.incomingMessageSync(message);
                }
            }

            last_id = message.id;
        });

        this.updateTotalUread(myContacts);

        /*
        if (messages.length > 0) {
            Object.keys(stats).forEach((key) => {
                console.log('Sync', stats[key], key);
            });
        }
        */

        this.setState({messages: renderMessages,
                       updateContactUris: updateContactUris,
                       deletedContacts: deletedContacts,
                       purgeMessages: purgeMessages
                       });

        this.remove_sync_pending_item('sync_in_progress');

        Object.keys(lastMessages).forEach((uri) => {
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
                var uri = uuid.v4() + '@' + this.state.defaultDomain;
                //console.log('Send 1st public to', uri);
                this.sendPublicKey(uri);
            }
        }
    }

    async incomingMessage(message) {
        console.log('Message', message.id, message.contentType, 'was received');
        // Handle incoming messages
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
            this.processRemotePrivateKey(message.content);
            return;
        }

        const is_encrypted =  message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;

        if (is_encrypted) {
            if (!this.state.keys || !this.state.keys.private) {
                console.log('Missing private key, cannot decrypt message');
                this.saveSystemMessage(message.sender.uri, 'Cannot decrypt: no private key', 'incoming');
            } else {
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    //console.log('Incoming message', message.id, 'decrypted');
                    this.handleIncomingMessage(message, decryptedBody);
                }).catch((error) => {
                    //console.log('Failed to decrypt message:', error);
                    this.sendPublicKey(message.sender.uri);
                    //this.saveSystemMessage(message.sender.uri, 'Cannot decrypt: wrong public key', 'incoming');
                });
            }
        } else {
            //console.log('Incoming message is not encrypted');
            this.handleIncomingMessage(message);
        }
    }

    handleIncomingMessage(message, decryptedBody=null) {
        let content = decryptedBody || message.content;

        if (!this.state.selectedContact || this.state.selectedContact.uri != message.sender.uri) {
            this.sendLocalAndroidNotification(message.sender.uri, content);
        }

        this.saveIncomingMessage(message, decryptedBody);

        if (this.state.selectedContact) {
            let renderMessages = this.state.messages;
            if (message.sender.uri === this.state.selectedContact.uri) {
                if (message.sender.uri in renderMessages) {
                } else {
                    renderMessages[message.sender.uri] = [];
                }
            }

            renderMessages[message.sender.uri].push(utils.sylkToRenderMessage(message, decryptedBody, 'incoming'));

            let selectedContact = this.state.selectedContact;
            selectedContact.lastMessage = content.substring(0, 100);
            selectedContact.timestamp = message.timestamp;
            selectedContact.direction = 'incoming';
            selectedContact.lastCallDuration = null;

            this.setState({selectedContact: selectedContact, messages: renderMessages});
        } else {
            this.setState({messages: renderMessages});
        }

        this.notifyIncomingMessageWhileInACall(message.sender.uri);
    }

    async incomingMessageSync(message) {
        //console.log('Sync incoming message', message);
        // Handle incoming messages
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
            return;
        }

        if (message.contentType === 'text/pgp-private-key') {
            this.remove_sync_pending_item(message.id);
            return;
        }

        const is_encrypted =  message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            this.saveIncomingMessageSync(message, null, true);
        } else {
            //console.log('Incoming message', message.id, 'not encrypted from', message.sender.uri);
            this.saveIncomingMessageSync(message);
        }

        this.remove_sync_pending_item(message.id);
    }

    async outgoingMessage(message) {
        console.log('Outgoing message', message.id, 'to', message.receiver);
        this.saveLastSyncId(message.id);

        if (message.content.indexOf('?OTRv3') > -1) {
            return;
        }

        if (message.contentType === 'text/pgp-public-key') {
            return;
        }

        if (message.sender.uri.indexOf('@conference')) {
            return;
        }

        if (message.sender.uri.indexOf('@videoconference')) {
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
            this.processRemotePrivateKey(message.content);
            return;
        }

        const is_encrypted = message.content.indexOf('-----BEGIN PGP MESSAGE-----') > -1 && message.content.indexOf('-----END PGP MESSAGE-----') > -1;
        let content = message.content;

        if (is_encrypted) {
            await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                //console.log('Outgoing message', message.id, 'decrypted to', message.receiver, message.contentType);
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

                    if (message.contentType === 'text/html') {
                        content = utils.html2text(content);
                    } else if (message.contentType.indexOf('image/') > -1) {
                        content = 'Image';
                    }

                    if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                        myContacts[uri].lastMessage = content.substring(0, 100);
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
                            renderMessages[uri].push(utils.sylkToRenderMessage(message, content, 'outgoing'));
                            this.setState({renderMessages: renderMessages});
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
                    content = 'Image';
                }

                if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                    myContacts[uri].lastMessage = content.substring(0, 100);
                }

                let renderMessages = this.state.messages;
                if (Object.keys(renderMessages).indexOf(uri) > -1) {
                    renderMessages[uri].push(utils.sylkToRenderMessage(message, content, 'outgoing'));
                    this.setState({renderMessages: renderMessages});
                }

                this.saveSylkContact(uri, myContacts[uri], 'outgoingMessage');
            }
        }
    }

    async outgoingMessageSync(message) {
        //console.log('Sync outgoing message', message.id, 'to', message.receiver);

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
                await OpenPGP.decrypt(message.content, this.state.keys.private).then((decryptedBody) => {
                    //console.log('Sync outgoing message', message.id, message.contentType, 'decrypted to', message.receiver);
                    this.handleReplicateContactSync(decryptedBody, message.id, message.timestamp);
                    this.remove_sync_pending_item(message.id);
                }).catch((error) => {
                    console.log('Failed to decrypt my own message in sync:', error);
                    this.remove_sync_pending_item(message.id);
                    return;
                });
            } else {
                this.saveOutgoingMessageSqlBatch(message, null, true);
                this.remove_sync_pending_item(message.id);
            }

        } else {
            if (message.contentType === 'application/sylk-contact-update') {
                this.handleReplicateContactSync(content, message.id, message.timestamp);
                this.remove_sync_pending_item(message.id);
            } else {
                this.saveOutgoingMessageSqlBatch(message);
            }
        }
    }

    saveOutgoingMessageSql(message, decryptedBody=null, is_encrypted=false) {
        let pending = 0;
        let sent = 0;
        let received = null;
        let failed = 0;
        let encrypted = 0;
        let content = decryptedBody || message.content;

        if (decryptedBody !== null) {
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

        let ts = message.timestamp;

        let unix_timestamp = Math.floor(ts / 1000);
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(ts), unix_timestamp, content, message.contentType, message.sender.uri, message.receiver, "outgoing", pending, sent, received];
        this.ExecuteQuery("INSERT INTO messages (account, encrypted, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, pending, sent, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            //console.log('SQL inserted outgoing', message.contentType, 'message to', message.receiver, 'encrypted =', encrypted);
            this.remove_sync_pending_item(message.id);
        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
            this.remove_sync_pending_item(message.id);
        });
    }

    async saveOutgoingMessageSqlBatch(message, decryptedBody=null, is_encrypted=false) {
        let pending = 0;
        let sent = 0;
        let received = null;
        let failed = 0;
        let encrypted = 0;
        let content = decryptedBody || message.content;

        if (decryptedBody !== null) {
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
        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, message.sender.uri, message.receiver, "outgoing", pending, sent, received];
        this.pendingNewSQLMessages.push(params);

        if (this.pendingNewSQLMessages.length > 34) {
            this.insertPendingMessages();
        }

        this.remove_sync_pending_item(message.id);
    }

    async saveSystemMessage(uri, content, direction, missed=false) {
        let timestamp = new Date();
        let unix_timestamp = Math.floor(timestamp / 1000);
        let id = uuid.v4();
        let params = [this.state.accountId, id, JSON.stringify(timestamp), unix_timestamp, content, 'text/plain', direction === 'incoming' ? uri : this.state.account.id, direction === 'outgoing' ? uri : this.state.account.id, 0, 1, direction];

        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, pending, system, direction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {
            this.renderSystemMessage(uri, content, direction, timestamp);

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
        });
    }

    async renderPurchasePSTNCredit(uri) {
        let url = 'https://mdns.sipthor.net/sip_settings.phtml?account='+ this.state.accountId + '&tab=credit';
        let myContacts = this.state.myContacts;

        if (Object.keys(myContacts).indexOf(uri) === -1 && utils.isPhoneNumber(uri) && uri.indexOf('@') > -1) {
            uri = uri.split('@')[0];
        }

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) > - 1) {
            let msg;

            msg = {
                _id: uuid.v4(),
                text: 'To call phone numbers, you must purchase credit at ' + url,
                createdAt: new Date(),
                direction: 'incoming',
                sent: true,
                pending: false,
                failed: false,
                user: {_id: uri, name: uri}
                }

            renderMessages[uri].push(msg);
            this.setState({renderMessages: renderMessages});
        }
    }

    async renderSystemMessage(uri, content, direction, timestamp) {
        let myContacts = this.state.myContacts;

        if (Object.keys(myContacts).indexOf(uri) === -1 && utils.isPhoneNumber(uri) && uri.indexOf('@') > -1) {
            uri = uri.split('@')[0];
        }

        let renderMessages = this.state.messages;
        if (Object.keys(renderMessages).indexOf(uri) > - 1) {
            let msg;

            msg = {
                _id: uuid.v4(),
                text: content,
                createdAt: timestamp,
                direction: direction,
                sent: true,
                pending: false,
                system: true,
                failed: false,
                user: direction == 'incoming' ? {_id: uri, name: uri} : {}
                }

            renderMessages[uri].push(msg);
            this.setState({renderMessages: renderMessages});
        }
    }

    async saveIncomingMessage(message, decryptedBody=null) {
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

        var content = decryptedBody || message.content;

        let received = 1;
        let unix_timestamp = Math.floor(message.timestamp / 1000);
        let params = [this.state.accountId, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, message.sender.uri, this.state.account.id, "incoming", received];
        await this.ExecuteQuery("INSERT INTO messages (account, msg_id, timestamp, unix_timestamp, content, content_type, from_uri, to_uri, direction, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params).then((result) => {

            if (myContacts[uri].name === null || myContacts[uri].name === '' && message.sender.displayName) {
                myContacts[uri].name = message.sender.displayName;
            }

            if (message.timestamp > myContacts[uri].timestamp) {
                myContacts[uri].timestamp = message.timestamp;
            }

            myContacts[uri].unread.push(message.id);
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
                content = 'Image';
            }

            if (content && content.indexOf('-----BEGIN PGP MESSAGE-----') === -1) {
                myContacts[uri].lastMessage = content.substring(0, 100);
                myContacts[uri].lastMessageId = message.id;
                this.setState({myContacts: myContacts});
            }

            this.updateTotalUread(myContacts);

            this.saveSylkContact(uri, myContacts[uri], 'saveIncomingMessage');

        }).catch((error) => {
            if (error.message.indexOf('UNIQUE constraint failed') === -1) {
                console.log('SQL error:', error);
            }
        });
    }

    saveIncomingMessageSync(message, decryptedBody=null, is_encrypted=false) {
        var content = decryptedBody || message.content;
        let encrypted = 0;
        if (decryptedBody !== null) {
            encrypted = 2;
        } else if (is_encrypted) {
            encrypted = 1;
        }
        let received = 0;
        let imdn_msg;
        //console.log('saveIncomingMessageSync', message);

        if (message.dispositionNotification.indexOf('display') === -1) {
            //console.log('Incoming message', message.id, 'was already read');
            received = 2;
        } else {
            if (message.dispositionNotification.indexOf('positive-delivery') > -1) {
                imdn_msg = {id: message.id, timestamp: message.timestamp, from_uri: message.sender.uri}
                if (this.sendDispositionNotification(imdn_msg, 'delivered')) {
                    received = 1;
                }
            } else {
                received = 1;
            }
        }

        let pending
        let sent;
        let unix_timestamp = Math.floor(message.timestamp / 1000);

        let params = [this.state.accountId, encrypted, message.id, JSON.stringify(message.timestamp), unix_timestamp, content, message.contentType, message.sender.uri, this.state.account.id, "incoming", pending, sent, received];
        this.pendingNewSQLMessages.push(params);
        this.remove_sync_pending_item(message.id);

        if (this.pendingNewSQLMessages.length > 34) {
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
        uri = uri.trim().toLowerCase();

        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.state.defaultDomain;
        }

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
        //console.log('Create new contact', uri, data);
        let current_datetime = new Date();

        if (data.src !== 'init') {
            uri = uri.trim().toLowerCase();
        }

        let contact = { id: uuid.v4(),
                          uri: uri,
                          name: name || data.name || '',
                          organization: data.organization || '',
                          unread: [],
                          tags: [],
                          lastCallMedia: [],
                          participants: [],
                          timestamp: current_datetime
                          }

        contact = this.sanitizeContact(uri, contact, data);
        return contact;
    }

    newSyntheticContact(uri, name=null, data={}) {
        //console.log('Create new contact', uri, data);
        let current_datetime = new Date();

        uri = uri.trim().toLowerCase();

        let contact = { id: uuid.v4(),
                          uri: uri,
                          name: name || data.name || '',
                          organization: data.organization || '',
                          unread: [],
                          tags: ['synthetic'],
                          lastCallMedia: [],
                          participants: [],
                          timestamp: current_datetime
                          }
        return contact;
    }

    updateTotalUread(myContacts=null) {
        let total_unread = 0;
        myContacts = myContacts || this.state.myContacts;
        Object.keys(myContacts).forEach((uri) => {
            total_unread = total_unread + myContacts[uri].unread.length;
        });

        //console.log('Total unread messages', total_unread)

       if (Platform.OS === 'ios') {
           PushNotification.setApplicationIconBadgeNumber(total_unread);
       } else {
            ShortcutBadge.setCount(total_unread);
       }

    }

    saveContact(uri, displayName='', organization='', email='') {
        displayName = displayName.trim();
        uri = uri.trim().toLowerCase();
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

        this.replicateContact(contact);

        this.saveSylkContact(uri, contact, 'saveContact');

        let selectedContact = this.state.selectedContact;
        if (selectedContact && selectedContact.uri === uri) {
            selectedContact.displayName = displayName;
            selectedContact.organization = organization;
            this.setState({selectedContact: selectedContact});
        }

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
        //console.log('Replicate contact', contact);

        if (!this.state.keys) {
            console.log('Cannot replicate contact without aprivate key');
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
        contact = JSON.parse(json_contact);

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
            contact = myContacts[uri];
            //
        } else {
            contact = this.newContact(uri, contact.name);
            if (!contact) {
                return;
            }
        }

        contact.uri = uri;
        contact.name = contact.name;
        contact.email = contact.email;
        contact.organization = contact.organization;
        contact.timestamp = new Date(contact.timestamp * 1000);
        contact.tags = contact.tags;
        contact.participants = contact.participants;

        this.saveSylkContact(uri, contact, 'handleReplicateContact');
    }

    async handleReplicateContactSync(json_contact, id, msg_timestamp) {
        let purgeMessages = this.state.purgeMessages;

        let contact;
        contact = JSON.parse(json_contact);
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
                //purgeMessages.push(id);
                //this.setState({purgeMessages: purgeMessages});
                //console.log('Sync replicate contact skipped because is too old', timestamp, uri, 'with name', contact.name);
               return;
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

        console.log('Sync replicate contact', uri, 'with name', contact.name);

        replicateContacts[uri].uri = uri;
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

        if (!isNumber && !utils.isEmailAddress(uri) && username !== '*') {
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

        this.replicateContact(myContacts[uri]);
        this.setState({favoriteUris: favoriteUris});
    }

    toggleBlocked(uri) {
        let blockedUris = this.state.blockedUris;
        let myContacts = this.state.myContacts;

        if (uri.indexOf('@guest.') > -1) {
            uri = 'anonymous@anonymous.invalid';
        }

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

        this.replicateContact(myContacts[uri]);
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

    shareContent() {
        if (this.state.shareContent.length === 0) {
            return;
        }

        if (this.state.selectedContacts.length === 0) {
            this._notificationCenter.postSystemNotification('Sharing canceled');
        }

        let item = this.state.shareContent[0];
        let content = '';

        if (item.subject) {
            content = content + '\n\n' + item.subject;
        }

        if (item.text) {
            content = content + '\n\n' + item.text;
        }

        if (item.weblink) {
            content = content + '\n\n' + item.weblink;
        }

        content = content.trim();

        this.state.selectedContacts.forEach((uri) => {
            let msg = this.textToGiftedMessage(content);
            console.log('Share external item with', uri);
            this.sendMessage(uri, msg);
        });

        ReceiveSharingIntent.clearReceivedFiles();

        this.setState({shareContent: [],
                       selectedContacts: [],
                       shareToContacts: false});
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
        this.replicateContact(myContacts[uri]);
        this.saveSylkContact(uri, myContacts[uri], 'saveConference');
    }

    addHistoryEntry(uri, callUUID, direction='outgoing', participants=[]) {
        let myContacts = this.state.myContacts;

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
            this.replicateContact(myContacts[uri])
            this.saveSylkContact(uri, myContacts[uri], 'updateHistoryEntry');
        } else {
            console.log('History entry does not exists for', callUUID);
        }
    }

    render() {
        let footerBox = <View style={styles.footer}><FooterBox /></View>;

        let extraStyles = {};

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
        }

        let loadingLabel = this.state.loading;
        if (this.state.syncConversations) {
            loadingLabel = 'Sync conversations';
        } else if (this.state.reconnectingCall) {
            loadingLabel = 'Reconnecting call...';
        } else if (this.mustLogout) {
            loadingLabel = 'Logging out...';
        }

        return (
            <PaperProvider theme={theme}>
                <Router history={history} ref="router">
                    <ImageBackground source={backgroundImage} style={{width: '100%', height: '100%'}}>
                                <View style={mainStyle.MainContainer} onLayout={(event) => this.setState({
                                                                        Width_Layout : event.nativeEvent.layout.width,
                                                                        Height_Layout : event.nativeEvent.layout.height
                                                                        }, ()=> this._detectOrientation())}>
                        <SafeAreaView style={[styles.root, extraStyles]}>
                            <IncomingCallModal
                                call={this.state.incomingCall}
                                onAccept={this.callKeepAcceptCall}
                                onReject={this.callKeepRejectCall}
                                show={this.state.showIncomingModal}
                                contacts = {this.state.contacts}
                            />

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
                            show={(this.state.loading !== null && !this.state.accountVerified) || this.state.syncConversations || this.state.generatingKey || this.state.reconnectingCall}
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

            must_save = false;
            if (this.state.blockedUris.indexOf(uri) > -1) {
                return;
            }

            if (uri in myContacts) {
            } else {
                contact = this.newContact(uri);
                if (!contact) {
                    console.log('No valid contact for', uri);
                    return;
                }

                myContacts[uri] = contact;
                let contacts = this.lookupContacts(uri)

                if (contacts.length > 0) {
                    myContacts[uri].name = contacts[0].name;
                    myContacts[uri].tags = contacts[0].tags;
                    myContacts[uri].photo = contacts[0].photo;
                    myContacts[uri].label = contacts[0].label;
                }

                myContacts[uri].timestamp = item.timestamp;
                must_save = true;
            }

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

            if (item.tags.indexOf('missed') > - 1) {
                tags.push('missed');
                myContacts[uri].unread.push(item.sessionId);
                if (missedCalls.indexOf(item.sessionId) === -1) {
                    missedCalls.push(item.sessionId);
                    must_save = true;
                }
            } else {
                idx = tags.indexOf('missed');
                if (idx > -1) {
                    tags.splice(idx, 1);
                    must_save = true;
                }
            }

            tags.push('history');

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

            this.updateTotalUread(myContacts);

            if (must_save) {
                this.saveSylkContact(uri, this.state.myContacts[uri], 'saveHistory');
            }

         });

         if (i > 0) {
             console.log('Saved new', i, 'history items');
         } else {
             console.log('Server history was already in sync');
         }

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

        return (
            <Fragment>
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
                    organization = {this.state.organization}
                    selectedContact = {this.state.selectedContact}
                    messages = {this.state.messages}
                    replicateKey = {this.replicatePrivateKey}
                    publicKey = {publicKey}
                    deleteMessages = {this.deleteMessages}
                    toggleFavorite = {this.toggleFavorite}
                    toggleBlocked = {this.toggleBlocked}
                    togglePinned = {this.togglePinned}
                    pinned = {this.state.pinned}
                    saveConference={this.saveConference}
                    defaultDomain = {this.state.defaultDomain}
                    favoriteUris = {this.state.favoriteUris}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    saveContact = {this.saveContact}
                    deleteContact = {this.deleteContact}
                    sendPublicKey = {this.sendPublicKey}
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
                    refetchMessages = {this.refetchMessages}
                    blockedUris = {this.state.blockedUris}
                />

                <ReadyBox
                    account = {this.state.account}
                    password = {this.state.password}
                    config = {config}
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
                    sendPublicKey = {this.sendPublicKey}
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
                    fetchSharedItems = {this.fetchSharedItems}
                />

                <ImportPrivateKeyModal
                    show={this.state.showImportPrivateKeyModal}
                    close={this.hideImportPrivateKeyModal}
                    saveFunc={this.savePrivateKey}
                    generateKeysFunc={this.generateKeys}
                    privateKey={this.state.privateKey}
                    keyDifferentOnServer={this.state.keyDifferentOnServer}
                    status={this.state.privateKeyImportStatus}
                    success={this.state.privateKeyImportSuccess}
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
                    selectedDevices = {this.state.devices}
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
                declineReason = {this.state.declineReason}
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
            />
        )
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

    conferenceByUri(urlParameters) {
        const targetUri = utils.normalizeUri(urlParameters.targetUri, config.defaultConferenceDomain);
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
        this.mustLogout = false;

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
                    registrationInProgress = {this.state.registrationState !== null && this.state.registrationState !== 'failed'}
                    handleRegistration = {this.handleRegistration}
                    handleEnrollment = {this.handleEnrollment}
                    autoLogin={this.state.autoLogin}
                    orientation = {this.state.orientation}
                    isTablet = {this.state.isTablet}
                    phoneNumber= {this.state.phoneNumber}
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
        this.syncRequested = false;
        this.serverPublicKey = null;
        this.serverQueriedForPublicKey = false;
        this.callKeeper.setAvailable(false);
        this.sql_contacts_keys = [];

        if (!this.mustLogout && this.state.registrationState !== null && this.state.connection && this.state.connection.state === 'ready') {
            // remove token from server
            this.mustLogout = true;
            //console.log('Remove push token');
            this.state.account.setDeviceToken('None', Platform.OS, deviceId, true, bundleId);
            //console.log('Unregister');
            this.state.account.register();
            return;
        } else if (this.mustLogout && this.state.connection && this.state.account) {
            //console.log('Unregister');
            this.state.account.unregister();
        }

        this.tokenSent = false;
        if (this.state.connection && this.state.account) {
            //console.log('Remove account');
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    logger.debug(error);
                }
            });
        }

        storage.set('account', {accountId: this.state.accountId,
                                password: this.state.password,
                                verified: false
                                });

        this.setState({account: null,
                       displayName: '',
                       email: '',
                       contactsLoaded: false,
                       registrationState: null,
                       registrationKeepalive: false,
                       status: null,
                       keys: null,
                       lastSyncId: null,
                       accountVerified: false,
                       autoLogin: false,
                       myContacts: {},
                       defaultDomain: config.defaultDomain,
                       purgeMessages: [],
                       updateContactUris: {},
                       replicateContacts: {},
                       deletedContacts: {}
                       });

        this.mustLogout = false;
        this.changeRoute('/login', 'user logout');

        return null;
    }

    main() {
        return null;
    }
}

export default Sylk;
