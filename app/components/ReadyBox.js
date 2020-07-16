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
            contacts: this.props.contacts,
            selectedContact: null,
            showConferenceModal: false,
            sticky: false
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
        let new_value = value;

        if (contact) {
            if (this.state.targetUri === contact.uri) {
                new_value = '';
            }
        }

        if (this.state.targetUri === value) {
            new_value = '';
        }

        this.setState({targetUri: new_value,
                       selectedContact: contact});
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
        //utils.timestampedLog('Render ready');
        const defaultDomain = `${config.defaultDomain}`;

        let uriClass = styles.portraitUriInputBox;
        let uriGroupClass = styles.portraitUriButtonGroup;
        let titleClass = styles.portraitTitle;

        const buttonClass = (Platform.OS === 'ios') ? styles.iosButton : styles.androidButton;

        if (this.props.isTablet) {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTabletTitle : styles.portraitTabletTitle;
        } else {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTitle : styles.portraitTitle;
        }

        if (this.props.isTablet) {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriButtonGroup : styles.portraitTabletUriButtonGroup;
        } else {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeUriButtonGroup : styles.portraitUriButtonGroup;
        }

        if (this.props.isTablet) {
            uriClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriInputBox : styles.portraitTabletUriInputBox;
        } else {
            uriClass = this.props.orientation === 'landscape' ? styles.landscapeUriInputBox : styles.portraitUriInputBox;
        }

        const historyClass = this.props.orientation === 'landscape' ? styles.landscapeHistory : styles.portraitHistory;

        return (
            <Fragment>
                <View style={styles.wholeContainer}>
                    <View >

                        {this.props.isTablet?<Title style={titleClass}>Enter address</Title>: null}
                        <View style={uriGroupClass}>
                            <View style={uriClass}>
                                <URIInput
                                    defaultValue={this.state.targetUri}
                                    onChange={this.handleTargetChange}
                                    onSelect={this.handleTargetSelect}
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
                            contacts={this.state.contacts}
                            targetUri={this.state.targetUri}
                            orientation={this.props.orientation}
                            setTargetUri={this.handleTargetChange}
                            selectedContact={this.state.selectedContact}
                            isTablet={this.props.isTablet}
                            account={this.props.account}
                            password={this.props.password}
                            config={this.props.config}
                            refreshHistory={this.props.refreshHistory}
                            localHistory={this.props.localHistory}
                            cacheHistory={this.props.cacheHistory}
                            initialHistory={this.props.initialHistory}
                            myDisplayName={this.props.myDisplayName}
                            myPhoneNumber={this.props.myPhoneNumber}
                        />
                    </View>
                    {this.props.isTablet ?
                    <View style={styles.footer}>
                        <FooterBox />
                    </View>
                        : null}
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
    password        : PropTypes.string.isRequired,
    config          : PropTypes.object.isRequired,
    startCall       : PropTypes.func.isRequired,
    startConference : PropTypes.func.isRequired,
    missedTargetUri : PropTypes.string,
    contacts        : PropTypes.array,
    orientation     : PropTypes.string,
    isTablet        : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    cacheHistory    : PropTypes.func,
    initialHistory  : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string
};


export default ReadyBox;
