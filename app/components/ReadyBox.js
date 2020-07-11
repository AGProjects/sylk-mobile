import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
// import VizSensor     = require('react-visibility-sensor').default;
import autoBind from 'auto-bind';
import { View, Platform} from 'react-native';
import { IconButton, Title } from 'react-native-paper';

import ConferenceModal from './ConferenceModal';
import HistoryTileBox from './HistoryTileBox';
import FooterBox from './FooterBox';
import URIInput from './URIInput';
import config from '../config';
import utils from '../utils';

import styles from '../assets/styles/blink/_ReadyBox.scss';

class ReadyBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            targetUri: this.props.missedTargetUri,
            showConferenceModal: false,
            sticky: false,
            matchedContacts: []
        };
    }

    getTargetUri() {
        const defaultDomain = this.props.account.id.substring(this.props.account.id.indexOf('@') + 1);
        return utils.normalizeUri(this.state.targetUri, defaultDomain);
    }

    async componentDidMount() {
        //console.log('Ready now');
        if (this.state.targetUri) {
            console.log('We must call', this.state.targetUri);
        }
    }

    handleTargetChange(value, contact) {
        let matchedContacts = [];
        let new_value = value;

        if (contact) {
            if (this.state.targetUri != contact.uri) {
                matchedContacts = matchedContacts.concat(contact);
            } else {
                new_value = '';
            }
        }

        if (this.state.targetUri) {
            let currentUri = this.getTargetUri();
            if (currentUri.trim() === value.trim()) {
                new_value = '';
            }
        }

        if (new_value.length > 2 && !contact) {
            matchedContacts = this.props.contacts.filter(contact => (contact.uri.toLowerCase().search(new_value) > -1 || contact.name.toLowerCase().search(new_value) > -1));
        }

        this.setState({targetUri: new_value, matchedContacts: matchedContacts});
        //this.forceUpdate();
    }

    handleTargetSelect() {
        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable", {timeout: 2});
            return;
        }
        // the user pressed enter, start a video call by default
        if (this.state.targetUri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(this.state.targetUri, {audio: true, video: true});
        } else {
            this.props.startCall(this.getTargetUri(), {audio: true, video: true});
        }
    }

    showConferenceModal(event) {
        event.preventDefault();
        if (this.state.targetUri.length !== 0) {
            const uri = `${this.state.targetUri.split('@')[0].replace(/[\s()-]/g, '')}@${config.defaultConferenceDomain}`;
            this.handleConferenceCall(uri.toLowerCase());
        } else {
            this.setState({showConferenceModal: true});
        }
    }

    handleAudioCall(event) {
        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable", {timeout: 2});
            return;
        }
        event.preventDefault();
        if (this.state.targetUri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(this.state.targetUri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(), {audio: true, video: false});
        }
    }

    handleVideoCall(event) {
        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable", {timeout: 2});
            return;
        }
        event.preventDefault();
        if (this.state.targetUri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(this.state.targetUri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(), {audio: true, video: true});
        }
    }

    handleConferenceCall(targetUri, options={audio: true, video: true}) {
        if (targetUri) {
            if (!options.video) {
                console.log('ReadyBox: Handle audio only conference call to',targetUri);
            } else {
                console.log('ReadyBox: Handle video conference call to',targetUri);
            }
            this.props.startConference(targetUri, options);
        }

        this.setState({showConferenceModal: false});
    }

    render() {
        //console.log('Render ready box');
        const defaultDomain = `${config.defaultDomain}`;

        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;
        const uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeUriButtonGroup : styles.portraitUriButtonGroup;
        const uriClass = this.props.orientation === 'landscape' ? styles.landscapeUriInputBox : styles.portraitUriInputBox;
        const titleClass = this.props.orientation === 'landscape' ? styles.landscapeTitle : styles.portraitTitle;
        const historyClass = this.props.orientation === 'landscape' ? styles.landscapeHistory : styles.portraitHistory;

        // Join URIs from local and server history for input
        let history = this.props.history.concat(
            this.props.serverHistory.map(e => e.remoteParty)
        );

        history = [...new Set(history)];
        //console.log('history from server is', this.props.serverHistory);
        const placehoder = 'Enter a SIP address like alice@' + defaultDomain;

        let historyItems = this.props.serverHistory.filter(historyItem => historyItem.remoteParty.startsWith(this.state.targetUri))

        return (
            <Fragment>
                <View style={styles.wholeContainer}>
                    <View style={styles.container}>
                        <Title style={titleClass}>Enter address or phone number</Title>
                        <View style={uriGroupClass}>
                            <View style={uriClass}>
                                <URIInput
                                    defaultValue={this.state.targetUri}
                                    data={history}
                                    onChange={this.handleTargetChange}
                                    onSelect={this.handleTargetSelect}
                                    placeholder={placehoder}
                                    autoFocus={false}
                                />
                            </View>
                            <View style={styles.buttonGroup}>
                                <IconButton
                                    style={buttonClass}
                                    size={34}
                                    disabled={this.state.targetUri.length === 0}
                                    onPress={this.handleAudioCall}
                                    icon="phone"
                                />
                                <IconButton
                                    style={buttonClass}
                                    size={34}
                                    disabled={this.state.targetUri.length === 0}
                                    onPress={this.handleVideoCall}
                                    icon="video"
                                />
                                <IconButton
                                    style={styles.conferenceButton}
                                    size={34}
                                    onPress={this.showConferenceModal}
                                    icon="account-group"
                                />
                            </View>
                        </View>
                    </View>
                    <View style={historyClass}>
                        <HistoryTileBox
                            historyItems={historyItems}
                            contactItems={this.state.matchedContacts}
                            orientation={this.props.orientation}
                            setTargetUri={this.handleTargetChange}
                            startVideoCall={this.handleVideoCall}
                            startAudioCall={this.handleAudioCall}
                        />
                    </View>
                    <View style={styles.footer}>
                        <FooterBox />
                    </View>
                </View>
                <ConferenceModal
                    show={this.state.showConferenceModal}
                    targetUri={this.state.targetUri}
                    handleConferenceCall={this.handleConferenceCall}
                />
            </Fragment>
        );
    }
}


ReadyBox.propTypes = {
    account         : PropTypes.object.isRequired,
    startCall       : PropTypes.func.isRequired,
    startConference : PropTypes.func.isRequired,
    missedTargetUri : PropTypes.string,
    history         : PropTypes.array,
    serverHistory   : PropTypes.array,
    orientation     : PropTypes.string,
    contacts        : PropTypes.array
};


export default ReadyBox;
