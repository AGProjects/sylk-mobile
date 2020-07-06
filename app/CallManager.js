import events from 'events';
import Logger from '../Logger';
import uuid from 'react-native-uuid';
import { Platform } from 'react-native';


const logger = new Logger('CallManager');
import { CONSTANTS as CK_CONSTANTS } from 'react-native-callkeep';

// https://github.com/react-native-webrtc/react-native-callkeep
export default class CallManager extends events.EventEmitter {
    constructor(RNCallKeep, acceptFunc, rejectFunc, hangupFunc, _sylkConferenceCallFunc) {
        logger.debug('constructor()');
        super();
        this.setMaxListeners(Infinity);

        // Set of current SIP sessions
        this._calls = new Map();
        this._conferences = new Map();

        this._waitingCalls = new Map();
        this._timeouts = new Map();
        this._RNCallKeep = RNCallKeep;
        console.log(RNCallKeep);

        this._sylkAnswerCall = acceptFunc;
        this._sylkRejectCall = rejectFunc;
        this._sylkHangupCall = hangupFunc;
        this._sylkConferenceCall = _sylkConferenceCallFunc;

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
       console.log('Callkeep: bring app to the foreground');
       this.callKeep.backToForeground();
    }

    acceptIncomingCall(callUUID) {
        console.log('Callkeep: accept incoming call', callUUID);
        this.callKeep.acceptIncomingCall(callUUID);
    }

    setMutedCall(callUUID, mute) {
        console.log('Callkeep: set muted: ', mute);
        this.callKeep.setMutedCall(callUUID, mute);
    }

    startCall(callUUID, targetUri, targetName, hasVideo) {
        console.log('Callkeep: start call', callUUID);
        if (Platform.OS === 'ios') {
            this.callKeep.startCall(callUUID, targetUri, targetUri, 'email', hasVideo);
        } else if (Platform.OS === 'android') {
            this.callKeep.startCall(callUUID, targetUri, targetUri);
        }

        this.callKeep.startCall(callUUID, targetUri, targetName);
    }

    updateDisplay(callUUID, displayName, uri) {
        console.log('Callkeep: update display', displayName, uri);
        this.callKeep.updateDisplay(callUUID, displayName, uri);
    }

    sendDTMF(callUUID, digits) {
        console.log('Callkeep: send DTMF: ', digits);
        this.callKeep.sendDTMF(callUUID, digits);
    }

    setCurrentCallActive(callUUID) {
        console.log('Callkeep: set call active', callUUID);
        this.callKeep.setCurrentCallActive(callUUID);
    }

    rejectCall(callUUID) {
        console.log('Callkeep: reject call', callUUID);
        this.callKeep.rejectCall(callUUID);
    }

    endCall(callUUID, reason) {
        console.log('Callkeep: end call', callUUID);
        if (reason) {
            this.callKeep.reportEndCallWithUUID(callUUID, reason);
        } else {
            this.callKeep.endCall(callUUID);
        }
        this._calls.delete(callUUID);
    }

    _rnActiveAudioSession(data) {
        console.log('Callkeep: activated audio call');
    }

    _rnDeactiveAudioSession(data) {
        console.log('Callkeep: deactivated audio call');
    }

    _rnAccept(data) {
        let callUUID = data.callUUID.toLowerCase();
        console.log('Callkeep: accept call callback', callUUID);
        if (this._conferences.has(callUUID)) {
            console.log('Accept conference invite', callUUID);
            let room = this._conferences.get(callUUID);
            console.log('Callkeep: hangup for incoming conference', callUUID);
            this.callKeep.endCall(callUUID);
            this._conferences.delete(callUUID);
            console.log('Will start conference to', room);
            this._sylkConferenceCall(room);
            // start an outgoing conference call
        } else if (this._calls.has(callUUID)) {
            // if we have audio only we must skip video from get local media
            this._sylkAnswerCall();
        } else {
            this._waitingCalls.set(callUUID, '_sylkAnswerCall');
        }
    }

    _rnEnd(data) {
        //get the uuid, find the call with that uuid and ccept it
        let callUUID = data.callUUID.toLowerCase();
        console.log('Callkeep: end call callback', callUUID);
        if (this._conferences.has(callUUID)) {
            console.log('Callkeep:    Reject conference invite', callUUID);
            let room = this._conferences.get(callUUID);
            console.log('Callkeep: hangup for incoming conference', callUUID);
            this.callKeep.endCall(callUUID);
            this._conferences.delete(callUUID);

        } else if (this._calls.has(callUUID)) {
            console.log('Callkeep:     hangup call', callUUID);
            let call = this._calls.get(callUUID);
            console.log('Callkeep:     call', callUUID, 'state is', call.state);
            if (call.state === 'incoming') {
                this._sylkRejectCall(callUUID);
            } else {
                this._sylkHangupCall(callUUID);
            }
        } else {
            console.log('Callkeep:    add to waitings list call', callUUID);
            this._waitingCalls.set(callUUID, '_sylkHangupCall');
        }
    }

    _rnMute(data) {
        console.log('Callkeep: mute ' + data.muted + ' for call', data.callUUID);
        //get the uuid, find the call with that uuid and mute/unmute it
        if (this._calls.has(data.callUUID.toLowerCase())) {
            let call = this._calls.get(data.callUUID.toLowerCase());
            const localStream = call.getLocalStreams()[0];
            localStream.getAudioTracks()[0].enabled = !data.muted;
        }
    }

    _rnDTMF(data) {
        console.log('Callkeep: got dtmf for call', data.callUUID);
        if (this._calls.has(data.callUUID.toLowerCase())) {
            let call = this._calls.get(data.callUUID.toLowerCase());
            console.log('sending webrtc dtmf', data.digits)
            call.sendDtmf(data.digits);
        }
    }

    _rnProviderReset() {
        console.log('Callkeep: got a provider reset, clearing down all calls');
        this._calls.forEach((call) => {
            call.terminate();
        })
    }

    handleCallLater(callUUID, notificationContent) {
        console.log('Callkeep: handle later incoming call', callUUID);

        let reason;
        if (this._waitingCalls.has(callUUID)) {
            reason = 1;
        } else {
            reason = 2;
        }

        this._timeouts.set(callUUID, setTimeout(() => {
            this.callKeep.reportEndCallWithUUID(callUUID, reason);
            this._timeouts.delete(callUUID);
        }, 60000));

    }

    handleConference(callUUID, room) {
        if (this._conferences.has(callUUID)) {
            return;
        }
        console.log('CallKeep: handle conference', callUUID, 'to room', room);
        this._conferences.set(callUUID, room);
        this._emitSessionsChange(true);
    }

    handleCall(call, callUUID) {
        // callUUID is present only for outgoing calls
        if (callUUID) {
            call._callkeepUUID = callUUID;

            this._calls.set(call._callkeepUUID, call);
            console.log('Callkeep: start outgoing call', call._callkeepUUID);
            this._calls.set(call._callkeepUUID, call);
        } else if (call.id) {
            call._callkeepUUID = call.id;

            this._calls.set(call._callkeepUUID, call);
            console.log('Callkeep: start incoming call', call._callkeepUUID);
            if (this._timeouts.has(call.id)) {
                clearTimeout(this._timeouts.get(call.id));
                this._timeouts.delete(call.id);
            }

            //if the call is in waiting then accept it (or decline it)
            if (this._waitingCalls.get(call._callkeepUUID)) {
                let action = this._waitingCalls.get(call._callkeepUUID);
                this[action]();
                this._waitingCalls.delete(call._callkeepUUID);
            }
        }

        // Emit event.
        this._emitSessionsChange(true);
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
