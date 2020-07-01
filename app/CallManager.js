import events from 'events';
import Logger from '../Logger';
import uuid from 'react-native-uuid';

const logger = new Logger('CallManager');


export default class CallManager extends events.EventEmitter {
    constructor(RNCallKeep, answerFunc, rejectFunc, hangupFunc) {
        logger.debug('constructor()');
        super();
        this.setMaxListeners(Infinity);

        // Set of current SIP sessions
        this._sessions = new Map();

        this._waitingCalls = new Map();
        this._timeouts = new Map();
        this._RNCallKeep = RNCallKeep;

        this._sylkAnswerCall = answerFunc;
        this._sylkRejectCall = rejectFunc;
        this._sylkHangupCall = hangupFunc;

        this._boundRnAnswer = this._rnAnswer.bind(this);
        this._boundRnEnd = this._rnEnd.bind(this);
        this._boundRnMute = this._rnMute.bind(this);
        this._boundRnActiveAudioSession = this._rnActiveAudioSession.bind(this);
        this._boundRnDeactiveAudioSession = this._rnDeactiveAudioSession.bind(this);
        this._boundRnDTMF = this._rnDTMF.bind(this);
        this._boundRnProviderReset = this._rnProviderReset.bind(this);

        this._RNCallKeep.addEventListener('answerCall', this._boundRnAnswer);
        this._RNCallKeep.addEventListener('endCall', this._boundRnEnd);
        this._RNCallKeep.addEventListener('didPerformSetMutedCallAction', this._boundRnMute);

        this._RNCallKeep.addEventListener('didActivateAudioSession', this._boundRnActiveAudioSession);
        this._RNCallKeep.addEventListener('didDeactivateAudioSession', this._boundRnDeactiveAudioSession.bind(this));
        this._RNCallKeep.addEventListener('didPerformDTMFAction', this._boundRnDTMF);
        this._RNCallKeep.addEventListener('didResetProvider', this._boundRnProviderReset);
    }

    get callKeep() {
        return this._RNCallKeep;
    }

    get count() {
        return this._sessions.size;
    }

    get waitingCount() {
        return this._timeouts.size;
    }

    get sessions() {
        return [...this._sessions.values()];
    }

    get activeSession() {
        for (let session of this.sessions) {
            if (session.active) {
                return session;
            }
        }
    }

    // there can only be one active one.... so just empty it for now
    remove() {
        //console.log('Callkeep: remove session');
        this._sessions.clear();
    }

    backToForeground() {
       console.log('Callkeep: bring app to the foreground');
       this.callKeep.backToForeground();
    }

    answerIncomingCall(callUUID) {
        console.log('Callkeep: answer incoming call', callUUID);
        this.callKeep.answerIncomingCall(callUUID);
    }

    setMutedCall(callUUID, mute) {
        console.log('Callkeep: set muted: ', mute);
        this.callKeep.setMutedCall(callUUID, mute);
    }

    startCall(callUUID, targetUri, targetName) {
        console.log('Callkeep: start call', callUUID);
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

    endCall(callUUID) {
        console.log('Callkeep: end call', callUUID);
        this.callKeep.endCall(callUUID);
    }

    reportEndCallWithUUID(callUUID, reason) {
        console.log('Callkeep: report end call', callUUID, 'with reason', reason);
        this.callKeep.reportEndCallWithUUID(callUUID, reason);
    }

    _rnActiveAudioSession() {
        console.log('Callkeep: activated audio session call');
    }

    _rnDeactiveAudioSession() {
        console.log('Callkeep: deactivated audio session call');
    }

    _rnAnswer(data) {
        console.log('Callkeep: answer call for UUID',  data.callUUID);
        //get the uuid, find the session with that uuid and answer it
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            this._sylkAnswerCall();
        } else {
            this._waitingCalls.set(data.callUUID.toLowerCase(), '_sylkAnswerCall');
        }
    }

    _rnEnd(data) {
        //get the uuid, find the session with that uuid and answer it
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            console.log('Callkeep: hangup for call UUID', data.callUUID);
            //let session = this._sessions.get(data.callUUID.toLowerCase());
            this._sylkHangupCall();
        } else {
            console.log('Callkeep: hangup later call UUID', data.callUUID);
            this._waitingCalls.set(data.callUUID.toLowerCase(), '_sylkHangupCall');
        }
    }

    _rnMute(data) {
        console.log('Callkeep: mute ' + data.muted + ' for call UUID', data.callUUID);
        //get the uuid, find the session with that uuid and mute/unmute it
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            const localStream = session.getLocalStreams()[0];
            localStream.getAudioTracks()[0].enabled = !data.muted;
        }
    }

    _rnDTMF(data) {
        console.log('Callkeep: got dtmf for call UUID', data.callUUID);
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            console.log('sending webrtc dtmf', data.digits)
            session.sendDtmf(data.digits);
        }
    }

    _rnProviderReset() {
        console.log('Callkeep: got a provider reset, clearing down all sessions');
        this._sessions.forEach((session) => {
            session.terminate();
        })
    }

    handleSessionLater(callUUID, notificationContent) {
        console.log('Callkeep: handle later incoming call UUID', callUUID);

        let reason;
        if (this._waitingCalls.has(callUUID)) {
            reason = 1;
        } else {
            reason = 2;
        }

        this._timeouts.set(callUUID, setTimeout(() => {
            this.reportEndCallWithUUID(callUUID, reason);
            this._timeouts.delete(callUUID);
        }, 10000));

    }

    handleSession(session, sessionUUID) {
        // sessionUUID is present only for outgoing calls
        console.log('handleSession start');

        if (sessionUUID) {
            session._callkeepUUID = sessionUUID;
            console.log('Callkeep: handle outgoing call UUID', session._callkeepUUID);
        } else if (session.id) {
            session._callkeepUUID = session.id;
            console.log('Callkeep: handle incoming call UUID', session._callkeepUUID);
        } else {
            console.log('Callkeep: no incoming or outgoing call detected');
        }

        if (this._timeouts.has(session._callkeepUUID)) {
            // push notification arrived first
            clearTimeout(this._timeouts.get(session._callkeepUUID));
            this._timeouts.delete(session._callkeepUUID);
        }

        session.on('close', () => {
            // Remove from the set.
            this._sessions.delete(session._callkeepUUID);

        });

        //if the call is in waiting then answer it (or decline it)
        if (this._waitingCalls.get(session._callkeepUUID)) {
            let action = this._waitingCalls.get(session._callkeepUUID);
            this[action]();
            this._waitingCalls.delete(session._callkeepUUID);
        }

        // Add to the set.
        this._sessions.set(session._callkeepUUID, session);

        // Emit event.
        this._emitSessionsChange(true);
    }

    _emitSessionsChange(countChanged) {
        this.emit('sessionschange', countChanged);
    }

    destroy() {
        this._RNCallKeep.removeEventListener('answerCall', this._boundRnAnswer);
        this._RNCallKeep.removeEventListener('endCall', this._boundRnEnd);
        this._RNCallKeep.removeEventListener('didPerformSetMutedCallAction', this._boundRnMute);
        this._RNCallKeep.removeEventListener('didActivateAudioSession',  this._boundRnActiveAudioSession);
        this._RNCallKeep.removeEventListener('didDeactivateAudioSession', this._boundRnDeactiveAudioSession);
        this._RNCallKeep.removeEventListener('didPerformDTMFAction', this._boundRnDTMF);
        this._RNCallKeep.removeEventListener('didResetProvider', this._boundRnProviderReset);
    }
}
