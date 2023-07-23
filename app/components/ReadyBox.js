import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { FlatList, View, Platform, TouchableHighlight, TouchableOpacity} from 'react-native';
import { IconButton, Title, Button, Colors, Text  } from 'react-native-paper';

import ConferenceModal from './ConferenceModal';
import ContactsListBox from './ContactsListBox';

import FooterBox from './FooterBox';
import URIInput from './URIInput';
import config from '../config';
import utils from '../utils';
import styles from '../assets/styles/blink/_ReadyBox.scss';
import {Keyboard} from 'react-native';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';

class ReadyBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : '',
            contacts: this.props.contacts,
            selectedContact: this.props.selectedContact,
            showConferenceModal: this.props.showConferenceModal,
            sticky: false,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            historyCategoryFilter: null,
            messagesCategoryFilter: null,
            historyPeriodFilter: null,
            missedCalls: this.props.missedCalls,
            isLandscape: this.props.isLandscape,
            participants: null,
            myInvitedParties: this.props.myInvitedParties,
            messages: this.props.messages,
            myDisplayName: this.props.myDisplayName,
            chat: (this.props.selectedContact !== null) && (this.props.call !== null),
            call: this.props.call,
            inviteContacts: this.props.inviteContacts,
            shareToContacts: this.props.shareToContacts,
            selectedContacts: this.props.selectedContacts,
            pinned: this.props.pinned,
            messageZoomFactor: this.props.messageZoomFactor,
            isTyping: this.props.isTyping,
            navigationItems: this.props.navigationItems,
            fontScale: this.props.fontScale,
            historyFilter: this.props.historyFilter,
            isTablet: this.props.isTablet,
            myContacts: this.props.myContacts,
            showQRCodeScanner: this.props.showQRCodeScanner,
            ssiCredentials: this.props.ssiCredentials,
            ssiConnections: this.props.ssiConnections,
            keys: this.props.keys,
            isTexting: this.props.isTexting,
            keyboardVisible: this.props.keyboardVisible,
            contentTypes: this.props.contentTypes,
            sourceContact: this.props.sourceContact
        };
        this.ended = false;

    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (this.state.selectedContact) {
            this.setState({targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : '', chat: false});
        }

        if (!this.state.inviteContacts && nextProps.inviteContacts) {
            this.handleTargetChange('');
            this.setState({chat: false});
        }

        if (this.state.selectedContact !== nextProps.selectedContact && nextProps.selectedContact) {
            this.setState({chat: !this.chatDisabledForUri(nextProps.selectedContact.uri)});
        }

        if (nextProps.selectedContact !== this.state.selectedContact) {
           this.setState({'messagesCategoryFilter': null});
           if (this.navigationRef && !this.state.selectedContact) {
               this.navigationRef.scrollToIndex({animated: true, index: 0});
           }
           if (this.state.selectedContact && this.state.pinned) {
               this.props.togglePinned(this.state.selectedContact.uri);
           }
        }

        if (!nextProps.historyFilter && this.state.historyFilter) {
            this.filterHistory(null);
        }

        if (nextProps.historyFilter === 'ssi' && !nextProps.selectedContact) {
            this.setState({'historyCategoryFilter': 'ssi'});
            if (this.navigationRef && !this.state.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: this.navigationItems.length-1});
            }
        }

        if (nextProps.missedCalls.length === 0 && this.state.historyCategoryFilter === 'missed') {
            this.setState({'historyCategoryFilter': null});
        }

        if (nextProps.blockedUris.length === 0 && this.state.historyCategoryFilter === 'blocked') {
            this.setState({'historyCategoryFilter': null});
        }

        if (nextProps.favoriteUris.length === 0 && this.state.historyCategoryFilter === 'favorite') {
            this.setState({'historyCategoryFilter': null});
        }

        if (Object.keys(this.state.myContacts).length === 0 && nextProps.myContacts && Object.keys(nextProps.myContacts).length > 0) {
            this.bounceNavigation();
        }

        let newMyContacts = nextProps.myContacts;
        if (nextProps.sourceContact && nextProps.sourceContact.uri in newMyContacts) {
            console.log('Discard contact', nextProps.sourceContact.uri);
            delete newMyContacts[nextProps.sourceContact.uri];
        }

        this.setState({myInvitedParties: nextProps.myInvitedParties,
                        myContacts: newMyContacts,
                        messages: nextProps.messages,
                        historyFilter: nextProps.historyFilter,
                        myDisplayName: nextProps.myDisplayName,
                        call: nextProps.call,
                        showConferenceModal: nextProps.showConferenceModal,
                        isTyping: nextProps.isTyping,
                        navigationItems: nextProps.navigationItems,
                        messageZoomFactor: nextProps.messageZoomFactor,
                        contacts: nextProps.contacts,
                        inviteContacts: nextProps.inviteContacts,
                        shareToContacts: nextProps.shareToContacts,
                        selectedContacts: nextProps.selectedContacts,
                        selectedContact: nextProps.selectedContact,
                        pinned: nextProps.pinned,
                        favoriteUris: nextProps.favoriteUris,
                        blockedUris: nextProps.blockedUris,
                        missedCalls: nextProps.missedCalls,
                        fontScale: nextProps.fontScale,
                        isTablet: nextProps.isTablet,
                        showQRCodeScanner: nextProps.showQRCodeScanner,
                        isLandscape: nextProps.isLandscape,
                        ssiCredentials: nextProps.ssiCredentials,
                        ssiConnections: nextProps.ssiConnections,
                        keys: nextProps.keys,
                        isTexting: nextProps.isTexting,
                        keyboardVisible: nextProps.keyboardVisible,
                        contentTypes: nextProps.contentTypes,
                        sourceContact: nextProps.sourceContact
                        });
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

       //console.log('filterHistory', filter);

       if (this.state.selectedContact) {
           if (!filter && this.state.pinned) {
               this.props.togglePinned(this.state.selectedContact.uri);
           }
           if (filter === 'pinned') {
               this.props.togglePinned(this.state.selectedContact.uri);
               return;
           }

           if (filter === this.state.messagesCategoryFilter) {
               this.setState({'messagesCategoryFilter': null});
           } else {
               this.setState({'messagesCategoryFilter': filter});
           }
           return;
       }

       this.props.filterHistoryFunc(filter);

       if (!filter) {
           this.setState({'historyPeriodFilter': null, historyCategoryFilter: null});
       } else if (filter === 'today' || filter === 'yesterday') {
           filter = this.state.historyPeriodFilter === filter ? null : filter;
           this.setState({'historyPeriodFilter': filter});
       } else {
           this.setState({'historyCategoryFilter': filter});
       }

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

    get showNavigationBar() {
        if (this.state.keyboardVisible) {
            return;
        }

        if (this.state.selectedContact) {
            //return false;
        }
        return true;

    }

    get showSearchBar() {
        if (this.state.selectedContact && !this.state.isTablet) {
            return false;
        }

        if (this.state.showQRCodeScanner) {
            return false;
        }

        if (this.state.isTablet || (!this.state.isLandscape && this.state.selectedContact)) {
            return true;
        }

        if (this.state.call && this.state.call.state !== 'incoming' && !this.state.inviteContacts) {
            return false;
        }

        return true;
    }

    get showButtonsBar() {
        if (this.state.historyCategoryFilter === 'blocked') {
            return false;
        }

        if (this.state.historyCategoryFilter === 'ssi') {
            return false;
        }

        if (this.state.showQRCodeScanner) {
            return false;
        }

        if (this.state.isTablet) {
            return true;
        }

        if (this.state.call) {
            return true;
        }

        if (!this.state.targetUri) {
            return true;
        }

        if (this.state.selectedContact) {
            if (this.state.isLandscape && !this.state.isTablet) {
                return false;
            }
            return false;
        }

        return true;
    }

    handleTargetChange(new_uri, contact) {
        //console.log('---handleTargetChange new_uri =', new_uri);
        //console.log('handleTargetChange contact =', contact);

        if ((this.state.inviteContacts || this.state.shareToContacts) && contact) {
             const uri = contact.uri;
             this.props.updateSelection(uri);
             return;
        }

        // This URLs are used to request SSI credentials
        if (new_uri && new_uri.startsWith('https://didcomm.issuer.bloqzone.com?c_i=')) {
            this.props.handleSSIEnrolment(new_uri);
            return;
        }

        // This URLs are used to request SSI credentials
        if (new_uri && new_uri.startsWith('https://ssimandate.vismaconnect.nl/api/acapy?c_i=')) {
            this.props.handleSSIEnrolment(new_uri);
            return;
        }

        if (contact && contact.tags.indexOf('ssi') > -1 && this.state.selectedContact !== contact) {
            this.setState({'historyCategoryFilter': 'ssi'});
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

        if (new_value.indexOf(' ') === -1) {
            new_value = new_value.trim().toLowerCase();
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

    shareContent() {
        this.props.shareContent();
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

        let uri = this.state.targetUri.trim().toLowerCase();

        if (!this.state.chat && !this.selectedContact && uri) {
            if (uri.indexOf('@') === -1) {
                uri = uri + '@' + this.props.defaultDomain;
            }

            let contact = this.props.newContactFunc(uri, null, {src: 'new chat'});
            console.log('Create synthetic contact', contact);
            this.props.selectContact(contact);
            this.setState({targetUri: uri, chat: true});
            Keyboard.dismiss();
        }

        this.setState({chat: !this.state.chat});
    }

    handleAudioCall(event) {
        event.preventDefault();
        Keyboard.dismiss();
        let uri = this.state.targetUri.trim().toLowerCase();
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
        Keyboard.dismiss();
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
        Keyboard.dismiss();
        this.props.startConference(targetUri, {audio: options.audio, video: options.video, participants: options.participants});
        this.props.hideConferenceModalFunc();
    }

    get chatButtonDisabled() {
        let uri = this.state.targetUri.trim();

        if (this.state.selectedContact) {
            return true;
        }

        if (this.state.shareToContacts) {
            return true;
        }

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

        if (this.state.shareToContacts) {
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

        if (this.state.shareToContacts) {
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
        if (!this.props.canSend()) {
            return true;
        }

        let uri = this.state.targetUri.trim();

        if (uri.indexOf(' ') > -1) {
            return true;
        }

        if (this.state.shareToContacts) {
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

        if (key === "hideQRCodeScanner") {
            return (<Button style={buttonStyle} onPress={() => {this.toggleQRCodeScanner()}}>{title}</Button>);
        }

        return (<Button style={buttonStyle} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }

    bounceNavigation() {
        if (this.ended) {
            return;
        }

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.state.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: Math.floor(this.navigationItems.length / 2)});
            }
        }, 3000);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.state.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: this.navigationItems.length-1});
            }
        }, 4500);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.state.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: 0});
            }
        }, 6000);
    }

    get navigationItems() {
        let conferenceEnabled = Object.keys(this.state.myInvitedParties).length > 0 || this.state.navigationItems['conference'];
        if (this.state.inviteContacts) {
            conferenceEnabled = false;
        }

        if (this.state.showQRCodeScanner) {
            return [
              {key: "hideQRCodeScanner", title: 'Cancel', enabled: true, selected: false}
              ];
        }

        if (this.state.selectedContact) {

            let content_items = [];
            if ('pinned' in this.state.contentTypes) {
                content_items.push({key: 'pinned', title: 'Pinned', enabled: true, selected: this.state.pinned});
            }

            if ('text' in this.state.contentTypes) {
                content_items.push({key: 'text', title: 'Text', enabled: true, selected: this.state.messagesCategoryFilter === 'text'});
            }

            if ('audio' in this.state.contentTypes) {
                content_items.push({key: 'audio', title: 'Audio', enabled: true, selected: this.state.messagesCategoryFilter === 'audio'});
            }

            if ('image' in this.state.contentTypes) {
                content_items.push({key: 'image', title: 'Images', enabled: true, selected: this.state.messagesCategoryFilter === 'image'});
            }

            if ('movie' in this.state.contentTypes) {
                content_items.push({key: 'movie', title: 'Movies', enabled: true, selected: this.state.messagesCategoryFilter === 'movie'});
            }

            if ('failed' in this.state.contentTypes) {
                content_items.push({key: 'failed', title: 'Failed', enabled: true, selected: this.state.messagesCategoryFilter === 'failed'});
            }

            if ('paused' in this.state.contentTypes) {
                content_items.push({key: 'paused', title: 'Paused', enabled: true, selected: this.state.messagesCategoryFilter === 'paused'});
            }

            if ('large' in this.state.contentTypes) {
                content_items.push({key: 'large', title: 'Large', enabled: true, selected: this.state.messagesCategoryFilter === 'large'});
            }

            return content_items;
        }

        return [
              {key: null, title: 'All', enabled: true, selected: false},
              {key: 'history', title: 'Calls', enabled: true, selected: this.state.historyCategoryFilter === 'history'},
              {key: 'chat', title: 'Chat', enabled: true, selected: this.state.historyCategoryFilter === 'chat'},
              {key: 'today', title: 'Today', enabled: this.state.navigationItems['today'], selected: this.state.historyPeriodFilter === 'today'},
              {key: 'yesterday', title: 'Yesterday', enabled: this.state.navigationItems['yesterday'], selected: this.state.historyPeriodFilter === 'yesterday'},
              {key: 'missed', title: 'Missed', enabled: this.state.missedCalls.length > 0, selected: this.state.historyCategoryFilter === 'missed'},
              {key: 'favorite', title: 'Favorites', enabled: this.state.favoriteUris.length > 0, selected: this.state.historyCategoryFilter === 'favorite'},
              {key: 'blocked', title: 'Blocked', enabled: this.state.blockedUris.length > 0, selected: this.state.historyCategoryFilter === 'blocked'},
              {key: 'conference', title: 'Conference', enabled: conferenceEnabled, selected: this.state.historyCategoryFilter === 'conference'},
              {key: 'test', title: 'Test', enabled: !this.state.shareToContacts && !this.state.inviteContacts, selected: this.state.historyCategoryFilter === 'test'},
              {key: 'ssi', title: 'SSI', enabled: (this.state.ssiConnections && this.state.ssiConnections.length > 0) || (this.state.ssiCredentials && this.state.ssiCredentials.length > 0), selected: this.state.historyCategoryFilter === 'ssi'},
              ];
    }

    toggleQRCodeScanner(event) {
        if (event) {
            event.preventDefault();
        }
        console.log('Scan QR code...');
        this.props.toggleQRCodeScannerFunc();
    }

    QRCodeRead(e) {
        //console.log('QR code object:', e);
        console.log('QR code data:', e.data);
        this.props.toggleQRCodeScannerFunc();
        this.handleTargetChange(e.data);
    }

    get showQRCodeButton() {
        if (!this.props.canSend()) {
            return false;
        }
        let uri = this.state.targetUri.toLowerCase();
        return uri.length === 0 && !this.state.shareToContacts && !this.state.inviteContacts;
    }

    render() {
        let URIContainerClass = styles.portraitUriInputBox;
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

        //console.log('RB', this.state.myContacts);

        if (this.state.isTablet) {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTabletTitle : styles.portraitTabletTitle;
        } else {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTitle : styles.portraitTitle;
        }

        if (this.state.isTablet) {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriButtonGroup : styles.portraitTabletUriButtonGroup;
        } else {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeUriButtonGroup : styles.portraitUriButtonGroup;
        }

        if (this.state.isTablet) {
            URIContainerClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriInputBox : styles.portraitTabletUriInputBox;
        } else {
            URIContainerClass = this.props.orientation === 'landscape' ? styles.landscapeUriInputBox : styles.portraitUriInputBox;
        }

        const historyContainer = this.props.orientation === 'landscape' ? styles.historyLandscapeContainer : styles.historyPortraitContainer;
        const buttonGroupClass = this.props.orientation === 'landscape' ? styles.landscapeButtonGroup : styles.buttonGroup;
        const borderClass = this.state.chat ? null : styles.historyBorder;
        let backButtonTitle = 'Back to call';

        const showBackToCallButton = this.state.call && this.state.call.state !== 'incoming' && this.state.call.state !== 'terminated' ? true : false ;

        if (showBackToCallButton) {
            if (this.state.call.hasOwnProperty('_participants')) {
                backButtonTitle = this.state.selectedContacts.length > 0 ? 'Invite people' : 'Back to conference';
            } else {
                backButtonTitle = this.state.selectedContacts.length > 0 ? 'Invite people' : 'Back to call';
            }
        }

        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS             : styles.greenButton;
        let blueButtonClass          = Platform.OS === 'ios' ? styles.blueButtoniOS              : styles.blueButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS     : styles.disabledGreenButton;
        let disabledBlueButtonClass  = Platform.OS === 'ios' ? styles.disabledBlueButtoniOS      : styles.disabledBlueButton;

        return (

            <Fragment>
                <View style={styles.container}>
                    <View >
                        {this.showSearchBar && !this.state.isLandscape ?
                        <View style={URIContainerClass}>
                            <URIInput
                                defaultValue={this.state.targetUri}
                                onChange={this.handleTargetChange}
                                onSelect={this.handleTargetSelect}
                                shareToContacts={this.state.shareToContacts}
                                inviteContacts={this.state.inviteContacts}
                                autoFocus={false}
                            />
                        </View>
                        : null}

                        {this.showButtonsBar ?
                        <View style={uriGroupClass}>
                        {this.showSearchBar && this.state.isLandscape ?
                        <View style={URIContainerClass}>
                            <URIInput
                                defaultValue={this.state.targetUri}
                                onChange={this.handleTargetChange}
                                onSelect={this.handleTargetSelect}
                                shareToContacts={this.state.shareToContacts}
                                inviteContacts={this.state.inviteContacts}
                                autoFocus={false}
                            />
                        </View>
                        : null}
                            {showBackToCallButton ?
                            <View style={buttonGroupClass}>
                                <Button
                                    mode="contained"
                                    style={styles.backButton}
                                    onPress={this.props.goBackFunc}
                                    accessibilityLabel={backButtonTitle}
                                    >{backButtonTitle}
                                </Button>
                            </View>
                                :
                            <View style={buttonGroupClass}>
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                        style={this.chatButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                        size={32}
                                        disabled={this.chatButtonDisabled}
                                        onPress={this.handleChat}
                                        icon="chat"
                                    />
                                    </TouchableHighlight>
                                  </View>
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.callButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.callButtonDisabled}
                                            onPress={this.handleAudioCall}
                                            icon="phone"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.videoButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.videoButtonDisabled}
                                            onPress={this.handleVideoCall}
                                            icon="video"
                                        />
                                    </TouchableHighlight>
                                  </View>

                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={!this.state.shareToContacts ? disabledBlueButtonClass : blueButtonClass}
                                            disabled={!this.state.shareToContacts}
                                            size={32}
                                            onPress={this.shareContent}
                                            icon="share"
                                        />
                                    </TouchableHighlight>
                                  </View>

                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.conferenceButtonDisabled ? disabledBlueButtonClass : blueButtonClass}
                                            disabled={this.conferenceButtonDisabled}
                                            size={32}
                                            onPress={this.showConferenceModal}
                                            icon="account-group"
                                        />
                                    </TouchableHighlight>
                                  </View>


                                 { this.showQRCodeButton ?

                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            onPress={this.toggleQRCodeScanner}
                                            style={styles.qrCodeButton}
                                            disabled={!this.showQRCodeButton}
                                            size={32}
                                            icon="qrcode"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null}
                            </View>
                            }

                        </View>
                        : null}

                    </View>
                    <View style={[historyContainer, borderClass]}>
                      { this.state.showQRCodeScanner &&  !showBackToCallButton ?

                    <QRCodeScanner
                        onRead={this.QRCodeRead}
                        showMarker={true}
                        flashMode={RNCamera.Constants.FlashMode.off}
                        containerStyle={styles.QRcodeContainer}
                     />
                      :

                        <ContactsListBox
                            contacts={this.state.contacts}
                            targetUri={this.state.targetUri}
                            fontScale = {this.state.fontScale}
                            orientation={this.props.orientation}
                            setTargetUri={this.handleTargetChange}
                            selectedContact={this.state.selectedContact}
                            isTablet={this.state.isTablet}
                            chat={this.state.chat && !this.state.inviteContacts}
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
                            saveConference={this.props.saveConference}
                            myInvitedParties = {this.state.myInvitedParties}
                            favoriteUris={this.props.favoriteUris}
                            blockedUris={this.props.blockedUris}
                            filter={this.state.historyCategoryFilter}
                            periodFilter={this.state.historyPeriodFilter}
                            defaultDomain={this.props.defaultDomain}
                            saveContact={this.props.saveContact}
                            myContacts = {this.state.myContacts}
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
                            shareToContacts = {this.state.shareToContacts}
                            selectedContacts = {this.state.selectedContacts}
                            toggleFavorite={this.props.toggleFavorite}
                            toggleBlocked={this.props.toggleBlocked}
                            togglePinned = {this.props.togglePinned}
                            pinned = {this.state.pinned}
                            loadEarlierMessages = {this.props.loadEarlierMessages}
                            newContactFunc = {this.props.newContactFunc}
                            messageZoomFactor = {this.state.messageZoomFactor}
                            isTyping = {this.state.isTyping}
                            call = {this.state.call}
                            ssiCredentials = {this.state.ssiCredentials}
                            ssiConnections = {this.state.ssiConnections}
                            keys = {this.state.keys}
                            downloadFunc = {this.props.downloadFunc}
                            decryptFunc = {this.props.decryptFunc}
                            messagesCategoryFilter = {this.state.messagesCategoryFilter}
                            isTexting = {this.state.isTexting}
                            forwardMessageFunc = {this.props.forwardMessageFunc}
                            requestCameraPermission = {this.props.requestCameraPermission}
                        />
                        }

                    </View>

                    {this.showNavigationBar ?
                    <View style={styles.navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRef = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.state.selectedContact) {
                                      this.navigationRef.current?.scrollToIndex({ index: info.index, animated: true/false });
                                  }
                                });
                              }}
                            data={this.navigationItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
                    </View>
                    : null}

                    {this.state.isTablet && 0?
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
    shareToContacts  : PropTypes.bool,
    showQRCodeScanner      : PropTypes.bool,
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
    hideConferenceModalFunc: PropTypes.func,
    shareContent:  PropTypes.func,
    fetchSharedItems: PropTypes.func,
    filterHistoryFunc:  PropTypes.func,
    historyFilter: PropTypes.string,
    fontScale: PropTypes.number,
    inviteToConferenceFunc: PropTypes.func,
    toggleQRCodeScannerFunc: PropTypes.func,
    myContacts: PropTypes.object,
    handleSSIEnrolment:  PropTypes.func,
    ssiCredentials:  PropTypes.array,
    ssiConnections:  PropTypes.array,
    keys            : PropTypes.object,
    downloadFunc    : PropTypes.func,
    decryptFunc     : PropTypes.func,
    isTexting       :PropTypes.bool,
    keyboardVisible: PropTypes.bool,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func,
    forwardMessageFunc: PropTypes.func,
    sourceContact: PropTypes.object,
    requestCameraPermission: PropTypes.func
};


export default ReadyBox;
