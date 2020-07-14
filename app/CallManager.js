import events from 'events';
import Logger from '../Logger';
import uuid from 'react-native-uuid';
import { Platform } from 'react-native';
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

export default class CallManager extends events.EventEmitter {
    constructor(RNCallKeep, acceptFunc, rejectFunc, hangupFunc, timeoutFunc, conferenceCallFunc) {
        //logger.debug('constructor()');
        super();
        this.setMaxListeners(Infinity);

        this._RNCallKeep = RNCallKeep;

        this._calls = new Map();
        this._conferences = new Map();
        this._rejectedCalls = new Map();
        this._decideLater = new Map();
        this._timeouts = new Map();

        this.sylkAcceptCall = acceptFunc;
        this.sylkRejectCall = rejectFunc;
        this.sylkHangupCall = hangupFunc;
        this.timeoutCall = timeoutFunc;
        this.conferenceCall = conferenceCallFunc;

        this._boundRnAccept = this._rnAccept.bind(this);
        this._boundRnEnd = this._rnEnd.bind(this);
        this._boundRnMute = this._rnMute.bind(this);
        this._boundRnActiveAudioCall = this._rnActiveAudioSession.bind(this);
        this._boundRnDeactiveAudioCall = this._rnDeactiveAudioSession.bind(this);
        this._boundRnDTMF = this._rnDTMF.bind(this);
        this._boundRnProviderReset = this._rnProviderReset.bind(this);

        this._RNCallKeep.addEventListener('answerCall', this._boundRnAccept);
        this._RNCallKeep.addEventListener('endCall', this._boundRnEnd);
        this._RNCallKeep.addEventListener('didPerformSetMutedCallAction', this._boundRnMute);
        this._RNCallKeep.addEventListener('didActivateAudioSession', this._boundRnActiveAudioCall);
        this._RNCallKeep.addEventListener('didDeactivateAudioSession', this._boundRnDeactiveAudioCall.bind(this));
        this._RNCallKeep.addEventListener('didPerformDTMFAction', this._boundRnDTMF);
        this._RNCallKeep.addEventListener('didResetProvider', this._boundRnProviderReset);
    }

    get callKeep() {
        return this._RNCallKeep;
    }

    get count() {
        return this._calls.size;
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

    get activeCall() {
        for (let call of this.calls) {
            if (call.active) {
                return call;
            }
        }
    }

    backToForeground() {
       utils.timestampedLog('Callkeep: bring app to the foreground');
       this.callKeep.backToForeground();
    }

    setMutedCall(callUUID, mute) {
        utils.timestampedLog('Callkeep: set muted: ', mute);
        this.callKeep.setMutedCall(callUUID, mute);
    }

    startCall(callUUID, targetUri, targetName, hasVideo) {
        utils.timestampedLog('Callkeep: start outgoing call', callUUID);
        if (Platform.OS === 'ios') {
            this.callKeep.startCall(callUUID, targetUri, targetUri, 'email', hasVideo);
        } else if (Platform.OS === 'android') {
            this.callKeep.startCall(callUUID, targetUri, targetUri);
        }
    }

    updateDisplay(callUUID, displayName, uri) {
        utils.timestampedLog('Callkeep: update display', displayName, uri);
        this.callKeep.updateDisplay(callUUID, displayName, uri);
    }

    sendDTMF(callUUID, digits) {
        utils.timestampedLog('Callkeep: send DTMF: ', digits);
        this.callKeep.sendDTMF(callUUID, digits);
    }

    setCurrentCallActive(callUUID) {
        utils.timestampedLog('Callkeep: set call active', callUUID);
        this.callKeep.setCurrentCallActive(callUUID);
    }

    rejectCall(callUUID) {
        utils.timestampedLog('Callkeep: reject call', callUUID);
        this.callKeep.rejectCall(callUUID);
    }

    endCall(callUUID, reason) {
        utils.timestampedLog('Callkeep: end call', callUUID, ' with reason', reason);
        if (reason) {
            this.callKeep.reportEndCallWithUUID(callUUID, reason);
        } else {
            this.callKeep.endCall(callUUID);
        }
        this._calls.delete(callUUID);
    }

    _rnActiveAudioSession(data) {
        utils.timestampedLog('Callkeep: activated audio call');
        console.log(data);
    }

    _rnDeactiveAudioSession(data) {
        utils.timestampedLog('Callkeep: deactivated audio call');
        console.log(data);
    }

    _rnAccept(data) {
        let callUUID = data.callUUID.toLowerCase();
        utils.timestampedLog('Callkeep: accept callback', callUUID);
        if (this._conferences.has(callUUID)) {
            let room = this._conferences.get(callUUID);
            utils.timestampedLog('Callkeep: accept incoming conference', callUUID);
            this.callKeep.endCall(callUUID);
            this._conferences.delete(callUUID);

            if (this._timeouts.has(callUUID)) {
                clearTimeout(this._timeouts.get(callUUID));
                this._timeouts.delete(callUUID);
            }

            utils.timestampedLog('Will start conference to', room);
            this.conferenceCall(room);
            // start an outgoing conference call
        } else if (this._calls.has(callUUID)) {
            // if we have audio only we must skip video from get local media
            this.sylkAcceptCall();
        } else {
            // We accepted the call before it arrived on web socket
            // from iOS push notifications
            this._decideLater.set(callUUID, 'accept');
        }
    }

    _rnEnd(data) {
        //get the uuid, find the call with that uuid and ccept it
        let callUUID = data.callUUID.toLowerCase();
        utils.timestampedLog('Callkeep: end callback', callUUID);
        if (this._conferences.has(callUUID)) {
            utils.timestampedLog('Callkeep: reject conference invite', callUUID);
            let room = this._conferences.get(callUUID);
            this.callKeep.endCall(callUUID);
            this._conferences.delete(callUUID);

            if (this._timeouts.has(callUUID)) {
                clearTimeout(this._timeouts.get(callUUID));
                this._timeouts.delete(callUUID);
            }

        } else if (this._calls.has(callUUID)) {
            utils.timestampedLog('Callkeep: hangup call', callUUID);
            let call = this._calls.get(callUUID);
            if (call.state === 'incoming') {
                this.sylkRejectCall(callUUID);
            } else {
                this.sylkHangupCall(callUUID);
            }
        } else {
            // We rejected the call before it arrived on web socket
            // from iOS push notifications
            utils.timestampedLog('Callkeep: add call', callUUID, 'to the waitings list');
            this._decideLater.set(callUUID, 'reject');
            this._rejectedCalls.set(callUUID, true);

        }
    }

    _rnMute(data) {
        utils.timestampedLog('Callkeep: mute ' + data.muted + ' for call', data.callUUID);
        //get the uuid, find the call with that uuid and mute/unmute it
        if (this._calls.has(data.callUUID.toLowerCase())) {
            let call = this._calls.get(data.callUUID.toLowerCase());
            const localStream = call.getLocalStreams()[0];
            localStream.getAudioTracks()[0].enabled = !data.muted;
        }
    }

    _rnDTMF(data) {
        utils.timestampedLog('Callkeep: got dtmf for call', data.callUUID);
        if (this._calls.has(data.callUUID.toLowerCase())) {
            let call = this._calls.get(data.callUUID.toLowerCase());
            utils.timestampedLog('sending webrtc dtmf', data.digits)
            call.sendDtmf(data.digits);
        }
    }

    _rnProviderReset() {
        utils.timestampedLog('Callkeep: got a provider reset, clearing down all calls');
        this._calls.forEach((call) => {
            call.terminate();
        })
    }

    handleIncomingPushCall(callUUID, notificationContent) {
        // call is received by push notification
        utils.timestampedLog('Callkeep: handle later incoming call', callUUID);

        let reason = this._decideLater.has(callUUID) ? CK_CONSTANTS.END_CALL_REASONS.FAILED : CK_CONSTANTS.END_CALL_REASONS.UNANSWERED;

        // if user does not decide anything this will be handled later
        this._timeouts.set(callUUID, setTimeout(() => {
            utils.timestampedLog('Callkeep: end call later', callUUID);
            this.callKeep.reportEndCallWithUUID(callUUID, reason);
            this._timeouts.delete(callUUID);
        }, 45000));
    }

    handleIncomingWebSocketCall(call) {
        call._callkeepUUID = call.id;

        this._calls.set(call._callkeepUUID, call);
        utils.timestampedLog('Callkeep: start incoming call', call._callkeepUUID);

        if (this._timeouts.has(call.id)) {
            clearTimeout(this._timeouts.get(call.id));
            this._timeouts.delete(call.id);
        }

        // if the call came via push and was already accepted or rejected
        if (this._decideLater.get(call._callkeepUUID)) {
            let action = this._decideLater.get(call._callkeepUUID);
            utils.timestampedLog('Callkeep: execute action', action);
            if (action === 'accept') {
                this.sylkAcceptCall(call.id);
            } else {
                this.sylkRejectCall(call.id);
            }
            this._decideLater.delete(call._callkeepUUID);
        } else if (this._rejectedCalls.has(call._callkeepUUID)) {
            this.sylkRejectCall(call.id);
        } else {
            this.showAlertPanel(call);
        }

        // Emit event.
        this._emitSessionsChange(true);
    }

    handleOutgoingCall(call, callUUID) {
        // this is an outgoing call
        call._callkeepUUID = callUUID;

        this._calls.set(call._callkeepUUID, call);
        utils.timestampedLog('Callkeep: start outgoing call', call._callkeepUUID);
        this._calls.set(call._callkeepUUID, call);

        // Emit event.
        this._emitSessionsChange(true);
    }

    handleConference(callUUID, room, from_uri) {
        if (this._conferences.has(callUUID)) {
            return;
        }

        utils.timestampedLog('CallKeep: handle conference', callUUID, 'to uri', room);
        this._conferences.set(callUUID, room);
        this.showConferenceAlertPanel(callUUID, from_uri);

        // there is no cancel, so we add a timer
        this._timeouts.set(callUUID, setTimeout(() => {
            utils.timestampedLog('Callkeep: conference timeout', callUUID);
            this.timeoutCall(callUUID, from_uri);
            this.callKeep.reportEndCallWithUUID(callUUID, CK_CONSTANTS.END_CALL_REASONS.MISSED);
            this._timeouts.delete(callUUID);
        }, 45000));

        this._emitSessionsChange(true);
    }

    showConferenceAlertPanel(callUUID, uri) {
        utils.timestampedLog('Callkeep: show alert panel');

        if (Platform.OS === 'ios') {
            this.callKeep.displayIncomingCall(callUUID, uri, uri, 'email', true);
        } else if (Platform.OS === 'android') {
            this.callKeep.displayIncomingCall(callUUID, uri, uri);
        }
    }

    showAlertPanel(call) {
        utils.timestampedLog('Callkeep: show alert panel');

        if (Platform.OS === 'ios') {
            this.callKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName, 'email', call.mediaTypes.video);
        } else if (Platform.OS === 'android') {
            this.callKeep.displayIncomingCall(call._callkeepUUID, call.remoteIdentity.uri, call.remoteIdentity.displayName);
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
    }
}
