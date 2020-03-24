import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, ImageBackground, PermissionsAndroid, AppState, Linking} from 'react-native';
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

const callkeepOptions = {
    ios: {
        appName: 'Sylk',
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 1,
        supportsVideo: true,
        imageName: "Image"
    },
    android: {
        alertTitle: 'Calling Account Permission Required',
        alertDescription: 'Please enable "Sylk" from your available Calling Accounts',
        cancelButton: 'Cancel',
        okButton: 'ok',
        imageName: 'phone_account_icon',
        additionalPermissions: [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO ]
    }
};

RNCallKeep.setup(callkeepOptions);

let callkeepType = Platform.OS === 'ios' ? 'generic' : 'sip';

// Application modes
const MODE_NORMAL           = Symbol('mode-normal');
const MODE_PRIVATE          = Symbol('mode-private');
const MODE_GUEST_CALL       = Symbol('mode-guest-call');
const MODE_GUEST_CONFERENCE = Symbol('mode-guest-conference');

class Blink extends Component {
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
            currentCall: null,
            connection: null,
            inboundCall: null,
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
            serverHistory: [],
            devices: {},
            pushtoken: null
        };
        this.state = Object.assign({}, this._initialSstate);

        this.__notificationCenter = null;

        this.participantsToInvite = null;
        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.muteIncoming = false;

        storage.initialize();

        this._callManager = new CallManager(RNCallKeep, this.answerCall, this.rejectCall, this.hangupCall);

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

    async componentDidMount() {
        this._loaded = true;

        history.push('/login');

        // prime the ref
        logger.debug('NotificationCenter ref: %o', this._notificationCenter);

        this._boundOnPushkitRegistered = this._onPushkitRegistered.bind(this);

        if (Platform.OS === 'android') {

            Linking.getInitialURL().then((url) => {
                if (url) {
                  console.log('Initial url is: ' + url);
                }
              }).catch(err => {
                logger.error({ err }, 'Error getting initial URL');
              });

            firebase.messaging().getToken()
            .then(fcmToken => {
                if (fcmToken) {
                    this._onPushkitRegistered(fcmToken);
                }
            });
        }

        if (Platform.OS === 'ios') {
            VoipPushNotification.addEventListener('register', this._boundOnPushkitRegistered);
            VoipPushNotification.registerVoipToken();
        }

        this.boundRnStartAction = this._callkeepStartedCall.bind(this);

        RNCallKeep.addEventListener('didReceiveStartCallAction', this.boundRnStartAction);

        AppState.addEventListener('change', this._handleAppStateChange);

        if (Platform.OS === 'ios') {
            this._boundOnNotificationReceivedBackground = this._onNotificationReceivedBackground.bind(this);
            VoipPushNotification.addEventListener('notification', this._boundOnNotificationReceivedBackground);
        }

        if (Platform.OS === 'android') {
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
                    // Process your message as required
                    //on any message, register

                });
        }
    }

    _callkeepStartedCall(data) {
        logger.debug('accessing Call Object', this._tmpCallStartInfo, data);

        if (this._tmpCallStartInfo.options && this._tmpCallStartInfo.options.conference) {
            this.startConference(data.handle);
        } else if (this._tmpCallStartInfo.options) {
            this.startCall(data.handle, this._tmpCallStartInfo.options);
        } else {
            // we dont have options in the tmp var, which means this likely came from the native dialer
            // for now, we only do audio calls from the native dialer.
            this._tmpCallStartInfo = {
                uuid: data.callUUID
            };
            this.startCall(data.handle, {audio: true, video: false});
        }
    }

    _onPushkitRegistered(token) {
        logger.debug('pushkit token', token);
        this.setState({ pushToken: token });
    }

    componentWillUnmount() {
        RNCallKeep.removeEventListener('didReceiveStartCallAction', this.boundRnStartAction);

        AppState.removeEventListener('change', this._handleAppStateChange);
    }

    _onNotificationReceivedBackground(notification) {
        let notificationContent = notification.getData();
        //console.log('got a pushkit call', notificationContent);

        // get the uuid from the notification
        // have we already got a waiting call in call manager? if we do, then its been "answered" and we're waiting for the invite
        // we may still never get the invite if theres network issues... so still need a timeout
        // no waiting call, so that means its still "ringing" (it may have been cancelled) so set a timer and if we havent recieved
        // an invite within 10 seconds then clear it down
        let callUUID = notificationContent.callUUID;

        if (VoipPushNotification.wakeupByPush) {
          VoipPushNotification.wakeupByPush = false;
        }
    }

    _handleAppStateChange = nextAppState => {
        //TODO - stop if we havent been backgrounded because of becoming active from a push notification and then going background again
        if (Platform.OS === "ios") {
            if (nextAppState.match(/background/)) {
                logger.debug('app moving to background so we should stop the client sylk client if we dont have an active call');
            }
        }

        if (nextAppState == "active") {

        }
    }

    connectionStateChanged(oldState, newState) {
        logger.debug(`Connection state changed! ${oldState} -> ${newState}`);
        switch (newState) {
            case 'closed':
                this.setState({connection: null, loading: null});
                break;
            case 'ready':
                this.processRegistration(this.state.accountId, this.state.password, this.state.displayName);
                break;
            case 'disconnected':

                if (this.state.localMedia) {
                    sylkrtc.utils.closeMediaStream(this.state.localMedia);
                }

                if (this.state.currentCall) {
                    this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                    this.state.currentCall.terminate();
                }

                if (this.state.inboundCall && this.state.inboundCall !== this.state.currentCall) {
                    this.state.inboundCall.removeListener('stateChanged', this.inboundCallStateChanged);
                    this.state.inboundCall.terminate();
                }

                this.setState({
                    account:null,
                    registrationState: null,
                    loading: 'Disconnected, reconnecting...',
                    showIncomingModal: false,
                    currentCall: null,
                    inboundCall: null,
                    localMedia: null,
                    generatedVideoTrack: false
                });
                InCallManager.stop();

                break;
            default:
                this.setState({loading: 'Connecting...'});
                break;
        }
    }

    notificationCenter() {
        return this._notificationCenter;
    }

    registrationStateChanged(oldState, newState, data) {
        logger.debug('Registration state changed! ' + newState);
        this.setState({registrationState: newState});
        if (newState === 'failed') {
            let reason = data.reason;
            if (reason.match(/904/)) {
                // Sofia SIP: WAT
                reason = 'Bad account or password';
            } else {
                reason = 'Connection failed';
            }
            this.setState({
                loading     : null,
                status      : {
                    msg   : 'Sign In failed: ' + reason,
                    level : 'danger'
                }
            });
        } else if (newState === 'registered') {
            this.setState({loading: null});
            this.getServerHistory();
            RNCallKeep.setAvailable(true);
            history.push('/ready');
            return;
        } else {
            this.setState({status: null });
        }
    }

    callStateChanged(oldState, newState, data) {
        logger.debug(`Call state changed! ${oldState} -> ${newState}`. data);

        switch (newState) {
            case 'progress':
                if (Platform.OS === 'ios') {
                    InCallManager.startRingback('_BUNDLE_');
                } else {
                    InCallManager.startRingback('_DTMF_');
                }
                break;
            case 'accepted':
                InCallManager.stopRingback();
                logger.debug('Setting Call as active in callkeep', this.state.currentCall._callkeepUUID);
                this._callManager.callKeep.setCurrentCallActive(this.state.currentCall._callkeepUUID);
                break;
            case 'terminated':
                InCallManager.stop({busytone: '_BUNDLE_'});

                let callSuccesfull = false;
                let reason = data.reason;

                let CALLKEEP_REASON;

                if (!reason || reason.match(/200/)) {
                    reason = 'Hangup';
                    callSuccesfull = true;
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
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
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/5\d\d/)) {
                    reason = 'Server failure';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else if (reason.match(/904/)) {
                    // Sofia SIP: WAT
                    reason = 'Bad account or password';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                } else {
                    reason = 'Connection failed';
                    CALLKEEP_REASON = CK_CONSTANTS.END_CALL_REASONS.FAILED;
                }
                this._callManager.callKeep.reportEndCallWithUUID(this.state.currentCall._callkeepUUID, CALLKEEP_REASON);
                this._callManager.remove();

                this._notificationCenter.postSystemNotification('Call Terminated', {body: reason, timeout: callSuccesfull ? 5 : 10});

                this.setState({
                    currentCall         : null,
                    targetUri           : callSuccesfull || config.useServerCallHistory ? '' : this.state.targetUri,
                    showIncomingModal   : false,
                    inboundCall         : null,
                    localMedia          : null,
                    generatedVideoTrack : false
                });
                this.setFocusEvents(false);
                this.participantsToInvite = null;


                history.push('/ready');
                this.getServerHistory();
                break;
            default:
                break;
        }
    }

    inboundCallStateChanged(oldState, newState, data) {
        logger.debug('Inbound Call state changed! ' + newState);
        if (newState === 'terminated') {
            this.setState({ inboundCall: null, showIncomingModal: false });
            this.setFocusEvents(false);
        }
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
        } else {
            logger.debug('Connection Present, try to register');
            this.processRegistration(accountId, '', displayName);
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
        } else {
            logger.debug('Connection Present, try to register');
            this.processRegistration(accountId, '', displayName);
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
            let connection = sylkrtc.createConnection({server: config.wsServer});
            connection.on('stateChanged', this.connectionStateChanged);
            this.setState({connection: connection});
        } else {
            logger.debug('Connection Present, try to register');
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
                    this.setState({account: null, registrationState: null});
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
                        this.state.account.register();
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
                logger.debug('Add account error: ' + error);
                this.setState({loading: null, status: {msg: error.message, level:'danger'}});
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
        logger.debug('getLocalMedia(), mediaConstraints=%o', mediaConstraints);
        const constraints = Object.assign({}, mediaConstraints);

        if (constraints.video === true) {
            if ((nextRoute === '/conference' ||  this.state.mode === MODE_GUEST_CONFERENCE)) {
                constraints.video = {
                    'width': {
                        'ideal': 640
                    },
                    'height': {
                        'ideal': 480
                    }
                };

            // TODO: remove this, workaround so at least safari works wehn joining a video conference
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

        this.loadScreenTimer = setTimeout(() => {
            this.setState({loading: 'Please allow access to your media devices'});
        }, 150);



        navigator.mediaDevices.enumerateDevices()
        .then((devices) => {
            devices.forEach((device) => {
                if ('video' in constraints && 'camera' in this.state.devices) {
                    if (constraints.video !== false && (device.deviceId === this.state.devices.camera.deviceId || device.label === this.state.devices.camera.label)) {
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
            logger.debug('Device enumeration failed: %o', error);
        })
        .then(() => {
            return navigator.mediaDevices.getUserMedia(constraints)
        })
        .then((localStream) => {
            clearTimeout(this.loadScreenTimer);
            logger.debug('Got local Media', localStream);
            this.setState({status: null, loading: null, localMedia: localStream});
            if (nextRoute !== null) {
                history.push(nextRoute);
            }
        })
        .catch((error) => {
            logger.debug('Access failed, trying audio only: %o', error);
            navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            })
            .then((localStream) => {
                clearTimeout(this.loadScreenTimer);

                if (nextRoute != '/preview') {
                    logger.debug('Audio only media, but video was requested, creating generated video track');
                    const generatedVideoTrack = utils.generateVideoTrack(localStream);
                    localStream.addTrack(generatedVideoTrack);
                }

                this.setState({status: null, loading: null, localMedia: localStream, generatedVideoTrack: true});
                if (nextRoute !== null) {
                    history.push(nextRoute);
                }
            })
            .catch((error) => {
                logger.debug('Access to local media failed: %o', error);
                clearTimeout(this.loadScreenTimer);
                this._notificationCenter.postSystemNotification("Can't access camera or microphone", {timeout: 10});
                this.setState({
                    loading: null
                });
            });
        });
    }

    callKeepStartCall(targetUri, options) {
        this._tmpCallStartInfo = {
            uuid: uuid.v4(),
            options,
        };

        logger.debug('Set Call Object', this._tmpCallStartInfo);

        this._callManager.callKeep.startCall(this._tmpCallStartInfo.uuid, targetUri, '', callkeepType, false);
    }

    startCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.addCallHistoryEntry(targetUri);
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    startGuestCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia(Object.assign({audio: true, video: true}, this._tmpCallStartInfo.options));
    }

    callKeepAnswerCall(options) {
        if (this.state.currentCall) {
            this._callManager.callKeep.answerIncomingCall(this.state.currentCall._callkeepUUID);
        }
    }

    answerCall(options) {
        this.setState({ showIncomingModal: false });
        this.setFocusEvents(false);
        if (this.state.inboundCall !== this.state.currentCall) {
            // terminate current call to switch to incoming one
            this.state.inboundCall.removeListener('stateChanged', this.inboundCallStateChanged);
            this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
            //this.state.currentCall.terminate();
            this._callManager.callKeep.endCall(this.state.currentCall._callkeepUUID);
            this.setState({currentCall: this.state.inboundCall, inboundCall: this.state.inboundCall, localMedia: null});
            this.state.inboundCall.on('stateChanged', this.callStateChanged);
        }
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    callKeepRejectCall() {
        if (this.state.currentCall) {
            this._callManager.callKeep.rejectCall(this.state.currentCall._callkeepUUID);
        }
    }

    rejectCall() {
        this.setState({showIncomingModal: false});
        this.state.inboundCall.terminate();
    }

    callKeepHangupCall() {
        if (this.state.currentCall) {
            this._callManager.callKeep.endCall(this.state.currentCall._callkeepUUID);
        }
    }

    hangupCall() {
        if (this.state.currentCall != null) {
            this.state.currentCall.terminate();
        } else {
            // We have no call but we still want to cancel
            if (this.state.localMedia != null) {
                sylkrtc.utils.closeMediaStream(this.state.localMedia);
            }
            history.push('/ready');
        }
    }

    callKeepSendDtmf(digits) {
        if (this.state.currentCall) {
            this._callManager.callKeep.sendDTMF(this.state.currentCall._callkeepUUID, digits);
        }
    }

    callKeepToggleMute(mute) {
        if (this.state.currentCall) {
            this._callManager.callKeep.setMutedCall(this.state.currentCall._callkeepUUID, mute);
        }
    }

    escalateToConference(participants) {
        this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
        this.state.currentCall.terminate();
        history.push('/ready');
        this.setState({currentCall: null, localMedia: null});
        this.participantsToInvite = participants;
        const uri = `${utils.generateSillyName()}@${config.defaultConferenceDomain}`;
        this.startConference(uri);
    }

    startConference(targetUri) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: true, video: true}, '/conference');
    }

    startGuestConference(targetUri) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia({audio: true, video: true});
    }

    toggleMute() {
        this.muteIncoming = !this.muteIncoming;
    }

    outgoingCall(call) {
        this._callManager.handleSession(call, this._tmpCallStartInfo.uuid);
        this._tmpCallStartInfo = {};
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
        InCallManager.start({media: false ? 'video' : 'audio'});
        this._callManager.callKeep.updateDisplay(call._callkeepUUID, call.remoteIdentity.displayName, call.remoteIdentity.uri);
    }

    incomingCall(call, mediaTypes) {
        this._callManager.handleSession(call);

        logger.debug('New incoming call from %o with %o', call.remoteIdentity, mediaTypes);
        if (!mediaTypes.audio && !mediaTypes.video) {
            // call.terminate();
            this.callKeepHangupCall();
            return;
        }
        call.mediaTypes = mediaTypes;
        if (this.state.currentCall !== null) {
            // detect if we called ourselves
            if (this.state.currentCall.localIdentity.uri === call.remoteIdentity.uri) {
                logger.debug('Aborting call to myself');
                //call.terminate();
                this.callKeepHangupCall();
                return;
            }
            InCallManager.start({media: mediaTypes.video ? 'video' : 'audio'});
            RNCallKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName, callkeepType, mediaTypes.video);
            this.setState({ showIncomingModal: true, inboundCall: call });
            this.setFocusEvents(true);
            call.on('stateChanged', this.inboundCallStateChanged);
        } else {
            if (!this.muteIncoming) {
                //this.refs.audioPlayerInbound.play(true);
                InCallManager.start({media: mediaTypes.video ? 'video' : 'audio'});
                RNCallKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName, callkeepType, mediaTypes.video);
            }
            this.setFocusEvents(true);
            call.on('stateChanged', this.callStateChanged);
            this.setState({currentCall: call, inboundCall: call, showIncomingModal: true});
        }
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
        logger.debug('Missed call from ' + data.originator);
        this._notificationCenter.postSystemNotification('Missed call', {body: `From ${data.originator.displayName || data.originator.uri}`, timeout: 15, silent: false});
        if (this.state.currentCall !== null || !config.useServerCallHistory) {
            this._notificationCenter.postMissedCall(data.originator, () => {
                if (this.state.currentCall !== null) {
                    this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                    //this.state.currentCall.terminate();
                    this.callKeepHangupCall();
                    this.setState({currentCall: null, missedTargetUri: data.originator.uri, showIncomingModal: false, localMedia: null});
                } else {
                    this.setState({missedTargetUri: data.originator.uri});
                }
                history.push('/ready');
            });
        } else {
            this.getServerHistory();
        }
    }

    conferenceInvite(data) {
        logger.debug('Conference invite from %o to %s', data.originator, data.room);
        this._notificationCenter.postSystemNotification('Conference invite', {body: `From ${data.originator.displayName || data.originator.uri} for room ${data.room}`, timeout: 15, silent: false});
        this._notificationCenter.postConferenceInvite(data.originator, data.room, () => {
            if (this.state.currentCall !== null) {
                this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                this.state.currentCall.terminate();
                this.setState({currentCall: null, showIncomingModal: false, localMedia: null, generatedVideoTrack: false});
            }
            this.startConference(data.room);
        });
    }

    startPreview() {
        this.getLocalMedia({audio: true, video: true}, '/preview');
    }

    addCallHistoryEntry(uri) {
        if (this.state.mode === MODE_NORMAL) {
            // history.add(uri).then((entries) => {
            //     this.setState({history: entries});
            // });
        } else {
            let entries = this.state.history.slice();
            if (entries.length !== 0) {
                const idx = entries.indexOf(uri);
                if (idx !== -1) {
                    entries.splice(idx, 1);
                }
                entries.unshift(uri);
                // keep just the last 50
                entries = entries.slice(0, 50);
            } else {
                entries = [uri];
            }
            this.setState({history: entries});
        }
    }

    getServerHistory() {
        if (!config.useServerCallHistory) {
            return;
        }

        logger.debug('Requesting call history from server');
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
            let history = []
            data.placed.map(elem => {elem.direction = 'placed'; return elem});
            data.received.map(elem => {elem.direction = 'received'; return elem});
            history = data.placed;
            history = history.concat(data.received);
            history.sort((a,b) => {
                return new Date(b.startTime) - new Date(a.startTime);
            });
            const known = [];
            history = history.filter((elem) => {
                if (known.indexOf(elem.remoteParty) <= -1) {
                    if ((elem.media.indexOf('audio') > -1 || elem.media.indexOf('video') > -1) &&
                        (elem.remoteParty !== this.state.account.id || elem.direction !== 'placed')) {
                            known.push(elem.remoteParty);
                            return elem;
                    }
                }
            });
            this.setState({serverHistory: history});
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
                            <SafeAreaView style={[styles.root, extraStyles]}>

                                <LoadingScreen text={this.state.loading} show={this.state.loading !== null}/>

                                <IncomingCallModal
                                    call={this.state.inboundCall}
                                    onAnswer={this.callKeepAnswerCall}
                                    onHangup={this.callKeepRejectCall}
                                    show={this.state.showIncomingModal}
                                />

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
                                {footerBox}
                            </SafeAreaView>
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
        if (this.state.registrationState !== 'registered') {
            history.push('/login');
            return false;
        };

        return (
            <Fragment>
                <NavigationBar
                    notificationCenter = {this.notificationCenter}
                    account = {this.state.account}
                    logout = {this.logout}
                    preview = {this.startPreview}
                    toggleMute = {this.toggleMute}
                />
                <ReadyBox
                    account   = {this.state.account}
                    startCall = {this.callKeepStartCall}
                    startConference = {this.callKeepStartCall}
                    missedTargetUri = {this.state.missedTargetUri}
                    history = {this.state.history}
                    key = {this.state.missedTargetUri}
                    serverHistory = {this.state.serverHistory}
                />
            </Fragment>
        );
    }

    preview() {
        if (this.state.registrationState !== 'registered') {
            history.push('/login');
            return false;
        };
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
        if (this.state.registrationState !== 'registered') {
            history.push('/login');
            return false;
        };
        return (
            <Call
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.callKeepHangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
                callKeepSendDtmf = {this.callKeepSendDtmf}
                callKeepToggleMute = {this.callKeepToggleMute}
                callKeepStartCall = {this.callKeepStartCall}
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
                hangupCall = {this.callKeepHangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
            />
        );
    }

    conference() {
        if (this.state.registrationState !== 'registered') {
            history.push('/login');
            return false;
        };
        return (
            <Conference
                notificationCenter = {this.notificationCenter}
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                participantsToInvite = {this.participantsToInvite}
                hangupCall = {this.callKeepHangupCall}
                shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
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
                hangupCall = {this.callKeepHangupCall}
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
        this.setState({account: null, registrationState: null, status: null});
        history.push('/login');
        return null;
    }

    main() {
        return null;
    }
}

export default Blink;