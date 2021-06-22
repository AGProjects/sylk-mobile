import React, { Component, Fragment} from 'react';
import { View, SafeAreaView, FlatList } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Button, Caption, Title, Subheading, List, Text, Menu} from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import uuid from 'react-native-uuid';
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
            organization: this.props.contact.organization,
            filter: this.props.filter,
            uri: this.props.contact.remoteParty,
            duration: this.props.contact.duration,
            direction: this.props.contact.direction,
            invitedParties: this.props.invitedParties,
            participants: this.props.contact.participants,
            conference: this.props.contact.conference,
            selected: this.props.contact.selected,
            type: this.props.contact.type,
            photo: this.props.contact.photo,
            label: this.props.contact.label,
            orientation: this.props.orientation,
            lastMessage: this.props.contact.lastMessage,
            isTablet: this.props.isTablet,
            isLandscape: this.props.isLandscape,
            favorite: (this.props.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (this.props.contact.tags.indexOf('blocked') > -1)? true : false,
            confirmRemoveFavorite: false,
            confirmPurgeChat: false,
            messages: this.props.messages,
            unread: this.props.unread,
            chat: this.props.chat,
            pinned: this.props.pinned,
            publicKey: this.props.contact.publicKey,
            publicKeyHash: this.props.contact.publicKeyHash,
            menuVisible: false
        }

        this.menuRef = React.createRef();
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            id: nextProps.contact.id,
            isLandscape: nextProps.isLandscape,
            direction: nextProps.contact.direction,
            duration: nextProps.contact.duration,
            contact: nextProps.contact,
            displayName: nextProps.contact.displayName,
            organization: nextProps.contact.organization,
            uri: nextProps.contact.remoteParty,
            duration: nextProps.contact.duration,
            invitedParties: nextProps.invitedParties,
            participants: nextProps.contact.participants,
            conference: nextProps.contact.conference,
            type: nextProps.contact.type,
            selected: nextProps.contact.selected,
            photo: nextProps.contact.photo,
            label: nextProps.contact.label,
            orientation: nextProps.orientation,
            favorite: (nextProps.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (nextProps.contact.tags.indexOf('blocked') > -1)? true : false,
            chat: nextProps.chat,
            pinned: nextProps.pinned,
            messages: nextProps.messages,
            lastMessage: nextProps.contact.lastMessage,
            unread: nextProps.chat ? "0": nextProps.unread || "0"
        });
    }

    shouldComponentUpdate(nextProps) {
        //https://medium.com/sanjagh/how-to-optimize-your-react-native-flatlist-946490c8c49b
        return true;
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

    toggleBlocked() {
        this.props.toggleBlocked(this.state.uri);
    }

    setBlockedDomain() {
        let newBlockedState = this.props.toggleBlocked('@' + this.state.uri.split('@')[1]);
        this.setState({blocked: newBlockedState});
    }

    undo() {
        this.setState({confirmRemoveFavorite: false,
                       confirmDeleteChat: false,
                       action: null});
    }

    onSendMessage(messages) {
        messages.forEach((message) => {
            // TODO send messages using account API
        });
        this.setState({messages: GiftedChat.append(this.state.messages, messages)});
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
        if (this.state.organization) {
            //displayName = displayName + ' (' + this.state.organization + ')';
        }

        let showBlockButton = !this.state.conference && !this.state.chat;
        let showBlockDomainButton = false;
        let blockTextbutton = 'Block';
        let blockDomainTextbutton = 'Block domain';

        let participantsData = [];

        if (this.state.favorite) {
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
        }

        let color = {};

        let title = displayName || username;
        let subtitle = uri;
        let description;

        if (this.props.contact.startTime && this.props.contact.startTime.indexOf("1970-01-01") === -1) {
            description = moment(this.props.contact.startTime).format('MMM D HH:mm');
        }

        if (displayName === uri) {
            title = toTitleCase(username);
        }

       if (isPhoneNumber && isIp(domain)) {
           title = 'Tel ' + username;
           subtitle = 'From @' + domain;
           showBlockDomainButton = true;
       }

        if (utils.isAnonymous(uri)) {
            //uri = 'anonymous@anonymous.invalid';
            displayName = 'Anonymous';
            if (uri.indexOf('@guest.') > -1) {
                subtitle = 'From the Web';
            }
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

        let cardHeight = 85;

        let duration;

        if (this.props.contact.tags.indexOf('history') > -1) {
            duration = moment.duration(this.state.duration, 'seconds').format('HH:mm:ss', {trim: false});

            if (this.state.direction === 'received' && this.state.duration === 0) {
                duration = 'missed';
            } else if (this.state.direction === 'placed' && this.state.duration === 0) {
                duration = 'cancelled';
            }
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

        if (duration && duration !== "00:00:00") {
            description = description + ' (' + duration + ')';
        }

        const container = this.state.isLandscape ? styles.containerLandscape : styles.containerPortrait;
        const chatContainer = this.state.isLandscape ? styles.chatLandscapeContainer : styles.chatPortraitContainer;

        if (showActions && participantsData.length > 0) {
            cardHeight = cardHeight + 20 * participantsData.length + 10;
        }

        let showSubtitle = (showActions || this.state.isTablet || !description);
        let label = this.state.label ? (" (" +this.state.label + ")" ) : '';
        if (this.state.lastMessage) {
            subtitle = this.state.lastMessage;
            //description = description + ': ' + this.state.lastMessage;
        } else {
            subtitle = subtitle + label;
        }

        return (
            <Fragment>
                <Card style={[cardContainerClass, {height: cardHeight}]}
                    onPress={() => {this.setTargetUri(uri, this.props.contact)}}
                    >

                <View style={styles.rowContent}>
                    <Card.Content style={styles.cardContent}>
                        <View style={styles.avatarContent}>
                            <UserIcon style={styles.userIcon} identity={this.state} unread={this.state.unread}/>
                        </View>

                        <View style={styles.mainContent}>
                            <Title noWrap style={styles.title}>{title}</Title>
                            <Subheading style={styles.subtitle}>{subtitle}</Subheading>

                            <Caption style={styles.description}>
                                {this.state.direction ?
                                <Icon name={this.state.direction == 'received' ? 'arrow-bottom-left' : 'arrow-top-right'}/>
                                : null}
                                {description}

                            </Caption>

                            {participantsData && participantsData.length && showActions ?

                            <View style={styles.participants}>
                                <SafeAreaView style={styles.participant}>
                                  <FlatList
                                    horizontal={false}
                                    data={participantsData}
                                    renderItem={renderItem}
                                    listKey={item => item.id}
                                    key={item => item.id}
                                  />
                                </SafeAreaView>
                            </View>
                            : null}
                        </View>
                    </Card.Content>
                    <View style={styles.rightContent}>
                        { this.state.selected ?
                        <Icon name='check-circle' size={30} />
                        :
                        null
                        }
                    </View>
                </View>

                    {showActions && false ?
                            <View style={styles.buttonContainer}>
                            <Card.Actions>
                               {showBlockButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.toggleBlocked()}}>{blockTextbutton}</Button>: null}
                               {showBlockDomainButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.setBlockedDomain()}}>{blockDomainTextbutton}</Button>: null}
                            </Card.Actions>
                            </View>
                        : null}
                </Card>

            </Fragment>
        );
    }
}

HistoryCard.propTypes = {
    id             : PropTypes.string,
    contact        : PropTypes.object,
    setTargetUri   : PropTypes.func,
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
    pinned         : PropTypes.bool,
    unread         : PropTypes.string,
    toggleBlocked  : PropTypes.func,
    sendPublicKey  : PropTypes.func
};


export default HistoryCard;
