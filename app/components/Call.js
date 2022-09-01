import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import assert from 'assert';
import debug from 'react-native-debug';
import autoBind from 'auto-bind';
import uuid from 'react-native-uuid';

import AudioCallBox from './AudioCallBox';
import LocalMedia from './LocalMedia';
import VideoBox from './VideoBox';
import config from '../config';
import utils from '../utils';

import {
  ConnectionStateChangedEvent,
  ConnectionEventTypes,
  ProofAttributeInfo,
  ProofEventTypes,
  AttributeFilter
} from '@aries-framework/core';

// Used for SSI credentials
const credDefId = 'EwAf16U6ZphXsZq6E5qmPz:3:CL:394132:default';

function randomIntFromInterval(min,max)
{
    return Math.floor(Math.random()*(max-min+1)+min);
}

function FixedQueue( size, initialValues ){

    // If there are no initial arguments, default it to
    // an empty value so we can call the constructor in
    // a uniform way.
    initialValues = (initialValues || []);

    // Create the fixed queue array value.
    var queue = Array.apply( null, initialValues );

    // Store the fixed size in the queue.
    queue.fixedSize = size;

    // Add the class methods to the queue. Some of these have
    // to override the native Array methods in order to make
    // sure the queue lenght is maintained.
    queue.push = FixedQueue.push;
    queue.splice = FixedQueue.splice;
    queue.unshift = FixedQueue.unshift;

    // Trim any initial excess from the queue.
    FixedQueue.trimTail.call( queue );

    // Return the new queue.
    return( queue );

}


// I trim the queue down to the appropriate size, removing
// items from the beginning of the internal array.
FixedQueue.trimHead = function(){

    // Check to see if any trimming needs to be performed.
    if (this.length <= this.fixedSize){

        // No trimming, return out.
        return;

    }

    // Trim whatever is beyond the fixed size.
    Array.prototype.splice.call(
        this,
        0,
        (this.length - this.fixedSize)
    );

};


// I trim the queue down to the appropriate size, removing
// items from the end of the internal array.
FixedQueue.trimTail = function(){

    // Check to see if any trimming needs to be performed.
    if (this.length <= this.fixedSize){

        // No trimming, return out.
        return;

    }

    // Trim whatever is beyond the fixed size.
    Array.prototype.splice.call(
        this,
        this.fixedSize,
        (this.length - this.fixedSize)
    );

};

// I synthesize wrapper methods that call the native Array
// methods followed by a trimming method.
FixedQueue.wrapMethod = function( methodName, trimMethod ){

    // Create a wrapper that calls the given method.
    var wrapper = function(){

        // Get the native Array method.
        var method = Array.prototype[ methodName ];

        // Call the native method first.
        var result = method.apply( this, arguments );

        // Trim the queue now that it's been augmented.
        trimMethod.call( this );

        // Return the original value.
        return( result );

    };

    // Return the wrapper method.
    return( wrapper );

};


// Wrap the native methods.
FixedQueue.push = FixedQueue.wrapMethod(
    "push",
    FixedQueue.trimHead
);

FixedQueue.splice = FixedQueue.wrapMethod(
    "splice",
    FixedQueue.trimTail
);

FixedQueue.unshift = FixedQueue.wrapMethod(
    "unshift",
    FixedQueue.trimTail
);


class Call extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.samples = 30;
        this.sampleInterval = 3;

        this.defaultWaitInterval = 90; // until we can connect or reconnect
        this.waitCounter = 0;
        this.waitInterval = this.defaultWaitInterval;

        this.videoBytesSent = 0;
        this.audioBytesSent = 0;

        this.videoBytesReceived = 0;
        this.audioBytesReceived = 0;

        this.packetLoss = 0;
        this.audioCodec = '';
        this.videoCodec = '';

        this.packetLossQueue = FixedQueue(this.samples);
        this.latencyQueue = FixedQueue(this.samples);
        this.audioBandwidthQueue = FixedQueue(this.samples);
        this.videoBandwidthQueue = FixedQueue(this.samples);

        this.mediaLost = false;
        this.ssiRoles = []; // can be holder, verifier and issuer
        this.ssiRemoteRoles = []; // can be holder, verifier or issuer
        let ssiRequired = false;
        this.cancelVerifyIdentityTimer = null;

        if (this.props.ssiRoles) {
            this.ssiRoles = this.props.ssiRoles;
        }

        let callUUID;
        let remoteUri = '';
        let remoteDisplayName = '';
        let callState = null;
        let direction = null;
        let callEnded = false;
        this.mediaIsPlaying = false;
        this.ended = false;
        this.answering = false;

        if (this.props.call) {
            // If current call is available on mount we must have incoming
            this.props.call.on('stateChanged', this.callStateChanged);
            this.props.call.on('incomingMessage', this.incomingMessage);
            remoteUri = this.props.call.remoteIdentity.uri;
            callState = this.props.call.state;
            remoteDisplayName = this.props.call.remoteIdentity.displayName || this.props.call.remoteIdentity.uri;
            direction = this.props.call.direction;
            callUUID = this.props.call.id;

            if (this.props.ssiAgent) {
                this.props.call.headers.forEach((header) => {
                    if (header.name === 'SSI-roles') {
                        this.ssiRemoteRoles = header.value.split(',');
                        if (this.ssiRemoteRoles.indexOf('holder') > -1) {
                            console.log('Remote party is an SSI holder');
                            if (this.ssiRoles.indexOf('verifier') === -1) {
                                this.ssiRoles.push('verifier'); //we can verify the remote party
                            }
                        }

                        if (this.ssiRemoteRoles.indexOf('issuer') > -1) {
                            console.log('Remote party is an SSI issuer');
                        }

                        if (this.ssiRemoteRoles.indexOf('verifier') > -1) {
                            console.log('Remote party is an SSI verifier');
                        }
                    }
                });
            }
        } else {
            remoteUri = this.props.targetUri;
            remoteDisplayName = this.props.targetUri;
            callUUID = this.props.callUUID;
            direction = callUUID ? 'outgoing' : 'incoming';
            ssiRequired = this.props.ssiRequired;
        }

        if (this.props.connection) {
            //console.log('Added listener for connection', this.props.connection);
            this.props.connection.on('stateChanged', this.connectionStateChanged);
        }

        let audioOnly = false;
        if (this.props.localMedia && this.props.localMedia.getVideoTracks().length === 0) {
            audioOnly = true;
        }

        this.state = {
                      call: this.props.call,
                      targetUri: this.props.targetUri,
                      audioOnly: audioOnly,
                      boo: false,
                      remoteUri: remoteUri,
                      remoteDisplayName: remoteDisplayName,
                      localMedia: this.props.localMedia,
                      connection: this.props.connection,
                      accountId: this.props.account ? this.props.account.id : null,
                      account: this.props.account,
                      callState: callState,
                      direction: direction,
                      callUUID: callUUID,
                      reconnectingCall: this.props.reconnectingCall,
                      info: '',
                      packetLossQueue: [],
                      audioBandwidthQueue: [],
                      videoBandwidthQueue: [],
                      latencyQueue: [],
                      declineReason: this.props.declineReason,
                      messages: this.props.messages,
                      selectedContact: this.props.selectedContact,
                      callContact: this.props.callContact,
                      selectedContacts: this.props.selectedContacts,
                      ssiRequired: ssiRequired,
                      ssiAgent: this.props.ssiAgent,
                      ssiInvitationUrl: null,
                      ssiRemoteIdentity: null,
                      ssiVerified: null,
                      ssiVerifyInProgress: false,
                      ssiCanVerify: false
                      }

        this.statisticsTimer = setInterval(() => {
             this.getConnectionStats();
        }, this.sampleInterval * 1000);

    }

    componentDidMount() {
        if (this.props.ssiAgent) {
            this.props.ssiAgent.events.on(ConnectionEventTypes.ConnectionStateChanged, this.handleSSIAgentConnectionStateChange);
            this.props.ssiAgent.events.on(ProofEventTypes.ProofStateChanged, this.handleSSIAgentProofStateChange);
        }

        this.resetStats();

        this.lookupContact();

        if (this.state.direction === 'outgoing' && this.state.callUUID && this.state.callState !== 'established') {
            utils.timestampedLog('Call: start call', this.state.callUUID, 'when ready to', this.state.targetUri);
            this.startCallWhenReady(this.state.callUUID);
        }

        if (this.state.call === null) {
            this.mediaPlaying();
        }
    }

    componentWillUnmount() {
        this.ended = true;
        this.answering = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
        }

        if (this.state.connection) {
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
        }

        if (this.props.ssiAgent) {
            this.props.ssiAgent.events.off(ConnectionEventTypes.ConnectionStateChanged, this.handleSSIAgentConnectionStateChange);
            this.props.ssiAgent.events.off(ProofEventTypes.ProofStateChanged, this.handleSSIAgentProofStateChange);
        }
    }

    async handleSSIAgentConnectionStateChange(event) {
        const connectionRecord = event.payload.connectionRecord;
        utils.timestampedLog('SSI session connection', connectionRecord.id, event.payload.previousState, '->', connectionRecord.state);
        //utils.timestampedLog('SSI connection event', connectionRecord);
        if (connectionRecord.state === 'responded' || connectionRecord.state === 'complete' && !this.state.ssiCanVerify) {
            this.setState({ssiCanVerify: true});
            utils.timestampedLog('SSI connection established, we can now verify the remote party');
            this.props.postSystemNotification('You may now verify the remote party');
        }
    }

    async handleSSIAgentProofStateChange(event) {
        const proofRecord = event.payload.proofRecord;
        utils.timestampedLog('SSI proof event', proofRecord.id, 'new state:', proofRecord.state);
        //utils.timestampedLog('SSI proof event', proofRecord);
        if (this.ssiRoles.indexOf('verifier') > -1) {
            if (proofRecord.state === 'done') {
                this.cancelSSIVerify();

                if (proofRecord.isVerified === undefined) {
                    // the other party did the verification
                    this.props.postSystemNotification('We were verified');
                    utils.timestampedLog('The other party verified our SSI credential');
                } else if (proofRecord.isVerified === true) {
                    // the verification was successful --> call is authorized

                    const proofData = proofRecord.presentationMessage.presentationAttachments[0].getDataAsJson();
                    const proofValues = proofData.requested_proof.revealed_attr_groups.name.values;
                    const _credDefId = proofData.identifiers[0].cred_def_id;

                    if (_credDefId !== credDefId) {
                        utils.timestampedLog('SSI credential definition id', _credDefId, 'is not supported');
                        this.props.postSystemNotification('SSI credential id' + _credDefId + ' is invalid');
                        return;
                    }

                    const initials = proofValues.initials.raw;
                    const legalName = proofValues.legalName.raw;
                    const birthDate = proofValues.birthDate.raw;

                    let verifiedDisplayName = initials + ' ' + legalName + ' (' + birthDate + ')';
                    utils.timestampedLog('SSI verify proof succeeded for:', verifiedDisplayName);

                    const credentialAttributes = proofRecord.presentationMessage.indyProof;
                    //console.log(credentialAttributes.proof.proofs);
                    this.setState({ssiRemoteIdentity: credentialAttributes,
                                   ssiVerified: true,
                                   remoteDisplayName: verifiedDisplayName
                                   });
                } else if (proofRecord.isVerified === false) {
                    utils.timestampedLog('SSI verify proof failed');
                    this.setState({ssiVerified: false});
                } else {
                    console.log('Invalid proof record isVerified value', proofRecord.isVerified);
                }
                this.setState({ssiVerifyInProgress: false});
            }
        }
    }

    cancelSSIVerify() {
        if (!this.cancelVerifyIdentityTimer) {
            return;
        }

        clearTimeout(this.cancelVerifyIdentityTimer);
        this.cancelVerifyIdentityTimer = null;
        this.setState({ssiVerifyInProgress: false});
    }

    async verifySSIIdentity() {
        if (this.state.ssiConnectionRecord) {
            this.requestSSIProof(this.state.ssiConnectionRecord.id);
        } else {
            this.initSSIConnection();
        }
    }

    async requestSSIProof(connectionRecordId) {
        if (this.state.ssiVerifyInProgress) {
            utils.timestampedLog('SSI proof verify in progress')
        }

        const attributes = {
            name: new ProofAttributeInfo({
                names: ['legalName', 'initials', 'birthDate'],
                restrictions: [
                    new AttributeFilter({ credentialDefinitionId: credDefId })
                ]
            })
        }

        const proofRequestOptions = {
            name: "Proof Request Title",
            requestedAttributes: attributes
        }

        this.setState({ssiVerifyInProgress: true});
        this.cancelSSIVerify();
        this.cancelVerifyIdentityTimer = setTimeout(() => {
            this.cancelSSIVerify();
            this.props.postSystemNotification('SSI proof request timeout');
        }, 15000);

        try {
            utils.timestampedLog('Request SSI proof over connection', connectionRecordId, 'for schema', credDefId);
            const proofRequest = await this.state.ssiAgent.proofs.requestProof(connectionRecordId, proofRequestOptions);
            //console.log(proofRequestOptions);
        } catch (error) {
            utils.timestampedLog('SSI proof request error', error);
            this.props.postSystemNotification('SSI proof ' + error);
            this.setState({ssiVerifyInProgress: false});
        }
    }

    async initSSIConnection() {
        if (!this.state.ssiAgent) {
            console.log('No SSI Agent available');
            return;
        }

        if (this.state.ssiConnectionRecord) {
            utils.timestampedLog('SSI connection already active');
            return;
        }

        try {
            utils.timestampedLog('Creating SSI connection...');
            const ssiConnection = await this.state.ssiAgent.connections.createConnection();
            const invitationUrl = ssiConnection.invitation.toUrl({domain: "http://example.com"});
            this.setState({ssiInvitationUrl: invitationUrl, ssiConnectionRecord: ssiConnection.connectionRecord});

            this.sendSSIInvitation();
        } catch (error) {
            utils.timestampedLog('SSI create connection', error);
            this.props.postSystemNotification('SSI connection ' + error);
            this.setState({ssiVerified: false});
        }
    }

    sendSSIInvitation() {
        if (!this.state.call) {
            return;
        }

        utils.timestampedLog('SSI invitation sent');
        this.props.postSystemNotification('SSI invitation sent');
        let message = this.state.call.sendMessage(this.state.ssiInvitationUrl, 'text/ssi-invitation-url', {id: uuid.v4()}, (error) => {
            if (error) {
                console.log('Message', id, 'sending error:', error);
            }
        });
    }

    incomingMessage(message) {
        console.log('Session message', message.id, message.contentType, 'received');
        if (message.contentType === 'text/ssi-invitation-url' && this.state.ssiAgent && !this.state.ssiInvitationUrl) {
            this.receiveSSIInvitation(message.content);
        }
    }

    async receiveSSIInvitation(url) {
        utils.timestampedLog('SSI received invitation URL', url);
        try {
            const ssiConnectionRecord = await this.state.ssiAgent.connections.receiveInvitationFromUrl(url);
            utils.timestampedLog('SSI invitation accepted', ssiConnectionRecord.id);
            this.props.postSystemNotification('SSI invitation accepted');
            this.setState({ssiInvitationUrl: url, ssiConnectionRecord: ssiConnectionRecord});
        } catch (error) {
            this.setState({ssiVerified: false});
            utils.timestampedLog('SSI accept invitation error', error);
            this.props.postSystemNotification('SSI accept ' + error);
        }
    }

    resetStats() {
         if (this.ended) {
             return;
         }

         this.setState({
                      bandwidth: '',
                      packetLossQueue: [],
                      audioBandwidthQueue: [],
                      videoBandwidthQueue: [],
                      latencyQueue: []
                      });
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        // Needed for switching to incoming call while in a call
        if (this.ended) {
            return;
        }

        if (nextProps.connection && nextProps.connection !== this.state.connection) {
            nextProps.connection.on('stateChanged', this.connectionStateChanged);
        }

        this.setState({connection: nextProps.connection,
                       account: nextProps.account,
                       call: nextProps.call,
                       callContact: nextProps.callContact,
                       accountId: nextProps.account ? nextProps.account.id : null});

        if (this.state.call === null && nextProps.call !== null) {
            nextProps.call.on('stateChanged', this.callStateChanged);
            nextProps.call.on('incomingMessage', this.incomingMessage);

            this.setState({
                           remoteUri: nextProps.call.remoteIdentity.uri,
                           direction: nextProps.call.direction,
                           callUUID: nextProps.call.id,
                           remoteDisplayName: nextProps.call.remoteIdentity.displayName
                           });

            this.lookupContact();
        } else {
            if (nextProps.callUUID !== null && this.state.callUUID !== nextProps.callUUID) {
                this.setState({'callUUID': nextProps.callUUID,
                               'direction': 'outgoing',
                               'call': null
                               });

                this.startCallWhenReady(nextProps.callUUID);
            }
        }

        if (nextProps.reconnectingCall !== this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.targetUri !== this.state.targetUri && this.state.direction === 'outgoing') {
            this.setState({targetUri: nextProps.targetUri});
        }

        this.setState({registrationState: nextProps.registrationState,
                       declineReason: nextProps.declineReason});

        if (nextProps.localMedia !== null && nextProps.localMedia !== this.state.localMedia && this.state.direction === 'outgoing') {
            utils.timestampedLog('Call: media for outgoing call has been changed');

            let audioOnly = false;

            if (nextProps.localMedia.getVideoTracks().length === 0) {
                audioOnly = true;
            }

            this.setState({localMedia: nextProps.localMedia,
                           audioOnly: audioOnly});

            //this.mediaPlaying(nextProps.localMedia);
        }

        if (nextProps.hasOwnProperty('ssiCanVerify')) {
            this.setState({ssiCanVerify: nextProps.ssiCanVerify});
        }

        this.setState({messages: nextProps.messages,
                         selectedContacts: nextProps.selectedContacts,
                         ssiVerifyInProgress: nextProps.ssiVerifyInProgress
                         });

        if (nextProps.ssiConnectionRecord) {
            this.setState({ssiConnectionRecord: nextProps.ssiConnectionRecord});
        }

        if (nextProps.ssiInvitationUrl) {
            this.setState({ssiInvitationUrl: nextProps.ssiInvitationUrl});
        }
    }

    getConnectionStats() {
         if (this.ended) {
             return;
         }

         let speed = 0;
         let diff = 0;

         let delay = 0;

         let audioPackets = 0;
         let videoPackets = 0;

         let audioPacketsLost = 0;
         let videoPacketsLost = 0;

         let audioPacketLoss = 0;
         let videoPacketLoss = 0;

         let bandwidthUpload = 0;
         let bandwidthDownload = 0;

         let mediaType;
         let foundVideo = false;

         if (!this.state.call || !this.state.call._pc) {
             this.resetStats();
             return;
         }

         this.state.call._pc.getStats(null).then(stats => {
             stats.forEach(report => {

             if (report.type === "ssrc") {
                 report.values.forEach(object => { if (object.mediaType) {
                         mediaType = object.mediaType;
                     }
                 });

                 report.values.forEach(object => {
                     if (object.googCodecName) {
                        if (mediaType === 'video') {
                            this.audioCodec = object.googCodecName;
                        } else {
                            this.videoCodec = object.googCodecName;
                        }
                     } else if (object.bytesReceived) {
                         const bytesReceived = Math.floor(object.bytesReceived);
                         if (mediaType === 'audio') {
                             if (this.audioBytesReceived > 0 && this.audioBytesReceived < bytesReceived) {
                                 diff = bytesReceived - this.audioBytesReceived;
                                 diff = bytesReceived - this.audioBytesReceived;
                                 speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                 //console.log('Audio bandwidth received', speed, 'kbit/s');
                                 bandwidthDownload = bandwidthDownload + speed;
                                 if (this.audioBandwidthQueue.length < this.samples) {
                                     var n = this.samples;
                                     while (n > 0) {
                                         this.audioBandwidthQueue.push(0);
                                         n = n - 1;
                                     }
                                 }

                                 this.audioBandwidthQueue.push(speed);
                             }
                             this.audioBytesReceived = bytesReceived;
                         } else if (mediaType === 'video') {
                             foundVideo = true;
                             if (this.videoBytesReceived > 0 && this.videoBytesReceived < bytesReceived) {
                                 diff = bytesReceived - this.videoBytesReceived;
                                 speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                 //console.log('Video bandwidth received', speed, 'kbit/s');
                                 bandwidthDownload = bandwidthDownload + speed;
                                 if (this.videoBandwidthQueue.length < this.samples) {
                                     var n = this.samples;
                                     while (n > 0) {
                                         this.videoBandwidthQueue.push(0);
                                         n = n - 1;
                                     }
                                 }
                                 this.videoBandwidthQueue.push(speed)
                             }
                             this.videoBytesReceived = bytesReceived;
                         }
                     } else if (object.bytesSent) {
                         const bytesSent = Math.floor(object.bytesSent);
                         if (mediaType === 'audio') {
                             if (this.audioBytesSent > 0 && bytesSent > this.audioBytesSent) {
                                 const diff = bytesSent - this.audioBytesSent;
                                 const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                 bandwidthUpload = bandwidthUpload + speed;
                                 //console.log('Audio bandwidth sent', speed, 'kbit/s');
                             }
                             this.audioBytesSent = bytesSent;
                         } else if (mediaType === 'video') {
                             foundVideo = true;
                             if (this.videoBytesSent > 0 && bytesSent > this.videoBytesSent) {
                                 const diff = bytesSent - this.videoBytesSent;
                                 const speed = Math.floor(diff / this.sampleInterval * 8 / 1000);
                                 bandwidthUpload = bandwidthUpload + speed;
                                 //console.log('Video bandwidth sent', speed, 'kbit/s');
                             }
                             this.videoBytesSent = bytesSent;
                         }

                     } else if (object.packetsLost) {
                         if (mediaType === 'audio') {
                             audioPackets = audioPackets + Math.floor(object.packetsLost);
                             audioPacketsLost =  audioPacketsLost + Math.floor(object.packetsLost);
                         } else if (mediaType === 'video') {
                             videoPackets = videoPackets + Math.floor(object.packetsLost);
                             videoPacketsLost = videoPacketsLost + Math.floor(object.packetsLost);
                         }
                     } else if (object.packetsReceived) {
                         if (mediaType === 'audio') {
                             audioPackets = audioPackets + Math.floor(object.packetsReceived);
                         } else if (mediaType === 'video') {
                             videoPackets = videoPackets + Math.floor(object.packetsReceived);
                         }
                     } else if (object.googCurrentDelayMs) {
                         delay = object.googCurrentDelayMs;
                     }
                     //console.log(object);
                 });

             }});

         // packet loss

         videoPacketLoss = 0;
         if (videoPackets > 0) {
             videoPacketLoss = Math.floor(videoPacketsLost / videoPackets * 100);
             if (videoPacketLoss > 1) {
                 //console.log('Video packet loss', videoPacketLoss, '%');
             }
         }

         audioPacketLoss = 0;
         if (audioPackets > 0) {
             audioPacketLoss = Math.floor(audioPacketsLost / audioPackets * 100);
             if (audioPacketLoss > 3) {
                 //console.log('Audio packet loss', audioPacketLoss, '%');
             }
         }

         this.packetLoss = videoPacketLoss > audioPacketLoss ? videoPacketLoss : audioPacketLoss;

         //this.packetLoss = randomIntFromInterval(2, 10);

         if (this.packetLoss < 3) {
             this.packetLoss = 0;
         }

         if (this.packetLossQueue.length < this.samples) {
             var n = this.samples;
             while (n > 0) {
                 this.packetLossQueue.push(0);
                 n = n - 1;
             }
         }

         if (this.latencyQueue.length < this.samples) {
             var n = this.samples;
             while (n > 0) {
                 this.latencyQueue.push(0);
                 n = n - 1;
             }
         }

         this.latencyQueue.push(Math.ceil(delay));

         this.packetLossQueue.push(this.packetLoss);

         this.audioPacketLoss = audioPacketLoss;
         this.videoPacketLoss = videoPacketLoss;

        let info = '';
        let suffix = 'kbit/s';

        if (foundVideo && (bandwidthUpload > 0 || bandwidthDownload > 0)) {
            suffix = 'Mbit/s';
            bandwidthUpload = Math.ceil(bandwidthUpload / 1000 * 100) / 100;
            bandwidthDownload = Math.ceil(bandwidthDownload / 1000 * 100) / 100;
        }

        if (bandwidthDownload && bandwidthUpload) {
            if (bandwidthDownload > 0 && bandwidthUpload > 0) {
                info = '⇣' + bandwidthDownload + ' ⇡' + bandwidthUpload;
            } else if (bandwidthDownload > 0) {
                info = '⇣' + bandwidthDownload;
            } else if (bandwidthUpload > 0) {
                info = '⇡' + this.bandwidthUpload;
            }

            if (info) {
                info = info + ' ' + suffix;
            }
        }

        if (this.packetLoss > 2) {
            info = info + ' - ' + Math.ceil(this.packetLoss) + '% loss';
        }

        if (delay > 150) {
            info = info + ' - ' + Math.ceil(delay) + ' ms';
        }

        this.setState({packetLossQueue: this.packetLossQueue,
                       latencyQueue: this.latencyQueue,
                       videoBandwidthQueue: this.videoBandwidthQueue,
                       audioBandwidthQueue: this.audioBandwidthQueue,
                       info: info
                        });
         });
     };

    mediaPlaying(localMedia) {
        console.log('Media playing');
        if (this.state.direction === 'incoming') {
            const media = localMedia ? localMedia : this.state.localMedia;
            this.answerCall(media);
        } else {
            this.mediaIsPlaying = true;
        }
    }

    async answerCall(localMedia) {
        const media = localMedia ? localMedia : this.state.localMedia;
        if (this.state.call && this.state.call.state === 'incoming' && media) {
            let options = {pcConfig: {iceServers: config.iceServers}};
            options.localStream = media;

            if (this.state.ssiAgent) {
                options.headers = [{name: 'SSI-roles', value: this.ssiRoles.toString()}];
                //console.log('Call answer extra headers:', options.headers);
            }

            if (!this.answering) {
                this.answering = true;
                const connectionState = this.state.connection.state ? this.state.connection.state : null;
                utils.timestampedLog('Call: answering call', this.state.call.id, 'in connection state', connectionState);
                try {
                    this.state.call.answer(options);
                    utils.timestampedLog('Call: answered');
                } catch (error) {
                    utils.timestampedLog('Call: failed to answer', error);
                    this.hangupCall('answer_failed')
                }
            } else {
                utils.timestampedLog('Call: answering call in progress...');
            }
        } else {
            if (!this.state.call) {
                utils.timestampedLog('Call: no Sylkrtc call present');
                this.hangupCall('answer_failed');
            }

            if (this.state.call && this.state.call.state !== 'incoming') {
                utils.timestampedLog('Call: state is not incoming');
            }

            if (!media) {
                utils.timestampedLog('Call: waiting for local media');
            }
        }
    }

    lookupContact() {
        // TODO this must lookup in myContacts
        let photo = null;
        let remoteUri = this.state.remoteUri || '';
        let remoteDisplayName = this.state.remoteDisplayName || '';

        if (!remoteUri) {
            return;
        }

        if (remoteUri.indexOf('3333@') > -1) {
            remoteDisplayName = 'Video Test';
        } else if (remoteUri.indexOf('4444@') > -1) {
            remoteDisplayName = 'Echo Test';
        } else if (this.props.myContacts.hasOwnProperty(remoteUri) && this.props.myContacts[remoteUri].name) {
            remoteDisplayName = this.props.myContacts[remoteUri].name;
        } else if (this.props.contacts) {
            let username = remoteUri.split('@')[0];
            let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

            if (isPhoneNumber) {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', username);
            } else {
                var contact_obj = this.findObjectByKey(this.props.contacts, 'uri', remoteUri);
            }

            if (contact_obj) {
                remoteDisplayName = contact_obj.displayName;
                photo = contact_obj.photo;
                if (isPhoneNumber) {
                    remoteUri = username;
                }
            } else {
                if (isPhoneNumber) {
                    remoteUri = username;
                    remoteDisplayName = username;
                }
            }
        }

        this.setState({remoteDisplayName: remoteDisplayName,
                       remoteUri: remoteUri,
                       photo: photo
                       });
    }

    callStateChanged(oldState, newState, data) {
        //console.log('Call: callStateChanged', oldState, '->', newState);
        if (this.ended) {
            return;
        }

        let remoteHasNoVideoTracks;
        let remoteIsRecvOnly;
        let remoteIsInactive;
        let remoteStreams;

        this.answering = false;

        if (newState === 'established') {
            this.setState({reconnectingCall: false});
            const currentCall = this.state.call;

            if (this.state.direction === 'outgoing' && this.ssiRemoteRoles.length > 0) {
                this.initSSIConnection();
            }

            if (this.state.direction === 'outgoing') {
                if (this.ssiRemoteRoles.length > 0) {
                    utils.timestampedLog('SSI local roles:', this.ssiRoles.toString());
                    utils.timestampedLog('SSI remote roles:', this.ssiRemoteRoles.toString());
                } else {
                    console.log('Remove party does not support SSI');
                }
            } else {
                if (this.ssiRemoteRoles.length > 0) {
                    utils.timestampedLog('SSI local roles:', this.ssiRoles.toString());
                    utils.timestampedLog('SSI remote roles:', this.ssiRemoteRoles.toString());
                } else {
                    console.log('Remove party does not support SSI');
                }
            }

            if (currentCall) {
                remoteStreams = currentCall.getRemoteStreams();
                if (remoteStreams) {
                    if (remoteStreams.length > 0) {
                        const remotestream = remoteStreams[0];
                        remoteHasNoVideoTracks = remotestream.getVideoTracks().length === 0;
                        remoteIsRecvOnly = currentCall.remoteMediaDirections.video[0] === 'recvonly';
                        remoteIsInactive = currentCall.remoteMediaDirections.video[0] === 'inactive';
                    }
                }
            }

            if (remoteStreams && (remoteHasNoVideoTracks || remoteIsRecvOnly || remoteIsInactive) && !this.state.audioOnly) {
                //console.log('Media type changed to audio');
                // Stop local video
                if (this.state.localMedia.getVideoTracks().length !== 0) {
                    currentCall.getLocalStreams()[0].getVideoTracks()[0].stop();
                }
                this.setState({audioOnly: true});
            } else {
                this.forceUpdate();
            }

        } else if (newState === 'accepted') {
            // Switch if we have audioOnly and local videotracks. This means
            // the call object switched and we are transitioning to an
            // incoming call.
            if (this.state.audioOnly &&  this.state.localMedia && this.state.localMedia.getVideoTracks().length !== 0) {
                //console.log('Media type changed to video on accepted');
                this.setState({audioOnly: false});
            }

            data.headers.forEach((header) => {
                if (header.name === 'SSI-roles') {
                    this.ssiRemoteRoles = header.value.split(',');

                    if (this.ssiRemoteRoles.indexOf('holder') > -1) {
                        utils.timestampedLog('Remote party is an SSI holder');
                    }

                    if (this.ssiRemoteRoles.indexOf('issuer') > -1) {
                        utils.timestampedLog('Remote party is an SSI issuer');
                    }

                    if (this.ssiRemoteRoles.indexOf('verifier') > -1) {
                        utils.timestampedLog('Remote party is an SSI verifier');
                    }
                }
            });
        }

        if (newState !== 'established') {
            this.cancelSSIVerify();
        }

        this.forceUpdate();
    }

    connectionStateChanged(oldState, newState) {
        switch (newState) {
            case 'closed':
                break;
            case 'ready':
                break;
            case 'disconnected':
                if (oldState === 'ready' && this.state.direction === 'outgoing') {
                    utils.timestampedLog('Call: reconnecting the call...');
                    this.waitInterval = this.defaultWaitInterval;
                }
                break;
            default:
                break;
        }
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    canConnect() {
        if (!this.state.connection) {
            console.log('Call: no connection yet');
            return false;
        }

        if (this.state.connection.state !== 'ready') {
            console.log('Call: connection is not ready');
            return false;
        }

        if (this.props.registrationState !== 'registered') {
            console.log('Call: account not ready yet');
            return false;
        }

        if (!this.mediaIsPlaying) {
            if (this.waitCounter > 0) {
                console.log('Call: media is not yet playing');
            }
            return false;
        }

        return true;
    }

    async startCallWhenReady(callUUID) {
        this.waitCounter = 0;

        let diff = 0;

        while (this.waitCounter < this.waitInterval) {
            if (this.waitCounter === 1) {
                utils.timestampedLog('Call: waiting for establishing call', this.waitInterval, 'seconds');
            }

            if (this.userHangup) {
                this.hangupCall('user_cancelled');
                return;
            }

            if (this.ended) {
                return;
            }

            if (this.waitCounter >= this.waitInterval - 1) {
                this.hangupCall('timeout');
            }

            if (!this.canConnect()) {
                //utils.timestampedLog('Call: waiting for connection', this.waitInterval - this.waitCounter, 'seconds');
                if (this.state.call && this.state.call.id === callUUID && this.state.call.state !== 'terminated') {
                    return;
                }

                if (this.waitCounter > 0 && this.waitCounter % 10 === 0) {
                    console.log('Wait', this.waitCounter);
                }
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
        if (this.state.localMedia === null)  {
            console.log('Call: cannot create new call without local media');
            return;
        }

        let options = {
                       pcConfig: {iceServers: config.iceServers},
                       id: this.state.callUUID,
                       localStream: this.state.localMedia
                       };

        if (this.state.ssiAgent) {
            options.headers = [{name: 'SSI-roles', value: this.ssiRoles.toString()}];
            //console.log('Outgoing call extra headers:', options.headers);
        }

        let call = this.state.account.call(this.state.targetUri, options);
        this.setState({call: call});
    }

    hangupCall(reason) {
        let callUUID = this.state.call ? this.state.call.id : this.state.callUUID;
        this.waitInterval = this.defaultWaitInterval;

        if (this.state.call) {
            //console.log('Remove listener for call', this.state.call.id);
            this.state.call.removeListener('stateChanged', this.callStateChanged);
            this.state.call.removeListener('incomingMessage', this.incomingMessage);
            this.setState({call: null});
        }

        if (this.state.connection) {
            //console.log('Remove listener for connection', this.state.connection);
            this.state.connection.removeListener('stateChanged', this.connectionStateChanged);
            this.setState({connection: null});
        }

        if (this.waitCounter > 0) {
            this.waitCounter = this.waitInterval;
        }

        this.props.hangupCall(callUUID, reason);
    }

    render() {
        let box = null;
        if (this.state.localMedia !== null) {
            if (this.state.audioOnly) {

                box = (
                    <AudioCallBox
                        remoteUri = {this.state.remoteUri}
                        remoteDisplayName = {this.state.remoteDisplayName}
                        photo = {this.state.photo}
                        hangupCall = {this.hangupCall}
                        call = {this.state.call}
                        accountId={this.state.accountId}
                        connection = {this.state.connection}
                        mediaPlaying = {this.mediaPlaying}
                        escalateToConference = {this.props.escalateToConference}
                        callKeepSendDtmf = {this.props.callKeepSendDtmf}
                        toggleMute = {this.props.toggleMute}
                        speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                        toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                        orientation = {this.props.orientation}
                        isTablet = {this.props.isTablet}
                        reconnectingCall = {this.state.reconnectingCall}
                        muted = {this.props.muted}
                        packetLossQueue = {this.state.packetLossQueue}
                        videoBandwidthQueue = {this.state.videoBandwidthQueue}
                        audioBandwidthQueue = {this.state.audioBandwidthQueue}
                        latencyQueue = {this.state.latencyQueue}
                        audioCodec = {this.audioCodec}
                        info = {this.state.info}
                        declineReason = {this.state.declineReason}
                        showLogs = {this.props.showLogs}
                        goBackFunc = {this.props.goBackFunc}
                        callState = {this.props.callState}
                        messages = {this.state.messages}
                        deleteMessages = {this.props.deleteMessages}
                        sendMessage = {this.props.sendMessage}
                        expireMessage = {this.props.expireMessage}
                        reSendMessage = {this.props.reSendMessage}
                        deleteMessage = {this.props.deleteMessage}
                        getMessages = {this.props.getMessages}
                        pinMessage = {this.props.pinMessage}
                        unpinMessage = {this.props.unpinMessage}
                        selectedContact = {this.state.selectedContact}
                        selectedContacts = {this.state.selectedContacts}
                        callContact = {this.state.callContact}
                        inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                        finishInvite = {this.props.finishInvite}
                        ssiRemoteIdentity = {this.state.ssiRemoteIdentity}
                        ssiVerifyFunc = {this.verifySSIIdentity}
                        ssiVerified = {this.state.ssiVerified}
                        ssiCanVerify = {this.state.ssiCanVerify}
                        ssiVerifyInProgress = {this.state.ssiVerifyInProgress}
                        />
                );
            } else {
                if (this.state.call !== null && (this.state.call.state === 'established' || (this.state.call.state === 'terminated' && this.state.reconnectingCall))) {

                    box = (
                        <VideoBox
                            remoteUri = {this.state.remoteUri}
                            remoteDisplayName = {this.state.remoteDisplayName}
                            photo = {this.state.photo}
                            hangupCall = {this.hangupCall}
                            call = {this.state.call}
                            accountId={this.state.accountId}
                            connection = {this.state.connection}
                            localMedia = {this.state.localMedia}
                            shareScreen = {this.props.shareScreen}
                            escalateToConference = {this.props.escalateToConference}
                            generatedVideoTrack = {this.props.generatedVideoTrack}
                            callKeepSendDtmf = {this.props.callKeepSendDtmf}
                            toggleMute = {this.props.toggleMute}
                            speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                            toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                            intercomDtmfTone = {this.props.intercomDtmfTone}
                            orientation = {this.props.orientation}
                            isTablet = {this.props.isTablet}
                            reconnectingCall = {this.state.reconnectingCall}
                            audioCodec = {this.audioCodec}
                            videoCodec = {this.videoCodec}
                            muted = {this.props.muted}
                            info = {this.state.info}
                            showLogs = {this.props.showLogs}
                            goBackFunc = {this.props.goBackFunc}
                            callState = {this.props.callState}
                            messages = {this.state.messages}
                            deleteMessages = {this.props.deleteMessages}
                            sendMessage = {this.props.sendMessage}
                            expireMessage = {this.props.expireMessage}
                            reSendMessage = {this.props.reSendMessage}
                            deleteMessage = {this.props.deleteMessage}
                            getMessages = {this.props.getMessages}
                            pinMessage = {this.props.pinMessage}
                            unpinMessage = {this.props.unpinMessage}
                            selectedContact = {this.state.selectedContact}
                            selectedContacts = {this.state.selectedContacts}
                            callContact = {this.state.callContact}
                            inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                            finishInvite = {this.props.finishInvite}
                            ssiRemoteIdentity = {this.state.ssiRemoteIdentity}
                            ssiVerifyFunc = {this.verifySSIIdentity}
                            ssiVerified = {this.state.ssiVerified}
                            ssiCanVerify = {this.state.ssiCanVerify}
                            ssiVerifyInProgress = {this.state.ssiVerifyInProgress}
                            />
                    );
                } else {
                    if (this.state.call && this.state.call.state === 'terminated' && this.state.reconnectingCall) {
                        //console.log('Skip render local media because we will reconnect');
                    } else {
                        box = (
                            <LocalMedia
                                call = {this.state.call}
                                remoteUri = {this.state.remoteUri}
                                remoteDisplayName = {this.state.remoteDisplayName}
                                photo = {this.state.photo}
                                localMedia = {this.state.localMedia}
                                mediaPlaying = {this.mediaPlaying}
                                hangupCall = {this.hangupCall}
                                generatedVideoTrack = {this.props.generatedVideoTrack}
                                accountId = {this.state.accountId}
                                connection = {this.state.connection}
                                orientation = {this.props.orientation}
                                isTablet = {this.props.isTablet}
                                media = 'video'
                                declineReason = {this.state.declineReason}
                                showLogs = {this.props.showLogs}
                                goBackFunc = {this.props.goBackFunc}
                                />
                        );
                    }
                }
            }
        } else {
            box = (
                <AudioCallBox
                    remoteUri = {this.state.remoteUri}
                    remoteDisplayName = {this.state.remoteDisplayName}
                    photo = {this.state.photo}
                    hangupCall = {this.hangupCall}
                    call = {this.state.call}
                    accountId = {this.state.accountId}
                    connection = {this.state.connection}
                    mediaPlaying = {this.mediaPlaying}
                    escalateToConference = {this.props.escalateToConference}
                    callKeepSendDtmf = {this.props.callKeepSendDtmf}
                    toggleMute = {this.props.toggleMute}
                    speakerPhoneEnabled = {this.props.speakerPhoneEnabled}
                    toggleSpeakerPhone = {this.props.toggleSpeakerPhone}
                    orientation = {this.props.orientation}
                    isTablet = {this.props.isTablet}
                    reconnectingCall = {this.state.reconnectingCall}
                    muted = {this.props.muted}
                    info = {this.state.info}
                    declineReason = {this.state.declineReason}
                    showLogs = {this.props.showLogs}
                    goBackFunc = {this.props.goBackFunc}
                    selectedContact = {this.state.selectedContact}
                    callContact = {this.state.callContact}
                    inviteToConferenceFunc = {this.props.inviteToConferenceFunc}
                    finishInvite = {this.props.finishInvite}
                    ssiRemoteIdentity = {this.state.ssiRemoteIdentity}
                    ssiVerifyFunc = {this.verifySSIIdentity}
                    ssiVerified = {this.state.ssiVerified}
                    ssiCanVerify = {this.state.ssiCanVerify}
                    ssiVerifyInProgress = {this.state.ssiVerifyInProgress}
                    />
            );
        }
        return box;
    }
}

Call.propTypes = {
    targetUri               : PropTypes.string,
    account                 : PropTypes.object,
    hangupCall              : PropTypes.func,
    connection              : PropTypes.object,
    registrationState       : PropTypes.string,
    call                    : PropTypes.object,
    localMedia              : PropTypes.object,
    shareScreen             : PropTypes.func,
    escalateToConference    : PropTypes.func,
    generatedVideoTrack     : PropTypes.bool,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    callUUID                : PropTypes.string,
    contacts                : PropTypes.array,
    intercomDtmfTone        : PropTypes.string,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
    myContacts              : PropTypes.object,
    declineReason           : PropTypes.string,
    showLogs                : PropTypes.func,
    goBackFunc              : PropTypes.func,
    callState               : PropTypes.object,
    messages                : PropTypes.object,
    sendMessage             : PropTypes.func,
    reSendMessage           : PropTypes.func,
    confirmRead             : PropTypes.func,
    deleteMessage           : PropTypes.func,
    expireMessage           : PropTypes.func,
    getMessages             : PropTypes.func,
    pinMessage              : PropTypes.func,
    unpinMessage            : PropTypes.func,
    selectedContact         : PropTypes.object,
    callContact             : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    ssiRequired             : PropTypes.bool,
    ssiAgent                : PropTypes.object,
    ssiRoles                : PropTypes.array,
    postSystemNotification  : PropTypes.func
};


export default Call;
