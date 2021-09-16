import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { Clipboard, SafeAreaView, View, FlatList, Text } from 'react-native';

import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble } from 'react-native-gifted-chat'
import MessageInfoModal from './MessageInfoModal';
import ShareMessageModal from './ShareMessageModal';
import CustomChatActions from './ChatActions';


import moment from 'moment';
import momenttz from 'moment-timezone';

import styles from '../assets/styles/blink/_ContactsListBox.scss';


class ContactsListBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            accountId: this.props.account ? this.props.account.id : null,
            password: this.props.password,
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            isLandscape: this.props.isLandscape,
            contacts: this.props.contacts,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory,
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
            pinned: this.props.pinned,
            filter: this.props.filter
        }

        this.echoTest = this.props.newContactFunc('4444@sylk.link', 'Test microphone');
        this.echoTest.tags.push('test');

        this.videoTest = this.props.newContactFunc('3333@sylk.link', 'Test video');
        this.videoTest.tags.push('test');

        this.ended = false;
    }

    componentDidMount() {
        this.ended = false;
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

        if (nextProps.blockedUris !== this.state.blockedUris) {
            this.setState({blockedUris: nextProps.blockedUris});
        }

        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({accountId: nextProps.account.id});
        }

        if (nextProps.refreshHistory !== this.state.refreshHistory) {
            this.setState({refreshHistory: nextProps.refreshHistory});
            this.getServerHistory();
        }

        if (nextProps.selectedContact !== this.state.selectedContact) {
            this.setState({selectedContact: nextProps.selectedContact});
            if (nextProps.selectedContact) {
                this.getMessages(nextProps.selectedContact);
            }
        };

        if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
        };

        if (this.state.messages) {
            let renderMessages = [];
            if (this.state.selectedContact) {
                let uri = this.state.selectedContact.uri;
                let username = uri.split('@')[0];
                if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
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
                       filter: nextProps.filter,
                       password: nextProps.password,
                       showMessageModal: nextProps.showMessageModal,
                       message: nextProps.message,
                       inviteContacts: nextProps.inviteContacts,
                       selectedContacts: nextProps.selectedContacts,
                       pinned: nextProps.pinned,
                       targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : nextProps.targetUri
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
        let uri = contact.uri;

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

    setFavoriteUri(uri) {
        return this.props.setFavoriteUri(uri);
    }

    setBlockedUri(uri) {
        return this.props.setBlockedUri(uri);
    }

    renderItem(object) {
        let item = object.item || object;
        let invitedParties = [];
        let uri = item.uri;
        let myDisplayName;

        let username = uri.split('@')[0];

        if (this.state.myContacts && this.state.myContacts.hasOwnProperty(uri)) {
            myDisplayName = this.state.myContacts[uri].name;
        }

        if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(username)) {
            invitedParties = this.state.myInvitedParties[username];
        }

        if (myDisplayName) {
            if (item.name === item.uri || item.name !== myDisplayName) {
                item.name = myDisplayName;
            }
        }

        return(
            <ContactCard
            contact={item}
            setTargetUri={this.setTargetUri}
            chat={this.state.chat}
            orientation={this.props.orientation}
            isTablet={this.props.isTablet}
            isLandscape={this.state.isLandscape}
            contacts={this.state.contacts}
            defaultDomain={this.props.defaultDomain}
            accountId={this.state.accountId}
            favoriteUris={this.state.favoriteUris}
            messages={this.state.renderMessages}
            pinned={this.state.pinned}
            unread={item.unread}
            toggleBlocked={this.props.toggleBlocked}
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
                 uri = contacts[0].uri;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.uri;
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
                 uri = contacts[0].uri;
            } else {
                return;
            }
        } else {
            uri = this.state.selectedContact.uri;
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

    searchedContact(uri) {
        let contacts = [];
        if (uri.indexOf('@') === -1) {
            uri = uri + '@' + this.props.defaultDomain;
        }

        const item = this.props.newContactFunc(uri.toLowerCase());
        item.tags.push('syntetic');
        contacts.push(item);
        return contacts;
    }

    getServerHistory() {
        if (!this.state.accountId) {
            return;
        }
        if (this.ended || !this.state.accountId || this.state.isRefreshing) {
            return;
        }

        this.setState({isRefreshing: true});

        let history = [];
        let localTime;

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
                    elem.id = uuid.v4();

                    if (!elem.tags) {
                        elem.tags = [];
                    }

                    if (elem.remoteParty.indexOf('@conference.') > -1) {
                        return null;
                    }

                    if (elem.remoteParty.split('@')[0] === '3333') {
                        elem.uri = this.videoTest.uri;
                        elem.label = this.videoTest.label;
                    }

                    if (elem.remoteParty.split('@')[0] === '4444') {
                        elem.uri = this.echoTest.uri;
                        elem.label = this.echoTest.label;
                    }

                    if (known.indexOf(elem.uri) > -1) {
                        return null;
                    }

                    known.push(elem.uri);

                    elem.uri = elem.remoteParty.toLowerCase();

                    let username = elem.uri.split('@')[0];
                    let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);
                    let contact_obj;

                    if (elem.displayName) {
                        elem.name = elem.displayName;
                    } else {
                        elem.name = elem.uri;
                    }

                    if (this.state.contacts) {
                        if (isPhoneNumber) {
                            contact_obj = this.findObjectByKey(this.state.contacts, 'uri', username);
                        } else {
                            contact_obj = this.findObjectByKey(this.state.contacts, 'uri', elem.uri);
                        }

                        if (contact_obj) {
                            elem.name = contact_obj.name;
                            elem.photo = contact_obj.photo;
                            elem.label = contact_obj.label;
                            if (isPhoneNumber) {
                                elem.uri = username;
                            }
                            // TODO update icon here
                        } else {
                            elem.photo = null;
                        }
                    }

                    if (elem.uri.indexOf('@guest.') > -1) {
                        elem.uri = elem.name.toLowerCase().replace(/ /g, '') + '@' + elem.uri.split('@')[1];
                    }

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
                        elem.name = elem.uri.split('@')[0];
                        elem.uri = elem.uri.split('@')[0] + '@' + this.props.config.defaultConferenceDomain;
                        elem.conference = true;
                        elem.media = ['audio', 'video', 'chat'];
                    }

                    if (elem.uri === this.state.accountId) {
                        elem.name = this.props.myDisplayName || 'Myself';
                    }

                    if (!elem.media || !Array.isArray(elem.media)) {
                        elem.media = ['audio'];
                    }

                    if (elem.timezone !== undefined) {
                        localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                        elem.startTime = localTime;
                        elem.timestamp = localTime;
                        localTime = momenttz.tz(elem.stopTime, elem.timezone).toDate();
                        elem.stopTime = localTime;
                    }

                    if (elem.direction === 'incoming' && elem.duration === 0) {
                        elem.tags.push('missed');
                    }
                    return elem;
                });

                this.props.saveHistory(history);
                if (this.ended) {
                    return;
                }
                this.setState({isRefreshing: false});
            }
        }, (errorCode) => {
            console.log('Error getting call history from server', errorCode);
        });

        this.setState({isRefreshing: false});
    }

    matchContact(contact, filter='', tags=[]) {
        if (tags.length > 0 && !tags.some(item => contact.tags.includes(item))) {
            return false;
        }

        if (contact.uri.toLowerCase().startsWith(filter.toLowerCase())) {
            return true;
        }

        if (contact.contacts && contact.contacts.toLowerCase().indexOf(filter.toLowerCase()) > -1) {
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
            const showResend = currentMessage.failed;

            if (this.state.targetUri.indexOf('@videoconference') === -1) {
                if (currentMessage.direction === 'outgoing') {
                    if (showResend) {
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
                            if (showResend) {
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
        //console.log('Render contacts with filter', this.state.filter);

        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let messages = this.state.renderMessages;
        let contacts = [];
        Object.keys(this.state.myContacts).forEach((uri) => {
            contacts.push(this.state.myContacts[uri]);
        });

        let chatInputClass;

        if (this.state.selectedContact && this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
            chatInputClass = this.noChatInputToolbar;
        } else if (!this.state.chat) {
            chatInputClass = this.noChatInputToolbar;
        }

        if (this.state.inviteContacts) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
        } else if (this.state.filter === 'favorite') {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri, ['favorite']));
        } else if (this.state.filter === 'blocked') {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri, ['blocked']));
        } else if (this.state.filter === 'missed') {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri) && contact.tags.indexOf('missed') > -1);
        } else {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
            searchExtraItems = searchExtraItems.concat(this.state.contacts);
            searchExtraItems = searchExtraItems.concat(this.videoTest);
            searchExtraItems = searchExtraItems.concat(this.echoTest);

            if (this.state.targetUri && this.state.targetUri.length > 2 && !this.state.selectedContact) {
                matchedContacts = searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri));
            } else if (this.state.selectedContact && this.state.selectedContact.type === 'contact') {
                matchedContacts.push(this.state.selectedContact);
            } else if (this.state.selectedContact) {
                items = [this.state.selectedContact];
            }

            items = items.concat(matchedContacts);
        }

        //console.log('Matched items', items);

        if (this.state.targetUri && items.length == 0) {
            items = items.concat(this.searchedContact(this.state.targetUri));
        }

        const known = [];
        items = items.filter((elem) => {
            if (known.indexOf(elem.uri) <= -1) {
                known.push(elem.uri);
                return elem;
            }
        });

        if (!this.state.targetUri && !this.state.filter && !this.state.inviteContacts) {
            if (!this.findObjectByKey(items, 'uri', this.echoTest.uri)) {
                items.push(this.echoTest);
            }
            if (!this.findObjectByKey(items, 'uri', this.videoTest.uri)) {
                items.push(this.videoTest);
            }
        }

        items.forEach((item) => {
            item.showActions = false;

            if (item.uri === this.echoTest.uri) {
                item.name = this.echoTest.name;
            }

            if (item.uri === this.videoTest.uri) {
                item.name = this.videoTest.name;
            }

            if (item.uri.indexOf('@videoconference.') === -1) {
                item.conference = false;
            } else {
                item.conference = true;
            }

            if (this.state.selectedContacts && this.state.selectedContacts.indexOf(item.uri) > -1) {
                item.selected = true;
            } else {
                item.selected = false;
            }

        });

        let filteredItems = [];
        items.reverse();

        items.forEach((item) => {
            const fromDomain = '@' + item.uri.split('@')[1];
            if (this.state.inviteContacts && item.uri.indexOf('@videoconference.') > -1) {
                return;
            }

            if (item.uri === this.state.accountId && !item.direction) {
                return;
            }

            if (this.state.filter && item.tags.indexOf(this.state.filter) > -1) {
                filteredItems.push(item);
            } else if (this.state.blockedUris.indexOf(item.uri) === -1 && this.state.blockedUris.indexOf(fromDomain) === -1) {
                filteredItems.push(item);
            }
            //console.log(item.timestamp, item.type, item.uri);

        });

        items = filteredItems;
        items.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : -1)

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

        let showLoadEarlier = (this.state.myContacts && this.state.selectedContact && this.state.selectedContact.uri in this.state.myContacts && this.state.myContacts[this.state.selectedContact.uri].totalMessages && this.state.myContacts[this.state.selectedContact.uri].totalMessages > messages.length) ? true: false;

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

ContactsListBox.propTypes = {
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
    saveHistory    : PropTypes.func,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    saveInvitedParties: PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
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
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func
};


export default ContactsListBox;
