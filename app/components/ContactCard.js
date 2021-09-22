import React, { Component, Fragment} from 'react';
import { View, SafeAreaView, FlatList } from 'react-native';
import { Badge } from 'react-native-elements'
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Button, Caption, Title, Subheading, List, Text, Menu} from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import uuid from 'react-native-uuid';
import styles from '../assets/styles/blink/_ContactCard.scss';
import UserIcon from './UserIcon';
import { GiftedChat } from 'react-native-gifted-chat'
import {Gravatar, GravatarApi} from 'react-native-gravatar';

import utils from '../utils';

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

const Item = ({ nr, uri, name }) => (
  <View style={styles.participantView}>
    {name !==  uri?
    <Text style={styles.participant}>{name} ({uri})</Text>
    :
    <Text style={styles.participant}>{uri}</Text>
    }

  </View>
);

const renderItem = ({ item }) => (
 <Item nr={item.nr} uri={item.uri} name={item.name}/>
);

function isIp(ipaddress) {
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
    return (true)
  }
  return (false)
}


class ContactCard extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            id: this.props.contact.id,
            contact: this.props.contact,
            invitedParties: this.props.invitedParties,
            orientation: this.props.orientation,
            isTablet: this.props.isTablet,
            isLandscape: this.props.isLandscape,
            favorite: (this.props.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (this.props.contact.tags.indexOf('blocked') > -1)? true : false,
            confirmRemoveFavorite: false,
            confirmPurgeChat: false,
            messages: this.props.messages,
            unread: this.props.unread,
            chat: this.props.chat,
            pinned: this.props.pinned
        }

        this.menuRef = React.createRef();
    }

    UNSAFE_componentWillReceiveProps(nextProps) {

        this.setState({
            id: nextProps.contact.id,
            contact: nextProps.contact,
            invitedParties: nextProps.invitedParties,
            isLandscape: nextProps.isLandscape,
            orientation: nextProps.orientation,
            favorite: (nextProps.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (nextProps.contact.tags.indexOf('blocked') > -1)? true : false,
            chat: nextProps.chat,
            pinned: nextProps.pinned,
            messages: nextProps.messages,
            unread: nextProps.unread
        });
    }

    shouldComponentUpdate(nextProps) {
        //https://medium.com/sanjagh/how-to-optimize-your-react-native-flatlist-946490c8c49b
        return true;
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
        this.props.toggleBlocked(this.state.contact.uri);
    }

    setBlockedDomain() {
        let newBlockedState = this.props.toggleBlocked('@' + this.state.contact.uri.split('@')[1]);
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
        let showActions = this.state.contact.showActions &&
                          this.state.contact.tags.indexOf('test') === -1 &&
                          this.state.contact.tags !== ["synthetic"];

        let tags = this.state.contact ? this.state.contact.tags : [];

        let uri = this.state.contact.uri;
        let username =  uri.split('@')[0];
        let domain =  uri.split('@')[1];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        let name = this.state.contact.name;
        if (this.state.contact.organization) {
            //name = name + ' (' + this.state.organization + ')';
        }

        //console.log('Render Contact', this.state.contact.name, this.state.contact.tags);

        let showBlockButton = !this.state.contact.conference && !this.state.chat;
        let showBlockDomainButton = false;
        let blockTextbutton = 'Block';
        let blockDomainTextbutton = 'Block domain';

        let participantsData = [];

        if (this.state.favorite) {
            if (!this.state.blocked) {
                showBlockButton = false;
            }
        }

        if (tags.indexOf('test') > -1) {
            showBlockButton = false;
        }

        if (name === 'Myself') {
            showBlockButton = false;
        }

        if (this.state.blocked) {
            blockTextbutton = 'Unblock';
        }

        let color = {};

        let title = name || username;
        let subtitle = uri;
        let description = 'No calls or messages';

        if (this.state.contact.timestamp) {
            description = moment(this.state.contact.timestamp).format('MMM D HH:mm');
        }

        if (name === uri) {
            title = toTitleCase(username);
        }

        if (isPhoneNumber && isIp(domain)) {
           title = 'Tel ' + username;
           subtitle = 'From @' + domain;
           showBlockDomainButton = true;
        }

        if (utils.isAnonymous(uri)) {
            //uri = 'anonymous@anonymous.invalid';
            if (uri.indexOf('@guest.') > -1) {
                subtitle = 'From the Web';
            } else {
                name = 'Anonymous';
            }
            showBlockDomainButton = true;
            if (!this.state.blocked) {
                showBlockButton = false;
            }
            blockDomainTextbutton = 'Block Web callers';
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

        if (this.state.contact.tags.indexOf('history') > -1) {
            duration = moment.duration(this.state.contact.lastCallDuration, 'seconds').format('HH:mm:ss', {trim: false});

            if (this.state.contact.direction === 'incoming' && this.state.contact.lastCallDuration === 0) {
                duration = 'missed';
            } else if (this.state.contact.direction === 'outgoing' && this.state.contact.lastCallDuration === 0) {
                duration = 'cancelled';
            }
        }

        if (this.state.contact.conference) {
            let participants = this.state.contact.participants;
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
                    contact_obj = this.findObjectByKey(this.props.contacts, 'uri', participant);
                    dn = contact_obj ? contact_obj.name : participant;
                    _item = {nr: i, id: uuid.v4(), uri: participant, name: dn};
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
                        if (participant.name === participant.uri) {
                            dn = toTitleCase(participant.uri.split('@')[0]);
                        } else {
                            dn = participant.name.split(' ')[0];
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

        if (!name) {
            title = uri;
        }

        if (duration === 'missed') {
            subtitle = 'Last call missed';
        } else if (duration === 'cancelled') {
            subtitle = 'Last call cancelled';
        } else {
            if (duration) {
                subtitle = 'Last call ' + duration ;
            }
        }

        if (title.indexOf('@videoconference') > -1) {
            title = username;
        }

        if (duration && duration !== "00:00:00") {
            let media = 'Audio call';
            if (this.state.contact.lastCallMedia.indexOf('video') > -1) {
                media = 'Video call';
            }
            description = description + ' (' + media + ' ' + duration + ')';
        }

        const container = this.state.isLandscape ? styles.containerLandscape : styles.containerPortrait;
        const chatContainer = this.state.isLandscape ? styles.chatLandscapeContainer : styles.chatPortraitContainer;

        if (showActions && participantsData.length > 0) {
            cardHeight = cardHeight + 20 * participantsData.length + 10;
        }

        let showSubtitle = (showActions || this.state.isTablet || !description);
        let label = this.state.contact.label ? (" (" +this.state.contact.label + ")" ) : '';
        if (this.state.contact.lastMessage) {
            subtitle = this.state.contact.lastMessage.split("\n")[0];
            //description = description + ': ' + this.state.contact.lastMessage;
        } else {
            subtitle = subtitle + label;
        }

        let unread = (this.state.contact && this.state.contact.unread) ? this.state.contact.unread.length : 0;

        return (
            <Fragment>
                <Card style={[cardContainerClass, {height: cardHeight}]}
                    onPress={() => {this.setTargetUri(uri, this.state.contact)}}
                    >

                <View style={styles.rowContent}>
                    <Card.Content style={styles.cardContent}>
                        <View style={styles.avatarContent}>
                            { this.state.contact.photo || ! this.state.contact.email ?
                            <UserIcon style={styles.userIcon} identity={this.state.contact} unread={unread}/>
                            :
                             <Gravatar options={{email: this.state.contact.email, parameters: { "size": "70", "d": "mm" }, secure: true}} style={styles.gravatar} />
                             }

                        </View>

                        <View style={styles.mainContent}>
                            <Title noWrap style={styles.title}>{title}</Title>
                            <Subheading style={styles.subtitle}>{subtitle}</Subheading>

                            <Caption style={styles.description}>
                                {this.state.contact.direction ?
                                <Icon name={this.state.contact.direction == 'incoming' ? 'arrow-bottom-left' : 'arrow-top-right'}/>
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
                        { this.state.contact.selected ?
                        <Icon name='check-circle' size={30} />
                        : null
                        }
                        {unread ?
                        <Badge value={unread} status="error"  textStyle={styles.badgeTextStyle} containerStyle={styles.badgeContainer}/>
                        : null
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

ContactCard.propTypes = {
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
    messages       : PropTypes.array,
    pinned         : PropTypes.bool,
    unread         : PropTypes.array,
    toggleBlocked  : PropTypes.func,
    sendPublicKey  : PropTypes.func
};


export default ContactCard;
