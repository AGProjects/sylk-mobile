import events from 'events';
import Logger from '../Logger';
import uuid from 'react-native-uuid';

const logger = new Logger('CallManager');


export default class CallManager extends events.EventEmitter {
    constructor(RNCallKeep, answerFunc, rejectFunc, hangupFunc) {
        logger.debug('constructor()');

        super();
        this.setMaxListeners(Infinity);

        // Set of current SIP sessions.
        this._sessions = new Map();
        this._callIDMap = new Map();
        this._waitingCalls = new Map();
        this._timeouts = new Map();
        this._RNCallKeep = RNCallKeep;

        this._sylkAnswer = answerFunc;
        this._sylkReject = rejectFunc;
        this._sylkHangupFunc = hangupFunc;

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
        this._sessions.clear();
    }

    waitForInviteTimeout(callUUID, notificationContent) {
        let reason;
        if (this._waitingCalls.has(callUUID)) {
            reason = 1;
        } else {
            reason = 2;
        }

        this._callIDMap.set(notificationContent['call-id'], callUUID);

        this._timeouts.set(callUUID, setTimeout(() => {
            this._RNCallKeep.reportEndCallWithUUID(callUUID, reason);
            this._timeouts.delete(callUUID);
        }, 10000));
    }

    _rnActiveAudioSession() {
        logger.debug('CallKeep activated audio session call');
    }

    _rnDeactiveAudioSession() {
        logger.debug('CallKeep deactivated audio session call');
    }

    _rnAnswer(data) {
        logger.debug('answering call event from callkeep', data)
        //get the uuid, find the session with that uuid and answer it
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            logger.debug('answering call', session, data.callUUID)
            this._sylkAnswer();
        } else {
            this._waitingCalls.set(data.callUUID.toLowerCase(), '_sylkAnswer');
        }
    }

    _rnEnd(data) {
        logger.debug('hanging up call event from callkeep', data)
        //get the uuid, find the session with that uuid and answer it
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            logger.debug('terminating call', data.callUUID)
            this._sylkHangupFunc();
        } else {
            this._waitingCalls.set(data.callUUID.toLowerCase(), '_sylkHangupFunc');
        }
    }

    _rnMute(data) {
        //get the uuid, find the session with that uuid and mute/unmute it
        logger.debug('mute event from callkeep', data)
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            const localStream = session.getLocalStreams()[0];
            localStream.getAudioTracks()[0].enabled = !data.muted;
        }
    }

    _rnDTMF(data) {
        logger.debug(data, 'got dtmf event')
        if (this._sessions.has(data.callUUID.toLowerCase())) {
            let session = this._sessions.get(data.callUUID.toLowerCase());
            logger.debug('sending webrtc dtmf', data.digits)
            session.sendDtmf(data.digits);
        }
    }

    _rnProviderReset() {
        logger.debug('got a provider reset, clearing down all sessions');
        this._sessions.forEach((session) => {
            session.terminate();
        })
    }

    handleSession(session, sessionUUID) {

        logger.debug('Handling session, id is ', session.id);
        logger.debug('Handling Session, call map is', this._callIDMap);

        let incomingCallUUID = this._callIDMap.has(session.id) && this._callIDMap.get(session.id)

        session._callkeepUUID = sessionUUID || incomingCallUUID || uuid.v4();

        logger.debug('Handling Session', session._callkeepUUID);

        if (this._timeouts.has(session._callkeepUUID)) {
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

        this._callIDMap.delete(session._callkeepUUID);

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
