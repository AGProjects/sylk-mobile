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
            selectedContact: this.props.selectedContact,
            showConferenceModal: false,
            sticky: false,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            historyFilter: null,
            missedCalls: false,
            isLandscape: this.props.isLandscape,
            participants: null,
            myInvitedParties: this.props.myInvitedParties,
            messages: this.props.messages,
            myDisplayName: this.props.myDisplayName,
            chat: false,
            edit: false
        };
        this.ended = false;
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (this.state.selectedContact && nextProps.selectedContact === null) {
            this.setState({targetUri: '',
                           chat: false});
        }

        if (this.state.selectedContact !== nextProps.selectedContact && nextProps.selectedContact) {
            this.setState({chat: !this.chatDisabledForUri(nextProps.selectedContact.remoteParty)});
        }

        this.setState({myInvitedParties: nextProps.myInvitedParties,
                        messages: nextProps.messages,
                        myDisplayName: nextProps.myDisplayName,
                        selectedContact: nextProps.selectedContact,
                        isLandscape: nextProps.isLandscape});
    }

    getTargetUri(uri) {
        return utils.normalizeUri(uri, this.props.defaultDomain);
    }

    async componentDidMount() {
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
    }

    setMissedCalls(flag) {
        if (this.ended) {
            return;
        }

        this.setState({missedCalls: flag});
    }

    filterHistory(filter) {
        if (this.ended) {
            return;
        }

       this.setState({'historyFilter': filter});
       this.handleTargetChange('');
    }

    chatDisabledForUri(uri) {
        if (uri.indexOf('@videoconference') > -1) {
            return true;
        }
        if (uri.indexOf('@guest') > -1) {
            return true;
        }

        if (uri.indexOf('3333@') > -1) {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            return true;
        }

        return false;
    }

    get showSearchBar() {
        if (this.props.isTablet) {
            return true;
        }
        return (this.state.selectedContact ===  null);
    }

    get showButtonsBar() {
        if (this.props.isTablet) {
            return true;
        }

        if (this.state.chat && this.state.selectedContact) {
            return false;
        }

        return true;
    }

    handleTargetChange(value, contact) {
        if (this.state.selectedContact === contact) {
            this.setState({edit: !this.state.edit});
            if (this.state.chat) {
                this.setState({chat: false});
            }
            return;
        } else {
            this.setState({chat: false});
        }

        let new_value = value;

        if (contact) {
            if (this.state.targetUri === contact.uri) {
                new_value = '';
            }
        } else {
            contact = null;
        }

        if (this.state.targetUri === value) {
            new_value = '';
        }

        if (new_value === '') {
            contact = null;
        }

        new_value = new_value.replace(' ','');

        this.props.selectContact(contact);
        this.setState({targetUri: new_value});
    }

    handleTargetSelect() {
        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable");
            return;
        }

        let uri = this.state.targetUri.toLowerCase();

        if (uri.endsWith(`@${config.defaultConferenceDomain}`)) {
            let participants;
            if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(uri)) {
                participants = this.state.myInvitedParties[uri];
            }
            this.props.startConference(uri, {audio: true, video: true, participants: this.state.participants});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    showConferenceModal(event) {
        event.preventDefault();
        this.setState({showConferenceModal: true});
        return;
    }

    handleChat(event) {
        event.preventDefault();
        if (!this.state.chat && !this.state.selectedContact && this.state.targetUri.toLowerCase().indexOf('@') === -1) {
           this.setState({targetUri: this.getTargetUri(this.state.targetUri)});
        }

        let uri = this.state.targetUri.toLowerCase();
        this.setState({chat: !this.state.chat});
    }

    handleAudioCall(event) {
        event.preventDefault();
        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            uri = uri_parts[4];
            if (event === 'conference') {
                uri = uri.split("@")[0] + '@' + config.defaultConferenceDomain;
            }
        }

        if (uri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(uri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: false});
        }
    }

    handleVideoCall(event) {
        event.preventDefault();
        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            uri = uri_parts[4];
            if (event === 'conference') {
                uri = uri.split("@")[0] + '@' + config.defaultConferenceDomain;
            }
        }

        if (uri.endsWith(`@${config.defaultConferenceDomain}`)) {
            this.props.startConference(uri, {audio: true, video: true});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    handleConferenceCall(targetUri, options={audio: true, video: true, participants: []}) {
        this.props.startConference(targetUri, {audio: options.audio, video: options.video, participants: options.participants});
        this.setState({showConferenceModal: false});
    }

    conferenceButtonActive() {
        if (this.state.targetUri.indexOf('@guest.') > -1) {
            return false;
        }

        if (this.state.targetUri.indexOf('@') > -1 &&
            this.state.targetUri.indexOf(config.defaultConferenceDomain) === -1) {
            return false;
        }

        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            if (event === 'call') {
                return false;
            }
        }

        if (this.state.targetUri.match(/^(\+)(\d+)$/)) {
            return false;
        }

        return true;
    }

    get chatButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (this.chatDisabledForUri(uri)) {
            return true;
        }

        return this.callButtonDisabled;
    }

    get callButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (uri.indexOf(' ') > -1) {
            return true;
        }
        if (uri.length === 0 ||
            uri.indexOf('@videoconference') > -1 ||
            uri.indexOf('@guest') > -1
            ) {
            return true;
            }
        return false;
    }

    render() {
        let uriClass = styles.portraitUriInputBox;
        let uriGroupClass = styles.portraitUriButtonGroup;
        let titleClass = styles.portraitTitle;

        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            uri = uri_parts[4];
            if (event === 'conference') {
                uri = uri.split("@")[0] + '@' + config.defaultConferenceDomain;
            }
        }

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

        const historyContainer = this.props.orientation === 'landscape' ? styles.historyLandscapeContainer : styles.historyPortraitContainer;
        const buttonGroupClass = this.props.orientation === 'landscape' ? styles.landscapeButtonGroup : styles.buttonGroup;
        const borderClass = this.state.chat ? null : styles.historyBorder;

        return (
            <Fragment>
                <View style={styles.container}>
                    <View >
                        {this.showButtonsBar ?
                        <View style={uriGroupClass}>
                            {this.showSearchBar ?
                            <View style={uriClass}>
                                <URIInput
                                    defaultValue={this.state.targetUri}
                                    onChange={this.handleTargetChange}
                                    onSelect={this.handleTargetSelect}
                                    autoFocus={false}
                                />
                            </View>
                            : null}

                            <View style={buttonGroupClass}>
                                <IconButton
                                    style={buttonClass}
                                    size={32}
                                    disabled={this.chatButtonDisabled}
                                    onPress={this.handleChat}
                                    icon="chat"
                                />
                                <IconButton
                                    style={buttonClass}
                                    size={32}
                                    disabled={this.callButtonDisabled}
                                    onPress={this.handleAudioCall}
                                    icon="phone"
                                />
                                <IconButton
                                    style={buttonClass}
                                    size={32}
                                    disabled={this.callButtonDisabled}
                                    onPress={this.handleVideoCall}
                                    icon="video"
                                />
                                <IconButton
                                    style={styles.conferenceButton}
                                    disabled={!this.conferenceButtonActive()}
                                    size={32}
                                    onPress={this.showConferenceModal}
                                    icon="account-group"
                                />
                            </View>
                        </View>
                                : null}
                    </View>
                    <View style={[historyContainer, borderClass]}>
                        <HistoryTileBox
                            contacts={this.state.contacts}
                            targetUri={this.state.targetUri}
                            orientation={this.props.orientation}
                            setTargetUri={this.handleTargetChange}
                            selectedContact={this.state.selectedContact}
                            setMissedCalls={this.setMissedCalls}
                            isTablet={this.props.isTablet}
                            chat={this.state.chat}
                            isLandscape={this.state.isLandscape}
                            account={this.props.account}
                            password={this.props.password}
                            config={this.props.config}
                            refreshHistory={this.props.refreshHistory}
                            refreshFavorites={this.props.refreshFavorites}
                            localHistory={this.props.localHistory}
                            cacheHistory={this.props.cacheHistory}
                            serverHistory={this.props.serverHistory}
                            myDisplayName={this.state.myDisplayName}
                            myPhoneNumber={this.props.myPhoneNumber}
                            deleteHistoryEntry={this.props.deleteHistoryEntry}
                            setFavoriteUri={this.props.setFavoriteUri}
                            saveInvitedParties={this.props.saveInvitedParties}
                            myInvitedParties = {this.state.myInvitedParties}
                            setBlockedUri={this.props.setBlockedUri}
                            favoriteUris={this.props.favoriteUris}
                            blockedUris={this.props.blockedUris}
                            filter={this.state.historyFilter}
                            defaultDomain={this.props.defaultDomain}
                            saveDisplayName={this.props.saveDisplayName}
                            myDisplayNames = {this.props.myDisplayNames}
                            messages = {this.state.messages}
                            sendMessage={this.props.sendMessage}
                            reSendMessage={this.props.reSendMessage}
                            purgeMessages={this.props.purgeMessages}
                            expireMessage = {this.props.expireMessage}
                            deleteMessage = {this.props.deleteMessage}
                            getMessages = {this.props.getMessages}
                            pinMessage = {this.props.pinMessage}
                            unpinMessage = {this.props.unpinMessage}
                            confirmRead = {this.props.confirmRead}
                        />
                    </View>

                    {(((this.state.favoriteUris.length > 0 || this.state.blockedUris.length  > 0 ) ||
                      (this.state.favoriteUris.length === 0 && this.state.historyFilter === 'favorite') ||
                      (this.state.blockedUris.length === 0 && this.state.historyFilter === 'blocked') ||
                      (this.state.historyFilter === 'missed')) &&
                      !this.state.chat) ?
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
                    targetUri={uri}
                    myInvitedParties={this.state.myInvitedParties}
                    selectedContact={this.state.selectedContact}
                    handleConferenceCall={this.handleConferenceCall}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.props.account ? this.props.account.id: null}
                    lookupContacts={this.props.lookupContacts}
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
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    refreshFavorites: PropTypes.bool,
    cacheHistory    : PropTypes.func,
    serverHistory   : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    deleteHistoryEntry: PropTypes.func,
    setFavoriteUri  : PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    defaultDomain   : PropTypes.string,
    saveDisplayName : PropTypes.func,
    selectContact: PropTypes.func,
    lookupContacts  : PropTypes.func,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    purgeMessages   : PropTypes.func,
    confirmRead     : PropTypes.func,
    deleteMessage   : PropTypes.func,
    expireMessage   : PropTypes.func,
    getMessages     : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    selectedContact : PropTypes.object,
    messages        : PropTypes.object
};


export default ReadyBox;
