import events from 'events';
import Logger from '../Logger';
import uuid from 'react-native-uuid';
import { Platform, PermissionsAndroid } from 'react-native';
import utils from './utils';

const logger = new Logger('CallManager');
import { CONSTANTS as CK_CONSTANTS } from 'react-native-callkeep';

// https://github.com/react-native-webrtc/react-native-callkeep

/*
const CONSTANTS = {
  END_CALL_REASONS: {
    FAILED: 1,
    REMOTE_ENDED: 2,
    UNANSWERED: 3,
    ANSWERED_ELSEWHERE: 4,
    DECLINED_ELSEWHERE: 5,
    MISSED: 6
  }
};
*/

const options = {
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
        selfManaged: true,
        imageName: 'phone_account_icon',
        additionalPermissions: [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.READ_CONTACTS],
        foregroundService: {
          channelId: 'com.agprojects.sylk',
          channelName: 'Foreground service for Sylk',
          notificationTitle: 'Sylk is running in the background'
        }
    }
};

export default class CallManager extends events.EventEmitter {
    constructor(RNCallKeep, showInternetAlertPanelFunc, acceptFunc, rejectFunc, hangupFunc, timeoutFunc, conferenceCallFunc, startCallFromCallKeeper, muteFunc, getConnectionFunct, missedCallFunc, changeRouteFunc, respawnConnection, isUnmountedFunc) {
        //logger.debug('constructor()');
        super();
        this.setMaxListeners(Infinity);

        this._RNCallKeep = RNCallKeep;

        this._calls = new Map();
        this._pushCalls = new Map();
        this._incoming_conferences = new Map();
        this._rejectedCalls = new Map();
        this._acceptedCalls = new Map();
        this._cancelledCalls = new Map();
        this._alertedCalls = new Map();
        this._terminatedCalls = new Map();
        this.unmounted = isUnmountedFunc;

        this.webSocketActions = new Map();
        this.pushNotificationsActions = new Map();
        this._timeouts = new Map();

        this.sylkAcceptCall = acceptFunc;
        this.sylkRejectCall = rejectFunc;
        this.sylkHangupCall = hangupFunc;
        this.timeoutCall = timeoutFunc;
        this.logMissedCall = missedCallFunc;
        this.getConnection = getConnectionFunct;
        this.showInternetAlertPanel = showInternetAlertPanelFunc;
        this.changeRoute = changeRouteFunc;
        this.respawnConnection = respawnConnection;

        this.toggleMute = muteFunc;

        this.conferenceCall = conferenceCallFunc;
        this.outgoingMedia = {audio: true, video: true}

        this.startCallFromOutside = startCallFromCallKeeper;

        this._boundRnAccept = this._rnAccept.bind(this);
        this._boundRnEnd = this._rnEnd.bind(this);
        this._boundRnMute = this._rnMute.bind(this);
        this._boundRnActiveAudioCall = this._rnActiveAudioSession.bind(this);
        this._boundRnDeactiveAudioCall = this._rnDeactiveAudioSession.bind(this);
        this._boundRnDTMF = this._rnDTMF.bind(this);
        this._boundRnProviderReset = this._rnProviderReset.bind(this);
        this.boundRnStartAction = this._startedCall.bind(this);
        this.boundRnDisplayIncomingCall = this._displayIncomingCall.bind(this);
        this.boundRnShowIncomingCallUi = this._showIncomingCallUi.bind(this);

        this._RNCallKeep.addEventListener('answerCall', this._boundRnAccept);
        this._RNCallKeep.addEventListener('endCall', this._boundRnEnd);
        this._RNCallKeep.addEventListener('didPerformSetMutedCallAction', this._boundRnMute);
        this._RNCallKeep.addEventListener('didActivateAudioSession', this._boundRnActiveAudioCall);
        this._RNCallKeep.addEventListener('didDeactivateAudioSession', this._boundRnDeactiveAudioCall);
        this._RNCallKeep.addEventListener('didPerformDTMFAction', this._boundRnDTMF);
        this._RNCallKeep.addEventListener('didResetProvider', this._boundRnProviderReset);
        this._RNCallKeep.addEventListener('didReceiveStartCallAction', this.boundRnStartAction);
        this._RNCallKeep.addEventListener('didDisplayIncomingCall', this.boundRnDisplayIncomingCall);
        if (Platform.OS === 'android') {
            this._RNCallKeep.addEventListener('showIncomingCallUi', this.boundRnShowIncomingCallUi);
        }

        this._RNCallKeep.setup(options);
        this.selfManaged = options.android.selfManaged && Platform.OS === 'android';

        this._RNCallKeep.canMakeMultipleCalls(false);

        this._RNCallKeep.addEventListener('checkReachability', () => {
            this._RNCallKeep.setReachable();
        });

    }

    get callKeep() {
        return this._RNCallKeep;
    }

    get countCalls() {
        return this._calls.size;
    }

    get countPushCalls() {
        return this._pushCalls.size;
    }

    get waitingCount() {
        return this._timeouts.size;
    }

    get callUUIDS() {
        return Array.from( this._calls.keys() );
    }

    get calls() {
        return [...this._calls.values()];
    }

    setAvailable(available) {
        this.callKeep.setAvailable(available);
    }

    heartbeat() {
        this.callUUIDS.forEach((callUUID) => {
            //utils.timestampedLog('Callkeep: call active', callUUID);
        });
    }

    backToForeground() {
       utils.timestampedLog('Callkeep: bring app to the FOREGROUND');
       this.callKeep.backToForeground();
    }

    startOutgoingCall(call) {
        let callUUID = call.id;
        let targetUri = call.remoteIdentity.uri;

        if (!this.addWebsocketCall(call)) {
            return;
        }

        const localStreams = call.getLocalStreams();
        let mediaType = 'audio';
        let hasVideo = false;

        if (localStreams.length > 0) {
            const localStream = call.getLocalStreams()[0];
            mediaType = localStream.getVideoTracks().length > 0 ? 'video' : 'audio';
            hasVideo = localStream.getVideoTracks().length > 0 ? true : false;
        }

        utils.timestampedLog('Callkeep: will start call', callUUID, 'to', targetUri);
        this.callKeep.startCall(callUUID, targetUri, targetUri, 'email', hasVideo);
    }

    updateDisplay(callUUID, displayName, uri) {
        utils.timestampedLog('Callkeep: update display', displayName, uri);
        this.callKeep.updateDisplay(callUUID, displayName, uri);
    }

    setCurrentCallActive(callUUID) {
        if (Platform.OS !== 'android') {
            return;
        }

        utils.timestampedLog('Callkeep: active call', callUUID);
        this.callKeep.setCurrentCallActive(callUUID);
        this.backToForeground();
    }

    endCalls() {
        utils.timestampedLog('Callkeep: end all calls');
        this.callKeep.endAllCalls();
    }

    endCall(callUUID, reason) {
        if (this.unmounted()) {
            return;
        }

        if (reason) {
            utils.timestampedLog('Callkeep: end call', callUUID, 'with reason', reason);
        } else {
            utils.timestampedLog('Callkeep: end call', callUUID);
        }

        if (this._pushCalls.has(callUUID)) {
            this._pushCalls.delete(callUUID);
        }

        if (this._rejectedCalls.has(callUUID)) {
        //    return;
        }

        if (this._cancelledCalls.has(callUUID)) {
            //utils.timestampedLog('Callkeep: CALL', callUUID, 'already cancelled');
            return;
        }

        if (reason === 2) {
            this._cancelledCalls.set(callUUID, Date.now());
        }

        if (reason) {
            this.callKeep.reportEndCallWithUUID(callUUID, reason);
            if (this._timeouts.has(callUUID)) {
                clearTimeout(this._timeouts.get(callUUID));
                this._timeouts.delete(callUUID);
            }
        }
        this.callKeep.endCall(callUUID);
    }

    terminateCall(callUUID) {
        //utils.timestampedLog('Callkeep: call terminated', callUUID);

        this._terminatedCalls.set(callUUID, Date.now());

        if (this._calls.has(callUUID)) {
            utils.timestampedLog('Callkeep: removed websocket call', callUUID);
            this._calls.delete(callUUID);
        }

        if (this._pushCalls.has(callUUID)) {
            this._pushCalls.delete(callUUID);
        }
    }

    _rnActiveAudioSession() {
        utils.timestampedLog('Callkeep: activated audio call');
    }

    _rnDeactiveAudioSession() {
        utils.timestampedLog('Callkeep: deactivated audio call');
    }

    _rnAccept(data) {
        utils.timestampedLog('---- Callkeep: accept callback', callUUID);

        if (!data.callUUID) {
            utils.timestampedLog('---- Callkeep: accept callback failed, no callUUID');
           return;
        }

        let callUUID = data.callUUID.toLowerCase();

        if (this._pushCalls.has(callUUID)) {
            this._pushCalls.delete(callUUID);
        }

        if (this._rejectedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: cannot accept because we already rejected', callUUID);
            //this.endCall(callUUID);
            return;
        }

        this.acceptCall(callUUID);
    }

    _rnEnd(data) {
        if (!data.callUUID) {
            return;
        }

        // this is called both when user touches Reject and when the call ends
        let callUUID = data.callUUID.toLowerCase();
        utils.timestampedLog('---- Callkeep: end callback', callUUID);
        if (this._timeouts.has(callUUID)) {
            clearTimeout(this._timeouts.get(callUUID));
            this._timeouts.delete(callUUID);
        }

        if (this._terminatedCalls.has(callUUID)) {
            //utils.timestampedLog('Callkeep: call', callUUID, 'already terminated');
            return;
        }

        if (this._pushCalls.has(callUUID)) {
            this._pushCalls.delete(callUUID);
        }

        let call = this._calls.get(callUUID);

        if (!call && !this._incoming_conferences.has(callUUID)) {
            utils.timestampedLog('Callkeep: add call', callUUID, 'reject to the waitings list');
            this.webSocketActions.set(callUUID, {action: 'reject'});
            return;
        }

        if (call && call.state === 'incoming') {
            if (!this._acceptedCalls.has(callUUID)) {
                this.rejectCall(callUUID);
            }
        } else {
            if (this._incoming_conferences.has(callUUID)) {
                const conference = this._incoming_conferences.get(callUUID);
                this.logMissedCall(conference.room, callUUID, 'received', [conference.from]);
                this._incoming_conferences.delete(callUUID);
            } else {
                this.sylkHangupCall(callUUID, 'callkeep_hangup_call');
            }
        }
    }

    acceptCall(callUUID, options={}) {
        if (this.unmounted()) {
            return;
        }

        console.log('CallKeep acceptCall', callUUID, options);
        const connection = this.getConnection();

        if (this._acceptedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: already accepted call', callUUID, 'on web socket', connection);
            this.endCall(callUUID);
            return;
        } else {
            utils.timestampedLog('Callkeep: accept call', callUUID, 'on web socket', connection);
        }

        if (this._terminatedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: call', callUUID, 'was already terminated', 'on web socket', connection);
            this.endCall(callUUID);
            return;
        }

        this._acceptedCalls.set(callUUID, Date.now());

        if (this._timeouts.has(callUUID)) {
            clearTimeout(this._timeouts.get(callUUID));
            this._timeouts.delete(callUUID);
        }

        if (this._incoming_conferences.has(callUUID)) {
            let conference = this._incoming_conferences.get(callUUID);

            utils.timestampedLog('Callkeep: accept incoming conference', callUUID);
            this.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.ANSWERED_ELSEWHERE);
            this.backToForeground();

            utils.timestampedLog('Callkeep: will start conference to', conference.room);
            this.conferenceCall(conference.room, this.outgoingMedia);
            this._incoming_conferences.delete(callUUID);

        } else if (this._calls.has(callUUID)) {
            this.backToForeground();
            this.sylkAcceptCall(callUUID, options);

        } else {
            this.backToForeground();
            utils.timestampedLog('Callkeep: add call', callUUID, 'accept to the waitings list');
            // We accepted the call before it arrived on web socket
            this.respawnConnection();
            this.webSocketActions.set(callUUID, {action: 'accept', options: options});
            utils.timestampedLog('Callkeep: check over 30 seconds if call', callUUID, 'arrived over web socket');

            setTimeout(() => {
                const connection = this.getConnection();
                utils.timestampedLog('Callkeep: current calls:', this.callUUIDS);

                if (!this._calls.has(callUUID) && !this._terminatedCalls.has(callUUID)) {
                    utils.timestampedLog('Callkeep: call', callUUID, 'did not arrive on web socket', connection);
                    this.webSocketActions.delete(callUUID);
                    this.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.FAILED);
                    this.sylkHangupCall(callUUID, 'timeout');
                } else {
                    utils.timestampedLog('Callkeep: call', callUUID, 'did arrive on web socket', connection);
                }
            }, 30000);
        }
    }

    rejectCall(callUUID) {
        if (this.unmounted()) {
            return;
        }

        const connection = this.getConnection();
        if (this._rejectedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: already rejected call', callUUID, 'on web socket', connection);
            //this.endCall(callUUID);
            return;
        }

        utils.timestampedLog('Callkeep: reject call', callUUID, 'on web socket', connection);

        this._rejectedCalls.set(callUUID, Date.now());

        if (this._timeouts.has(callUUID)) {
            clearTimeout(this._timeouts.get(callUUID));
            this._timeouts.delete(callUUID);
        }

        this.callKeep.rejectCall(callUUID);

        if (this._incoming_conferences.has(callUUID)) {
            utils.timestampedLog('Callkeep: reject conference invite', callUUID);
            let room = this._incoming_conferences.get(callUUID);
            this._incoming_conferences.delete(callUUID);

        } else if (this._calls.has(callUUID)) {
            let call = this._calls.get(callUUID);
            if (call.state === 'incoming') {
                this.sylkRejectCall(callUUID, 'user_reject_call');
            } else {
                // how can we end up here for a rejected call?
                this.sylkHangupCall(callUUID, 'user_reject_call');
            }
        } else {
            // We rejected the call before it arrived on web socket
            // from iOS push notifications
            utils.timestampedLog('Callkeep: add call', callUUID, 'reject to the waitings list');
            this.webSocketActions.set(callUUID, {action: 'reject'});
            utils.timestampedLog('Callkeep: check over 20 seconds if call', callUUID, 'arrived on web socket');

            setTimeout(() => {
                if (!this._calls.has(callUUID)) {
                    utils.timestampedLog('Callkeep: call', callUUID, 'did not arrive on web socket');
                    this.webSocketActions.delete(callUUID);
                    this.endCall(callUUID);
                }
            }, 20000);
        }

        //this.endCall(callUUID);
    }

    setMutedCall(callUUID, mute=false) {
        //utils.timestampedLog('Callkeep: set call', callUUID, 'muted =', mute);

        if (this._calls.has(callUUID)) {
            this.callKeep.setMutedCall(callUUID, mute);
            let call = this._calls.get(callUUID);
            const localStream = call.getLocalStreams()[0];

            if (mute) {
                utils.timestampedLog('Callkeep: local stream audio track disabled');
            } else {
                utils.timestampedLog('Callkeep: local stream audio track enabled');
            }
            localStream.getAudioTracks()[0].enabled = !mute;
        }
    }

    _rnMute(data) {
        if (!data.callUUID) {
            return;
        }

        let callUUID = data.callUUID.toLowerCase();
        utils.timestampedLog('Callkeep: mute ' + data.muted + ' for call', callUUID);
        this.toggleMute(callUUID, data.muted);
    }

    _rnDTMF(data) {
        if (!data.callUUID) {
            return;
        }

        let callUUID = data.callUUID.toLowerCase();
        utils.timestampedLog('Callkeep: got dtmf for call', callUUID);
        if (this._calls.has(callUUID)) {
            let call = this._calls.get(callUUID);
            utils.timestampedLog('sending webrtc dtmf', data.digits)
            call.sendDtmf(data.digits);
        }
    }

    sendDTMF(callUUID, digits) {
        let call = this._calls.get(callUUID);
        if (call) {
            utils.timestampedLog('Callkeep: send DTMF: ', digits);
            call.sendDtmf(digits);
        }
    }

    _rnProviderReset() {
        utils.timestampedLog('Callkeep: got a provider reset, clearing down all calls');
        this._calls.forEach((call) => {
            call.terminate();
        });
    }

    addWebsocketCall(call) {
        if (this.unmounted()) {
            return false;
        }

        const connection = this.getConnection();
        if (this._calls.has(call.id)) {
            return false;
        }

        utils.timestampedLog('Callkeep: added websocket call', call.id, 'for web socket', connection);
        this._calls.set(call.id, call);
        return true;
    }

    incomingCallFromPush(callUUID, from, displayName, mediaType, force=false, skipNativePanel=false) {
        if (this.unmounted()) {
            return;
        }
        utils.timestampedLog('Callkeep: incoming', mediaType, 'push call', callUUID, 'from', from);
        const hasVideo = mediaType === 'video' ? true : false;

        if (this._pushCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: push call already handled', callUUID);
            return;
        }

        this._pushCalls.set(callUUID, true);

        if (this._rejectedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: call already rejected', callUUID);
            this.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.UNANSWERED);
            return;
        }

        if (this._acceptedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: call already accepted', callUUID);
            return;
        }

        // if user does not decide anything this will be handled later
        this._timeouts.set(callUUID, setTimeout(() => {
            utils.timestampedLog('Callkeep: incoming call', callUUID, 'timeout');
            let reason = this.webSocketActions.has(callUUID) ? CK_CONSTANTS.END_CALL_REASONS.FAILED : CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;

            if (!this._terminatedCalls.has(callUUID) && !this._calls.has(callUUID)) {
                const connection = this.getConnection();
                utils.timestampedLog('Callkeep: call', callUUID, 'did not arive on web socket', connection);
                reason = CK_CONSTANTS.END_CALL_REASONS.FAILED;
            } else if (this._calls.has(callUUID)) {
                utils.timestampedLog('Callkeep: user did not accept or reject', callUUID);
            }
            this.endCall(callUUID, reason);
            this._timeouts.delete(callUUID);
        }, 45000));

        if (Platform.OS === 'ios') {
            this.showAlertPanel(callUUID, from, displayName, hasVideo);
        } else {
            if (this._calls.has(callUUID) || force) {
                // on Android display alert panel only after websocket call arrives
                // force is required when Android is locked, if we do not bring up the panel, the app will not wake up
                if (!skipNativePanel || force) {
                    this.showAlertPanel(callUUID, from, displayName, hasVideo);
                } else {
                    utils.timestampedLog('Callkeep: call', callUUID, 'skipped display of native panel');
                }
            } else {
                utils.timestampedLog('Callkeep: waiting for call', callUUID, 'on web socket');
                this.showAlertPanel(callUUID, from, displayName, hasVideo);
            }
        }
    }

    incomingCallFromWebSocket(call, accept=false, skipNativePanel=false) {
        if (this.unmounted()) {
            return;
        }
        const connection = this.getConnection();

        this.addWebsocketCall(call);

        utils.timestampedLog('Callkeep: incoming call', call.id, 'on web socket', connection);

        // if the call came via push and was already accepted or rejected
        if (this.webSocketActions.has(call.id)) {
            let actionObject = this.webSocketActions.get(call.id);
            utils.timestampedLog('Callkeep: execute action decided earlier', actionObject.action);

            if (actionObject.action === 'accept') {
                this.sylkAcceptCall(call.id, actionObject.options);
            } else {
                this.sylkRejectCall(call.id);
            }

            this.webSocketActions.delete(call.id);

        } else {
            if (accept) {
                this.acceptCall(call.id);
            } else {
                if (Platform.OS === 'ios') {
                    this.showAlertPanelforCall(call);
                }
            }
        }

        // Emit event.
        this._emitSessionsChange(true);
    }

    handleConference(callUUID, room, from_uri, displayName, mediaType, outgoingMedia) {
        if (this.unmounted()) {
            return;
        }

        if (this._incoming_conferences.has(callUUID)) {
            return;
        }

        displayName = from_uri + ' and others';
        const hasVideo = mediaType === 'video' ? true : false;

        this._incoming_conferences.set(callUUID, {room: room, from: from_uri});
        this.outgoingMedia = outgoingMedia;

        utils.timestampedLog('CallKeep: handle conference', callUUID, 'from', from_uri, 'to room', room);

        this.showAlertPanel(callUUID, room, displayName, hasVideo);

        this._timeouts.set(callUUID, setTimeout(() => {
            utils.timestampedLog('Callkeep: conference timeout', callUUID);
            this.timeoutCall(callUUID, from_uri);
            this.endCall(callUUID, CK_CONSTANTS.END_CALL_REASONS.MISSED);
            this._timeouts.delete(callUUID);
        }, 45000));

        this._emitSessionsChange(true);
    }

    showAlertPanelforCall(call, force=false) {
        const hasVideo = call.mediaTypes && call.mediaTypes.video;
        this.showAlertPanel(call.id, call.remoteIdentity.uri, call.remoteIdentity.displayName, hasVideo);
    }

    showAlertPanel(callUUID, from, displayName, hasVideo=false) {
        if (this.unmounted()) {
            return;
        }

        if (this._alertedCalls.has(callUUID)) {
            utils.timestampedLog('Callkeep: call', callUUID, 'was already alerted');
            return;
        }

        let panelFrom = from;
        let callerType = 'number';
        let supportsDTMF = false;
        const username = from.split('@')[0];
        const isPhoneNumber = username.match(/^(\+|0)(\d+)$/);
        if (isPhoneNumber) {
            panelFrom = username;
            supportsDTMF = true;
        } else {
            callerType = 'email';
            panelFrom = from.indexOf('@guest.') > -1 ? displayName : from;
        }

        this._alertedCalls.set(callUUID, Date.now());

        const options = {supportsHolding: false,
                         supportsGrouping: false,
                         supportsUngrouping: false,
                         supportsDTMF: supportsDTMF}

        utils.timestampedLog('Callkeep: ALERT PANEL for', callUUID, 'from', from, '(', displayName, ')');
        this.callKeep.displayIncomingCall(callUUID, panelFrom, displayName, callerType, hasVideo, options);
    }

   _startedCall(data) {
        if (!data.callUUID) {
            return;
        }

        let callUUID = data.callUUID.toLowerCase();
        //utils.timestampedLog("Callkeep: STARTED NATIVE CALL", callUUID);
        if (!this._calls.has(callUUID)) {
            // call has started from OS native dialer
            this.startCallFromOutside(data);
        }
    }

    _displayIncomingCall(data) {
        utils.timestampedLog('Callkeep: Incoming alert panel displayed');
    }

    _showIncomingCallUi(data) {
        if (this._calls.has(data.callUUID)) {
            console.log('Callkeep: show incoming call UI', data.callUUID);
            let call = this._calls.get(data.callUUID);
            this.showInternetAlertPanel(call);
        }
    }

    _emitSessionsChange(countChanged) {
        this.emit('sessionschange', countChanged);
    }

    destroy() {
        this._RNCallKeep.removeEventListener('acceptCall', this._boundRnAccept);
        this._RNCallKeep.removeEventListener('endCall', this._boundRnEnd);
        this._RNCallKeep.removeEventListener('didPerformSetMutedCallAction', this._boundRnMute);
        this._RNCallKeep.removeEventListener('didActivateAudioSession',  this._boundRnActiveAudioCall);
        this._RNCallKeep.removeEventListener('didDeactivateAudioSession', this._boundRnDeactiveAudioCall);
        this._RNCallKeep.removeEventListener('didPerformDTMFAction', this._boundRnDTMF);
        this._RNCallKeep.removeEventListener('didResetProvider', this._boundRnProviderReset);
        this._RNCallKeep.removeEventListener('didReceiveStartCallAction', this.boundRnStartAction);
        this._RNCallKeep.removeEventListener('didDisplayIncomingCall', this.boundRnDisplayIncomingCall);
        if (Platform.OS === 'android') {
            this._RNCallKeep.removeEventListener('showIncomingCallUi', this.boundRnShowIncomingCallUi);
        }
    }
}
