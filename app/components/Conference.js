import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import ConferenceBox from './ConferenceBox';
import LocalMedia from './LocalMedia';
import utils from '../utils';
import { applyVideoEncoderParamsToPc } from './CallZrtp';

const DEBUG = debug('blinkrtc:Conference');
//debug.enable('*');


class Conference extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.defaultWaitInterval = 90; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        this.userHangup = false;
        this.ended = false;
        this.started = false;
        this.participants = [];
        
        let room = this.props.targetUri ? this.props.targetUri.toLowerCase() : '';
        console.log('Loaded Conference for room', room);

        this.state = {
              currentCall: this.props.currentCall,
              callState: this.props.currentCall ? this.props.currentCall.state : null,
              callUUID: this.props.callUUID,
              localMedia: this.props.localMedia,
              connection: this.props.connection,
              account: this.props.account,
              registrationState: this.props.registrationState,
              startedByPush: this.props.startedByPush,
              reconnectingCall: this.props.reconnectingCall,
              myInvitedParties: this.props.myInvitedParties,
              isFavorite: this.props.favoriteUris.indexOf(this.props.targetUri) > -1,
              selectedContacts: this.props.selectedContacts,
              room: room,
              messages: this.props.messages,
			  availableAudioDevices : this.props.availableAudioDevices,
			  selectedAudioDevice: this.props.selectedAudioDevice,
			  iceServers: this.props.iceServers,
			  isLandscape: this.props.isLandscape,
			  insets: this.props.insets,
			  publicUrl: this.props.publicUrl,
			  // Delayed fallback flag — set by a setTimeout in
			  // componentDidMount so the "Starting conference… Cancel"
			  // panel only appears if media takes more than 1.5s.
			  showFallback: false,
			  // Outgoing-video preview gate. When the user starts
			  // a conference by tapping the VIDEO button, we
			  // surface LocalMedia first (camera preview + 9-second
			  // auto-start countdown — same flow AudioCallBox uses
			  // for an outgoing 1:1 video call) instead of joining
			  // immediately. `userStartedCall` flips true when the
			  // user taps the green Start button on the preview OR
			  // the countdown elapses. Until then mediaPlaying's
			  // startCallWhenReady is suppressed so the conference
			  // doesn't auto-join behind the preview. For audio
			  // conferences (proposedMedia.video === false) the
			  // flag is irrelevant — there's no preview to gate
			  // through, mediaPlaying still calls
			  // startCallWhenReady immediately.
			  // Initialise true when the parent passed
			  // skipCountdown — e.g. an "Escalate to conference"
			  // handshake just landed us on /conference. The user
			  // already confirmed intent twice in that flow (the
			  // originator picked it from the avatar panel; the
			  // accepter tapped Accept on the modal) so the
			  // camera-preview Start-call gate would be needless
			  // friction. mediaPlaying's userStartedCall check
			  // then short-circuits straight to
			  // startCallWhenReady.
			  userStartedCall: !!props.skipCountdown,
        }
              
        if (this.props.connection) {
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        if (this.props.participantsToInvite) {
            this.props.participantsToInvite.forEach((p) => {
                if (this.participants.indexOf(p) === -1) {
                    this.participants.push(p);
                }
            });
        }
    }

	componentDidUpdate(prevProps, prevState) {
		 if (prevState.isLandscape !== this.state.isLandscape) {
		     console.log('---- Conference isLandscape', this.state.isLandscape);
			 //this.setState({searchContacts: this.state.orientation == 'portrait'});
		 }
	}


    componentDidMount() {
        if (this.state.currentCall) {
            this.state.currentCall.on('stateChanged', this.callStateChanged);
        }
        // Delay the "Starting conference… Cancel" fallback so it doesn't
        // flash for a moment when getUserMedia resolves quickly.
        this._fallbackTimer = setTimeout(() => {
            this.setState({ showFallback: true });
        }, 1500);
    }

    componentWillUnmount() {
        this.ended = true;

        if (this._fallbackTimer) {
            clearTimeout(this._fallbackTimer);
            this._fallbackTimer = null;
        }

        if (this.state.currentCall) {
            this.state.currentCall.removeListener('stateChanged', this.callStateChanged);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }
    }

    callStateChanged(oldState, newState, data) {
        //utils.timestampedLog('Conference: callStateChanged', oldState, '->', newState);
        if (newState === 'established') {
            this.setState({reconnectingCall: false});
        }
		this.props.stopRingback();
        this.setState({callState: newState});
    }

    connectionStateChanged(oldState, newState) {
        switch (newState) {
            case 'disconnected':
                if (oldState === 'ready') {
                    utils.timestampedLog('Conference: connection failed, reconnecting the [call]...');
                    this.waitInterval = this.defaultWaitInterval;
                }
                break;
            default:
                break;
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({account: nextProps.account});
        }

        if (nextProps.currentCall) {
            this.setState({room: nextProps.currentCall.remoteIdentity.uri.toLowerCase()});
        } else if (nextProps.targetUri) {
            this.setState({room: nextProps.targetUri.toLowerCase()});
        }

        this.setState({registrationState: nextProps.registrationState});

        if (nextProps.connection !== null && nextProps.connection !== this.state.connection) {
            this.setState({connection: nextProps.connection});
            nextProps.connection.on('stateChanged', this.connectionStateChanged);
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.localMedia !== null && nextProps.localMedia !== this.state.localMedia) {
            this.setState({localMedia: nextProps.localMedia});
        }

        if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
            // Pre-existing branch: when callUUID prop changes, treat
            // it as a reconnect and re-run startCallWhenReady. That's
            // appropriate when there is no active call object — e.g.
            // a reconnect after a transient failure — but it is NOT
            // appropriate when the call is already healthy. In the
            // outgoing-conference path, app.js sets state.outgoingCall-
            // UUID to the sylkrtc-assigned call.id once the conference
            // join completes; that prop change re-enters this branch
            // and the unguarded reset clears state.currentCall, which
            // (a) unmounts ConferenceBox, (b) fires a fresh
            // startCallWhenReady whose canConnect() now misses
            // currentCall and may also see stale localMedia, and
            // (c) at waitInterval-1 seconds calls hangupCall(timeout)
            // — cutting the live conference. Skip the reset when we
            // already have a currentCall whose id matches the new
            // callUUID (i.e. this prop change is just app.js
            // catching up to the call we already started).
            const _activeMatches = this.state.currentCall
                && this.state.currentCall.id === nextProps.callUUID;
            if (_activeMatches) {
                this.setState({callUUID: nextProps.callUUID});
            } else {
                this.setState({callUUID: nextProps.callUUID,
                               reconnectingCall: true,
                               currentCall: null});

                this.startCallWhenReady();
            }
        }
		
        this.setState({myInvitedParties: nextProps.myInvitedParties,
                       isFavorite: nextProps.favoriteUris.indexOf(this.state.room) > -1,
                       selectedContacts: nextProps.selectedContacts,
                       messages: nextProps.messages,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets,
					   isLandscape: nextProps.isLandscape,
					   publicUrl: nextProps.publicUrl
                       });
    }

    mediaPlaying() {
        // For outgoing VIDEO conferences, hold off on joining
        // until the user confirms from the LocalMedia preview
        // (Start button or the 9-second auto-start countdown).
        // The render branch below mounts LocalMedia with
        // awaitingUserCallStart={true} and the
        // confirmStartCall handler defined below, exactly the
        // shape AudioCallBox uses for 1:1 outgoing video.
        // For AUDIO conferences we skip the preview entirely and
        // proceed straight to startCallWhenReady — there is no
        // camera to show off, and an audio-only preview screen
        // would be a confusing extra step.
        const isVideo = !!(this.props.proposedMedia && this.props.proposedMedia.video === true);
        const isReconnect = !!this.state.reconnectingCall;
        if (isVideo && !isReconnect && !this.state.userStartedCall) {
            // Wait for confirmStartCall (user tap OR
            // LocalMedia's auto-start countdown firing).
            return;
        }
        this.startCallWhenReady();
    }

    /** Confirmed-start handler routed in from LocalMedia (either
     *  the green Start button or the 9-second auto-start
     *  countdown). Flips userStartedCall so subsequent
     *  mediaPlaying calls / componentDidUpdate paths fall through
     *  to startCallWhenReady, and kicks it off immediately if
     *  we're already past the gate. */
    confirmStartCall = () => {
        if (this.state.userStartedCall) return;
        this.setState({userStartedCall: true}, () => {
            this.startCallWhenReady();
        });
    };

    canConnect() {
        if (!this.state.localMedia) {
            console.log('Conference: no local media');
            return false;
        }

		if (!this.state.room) {
            console.log('Room not set yet');
			return false;
		}

        if (!this.state.connection) {
            console.log('Conference: no connection yet');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            console.log('Conference: connection is not ready');
            return false;
        }

        if (!this.state.account) {
            console.log('Conference: no account yet');
            return false;
        }

        if (this.state.registrationState !== 'registered') {
            console.log('Conference: account not ready yet');
            return false;
        }

        if (this.state.currentCall) {
            console.log('Conference: call already in progress');
            return false;
        }

        return true;
    }

    async startCallWhenReady() {
        utils.timestampedLog('Conference: start conference [call] when ready to', this.state.room);
        this.waitCounter = 0;

        //utils.timestampedLog('Conference: waiting for connecting to the conference', this.waitInterval, 'seconds');

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            // Bail if THIS Conference instance has been unmounted —
            // without it, when React unmounts/remounts Conference (e.g.
            // app.js's setState({outgoingCallUUID: ...}) triggering a
            // prop change that componentWillReceiveProps interprets as
            // "new call UUID, reset", or the conference component
            // simply going out of the rendered tree and coming back)
            // the OLD instance's async loop keeps running. Its
            // this.state.localMedia and this.state.currentCall are
            // frozen at the unmount-time values (typically null, since
            // app.js's getLocalMedia setState may not have propagated
            // before the remount). canConnect() returns false forever,
            // and worse, when waitCounter eventually hits
            // waitInterval-1 the loop fires hangupCall(timeout) on
            // this.state.callUUID — which can be the UUID of the NEW
            // instance's healthy, established conference call. Result:
            // the conference is silently cut after ~90 seconds even
            // though the user is mid-meeting. componentWillUnmount
            // already sets this.ended = true; we just need to read it
            // here.
            if (this.ended) {
                console.log('Conference: startCallWhenReady bailing (component unmounted)');
                return;
            }

            if (this.userHangup) {
                this.props.hangupCall(this.state.callUUID, 'user_cancelled_conference');
                return;
            }

            if (this.state.currentCall) {
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                utils.timestampedLog('Conference: cancelling conference [call]', this.state.callUUID);
                this.props.hangupCall(this.state.callUUID, 'timeout');
            }

            if (!this.canConnect()) {
                console.log('Retrying for', (this.waitInterval - this.waitCounter), 'seconds');
                await this._sleep(1000);
            } else {
                this.waitCounter = 0;
                this.start();
                return;
            }

            this.waitCounter++;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        if (this.state.currentCall) {
            console.log('Conference: call already in progress');
        }
        
        //console.log('Conference START');

        // Wire-level negotiation always advertises video — this
        // is the change that lets a user who pressed the "Audio"
        // button later flip on their camera in the same call
        // without renegotiating. proposedMedia.video here is the
        // BUTTON CHOICE (audio vs video), preserved for downstream
        // UI-mode signalling via the audioOnly prop on ConferenceBox
        // a few lines below. The local stream's video track will
        // start with track.enabled = false when the user pressed
        // Audio (ConferenceBox constructor reads the same
        // audioOnly prop to seed videoMuted), so an "Audio" start
        // doesn't actually push frames out — it just keeps the
        // m=video transceiver in place so unmuting later is a
        // one-line track.enabled flip.
        //
        // localStream has both audio and video tracks because
        // callKeepStartConference now always asks for camera +
        // mic permission and forwards video: true into
        // getLocalMedia.
        const options = {
            id: this.state.callUUID,
            pcConfig: {iceServers: this.state.iceServers},
            localStream: this.state.localMedia,
            audio: this.props.proposedMedia.audio,
            video: true,
            offerOptions: {
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            },
            initialParticipants: this.props.participantsToInvite
        };

        utils.timestampedLog('Conference: Sylkrtc.js will start conference [call]', this.state.callUUID, 'to', this.state.room.toLowerCase());

        if (this.props.participantsToInvite) {
            utils.timestampedLog('[call] Initial participants', this.props.participantsToInvite);
        }

		let confCall = this.state.account.joinConference(this.state.room.toLowerCase(), options);

		if (confCall) {
			this.setState({currentCall: confCall});
			confCall.on('stateChanged', this.callStateChanged);

			// Apply the configured video encoder caps (maxBitrate /
			// maxFramerate / scaleResolutionDownBy) to the conference
			// publisher PC's video sender once the session is up.
			// Without this, the conference path never gets the same
			// RTCRtpSender.setParameters({encodings:[{maxBitrate}]})
			// treatment that 1-to-1 Calls receive via the ZRTP
			// handshake's _applyVideoBitrate. The result was the
			// encoder running at libwebrtc's default (~1.5–2 Mbps for
			// 480p) instead of the configured cap (800 kbps for the
			// '480p' profile). Hooked on stateChanged so we wait for
			// the PC to actually have senders.
			confCall.on('stateChanged', (oldState, newState) => {
				if (newState === 'accepted' || newState === 'established') {
					// Defer one tick so any sender setup that runs
					// inside sylkrtc's own 'accepted' handler
					// finishes first.
					setTimeout(() => {
						applyVideoEncoderParamsToPc(confCall._pc, 'conference-join');
					}, 0);
				}
			});

			// Early cache for the SIP conference-info snapshot. sylkrtc
			// emits `sipConferenceParticipants` the moment the SIP-side
			// videoroom focus replies with a `conference-participants`
			// NOTIFY — and that reply lands during the join handshake,
			// BEFORE ConferenceBox mounts and attaches its own listener
			// in componentDidMount. Without this early cache the first
			// snapshot is dropped on the floor: ConferenceBox sees no
			// SIP participants until a later delta arrives (someone
			// joining mid-call), even though the navbar count — which
			// is derived from confCall.participants — already shows
			// them. We attach a tiny listener here that mirrors every
			// snapshot onto confCall._sipParticipants. ConferenceBox's
			// initial state seeds from that same field, so by the time
			// it mounts the snapshot is already waiting.
			//
			// The listener stays attached for the life of the call so
			// the cache also stays fresh across ConferenceBox
			// remounts (e.g. navigating to the contacts tab and back).
			confCall._sipParticipants = confCall._sipParticipants || [];
			confCall.on('sipConferenceParticipants', (participants, duration) => {
				const _list = Array.isArray(participants) ? participants : [];
				confCall._sipParticipants = _list;
				if (typeof duration === 'number') {
					confCall._sipConferenceDuration = duration;
					// First-touch capture of the conference-duration
					// anchor (seconds since the videoroom was created
					// on the webrtcgateway). ConferenceBox's
					// constructor seeds state.conferenceDurationAtJoin
					// from this exact field, so populating it here —
					// at conference-create time, BEFORE ConferenceBox
					// mounts — guarantees the navbar's elapsed-time
					// meter starts at the right offset even when the
					// first NOTIFY lands during the join handshake.
					//
					// Treat 0 as "no anchor yet" — the
					// conferenceDuration event fires on session-accept
					// with duration=0 when the gateway hasn't yet
					// computed the room age. If we locked that in,
					// later sipConferenceParticipants events carrying
					// the REAL duration would be ignored
					// (ConferenceHeader.serverDurationApplied flips
					// once and stays). So we hold off until a
					// non-zero value arrives.
					if (duration > 0
						&& (typeof confCall._conferenceDurationAtJoin !== 'number'
							|| confCall._conferenceDurationAtJoin === 0)) {
						confCall._conferenceDurationAtJoin = duration;
						console.log('[Conference] initial conference duration from server (via sipConferenceParticipants) =',
									duration, 'seconds');
					}
				}
			});

			// The webrtcgateway also stamps a `conferenceDuration` event
			// on session-accept for the case where the SIP-side
			// NOTIFY hasn't fired yet (e.g. a brand-new room with
			// only this user). Mirror onto the same call-object
			// field so the seed path is identical. Same "skip 0,
			// wait for non-zero" rule applies — see the
			// sipConferenceParticipants block above for why.
			confCall.on('conferenceDuration', (duration) => {
				if (typeof duration === 'number' && duration > 0
					&& (typeof confCall._conferenceDurationAtJoin !== 'number'
						|| confCall._conferenceDurationAtJoin === 0)) {
					confCall._conferenceDurationAtJoin = duration;
					console.log('[Conference] initial conference duration from server (via conferenceDuration) =',
								duration, 'seconds');
				} else if (typeof duration === 'number' && duration === 0) {
					console.log('[Conference] conferenceDuration event with 0 — ignored, waiting for non-zero anchor');
				}
			});
		}

    }

    saveParticipant(callUUID, room, uri) {
        console.log('Save saveParticipant', uri);
        if (this.participants.indexOf(uri) === -1) {
            this.participants.push(uri);
        }
        this.props.saveParticipant(callUUID, room, uri);
    }

    showSaveDialog() {
        // Remnant of an old "Save conference?" feature that popped up a
        // confirmation dialog after hangup. The feature is disabled — the
        // dialog no longer appears at the end of a conference. Kept here
        // (returning false) in case we ever want to resurrect it.
        return false;

        /*
        if (!this.userHangup) {
            return false;
        }

        if (this.state.reconnectingCall) {
            console.log('No save dialog because call is reconnecting')
            return false;
        }

        if (this.participants.length === 0) {
            //console.log('No show dialog because there are no participants')
            return false;
        }

        if (this.state.isFavorite) {
            let must_display = false;
            if (this.props.myInvitedParties.hasOwnProperty(this.state.room)) {
                let old_participants = this.state.myInvitedParties[this.state.room];
                this.participants.forEach((p) => {
                    if (old_participants.indexOf(p) === -1) {
                        console.log(p, 'is not in', old_participants);
                        must_display = true;
                    }
                });
            }

            if (must_display) {
                console.log('Show save dialog because we have new participants');
                return true;
            } else {
                console.log('No save dialog because is already favorite with same participants')
                return false;
            }
        } else {
            console.log('Show save dialog because room', this.state.room, 'is not in favorites');
            return true;
        }
        return true;
        */
    }

    saveConference() {
        if (!this.state.isFavorite) {
            this.props.toggleFavorite(this.state.room);
        }

        // `myInvitedParties` is keyed by the room's LOCAL part — see
        // app.js ~2891. `this.state.room` here is the lowercased FULL
        // targetUri ("name@videoconference.domain"), so previously
        // this hasOwnProperty check ALWAYS failed and the in-session
        // participant list silently overwrote the saved invitees.
        //
        // Look up by local part, but keep passing the FULL URI to
        // the save callback (appendInvitedParties → saveConference)
        // because saveConference resolves the contact row through
        // lookupContact and that index is keyed by the FQDN URI.
        const _roomKey = (this.state.room || '').split('@')[0];
        if (this.props.myInvitedParties.hasOwnProperty(_roomKey)) {
            let participants = this.state.myInvitedParties[_roomKey].slice();
            this.participants.forEach((p) => {
                if (participants.indexOf(p) === -1) {
                    participants.push(p);
                }
            });

            this.props.saveConference(this.state.room, participants);
        } else {
            this.props.saveConference(this.state.room, this.participants);
        }

        this.props.hangupCall(this.state.callUUID, 'user_hangup_conference_confirmed');
    }

    hangup(reason='user_hangup_conference') {
        this.userHangup = true;

        if (!this.showSaveDialog()) {
            reason = 'user_hangup_conference_confirmed';
        }

        this.props.hangupCall(this.state.callUUID, reason);

        if (this.waitCounter > 0) {
            this.waitCounter = this.waitInterval;
        }
    }

    render() {
        let box = null;
        let messages = [];

        if (this.state.localMedia !== null) {
            let media = 'audio'
            if (this.props.proposedMedia && this.props.proposedMedia.video === true) {
                media = 'video';
            }
            if (this.state.currentCall != null && (this.state.callState === 'established')) {
                box = (
                    <ConferenceBox
                        notificationCenter = {this.props.notificationCenter}
                        call = {this.state.currentCall}
                        audioOnly = {this.props.proposedMedia ? !this.props.proposedMedia.video: false}
                        reconnectingCall={this.state.reconnectingCall}
                        connection = {this.state.connection}
                        messages = {this.state.messages}
                        account = {this.props.account}
                        hangup = {this.hangup}
                        saveParticipant = {this.saveParticipant}
                        updateContactOnConferenceInvite = {this.props.updateContactOnConferenceInvite}
                        saveConferenceMessage = {this.props.saveConferenceMessage}
                        updateConferenceMessage = {this.props.updateConferenceMessage}
                        deleteConferenceMessage = {this.props.deleteConferenceMessage}
                        saveConference = {this.props.saveConference}
                        previousParticipants = {this.props.previousParticipants}
                        remoteUri = {this.state.room}
                        shareScreen = {this.props.shareScreen}
                        generatedVideoTrack = {this.props.generatedVideoTrack}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleMute = {this.props.toggleMute}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        isLandscape = {this.state.isLandscape}
                        isTablet = {this.props.isTablet}
                        /* Folded (cover-display) flag — ConferenceBox
                           uses this to hide the AudioSpeedometer and
                           the account-plus invite button in the audio
                           conference layout. See ConferenceBox render
                           gates for both. */
                        isFolded = {this.props.isFolded}
                        muted = {this.props.muted}
                        defaultDomain = {this.props.defaultDomain}
                        inFocus = {this.props.inFocus}
                        reconnectingCall={this.state.reconnectingCall}
                        initialParticipants={this.props.participantsToInvite}
                        terminated={this.userHangup}
                        allContacts = {this.props.allContacts}
                        lookupContact = {this.props.lookupContact}
                        goBackFunc={this.props.goBackFunc}
                        inviteToConferenceFunc={this.props.inviteToConferenceFunc}
                        selectedContacts={this.props.selectedContacts}
                        callState={this.props.callState}
                        finishInvite={this.props.finishInvite}
                        callContact={this.props.callContact}
                        getMessages={this.props.getMessages}
                        fileSharingUrl = {this.props.fileSharingUrl}
                        sendConferenceMessage = {this.props.sendConferenceMessage}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						useInCallManger = {this.props.useInCallManger}
						insets = {this.state.insets}
						publicUrl = {this.state.publicUrl}
						enableFullScreen = {this.props.enableFullScreen}
						disableFullScreen = {this.props.disableFullScreen}
						sylkDomain = {this.props.sylkDomain}
						conferenceSettings = {this.props.conferenceSettings}
						pstnRules = {this.props.pstnRules}
                   />
                );
            } else {
                box = (
                    <LocalMedia
                        call = {this.state.currentCall}
                        remoteUri = {this.state.room}
                        remoteDisplayName = {this.state.room}
                        localMedia = {this.state.localMedia}
                        mediaPlaying = {this.mediaPlaying}
                        hangupCall = {this.hangup}
                        showSaveDialog={this.showSaveDialog}
                        saveConference={this.saveConference}
                        connection={this.state.connection}
                        participants={this.participants}
                        terminated={this.userHangup}
                        reconnectingCall={this.state.reconnectingCall}
                        goBackFunc={this.props.goBackFunc}
						isLandscape = {this.state.isLandscape}
                        media={media}
						availableAudioDevices = {this.state.availableAudioDevices}
						selectedAudioDevice = {this.state.selectedAudioDevice}
						selectAudioDevice = {this.props.selectAudioDevice}
						useInCallManger = {this.props.useInCallManger}
						insets = {this.state.insets}
						// Outgoing-video preview gating — see the
						// userStartedCall comment in the state
						// initialiser and the matching props block
						// in Call.js (line ~1099) for 1:1 calls.
						// For an outgoing VIDEO conference the user
						// sees the camera preview + 9-second
						// auto-start countdown; the conference does
						// NOT join until confirmStartCall fires.
						// Reconnect path skips the preview because
						// the user already confirmed the original
						// call once. Audio conferences pass
						// `false` so LocalMedia behaves as it did
						// before this change (no preview gating,
						// no countdown).
						awaitingUserCallStart={media === 'video' && !this.state.userStartedCall && !this.state.reconnectingCall}
						confirmStartCall={this.confirmStartCall}
                    />
                );
            }

        } else if (this.state.showFallback) {
            // localMedia is still null AND we've been waiting for over
            // 1.5s. Render a minimal "Acquiring media…" view with a
            // Cancel button so the user can always escape if it hangs.
            // Suppressed during the first 1.5s so this UI doesn't flash
            // when getUserMedia resolves quickly (the common path).
            const cancel = () => {
                if (typeof this.props.goBackFunc === 'function') {
                    this.props.goBackFunc();
                } else if (typeof this.props.hangupCall === 'function') {
                    this.props.hangupCall(this.props.callUUID, 'cancel_media');
                }
            };
            box = (
                <View style={{ flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#eee', fontSize: 18, marginBottom: 24 }}>
                        Starting conference…
                    </Text>
                    <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 32, textAlign: 'center', paddingHorizontal: 32 }}>
                        Acquiring camera and microphone. If this takes more than a few seconds, the camera may be in use by another app.
                    </Text>
                    <TouchableOpacity
                        onPress={cancel}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#c0392b',
                            paddingHorizontal: 22,
                            paddingVertical: 12,
                            borderRadius: 24,
                        }}
                    >
                        <Icon name="phone-hangup" size={20} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                            Cancel
                        </Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return box;
    }
}

Conference.propTypes = {
    notificationCenter      : PropTypes.func,
    account                 : PropTypes.object,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    hangupCall              : PropTypes.func,
    saveParticipant         : PropTypes.func,
    updateContactOnConferenceInvite : PropTypes.func,
    updateConferenceMessage : PropTypes.func,
    deleteConferenceMessage : PropTypes.func,
    saveConferenceMessage   : PropTypes.func,
    saveConference          : PropTypes.func,
    previousParticipants    : PropTypes.array,
    currentCall             : PropTypes.object,
    localMedia              : PropTypes.object,
    targetUri               : PropTypes.string,
    participantsToInvite    : PropTypes.array,
    generatedVideoTrack     : PropTypes.bool,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    callUUID                : PropTypes.string,
    proposedMedia           : PropTypes.object,
    isLandscape             : PropTypes.bool,
    isTablet                : PropTypes.bool,
    isFolded                : PropTypes.bool,
    muted                   : PropTypes.bool,
    defaultDomain           : PropTypes.string,
    pstnRules               : PropTypes.object,
    startedByPush           : PropTypes.bool,
    inFocus                 : PropTypes.bool,
    toggleFavorite          : PropTypes.func,
    saveConference          : PropTypes.func,
    reconnectingCall        : PropTypes.bool,
    favoriteUris            : PropTypes.array,
    allContacts             : PropTypes.array,
    lookupContact           : PropTypes.func,
    goBackFunc              : PropTypes.func,
    inviteToConferenceFunc  : PropTypes.func,
    selectedContacts        : PropTypes.array,
    callContact             : PropTypes.object,
    callState               : PropTypes.object,
    finishInvite            : PropTypes.func,
    messages                : PropTypes.object,
    getMessages             : PropTypes.func,
    fileSharingUrl          : PropTypes.string,
    sendConferenceMessage   : PropTypes.func,
    useInCallManger         : PropTypes.bool,
    availableAudioDevices   : PropTypes.array,
    selectedAudioDevice     : PropTypes.string,
    selectAudioDevice       : PropTypes.func,
    startRingback           : PropTypes.func,
    stopRingback            : PropTypes.func,
    iceServers              : PropTypes.array,
    insets                  : PropTypes.object,
    publicUrl               : PropTypes.string,
	enableFullScreen        : PropTypes.func,
	disableFullScreen       : PropTypes.func,
	sylkDomain              : PropTypes.string,
	// True when this conference was started via the
	// conference-request handshake (user-initiated escalation from a
	// 1-1 call). Bypasses the outgoing-video camera-preview Start-call
	// gate so the user doesn't have to tap a third confirmation —
	// see userStartedCall initialiser in the constructor.
	skipCountdown           : PropTypes.bool
};


export default Conference;
