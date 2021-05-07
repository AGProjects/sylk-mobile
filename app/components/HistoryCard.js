import React, { Component, Fragment} from 'react';
import { View, SafeAreaView, FlatList } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Button, Caption, Title, Subheading, List, Text, Menu} from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import uuid from 'react-native-uuid';
import EditConferenceModal from './EditConferenceModal';
import EditDisplayNameModal from './EditDisplayNameModal';
import styles from '../assets/styles/blink/_HistoryCard.scss';
import UserIcon from './UserIcon';
import { GiftedChat } from 'react-native-gifted-chat'

import utils from '../utils';

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

const Item = ({ nr, uri, displayName }) => (
  <View style={styles.participantView}>
    {displayName !==  uri?
    <Text style={styles.participant}>{displayName} ({uri})</Text>
    :
    <Text style={styles.participant}>{uri}</Text>
    }

  </View>
);

const renderItem = ({ item }) => (
 <Item nr={item.nr} uri={item.uri} displayName={item.displayName}/>
);

function isIp(ipaddress) {
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
    return (true)
  }
  return (false)
}


class HistoryCard extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            id: this.props.contact.id,
            contact: this.props.contact,
            displayName: this.props.contact.displayName,
            filter: this.props.filter,
            uri: this.props.contact.remoteParty,
            invitedParties: this.props.invitedParties,
            participants: this.props.contact.participants,
            conference: this.props.contact.conference,
            type: this.props.contact.type,
            photo: this.props.contact.photo,
            label: this.props.contact.label,
            orientation: this.props.orientation,
            isTablet: this.props.isTablet,
            isLandscape: this.props.isLandscape,
            favorite: (this.props.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (this.props.contact.tags.indexOf('blocked') > -1)? true : false,
            confirmRemoveFavorite: false,
            confirmPurgeChat: false,
            showEditConferenceModal: false,
            showEditDisplayNameModal: false,
            messages: this.props.messages,
            unread: this.props.unread,
            chat: this.props.chat,
            pinned: this.props.pinned
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            id: nextProps.contact.id,
            isLandscape: nextProps.isLandscape,
            contact: nextProps.contact,
            displayName: nextProps.contact.displayName,
            uri: nextProps.contact.remoteParty,
            invitedParties: nextProps.invitedParties,
            participants: nextProps.contact.participants,
            conference: nextProps.contact.conference,
            type: nextProps.contact.type,
            photo: nextProps.contact.photo,
            label: nextProps.contact.label,
            orientation: nextProps.orientation,
            favorite: (nextProps.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (nextProps.contact.tags.indexOf('blocked') > -1)? true : false,
            chat: nextProps.chat,
            pinned: nextProps.pinned,
            messages: nextProps.messages,
            unread: nextProps.chat ? "0": nextProps.unread || "0"
        });
    }

    shouldComponentUpdate(nextProps) {
        //https://medium.com/sanjagh/how-to-optimize-your-react-native-flatlist-946490c8c49b
        return true;
    }

    toggleEdit() {
        if (this.state.conference) {
            this.setState({showEditConferenceModal: !this.state.showEditConferenceModal});
        } else {
            this.setState({showEditDisplayNameModal: !this.state.showEditDisplayNameModal});
        }
    }

    setFavoriteUri() {
        if (this.state.favorite) {
            if (this.state.confirmRemoveFavorite) {
                let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
                this.setState({favorite: newFavoriteState, action: null, confirmRemoveFavorite: false});
                this.props.setTargetUri(this.state.uri);
            } else {
                this.setState({confirmRemoveFavorite: true});
            }
        } else {
            let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
            this.setState({favorite: newFavoriteState});
        }
    }

    saveInvitedParties(uris) {
        this.setState({invitedParties: uris});
        this.props.saveInvitedParties(this.state.uri.split('@')[0], uris);
    }

    handleParticipant() {
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    setBlockedUri() {
        let newBlockedState = this.props.setBlockedUri(this.state.uri);
        this.setState({blocked: newBlockedState});
    }

    setBlockedDomain() {
        let newBlockedState = this.props.setBlockedUri('@' + this.state.uri.split('@')[1]);
        this.setState({blocked: newBlockedState});
    }

    deleteHistoryEntry() {
        this.props.deleteHistoryEntry(this.state.uri);
    }

    deleteChat() {
        if (this.state.confirmDeleteChat) {
            this.setState({confirmDeleteChat: false, action: null});
            this.props.purgeMessages(this.state.uri);
        } else {
            this.setState({confirmDeleteChat: true, action: null});
        }
    }

    undo() {
        this.setState({confirmRemoveFavorite: false,
                       confirmDeleteChat: false,
                       action: null});
    }

    saveDisplayName(displayName) {
        this.props.saveDisplayName(this.state.uri, displayName);
    }

    onSendMessage(messages) {
        messages.forEach((message) => {
            // TODO send messages using account API
        });
        this.setState({messages: GiftedChat.append(this.state.messages, messages)});
    }

    setFavoriteUri() {
        if (this.state.favorite) {
            if (this.state.confirmRemoveFavorite) {
                let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
                this.setState({favorite: newFavoriteState, action: null, confirmRemoveFavorite: false});
                this.props.setTargetUri(this.state.uri);
            } else {
                this.setState({confirmRemoveFavorite: true});
            }
        } else {
            let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
            this.setState({favorite: newFavoriteState});
        }
    }

    setTargetUri(uri, contact) {
        this.props.setTargetUri(uri, this.state.contact);
    }

    renderChatComposer () {
        return null;
    }

    render () {
        let showActions = this.props.contact.showActions &&
                          this.props.contact.tags.indexOf('test') === -1 &&
                          this.props.contact.tags.toString() !== "syntetic";

        let uri = this.state.uri;
        let username =  uri.split('@')[0];
        let domain =  uri.split('@')[1];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        let displayName = this.state.displayName;

        let buttonMode = 'text';
        let showBlockButton = !this.state.conference && !this.state.chat;
        let showBlockDomainButton = false;
        let showFavoriteButton = !this.state.chat;
        let showUndoButton = (this.state.confirmRemoveFavorite || this.state.confirmDeleteChat) ? true : false;
        let showDeleteButton = (!this.state.pinned && !this.state.chat && this.props.contact.tags.indexOf('local') > -1 && !this.state.favorite) ? true: false;
        let showEditButton = (!this.state.chat && !this.state.confirmRemoveFavorite ) ? true: false;
        let blockTextbutton = 'Block';
        let blockDomainTextbutton = 'Block domain';
        let editTextbutton = 'Edit';
        let favoriteTextbutton = 'Favorite';
        let undoTextbutton = 'Undo';
        let deleteTextbutton = 'Delete';
        let showPurgeButton = (this.state.messages.length > 0 && !this.state.pinned && this.state.chat);
        let deleteChatbutton = this.state.confirmDeleteChat ? 'Confirm purge' : 'Purge';
        let pinChatbutton = this.state.pinned ? 'Show all messages' : 'Pinned only';
        let showPinnedButton = this.state.chat && !this.state.confirmDeleteChat;;

        let participantsData = [];

        if (this.state.favorite) {
            favoriteTextbutton = this.state.confirmRemoveFavorite ? 'Confirm' : 'Unfavorite';
            if (!this.state.blocked) {
                showBlockButton = false;
            }
        }

        if (username.indexOf('3333@') > -1) {
            showBlockButton = false;
        }

        if (username.indexOf('4444@') > -1) {
            showBlockButton = false;
        }

        if (displayName === 'Myself') {
            showBlockButton = false;
        }

        if (this.state.blocked) {
            blockTextbutton = 'Unblock';
            showFavoriteButton = false;
        }

        if (this.state.confirmDeleteChat) {
            showFavoriteButton = false;
            showBlockButton = false;
            showEditButton = false;
        }

        if (this.state.confirmRemoveFavorite) {
            showPurgeButton = false;
            showBlockButton = false;
        }


        let color = {};

        let title = displayName || username;

        let subtitle = uri;
        let description = this.props.contact.startTime;

        if (displayName === uri) {
            title = toTitleCase(username);
        }

       if (isPhoneNumber && isIp(domain)) {
           title = 'Tel ' + username;
           subtitle = 'From @' + domain;
           showBlockDomainButton = true;
           showFavoriteButton = false;
       }

        if (utils.isAnonymous(uri)) {
            //uri = 'anonymous@anonymous.invalid';
            displayName = 'Anonymous';
            if (uri.indexOf('@guest.') > -1) {
                subtitle = 'From the Web';
            }
            showFavoriteButton = false;
            showBlockDomainButton = true;
            if (!this.state.blocked) {
                showBlockButton = false;
            }
            blockDomainTextbutton = 'Block Web calls';
        }

        if (!username || username.length === 0) {
            if (isIp(domain)) {
                title = 'IP domain';
            } else if (domain.indexOf('guest.') > -1) {
                title = 'Calls from the Web';
            } else {
                title = 'Domain';
            }
        }

        let cardContainerClass = styles.portraitContainer;

        if (this.state.isTablet) {
            cardContainerClass = (this.state.orientation === 'landscape') ? styles.cardLandscapeTabletContainer : styles.cardPortraitTabletContainer;
        } else {
            cardContainerClass = (this.state.orientation === 'landscape') ? styles.cardLandscapeContainer : styles.cardPortraitContainer;
        }

        let cardClass = this.state.isTablet ? styles.tabletCard : styles.card;
        let cardHeight = this.state.isTablet ? 110 : 85;

        if (showActions) {
            cardClass = styles.expandedCard;
        }

        if (this.props.contact.tags.indexOf('history') > -1) {
            let duration = moment.duration(this.props.contact.duration, 'seconds').format('HH:mm:ss', {trim: false});

            if (this.props.contact.direction === 'received' && this.props.contact.duration === 0) {
                color.color = '#a94442';
                duration = 'missed';
            } else if (this.props.contact.direction === 'placed' && this.props.contact.duration === 0) {
                duration = 'cancelled';
            }

            if (this.state.conference) {
                let participants = this.state.participants;
                if (this.state.invitedParties && this.state.invitedParties.length > 0 ) {
                    participants = this.state.invitedParties;
                }

                if (participants && participants.length > 0) {
                    const p_text = participants.length > 1 ? 'participants' : 'participant';
                    subtitle = 'With ' + participants.length + ' ' + p_text;
                    let i = 1;
                    let contact_obj;
                    let dn;
                    let _item;
                    participants.forEach((participant) => {
                        contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', participant);
                        dn = contact_obj ? contact_obj.displayName : participant;
                        if (participant === dn && this.props.myDisplayNames && this.props.myDisplayNames.hasOwnProperty(participant)) {
                            dn = this.props.myDisplayNames[participant].name;
                        }
                        _item = {nr: i, id: uuid.v4(), uri: participant, displayName: dn};
                        participantsData.push(_item);
                        i = i + 1;
                    });
                } else {
                    subtitle = 'With no participants';
                }

                let dn;
                if (participantsData.length > 4 || participantsData.length < 2) {
                    title = username.length > 10 ? 'Conference' : toTitleCase(username);
                } else if (participantsData.length > 1 || participantsData.length <= 4 ) {
                    let j = 0;
                    if (username.length < 10) {
                        title = toTitleCase(username);
                    } else {
                        participantsData.forEach((participant) => {
                            if (participant.displayName === participant.uri) {
                                dn = toTitleCase(participant.uri.split('@')[0]);
                            } else {
                                dn = participant.displayName.split(' ')[0];
                            }
                            title = title + dn;
                            if (j < participantsData.length - 1) {
                                title = title + ' & ';
                            }
                            j = j + 1;
                        });
                    }
                }
            }

            if (!displayName) {
                title = uri;
                if (duration === 'missed') {
                    subtitle = 'Last call missed';
                } else if (duration === 'cancelled') {
                    subtitle = 'Last call cancelled';
                } else {
                    subtitle = 'Last call duration ' + duration ;
                }
            }

            description = description + ' (' + duration + ')';
            const container = this.state.isLandscape ? styles.containerLandscape : styles.container;
            const chatContainer = this.state.isLandscape ? styles.chatLandscapeContainer : styles.chatPortraitContainer;

            if (showActions) {
                cardHeight = 150 + 30 * participantsData.length;
            }

            return (
                <Fragment>
                    <Card style={[cardContainerClass, cardClass, {height: cardHeight}]}
                        onPress={() => {this.setTargetUri(uri, this.props.contact)}}
                        >
                        <Card.Content style={styles.cardContent}>
                            <View style={styles.mainContent}>
                                <Title noWrap style={color}>{title}</Title>
                                {showActions || this.state.isTablet ?
                                <Subheading noWrap style={color}>{subtitle}</Subheading>
                                : null}
                                <Caption color="textSecondary">
                                    <Icon name={this.props.contact.direction == 'received' ? 'arrow-bottom-left' : 'arrow-top-right'}/>{description}
                                </Caption>
                                {participantsData && participantsData.length && showActions ?
                                <SafeAreaView style={styles.mainContent}>
                                  <FlatList
                                    horizontal={false}
                                    data={participantsData}
                                    renderItem={renderItem}
                                    listKey={item => item.id}
                                    key={item => item.id}
                                  />
                                </SafeAreaView>
                                : null}

                            </View>
                            <View style={styles.userAvatarContent}>
                                <UserIcon style={styles.userIcon} identity={this.state} unread={this.state.unread}/>
                            </View>
                        </Card.Content>
                        {showActions ?
                                <View style={styles.buttonContainer}>
                                <Card.Actions>
                                   {showEditButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.toggleEdit()}}>{editTextbutton}</Button>: null}
                                   {showDeleteButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.deleteHistoryEntry()}}>{deleteTextbutton}</Button>: null}
                                   {showBlockButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.setBlockedUri()}}>{blockTextbutton}</Button>: null}
                                   {showBlockDomainButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.setBlockedDomain()}}>{blockDomainTextbutton}</Button>: null}
                                   {showFavoriteButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.setFavoriteUri()}}>{favoriteTextbutton}</Button>: null}
                                   {showUndoButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.undo()}}>{undoTextbutton}</Button>: null}
                                   {showPurgeButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.deleteChat()}}>{deleteChatbutton}</Button>: null}
                                   {showPinnedButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.props.togglePinned()}}>{pinChatbutton}</Button>: null}
                                </Card.Actions>
                                </View>

                            : null}
                    </Card>

                { this.state.showEditDisplayNameModal ?
                <EditDisplayNameModal
                    show={this.state.showEditDisplayNameModal}
                    close={this.toggleEdit}
                    uri={this.state.uri}
                    myself={false}
                    displayName={this.state.displayName}
                    saveDisplayName={this.saveDisplayName}
                />
                : null}

                { this.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    room={title}
                    invitedParties={this.state.invitedParties}
                    selectedContact={this.state.contact}
                    setFavoriteUri={this.props.setFavoriteUri}
                    saveInvitedParties={this.saveInvitedParties}
                    close={this.toggleEdit}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.props.accountId}
                    setFavoriteUri={this.props.setFavoriteUri}
                    favoriteUris={this.props.favoriteUris}
                />
                : null}

                </Fragment>
            );

        } else {
            return (
                <Card style={[cardContainerClass, cardClass]}
                    onPress={() => {this.props.setTargetUri(uri, this.props.contact)}}
                >
                    <Card.Content style={styles.cardContent}>
                        <View style={styles.mainContent}>
                            <Title noWrap style={color}>{title}</Title>
                            <Subheading noWrap style={color}>{uri}</Subheading>
                            <Caption color="textSecondary">
                                {this.state.label}
                            </Caption>
                        </View>
                        <View style={styles.userAvatarContent}>
                            <UserIcon style={styles.userIcon} identity={this.state}/>
                        </View>
                    </Card.Content>
                    {showActions ?
                        <View style={styles.buttonContainer}>
                        <Card.Actions>
                           {showBlockButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.setBlockedUri()}}>{blockTextbutton}</Button>: null}
                           {showFavoriteButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.setFavoriteUri()}}>{favoriteTextbutton}</Button>: null}
                           {showUndoButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.undo()}}>{undoTextbutton}</Button>: null}
                        </Card.Actions>
                        </View>
                        : null}
                </Card>
            );
        }
    }
}

HistoryCard.propTypes = {
    id             : PropTypes.string,
    contact        : PropTypes.object,
    setTargetUri   : PropTypes.func,
    setBlockedUri  : PropTypes.func,
    purgeMessages  : PropTypes.func,
    setFavoriteUri : PropTypes.func,
    saveInvitedParties : PropTypes.func,
    deleteHistoryEntry : PropTypes.func,
    chat           : PropTypes.bool,
    orientation    : PropTypes.string,
    isTablet       : PropTypes.bool,
    isLandscape    : PropTypes.bool,
    contacts       : PropTypes.array,
    defaultDomain  : PropTypes.string,
    accountId      : PropTypes.string,
    favoriteUris   : PropTypes.array,
    myDisplayNames : PropTypes.object,
    messages       : PropTypes.array,
    togglePinned   : PropTypes.func,
    pinned         : PropTypes.bool,
    unread         : PropTypes.string
};


export default HistoryCard;
