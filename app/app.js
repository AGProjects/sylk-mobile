import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, ImageBackground } from 'react-native';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { BreadProvider } from "material-bread";
import { registerGlobals } from 'react-native-webrtc';
import { Router, Route, Link, Switch } from 'react-router-native';
import history from './history';
import debug from 'react-native-debug';
import DigestAuthRequest from 'digest-auth-request';
import autoBind from 'auto-bind';

debug.enable('*');

registerGlobals();

import * as sylkrtc from 'sylkrtc';

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

import utils from './utils';
import config from './config';
import storage from './storage';

import styles from './assets/styles/blink/root.scss';
const backgroundImage = require('./assets/images/dark_linen.png');

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

const DEBUG = debug('blinkrtc:App');

// Application modes
const MODE_NORMAL           = Symbol('mode-normal');
const MODE_PRIVATE          = Symbol('mode-private');
const MODE_GUEST_CALL       = Symbol('mode-guest-call');
const MODE_GUEST_CONFERENCE = Symbol('mode-guest-conference');


class Blink extends Component {
    constructor() {
        super();
        autoBind(this)
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
            devices: {}
        };
        this.state = Object.assign({}, this._initialSstate);

        this.__notificationCenter = null;

        this.participantsToInvite = null;
        this.redirectTo = null;
        this.prevPath = null;
        this.shouldUseHashRouting = false;
        this.muteIncoming = false;

        storage.initialize();

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

    componentDidMount() {
        history.push('/login');

        // prime the ref
        DEBUG('NotificationCenter ref: %o', this._notificationCenter);
    }

    connectionStateChanged(oldState, newState) {
        DEBUG(`Connection state changed! ${oldState} -> ${newState}`);
        switch (newState) {
            case 'closed':
                this.setState({connection: null, loading: null});
                break;
            case 'ready':
                this.processRegistration(this.state.accountId, this.state.password, this.state.displayName);
                break;
            case 'disconnected':
                // this.refs.audioPlayerOutbound.stop();
                // this.refs.audioPlayerInbound.stop();

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
        DEBUG('Registration state changed! ' + newState);
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
            console.log('pushing ready onto history');
            history.push('/ready');
            console.log('pushed ready onto history');
            return;
        } else {
            this.setState({status: null });
        }
    }

    callStateChanged(oldState, newState, data) {
        DEBUG(`Call state changed! ${oldState} -> ${newState}`);

        switch (newState) {
            case 'progress':
                //this.refs.audioPlayerOutbound.play(true);
                break;
            case 'accepted':
                //this.refs.audioPlayerOutbound.stop();
                //this.refs.audioPlayerInbound.stop();
                break;
            case 'terminated':
                //this.refs.audioPlayerOutbound.stop();
                //this.refs.audioPlayerInbound.stop();
                //this.refs.audioPlayerHangup.play();

                let callSuccesfull = false;
                let reason = data.reason;
                if (!reason || reason.match(/200/)) {
                    reason = 'Hangup';
                    callSuccesfull = true;
                } else if (reason.match(/403/)) {
                    reason = 'This domain is not served here';
                } else if (reason.match(/404/)) {
                    reason = 'User not found';
                } else if (reason.match(/408/)) {
                    reason = 'Timeout';
                } else if (reason.match(/480/)) {
                    reason = 'User not online';
                } else if (reason.match(/486/) || reason.match(/60[036]/)) {
                    reason = 'Busy';
                } else if (reason.match(/487/)) {
                    reason = 'Cancelled';
                } else if (reason.match(/488/)) {
                    reason = 'Unacceptable media';
                } else if (reason.match(/5\d\d/)) {
                    reason = 'Server failure';
                } else if (reason.match(/904/)) {
                    // Sofia SIP: WAT
                    reason = 'Bad account or password';
                } else {
                    reason = 'Connection failed';
                }
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

                break;
            default:
                break;
        }
    }

    inboundCallStateChanged(oldState, newState, data) {
        DEBUG('Inbound Call state changed! ' + newState);
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
            DEBUG('Connection Present, try to register');
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
            DEBUG('Connection Present, try to register');
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
            console.log('HALP');
        } else {
            DEBUG('Connection Present, try to register');
            this.processRegistration(accountId, password, '');
        }
    }

    processRegistration(accountId, password, displayName) {
        if (this.state.account !== null) {
            DEBUG('We already have an account, removing it');
            this.state.connection.removeAccount(this.state.account,
                (error) => {
                    if (error) {
                        DEBUG(error);
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
                        DEBUG(`${accountId} (guest) signed in`);
                        // Start the call immediately, this is call started with "Call by URI"
                        this.startGuestCall(this.state.targetUri, {audio: true, video: true});
                        break;
                    case MODE_GUEST_CONFERENCE:
                        this.setState({account: account, loading: null, registrationState: 'registered'});
                        DEBUG(`${accountId} (conference guest) signed in`);
                        // Start the call immediately, this is call started with "Conference by URI"
                        this.startGuestConference(this.state.targetUri);
                        break;
                    default:
                        DEBUG(`Unknown mode: ${this.state.mode}`);
                        break;

                }
            } else {
                DEBUG('Add account error: ' + error);
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
        DEBUG('getLocalMedia(), mediaConstraints=%o', mediaConstraints);
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

        DEBUG('getLocalMedia(), (modified) mediaConstraints=%o', constraints);

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
                        constraints.audio = {
                            deviceId: {
                                exact: device.deviceId
                            }
                        };
                    }
                }
            });
        })
        .catch((error) => {
            DEBUG('Device enumeration failed: %o', error);
        })
        .then(() => {
            return navigator.mediaDevices.getUserMedia(constraints)
        })
        .then((localStream) => {
            clearTimeout(this.loadScreenTimer);
            DEBUG('Got local Media', localStream);
            this.setState({status: null, loading: null, localMedia: localStream});
            if (nextRoute !== null) {
                history.push(nextRoute);
            }
        })
        .catch((error) => {
            DEBUG('Access failed, trying audio only: %o', error);
            navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            })
            .then((localStream) => {
                clearTimeout(this.loadScreenTimer);

                if (nextRoute != '/preview') {
                    DEBUG('Audio only media, but video was requested, creating generated video track');
                    const generatedVideoTrack = utils.generateVideoTrack(localStream);
                    localStream.addTrack(generatedVideoTrack);
                }

                this.setState({status: null, loading: null, localMedia: localStream, generatedVideoTrack: true});
                if (nextRoute !== null) {
                    history.push(nextRoute);
                }
            })
            .catch((error) => {
                DEBUG('Access to local media failed: %o', error);
                clearTimeout(this.loadScreenTimer);
                this._notificationCenter.postSystemNotification("Can't access camera or microphone", {timeout: 10});
                this.setState({
                    loading: null
                });
            });
        });
    }

    startCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.addCallHistoryEntry(targetUri);
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    startGuestCall(targetUri, options) {
        this.setState({targetUri: targetUri});
        this.getLocalMedia(Object.assign({audio: true, video: true}, options));
    }

    answerCall(options) {
        this.setState({ showIncomingModal: false });
        this.setFocusEvents(false);
        if (this.state.inboundCall !== this.state.currentCall) {
            // terminate current call to switch to incoming one
            this.state.inboundCall.removeListener('stateChanged', this.inboundCallStateChanged);
            this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
            this.state.currentCall.terminate();
            this.setState({currentCall: this.state.inboundCall, inboundCall: this.state.inboundCall, localMedia: null});
            this.state.inboundCall.on('stateChanged', this.callStateChanged);
        }
        this.getLocalMedia(Object.assign({audio: true, video: true}, options), '/call');
    }

    rejectCall() {
        this.setState({showIncomingModal: false});
        this.state.inboundCall.terminate();
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
        call.on('stateChanged', this.callStateChanged);
        this.setState({currentCall: call});
    }

    incomingCall(call, mediaTypes) {
        DEBUG('New incoming call from %o with %o', call.remoteIdentity, mediaTypes);
        if (!mediaTypes.audio && !mediaTypes.video) {
            call.terminate();
            return;
        }
        call.mediaTypes = mediaTypes;
        if (this.state.currentCall !== null) {
            // detect if we called ourselves
            if (this.state.currentCall.localIdentity.uri === call.remoteIdentity.uri) {
                DEBUG('Aborting call to myself');
                call.terminate();
                return;
            }
            this.setState({ showIncomingModal: true, inboundCall: call });
            this.setFocusEvents(true);
            call.on('stateChanged', this.inboundCallStateChanged);
        } else {
            if (!this.muteIncoming) {
                //this.refs.audioPlayerInbound.play(true);
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
        DEBUG('Missed call from ' + data.originator);
        this._notificationCenter.postSystemNotification('Missed call', {body: `From ${data.originator.displayName || data.originator.uri}`, timeout: 15, silent: false});
        if (this.state.currentCall !== null || !config.useServerCallHistory) {
            this._notificationCenter.postMissedCall(data.originator, () => {
                if (this.state.currentCall !== null) {
                    this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                    this.state.currentCall.terminate();
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
        DEBUG('Conference invite from %o to %s', data.originator, data.room);
        this._notificationCenter.postSystemNotification('Conference invite', {body: `From ${data.originator.displayName || data.originator.uri} for room ${data.room}`, timeout: 15, silent: false});
        this._notificationCenter.postConferenceInvite(data.originator, data.room, () => {
            if (this.state.currentCall !== null) {
                this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
                this.state.currentCall.terminate();
                this.setState({currentCall: null, showIncomingModal: false, localMedia: null, generatedVideoTrack: false});
            }
            setTimeout(() => {
                this.startConference(data.room);
            });
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

        DEBUG('Requesting call history from server');
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
                DEBUG('Error getting call history from server: %o', data.error_message)
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
            DEBUG('Error getting call history from server: %o', errorCode)
        });
    }

    // checkRoute(nextPath, navigation, match) {
    //     if (nextPath !== this.prevPath) {
    //         DEBUG(`Transition from ${this.prevPath} to ${nextPath}`);

    //         if (config.useServerCallHistory && nextPath === '/ready' && this.state.registrationState === 'registered' && (this.state.mode !== MODE_GUEST_CALL && this.state.mode !== MODE_GUEST_CONFERENCE)) {
    //             this.getServerHistory();
    //         }
    //         // Press back in ready after a login, prevent initial navigation
    //         // don't deny if there is no registrationState (connection fail)
    //         if (this.prevPath === '/ready' && nextPath === '/login' && this.state.registrationState !== null) {
    //             DEBUG('Transition denied redirecting to /logout');
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
                                    onAnswer={this.answerCall}
                                    onHangup={this.rejectCall}
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
            setTimeout(() => {
                history.push('/login');
            });
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
                    startCall = {this.startCall}
                    startConference = {this.startConference}
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
            setTimeout(() => {
                history.push('/login');
            });
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
            setTimeout(() => {
                history.push('/login');
            });
            return false;
        };
        return (
            <Call
                localMedia = {this.state.localMedia}
                account = {this.state.account}
                targetUri = {this.state.targetUri}
                currentCall = {this.state.currentCall}
                escalateToConference = {this.escalateToConference}
                hangupCall = {this.hangupCall}
                // shareScreen = {this.switchScreensharing}
                generatedVideoTrack = {this.state.generatedVideoTrack}
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
        if (this.state.registrationState !== 'registered') {
            setTimeout(() => {
                history.push('/login');
            });
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
                hangupCall = {this.hangupCall}
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
        setTimeout(() => {
            if (this.state.registrationState !== null && (this.state.mode === MODE_NORMAL || this.state.mode === MODE_PRIVATE)) {
                this.state.account.unregister();
            }

            if (this.state.account !== null) {
                this.state.connection.removeAccount(this.state.account,
                    (error) => {
                        if (error) {
                            DEBUG(error);
                        }
                    }
                );
            }
            storage.set('account', {accountId: this.state.accountId, password: ''});
            this.setState({account: null, registrationState: null, status: null});
            history.push('/login');
        });
        return <Fragment />;
    }

    main() {
        return null;
    }
}

export default Blink;