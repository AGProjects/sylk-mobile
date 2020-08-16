import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { View, Platform} from 'react-native';
import { IconButton, Title, Button } from 'react-native-paper';

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
            targetUri: '',
            contacts: this.props.contacts,
            selectedContact: null,
            showConferenceModal: false,
            sticky: false,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            historyFilter: null,
            missedCalls: false
        };
    }

    getTargetUri() {
        const defaultDomain = this.props.account.id.substring(this.props.account.id.indexOf('@') + 1);
        return utils.normalizeUri(this.state.targetUri, defaultDomain);
    }

    async componentDidMount() {
        if (this.state.targetUri) {
            console.log('We must call', this.state.targetUri);
        }
    }

    setMissedCalls(flag) {
        this.setState({missedCalls: flag});
    }

    filterHistory(filter) {
       this.setState({'historyFilter': filter});
       this.handleTargetChange('');
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

        if (new_value === '') {
            contact = null;
        }

        this.setState({targetUri: new_value, selectedContact: contact});
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
        event.preventDefault();
        if (this.state.targetUri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(this.state.targetUri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(), {audio: true, video: false});
        }
    }

    handleVideoCall(event) {
        event.preventDefault();
        if (this.state.targetUri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(this.state.targetUri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(), {audio: true, video: true});
        }
    }

    handleConferenceCall(targetUri, options={audio: true, video: true, conference: true}) {
        if (targetUri) {
            this.props.startConference(targetUri, options);
        }
        this.setState({showConferenceModal: false});
    }

    conferenceButtonActive() {
        if (this.state.targetUri.indexOf('@') > -1 &&
            this.state.targetUri.indexOf(config.defaultConferenceDomain) === -1) {
            return false;
        }

        if (this.state.targetUri.match(/^(\+)(\d+)$/)) {
            return false;
        }

        return true;
    }


    render() {
        //utils.timestampedLog('Render ready', this.state.historyFilter);

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
                                    disabled={this.state.targetUri.length === 0 || this.state.targetUri.indexOf('@videoconference') > -1}
                                    onPress={this.handleAudioCall}
                                    icon="phone"
                                />
                                <IconButton
                                    style={buttonClass}
                                    size={34}
                                    disabled={this.state.targetUri.length === 0 || this.state.targetUri.indexOf('@videoconference') > -1}
                                    onPress={this.handleVideoCall}
                                    icon="video"
                                />
                                <IconButton
                                    style={styles.conferenceButton}
                                    disabled={!this.conferenceButtonActive()}
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
                            setMissedCalls={this.setMissedCalls}
                            isTablet={this.props.isTablet}
                            account={this.props.account}
                            password={this.props.password}
                            config={this.props.config}
                            refreshHistory={this.props.refreshHistory}
                            localHistory={this.props.localHistory}
                            cacheHistory={this.props.cacheHistory}
                            serverHistory={this.props.serverHistory}
                            myDisplayName={this.props.myDisplayName}
                            myPhoneNumber={this.props.myPhoneNumber}
                            deleteHistoryEntry={this.props.deleteHistoryEntry}
                            setFavoriteUri={this.props.setFavoriteUri}
                            setBlockedUri={this.props.setBlockedUri}
                            favoriteUris={this.state.favoriteUris}
                            blockedUris={this.state.blockedUris}
                            filter={this.state.historyFilter}
                        />
                    </View>
                    {((this.state.favoriteUris.length > 0 || this.state.blockedUris.length  > 0 ) ||
                      (this.state.favoriteUris.length === 0 && this.state.historyFilter === 'favorite') ||
                      (this.state.blockedUris.length === 0 && this.state.historyFilter === 'blocked') ||
                      (this.state.historyFilter === 'missed')
                      ) ?
                    <View style={styles.historyButtonGroup}>
                       {this.state.historyFilter !== null ? <Button style={styles.historyButton} onPress={() => {this.filterHistory(null)}}>Show all</Button>: null}
                       {(this.state.favoriteUris.length > 0  && this.state.historyFilter !== 'favorite')? <Button style={styles.historyButton} onPress={() => {this.filterHistory('favorite')}}>Favorites</Button> :  null}
                       {(this.state.blockedUris.length > 0 && this.state.historyFilter !== 'blocked')? <Button style={styles.historyButton} onPress={() => {this.filterHistory('blocked')}}>Blocked</Button> : null}
                       {(this.state.missedCalls && this.state.historyFilter !== 'missed')? <Button style={styles.historyButton} onPress={() => {this.filterHistory('missed')}}>Missed</Button> : null}
                    </View>
                    : null}
                    {this.props.isTablet && 0?
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
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    config          : PropTypes.object.isRequired,
    startCall       : PropTypes.func.isRequired,
    startConference : PropTypes.func.isRequired,
    contacts        : PropTypes.array,
    orientation     : PropTypes.string,
    isTablet        : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    cacheHistory    : PropTypes.func,
    serverHistory  : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    deleteHistoryEntry: PropTypes.func,
    setFavoriteUri  : PropTypes.func,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array
};


export default ReadyBox;
