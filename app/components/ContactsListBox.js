import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { Clipboard, SafeAreaView, View, FlatList, Text, Linking, PermissionsAndroid, Switch} from 'react-native';

import ContactCard from './ContactCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';
import { GiftedChat, IMessage, Bubble, MessageText } from 'react-native-gifted-chat'
import MessageInfoModal from './MessageInfoModal';
import ShareMessageModal from './ShareMessageModal';
import CustomChatActions from './ChatActions';
import FileViewer from 'react-native-file-viewer';

import moment from 'moment';
import momenttz from 'moment-timezone';
//import Video from 'react-native-video';
const RNFS = require('react-native-fs');
import CameraRoll from "@react-native-community/cameraroll";

import styles from '../assets/styles/blink/_ContactsListBox.scss';


String.prototype.toDate = function(format)
{
  var normalized      = this.replace(/[^a-zA-Z0-9]/g, '-');
  var normalizedFormat= format.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-');
  var formatItems     = normalizedFormat.split('-');
  var dateItems       = normalized.split('-');

  var monthIndex  = formatItems.indexOf("mm");
  var dayIndex    = formatItems.indexOf("dd");
  var yearIndex   = formatItems.indexOf("yyyy");
  var hourIndex     = formatItems.indexOf("hh");
  var minutesIndex  = formatItems.indexOf("ii");
  var secondsIndex  = formatItems.indexOf("ss");

  var today = new Date();

  var year  = yearIndex>-1  ? dateItems[yearIndex]    : today.getFullYear();
  var month = monthIndex>-1 ? dateItems[monthIndex]-1 : today.getMonth()-1;
  var day   = dayIndex>-1   ? dateItems[dayIndex]     : today.getDate();

  var hour    = hourIndex>-1      ? dateItems[hourIndex]    : today.getHours();
  var minute  = minutesIndex>-1   ? dateItems[minutesIndex] : today.getMinutes();
  var second  = secondsIndex>-1   ? dateItems[secondsIndex] : today.getSeconds();

  return new Date(year,month,day,hour,minute,second);
};

class ContactsListBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.chatListRef = React.createRef();

        let renderMessages = [];
        if (this.props.selectedContact) {
            let uri = this.props.selectedContact.uri;
            if (uri in this.props.messages) {
                renderMessages = this.props.messages[uri];
                //renderMessages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);
                renderMessages = renderMessages.sort(function(a, b) {
                  if (a.createdAt < b.createdAt) {
                    return 1; //nameA comes first
                  }

                  if (a.createdAt > b.createdAt) {
                      return -1; // nameB comes first
                  }

                  if (a.createdAt === b.createdAt) {
                      if (a.msg_id < b.msg_id) {
                        return 1; //nameA comes first
                      }
                      if (a.msg_id > b.msg_id) {
                          return -1; // nameB comes first
                      }
                  }

                  return 0;  // names must be equal
                });
            }
        }

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
            renderMessages: GiftedChat.append(renderMessages, []),
            chat: this.props.chat,
            pinned: false,
            showMessageModal: false,
            message: null,
            showShareMessageModal: false,
            inviteContacts: this.props.inviteContacts,
            shareToContacts: this.props.shareToContacts,
            selectedContacts: this.props.selectedContacts,
            pinned: this.props.pinned,
            filter: this.props.filter,
            periodFilter: this.props.periodFilter,
            scrollToBottom: true,
            messageZoomFactor: this.props.messageZoomFactor,
            isTyping: false,
            isLoadingEarlier: false,
            fontScale: this.props.fontScale,
            call: this.props.call,
            isTablet: this.props.isTablet,
            ssiCredentials: this.props.ssiCredentials,
            ssiConnections: this.props.ssiConnections
        }

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

        if (nextProps.messageZoomFactor !== this.state.messageZoomFactor) {
            this.setState({scrollToBottom: false, messageZoomFactor: nextProps.messageZoomFactor});
        }

        if (nextProps.selectedContact !== this.state.selectedContact) {
            //console.log('Selected contact changed to', nextProps.selectedContact);

            this.setState({selectedContact: nextProps.selectedContact});
            if (nextProps.selectedContact) {
               this.setState({scrollToBottom: true});
               if (Object.keys(this.state.messages).indexOf(nextProps.selectedContact.uri) === -1) {
                   this.props.getMessages(nextProps.selectedContact.uri);
               }
            } else {
                this.setState({renderMessages: []});
            }
        };

        if (nextProps.myContacts !== this.state.myContacts) {
            this.setState({myContacts: nextProps.myContacts});
        };

        if (nextProps.selectedContact) {
            let renderMessages = [];
            let uri = nextProps.selectedContact.uri;

            if (uri in nextProps.messages) {
                renderMessages = nextProps.messages[uri];
                if (this.state.renderMessages.length !== renderMessages.length) {
                    this.setState({isLoadingEarlier: false});
                    this.props.confirmRead(uri);
                    if (this.state.renderMessages.length > 0 && renderMessages.length > 0) {
                        let last_message_ts = this.state.renderMessages[0].createdAt;
                        if (renderMessages[0].createdAt > last_message_ts) {
                            this.setState({scrollToBottom: true});
                        }
                    }
                }
            }

            if (renderMessages !== this.state.renderMessages) {
                //renderMessages.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);
                renderMessages = renderMessages.sort(function(a, b) {
                  if (a.createdAt < b.createdAt) {
                    return 1; //nameA comes first
                  }

                  if (a.createdAt > b.createdAt) {
                      return -1; // nameB comes first
                  }

                  if (a.createdAt === b.createdAt) {
                      if (a.msg_id < b.msg_id) {
                        return 1; //nameA comes first
                      }
                      if (a.msg_id > b.msg_id) {
                          return -1; // nameB comes first
                      }
                  }

                  return 0;  // names must be equal
                });

                this.setState({renderMessages: GiftedChat.append(renderMessages, [])});
                if (!this.state.scrollToBottom && renderMessages.length > 0) {
                    //console.log('Scroll to first message');
                    //this.scrollToMessage(0);
                }
            }
        }

        this.setState({isLandscape: nextProps.isLandscape,
                       isTablet: nextProps.isTablet,
                       chat: nextProps.chat,
                       fontScale: nextProps.fontScale,
                       filter: nextProps.filter,
                       call: nextProps.call,
                       password: nextProps.password,
                       showMessageModal: nextProps.showMessageModal,
                       messages: nextProps.messages,
                       inviteContacts: nextProps.inviteContacts,
                       shareToContacts: nextProps.shareToContacts,
                       selectedContacts: nextProps.selectedContacts,
                       pinned: nextProps.pinned,
                       isTyping: nextProps.isTyping,
                       periodFilter: nextProps.periodFilter,
                       ssiCredentials: nextProps.ssiCredentials,
                       ssiConnections: nextProps.ssiConnections,
                       targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : nextProps.targetUri
                       });

        if (nextProps.isTyping) {
            setTimeout(() => {
                this.setState({isTyping: false});
            }, 3000);
        }
    }

    renderCustomActions = props =>
    (
      <CustomChatActions {...props} onSend={this.onSendFromUser} onSendWithFile={this.onSendWithFile}/>
    )

    onSendFromUser() {
        console.log('On send from user...');
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
            fontScale={this.state.fontScale}
            orientation={this.props.orientation}
            isTablet={this.state.isTablet}
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
        //console.log('Load earlier messages...');
        this.setState({scrollToBottom: false, isLoadingEarlier: true});
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
            message.encrypted = this.state.selectedContact && this.state.selectedContact.publicKey ? 2 : 0;
            this.props.sendMessage(uri, message);
        });

        this.setState({renderMessages: GiftedChat.append(this.state.renderMessages, messages)});
    }

    searchedContact(uri, contact=null) {
        if (uri.indexOf(' ') > -1) {
            return [];
        }

        const item = this.props.newContactFunc(uri.toLowerCase(), null, {src: 'search_contact'});
        if (!item) {
            return [];
        }

        if (contact) {
            item.name = contact.name;
            item.photo = contact.photo;
        }
        return [item];
    }


    getServerHistory() {
        if (!this.state.accountId) {
            return;
        }

        if (this.ended || !this.state.accountId || this.state.isRefreshing) {
            return;
        }

        console.log('Get server history...');

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

                    elem.uri = elem.remoteParty.toLowerCase();

                    let uri_els = elem.uri.split('@');
                    let username = uri_els[0];
                    let domain;
                    if (uri_els.length > 1) {
                        domain = uri_els[1];
                    }

                    if (elem.uri.indexOf('@guest.') > -1) {
                        if (!elem.displayName) {
                            elem.uri = 'guest@' + elem.uri.split('@')[1];
                        } else {
                            elem.uri = elem.displayName.toLowerCase().replace(/\s|\-|\(|\)/g, '') + '@' + elem.uri.split('@')[1];
                        }
                    }

                    if (utils.isPhoneNumber(elem.uri)) {
                        username = username.replace(/\s|\-|\(|\)/g, '');
                        username = username.replace(/^00/, "+");
                        elem.uri = username;
                    }

                    if (known.indexOf(elem.uri) > -1) {
                        return null;
                    }

                    known.push(elem.uri);

                    if (elem.displayName) {
                        elem.name = elem.displayName;
                    } else {
                        elem.name = elem.uri;
                    }

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
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
        if (!contact) {
            return false;
        }

        if (tags.indexOf('conference') > -1 && contact.conference) {
            return true;
        }

        if (tags.length > 0 && !tags.some(item => contact.tags.includes(item))) {
            return false;
        }

        if (contact.name && contact.name.toLowerCase().indexOf(filter.toLowerCase()) > -1) {
            return true;
        }

        if (contact.uri.toLowerCase().startsWith(filter.toLowerCase())) {
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
            let isSsiMessage = this.state.selectedContact && this.state.selectedContact.tags.indexOf('ssi') > -1;
            let options = []
            options.push('Copy');
            if (!isSsiMessage) {
                options.push('Delete');
            }

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
                if (!isSsiMessage) {
                    options.push('Pin');
                }
            }

            options.push('Info');
            if (!isSsiMessage) {
                options.push('Share');
            }
            if (currentMessage.local_url) {
                if (utils.isImage(currentMessage.local_url)) {
                    options.push('Save');
                }
                options.push('Open');
            }
            options.push('Cancel');

            let l = options.length - 1;

            context.actionSheet().showActionSheetWithOptions({options, l}, (buttonIndex) => {
                let action = options[buttonIndex];
                if (action === 'Copy') {
                    Clipboard.setString(currentMessage.text);
                } else if (action === 'Delete') {
                    this.props.deleteMessage(currentMessage._id, this.state.targetUri);
                } else if (action === 'Pin') {
                    this.props.pinMessage(currentMessage._id);
                } else if (action === 'Unpin') {
                    this.props.unpinMessage(currentMessage._id);
                } else if (action === 'Info') {
                    this.setState({message: currentMessage, showMessageModal: true});
                } else if (action === 'Share') {
                    this.setState({message: currentMessage, showShareMessageModal: true});
                } else if (action === 'Resend') {
                    this.props.reSendMessage(currentMessage, this.state.targetUri);
                } else if (action === 'Save') {
                    this.savePicture(currentMessage.local_url);
                } else if (action === 'Open') {
                    FileViewer.open(currentMessage.local_url, { showOpenWithDialog: true })
                    .then(() => {
                        // success
                    })
                    .catch(error => {
                        // error
                    });
                }
            });
        }
    };

    async hasAndroidPermission() {
      const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

      const hasPermission = await PermissionsAndroid.check(permission);
      if (hasPermission) {
            return true;
      }

      const status = await PermissionsAndroid.request(permission);
      return status === 'granted';
    }

    async savePicture(file) {
        if (Platform.OS === "android" && !(await this.hasAndroidPermission())) {
           return;
        }

        file = 'file://' + file;

        console.log('Save to camera roll', file);
        CameraRoll.save(file);
    };

    shouldUpdateMessage(props, nextProps) {
        return true;
    }

    toggleShareMessageModal() {
        this.setState({showShareMessageModal: !this.state.showShareMessageModal});
    }

    renderMessageVideo(props){
        const { currentMessage } = props;
        return (null);

        return (
        <View style={{ padding: 20 }}>
           <Video source={{uri: currentMessage.video}}   // Can be a URL or a local file.
               ref={(ref) => {
                 this.player = ref
               }}                                      // Store reference
               onBuffer={this.onBuffer}                // Callback when remote video is buffering
               onError={this.videoError}               // Callback when video cannot be loaded
               style={styles.backgroundVideo} />
        </View>
        );
    };

    videoError() {
        console.log('Video streaming error');
    }

    onBuffer() {
        console.log('Video buffer error');
    }

    renderMessageText(props) {
        const {currentMessage} = props;
        const { text: currText } = currentMessage;

        let status = '';
        let label = 'Uploading...';

        if (!currentMessage.metadata) {
            return (
                 <MessageText {...props}
                      currentMessage={{
                        ...currentMessage
                      }}/>
            );
        }

        if (currentMessage.direction === 'incoming') {
            label = 'Downloading...';
            status = currentMessage.url;
        } else {
            status = currentMessage.url;
        }

        return (
             <MessageText {...props}
                  currentMessage={{
                    ...currentMessage,
                    text: currText.replace(label, status).trim(),
                  }}/>
        );
    };

    renderMessageText(props) {
        return (
              <MessageText {...props}/>
          );
    };

    renderMessageBubble (props) {
        let rightColor = '#0084ff';
        let leftColor = '#f0f0f0';

        if (props.currentMessage.failed) {
            rightColor = 'red';
            leftColor = 'red';
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

    scrollToMessage(id) {
        //console.log('scrollToMessage', id);
        //https://github.com/FaridSafi/react-native-gifted-chat/issues/938
        this.chatListRef.current?._messageContainerRef?.current?.scrollToIndex({
            animated: true,
            index: id
          });
    }

    get showChat() {
       if (this.state.selectedContact) {
           if (this.state.selectedContact.tags && this.state.selectedContact.tags.indexOf('blocked') > -1) {
               return false;
           }

           if (this.state.selectedContact.uri.indexOf('@guest.') > -1) {
               return false;
           }

           if (this.state.selectedContact.uri.indexOf('anonymous@') > -1) {
               return false;
           }
       }

       let username = this.state.targetUri ? this.state.targetUri.split('@')[0] : null;
       let isPhoneNumber = username ? username.match(/^(\+|0)(\d+)$/) : false;

       if (isPhoneNumber) {
           return false;
       }

       if (this.props.selectedContact) {
           return true;
       }

       return false;
    }

    ssi2GiftedChat(from_uri, content, timestamp) {
        let id = uuid.v4();

        let msg;

        msg = {
            _id: id,
            key: id,
            text: content,
            createdAt: timestamp,
            direction: 'incoming',
            sent: false,
            received: true,
            pending: false,
            system: false,
            failed: false,
            user: {_id: from_uri, name: from_uri}
            }
        return msg;
    }

    getSsiContacts() {
        //console.log('Get SSI contacts');
        let contacts = [];
        if (this.state.ssiCredentials) {
            this.state.ssiCredentials.forEach((item) => {
                let contact = this.props.newContactFunc(item.id, 'Credential');
                contact.ssiCredential = item;
                contact.credential = new Object();

                const schemaId = item.metadata.data['_internal/indyCredential'].schemaId;

                if (schemaId === 'EwAf16U6ZphXsZq6E5qmPz:2:Bloqzone_IDIN_ver5:5.0') {
                    contact.schemaId = schemaId;

                    item.credentialAttributes.forEach((attribute) => {
                        contact.credential[attribute.name] = attribute.value;
                        if (attribute.value.length > 0) {
                            if (attribute.name === 'legalName') {
                                contact.name = attribute.value;
                            } else if (attribute.name === 'acceptDateTime') {
                                contact.timestamp = attribute.value.toDate("dd-mm-yy hh:ii:ss");
                            } else if (attribute.name === 'createdAt') {
                                contact.timestamp = attribute.value;
                            } else if (attribute.name === 'emailAddress') {
                                contact.email = attribute.value;
                            }
                        }
                    });
                }

                if (contact.credential.initials) {
                    contact.name = contact.credential.initials;
                }

                if (contact.credential.legalName) {
                    contact.name = contact.name  + ' ' + contact.credential.legalName;
                }

                if (contact.credential.dob) {
                    contact.name = contact.name  + ' (' + contact.credential.dob + ')';
                }

                if (contact.credential.birthDate) {
                    contact.name = contact.name  + ' (' + contact.credential.birthDate + ')';
                }

                if (contact.credential.acceptDateTime && item.state === 'done') {
                    contact.lastMessage = 'Credential issued at ' + contact.credential.acceptDateTime + ' (' + item.state + ')';
                }

                contact.tags.push('ssi');
                contact.tags.push('ssi-credential');
                contact.tags.push('readonly');
                contacts.push(contact);
            });
        }

        if (this.state.ssiConnections) {
            this.state.ssiConnections.forEach((item) => {
                //console.log('Contacts SSI connection', item);
                let uri = item.id;
                let contact = this.props.newContactFunc(uri, item.theirLabel);
                contact.credential = new Object();

                contact.timestamp = item.createdAt;

                contact.lastMessage = 'Connection is in state ' + item.state;
                contact.tags.push('ssi');
                contact.tags.push('ssi-connection');
                if (item.theirLabel === 'Bloqzone Mediator Agent' && item.state === 'complete') {
                    contact.tags.push('readonly');
                }

                if (item.theirLabel === 'Bloqzone Issuer Agent' && item.state === 'complete') {
                    //contact.tags.push('readonly');
                }
                contact.ssiConnection = item;
                contacts.push(contact);
            });
        }

        return contacts;
    }

    render() {
        let searchExtraItems = [];
        let items = [];
        let matchedContacts = [];
        let ssiContacts = [];
        let messages = this.state.renderMessages;
        let contacts = [];

        //console.log('--- Render contacts with filter', this.state.filter);
        //console.log('--- Render contacts', this.state.selectedContact);

        if (this.state.filter === 'ssi') {
            contacts = this.getSsiContacts();
        } else {
            Object.keys(this.state.myContacts).forEach((uri) => {
                contacts.push(this.state.myContacts[uri]);
            });
        }

        let chatInputClass;

        if (this.state.selectedContact) {
           if (this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
               chatInputClass = this.noChatInputToolbar;
           }
        } else if (!this.state.chat) {
            chatInputClass = this.noChatInputToolbar;
        }

        if (!this.state.selectedContact && this.state.filter) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri, [this.state.filter]));
        } else {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
            searchExtraItems = searchExtraItems.concat(this.state.contacts);

            if (this.state.targetUri && this.state.targetUri.length > 2 && !this.state.selectedContact && !this.state.inviteContacts) {
                matchedContacts = searchExtraItems.filter(contact => this.matchContact(contact, this.state.targetUri));
            } else if (this.state.selectedContact && this.state.selectedContact.type === 'contact') {
                matchedContacts.push(this.state.selectedContact);
            } else if (this.state.selectedContact) {
                items = [this.state.selectedContact];
            }

            items = items.concat(matchedContacts);
        }

        if (this.state.targetUri) {
            items = items.concat(this.searchedContact(this.state.targetUri, this.state.selectedContact));
        }

        if (this.state.filter && this.state.targetUri) {
            items = contacts.filter(contact => this.matchContact(contact, this.state.targetUri));
        }


        const known = [];
        items = items.filter((elem) => {
            if (this.state.shareToContacts && elem.tags.indexOf('test') > -1) {
                return;
            }

            if (this.state.inviteContacts && elem.tags.indexOf('conference') > -1 ) {
                return;
            }

            if (this.state.shareToContacts && elem.tags.indexOf('chat') === -1) {
                return;
            }

            if (this.state.shareToContacts && elem.uri === this.state.accountId) {
                return;
            }

            if (this.state.accountId === elem.uri && elem.tags.length === 0) {
                return;
            }

            if (this.state.shareToContacts && elem.uri.indexOf('@') === -1) {
                return;
            }
            if (known.indexOf(elem.uri) <= -1) {
                known.push(elem.uri);
                return elem;
            }
        });

        items.forEach((item) => {
            item.showActions = false;

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
        var todayStart = new Date();
        todayStart.setHours(0,0,0,0);

        var yesterdayStart = new Date();
        yesterdayStart.setDate(todayStart.getDate() - 2);
        yesterdayStart.setHours(0,0,0,0);

        items.forEach((item) => {
            const fromDomain = '@' + item.uri.split('@')[1];

            if (this.state.periodFilter === 'today') {
                if(item.timestamp < todayStart) {
                    return;
                }
            }

            if (item.uri === 'anonymous@anonymous.invalid' && this.state.filter !== 'blocked') {
                return;
            }

            if (this.state.periodFilter === 'yesterday') {
                if(item.timestamp < yesterdayStart || item.timestamp > todayStart) {
                    return;
                }
            }

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
            items[0].showActions = true;
            if (items[0].tags.indexOf('ssi-credential') > -1) {
                let content = '';
                let m;

                chatInputClass = this.noChatInputToolbar;

                items[0].ssiCredential.credentialAttributes.forEach((attribute) => {
                    content = content + attribute.name + ": " + attribute.value + '\n';
                });

                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI credential body' , items[0].timestamp);
                m.system = true;
                messages.push(m);

                content = '';
                content = content + 'Id: ' + items[0].ssiCredential.id;
                content = content + '\nState: ' + items[0].ssiCredential.state;
                content = content + '\nSchema Id:' + items[0].schemaId;

                let issuer = this.state.ssiConnections.filter(x => x.id === items[0].ssiCredential.connectionId);

                if (issuer.length === 1) {
                    content = content + '\nIssuer: ' + issuer[0].theirLabel;
                } else {
                    content = content + '\nIssuer: : ' + items[0].ssiCredential.connectionId;
                }

                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI credential details' , items[0].timestamp);
                m.system = true;
                messages.push(m);
            }

            if (items[0].tags.indexOf('ssi-connection') > -1) {
                let content = '';
                let m;

                chatInputClass = this.noChatInputToolbar;

                content = 'Role: ' + items[0].ssiConnection.role;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'State: ' + items[0].ssiConnection.state;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'Multiple use: ' + items[0].ssiConnection.multiUseInvitation;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                if (items[0].ssiConnection.mediatorId) {
                    content = 'Mediator: ' + items[0].ssiConnection.mediatorId;
                    m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                    messages.push(m);
                }

                content = 'Id: ' + items[0].ssiConnection.id;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'Did: ' + items[0].ssiConnection.did;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                content = 'From: ' + items[0].ssiConnection.theirLabel;
                m = this.ssi2GiftedChat(items[0].uri, content.trim(), items[0].timestamp);
                messages.push(m);

                m = this.ssi2GiftedChat(items[0].uri, 'SSI connection details' , items[0].timestamp);
                m.system = true;
                messages.push(m);
            }
        }

        let columns = 1;

        if (this.state.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }


        const chatContainer = this.props.orientation === 'landscape' ? styles.chatLandscapeContainer : styles.chatPortraitContainer;
        const container = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        const contactsContainer = this.props.orientation === 'landscape' ? styles.contactsLandscapeContainer : styles.contactsPortraitContainer;
        const borderClass = (messages.length > 0 && !this.state.chat) ? styles.chatBorder : null;

        let filteredMessages = [];
        messages.forEach((m) => {
            if (!m.image && m.url && !m.local_url) {
                //return;
            }

            if (m.url || m.local_url || m.image) {
                //console.log('----');
                //console.log('Render message local_url', m.failed);
            }

            filteredMessages.push(m);
            //console.log(m);
        });

        messages = filteredMessages;

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
                data={items}
                renderItem={this.renderItem}
                listKey={item => item.id}
                key={this.props.orientation}
                loadEarlier
             />
             }

             {this.showChat && !this.state.inviteContacts?
             <View style={[chatContainer, borderClass]}>
                <GiftedChat ref={this.chatListRef}
                  messages={messages}
                  onSend={this.onSendMessage}
                  alwaysShowSend={true}
                  onLongPress={this.onLongMessagePress}
                  onPress={this.onLongMessagePress}
                  renderInputToolbar={chatInputClass}
                  renderBubble={this.renderMessageBubble}
                  renderMessageVideo={this.renderMessageVideo}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  renderMessageText={this.renderMessageText}
                  lockStyle={styles.lock}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
                  maxInputLength={16000}
                  timeTextStyle={{ left: { color: 'red' }, right: { color: 'yellow' } }}
                  infiniteScroll
                  loadEarlier={showLoadEarlier}
                  isLoadingEarlier={this.state.isLoadingEarlier}
                  onLoadEarlier={this.loadEarlierMessages}
                  isTyping={this.state.isTyping}
                />
              </View>
              : (items.length === 1) ?
              <View style={[chatContainer, borderClass]}>
                <GiftedChat ref={this.chatListRef}
                  messages={messages}
                  renderInputToolbar={() => { return null }}
                  renderBubble={this.renderMessageBubble}
                  renderMessageVideo={this.renderMessageVideo}
                  renderMessageText={this.renderMessageText}
                  onSend={this.onSendMessage}
                  renderActions={this.renderCustomActions}
                  lockStyle={styles.lock}
                  onLongPress={this.onLongMessagePress}
                  shouldUpdateMessage={this.shouldUpdateMessage}
                  onPress={this.onLongMessagePress}
                  scrollToBottom={this.state.scrollToBottom}
                  inverted={true}
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
    saveHistory     : PropTypes.func,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    saveConference  : PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    filter          : PropTypes.string,
    periodFilter    : PropTypes.string,
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
    shareToContacts   : PropTypes.bool,
    selectedContacts: PropTypes.array,
    toggleBlocked   : PropTypes.func,
    togglePinned    : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    messageZoomFactor: PropTypes.string,
    isTyping        : PropTypes.bool,
    fontScale       : PropTypes.number,
    call            : PropTypes.object,
    ssiCredentials:  PropTypes.array,
    ssiConnections:  PropTypes.array
};


export default ContactsListBox;
