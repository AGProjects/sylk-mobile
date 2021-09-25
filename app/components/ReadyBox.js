import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { FlatList, View, Platform} from 'react-native';
import { IconButton, Title, Button } from 'react-native-paper';

import ConferenceModal from './ConferenceModal';
import ContactsListBox from './ContactsListBox';
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
            showConferenceModal: this.props.showConferenceModal,
            sticky: false,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            historyFilter: null,
            missedCalls: this.props.missedCalls,
            isLandscape: this.props.isLandscape,
            participants: null,
            myInvitedParties: this.props.myInvitedParties,
            messages: this.props.messages,
            myDisplayName: this.props.myDisplayName,
            chat: (this.props.selectedContact !== null) && (this.props.call !== null),
            call: this.props.call,
            inviteContacts: this.props.inviteContacts,
            selectedContacts: this.props.selectedContacts,
            pinned: this.props.pinned,
            messageZoomFactor: this.props.messageZoomFactor,
            isTyping: this.props.isTyping,
            navigationItems: this.props.navigationItems
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
            this.setState({chat: !this.chatDisabledForUri(nextProps.selectedContact.uri)});
        }

        if (nextProps.missedCalls.length === 0 && this.state.historyFilter === 'missed') {
            this.setState({'historyFilter': null});
        }

        if (nextProps.blockedUris.length === 0 && this.state.historyFilter === 'blocked') {
            this.setState({'historyFilter': null});
        }

        if (nextProps.favoriteUris.length === 0 && this.state.historyFilter === 'favorite') {
            this.setState({'historyFilter': null});
        }

        this.setState({myInvitedParties: nextProps.myInvitedParties,
                        messages: nextProps.messages,
                        myDisplayName: nextProps.myDisplayName,
                        call: nextProps.call,
                        showConferenceModal: nextProps.showConferenceModal,
                        isTyping: nextProps.isTyping,
                        navigationItems: nextProps.navigationItems,
                        messageZoomFactor: nextProps.messageZoomFactor,
                        contacts: nextProps.contacts,
                        inviteContacts: nextProps.inviteContacts,
                        selectedContacts: nextProps.selectedContacts,
                        selectedContact: nextProps.selectedContact,
                        pinned: nextProps.pinned,
                        favoriteUris: nextProps.favoriteUris,
                        blockedUris: nextProps.blockedUris,
                        missedCalls: nextProps.missedCalls,
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
        if (this.props.isTablet || this.props.isLandscape) {
            return true;
        }

        if (this.state.call) {
            return false;
        }

        return (this.state.selectedContact ===  null);
    }

    get showButtonsBar() {
        if (this.props.isTablet) {
            return true;
        }

        if (this.props.isLandscape) {
            return true;
        }

        if (this.state.call) {
            return true;
        }

        if (!this.state.targetUri) {
            return false;
        }

        if (this.state.chat && this.state.selectedContact) {
            return false;
        }

        return true;
    }

    handleTargetChange(new_uri, contact) {
        //console.log('---handleTargetChange new_uri =', new_uri);
        //console.log('handleTargetChange contact =', contact);

        if (this.state.inviteContacts && contact) {
             const uri = contact.uri;
             this.props.updateSelection(uri);
             return;
        }

        if (this.state.selectedContact === contact) {
            if (this.state.chat) {
                this.setState({chat: false});
            }
            return;
        } else {
            this.setState({chat: false});
        }

        let new_value = new_uri;

        if (contact) {
            if (this.state.targetUri === contact.uri) {
                new_value = '';
            }
        } else {
            contact = null;
        }

        if (this.state.targetUri === new_uri) {
            new_value = '';
        }

        if (new_value === '') {
            contact = null;
        }

        //new_value = new_value.replace(' ','');

        //console.log('--- Select new contact', contact? contact.uri : null);
        //console.log('--- Select new targetUri', new_value);

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
        this.props.showConferenceModalFunc();
    }

    handleChat(event) {
        event.preventDefault();
        let targetUri;

        if (!this.state.chat && !this.state.selectedContact) {
           targetUri = this.getTargetUri(this.state.targetUri);
           this.setState({targetUri: targetUri});
        }

        console.log('Chat to', targetUri);

        if (!this.state.chat && !this.selectedContact && targetUri) {
            let contact = this.props.newContactFunc(targetUri, null, {src: 'new chat'});
            console.log('Create synthetic contact', contact);
            this.props.selectContact(contact);
            this.setState({targetUri: targetUri, chat: true});
            //this.handleTargetChange(targetUri, contact);
        }

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
        this.props.hideConferenceModalFunc();
    }

    get chatButtonDisabled() {
        let uri = this.state.targetUri.trim();

        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1 || uri.indexOf('@videoconference') > -1) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);
        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        if (this.chatDisabledForUri(uri)) {
            return true;
        }

        return false;
    }

    get callButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1 || uri.indexOf('@videoconference') > -1) {
            return true;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        return false;
    }

    get videoButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1 || uri.indexOf('@videoconference') > -1) {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        return this.callButtonDisabled;
    }

    get conferenceButtonDisabled() {
        let uri = this.state.targetUri.trim();

        if (uri.indexOf(' ') > -1) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@') > -1 && uri.indexOf(config.defaultConferenceDomain) === -1) {
            return true;
        }

        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            if (event === 'call') {
                return true;
            }
        }

        return false;
    }

    renderNavigationItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let buttonStyle = object.item.selected ? styles.navigationButtonSelected : styles.navigationButton;

        return (<Button style={buttonStyle} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
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

        //console.log('Render missed calls', this.state.missedCalls);

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
        let callType = 'Back to call';
        if (this.state.call && this.state.call.hasOwnProperty('_participants')) {
            callType = this.state.selectedContacts.length > 0 ? 'Invite people' : 'Back to conference';
        }

        let navigationMenuData = [
                                  {key: null, title: 'All', enabled: true, selected: false},
                                  {key: 'history', title: 'Calls', enabled: true, selected: this.state.historyFilter === 'history'},
                                  {key: 'chat', title: 'Chat', enabled: true, selected: this.state.historyFilter === 'chat'},
                                  {key: 'today', title: 'Today', enabled: this.state.navigationItems['today'], selected: this.state.historyFilter === 'today'},
                                  {key: 'yesterday', title: 'Yesterday', enabled: this.state.navigationItems['yesterday'], selected: this.state.historyFilter === 'yesterday'},
                                  {key: 'missed', title: 'Missed', enabled: this.state.missedCalls.length > 0, selected: this.state.historyFilter === 'missed'},
                                  {key: 'favorite', title: 'Favorites', enabled: this.state.favoriteUris.length > 0, selected: this.state.historyFilter === 'favorite'},
                                  {key: 'blocked', title: 'Blocked', enabled: this.state.blockedUris.length > 0, selected: this.state.historyFilter === 'blocked'},
                                  {key: 'conference', title: 'Conference', enabled: Object.keys(this.state.myInvitedParties).length > 0 || this.state.navigationItems['conference'], selected: this.state.historyFilter === 'conference'},
                                  {key: 'test', title: 'Test', enabled: true, selected: this.state.historyFilter === 'test'},
                                  ];

        return (
            <Fragment>
                <View style={styles.container}>
                    <View >
                        {this.showSearchBar && !this.props.isLandscape ?
                        <View style={uriClass}>
                            <URIInput
                                defaultValue={this.state.targetUri}
                                onChange={this.handleTargetChange}
                                onSelect={this.handleTargetSelect}
                                autoFocus={false}
                            />
                        </View>
                        : null}
                        {this.showButtonsBar ?
                        <View style={uriGroupClass}>
                        {this.showSearchBar && this.props.isLandscape ?
                        <View style={uriClass}>
                            <URIInput
                                defaultValue={this.state.targetUri}
                                onChange={this.handleTargetChange}
                                onSelect={this.handleTargetSelect}
                                autoFocus={false}
                            />
                        </View>
                        : null}

                            {( this.state.call && this.state.call.state == 'established') ?
                            <View style={buttonGroupClass}>

                                <Button
                                    mode="contained"
                                    style={styles.backButton}
                                    onPress={this.props.goBackFunc}
                                    accessibilityLabel={callType}
                                    >{callType}
                                </Button>
                            </View>
                                :
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
                                    disabled={this.videoButtonDisabled}
                                    onPress={this.handleVideoCall}
                                    icon="video"
                                />
                                <IconButton
                                    style={styles.conferenceButton}
                                    disabled={this.conferenceButtonDisabled}
                                    size={32}
                                    onPress={this.showConferenceModal}
                                    icon="account-group"
                                />
                            </View>
                                }

                        </View>
                                : null}
                    </View>
                    <View style={[historyContainer, borderClass]}>
                        <ContactsListBox
                            contacts={this.state.contacts}
                            targetUri={this.state.targetUri}
                            orientation={this.props.orientation}
                            setTargetUri={this.handleTargetChange}
                            selectedContact={this.state.selectedContact}
                            isTablet={this.props.isTablet}
                            chat={this.state.chat}
                            isLandscape={this.state.isLandscape}
                            account={this.props.account}
                            password={this.props.password}
                            config={this.props.config}
                            refreshHistory={this.props.refreshHistory}
                            refreshFavorites={this.props.refreshFavorites}
                            localHistory={this.props.localHistory}
                            saveHistory={this.props.saveHistory}
                            myDisplayName={this.state.myDisplayName}
                            myPhoneNumber={this.props.myPhoneNumber}
                            saveInvitedParties={this.props.saveInvitedParties}
                            myInvitedParties = {this.state.myInvitedParties}
                            favoriteUris={this.props.favoriteUris}
                            blockedUris={this.props.blockedUris}
                            filter={this.state.historyFilter}
                            defaultDomain={this.props.defaultDomain}
                            saveContact={this.props.saveContact}
                            myContacts = {this.props.myContacts}
                            messages = {this.state.messages}
                            sendMessage = {this.props.sendMessage}
                            reSendMessage = {this.props.reSendMessage}
                            deleteMessages = {this.props.deleteMessages}
                            expireMessage = {this.props.expireMessage}
                            deleteMessage = {this.props.deleteMessage}
                            getMessages = {this.props.getMessages}
                            pinMessage = {this.props.pinMessage}
                            unpinMessage = {this.props.unpinMessage}
                            confirmRead = {this.props.confirmRead}
                            sendPublicKey = {this.props.sendPublicKey}
                            inviteContacts = {this.state.inviteContacts}
                            selectedContacts = {this.state.selectedContacts}
                            toggleFavorite={this.props.toggleFavorite}
                            toggleBlocked={this.props.toggleBlocked}
                            togglePinned = {this.props.togglePinned}
                            pinned = {this.state.pinned}
                            loadEarlierMessages = {this.props.loadEarlierMessages}
                            newContactFunc = {this.props.newContactFunc}
                            messageZoomFactor = {this.state.messageZoomFactor}
                            isTyping = {this.state.isTyping}
                        />
                    </View>

                    { !this.state.selectedContact ?
                    <View style={styles.navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            data={navigationMenuData}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
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
    saveHistory     : PropTypes.func,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    toggleFavorite  : PropTypes.func,
    myInvitedParties: PropTypes.object,
    toggleBlocked   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    defaultDomain   : PropTypes.string,
    saveContact     : PropTypes.func,
    selectContact   : PropTypes.func,
    lookupContacts  : PropTypes.func,
    call            : PropTypes.object,
    goBackFunc      : PropTypes.func,
    messages        : PropTypes.object,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    confirmRead     : PropTypes.func,
    deleteMessage   : PropTypes.func,
    expireMessage   : PropTypes.func,
    getMessages     : PropTypes.func,
    deleteMessages  : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    sendPublicKey   : PropTypes.func,
    inviteContacts  : PropTypes.bool,
    selectedContacts: PropTypes.array,
    updateSelection : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    missedCalls     : PropTypes.array,
    messageZoomFactor: PropTypes.string,
    isTyping:      PropTypes.bool,
    navigationItems: PropTypes.object,
    showConferenceModal: PropTypes.bool,
    showConferenceModalFunc: PropTypes.func,
    hideConferenceModalFunc: PropTypes.func
};


export default ReadyBox;
