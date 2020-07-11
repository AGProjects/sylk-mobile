import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, ImageBackground, PermissionsAndroid, AppState, Linking, Platform, StyleSheet} from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { BreadProvider } from "material-bread";
import { registerGlobals } from 'react-native-webrtc';
import { Router, Route, Link, Switch } from 'react-router-native';
import history from './history';
import Logger from "../Logger";
import DigestAuthRequest from 'digest-auth-request';
import autoBind from 'auto-bind';
import { firebase } from '@react-native-firebase/messaging';
import VoipPushNotification from 'react-native-voip-push-notification';
import uuid from 'react-native-uuid';
import { getUniqueId, getBundleId, getManufacturer } from 'react-native-device-info';
import RNDrawOverlay from 'react-native-draw-overlay';
import PushNotificationIOS from "@react-native-community/push-notification-ios";
import Contacts from 'react-native-contacts';
import DeviceInfo from 'react-native-device-info';

registerGlobals();

import * as sylkrtc from 'sylkrtc';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep, { CONSTANTS as CK_CONSTANTS } from 'react-native-callkeep';

import RegisterBox from './components/RegisterBox';
import ReadyBox from './components/ReadyBox';
import Call from './components/Call';
import CallByUriBox from './components/CallByUriBox';
import Conference from './components/Conference';
import ConferenceByUriBox from './components/ConferenceByUriBox';
// import AudioPlayer from './components/AudioPlayer';
// import ErrorPanel from './components/ErrorPanel';
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

let bundleId = `${getBundleId()}`;
const deviceId = getUniqueId();

const version = '1.0.0';


if (Platform.OS == 'ios') {
    bundleId = `${bundleId}.${__DEV__ ? 'dev' : 'prod'}`;
    // bundleId = `${bundleId}.dev`;
}

const callkeepOptions = {
    ios: {
        appName: 'Sylk',
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 2,
        supportsVideo: true,
        includesCallsInRecents: true,
        imageName: "Image-1"
    },
    android: {
        alertTitle: 'Calling account permission',
        alertDescription: 'Please allow Sylk inside All calling accounts',
        cancelButton: 'Deny',
        okButton: 'Allow',
        imageName: 'phone_account_icon',
        additionalPermissions: [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.READ_CONTACTS]
    }
};

const mainStyle = StyleSheet.create({

 MainContainer: {
   flex: 1,
   justifyContent: 'center',
   alignItems: 'center',
   margin: 0
 }
});

RNCallKeep.setup(callkeepOptions);

// Application modes
const MODE_NORMAL           = Symbol('mode-normal');
const MODE_PRIVATE          = Symbol('mode-private');
const MODE_GUEST_CALL       = Symbol('mode-guest-call');
const MODE_GUEST_CONFERENCE = Symbol('mode-guest-conference');



class Sylk extends Component {
    constructor() {
        super();
        autoBind(this)
        this._loaded = false;
        this._initialSstate = {
            accountId: '',
            password: '',
            displayName: '',
            account: null,
            registrationState: null,
            registrationKeepalive: false,
            inboundCall: null,
            currentCall: null,
            isConference: false,
            connection: null,
            showIncomingModal: false,
            showScreenSharingModal: false,
            status: null,
            targetUri: '',
            missedTargetUri: '',
            loading: null,
            mode: MODE_PRIVATE,
            localMedia: null,
            generatedVideoTrack: false,
            history: [],
            contacts: [],
            serverHistory: [],
            devices: {},
            pushtoken: null,
            pushkittoken: null,
            speakerPhoneEnabled: null,
            orientation : '',
            Height_Layout : '',
            Width_Layout : '',
            outgoingCallUUID: null,
            hardware: '',
            manufacturer: '',
            brand: '',
            model: '',
            phoneNumber: ''
        };

        this.state = Object.assign({}, this._initialSstate);

        const echoTest = {
            uri: '4444@sylk.link',
            name: 'Echo test',
            type: 'contact'
            };

        const videoTest = {
            uri: '3333@sylk.link',
            name: 'Video test',
            type: 'contact'
            };

        const echoTestCard = Object.assign({}, echoTest);
        const videoTestCard = Object.assign({}, videoTest);

        let initialContacts = [echoTestCard, videoTestCard];
        this.initialContacts = initialContacts;

        this.__notificationCenter = null;

        this.participantsToInvite = null;
        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.muteIncoming = false;

        DeviceInfo.getManufacturer().then(manufacturer => {
            this.setState({manufacturer: manufacturer, model: DeviceInfo.getModel(), brand: DeviceInfo.getBrand()});
        });

        DeviceInfo.getPhoneNumber().then(phoneNumber => {
            this.setState({phoneNumber: phoneNumber});
        });

        storage.initialize();

        RNCallKeep.addEventListener('checkReachability', () => {
            RNCallKeep.setReachable();
        });

        this._callKeepManager = new CallManager(RNCallKeep, this.acceptCall, this.rejectCall, this.hangupCall, this.callKeepStartConference);

        if (InCallManager.recordPermission !== 'granted') {
            InCallManager.requestRecordPermission()
            .then((requestedRecordPermissionResult) => {
                console.log("InCallManager.requestRecordPermission() requestedRecordPermissionResult: ", requestedRecordPermissionResult);
            })
            .catch((err) => {
                console.log("InCallManager.requestRecordPermission() catch: ", err);
            });
        }

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
                                var contact_card = {name: name, uri: number_stripped, type: 'contact', photo: photo, label: number['label']};
                                contact_cards.push(contact_card);
                                seen_uris.set(number_stripped, true);
                            }
                        }
                    });

                    contact['emailAddresses'].forEach(function (email, index) {
                        let email_stripped =  email['email'].replace(/\s|\(|\)/g, '');
                        if (!seen_uris.has(email_stripped)) {
                            //console.log(name, email['label'], email_stripped);
                            //console.log('   ---->    ', email['label'], email_stripped);
                            var contact_card = {name: name, uri: email_stripped, type: 'contact', photo: photo, label: email['label']};
                            contact_cards.push(contact_card);
                            seen_uris.set(email_stripped, true);
                        }
                    });
                }

              this.setState({contacts: contact_cards});
              //this._notificationCenter.postSystemNotification(this.state.contacts.length + ' contacts loaded', {body: '', timeout: 2});
            }
          })

        // Load camera/mic preferences
        storage.get('devices').then((devices) => {
            if (devices) {
                this.setState({devices: devices});
            }
        });
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
        if(this.state.Width_Layout > this.state.Height_Layout) {
            //utils.timestampedLog("Orientation is landcape")
            this.setState({
            orientation : 'landscape'
            });
        } else {
            //utils.timestampedLog("Orientation is portrait")
            this.setState({
            orientation : 'portrait'
            });
        }
        this.forceUpdate();
     }

    async componentDidMount() {
        this._loaded = true;

        try {
            await RNDrawOverlay.askForDispalayOverOtherAppsPermission();
            await RNCallKeep.hasPhoneAccount();
        } catch(err) {
            utils.timestampedLog(err);
        }

        history.push('/login');

        // prime the ref
        //logger.debug('NotificationCenter ref: %o', this._notificationCenter);

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);
        this._boundOnPushRegistered = this._onPushRegistered.bind(this);


        if (Platform.OS === 'android') {
            Linking.getInitialURL().then((url) => {
                if (url) {
                      utils.timestampedLog('Initial url is: ' + url);
                      try {
                          var url_parts = url.split("/");
                          console.log('We will call', url_parts[5], 'when ready');
                          this.callKeepStartCall(url_parts[5], {audio: true, video: true, callUUID: url_parts[4]});
                      } catch (err) {
                          utils.timestampedLog('Error parsing url', url, ":", err);
                      }
                }
              }).catch(err => {
                logger.error({ err }, 'Error getting initial URL');
              });

            firebase.messaging().getToken()
            .then(fcmToken => {
                if (fcmToken) {
                    this._onPushRegistered(fcmToken);
                }
            });
        } else if (Platform.OS === 'ios') {
            VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
            VoipPushNotification.registerVoipToken();

            PushNotificationIOS.addEventListener('register', this._boundOnPushRegistered);


            //let permissions = await checkIosPermissions();
            //if (!permissions.alert) {
                PushNotificationIOS.requestPermissions();
            //}
        }

        this.boundRnStartAction = this._callkeepStartedCall.bind(this);
        this.boundRnDisplayIncomingCall = this._callkeepDisplayIncomingCall.bind(this);
        this.boundProximityDetect = this._proximityDetect.bind(this);

        RNCallKeep.addEventListener('didReceiveStartCallAction', this.boundRnStartAction);
        RNCallKeep.addEventListener('didDisplayIncomingCall', this.boundRnDisplayIncomingCall);
        DeviceEventEmitter.addListener('Proximity', this.boundProximityDetect);

        AppState.addEventListener('change', this._handleAppStateChange);

        if (Platform.OS === 'ios') {
            this._boundOnNotificationReceivedBackground = this._onNotificationReceivedBackground.bind(this);
            this._boundOnLocalNotificationReceivedBackground = this._onLocalNotificationReceivedBackground.bind(this);
            VoipPushNotification.addEventListener('notification', this._boundOnNotificationReceivedBackground);
            VoipPushNotification.addEventListener('localNotification', this._boundOnLocalNotificationReceivedBackground);
        } else if (Platform.OS === 'android') {
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
                    utils.timestampedLog('Handle Firebase', event, 'push notification for', message.data['session-id']);
                    if (event === 'incoming_conference_request') {
                        this.incomingConference(message.data['session-id'], message.data['to_uri'], message.data['from_uri']);
                    }
                });
        }

        this._detectOrientation();
    }

    _proximityDetect(data) {
        return;

        if (data.isNear) {
           this.speakerphoneOff();
        } else {
           this.speakerphoneOn();
        }
    }

    _callkeepDisplayIncomingCall(data) {
        utils.timestampedLog('Incoming alert panel displayed');
    }

    _callkeepStartedCall(data) {
        utils.timestampedLog("_callkeepStartedCall from outside");
        console.log(data);

        if (!this._tmpCallStartInfo || ! this._tmpCallStartInfo.options) {
            utils.timestampedLog("CallKeep started call from outside the app to", data.handle);
            // we dont have options in the tmp var, which means this likely came from the native dialer
            // for now, we only do audio calls from the native dialer.
            let callUUID = data.callUUID || uuid.v4();
            let is_conf = data.handle.search('videoconference.') === -1 ? false: true;
            if (is_conf) {
                this.callKeepStartConference(data.handle, {audio: true, video: true, callUUID: callUUID});
            } else {
                this.callKeepStartCall(data.handle, {audio: true, video: false, callUUID: callUUID});
            }
        } else {
            utils.timestampedLog("CallKeep started call from the app to", data.handle, this._tmpCallStartInfo);
            if (this._tmpCallStartInfo.options && this._tmpCallStartInfo.options.conference) {
                this.startConference(data.handle);
            } else if (this._tmpCallStartInfo.options) {
                this.startCall(data.handle, this._tmpCallStartInfo.options);
            }
        }
        this._notificationCenter.removeNotification();
    }

    async startCallWhenReady(targetUri, options) {
        utils.timestampedLog('Start call when ready to', targetUri);
        var n = 0;
        let wait_interval = 15;
        while (n < wait_interval) {
            if (!this.state.connection) {
                utils.timestampedLog('Web socket is down');
            }
            if (!this.state.connection || this.state.connection.state !== 'ready' || this.state.account === null) {
                utils.timestampedLog('Waiting for connection...');
                this._notificationCenter.postSystemNotification('Waiting for connection...', {timeout: 1});
                await this._sleep(1000);
            } else {
                //this._notificationCenter.postSystemNotification('Server is ready', {timeout: 1});
                utils.timestampedLog('Web socket is ready');
                utils.timestampedLog('Using account', this.state.account.id);
                if (options.conference) {
                    this.startConference(targetUri, options);
                } else {
                    this.startCall(targetUri, options);
                }
                return;
            }
            if (n === wait_interval && options.callUUID - 1) {
                utils.timestampedLog('Terminating call', options.callUUID, 'that did not start yet');
                this._callKeepManager.endCall(callUUID, 15);
                this.setState({targetUri: null});
            }
            n++;
        }
        this._notificationCenter.postSystemNotification('No internet connection', {body: '', timeout: 3});
    }

    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    _onPushkitRegistered(token) {
        utils.timestampedLog('Set VoIP pushkit token', token);
        this.setState({ pushkittoken: token });
    }

    _onPushRegistered(token) {
        utils.timestampedLog('Set background push token', token);
        this.setState({ pushtoken: token });
    }

    _sendPushToken() {
        if (this.state.account && this.state.pushtoken) {
            let token = null;

            if (Platform.OS === 'ios') {
                token = `${this.state.pushkittoken}#${this.state.pushtoken}`;
            } else if (Platform.OS === 'android') {
                token = this.state.pushtoken;
            }
            utils.timestampedLog('Push token', token, 'sent to server');
            this.state.account.setDeviceToken(token, Platform.OS, deviceId, true, bundleId);
        }
    }

    componentWillUnmount() {
        RNCallKeep.removeEventListener('didReceiveStartCallAction', this.boundRnStartAction);

        AppState.removeEventListener('change', this._handleAppStateChange);
    }

    _handleAppStateChange = nextAppState => {
        //TODO - stop if we havent been backgrounded because of becoming active from a push notification and then going background again
        // if (nextAppState.match(/background/)) {
        //     logger.debug('app moving to background so we should stop the client sylk client if we dont have an active call');
        //     if (this._callKeepManager.count === 0) {
        //         logger.debug('callmanager count is 0 so closing connection');
        //         this.state.connection.close();
        //     }
        // }

        if (nextAppState === 'active') {
            if (this._callKeepManager.count === 0 && this.state.connection) {
                this.state.connection.reconnect();
            }
        }
    }

    connectionStateChanged(oldState, newState) {
        utils.timestampedLog('Web socket state changed:', oldState, '->' , newState);
        switch (newState) {
            case 'closed':
                this.setState({connection: null, loading: null});
                this._notificationCenter.postSystemNotification('Connection failed', {body: '', timeout: 5000});
                break;
            case 'ready':
                //this._notificationCenter.postSystemNotification('Connected to server', {body: '', timeout: 3});
                this.processRegistration(this.state.accountId, this.state.password, this.state.displayName);
                break;
            case 'disconnected':
                if (this.state.localMedia) {
                    sylkrtc.utils.closeMediaStream(this.state.localMedia);
                }

                if (this.state.currentCall) {
                    this.hangupCall(this.state.currentCall._callkeepUUID);
                }

                if (this.state.inboundCall) {
                    this.hangupCall(this.state.inboundCall._callkeepUUID);
                }

                //history.push('/ready');

                this.setState({
                    registrationState: 'failed',
                    currentCall: null,
                    inboundCall: null,
                    localMedia: null,
                    generatedVideoTrack: false,
                    showIncomingModal: false
                    });

                this._notificationCenter.postSystemNotification('Connection lost', {body: '', timeout: 5000});

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

    registrationStateChanged(oldState, newState, data) {
        utils.timestampedLog('Registration state changed:', oldState, '->', newState);
        console.log(data);

        this.setState({registrationState: newState});
        if (newState === 'failed') {
            RNCallKeep.setAvailable(false);
            let reason = data.reason;
            if (reason.match(/904/)) {
                // Sofia SIP: WAT
                reason = 'Wrong account or password';

            } else {
                reason = 'Connection failed';
            }

            logger.debug('Registration error: ' + reason);

            this.setState({
                loading     : null,
                status      : {
                    msg   : 'Sign In failed: ' + reason,
                    level : 'danger'
                }
            });

            if (this.state.registrationKeepalive === true) {
                if (this.state.connection !== null) {
                    utils.timestampedLog('Retry to register...');
                    //this.setState({loading: 'Register...'});
                    this._notificationCenter.postSystemNotification('Registering', {body: 'now', timeout: 10000});
                    this.state.account.register();
                } else {
                    // add a timer to retry register after awhile
                    utils.timestampedLog('Retry to register after a delay...');
                    setTimeout(this.state.account.register(), 5000);
                }
            }
        } else if (newState === 'registered') {
            this.getServerHistory();
            RNCallKeep.setAvailable(true);
            this.setState({loading: null, registrationKeepalive: true, registrationState: 'registered'});
            if (!this.state.currentCall) {
                history.push('/ready');
            }
            //this._notificationCenter.postSystemNotification('Ready to receive calls', {body: '', timeout: 1});
            return;
        } else {
            this.setState({status: null });
            RNCallKeep.setAvailable(false);
        }
    }

    showCalls(prefix) {
        if (this.state.currentCall) {
            utils.timestampedLog('Current calls', prefix, 'currentCall:', this.state.currentCall ? (this.state.currentCall._callkeepUUID + ' ' + this.state.currentCall.direction): 'None');
        }
        if (this.state.inboundCall) {
            utils.timestampedLog('Current calls', prefix, 'inboundCall:', this.state.inboundCall ? (this.state.inboundCall._callkeepUUID + ' ' + this.state.inboundCall.direction): 'None');
        }

        if (this._callKeepManager.callUUIDS.length > 0) {
            utils.timestampedLog('Current calls', prefix, 'callkeep sessions:', this._callKeepManager.callUUIDS);
        }
    }

    callStateChanged(oldState, newState, data) {
        // outgoing accepted: null -> progress -> accepted -> established -> terminated
        // incoming accepted: null -> incoming -> accepted -> established -> terminated
        // 2nd incoming call is automatically rejected by sylkrtc library

        utils.timestampedLog('callStateChanged for', data.id, oldState, '->', newState);
        //console.log(data);
        //this.showCalls('Begin callStateChanged');

        let call = this._callKeepManager._calls.get(data.id);

        if (!call) {
            utils.timestampedLog("callStateChanged error: call", data.id, 'not found in callkeep manager');
            return;
        }

        let callUUID = call._callkeepUUID;
        utils.timestampedLog('State for', call.direction, 'call', callUUID, ' changed:', oldState, '->', newState);

        let newCurrentCall;
        let newInboundCall;

        if (this.state.inboundCall && this.state.currentCall) {
            if (this.state.inboundCall != this.state.currentCall) {
                utils.timestampedLog('We have two calls');
            }

            if (newState === 'terminated') {
                if (this.state.inboundCall == this.state.currentCall) {
                    newCurrentCall = null;
                    newInboundCall = null;
                } else {
                    if (oldState === 'incoming') {
                        utils.timestampedLog('Call state changed:', 'We have two calls, new call must be cancelled');
                        // new call must be cancelled
                        newInboundCall = null;
                        newCurrentCall = this.state.currentCall;
                    } else if (oldState === 'established') {
                        utils.timestampedLog('Call state changed:', 'Old call must be closed');
                        // old call must be closed
                        newCurrentCall = null;
                        newInboundCall = null;
                    } else {
                        utils.timestampedLog('Call state changed:', 'Error: unclear call state')
                    }
                }
            } else if (newState === 'accepted') {
                if (this.state.inboundCall == this.state.currentCall) {
                    newCurrentCall = this.state.inboundCall;
                    newInboundCall = this.state.inboundCall;
                } else {
                    utils.timestampedLog('Call state changed:', 'Error: we have two different calls and unhandled state transition');
                }
            } else if (newState === 'established') {
                if (this.state.inboundCall == this.state.currentCall) {
                    newCurrentCall = this.state.inboundCall;
                    newInboundCall = this.state.inboundCall;
                } else {
                    utils.timestampedLog('Call state changed:', 'Error: we have two different calls and unhandled state transition');
                }
            } else {
                utils.timestampedLog('Call state changed:', 'We have two calls and unhandled state');
            }
        } else if (this.state.inboundCall) {
            if (oldState === 'incoming' && newState === 'terminated') {
                utils.timestampedLog("New call must be cancelled");
                newInboundCall = null;
                newCurrentCall = null;
            } else if (oldState === 'incoming' && newState === 'accepted') {
                utils.timestampedLog("New call is accepted");
                newCurrentCall = this.state.inboundCall;
                newInboundCall = this.state.inboundCall;
            } else if (oldState === 'established' && newState === 'terminated') {
                // old call was hangup to accept a new incoming calls
                newCurrentCall = null;
                newInboundCall = this.state.inboundCall;
            } else {
                utils.timestampedLog('Call state changed:', 'we have one inbound call and unhandled state');
            }
        } else {
            newCurrentCall = newState === 'terminated' ? null : this.state.currentCall;
            newInboundCall = null;
        }

        switch (newState) {
            case 'progress':
                InCallManager.startRingback('_BUNDLE_');
                break;
            case 'established':
                this._callKeepManager.setCurrentCallActive(callUUID);
            case 'accepted':
                if (this.state.isConference) {
                    // allow ringtone to play once as connection is too fast
                    setTimeout(() => {InCallManager.stopRingback();}, 2000);
                } else {
                    InCallManager.stopRingback();
                }

                this._callKeepManager.backToForeground();

                if (this.state.isConference) {
                    //this._callKeepManager.backToForeground();
                    this.speakerphoneOn();
                } else if (this.state.currentCall && this.state.currentCall.remoteMediaDirections) {
                    const videoTracks = this.state.currentCall.remoteMediaDirections.video;
                    if (videoTracks && videoTracks.length > 0) {
                        utils.timestampedLog('Call state changed:', 'Video call started')
                        //this._callKeepManager.backToForeground();
                        this.speakerphoneOn();
                    }
                } else {
                    this.speakerphoneOff();
                }
                break;
            case 'terminated':
                let callSuccesfull = false;
                let reason = data.reason;
                let play_busy_tone = true;

                let CALLKEEP_REASON;
                utils.timestampedLog('Call state changed:', 'call', callUUID, 'terminated reason:' + reason);

                if (!reason || reason.match(/200/)) {
                    if (oldState == 'progress') {
                        reason = 'Cancelled';
                        play_busy_tone = false;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                    } else {
                        reason = 'Hangup';
                        callSuccesfull = true;
                        CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
                    }
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
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                    play_busy_tone = false;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.MISSED;
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
                    InCallManager.stop({busytone: '_BUNDLE_'});
                } else {
                    InCallManager.stop();
                }

                utils.timestampedLog('Call', callUUID, 'ended:', reason);
                this._callKeepManager.endCall(callUUID, CALLKEEP_REASON);

                if (this.state.currentCall === null) {
                    utils.timestampedLog('Call state changed:', 'Turn off speakerphone');
                    this.speakerphoneOff();
                }

                if (play_busy_tone && oldState !== 'established') {
                    this._notificationCenter.postSystemNotification('Call ended:', {body: reason, timeout: callSuccesfull ? 5 : 10});
                }

                this.setState({
                    targetUri           : callSuccesfull || config.useServerCallHistory ? '' : this.state.targetUri,
                    showIncomingModal   : false,
                    isConference        : false,
                    localMedia          : null,
                    generatedVideoTrack : false
                });

                this.setFocusEvents(false);

                if (!newCurrentCall && !newInboundCall) {
                    this.participantsToInvite = null;
                    history.push('/ready');
                    setTimeout(() => {
                        this.getServerHistory();
                    }, 3000);
                }

                break;
            default:
                break;
        }

        this.setState({
                    currentCall         : newCurrentCall,
                    inboundCall         : newInboundCall
                });

        //this.showCalls('End callStateChanged');
    }

    handleCallByUri(displayName, targetUri) {
        const accountId = `${utils.generateUniqueId()}@${config.defaultGuestDomain}`;
        this.setState({
            accountId      : accountId,
            password       : '',
            displayName    : displayName,
            //mode           : MODE_GUEST_CALL,
            targetUri      : utils.normalizeUri(targetUri, config.defaultDomain),
            loading        : 'Connecting...'
        });

        if (this.state.connection === null) {
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        }
    }

    handleConferenceByUri(displayName, targetUri) {
        const accountId = `${utils.generateUniqueId()}@${config.defaultGuestDomain}`;
        this.setState({
            accountId      : accountId,
            password       : '',
            displayName    : displayName,
            //mode           : MODE_GUEST_CONFERENCE,
            targetUri      : targetUri,
            loading        : 'Connecting...'
        });

        if (this.state.connection === null) {
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        }
    }

    handleRegistration(accountId, password, remember) {
        this.setState({
            accountId : accountId,
            password  : password,
            mode      : remember ? MODE_NORMAL : MODE_PRIVATE,
            loading   : 'Connecting...'
        });

        if (this.state.connection === null) {

            let model = this.state.brand + ' ' + this.state.model;
            let userAgent = 'SylkMobile on ' + model + '';
            console.log('Starting User Agent', userAgent);
            console.log('Phone number', this.state.phoneNumber);

            let connection = sylkrtc.createConnection({server: config.wsServer, userAgent: {name: userAgent, version: version}});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        } else {
            utils.timestampedLog('Websocket connection active, try to register');
            this.processRegistration(accountId, password, '');
        }
    }

    processRegistration(accountId, password, displayName) {
        if (this.state.account !== null) {
            logger.debug('We already have an account, removing it');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    if (error) {
                        logger.debug(error);
                    }
                    this.setState({registrationState: null, registrationKeepalive: false});
                }
            );
        }

        const options = {
            account: accountId,
            password: password,
            displayName: displayName
        };

        const account = this.state.connection.addAccount(options, (error, account) => {
            if (!error) {
                account.on('outgoingCall', this.outgoingCall);
                account.on('conferenceCall', this.outgoingCall);
                switch (this.state.mode) {
                    case MODE_PRIVATE:
                    case MODE_NORMAL:
                        account.on('registrationStateChanged', this.registrationStateChanged);
                        account.on('incomingCall', this.incomingCall);
                        account.on('missedCall', this.missedCall);
                        account.on('conferenceInvite', this.conferenceInvite);
                        this.setState({account: account});
                        this._sendPushToken();
                        account.register();
                        logger.debug(this.state.mode);
                        if (this.state.mode !== MODE_PRIVATE) {
                            storage.set('account', {
                                accountId: this.state.accountId,
                                password: this.state.password
                            });
                        } else {
                            // Wipe storage if private login
                            //storage.remove('account'); // lets try this out
                            // history.clear().then(() => {
                            //     this.setState({history: []});
                            // });
                        }
                        break;
                    case MODE_GUEST_CALL:
                        this.setState({account: account, loading: null, registrationState: 'registered'});
                        logger.debug(`${accountId} (guest) signed in`);
                        // Start the call immediately, this is call started with "Call by URI"
                        this.startGuestCall(this.state.targetUri, {audio: true, video: true});
                        break;
                    case MODE_GUEST_CONFERENCE:
                        this.setState({account: account, loading: null, registrationState: 'registered'});
                        logger.debug(`${accountId} (conference guest) signed in`);
                        // Start the call immediately, this is call started with "Conference by URI"
                        this.startGuestConference(this.state.targetUri);
                        break;
                    default:
                        logger.debug(`Unknown mode: ${this.state.mode}`);
                        break;
                }
            } else {
                logger.debug('Add account error: ' + error.message);
                let reason = 'Wrong account or password';
                this.setState({
                    loading     : null,
                    status      : {
                        msg   : 'Sign In failed: ' + reason,
                        level : 'danger'
                    }
                });
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
        utils.timestampedLog('Get local media for', callType, 'call, next route', nextRoute);
        const constraints = Object.assign({}, mediaConstraints);

        if (constraints.video === true) {
            if ((nextRoute === '/conference' ||  this.state.mode === MODE_GUEST_CONFERENCE)) {
                constraints.video = {
                    'width': {
                        'ideal': 1280
                    },
                    'height': {
                        'ideal': 720
                    }
                };

            // TODO: remove this, workaround so at least safari works when joining a video conference
            } else if ((nextRoute === '/conference' ||  this.state.mode === MODE_GUEST_CONFERENCE) && isSafari) {
                constraints.video = false;
            } else {
                // ask for 720p video
                constraints.video = {
                    'width': {
                        'ideal': 1280
                    },
                    'height': {
                        'ideal': 720
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
            utils.timestampedLog('Got local media done, next route is', nextRoute);
            this.setState({status: null, loading: null, localMedia: localStream});
            if (nextRoute !== null) {
                history.push(nextRoute);
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

                /*
                logger.debug('Audio only media, but video was requested, creating generated video track');
                const generatedVideoTrack = utils.generateVideoTrack(localStream);
                localStream.addTrack(generatedVideoTrack);
                utils.timestampedLog('Next route', nextRoute);

                this.setState({status: null, loading: null, localMedia: localStream, generatedVideoTrack: true});
                */

                if (nextRoute !== null) {
                    history.push(nextRoute);
                }
            })
            .catch((error) => {
                utils.timestampedLog('Access to local media failed:', error);
                clearTimeout(this.loadScreenTimer);
                this._notificationCenter.postSystemNotification("Can't access camera or microphone", {timeout: 10});
                this.setState({
                    loading: null
                });
                utils.timestampedLog('Go to ready screen');
                history.push('/ready');
            });
        });
    }

    callKeepStartConference(targetUri, options={audio: true, video: true}) {
        utils.timestampedLog('CallKeep will start conference to', targetUri);
        //this.showCalls('callKeepStartCall');
        //this._callKeepManager.showUnclosedCalls();

        this._tmpCallStartInfo = {
                uuid: options.callUUID || uuid.v4()
            };

        this.setState({outgoingCallUUID: this._tmpCallStartInfo.uuid});
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, conference: true, callUUID: this._tmpCallStartInfo.uuid});
    }

    callKeepStartCall(targetUri, options) {
        utils.timestampedLog('CallKeep will start call to', targetUri);

        //this.showCalls('callKeepStartCall');
        //this._callKeepManager.showUnclosedCalls();

        this._tmpCallStartInfo = {
            uuid: options.callUUID || uuid.v4(),
            options,
        };

        this.setState({outgoingCallUUID: this._tmpCallStartInfo .uuid});
        this.startCallWhenReady(targetUri, {audio: options.audio, video: options.video, callUUID: this._tmpCallStartInfo.uuid});

    }

    startCall(targetUri, options) {
        utils.timestampedLog('startCall', targetUri);
        this.setState({targetUri: targetUri});
        //this.addCallHistoryEntry(targetUri);
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    startGuestCall(targetUri, options) {
        utils.timestampedLog('startGuestCall', targetUri);
        this.setState({targetUri: targetUri});
        this.getLocalMedia(Object.assign({audio: true, video: true}, this._tmpCallStartInfo.options));
    }

    acceptCall() {
        utils.timestampedLog('Alert panel answer call');

        this.showCalls('acceptCall')

        this.setState({showIncomingModal: false });
        this.setFocusEvents(false);

        if (this.state.currentCall) {
            this.hangupCall(this.state.currentCall._callkeepUUID);
            this.setState({currentCall: null});

            /*
            if (this.state.localMedia != null) {
                sylkrtc.utils.closeMediaStream(this.state.localMedia);
                utils.timestampedLog('Sylkrtc close local media');
            }
            */

        }

        this.setState({localMedia: null});
        this.state.inboundCall.on('stateChanged', this.callStateChanged);

        let hasVideo = this.state.inboundCall.mediaTypes.video ? true : false;
        this.getLocalMedia(Object.assign({audio: true, video: hasVideo}), '/call');
        this.forceUpdate();
    }

    callKeepAcceptCall(callUUID) {
        // called from user interaction
        utils.timestampedLog('CallKeep answer call', callUUID);
        this._callKeepManager.answerIncomingCall(callUUID);
        this.acceptCall();
    }

    callKeepRejectCall(callUUID) {
        // called from user interaction
        utils.timestampedLog('CallKeep must reject call', callUUID);
        this._callKeepManager.rejectCall(callUUID);
        this.rejectCall(callUUID);
    }

    rejectCall(callUUID) {
        utils.timestampedLog('Alert panel reject call', callUUID);
        this.setState({showIncomingModal: false});
        if (!this.state.currentCall) {
            history.push('/ready');
        }

        if (this.state.inboundCall && this.state.inboundCall._callkeepUUID === callUUID) {
            this.state.inboundCall.terminate();
            utils.timestampedLog('Sylkrtc reject call', callUUID);
        }
        this.forceUpdate();
    }

    hangupCall(callUUID) {
        utils.timestampedLog('User hangup call', callUUID);

        //this.showCalls('hangupCall');

        let call = this._callKeepManager._calls.get(callUUID);

        if (call) {
            call.terminate();
        } else {
            if (this.state.localMedia != null) {
                sylkrtc.utils.closeMediaStream(this.state.localMedia);
                utils.timestampedLog('Sylkrtc close media');
            }
        }
        utils.timestampedLog('Go to ready screen');
        history.push('/ready');
        this.forceUpdate();
    }

    callKeepSendDtmf(digits) {
        utils.timestampedLog('Send DTMF', digits);
        if (this.state.currentCall) {
            this._callKeepManager.sendDTMF(this.state.currentCall._callkeepUUID, digits);
        }
    }

    callKeepToggleMute(mute) {
        utils.timestampedLog('Toggle mute %s', mute);
        if (this.state.currentCall) {
            this._callKeepManager.setMutedCall(this.state.currentCall._callkeepUUID, mute);
        }
    }

    toggleSpeakerPhone() {
        if (this.state.speakerPhoneEnabled === true) {
            this.speakerphoneOff();
        } else {
            this.speakerphoneOn();
        }
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

    toggleMute() {
        this.muteIncoming = !this.muteIncoming;
    }

    outgoingCall(call) {
        utils.timestampedLog('New outgoing call to', call.remoteIdentity.uri);
        this._callKeepManager.handleCall(call, this._tmpCallStartInfo.uuid);
        InCallManager.start({media: this._tmpCallStartInfo.options && this._tmpCallStartInfo.options.video ? 'video' : 'audio'});
        this._tmpCallStartInfo = {};
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        //this._callKeepManager.updateDisplay(call._callkeepUUID, call.remoteIdentity.displayName, call.remoteIdentity.uri);
    }

    _onLocalNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        utils.timestampedLog('Handle local iOS push notification: ', notificationContent);
    }

    _onNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();

        // get the uuid from the notification
        // have we already got a waiting call in call manager? if we do, then its been "answered" and we're waiting for the invite
        // we may still never get the invite if theres network issues... so still need a timeout
        // no waiting call, so that means its still "ringing" (it may have been cancelled) so set a timer and if we havent recieved
        // an invite within 10 seconds then clear it down

        let event = notificationContent['event'];
        let callUUID = notificationContent['session-id'];
        utils.timestampedLog('Handle iOS', event, 'push notification for', callUUID);
        logger.debug(notificationContent);

        if (notificationContent['event'] === 'incoming_session') {
            utils.timestampedLog('Incoming call for push mobile notification for call', callUUID);

            this._callKeepManager.handleCallLater(callUUID, notificationContent);

            if (VoipPushNotification.wakeupByPush) {
                utils.timestampedLog('We wake up by a push notification');
                VoipPushNotification.wakeupByPush = false;
            }
            VoipPushNotification.onVoipNotificationCompleted(callUUID);
        } else if (notificationContent['event'] === 'incoming_conference_request') {
            let callUUID = notificationContent['session-id'];
            utils.timestampedLog('Incoming conference for push mobile notification for call', callUUID);
            this.incomingConference(callUUID, notificationContent['to_uri'], notificationContent['from_uri']);

            VoipPushNotification.onVoipNotificationCompleted(callUUID);
        }

        /*
        if (notificationContent['event'] === 'incoming_session') {
            VoipPushNotification.presentLocalNotification({
                alertBody:'Incoming ' + notificationContent['media-type'] + ' call from ' + notificationContent['from_display_name']
            });
        }
        */

        if (notificationContent['event'] === 'cancel') {
            VoipPushNotification.presentLocalNotification({
                alertBody:'Call cancelled'
            });
        }

        if (VoipPushNotification.wakeupByPush) {
            utils.timestampedLog('We wake up by push notification');
            VoipPushNotification.wakeupByPush = false;
        }
    }

    incomingConference(callUUID, to_uri, from_uri) {
        utils.timestampedLog('Incoming conference', callUUID);
        // this does not work for Android when is in the background
        // this does not work for iOS when app is in the foreground

        // TODO: for Android we need to handle background notifications

        this._callKeepManager.handleConference(callUUID, to_uri);
        this.setFocusEvents(true);

        // when call is accepted this.callKeepStartConference is called
    }

    startConference(targetUri, options={audio: true, video: true}) {
        utils.timestampedLog('New outgoing conference to room', targetUri);
        this.addCallHistoryEntry(targetUri);
        this.setState({targetUri: targetUri, isConference: true});
        this.getLocalMedia({audio: options.audio, video: options.video}, '/conference');
    }

    escalateToConference(participants) {
        const uri = `${utils.generateSillyName()}@${config.defaultConferenceDomain}`;
        utils.timestampedLog('Move current call to conference', uri, 'with participants', participants);
        if (this.state.currentCall) {
            this.hangupCall(this.state.currentCall._callkeepUUID);
            this.setState({currentCall: null});
        }

        if (this.state.inboundCall) {
            this.hangupCall(this.state.inboundCall._callkeepUUID);
            this.setState({inboundCall: null});
        }

        this.setState({localMedia: null});

        history.push('/ready');

        this.participantsToInvite = participants;
        this.callKeepStartConference(uri);
    }

    conferenceInvite(data) {
        // comes from web socket
        utils.timestampedLog('Conference invite from websocket', data.id, 'from', data.originator, 'for room', data.room);
        //this._notificationCenter.postSystemNotification('Conference invite', {body: `From ${data.originator.displayName || data.originator.uri} for room ${data.room}`, timeout: 15, silent: false});
        if (Platform.OS === 'android') {
            this.incomingConference(data.id, data.room, data.originator);
        }
    }

    incomingCall(call, mediaTypes) {
        // because of limitation in Sofia stack, we cannot have more then two calls at a time
        // we can have one outgoing call and one incoming call but not two incoming calls
        // we cannot have two incoming calls, second one is automatically rejected by sylkrtc.js

        let media_type = mediaTypes.video ? 'video' : 'audio';
        call.mediaTypes = mediaTypes;

        utils.timestampedLog('New', media_type, 'incoming call from', call.remoteIdentity['_displayName'], call.remoteIdentity['_uri']);

        InCallManager.start({media: media_type});
        this._callKeepManager.handleCall(call);

        this.setFocusEvents(true);

        call.on('stateChanged', this.callStateChanged);
        this.setState({inboundCall: call, showIncomingModal: true});

        // if (!this.shouldUseHashRouting) {
        //     this._notificationCenter.postSystemNotification('Incoming call', {body: `From ${call.remoteIdentity.displayName || call.remoteIdentity.uri}`, timeout: 15, silent: false});
        // }
    }

    setFocusEvents(enabled) {
        // if (this.shouldUseHashRouting) {
        //     const remote = window.require('electron').remote;
        //     if (enabled) {
        //         const currentWindow = remote.getCurrentWindow();
        //         currentWindow.on('focus', this.hasFocus);
        //         currentWindow.on('blur', this.hasNoFocus);
        //         this.setState({haveFocus: currentWindow.isFocused()});
        //     } else {
        //         const currentWindow = remote.getCurrentWindow();
        //         currentWindow.removeListener('focus', this.hasFocus);
        //         currentWindow.removeListener('blur', this.hasNoFocus);
        //     }
        // }
    }

    // hasFocus() {
    //     this.setState({haveFocus: true});
    // }

    // hasNoFocus() {
    //     this.setState({haveFocus: false});
    // }

    missedCall(data) {
        utils.timestampedLog('Missed call from ' + data.originator);
        if (!this.state.currentCall) {
            utils.timestampedLog('Update snackbar');
            let from = data.originator.display_name || data.originator.uri;
            this._notificationCenter.postSystemNotification('Missed call', {body: `from ${from}`, timeout: 180, silent: false});
        }
        this.forceUpdate();
    }

    startPreview() {
        this.getLocalMedia({audio: true, video: true}, '/preview');
    }

    addCallHistoryEntry(uri) {
        if (this.state.mode === MODE_NORMAL || this.state.mode === MODE_PRIVATE) {
            let entries = this.state.history.slice();
            if (entries.length !== 0) {
                const idx = entries.indexOf(uri);
                if (idx !== -1) {
                    entries.splice(idx, 1);
                }
                entries.unshift(uri);
                // keep just the last 50
                entries = entries.slice(0, 100);
            } else {
                entries = [uri];
            }
            this.setState({history: entries});
            utils.timestampedLog(this.state.history);
        } else {
            // history.add(uri).then((entries) => {
            //     this.setState({history: entries});
            // });
        }
    }

    getServerHistory() {
        if (!config.useServerCallHistory) {
            return;
        }

        if (!this.state.account|| !this.state.account.id) {
            return;
        }

        utils.timestampedLog('Requesting call history from server');
        let getServerCallHistory = new DigestAuthRequest(
            'GET',
            `${config.serverCallHistoryUrl}?action=get_history&realm=${this.state.account.id.split('@')[1]}`,
            this.state.account.id.split('@')[0],
            this.state.password
        );
        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                logger.debug('Error getting call history from server: %o', data.error_message)
                return;
            }

            let history = [];
            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'placed'; return elem});
            }

            if (data.received) {
                data.received.map(elem => {elem.direction = 'received'; return elem});
            }

            history = data.placed;

            if (data.received && history) {
                history = history.concat(data.received);
            }

            if (history) {
                history.sort((a,b) => {
                    return new Date(b.startTime) - new Date(a.startTime);
                });
                const known = [];
                history = history.filter((elem) => {
                    if (known.indexOf(elem.remoteParty) <= -1) {
                        if (!this.state.account || !this.state.account.id) {
                            return;
                        }

                        elem.type = 'history';
                        var contact_obj = this.findObjectByKey(this.state.contacts, 'uri', elem.remoteParty);
                        if (contact_obj) {
                            elem.displayName = contact_obj.name;
                            elem.photo = contact_obj.photo;
                            // TODO update icon here
                        } else {
                            elem.photo = null;
                        }

                        elem.label = elem.direction;

                        if (!elem.displayName) {
                            elem.displayName = elem.remoteParty;
                        }

                        if ((elem.media.indexOf('audio') > -1 || elem.media.indexOf('video') > -1) &&
                            (elem.remoteParty !== this.state.account.id || elem.direction !== 'placed')) {
                                known.push(elem.remoteParty);
                                if (elem.remoteParty.indexOf('3333@') > -1) {
                                    // see Call.js as well if we change this
                                    elem.displayName = 'Video Test';
                                }
                                if (elem.remoteParty.indexOf('4444@') > -1) {
                                    // see Call.js as well if we change this
                                    elem.displayName = 'Echo Test';
                                }
                                return elem;
                        }
                    }
                });

                if (data.placed.length < 3) {
                    history = history.concat(this.initialContacts);
                }

                this.setState({serverHistory: history});
            }
        }, (errorCode) => {
            logger.debug('Error getting call history from server: %o', errorCode)
        });
    }

    // checkRoute(nextPath, navigation, match) {
    //     if (nextPath !== this.prevPath) {
    //         logger.debug(`Transition from ${this.prevPath} to ${nextPath}`);

    //
    //         // Press back in ready after a login, prevent initial navigation
    //         // don't deny if there is no registrationState (connection fail)
    //         if (this.prevPath === '/ready' && nextPath === '/login' && this.state.registrationState !== null) {
    //             logger.debug('Transition denied redirecting to /logout');
    //             history.push('/logout');
    //             return false;

    //         // Press back in ready after a call
    //         } else if ((nextPath === '/call' || nextPath === '/conference') && this.state.localMedia === null && this.state.registrationState === 'registered') {
    //             return false;

    //         // Press back from within a call/conference, don't navigate terminate the call and
    //         // let termination take care of navigating
    //         } else if (nextPath === '/ready' && this.state.registrationState === 'registered' && this.state.currentCall !== null) {
    //             this.state.currentCall.terminate();
    //             return false;

    //         // Guest call ended, needed to logout and display msg and logout
    //         } else if (nextPath === '/ready' && (this.state.mode === MODE_GUEST_CALL || this.state.mode === MODE_GUEST_CONFERENCE)) {
    //             history.push('/logout');
    //             this.forceUpdate();
    //         }
    //     }
    //     this.prevPath = nextPath;
    // }

    render() {
        let footerBox = <View style={styles.footer}><FooterBox /></View>;

        let extraStyles = {};

        if (this.state.localMedia || this.state.registrationState === 'registered') {
           footerBox = null;
        }
        return (
            <BreadProvider>
                <PaperProvider theme={theme}>
                    <Router history={history} ref="router">
                        <ImageBackground source={backgroundImage} style={{width: '100%', height: '100%'}}>
                            <View style={mainStyle.MainContainer} onLayout={(event) => this.setState({
                                                                            Width_Layout : event.nativeEvent.layout.width,
                                                                            Height_Layout : event.nativeEvent.layout.height
                                                                           }, ()=> this._detectOrientation())}>
                            <SafeAreaView style={[styles.root, extraStyles]}>

                                <LoadingScreen text={this.state.loading} show={this.state.loading !== null} orientation={this.state.orientation}/>

                                {/*
                                {<IncomingCallModal
                                    call={this.state.inboundCall}
                                    onAccept={this.callKeepAcceptCall}
                                    onReject={this.callKeepRejectCall}
                                    show={this.state.showIncomingModal}
                                />}
                                */}

                                {/* <Locations hash={this.shouldUseHashRouting}  onBeforeNavigation={this.checkRoute}> */}
                                <Switch>
                                    <Route exact path="/" component={this.main} />
                                    <Route exact path="/login" component={this.login} />
                                    <Route exact path="/logout" component={this.logout} />
                                    <Route exact path="/ready" component={this.ready} />
                                    <Route exact path="/call" component={this.call} />
                                    <Route path="/call/:targetUri" component={this.callByUri} />
                                    {/* <Location path="/call/:targetUri" urlPatternOptions={{segmentValueCharset: 'a-zA-Z0-9-_ \.@'}} handler={this.callByUri} /> */}
                                    <Route exact path="/conference" component={this.conference} />
                                    <Route path="/conference/:targetUri" component={this.conferenceByUri} />
                                    {/* <Location path="/conference/:targetUri" urlPatternOptions={{segmentValueCharset: 'a-zA-Z0-9-_~ %\.@'}}  handler={this.conferenceByUri} /> */}
                                    <Route exact path="/preview" component={this.preview} />
                                    <Route component={this.notFound} />
                                </Switch>

                                <NotificationCenter ref="notificationCenter" />

                            </SafeAreaView>
                            </View>
                        </ImageBackground>
                    </Router>
                </PaperProvider>
            </BreadProvider>
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

    ready() {
        if (!this.state.account) {
            return null;
        }


        return (
            <Fragment>
                <NavigationBar
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
                    logout = {this.logout}
                    preview = {this.startPreview}
                    toggleMute = {this.toggleMute}
                    connection = {this.state.connection}
                    registration = {this.state.registrationState}
                />
                <ReadyBox
                    account   = {this.state.account}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartConference}
                    missedTargetUri = {this.state.missedTargetUri}
                    history = {this.state.history}
                    key = {this.state.missedTargetUri}
                    serverHistory = {this.state.serverHistory}
                    orientation = {this.state.orientation}
                    contacts = {this.state.contacts}
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
        return (
            <Call
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall || this.state.inboundCall}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.hangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                callKeepSendDtmf = {this.callKeepSendDtmf}
                callKeepToggleMute = {this.callKeepToggleMute}
                callKeepStartCall = {this.callKeepStartCall}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                speakerphoneOn = {this.speakerphoneOn}
                speakerphoneOff = {this.speakerphoneOff}
                callUUID = {this.state.outgoingCallUUID}
                contacts = {this.state.contacts}
            />
        )
    }

    callByUri(urlParameters) {
        // check if the uri contains a domain
        if (urlParameters.targetUri.indexOf('@') === -1) {
            const status = {
                title   : 'Invalid user',
                message : `Oops, the domain of the user is not set in '${urlParameters.targetUri}'`,
                level   : 'danger',
                width   : 'large'
            }
            return (
                <StatusBox {...status} />
            );
        }
        return (
            <CallByUriBox
                handleCallByUri = {this.handleCallByUri}
                notificationCenter = {this.notificationCenter}
                targetUri = {urlParameters.targetUri}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                currentCall = {this.state.currentCall}
                hangupCall = {this.hangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
            />
        );
    }

    conference() {
        return (
            <Conference
                notificationCenter = {this.notificationCenter}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                participantsToInvite = {this.participantsToInvite}
                hangupCall = {this.hangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                toggleSpeakerPhone = {this.toggleSpeakerPhone}
                speakerPhoneEnabled = {this.state.speakerPhoneEnabled}
                callUUID = {this.state.outgoingCallUUID}
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
        RNCallKeep.setAvailable(false);

        if (this.state.registrationState !== null && (this.state.mode === MODE_NORMAL || this.state.mode === MODE_PRIVATE)) {
            this.state.account.unregister();
        }

        if (this.state.account !== null) {
            this.state.connection.removeAccount(this.state.account, (error) => {
                if (error) {
                    logger.debug(error);
                }
            });
        }
        storage.set('account', {accountId: this.state.accountId, password: ''});
        this.setState({account: null,
                       registrationState: null,
                       registrationKeepalive: false,
                       status: null,
                       serverHistory: [],
                       history: []
                       });
        history.push('/login');
        return null;
    }

    main() {
        return null;
    }
}

export default Sylk;
