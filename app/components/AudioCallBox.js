import React, { Component } from 'react';
import { View, Platform, TouchableWithoutFeedback, TouchableHighlight } from 'react-native';
import { IconButton, Dialog, Text, ActivityIndicator, Colors } from 'react-native-paper';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';

import EscalateConferenceModal from './EscalateConferenceModal';
import CallOverlay from './CallOverlay';
import DTMFModal from './DTMFModal';
import UserIcon from './UserIcon';
import styles from '../assets/styles/blink/_AudioCallBox.scss';
import utils from '../utils';
import LoadingScreen from './LoadingScreen';

import TrafficStats from './BarChart';


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}


class AudioCallBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            remoteUri                   : this.props.remoteUri,
            remoteDisplayName           : this.props.remoteDisplayName,
            photo                       : this.props.photo,
            active                      : false,
            audioMuted                  : this.props.muted,
            showDtmfModal               : false,
            showEscalateConferenceModal : false,
            call                        : this.props.call,
            reconnectingCall            : this.props.reconnectingCall,
            info                        : this.props.info,
            selectedContacts            : this.props.selectedContacts,
            packetLossQueue             : [],
            audioBandwidthQueue         : [],
            latencyQueue                : [],
            declineReason               : this.props.declineReason,
            callContact                 : this.props.callContact,
            selectedContact             : this.props.selectedContact,
            audioCodec                  : this.props.audioCodec,
            ssiRemoteIdentity           : this.props.ssiRemoteIdentity,
            ssiVerifyInProgress         : this.props.ssiVerifyInProgress,
            ssiVerified                 : this.props.ssiVerified,
            ssiCanVerify                : this.props.ssiCanVerify
        };

        this.remoteAudio = React.createRef();
        this.userHangup = false;
    }

    componentDidMount() {
        // This component is used both for as 'local media' and as the in-call component.
        // Thus, if the call is not null it means we are beyond the 'local media' phase
        // so don't call the mediaPlaying prop.

        if (this.state.call != null) {
            switch (this.state.call.state) {
                case 'established':
                    this.attachStream(this.state.call);
                    break;
                case 'incoming':
                    this.props.mediaPlaying();
                    // fall through
                default:
                    this.state.call.on('stateChanged', this.callStateChanged);
                    break;
            }
        }

        if (this.state.selectedContacts && this.state.selectedContacts.length > 0) {
            this.toggleEscalateConferenceModal();
        }
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.call !== null && nextProps.call !== this.state.call) {
            if (nextProps.call.state === 'established') {
                this.attachStream(nextProps.call);
                this.setState({reconnectingCall: false});
            }

            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            this.setState({call: nextProps.call});
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.hasOwnProperty('muted')) {
            this.setState({audioMuted: nextProps.muted});
        }

        if (nextProps.hasOwnProperty('info')) {
            this.setState({info: nextProps.info});
        }

        if (nextProps.hasOwnProperty('packetLossQueue')) {
            this.setState({packetLossQueue: nextProps.packetLossQueue});
        }

        if (nextProps.hasOwnProperty('audioBandwidthQueue')) {
            this.setState({audioBandwidthQueue: nextProps.audioBandwidthQueue});
        }

        if (nextProps.hasOwnProperty('latencyQueue')) {
            this.setState({latencyQueue: nextProps.latencyQueue});
        }

        if (nextProps.hasOwnProperty('ssiVerifyInProgress')) {
            this.setState({ssiVerifyInProgress: nextProps.ssiVerifyInProgress});
        }

        this.setState({remoteUri: nextProps.remoteUri,
                       remoteDisplayName: nextProps.remoteDisplayName,
                       photo: nextProps.photo ? nextProps.photo : this.state.photo,
                       declineReason: nextProps.declineReason,
                       callContact: nextProps.callContact,
                       audioCodec: nextProps.audioCodec,
                       selectedContacts: nextProps.selectedContacts,
                       selectedContact: nextProps.selectedContact,
                       ssiRemoteIdentity: nextProps.ssiRemoteIdentity,
                       ssiVerified: nextProps.ssiVerified,
                       ssiCanVerify: nextProps.ssiCanVerify
                       });
    }

    componentWillUnmount() {
        if (this.state.call != null) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }
        clearTimeout(this.callTimer);
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established') {
            this.attachStream(this.state.call);
            this.setState({reconnectingCall: false});
        }
    }

    attachStream(call) {
        this.setState({stream: call.getRemoteStreams()[0]}); //we dont use it anywhere though as audio gets automatically piped
    }

    escalateToConference(participants) {
        this.props.escalateToConference(participants);
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_hangup_call');
        this.userHangup = true;
    }

    cancelCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_cancel_call');
    }

    muteAudio(event) {
        event.preventDefault();
        this.props.toggleMute(this.props.call.id, !this.state.audioMuted);
     }

    showDtmfModal() {
        this.setState({showDtmfModal: true});
    }

    verifyIdentity() {
        if (this.state.ssiVerified) {
            return;
        }
        this.props.ssiVerifyFunc();
    }

    hideDtmfModal() {
        this.setState({showDtmfModal: false});
    }

    toggleEscalateConferenceModal() {
        if (this.state.showEscalateConferenceModal) {
            this.props.finishInvite();
        }
        this.setState({
            showEscalateConferenceModal: !this.state.showEscalateConferenceModal
        });
    }

    handleDoubleTap() {
        const now = Date.now();
        const DOUBLE_PRESS_DELAY = 300;
        if (this.lastTap && now - this.lastTap < DOUBLE_PRESS_DELAY) {
          this.props.showLogs();
        } else {
          this.lastTap = now;
        }
    }

    render() {

        let buttonContainerClass;
        let userIconContainerClass;

        let remoteIdentity = {uri: this.state.remoteUri || '',
                              name: this.state.remoteDisplayName || '',
                              photo: this.state.photo
                              };

        const username = this.state.remoteUri.split('@')[0];
        const isPhoneNumber = utils.isPhoneNumber(this.state.remoteUri);

        let displayName = this.state.remoteUri ? toTitleCase(this.state.remoteUri.split('@')[0]) : '';

        if (this.state.remoteDisplayName && this.state.remoteUri !== this.state.remoteDisplayName) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.isTablet) {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.tabletLandscapeButtonContainer : styles.tabletPortraitButtonContainer;
            userIconContainerClass = styles.tabletUserIconContainer;
        } else {
            buttonContainerClass = this.props.orientation === 'landscape' ? styles.landscapeButtonContainer : styles.portraitButtonContainer;
            userIconContainerClass = styles.userIconContainer;
        }

        const buttonSize = this.props.isTablet ? 40 : 34;

        let disablePlus = false;
        if (this.state.callContact) {
            if (isPhoneNumber) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('test') > -1) {
                disablePlus = true;
            }

            if (this.state.callContact.tags.indexOf('conference') > -1) {
                disablePlus = true;
            }
        }

        let whiteButtonClass         = Platform.OS === 'ios' ? styles.whiteButtoniOS         : styles.whiteButton;
        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS         : styles.greenButton;
        let hangupButtonClass        = Platform.OS === 'ios' ? styles.hangupButtoniOS        : styles.hangupButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS : styles.disabledGreenButton;

        let verifyIcon = 'account-question';
        if (this.state.ssiVerified) {
            verifyIcon = 'shield-account';
        } else {
            if (this.state.ssiVerified === false) {
            } else {
                if (this.state.ssiVerifyInProgress) {
                    verifyIcon = 'account-search';
                }
            }
        }

        let showVerifyButton = false;

        if ((this.props.orientation === 'portrait' ||  this.props.isTablet) &&
             this.state.ssiCanVerify &&
             this.state.call && (this.state.call.state === 'accepted' || this.state.call.state === 'established') &&
             !this.state.reconnectingCall) {
            showVerifyButton = true;
        }

        return (
            <View style={styles.container}>
                <CallOverlay style={styles.callStatus}
                    show={true}
                    remoteUri={this.state.remoteUri}
                    remoteDisplayName={this.state.remoteDisplayName}
                    call={this.state.call}
                    reconnectingCall={this.state.reconnectingCall}
                    connection={this.props.connection}
                    accountId={this.props.accountId}
                    media='audio'
                    declineReason={this.state.declineReason}
                    goBackFunc={this.props.goBackFunc}
                    callState={this.props.callState}
                />

                <View style={userIconContainerClass}>
                    <UserIcon identity={remoteIdentity} large={true} active={this.state.active} />
                </View>

                <Dialog.Title style={styles.displayName}>{displayName}</Dialog.Title>
                <TouchableWithoutFeedback onPress={this.handleDoubleTap}>
                <Text style={styles.uri}>{this.state.remoteUri}</Text>
                </TouchableWithoutFeedback>

                {this.props.orientation !== 'landscape' && (this.state.reconnectingCall || this.state.ssiVerifyInProgress) ?
                <ActivityIndicator style={styles.activity} animating={true} size={'large'} color={Colors.red800} />
                :
                null
                }

                {showVerifyButton ?
                    <View style={styles.verifyContainerClass}>
                        <View style={styles.buttonContainer}>
                        {!this.state.ssiVerifyInProgress ?
                            <TouchableHighlight style={styles.roundshape}>
                                <IconButton
                                    size={buttonSize}
                                    style={whiteButtonClass}
                                    icon={verifyIcon}
                                    onPress={this.verifyIdentity} />
                            </TouchableHighlight>
                        :
                        <Text style={styles.uri}>Verifying identity...</Text>
                        }
                        {this.state.ssiVerified ?
                            <Text style={styles.ssiSucceeded}>Verified account</Text>
                        : null}

                        </View>
                    </View>

                : null}

                {this.state.ssiVerified === false ?
                    <View style={styles.verifyContainerClass}>
                        <View style={styles.buttonContainer}>
                        <Text style={styles.ssiFailed}>SSI verification failed</Text>
                        </View>
                    </View>
                : null}

                {!this.state.ssiVerifyInProgress ?

                <TrafficStats
                    packetLossQueue = {this.state.packetLossQueue}
                    latencyQueue = {this.state.latencyQueue}
                    audioBandwidthQueue = {this.state.audioBandwidthQueue}
                    videoBandwidthQueue = {this.state.videoBandwidthQueue}
                    isTablet = {this.props.isTablet}
                    audioCodec = {this.props.audioCodec}
                    orientation = {this.props.orientation}
                    media = 'audio'
                />
                : null}

                {this.state.call && ((this.state.call.state === 'accepted' || this.state.call.state === 'established' || this.state.call.state === 'early-media') && !this.state.reconnectingCall) ?
                        <>
                        <View style={buttonContainerClass}>
                            {!disablePlus ?
                                <View style={styles.buttonContainer}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            size={buttonSize}
                                            style={disablePlus ? disabledGreenButtonClass : greenButtonClass}
                                            icon="chat"
                                            onPress={this.props.goBackFunc}
                                            disabled={disablePlus} />
                                    </TouchableHighlight>
                                </View>
                                : null}

                            {!disablePlus ?
                                <View style={styles.buttonContainer}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="account-plus"
                                            onPress={this.props.inviteToConferenceFunc}
                                            disabled={disablePlus} />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={styles.buttonContainer}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        size={buttonSize}
                                        style={whiteButtonClass}
                                        icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                                        onPress={this.muteAudio} />
                                </TouchableHighlight>
                            </View>
                            <View style={styles.buttonContainer}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        size={buttonSize}
                                        style={whiteButtonClass}
                                        icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'headphones'}
                                        onPress={this.props.toggleSpeakerPhone} />
                                </TouchableHighlight>
                            </View>

                            {isPhoneNumber ?
                                <View style={styles.buttonContainer}>
                                    <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            size={buttonSize}
                                            style={whiteButtonClass}
                                            icon="dialpad"
                                            onPress={this.showDtmfModal}
                                            disabled={!(this.state.call && (this.state.call.state === 'early-media' || this.state.call.state === 'accepted' || this.state.call.state === 'established'))} />
                                    </TouchableHighlight>
                                </View>
                                : null}
                            <View style={styles.buttonContainer}>
                                <TouchableHighlight style={styles.roundshape}>
                                    <IconButton
                                        size={buttonSize}
                                        style={hangupButtonClass}
                                        icon="phone-hangup"
                                        onPress={this.hangupCall} />
                                </TouchableHighlight>
                            </View>
                        </View></>
                    :
                    <View style={buttonContainerClass}>
                      <View style={styles.buttonContainer}>
                          <TouchableHighlight style={styles.roundshape}>
                            <IconButton
                                size={buttonSize}
                                style={whiteButtonClass}
                                icon={this.state.audioMuted ? 'microphone-off' : 'microphone'}
                                onPress={this.muteAudio}
                            />
                        </TouchableHighlight>
                      </View>

                      <View style={styles.buttonContainer}>
                          <TouchableHighlight style={styles.roundshape}>
                            <IconButton
                                size={buttonSize}
                                style={whiteButtonClass}
                                icon={this.props.speakerPhoneEnabled ? 'volume-high' : 'headphones'}
                                onPress={this.props.toggleSpeakerPhone}
                            />
                        </TouchableHighlight>
                      </View>
                      <View style={styles.buttonContainer}>
                          <TouchableHighlight style={styles.roundshape}>
                            <IconButton
                                size={buttonSize}
                                style={hangupButtonClass}
                                icon="phone-hangup"
                                onPress={this.cancelCall}
                            />
                        </TouchableHighlight>
                      </View>
                    </View>
                }

                <LoadingScreen
                            text={'Verify identity'}
                            show={false}
                            orientation={this.state.orientation}
                            isTablet={this.state.isTablet}
                            />
                <DTMFModal
                    show={this.state.showDtmfModal}
                    hide={this.hideDtmfModal}
                    call={this.state.call}
                    callKeepSendDtmf={this.props.callKeepSendDtmf}
                />
                <EscalateConferenceModal
                    show={this.state.showEscalateConferenceModal}
                    call={this.state.call}
                    selectedContacts={this.state.selectedContacts}
                    close={this.toggleEscalateConferenceModal}
                    escalateToConference={this.escalateToConference}
                />
            </View>
        );
    }
}

AudioCallBox.propTypes = {
    remoteUri               : PropTypes.string,
    remoteDisplayName       : PropTypes.string,
    photo                   : PropTypes.string,
    call                    : PropTypes.object,
    connection              : PropTypes.object,
    accountId               : PropTypes.string,
    escalateToConference    : PropTypes.func,
    info                    : PropTypes.string,
    hangupCall              : PropTypes.func,
    mediaPlaying            : PropTypes.func,
    callKeepSendDtmf        : PropTypes.func,
    toggleMute              : PropTypes.func,
    toggleSpeakerPhone      : PropTypes.func,
    speakerPhoneEnabled     : PropTypes.bool,
    orientation             : PropTypes.string,
    isTablet                : PropTypes.bool,
    reconnectingCall        : PropTypes.bool,
    muted                   : PropTypes.bool,
    packetLossQueue         : PropTypes.array,
    videoBandwidthQueue     : PropTypes.array,
    audioBandwidthQueue     : PropTypes.array,
    latencyQueue            : PropTypes.array,
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
    callContact             : PropTypes.object,
    selectedContact         : PropTypes.object,
    selectedContacts        : PropTypes.array,
    inviteToConferenceFunc  : PropTypes.func,
    finishInvite            : PropTypes.func,
    audioCodec              : PropTypes.string,
    ssiRemoteIdentity       : PropTypes.object,
    ssiVerifyFunc           : PropTypes.func,
    ssiVerified             : PropTypes.bool,
    ssiCanVerify            : PropTypes.bool,
    ssiVerifyInProgress     : PropTypes.bool
};

export default AudioCallBox;
