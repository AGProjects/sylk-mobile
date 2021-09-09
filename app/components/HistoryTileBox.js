import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { Clipboard, SafeAreaView, View, FlatList, Text } from 'react-native';

import HistoryCard from './HistoryCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble } from 'react-native-gifted-chat'
import MessageInfoModal from './MessageInfoModal';
import ShareMessageModal from './ShareMessageModal';
import CustomChatActions from './ChatActions';


import moment from 'moment';
import momenttz from 'moment-timezone';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';


class HistoryTileBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.favoriteContacts = [];

        this.state = {
            serverHistory: this.props.serverHistory,
            localHistory: this.props.localHistory,
            accountId: this.props.account ? this.props.account.id : '',
            password: this.props.password,
            targetUri: this.props.selectedContact ? this.props.selectedContact.remoteParty : this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            isLandscape: this.props.isLandscape,
            contacts: this.props.contacts,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory,
            refreshFavorites: this.props.refreshFavorites,
            selectedContact: this.props.selectedContact,
            myContacts: this.props.myContacts,
            messages: this.props.messages,
            renderMessages: [],
            chat: this.props.chat,
            pinned: false,
            showMessageModal: false,
            message: null,
            showShareMessageModal: false,
            inviteContacts: this.props.inviteContacts,
            selectedContacts: this.props.selectedContacts,
            pinned: this.props.pinned
        }

        const echoTest = {
            remoteParty: '4444@sylk.link',
            displayName: 'Echo test',
            label: 'Test microphone',
            id: uuid.v4(),
            tags: ['test']
            };

        this.echoTest = Object.assign({}, echoTest);

        const videoTest = {
            remoteParty: '3333@sylk.link',
            displayName: 'Video test',
            label: 'Test video',
            id: uuid.v4(),
            tags: ['test']
            };

        this.videoTest = Object.assign({}, videoTest);
        this.ended = false;
    }

    componentDidMount() {
        this.ended = false;
        this.updateFavorites();
    }

    componentWillUnmount() {
        this.ended = true;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {

        if (this.ended) {
            return;
        }

        if (nextProps.myInvitedParties !== this.state.myInvitedParties) {
            this.setState({myInvitedParties: nextProps.myInvitedParties});
        }

        if (nextProps.contacts !== this.state.contacts) {
            this.setState({contacts: nextProps.contacts});
        }

        if (nextProps.favoriteUris !== this.state.favoriteUris) {
            this.setState({favoriteUris: nextProps.favoriteUris});
        }

        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({accountId: nextProps.account.id});
        }

        if (nextProps.refreshHistory !== this.state.refreshHistory) {
            this.setState({refreshHistory: nextProps.refreshHistory});
            this.getServerHistory();
        }

        if (nextProps.refreshFavorites !== this.state.refreshFavorites) {
            this.setState({refreshFavorites: nextProps.refreshFavorites});
            this.updateFavorites();
        }

        if (nextProps.selectedContact !== this.state.selectedContact) {
            this.setState({selectedContact: nextProps.selectedContact});
            if (nextProps.selectedContact) {
                this.getMessages(nextProps.selectedContact);
            }
        };

        if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
            this.getChatContacts();
        };

        if (this.state.messages) {
            let renderMessages = [];
            if (this.state.selectedContact) {
                let uri = this.state.selectedContact.remoteParty;
                let username = uri.split('@')[0];
                if (this.state.selectedContact.remoteParty.indexOf('@videoconference') > -1) {
                    uri = username;
                }

                if (nextProps.messages && nextProps.messages.hasOwnProperty(uri)) {
                    renderMessages = nextProps.messages[uri];
                    if (this.state.renderMessages.length !== renderMessages.length) {
                        this.props.confirmRead(uri);
                    }
                }

                this.setState({renderMessages: GiftedChat.append(renderMessages, [])});
            }
        }

        this.setState({isLandscape: nextProps.isLandscape,
                       chat: nextProps.chat,
                       showMessageModal: nextProps.showMessageModal,
                       message: nextProps.message,
                       inviteContacts: nextProps.inviteContacts,
                       selectedContacts: nextProps.selectedContacts,
                       pinned: nextProps.pinned,
                       targetUri: nextProps.selectedContact ? nextProps.selectedContact.remoteParty : nextProps.targetUri
                       });

    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} onSend={this.onSendFromUser} onSendWithFile={this.onSendWithFile}/>
    )

    onSendFromUser() {
        console.log('On send from user...');
    }

    getMessages(contact) {
        if (!contact) {
            return;
        }
        let uri = contact.remoteParty;

        if (uri.indexOf('@videoconference') > -1) {
            let username = uri.split('@')[0];
            uri = username;
        }

        this.props.getMessages(uri);
    }

    setTargetUri(uri, contact) {
        //console.log('Set target uri uri in history list', uri);
        this.props.setTargetUri(uri, contact);
    }

    deleteHistoryEntry(uri) {
        this.props.deleteHistoryEntry(uri);
        this.props.setTargetUri(uri);
    }

    setFavoriteUri(uri) {
        return this.props.setFavoriteUri(uri);
    }

    setBlockedUri(uri) {
        return this.props.setBlockedUri(uri);
    }

    renderItem(object) {
        let item = object.item || object;
        let invitedParties = [];
        let uri = item.remoteParty;
        let myDisplayName;

        let username = uri.split('@')[0];

        if (this.state.myContacts && this.state.myContacts.hasOwnProperty(uri)) {
            myDisplayName = this.state.myContacts[uri].name;
        }

        if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(username)) {
            invitedParties = this.state.myInvitedParties[username];
        }

        if (myDisplayName) {
            if (item.displayName === item.remoteParty || item.displayName !== myDisplayName) {
                item.displayName = myDisplayName;
            }
        }

        return(
            <HistoryCard
            id={item.id}
            contact={item}
            filter={this.props.filter}
            invitedParties={invitedParties}
            deleteMessages={this.props.deleteMessages}
            setFavoriteUri={this.setFavoriteUri}
            saveInvitedParties={this.saveInvitedParties}
            setBlockedUri={this.setBlockedUri}
            deleteHistoryEntry={this.deleteHistoryEntry}
            setTargetUri={this.setTargetUri}
            orientation={this.props.orientation}
            isTablet={this.props.isTablet}
            isLandscape={this.state.isLandscape}
            contacts={this.state.contacts}
            defaultDomain={this.props.defaultDomain}
            accountId={this.state.accountId}
            favoriteUris={this.state.favoriteUris}
            saveContact={this.props.saveContact}
            myContacts={this.state.myContacts}
            messages={this.state.renderMessages}
            unread={item.unread}
            chat={this.state.chat}
            togglePinned={this.props.togglePinned}
            toggleBlocked={this.props.toggleBlocked}
            pinned={this.state.pinned}
            sendPublicKey={this.props.sendPublicKey}
            />);
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    getLocalHistory() {
        let history = this.state.localHistory;

        let known = [];
        let uri;

        history = history.filter((elem) => {
            uri = elem.remoteParty.toLowerCase();

            if (elem.startTime) {
                elem.startTime = new Date(elem.startTime);
            } else {
                return;
            }

            if (elem.stopTime) {
                elem.stopTime = new Date(elem.stopTime);
            }

            if (uri.indexOf('@videoconference') === -1) {
                return;
            }

            if (known.indexOf(uri) <= -1) {
                elem.type = 'history';
                if (!elem.tags) {
                    elem.tags = [];
                }
                if (elem.tags.indexOf('history') === -1) {
                    elem.tags.push('history');
                }
                if (elem.tags.indexOf('local') === -1) {
                    elem.tags.push('local');
                }

                known.push(uri);
                return elem;
            }
        });

        history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

        return history;
    }

    updateFavorites() {
        let favoriteContacts = [];
        let displayName;
        let label;
        let conference;
        let metadata = '';

        let contacts = this.state.contacts;
        contacts = contacts.concat(this.videoTest);
        contacts = contacts.concat(this.echoTest);

        let currentFavoriteContacts = this.favoriteContacts;

        currentFavoriteContacts.forEach((contact) => {
            if (this.state.favoriteUris.indexOf(contact.remoteParty) === -1) {
                let idx = this.favoriteContacts.indexOf(contact);
                this.favoriteContacts.splice(idx, 1);
            }
        });

        this.state.favoriteUris.forEach((uri) => {
            if (!uri) {
                return;
            }
            uri = uri.toLowerCase();
            const contact_obj = this.findObjectByKey(contacts, 'remoteParty', uri);
            displayName = contact_obj ? contact_obj.displayName : uri;
            label = contact_obj ? contact_obj.label: null;
            conference = false;
            let tags = ['favorite'];

            const history_obj = this.findObjectByKey(this.state.serverHistory, 'remoteParty', uri);
            const startTime = history_obj? history_obj.startTime : null;
            const stopTime = history_obj? history_obj.stopTime : null;
            const duration = history_obj? history_obj.duration : 0;
            let media = history_obj? history_obj.media : ['audio'];
            tags.push('history');

            if (uri.indexOf('@videoconference.') > -1) {
                displayName = uri.split('@')[0];
                const room = uri.split('@')[0];
                uri = room + '@' + this.props.config.defaultConferenceDomain;
                conference = true;
                media = ['audio', 'video', 'chat'];
                tags.push('conference');
                if (this.state.myInvitedParties.hasOwnProperty(room)) {
                    metadata = this.state.myInvitedParties[room].toString();
                }
            }

            const item = {
                remoteParty: uri,
                metadata: metadata,
                displayName: displayName,
                conference: conference,
                media: media,
                startTime: startTime,
                startTime: startTime,
                duration: duration,
                label: label,
                id: uuid.v4(),
                tags: tags
                };
            favoriteContacts.push(item);
        });

        this.favoriteContacts = favoriteContacts;
    }

    closeMessageModal() {
        this.setState({showMessageModal: false, message: null});
    }

    loadEarlierMessages() {
        this.props.loadEarlierMessages();
    }

    onSendWithFile(selectedFile) {
        let uri;
        if (!this.state.selectedContact) {
            if (this.state.targetUri && this.state.chat) {
                 let contacts = this.searchedContact(this.state.targetUri);
                 if (contacts.length !== 1) {
                     return;
                }
                 uri = contacts[0].remoteParty;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.remoteParty;
        }

        let fileData = {
            name: selectedFile.name,
            type: selectedFile.type,
            size: selectedFile.size,
            uri: selectedFile.uri
        };

        console.log('Sending file', fileData);
        //this.props.sendMessage(uri, message);
    }

    onSendMessage(messages) {
        let uri;
        if (!this.state.selectedContact) {
            if (this.state.targetUri && this.state.chat) {
                 let contacts = this.searchedContact(this.state.targetUri);
                 if (contacts.length !== 1) {
                     return;
                }
                 uri = contacts[0].remoteParty;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.remoteParty;
        }
        messages.forEach((message) => {
            /*
              sent: true,
              // Mark the message as received, using two tick
              received: true,
              // Mark the message as pending with a clock loader
              pending: true,
            */
            this.props.sendMessage(uri, message);
        });
        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    getBlockedContacts() {
        let blockedContacts = [];
        let contact_obj;
        let displayName;
        let label;

        let contacts= this.state.contacts
        contacts = contacts.concat(this.videoTest);
        contacts = contacts.concat(this.echoTest);

        this.state.blockedUris.forEach((uri) => {
            contact_obj = this.findObjectByKey(contacts, 'remoteParty', uri);
            displayName = contact_obj ? contact_obj.displayName : uri;
            label = contact_obj ? contact_obj.label: null;

            const item = {
                remoteParty: uri.toLowerCase(),
                displayName: displayName,
                conference: false,
                label: label,
                id: uuid.v4(),
                tags: ['blocked']
                };
            blockedContacts.push(item);
        });

        return blockedContacts;
    }

    getChatContacts() {
        let chatContacts = [];
        let contact_obj;
        let displayName;
        let label;
        //console.log('this.state.chatUris', this.state.chatUris);

        let contacts= this.state.contacts
        //contacts = contacts.concat(this.videoTest);
        //contacts = contacts.concat(this.echoTest);

        const uris = Object.keys(this.state.myContacts);

        uris.forEach((uri) => {
            if (!uri) {
                return;
            }
            contact_obj = this.findObjectByKey(contacts, 'remoteParty', uri);
            displayName = contact_obj ? contact_obj.displayName : uri;
            label = contact_obj ? contact_obj.label: null;

            const item = {
                remoteParty: uri.toLowerCase(),
                displayName: displayName,
                organization: this.state.myContacts[uri].organization,
                unread: this.state.myContacts[uri].unread,
                startTime: this.state.myContacts[uri].timestamp,
                stopTime: this.state.myContacts[uri].timestamp,
                media: ['chat'],
                publicKey: this.state.myContacts[uri].publicKey ? this.state.myContacts[uri].publicKey : null,
                label: label,
                id: uuid.v4(),
                lastMessage: this.state.myContacts[uri].lastMessage,
                tags: contact_obj ? ['chat', 'history'] : ['chat', 'syntetic', 'history']
                };
            chatContacts.push(item);
        });

        //console.log('chatContacts', chatContacts);

        return chatContacts;
    }

    searchedContact(uri) {
        let contacts = [];
        let displayName = uri;

        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.props.defaultDomain;
        }
        const item = {
            remoteParty: uri.toLowerCase(),
            displayName: displayName,
            conference: false,
            id: uuid.v4(),
            tags: ['syntetic']
            };
        contacts.push(item);
        return contacts;
    }

    getServerHistory() {
        if (this.ended || !this.state.accountId || this.state.isRefreshing) {
            return;
        }

        this.setState({isRefreshing: true});

        //utils.timestampedLog('Requesting call history from server ------');

        let history = [];
        let localTime;
        let hasMissedCalls = false;

        let getServerCallHistory = new DigestAuthRequest(
            'GET',
            `${this.props.config.serverCallHistoryUrl}?action=get_history&realm=${this.state.accountId.split('@')[1]}`,
            this.state.accountId.split('@')[0],
            this.state.password
        );

        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                console.log('Error getting call history from server', data.error_message);
                return;
            }

            if (data.received) {
                data.received.map(elem => {elem.direction = 'incoming'; return elem});
                history = history.concat(data.received);
            }

            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'outgoing'; return elem});
                history = history.concat(data.placed);
            }

            history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

            if (history) {
                const known = [];
                history = history.filter((elem) => {
                    elem.conference = false;

                    if (!elem.tags) {
                        elem.tags = [];
                    }

                    if (elem.remoteParty.indexOf('@conference.') > -1) {
                        return null;
                    }

                    if (elem.remoteParty.split('@')[0] === '3333') {
                        elem.displayName = this.videoTest.displayName;
                        elem.remoteParty = this.videoTest.remoteParty;
                        elem.label = this.videoTest.label;
                    }

                    if (elem.remoteParty.split('@')[0] === '4444') {
                        elem.displayName = this.echoTest.displayName;
                        elem.remoteParty = this.echoTest.remoteParty;
                        elem.label = this.echoTest.label;
                    }

                    if (known.indexOf(elem.remoteParty) > -1) {
                        return null;
                    }

                    known.push(elem.remoteParty);

                    elem.remoteParty = elem.remoteParty.toLowerCase();

                    let username = elem.remoteParty.split('@')[0];
                    let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);
                    let contact_obj;

                    if (this.state.contacts) {
                        if (isPhoneNumber) {
                            contact_obj = this.findObjectByKey(this.state.contacts, 'remoteParty', username);
                        } else {
                            contact_obj = this.findObjectByKey(this.state.contacts, 'remoteParty', elem.remoteParty);
                        }
                    }

                    if (contact_obj) {
                        elem.displayName = contact_obj.displayName;
                        elem.photo = contact_obj.photo;
                        elem.label = contact_obj.label;
                        if (isPhoneNumber) {
                            elem.remoteParty = username;
                        }
                        // TODO update icon here
                    } else {
                        elem.photo = null;
                    }

                    if (elem.remoteParty.indexOf('@guest.') > -1) {
                        elem.remoteParty = elem.displayName.toLowerCase().replace(/ /g, '') + '@' + elem.remoteParty.split('@')[1];
                    }

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
                        elem.displayName = elem.remoteParty.split('@')[0];
                        elem.remoteParty = elem.remoteParty.split('@')[0] + '@' + this.props.config.defaultConferenceDomain;
                        elem.conference = true;
                        elem.media = ['audio', 'video', 'chat'];
                    }

                    if (elem.remoteParty === this.state.accountId) {
                        elem.displayName = this.props.myDisplayName || 'Myself';
                    }

                    elem.type = 'history';
                    elem.id = uuid.v4();

                    if (elem.tags.indexOf('history') === -1) {
                        elem.tags.push('history');
                    }

                    if (!elem.displayName) {
                        elem.displayName = elem.remoteParty;
                    }

                    if (!elem.media || !Array.isArray(elem.media)) {
                        elem.media = ['audio'];
                    }

                    //localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                    //moment(localTime).format('YYYY-MM-DD HH:mm:ss');

                    if (elem.timezone !== undefined) {
                        localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                        elem.startTime = localTime;
                        localTime = momenttz.tz(elem.stopTime, elem.timezone).toDate();
                        elem.stopTime = localTime;
                    }

                    if (elem.direction === 'received' && elem.duration === 0) {
                        elem.tags.push('missed');
                        hasMissedCalls = true;
                    }
                    return elem;
                });

                this.props.cacheHistory(history);
                if (this.ended) {
                    return;
                }
                this.setState({serverHistory: history, isRefreshing: false});
                this.props.setMissedCalls(hasMissedCalls);
            }
        }, (errorCode) => {
            console.log('Error getting call history from server', errorCode);
        });

        this.setState({isRefreshing: false});
    }

    matchContact(contact, filter='') {
        if (contact.remoteParty.toLowerCase().startsWith(filter.toLowerCase())) {
            return true;
        }

        if (contact.displayName && contact.displayName.toLowerCase().indexOf(filter.toLowerCase()) > -1) {
            return true;
        }

        if (!this.state.selectedContact && contact.conference && contact.metadata && filter.length > 2 && contact.metadata.indexOf(filter) > -1) {
            return true;
        }

        return false;
    }

    noChatInputToolbar () {
        return null;
    }

    onLongMessagePress(context, currentMessage) {
        if (currentMessage && currentMessage.text) {
            let options = ['Copy']
            options.push('Delete');

            if (this.state.targetUri.indexOf('@videoconference') === -1) {
                if (currentMessage.direction === 'outgoing') {
                    if (currentMessage.failed) {
                        options.push('Resend')
                    }
                }
            }

            if (currentMessage.pinned) {
                options.push('Unpin');
            } else {
                options.push('Pin');
            }

            options.push('Share');
            options.push('Info');
            options.push('Cancel');

            const cancelButtonIndex = options.length - 1;
            const infoButtonIndex = options.length - 2;
            const shareButtonIndex = options.length - 3;
            const pinButtonIndex = options.length - 4;

            context.actionSheet().showActionSheetWithOptions({
                options,
                cancelButtonIndex,
            }, (buttonIndex) => {
                switch (buttonIndex) {
                    case 0:
                        Clipboard.setString(currentMessage.text);
                        break;
                    case 1:
                        this.props.deleteMessage(currentMessage._id, this.state.targetUri);
                        break;
                    case pinButtonIndex:
                        if (currentMessage.pinned) {
                            this.props.unpinMessage(currentMessage._id);
                        } else {
                            this.props.pinMessage(currentMessage._id);
                        }
                        break;
                    case infoButtonIndex:
                        this.setState({message: currentMessage,
                                       showMessageModal: true});

                        break;
                    case shareButtonIndex:
                        this.setState({message: currentMessage,
                                       showShareMessageModal: true
                                       });
                        break;
                    case 2:
                        if (this.state.targetUri.indexOf('@videoconference') === -1) {
                            if (currentMessage.failed) {
                                this.props.reSendMessage(currentMessage, this.state.targetUri);
                            }
                        }

                        break;
                    default:
                        break;
                }
            });
        }
    };

    shouldUpdateMessage(props, nextProps) {
        return true;
    }

    toggleShareMessageModal() {
        this.setState({showShareMessageModal: !this.state.showShareMessageModal});
    }

    renderMessageBubble (props) {
        let rightColor = '#0084ff';
        let leftColor = '#f0f0f0';

        if (props.currentMessage.failed) {
            rightColor = 'red';
        } else {
            if (props.currentMessage.pinned) {
                rightColor = '#2ecc71';
                leftColor = '#2ecc71';
            }
        }

        return (
          <Bubble
            {...props}
            wrapperStyle={{
              right: {
                backgroundColor: rightColor
              },
              left: {
                backgroundColor: leftColor
              }
            }}
          />
        )
    }

    get showChat() {
       if (this.props.selectedContact && this.props.selectedContact.tags && this.props.selectedContact.tags.indexOf('blocked') > -1) {
           return false;
       }

       if (this.props.selectedContact || this.state.targetUri) {
           return true;
       }

       return false;
    }

    render() {
        //console.log('Render contacts');

        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let messages = this.state.renderMessages;
        let chatContacts = this.getChatContacts();
        let history = [];

        history = history.concat(this.getLocalHistory());
        history = history.concat(this.state.serverHistory);

        let historyContacts = [];
        let duplicates = [];
        history.forEach((item) => {
            historyContacts = chatContacts.filter(chatItem => this.matchContact(chatItem, item.remoteParty));
            if (historyContacts.length > 0) {
                historyContacts.forEach((c) => {

                    c.direction = item.direction;
                    if (!c.stopTime || item.stopTime > c.stopTime) {
                        c.stopTime = item.stopTime;
                        c.startTime = item.startTime;
                        c.timezone = item.timezone;
                    }

                    c.displayName = c.displayName || item.displayName;
                    c.photo = c.photo || item.photo;
                    c.media = item.media;
                    item.tags.forEach((t) => {
                        if (c.tags.indexOf(t) === -1) {
                            c.tags.push(t);
                        }
                    });
                    duplicates.push(item.id);
                });
            }
        });

        history = history.filter(historyItem => duplicates.indexOf(historyItem.id) === -1);

        let chatInputClass;

        if (this.state.selectedContact && this.state.selectedContact.remoteParty.indexOf('@videoconference') > -1) {
            chatInputClass = this.noChatInputToolbar;
        } else if (!this.state.chat) {
            chatInputClass = this.noChatInputToolbar;
        }

        if (this.state.inviteContacts) {
            items = chatContacts.filter(chatItem => this.matchContact(chatItem, this.state.targetUri));
        } else if (this.props.filter === 'favorite') {
            items = this.favoriteContacts.filter(historyItem => this.matchContact(historyItem, this.state.targetUri));
        } else if (this.props.filter === 'blocked') {
            let blockedContacts = this.getBlockedContacts();
            items = blockedContacts.filter(historyItem => this.matchContact(historyItem, this.state.targetUri));
        } else if (this.props.filter === 'missed') {
            items = chatContacts.filter(chatItem => this.matchContact(chatItem, this.state.targetUri) && chatItem.tags.indexOf('missed') > -1);
            items.concat(history.filter(historyItem => this.matchContact(historyItem, this.state.targetUri) && historyItem.tags.indexOf('missed') > -1));
        } else {
            items = chatContacts.filter(chatItem => this.matchContact(chatItem, this.state.targetUri));
            searchExtraItems = searchExtraItems.concat(this.state.contacts);
            searchExtraItems = searchExtraItems.concat(this.favoriteContacts);
            searchExtraItems = searchExtraItems.concat(this.videoTest);
            searchExtraItems = searchExtraItems.concat(this.echoTest);

            history = history.filter(historyItem => this.matchContact(historyItem, this.state.targetUri));
            items = items.concat(history);

            if (this.state.targetUri && this.state.targetUri.length > 2 && !this.state.selectedContact) {
                matchedContacts = searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri));
            } else if (this.state.selectedContact && this.state.selectedContact.type === 'contact') {
                matchedContacts.push(this.state.selectedContact);
            } else if (this.state.selectedContact) {
                items = [this.state.selectedContact];
            }

            items = items.concat(matchedContacts);
        }

        if (this.state.targetUri && items.length == 0) {
            items = items.concat(this.searchedContact(this.state.targetUri));
        }

        const known = [];
        items.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)
        items = items.filter((elem) => {
            if (known.indexOf(elem.remoteParty) <= -1) {
                known.push(elem.remoteParty);
                return elem;
            }
        });

        if (!this.state.targetUri && !this.props.filter && !this.state.inviteContacts) {
            if (!this.findObjectByKey(items, 'remoteParty', this.echoTest.remoteParty)) {
                items.push(this.echoTest);
            }
            if (!this.findObjectByKey(items, 'remoteParty', this.videoTest.remoteParty)) {
                items.push(this.videoTest);
            }
        }

        items.forEach((item) => {
            item.showActions = false;

            if (!item.tags) {
                item.tags = [];
            }

            if (!Array.isArray(item.unread)) {
                item.unread = [];
            }

            if (this.state.favoriteUris.indexOf(item.remoteParty) > -1 && item.tags.indexOf('favorite') === -1) {
                item.tags.push('favorite');
            }

            if (this.state.blockedUris.indexOf(item.remoteParty) > -1 && item.tags.indexOf('blocked') === -1) {
                item.tags.push('blocked');
            }

            let idx = item.tags.indexOf('blocked');
            if (this.state.blockedUris.indexOf(item.remoteParty) === -1 && idx > -1) {
                item.tags.splice(idx, 1);
            }

            idx = item.tags.indexOf('favorite');

            if (this.state.favoriteUris.indexOf(item.remoteParty) === -1 && idx > -1) {
                item.tags.splice(idx, 1);
            }

            if (item.remoteParty.indexOf('@videoconference.') === -1) {
                item.conference = false;
            } else {
                item.conference = true;
            }

            if (this.state.selectedContacts && this.state.selectedContacts.indexOf(item.remoteParty) > -1) {
                item.selected = true;
            } else {
                item.selected = false;
            }

        });

        let filteredItems = [];
        items.reverse();

        items.forEach((item) => {
            const fromDomain = '@' + item.remoteParty.split('@')[1];
            if (this.state.inviteContacts && item.remoteParty.indexOf('@videoconference.') > -1) {
                return;
            }
            if (this.props.filter && item.tags.indexOf(this.props.filter) > -1) {
                filteredItems.push(item);
            } else if (this.state.blockedUris.indexOf(item.remoteParty) === -1 && this.state.blockedUris.indexOf(fromDomain) === -1) {
                filteredItems.push(item);
            }
            //console.log(item.startTime, item.type, item.remoteParty);

        });

        items = filteredItems;
        items.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

        if (items.length === 1) {
            //console.log(items[0]);
            items[0].showActions = true;
        }

        let columns = 1;

        if (this.props.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        const contactsContainer = this.props.orientation === 'landscape' ? styles.contactsLandscapeContainer : styles.contactsPortraitContainer;
        const borderClass = (messages.length > 0 && !this.state.chat) ? styles.chatBorder : null;

        if (items.length === 1) {
            items[0].unread = [];
            if (items[0].tags.toString() === 'syntetic') {
                messages = [];
            }
        }

        let pinned_messages = []
        if (this.state.pinned) {
            messages.forEach((m) => {
                if (m.pinned) {
                    pinned_messages.push(m);
                }
            });
            messages = pinned_messages;
            if (pinned_messages.length === 0) {
                let msg = {
                    _id: uuid.v4(),
                    text: 'No pinned messages found. Touch individual messages to pin them.',
                    system: true
                }
                pinned_messages.push(msg);
            }
        }

        let showLoadEarlier = (this.state.myContacts && this.state.selectedContact && this.state.selectedContact.remoteParty in this.state.myContacts && this.state.myContacts[this.state.selectedContact.remoteParty].totalMessages && this.state.myContacts[this.state.selectedContact.remoteParty].totalMessages > messages.length) ? true: false;

        return (
            <SafeAreaView style={container}>
              {items.length === 1 ?
              (this.renderItem(items[0]))
             :
              <FlatList
                horizontal={false}
                numColumns={columns}
                onRefresh={this.getServerHistory}
                onLongPress={this.onLongMessagePress}
                refreshing={this.state.isRefreshing}
                renderBubble={this.renderMessageBubble}
                data={items}
                renderItem={this.renderItem}
                listKey={item => item.id}
                key={this.props.orientation}
                loadEarlier
             />
             }

             {this.showChat ?
             <View style={[chatContainer, borderClass]}>
                <GiftedChat
                  messages={messages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onLongMessagePress}
                  renderActions={this.renderCustomActions}
                  renderInputToolbar={chatInputClass}
                  renderBubble={this.renderMessageBubble}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  scrollToBottom={true}
                  inverted={false}
                  timeTextStyle={{ left: { color: 'red' }, right: { color: 'yellow' } }}
                  infiniteScroll
                  loadEarlier={showLoadEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                />
              </View>
              : (items.length === 1) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat
                  messages={messages}
                  renderInputToolbar={() => { return null }}
                  renderBubble={this.renderBubble}
                  onSend={this.onSendMessage}
                  onLongPress={this.onLongMessagePress}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  onPress={this.onLongMessagePress}
                  scrollToBottom={true}
                  inverted={false}
                  timeTextStyle={{ left: { color: 'red' }, right: { color: 'yellow' } }}
                  infiniteScroll
                  loadEarlier={showLoadEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                />
              </View>
              : null
              }

            <MessageInfoModal
                show={this.state.showMessageModal}
                message={this.state.message}
                close={this.closeMessageModal}
            />

            <ShareMessageModal
                show={this.state.showShareMessageModal}
                message={this.state.message}
                close={this.toggleShareMessageModal}
            />

            </SafeAreaView>
        );
    }
}

HistoryTileBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    config          : PropTypes.object.isRequired,
    targetUri       : PropTypes.string,
    selectedContact : PropTypes.object,
    contacts        : PropTypes.array,
    chat            : PropTypes.bool,
    orientation     : PropTypes.string,
    setTargetUri    : PropTypes.func,
    isTablet        : PropTypes.bool,
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    refreshFavorites: PropTypes.bool,
    cacheHistory    : PropTypes.func,
    serverHistory   : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    saveInvitedParties: PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    deleteHistoryEntry : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    setMissedCalls  : PropTypes.func,
    filter          : PropTypes.string,
    defaultDomain   : PropTypes.string,
    saveContact     : PropTypes.func,
    myContacts      : PropTypes.object,
    messages        : PropTypes.object,
    getMessages     : PropTypes.func,
    confirmRead     : PropTypes.func,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    deleteMessage   : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    deleteMessages   : PropTypes.func,
    sendPublicKey   : PropTypes.func,
    inviteContacts  : PropTypes.bool,
    selectedContacts: PropTypes.array,
    toggleBlocked   : PropTypes.func,
    togglePinned    : PropTypes.func,
    loadEarlierMessages: PropTypes.func
};


export default HistoryTileBox;
