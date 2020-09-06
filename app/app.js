import React, { Component, Fragment } from 'react';
import { Alert, View, SafeAreaView, ImageBackground, AppState, Linking, Platform, StyleSheet, Vibration, PermissionsAndroid} from 'react-native';
import { DeviceEventEmitter } from 'react-native';
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
import Contacts from 'react-native-contacts';
import BackgroundTimer from 'react-native-background-timer';

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
import IncomingCallModal from './components/IncomingCallModal';
import NotificationCenter from './components/NotificationCenter';
import LoadingScreen from './components/LoadingScreen';
import NavigationBar from './components/NavigationBar';
import Preview from './components/Preview';
import CallManager from "./CallManager";

import utils from './utils';
import config from './config';
import storage from './storage';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

const logger = new Logger("App");

function checkIosPermissions() {
    return new Promise(resolve => PushNotificationIOS.checkPermissions(resolve));
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

const ONE_SECOND_IN_MS = 1000;

const VIBRATION_PATTERN = [
    1 * ONE_SECOND_IN_MS,
    1 * ONE_SECOND_IN_MS,
    4 * ONE_SECOND_IN_MS
  ];


let bundleId = `${getBundleId()}`;
const deviceId = getUniqueId();

const version = '1.0.0';


if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    // bundleId = `${bundleId}.dev`;
}

const mainStyle = StyleSheet.create({

 MainContainer: {
   flex: 1,
   justifyContent: 'center',
   alignItems: 'center',
   margin: 0
 }
});


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

const requestCameraPermission = async () => {
    if (Platform.OS !== 'android') {
        return;
    }

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
            //console.log("You can use the microphone");
        } else {
            console.log("Microphone permission denied");
        }
    } catch (err) {
        console.warn(err);
    }
};


class Sylk extends Component {
    constructor() {
        super();
        autoBind(this)
        this._loaded = false;
        this._initialState = {
            appState: 'active',
            inFocus: false,
            accountId: '',
            password: '',
            displayName: '',
            account: null,
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
            outgoingMedia: null,
            hardware: '',
            phoneNumber: '',
            isTablet: isTablet(),
            refreshHistory: false,
            myDisplayName: null,
            myPhoneNumber: null,
            localHistory: [],
            favoriteUris: [],
            blockedUris: [],
            initialUrl: null,
            reconnectingCall: false,
            muted: false,
            participantsToInvite: null,
            myInvitedParties: null,
            defaultDomain: config.defaultDomain
        };

        this.tokenSent = false;
        this.currentRoute = null;
        this.pushtoken = null;
        this.pushkittoken = null;
        this.intercomDtmfTone = null;
        this.registrationFailureTimer = null;
        this.contacts = [];
        this.startedByPush = false;

        this.cachedHistory = []; // used for caching server history

        this.state = Object.assign({}, this._initialState);
        this.runtime = Object();

        this.myParticipants = {};

        this._historyConferenceParticipants = new Map(); // for saving to local history

        this._terminatedCalls = new Map();

        this.__notificationCenter = null;

        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.goToReadyTimer = null;
        storage.initialize();

        this._callKeepManager = new CallManager(RNCallKeep,
                                                this.acceptCall,
                                                this.rejectCall,
                                                this.hangupCall,
                                                this.timeoutCall,
                                                this.callKeepStartConference,
                                                this.startCallFromCallKeeper,
                                                this.toggleMute,
                                                this.getConnection,
                                                this.addConferenceHistoryEntry,
                                                this.changeRoute);

        if (InCallManager.recordPermission !== 'granted') {
            InCallManager.requestRecordPermission()
            .then((requestedRecordPermissionResult) => {
                console.log("InCallManager.requestRecordPermission() requestedRecordPermissionResult: ", requestedRecordPermissionResult);
            })
            .catch((err) => {
                console.log("InCallManager.requestRecordPermission() catch: ", err);
            });
        }

        requestCameraPermission();

        // Load camera/mic preferences
        storage.get('devices').then((devices) => {
            if (devices) {
                this.setState({devices: devices});
            }
        });

        storage.get('history').then((history) => {
            if (history) {
                console.log('Loaded', history.length, 'local history entries');
                this.setState({localHistory: history});
            } else {
                console.log('Loaded 0 local history entries');
            }
        });

        storage.get('cachedHistory').then((history) => {
            if (history) {
                console.log('Loaded', history.length, 'cached history entries');
                this.cachedHistory = history;
            }
        });

        storage.get('myParticipants').then((myParticipants) => {
            if (myParticipants) {
                this.myParticipants = myParticipants;
                //console.log('My participants', this.myParticipants);
            }
        });

        storage.get('myInvitedParties').then((myInvitedParties) => {
            if (myInvitedParties) {
                if (Array.isArray(myInvitedParties)) {
                    myInvitedParties = null;
                }
                this.myInvitedParties = myInvitedParties;
                //console.log('My invited parties', this.myInvitedParties);
                this.setState({myInvitedParties: this.myInvitedParties});
            }
        });

        storage.get('favoriteUris').then((favoriteUris) => {
            if (favoriteUris) {
                this.setState({favoriteUris: favoriteUris});
            }
        });

        storage.get('blockedUris').then((blockedUris) => {
            if (blockedUris) {
                this.setState({blockedUris: blockedUris});
                //console.log('My blocked Uris', blockedUris);
            }
        });

    }

    async loadContacts() {
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
                    }

                    //console.log(name);
                    contact['phoneNumbers'].forEach(function (number, index) {
                        let number_stripped =  number['number'].replace(/\s|\-|\(|\)/g, '');
                        if (number_stripped) {
                            if (!seen_uris.has(number_stripped)) {
                                //console.log('   ---->    ', number['label'], number_stripped);
                                var contact_card = {id: uuid.v4(), displayName:
                                                    name, remoteParty: number_stripped,
                                                    type: 'contact',
                                                    photo: photo,
                                                    label: number['label'],
                                                    tags: ['contact']};
                                contact_cards.push(contact_card);
                                seen_uris.set(number_stripped, true);
                                var contact_card = {id: uuid.v4(),
                                                    displayName: name,
                                                    remoteParty: number_stripped,
                                                    type: 'contact',
                                                    photo: photo,
                                                    label: number['label'],
                                                    tags: ['contact']
                                                    };
                            }
                        }
                    });

                    contact['emailAddresses'].forEach(function (email, index) {
                        let email_stripped =  email['email'].replace(/\s|\(|\)/g, '');
                        if (!seen_uris.has(email_stripped)) {
                            //console.log(name, email['label'], email_stripped);
                            //console.log('   ---->    ', email['label'], email_stripped);
                            var contact_card = {id: uuid.v4(),
                                                displayName: name,
                                                remoteParty: email_stripped,
                                                type: 'contact',
                                                photo: photo,
                                                label: email['label'],
                                                tags: ['contact']
                                                };
                            contact_cards.push(contact_card);
                            seen_uris.set(email_stripped, true);
                        }
                    });
                }

              this.contacts = contact_cards;

              if (this.state.myPhoneNumber) {
                  var myContact = this.findObjectByKey(contact_cards, 'remoteParty', this.state.myPhoneNumber);
                  if (myContact) {
                      this.setState({myDisplayName: myContact.displayName});
                  }
              }
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
        if (this.currentRoute === route) {
            return;
        }

        if (this.currentRoute !== route) {
            utils.timestampedLog('Change route:', this.currentRoute, '->', route, reason);
        }

        if (route === '/ready') {
            this.startedByPush = false;
            this.setState({
                            outgoingMedia: null,
                            outgoingCallUUID: null,
                            currentCall: null,
                            incomingCall: (reason === 'accept_new_call' || reason === 'user_press_hangup') ? this.state.incomingCall: null,
                            targetUri: '',
                            reconnectingCall: false,
                            localMedia: null,
                            muted: false,
                            participantsToInvite: null
                            });

            if (this.currentRoute === '/call' || this.currentRoute === '/conference') {
                if (reason !== 'user_press_hangup') {
                    this.stopRingback();
                    InCallManager.stop();
                }

                if (reason !== 'accept_new_call') {
                    this.closeLocalMedia();
                }

                if (this.state.account && reason !== 'accept_new_call' && this._loaded) {
                    setTimeout(() => {
                        this.updateServerHistory()
                    }, 1500);
                }
            }

            if (reason === 'registered') {
                setTimeout(() => {
                    this.updateServerHistory()
                }, 1500);
            }

            if (reason === 'no_more_calls') {
                this.updateServerHistory()
            }
        }

        this.currentRoute = route;
        history.push(route);

    }

    componentWillUnmount() {
        console.log('App will unmount');
        AppState.removeEventListener('change', this._handleAppStateChange);
        this.shutdownConnection('exit');
        this._loaded = false;
    }

    async componentDidMount() {
        this._loaded = true;
        console.log('App did mount');
        // Start a timer that runs once after X milliseconds
        BackgroundTimer.runBackgroundTimer(() => {
            // this will be executed once after 10 seconds
            // even when app is the the background
            this.heartbeat();
        }, 5000);

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

        this.changeRoute('/login', 'start up');

        // prime the ref
        //logger.debug('NotificationCenter ref: %o', this._notificationCenter);

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
        this._boundOnPushRegistered = this._onPushRegistered.bind(this);

        this._detectOrientation();

        getPhoneNumber().then(phoneNumber => {
            this.setState({myPhoneNumber: phoneNumber});
            this.loadContacts();
        });

        this.listenforPushNotifications();
    }

    listenforPushNotifications() {
        if (Object.id(this.runtime) > 1) {
            return;
        }

        utils.timestampedLog('---- Add push notifications listeners');

        if (Platform.OS === 'android') {
            Linking.getInitialURL().then((url) => {
                if (url) {
                      utils.timestampedLog('Initial external URL: ' + url);
                      this.eventFromUrl(url);
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

            VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
            VoipPushNotification.registerVoipToken();

            PushNotificationIOS.addEventListener('register', this._boundOnPushRegistered);

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
            utils.timestampedLog('Adding iOS push notifications listeners');
            VoipPushNotification.addEventListener('notification', this._boundOnNotificationReceivedBackground);
            VoipPushNotification.addEventListener('localNotification', this._boundOnLocalNotificationReceivedBackground);
        } else if (Platform.OS === 'android') {
            utils.timestampedLog('Adding Android push notifications listeners');
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

                    utils.timestampedLog('Handle Firebase', event, 'PUSH notification for call', callUUID);

                    if (event === 'incoming_conference_request') {
                        this.incomingConference(callUUID, to, from);
                    } else if (event === 'incoming_session') {
                        this.incomingCallFromPush(callUUID, from);
                    } else if (event === 'cancel') {
                        this.cancelIncomingCall(callUUID);
                    }

                });
        }
    }

    cancelIncomingCall(callUUID) {
        utils.timestampedLog('Cancelling incoming call...', callUUID);

        if (this._callKeepManager._acceptedCalls.has(callUUID)) {
            utils.timestampedLog('Push call was already accepted', callUUID);
            return;
        }

        let call = this._callKeepManager._calls.get(callUUID);
        if (!call) {
            utils.timestampedLog('Cancel incoming call that did not arrive on web socket', callUUID);
            this._callKeepManager.endCall(callUUID, 2);
            this.startedByPush = false;
            if (this.startedByPush) {
                this.changeRoute('/ready', 'incoming_call_cancelled');
            }
            return;
        }

        if (call.state === 'incoming') {
            utils.timestampedLog('Cancel incoming call that was not yet accepted', callUUID);
            this._callKeepManager.endCall(callUUID, 2);
            if (this.startedByPush) {
                this.changeRoute('/ready', 'incoming_call_cancelled');
            }
        } else {
            utils.timestampedLog('Call on web socket was already accepted', callUUID, call.state);
        }
    }

    _proximityDetect(data) {
        return;

        if (data.isNear) {
           this.speakerphoneOff();
        } else {
           this.speakerphoneOn();
        }
    }

    startCallWhenReady(targetUri, options) {
        this.resetGoToReadyTimer();

        if (options.video) {
            this.speakerphoneOn();
        }

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
        utils.timestampedLog('Set VoIP pushkit token', token);
        this.pushkittoken = token;
    }

    _onPushRegistered(token) {
        utils.timestampedLog('Set background push token', token);
        this.pushtoken = token;
    }

    _sendPushToken() {
        if (this.state.account && this.pushtoken && !this.tokenSent) {
            let token = null;

            if (Platform.OS === 'ios') {
                token = `${this.pushkittoken}#${this.pushtoken}`;
            } else if (Platform.OS === 'android') {
                token = this.pushtoken;
            }
            utils.timestampedLog('Push token', token, 'sent to server');
            this.state.account.setDeviceToken(token, Platform.OS, deviceId, true, bundleId);
            this.tokenSent = true;
        }
    }

    _handleAndroidFocus = nextFocus => {
        utils.timestampedLog('--- APP is in focus');
        this.setState({inFocus: true});
        this.respawnConnection();
    }

    _handleAndroidBlur = nextBlur => {
        utils.timestampedLog('--- APP is out of focus');
        this.setState({inFocus: false});
    }

    _handleAppStateChange = nextAppState => {
        if (nextAppState === this.state.appState) {
            return;
        }

        /*
        if (this._callKeepManager.countCalls) {
            utils.timestampedLog('--- APP state changed, we have', this._callKeepManager.countCalls, 'calls');
        }

        if (this._callKeepManager.countPushCalls) {
            utils.timestampedLog('--- APP state changed, we have', this._callKeepManager.countPushCalls, 'push calls');
        }

        if (this.startedByPush) {
            utils.timestampedLog('--- APP state changed, started by push in', nextAppState, 'state');
        } else {
            utils.timestampedLog('--- APP state changed, not started by push in', nextAppState, 'state');
        }
        */

        if (this._callKeepManager.countCalls === 0 && !this.state.outgoingCallUUID) {
            /*
            if (this.state.connection) {
                utils.timestampedLog('--- APP state changed from', this.state.appState, 'to', nextAppState, 'with connection', Object.id(this.state.connection));
            } else {
                utils.timestampedLog('--- APP state changed from', this.state.appState, 'to', nextAppState);
            }
            */

            if (this.state.appState === 'background' && nextAppState === 'active') {
                this.respawnConnection(nextAppState);
            } else if (nextAppState === 'background') {
                this.shutdownConnection(nextAppState);
            }
        }

        this.setState({appState: nextAppState});
        if (Platform.OS !== 'android') {
            this.setState({inFocus: (nextAppState === 'active') ? true : false});
        }
    }

    respawnConnection(state) {
        //utils.timestampedLog('Respawning connection...');

        if (!this.state.connection) {
            utils.timestampedLog('Web socket does not exist');
        } else if (!this.state.connection.state) {
            //utils.timestampedLog('Web socket waiting for connection');
        } else {
            utils.timestampedLog('Web socket state is', this.state.connection.state);
            if (this.state.connection.state === 'closed') {
                this.setState({connection: null});
            }
        }

        if (this.state.account) {
            if (!this.state.connection) {
                utils.timestampedLog('Active account without connection removed');
                this.setState({account: null});
            } else {
                utils.timestampedLog('Active account', this.state.account.id);
            }
        } else {
            //utils.timestampedLog('No active account');
        }

        if (this.state.accountId && (!this.state.connection || !this.state.account)) {
            this.handleRegistration(this.state.accountId, this.state.password);
        }
    }

    shutdownConnection(state) {
        //utils.timestampedLog('Shut down connection in state', state);
        if (this.startedByPush) {
            return;
        }

        if (this._callKeepManager.countPushCalls > 0) {
            return;
        }

        if (this.currentRoute === '/login') {
            return;
        }

        if (this.currentRoute === '/call') {
            return;
        }

        this.closeConnection('shutdown');

    }

    closeConnection(reason) {
        //utils.timestampedLog('Closing connection because', reason);

        if (!this.state.connection) {
            return;
        }

        if (!this.state.account && this.state.connection) {
            //this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
            this.state.connection.close();
            utils.timestampedLog('Web socket will close');
            this.setState({connection: null, account: null});
        } else if (this.state.connection && this.state.account) {
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    if (error) {
                        utils.timestampedLog('Failed to remove account:', error);
                    } else {
                        utils.timestampedLog('Account removed');
                    }

                    if (this.state.connection) {
                        utils.timestampedLog('Web socket', 'will close');
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
        // like from native iOS history
        //utils.timestampedLog("CallKeep started call from outside the app to", data.handle);
        // we dont have options in the tmp var, which means this likely came from the native dialer
        // for now, we only do audio calls from the native dialer.
        let callUUID = data.callUUID || uuid.v4();
        let is_conf = data.handle.search('videoconference.') === -1 ? false: true;
        if (is_conf) {
            this.callKeepStartConference(data.handle, {audio: true, video: true, callUUID: callUUID});
        } else {
            this.callKeepStartCall(data.handle, {audio: true, video: false, callUUID: callUUID});
        }
        this._notificationCenter.removeNotification();
    }

    connectionStateChanged(oldState, newState) {
        if (!this._loaded) {
            return;
        }

        if (oldState) {
            utils.timestampedLog('Web socket state changed:', oldState, '->' , newState);
        }

        switch (newState) {
            case 'closed':
                if (this.state.connection) {
                    utils.timestampedLog('Web socket was terminated');
                    this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
                }
                this.setState({connection: null, account: null});
                this._callKeepManager.setAvailable(false);
                if (this.state.inFocus) {
                    this.respawnConnection();
                }
                break;
            case 'ready':
                this._notificationCenter.removeNotification();
                this.processRegistration(this.state.accountId, this.state.password, this.state.displayName);
                this._callKeepManager.setAvailable(true);
                break;
            case 'disconnected':
                if (this.registrationFailureTimer) {
                    clearTimeout(this.registrationFailureTimer);
                    this.registrationFailureTimer = null;
                }

                this._callKeepManager.setAvailable(false);
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

                break;
            default:
                this._callKeepManager.setAvailable(false);
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
        utils.timestampedLog('Registration error: ' + reason);
        this.setState({
            loading     : null,
            registrationState: 'failed',
            status      : {
                msg   : 'Sign In failed: ' + reason,
                level : 'danger'
            }
        });
    }

    registrationStateChanged(oldState, newState, data) {
        if (!this._loaded) {
            return;
        }

        if (oldState) {
            utils.timestampedLog('Registration state changed:', oldState, '->', newState);
        }

        if (newState === 'failed') {
            this._callKeepManager.setAvailable(false);
            let reason = data.reason;

            if (reason.match(/904|408/)) {
                // Sofia SIP: WAT
                reason = 'Wrong account or password';
            }

            this.showRegisterFailure(reason);

            if (this.startedByPush) {
                this.changeRoute('/call', 'wake from push');
            }

            if (this.state.registrationKeepalive === true) {
                if (this.state.connection !== null) {
                    utils.timestampedLog('Retry to register...');
                    //this.setState({loading: 'Register...'});
                    this._notificationCenter.postSystemNotification('Registering', {body: 'now'});
                    this.state.account.register();
                } else {
                    // add a timer to retry register after awhile
                    utils.timestampedLog('Retry to register after a delay...');
                    setTimeout(this.state.account.register(), 5000);
                }
            }
        } else if (newState === 'registered') {
            if (this.registrationFailureTimer) {
                clearTimeout(this.registrationFailureTimer);
                this.registrationFailureTimer = null;
            }

            this._callKeepManager.setAvailable(true);
            this.setState({loading: null,
                           registrationKeepalive: true,
                           registrationState: 'registered',
                           defaultDomain: this.state.account.id.split('@')[1]
                           });

            if (this.currentRoute === '/login' && !this.startedByPush) {
                this.changeRoute('/ready', 'registered');
            }
            return;
        } else {
            this.setState({status: null, registrationState: newState });
            this._callKeepManager.setAvailable(false);
        }
    }

    showInternalAlertPanel() {
        this.setState({showIncomingModal: true});
        Vibration.vibrate(VIBRATION_PATTERN, true);
    }

    hideInternalAlertPanel() {
        Vibration.cancel();
        this.setState({showIncomingModal: false});
    }

    heartbeat() {
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
                this.closeConnection('background with no calls');
            }
        }

        this._callKeepManager.heartbeat();

        if (callState === 'established' || callState === 'established') {
            const nextRoute = this.isConference() ? '/conference' : '/call';
            this.changeRoute(nextRoute, 'correct call state');
        }
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

    isConference(call) {
        const _call = call || this.state.currentCall;

        if (_call && _call.hasOwnProperty('_participants')) {
            return true;
        }

        return false;
    }

    callStateChanged(oldState, newState, data) {
        if (!this._loaded) {
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

        let call = this._callKeepManager._calls.get(data.id);

        if (!call) {
            utils.timestampedLog("callStateChanged error: call", data.id, 'not found in callkeep manager');
            console.log(data);
            return;
        }

        let callUUID = call.id;
        utils.timestampedLog('Call', callUUID, 'state change:', oldState, '->', newState);

        if (newState === 'established' || newState === 'accepted') {
            // restore the correct UI state if it has transitioned illegally to /ready state
            if (call.hasOwnProperty('_participants')) {
                this.changeRoute('/conference', 'correct call state');
            } else {
                this.changeRoute('/call', 'correct call state');
            }
        }

        let newCurrentCall;
        let newincomingCall;
        let direction = call.direction;
        let hasVideo = false;
        let mediaType = 'audio';
        let tracks;
        let readyDelay = 4000;

        if (this.state.incomingCall && this.state.currentCall) {
            if (this.state.incomingCall != this.state.currentCall) {
                //utils.timestampedLog('Call state changed: We have two calls');
            } else {
                //utils.timestampedLog('Call state changed: we have two calls the same');
            }

            if (newState === 'terminated') {
                if (this.state.incomingCall == this.state.currentCall) {
                    //utils.timestampedLog('Call state changed:', 'incoming call is the current call');
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

        switch (newState) {
            case 'progress':
                this.backToForeground();

                this.resetGoToReadyTimer();

                if (!this.isConference(call)){
                    if (Platform.OS === 'android') {
                        tracks = call.getLocalStreams()[0].getVideoTracks();
                        hasVideo = (tracks && tracks.length > 0) ? true : false;
                    }
                    //utils.timestampedLog('Play ringback tone');
                    InCallManager.startRingback('_BUNDLE_');
                }

                break;
            case 'established':
                this.backToForeground();
                this.resetGoToReadyTimer();

                if (direction === 'outgoing') {
                    this._callKeepManager.setCurrentCallActive(callUUID);
                    this.stopRingback();
                }

                tracks = call.getLocalStreams()[0].getVideoTracks();
                mediaType = (tracks && tracks.length > 0) ? 'video' : 'audio';

                //utils.timestampedLog('Start InCall manager:', mediaType);
                InCallManager.start({media: mediaType});

                if (mediaType === 'video') {
                    this.speakerphoneOn();
                } else {
                    this.speakerphoneOff();
                }

                break;
            case 'accepted':
                this.backToForeground();
                this.resetGoToReadyTimer();

                if (direction === 'outgoing') {
                    this.stopRingback();
                }

                break;

            case 'terminated':
                this._terminatedCalls.set(callUUID, true);

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
                //utils.timestampedLog('Call state changed:', 'call', callUUID, 'terminated reason:', reason);

                if (!reason || reason.match(/200/)) {
                    if (oldState === 'progress' && direction === 'outgoing') {
                        reason = 'Cancelled';
                        play_busy_tone = false;
                    } else if (oldState === 'incoming') {
                        reason = 'Cancelled';
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
                    reason = 'This domain is not served here';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/404/)) {
                    reason = 'User not found';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/408/)) {
                    reason = 'Timeout';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/480/)) {
                    reason = 'User not online';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/486/) || reason.match(/60[036]/)) {
                    reason = 'Busy';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    if (direction === 'outgoing') {
                        play_busy_tone = false;
                    }
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                    play_busy_tone = false;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/5\d\d/)) {
                    reason = 'Server failure';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/904/)) {
                    // Sofia SIP: WAT
                    reason = 'Wrong account or password';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else {
                    reason = 'Connection failed';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                }

                if (play_busy_tone) {
                    this.playBusyTone();
                }

                this.stopRingback();

                this._callKeepManager.terminateCall(callUUID);

                this._callKeepManager.endCall(callUUID, CALLKEEP_REASON);

                if (this.state.currentCall === null) {
                    //utils.timestampedLog('Call state changed:', 'Turn off speakerphone');
                    this.speakerphoneOff();
                }

                if (play_busy_tone && oldState !== 'established' && direction === 'outgoing') {
                    this._notificationCenter.postSystemNotification('Call ended:', {body: reason});
                }

                this.updateHistoryEntry(callUUID);

                if (newState === 'established' || newState === 'accepted') {
                    // restore the correct UI state if it has transitioned illegally to /ready state
                    if (call.hasOwnProperty('_participants')) {
                        this.changeRoute('/conference', 'correct call state');
                    } else {
                        this.changeRoute('/call', 'correct call state');
                    }
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

        if (this.state.currentCall || this.state.incomingCall) {
            //console.log('New call state:');

        } else {
            if (!this.state.reconnectingCall) {
                //utils.timestampedLog('Will go to ready in 4 seconds');

                this.goToReadyTimer = setTimeout(() => {

                    this.changeRoute('/ready', 'no_more_calls');

                }, readyDelay);
            }
        }

        if (this.state.currentCall) {
            //console.log('Current:', this.state.currentCall.id);
        }
        if (this.state.incomingCall) {
            //console.log('Incoming:', this.state.incomingCall.id);
        }

    }

    handleRegistration(accountId, password, remember=true) {
        if (this.state.account !== null) {
            utils.timestampedLog('We are already registered with', accountId);
            return;
        }

        this.setState({
            accountId : accountId,
            password  : password,
            loading   : 'Connecting...'
        });

        if (this.state.connection === null) {
            utils.timestampedLog('Websocket handle registration for', accountId);

            const userAgent = 'Sylk Mobile';
            if (this.state.phoneNumber) {
                console.log('Phone number:', this.state.phoneNumber);
            }

            let connection = sylkrtc.createConnection({server: config.wsServer, userAgent: {name: userAgent, version: version}});
            utils.timestampedLog('Web socket', Object.id(connection), 'was opened');
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});

            if (this.startedByPush) {
                this.changeRoute('/call', 'started by push');
            }

        } else {
            if (this.state.connection.state === 'ready' && this.state.registrationState === null) {
                utils.timestampedLog('Websocket handle registration for', accountId);
                this.processRegistration(accountId, password, '');
            }
        }
    }

    processRegistration(accountId, password, displayName) {
        utils.timestampedLog('Process registration for', accountId);
        this.updateServerHistory();
        if (!this.state.connection) {
            utils.timestampedLog('Process registration aborted');
            return;
        }
        if (this.state.account && this.state.connection) {
            utils.timestampedLog('We already have an account, removing it');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    this.setState({registrationState: null, registrationKeepalive: false});
                }
            );
        }

        const options = {
            account: accountId,
            password: password,
            displayName: displayName
        };

        if (this.state.connection._accounts.has(options.account)) {
            return;
        }

        this.registrationFailureTimer = setTimeout(this.showRegisterFailure, 10000, 'Register timeout');

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingConference);
                account.on('registrationStateChanged', this.registrationStateChanged);
                account.on('incomingCall', this.incomingCallFromWebSocket);
                account.on('missedCall', this.missedCall);
                account.on('conferenceInvite', this.conferenceInviteFromWebSocket);
                utils.timestampedLog('Web socket account', account.id, 'is ready');
                this.setState({account: account});
                this._sendPushToken();
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
        utils.timestampedLog('Get local media for', callType);
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
            utils.timestampedLog('Local media acquired');
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

    callKeepStartConference(targetUri, options={audio: true, video: true, participants: null}) {
        if (!targetUri) {
            return;
        }

        this.resetGoToReadyTimer();

        let callUUID = options.callUUID || uuid.v4();
        this._callKeepManager.setCurrentCallActive(callUUID);

        let participants = options.participants || null;
        this.addConferenceHistoryEntry(targetUri, callUUID);

        this.setState({outgoingCallUUID: callUUID,
                       outgoingMedia: options,
                       reconnectingCall: false,
                       participantsToInvite: participants
                       });

        if (participants) {
            utils.timestampedLog('CallKeep will start conference', callUUID, 'to', targetUri, 'with', participants);
        } else {
            utils.timestampedLog('CallKeep will start conference', callUUID, 'to', targetUri);
        }

        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, conference: true, callUUID: callUUID});
    }

    callKeepStartCall(targetUri, options) {
        this.resetGoToReadyTimer();
        let callUUID = options.callUUID || uuid.v4();
        this.setState({outgoingCallUUID: callUUID, reconnectingCall: false});
        utils.timestampedLog('User will start call', callUUID, 'to', targetUri);
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, callUUID: callUUID});
    }

    startCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia(Object.assign({audio: true, video: options.video}, options), '/call');
    }

    callKeepAcceptCall(callUUID) {
        // called from user interaction with Old alert panel
        // options used to be media to accept audio only but native panels do not have this feature
        utils.timestampedLog('CallKeep will answer call', callUUID);
        this._callKeepManager.acceptCall(callUUID);
        this.hideInternalAlertPanel();
    }

    callKeepRejectCall(callUUID) {
        // called from user interaction with Old alert panel
        utils.timestampedLog('CallKeep will reject call', callUUID);
        this._callKeepManager.rejectCall(callUUID);
        this.hideInternalAlertPanel();
    }

    acceptCall(callUUID) {
        utils.timestampedLog('User accepted call', callUUID, 'on connection', Object.id(this.state.connection));
        this.hideInternalAlertPanel();

        this.resetGoToReadyTimer();

        if (this.state.currentCall) {
            this.hangupCall(this.state.currentCall.id, 'accept_new_call');
        }

        let hasVideo = (this.state.incomingCall && this.state.incomingCall.mediaTypes && this.state.incomingCall.mediaTypes.video) ? true : false;
        this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
    }

    rejectCall(callUUID) {
        // called by Call Keep when user rejects call
        utils.timestampedLog('User rejected call', callUUID);
        this.hideInternalAlertPanel();
        if (!this.state.currentCall) {
            this.changeRoute('/ready', 'reject call');
        }

        if (this.state.incomingCall && this.state.incomingCall.id === callUUID) {
            this.state.incomingCall.terminate();
            utils.timestampedLog('Sylkrtc reject call', callUUID);
        }
    }

    timeoutCall(callUUID, uri) {
        utils.timestampedLog('Timeout answering call', callUUID);
        this.addConferenceHistoryEntry(uri, callUUID, direction='received');
        this.forceUpdate();
    }

    closeLocalMedia() {
        if (this.state.localMedia != null) {
            sylkrtc.utils.closeMediaStream(this.state.localMedia);
            //utils.timestampedLog('Close local media');
        }
    }

    hangupCall(callUUID, reason) {
        utils.timestampedLog('Hangup call', callUUID, 'reason:', reason);

        let call = this._callKeepManager._calls.get(callUUID);
        let direction = null;
        let targetUri = null;

        if (call) {
            let direction = call.direction;
            targetUri = call.remoteIdentity.uri;
            call.terminate();
        }

        if (this.busyToneInterval) {
            clearInterval(this.busyToneInterval);
            this.busyToneInterval = null;
        }

        if (reason === 'outgoing_connection_failed') {
             this.setState({reconnectingCall: true,
                            outgoingCallUUID: uuid.v4()});
             return;
        }

        if (reason === 'user_press_hangup') {
            this._callKeepManager.endCall(callUUID);
        }

        if (reason === 'user_cancelled' ||
            reason === 'timeout' ||
            reason === 'stop_preview' ||
            reason === 'user_press_hangup' ||
            reason === 'accept_new_call' ||
            reason === 'timeout'
            ) {
            this.changeRoute('/ready', reason);
        } else {
            if (reason !== 'escalate_to_conference') {
                setTimeout(() => {
                     //utils.timestampedLog('Will go to ready in 4 seconds');
                     this.changeRoute('/ready', 'remote ended');
                }, 4000);
            }
        }
    }

    playBusyTone() {
        //utils.timestampedLog('Play busy tone');
        InCallManager.stop({busytone: '_BUNDLE_'});
    }

    callKeepSendDtmf(digits) {
        utils.timestampedLog('Send DTMF', digits);
        if (this.state.currentCall) {
            this._callKeepManager.sendDTMF(this.state.currentCall.id, digits);
        }
    }

    toggleMute(callUUID, mute) {
        utils.timestampedLog('Toggle mute for call', callUUID, ':', mute);
        this._callKeepManager.setMutedCall(callUUID, mute);
        this.setState({muted: mute});
    }

    toggleSpeakerPhone() {
        if (this.state.speakerPhoneEnabled === true) {
            this.speakerphoneOff();
        } else {
            this.speakerphoneOn();
        }
    }

    speakerphoneOn() {
        //utils.timestampedLog('Speakerphone On');
        this.setState({speakerPhoneEnabled: true});
        InCallManager.setForceSpeakerphoneOn(true);
    }

    speakerphoneOff() {
        //utils.timestampedLog('Speakerphone Off');
        this.setState({speakerPhoneEnabled: false});
        InCallManager.setForceSpeakerphoneOn(false);
    }

    startGuestConference(targetUri) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: true, video: true});
    }

    outgoingCall(call) {
        // called by sylkrtc.js when an outgoing call starts

        const localStreams = call.getLocalStreams();
        let mediaType = 'audio';
        let hasVideo = false;

        if (localStreams.length > 0) {
            const localStream = call.getLocalStreams()[0];
            mediaType = localStream.getVideoTracks().length > 0 ? 'video' : 'audio';
            hasVideo = localStream.getVideoTracks().length > 0 ? true : false;
        }

        this._callKeepManager.startOutgoingCall(call.id, call.remoteIdentity.uri, hasVideo);

        utils.timestampedLog('Outgoing', mediaType, 'call', call.id, 'started to', call.remoteIdentity.uri);
        this._callKeepManager.addWebsocketCall(call);

        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
    }

    outgoingConference(call) {
        // called by sylrtc.js when an outgoing conference starts

        const localStreams = call.getLocalStreams();
        let mediaType = 'audio';
        let hasVideo = false;

        if (localStreams.length > 0) {
            const localStream = call.getLocalStreams()[0];
            mediaType = localStream.getVideoTracks().length > 0 ? 'video' : 'audio';
            hasVideo = localStream.getVideoTracks().length > 0 ? true : false;
        }

        utils.timestampedLog('Outgoing', mediaType, 'conference', call.id, 'started to', call.remoteIdentity.uri);
        this._callKeepManager.addWebsocketCall(call);

        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
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

        if (event === 'incoming_session') {
            utils.timestampedLog('Incoming call PUSH mobile notification for call', callUUID);
            this.incomingCallFromPush(callUUID, from);
            this.startedByPush = true;

        } else if (event === 'incoming_conference_request') {
            utils.timestampedLog('Incoming conference PUSH mobile notification for call', callUUID);
            this.incomingConference(callUUID, to, from);
            this.startedByPush = true;

        } else if (event === 'cancel') {
            utils.timestampedLog('Cancel PUSH mobile notification for call', callUUID);
            this._callKeepManager.endCall(callUUID, 2);

            VoipPushNotification.presentLocalNotification({alertBody:'Call cancelled'});
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
            this._callKeepManager.backToForeground();
        }

        if (this.state.accountId) {
            this.handleRegistration(this.state.accountId, this.state.password);
        }
    }

    incomingConference(callUUID, to, from) {
        utils.timestampedLog('Incoming conference invite from', from, 'to room', to);
        this.setState({incomingCallUUID: callUUID});
        this._callKeepManager.handleConference(callUUID, to, from);
    }

    startConference(targetUri, options={audio: true, video: true, participants: []}) {
        utils.timestampedLog('New outgoing conference to room', targetUri);
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: options.audio, video: options.video}, '/conference');
    }

    escalateToConference(participants) {
        const uri = `${utils.generateSillyName()}@${config.defaultConferenceDomain}`;
        utils.timestampedLog('Escalate call to conference', uri, 'with participants', participants);

        if (this.state.currentCall) {
            this.hangupCall(this.state.currentCall.id, 'escalate_to_conference');
            this.setState({currentCall: null});
        }

        if (this.state.incomingCall) {
            this.hangupCall(this.state.incomingCall.id, 'escalate_to_conference');
        }

        this.callKeepStartConference(uri, {audio: true, video: true, participants: participants});
    }

    conferenceInviteFromWebSocket(data) {
        // comes from web socket
        utils.timestampedLog('Conference invite from websocket', data.id, 'from', data.originator, 'for room', data.room);
        this._notificationCenter.postSystemNotification('Expecting conference invite', {body: `from ${data.originator.displayName || data.originator.uri}`});
    }

    updateLinkingURL = (event) => {
        // this handles the use case where the app is running in the background and is activated by the listener...
        //console.log('Updated Linking url', event.url);
        this.eventFromUrl(event.url);
    }

    eventFromUrl(url) {
        utils.timestampedLog('Received event from external URL:', url);

        try {
            let direction;
            let event;
            let callUUID;
            let from;
            let to;

            var url_parts = url.split("/");
            let scheme = url_parts[0];

            if (scheme === 'sylk:') {
                //sylk://outgoing/call/callUUID/to/displayName - from system dialer/history
                //sylk://incoming/conference/callUUID/from/to - when Android is asleep
                //sylk://incoming/call/callUUID/from/to - when Android is asleep
                //sylk://cancel/call/callUUID/from/to - when Android is asleep

                direction = url_parts[2];
                event     = url_parts[3];
                callUUID  = url_parts[4];
                from      = url_parts[5];
                to        = url_parts[6];
            } else {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link
                direction = 'outgoing';
                event = url_parts[3];
                callUUID = uuid.v4();
                from = url_parts[4];

                if (from.indexOf('@') === -1 && event === 'conference') {
                    from = url_parts[4] + '@' + config.defaultConferenceDomain;
                } else if (from.indexOf('@') === -1 && event === 'call') {
                    from = url_parts[4] + '@' + this.state.defaultDomain;
                }
            }

            this.setState({targetUri: from});
            this.startedByPush = true;

            if (direction === 'outgoing' && event === 'conference' && to) {
                utils.timestampedLog('Outgoing conference to', to);
                this.backToForeground();
                this.callKeepStartConference(to);

            } else if (direction === 'incoming' && event === 'conference' && from) {
                utils.timestampedLog('Incoming conference from', from);
                // allow app to wake up
                this.backToForeground();
                this.incomingConference(callUUID, to, from);

            } else if (direction === 'outgoing' && event === 'call' && from) {
                utils.timestampedLog('Outgoing call to', from);
                this.backToForeground();
                this.callKeepStartCall(from, {audio: true, video: false, callUUID: callUUID});

            } else if (direction === 'incoming' && from) {
                this.backToForeground();
                utils.timestampedLog('Incoming call from', from);
                this.incomingCallFromPush(callUUID, from, true);

            } else if (direction === 'cancel' && callUUID) {
                this.cancelIncomingCall(callUUID);
            } else {
                 utils.timestampedLog('Error: Invalid external URL structure', url);
            }
        } catch (err) {
            utils.timestampedLog('Error parsing URL', url, ":", err);
        }
    }

    autoRejectIncomingCall(callUUID, from) {
        //utils.timestampedLog('Check auto reject call from', from);
        if (this.state.blockedUris && this.state.blockedUris.indexOf(from) > -1) {
            utils.timestampedLog('Reject call', callUUID, 'from blocked URI', from);
            this._callKeepManager.rejectCall(callUUID);
            this._notificationCenter.postSystemNotification('Call rejected', {body: `from ${from}`});
            return true;
        }

        const fromDomain = '@' + from.split('@')[1]
        if (this.state.blockedUris && this.state.blockedUris.indexOf(fromDomain) > -1) {
            utils.timestampedLog('Reject call', callUUID, 'from blocked domain', fromDomain);
            this._callKeepManager.rejectCall(callUUID);
            this._notificationCenter.postSystemNotification('Call rejected', {body: `from domain ${fromDomain}`});
            return true;
        }

        if (this.state.currentCall && this.state.incomingCall && this.state.currentCall === this.state.incomingCall && this.state.incomingCall.id !== callUUID) {
            utils.timestampedLog('Reject second incoming call');
            this._callKeepManager.rejectCall(callUUID);
        }

        if (this.state.account && from === this.state.account.id && this.state.currentCall && this.state.currentCall.remoteIdentity.uri === from) {
            utils.timestampedLog('Reject call to myself', callUUID);
            this._callKeepManager.rejectCall(callUUID);
            return true;
        }

        if (this._terminatedCalls.has(callUUID)) {
            utils.timestampedLog('Reject call already terminated', callUUID);
            this.cancelIncomingCall(callUUID);
            return true;
        }

        if (this.isConference()) {
            utils.timestampedLog('Reject call while in a conference', callUUID);
            this._notificationCenter.postSystemNotification('Missed call from', {body: from});
            this._callKeepManager.rejectCall(callUUID);
            return true;
        }

        if (this.state.currentCall && this.state.currentCall.state === 'progress' && this.state.currentCall.remoteIdentity.uri !== from) {
            utils.timestampedLog('Reject call while outgoing in progress', callUUID);
            this._callKeepManager.rejectCall(callUUID);
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

    incomingCallFromPush(callUUID, from, force) {
        utils.timestampedLog('Handle incoming PUSH call', callUUID, 'from', from);

        if (this.autoRejectIncomingCall(callUUID, from)) {
            return;
        }

        //this.showInternalAlertPanel();

        if (this.autoAcceptIncomingCall(callUUID, from)) {
            return;
        }

        this.setState({targetUri: from});

        let skipNativePanel = false;

        if (!this._callKeepManager._calls.get(callUUID) || (this.state.currentCall && this.state.currentCall.direction === 'outgoing')) {
            //this._notificationCenter.postSystemNotification('Incoming call', {body: `from ${from}`});
            if (Platform.OS === 'android' && this.state.appState === 'foreground') {
                skipNativePanel = true;
            }
        }

        this._callKeepManager.incomingCallFromPush(callUUID, from, force, skipNativePanel);

    }

    incomingCallFromWebSocket(call, mediaTypes) {

        this._callKeepManager.addWebsocketCall(call);

        const callUUID = call.id;
        const from = call.remoteIdentity.uri;

        utils.timestampedLog('Handle incoming web socket call', callUUID, 'from', from, 'on connection', Object.id(this.state.connection));

        // because of limitation in Sofia stack, we cannot have more then two calls at a time
        // we can have one outgoing call and one incoming call but not two incoming calls
        // we cannot have two incoming calls, second one is automatically rejected by sylkrtc.js

        if (this.autoRejectIncomingCall(callUUID, from)) {
            return;
        }

        const autoAccept = this.autoAcceptIncomingCall(callUUID, from);

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

        this._callKeepManager.incomingCallFromWebSocket(call, autoAccept, skipNativePanel);
    }

    missedCall(data) {
        utils.timestampedLog('Missed call from ' + data.originator);
        if (!this.state.currentCall) {
            //utils.timestampedLog('Update snackbar');
            let from = data.originator.display_name || data.originator.uri;
            this._notificationCenter.postSystemNotification('Missed call', {body: `from ${from}`});
        }

        this.updateServerHistory()
    }

    updateServerHistory() {
        if (this.currentRoute === '/ready') {
            this.setState({refreshHistory: !this.state.refreshHistory});
        }
    }

    startPreview() {
        this.getLocalMedia({audio: true, video: true}, '/preview');
    }

    updateHistoryEntry(callUUID) {
        let newHistory = this.state.localHistory;
        var historyItem = this.findObjectByKey(newHistory, 'sessionId', callUUID);
        if (historyItem) {
            let current_datetime = new Date();
            let stopTime = current_datetime.getFullYear() + "-" + utils.appendLeadingZeroes(current_datetime.getMonth() + 1) + "-" + utils.appendLeadingZeroes(current_datetime.getDate()) + " " + utils.appendLeadingZeroes(current_datetime.getHours()) + ":" + utils.appendLeadingZeroes(current_datetime.getMinutes()) + ":" + utils.appendLeadingZeroes(current_datetime.getSeconds());
            historyItem.stopTime = stopTime;
            var diff = current_datetime.getTime() - historyItem.startTimeObject.getTime();
            historyItem.duration = parseInt(diff/1000);
            delete historyItem['startTimeObject'];
            if (this._historyConferenceParticipants.has(callUUID)) {
                historyItem.participants = this._historyConferenceParticipants.get(callUUID);
            } else {
                historyItem.participants = [];
            }
            //console.log('Save history', historyItem);
            this.setState({localHistory: newHistory});
            storage.set('history', newHistory);
        }
    }

    setFavoriteUri(uri) {
        let favoriteUris = this.state.favoriteUris;
        let idx = favoriteUris.indexOf(uri);
        let ret;

        if (idx === -1) {
            favoriteUris.push(uri);
            ret = true;

        } else {
            let removed = favoriteUris.splice(idx, 1);
            ret = false;
        }

        storage.set('favoriteUris', favoriteUris);
        this.setState({favoriteUris: favoriteUris});
        return ret;
    }

    setBlockedUri(uri) {
        let blockedUris = this.state.blockedUris;
        console.log('Old blocked Uris:', blockedUris);

        let ret;
        let idx = blockedUris.indexOf(uri);

        if (idx === -1) {
            blockedUris.push(uri);
            ret = true;
        } else {
            let removed = blockedUris.splice(idx, 1);
            console.log('Removed', removed);
            ret = false;
        }

        console.log('New blocked Uris:', blockedUris);
        storage.set('blockedUris', blockedUris);
        this.setState({blockedUris: blockedUris});
        return ret;
    }

    saveParticipant(callUUID, room, uri) {
        console.log('Save participant', uri, 'for conference', room);

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

    saveInvitedParties(room, uris) {
        room = room.split('@')[0];
        console.log('Save invited parties', uris, 'for room', room);

        if (!this.myInvitedParties) {
            this.myInvitedParties = new Object();
        }

        if (this.myInvitedParties.hasOwnProperty(room)) {
            let old_uris = this.myInvitedParties[room];
            uris.forEach((uri) => {
                if (old_uris.indexOf(uri) === -1 && uri !== this.state.account.id && (uri + '@' + this.state.defaultDomain) !== this.state.account.id) {
                    this.myInvitedParties[room].push(uri);
                }
            });

        } else {
            let new_uris = [];
            uris.forEach((uri) => {
                if (uri !== this.state.account.id && (uri + '@' + this.state.defaultDomain) !== this.state.account.id) {
                    new_uris.push(uri);
                }
            });

            if (new_uris) {
                this.myInvitedParties[room] = new_uris;
            }
        }

        storage.set('myInvitedParties', this.myInvitedParties);
        this.setState({myInvitedParties: this.myInvitedParties});
    }

    deleteHistoryEntry(uri) {
        let history = this.state.localHistory;
        for (var i = history.length - 1; i >= 0; --i) {
            if (history[i].remoteParty === uri) {
                history.splice(i,1);
            }
        }

        storage.set('history', history);
        this.setState({localHistory: history});
    }

    addConferenceHistoryEntry(uri, callUUID, direction='placed', participants=[]) {
        let current_datetime = new Date();
        let startTime = current_datetime.getFullYear() + "-" + utils.appendLeadingZeroes(current_datetime.getMonth() + 1) + "-" + utils.appendLeadingZeroes(current_datetime.getDate()) + " " + utils.appendLeadingZeroes(current_datetime.getHours()) + ":" + utils.appendLeadingZeroes(current_datetime.getMinutes()) + ":" + utils.appendLeadingZeroes(current_datetime.getSeconds());

        let item = {
                    remoteParty: uri,
                    direction: direction,
                    type: 'history',
                    conference: true,
                    participants: participants,
                    media: ['audio', 'video'],
                    displayName: uri.split('@')[0],
                    sessionId: callUUID,
                    startTime: startTime,
                    stopTime: startTime,
                    startTimeObject: current_datetime,
                    duration: 0,
                    tags: ['history', 'local']
                    };

        const historyItem = Object.assign({}, item);
        let newHistory = this.state.localHistory;
        newHistory.push(historyItem);
        this.setState({localHistory: newHistory});
        storage.set('history', newHistory);
    }

    render() {
        //utils.timestampedLog('Render main app');
        let footerBox = <View style={styles.footer}><FooterBox /></View>;

        let extraStyles = {};

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
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
                                contacts = {this.contacts}
                            />

                            <LoadingScreen
                            text={this.state.loading}
                            show={this.state.loading !== null && this.currentRoute === '/login'}
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

    saveHistoryForLater(history) {
        //console.log('Cache history for later', history.length)
        this.cachedHistory = history;
        storage.set('cachedHistory', history);
    }

    ready() {
        return (
            <Fragment>
                <NavigationBar
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
                    logout = {this.logout}
                    preview = {this.startPreview}
                    connection = {this.state.connection}
                    registration = {this.state.registrationState}
                    orientation = {this.state.orientation}
                    isTablet = {this.state.isTablet}
                />
                <ReadyBox
                    account = {this.state.account}
                    password = {this.state.password}
                    config = {config}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    missedTargetUri = {this.state.missedTargetUri}
                    orientation = {this.state.orientation}
                    contacts = {this.contacts}
                    isTablet = {this.state.isTablet}
                    localHistory = {this.state.localHistory}
                    refreshHistory = {this.state.refreshHistory}
                    cacheHistory = {this.saveHistoryForLater}
                    serverHistory = {this.cachedHistory}
                    myDisplayName = {this.state.myDisplayName}
                    myPhoneNumber = {this.state.myPhoneNumber}
                    deleteHistoryEntry = {this.deleteHistoryEntry}
                    saveInvitedParties = {this.saveInvitedParties}
                    myInvitedParties = {this.state.myInvitedParties}
                    setFavoriteUri = {this.setFavoriteUri}
                    setBlockedUri = {this.setBlockedUri}
                    favoriteUris = {this.state.favoriteUris}
                    blockedUris = {this.state.blockedUris}
                    defaultDomain = {this.state.defaultDomain}
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

        return (
            <Call
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                call = {call}
                connection = {this.state.connection}
                registrationState = {this.state.registrationState}
                localMedia = {this.state.localMedia}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.hangupCall}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                callKeepSendDtmf = {this.callKeepSendDtmf}
                toggleMute = {this.toggleMute}
                callKeepStartCall = {this.callKeepStartCall}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                speakerphoneOn = {this.speakerphoneOn}
                speakerphoneOff = {this.speakerphoneOff}
                callUUID = {this.state.outgoingCallUUID}
                contacts = {this.contacts}
                intercomDtmfTone = {this.intercomDtmfTone}
                orientation = {this.state.orientation}
                isTablet = {this.state.isTablet}
                reconnectingCall = {this.state.reconnectingCall}
                muted = {this.state.muted}
            />
        )
    }

    conference() {
        let _previousParticipants = new Set();

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

        if (this.myInvitedParties) {
            let room = this.state.targetUri.split('@')[0];
            if (this.myInvitedParties.hasOwnProperty(room)) {
                let uris = this.myInvitedParties[room];
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

        let previousParticipants = Array.from(_previousParticipants);

        return (
            <Conference
                notificationCenter = {this.notificationCenter}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                connection = {this.state.connection}
                registrationState = {this.state.registrationState}
                currentCall = {this.state.currentCall}
                saveParticipant = {this.saveParticipant}
                saveInvitedParties = {this.saveInvitedParties}
                previousParticipants = {previousParticipants}
                participantsToInvite = {this.state.participantsToInvite}
                hangupCall = {this.hangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                toggleMute = {this.toggleMute}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                callUUID = {this.state.outgoingCallUUID}
                proposedMedia = {this.state.outgoingMedia}
                isLandscape = {this.state.orientation === 'landscape'}
                isTablet = {this.state.isTablet}
                muted = {this.state.muted}
                defaultDomain = {this.state.defaultDomain}
                startedByPush = {this.startedByPush}
                inFocus = {this.state.inFocus}
                reconnectingCall = {this.state.reconnectingCall}
            />
        )
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
                    autoLogin={true}
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
        this._callKeepManager.setAvailable(false);

        if (this.state.registrationState !== null) {
            this.state.account.unregister();
        }

        if (this.state.connection && this.state.account) {
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    logger.debug(error);
                }
            });
        }
        storage.set('account', {accountId: this.state.accountId, password: ''});
        this.serverHistory = [];
        this.setState({account: null,
                       registrationState: null,
                       registrationKeepalive: false,
                       status: null,
                       history: [],
                       localHistory: [],
                       cachedHistory: [],
                       defaultDomain: config.defaultDomain
                       });
        this.changeRoute('/login');
        return null;
    }

    main() {
        return null;
    }
}

export default Sylk;
